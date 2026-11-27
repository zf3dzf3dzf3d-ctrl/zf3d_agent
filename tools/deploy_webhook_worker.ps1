param(
    [string]$RepoRoot = 'C:\web',
    [string]$AppPoolName = 'www.zf3d.com'
)

$ErrorActionPreference = 'Stop'
$logDir = Join-Path $RepoRoot 'private'
$logFile = Join-Path $logDir 'deploy_webhook.log'
$mutex = New-Object System.Threading.Mutex($false, 'ZF3DDeployWorker')

function Write-DeployLog([string]$Message) {
    $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

try {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    if (-not $mutex.WaitOne(0)) {
        Write-DeployLog 'SKIP another deployment is already running'
        exit 0
    }

    $git = Join-Path ${env:ProgramFiles} 'Git\cmd\git.exe'
    if (-not (Test-Path -LiteralPath $git)) { throw "Git not found: $git" }
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) { throw "Repository not found: $RepoRoot" }

    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = 'never'
    & $git -C $RepoRoot -c safe.directory=$RepoRoot fetch origin main 2>&1 | ForEach-Object { Write-DeployLog "git fetch: $_" }
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }

    $localHead = (& $git -C $RepoRoot rev-parse HEAD).Trim()
    $remoteHead = (& $git -C $RepoRoot rev-parse origin/main).Trim()
    if ($localHead -eq $remoteHead) {
        Write-DeployLog "OK already current $localHead"
        exit 0
    }

    & $git -C $RepoRoot merge --ff-only origin/main 2>&1 | ForEach-Object { Write-DeployLog "git merge: $_" }
    if ($LASTEXITCODE -ne 0) { throw 'git merge failed; server local changes were preserved' }

    $appcmd = Join-Path $env:windir 'System32\inetsrv\appcmd.exe'
    if (Test-Path -LiteralPath $appcmd) {
        & $appcmd recycle apppool "/apppool.name:$AppPoolName" 2>&1 | ForEach-Object { Write-DeployLog "app pool: $_" }
        if ($LASTEXITCODE -ne 0) { Write-DeployLog "WARN app pool recycle failed for $AppPoolName" }
    }
    Write-DeployLog "OK deployed $localHead -> $remoteHead"
}
catch {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Write-DeployLog "ERROR $($_.Exception.Message)"
    exit 1
}
finally {
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
}
