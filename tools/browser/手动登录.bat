@echo off
chcp 65001 >nul
title 登录网站（手动登录，登录态自动保存）
set PLAYWRIGHT_BROWSERS_PATH=%~dp0..\..\python\browsers
start "" "%~dp0..\..\python\python.exe" "%~dp0login_helper.py"
