$files = @('Prclassi_rjxz.asp', 'caizhi_fenlei.asp')
foreach ($f in $files) {
    $path = "C:\work\web\$f"
    $c = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    
    # Fix common garbled patterns - replace with correct Chinese
    $replacements = @{
        '杞欢涓嬭浇' = '软件下载'
        '3D鍒朵綔杞欢銆佹彃浠朵笅杞' = '3D制作软件、插件下载'
        '鍏ㄩ儴' = '全部'
        '杞欢' = '软件'
        '鎸夊姛鑳' = '按功能'
        '鎸夎蒋浠' = '按软件'
        '绛涢€夋爮' = '筛选栏'
        '鏉愯川璐村浘' = '材质贴图'
        '3D鏉愯川' = '3D材质'
        '璐村浘' = '贴图'
        '鍥惧簱' = '图库'
        '鏁堟灉鍥' = '效果图'
        '涓撲笟鏉愯川璧勬簮涓嬭浇' = '专业材质资源下载'
        '鍏辫' = '共'
        '涓粨鏋' = '个结果'
        '涓杞浇' = '个转载'
        '娌℃湁鎵惧埌鐩稿叧杞浇鏁欑▼' = '没有找到相关转载教程'
        '鏆傛棤杞浇鏁欑▼鏁版嵁' = '暂无转载教程数据'
        '鎼滅储' = '搜索'
        '鍒嗛〉' = '分页'
        '澶х被' = '大类'
        '瀛愮被' = '子类'
        '鍏蜂綋杞欢' = '具体软件'
        'hover鏄剧ず' = 'hover显示'
    }
    
    foreach ($key in $replacements.Keys) {
        $c = $c.Replace($key, $replacements[$key])
    }
    
    # Remove any remaining garbled comment blocks
    $c = $c -replace '<!-- [^>]*?绛[^>]*?-->', '<!-- 筛选栏 -->'
    $c = $c -replace '<!-- [^>]*?杞[^>]*?-->', '<!-- 转载视频列表页 -->'
    
    $utf8bom = [System.Text.UTF8Encoding]::new($true)
    [System.IO.File]::WriteAllText($path, $c, $utf8bom)
    Write-Host "Fixed: $f"
}
