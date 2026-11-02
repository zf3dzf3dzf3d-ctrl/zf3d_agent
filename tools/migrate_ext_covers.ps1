<#
.SYNOPSIS
    Migrate cover/thumb from old shipinjiaocheng to external_videos
#>
$ErrorActionPreference = "Stop"

$sqlitePath = "C:\work\web\data\zf3d.db"
$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=$sqlitePath;SyncPragma=NORMAL;"

Write-Host "=== Migrate Ext Video Covers ===" -ForegroundColor Cyan

$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()

$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT id, ISNULL(pic,'') AS pic, ISNULL(s_pic,'') AS s_pic FROM shipinjiaocheng WHERE shenhe=2"
$reader = $sqlCmd.ExecuteReader()

$cmd = New-Object System.Data.Odbc.OdbcCommand
$cmd.Connection = $sqliteConn
$cmd.CommandText = "UPDATE external_videos SET cover=?, thumb=? WHERE source_id=?"
$cmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$cmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$cmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p3", [System.Data.Odbc.OdbcType]::Int))) | Out-Null

$tx = $sqliteConn.BeginTransaction()
$cmd.Transaction = $tx

$total = 0
$updated = 0
while ($reader.Read()) {
    $oldId = [int]$reader["id"]
    $pic = [string]$reader["pic"]
    $sPic = [string]$reader["s_pic"]

    $cmd.Parameters[0].Value = $pic
    $cmd.Parameters[1].Value = $sPic
    $cmd.Parameters[2].Value = $oldId
    $rows = $cmd.ExecuteNonQuery()
    if ($rows -gt 0) { $updated++ }
    $total++
}

$tx.Commit()
$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()

Write-Host "Done! Read: $total, Updated: $updated" -ForegroundColor Green
