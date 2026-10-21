<#
.SYNOPSIS
    Supplement sub_categories table and tutorial_series association fields
.DESCRIPTION
    1. Creates sub_categories table from Tx_prClass_i (40 records)
    2. Adds columns to tutorial_series: sub_category_id, parent_category_id,
       teacher_id, software_ids, view_count, price
    3. Migrates data from Tx_PrClass_e (418 records)
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

$sqlConnStr = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate;Integrated Security=true;TrustServerCertificate=true"
$sqliteConnStr = "Driver={SQLite3 ODBC Driver};Database=$SqlitePath;SyncPragma=NORMAL;"

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

# ====== 1. Connect ======
Write-Host "[1/6] Connecting databases..." -ForegroundColor Cyan
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()

# ====== 2. Create sub_categories table ======
Write-Host "[2/6] Creating sub_categories table..." -ForegroundColor Cyan
$createSql = "CREATE TABLE IF NOT EXISTS sub_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, parent_category_id INTEGER, sort_order INTEGER DEFAULT 0, cover TEXT, icon TEXT)"
(New-Object System.Data.Odbc.OdbcCommand($createSql, $sqliteConn)).ExecuteNonQuery()
Write-Host "  [OK] sub_categories table created"

# ====== 3. Add columns to tutorial_series ======
Write-Host "[3/6] Adding columns to tutorial_series..." -ForegroundColor Cyan

$checkCmd = New-Object System.Data.Odbc.OdbcCommand("PRAGMA table_info(tutorial_series)", $sqliteConn)
$checkRs = $checkCmd.ExecuteReader()
$existingCols = @{}
while ($checkRs.Read()) { $existingCols[$checkRs.GetString(1)] = $true }
$checkRs.Close()

$columnsToAdd = @(
    @{ name = "sub_category_id";    sql = "ALTER TABLE tutorial_series ADD COLUMN sub_category_id INTEGER" }
    @{ name = "parent_category_id"; sql = "ALTER TABLE tutorial_series ADD COLUMN parent_category_id INTEGER" }
    @{ name = "teacher_id";         sql = "ALTER TABLE tutorial_series ADD COLUMN teacher_id INTEGER" }
    @{ name = "software_ids";       sql = "ALTER TABLE tutorial_series ADD COLUMN software_ids TEXT" }
    @{ name = "view_count";         sql = "ALTER TABLE tutorial_series ADD COLUMN view_count INTEGER DEFAULT 0" }
    @{ name = "price";              sql = "ALTER TABLE tutorial_series ADD COLUMN price REAL DEFAULT 0" }
)

foreach ($col in $columnsToAdd) {
    if (-not $existingCols.ContainsKey($col.name)) {
        (New-Object System.Data.Odbc.OdbcCommand($col.sql, $sqliteConn)).ExecuteNonQuery()
        Write-Host "  + Added column: $($col.name)" -ForegroundColor Green
    } else {
        Write-Host "  = Column exists: $($col.name)" -ForegroundColor Yellow
    }
}

# ====== 4. Migrate sub_categories from Tx_prClass_i ======
Write-Host "[4/6] Migrating sub_categories from Tx_prClass_i (40 records)..." -ForegroundColor Cyan

$cmd = $sqlConn.CreateCommand()
$cmd.CommandText = "SELECT id, name, jieshao, gongsi, down, pic, s_pic FROM Tx_prClass_i ORDER BY gongsi, down"
$reader = $cmd.ExecuteReader()

$updateCmd = New-Object System.Data.Odbc.OdbcCommand("", $sqliteConn)
$tx = $sqliteConn.BeginTransaction()
$updateCmd.Transaction = $tx

$subCount = 0
while ($reader.Read()) {
    $id = [int]$reader["id"]
    $name = $reader["name"]
    $jieshao = $reader["jieshao"]
    $gongsi = $reader["gongsi"]
    if ($null -eq $gongsi -or $gongsi -is [DBNull]) { $gongsi = 0 }
    $down = $reader["down"]
    if ($null -eq $down -or $down -is [DBNull]) { $down = 0 }
    $pic = $reader["s_pic"]
    if ($null -eq $pic -or $pic -is [DBNull]) { $pic = $reader["pic"] }

    $updateCmd.CommandText = "INSERT OR REPLACE INTO sub_categories (id, name, description, parent_category_id, sort_order, icon) VALUES ($id, $(Esc $name), $(Esc $jieshao), $([int]$gongsi), $([int]$down), $(Esc $pic))"
    [void]$updateCmd.ExecuteNonQuery()
    $subCount++
}

$tx.Commit()
$reader.Close()
Write-Host "  [OK] sub_categories migrated: $subCount records"

# ====== 5. Migrate tutorial_series association fields from Tx_PrClass_e ======
Write-Host "[5/6] Migrating tutorial_series fields from Tx_PrClass_e (418 records)..." -ForegroundColor Cyan

$cmd = $sqlConn.CreateCommand()
$cmd.CommandText = "SELECT Class_Id, fenlei, gongsi, laoshi, ruanjian, guanzhu, jg FROM Tx_PrClass_e ORDER BY Class_Id"
$reader = $cmd.ExecuteReader()

