$files = @('C:\work\web\api\content.asp','C:\work\web\api\community.asp')
foreach($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f)
    if($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        Write-Output "$f already has BOM"
    } else {
        $newBytes = New-Object byte[] ($bytes.Length + 3)
        $newBytes[0] = 0xEF
        $newBytes[1] = 0xBB
        $newBytes[2] = 0xBF
        [Array]::Copy($bytes, 0, $newBytes, 3, $bytes.Length)
        [System.IO.File]::WriteAllBytes($f, $newBytes)
        Write-Output "$f BOM added"
    }
}

# Also check comments table structure
$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "PRAGMA table_info(comments)"
$r = $cmd.ExecuteReader()
Write-Output "=== COMMENTS COLUMNS ==="
while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
$r.Close()
$cmd.CommandText = "SELECT DISTINCT target_type FROM comments LIMIT 20"
$r = $cmd.ExecuteReader()
Write-Output ""
Write-Output "=== COMMENT TARGET_TYPES ==="
while($r.Read()) { Write-Output $r['target_type'].ToString() }
$r.Close()
$conn.Close()
