/* =====================================================================
 * model-config-rewrite.js - Settings model configuration panel
 * Model types are stored in the existing models API through modelType.
 * Only language models participate in the conversational model picker.
 * ===================================================================== */
(function (global) {
  'use strict';

  var SCOPE = '[模型配置]';
  var TYPES = [
    { id: 'language', label: '语言模型', icon: 'AI' },
    { id: 'embedding', label: '向量化模型', icon: 'VE' },
    { id: 'vision', label: '视觉模型', icon: 'VI' },
    { id: 'types_vision', label: '识图模型', icon: 'OR' },
    { id: 'speech', label: '语音模型', icon: 'AU' }
  ];
  // Each category owns its own filtered configuration list in the panel.
  // Model type remains persisted on the model record as `modelType`.
  var ARK_BASE = 'https://ark.cn-beijing.volces.com/api/plan/v3';
  var PRESETS = {
    language: { name: '', endpoint: ARK_BASE + '/chat/completions', modelId: '', provider: 'ark' },
    embedding: { name: '火山方舟向量化', endpoint: ARK_BASE, modelId: 'doubao-embedding-vision', provider: 'ark' },
    vision: { name: '火山方舟视觉', endpoint: ARK_BASE + '/images/generations', modelId: 'doubao-seedream-5.0-lite', provider: 'ark' },
    speech: { name: '火山方舟语音', endpoint: 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional', modelId: 'seed-tts-2.0', provider: 'ark' }
  };
  var SPEECH_MODELS = ['seed-tts-2.0', 'volc.seedasr.sauc.duration'];
  var activeType = 'language';
  var editingId = null;
  var editingModelIds = [];   // 新建（未保存）编辑器会话内的临时模型 ID 列表
  var listCache = [];
  var mountedRoot = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(msg, type) {
    var kind = type || 'success';
    if (global.toast) { try { global.toast(msg, kind); return; } catch (e) {} }
    // 兜底：项目未注册全局 toast 时，用 ToastStack 自绘提示条（否则用户看不到任何反馈）
    if (global.ToastStack && typeof global.ToastStack.show === 'function') {
      try {
        var colors = {
          success: ['#e8f7ee', '#1a7f4b', '#2ecc71'],
          error:   ['#fdeaea', '#a12622', '#e74c3c'],
          info:    ['#eaf2fd', '#1d5fbf', '#3b82f6']
        }[kind] || ['#eee', '#333', '#666'];
        var el = document.createElement('div');
        el.textContent = SCOPE + ' ' + msg;
        el.style.cssText =
          'padding:10px 16px;border-radius:8px;font-size:13px;line-height:1.5;' +
          'max-width:380px;word-break:break-all;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
          'background:' + colors[0] + ';color:' + colors[1] + ';' +
          'border-left:4px solid ' + colors[2] + ';';
        global.ToastStack.show(el, kind === 'error' ? 5000 : 3000);
        return;
      } catch (e) {}
    }
    (kind === 'error' ? console.error : console.log)(SCOPE, msg);
  }  function modelType(model) { return model.modelType || 'language'; }
  function typeLabel(type) { var item = TYPES.find(function (x) { return x.id === type; }); return item ? item.label : type; }
  function modelIdsForType(type) {
    var items = listCache.filter(function (model) {
      return modelType(model) === type;
    });
    var ids = [];
    items.forEach(function (model) {
      var values = Array.isArray(model.modelIdOptions) ? model.modelIdOptions : [];
      values.concat([model.modelId]).forEach(function (value) {
        value = String(value || '').trim();
        if (value && ids.indexOf(value) < 0) ids.push(value);
      });
    });
    return ids;
  }
  function maskKey(key) { return key ? (key.length <= 8 ? '****' : key.slice(0, 4) + '****' + key.slice(-4)) : '未配置'; }

  function mount(container) {
    if (!container) return;
    mountedRoot = container;
    container.innerHTML = renderShell();
    // Bind immediately so the panel remains usable while configuration loads.
    // 防重复绑定：同一容器多次 mount 时跳过，避免 click 监听叠加（眼睛按钮点击两次互相抵消、看似无反应）。
    if (container._mcEventsBound) { renderList(container); refresh(container).catch(function () { renderList(container); }); return; }
    container._mcEventsBound = true;
    bind(container);
    // Models.load() may already have completed during app startup. Render that
    // in-memory data immediately so opening settings never shows stale zeroes.
    renderList(container);
    refresh(container).catch(function (error) {
      console.error(SCOPE, '加载模型配置失败:', error);
      var listEl = $('[data-mc-list]', container);
      if (listEl) listEl.innerHTML = '<div class="mc-empty">模型配置加载失败，请检查服务是否已启动。</div>';
      renderList(container);
    });
  }

  function renderShell() {
    return [
      '<div class="mc-wrap" data-mc-wrap>',
      '  <nav class="mc-category-menu" aria-label="模型分类">',
      '    <div class="mc-type-tabs" role="tablist" aria-label="模型分类">',
      TYPES.map(function (item) { return '<button class="mc-type-tab" type="button" data-mc-type="' + item.id + '" role="tab" aria-selected="false" aria-controls="mc-model-list"><span class="mc-type-icon">' + item.icon + '</span><strong>' + item.label + '</strong><span class="mc-type-total" data-mc-type-total="' + item.id + '">0</span></button>'; }).join(''),
      '    </div>',
      '  </nav>',
      '  <div class="mc-toolbar" hidden><div class="mc-toolbar-left"></div><div class="mc-toolbar-right"><button class="mc-btn mc-btn-primary" data-mc-add>＋ 添加大模型</button></div></div>',
      '  <div class="mc-type-notice" data-mc-notice></div>',
      '  <div class="mc-list" id="mc-model-list" data-mc-list role="tabpanel"></div>',
      '  <div class="mc-edit-panel" data-mc-edit hidden><div class="mc-edit-inner">',
      '    <h3 data-mc-edit-title>添加配置</h3>',
      '    <form class="mc-form" onsubmit="return false;">',
      '      <label>模型类型 <span class="mc-req">*</span><select data-mc-field="modelType">' + TYPES.map(function (item) { return '<option value="' + item.id + '">' + item.label + '</option>'; }).join('') + '</select></label>',
      '      <label>名称 <span class="mc-req">*</span><input type="text" data-mc-field="name" placeholder="例如：火山方舟向量化" /></label>',
      '      <label>接口地址 <span class="mc-req">*</span><input type="text" data-mc-field="endpoint" placeholder="https://..." autocomplete="url" /></label>',
      '      <label>官网地址<input type="url" data-mc-field="officialUrl" placeholder="https://..." autocomplete="url" /></label>',
      '      <label>API Key<div class="mc-key-row"><input type="password" data-mc-field="apiKey" placeholder="请输入火山方舟 API Key" autocomplete="off"><button class="mc-eye-btn" type="button" data-mc-key-toggle title="显示/隐藏" aria-label="显示或隐藏 API Key">👁</button></div></label>',
      '      <label>模型 / Resource-Id <span class="mc-req">*</span><div class="mc-key-row"><select data-mc-field="modelId" style="flex:1;min-width:0;"><option value="">请选择模型 ID</option></select><button class="mc-eye-btn" type="button" data-mc-id-add title="添加模型 ID" aria-label="添加模型 ID">＋</button><button class="mc-eye-btn" type="button" data-mc-id-del title="删除当前选中的模型 ID" aria-label="删除模型 ID">－</button></div></label>',
      '      <label class="mc-language-only">思考强度<select data-mc-field="reasoningEffort"></select></label>',
      '    <div class="mc-edit-actions"><span class="mc-edit-spacer"></span><button class="mc-btn mc-btn-ghost" type="button" data-mc-cancel>取消</button><button class="mc-btn mc-btn-primary" type="button" data-mc-save>保存修改</button></div>',
      '    </form>',
      '  </div></div>',
      '</div>'
    ].join('\n');
  }

  function refresh(root) {
    var render = function () { renderList(root || mountedRoot); };
    if (global.Models && typeof global.Models.load === 'function') return global.Models.load().then(render);
    return Promise.resolve(render());
  }

  function renderList(root) {
    root = root || mountedRoot;
    listCache = global.Models && Array.isArray(global.Models.list) ? global.Models.list : [];
    var items = listCache.filter(function (model) { return modelType(model) === activeType; });
    var listEl = root ? $('[data-mc-list]', root) : null;
    var notice = root ? $('[data-mc-notice]', root) : null;
    if (notice) notice.innerHTML = noticeFor(activeType);
    (root ? root.querySelectorAll('[data-mc-type]') : []).forEach(function (tab) {
      var selected = tab.getAttribute('data-mc-type') === activeType;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    TYPES.forEach(function (type) {
      var total = listCache.filter(function (model) { return modelType(model) === type.id; }).length;
      var totalEl = root ? $('[data-mc-type-total="' + type.id + '"]', root) : null;
      if (totalEl) totalEl.textContent = total;
    });
    if (!listEl) return;
    if (!items.length) { listEl.innerHTML = '<div class="mc-empty">暂未配置' + typeLabel(activeType) + '，在下方表单填写即可添加。</div>' + renderAddCard(); return; }
    listEl.innerHTML = items.map(renderModelItem).join('') + renderAddCard();
  }

  function languageModelIds() {
    // Use the current line's IDs so free zhipu/siliconflow models are not lost in the panel.
    var current = listCache.filter(function (model) { return modelType(model) === 'language'; })[0];
    if (current && global.Models && typeof global.Models.modelIdsFor === 'function') return global.Models.modelIdsFor(current) || [];
    return [];
  }

  // Model ID options for the add-model editor: language models share a common
  // list (first language model's modelIdOptions); other types use fixed lists.
  function modelIdOptionsFor(type) {
    if (type === 'vision') return modelIdsForType('vision');
    if (type === 'speech') return SPEECH_MODELS.slice();
    if (type === 'embedding') return ['doubao-embedding-vision'];
    return languageModelIds();
  }
  function selectOptions(options, selected) {
    var list = (options || []).slice();
    if (selected && list.indexOf(selected) < 0) list.unshift(selected);
    return '<option value="">请选择模型 ID</option>' + list.map(function (value) { return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>'; }).join('');
  }

  function renderModelItem(model) {
    var id = esc(model.id);
    var type = modelType(model);
    var levels = global.ReasoningLevels && global.ReasoningLevels.listFor ? global.ReasoningLevels.listFor(model.modelId || '') : [{ value: 'medium', label: '中' }];
    var reasoning = levels.map(function (item) { return '<option value="' + esc(item.value) + '"' + (item.value === (model.reasoningEffort || 'medium') ? ' selected' : '') + '>' + esc(item.label || item.value) + '</option>'; }).join('');
    var ownIds = (global.Models && typeof global.Models.modelIdsFor === 'function') ? global.Models.modelIdsFor(model) : (Array.isArray(model.modelIdOptions) ? model.modelIdOptions : []);
    var modelField = '<div class="mc-key-row"><select data-inline-field="modelId" style="flex:1;min-width:0;">' + selectOptions(ownIds, model.modelId) + '</select><button class="mc-eye-btn" type="button" data-act="id-add" title="添加模型 ID" aria-label="添加模型 ID">＋</button><button class="mc-eye-btn" type="button" data-act="id-del" title="删除当前选中的模型 ID" aria-label="删除模型 ID">－</button></div>';
    return '<article class="mc-item mc-item-expanded" data-id="' + id + '">' +
      '<div class="mc-item-heading"><div><div class="mc-item-name">' + esc(model.name || '未命名模型') + '</div><div class="mc-item-meta"><span>' + esc(typeLabel(type)) + '</span><span>' + (model.imageGen ? '支持生图' : '') + (model.visionInput ? '支持识图' : '不支持识图') + '</span><span>密钥 ' + esc(maskKey(model.apiKey)) + '</span></div></div>' +
      '<div class="mc-item-tools"><button class="mc-icon-btn" type="button" data-act="move-up" title="上移">↑</button><button class="mc-icon-btn" type="button" data-act="move-down" title="下移">↓</button><button class="mc-icon-btn" type="button" data-act="visible" title="' + (model.visible === false ? '显示此模型' : '隐藏此模型') + '" style="display:inline-flex;align-items:center;justify-content:center;">' + (model.visible === false
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1890ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>') + '</button><button class="mc-icon-btn" type="button" data-act="copy" title="复制配置">⧉</button><button class="mc-icon-btn mc-icon-danger" type="button" data-act="del" title="删除配置">×</button></div></div>' +
      '<form class="mc-form mc-inline-form" onsubmit="return false">' +
      '<label>模型类型<select data-inline-field="modelType">' + TYPES.map(function (item) { return '<option value="' + item.id + '"' + (item.id === type ? ' selected' : '') + '>' + item.label + '</option>'; }).join('') + '</select></label>' +
      '<label>名称<input type="text" data-inline-field="name" value="' + esc(model.name) + '" autocomplete="off"></label>' +
      '<label>接口地址<input type="text" data-inline-field="endpoint" value="' + esc(model.endpoint || model.baseUrl) + '" autocomplete="off"></label>' +
      '<label>官网地址<input type="url" data-inline-field="officialUrl" value="' + esc(model.officialUrl) + '" autocomplete="off"></label>' +
      '<label>API Key<div class="mc-key-row"><input type="password" data-inline-field="apiKey" value="' + esc(model.apiKey) + '" placeholder="API Key" autocomplete="new-password"><button class="mc-eye-btn" type="button" data-act="key-toggle" title="显示/隐藏" aria-label="显示或隐藏 API Key">👁</button></div></label>' +
      '<label>模型 / Resource-Id ' + modelField + '</label>' +
      (type === 'language' ? '<label>思考强度<select data-inline-field="reasoningEffort">' + reasoning + '</select></label>' : '') +
      '</form><div class="mc-edit-actions"><span class="mc-edit-spacer"></span>' +
      '<button type="button" class="mc-btn mc-btn-primary" data-act="save">提交</button><button type="button" class="mc-btn mc-btn-ghost" data-act="test">测试</button><button type="button" class="mc-btn mc-btn-ghost" data-act="clear" title="清空 API Key">清空</button><button type="button" class="mc-btn mc-btn-ghost" data-act="official">官网</button></div></article>';
  }

  // ===== 底部「添加」卡片：与上方行内编辑表单完全同款格式（只是空的） =====
  function renderAddCard() {
    var type = activeType;
    var levels = global.ReasoningLevels && global.ReasoningLevels.listFor ? global.ReasoningLevels.listFor('') : [{ value: 'medium', label: '中' }];
    var reasoning = levels.map(function (item, idx) { return '<option value="' + esc(item.value) + '"' + (idx === 0 ? ' selected' : '') + '>' + esc(item.label || item.value) + '</option>'; }).join('');
    return '<article class="mc-item mc-item-expanded mc-add-card" data-mc-add-card style="border-style:dashed;">' +
      '<div class="mc-item-heading"><div><div class="mc-item-name">＋ 添加' + typeLabel(type) + '</div><div class="mc-item-meta"><span>填写后点「💾 保存」即可新增</span></div></div></div>' +
      '<form class="mc-form mc-inline-form" onsubmit="return false">' +
      '<label>名称<input type="text" data-mc-new-field="name" placeholder="例如：火山方舟" autocomplete="off"></label>' +
      '<label>接口地址<input type="text" data-mc-new-field="endpoint" value="' + esc((PRESETS[type] && PRESETS[type].endpoint) || ARK_BASE) + '" autocomplete="off"></label>' +
      '<label>官网地址<input type="url" data-mc-new-field="officialUrl" placeholder="https://..." autocomplete="url"></label>' +
      '<label>API Key<div class="mc-key-row"><input type="password" data-mc-new-field="apiKey" placeholder="请输入 API Key" autocomplete="new-password"><button class="mc-eye-btn" type="button" data-mc-new-key-toggle title="显示/隐藏" aria-label="显示或隐藏 API Key">👁</button></div></label>' +
      '<label>模型 / Resource-Id <span class="mc-req">*</span><div class="mc-key-row"><select data-mc-new-field="modelId" style="flex:1;min-width:0;"><option value="">请选择模型 ID</option></select><button class="mc-eye-btn" type="button" data-mc-new-id-add title="添加模型 ID" aria-label="添加模型 ID">＋</button><button class="mc-eye-btn" type="button" data-mc-new-id-del title="删除当前选中的模型 ID" aria-label="删除模型 ID">－</button></div></label>' +
      (type === 'language' ? '<label>思考强度<select data-mc-new-field="reasoningEffort">' + reasoning + '</select></label>' : '') +
      '</form><div class="mc-edit-actions"><span class="mc-edit-spacer"></span>' +
      '<button type="button" class="mc-btn mc-btn-primary" data-act="add-save">💾 保存</button><button type="button" class="mc-btn mc-btn-ghost" data-act="add-test">测试</button></div></article>';
  }

  function addCardSyncIds(card, selectedValue) {
    var select = card.querySelector('[data-mc-new-field="modelId"]');
    if (select) select.innerHTML = selectOptions(editingModelIds.slice(), selectedValue || '');
  }

  // 从「添加」卡片收集当前填写内容并测试连通性
  function testAddCard(card) {
    function f(name) { var el = card.querySelector('[data-mc-new-field="' + name + '"]'); return el ? el.value.trim() : ''; }
    var data = { name: f('name') || ('新' + typeLabel(activeType)), endpoint: f('endpoint'), apiKey: f('apiKey'), modelId: f('modelId') };
    if (!data.endpoint || !data.modelId || !data.apiKey) { toast('请先填写接口地址、模型 / Resource-Id 和 API Key', 'error'); return; }
    var button = card.querySelector('[data-act="add-test"]');
    var original = button ? button.textContent : '测试';
    if (button) { button.disabled = true; button.textContent = '测试中...'; }
    Promise.resolve(global.Models.test(data)).then(function (result) {
      if (result && result.ok) toast('「' + data.name + '」连通成功（' + (result.latencyMs || 0) + 'ms）');
      else toast('「' + data.name + '」连通失败：' + ((result && result.error) || '未知错误'), 'error');
    }).catch(function (error) { toast('测试出错：' + error.message, 'error'); }).then(function () {
      var btnNow = card.querySelector('[data-act="add-test"]');
      if (btnNow) { btnNow.disabled = false; btnNow.textContent = original; }
    });
  }

  function saveAddCard(card) {
    function f(name) { var el = card.querySelector('[data-mc-new-field="' + name + '"]'); return el ? el.value.trim() : ''; }
    var data = { name: f('name'), endpoint: f('endpoint'), baseUrl: f('endpoint'), officialUrl: f('officialUrl'), apiKey: f('apiKey'), modelId: f('modelId'), modelIdOptions: editingModelIds.filter(function (v) { return v && v !== f('modelId'); }), provider: 'ark', modelType: activeType, reasoningEffort: activeType === 'language' ? (f('reasoningEffort') || 'medium') : '', visible: activeType === 'language', imageGen: activeType === 'vision', visionInput: activeType === 'types_vision', visionInputFormats: activeType === 'types_vision' ? ['url', 'base64'] : [] };
    if (!data.name || !data.endpoint || !data.modelId) { toast('请填写名称、接口地址和模型 / Resource-Id', 'error'); return; }
    var button = card.querySelector('[data-act="add-save"]');
    if (button) { button.disabled = true; button.textContent = '保存中...'; }
    Promise.resolve(global.Models.add(data)).then(function (result) {
      if (!result || !result.ok) { toast((result && result.error) || '添加失败', 'error'); if (button) { button.disabled = false; button.textContent = '💾 保存'; } return; }
      toast('✓ 已添加「' + data.name + '」（' + typeLabel(activeType) + '）');
      renderList();
    }).catch(function (error) { toast('添加出错：' + error.message, 'error'); if (button) { button.disabled = false; button.textContent = '💾 保存'; } });
  }

  function inlineData(item) {
    var data = {};
    item.querySelectorAll('[data-inline-field]').forEach(function (field) { data[field.getAttribute('data-inline-field')] = field.value.trim(); });
    data.baseUrl = data.endpoint;
    data.provider = 'ark';
    data.visible = data.modelType === 'language';
    data.imageGen = data.modelType === 'vision';
    data.visionInput = data.modelType === 'types_vision';
    data.visionInputFormats = data.visionInput ? ['url', 'base64'] : [];
    if (data.modelType !== 'language') data.reasoningEffort = '';
    return data;
  }

  function saveInline(item) {
    var data = inlineData(item);
    if (!data.name || !data.endpoint || !data.modelId) { toast('请填写名称、接口地址和模型 / Resource-Id', 'error'); return; }
    var button = item.querySelector('[data-act="save"]');
    if (button) { button.disabled = true; button.textContent = '保存中...'; }
    Promise.resolve(global.Models.update(item.getAttribute('data-id'), data)).then(function (result) {
      if (!result || !result.ok) { toast((result && result.error) || '保存失败', 'error'); return; }
      // 【2026 修复】静默保存：只弹保存成功提示，不做任何会改变对话模型通道的动作
      // （不改 activeId、不改聊天线路的 _modelIdOverride、不动其它行内表单的选中值）。
      var button2 = item.querySelector('[data-act="save"]');
      toast('✓ 已保存「' + (data.name || '') + '」配置');
      renderList();
      if (button2) { button2.disabled = false; button2.textContent = '提交'; }
    }).catch(function (error) { toast('保存出错：' + error.message, 'error'); }).then(function () {
      var btnNow = item.querySelector('[data-act="save"]');
      if (btnNow) { btnNow.disabled = false; btnNow.textContent = '提交'; }
    });
  }

  // ---------- 模型 / Resource-Id 的增加与删除（闭环） ----------
  // target 既可以是已保存配置的 id（持久化到 Models），也可以是临时数组 editingModelIds
  //（新建尚未保存的编辑器会话），保证＋/－在任何状态下都能弹窗/删除。
  function addModelIdPrompt(select, target, onChange) {
    var isTemp = Array.isArray(target);
    var notify = function () { if (typeof onChange === 'function') onChange(); };
    var doAdd = function(id) {
      id = String(id || '').trim();
      if (!id) return;
      // 【改进】模型 ID 一般为英文字母/数字/点/横线/斜线/冒号/下划线，挡住误输入中文或带空格的值
      if (/[\s\u4e00-\u9fff]/.test(id)) { toast('模型 ID 不能包含空格或中文', 'error'); return; }
      if (isTemp) {
        if (target.indexOf(id) >= 0) { toast('该模型 ID 已存在', 'error'); return; }
        target.push(id);
        syncEditorModelIdOptions(id);
        notify();
        toast('✓ 已添加模型 ID：' + id + '（点击「保存修改」后生效）');
        return;
      }
      Promise.resolve(global.Models.addModelIdOption(target, id)).then(function (result) {
        if (!result || !result.ok) { toast((result && result.error) || '添加模型 ID 失败', 'error'); return; }
        toast('✓ 已添加模型 ID：' + id);
        // 【2026 修复】不再 dispatch 合成 change 事件：
        // 该事件会在底层选择器中触发 saveModelIdOverride，把正在编辑的对话线路
        // 立即切到新加的 ID（表现为"提交后窜到另一个大模型通道"）。
        // 这里只更新行内下拉显示，实际通道切换由用户在下拉里主动选择时发生。
        if (select) { select.value = id; }
        renderList();
      }).catch(function (error) { toast('添加模型 ID 出错：' + error.message, 'error'); });
    };
    if (global.ConfirmDialog && global.ConfirmDialog.prompt) {
      global.ConfirmDialog.prompt({ title: '添加模型 ID', message: '请输入要添加的模型 / Resource-Id：', placeholder: '如：glm-5.3' }).then(doAdd);
    } else {
      doAdd(global.prompt('请输入要添加的模型 / Resource-Id:'));
    }
  }
  function removeSelectedModelId(select, target) {
    if (!select) return;
    var id = String(select.value || '').trim();
    if (!id) { toast('请先在下拉列表中选中要删除的模型 ID', 'error'); return; }
    var isTemp = Array.isArray(target);
    var doRemove = function(ok) {
      if (!ok) return;
      if (isTemp) {
        var idx = target.indexOf(id);
        if (idx < 0) { toast('未找到该模型 ID', 'error'); return; }
        target.splice(idx, 1);
        syncEditorModelIdOptions('');
        toast('已删除模型 ID：' + id);
        return;
      }
      Promise.resolve(global.Models.removeModelIdOption(target, id)).then(function (result) {
        if (result && result.ok === false) { toast(result.error || '删除模型 ID 失败', 'error'); return; }
        toast('已删除模型 ID：' + id);
        renderList();
      }).catch(function (error) { toast('删除模型 ID 出错：' + error.message, 'error'); });
    };
    if (global.ConfirmDialog && global.ConfirmDialog.confirm) {
      global.ConfirmDialog.confirm({ title: '删除模型 ID', message: '确认从下拉列表中删除模型 ID「' + id + '」？', danger: true, okText: '删除' }).then(doRemove);
    } else {
      doRemove(global.confirm('确认从下拉列表中删除模型 ID「' + id + '」？'));
    }
  }

  function toggleInlineKey(item, button) {
    var input = item.querySelector('[data-inline-field="apiKey"]');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    button.classList.toggle('is-shown', input.type === 'text');
  }

  function testInline(item) {
    var data = inlineData(item);
    if (!data.endpoint || !data.modelId || !data.apiKey) { toast('请先填写接口地址、模型 / Resource-Id 和 API Key', 'error'); return; }
    var button = item.querySelector('[data-act="test"]');
    var original = button ? button.textContent : '连通测试';
    if (button) { button.disabled = true; button.textContent = '测试中...'; }
    Promise.resolve(global.Models.test(data)).then(function (result) {
      if (result && result.ok) toast('「' + (data.name || '该模型') + '」连通成功（' + (result.latencyMs || 0) + 'ms）');
      else toast('「' + (data.name || '该模型') + '」连通失败：' + ((result && result.error) || '未知错误'), 'error');
    }).catch(function (error) { toast('测试出错：' + error.message, 'error'); }).then(function () { if (button) { button.disabled = false; button.textContent = original; } });
  }

  function noticeFor(type) {
    if (type === 'embedding') return '向量化模型：方便搜索的模型种类，可将文本转为向量，用于知识库检索、语义搜索和相似度匹配，是快速搜索知识库的底层支撑。';
    if (type === 'vision') return '视觉模型：允许生成和修改图片、视频等内容。输入文字描述即可创作画面，也可对已有图片进行编辑与再生成。';
    if (type === 'types_vision') return '识图模型：可以"看清"图片和视频的具体内容，理解画面中的物体、文字与场景，常用于图片问答与内容分析。';
    if (type === 'speech') return '语音模型：可以识别语音并转换为文字（语音转文字），也能把文字合成为自然流畅的语音（文字转语音）。';
    return '语言模型：你可以创建一个大模型设置，连通到该模型后直接和它进行对话。可用于聊天、智能体和工具调用，建议选择 GLM-5.3-Flash——目前很划算，速度也很快。';
  }

  function bind(root) {
    root.addEventListener('click', function (event) {
      var typeTab = event.target.closest('[data-mc-type]');
      if (typeTab) { activeType = typeTab.getAttribute('data-mc-type'); editingId = null; editingModelIds = []; hideEditor(); renderList(); return; }
      if (event.target.closest('[data-mc-add]')) { openEditor(null); return; }
      if (event.target.closest('[data-mc-cancel]')) { hideEditor(); return; }
      if (event.target.closest('[data-mc-save]')) { saveEditor(); return; }
      if (event.target.closest('[data-mc-key-toggle]')) { var input = $('[data-mc-field="apiKey"]', root); input.type = input.type === 'password' ? 'text' : 'password'; event.target.closest('[data-mc-key-toggle]').classList.toggle('is-shown', input.type === 'text'); return; }
      if (event.target.closest('[data-mc-id-add]')) { var selAdd = $('[data-mc-field="modelId"]', root); addModelIdPrompt(selAdd, editingId || editingModelIds); return; }
      if (event.target.closest('[data-mc-id-del]')) { var selDel = $('[data-mc-field="modelId"]', root); removeSelectedModelId(selDel, editingId || editingModelIds); return; }
      var addCard = event.target.closest('[data-act="add-save"]');
      if (addCard) { saveAddCard(event.target.closest('[data-mc-add-card]')); return; }
      var testAdd = event.target.closest('[data-act="add-test"]');
      if (testAdd) { testAddCard(event.target.closest('[data-mc-add-card]')); return; }
      if (event.target.closest('[data-mc-new-key-toggle]')) { var newKeyInput = event.target.closest('.mc-key-row').querySelector('[data-mc-new-field="apiKey"]'); newKeyInput.type = newKeyInput.type === 'password' ? 'text' : 'password'; event.target.closest('[data-mc-new-key-toggle]').classList.toggle('is-shown', newKeyInput.type === 'text'); return; }
      if (event.target.closest('[data-mc-new-id-add]')) { var card1 = event.target.closest('[data-mc-add-card]'); addModelIdPrompt(card1.querySelector('[data-mc-new-field="modelId"]'), editingModelIds, function () { addCardSyncIds(card1); }); return; }
      if (event.target.closest('[data-mc-new-id-del]')) { var card2 = event.target.closest('[data-mc-add-card]'); removeSelectedModelId(card2.querySelector('[data-mc-new-field="modelId"]'), editingModelIds); addCardSyncIds(card2, ''); return; }
      var action = event.target.closest('button[data-act]');
      if (!action) return;
      if (addCard && action.getAttribute('data-act') === 'save') { /* fallthrough */ }
      var item = action.closest('.mc-item-expanded');
      var id = action.getAttribute('data-id') || (item && item.getAttribute('data-id'));
      var act = action.getAttribute('data-act');
      if (act === 'id-add' && item) addModelIdPrompt(item.querySelector('select[data-inline-field="modelId"]'), item.getAttribute('data-id'));
      else if (act === 'id-del' && item) removeSelectedModelId(item.querySelector('select[data-inline-field="modelId"]'), item.getAttribute('data-id'));
      else if (act === 'save' && item) saveInline(item);
      else if (act === 'test' && item) testInline(item);
      else if (act === 'key-toggle' && item) toggleInlineKey(item, action);
      else if (act === 'clear' && item) clearInlineKey(item);
      else if (act === 'official' && item) openOfficial(item);
      else if (act === 'visible') toggleVisible(id);
      else if ((act === 'move-up' || act === 'move-down') && item) moveModel(id, act === 'move-up');
      else if (act === 'edit') openEditor(id);
      else if (act === 'copy') copyModel(id);
      else if (act === 'del') deleteModel(id);
      else if (act === 'type') changeModelType(id, action.value);
    });
    root.addEventListener('change', function (event) {
      if (event.target.matches('[data-mc-field="modelType"]')) { updateTypeFields(); return; }
      if (event.target.matches('select[data-act="type"]')) changeModelType(event.target.getAttribute('data-id'), event.target.value);
    });
    root.addEventListener('keydown', function (event) {
      var tab = event.target.closest('[data-mc-type]');
      if (!tab || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-mc-type]'));
      var current = tabs.indexOf(tab);
      var next = event.key === 'ArrowRight' ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
  }

  function openEditor(id) {
    editingId = id;
    // 新建会话：临时 ID 列表置空（新模型默认不带任何模型 ID）；编辑会话：同步已保存列表
    editingModelIds = [];
    if (id && global.Models && typeof global.Models.getById === 'function') {
      var saved = global.Models.getById(id);
      if (saved && typeof global.Models.modelIdsFor === 'function') {
        editingModelIds = (global.Models.modelIdsFor(saved) || []).slice();
      }
    }
    var panel = $('[data-mc-edit]');
    if (!panel) return;
    panel.hidden = false;
    $('[data-mc-edit-title]').textContent = id ? '修改' + typeLabel(activeType) + '配置' : '添加' + typeLabel(activeType) + '配置';
    var model = id && global.Models.getById ? global.Models.getById(id) : null;
    fillForm(model || Object.assign({ modelType: activeType }, PRESETS[activeType]));
  }
  function hideEditor() { editingId = null; editingModelIds = []; var panel = $('[data-mc-edit]'); if (panel) panel.hidden = true; }
  function syncEditorModelIdOptions(selectedValue) {
    // 编辑器打开期间，把 editingModelIds 同步进顶部表单的 modelId 下拉框
    var select = $('[data-mc-field="modelId"]');
    if (select) select.innerHTML = selectOptions(editingModelIds.slice(), selectedValue || '');
  }
  function setField(name, value) { var el = $('[data-mc-field="' + name + '"]'); if (el) el.value = value || ''; }
  function getField(name) { var el = $('[data-mc-field="' + name + '"]'); return el ? el.value.trim() : ''; }
  function updateTypeFields() {
    var selectedType = getField('modelType') || activeType;
    var languageOnly = $('.mc-language-only'); if (languageOnly) languageOnly.hidden = selectedType !== 'language';
    var select = $('[data-mc-field="modelId"]');
    if (select) {
      var current = select.value;
      var options;
      if (editingId) {
        // 编辑已有配置：用该配置自己的 ID 列表
        options = (editingModelIds.length ? editingModelIds.slice() : modelIdOptionsFor(selectedType));
        var editingModel = global.Models && global.Models.getById ? global.Models.getById(editingId) : null;
        if (!editingModel) options = editingModelIds.slice();
      } else {
        // 新建配置：默认为空（不再共享第一个语言模型的 ID 列表），由＋号手动添加
        options = editingModelIds.slice();
      }
      select.innerHTML = selectOptions(options, current);
    }
    var effortSelect = $('[data-mc-field="reasoningEffort"]');
    if (effortSelect && selectedType === 'language') {
      var modelId = getField('modelId');
      var levels = global.ReasoningLevels && global.ReasoningLevels.listFor ? global.ReasoningLevels.listFor(modelId) : [{ value: 'medium', label: '中' }];
      effortSelect.innerHTML = levels.map(function (item) { return '<option value="' + esc(item.value) + '">' + esc(item.label || item.value) + '</option>'; }).join('');
    }
  }
  function fillForm(model) {
    setField('modelType', modelType(model)); setField('name', model.name); setField('endpoint', model.endpoint || model.baseUrl); setField('officialUrl', model.officialUrl); setField('apiKey', model.apiKey);
    var modelIdSelect = $('[data-mc-field="modelId"]');
    if (modelIdSelect) modelIdSelect.value = model.modelId || '';
    updateTypeFields();
    var select = $('[data-mc-field="reasoningEffort"]');
    if (select && getField('modelType') === 'language') select.value = model.reasoningEffort || select.options[0].value;  }
  function collectForm() {
    var selectedType = getField('modelType') || activeType;
    return { name: getField('name'), endpoint: getField('endpoint'), baseUrl: getField('endpoint'), officialUrl: getField('officialUrl'), apiKey: getField('apiKey'), modelId: getField('modelId'), provider: 'ark', modelType: selectedType, reasoningEffort: selectedType === 'language' ? getField('reasoningEffort') : '', visible: selectedType === 'language', imageGen: selectedType === 'vision', visionInput: selectedType === 'types_vision', visionInputFormats: selectedType === 'types_vision' ? ['url', 'base64'] : [] };
  }
  function saveEditor() {
    var data = collectForm();
    if (!data.name || !data.endpoint || !data.modelId) { toast('请填写名称、接口地址和模型 / Resource-Id', 'error'); return; }
    var operation = editingId ? global.Models.update(editingId, data) : global.Models.add(data);
    Promise.resolve(operation).then(function (result) {
      if (!result || !result.ok) { toast((result && result.error) || '保存失败', 'error'); return; }
      // 新建成功后，把编辑器会话里用＋号添加的临时 ID 列表一并落到新配置上
      var savedId = editingId || (result && (result.id || (result.data && result.data.id)));
      if (!savedId) { toast('✓ 已保存「' + (data.name || '') + '」配置'); hideEditor(); renderList(); return; }
      var persistIds = function () {
        if (!editingId && Array.isArray(editingModelIds) && global.Models && typeof global.Models.getById === 'function') {
          var target = global.Models.getById(savedId);
          if (target) {
            var ids = editingModelIds.filter(function (v) { return v && v !== data.modelId; });
            target.modelIdOptions = ids;
            return Promise.resolve(global.Models.save()).catch(function () {});
          }
        }
        return Promise.resolve();
      };
      Promise.resolve(persistIds()).then(function () { toast('✓ 已保存「' + (data.name || '') + '」配置'); hideEditor(); renderList(); });
    }).catch(function (error) { toast('保存出错：' + error.message, 'error'); });
  }
  function copyModel(id) { Promise.resolve(global.Models.clone(id)).then(function (result) { if (!result || !result.ok) { toast((result && result.error) || '复制失败', 'error'); return; } toast('已复制配置'); renderList(); }).catch(function (error) { toast('复制出错：' + error.message, 'error'); }); }
  function toggleVisible(id) {
    var model = global.Models.getById(id);
    if (!model) return;
    // `visible` only affects the conversational picker; non-language configs stay out of it.
    var next = model.visible === false;
    Promise.resolve(global.Models.setVisible(id, next)).then(function (result) {
      if (!result || !result.ok) { toast((result && result.error) || '切换可见性失败', 'error'); renderList(); return; }
      toast(next ? '已在模型选择器中显示' : '已在模型选择器中隐藏');
      renderList();
    }).catch(function (error) { toast('切换可见性出错：' + error.message, 'error'); renderList(); });
  }
  function moveModel(id, up) {
    // 在当前分类的可见列表中找到本条位置，与上/下一条交换全局顺序
    var items = listCache.filter(function (m) { return modelType(m) === activeType; });
    var idx = items.findIndex(function (m) { return m.id === id; });
    if (idx < 0) return;
    var swapWith = items[up ? idx - 1 : idx + 1];
    if (!swapWith) { toast(up ? '已经是第一个了' : '已经是最后一个了', 'info'); return; }
    var targetIdx = global.Models.list.indexOf(swapWith);
    Promise.resolve(global.Models.move(id, targetIdx)).then(function (result) {
      if (!result || !result.ok) { toast((result && result.error) || '移动失败', 'error'); renderList(); return; }
      renderList();
    }).catch(function (error) { toast('移动出错：' + error.message, 'error'); renderList(); });
  }
  function openOfficial(item) {
    var input = item.querySelector('[data-inline-field="officialUrl"]');
    var url = input ? input.value.trim() : '';
    if (!url) { toast('未填写官网地址，请先在表单中填写', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { global.open(url, '_blank', 'noopener'); } catch (error) { toast('打开官网失败：' + error.message, 'error'); }
  }
  function clearInlineKey(item) {
    var input = item.querySelector('[data-inline-field="apiKey"]');
    if (!input) return;
    if (!input.value) { toast('API Key 已经是空的'); return; }
    input.value = '';
    input.focus();
    toast('已清空 API Key，点击「提交」保存生效', 'info');
  }
  function deleteModel(id) {
    var model = global.Models.getById(id);
    if (!model || !global.confirm('确认删除「' + model.name + '」？')) return;
    Promise.resolve(global.Models.remove(id)).then(function (result) { if (!result || !result.ok) { toast((result && result.error) || '删除失败', 'error'); return; } renderList(); });
  }
  function changeModelType(id, selectedType) {
    var model = global.Models.getById(id);
    if (!model || !selectedType || selectedType === modelType(model)) return;
    var patch = { modelType: selectedType, visible: selectedType === 'language', imageGen: selectedType === 'vision' ? !!model.imageGen : false, visionInput: selectedType === 'types_vision', visionInputFormats: selectedType === 'types_vision' ? ['url', 'base64'] : [], reasoningEffort: selectedType === 'language' ? (model.reasoningEffort || 'medium') : '' };
    Promise.resolve(global.Models.update(id, patch)).then(function (result) {
      if (!result || !result.ok) { toast((result && result.error) || '模型类型切换失败', 'error'); renderList(); return; }
      toast('已切换为' + typeLabel(selectedType));
      renderList();
    }).catch(function (error) { toast('模型类型切换出错：' + error.message, 'error'); renderList(); });
  }

  global.ModelConfigRewrite = { mount: mount, refresh: refresh, render: renderList };
  // Keep the existing settings panel integration point intact.
  global.App = global.App || {};
  global.App.renderModelPanel = mount;
})(window);
