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

    // 按模型取档位列表：
    // 1) 模型条目 reasoningLevels 为 {模型ID:[{value,label}...]} 字典（真实合并形态）：
    //    优先取用户当前选中模型ID 的档位，实现"强度自动跟随所选模型ID"
    // 2) 兼容旧的单一数组形态 [{value,...}]
    // 3) 都没有时回退兜底档位
    listFor: function (modelId, modelObj) {
      if (!loaded && !loadPromise) { this.load(); }
      if (modelObj && modelObj.reasoningLevels) {
        var rl = modelObj.reasoningLevels;
        if (Array.isArray(rl) && rl.length &&
            rl.every(function (it) { return it && it.value; })) {
          return rl; // 旧形态：模型级统一档位
        }
        if (!Array.isArray(rl)) {
          var key = String(modelId || modelObj.modelId || '');
          var list = rl[key];
          if (!list) {
            // 模型ID 精确匹配失败时，取字典第一个（与该线路首个模型ID对应）
            for (var k in rl) { if (Object.prototype.hasOwnProperty.call(rl, k)) { list = rl[k]; break; } }
          }
          if (Array.isArray(list) && list.length) {
            // 兼容两种元素形态：纯字符串 ["disable","low"] 或对象 {value,label}
            return list.map(function (it) {
              if (it && typeof it === 'object') return it;
              return { value: String(it), label: ReasoningLevels.labelOf(String(it)) };
            });
          }
        }
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
