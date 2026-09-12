/* ============================================================
 * app-chatbox-flip-nav.js - 焦点对话左右翻页按钮
 * 功能：
 *  1. 只有当前"有焦点"的对话（.chatbox.active）两侧才出现 ‹ › 翻页按钮；
 *  2. 点击 ‹ 跳到左边最近的一个对话，点击 › 跳到右边最近的一个对话，
 *     摄像机把目标对话移到画布中央（复用 App._focusChatBox）并激活；
 *  3. 侧边没有其他对话时对应按钮自动隐藏；
 *  4. 零侵入：不改 chatbox-00/01/03，靠 MutationObserver 监听 .active 变化注入。
 * ============================================================ */
(function () {
  'use strict';

  var PENDING = false;

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

  // 侧边按钮数量：优先用 App._countNeighbors / _findNeighborChat（物理坐标，带降级）
  function neighborOf(chat, dir) {
    if (window.App && typeof App._findNeighborChat === 'function') {
      try { return App._findNeighborChat(chat, dir); } catch (e) {}
    }
    // 降级：自己按 offsetLeft 找最近邻
    var best = null, bestDist = Infinity;
    var cx = chat.el.offsetLeft;
    chatList().forEach(function (c) {
      if (!c || !c.el || c === chat) return;
      var d = c.el.offsetLeft - cx;
      if (dir < 0 && d < 0 && -d < bestDist) { bestDist = -d; best = c; }
      if (dir > 0 && d > 0 && d < bestDist) { bestDist = d; best = c; }
    });
    return best;
  }
  function countSides(chat) {
    if (window.App && typeof App._countNeighbors === 'function') {
      try { return App._countNeighbors(chat); } catch (e) {}
    }
    var l = 0, r = 0, cx = chat.el.offsetLeft;
    chatList().forEach(function (c) {
      if (!c || !c.el || c === chat) return;
      if (c.el.offsetLeft < cx) l++; else r++;
    });
    return { left: l, right: r };
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
      if (!chat || !chat.el) return;
      var target = neighborOf(chat, dir);
      if (!target) return;
      if (window.App && typeof App._focusChatBox === 'function') {
        try { App._focusChatBox(target); return; } catch (e2) {}
      }
      // 降级：直接把目标对话滚进视口中央
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

  function updateAll() {
    var boxes = document.querySelectorAll('.chatbox');
    boxes.forEach(function (box) {
      var isActive = box.classList.contains('active');
      var prev = box.querySelector(':scope > .flip-nav-prev');
      var next = box.querySelector(':scope > .flip-nav-next');
      if (!isActive) {
        // 只有焦点对话两侧才有 → 非焦点一律移除
        if (prev) prev.remove();
        if (next) next.remove();
        return;
      }
      var chat = findChatById(box.id);
      if (!chat || !chat.el) { if (prev) prev.remove(); if (next) next.remove(); return; }
      if (!prev) { prev = makeBtn(-1); box.appendChild(prev); }
      if (!next) { next = makeBtn(1); box.appendChild(next); }
      var sides = countSides(chat);
      prev.style.display = sides.left > 0 ? '' : 'none';
      next.style.display = sides.right > 0 ? '' : 'none';
    });
  }

  function schedule() {
    if (PENDING) return;
    PENDING = true;
    requestAnimationFrame(function () { PENDING = false; updateAll(); });
  }

  // 样式：贴在对话外左右两侧、垂直居中、hover 才显眼
  var style = document.createElement('style');
  style.setAttribute('data-flip-nav', '');
  style.textContent =
    '.flip-nav-btn{position:absolute;top:50%;transform:translateY(-50%);width:26px;height:44px;' +
    'display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;' +
    'color:var(--text,#ccc);background:rgba(30,30,34,.72);border:1px solid rgba(255,255,255,.14);' +
    'border-radius:8px;cursor:pointer;user-select:none;z-index:5;opacity:.35;transition:opacity .15s,background .15s;}' +
    '.flip-nav-btn:hover{opacity:1;background:rgba(60,60,70,.9);}' +
    '.flip-nav-prev{left:-32px;}.flip-nav-next{right:-32px;}';
  (document.head || document.documentElement).appendChild(style);

  // 监听：active 切换、对话增删、移动（位置变化影响最近邻方向侧数量）
  var mo = new MutationObserver(schedule);
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });

  if (window.App && App._updateAllNavArrows) {
    var _orig = App._updateAllNavArrows;
    App._updateAllNavArrows = function () { var r = _orig.apply(this, arguments); schedule(); return r; };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
  setInterval(schedule, 1500); // 兜底：拖动/恢复后位置变化
})();