$updateCmd = New-Object System.Data.Odbc.OdbcCommand("", $sqliteConn)
$tx = $sqliteConn.BeginTransaction()
$updateCmd.Transaction = $tx

$seriesCount = 0
while ($reader.Read()) {
    $seriesId = [int]$reader["Class_Id"]
    $fenlei = $reader["fenlei"]
    if ($null -eq $fenlei -or $fenlei -is [DBNull]) { $fenlei = 0 }
    $gongsi = $reader["gongsi"]
    if ($null -eq $gongsi -or $gongsi -is [DBNull]) { $gongsi = 0 }
    $laoshi = $reader["laoshi"]
    if ($null -eq $laoshi -or $laoshi -is [DBNull]) { $laoshi = 0 }
    $ruanjian = $reader["ruanjian"]
    if ($null -eq $ruanjian -or $ruanjian -is [DBNull]) { $ruanjian = "" }
    $guanzhu = $reader["guanzhu"]
    if ($null -eq $guanzhu -or $guanzhu -is [DBNull]) { $guanzhu = 0 }
    $jg = $reader["jg"]
    if ($null -eq $jg -or $jg -is [DBNull]) { $jg = 0 }

    $updateCmd.CommandText = "UPDATE tutorial_series SET sub_category_id=$([int]$fenlei), parent_category_id=$([int]$gongsi), teacher_id=$([int]$laoshi), software_ids=$(Esc $ruanjian), view_count=$([int]$guanzhu), price=$([double]$jg) WHERE id=$seriesId"
    [void]$updateCmd.ExecuteNonQuery()
    $seriesCount++
}

$tx.Commit()
$reader.Close()
Write-Host "  [OK] tutorial_series updated: $seriesCount records"

# ====== 6. Verify ======
Write-Host "[6/6] Verifying data..." -ForegroundColor Cyan

# Verify sub_categories
$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT COUNT(*) AS cnt FROM sub_categories", $sqliteConn)
$r = $cmd.ExecuteReader(); $r.Read(); Write-Host "  sub_categories: $($r['cnt']) records"; $r.Close()

$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT sc.id, sc.name, sc.parent_category_id, COUNT(ts.id) AS series_count FROM sub_categories sc LEFT JOIN tutorial_series ts ON ts.sub_category_id=sc.id GROUP BY sc.id ORDER BY sc.parent_category_id, sc.sort_order", $sqliteConn)
$r = $cmd.ExecuteReader()
Write-Host "`n  Sub-categories with series count:"
while ($r.Read()) {
    Write-Host ("    id=" + $r["id"].ToString() + " | " + $r["name"].ToString() + " | parent=" + $r["parent_category_id"].ToString() + " | series=" + $r["series_count"].ToString())
}
$r.Close()

# Verify tutorial_series
$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT COUNT(*) AS cnt FROM tutorial_series WHERE sub_category_id > 0", $sqliteConn)
$r = $cmd.ExecuteReader(); $r.Read(); Write-Host "`n  tutorial_series with sub_category_id: $($r['cnt']) / 418"; $r.Close()

$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT COUNT(*) AS cnt FROM tutorial_series WHERE teacher_id > 0", $sqliteConn)
$r = $cmd.ExecuteReader(); $r.Read(); Write-Host "  tutorial_series with teacher_id: $($r['cnt']) / 418"; $r.Close()

$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT COUNT(*) AS cnt FROM tutorial_series WHERE view_count > 0", $sqliteConn)
$r = $cmd.ExecuteReader(); $r.Read(); Write-Host "  tutorial_series with view_count > 0: $($r['cnt']) / 418"; $r.Close()

$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT COUNT(*) AS cnt FROM tutorial_series WHERE price > 0", $sqliteConn)
$r = $cmd.ExecuteReader(); $r.Read(); Write-Host "  tutorial_series with price > 0: $($r['cnt']) / 418"; $r.Close()

$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT COUNT(*) AS cnt FROM tutorial_series WHERE software_ids IS NOT NULL AND software_ids != ''", $sqliteConn)
$r = $cmd.ExecuteReader(); $r.Read(); Write-Host "  tutorial_series with software_ids: $($r['cnt']) / 418"; $r.Close()

# Sample
$cmd = New-Object System.Data.Odbc.OdbcCommand("SELECT id, title, sub_category_id, parent_category_id, teacher_id, software_ids, view_count, price FROM tutorial_series LIMIT 5", $sqliteConn)
$r = $cmd.ExecuteReader()
Write-Host "`n  Sample series:"
while ($r.Read()) {
    $title = $r["title"].ToString()
    if ($title.Length -gt 25) { $title = $title.Substring(0, 25) }
    Write-Host ("    id=" + $r["id"].ToString() + " | " + $title + " | subcat=" + $r["sub_category_id"].ToString() + " | parent=" + $r["parent_category_id"].ToString() + " | teacher=" + $r["teacher_id"].ToString() + " | rj=" + $r["software_ids"].ToString() + " | views=" + $r["view_count"].ToString() + " | price=" + $r["price"].ToString())
}
$r.Close()

$elapsed = $sw.Elapsed
Write-Host "`nDone. Elapsed: $($elapsed.Minutes)m$($elapsed.Seconds)s" -ForegroundColor Green

$sqlConn.Close()
$sqliteConn.Close()
