$ErrorActionPreference='Stop'
try{
  New-Item -ItemType Directory -Force 'C:\Program Files\ZCode\resources\app' | Out-Null
  Copy-Item 'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\integrations\zf-zcode\inject\main.js' 'C:\Program Files\ZCode\resources\app\main.js' -Force
  'OK' | Out-File 'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\integrations\zf-zcode\deploy_result.txt' -Encoding utf8
}catch{
  $_.Exception.Message | Out-File 'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\integrations\zf-zcode\deploy_result.txt' -Encoding utf8
}
