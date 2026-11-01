# ZCode 还原脚本：删除注入目录即恢复原版
$dst = 'C:\Program Files\ZCode\resources\app'
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force; Write-Host 'RESTORED' } else { Write-Host 'ALREADY CLEAN' }
