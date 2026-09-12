@echo off
cd /d "F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\server"
"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\python\python.exe" -u test_chat_gate_quick.py > quick_out.txt 2>&1
echo EXITCODE=%ERRORLEVEL% >> quick_out.txt
