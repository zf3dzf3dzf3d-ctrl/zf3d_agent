@echo off
chcp 65001 >nul
REM ============================================================
REM  以调试模式启动 Chrome（供 AI 通过 CDP 实时接管联动）
REM  用法：双击本文件。之后 AI 的浏览器操作会直接发生在你眼前的 Chrome 窗口里。
REM  注意：老 Chrome 进程会忽略调试端口参数，所以必须先关干净。
REM ============================================================
set PORT=9222
set PROFILE=%LOCALAPPDATA%\ZhufengChromeDebug

REM 先提示并等待用户确认（会强制关闭所有 Chrome，包括你日常浏览的窗口）
echo [1/2] 即将关闭所有 Chrome 进程（含日常浏览窗口，未保存内容会丢失）。
choice /C YN /M "继续请按 Y，取消按 N" 
if errorlevel 2 exit /b 1
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM 找到 Chrome 路径并启动
echo [2/2] 正在启动调试模式 Chrome (端口 %PORT%)...
set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" (
    echo 未找到 Chrome，请修改本文件中的 CHROME 路径。
    pause
    exit /b 1
)

start "" "%CHROME%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check

echo.
echo 完成！Chrome 已带调试端口启动。
echo （使用独立 profile: %PROFILE%，与日常浏览互不干扰，但 AI 可操作此窗口内登录的站点）
echo 关闭本窗口不影响 Chrome 运行。
timeout /t 5 >nul
