// 进化树可视化 · 主界面接线（P0 一键送入对话框 + P1 涌现候选角标提醒）
// 依赖：进化树 viewer.html 通过 postMessage({__tree:1,type:'zfFillChat',text,autoSend}) 把指令发到本窗口。
// 原则：只填不发（autoSend 默认 false，保留用户回车确认权）；不阻塞主流程；轻量轮询。
(function () {
  // ===== P0：接收进化树送入的指令，填入当前活跃对话框并聚焦（不自动发送）=====
  function activeInput() {
    var box = document.querySelector('.chatbox.focused') ||
      document.querySelector('.chatbox.active') ||
      document.querySelector('.chatbox');
    if (!box) return null;
    return box.querySelector('.chatbox-inputrow textarea') || box.querySelector('textarea');
  }
  function say(msg, ok) {
    try { if (window.toast) { window.toast(msg, ok !== false); return; } } catch (e) {}
    try { console.log('[进化树]', msg); } catch (e) {}
  }
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.__tree !== 1) return;
    // 方案A：viewer iframe 确认/驳回后即时通知，立刻刷角标（不等 20s 轮询）
    if (d.type === 'emergeChanged') { try { tick(); } catch (e2) {} return; }
    if (d.type !== 'zfFillChat') return;          // R2：来源标记校验
    if (typeof d.text !== 'string' || !d.text) return;
    var inp = activeInput();
    if (!inp) { say('⚠️ 未找到可用的对话框输入框'); return; }
    inp.value = d.text;
    try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} // 触发自增高/状态同步
    inp.focus();
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
    say('🎯 指令已送入对话框，按回车即开工');
  });

  // ===== P1：涌现候选角标，轮询 emerge_pending 的全局待确认数（后端 confirm/reject 已自动置 notified）=====
  var badge = null, timer = null;
  function ensureBadge() {
    if (badge && document.body.contains(badge)) return badge;
    badge = document.createElement('div');
    badge.id = 'zfEmergeBadge';
    badge.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:99998;display:none;' +
      'background:#15271a;border:1px solid #58d68d;color:#7dffb0;border-radius:18px;' +
      'padding:6px 14px;font-size:13px;cursor:pointer;line-height:1.4;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.45);user-select:none;font-family:inherit;';
    badge.title = '进化树涌现候选待确认，点击查看并逐条确认/驳回';
    badge.onclick = openEmergePanel;
    document.body.appendChild(badge);
    return badge;
  }
  function openEmergePanel() {
    // 通知所有进化树 iframe 打开「涌现侦测」面板（viewer 内监听 __fromHost/openEmerge → 自动点 emergeBtn）
    var frames = document.querySelectorAll('iframe'), hit = 0;
    for (var i = 0; i < frames.length; i++) {
      try {
        if (/进化树/.test(frames[i].src || '')) {
          frames[i].contentWindow.postMessage({ __fromHost: 1, type: 'openEmerge' }, '*');
          hit++;
        }
      } catch (e) {}
    }
    if (!hit) say('⚠️ 请先在画布中打开进化树（小圆球），再查看涌现候选');
  }
  function tick() {
    try {
      fetch('/api/tools/capability_tree', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emerge_pending' })
      }).then(function (r) { return r.json(); }).then(function (j) {
        var n = (j && j.ok) ? (j.count || 0) : 0;
        var b = ensureBadge();
        if (n > 0) { b.style.display = 'block'; b.textContent = '🌱 涌现 ' + n + ' 待确认'; }
        else { b.style.display = 'none'; }
      }).catch(function () {});
    } catch (e) {}
  }
  function start() {
    if (!document.body) { setTimeout(start, 600); return; }
    tick();
    if (!timer) timer = setInterval(tick, 20000);   // R3：20s 轻量轮询
  }
  start();
})();
