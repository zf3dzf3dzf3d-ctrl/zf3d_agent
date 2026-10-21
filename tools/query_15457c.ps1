$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=C:\work\web\data\zf3d.db;"
$conn.Open()
$cmd = $conn.CreateCommand()

# 查 tutorials 表的所有字段名
$cmd.CommandText = "PRAGMA table_info(tutorials)"
$reader = $cmd.ExecuteReader()
$allFields = @()
while($reader.Read()){ $allFields += $reader['name'].ToString() }
$reader.Close()

# 查 15457 所有字段的值
foreach($field in $allFields){
    $cmd.CommandText = "SELECT [$field] FROM tutorials WHERE id=15457"
    $reader = $cmd.ExecuteReader()
    while($reader.Read()){
        $val = $reader.GetValue(0)
        if($val -ne $null -and $val.ToString() -ne ""){
            Write-Output ("$field = [" + $val.ToString().Substring(0, [Math]::Min(300, $val.ToString().Length)) + "]")
        }
    }
    $reader.Close()
}

$conn.Close()
