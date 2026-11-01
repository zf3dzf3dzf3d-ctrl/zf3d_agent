' 朱峰智能体无限 - 无黑框启动器
' 双击此文件启动，全程不出现 cmd 黑框
' 启动优先级与 .启动朱峰智能体.bat 保持一致：
'   1) 改名副本 python\朱峰智能体无限.exe（任务管理器显示名友好）
'   2) 回退原生 python\pythonw.exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(ws.CurrentDirectory & "\python\朱峰智能体无限.exe") Then
    exe = ".\python\朱峰智能体无限.exe"
Else
    exe = ".\python\pythonw.exe"
End If
ws.Run """" & exe & """ ""server\tray_server.py""", 0, False
