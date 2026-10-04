
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  _dlgAlert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

// ========== app-quick-create.js - Tab 快速创建对话框 =========
// 按 Tab 键弹出极简创建条：大模型选择 + 模型ID + 思考强度（与主对话框模型选择器同款） + 加号(上传图片/文件夹) + 输入框 + 语音 + 发送。
// 发送后：用所选模型走 App.createChatBox + sendToModel 全套原有流程（珠峰底层/引擎/项目记忆全部继承），
// 然后自动聚焦新对话输入框。
(function () {
  'use strict';

  let bar = null;           // 快速创建条 DOM
  let overlay = null;       // 聚焦遮罩
  let inputEl = null;       // 输入框
  let modelSel = null;      // 模型下拉
  let sending = false;      // 防重复提交
  let pendingImgs = [];     // 待发送图片 [{ dataUrl, name }]
  let pendingTexts = [];    // 待附加附件文本（文件夹路径等）

  // ---------- 模型列表工具（与 app-kite-panels isTextModel 一致）----------
  function getTextModels() {
    var list = [];
    try { list = (window.Models && Models.list ? Models.list : []).slice(); } catch (e) {}
    // 朱峰官方模型强制置顶（第一个）
    list.sort(function (a, b) {
      var azf = (a && (a.zfLine || a.zfManaged || a.zfPinned)) ? 0 : 1, bzf = (b && (b.zfLine || b.zfManaged || b.zfPinned)) ? 0 : 1;
      return azf - bzf;
    });
    return list.filter(function (m) {
      if (!m) return false;
      if (m.imageGen) return false;
      // 创建对话只允许：语言类模型（本地模型必须是语言分类的可见模型）；
      // 语音/图片/视频/识图/向量化即使可见也不出现
      if (m.visionInput) return false;
      var t = String(m.modelType || '').toLowerCase();
      if (!(t === 'language' || t === 'text' || t === 'chat' || t === '')) return false;
      if ((m.endpoint || m.baseUrl || '').toLowerCase().indexOf('/images/') !== -1) return false;

      return m.visible !== false;
    });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }
  // 上一个对话使用的模型（默认选中项）
  // 优先级：用户习惯（持久化保存的上次选择）> 上一个对话的模型
  function getLastUsedModelId() {
    try {
      if (window.UserSettings && UserSettings.get) {
        var h = UserSettings.get('lastModelSelection', null);
        if (h && h.modelId) return String(h.modelId);
      }
      var App = window.App;
      var boxes = App && App.chatBoxes;
      if (boxes && boxes.length) {
        var b = boxes[boxes.length - 1];
        if (b && b.modelId) return String(b.modelId);
      }
    } catch (e) {}
    return '';
  }

  // 读取用户习惯中的模型 ID（qc-model-id 下拉默认选中）
  // 【分层记忆】取与记忆模型线路匹配的该线路记住的模型ID，避免跨线路串台
  function getHabitModelIdOverride(habitModelId) {
    try {
      if (window.UserSettings && UserSettings.get) {
        var mid = String(habitModelId || getLastUsedModelId() || '');
        if (mid) {
          var mem = UserSettings.get('modelSelectionMemory', null) || {};
          var rec = (mem['language'] && mem['language'][mid]) || null;
          if (rec && rec.modelIdOverride) return String(rec.modelIdOverride);
        }
        var h = UserSettings.get('lastModelSelection', null);
        if (h && h.modelId === mid && h.modelIdOverride) return String(h.modelIdOverride);
      }
    } catch (e) {}
    return '';
  }

  // 读取某线路记忆的思考强度（与模型ID匹配校验后返回）
  function getHabitReasoning(habitModelId, idOverride) {
    try {
      if (window.UserSettings && UserSettings.get) {
        var mid = String(habitModelId || getLastUsedModelId() || '');
        if (mid) {
          var mem = UserSettings.get('modelSelectionMemory', null) || {};
          var rec = (mem['language'] && mem['language'][mid]) || null;
          if (rec && rec.reasoningEffort) {
            var m = Models.get ? Models.get(mid) : null;
            var list = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(idOverride || rec.modelIdOverride || '', m) : null;
            if (list && list.length) {
              var ok = list.some(function (it) { return it.value === rec.reasoningEffort; });
              if (ok) return String(rec.reasoningEffort);
              return String(list[0].value);
            }
            return String(rec.reasoningEffort);
          }
        }
      }
    } catch (e) {}
    return '';
  }

  // 保存用户习惯（模型 + 模型ID + 思考强度）+ 分层记忆（分类→线路，互不串台）
  function saveModelHabit(modelId, modelIdOverride, reasoningEffort) {
    try {
      if (window.UserSettings && UserSettings.set && modelId) {
        UserSettings.set('lastModelSelection', {
          modelId: String(modelId),
          modelIdOverride: String(modelIdOverride || ''),
          reasoningEffort: String(reasoningEffort || ''),
          ts: Date.now()
        });
        var mem = UserSettings.get('modelSelectionMemory', null) || {};
        var c = mem['language'] = mem['language'] || {};
        var l = c[String(modelId)] = c[String(modelId)] || {};
        if (modelIdOverride !== undefined) l.modelIdOverride = String(modelIdOverride || '');
        if (reasoningEffort !== undefined) l.reasoningEffort = String(reasoningEffort || '');
        l.ts = Date.now();
        UserSettings.set('modelSelectionMemory', mem);
      }
    } catch (e) {}
  }

  // ---------- 样式注入 ----------
  function injectStyles() {
    if (document.getElementById('qcStyles')) return;
    const st = document.createElement('style');
    st.id = 'qcStyles';
    st.textContent = `
/* ---------- 遮罩：让整个画面只聚焦这一个输入框 ---------- */
#qcOverlay {
  position: fixed; inset: 0; z-index: 99999; display: none;
  /* 半透明遮罩：轻微压暗四周，聚焦输入框；不用 blur（避免大画布重绘卡顿），透明度够低不影响透视画布 */
  background: rgba(8, 10, 16, .35);
}
#qcOverlay.open { display: block; }

#qcQuickBar {
  position: fixed; left: 50%; top: calc(34% + 50px); transform: translate(-50%, -50%);
  z-index: 100000; display: none; flex-direction: column; gap: 0;
  background: var(--bg-card, #1e1e2e); /* 【统一风格】与全局卡片背景一致 */
  
  
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 20px; padding: 8px;
  /* 半透明毛玻璃质感：轻量阴影 + 中等模糊，模糊半径已从 60px 降到 10px 控制绘制开销 */
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
  width: min(620px, calc(100vw - 48px));
}
#qcQuickBar.open { display: flex; }
#qcQuickBar { flex-direction: column; }
#qcQuickBar .qc-mainrow { display: flex; align-items: center; gap: 6px; }

/* ---------- 上排：设置行（暗色统一，无文字介绍） ---------- */
#qcQuickBar > .qc-mainrow:first-child {
  padding: 2px 4px 8px 4px; border-bottom: 1px solid rgba(255,255,255,.08);
}
#qcQuickBar .qc-spacer { flex: 1; }

/* ---------- 左侧加号（上传）---------- */
#qcQuickBar .qc-plus {
  flex-shrink: 0; border: none; cursor: pointer; padding: 4px;
  background: transparent; color: rgba(255,255,255,.6);
  font-size: 16px; line-height: 1; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; transition: color .15s, background .15s;
}
#qcQuickBar .qc-plus:hover { color: #fff; background: rgba(255,255,255,.12); }

/* ---------- 下拉（模型 / 项目，暗色统一） ---------- */
#qcQuickBar select {
  flex-shrink: 0; border: none; outline: none; cursor: pointer;
  background: rgba(255,255,255,.07); color: rgba(255,255,255,.85); font-size: 12px;
  border-radius: 8px; padding: 5px 20px 5px 10px;
  appearance: none; -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='rgba(255,255,255,.55)' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat; background-position: right 7px center;
  transition: background-color .15s; max-width: 200px;
}
#qcQuickBar select:hover { background-color: rgba(255,255,255,.13); }
#qcQuickBar select option { background: #1a1a26; color: #ddd; border: none; }
#qcQuickBar .qc-model-select { max-width: 190px; }
#qcQuickBar .qc-model-id { max-width: 240px; font-size: 12px; }
#qcQuickBar .qc-model-id option { color: #ddd; background: #1a1a26; font-family: Consolas, monospace; }
#qcQuickBar .qc-re-select { max-width: 130px; color: rgba(150,200,255,.9); }

/* ---------- 下排：发送框 ---------- */
#qcQuickBar .qc-sendrow { margin-top: 2px; }
#qcQuickBar .qc-input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 15px; color: #fff; padding: 10px 4px; letter-spacing: .2px;
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  text-shadow: 0 1px 2px rgba(0,0,0,.3);
  resize: none; overflow-y: auto; max-height: 140px; line-height: 1.45;
}
#qcQuickBar .qc-input::placeholder { color: rgba(255,255,255,.35); }
#qcQuickBar .qc-send {
  flex-shrink: 0; border: none; cursor: pointer; padding: 0;
  border-radius: 50%; font-size: 17px; font-weight: 600;
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #5a8cff, #3577ff);
  color: #fff; transition: transform .12s, box-shadow .12s, opacity .12s;
  box-shadow: 0 4px 14px rgba(53,119,255,.4);
}
#qcQuickBar .qc-send:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(53,119,255,.55); }
#qcQuickBar .qc-send:active { transform: scale(.97); }
#qcQuickBar .qc-send:disabled { opacity: .5; cursor: default; }
#qcQuickBar .voice-btn {
  flex-shrink: 0; border: none; cursor: pointer; padding: 4px 6px;
  background: transparent; color: rgba(255,255,255,.72);
  display: flex; align-items: center; border-radius: 50%;
  transition: color .15s, background .15s;
}
#qcQuickBar .voice-btn:hover { color: #fff; background: rgba(255,255,255,.1); }
#qcQuickBar .voice-btn--rec { color: #ff6b6b !important; animation: qcVoicePulse 1.2s ease-in-out infinite; }
@keyframes qcVoicePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}

/* ---------- 加号弹出菜单 ---------- */
.qc-plus-menu {
  position: fixed; z-index: 100001; min-width: 150px;
  background: rgba(30,30,46,.96); border: 1px solid rgba(255,255,255,.14);
  border-radius: 12px; padding: 6px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
  opacity: 0; transform: translateY(6px); transition: opacity .15s, transform .15s;
  pointer-events: none;
}
.qc-plus-menu.show { opacity: 1; transform: translateY(0); pointer-events: auto; }
.qc-plus-menu .qc-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: none; background: transparent; color: #ddd; cursor: pointer;
  font-size: 13px; padding: 8px 10px; border-radius: 8px; text-align: left;
}
.qc-plus-menu .qc-menu-item:hover { background: rgba(255,255,255,.1); color: #fff; }

/* ---------- 待发送附件条 ---------- */
#qcQuickBar .qc-attach-bar {
  display: none; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 6px 10px 2px;
}
#qcQuickBar .qc-attach-bar.has-items { display: flex; }
#qcQuickBar .qc-attach-item {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px; border: 1px solid rgba(255,255,255,.16); border-radius: 10px;
  background: rgba(255,255,255,.07); font-size: 11px; color: #ddd; max-width: 220px;
}
#qcQuickBar .qc-attach-item img { width: 26px; height: 26px; object-fit: cover; border-radius: 4px; }
#qcQuickBar .qc-attach-item .qc-attach-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
#qcQuickBar .qc-attach-del {
  border: none; background: none; color: rgba(255,255,255,.55); cursor: pointer;
  font-size: 13px; padding: 0 2px; line-height: 1;
}
#qcQuickBar .qc-attach-del:hover { color: #ff6b6b; }
#qcQuickBar .qc-hint { display: none; }
    `;
    document.head.appendChild(st);
  }

  // ---------- 构建 UI ----------
  function build() {
    if (bar) return;
    injectStyles();
    overlay = document.createElement('div');
    overlay.id = 'qcOverlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', hide);
    bar = document.createElement('div');
    bar.id = 'qcQuickBar';

    // 上排：设置行（加号 + 模型 + 项目 + 模型ID）；下排：发送行（输入 + 语音 + 发送）
    bar.innerHTML =
      '<div class="qc-mainrow">' +
        '<button class="qc-plus" type="button" title="上传图片 / 文件夹">＋</button>' +
        '<select class="qc-model-select" title="选择大模型"></select>' +
        '<select class="qc-model-id" title="选择模型 ID"></select>' +
        '<select class="qc-re-select" title="思考强度（reasoning_effort）"></select>' +
      '</div>' +
      '<div class="qc-mainrow qc-sendrow">' +
        '<textarea class="qc-input" rows="1" placeholder="输入内容，Enter 发送 · Shift+Enter 换行"></textarea>' +
        '<button class="voice-btn qc-voice" type="button" title="语音输入"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button>' +
        '<button class="qc-send" type="button">↑</button>' +
      '</div>' +
      '<div class="qc-attach-bar"></div>';
    document.body.appendChild(bar);
    inputEl = bar.querySelector('.qc-input');
    modelSel = bar.querySelector('.qc-model-select');
    const sendBtn = bar.querySelector('.qc-send');
    const plusBtn = bar.querySelector('.qc-plus');
    const idLabel = bar.querySelector('.qc-model-id');

    fillModelSelect();
    bindModelIdChange();

    modelSel.addEventListener('change', function () {
      // 注意：这里绝不能再调 fillModelSelect()——它会重建 <option> 并把 selectedIndex 重置回 0，
      // 导致用户刚选的模型瞬间跳回第一项。只刷新依赖当前选择的下级控件即可。
      updateModelIdLabel();
      updateReSelect();
    });
    sendBtn.addEventListener('click', submit);
    plusBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlusMenu(plusBtn);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });
    // 自动长高：随内容增加最多 160px，超出滚动
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
    });
    // 阻止面板内按键冒泡，避免触发画布快捷键
    ['keydown', 'keyup', 'keypress'].forEach(t =>
      bar.addEventListener(t, e => e.stopPropagation()));
    // mousedown/click 不再全局拦截：语音按钮依赖 document 级委托（voice-input.js），
    // 只拦截非语音按钮区域的点击冒泡
    bar.addEventListener('mousedown', e => {
      if (!e.target.closest('.voice-btn')) e.stopPropagation();
    });
    bar.addEventListener('click', e => {
      if (!e.target.closest('.voice-btn')) e.stopPropagation();
    });
  }

  // 生成单个 option（与对话框上方模型选择器同款风格：
  // 朱峰官方模型带 ⭐ 前缀，悬浮显示 模型ID / 思考强度 提示）
  function optHtml(m, isZf) {
    const id = m.id || m.modelId || '';
    const name = m.name || id;
    const mid = m.modelId || '';
    const re = m.reasoningEffort || '默认';
    const prefix = isZf ? '⭐ ' : '';
    return '<option value="' + esc(id) + '" title="模型ID: ' + esc(mid) + ' | 思考强度: ' + esc(re) + '">' + prefix + esc(name) + '</option>';
  }

  function fillModelSelect() {
    if (!modelSel) return;
    const models = getTextModels();
    if (!models.length) {
      modelSel.innerHTML = '<option value="">默认模型</option>';
      updateModelIdLabel();
      return;
    }
    // 分组：朱峰官方线路模型置顶一组，其他线路一组
    // 【与对话框上方模型选择器同款风格】⭐ 前缀 + optgroup 分组标签一致
    const isZf = (window.Models && typeof Models.isZfOfficial === 'function')
      ? Models.isZfOfficial
      : (m) => !!(m.zfManaged || m.zfPinned || m.zfLine);
    const zf = models.filter(m => isZf(m));
    const local = models.filter(m => !isZf(m));
    const darkOpt = ' style="background:#161b22;color:#c9d1d9;"';
    let html = '';
    if (zf.length) {
      html += '<optgroup label="⭐ 朱峰官方" style="background:#161b22;color:#e6b800;">';
      zf.forEach(m => { html += optHtml(m, true); });
      html += '</optgroup>';
    }
    if (local.length) {
      html += '<optgroup label="其他线路" style="background:#161b22;color:#c9d1d9;">';
      local.forEach(m => { html += optHtml(m, false); });
      html += '</optgroup>';
    }
    modelSel.innerHTML = html;
    // 给所有 option 统一暗色底，并开启 select 暗色方案（修复 Windows Chrome 下 optgroup 露白）
    try {
      modelSel.style.colorScheme = 'dark';
      modelSel.querySelectorAll('option').forEach(function (o) { o.style.background = '#161b22'; o.style.color = '#c9d1d9'; });
    } catch (e) {}
    // 默认选中上一个对话的模型；若不在列表中则选第一项
    const last = getLastUsedModelId();
    let matched = false;
    if (last) {
      for (let i = 0; i < models.length; i++) {
        if (String(models[i].id) === last) { modelSel.value = last; matched = true; break; }
      }
    }
    if (!matched) modelSel.selectedIndex = 0;
    updateModelIdLabel();
  }

  // ---------- 模型 ID 下拉（同款模型的多 ID 可选，只读性质：切模型时自动跟随） ----------
  function updateModelIdLabel() {
    if (!modelSel || !bar) return;
    const idSel = bar.querySelector('.qc-model-id');
    if (!idSel) return;
    const models = getTextModels();
    const sel = models.find(m => String(m.id) === String(modelSel.value));
    const ids = [];
    if (sel) {
      // 与主对话框模型选择器同源：优先用 Models.modelIdsFor(m)，保证列表一致
      if (window.Models && typeof Models.modelIdsFor === 'function') {
        (Models.modelIdsFor(sel) || []).forEach(function (x) {
          x = (x || '').trim();
          if (x && ids.indexOf(x) < 0) ids.push(x);
        });
      }
      // 兜底：modelIdsFor 不可用时用旧逻辑
      if (!ids.length) {
        if (sel.modelId) ids.push(String(sel.modelId));
        if (sel.altModelIds) (Array.isArray(sel.altModelIds) ? sel.altModelIds : [sel.altModelIds]).forEach(function (x) {
          if (x && ids.indexOf(String(x)) < 0) ids.push(String(x));
        });
        if (sel.id && ids.indexOf(String(sel.id)) < 0 && String(sel.id) !== String(sel.modelId)) ids.push(String(sel.id));
      }
    }
    if (!ids.length) ids.push('');
    idSel.innerHTML = ids.map(function (x) { return '<option value="' + esc(x) + '">' + (esc(x) || '（默认）') + '</option>'; }).join('');
    // 默认选中用户习惯保存的模型 ID（上次选择，且与当前线路匹配才回填）
    var _curLineId = (modelSel && modelSel.value) ? String(modelSel.value) : '';
    var habitMid = getHabitModelIdOverride(_curLineId);
    if (habitMid && ids.indexOf(habitMid) >= 0) idSel.value = habitMid;
    updateReSelect();
    // 回填该线路记住的思考强度（须与当前模型ID档位匹配）
    try {
      var _hr = getHabitReasoning(_curLineId, idSel.value);
      var _reSel = bar.querySelector('.qc-re-select');
      if (_hr && _reSel) {
        var _hasOpt = Array.prototype.some.call(_reSel.options, function (o) { return o.value === _hr; });
        if (_hasOpt) _reSel.value = _hr;
      }
    } catch (eHr) {}
  }
  // 模型 ID 变化时刷新思考强度档位列表
  function bindModelIdChange() {
    if (!bar) return;
    var idSel = bar.querySelector('.qc-model-id');
    if (!idSel || idSel._reBound) return;
    idSel._reBound = true;
    idSel.addEventListener('change', function () {
      updateReSelect();
      // 【记忆】用户手动改模型ID → 立即记住（全局习惯 + 分层记忆，与当前线路匹配）
      try {
        var mid = (modelSel && modelSel.value) ? String(modelSel.value) : getLastUsedModelId();
        var _reSel = bar.querySelector('.qc-re-select');
        saveModelHabit(mid, idSel.value, _reSel ? (_reSel.value || '') : '');
      } catch (eSave) {}
    });
  }

  // ---------- 思考强度下拉（与主对话框模型选择器第三列同款，档位来自 ReasoningLevels） ----------
  function updateReSelect() {
    if (!bar) return;
    var reSel = bar.querySelector('.qc-re-select');
    if (!reSel) return;
    if (typeof ReasoningLevels === 'undefined' || !ReasoningLevels || !ReasoningLevels.listFor) {
      reSel.innerHTML = '<option value="">默认</option>';
      return;
    }
    var models = getTextModels();
    var sel = models.find(function (m) { return String(m.id) === String(modelSel ? modelSel.value : ''); });
    var effId = '';
    if (sel) {
      // 当前选中的模型 ID（跟随第二列，如被覆盖则用覆盖值）
      var idSel = bar.querySelector('.qc-model-id');
      var ids = [];
      if (sel.modelId) ids.push(String(sel.modelId));
      if (sel.altModelIds) (Array.isArray(sel.altModelIds) ? sel.altModelIds : [sel.altModelIds]).forEach(function (x) { if (x) ids.push(String(x)); });
      effId = (idSel && idSel.value) ? String(idSel.value) : (ids[0] || sel.id || '');
    }
    var reList = ReasoningLevels.listFor(effId, sel);
    reSel.innerHTML = reList.map(function (it) {
      return '<option value="' + esc(it.value) + '">' + esc(it.label) + '</option>';
    }).join('');
    // 恢复该线路记住的思考强度（须在合法档位内）
    try {
      var _hr2 = getHabitReasoning(modelSel ? modelSel.value : '', effId);
      if (_hr2 && reList.some(function (it) { return it.value === _hr2; })) reSel.value = _hr2;
    } catch (eHr2) {}
    // 【记忆】用户改思考强度 → 立即记住（须与当前模型ID匹配）
    if (!reSel._memBound) {
      reSel._memBound = true;
      reSel.addEventListener('change', function () {
        try {
          var mid = (modelSel && modelSel.value) ? String(modelSel.value) : getLastUsedModelId();
          var _idSel = bar.querySelector('.qc-model-id');
          saveModelHabit(mid, _idSel ? (_idSel.value || '') : '', reSel.value || '');
        } catch (eSave2) {}
      });
    }
  }

  // ---------- 加号菜单：上传图片 / 文件夹 ----------
  function togglePlusMenu(anchorBtn) {
    const existing = document.querySelector('.qc-plus-menu');
    if (existing) { existing.remove(); return; }
    const rect = anchorBtn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'qc-plus-menu';
    menu.innerHTML =
      '<button class="qc-menu-item" data-act="image"><span>🖼️</span><span>上传图片</span></button>' +
      '<button class="qc-menu-item" data-act="folder"><span>📂</span><span>上传文件夹</span></button>';
    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 150;
    let left = rect.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    menu.style.left = left + 'px';
    menu.style.top = (rect.bottom + 6) + 'px';
    requestAnimationFrame(() => menu.classList.add('show'));

    menu.querySelector('[data-act="image"]').addEventListener('click', function () {
      menu.remove();
      pickQuickImages();
    });
    menu.querySelector('[data-act="folder"]').addEventListener('click', function () {
      menu.remove();
      pickQuickFolder();
    });
    setTimeout(function () {
      const close = function (e) {
        if (!menu.contains(e.target)) {
          menu.classList.remove('show');
          setTimeout(() => menu.remove(), 160);
          document.removeEventListener('mousedown', close, true);
        }
      };
      document.addEventListener('mousedown', close, true);
    }, 10);
  }

  // 选择本地图片 → 转成待发送缩略卡（发送时随消息走识图通道）
  function pickQuickImages() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', function (e) {
      const files = e.target.files;
      if (!files || !files.length) return;
      const MAX_IMAGES = 4, MAX_BYTES = 8 * 1024 * 1024;
      Array.prototype.slice.call(files).forEach(function (f) {
        if (!/^image\//.test(f.type || '') && !/\.(png|jpe?g|webp|gif)$/i.test(f.name || '')) return;
        if (f.size > MAX_BYTES) { toastQuick('❌ 图片过大（>8MB）: ' + f.name); return; }
        if (pendingImgs.length >= MAX_IMAGES) { toastQuick('⚠️ 最多附带 ' + MAX_IMAGES + ' 张图片'); return; }
        const fr = new FileReader();
        fr.onload = function () {
          if (typeof fr.result === 'string' && fr.result.indexOf('data:image/') === 0) {
            pendingImgs.push({ dataUrl: fr.result, name: f.name });
            renderAttachBar();
          } else {
            toastQuick('❌ 图片读取失败: ' + f.name);
          }
        };
        fr.readAsDataURL(f);
      });
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(function () { if (input.parentNode) input.parentNode.removeChild(input); }, 5000);
  }

  // 选择服务器文件夹路径（复用 App._pickFolder 的服务器目录浏览器）
  function pickQuickFolder() {
    const App = window.App;
    if (App && typeof App._pickFolder === 'function') {
      // 传入一个假的 box/chat 引导：借一个临时桥接，回调里把路径塞进待发附件
      const fakeBox = {
        querySelector: function () { return null; }, // 阻止 _handleFolderPath 直接写输入框
        id: '__qc__'
      };
      const fakeChat = { id: '__qc__' };
      // 直接调用文件夹浏览器，确认后走 _handleFolderPath -> 会尝试写 textarea（拿不到则忽略），
      // 因此这里包一层：从 _handleFolderPath 的行为里截获路径。
      // 更简单可靠：临时替换 _handleFolderPath。
      const origHandle = App._handleFolderPath;
      App._handleFolderPath = function (box, chat, folderPath) {
        App._handleFolderPath = origHandle;
        addFolderAttachment(folderPath);
      };
      App._pickFolder(fakeBox, fakeChat, 'upload');
      // 保险：如果用户取消，5 秒后还原
      setTimeout(function () {
        if (App._handleFolderPath !== origHandle) App._handleFolderPath = origHandle;
      }, 5 * 60 * 1000);
    } else {
      // 兜底：手动输入路径
      const p = _dlgPrompt('请输入文件夹路径：');
      if (p && p.trim()) addFolderAttachment(p.trim());
    }
  }

  function addFolderAttachment(folderPath) {
    pendingTexts.push({ type: 'folder', path: folderPath });
    renderAttachBar();
  }

  function renderAttachBar() {
    if (!bar) return;
    const barEl = bar.querySelector('.qc-attach-bar');
    if (!barEl) return;
    let html = '';
    pendingImgs.forEach(function (it, i) {
      html += '<span class="qc-attach-item" title="' + esc(it.name) + '">' +
        '<img src="' + it.dataUrl + '" alt="img">' +
        '<span class="qc-attach-name">' + esc(it.name) + '</span>' +
        '<button type="button" class="qc-attach-del" data-kind="img" data-idx="' + i + '" title="移除">×</button></span>';
    });
    pendingTexts.forEach(function (it, i) {
      html += '<span class="qc-attach-item" title="' + esc(it.path) + '">' +
        '<span>📁</span>' +
        '<span class="qc-attach-name">' + esc(it.path) + '</span>' +
        '<button type="button" class="qc-attach-del" data-kind="folder" data-idx="' + i + '" title="移除">×</button></span>';
    });
    barEl.innerHTML = html;
    barEl.classList.toggle('has-items', pendingImgs.length + pendingTexts.length > 0);
    barEl.querySelectorAll('.qc-attach-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const kind = btn.getAttribute('data-kind');
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (kind === 'img') pendingImgs.splice(idx, 1);
        else pendingTexts.splice(idx, 1);
        renderAttachBar();
      });
    });
  }

  function toastQuick(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[QuickCreate]', msg); } catch (e2) {}
  }

  // ---------- 打开 / 关闭 ----------
    // 【兜底精确还原】minimap 原始位置持久化：异常中断后仍能 insertBefore 回到原兄弟位
  function _qcSaveOrigin(el) {
    try {
      var next = el.nextSibling;
      sessionStorage.setItem('zf_qc_mm_origin', JSON.stringify({
        parent: el.parentElement.id || '',
        nextId: next && next.id || '',
        nextCls: next && next.className || '',
        idx: Array.prototype.indexOf.call(el.parentElement.children, el)
      }));
    } catch (e) {}
  }
  function _qcRestoreOrigin(el) {
    try {
      var o = JSON.parse(sessionStorage.getItem('zf_qc_mm_origin') || 'null');
      if (!o) return false;
      var parent = o.parent ? document.getElementById(o.parent) : null;
      if (!parent) return false;
      var next = null;
      if (o.nextId) next = document.getElementById(o.nextId);
      else if (o.nextCls) next = parent.querySelector('.' + String(o.nextCls).trim().split(/\s+/).join('.'));
      if (next && next.parentElement === parent) parent.insertBefore(el, next);
      else parent.insertBefore(el, parent.children[o.idx] || null);
      sessionStorage.removeItem('zf_qc_mm_origin');
      return true;
    } catch (e) { return false; }
  }
