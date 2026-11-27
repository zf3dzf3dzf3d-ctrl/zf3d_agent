/* =============================================================
 * app-canvas-tree-node.js - i科技树 太空舱节点（外观=原始版，内核=AI真实定位版）
 * 视觉抄自 backup/科技树回退前_20261119 原始版本：
 *   158×158 圆形舱 + 金属环外圈(box-shadow 四层) + 左上玻璃高光斑 + 深色圆底
 *   左下角定位(x:18, dy=76) + 右键拖拽移动 + 滚轮缩放舱体 + 可隐藏
 * 内嵌 iframe: /canvas/进化树/pod.html（AI真实定位版，坐标唯一真源=API）
 * 用法：底部「🌳 万物进化树」→ TreePodNode.toggle()
 * ============================================================= */
(function () {
  'use strict';
  var VIEWER = '/canvas/进化树/pod.html?v=6';
  var Z = 9400;
  var DEF_W = 158, DEF_H = 158;        // 原始版默认尺寸
  var MIN_W = 120, MAX_W = 900;        // 滚轮缩放下/上限
  /* 底边距=221 【出厂默认 2026-12】科技树悬于太空舱正上方并留40px：太空舱(css bottom 50 + 高252)×zoom0.6 ≈ 渲染顶边181px，181+40≈221 */
  var US_DEFAULT = { x: 18, dy: 221, w: DEF_W, h: DEF_H };
  var US_KEY = 'tree_pod_pos';
  var el = null, visible = false;

  function _vh() { return window.innerHeight || 800; }

  /* 存档读取：只认带 dy 的存档（底边距语义），否则回落出厂默认 */
  function _loadPos() {
    try {
      var s = JSON.parse(localStorage.getItem(US_KEY) || 'null');
      if (s && typeof s === 'object' && s.w > 0 && s.dy != null && s.dy >= 60
        && s.x >= 0 && s.x < (window.innerWidth || 1200)) return s;
    } catch (e) {}
    return US_DEFAULT;
  }
  function _savePos() {
    if (!el) return;
    var pos = { x: el.offsetLeft, dy: Math.max(60, Math.round(_vh() - (el.offsetTop + el.offsetHeight))), w: el.offsetWidth, h: el.offsetHeight };
    try { localStorage.setItem(US_KEY, JSON.stringify(pos)); } catch (e) {}
  }

  function ensure() {
    if (el) return el;
    var p = _loadPos();
    var w = p.w || DEF_W, h = p.h || DEF_H;
    var x = (p.x == null ? US_DEFAULT.x : p.x);
    var y = Math.max(0, _vh() - (p.dy == null ? US_DEFAULT.dy : p.dy) - h);

    el = document.createElement('div');
    el.className = 'tree-node';
    el.id = 'treePodNode';
    /* 外观=原始版：圆形舱 + 深色圆底 + 金属环外圈（抄 backup 20261119 L354-377） */
    el.style.cssText =
      'position:fixed;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;' +
      'z-index:' + Z + ';background:transparent;border:none;box-shadow:none;' +
      'border-radius:50%;' +
      'background:radial-gradient(circle at 35% 30%, rgba(28,40,58,.95), rgba(9,14,22,.98));' +
      'box-shadow:' +
        'inset 0 0 0 2px #22303f,' +            /* 内层金属环 */
        'inset 0 0 22px rgba(0,0,0,.35),' +     /* 窗内景深 */
        '0 0 0 4px #2b3a4d,' +                  /* 舱壁金属外环 */
        '0 0 0 5px rgba(255,255,255,.14),' +    /* 外缘高光 */
        '0 6px 18px rgba(0,0,0,.5);' +          /* 投影 */
      'overflow:hidden;';

    /* 显示区：iframe 内嵌 AI 真实定位版 pod（透明底，自裁圆） */
    var view = document.createElement('iframe');
    view.style.cssText = 'position:absolute;inset:0;border:none;width:100%;height:100%;background:transparent;pointer-events:auto;';
    view.setAttribute('allowtransparency', 'true');
    view.setAttribute('scrolling', 'no');
    view.src = VIEWER;
    el.appendChild(view);

    /* 左上玻璃高光斑（抄原始版 L378-386：置于 iframe 之后覆盖形成高光，不挡交互） */
    var hl = document.createElement('div');
    hl.className = 'zf-tree-pod-glow';
    hl.style.cssText = 'position:absolute;left:6%;top:4%;width:52%;height:30%;' +
      'border-radius:50%;pointer-events:none;z-index:3;' +
      'background:radial-gradient(ellipse at 35% 35%, rgba(255,255,255,.34), rgba(255,255,255,.10) 55%, rgba(255,255,255,0) 75%);' +
      'filter:blur(2px);';
    el.appendChild(hl);

    /* ---- 右键拖拽移动（左键留给 iframe 内树交互；iframe 内右键通过 postMessage 转发）---- */
    var rdrag = false, sx = 0, sy = 0, ox = 0, oy = 0;
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 2) return;
      rdrag = true; sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!rdrag || el._podMsgDrag) return;
      el.style.left = (ox + e.clientX - sx) + 'px';
      el.style.top = (oy + e.clientY - sy) + 'px';
      _clamp();
    });
    document.addEventListener('mouseup', function () {
      if (rdrag) { rdrag = false; el._podMsgDrag = false; _savePos(); }
    });
    /* iframe 内右键拖拽转发（pod.html 在圆内右键时发 podRDrag 消息） */
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin) return; // 【修复】仅接受同源 iframe 消息
      if (!el || !ev.data || ev.data.type !== 'podRDrag') return;
      var d = ev.data;
      if (d.phase === 'move') {
        el._podMsgDrag = true;
        el.style.left = (el.offsetLeft + d.dx) + 'px';
        el.style.top = (el.offsetTop + d.dy) + 'px';
        _clamp();
      } else if (d.phase === 'end') {
        el._podMsgDrag = false; _savePos();
      }
    });
    /* iframe 内悬停球的提示浮层（pod.html 的 tip 会被圆舱 overflow:hidden 裁掉，改由宿主渲染） */
    var tipEl = null;
    /* 【修复】pod.html 消息协议只有 html 字段（无纯文本字段，pod.html 端本轮不改）：
       先 esc 再还原换行/剥残余标签，最终用 textContent 渲染——节点文本（地图 JSON 可写）无法再借 tip 注入宿主页面 */
    function _podTipText(html) {
      var s = String(html == null ? '' : html).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
      s = s.replace(/&lt;br\s*\/?&gt;/gi, '\n').replace(/&lt;\/?[a-z][^&]*?&gt;/gi, '');
      return s;
    }
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin) return; // 【修复】仅接受同源 iframe 消息
      if (!el || !ev.data) return;
      var d = ev.data;
      if (d.type === 'podTip' || d.type === 'podTipMove') {
        var podRect = el.getBoundingClientRect();
        if (d.type === 'podTip') {
          if (d.show) {
            if (!tipEl) {
              tipEl = document.createElement('div');
              tipEl.className = 'zf-tree-pod-tip';
              tipEl.style.cssText = 'position:fixed;pointer-events:none;background:rgba(10,14,26,.92);border:1px solid #33406e;border-radius:6px;padding:6px 9px;font-size:12px;color:#dfe6ff;z-index:' + (Z + 1) + ';max-width:280px;line-height:1.5;display:none;white-space:pre-line;';
              document.body.appendChild(tipEl);
            }
            tipEl.textContent = _podTipText(d.html);
            tipEl.style.display = 'block';
          } else if (tipEl) { tipEl.style.display = 'none'; }
        } else if (tipEl && tipEl.style.display !== 'none') {
          var tw = tipEl.offsetWidth || 200, th = tipEl.offsetHeight || 60;
          var lx = Math.min(d.x + podRect.left + 14, window.innerWidth - tw - 8);
          var ly = Math.min(d.y + podRect.top + 14, window.innerHeight - th - 8);
          tipEl.style.left = lx + 'px'; tipEl.style.top = ly + 'px';
        }
      }
    });

    /* ---- 滚轮缩放舱体（悬停舱上滚轮=缩放舱大小，不传给树）---- */
    el.addEventListener('wheel', function (e) {
      if (el._treeFull) return;
      e.preventDefault();
      var f = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      var nw = Math.max(MIN_W, Math.min(MAX_W, el.offsetWidth * f));
      var nh = nw; /* 保持正圆 */
      var cx = el.offsetLeft + el.offsetWidth / 2, cy = el.offsetTop + el.offsetHeight / 2;
      el.style.width = nw + 'px'; el.style.height = nh + 'px';
      el.style.left = Math.round(cx - nw / 2) + 'px';
      el.style.top = Math.round(cy - nh / 2) + 'px';
      _clamp();
    }, { passive: false });

    /* 双击全屏 / 再双击退出（原始版行为） */
    el.addEventListener('dblclick', function () {
      if (el._treeFull) {
        el._treeFull = false;
        el.style.left = el._fullBack.l; el.style.top = el._fullBack.t;
        el.style.width = el._fullBack.w; el.style.height = el._fullBack.h;
        el.style.borderRadius = '50%';
      } else {
        el._fullBack = { l: el.style.left, t: el.style.top, w: el.style.width, h: el.style.height };
        el._treeFull = true;
        el.style.left = '0px'; el.style.top = '0px';
        el.style.width = '100vw'; el.style.height = '100vh';
        el.style.borderRadius = '0';
      }
    });

    function _clamp() {
      var vw = window.innerWidth, vh = _vh();
      var x2 = Math.max(0, Math.min(el.offsetLeft, vw - el.offsetWidth));
      var y2 = Math.max(0, Math.min(el.offsetTop, vh - el.offsetHeight));
      el.style.left = x2 + 'px'; el.style.top = y2 + 'px';
    }
    /* 先挂载再钳制：detached 元素 offset* 全为 0，先钳制会把上面算好的左下角位置覆盖成 (0,0)（初始打开跑到左上角的根因） */
    document.body.appendChild(el);
    _clamp();

    /* 窗口宽高变化时永远跟随左下角：按存档的 x + dy(底边距) 重新定位（不改动用户拖拽结果，只是重贴边角基准） */
    function _reanchor() {
      if (!el || el._treeFull) return;
      var p = _loadPos();
      el.style.left = Math.max(0, (p.x == null ? US_DEFAULT.x : p.x)) + 'px';
      el.style.top = Math.max(0, _vh() - (p.dy == null ? US_DEFAULT.dy : p.dy) - el.offsetHeight) + 'px';
      _savePos();
    }
    window.addEventListener('resize', _reanchor);

    return el;
  }

  function toggle() { visible = !visible; if (visible) ensure(); if (el) el.style.display = visible ? 'block' : 'none'; }
  window.TreePodNode = {
    toggle: toggle,
    add: function () { if (!visible) toggle(); },
    remove: function () { if (visible) toggle(); }
  };
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('treePodToggleBtn') || document.querySelector('[data-tree-pod]');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
  });
})();
