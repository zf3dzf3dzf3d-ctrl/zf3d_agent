@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ============================================
echo   ZF3D Agent Server Deployment
echo   For: Windows Server 2012 R2 / 2016 / 2019
echo ============================================
echo.

:: === Step 1: Find PowerShell ===
set "PS_EXE="
where powershell.exe >nul 2>nul && set "PS_EXE=powershell.exe"
if not defined PS_EXE if exist "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" set "PS_EXE=C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

if not defined PS_EXE goto :no_powershell
echo [1/5] PowerShell: OK
echo.

:: === Step 2: Check VC++ Runtime (UCRT) ===
if exist "C:\Windows\System32\api-ms-win-crt-runtime-l1-1-0.dll" (
    echo [2/5] VC++ Runtime: OK
    goto :find_python
)

echo [2/5] VC++ Runtime missing, will try to install...
set "VCR_EXE=%TEMP%\vc_redist.x64.exe"
set "VCR_URL=https://aka.ms/vs/17/release/vc_redist.x64.exe"

if not exist "!VCR_EXE!" (
    echo   Downloading VC++ Redistributable 25MB...
    echo   From Microsoft server, may be slow. Please wait...
    "!PS_EXE!" -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '!VCR_URL!' -OutFile '!VCR_EXE!' -TimeoutSec 600 } catch { Write-Host $_.Exception.Message; exit 1 }"
)

if exist "!VCR_EXE!" (
    echo   Running VC++ installer...
    "!VCR_EXE!" /passive /norestart
)

if exist "C:\Windows\System32\api-ms-win-crt-runtime-l1-1-0.dll" (
    echo   VC++ Runtime installed successfully.
    goto :ucrt_done
)

:: --- Fallback 1: Try dism with cached MSU ---
echo   Installer did not apply update, trying DISM...
set "MSU_FILE="
for /r "C:\ProgramData\Package Cache" %%f in (Windows8.1-KB2999226-x64.msu) do (
    if not defined MSU_FILE set "MSU_FILE=%%f"
)

if defined MSU_FILE (
    echo   Found cached update, installing via DISM...
    dism /online /add-package /packagepath:"!MSU_FILE!" /norestart /quiet 2>nul
)

if exist "C:\Windows\System32\api-ms-win-crt-runtime-l1-1-0.dll" (
    echo   UCRT installed via DISM.
    goto :ucrt_done
)

:: --- Fallback 2: Extract DLLs from cached MSU ---
echo   DISM failed, extracting DLLs directly...
set "UCRT_TEMP=%TEMP%\ucrt_dll"
if exist "!UCRT_TEMP!" rmdir /s /q "!UCRT_TEMP!"
mkdir "!UCRT_TEMP!"

if defined MSU_FILE (
    echo   Extracting from: !MSU_FILE!
    expand "!MSU_FILE!" /F:* "!UCRT_TEMP!" >nul 2>nul

    set "PAYLOAD_CAB="
    for /r "!UCRT_TEMP!" %%f in (*.cab) do (
        if not defined PAYLOAD_CAB set "PAYLOAD_CAB=%%f"
    )

    if defined PAYLOAD_CAB (
        mkdir "!UCRT_TEMP!\dlls" 2>nul
        expand "!PAYLOAD_CAB!" /F:* "!UCRT_TEMP!\dlls" >nul 2>nul

        set "UCRT_COPIED=0"
        for /r "!UCRT_TEMP!\dlls" %%f in (ucrtbase.dll) do (
            copy /y "%%f" "C:\Windows\System32\" >nul 2>nul
            set "UCRT_COPIED=1"
        )
        for /r "!UCRT_TEMP!\dlls" %%f in (api-ms-win-crt-*.dll) do (
            copy /y "%%f" "C:\Windows\System32\" >nul 2>nul
            set "UCRT_COPIED=1"
        )

        if "!UCRT_COPIED!"=="1" (
            echo   UCRT DLLs extracted and copied to System32.
        )
    )
    rmdir /s /q "!UCRT_TEMP!" >nul 2>nul
)

if exist "C:\Windows\System32\api-ms-win-crt-runtime-l1-1-0.dll" goto :ucrt_done

