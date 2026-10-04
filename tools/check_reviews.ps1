$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()

# Check user_reviews table structure
$cmd.CommandText = "PRAGMA table_info(user_reviews)"
$r = $cmd.ExecuteReader()
Write-Output "=== USER_REVIEWS COLUMNS ==="
while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
$r.Close()

# Sample data
$cmd.CommandText = "SELECT * FROM user_reviews LIMIT 5"
$r = $cmd.ExecuteReader()
$first = $true
while($r.Read()) {
    if($first) {
        $h = @()
        for($i=0; $i -lt $r.FieldCount; $i++) { $h += $r.GetName($i) }
        Write-Output ""
        Write-Output "=== SAMPLE DATA (headers) ==="
        Write-Output ($h -join " | ")
        $first = $false
    }
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString().Substring(0, [Math]::Min(80, $r[$i].ToString().Length)) }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check if any reviews link to works
$cmd.CommandText = "SELECT COUNT(*) FROM user_reviews"
Write-Output ""
Write-Output "Total user_reviews: $($cmd.ExecuteScalar())"

# Check what target_type or similar field exists
$cmd.CommandText = "SELECT DISTINCT target_type FROM user_reviews LIMIT 10" 
try {
    $r = $cmd.ExecuteReader()
    Write-Output "target_types:"
    while($r.Read()) { Write-Output $r[0] }
    $r.Close()
} catch {
    Write-Output "No target_type column"
}

$conn.Close()
