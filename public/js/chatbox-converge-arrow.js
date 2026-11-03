/* ==========================================================================
 * chatbox-converge-arrow.js — 多角色探讨 1:N 橙金总箭头
 * 原对话 ? 角色分组(N个子对话)：点击=回收汇总回注 / 再次点击=再分发，无限往复
 * ========================================================================== */
(function () {
  'use strict';
  if (window.ZFConvergeArrow) return;

  /* ---------- 多视角蜂群辅助：序号/视角查询（供 agent-01 调用） ---------- */
  var THINKER_VIEWS = ['技术可行性', '成本效率', '用户体验', '风险备选'];
  var QC_VIEWS = ['严谨性', '性能', '安全', '边界', '体验'];
  function srcCount(srcId, flag, srcFlag) {
    var n = 0;
    var boxes = (window.App && App.chatBoxes) || [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b && b.el && b.el[flag] && String(b.el[srcFlag]) === String(srcId)) n++;
    }
    return n;
  }
  function viewName(srcId, boxId, flag, srcFlag, pool) {
    /* 【蜂群持久化】优先读注册表固化的视角序号（刷新/关窗后不重排），兜底按当前顺序推算 */
    try {
      var _rec = regLoad()[String(boxId)];
      if (_rec && typeof _rec.viewIdx === 'number' && _rec.viewIdx >= 0) return pool[_rec.viewIdx % pool.length];
    } catch (eR) {}
    var boxes = (window.App && App.chatBoxes) || [];
    var idx = 0;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b && b.el && b.el[flag] && String(b.el[srcFlag]) === String(srcId)) {
        idx++;
        if (b.id === boxId) return pool[(idx - 2 + pool.length * 10) % pool.length];
      }
    }
    return '';
  }
  var REG_KEY = 'zf_swarm_registry';
  function regLoad() { try { return JSON.parse(localStorage.getItem(REG_KEY) || '{}'); } catch (e) { return {}; } }
  function regSave(r) { try { localStorage.setItem(REG_KEY, JSON.stringify(r)); } catch (e) {} }
  function regApply(box, aliveIds) {
    /* 刷新后 el 标记丢失：从注册表回写蜂群身份，收口箭头/视角/计数即可恢复。
       源对话已删除（不在 aliveIds）时不恢复，避免残留窗口拿过期身份建假箭头 */
    if (!box || !box.el || !box.id) return;
    var r = regLoad()[String(box.id)];
    if (!r) return;
    if (aliveIds && !aliveIds[String(r.srcId)]) return;
    if (r.role === 'qc') { box.el._isQcChat = true; box.el._qcSrcId = r.srcId; }
    else if (r.role === 'thinker') { box.el._isThinkerChat = true; box.el._thinkerSrcId = r.srcId; }
    else if (r.role === 'custom') { box.el._isCustomChat = true; box.el._customSrcId = r.srcId; }
    else if (r.role === 'expert') { box.el._isExpertChat = true; box.el._expertSrcId = r.srcId; }
    else if (r.role === 'polisher') { box.el._isPolisherChat = true; box.el._polisherSrcId = r.srcId; }
    else if (r.role === 'security') { box.el._isSecurityChat = true; box.el._securitySrcId = r.srcId; }
    /* 恢复命中即续期，防止长期活跃窗被 7 天超龄清理误删 */
    try {
      var reg = regLoad();
      if (reg[String(box.id)] && reg[String(box.id)].t) {
        reg[String(box.id)].t = Date.now();
        regSave(reg);
      }
    } catch (eT) {}
  }
  window.ZFSwarm = {
    register: function (boxId, role, srcId, viewIdx) { var r = regLoad(); r[String(boxId)] = { role: role, srcId: String(srcId), viewIdx: typeof viewIdx === 'number' ? viewIdx : null, t: Date.now() }; regSave(r); },
    unregister: function (boxId) { var r = regLoad(); delete r[String(boxId)]; regSave(r); },
    thinkerCountFor: function (srcId) { return srcCount(srcId, '_isThinkerChat', '_thinkerSrcId'); },
    qcCountFor: function (srcId) { return srcCount(srcId, '_isQcChat', '_qcSrcId'); },
    /* 【多窗排布修复】同步批量派单时 App.chatBoxes 尚未登记，实时计数会全部返回 0 导致多窗叠点。
       改用蜂群注册表（spawn 后同步写入、localStorage 持久化）计数，与实时计数取较大者 */
    nextIdxFor: function (srcId, role) {
      var n = 0;
      try {
        var r = regLoad();
        var boxes = (window.App && App.chatBoxes) || [];
        var alive = {};
        for (var i = 0; i < boxes.length; i++) { alive[String(boxes[i].id)] = true; }
        var now = Date.now();
        for (var k in r) {
          if (r[k] && r[k].role === role && String(r[k].srcId) === String(srcId)) {
            /* 【陈旧条目过滤】已关闭的窗（不在 chatBoxes 且注册超 7 天）不计入，防 idx 虚增 */
            if (!alive[k] && (!r[k].t || now - r[k].t > 7 * 864e5)) continue;
            n++;
          }
        }
      } catch (e) {}
      var flag = role === 'qc' ? '_isQcChat' : '_isThinkerChat';
      var srcFlag = role === 'qc' ? '_qcSrcId' : '_thinkerSrcId';
      return Math.max(n, srcCount(srcId, flag, srcFlag));
    },
    /* 取同源同类中最新的兄弟窗（注册时间 t 最大者），供新窗基于上一个的位置阶梯排布 */
    lastSibling: function (srcId, role) {
      var flag = role === 'qc' ? '_isQcChat' : '_isThinkerChat';
      var srcFlag = role === 'qc' ? '_qcSrcId' : '_thinkerSrcId';
      var best = null, bestT = -1, reg = {};
      try { reg = regLoad(); } catch (e) {}
      var boxes = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (b && b.el && b.el[flag] && String(b.el[srcFlag]) === String(srcId)) {
          var rec = reg[String(b.id)];
          var t = (rec && rec.t) || 0;
          if (t >= bestT) { bestT = t; best = b; }
        }
      }
      return best;
    },
    thinkerViewName: function (srcId, boxId) { return viewName(srcId, boxId, '_isThinkerChat', '_thinkerSrcId', THINKER_VIEWS); },
    qcViewName: function (srcId, boxId) { return viewName(srcId, boxId, '_isQcChat', '_qcSrcId', QC_VIEWS); },
    /* 【v27 修复·异角色混入】可选 role 过滤：只统计同角色成员。不传 role 时保持旧行为（兼容旧调用），
       收口箭头创建处必须传 role，否则"2 策划 + 1 残留审核窗"会把审核窗算进成员，
       收口永远等不到审核成员就绪 → gatherFor 恒 false 又回到干等兜底的原症状 */
    membersOf: function (srcId, role) {
      var boxes = (window.App && App.chatBoxes) || [];
      var out = [];
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (!b || !b.el) continue;
        if (role === 'thinker') { if (b.el._isThinkerChat && String(b.el._thinkerSrcId) === String(srcId)) out.push(b); }
        else if (role === 'qc') { if (b.el._isQcChat && String(b.el._qcSrcId) === String(srcId)) out.push(b); }
        else if (role === 'custom') { if (b.el._isCustomChat && String(b.el._customSrcId) === String(srcId)) out.push(b); }
        else if (role === 'expert') { if (b.el._isExpertChat && String(b.el._expertSrcId) === String(srcId)) out.push(b); }
        else if (role === 'polisher') { if (b.el._isPolisherChat && String(b.el._polisherSrcId) === String(srcId)) out.push(b); }
        else if (role === 'security') { if (b.el._isSecurityChat && String(b.el._securitySrcId) === String(srcId)) out.push(b); }
        else if ((b.el._isThinkerChat && String(b.el._thinkerSrcId) === String(srcId)) || (b.el._isQcChat && String(b.el._qcSrcId) === String(srcId))) out.push(b);
        else if (role === 'mixed') {
          /* 【混合团队总箭头】小队面板一次派出多个不同角色：所有指向同一源对话的子窗都算成员 */
          if ((b.el._isThinkerChat && String(b.el._thinkerSrcId) === String(srcId)) ||
              (b.el._isQcChat && String(b.el._qcSrcId) === String(srcId)) ||
              (b.el._isCustomChat && String(b.el._customSrcId) === String(srcId)) ||
              (b.el._isExpertChat && String(b.el._expertSrcId) === String(srcId)) ||
              (b.el._isPolisherChat && String(b.el._polisherSrcId) === String(srcId)) ||
              (b.el._isSecurityChat && String(b.el._securitySrcId) === String(srcId))) out.push(b);
        }
      }
      return out;
    },
    /* 【接力式微移排布】第一个窗不动，第 i 个窗只比第 i-1 个窗微微错开一点；
       槽位号固化保存（localStorage），只对策划师/审核员蜂群窗生效，已排过的不重排 */
    _slotsKey: 'zf_swarm_ladder_slots',
    _slotsLoad: function () { try { return JSON.parse(localStorage.getItem(this._slotsKey) || '{}'); } catch (e) { return {}; } },
    _slotsSave: function (r) { try { localStorage.setItem(this._slotsKey, JSON.stringify(r)); } catch (e) {} },
    /* 【v27 修复·异角色混入】role 可选：收口箭头排布必须传本窗角色，避免残留异角色窗混入排布/占槽位 */
    ladderArrange: function (srcId, role) {
      try {
        var self = this;
        var members = this.membersOf(srcId, role).filter(function (c) { return c && c.el && c.el.isConnected; });
        if (!members.length) return;
        var slots = self._slotsLoad();
        var key = String(srcId);
        if (!slots[key]) slots[key] = {};
        /* 找当前已固化槽位的最大号，后到窗接着往下排 */
        var maxSlot = 0;
        for (var k in slots[key]) { if (slots[key][k] > maxSlot) maxSlot = slots[key][k]; }
        var STEP = 46; /* 每个窗相对前一个的错开量 */
        var placed = 0; /* 本轮实际定位的窗序号（0=第一个，不动） */
        members.forEach(function (m) {
          var id = String(m.id);
          if (typeof slots[key][id] !== 'number') {
            slots[key][id] = maxSlot + 1 + placed;
            placed++;
          }
        });
        self._slotsSave(slots);
        members.forEach(function (m, i) {
          var slot = slots[key][String(m.id)];
          if (i === 0 || slot === 0) return; /* 第一个窗不管理，保持原位 */
          /* 目标位置 = 当前 members 中排在前一个的窗位置 + 错开量（接力式，只微移一点） */
          var prev = null;
          for (var p = 0; p < members.length; p++) {
            if (p !== i && slots[key][String(members[p].id)] === slot - 1) { prev = members[p]; break; }
          }
          if (!prev) return;
          /* 坐标系统一：style.left/top 是相对定位父容器的坐标，必须用 offsetLeft/offsetTop
             （视口坐标 getBoundingClientRect 会丢容器偏移，接力后越排越偏左上，被钳到 0 点） */
          var nl = Math.round(prev.el.offsetLeft + STEP);
          var nt = Math.round(prev.el.offsetTop + Math.round(STEP * 0.6));
          /* 【飞窗根治】原实现把 nl/nt 钳到 offsetParent 的 clientWidth/Height（可视区尺寸），
             画布可无限平移、窗口逻辑坐标可达几万，一钳就把窗口硬拉回容器原点附近——
             表现为"两窗重叠的一刹那，其中一个被移到很远处"。接力排布本就只相对前窗微移 46px，
             不会跑出屏，故只防 NaN/异常值，不做容器钳制 */
          if (!isFinite(nl) || nl < 0) nl = Math.round(prev.el.offsetLeft);
          if (!isFinite(nt) || nt < 0) nt = Math.round(prev.el.offsetTop);
          m.el.style.transition = 'left .25s, top .25s';
          m.el.style.left = nl + 'px';
          m.el.style.top = nt + 'px';
          /* 【动画后清理】移除常驻 transition，避免用户手动拖窗出现滑动迟滞 */
          setTimeout(function (el) { try { el.style.transition = ''; } catch (eT) {} }, 300, m.el);
        });
      } catch (e) {}
    }
  };

  /* ---------- 收口箭头自动管理：同源挂 ≥2 个蜂群窗时出现青色总箭头 ---------- */
  var convergeArrows = {}; // srcId -> pair
  var _lastMemberCount = {}; // srcId -> 上轮成员数（分批补排用）
  setInterval(function () {
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      var seen = {};
      var aliveIds = {};
      for (var ai = 0; ai < boxes.length; ai++) { if (boxes[ai] && boxes[ai].id) aliveIds[String(boxes[ai].id)] = true; }
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (!b || !b.el) continue;
        regApply(b, aliveIds); // 【蜂群持久化】刷新后从注册表恢复 el 标记（源对话已删则跳过）
        var isT = b.el._isThinkerChat, isQ = b.el._isQcChat, isC = b.el._isCustomChat, isE = b.el._isExpertChat;
        if (!isT && !isQ && !isC && !isE) continue;
        var srcId = isT ? b.el._thinkerSrcId : (isQ ? b.el._qcSrcId : (isC ? b.el._customSrcId : b.el._expertSrcId));
        if (!srcId) continue;
        /* 【v27 修复·异角色混入】按本窗角色取同角色成员，残留异角色窗不再混入收口箭头；自定义/专家角色同样参与收口 */
        var _role = isT ? 'thinker' : (isQ ? 'qc' : (isC ? 'custom' : 'expert'));
        /* 【混角色保护】同 srcId 下同时有策划窗+审核窗时取最大计数，避免后遍历角色覆盖前者 */
        var _cnt = window.ZFSwarm.membersOf(srcId, _role).length;
        seen[srcId] = Math.max(seen[srcId] || 0, _cnt);
        var members = window.ZFSwarm.membersOf(srcId, _role);
        /* 【混合团队总箭头】同源角色种类 ≥2（如小队面板一次派出策划+验证）时，
           同角色计数各为 1 不满足 ≥2 门槛，改用跨角色 union 成员建总箭头 */
        var _mixedKey = 'mixed:' + srcId;
        var _mixed = window.ZFSwarm.membersOf(srcId, 'mixed');
        var _kinds = {};
        _mixed.forEach(function (c) {
          if (c.el._isThinkerChat) _kinds.t = 1;
          else if (c.el._isQcChat) _kinds.q = 1;
          else if (c.el._isCustomChat) _kinds.c = 1;
          else if (c.el._isExpertChat) _kinds.e = 1;
          else if (c.el._isPolisherChat) _kinds.p = 1;
          else if (c.el._isSecurityChat) _kinds.s = 1;
        });
        var _kindN = Object.keys(_kinds).length;
        if (_kindN >= 2 && _mixed.length >= 2 && !convergeArrows[_mixedKey]) {
          var srcM = null;
          for (var jm = 0; jm < boxes.length; jm++) if (String(boxes[jm].id) === String(srcId)) { srcM = boxes[jm]; break; }
          if (srcM && srcM.el) {
            convergeArrows[_mixedKey] = ZFConvergeArrow.create(srcM, _mixed, '小队收口');
            /* 【单总箭头补刀】混合总箭头建起后，拆除此前先到的按角色总箭头（子窗分批到位时按角色分支会抢建） */
            if (convergeArrows[srcId]) { try { if (convergeArrows[srcId].el) convergeArrows[srcId].el.remove(); } catch (eRm) {} delete convergeArrows[srcId]; }
            try { setTimeout(function () { try { window.ZFSwarm.ladderArrange(srcId, 'mixed'); } catch (eL2m) {} }, 60); } catch (eLm) {}
          }
        }
        /* 【单总箭头】同源已出现 ≥2 种角色（或混合总箭头已建）时跳过按角色分支，保证同源只有一根总箭头 */
        if (members.length >= 2 && _kindN < 2 && !convergeArrows[srcId] && !convergeArrows[_mixedKey]) {
          var src = null;
          for (var j = 0; j < boxes.length; j++) if (boxes[j].id === srcId) { src = boxes[j]; break; }
          if (src && src.el) {
            convergeArrows[srcId] = ZFConvergeArrow.create(src, members, '蜂群收口');
            /* 【箭头锚点排布】全部子窗出现后，以箭头位置为锚统一阶梯排开，避免叠在一起 */
            try { setTimeout(function () { try { window.ZFSwarm.ladderArrange(srcId, _role); } catch (eL2) {} }, 60); } catch (eL) {}
          }
        }
        /* 【分批补排】子窗分批陆续出现时，成员数变化即补排一次，防后到窗与已排窗重叠 */
        if (members.length >= 2 && seen[srcId] !== _lastMemberCount[srcId]) {
          _lastMemberCount[srcId] = seen[srcId];
          try { setTimeout(function () { try { window.ZFSwarm.ladderArrange(srcId, _role); } catch (eL3) {} }, 120); } catch (eL4) {}
        }
      }
      // 清理失效箭头（【混合团队】key 为 'mixed:srcId' 的按 union 成员数判断，且需 ≥2 种角色）
      for (var k in convergeArrows) {
        var _keep = false;
        if (seen[k] && seen[k] >= 2 && convergeArrows[k] && convergeArrows[k].el && convergeArrows[k].el.isConnected) _keep = true;
        if (k.indexOf('mixed:') === 0) {
          var _mk = k.slice(6);
          var _mm = window.ZFSwarm.membersOf(_mk, 'mixed');
          if (_mm.length >= 2 && convergeArrows[k] && convergeArrows[k].el && convergeArrows[k].el.isConnected) _keep = true;
        }
        if (!_keep) { try { if (convergeArrows[k] && convergeArrows[k].el) convergeArrows[k].el.remove(); } catch (eC) {} delete convergeArrows[k]; }
      }
      /* 【注册表对账】① 窗口已关闭/删除 → 清注册表条目（仅 chatBoxes 非空时启用存活判断，空表保护防整表误清）；
         ② 超龄条目（7 天）兜底清除，防 localStorage 无限累积 */
      var reg = regLoad();
      var regDirty = false, now = Date.now(), MAX_AGE = 7 * 24 * 3600 * 1000;
      for (var rk in reg) {
        if (boxes.length > 0 && !aliveIds[rk]) { delete reg[rk]; regDirty = true; continue; }
        if (reg[rk] && reg[rk].t && now - reg[rk].t > MAX_AGE) { delete reg[rk]; regDirty = true; }
      }
      if (regDirty) regSave(reg);
      /* 【槽位对账】窗已关闭 → 同步清掉该窗的排布槽位，防后续新窗接历史最大槽位越排越远（空表保护） */
      var slotsReg = window.ZFSwarm._slotsLoad();
      var slotsDirty = false;
      for (var sk in slotsReg) {
        for (var mk in slotsReg[sk]) {
          if (boxes.length > 0 && !aliveIds[mk]) { delete slotsReg[sk][mk]; slotsDirty = true; }
        }
        var hasAny = false;
        for (var mk2 in slotsReg[sk]) { hasAny = true; break; }
        if (!hasAny) { delete slotsReg[sk]; }
      }
      if (slotsDirty) window.ZFSwarm._slotsSave(slotsReg);
    } catch (e) {}
  }, 1500);


  var SVG_NS = 'http://www.w3.org/2000/svg';
  var GOLD = '#4dd0e1';
  var GOLD_DARK = '#26c6da';
  var pairs = [];

  var STATUS = {
    discussing: { color: GOLD, text: '讨论中', flow: true },
    gathered:   { color: '#00e676', text: '已汇总', flow: false },
    failed:     { color: '#9e9e9e', text: '已失效', flow: false }
  };

  function findChat(id) {
    var boxes = (window.App && App.chatBoxes) || [];
    for (var i = 0; i < boxes.length; i++) {
      var c = boxes[i];
      if (c && String(c.id) === String(id) && c.el && c.el.isConnected) return c;
    }
    return null;
  }
  function toast(msg, ok) {
    try {
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:5000;padding:10px 22px;border-radius:10px;font-size:14px;color:#fff;background:' + (ok === false ? '#d32f2f' : '#2e7d32') + ';box-shadow:0 4px 16px rgba(0,0,0,.4);';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 2600);
    } catch (e) {}
  }
  function messagesOf(chat) {
    /* 兼容 messages / history 两种数据源 */
    try { if (Array.isArray(chat.messages) && chat.messages.length) return chat.messages; } catch (e) {}
    try { if (Array.isArray(chat.history)) return chat.history; } catch (e) {}
    return [];
  }
  /* 【W1 修复·报错占位不算已回复】最后一条 assistant 是错误占位消息（网络失败/请求失败等）时，
     不能当作"模型已真实回复完成"记账，否则收口会把报错汇总当结论 */
  function lastAssistantIsError(chat) {
    try {
      var ms = messagesOf(chat);
      for (var i = ms.length - 1; i >= 0; i--) {
        if (ms[i] && ms[i].role === 'assistant') {
          var t = String(ms[i].content || ms[i].text || '');
          return /（网络错误，发送失败|⚠️\s*请求失败|请求超时|模型未配置|发送失败）/.test(t);
        }
      }
    } catch (e) {}
    return false;
  }
  function assistantCount(chat) {
    var n = 0;
    try {
      var ms = messagesOf(chat);
      for (var i = 0; i < ms.length; i++) if (ms[i].role === 'assistant') n++;
    } catch (e) {}
    return n;
  }
  function lastAnswer(chat) {
    /* 【修复】跳过 ⏱__TASKMETA__ 元数据消息（任务耗时/状态行，非正文结论），
       否则收口会把 meta 行当策划师结论回注主对话，导致返回内容为空 */
    var META = '\u23F1__TASKMETA__';
    try {
      var ms = messagesOf(chat);
      for (var i = ms.length - 1; i >= 0; i--) {
        if (ms[i].role !== 'assistant') continue;
        var c = String(ms[i].content || '');
        if (c.indexOf(META) === 0) continue;
        return c;
      }
    } catch (e) {}
    return '';
  }
  function draftOf(chat) {
    /* 读取子窗输入框里用户手动输入但尚未发送的草稿，收口时一并回注主对话 */
    try {
      var input = chat.el && chat.el.querySelector('textarea');
      var v = input ? String(input.value || '').trim() : '';
      return v.slice(0, 1000);
    } catch (e) { return ''; }
  }
  function sendTo(chat, text) {
    /* 与策划师/审核员同款发消息路径：addMsg 展示 + push history + sendToModel 真实调用模型 */
    try {
      var app = (typeof App !== 'undefined') ? App : null;
      if (app && typeof app.addMsg === 'function' && typeof app.sendToModel === 'function' && chat) {
        app.addMsg(chat.el, text, 'user', chat.modelId);
        chat.history.push({ role: 'user', content: text, _multiRound: true });
        app.sendToModel(chat.el, chat);
      } else if (chat && typeof chat.send === 'function') {
        chat.send(text);
      }
    } catch (e) {}
  }
  function centerOf(chat) {
    var r = chat.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ---------- 状态渲染 ---------- */
  function applyStatus(pair) {
    var st = STATUS[pair.status] || STATUS.discussing;
    var svg = pair.el && pair.el.querySelector('svg');
    if (!svg) return;
    var line = svg.querySelector('.cv-line');
    var head = svg.querySelector('.cv-head');
    var rect = svg.querySelector('.cv-badge-rect');
    var txt = svg.querySelector('.cv-badge-text');
    /* 【可读性】白字+深描边，任何状态色上都清晰；徽章以中点居中加宽 */
    var label = st.text + (pair.rounds > 0 ? ' · 第' + pair.rounds + '轮' : '');
    txt.textContent = label;
    var fs = label.length > 8 ? 15 : 17;
    txt.setAttribute('font-size', fs);
    var w = Math.max(72, label.length * fs * 1.02 + 22);
    rect.setAttribute('width', w);
    rect.setAttribute('x', 120 - w / 2);
    txt.setAttribute('style', 'paint-order:stroke;stroke:rgba(0,20,26,.72);stroke-width:3.5px;stroke-linejoin:round;');
    [line, head, rect].forEach(function (n) { if (n) n.setAttribute('stroke', st.color), n.setAttribute('fill', st.color); });
    if (rect) rect.setAttribute('opacity', '0.95');
    if (st.flow) line.classList.add('cv-flow'); else line.classList.remove('cv-flow');
  }

  /* ---------- 持久化 ---------- */
  function persist() {
    try {
      localStorage.setItem('zf_converge_pairs', JSON.stringify(pairs.map(function (p) {
        return { srcId: p.srcId, memberIds: p.memberIds, groupName: p.groupName, state: p.state, status: p.status, rounds: p.rounds || 0, _autoTicket: p._autoTicket || 0,
          /* 【v11】持久化基线：恢复后基线不再缺失，杜绝"基线缺失→count>=1 兜底"误记带开场白的窗 */ memberCounts: p.memberCounts || {} };
      })));
    } catch (e) {}
  }
  function restorePairs(silent) {
    try {
      var arr = JSON.parse(localStorage.getItem('zf_converge_pairs') || '[]');
      arr.forEach(function (s) {
        var src = findChat(s.srcId);
        if (!src || !src.el) return;
        var members = (s.memberIds || []).map(findChat).filter(function (c) { return c && c.el; });
        if (!members.length) return;
        create(src, members, s.groupName || '多角色', s);
      });
    } catch (e) {}
  }

  /* ---------- 创建 1:N 箭头 ---------- */
  function create(srcChat, memberChats, groupName, saved) {
    if (!srcChat || !srcChat.el || !memberChats || !memberChats.length) return null;
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].srcId === srcChat.id && pairs[i].groupName === groupName && pairs[i].el && pairs[i].el.isConnected) return pairs[i];
    }
    var el = document.createElement('div');
    el.className = 'zf-converge-arrow';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:5200;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 0 8px rgba(77,208,225,.9));user-select:none;transition:transform .25s;';
    el.innerHTML =
      '<svg width="240" height="72" viewBox="0 0 240 72" xmlns="' + SVG_NS + '" style="overflow:visible">' +
      '<line class="cv-line" x1="6" y1="36" x2="168" y2="36" stroke="' + GOLD + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 10"/>' +
      '<polygon class="cv-head" points="162,6 234,36 162,66" fill="' + GOLD + '" stroke="#b2ebf2" stroke-width="3"/>' +
      '<g class="cv-badge">' +
      '<rect class="cv-badge-rect" x="84" y="18" width="72" height="34" rx="17" fill="' + GOLD + '" opacity="0.95"/>' +
      '<text class="cv-badge-text" x="120" y="41" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff" font-family="sans-serif">讨论中</text>' +
      '</g>' +
      '<style>.cv-flow{animation:cvFlow 1s linear infinite;}@keyframes cvFlow{to{stroke-dashoffset:-24;}}</style>' +
      '</svg>';
    document.body.appendChild(el);

    var pair = {
      srcId: srcChat.id,
      memberIds: memberChats.map(function (c) { return c.id; }),
      groupName: groupName || '多角色',
      el: el,
      state: 'toGroup',          // toGroup: 原对话→角色组; toSrc: 角色组→原对话
      status: (saved && saved.status) || 'discussing',
      phase: (saved && saved.state === 'toSrc') ? 'injected' : 'sent',
      rounds: (saved && saved.rounds) || 0,
      /* 【自动回收 v4】创建时认领全局一次性票据并立即清零：只作用于本 pair，不误触发其他就绪分组 */
      _autoTicket: (saved && saved._autoTicket) || 0,
      _gatherUsedAt: null,
      _autoTimer: null,
      memberCounts: (function () {
        /* 【v11】恢复优先：persist 存了基线就用存档（保证"恢复后 count>基线"仍表示新回复）；
           无存档（新创建）才取当前值。旧存档无 memberCounts 字段 → 取当前值，与新建同语义。 */
        if (saved && saved.memberCounts && Object.keys(saved.memberCounts).length) return JSON.parse(JSON.stringify(saved.memberCounts));
        var _mc = {};
        memberChats.forEach(function (c) { _mc[c.id] = assistantCount(c); });
        return _mc;
      })(),
      _sentAt: Date.now(),
      _lx: -1, _ly: -1, _ang: null
    };
    try {
      /* 【v8 修复】不再无条件全局清零 _zfAutoGatherNext——本 pair 创建通常发生在数量弹窗勾选后
         几百毫秒内，清零会把 thinker/verify/race 的自动回收凭证抹掉，导致勾了自动回收但角色回复后
         永远不回收。凭证语义下 thinker/verify/race 各自按 _gatherUsedAt 消费同一时间戳，互不抢占，
         此处只需认领自己的票据（_autoTicket），不动全局标志 */
      var _t0 = window._zfAutoGatherNext || 0;
      if (_t0 && (Date.now() - _t0) < 60000 && !pair._autoTicket) pair._autoTicket = _t0;
    } catch (e) {}
    memberChats.forEach(function (c) { pair.memberCounts[c.id] = assistantCount(c); });
    /* 【派发登记】派出即登记 N 份到服务器账本（returned=0），收齐/核销前 gatherFor 不放行 */
    try { if (window.ZFDispatchLedger && ZFDispatchLedger.register) ZFDispatchLedger.register(srcChat.id, pair.memberIds); } catch (eLR) {}
    pairs.push(pair);
    applyStatus(pair);
    persist();

    el.addEventListener('click', function (ev) { ev.stopPropagation(); onArrowClick(pair); });
    return pair;
  }

  /* ---------- 点击：回收汇总 / 再分发 ---------- */
  function onArrowClick(pair, fromAuto) {
    var src = findChat(pair.srcId);
    if (!src) { if (pair.el) pair.el.remove(); return false; }
    var members = pair.memberIds.map(findChat).filter(function (c) { return c && c.el; });
    if (!members.length) { toast('角色对话已全部关闭，箭头失效', false); pair.status = 'failed'; applyStatus(pair); return false; }

    if (pair.phase === 'sent') {
      /* 【收口防半截·v2 修复"返回不全"】任一成员仍在发送/流式生成中 → 本轮绝不能收口，
         否则把未结束对话的半截回复（或缺员）汇总回注主对话。手动点击提示稍后再点；
         自动回收路径（fromAuto）由 _autoTimer 负责重试，此处直接返回不翻状态。 */
      var _busyGather = false;
      try { members.forEach(function (m) { if (m.isSending) _busyGather = true; }); } catch (eBG) {}
      if (_busyGather) {
        /* fromAuto：静默返回由 _autoRetry 重试，不弹 toast 防每 2 秒刷屏 */
        if (!fromAuto) toast('还有角色正在回复，等全员结束后再收口', false);
        return false;
      }
      /* 【v8 全局账本·手动收口同门槛】派出数=回收数（returned∪closed≥expected）才准收口，
         自动/手动一个标准：审核师先完成绝不提前收回总箭头。记账同 gatherFor 口径：账本并集全成员 */
      try {
        var L8 = window.ZFDispatchLedger;
        if (L8 && typeof L8.autoCloseMissing === 'function') L8.autoCloseMissing(pair.srcId, findChat);
        if (L8 && typeof L8.canGather === 'function' && !L8.canGather(pair.srcId)) {
          var _ids = (pair.memberIds || []);
          _ids.forEach(function (m2) {
            var c2 = findChat(m2);
            /* 【v11·判据统一】唯一记账判据：count > 基线（确有本轮新回复）；
               基线缺失（persist 恢复）= 未就绪不记账，绝不退回 count>=1 弱判据
               （带开场白/历史回复的窗一开出即满足 → 审核员完成时验证师/优化师被
               误记"已回收"→提前归队）。与 tick/gatherFor 严格门槛全文件同口径。 */
            var _base = pair.memberCounts ? pair.memberCounts[m2] : null;
            var _cnt = assistantCount(c2);
            /* 【v15】错误回复也按本轮已完成入账（流式已落定），否则错误窗永远凑不齐 → 箭头永久不能回收 */
            var _err2 = lastAssistantIsError(c2);
            var _done = (_base != null) && ((_cnt > _base) || (_cnt === _base && _err2));
            if (c2 && c2.el && !c2.isSending && _done) L8.markReturned(pair.srcId, m2);
          });
          if (!L8.canGather(pair.srcId)) {
            toast((L8.progressText ? L8.progressText(pair.srcId) : '还有成员未完成') + '，点箭头无效', false);
            return false;
          }
        }
      } catch (eL8) {}
      /* 回收：收集全部成员最新回复 → 汇总回注原对话 */
      var lines = [];
      /* 【安全兜底·回注引用化】成员原文/草稿回注前统一截断，防超长与异常输出放大注入面 */
      function _clipNote(t, max) { t = String(t == null ? '' : t).trim(); return t.length > max ? t.slice(0, max) + '…（超长已截断）' : t; }
      members.forEach(function (m) {
        var ans = lastAnswer(m).slice(0, 2000);
        var name = (m.el && (m.el._swarmLabel || (m.el.querySelector('.title') && m.el.querySelector('.title').textContent) || '子窗'));
        /* 【v2 修复·4派2收】已回复完成的成员逐个记入账本 returnedIds（幂等） */
        try { if (window.ZFDispatchLedger && ZFDispatchLedger.markReturned) ZFDispatchLedger.markReturned(pair.srcId, m.id); } catch (eMR) {}
        if (ans) lines.push('▶ ' + name + '：\n' + ans.trim());
        /* 用户在子窗输入框手动输入、尚未发送的补充，随收口一起追加回注 */
        var draft = draftOf(m);
        if (draft) {
          lines.push('✎ ' + name + '（用户手动补充，未发送）：\n' + _clipNote(draft, 2000));
          try { m.el.querySelector('textarea').value = ''; } catch (eD) {}
          try { toast('「' + name + '」输入框草稿已带草稿回注', true); } catch (eT) {}
        }
        /* 【输入防丢·箭头输入框】该成员单体箭头（审核紫/策划箭头）输入框里的补充文字也一并带回 */
        try {
          var arrowNote = (window.ZFVerifyArrow && typeof ZFVerifyArrow.takeNoteFor === 'function' && ZFVerifyArrow.takeNoteFor(m.id)) ||
                          (window.ZFThinkerArrow && typeof ZFThinkerArrow.takeNoteFor === 'function' && ZFThinkerArrow.takeNoteFor(m.id)) || '';
          if (arrowNote) {
            lines.push('✎ ' + name + '（用户在箭头输入框补充的新要求）：\n' + _clipNote(arrowNote.replace(/^\s*\n\n【[^】]*】\n/, ''), 2000));
            try { toast('「' + name + '」箭头输入框补充已带回', true); } catch (eA) {}
          }
        } catch (eAN) {}
      });
      /* 【v12 修复·返回信息缺员】账本里登记但本 pair 未包含的成员（审核组/策划组各建各箭头，
         最后触发收口的箭头 pair.memberIds 只含本组成员 → 回注时其他人结论全部丢失）：
         按账本 memberIds 并集兜底收集，凡在账本、窗口仍在的成员结论/草稿一并带回 */
      try {
        var _recG = JSON.parse(localStorage.getItem('zf_dispatch_ledger') || '{}')[String(pair.srcId)] || null;
        if (_recG && (_recG.memberIds || []).length) {
          var _have = {};
          pair.memberIds.forEach(function (id) { _have[String(id)] = 1; });
          (_recG.memberIds || []).forEach(function (id) {
            var sid = String(id);
            if (_have[sid]) return;
            var chX = findChat(sid);
            if (!chX || !chX.el) return; /* 已关窗（核销路径）无法取内容，跳过 */
            _have[sid] = 1;
            var ansX = lastAnswer(chX).slice(0, 2000);
            var nameX = (chX.el && (chX.el._swarmLabel || (chX.el.querySelector('.title') && chX.el.querySelector('.title').textContent) || '子窗'));
            try { if (window.ZFDispatchLedger && ZFDispatchLedger.markReturned) ZFDispatchLedger.markReturned(pair.srcId, sid); } catch (eM2) {}
            if (ansX) lines.push('▶ ' + nameX + '：\n' + ansX.trim());
            var drX = draftOf(chX);
            if (drX) lines.push('✎ ' + nameX + '（用户手动补充，未发送）：\n' + _clipNote(drX, 2000));
          });
        }
      } catch (eLU) {}
      if (!lines.length) {
        /* fromAuto：静默返回重试；但成员全部空回复时重试永不自愈，交给过期降级兜底 */
        if (!fromAuto) toast('角色们还没有回复，无法汇总', false);
        return false;
      }
      var msg = '这是「' + pair.groupName + '」多视角蜂群的收口汇总（第' + (pair.rounds + 1) + '轮），包含多个审核员/策划师窗的独立视角结论。请逐条对比各方观点，明确说明采纳哪些、不采纳哪些及理由，然后继续推进任务，不要重复向用户追问已确认信息：\n\n' + lines.join('\n\n');
      sendTo(src, msg);
      /* 【派发登记·收口完成】全员结论已回注 → 清空该源对话的派发登记（一次派发一次收口） */
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.finish) ZFDispatchLedger.finish(pair.srcId); } catch (eLF) {}
      /* 【v8 方向入账】收口=箭头朝上（up），记入全局账本快照 */
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.setArrow) ZFDispatchLedger.setArrow(pair.srcId, 'up'); } catch (eLA) {}
      pair.rounds++;
      pair.phase = 'injected';
      pair.state = 'toSrc';
      pair.status = 'gathered';
      applyStatus(pair); persist();
      /* 【手动点击跟随修复】带上 manual 标记：监听端据此清掉小箭头的自动排队守卫，
         保证用户手动点大箭头时小箭头一定跟随反转，不被 autoloop 守卫拦截 */
      try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: pair.srcId, manual: !fromAuto } })); } catch (eE) {}
      toast('已汇总 ' + lines.length + ' 个角色观点回注原对话', true);
      return true;
    } else {
      /* 发散：把原对话最新回复/补充再次分发给每个角色 */
      var srcAns = lastAnswer(src);
      if (!srcAns) { toast('原对话还没有新内容可分发', false); return; }
      members.forEach(function (m) {
        sendTo(m, '【原对话最新进展 · 第' + (pair.rounds + 1) + '轮】\n' + srcAns.slice(0, 6000) + '\n\n请以你的角色视角，针对上述进展继续输出你的看法（以【XX观点】开头，简洁有锐度）。');
        pair.memberCounts[m.id] = assistantCount(m);
      });
      pair.phase = 'sent';
      pair.state = 'toGroup';
      pair.status = 'discussing';
      pair._sentAt = Date.now();
      pair._ready = false;
      applyStatus(pair); persist();
      /* 【v8 方向入账】再分发=箭头朝下（down），并开新账（清上一轮残账，防残账放行提前收口） */
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.register) ZFDispatchLedger.register(pair.srcId, pair.memberIds); } catch (eLR2) {}
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.setArrow) ZFDispatchLedger.setArrow(pair.srcId, 'down'); } catch (eLB) {}
      try { document.dispatchEvent(new CustomEvent('zf-multi-scattered', { detail: { srcId: pair.srcId, manual: true } })); } catch (eE) {}
      toast('已把原对话进展分发给 ' + members.length + ' 个角色', true);
    }
  }

  /* ---------- 主循环：跟随位置 + 检测回复 ---------- */
  var _rafId = 0;
  function tick() {
    _rafId = 0;
    try {
      for (var i = pairs.length - 1; i >= 0; i--) {
        var p = pairs[i];
        var src = findChat(p.srcId);
        var members = p.memberIds.map(findChat).filter(function (c) { return c && c.el; });
        /* 成员不足 2 个（关窗后只剩1个或全关）→ 收口箭头失去意义，自动溶解，避免与单体角色箭头重合 */
        if (!p.el || !p.el.isConnected || !src || members.length < 2) {
          if (p.el) p.el.remove();
          if (members.length < 2 && members.length > 0) toast('多角色窗口剩余1个，收口箭头已自动隐藏', true);
          pairs.splice(i, 1); persist(); continue;
        }
        /* 回复检测：全部成员都比上次多回复了 → 提示可回收 */
        if (p.status === 'discussing' && p.phase === 'sent') {
          var all = true;
          members.forEach(function (m) {
            /* 【修复·isSending 防误判】与策划师箭头 v27 同口径：成员仍在发送/流式/重试中
               （isSending=true）时，assistantCount 的增长可能只是流式占位消息，
               绝不能判定"已回复"，否则另一窗口未完成时收口箭头会把半截回复提前收口返回。
               必须等 isSending=false（本轮真正收尾）再计入已回复 */
            if (m.isSending) { all = false; return; }
            /* 【严格判定·无兜底】基线缺失一律视为未回复，绝不能按 0 兜底误判已回复 */
            if (p.memberCounts[m.id] == null) { all = false; return; }
            if (assistantCount(m) <= (p.memberCounts[m.id] || 0)) all = false;
          });
          if (all && p._sentAt && (Date.now() - p._sentAt) > 3000) {
            p.status = 'discussing';
            var bt = p.el.querySelector('.cv-badge-text');
            /* 【自动回收 v4】创建时认领的票据：只作用于本 pair，全局标志不再跨 pair 生效
               【v37 修复卡死】有效期由 60s 延长到 600s，与审核凭证 tryGroupAutoGather 的
               (ts - created > 600000) 口径对齐。旧值 60s：审核窗回复耗时 >60s 时票据已过期，
               _ag=false → 收口箭头不再自动回收，表现为"卡死没返回"。 */
            /* 【2026-11-01 按用户要求：彻底移除自动返回】_ag 恒 false，收口箭头不再自动回收，只保留手动点箭头回收 */
            var _ag = false; /* 原逻辑存档： !!(p._autoTicket && (Date.now() - p._autoTicket) < 600000); */
            if (bt) bt.textContent = _ag ? '自动回收中…' : '已就绪·点回收';
            p._ready = true;
            if (_ag && !p._autoTimer && !(p._gatherUsedAt && p._gatherUsedAt === p._autoTicket)) {
              p._gatherUsedAt = p._autoTicket;
              p._autoTimer = setTimeout(function _autoRetry() {
                p._autoTimer = null;
                /* 【防半截 v2】定时器到点再查一次全员是否结束：若仍有成员流式生成中，
                   原样重排 2 秒后重试（不消费票据、不翻状态），等真正全员结束才收口 */
                var _busyRetry = false;
                try { (p.memberIds || []).forEach(function (mid) {
                  var mm = findChat(mid); if (mm && mm.isSending) _busyRetry = true;
                }); } catch (eBR) {}
                /* 【v38 修复·完成不回收】票据一次性消费 + onArrowClick 内部还有二次拦截
                   （busy 二次判定 / lines 为空），任一拦截命中都会静默 return，
                   而 _gatherUsedAt 已提前记账 → 定时器永不再排 → 徽标永远停在
                   "自动回收中…"（实测复现：4 窗全部完成却不回收）。
                   修复：onArrowClick 返回是否成功，失败（非过期）时 2 秒后原样重排，
                   直到收口成功或票据超 600s 有效期为止 */
                var _expired = !(p._autoTicket && (Date.now() - p._autoTicket) < 600000);
                /* v39：过期不再静默 return（那只是把"永远卡"降级成"卡10分钟"），
                   降级徽标提示手动回收；若已就绪且无成员在流式，顺带降级提示 */
                if (_expired) {
                  try {
                    var _btX = p.el && p.el.querySelector('.cv-badge-text');
                    if (_btX && p.phase === 'sent' && p.status === 'discussing') _btX.textContent = '回收超时·点此手动回收';
                  } catch (eEX) {}
                  return;
                }
                if (_busyRetry) { p._autoTimer = setTimeout(_autoRetry, 2000); return; }
                if (p._ready && p.phase === 'sent' && p.el && p.el.isConnected) {
                  var _ok = false;
                  try { _ok = onArrowClick(p, true); } catch (eAC) { _ok = false; }
                  if (!_ok) { p._autoTimer = setTimeout(_autoRetry, 2000); return; }
                } else if (p.phase === 'sent') {
                  p._autoTimer = setTimeout(_autoRetry, 2000);
                }
              }, 2000);
            }
          }
        }
        /* 位置：原对话中心 → 成员中心点 */
        var ax = 0, ay = 0;
        members.forEach(function (m) { var c = centerOf(m); ax += c.x; ay += c.y; });
        var b = { x: ax / members.length, y: ay / members.length };
        var a = centerOf(src);
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var lx = mx - 120, ly = my - 36;
        if (p._lx !== lx || p._ly !== ly) {
          p.el.style.left = lx + 'px'; p.el.style.top = ly + 'px';
          p._lx = lx; p._ly = ly;
        }
        /* 【总览缩小跟随】画布缩小时箭头同步缩小（保底 0.35），围绕箭头中点缩放 */
        var _sc = (window.App && App.canvasScale) ? Math.max(0.35, Math.min(1, App.canvasScale())) : 1;
        p.el.style.transformOrigin = '120px 36px';
        p.el.style.transform = _sc < 0.99 ? 'scale(' + _sc + ')' : 'none';
        var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        if (p.state === 'toSrc') ang += 180;
        if (typeof p._ang === 'number') {
          var d = ang - p._ang;
          while (d > 180) { ang -= 360; d = ang - p._ang; }
          while (d < -180) { ang += 360; d = ang - p._ang; }
        }
        p._ang = ang;
        var tf = 'rotate(' + ang + 'deg)';
        var svg = p.el.querySelector('svg');
        if (svg) {
          svg.style.transformOrigin = '120px 36px';
          svg.style.transition = 'transform .25s';
          svg.style.transform = tf;
        }
        var badge = p.el.querySelector('.cv-badge');
        if (badge) {
          badge.style.transformOrigin = '120px 36px';
          badge.style.transform = 'rotate(' + (-ang) + 'deg)';
        }
      }
    } catch (e) {}
    _rafId = requestAnimationFrame(tick);
  }
  function ensureLoop() { if (!_rafId) _rafId = requestAnimationFrame(tick); }

  setInterval(ensureLoop, 1000);
  (function waitRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var raw = null;
      try { raw = localStorage.getItem('zf_converge_pairs'); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if ((hasSaved && anyBox) || tries > 60) {
        if (hasSaved) restorePairs(true);
        /* 【重启后箭头消失修复】对话框 DOM 异步挂载中，首试可能 findChat 全落空只恢复一部分：
           不再立即停止，继续每秒重试，直到恢复数达到存档数或超过 120 秒 */
        /* 【v26 修复·重启后箭头再次丢失】120 秒上限不够：后台重启/大量对话恢复时
           DOM 挂载可远超 2 分钟，恢复循环提前放弃导致箭头全丢。放宽到 600 秒，
           正常情况仍按「恢复数==存档数」提前停，不会空转。 */
        /* 【v28 修复·与 thinker-arrow v27 对齐】600 秒后不再放弃：降频为每 5 秒重试一次且永不停止，
           对话框恢复晚于 10 分钟时收口大箭头也能随时恢复；「恢复数==存档数」正常停止条件保留。 */
        if (tries > 600) { if (tries % 5 !== 0) return; }
        var _total = 0, _done = 0;
        try { _total = (JSON.parse(raw) || []).length; } catch (e) { _total = 0; }
        try { _done = pairs.filter(function (p) { return p.el && p.el.isConnected; }).length; } catch (e) {}
        if (_total && _done >= _total) clearInterval(timer);
        /* 【v28 修复·弃疗口封堵】仅当存档确实为空（'[]'/'null'/无键）才停止；
           JSON 解析异常（raw 损坏/暂时读不到）时 _total 虽为 0 但不再永久弃疗，继续低频重试 */
        if (!hasSaved && _total === 0) { clearInterval(timer); }
      }
    }, 1000);
  })();

  /* 【大小箭头方向一致】审核蜂群自动编排器（verify-arrow autoLoopGather）回注/复审时，
     派发 zf-multi-gathered / zf-multi-scattered，收口总箭头（大箭头）必须同步反转方向，
     保证「每个审核员评分完成后同时返回时，大箭头与小箭头方向一致」；
     二审/三审循环同样生效。onArrowClick 自身已先翻过方向的（gatherFor 手动路径），守卫 state 防重复翻转 */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var _sid = ev.detail && ev.detail.srcId;
      pairs.forEach(function (p) {
        if (String(p.srcId) !== String(_sid)) return;
        if (p.state !== 'toGroup') return;
        p.state = 'toSrc';
        p.status = 'gathered';
        /* 【箭头一致 v4·阶段同步】审核编排器（autoLoopGather）已代为汇总回注，大箭头必须
           同步 phase='injected'，否则用户再点大箭头会按 phase==='sent' 把同样内容再回注一遍
           （重复注入），且下一轮发散判据错乱。同步后点大箭头走"分发"分支，与小箭头复审方向一致。 */
        p.phase = 'injected';
        applyStatus(p); persist();
      });
    } catch (e) {}
  });
  document.addEventListener('zf-multi-scattered', function (ev) {
    try {
      var _sid2 = ev.detail && ev.detail.srcId;
      pairs.forEach(function (p) {
        if (String(p.srcId) !== String(_sid2)) return;
        if (p.state !== 'toSrc') return;
        p.state = 'toGroup';
        p.status = 'discussing';
        /* 【箭头一致 v4·阶段同步】复审齐步分发后 phase 同步回 'sent'，并把成员计数基线
           刷成当前值，等待下一轮全员新回复后收口判据才正确（否则旧基线残留会立刻误判就绪）。 */
        p.phase = 'sent';
        var _src2 = findChat(p.srcId);
        (p.memberIds || []).forEach(function (mid) {
          var m = findChat(mid);
          if (!m) return;
          /* 【v5·去竞态】成员已超出旧基线（回复完成但收口未发生）→ 不重写基线，
             保留差值使 577/783 行就绪判定立即成立；否则新基线==当前count，差值判据恒false卡死（第3轮审核指认）。
             未回复（count<=旧基线或无基线）才刷基线，等待本轮新回复 */
          var _old = p.memberCounts ? p.memberCounts[mid] : null;
          if (_old != null && assistantCount(m) > _old) return;
          p.memberCounts[mid] = assistantCount(m);
        });
        p._sentAt = Date.now();
        p._ready = false;
        applyStatus(p); persist();
      });
    } catch (e) {}
  });

  window.ZFConvergeArrow = { create: create, pairs: pairs, getPairs: function () { var out = []; try { for (var k in convergeArrows) { var p = convergeArrows[k]; if (p && p.srcId != null) out.push({ srcId: String(p.srcId), tkId: String(k) }); } } catch (e) {} return out; } };
  /* 【v9 供审核员/验证师自动回收调用】按源对话触发一次收口汇总（等价于用户点击最高的收口箭头）：
     找到该源对话下 phase==='sent' 且已就绪的收口箭头，直接执行 onArrowClick 一次，全员结论汇总成一条回注 */
  window.ZFConvergeArrow.gatherFor = function (srcId, opts) {
    try {
      srcId = String(srcId);
      /* 【v25 严格判定】本函数自带全员就绪门槛（非仅位置判断）：
         每位成员必须 ①计数基线存在 ②未在流式 ③回复数超基线，任一不满足即继续等，绝不提前收口；
         基线缺失（persist 恢复/流式漂移）一律判未就绪，不兜底放行。
         就绪后取该源对话下"最后一个"就绪的收口箭头（数组末尾=最新创建），直接触发回注。 */
      var target = null;
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i];
        if (String(p.srcId) !== srcId) continue;
        /* 【派发登记门槛·v3 修复收口死锁】旧逻辑两处死锁：①canGather 依赖 markReturned，
           而 markReturned 只在点击收口时写，自动路径先查 canGather → 永远放行不了（鸡生蛋）；
           ②p.memberIds 建箭头时固定，账本并集不回写 pair，错峰时恒 memberIds<expected → 永久跳帧。
           v3 顺序改为：等全开出 → 账本扩容 pair → 逐成员判定回复完成即记账 → 再查收口门槛 */
        try {
          var L = window.ZFDispatchLedger;
          if (L && typeof L.autoCloseMissing === 'function') { L.autoCloseMissing(srcId, findChat); }
          /* 【v8 全局账本·无登记自建】多角色组同源（审核组+策划组各建各的 pair）时，任意一组的
             gatherFor 先到而全局账本还没建 → 按当前全部收口 pair 的成员并集自建账，绝不无账放行：
             「审核组先完成」时若放行，总箭头就提前收回——这正是要根治的症状 */
          var _rec = null;
          try { _rec = JSON.parse(localStorage.getItem('zf_dispatch_ledger') || '{}')[srcId] || null; } catch (eR) { _rec = null; }
          if (L && !_rec) {
            var _union = [];
            var _us = {};
            for (var pi = 0; pi < pairs.length; pi++) {
              var pp = pairs[pi];
              if (String(pp.srcId) !== srcId || !pp.memberIds) continue;
              pp.memberIds.forEach(function (id) { var s = String(id); if (!_us[s]) { _us[s] = 1; _union.push(s); } });
            }
            if (_union.length) {
              L.register(srcId, _union);
              _rec = { expected: _union.length, memberIds: _union };
            }
          }
          if (_rec && L) {
            /* ①错峰未全开出（outstanding>0）→ 本帧跳过等全部开出；无登记（-1）放行走旧逻辑 */
            if (typeof L.outstanding === 'function' && L.outstanding(srcId, findChat) > 0) continue;
            /* ②账本扩容：后开出的专家窗已并入账本 memberIds，但箭头 pair 建得更早未含 → 补进 pair 并记基线 */
            (_rec.memberIds || []).forEach(function (id) {
              var sid = String(id);
              if (p.memberIds.indexOf(sid) === -1) {
                var chN = findChat(sid);
                if (chN && chN.el) {
                  p.memberIds.push(sid);
                  if (!p.memberCounts) p.memberCounts = {};
                  p.memberCounts[sid] = assistantCount(chN);
                  /* 【v11·判据统一】补入窗必须「确有本轮新回复」才记账：assistantCount > 基线。
                     基线=补入瞬间 count，故补入瞬间绝不记账（0>0 恒false）；只有补入后模型
                     新回复一条（count 上升）才记。绝不退回 count>=1 弱判据——带开场白的窗
                     一开出即满足，这正是审核员提前归队的根因（v10 遗留，反驳师实查 L848）。 */
                  try { if (window.ZFDispatchLedger && ZFDispatchLedger.markReturned && !chN.isSending && assistantCount(chN) > p.memberCounts[sid] && !lastAssistantIsError(chN)) ZFDispatchLedger.markReturned(srcId, sid); } catch (eMR) {}
                }
              }
            });
            /* ③回复即记账（v4·无基线依赖）：专家窗为派出后新建（expert-team.js 只注入 user 素材包,
                无预置 assistant 消息，count 从 0 起），故「非流式且 count≥1」即模型已回复完成。
                不再用 p.memberCounts 差值比较——706 行复审分发会重写基线，差值判据在基线重写
                与回复完成竞态时会产生「过早记账/过晚卡死」双向漏洞，基线依赖从根上移除。
                【v8 全局记账】遍历账本登记的全成员（跨审核组/策划组），任一组回复完成都进账，
                否则「审核组先完成」时账本只收到本组员 → canGather 用并集计数仍不齐 → 等齐才收口 ✓；
                反之旧代码只记本组 → 本组齐了但账本 expected 是全量 → 卡死。记账以账本并集为准 */
            var _allIds = (_rec.memberIds || []).slice();
            (p.memberIds || []).forEach(function (id) { var s = String(id); if (_allIds.indexOf(s) === -1) _allIds.push(s); });
            var _ms = _allIds.map(findChat).filter(function (c) { return c && c.el; });
            _ms.forEach(function (m) {
              if (L.markReturned) {
                /* 【v14 完成信号事实化·P2+P1 兼容修正】记账判据二选一：
                   ①流式落定：count>基线（确有本轮新回复）且非流式非报错（原 v11 判据）；
                   ②done 事件预记账：角色模块上报 zf:crew-member-done 时已 markReturned 入账
                     （幂等，重复核销无害），此处不撤销——事件只加速不作唯一通道，账本仍是真相源。
                   【反驳师①采纳·宽限期兼容】不做"实时统计存活窗口"：窗瞬时消失≠完成，
                   宽限期（GRACE_MS）语义原样保留，本判据只增不减，绝不复活手动发送误核销 bug。 */
                    /* 【v15 修复·总箭头不让回收】错误回复（lastAssistantIsError=true，如「本次对话不存在」）
                       永远无法通过记账门槛：错误窗的回复计数不再增长、用户重发也可能重复报错 →
                       canGather 恒 false → 总箭头永久卡死不能回收。
                       修复：流式已落定（!isSending）且 base 有效时，错误回复也按「本轮已完成」入账
                       （count>基线 或 count==基线且已报错兜底），错误内容照常带回原对话让主模型自行处理。
                       门槛防提前收口的本意不受影响——真在流式中的窗 isSending=true 依然被挡。 */
                    var _c = assistantCount(m);
                    var _err = lastAssistantIsError(m);
                    var _ok = (_b != null) && ((_c > _b) || (_c === _b && _err));
                    if (!m.isSending && _ok) L.markReturned(srcId, m.id);
              }
            });
            if (typeof L.canGather === 'function' && !L.canGather(srcId)) continue;
          }
        } catch (eL) {}
        if (p.phase !== 'sent' || !p.el || !p.el.isConnected) continue;
        var members = p.memberIds.map(findChat).filter(function (c) { return c && c.el; });
        if (!members.length) continue;
        /* 【修复·isSending 防误判】任一成员仍在发送/流式中 → 不就绪，绝不提前收口（宁可下一帧再试） */
        var _busy = false;
        members.forEach(function (m) { if (m.isSending) _busy = true; });
        if (_busy) continue;
        /* 【修复·混合角色防提前回收】派单 3 秒保护窗内不收口（错峰 500ms 派出 + 模型首包延迟） */
        if (p._sentAt && (Date.now() - p._sentAt) < 3000) continue;
        /* 【严格判定·无兜底】基线缺失（persist 恢复/流式漂移）一律视为"未就绪"继续等，
           绝不允许"基线缺失→仅查 isSending"的兜底——那会放过尚未回复完成的成员导致中途返回。
           严格门槛：每位成员都满足 ①基线存在 ②未在流式 ③回复数超过基线（确有新回复） */
        var _allReplied = true;
        members.forEach(function (m) {
          var base = p.memberCounts ? p.memberCounts[m.id] : null;
          if (base == null) { _allReplied = false; return; }
          if (m.isSending) { _allReplied = false; return; }
          /* 【v15】错误回复（流式已落定且不再增长）也算本轮完成，照常收口带回原对话 */
          if (assistantCount(m) <= base && !lastAssistantIsError(m)) _allReplied = false;
        });
        if (!_allReplied) continue;
        target = p; /* 不 break：遍历到底，取最后一个匹配的 */
      }
      if (!target) return false;
      onArrowClick(target, true);
      return true;
    } catch (e) {}
    return false;
  };
  /* ============================================================
   * 【v14 统一收口编排·事件通道 + 死锁兜底】
   * ①事件通道：角色模块上报 zf:crew-member-done（只加速不作唯一通道）→
   *   markReturned 幂等入账 + 尝试 gatherFor（canGather 未齐时自动跳过）。
   * ②按用户 2026-10-31 明确要求：不设任何超时兜底——收口只由账本 canGather 裁决，
   *   宁可等齐也不强制回收，杜绝误收口（永远不需要兜底）。
   * ============================================================ */
  document.addEventListener('zf:crew-member-done', function (ev) {
    try {
      var d = (ev && ev.detail) || {};
      var L = window.ZFDispatchLedger;
      var sid = d.srcId;
      if (!sid) return;
      _crewDoneSeen[sid] = Date.now(); // 记录最近活动时间，总超时用
      if (d.memberId && L && typeof L.markReturned === 'function') L.markReturned(sid, d.memberId);
      /* 已有总箭头且全员齐 → 立即收口（gatherFor 内部有 canGather 严格门槛，未齐自动 no-op） */
      if (typeof window.ZFConvergeArrow.gatherFor === 'function') {
        try { window.ZFConvergeArrow.gatherFor(sid); } catch (eG) {}
      }
    } catch (eE) {}
  }, false);
  var _crewDoneSeen = {}; // srcId → 最近 done 事件/活动时间（保留字段，无超时消费方）
  // 按用户要求：不设超时兜底，收口唯一判据 = 账本 canGather（全员事实完成）
  // [converge-arrow] 多角色橙金箭头模块已加载
})();

