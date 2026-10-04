@echo off
setlocal EnableExtensions
chcp 936 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONLEGACYWINDOWSSTDIO=0"
title ZF3D AGENT - Server Console
cd /d "%~dp0"
cls

REM ===== Read port from private/port.json (must match server/config.py) =====
set "PORT=8505"
if exist "private\port.json" (
    for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { (Get-Content 'private\port.json' -Raw | ConvertFrom-Json).api_port } catch { '8505' }"`) do set "PORT=%%P"
)

REM Do NOT kill the old server by pid file here: a stale pid may point to an
REM unrelated process (wrong kill). server.py handles port conflicts itself.

REM ===== Ensure AI proxy (8787) is running before server starts =====
call "start_proxy.bat"

REM ===== No auto dependency install. Use the settings panel or .bat manually. =====

REM ===== Cleanup stale python instances of this project (skip active ones) =====
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\cleanup_stale_python.ps1"

REM ===== Pre-flight: import-check all server code before launching =====
:preflight
"python\python.exe" -c "import sys; sys.path.insert(0,'server'); import handler_routes" >nul 2>&1
if errorlevel 1 (
    echo [PreFlight] Server code cannot be loaded yet - AI may still be editing. Retry in 10s...
    timeout /t 10 /nobreak >nul
    goto preflight
)

REM ===== Global hotkey daemon (Ctrl+Alt+R restart / Ctrl+Alt+K close AI browser) =====
REM 以完全隐藏方式启动（无任何窗口/任务栏项）
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'python\python.exe' -ArgumentList 'server\global_hotkey.py' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

REM Open browser once the server is actually responding (retry up to 60s)
start "" /b powershell -NoProfile -Command "$u='http://127.0.0.1:%PORT%/api/health'; foreach($i in 1..60){ try{ Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2 | Out-Null; break }catch{ Start-Sleep 1 } }; Start-Process 'http://127.0.0.1:%PORT%/'"

REM Run server (foreground - this is the only window)
"python\python.exe" "server\server.py"

if errorlevel 1 (
    echo.
    echo [ERROR] Server exited with an error. See messages above.
    echo The traceback is also saved to server\crash.log
    echo If you just clicked the in-app restart button, this exit is EXPECTED.
    echo Press any key to close...
    pause >nul
)

exit /b 0

