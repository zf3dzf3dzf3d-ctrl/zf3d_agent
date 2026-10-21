/* 右下角浮动入口栏：由 index.html 第三批模块化外迁，document.currentScript 原位同步注入（时序与原内联 DOM 一致） */
/* 2026-10-10 改版「更多模式」：右下角只保留「对话」（核心入口，带计数）和「广场」，
   其余栏目（任务/长任务/长期目标/记忆/历史/模型）收进「更多 ▾」下拉菜单，
   点击展开选择后自动打开对应面板并收起菜单；点击页面其他位置自动收起。 */
(function () {
  var html = "    <!-- KEEP_FLOATING_TOOLS -->\n    <!-- 右下角极简文字栏：更多模式（对话常驻 + 其余栏目收进「更多」下拉） -->\n    <div class=\"tp-fab-group\">\n<button id=\"chatStatusBtn\" class=\"zf-dock-btn tp-tab zf-dock-tab zf-dock-icon\" data-tab=\"chat\" title=\"对话\">💬<span class=\"cs-btn-count\">0</span></button>\n        <button id=\"tpFabMoreBtn\" class=\"zf-dock-btn zf-more-trigger zf-dock-icon\" title=\"更多栏目（任务/长任务/长期目标/记忆/历史/模型/广场）\">⋯</button>\n        <div id=\"tpFabMoreMenu\" class=\"zf-more-menu\" style=\"display:none\">\n            <button class=\"zf-more-item\" data-tab=\"task\" title=\"任务清单\">任务</button>\n            <button class=\"zf-more-item\" data-tab=\"longplan\" title=\"长任务\">长任务</button>\n            <button class=\"zf-more-item\" data-tab=\"goal\" title=\"长期目标\">长期目标</button>\n            <button class=\"zf-more-item\" data-tab=\"memory\" title=\"记忆\">记忆</button>\n            <button class=\"zf-more-item\" data-tab=\"history\" title=\"历史\">历史</button>\n            <button class=\"zf-more-item\" data-tab=\"model\" title=\"大模型\">模型</button>\n            <button id=\"forumEntryBtn\" class=\"zf-more-item\" title=\"智能体广场\">广场</button>\n        </div>\n    </div>";
  try { document.currentScript.insertAdjacentHTML('afterend', html); }
  catch (e) { document.write(html); }
})();

/* 「更多」下拉：展开/收起 + 菜单项点击打开对应面板 + 点击外部自动收起 */
(function () {
  function menu() { return document.getElementById('tpFabMoreMenu'); }
  function btn() { return document.getElementById('tpFabMoreBtn'); }
  function toggle() {
    var m = menu();
    if (!m) return;
    m.style.display = (m.style.display === 'none') ? 'block' : 'none';
  }
  function close() { var m = menu(); if (m) m.style.display = 'none'; }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest && e.target.closest('#tpFabMoreBtn');
    if (trigger) { e.preventDefault(); toggle(); return; }
    var item = e.target.closest && e.target.closest('.zf-more-item');
    if (item) {
      var tab = item.getAttribute('data-tab');
      close();
      if (!tab || !window.App) return;
      if (window.App._taskActiveTab === tab && window.App._taskPanelOpen) {
        window.App.closeTaskPanel(); // 已开着同栏目则收起（与 dock 按钮 toggle 语义一致）
      } else {
        window.App._switchTab(tab);
        window.App.openTaskPanel();
      }
      return;
    }
    // 点在其他任何地方（含菜单内部空白以外的页面区域）→ 收起
    if (e.target.closest && e.target.closest('#tpFabMoreMenu')) return;
    close();
  }, true);

  // Esc 收起
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();

(function () { // 广场入口：点击直达当前激活对话框的工作台内置浏览器打开智能体广场
  var FURL = window.FORUM_URL || 'https://www.zf3d.com/bbs_class.asp?id=300';
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#forumEntryBtn');
    if (!b) return;
    e.preventDefault();
    var NS = window.__KiteNS || {};
    // 取对话框：优先最近展开过工作台的节点（须仍在文档中），再取焦点态，最后才退回第一个
    var act = NS.workbenchActiveNode;
    if (act && act.isConnected === false) act = null;
    var box = act
      || document.querySelector('.chatbox.focused')
      || document.querySelector('.chatbox, .chat-box, .chat-node');
    // 兜底：拿不到对话框或工作台 API 缺失时，直接开新标签，避免静默无反应
    if (box && NS.workbench && NS.workbench.openBrowserAt) NS.workbench.openBrowserAt(FURL, box);
    else window.open(FURL, '_blank');
  });
})();
