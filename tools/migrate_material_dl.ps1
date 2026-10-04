$ErrorActionPreference = "Stop"
$sqlConn = New-Object System.Data.SqlClient.SqlConnection "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;"
$sqlConn.Open()
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;SyncPragma=NORMAL;"
$sqliteConn.Open()

$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT id, ISNULL(baidu,'') AS baidu, ISNULL(baidu_mima,'') AS baidu_mima, ISNULL(jiage,0) AS jiage, ISNULL(guanzhudu,0) AS guanzhudu FROM map"
$reader = $sqlCmd.ExecuteReader()

$upd = New-Object System.Data.Odbc.OdbcCommand
$upd.Connection = $sqliteConn
$upd.CommandText = "UPDATE material_maps SET baidu_url=?, baidu_password=?, price=?, views=? WHERE id=?"
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p3", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p4", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p5", [System.Data.Odbc.OdbcType]::Int))) | Out-Null

$tx = $sqliteConn.BeginTransaction()
$upd.Transaction = $tx
$cnt = 0
while ($reader.Read()) {
    $upd.Parameters[0].Value = [string]$reader["baidu"]
    $upd.Parameters[1].Value = [string]$reader["baidu_mima"]
    $upd.Parameters[2].Value = [int]$reader["jiage"]
    $upd.Parameters[3].Value = [int]$reader["guanzhudu"]
    $upd.Parameters[4].Value = [int]$reader["id"]
    $upd.ExecuteNonQuery() | Out-Null
    $cnt++
}
$tx.Commit()
$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()
Write-Host "Done: $cnt materials updated"
