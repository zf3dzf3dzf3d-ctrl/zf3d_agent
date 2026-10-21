$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()

# 1. teacher field is text (not numeric)
$cmd.CommandText = "SELECT teacher, COUNT(*) AS cnt FROM tutorial_series WHERE teacher IS NOT NULL AND teacher <> '' AND teacher NOT GLOB '[0-9]*' GROUP BY teacher ORDER BY cnt DESC"
Write-Host "=== teacher field is TEXT (not number) ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  teacher='" + $r['teacher'] + "' -> " + $r['cnt'] + " series") }
$r.Close()

# 2. teacher field is numeric but teacher_id is 0
$cmd.CommandText = "SELECT teacher, COUNT(*) AS cnt FROM tutorial_series WHERE teacher GLOB '[0-9]*' AND (teacher_id=0 OR teacher_id IS NULL) GROUP BY teacher ORDER BY cnt DESC"
Write-Host "`n=== teacher is number but teacher_id=0 ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  teacher='" + $r['teacher'] + "' -> " + $r['cnt'] + " series (teacher_id=0)") }
$r.Close()

# 3. teacher_id is set but teacher field doesn't match
$cmd.CommandText = "SELECT id, title, teacher, teacher_id FROM tutorial_series WHERE teacher_id > 0 LIMIT 10"
Write-Host "`n=== series with teacher_id > 0 ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  id=" + $r['id'] + " title=" + $r['title'] + " teacher='" + $r['teacher'] + "' teacher_id=" + $r['teacher_id']) }
$r.Close()

# 4. teacher is NULL or empty
$cmd.CommandText = "SELECT COUNT(*) AS cnt FROM tutorial_series WHERE teacher IS NULL OR teacher=''"
Write-Host "`n=== series with empty teacher ==="
$r = $cmd.ExecuteReader()
$r.Read()
Write-Host ("  empty teacher: " + $r['cnt'] + " series")
$r.Close()

# 5. total count
$cmd.CommandText = "SELECT COUNT(*) AS cnt FROM tutorial_series"
$r = $cmd.ExecuteReader()
$r.Read()
Write-Host ("`n  total series: " + $r['cnt'])
$r.Close()

# 6. teacher field value not in teachers.id
$cmd.CommandText = "SELECT DISTINCT teacher FROM tutorial_series WHERE teacher GLOB '[0-9]*' AND CAST(teacher AS INTEGER) NOT IN (SELECT id FROM teachers) ORDER BY teacher"
Write-Host "`n=== teacher IDs not in teachers table ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  teacher=" + $r['teacher'] + " (not in teachers table!)") }
$r.Close()

$conn.Close()
