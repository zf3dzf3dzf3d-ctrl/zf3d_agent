[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$apiKey = "__AGENT_API_KEY_ROTATED__"
$apiUrl = "https://www.zf3d.com/api/agent_api.asp?key=$apiKey&a=fix_usernames"
$batchSize = 500

Write-Host "Step 1: Load old SQL Server User_Name..."
$sqlConn = New-Object System.Data.SqlClient.SqlConnection("Server=(localdb)\MSSQLLocalDB;Database=zf3ddate_old;Integrated Security=true;TrustServerCertificate=true")
$sqlConn.Open()
$sqlCmd = $sqlConn.CreateCommand()
$sqlCmd.CommandText = "SELECT User_Id, User_Name FROM Tx_User WHERE User_Name IS NOT NULL AND User_Name <> '' ORDER BY User_Id"
$sqlReader = $sqlCmd.ExecuteReader()

$allData = New-Object System.Collections.ArrayList
while($sqlReader.Read()) {
    [void]$allData.Add(@{ id=[int]$sqlReader['User_Id']; name=[string]$sqlReader['User_Name'] })
}
$sqlReader.Close()
$sqlConn.Close()
Write-Host "  Loaded $($allData.Count) users from old DB"

Write-Host "Step 2: Push ALL to server (API skips users that already have username)..."
$totalBatches = [Math]::Ceiling($allData.Count / $batchSize)
$batchIdx = 0
$totalUpdated = 0
$totalSkipped = 0
$totalErrors = 0

for($i = 0; $i -lt $allData.Count; $i += $batchSize) {
    $batchIdx++
    $endIdx = [Math]::Min($i + $batchSize - 1, $allData.Count - 1)
    $batch = $allData[$i..$endIdx]

    $jsonItems = @()
    foreach($item in $batch) {
        $escapedName = $item.name.Replace("\", "\\").Replace('"', '\"')
        $jsonItems += "{""id"":$($item.id),""name"":""$escapedName""}"
    }
    $jsonData = "[" + ($jsonItems -join ",") + "]"

    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes("data=" + [System.Uri]::EscapeDataString($jsonData))

    if($batchIdx % 20 -eq 0) {
        Write-Host "  Batch $batchIdx/$totalBatches ($($i + $batch.Count)/$($allData.Count))... updated=$totalUpdated skipped=$totalSkipped"
    }

    try {
        $resp = Invoke-WebRequest -Uri $apiUrl -Method POST -Body $bodyBytes -ContentType "application/x-www-form-urlencoded" -TimeoutSec 120 -UseBasicParsing
        $respJson = $resp.Content | ConvertFrom-Json
        if($respJson.success) {
            $totalUpdated += $respJson.data.updated
            $totalSkipped += $respJson.data.skipped
            $totalErrors += $respJson.data.errors
        } else {
            Write-Host "  Batch $batchIdx FAILED: $($respJson.message)"
        }
    } catch {
        Write-Host "  Batch $batchIdx ERROR: $_"
    }

    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "=== Final Summary ==="
Write-Host "  Total sent: $($allData.Count)"
Write-Host "  Total updated: $totalUpdated"
Write-Host "  Total skipped (already had name): $totalSkipped"
Write-Host "  Total errors: $totalErrors"
Write-Host "Done!"
