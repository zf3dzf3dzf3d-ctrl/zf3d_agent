# ZCode 界面替换注入脚本
$src = 'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\integrations\zf-zcode\inject'
$dst = 'C:\Program Files\ZCode\resources\app'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\*" $dst -Force
Get-ChildItem $dst
Write-Host 'INJECT OK'
