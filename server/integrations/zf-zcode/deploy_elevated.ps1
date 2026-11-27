# Deploy ZCode maximize fix (elevated) - self-contained, no CJK path dependency
$dstDir = 'C:\Program Files\ZCode\resources\app'
$dst = Join-Path $dstDir 'main.js'
$log = 'C:\zcode_deploy_result.txt'
try {
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    # locate source main.js (path contains CJK, resolved at runtime)
    $root = 'F:\'
    $src = Get-ChildItem -Path $root -Filter 'main.js' -Recurse -Depth 6 -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*zf-zcode*inject*main.js' } | Select-Object -First 1
    if (-not $src) { throw 'source main.js not found' }
    Copy-Item -Path $src.FullName -Destination $dst -Force
    "OK src=$($src.FullName)" | Out-File $log -Encoding utf8
} catch {
    "FAIL $($_.Exception.Message)" | Out-File $log -Encoding utf8
}
