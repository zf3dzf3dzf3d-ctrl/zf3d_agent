[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "Step 1: Load old SQL Server User_Name..."
$sqlConn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$sqlConn.Open()
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT User_Id, User_Name FROM Tx_User WHERE User_Name IS NOT NULL AND User_Name <> ''"
$sqlReader = $sqlCmd.ExecuteReader()
$oldNames = @{}
while($sqlReader.Read()) {
    $oldNames[[int]$sqlReader['User_Id']] = [string]$sqlReader['User_Name']
}
$sqlReader.Close()
$sqlConn.Close()
Write-Host "  Loaded $($oldNames.Count) users from old DB"

Write-Host "Step 2: Load SQLite existing usernames..."
$sqliteConn = New-Object System.Data.Odbc.OdbcConnection("Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;")
$sqliteConn.Open()
$sqliteCmd = $sqliteConn.CreateCommand()
$sqliteCmd.CommandText = "SELECT user_id, username FROM users WHERE username IS NOT NULL AND username <> ''"
$sqliteReader = $sqliteCmd.ExecuteReader()
$existingNames = @{}
$existingUserIds = @{}
while($sqliteReader.Read()) {
    $uid = [int]$sqliteReader['user_id']
    $un = [string]$sqliteReader['username']
    $existingNames[$un.ToLower()] = $uid
    $existingUserIds[$uid] = $un
}
$sqliteReader.Close()
Write-Host "  Loaded $($existingNames.Count) existing usernames from SQLite"

Write-Host "Step 3: Build update list (skip conflicts)..."
$conflictCount = 0
$alreadyHasCount = 0
$updateList = New-Object System.Collections.ArrayList

foreach($uid in $oldNames.Keys) {
    if($existingUserIds.ContainsKey($uid)) {
        $alreadyHasCount++
        continue
    }
    $oldName = $oldNames[$uid]
    $lowerName = $oldName.ToLower()
    if($existingNames.ContainsKey($lowerName)) {
        $conflictCount++
    } else {
        [void]$updateList.Add(@{ uid=$uid; name=$oldName })
    }
}

Write-Host "  Already has username: $alreadyHasCount"
Write-Host "  Can update: $($updateList.Count)"
Write-Host "  Conflicts (name taken): $conflictCount"

Write-Host "Step 4: Execute updates..."
$updateCmd = $sqliteConn.CreateCommand()
$tx = $sqliteConn.BeginTransaction()
$updateCmd.Transaction = $tx
$updated = 0

foreach($item in $updateList) {
    $escaped = $item.name.Replace("'", "''")
    $updateCmd.CommandText = "UPDATE users SET username='$escaped' WHERE user_id=$($item.uid) AND (username IS NULL OR username = '')"
    $updated += $updateCmd.ExecuteNonQuery()
    if($updated % 5000 -eq 0 -and $updated -gt 0) {
        $tx.Commit()
        Write-Host "  $updated updated..."
        $tx = $sqliteConn.BeginTransaction()
        $updateCmd.Transaction = $tx
    }
}
$tx.Commit()
Write-Host "  Total updated: $updated"

Write-Host "Step 5: Verify..."
$sqliteCmd.CommandText = "SELECT COUNT(*) as cnt FROM users WHERE username IS NOT NULL AND username <> ''"
$r = $sqliteCmd.ExecuteReader()
while($r.Read()) { Write-Host "  Non-empty username: $($r['cnt'])" }
$r.Close()
$sqliteCmd.CommandText = "SELECT COUNT(*) as cnt FROM users WHERE username IS NULL OR username = ''"
$r = $sqliteCmd.ExecuteReader()
while($r.Read()) { Write-Host "  Empty username: $($r['cnt'])" }
$r.Close()

$sqliteConn.Close()
Write-Host "Done!"
