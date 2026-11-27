@echo off
chcp 65001 >nul
rem 2026-11-26 可移植化：改用项目自带 Python（python\python.exe），不再绑死本机 Administrator 账户的 Python311
set PY=%~dp0..\python\python.exe
if not exist "%PY%" set PY=python
rem 实验脚本目录：项目根 private\ai实验（timer_switch.py 等实验脚本放这里）
set DIR=%~dp0..\private\ai实验
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
