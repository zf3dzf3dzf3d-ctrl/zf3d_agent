@echo off
rem 朱峰智能体无限 - 启动器（托盘常驻 + 桌面窗口）
rem 说明：优先用 pythonw.exe（无控制台）；没有 pythonw.exe 时用
rem       powershell 隐藏窗口方式调 python.exe，保证任何环境都能启动。
setlocal
cd /d "%~dp0"
if exist "%~dp0python\pythonw.exe" (
    start "" /b "%~dp0python\pythonw.exe" "%~dp0server\tray_server.py"
) else (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~dp0python\python.exe' -ArgumentList 'server\tray_server.py' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
)
endlocal
