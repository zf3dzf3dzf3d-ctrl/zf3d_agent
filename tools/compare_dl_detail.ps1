$ErrorActionPreference = "Stop"

$databases = @(
    @{Name="data/zf3d.db"; Path="C:\work\web\data\zf3d.db"},
    @{Name="private/zf3d.db"; Path="C:\work\web\private\zf3d.db"}
)

foreach ($db in $databases) {
    Write-Output "========================================"
    Write-Output "Database: $($db.Name)"
    Write-Output "========================================"
    
    $conn = New-Object System.Data.Odbc.OdbcConnection
    $conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=$($db.Path);"
    $conn.Open()
    $cmd = $conn.CreateCommand()
    
    # Check series 18 (zbrush) - all episodes with download links
    Write-Output "--- Series 18 episodes with download links ---"
    $cmd.CommandText = "SELECT id, series_id, episode, title, baidu_url, baidu_pass, xinbaidushipin, xinbaidushipin_pass, download_url FROM tutorials WHERE series_id=18 ORDER BY episode"
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        $baidu = $reader["baidu_url"]
        $baiduPass = $reader["baidu_pass"]
        $xinbaidu = $reader["xinbaidushipin"]
        $xinbaiduPass = $reader["xinbaidushipin_pass"]
        $dlUrl = $reader["download_url"]
        Write-Output ("  id=" + $reader['id'] + " ep=" + $reader['episode'] + " title=" + $reader['title'])
        Write-Output ("    baidu_url=" + $baidu + " pass=" + $baiduPass + " | xinbaidushipin=" + $xinbaidu + " pass=" + $xinbaiduPass + " | dl_url=" + $dlUrl)
    }
    $reader.Close()
    
    # Check series 34 - which episodes have download links
    Write-Output "`n--- Series 34 episodes with download links ---"
    $cmd.CommandText = "SELECT id, series_id, episode, title, baidu_url, baidu_pass, xinbaidushipin, xinbaidushipin_pass, download_url FROM tutorials WHERE series_id=34 ORDER BY episode"
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        $baidu = $reader["baidu_url"]
        $baiduPass = $reader["baidu_pass"]
        $xinbaidu = $reader["xinbaidushipin"]
        $xinbaiduPass = $reader["xinbaidushipin_pass"]
        $dlUrl = $reader["download_url"]
        Write-Output ("  id=" + $reader['id'] + " ep=" + $reader['episode'] + " title=" + $reader['title'])
        Write-Output ("    baidu_url=" + $baidu + " pass=" + $baiduPass + " | xinbaidushipin=" + $xinbaidu + " pass=" + $xinbaiduPass + " | dl_url=" + $dlUrl)
    }
    $reader.Close()
    
    # Also check tutorial_series table for download-related columns
    Write-Output "`n--- tutorial_series table structure ---"
    $cmd.CommandText = "PRAGMA table_info(tutorial_series)"
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        Write-Output ("  " + $reader['name'] + " (" + $reader['type'] + ")")
    }
    $reader.Close()
    
    # Check if tutorial_series has any download fields with data
    Write-Output "`n--- tutorial_series sample data ---"
    $cmd.CommandText = "SELECT * FROM tutorial_series LIMIT 3"
    $reader = $cmd.ExecuteReader()
    $cols = @()
    for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
    Write-Output ("Columns: " + ($cols -join ', '))
    while ($reader.Read()) {
        $row = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) {
            $val = $reader.GetValue($i)
            if ($val -and $val.ToString().Length -gt 80) { $val = $val.ToString().Substring(0,80) + "..." }
            $row += $reader.GetName($i) + "=" + $val
        }
        Write-Output ($row -join ' | ')
    }
    $reader.Close()
    
    $conn.Close()
    Write-Output ""
}
