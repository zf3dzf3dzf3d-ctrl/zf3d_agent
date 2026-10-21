@echo off
rem 峰控桥 PC 端一键启动（最小化运行）
cd /d %~dp0
start "" /min "%~dp0..\..\..\python\pythonw.exe" "%~dp0bridge_server.py"
echo 峰控桥已在后台启动，端口 8765
