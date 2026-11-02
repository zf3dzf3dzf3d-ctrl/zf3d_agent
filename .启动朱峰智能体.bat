@echo off
rem 朱峰智能体无限 - 启动器（托盘常驻）
rem 优化：有 pythonw 时直接 start 启动（无控制台），去掉多余的 cmd /c 包装减少黑框闪留；
rem 本 bat 自身的黑框属于 cmd 解释器行为（双击 .bat 必开 conhost），
rem 彻底无黑框请用「启动朱峰智能体_无窗口.vbs」。
setlocal
cd /d "%~dp0"

if not exist "%~dp0python\pythonw.exe" (
    if not exist "%~dp0python\python.exe" (
        echo [错误] 未找到 python\python.exe，请检查项目内 Python 目录是否完整。
        pause
        exit /b 1
    )
    rem 无 pythonw 时用 powershell 隐藏窗口方式启动 python.exe
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~dp0python\python.exe' -ArgumentList 'server\tray_server.py' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
) else (
    rem 任务管理器显示名优先用改名副本「朱峰智能体无限.exe」（pythonw 的副本），缺失时回退原生 pythonw.exe
    if exist "%~dp0python\朱峰智能体无限.exe" (
        start "" "%~dp0python\朱峰智能体无限.exe" "%~dp0server\tray_server.py"
    ) else (
        start "" "%~dp0python\pythonw.exe" "%~dp0server\tray_server.py"
    )
)
endlocal
