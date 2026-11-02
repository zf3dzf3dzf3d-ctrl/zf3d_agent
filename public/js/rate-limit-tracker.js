/**
 * rate-limit-tracker.js — 全局限流（429）实时记录器
 * 功能：
 *   1. 各对话在收到 429 时调用 RateLimit.record() 上报（跨对话共享，挂在 window 上）
 *   2. 滑动窗口统计（最近60分钟），按模型聚合：限流次数 / 首次时间 / 最近时间
 *   3. localStorage 持久化，刷新不丢
 *   4. 提供 RateLimit.isLimited(modelId) 供"避开限流模型"的切换逻辑使用
 * 用法：
 *   RateLimit.record(modelId, modelName)        // 收到 429 时
 *   RateLimit.stats()                           // => [{modelId, modelName, count, lastTs, windowMin}]
 *   RateLimit.isLimited(modelId, thresholdMs)   // 冷却期内视为限流中
 */
(function (global) {
  'use strict';
  var LS_KEY = 'zf_rate_limit_events_v1';
  var WINDOW_MS = 60 * 60 * 1000;      // 统计窗口：最近 60 分钟
  var MAX_EVENTS = 500;                 // 事件上限，防止无限膨胀
  var DEFAULT_COOLDOWN_MS = 3 * 60 * 1000; // 默认冷却：3 分钟内视为"限流中"

  var _events = [];

  // 启动时恢复
  try {
    var raw = global.localStorage.getItem(LS_KEY);
    if (raw) _events = JSON.parse(raw) || [];
  } catch (e) { _events = []; }

  function _persist() {
    try {
      if (_events.length > MAX_EVENTS) _events = _events.slice(-MAX_EVENTS);
      global.localStorage.setItem(LS_KEY, JSON.stringify(_events));
    } catch (e) { /* 存储满等异常忽略 */ }
  }

  function _prune() {
    var cutoff = Date.now() - WINDOW_MS;
    _events = _events.filter(function (ev) { return ev.ts >= cutoff; });
  }

  /** 记录一次限流事件 */
  function record(modelId, modelName, status) {
    _events.push({
      modelId: modelId || 'unknown',
      modelName: modelName || (modelId || '未知模型'),
      ts: Date.now(),
      status: status || 429
    });
    _prune();
    _persist();
    // 通知 UI 刷新（如果限流面板在页面上）
    try { global.dispatchEvent(new CustomEvent('ratelimit:changed')); } catch (e) {}
  }

  /** 滑动窗口统计，按次数降序 */
  function stats() {
    _prune();
    var map = {};
    _events.forEach(function (ev) {
      if (!map[ev.modelId]) {
        map[ev.modelId] = { modelId: ev.modelId, modelName: ev.modelName, count: 0, firstTs: ev.ts, lastTs: ev.ts };
      }
      map[ev.modelId].count++;
      if (ev.ts < map[ev.modelId].firstTs) map[ev.modelId].firstTs = ev.ts;
      if (ev.ts > map[ev.modelId].lastTs) map[ev.modelId].lastTs = ev.ts;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /** 某模型是否正处于限流冷却期 */
  function isLimited(modelId, thresholdMs) {
    var cool = thresholdMs || DEFAULT_COOLDOWN_MS;
    var now = Date.now();
    for (var i = _events.length - 1; i >= 0; i--) {
      if (_events[i].modelId === modelId && (now - _events[i].ts) < cool) return true;
      if (now - _events[i].ts > WINDOW_MS) break; // 事件按时间序，超过窗口可直接停
    }
    return false;
  }

  function clear() {
    _events = [];
    _persist();
    try { global.dispatchEvent(new CustomEvent('ratelimit:changed')); } catch (e) {}
  }

  global.RateLimit = {
    record: record,
    stats: stats,
    isLimited: isLimited,
    clear: clear,
    WINDOW_MIN: WINDOW_MS / 60000
  };
})(window);
