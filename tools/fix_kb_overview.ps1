<# fix_kb_overview.ps1 — 更新 kb_site_overview #>
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dbPath = "C:\work\web\data\zf3d.db"
$srcPath = "C:\work\web\tools\kb_site_overview.txt"

$kbOverview = [System.IO.File]::ReadAllText($srcPath, [System.Text.Encoding]::UTF8)

$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=$dbPath;"
$conn.Open()

$cmd = $conn.CreateCommand()
$cmd.CommandText = "UPDATE config SET value=? WHERE key='kb_site_overview'"
$p = $cmd.Parameters.Add("@v", [System.Data.Odbc.OdbcType]::Text)
$p.Value = $kbOverview
$r = $cmd.ExecuteNonQuery()
Write-Host "kb_site_overview updated: $r row(s)"

$cmd2 = $conn.CreateCommand()
$cmd2.CommandText = "SELECT substr(value, 1, 120) as preview FROM config WHERE key='kb_site_overview'"
$reader = $cmd2.ExecuteReader()
while ($reader.Read()) {
    Write-Host ""
    Write-Host "=== kb_site_overview ==="
    Write-Host $reader['preview']
}
$reader.Close()
$conn.Close()
Write-Host ""
Write-Host "Done!"