:: --- Fallback 3: Download DLLs directly ---
echo   Trying direct DLL download...
set "DLL_URL=https://github.com/nicehash/NiceHashQuickMiner/raw/main/ucrt/"
set "UCRT_TEMP=%TEMP%\ucrt_dll"
if not exist "!UCRT_TEMP!" mkdir "!UCRT_TEMP!"

"!PS_EXE!" -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $wc = New-Object System.Net.WebClient; $wc.DownloadFile('https://raw.githubusercontent.com/nicehash/NiceHashQuickMiner/main/ucrt/ucrtbase.dll', '!UCRT_TEMP!\ucrtbase.dll')" 2>nul

if exist "!UCRT_TEMP!\ucrtbase.dll" (
    copy /y "!UCRT_TEMP!\ucrtbase.dll" "C:\Windows\System32\" >nul 2>nul
    echo   ucrtbase.dll copied.
) else (
    echo   [ERROR] Cannot install UCRT automatically.
    echo.
    echo   Manual fix:
    echo   1. On a working Windows PC, copy these from C:\Windows\System32\
    echo      - ucrtbase.dll
    echo      - api-ms-win-crt-runtime-l1-1-0.dll
    echo      - api-ms-win-crt-*.dll  all files with this prefix
    echo   2. Paste them into server C:\Windows\System32\
    echo   3. Re-run deploy.bat
    echo.
    pause
    exit /b 1
)

:ucrt_done
echo.
echo   VC++ Runtime: OK
echo.

:: === Step 3: Find or install Python ===
:find_python
set "PYTHON="
for %%V in (311 310 39 38 37) do (
    if not defined PYTHON if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
    if not defined PYTHON if exist "C:\Python%%V\python.exe" set "PYTHON=C:\Python%%V\python.exe"
)
if not defined PYTHON py -3 -c "import sys; exit(0)" >nul 2>nul && set "PYTHON=py -3"
if not defined PYTHON python -c "import sys; exit(0) if sys.version_info[0]>=3 else exit(1)" >nul 2>nul && set "PYTHON=python"

if not defined PYTHON goto :install_python

"!PYTHON!" -c "import sys; print(sys.version)" >nul 2>nul
if !errorlevel! equ 0 goto :python_found

echo [3/5] Python found but cannot start (missing DLLs), reinstalling...
if exist "%LOCALAPPDATA%\Programs\Python\Python39" rmdir /s /q "%LOCALAPPDATA%\Programs\Python\Python39"
set "PYTHON="
goto :install_python

:python_found
echo [3/5] Python found: !PYTHON!
for /f "delims=" %%v in ('!PYTHON! -c "import sys; print(sys.version.split()[0])"') do echo   Version: %%v
goto :install_deps

:: --- Install Python (embeddable zip) ---
:install_python
echo.
echo [3/5] Downloading Python 3.9.13 (embeddable)...
echo   No installer needed - just extract and use
echo.

set "PY_ZIP=%TEMP%\python-3.9.13-embed.zip"
set "PY_DIR=%LOCALAPPDATA%\Programs\Python\Python39"
set "PY_MIRROR=https://mirrors.huaweicloud.com/python/3.9.13/python-3.9.13-embed-amd64.zip"
set "PY_URL=https://www.python.org/ftp/python/3.9.13/python-3.9.13-embed-amd64.zip"

echo   Downloading from mirror - huaweicloud...
"!PS_EXE!" -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '!PY_MIRROR!' -OutFile '!PY_ZIP!' -TimeoutSec 300 } catch { Write-Host $_.Exception.Message; exit 1 }"

if !errorlevel! equ 0 goto :extract_python
echo   Mirror failed, trying python.org...
"!PS_EXE!" -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '!PY_URL!' -OutFile '!PY_ZIP!' -TimeoutSec 600 } catch { Write-Host $_.Exception.Message; exit 1 }"

if !errorlevel! equ 0 goto :extract_python
echo   Trying WebClient...
"!PS_EXE!" -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $wc = New-Object System.Net.WebClient; $wc.DownloadFile('!PY_MIRROR!', '!PY_ZIP!')"

if not exist "!PY_ZIP!" (
    echo   [ERROR] Download failed
    echo   Please download manually: !PY_URL!
    echo.
    pause
    exit /b 1
)

