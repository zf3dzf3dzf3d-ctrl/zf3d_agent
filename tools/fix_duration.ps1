# Fix duration field - re-read shijian from old SQL Server and format properly
# datetime like 1899-12-30 00:25:38 -> "25:38"

$ErrorActionPreference = "Stop"

$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;SyncPragma=NORMAL;"

Write-Host "Connecting..."
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()

# Read from SQL Server
$cmd = $sqlConn.CreateCommand()
$cmd.CommandText = "SELECT Products_Id, shijian FROM Tx_Products WHERE shijian IS NOT NULL"
$reader = $cmd.ExecuteReader()

$updateCmd = New-Object System.Data.Odbc.OdbcCommand("", $sqliteConn)
$tx = $sqliteConn.BeginTransaction()
$updateCmd.Transaction = $tx

$count = 0
while ($reader.Read()) {
    $prodId = [int]$reader["Products_Id"]
    $dt = $reader["shijian"]
    if ($null -eq $dt -or $dt -is [DBNull]) { continue }

    $h = $dt.Hour
    $m = $dt.Minute
    $s = $dt.Second

    if ($h -gt 0) {
        $dur = "{0}:{1:D2}:{2:D2}" -f $h, $m, $s
    } else {
        $dur = "{0}:{1:D2}" -f $m, $s
    }

    $updateCmd.CommandText = "UPDATE tutorials SET duration='$dur' WHERE id=$prodId"
    [void]$updateCmd.ExecuteNonQuery()
    $count++

    if ($count % 1000 -eq 0) {
        $tx.Commit()
        $tx = $sqliteConn.BeginTransaction()
        $updateCmd.Transaction = $tx
        Write-Host "  $count..."
    }
}

$tx.Commit()
$reader.Close()
Write-Host "Updated $count records"

# Verify
$cmd2 = New-Object System.Data.Odbc.OdbcCommand("SELECT duration FROM tutorials WHERE duration IS NOT NULL AND duration != '' LIMIT 10", $sqliteConn)
$r = $cmd2.ExecuteReader()
Write-Host "`nSample durations:"
while ($r.Read()) { Write-Host "  $($r['duration'].ToString())" }
$r.Close()

$sqlConn.Close()
$sqliteConn.Close()
Write-Host "Done."
