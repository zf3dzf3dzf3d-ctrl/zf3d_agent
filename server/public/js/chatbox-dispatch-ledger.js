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
      var c = _load();
      c[String(srcId)] = {
        expected: (memberIds || []).length,
        memberIds: (memberIds || []).map(String),
        returned: 0,
        closed: {},
        createdAt: Date.now()
      };
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

  /* 派发时不知道谁已关闭：按 findChat 实测，找不到的成员自动核销 */
  function autoCloseMissing(srcId, findChat) {
    try {
      var c = _load(); var rec = c[String(srcId)];
      if (!rec || !rec.memberIds) return;
      for (var i = 0; i < rec.memberIds.length; i++) {
        var id = rec.memberIds[i];
        if (rec.closed[id]) continue;
        var ch = null;
        try { ch = findChat(id); } catch (e) {}
        if (!ch || !ch.el) { rec.closed[id] = 1; }
      }
      _save();
    } catch (e) {}
  }

  /* 收口门槛：回收数 + 核销数 ≥ 派出数。无登记（非登记派发）→ 放行走旧逻辑 */
  function canGather(srcId) {
    try {
      var rec = _load()[String(srcId)];
      if (!rec) return true;
      var closedN = 0; var closed = rec.closed || {};
      for (var k in closed) if (closed[k]) closedN++;
      return (rec.returned || 0) + closedN >= (rec.expected || 0);
    } catch (e) { return true; }
  }

  function progressText(srcId) {
    try {
      var rec = _load()[String(srcId)];
      if (!rec) return '';
      var closedN = 0; var closed = rec.closed || {};
      for (var k in closed) if (closed[k]) closedN++;
      return '已回收 ' + (rec.returned || 0) + '/' + rec.expected + (closedN ? '（含关闭核销 ' + closedN + '）' : '') + '，收齐前不汇总';
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

  window.ZFDispatchLedger = {
    register: register,
    markClosed: markClosed,
    autoCloseMissing: autoCloseMissing,
    canGather: canGather,
    progressText: progressText,
    finish: finish
  };
})();
