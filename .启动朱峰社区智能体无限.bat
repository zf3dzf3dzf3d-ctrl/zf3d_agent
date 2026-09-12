@echo off
setlocal EnableExtensions
chcp 936 >nul
REM ===== Force Python UTF-8 mode (avoid GBK issues) =====
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONLEGACYWINDOWSSTDIO=0"
title ZF3D AGENT - Server Console
cd /d "%~dp0"
cls

REM ===== Read port from private/port.json (must match server/config.py) =====
set "PORT=8520"
if exist "private\port.json" (
    for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { (Get-Content 'private\port.json' -Raw | ConvertFrom-Json).api_port } catch { '8520' }"`) do set "PORT=%%P"
)

REM Do NOT kill the old server by pid file here: a stale pid may point to an
REM unrelated process (wrong kill). server.py handles port conflicts itself:
REM it reuses a healthy instance (exit 0) or cleans up stale instances by
REM command line before taking over the port.

REM ===== First-run dependency check: REMOVED by user request (2026-09-10) =====
REM Never auto-install at startup. pip itself is broken in this build, so the
REM installer can never succeed; it only burned ~25min of failing downloads
REM on every cold start. Optional deps: install manually via the settings
REM panel "组件下载" or by running .安装依赖.bat yourself.

REM ===== Pre-flight: import-check all server code before launching =====
REM AI assistants may save half-finished server files; server.py would crash on
REM import. Instead of a crash window, wait and retry until the code imports cleanly.
:preflight
"python\python.exe" -c "import sys; sys.path.insert(0,'server'); import handler_routes" >nul 2>&1
if errorlevel 1 (
    echo [PreFlight] Server code cannot be loaded yet - AI may still be editing. Retry in 10s...
    timeout /t 10 /nobreak >nul
    goto preflight
)

REM Open browser after 2 seconds (background, no extra window)
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%PORT%/"

REM Run server (foreground - this is the only window)
"python\python.exe" "server\server.py"

if errorlevel 1 (
    echo.
    echo [ERROR] Server exited with an error. See messages above. The traceback is
    echo also saved to server\crash.log
    echo NOTE: If you just clicked the in-app restart button, this exit is EXPECTED -
    echo the new server is already running in another window. You can close this window.
    echo This window stays open so you can read the error. Press any key to close...
    pause >nul
)

exit /b 0
