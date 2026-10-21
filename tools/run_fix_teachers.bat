@echo off
chcp 65001 >nul 2>&1
echo ============================================
echo   修复 teacher_id (从老数据库恢复)
echo ============================================
echo.

cd /d C:\web\tools

echo 正在读取老数据库...
powershell -Command "$conn = New-Object System.Data.SqlClient.SqlConnection 'Server=(localdb)\MSSQLLocalDB;Integrated Security=true;Database=zf3ddate_new'; $conn.Open(); $cmd = $conn.CreateCommand(); $cmd.CommandText = 'SELECT Class_Id, laoshi FROM Tx_PrClass_e WHERE laoshi IS NOT NULL AND laoshi <> '''' AND laoshi <> ''20'' AND laoshi <> ''0'' ORDER BY Class_Id ASC'; $reader = $cmd.ExecuteReader(); $sb = New-Object System.Text.StringBuilder; while ($reader.Read()) { $id = $reader['Class_Id'].ToString().Trim(); $tch = $reader['laoshi'].ToString().Trim(); $sb.AppendLine(\"$id|$tch\") }; $reader.Close(); $conn.Close(); $sb.ToString() | Out-File -FilePath 'teacher_mapping.txt' -Encoding UTF8; Write-Host ('Exported: ' + $sb.ToString().Split([Environment]::NewLine).Count + ' rows')"

echo 正在更新服务器数据库...
powershell -Command "$lines = Get-Content 'C:\web\tools\teacher_mapping.txt' -Encoding UTF8; $cnt = 0; foreach ($line in $lines) { if ($line -match '^\d+\|\d+$') { $parts = $line -split '\|'; $id = $parts[0].Trim(); $tch = $parts[1].Trim(); $sql = \"UPDATE tutorial_series SET teacher_id=$tch WHERE id=$id\"; $sb = $sql; $cnt++ } }; Write-Host \"Total: $cnt updates\""

echo.
echo 需要手动在服务器上执行ASP脚本来更新
echo copy C:\web\tools\apply_teacher_ids.asp C:\web\apply_teacher_ids.asp
echo curl -s "http://localhost/apply_teacher_ids.asp"
echo del C:\web\apply_teacher_ids.asp
echo.
pause
