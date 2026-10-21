$logFile = "C:\inetpub\logs\LogFiles\W3SVC2\u_ex260724.log"
$lines = Get-Content $logFile
$total = 0
$status200 = 0
$status302 = 0
$status304 = 0
$status404 = 0
$status500 = 0
$statusOther = 0
$urls = @{}
$ips = @{}
$uas = @{}
$aspPages = @{}
$totalTime = 0
$slowReqs = @()

foreach ($line in $lines) {
    if ($line -match "^#") { continue }
    $total++
    $parts = $line -split " "
    if ($parts.Count -lt 14) { continue }
    
    $method = $parts[3]
    $uri = $parts[4]
    $status = $parts[11]
    $ip = $parts[8]
    $ua = $parts[9]
    $timeTaken = 0
    [int]::TryParse($parts[13], [ref]$timeTaken) | Out-Null
    $totalTime += $timeTaken
    
    # Status codes
    switch -Wildcard ($status) {
        "200" { $status200++ }
        "302" { $status302++ }
        "304" { $status304++ }
        "404" { $status404++ }
        "500" { $status500++ }
        default { $statusOther++ }
    }
    
    # Top URIs
    if ($urls.ContainsKey($uri)) { $urls[$uri]++ } else { $urls[$uri] = 1 }
    
    # Top IPs
    if ($ips.ContainsKey($ip)) { $ips[$ip]++ } else { $ips[$ip] = 1 }
    
    # ASP pages
    if ($uri -match "\.asp") {
        if ($aspPages.ContainsKey($uri)) { $aspPages[$uri]++ } else { $aspPages[$uri] = 1 }
    }
    
    # Slow requests (>2000ms)
    if ($timeTaken -gt 2000) {
        $slowReqs += "$method $uri $status ${timeTaken}ms $ip"
    }
}

Write-Output "=== IIS Log Analysis: 2026-07-24 ==="
Write-Output "Total Requests: $total"
Write-Output ""
Write-Output "--- Status Codes ---"
Write-Output "200 OK:       $status200"
Write-Output "302 Redirect: $status302"
Write-Output "304 NotMod:   $status304"
Write-Output "404 NotFound: $status404"
Write-Output "500 Error:    $status500"
Write-Output "Other:        $statusOther"
Write-Output ""
Write-Output "--- Top 20 URLs ---"
$urls.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 20 | ForEach-Object { Write-Output ("{0,6} {1}" -f $_.Value, $_.Key) }
Write-Output ""
Write-Output "--- Top 15 ASP Pages ---"
$aspPages.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object { Write-Output ("{0,6} {1}" -f $_.Value, $_.Key) }
Write-Output ""
Write-Output "--- Top 15 IPs ---"
$ips.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object { Write-Output ("{0,6} {1}" -f $_.Value, $_.Key) }
Write-Output ""
Write-Output "--- Slow Requests (>2000ms): $($slowReqs.Count) ---"
$slowReqs | Select-Object -First 20 | ForEach-Object { Write-Output $_ }
