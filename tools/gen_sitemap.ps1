# gen_sitemap.ps1 — 生成sitemap.xml（超过5万条自动拆分）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dbPath = "C:\work\web\data\zf3d.db"
$baseUrl = "https://www.zf3d.com"
$today = (Get-Date).ToString("yyyy-MM-dd")
$outDir = "C:\work\web"
$maxUrls = 50000

$conn = New-Object System.Data.Odbc.OdbcConnection
$conn.ConnectionString = "Driver={SQLite3 ODBC Driver};Database=$dbPath;"
$conn.Open()

# 收集所有URL
$list = [System.Collections.Generic.List[object]]::new()

# 固定页面
$fixed = @("$baseUrl/|daily|1.0","$baseUrl/Prclassi.asp|daily|0.9","$baseUrl/jiaocheng.asp|daily|0.8","$baseUrl/zuopin_fenlei.asp|daily|0.8","$baseUrl/moxingku.asp|daily|0.8","$baseUrl/shipinjiaocheng_fenlei.asp|daily|0.8","$baseUrl/Prclassi_rjxz.asp|daily|0.8","$baseUrl/caizhi_fenlei.asp|daily|0.8","$baseUrl/bbs_class.asp|daily|0.8","$baseUrl/vip.asp|monthly|0.6","$baseUrl/login.html|monthly|0.5","$baseUrl/userinfo_chakan.asp|weekly|0.5","$baseUrl/privacy.html|yearly|0.3","$baseUrl/agreement.html|yearly|0.3","$baseUrl/xinxi_chakan.asp|weekly|0.4","$baseUrl/aigc_list.asp|daily|0.8","$baseUrl/aigc_list.asp?type=image|daily|0.7","$baseUrl/aigc_list.asp?type=video|daily|0.7","$baseUrl/aigc_list.asp?type=game|daily|0.7","$baseUrl/aigc_list.asp?type=software|daily|0.7","$baseUrl/agent.asp|monthly|0.5")
foreach ($f in $fixed) { $p = $f.Split("|"); $list.Add(@($p[0],$p[1],$p[2])) }

# 查询所有动态URL
$queries = @(
    @("SELECT DISTINCT parent_category_id FROM sub_categories WHERE parent_category_id>0", "$baseUrl/Prclassi.asp?zlz=", "weekly", "0.7"),
    @("SELECT id FROM sub_categories ORDER BY id", "$baseUrl/Prclassi.asp?zl=", "weekly", "0.7"),
    @("SELECT id FROM software ORDER BY id", "$baseUrl/Prclassi.asp?rj=", "weekly", "0.7"),
    @("SELECT DISTINCT category_id FROM software ORDER BY category_id", "$baseUrl/Prclassi.asp?rjz=", "weekly", "0.7"),
    @("SELECT id FROM teachers ORDER BY id", "$baseUrl/Prclassi.asp?ls=", "weekly", "0.7"),
    @("SELECT id FROM tutorial_series ORDER BY id", "$baseUrl/Prclassi_xl.asp?id=", "weekly", "0.8"),
    @("SELECT id FROM tutorials WHERE rls<>2 ORDER BY id", "$baseUrl/Products.asp?id=", "monthly", "0.6"),
    @("SELECT id FROM works ORDER BY id", "$baseUrl/zuopin_chakan.asp?id=", "monthly", "0.5"),
    @("SELECT id FROM articles ORDER BY id", "$baseUrl/News.asp?id=", "monthly", "0.6"),
    @("SELECT id FROM external_videos ORDER BY id", "$baseUrl/shipinjiaocheng.asp?id=", "monthly", "0.5"),
    @("SELECT id FROM tutorials WHERE rls=2 ORDER BY id", "$baseUrl/Products_rj.asp?id=", "monthly", "0.5")
)
foreach ($q in $queries) {
    $sql = $q[0]; $urlBase = $q[1]; $cf = $q[2]; $pr = $q[3]
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql
    $da = New-Object System.Data.Odbc.OdbcDataAdapter($cmd); $dt = New-Object System.Data.DataTable
    [void]$da.Fill($dt)
    foreach ($row in $dt.Rows) { $list.Add(@("$urlBase$($row.Item(0))", $cf, $pr)) }
    $da.Dispose(); $dt.Dispose()
}
$conn.Close()

# 拆分写入
$total = $list.Count
$files = [Math]::Ceiling($total / $maxUrls)
Write-Host "Total URLs: $total, splitting into $files files"

for ($f = 0; $f -lt $files; $f++) {
    $start = $f * $maxUrls
    $end = [Math]::Min(($f + 1) * $maxUrls - 1, $total - 1)
    $fileName = if ($files -eq 1) { "sitemap.xml" } else { "sitemap$($f+1).xml" }
    $outPath = "$outDir\$fileName"

    $sw = [System.IO.StreamWriter]::new($outPath, $false, [System.Text.UTF8Encoding]::new($true))
    $sw.WriteLine('<?xml version="1.0" encoding="UTF-8"?>')
    $sw.WriteLine('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for ($i = $start; $i -le $end; $i++) {
        $u = $list[$i]
        $sw.WriteLine("  <url><loc>$($u[0])</loc><lastmod>$today</lastmod><changefreq>$($u[1])</changefreq><priority>$($u[2])</priority></url>")
    }
    $sw.WriteLine('</urlset>')
    $sw.Close()
    $cnt = $end - $start + 1
    Write-Host "  $fileName : $cnt URLs"
}

# 如果拆分，生成sitemap索引文件
if ($files -gt 1) {
    $idxPath = "$outDir\sitemap.xml"
    $sw = [System.IO.StreamWriter]::new($idxPath, $false, [System.Text.UTF8Encoding]::new($true))
    $sw.WriteLine('<?xml version="1.0" encoding="UTF-8"?>')
    $sw.WriteLine('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for ($f = 0; $f -lt $files; $f++) {
        $sw.WriteLine("  <sitemap><loc>$baseUrl/sitemap$($f+1).xml</loc><lastmod>$today</lastmod></sitemap>")
    }
    $sw.WriteLine('</sitemapindex>')
    $sw.Close()
    Write-Host "  sitemap.xml (index): $files files"
}

Write-Host "Done! Date: $today"