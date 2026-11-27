$f=''
$c=[IO.File]::ReadAllText($f)
$new=@"

/* 【2026-11-16 用户反馈】大师·纸白：对话框白色底垫去掉（对话框已有自己的背景/壁纸）。
   .chatbox 本体直接透明；::before 兜底层仅在未开对话框壁纸时透明（壁纸模式靠 ::before 承载图片，不能动）。 */
html[data-theme="light"] .chatbox { background: transparent !important; }
html[data-theme="light"] body:not(.bg-chatbox-wallpaper) .chatbox::before { background: transparent !important; }
"@
$anchor='/* 【派出UI主题适配 v1】'
if($c.Contains($anchor)){
  $c=$c.Replace($anchor, $new + "`r`n" + $anchor)
  [IO.File]::WriteAllText($f,$c,[Text.Encoding]::UTF8)
  if([IO.File]::ReadAllText($f).Contains('bg-chatbox-wallpaper')){'INSERTED OK'}else{'INSERT FAILED'}
}else{'ANCHOR NOT FOUND'}
