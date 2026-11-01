/* =====================================================================
 * chatbox-expert-team.js — 🎓 专家团（v1.0 MVP，2026-10-28）
 * =====================================================================
 * 设计（对齐策划案 v5 最终拍板）：
 *   - 派出团队面板新增「专家团」卡（审核员之后、总结师之前）。
 *   - 点一次专家团卡 = 展开「一个行业分组」的全部专家，每人开一个带工具的子对话。
 *   - 行业来源 = roles_db 的角色分组（含「专家团/」前缀优先）；无匹配则按叮嘱关键词挑分组。
 *   - 数量不限：跟随分组内专家人数，全部纳入（不再硬上限）。
 *   - 人设：固定叫「专家团」，不逐个选人设模型；统一继承主对话当前模型。
 *   - 箭头：复用 converge-arrow 统一收口体系（注册 role='expert'），不重造轮子。
 *   - 标题栏显示「专家团·{专家名}」，并设 _swarmLabel 供收口自动署名。
 * 防重复：同一源对话 60s 内多次触发只展开一次（crew 错峰可能对同一卡多次调 fn）。
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFExpertTeam) return; // 幂等守卫
  var P = window.ZFExpertTeam = { version: '1.0' };
  var _API = '/api/roles';

  function _log(level, srcId, msg) {
    try { if (typeof Store !== 'undefined' && Store.addLog) Store.addLog(level, srcId, 'expert', msg); } catch (e) {}
  }

  /* 拉取角色库：返回 {roles, groups} */
  function _fetchRoles(cb) {
    try {
      fetch(_API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { cb(d && d.ok ? d : null); })
        .catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }

  /* 取全量角色（GET 更直接拿 groups 名映射；POST list 仅返回 roles） */
  function _loadAll(cb) {
    try {
      fetch(_API + '?box=' + encodeURIComponent(''), { method: 'GET' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) { cb(d.roles || [], d.groups || []); }
          else { _fetchRoles(function (x) { cb((x && x.roles) || [], []); }); }
        })
        .catch(function () { _fetchRoles(function (x) { cb((x && x.roles) || [], []); }); });
    } catch (e) { _fetchRoles(function (x) { cb((x && x.roles) || [], []); }); }
  }

  /* 选行业分组：优先按叮嘱关键词命中组名（行业精准）；其次「专家」默认组；否则 null */
  function _pickGroup(groups, note) {
    if (!groups || !groups.length) return null;
    var i, g;
    var kw = String(note || '').trim();
    if (kw) {
      for (i = 0; i < groups.length; i++) {
        g = groups[i];
        if (g && kw.indexOf(String(g.name || '')) >= 0) return g;
      }
    }
    for (i = 0; i < groups.length; i++) {
      g = groups[i];
      if (g && String(g.name || '').indexOf('专家') >= 0) return g;
    }
    return null;
  }

  /* 收集原对话上下文（首问 + 最近一轮用户提问，做 MVP 精简口径） */
  /* F5 共用：错峰开窗派出 experts 数组（命中库 / 自动生成 两条路径复用） */
  function _launchExperts(chat, experts, note, selfApp) {
    var ctx = _collectContext(chat);
    if (selfApp && selfApp._stepToast) selfApp._stepToast('🎓 专家团派出：' + experts.length + ' 位专家并行产出', true);
    /* 【v2 修复·4派2收】派出确认即按计划人数登记账本 expected 占位：
       后续收口箭头建起时 register 合并不缩小，且 gatherFor 见 outstanding>0 不提前收口 */
    try { if (window.ZFDispatchLedger && ZFDispatchLedger.registerExpected) ZFDispatchLedger.registerExpected(chat.id, experts.length); } catch (eLed) {}
    experts.forEach(function (ex, idx) {
      setTimeout(function () {
        try { _openOneExpert(chat, ex, ctx, note, idx, experts.length); }
        catch (e) { _log('error', chat.id, '专家开窗异常(' + (ex && ex.name) + '): ' + (e && e.message)); }
      }, idx * 700);
    });
  }

  /* F5.5：派出前确认窗口 — 列出拟派专家（默认全选），用户可勾选增减，确认后才真正开窗 */
  function _confirmDialog(chat, experts, note, selfApp) {
    // 若同一源对话 60s 内已确认过（重复触发），直接沿用上次选择，不再弹窗
    try {
      window._zfExpertConfirmed = window._zfExpertConfirmed || {};
      var lastOk = window._zfExpertConfirmed[chat.id] || 0;
      if (Date.now() - lastOk < 60000) { _launchExperts(chat, experts, note, selfApp); return; }
    } catch (eC) {}

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var dlg = document.createElement('div');
    dlg.style.cssText = 'background:#fff;border-radius:12px;padding:18px 20px;width:420px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.3);font-family:inherit;';
    var html = '';
    html += '<div style="font-weight:bold;font-size:15px;margin-bottom:4px;">🎓 专家团派出确认</div>';
    html += '<div style="font-size:12px;color:#888;margin-bottom:10px;">AI 拟派出 ' + experts.length + ' 位专家，去掉不相关/太多可取消勾选，确认后才开窗：</div>';
    html += '<div style="margin-bottom:8px;text-align:right;"><label style="font-size:12px;color:#4a7;cursor:pointer;"><input type="checkbox" id="_zfExpAll" checked> 全选</label></div>';
    html += '<div id="_zfExpList" style="flex:1;overflow:auto;border:1px solid #eee;border-radius:8px;padding:8px;">';
    for (var i = 0; i < experts.length; i++) {
      var ex = experts[i] || {};
      var brief = String(ex.prompt || '').slice(0, 40);
      html += '<label style="display:flex;align-items:flex-start;gap:6px;padding:5px 4px;border-radius:6px;cursor:pointer;" onmouseover="this.style.background=#f6f6f6" onmouseout="this.style.background=\'\'">';
      html += '<input type="checkbox" class="_zfExpChk" data-i="' + i + '" checked style="margin-top:2px;">';
      html += '<span style="font-size:13px;"><b>' + _esc(ex.name || '专家') + '</b>';
      if (brief) html += '<span style="color:#999;font-size:11px;"> — ' + _esc(brief) + '…</span>';
      html += '</span></label>';
    }
    html += '</div>';
    html += '<div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end;">';
    html += '<button id="_zfExpCancel" style="padding:7px 18px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;font-size:13px;">取消</button>';
    html += '<button id="_zfExpOk" style="padding:7px 22px;border:none;background:#4a7;color:#fff;border-radius:8px;cursor:pointer;font-size:13px;">确认派出</button>';
    html += '</div>';
    dlg.innerHTML = html;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);

    function _picked() {
      var out = [];
      var chks = dlg.querySelectorAll('._zfExpChk');
      for (var k = 0; k < chks.length; k++) {
        if (chks[k].checked) out.push(experts[parseInt(chks[k].getAttribute('data-i'), 10)]);
      }
      return out;
    }
    var allChk = dlg.querySelector('#_zfExpAll');
    allChk.addEventListener('change', function () {
      var chks = dlg.querySelectorAll('._zfExpChk');
      for (var k = 0; k < chks.length; k++) chks[k].checked = allChk.checked;
    });
    dlg.querySelector('#_zfExpCancel').addEventListener('click', function () {
      document.body.removeChild(overlay);
      try { window._zfExpertDispatched[chat.id] = 0; } catch (eR) {}
      _log('info', chat.id, '专家团：用户取消派出');
      if (selfApp && selfApp._stepToast) selfApp._stepToast('🎓 专家团：已取消派出', true);
    });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) dlg.querySelector('#_zfExpCancel').click(); });
    dlg.querySelector('#_zfExpOk').addEventListener('click', function () {
      var picked = _picked();
      if (!picked.length) {
        if (selfApp && selfApp._stepToast) selfApp._stepToast('至少勾选 1 位专家才能派出', false);
        return;
      }
      try { window._zfExpertConfirmed[chat.id] = Date.now(); } catch (eT) {}
      document.body.removeChild(overlay);
      _log('info', chat.id, '专家团：用户确认派出 ' + picked.length + '/' + experts.length + ' 位');
      _launchExperts(chat, picked, note, selfApp);
    });
  }
  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* F5：库无匹配时调后端 AI 自动生成专家（归档到「专家团」分组），回调返回新建角色数组 */
  function _autoGenerate(hintTxt, cb) {
    try {
      fetch('/api/roles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'expert_auto_generate', hint: String(hintTxt || '').slice(0, 200), group_name: '专家团', count: 3 })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.ok && res.roles && res.roles.length) {
          _log('info', (hintTxt || '').slice(0, 20), '专家团自动生成 ' + res.roles.length + ' 位并归档');
          cb(res.roles);
        } else {
          _log('warn', (hintTxt || '').slice(0, 20), '自动生成失败:' + ((res && res.error) || '未知'));
          cb(null);
        }
      }).catch(function (e) { _log('error', '', '自动生成网络异常: ' + (e && e.message)); cb(null); });
    } catch (e) { cb(null); }
  }
  function _collectContext(chat) {
    var firstQ = '', lastQ = '';
    try {
      for (var i = 0; i < chat.history.length; i++) {
        var h = chat.history[i];
        if (!h || h.role !== 'user') continue;
        if (h._guardInject || h._verifyRound || h._thinkerRound || h._summarizerRound || h._customRound || h._expertRound) continue;
        var t = _msgText(h);
        if (!t || t.indexOf('（策划师素材包') === 0 || t.indexOf('（总结师素材包') === 0 ||
            t.indexOf('（审核员素材包') === 0 || t.indexOf('（自定义素材包') === 0 || t.indexOf('（专家团素材包') === 0) continue;
        if (!firstQ) firstQ = t;
        lastQ = t;
      }
    } catch (e) {}
    return { firstQ: firstQ, lastQ: lastQ };
  }

  function _msgText(m) {
    try {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        var s = '';
        for (var i = 0; i < m.content.length; i++) {
          if (m.content[i] && m.content[i].type === 'text') s += m.content[i].text;
        }
        return s;
      }
    } catch (e) {}
    return '';
  }

  /* 组装单个专家素材包 */
  function _buildPrompt(expert, ctx, note) {
    var lines = [];
    lines.push('【专家团】你是一名行业专家：' + (expert.name || '专家') + '。');
    lines.push('');
    lines.push('== 你的专业人设 ==');
    lines.push(String(expert.prompt || '以该职业的专业视角独立给出建议。'));
    lines.push('');
    lines.push('== 用户需求（源头） ==');
    lines.push(ctx.firstQ || (note || '（见项目上下文）'));
    if (ctx.lastQ && ctx.lastQ !== ctx.firstQ) {
      lines.push('== 最新一轮需求 ==');
      lines.push(ctx.lastQ);
    }
    if (note) {
      lines.push('== 本次叮嘱 ==');
      lines.push(note);
    }
    lines.push('');
    lines.push('== 你的任务 ==');
    lines.push('1. 仅从「' + (expert.name || '专家') + '」这一专业视角发言，给出对该需求具体、可执行的建议（不要泛泛而谈，不要替其他专家说话）；');
    lines.push('2. 若建议需要落地（如生成图片/视频/文案），给出该专业的关键参数或注意事项；');
    lines.push('3. 你是专家团中的一员，多名专家并行，输出保持独立判断，不要假设能看到其他人的结论；');
    lines.push('4. 完成后，最后必须单独一行以「【专家团·' + (expert.name || '专家') + '·结论】」开头，用 1~3 条编号给出你的核心建议（供汇总回注主对话）。');
    return lines.join('\n');
  }

  /* 开一个专家子窗（复刻 _customExpand 精简链路：定位/注册箭头/标题/发送） */
  function _openOneExpert(chat, expert, ctx, note, idx, total) {
    var selfApp = (typeof App !== 'undefined') ? App : null;
    if (!selfApp || typeof selfApp.createChatBox !== 'function') {
      _log('error', chat.id, '专家团失败：无法创建新对话');
      try { if (selfApp && selfApp._stepToast) selfApp._stepToast('专家团失败：无法创建新对话', false); } catch (e) {}
      return null;
    }
    var canvasArea = document.getElementById('canvasArea');
    var _srcL = 0, _srcT = 0, _srcW = 420, _srcH = 520;
    try {
      var _sc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
      if (!(_sc > 0)) _sc = 1;
      var _cv = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
      var _r = chat.el.getBoundingClientRect();
      var _caR = canvasArea ? canvasArea.getBoundingClientRect() : { left: 0, top: 0 };
      _srcL = Math.round((_r.left - _caR.left - (_cv.x || 0)) / _sc);
      _srcT = Math.round((_r.top - _caR.top - (_cv.y || 0)) / _sc);
      _srcW = _r.width / _sc || 420;
      if (chat.el.offsetHeight) _srcH = chat.el.offsetHeight / _sc;
    } catch (eS) {}
    // 阶梯排布（用注册表 nextIdxFor 防叠点，专家按 idx 右移）
    var _eIdx = 0;
    try { _eIdx = Math.max(0, ((window.ZFSwarm && window.ZFSwarm.nextIdxFor) ? window.ZFSwarm.nextIdxFor(chat.id, 'expert') : (idx + 1)) - 1); } catch (eIdx) {}
    if (idx > 0) _eIdx = Math.max(_eIdx, idx);
    var _X = _srcL + _srcW + 10 + _eIdx * 20;
    var _Y = _srcT + 10 + _eIdx * 46;
    if (!isFinite(_X)) _X = 120;
    if (!isFinite(_Y)) _Y = 120;

    var _srcMid = '';
    try { _srcMid = (typeof App !== 'undefined' && typeof App._toolMasterResolveModelId === 'function') ? (App._toolMasterResolveModelId(chat) || '') : ''; } catch (e) {}
    if (!_srcMid) _srcMid = chat.modelId || '';

    var newChat = selfApp.createChatBox(_X, _Y, _srcMid || null, true);
    if (!newChat) {
      _log('warn', chat.id, '专家团：开窗被拦截（窗口数量限制）');
      return null;
    }
    // 存活/身份标记
    try {
      newChat.el._isExpertChat = true;
      newChat.el._expertSrcId = chat.id;
      try { window.ZFSwarm && window.ZFSwarm.register(newChat.id, 'expert', chat.id, idx); } catch (eReg) {}
      /* 【v2 修复·4派2收】每开出一个专家窗即合并登记，保证箭头建起时 register 不缩小规模 */
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.register) ZFDispatchLedger.register(chat.id, [newChat.id]); } catch (eLed2) {}
    } catch (eFlag) {}
    // 配置继承（模型/项目/工具分类/引擎）
    try {
      var _inheritPid = chat.projectId || (typeof App !== 'undefined' && App._activeProjectId) || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || '';
      if (_inheritPid) {
        newChat.projectId = _inheritPid;
        for (var i = 0; i < Store.data.chatBoxes.length; i++) {
          if (Store.data.chatBoxes[i].id === newChat.id) { Store.data.chatBoxes[i].projectId = _inheritPid; break; }
        }
        try { if (typeof DB !== 'undefined' && DB.setNodeProject) DB.setNodeProject(newChat.id, _inheritPid).catch(function () {}); } catch (e) {}
        try { if (typeof selfApp._updateProjectBtn === 'function') selfApp._updateProjectBtn(newChat); } catch (e) {}
      }
      if (chat._engine) newChat._engine = String(chat._engine);
      if (chat._modelIdOverride) newChat._modelIdOverride = String(chat._modelIdOverride);
      if (chat._reasoningEffort !== undefined && chat._reasoningEffort !== null) newChat._reasoningEffort = String(chat._reasoningEffort || '');
      if (chat._compressMode) newChat._compressMode = chat._compressMode;
      if (typeof Tools !== 'undefined' && Tools.chatCategories && Tools.chatCategories[chat.id]) Tools.chatCategories[newChat.id] = Tools.chatCategories[chat.id];
      try { if (typeof newChat._refreshModelPickerBtn === 'function') newChat._refreshModelPickerBtn(); } catch (e2) {}
      Store.saveChatBox(newChat, true);
    } catch (eInh) {}
    // 标题栏显示「专家团·{专家名}」+ _swarmLabel（收口署名）
    try {
      newChat.el._swarmLabel = '专家团·' + (expert.name || '专家');
      var _titleEl = newChat.el && newChat.el.querySelector('.title');
      if (_titleEl) { _titleEl.textContent = '🎓 专家团·' + (expert.name || '专家'); _titleEl.title = '专家团子对话（' + (expert.name || '') + '）'; }
    } catch (eT) {}
    Store.addLog && Store.addLog('info', chat.id, 'expert', '专家子窗已发起：' + (expert.name || '') + ' → ' + newChat.id);

    var _prompt = _buildPrompt(expert, ctx, note);
    setTimeout(function () {
      try {
        if (typeof selfApp.addMsg === 'function') selfApp.addMsg(newChat.el, '（专家团素材包 · ' + (expert.name || '专家') + '）', 'user', newChat.modelId);
        var _msg = { role: 'user', content: _prompt, _expertRound: true };
        newChat.history.push(_msg);
        selfApp.sendToModel(newChat.el, newChat);
      } catch (e) {
        _log('error', newChat.id, '专家团素材包发送异常: ' + (e && e.message));
      }
    }, 400);
    return newChat;
  }

  /* 派出入口：crew-panel expert 卡的 fn 调用此函数 */
  P.dispatch = function (box, chat, note) {
    var selfApp = (typeof App !== 'undefined') ? App : null;
    // 防重复：同源对话 60s 内只展开一次
    try {
      window._zfExpertDispatched = window._zfExpertDispatched || {};
      var last = window._zfExpertDispatched[chat.id] || 0;
      if (Date.now() - last < 60000) { return; }
      window._zfExpertDispatched[chat.id] = Date.now();
    } catch (eD) {}

    _loadAll(function (roles, groups) {
      if (!roles || !roles.length) {
        if (selfApp && selfApp._stepToast) selfApp._stepToast('专家团失败：角色库为空', false);
        return;
      }
      var selfApp2 = selfApp;
      // F7：行业判定交给 AI（后端 expert_plan），不再用前端关键词表
      var _hintTxt0 = (note ? note + ' ' : '') + ((chat.messages || []).filter(function (m) { return m.role === 'user'; }).map(function (m) { return m.content; }).join(' ')).slice(0, 200);
      fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'expert_plan', hint: _hintTxt0, groups: groups })
      }).then(function (r) { return r.json(); }).then(function (plan) {
        // 判定失败/超时/异常 → 不拦死，降级继续走派出流程（AI 判断本身 said need=false 才跳过）
        if (!plan || !plan.ok) {
          _log('info', chat.id, '专家团：AI 判断失败，降级直接派出');
        } else if (!plan.need) {
          if (selfApp2 && selfApp2._stepToast) selfApp2._stepToast('🎓 专家团：AI 判断该需求暂不需要行业专家，未派出。如确需专家，请在叮嘱里描述行业需求', true);
          _log('info', chat.id, '专家团：AI 判断不需要专家，跳过派出');
          return;
        }
        var gname = String(plan.group || '');
        // AI 若给了分组名 → 按名字匹配分组
        var aiGroup = null;
        if (gname) {
          for (var gi = 0; gi < groups.length; gi++) {
            if (String(groups[gi].name || '') === gname) { aiGroup = groups[gi]; break; }
          }
        }
        var group = aiGroup || _pickGroup(groups, note);
        var experts = [];
        if (group) {
          for (var i = 0; i < roles.length; i++) {
            if (String(roles[i].group || '') === String(group.id)) experts.push(roles[i]);
          }
        }
        // 兜底：AI 选的分组没角色 → 库里找名字含「师/专家」的角色
        if (!experts.length) {
          for (var j = 0; j < roles.length; j++) {
            if (String(roles[j].name || '').indexOf('师') >= 0 || String(roles[j].name || '').indexOf('专家') >= 0) experts.push(roles[j]);
          }
        }
        if (!experts.length) {
          // F5：库中无匹配专家 → 调后端让 AI 自动生成 3 位并归档，再派出
          if (selfApp && selfApp._stepToast) selfApp._stepToast('🎓 专家团：库中无该行业专家，AI 自动生成中…', true);
          _log('info', chat.id, '专家团：未匹配到专家，触发自动生成');
          var _hintTxt = _hintTxt0;
          _autoGenerate(_hintTxt, function (genRoles) {
            if (!genRoles || !genRoles.length) {
              try { window._zfExpertDispatched[chat.id] = 0; } catch (eR) {}
              if (selfApp && selfApp._stepToast) selfApp._stepToast('专家团：自动生成专家失败，请重试或手动建立该行业分组', false);
              return;
            }
            _confirmDialog(chat, genRoles, note, selfApp);
          });
          return;
        }
        _confirmDialog(chat, experts, note, selfApp);
      }).catch(function (eP) {
        _log('error', chat.id, '专家团 AI 判断异常: ' + (eP && eP.message));
        try { window._zfExpertDispatched[chat.id] = 0; } catch (eR2) {}
        if (selfApp && selfApp._stepToast) selfApp._stepToast('专家团：AI 调度判断失败，请重试', false);
      });
    });
  };

  // 暴露到 App（与 _customExpand 等同级，便于 crew-panel 直接调用）
  // 叮嘱来源：crew-panel 在每个角色 setTimeout 回调前重写 window._zfCustomNoteNext，此处读取同一句话
  try {
    if (typeof App !== 'undefined') App._expertDispatch = function (box, chat, n) {
      var _note = '';
      try {
        var _cn = window._zfCustomNoteNext;
        if (_cn && _cn.note && (Date.now() - (_cn.ts || 0) < 60000)) _note = String(_cn.note);
      } catch (eN) {}
      P.dispatch(box, chat, _note);
    };
  } catch (e) {}
})();
