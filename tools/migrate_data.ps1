<#
.SYNOPSIS
    zf3d.com 旧数据库迁移脚本
.DESCRIPTION
    从SQL Server LocalDB (zf3ddate) 迁移有用数据到新SQLite数据库
    丢弃所有日志表(henji/guankan/tuijian/liulan等)和未审核数据
.NOTES
    前置条件：
    1. 已安装 SQL Server LocalDB 2022
    2. 已安装 SQLite3 ODBC Driver
    3. 已附加旧数据库: CREATE DATABASE zf3ddate ON (...) FOR ATTACH
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

# ====== 通用迁移函数 ======
function Migrate-Table {
    param(
        [string]$label,
        [string]$selectSql,
        [string]$tableName,
        [string[]]$colNames,
        [int]$batchSize = 1000
    )

    Write-Host "  $label ... " -NoNewline
    $cmd = $sqlConn.CreateCommand()
    $cmd.CommandText = $selectSql
    $reader = $cmd.ExecuteReader()

    $cols = $colNames -join ", "
    $cmdSql = New-Object System.Data.Odbc.OdbcCommand("", $sqliteConn)
    $tx = $sqliteConn.BeginTransaction()
    $cmdSql.Transaction = $tx
    $count = 0; $errors = 0

    while ($reader.Read()) {
        $vals = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) {
            $vals += (Esc $reader.GetValue($i))
        }
        $cmdSql.CommandText = "INSERT INTO $tableName ($cols) VALUES ($($vals -join ', '))"
        try {
            $cmdSql.ExecuteNonQuery()
            $count++
        } catch {
            $errors++
        }

        if ($count % $batchSize -eq 0 -and $count -gt 0) {
            $tx.Commit()
            $tx = $sqliteConn.BeginTransaction()
            $cmdSql.Transaction = $tx
            Write-Host "$count " -NoNewline
        }
    }

    $tx.Commit()
    $reader.Close()
    $msg = "done $count"
    if ($errors) { $msg += " ($errors errors)" }
    Write-Host $msg
    return $count
}

# ====== 1. 创建SQLite数据库和表 ======
Write-Host "[1/9] 创建SQLite数据库..." -ForegroundColor Cyan

Get-ChildItem "$SqlitePath*" -ErrorAction SilentlyContinue | Remove-Item -Force
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection($sqliteConnStr)
$sqliteConn.Open()

$createSqls = @(
    "CREATE TABLE users (user_id INTEGER PRIMARY KEY, username TEXT NOT NULL, password TEXT, user_group INTEGER DEFAULT 0, email TEXT, avatar TEXT, vip_start TEXT, vip_end TEXT, points INTEGER DEFAULT 0, last_login TEXT, created_at TEXT)",
    "CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, icon TEXT, sort_order INTEGER DEFAULT 0)",
    "CREATE TABLE boards (id INTEGER PRIMARY KEY, name TEXT, description TEXT, sort_order INTEGER DEFAULT 0)",
    "CREATE TABLE tutorial_series (id INTEGER PRIMARY KEY, title TEXT, description TEXT, cover TEXT, teacher TEXT, sort_order INTEGER DEFAULT 0, is_free INTEGER DEFAULT 0, created_at TEXT)",
    "CREATE TABLE tutorials (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, cover TEXT, video_url TEXT, series_id INTEGER, episode INTEGER DEFAULT 1, view_count INTEGER DEFAULT 0, is_free INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, created_at TEXT)",
    "CREATE TABLE articles (id INTEGER PRIMARY KEY, category_id INTEGER, title TEXT NOT NULL, content TEXT, source TEXT, view_count INTEGER DEFAULT 0, created_at TEXT)",
    "CREATE TABLE posts (id INTEGER PRIMARY KEY, board_id INTEGER, title TEXT, content TEXT, user_id INTEGER, view_count INTEGER DEFAULT 0, reply_count INTEGER DEFAULT 0, created_at TEXT)",
    "CREATE TABLE comments (id INTEGER PRIMARY KEY, tutorial_id INTEGER, user_id INTEGER, author_name TEXT, content TEXT, created_at TEXT)",
    "CREATE TABLE learning_records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, tutorial_id INTEGER, progress INTEGER DEFAULT 0, last_view TEXT, created_at TEXT)"
)
foreach ($s in $createSqls) {
    (New-Object System.Data.Odbc.OdbcCommand($s, $sqliteConn)).ExecuteNonQuery()
}
Write-Host "  ✓ $($createSqls.Count) 张表"

