@echo off
setlocal EnableExtensions
chcp 65001 >nul
REM ===== 强制 Python 全局 UTF-8（防止默认 GBK 导致中文乱码/文件改坏）=====
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONLEGACYWINDOWSSTDIO=0"
title ZF3D AGENT - Server Console
cd /d "%~dp0"
cls

REM ===== 从 private/port.json 读取端口（与 server/config.py 保持一致）=====
set "PORT=8510"
if exist "private\port.json" (
    for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { (Get-Content 'private\port.json' -Raw | ConvertFrom-Json).api_port } catch { '8510' }"`) do set "PORT=%%P"
)

REM Kill old server by PID file (if exists)
if exist "private\server.pid" (
    for /f "tokens=*" %%P in (private\server.pid) do (
        taskkill /F /PID %%P >nul 2>&1
    )
    del "private\server.pid" >nul 2>&1
    timeout /t 1 /nobreak >nul
)

REM Open browser after 2 seconds (background, no extra window)
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%PORT%/"

REM Run server (foreground - this is the only window)
"python\python.exe" "server\server.py"

if errorlevel 1 (
    echo.
    echo [ERROR] Server exited with an error. See messages above.
    echo This window stays open so you can read the error. Press any key to close...
    pause >nul
)

exit /b 0
