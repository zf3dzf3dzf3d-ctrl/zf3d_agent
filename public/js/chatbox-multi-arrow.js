/* ============================================================
 * chatbox-multi-arrow.js — 多角色探讨 1:N 橙金总箭头（v2 薄壳·内核版）
 * 渲染/定位/rAF循环/z-index/悬停提升/恢复 全部委托 zf-arrow-core.js
 * 本壳只保留业务：回收汇总回注 / 再分发 / 自动回收开关 / 8分钟超时兜底
 * 方向：原对话 ↔ 成员质心（内核 getDst 钩子多点质心）
 * 用法：window.ZFMultiArrow.create(srcChat, memberChats, groupName) → type:'swarm'（大号粗杆）
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFMultiArrow) return;

  var GOLD = '#ffb74d';
  var GOLD_DARK = '#ff9800';
  var KEY = 'zf_multi_pairs';

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
    try { if (App._stepToast) App._stepToast(msg, !!ok); } catch (e) {}
  }
  function messagesOf(chat) {
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
    /* 跳过 ⏱__TASKMETA__ 元数据消息，防 meta 行被当结论回注 */
    var META = '\u23F1__TASKMETA__';
    try {
      var ms = messagesOf(chat);
      for (var i = ms.length - 1; i >= 0; i--) {
        if (ms[i].role !== 'assistant') continue;
        var c = String(ms[i].content || '').trim();
        if (!c) continue;
        if (c.indexOf(META) === 0) continue;
        return c;
      }
    } catch (e) {}
    return '';
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
  /* 内核 getDst 钩子：终点 = 全体成员中心质心 */
  function centroidOf(p) {
    var members = membersOf(p);
    if (!members.length) return null;
    var ax = 0, ay = 0;
    members.forEach(function (m) { var c = centerOf(m); ax += c.x; ay += c.y; });
    return { x: ax / members.length, y: ay / members.length };
  }

  /* ---------- 持久化 ---------- */
  function persist() {
    try {
      var _mem = window.ZFArrow.all().filter(function (p) { return p.kind === 'multi'; }).map(function (p) {
        return { srcId: p.srcId, memberIds: p.memberIds, groupName: p.groupName, state: p.state, status: p.status, rounds: p.rounds || 0, auto: !!p.auto, _sentAt: p._sentAt || 0, _autoTicket: p._autoTicket || 0 };
      });
      /* 【v7.2.3 宽限合并·charlie】restore 保留的 _missAt 宽限条目不在内存实例里（对端框尚未恢复），
         persist 直接覆写会把它们洗掉 → 重启慢恢复场景箭头被永久误删。写盘前先合并回来。 */
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

  /* ---------- 补充说明（读取后清空） ---------- */
  function takeNote(pair) {
    try {
      var input = pair.el && pair.el.querySelector('.zfa-note input');
      if (!input) return '';
      var t = (input.value || '').trim().slice(0, 2000);
      input.value = '';
      pair.note = '';
      if (!t) return '';
      return '\n\n【补充说明】\n' + t;
    } catch (e) { return ''; }
  }

  /* ---------- 点击：回收汇总 / 再分发（业务原样保留） ---------- */
  function onArrowClick(pair) {
    try { clearTimeout(pair._autoTimer); } catch (e) {}
    pair._autoTimer = null; pair._timeoutAt = null;
    var src = findChat(pair.srcId);
    if (!src) { ZFArrow.remove(pair); return; }
    var members = membersOf(pair);
    if (!members.length) { toast('角色对话已全部关闭，箭头失效', false); pair.status = 'failed'; ZFArrow.applyStatus(pair); return; }

    if (pair.phase === 'sent') {
      var noteBack = takeNote(pair);
      var lines = [];
      members.forEach(function (m) {
        var ans = lastAnswer(m);
        var name = (m.el && m.el._multiRoleName) || (m.id || '角色');
        if (ans) lines.push('▶ ' + name + '：\n' + ans.trim());
      });
      if (!lines.length) { toast('角色们还没有回复，无法汇总', false); return; }
      var msg = '这是「' + pair.groupName + '」分组给您的多角色观点汇总（第' + (pair.rounds + 1) + '轮），请参考以上多方观点继续推进任务，不要重复向用户追问已确认信息：\n\n' + lines.join('\n\n') + noteBack;
      sendTo(src, msg);
      pair.rounds++;
      pair.phase = 'injected';
      pair.state = 'toSrc';
      pair.status = 'gathered';
      ZFArrow.applyStatus(pair); persist();
      try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: pair.srcId } })); } catch (eE) {}
      toast('已汇总 ' + lines.length + ' 个角色观点回注原对话', true);
    } else {
      var srcAns = lastAnswer(src);
      if (!srcAns) { toast('原对话还没有新内容可分发', false); return; }
      var noteFwd = takeNote(pair);
      members.forEach(function (m) {
        sendTo(m, '【原对话最新进展 · 第' + (pair.rounds + 1) + '轮】\n' + srcAns.slice(0, 6000) + '\n\n请以你的角色视角，针对上述进展继续输出你的看法（以【XX观点】开头，简洁有锐度）。' + noteFwd);
        pair.memberCounts[m.id] = assistantCount(m);
      });
      pair.phase = 'sent';
      pair.state = 'toGroup';
      pair.status = 'discussing';
      pair._sentAt = Date.now();
      pair._ready = false;
      if (pair.auto) pair._timeoutAt = Date.now() + 8 * 60 * 1000;
      ZFArrow.applyStatus(pair); persist();
      try { document.dispatchEvent(new CustomEvent('zf-multi-scattered', { detail: { srcId: pair.srcId } })); } catch (eE) {}
      toast('已把原对话进展分发给 ' + members.length + ' 个角色', true);
    }
  }

  /* ---------- 内核 detect 钩子：就绪检测 + 超时兜底（业务原样保留） ---------- */
  function detectMulti(p) {
    if (p.status !== 'discussing' || p.phase !== 'sent') return;
    var members = membersOf(p);
    var all = true;
    members.forEach(function (m) {
      if (assistantCount(m) <= (p.memberCounts[m.id] || 0)) all = false;
    });
    if (all && p._sentAt && (Date.now() - p._sentAt) > 3000) {
      p._ready = true;
      /* 2026-11-01 按用户要求：彻底移除自动返回，只保留手动点箭头回收 */
      var bt = p.svg && p.svg.querySelector('.zfa-badge-text');
      if (bt) bt.textContent = '已就绪·点回收';
    }
    if (p.auto && p._timeoutAt && Date.now() > p._timeoutAt) {
      p._timeoutAt = null;
      try { clearTimeout(p._autoTimer); } catch (e) {}
      p._autoTimer = null;
      var done = members.filter(function (m) { return assistantCount(m) > (p.memberCounts[m.id] || 0); }).length;
      if (done < members.length) toast('⏱ 自动回收超时：' + done + '/' + members.length + ' 个角色已回复，回收已完成部分', false);
      onArrowClick(p);
    }
  }
  /* 徽标文案钩子：就绪态显示「已就绪·点回收」 */
  function labelOf(p, st) {
    if (p.status === 'discussing' && p._ready) return '已就绪·点回收' + (p.rounds > 0 ? ' · 第' + p.rounds + '轮' : '');
    return st.text + (p.rounds > 0 ? ' · 第' + p.rounds + '轮' : '');
  }
  function getTitleOf(p, st) {
    return '【' + (p.groupName || '多角色') + '】' + st.text + '（第' + (p.rounds || 0) + '轮）（点击：' + (p.phase === 'sent' ? '回收汇总回注原对话' : '再分发给角色组') + '）';
  }

  /* ---------- 创建 1:N 箭头（薄壳） ---------- */
  function create(srcChat, memberChats, groupName, saved) {
    if (!srcChat || !srcChat.el || !memberChats || !memberChats.length) return null;
    /* 去重 */
    var exist = window.ZFArrow.all().filter(function (p) { return p.kind === 'multi'; });
    for (var i = 0; i < exist.length; i++) {
      if (String(exist[i].srcId) === String(srcChat.id) && exist[i].groupName === groupName && exist[i].el && exist[i].el.isConnected) return exist[i];
    }
    var inst = window.ZFArrow.create({
      srcId: srcChat.id,
      dstId: memberChats[0].id, /* 内核熔断检测用；真实终点走 getDst 质心 */
      kind: 'multi',
      type: 'swarm',
      colors: { line: GOLD, headStroke: '#ffe0b2', badgeText: '#ffffff' },
      statuses: STATUS,
      badge: '讨论中',
      state: (saved && saved.state === 'toSrc') ? 'toSrc' : 'toDst',
      status: (saved && saved.status) || 'discussing',
      phase: (saved && saved.state === 'toSrc') ? 'injected' : 'sent',
      noteInput: true,
      persistKey: KEY, persist: persist,
      onClick: onArrowClick,
      detect: detectMulti,
      getDst: centroidOf,
      getStatus: labelOf,
      getTitle: getTitleOf
    });
    if (!inst) return null;
    inst.memberIds = memberChats.map(function (c) { return c.id; });
    inst.groupName = groupName || '多角色';
    inst.rounds = (saved && saved.rounds) || 0;
    inst.auto = !!(saved && saved.auto);
    inst._autoTicket = (saved && saved._autoTicket) || 0;
    inst._sentAt = (saved && saved._sentAt) || Date.now();
    inst.memberCounts = {};
    memberChats.forEach(function (c) { inst.memberCounts[c.id] = assistantCount(c); });
    try {
      var _t0 = window._zfAutoGatherNext || 0;
      if (_t0 && (Date.now() - _t0) < 60000 && !inst._autoTicket) inst._autoTicket = _t0;
    } catch (e) {}
    if (inst.auto && inst.phase === 'sent') {
      var sentBase = (saved && saved._sentAt) || inst._sentAt;
      inst._timeoutAt = sentBase + 8 * 60 * 1000;
      if (inst._timeoutAt - Date.now() < 0) inst._timeoutAt = Date.now() + 30 * 1000;
    }
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
        if (!src || !members.length) {
          /* v7.2.2 宽限期：对端框还没恢复（重启后异步慢）不即剔，记录首落时间戳保 30 分钟 */
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
      if (restored && !silent) toast('已恢复 ' + restored + ' 条多角色总箭头', true);
    } catch (e) {}
  }

  /* ---------- 启动恢复（600 秒重试，恢复满即停） ---------- */
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
        try { _done = window.ZFArrow.all().filter(function (p) { return p.kind === 'multi' && p.el && p.el.isConnected; }).length; } catch (e) {}
        if (_total && _done >= _total) clearInterval(timer);
        if (_total === 0) clearInterval(timer);
      }
    }, 1000);
  })();

  window.ZFMultiArrow = {
    create: create,
    restore: restorePairs,
    get pairs() { return window.ZFArrow.all().filter(function (p) { return p.kind === 'multi'; }); }
  };
  // [multi-arrow] v2 薄壳已加载（内核版）
})();
