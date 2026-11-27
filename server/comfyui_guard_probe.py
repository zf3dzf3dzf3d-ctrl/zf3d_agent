# -*- coding: utf-8 -*-
"""
ComfyUI 守护探针（T2，区域9 多模态区）· 影子模式 v2
- 每 10 分钟由 schedule 调用一次
- 用 ctypes 读进程内存（不用 psutil，本项目内 psutil 为坏命名空间包）
- 识别条件：进程名含 python 且命令行含 comfyui（WMI 查询）
- >40GB 预警、>60GB 熔断级别；影子模式（SHADOW=True）绝不重启
- 无进程记 SKIP，自身异常吞掉不抛
"""
import ctypes, ctypes.wintypes as wt, os, datetime, subprocess

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comfyui_guard.log")
WARN_GB, CRIT_GB = 40.0, 60.0
SHADOW = True
LOG_MAX_BYTES = 512 * 1024  # 日志体积上限 512KB，超限轮转为 .old（防 zscan_out.txt 式无人看膨胀，2026-10-30 收口采纳安全师建议）

class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

def log(msg):
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > LOG_MAX_BYTES:
            old = LOG + ".old"
            if os.path.exists(old):
                os.remove(old)
            os.replace(LOG, old)
    except Exception:
        pass
    with open(LOG, "a", encoding="utf-8-sig") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")

def pagefile_usage_bytes(pid):
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    try:
        pmc = PROCESS_MEMORY_COUNTERS(); pmc.cb = ctypes.sizeof(pmc)
        if ctypes.windll.psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb):
            return pmc.PagefileUsage  # 提交内存（虚拟内存承诺量）
        return None
    finally:
        ctypes.windll.kernel32.CloseHandle(h)

def comfyui_pids():
    # 注意：查询命令自身命令行含 comfyui 关键词会造成自匹配误报（已实测踩坑）。
    # 排除：$PID 自身 + powershell/cmd 包装（Name 必须 python*.exe）；
    # 匹配条件收紧为：命令行含 D:\ComfyUI-H3 路径 且 含 main.py（ComfyUI 主进程唯一形态）
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID "
         "-and $_.Name -like 'python*' "
         "-and $_.CommandLine -match 'ComfyUI-H3' "
         "-and $_.CommandLine -match 'main\\.py'} | Select-Object -ExpandProperty ProcessId"],
        capture_output=True, text=True, timeout=60)
    return [int(x) for x in out.stdout.split() if x.strip().isdigit()]

def main():
    pids = comfyui_pids()
    if not pids:
        log("SKIP 无 ComfyUI 进程")
        return
    for pid in pids:
        b = pagefile_usage_bytes(pid)
        if b is None:
            log(f"UNKNOWN pid={pid} 无法读取内存(可能刚退出)")
            continue
        gb = b / 1024**3
        if gb >= CRIT_GB:
            log(f"CRITICAL pid={pid} commit={gb:.1f}GB 超过{CRIT_GB}GB熔断线" + (" —— 影子模式仅记录不重启" if SHADOW else " —— 待授权熔断流程"))
        elif gb >= WARN_GB:
            log(f"WARNING pid={pid} commit={gb:.1f}GB 超过{WARN_GB}GB预警线")
        else:
            log(f"OK pid={pid} commit={gb:.1f}GB")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        try:
            log(f"PROBE_ERROR {e!r}")
        except Exception:
            pass
