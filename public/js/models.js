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
        // 找默认模型
        var def = list.find(function(m) { return m.isDefault; });
        activeId = def ? def.id : (list[0] ? list[0].id : null);
        _loaded = true;
        // 同步到 localStorage 作为备份
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
          localStorage.setItem(ACTIVE_KEY, activeId || '');
        } catch (e) {}
        return ok({ count: list.length, activeId: activeId });
      })
      .catch(function(err) {
        console.error('[Models] load from backend failed:', err);
        // 降级到 localStorage
        var raw = localStorage.getItem(STORAGE_KEY);
        var parsed = safeParse(raw, null);
        if (Array.isArray(parsed) && parsed.length) {
          list.length = 0;
          parsed.forEach(function(m) { normalizeModel(m); list.push(m); });
        }
        activeId = localStorage.getItem(ACTIVE_KEY) || null;
        if (activeId && !list.some(function(m) { return m.id === activeId; })) {
          var def2 = list.find(function(m) { return m.isDefault; }) || list[0];
          activeId = def2 ? def2.id : null;
        }
        _loaded = true;
        return ok({ count: list.length, activeId: activeId, warn: 'backend fallback: ' + (err && err.message || err) });
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
    return fetch('/api/models/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data || !data.ok) throw new Error((data && data.err) || '保存失败');
      // 用后端返回的合并数据更新 list（确保 key 同步）
      if (data.config && Array.isArray(data.config.list)) {
        list.length = 0;
        data.config.list.forEach(function(m) { normalizeModel(m); list.push(m); });
      }
      // 同步 localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        localStorage.setItem(ACTIVE_KEY, activeId || '');
      } catch (e) {}
      return ok({ count: list.length, activeId: activeId });
    })
    .catch(function(err) {
      console.error('[Models] save to backend failed:', err);
      // 降级到 localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        localStorage.setItem(ACTIVE_KEY, activeId || '');
      } catch (e) {}
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
      version: '',
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
    var wasDefault = list[idx].isDefault;
    list.splice(idx, 1);
    if (wasDefault && list.length) {
      list[0].isDefault = true;
      activeId = list[0].id;
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
    var _body = {model: m.modelId, messages: [{role: 'user', content: 'ping'}], max_tokens: 1, stream: false};
    var _fetchOpts = _isExternal
      ? {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: ctrl ? ctrl.signal : undefined, body: JSON.stringify({_target_url: endpoint, _method: 'POST', _headers: _headers, _body: _body})}
      : {method: 'POST', headers: _headers, body: JSON.stringify(_body), signal: ctrl ? ctrl.signal : undefined};
    return fetch(_fetchUrl, _fetchOpts).then(function (resp) { return resp.json(); }).then(function (res) {
      var ms = Date.now() - t0;
      clearTimeout(timer);
      // /api/proxy 返回 {ok, status, data, raw}；非外部则 res 即原始 completion
      if (_isExternal) {
        if (res && res.ok) return { ok: true, status: res.status || 200, latency: ms, latencyMs: ms, model: m.name };
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
    activeId = data.activeId || (list[0] && list[0].id) || null;
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
    if (id === model.modelId) return fail('不能删除线路默认模型 ID，请先在模型设置中修改默认值');
    var ids = modelIdsFor(model).filter(function(item) { return item !== id; });
    if (ids.length === modelIdsFor(model).length) return fail('未找到该模型 ID');
    model.modelIdOptions = ids;
    return save();
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
    setVisible: setVisible,
    move: move,
    test: test,
    save: save,
    load: load,
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
