<#
.SYNOPSIS
    补充迁移模型帖子的下载字段 (baidu/filelocal1/baidu_mima/xiazaidengji)
.DESCRIPTION
    从SQL Server LocalDB (zf3ddate) 读取Tx_Bbs的下载相关字段，
    更新到SQLite posts表的download_url/download_password/download_level
    只处理 board_id IN (48-60) 的模型帖子（Bbs_Id = Bbs_ClassId 为主帖）
#>

$ErrorActionPreference = "Stop"

$sqlitePath = "C:\work\web\data\zf3d.db"
$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=$sqlitePath;SyncPragma=NORMAL;"

Write-Host "=== 迁移下载字段 ===" -ForegroundColor Cyan

# 连接SQL Server
Write-Host "连接 SQL Server..." -ForegroundColor Gray
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()

# 读取老库的下载字段（只读主帖 Bbs_Id=Bbs_ClassId）
Write-Host "读取 Tx_Bbs 下载字段..." -ForegroundColor Gray
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = @"
    SELECT Bbs_Id, 
           ISNULL(NULLIF(LTRIM(RTRIM(baidu)), ''), '') AS baidu,
           ISNULL(NULLIF(LTRIM(RTRIM(filelocal1)), ''), '') AS filelocal1,
           ISNULL(NULLIF(LTRIM(RTRIM(baidu_mima)), ''), '') AS baidu_mima,
           ISNULL(xiazaidengji, 0) AS xiazaidengji
    FROM Tx_Bbs 
    WHERE Bbs_Id = Bbs_ClassId 
      AND Bbs_Board IN (48,49,50,51,52,53,54,55,56,57,58,59,60)
      AND (baidu IS NOT NULL AND LTRIM(RTRIM(baidu)) <> ''
           OR filelocal1 IS NOT NULL AND LTRIM(RTRIM(filelocal1)) <> '')
"@
$reader = $sqlCmd.ExecuteReader()

# 连接SQLite
Write-Host "连接 SQLite..." -ForegroundColor Gray
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()

# 统计
$total = 0
$updated = 0
$skipped = 0

while ($reader.Read()) {
    $id = [int]$reader["Bbs_Id"]
    $baidu = [string]$reader["baidu"]
    $filelocal1 = [string]$reader["filelocal1"]
    $baiduMima = [string]$reader["baidu_mima"]
    $xiazaidengji = [int]$reader["xiazaidengji"]
    
    # 优先用百度链接，没有则用本地链接
    $dlUrl = if ($baidu -ne '') { $baidu } else { $filelocal1 }
    
    # 转义单引号
    $dlUrl = $dlUrl.Replace("'", "''")
    $baiduMima = $baiduMima.Replace("'", "''")
    
    $total++

    $updateSql = "UPDATE posts SET download_url='$dlUrl', download_password='$baiduMima', download_level=$xiazaidengji WHERE id=$id"
    $cmd = New-Object System.Data.Odbc.OdbcCommand($updateSql, $sqliteConn)
    $rows = $cmd.ExecuteNonQuery()
    if ($rows -gt 0) {
        $updated++
    } else {
        $skipped++
    }
}

$reader.Close()
$sqlConn.Close()
$sqliteConn.Close()

Write-Host ""
Write-Host "完成!" -ForegroundColor Green
Write-Host "  总计读取: $total"
Write-Host "  成功更新: $updated"
Write-Host "  跳过(新库无此ID): $skipped"
