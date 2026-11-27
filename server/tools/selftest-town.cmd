@echo off
REM selftest-town.cmd - town power-on probe (logic in selftest_town.py, UTF-8)
REM avoid cmd CJK path encoding trap: keep this file pure ASCII
set PY=%~dp0..\..\python\python.exe
"%PY%" "%~dp0selftest_town.py"
exit /b %ERRORLEVEL%
