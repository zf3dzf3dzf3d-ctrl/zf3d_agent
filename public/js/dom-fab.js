/* 右下角浮动入口栏：由 index.html 第三批模块化外迁，document.currentScript 原位同步注入（时序与原内联 DOM 一致） */
/* 2026-11-11 统一化：仅保留「对话」+「导航地图」，⋯「更多」按钮及下拉菜单已删除，
   原 7 个栏目项改由 window.ZFDockOverflowItems 注册进 Dock 的「∞」溢出面板。 */
(function () {
  var html = "    <!-- KEEP_FLOATING_TOOLS -->\n    <!-- 【2026-11-16 曾撤下】【2026-12 恢复】用户反馈 i无限面板找不到 i对话入口：\n         收编管线 mv('chatStatusBtn') 依赖此按钮 DOM 存在，撤下后 i对话入口消失。\n         恢复生成按钮（容器仍 display:none，按钮由 zf-app-dock 收编进 i无限面板，\n         挪回 body 挂载后照常显示，桌面不会再出现浮动栏） -->\n    <div class=\"tp-fab-group\" style=\"display:none\">\n<button id=\"chatStatusBtn\" class=\"zf-dock-btn tp-tab zf-dock-tab zf-dock-icon\" data-tab=\"chat\" title=\"i对话\">💬<span class=\"cs-btn-count\">0</span></button>\n    </div>";
  try { document.currentScript.insertAdjacentHTML('afterend', html); }
  catch (e) { document.write(html); }
})();

/* 2026-11-11：旧「更多」下拉的事件绑定已随按钮一并删除（栏目项迁移至 Dock ∞ 溢出面板） */

/* 【2026-11-11 统一化】「更多」栏目项注册进 Dock 的「∞」溢出面板（zf-app-dock 的 renderDock 每次渲染时读取） */
(function () {
  function switchTab(tab) {
    if (!window.App) return;
    if (window.App._taskActiveTab === tab && window.App._taskPanelOpen) window.App.closeTaskPanel();
    else { window.App._switchTab(tab); window.App.openTaskPanel(); }
  }
  /* 线性白色描边图标（与 Dock 图标风格统一：fill:none / stroke:#fff / 24 viewBox） */
  function icon(paths) {
    return '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }
  var ICONS = {
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9.5h8M8 13h5"/><path d="M8.5 16.5l1.2 1.2 2.3-2.3"/>',
    longplan: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 2"/><path d="M9.5 3.5h5"/>',
    goal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2"/>',
    memory: '<path d="M8 4.5c-2.2 0-3.5 1.4-3.5 3.5 0 4-1.5 5-1.5 7 0 2 1.5 3.5 3.5 3.5s3.5-1.5 3.5-3.5"/><path d="M16 4.5c2.2 0 3.5 1.4 3.5 3.5 0 4 1.5 5 1.5 7 0 2-1.5 3.5-3.5 3.5s-3.5-1.5-3.5-3.5"/><path d="M12 3v18"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/><path d="M4.5 8.5 3 4.5l3 1"/><path d="M19.5 15.5 21 19.5l-3-1"/>',
    model: '<path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2Z"/><path d="M4.5 7.2 12 11.4l7.5-4.2M12 11.4V21"/>',
    forum: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H9l-4 3.5V5.5Z"/><path d="M8 9h8M8 12h5"/>'
  };
  /* 【2026-11-12 需求】任务/长任务/长期目标/历史/记忆/模型/广场 均可通过对话菜单切换，
     不再注册进「更多(i程序/∞)」溢出面板，故置空。 */
  window.ZFDockOverflowItems = [];
})();

/* 2026-11-11：旧 #forumEntryBtn 广场点击绑定已随「更多」菜单删除（广场入口迁移至 Dock ∞ 溢出面板，见上方 ZFDockOverflowItems） */
