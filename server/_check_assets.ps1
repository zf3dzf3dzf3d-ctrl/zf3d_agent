$h = (Invoke-WebRequest 'http://127.0.0.1:8620/' -UseBasicParsing -TimeoutSec 10).Content
$m = [regex]::Matches($h, 'src="([^"]+)"')
$m | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 30
Write-Output '---- slow check ----'
foreach ($u in ($m | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 25)) {
  $url = 'http://127.0.0.1:8620/' + $u.TrimStart('/')
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 15
    $sw.Stop()
    Write-Output ($u + ' ' + $r.StatusCode + ' ' + $sw.ElapsedMilliseconds + 'ms len=' + $r.Content.Length)
  } catch {
    Write-Output ($u + ' FAIL ' + $_.Exception.Message)
  }
}
