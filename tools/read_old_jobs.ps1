[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

# Connect to old remote SQL Server
$connStr = "Server=WIN-54SPUGJORVL;Database=zf3ddate;User Id=sqlkande2;Password=dfg4gasfader3rtfaWSFDST32;TrustServerCertificate=true;"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()
Write-Host "Connected to zf3ddate"

# Read zp_zwyq (recruitment)
Write-Host "Reading zp_zwyq..."
$zpCmd = $conn.CreateCommand()
$zpCmd.CommandText = "SELECT id, user_id, zwbt, zwms, data FROM zp_zwyq ORDER BY id ASC"
$zpReader = $zpCmd.ExecuteReader()
$zpList = @()
while ($zpReader.Read()) {
    $zpList += @{
        user_id = if ($zpReader["user_id"] -ne [DBNull]::Value) { [int]$zpReader["user_id"] } else { 0 }
        title = ($zpReader["zwbt"] -as [string])
        content = ($zpReader["zwms"] -as [string])
        date = if ($zpReader["data"] -ne [DBNull]::Value) { ($zpReader["data"] -as [string]) } else { "" }
    }
}
$zpReader.Close()
Write-Host "Read $($zpList.Count) recruitment records"

# Read rc_grtj (job seeking)
Write-Host "Reading rc_grtj..."
$rcCmd = $conn.CreateCommand()
$rcCmd.CommandText = "SELECT id, user_id, title, nr, shijian FROM rc_grtj ORDER BY id ASC"
$rcReader = $rcCmd.ExecuteReader()
$rcList = @()
while ($rcReader.Read()) {
    $rcList += @{
        user_id = if ($rcReader["user_id"] -ne [DBNull]::Value) { [int]$rcReader["user_id"] } else { 0 }
        title = ($rcReader["title"] -as [string])
        content = ($rcReader["nr"] -as [string])
        date = if ($rcReader["shijian"] -ne [DBNull]::Value) { ($rcReader["shijian"] -as [string]) } else { "" }
    }
}
$rcReader.Close()
Write-Host "Read $($rcList.Count) job seeking records"

$conn.Close()

# Output JSON
$result = @{ zp = $zpList; rc = $rcList }
$json = $result | ConvertTo-Json -Depth 3 -Compress
$json | Out-File -FilePath "C:\work\web\tools\jobs_data.json" -Encoding UTF8
Write-Host "JSON written. zp=$($zpList.Count), rc=$($rcList.Count)"
