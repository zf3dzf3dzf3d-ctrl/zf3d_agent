# 查老数据库的老师数据
$conn = New-Object System.Data.SqlClient.SqlConnection
$conn.ConnectionString = "Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_new;Integrated Security=True;"
$conn.Open()
$cmd = $conn.CreateCommand()

# 1. 找包含teacher字段的表
$cmd.CommandText = "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '%teacher%' OR COLUMN_NAME LIKE '%laoshi%' ORDER BY TABLE_NAME"
Write-Host "=== 含teacher/laoshi字段的表 ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  " + $r['TABLE_NAME'] + "." + $r['COLUMN_NAME']) }
$r.Close()

# 2. 系列表Tx_PrClass_e的laoshi字段分布
$cmd.CommandText = "SELECT laoshi, COUNT(*) AS cnt FROM Tx_PrClass_e GROUP BY laoshi ORDER BY cnt DESC"
Write-Host "`n=== Tx_PrClass_e.laoshi 分布 ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  laoshi=" + $r['laoshi'] + " -> " + $r['cnt'] + " series") }
$r.Close()

# 3. 看laoshi有多少不同的值
$cmd.CommandText = "SELECT COUNT(DISTINCT laoshi) AS cnt FROM Tx_PrClass_e WHERE laoshi IS NOT NULL AND laoshi <> ''"
Write-Host "`n=== 不同laoshi值数量 ==="
$r = $cmd.ExecuteReader()
$r.Read()
Write-Host ("  " + $r['cnt'] + " distinct teacher IDs")
$r.Close()

# 4. 是否有老师表
$cmd.CommandText = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%teacher%' OR TABLE_NAME LIKE '%laoshi%' OR TABLE_NAME LIKE '%Tx_User%'"
Write-Host "`n=== 老师/用户相关表 ==="
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("  " + $r['TABLE_NAME']) }
$r.Close()

$conn.Close()
