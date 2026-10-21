@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set OUT=%~dp0诊断报告.txt
echo 正在诊断，请稍候...
(
echo ===== 朱峰智能体 诊断报告 %date% %time% =====
echo.
echo [1] 目录: %CD%
echo.
echo [2] python 版本:
python\python.exe -V 2>&1
echo.
echo [3] 标准库导入测试:
python\python.exe -c "import ssl,socket,json,sqlite3,asyncio;print('stdlib OK')" 2>&1
echo.
echo [4] 第三方依赖导入测试:
python\python.exe -c "import fastapi,uvicorn;print('fastapi/uvicorn OK')" 2>&1
python\python.exe -c "import aiohttp;print('aiohttp OK')" 2>&1
echo.
echo [5] server 模块导入测试:
python\python.exe -c "import sys;sys.path.insert(0,'.');import server;print('server OK', getattr(server,'__version__','?'))" 2>&1
echo.
echo [6] 启动 server 入口（8秒后自动结束）:
start /b "" cmd /c "python\python.exe -X faulthandler -c ""import sys;sys.path.insert(0,'.');from server.app import app;print('app import OK')"" > python_check.log 2>&1"
timeout /t 8 /nobreak >nul
type python_check.log 2>&1
echo.
echo [7] python311._pth 内容:
type python\python311._pth 2>&1
echo.
echo [8] python 目录列表:
dir python /b 2>&1
echo.
echo [9] Lib\site-packages 列表:
dir python\Lib\site-packages /b 2>&1
) > "%OUT%" 2>&1
echo.
echo 诊断完成，报告已生成: %OUT%
pause
