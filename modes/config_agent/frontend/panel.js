// modes/config_agent/frontend/panel.js - 模型配置管家 对话面板
// 通过 window.ModePlugins.registerPanel('config_agent', api) 注册。
// 提供独立输入框 + 发送按钮，消息走 /api/proxy（DB.proxy），带 _loop_mode=config_agent，
// 后端自动注入本插件的 prompt.md 与 read_models/write_models 工具。
(function () {
  'use strict';

  var ID = 'config_agent';
  var log = []; // [{role, text}]

  function el(tag, style, text) {
    var d = document.createElement(tag);
    if (style) d.style.cssText = style;
    if (text) d.textContent = text;
    return d;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderLog(box) {
    box.innerHTML = '';
    if (!log.length) {
      box.appendChild(el('div', 'color:var(--text2,#8b949e);font-size:12px;padding:8px;',
        '和模型配置管家对话，可直接说：「列出所有模型」「把火山方舟的思考强度改成 high」「新增一个 GLM 模型」…'));
    }
    log.forEach(function (m) {
      var row = el('div', 'margin:6px 0;display:flex;justify-content:' + (m.role === 'user' ? 'flex-end' : 'flex-start') + ';');
      var bub = el('div',
        'max-width:85%;padding:7px 11px;border-radius:10px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;' +
        (m.role === 'user'
          ? 'background:#0078d4;color:#fff;'
          : 'background:var(--bg2,rgba(255,255,255,0.06));color:var(--text,#dfe6ee);border:1px solid var(--border,rgba(255,255,255,0.1));'),
        m.text);
      row.appendChild(bub);
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  function getActiveModel() {
    try {
      if (window.Models && Models.activeId) {
        var m = Models.getById(Models.activeId);
        if (m) return m;
      }
      if (window.Models && Models.list && Models.list.length) return Models.list[0];
    } catch (e) {}
    return null;
  }

  var _abortCtrl = null; // 当前请求的 AbortController，用于「停止」
  var _pending = false;  // 是否正在请求中

  function setSendingState(sending, box, input, btn) {
    _pending = sending;
    btn.disabled = false; // 按钮始终可点：发送中作为「停止」按钮
    input.disabled = sending;
    btn.textContent = sending ? '停止' : '发送';
    btn.style.background = sending ? '#d1242f' : '#0078d4';
    if (!sending && box) input.focus();
  }

  function send(text, box, input, btn) {
    // 请求中点击按钮 = 停止
    if (_pending) {
      if (_abortCtrl) { try { _abortCtrl.abort(); } catch (e) {} }
      return;
    }
    if (!text) return;
    log.push({ role: 'user', text: text });
    renderLog(box);
    input.value = '';
    setSendingState(true, box, input, btn);

    var model = getActiveModel();
    if (!model || !model.endpoint || !(model.apiKey || model.key)) {
      log.push({ role: 'assistant', text: '⚠️ 未找到可用模型配置（endpoint / API Key 缺失），请先在「模型配置」里配置并选中一个语言模型。' });
      renderLog(box);
      setSendingState(false, box, input, btn);
      return;
    }

    var headers = Object.assign({ 'Content-Type': 'application/json' }, model.headers || {},
      { 'Authorization': 'Bearer ' + (model.apiKey || model.key || '') });
    var payload = {
      model: model.modelId,
      messages: [{ role: 'user', content: text }],
      stream: false,
      _loop_mode: ID // 提升到代理 body 顶层，后端据此注入插件提示词与工具
    };

    _abortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    DB.proxy(model.endpoint, headers, payload, _abortCtrl ? _abortCtrl.signal : undefined)
      .then(function (data) {
        var reply = data && data.choices && data.choices[0] && data.choices[0].message;
        var txt = reply ? (reply.content || '') : '';
        if (!txt && data && data.error) {
          txt = '⚠️ ' + (typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        }
        log.push({ role: 'assistant', text: txt || '(空回复)' });
      })
      .catch(function (err) {
        var aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
        log.push({ role: 'assistant', text: aborted ? '⏹ 已停止生成。' : '⚠️ 请求失败：' + (err && err.message ? err.message : err) });
      })
      .then(function () {
        _abortCtrl = null;
        renderLog(box);
        setSendingState(false, box, input, btn);
      });
  }

  var api = {
    init: function (container) {
      var wrap = el('div', 'display:flex;flex-direction:column;height:100%;min-height:320px;box-sizing:border-box;');
      wrap.setAttribute('data-voice-box', '1'); // 标记为支持语音输入的容器（voice-input.js 识别此属性）
      var head = el('div', 'padding:10px 12px;border-bottom:1px solid var(--border,rgba(255,255,255,0.1));display:flex;align-items:center;gap:8px;');
      head.appendChild(el('span', 'font-size:14px;font-weight:600;color:var(--text,#dfe6ee);', '⚙️ 模型配置管家'));
      head.appendChild(el('span', 'font-size:11px;color:var(--text2,#8b949e);', '独立对话 · 管理 models.json'));
      wrap.appendChild(head);

      var box = el('div', 'flex:1;overflow-y:auto;padding:10px 12px;background:var(--bg,transparent);');
      wrap.appendChild(box);

      var foot = el('div', 'display:flex;gap:8px;align-items:flex-end;padding:10px 12px;border-top:1px solid var(--border,rgba(255,255,255,0.1));');
      var input = document.createElement('textarea');
      input.rows = 1;
      input.placeholder = '对模型配置管家说点什么…（Enter 发送，Shift+Enter 换行）';
      input.style.cssText = 'flex:1;resize:none;padding:8px 10px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,0.12));' +
        'background:var(--bg2,rgba(255,255,255,0.05));color:var(--text,#dfe6ee);font-size:13px;line-height:1.5;box-sizing:border-box;' +
        'min-height:34px;max-height:160px;overflow-y:auto;overflow-x:hidden;';
      var btn = el('button', 'padding:0 16px;height:34px;border-radius:8px;border:none;background:#0078d4;color:#fff;font-size:13px;cursor:pointer;flex-shrink:0;align-self:flex-end;', '发送');
      btn.type = 'button';

      // 语音输入按钮（复用全局 voice-input.js 系统，与聊天输入框同一套）
      var voiceBtn = el('button', 'width:34px;height:34px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,0.12));' +
        'background:var(--bg2,rgba(255,255,255,0.05));color:var(--text2,#8b949e);cursor:pointer;flex-shrink:0;align-self:flex-end;' +
        'display:flex;align-items:center;justify-content:center;padding:0;');
      voiceBtn.type = 'button';
      voiceBtn.className = 'voice-btn';
      voiceBtn.title = '语音输入';
      voiceBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

      // 输入内容自动增高：空/单行时保持一条线高度，多行时随内容增长
      function autoSize() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
      }
      input.addEventListener('input', autoSize);
      function resetHeight() {
        input.value = '';
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
      }
      var _origSend = send;
      btn.addEventListener('click', function () {
        var wasPending = _pending;
        _origSend(input.value.trim(), box, input, btn);
        if (!wasPending) resetHeight(); // 停止操作时不误清输入框
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !_pending) {
          e.preventDefault();
          _origSend(input.value.trim(), box, input, btn);
          resetHeight();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); // 发送中 Enter 不再重复触发
        }
      });

      foot.appendChild(input);
      foot.appendChild(voiceBtn);
      foot.appendChild(btn);
      wrap.appendChild(foot);
      container.innerHTML = '';
      container.appendChild(wrap);
      renderLog(box);
      input.focus();
    },
    beforeSend: function (payload) { return payload; }
  };

  window.ModePlugins && window.ModePlugins.registerPanel(ID, api);
})();
