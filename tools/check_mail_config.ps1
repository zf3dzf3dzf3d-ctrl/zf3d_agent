$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT key, value FROM config WHERE key LIKE '%mail%' OR key LIKE '%smtp%' OR key LIKE '%email%'"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ($r['key'].ToString() + " = " + $r['value'].ToString()) }
$r.Close()
$conn.Close()
