/* ============================================================
 * app-sticky-notes.js — 桌面便签（纸条钉在桌面上）
 * 来源：任务本卡片可拖拽到桌面 → 变成便签纸条，钉住并可随意拖动。
 * 便签操作：认领(发给AI) / 完成 / 取消 / 删除 / 关闭。
 * 关闭后左上角任务本徽章上会出现「钉」小图标，点它可重新展开全部便签。
 * 数据完全复用 /api/tasknotes（任务本），不新增存储。
 * ============================================================ */
(function () {
  'use strict';

  var API = '/api/tasknotes';
  var STORE_KEY = 'sticky_notes_positions_v1';
  var notes = {};          // id -> {el, taskId}
  var positions = _loadPos();

  function _loadPos() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function _savePos() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(positions)); } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 样式 ----------
  var css = [
    '.sn-note{position:fixed;z-index:99990;width:230px;min-height:85px;padding:12px 12px 6px;',
    '  background:linear-gradient(165deg,hsl(var(--sn-h,48),95%,90%),hsl(var(--sn-h,48),82%,76%));color:#4a3b12;border-radius:4px 4px 14px 4px;',
    '  box-shadow:0 6px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.6);',
    '  font-family:system-ui,sans-serif;font-size:13px;cursor:grab;user-select:none;',
    '  transform:rotate(-1.2deg);transition:box-shadow .2s,transform .2s}',
    '.sn-note:nth-child(even){transform:rotate(1.4deg)}',
    '.sn-note:hover{box-shadow:0 10px 28px rgba(0,0,0,.45);transform:rotate(0deg) scale(1.02)}',
    '.sn-note.sn-dragging{cursor:grabbing;transform:rotate(0deg) scale(1.05);z-index:99999!important}',
    /* 靠边收纳：贴到左/右边缘后自动缩进只露30px，鼠标搭上滑出 */
    '.sn-note.sn-dock-l,.sn-note.sn-dock-r{transition:left .2s ease}',
    '.sn-note.sn-dock-l:hover{left:0px!important}',
    '.sn-note.sn-dock-r:hover{left:calc(100% - 230px)!important}',
    '.sn-pin{position:absolute;top:-9px;left:50%;margin-left:-8px;width:16px;height:16px;border-radius:50%;',
    '  background:radial-gradient(circle at 35% 30%,#ff9d9d,#d32222 65%,#7d0f0f);',
    '  box-shadow:0 3px 5px rgba(0,0,0,.4),inset 0 -2px 3px rgba(0,0,0,.25)}',
    '.sn-note.sn-done .sn-pin{background:radial-gradient(circle at 35% 30%,#9df0b4,#2bbd5a 65%,#0d6b2c)}',
    '.sn-note.sn-doing .sn-pin{background:radial-gradient(circle at 35% 30%,#9fd4ff,#1f7fd8 65%,#0b3d6e)}',
    '.sn-note.sn-urgent{border:1.5px solid rgba(211,34,34,.55);box-shadow:0 6px 18px rgba(211,34,34,.35),inset 0 1px 0 rgba(255,255,255,.6)}',
    '.sn-note.sn-urgent .sn-pin{background:radial-gradient(circle at 35% 30%,#ffb3a0,#e33b1f 65%,#7d1004)}',
    '.sn-ug-flag{display:inline-block;margin-right:4px;color:#d32222;font-weight:700}',
    /* 右上角 关闭/删除 圆钮 */
    '.sn-corner{position:absolute;top:2px;right:4px;display:flex;gap:4px}',
    '.sn-x{width:18px;height:18px;border-radius:50%;font-size:11px;line-height:17px;text-align:center;cursor:pointer;',
    '  background:rgba(255,255,255,.55);border:1px solid rgba(90,70,10,.25);color:#5a480f;user-select:none}',
    '.sn-x:hover{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}',
    '.sn-x.del{color:#a32020}',
    '.sn-t{font-weight:700;font-size:13.5px;line-height:1.35;word-break:break-all;cursor:grab;outline:none;border-radius:3px}',
    '.sn-t[contenteditable="true"]:hover{background:rgba(255,255,255,.4);cursor:text}',
    '.sn-t[contenteditable="true"]:focus{background:rgba(255,255,255,.75);box-shadow:0 0 0 1.5px rgba(216,185,58,.8)}',
    '.sn-note.sn-editing{transform:rotate(0deg) scale(1.03);z-index:99998!important}',
    '.sn-note.sn-new{animation:sn-pop .35s cubic-bezier(.34,1.56,.64,1)}',
    '@keyframes sn-pop{from{transform:scale(.3) rotate(-8deg);opacity:0}to{transform:rotate(-1.2deg);opacity:1}}',
    '.sn-meta{margin-top:6px;font-size:10.5px;color:#9a853a;position:relative;height:16px}',
    '.sn-status{padding:1px 8px;border-radius:8px;background:rgba(255,255,255,.55);font-weight:600;cursor:pointer;position:absolute;left:50%;transform:translateX(-50%);',
    '  border:1px solid rgba(90,70,10,.3);transition:background .15s}',
    '.sn-status:hover{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2)}',
    '.sn-status.st-done{color:#0d6b2c;border-color:rgba(13,107,44,.45)}',
    '.sn-status.st-urgent{color:#a32020;border-color:rgba(163,32,32,.45)}',
    '.sn-time{position:absolute;right:0;top:1px}',
    '.sn-status.st-todo{color:#5a480f}',
    /* 拖拽预览虚影 */
    '.sn-ghost{position:fixed;z-index:99999;width:200px;padding:12px;pointer-events:none;',
    '  background:rgba(255,232,140,.5);border:1.5px dashed #d8b93a;border-radius:4px;color:#7a6a20;',
    '  font-size:12px;transform:rotate(-3deg)}',
    /* 任务本卡片拖出提示 */
    '.tn-card[draggable="true"]{cursor:grab}'
  ].join('');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function apiPost(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  // ---------- 便签渲染 ----------
  var STATUS_TXT = { todo: '待办', doing: '处理中', review: '待审核', done: '已完成' };

  function buildNote(t) {
    if (notes[t.id]) { updateNote(t); return notes[t.id].el; }
    var el = document.createElement('div');
    el.className = 'sn-note s-' + (t.status || 'todo');
    // 每张便签按任务 ID 稳定分配一个黄色系内的小色相偏移，方便分辨
    var _h = 0; var _s = String(t.id || '');
    for (var _i = 0; _i < _s.length; _i++) _h = (_h * 31 + _s.charCodeAt(_i)) % 1000;
    el.style.setProperty('--sn-h', (36 + (_h % 24)) + ''); // 36°~59°，都是黄→黄橙系
    el.dataset.taskId = t.id;
    var p = positions[t.id] || {};
    el.style.left = (p.x != null ? p.x : 120 + Math.random() * 200) + 'px';
    el.style.top = (p.y != null ? p.y : 120 + Math.random() * 160) + 'px';
    if (p.dock === 'l') el.classList.add('sn-dock-l');
    else if (p.dock === 'r') el.classList.add('sn-dock-r');
    el.innerHTML =
      '<div class="sn-pin" title="钉住中（双击收起）"></div>' +
      '<div class="sn-corner"><span class="sn-x" data-x="close" title="收起（可从任务本徽章找回）">✕</span><span class="sn-x del" data-x="del" title="彻底删除">🗑</span></div>' +
      '<div class="sn-t"></div>' +
      '<div class="sn-meta"><span class="sn-status" title="点击切换状态：待办 → 完成 → 加急"></span><span class="sn-time"></span></div>';
    document.body.appendChild(el);
    notes[t.id] = { el: el, taskId: t.id };
    bindDrag(el);
    el.querySelector('.sn-corner').addEventListener('click', function (e) {
      var x = e.target.closest('.sn-x'); if (!x) return;
      if (x.dataset.x === 'close') closeNote(t.id);
      else onAction('del', t.id);
    });
    // 双击标题栏 = 关闭（收起，可从徽章找回）
    el.querySelector('.sn-pin').addEventListener('dblclick', function () { closeNote(t.id); });
    // 状态徽章点击 = 循环切换：待办 → 完成 → 加急 → 待办
    el.querySelector('.sn-status').addEventListener('click', function () {
      var task = _findTask(t.id); if (!task) return;
      var s = task.status || 'todo';
      var urg = task.priority === 'urgent' && s !== 'done';
      if (s !== 'done' && !urg) onAction('toggle_done', t.id);        // 待办 → 完成
      else if (s === 'done') onAction('urgent_from_done', t.id);      // 完成 → 加急(待办+加急)
      else onAction('urgent', t.id);                                  // 加急 → 待办
    });
    // 标题 contenteditable 直接打字编辑，失焦自动保存
    var tEl = el.querySelector('.sn-t');
    (function (box) {
      box.setAttribute('contenteditable', 'true');
      box.setAttribute('spellcheck', 'false');
      box.addEventListener('focus', function () { el.classList.add('sn-editing'); });
      box.addEventListener('blur', function () {
        el.classList.remove('sn-editing');
        var task = _findTask(t.id); if (!task) return;
        var nt = box.textContent.trim();
        if (!nt) { updateNote(task); return; } // 空标题不保存，还原
        if (nt === (task.title || '')) return;
        apiPost({ action: 'update', id: t.id, title: nt }).then(function (d) {
          if (!d || d.ok === false) { updateNote(task); return; }
          if (typeof window.TaskNotes !== 'undefined') window.TaskNotes.refresh && window.TaskNotes.refresh();
          refreshFromServer();
        });
      });
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); box.blur(); }
        if (e.key === 'Escape') { var task = _findTask(t.id); if (task) { tEl.textContent = task.title || ''; } box.blur(); }
      });
      box.addEventListener('mousedown', function (e) { e.stopPropagation(); }); // 编辑时不触发拖拽
    })(tEl);
    updateNote(t);
    return el;
  }

  function updateNote(t) {
    var rec = notes[t.id]; if (!rec) return;
    var el = rec.el, s = t.status || 'todo';
    // 正在编辑中（打字）不覆盖内容，只同步状态类与按钮
    var editing = el.classList.contains('sn-editing') || el.contains(document.activeElement);
    var vis = s === 'done' ? 'done' : 'todo';
    var urg = t.priority === 'urgent' && s !== 'done';
    el.className = 'sn-note sn-' + vis + (urg ? ' sn-urgent' : '') + (editing ? ' sn-editing' : '');
    if (!editing) {
      el.querySelector('.sn-t').textContent = t.title || '';
    }
    var statusEl = el.querySelector('.sn-status');
    statusEl.innerHTML = urg ? '❗加急' : (s === 'done' ? '✅完成' : '❓待办');
    statusEl.className = 'sn-status st-' + (urg ? 'urgent' : s);
    el.querySelector('.sn-time').textContent = t.created_at ? _relTime(t.created_at) : '';
  }

  function _relTime(ms) {
    var diff = Date.now() - ms;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + '分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + '小时前';
    return Math.floor(diff / 86400e3) + '天前';
  }

  function removeNote(taskId) {
    var rec = notes[taskId]; if (!rec) return;
    rec.el.remove(); delete notes[taskId];
    delete positions[taskId]; _savePos();
  }

  function closeNote(taskId) {
    var rec = notes[taskId]; if (!rec) return;
    rec.el.remove(); delete notes[taskId];   // 位置保留，重新钉出时回到原处
    updatePinEntry();
  }

  function onAction(act, id) {
    if (act === 'close') { closeNote(id); return; }
    var body = { action: act, id: id };
    if (act === 'del') body = { action: 'delete', id: id };
    if (act === 'urgent_from_done') { body = { action: 'update', id: id, status: 'todo', urgent: true }; act = 'update'; }
    if (act === 'finish' || act === 'claim' || act === 'cancel_task' || act === 'confirm' || act === 'reject') {
      // 完成动画
      if (act === 'finish' || act === 'confirm') {
        var rec = notes[id];
        if (rec) { rec.el.style.transition = 'all .5s'; rec.el.style.opacity = '0'; rec.el.style.transform = 'scale(.8) rotate(6deg)'; }
      }
    }
    apiPost(body).then(function (d) {
      if (!d || d.ok === false) { removeStale(); return; }
      refreshFromServer();
    });
  }

  // ---------- 拖拽移动 ----------
  function bindDrag(el) {
    var sx, sy, ox, oy, dragging = false;
    el.addEventListener('mousedown', function (e) {
      if (e.target.closest('.sn-act')) return;
      dragging = true;
      el.classList.remove('sn-dock-l', 'sn-dock-r');
      el.classList.add('sn-dragging');
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(el.style.left) || 0; oy = parseFloat(el.style.top) || 0;
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      el.style.left = Math.max(-20, Math.min(window.innerWidth - 20, ox + e.clientX - sx)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy)) + 'px';
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('sn-dragging');
      var L = parseFloat(el.style.left), W = el.offsetWidth || 230, vw = window.innerWidth;
      // 松手时贴到左右边缘 → 自动收纳，只露 30px；鼠标搭上会展开
      if (L <= 20) {
        L = 30 - W;
        el.classList.add('sn-dock-l');
      } else if (L + W >= vw - 20) {
        L = vw - 30;
        el.classList.add('sn-dock-r');
      }
      el.style.left = L + 'px';
      positions[el.dataset.taskId] = { x: L, y: parseFloat(el.style.top), dock: el.classList.contains('sn-dock-l') ? 'l' : (el.classList.contains('sn-dock-r') ? 'r' : null) };
      _savePos();
    });
  }

  // ---------- 从任务本拖出 → 钉到桌面 ----------
  // 拖拽源：任务本面板里的 .tn-card（在 app-tasknotes.js 渲染后动态加 draggable）
  function armTaskCards() {
    var list = document.getElementById('tn-list'); if (!list) return;
    list.querySelectorAll('.tn-card:not([data-sn-armed])').forEach(function (card) {
      card.setAttribute('data-sn-armed', '1');
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', function (e) {
        var task = _findTask(card.dataset.id);
        if (!task) return;
        var ghost = document.createElement('div');
        ghost.className = 'sn-ghost';
        ghost.textContent = '📌 ' + (task.title || '').slice(0, 40);
        ghost.style.left = e.clientX + 10 + 'px';
        ghost.style.top = e.clientY + 10 + 'px';
        document.body.appendChild(ghost);
        var mv = function (ev) { ghost.style.left = ev.clientX + 10 + 'px'; ghost.style.top = ev.clientY + 10 + 'px'; if (ev.type === 'dragover') ev.preventDefault(); };
        var up = function (ev) {
          document.removeEventListener('dragover', mv, true);
          document.removeEventListener('drop', up, true);
          document.removeEventListener('dragend', up, true);
          ghost.remove();
          if (ev.type === 'drop' || ev.type === 'mouseup') {
            pinTask(task, ev.clientX, ev.clientY);
          }
        };
        document.addEventListener('dragover', mv, true);
        document.addEventListener('drop', up, true);
        document.addEventListener('dragend', up, true);
        e.dataTransfer && (e.dataTransfer.effectAllowed = 'copy');
      });
    });
  }

  function pinTask(task, x, y) {
    var el = buildNote(task);
    // 落点偏移一点，避免遮住鼠标下的东西
    positions[task.id] = {
      x: Math.max(0, Math.min(window.innerWidth - 240, x - 100)),
      y: Math.max(0, Math.min(window.innerHeight - 130, y - 30))
    };
    el.style.left = positions[task.id].x + 'px';
    el.style.top = positions[task.id].y + 'px';
    _savePos();
    updatePinEntry();
  }

  function _findTask(id) {
    if (typeof window.TaskNotes !== 'undefined' && window.TaskNotes._latest) {
      return window.TaskNotes._latest.filter(function (t) { return t.id === id; })[0] || null;
    }
    return null;
  }

  // ---------- 数据同步 ----------
  var SKIP_DONE_THRESHOLD = 0;
  function refreshFromServer() {
    return fetch(API).then(function (r) { return r.json(); }).then(function (d) {
      var list = (d && d.tasks) || [];
      if (typeof window.TaskNotes !== 'undefined') window.TaskNotes._latest = list;
      armTaskCards();
      var alive = {};
      list.forEach(function (t) {
        alive[t.id] = 1;
        // 已在桌面上的才自动更新；done 且桌面上没有的不自动钉出
        if (notes[t.id]) updateNote(t);
        // 新任务若曾被钉出过（positions 里有位置记录）且未 done，自动恢复
        else if (positions[t.id] && t.status !== 'done') buildNote(t);
      });
      // 任务被删除/归档清理 → 摘掉便签
      Object.keys(notes).forEach(function (id) {
        if (!alive[id]) removeNote(id);
      });
      updatePinEntry();
    }).catch(function () {});
  }

  // ---------- 徽章上的「钉」入口（已按需求彻底移除）----------
  function ensurePinEntry() {}
  function updatePinEntry() {}

  function repinAll() {
    var list = (window.TaskNotes && window.TaskNotes._latest) || [];
    list.forEach(function (t) {
      if (t.status !== 'done' && (positions[t.id] || !notes[t.id])) buildNote(t);
    });
    updatePinEntry();
  }

  // ---------- 双击徽章：在鼠标右侧新建便签 ----------
  function createNoteAt(mx, my) {
    var title = '新便签';
    fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', title: title })
    }).then(function (r) { return r.json(); }).then(function (d) {
      var task = d && d.task;
      if (!task) { refreshFromServer(); return; }
      if (typeof window.TaskNotes !== 'undefined') window.TaskNotes._latest = (window.TaskNotes._latest || []).concat([task]);
      positions[task.id] = {
        x: Math.max(0, Math.min(window.innerWidth - 240, mx + 16)),
        y: Math.max(0, Math.min(window.innerHeight - 130, my - 20))
      };
      _savePos();
      var el = buildNote(task);
      el.classList.add('sn-new');
      setTimeout(function () { el.classList.remove('sn-new'); }, 400);
      updatePinEntry();
      // 直接进入打字状态
      setTimeout(function () {
        var tEl = el.querySelector('.sn-t');
        tEl.textContent = '';
        tEl.focus();
        // 选中占位文字方便直接覆盖输入
        var range = document.createRange(); range.selectNodeContents(tEl);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }, 30);
    }).catch(function () {});
  }

  function bindBadgeDblClick() {
    var badge = document.getElementById('tn-badge');
    if (!badge || badge.dataset.snDbl) return;
    badge.dataset.snDbl = '1';
    badge.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      createNoteAt(e.clientX, e.clientY);
    });
  }

  // ---------- 移除已消失任务时清理 ----------
  function removeStale() { refreshFromServer(); }

  // ---------- 启动 ----------
  function boot() {
    // 等任务本徽章就绪
    var tries = 0;
    (function wait() {
      if (document.getElementById('tn-badge') || ++tries > 40) { refreshFromServer(); bindBadgeDblClick(); }
      else setTimeout(wait, 250);
    })();
    setInterval(refreshFromServer, 8000); // 与任务本同频轮询
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 对外句柄（调试用）
  window.StickyNotes = {
    pinById: function (id) {
      var t = _findTask(id); if (t) pinTask(t, window.innerWidth / 2, window.innerHeight / 2);
    },
    repinAll: repinAll,
    refresh: refreshFromServer
  };
})();
