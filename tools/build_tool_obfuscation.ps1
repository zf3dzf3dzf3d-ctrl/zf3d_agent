param(
    [switch]$InitializeSources
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourceDir = Join-Path $PSScriptRoot "tool_sources"
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$toolPages = @(
    @{ Page = "remove_background.asp"; Source = "remove_background.js"; Marker = "remove_background" },
    @{ Page = "sprite_extract.asp"; Source = "sprite_extract.js"; Marker = "sprite_extract" },
    @{ Page = "tile_preview.asp"; Source = "tile_preview.js"; Marker = "tile_preview" },
    @{ Page = "seamless_tile_paint.asp"; Source = "seamless_tile_paint.js"; Marker = "seamless_tile_paint" },
    @{ Page = "layered_image_align.asp"; Source = "layered_image_align.js"; Marker = "layered_image_align" },
    @{ Page = "periodic_lab.asp"; Source = "periodic_lab.js"; Marker = "periodic_lab" }
)

function Read-Utf8Text([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8Text([string]$Path, [string]$Text, [bool]$WithBom) {
    $encoding = if ($WithBom) { $utf8Bom } else { $utf8NoBom }
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Get-AppScriptEnd([string]$Html, [string]$PageName) {
    $matches = [regex]::Matches($Html, '<script\s+src="/assets/js/app\.js\?v=\d+"\s*>\s*</script>', 'IgnoreCase')
    if ($matches.Count -lt 1) {
        throw "Could not find app.js script tag in $PageName"
    }
    $last = $matches[$matches.Count - 1]
    return $last.Index + $last.Length
}

function Extract-InlineToolScript([string]$Html, [string]$PageName) {
    $start = Get-AppScriptEnd $Html $PageName
    $tail = $Html.Substring($start)
    $bodyClose = $tail.LastIndexOf("</body>", [System.StringComparison]::OrdinalIgnoreCase)
    if ($bodyClose -lt 0) {
        throw "Could not find </body> in $PageName"
    }

    $scriptRegion = $tail.Substring(0, $bodyClose)
    $blocks = [regex]::Matches($scriptRegion, '<script>([\s\S]*?)</script>', 'IgnoreCase')
    if ($blocks.Count -lt 1) {
        throw "Could not find inline tool script after app.js in $PageName"
    }

    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($block in $blocks) {
        $parts.Add($block.Groups[1].Value.Trim())
    }
    return [string]::Join("`r`n`r`n", $parts)
}

function New-ObfuscatedLoader([string]$Source, [string]$Marker) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Source)
    $seed = 113 + ($Marker.Length * 17)
    $encoded = New-Object byte[] $bytes.Length

    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $key = ($seed + (($i * 31) % 251) + (($i % 7) * 17)) -band 255
        $encoded[$i] = $bytes[$i] -bxor $key
    }

    $base64 = [Convert]::ToBase64String($encoded)
    $chunks = New-Object System.Collections.Generic.List[string]
    for ($offset = 0; $offset -lt $base64.Length; $offset += 1800) {
        $length = [Math]::Min(1800, $base64.Length - $offset)
        $chunks.Add("'" + $base64.Substring($offset, $length) + "'")
    }
    $chunkText = [string]::Join(",", $chunks)

    return "(function(){var k=$seed,b=[$chunkText].join(''),r=atob(b),a=new Uint8Array(r.length),i=0;for(;i<r.length;i++)a[i]=r.charCodeAt(i)^((k+((i*31)%251)+((i%7)*17))&255);var s=(self.TextDecoder?new TextDecoder('utf-8').decode(a):decodeURIComponent(Array.prototype.map.call(a,function(c){return'%'+('0'+c.toString(16)).slice(-2)}).join('')));Function(s)();})();"
}

function Replace-ToolScript([string]$Html, [string]$Marker, [string]$Loader, [string]$SourceName, [string]$PageName) {
    $begin = "<!-- TOOL_OBFUSCATED_BEGIN:$Marker -->"
    $end = "<!-- TOOL_OBFUSCATED_END:$Marker -->"
    $generated = @"
$begin
<script>
/* Generated from /tools/tool_sources/$SourceName. Run tools/build_tool_obfuscation.ps1 after source edits. */
$Loader
</script>
$end
"@

    if ($Html.Contains($begin) -and $Html.Contains($end)) {
        $pattern = [regex]::Escape($begin) + '[\s\S]*?' + [regex]::Escape($end)
        return [regex]::Replace($Html, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $generated }, 1)
    }

    $start = Get-AppScriptEnd $Html $PageName
    $prefix = $Html.Substring(0, $start)
    $tail = $Html.Substring($start)
    $bodyClose = $tail.LastIndexOf("</body>", [System.StringComparison]::OrdinalIgnoreCase)
    if ($bodyClose -lt 0) {
        throw "Could not find </body> in $PageName"
    }
    $suffix = $tail.Substring($bodyClose)
    return $prefix + "`r`n" + $generated + $suffix
}

if (-not (Test-Path -LiteralPath $sourceDir)) {
    New-Item -ItemType Directory -Path $sourceDir | Out-Null
}

foreach ($tool in $toolPages) {
    $pagePath = Join-Path $repoRoot $tool.Page
    $sourcePath = Join-Path $sourceDir $tool.Source
    $html = Read-Utf8Text $pagePath

    if ($InitializeSources -or -not (Test-Path -LiteralPath $sourcePath)) {
        if ($html.Contains("TOOL_OBFUSCATED_BEGIN:$($tool.Marker)")) {
            if (-not (Test-Path -LiteralPath $sourcePath)) {
                throw "Source file is missing for already-obfuscated page $($tool.Page)"
            }
        } else {
            $source = Extract-InlineToolScript $html $tool.Page
            Write-Utf8Text $sourcePath $source $false
        }
    }

    $sourceText = Read-Utf8Text $sourcePath
    $loader = New-ObfuscatedLoader $sourceText $tool.Marker
    $updatedHtml = Replace-ToolScript $html $tool.Marker $loader $tool.Source $tool.Page
    Write-Utf8Text $pagePath $updatedHtml $true
    Write-Host "obfuscated $($tool.Page) from tools/tool_sources/$($tool.Source)"
}
