[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "Connecting to LocalDB zf3ddate_old..."
$conn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$conn.Open()
Write-Host "Connected"

function CleanHtml($html) {
    if ($null -eq $html -or $html -eq [DBNull]::Value) { return "" }
    $s = [string]$html
    $s = $s -replace 'http://www\.zf3d\.com/', '/'
    $s = $s -replace 'http://bbs\.game798\.com/', '/'
    $s = $s -replace '<ignore_js_op[^>]*>', ''
    $s = $s -replace '</ignore_js_op>', ''
    $s = $s -replace '<embed[^>]*>', ''
    return $s
}

function SqlEsc($v) {
    if ($null -eq $v -or $v -eq [DBNull]::Value) { return "''" }
    $s = [string]$v
    $s = $s.Replace("'", "''")
    return "'$s'"
}

function GetField($reader, $name) {
    if ($reader[$name] -ne [DBNull]::Value) { return ($reader[$name] -as [string]).Trim() } else { return "" }
}

# ====== Migrate zp_zwyq + zp_gstj (recruitment with company info) ======
Write-Host "Reading zp_zwyq with company info..."

# First get company info map
$gsCmd = $conn.CreateCommand()
$gsCmd.CommandText = "SELECT id, user_id, title, gsrs, gsjj, gslx, data FROM zp_gstj"
$gsReader = $gsCmd.ExecuteReader()
$companyMap = @{}
while ($gsReader.Read()) {
    $uid = [int]$gsReader["user_id"]
    $companyMap[$uid] = @{
        name = GetField $gsReader "title"
        size = GetField $gsReader "gsrs"
        intro = (CleanHtml $gsReader["gsjj"])
        type = GetField $gsReader "gslx"
    }
}
$gsReader.Close()
Write-Host "Loaded $($companyMap.Count) companies"

# Now read all job postings with full fields
$zpCmd = $conn.CreateCommand()
$zpCmd.CommandText = "SELECT id, user_id, zwbt, zwms, data, zw1, zw2, didian1, didian2, yx, gzxz, xl, gzjy, zprs FROM zp_zwyq ORDER BY id ASC"
$zpReader = $zpCmd.ExecuteReader()
$zpList = @()
while ($zpReader.Read()) {
    $uid = if ($zpReader["user_id"] -ne [DBNull]::Value) { [int]$zpReader["user_id"] } else { 0 }
    $title = GetField $zpReader "zwbt"
    if (!$title) { continue }
    
    # Build content with job details + company info
    $desc = CleanHtml $zpReader["zwms"]
    
    # Job metadata
    $meta = @()
    $zw1 = GetField $zpReader "zw1"
    $zw2 = GetField $zpReader "zw2"
    $didian1 = GetField $zpReader "didian1"
    $didian2 = GetField $zpReader "didian2"
    $yx = GetField $zpReader "yx"
    $gzxz = GetField $zpReader "gzxz"
    $xl = GetField $zpReader "xl"
    $gzjy = GetField $zpReader "gzjy"
    $zprs = GetField $zpReader "zprs"
    
    if ($zw1) { $meta += "行业: $zw1" }
    if ($zw2) { $meta += "职位: $zw2" }
    if ($didian1) { $loc = $didian1; if ($didian2) { $loc += " $didian2" }; $meta += "地区: $loc" }
    if ($yx) { $meta += "薪资: $yx" }
    if ($gzxz) { $meta += "工作性质: $gzxz" }
    if ($xl) { $meta += "学历: $xl" }
    if ($gzjy) { $meta += "经验: $gzjy" }
    if ($zprs) { $meta += "招聘人数: $zprs" }
    
    $content = $desc
    if ($meta.Count -gt 0) { $content += "`n`n" + ($meta -join ' | ') }
    
    # Add company info if available
    if ($companyMap.ContainsKey($uid)) {
        $co = $companyMap[$uid]
        $coInfo = @()
        if ($co.name) { $coInfo += '公司: ' + $co.name }
        if ($co.type) { $coInfo += '公司类型: ' + $co.type }
        if ($co.size) { $coInfo += '公司规模: ' + $co.size + '人' }
        if ($coInfo.Count -gt 0) {
            $content += "`n" + ($coInfo -join ' | ')
        }
        if ($co.intro) {
            $content += "`n`n" + [char]0x516C + [char]0x53F8 + [char]0x7B80 + [char]0x4ECB + ":`n" + $co.intro
        }
    }
    
    $date = if ($zpReader["data"] -ne [DBNull]::Value) { ($zpReader["data"] -as [string]) } else { "" }
    
    $zpList += @{ uid=$uid; title=$title; content=$content; date=$date }
}
$zpReader.Close()
Write-Host "Read $($zpList.Count) recruitment records"

# ====== Migrate rc_grtj (job seeking with full info) ======
Write-Host "Reading rc_grtj..."
$rcCmd = $conn.CreateCommand()
$rcCmd.CommandText = "SELECT id, user_id, title, nr, shijian, zw1, zw2, didian1, didian2, yx, gzjy, xl, gzxz FROM rc_grtj ORDER BY id ASC"
$rcReader = $rcCmd.ExecuteReader()
$rcList = @()
while ($rcReader.Read()) {
    $uid = if ($rcReader["user_id"] -ne [DBNull]::Value) { [int]$rcReader["user_id"] } else { 0 }
    $title = GetField $rcReader "title"
    if (!$title) { continue }
    
    $desc = CleanHtml $rcReader["nr"]
    $meta = @()
    $zw1 = GetField $rcReader "zw1"
    $zw2 = GetField $rcReader "zw2"
    $didian1 = GetField $rcReader "didian1"
    $didian2 = GetField $rcReader "didian2"
    $yx = GetField $rcReader "yx"
    $gzjy = GetField $rcReader "gzjy"
    $xl = GetField $rcReader "xl"
    $gzxz = GetField $rcReader "gzxz"
    
    if ($zw1) { $meta += "行业: $zw1" }
    if ($zw2) { $meta += "职位: $zw2" }
    if ($didian1) { $loc = $didian1; if ($didian2) { $loc += " $didian2" }; $meta += "地区: $loc" }
    if ($yx) { $meta += "期望薪资: $yx" }
    if ($gzxz) { $meta += "工作性质: $gzxz" }
    if ($xl) { $meta += "学历: $xl" }
    if ($gzjy) { $meta += "经验: $gzjy" }
    
    $content = $desc
    if ($meta.Count -gt 0) { $content += "`n`n" + ($meta -join ' | ') }
    
    $date = if ($rcReader["shijian"] -ne [DBNull]::Value) { ($rcReader["shijian"] -as [string]) } else { "" }
    
    $rcList += @{ uid=$uid; title=$title; content=$content; date=$date }
}
$rcReader.Close()
$conn.Close()
Write-Host "Read $($rcList.Count) job seeking records"

# ====== Build user ID map ======
Write-Host "Building user ID map..."
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection("Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;")
$sqliteConn.Open()

$userMap = @{}
$userCmd = $sqliteConn.CreateCommand()
$userCmd.CommandText = "SELECT user_id, username FROM users"
$userReader = $userCmd.ExecuteReader()
while ($userReader.Read()) { $userMap[$userReader["username"] -as [string]] = [int]$userReader["user_id"] }
$userReader.Close()

$conn2 = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$conn2.Open()
$oldUserCmd = $conn2.CreateCommand()
$oldUserCmd.CommandText = "SELECT user_id, User_UserName, User_Name FROM Tx_User"
$oldUserReader = $oldUserCmd.ExecuteReader()
$userIdMap = @{}
while ($oldUserReader.Read()) {
    $oldId = [int]$oldUserReader["user_id"]
    $username = $oldUserReader["User_UserName"] -as [string]
    $name = $oldUserReader["User_Name"] -as [string]
    # Try User_UserName first, then User_Name
    if ($username -and $userMap.ContainsKey($username)) {
        $userIdMap[$oldId] = $userMap[$username]
    } elseif ($name -and $userMap.ContainsKey($name)) {
        $userIdMap[$oldId] = $userMap[$name]
    }
}
$oldUserReader.Close()
$conn2.Close()
Write-Host "Mapped $($userIdMap.Count) users"

# ====== Clear old data and insert ======
Write-Host "Clearing old data..."
$delCmd = $sqliteConn.CreateCommand()
$delCmd.CommandText = "DELETE FROM posts WHERE board_id IN (200, 201)"
$delCmd.ExecuteNonQuery() | Out-Null

$insertCmd = $sqliteConn.CreateCommand()
$zpInserted = 0
foreach ($row in $zpList) {
    $newUid = if ($userIdMap.ContainsKey([int]$row.uid)) { $userIdMap[[int]$row.uid] } else { 0 }
    $date = $row.date
    if (!$date) { $date = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }
    $insertCmd.CommandText = "INSERT INTO posts (board_id, title, content, user_id, created_at) VALUES (200, $(SqlEsc $row.title), $(SqlEsc $row.content), $newUid, '$date')"
    try { $insertCmd.ExecuteNonQuery(); $zpInserted++ } catch {}
}
Write-Host "Inserted $zpInserted recruitment records"

$rcInserted = 0
foreach ($row in $rcList) {
    $newUid = if ($userIdMap.ContainsKey([int]$row.uid)) { $userIdMap[[int]$row.uid] } else { 0 }
    $date = $row.date
    if (!$date) { $date = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }
    $insertCmd.CommandText = "INSERT INTO posts (board_id, title, content, user_id, created_at) VALUES (201, $(SqlEsc $row.title), $(SqlEsc $row.content), $newUid, '$date')"
    try { $insertCmd.ExecuteNonQuery(); $rcInserted++ } catch {}
}
Write-Host "Inserted $rcInserted job seeking records"

$sqliteConn.Close()
Write-Host "`n=== Done: 招聘=$zpInserted, 求职=$rcInserted ==="
