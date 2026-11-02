<#
.SYNOPSIS
    迁移素材下载字段 (xinbaidushucai / xinbaidushucaiyanzhengma)
.DESCRIPTION
    从SQL Server LocalDB (zf3ddate_old) 读取Tx_Products的素材下载字段，
    更新到SQLite tutorials表的 xinbaidushucai / xinbaidushucai_pass
#>

$ErrorActionPreference = "Stop"

$sqlitePath = "C:\work\web\data\zf3d.db"
$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3d_old;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=$sqlitePath;SyncPragma=NORMAL;"

Write-Host "=== 迁移素材下载字段 ===" -ForegroundColor Cyan

# 连接SQL Server
Write-Host "连接 SQL Server..." -ForegroundColor Gray
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()

# 读取老库的素材下载字段
Write-Host "读取 Tx_Products 素材字段..." -ForegroundColor Gray
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = @"
    SELECT Products_Id, 
           ISNULL(NULLIF(LTRIM(RTRIM(xinbaidushucai)), ''), '') AS xinbaidushucai,
           ISNULL(NULLIF(LTRIM(RTRIM(xinbaidushucaiyanzhengma)), ''), '') AS xinbaidushucaiyanzhengma
    FROM Tx_Products 
    WHERE xinbaidushucai IS NOT NULL AND LTRIM(RTRIM(xinbaidushucai)) <> ''
"@
$reader = $sqlCmd.ExecuteReader()

# 连接SQLite
Write-Host "连接 SQLite..." -ForegroundColor Gray
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()

# 使用参数化查询
$upd = New-Object System.Data.Odbc.OdbcCommand
$upd.Connection = $sqliteConn
$upd.CommandText = "UPDATE tutorials SET xinbaidushucai=?, xinbaidushucai_pass=? WHERE id=?"
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$upd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p3", [System.Data.Odbc.OdbcType]::Int))) | Out-Null

$tx = $sqliteConn.BeginTransaction()
$upd.Transaction = $tx

$total = 0
$updated = 0
$skipped = 0

while ($reader.Read()) {
    $id = [int]$reader["Products_Id"]
    $sucai = [string]$reader["xinbaidushucai"]
    $sucaiPass = [string]$reader["xinbaidushucaiyanzhengma"]
    
    $total++

    $upd.Parameters[0].Value = $sucai
    $upd.Parameters[1].Value = $sucaiPass
    $upd.Parameters[2].Value = $id
    $rows = $upd.ExecuteNonQuery()
    if ($rows -gt 0) {
        $updated++
    } else {
        $skipped++
    }
}

$tx.Commit()
$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()

Write-Host ""
Write-Host "完成!" -ForegroundColor Green
Write-Host "  总计读取: $total"
Write-Host "  成功更新: $updated"
Write-Host "  跳过(新库无此ID): $skipped"
