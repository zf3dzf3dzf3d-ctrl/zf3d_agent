<#
.SYNOPSIS
    Migrate old Tx_Bbs reply posts to new comments table
#>
$ErrorActionPreference = "Stop"

$sqlitePath = "C:\work\web\data\zf3d.db"
$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=$sqlitePath;SyncPragma=NORMAL;"

Write-Host "=== Migrate Replies ===" -ForegroundColor Cyan

# Connect SQL Server
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()

# Connect SQLite
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()
Write-Host "Connected." -ForegroundColor Gray

# Check columns
$cmd = New-Object System.Data.Odbc.OdbcCommand
$cmd.Connection = $sqliteConn
$cmd.CommandText = "PRAGMA table_info(comments)"
$reader = $cmd.ExecuteReader()
$hasTargetId = $false
$hasTargetType = $false
while ($reader.Read()) {
    $cn = $reader["name"].ToString()
    if ($cn -eq "target_id") { $hasTargetId = $true }
    if ($cn -eq "target_type") { $hasTargetType = $true }
}
$reader.Close()

if (-not $hasTargetId) {
    $cmd.CommandText = "ALTER TABLE comments ADD COLUMN target_id INTEGER"
    $cmd.ExecuteNonQuery() | Out-Null
    Write-Host "  Added target_id" -ForegroundColor Gray
}
if (-not $hasTargetType) {
    $cmd.CommandText = "ALTER TABLE comments ADD COLUMN target_type TEXT DEFAULT 'post'"
    $cmd.ExecuteNonQuery() | Out-Null
    Write-Host "  Added target_type" -ForegroundColor Gray
}

try { $cmd.CommandText = "CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_id, target_type)"; $cmd.ExecuteNonQuery() | Out-Null } catch {}

# Read replies from SQL Server
Write-Host "Reading replies from Tx_Bbs..." -ForegroundColor Gray
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = @"
    SELECT b1.Bbs_Id, b1.Bbs_ClassId, b1.Bbs_UserId,
           ISNULL(b1.Bbs_Add, '') AS Bbs_AddName,
           CAST(b1.Bbs_Content AS nvarchar(max)) AS Bbs_Content,
           CONVERT(varchar(19), b1.Bbs_Date, 120) AS Bbs_Date
    FROM Tx_Bbs b1
    WHERE b1.Bbs_Id <> b1.Bbs_ClassId
      AND (b1.shenhe IS NULL OR b1.shenhe = 0 OR b1.shenhe = 2)
      AND EXISTS(SELECT 1 FROM Tx_Bbs b2 WHERE b2.Bbs_Id = b1.Bbs_ClassId AND b2.Bbs_Id = b2.Bbs_ClassId)
    ORDER BY b1.Bbs_Id
"@
$sqlReader = $sqlCmd.ExecuteReader()

# Insert into SQLite
$total = 0
$batch = 0
$batchSize = 500

$insCmd = New-Object System.Data.Odbc.OdbcCommand
$insCmd.Connection = $sqliteConn
$insCmd.CommandText = "INSERT OR IGNORE INTO comments (id, target_id, target_type, user_id, author_name, content, created_at) VALUES (?, ?, 'post', ?, ?, ?, ?)"
$insCmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p1", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$insCmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p2", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$insCmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p3", [System.Data.Odbc.OdbcType]::Int))) | Out-Null
$insCmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p4", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$insCmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p5", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null
$insCmd.Parameters.Add((New-Object System.Data.Odbc.OdbcParameter("p6", [System.Data.Odbc.OdbcType]::VarChar))) | Out-Null

$tx = $sqliteConn.BeginTransaction()
$insCmd.Transaction = $tx

while ($sqlReader.Read()) {
    $replyId = [int]$sqlReader["Bbs_Id"]
    $classId = [int]$sqlReader["Bbs_ClassId"]
    $userId = 0
    if (-not [System.DBNull]::Value.Equals($sqlReader["Bbs_UserId"])) { $userId = [int]$sqlReader["Bbs_UserId"] }
    $addName = [string]$sqlReader["Bbs_AddName"]
    $content = [string]$sqlReader["Bbs_Content"]
    $date = [string]$sqlReader["Bbs_Date"]

    if ($addName -eq "") { $addName = "匿名" }
    if ($null -eq $content) { $content = "" }

    $insCmd.Parameters[0].Value = $replyId
    $insCmd.Parameters[1].Value = $classId
    $insCmd.Parameters[2].Value = $userId
    $insCmd.Parameters[3].Value = $addName
    $insCmd.Parameters[4].Value = $content
    $insCmd.Parameters[5].Value = $date
    $insCmd.ExecuteNonQuery() | Out-Null

    $total++
    $batch++

    if ($batch -ge $batchSize) {
        $tx.Commit()
        $tx = $sqliteConn.BeginTransaction()
        $insCmd.Transaction = $tx
        $batch = 0
        Write-Host "  $total rows..." -ForegroundColor Gray
    }
}

$tx.Commit()
$sqlReader.Close()
$sqlConn.Close()
$sqliteConn.Close()

Write-Host ""
Write-Host "Done! Total: $total replies migrated" -ForegroundColor Green
