@echo off
chcp 936 >nul
title ZF3D AGENT - 在线升级
cd /d "%~dp0"

echo ============================================
echo   朱峰社区智能体无限 - 在线升级
echo ============================================
echo.

REM 检查 git 是否可用
where git >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 git 命令。
    echo 请先安装 Git for Windows: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

echo [1/2] 检查远程最新版本...
"python\python.exe" server\updater.py check
echo.
set /p GO=发现新版本时是否直接升级? (Y=升级 / N=仅检查): 
if /i "%GO%"=="Y" (
    echo.
    echo [2/2] 开始升级（本地改动会自动 stash 保护，服务将自动重启）...
    "python\python.exe" server\updater.py apply
    echo.
    echo 升级命令已执行，服务器正在重启，稍候刷新浏览器即可。
    timeout /t 5 >nul
) else (
    echo 已取消升级。
    timeout /t 3 >nul
)
exit /b 0
