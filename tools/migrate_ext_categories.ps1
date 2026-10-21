<#
.SYNOPSIS
    Migrate category_id and software_id from old shipinjiaocheng table to external_videos
#>
$ErrorActionPreference = "Stop"

$sqlitePath = "C:\work\web\data\zf3d.db"
$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=$sqlitePath;SyncPragma=NORMAL;"

Write-Host "=== Migrate Ext Video Categories ===" -ForegroundColor Cyan

$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()

Write-Host "Reading from shipinjiaocheng..." -ForegroundColor Gray
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT id, ISNULL(fenlei,0) AS fenlei, ISNULL(ruanjian,0) AS ruanjian FROM shipinjiaocheng WHERE shenhe=2"
$reader = $sqlCmd.ExecuteReader()

$cmd = New-Object System.Data.Odbc.OdbcCommand
$cmd.Connection = $sqliteConn
$cmd.CommandText = "UPDATE external_videos SET category_id=?, software_id=? WHERE source_id=?"

$cmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$cmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$cmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p3", [System.Data.Odbc.OdbcType]::Int))) | Out-Null

$tx = $sqliteConn.BeginTransaction()
$cmd.Transaction = $tx

$total = 0
$updated = 0
while ($reader.Read()) {
    $oldId = [int]$reader["id"]
    $fenlei = 0
    if (-not [System.DBNull]::Value.Equals($reader["fenlei"])) { $fenlei = [int]$reader["fenlei"] }
    $ruanjianStr = "0"
    if (-not [System.DBNull]::Value.Equals($reader["ruanjian"])) {
        $rjStr = [string]$reader["ruanjian"]
        # ruanjian is comma-separated, take first value
        $rjParts = $rjStr -split ","
        $ruanjianStr = $rjParts[0].Trim()
        if (-not ($ruanjianStr -match '^\d+$')) { $ruanjianStr = "0" }
    }
    $ruanjian = [int]$ruanjianStr

    $cmd.Parameters[0].Value = $fenlei
    $cmd.Parameters[1].Value = $ruanjian
    $cmd.Parameters[2].Value = $oldId
    $rows = $cmd.ExecuteNonQuery()
    if ($rows -gt 0) { $updated++ }
    $total++
}

$tx.Commit()
$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()

Write-Host ""
Write-Host "Done! Read: $total, Updated: $updated" -ForegroundColor Green
