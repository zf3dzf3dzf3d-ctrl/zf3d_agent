param(
    [string]$RepoRoot = 'C:\web',
    [string]$Secret = ''
)

$ErrorActionPreference = 'Stop'
$secretPath = Join-Path $RepoRoot 'private\deploy_webhook_secret.txt'
if ([string]::IsNullOrWhiteSpace($Secret)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $Secret = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
if ($Secret.Length -lt 32) { throw 'Secret must be at least 32 characters.' }

New-Item -ItemType Directory -Force -Path (Split-Path $secretPath) | Out-Null
[System.IO.File]::WriteAllText($secretPath, $Secret + "`n", [System.Text.Encoding]::ASCII)

# The private directory already grants the site its required access to the database and logs.
# Resetting inheritance keeps this secret aligned with the site's actual IIS identity.
& icacls $secretPath /reset | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Could not restore inherited IIS access to $secretPath" }

Write-Host ''
Write-Host 'Gitee WebHook URL:' -ForegroundColor Cyan
Write-Host 'https://www.zf3d.com/deploy_webhook.asp'
Write-Host 'Select only: Push'
Write-Host 'Paste this value into the Gitee WebHook password field:' -ForegroundColor Yellow
Write-Host $Secret -ForegroundColor Green
Write-Host ''
Write-Host 'The secret is stored only at:' $secretPath
