/* ============================================================
 * app-quick-note-link.js - 随手标题 ↔ 对话框 连线绑定（小圆球拖拽）
 * 功能：
 *  1) 每个随手标题右侧有一个小圆球 🟡，按住拖到某个对话框上松手，
 *     即建立「标题 → 对话」连线（一个标题可连多个对话）。
 *  2) 也可拖到另一个随手标题上，建立「标题 → 标题」链接（为未来标题链做准备）。
 *  3) 标题上新增 最小化/最大化 按钮：最小化时所有连线的对话框收起（隐藏），
 *     再点恢复显示。
 *  4) 父级关系持久化：
 *     - 随手标题侧：localStorage/UserSettings 键 zf3d_qn_links
 *     - 对话框侧：写入 Store.data.chatBoxes 对应条目的 qnParentNoteId 字段
 *       （随对话持久化保存，形成 child→parent 关系）
 *  5) 双击连线可解除绑定。
 * 零侵入：不改动现有文件逻辑，只读 DOM + Store；刷新时机用轻量轮询 + 事件。
 * 加载顺序：放在 app-quick-note.js 之后。
 * ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'zf3d_qn_links';
  // links[noteId] = { chats: [chatId,...], notes: [noteId,...], minimized: bool }
  var links = {};
  var svg = null;
  var _saveTimer = null;
  var _tempPath = null;      // 拖拽中的临时连线（redraw 时不清除）
  var _lastSig = null;       // 连线拓扑签名（redraw 轻量更新用：拓扑不变时只改几何，不重建 DOM）
  var _livePaths = [];       // [{p, aEl, bEl}] 当前 SVG 里的路径与其端点元素
  var mo = null;             // MutationObserver：自有 DOM 变更期间必须断开，
                             // 否则 redraw 改动 SVG → 触发 observer → 再 redraw → 页面死循环
  function moPause() { if (mo) mo.disconnect(); }
  function moResume() { if (mo) { mo.takeRecords(); mo.observe(hostEl(), { childList: true, subtree: true }); } }

  function hostEl() { return document.getElementById('canvasContent') || document.body; }

  function loadAll() {
    try {
      var raw = (window.UserSettings && UserSettings.get(LS_KEY, null)) || localStorage.getItem(LS_KEY);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (raw && typeof raw === 'object') links = raw;
    } catch (e) { links = {}; }
  }
  function saveAll() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        if (window.UserSettings) UserSettings.set(LS_KEY, links);
        else localStorage.setItem(LS_KEY, JSON.stringify(links));
      } catch (e) {}
    }, 300);
  }

  function rec(id) { return links[id] || (links[id] = { chats: [], notes: [], minimized: false }); }

  // ---- 元素中心点 → canvasContent 本地坐标（抵消缩放） ----
  function centerOf(el) {
    var host = hostEl();
    var hr = host.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    var sc = 1;
    try {
      var t = getComputedStyle(host).transform;
      if (t && t !== 'none') {
        var m = t.match(/matrix\(([^,]+),/);
        if (m) sc = Math.abs(parseFloat(m[1])) || 1;
      }
    } catch (e) {}
    return { x: ((r.left + r.width / 2) - hr.left) / sc, y: ((r.top + r.height / 2) - hr.top) / sc };
  }

  function noteEl(id) { return hostEl().querySelector('.quick-note[data-qn-id="' + id + '"]'); }
  // 元素可见性统一判断：display:none / qn-gone / qn-hidden-by-parent / 尺寸为0 都算不可见
  // （不可见元素 getBoundingClientRect 为 0 → 连线会画到 (0,0)，必须跳过）
  function visEl(el) {
    return !!el && el.style.display !== 'none' &&
      !el.classList.contains('qn-gone') &&
      !el.classList.contains('qn-hidden-by-parent') &&
      !el.classList.contains('qn-anim-noline') &&
      !!el.offsetWidth && !!el.offsetHeight;
  }
  function chatEl(id) {
    var el = document.getElementById(id);
    return (el && el.classList && el.classList.contains('chatbox')) ? el : null;
  }

  // ---- SVG 图层 ----
  function ensureSvg() {
    if (svg && svg.parentNode) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'qnLinkLayer';
    svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:4;');
    hostEl().appendChild(svg);
    return svg;
  }

  function makePath(d, dash) {
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#e0a90f');
    p.setAttribute('stroke-width', '2');
    if (dash) p.setAttribute('stroke-dasharray', '6 4');
    p.setAttribute('pointer-events', 'stroke');
    p.style.cursor = 'pointer';
    return p;
  }

  function bez(a, b) {
    var mx = (a.x + b.x) / 2;
    return 'M' + a.x + ',' + a.y + ' C' + mx + ',' + a.y + ' ' + mx + ',' + b.y + ' ' + b.x + ',' + b.y;
  }

  // ---- 重绘所有连线 ----
  // 连线拓扑签名：链接关系变了才需要重建 DOM，否则每帧只更新几何
  function _topoSig() {
    var parts = [];
    Object.keys(links).forEach(function (nid) {
      var L = links[nid];
      (L.chats || []).forEach(function (cid) { parts.push(nid + '>' + cid); });
      (L.notes || []).forEach(function (nid2) { parts.push(nid + '+' + nid2); });
    });
    return parts.join('|');
  }

  function hasLinks() {
    return Object.keys(links).some(function (nid) {
      var L = links[nid];
      return L && ((L.chats && L.chats.length) || (L.notes && L.notes.length));
    });
  }

  // ---- 【自愈补线】拓扑相同但个别连线缺失时，按拓扑补建 ----
  // 场景：拖回画布后端点元素被重建（undock）、收起状态被展开（qn-gone 移除）等，
  // 若只走轻量重绘，被摘掉/从未建过的线永远不会回来。这里在轻量重绘末尾按
  // 拓扑逐条核对：端点当前可见但线不在的，立即补一条（含样式与双击解绑事件）。
  function _liveKey(aId, bId) { return aId + '→' + bId; }
  function _otherId(el) {
    if (!el) return '';
    return el.getAttribute('data-qn-id') || el.id || '';   // 对话框用 id，随手标题用 data-qn-id
  }
  function _liveSet() {
    var s = {};
    _livePaths.forEach(function (it) {
      if (!it || !it.p || it.p.style.display === 'none') return;   // 已隐藏/已摘除的死线不算存活，否则会挡住补线判定
      var aId = it.aEl && it.aEl.getAttribute('data-qn-id');
      if (!aId) return;
      // 优先取补线时记下的 _qnOther；全量重建的线没有该字段，从对端元素属性兜底
      var bId = it._qnOther || _otherId(it.bEl);
      if (bId) s[_liveKey(aId, bId)] = 1;
    });
    return s;
  }
  function _fillMissing(s) {
    try {
      // 先清掉死条目：线或任一端点已不在文档中的（端点被 dock 模块重建等）
      _livePaths = _livePaths.filter(function (it) {
        return it && it.p && it.p.isConnected && it.aEl && it.aEl.isConnected && it.bEl && it.bEl.isConnected;
      });
      var missing = [];
      var live = _liveSet();
      Object.keys(links).forEach(function (nid) {
        var ne = noteEl(nid);
        var L = links[nid];
        if (!ne) return;
        (L.chats || []).forEach(function (cid) {
          var ce = chatEl(cid);
          if (ce && visEl(ce) && visEl(ne) && !live[_liveKey(nid, cid)]) missing.push({ a: ne, b: ce, dash: false, aId: nid, bId: cid });
        });
        (L.notes || []).forEach(function (nid2) {
          var ne2 = noteEl(nid2);
          if (ne2 && visEl(ne2) && visEl(ne) && !live[_liveKey(nid, nid2)]) missing.push({ a: ne, b: ne2, dash: true, aId: nid, bId: nid2 });
        });
      });
      if (!missing.length) return;
      missing.forEach(function (m) {
        var p = makePath(bez(centerOf(m.a), centerOf(m.b)), m.dash);
        p.style.display = '';   // 新建即画（端点已确认可见）
        p.title = m.dash ? '双击解除标题链接' : '双击解除绑定';
        p.addEventListener('dblclick', function (e) {
          e.stopPropagation();
          if (m.dash) unbindNote(m.aId, m.bId); else unbindChat(m.aId, m.bId);
        });
        s.appendChild(p);
        p._qnOther = m.bId;   // 补线记对端 id，供下次 _liveSet 精确核对
        _livePaths.push({ p: p, aEl: m.a, bEl: m.b, _qnOther: m.bId });
      });
      moPause();   // 增删了 SVG 子节点，暂停 observer 防自我触发（redraw 的 finally 会 moResume）
    } catch (e) {}
  }

  function redraw() {
    moPause();   // 本函数会增删 SVG 子节点，必须断开 observer，否则自我触发死循环
    try {
      var s = ensureSvg();
      var sig = _topoSig();
      // 【性能】拓扑未变（拖拽移动/平移画布的逐帧重绘）→ 只更新既有路径几何，
      // 不做 removeChild/appendChild（那是 50ms/帧 卡顿与 forced reflow 的来源）
      if (sig === _lastSig && _livePaths.length) {
        for (var _i = _livePaths.length - 1; _i >= 0; _i--) {
          var it = _livePaths[_i];
          // 端点元素已被移除（对话关闭/标题删除）→ 立即摘线，避免残留悬空旧线
          if (!it.p.isConnected || !it.aEl || !it.bEl || !it.aEl.isConnected || !it.bEl.isConnected) {
            if (it.p.parentNode) it.p.parentNode.removeChild(it.p);
            _livePaths.splice(_i, 1);
            continue;
          }
          var hide = !visEl(it.bEl) || !visEl(it.aEl);   // 任一端不可见（最小化/级联收起）都藏线，避免连到 (0,0)
          it.p.style.display = hide ? 'none' : '';
          if (!hide) it.p.setAttribute('d', bez(centerOf(it.aEl), centerOf(it.bEl)));
        }
        _fillMissing(s);   // 【自愈】端点恢复可见（如收起对话被展开/标题元素被重建）但线已被摘的，当场补建
        return;
      }
      Array.prototype.slice.call(s.childNodes).forEach(function (n) {
        if (n !== _tempPath) s.removeChild(n);   // 拖拽中的临时连线保留
      });
      _livePaths = [];
      Object.keys(links).forEach(function (nid) {
        var L = links[nid];
        var ne = noteEl(nid);
        if (!ne) return;
        var a = centerOf(ne);
        (L.chats || []).forEach(function (cid) {
          var ce = chatEl(cid);
          // 已收进随手标题（最小化/隐藏/尺寸为0）的对话不画线，避免连到 (0,0)
          if (!visEl(ce)) return;
          var p = makePath(bez(a, centerOf(ce)), false);
          p.title = '双击解除绑定';
          p.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            unbindChat(nid, cid);
          });
          s.appendChild(p);
          _livePaths.push({ p: p, aEl: ne, bEl: ce, _qnOther: cid });
        });
        (L.notes || []).forEach(function (nid2) {
          var ne2 = noteEl(nid2);
          if (!visEl(ne2)) return;   // 子标题被级联收起（display:none）时不画线，避免连到 (0,0)
          var p = makePath(bez(a, centerOf(ne2)), true);
          p.title = '双击解除标题链接';
          p.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            unbindNote(nid, nid2);
          });
          s.appendChild(p);
          _livePaths.push({ p: p, aEl: ne, bEl: ne2, _qnOther: nid2 });
        });
      });
      _lastSig = sig;
    } finally {
      moResume();
    }
  }

  // ---- 父级关系写入对话数据 ----
  function markChatParent(chatId, noteId) {
    try {
      var el = chatEl(chatId);
      if (el) el.dataset.qnParentId = noteId;
      if (window.Store && Store.data && Array.isArray(Store.data.chatBoxes)) {
        var entry = Store.data.chatBoxes.find(function (c) { return c.id === chatId; });
        if (entry) {
          if (noteId) entry.qnParentNoteId = noteId;
          else delete entry.qnParentNoteId;
          if (typeof Store.save === 'function') { try { Store.save(); } catch (e) {} }
        }
      }
    } catch (e) {}
  }

  // ---- 绑定/解绑 ----
  function bindChat(noteId, chatId) {
    var L = rec(noteId);
    if (L.chats.indexOf(chatId) < 0) {
      L.chats.push(chatId);
      markChatParent(chatId, noteId);
      try { window.dispatchEvent(new CustomEvent('zf-sfx', { detail: { name: 'link' } })); } catch (e) {}
      saveAll(); redraw();
      applyMinimized(noteId);
    }
  }
  function unbindChat(noteId, chatId) {
    var L = links[noteId]; if (!L) return;
    var i = L.chats.indexOf(chatId);
    if (i >= 0) { L.chats.splice(i, 1); markChatParent(chatId, null); saveAll(); redraw(); }
  }
  // 按对话ID在所有标题记录中移除绑定（对话被关闭时调用）
  // 背景：对话 id 为 cb+编号，关闭后编号可能被新对话复用，
  // 残留绑定会让新对话"自动关联"到旧标题，必须在关闭时彻底清理。
  function unbindChatEverywhere(chatId) {
    var changed = false;
    Object.keys(links).forEach(function (nid) {
      var L = links[nid];
      if (L && L.chats && L.chats.indexOf(chatId) >= 0) {
        L.chats.splice(L.chats.indexOf(chatId), 1);
        changed = true;
      }
    });
    if (changed) { markChatParent(chatId, null); saveAll(); redraw(); }
    return changed;
  }
  function bindNote(noteId, otherNoteId) {
    if (noteId === otherNoteId) return;
    var L = rec(noteId);
    if (L.notes.indexOf(otherNoteId) < 0) { L.notes.push(otherNoteId); try { window.dispatchEvent(new CustomEvent('zf-sfx', { detail: { name: 'link' } })); } catch (e) {} saveAll(); redraw(); }
  }
  function unbindNote(noteId, otherNoteId) {
    var L = links[noteId]; if (!L) return;
    var i = L.notes.indexOf(otherNoteId);
    if (i >= 0) { L.notes.splice(i, 1); saveAll(); redraw(); }
  }

  // ---- 最小化/最大化 ----
  // 递归收集 noteId 的所有「后代」：直接连线对话 + 连线标题及其后代（标题链级联收纳）
  function collectDescendants(noteId, visited) {
    visited = visited || {};
    if (visited[noteId]) return { chats: [], notes: [] };
    visited[noteId] = true;
    var L = links[noteId];
    var chats = (L && L.chats) ? L.chats.slice() : [];
    var notes = [];
    if (L && L.notes) {
      L.notes.forEach(function (nid) {
        var sub = collectDescendants(nid, visited);
        sub.chats.forEach(function (c) { if (chats.indexOf(c) < 0) chats.push(c); });
        notes.push(nid);
        sub.notes.forEach(function (n) { if (notes.indexOf(n) < 0) notes.push(n); });
      });
    }
    return { chats: chats, notes: notes };
  }

  // 吸入/弹出动画：把对话框平移缩放到随手标题位置，动画结束后再隐藏
  // （直接 display:none 会导致 MutationObserver/redraw 先画到 (0,0)）
  // 每个元素带动画序号 _qnAnimId：新一轮动画会使旧动画的定时回调失效，
  // 避免快速反复点最小化/还原时旧回调交错覆盖 transform，导致位置错乱无法还原
  function animToken(ce) { var n = (ce._qnAnimId || 0) + 1; ce._qnAnimId = n; return n; }
  function animValid(ce, tok) { return ce._qnAnimId === tok; }

  function animateAbsorb(ce, ne, hiding, done) {
    if (!ce) { done && done(); return; }
    animToken(ce);   // 立即作废该元素上还在飞行的旧动画回调
    if (!ne || !ne.offsetWidth) {   // 无法定位标题，直接处理
      ce.classList.toggle('qn-gone', !!hiding);
      done && done();
      return;
    }
    var tr = ce.style.transition;
    var tf = ce.style.transform;
    var tok = ce._qnAnimId;
    if (hiding) {
      var n = centerOf(ne), c = centerOf(ce);
      var dx = n.x - c.x, dy = n.y - c.y;
      ce.classList.remove('qn-gone');
      var hidingT = 0.05, hidingD = 60;
      ce.style.transition = 'none';
      ce.style.transform = 'translate(0,0) scale(1)';
      void ce.offsetWidth;
      ce.style.transition = 'transform ' + hidingT + 's ease-in, opacity ' + hidingT + 's ease-in';
      ce.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.05)';
      ce.style.opacity = '0';
      // 动画期间持续重绘连线，让线跟着对话框一起收
      var t0 = performance.now();
      (function flyDraw() {
        if (!animValid(ce, tok)) return;
        redraw();
        if (performance.now() - t0 < hidingD) requestAnimationFrame(flyDraw);
      })();
      setTimeout(function () {
        if (!animValid(ce, tok)) return;   // 已被新一轮动画接管，丢弃
        ce.classList.add('qn-gone');
        ce.style.transition = tr || '';
        ce.style.transform = tf || '';
        ce.style.opacity = '';
        redraw();
        done && done();
      }, hidingD + 10);
    } else {
      // 弹出（还原）：动画期间先隐藏连线（此刻端点中心点尚未就位，重绘会画错位置）
      var tok2 = animToken(ce);
      ce.classList.add('qn-anim-noline');
      var dx2, dy2;
      // 若元素仍在隐藏态，getBoundingClientRect 为 0 → 不能用它算位移。
      // 改用布局数据（offsetLeft/offsetTop）计算标题与对话框中心差，不受 display 影响。
      if (!ce.offsetWidth || !ce.offsetHeight) {
        dx2 = (ne.offsetLeft + ne.offsetWidth / 2) - (ce.offsetLeft + ce.offsetWidth / 2);
        dy2 = (ne.offsetTop + ne.offsetHeight / 2) - (ce.offsetTop + ce.offsetHeight / 2);
      } else {
        var n2 = centerOf(ne), c2 = centerOf(ce);
        dx2 = n2.x - c2.x; dy2 = n2.y - c2.y;
      }
      // 关键：必须先脱离 display:none，动画/还原才有效
      ce.classList.remove('qn-gone');
      ce.style.transition = 'none';
      ce.style.transform = 'translate(' + dx2 + 'px,' + dy2 + 'px) scale(0.05)';
      ce.style.opacity = '0';
      // 强制 reflow 后回到原位
      void ce.offsetWidth;
      var popT = 0.05, popD = 60;
      ce.style.transition = 'transform ' + popT + 's ease-out, opacity ' + popT + 's ease-out';
      ce.style.transform = '';
      ce.style.opacity = '1';
      // 弹出结束后恢复连线绘制
      setTimeout(function () {
        if (!animValid(ce, tok2)) return;
        ce.classList.remove('qn-anim-noline');
        redraw();
      }, popD + 10);
      done && done();
    }
  }

  function absorbChat(ce, ne, hiding) {
    animateAbsorb(ce, ne, hiding, null);
  }

  function applyMinimized(noteId, animate) {
    var L = links[noteId]; if (!L) return;
    var desc = collectDescendants(noteId);
    // 直连对话：收进随手标题（先平移缩放吸入标题，动画结束后 display:none 隐藏）
    (desc.chats || []).forEach(function (cid) {
      var ce = chatEl(cid);
      if (!ce) return;
      var wasMini = ce.classList.contains('qn-gone');
      var nowMini = !!L.minimized;
      if (nowMini) {
        ce.classList.remove('qn-mini');
        if (wasMini) return;   // 已是隐藏态
        animateAbsorb(ce, noteEl(noteId), true, redraw);
      } else {
        if (wasMini && animate !== false) {
          animateAbsorb(ce, noteEl(noteId), false, redraw);
        } else {
          ce.classList.remove('qn-gone');
        }
      }
    });
    // 连线的子标题：父最小化时整条标题链也隐身
    (desc.notes || []).forEach(function (nid) {
      var ne2 = noteEl(nid);
      if (ne2) ne2.classList.toggle('qn-hidden-by-parent', !!L.minimized);
    });
    var ne = noteEl(noteId);
    if (ne) {
      var btn = ne.querySelector('.qn-fold');
      if (btn) { btn.textContent = L.minimized ? '▸' : '▾'; btn.classList.toggle('is-min', !!L.minimized); btn.title = L.minimized ? '展开连线对话' : '收起连线对话'; }
    }
    redraw();
  }
  function toggleMinimized(noteId) {
    var L = rec(noteId);
    L.minimized = !L.minimized;
    saveAll();
    applyMinimized(noteId, true);
  }

  // ---- 联动移动：拖动随手标题时，连线对话框保持相对位置跟随 ----
  // beginFollow 在拖动开始时快照各连线对话相对标题的偏移；
  // applyFollow 在标题位置更新后按快照平移对话框；endFollow 在松手时持久化。
  function beginFollow(noteId) {
    var ne = noteEl(noteId);
    if (!ne) return null;
    var snap = { noteId: noteId, chats: [] };
    var L = links[noteId];
    ((L && L.chats) || []).forEach(function (cid) {
      var ce = chatEl(cid);
      if (!ce || ce.style.display === 'none' || ce.classList.contains('qn-gone')) return;
      snap.chats.push({ id: cid, el: ce, dx: ce.offsetLeft - ne.offsetLeft, dy: ce.offsetTop - ne.offsetTop });
    });
    return snap.chats.length ? snap : null;
  }
  function applyFollow(snap, noteLeft, noteTop) {
    if (!snap) return;
    snap.chats.forEach(function (c) {
      if (!c.el || !c.el.isConnected) return;
      c.el.style.left = (noteLeft + c.dx) + 'px';
      c.el.style.top = (noteTop + c.dy) + 'px';
    });
  }
  function endFollow(snap) {
    if (!snap) return;
    snap.chats.forEach(function (c) {
      try {
        var chatObj = null;
        if (window.App && Array.isArray(App.chatBoxes)) {
          chatObj = App.chatBoxes.filter(function (x) { return x && x.id === c.id; })[0] || null;
        }
        if (chatObj) {
          chatObj.x = c.el.offsetLeft; chatObj.y = c.el.offsetTop;
          if (typeof Store !== 'undefined' && Store.saveChatBox) Store.saveChatBox(chatObj);
        } else if (window.Store && Store.data && Array.isArray(Store.data.chatBoxes)) {
          var entry = Store.data.chatBoxes.find(function (x) { return x.id === c.id; });
          if (entry) { entry.x = c.el.offsetLeft; entry.y = c.el.offsetTop; if (typeof Store.save === 'function') Store.save(); }
        }
      } catch (e) {}
    });
    try { if (window.ChatMgr && typeof ChatMgr.updateMinimap === 'function') ChatMgr.updateMinimap(); } catch (e) {}
    redraw();
  }

  // ---- 给随手标题注入小圆球 + 折叠按钮 ----
  function injectControls(ne, noteId) {
    if (ne.querySelector('.qn-ball')) return;
    var fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'qn-fold';
    fold.title = '收起/展开连线对话';
    fold.textContent = (links[noteId] && links[noteId].minimized) ? '▸' : '▾';
    fold.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    fold.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    fold.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMinimized(noteId);
    });
    // 顺序：小圆球 | 大头针 | 最小化 | 关闭按钮（最右）
    var delBtn = ne.querySelector('.qn-del');
    if (delBtn) ne.insertBefore(fold, delBtn); else ne.appendChild(fold);

    var ball = document.createElement('span');
    ball.className = 'qn-ball';
    ball.title = '拖到我上面的对话框/标题，建立连线';
    ball.addEventListener('mousedown', function (e) { startLinkDrag(e, noteId); });
    ne.insertBefore(ball, ne.firstChild);

    applyMinimized(noteId);
  }

  // ---- 拖球连线 ----
  function startLinkDrag(e, noteId) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    var host = hostEl();
    var s = ensureSvg();
    var ne = noteEl(noteId);
    if (!ne) return;
    var a = centerOf(ne);
    var temp = makePath('', false);
    temp.setAttribute('stroke', '#f5b400');
    temp.setAttribute('stroke-width', '2.5');
    s.appendChild(temp);
    _tempPath = temp;   // redraw 重绘时保留拖拽临时线
    try { window.__zfSfx && window.__zfSfx.play('tick'); } catch (e2) {}
    var hoverTarget = null;
    var _hoverSfxAt = 0;

    function toLocal(ev) {
      var hr = host.getBoundingClientRect();
      var sc = 1;
      try {
        var t = getComputedStyle(host).transform;
        if (t && t !== 'none') { var m = t.match(/matrix\(([^,]+),/); if (m) sc = Math.abs(parseFloat(m[1])) || 1; }
      } catch (er) {}
      return { x: (ev.clientX - hr.left) / sc, y: (ev.clientY - hr.top) / sc };
    }
    function findTarget(ev) {
      var els = document.elementsFromPoint(ev.clientX, ev.clientY);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var cb = el.closest && el.closest('.chatbox');
        if (cb && cb.id) return { type: 'chat', id: cb.id };
        var qn = el.closest && el.closest('.quick-note');
        if (qn && qn.dataset.qnId && qn.dataset.qnId !== noteId) return { type: 'note', id: qn.dataset.qnId };
      }
      return null;
    }
    function onMove(ev) {
      var b = toLocal(ev);
      temp.setAttribute('d', bez(a, b));
      var t = findTarget(ev);
      if (hoverTarget && hoverTarget !== t) {
        var pe = hoverTarget.type === 'chat' ? chatEl(hoverTarget.id) : noteEl(hoverTarget.id);
        if (pe) pe.classList.remove('qn-link-hover');
      }
      hoverTarget = t;
      if (t) {
        var te = t.type === 'chat' ? chatEl(t.id) : noteEl(t.id);
        if (te) te.classList.add('qn-link-hover');
        // 悬停到目标时来一声轻提示（节流 200ms）
        var _now = Date.now();
        if (_now - _hoverSfxAt > 200) { _hoverSfxAt = _now; try { window.__zfSfx && window.__zfSfx.play('drop'); } catch (e3) {} }
      }
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _tempPath = null;
      temp.remove();
      var t = findTarget(ev);
      if (hoverTarget) {
        var pe = hoverTarget.type === 'chat' ? chatEl(hoverTarget.id) : noteEl(hoverTarget.id);
        if (pe) pe.classList.remove('qn-link-hover');
      }
      if (!t) return;
      if (t.type === 'chat') bindChat(noteId, t.id);
      else bindNote(noteId, t.id);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ---- 扫描所有随手标题，注入控件 ----
  function scan() {
    moPause();   // injectControls 会插入 DOM，避免触发 observer 自循环
    try {
      hostEl().querySelectorAll('.quick-note[data-qn-id]').forEach(function (ne) {
        injectControls(ne, ne.dataset.qnId);
      });
      // 级联：若某个标题的任一祖先处于最小化，则该标题及其连线对话也要收起
      // 【孤儿绑定清扫】对话 id 为 cb+编号会复用：绑定表中已不存在于 Store.data.chatBoxes
      // 的对话 id 必须剔除，否则新建对话复用该编号时会被旧标题"自动关联"。
      // （单边清理，不在 scan 每 400ms 全量触发 saveAll，仅在有变化时保存）
      Object.keys(links).forEach(function (nid) {
        var L = links[nid];
        if (!L || !L.chats || !L.chats.length) return;
        var before = L.chats.length;
        try {
          var live = (window.Store && Store.data && Array.isArray(Store.data.chatBoxes)) ? Store.data.chatBoxes : null;
          if (live) {
            L.chats = L.chats.filter(function (cid) {
              return live.some(function (b) { return b.id === cid; });
            });
          } else {
            // Store 未就绪时兜底：DOM 里不存在的对话也视为已关闭
            L.chats = L.chats.filter(function (cid) { return !!chatEl(cid); });
          }
        } catch (e) { return; }
        if (L.chats.length !== before) {
          saveAll();
          (function () { try { redraw(); } catch (e2) {} })();
        }
      });
      Object.keys(links).forEach(function (nid) {
        if (links[nid] && links[nid].minimized) applyMinimized(nid);
      });
    } finally {
      moResume();
    }
  }

  // ---- 拖拽期间 rAF 实时重绘（平移对话框时线不卡顿）----
  var _rafActive = false;
  function rafLoop() {
    if (!_rafActive) return;
    redraw();
    requestAnimationFrame(rafLoop);
  }
  function startRaf() {
    if (_rafActive) return;
    _rafActive = true;
    requestAnimationFrame(rafLoop);
  }
  function stopRaf() { _rafActive = false; }

  // ---- 移动随手标题时，绑定的对话/子标题跟随移动（连线绑定即父子关系） ----
  var _follow = null;   // {noteId, noteEl, startLeft, startTop, items:[{el, x, y, chatId?, noteId?}]}

  function findChatEntry(chatId) {
    try {
      if (window.Store && Store.data && Array.isArray(Store.data.chatBoxes))
        return Store.data.chatBoxes.find(function (c) { return c.id === chatId; });
    } catch (e) {}
    return null;
  }

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var ne = e.target.closest ? e.target.closest('.quick-note[data-qn-id]') : null;
    if (!ne || !hostEl().contains(ne)) return;
    if (e.target.closest('.qn-ball') || e.target.closest('.qn-fold') || e.target.closest('input') || e.target.closest('button')) return;
    var noteId = ne.dataset.qnId;
    if (!links[noteId]) return;                       // 无绑定的标题不启动跟随
    var desc = collectDescendants(noteId);
    var items = [];
    (desc.chats || []).forEach(function (cid) {
      var ce = chatEl(cid);
      if (ce && !ce.classList.contains('qn-gone') && ce.style.display !== 'none')
        items.push({ el: ce, x: ce.offsetLeft, y: ce.offsetTop, chatId: cid });
    });
    (desc.notes || []).forEach(function (nid) {
      var ne2 = noteEl(nid);
      if (ne2) items.push({ el: ne2, x: ne2.offsetLeft, y: ne2.offsetTop, noteId: nid });
    });
    if (!items.length) return;
    _follow = {
      noteId: noteId, noteEl: ne, items: items,
      startLeft: parseFloat(ne.style.left) || ne.offsetLeft || 0,
      startTop: parseFloat(ne.style.top) || ne.offsetTop || 0,
      moved: false
    };
  });

  document.addEventListener('mousemove', function (e) {
    if (!_follow || !e.buttons) return;
    var ne = _follow.noteEl;
    if (!ne || !document.body.contains(ne)) { _follow = null; return; }
    var curLeft = parseFloat(ne.style.left) || ne.offsetLeft || 0;
    var curTop = parseFloat(ne.style.top) || ne.offsetTop || 0;
    var dx = curLeft - _follow.startLeft, dy = curTop - _follow.startTop;
    if (!dx && !dy) return;
    _follow.moved = true;
    _follow.items.forEach(function (it) {
      it.el.style.left = (it.x + dx) + 'px';
      it.el.style.top = (it.y + dy) + 'px';
    });
    if (window.App && App._updateAllNavArrows) { try { App._updateAllNavArrows(); } catch (e2) {} }
    startRaf();   // 连线实时跟随
  });

  document.addEventListener('mouseup', function () {
    if (!_follow) return;
    var f = _follow; _follow = null;
    if (!f.moved) return;
    // 持久化：对话位置写回 Store，子标题跟随即可（其自身拖拽逻辑会另行保存）
    f.items.forEach(function (it) {
      if (it.chatId) {
        var entry = findChatEntry(it.chatId);
        if (entry) {
          entry.x = it.el.offsetLeft;
          entry.y = it.el.offsetTop;
          try { Store.saveChatBox(entry); } catch (e) {}
        }
      }
    });
    if (window.App && App.updateMinimap) { try { App.updateMinimap(); } catch (e) {} }
    redraw();
  });

  // ---- 启动 ----
  function boot() {
    loadAll();
    ensureSvg();
    scan();
    redraw();
    // 轻量轮询：新标题注入控件
    setInterval(scan, 400);
    // 按下鼠标期间实时重绘（拖对话框/拖球连线时线条跟手）
    document.addEventListener('mousedown', function (e) {
      // 只在画布内容区域内且有连线数据时启动（无连线时逐帧重绘纯属浪费）
      if (hasLinks() && hostEl().contains(e.target)) { startRaf(); }
    }, true);
    document.addEventListener('mousemove', function (e) {
      if (!_rafActive && hasLinks() && hostEl().contains(e.target)) {
        // 防漏：万一 mousedown 被拦截，移动时兜底开启
        if (e.buttons) startRaf();
      }
    });
    document.addEventListener('mouseup', function () {
      stopRaf();
      redraw();
    });
    window.addEventListener('resize', redraw);
    // 标题被撤销/重做等方式增删时，及时重绘+级联收纳
    // （redraw/scan 内部已自行 pause/resume，observer 不会因自有变更而自触发）
    mo = new MutationObserver(function () { redraw(); scanSoon(); });
    mo.observe(hostEl(), { childList: true, subtree: true });
  }
  var _scanTimer = null;
  function scanSoon() {
    if (_scanTimer) return;
    _scanTimer = setTimeout(function () { _scanTimer = null; scan(); }, 300);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  } else {
    setTimeout(boot, 600);
  }

  // ---- 导出 API ----
  window.QuickNoteLinks = {
    bindChat: bindChat,
    unbindChat: unbindChat,
    unbindChatEverywhere: unbindChatEverywhere,
    bindNote: bindNote,
    unbindNote: unbindNote,
    toggleMinimized: toggleMinimized,
    redraw: redraw,
    beginFollow: beginFollow,
    applyFollow: applyFollow,
    endFollow: endFollow,
    all: function () { return JSON.parse(JSON.stringify(links)); },
    // 【修复】强制下次 redraw 全量重建连线：标题端点元素被 dock 模块重建后，
    // 拓扑数据未变（签名相同），轻量路径会把旧线摘掉且永不重画（拖回画布展开后连线消失）
    invalidate: function () { _lastSig = null; }
  };
})();
