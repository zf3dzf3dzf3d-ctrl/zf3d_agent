/* 桌面客户端窗口手势版 v5。
   窗口控制按钮（最小化/最大化/专注/关闭）统一由 dom-topbar.js 注入到顶栏右侧，
   本文件只负责：给这些按钮绑定 pywebview 动作 + 拖拽平移/边缘缩放手势。
   不再自建第二条控制条（避免出现两套最小化/最大化/关闭按钮）。
   ⚠ 隐性约束（修改前必读）：
   1) 缩放热区 ht 的取值通过 edges 数组 indexOf 回查（DOM 后写者优先），
      四角热区必须定义在 edges 数组尾部，否则角会被相邻边条抢先命中。
      更优改法：热区元素上直接存 ht（ht 本身即 Win32 码值），无需 indexOf 回查。
   2) ht 查不到时兜底 0（=HTCLIENT/平移），这是有意的降级而非 bug；
      前提是热区必须由本脚本自建。若日后改为手工 HTML 热区或改 ht 来源，
      需重新评估该兜底（届时可改为 return 跳过）。 */
(function () {
  function init() {
    var api = window.pywebview && window.pywebview.api;
    /* 注意：api 未就绪时必须直接重试 init()，不能走 initOnce()——
       initOnce 在调用 init 前就已置 _done=true，重试会被守卫拦截，
       导致手势模块永远初始化失败（平移/缩放全失效的历史 Bug）。
       ⚠️复用警示：此"绕守卫重调"模式要求 init 本身幂等（initOnce._done 未置位，
       理论上可二次 init）；照抄到 init 非幂等的模块会二次初始化，须先确认幂等或自行加守卫。 */
    if (!api) { setTimeout(function () { init(); }, 300); return; }

    document.body.classList.add('zf-client');

    /* ---------- 绑定顶栏右侧已有按钮 ---------- */
    var minBtn = document.getElementById('topbarMinBtn');
    var maxBtn = document.getElementById('topbarMaxBtn');
    var closeBtn = document.getElementById('topbarCloseBtn');
    function syncMax() {
      api.window_state().then(function (s) {
        /* 图标统一为 dom-topbar.js 注入的白色简笔画方框 SVG，此处不再用 textContent
           覆写回 Unicode 字符（旧行为会把白色 SVG 替换成黑色 ▢/❐，破坏简笔画风格）。
           最大化/还原态改用 data-state 标记，外观保持一致低调。 */
        if (maxBtn) maxBtn.setAttribute('data-state', s === 'maximized' ? 'restore' : 'max');
      }).catch(function () {});
    }
    if (minBtn) minBtn.onclick = function () { api.minimize(); };
    if (maxBtn) maxBtn.onclick = function () { api.toggle_maximize(); setTimeout(syncMax, 200); };
    if (closeBtn) closeBtn.onclick = function () { api.close(); };
    setTimeout(syncMax, 500);

    /* ---------- 统一手势 ----------
       getMode(): 0=平移；10..17=Win32 边缘命中码 */
    function makeGesture(getMode) {
      return function (e) {
        if (e.button !== 0) return;
        if (e.target.closest('button, .zf-win-btn, input, select, a, label, textarea,' +
          '[data-act], [onclick], [role="button"], .btn, [class*="btn"], [class*="button"]')) return;
        /* 拖拽条/覆盖层下若压着可交互元素（按钮等），让位给按钮，不拖窗口 */
        var hit = document.elementFromPoint(e.clientX, e.clientY);
        if (hit && hit !== e.target && hit.closest &&
            hit.closest('button, .zf-win-btn, input, select, a, label, textarea,' +
              '[data-act], [onclick], [role="button"], .btn, [class*="btn"], [class*="button"]')) return;
        e.preventDefault();
        e.stopPropagation();
        var mode = getMode();
        var lastX = e.screenX, lastY = e.screenY;
        var dpr = window.devicePixelRatio || 1;
        var started = false;
        function begin() { try { api.gesture_begin(mode); } catch (err) {} }
        function onMove(ev) {
          if (!started) { started = true; begin(); }
          var dx = Math.round((ev.screenX - lastX) * dpr);
          var dy = Math.round((ev.screenY - lastY) * dpr);
          lastX = ev.screenX; lastY = ev.screenY;
          if (dx || dy) { try { api.window_delta(dx, dy, mode); } catch (err) {} }
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove, true);
          document.removeEventListener('mouseup', onUp, true);
        }
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      };
    }

    /* 顶栏可平移：改为 document 级事件委托——顶栏 DOM 可能被其他脚本整体重渲染
       （如 dom-topbar.js 重注入、主题切换），直接绑在元素上监听会随重渲染丢失。
       委托方案对重渲染免疫，且不受绑定顺序影响。 */
    function isWindowChrome(el) {
      return el.closest && el.closest('.topbar');
    }
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!isWindowChrome(e.target)) return;
      if (e.target.closest('.topbar-right, button, input, select, a, label, textarea')) return;
      makeGesture(function () { return 0; })(e);
    }, true);

    /* 顶部隐形拖拽条（顶栏高度之外再兜底一条），同样用委托防重渲染丢监听 */
    var strip = document.createElement('div');
    strip.id = 'zfDragStrip';
    document.body.appendChild(strip);
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('#zfDragStrip')) makeGesture(function () { return 0; })(e);
    }, true);

    /* 边缘缩放：ht 值必须用 Win32 真实命中码（与后端 window_resize_hit/window_delta 一致）：
       HTTOP=12 HTRIGHT=11 HTBOTTOM=15 HTLEFT=10
       HTTOPLEFT=13 HTTOPRIGHT=14 HTBOTTOMLEFT=16 HTBOTTOMRIGHT=17
       （旧版 v5 错把 top/bottom/左上/右下的码与后端映射对错，导致拖边缘方向乱/无效） */
    var edges = [
      { ht: 12, css: 'top:0;left:10px;right:10px;height:6px;cursor:ns-resize;' },
      { ht: 11, css: 'top:10px;bottom:10px;right:0;width:6px;cursor:ew-resize;' },
      { ht: 15, css: 'bottom:0;left:10px;right:10px;height:6px;cursor:ns-resize;' },
      { ht: 10, css: 'top:10px;bottom:10px;left:0;width:6px;cursor:ew-resize;' },
      { ht: 14, css: 'top:0;right:0;width:16px;height:16px;cursor:nesw-resize;' },
      { ht: 17, css: 'bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;' },
      { ht: 16, css: 'bottom:0;left:0;width:16px;height:16px;cursor:nesw-resize;' },
      { ht: 13, css: 'top:0;left:0;width:16px;height:16px;cursor:nwse-resize;' }
    ];
    edges.forEach(function (ed) {
      var d = document.createElement('div');
      d.className = 'zfResizeEdge';
      d.style.cssText = 'position:fixed;z-index:2147482000;' + ed.css;
      document.body.appendChild(d);
    });
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var edge = e.target.closest && e.target.closest('.zfResizeEdge');
      if (!edge) return;
      var idx = Array.prototype.indexOf.call(document.querySelectorAll('.zfResizeEdge'), edge);
      makeGesture(function () { return edges[idx] ? edges[idx].ht : 0; })(e);
    }, true);

    /* 样式：顶栏右侧保持居右；不再有独立控制条 */
    var css = document.createElement('style');
    css.textContent =
      '#zfDragStrip{position:fixed;top:0;left:0;right:0;height:6px;z-index:2147482500;cursor:move;}' +
      '.zfResizeEdge{position:fixed;z-index:2147482000;}' +
      'body.zf-client .topbar-right{padding-right:8px !important;position:relative;z-index:2147483001;pointer-events:auto;}' +
      /* 健康弹窗期间顶栏右侧被临时移入遮罩内部：保持钉在右上角且盖过遮罩(z 2147483647) */
      '.health-rest-overlay > .topbar-right, .health-countdown-overlay > .topbar-right{position:fixed !important;top:0;right:0;margin:0 !important;z-index:2147483647 !important;}' +
      'body.zf-client .topbar-right{margin-left:auto !important;}' +
      'body.zf-client .topbar{justify-content:space-between !important;}' +
      /* 窗口控制按钮统一样式（沿用顶栏图标样式，居右排列） */
      'body.zf-client .topbar-win{min-width:34px;justify-content:center;}' +
      'body.zf-client .topbar-close:hover{background:rgba(255,80,80,.35);color:#fff;}';
    document.head.appendChild(css);
  }

  function initOnce(wait) {
    if (wait === undefined) wait = true;
    if (wait && !(window.pywebview && window.pywebview.api)) {
      setTimeout(function () { initOnce(false); }, 300); return;
    }
    if (initOnce._done) return; /* 重复初始化守卫 */
    initOnce._done = true;
    init();
  }

  /* 供外部（如健康管家）在手势模块被意外失效后重建：
     幂等，重复调用不会累积追加拖拽条/缩放热区 DOM，也不会重复绑定按钮 */
  window.zfRebuildWinCtrl = function () { initOnce._done = false; initOnce(false); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initOnce(false); });
  } else {
    initOnce(false);
  }
})();
