/* zf-ext-entries.js v1
 * 扩展 UI 入口统一挂载器（一劳永逸）
 * - 启动时拉 /api/ext/ui_registry，得到所有扩展自声明的 manifest
 * - 按 position 渲染：corner=右下角悬浮按钮列（多个自动纵向堆叠）
 * - 支持 type: iframe-switch（全屏 iframe 开关）/ link（新开页）
 * - enabled=false 的不渲染；扩展删目录或删 manifest 即自动消失
 * 主程序只需在 index.html 引一次本脚本，以后新增扩展 UI 零改动。
 */
(function () {
  'use strict';

  function boot(items) {
    // id → manifest 映射（panel 事件委托用）
    var itemsById = {};
    items.forEach(function (m) { itemsById[m.id] = m; });

    // 错误条目（manifest 损坏/缺字段）：灰显小徽标提示，不进正常队列
    var errors = items.filter(function (m) { return m.error; });
    var corner = items.filter(function (m) {
      return !m.error && m.enabled !== false && m.position === 'corner' && m.type !== 'api-only';
    });
    if (!corner.length && !errors.length) return;

    // 堆叠容器：右下角，自下而上排
    var stack = document.createElement('div');
    stack.id = 'zf-ext-corner-stack';
    stack.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;' +
      'display:flex;flex-direction:column;gap:10px;align-items:center;';
    document.body.appendChild(stack);

    errors.forEach(function (m) {
      var btn = document.createElement('div');
      btn.title = '扩展 "' + m.id + '" manifest 异常: ' + m.error + '（请修复 extensions/' + m.id + '/manifest.json）';
      btn.style.cssText = [
        'width:52px', 'height:52px', 'border-radius:50%',
        'background:#8a8a8a', 'opacity:.45',
        'color:#fff', 'display:flex', 'align-items:center', 'justify-content:center',
        'font-size:22px', 'cursor:help', 'user-select:none'
      ].join(';');
      btn.textContent = '⚠';
      stack.appendChild(btn);
    });

    corner.forEach(function (m) {
      var lsKey = 'zf_ext_on_' + m.id;
      var btn = document.createElement('div');
      btn.className = 'zf-ext-btn';
      btn.dataset.ext = m.id;
      btn.title = m.tipIdle || m.title || m.id;
      btn.style.cssText = [
        'width:52px', 'height:52px', 'border-radius:50%',
        'background:linear-gradient(135deg,#4D6BFE,#7b5cff)',
        'color:#fff', 'display:flex', 'align-items:center', 'justify-content:center',
        'font-size:24px', 'cursor:pointer', 'user-select:none',
        'box-shadow:0 4px 16px rgba(77,107,254,.45)',
        'border:2px solid rgba(255,255,255,.35)'
      ].join(';');
      btn.textContent = m.icon || '⧉';
      stack.appendChild(btn);

      var frame = null;
      function render() {
        var on = localStorage.getItem(lsKey) === '1';
        if (m.type === 'iframe-switch') {
          if (on && !frame) {
            frame = document.createElement('iframe');
            frame.src = m.url;
            if (m.allow) frame.allow = m.allow;
            frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;' +
              'border:none;z-index:2147483645;background:#fff;';
            document.body.appendChild(frame);
          } else if (!on && frame) {
            frame.remove(); frame = null;
          }
          btn.textContent = on ? (m.iconActive || '🏠') : (m.icon || '⧉');
          btn.title = on ? (m.tipActive || '切回') : (m.tipIdle || m.title);
          btn.style.background = on
            ? 'linear-gradient(135deg,#ff8a4d,#ff5c7b)'
            : 'linear-gradient(135deg,#4D6BFE,#7b5cff)';
        }
      }
      btn.addEventListener('click', function () {
        if (m.type === 'link') { window.open(m.url, '_blank'); return; }
        var on = localStorage.getItem(lsKey) === '1';
        localStorage.setItem(lsKey, on ? '0' : '1');
        render();
      });
      render();
    });

    // ── panel 类型：右侧抽屉 iframe（阶段B）──
    var panels = items.filter(function (m) { return !m.error && m.enabled !== false && m.position === 'corner' && m.type === 'panel'; });
    // panel 按钮也已在上面的 corner 队列渲染，这里只需在点击时走抽屉逻辑；
    // 为此在 click 处理里补 panel 分支（见下方事件委托）。
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('.zf-ext-btn');
      if (!btn) return;
      var m = itemsById[btn.dataset.ext];
      if (!m || m.type !== 'panel') return;
      var lsKey = 'zf_ext_on_' + m.id;
      var on = localStorage.getItem(lsKey) === '1';
      localStorage.setItem(lsKey, on ? '0' : '1');
      renderPanel(m, on ? null : btn);
    }, true);
  }

  // panel 抽屉状态表
  var panelFrames = {};
  function renderPanel(m, btn) {
    var lsKey = 'zf_ext_on_' + m.id;
    var on = localStorage.getItem(lsKey) === '1';
    if (on && !panelFrames[m.id]) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:420px;max-width:90vw;' +
        'z-index:2147483645;background:#fff;box-shadow:-6px 0 24px rgba(0,0,0,.25);' +
        'display:flex;flex-direction:column;';
      var bar = document.createElement('div');
      bar.style.cssText = 'height:34px;display:flex;align-items:center;justify-content:space-between;' +
        'padding:0 10px;background:linear-gradient(135deg,#4D6BFE,#7b5cff);color:#fff;font-size:13px;';
      bar.innerHTML = '<span>' + (m.icon || '⧉') + ' ' + (m.title || m.id) + '</span>';
      var close = document.createElement('span');
      close.textContent = '✕';
      close.style.cssText = 'cursor:pointer;font-size:16px;user-select:none;';
      close.addEventListener('click', function () {
        localStorage.setItem(lsKey, '0');
        renderPanel(m, null);
      });
      bar.appendChild(close);
      var frame = document.createElement('iframe');
      frame.src = m.url;
      if (m.allow) frame.allow = m.allow;
      frame.style.cssText = 'flex:1;border:none;width:100%;';
      wrap.appendChild(bar); wrap.appendChild(frame);
      document.body.appendChild(wrap);
      panelFrames[m.id] = wrap;
    } else if (!on && panelFrames[m.id]) {
      panelFrames[m.id].remove();
      delete panelFrames[m.id];
    }
  }

  function start() {
    fetch('/api/ext/ui_registry')
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) boot(d.items || []); })
      .catch(function () {});
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
