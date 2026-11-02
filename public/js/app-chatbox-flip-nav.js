/* ============================================================
 * app-chatbox-flip-nav.js - 焦点对话左右翻页按钮（事件驱动重写版）
 * 性能要点：
 *  1. 不再用 setInterval 轮询，也不监听 body 级 MutationObserver
 *     （旧版 160ms 主要来自：5000ms 轮询全量回流 + 读写交错强制 reflow）；
 *  2. 挂钩 App.activate / App._focusChatBox / App._updateAllNavArrows，
 *     只在焦点真正切换时更新一次；
 *  3. 几何读取（offsetLeft）一次性批量读完，再统一写样式，
 *     杜绝"写 display → 读 offsetLeft"交错造成的强制回流；
 *  4. 兜底：focusin 捕获阶段监听 .chatbox 获焦（被动事件，零回流）。
 * ============================================================ */
(function () {
  'use strict';

  function chatList() {
    return (window.App && App.chatBoxes) || [];
  }
  function findChatById(id) {
    var arr = chatList();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && String(arr[i].id) === String(id)) return arr[i];
    }
    return null;
  }

  // ===== 父子关系判定：子对话框（策划师/审核员/施工队/协作队/总结师等系统角色窗）
  // 不参与左右翻页——翻页只在主（父）对话框之间进行。与 chatbox-spawn-habit.js
  // 的 ROLE_WHITELIST 保持一致。 =====
  var CHILD_ROLE_WHITELIST = ['策划师', '审核员', '施工队', '协作队', '总结师', '质检员', '技术可行性', '收口'];

  function isChildChat(chat) {
    var box = chat && chat.el;
    if (!box) return false;
    var name = '';
    try {
      // 1) 显式角色标记
      var rname = box.getAttribute && box.getAttribute('data-role-name');
      if (rname) name = rname;
      if (!name) {
        var rid = box.getAttribute && box.getAttribute('data-role-id');
        if (rid) {
          var boxId = (box.dataset && box.dataset.boxId) || box.id;
          var stored = JSON.parse(localStorage.getItem('zf_role_chat_' + boxId) || 'null');
          if (stored && stored.name) name = stored.name;
        }
      }
      // 2) 标题栏匹配
      if (!name) {
        var t = box.querySelector && box.querySelector('.chat-title, .chatbox-title, [class*="title"]');
        if (t && t.textContent) name = t.textContent.trim();
      }
    } catch (e) {}
    if (!name) return false;
    for (var i = 0; i < CHILD_ROLE_WHITELIST.length; i++) {
      if (name.indexOf(CHILD_ROLE_WHITELIST[i]) !== -1) return true;
    }
    return false;
  }

  function makeBtn(dir) {
    var b = document.createElement('div');
    b.className = 'flip-nav-btn flip-nav-' + (dir < 0 ? 'prev' : 'next');
    b.textContent = dir < 0 ? '‹' : '›';
    b.title = dir < 0 ? '翻到左边最近对话' : '翻到右边最近对话';
    b.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    b.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      var box = b.parentNode; // .chatbox
      var chat = findChatById(box.id);
      var target = null;
      // 焦点框是子对话框（策划师/审核员等）时不翻页，直接跳到最近的父对话框
      if (chat && isChildChat(chat)) {
        // 焦点是子窗：忽略方向，跳到物理位置最近的主（父）对话框
        var bestC = null, bestD = Infinity;
        chatList().forEach(function (c) {
          if (!c || !c.el || c === chat || isChildChat(c)) return;
          var d = Math.abs(c.el.offsetLeft - chat.el.offsetLeft);
          if (d < bestD) { bestD = d; bestC = c; }
        });
        target = bestC;
      } else if (chat) {
        target = neighborOf(chat, dir);
      }
      if (!target || !target.el) return;
      if (window.App && typeof App._focusChatBox === 'function') {
        try { App._focusChatBox(target); return; } catch (e2) {}
      }
      var area = document.getElementById('canvasArea');
      if (area && window.App && App.canvasSetView) {
        var sc = App.canvasScale ? App.canvasScale() : 1;
        var cx = target.el.offsetLeft + target.el.offsetWidth / 2;
        var cy = target.el.offsetTop + target.el.offsetHeight / 2;
        App.canvasSetView(area.clientWidth / 2 - cx * sc, area.clientHeight / 2 - cy * sc, sc, true);
      }
      if (window.App && typeof App.activate === 'function') App.activate(target.el);
    });
    return b;
  }

  // 找最近邻：优先 App API（过滤子对话框后），降级按缓存的 offsetLeft（不额外触发回流）
  function neighborOf(chat, dir, lefts) {
    if (window.App && typeof App._findNeighborChat === 'function') {
      var cand = null, dist = Infinity, cx0 = chat.el.offsetLeft;
      chatList().forEach(function (c) {
        if (!c || !c.el || c === chat || isChildChat(c)) return;
        var d = c.el.offsetLeft - cx0;
        if (dir < 0 && d < 0 && -d < dist) { dist = -d; cand = c; }
        if (dir > 0 && d > 0 && d < dist) { dist = d; cand = c; }
      });
      return cand;
    }
    if (!lefts) lefts = snapshotLefts();
    var best = null, bestDist = Infinity;
    var cx = lefts.has(chat.el) ? lefts.get(chat.el) : chat.el.offsetLeft;
    chatList().forEach(function (c) {
      if (!c || !c.el || c === chat || isChildChat(c)) return;
      var d = (lefts.has(c.el) ? lefts.get(c.el) : c.el.offsetLeft) - cx;
      if (dir < 0 && d < 0 && -d < bestDist) { bestDist = -d; best = c; }
      if (dir > 0 && d > 0 && d < bestDist) { bestDist = d; best = c; }
    });
    return best;
  }

  // 批量读取所有 chatbox 的 offsetLeft（一次回流），返回 Map
  function snapshotLefts() {
    var m = new Map();
    chatList().forEach(function (c) {
      if (c && c.el) m.set(c.el, c.el.offsetLeft);
    });
    return m;
  }

  function countSides(chat, lefts) {
    var l = 0, r = 0, cx = lefts.get(chat.el);
    chatList().forEach(function (c) {
      if (!c || !c.el || c === chat || isChildChat(c)) return;
      var x = lefts.has(c.el) ? lefts.get(c.el) : c.el.offsetLeft;
      if (x < cx) l++; else r++;
    });
    return { left: l, right: r };
  }

  var _lastFocus = null;

  function updateAll() {
    // 1) 批量读几何（一次回流）
    var lefts = snapshotLefts();
    // 2) 收集所有写操作，读完再统一写（零交错回流）
    var ops = [];
    // 清理上一个焦点框的按钮
    var prevBox = _lastFocus;
    if (prevBox && !prevBox.isConnected) prevBox = null;
    var boxes = document.querySelectorAll('.chatbox.active');
    var newFocus = boxes[0] || null;
    if (prevBox && prevBox !== newFocus) {
      ops.push(function () {
        var p = prevBox.querySelector(':scope > .flip-nav-prev');
        var n = prevBox.querySelector(':scope > .flip-nav-next');
        if (p) p.remove();
        if (n) n.remove();
      });
    }
    if (newFocus) {
      var box = newFocus;
      var chat = findChatById(box.id);
      if (chat && chat.el) {
        var prev = box.querySelector(':scope > .flip-nav-prev');
        var next = box.querySelector(':scope > .flip-nav-next');
        var needMake = !prev || !next;
        var sides = needMake ? countSides(chat, lefts) : null;
        ops.push(function () {
          if (!prev) { prev = makeBtn(-1); box.appendChild(prev); }
          if (!next) { next = makeBtn(1); box.appendChild(next); }
          var s = sides || countSides(chat, lefts);

          prev.style.display = s.left > 0 ? '' : 'none';
          next.style.display = s.right > 0 ? '' : 'none';
        });
      }
    }
    _lastFocus = newFocus;
    // 3) 统一执行写
    for (var i = 0; i < ops.length; i++) { try { ops[i](); } catch (e) {} }
  }

  // rAF 去抖 + 300ms 时间节流：同一帧多次触发只算一次，
  // 且高频钩子（流式输出期间 _updateAllNavArrows 每秒 3~4 次）下
  // 限频执行——updateAll 对全量 chatbox 读 offsetLeft 会强制回流，
  // 不加时间节流时会把主线程压垮（FPS 掉到个位数）。
  var _raf = 0, _lastRun = 0;
  function schedule() {
    if (_raf) return;
    var now = Date.now();
    if (now - _lastRun < 300) {
      _raf = setTimeout(function () { _raf = 0; schedule(); }, 300 - (now - _lastRun));
      return;
    }
    _raf = requestAnimationFrame(function () {
      _raf = 0;
      _lastRun = Date.now();
      updateAll();
    });
  }

  // ---- 事件驱动挂钩 ----
  function hook(obj, name) {
    if (!obj || typeof obj[name] !== 'function' || obj['__flipHook_' + name]) return;
    var orig = obj[name];
    obj['__flipHook_' + name] = true;
    obj[name] = function () { var r = orig.apply(this, arguments); schedule(); return r; };
  }
  hook(window.App, 'activate');
  hook(window.App, '_focusChatBox');
  hook(window.App, '_updateAllNavArrows');

  // App 可能晚于本脚本加载：轮询等它出现（仅属性检查，无回流），挂上即停
  var _tries = 0;
  var _t = setInterval(function () {
    if (window.App) {
      hook(window.App, 'activate');
      hook(window.App, '_focusChatBox');
      hook(window.App, '_updateAllNavArrows');
      clearInterval(_t);
      schedule();
    } else if (++_tries > 100) clearInterval(_t);
  }, 100);

  // 兜底：焦点框获焦（focusin 不产生额外回流，捕获阶段）
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.closest && e.target.closest('.chatbox')) schedule();
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
