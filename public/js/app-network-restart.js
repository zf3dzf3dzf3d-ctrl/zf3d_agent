// ========== app-network-restart.js - 无感一键重启后台（重做版） ==========
// 设计原则：隐形、无弹窗、无遮罩、快。
// 入口：左上角一个极小的半透明圆点，平时几乎看不见（低透明度呼吸），
//       鼠标悬停才浮现"重启后台"字样，点击后静默重启，后台恢复即自动收尾。
// 重启过程中仅在小圆点上有轻微状态动画（黄色转圈→绿色对勾），不干扰任何操作。

(function () {
  'use strict';

  var DOT_ID = 'zfRestartDot';
  var restarting = false;          // 防抖：重启进行中忽略再次点击
  var lastClickAt = 0;             // 10 秒内不重复触发

  function host() { return location.origin; }

  // ===== 创建隐形圆点 =====
  function ensureDot() {
    var dot = document.getElementById(DOT_ID);
    if (dot) return dot;
    dot = document.createElement('div');
    dot.id = DOT_ID;
    dot.title = '';
    dot.innerHTML =
      '<span class="zfRD-core"></span>' +
      '<span class="zfRD-label">重启后台</span>';
    var st = document.createElement('style');
    st.textContent = [
      '#' + DOT_ID + '{position:fixed;top:6px;left:8px;width:10px;height:10px;',
      'border-radius:50%;cursor:pointer;z-index:2147483000;opacity:.18;',
      'transition:opacity .25s, width .2s, height .2s;user-select:none;',
      'display:flex;align-items:center;gap:6px;}',
      '#' + DOT_ID + ':hover{opacity:1;}',
      '#' + DOT_ID + ' .zfRD-core{width:10px;height:10px;border-radius:50%;',
      'background:#7f8c9b;flex:none;transition:background .3s, box-shadow .3s;}',
      '#' + DOT_ID + ':hover .zfRD-core{box-shadow:0 0 6px rgba(127,140,155,.8);}',
      '#' + DOT_ID + ' .zfRD-label{font:11px/1.4 system-ui,sans-serif;color:#8aa;',
      'white-space:nowrap;opacity:0;transform:translateX(-4px);',
      'transition:opacity .2s, transform .2s;pointer-events:none;}',
      '#' + DOT_ID + ':hover .zfRD-label{opacity:1;transform:none;}',
      /* 重启中：黄色呼吸 */
      '#' + DOT_ID + '.busy{opacity:.55;pointer-events:none;}',
      '#' + DOT_ID + '.busy .zfRD-core{background:#f0b429;',
      'animation:zfRDPulse 1.1s ease-in-out infinite;}',
      /* 成功：绿色一闪 */
      '#' + DOT_ID + '.ok .zfRD-core{background:#2ecc71;box-shadow:0 0 8px rgba(46,204,113,.9);}',
      /* 失败：红色 */
      '#' + DOT_ID + '.fail .zfRD-core{background:#e74c3c;box-shadow:0 0 8px rgba(231,76,60,.9);}',
      '@keyframes zfRDPulse{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.5);opacity:.5;}}'
    ].join('');
    document.head.appendChild(st);
    dot.addEventListener('click', onClick);
    document.body.appendChild(dot);
    return dot;
  }

  function setDot(cls) {
    var dot = document.getElementById(DOT_ID);
    if (!dot) return;
    dot.className = cls || '';
    if (cls === 'ok' || cls === 'fail') {
      setTimeout(function () { setDot(''); }, 3000);
    }
  }

  // ===== 点击：静默重启 =====
  function onClick() {
    var now = Date.now();
    if (restarting || now - lastClickAt < 10000) return;
    lastClickAt = now;
    restarting = true;
    setDot('busy');

    fetch(host() + '/api/restart_server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).catch(function () { /* 后台会掉线，请求失败是预期内的 */ });

    // 轮询健康检查：服务端拉起新进程后 /api/health 会恢复
    var tries = 0, maxTries = 60; // 最多等 60 秒
    var timer = setInterval(function () {
      tries++;
      fetch(host() + '/api/health?_=' + Date.now(),
            { cache: 'no-store' })
        .then(function (r) {
          if (r.ok) {
            clearInterval(timer);
            restarting = false;
            setDot('ok');
          } else if (tries >= maxTries) {
            clearInterval(timer);
            restarting = false;
            setDot('fail');
          }
        })
        .catch(function () {
          if (tries >= maxTries) {
            clearInterval(timer);
            restarting = false;
            setDot('fail');
          }
        });
    }, 1000);
  }

  // ===== 60 秒一次的网络守护轮询：断网时圆点变红提示 =====
  function pollGuard() {
    fetch(host() + '/api/network_guard', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!restarting) {
          var down = j && (j.down === true || j.status === 'down');
          setDot(down ? 'fail' : '');
        }
      })
      .catch(function () {});
  }

  function init() {
    ensureDot();
    setInterval(pollGuard, 60000);
    pollGuard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
