@echo off
chcp 65001 >nul
rem check_all.bat — 提交前统一护栏检查（分层 + 禁exec + 提示词单源）
rem 用 %~dp0 相对定位，避免中文路径经 set 硬编码后在 cmd 代码页下乱码
cd /d "%~dp0"
set "PY=%~dp0..\..\python\python.exe"
"%PY%" check_layering.py || goto :fail
"%PY%" check_no_exec.py || goto :fail
"%PY%" check_prompt_sync.py || goto :fail
echo [check_all] 全部护栏通过。
exit /b 0
:fail
echo [check_all] 护栏检查未通过，禁止提交。
exit /b 1
