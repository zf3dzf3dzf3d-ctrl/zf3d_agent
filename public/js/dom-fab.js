/* 右下角浮动入口栏：由 index.html 第三批模块化外迁，document.currentScript 原位同步注入（时序与原内联 DOM 一致） */
(function () {
  var html = "    <!-- KEEP_FLOATING_TOOLS -->\n    <!-- 右下角极简文字栏：开关 + 全部栏目入口（一行收纳） -->\n    <div class=\"tp-fab-group\">\n<button id=\"chatStatusBtn\" class=\"zf-dock-btn tp-tab zf-dock-tab\" data-tab=\"chat\" title=\"对话\">对话<span class=\"cs-btn-count\">0</span></button>\n        <button id=\"taskPanelBtn\" class=\"zf-dock-btn tp-tab zf-dock-tab\" data-tab=\"task\" title=\"任务清单\"><span class=\"tp-btn-icon\" style=\"display:none\">🔸</span>任务</button>\n        <button class=\"zf-dock-btn tp-tab zf-dock-tab\" data-tab=\"longplan\" title=\"长任务\">长任务</button>\n        <button class=\"zf-dock-btn tp-tab zf-dock-tab\" data-tab=\"goal\" title=\"长期目标\">长期目标</button>\n        <button class=\"zf-dock-btn tp-tab zf-dock-tab\" data-tab=\"memory\" title=\"记忆\">记忆</button>\n        <button class=\"zf-dock-btn tp-tab zf-dock-tab\" data-tab=\"history\" title=\"历史\">历史</button>\n        <button class=\"zf-dock-btn tp-tab zf-dock-tab\" data-tab=\"model\" title=\"大模型\">模型</button>\n        <button id=\"forumEntryBtn\" class=\"zf-dock-btn\" title=\"智能体广场\">广场</button>\n    </div>";
  try { document.currentScript.insertAdjacentHTML('afterend', html); }
  catch (e) { document.write(html); }
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
