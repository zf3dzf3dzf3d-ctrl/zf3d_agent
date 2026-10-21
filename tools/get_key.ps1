$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT key, value FROM config WHERE key='agent_api_key'"
$r = $cmd.ExecuteReader()
while($r.Read()) { Write-Host ("key=" + $r['key'] + " value=" + $r['value']) }
$r.Close()
$conn.Close()
