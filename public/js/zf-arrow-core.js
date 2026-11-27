/* ============================================================
 * zf-arrow-core.js —— 全队箭头公共内核 v1.2
 * 职责（所有箭头壳文件共用，禁止各壳再自造）：
 *   1. SVG 箭头绘制（杆 + 三角头 + 反旋转徽标胶囊）
 *   2. 统一 rAF 跟随循环（合帧：全队箭头一个 tick，空载停机防掉帧）
 *   3. 尺寸分级注册表：main(大) / sub(小) / swarm(总箭头) / manual(手动)
 *   4. z-index 收敛枚举（BASE/HOVER 只在这里定义）
 *   5. 熔断型持久化恢复：对端 chatbox 已删 → 直接清档终止，杜绝无限恢复循环（thinker v27/v28 OOM 实锤）
 *   6. 悬停提升互斥：同一时刻只有一只箭头处于 HOVER 层
 *   7. 类型注册表 ZFArrow.registerType：新角色零内核改动接入
 * 用法：
 *   ZFArrow.create({ srcId, dstId, type, statuses, getStatus,
 *                    onClick, noteInput, persistKey, restore, onChange })
 * 历史教训已内建：
 *   - 【空载停机】pairs.length===0 时不再续帧（race L636 同款语义）
 *   - 【缩放保底】canvasScale 夹取 0.35~1，缩放帧不清 scale 防回跳
 *   - 【角度插值】±180 归一化防绕圈跳变
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFArrow) return; /* 防热更新重复注册 */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- 类型注册表（尺寸分级核心） ---------- */
  var TYPES = {
    /* main：主对话派出的角色箭头（大号） */
    main:   { w: 240, h: 72, stem: 162, headX: 162, headTip: 234, headHalf: 30,
              stroke: 9, badgeFs: 18, badgeH: 30, badgeRy: 15, zBase: 5000, zHover: 9300 },
    /* sub：主对话 ↔ 子对话之间的小箭头（约 main 的 60%） */
    sub:    { w: 144, h: 44, stem: 96,  headX: 96,  headTip: 140, headHalf: 18,
              stroke: 5, badgeFs: 12, badgeH: 20, badgeRy: 10, zBase: 5000, zHover: 9300 },
    /* swarm：1:N 蜂群总箭头（大号 + 粗杆） */
    swarm:  { w: 240, h: 72, stem: 162, headX: 162, headTip: 234, headHalf: 30,
              stroke: 11, badgeFs: 18, badgeH: 30, badgeRy: 15, zBase: 5000, zHover: 9300 },
    /* manual：画布手动拖拽箭头（中号）。注：app-canvas-arrows.js 为画布连线层非箭头体系，未迁内核，此型作为注册表预留档位保留 */
    manual: { w: 190, h: 56, stem: 128, headX: 128, headTip: 186, headHalf: 24,
              stroke: 7, badgeFs: 15, badgeH: 25, badgeRy: 12, zBase: 4000, zHover: 9300 }
  };
  var Z_BASE = 5000, Z_HOVER = 9300;
  var _hovered = null; /* 悬停互斥：同一时刻只有一只箭头在 HOVER 层 */

  function registerType(name, cfg) {
    /* 允许新角色/协议注入新尺寸类型（_isTeam_ 协议化接入点），零内核改动 */
    TYPES[name] = Object.assign({ zBase: Z_BASE, zHover: Z_HOVER }, TYPES.main, cfg);
  }

  /* ---------- 全部箭头实例（内核唯一清单，统一循环驱动） ---------- */
  var instances = []; /* [{ cfg, el, svg, badge, noteEl, pair data..., _lx,_ly,_ang,_tf }] */

  function scaleOf() {
    try {
      return (window.App && App.canvasScale) ? Math.max(0.35, Math.min(1, App.canvasScale())) : 1;
    } catch (e) { return 1; }
  }
  function centerOf(chat) {
    var r = chat.el.getBoundingClientRect();
    /* 兜底：元素不可见/宽高为 0（如总结框已关闭但连线未清档）→ 返回 null，
       tick 里据此跳过定位，避免箭头被钉在 (0,0) 左上角 */
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ---------- SVG 构造（杆 + 头 + 徽标，徽标胶囊居中线段中点） ---------- */
  function buildSvg(t, colors, badgeInit, extraDefs) {
    var cx = (6 + t.stem) / 2; /* 徽标中心 = 杆（线段）正中点 */
    var svg = '<svg width="' + t.w + '" height="' + t.h + '" viewBox="0 0 ' + t.w + ' ' + t.h +
      '" xmlns="' + SVG_NS + '" style="overflow:visible">' +
      '<line class="zfa-line" x1="6" y1="' + (t.h / 2) + '" x2="' + t.stem + '" y2="' + (t.h / 2) +
      '" stroke="' + colors.line + '" stroke-width="' + t.stroke + '" stroke-linecap="round"/>' +
      '<polygon class="zfa-head" points="' + t.headX + ',' + (t.h / 2 - t.headHalf) + ' ' + t.headTip + ',' + (t.h / 2) + ' ' + t.headX + ',' + (t.h / 2 + t.headHalf) +
      '" fill="' + colors.line + '" stroke="' + (colors.headStroke || colors.line) + '" stroke-width="' + Math.max(2, t.stroke / 3) + '"/>' +
      '<g class="zfa-badge">' +
      '<rect class="zfa-badge-rect" x="' + (cx - 34) + '" y="' + (t.h / 2 - t.badgeH / 2) + '" width="68" height="' + t.badgeH + '" rx="' + t.badgeRy + '" fill="' + colors.line + '" opacity="0.95"/>' +
      '<text class="zfa-badge-text" x="' + cx + '" y="' + (t.h / 2) + '" dominant-baseline="central" text-anchor="middle" font-size="' + t.badgeFs +
      '" font-weight="bold" fill="' + (colors.badgeText || '#1a0a2e') + '" font-family="sans-serif">' + (badgeInit || '') + '</text>' +
      '</g>' + (extraDefs || '') +
      '<style>.zfa-flow{animation:zfaFlow 1s linear infinite;}@keyframes zfaFlow{to{stroke-dashoffset:-24;}}</style>' +
      '</svg>';
    return svg;
  }

  /* ---------- 状态应用（颜色/徽标/流动/悬浮提示） ---------- */
  function applyStatus(inst) {
    var t = TYPES[inst.type] || TYPES.main;
    var st = (inst.statuses && inst.statuses[inst.status]) || { color: '#9e9e9e', text: '未知', flow: false };
    var svg = inst.svg;
    if (!svg) return;
    var line = svg.querySelector('.zfa-line');
    var head = svg.querySelector('.zfa-head');
    var badgeRect = svg.querySelector('.zfa-badge-rect');
    var badgeText = svg.querySelector('.zfa-badge-text');
    if (line) line.setAttribute('stroke', st.color);
    if (head) { head.setAttribute('fill', st.color); head.setAttribute('stroke', st.color); }
    if (badgeRect) badgeRect.setAttribute('fill', st.color);
    var label = (typeof st.label === 'function' ? st.label(inst) : (st.text + (inst.rounds > 0 ? '·第' + inst.rounds + '轮' : '')));
    if (badgeText) {
      badgeText.textContent = label;
      if (badgeRect) {
        var tw = 0;
        try { tw = badgeText.getComputedTextLength(); } catch (e) {}
        if (!tw || !isFinite(tw)) {
          var cw = 0;
          for (var ci = 0; ci < label.length; ci++) cw += label.charCodeAt(ci) > 255 ? t.badgeFs : t.badgeFs * 0.55;
          tw = cw;
        }
        var w = Math.max(40, Math.round(tw + t.badgeFs));
        badgeRect.setAttribute('width', w);
        var cx = (6 + t.stem) / 2; /* 与 buildSvg 一致：线段正中点 */
        badgeRect.setAttribute('x', cx - w / 2);
      }
    }
    if (st.flow) { line.setAttribute('stroke-dasharray', '14 10'); line.classList.add('zfa-flow'); }
    else { line.removeAttribute('stroke-dasharray'); line.classList.remove('zfa-flow'); }
    inst.el.style.filter = 'drop-shadow(0 0 8px ' + st.color + ')';
    if (inst.getTitle) {
      try { inst.el.title = inst.getTitle(inst, st); } catch (e) {}
    }
    inst.el.dataset.status = inst.status;
    inst.el.dataset.type = inst.type;
  }

  function setStatus(inst, status) {
    var _from = inst.status;
    inst.status = status;
    applyStatus(inst);
    /* 【bugfix 2026-11-22】原 if (inst.cfg.persistKey) 恒抛 TypeError：create() 只把 cfg
       展开到 inst 自身（Object.assign），从未挂 .cfg 属性 → 本行必抛且被上层 try/catch
       静默吞掉 → 送出/回注的 sendTo（壳内紧跟 setStatus 之后）从未执行、箭头状态机瘫痪。
       改读 inst 自身属性（shell 均传 persistKey+persist，展开后就在 inst 上） */
    if (inst.persistKey && inst.persist) { try { inst.persist(); } catch (e) {} }
    notifyMinimap();
    /* 【v1.1 受击特效钩子】状态迁移统一广播：zf-arrow-fx.js 软引用接入（策划案
       docs/策划案-父子箭头受击特效-v1.md §5.1），fx 未加载/报错零影响 */
    try { if (window.__zfArrowFxHook) window.__zfArrowFxHook(inst, _from, status); } catch (e) {}
  }

  /* ---------- 悬停提升（互斥） ---------- */
  function hoverUp(inst) {
    if (_hovered && _hovered !== inst && _hovered.el) _hovered.el.style.zIndex = TYPES[_hovered.type].zBase;
    _hovered = inst;
    inst.el.style.zIndex = TYPES[inst.type].zHover;
  }
  function hoverDown(inst) {
    if (_hovered === inst) _hovered = null;
    inst.el.style.zIndex = TYPES[inst.type].zBase;
  }

  /* ---------- 箭头创建 ---------- */
  /*
   * cfg = {
   *   srcId, dstId        : 两端 chatbox id
   *   type                : 'main'|'sub'|'swarm'|'manual'|注册的任意类型
   *   colors              : { line, headStroke?, badgeText? }
   *   statuses            : { statusName: {color, text, flow, label?} }
   *   badge               : 初始徽标文字
   *   state               : 'toDst' | 'toSrc'（初始方向）
   *   noteInput           : true → 悬停出现补充说明输入框（内核托管 show/hide/z 层）
   *   onClick(inst)       : 点击回调（传参取 takeNote()/方向切换由壳自己决定）
   *   persistKey          : localStorage key（壳提供 persist/restore 时才用）
   *   persist(insts)      : 壳的存档函数
   *   getTitle(inst, st)  : title 提示
   *   extraDefs           : 额外 svg defs 字符串
   * }
   */
  function create(cfg) {
    if (!cfg || !cfg.srcId || !cfg.dstId) return null;
    var t = TYPES[cfg.type] || TYPES.main;
    var el = document.createElement('div');
    el.className = 'zf-arrow-core';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:' + t.zBase + ';cursor:pointer;pointer-events:auto;' +
      'filter:drop-shadow(0 0 8px rgba(179,136,255,.9));user-select:none;transition:transform .25s;';
    el.innerHTML = buildSvg(t, cfg.colors || { line: '#90a4ae' }, cfg.badge, cfg.extraDefs) +
      (cfg.noteInput ?
        '<div class="zfa-note" style="position:absolute;left:10px;top:' + (t.h + 12) + 'px;width:' + (t.w - 20) + 'px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:2;">' +
        '<input type="text" placeholder="✎ 补充说明（点箭头时一并送达）" style="width:100%;box-sizing:border-box;background:rgba(20,8,40,.92);border:1px solid rgba(179,136,255,.55);border-radius:10px;color:#f3eaff;font-size:12px;padding:6px 9px;outline:none;box-shadow:0 0 12px rgba(179,136,255,.35);" />' +
        '</div>' : '');
    document.body.appendChild(el);

    var inst = Object.assign({}, cfg);
    inst.el = el;
    inst.svg = el.querySelector('svg');
    inst.badge = el.querySelector('.zfa-badge');
    inst.type = cfg.type || 'main';
    inst.state = cfg.state || 'toDst';
    inst.status = cfg.status || (cfg.statuses && Object.keys(cfg.statuses)[0]) || 'pending';
    inst.rounds = cfg.rounds || 0;

    /* 补充说明输入框：内核统一托管（含 v37 防遮挡悬停提升） */
    if (cfg.noteInput) {
      (function () {
        var note = el.querySelector('.zfa-note');
        var inp = el.querySelector('.zfa-note input');
        if (!note || !inp) return;
        inp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        inp.addEventListener('click', function (e) { e.stopPropagation(); });
        inp.addEventListener('keydown', function (e) {
          e.stopPropagation();
          if (e.key === 'Enter' && inp.value.trim()) {
            e.preventDefault();
            inst.note = inp.value.trim();
            try { cfg.onClick(inst); } catch (e2) {}
            inp.value = ''; inst.note = '';
            hideNow();
          } else if (e.key === 'Enter') { e.preventDefault(); hideNow(); }
        });
        inp.addEventListener('input', function () { inst.note = inp.value; });
        var docDown = function (e) {
          if (!el.isConnected) { document.removeEventListener('mousedown', docDown); return; }
          if (!el.contains(e.target) && !note.contains(e.target)) hideNow();
        };
        document.addEventListener('mousedown', docDown);
        var hideTimer = null;
        function showNote() {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          hoverUp(inst);
          note.style.opacity = '1'; note.style.pointerEvents = 'auto';
        }
        function hideNote() {
          if (document.activeElement === inp) return;
          hideTimer = setTimeout(function () {
            if (document.activeElement === inp) return;
            note.style.opacity = '0'; note.style.pointerEvents = 'none'; inp.blur();
            hoverDown(inst);
          }, 350);
        }
        function hideNow() {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          note.style.opacity = '0'; note.style.pointerEvents = 'none'; inp.blur();
          hoverDown(inst);
        }
        el.addEventListener('mouseenter', showNote);
        el.addEventListener('mouseleave', hideNote);
        note.addEventListener('mouseenter', showNote);
        note.addEventListener('mouseleave', hideNote);
        inp.addEventListener('focus', showNote);
        inp.addEventListener('blur', hideNote);
        inst._hideNoteNow = hideNow;
        inst._takeNote = function () {
          var v = '';
          try {
            if (inp.value.trim()) { v = inp.value.trim(); inp.value = ''; inst.note = ''; }
            else if (inst.note && String(inst.note).trim()) { v = String(inst.note).trim(); inst.note = ''; }
          } catch (e) {}
          return v ? '\n\n【补充说明】\n' + v : '';
        };
      })();
    }

    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (cfg.onClick) { try { cfg.onClick(inst); } catch (e) {} }
    });

    /* 去重：同 src/dst/type 已有存活箭头 → 移除刚创建的多余 DOM（防孤儿钉在左上角 (0,0)）+ 返回旧实例 */
    for (var i = 0; i < instances.length; i++) {
      var o = instances[i];
      if (o.srcId === cfg.srcId && o.dstId === cfg.dstId && o.type === inst.type &&
          o.el && o.el.isConnected) { el.remove(); return o; }
    }
    instances.push(inst);
    applyStatus(inst);
    /* 【v1.2 创建广播】派出小队=建箭头即送出（crew-actions 派单路径不经过 setStatus），
       from=null 供 fx 区分于状态迁移（fx 自行抑制页面刷新 restore 风暴） */
    try { if (window.__zfArrowFxHook) window.__zfArrowFxHook(inst, null, inst.status); } catch (e) {}
    if (cfg.persistKey && cfg.persist) { try { cfg.persist(); } catch (e) {} }
    ensureLoop();
    notifyMinimap();
    return inst;
  }

  function findInst(srcId, dstId, type) {
    for (var i = 0; i < instances.length; i++) {
      var o = instances[i];
      if (o.srcId === srcId && o.dstId === dstId && (!type || o.type === type) && o.el && o.el.isConnected) return o;
    }
    return null;
  }

  function remove(inst) {
    var i = instances.indexOf(inst);
    if (i >= 0) instances.splice(i, 1);
    hoverDown(inst);
    if (inst.el) inst.el.remove();
    ensureLoop();
  }

  function notifyMinimap() {
    try {
      if (App._minimapDraw) App._minimapDraw();
      else if (App.updateMinimap) App.updateMinimap();
    } catch (e) {}
  }

  /* ---------- 统一 rAF 循环（合帧：全队一个 tick） ---------- */
  var _rafId = 0;
  function tick() {
    _rafId = 0;
    try {
      var sc = scaleOf();
      for (var i = instances.length - 1; i >= 0; i--) {
        var p = instances[i];
        var src = findChat(p.srcId), dst = findChat(p.dstId);
        if (!p.el || !p.el.isConnected || !src || !dst) {
          /* 熔断：对端已删 → 移除箭头 + 通知壳清档（杜绝无限恢复循环） */
          if (p.el) p.el.remove();
          if (p.cfg && p.cfg.onGone) { try { p.cfg.onGone(p); } catch (e) {} }
          instances.splice(i, 1);
          if (p.cfg && p.cfg.persistKey && p.cfg.persist) { try { p.cfg.persist(); } catch (e) {} }
          continue;
        }
        if (p.detect) { try { p.detect(p); } catch (e) {} }
        /* 隐藏保活：两端 findChat 落空 → onMissing(true) 只隐藏不删（撤销保箭头） */
        var _mSrc = findChat(p.srcId), _mDst = findChat(p.dstId);
        if (p.onMissing) { try { p.onMissing(p, !_mSrc || !_mDst); } catch (e) {} }
        var a = centerOf(src), b = p.getDst ? p.getDst(p) : centerOf(dst);
        if (!a || !b) {
          /* 任一端坐标无效（隐藏/0尺寸）→ 隐藏箭头并跳过本帧定位，防止钉在左上角 (0,0) */
          if (p.el && p.el.style.display !== 'none') p.el.style.display = 'none';
          continue;
        }
        if (p.el && p.el.style.display === 'none') p.el.style.display = '';
        var t = TYPES[p.type] || TYPES.main;
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var lx = mx - t.w / 2, ly = my - t.h / 2;
        if (p._lx !== lx || p._ly !== ly) {
          p.el.style.left = lx + 'px';
          p.el.style.top = ly + 'px';
          p._lx = lx; p._ly = ly;
        }
        /* 缩放跟随（保底 0.35，围绕中点缩放） */
        p.el.style.transformOrigin = (t.w / 2) + 'px ' + (t.h / 2) + 'px';
        var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        if (p.state === 'toSrc') ang += 180;
        if (typeof p._ang === 'number') {
          var d = ang - p._ang;
          while (d > 180) { ang -= 360; d = ang - p._ang; }
          while (d < -180) { ang += 360; d = ang - p._ang; }
        }
        p._ang = ang;
        var tf = 'rotate(' + ang + 'deg)';
        var tfBadge = 'rotate(' + (-ang) + 'deg)';
        var baseTf = sc < 0.99 ? 'scale(' + sc + ')' : '';
        if (p._tf !== tf || p._tfSc !== baseTf) {
          p.el.style.transform = baseTf; /* 恢复本帧 scale，避免清掉缩放导致回跳闪烁 */
          var svg = p.svg;
          if (svg) {
            svg.style.transformOrigin = (t.w / 2) + 'px ' + (t.h / 2) + 'px';
            svg.style.transition = 'transform .25s';
            svg.style.transform = tf;
          }
          if (p.badge) {
            /* 【v5 修复·压线】徽标中心在杆中点 (6+stem)/2 而非 SVG 中心 w/2，
               反向旋转必须围绕徽标自身中心，否则旋转后文字胶囊会飘离线段压到箭头上 */
            var _bcx = (6 + t.stem) / 2;
            p.badge.style.transformOrigin = _bcx + 'px ' + (t.h / 2) + 'px';
            p.badge.style.transition = 'none';
            p.badge.style.transform = tfBadge;
          }
          p._tf = tf; p._tfSc = baseTf;
        }
      }
    } finally {
      /* 【空载停机】无箭头不再无条件续帧（race L636 同款语义，防 60fps 空转掉帧） */
      _rafId = instances.length ? requestAnimationFrame(tick) : 0;
    }
  }
  function ensureLoop() {
    if (!_rafId) _rafId = requestAnimationFrame(tick);
  }
  setInterval(ensureLoop, 1000); /* 兜底：实例被外部 create 后循环自愈 */

  function findChat(id) {
    try {
      if (window.App && App.findChatBox) return App.findChatBox(id);
      var list = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) return list[i]; }
    } catch (e) {}
    return null;
  }

  /* ---------- 熔断型恢复 + 宽限期（v7.2.1 bravo 防重启误删） ---------- */
  /*
   * restore({ key, type, rebuild(data) → inst | null })
   * rebuild 返回 null（如 findChat 落空）→ 该条不再立即剔除！
   * 【v7.2.1】记录首次落空时间戳 _missAt 进存档，宽限期（30分钟）内保留：
   *   服务器重启后对话池异步恢复常慢于本模块首次 restore，旧逻辑立即回写剔除
   *   会把还活着的箭头永久误删（用户痛点「重启后箭头丢失」实锤根因）。
   *   持续落空超 30 分钟才判真死剔除——真删除场景语义保留，恢复慢场景不再误删。
   * 壳层重试循环每轮调 restore 即自然重试，无需额外机制。
   */
  function restore(opts) {
    var raw = null;
    try { raw = localStorage.getItem(opts.key); } catch (e) { return 0; }
    if (!raw || raw === '[]' || raw === 'null') return 0;
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { return 0; }
    if (!Array.isArray(arr)) return 0;
    var kept = [], restored = 0;
    var _now = Date.now();
    var GRACE_MS = 7 * 24 * 60 * 60 * 1000; /* 【v7.6 charlie】30min→7天：跨关机 _missAt 残留场景（上次落空未及复活就关机，次日开机已超30min直接真死）是「重启后箭头消失」主根因之一；7天=窗真删语义保留 */
    arr.forEach(function (d) {
      var inst = null;
      try { inst = opts.rebuild(d); } catch (e) { inst = null; }
      if (inst && inst.el && inst.el.isConnected) {
        restored++;
        if (d && typeof d === 'object') delete d._missAt; /* 复活成功清宽限戳 */
        kept.push(d);
        return;
      }
      if (!d || typeof d !== 'object') return; /* 脏数据直接剔 */
      if (!d._missAt) d._missAt = _now;        /* 首次落空：起宽限钟 */
      if (_now - d._missAt < GRACE_MS) { kept.push(d); return; } /* 宽限期内：保住 */
      /* 宽限期已过仍未复活：真死，熔断剔除 */
    });
    var _out = JSON.stringify(kept);
    if (_out !== raw) { try { localStorage.setItem(opts.key, _out); } catch (e) {} }
    if (restored) ensureLoop();
    return restored;
  }

  /* ---------- 公开 API ---------- */
  /* 【v7.6 charlie·id 迁移映射】v7.5 哨兵重建协作窗用 createChatBox 生成新 id，
     箭头存档记的是旧 id → findChat 永远落空 → 宽限期后被真死剔除=箭头消失。
     重建方调 mapId(旧,新) 登记，三壳 findChat 经 resolveId 自动换算。链式映射防二跳。 */
  var IDMAP_KEY = 'zf_arrow_id_map';
  function _loadIdMap() { try { return JSON.parse(localStorage.getItem(IDMAP_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function mapId(oldId, newId) {
    if (!oldId || !newId || String(oldId) === String(newId)) return;
    try {
      var m = _loadIdMap();
      /* 链压平：若 oldId 本身已是别人映射的目标，把指向 oldId 的链条直接改指 newId */
      var _flat = String(resolveId(oldId));
      m[String(oldId)] = String(newId);
      if (_flat !== String(oldId)) m[_flat] = String(newId);
      localStorage.setItem(IDMAP_KEY, JSON.stringify(m));
      try { console.log('[ZFArrow] id 映射登记: ' + oldId + ' → ' + newId); } catch (eL) {}
    } catch (e) {}
  }
  function resolveId(id) {
    var s = String(id);
    try {
      var m = _loadIdMap();
      var seen = {};
      while (m[s] && !seen[s]) { seen[s] = 1; s = m[s]; } /* 防环 */
    } catch (e) {}
    return s;
  }
  window.ZFArrow = {
    TYPES: TYPES,
    registerType: registerType,
    create: create,
    remove: remove,
    find: findInst,
    restore: restore,
    applyStatus: applyStatus,
    setStatus: setStatus,
    notifyMinimap: notifyMinimap,
    mapId: mapId,
    resolveId: resolveId,
    count: function () { return instances.length; },
    all: function () { return instances.slice(); }
  };
  // 启动日志已移除（降噪）
})();
