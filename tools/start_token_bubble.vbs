' 桌面领token气泡启动器（静默，无黑窗）
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
py = "C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe"
If Not fso.FileExists(py) Then py = "F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\python\python.exe"
script = fso.GetParentFolderName(WScript.ScriptFullName) & "\desktop_token_bubble.py"
sh.Environment("PROCESS")("TCL_LIBRARY") = "C:\Users\Administrator\AppData\Local\Programs\Python\Python311\tcl\tcl8.6"
sh.Environment("PROCESS")("TK_LIBRARY") = "C:\Users\Administrator\AppData\Local\Programs\Python\Python311\tcl\tk8.6"
sh.Run """" & py & """ """ & script & """", 0, False
