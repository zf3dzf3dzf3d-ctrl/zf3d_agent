@echo off
chcp 65001 >nul
set PY=C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe
set DIR=%~dp0private\ai实验
:menu
cls
echo =================================
echo         定时开关 实验程序
echo =================================
echo   1. 打开并运行 N 秒后自动关闭
echo   2. 立即关闭
echo   3. 退出
echo =================================
set /p choice=请选择 (1-3): 
if "%choice%"=="1" goto run
if "%choice%"=="2" goto off
if "%choice%"=="3" exit
goto menu

:run
set /p secs=请输入运行秒数 (1-10): 
"%PY%" "%DIR%\timer_switch.py" on now %secs%
echo.
pause
goto menu

:off
"%PY%" "%DIR%\timer_switch.py" off
echo.
pause
goto menu
