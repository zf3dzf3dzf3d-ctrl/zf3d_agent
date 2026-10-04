/* 底部状态栏：由 index.html 第三批模块化外迁，document.currentScript 原位同步注入（时序与原内联 DOM 一致） */
(function () {
  var html = "    <!-- ====== 底部状态栏 ====== -->\n\n    <div class=\"statusbar\">\n\n\n\n        <button id=\"organizeDockBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"整理模式（框选/拖拽/分组；双击=打开整理面板）\" ondblclick=\"MinimapOrganize && MinimapOrganize.open()\"><span class=\"tk-label\">整理</span><span class=\"tk-dot\" id=\"organizeDot\"></span></button>\n        <button id=\"status-model-trigger\" class=\"status-model-trigger\" type=\"button\" title=\"点击配置模型\">模型: 未配置</button>\n        <button id=\"kiteToggleBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"风筝开关：显示/隐藏画布风筝\"><span class=\"tk-label\">风筝</span><span class=\"tk-dot\"></span></button>\n        <button id=\"dogGuardBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"小狗管家：左键=和我聊天，右键=巡逻开关\"><span class=\"tk-label\">小狗</span><span class=\"tk-dot\"></span></button>\n        <button id=\"brainDockBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"主脑：项目级常驻观察者（点击打开）\"><span class=\"tk-label\">主脑</span></button>\n        <button id=\"turboDockBtn\" class=\"zf-dock-btn turbo-kite dog-guard-btn\" title=\"急速模式：已关闭（点击开启）\" onclick=\"setTurboMode(!isTurboMode());\"><span class=\"tk-label\">急速</span><span class=\"tk-dot\"></span></button>\n\n        <span class=\"statusbar-right\" id=\"statusbarVersion\">v5.5.0 · zf3d.com</span>\n\n    </div>";
    // 单击=切换整理模式（250ms 去抖），双击=直接打开整理面板；
  // 去抖保证双击时第一次 click 被吞掉，不会出现 toggle 闪烁
  var _orgClickTimer = null;
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#organizeDockBtn') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (_orgClickTimer) { clearTimeout(_orgClickTimer); _orgClickTimer = null; return; } // 双击的第2次click：跳过，交给 dblclick
    _orgClickTimer = setTimeout(function () {
      _orgClickTimer = null;
      if (window.MinimapOrganize) MinimapOrganize.toggle();
    }, 250);
  }, true);
  document.addEventListener('dblclick', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#organizeDockBtn') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (window.MinimapOrganize) MinimapOrganize.open();
  }, true);
  try { document.currentScript.insertAdjacentHTML('afterend', html); }
  catch (e) { document.write(html); }
})();
