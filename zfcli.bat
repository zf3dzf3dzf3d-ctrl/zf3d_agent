@echo off
rem zfcli.bat - 朱峰智能体命令行快捷入口（自动定位安装目录 + UTF-8 防乱码）
rem 用法: zfcli "帮我建一个test.txt内容为hello"
rem       zfcli --session demo          （多轮 REPL）
rem       zfcli --task-file tasks.txt   （批处理）
chcp 65001 >nul
cd /d %~dp0
"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\python\python.exe" -X utf8 "%~dp0server\cli.py" %*
