/* =====================================================================
 * chatbox-relative-restore.js  v1.4
 * 【重启后父子窗口相对位置守恒】
 *
 * v1.4：【用户拖拽永久脱钩】修复"拖动一个窗过一会另一个/本窗又被拉回"复发——
 *       旧版拖拽守卫只有 3s 有效期、且只挡启动 30s 重试期：用户手动拖过窗后，
 *       5s 周期采集把拖后位置写成新基准，启动重试循环仍按 localStorage 旧偏移
 *       把子窗拽回旧位（表现为"移动一个，过一小会另一个跟着变"）。
 *       新规则：pointermove 拖拽中每帧记录被拖的窗 el（仅主键按下+实际位移），
 *       松手时将该窗从偏移基准中【永久作废】（含其作为子窗的记录与作为父窗的
 *       全部子记录），本会话内不再被 applyRestore 校正，基准由后续采集按用户
 *       拖后真实位置自然重建。不再依赖时间窗，重启前一直生效。
 *
 * v1.3：①恢复校正增加「父窗稳定门禁」——父窗 el 位置与落库坐标(chat.x/y)不一致时
 *       推迟校正，防止用父窗恢复中间态把子窗拽错位；
 *       ②首轮校正只改视觉不落库，复验一轮（父窗仍稳定）后才落库，
 *       防止错误坐标被固化进数据库（"重启后审核窗跑到上方"的根源）。
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
  var _pendingBase = {};   // 【v1.2 基准防污染】待确认的新基准（连续两轮采集一致才落库）
  var _lastUserDragTs = 0; /* 【v1.4】声明提前：pointermove 跟踪在下方立即使用 */
  /* 【v1.4 用户拖拽永久脱钩】本会话内被用户手动拖过的窗 id 集合：
     applyRestore 跳过这些子窗；captureOffsets 首轮按拖后真实位置重建基准。
     注：pointermove 才记（要求主键按下+位移>3px），普通点击不误伤（审核员#2 提示的守卫粒度问题） */
  var _userDragged = {};
  var _dragTracking = { down: false, btn: 0, x: 0, y: 0, el: null, moved: false };
  function markUserDragged(el) {
    if (!el) return;
    /* 向上找窗容器并登记（窗可能嵌套容器） */
    var box = el.closest ? el.closest('.chatbox, .chat-box, .chat-node') : null;
    if (!box || !box.id) return;
    _userDragged[box.id] = true;
    /* 【v1.5 持久作废】拖拽确认瞬间立即从 localStorage 删除旧偏移基准：
       该窗作为子窗的记录 + 作为父窗的全部子记录，一律作废。
       不再等 captureOffsets 落库——否则用户拖完 800ms 防抖窗口内刷新页面，
       旧偏移仍存活，重启恢复又会把窗拽回老位置（复发根因）。 */
    try {
      var offs = loadOffsets();
      var changed = false;
      if (offs[box.id]) { delete offs[box.id]; changed = true; }
      Object.keys(offs).forEach(function (k) {
        if (offs[k] && offs[k].parentId === box.id) { delete offs[k]; changed = true; }
      });
      if (changed) saveOffsets(offs);
    } catch (e) {}
  }
  document.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return; /* 仅左键拖拽算用户手动移动 */
    _dragTracking = { down: true, btn: 0, x: e.clientX, y: e.clientY, el: e.target, moved: false };
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!_dragTracking.down || _dragTracking.moved) return;
    if (Math.abs(e.clientX - _dragTracking.x) > 3 || Math.abs(e.clientY - _dragTracking.y) > 3) {
      _dragTracking.moved = true;
      _lastUserDragTs = Date.now();
      markUserDragged(_dragTracking.el); /* 拖拽确认瞬间即登记，早于松手 */
    }
  }, true);
  function captureOffsets() {
    if (!_restored || _migrating || document.body.classList.contains('zf-overview-mode') || document.body.classList.contains('zf-org-mode')) return;
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
    /* 【v1.2 基准防污染】重启恢复后窗体无出生保护标记，位置仍可能被其他模块调整；
       若一轮采集就把中间态写成基准，下次重启会被坏基准拉到错误位置（如审核窗跑到上方）。
       规则：与已存基准不一致的新偏移，需连续两轮采集结果一致才落库；与旧基准相同则立即接受并清待定 */
    edges.forEach(function (e) {
      var pp = posOf(findChat(e.parent)), cp = posOf(findChat(e.child));
      if (!pp || !cp) return;
      if (isFresh(findChat(e.child))) return; /* 【出生保护】新窗 10s 内不采集偏移，防陈旧基准污染 */
      var rec = { parentId: e.parent, dx: Math.round(cp.x - pp.x), dy: Math.round(cp.y - pp.y), t: Date.now() };
      /* 【v1.4 用户拖拽永久脱钩】被用户拖过的子窗：旧基准立即作废，
         按拖后真实位置直接重建基准（不等连续两轮确认——用户放置即意图） */
      if (_userDragged[e.child]) {
        var od = offs[e.child];
        if (!od || od.parentId !== rec.parentId || Math.abs(od.dx - rec.dx) > 0.5 || Math.abs(od.dy - rec.dy) > 0.5) {
          offs[e.child] = rec; dirty = true;
        }
        delete _pendingBase[e.child];
        return;
      }
      var old = offs[e.child];
      var changed = !old || old.parentId !== rec.parentId || Math.abs(old.dx - rec.dx) > TOLERANCE || Math.abs(old.dy - rec.dy) > TOLERANCE;
      if (!changed) {
        /* 与既有基准一致：接受时间戳刷新，清掉待定 */
        if (old.t !== rec.t) { old.t = rec.t; dirty = true; }
        delete _pendingBase[e.child];
        return;
      }
      var pend = _pendingBase[e.child];
      if (pend && pend.parentId === rec.parentId && pend.dx === rec.dx && pend.dy === rec.dy) {
        /* 连续两轮一致：确认为稳定新基准，落库 */
        _pendingBase[e.child] = null;
        offs[e.child] = rec;
        dirty = true;
      } else {
        _pendingBase[e.child] = rec; /* 首见变更，等下一轮确认 */
      }
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
  /* 【拖拽回弹修复】用户手动拖拽后 3s 内禁止 applyRestore 拉回：
     启动后最长 30s 的重试循环期间用户拖动子窗，pending 的重试会按
     localStorage 旧偏移把窗弹回原位（"拖过去 0.1 秒就回去"的根因） */
  document.addEventListener('pointerup', function () { _lastUserDragTs = Date.now(); }, true);
  document.addEventListener('pointercancel', function () { _lastUserDragTs = Date.now(); }, true);
  function applyRestore() {
    /* 【双倍跳转修复 v3】迁移中（整理面板批量写回）或整理模式激活时挂起校正：
       此时真实位置正在批量变更，用启动时采集的旧基准校正会把子窗拉回旧位 →
       用户平移画布时表现为父子双倍跳转。延后重试，待 endMigration 重算基准后再校 */
    if (_migrating || document.body.classList.contains('zf-org-mode') || document.body.classList.contains('zf-overview-mode')) {
      setTimeout(applyRestore, 3000);
      return;
    }
    /* 【拖拽回弹修复】用户刚拖拽过（3s 内）→ 本轮校正整体跳过，重试交给原循环 */
    if (Date.now() - _lastUserDragTs < 3000) {
      if (_applyTries < 20) { _applyTries++; setTimeout(applyRestore, 1500); }
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
      /* 【v1.4 用户拖拽永久脱钩】本会话内用户拖过的窗不做校正（其基准已由采集
         按拖后位置重建）；同时父窗被拖过时也不动子窗（防按旧偏移拽走子窗，
         覆盖审核建议的"父窗拖动场景"——父位已变但子窗位置是用户认可的） */
      if (_userDragged[childId] || _userDragged[rec.parentId]) return;
      if (isFresh(child)) return; /* 【出生保护】新窗 10s 内不校正 */
      var pp = posOf(parent), cp = posOf(child);
      if (!pp || !cp) return;
      /* 【v1.3 父窗稳定门禁】父窗 el 位置与其落库坐标(chat.x/y)不一致 → 父窗自身
         尚未恢复到最终位置（各窗恢复异步、顺序不定）。此时用中间态父位+偏移校正
         会把子窗拽错，且错误坐标立即落库会被固化（"重启后审核窗跑到上方"的根源）。
         计为未就绪，走下方重试，等父窗稳定后再校。 */
      try {
        if (typeof parent.x === 'number' && typeof parent.y === 'number' &&
            (Math.abs(pp.x - parent.x) > TOLERANCE || Math.abs(pp.y - parent.y) > TOLERANCE)) {
          checked++; total++; /* 计入未稳定，触发重试且本轮不校正该条 */
          return;
        }
      } catch (e) {}
      checked++;
      var wantX = pp.x + rec.dx, wantY = pp.y + rec.dy;
      if (Math.abs(cp.x - wantX) > TOLERANCE || Math.abs(cp.y - wantY) > TOLERANCE) {
        setPos(child, wantX, wantY);
        /* 同步 chat.x/y，确保落库与后续恢复用的是新坐标而非旧值（审核备注①）。
           【v1.3】首轮校正（_applyTries===0）只改视觉位置不落库：等下一轮复验
           父窗仍稳定、偏移仍成立后再落库，防把恢复中间态坐标固化进数据库 */
        try { child.x = Math.round(wantX); child.y = Math.round(wantY); } catch (e) {}
        fixed++;
        if (_applyTries > 0) {
          try { if (window.Store && Store.saveChatBox) Store.saveChatBox(child, true); } catch (e) {}
        }
      }
    });
    if (fixed) {
      try { if (window.App && App._updateAllNavArrows) App._updateAllNavArrows(); } catch (e) {}
      try { if (window.App && App.updateMinimap) App.updateMinimap(); } catch (e) {}
      /* 【v1.3】首轮有校正动作时，延迟复验一轮再落库（见上） */
      if (_applyTries === 0) {
        _applyTries++;
        setTimeout(applyRestore, 2000);
        return;
      }
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
