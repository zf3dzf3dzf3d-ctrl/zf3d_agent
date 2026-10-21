/* =====================================================================
 * app-canvas-overview.js  v2 [P1手感+P2缩略名片化]
 * 【总览即整理】缩小总览模式下直接点选/框选/拖动/Delete 真实对话框。
 * 依赖：app-canvas.js 的总览开关广播 window 事件 'wb-canvas-change' {detail:{on}}。
 * 坐标换算：实时缩放比 = 屏幕宽/偏移宽（getBoundingClientRect/offsetWidth），
 *           拖动步进除以该比例即世界位移，无需访问画布内部 view。
 * 与 chatbox-relative-restore.js 共存：拖动只写 left/top，restore 靠
 * pointerup 采集自动重采基准，无双倍跳转。
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFCanvasOverview) return;

  var SEL_CLS = 'ov-selected';
  var NODE_SEL = '.chatbox,.kite-node,.browser-node,.engine-node,.video-node,.fg-node,.pres-node';
  var on = false;            // 总览态标记
  var sel = [];              // 选中节点元素数组
  var banner = null;

  /* ---------- 工具 ---------- */
  function nodes() { return Array.prototype.slice.call(document.querySelectorAll(NODE_SEL)).filter(function (n) { return n.offsetParent; }); }
  function scaleOf(el) {
    var r = el.getBoundingClientRect();
    return (el.offsetWidth > 0 && r.width > 0) ? r.width / el.offsetWidth : 1;
  }
  function isNode(t) { return !!(t && t.closest && t.closest(NODE_SEL)); }

  function clearSel() {
    sel.forEach(function (n) { n.classList.remove(SEL_CLS); });
    sel = [];
  }
  function setSel(list) {
    sel.forEach(function (n) { if (list.indexOf(n) === -1) n.classList.remove(SEL_CLS); });
    sel = list;
    sel.forEach(function (n) { n.classList.add(SEL_CLS); });
  }

  /* ---------- 横幅提示 ---------- */
  function showBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.id = 'zfOverviewBanner';
    banner.textContent = '总览模式：点选/框选/拖动整理 · Esc 返回 · Delete 关闭所选';
    banner.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9001;padding:6px 14px;border-radius:8px;font-size:12px;color:#cdd3e0;background:rgba(30,30,46,.85);border:1px solid rgba(120,130,160,.35);backdrop-filter:blur(6px);pointer-events:none;';
    document.body.appendChild(banner);
  }
  function hideBanner() { if (banner) { banner.remove(); banner = null; } }

  /* ---------- Delete 关闭所选 ---------- */
  function closeSelected() {
    if (!sel.length) return;
    var n = sel.length;
    sel.forEach(function (el) {
      var btn = el.querySelector('.hd-btn.close') || el.querySelector('.chatbox-header .close');
      if (btn) btn.click();
    });
    clearSel();
    if (window.Toast) Toast.show('已关闭 ' + n + ' 个节点');
  }

  /* ---------- 框选（空白处左键拖拽） ---------- */
  function startMarquee(e) {
    var rect = document.createElement('div');
    rect.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;border:1px solid #4f8cff;background:rgba(79,140,255,.14);display:none;';
    document.body.appendChild(rect);
    var sx = e.clientX, sy = e.clientY, active = false;
    var base = sel.slice(); // Shift 加选基准
    var additive = e.shiftKey;
    function applySel(x1, y1, x2, y2) {
      var L = Math.min(x1, x2), R = Math.max(x1, x2), T = Math.min(y1, y2), B = Math.max(y1, y2);
      rect.style.display = 'block';
      rect.style.left = L + 'px'; rect.style.top = T + 'px';
      rect.style.width = (R - L) + 'px'; rect.style.height = (B - T) + 'px';
      var hit = nodes().filter(function (n) {
        var r = n.getBoundingClientRect();
        return r.left < R && r.right > L && r.top < B && r.bottom > T;
      });
      setSel(additive ? base.concat(hit.filter(function (n) { return base.indexOf(n) === -1; })) : hit);
    }
    function onMove(ev) {
      if (!active && Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return;
      if (!active) { active = true; document.body.classList.add('zf-ov-marquee'); } // 【缩小整理模式】框选进行中十字光标
      applySel(sx, sy, ev.clientX, ev.clientY);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('zf-ov-marquee');
      rect.remove();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ---------- 节点拖动（含多选整体拖） ---------- */
  var GRID = 20;             // P1: 落点网格吸附间距
  var dragging = false;      // P1: 拖动中挂起染色刷新
  function startNodeDrag(e, first) {
    var targets = sel.length ? sel.slice() : [first];
    if (!targets.length) return;
    targets.forEach(function (n) { if (sel.indexOf(n) === -1) setSel(sel.concat([n])); });
    var sx = e.clientX, sy = e.clientY, moved = false;
    dragging = true;
    var starts = targets.map(function (n) { return { el: n, l: n.offsetLeft, t: n.offsetTop, s: scaleOf(n) }; });
    function onMove(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      starts.forEach(function (o) {
        var k = o.s || scaleOf(o.el); // 实时缩放比（总览态恒定）
        o.el.style.left = Math.round(o.l + dx / k) + 'px';
        o.el.style.top = Math.round(o.t + dy / k) + 'px';
      });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragging = false;
      if (moved) {
        /* 【错位修复 v3】整理拖动期间挂起父子偏移守恒模块（beginMigration），
           落点写回并落库后再释放（endMigration 按最终真实位置重算基准）。
           否则周期采集（5s setInterval）会把拖动中间态写成偏移基准，
           退出总览后被守恒校正按陈旧基准把子窗拉回 → 所有对话错位。 */
        try { if (window.ZFRelativeRestore && ZFRelativeRestore.beginMigration) ZFRelativeRestore.beginMigration(); } catch (err) {}
        // P1: 落点 20px 网格吸附，整理完天然对齐
        targets.forEach(function (el) {
          el.style.left = (Math.round(el.offsetLeft / GRID) * GRID) + 'px';
          el.style.top = (Math.round(el.offsetTop / GRID) * GRID) + 'px';
        });
        // 【子树跟随 v3】移动父窗时其未选中子窗按同一位移跟随（与主画布拖拽语义一致），
        // 否则父动子不动，父子相对位置被破坏 → 看起来"全部错位"。
        try {
          var _boxes = (window.App && window.App.chatBoxes) || [];
          function _cidOfEl(el) {
            for (var i = 0; i < _boxes.length; i++) if (_boxes[i] && _boxes[i].el === el) return _boxes[i].id;
            return null;
          }
          function _elOf(cid) {
            for (var i = 0; i < _boxes.length; i++) if (_boxes[i] && _boxes[i].id === cid) return _boxes[i].el;
            return null;
          }
          targets.forEach(function (el) {
            var pid = _cidOfEl(el);
            if (!pid || !window.ZFGroupFollow || !ZFGroupFollow.collectSubtree) return;
            var sub = ZFGroupFollow.collectSubtree(pid) || [];
            var _o = null;
            for (var s = 0; s < starts.length; s++) if (starts[s].el === el) { _o = starts[s]; break; }
            if (!_o) return;
            var ddx = el.offsetLeft - _o.l, ddy = el.offsetTop - _o.t;
            if (!ddx && !ddy) return;
            for (var i = 0; i < sub.length; i++) {
              var mid = sub[i].id || sub[i];
              if (!mid || mid === pid) continue;
              var mel = _elOf(mid);
              if (!mel || targets.indexOf(mel) >= 0) continue; // 已在拖动集内的不重复移
              mel.style.left = (parseFloat(mel.style.left) || mel.offsetLeft) + ddx + 'px';
              mel.style.top = (parseFloat(mel.style.top) || mel.offsetTop) + ddy + 'px';
              /* 同步内存态并落库，防后续按旧 chat.x/y 重写 */
              for (var b = 0; b < _boxes.length; b++) {
                if (_boxes[b] && _boxes[b].el === mel) {
                  _boxes[b].x = mel.offsetLeft; _boxes[b].y = mel.offsetTop;
                  try { if (window.Store && Store.saveChatBox) Store.saveChatBox(_boxes[b]); } catch (err2) {}
                  break;
                }
              }
            }
          });
        } catch (err) {}
        // 落库 + 让 restore 钩子重采基准
        targets.forEach(function (el) {
          var boxes = (window.App && window.App.chatBoxes) || [];
          for (var i = 0; i < boxes.length; i++) {
            if (boxes[i] && boxes[i].el === el) {
              boxes[i].x = el.offsetLeft; boxes[i].y = el.offsetTop;
              try { if (window.Store && Store.saveChatBox) Store.saveChatBox(boxes[i]); } catch (err) {}
              break;
            }
          }
        });
        /* 【门禁释放】写回与子树跟随均为同步 DOM 写入，稍延时确保渲染完成后
           endMigration 内部按最终位置重算偏移基准并落库 */
        setTimeout(function () {
          try { if (window.ZFRelativeRestore && ZFRelativeRestore.endMigration) ZFRelativeRestore.endMigration(); } catch (err) {}
        }, 300);
      } else {
        // 未移动＝点选：无 Ctrl/Shift → 单选；Ctrl → 切换
        if (e.ctrlKey) {
          if (sel.indexOf(first) >= 0) setSel(sel.filter(function (n) { return n !== first; }));
          else setSel(sel.concat([first]));
        } else setSel([first]);
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ---------- P1: 双击节点＝飞近并退出总览 ---------- */
  document.addEventListener('dblclick', function (e) {
    if (!on) return;
    var node = isNode(e.target) ? e.target.closest(NODE_SEL) : null;
    if (!node) return;
    var t2 = e.target;
    if (t2 && (t2.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t2.tagName))) return;
    e.preventDefault(); e.stopPropagation();
    try {
      if (window.App && typeof window.App.focusChatBox === 'function') {
        var c = chatOf(node);
        if (c && c.id != null) window.App.focusChatBox(c.id);
      }
    } catch (err) {}
    if (window.App && typeof window.App.canvasOverviewToggle === 'function') window.App.canvasOverviewToggle();
  }, true);

  /* ---------- P1: 总览中滚轮＝平移视口（不动缩放） ---------- */
  document.addEventListener('wheel', function (e) {
    if (!on || e.ctrlKey) return;
    var vp = document.getElementById('canvasViewport') || document.querySelector('.canvas-viewport,.wb-canvas-viewport,#canvas');
    if (vp) { vp.scrollLeft += (e.deltaX || 0) + e.deltaY * 0.4; vp.scrollTop += e.deltaY; e.preventDefault(); }
  }, { passive: false });

  /* ---------- 事件接管（捕获阶段，抢在画布平移/退出总览之前） ---------- */
  document.addEventListener('mousedown', function (e) {
    if (!on || e.button !== 0) return;
    var node = isNode(e.target) ? e.target.closest(NODE_SEL) : null;
    // 输入控件绝不接管（保粘贴/右键/编辑）
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
    if (node) {
      e.preventDefault();
      e.stopPropagation();
      startNodeDrag(e, node);
    } else if (window.App && typeof window.App._isCanvasBlankTarget === 'function' && window.App._isCanvasBlankTarget(t)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.shiftKey) clearSel();
      startMarquee(e);
    }
  }, true);

  /* ---------- Esc 返回 / Delete 关闭 ---------- */
  document.addEventListener('keydown', function (e) {
    if (!on) return;
    // 【防误伤】焦点在输入框/可编辑区时，Esc/Delete 归输入框自己的逻辑（取消输入、删字符），
    //   不接管总览快捷键；且总览态与整理面板/弹窗不同时开启，不会抢它们的键
    var ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return;
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      // 【M2】右下角总览按钮已移除，退出直接调用总览开关函数
      if (window.App && typeof window.App.canvasOverviewToggle === 'function') {
        e.preventDefault();
        window.App.canvasOverviewToggle();
      } else {
        var btn = document.getElementById('canvasOverviewBtn');
        if (btn) btn.click();
      }
    } else if (e.key === 'Delete' && sel.length) {
      e.preventDefault();
      closeSelected();
    }
  });

  /* ---------- 【M1 颜色移植】总览态下给真实 .chatbox 按对话状态染色 ----------
   * 配色/状态判定真源取自 app-minimap-organize.js 的 STATUS_COLORS + statusOfBox：
   *   sending 蓝↻ / queued 黄… / answered 绿✓ / error 红✕ / active 亮蓝 / idle 淡蓝。
   * 仅在 body.zf-overview-mode 作用域下由 CSS 生效；退出总览时移除 data-ov-st，
   * 颜色随之恢复（双保险：CSS 作用域 + 属性清除）。 */
  var ST_CLASSES = ['ov-st-sending', 'ov-st-queued', 'ov-st-answered', 'ov-st-error', 'ov-st-active', 'ov-st-idle'];
  var stTimer = null;
  function chatOf(el) {
    var a = (window.App && window.App.chatBoxes) || [];
    for (var i = 0; i < a.length; i++) { if (a[i] && a[i].el === el) return a[i]; }
    return null;
  }
  function isAnswered(c) {
    if (!c) return false;
    if (c._taskStatus === 'success') return true;
    var h = c.history || [];
    for (var i = 0; i < h.length; i++) {
      var m = h[i];
      if (m && !m._meta && m.role === 'assistant' && String(m.content || '').replace(/<[^>]+>/g, '').trim()) return true;
    }
    return false;
  }
  function statusOf(el) {
    if (!el.classList.contains('chatbox')) return '';
    var c = chatOf(el);
    try {
      if (c && c.isSending) return 'sending';
      if (c && c.queue && c.queue.length > 0) return 'queued';
      if (c && c._taskStatus === 'fail') return 'error';
      if (isAnswered(c)) return 'answered';
      if (el.classList.contains('active')) return 'active';
    } catch (e) {}
    return 'idle';
  }
  function paintOne(el) {
    var st = statusOf(el);
    if (!st) return;
    if (el.dataset.ovSt === st) return; // 状态未变不重绘，避免闪烁
    ST_CLASSES.forEach(function (cls) { el.classList.remove(cls); });
    el.dataset.ovSt = st;
    el.classList.add('ov-st-' + st);
  }
  function applyColors() {
    if (dragging) return; // P1: 拖动中挂起刷新，松手后下一轮补刷
    nodes().forEach(function (el) {
      if (el.classList.contains('chatbox')) paintOne(el);
      el.classList.toggle('ov-mini', scaleOf(el) < 0.25); // P2: 缩略名片标记
    });
  }
  function clearColors() {
    var els = document.querySelectorAll('.chatbox[data-ov-st]');
    Array.prototype.forEach.call(els, function (el) {
      ST_CLASSES.forEach(function (cls) { el.classList.remove(cls); });
      delete el.dataset.ovSt;
    });
  }
  /* 【div 残留根治】总览装饰 div（.ov-sum 摘要行 / .ov-badge 派▼徽章）必须随退出总览彻底移除：
   * 它们是块级元素，残留在真实 .chatbox 里会撑高布局挤错内容，并污染父子位置测量。
   * 严禁在此改成"仅隐藏"——必须 remove。 */
  function undecorateAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.chatbox > .ov-sum, .chatbox > .ov-badge'), function (n) {
      try { n.parentNode.removeChild(n); } catch (e) {}
    });
  }
  function startStTimer() { stopStTimer(); stTimer = setInterval(applyColors, 700); }
  function stopStTimer() { if (stTimer) { clearInterval(stTimer); stTimer = null; } }

  /* ---------- 总览开关联动 ---------- */
  window.addEventListener('wb-canvas-change', function (e) {
    on = !!(e.detail && e.detail.on);
    document.body.classList.toggle('zf-overview-mode', on);
    if (on) { clearSel(); showBanner(); applyColors(); startStTimer(); injectOvCss(); stampDelays(); }
    else { dragging = false; clearSel(); hideBanner(); stopStTimer(); clearColors(); undecorateAll(); }
  });

  /* ---------- P2: 总览态形象升级样式（一次性注入，全部限定 zf-overview-mode） ---------- */
  var ovCssDone = false;
  function injectOvCss() {
    if (ovCssDone) return; ovCssDone = true;
    var s = document.createElement('style');
    s.id = 'zfOverviewPolishCss';
    s.textContent = [
      /* 【斜排修复】绝不能覆盖 .chatbox 的 position:absolute！
         若改成 relative，绝对定位窗格会回流进文档流排队，
         各自的 left/top 又叠加在流动位置上 → 整排呈阶梯状斜排。
         ::before 状态色条在 absolute 容器上定位不受影响。 */
      'body.zf-overview-mode .chatbox{overflow:visible;}',
      'body.zf-overview-mode .chatbox[data-ov-st]::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px 0 0 3px;z-index:5;}',
      'body.zf-overview-mode .chatbox[data-ov-st="sending"]::before{background:#4f8cff;}',
      'body.zf-overview-mode .chatbox[data-ov-st="queued"]::before{background:#e8b339;}',
      'body.zf-overview-mode .chatbox[data-ov-st="answered"]::before{background:#3fae6a;}',
      'body.zf-overview-mode .chatbox[data-ov-st="error"]::before{background:#e05252;}',
      'body.zf-overview-mode .chatbox[data-ov-st="active"]::before{background:#5aa2ff;}',
      'body.zf-overview-mode .chatbox[data-ov-st="idle"]::before{background:rgba(120,150,220,.4);}',
      'body.zf-overview-mode .chatbox{animation:zfOvIn .28s ease both;animation-delay:var(--ov-delay,0ms);}',
      'body.zf-overview-mode .chatbox[data-ov-st="sending"]{animation:zfOvIn .28s ease both,zfOvBreath 1.6s ease-in-out .28s infinite;animation-delay:var(--ov-delay,0ms),.28s;}',
      '@keyframes zfOvIn{from{opacity:0;transform:scale(.96);}to{opacity:1;transform:scale(1);}}',
      '@keyframes zfOvBreath{0%,100%{box-shadow:0 0 0 0 rgba(79,140,255,0);}50%{box-shadow:0 0 14px 2px rgba(79,140,255,.45);}}',
      'body.zf-overview-mode .chatbox .ov-sum{display:block;max-height:34px;overflow:hidden;font-size:11px;line-height:1.5;color:#9aa4b8;padding:2px 8px 4px;border-top:1px dashed rgba(140,150,180,.25);white-space:nowrap;text-overflow:ellipsis;}',
      'body.zf-overview-mode .chatbox.ov-mini .ov-sum{display:none;}',
      'body.zf-overview-mode .chatbox .ov-badge{display:none;position:absolute;right:4px;top:4px;z-index:6;align-items:center;gap:2px;padding:1px 6px;border-radius:10px;font-size:10px;background:rgba(40,46,66,.9);border:1px solid rgba(120,130,160,.4);color:#cdd3e0;cursor:pointer;}',
      'body.zf-overview-mode .chatbox.ov-mini .ov-badge{display:flex;}',
      'body.zf-overview-mode .chatbox button{position:relative;}',
      'body.zf-overview-mode .chatbox button::after{content:"";position:absolute;inset:-4px;}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function lastMsg(c) {
    if (!c || !c.history) return '';
    for (var i = c.history.length - 1; i >= 0; i--) {
      var m = c.history[i];
      if (m && !m._meta && String(m.content || '').trim()) return String(m.content).replace(/<[^>]+>/g, '').trim().slice(0, 40);
    }
    return '';
  }
  var ST_ICO = { sending: '\u21bb', queued: '\u2026', answered: '\u2713', error: '\u2715', active: '\u25cf', idle: '\u25cb' };
  function decorateOne(el) {
    if (!el.classList.contains('chatbox')) return;
    var sum = el.querySelector(':scope > .ov-sum');
    if (!sum) { sum = document.createElement('div'); sum.className = 'ov-sum'; el.appendChild(sum); }
    sum.textContent = lastMsg(chatOf(el)) || '\uff08\u7a7a\u5bf9\u8bdd\uff09';
    var st = el.dataset.ovSt || 'idle';
    var bd = el.querySelector(':scope > .ov-badge');
    if (!bd) {
      bd = document.createElement('div'); bd.className = 'ov-badge';
      bd.addEventListener('click', function (ev) { ev.stopPropagation(); if (window.App && window.App.canvasOverviewToggle) window.App.canvasOverviewToggle(); });
      el.appendChild(bd);
    }
    bd.textContent = (ST_ICO[st] || '') + ' \u6d3e\u25be';
  }
  function stampDelays() {
    nodes().forEach(function (el, i) {
      el.style.setProperty('--ov-delay', Math.min(i * 8, 400) + 'ms');
      decorateOne(el);
    });
  }

  window.ZFCanvasOverview = { selected: function () { return sel.slice(); }, clear: clearSel };
  /* 启动兜底：清掉历史版本遗留的总览装饰 div（正常 DOM 刷新即重置，此为保险） */
  undecorateAll();
})();
