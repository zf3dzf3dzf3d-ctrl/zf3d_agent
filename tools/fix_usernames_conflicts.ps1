[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "Fixing 2427 conflict users (append user_id)..."
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection("Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;")
$sqliteConn.Open()
$cmd = $sqliteConn.CreateCommand()

# Get all users with empty username and their user_id
$cmd.CommandText = "SELECT user_id FROM users WHERE username IS NULL OR username = '' ORDER BY user_id"
$r = $cmd.ExecuteReader()
$emptyIds = New-Object System.Collections.ArrayList
while($r.Read()) { [void]$emptyIds.Add([int]$r['user_id']) }
$r.Close()
Write-Host "  Found $($emptyIds.Count) empty-username users"

# Load old User_Name for these users
Write-Host "Loading old DB names for conflict users..."
$sqlConn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$sqlConn.Open()
$sqlCmd = $sqlConn.CreateCommand()
$oldNames = @{}
foreach($uid in $emptyIds) {
    $sqlCmd.CommandText = "SELECT User_Name FROM Tx_User WHERE User_Id = $uid"
    $sqlR = $sqlCmd.ExecuteReader()
    if($sqlR.Read() -and $sqlR['User_Name'] -ne [DBNull]::Value) {
        $oldNames[$uid] = [string]$sqlR['User_Name']
    }
    $sqlR.Close()
}
$sqlConn.Close()
Write-Host "  Loaded $($oldNames.Count) names from old DB"

# Load current existing usernames (case-insensitive)
$cmd.CommandText = "SELECT LOWER(username) as un FROM users WHERE username IS NOT NULL AND username <> ''"
$r = $cmd.ExecuteReader()
$existingLower = @{}
while($r.Read()) { $existingLower[[string]$r['un']] = $true }
$r.Close()

# For each conflict user, append user_id
$tx = $sqliteConn.BeginTransaction()
$cmd.Transaction = $tx
$updated = 0
$noName = 0

foreach($uid in $emptyIds) {
    if(-not $oldNames.ContainsKey($uid)) { $noName++; continue }
    
    $baseName = $oldNames[$uid]
    $newName = $baseName + "_" + $uid
    
    # Double check no conflict with the new name
    if($existingLower.ContainsKey($newName.ToLower())) { $newName = $baseName + "__" + $uid }
    
    $escaped = $newName.Replace("'", "''")
    $cmd.CommandText = "UPDATE users SET username='$escaped' WHERE user_id=$uid AND (username IS NULL OR username = '')"
    $updated += $cmd.ExecuteNonQuery()
}
$tx.Commit()
Write-Host "  Updated: $updated (appended _user_id)"
Write-Host "  No name in old DB: $noName"

# Final verify
$cmd.CommandText = "SELECT COUNT(*) as cnt FROM users WHERE username IS NOT NULL AND username <> ''"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host "  Non-empty username: $($r['cnt'])" }
$r.Close()
$cmd.CommandText = "SELECT COUNT(*) as cnt FROM users WHERE username IS NULL OR username = ''"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host "  Empty username: $($r['cnt'])" }
$r.Close()

$sqliteConn.Close()
Write-Host "Done!"