:extract_python
echo   Download complete. Extracting...
if exist "!PY_DIR!" rmdir /s /q "!PY_DIR!"
"!PS_EXE!" -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('!PY_ZIP!', '!PY_DIR!')"

if not exist "!PY_DIR!\python.exe" (
    echo   [ERROR] Extraction failed
    pause
    exit /b 1
)

echo   Enabling site-packages...
"!PS_EXE!" -Command "(Get-Content '!PY_DIR!\python39._pth') -replace '#import site','import site' | Set-Content '!PY_DIR!\python39._pth'"

set "PYTHON=!PY_DIR!\python.exe"
set "PATH=!PY_DIR!;!PY_DIR!\Scripts;!PATH!"

"!PYTHON!" -c "import sys; print(sys.version)" >nul 2>nul
if !errorlevel! neq 0 (
    echo   [ERROR] Python failed to start - missing system DLLs
    echo   Please reboot the server and re-run deploy.bat
    echo.
    pause
    exit /b 1
)

echo   Installing pip...
"!PS_EXE!" -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/pip/3.9/get-pip.py' -OutFile '!TEMP!\get-pip.py' -TimeoutSec 120"
"!PYTHON!" "!TEMP!\get-pip.py" -q 2>nul
del "!TEMP!\get-pip.py" >nul 2>nul
del "!PY_ZIP!" >nul 2>nul

if not exist "!PY_DIR!\Scripts\pip.exe" (
    echo   [WARN] pip bootstrap failed, trying ensurepip...
    "!PYTHON!" -m ensurepip --upgrade 2>nul
)

echo   Python 3.9.13 ready: !PYTHON!
goto :install_deps

:: === Step 4: Install dependencies ===
:install_deps
echo.
echo [4/5] Installing dependencies...
echo   Please wait...
echo.

!PYTHON! -m pip install --upgrade pip -q 2>nul

echo   Installing core packages...
!PYTHON! -m pip install python-docx openpyxl olefile Pillow psutil -q 2>nul
if !errorlevel! equ 0 goto :core_deps_ok
echo   Some packages failed, trying one by one...
!PYTHON! -m pip install python-docx -q 2>nul
!PYTHON! -m pip install openpyxl -q 2>nul
!PYTHON! -m pip install olefile -q 2>nul
!PYTHON! -m pip install Pillow -q 2>nul
!PYTHON! -m pip install psutil -q 2>nul

:core_deps_ok
echo   Installing optional packages...
!PYTHON! -m pip install edge-tts pygame pywin32 -q 2>nul

set "DEPS_OK=1"
!PYTHON! -c "import docx" >nul 2>nul
if !errorlevel! neq 0 echo   [WARN] python-docx not installed & set "DEPS_OK=0"
!PYTHON! -c "import openpyxl" >nul 2>nul
if !errorlevel! neq 0 echo   [WARN] openpyxl not installed & set "DEPS_OK=0"
!PYTHON! -c "import PIL" >nul 2>nul
if !errorlevel! neq 0 echo   [WARN] Pillow not installed & set "DEPS_OK=0"
!PYTHON! -c "import psutil" >nul 2>nul
if !errorlevel! neq 0 echo   [WARN] psutil not installed & set "DEPS_OK=0"

if "!DEPS_OK!"=="1" echo   All core dependencies: OK
if not "!DEPS_OK!"=="1" echo   [WARN] Some dependencies missing
echo.

:: === Step 5: Check launcher ===
echo [5/5] Checking start_server.bat...
if exist "%~dp0start_server.bat" goto :launcher_ok
echo   [ERROR] start_server.bat not found
echo   Make sure start_server.bat is in the same folder.
goto :done

:launcher_ok
echo   start_server.bat: OK

:done
echo.
echo ============================================
echo   Deploy complete
echo ============================================
echo.
echo   Next steps:
echo   1. Edit API Key in config files
echo   2. Start: double-click start_server.bat
echo.
echo   Python: !PYTHON!
echo.
pause
endlocal
exit /b 0

:no_powershell
echo [ERROR] PowerShell not found
echo PowerShell is required for deployment.
echo.
pause
exit /b 1
