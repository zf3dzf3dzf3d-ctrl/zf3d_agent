[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "Connecting to old database..."
$conn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$conn.Open()

# Read all guestbook messages (Cret_Class=6, Cret_ClassId=user_id)
Write-Host "Reading guestbook messages..."
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT Cret_Id, Cret_ClassId, Cret_AddName, Cret_UserId, Cret_Content, Cret_Date FROM Tx_Cret WHERE Cret_Class=6 ORDER BY Cret_Date ASC"
$reader = $cmd.ExecuteReader()
$msgList = @()
while ($reader.Read()) {
    $toUid = 0
    if ($reader["Cret_ClassId"] -ne [DBNull]::Value) { $toUid = [int]$reader["Cret_ClassId"] }
    $fromUid = 0
    if ($reader["Cret_UserId"] -ne [DBNull]::Value) { $fromUid = [int]$reader["Cret_UserId"] }
    $author = ""
    if ($reader["Cret_AddName"] -ne [DBNull]::Value) { $author = [string]$reader["Cret_AddName"] }
    $content = ""
    if ($reader["Cret_Content"] -ne [DBNull]::Value) { $content = [string]$reader["Cret_Content"] }
    $date = ""
    if ($reader["Cret_Date"] -ne [DBNull]::Value) { $date = [string]$reader["Cret_Date"] }
    if ($toUid -gt 0 -and $content.Trim() -ne "") {
        $msgList += @{ toUid=$toUid; fromUid=$fromUid; author=$author; content=$content; date=$date }
    }
}
$reader.Close()
$conn.Close()
Write-Host "Read $($msgList.Count) guestbook messages"

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

# Get all job posts: id, user_id, board_id
Write-Host "Loading job posts..."
$postCmd = $sqliteConn.CreateCommand()
$postCmd.CommandText = "SELECT id, user_id, board_id FROM posts WHERE board_id IN (200, 201) AND user_id > 0"
$postReader = $postCmd.ExecuteReader()
$posts = @{}
while ($postReader.Read()) {
    $postId = 0
    if ($postReader["id"] -ne [DBNull]::Value) { $postId = [int]$postReader["id"] }
    $uid = 0
    if ($postReader["user_id"] -ne [DBNull]::Value) { $uid = [int]$postReader["user_id"] }
    $board = 0
    if ($postReader["board_id"] -ne [DBNull]::Value) { $board = [int]$postReader["board_id"] }
    if ($postId -gt 0 -and $uid -gt 0) { $posts[$uid] = @{ id=$postId; board=$board } }
}
$postReader.Close()
Write-Host "Loaded $($posts.Count) job posts with user_id"

# Function to escape SQL
function SqlEsc($v) {
    if ($null -eq $v) { return "''" }
    $s = [string]$v
    $s = $s.Replace("'", "''")
    return "'$s'"
}

# Insert comments: for each guestbook message, find the recipient's job post and add as comment
$insertCmd = $sqliteConn.CreateCommand()
$updateCmd = $sqliteConn.CreateCommand()
$inserted = 0
$postsUpdated = @{}

foreach ($msg in $msgList) {
    $newToUid = $uidMap[$msg.toUid]
    if (-not $newToUid) { continue }
    $newFromUid = $uidMap[$msg.fromUid]
    if (-not $newFromUid) { $newFromUid = 0 }
    
    # Find the recipient's most recent job post (prefer 201 for seeking, 200 for recruitment)
    if (-not $posts.ContainsKey($newToUid)) { continue }
    $post = $posts[$newToUid]
    $postId = $post.id
    $board = $post.board
    
    $date = $msg.date
    if (-not $date) { $date = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }
    
    $author = $msg.author
    $content = $msg.content
    
    $insertCmd.CommandText = "INSERT INTO comments (target_id, target_type, user_id, author_name, content, created_at) VALUES ($postId, 'post', $newFromUid, $(SqlEsc $author), $(SqlEsc $content), '$date')"
    try {
        $insertCmd.ExecuteNonQuery()
        $inserted++
        if (-not $postsUpdated.ContainsKey($postId)) { $postsUpdated[$postId] = 0 }
        $postsUpdated[$postId]++
    } catch {}
}

Write-Host "Inserted $inserted comments"

# Update reply_count for each post
foreach ($kv in $postsUpdated.GetEnumerator()) {
    $cnt = $kv.Value
    $postId = $kv.Key
    $updateCmd.CommandText = "UPDATE posts SET reply_count = $cnt WHERE id = $postId"
    $updateCmd.ExecuteNonQuery() | Out-Null
}
Write-Host "Updated reply_count for $($postsUpdated.Count) posts"

$sqliteConn.Close()
Write-Host "`n=== Done: $inserted comments migrated ==="
