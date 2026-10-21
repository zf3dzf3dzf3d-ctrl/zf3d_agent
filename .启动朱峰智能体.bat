@echo off

rem 朱峰智能体无??- 启动器（托盘常驻 + 桌面窗口??
rem 说明：优先用 pythonw.exe（无控制台）；没??pythonw.exe 时用

rem       powershell 隐藏窗口方式??python.exe，保证任何环境都能启动??
setlocal

cd /d "%~dp0"

if not exist "%~dp0python\pythonw.exe" (

    if not exist "%~dp0python\python.exe" (

        echo [错误] 未找??%~dp0python\python.exe，请检查项目内 Python 目录是否完整??
        pause

        exit /b 1

    )

    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~dp0python\python.exe' -ArgumentList 'server\tray_server.py' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

) else (

    rem 任务管理器显示名优先用改名副本「朱峰智能体无限.exe」（pythonw 的副本），

    rem 缺失时回退原生 pythonw.exe，保证任何环境都能启动。

    if exist "%~dp0python\朱峰智能体无限.exe" (

        start "" /b "%~dp0python\朱峰智能体无限.exe" "%~dp0server\tray_server.py"

    ) else (

        start "" /b "%~dp0python\pythonw.exe" "%~dp0server\tray_server.py"

    )

)

endlocal

