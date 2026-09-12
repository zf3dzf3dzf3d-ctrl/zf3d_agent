/* =========================================================================
 * settings-rewrite.js  ——  朱峰社区智能体 v5.0.0
 * 完整重写的「设置 → 大模型」面板：
 *   1. 列出已添加的大模型（卡片式，从 Models.list 读）
 *   2. 添加 / 删除 / 修改 / 连通测试 / 复制 / 启用 / 设默认
 *   3. 所有数据走 localStorage.aiModels + Models.add/remove/save ...
 *   4. 全部用「事件委托」(click / change) 驱动,  按钮不会再失灵
 *
 * 暴露 API:
 *   SettingsRewrite.renderModelPanel(rootEl)   在打开设置面板时被调用
 *   SettingsRewrite.testModel(id)             主动测试 (可单独调用)
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'aiModels';          // localStorage key
  var ACT = 'activeModelId';     // 当前默认模型 id

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(s) { return escHtml(s); }
  function genId() {
    return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function maskKey(k) {
    if (!k) return '（未填）';
    if (k.length <= 8) return k;
    return k.slice(0, 4) + '****' + k.slice(-4);
  }

  // ---------- 存储 ----------
  function loadAll() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) {}
    return [];
  }
  function saveAll(arr) {
    localStorage.setItem(KEY, JSON.stringify(arr));
    // 同步给内存里的 Models 模块 (如果有)
    try {
      if (global.Models) {
        if (typeof global.Models.reload === 'function') global.Models.reload(arr);
      }
    } catch (e) {}
  }
  function getActiveId() { return localStorage.getItem(ACT) || ''; }
  function setActiveId(id) {
    if (id) localStorage.setItem(ACT, id);
    else localStorage.removeItem(ACT);
    try {
      if (global.Models && typeof global.Models.setActive === 'function') {
        global.Models.setActive(id);
      }
    } catch (e) {}
  }

  // ---------- 渲染 ----------
  function renderModelPanel(rootEl) {
    if (!rootEl) return;
    var list = loadAll();
    var activeId = getActiveId();
    var html = ''
      + '<div class="mc-wrap" style="padding:14px 18px 24px;color:#e6edf3;font-family:inherit;">'
      + '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      + '    <div>'
      + '      <div style="font-size:18px;font-weight:600;">🤖 大模型配置</div>'
      + '      <div style="font-size:12px;color:#8b95a5;margin-top:4px;">共 <b id="mcCount" style="color:#fff;">' + list.length + '</b> 个模型 · 当前默认：<b id="mcDefault" style="color:#7ee787;">' + escHtml(activeName(list, activeId)) + '</b></div>'
      + '    </div>'
      + '    <button class="btn-primary" data-mc-act="add" style="background:#2f81f7;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;">+ 添加大模型</button>'
      + '  </div>'
      + '  <div id="mcList">';
    if (list.length === 0) {
      html += ''
        + '    <div style="text-align:center;padding:48px 20px;color:#8b95a5;background:#0d1117;border:1px dashed #30363d;border-radius:8px;">'
        + '      <div style="font-size:36px;margin-bottom:8px;">🧠</div>'
        + '      <div style="font-size:14px;">还没有配置任何模型</div>'
        + '      <div style="font-size:12px;margin-top:6px;">点击右上角"添加模型"开始</div>'
        + '    </div>';
    } else {
      list.forEach(function (m) {
        html += renderCard(m, m.id === activeId);
      });
    }
    html += ''
      + '  </div>'
      + '  <div id="mcForm" style="display:none;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px;margin-top:14px;"></div>'
      + '</div>';
    rootEl.innerHTML = html;
  }

  function activeName(list, activeId) {
    var m = list.find(function (x) { return x.id === activeId; });
    return m ? m.name : '未设置';
  }

  function renderCard(m, isActive) {
    var visible = m.visible !== false;
    var typeLabel = { openai: 'OpenAI 兼容', anthropic: 'Anthropic', custom: '自定义' }[m.type] || m.type || 'OpenAI 兼容';
    return ''
      + '<div class="mc-card" data-id="' + escAttr(m.id) + '" '
      + '   style="background:#0d1117;border:1px solid ' + (isActive ? '#2f81f7' : '#30363d') + ';border-radius:8px;padding:14px;margin-bottom:10px;">'
      + '  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">'
      + '    <div style="flex:1;min-width:0;">'
      + '      <div style="font-size:15px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '        <span>#' + escHtml(m.seq || '') + ' ' + escHtml(m.name || '(未命名)') + '</span>'
      + '        <span style="font-size:11px;background:#1f6feb33;color:#79c0ff;padding:2px 6px;border-radius:4px;">' + escHtml(typeLabel) + '</span>'
      + (isActive ? '<span style="font-size:11px;background:#2ea04333;color:#7ee787;padding:2px 6px;border-radius:4px;">⭐ 默认</span>' : '')
      + (visible ? '' : '<span style="font-size:11px;background:#6e768133;color:#8b95a5;padding:2px 6px;border-radius:4px;">已禁用</span>')
      + '      </div>'
      + '      <div style="margin-top:6px;font-size:12px;color:#8b95a5;line-height:1.6;">'
      + '        <div>网址：<span style="color:#c9d1d9;">' + escHtml(m.url || '') + '</span></div>'
      + '        <div>模型：<span style="color:#c9d1d9;">' + escHtml(m.model || '') + '</span></div>'
      + '        <div>Key：<span style="color:#c9d1d9;font-family:monospace;">' + escHtml(maskKey(m.apiKey)) + '</span></div>'
      + '      </div>'
      + '    </div>'
      + '    <div style="display:flex;flex-wrap:wrap;gap:6px;max-width:280px;justify-content:flex-end;">'
      + '      <button data-mc-act="test"  data-id="' + escAttr(m.id) + '" style="background:#1f6feb;color:#fff;border:none;padding:6px 10px;border-radius:5px;cursor:pointer;font-size:12px;">🧪 测试</button>'
      + '      <button data-mc-act="edit"  data-id="' + escAttr(m.id) + '" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:5px;cursor:pointer;font-size:12px;">✏️ 编辑</button>'
      + (isActive
          ? '<button disabled style="background:#2ea04333;color:#7ee787;border:1px solid #2ea04366;padding:6px 10px;border-radius:5px;cursor:default;font-size:12px;opacity:0.7;">⭐ 默认</button>'
          : '<button data-mc-act="setDefault" data-id="' + escAttr(m.id) + '" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:5px;cursor:pointer;font-size:12px;">☆ 设为默认</button>')
      + '      <button data-mc-act="toggle" data-id="' + escAttr(m.id) + '" style="background:' + (visible ? '#1a3a23' : '#3a1a1a') + ';color:' + (visible ? '#7ee787' : '#f97583') + ';border:1px solid ' + (visible ? '#2ea04366' : '#f9758366') + ';padding:6px 10px;border-radius:5px;cursor:pointer;font-size:12px;">'
      + (visible ? '🟢 已启用' : '⚫ 已禁用') + '</button>'
      + '      <button data-mc-act="clone" data-id="' + escAttr(m.id) + '" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:5px;cursor:pointer;font-size:12px;">📋 复制</button>'
      + '      <button data-mc-act="del"   data-id="' + escAttr(m.id) + '" style="background:#3a1a1a;color:#f97583;border:1px solid #f9758366;padding:6px 10px;border-radius:5px;cursor:pointer;font-size:12px;">🗑 删除</button>'
      + '    </div>'
      + '  </div>'
      + '</div>';
  }

  function renderForm(rootEl, model) {
    var isEdit = !!model;
    var m = model || { id: '', name: '', type: 'openai', url: '', apiKey: '', model: '', seq: '', visible: true };
    var html = ''
      + '<div style="font-size:14px;font-weight:600;margin-bottom:10px;color:#fff;">'
      + (isEdit ? '✏️ 编辑模型' : '+ 添加新模型') + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + '  <div><div style="font-size:12px;color:#8b95a5;margin-bottom:4px;">名称 *</div>'
      + '    <input id="mcF_name" value="' + escAttr(m.name) + '" placeholder="例：DeepSeek" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:8px;border-radius:5px;font-size:13px;box-sizing:border-box;"/>'
      + '  </div>'
      + '  <div><div style="font-size:12px;color:#8b95a5;margin-bottom:4px;">序号（可选）</div>'
      + '    <input id="mcF_seq" value="' + escAttr(m.seq) + '" placeholder="例：2" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:8px;border-radius:5px;font-size:13px;box-sizing:border-box;"/>'
      + '  </div>'
      + '  <div style="grid-column:1/3;"><div style="font-size:12px;color:#8b95a5;margin-bottom:4px;">API 地址 *</div>'
      + '    <input id="mcF_url" value="' + escAttr(m.url) + '" placeholder="https://api.deepseek.com/v1/chat/completions" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:8px;border-radius:5px;font-size:13px;box-sizing:border-box;"/>'
      + '  </div>'
      + '  <div><div style="font-size:12px;color:#8b95a5;margin-bottom:4px;">模型 ID *</div>'
      + '    <input id="mcF_model" value="' + escAttr(m.model) + '" placeholder="例：deepseek-chat" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:8px;border-radius:5px;font-size:13px;box-sizing:border-box;"/>'
      + '  </div>'
      + '  <div><div style="font-size:12px;color:#8b95a5;margin-bottom:4px;">思考强度</div>'
      + '    <select id="mcF_think" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:8px;border-radius:5px;font-size:13px;box-sizing:border-box;">'
      + '      <option value="低">⚡ 低</option>'
      + '      <option value="中">⚖ 中</option>'
      + '      <option value="高">🔥 高</option>'
      + '    </select>'
      + '  </div>'
      + '  <div style="grid-column:1/3;"><div style="font-size:12px;color:#8b95a5;margin-bottom:4px;">API Key' + (isEdit ? '（留空则不改）' : ' *') + '</div>'
      + '    <input id="mcF_key" value="" placeholder="' + (isEdit ? '不修改请留空' : 'sk-...') + '" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:8px;border-radius:5px;font-size:13px;box-sizing:border-box;"/>'
      + '  </div>'
      + '</div>'
      + '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">'
      + '  <button data-mc-act="cancelForm" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:7px 14px;border-radius:5px;cursor:pointer;font-size:13px;">取消</button>'
      + '  <button data-mc-act="saveForm"   data-id="' + escAttr(m.id) + '" style="background:#2ea043;color:#fff;border:none;padding:7px 14px;border-radius:5px;cursor:pointer;font-size:13px;">💾 保存</button>'
      + '</div>';
    rootEl.innerHTML = html;
    rootEl.style.display = 'block';
    // 思考强度回填
    var sel = $('mcF_think'); if (sel && m.think) sel.value = m.think;
  }

  // ---------- 操作 ----------
  function doAdd(rootEl) {
    renderForm(rootEl, null);
    setTimeout(function () { var i = $('mcF_name'); if (i) i.focus(); }, 30);
  }
  function doEdit(rootEl, id) {
    var list = loadAll();
    var m = list.find(function (x) { return x.id === id; });
    if (!m) return alert('找不到该模型');
    renderForm(rootEl, m);
  }
  function doCancel(rootEl) {
    rootEl.innerHTML = '';
    rootEl.style.display = 'none';
  }
  function doSave(rootEl, id) {
    var name = ($('mcF_name') || {}).value || '';
    var url  = ($('mcF_url')  || {}).value || '';
    var model= ($('mcF_model')|| {}).value || '';
    var key  = ($('mcF_key')  || {}).value || '';
    var seq  = ($('mcF_seq')  || {}).value || '';
    var think= ($('mcF_think')|| {}).value || '低';
    name = name.trim();
    if (!name) return alert('请填写名称');
    if (!url)  return alert('请填写 API 地址');
    if (!model)return alert('请填写模型 ID');
    var list = loadAll();
    if (id) {
      // 编辑
      var m = list.find(function (x) { return x.id === id; });
      if (!m) return alert('模型已被删除');
      m.name = name; m.url = url; m.model = model;
      m.seq = seq; m.think = think;
      if (key) m.apiKey = key;
    } else {
      // 新增
      if (!key) return alert('请填写 API Key');
      list.push({ id: genId(), name: name, type: 'openai', url: url, model: model, apiKey: key, seq: seq, think: think, visible: true });
    }
    saveAll(list);
    doCancel(rootEl);
    renderModelPanel(rootEl.parentNode);
  }
  function doDel(rootEl, id) {
    var list = loadAll();
    var m = list.find(function (x) { return x.id === id; });
    if (!m) return;
    var dlg = (typeof ConfirmDialog !== 'undefined') ? ConfirmDialog
             : { confirm: function(o){ return Promise.resolve(window.confirm(o.message)); } };
    dlg.confirm({
      title: '删除模型',
      message: '确定要删除模型【' + m.name + '】？此操作不可恢复。',
      okText: '删除', danger: true
    }).then(function(ok) {
      if (!ok) return;
      list = loadAll().filter(function (x) { return x.id !== id; });
      saveAll(list);
      if (getActiveId() === id) setActiveId('');
      renderModelPanel(rootEl.parentNode);
    });
  }
  function doClone(rootEl, id) {
    var list = loadAll();
    var m = list.find(function (x) { return x.id === id; });
    if (!m) return;
    var copy = JSON.parse(JSON.stringify(m));
    copy.id = genId();
    copy.name = m.name + '(副本)';
    list.push(copy);
    saveAll(list);
    renderModelPanel(rootEl.parentNode);
  }
  function doToggle(rootEl, id) {
    var list = loadAll();
    var m = list.find(function (x) { return x.id === id; });
    if (!m) return;
    if (m.visible !== false && getActiveId() === id) {
      return alert('默认模型不能禁用，请先把别的模型设为默认');
    }
    m.visible = m.visible === false ? true : false;
    saveAll(list);
    renderModelPanel(rootEl.parentNode);
  }
  function doSetDefault(rootEl, id) {
    setActiveId(id);
    renderModelPanel(rootEl.parentNode);
  }
  function doTest(rootEl, id) {
    var list = loadAll();
    var m = list.find(function (x) { return x.id === id; });
    if (!m) return alert('找不到该模型');
    if (!m.apiKey) return alert('请先填写 API Key');
    if (!m.url) return alert('请先填写 API 地址');
    if (!m.model) return alert('请先填写模型 ID');
    // 找按钮
    var card = rootEl.querySelector('.mc-card[data-id="' + cssEscape(m.id) + '"]');
    var btn = card ? card.querySelector('[data-mc-act="test"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 测试中…'; }
    callAPI(m).then(function (info) {
      if (btn) { btn.disabled = false; btn.textContent = '🧪 测试'; }
      if (info.ok) {
        alert('✅ 连通成功！\n\n耗时：' + info.ms + ' ms\n回复：' + (info.preview || ''));
      } else {
        alert('❌ 连通失败\n\n' + (info.err || '未知错误'));
      }
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = '🧪 测试'; }
      alert('❌ 测试异常：' + (e.message || e));
    });
  }

  // ---------- API 调用 ----------
  function callAPI(m) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var payload = {
        model: m.model,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        max_tokens: 16
      };
      fetch(m.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + m.apiKey
        },
        body: JSON.stringify(payload)
      }).then(function (resp) {
        var ms = Date.now() - start;
        if (!resp.ok) {
          return resp.text().then(function (t) {
            resolve({ ok: false, ms: ms, err: 'HTTP ' + resp.status + ' ' + resp.statusText + (t ? '\n' + t.slice(0, 200) : '') });
          });
        }
        return resp.json().then(function (j) {
          var preview = '';
          try {
            preview = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || JSON.stringify(j).slice(0, 120);
          } catch (e) {}
          resolve({ ok: true, ms: ms, preview: preview });
        });
      }).catch(function (e) {
        resolve({ ok: false, ms: Date.now() - start, err: '网络错误：' + (e.message || e) });
      });
    });
  }

  // ---------- 事件委托（核心：所有按钮都靠这个驱动）----------
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // 全局事件入口（绑定在 document，一次绑定永久生效）
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-mc-act]');
    if (!t) return;
    var act = t.getAttribute('data-mc-act');
    var id  = t.getAttribute('data-id') || '';
    // 找 form 容器 (与 list 容器同级)
    var formEl = $('mcForm');
    if (!formEl) return;
    var listEl = $('mcList');
    var rootEl = formEl;  // 委托操作的目标根
    if (act === 'add')        { ev.preventDefault(); doAdd(formEl); }
    else if (act === 'edit')  { ev.preventDefault(); doEdit(formEl, id); }
    else if (act === 'cancelForm') { ev.preventDefault(); doCancel(formEl); }
    else if (act === 'saveForm')   {
      ev.preventDefault();
      doSave(formEl, id);
    }
    else if (act === 'del')   { ev.preventDefault(); doDel(listEl, id); }
    else if (act === 'clone') { ev.preventDefault(); doClone(listEl, id); }
    else if (act === 'toggle'){ ev.preventDefault(); doToggle(listEl, id); }
    else if (act === 'setDefault') { ev.preventDefault(); doSetDefault(listEl, id); }
    else if (act === 'test')  { ev.preventDefault(); doTest(listEl, id); }
  });

  // 暴露
  global.SettingsRewrite = {
    renderModelPanel: renderModelPanel,
    testModel: function (id) {
      var list = loadAll();
      var m = list.find(function (x) { return x.id === id; });
      if (m) return callAPI(m);
    }
  };

  console.log('[SettingsRewrite] ready');
})(window);
