@echo off
rem ZF hygiene weekly checkup - runs tools/hygiene_check.py, appends report to private/
rem ASCII-only + relative pathing (%~dp0) so cmd/GBK codepage never mangles the repo path.
cd /d "%~dp0.."
"python\python.exe" "tools\hygiene_check.py" --out "private\hygiene_report.log"
