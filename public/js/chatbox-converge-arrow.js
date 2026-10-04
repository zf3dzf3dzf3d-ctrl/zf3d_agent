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
        else if ((b.el._isThinkerChat && String(b.el._thinkerSrcId) === String(srcId)) || (b.el._isQcChat && String(b.el._qcSrcId) === String(srcId))) out.push(b);
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
        var isT = b.el._isThinkerChat, isQ = b.el._isQcChat;
        if (!isT && !isQ) continue;
        var srcId = isT ? b.el._thinkerSrcId : b.el._qcSrcId;
        if (!srcId) continue;
        /* 【v27 修复·异角色混入】按本窗角色取同角色成员，残留异角色窗不再混入收口箭头 */
        var _role = isT ? 'thinker' : 'qc';
        /* 【混角色保护】同 srcId 下同时有策划窗+审核窗时取最大计数，避免后遍历角色覆盖前者 */
        var _cnt = window.ZFSwarm.membersOf(srcId, _role).length;
        seen[srcId] = Math.max(seen[srcId] || 0, _cnt);
        var members = window.ZFSwarm.membersOf(srcId, _role);
        if (members.length >= 2 && !convergeArrows[srcId]) {
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
      // 清理失效箭头
      for (var k in convergeArrows) {
        if (!seen[k] || seen[k] < 2 || !convergeArrows[k] || !convergeArrows[k].el || !convergeArrows[k].el.isConnected) { try { if (convergeArrows[k] && convergeArrows[k].el) convergeArrows[k].el.remove(); } catch (eC) {} delete convergeArrows[k]; }
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
      if (c && c.id === id && c.el && c.el.isConnected) return c;
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
        return { srcId: p.srcId, memberIds: p.memberIds, groupName: p.groupName, state: p.state, status: p.status, rounds: p.rounds || 0, _autoTicket: p._autoTicket || 0 };
      })));
    } catch (e) {}
  }
  function restorePairs() {
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
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:5000;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 0 8px rgba(77,208,225,.9));user-select:none;transition:transform .25s;';
    el.innerHTML =
      '<svg width="240" height="72" viewBox="0 0 240 72" xmlns="' + SVG_NS + '" style="overflow:visible">' +
      '<line class="cv-line" x1="6" y1="36" x2="168" y2="36" stroke="' + GOLD + '" stroke-width="11" stroke-linecap="round" stroke-dasharray="14 10"/>' +
      '<polygon class="cv-head" points="162,4 236,36 162,68" fill="' + GOLD + '" stroke="#ffffff" stroke-width="3"/>' +
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
      memberCounts: {},
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
    pairs.push(pair);
    applyStatus(pair);
    persist();

    el.addEventListener('click', function (ev) { ev.stopPropagation(); onArrowClick(pair); });
    return pair;
  }

  /* ---------- 点击：回收汇总 / 再分发 ---------- */
  function onArrowClick(pair) {
    var src = findChat(pair.srcId);
    if (!src) { if (pair.el) pair.el.remove(); return; }
    var members = pair.memberIds.map(findChat).filter(function (c) { return c && c.el; });
    if (!members.length) { toast('角色对话已全部关闭，箭头失效', false); pair.status = 'failed'; applyStatus(pair); return; }

    if (pair.phase === 'sent') {
      /* 回收：收集全部成员最新回复 → 汇总回注原对话 */
      var lines = [];
      members.forEach(function (m) {
        var ans = lastAnswer(m).slice(0, 2000);
        var name = (m.el && (m.el._swarmLabel || (m.el.querySelector('.title') && m.el.querySelector('.title').textContent) || '子窗'));
        if (ans) lines.push('▶ ' + name + '：\n' + ans.trim());
        /* 用户在子窗输入框手动输入、尚未发送的补充，随收口一起追加回注 */
        var draft = draftOf(m);
        if (draft) {
          lines.push('✎ ' + name + '（用户手动补充，未发送）：\n' + draft);
          try { m.el.querySelector('textarea').value = ''; } catch (eD) {}
          try { toast('「' + name + '」输入框草稿已带草稿回注', true); } catch (eT) {}
        }
        /* 【输入防丢·箭头输入框】该成员单体箭头（审核紫/策划箭头）输入框里的补充文字也一并带回 */
        try {
          var arrowNote = (window.ZFVerifyArrow && typeof ZFVerifyArrow.takeNoteFor === 'function' && ZFVerifyArrow.takeNoteFor(m.id)) ||
                          (window.ZFThinkerArrow && typeof ZFThinkerArrow.takeNoteFor === 'function' && ZFThinkerArrow.takeNoteFor(m.id)) || '';
          if (arrowNote) {
            lines.push('✎ ' + name + '（用户在箭头输入框补充的新要求）：\n' + arrowNote.replace(/^\s*\n\n【[^】]*】\n/, '').trim());
            try { toast('「' + name + '」箭头输入框补充已带回', true); } catch (eA) {}
          }
        } catch (eAN) {}
      });
      if (!lines.length) { toast('角色们还没有回复，无法汇总', false); return; }
      var msg = '这是「' + pair.groupName + '」多视角蜂群的收口汇总（第' + (pair.rounds + 1) + '轮），包含多个审核员/策划师窗的独立视角结论。请逐条对比各方观点，明确说明采纳哪些、不采纳哪些及理由，然后继续推进任务，不要重复向用户追问已确认信息：\n\n' + lines.join('\n\n');
      sendTo(src, msg);
      pair.rounds++;
      pair.phase = 'injected';
      pair.state = 'toSrc';
      pair.status = 'gathered';
      applyStatus(pair); persist();
      try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: pair.srcId } })); } catch (eE) {}
      toast('已汇总 ' + lines.length + ' 个角色观点回注原对话', true);
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
      try { document.dispatchEvent(new CustomEvent('zf-multi-scattered', { detail: { srcId: pair.srcId } })); } catch (eE) {}
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
            if (assistantCount(m) <= (p.memberCounts[m.id] || 0)) all = false;
          });
          if (all && p._sentAt && (Date.now() - p._sentAt) > 3000) {
            p.status = 'discussing';
            var bt = p.el.querySelector('.cv-badge-text');
            /* 【自动回收 v4】创建时认领的票据（60 秒有效）：只作用于本 pair，全局标志不再跨 pair 生效 */
            var _ag = !!(p._autoTicket && (Date.now() - p._autoTicket) < 60000);
            if (bt) bt.textContent = _ag ? '自动回收中…' : '已就绪·点回收';
            p._ready = true;
            if (_ag && !p._autoTimer && !(p._gatherUsedAt && p._gatherUsedAt === p._autoTicket)) {
              p._gatherUsedAt = p._autoTicket;
              p._autoTimer = setTimeout(function () {
                p._autoTimer = null;
                if (p._ready && p.phase === 'sent' && p.el && p.el.isConnected) onArrowClick(p);
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
        clearInterval(timer);
        if (hasSaved) restorePairs();
      }
    }, 1000);
  })();

  window.ZFConvergeArrow = { create: create, pairs: pairs, getPairs: function () { var out = []; try { for (var k in convergeArrows) { var p = convergeArrows[k]; if (p && p.srcId != null) out.push({ srcId: String(p.srcId), tkId: String(k) }); } } catch (e) {} return out; } };
  /* 【v9 供审核员/验证师自动回收调用】按源对话触发一次收口汇总（等价于用户点击最高的收口箭头）：
     找到该源对话下 phase==='sent' 且已就绪的收口箭头，直接执行 onArrowClick 一次，全员结论汇总成一条回注 */
  window.ZFConvergeArrow.gatherFor = function (srcId, opts) {
    try {
      srcId = String(srcId);
      /* 【v11 简化·按用户方案】不再用 memberCounts 判"全员/部分已回复"——计数基线会因
         persist 恢复/流式空包漂移，恒判不全导致 gatherFor 恒 false、回收卡死。
         回收时机已由调用方（verify-arrow tryGroupAutoGather 的 pending===0 全员 _replied 门槛）保证，
         这里只做位置判断：取该源对话下"最后一个"就绪的收口箭头（数组末尾=最新创建），直接触发回注。 */
      var target = null;
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i];
        if (String(p.srcId) !== srcId) continue;
        if (p.phase !== 'sent' || !p.el || !p.el.isConnected) continue;
        var members = p.memberIds.map(findChat).filter(function (c) { return c && c.el; });
        if (!members.length) continue;
        /* 【修复·isSending 防误判】任一成员仍在发送/流式中 → 不就绪，绝不提前收口（宁可下一帧再试） */
        var _busy = false;
        members.forEach(function (m) { if (m.isSending) _busy = true; });
        if (_busy) continue;
        target = p; /* 不 break：遍历到底，取最后一个匹配的 */
      }
      if (!target) return false;
      onArrowClick(target);
      return true;
    } catch (e) {}
    return false;
  };
  // [converge-arrow] 多角色橙金箭头模块已加载
})();

