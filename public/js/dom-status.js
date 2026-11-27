/* 底部状态栏：由 index.html 第三批模块化外迁，document.currentScript 原位同步注入（时序与原内联 DOM 一致） */
(function () {
  var html = "    <!-- ====== 底部状态栏 ====== -->\n\n    <div class=\"statusbar\">\n\n\n\n        \n        \n    </div>\n\n    <style>#zfLeftFloat{position:fixed;left:10px;bottom:10px;display:flex;gap:8px;align-items:center;z-index:9850;pointer-events:none;}#zfLeftFloat button{pointer-events:auto;width:46px !important;height:46px !important;min-width:46px !important;padding:0 !important;margin:0 !important;border-radius:10px !important;display:flex !important;align-items:center;justify-content:center;background:rgba(20,20,24,.55) !important;border:1px solid rgba(255,255,255,.14) !important;cursor:pointer;transition:background .15s;}#zfLeftFloat button:hover{background:rgba(60,60,70,.7) !important;}#zfLeftFloat svg{width:22px;height:22px;}#zfLeftFloat .tk-dot{display:none !important;}.statusbar{display:none !important;}</style>\n\n    <div id=\"zfLeftFloat\"><button id=\"organizeDockBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"缩小整理模式（缩小总览整理，点击进入/退出）\"><span class=\"tk-label\"><svg viewBox=\"0 0 24 24\" width=\"30\" height=\"30\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.2\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.2\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.2\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.2\"/></svg></span><span class=\"tk-dot\" id=\"organizeDot\"></span></button><button id=\"kiteToggleBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"风筝开关：显示/隐藏画布风筝\"><span class=\"tk-label\"><svg viewBox=\"0 0 24 24\" width=\"30\" height=\"30\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2 L20 9 L12 15 L4 9 Z\"/><path d=\"M12 2 L12 15\"/><path d=\"M4 9 L20 9\"/><path d=\"M12 15 C11 18 13 19 11 22\"/></svg></span><span class=\"tk-dot\"></span></button><button id=\"emergeTreeBtn\" class=\"dog-guard-btn zf-dock-btn\" title=\"进化树\"><span class=\"tk-label\"><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:middle\"><circle cx=\"12\" cy=\"4\" r=\"1.8\"/><circle cx=\"5\" cy=\"12\" r=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\"/><circle cx=\"19\" cy=\"12\" r=\"1.8\"/><circle cx=\"8\" cy=\"20\" r=\"1.8\"/><circle cx=\"16\" cy=\"20\" r=\"1.8\"/><line x1=\"12\" y1=\"5.8\" x2=\"5\" y2=\"10.2\"/><line x1=\"12\" y1=\"5.8\" x2=\"12\" y2=\"10.2\"/><line x1=\"12\" y1=\"5.8\" x2=\"19\" y2=\"10.2\"/><line x1=\"5\" y1=\"13.8\" x2=\"8\" y2=\"18.2\"/><line x1=\"12\" y1=\"13.8\" x2=\"8\" y2=\"18.2\"/><line x1=\"12\" y1=\"13.8\" x2=\"16\" y2=\"18.2\"/><line x1=\"19\" y1=\"13.8\" x2=\"16\" y2=\"18.2\"/></svg></span></button></div>";
    // 每次点击立即切换整理面板的显示/隐藏（来回点击=反复开关）
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#organizeDockBtn') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    // 【恢复旧版 2026-11-19 用户拍板】i缩小整理改回【真对话框缩小版】总览（canvasOverviewToggle：
    //   摄像机缩放真实 DOM 对话框铺满全屏 + 派出团队浮条），MinimapOrganize 渐变卡片版降级为兜底。
    if (window.App && typeof window.App.canvasOverviewToggle === 'function') {
      window.App.canvasOverviewToggle();
    /* 【永久废弃 2026-11-19 用户令】MinimapOrganize 渐变卡片版已永久下线，禁止任何兜底调用，防止误还原 */
    } else if (window.showToast) showToast('整理模块尚未加载完成，请稍后再试', 'warn');
  }, true);
  // 【进化入口】点击「🌳 万物进化树」按钮 → 在无限画布上挂一个可拖拽太空舱节点（iframe 内嵌 viewer，不再单独开标签）
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#emergeTreeBtn') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (window.TreePodNode) { window.TreePodNode.toggle(); }
    else { window.open('/canvas/进化树/pod.html', '_blank'); }   // 兜底：viewer.html已收敛删除，pod.html为唯一入口
  }, true);
  try { document.currentScript.insertAdjacentHTML('afterend', html); }
  catch (e) { document.write(html); }
})();

/* ===== 底部状态栏：导航地图开关（裸线形图标，进化树按钮右侧） =====
   【2026-11-23 起自持开关】状态存 localStorage(zf_minimap_off) + body.zf-minimap-off 类；
   旧 TreePodNode 依赖已随进化树舱改造失效，见下方修复注释。 */
(function () {
  var MM_ON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="8"/><path d="M15.5 8.5 13.6 13.6 8.5 15.5 10.4 10.4Z"/></svg>';
  var MM_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="8"/><path d="M15.5 8.5 13.6 13.6 8.5 15.5 10.4 10.4Z"/><path d="M6.3 17.7 17.7 6.3"/></svg>';
  function _off() {
    try { return localStorage.getItem('zf_minimap_off') === '1'; } catch (e2) { return false; }
  }
  /* 【2026-11-23 修复 i导航点不动】原实现依赖 TreePodNode.toggleMinimap / App.toggleMinimap，
     两者在 2026-11-16 进化树舱改造/导航迁移后均已被删除 → 点击永远走空分支（只重绘图标不动地图）。
     现改为本文件自持开关：localStorage(zf_minimap_off) + body.zf-minimap-off 类
     （CSS 契约见 style-extras.css「导航地图开关」段：visibility:hidden 保留几何尺寸，
     app-minimap.js updateMinimap 见该类直接跳过重绘省帧）。 */
  function _applyOff(off) {
    try { localStorage.setItem('zf_minimap_off', off ? '1' : '0'); } catch (e) {}
    try { document.body.classList[off ? 'add' : 'remove']('zf-minimap-off'); } catch (e2) {}
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
    var off = !_off();
    _applyOff(off);
    if (window.showToast) showToast(off ? '导航地图已关闭' : '导航地图已开启', off ? 'info' : 'success');
    /* 重新开启时补一帧重绘：关闭期间 updateMinimap 按类直接跳过，画布内容是旧的 */
    if (!off && window.App && typeof App.updateMinimap === 'function') { try { App.updateMinimap(); } catch (e3) {} }
    paint();
  }, true);
  /* 启动即同步：上次会话关闭过导航 → 本session body 类必须先挂上（CSS 只认类，不读 localStorage） */
  try { if (_off()) document.body.classList.add('zf-minimap-off'); } catch (e4) {}
  /* 订阅舱侧逻辑的状态变化（别处调用 setMinimap 时同步本按钮） */
  var t = 0;
  (function hook() {
    if (window.TreePodNode && TreePodNode.subscribeMinimap) { TreePodNode.subscribeMinimap(paint); return; }
    if (t++ < 40) setTimeout(hook, 250);
  })();
  paint();
})();
