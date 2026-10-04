/* ============================================================
 * app-quick-note.js - 随手标题（画布便签标记）
 * 功能：在创建对话框中点击「随手标题」，在画布对应位置创建一个小标签；
 *      回车确认 / 双击可再编辑 / 空内容回车取消 / 悬停出 ✕ 直接删除 / 可拖动。
 * 节点挂在 canvasContent 内，随画布平移缩放（用户确认：跟随画布）。
 * 持久化：UserSettings（localStorage + 服务器 user_settings.json），键 zf3d_quick_notes。
 * 加载顺序：放在 app-kite-links.js 之后即可（仅依赖 window.UserSettings 延迟取用）。
 * ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'zf3d_quick_notes';
  var _notes = [];        // [{id, x, y, text}]
  var _seq = 0;
  var _saveTimer = null;

  function hostEl() {
    return document.getElementById('canvasContent') || document.body;
  }

  function loadAll() {
    try {
      var raw = (window.UserSettings && UserSettings.get(LS_KEY, null)) || localStorage.getItem(LS_KEY);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (Array.isArray(raw)) _notes = raw.filter(function (n) { return n && typeof n.x === 'number' && typeof n.y === 'number'; });
    } catch (e) { _notes = []; }
    return _notes;
  }

  function saveAll() {
    // 防抖 300ms 合并写
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        if (window.UserSettings) UserSettings.set(LS_KEY, _notes);
        else localStorage.setItem(LS_KEY, JSON.stringify(_notes));
      } catch (e) {}
    }, 300);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---- 撤销/重做记录（走画布菜单 CanvasMenu 统一历史栈）----
  function recordQn(op) {
    try {
      if (window.__qnApplying) return; // 撤销/重做回放期间不再记录
      if (window.CanvasMenu && typeof CanvasMenu.record === 'function') CanvasMenu.record(op);
    } catch (e) {}
  }

  // ---- 渲染单个节点 ----
  function render(note) {
    var host = hostEl();
    var el = document.createElement('div');
    el.className = 'quick-note';
    el.dataset.qnId = note.id;
    el.style.left = note.x + 'px';
    el.style.top = note.y + 'px';
    el.title = '双击编辑 · 拖动移动 · ✕ 删除';
    // 注意：恢复渲染时不做“视口左侧自动收窄”判断（getBoundingClientRect 受画布平移/缩放影响，重启后易误判导致文字看似消失），收窄只在主动拖拽时生效
    el.innerHTML =
      '<span class="qn-icon">📍</span>' +
      '<span class="qn-text">' + esc(note.text) + '</span>' +
      '<button type="button" class="qn-del" title="删除随手标题">✕</button>';

    // 删除（直接删，用户已确认不要二次确认）
    el.querySelector('.qn-del').addEventListener('click', function (e) {
      e.stopPropagation();
      remove(note.id);
    });

    // 双击进入编辑
    el.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      if (e.target.closest('.qn-ball') || e.target.closest('.qn-fold')) return;
      startEdit(note.id);
    });

    // 拖动（按住标签主体拖动；按下后移动超过 3px 才算拖动，避免干扰双击）
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      // 连线小圆球 / 折叠按钮 / 删除按钮：不触发标题拖动
      if (e.target.closest('.qn-del') || e.target.closest('.qn-ball') || e.target.closest('.qn-fold')) return;
      // 阻止冒泡，避免触发画布整体平移（拖拽的应是标签本身）
      e.stopPropagation();
      var startX = e.clientX, startY = e.clientY;
      var nx = note.x, ny = note.y;
      var moved = false;
      // 联动：拖标题时连线对话框保持相对位置跟随（快照偏移）
      var followSnap = null;
      try { if (window.QuickNoteLinks && QuickNoteLinks.beginFollow) followSnap = QuickNoteLinks.beginFollow(note.id); } catch (err) {}
      function onMove(ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        moved = true;
        e.preventDefault();
        nx = note.x + dx / _scale(); ny = note.y + dy / _scale();
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
        // 拖到屏幕左侧时收窄（宽度不超过 40px），离开后恢复
        if (el.getBoundingClientRect().left <= 100) el.classList.add('qn-narrow');
        else el.classList.remove('qn-narrow');
        try { if (followSnap && QuickNoteLinks.applyFollow) QuickNoteLinks.applyFollow(followSnap, nx, ny); } catch (err) {}
        // 松手后仍按最终位置决定是否保持收窄
        if (el.getBoundingClientRect().left <= 100) el.classList.add('qn-narrow');
        else el.classList.remove('qn-narrow');
      }
      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
          var fx = note.x, fy = note.y;
          note.x = nx; note.y = ny;
          // 【v7】纯位置磁吸：未吸附→尝试吸附标题栏；已吸附→永不脱离（dx/dy 已随拖动更新）
          if (!note.attach) attachNearest(note);
          saveAll();
          try { if (followSnap && QuickNoteLinks.endFollow) QuickNoteLinks.endFollow(followSnap); } catch (err) {}
          recordQn({ type: 'qn-note-move', label: '移动随手标题', id: note.id, from: { x: fx, y: fy }, to: { x: nx, y: ny } });
          ev.stopPropagation(); e.preventDefault();
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    host.appendChild(el);
    note._el = el;
    // 【v7】右键菜单已彻底移除（与对话框右键冲突）；颜色走编辑态、列表走 Shift+L
    applyQnState(note);
    snapToChat(note); // 吸附态初始对齐，防首帧闪旧位置
    return el;
  }

  // ---- 二期：吸附跟随 + 颜色标记（读坐标、无连线）----
  var QN_COLORS = [
    { key: '',        label: '默认', bg: '' },
    { key: 'yellow',  label: '黄',   bg: '#f6c945' },
    { key: 'green',   label: '绿',   bg: '#7bc96f' },
    { key: 'blue',    label: '蓝',   bg: '#5aa9e6' },
    { key: 'pink',    label: '粉',   bg: '#f08bb4' },
    { key: 'purple',  label: '紫',   bg: '#a78bdc' }
  ];

  // 注入样式（自包含，不动外部 css）
  (function () {
    var st = document.createElement('style');
    st.id = 'qn-v2-style';
    st.textContent =
      '.quick-note.qn-attached{box-shadow:0 0 0 2px rgba(90,140,255,.55),0 2px 8px rgba(0,0,0,.25);}' +
      '.qn-pin{display:none;margin:0 2px;font-size:10px;}' +
      '.quick-note.qn-attached .qn-pin{display:inline;}' +
      '.quick-note.qn-c-yellow{background:#f6c945;color:#4a3a00;}' +
      '.quick-note.qn-c-green{background:#7bc96f;color:#123008;}' +
      '.quick-note.qn-c-blue{background:#5aa9e6;color:#04263f;}' +
      '.quick-note.qn-c-pink{background:#f08bb4;color:#4a0a24;}' +
      '.quick-note.qn-c-purple{background:#a78bdc;color:#25124a;}' +
      '.quick-note.qn-flash{animation:qnFlash 1s ease 2;}' +
      '@keyframes qnFlash{0%,100%{transform:scale(1);}50%{transform:scale(1.18);}}' +
      // 【v7.3】水吸动画：被磁吸时像水珠一样"啪"地贴上并轻微回弹
      '.quick-note.qn-snap-in{animation:qnSnapIn .45s cubic-bezier(.34,1.56,.64,1);}' +
      '@keyframes qnSnapIn{0%{transform:translateY(10px) scaleY(.82) scaleX(1.08);opacity:.55;}' +
      '55%{transform:translateY(-3px) scaleY(1.08) scaleX(.96);opacity:1;}' +
      '100%{transform:translateY(0) scale(1);}}' +
      '#qn-list-panel .qnlp-dot{width:10px;height:10px;border-radius:50%;flex:none;background:#bbb;}' +
      'background:#fff;border:1px solid #d5d9e0;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.2);font-size:13px;}' +
      '#qn-list-panel .qnlp-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;' +
      'font-weight:600;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;}' +
      '#qn-list-panel .qnlp-item{display:flex;gap:8px;align-items:center;padding:7px 12px;cursor:pointer;}' +
      '#qn-list-panel .qnlp-item:hover{background:#eef2ff;}' +
      '#qn-list-panel .qnlp-dot{width:10px;height:10px;border-radius:50%;flex:none;background:#bbb;}' +
      '#qn-list-panel .qnlp-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '#qn-list-panel .qnlp-empty{padding:14px;color:#999;text-align:center;}';
    document.head.appendChild(st);
  })();

  function qnChatEl(chatId) {
    return document.getElementById('chatbox-' + chatId) ||
      (hostEl().querySelector ? hostEl().querySelector('.chatbox[data-chat-id="' + chatId + '"]') : null);
  }

  // 对话框画布坐标（与便签同处 canvasContent 坐标系）
  function qnChatPos(chatElm) {
    return { x: chatElm.offsetLeft || 0, y: chatElm.offsetTop || 0 };
  }

  function applyQnState(note) {
    if (!note._el) return;
    QN_COLORS.forEach(function (c) { if (c.key) note._el.classList.remove('qn-c-' + c.key); });
    if (note.color) note._el.classList.add('qn-c-' + note.color);
    var attached = !!(note.attach && qnChatEl(note.attach.chatId));
    note._el.classList.toggle('qn-attached', attached);
    // 📌 指示符（吸附态）
    var pin = note._el.querySelector('.qn-pin');
    if (!pin) {
      pin = document.createElement('span');
      pin.className = 'qn-pin'; pin.textContent = '📌';
      var icon = note._el.querySelector('.qn-icon');
      if (icon && icon.parentNode) icon.parentNode.insertBefore(pin, icon.nextSibling);
      else note._el.insertBefore(pin, note._el.firstChild);
    }
  }

  // 吸附态初始对齐：render 时立即摆到位，消除首帧闪跳
  function snapToChat(note) {
    if (!note.attach || !note._el) return;
    var c = qnChatEl(note.attach.chatId);
    if (!c || !document.body.contains(c)) return;
    // 【v7.2】最小化（display:none）时坐标为 0，跳过对齐防闪到左上角
    if (!c.offsetParent && c.getClientRects().length === 0) return;
    note.x = Math.round(c.offsetLeft + note.attach.dx);
    note.y = Math.round(c.offsetTop + note.attach.dy);
    note._el.style.left = note.x + 'px';
    note._el.style.top = note.y + 'px';
  }

  // 跟随循环：每帧读对话框坐标，零动画零延迟；最小化状态也照常跟随。
  // 门控优化：无吸附便签时循环自停，attach 时再唤醒，避免 rAF 空转
  var _qnRafRunning = false;
  function ensureFollowLoop() {
    if (_qnRafRunning) return;
    _qnRafRunning = true;
    requestAnimationFrame(followTick);
  }
  function hasAttached() {
    for (var i = 0; i < _notes.length; i++) { if (_notes[i].attach) return true; }
    return false;
  }
  function followTick() {
    for (var i = 0; i < _notes.length; i++) {
      var n = _notes[i];
      if (!n.attach || !n._el) continue;
      var c = qnChatEl(n.attach.chatId);
      if (!c || !document.body.contains(c)) {
        // 【v7.1】启动保护：页面加载后 5 秒内不随删（防异步渲染未挂载误删），只跳过等待
        if (!followTick._bootSafe) followTick._bootSafe = Date.now() + 5000;
        if (Date.now() < followTick._bootSafe) { _cleanOrphans(0); continue; }
        // 【v7】对话框已关闭/删除 → 便签直接随删（不入撤销栈，防与画布菜单记录打架）
        try { if (n._el && n._el.parentNode) n._el.remove(); } catch (e) {}
        window.__qnApplying = true; // 屏蔽 recordQn
        var idx2 = _notes.indexOf(n);
        if (idx2 >= 0) _notes.splice(idx2, 1);
        window.__qnApplying = false;
        saveAll(); i--; continue;
      }
      var px = Math.round(c.offsetLeft + n.attach.dx);
      var py = Math.round(c.offsetTop + n.attach.dy);
      // 【v7.2】对话框最小化时 display:none → offsetLeft/Top 归 0，若照搬会把便签瞬移到画布左上角"隐身"。
      // 此处检测宿主不可见（display:none）则跳过本帧更新，便签停在最后已知位置；还原后自动恢复跟随。
      if (!c.offsetParent && c.getClientRects().length === 0) continue;
      if (px !== n.x || py !== n.y) {
        n.x = px; n.y = py;
        n._el.style.left = px + 'px';
        n._el.style.top = py + 'px';
      }
    }
    if (hasAttached()) requestAnimationFrame(followTick);
    else _qnRafRunning = false;
  }

  // 【v7】纯位置吸附：便签中心落在对话框「标题栏矩形外扩 24px」内 → 吸附最近一个；未命中不吸附
  function attachNearest(note) {
    if (!note._el) return false;
    var cx = note.x + (note._el.offsetWidth || 0) / 2;
    var cy = note.y + (note._el.offsetHeight || 0) / 2;
    var PAD = 24, best = null, bestD = Infinity;
    hostEl().querySelectorAll('.chatbox').forEach(function (c) {
      var h = c.querySelector('.chatbox-header, .chat-header, .chatbox-title');
      if (!h) h = c; // 兜底：无标题元素时用对话框顶部区域
      var hx = c.offsetLeft + h.offsetLeft, hy = c.offsetTop + h.offsetTop;
      var hw = h.offsetWidth || c.offsetWidth, hh = h.offsetHeight || 40;
      if (cx >= hx - PAD && cx <= hx + hw + PAD && cy >= hy - PAD && cy <= hy + hh + PAD) {
        var d = (hx + hw / 2 - cx) * (hx + hw / 2 - cx) + (hy + hh / 2 - cy) * (hy + hh / 2 - cy);
        if (d < bestD) { bestD = d; best = c; }
      }
    });
    if (!best) return false;
    // 【v7.3】落点：便签紧贴标题栏【上方】（间距 8px），水平夹在标题栏范围内，而不是吸进标题栏里
    var nh = note._el.offsetHeight || 30;
    var nw = note._el.offsetWidth || 60;
    var hh2 = best.querySelector('.chatbox-header, .chat-header, .chatbox-title') || best;
    var hx2 = best.offsetLeft + hh2.offsetLeft, hw2 = hh2.offsetWidth || best.offsetWidth;
    var tx = Math.min(Math.max(note.x, hx2), hx2 + Math.max(hw2 - nw, 0));
    var ty = best.offsetTop + hh2.offsetTop - nh - 8;
    note.attach = {
      chatId: best.dataset.chatId || (best.id || '').replace(/^chatbox-/, ''),
      dx: tx - best.offsetLeft,
      dy: ty - best.offsetTop
    };
    note.x = Math.round(tx); note.y = Math.round(ty);
    // 水吸动画：贴上去时轻微弹性回弹，像水珠吸附；结束后移除过渡类，避免影响跟随循环
    var elx = note._el;
    elx.classList.remove('qn-snap-in'); void elx.offsetWidth; // 重触发动画
    elx.classList.add('qn-snap-in');
    elx.style.left = note.x + 'px';
    elx.style.top = note.y + 'px';
    clearTimeout(elx._snapT);
    elx._snapT = setTimeout(function () { elx.classList.remove('qn-snap-in'); }, 460);
    saveAll(); applyQnState(note); ensureFollowLoop();
    return true;
  }

  function detach(note) {
    // 【v7】只能吸附无法脱离：此函数保留供撤销回放等内部使用，正常拖动不再调用
    note.attach = null; saveAll(); applyQnState(note);
  }

  // ---- 便签列表面板 ----
  var _qnListEl = null;
  function toggleQnList(forceOpen) {
    if (_qnListEl && forceOpen) { return; }
    if (_qnListEl) { _qnListEl.remove(); _qnListEl = null; return; }
    var p = document.createElement('div');
    p.id = 'qn-list-panel';
    var head = document.createElement('div');
    head.className = 'qnlp-head';
    head.innerHTML = '<span>📋 便签列表</span>';
    var x = document.createElement('span'); x.textContent = '✕'; x.style.cursor = 'pointer';
    x.onclick = function () { toggleQnList(); };
    head.appendChild(x);
    p.appendChild(head);
    var items = _notes.slice().sort(function (a, b) { return (a.text || '').localeCompare(b.text || ''); });
    if (!items.length) {
      var em = document.createElement('div'); em.className = 'qnlp-empty'; em.textContent = '暂无随手标题'; p.appendChild(em);
    }
    items.forEach(function (n) {
      var it = document.createElement('div'); it.className = 'qnlp-item';
      var dot = document.createElement('span'); dot.className = 'qnlp-dot';
      var cd = QN_COLORS.find(function (c) { return c.key === n.color; });
      if (cd && cd.bg) dot.style.background = cd.bg;
      if (n.attach && qnChatEl(n.attach.chatId)) dot.style.boxShadow = '0 0 0 2px rgba(90,140,255,.6)';
      var tx = document.createElement('span'); tx.className = 'qnlp-text'; tx.textContent = n.text || '(空)';
      it.appendChild(dot); it.appendChild(tx);
      it.title = (n.attach ? '📌 已吸附 · ' : '') + '点击定位';
      it.onclick = function () {
        toggleQnList();
        if (!n._el) render(n);
        try { n._el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); } catch (e) {}
        n._el.classList.remove('qn-flash'); void n._el.offsetWidth; n._el.classList.add('qn-flash');
        setTimeout(function () { n._el.classList.remove('qn-flash'); }, 2200);
      };
      p.appendChild(it);
    });
    document.body.appendChild(p);
    _qnListEl = p;
  }

  // 画布缩放比例（canvasContent 的 transform scale），拖动时抵消
  function _scale() {
    try {
      var t = getComputedStyle(hostEl()).transform;
      if (t && t !== 'none') {
        var m = t.match(/matrix\(([^,]+),/);
        if (m) return Math.abs(parseFloat(m[1])) || 1;
      }
    } catch (e) {}
    return 1;
  }

  // ---- 编辑态：input 小输入框，回车确认，空回车取消 ----
  function startEdit(id) {
    var note = _notes.find(function (n) { return n.id === id; });
    if (!note) return;
    var el = note._el;
    if (!el || !document.body.contains(el)) el = render(note);
    el.classList.add('qn-editing');
    var textSpan = el.querySelector('.qn-text');
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'qn-input';
    input.value = note.text;
    input.placeholder = DEFAULT_QN_TEXT;
    textSpan.style.display = 'none';
    textSpan.parentNode.insertBefore(input, textSpan);
    input.focus();
    input.select();

    var _committed = false;
    function commit() {
      if (_committed || !input.isConnected) return; // 防止 remove 触发 blur 导致二次 commit 报错
      _committed = true;
      var v = input.value.trim();
      input.remove();
      textSpan.style.display = '';
      el.classList.remove('qn-editing');
      if (!v) {
        // 新建时空内容回车 → 取消；已有内容时空回车 → 保留原文
        if (!note.text) remove(id);
        return;
      }
      if (v !== note.text) {
        var oldText = note.text;
        note.text = v;
        textSpan.textContent = v;
        saveAll();
        recordQn({ type: 'qn-note-rename', label: '重命名随手标题', id: id, from: oldText, to: v });
        // 【双向闭环】标题改名后，同步更新所有已连线对话的备注
        try { if (window.QuickNoteLinks && typeof window.QuickNoteLinks.syncTitleToChats === 'function') window.QuickNoteLinks.syncTitleToChats(id); } catch (eSync) {}
      }
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation(); // 不让画布快捷键接管
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') {
        input.value = note.text; commit(); // Esc 取消修改
      }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    input.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  }

  // ---- 新建 ----
  var DEFAULT_QN_TEXT = '随手标题'; // 默认文字：新建时直接带出，用户可改
  function create(canvasX, canvasY, initialText) {
    var note = { id: 'qn' + Date.now() + '_' + (++_seq), x: Math.round(canvasX), y: Math.round(canvasY), text: (initialText == null ? '' : String(initialText)) || DEFAULT_QN_TEXT };
    _notes.push(note);
    render(note);
    saveAll();
    recordQn({ type: 'qn-note-add', label: '新建随手标题', note: JSON.parse(JSON.stringify(note)) });
    startEdit(note.id);
    return note;
  }

  // ---- 删除 ----
  function removeNote(id) {
    var idx = _notes.findIndex(function (n) { return n.id === id; });
    if (idx < 0) return null;
    var el = _notes[idx]._el;
    if (el && el.parentNode) el.remove();
    var snapshot = JSON.parse(JSON.stringify({ note: _notes[idx], index: idx }));
    _notes.splice(idx, 1);
    saveAll();
    return snapshot;
  }
  function remove(id) {
    var snap = removeNote(id);
    if (snap) recordQn({ type: 'qn-note-remove', label: '删除随手标题', note: snap.note, index: snap.index });
  }

  // 【v7.1】孤儿清理防误删：仅当画布上已出现对话框（说明渲染已完成）才清理，
  // 否则延迟重试，避免启动时异步渲染未挂载把合法吸附的便签当孤儿误删
  function _cleanOrphans(attempt) {
    var hasAnyChat = !!hostEl().querySelector('.chatbox');
    if (!hasAnyChat) {
      if (attempt < 8) { setTimeout(function () { _cleanOrphans(attempt + 1); }, 1500); }
      return; // 始终未见过任何对话框：保守跳过，不删数据
    }
    var removed = false;
    for (var i = _notes.length - 1; i >= 0; i--) {
      if (_notes[i].attach && !qnChatEl(_notes[i].attach.chatId)) {
        try { if (_notes[i]._el && _notes[i]._el.parentNode) _notes[i]._el.remove(); } catch (e) {}
        _notes.splice(i, 1); removed = true;
      }
    }
    if (removed) saveAll();
  }

  // ---- 恢复所有已保存的标题 ----
  function restoreAll() {
    loadAll();
    _notes.forEach(render);
  }

  // ---- 导出 API ----
  window.QuickNote = {
    create: create,
    remove: remove,
    restoreAll: restoreAll,
    all: function () { return _notes.slice(); },
    // ---- 撤销/重做内部句柄（供 app-undo.js 回放）----
    _internal: {
      notes: function () { return _notes; },
      render: render,
      removeNote: removeNote,
      saveAll: saveAll
    }
  };

  // 页面就绪后恢复（延迟等 UserSettings 服务器数据到达；并在设置刷新后重放，防止被服务器覆盖丢失）
  function _safeRestoreAll() {
    // 先把已渲染的清掉再重放，避免重复
    _notes.forEach(function (n) { if (n._el && n._el.parentNode) n._el.remove(); n._el = null; });
    restoreAll();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_safeRestoreAll, 500); });
  } else {
    setTimeout(_safeRestoreAll, 500);
  }
  // 【v7.1】启动孤儿清理：等画布渲染出对话框后才开始（防误删）
  document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { _cleanOrphans(0); }, 800); });
  window.addEventListener('user-settings-refreshed', function () {
    setTimeout(_safeRestoreAll, 50);
  });
  // 二期：吸附跟随循环（rAF 读坐标，无连线无动画；无吸附便签时空闲自停）
  ensureFollowLoop();
  // 快捷键：Shift+L 打开便签列表
  document.addEventListener('keydown', function (e) {
    if (e.shiftKey && (e.key === 'L' || e.key === 'l') && !e.ctrlKey && !e.altKey) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      toggleQnList();
    }
  });
})();
