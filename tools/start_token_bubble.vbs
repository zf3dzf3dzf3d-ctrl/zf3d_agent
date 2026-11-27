' 桌面领token气泡启动器（静默，无黑窗）
' 版本3：python 解析链 = 项目自带 python\python.exe（打包自带，最优先）→ 系统环境变量 pythonw/python（py -3 自动兜底）→ 全失败弹窗报错退出
' 零硬编码：不再写死 Administrator/盘符/版本号路径；TCL/TK 库路径由项目 python 自动推导
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
Set shEnv = sh.Environment("PROCESS")

' 1) 项目自带解释器（exe 所在目录\..\python\python.exe，与 launcher.py 同源推导，跨盘/跨机器有效）
baseDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
py = baseDir & "\python\python.exe"

' 2) 兜底：系统 PATH 里的 pythonw（无窗）或 python（py 启动器会挑默认 Python3.x）
If Not fso.FileExists(py) Then py = "pythonw.exe"
If Not fso.FileExists(py) Then py = "python.exe"

' 3) TCL/TK 库路径：项目自带 python 时显式注入（stdlib tcl 目录固定相对布局）；系统解释器时留空让其自带定位
tclRoot = baseDir & "\python\tcl"
If fso.FolderExists(tclRoot & "\tcl8.6") Then
    shEnv("TCL_LIBRARY") = tclRoot & "\tcl8.6"
    shEnv("TK_LIBRARY") = tclRoot & "\tk8.6"
End If

script = fso.GetParentFolderName(WScript.ScriptFullName) & "\desktop_token_bubble.py"
If Not fso.FileExists(script) Then
    MsgBox "启动失败：找不到 " & script, 16, "桌面领token气泡"
    WScript.Quit 1
End If
If Not fso.FileExists(py) Then
    MsgBox "启动失败：找不到可用的 Python 解释器（项目 python\python.exe 与系统 PATH 均未找到）", 16, "桌面领token气泡"
    WScript.Quit 1
End If
sh.Run """" & py & """ """ & script & """", 0, False
