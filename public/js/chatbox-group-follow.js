/* =====================================================================
 * chatbox-group-follow.js  v2.0
 * 【多角色窗口跟随移动】+【按角色规模记忆最佳阵型】
 *
 * 设计（策划收口结论）：
 *  - 数据源：复用 window.ZFMultiArrow.pairs（srcId + memberIds），不另造关系
 *  - 策略：拖父窗 → 整棵子树（子窗及其派生窗）跟随平移；拖子窗 → 只动自己
 *  - 阵型：按角色签名（如"多角色x3"）存相对父窗偏移槽位，localStorage 持久化
 *  - 拖拽检测：document 级 pointerdown/move（冒泡阶段，不改各模块拖拽代码），
 *    平时父子脱钩；仅拖拽实时跟随或整理面板 panelMoved 时子树跟随一次（v2.0 停用后台轮询）
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFGroupFollow) return;

  var KEY = 'zf_formation_presets_v1';

  /* ---------- 工具 ---------- */
  function findChat(id) {
    try {
      var boxes = (window.App && window.App.chatBoxes) || [];
      for (var i = 0; i < boxes.length; i++) if (boxes[i] && boxes[i].id === id) return boxes[i];
    } catch (e) {}
    return null;
  }
  function posOf(chat) {
    if (!chat || !chat.el) return null;
    var l = parseFloat(chat.el.style.left), t = parseFloat(chat.el.style.top);
    if (isNaN(l) || isNaN(t)) return null;
    return { x: l, y: t };
  }
  function setPos(chat, x, y) {
    if (!chat || !chat.el) return;
    chat.el.style.left = Math.round(x) + 'px';
    chat.el.style.top = Math.round(y) + 'px';
    /* 【双倍跳转修复 v7】同步内存态，保证落库/刷新模块读到新坐标 */
    try { chat.x = Math.round(x); chat.y = Math.round(y); } catch (e) {}
  }

  /* ---------- 聚合边表 v1.1：兼容四类关系数据源，归一为 {parent, child} ----------
   * 1) ZFMultiArrow.pairs (srcId + memberIds, 需 p.el 存活)
   * 2) ZFVerifyArrow / ZFThinkerArrow / ZFSummarizerArrow 的 getPairs() (srcId↔qcId/tkId)
   * 3) ZFConvergeArrow.pairs (srcId 字段) —— 保险兜底
   * 4) ZFSwarm 注册表（converge 汇总窗：el._qcSrcId/_thinkerSrcId → 父）
   *    方向统一：父(原对话/派单窗) → 子(审核/策划/汇总/总结窗)          */
  function collectEdges() {
    var edges = [];
    function add(pid, cid) {
      if (!pid || !cid || pid === cid) return;
      edges.push({ parent: String(pid), child: String(cid) });
    }
    /* 多角色 */
    try {
      var mp = (window.ZFMultiArrow && window.ZFMultiArrow.pairs) || [];
      mp.forEach(function (p) {
        if (!p.el || !p.el.isConnected) return;
        (p.memberIds || []).forEach(function (mid) { add(p.srcId, mid); });
      });
    } catch (e) {}
    /* verify / thinker / summarizer */
    [[window.ZFVerifyArrow, 'qcId'], [window.ZFThinkerArrow, 'tkId'], [window.ZFSummarizerArrow, 'tkId']].forEach(function (m) {
      try {
        if (!m[0] || !m[0].getPairs) return;
        m[0].getPairs().forEach(function (p) { add(p.srcId, p[m[1]]); });
      } catch (e) {}
    });
    /* race（施工队）：ZFRaceArrow 连线（源对话 → 施工队窗）也纳入父子跟随 */
    try {
      if (window.ZFRaceArrow && window.ZFRaceArrow.getPairs) {
        window.ZFRaceArrow.getPairs().forEach(function (p) {
          if (p && !p.dead && p.srcId && p.raceId) add(p.srcId, p.raceId);
        });
      }
    } catch (e) {}
    /* converge：pairs 有 srcId 字段则直接用；否则从 ZFSwarm 注册表归一 */
    try {
      var cp = (window.ZFConvergeArrow && window.ZFConvergeArrow.pairs) || [];
      var seenSrc = {};
      cp.forEach(function (p) { if (p && p.srcId != null) { seenSrc[String(p.srcId)] = true; add(p.srcId, p.tkId || p.qcId); } });
      if (window.ZFSwarm && window.ZFSwarm.membersOf) {
        Object.keys(seenSrc).forEach(function (sid) {
          window.ZFSwarm.membersOf(sid).forEach(function (mid) { add(sid, typeof mid === 'object' ? (mid && mid.id) : mid); });
        });
      }
    } catch (e) {}
    /* ZFSwarm 兜底：有汇总窗但 converge pairs 未覆盖的父窗（从窗口 el 标记反查） */
    try {
      if (window.ZFSwarm && window.ZFSwarm.membersOf) {
        var boxes = (window.App && window.App.chatBoxes) || [];
        boxes.forEach(function (b) {
          if (!b || !b.el || !b.el.isConnected || !b.id) return;
          var sid = b.el._qcSrcId || b.el._thinkerSrcId;
          if (sid) add(sid, b.id);
        });
      }
    } catch (e) {}
    return edges;
  }

  /* ---------- 收集以 rootId 为根的整棵子树（聚合边表 BFS，防成环） ---------- */
  function collectSubtree(rootId) {
    var set = {}, chain = [String(rootId)], out = [];
    set[String(rootId)] = true;
    var edges = collectEdges();
    var guard = 0;
    while (chain.length && guard++ < 50) {
      var pid = chain.shift();
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (e.parent !== pid) continue;
        var mid = e.child;
        if (set[mid]) continue;
        set[mid] = true;
        var c = findChat(mid);
        if (c && c.el && c.el.isConnected) { out.push(c); chain.push(mid); }
      }
    }
    return out; // 不含 root 本身
  }

  /* ---------- 拖拽来源判定 ---------- */
  function boxFromEvent(e) {
    var el = e.target && e.target.closest ? e.target.closest('.chatbox') : null;
    if (!el) return null;
    var boxes = (window.App && window.App.chatBoxes) || [];
    for (var i = 0; i < boxes.length; i++) {
      var c = boxes[i];
      if (c && c.el === el) return c;
    }
    return null;
  }

  /* ---------- 阵型签名：按成员数（多角色组签名 = 组名+数量） ---------- */
  function signature(pair) {
    return (pair.groupName || '多角色') + '×' + (pair.memberIds || []).length;
  }
  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function savePresets(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }

  /* 记录阵型：各成员相对父窗偏移（按 memberIds 顺序即槽位序） */
  function recordFormation(pair) {
    var src = findChat(pair.srcId);
    if (!src || !src.el) return;
    var sp = posOf(src); if (!sp) return;
    var slots = [];
    var ok = 0;
    (pair.memberIds || []).forEach(function (mid) {
      var c = findChat(mid);
      var cp = posOf(c);
      if (cp) { slots.push({ dx: Math.round(cp.x - sp.x), dy: Math.round(cp.y - sp.y) }); ok++; }
      else slots.push(null);
    });
    if (!ok) return;
    var presets = loadPresets();
    presets[signature(pair)] = slots;
    savePresets(presets);
  }

  /* 应用阵型：命中按槽位摆，溢出沿最后有效槽位向量线性外推；未命中返回 false */
  function applyFormation(pair) {
    var src = findChat(pair.srcId);
    if (!src || !src.el) return false;
    var sp = posOf(src); if (!sp) return false;
    var presets = loadPresets();
    var slots = presets[signature(pair)];
    if (!slots || !slots.length) return false;
    var last = null;
    (pair.memberIds || []).forEach(function (mid, idx) {
      var c = findChat(mid);
      if (!c || !c.el) return;
      var s = idx < slots.length ? slots[idx] : null;
      if (!s && last) s = { dx: last.dx + 72, dy: last.dy + 44 }; /* 线性外推 */
      if (!s) s = { dx: 60, dy: 200 }; /* 兜底 */
      last = s;
      /* 越界回拉：不出画布 */
      var nx = sp.x + s.dx, ny = sp.y + s.dy;
      var ca = document.getElementById('canvasContent');
      var maxX = (ca ? ca.clientWidth : window.innerWidth) - 160;
      var maxY = (ca ? ca.clientHeight : window.innerHeight) - 120;
      nx = Math.min(Math.max(0, nx), Math.max(0, maxX));
      ny = Math.min(Math.max(0, ny), Math.max(0, maxY));
      setPos(c, nx, ny);
    });
    return true;
  }

  /* ---------- 核心：拖动 root → 子树整体平移 ---------- */
  var following = null; // { rootChat, startRootPos, subs: [{chat, dx, dy}] }

  function beginFollow(rootChat) {
    var subs = collectSubtree(rootChat.id);
    if (!subs.length) return;
    var rp = posOf(rootChat); if (!rp) return;
    following = {
      rootChat: rootChat,
      startPos: rp,
      subs: subs.map(function (c) {
        var p = posOf(c);
        return p ? { chat: c, dx: p.x - rp.x, dy: p.y - rp.y } : null;
      }).filter(Boolean)
    };
  }

  function moveFollow() {
    if (!following) return;
    var np = posOf(following.rootChat);
    if (!np) return;
    var dx = np.x - following.startPos.x, dy = np.y - following.startPos.y;
    if (!dx && !dy) return;
    following.subs.forEach(function (s) {
      setPos(s.chat, np.x + s.dx, np.y + s.dy);
    });
  }

  function endFollow() {
    if (!following) return;
    /* 防抖 250ms 后记录该组阵型（微调即保存，多角色组专属） */
    var root = following.rootChat;
    var pairs = (window.ZFMultiArrow && window.ZFMultiArrow.pairs) || [];
    var owned = pairs.filter(function (p) { return p.srcId === root.id && p.el && p.el.isConnected; });
    setTimeout(function () {
      owned.forEach(recordFormation);
    }, 250);
    /* 关键：拖拽结束立即刷新 lastSeen 基准快照，
       防止兜底轮询把本轮 dx/dy 再平移一次（二次位移）。
       子窗也可能是更深层链的父（孙窗链），本轮跟随已把它们整体平移过，
       必须清掉其 lastSeen 基准，否则 snapshotAll 会按同一 dx/dy 对后代再移一次 */
    try {
      var subs = (following.subs || []);
      lastSeen[root.id] = null;
      subs.forEach(function (s) { lastSeen[s.chat.id] = null; });
      following = null; /* 先退出拖拽态，让下方 snapshotAll 不被自家门禁挡掉 */
      snapshotAll();
    } catch (e) { following = null; }
  }

  /* ---------- 事件接线（冒泡阶段，兼容各模块自管拖拽） ---------- */
  document.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    var box = boxFromEvent(e);
    if (!box) return;
    var t = e.target;
    /* 只响应标题栏区发起的拖动（与主拖拽行为一致，排除输入区/按钮） */
    if (t.closest && (t.closest('textarea') || t.closest('input') || t.closest('button'))) return;
    beginFollow(box);
  }, true); /* 捕获阶段记录起始快照（在模块重排 zIndex 前拿准目标） */

  document.addEventListener('pointermove', function () { moveFollow(); }, true);
  document.addEventListener('pointerup', endFollow, true);
  document.addEventListener('pointercancel', endFollow, true);

  /* ---------- 兜底轮询【v2.0 已停用】（应用户裁决） ----------
   * 原逻辑：后台每 2s 扫描父窗位置，发现变化就让子树跟着平移（400ms 高频窗口）。
   * 问题：现场画布里父窗位置被系统微调（落库/恢复时序、布局抖动）时，
   *       轮询跟随与实时跟随叠加 → 子对话被"双倍移动"。
   * 新策略：平时父子完全脱钩，各停各的位置；只有拖拽（pointer 实时跟随）
   *       或整理面板明确调用 panelMoved 时子树才跟随一次，松手即脱钩。
   * lastSeen 保留仅作 panelMoved 基准刷新用，不再驱动任何自动平移。 */
  var lastSeen = {}, lastMoveTs = 0;
  function snapshotAll() {
    /* 【2倍移动修复】拖拽进行中直接跳过：实时跟随(moveFollow)已按绝对位置摆好子窗，
       此时轮询再按 lastSeen 增量叠加会让子窗瞬移约 2 倍距离（松手后 endFollow 会重建基准） */
    if (following) return;
    /* 【平移门禁】主画布平移进行中跳过：平移只改 canvasContent transform、不改窗口
       left/top，但平移引起的 layout/reflow 可能让本轮快照读到写回中间态 → 按残差
       二次平移（父子双倍跳）。松手后 pointerup 会重建基准，无需此处补偿 */
    try {
      var _cc = document.getElementById('canvasContent');
      if (_cc && _cc.classList.contains('dragging')) return;
    } catch (e) {}
    /* 聚合边表 v1.1：盯所有关系里的父窗（多角色/审核/策划/汇总/总结） */
    var parentIds = {};
    collectEdges().forEach(function (e) { parentIds[e.parent] = true; });
    Object.keys(parentIds).forEach(function (sid) {
      var src = findChat(sid);
      var sp = posOf(src);
      if (!sp) return;
      var prev = lastSeen[sid];
      if (prev && (prev.x !== sp.x || prev.y !== sp.y)) {
        /* 父窗被外部移动（非 pointer 拖拽）→ 子树跟随 */
        var dx = sp.x - prev.x, dy = sp.y - prev.y;
        collectSubtree(sid).forEach(function (c) {
          var cp = posOf(c);
          if (cp) setPos(c, cp.x + dx, cp.y + dy);
        });
        lastMoveTs = Date.now();
      }
      lastSeen[sid] = sp;
    });
  }
  /* ---------- 对外 API ---------- */
  window.ZFGroupFollow = {
    collectSubtree: collectSubtree,
    /* 【暴露边表】供 fit-viewport 等模块识别子对话（避免窗口变化时子窗被独立校准脱钩） */
    collectEdges: collectEdges,
    applyFormation: function (srcId) {
      var pairs = (window.ZFMultiArrow && window.ZFMultiArrow.pairs) || [];
      for (var i = 0; i < pairs.length; i++) {
        if (pairs[i].srcId === srcId) return applyFormation(pairs[i]);
      }
      return false;
    },
    getPresets: function () { return loadPresets(); },
    deletePreset: function (sig) { var p = loadPresets(); delete p[sig]; savePresets(p); },
    recordFormation: recordFormation,
    /* 供整理面板拖卡片后调用：父卡片位移 → 真实窗口子树跟随 */
    panelMoved: function (srcId, dx, dy) {
      collectSubtree(srcId).forEach(function (c) {
        var cp = posOf(c);
        if (cp) setPos(c, cp.x + dx, cp.y + dy);
      });
      /* 刷新整棵子树的 lastSeen 基准：子窗也可能是 pair 的父（孙窗链），
         否则兜底轮询会按同一 dx/dy 对后代再平移一次 */
      /* 【双倍跳转修复 v7】setPos 已同步 chat.x/y，落库/刷新模块读到新坐标 */
      collectSubtree(srcId).forEach(function (c) { lastSeen[c.id] = null; });
      lastSeen[srcId] = null;
    },
    /* 【中键拖拽实时跟随】外部（小地图中键拖拽）每帧调用：按绝对位置实时摆好子树，
       替代 2s/400ms 漂移轮询兜底，子窗不再滞后约 0.5s */
    liveFollow: function (rootChat) {
      if (!rootChat || !rootChat.id) return;
      if (!following || following.rootChat !== rootChat) beginFollow(rootChat);
      moveFollow();
    },
    /* 【中键拖拽结束】外部松手时调用：复用 endFollow 刷新 lastSeen 基准，防止轮询二次位移 */
    endLiveFollow: function () {
      endFollow();
    },
    _test: { signature: signature, applyFormation: applyFormation }
  };
})();
