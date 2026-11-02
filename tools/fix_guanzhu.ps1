[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "Connecting to old database..."
$conn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$conn.Open()

# Read guanzhu for all users
Write-Host "Reading guanzhu values..."
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT user_id, guanzhu FROM Tx_User WHERE guanzhu IS NOT NULL AND guanzhu <> ''"
$reader = $cmd.ExecuteReader()
$guanzhuMap = @{}
while ($reader.Read()) {
    $uid = 0
    if ($reader["user_id"] -ne [DBNull]::Value) { $uid = [int]$reader["user_id"] }
    $gz = 0
    if ($reader["guanzhu"] -ne [DBNull]::Value) { 
        $gzStr = [string]$reader["guanzhu"]
        try { $gz = [int]$gzStr } catch { $gz = 0 }
    }
    if ($uid -gt 0 -and $gz -gt 0) { $guanzhuMap[$uid] = $gz }
}
$reader.Close()
$conn.Close()
Write-Host "Loaded guanzhu for $($guanzhuMap.Count) users"

# Build old_uid -> new_uid map
Write-Host "Building user ID map..."
$conn2 = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$conn2.Open()
$oldCmd = $conn2.CreateCommand()
$oldCmd.CommandText = "SELECT user_id, User_UserName, User_Name FROM Tx_User"
$oldReader = $oldCmd.ExecuteReader()
$oldUsers = @{}
while ($oldReader.Read()) {
    $oldId = 0
    if ($oldReader["user_id"] -ne [DBNull]::Value) { $oldId = [int]$oldReader["user_id"] }
    $uname = ""
    if ($oldReader["User_UserName"] -ne [DBNull]::Value) { $uname = [string]$oldReader["User_UserName"] }
    $name = ""
    if ($oldReader["User_Name"] -ne [DBNull]::Value) { $name = [string]$oldReader["User_Name"] }
    if ($oldId -gt 0) { $oldUsers[$oldId] = @{ uname=$uname; name=$name } }
}
$oldReader.Close()
$conn2.Close()
Write-Host "Loaded $($oldUsers.Count) old users"

# Open SQLite
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection("Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;")
$sqliteConn.Open()

# Build new username -> user_id map
$newUserMap = @{}
$newCmd = $sqliteConn.CreateCommand()
$newCmd.CommandText = "SELECT user_id, username FROM users"
$newReader = $newCmd.ExecuteReader()
while ($newReader.Read()) {
    $uname = ""
    if ($newReader["username"] -ne [DBNull]::Value) { $uname = [string]$newReader["username"] }
    $nuid = 0
    if ($newReader["user_id"] -ne [DBNull]::Value) { $nuid = [int]$newReader["user_id"] }
    if ($uname) { $newUserMap[$uname] = $nuid }
}
$newReader.Close()

# Build old_uid -> new_uid map
$uidMap = @{}
foreach ($kv in $oldUsers.GetEnumerator()) {
    $oldId = $kv.Key
    $uname = $kv.Value.uname
    $name = $kv.Value.name
    if ($uname -and $newUserMap.ContainsKey($uname)) { $uidMap[$oldId] = $newUserMap[$uname] }
    elseif ($name -and $newUserMap.ContainsKey($name)) { $uidMap[$oldId] = $newUserMap[$name] }
}
Write-Host "Mapped $($uidMap.Count) old->new user IDs"

# Build reverse map: new_uid -> old_uid
$revUidMap = @{}
foreach ($kv in $uidMap.GetEnumerator()) {
    $revUidMap[$kv.Value] = $kv.Key
}

# Get all job posts
$selectCmd = $sqliteConn.CreateCommand()
$selectCmd.CommandText = "SELECT id, user_id FROM posts WHERE board_id IN (200, 201) AND user_id > 0"
$postReader = $selectCmd.ExecuteReader()
$postList = @()
while ($postReader.Read()) {
    $postId = 0
    if ($postReader["id"] -ne [DBNull]::Value) { $postId = [int]$postReader["id"] }
    $nuid = 0
    if ($postReader["user_id"] -ne [DBNull]::Value) { $nuid = [int]$postReader["user_id"] }
    if ($postId -gt 0) { $postList += @{ id=$postId; uid=$nuid } }
}
$postReader.Close()
Write-Host "Found $($postList.Count) posts to update"

# Update each post with guanzhu value
$updateCmd = $sqliteConn.CreateCommand()
$updated = 0
foreach ($p in $postList) {
    $nuid = $p.uid
    $postId = $p.id
    $oldUid = $revUidMap[$nuid]
    if ($oldUid -and $guanzhuMap.ContainsKey($oldUid)) {
        $views = $guanzhuMap[$oldUid]
        $updateCmd.CommandText = "UPDATE posts SET view_count = $views WHERE id = $postId"
        $updateCmd.ExecuteNonQuery() | Out-Null
        $updated++
    }
}

$sqliteConn.Close()
Write-Host "Updated $updated posts with guanzhu values"
Write-Host "Done"
