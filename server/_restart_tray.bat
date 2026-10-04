@echo off
taskkill /F /IM python.exe >nul 2>&1
timeout /t 1 >nul
start "" /D "F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0" "F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\python\python.exe" "F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\server\tray_server.py"
timeout /t 6 >nul
tasklist | findstr /i python
