@echo off
chcp 65001 >nul
title 朱峰无限桌面 - ZCode 一键安装
echo ============================================
echo   朱峰无限桌面 x ZCode 一键安装
echo ============================================
echo.

set "SRC=%~dp0"
set "DEST=%USERPROFILE%\.zcode\plugins\zf-infinite-desktop"

echo [1/3] 查找可用 Python...
set "PY="
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python311\python.exe" "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "C:\Python311\python.exe" "C:\Python312\python.exe" "C:\Python313\python.exe") do (
  if not defined PY if exist %%P set "PY=%%~P"
)
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo   [X] 未找到系统 Python，请先安装 Python 3.11+（勾选 Add to PATH）
  pause & exit /b 1
)
echo   [OK] %PY%

echo [2/3] 复制插件到 ZCode 插件目录...
if not exist "%DEST%" mkdir "%DEST%"
xcopy /e /i /y "%SRC*.*" "%DEST%\" >nul
echo   [OK] %DEST%

echo [3/3] 自检：启动 bridge_lite 并检查健康接口...
start "" /min "%PY%" "%DEST%\bridge_lite\launch.py" --port 8791
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8791/api/health -TimeoutSec 5).Content } catch { Write-Host '[X] 健康检查失败' }"

echo.
echo ============================================
echo   安装完成！
echo   1. 重启 ZCode（插件目录：%DEST%）
echo   2. 内嵌入口：会话右侧插件市场 → 朱峰无限桌面 → 点「打开」
echo      即在 ZCode 界面内部直接加载无限桌面
echo   3. 兜底：命令面板输入「打开无限桌面」（原生独立窗口）
echo   4. 桥服务运行于 http://127.0.0.1:8791
echo ============================================
pause
