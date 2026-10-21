@echo off
chcp 65001 >nul
REM 朱峰 AI 代理专项诊断 —— 拷到远程机"安装目录"下，与 代理诊断.py 同目录，双击运行
cd /d "%~dp0"
echo 正在诊断 AI 代理(8564) ...
if exist "python\pythonw.exe" (
    python\python.exe 代理诊断.py
) else if exist "python\python.exe" (
    python\python.exe 代理诊断.py
) else (
    python 代理诊断.py
)
echo.
pause
