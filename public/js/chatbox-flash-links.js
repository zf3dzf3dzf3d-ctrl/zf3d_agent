/* ============================================================
 * chatbox-flash-links.js —— @ 提及闪电线特效（v5.2.6）
 * 用户在对话框里 @角色名 发送 → 立刻画「本框 → 目标框」黄色闪电线
 * 被提及角色回复（服务端 response 事件）→ 画「源框 → 本框」回程闪电线
 * 依赖：style-curve.css / curve-manager.js 的 SVG 画布层（#curveLayer）
 * ============================================================ */
(function () {
  'use strict';
  if (window.__chatboxFlashLinks) return;
  window.__chatboxFlashLinks = true;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var FLASH_MS = 2600;      // 闪电线存活时长
  var POLL_MS = 1500;       // 回程信号轮询间隔
  var lastFlashTs = 0;      // 增量游标

  /* ---------- SVG 层 ---------- */
  function ensureLayer() {
    var layer = document.getElementById('curveLayer');
    if (layer) return layer;
    layer = document.createElementNS(SVG_NS, 'svg');
    layer.id = 'curveLayer';
    layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9998;overflow:visible;';
    var host = document.getElementById('canvasContent') || document.body;
    if (host !== document.body) {
      var cs = getComputedStyle(host);
      if (cs.position === 'static') host.style.position = 'relative';
    }
    host.appendChild(layer);
    return layer;
  }

  /* ---------- 端点定位（canvasContent 内部坐标，与 curve-manager 同规则） ---------- */
  function boxPoint(boxEl, targetEl) {
    if (!boxEl) return null;
    var r = boxEl.getBoundingClientRect();
    var content = document.getElementById('canvasContent');
    var cr = content ? content.getBoundingClientRect() : { left: 0, top: 0 };
    var lx = r.left - cr.left, ly = r.top - cr.top;
    var cx = lx + r.width / 2, cy = ly + r.height / 2;
    if (!targetEl) return { x: cx, y: cy };
    var t = targetEl.getBoundingClientRect();
    var tcx = t.left + t.width / 2, tcy = t.top + t.height / 2;
    if (Math.abs(tcx - cx) > Math.abs(tcy - cy)) {
      return tcx > cx ? { x: lx + r.width, y: cy } : { x: lx, y: cy };
    }
    return tcy > cy ? { x: cx, y: ly + r.height } : { x: cx, y: ly };
  }

  /* ---------- 画一条闪电线 ---------- */
  function drawFlash(fromEl, toEl, dir) {
    if (!fromEl || !toEl) return;
    var layer = ensureLayer();
    var a = boxPoint(fromEl, toEl);
    var b = boxPoint(toEl, fromEl);
    if (!a || !b) return;

    var path = document.createElementNS(SVG_NS, 'path');
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 40;
    path.setAttribute('d', 'M ' + a.x + ' ' + a.y + ' Q ' + mx + ' ' + my + ' ' + b.x + ' ' + b.y);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', dir === 'back' ? '#4ade80' : '#facc15');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-dasharray', '10 8');
    path.setAttribute('class', 'flash-bolt-line');
    path.style.filter = 'drop-shadow(0 0 6px currentColor)';
    layer.appendChild(path);

    // 流光动画（SMIL，无需 CSS keyframes）
    try {
      var anim = document.createElementNS(SVG_NS, 'animate');
      anim.setAttribute('attributeName', 'stroke-dashoffset');
      anim.setAttribute('from', '36');
      anim.setAttribute('to', '0');
      anim.setAttribute('dur', '0.5s');
      anim.setAttribute('repeatCount', 'indefinite');
      path.appendChild(anim);
    } catch (e) { /* ignore */ }

    setTimeout(function () {
      path.style.transition = 'opacity .5s';
      path.style.opacity = '0';
      setTimeout(function () { path.remove(); }, 550);
    }, FLASH_MS);
  }

  /* ---------- 找对话框元素 ---------- */
  function findBox(boxId) {
    var el = document.querySelector('.chatbox[data-box-id="' + boxId + '"], .chat-box[data-box-id="' + boxId + '"], #' + boxId);
    return el;
  }
  function allBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('.chatbox, .chat-box'));
  }
  function boxIdOf(b) {
    return (b.dataset && (b.dataset.boxId || b.dataset.cbDockKey)) || b.id || '';
  }

  /* ---------- 角色绑定（复用 /api/roles 的 selected 映射） ---------- */
  var selCache = { t: 0, map: null };
  function getSelectedMap(cb) {
    if (selCache.map && Date.now() - selCache.t < 5000) return cb(selCache.map);
    fetch('/api/roles?box=__mention__').then(function (r) { return r.json(); }).then(function (res) {
      selCache = { t: Date.now(), map: (res && res.selected) || {} };
      cb(selCache.map);
    }).catch(function () { cb({}); });
  }
  function roleCache(cb) {
    fetch('/api/roles').then(function (r) { return r.json(); }).then(function (res) {
      cb((res && res.roles) || []);
    }).catch(function () { cb([]); });
  }

  /* ---------- 发送方向：扫描 @角色名 ---------- */
  var NAME_RE_CACHE = null;
  function scanAndFlash(text) {
    if (!text || text.indexOf('@') < 0) return;
    roleCache(function (roles) {
      getSelectedMap(function (sel) {
        var boxes = allBoxes();
        var myEl = boxes.find(function (b) {
          var ta = b.querySelector('textarea, input[type=text]');
          return ta && (ta.value === text || ta.value === (text + ' '));
        }) || document.activeElement && (document.activeElement.closest('.chatbox, .chat-box'));
        if (!myEl) return;
        var myId = boxIdOf(myEl);
        roles.forEach(function (r) {
          if (!r || !r.name) return;
          if (text.indexOf('@' + r.name) < 0) return;
          // 找到绑定该角色的其他对话框
          Object.keys(sel).forEach(function (bid) {
            if (String(sel[bid]) !== String(r.id)) return;
            if (bid === myId) return; // 自己绑定则服务端本地注入，无需闪电线
            var target = findBox(bid);
            if (target) drawFlash(myEl, target, 'send');
          });
        });
      });
    });
  }

  /* ---------- 拦截发送（捕获阶段，先于实际发送） ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    var ta = e.target;
    if (!ta.matches || !ta.matches('textarea, input[type=text]')) return;
    var text = ta.value || '';
    if (text.trim()) setTimeout(function () { scanAndFlash(text); }, 30);
  }, true);
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.chat-send-btn, .send-btn, button[data-action=send], .btn-send');
    if (!btn) return;
    var box = btn.closest('.chatbox, .chat-box');
    if (!box) return;
    var ta = box.querySelector('textarea, input[type=text]');
    var text = (ta && (ta.value || '')) || box.__pendingText || '';
    if (text.trim()) setTimeout(function () { scanAndFlash(text); }, 30);
  }, true);


  console.log('[flash-links] @闪电线特效已加载');
})();
