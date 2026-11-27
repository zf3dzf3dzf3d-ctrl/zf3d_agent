@echo off
rem run_gate.bat — 在项目根目录下执行（cwd 已由调用方保证）
python\python.exe -X utf8 server\chess_engine\selfplay_gate.py 100 > server\chess_engine\gate_result.txt 2>&1
echo EXITCODE=%ERRORLEVEL%
type server\chess_engine\gate_result.txt
