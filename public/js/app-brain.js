// 主脑（Main Brain）v2 —— 风筝观察者式
// 底栏「主脑」按钮 → 点击用角色列表的「主脑」角色打开普通对话框（App.openRoleChat），
// 并自动把后台（/api/brain）已收集的报告+历史插入为首条消息发给主脑。
// 旧常驻面板 toggle/poll 保留（BrainPanel.toggle 可手动调用），默认入口不再使用。
(function () {
  'use strict';
  if (window.BrainPanel) return;

  var API = {
    state: '/api/brain/state',
    chat: '/api/brain/chat',
    control: '/api/brain/control',
    summary: '/api/brain/summary',
    report: '/api/brain/report'
  };
  var st = {
    open: false, timer: null, sending: false,
    lastLen: 0, unread: 0, autoReport: true, interval: 60
  };

  // ---------- 底栏按钮（插在「守卫」按钮前，即小狗守卫的右侧，与风筝/守卫风格一致） ----------
  function injectBtn(retry) {
    var btn = document.getElementById('brainDockBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'brainDockBtn';
      var anchor = document.getElementById('dogGuardBtn');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
      else {
        // 底栏（守卫按钮）尚未生成：延迟重试注入，避免按钮脱离底栏
        if (!retry) setTimeout(function () { injectBtn(true); }, 300);
        else document.body.appendChild(btn);
      }
    }
    btn.className = 'zf-dock-btn dog-guard-btn brain-fab';
    btn.title = '主脑：打开主脑角色对话框（自动插入后台观察记录）';
    btn.innerHTML = '<span class="tk-label">主脑</span><span class="tk-dot brain-dot" id="brainDot"></span>';
    btn.onclick = openBrainChat;
  }

  /* ---------- 点击主脑 → 风筝观察者式：打开普通角色对话框，并自动插入后台收集的记录 ---------- */
  function findBrainRole(cb) {
    fetch('/api/roles')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var all = (res && (res.roles || res.data)) || [];
        var exact = all.find(function (r) { return (r.name || '').trim() === '主脑'; });
        var loose = all.find(function (r) { return (r.name || '').indexOf('主脑') > -1; });
        cb(exact || loose || null);
      })
      .catch(function () { cb(null); });
  }

  var st = window.__brainState = window.__brainState || { injecting: false };

  function openBrainChat() {
    if (st.injecting) return; // 注入进行中防重入，避免向同一对话框重复注入
    if (!window.App || typeof App.openRoleChat !== 'function') { toggle(); return; }
    // 先记录打开前已有的对话框集合，之后只认新增的那个，避免取错目标
    var before = new Set(Array.prototype.map.call(document.querySelectorAll('.chatbox'), function (b) { return b; }));
    findBrainRole(function (role) {
      App.openRoleChat(role || { id: '', name: '主脑', avatar: '🧠' });
      st.injecting = true;
      waitForNewChatbox(before, function (box) {
        injectBrainContext(box);
        st.injecting = false;
      }, function () { st.injecting = false; });
    });
  }

  /* 轮询等待 openRoleChat 创建的新对话框出现（最长 5 秒），规避固定延时的竞态 */
  function waitForNewChatbox(before, cb, onTimeout) {
    var tries = 0;
    (function poll() {
      var boxes = document.querySelectorAll('.chatbox');
      var fresh = null;
      for (var i = boxes.length - 1; i >= 0; i--) {
        if (!before.has(boxes[i])) { fresh = boxes[i]; break; }
      }
      if (fresh) { cb(fresh); return; }
      if (++tries > 50) { if (onTimeout) onTimeout(); return; } // 5 秒仍未见新对话框，放弃注入（不打扰）
      setTimeout(poll, 100);
    })();
  }

  /* 把后台已收集的信息（最近报告 + 播报/对话历史）作为首条消息插入主脑对话框并发送 */
  function injectBrainContext(box) {
    var parts = [];
    fetch(API.report).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (d) {
      if (d && d.ok && d.text) parts.push('═══ 主脑最近报告（' + (d.time || '') + '）═══\n' + d.text);
      return fetch(API.state, { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return null; });
    }).then(function (d) {
      if (d && d.ok && Array.isArray(d.history)) {
        var lines = d.history.slice(-30).map(function (m) {
          if (!m || !m.text) return '';
          if (m.role === 'user') return '用户：' + String(m.text).slice(0, 300);
          if (m.role === 'event') return (m.level && m.level !== 'info' ? '[事件/' + m.level + '] ' : '') + String(m.text).slice(0, 300);
          return '主脑：' + String(m.text).slice(0, 300);
        }).filter(function (s) { return s; });
        if (lines.length) parts.push('═══ 主脑面板最近记录 ═══\n' + lines.join('\n'));
      }
      if (!parts.length) return; // 后台暂无记录，不打扰
      var text = '（以下是主脑后台自动收集的观察记录，请你接管继续分析）\n\n' + parts.join('\n\n') +
                 '\n\n═══ 接管请求 ═══\n请基于以上记录，给出当前项目状态的判断和建议。';
      if (!box) return;
      var input = box.querySelector('textarea') ||
                  box.querySelector('.chatbox-input') ||
                  box.querySelector('input[type="text"]');
      var btn = box.querySelector('.send-btn');
      if (input && btn) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(function () { btn.click(); }, 100);
      }
    });
  }

  // ---------- 面板 DOM ----------
  function ensurePanel() {
    if (document.getElementById('brainPanel')) return;
    var p = document.createElement('div');
    p.id = 'brainPanel';
    p.className = 'brain-panel';
    p.innerHTML =
      '<div class="brain-head">' +
        '<span class="brain-title">🧠 主脑<span class="brain-sub" id="brainSub">观察中</span></span>' +
        '<span class="brain-head-ops">' +
          '<label class="brain-switch" title="自主播报开关（关闭后主脑只答不推）">' +
            '<input type="checkbox" id="brainAutoChk" checked> 播报</label>' +
          '<input id="brainIntervalInput" type="number" min="20" max="600" step="10" ' +
            'style="width:52px;height:22px;margin-right:4px;padding:0 4px;border:1px solid var(--border,#444);border-radius:4px;background:var(--bg-card,#1e1e1e);color:var(--text,#ddd);font-size:12px" ' +
            'title="采集周期（秒），范围 20~600，回车保存" />' +
          '<span style="font-size:12px;color:var(--text2,#888);margin-right:4px">秒/轮</span>' +
          '<button id="brainPauseBtn" class="brain-mini-btn" title="暂停观察30分钟（大规模改代码时用）">暂停观察</button>' +
          '<button id="brainSumBtn" class="brain-mini-btn" title="立即触发一次总结">总结</button>' +
          '<button id="brainCopyBtn" class="brain-mini-btn" title="一键复制主脑最近一次总结/报告全文，可粘贴给其他对话">复制报告</button>' +
          '<button id="brainMinBtn" class="brain-mini-btn brain-close-x" title="最小化（主脑后台继续运行）">×</button>' +
        '</span>' +
      '</div>' +
      '<div class="brain-msgs" id="brainMsgs"></div>' +
      '<div class="brain-inputrow">' +
        '<input id="brainInput" type="text" placeholder="问主脑（如：刚才那个报错怎么回事？）" />' +
        '<button id="brainVoiceBtn" class="voice-btn brain-voice-btn" title="语音输入（识别结果写入左侧输入框，说「发送」可直接发送）">🎤</button>' +
        '<button id="brainSendBtn">发送</button>' +
      '</div>';
    document.body.appendChild(p);

    // 左边缘拖拽调宽（记忆到 localStorage）
    (function () {
      var handle = document.createElement('div');
      handle.className = 'brain-resize-handle';
      p.appendChild(handle);
      var W_MIN = 320, W_MAX = Math.floor(window.innerWidth * 0.9);
      var saved = parseInt(localStorage.getItem('brainPanelW') || '', 10);
      if (saved >= W_MIN && saved <= 1600) p.style.width = saved + 'px';
      var startX = 0, startW = 0, dragging = false;
      function onMove(e) {
        if (!dragging) return;
        var w = startW + (startX - e.clientX);
        w = Math.max(W_MIN, Math.min(w, W_MAX));
        p.style.width = w + 'px';
        e.preventDefault();
      }
      function onUp() {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        localStorage.setItem('brainPanelW', String(p.offsetWidth));
      }
      handle.addEventListener('mousedown', function (e) {
        dragging = true; startX = e.clientX; startW = p.offsetWidth;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });
      handle.addEventListener('touchstart', function (e) {
        dragging = true; startX = e.touches[0].clientX; startW = p.offsetWidth;
      }, { passive: true });
      handle.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        var w = startW + (startX - e.touches[0].clientX);
        p.style.width = Math.max(W_MIN, Math.min(w, W_MAX)) + 'px';
        e.preventDefault();
      }, { passive: false });
      handle.addEventListener('touchend', onUp);
    })();

    document.getElementById('brainMinBtn').addEventListener('click', function () { toggle(); });
    document.getElementById('brainSendBtn').addEventListener('click', send);
    document.getElementById('brainInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) send();
    });
    document.getElementById('brainAutoChk').addEventListener('change', function () {
      st.autoReport = this.checked;
      fetch(API.control, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_report: st.autoReport }) });
    });
    var intervalInput = document.getElementById('brainIntervalInput');
    intervalInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var v = parseInt(this.value, 10);
      if (!v || v < 20 || v > 600) { pushLocal('brain', '采集周期需在 20~600 秒之间'); return; }
      st.interval = v;
      fetch(API.control, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: v }) });
      pushLocal('brain', '采集周期已设为每 ' + v + ' 秒一次。');
      this.blur();
    });
    document.getElementById('brainPauseBtn').addEventListener('click', function () {
      fetch(API.control, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: true }) });
      pushLocal('brain', '已暂停观察 30 分钟（期间只答不采），可点「暂停观察」旁状态恢复或等它自动恢复。');
    });
    document.getElementById('brainSumBtn').addEventListener('click', function () {
      fetch(API.summary, { method: 'POST' });
      pushLocal('brain', '手动总结已触发，主脑正在思考…');
    });
    document.getElementById('brainCopyBtn').addEventListener('click', function () {
      var btn = this;
      fetch(API.report).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.ok || !d.text) { btn.textContent = '无报告'; setTimeout(function(){ btn.textContent = '复制报告'; }, 1500); return; }
        var full = '【主脑报告】' + (d.time || '') + '\n\n' + d.text + '\n\n（来自主脑自动观察，请结合当前对话处理）';
        var done = function () {
          btn.textContent = '已复制✓';
          pushLocal('brain', '报告已复制到剪贴板，可直接粘贴到任意对话发给执行 AI。');
          setTimeout(function(){ btn.textContent = '复制报告'; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(full).then(done).catch(function () { fallbackCopy(full); done(); });
        } else { fallbackCopy(full); done(); }
      }).catch(function () { btn.textContent = '复制失败'; setTimeout(function(){ btn.textContent = '复制报告'; }, 1500); });
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function pushLocal(kind, text) {
    var box = document.getElementById('brainMsgs');
    if (!box) return;
    box.appendChild(mkMsg({ role: 'brain', kind: kind, text: text, ts: Date.now() / 1000 }));
    // 【DOM 防膨胀】本地追加的消息超过 200 条时裁掉最旧的
    while (box.children.length > 200) box.removeChild(box.firstElementChild);
    box.scrollTop = box.scrollHeight;
  }

  // ---------- 消息渲染 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function tm(ts) {
    try {
      var d = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
      return d.toTimeString().slice(0, 5);
    } catch (e) { return ''; }
  }
  function mkMsg(m) {
    var div = document.createElement('div');
    if (m.role === 'event') {
      div.className = 'brain-msg brain-ev brain-ev--' + (m.level || 'info');
      div.innerHTML = '<span class="brain-ev-line">⚡ [' + esc(m.kind) + '] ' + esc(m.text) +
        '</span><span class="brain-tm">' + tm(m.ts) + '</span>';
      div.title = '系统事件（折叠条，聚合金色/warn 橙/error 红）';
    } else if (m.role === 'user') {
      div.className = 'brain-msg brain-me';
      div.innerHTML = esc(m.text);
    } else {
      div.className = 'brain-msg brain-ai' + (m.level === 'warn' || m.level === 'error' ? ' brain-ai--alert' : '');
      // Markdown 渲染（复用对话窗的 renderMarkdown，降级为转义文本）
      var raw = String(m.text == null ? '' : m.text);
      var html;
      try {
        html = (window.App && typeof App.renderMarkdown === 'function')
          ? App.renderMarkdown(raw) : esc(raw).replace(/\n/g, '<br>');
      } catch (e) { html = esc(raw).replace(/\n/g, '<br>'); }
      div.innerHTML = '<span class="brain-md">🧠 ' + html + '</span>' +
        '<span class="brain-ops"><button class="brain-copy-one" title="复制这条消息，可粘贴给其他对话">复制</button></span>' +
        '<span class="brain-tm">' + tm(m.ts) + '</span>';
      div.querySelector('.brain-copy-one').addEventListener('click', function () {
        var b = this;
        var done = function () { b.textContent = '已复制✓'; setTimeout(function(){ b.textContent = '复制'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(raw).then(done).catch(function () { fallbackCopy(raw); done(); });
        } else { fallbackCopy(raw); done(); }
      });
    }
    return div;
  }

  function render(history) {
    var box = document.getElementById('brainMsgs');
    if (!box || !Array.isArray(history)) return;
    var sig = history.length + '|' + (history.length ? (history[history.length - 1].text || '').slice(0, 40) : '');
    if (sig === st._sig) return;
    st._sig = sig;
    box.innerHTML = '';
    // 【DOM 防膨胀】历史可能很长，只渲染最近 200 条，避免面板 DOM 无限扩大
    var _slice = history.length > 200 ? history.slice(-200) : history;
    _slice.forEach(function (m) { box.appendChild(mkMsg(m)); });
    box.scrollTop = box.scrollHeight;
  }

  // ---------- 轮询 ----------
  function poll() {
    if (document.hidden) return; // 页面不可见时跳过，防后台标签堆积请求
    fetch(API.state, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) return;
      var s = d.state || {};
      if (s.interval && document.activeElement !== document.getElementById('brainIntervalInput')
          && document.getElementById('brainIntervalInput').value != s.interval) {
        document.getElementById('brainIntervalInput').value = s.interval;
      }
      var sub = document.getElementById('brainSub');
      if (sub) sub.textContent = s.paused ? '已暂停' : (s.running ? '观察中 · ' + (s.cycles || 0) + ' 轮' : '启动中');
      render(d.history);
      // 未读角标：面板收起且出现新 warn/summary
      if (!st.open) {
        var n = (d.history || []).length;
        if (n > st.lastLen) {
          var bad = (d.history || []).slice(st.lastLen).some(function (m) {
            return m.role === 'event' && m.level !== 'info' || m.role === 'brain';
          });
          st.unread += n - st.lastLen;
          var dot = document.getElementById('brainDot');
          if (dot && bad) dot.classList.add('brain-dot--alert');
        }
        st.lastLen = n;
      }
    }).catch(function () {}).finally(function () {
      // 链式调度：上一轮请求结束后才排下一轮，服务器卡顿时请求不会堆积叠罗汉
      if (st.timer) { clearTimeout(st.timer); }
      st.timer = setTimeout(poll, 8000);
    });
  }
  function startPoll() {
    if (st.timer) return;
    poll();
  }
  function stopPoll() {
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
  }

  // ---------- 开合 ----------
  function toggle() {
    st.open = !st.open;
    ensurePanel();
    document.getElementById('brainPanel').classList.toggle('brain-open', st.open);
    var dot = document.getElementById('brainDot');
    if (st.open && dot) { dot.classList.remove('brain-dot--alert'); st.unread = 0; }
    if (st.open) { poll(); var i = document.getElementById('brainInput'); if (i) i.focus(); }
  }

  // ---------- 发送 ----------
  function send() {
    var inp = document.getElementById('brainInput');
    var text = (inp.value || '').trim();
    if (!text || st.sending) return;
    inp.value = '';
    pushLocal('user', text);
    st.sending = true;
    var btn = document.getElementById('brainSendBtn');
    btn.textContent = '…';
    fetch(API.chat, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        st._sig = null; // 强制重渲染
        poll();
      })
      .catch(function () { pushLocal('brain', '（网络错误，发送失败）'); })
      .finally(function () { st.sending = false; btn.textContent = '发送'; });
  }

  // ---------- 启动 ----------
  function boot() { injectBtn(); startPoll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.BrainPanel = { toggle: toggle, poll: poll };
})();
