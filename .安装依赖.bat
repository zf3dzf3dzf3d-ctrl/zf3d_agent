@echo off
setlocal EnableExtensions
chcp 936 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
title ZF3D AGENT - 依赖安装
cd /d "%~dp0"

echo ============================================
echo  首次运行依赖安装（约10-20分钟，只需一次）
echo  请保持网络连接，不要关闭本窗口
echo ============================================
echo.

if not exist "python\python.exe" (
    echo [错误] 未找到 python\python.exe，请先确认安装包完整
    pause
    exit /b 1
)

set "MIRROR=-i https://pypi.tuna.tsinghua.edu.cn/simple"

echo [1/4] 安装基础依赖...
"python\python.exe" -m pip install %MIRROR% --upgrade pip >nul 2>&1
"python\python.exe" -m pip install %MIRROR% numpy pillow requests bottle psutil websockets aiohttp httpx pyyaml jinja2 cryptography pycryptodomex lxml certifi urllib3 charset-normalizer packaging websockets-proxy python-dateutil pytz regex tqdm

echo [2/4] 安装浏览器自动化组件...
"python\python.exe" -m pip install %MIRROR% playwright greenlet
set "PLAYWRIGHT_BROWSERS_PATH=0"
"python\python.exe" -m playwright install chromium
"python\python.exe" -m playwright install chromium-headless-shell

echo [3/4] 安装多媒体与科学计算组件...
"python\python.exe" -m pip install %MIRROR% av imageio opencv-python-headless scenedetect py7zr brotli cffi webview pythonnet jieba
"python\python.exe" -m pip install %MIRROR% scipy scikit-learn scikit-image numba llvmlite sympy mpmath networkx joblib
"python\python.exe" -m pip install %MIRROR% openpyxl python-pptx xlsxwriter pymupdf
"python\python.exe" -m pip install %MIRROR% torch --index-url https://download.pytorch.org/whl/cpu

echo [4/4] 完成
echo.
echo 依赖安装全部完成！
exit /b 0
