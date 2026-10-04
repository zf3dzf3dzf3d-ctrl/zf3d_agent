$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "PRAGMA table_info(material_maps)"
$r = $cmd.ExecuteReader()
while($r.Read()) {
    Write-Host ($r['name'].ToString() + " (" + $r['type'].ToString() + ")")
}
$r.Close()
$conn.Close()
