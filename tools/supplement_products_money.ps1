<#
.SYNOPSIS
    Supplement Products_Money and other missing fields to SQLite
.DESCRIPTION
    Reads Products_Money, s_Products_Pic, shijian from old SQL Server Tx_Products,
    and quanxian from shipinjiaocheng, writes to SQLite tutorials table
    columns access_type, thumbnail, duration, and syncs is_free.

    access_type mapping:
      1 = Free
      2 = VIP
      3 = Share-to-unlock
      4 = Comment-to-unlock
      5 = Separate purchase

.NOTES
    Prerequisites:
    1. SQL Server LocalDB with zf3ddate database attached
    2. SQLite3 ODBC Driver installed
#>

param(
    [string]$SqlitePath = "C:\work\web\data\zf3d.db"
)

$ErrorActionPreference = "Stop"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ====== 连接字符串 ======
$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=$SqlitePath;SyncPragma=NORMAL;"

# ====== 辅助函数 ======
function Esc($v) {
    if ($null -eq $v -or $v -is [DBNull]) { return "''" }
    $s = [string]$v
    $s = $s.Replace("'", "''")
    return "'$s'"
}

function EscInt($v) {
    if ($null -eq $v -or $v -is [DBNull]) { return "0" }
    try { return [string][int]$v } catch { return "0" }
}

# datetime → "分:秒" 格式
function FormatDuration($dt) {
    if ($null -eq $dt -or $dt -is [DBNull]) { return "" }
    try {
        $hours = $dt.Hour
        $mins = $dt.Minute
        $secs = $dt.Second
        if ($hours -gt 0) {
            return "${hours}:${mins.ToString('D2')}:${secs.ToString('D2')}"
        } else {
            return "${mins}:${secs.ToString('D2')}"
        }
    } catch { return "" }
}

# ====== 1. 打开连接 ======
Write-Host "[1/6] Connecting databases..." -ForegroundColor Cyan
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()

$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()

# ====== 2. 加列（如果不存在） ======
Write-Host "[2/6] Checking and adding columns..." -ForegroundColor Cyan

# Check existing columns by reading PRAGMA table_info
$checkCmd = New-Object System.Data.Odbc.OdbcCommand("PRAGMA table_info(tutorials)", $sqliteConn)
$checkRs = $checkCmd.ExecuteReader()
$existingCols = @{}
while ($checkRs.Read()) {
    $colName = $checkRs.GetString(1)  # column index 1 = name
    $existingCols[$colName] = $true
}
$checkRs.Close()

$columnsToAdd = @(
    @{ name = "access_type"; sql = "ALTER TABLE tutorials ADD COLUMN access_type INTEGER DEFAULT 2" }
    @{ name = "duration";    sql = "ALTER TABLE tutorials ADD COLUMN duration TEXT" }
    @{ name = "thumbnail";   sql = "ALTER TABLE tutorials ADD COLUMN thumbnail TEXT" }
)

foreach ($col in $columnsToAdd) {
    if (-not $existingCols.ContainsKey($col.name)) {
        (New-Object System.Data.Odbc.OdbcCommand($col.sql, $sqliteConn)).ExecuteNonQuery()
        Write-Host "  + Added column: $($col.name)" -ForegroundColor Green
    } else {
        Write-Host "  = Column exists: $($col.name)" -ForegroundColor Yellow
    }
}

# ====== 3. 补迁 Tx_Products 的 Products_Money ======
Write-Host "[3/6] Migrating Tx_Products.Products_Money (6962 records)..." -ForegroundColor Cyan

$cmd = $sqlConn.CreateCommand()
$cmd.CommandText = "SELECT Products_Id, Products_Money, s_Products_Pic, shijian FROM Tx_Products ORDER BY Products_Id"
$reader = $cmd.ExecuteReader()

$updateCmd = New-Object System.Data.Odbc.OdbcCommand("", $sqliteConn)
$tx = $sqliteConn.BeginTransaction()
$updateCmd.Transaction = $tx

