@echo off
setlocal EnableExtensions
chcp 65001 >nul
title ZF3D AGENT - Server Console
cd /d "%~dp0"
cls

REM Kill old server by PID file (if exists)
if exist "private\server.pid" (
    for /f "tokens=*" %%P in (private\server.pid) do (
        taskkill /F /PID %%P >nul 2>&1
    )
    del "private\server.pid" >nul 2>&1
    timeout /t 1 /nobreak >nul
)

REM Open browser after 2 seconds (background, no extra window)
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:8500/"

REM Run server (foreground - this is the only window)
"python\python.exe" "server\server.py"

if errorlevel 1 (
    echo.
    echo [ERROR] Server exited with an error. See messages above.
    echo This window stays open so you can read the error. Press any key to close...
    pause >nul
)

exit /b 0
