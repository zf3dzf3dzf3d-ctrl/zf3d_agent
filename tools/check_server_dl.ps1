$ErrorActionPreference = "Stop"

# Query server database via exec_sql.asp
$url = "http://www.zf3d.com/api/exec_sql.asp"
$body = "sql=SELECT series_id, COUNT(*) as ep_cnt, SUM(CASE WHEN (baidu_url IS NOT NULL AND baidu_url<>'') OR (xinbaidushipin IS NOT NULL AND xinbaidushipin<>'') THEN 1 ELSE 0 END) as dl_cnt FROM tutorials GROUP BY series_id HAVING dl_cnt > 0 ORDER BY series_id LIMIT 30"

$headers = @{
    "Content-Type" = "application/x-www-form-urlencoded"
}

Write-Output "Querying server database..."
$response = Invoke-RestMethod -Uri $url -Method Post -Body $body -Headers $headers -TimeoutSec 30
Write-Output ($response | ConvertTo-Json -Depth 10)
