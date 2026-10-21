[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "Connecting to old database..."
$conn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$conn.Open()

# Read all users with mima
Write-Host "Reading old mima values..."
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT user_id, mima FROM Tx_User WHERE mima IS NOT NULL AND mima <> ''"
$reader = $cmd.ExecuteReader()
$mimaMap = @{}
while ($reader.Read()) {
    $oldUid = 0
    if ($reader["user_id"] -ne [DBNull]::Value) { $oldUid = [int]$reader["user_id"] }
    $mima = ""
    if ($reader["mima"] -ne [DBNull]::Value) { $mima = [string]$reader["mima"] }
    if ($oldUid -gt 0 -and $mima) { $mimaMap[$oldUid] = $mima }
}
$reader.Close()
$conn.Close()
Write-Host "Loaded $($mimaMap.Count) mima values"

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

# Update mima for each user
$updateCmd = $sqliteConn.CreateCommand()
$updated = 0
foreach ($kv in $mimaMap.GetEnumerator()) {
    $oldUid = $kv.Key
    $mima = $kv.Value
    $newUid = $uidMap[$oldUid]
    if ($newUid) {
        $escaped = $mima.Replace("'", "''")
        $updateCmd.CommandText = "UPDATE users SET mima='$escaped' WHERE user_id=$newUid"
        $updateCmd.ExecuteNonQuery() | Out-Null
        $updated++
    }
}

$sqliteConn.Close()
Write-Host "Updated $updated users with mima values"
Write-Host "Done"
