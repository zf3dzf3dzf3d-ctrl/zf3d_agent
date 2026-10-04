$ErrorActionPreference = "Stop"
$databases = @(
    @{Name="data/zf3d.db (当前生产)"; Path="C:\work\web\data\zf3d.db"},
    @{Name="private/zf3d.db (服务器备份)"; Path="C:\work\web\private\zf3d.db"},
    @{Name="private/zf3d - 副本2.db (旧版)"; Path="C:\work\web\private\zf3d - 副本2.db"}
)

foreach ($db in $databases) {
    Write-Output "========================================"
    Write-Output "Database: $($db.Name)"
    Write-Output "Path: $($db.Path)"
    Write-Output "========================================"
    
    $conn = New-Object System.Data.Odbc.OdbcConnection
    $conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=$($db.Path);"
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand()
        
        # List tables
        $cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        $reader = $cmd.ExecuteReader()
        $tables = @()
        while ($reader.Read()) { $tables += $reader["name"] }
        $reader.Close()
        Write-Output "Tables ($($tables.Count)): $($tables -join ', ')"
        
        # Check episodes table structure
        $cmd.CommandText = "PRAGMA table_info(episodes)"
        $reader = $cmd.ExecuteReader()
        Write-Output "`n--- episodes table structure ---"
        while ($reader.Read()) {
            Write-Output "  cid=$($reader['cid']) name=$($reader['name']) type=$($reader['type'])"
        }
        $reader.Close()
        
        # Check episodes data sample
        $cmd.CommandText = "SELECT COUNT(*) as cnt FROM episodes"
        $reader = $cmd.ExecuteReader()
        if ($reader.Read()) { Write-Output "`nEpisodes count: $($reader['cnt'])" }
        $reader.Close()
        
        # Check download-related columns
        $cmd.CommandText = "SELECT * FROM episodes LIMIT 3"
        $reader = $cmd.ExecuteReader()
        Write-Output "`n--- Sample episodes ---"
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        Write-Output "Columns: $($cols -join ', ')"
        while ($reader.Read()) {
            $row = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $val = $reader.GetValue($i)
                if ($val -and $val.ToString().Length -gt 80) { $val = $val.ToString().Substring(0,80) + "..." }
                $row += "$($reader.GetName($i))=$val"
            }
            Write-Output ($row -join ' | ')
        }
        $reader.Close()
        
        $conn.Close()
    } catch {
        Write-Output "ERROR: $_"
        if ($conn.State -eq 'Open') { $conn.Close() }
    }
    Write-Output ""
}
