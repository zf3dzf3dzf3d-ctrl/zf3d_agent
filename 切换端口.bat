@echo off
setlocal
chcp 65001 >nul
set "PORT=%~1"
if "%PORT%"=="" set /p "PORT=请输入新端口(1024-65535): "
python "%~dp0tools\switch_port.py" --port %PORT% --start --open-browser
if errorlevel 1 pause
