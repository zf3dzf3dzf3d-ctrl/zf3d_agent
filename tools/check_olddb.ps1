$ErrorActionPreference = "Stop"

# Try to attach and query the old SQL Server database
Write-Output "=== Checking SQL Server LocalDB ==="

# Check if LocalDB is available
$localDb = & sqllocaldb info 2>&1
Write-Output "LocalDB instances: $localDb"

# Try to start LocalDB
try {
    $startResult = & sqllocaldb start MSSQLLocalDB 2>&1
    Write-Output "Start result: $startResult"
} catch {
    Write-Output "LocalDB start error: $_"
}

# Check if zf3d_old database exists, if not attach it
$sql = @"
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = 'zf3d_old')
    EXEC sp_detach_db 'zf3d_old', 'true';
GO
CREATE DATABASE zf3d_old ON 
    (FILENAME = N'C:\work\web\data\olddb\zf3ddate.mdf'), 
    (FILENAME = N'C:\work\web\data\olddb\zf3ddate_log.ldf') 
    FOR ATTACH
GO
"@ 

$sql | Out-File -FilePath "C:\work\web\tools\attach_olddb.sql" -Encoding UTF8

# Execute via sqlcmd
$result = & sqlcmd -S "(localdb)\MSSQLLocalDB" -E -i "C:\work\web\tools\attach_olddb.sql" 2>&1
Write-Output "Attach result: $result"

# Query the old database - check download pattern
$query = @"
USE zf3d_old;
SELECT TOP 5 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME;
"@

$query | Out-File -FilePath "C:\work\web\tools\query_olddb.sql" -Encoding UTF8
$result2 = & sqlcmd -S "(localdb)\MSSQLLocalDB" -E -i "C:\work\web\tools\query_olddb.sql" 2>&1
Write-Output "Tables result: $result2"
