/* chatbox-dispatch-ledger.js  v1
 * 【派发登记账本】派出团队（专家团/审核/校验等）时在服务器持久化登记：
 *   - register(srcId, memberIds)：派发时登记「派出 N 份」
 *   - canGather(srcId)：已回收(returned) + 用户已关闭核销(closed) ≥ 派出数 才允许收口汇总
 *   - autoCloseMissing(srcId, findChat)：用户已关闭的成员窗口 → 核销一份（closed）
 *   - finish(srcId)：收口完成后清空该源对话的登记
 * 持久化：localStorage 秒读 + UserSettings（private/用户设置/user_settings.json，重启/换机不丢）
 * 目的：修复「派 6 份只收回 1 份就提前汇总」——不齐就一直等，用户关一个核销一个。
 */
(function () {
  'use strict';
  var LS_KEY = 'zf_dispatch_ledger';
  var US_KEY = 'zf_dispatch_ledger';
  var _cache = null;
  var _saveTimer = null;

  function _load() {
    if (_cache) return _cache;
    try { _cache = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { _cache = {}; }
    if (!_cache || typeof _cache !== 'object') _cache = {};
    return _cache;
  }

  function _saveNow() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_cache || {})); } catch (e) {}
    try {
      if (window.UserSettings && typeof window.UserSettings.set === 'function') {
        window.UserSettings.set(US_KEY, JSON.stringify(_cache || {}));
      }
    } catch (e) {}
  }

  function _save() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(function () { _saveTimer = null; _saveNow(); }, 300); /* 防抖：错峰派出时只落一次盘 */
  }

  function register(srcId, memberIds) {
    try {
      var c = _load(); var key = String(srcId);
      var ids = (memberIds || []).map(String);
      var old = c[key];
      if (old) {
        /* 【v2 修复·4派2收】错峰开窗时收口箭头可能先于全部成员建起（memberIds 只含已开出的窗），
           后续 register 一律合并：expected 取 max、memberIds 取并集，绝不缩小已登记规模 */
        var seen = {}; var union = [];
        (old.memberIds || []).concat(ids).forEach(function (id) { if (!seen[id]) { seen[id] = 1; union.push(id); } });
        old.memberIds = union;
        old.expected = Math.max(old.expected || 0, union.length);
        /* 【v6 修复·误核销】新窗并入时记 seen，防 autoCloseMissing 对「尚未开出」的窗误核销 */
        old.seen = old.seen || {};
        ids.forEach(function (id) { if (!old.seen[id]) old.seen[id] = 1; });
        _saveNow(); /* 【v6】关键路径立即持久化 */
        return true;
      }
      c[key] = { expected: ids.length, memberIds: ids, returnedIds: {}, closed: {}, seen: {}, createdAt:Date.now()
      };
      _save();
      return true;
    } catch (e) { return false; }
  }

  /* 【v6 修复·跨派次污染】重置式登记：同源再次派发即开新账，清掉上一轮残账 returnedIds/closed，
     防止上一轮未走完收口的残账让本轮 canGather 开局即放行 */
  function registerExpected(srcId, n) {
    try {
      var c = _load(); var key = String(srcId);
      c[key] = { expected: Number(n) || 0, memberIds: [], returnedIds: {}, closed: {}, seen: {}, createdAt: Date.now() };
      _saveNow(); /* 【v6】关键路径立即持久化，消 300ms 防抖窗口 */
      return true;
    } catch (e) { return false; }
  }

  /* 【v9 对账收敛·防幻影死锁】registerExpected(n=5) 先登记 5 份，但实际只有 3 个窗成功 register
     （窗口开出失败/被拦截）→ expected=5 永远凑不齐 → canGather 恒 false → 自动回收不触发、
     手动点击也报「收齐前不汇总，点箭头无效」永久死锁（2026-10-30 实账本实锤：cb645 expected=5
     在册仅3）。收敛规则：派出满 RECONCILE_MS 后，若在册成员数 < expected，说明差额部分永远不会
     开窗，把 expected 收缩到实际在册数。防抖：只收缩一次（记 reconciled）。 */
  var RECONCILE_MS = 60000;
  function _reconcile(srcId, rec) {
    try {
      if (!rec || rec.reconciled) return;
      if (!rec.createdAt || (Date.now() - rec.createdAt) < RECONCILE_MS) return;
      var n = (rec.memberIds || []).length;
      if (n < (rec.expected || 0)) {
        /* n=0（全员未开出，如孤儿账）→ 账目无意义，直接清掉放行；n>0 → 收缩到实际数 */
        if (n === 0) { var _c = _load(); delete _c[String(srcId)]; }
        else rec.expected = n;
        rec.reconciled = true;
        _saveNow();
      } else {
        rec.reconciled = true; /* 无差额也只判一次，防每帧空转 */
        _saveNow();
      }
    } catch (e) {}
  }

  /* 【v2 新增】尚待开窗的成员数 = expected - 已核销 - 已实际开窗的在册成员；无登记返回 -1（放行） */
  function outstanding(srcId, findChat) {
    try {
      var rec = _load()[String(srcId)];
      if (!rec) return -1;
      _reconcile(srcId, rec);
      var closed = rec.closed || {};
      var closedN = 0; for (var k in closed) if (closed[k]) closedN++;
      var openN = 0;
      (rec.memberIds || []).forEach(function (id) {
        if (closed[id]) return;
        try { var ch = findChat ? findChat(id) : null; if (ch && ch.el) openN++; } catch (e) {}
      });
      return Math.max((rec.expected || 0) - closedN - openN, 0);
    } catch (e) { return -1; }
  }

  /* 【v2 接线】某成员确已回复完成 → 记入 returnedIds（幂等），canGather 按 returned∪closed 计数 */
  function markReturned(srcId, chatId) {
    try {
      var c = _load(); var rec = c[String(srcId)];
      if (!rec) return false;
      rec.returnedIds = rec.returnedIds || {};
      rec.returnedIds[String(chatId)] = 1;
      _save();
      return true;
    } catch (e) { return false; }
  }

  /* 用户关闭成员窗口 → 核销一份：closed[id]=1（幂等） */
  function markClosed(srcId, chatId) {
    try {
      var c = _load(); var rec = c[String(srcId)];
      if (!rec) return false;
      rec.closed[String(chatId)] = 1;
      _save();
      return true;
    } catch (e) { return false; }
  }

  /* 【v7 修复·手动发送误核销】派发时不知道谁已关闭：按 findChat 实测，找不到的成员自动核销。
     但用户在成员窗手动点发送会触发聊天区重渲染，窗口短暂脱离 DOM 一帧即被永久核销
     （closed 不可逆）→ 全员被误核销 → canGather 提前放行 → 提前收口。
     修复：首次发现消失只记 missingSince 时间戳，连续消失超过 GRACE_MS 才真正核销；
     窗口渲染回来即撤销计时。 */
  var GRACE_MS = 5000;
  function autoCloseMissing(srcId, findChat) {
    try {
      var c = _load(); var rec = c[String(srcId)];
      if (!rec || !rec.memberIds) return;
      var _now = Date.now();
      var _dirty = false;
      rec.missingSince = rec.missingSince || {}; /* 【v8】兜底：旧账本记录无此字段时，L127 delete undefined[id] 会 TypeError 且被 catch 吞掉中断整帧 */
      for (var i = 0; i < rec.memberIds.length; i++) {
        var id = rec.memberIds[i];
        if (rec.closed[id]) { delete rec.missingSince[id]; continue; }
        var ch = null;
        try { ch = findChat(id); } catch (e) {}
        if (!ch || !ch.el) {
          /* 【v7】宽限期：消失满 GRACE_MS 才核销；瞬时重渲染不误杀 */
          rec.missingSince = rec.missingSince || {};
          if (!rec.missingSince[id]) { rec.missingSince[id] = _now; _dirty = true; }
          else if (_now - rec.missingSince[id] >= GRACE_MS) { rec.closed[id] = 1; delete rec.missingSince[id]; _dirty = true; }
        } else {
          /* 窗口回来了 → 撤销消失计时 */
          if (rec.missingSince && rec.missingSince[id]) { delete rec.missingSince[id]; _dirty = true; }
        }
      }
      if (_dirty) _save();
    } catch (e) {}
  }

  /* 收口门槛：回收数 + 核销数 ≥ 派出数。无登记（非登记派发）→ 放行走旧逻辑 */
  function canGather(srcId) {
    try {
      var rec = _load()[String(srcId)];
      if (!rec) return true;
      _reconcile(srcId, rec);
      var closedN = 0; var closed = rec.closed || {};
      for (var k in closed) if (closed[k]) closedN++;
      var ret = rec.returnedIds || {};
      var retN = 0; var seen = {};
      for (var r in ret) if (ret[r] && !seen[r]) { seen[r] = 1; retN++; }
      for (var k2 in closed) if (closed[k2] && !seen[k2]) { seen[k2] = 1; retN++; } /* 并集防重复计数 */
      return retN >= (rec.expected || 0);
    } catch (e) { return true; }
  }

  function progressText(srcId) {
    try {
      var rec = _load()[String(srcId)];
      if (!rec) return '';
      var closedN = 0; var closed = rec.closed || {};
      for (var k in closed) if (closed[k]) closedN++;
      var ret = rec.returnedIds || {};
      var retN = 0; var seen = {};
      for (var r in ret) if (ret[r] && !seen[r]) { seen[r] = 1; retN++; }
      for (var k2 in closed) if (closed[k2] && !seen[k2]) { seen[k2] = 1; retN++; }
      return '已回收 ' + retN + '/' + rec.expected + (closedN ? '（含关闭核销 ' + closedN + '）' : '') + '，收齐前不汇总';
    } catch (e) { return ''; }
  }

  /* 收口成功：全员计为已回收并清空登记 */
  function finish(srcId) {
    try {
      var c = _load();
      delete c[String(srcId)];
      _save();
      return true;
    } catch (e) { return false; }
  }

  /* 【v8 全局数组变量库·方向入账】箭头方向（up=已收口朝上/down=已分发朝下）记入账本，
     外部可随时查「这个源对话派了几份/回了几份/箭头朝哪」——一次派出对应一次收回的最终裁判 */
  function setArrow(srcId, dir) {
    try {
      var c = _load(); var key = String(srcId); var rec = c[key];
      if (!rec) return false;
      rec.arrowDir = (dir === 'down') ? 'down' : 'up';
      rec.arrowAt = Date.now();
      _save();
      return true;
    } catch (e) { return false; }
  }

  /* 【v8 全局快照】返回该源对话完整账目：派出/已回/已核销/尚缺/方向。无登记返回 null */
  function getSnapshot(srcId) {
    try {
      var rec = _load()[String(srcId)];
      if (!rec) return null;
      var closedN = 0; var closed = rec.closed || {};
      for (var k in closed) if (closed[k]) closedN++;
      var ret = rec.returnedIds || {}; var retN = 0; var seen = {};
      for (var r in ret) if (ret[r] && !seen[r]) { seen[r] = 1; retN++; }
      return {
        srcId: String(srcId),
        expected: rec.expected || 0,
        returned: retN,
        closed: closedN,
        pending: Math.max((rec.expected || 0) - retN - closedN, 0),
        memberIds: (rec.memberIds || []).slice(),
        arrowDir: rec.arrowDir || null,
        canGather: retN + closedN >= (rec.expected || 0),
        createdAt: rec.createdAt || 0
      };
    } catch (e) { return null; }
  }

  /* 【P1-1 只读诊断 v9】dumpAll：全账本 dump（含 missingSince 宽限期字段，`||{}` 防线兼容
     旧记录无该字段——6086d12f TypeError 教训）。纪律红线：严格只读，无任何写操作；
     输出只进 console，禁止落档/外发（安全约束见三件套定义档）。触发=显式用户在
     console 执行 ZFDispatchLedger.dumpAll()，无定时自动 dump。
     安全提示：输出含对话窗 id 与派发内容片段，公网/多人暴露前须审查暴露面（安全师第4轮）。 */
  var _SECRET_RE=/(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}|(?:api[_-]?key|token|secret|bearer)["\']?\s*[:=]\s*["\']?[A-Za-z0-9+_.\-]{6,})/gi;
  function _mask(x){return String(x).replace(_SECRET_RE,"[已打码]");}
  function dumpAll() {
    var c = _load();
    var out = [];
    var keys = Object.keys(c);
    for (var i = 0; i < keys.length; i++) {
      var rec = c[keys[i]] || {};
      var closed = rec.closed || {};
      var closedIds = Object.keys(closed).filter(function (k) { return closed[k]; });
      var ms = rec.missingSince || {}; /* 旧记录可能无此字段 */
      var msKeys = Object.keys(ms).filter(function (k) { return ms[k]; });
      out.push({
        srcId: keys[i],
        expected: rec.expected || 0,
        memberIds: (rec.memberIds || []).slice(),
        returnedIds: Object.keys(rec.returnedIds || {}).filter(function (k) { return rec.returnedIds[k]; }),
        closedIds: closedIds,
        missingSince: msKeys.map(function (k) { return { id: k, since: ms[k] }; }),
        arrowDir: rec.arrowDir || null,
        createdAt: rec.createdAt || 0
      });
    }
    /* 样本摘要：宽限期现场（险情候选）直接可读 */
    console.log('[ledger-dump] ' + new Date().toISOString() + ' 共 ' + out.length + ' 条登记');
    console.log(_mask(JSON.stringify(out, null, 2)));
    return out;
  }

  window.ZFDispatchLedger = {
    register: register,
    registerExpected: registerExpected,
    outstanding: outstanding,
    markReturned: markReturned,
    markClosed: markClosed,
    autoCloseMissing: autoCloseMissing,
    canGather: canGather,
    progressText: progressText,
    finish: finish,
    setArrow: setArrow,
    getSnapshot: getSnapshot,
    dumpAll: dumpAll
  };
})();
