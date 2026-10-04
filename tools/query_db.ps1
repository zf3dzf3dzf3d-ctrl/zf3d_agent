$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()

# List all tables
$cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
$r = $cmd.ExecuteReader()
Write-Output "=== TABLES ==="
while($r.Read()) { Write-Output $r['name'] }
$r.Close()

# Count records in key tables
$tables = @("works","posts","articles","tutorials","comments","software","teachers","tutorial_series","sub_categories","categories","boards","material_categories","models","model_files","map","map_dalei","map_fenlei","shipinjiaocheng","peixun","job_posts","user_reviews","users")
Write-Output ""
Write-Output "=== COUNTS ==="
foreach($t in $tables) {
    try {
        $cmd.CommandText = "SELECT COUNT(*) as cnt FROM $t"
        $cnt = $cmd.ExecuteScalar()
        Write-Output "$t : $cnt"
    } catch {
        Write-Output "$t : (not found)"
    }
}

# Check works table structure
Write-Output ""
Write-Output "=== WORKS COLUMNS ==="
$cmd.CommandText = "PRAGMA table_info(works)"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
$r.Close()

# Check posts table structure
Write-Output ""
Write-Output "=== POSTS COLUMNS ==="
$cmd.CommandText = "PRAGMA table_info(posts)"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
$r.Close()

# Check articles table structure
Write-Output ""
Write-Output "=== ARTICLES COLUMNS ==="
$cmd.CommandText = "PRAGMA table_info(articles)"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
$r.Close()

# Check boards table
Write-Output ""
Write-Output "=== BOARDS ==="
$cmd.CommandText = "SELECT * FROM boards LIMIT 20"
$r = $cmd.ExecuteReader()
while($r.Read()) {
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString() }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check categories table
Write-Output ""
Write-Output "=== CATEGORIES ==="
$cmd.CommandText = "SELECT * FROM categories ORDER BY id"
$r = $cmd.ExecuteReader()
while($r.Read()) {
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString() }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check sub_categories
Write-Output ""
Write-Output "=== SUB_CATEGORIES ==="
$cmd.CommandText = "SELECT * FROM sub_categories ORDER BY parent_category_id, sort_order LIMIT 50"
$r = $cmd.ExecuteReader()
while($r.Read()) {
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString() }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check tutorials with rls=2 (software)
Write-Output ""
Write-Output "=== TUTORIALS rls=2 (SOFTWARE) COUNT ==="
$cmd.CommandText = "SELECT COUNT(*) FROM tutorials WHERE rls=2"
Write-Output $cmd.ExecuteScalar()

# Check software table
Write-Output ""
Write-Output "=== SOFTWARE ==="
$cmd.CommandText = "SELECT * FROM software LIMIT 10"
$r = $cmd.ExecuteReader()
while($r.Read()) {
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString() }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check works sample
Write-Output ""
Write-Output "=== WORKS SAMPLE ==="
$cmd.CommandText = "SELECT * FROM works LIMIT 3"
$r = $cmd.ExecuteReader()
$first = $true
while($r.Read()) {
    if($first) {
        $headers = @()
        for($i=0; $i -lt $r.FieldCount; $i++) { $headers += $r.GetName($i) }
        Write-Output ($headers -join " | ")
        $first = $false
    }
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString() }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check posts sample
Write-Output ""
Write-Output "=== POSTS SAMPLE ==="
$cmd.CommandText = "SELECT * FROM posts LIMIT 3"
$r = $cmd.ExecuteReader()
$first = $true
while($r.Read()) {
    if($first) {
        $headers = @()
        for($i=0; $i -lt $r.FieldCount; $i++) { $headers += $r.GetName($i) }
        Write-Output ($headers -join " | ")
        $first = $false
    }
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString() }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check articles sample
Write-Output ""
Write-Output "=== ARTICLES SAMPLE ==="
$cmd.CommandText = "SELECT * FROM articles LIMIT 3"
$r = $cmd.ExecuteReader()
$first = $true
while($r.Read()) {
    if($first) {
        $headers = @()
        for($i=0; $i -lt $r.FieldCount; $i++) { $headers += $r.GetName($i) }
        Write-Output ($headers -join " | ")
        $first = $false
    }
    $row = @()
    for($i=0; $i -lt $r.FieldCount; $i++) { $row += $r[$i].ToString() }
    Write-Output ($row -join " | ")
}
$r.Close()

# Check shipinjiaocheng table if exists
Write-Output ""
Write-Output "=== SHIPINJIAOCHENG ==="
try {
    $cmd.CommandText = "SELECT COUNT(*) FROM shipinjiaocheng"
    Write-Output ("count: " + $cmd.ExecuteScalar())
    $cmd.CommandText = "PRAGMA table_info(shipinjiaocheng)"
    $r = $cmd.ExecuteReader()
    while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
    $r.Close()
} catch {
    Write-Output "shipinjiaocheng table not found"
}

# Check map tables if exist
Write-Output ""
Write-Output "=== MAP TABLES ==="
foreach($t in @("map","map_dalei","map_fenlei","map_img")) {
    try {
        $cmd.CommandText = "SELECT COUNT(*) FROM $t"
        Write-Output ("$t count: " + $cmd.ExecuteScalar())
    } catch {
        Write-Output "$t not found"
    }
}

# Check models table if exists
Write-Output ""
Write-Output "=== MODELS TABLE ==="
try {
    $cmd.CommandText = "SELECT COUNT(*) FROM models"
    Write-Output ("count: " + $cmd.ExecuteScalar())
    $cmd.CommandText = "PRAGMA table_info(models)"
    $r = $cmd.ExecuteReader()
    while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
    $r.Close()
} catch {
    Write-Output "models table not found"
}

# Check users table structure
Write-Output ""
Write-Output "=== USERS COLUMNS ==="
$cmd.CommandText = "PRAGMA table_info(users)"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Output ($r['name'].ToString() + " | " + $r['type'].ToString()) }
$r.Close()

$conn.Close()
