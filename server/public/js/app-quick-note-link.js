/* ============================================================
 * app-quick-note-link.js - 随手标题 ↔ 对话框 绑定连线
 * 功能：
 *  1. 每个随手标题多一个小圆球 🔵，按住拖到对话框（或其他随手标题）上松手，
 *     拉出一条线，即建立绑定关系（一个标题可连多个对话，也支持标题连标题）。
 *  2. 绑定关系写入对话数据（quickNoteParents = [随手标题id,...]，类似父级关系），并持久化。
 *  3. 随手标题上有 ⬇/⬆ 最小化/最大化切换按钮：最小化时所有连线的对话框收起（隐藏），
 *     标题上显示 "+N" 徽标；再点恢复显示。
 *  4. 连线为 SVG，随画布/元素移动自动跟随；绑定关系持久化（UserSettings/localStorage）。
 * 零侵入：不改动 app-quick-note.js / chatbox-00-toast.js，靠 MutationObserver 注入控件。
 * ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'zf3d_quick_links';
  var _links = [];        // [{id, noteId, targetKind:'chat'|'note', targetId, collapsed:false}]
  var _seq = 0;
  var _saveTimer = null;
  var _svg = null;
  var _drag = null;       // 拖拽连线中状态

  function hostEl() { return document.getElementById('canvasContent') || document.body; }
  function noteEl(id) { return hostEl().querySelector('.quick-note[data-qn-id="' + id + '"]'); }
  function chatEl(id) { return document.getElementById(id) || hostEl().querySelector('.chatbox[data-chat-id="' + id + '"]'); }
  function targetEl(l) { return l.targetKind === 'chat' ? chatEl(l.targetId) : noteEl(l.targetId); }

  function loadAll() {
    try {
      var raw = (window.UserSettings && UserSettings.get(LS_KEY, null)) || localStorage.getItem(LS_KEY);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (Array.isArray(raw)) _links = raw.filter(function (l) { return l && l.noteId && l.targetId; });
    } catch (e) { _links = []; }
    return _links;
  }
  function saveAll() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        var plain = _links.map(function (l) {
          return { id: l.id, noteId: l.noteId, targetKind: l.targetKind, targetId: l.targetId, collapsed: !!l.collapsed };
        });
        if (window.UserSettings) UserSettings.set(LS_KEY, plain);
        else localStorage.setItem(LS_KEY, JSON.stringify(plain));
      } catch (e) {}
    }, 300);
  }

  // 把父级关系写入对话数据（类似 parent 记录）
  function recordParents(noteId, chatId, add) {
    try {
      if (chatEl(chatId)) chatEl(chatId).dataset.qnParents = parentsOfChat(chatId).join(',');
      if (window.Store && typeof Store.saveChatBox === 'function') {
        var chats = Store.getChatBoxes ? Store.getChatBoxes() : [];
        var chat = null;
        for (var i = 0; i < chats.length; i++) { if (String(chats[i].id) === String(chatId)) { chat = chats[i]; break; } }
        if (chat) {
          var arr = Array.isArray(chat.quickNoteParents) ? chat.quickNoteParents.slice() : [];
          if (add) { if (arr.indexOf(String(noteId)) < 0) arr.push(String(noteId)); }
          else { arr = arr.filter(function (p) { return p !== String(noteId); }); }
          chat.quickNoteParents = arr;
          Store.saveChatBox(chat, true);
          // 同时写入服务器 kv_store（表结构不变也能持久化父级关系）
          if (window.DB && typeof DB.kvSet === 'function') {
            try { DB.kvSet('qn_parents_' + chatId, arr); } catch (e2) {}
          }
        }
      }
    } catch (e) {}
  }
  function parentsOfChat(chatId) {
    return _links.filter(function (l) { return l.targetKind === 'chat' && String(l.targetId) === String(chatId); })
      .map(function (l) { return l.noteId; });
  }

  // ---- SVG 连线层 ----
  function ensureSvg() {
    if (_svg && _svg.isConnected) return _svg;
    _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    _svg.className = 'qn-link-svg';
    _svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5;';
    hostEl().appendChild(_svg);
    return _svg;
  }
  function centerOf(el) {
    if (!el) return null;
    var x = parseFloat(el.style.left) || el.offsetLeft || 0;
    var y = parseFloat(el.style.top) || el.offsetTop || 0;
    return { x: x + (el.offsetWidth || 60) / 2, y: y + (el.offsetHeight || 20) / 2 };
  }
  function drawLine(x1, y1, x2, y2, color, dashed) {
    var svg = ensureSvg();
    var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
    ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
    ln.setAttribute('stroke', color || '#4fd1ff');
    ln.setAttribute('stroke-width', '2');
    if (dashed) ln.setAttribute('stroke-dasharray', '6,4');
    ln.style.filter = 'drop-shadow(0 0 3px ' + (color || '#4fd1ff') + ')';
    svg.appendChild(ln);
    return ln;
  }
  function redraw() {
    var svg = ensureSvg();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    _links.forEach(function (l) {
      var a = noteEl(l.noteId), b = targetEl(l);
      if (!a || !b) return;
      var ca = centerOf(a), cb = centerOf(b);
      if (l.collapsed) return; // 收起状态：对话框已收进标题内部，连线不显示
    });
    if (_drag) {
      var an = noteEl(_drag.noteId);
      if (an) { var c = centerOf(an); drawLine(c.x, c.y, _drag.x, _drag.y, '#ffd166', true); }
    }
    updateBadges();
  }

  // ---- 徽标（最小化时收起的数量）----
  function updateBadges() {
    _links.forEach(function (l) {
      var a = noteEl(l.noteId);
      if (!a) return;
      var badge = a.querySelector('.qn-collapse-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'qn-collapse-badge';
        badge.style.cssText = 'margin-left:4px;font-size:10px;background:#4fd1ff;color:#04121c;border-radius:8px;padding:0 5px;display:none;';
        a.querySelector('.qn-text').parentNode.appendChild(badge);
      }
      var n = _links.filter(function (x) { return x.noteId === l.noteId && x.collapsed; }).length;
      badge.textContent = '+' + n;
      badge.style.display = n > 0 ? 'inline-block' : 'none';
    });
  }

  // ---- 绑定/解绑 ----
  function bind(noteId, targetKind, targetId) {
    if (targetKind === 'note' && targetId === noteId) return; // 不能连自己
    var dup = _links.some(function (l) { return l.noteId === noteId && l.targetKind === targetKind && String(l.targetId) === String(targetId); });
    if (dup) return;
    var l = { id: 'ql' + Date.now() + '_' + (++_seq), noteId: noteId, targetKind: targetKind, targetId: String(targetId), collapsed: false };
    _links.push(l);
    if (targetKind === 'chat') recordParents(noteId, targetId, true);
    saveAll(); redraw();
  }
  function unbind(linkId) {
    var idx = _links.findIndex(function (l) { return l.id === linkId; });
    if (idx < 0) return;
    var l = _links[idx];
    if (l.targetKind === 'chat') recordParents(l.noteId, l.targetId, false);
    _links.splice(idx, 1);
    saveAll(); redraw();
  }
  window.QuickNoteLink = { bind: bind, unbind: unbind, links: function () { return _links.slice(); }, redraw: redraw };

  // ---- 最小化/最大化（级联：标题连标题时，子标题及其全部子对象一起收进父级）----
  // 收集 noteId 的整棵子树（含自身发出的所有连线目标；目标是标题则继续下钻）
  function collectSubtree(noteId, acc) {
    acc = acc || {};
    if (acc[noteId]) return acc;
    acc[noteId] = true;
    _links.forEach(function (l) {
      if (l.noteId === noteId && l.targetKind === 'note' && !acc[l.targetId]) collectSubtree(l.targetId, acc);
    });
    return acc;
  }
  function setCollapsed(noteId, collapsed) {
    var sub = collectSubtree(noteId);
    _links.forEach(function (l) {
      if (!sub[l.noteId]) return;               // 只处理该子树内发出的连线
      if (!collapsed && l.pinnedCollapsed) return; // 子标题此前被单独最小化过，父级展开时不强行打开
      l.pinnedCollapsed = !collapsed ? l.pinnedCollapsed : false;
      l.collapsed = collapsed;
      var el = targetEl(l);
      if (el) {
        if (collapsed) {
          el.dataset.qnPrevDisplay = el.style.display || '';
          el.style.display = 'none';
          el.classList.add('qn-collapsed-in');
        } else {
          el.style.display = el.dataset.qnPrevDisplay || '';
          delete el.dataset.qnPrevDisplay;
          el.classList.remove('qn-collapsed-in');
        }
      }
    });
    // 同步该子树内所有标题的切换按钮图标
    var toggle = noteEl(noteId);
    if (toggle) {
      var t = toggle.querySelector('.qn-collapse-toggle');
      if (t) t.textContent = collapsed ? '⬆' : '⬇';
    }
    saveAll(); redraw();
  }

  // ---- 拖拽小圆球拉线 ----
  function startLinkDrag(e, noteId) {
    e.preventDefault(); e.stopPropagation();
    var scale = getScale();
    _drag = { noteId: noteId, x: e.clientX, y: e.clientY };
    function toCanvas(ev) {
      var r = hostEl().getBoundingClientRect();
      return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
    }
    function onMove(ev) {
      var p = toCanvas(ev);
      _drag.x = p.x; _drag.y = p.y;
      redraw();
      // 高亮悬停目标
      document.querySelectorAll('.chatbox, .quick-note').forEach(function (el) { el.style.outline = ''; });
      var t = hitTarget(ev);
      if (t) t.el.style.outline = '2px solid #ffd166';
    }
    function hitTarget(ev) {
      var els = document.elementsFromPoint(ev.clientX, ev.clientY) || [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.classList && el.classList.contains('chatbox')) return { kind: 'chat', id: el.id, el: el };
        if (el.classList && el.classList.contains('quick-note')) {
          var id = el.dataset.qnId;
          if (id && id !== noteId) return { kind: 'note', id: id, el: el };
        }
        var box = el.closest ? el.closest('.chatbox') : null;
        if (box && box.id) return { kind: 'chat', id: box.id, el: box };
      }
      return null;
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.querySelectorAll('.chatbox, .quick-note').forEach(function (el) { el.style.outline = ''; });
      var t = hitTarget(ev);
      if (t) bind(noteId, t.kind, t.id);
      _drag = null; redraw();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function getScale() {
    try {
      var t = getComputedStyle(hostEl()).transform;
      if (t && t !== 'none') {
        var m = t.match(/matrix\(([^,]+),/);
        if (m) return Math.abs(parseFloat(m[1])) || 1;
      }
    } catch (e) {}
    return 1;
  }

  // ---- 注入控件到随手标题（小圆球 + 切换按钮）----
  function injectControls(el) {
    if (el.dataset.qnLinkInjected) return;
    el.dataset.qnLinkInjected = '1';
    var noteId = el.dataset.qnId;
    if (!noteId) return;

    var ball = document.createElement('span');
    ball.className = 'qn-link-ball';
    ball.title = '按住拖到对话框上拉线绑定（一个标题可连多个对话）';
    ball.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#9be7ff,#1e90ff);cursor:grab;margin-left:6px;box-shadow:0 0 6px #1e90ff;flex:0 0 auto;';
    ball.addEventListener('mousedown', function (e) { startLinkDrag(e, noteId); });
    ball.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    el.appendChild(ball);

    var tgl = document.createElement('span');
    tgl.className = 'qn-collapse-toggle';
    tgl.title = '最小化/最大化绑定的对话';
    tgl.textContent = '⬇';
    tgl.style.cssText = 'display:inline-block;margin-left:4px;cursor:pointer;font-size:11px;color:#4fd1ff;flex:0 0 auto;';
    tgl.addEventListener('click', function (e) {
      e.stopPropagation();
      // 单击切换：该标题子树内还有未收起的连线 → 全部级联收起；否则级联展开
      var anyOpen = _links.some(function (l) {
        if (l.noteId !== noteId) return false;
        if (l.targetKind === 'note') return true; // 子树里有下级标题，收起动作有意义
        return !l.collapsed;
      });
      setCollapsed(noteId, anyOpen);
    });
    tgl.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    tgl.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    el.appendChild(tgl);

    // 已绑定的对话右键连线可解绑：在连线上不做命中（pointer-events none），
    // 提供按住 ball 拖到标题自身以外空白 = 无操作；解绑走 API（后续可加 UI）。
  }

  // MutationObserver：随手标题出现/对话框创建时注入 & 重绘
  function startObserver() {
    var host = hostEl();
    var mo = new MutationObserver(function () {
      host.querySelectorAll('.quick-note[data-qn-id]').forEach(injectControls);
      redraw();
    });
    mo.observe(host, { childList: true, subtree: true });
  }

  // 定时重绘兜底（对话框被 Store 恢复、画布平移缩放等情况）
  setInterval(redraw, 1500);

  function init() {
    loadAll();
    startObserver();
    // 初始恢复：若绑定保存时是收起态，加载后把目标重新收起
    setTimeout(function () {
      _links.forEach(function (l) {
        if (l.collapsed) {
          var el = targetEl(l);
          if (el) { el.dataset.qnPrevDisplay = el.style.display || ''; el.style.display = 'none'; }
        }
      });
      redraw();
    }, 1200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
  } else {
    setTimeout(init, 600);
  }
})();
