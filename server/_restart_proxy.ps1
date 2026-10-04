$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = 'F:\' + [char]0x6731 + [char]0x5CF0 + [char]0x793E + [char]0x533A + [char]0x667A + [char]0x80FD + [char]0x4F53 + [char]0x65E0 + [char]0x9650 + '_' + [char]0x65B0 + [char]0x7248 + [char]0x672C + '\' + [char]0x6731 + [char]0x5CF0 + [char]0x793E + [char]0x533A + [char]0x667A + [char]0x80FD + [char]0x4F53 + [char]0x65E0 + [char]0x9650 + '_5.4.5'
Stop-Process -Id 372 -Force -ErrorAction SilentlyContinue
Start-Sleep 1
Start-Process -FilePath 'F:\ZFWEB\python\python.exe' -ArgumentList 'ai_proxy.py' -WorkingDirectory $root -WindowStyle Hidden
Start-Sleep 4
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess | Format-Table -Auto
try { (Invoke-WebRequest -Uri http://127.0.0.1:8787/health -UseBasicParsing -TimeoutSec 10).Content } catch { $_.Exception.Message }
