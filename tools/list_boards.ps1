$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT id, name, sort_order FROM boards ORDER BY id"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Output ($r['id'].ToString() + "|" + $r['name'].ToString() + "|" + $r['sort_order'].ToString()) }
$r.Close()
$conn.Close()
