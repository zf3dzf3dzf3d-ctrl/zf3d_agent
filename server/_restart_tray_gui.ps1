# 一键重启后台（确认 + 真实完成反馈）
# 由 _restart_tray.bat 调用：先弹「确认重启」对话框，点「是」后异步运行
# restart_server.py（精确重启：只杀 server.py 旧进程、拉起新后台、健康检查、恢复托盘），
# 期间显示进度计时窗口，完成后弹出真实结果（成功/失败 + 耗时）。
param([switch]$SelfTest)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# 优先无控制台解释器 pythonw.exe
$pyw = Join-Path $here '..\python\pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = Join-Path $here '..\python\python.exe' }
$restartPy = Join-Path $here 'restart_server.py'
$baseDir = (Resolve-Path (Join-Path $here '..')).Path
$logPath = Join-Path $here '.restart_out.log'

if ($SelfTest) {
    [System.Windows.Forms.MessageBox]::Show('中文测试 OK · PowerShell WinForms 可用', '自测') | Out-Null
    exit 0
}

# ---- 1. 确认对话框 ----
$confirmMsg = "确定要重启智能体后台吗？`n`n· 仅重启 server.py 后台进程与托盘，不会关闭其它程序。`n· 过程通常几秒内完成，最多约 30 秒。`n· 点「否」则取消，不做任何操作。"
$r = [System.Windows.Forms.MessageBox]::Show(
    $confirmMsg, '一键重启后台',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
if ($r -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }

# ---- 2. 进度窗口 ----
$form = New-Object System.Windows.Forms.Form
$form.Text = '一键重启后台'
$form.ClientSize = New-Object System.Drawing.Size(360, 120)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$lbl1 = New-Object System.Windows.Forms.Label
$lbl1.SetBounds(10, 18, 340, 28)
$lbl1.Font = New-Object System.Drawing.Font('Microsoft YaHei', 12, [System.Drawing.FontStyle]::Bold)
$lbl1.Text = '正在重启后台…'
$lbl1.TextAlign = 'MiddleCenter'

$lbl2 = New-Object System.Windows.Forms.Label
$lbl2.SetBounds(10, 56, 340, 28)
$lbl2.ForeColor = [System.Drawing.Color]::FromArgb(10, 132, 255)
$lbl2.TextAlign = 'MiddleCenter'

$form.Controls.Add($lbl1)
$form.Controls.Add($lbl2)

# ---- 3. 异步启动 restart_server.py ----
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $pyw
$psi.Arguments = '"' + $restartPy + '"'
$psi.WorkingDirectory = $baseDir
$psi.UseShellExecute = $false
$script:proc = [System.Diagnostics.Process]::Start($psi)
$script:start = Get-Date
$script:i = 0

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
    $script:i++
    $dots = '.' * (($script:i / 4) % 4 + 1)
    $el = ((Get-Date) - $script:start).TotalSeconds
    $lbl2.Text = ('请稍候{0}  {1:N1}s' -f $dots, $el)

    if ($script:proc.HasExited) {
        $timer.Stop()
        $code = $script:proc.ExitCode
        $elapsed = ((Get-Date) - $script:start).TotalSeconds
        $form.Close()

        if ($code -eq 0) {
            [System.Windows.Forms.MessageBox]::Show(
                ('✅ 后台重启成功！`n`n耗时 {0:N1} 秒，托盘图标已恢复。' -f $elapsed),
                '重启完成',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        }
        elseif ($code -eq 1) {
            $tip = ''
            if (Test-Path $logPath) {
                try {
                    $tail = (Get-Content $logPath -Tail 3 -Encoding UTF8) -join "`n"
                    if ($tail) { $tip = "`n`n最近日志：`n" + $tail }
                } catch {}
            }
            [System.Windows.Forms.MessageBox]::Show(
                ('⚠ 后台重启未通过健康检查（耗时 {0:N1} 秒）。`n托盘已重新拉起，可稍后再点一次「一键重启后台」。' -f $elapsed) + $tip,
                '重启未成功',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                ('❌ 重启脚本异常退出（代码 {0}）。`n请查看 restart_server.py 与 .restart_out.log。' -f $code),
                '重启异常',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
        }
        [System.Windows.Forms.Application]::Exit()
    }
})

$form.Add_Shown({ $timer.Start() })
[System.Windows.Forms.Application]::Run($form)
