@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"

:: Find Python 3.9+ (compatible with Server 2012 R2)
set "PYTHON="

if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
)
if not defined PYTHON if exist "%LOCALAPPDATA%\Programs\Python\Python39\python.exe" (
    set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
)
if not defined PYTHON if exist "C:\Python39\python.exe" (
    set "PYTHON=C:\Python39\python.exe"
)
if not defined PYTHON if exist "C:\Python311\python.exe" (
    set "PYTHON=C:\Python311\python.exe"
)
if not defined PYTHON (
    py -3 -c "import sys; exit(0)" 2>nul && set "PYTHON=py -3"
)
if not defined PYTHON (
    python -c "import sys; exit(0)" 2>nul && set "PYTHON=python"
)

if not defined PYTHON (
    echo.
    echo   [ERROR] Python not found! Run server_deploy.bat first
    echo   Or install Python 3.9+ manually
    echo.
    pause
    exit /b 1
)

echo.
echo   ZF3D Agent v2.0
echo   http://localhost:8080
echo.

%PYTHON% -X utf8 public\core\main.py

if %errorlevel% neq 0 (
    echo.
    echo   Start failed! Check:
    echo   1. Python 3.9+ installed
    echo   2. Run server_deploy.bat to install dependencies
    echo.
    pause
)
