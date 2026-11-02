[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "Connecting to LocalDB..."
$conn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$conn.Open()

# Get view counts per user_id
Write-Host "Reading liulan view counts..."
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT user_id, COUNT(*) as cnt FROM liulan GROUP BY user_id"
$reader = $cmd.ExecuteReader()
$viewMap = @{}
while ($reader.Read()) {
    $uid = 0
    if ($reader["user_id"] -ne [DBNull]::Value) { $uid = [int]$reader["user_id"] }
    $cnt = 0
    if ($reader["cnt"] -ne [DBNull]::Value) { $cnt = [int]$reader["cnt"] }
    if ($uid -gt 0) { $viewMap[$uid] = $cnt }
}
$reader.Close()

# Get old user_id -> username mapping
$cmd.CommandText = "SELECT user_id, User_UserName, User_Name FROM Tx_User"
$reader = $cmd.ExecuteReader()
$oldUserMap = @{}
while ($reader.Read()) {
    $oldId = 0
    if ($reader["user_id"] -ne [DBNull]::Value) { $oldId = [int]$reader["user_id"] }
    $uname = ""
    if ($reader["User_UserName"] -ne [DBNull]::Value) { $uname = [string]$reader["User_UserName"] }
    $name = ""
    if ($reader["User_Name"] -ne [DBNull]::Value) { $name = [string]$reader["User_Name"] }
    if ($oldId -gt 0) { $oldUserMap[$oldId] = @{ uname = $uname; name = $name } }
}
$reader.Close()
$conn.Close()
Write-Host "Loaded $($viewMap.Count) view counts, $($oldUserMap.Count) old users"

# Open SQLite
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection("Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;")
$sqliteConn.Open()

# Build username -> new user_id map
$newUserCmd = $sqliteConn.CreateCommand()
$newUserCmd.CommandText = "SELECT user_id, username FROM users"
$newUserReader = $newUserCmd.ExecuteReader()
$newUserMap = @{}
while ($newUserReader.Read()) {
    $uname = ""
    if ($newUserReader["username"] -ne [DBNull]::Value) { $uname = [string]$newUserReader["username"] }
    $nuid = 0
    if ($newUserReader["user_id"] -ne [DBNull]::Value) { $nuid = [int]$newUserReader["user_id"] }
    if ($uname) { $newUserMap[$uname] = $nuid }
}
$newUserReader.Close()

# Build old_uid -> new_uid map
$uidMap = @{}
foreach ($kv in $oldUserMap.GetEnumerator()) {
    $oldId = $kv.Key
    $uname = $kv.Value.uname
    $name = $kv.Value.name
    if ($uname -and $newUserMap.ContainsKey($uname)) { $uidMap[$oldId] = $newUserMap[$uname] }
    elseif ($name -and $newUserMap.ContainsKey($name)) { $uidMap[$oldId] = $newUserMap[$name] }
}
Write-Host "Mapped $($uidMap.Count) old->new user IDs"

# Get all job posts with their new user_id
$selectCmd = $sqliteConn.CreateCommand()
$selectCmd.CommandText = "SELECT id, user_id FROM posts WHERE board_id IN (200, 201) AND user_id > 0"
$postReader = $selectCmd.ExecuteReader()
$postList = @()
while ($postReader.Read()) {
    $postId = 0
    if ($postReader["id"] -ne [DBNull]::Value) { $postId = [int]$postReader["id"] }
    $nuid = 0
    if ($postReader["user_id"] -ne [DBNull]::Value) { $nuid = [int]$postReader["user_id"] }
    if ($postId -gt 0) { $postList += @{ id = $postId; newUid = $nuid } }
}
$postReader.Close()
Write-Host "Found $($postList.Count) posts with user_id > 0"

# Build reverse map: new_uid -> old_uid
$revUidMap = @{}
foreach ($kv in $uidMap.GetEnumerator()) {
    $revUidMap[$kv.Value] = $kv.Key
}

# Update each post
$updateCmd = $sqliteConn.CreateCommand()
$updated = 0
foreach ($p in $postList) {
    $nuid = $p.newUid
    $postId = $p.id
    $oldUid = $revUidMap[$nuid]
    if ($oldUid -and $viewMap.ContainsKey($oldUid)) {
        $views = $viewMap[$oldUid]
        $updateCmd.CommandText = "UPDATE posts SET view_count = $views WHERE id = $postId"
        $updateCmd.ExecuteNonQuery() | Out-Null
        $updated++
    }
}

$sqliteConn.Close()
Write-Host "Updated $updated posts with view counts"
Write-Host "Done"
