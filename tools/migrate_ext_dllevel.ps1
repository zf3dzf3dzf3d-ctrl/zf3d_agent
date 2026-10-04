$ErrorActionPreference = "Stop"
$sqlConn = New-Object System.Data.SqlClient.SqlConnection "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;"
$sqlConn.Open()
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;SyncPragma=NORMAL;"
$sqliteConn.Open()
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT id, ISNULL(quanxian,0) AS quanxian FROM shipinjiaocheng WHERE shenhe=2"
$reader = $sqlCmd.ExecuteReader()
$upd = New-Object System.Data.Odbc.OdbcCommand
$upd.Connection = $sqliteConn
$upd.CommandText = "UPDATE external_videos SET download_level=? WHERE source_id=?"
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$tx = $sqliteConn.BeginTransaction()
$upd.Transaction = $tx
$cnt = 0
while ($reader.Read()) {
    $upd.Parameters[0].Value = [int]$reader["quanxian"]
    $upd.Parameters[1].Value = [int]$reader["id"]
    $upd.ExecuteNonQuery() | Out-Null
    $cnt++
}
$tx.Commit()
$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()
Write-Host "Done: $cnt rows"
