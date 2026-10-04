/* 桌面客户端窗口控制条 + 拖拽平移/边缘缩放（统一手势版 v4）。
   仅在 pywebview 客户端内生效；浏览器访问时自动隐藏。
   手势原则：mousedown 时若窗口最大化则先还原（后端 gesture_begin 同步处理，
   还原后窗口自动对齐到鼠标下方，避免跳动），mousemove 发增量给后端真实改窗口。 */
(function () {
  function init() {
    var api = window.pywebview && window.pywebview.api;
    if (!api) { setTimeout(init, 300); return; }

    /* ---------- 控制条（固定右上角） ---------- */
    var bar = document.createElement('div');
    bar.id = 'zfWinCtrl';
    bar.innerHTML =
      '<span class="zf-win-btn" id="zfWinMin" title="最小化">&#x2500;</span>' +
      '<span class="zf-win-btn" id="zfWinMax" title="最大化/还原">&#x25A1;</span>' +
      '<span class="zf-win-btn zf-win-close" id="zfWinClose" title="关闭窗口（后台服务继续运行）">&#x2715;</span>';
    document.body.appendChild(bar);
    bar.classList.add('zf-win-fixed');
    /* 顶栏右侧图标为窗口控制条让位，避免盖住登录入口 */
    document.body.classList.add('zf-client');

    var maxBtn = bar.querySelector('#zfWinMax');
    function syncMax() {
      api.window_state().then(function (s) {
        maxBtn.textContent = s === 'maximized' ? '\u2750' : '\u25A1';
      }).catch(function () {});
    }
    bar.querySelector('#zfWinMin').onclick = function () { api.minimize(); };
    maxBtn.onclick = function () { api.toggle_maximize(); setTimeout(syncMax, 200); };
    bar.querySelector('#zfWinClose').onclick = function () { api.close(); };
    setTimeout(syncMax, 500);

    /* ---------- 统一手势 ----------
       getMode(): 0=平移；10..17=Win32 边缘命中码 */
    function makeGesture(getMode) {
      return function (e) {
        if (e.button !== 0) return;
        if (e.target.closest('button, .zf-win-btn, input, select, a')) return;
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

    /* 顶栏可平移（按住顶栏空白处拖动窗口） */
    var topbar = document.querySelector('.topbar');
    if (topbar) topbar.addEventListener('mousedown', makeGesture(function () { return 0; }));

    /* 顶部 8px 拖拽条 */
    var strip = document.createElement('div');
    strip.id = 'zfDragStrip';
    strip.addEventListener('mousedown', makeGesture(function () { return 0; }));
    strip.addEventListener('dblclick', function () { maxBtn.click(); });
    document.body.appendChild(strip);

    /* 边缘/四角缩放热区 */
    var edges = [
      { ht: 10, css: 'left:0;top:10px;bottom:10px;width:6px;cursor:ew-resize;' },
      { ht: 11, css: 'right:0;top:10px;bottom:10px;width:6px;cursor:ew-resize;' },
      { ht: 12, css: 'top:0;left:10px;right:10px;height:6px;cursor:ns-resize;' },
      { ht: 13, css: 'top:0;left:0;width:16px;height:16px;cursor:nwse-resize;' },
      { ht: 14, css: 'top:0;right:0;width:16px;height:16px;cursor:nesw-resize;' },
      { ht: 15, css: 'bottom:0;left:10px;right:10px;height:6px;cursor:ns-resize;' },
      { ht: 16, css: 'bottom:0;left:0;width:16px;height:16px;cursor:nesw-resize;' },
      { ht: 17, css: 'bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;' }
    ];
    edges.forEach(function (ed) {
      var d = document.createElement('div');
      d.className = 'zfResizeEdge';
      d.style.cssText = ed.css;
      d.addEventListener('mousedown', makeGesture(function () { return ed.ht; }));
      document.body.appendChild(d);
    });

    /* ---------- 样式 ---------- */
    var css = document.createElement('style');
    css.textContent =
      '#zfWinCtrl{display:flex;align-items:center;user-select:none;-webkit-user-select:none}' +
      '#zfWinCtrl.zf-win-fixed{position:fixed;top:0;right:0;z-index:2147483000;background:rgba(24,26,48,.85);padding:4px 6px;border-radius:0 0 0 8px}' +
      '.zf-win-btn{width:34px;height:28px;display:flex;align-items:center;justify-content:center;' +
      'color:#cfd3ff;font-size:13px;cursor:pointer;border-radius:6px;transition:background .15s,color .15s}' +
      '.zf-win-btn:hover{background:rgba(255,255,255,.12)}' +
      '.zf-win-close:hover{background:rgba(255,255,255,.22);color:#fff}' +
      '#zfDragStrip{position:fixed;top:0;left:0;right:128px;height:20px;z-index:2147482500;cursor:move;}' +
      '.zfResizeEdge{position:fixed;z-index:2147482000;}' +
      'body.zf-client .topbar-right{padding-right:128px !important;position:relative;z-index:2147483001;pointer-events:auto;}';
    document.head.appendChild(css);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
