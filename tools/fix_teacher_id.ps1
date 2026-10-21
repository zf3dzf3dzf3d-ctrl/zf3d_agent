$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()

# 1. Before fix
$cmd.CommandText = "SELECT teacher_id, COUNT(*) AS cnt FROM tutorial_series GROUP BY teacher_id ORDER BY cnt DESC"
Write-Host "=== BEFORE FIX ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  teacher_id=" + $r['teacher_id'] + " -> " + $r['cnt'] + " series") }
$r.Close()

# 2. Fix numeric teacher -> teacher_id
$cmd.CommandText = "UPDATE tutorial_series SET teacher_id=CAST(teacher AS INTEGER) WHERE teacher GLOB '[0-9]*' AND (teacher_id=0 OR teacher_id IS NULL)"
$affected1 = $cmd.ExecuteNonQuery()
Write-Host ""
Write-Host ("Fixed numeric teacher -> teacher_id: " + $affected1 + " rows")

# 3. Fix text teacher
$cmd.CommandText = "UPDATE tutorial_series SET teacher_id=1 WHERE teacher='朱峰' AND (teacher_id=0 OR teacher_id IS NULL)"
$affected2 = $cmd.ExecuteNonQuery()
Write-Host ("Fixed text '朱峰' -> teacher_id=1: " + $affected2 + " rows")

# 4. After fix
$cmd.CommandText = "SELECT teacher_id, COUNT(*) AS cnt FROM tutorial_series GROUP BY teacher_id ORDER BY cnt DESC"
Write-Host ""
Write-Host "=== AFTER FIX ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  teacher_id=" + $r['teacher_id'] + " -> " + $r['cnt'] + " series") }
$r.Close()

# 5. Check teacher_id=85
$cmd.CommandText = "SELECT id, title, teacher, teacher_id FROM tutorial_series WHERE teacher_id=85"
Write-Host ""
Write-Host "=== teacher_id=85 (not in teachers table) ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  id=" + $r['id'] + " title=" + $r['title'] + " teacher=" + $r['teacher']) }
$r.Close()

$conn.Close()
Write-Host ""
Write-Host "=== DONE ==="
