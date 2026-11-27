# M1.0 沙箱验证启动器：四种模式把探针送进目标隔离环境，管道收回 stdout。
# 用法：powershell -ExecutionPolicy Bypass -File launcher.ps1 -Mode <mode> [选项]
#   baseline     不隔离（管线自证）
#   job          Job Object UI 限制（禁剪贴板）
#   safer -SaferLevel untrusted|constrained|basicuser   受限令牌（Safer 等级）
#   appcontainer -AcName <名>   AppContainer（profile 需已建，ACL 由编排层先授）
#   ensureprofile -AcName <名>  创建 AC profile（已存在则跳过）
#   getsid       -AcName <名>   输出 AC 的 SID 字符串
param(
    [Parameter(Mandatory=$true)][string]$Mode,
    [string]$SaferLevel = 'untrusted',
    [string]$AcName = 'ZF.Sandbox.Validate',
    [string]$Exe = '',
    [string]$Args = '',
    [string]$Cwd = '',
    [string]$LoopbackAction = 'grant'
)
$ErrorActionPreference = 'Stop'

$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class ZfSandbox {
    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFOW {
        public uint cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFOEXW { public STARTUPINFOW StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; }

    [DllImport("kernel32", SetLastError = true)]
    public static extern bool CreatePipe(out IntPtr r, out IntPtr w, ref SECURITY_ATTRIBUTES sa, uint size);
    [DllImport("kernel32", SetLastError = true)]
    public static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref STARTUPINFOW si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref STARTUPINFOEXW si, out PROCESS_INFORMATION pi);
    [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessAsUserW(IntPtr tok, string app, string cmd, IntPtr pa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref STARTUPINFOW si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32", SetLastError = true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32", SetLastError = true)] public static extern bool GetExitCodeProcess(IntPtr p, out uint code);
    [DllImport("kernel32", SetLastError = true)] public static extern bool ReadFile(IntPtr h, byte[] buf, uint n, out uint read, IntPtr ov);
    [DllImport("kernel32")] public static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
    [DllImport("advapi32", SetLastError = true)] public static extern bool DuplicateTokenEx(IntPtr t, uint access, IntPtr ta, int imp, int type, out IntPtr nt);
    [DllImport("advapi32", SetLastError = true)] public static extern bool SaferCreateLevel(int scope, int level, int flags, out IntPtr h, IntPtr reserved);
    [DllImport("advapi32", SetLastError = true)] public static extern bool SaferComputeTokenFromLevel(IntPtr lvl, IntPtr inTok, out IntPtr outTok, uint flags, IntPtr reserved);
    [DllImport("advapi32", SetLastError = true)] public static extern bool SaferCloseLevel(IntPtr h);
    [DllImport("userenv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint CreateAppContainerProfile(string name, string disp, string desc, IntPtr caps, uint count, out IntPtr sid);
    [DllImport("userenv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr str);
    [DllImport("kernel32")] public static extern IntPtr LocalFree(IntPtr h);
    [DllImport("kernel32", SetLastError = true)] public static extern bool InitializeProcThreadAttributeList(IntPtr list, uint count, uint flags, ref uint size);
    [DllImport("kernel32", SetLastError = true)] public static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, uint attr, IntPtr value, UIntPtr size, IntPtr prev, IntPtr ret);
    [DllImport("kernel32", SetLastError = true)] public static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
    [DllImport("kernel32", SetLastError = true)]
    public static extern bool SetInformationJobObject(IntPtr hJob, int cls, ref uint info, uint len);
    [DllImport("kernel32", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProc);

    public const uint TOKEN_ALL_ACCESS = 0xF00FF;
    public const uint HANDLE_FLAG_INHERIT = 0x1;
    public const uint STARTF_USESTDHANDLES = 0x100;
    public const uint EXTENDED_STARTUPINFO_PRESENT = 0x80000;
    public const uint PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x20009;

    public static string SidToString(IntPtr sid) {
        IntPtr s;
        if (!ConvertSidToStringSid(sid, out s)) return null;
        string r = Marshal.PtrToStringUni(s);
        LocalFree(s);
        return r;
    }

    public static string EnsureAcProfile(string name) {
        IntPtr sid;
        uint hr = CreateAppContainerProfile(name, "ZF M1.0 sandbox validation", "M1.0 validation container", IntPtr.Zero, 0, out sid);
        if (hr == 0) { LocalFree(sid); return "CREATED"; }
        if (hr == 0x800700B7 || (hr & 0xFFFF) == 183) return "EXISTS";
        return "ERR_0x" + hr.ToString("X8");
    }

    public static string GetAcSid(string name) {
        IntPtr sid;
        uint hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
        if (hr != 0) return "ERR_0x" + hr.ToString("X8");
        string s = SidToString(sid);
        LocalFree(sid);
        return s;
    }

    // 统一启动：mode 决定隔离方式；返回 "EXIT:<code>\n" + 子进程 stdout。
    public static string Launch(string mode, int saferLevel, string acName, string exe, string args, string cwd) {
        SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(sa); sa.bInheritHandle = true;
        IntPtr ro, wo;
        if (!CreatePipe(out ro, out wo, ref sa, 65536)) return "ERR pipe: " + Marshal.GetLastWin32Error();
        // 两端都可继承：孙进程（subprocess）需要继承合法 stdin；EOF 由写端全部关闭触发

        STARTUPINFOW si = new STARTUPINFOW();
        si.cb = (uint)Marshal.SizeOf(si);
        // 【M1.0 实测结论】显式设置 lpDesktop 会使内嵌解释器的 _ctypes DLL 初始化失败
        // （错误 1114）；不设置则继承调用方的默认窗口站/桌面，一切正常。
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = ro; si.hStdOutput = wo; si.hStdError = wo;
        string cmd = "\"" + exe + "\" " + args;
        PROCESS_INFORMATION pi;
        bool created;

        if (mode == "baseline" || mode == "job") {
            created = CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, cwd, ref si, out pi);
        } else if (mode == "appcontainer") {
            IntPtr acSid;
            uint hr = DeriveAppContainerSidFromAppContainerName(acName, out acSid);
            if (hr != 0) return "ERR acsid: 0x" + hr.ToString("X8");
            IntPtr dup;
            IntPtr tok;
            OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out tok);
            if (!DuplicateTokenEx(tok, TOKEN_ALL_ACCESS, IntPtr.Zero, 2, 1, out dup)) return "ERR dup: " + Marshal.GetLastWin32Error();
            uint size = 0;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            IntPtr attrList = Marshal.AllocHGlobal((int)size);
            if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref size)) return "ERR attrinit: " + Marshal.GetLastWin32Error();
            SECURITY_CAPABILITIES sc = new SECURITY_CAPABILITIES();
            sc.AppContainerSid = acSid; sc.Capabilities = IntPtr.Zero; sc.CapabilityCount = 0;
            IntPtr pSc = Marshal.AllocHGlobal(Marshal.SizeOf(sc));
            Marshal.StructureToPtr(sc, pSc, false);
            if (!UpdateProcThreadAttribute(attrList, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, pSc,
                (UIntPtr)Marshal.SizeOf(sc), IntPtr.Zero, IntPtr.Zero)) return "ERR attrupd: " + Marshal.GetLastWin32Error();
            STARTUPINFOEXW siex = new STARTUPINFOEXW();
            si.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEXW));
            siex.StartupInfo = si;
            siex.lpAttributeList = attrList;
            created = CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, true,
                EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, cwd, ref siex, out pi);
            if (!created) { int e = Marshal.GetLastWin32Error(); DeleteProcThreadAttributeList(attrList); Marshal.FreeHGlobal(attrList); return "ERR create_ac: " + e; }
            DeleteProcThreadAttributeList(attrList); Marshal.FreeHGlobal(attrList);
        } else if (mode == "safer") {
            IntPtr tok;
            OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out tok);
            IntPtr hLevel;
            IntPtr outTok;
            if (!SaferCreateLevel(1 /*SAFER_SCOPEID_USER*/, saferLevel, 0, out hLevel, IntPtr.Zero))
                return "ERR saferlevel: " + Marshal.GetLastWin32Error();
            if (!SaferComputeTokenFromLevel(hLevel, tok, out outTok, 0, IntPtr.Zero)) {
                int e = Marshal.GetLastWin32Error(); SaferCloseLevel(hLevel);
                return "ERR safercompute: " + e;
            }
            SaferCloseLevel(hLevel);
            created = CreateProcessAsUserW(outTok, null, cmd, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, cwd, ref si, out pi);
            if (!created) return "ERR create_safer: " + Marshal.GetLastWin32Error();
        } else {
            return "ERR unknown mode";
        }
        if (!created && mode != "appcontainer" && mode != "safer")
            return "ERR create: " + Marshal.GetLastWin32Error();

        CloseHandle(wo);
        if (mode == "job") {
            IntPtr hJob = CreateJobObjectW(IntPtr.Zero, null);
            uint uiFlags = 0x1 | 0x2;   // READCLIPBOARD | WRITECLIPBOARD
            if (!SetInformationJobObject(hJob, 4 /*JobObjectBasicUiRestrictions*/, ref uiFlags, 4))
                return "ERR jobui: " + Marshal.GetLastWin32Error();
            if (!AssignProcessToJobObject(hJob, pi.hProcess))
                return "ERR jobassign: " + Marshal.GetLastWin32Error();
        }

        uint wait = WaitForSingleObject(pi.hProcess, 120000);
        uint exit = 9999;
        GetExitCodeProcess(pi.hProcess, out exit);
        var sb = new StringBuilder();
        byte[] buf = new byte[8192];
        uint n;
        while (true) {
            if (!ReadFile(ro, buf, (uint)buf.Length, out n, IntPtr.Zero) || n == 0) break;
            sb.Append(Encoding.UTF8.GetString(buf, 0, (int)n));
        }
        CloseHandle(pi.hProcess); CloseHandle(pi.hThread); CloseHandle(ro);
        return "EXIT:" + exit + "\n" + sb.ToString();
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp

