@echo off
setlocal EnableExtensions
chcp 936 >nul
title ZF3D AGENT - 清理残留进程
cd /d "%~dp0"
echo ============================================
echo   朱峰智能体无限 - 残留 python 进程清理
echo ============================================
echo.

REM ============================================================
REM 原理：只杀同时满足以下条件的进程（白名单，绝不误杀）：
REM   1. 可执行文件是本项目自带的 python\python.exe
REM   2. 命令行里包含本项目的 server 目录（server\server.py 等）
REM   3. 不是当前正在监听服务端口的那一个"活跃实例"
REM 其他任何 python 进程（ComfyUI、系统工具、其他项目）一律不动。
REM ============================================================

REM 支持参数：不带参数=清理残留；传入 -KillAll=全杀本项目 server（彻底重启用）
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\cleanup_stale_python.ps1" %*

echo.
echo 清理完成。
pause
exit /b 0
