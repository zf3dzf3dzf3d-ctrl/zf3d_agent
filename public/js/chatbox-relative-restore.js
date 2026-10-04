/* =====================================================================
 * chatbox-relative-restore.js  v1.1
 * 【重启后父子窗口相对位置守恒】
 *
 * v1.1：首校等待 3s→1s、慢恢复重试 5s→1.5s、二次兜底 8s→4s，
 *       显著缩短重启后子窗停在漂移位置的可见窗口（应用户反馈）。
 *
 * 问题：重启/刷新恢复后，个别子对话框（策划师/审核员/施工队/汇总窗等）
 *       相对父对话框的位置发生偏移（拖拽末次位置未及落库、恢复顺序差异等）。
 * 方案：
 *  1) 持续采集父子关系边（复用各箭头模块 getPairs/pairs + ZFSwarm 注册表），
 *     把每个子窗相对父窗的偏移 (dx,dy) 持久化到 localStorage（防抖写入）；
 *  2) 重启恢复后（等 App.chatBoxes 就绪 + 箭头模块恢复完成），逐条校验：
 *     当前实际偏移与已存偏移差超过阈值(24px) → 子窗拉回 父窗位置+已存偏移，
 *     并立即 Store.saveChatBox 落库，保证下次重启不再漂移；
 *  3) 不触碰任何箭头方向状态（toSrc/toTK 等由各箭头模块自身持久化），
 *     校正只改子窗 left/top，箭头 tick 循环会自动跟随重绘、方向不变。
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFRelativeRestore) return;

  var KEY = 'zf_parent_offsets_v1';
  var TOLERANCE = 24;          // 偏移差超过该像素才视为漂移
  var SAVE_DEBOUNCE = 800;     // 采集防抖
  /* 【出生保护】新建窗 10s 内不校正不采集：创建后的钉回重申等动作会临时改位置，
     陈旧偏移基准在此期间会把新窗拽到远处（"突然飞走"）。新窗由创建方打 _zfFreshSpawn 标记 */
  var FRESH_MS = 10000;
  function isFresh(chat) {
    try { return chat && chat.el && chat.el._zfFreshSpawn && (Date.now() - chat.el._zfFreshSpawn) < FRESH_MS; } catch (e) { return false; }
  }

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
  }

  /* ---------- 聚合父子边（与 chatbox-group-follow.js 同源口径） ---------- */
  function collectEdges() {
    var edges = [];
    function add(pid, cid) {
      if (!pid || !cid || String(pid) === String(cid)) return;
      edges.push({ parent: String(pid), child: String(cid) });
    }
    try {
      var mp = (window.ZFMultiArrow && window.ZFMultiArrow.pairs) || [];
      mp.forEach(function (p) {
        if (!p || !p.el || !p.el.isConnected) return;
        (p.memberIds || []).forEach(function (mid) { add(p.srcId, mid); });
      });
    } catch (e) {}
    [[window.ZFVerifyArrow, 'qcId'], [window.ZFThinkerArrow, 'tkId'], [window.ZFSummarizerArrow, 'tkId']].forEach(function (m) {
      try {
        if (!m[0] || !m[0].getPairs) return;
        m[0].getPairs().forEach(function (p) { if (p) add(p.srcId, p[m[1]]); });
      } catch (e) {}
    });
    try {
      if (window.ZFRaceArrow && window.ZFRaceArrow.getPairs) {
        window.ZFRaceArrow.getPairs().forEach(function (p) {
          if (p && !p.dead && p.srcId && p.raceId) add(p.srcId, p.raceId);
        });
      }
    } catch (e) {}
    try {
      var cp = (window.ZFConvergeArrow && window.ZFConvergeArrow.pairs) || [];
      cp.forEach(function (p) { if (p && p.srcId != null) add(p.srcId, p.tkId || p.qcId); });
    } catch (e) {}
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

  /* ---------- 偏移持久化 ---------- */
  function loadOffsets() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveOffsets(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }
  var _saveTimer = 0;
  var _restored = false;   // 首次校正完成前禁止采集，防止把漂移中间态写成基准（审核竞态备注）
  var _migrating = false;  // 【迁移中门禁】整理面板批量写回期间挂起采集/校正（防把写回中间态写成基准）
  function captureOffsets() {
    if (!_restored || _migrating) return;
    /* 【平移门禁】主画布平移进行中不采集：平移期间的 layout 中间态可能把错误的
       父子偏移写成基准，之后校正会按陈旧偏移把子窗拉一次（双倍跳的另一来源） */
    try {
      var _cc = document.getElementById('canvasContent');
      if (_cc && _cc.classList.contains('dragging')) { scheduleCapture(); return; }
    } catch (e) {}
    var edges = collectEdges();
    if (!edges.length) return;
    var offs = loadOffsets();
    var dirty = false;
    edges.forEach(function (e) {
      var pp = posOf(findChat(e.parent)), cp = posOf(findChat(e.child));
      if (!pp || !cp) return;
      if (isFresh(findChat(e.child))) return; /* 【出生保护】新窗 10s 内不采集偏移，防陈旧基准污染 */
      var rec = { parentId: e.parent, dx: Math.round(cp.x - pp.x), dy: Math.round(cp.y - pp.y), t: Date.now() };
      var old = offs[e.child];
      if (!old || old.parentId !== rec.parentId || old.dx !== rec.dx || old.dy !== rec.dy) dirty = true;
      offs[e.child] = rec;
    });
    if (dirty) saveOffsets(offs);
  }
  function scheduleCapture() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () { _saveTimer = 0; captureOffsets(); }, SAVE_DEBOUNCE);
  }

  /* 拖拽结束 / 非指针移动后 / 周期性，均采集一次 */
  document.addEventListener('pointerup', scheduleCapture, true);
  document.addEventListener('pointercancel', scheduleCapture, true);
  setInterval(captureOffsets, 5000);

  /* ---------- 重启恢复校正 ---------- */
  function applyRestore() {
    /* 【双倍跳转修复 v3】迁移中（整理面板批量写回）或整理模式激活时挂起校正：
       此时真实位置正在批量变更，用启动时采集的旧基准校正会把子窗拉回旧位 →
       用户平移画布时表现为父子双倍跳转。延后重试，待 endMigration 重算基准后再校 */
    if (_migrating || document.body.classList.contains('zf-org-mode')) {
      setTimeout(applyRestore, 3000);
      return;
    }
    var offs = loadOffsets();
    var fixed = 0, checked = 0, total = 0;
    Object.keys(offs).forEach(function (childId) {
      var rec = offs[childId];
      if (!rec || !rec.parentId) return;
      total++;
      var child = findChat(childId), parent = findChat(rec.parentId);
      if (!child || !child.el || !parent || !parent.el) return; /* 未就绪，计入未校验 */
      if (isFresh(child)) return; /* 【出生保护】新窗 10s 内不校正 */
      var pp = posOf(parent), cp = posOf(child);
      if (!pp || !cp) return;
      checked++;
      var wantX = pp.x + rec.dx, wantY = pp.y + rec.dy;
      if (Math.abs(cp.x - wantX) > TOLERANCE || Math.abs(cp.y - wantY) > TOLERANCE) {
        setPos(child, wantX, wantY);
        /* 同步 chat.x/y，确保落库与后续恢复用的是新坐标而非旧值（审核备注①） */
        try { child.x = Math.round(wantX); child.y = Math.round(wantY); } catch (e) {}
        fixed++;
        try { if (window.Store && Store.saveChatBox) Store.saveChatBox(child, true); } catch (e) {}
      }
    });
    if (fixed) {
      try { if (window.App && App._updateAllNavArrows) App._updateAllNavArrows(); } catch (e) {}
      try { if (window.App && App.updateMinimap) App.updateMinimap(); } catch (e) {}
    } else if (_applyTries < 20 && (!collectEdges().length || checked < total)) {
      /* 慢恢复/边界态：边未就绪，或存在 el 未挂好导致漏校验的条目 → 延时重试。
         v1.1 重试间隔 5000→1500ms：缩短子窗停在漂移位置的可见窗口（用户反馈
         「重启后个别子窗初始位置不对，过一会才对」），20 次×1.5s≈30s 上限足够覆盖慢恢复 */
      _applyTries++;
      setTimeout(applyRestore, 1500);
      return;
    }
    _restored = true; /* 首次校正流程走完（或有边可采），放开采集 */
  }
  var _applyTries = 0;

  /* 等 App.chatBoxes 就绪且箭头模块完成自身恢复（thinker waitRestore 最长 60s）。
     v1.1：框就绪后再等 1s（原 3s）立即首校，0.5s 间隔快速轮询直到边就绪，
     并保留 4s 二次兜底——目标：重启后子窗漂移的可见时间 <2s */
  (function waitRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if (anyBox || tries > 70) {
        clearInterval(timer);
        setTimeout(applyRestore, 1000);
        setTimeout(applyRestore, 4000); /* 二次兜底（慢恢复场景） */
      }
    }, 500);
  })();

  window.ZFRelativeRestore = {
    capture: captureOffsets,
    apply: applyRestore,
    collectEdges: collectEdges,
    /* 【迁移中门禁 v2】整理面板批量写回时调用 begin；写回完成后调用 end——
       end 内部按当前真实位置重算偏移基准并落库，防止陈旧基准在后续平移时把子窗拉远 */
    beginMigration: function () { _migrating = true; },
    endMigration: function () {
      _migrating = false;
      try { if (_restored) captureOffsets(); } catch (e) {}
    },
    isMigrating: function () { return _migrating; }
  };
  // [relative-restore] 父子相对位置守恒模块已加载
})();
