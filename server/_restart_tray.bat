@echo off
rem ============================================================
rem  一键重启后台（确认弹窗 + 真实完成反馈版）
rem  由 PowerShell(WinForms) 弹出确认框 -> 调用项目自带的
rem  restart_server.py（精确只杀 server.py 旧进程、拉起新后台、
rem  健康检查、恢复托盘）-> 完成后弹出真实结果（成功/失败 + 耗时）。
rem  不再使用 taskkill /F /IM python.exe（会误杀所有 python 程序），
rem  也不再写死旧版本号目录。
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0_restart_tray_gui.ps1"
exit /b 0