$pyExe = Join-Path $Cwd 'python\python.exe'
$probeArgs = '-B "tools\sandbox\probe.py"'

switch ($Mode) {
    'ensureprofile' { [ZfSandbox]::EnsureAcProfile($AcName) }
    'getsid'        { [ZfSandbox]::GetAcSid($AcName) }
    'baseline'      { [ZfSandbox]::Launch('baseline', 0, '', $pyExe, $probeArgs, $Cwd) }
    'raw'           { [ZfSandbox]::Launch('baseline', 0, '', $Exe, $Args, $Cwd) }
    'job'           { [ZfSandbox]::Launch('job', 0, '', $pyExe, $probeArgs, $Cwd) }
    'appcontainer'  { [ZfSandbox]::Launch('appcontainer', 0, $AcName, $pyExe, $probeArgs, $Cwd) }
    'safer' {
        $lv = switch ($SaferLevel) { 'untrusted' { 0x10000 } 'constrained' { 0x20000 } 'basicuser' { 0x21000 } default { 0x10000 } }
        [ZfSandbox]::Launch('safer', $lv, '', $pyExe, $probeArgs, $Cwd)
    }
    'loopback' {
        # 【M1.1 移交项①修复 2026-11-24 alpha】回环豁免脚本化（bravo 复审发现：M1.0 里
        # 是手工 CheckNetIsolation，未沉淀，「AC+回环豁免」列不可一键复现）。
        # 用法：-Mode loopback -LoopbackAction grant|revoke   （均需管理员；动作后 sid 回读自校验）
        $sid = [ZfSandbox]::GetAcSid($AcName)
        if ($sid -like 'ERR_*') { throw "getsid 失败: $sid" }
        $before = (& CheckNetIsolation.exe LoopbackExempt -s | Out-String)
        if ($LoopbackAction -eq 'revoke') {
            & CheckNetIsolation.exe LoopbackExempt -d "-p=$sid"
            if ($LASTEXITCODE -ne 0) { throw "LoopbackExempt -d 失败: $LASTEXITCODE" }
        } else {
            & CheckNetIsolation.exe LoopbackExempt -a "-p=$sid"
            if ($LASTEXITCODE -ne 0) { throw "LoopbackExempt -a 失败: $LASTEXITCODE" }
        }
        $after = (& CheckNetIsolation.exe LoopbackExempt -s | Out-String)
        $inBefore = $before.Contains($sid)
        $inAfter  = $after.Contains($sid)
        if ($LoopbackAction -eq 'revoke' -and $inAfter) { throw "revoke 自校验失败：SID 仍在豁免清单" }
        if ($LoopbackAction -eq 'grant' -and -not $inAfter) { throw "grant 自校验失败：SID 未进豁免清单" }
        "LOOPBACK_$($LoopbackAction.ToUpper())_OK sid=$sid before=$inBefore after=$inAfter"
    }
    default { throw "unknown mode: $Mode" }
}