# 连接SQL Server
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($sqlConnStr)
$sqlConn.Open()

# ====== 2. 迁移分类 ======
Write-Host "[2/9] 迁移分类..." -ForegroundColor Cyan
Migrate-Table "Tx_PrClass" `
    "SELECT Class_Id, Class_Name, Class_Order FROM Tx_PrClass WHERE ParentID = 0 ORDER BY Class_Order" `
    "categories" @("id", "name", "sort_order") | Out-Null

# ====== 3. 迁移板块 ======
Write-Host "[3/9] 迁移板块..." -ForegroundColor Cyan
Migrate-Table "Tx_Board" `
    "SELECT Class_Id, Class_Name, Class_Content, Class_Order FROM Tx_Board ORDER BY Class_Order" `
    "boards" @("id", "name", "description", "sort_order") | Out-Null

# ====== 4. 迁移用户 ======
Write-Host "[4/9] 迁移用户 (32万条, 耐心等待)..." -ForegroundColor Cyan
Migrate-Table "Tx_User" `
    "SELECT User_Id, User_Name, User_Passwd, User_Flag, User_Email, User_Picture,
     CONVERT(varchar(19), VipStartTime, 120), CONVERT(varchar(19), VipEndTime, 120),
     jifen, CONVERT(varchar(19), User_LoginDate, 120), CONVERT(varchar(19), User_regDate, 120)
     FROM Tx_User WHERE User_Name IS NOT NULL AND LEN(User_Name) > 0 ORDER BY User_Id" `
    "users" @("user_id", "username", "password", "user_group", "email", "avatar", "vip_start", "vip_end", "points", "last_login", "created_at") 2000 | Out-Null

# ====== 5. 迁移教程 (Tx_Products) ======
Write-Host "[5/9] 迁移教程 Tx_Products..." -ForegroundColor Cyan
Migrate-Table "Tx_Products" `
    "SELECT Products_Id, Products_Name, CAST(Products_Content AS nvarchar(max)),
     Products_Pic, Products_Count, CONVERT(varchar(19), Products_Date, 120)
     FROM Tx_Products ORDER BY Products_Id" `
    "tutorials" @("id", "title", "description", "cover", "view_count", "created_at") | Out-Null

# ====== 6. 迁移视频教程 (shipinjiaocheng) ======
Write-Host "[6/9] 迁移视频教程 shipinjiaocheng..." -ForegroundColor Cyan
Migrate-Table "shipinjiaocheng" `
    "SELECT id + 100000, biaoti, CAST(jieshao AS nvarchar(max)),
     pic, youku, guanzhu, CONVERT(varchar(19), shijian, 120)
     FROM shipinjiaocheng WHERE shenhe = 2 ORDER BY id" `
    "tutorials" @("id", "title", "description", "cover", "video_url", "view_count", "created_at") | Out-Null

# ====== 7. 迁移文章 (Tx_News) ======
Write-Host "[7/9] 迁移文章 Tx_News..." -ForegroundColor Cyan
Migrate-Table "Tx_News" `
    "SELECT News_Id, News_ClassId, News_Title, CAST(News_Content AS nvarchar(max)),
     News_Form, News_Count, CONVERT(varchar(19), News_Date, 120)
     FROM Tx_News WHERE shenhe = 2 ORDER BY News_Id" `
    "articles" @("id", "category_id", "title", "content", "source", "view_count", "created_at") | Out-Null

