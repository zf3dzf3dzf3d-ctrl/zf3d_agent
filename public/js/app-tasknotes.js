/* ============================================================
 * app-tasknotes.js — 主人任务簿（左上角发光徽章 + 霓虹侧滑面板）
 * 状态机：todo → doing → review → done(归档，需用户确认)
 * 后端：GET/POST /api/tasknotes
 * ============================================================ */
(function () {
  'use strict';

  var API = '/api/tasknotes';
  var open = false;
  var tasks = [];
  var panel = null, badge = null, timer = null;
  // 调试/外发句柄：AI 可直接 POST 添加任务
  window.TaskNotes = {
    add: function (title, note, remindAt) {
      return fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', title: title, note: note || '', remind_at: remindAt || '' })
      }).then(function (r) { return r.json(); }).then(function (d) { refresh(); return d; });
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function relTime(ms) {
    if (!ms) return '';
    var diff = Date.now() - ms;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
    return Math.floor(diff / 86400e3) + ' 天前';
  }

  // ---------- 拖拽 + 位置记忆（JSON 存 localStorage） ----------
  function loadPos(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function savePos(key, x, y) {
    try { localStorage.setItem(key, JSON.stringify({ x: x, y: y })); } catch (e) {}
  }
  var DRAG_CLASS = 'tn-dragging';
  if (!document.getElementById('tn-drag-style')) {
    var ds = document.createElement('style'); ds.id = 'tn-drag-style';
    ds.textContent = '.' + DRAG_CLASS + '{user-select:none!important;z-index:99999!important;' +
      'transition:none!important;will-change:left,top;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35)!important;transform:scale(1.04)!important;}';
    document.head.appendChild(ds);
  }
  function makeDraggable(el, handle, key, onMoved, onDragStart, onDragEnd) {
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('.tn-close,.tn-add-btn,input,textarea')) return;
      if (onDragStart) onDragStart();
      var rect = el.getBoundingClientRect();
      var ox = e.clientX - rect.left, oy = e.clientY - rect.top;
      var moved = false, raf = null, nx = 0, ny = 0;
      // 点击到按下有位移才算拖拽，避免轻点也进拖拽态
      function begin() {
        el.classList.add(DRAG_CLASS);
        try { document.body.style.userSelect = 'none'; } catch (err) {}
      }
      function mv(ev) {
        nx = Math.min(Math.max(0, ev.clientX - ox), window.innerWidth - rect.width);
        ny = Math.min(Math.max(0, ev.clientY - oy), window.innerHeight - 30);
        if (!moved && (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3)) begin();
        if (!moved) return;
        if (!raf) raf = requestAnimationFrame(function () {
          raf = null;
          el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.right = 'auto';
        });
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        el.classList.remove(DRAG_CLASS);
        try { document.body.style.userSelect = ''; } catch (err) {}
        if (onDragEnd) onDragEnd();
        if (moved) {
          savePos(key, parseFloat(el.style.left), parseFloat(el.style.top));
          if (onMoved) onMoved();
        }
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
    // 窗口失焦时兜底结束拖拽态（避免拖出窗口后"粘手"）
    window.addEventListener('blur', function () {
      el.classList.remove(DRAG_CLASS);
      try { document.body.style.userSelect = ''; } catch (err) {}
    });
  }

  // ---------- 便签卡贴边停靠：把某张便签拖到左右边缘 → 收成竖排小角；hover 展开详情；拖离边缘还原进列表 ----------
  var CARD_DOCKS = loadPos('tn_card_docks') || {}; // { taskId: {side:'left'|'right', y:像素} }
  var cardDockEls = {}; // taskId -> {id, corner, pop, openTimer, closeTimer}

  function saveCardDocks() {
    try { localStorage.setItem('tn_card_docks', JSON.stringify(CARD_DOCKS)); } catch (e) {}
  }
  function shortTitle(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > 10 ? s.slice(0, 10) : (s || '便签');
  }
  function findTask(id) {
    for (var i = 0; i < tasks.length; i++) if (String(tasks[i].id) === String(id)) return tasks[i];
    return null;
  }
  function placeCorner(d) {
    var info = CARD_DOCKS[d.id]; if (!info) return;
    if (info.side === 'left') { d.corner.style.left = '0px'; d.corner.style.right = 'auto'; }
    else { d.corner.style.left = (window.innerWidth - d.corner.offsetWidth) + 'px'; }
    d.corner.style.top = Math.min(Math.max(8, info.y), window.innerHeight - 60) + 'px';
  }
  function ensureCardDock(t) {
    var d = cardDockEls[t.id];
    if (d) { // 已存在：更新文案 / 加急态
      d.corner.querySelector('.tn-card-dock-label').textContent = shortTitle(t.title);
      d.corner.classList.toggle('urgent', t.priority === 'urgent');
      return;
    }
    var corner = document.createElement('div');
    corner.className = 'tn-card-dock' + (t.priority === 'urgent' ? ' urgent' : '');
    corner.title = '便签小角：悬停看详情，拖离边缘还原，拖到另一边换边';
    corner.innerHTML = '<span class="tn-card-dock-label">' + esc(shortTitle(t.title)) + '</span>';
    document.body.appendChild(corner);
    d = cardDockEls[t.id] = { id: t.id, corner: corner, pop: null, openTimer: null, closeTimer: null };
    placeCorner(d);
    bindCardDock(d);
  }
  function removeCardDock(id) {
    var d = cardDockEls[id]; if (!d) return;
    if (d.openTimer) clearTimeout(d.openTimer);
    if (d.closeTimer) clearTimeout(d.closeTimer);
    d.corner.remove(); hideCardPop(d);
    delete cardDockEls[id];
  }
  function undockCard(id) {
    delete CARD_DOCKS[id]; saveCardDocks(); removeCardDock(id); render();
  }
  function syncCardDocks() {
    var alive = {};
    tasks.forEach(function (t) {
      alive[t.id] = 1;
      if (CARD_DOCKS[t.id]) ensureCardDock(t);
    });
    Object.keys(cardDockEls).forEach(function (id) {
      if (!alive[id] || !CARD_DOCKS[id]) removeCardDock(id);
    });
  }
  // 小角 hover 250ms → 展开详情气泡；移开 500ms 收起
  function bindCardDock(d) {
    d.corner.addEventListener('mouseenter', function () {
      if (d.closeTimer) { clearTimeout(d.closeTimer); d.closeTimer = null; }
      if (d.pop || d.openTimer) return;
      d.openTimer = setTimeout(function () { d.openTimer = null; showCardPop(d); }, 250);
    });
    d.corner.addEventListener('mouseleave', function () {
      if (d.openTimer) { clearTimeout(d.openTimer); d.openTimer = null; }
      schedulePopClose(d);
    });
    // 拖拽：松手时贴边=停靠该边；离开边缘=还原进列表
    d.corner.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (d.closeTimer) { clearTimeout(d.closeTimer); d.closeTimer = null; }
      if (d.openTimer) { clearTimeout(d.openTimer); d.openTimer = null; }
      hideCardPop(d);
      var r = d.corner.getBoundingClientRect();
      var ox = e.clientX - r.left, oy = e.clientY - r.top;
      d.corner.style.transition = 'none';
      var moved = false, raf = null;
      function mv(ev) {
        if (!moved && (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3)) {
          moved = true;
          d.corner.classList.add(DRAG_CLASS);
          try { document.body.style.userSelect = 'none'; } catch (err) {}
        }
        if (!moved) return;
        var nx = ev.clientX - ox, ny = Math.max(0, ev.clientY - oy);
        if (!raf) raf = requestAnimationFrame(function () {
          raf = null;
          d.corner.style.left = nx + 'px';
          d.corner.style.top = ny + 'px';
          d.corner.style.right = 'auto';
        });
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('mouseleave', cancel);
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        d.corner.classList.remove(DRAG_CLASS);
        try { document.body.style.userSelect = ''; } catch (err) {}
        d.corner.style.transition = '';
        if (!moved) return; // 轻点不算拖拽，保留 hover 展开等行为
        var cr = d.corner.getBoundingClientRect();
        var y = cr.top;
        if (cr.left <= 8) { CARD_DOCKS[d.id] = { side: 'left', y: y }; }
        else if (cr.right >= window.innerWidth - 8) { CARD_DOCKS[d.id] = { side: 'right', y: y }; }
        else { undockCard(d.id); return; }
        saveCardDocks(); placeCorner(d);
      }
      function cancel() { // 拖出窗口松手兜底
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        d.corner.classList.remove(DRAG_CLASS);
        try { document.body.style.userSelect = ''; } catch (err) {}
        d.corner.style.transition = '';
      }
      document.addEventListener('mouseleave', cancel);
      document.addEventListener('mouseup', up);
      document.addEventListener('mousemove', mv);
    });
  }
  function showCardPop(d) {
    var t = findTask(d.id); if (!t) return;
    hideCardPop(d);
    var pop = document.createElement('div');
    pop.className = 'tn-card-pop';
    pop.innerHTML = cardHTML(t) +
      '<div class="tn-acts"><span class="tn-act no tn-undock" data-id="' + esc(t.id) + '">↩ 收回列表</span></div>';
    document.body.appendChild(pop);
    d.pop = pop;
    pop.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.tn-undock')) { undockCard(d.id); return; }
      onListClick(e); // 复用列表操作逻辑（弹层里也是 .tn-card 结构）
    });
    pop.addEventListener('mouseenter', function () {
      if (d.closeTimer) { clearTimeout(d.closeTimer); d.closeTimer = null; }
    });
    pop.addEventListener('mouseleave', function () { schedulePopClose(d); });
    var info = CARD_DOCKS[d.id]; if (!info) return;
    var pr = pop.getBoundingClientRect();
    var px = info.side === 'left' ? 30 : window.innerWidth - pr.width - 30;
    pop.style.left = Math.max(8, Math.min(px, window.innerWidth - pr.width - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(d.corner.getBoundingClientRect().top - 6, window.innerHeight - pr.height - 8)) + 'px';
  }
  function hideCardPop(d) { if (d.pop) { d.pop.remove(); d.pop = null; } }
  function schedulePopClose(d) {
    if (!d.pop || d.closeTimer) return;
    d.closeTimer = setTimeout(function () {
      d.closeTimer = null;
      if (d.pop && !d.pop.matches(':hover') && !d.corner.matches(':hover')) hideCardPop(d);
    }, 500);
  }
  window.addEventListener('resize', function () {
    Object.keys(cardDockEls).forEach(function (id) { placeCorner(cardDockEls[id]); });
  });


  // ---------- 徽章 ----------
  function ensureBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.id = 'tn-badge';
    badge.title = '任务本（便条）· 可拖动';
    badge.innerHTML = '<div class="tn-gem"><svg viewBox="0 0 24 24" width="28" height="28">'
      + '<rect x="4.5" y="3" width="15" height="18" rx="2.2" fill="#f7c948" stroke="#b8860b" stroke-width="1"/>'
      + '<rect x="4.5" y="3" width="4.6" height="18" rx="1.6" fill="#e8a33d" stroke="#b8860b" stroke-width="1"/>'
      + '<line x1="9.1" y1="4" x2="9.1" y2="20" stroke="#b8860b" stroke-width="0.8"/>'
      + '<line x1="12" y1="7" x2="17" y2="7" stroke="#8a5a1e" stroke-width="1.1" stroke-linecap="round"/>'
      + '<line x1="12" y1="10.2" x2="17" y2="10.2" stroke="#8a5a1e" stroke-width="1.1" stroke-linecap="round"/>'
      + '<line x1="12" y1="13.4" x2="17" y2="13.4" stroke="#8a5a1e" stroke-width="1.1" stroke-linecap="round"/>'
      + '<line x1="12" y1="16.6" x2="15" y2="16.6" stroke="#8a5a1e" stroke-width="1.1" stroke-linecap="round"/>'
      + '<circle cx="6.8" cy="8" r="0.6" fill="#fff3d6" stroke="#b8860b" stroke-width="0.4"/>'
      + '</svg></div>';
    var st = document.createElement('style');
    st.textContent = [
      '#tn-badge{position:fixed;top:60px;left:10px;z-index:99998;cursor:pointer;user-select:none;',
      '  width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;',
      '  background:transparent;backdrop-filter:none;border:none;',
      '  box-shadow:none;animation:none;transition:transform .15s}',
      '#tn-badge:hover{transform:scale(1.1)}',
      '@keyframes tn-breathe{0%,100%{filter:drop-shadow(0 0 3px rgba(0,229,255,.35))}50%{filter:drop-shadow(0 0 8px rgba(0,229,255,.75))}}',
      '#tn-badge.urgent{animation:tn-breathe2 1.2s ease-in-out infinite}',
      '@keyframes tn-breathe2{0%,100%{filter:drop-shadow(0 0 3px rgba(255,191,0,.4))}50%{filter:drop-shadow(0 0 9px rgba(255,191,0,.85))}}',
      '.tn-gem{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#00e5ff}',
      '#tn-badge.urgent .tn-gem{color:#ffbf00}',
      /* —— 便签卡贴边小角 + 详情气泡 —— */
      '.tn-card-dock{position:fixed;z-index:99996;width:24px;min-height:90px;padding:8px 0;',
      '  border-radius:0 8px 8px 0;cursor:move;user-select:none;opacity:.55;',
      '  background:linear-gradient(180deg,rgba(253,251,245,.95),rgba(246,241,228,.95));',
      '  border:1px solid rgba(120,100,60,.35);border-left:none;',
      '  box-shadow:2px 2px 10px rgba(0,0,0,.18);transition:opacity .2s,box-shadow .2s}',
      '.tn-card-dock:hover{opacity:1;box-shadow:3px 3px 16px rgba(0,0,0,.3)}',
      '.tn-card-dock.urgent{border-color:rgba(192,57,43,.55)}',
      '.tn-card-dock-label{display:block;writing-mode:vertical-rl;text-orientation:upright;letter-spacing:2px;',
      '  font-size:11px;font-weight:700;color:#8a6a1f;white-space:nowrap;overflow:hidden;max-height:130px;padding:2px 0}',
      '.tn-card-dock.urgent .tn-card-dock-label{color:#c0392b}',
      '.tn-card-pop{position:fixed;z-index:99997;width:320px;max-width:92vw;',
      '  background:linear-gradient(160deg,#fdfbf5,#f6f1e4);border:1px solid rgba(120,100,60,.35);',
      '  border-radius:10px;box-shadow:4px 4px 18px rgba(0,0,0,.22);padding:10px 12px;',
      '  font-family:system-ui,sans-serif;color:#3d3222;display:flex;flex-direction:column;gap:2px}',
      '.tn-card-pop .tn-undock{font-weight:600;color:#8a6a1f}',

    ].join('');
    document.head.appendChild(st);
    document.body.appendChild(badge);
    // 恢复保存的位置；若贴边则直接进入停靠态
    var p = loadPos('tn_badge_pos');
    if (p && typeof p.x === 'number') {
      badge.style.left = Math.min(Math.max(0, p.x), window.innerWidth - 40) + 'px';
      badge.style.top = Math.min(Math.max(0, p.y), window.innerHeight - 40) + 'px';
      badge.style.right = 'auto';
    }
    refresh().then(syncCardDocks);
    // 徽章整体可拖拽；click 与 drag 区分（拖动后不触发面板开关）
    var dragMoved = false;
    makeDraggable(badge, badge, 'tn_badge_pos', function () { dragMoved = true; });
    // 双击徽章 = 创建便签（不打开面板）：click 延迟 300ms 确认，双击则取消并拦截
    var lastClickTs = 0, clickTimer = null;
    badge.addEventListener('click', function (e) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (dragMoved) { dragMoved = false; return; } // 拖动结束的 click 不算数
      var now = Date.now();
      if (now - lastClickTs < 300) {
        // 双击：取消待执行的开面板，收起可能已打开的面板
        lastClickTs = 0;
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        if (panel && panel.classList.contains('open')) toggle();
        return;
      }
      lastClickTs = now;
      clickTimer = setTimeout(function () { clickTimer = null; toggle(); }, 300);
    }, true);
  }

  // ---------- 面板 ----------
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'tn-panel';
    panel.innerHTML =
      '<div class="tn-head"><span class="tn-title">◆ 任务本 · 便条</span>' +
      '<span class="tn-add-btn" id="tn-add-btn" title="记一笔">＋</span>' +
      '<span class="tn-close" id="tn-close">✕</span></div>' +
      '<div class="tn-input" id="tn-input" style="display:none">' +
      '<textarea id="tn-title" rows="2" placeholder="记一笔，直接描述即可"></textarea>' +
      '<div class="tn-input-row" style="align-items:center;gap:8px">' +
      '📅 <input type="date" id="tn-remind" style="flex:1;border:1px solid rgba(120,100,60,.35);border-radius:6px;padding:4px 6px;background:#fffbe9;color:#3d3222;font-family:inherit" title="可选：到这天通知我">' +
      '<span class="tn-btn tn-btn-primary" id="tn-save">保存</span></div></div>' +
      '<div class="tn-list" id="tn-list"></div>';
    document.body.appendChild(panel);
    var st = document.createElement('style');
    st.textContent = [
      '#tn-panel{position:fixed;top:0;left:0;z-index:99997;width:380px;max-width:92vw;height:100vh;',
      '  background:linear-gradient(160deg,#fdfbf5,#f6f1e4);backdrop-filter:blur(14px);',
      '  border-right:1px solid rgba(120,100,60,.28);box-shadow:8px 0 40px rgba(0,0,0,.15);',
      '  transform:translateX(-102%);transition:transform .28s cubic-bezier(.2,.8,.25,1);',
      '  display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#3d3222}',
      '#tn-panel.open{transform:translateX(0)}',
      '#tn-panel.tn-noslide{transition:none}',
      '.tn-head{display:flex;align-items:center;gap:10px;padding:16px 14px;border-bottom:1px solid rgba(120,100,60,.2)}',
      '.tn-title{flex:1;font-weight:700;letter-spacing:1px;color:#8a6a1f}',
      '.tn-add-btn{font-size:16px;font-weight:700;color:#8a6a1f;border:1px solid rgba(120,100,60,.4);border-radius:50%;width:24px;height:24px;line-height:22px;text-align:center;cursor:pointer}',
      '.tn-add-btn:hover{background:rgba(138,106,31,.12);box-shadow:0 0 8px rgba(138,106,31,.25)}',
      '.tn-close{cursor:pointer;color:#8c7d5c;opacity:.75;padding:0 4px}.tn-close:hover{opacity:1;color:#6b5416}',
      '.tn-input{padding:10px 14px;border-bottom:1px solid rgba(120,100,60,.16);display:flex;flex-direction:column;gap:8px}',
      '.tn-input input,.tn-input textarea{background:rgba(255,255,255,.7);border:1px solid rgba(120,100,60,.35);color:#333;border-radius:8px;padding:8px 10px;font:13px system-ui;outline:none;resize:vertical}',
      '.tn-input input:focus,.tn-input textarea:focus{border-color:rgba(138,106,31,.7)}',
      '.tn-input-row{display:flex;gap:8px;align-items:center}',
      '.tn-input-row input[type=date]{flex:1;color-scheme:light}',
      '.tn-btn{cursor:pointer;font-size:12px;border-radius:8px;padding:6px 14px;border:1px solid rgba(120,100,60,.3);color:#6b5c3a}',
      '.tn-btn-primary{background:rgba(138,106,31,.12);border-color:rgba(138,106,31,.5);color:#8a6a1f;font-weight:600}',
      '.tn-btn-primary:hover{background:rgba(138,106,31,.22)}',
      '.tn-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
      '.tn-list::-webkit-scrollbar{width:6px}.tn-list::-webkit-scrollbar-thumb{background:rgba(120,100,60,.35);border-radius:3px}',
      '.tn-empty{text-align:center;color:#a08f68;padding:40px 0;font-size:13px}',
      // 日历提醒徽章
      '.tn-remind{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:6px;font-size:12px;background:rgba(120,100,60,.1);color:#7a6a45}',
      '.tn-remind.due{background:#fff3c4;color:#8a6a1f;font-weight:600;animation:tnPulse 1.6s infinite}',
      '.tn-remind.overdue{background:#ffe0dc;color:#c0392b;font-weight:600;animation:tnPulse 1.2s infinite}',
      '@keyframes tnPulse{0%,100%{opacity:1}50%{opacity:.55}}',
      '.tn-card.rem-due{box-shadow:0 0 0 2px #e9c33a66}',
      '.tn-card.rem-overdue{box-shadow:0 0 0 2px #e05b4b66}',
      '.tn-card{position:relative;border-radius:10px;padding:10px 12px;background:rgba(255,255,255,.72);',
      '  border:1px solid rgba(255,235,180,.12);transition:box-shadow .3s}',
      '.tn-card .tn-t{font-weight:600;font-size:13.5px;margin-bottom:2px}',
      '.tn-card .tn-d{font-size:12px;color:#7a6b48;margin:4px 0 0;white-space:pre-wrap}',
      '.tn-card .tn-meta{display:flex;gap:10px;font-size:11px;color:#a08f68;margin-top:6px;align-items:center}',
      '.tn-card .tn-acts{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}',
      '.tn-act{font-size:11px;padding:3px 9px;border-radius:6px;cursor:pointer;border:1px solid rgba(120,100,60,.25);color:#6b5c3a}',
      '.tn-act:hover{background:rgba(120,100,60,.08)}',
      '.tn-act.go{color:#8a6a1f;border-color:rgba(138,106,31,.5)}',
      '.tn-act.ok{color:#1d8a4e;border-color:rgba(29,138,78,.45)}',
      '.tn-act.no{color:#c0392b;border-color:rgba(192,57,43,.45)}',
      /* 状态光效 */
      '.tn-card.s-todo{border-left:3px solid rgba(138,106,31,.5)}',
      '.tn-card.s-doing{border-color:rgba(138,106,31,.45)}',
      '.tn-card.s-review{border-color:rgba(216,144,0,.5)}',
      '.tn-card.s-done{opacity:.6;border-left:3px solid rgba(29,138,78,.5)}',
      '.tn-tag{font-size:10px;padding:1px 7px;border-radius:8px;letter-spacing:1px}',
      '.tn-tag.todo{background:rgba(138,106,31,.1);color:#6b5c3a}',
      '.tn-tag.doing{background:rgba(138,106,31,.16);color:#8a6a1f}',
      '.tn-tag.review{background:rgba(216,144,0,.14);color:#a06f00}',
      '.tn-tag.done{background:rgba(29,138,78,.12);color:#1d8a4e}',
      '.tn-card.s-done .tn-t{text-decoration:line-through;color:#a08f68}',
      '.tn-card.urgent{border-left:3px solid rgba(192,57,43,.8)}',
      '.tn-card.urgent.s-todo{border-left:3px solid rgba(192,57,43,.8);box-shadow:0 1px 6px rgba(192,57,43,.15)}',
      '.tn-card.urgent .tn-tag.todo{background:rgba(192,57,43,.12);color:#c0392b}'
    ].join('');
    document.head.appendChild(st);

    document.getElementById('tn-close').addEventListener('click', toggle);
    document.getElementById('tn-add-btn').addEventListener('click', function () {
      var box = document.getElementById('tn-input');
      box.style.display = box.style.display === 'none' ? 'flex' : 'none';
      if (box.style.display === 'flex') document.getElementById('tn-title').focus();
    });
    document.getElementById('tn-save').addEventListener('click', saveNew);
    document.getElementById('tn-title').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNew(); });
    document.getElementById('tn-list').addEventListener('click', onListClick);
    // 面板头部可拖拽（拖动时取消滑入动画，位置存 JSON）
    makeDraggable(panel, panel.querySelector('.tn-head'), 'tn_panel_pos', function () {
      panel.classList.add('tn-noslide'); // 用类关掉滑入动画，不写内联 transform，避免 ✕ 收起失效
    });
    // 面板 hover 缓冲：鼠标在面板内不收起，移开 500ms 后收
    bindResize();
  }

  // ---------- 面板宽度拖拽：右缘手柄，280–560px，记忆 ----------
  function bindResize() {
    var h = document.createElement('div');
    h.className = 'tn-resize';
    h.title = '拖动调整面板宽度';
    panel.appendChild(h);
    var st = document.createElement('style');
    st.textContent = '.tn-resize{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:ew-resize;z-index:5}';
    document.head.appendChild(st);
    h.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var startX = e.clientX, startW = panel.getBoundingClientRect().width;
      function mv(ev) {
        var w = Math.min(Math.max(280, startW + (ev.clientX - startX)), 560);
        panel.style.width = w + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        try { localStorage.setItem('tn_panel_w', panel.getBoundingClientRect().width); } catch (err) {}
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
    var w = parseFloat(localStorage.getItem('tn_panel_w'));
    if (w >= 280 && w <= 560) panel.style.width = w + 'px';
  }

  function saveNew() {
    var t = document.getElementById('tn-title').value.trim();
    if (!t) { document.getElementById('tn-title').focus(); return; }
    var rd = document.getElementById('tn-remind');
    var remindAt = rd ? rd.value : '';
    window.TaskNotes.add(t, '', remindAt).then(function () {
      document.getElementById('tn-title').value = '';
      if (rd) rd.value = '';
      document.getElementById('tn-input').style.display = 'none';
    });
  }

  function apiPost(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  function onListClick(e) {
    var el = e.target.closest('.tn-act'); if (!el) return;
    var id = el.closest('.tn-card').dataset.id;
    var act = el.dataset.act;
    var body = { action: act, id: id };
    if (act === 'del') { body = { action: 'delete', id: id }; }
    // toggle_done / urgent 直接透传到后端
    if (act === 'toggle_done' && el.textContent.indexOf('完成') >= 0) {
      // 完成粒子消散彩蛋
      var card = el.closest('.tn-card');
      card.style.transition = 'all .5s'; card.style.opacity = '0'; card.style.transform = 'scale(.9)';
    }
    apiPost(body).then(refresh);
  }

  // ---------- 渲染 ----------
  var STATUS = { todo: '❓待办', doing: '❓待办', review: '❓待办', done: '✅完成' };
  function cardHTML(t) {
    var s = t.status || 'todo';
    var vis = s === 'done' ? 'done' : 'todo';
    var acts = [];
    // 日历提醒徽章：📅 今天到期（琥珀）/ ⏰ 已过期（红）/ 📅 未来日期（灰）
    var remindHTML = '';
    if (t.remind_at && s !== 'done') {
      var rs = t.remind_state || '';
      if (rs === 'overdue') remindHTML = '<span class="tn-remind overdue" title="已过期未处理">⏰ ' + esc(t.remind_at) + ' 已到期</span>';
      else if (rs === 'due') remindHTML = '<span class="tn-remind due" title="今天到期">📅 今天到期</span>';
      else remindHTML = '<span class="tn-remind" title="到这天通知我">📅 ' + esc(t.remind_at) + '</span>';
    }
    acts.push('<span class="tn-act ' + (s === 'done' ? 'no' : 'ok') + '" data-act="toggle_done">' + (s === 'done' ? '↩️ 待办' : '✅ 完成') + '</span>');
    if (s !== 'done') acts.push('<span class="tn-act ' + (t.priority === 'urgent' ? 'no' : 'go') + '" data-act="urgent">' + (t.priority === 'urgent' ? '❗取消加急' : '❗加急') + '</span>');
    acts.push('<span class="tn-act no" data-act="del">🗑 删除</span>');
    return '<div class="tn-card s-' + vis + (t.priority === 'urgent' ? ' urgent' : '') +
      (t.remind_state === 'due' ? ' rem-due' : '') + (t.remind_state === 'overdue' ? ' rem-overdue' : '') +
      '" data-id="' + esc(t.id) + '">' +
      '<div class="tn-t">' + (t.priority === 'urgent' ? '<span style="color:#ff5f4d">❗</span>' : '') + esc(t.title) + ' <span class="tn-tag ' + vis + '">' + STATUS[s] + '</span></div>' +
      (t.note ? '<div class="tn-d">' + esc(t.note) + '</div>' : '') +
      (remindHTML ? '<div>' + remindHTML + '</div>' : '') +
      (s === 'review' && t.receipt ? '<div class="tn-d" style="color:#a06f00">AI 回执：' + esc(t.receipt) + '</div>' : '') +
      '<div class="tn-meta"><span>' + relTime(t.created_at) + '</span></div>' +
      '<div class="tn-acts">' + acts.join('') + '</div></div>';
  }

  function render() {
    var list = document.getElementById('tn-list'); if (!list) return;
    var visible = tasks.filter(function (t) { return !CARD_DOCKS[t.id]; });
    if (!visible.length) { list.innerHTML = '<div class="tn-empty">暂无任务<br>点右上「＋」开始记一笔</div>'; syncCardDocks(); return; }
    var ACT = { todo: 'toggle_done', doing: 'toggle_done', review: 'toggle_done', done: 'toggle_done' };
    list.innerHTML = visible.map(cardHTML).join('');
    bindListCardDrag(list);
    syncCardDocks();
  }

  // ---------- 列表内便签卡拖拽到左右边缘 → 停靠成小角 ----------
  function bindListCardDrag(list) {
    Array.prototype.forEach.call(list.querySelectorAll('.tn-card'), function (card) {
      card.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest('.tn-act')) return; // 按钮不触发拖拽
        var id = card.dataset.id;
        var startX = e.clientX, startY = e.clientY, moved = false;
        var ghost = null;
        function mv(ev) {
          if (!moved) {
            if (Math.abs(ev.clientX - startX) < 6 && Math.abs(ev.clientY - startY) < 6) return;
            moved = true;
            ghost = card.cloneNode(true);
            ghost.style.cssText = 'position:fixed;z-index:99999;width:' + card.offsetWidth + 'px;' +
              'pointer-events:none;opacity:.85;box-shadow:4px 4px 18px rgba(0,0,0,.3);margin:0';
            document.body.appendChild(ghost);
            card.style.opacity = '.35';
          }
          ghost.style.left = (ev.clientX - ghost.offsetWidth / 2) + 'px';
          ghost.style.top = (ev.clientY - 14) + 'px';
          ghost.style.outline = (ev.clientX <= 8 || ev.clientX >= window.innerWidth - 8)
            ? '2px solid #8a6a1f' : '';
        }
        function up(ev) {
          document.removeEventListener('mousemove', mv);
          document.removeEventListener('mouseup', up);
          if (ghost) ghost.remove();
          card.style.opacity = '';
          if (!moved) return;
          if (ev.clientX <= 8) { CARD_DOCKS[id] = { side: 'left', y: Math.max(8, ev.clientY - 45) }; }
          else if (ev.clientX >= window.innerWidth - 8) { CARD_DOCKS[id] = { side: 'right', y: Math.max(8, ev.clientY - 45) }; }
          else return;
          saveCardDocks(); render();
        }
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
      });
    });
  }

  function refreshBadge() {
    var n = tasks.filter(function (t) { return t.status !== 'done'; }).length;
    var urgent = tasks.some(function (t) { return t.status !== 'done' && t.priority === 'urgent'; });
    if (!badge) return;
    badge.title = '任务本：当前有 ' + n + ' 个任务';
    badge.classList.toggle('urgent', urgent);
  }

  function refresh() {
    return fetch(API).then(function (r) { return r.json(); }).then(function (d) {
      tasks = (d && d.tasks) || [];
      render(); refreshBadge();
      checkReminders();
    }).catch(function () {});
  }

  // ---------- 日历提醒：到期弹通知（每次会话每条只弹一次） ----------
  var REMIND_SEEN_KEY = 'tn_remind_seen_v1';
  function _seenMap() {
    try { return JSON.parse(localStorage.getItem(REMIND_SEEN_KEY) || '{}'); } catch (e) { return {}; }
  }
  function checkReminders() {
    var today = (new Date()).toISOString().slice(0, 10);
    var seen = _seenMap();
    var due = tasks.filter(function (t) {
      return t.remind_at && t.remind_at <= today && t.status !== 'done' && !seen[t.id + '_' + t.remind_at];
    });
    if (!due.length) return;
    due.forEach(function (t) { seen[t.id + '_' + t.remind_at] = 1; });
    try { localStorage.setItem(REMIND_SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
    due.forEach(function (t) {
      var msg = (t.remind_at < today ? '⏰ 到期提醒（' + t.remind_at + '）：' : '📅 今日提醒：') + t.title;
      // 浏览器系统通知
      try {
        if (window.Notification && Notification.permission === 'granted') {
          new Notification('任务本提醒', { body: msg });
        } else if (window.Notification && Notification.permission !== 'denied') {
          Notification.requestPermission();
        }
      } catch (e) {}
      // 页面内 toast（兜底）
      showToast(msg);
      // 标记后端已提醒，刷新徽章
      apiPost({ action: 'remind_ack', id: t.id });
    });
  }
  function showToast(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:70px;right:20px;z-index:99999;max-width:320px;padding:12px 16px;' +
      'background:#fffbe9;border:1px solid #d8a900;border-left:4px solid #d8a900;border-radius:8px;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.25);font:14px system-ui;color:#3d3222;opacity:0;transition:opacity .3s';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 400);
    }, 8000);
  }

  function toggle() {
    ensurePanel();
    // 恢复面板自定义位置（一旦拖过，改用自由定位）
    if (!panel.dataset.posDone) {
      var p = loadPos('tn_panel_pos');
      if (p && typeof p.x === 'number') {
        panel.style.transition = 'none';
        panel.style.left = p.x + 'px';
        panel.style.top = p.y + 'px';
        panel.style.right = 'auto';
        panel.style.height = 'auto';
        panel.style.maxHeight = '92vh';
        panel.style.bottom = 'auto';
        panel.classList.add('tn-noslide');
        panel.dataset.posDone = '1';
        setTimeout(function () { panel.style.transition = ''; }, 50);
      }
    }
    open = !open;
    if (open && !panel.dataset.posDone) {
      // 面板未自定义位置时，初始位置跟随徽章当前位置
      if (badge) {
        var br = badge.getBoundingClientRect();
        var pr = panel.getBoundingClientRect();
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.height = 'auto';
        panel.style.maxHeight = '92vh';
        var px = Math.min(br.left + 12, window.innerWidth - pr.width - 8);
        var py = Math.min(br.bottom + 10, window.innerHeight - pr.height - 8);
        panel.style.left = Math.max(8, px) + 'px';
        panel.style.top = Math.max(8, py) + 'px';
        panel.dataset.posDone = '1';
        panel.classList.add('tn-noslide');
      }
    }
    if (panel.dataset.posDone) {
      // display 模式下必须清掉初始的 translateX(-102%)，否则面板被平移到屏幕外（表现为点不开）
      panel.style.transform = open ? 'none' : '';
      panel.style.display = open ? 'flex' : 'none';
    } else {
      panel.classList.toggle('open', open);
    }
    if (open) refresh();
  }

  // ---------- 面板宽度拖拽：右缘手柄，280–560px，记忆 ----------

  // ---------- 启动 ----------
  function boot() {
    ensureBadge();
    refresh();
    // 不做定时轮询，打开面板或操作后手动刷新
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
