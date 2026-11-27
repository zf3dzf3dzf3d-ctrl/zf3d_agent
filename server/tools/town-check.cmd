@echo off 
REM i-town S1 self-check 2026-11-18 
echo === [1/2] GET /api/town/events === 
curl -s "http://127.0.0.1:8620/api/town/events" 
echo. 
echo === [2/2] GET /api/town/memories === 
curl -s "http://127.0.0.1:8620/api/town/memories" 
echo === verdict: JSON has events=powered; 404=backend-not-restarted === 
pause
