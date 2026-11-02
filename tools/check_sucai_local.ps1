$c = New-Object System.Data.Odbc.OdbcConnection('Driver={SQLite3 ODBC Driver};Database=C:/work/web/data/zf3d.db;')
$c.Open()
$cmd = $c.CreateCommand()

Write-Host "=== tutorials 表相关列 ==="
$cmd.CommandText = "SELECT name FROM pragma_table_info('tutorials') WHERE name LIKE '%sucai%' OR name LIKE '%baidu%' OR name LIKE '%download%' OR name LIKE '%pass%'"
$r = $cmd.ExecuteReader()
while($r.Read()){ Write-Host ("  列: " + $r[0]) }
$r.Close()

Write-Host "=== 有素材的课程统计 ==="
$cmd.CommandText = "SELECT COUNT(*) FROM tutorials WHERE xinbaidushucai IS NOT NULL AND TRIM(xinbaidushucai) <> ''"
Write-Host ("  有素材链接的课程数: " + $cmd.ExecuteScalar())

$cmd.CommandText = "SELECT COUNT(*) FROM tutorials"
Write-Host ("  课程总数: " + $cmd.ExecuteScalar())

Write-Host "=== 素材课程样例(前5) ==="
$cmd.CommandText = "SELECT id, substr(title,1,30), substr(xinbaidushucai,1,40), substr(xinbaidushucai_pass,1,10) FROM tutorials WHERE xinbaidushucai IS NOT NULL AND TRIM(xinbaidushucai) <> '' LIMIT 5"
$r = $cmd.ExecuteReader()
while($r.Read()){ Write-Host ("  id=" + $r[0] + " | " + $r[1] + " | " + $r[2] + " | 提取码:" + $r[3]) }
$r.Close()
$c.Close()
