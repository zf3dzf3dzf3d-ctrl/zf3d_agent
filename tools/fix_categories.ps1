<#
.SYNOPSIS
    给 tutorials 表添加 category_id 列并按标题关键词自动分类
#>

$ErrorActionPreference = "Stop"
$sqlitePath = "C:\work\web\data\zf3d.db"
$connStr = "Driver={SQLite3 ODBC Driver};Database=$sqlitePath;SyncPragma=NORMAL;"

$conn = New-Object System.Data.Odbc.OdbcConnection($connStr)
$conn.Open()
$cmd = $conn.CreateCommand()

# 1. 添加 category_id 列（已存在则跳过）
Write-Host "[1/3] 添加 category_id 列..." -ForegroundColor Cyan
try {
    $cmd.CommandText = "ALTER TABLE tutorials ADD COLUMN category_id INTEGER DEFAULT 54"
    $cmd.ExecuteNonQuery()
    Write-Host "  列已添加"
} catch {
    Write-Host "  列已存在，跳过"
}

# 2. 按关键词分类
Write-Host "[2/3] 按标题关键词分类..." -ForegroundColor Cyan

$categories = @(
    @{ id = 68; name = "建模"; keywords = @("建模","model","模型","maya","3dmax","3dsmax","blender","zbrush","mesh","polygon","多边形","拓扑","人头","角色","人物","动物","怪物","机械","车辆","建筑","场景","道具","武器") },
    @{ id = 60; name = "渲染"; keywords = @("渲染","vray","arnold","mentalray","redshift","octane","灯光","光照","gi","caustics","hdri","denoise","降噪","gpu渲染","渲染器") },
    @{ id = 59; name = "材质"; keywords = @("材质","贴图","uv","texture","material","shader","substance","pbr"," procedural","置换","法线","凹凸","反射","折射","sss","毛发材质") },
    @{ id = 69; name = "动画"; keywords = @("动画","绑定","rig","骨骼","权重","animation","运动","关键帧","曲线","约束","ik","fk","蒙皮","morph","形变","面部","表情") },
    @{ id = 61; name = "绘画"; keywords = @("绘画","draw","paint","原画","插画","sketch","素描","色彩","构图","photoshop","ps","手绘","概念设计","matte","数字绘景") },
    @{ id = 54; name = "其他"; keywords = @() }
)

# 先全部设为"其他"(54)
$cmd.CommandText = "UPDATE tutorials SET category_id = 54"
$cmd.ExecuteNonQuery()

# 然后从后往前匹配（后面的覆盖前面的，确保最具体的分类优先）
# 顺序: 绘画 → 动画 → 材质 → 渲染 → 建模
# 实际上应该按优先级: 先匹配最具体的
# 建模最宽泛放最后匹配（先匹配其他更具体的）

$updateOrder = @(61, 69, 59, 60, 68)  # 绘画→动画→材质→渲染→建模

foreach ($catId in $updateOrder) {
    $cat = $categories | Where-Object { $_.id -eq $catId }
    if ($cat.keywords.Count -eq 0) { continue }

    $likeConditions = @()
    foreach ($kw in $cat.keywords) {
        $escapedKw = $kw.Replace("'", "''")
        $likeConditions += "title LIKE '%$escapedKw%' COLLATE NOCASE"
    }
    $whereClause = $likeConditions -join " OR "

    $sql = "UPDATE tutorials SET category_id = $catId WHERE ($whereClause)"
    $cmd.CommandText = $sql
    $affected = $cmd.ExecuteNonQuery()
    Write-Host "  $($cat.name)(id=$catId): $affected 条" -ForegroundColor Yellow
}

# 3. 统计结果
Write-Host "[3/3] 分类结果统计..." -ForegroundColor Cyan
$cmd.CommandText = "SELECT c.id, c.name, COUNT(t.id) AS cnt FROM tutorials t LEFT JOIN categories c ON t.category_id = c.id GROUP BY c.id, c.name ORDER BY c.sort_order"
$reader = $cmd.ExecuteReader()
$table = New-Object System.Data.DataTable
$table.Load($reader)
$table | Format-Table -AutoSize

$conn.Close()
Write-Host "完成!" -ForegroundColor Green
