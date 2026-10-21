/* 底部状态栏：由 index.html 第三批模块化外迁，document.currentScript 原位同步注入（时序与原内联 DOM 一致） */
(function () {
  var html = "    <!-- ====== 底部状态栏 ====== -->\n\n    <div class=\"statusbar\">\n\n\n\n        <button id=\"organizeDockBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"缩小整理模式（摄像机缩放总览，框选/拖拽整理；点击切换进入/退出）\"><span class=\"tk-label\">🗂️</span><span class=\"tk-dot\" id=\"organizeDot\"></span></button>\n        <button id=\"kiteToggleBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"风筝开关：显示/隐藏画布风筝\"><span class=\"tk-label\">🪁</span><span class=\"tk-dot\"></span></button>\n        <button id=\"emergeTreeBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"进化树\"><span class=\"tk-label\"><svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:middle\"><circle cx=\"12\" cy=\"4\" r=\"1.8\"/><circle cx=\"5\" cy=\"12\" r=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\"/><circle cx=\"19\" cy=\"12\" r=\"1.8\"/><circle cx=\"8\" cy=\"20\" r=\"1.8\"/><circle cx=\"16\" cy=\"20\" r=\"1.8\"/><line x1=\"12\" y1=\"5.8\" x2=\"5\" y2=\"10.2\"/><line x1=\"12\" y1=\"5.8\" x2=\"12\" y2=\"10.2\"/><line x1=\"12\" y1=\"5.8\" x2=\"19\" y2=\"10.2\"/><line x1=\"5\" y1=\"13.8\" x2=\"8\" y2=\"18.2\"/><line x1=\"12\" y1=\"13.8\" x2=\"8\" y2=\"18.2\"/><line x1=\"12\" y1=\"13.8\" x2=\"16\" y2=\"18.2\"/><line x1=\"19\" y1=\"13.8\" x2=\"16\" y2=\"18.2\"/></svg></span></button>\n\n    </div>";
    // 每次点击立即切换整理面板的显示/隐藏（来回点击=反复开关）
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#organizeDockBtn') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    // 【整合】左上「整理」按钮直接进入缩小总览模式（总览即整理）。
    //   退出靠 Esc 或再点本按钮；MinimapOrganize 不再作为入口面板。
    if (window.App && typeof window.App.canvasOverviewToggle === 'function') {
      window.App.canvasOverviewToggle();
    } else if (window.MinimapOrganize) {
      MinimapOrganize.toggle();
    } else if (window.showToast) showToast('总览模块尚未加载完成，请稍后再试', 'warn');
  }, true);
  // 【进化入口】点击「🌳 万物进化树」按钮 → 在无限画布上挂一个可拖拽太空舱节点（iframe 内嵌 viewer，不再单独开标签）
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#emergeTreeBtn') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (window.TreePodNode) { window.TreePodNode.toggle(); }
    else { window.open('/canvas/进化树/viewer.html', '_blank'); }   // 兜底：脚本未加载时退回旧行为
  }, true);
  try { document.currentScript.insertAdjacentHTML('afterend', html); }
  catch (e) { document.write(html); }
})();
