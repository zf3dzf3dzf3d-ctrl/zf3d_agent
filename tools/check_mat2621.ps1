$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT id, name, parent_id, jifen, baidu_url, baidu_password, rar, jieshao FROM material_maps WHERE id=2621"
$r = $cmd.ExecuteReader()
while($r.Read()) {
    for($i=0; $i -lt $r.FieldCount; $i++) {
        Write-Host ($r.GetName($i) + " = " + $r[$i])
    }
}
$r.Close()
$conn.Close()