# ====== 8. 迁移帖子 (Tx_Bbs) ======
Write-Host "[8/9] 迁移帖子 Tx_Bbs..." -ForegroundColor Cyan
Migrate-Table "Tx_Bbs" `
    "SELECT Bbs_Id, Bbs_Board,
     CASE WHEN Bbs_Title IS NULL OR Bbs_Title = '' THEN LEFT(CAST(Bbs_Content AS varchar(50)), 50) ELSE Bbs_Title END,
     CAST(Bbs_Content AS nvarchar(max)), Bbs_UserId, Bbs_Count, Bbs_ReNum,
     CONVERT(varchar(19), Bbs_Date, 120)
     FROM Tx_Bbs WHERE shenhe = 2 ORDER BY Bbs_Id" `
    "posts" @("id", "board_id", "title", "content", "user_id", "view_count", "reply_count", "created_at") 2000 | Out-Null

# ====== 9. 迁移评论 (Tx_Cret) ======
Write-Host "[9/9] 迁移评论 Tx_Cret (19万条, 耐心等待)..." -ForegroundColor Cyan
Migrate-Table "Tx_Cret" `
    "SELECT Cret_Id, Cret_ClassId, Cret_UserId, Cret_AddName,
     CAST(Cret_Content AS nvarchar(max)), CONVERT(varchar(19), Cret_Date, 120)
     FROM Tx_Cret WHERE Cret_Flag = 1 ORDER BY Cret_Id" `
    "comments" @("id", "tutorial_id", "user_id", "author_name", "content", "created_at") 2000 | Out-Null

# ====== 创建索引 ======
Write-Host "`n创建索引..." -ForegroundColor Cyan
$indexes = @(
    "CREATE INDEX idx_users_username ON users(username)",
    "CREATE INDEX idx_tutorials_created ON tutorials(created_at DESC)",
    "CREATE INDEX idx_articles_created ON articles(created_at DESC)",
    "CREATE INDEX idx_posts_board ON posts(board_id)",
    "CREATE INDEX idx_posts_created ON posts(created_at DESC)",
    "CREATE INDEX idx_comments_tutorial ON comments(tutorial_id)",
    "CREATE INDEX idx_articles_category ON articles(category_id)"
)
foreach ($idx in $indexes) {
    (New-Object System.Data.Odbc.OdbcCommand($idx, $sqliteConn)).ExecuteNonQuery()
}
Write-Host "  ✓ $($indexes.Count) 个索引"

# ====== 统计 ======
Write-Host "`n========== 迁移完成 ==========" -ForegroundColor Green
$statsSql = @(
    "SELECT 'users' AS t, COUNT(*) AS c FROM users",
    "SELECT 'categories' AS t, COUNT(*) AS c FROM categories",
    "SELECT 'boards' AS t, COUNT(*) AS c FROM boards",
    "SELECT 'tutorials' AS t, COUNT(*) AS c FROM tutorials",
    "SELECT 'articles' AS t, COUNT(*) AS c FROM articles",
    "SELECT 'posts' AS t, COUNT(*) AS c FROM posts",
    "SELECT 'comments' AS t, COUNT(*) AS c FROM comments"
)
foreach ($s in $statsSql) {
    $cmd = New-Object System.Data.Odbc.OdbcCommand($s, $sqliteConn)
    $r = $cmd.ExecuteReader()
    $r.Read()
    $tname = $r["t"].ToString()
    $tcount = [int]$r["c"]
    Write-Host ("  " + $tname.PadRight(15) + " " + $tcount.ToString("N0"))
    $r.Close()
}

$dbSize = [math]::Round((Get-Item $SqlitePath).Length / 1MB, 1)
Write-Host ""
Write-Host "  数据库大小: $dbSize MB"
$elapsed = $sw.Elapsed
Write-Host "  耗时: $($elapsed.Minutes)分$($elapsed.Seconds)秒"

# ====== 关闭连接 ======
$sqlConn.Close()
$sqliteConn.Close()
