$ErrorActionPreference = "Stop"
$sqlConn = New-Object System.Data.SqlClient.SqlConnection "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;"
$sqlConn.Open()
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;SyncPragma=NORMAL;"
$sqliteConn.Open()

# 查老库材质评论 Cret_Class=12
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT Cret_Id, Cret_ClassId, Cret_UserId, ISNULL(Cret_AddName,'') AS Cret_AddName, CAST(Cret_Content AS nvarchar(max)) AS Cret_Content, CONVERT(varchar(19), Cret_Date, 120) AS Cret_Date FROM Tx_Cret WHERE Cret_Class=12 AND Cret_Flag=1 ORDER BY Cret_Id"
$reader = $sqlCmd.ExecuteReader()

$ins = New-Object System.Data.Odbc.OdbcCommand
$ins.Connection = $sqliteConn
$ins.CommandText = "INSERT OR IGNORE INTO comments (id, target_id, target_type, user_id, author_name, content, created_at) VALUES (?, ?, 'material', ?, ?, ?, ?)"
$ins.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$ins.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$ins.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p3", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$ins.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p4", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$ins.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p5", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$ins.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p6", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null

$tx = $sqliteConn.BeginTransaction()
$ins.Transaction = $tx
$cnt = 0
while ($reader.Read()) {
    $ins.Parameters[0].Value = [int]$reader["Cret_Id"]
    $ins.Parameters[1].Value = [int]$reader["Cret_ClassId"]
    $uid = 0
    if (-not [System.DBNull]::Value.Equals($reader["Cret_UserId"])) { $uid = [int]$reader["Cret_UserId"] }
    $ins.Parameters[2].Value = $uid
    $ins.Parameters[3].Value = [string]$reader["Cret_AddName"]
    if ($ins.Parameters[3].Value -eq "") { $ins.Parameters[3].Value = "匿名" }
    $content = [string]$reader["Cret_Content"]
    if ($null -eq $content) { $content = "" }
    $ins.Parameters[4].Value = $content
    $ins.Parameters[5].Value = [string]$reader["Cret_Date"]
    $ins.ExecuteNonQuery() | Out-Null
    $cnt++
}
$tx.Commit()
$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()
Write-Host "Done: $cnt material comments migrated"
