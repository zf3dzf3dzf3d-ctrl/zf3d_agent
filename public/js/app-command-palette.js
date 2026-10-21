/* ============================================================
 * app-command-palette.js — 智能体 OS 指挥台（Backquote 键唤起）
 * 两个 tab：宏面板（复用 chat_manage 宏通道）+ 内部 Python 工作台
 * 共用终端输出区。Esc 关闭，输入框聚焦/中文输入法时不误触。
 * v=1
 * ============================================================ */
(function () {
  'use strict';
  if (window.CommandPalette) return;

  var el = null;          // 浮层根节点
  var visible = false;
  var activeTab = 'macros';
  var history = [];       // 输出历史（环形）
  var HISTORY_MAX = 200;
  var _pollTimer = null;

  function _chatMgr() {
    return window.ChatMgr ||
           (window.App && window.App.chatMgr) ||
           (window.App && window.App.ChatMgr) ||
           null;
  }
  function _chatManage(args) {
    var cm = _chatMgr();
    if (cm && typeof cm.chatManage === 'function') return cm.chatManage(args);
    if (window.Tools && typeof window.Tools.execute === 'function') {
      return window.Tools.execute('chat_manage', args);
    }
    return { success: false, message: 'chat_manage 通道不可用（ChatMgr 未加载）' };
  }
  function _log(line, cls) {
    history.push({ t: new Date().toLocaleTimeString(), line: String(line), cls: cls || '' });
    if (history.length > HISTORY_MAX) history.shift();
    _renderOut();
  }
  function _esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  /* ---------- 构建 DOM ---------- */
  function _build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'cmdPalette';
    el.style.cssText = 'position:fixed;inset:0;z-index:99990;display:none;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);';
    el.innerHTML =
      '<div id="cmdPalBox" style="position:absolute;left:50%;top:12%;transform:translateX(-50%);width:min(860px,92vw);max-height:76vh;display:flex;flex-direction:column;background:var(--bg2,#1e1e1e);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,.5);overflow:hidden;">' +
      '  <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border,#444);">' +
      '    <span style="font-weight:600;">⌘ 指挥台</span>' +
      '    <button data-tab="macros"   class="cmdPalTab" style="font-size:12px;padding:4px 12px;border-radius:6px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer;">宏面板</button>' +
      '    <button data-tab="pyconsole" class="cmdPalTab" style="font-size:12px;padding:4px 12px;border-radius:6px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer;">Python 工作台</button>' +
      '    <span style="flex:1;"></span>' +
      '    <span style="font-size:11px;color:var(--text2,#999);">按 ` 唤起 / Esc 关闭</span>' +
      '    <button id="cmdPalClose" style="font-size:14px;padding:2px 10px;border-radius:6px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer;">×</button>' +
      '  </div>' +
      '  <div id="cmdPalMacros"  style="flex:1;overflow-y:auto;padding:12px 14px;display:none;"></div>' +
      '  <div id="cmdPalPy"      style="flex:1;overflow-y:auto;padding:12px 14px;display:none;flex-direction:column;gap:8px;"></div>' +
      '  <div id="cmdPalOut" style="height:180px;overflow-y:auto;border-top:1px solid var(--border,#444);padding:8px 12px;font:11px/1.6 Consolas,monospace;white-space:pre-wrap;background:rgba(0,0,0,.25);"></div>' +
      '</div>';
    document.body.appendChild(el);

    el.addEventListener('click', function (e) {
      if (e.target === el) { toggle(false); return; }
      if (e.target.id === 'cmdPalClose') { toggle(false); return; }
      var tabBtn = e.target.closest('.cmdPalTab');
      if (tabBtn) { switchTab(tabBtn.getAttribute('data-tab')); return; }
      var runBtn = e.target.closest('[data-run-macro]');
      if (runBtn) { runMacro(runBtn.getAttribute('data-run-macro'), false); return; }
      var dryBtn = e.target.closest('[data-dry-macro]');
      if (dryBtn) { runMacro(dryBtn.getAttribute('data-dry-macro'), true); return; }
      var delBtn = e.target.closest('[data-del-macro]');
      if (delBtn) { deleteMacro(delBtn.getAttribute('data-del-macro')); return; }
      var editBtn = e.target.closest('[data-edit-macro]');
      if (editBtn) { openEditorFor(editBtn.getAttribute('data-edit-macro')); return; }
      var togBtn = e.target.closest('[data-toggle-steps]');
      if (togBtn) {
        var row = togBtn.closest('.cmdPalMacroRow');
        var det = row ? row.querySelector('.cmdPalStepDetail') : null;
        if (det) {
          var open = det.style.display !== 'none';
          det.style.display = open ? 'none' : 'block';
          togBtn.textContent = open ? '▸' : '▾';
        }
        return;
      }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { toggle(false); return; }
      if (e.key === 'Enter' && e.target.id === 'cmdPalPyInput' && !e.shiftKey) {
        e.preventDefault(); pyExec(); return;
      }
      if (e.key === 'Backquote' && e.target.tagName === 'INPUT') e.stopPropagation();
    });
  }

  /* ---------- 宏面板 ---------- */
  function renderMacros() {
    var box = document.getElementById('cmdPalMacros');
    if (!box) return;
    if (editMode) { _renderEditor(box); return; }
    var lib = {};
    var cm = _chatMgr();
    try { lib = (cm && cm._macroLib) ? cm._macroLib(true) : {}; } catch (e) { lib = {}; }
    var names = Object.keys(lib || {});
    var html = '';
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
              '<button id="cmdPalNew" style="font-size:12px;padding:6px 16px;border-radius:6px;border:1px solid #1565c0;background:rgba(21,101,192,.18);color:inherit;cursor:pointer;font-weight:600;">＋ 新建宏</button>' +
              '<button id="cmdPalSeed" style="font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer;">🌱 预置示例宏</button>' +
              '<span style="flex:1;"></span>' +
            '</div>';
    if (!names.length) {
      html += '<div style="font-size:12px;color:var(--text2,#999);padding:8px 0;">还没有宏。点上方「＋ 新建宏」自己写一个，或「🌱 预置示例宏」一键体验 5 个示例（也可直接让任意对话智能体用 chat_manage {action:"macro_save", name, steps:[...]} 保存）。</div>';
    }
    html += names.map(function (n, idx) {
      var m = lib[n] || {};
      var steps = m.steps || [];
      // F3：步骤折叠详情，每步 [use] args 摘要，dangerous 步标 ⚠️
      var detail = steps.map(function (st, si) {
        var argStr = JSON.stringify(st.args || {});
        if (argStr.length > 90) argStr = argStr.slice(0, 87) + '...';
        var dg = /close|delete/i.test(argStr) ? ' <span style="color:#ef5350;" title="含 close/delete，需 confirm=true">⚠</span>' : '';
        return '<div style="padding:2px 0;color:var(--text,#ccc);">' + (si + 1) + '. <b style="color:#42a5f5;">[' + _esc(st.use || '') + ']</b> ' + _esc(argStr) + (st.wait ? ' <span style="color:#90a4ae;">⏳wait</span>' : '') + dg + '</div>';
      }).join('');
      if (!detail) detail = '<div style="color:var(--text2,#888);">（无步骤）</div>';
      return '<div class="cmdPalMacroRow" style="border:1px solid var(--border,#444);border-radius:8px;margin-bottom:6px;overflow:hidden;">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;">' +
        '<button data-toggle-steps="' + _esc(n) + '" title="展开/收起步骤" style="font-size:11px;padding:4px 6px;border:1px solid var(--border,#444);background:transparent;color:var(--text2,#999);border-radius:5px;cursor:pointer;">▸</button>' +
        '<div style="flex:1;min-width:0;"><b style="font-size:13px;">' + _esc(n) + '</b>' +
        '<span style="font-size:11px;color:var(--text2,#999);margin-left:8px;">' + _esc(m.desc || '') + '（' + steps.length + ' 步）</span></div>' +
        '<button data-dry-macro="' + _esc(n) + '" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer;">预演</button>' +
        '<button data-run-macro="' + _esc(n) + '" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #2e7d32;background:rgba(46,125,50,.15);color:inherit;cursor:pointer;">▶ 执行</button>' +
        '<button data-edit-macro="' + _esc(n) + '" title="编辑宏" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #1565c0;background:rgba(21,101,192,.15);color:inherit;cursor:pointer;">✎ 编辑</button>' +
        '<button data-del-macro="' + _esc(n) + '" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #c62828;background:rgba(198,40,40,.12);color:inherit;cursor:pointer;">删</button>' +
        '</div>' +
        '<div class="cmdPalStepDetail" style="display:none;padding:6px 12px 8px 30px;font:11px/1.7 Consolas,monospace;border-top:1px dashed var(--border,#333);background:rgba(0,0,0,.18);">' + detail + '</div>' +
        '</div>';
    }).join('');
    box.innerHTML = html;
    var seed = document.getElementById('cmdPalSeed');
    if (seed) seed.onclick = seedMacros;
    var nb = document.getElementById('cmdPalNew');
    if (nb) nb.onclick = openEditor;
  }

  /* ---------- 新建宏编辑器（F1：面板内可视化录入，走 chat_manage macro_save） ---------- */
  var editMode = null;
  var STEP_ACTIONS = [
    { v: 'create', l: 'create 新建对话' }, { v: 'send', l: 'send 发送消息' },
    { v: 'list', l: 'list 列出对话' }, { v: 'close', l: 'close 关闭对话' },
    { v: 'move', l: 'move 移动对话' }, { v: 'arrange', l: 'arrange 一键排布' },
    { v: 'pipeline', l: 'pipeline 流水线' }
  ];
  function _optA(cur) { return STEP_ACTIONS.map(function (a) { return '<option value="' + a.v + '"' + (a.v === cur ? ' selected' : '') + '>' + _esc(a.l) + '</option>'; }).join(''); }
  function _paramChip(p) { return '<span style="display:inline-block;background:rgba(255,167,38,.18);color:#ffb74d;border-radius:4px;padding:2px 8px;font-size:11px;">📌 ' + _esc(p) + '</span>'; }
  function _stepRowHtml(s, i) {
    var st = s || { use: 'create', args: {} };
    var argStr = JSON.stringify(st.args || {});
    var danger = /close|delete/i.test(argStr) ? '<span style="color:#ef5350;font-size:10px;" title="含 close/delete，需 args.confirm=true">⚠</span>' : '';
    return '<div class="cmdPalStep" style="border:1px solid var(--border,#444);border-radius:6px;padding:6px;margin-bottom:6px;">' +
             '<div style="display:flex;gap:6px;align-items:center;">' +
               '<span style="font-size:11px;color:var(--text2,#888);width:18px;">' + (i + 1) + '.</span>' +
               '<select class="cmdPalStepUse" style="flex:0 0 160px;font-size:12px;padding:4px;background:var(--bg,#111);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:5px;">' + _optA(st.use) + '</select>' +
               danger +
               '<span style="flex:1;"></span>' +
               '<button type="button" class="cmdPalStepDel" title="删除该步" style="flex:0 0 auto;font-size:12px;padding:4px 8px;border-radius:5px;border:1px solid #b71c1c;background:rgba(183,28,28,.15);color:#ef5350;cursor:pointer;">✕</button>' +
             '</div>' +
             '<div style="margin-top:5px;font-size:11px;color:var(--text2,#888);">参数 (JSON)，可用 ${参数名} 占位</div>' +
             '<input class="cmdPalStepArgs" value="' + _esc(argStr) + '" style="width:100%;box-sizing:border-box;margin-top:2px;font-size:12px;padding:5px;background:var(--bg,#111);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:5px;" />' +
             '<label style="font-size:11px;color:var(--text2,#888);cursor:pointer;"><input type="checkbox" class="cmdPalStepWait"' + (st.wait ? ' checked' : '') + '> 等待该对话空闲（send 后执行下一步前）</label>' +
           '</div>';
  }
  function _collectSteps() {
    // 从当前 DOM 收集步骤到 editMode.steps，返回是否全部合法
    var wrap = document.getElementById('cmdPalEditWrap');
    if (!wrap) return true;
    var out = [], bad = false;
    wrap.querySelectorAll('.cmdPalStep').forEach(function (el) {
      var args;
      try { args = JSON.parse(el.querySelector('.cmdPalStepArgs').value || '{}'); }
      catch (e) { bad = true; return; }
      var st = { use: el.querySelector('.cmdPalStepUse').value, args: args };
      if (el.querySelector('.cmdPalStepWait').checked) st.wait = true;
      out.push(st);
    });
    if (!bad) {
      editMode.steps = out;
      editMode.name = (document.getElementById('cmdPalEdName') || {}).value || editMode.name;
      editMode.desc = (document.getElementById('cmdPalEdDesc') || {}).value || editMode.desc;
    }
    return !bad;
  }
  function _scanParams(steps) {
    var re = /\$\{(\w+)\}/g, body = JSON.stringify(steps || []), names = [], m;
    while ((m = re.exec(body))) { if (names.indexOf(m[1]) < 0) names.push(m[1]); }
    return names;
  }
  function _renderEditor(box) {
    var params = _scanParams(editMode.steps);
    var inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:6px;background:var(--bg,#111);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:6px;';
    var btn = 'font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer;';
    var html =
      '<div style="font-size:12px;color:var(--text2,#999);margin-bottom:8px;">' + (editMode.oldName ? '✏️ 编辑宏「' + _esc(editMode.oldName) + '」· 修改后点保存（改名会删除旧宏）' : '✏️ 新建宏 · 填名称后逐步添加动作') + '（步骤参数里可用 <b>${参数名}</b> 占位，执行时会弹窗收集）</div>' +
      '<div style="margin-bottom:6px;"><input id="cmdPalEdName" placeholder="宏名称（必填）" value="' + _esc(editMode.name || '') + '" style="' + inp + '"/></div>' +
      '<div style="margin-bottom:8px;"><input id="cmdPalEdDesc" placeholder="描述（可选）" value="' + _esc(editMode.desc || '') + '" style="' + inp + '"/></div>' +
      '<div style="font-size:11px;color:var(--text2,#888);margin-bottom:4px;">步骤（自上而下执行）：</div>' +
      '<div id="cmdPalEditWrap">' + editMode.steps.map(_stepRowHtml).join('') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin:6px 0;">' +
        '<button type="button" id="cmdPalStepAdd" style="' + btn + '">＋ 添加步骤</button>' +
        (params.length ? '<span style="display:flex;gap:4px;flex-wrap:wrap;">' + params.map(_paramChip).join('') + '</span>' : '') +
      '</div>' +
      '<div id="cmdPalEdErr" style="color:#ef5350;font-size:11px;min-height:14px;margin-bottom:4px;"></div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button type="button" id="cmdPalEditSave" style="font-size:12px;padding:6px 18px;border-radius:6px;border:1px solid #2e7d32;background:rgba(46,125,50,.2);color:inherit;cursor:pointer;font-weight:600;">💾 保存宏</button>' +
        '<button type="button" id="cmdPalEditCancel" style="' + btn + '">取消</button>' +
      '</div>';
    box.innerHTML = html;
    var add = document.getElementById('cmdPalStepAdd'); if (add) add.onclick = addStep;
    var sv = document.getElementById('cmdPalEditSave'); if (sv) sv.onclick = saveEditor;
    var cc = document.getElementById('cmdPalEditCancel'); if (cc) cc.onclick = function () { editMode = null; renderMacros(); };
    box.querySelectorAll('.cmdPalStepDel').forEach(function (b, idx) { b.onclick = function () { delStep(idx); }; });
  }
  function openEditor() {
    editMode = { name: '', desc: '', steps: [{ use: 'create', args: { firstMessage: '' } }] };
    renderMacros();
  }
  // F5：编辑回填，复用同一编辑器；oldName 记录改名前的宏名（保存时若改名先删旧）
  function openEditorFor(name) {
    var lib = {};
    try { var cm = _chatMgr(); lib = (cm && cm._macroLib) ? cm._macroLib(true) : {}; } catch (e) { lib = {}; }
    var m = lib[name] || {};
    var steps = (m.steps || []).map(function (st) {
      return { use: st.use || 'create', args: st.args || {}, wait: !!st.wait };
    });
    if (!steps.length) steps = [{ use: 'create', args: {} }];
    editMode = { name: name, desc: m.desc || '', steps: steps, oldName: name };
    renderMacros();
  }
  function addStep() {
    if (!_collectSteps()) return;
    editMode.steps.push({ use: 'send', args: { target: '', message: '' } });
    renderMacros();
  }
  function delStep(i) {
    if (!_collectSteps()) return;
    editMode.steps.splice(i, 1);
    renderMacros();
  }
  function saveEditor() {
    if (!_collectSteps()) { _edErr('有步骤的参数不是合法 JSON，请修正'); return; }
    if (!editMode.name || !editMode.name.trim()) { _edErr('请填写宏名称'); return; }
    if (!editMode.steps.length) { _edErr('至少添加一个步骤'); return; }
    if (!_chatManage) { _edErr('对话管理模块未就绪，无法保存宏'); return; }
    var newName = editMode.name.trim();
    var res = _chatManage({ action: 'macro_save', name: newName, steps: editMode.steps, desc: (editMode.desc || '').trim() });
    if (res && res.success) {
      // F5 改名：保存新宏成功后删除旧名宏
      if (editMode.oldName && editMode.oldName !== newName) {
        _chatManage({ action: 'macro_delete', name: editMode.oldName });
        _log('✓ 已重命名宏 [' + editMode.oldName + '] → [' + newName + ']（' + editMode.steps.length + ' 步）', 'ok');
      } else {
        _log('✓ 已保存宏 [' + newName + ']（' + editMode.steps.length + ' 步）', 'ok');
      }
      editMode = null;
      renderMacros();
    } else {
      _edErr('保存失败：' + ((res && res.message) || '未知错误'));
    }
  }
  function _edErr(msg) { var e = document.getElementById('cmdPalEdErr'); if (e) e.textContent = msg; }

  function seedMacros() {
    var demos = [
      {
        action: 'macro_save', name: '示例-排列画布', desc: '一键排列全部对话框',
        steps: [{ use: 'chat_manage', args: { action: 'arrange' } }]
      },
      {
        action: 'macro_save', name: '示例-新建并发送', desc: '新建一个对话并发一条消息（参数化 ${msg}）',
        steps: [{ use: 'chat_manage', args: { action: 'create', name: '宏测试-${msg}' } },
                { use: 'chat_manage', args: { action: 'send', message: '${msg}' }, wait: true }]
      },
      {
        action: 'macro_save', name: '示例-批量建对话', desc: '按主题连续新建 3 个对话（参数化 ${topic}）',
        steps: [{ use: 'chat_manage', args: { action: 'create', name: '${topic}-A' } },
                { use: 'chat_manage', args: { action: 'create', name: '${topic}-B' } },
                { use: 'chat_manage', args: { action: 'create', name: '${topic}-C' } }]
      },
      {
        action: 'macro_save', name: '示例-建群并排布', desc: '新建 2 个对话发同一问题后一键排布（参数化 ${q}）',
        steps: [{ use: 'chat_manage', args: { action: 'create', name: '讨论1-${q}' } },
                { use: 'chat_manage', args: { action: 'send', message: '${q}' }, wait: true },
                { use: 'chat_manage', args: { action: 'create', name: '讨论2-${q}' } },
                { use: 'chat_manage', args: { action: 'send', message: '${q}' }, wait: true },
                { use: 'chat_manage', args: { action: 'arrange' } }]
      },
      {
        action: 'macro_save', name: '示例-新建提问(参数)', desc: '新建对话并发送自定义问题（参数化 ${question}）',
        steps: [{ use: 'chat_manage', args: { action: 'create', name: 'Q-${question}' } },
                { use: 'chat_manage', args: { action: 'send', message: '${question}' }, wait: true }]
      }
    ];
    var okCnt = 0;
    demos.forEach(function (d) {
      var r = _chatManage(d);
      if (r && r.success) okCnt++;
      _log((r && r.message) || JSON.stringify(r));
    });
    _log('✓ 预置完成：成功 ' + okCnt + '/' + demos.length + ' 个示例宏', okCnt === demos.length ? 'ok' : 'run');
    renderMacros();
  }

  function runMacro(name, dry) {
    var lib = {};
    try { var cm = _chatMgr(); lib = (cm && cm._macroLib) ? cm._macroLib(true) : {}; } catch (e) { lib = {}; }
    var steps = ((lib[name] || {}).steps) || [];
    var pnames = _scanParams(steps);
    var params = {};
    function _doRun() {
      _log((dry ? '[预演] ' : '[执行] ') + '宏 ' + name + ' …', 'run');
      var payload = { action: 'macro_run', name: name, dry_run: !!dry };
      if (pnames.length) payload.params = params;
      var r = _chatManage(payload);
      _log((r && r.message) || JSON.stringify(r), r && r.success !== false ? 'ok' : 'err');
      if (r && r.data && Array.isArray(r.data.results)) {
        var okCnt = 0, total = r.data.results.length;
        r.data.results.forEach(function (s) {
          if (s.ok) okCnt++;
          _log('  step' + s.step + ' [' + s.use + '] ' + (s.ok ? '✓' : '✗') + ' ' + (s.message || ''), s.ok ? '' : 'err');
        });
        _log('✓ ' + okCnt + '/' + total + ' 步成功' + (okCnt === total ? '，全部完成' : '，有失败步骤'), okCnt === total ? 'ok' : 'err');
      }
    }
    if (!dry && pnames.length && window.ConfirmDialog && window.ConfirmDialog.prompt) {
      _collectParams(pnames, 0, params, function (cancelled) {
        if (cancelled) { _log('已取消执行：参数未填完', 'run'); return; }
        _doRun();
      });
    } else {
      _doRun();
    }
  }
  function _collectParams(list, idx, params, done) {
    if (idx >= list.length) { done(false); return; }
    window.ConfirmDialog.prompt({ title: '宏参数：' + list[idx], message: '请输入 ${' + list[idx] + '} 的值（确定后进入下一个）' })
      .then(function (val) {
        if (val === null || typeof val === 'undefined') { done(true); return; }
        params[list[idx]] = val;
        _collectParams(list, idx + 1, params, done);
      });
  }

  function deleteMacro(name) {
    if (!window.confirm('删除宏「' + name + '」？')) return;
    var r = _chatManage({ action: 'macro_delete', name: name });
    _log((r && r.message) || JSON.stringify(r), r && r.success !== false ? 'ok' : 'err');
    renderMacros();
  }

  /* ---------- Python 工作台 ---------- */
  function renderPy() {
    var box = document.getElementById('cmdPalPy');
    if (!box) return;
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML =
      '<textarea id="cmdPalPyInput" rows="4" placeholder="输入 shell 命令（如 dir / python --version），Enter 执行，Shift+Enter 换行。仅限本机 127.0.0.1 调用。" style="width:100%;resize:vertical;background:var(--bg,#111);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:8px;padding:8px;font:12px Consolas,monospace;"></textarea>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
      '  <button id="cmdPalPyRun" style="font-size:12px;padding:6px 16px;border-radius:6px;border:1px solid #1565c0;background:rgba(21,101,192,.18);color:inherit;cursor:pointer;">▶ 执行</button>' +
      '  <span id="cmdPalPyHint" style="font-size:11px;color:var(--text2,#999);"></span>' +
      '</div>';
    document.getElementById('cmdPalPyRun').onclick = pyExec;
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;';
    bar.innerHTML =
      '  <button id="cmdPalPyHist" style="font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid #6a1b9a;background:rgba(106,27,154,.18);color:inherit;cursor:pointer;">📥 回读历史（双线）</button>' +
      '  <label style="font-size:11px;color:var(--text2,#999);cursor:pointer;"><input type="checkbox" id="cmdPalPyAuto" checked> 自动轮询（5s，实时看到智能体执行）</label>';
    document.getElementById('cmdPalPyRun').parentNode.appendChild(bar);
    document.getElementById('cmdPalPyHist').onclick = pyHistory;
    if (!_pollTimer) _pollTimer = setInterval(function () {
      var vis = (typeof visible !== 'undefined' && visible) && activeTab === 'pyconsole';
      var auto = document.getElementById('cmdPalPyAuto');
      if (vis && auto && auto.checked) pyHistory(true);
    }, 5000);
  }

  function _logHist(item) {
    var who = item.kind === 'agent' ? '🤖智能体' : '👤用户';
    _log('[' + who + ' ' + (item.ts || '') + '] $ ' + String(item.code || ''), item.kind === 'agent' ? 'ok' : 'run');
    if (item.output) _log(String(item.output));
    if (item.exit != null && item.exit !== 0) _log('  (exit=' + item.exit + ')', 'err');
  }

  function pyHistory(quiet) {
    fetch('/api/pyconsole/history?limit=30')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { if (!quiet) _log('✗ ' + ((d && d.error) || '回读失败'), 'err'); return; }
        if (!quiet) _log('—— 控制台历史（双线回读，最新 ' + (d.history || []).length + ' 条）——', 'ok');
        (d.history || []).slice(-15).forEach(_logHist);
        if (!quiet && !(d.history || []).length) _log('(暂无记录)');
      })
      .catch(function (e) { if (!quiet) _log('✗ 请求失败: ' + e.message, 'err'); });
  }

  function pyExec() {
    var ta = document.getElementById('cmdPalPyInput');
    var code = (ta.value || '').trim();
    if (!code) return;
    _log('$ ' + code, 'run');
    ta.value = '';
    var hint = document.getElementById('cmdPalPyHint');
    if (hint) hint.textContent = '执行中…';
    fetch('/api/pyconsole/exec', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (hint) hint.textContent = '';
      if (d && d.ok) { _log(d.output || '(无输出)'); }
      else { _log('✗ ' + ((d && d.error) || '执行失败'), 'err'); }
    }).catch(function (e) {
      if (hint) hint.textContent = '';
      _log('✗ 请求失败: ' + e.message, 'err');
    });
  }

  /* ---------- 输出区 / 切换 ---------- */
  function _renderOut() {
    var out = document.getElementById('cmdPalOut');
    if (!out) return;
    out.innerHTML = history.map(function (h) {
      var c = h.cls === 'err' ? 'color:#ef5350;' : h.cls === 'ok' ? 'color:#66bb6a;' : h.cls === 'run' ? 'color:#42a5f5;' : '';
      return '<div style="' + c + '"><span style="color:var(--text2,#777);">[' + h.t + ']</span> ' + _esc(h.line) + '</div>';
    }).join('');
    out.scrollTop = out.scrollHeight;
  }

  function switchTab(tab) {
    activeTab = tab || 'macros';
    var m = document.getElementById('cmdPalMacros'), p = document.getElementById('cmdPalPy');
    m.style.display = activeTab === 'macros' ? 'block' : 'none';
    p.style.display = activeTab === 'pyconsole' ? 'flex' : 'none';
    el.querySelectorAll('.cmdPalTab').forEach(function (b) {
      var on = b.getAttribute('data-tab') === activeTab;
      b.style.background = on ? 'rgba(25,118,210,.25)' : 'transparent';
    });
    if (activeTab === 'macros') renderMacros(); else renderPy();
  }

  function toggle(show) {
    _build();
    visible = (typeof show === 'boolean') ? show : !visible;
    el.style.display = visible ? 'block' : 'none';
    if (visible) switchTab(activeTab);
  }

  /* ---------- 全局热键：Backquote ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '`' && e.code !== 'Backquote') return;
    var t = e.target || {};
    var tag = (t.tagName || '').toLowerCase();
    // 输入类元素聚焦时不唤起（避免中文/英文输入中误触）
    if (tag === 'input' || tag === 'textarea' || t.isContentEditable) return;
    if (e.isComposing || e.keyCode === 229) return; // 中文输入法
    e.preventDefault();
    toggle();
  }, true);

  window.CommandPalette = { toggle: toggle, runMacro: runMacro, log: _log };
})();