function show() {
    build();
    bar.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.classList.add('qc-open'); // 标记快速创建面板打开：minimap 只显示不可点，防误触导航
    // 【修复】minimap 位于带 transform 的 #canvasContent 内，其 fixed/z-index 无法越过 body 层遮罩。
    // 这里直接把 #minimap DOM 临时搬到 body 下（脱离 transform 层叠上下文），关闭面板时移回原位。
    // 【bug修复·位置下推10px】注意：qc-open 类的 CSS `position:fixed` 不能在测量前生效——
    // 在 transform 父级内 fixed 的包含块是该元素的 padding box，与原 absolute 定位基准相差
    // 边框/内边距（实测约 10px），先加类再测量 getBoundingClientRect 会把偏移固化成内联坐标，
    // 导致每次开面板缩略图被下推、且小地图反推摄像机随之偏移。因此测量搬移完成后再加标记类。
    // （改为在下方搬移逻辑结束后统一 add）
    (function () {
      var mm = document.getElementById('minimap');
      if (!mm) { // minimap 尚未初始化（页面刚加载就开面板）：稍后重试搬移，避免它困在画布上下文被遮罩盖住
        var _retry = 0;
        var _t = setInterval(function () {
          var el = document.getElementById('minimap');
          if (el && el.parentElement && el.parentElement !== document.body) {
            clearInterval(_t);
            try {
              el._qcOriginParent = el.parentElement; el._qcOriginNext = el.nextSibling;
              el._qcOriginInline = { left: el.style.left, top: el.style.top, right: el.style.right, bottom: el.style.bottom };
              // 【加固】与主路径一致：按当前视口坐标（夹紧到视口内）fixed 定位，不依赖 CSS 默认规则
              var _r = el.getBoundingClientRect();
              var _vw = window.innerWidth, _vh = window.innerHeight;
              var _l = Math.min(Math.max(_r.left, 0), Math.max(_vw - _r.width, 0));
              var _top = Math.min(Math.max(_r.top, 0), Math.max(_vh - _r.height, 0));
              el.style.left = el.style.top = el.style.right = el.style.bottom = '';
              _qcSaveOrigin(el);
              document.body.appendChild(el);
              el.style.left = Math.round(_l) + 'px';
              el.style.top = Math.round(_top) + 'px';
            } catch (e) {}
          } else if (++_retry > 20 || !(bar && bar.classList.contains('open'))) { clearInterval(_t); }
        }, 150);
        return;
      }
      if (mm && mm.parentElement && mm.parentElement !== document.body) {
        mm._qcOriginParent = mm.parentElement;
        mm._qcOriginNext = mm.nextSibling;
        // 【修复】拖拽过的 minimap 带有内联 left/top（画布坐标系像素值），
        // 搬到 body 下后 fixed 定位会拿这套坐标当视口坐标 → 位置跳到别处/看不到。
        // 先备份内联定位并清空，交给 CSS 的 fixed right/bottom 规则稳定显示在右下角。
        mm._qcOriginInline = {
          left: mm.style.left, top: mm.style.top,
          right: mm.style.right, bottom: mm.style.bottom
        };
        // 【修复】面板打开期间保持 minimap 原地不动：先记录当前视口坐标，
        // 搬到 body 下后用同样的视口坐标 fixed 定位，而不是套用 CSS 写死的右下角。
        // 【加固】极端窗口尺寸下（刚改窗口/首帧渲染）getBoundingClientRect 可能给出
        // 视口外或贴边异常坐标，先夹紧到视口内再固化，避免面板期间跑到屏幕外。
        var _r = mm.getBoundingClientRect();
        var _vw = window.innerWidth, _vh = window.innerHeight;
        var _l = Math.min(Math.max(_r.left, 0), Math.max(_vw - _r.width, 0));
        var _top = Math.min(Math.max(_r.top, 0), Math.max(_vh - _r.height, 0));
        mm.style.left = ''; mm.style.top = ''; mm.style.right = ''; mm.style.bottom = '';
        _qcSaveOrigin(mm);
        document.body.appendChild(mm);
        mm.style.left = Math.round(_l) + 'px';
        mm.style.top = Math.round(_top) + 'px';
        mm.style.right = 'auto'; mm.style.bottom = 'auto';
      }
      // 搬移与坐标固化全部完成后才打 qc-open 标记：避免 fixed 定位提前生效
      // 使 getBoundingClientRect 读到「含边框偏移」的错误坐标，导致缩略图每次开面板被下推 ~10px
      document.body.classList.add('qc-open');
    })();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    fillModelSelect(); // 每次打开刷新模型列表
    inputEl.focus();
    const _h = document.getElementById('canvasHint');
    if (_h && _h.style.display !== 'none') { _h.style.display = 'none'; _h._hiddenByDualPanel = true; }
  }
  function hide() {
    // 关闭时若语音正在对本条录音，静默停止
    if (bar && bar.classList.contains('open') && window.VoiceInput) {
      try { VoiceInput.stop(); } catch (err) {}
    }
    if (bar) bar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('qc-open');
    // 关闭面板：把临时搬到 body 下的 #minimap 移回画布原位
    (function () {
      const mm = document.getElementById('minimap');
      // 兜底①：搬移发生过但备份丢失（异常中断/面板期间刷新残留），minimap 滞留 body 下时送回画布
      if (mm && !mm._qcOriginParent && mm.parentElement === document.body) {
        const cc = document.getElementById('canvasContent');
        if (cc) {
          mm.style.left = mm.style.top = mm.style.right = mm.style.bottom = '';
          if (!_qcRestoreOrigin(mm)) cc.appendChild(mm); // sessionStorage 也丢失才退回末尾
          mm = null;
        }
      }
      if (mm && mm._qcOriginParent) {
        try { mm._qcOriginParent.insertBefore(mm, mm._qcOriginNext || null); } catch (e) { mm._qcOriginParent.appendChild(mm); }
        // 【修复】还原拖拽保存的内联定位（画布坐标系），恢复原显示位置
        if (mm._qcOriginInline) {
          mm.style.left = mm._qcOriginInline.left;
          mm.style.top = mm._qcOriginInline.top;
          mm.style.right = mm._qcOriginInline.right;
          mm.style.bottom = mm._qcOriginInline.bottom;
          mm._qcOriginInline = null;
        }
        mm._qcOriginParent = null; mm._qcOriginNext = null;
        // 【修复】还原后校验可视性：若画布坐标落在视口外（脏坐标/窗口尺寸变化），
        // 清掉内联定位与拖拽记忆，让 CSS 默认规则把它放回右下角；随后强制重绘一次
        requestAnimationFrame(function () {
          // 下帧校验一次；若此刻 minimap 为 display:none（width=0），再等一帧兜底校验
          function _check() {
            try {
              var _r = mm.getBoundingClientRect();
              if (!_r.width) { requestAnimationFrame(_check); return; }
              if (_r.right < 0 || _r.bottom < 0 || _r.left > window.innerWidth || _r.top > window.innerHeight) {
                mm.style.left = ''; mm.style.top = ''; mm.style.right = ''; mm.style.bottom = '';
                try { localStorage.removeItem('zf_minimap_pos'); } catch (_e) {}
              }
            } catch (_e) {}
            if (window.App && App._minimapDraw) App._minimapDraw(true);
          }
          _check();
        });
      }
    })();
    const menu = document.querySelector('.qc-plus-menu');
    if (menu) menu.remove();
  }
  function toggle() {
    if (bar && bar.classList.contains('open')) hide(); else show();
  }

  // ---------- 发送 ----------
  function submit() {
    const text = (inputEl.value || '').trim();
    if (!text && !pendingImgs.length && !pendingTexts.length) { inputEl.focus(); return; }
    if (sending) return;
    sending = true;
    const selModelId = modelSel && modelSel.value ? modelSel.value : null;
    const theImages = pendingImgs.slice();
    const theTexts = pendingTexts.slice();
    // 发送即清空：文字已提交，输入框与附件条不留残留
    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    pendingImgs = [];
    pendingTexts = [];
    renderAttachBar();

    const App = window.App;
    if (!App || typeof App.createChatBox !== 'function') {
      console.warn('[QuickCreate] App.createChatBox 不可用');
      sending = false;
      return;
    }

    // 模型：优先用下拉选择的模型；否则沿用上一个对话的模型
    const lastBox = App.chatBoxes && App.chatBoxes.length ? App.chatBoxes[App.chatBoxes.length - 1] : null;
    const modelId = selModelId || (lastBox ? lastBox.modelId : null);

    // 创建位置：紧贴最近对话的右侧同一横排（间隔 36px）；超出画布可视区时自动换到下一行
    const canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
    const cRect = canvas.getBoundingClientRect();
    const GAP_X = 80, GAP_Y = 24; // 横排间隔 / 换行间隔
    let posX, posY;
    if (lastBox && lastBox.el) {
      const lb = lastBox.el;
      const w = lb.offsetWidth || 420;
      const h = lb.offsetHeight || 480;
      const left = parseInt(lb.style.left) || 0;
      const top = parseInt(lb.style.top) || 0;
      // 新框宽度先估一个（创建后如不同影响不大），画布可视右边界
      const estW = 420;
      const viewRight = -cRect.left + window.innerWidth;   // 画布坐标系下的可视右缘
      if (left + w + GAP_X + estW <= viewRight) {
        // 仍在可视区内 → 紧贴右侧同排
        posX = left + w + GAP_X;
        posY = top;
      } else {
        // 换行：回到本行行首 x，放到下一行
        posX = Math.max(10, left - 0);
        posY = top + h + GAP_Y;
      }
    } else {
      // 【鼠标跟随优先】快速创建条跟随鼠标位置
      const _m = window.__zfLastMouse || {};
      posX = (_m.clientX != null) ? (_m.clientX - cRect.left) : Math.max(10, -cRect.left + 100);
      posY = (_m.clientY != null) ? (_m.clientY - cRect.top) : Math.max(10, -cRect.top + 60);
    }
    const clientX = posX + cRect.left;
    const clientY = posY + cRect.top;

    const chat = App.createChatBox(clientX, clientY, modelId);
    if (!chat) { sending = false; return; }

    // 【用户习惯】保存本次选择（模型 + 模型ID + 思考强度），供下次新对话继承
    const qcIdSel = bar.querySelector('.qc-model-id');
    saveModelHabit(modelId, qcIdSel ? (qcIdSel.value || '') : '', bar.querySelector('.qc-re-select') ? (bar.querySelector('.qc-re-select').value || '') : '');

    // 模型 ID：用快速创建条选中的具体 ID 覆盖（与主对话框 _modelIdOverride 同机制）
    if (qcIdSel && qcIdSel.value) {
      try { chat._modelIdOverride = String(qcIdSel.value).trim(); if (window.Store && Store.saveChatBox) Store.saveChatBox(chat, true); } catch (err) {}
    }

    // 思考强度：写入新对话（与主对话框选择器一致，走 chat._reasoningEffort 覆盖机制）
    const reSel = bar.querySelector('.qc-re-select');
    if (reSel && reSel.value && typeof ReasoningLevels !== 'undefined') {
      try {
        chat._reasoningEffort = reSel.value;
        if (window.Store && Store.addLog) Store.addLog('info', chat.id, 'reasoning-switch', 'Tab 快速创建思考强度: ' + (ReasoningLevels.labelOf(reSel.value) || reSel.value) + ' (' + reSel.value + ')');
      } catch (err) { console.warn('[QuickCreate] 思考强度写入失败', err); }
    }

    // 项目：不再提供下拉，走 createChatBox 的默认归属（当前活动项目，与其他对话框一致）

    // 组装最终消息文本：用户文字 + 文件夹路径附件
    let finalText = text;
    theTexts.forEach(function (it) {
      const line = '📁 文件夹路径: ' + it.path;
      finalText = finalText ? (finalText + '\n' + line) : (line + '\n请查看以上文件夹路径信息，告诉我你的分析或处理意见。');
    });
    if (!finalText) finalText = '请查看以上图片，告诉我你的分析或处理意见。';

    // 与 chat_manage auto_send 完全一致的发送流程
    const input = chat.el.querySelector('textarea');
    if (input) input.value = finalText;
    // 图片：写入识图暂存区，随消息以 base64 发给模型
    if (theImages.length) {
      try {
        var arr = App._pendingImages = App._pendingImages || {};
        arr[chat.id] = theImages.map(function (it) { return { dataUrl: it.dataUrl, name: it.name }; });
        if (typeof App.renderPendingImages === 'function') App.renderPendingImages(chat.el);
      } catch (err) { console.warn('[QuickCreate] 图片附加失败', err); }
    }
    App.addMsg(chat.el, finalText, 'user', chat.modelId);
    if (typeof App.showQueryPin === 'function') App.showQueryPin(chat.el, finalText);
    if (typeof App.updateChatTitle === 'function') App.updateChatTitle(chat.el, text || '图片/文件夹对话');
    chat.history.push({ role: 'user', content: finalText });
    if (window.Store && Store.addLog) Store.addLog('info', chat.id, 'send', 'Tab 快速创建并发送');
    App.sendToModel(chat.el, chat);
    // 发送完成后清空新对话框输入框（sendToModel 可能不会清这条路径写入的值），文字已发出不应残留
    if (input && (input.value === finalText || input.value.trim() === finalText.trim())) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.style.height = 'auto';
    }

    // 关闭快速创建条，焦点交给新对话输入框（try/catch/finally 保证无论发送链路是否报错，菜单都隐藏）
    if (input) setTimeout(() => input.focus(), 60);
  }
  // 用 finally 包裹发送主流程：hide 必执行，防止异常导致快捷发送菜单残留
  const _origSubmit = submit;
  submit = function () {
    try {
      _origSubmit.apply(this, arguments);
    } catch (err) {
      console.error('[QuickCreate] 发送流程异常，强制关闭快捷条', err);
      sending = false;
    } finally {
      sending = false;
      if (bar && bar.classList.contains('open')) hide();
    }
  };

  // ---------- 全局按键：Tab 呼出（与右键并存） ----------
  // 仅当焦点不在输入框/文本域/可编辑元素上时拦截 Tab 并呼出/关闭快速创建条，
  // 并 preventDefault 阻止默认焦点跳转（避免引发右侧导航小地图频繁重绘）。
  // 输入框内部按 Tab 不拦截，保留浏览器默认行为。
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t) {
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
    }
    e.preventDefault();
    toggle();
  }, true);

  // ---------- 全局右键：右键呼出/关闭切换 ----------
  // 仅在无限画布空白区域右键时生效；标题栏/工具条/语音按钮等上方区域不触发
  document.addEventListener('contextmenu', (e) => {
    // 右键点在快速创建条内部的输入框等位置时，保留默认右键菜单
    if (bar && bar.classList.contains('open') && e.target && bar.contains(e.target)) return;
    // 右键点在小狗守卫上不呼出快速创建条（小狗右键是调出聊天面板）
    var dg = App && App._dogGuardEl;
    if (dg && e.target && dg.contains(e.target)) return;
    // 只在画布空白处触发（排除标题栏、工具条、语音按钮、文件树等）
    const canvas = document.getElementById('canvasArea');
    const onCanvasBlank = canvas && canvas.contains(e.target)
      && (!App || !App._isCanvasBlankTarget || App._isCanvasBlankTarget(e.target));
    if (!onCanvasBlank) return;
    e.preventDefault();
    toggle();
  }, true);

  // ---------- 导出 ----------
  window.QuickCreate = { show: show, hide: hide, toggle: toggle, submit: submit };
})();
