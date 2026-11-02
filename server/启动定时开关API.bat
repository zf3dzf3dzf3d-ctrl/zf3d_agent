@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   定时开关 API 服务  http://127.0.0.1:8765
echo   启动后别关这个窗口
echo ============================================
if exist "python\python.exe" (
    "python\python.exe" "%~dp0定时开关API.py"
) else (
    python "%~dp0定时开关API.py"
)
pause
