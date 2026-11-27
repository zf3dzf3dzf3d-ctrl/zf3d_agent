/* =====================================================================
 * app-canvas-overview.js  v2 [P1手感+P2缩略名片化]
 * 【20261123·用户令】①子对话只显角色名：垃圾师等派出子窗标题按 _swarmLabel＞角色卡 zf_role_chat_<id>
 *   ＞ ZFChildRel.childKeyOf 固定角色表＞窗头.title清洗 解析，不再回退显示整段任务提示词；
 *   ②仅子对话含分数（ZFChildRel.scoreOf 真源）→ 标题下方居中大字（屏显恒定约48px，流式实时刷新）；
 *     主对话不显分数【20261123·用户令】：scoreOf 只解析本窗 history，主对话正文回显的旧分被误抓且
 *     不随子窗分数更新，干脆整卡不画分数。
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
  var selOrder = [];         // 选中先后（旧→新），只用于层级排位：后选的在上（见 raiseSel）
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
    selOrder = [];
  }
  /* ---------- 选中置顶 ---------- */
  /* 【用户令 2026-11-23】缩小整理模式下选中的节点必须压在未选中节点之上，否则被别的卡片盖住的对话
     选中了也看不见（描边被上层卡片挡住）。根因：总览态按下在捕获阶段截断（见下方 mousedown 接管），
     普通模式点窗置顶的 App.activate 跑不到，选中只加了描边 class，层叠顺序一直没动。
     实现只写 CSS 变量 --ov-z-top，由 injectOvCss 的
       body.zf-overview-mode .ov-selected{z-index:var(--ov-z-top,99999) !important}
     压过内联 z-index，内联值原样保留：
       ① 拖动落库（Store.saveChatBox 读 el.style.zIndex）存的仍是原层级，整理不会顺带改掉用户的层叠顺序；
       ② 取消选中/退出总览 class 一摘即还原，没有"恢复"步骤也就没有恢复时机问题。
     层级排位【用户令 2026-11-23·二次澄清】按选中先后叠：后选的压在先选的上面，最后选中的永远最上层
     （用户点谁就能看到谁的分数），选中项整体高于未选中项。逐个取
       z = max(原 z, 未选中节点最高 z + 1 + 名次, 前一个选中项 + 1)
     前两项保证「选中在上、且不低于自己原层级」（不改变它与连线等非节点层的相对关系），
     后一项保证按选中先后严格递增。 */
  var _zBase = new WeakMap(); // 无内联 z 的节点（如 fg-node）→ 原始计算值
  function baseZ(n) {
    var z = parseInt(n.style.zIndex, 10);
    if (!isNaN(z)) return z; // 内联是真源（选中期间别处改了 z 也跟得上）
    if (n.classList.contains(SEL_CLS)) return _zBase.has(n) ? _zBase.get(n) : 0; // 选中中：计算值已是抬升值，只能用进选中前缓存的
    z = parseInt(getComputedStyle(n).zIndex, 10);
    _zBase.set(n, isNaN(z) ? 0 : z);
    return _zBase.get(n);
  }
  function raiseSel(order) { // order = 选中先后（旧→新）
    if (!order.length) return;
    var inSel = new Set(order);
    var all = document.querySelectorAll(NODE_SEL), i, z, maxRest = 0;
    for (i = 0; i < all.length; i++) { // 读阶段：未选中节点的最高 z（含被剔除隐藏的——它们随时会重新显示）
      if (inSel.has(all[i])) continue;
      z = baseZ(all[i]);
      if (z > maxRest) maxRest = z;
    }
    var bases = order.map(baseZ), prev = 0; // 读阶段：各选中节点的原 z（与上面合并成先读后写）
    for (i = 0; i < order.length; i++) { // 写阶段：值未变不写
      z = Math.max(bases[i], maxRest + 1 + i, prev + 1);
      prev = z;
      z = String(z);
      if (order[i].style.getPropertyValue('--ov-z-top') !== z) order[i].style.setProperty('--ov-z-top', z);
    }
  }
  function setSel(list, newest) { // newest：本次点选的节点——已选中的再点一次也算最新选中（被压住时点它要看得到）
    sel.forEach(function (n) { if (list.indexOf(n) === -1) n.classList.remove(SEL_CLS); });
    /* 选中先后：留在选区内的保持原次序，新进选区的排在最后（=最新选中）；框选时按进入选区的先后 */
    var keep = new Set(list);
    selOrder = selOrder.filter(function (n) { return keep.has(n); });
    var seen = new Set(selOrder);
    list.forEach(function (n) { if (!seen.has(n)) { seen.add(n); selOrder.push(n); } });
    var k = newest ? selOrder.indexOf(newest) : -1;
    if (k >= 0 && k < selOrder.length - 1) { selOrder.splice(k, 1); selOrder.push(newest); }
    sel = list;
    raiseSel(selOrder); // 先定层级再加 class：class 一挂上抬升即生效，不会先按旧 z 画一帧
    sel.forEach(function (n) { n.classList.add(SEL_CLS); });
    /* 选中态边框按实时缩放比补偿：低缩放下 outline 固定像素会被画布稀释，除以 zoom 保持视觉恒定 */
    try { document.body.style.setProperty('--ov-zoom', (list.length ? scaleOf(list[0]) : 1).toFixed(4)); } catch (e) {}
  }

  /* ---------- 横幅提示 ---------- */
  /* 【用户令 2026-11-21】顶部提示横幅整排去掉：进入整理模式不再弹任何提示文字（操作靠按钮与快捷键，title 提示保留） */
  function showBanner() { /* no-op：横幅已按需求移除 */ }
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
    /* 【点选直选修复】按下即选中：点未选中节点→立即单选并只拖它；
       点已选中节点→保持多选整体拖。原先 targets 取旧选中集、选中
       要等 mouseup「未移动＝点选」才补，首击视觉上像"先取消选择，
       再点一次才选中"。 */
    var ctrlToggle = e.ctrlKey && sel.indexOf(first) < 0; // Ctrl 加选：不预选，交给 mouseup 切换
    var targets = (!ctrlToggle && sel.length && sel.indexOf(first) >= 0) ? sel.slice() : [first];
    if (!targets.length) return;
    if (!ctrlToggle) setSel(targets, first);
    var sx = e.clientX, sy = e.clientY, moved = false;
    dragging = true;
    var starts = targets.map(function (n) { return { el: n, l: n.offsetLeft, t: n.offsetTop, s: scaleOf(n) }; });
    /* 【2倍偏移修复 v4】拖拽开始时快照每个目标的子树成员相对父窗的原始偏移。
       背景：ZFGroupFollow 的 document 级 pointer 捕获监听在拖拽期间已实时把子窗
       摆到「父新位置+原始偏移」（绝对定位）；若松手时 overview 再按增量 ddx
       叠加一次 → 子窗位移 2 倍。改为落地时按快照偏移做绝对定位（幂等，
       无论实时跟随是否已摆过位，最终结果一致且只摆一次）。 */
    var _subStart = {};
    try {
      if (window.ZFGroupFollow && ZFGroupFollow.collectSubtree && window.App) {
        var _boxesSnap = (window.App.chatBoxes) || [];
        function _snapIdOfEl(el) {
          for (var i = 0; i < _boxesSnap.length; i++) if (_boxesSnap[i] && _boxesSnap[i].el === el) return _boxesSnap[i].id;
          return null;
        }
        targets.forEach(function (el) {
          var pid = _snapIdOfEl(el);
          if (!pid) return;
          var sub = ZFGroupFollow.collectSubtree(pid) || [];
          sub.forEach(function (c) {
            var cid = c.id || c;
            if (_subStart[cid]) return; // 已被更上层的父快照过，保留最外层基准
            for (var i = 0; i < _boxesSnap.length; i++) {
              if (_boxesSnap[i] && _boxesSnap[i].id === cid && _boxesSnap[i].el) {
                var _cel = _boxesSnap[i].el;
                /* 【策划案 20261123·三种模式积累性修复 #3】被「隐藏/省电/分组折叠」的成员是 display:none，
                   offsetLeft/offsetTop 恒为 0 → 快照记成 0，松手时落地位置 = 父窗位移量（被挪到原点附近）并落库。
                   不可见成员改读内联 left/top（画布世界坐标的真源，与 ZFGroupFollow.posOf 同源）；
                   读不到（无内联定位）则不参与跟随。 */
                var _hid = _cel.offsetParent === null;
                var _il = _hid ? parseFloat(_cel.style.left) : _cel.offsetLeft;
                var _it = _hid ? parseFloat(_cel.style.top) : _cel.offsetTop;
                if (isNaN(_il) || isNaN(_it)) return;
                _subStart[cid] = { el: _cel, l: _il, t: _it, pl: el.offsetLeft, pt: el.offsetTop, hidden: _hid };
                break;
              }
            }
          });
        });
      }
    } catch (eSs) {}
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
              var _ss = _subStart[mid];
              /* 【策划案 20261123·三种模式积累性修复 #3】不可见且无内联定位的成员：原位置无从得知，不动 */
              if (!_ss && mel.offsetParent === null && isNaN(parseFloat(mel.style.left))) continue;
              var _hidMember = !!( _ss ? _ss.hidden : (mel.offsetParent === null)); // 不可见成员 offsetLeft/Top 恒为 0，内存态改用算出来的坐标
              /* 【2倍偏移修复 v4】改为绝对定位：按拖拽开始快照的原始相对偏移，
                 摆到「父最终位置 + 原始偏移」。此前按增量 ddx 叠加，与
                 ZFGroupFollow 拖拽期实时跟随（moveFollow 绝对定位）叠加 → 子窗 2 倍位移。
                 绝对定位幂等：实时跟随已摆过的位置会被摆到同一坐标，不再二次叠加。 */
              if (_ss && _ss.el === mel) {
                var _nx = el.offsetLeft + (_ss.l - _ss.pl);
                var _ny = el.offsetTop + (_ss.t - _ss.pt);
                if (Math.abs((parseFloat(mel.style.left) || mel.offsetLeft) - _nx) < 0.5 &&
                    Math.abs((parseFloat(mel.style.top) || mel.offsetTop) - _ny) < 0.5) {
                  /* 位置已正确（实时跟随已摆好）→ 仅确保内存态/落库一致 */
                } else {
                  mel.style.left = Math.round(_nx) + 'px';
                  mel.style.top = Math.round(_ny) + 'px';
                }
              } else {
                /* 快照缺失兜底：退回增量方式（与旧行为一致，仅极端场景） */
                mel.style.left = (parseFloat(mel.style.left) || mel.offsetLeft) + ddx + 'px';
                mel.style.top = (parseFloat(mel.style.top) || mel.offsetTop) + ddy + 'px';
              }
              /* 同步内存态并落库，防后续按旧 chat.x/y 重写 */
              for (var b = 0; b < _boxes.length; b++) {
                if (_boxes[b] && _boxes[b].el === mel) {
                  _boxes[b].x = _hidMember ? Math.round(parseFloat(mel.style.left)) : mel.offsetLeft;
                  _boxes[b].y = _hidMember ? Math.round(parseFloat(mel.style.top)) : mel.offsetTop;
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
        // 未移动＝点选：按下时已直选（见 startNodeDrag），此处仅处理 Ctrl 追加/移除
        if (e.ctrlKey) {
          if (sel.indexOf(first) >= 0) setSel(sel.filter(function (n) { return n !== first; }));
          else setSel(sel.concat([first]));
        }
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
    /* 【修复 2026-11-27】原来调 window.App.focusChatBox（无下划线）——App 真源方法
       是 _focusChatBox（chatbox-01/app-taskpanel 各有归一化实现），旧判断恒 false
       导致摄像机从不跟随。
       【再修复 2026-11-28 摄像机跑远】旧行为：先 canvasOverviewToggle() 飞回旧视口
       （_ovRaf 500ms 动画），再延时 150ms 调 _focusChatBox（_flyRaf 动画）——两个
       rAF 同时逐帧写 view 互相覆盖，摄像机被拽回旧视口，表现为"跑到很远"。
       现在：把目标 id 作为 exitTo 直接传给 canvasOverviewToggle，退出动画一步
       飞到该对话框居中；动画结束后再调 _focusChatBox 精确校准（此时无并发动画）。 */
    var targetId = null;
    try {
      var c = chatOf(node);
      if (c && c.id != null) targetId = c.id;
    } catch (err) {}
    if (window.App && typeof window.App.canvasOverviewToggle === 'function') window.App.canvasOverviewToggle(targetId != null ? { id: targetId } : undefined);
    if (targetId != null) {
      /* 延时 >500ms（退出动画 dur=500ms）确保退出动画已完全结束，避免两个 rAF 并发写 view */
      setTimeout(function () {
        try {
          if (window.App && typeof window.App._focusChatBox === 'function') {
            window.App._focusChatBox(targetId);
          } else if (window.App && typeof window.App.focusChatBox === 'function') {
            window.App.focusChatBox(targetId);
          }
        } catch (err2) {}
      }, 620);
    }
  }, true);

  /* ---------- P2: 总览滚轮＝以鼠标为锚缩放（Ctrl+滚轮大档位；输入框内放行自滚） ---------- */
  document.addEventListener('wheel', function (e) {
    if (!on) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
    /* 【派出团队面板放行 2026-11-20】滚轮在 .zf-crew-panel（派出团队面板，含缩小整理
       dock 弹出的浮层宿主内）上：放行默认滚动（滚对话框），不缩放摄像机、不抛离区域 */
    if (t && t.closest && t.closest('.zf-crew-panel')) return;
    /* 【修复 2026-11-28 缩放失效】factor 从未声明（var 丢失）→ 普通（不按Ctrl）滚轮时
       factor=undefined，zoomAt 里 scale 变 NaN，缩放完全失灵。现按事件现算：
       普通滚轮小档位 1.06（精细缩放），Ctrl+滚轮大档位 1.22（快速缩放）。 */
    var factor = e.ctrlKey ? (e.deltaY < 0 ? 1.22 : 1 / 1.22)
                           : (e.deltaY < 0 ? 1.06 : 1 / 1.06);
    e.preventDefault();
    e.stopPropagation();
    if (window.App && typeof window.App.canvasOverviewZoomAt === 'function') {
      window.App.canvasOverviewZoomAt(e.clientX, e.clientY, factor);
    }
  }, { passive: false, capture: true });

  /* ---------- 事件接管（捕获阶段，抢在画布平移/退出总览之前） ---------- */
  document.addEventListener('mousedown', function (e) {
    if (!on || e.button !== 0) return;
    var node = isNode(e.target) ? e.target.closest(NODE_SEL) : null;
    // 输入控件绝不接管（保粘贴/右键/编辑）
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
    /* 【Shift 复制对齐普通模式 v1】总览态按住 Shift 点节点 = 复制该对话框（与普通模式
       Shift+拖拽复制同一语义），副本创建在鼠标按下位置并跟随拖动，松手落库。
       实现走 App.cloneChatBox（普通模式真源），复制后按当前缩放比换算屏幕位移。 */
    if (node && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      var chat = chatOf(node);
      if (chat && window.App && typeof window.App.cloneChatBox === 'function') {
        var clone = null;
        try { clone = window.App.cloneChatBox(chat, e.clientX, e.clientY); } catch (err) { clone = null; }
        if (clone && clone.el) {
          var cEl = clone.el;
          var cSx = e.clientX, cSy = e.clientY, cMoved = false;
          var cOnMove = function (ev) {
            var dx = ev.clientX - cSx, dy = ev.clientY - cSy;
            if (!cMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            cMoved = true;
            var k = scaleOf(cEl);
            cEl.style.left = Math.round(cEl.offsetLeft + (ev.clientX - cSx) / k) + 'px';
            cEl.style.top = Math.round(cEl.offsetTop + (ev.clientY - cSy) / k) + 'px';
            cSx = ev.clientX; cSy = ev.clientY;
          };
          var cOnUp = function () {
            document.removeEventListener('mousemove', cOnMove);
            document.removeEventListener('mouseup', cOnUp);
            if (cMoved) {
              clone.x = cEl.offsetLeft; clone.y = cEl.offsetTop;
              var _saved = false;
              try { if (window.Store && Store.saveChatBox) { Store.saveChatBox(clone, true); _saved = true; } } catch (err2) {}
              if (window.Toast) Toast.show(_saved ? '已复制 1 个对话框' : '已复制（位置保存失败）');
            }
          };
          document.addEventListener('mousemove', cOnMove);
          document.addEventListener('mouseup', cOnUp);
        } else {
          if (window.Toast) Toast.show('复制失败，请重试');
        }
      }
      return;
    }
    if (node) {
      e.preventDefault();
      e.stopPropagation();
      startNodeDrag(e, node);
    } else if (t && t.closest && (t.closest('#zfGrpToolbar') || t.closest('.mo-canvas-dock'))) {
      /* 【建分组修复】总览建分组工具栏 / 缩小整理模式底部浮条不放行到空白判定：
         否则捕获阶段先 clearSel() 清空选中，click 到达「建分组」时 selected() 已为空 → 建组永远无效 */
      return;
    } else if (window.App && typeof window.App._isCanvasBlankTarget === 'function' && window.App._isCanvasBlankTarget(t)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.shiftKey) clearSel();
      startMarquee(e);
    }
  }, true);

  /* ---------- 【点选直选】总览态拦截节点内 click：防止冒泡到应用层
     激活/重排对话导致选中态被冲掉（第一击像被取消、第二击才选中）。
     输入框/按钮/可编辑区放行，不影响正常控件。 ---------- */
  document.addEventListener('click', function (e) {
    if (!on) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
    if (t && t.closest && t.closest('button,input,textarea,select,[contenteditable="true"]')) return;
    var node = isNode(t) ? t.closest(NODE_SEL) : null;
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
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
  /* 【OOM 收口 2026-11-26】isAnswered 原先每 700ms 对全量 history 跑正则，
    * 是总览定时器的最大 CPU/GC 热点。加便宜签名缓存（history 长度+末条长度+任务态），
    * 签名未变直接复用上次结论，避免重复扫描大数组。 */
  var _ansCache = new WeakMap(); // chat对象 -> {sig, val}
  function isAnswered(c) {
    if (!c) return false;
    if (c._taskStatus === 'success') return true;
    var h = c.history || [];
    var last = h[h.length - 1] || {};
    var sig = h.length + '|' + String(last.content || '').length + '|' + (c._taskStatus || '');
    var cached = _ansCache.get(c);
    if (cached && cached.sig === sig) return cached.val;
    var val = false;
    for (var i = 0; i < h.length; i++) {
      var m = h[i];
      if (m && !m._meta && m.role === 'assistant' && String(m.content || '').replace(/<[^>]+>/g, '').trim()) { val = true; break; }
    }
    _ansCache.set(c, { sig: sig, val: val });
    return val;
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
  /* 【统一底色修复 2026-11-21·用户令】缩小整理模式（总览态）下，无论角色皮肤如何，对话框背景必须走统一状态色。
     根因：角色皮肤（theme.js applyToBox）往 chatbox 上写内联 CSS 变量并加 zf-box-skin，
     皮肤的背景规则（含 !important / 更特异选择器）会压过注入的 [data-ov-st] 渐变规则 → 审核师等带皮肤框颜色不统一。
     修法：paintOne 直接在 chatbox 上写内联 background（带 !important，内联 important 优先级最高，必压一切皮肤）；
     clearColors 时清除，退出总览完整还原皮肤。 */
  var OV_ST_BG = {
    /* 【柔和渐变 v2 2026-11-22·用户令】原 4 段渐变中段一条近白浅带+尾部骤深=断层感；
       改为「亮顶→基色→微沉底」3 段同色系顺滑过渡，基色与白字对比不变，观感干净不花 */
    sending: 'linear-gradient(180deg,#ffb54d 0%,#ffa21e 45%,#ef8e00 100%)',
    queued: 'linear-gradient(180deg,#ffdf70 0%,#ffcf45 45%,#f0b32c 100%)',
    answered: 'linear-gradient(180deg,#42dfa0 0%,#1ed282 45%,#12ad6c 100%)',
    error: 'linear-gradient(180deg,#ff8278 0%,#f95c52 45%,#dd3d34 100%)',
    active: 'linear-gradient(180deg,#45a4f4 0%,#1a89e6 45%,#0d6fc2 100%)',
    idle: 'linear-gradient(180deg,rgba(126,176,228,.78) 0%,rgba(98,150,208,.72) 45%,rgba(62,104,160,.82) 100%)'
  };
  /* 【圆角恒定 2026-11-22·用户令】总览卡圆角随摄像机缩放反算（屏显恒定约24px，与标题字号/四球同款思路）；
     按卡宽 22% 收敛兜底，防极小卡变药丸形；clearColors 退出总览时清除内联还原 */
  /* 圆角值（applyOvRadius 单卡路径与 refreshTitleSizes 批量写阶段共用同一公式） */
  function _ovRadiusOf(sc, w) { return Math.min(24 / (sc || 1), (w || 0) * 0.22); }
  function applyOvRadius(el) {
    try {
      var sc = scaleOf(el) || 1;
      var r = _ovRadiusOf(sc, el.offsetWidth || 0);
      if (r > 0) el.style.setProperty('border-radius', r.toFixed(2) + 'px', 'important');
    } catch (e) {}
  }
  function paintOne(el) {
    var st = statusOf(el);
    if (!st) return;
    /* 【黑块根治 2026-11-27·用户令】nodes() 选择器会同时命中外层画布卡片与内层嵌套 .chatbox，
       内层被误判 idle 后写入内联 !important 渐变背景——内联 important 压死一切 CSS 透明规则，
       这就是标题文字后面黑块怎么改 CSS 都去不掉的根因。修法：父链上还有 .chatbox 的一律跳过，
       并主动清掉历史版本误刷的内联背景，让 CSS 透明化规则生效。 */
    if (el.parentElement && el.parentElement.closest('.chatbox')) {
      try { el.style.removeProperty('background'); } catch (eSkip) {}
      return;
    }
    if (el.dataset.ovSt === st) return; // 状态未变不重绘，避免闪烁
    ST_CLASSES.forEach(function (cls) { el.classList.remove(cls); });
    el.dataset.ovSt = st;
    el.classList.add('ov-st-' + st);
    /* 内联 !important 背景：优先级高于任何皮肤规则/内联变量，保证总览底色统一 */
    try { el.style.setProperty('background', OV_ST_BG[st] || OV_ST_BG.idle, 'important'); } catch (e) {}
  }
  function applyColors() {
    if (dragging) return; // P1: 拖动中挂起刷新，松手后下一轮补刷
    if (document.hidden) return; // 【OOM 收口 2026-11-26】页面隐藏时跳过整轮扫描
    var _pf0 = (window.Perf ? performance.now() : 0); // 【P1-4 埋点 策划案 20261122】
    nodes().forEach(function (el) {
      if (el.classList.contains('chatbox')) {
        paintOne(el);
        /* 【分数大字 20261123】流式期间分数实时跟手：签名未变不重算（_ovScoreFill 内守卫） */
        var _scEl = el.querySelector(':scope > .ov-score');
        if (_scEl) _ovScoreFill(el, _scEl);
      }
      // 【OOM 收口】ov-mini 标记只在状态翻转时触碰 DOM，避免每 700ms 无效 toggle
      var wantMini = scaleOf(el) < 0.25;
      if (wantMini !== el.classList.contains('ov-mini')) el.classList.toggle('ov-mini', wantMini);
    });
    if (window.Perf && _pf0) Perf.mark('总览:applyColors', _pf0);
  }
  function clearColors() {
    var els = document.querySelectorAll('.chatbox[data-ov-st]');
    Array.prototype.forEach.call(els, function (el) {
      ST_CLASSES.forEach(function (cls) { el.classList.remove(cls); });
      delete el.dataset.ovSt;
      /* 退出总览：清掉内联 !important 背景/圆角，皮肤/原色完整还原 */
      try { el.style.removeProperty('background'); } catch (e) {}
      try { el.style.removeProperty('border-radius'); } catch (e) {}
    });
  }
  /* 【DECOR_DEPS 根治 20261119】总览装饰节点唯一清单：decorateOne 增删新装饰类时必须同步加到这里，
   * undecorateAll 清理与总览态 CSS 隐藏豁免(:not 链)都由它派生，杜绝两处人工对齐漏同步（曾致 .ov-mile-track/.ov-panel-title 残留 bug 两次）。 */
  var DECOR_DEPS = ['ov-sum', 'ov-badge', 'ov-mile-track', 'ov-panel-title', 'ov-score', 'ov-title'];
  /* 【div 残留根治】总览装饰 div（.ov-sum 摘要行 / .ov-badge 派▼徽章）必须随退出总览彻底移除：
   * 它们是块级元素，残留在真实 .chatbox 里会撑高布局挤错内容，并污染父子位置测量。
   * 严禁在此改成"仅隐藏"——必须 remove。 */
  function undecorateAll() {
    var sel = DECOR_DEPS.map(function (c) { return '.chatbox > .' + c; }).join(',');
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (n) {
      try { n.parentNode.removeChild(n); } catch (e) {}
    });
  }
  /* 【P1-3 策划案 20261122】700→1500ms：总览态逐窗 dataset 读取的轮询成本减半；
     状态底色兜底扫描最坏延迟 1.5s（paintOne 仍有 dataset.ovSt 翻转守卫，未变不触碰 DOM）。 */
  /* 【选中置顶·兜底】选中期间新冒出的节点（派出子窗、Shift 复制件等）拿到更高的内联 z 会盖住选中项——
     定时重算把选中项重新抬到其上（值未变不写 DOM）；挂在 applyColors 之外，不受其拖动中/页面隐藏的早退影响 */
  function startStTimer() { stopStTimer(); stTimer = setInterval(function () { applyColors(); raiseSel(selOrder); }, 1500); }
  function stopStTimer() { if (stTimer) { clearInterval(stTimer); stTimer = null; } }

  /* ---------- 总览开关联动 ---------- */
  /* 【悬停完整标题 v3】总览态鼠标搭上节点 → 浮出完整标题 tooltip（纯 pointerover，无轮询） */
  var _tip = null;
  function tipShow(el, x, y) { tipHide(); return; } /* 【用户令 2026-11-27·去黑框】悬停黑色圆角 tooltip 整体停用，不再弹出 */
  function tipHide() { if (_tip) _tip.style.display = 'none'; }
  document.addEventListener('pointerover', function (e) {
    if (!on) { tipHide(); return; }
    var el = e.target && e.target.closest ? e.target.closest(NODE_SEL) : null;
    if (el) tipShow(el, e.clientX, e.clientY); else tipHide();
  });
  document.addEventListener('pointerdown', tipHide);
  document.addEventListener('scroll', tipHide, true);

  /* 【字号联动修复】标题字号原在进入总览那一刻按当时 scale 一次性写死，
     之后滚轮继续缩放摄像机字号不重算 → 滚小后文字小到看不见。
     补：总览态监听画布滚轮/缩放，实时按 11/新scale 重算所有卡片标题字号。 */
  /* 【策划案 20261123·三种模式积累性修复 #14】改三段批量读写，公式逐条不变。
     旧写法逐卡「读缩放比 → 写字号 → 读缩放比 → 写圆角 → 再读 → 写」，每张卡 3~4 次强制同步布局，
     且每个滚轮事件同步跑完、之后 800ms 内每 80ms 再跑一轮；卡越多、滚轮分辨率越高越卡。
     现：读阶段①（全部卡的缩放比/卡宽，中间不夹写）→ 写字号/圆角/四球 →
         读阶段②（新字号下的标题下沿）→ 写分数位置。整轮强制布局从 3~4×N 降到至多 3 次。 */
  function refreshTitleSizes() {
    if (!on) return;
    var ttls = document.querySelectorAll('.chatbox > .ov-panel-title');
    var items = [], i;
    for (i = 0; i < ttls.length; i++) {
      var ttl = ttls[i], el = ttl.parentNode, sc = 1, w = 0, r;
      try { r = el.getBoundingClientRect(); w = el.offsetWidth || 0; sc = (w > 0 && r.width > 0) ? r.width / w : 1; } catch (e) { sc = 1; }
      items.push({ ttl: ttl, el: el, sc: sc || 1, w: w });
    }
    items.forEach(function (it) {
      /* 【用户令 20261121】屏显恒定16px（14~18px区间），无论缩放多少 */
      try { it.ttl.style.fontSize = (16 / it.sc) + 'px'; } catch (e) {}
      /* 【圆角恒定 2026-11-22】随缩放反算，屏显恒定约24px */
      try { var rr = _ovRadiusOf(it.sc, it.w); if (rr > 0) it.el.style.setProperty('border-radius', rr.toFixed(2) + 'px', 'important'); } catch (e) {}
      /* 【用户令 20261121·四球跟随】四球与标题一样随摄像机缩放反算，屏显尺寸恒定 */
      try {
        var tr = it.el.querySelector(':scope > .ov-mile-track');
        if (tr) {
          tr.style.transformOrigin = 'center top'; /* 居中+缩放合并写：scale 先绕盒中心缩（水平中心不动），再 translateX(-50%) 把中心带到 left:50% 处 → 居中且屏显尺寸恒定 */
          tr.style.transform = 'translateX(-50%) scale(' + (1 / it.sc) + ')';
          it.el.style.setProperty('--ov-ball', (18 / it.sc) + 'px'); /* 设在 chatbox 上，标题 top calc 才能读到 */
        }
      } catch (eBall) {}
    });
    /* 【分数大字 20261123】随缩放联动：字号/紧贴标题下沿的定位都按新 scale 反算。
       标题下沿要在新字号落定后再量：先一轮纯读，再一轮纯写（.ov-score 是绝对定位，不影响标题布局） */
    items.forEach(function (it) {
      it.scoreEl = null; it.scoreTop = 0;
      try {
        var scEl = it.el.querySelector(':scope > .ov-score');
        if (!scEl) return;
        it.scoreEl = scEl;
        it.scoreTop = _ovScoreTop(it.el, it.ttl, it.sc);
      } catch (e) {}
    });
    items.forEach(function (it) {
      if (!it.scoreEl) return;
      try { it.scoreEl.style.fontSize = (48 / it.sc) + 'px'; it.scoreEl.style.top = it.scoreTop + 'px'; } catch (e) {}
    });
  }
  /* 滚轮捕获阶段监听（画布缩放走 wheel），缩放动画持续期间连刷（摄像机缓动） */
  var _wheelRefreshTimer = null;
  function kickWheelRefresh() {
    refreshTitleSizes();
    if (_wheelRefreshTimer) clearTimeout(_wheelRefreshTimer);
    var t0 = Date.now();
    _wheelRefreshTimer = setInterval(function () {
      refreshTitleSizes();
      if (Date.now() - t0 > 800) { clearInterval(_wheelRefreshTimer); _wheelRefreshTimer = null; }
    }, 80);
  }
  document.addEventListener('wheel', function () { if (on) kickWheelRefresh(); }, { capture: true, passive: true });

  window.addEventListener('wb-canvas-change', function (e) {
    on = !!(e.detail && e.detail.on);
    document.body.classList.toggle('zf-overview-mode', on);
    if (on) { clearSel(); showBanner(); applyColors(); startStTimer(); injectOvCss(); stampDelays(); refreshTitleSizes(); kickWheelRefresh(); /* 【初始即刷新】进总览时摄像机还在向缩放位缓动，单次刷新会写死旧 scale；自动跑与滚轮同款 800ms 连刷，动画结束后字号/球尺寸即正确，无需先滚一下 */ }
    else { dragging = false; clearSel(); hideBanner(); stopStTimer(); clearColors(); undecorateAll(); if (_wheelRefreshTimer) { clearInterval(_wheelRefreshTimer); _wheelRefreshTimer = null; } }
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
      /* 【选中置顶·用户令 2026-11-23】选中节点层级高于全部未选中节点：z 取 raiseSel 写在节点上的 --ov-z-top（见 setSel 上方）。
         !important 用于压过内联 z-index（作者 !important > 内联普通声明）——内联值不动，落库存的仍是原层级，
         摘掉 .ov-selected 即还原。兜底值 99999：变量缺失时宁可偏高（要求就是"选中的在上面"）。 */
      'body.zf-overview-mode .ov-selected{z-index:var(--ov-z-top,99999) !important;}',
      /* 【用户令 2026-11-27·黑块根因修复】.chatbox::before 伪元素铺 var(--bg-card,#161625) 深色底（style-chatbox.css L7-23），
         卡片在画布上带 transform 形成层叠上下文，负 z-index 的 ::before 实际画在状态色之上 → 文字后面黑色区域。
         总览态彻底禁用该伪元素，文字白色直接压在状态色背景上。 */
      /* 【快速整理面板 v1·用户令】总览态卡片只画：框+填充色+标题+四球，内容全隐（性能快）；豁免清单由 DECOR_DEPS 派生，单一真源 */
      'body.zf-overview-mode .chatbox > ' + DECOR_DEPS.map(function (c) { return ':not(.' + c + ')'; }).join('') + '{visibility:hidden !important;}',
      'body.zf-overview-mode .chatbox::before{display:none !important;content:none !important;background:none !important;}', /* 黑块根因修复 */
      /* 【用户令 2026-11-27·修正 v2】上一轮误删的是"标题背景色"，卡片渐变背景要保留（背景渐变保留、内容不渲染不变）；标题自身显式去背景+透明 */
      'body.zf-overview-mode .chatbox{box-shadow:none !important;border-radius:28px !important;}', /* 【圆角恒定 2026-11-22·用户令】refreshTitleSizes/decorateOne 会按摄像机缩放反算写内联圆角（屏显恒定约24px），此为 JS 未跑到时的兜底 */
      /* 【去文字底框 2026-11-22·用户令】灰黑圆角框根因实锤（实机 elementsFromPoint+规则审计）：皮肤主题(theme.js zf-style-glow等)的全局规则
         [class*="panel"]:not(.mo-panel)...×4 把类名含 "panel" 的 .ov-panel-title 误当面板命中，铺上 rgba(42,42,44,.78)!important 深底+16px圆角；
         其 :not 链把特异性抬到 (0,6,0)，压过本文件原 (0,3,1) 的标题去背景规则——这就是改了几轮 CSS 黑框一直在的原因。
         修法：类名重复 8 次把本规则抬到 (0,10,1)，任何皮肤 [class*="panel"] 通配规则都无法再压回；border/padding/radius 一并清零防皮肤补别的框。 */
      'body.zf-overview-mode .chatbox > .ov-panel-title.ov-panel-title.ov-panel-title.ov-panel-title.ov-panel-title.ov-panel-title.ov-panel-title.ov-panel-title{background:none !important;background-color:transparent !important;background-image:none !important;border:0 !important;border-radius:0 !important;box-shadow:none !important;padding:0 !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;filter:none !important;}',
      /* 颜色跟随 i导航 STATUS_COLORS(app-minimap.js)：sending橙#ffa500 / queued黄#ffd23c / answered绿#1ed282 / error红#ff5555 / active蓝#0984e3 */
      /* 【柔和渐变 v2 2026-11-22·用户令】与 paintOne 内联 OV_ST_BG 同款「亮顶→基色→微沉底」3 段渐变；
         内联 !important 优先，此处为 CSS 兜底保持一致（原先中段近白浅带断层已去除） */
      'body.zf-overview-mode .chatbox[data-ov-st="sending"]{background:linear-gradient(180deg,#ffb54d 0%,#ffa21e 45%,#ef8e00 100%) !important;}',
      'body.zf-overview-mode .chatbox[data-ov-st="queued"]{background:linear-gradient(180deg,#ffdf70 0%,#ffcf45 45%,#f0b32c 100%) !important;}',
      'body.zf-overview-mode .chatbox[data-ov-st="answered"]{background:linear-gradient(180deg,#42dfa0 0%,#1ed282 45%,#12ad6c 100%) !important;}',
      'body.zf-overview-mode .chatbox[data-ov-st="error"]{background:linear-gradient(180deg,#ff8278 0%,#f95c52 45%,#dd3d34 100%) !important;}',
      'body.zf-overview-mode .chatbox[data-ov-st="active"]{background:linear-gradient(180deg,#45a4f4 0%,#1a89e6 45%,#0d6fc2 100%) !important;}',
      /* 【小队收口裁决 2026-11-22·采纳UI师中优先级项】浅底(queued黄/idle浅蓝)白字对比度<4.5:1不达WCAG，改为深色文字；深底卡仍白字 */
      /* 【用户令·标题统一白色】原浅底深字特例已移除：所有状态卡标题一律白字 */
      'body.zf-overview-mode .chatbox .ov-panel-title{position:absolute;left:3%;top:calc(4% + var(--ov-ball,18px) + 1%);right:3%;z-index:8;font-size:64px;font-weight:700;letter-spacing:.02em;line-height:1.35;color:#ffffff;white-space:normal;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;pointer-events:none;text-shadow:none;background:none !important;}', /* 【用户令 2026-11-27·v5】定位改百分比；top 与四球底沿联动；文字后面无任何背景 */
      'body.zf-overview-mode .chatbox{padding:3% !important;}', /* 【用户令】卡片内边距改百分比，缩放时等比好看 */ /* 【用户令 2026-11-27·v4】top 与四球底沿联动（不再写死30px，四球让开不遮挡）；【用户令】文字后面的黑色背景(text-shadow黑晕)去掉 */
      'body.zf-overview-mode .chatbox .ov-mile-track{top:6px !important;left:50% !important;z-index:9;}', /* 【用户令·四球置顶】四球固定在卡片最顶部 【用户令 2026-12·四球居中】水平居中 【修复 20261123·缩放跟随恢复】原 transform:translateX(-50%) !important 会压死 JS 每帧写入的内联 scale 缩放（!important > 内联样式），导致四球不再跟随摄像机远近缩放；现 transform 完全交由 refreshTitleSizes 内联写入 translateX(-50%) scale(1/sc) */
      /* 【小队收口裁决 2026-11-22·采纳UI师高优先级项】原 L597-603 状态色条组与本行禁用规则自相矛盾：
         [data-ov-st]::before 特异性(0,2,1)压过 .chatbox::before(0,2,0)，content:none 被架空。
         因卡片背景已纯色化且色条颜色与背景完全相同（色条本就不可见），整组删除，矛盾消除。 */

      'body.zf-overview-mode .chatbox .ov-sum{display:none !important;}', /* 【用户令②】总览卡片零内容：摘要一律不显示（含普通/mini 态），标题+四球足够 */
      'body.zf-overview-mode .chatbox .ov-badge{display:none !important;}', /* 【用户令】总览态隐藏小圈徽标（idle空心圈等），四球取代 */
      'body.zf-overview-mode .chatbox .ov-mile-track{display:flex !important;}',
      'body.zf-overview-mode .chatbox.ov-mini .ov-badge{display:none !important;}', /* 【用户令】mini 态同样隐藏小圈 */
      /* 【分数大字 20261123·用户令】对话含分数 → 标题下方居中大字：白色加粗，屏显恒定约48px（JS 按 scale 反算写内联 font-size/top，紧贴标题下沿）；「分」尾缀小号；无分数时 JS 置 display:none 不占位 */
      'body.zf-overview-mode .chatbox > .ov-score{position:absolute;left:0;right:0;z-index:8;text-align:center;color:#ffffff;font-weight:800;line-height:1.05;letter-spacing:.02em;pointer-events:none;display:none;background:none !important;border:0 !important;box-shadow:none !important;}',
      'body.zf-overview-mode .chatbox > .ov-score::after{content:"分";font-size:.34em;font-weight:700;margin-left:.12em;opacity:.92;}',
      'body.zf-overview-mode .chatbox.ov-mini .ov-score{display:none !important;}', /* 【极小缩略卡】48px 大字放不下，mini 态不显分数（与 mini 隐藏小圈同口径） */
      'body.zf-overview-mode .chatbox button{position:relative;}',
      'body.zf-overview-mode .chatbox button::after{content:"";position:absolute;inset:-4px;}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function lastMsg(c) {
    if (!c || !c.history) return '';
    for (var i = c.history.length - 1; i >= 0; i--) {
      var m = c.history[i];
      if (m && !m._meta && String(_ovMsgText(m) || '').trim()) return _ovMsgText(m).replace(/<[^>]+>/g, '').trim().slice(0, 40);
    }
    return '';
  }
  /* 【图片标题修复 2026-11-22·用户令】数组型 content（含识图图片 image_url parts）直接 String() 会变 "[object Object]"，
     统一提取 text 部分；纯图片消息返回空串，由调用方跳过取下一条（跳过图片显示真标题文字） */
  function _ovMsgText(m) {
    var ct = m && m.content;
    if (Array.isArray(ct)) {
      var _parts = [];
      ct.forEach(function (_p) {
        var _t = (_p && _p.type === 'text' && typeof _p.text === 'string') ? _p.text
               : (_p && typeof _p === 'string') ? _p : '';
        if (_t) _parts.push(_t);
      });
      return _parts.join(' ');
    }
    return typeof ct === 'string' ? ct : (ct && typeof ct.text === 'string' ? ct.text : '');
  }
  var ST_ICO = { sending: '\u21bb', queued: '\u2026', answered: '\u2713', error: '\u2715', active: '\u25cf', idle: '\u25cb' };
  /* ---------- 【子对话只显角色名 20261123·用户令】垃圾师这类子级别对话，总览卡标题只显示角色名，
   * 不再回退显示整段任务提示词（用户第一条消息=素材包全文，截图实锤）。
   * 角色名解析优先级（审核修正 20261123）：
   *   ⓪ el._swarmLabel（施工队·瓦工/专家团·张三——收口署名真源，与 right-queue 成员名同口径，保工种/专家名不丢）
   *   ① 一次性角色卡 zf_role_chat_<id>（垃圾师/插件师/律师等派出时写入 window 角色，最准）
   *   ② ZFChildRel.childKeyOf 固定子对话角色（策划师/审核员/施工队/优化师/安全师/自定义/反驳师）+ 总结师
   *   ③ 窗头 .title 文本清洗（去 emoji 前缀 / 「·」尾缀 / #序号）
   * 都取不到 → 回退旧正则；主对话（非子级）仍显示用户第一条消息 realTitle。
   * 门槛=ZFChildRel.isSub 宽口径 + 专家团（_isExpertChat，不在 isSub 里）+ 挂 _swarmLabel 的窗 ---------- */
  function _ovCleanRoleLabel(s) {
    var t = String(s || '').replace(/<[^>]+>/g, '').trim();
    t = t.replace(/^[^\u4e00-\u9fa5A-Za-z0-9【\[]+/, ''); /* 头部 emoji/图标前缀（🗑️ 垃圾师→垃圾师） */
    t = t.split('·')[0].trim();             /* 「策划师 · 策划」→「策划师」 */
    t = t.replace(/#[0-9]+.*$/, '').trim(); /* 「策划师#2 · 视角」→「策划师」 */
    return t;
  }
  /* 【子窗门槛·单一真源】宽口径 ZFChildRel.isSub + 专家团（_isExpertChat，不在 isSub 里）+ 挂 _swarmLabel 的窗。
     标题角色收敛与分数大字共用此门槛——主对话（非子窗）标题显首条消息、永不显分数 */
  function _ovIsChildGate(el) {
    try { return !!(el && (el._swarmLabel || el._isExpertChat ||
      (window.ZFChildRel && ZFChildRel.isSub && ZFChildRel.isSub(el)))); } catch (eGate) { return false; }
  }
  function _ovSubRoleName(el, c) {
    try {
      if (!_ovIsChildGate(el)) return '';
      /* ⓪收口署名真源（施工队·瓦工/专家团·张三） */
      if (el._swarmLabel) return String(el._swarmLabel).trim();
      /* ①角色卡 */
      if (c && c.id != null) {
        try {
          var _rc = JSON.parse(localStorage.getItem('zf_role_chat_' + c.id) || 'null');
          if (_rc && _rc.name) return String(_rc.name).trim();
        } catch (eRc) {}
      }
      /* ②固定角色表 */
      if (el._isSummarizerChat) return '总结师';
      if (window.ZFChildRel && ZFChildRel.childKeyOf) {
        var _ck = ZFChildRel.childKeyOf(el);
        if (_ck && _ck.key) return _ck.key;
      }
      /* ③窗头标题清洗 */
      var _hd = el.querySelector('.title');
      var _lb = _ovCleanRoleLabel(_hd && _hd.textContent);
      if (_lb) return _lb;
    } catch (eSub) {}
    return '';
  }
  /* ---------- 【分数大字 20261123·用户令】对话里有分数 → 标题下方居中大字显示。
   * 真源：ZFChildRel.scoreOf（chatbox-child-rels.js，最后一条 assistant 向前抓真实分数）。
   * 流式期间分数会变：applyColors 定时调 _ovScoreFill，签名未变不重算不触 DOM（OOM 同款守卫）。
   * 【主对话不显分数 20261123·用户令】子窗分数更新后主对话分数不会跟着更新（scoreOf 只解析本窗
   * history/DOM，主对话正文里回显的旧分反而被兜底正则抓出来钉死）→ 主对话干脆永不显分数 ---------- */
  var _scoreSig = new WeakMap(); /* chat对象 -> history签名 */
  function _ovScoreSig(c) {
    var h = (c && c.history) || [];
    var last = h[h.length - 1] || {};
    return h.length + '|' + String(_ovMsgText(last) || '').length + '|' + (c._taskStatus || '');
  }
  function _ovScoreFill(el, scEl) {
    var v = '';
    /* 【主对话不显分数】非子窗一律隐藏并清空（防历史版本残留节点复活），签名也不记（主对话永不参算） */
    if (!_ovIsChildGate(el)) {
      if (scEl.dataset.v) { scEl.dataset.v = ''; scEl.textContent = ''; scEl.style.display = 'none'; }
      return;
    }
    try {
      var c = chatOf(el);
      if (c && window.ZFChildRel && ZFChildRel.scoreOf) {
        /* 【策划案 20261123·三种模式积累性修复 #15】签名守卫真正生效：签名未变直接返回，不调 scoreOf
           （它从末条向前扫全部历史，扫不到时还把整张卡的 textContent 串起来跑正则；旧代码 _scoreSig 只写不读，
           applyColors 每 1.5 秒对每张子对话卡全量重算）。装饰节点刚被 undecorateAll 重建时 dataset.v 尚未
           初始化，此时不走守卫，保证重新进总览能画出来。 */
        var sig = _ovScoreSig(c);
        if (scEl.dataset.v !== undefined && _scoreSig.get(c) === sig) return;
        _scoreSig.set(c, sig);
        var n = ZFChildRel.scoreOf(c);
        if (n != null) v = String(n);
      }
    } catch (eSc) {}
    if (scEl.dataset.v !== v) {
      scEl.dataset.v = v;
      scEl.textContent = v;
      /* 【显式 block 20261123】不能用 ''：置空=清除内联值，会回落到 CSS 规则里的默认 display:none（实机 headless 截图抓获） */
      scEl.style.display = v ? 'block' : 'none';
    }
  }
  /* 分数排版：紧贴标题下沿居中（标题行数可变，按 offsetHeight 实测定位）；
     字号/间距按缩放比反算，屏显恒定约 48px；卡太矮时兜底不溢出 */
  /* 分数纵向定位值：纯读（调用前不能有未落地的写，否则逐卡触发强制布局） */
  function _ovScoreTop(el, ttl, k) {
    var top = 0;
    if (ttl) top = ttl.offsetTop + ttl.offsetHeight + Math.round(10 / k);
    if (el.offsetHeight) top = Math.min(top, el.offsetHeight - Math.round(58 / k));
    return top < 0 ? 0 : top;
  }
  /* 单卡路径（decorateOne 新卡/展开组补装饰）；k 为已知缩放比，缺省时现量 */
  function _ovScoreLayout(el, k) {
    try {
      var scEl = el.querySelector(':scope > .ov-score');
      if (!scEl) return;
      k = k || scaleOf(el) || 1;
      var top = _ovScoreTop(el, el.querySelector(':scope > .ov-panel-title'), k);
      scEl.style.fontSize = (48 / k) + 'px';
      scEl.style.top = top + 'px';
    } catch (eLay) {}
  }
  function decorateOne(el) {
    if (!el.classList.contains('chatbox')) return;
    var sum = el.querySelector(':scope > .ov-sum');
    if (!sum) { sum = document.createElement('div'); sum.className = 'ov-sum'; el.appendChild(sum); }
    sum.textContent = lastMsg(chatOf(el)) || '\uff08\u7a7a\u5bf9\u8bdd\uff09';
    var st = el.dataset.ovSt || 'idle';
    /* 【快速整理面板 v1】卡片标题：仅标题文本，无内容（快） */
    var ttl = el.querySelector(':scope > .ov-panel-title');
    if (!ttl) { ttl = document.createElement('div'); ttl.className = 'ov-panel-title'; el.appendChild(ttl); }
    /* 【用户令·真标题】优先用对话里用户真正输入的第一条消息作为标题 */
    var realTitle = '';
    try {
      var cT = chatOf(el);
      var hT = (cT && cT.history) || [];
      for (var iT = 0; iT < hT.length; iT++) {
        var mT = hT[iT];
        if (mT && !mT._meta && mT.role === 'user' && String(_ovMsgText(mT) || '').trim()) {
          realTitle = _ovMsgText(mT).replace(/<[^>]+>/g, '').trim().slice(0, 40); break;
        }
      }
    } catch (eTitle) {}
    /* 【用户令 2026-11】子对话（策划师/审核师/推进师等）不显示具体标题，只显示角色名 */
    var _ttlText = el.getAttribute('data-ov-tip') || (el.querySelector('.chat-title,.node-title,.chatbox-title') || {}).textContent || '（未命名）';
    try {
      /* 【子对话只显角色名 20261123·用户令】角色卡/固定角色表/窗头标题三源解析优先（垃圾师等自定义派出全覆盖），
         解析失败再走旧正则兜底（主对话首条消息提到某师时仍按旧口径收敛角色名） */
      var _subRole = _ovSubRoleName(el, chatOf(el));
      if (_subRole) {
        _ttlText = _subRole;
        el.dataset.ovRole = _subRole;
      } else {
        var _roleRe = /(策划师|审核师|审核员|推进师|总结师|施工队|协作队|质检员|优化师|反驳师|进化师|突破师|涌现师|安全师|验证师|代码师|自定义)/;
        /* 【v2 扩大识别源】子对话标题常在派单消息里而非面板 tip：把「用户第一条消息 realTitle + 对话前200字」也纳入角色识别 */
        var _firstMsg = '';
        try {
          var _cR = chatOf(el); var _hR = (_cR && _cR.history) || [];
          for (var _iR = 0; _iR < _hR.length; _iR++) { var _mR = _hR[_iR];
            if (_mR && !_mR._meta && _mR.role === 'user' && String(_ovMsgText(_mR) || '').trim()) { _firstMsg = _ovMsgText(_mR).replace(/<[^>]+>/g, ''); break; }
          }
        } catch (eR2) {}
        var _haystack = String(el.dataset.title || '') + ' ' + _ttlText + ' ' + realTitle + ' ' + _firstMsg.slice(0, 200);
        var _mTitle = _haystack.match(_roleRe);
        if (_mTitle) { _ttlText = _mTitle[1]; el.dataset.ovRole = _mTitle[1]; }
        else { delete el.dataset.ovRole; }
      }
    } catch (eRole) {}
    ttl.textContent = realTitle && !el.dataset.ovRole ? realTitle : _ttlText;
    /* 【用户令 v3】标题字号跟随摄像机缩放：11px / scale，屏显恒定约 11px，随画布放大缩小自适应 */
    try { ttl.style.fontSize = (16 / (scaleOf(el) || 1)) + 'px'; } catch (eScale) {} /* 【用户令 20261121】屏显恒定16px（14~18px区间），无论缩放多少 */
    applyOvRadius(el); /* 【圆角恒定 2026-11-22】新卡/展开组补装饰时也按当时缩放写圆角，不必等滚轮 */
    var bd = el.querySelector(':scope > .ov-badge');
    if (!bd) {
      bd = document.createElement('div'); bd.className = 'ov-badge';
      bd.addEventListener('click', function (ev) { ev.stopPropagation(); if (window.App && window.App.canvasOverviewToggle) window.App.canvasOverviewToggle(); });
      el.appendChild(bd);
    }
    bd.textContent = (ST_ICO[st] || '') + ' \u6d3e\u25be';
    // 【四球替换 v1】把 header 内四球系统克隆到卡片左上角（替代废弃的状态徽标球）
    // 数据真源仍是 chatbox-mile-balls.js 渲染的 .zf-mile-track，此处只做视觉镜像，不重复解析
    try {
      var hdr = el.querySelector('.chatbox-header');
      var srcTrack = hdr ? hdr.querySelector('.zf-mile-track') : null;
      var ovTrack = el.querySelector(':scope > .ov-mile-track');
      if (srcTrack) {
        if (!ovTrack) { ovTrack = document.createElement('div'); ovTrack.className = 'ov-mile-track'; el.appendChild(ovTrack); }
        ovTrack.innerHTML = srcTrack.innerHTML;
        // 克隆副本屏蔽呼吸动画/悬停缩放，纯静态指示（降低总览态渲染开销）
        ovTrack.querySelectorAll('.zf-mile-ball').forEach(function (bEl) {
          bEl.style.animation = 'none'; bEl.style.pointerEvents = 'none'; bEl.style.cursor = 'default';
        });
      } else {
        /* 【用户令 v2】header 无四球（如子对话被移除 track）时，画 4 颗常驻暗球占位（策划/进度/审核/总结），不再留空只剩小圈 */
        if (!ovTrack) { ovTrack = document.createElement('div'); ovTrack.className = 'ov-mile-track'; el.appendChild(ovTrack); }
        if (!ovTrack.children.length) {
          ['plan','progress','audit','summary'].forEach(function (k) {
            var bEl = document.createElement('div');
            bEl.className = 'zf-mile-ball zf-mile-' + k;
            bEl.setAttribute('data-state', 'hidden');
            ovTrack.appendChild(bEl);
          });
        }
      }
    } catch (eMile) {}
    /* 【分数大字 20261123·用户令】对话含分数 → 标题下方居中大字；无分数 display:none 不占位。
       内层嵌套卡不画（与 paintOne 父链守卫同口径，防黑块类复发）。
       【主对话不显分数 20261123·用户令】只有子窗（_ovIsChildGate）画 .ov-score；
       主对话不留节点，历史版本已画上的残留就地移除 */
    if (!(el.parentElement && el.parentElement.closest('.chatbox'))) {
      if (_ovIsChildGate(el)) {
        var _scEl = el.querySelector(':scope > .ov-score');
        if (!_scEl) { _scEl = document.createElement('div'); _scEl.className = 'ov-score'; el.appendChild(_scEl); }
        _ovScoreFill(el, _scEl);
        _ovScoreLayout(el);
      } else {
        var _scOld = el.querySelector(':scope > .ov-score');
        if (_scOld) { try { _scOld.parentNode.removeChild(_scOld); } catch (eScRm) {} }
      }
    }
  }
  function stampDelays() {
    var _pf0 = (window.Perf ? performance.now() : 0); // 【P1-4 埋点 策划案 20261122】含 decorateOne 逐窗装饰成本
    nodes().forEach(function (el, i) {
      el.style.setProperty('--ov-delay', Math.min(i * 8, 400) + 'ms');
      decorateOne(el);
    });
    if (window.Perf && _pf0) Perf.mark('总览:stampDecor', _pf0);
  }

  window.ZFCanvasOverview = { selected: function () { return sel.slice(); }, clear: clearSel };
  /* 【分组展开标题修复 20261120】重新给可见节点补装饰（decorateOne 含 .ov-panel-title 标题）。
     折叠组退出总览再进入时，display:none 成员不会被装饰 → 展开后没标题；expandGroup 调此函数恢复 */
  window.ZFCanvasOverview.refreshDecor = function () {
    if (!on) return;
    Array.prototype.forEach.call(document.querySelectorAll('.chatbox'), function (el) {
      if (el.style.display === 'none') return;
      decorateOne(el);
    });
  };
  /* 【总览期新建框装饰 20261123·用户令】总览(缩小整理)态期间新建的对话框（快速创建条/双击画布/批量等任意路径）
     此前装饰只在进入总览时 stampDecor 一次性刷，新建框永远等不到 .ov-panel-title/.ov-mile-track，
     又被总览 CSS「非装饰子节点全部 visibility:hidden」藏掉真实内容 → 表现为光秃秃一个色块（无标题无四球）。
     修：MutationObserver 监听总览期新增 .chatbox，立即补 paintOne 底色 + decorateOne 标题/四球 + 字号/圆角缩放。
     嵌套内层卡跳过（与 paintOne 的父链守卫同口径）；header 四球源若异步晚到，延时 900ms 补一次重克隆。 */
  (function () {
    var mo = new MutationObserver(function (muts) {
      if (!on) return;
      var added = [];
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (!n || n.nodeType !== 1 || !n.querySelectorAll) return;
          if (n.classList && n.classList.contains('chatbox') && !(n.parentElement && n.parentElement.closest('.chatbox'))) added.push(n);
          Array.prototype.forEach.call(n.querySelectorAll('.chatbox'), function (inner) {
            if (!(inner.parentElement && inner.parentElement.closest('.chatbox'))) added.push(inner);
          });
        });
      });
      if (!added.length) return;
      added.forEach(function (el) {
        paintOne(el);
        decorateOne(el);
        /* header 四球源(.zf-mile-track)由 chatbox-mile-balls.js 异步渲染：当时还没有就延后补一次克隆 */
        try {
          var hdr = el.querySelector('.chatbox-header');
          if (!(hdr && hdr.querySelector('.zf-mile-track'))) {
            setTimeout(function () {
              if (!on) return;
              if (el.isConnected && !(el.parentElement && el.parentElement.closest('.chatbox'))) decorateOne(el);
            }, 900);
          }
        } catch (eLate) {}
      });
      raiseSel(selOrder); // 【选中置顶】新框的 z = ++zCounter，恰好落在选中项抬升区下沿，立即把选中项重新抬到其上（定时器是其余节点类型的兜底）
      refreshTitleSizes();
    });
    try {
      var host = document.getElementById('canvasContent') || document.getElementById('canvasArea') || document.body;
      mo.observe(host, { childList: true, subtree: true });
    } catch (eObs) {}
  })();
  /* 启动兜底：清掉历史版本遗留的总览装饰 div（正常 DOM 刷新即重置，此为保险） */
  undecorateAll();
})();
