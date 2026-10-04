/* ==========================================================================
 * chatbox-multi-arrow.js — 多角色探讨 1:N 橙金总箭头
 * 原对话 ? 角色分组(N个子对话)：点击=回收汇总回注 / 再次点击=再分发，无限往复
 * ========================================================================== */
(function () {
  'use strict';
  if (window.ZFMultiArrow) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var GOLD = '#ffb74d';
  var GOLD_DARK = '#ff9800';
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
    var line = svg.querySelector('.ma-line');
    var head = svg.querySelector('.ma-head');
    var rect = svg.querySelector('.ma-badge-rect');
    var txt = svg.querySelector('.ma-badge-text');
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
    if (st.flow) line.classList.add('ma-flow'); else line.classList.remove('ma-flow');
  }

  /* ---------- 持久化 ---------- */
  function persist() {
    try {
      localStorage.setItem('zf_multi_pairs', JSON.stringify(pairs.map(function (p) {
        return { srcId: p.srcId, memberIds: p.memberIds, groupName: p.groupName, state: p.state, status: p.status, rounds: p.rounds || 0, auto: !!p.auto, _sentAt: p._sentAt || 0, _autoTicket: p._autoTicket || 0 };
      })));
    } catch (e) {}
  }
  function restorePairs() {
    try {
      var arr = JSON.parse(localStorage.getItem('zf_multi_pairs') || '[]');
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
    el.className = 'zf-multi-arrow';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:5000;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 0 8px rgba(255,183,77,.9));user-select:none;transition:transform .25s;';
    el.innerHTML =
      '<svg width="240" height="72" viewBox="0 0 240 72" xmlns="' + SVG_NS + '" style="overflow:visible">' +
      '<line class="ma-line" x1="6" y1="36" x2="168" y2="36" stroke="' + GOLD + '" stroke-width="11" stroke-linecap="round" stroke-dasharray="14 10"/>' +
      '<polygon class="ma-head" points="162,4 236,36 162,68" fill="' + GOLD + '" stroke="#ffffff" stroke-width="3"/>' +
      '<g class="ma-badge">' +
      '<rect class="ma-badge-rect" x="84" y="18" width="72" height="34" rx="17" fill="' + GOLD + '" opacity="0.95"/>' +
      '<text class="ma-badge-text" x="120" y="41" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff" font-family="sans-serif">讨论中</text>' +
      '</g>' +
      '<style>.ma-flow{animation:maFlow 1s linear infinite;}@keyframes maFlow{to{stroke-dashoffset:-24;}}</style>' +
      '</svg>' +
      /* 补充说明输入框（挂在 el 顶层，不进 SVG 旋转层；hover 时浮现，click 阻止冒泡） */
      '<div class="ma-note-wrap" style="position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:2px;opacity:0;pointer-events:none;transition:opacity .2s;">' +
      '<textarea class="ma-note" maxlength="2000" rows="2" placeholder="✎ 补充说明（点箭头时一并送达，可换行）" ' +
      'style="width:260px;height:44px;resize:none;padding:5px 10px;border-radius:10px;border:1px solid ' + GOLD_DARK + ';background:#3a2c14;color:#ffe0b2;font-size:12px;outline:none;box-shadow:0 2px 10px rgba(0,0,0,.5);font-family:inherit;box-sizing:border-box;">' +
      '</div>' +
      /* 【自动回收模式】开关（hover 箭头可见，随 pair 持久化） */
      '<div class="ma-auto-wrap" style="position:absolute;left:50%;top:calc(100% + 52px);transform:translateX(-50%);opacity:0;pointer-events:none;transition:opacity .2s;white-space:nowrap;">' +
      '<label style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:8px;background:rgba(30,20,5,.85);border:1px solid ' + GOLD_DARK + ';cursor:pointer;font-size:11px;color:#ffe0b2;">' +
      '<input type="checkbox" class="ma-auto-toggle" style="cursor:pointer;">♻ 自动回收</label>' +
      '</div>';
    /* hover 箭头时显示输入框；输入框内事件全部拦截，避免冒泡触发箭头点击 */
    var noteWrap = el.querySelector('.ma-note-wrap');
    var noteInput = el.querySelector('.ma-note');
    var autoWrap = el.querySelector('.ma-auto-wrap');
    el.addEventListener('mouseenter', function () { noteWrap.style.opacity = '1'; noteWrap.style.pointerEvents = 'auto'; autoWrap.style.opacity = '1'; autoWrap.style.pointerEvents = 'auto'; });
    el.addEventListener('mouseleave', function () { if (document.activeElement !== noteInput) { noteWrap.style.opacity = '0'; noteWrap.style.pointerEvents = 'none'; autoWrap.style.opacity = '0'; autoWrap.style.pointerEvents = 'none'; } });
    autoWrap.addEventListener('click', function (ev) { ev.stopPropagation(); });
    autoWrap.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    var autoToggle = el.querySelector('.ma-auto-toggle');
    autoToggle.addEventListener('click', function (ev) { ev.stopPropagation(); });
    autoToggle.addEventListener('change', function (ev) {
      ev.stopPropagation();
      var p = ev.target._pair;
      if (!p) return;
      p.auto = ev.target.checked;
      if (p.auto && p.phase === 'sent' && !p._timeoutAt) p._timeoutAt = Date.now() + 8 * 60 * 1000;
      persist();
      toast(ev.target.checked ? '♻ 自动回收已开启：全员答完自动汇总回注' : '自动回收已关闭', true);
    });
    noteWrap.addEventListener('click', function (ev) { ev.stopPropagation(); });
    noteWrap.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    noteInput.addEventListener('click', function (ev) { ev.stopPropagation(); });
    noteInput.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    noteInput.addEventListener('paste', function (ev) { ev.stopPropagation(); });
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
      auto: !!(saved && saved.auto),
      /* 【自动回收 v4】创建时认领全局一次性票据并立即清零：只作用于本 pair，不误触发其他就绪分组 */
      _autoTicket: (saved && saved._autoTicket) || 0,
      _gatherUsedAt: null,
      _autoTimer: null,
      _timeoutAt: null,
      memberCounts: {},
      _sentAt: (saved && saved._sentAt) || Date.now(),
      _lx: -1, _ly: -1, _ang: null
    };
    try {
      /* 【v14 修复】不再无条件全局清零 _zfAutoGatherNext——本 pair 创建通常发生在数量弹窗勾选后
         几百毫秒内，清零会把 thinker/verify/race 的自动回收凭证抹掉，导致勾了自动回收但角色回复后
         永远不回收。凭证语义下 thinker/verify/race 各自按 _gatherUsedAt 消费同一时间戳，互不抢占，
         此处只需认领自己的票据（_autoTicket），不动全局标志 */
      var _t0 = window._zfAutoGatherNext || 0;
      if (_t0 && (Date.now() - _t0) < 60000 && !pair._autoTicket) pair._autoTicket = _t0;
    } catch (e) {}
    if (pair.auto && pair.phase === 'sent') {
      /* 恢复场景：优先用持久化的 _sentAt 补算超时点，避免刷新后丢失 8 分钟兜底 */
      var sentBase = (saved && saved._sentAt) || pair._sentAt;
      pair._timeoutAt = sentBase + 8 * 60 * 1000;
      /* 恢复时若早已超时，缩短到 30 秒缓冲，尽快触发部分回收 */
      if (pair._timeoutAt - Date.now() < 0) pair._timeoutAt = Date.now() + 30 * 1000;
    }
    /* checkbox ↔ pair 映射 + 初始勾选态 */
    try {
      var at = el.querySelector('.ma-auto-toggle');
      if (at) { at.checked = pair.auto; at._pair = pair; }
    } catch (e) {}
    memberChats.forEach(function (c) { pair.memberCounts[c.id] = assistantCount(c); });
    pairs.push(pair);
    applyStatus(pair);
    persist();

    el.addEventListener('click', function (ev) { ev.stopPropagation(); onArrowClick(pair); });
    return pair;
  }

  /* ---------- 读取补充说明（读取后清空，返回拼好的段落；空输入返回空串） ---------- */
  function takeNote(pair) {
    try {
      var input = pair.el && pair.el.querySelector('.ma-note');
      if (!input) return '';
      var t = (input.value || '').trim().slice(0, 2000);
      input.value = '';
      if (!t) return '';
      return '\n\n【补充说明】\n' + t;
    } catch (e) { return ''; }
  }

  /* ---------- 点击：回收汇总 / 再分发 ---------- */
  function onArrowClick(pair) {
    /* 手动接管时取消自动触发与超时（clearTimeout 防双触发） */
    try { clearTimeout(pair._autoTimer); } catch (e) {}
    pair._autoTimer = null; pair._timeoutAt = null;
    var src = findChat(pair.srcId);
    if (!src) { if (pair.el) pair.el.remove(); return; }
    var members = pair.memberIds.map(findChat).filter(function (c) { return c && c.el; });
    if (!members.length) { toast('角色对话已全部关闭，箭头失效', false); pair.status = 'failed'; applyStatus(pair); return; }

    if (pair.phase === 'sent') {
      var noteBack = takeNote(pair);
      /* 回收：收集全部成员最新回复 → 汇总回注原对话 */
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
      applyStatus(pair); persist();
      try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: pair.srcId } })); } catch (eE) {}
      toast('已汇总 ' + lines.length + ' 个角色观点回注原对话', true);
    } else {
      /* 发散：把原对话最新回复/补充再次分发给每个角色 */
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
        if (!p.el || !p.el.isConnected || !src || !members.length) {
          if (p.el) p.el.remove();
          pairs.splice(i, 1); persist(); continue;
        }
        /* 回复检测：全部成员都比上次多回复了 → 提示可回收 */
        if (p.status === 'discussing' && p.phase === 'sent') {
          var all = true;
          members.forEach(function (m) {
            if (assistantCount(m) <= (p.memberCounts[m.id] || 0)) all = false;
          });
          if (all && p._sentAt && (Date.now() - p._sentAt) > 3000) {
            p.status = 'discussing';
            var bt = p.el.querySelector('.ma-badge-text');
            /* 【自动回收 v4】p.auto 或创建时认领的票据：只作用于本 pair，全局标志不再跨 pair 生效 */
            var _ag = p.auto || !!(p._autoTicket && (Date.now() - p._autoTicket) < 60000);
            if (bt) bt.textContent = _ag ? '自动回收中…' : '已就绪·点回收';
            p._ready = true;
            if (_ag && !p._autoTimer && !(p._gatherUsedAt && p._gatherUsedAt === p._autoTicket)) {
              p._gatherUsedAt = p._autoTicket || Date.now();
              p._autoTimer = setTimeout(function () {
                p._autoTimer = null;
                if (p._ready && p.phase === 'sent' && p.el && p.el.isConnected) onArrowClick(p);
              }, 2000);
            }
          }
          /* 【超时兜底】auto 模式 8 分钟未全员答完 → 只回收已完成的部分 */
          if (p.auto && p._timeoutAt && Date.now() > p._timeoutAt) {
            p._timeoutAt = null;
            try { clearTimeout(p._autoTimer); } catch (e) {}
            p._autoTimer = null;
            var bt2 = p.el.querySelector('.ma-badge-text');
            var done = members.filter(function (m) { return assistantCount(m) > (p.memberCounts[m.id] || 0); }).length;
            if (bt2 && done < members.length) toast('⏱ 自动回收超时：' + done + '/' + members.length + ' 个角色已回复，回收已完成部分', false);
            onArrowClick(p);
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
        var badge = p.el.querySelector('.ma-badge');
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
      try { raw = localStorage.getItem('zf_multi_pairs'); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if ((hasSaved && anyBox) || tries > 60) {
        clearInterval(timer);
        if (hasSaved) restorePairs();
      }
    }, 1000);
  })();

  window.ZFMultiArrow = { create: create, pairs: pairs };
  // [multi-arrow] 多角色橙金箭头模块已加载
})();

