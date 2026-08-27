/* =====================================================================
 *  reasoning-levels.js -- 思考强度档位统一配置（全局单例 ReasoningLevels）
 *  数据源：/config/reasoning_levels.json（公开静态文件）
 *    levels          : 所有模型共用的默认档位（value + label）
 *    modelOverrides  : { "<modelId>": [ {value,label}, ... ] } 按模型覆盖
 *  API：
 *    ReasoningLevels.load()            -> Promise，加载（幂等，已加载直接返回）
 *    ReasoningLevels.listFor(modelId)  -> [{value,label}]，按模型取档位列表
 *    ReasoningLevels.labelOf(value)    -> 中文标签（找不到回退 value 本身）
 *    ReasoningLevels.defaultValue()    -> 默认档位 value（levels[0]）
 *    ReasoningLevels.ready             -> bool，是否已加载
 * ===================================================================== */

(function (global) {
  'use strict';

  var CONFIG_URL = 'config/reasoning_levels.json';
  var CACHE_KEY = 'zf3d_reasoning_levels';

  // 加载失败时的兜底档位（与 JSON 保持一致，避免网络故障导致 UI 无选项）
  var FALLBACK = [
    { value: 'disable', label: '最低' },
    { value: 'low',     label: '低' },
    { value: 'medium',  label: '中' },
    { value: 'high',    label: '高' },
    { value: 'ultra',   label: '最高' }
  ];

  var levels = null;
  var overrides = null;
  var loadPromise = null;

  function validList(arr) {
    return Array.isArray(arr) && arr.length > 0 &&
      arr.every(function (it) { return it && it.value; });
  }

  function normalize(data) {
    var lv = (data && data.levels) ? data.levels : null;
    var ov = (data && data.modelOverrides && typeof data.modelOverrides === 'object') ? data.modelOverrides : {};
    if (!validList(lv)) lv = FALLBACK;
    // 过滤掉非法的 override 列表
    var clean = {};
    Object.keys(ov).forEach(function (k) {
      if (validList(ov[k])) clean[k] = ov[k];
    });
    levels = lv;
    overrides = clean;
  }

  function persistLocal() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ levels: levels, modelOverrides: overrides })); } catch (e) {}
  }

  function restoreLocal() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!validList(parsed && parsed.levels)) return false;
      levels = parsed.levels;
      overrides = (parsed.modelOverrides && typeof parsed.modelOverrides === 'object') ? parsed.modelOverrides : {};
      return true;
    } catch (e) { return false; }
  }

  var ReasoningLevels = {
    get ready() { return !!levels; },

    load: function () {
      if (loadPromise) return loadPromise;
      loadPromise = fetch(CONFIG_URL, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          normalize(data);
          persistLocal();
          return { ok: true, count: levels.length };
        })
        .catch(function (err) {
          console.warn('[ReasoningLevels] 加载配置失败，使用本地缓存/兜底:', err && err.message || err);
          if (!restoreLocal()) normalize(null);
          return { ok: true, warn: String(err && err.message || err), count: levels.length };
        });
      return loadPromise;
    },

    // 按模型取档位列表：优先 modelOverrides[实际生效的 modelId]，否则默认 levels
    listFor: function (modelId) {
      if (!levels && !loadPromise) { this.load(); }
      var id = (modelId || '').trim();
      if (id && overrides && overrides[id] && overrides[id].length) {
        return overrides[id];
      }
      return levels || FALLBACK;
    },

    labelOf: function (value) {
      var v = String(value == null ? '' : value);
      var all = (levels || FALLBACK).concat(
        Object.keys(overrides || {}).reduce(function (acc, k) { return acc.concat(overrides[k]); }, [])
      );
      for (var i = 0; i < all.length; i++) {
        if (all[i].value === v) return all[i].label;
      }
      return v;
    },

    defaultValue: function () {
      return (levels && levels[0] && levels[0].value) || FALLBACK[0].value;
    }
  };

  global.ReasoningLevels = ReasoningLevels;

  // 页面加载即预热（不阻塞，失败自动走 localStorage/兜底）
  try { ReasoningLevels.load(); } catch (e) {}

})(window);
