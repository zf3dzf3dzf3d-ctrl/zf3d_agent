/* 底部状态栏：由 index.html 第三批模块化外迁，document.currentScript 原位同步注入（时序与原内联 DOM 一致） */
(function () {
  var html = "    <!-- ====== 底部状态栏 ====== -->\n\n    <div class=\"statusbar\">\n\n\n\n        <button id=\"organizeDockBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"缩小整理模式（摄像机缩放总览，框选/拖拽整理；点击切换进入/退出）\"><span class=\"tk-label\">🗂️</span><span class=\"tk-dot\" id=\"organizeDot\"></span></button>\n        <button id=\"kiteToggleBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"风筝开关：显示/隐藏画布风筝\"><span class=\"tk-label\">🪁</span><span class=\"tk-dot\"></span></button>\n        <button id=\"emergeTreeBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"进化树\"><span class=\"tk-label\"><svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:middle\"><circle cx=\"12\" cy=\"4\" r=\"1.8\"/><circle cx=\"5\" cy=\"12\" r=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\"/><circle cx=\"19\" cy=\"12\" r=\"1.8\"/><circle cx=\"8\" cy=\"20\" r=\"1.8\"/><circle cx=\"16\" cy=\"20\" r=\"1.8\"/><line x1=\"12\" y1=\"5.8\" x2=\"5\" y2=\"10.2\"/><line x1=\"12\" y1=\"5.8\" x2=\"12\" y2=\"10.2\"/><line x1=\"12\" y1=\"5.8\" x2=\"19\" y2=\"10.2\"/><line x1=\"5\" y1=\"13.8\" x2=\"8\" y2=\"18.2\"/><line x1=\"12\" y1=\"13.8\" x2=\"8\" y2=\"18.2\"/><line x1=\"12\" y1=\"13.8\" x2=\"16\" y2=\"18.2\"/><line x1=\"19\" y1=\"13.8\" x2=\"16\" y2=\"18.2\"/></svg></span></button>\n        \n    </div>";
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

/* ===== 底部状态栏：导航地图开关（裸线形图标，进化树按钮右侧） =====
   状态/持久化/隐藏逻辑复用 TreePodNode（app-canvas-tree-node.js）；本处只负责图标视觉与点击。 */
(function () {
  var MM_ON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="8"/><path d="M15.5 8.5 13.6 13.6 8.5 15.5 10.4 10.4Z"/></svg>';
  var MM_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="8"/><path d="M15.5 8.5 13.6 13.6 8.5 15.5 10.4 10.4Z"/><path d="M6.3 17.7 17.7 6.3"/></svg>';
  function _off() {
    try { if (window.TreePodNode && TreePodNode.minimapOn) return !TreePodNode.minimapOn(); } catch (e) {}
    try { return localStorage.getItem('zf_minimap_off') === '1'; } catch (e2) { return false; }
  }
  function paint() {
    var b = document.getElementById('minimapToggleBtn'); if (!b) return;
    var l = b.querySelector('.tk-label'); if (!l) return;
    var off = _off();
    var want = off ? MM_OFF : MM_ON;
    if (l.innerHTML !== want) l.innerHTML = want;
    b.classList[off ? 'add' : 'remove']('mm-off');
    b.title = off ? '开启导航地图（右下角缩略图）' : '关闭导航地图（右下角缩略图）';
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#minimapToggleBtn') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (window.TreePodNode && TreePodNode.toggleMinimap) {
      var off = TreePodNode.toggleMinimap();
      if (window.showToast) showToast(off ? '导航地图已关闭' : '导航地图已开启', off ? 'info' : 'success');
    } else if (window.App && App.toggleMinimap) { try { App.toggleMinimap(); } catch (e3) {} }
    paint();
  }, true);
  /* 订阅舱侧逻辑的状态变化（别处调用 setMinimap 时同步本按钮） */
  var t = 0;
  (function hook() {
    if (window.TreePodNode && TreePodNode.subscribeMinimap) { TreePodNode.subscribeMinimap(paint); return; }
    if (t++ < 40) setTimeout(hook, 250);
  })();
  paint();
})();
