/* =====================================================================
 *  reasoning-levels.js -- 思考强度档位统一配置（全局单例 ReasoningLevels）
 *  数据源：/config/models.json（每个模型条目内部自带 reasoningLevels 可选档位表）
 *  API：
 *    ReasoningLevels.load()            -> Promise，加载（幂等，已加载直接返回）
 *    ReasoningLevels.listFor(modelId, modelObj) -> [{value,label}]，优先取模型对象内部的档位
 *    ReasoningLevels.labelOf(value)    -> 标签（找不到回退 value 本身）
 *    ReasoningLevels.defaultValue()    -> 默认档位 value
 *    ReasoningLevels.ready             -> bool，是否已加载
 * ===================================================================== */

(function (global) {
  'use strict';

  // 单一数据源：与模型配置同一个 models.json
  var CONFIG_URL = 'config/models.json';

  // 加载失败时的兜底档位（避免网络故障导致 UI 无选项）
  var FALLBACK = [
    { value: 'disable', label: '最低' },
    { value: 'low',     label: '低' },
    { value: 'medium',  label: '中' },
    { value: 'high',    label: '高' },
    { value: 'ultra',   label: '最高' }
  ];

  var loaded = false;
  var loadPromise = null;

  var ReasoningLevels = {
    get ready() { return loaded; },

    load: function () {
      if (loadPromise) return loadPromise;
      loadPromise = fetch(CONFIG_URL, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function () {
          loaded = true;
          return { ok: true };
        })
        .catch(function (err) {
          console.warn('[ReasoningLevels] 加载配置失败，使用兜底档位:', err && err.message || err);
          return { ok: true, warn: String(err && err.message || err) };
        });
      return loadPromise;
    },

    // 按模型取档位列表：模型条目内部自带的 reasoningLevels（真正的合并形态），
    // 没有时回退兜底档位
    listFor: function (modelId, modelObj) {
      if (!loaded && !loadPromise) { this.load(); }
      if (modelObj && Array.isArray(modelObj.reasoningLevels) && modelObj.reasoningLevels.length &&
          modelObj.reasoningLevels.every(function (it) { return it && it.value; })) {
        return modelObj.reasoningLevels;
      }
      return FALLBACK;
    },

    labelOf: function (value) {
      var v = String(value == null ? '' : value);
      for (var i = 0; i < FALLBACK.length; i++) {
        if (FALLBACK[i].value === v) return FALLBACK[i].label;
      }
      return v;
    },

    defaultValue: function () {
      return FALLBACK[0].value;
    }
  };

  global.ReasoningLevels = ReasoningLevels;

  // 页面加载即预热（不阻塞，失败自动走兜底）
  try { ReasoningLevels.load(); } catch (e) {}

})(window);
