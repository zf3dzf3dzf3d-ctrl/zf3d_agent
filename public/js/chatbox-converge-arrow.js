/* ==========================================================================
 * chatbox-converge-arrow.js — 多角色探讨 1:N 橙金总箭头
 * 原对话 ? 角色分组(N个子对话)：点击=回收汇总回注 / 再次点击=再分发，无限往复
 * ========================================================================== */
(function () {
  'use strict';
  if (window.ZFConvergeArrow) return;

  /* 【S1重构】收口箭头成员门槛统一常量（此前魔法数字散落5处，2→1修复曾漏改风险）。
     ≥1：单成员（如只派一个推进师）也保留收口箭头。
     注意：L236 混合箭头 _kindN>=2 是"角色种类数"门槛，语义不同，勿用此常量 */
  var MIN_CONVERGE_MEMBERS = 1;

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
    /* 【v7.6.1 charlie】按 boxId 查注册表条目（哨兵重建协作窗时迁移旧条目到新 id 用） */
    recordOf: function (boxId) { try { return regLoad()[String(boxId)] || null; } catch (e) { return null; } },
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
        /* 【专注模式守卫】host 进舞台的窗 offsetLeft/offsetTop 是舞台基准(0,0)而非画布坐标，
           接力排布按"前窗位置+46"计算，会把新成员摆到画布左上角——退出专注后该子窗
           相对父窗/兄弟窗整体偏离（又一处父子偏离来源）。专注期间跳过排布；
           退出后成员数变化时 tick 会自然补排（新窗槽位未固化，仍会排）。 */
        if (document.body.classList.contains('zf-focus')) return;
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
        /* 【用户拖拽保护】只给本轮新分配槽位的窗定位；已固化槽位的窗（含被用户
           手动拖过的）不再重复排位。原实现每次触发（箭头重建/成员数变化补排）
           都按"前窗位置+STEP"把全部成员重排一遍，会覆盖用户拖后的位置——
           表现为「派出去的团队对话框，拖完过一会位置自己变回去」。 */
        var _newlyPlaced = {};
        var _newSeq = 0;
        members.forEach(function (m) {
          var id = String(m.id);
          if (typeof slots[key][id] !== 'number') {
            slots[key][id] = maxSlot + 1 + (_newSeq++);
            _newlyPlaced[id] = true;
          }
        });
        self._slotsSave(slots);
        members.forEach(function (m, i) {
          var id = String(m.id);
          if (!_newlyPlaced[id]) return; /* 旧窗不重排，尊重用户拖放位置 */
          var slot = slots[key][id];
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
        if (members.length >= MIN_CONVERGE_MEMBERS && _kindN < 2 && !convergeArrows[srcId] && !convergeArrows[_mixedKey]) {
          var src = null;
          for (var j = 0; j < boxes.length; j++) if (boxes[j].id === srcId) { src = boxes[j]; break; }
          if (src && src.el) {
            convergeArrows[srcId] = ZFConvergeArrow.create(src, members, '蜂群收口');
            /* 【箭头锚点排布】全部子窗出现后，以箭头位置为锚统一阶梯排开，避免叠在一起 */
            try { setTimeout(function () { try { window.ZFSwarm.ladderArrange(srcId, _role); } catch (eL2) {} }, 60); } catch (eL) {}
          }
        }
        /* 【分批补排】子窗分批陆续出现时，成员数变化即补排一次，防后到窗与已排窗重叠 */
        if (members.length >= MIN_CONVERGE_MEMBERS && seen[srcId] !== _lastMemberCount[srcId]) {
          _lastMemberCount[srcId] = seen[srcId];
          try { setTimeout(function () { try { window.ZFSwarm.ladderArrange(srcId, _role); } catch (eL3) {} }, 120); } catch (eL4) {}
        }
      }
      // 清理失效箭头（【混合团队】key 为 'mixed:srcId' 的按 union 成员数判断，且需 ≥2 种角色）
      for (var k in convergeArrows) {
        var _keep = false;
        if (seen[k] && seen[k] >= MIN_CONVERGE_MEMBERS && convergeArrows[k] && convergeArrows[k].el && convergeArrows[k].el.isConnected) _keep = true;
        if (k.indexOf('mixed:') === 0) {
          var _mk = k.slice(6);
          var _mm = window.ZFSwarm.membersOf(_mk, 'mixed');
          if (_mm.length >= MIN_CONVERGE_MEMBERS && convergeArrows[k] && convergeArrows[k].el && convergeArrows[k].el.isConnected) _keep = true;
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


  /* ============================================================
   * 蜂群收口箭头本体（v2 薄壳·内核版）
   * 渲染/定位/rAF循环/z-index/悬停/恢复 全部委托 zf-arrow-core.js
   * 本壳只保留业务：账本门槛收口 / 防半截 / 缺员兜底 / 草稿带回 / 错误占位判定
   * ============================================================ */
  var GOLD = '#4dd0e1';
  var GOLD_DARK = '#26c6da';
  var KEY = 'zf_converge_pairs';

  var STATUS = {
    discussing: { color: GOLD, text: '讨论中', flow: true },
    gathered:   { color: '#00e676', text: '已汇总', flow: false },
    failed:     { color: '#9e9e9e', text: '已失效', flow: false }
  };

  function findChat(id) {
    /* 【v7.6 charlie】先过 id 迁移映射：v7.5 哨兵重建协作窗换新 id 后，箭头存档旧 id 自动换算 */
    try { if (window.ZFArrow && ZFArrow.resolveId) id = ZFArrow.resolveId(id); } catch (e) {}
    var boxes = (window.App && App.chatBoxes) || [];
    for (var i = 0; i < boxes.length; i++) {
      var c = boxes[i];
      if (c && String(c.id) === String(id) && c.el && c.el.isConnected) return c;
    }
    return null;
  }
  function toast(msg, ok) {
    try { if (App._stepToast) App._stepToast(msg, ok !== false); } catch (e) {}
  }
  function messagesOf(chat) {
    try { if (Array.isArray(chat.messages) && chat.messages.length) return chat.messages; } catch (e) {}
    try { if (Array.isArray(chat.history)) return chat.history; } catch (e) {}
    return [];
  }
  /* 【W1·报错占位不算已回复】 */
  function lastAssistantIsError(chat) {
    try {
      var ms = messagesOf(chat);
      for (var i = ms.length - 1; i >= 0; i--) {
        if (ms[i] && ms[i].role === 'assistant') {
          var t = String(ms[i].content || ms[i].text || '');
          if (/（网络错误，发送失败|⚠️\s*请求失败|请求超时|模型未配置|发送失败）/.test(t)) return true;
          var head = t.slice(0, 60);
          if (/^\s*(❌|⚠|⚠️|💰|⛔)/.test(t)) return true;
          if (/调用失败：|失败原因：|仍失败|无法完成/.test(head)) return true;
          return false;
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
    try {
      var input = chat.el && chat.el.querySelector('textarea');
      var v = input ? String(input.value || '').trim() : '';
      return v.slice(0, 1000);
    } catch (e) { return ''; }
  }
  function sendTo(chat, text) {
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
  function membersOf(p) {
    return (p.memberIds || []).map(findChat).filter(function (c) { return c && c.el; });
  }
  /* 内核 getDst 钩子：终点 = 全体成员质心 */
  function centroidOf(p) {
    var members = membersOf(p);
    if (!members.length) return null;
    var ax = 0, ay = 0;
    members.forEach(function (m) { var c = centerOf(m); ax += c.x; ay += c.y; });
    return { x: ax / members.length, y: ay / members.length };
  }
  /* 徽标文案钩子 */
  function labelOf(p, st) {
    if (p.status === 'discussing' && p._ready) return '已就绪·点回收' + (p.rounds > 0 ? ' · 第' + p.rounds + '轮' : '');
    return st.text + (p.rounds > 0 ? ' · 第' + p.rounds + '轮' : '');
  }
  function getTitleOf(p, st) {
    return '【' + (p.groupName || '多角色') + '·收口】' + st.text + '（第' + (p.rounds || 0) + '轮）（点击：' + (p.phase === 'sent' ? '收口汇总回注原对话' : '再分发给角色组') + '）';
  }

  /* ---------- 持久化 ---------- */
  function persist() {
    try {
      var _mem = window.ZFArrow.all().filter(function (p) { return p.kind === 'converge'; }).map(function (p) {
        return { srcId: p.srcId, memberIds: p.memberIds, groupName: p.groupName, state: p.state, status: p.status, rounds: p.rounds || 0, _autoTicket: p._autoTicket || 0, memberCounts: p.memberCounts || {}, _sentAt: p._sentAt || 0, collabTeam: p.collabTeam || '' };
      });
      /* 【v7.2.3 宽限合并·charlie】restore 保留的 _missAt 宽限条目不在内存实例里（对端框尚未恢复），
         persist 直接覆写会把它们洗掉 → 重启慢恢复场景箭头被永久误删（v7.2.2 只给 verify 壳补了合并，此处补齐）。写盘前先合并回来。 */
      try {
        var _prev = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (Array.isArray(_prev)) {
          var _exist = {};
          _mem.forEach(function (x) { _exist[String(x.srcId) + '|' + (x.memberIds || []).join(',')] = 1; });
          _prev.forEach(function (d) {
            if (d && d._missAt && !_exist[String(d.srcId) + '|' + (d.memberIds || []).join(',')]) _mem.push(d);
          });
        }
      } catch (eM) {}
      localStorage.setItem(KEY, JSON.stringify(_mem));
    } catch (e) {}
  }

  /* 【S1重构·消重复】成员收集三段（名字提取/最新回复/草稿带回）在主收集块与v12缺员兜底块原为两份拷贝，
     收敛为单函数 _collectMemberLine；返回该成员贡献的行数组。零行为变更：兜底块原本不含
     箭头输入框补充逻辑，该段仍保留在主收集块独有部分（见 onArrowClick gather 分支）。 */
  function _collectMemberLine(ch, srcId, lines) {
    var name = (ch.el && (ch.el._swarmLabel || (ch.el.querySelector('.title') && ch.el.querySelector('.title').textContent) || '子窗'));
    var ans = lastAnswer(ch).slice(0, 2000);
    try { if (window.ZFDispatchLedger && ZFDispatchLedger.markReturned) ZFDispatchLedger.markReturned(srcId, ch.id); } catch (eMR) {}
    if (ans) lines.push('▶ ' + name + '：\n' + ans.trim());
    var draft = draftOf(ch);
    if (draft) {
      lines.push('✎ ' + name + '（用户手动补充，未发送）：\n' + _clipNote(draft, 2000));
    }
  }
  function _clipNote(t, max) { t = String(t == null ? '' : t).trim(); return t.length > max ? t.slice(0, max) + '…（超长已截断）' : t; }

  /* ---------- 点击：收口汇总 / 再分发（业务原样保留） ---------- */
  function onArrowClick(pair, fromAuto) {
    var src = findChat(pair.srcId);
    if (!src) { ZFArrow.remove(pair); return false; }
    var members = membersOf(pair);
    if (!members.length) { toast('角色对话已全部关闭，箭头失效', false); pair.status = 'failed'; ZFArrow.applyStatus(pair); return false; }

    /* 【v4.1 协作组收口】带 collabTeam 标记的箭头走服务器 done 账本（collect 接口），不走本地消息收集 */
    if (pair.collabTeam) return _doCollabGather(pair, members, src, fromAuto);

    if (pair.phase === 'sent') {
      /* 【防半截·v2】任一成员仍在流式生成 → 不能收口 */
      var _busyGather = false;
      try { members.forEach(function (m) { if (m.isSending) _busyGather = true; }); } catch (eBG) {}
      if (_busyGather) {
        if (!fromAuto) toast('还有角色正在回复，等全员结束后再收口', false);
        return false;
      }
      /* 【v8 全局账本·手动收口同门槛】 */
      try {
        var L8 = window.ZFDispatchLedger;
        if (L8 && typeof L8.autoCloseMissing === 'function') L8.autoCloseMissing(pair.srcId, findChat);
        if (L8 && typeof L8.canGather === 'function' && !L8.canGather(pair.srcId)) {
          var _ids = (pair.memberIds || []);
          _ids.forEach(function (m2) {
            var c2 = findChat(m2);
            var _base = pair.memberCounts ? pair.memberCounts[m2] : null;
            var _cnt = assistantCount(c2);
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
    }
    /* S2重构：gather/scatter 拆为 _doGather/_doScatter，本函数只做前置守卫与派发，零行为变更 */
    if (pair.phase === 'sent') return _doGather(pair, members, src, fromAuto);
    return _doScatter(pair, members, src);
  }

  /* 【v18·缺员可见化补丁】派发登记的 memberIds 里没被收集到的成员，补一条可见占位，
     防止"窗已关/重开消息不在内存"的成员被静默丢弃，主对话误以为全员已审阅。
     依据：_collectMemberLine 与 v12 兜底对 findChat 失败/lastAnswer 为空均静默跳过（2026-11-19 五窗丢四人事故根因）。 */
  function _patchMissingMemberPlaceholders(pair, lines) {
    try {
      var _text = lines.join('\n');
      /* 【v18.1】待检成员 = 派发登记 memberIds ∪ localStorage 账本 memberIds：
         v12 兜底可从账本额外捞回成员，占位集合若只看 pair.memberIds 仍会漏账本独有成员（审核员2026-11-19复核指出的边缘缺口）。 */
      var _ids = {};
      (pair.memberIds || []).forEach(function (id) { _ids[String(id)] = 1; });
      try {
        var _recP = JSON.parse(localStorage.getItem('zf_dispatch_ledger') || '{}')[String(pair.srcId)] || null;
        (_recP && _recP.memberIds || []).forEach(function (id) { _ids[String(id)] = 1; });
      } catch (eLP) {}
      Object.keys(_ids).forEach(function (sid) {
        if (_text.indexOf('id=' + sid + '：') >= 0) return;
        var chX = findChat(sid);
        if (chX && lastAnswer(chX)) return;
        lines.push('▶ 成员（id=' + sid + '）：⚠️ 未收集到本轮回复（窗口已关闭或消息不在内存）。该成员结论缺失，请主对话按调查黑板落盘记录自查（project_record search 任务关键词），勿将其视为已审阅。');
        if (!pair._missingIds) pair._missingIds = [];
        if (pair._missingIds.indexOf(sid) < 0) pair._missingIds.push(sid);
      });
      if (pair._missingIds && pair._missingIds.length) {
        try { toast('⚠️ ' + pair._missingIds.length + ' 个成员窗已关闭/未加载，结论未能带回，已以占位标注', false); } catch (eT2) {}
      }
    } catch (ePM) {}
  }

  /* S2重构：回收——账本校验 + 成员结论收集 + 汇总回注（原 onArrowClick gather 分支原样搬移） */
  function _doGather(pair, members, src, fromAuto) {
    if (pair.phase !== 'sent') return _doScatter(pair, members, src);
    if (pair.phase === 'sent') {
      /* 回收：收集全部成员最新回复 → 汇总回注（S1重构：收集逻辑收敛到 _collectMemberLine） */
      var lines = [];
      members.forEach(function (m) {
        _collectMemberLine(m, pair.srcId, lines);
        if (m.el) { try { m.el.querySelector('textarea').value = ''; } catch (eD) {}
          var draft2 = draftOf(m);
          if (draft2) { try { toast('「' + (m.el._swarmLabel || '子窗') + '」输入框草稿已带草稿回注', true); } catch (eT) {} }
        }
        /* 【输入防丢】单体箭头输入框补充一并带回 */
        try {
          var arrowNote = (window.ZFVerifyArrow && typeof ZFVerifyArrow.takeNoteFor === 'function' && ZFVerifyArrow.takeNoteFor(m.id)) ||
                          (window.ZFThinkerArrow && typeof ZFThinkerArrow.takeNoteFor === 'function' && ZFThinkerArrow.takeNoteFor(m.id)) || '';
          if (arrowNote) {
            var nameM = (m.el && (m.el._swarmLabel || (m.el.querySelector('.title') && m.el.querySelector('.title').textContent) || '子窗'));
            lines.push('✎ ' + nameM + '（用户在箭头输入框补充的新要求）：\n' + _clipNote(arrowNote.replace(/^\s*\n\n【[^】]*】\n/, ''), 2000));
            try { toast('「' + nameM + '」箭头输入框补充已带回', true); } catch (eA) {}
          }
        } catch (eAN) {}
      });
      /* 【v12·缺员兜底】账本登记但本 pair 未含的成员结论一并带回 */
      try {
        var _recG = JSON.parse(localStorage.getItem('zf_dispatch_ledger') || '{}')[String(pair.srcId)] || null;
        if (_recG && (_recG.memberIds || []).length) {
          var _have = {};
          pair.memberIds.forEach(function (id) { _have[String(id)] = 1; });
          (_recG.memberIds || []).forEach(function (id) {
            var sid = String(id);
            if (_have[sid]) return;
            var chX = findChat(sid);
            if (!chX || !chX.el) return;
            _have[sid] = 1;
            _collectMemberLine(chX, pair.srcId, lines);
          });
        }
      } catch (eLU) {}
      /* 【v18】缺员占位：登记成员未收集到的补可见标注（防静默丢人） */
      _patchMissingMemberPlaceholders(pair, lines);
      if (!lines.length) {
        if (!fromAuto) toast('角色们还没有回复，无法汇总', false);
        return false;
      }
      var msg = '这是「' + pair.groupName + '」多视角蜂群的收口汇总（第' + (pair.rounds + 1) + '轮），包含多个审核员/策划师窗的独立视角结论。请逐条对比各方观点，明确说明采纳哪些、不采纳哪些及理由，然后继续推进任务，不要重复向用户追问已确认信息。汇总格式要求：①每位成员的结论段只保留一行索引式摘要（角色+一句话核心结论+落盘记录名），不要复述全文；②若策划师窗本轮产出只是复述既有策划案而未吸收其他成员的反驳意见做出修订，须明确指出其无增量；③对多位成员重复提到的同一问题，合并为一条并注明共同来源：\n\n' + lines.join('\n\n');
      sendTo(src, msg);
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.finish) ZFDispatchLedger.finish(pair.srcId); } catch (eLF) {}
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.setArrow) ZFDispatchLedger.setArrow(pair.srcId, 'up'); } catch (eLA) {}
      pair.rounds++;
      pair.phase = 'injected';
      pair.state = 'toSrc';
      pair.status = 'gathered';
      ZFArrow.applyStatus(pair); persist();
      try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: pair.srcId, manual: !fromAuto } })); } catch (eE) {}
      toast('已汇总 ' + lines.length + ' 个角色观点回注原对话', true);
      return true;
    }
  }

  /* S2重构：发散——把原对话最新回复再分发给每个角色（原 onArrowClick scatter 分支原样搬移） */
  function _doScatter(pair, members, src) {
      /* 发散：把原对话最新回复再分发给每个角色 */
      var srcAns = lastAnswer(src);
      if (!srcAns) { toast('原对话还没有新内容可分发', false); return false; }
      members.forEach(function (m) {
        sendTo(m, '【原对话最新进展 · 第' + (pair.rounds + 1) + '轮】\n' + srcAns.slice(0, 6000) + '\n\n请以你的角色视角，针对上述进展继续输出你的看法（以【XX观点】开头，简洁有锐度）。');
        pair.memberCounts[m.id] = assistantCount(m);
      });
      pair.phase = 'sent';
      pair.state = 'toGroup';
      pair.status = 'discussing';
      pair._sentAt = Date.now();
      pair._ready = false;
      ZFArrow.applyStatus(pair); persist();
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.register) ZFDispatchLedger.register(pair.srcId, pair.memberIds); } catch (eLR2) {}
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.setArrow) ZFDispatchLedger.setArrow(pair.srcId, 'down'); } catch (eLB) {}
      try { document.dispatchEvent(new CustomEvent('zf-multi-scattered', { detail: { srcId: pair.srcId, manual: true } })); } catch (eE) {}
      toast('已把原对话进展分发给 ' + members.length + ' 个角色', true);
      return true;
  }

  /* ═══ v4.1 协作父子收口（2026-11-24 用户令「默认开箭头」）═══
     _doCollabGather：点击协作组箭头 → GET collect 拿服务器 done 账本 → 回注父对话审judgment模板。
     pollCollabDone：detect 钩子轮询 done 进度 → 箭头提示/badge 实时刷新（不自动收口，M2 归二期）。 */
  function _clipCollab(t, max) { t = String(t == null ? '' : t).trim(); return t.length > max ? t.slice(0, max) + '…（超长已截断）' : t; }

  function pollCollabDone(p) {
    if (p._collabPolling) return;
    p._collabPolling = true;
    var tid = encodeURIComponent(String(p.collabTeam || ''));
    fetch('/api/plugin/collab/collect?team_id=' + tid).then(function (x) { return x.json(); }).then(function (r) {
      p._collabPolling = false;
      if (!r || !r.ok) return;
      var tip = '协作收口箭头：' + (r.done_count || 0) + '/' + (r.member_count || 0) + ' 成员已上报完成';
      if (!r.all_done) tip += '（未齐也可手动点箭头强收，未完成成员会以占位标注）';
      try { if (p.el) p.el.title = tip; } catch (eT) {}
      var badgeEl = p.el && p.el.querySelector && p.el.querySelector('.badge');
      if (badgeEl && r.member_count) badgeEl.textContent = (r.all_done ? '✓全员完成 ' : '协作中 ') + r.done_count + '/' + r.member_count;
    }).catch(function () { p._collabPolling = false; });
  }

  function _doCollabGather(pair, members, src, fromAuto) {
    var busy = false;
    try { members.forEach(function (m) { if (m.isSending) busy = true; }); } catch (eB) {}
    if (busy) { if (!fromAuto) toast('还有协作师正在回复，等全员结束后再收口', false); return false; }
    var tid = encodeURIComponent(String(pair.collabTeam || ''));
    fetch('/api/plugin/collab/collect?team_id=' + tid).then(function (x) { return x.json(); }).then(function (r) {
      if (!r || !r.ok) { toast('❌ 收口汇总失败：' + ((r && r.error) || '通道异常'), false); return; }
      var lines = String(r.summary || '').split('\n').map(function (ln) { return ln.trim(); }).filter(Boolean)
        .map(function (ln) { return '▶ ' + ln; });
      if (!lines.length) { if (!fromAuto) toast('组内还没有任何完成上报（done），稍后再点', false); return; }
      var msg = '这是协作组「' + pair.groupName + '」的父子收口汇总（' + r.done_count + '/' + r.member_count + ' 已上报完成）。'
        + '请逐条核对各协作师的结论是否真的完成了原始任务，明确判断对错；'
        + '标注「未上报完成」的成员按缺员处理，不要视为已审阅；'
        + '核对后给出最终裁决与下一步修正指令：\n\n' + lines.join('\n\n');
      sendTo(src, msg);
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.setArrow) ZFDispatchLedger.setArrow(pair.srcId, 'up'); } catch (eLA) {}
      pair.rounds = (pair.rounds || 0) + 1;
      pair.phase = 'injected'; pair.state = 'toSrc'; pair.status = 'gathered';
      ZFArrow.applyStatus(pair); persist();
      try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: pair.srcId, manual: !fromAuto } })); } catch (eE) {}
      toast('协作组收口：已按 done 账本汇总 ' + lines.length + ' 条回注父对话（' + pair.collabTeam + '）', true);
    }).catch(function (e) { toast('❌ 收口请求失败：' + (e.message || e), false); });
    return true;
  }

  /* ---------- 内核 detect 钩子：就绪检测（成员<2 溶解由内核熔断+这里补提示） ---------- */
  function detectConverge(p) {
    /* 【v4.1 协作组箭头】轮询 done 进度刷提示（默认开箭头；不自动收口——M2 归二期） */
    if (p.collabTeam) { pollCollabDone(p); return; }
    if (p.status !== 'discussing' || p.phase !== 'sent') return;
    var members = membersOf(p);
    if (members.length < 2) return;
    /* 【v14 防提前收口】以派发登记的 memberIds 为准：任一登记成员当前不在 DOM（重渲染脱帧/
       关闭中）→ 视为未完成，禁止放行。否则流式中的成员窗短暂脱离 DOM 一帧即被跳过，
       剩余成员判完 → 提前 emit zf:converge-ready → 右侧卡片提前报「全部完成」。
       （与账本 autoCloseMissing 的 GRACE_MS 宽限思路对齐：缺席≠完成） */
    var regIds = p.memberIds || [];
    if (regIds.length && members.length < regIds.length) return;
    var all = true;
    members.forEach(function (m) {
      /* 【isSending 防误判】流式生成中不能判已回复；【严格判定】基线缺失一律视为未回复 */
      if (m.isSending) { all = false; return; }
      if (p.memberCounts[m.id] == null) { all = false; return; }
      if (assistantCount(m) <= (p.memberCounts[m.id] || 0)) all = false;
      /* 【v15 防提前收口】assistantCount 可能被空壳/错误占位 assistant 消息虚增：
         成员最新一条实质回答为空（只有 META 或没有正文）→ 视为未完成，禁止放行 */
      try { if (!lastAnswer(m) || !String(lastAnswer(m)).trim()) all = false; } catch (eLA2) { all = false; }
    });
    if (all && p._sentAt && (Date.now() - p._sentAt) > 3000) {
      /* 【v17 S3 门禁】_ready 只置一次：detect 钩子高频轮询，就绪后重复进入会导致
         zf:converge-ready 重复派发 / gatherFor 失败时 toast 重复弹；scatter 再派发时
         下方 _doScatter L551 已复位 _ready=false，天然支持下一轮重新武装 */
      if (p._ready) return;
      p._ready = true;
      autoGatherIfReady(p);
    }
  }
  /* 【v17 S3】自动回收动作段（自 detectConverge 迁出，检测/动作解耦）：
     全员答完 → 复用 gatherFor 同一条回收路径（与手动点箭头 100% 等价）。
     轮数是唯一用户可控项：pair.rounds < 自动上限 → 自动回收并进入下一轮；
     达上限 → 不再自动派发，只提示用户当前轮数与上限 */
  function autoGatherIfReady(p) {
    try {
      /* 【v25 2026-11-XX】回收永远全自动（用户拍板：只有再派出是手动的），取消轮数上限门。
         旧逻辑：轮数达 ZF_CONVERGE_AUTO_ROUNDS(默认3) 上限 → 不再自动回收 → 用户被迫手动点。
         新口径：每次全员答完都直接自动回收；继续多轮讨论由用户手动「再派出」触发，
         再派出本身是显式动作，天然构成轮数闸门，无需在回收侧设上限。 */
      try {
        document.dispatchEvent(new CustomEvent('zf:converge-ready', {
          detail: { srcId: String(p.srcId), tkId: String(p.tkId || p.srcId) }
        }));
      } catch (eRQ) {}
      if (typeof window.ZFConvergeArrow.gatherFor === 'function') {
        var _ok = window.ZFConvergeArrow.gatherFor(String(p.srcId));
        if (_ok) toast('⟳ 第' + ((p.rounds || 0) + 1) + '轮 全员回答完毕 → 已自动回收汇总（回收全自动，如需继续讨论请再派出）', true);
      }
    } catch (eAG) { try { ZFConvergeArrow.toast && ZFConvergeArrow.toast('自动收口失败，请手动点击箭头', 'warn'); } catch (eT) {} }
  }
  /* 【修复·单成员箭头】成员=1（如只派一个推进师）时不再自动溶解，箭头保留可返回 */
  function checkDissolve(p) {
    var members = membersOf(p);
    if (members.length < MIN_CONVERGE_MEMBERS) {
      ZFArrow.remove(p);
      persist();
      return true;
    }
    return false;
  }

  /* ---------- 创建收口箭头（薄壳） ---------- */
  function create(srcChat, memberChats, groupName, saved) {
    if (!srcChat || !srcChat.el || !memberChats || !memberChats.length) return null;
    var exist = window.ZFArrow.all().filter(function (p) { return p.kind === 'converge'; });
    for (var i = 0; i < exist.length; i++) {
      if (String(exist[i].srcId) === String(srcChat.id) && exist[i].groupName === groupName && exist[i].el && exist[i].el.isConnected) return exist[i];
    }
    var inst = window.ZFArrow.create({
      srcId: srcChat.id,
      dstId: memberChats[0].id,
      kind: 'converge',
      type: 'swarm',
      colors: { line: GOLD, headStroke: '#b2ebf2', badgeText: '#ffffff' },
      statuses: STATUS,
      badge: '讨论中',
      state: (saved && saved.state === 'toSrc') ? 'toSrc' : 'toDst',
      status: (saved && saved.status) || 'discussing',
      phase: (saved && saved.state === 'toSrc') ? 'injected' : 'sent',
      persistKey: KEY, persist: persist,
      onClick: onArrowClick,
      detect: function (p) { if (!checkDissolve(p)) detectConverge(p); },
      getDst: centroidOf,
      getStatus: labelOf,
      getTitle: getTitleOf
    });
    if (!inst) return null;
    inst.memberIds = memberChats.map(function (c) { return c.id; });
    inst.groupName = groupName || '多角色';
    inst.rounds = (saved && saved.rounds) || 0;
    inst._autoTicket = (saved && saved._autoTicket) || 0;
    inst.collabTeam = (saved && saved.collabTeam) || ''; /* v4.1 协作组收口标记（恢复用） */
    inst._sentAt = Date.now();
    /* 【v11】恢复优先：persist 存了基线就用存档 */
    inst.memberCounts = (function () {
      if (saved && saved.memberCounts && Object.keys(saved.memberCounts).length) return JSON.parse(JSON.stringify(saved.memberCounts));
      var _mc = {};
      memberChats.forEach(function (c) { _mc[c.id] = assistantCount(c); });
      return _mc;
    })();
    try {
      var _t0 = window._zfAutoGatherNext || 0;
      if (_t0 && (Date.now() - _t0) < 60000 && !inst._autoTicket) inst._autoTicket = _t0;
    } catch (e) {}
    /* 【派发登记】派出即登记 N 份到服务器账本 */
    try { if (window.ZFDispatchLedger && ZFDispatchLedger.register) ZFDispatchLedger.register(srcChat.id, inst.memberIds); } catch (eLR) {}
    ZFArrow.applyStatus(inst);
    persist();
    return inst;
  }

  /* ---------- 恢复（内核同款熔断+宽限期：落空不即剔，30 分钟内保档防重启慢恢复误删） ---------- */
  function restorePairs(silent) {
    try {
      var arr = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(arr)) return;
      var kept = [], restored = 0;
      var _now = Date.now();
      var GRACE_MS = 7 * 24 * 60 * 60 * 1000; /* 【v7.6 charlie】30min→7天，与内核对齐：跨关机 _missAt 残留不再真死 */
      arr.forEach(function (s) {
        var src = findChat(s.srcId);
        var members = (s.memberIds || []).map(findChat).filter(function (c) { return c && c.el; });
        if (!src || members.length < MIN_CONVERGE_MEMBERS) {
          /* v7.2.2 宽限期：对端框还没恢复不即剔，保 30 分钟（门槛=MIN_CONVERGE_MEMBERS） */
          if (!s || typeof s !== 'object') return;
          if (!s._missAt) s._missAt = _now;
          if (_now - s._missAt < GRACE_MS) { kept.push(s); return; }
          return; /* 宽限期已过仍未复活：真死剔除 */
        }
        var p = create(src, members, s.groupName || '多角色', s);
        if (p) { restored++; if (s && typeof s === 'object') delete s._missAt; kept.push(s); }
        else if (s && typeof s === 'object') {
          if (!s._missAt) s._missAt = _now;
          if (_now - s._missAt < GRACE_MS) kept.push(s);
        }
      });
      try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch (e) {}
      if (restored && !silent) toast('已恢复 ' + restored + ' 条收口总箭头', true);
    } catch (e) {}
  }

  /* ---------- 启动恢复 ---------- */
  (function waitRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if (tries > 600) { clearInterval(timer); return; }
      if (hasSaved && anyBox) {
        restorePairs(true);
        var _total = 0, _done = 0;
        try { _total = (JSON.parse(raw) || []).length; } catch (e) { _total = 0; }
        try { _done = window.ZFArrow.all().filter(function (p) { return p.kind === 'converge' && p.el && p.el.isConnected; }).length; } catch (e) {}
        if (_total && _done >= _total) clearInterval(timer);
        if (_total === 0) clearInterval(timer);
      }
    }, 1000);
  })();

  /* ---------- 事件同步（multi 收口/发散联动，原样保留） ---------- */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = ev.detail && ev.detail.srcId;
      window.ZFArrow.all().forEach(function (p) {
        if (p.kind !== 'converge' || String(p.srcId) !== String(sid)) return;
        if (p.state !== 'toDst') return;
        if (p.status === 'failed') return;
        p.state = 'toSrc';
        p.phase = 'injected';
        p.status = 'gathered';
        ZFArrow.applyStatus(p); persist();
      });
    } catch (e) {}
  });
  document.addEventListener('zf-multi-scattered', function (ev) {
    try {
      var sid2 = ev.detail && ev.detail.srcId;
      window.ZFArrow.all().forEach(function (p) {
        if (p.kind !== 'converge' || String(p.srcId) !== String(sid2)) return;
        if (p.state !== 'toSrc') return;
        p.state = 'toDst';
        p.phase = 'sent';
        p.status = 'discussing';
        ZFArrow.applyStatus(p); persist();
      });
    } catch (e) {}
  });

  window.ZFConvergeArrow = {
    create: create,
    restore: restorePairs,
    get pairs() { return window.ZFArrow.all().filter(function (p) { return p.kind === 'converge'; }); },
    getPairs: function () {
      var out = [];
      try {
        window.ZFArrow.all().forEach(function (p) {
          if (p.kind === 'converge' && p.el && p.el.isConnected) out.push({ srcId: String(p.srcId), tkId: String(p.dstId) });
        });
      } catch (e) {}
      return out;
    }
  };

  window.ZFConvergeArrow.gatherFor = function (srcId, opts) {
    /* 【服务器账本收口】找该源对话的收口箭头执行收口（保留原入口签名） */
    try {
      var list = window.ZFArrow.all().filter(function (p) { return p.kind === 'converge'; });
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (String(p.srcId) === String(srcId) && p.el && p.el.isConnected && p.phase === 'sent') {
          var ok = false;
          try { ok = onArrowClick(p, true); } catch (e) { ok = false; }
          return ok;
        }
      }
    } catch (e) {}
    return false;
  };

  /* 【返回（再分发）】phase=injected（已回收反转）的箭头 → 把源对话最新结论再分发给角色组。
     右侧队列 discuss 阶段「➡ 返回」按钮走这里，与点箭头本体 100% 等价 */
  window.ZFConvergeArrow.scatterFor = function (srcId, opts) {
    try {
      var list = window.ZFArrow.all().filter(function (p) { return p.kind === 'converge'; });
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (String(p.srcId) === String(srcId) && p.el && p.el.isConnected && p.phase === 'injected') {
          var ok = false;
          try { ok = onArrowClick(p, true); } catch (e) { ok = false; }
          return ok;
        }
      }
    } catch (e) {}
    return false;
  };
  /* 【修复·提前收口】成员完成事件 ≠ 全组完成：verify-arrow 每个成员答完都广播
     zf:crew-member-done，旧逻辑无条件 gatherFor → 任务未到回收时机就提前收口，
     回注源对话后再派发 → 「又派又收」乱象。此处加全员就绪守卫（与 detectConverge
     同判据：全员不在流式、基线存在且有实质新回答），不满足则不收口，等 detectConverge
     常规轮询放行。 */
  function allMembersDoneForGather(p) {
    if (p.status !== 'discussing' || p.phase !== 'sent') return false;
    var members = membersOf(p);
    if (!members.length) return false;
    var regIds = p.memberIds || [];
    if (regIds.length && members.length < regIds.length) return false; /* 有成员脱帧 → 未完成 */
    var all = true;
    members.forEach(function (m) {
      if (!all) return;
      if (m.isSending) { all = false; return; }
      if (p.memberCounts[m.id] == null) { all = false; return; }
      if (assistantCount(m) <= (p.memberCounts[m.id] || 0)) all = false;
      try { if (!lastAnswer(m) || !String(lastAnswer(m)).trim()) all = false; } catch (eLA) { all = false; }
    });
    return all && p._sentAt && (Date.now() - p._sentAt) > 3000;
  }
  document.addEventListener('zf:crew-member-done', function (ev) {
    try {
      var d = ev.detail || {};
      var sid = d.srcId;
      if (!sid) return;
      /* 守卫：只有全组成员都实质完成才允许触发收口 */
      var list = window.ZFArrow.all().filter(function (p) { return p.kind === 'converge' && String(p.srcId) === String(sid); });
      var ready = list.some(function (p) { return allMembersDoneForGather(p); });
      if (!ready) return;
      if (typeof window.ZFConvergeArrow.gatherFor === 'function') {
        try { window.ZFConvergeArrow.gatherFor(sid); } catch (eG) {}
      }
    } catch (e) {}
  });
  // [converge-arrow] v2 薄壳已加载（内核版）
})();
