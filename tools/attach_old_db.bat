@echo off
REM Attach old database to LocalDB
sqlcmd -S "(localdb)\MSSQLLocalDB" -Q "CREATE DATABASE zf3d_old ON (FILENAME = 'C:\work\web\data\老数据\zf3ddate - 副本 (2).mdf'), (FILENAME = 'C:\work\web\data\老数据\zf3ddate_log - 副本 (2).ldf') FOR ATTACH" 2>&1
echo Exit code: %ERRORLEVEL%
