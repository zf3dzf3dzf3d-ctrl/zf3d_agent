/* =====================================================================
 *  models.js —— 大模型配置数据层（v5 重写版）
 *  直接读写后端两个 JSON 文件：
 *    公开配置: public/config/models.json   （模型定义，无 key）
 *    私有配置: private/api_keys.json       （按 name 索引的 key）
 *  前端通过 /api/models/config GET/POST 读写，后端自动合并拆分两个文件。
 *
 *  暴露 API：
 *    Models.list                    : Array<Model>  （直接引用，就地更新）
 *    Models.activeId                : 默认模型 id
 *    Models._loaded                 : boolean  （首次 load 完成）
 *    Models.newId()                 : 随机 id
 *    Models.getById(id)             : Model | null
 *    Models.add(model)              : Promise<{ok,id}>
 *    Models.update(id, patch)       : Promise<{ok,model}>
 *    Models.remove(id)              : Promise<{ok}>
 *    Models.clone(id, {name})       : Promise<{ok,id}>
 *    Models.setDefault(id)          : Promise<{ok}>
 *    Models.setVisible(id, visible) : Promise<{ok}>
 *    Models.move(id, targetIdx)     : Promise<{ok}>
 *    Models.test(model|{endpoint,apiKey,modelId,version})
 *                                   : Promise<{ok,latencyMs,error}>
 *    Models.save()                  : Promise<{ok}>  POST 后端
 *    Models.load()                  : Promise<{ok}>  GET 后端
 *    Models.exportJSON() / importJSON(str)
 * ===================================================================== */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'zf_community_models_v4';
  var ACTIVE_KEY  = 'zf_community_models_active_v4';
  // 【2026】localStorage 模型缓存机制已彻底移除（后端 JSON 为唯一数据源）。
  // 启动时清掉历史残留，防止旧缓存复活已删除的模型（如 zf-builtin）：
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem('zf_model_sync_ts');
  } catch (e) {}
  var ACTIVE_KEY  = 'zf_community_models_active_v4';

  // ---------- 工具 ----------
  function newId() {
    return 'm_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function nowISO() { return new Date().toISOString(); }

  function safeParse(str, fb) {
    try { var v = JSON.parse(str); return v == null ? fb : v; }
    catch (e) { return fb; }
  }

  function ok(data)  { return Promise.resolve(Object.assign({ ok: true }, data || {})); }
  function fail(msg) { return Promise.resolve({ ok: false, error: msg || '未知错误' }); }

  // ---------- 空列表（数据来自后端 JSON，不再硬编码） ----------
  function defaultList() { return []; }

  // ---------- 状态 ----------
  var list = [];
  var activeId = null;
  var _loaded = false;
  // 显式删除清单（name/id -> 1）：save 成功前保留并随 payload 提交，
  // 后端据此区分“用户删除”与“旧页面快照缺失”，防止整体覆盖丢模型
  var _removed = {};

  // ---------- 模型对象规范化 ----------
  function normalizeModel(m) {
    if (!m.id) m.id = m.name || newId();
    if (m.enabled === undefined) m.enabled = true;
    // imageGen 是生图能力；visionInput 是图片理解能力，缺省均为 false，避免把未知模型误当视觉模型。
    if (m.imageGen === undefined) m.imageGen = false;
    if (m.visionInput === undefined) m.visionInput = false;
    if (!Array.isArray(m.visionInputFormats)) m.visionInputFormats = [];
    // 思考强度档位统一由 reasoning_levels.json 提供，这里只保留存量值（可为空）
    if (!m.reasoningEffort) m.reasoningEffort = (typeof ReasoningLevels !== 'undefined' && ReasoningLevels && ReasoningLevels.defaultValue) ? (ReasoningLevels.defaultValue() || 'medium') : 'medium';
    if (!m.keyRef) m.keyRef = (m.key || m.apiKey) ? 'user' : 'system';
    // key / apiKey 互相同步
    if (!m.apiKey) m.apiKey = m.key || '';
    if (!m.key) m.key = m.apiKey || '';
    return m;
  }

  // ---------- 从后端加载 ----------
  function load() {
    return fetch('/api/models/config')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.ok || !data.config || !Array.isArray(data.config.list)) {
          throw new Error('配置格式错误');
        }
        var items = data.config.list;
        // 就地更新 list，保持 Models.list 引用不变
        list.length = 0;
        items.forEach(function(m) {
          normalizeModel(m);
          list.push(m);
        });
        _removed = {};   // 服务端状态为最新基线，清空待删清单
    // 找默认模型【三级优先级：官网下发 isDefault → 本地 isDefault → 空白（绝不取第一个）】
        var _cands = list.filter(function (m) { return m.enabled !== false && m.endpoint; });
    var def = _cands.find(function (m) { return m.isDefault && isZfOfficial(m); }) || _cands.find(function (m) { return m.isDefault; }) || null;
        activeId = def ? def.id : null;
        _loaded = true;
        // 【2026 移除 localStorage 备份】模型配置只以后端 JSON 为唯一数据源，
        // 旧缓存极易过期复活（如 zf-builtin 下线后又冒出来），彻底不再写 localStorage
        return ok({ count: list.length, activeId: activeId });
      })
      .catch(function(err) {
        console.error('[Models] load from backend failed:', err);
        // 【2026 移除 localStorage 降级】后端失败就保持空列表并返回警告，绝不读旧缓存复活已删除的模型
        _loaded = true;
        return ok({ count: 0, activeId: null, warn: 'backend failed: ' + (err && err.message || err) });
      });
  }

  // ---------- 保存到后端 ----------
  function save() {
    // 构造提交数据（list 中的 key 会由后端拆分到 api_keys.json）
    var payload = { list: list.map(function(m) {
      var copy = Object.assign({}, m);
      // 确保后端能识别 key 字段
      copy.key = m.key || m.apiKey || '';
      return copy;
    })};
    payload.removed = Object.keys(_removed);
    return fetch('/api/models/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data || !data.ok) throw new Error((data && data.err) || '保存失败');
      _removed = {};   // 服务端已确认落盘，删除清单使命完成
      // 用后端返回的合并数据更新 list（确保 key 同步）
      if (data.config && Array.isArray(data.config.list)) {
        list.length = 0;
        data.config.list.forEach(function(m) { normalizeModel(m); list.push(m); });
      }
      // 【2026 移除 localStorage 备份】
      return ok({ count: list.length, activeId: activeId });
    })
    .catch(function(err) {
      console.error('[Models] save to backend failed:', err);
      // 【2026 移除 localStorage 降级】保存失败直接报错，不落本地缓存
      return fail((err && err.message) || '保存失败');
    });
  }

  // ---------- CRUD ----------
  function getById(id) {
    var m = list.find(function(m) { return m.id === id; }) || null;
    if (m) {
      m.key = m.apiKey || m.key || '';
    }
    return m;
  }

  function add(model) {
    if (!model || !model.name || !model.endpoint || !model.modelId) {
      return fail('缺少必填字段（名称 / 网址 / 调取模型）');
    }
    var m = Object.assign({
      id: model.name || newId(),
      apiKey: '',
      keyRef: 'system',
      reasoningEffort: (ReasoningLevels && ReasoningLevels.defaultValue()) || 'medium',
      enabled: true,
      isDefault: false,
      visible: true,
      createdAt: nowISO(),
      updatedAt: nowISO()
    }, model);
    m.keyRef = (m.apiKey || m.key) ? 'user' : 'system';
    m.key = m.apiKey || m.key || '';
    list.push(m);
    return save().then(function() { return { ok: true, id: m.id }; });
  }

  function update(id, patch) {
    var m = getById(id);
    if (!m) return fail('模型不存在：' + id);
    Object.keys(patch || {}).forEach(function(k) {
      if (patch[k] !== undefined) {
        m[k] = patch[k];
      }
    });
    // key / apiKey 同步
    if (patch.apiKey !== undefined) {
      m.key = m.apiKey || '';
      m.keyRef = m.apiKey ? 'user' : 'system';
    }
    if (patch.key !== undefined) {
      m.apiKey = m.key || '';
      m.keyRef = m.key ? 'user' : 'system';
    }
    m.updatedAt = nowISO();
    return save().then(function() { return { ok: true, model: m }; });
  }

  function remove(id) {
    var idx = list.findIndex(function(m) { return m.id === id; });
    if (idx < 0) return fail('模型不存在：' + id);
    var t = defaultTypeOf(list[idx]);
    var wasDefault = list[idx].isDefault;
    var gone = list[idx];
    if (gone) {
      _removed[gone.id] = 1;
      if (gone.name) _removed[gone.name] = 1;
    }
    list.splice(idx, 1);
    if (wasDefault) {
      // 【三级降级】同类型中找官网下发默认 → 本地默认；都没有则留空白，绝不补 list[0]
      var _rmCands = list.filter(function (m) { return defaultTypeOf(m) === t && m.enabled !== false && m.endpoint; });
      var sub = _rmCands.find(function (m) { return m.isDefault && isZfOfficial(m); }) || _rmCands.find(function (m) { return m.isDefault; }) || null;
      if (sub) {
        sub.isDefault = true;
        if (t === 'language') activeId = sub.id;
      } else if (t === 'language') {
        activeId = null;
      }
    }
    return save();
  }

  function clone(id, opts) {
    var src = getById(id);
    if (!src) return fail('源模型不存在：' + id);
    var newName = (opts && opts.name) || (src.name + '-副本');
    var copy = Object.assign({}, src, {
      id: newName,
      name: newName,
      isDefault: false,
      createdAt: nowISO(),
      updatedAt: nowISO()
    });
    list.push(copy);
    return save().then(function() { return { ok: true, id: copy.id }; });
  }

  function setDefault(id) {
    var m = getById(id);
    if (!m) return fail('模型不存在：' + id);
    list.forEach(function(x) { x.isDefault = (x.id === id); });
    activeId = id;
    return save();
  }

  // 按类型默认：语言大模型 / 识图大模型 各自允许一个默认（同一时间）
  function defaultTypeOf(m) {
    if (!m) return 'language';
    if (m.modelType) {
      // types_vision 归一为 vision（识图）；video 独立类型（视频生成默认）
      if (m.modelType === 'types_vision') return 'vision';
      return m.modelType;
    }
    return m.visionInput ? 'vision' : 'language';
  }

  // 设置某类型的默认模型（同类型互斥，写入 JSON 永久记忆）
  function setDefaultForType(id) {
    var m = getById(id);
    if (!m) return fail('模型不存在：' + id);
    var t = defaultTypeOf(m);
    var wasDefault = !!m.isDefault;
    // 同类型互斥：只清本类型的 isDefault
    list.forEach(function(x) {
      if (defaultTypeOf(x) === t) x.isDefault = (x.id === id && !wasDefault);
    });
    // 语言类默认同时作为全局 activeId，保持向后兼容
    if (t === 'language') activeId = m.isDefault ? id : (list.find(function(x){ return defaultTypeOf(x)==='language' && x.isDefault; }) || {}).id || null;
    return save().then(function() { return { ok: true, type: t, isDefault: !wasDefault }; });
  }

  // 获取某类型当前的默认模型
  function getDefaultFor(type) {
    return resolveDefault(type);
  }

  // 【官方身份判定】官网下发/朱峰通道模型（zf_model_sync 同步来的），与 agent-02-loop-core 的 _isZfM 口径一致
  function isZfOfficial(m) {
    return !!(m && (m.zfLine || m.zfManaged || m.zfPinned ||
      m.keyRef === 'zf_token' || m.keyRef === 'server' ||
      /127\.0\.0\.1:(8527|8509|8554|8787|8788)/.test(String(m.endpoint || '') + String(m.baseUrl || ''))));
  }

  // 【默认模型统一解析】三级优先级：① 官网下发该类型的 isDefault → ② 本地该类型的 isDefault → ③ null（空白）。
  // 绝不"取列表第一个"瞎给模型；官方没有推荐、本地也没设默认时，就返回 null 让上层保持原线路/留空。
  // 【识图特例】识图(vision)类型强制优先朱峰官方推荐识图模型（zf-glm-vision 等），
  // 即使本地用户曾把其他识图模型设为默认，官方推荐仍排第一（站长要求：默认必须走朱峰官方推荐识图）。
  function resolveDefault(type) {
    var _norm = function (t) { return (t === 'types_vision') ? 'vision' : t; };
    var t = _norm(type);
    var cands = list.filter(function (x) {
      return defaultTypeOf(x) === t && x.enabled !== false && x.endpoint;
    });
    var off = cands.find(function (x) { return x.isDefault && isZfOfficial(x); });
    if (t === 'vision') {
      // 识图：官方推荐模型优先（含未携带 isDefault 标记的官方下发条目，如被用户默认覆盖过的 zf-glm-vision）
      off = off || cands.find(function (x) { return isZfOfficial(x) && x.isDefault !== false; });
    }
    if (off) return off;
    var loc = cands.find(function (x) { return x.isDefault; });
    if (loc) return loc;
    return null;
  }

  function setVisible(id, visible) {
    var m = getById(id);
    if (!m) return fail('模型不存在：' + id);
    m.visible = visible;
    return save();
  }

  function move(id, targetIdx) {
    var fromIdx = list.findIndex(function(m) { return m.id === id; });
    if (fromIdx < 0) return fail('模型不存在：' + id);
    var item = list.splice(fromIdx, 1)[0];
    if (fromIdx < targetIdx) targetIdx--;
    list.splice(targetIdx, 0, item);
    return save();
  }

  // ---------- 连通测试 ----------
  function test(input) {
    var m = (input && input.id) ? getById(input.id) : input;
    if (!m) return Promise.resolve({ ok: false, error: '无模型信息' });
    if (!m.endpoint) return Promise.resolve({ ok: false, error: '缺少 API 网址' });
    if (!m.modelId)  return Promise.resolve({ ok: false, error: '缺少模型 ID' });

    if (!m.apiKey || !String(m.apiKey).trim()) {
      return Promise.resolve({ ok: false, error: 'No API Key. Fill your own key to test.' });
    }
    var key = String(m.apiKey).trim();

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function() { if (ctrl) ctrl.abort(); }, 15000);
    var t0 = Date.now();

    // === Smart endpoint detection ===
    var endpoint = String(m.endpoint || '').replace(/\/+$/, '');
    if (/^ark-/.test(key) && !/\/api\/plan(\/|$)/.test(endpoint)) {
      endpoint = 'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions';
      try { console.log('[Models.test] Agent Plan key detected, switching endpoint to', endpoint); } catch(e) {}
    }

    // === CORS 绕过：外部 API 走后端 /api/proxy 代理 ===
    var _isExternal = endpoint && /^https?:/i.test(endpoint);
    var _fetchUrl = _isExternal ? '/api/proxy' : endpoint;
    var _headers = {'Content-Type': 'application/json'};
    if (key) _headers['Authorization'] = 'Bearer ' + key;
    // 生图模型（火山方舟 images/generations 等）必须用 prompt，不能发 messages/max_tokens
    var _imgEndpoint = /images\/generations/i.test(endpoint);
    if (!_imgEndpoint && (m.imageGen || m.modelType === 'vision')) _imgEndpoint = true;
    var _body;
    if (_imgEndpoint) {
      _body = {model: m.modelId, prompt: '一张连通性测试图：晴朗天空下的一只小猫', size: '1920x1920', response_format: 'url'};
    } else {
      _body = {model: m.modelId, messages: [{role: 'user', content: 'ping'}], max_tokens: 1, stream: false};
    }
    var _fetchOpts = _isExternal
      ? {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: ctrl ? ctrl.signal : undefined, body: JSON.stringify({_target_url: endpoint, _method: 'POST', _headers: _headers, _body: _body})}
      : {method: 'POST', headers: _headers, body: JSON.stringify(_body), signal: ctrl ? ctrl.signal : undefined};
    return fetch(_fetchUrl, _fetchOpts).then(function (resp) { return resp.json(); }).then(function (res) {
      var ms = Date.now() - t0;
      clearTimeout(timer);
      // /api/proxy 返回 {ok, status, data, raw}；非外部则 res 即原始 completion
      if (_isExternal) {
        if (res && res.ok) {
      try { recordLatency(m, ms); } catch (e) {}
      return { ok: true, status: res.status || 200, latency: ms, latencyMs: ms, model: m.name };
    }
        var _em = res && (res.error || (res.data && res.data.error && (res.data.error.message || res.data.error))) || (res && res.raw) || 'HTTP ' + ((res && res.status) || '?');
        if (typeof _em !== 'string') try { _em = JSON.stringify(_em); } catch (e2) {}
        return { ok: false, status: (res && res.status) || 0, error: String(_em).slice(0, 300), latency: ms, latencyMs: ms };
      }
      if (resp_ok_check(res)) return { ok: true, status: 200, latency: ms, latencyMs: ms, model: m.name };
      return { ok: false, status: 0, error: '响应异常', latency: ms, latencyMs: ms };
    }).catch(function (e) {
      clearTimeout(timer);
      var ms = Date.now() - t0;
      var msg = (e && e.name === 'AbortError') ? '请求超时(15s)' : ((e && e.message) || '网络错误');
      return { ok: false, error: msg, latency: ms, latencyMs: ms };
    });

    function resp_ok_check(data) {
      return data && data.choices && data.choices[0] && data.choices[0].message;
    }
  }

  // ---------- 导入导出 ----------
  function exportJSON() {
    return JSON.stringify({ version: 5, list: list, activeId: activeId }, null, 2);
  }
  function importJSON(str) {
    var data = safeParse(str, null);
    if (!data || !Array.isArray(data.list)) return fail('JSON 格式错误');
    list.length = 0;
    data.list.forEach(function(m) { normalizeModel(m); list.push(m); });
    // 恢复保存的 activeId；官方下发默认 → 本地默认 → 空白，绝不取 list[0]
    var _lc = list.filter(function (m) { return m.enabled !== false && m.endpoint; });
    var _ld = _lc.find(function (m) { return m.isDefault && isZfOfficial(m); }) || _lc.find(function (m) { return m.isDefault; }) || null;
    activeId = data.activeId || (_ld && _ld.id) || null;
    return save();
  }

  // ---------- 异步初始化 ----------
  load();

  // ---------- 每条模型线路独立维护的模型 ID 列表 ----------
  function modelIdsFor(modelOrId) {
    var model = typeof modelOrId === 'string' ? getById(modelOrId) : modelOrId;
    if (!model) return [];
    var ids = Array.isArray(model.modelIdOptions) ? model.modelIdOptions.slice() : [];
    var defaultId = String(model.modelId || '').trim();
    if (defaultId && ids.indexOf(defaultId) < 0) ids.unshift(defaultId);
    return ids.filter(function(id, index, all) {
      return typeof id === 'string' && id.trim() && all.indexOf(id) === index;
    });
  }

  function addModelIdOption(modelId, value) {
    var model = getById(modelId);
    var id = String(value || '').trim();
    if (!model) return fail('未找到模型线路');
    if (!id) return fail('模型 ID 不能为空');
    var ids = modelIdsFor(model);
    if (ids.indexOf(id) >= 0) return fail('该模型 ID 已存在');
    model.modelIdOptions = ids.concat([id]);
    return save().then(function(result) {
      return result.ok ? ok({ modelId: id }) : result;
    });
  }

  function removeModelIdOption(modelId, value) {
    var model = getById(modelId);
    var id = String(value || '').trim();
    if (!model) return fail('未找到模型线路');
    if (!id) return fail('请选择要删除的模型 ID');
    var all = modelIdsFor(model);
    var rest = all.filter(function(item) { return item !== id; });
    if (rest.length === all.length) return fail('未找到该模型 ID');
    // 若删除的是线路默认模型 ID，自动把剩余第一个提升为新默认
    if (id === String(model.modelId || '').trim()) {
      if (!rest.length) return fail('至少保留一个模型 ID，不能删除最后一个');
      model.modelId = rest[0];
    }
    model.modelIdOptions = rest;
    return save();
  }

  // ---------- 模型延迟记录（localStorage，测速结果供列表展示/排序） ----------
  var LATENCY_KEY = 'zf_model_latency_v1';
  function _latencyMap() {
    try { return JSON.parse(localStorage.getItem(LATENCY_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  // recordLatency(m, ms)：记录一次实测延迟（指数平滑，最近时间戳）
  function recordLatency(m, ms) {
    if (!m || !m.id || !(ms >= 0)) return;
    var map = _latencyMap();
    var rec = map[m.id];
    if (rec && rec.avg > 0) rec.avg = Math.round(rec.avg * 0.6 + ms * 0.4);
    else rec = { avg: Math.round(ms), last: Math.round(ms), ts: Date.now() };
    rec.last = Math.round(ms); rec.ts = Date.now();
    map[m.id] = rec;
    try { localStorage.setItem(LATENCY_KEY, JSON.stringify(map)); } catch (e) {}
  }
  // getLatency(id)：返回 {avg,last,ts} 或 null（超过24小时视为过期）
  function getLatency(id) {
    var rec = _latencyMap()[id];
    if (!rec || !rec.ts || (Date.now() - rec.ts > 24 * 3600 * 1000)) return null;
    return rec;
  }
  // latencyText(id)：'624ms' 或 ''
  function latencyText(id) {
    var r = getLatency(id);
    return r ? (r.avg >= 10000 ? (r.avg / 1000).toFixed(1) + 's' : r.avg + 'ms') : '';
  }

  // ---------- 暴露 ----------
  global.Models = {
    list: list,
    modelIdsFor: modelIdsFor,
    addModelIdOption: addModelIdOption,
    removeModelIdOption: removeModelIdOption,
    get activeId() { return activeId; },
    set activeId(v) { activeId = v; },
    newId: newId,
    getById: getById,
    get: getById,
    add: add,
    update: update,
    remove: remove,
    clone: clone,
    setDefault: setDefault,
    setDefaultForType: setDefaultForType,
    getDefaultFor: getDefaultFor,
    resolveDefault: resolveDefault,
    defaultTypeOf: defaultTypeOf,
    setVisible: setVisible,
    move: move,
    test: test,
    recordLatency: recordLatency,
    getLatency: getLatency,
    latencyText: latencyText,
    save: save,
    load: load,
    isZfOfficial: isZfOfficial,
    exportJSON: exportJSON,
    importJSON: importJSON
  };

  // _loaded 通过 getter 访问（load() 异步完成后变为 true）
  Object.defineProperty(global.Models, '_loaded', {
    get: function() { return _loaded; },
    enumerable: true,
    configurable: true
  });


})(window);