$count = 0
while ($reader.Read()) {
    $id = [int]$reader["Products_Id"]
    $money = $reader["Products_Money"]
    if ($null -eq $money -or $money -is [DBNull]) { $money = "2" }  # 默认VIP
    $accessType = 0
    try { $accessType = [int]$money } catch { $accessType = 2 }

    # 同步 is_free: access_type=1 → is_free=1, 其余 → is_free=0
    $isFree = if ($accessType -eq 1) { 1 } else { 0 }

    $thumb = $reader["s_Products_Pic"]
    $dur = FormatDuration $reader["shijian"]

    $updateCmd.CommandText = "UPDATE tutorials SET access_type=$accessType, is_free=$isFree, thumbnail=$(Esc $thumb), duration=$(Esc $dur) WHERE id=$id"
    try {
        $updateCmd.ExecuteNonQuery()
        $count++
    } catch {
        Write-Host "  ! Error id=$id : $_" -ForegroundColor Red
    }

    if ($count % 1000 -eq 0 -and $count -gt 0) {
        $tx.Commit()
        $tx = $sqliteConn.BeginTransaction()
        $updateCmd.Transaction = $tx
        Write-Host "  $count ..." -NoNewline
    }
}

$tx.Commit()
$reader.Close()
Write-Host "`n  [OK] Tx_Products done: $count records" -ForegroundColor Green

# ====== 4. 补迁 shipinjiaocheng 的 quanxian ======
Write-Host "[4/6] Migrating shipinjiaocheng.quanxian (1149 records)..." -ForegroundColor Cyan

# shipinjiaocheng 的 id+100000 对应 SQLite tutorials.id
# quanxian 映射: 3=免费(1), 其余=VIP(2)
$cmd = $sqlConn.CreateCommand()
$cmd.CommandText = "SELECT id, quanxian FROM shipinjiaocheng WHERE shenhe=2 ORDER BY id"
$reader = $cmd.ExecuteReader()

$updateCmd = New-Object System.Data.Odbc.OdbcCommand("", $sqliteConn)
$tx = $sqliteConn.BeginTransaction()
$updateCmd.Transaction = $tx

$count2 = 0
while ($reader.Read()) {
    $origId = [int]$reader["id"]
    $sqliteId = $origId + 100000
    $quanxian = $reader["quanxian"]
    if ($null -eq $quanxian -or $quanxian -is [DBNull]) { $quanxian = 2 }

    $accessType = if ([int]$quanxian -eq 3) { 1 } else { 2 }
    $isFree = if ($accessType -eq 1) { 1 } else { 0 }

    $updateCmd.CommandText = "UPDATE tutorials SET access_type=$accessType, is_free=$isFree WHERE id=$sqliteId"
    try {
        $updateCmd.ExecuteNonQuery()
        $count2++
    } catch {
        Write-Host "  ! Error id=$sqliteId : $_" -ForegroundColor Red
    }
}

$tx.Commit()
$reader.Close()
Write-Host "  [OK] shipinjiaocheng done: $count2 records" -ForegroundColor Green

# ====== 5. 验证数据分布 ======
Write-Host "`n[5/6] Verifying data distribution..." -ForegroundColor Cyan

$verifySqls = @(
    "SELECT access_type, COUNT(*) as cnt FROM tutorials GROUP BY access_type ORDER BY access_type",
    "SELECT is_free, COUNT(*) as cnt FROM tutorials GROUP BY is_free ORDER BY is_free"
)

foreach ($sql in $verifySqls) {
    $cmd = New-Object System.Data.Odbc.OdbcCommand($sql, $sqliteConn)
    $r = $cmd.ExecuteReader()
    while ($r.Read()) {
        Write-Host ("  access_type/is_free = " + $r[0].ToString() + " | " + $r[1].ToString())
    }
    $r.Close()
}

# 抽查 duration 和 thumbnail
$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT id, access_type, duration, thumbnail FROM tutorials WHERE duration != '' LIMIT 5", $sqliteConn)
$r = $cmd.ExecuteReader()
Write-Host "`n  Sample (records with duration):"
while ($r.Read()) {
    Write-Host ("  id=" + $r["id"].ToString() + " | access=" + $r["access_type"].ToString() + " | dur=" + $r["duration"].ToString() + " | thumb=" + $r["thumbnail"].ToString().Substring(0, [Math]::Min(40, $r["thumbnail"].ToString().Length)))
}
$r.Close()

# ====== 6. 完成 ======
Write-Host "`n[6/6] Done" -ForegroundColor Green
$elapsed = $sw.Elapsed
Write-Host "  Elapsed: $($elapsed.Minutes)m$($elapsed.Seconds)s"

$sqlConn.Close()
$sqliteConn.Close()
