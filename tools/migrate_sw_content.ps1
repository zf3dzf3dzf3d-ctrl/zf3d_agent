$ErrorActionPreference = "Stop"
$sqlConn = New-Object System.Data.SqlClient.SqlConnection "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;"
$sqlConn.Open()
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;SyncPragma=NORMAL;"
$sqliteConn.Open()
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT Products_Id, CAST(Products_Content AS nvarchar(max)) AS content, ISNULL(Products_Count,0) AS views FROM Tx_Products WHERE rls=2"
$reader = $sqlCmd.ExecuteReader()
$upd = New-Object System.Data.Odbc.OdbcCommand
$upd.Connection = $sqliteConn
$upd.CommandText = "UPDATE tutorials SET description=?, view_count=? WHERE id=?"
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p3", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$tx = $sqliteConn.BeginTransaction()
$upd.Transaction = $tx
$cnt = 0
while ($reader.Read()) {
    $content = [string]$reader["content"]
    $views = [int]$reader["views"]
    $id = [int]$reader["Products_Id"]
    if ($null -eq $content) { $content = "" }
    $upd.Parameters[0].Value = $content
    $upd.Parameters[1].Value = $views
    $upd.Parameters[2].Value = $id
    $upd.ExecuteNonQuery() | Out-Null
    $cnt++
}
$tx.Commit()
$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()
Write-Host "Done: $cnt rows"
