/* zf-dsh-switch.js v1
 * 右下角 一键切换 朱峰无限 ↔ dsh（DeepSeek Harness）
 * - 悬浮按钮固定 right:18px bottom:18px，zIndex 极高
 * - 点击切到 dsh：全屏 iframe 加载 dsh 网页端（harness.chat.deepseek.com）
 * - 再点切回：移除 iframe，回到朱峰画布
 * - 状态存 localStorage，刷新后保持
 */
(function () {
  'use strict';
  var DSH_URL = 'https://harness.chat.deepseek.com';
  var LS_KEY = 'zf_dsh_switch_on';

  var btn = document.createElement('div');
  btn.id = 'zf-dsh-switch-btn';
  btn.title = '一键切换 朱峰无限 ↔ dsh';
  btn.style.cssText = [
    'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483646',
    'width:52px', 'height:52px', 'border-radius:50%',
    'background:linear-gradient(135deg,#4D6BFE,#7b5cff)',
    'color:#fff', 'display:flex', 'align-items:center', 'justify-content:center',
    'font-size:24px', 'cursor:pointer', 'user-select:none',
    'box-shadow:0 4px 16px rgba(77,107,254,.45)',
    'border:2px solid rgba(255,255,255,.35)'
  ].join(';');
  btn.textContent = '⇄';

  var frame = null;

  function render() {
    var on = localStorage.getItem(LS_KEY) === '1';
    if (on && !frame) {
      frame = document.createElement('iframe');
      frame.id = 'zf-dsh-frame';
      frame.src = DSH_URL;
      frame.allow = 'clipboard-read; clipboard-write';
      frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;' +
        'border:none;z-index:2147483645;background:#fff;';
      document.body.appendChild(frame);
    } else if (!on && frame) {
      frame.remove();
      frame = null;
    }
    btn.textContent = on ? '🏠' : '⇄';
    btn.title = on ? '切回朱峰无限' : '切到 dsh (DeepSeek Harness)';
    btn.style.background = on
      ? 'linear-gradient(135deg,#ff8a4d,#ff5c7b)'
      : 'linear-gradient(135deg,#4D6BFE,#7b5cff)';
  }

  btn.addEventListener('click', function () {
    var on = localStorage.getItem(LS_KEY) === '1';
    localStorage.setItem(LS_KEY, on ? '0' : '1');
    render();
  });

  function boot() {
    document.body.appendChild(btn);
    render();
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
