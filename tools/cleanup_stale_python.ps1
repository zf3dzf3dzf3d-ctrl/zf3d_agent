# ============================================================
# ZF3D Agent - stale python process cleanup (whitelist, safe)
# Only kills: python.exe launched by THIS project's bundled python,
#             whose command line belongs to THIS project's server,
#             skipping the ACTIVE instance (the one listening on the port).
# Usage: powershell -File tools\cleanup_stale_python.ps1 [-KillAll]
#   default : clean stale (non-listening) instances only
#   -KillAll: kill ALL project server processes (full restart)
# ============================================================
param([switch]$KillAll)

$ErrorActionPreference = 'SilentlyContinue'
$root    = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pyExe   = Join-Path $root 'python\python.exe'
$port    = 8522
$portFile = Join-Path $root 'private\port.json'
if (Test-Path $portFile) {
    try { $port = (Get-Content $portFile -Raw | ConvertFrom-Json).api_port } catch {}
}

Write-Host "Project root : $root"
Write-Host "Server port  : $port"
Write-Host ""

# ---- 1. Find ACTIVE instance (listening on server port), never kill it ----
$activePids = @()
$netOut = netstat -ano | Select-String ":$port\s.*LISTENING"
foreach ($line in $netOut) {
    $p = ($line -split '\s+')[-1]
    if ($p -match '^\d+$') { $activePids += [int]$p }
}
if ($activePids.Count -gt 0) {
    Write-Host ("[ACTIVE] Port {0} is served by PID {1} - kept." -f $port, ($activePids -join ','))
} else {
    Write-Host "[INFO] No active server on port $port."
}
Write-Host ""

# ---- 2. Scan all python.exe, whitelist filter ----
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe'"
$killed = 0; $kept = 0; $skipped = 0
foreach ($p in $procs) {
    $exe  = $p.ExecutablePath
    $cmd  = $p.CommandLine
    $pid2 = $p.ProcessId

    # rule 1: must be THIS project's bundled python
    if (-not $exe) { $skipped++; continue }
    try { $exeN = (Resolve-Path $exe).Path } catch { $skipped++; continue }
    if ($exeN -ne $pyExe) { $skipped++; continue }   # other python: skip

    # rule 2: command line must belong to THIS project
    $isOurs = ($cmd -match 'server[/\\]server\.py') -or ($cmd -like "*$root*")
    if (-not $isOurs) { $skipped++; continue }

    # rule 3: never kill the restart flow itself (restart_server.py --inner),
    #         otherwise one-key restart kills its own inner process and never
    #         gets to start the new server (log stops right after cleanup)
    if ($cmd -match 'restart_server\.py') { $skipped++; continue }

    # rule 3.5: never kill the local AI proxy gateway (ai_proxy.py, port 8787)
    #           it is a long-running helper started at boot; killing it breaks
    #           ALL 朱峰 model calls (WinError 10061) and end users can't recover.
    #           It matches rule 1/2 (our bundled python + our root path) but is
    #           NOT the server, so it must be whitelisted here.
    if ($cmd -match 'ai_proxy\.py') { $skipped++; continue }

    # rule 4: active instance is kept (unless -KillAll)
    if (-not $KillAll -and ($activePids -contains $pid2)) {
        Write-Host ("[KEEP] PID {0} is the active server: {1}" -f $pid2, $cmd)
        $kept++; continue
    }

    Stop-Process -Id $pid2 -Force -ErrorAction SilentlyContinue
    if ($?) {
        Write-Host ("[KILL] Stale process PID {0} terminated: {1}" -f $pid2, $cmd)
        $killed++
    } else {
        Write-Host ("[FAIL] PID {0} could not be terminated." -f $pid2)
    }
}

Write-Host ""
Write-Host ("Result: killed {0} | kept active {1} | skipped {2}" -f $killed, $kept, $skipped)
exit 0
