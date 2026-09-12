$enc=[Text.Encoding]::GetEncoding('gbk')
$p='public/js/app-kite.js'
$c=[IO.File]::ReadAllText($p,$enc)

$fn = "function _setOverviewHidden(hide){ var r=document.querySelector('.kite-dragon'); if(!r) return; var ov=r.querySelector('.kite-head-overview'); if(ov) ov.style.visibility = hide ? 'hidden' : ''; }"

if($c -notmatch '_setOverviewHidden'){

  $old1 = "var t = 0, lastTs = 0, dragging = false, dragMoved = 0;"
  $c = $c.Replace($old1, $old1 + "`n    " + $fn)

  # 头部拖拽移动超过阈值时隐藏面板
  $old2 = "dragMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);"
  $c = $c.Replace($old2, $old2 + "`n            if (dragMoved > 6) _setOverviewHidden(true);")

  # 头部松手恢复面板
  $old3 = "headEl.classList.remove('dragging');"
  $c = $c.Replace($old3, $old3 + "`n`n            _setOverviewHidden(false);")

  # 身体节段拖拽开始/结束
  $old4 = "current._drag = true; current._dragMoved = 0;"
  $c = $c.Replace($old4, $old4 + " _setOverviewHidden(true);")
  $old5 = "current._drag = false;"
  $c = $c.Replace($old5, "current._drag = false; _setOverviewHidden(false);")

  [IO.File]::WriteAllText($p,$c,$enc)
  Write-Output 'JS patched'
} else { Write-Output 'already patched' }
