@echo off
chcp 65001 >nul
title 内置浏览器服务
set PLAYWRIGHT_BROWSERS_PATH=%~dp0..\..\python\browsers
"%~dp0..\..\python\python.exe" "%~dp0browser_service.py" %*
pause
