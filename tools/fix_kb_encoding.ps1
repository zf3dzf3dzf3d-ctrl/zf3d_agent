<# fix_kb_encoding.ps1 — 修复 kb_help 和 kb_tutorial 乱码 #>
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$dbPath = "C:\work\web\data\zf3d.db"
$helpPath = "C:\work\web\tools\kb_help.txt"
$tutPath = "C:\work\web\tools\kb_tutorial.txt"

$kbHelp = [System.IO.File]::ReadAllText($helpPath, [System.Text.Encoding]::UTF8)
$kbTutorial = [System.IO.File]::ReadAllText($tutPath, [System.Text.Encoding]::UTF8)

$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=$dbPath;"
$conn.Open()

$cmd1 = $conn.CreateCommand()
$cmd1.CommandText = "UPDATE config SET value=? WHERE key='kb_help'"
$p1 = $cmd1.Parameters.Add("@v", [System.Data.Odbc.OdbcType]::Text)
$p1.Value = $kbHelp
$r1 = $cmd1.ExecuteNonQuery()
Write-Host "kb_help updated: $r1 row(s)"

$cmd2 = $conn.CreateCommand()
$cmd2.CommandText = "UPDATE config SET value=? WHERE key='kb_tutorial'"
$p2 = $cmd2.Parameters.Add("@v", [System.Data.Odbc.OdbcType]::Text)
$p2.Value = $kbTutorial
$r2 = $cmd2.ExecuteNonQuery()
Write-Host "kb_tutorial updated: $r2 row(s)"

$cmd3 = $conn.CreateCommand()
$cmd3.CommandText = "SELECT key, substr(value, 1, 80) as preview FROM config WHERE key IN ('kb_help','kb_tutorial','kb_site_overview') ORDER BY key"
$reader = $cmd3.ExecuteReader()
while ($reader.Read()) {
    Write-Host ""
    Write-Host "=== $($reader['key']) ==="
    Write-Host $reader['preview']
}
$reader.Close()
$conn.Close()
Write-Host ""
Write-Host "Done!"
