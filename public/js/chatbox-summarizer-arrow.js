/* ============================================================
 * chatbox-summarizer-arrow.js —— 总结师琥珀色方向箭头（复用策划师箭头状态机）
 * 状态：pending(总结中·琥珀·流动) / clarified(已总结·深琥珀) / applied(已沉淀·绿) / failed(失效·灰)
 * 点击箭头：把总结师结论（【总结师沉淀】行）回注原对话并反转方向
 * 用法：window.ZFSummarizerArrow.create(srcChat, thinkerChat)
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFSummarizerArrow) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var pairs = [];
  var AMBER = '#ffb300';
  var AMBER_D = '#ff8f00';

  var STATUS = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '总结完成', flow: false },
    pending:   { color: AMBER, text: '总结中', flow: true },
    clarified: { color: AMBER_D, text: '已总结', flow: false },
    applied:   { color: '#00e676', text: '已沉淀', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };
  var CONCLUSION_RE = /【总结师沉淀】/;

  function cleanQuestionText(c) {
    try {
      // 1) 【v8 上下文后置】优先取【当前项目上下文】之前的内容（新格式：正文在前、上下文在尾）
      var idx8 = c.indexOf('【当前项目上下文】');
      if (idx8 > 0) c = c.slice(0, idx8);
      // 2) 兼容旧前缀格式：若正文在标记之后（前面无正文），取标记之后内容
      else {
        var m = c.match(/-{2,}\s*上下文结束\s*-{2,}/);
        if (m && m.index !== undefined) c = c.slice(m.index + m[0].length);
      }
      c = c.replace(/^[（(][^（）()]*[)）]\s*/g, '');
      c = c.replace(/^@[^\s@]{1,20}\s*/g, '');
      c = c.replace(/^(【[^】]{1,20}】|#[^\s#]{1,20}\s*|\[[^\]]{1,20}\])\s*/g, '');
      return c.trim();
    } catch (e) { return c; }
  }

  function firstQuestion(chat) {
    try {
      var h = (chat && chat.history) || [];
      for (var i = 0; i < h.length; i++) {
        if (h[i].role !== 'user') continue;
        var c = String(h[i].content || '').trim();
        if (!c) continue;
        if (c.indexOf('（策划师素材包') === 0) continue;
        if (c.indexOf('（审核员素材包') === 0) continue;
        if (c.indexOf('（总结师素材包') === 0) continue;
        if (/^(【?(系统|系统提示|守卫|安全|注入)|\[?(SYSTEM|GUARD|INJECT)\b)/i.test(c)) continue;
        if (h[i]._guardInject || h[i]._verifyRound || h[i]._continueRound || h[i]._thinkerRound) continue;
        c = cleanQuestionText(c);
        if (!c) continue;
        c = c.replace(/\s+/g, ' ').trim();
        return c.length > 60 ? c.slice(0, 60) + '…' : c;
      }
    } catch (e) {}
    return '';
  }

  function findChat(id) {
    var boxes = (window.App && App.chatBoxes) || [];
    for (var i = 0; i < boxes.length; i++) {
      var c = boxes[i];
      if (c && c.id === id && c.el && c.el.isConnected) return c;
    }
    return null;
  }

  function lastAnswer(chat) {
    /* 【修复】跳过 ⏱__TASKMETA__ 元数据消息，避免把 meta 行当结论回注 */
    var META = '\u23F1__TASKMETA__';
    if (!chat || !chat.history) return '';
    for (var i = chat.history.length - 1; i >= 0; i--) {
      if (chat.history[i].role === 'assistant') {
        var c = String(chat.history[i].content || '');
        if (c.indexOf(META) === 0) continue;
        if (c.trim()) return c;
      }
    }
    return '';
  }

  // 取原对话中最后一条用户亲手输入的消息（排除素材包/注入/箭头回注等系统内容）
  function lastUserMsg(chat) {
    try {
      var h = (chat && chat.history) || [];
      for (var i = h.length - 1; i >= 0; i--) {
        if (h[i].role !== 'user') continue;
        var c = String(h[i].content || '').trim();
        if (!c) continue;
        if (c.indexOf('（策划师素材包') === 0 || c.indexOf('（审核员素材包') === 0 || c.indexOf('（总结师素材包') === 0) continue;
        if (c.indexOf('这是策划师') === 0 || c.indexOf('原对话有了新进展') === 0) continue;
        if (c.indexOf('请针对以下内容做任务扩展') === 0) continue;
        if (h[i]._guardInject || h[i]._verifyRound || h[i]._thinkerRound) continue;
        return c.length > 800 ? c.slice(0, 800) + '…' : c;
      }
    } catch (e) {}
    return '';
  }

  function assistantCount(chat) {
    if (!chat || !chat.history) return 0;
    var n = 0;
    for (var i = 0; i < chat.history.length; i++) {
      if (chat.history[i].role === 'assistant' && String(chat.history[i].content || '').trim()) n++;
    }
    return n;
  }

  function sendTo(chat, text) {
    try {
      App.addMsg(chat.el, text, 'user', chat.modelId);
      chat.history.push({ role: 'user', content: text });
      App.sendToModel(chat.el, chat);
    } catch (e) {
      try { Store.addLog('error', chat.id, 'thinker-arrow', '发送失败: ' + e.message); } catch (e2) {}
    }
  }

  function toast(msg, ok) {
    try { if (App._stepToast) App._stepToast(msg, !!ok); } catch (e) {}
  }

  function centerOf(chat) {
    var r = chat.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // 提取总结师最新沉淀段落（【总结师沉淀】…），无则返回 ''（不支持策划师/思想家旧标记）
  function lastConclusion(chat) {
    var ans = lastAnswer(chat);
    if (!ans) return '';
    // 只认总结师沉淀标记【总结师沉淀】
    var idx = ans.lastIndexOf('【总结师沉淀】');
    if (idx < 0) return '';
    var tail = String(ans).slice(idx);
    var lines = tail.split('\n');
    // 标记所在行；若标记后同行无内容（AI 换行排版），继续收集后续非空行
    var first = (lines[0] || '').trim();
    if (first.length > '【总结师沉淀】'.length) return first;
    var collected = [lines[0]];
    for (var li = 1; li < lines.length; li++) {
      var ln = lines[li].trim();
      if (!ln) {
        // 空行：若已收集到内容则停止（结论段落结束），否则跳过
        if (collected.length > 1) break;
        continue;
      }
      // 遇到下一个 markdown 大标题（## 等）说明结论段落结束
      if (/^#{1,3}\s/.test(ln) && collected.length > 1) break;
      collected.push(lines[li]);
      // 收到编号行动项结尾（。；）后，若下一行是新段落则可停，简单起见收集到空行/标题为止
    }
    var line = collected.join('\n').trim();
    return line;
  }

  function applyStatus(pair) {
    var st = STATUS[pair.status] || STATUS.pending;
    var svg = pair.el && pair.el.querySelector('svg');
    if (!svg) return;
    var line = svg.querySelector('.ta-line');
    var head = svg.querySelector('.ta-head');
    var badgeRect = svg.querySelector('.ta-badge-rect');
    var badgeText = svg.querySelector('.ta-badge-text');
    if (line) line.setAttribute('stroke', st.color);
    if (head) { head.setAttribute('fill', st.color); head.setAttribute('stroke', st.color); }
    if (badgeRect) badgeRect.setAttribute('fill', st.color);
    var rounds = pair.rounds || 0;
    var label = st.text + (rounds > 0 ? '·第' + rounds + '轮' : '');
    if (badgeText) {
      badgeText.textContent = label;
      if (badgeRect) {
        var tw = 0;
        try { tw = badgeText.getComputedTextLength(); } catch (e) {}
        if (!tw || !isFinite(tw)) {
          var cw = 0;
          for (var ci = 0; ci < label.length; ci++) cw += label.charCodeAt(ci) > 255 ? 19 : 10;
          tw = cw;
        }
        var w = Math.max(68, Math.round(tw + 18));
        badgeRect.setAttribute('width', w);
        badgeRect.setAttribute('x', 120 - w / 2);
      }
    }
    if (st.flow) {
      line.setAttribute('stroke-dasharray', '14 10');
      line.classList.add('ta-flow');
    } else {
      line.removeAttribute('stroke-dasharray');
      line.classList.remove('ta-flow');
    }
    pair.el.style.filter = 'drop-shadow(0 0 8px ' + st.color + ')';
    pair.el.title = (pair.question ? '【' + pair.question + '】\n' : '') + '当前状态：' + st.text + '（已总结 ' + rounds + ' 轮）（点击：把总结师沉淀回注箭头指向的对话）';
    pair.el.dataset.status = pair.status;
  }

  function setStatus(pair, status) {
    pair.status = status;
    applyStatus(pair);
    persist();
    notifyMinimap();
  }

  function persist() {
    try {
      localStorage.setItem('zf_summarizer_pairs', JSON.stringify(pairs.map(function (p) {
        return { srcId: p.srcId, tkId: p.tkId, state: p.state, status: p.status, phase: p.phase || '', tkCount: p.tkCount || 0, rounds: p.rounds || 0, question: p.question || '' };
      })));
    } catch (e) {}
  }

  function restorePairs() {
    var raw = null;
    try { raw = localStorage.getItem('zf_summarizer_pairs'); } catch (e) { return; }
    if (!raw) return;
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { return; }
    if (!arr || !arr.length) return;
    var restored = 0;
    arr.forEach(function (d) {
      var src = findChat(d.srcId), tk = findChat(d.tkId);
      if (!src || !tk) return;
      var p = create(src, tk);
      if (p) {
        p.state = d.state === 'toSrc' ? 'toSrc' : 'toTK';
        p.status = STATUS[d.status] ? d.status : 'pending';
        p.phase = d.phase || '';
        p.tkCount = d.tkCount || assistantCount(tk);
        p.rounds = d.rounds || 0;
        p.question = d.question || firstQuestion(src);
        applyStatus(p);
        restored++;
      }
    });
    if (restored) {
      ensureLoop();
      notifyMinimap();
      toast('已恢复 ' + restored + ' 条总结师箭头（含状态）', true);
      persist();
    }
  }

  function create(srcChat, tkChat) {
    if (!srcChat || !tkChat || !srcChat.el || !tkChat.el) return;
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].srcId === srcChat.id && pairs[i].tkId === tkChat.id && pairs[i].el && pairs[i].el.isConnected) return pairs[i];
    }
    var el = document.createElement('div');
    el.className = 'zf-thinker-arrow';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:5000;cursor:pointer;pointer-events:auto;' +
      'filter:drop-shadow(0 0 8px rgba(179,136,255,.9));user-select:none;transition:transform .25s;';
    el.innerHTML =
      '<svg width="240" height="72" viewBox="0 0 240 72" xmlns="' + SVG_NS + '" style="overflow:visible">' +
      '<line class="ta-line" x1="6" y1="36" x2="168" y2="36" stroke="#ffb300" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 10"/>' +
      '<polygon class="ta-head" points="162,6 234,36 162,66" fill="#ffb300" stroke="#ffe082" stroke-width="3"/>' +
      '<g class="ta-badge">' +
      '<rect class="ta-badge-rect" x="86" y="20" width="68" height="30" rx="15" fill="#ffb300" opacity="0.95"/>' +
      '<text class="ta-badge-text" x="120" y="41" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a0a2e" font-family="sans-serif">总结中</text>' +
      '</g>' +
      '<style>.ta-flow{animation:taFlow 1s linear infinite;}@keyframes taFlow{to{stroke-dashoffset:-24;}}</style>' +
      '</svg>' +
      '<div class="ta-note" style="position:absolute;left:10px;top:84px;width:220px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:2;">' +
      '<input type="text" placeholder="✎ 补充说明（点箭头时一并送达）" style="width:100%;box-sizing:border-box;background:rgba(20,8,40,.92);border:1px solid rgba(179,136,255,.55);border-radius:10px;color:#f3eaff;font-size:12px;padding:6px 9px;outline:none;box-shadow:0 0 12px rgba(179,136,255,.35);" />' +
      '</div>';
    document.body.appendChild(el);

    (function () {
      var note = el.querySelector('.ta-note');
      var inp = el.querySelector('.ta-note input');
      if (!note || !inp) return;
      inp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' && inp.value.trim()) {
          e.preventDefault();
          onArrowClick(pair);
          inp.value = ''; pair.note = '';
          hideNow();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          hideNow();
        }
      });
      document.addEventListener('mousedown', function (e) {
        if (!el.contains(e.target) && !note.contains(e.target)) hideNow();
      });
      inp.addEventListener('input', function () { pair.note = inp.value; });
      var hideTimer = null;
      function showNote() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        note.style.opacity = '1'; note.style.pointerEvents = 'auto';
      }
      function hideNote() {
        if (document.activeElement === inp) return;
        hideTimer = setTimeout(function () {
          if (document.activeElement === inp) return;
          note.style.opacity = '0'; note.style.pointerEvents = 'none'; inp.blur();
        }, 350);
      }
      function hideNow() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        note.style.opacity = '0'; note.style.pointerEvents = 'none'; inp.blur();
      }
      el.addEventListener('mouseenter', showNote);
      el.addEventListener('mouseleave', hideNote);
      note.addEventListener('mouseenter', showNote);
      note.addEventListener('mouseleave', hideNote);
      inp.addEventListener('focus', showNote);
      inp.addEventListener('blur', hideNote);
    })();

    var pair = { srcId: srcChat.id, tkId: tkChat.id, el: el, state: 'toTK', status: 'pending', phase: '', tkCount: assistantCount(tkChat) };
    pair.question = firstQuestion(srcChat);
    pairs.push(pair);
    applyStatus(pair);
    persist();

    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      onArrowClick(pair);
    });

    return pair;
  }

  function takeNote(pair) {
    var note = '';
    try {
      var inp = pair.el && pair.el.querySelector('.ta-note input');
      if (inp && inp.value.trim()) { note = inp.value.trim(); inp.value = ''; }
      else if (pair.note && String(pair.note).trim()) { note = String(pair.note).trim(); pair.note = ''; }
    } catch (e) {}
    return note ? '\n\n【补充说明】\n' + note : '';
  }

  function onArrowClick(pair) {
    var src = findChat(pair.srcId);
    var tk = findChat(pair.tkId);
    if (!src || !tk) { if (pair.el) pair.el.remove(); return; }

    // 状态机（pair.phase）：
    //  - 未送出/已回注完（phase 为空或 'injected'）：点击 → 把原对话最新内容送总结师沉淀
    //  - 'sent'（已送总结师，等回复）：点击 → 回注总结师沉淀到原对话，回到 'injected'
    if (pair.phase === 'sent') {
      // 总结师 → 原对话：回注沉淀（优先【总结师沉淀】段落，无则整体回复）
      var concl = lastConclusion(tk);
      var ans = lastAnswer(tk);
      if (!ans) { toast('总结师还没有沉淀结论，无法回注', false); return; }
      var msg = concl
        ? ('这是总结师对本任务的沉淀结论，请作为经验参考：可复用要点纳入后续做法、遗留事项可考虑跟进；本条仅为参考信息，不需要执行新任务，严禁 ask_user 追问：\n\n' + concl)
        : ('这是总结师对本任务的整体总结思考，请作为经验参考归档（不需要执行新任务，不要追问）：\n\n' + ans);
      // 回注后进入等待阶段；箭头反转指向原对话
      pair.phase = 'injected';
      pair.state = 'toSrc';
      pair.tkCount = assistantCount(tk);
      // 有明确沉淀段落 → 「总结完成」；无（仅整体思考回注）→「已回注」
      setStatus(pair, concl ? 'done' : 'applied');
      sendTo(src, msg + takeNote(pair));
      toast('已回注沉淀到原对话；原对话可继续任务或直接结束', true);
      return;
    }

    // 初始段：原对话 → 总结师（首轮沉淀请求，或用户在原对话补充内容后送回）
    var userNew = lastUserMsg(src);
    var ans2 = lastAnswer(src);
    if (!userNew && !ans2) { toast('原对话还没有内容，无法传送', false); return; }
    var body = userNew ? userNew : ans2;
    pair.state = 'toTK';
    pair.phase = 'sent';
    pair.tkCount = assistantCount(tk);
    setStatus(pair, 'pending');
    sendTo(tk, '请针对以下内容做任务总结与沉淀（提炼技能方法：这个问题依靠什么方法解决的、下次如何复用该方法/可复用经验/改动清单/遗留事项），最终给出【总结师沉淀】：\n\n' + body + takeNote(pair));
    toast('已送总结师总结（总结中）', true);
  }

  // 回复自动检测：总结师出现新回复 → 判定已出沉淀
  function detectReply(pair) {
    if (pair.status !== 'pending') return;
    var tk = findChat(pair.tkId);
    if (!tk) return;
    var nowCount = assistantCount(tk);
    if (nowCount <= (pair.tkCount || 0)) return;
    var ans = lastAnswer(tk);
    if (!ans) return;
    pair.tkCount = nowCount;
    pair.rounds = (pair.rounds || 0) + 1;
    if (CONCLUSION_RE.test(ans)) {
      // 沉淀已出：不自动反转方向，等用户点击箭头再传话
      pair.phase = 'sent'; // 回复已就绪，点击即回注原对话
      setStatus(pair, 'clarified');
      toast('总结师已给出沉淀结论，点击箭头即可回注原对话', true);
    } else {
      // 还在总结中，保持指向总结师
      setStatus(pair, 'pending');
    }
  }

  function detectSrcModified(pair) {
    if (pair.status !== 'applied' && pair.status !== 'done') return;
    var src = findChat(pair.srcId);
    if (!src) return;
    var nowCount = assistantCount(src);
    if (nowCount <= (pair.srcCount || 0)) return;
    pair.srcCount = nowCount;
    setStatus(pair, 'modified'); // 修改完成
    notifyMinimap(); persist();
    toast('原对话已按策划结论修改完成', true);
  }
  function tick() {
    _rafId = 0;
    try {
      for (var i = pairs.length - 1; i >= 0; i--) {
        var p = pairs[i];
        var src = findChat(p.srcId);
        var tk = findChat(p.tkId);
        if (!p.el || !p.el.isConnected || !src || !tk) {
          if (p.el) p.el.remove();
          pairs.splice(i, 1);
          persist();
          continue;
        }
        detectReply(p); detectSrcModified(p);
        var a = centerOf(src), b = centerOf(tk);
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var lx = mx - 120, ly = my - 36;
        if (p._lx !== lx || p._ly !== ly) {
          p.el.style.left = lx + 'px';
          p.el.style.top = ly + 'px';
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
        var tfBadge = 'rotate(' + (-ang) + 'deg)';
        if (p._tf !== tf) {
          p.el.style.transform = 'none';
          var svg = p.el.querySelector('svg');
          if (svg) {
            svg.style.transformOrigin = '120px 36px';
            svg.style.transition = 'transform .25s';
            svg.style.transform = tf;
          }
          var badge = p.el.querySelector('.ta-badge');
          if (badge) {
            badge.style.transformOrigin = '120px 36px';
            badge.style.transition = 'none';
            badge.style.transform = tfBadge;
          }
          p._tf = tf;
        }
      }
    } finally {
      _rafId = pairs.length ? requestAnimationFrame(tick) : 0;
    }
  }
  var _rafId = 0;
  function ensureLoop() {
    if (!_rafId) _rafId = requestAnimationFrame(tick);
  }
  (function () {
    var _create = create;
  /* 【同步】讨论中箭头点"已汇总"时，同源单箭头跟随反转（状态→applied/已沉淀） */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = ev.detail && ev.detail.srcId;
      pairs.forEach(function (p) {
        if (String(p.srcId) !== String(sid)) return;
        if (p.state !== 'toTK') return;
        p.state = 'toSrc';
        p.phase = 'injected';
        p.tkCount = assistantCount(findChat(p.tkId) || {});
        p.status = 'applied';
        applyStatus(p); persist();
      });
    } catch (e) {}
  });

  /* 【同步】讨论中箭头点"发散"再分发时，同源单箭头跟随反向（状态→pending/总结中） */
  document.addEventListener('zf-multi-scattered', function (ev) {
    try {
      var sid2 = ev.detail && ev.detail.srcId;
      pairs.forEach(function (p) {
        if (String(p.srcId) !== String(sid2)) return;
        if (p.state !== 'toSrc') return;
        p.state = 'toTK';
        p.phase = 'sent';
        p.status = 'pending';
        applyStatus(p); persist();
      });
    } catch (e) {}
  });

    window.ZFSummarizerArrow = {
      create: function (s, q) { var r = _create(s, q); ensureLoop(); notifyMinimap(); return r; },
      getPairs: function () {
        return pairs.map(function (p) {
          return { srcId: p.srcId, tkId: p.tkId, state: p.state, status: p.status };
        });
      }
    };
  })();
  function notifyMinimap() {
    try {
      if (App._minimapDraw) App._minimapDraw();
      else if (App.updateMinimap) App.updateMinimap();
    } catch (e) {}
  }
  setInterval(ensureLoop, 1000);
  (function waitRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var raw = null;
      try { raw = localStorage.getItem('zf_summarizer_pairs'); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if ((hasSaved && anyBox) || tries > 60) {
        clearInterval(timer);
        if (hasSaved) restorePairs();
      }
    }, 1000);
  })();
  // [summarizer-arrow] 总结师琥珀色箭头模块已加载
})();

