/* ============================================================
 * chatbox-thinker-arrow.js —— 策划师紫色方向箭头（复用审核员箭头状态机）
 * 状态：pending(策划中·紫·流动) / clarified(已策划·紫罗兰) / applied(已策划·绿) / failed(失效·灰)
 * 点击箭头：把策划师结论（【策划师结论】行，兼容旧标记【思想家结论】）回注原对话并反转方向
 * 用法：window.ZFThinkerArrow.create(srcChat, thinkerChat)
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFThinkerArrow) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var pairs = [];
  var PURPLE = '#b388ff';
  var VIOLET = '#7c4dff';

  var STATUS = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '策划完成', flow: false },
    pending:   { color: PURPLE, text: '策划中', flow: true },
    clarified: { color: VIOLET, text: '已策划', flow: false },
    applied:   { color: '#00e676', text: '已策划', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };
  var CONCLUSION_RE = /【(?:策划师|思想家)结论】/;

  /* 【自动回收修复】读取数量弹窗勾选的一次性标志（10 分钟内有效），策划师箭头此前从未消费该标志导致勾选无效 */
  function autoGatherOn() {
    /* 【修复】过期从 60 秒放宽到 10 分钟：策划师要先调查项目文件再出结论，响应常超 1 分钟，
       60 秒窗口会导致回复出来时凭证已过期、不自动回收（单窗慢响应必现）。
       防重复由 pair._gatherUsedAt 一次性消费保证，此处放宽不会造成重复回注 */
    try { var t = window._zfAutoGatherNext; return !!(t && (Date.now() - t) < 600000); } catch (e) { return false; }
  }

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
        if (c.indexOf('（策划师素材包') === 0 || c.indexOf('（审核员素材包') === 0) continue;
        if (c.indexOf('这是策划师') === 0 || c.indexOf('原对话有了新进展') === 0) continue;
        if (c.indexOf('请针对以下内容做任务扩展') === 0) continue;
        if (h[i]._guardInject || h[i]._verifyRound || h[i]._thinkerRound) continue;
        var _full = c.length > 3000;
        return _full ? c.slice(0, 3000) + '\n\n【提示】原消息超过 3000 字，已截断，仅保留前 3000 字。' : c;
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

  // 提取策划师最新结论行（【策划师结论】…，兼容旧标记【思想家结论】），无则返回 ''
  function lastConclusion(chat) {
    var ans = lastAnswer(chat);
    if (!ans) return '';
    // 兼容新旧结论标记：【策划师结论】（新）/【思想家结论】（旧）
    var idx = Math.max(ans.lastIndexOf('【策划师结论】'), ans.lastIndexOf('【思想家结论】'));
    if (idx < 0) return '';
    var tail = String(ans).slice(idx);
    var lines = tail.split('\n');
    // 标记所在行；若标记后同行无内容（AI 换行排版），继续收集后续非空行
    var first = (lines[0] || '').trim();
    if (first.length > '【策划师结论】'.length || first.length > '【思想家结论】'.length) return first;
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
    pair.el.title = (pair.question ? '【' + pair.question + '】\n' : '') + '当前状态：' + st.text + '（已策划 ' + rounds + ' 轮）（点击：把策划师结论回注箭头指向的对话）';
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
      localStorage.setItem('zf_thinker_pairs', JSON.stringify(pairs.map(function (p) {
        return { srcId: p.srcId, tkId: p.tkId, state: p.state, status: p.status, phase: p.phase || '', tkCount: p.tkCount || 0, rounds: p.rounds || 0, question: p.question || '' };
      })));
    } catch (e) {}
  }

  function restorePairs() {
    var raw = null;
    try { raw = localStorage.getItem('zf_thinker_pairs'); } catch (e) { return; }
    if (!raw) return;
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { return; }
    if (!arr || !arr.length) return;
    var restored = 0;
    arr.forEach(function (d) {
      var src = findChat(d.srcId), tk = findChat(d.tkId);
      if (!src || !tk) return;
      /* 【防串扰】总结师窗的配对曾误存进本键；恢复时跳过总结师对话，避免总结师窗上多出策划箭头 */
      try { if (tk.el && tk.el._isSummarizerChat) return; } catch (e) {}
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
      toast('已恢复 ' + restored + ' 条策划师箭头（含状态）', true);
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
      '<line class="ta-line" x1="6" y1="36" x2="168" y2="36" stroke="#b388ff" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 10"/>' +
      '<polygon class="ta-head" points="162,6 234,36 162,66" fill="#b388ff" stroke="#d9c2ff" stroke-width="3"/>' +
      '<g class="ta-badge">' +
      '<rect class="ta-badge-rect" x="86" y="20" width="68" height="30" rx="15" fill="#b388ff" opacity="0.95"/>' +
      '<text class="ta-badge-text" x="120" y="41" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a0a2e" font-family="sans-serif">策划中</text>' +
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
          /* 【输入防丢修复】不再在此处无条件清空：成功时 takeNote 内部已清空；失败提前 return 时保留内容，下次再送 */
          onArrowClick(pair);
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
      if (inp && inp.value.trim()) { note = inp.value.trim(); inp.value = ''; pair.note = ''; }
      else if (pair.note && String(pair.note).trim()) { note = String(pair.note).trim(); pair.note = ''; if (inp) inp.value = ''; }
    } catch (e) {}
    return note ? '\n\n【补充说明】\n' + note : '';
  }

  function onArrowClick(pair, fromAuto) {
    var src = findChat(pair.srcId);
    var tk = findChat(pair.tkId);
    if (!src || !tk) { if (pair.el) pair.el.remove(); return; }

    // 状态机（pair.phase）：
    //  - 未送出/已回注完（phase 为空或 'injected'）：点击 → 把原对话最新内容（优先用户补充的修改意见）送策划师扩展
    //  - 'sent'（已送策划师，等回复或继续补料）：点击 → 回注策划师结论/思考到原对话，回到 'injected'
    if (pair.phase === 'sent') {
      // 策划师 → 原对话：回注结论（优先【策划师结论】行，无则整体回复）
      var concl = lastConclusion(tk);
      var ans = lastAnswer(tk);
      if (!ans) { toast('策划师还没有结论，无法回注', false); return; }
      var msg = concl
        ? ('（策划方案·陈列）\n这是策划师回笼的方案结论，仅供汇总对比与用户裁决，【禁止直接开工】：在用户明确下达开工指令（主对话执行或派施工队）之前，不得修改任何代码文件、不得调用 plan_batch.claim 执行计划。请先做多方案对比陈列（各自目标/涉及文件/风险），并标出各方案末行的 plan_id 供派单。\n【参数已确认】以下结论中的参数与口径视为用户已确认，严禁再次 ask_user 追问这些信息：\n\n' + concl)
        : ('（策划方案·陈列）\n这是策划师的扩展思考，仅供参考对比，【禁止直接开工】——用户未明确下令前不得改代码文件。请参考并把任务清晰化后继续（其中已明确的参数视为已确认，不要重复追问）：\n\n' + ans);
      /* 【v33 定稿门禁】在陈列消息中附加落盘铁律 + 定稿状态提示：策划案 md 是唯一任务真源，主对话在用户定稿前禁止改业务代码 */
      msg += '\n【落盘与定稿规则】① 若上述结论含「【策划案路径：…】」标记：请 read_file 读取该 md 存为「待定稿策划案」，向用户陈列要点并等待定稿（用户说「定稿/开工/按方案做」等明确指令才放行）；未定稿前禁止修改任何业务代码文件。② 若结论没有路径标记：请提示策划师补落盘 md 并在结论行末尾补「【策划案路径：…】」标记后再定稿。③ 定稿后：施工派单时把该 md 路径随任务上下文带给施工队（施工队按策划书施工）。';
      // 附完整思考折叠段（有结论时结论行在前，思考全文折叠在后，避免遗漏上下文）
      if (concl && ans && ans !== concl) {
        msg += '\n\n<details>\n<summary>📄 策划师完整思考（点击展开）</summary>\n\n' + ans.slice(0, 20000) + '\n\n</details>';
      }
      // 回注后进入等待用户补充阶段；箭头反转指向原对话，用户在原对话补充后点击即送回策划师
      pair.phase = 'injected';
      pair.state = 'toSrc';
      pair.tkCount = assistantCount(tk);
      // 有明确结论 → 「策划完成」；无结论（仅整体思考回注）→「已回注」
      setStatus(pair, concl ? 'done' : 'applied');
      sendTo(src, msg + takeNote(pair));
      toast('已回注原对话；在原对话补充意见后点击箭头即可送回策划师', true);
      /* 【死代码移除】主消息已无条件消费 takeNote，fromAuto 追加分支永不触发 */
      return;
    }

    // 初始段：原对话 → 策划师（首轮扩展，或用户在原对话补充修改意见后送回）
    var userNew = lastUserMsg(src);
    var ans2 = lastAnswer(src);
    if (!userNew && !ans2) { toast('原对话还没有内容，无法传送', false); return; }
    var body = userNew ? userNew : ans2;
    pair.state = 'toTK';
    pair.phase = 'sent';
    pair.tkCount = assistantCount(tk);
    setStatus(pair, 'pending');
    sendTo(tk, '请针对以下内容做任务策划与澄清（多轮追问也可），最终给出【策划师结论】：\n\n' + body + takeNote(pair));
    /* 【死代码移除】主消息已无条件消费 takeNote，fromAuto 追加分支永不触发 */
    toast('已送策划师策划（策划中）', true);
  }

  // 回复自动检测：策划师出现新回复 → 判定已澄清/继续扩展；【自动回收】结论已出 2 秒后自动回注原对话
  function detectReply(pair) {
    if (pair.status !== 'pending') return;
    var tk = findChat(pair.tkId);
    if (!tk) return;
    /* 【v27 卡顿防误判】策划师仍在发送/流式/重试中（isSending=true）时，assistantCount 统计到的
       可能只是半截流式内容甚至失败重试前的残影 → 此时绝不能判定"已回复"，否则网络卡顿会导致
       策划师提前返回主对话。必须等 isSending=false（本轮真正收尾）再判定 */
    if (tk.isSending) return;
    var nowCount = assistantCount(tk);
    if (nowCount <= (pair.tkCount || 0)) return;
    var ans = lastAnswer(tk);
    if (!ans) return;
    pair.tkCount = nowCount;
    pair.rounds = (pair.rounds || 0) + 1;
    if (CONCLUSION_RE.test(ans)) {
      // 结论已出：不自动反转方向，等用户点击箭头再传话
      pair.phase = 'sent'; // 回复已就绪，点击即回注原对话
      setStatus(pair, 'clarified');
      toast('策划师已给出结论，点击箭头即可传回原对话', true);
      /* 【自动回收修复】数量弹窗勾选了自动回收 → 自动回注原对话。
         【v22 全员策划齐步回收】不再各自回复各自回注（一个个返回）；
         标记本 pair 已回复（_replied），由 tick 里的 tryGroupAutoGather 统一判断：
         同一源对话、同一张自动回收凭证下派出的全部策划窗都给出结论（= 全部策划结束）后，
         优先调用收口汇总箭头 ZFConvergeArrow.gatherFor(srcId) 把所有策划结论汇总成一条一次性回注；
         凭证将过期（9.5 分钟）仍有策划窗未出结论时，降级为逐个回注已完成部分（策划师响应常超 1 分钟，窗口与 autoGatherOn 的 10 分钟一致） */
      pair._replied = true;
    } else {
      // 还在多轮策划中，保持指向策划师
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
  /* 【v22 全员策划齐步回收】按源对话分组检查：同一源对话、同一张自动回收凭证派出的全部策划箭头都已给出结论（_replied），
     才统一触发回注。优先走收口汇总箭头 ZFConvergeArrow.gatherFor(srcId)（所有策划结论汇总成一条回注）；
     凭证 9.5 分钟到期仍有窗口未出结论 → 降级逐个回注已完成部分，避免结论静默丢失 */
  var _tkGroupGatherTs = 0;
  /* 【v23】检测该源对话当前是否存在收口箭头（成员≥2时才会创建） */
  function tk_hasConverge(srcId) {
    try {
      var g = window.ZFConvergeArrow && window.ZFConvergeArrow.getPairs ? window.ZFConvergeArrow.getPairs() : [];
      for (var i = 0; i < g.length; i++) if (String(g[i].srcId) === String(srcId)) {
        /* 【v24 修复·单窗不回收】membersOf 把策划+审核窗混算成员数，只派 1 个策划但源下残留 1 个
           审核窗时也会创建收口箭头 → 此处误判"有收口"，走 gatherFor 却永远等不到就绪（收口要等
           全部成员 sent），干等 9.5 分钟兜底，表现为"单个策划不自动回收"。
           因此必须再校验：同角色（策划师）存活成员 ≥2 收口箭头才真正可用 */
        var boxes = (typeof App !== 'undefined' && App.chatBoxes) || [];
        var sameRole = 0;
        boxes.forEach(function (c) {
          if (c && c.el && c.el._isThinkerChat && String(c.el._thinkerSrcId) === String(srcId)) sameRole++;
        });
        if (sameRole >= 2) return true;
      }
    } catch (e) {}
    return false;
  } // 防重复：一次凭证只触发一批
  function tk_checkConsumed(ts) {
    if (!ts) return true;
    return _tkGroupGatherTs === ts;
  }
  function tryGroupAutoGather() {
    if (!autoGatherOn()) return;
    var ts = window._zfAutoGatherNext;
    if (tk_checkConsumed(ts)) return;
    var t = Date.now();
    if (t - ts < 1000) return; // 1 秒防抖，等流式稳定
    var groups = {};
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p.el || !p.el.isConnected) continue;
      if (p._gatherTs === ts) continue; // 本凭证已消费
      var created = p._createdAt || 0;
      if (created && ts - created > 600000) continue; // 非本凭证派出的旧箭头，不参与本次回收
      var g = groups[p.srcId] || (groups[p.srcId] = []);
      g.push(p);
    }
    for (var srcId in groups) {
      var arr = groups[srcId];
      if (!arr.length) continue;
      /* 策划结束门槛：该源对话下本凭证的全部策划窗都已出结论（_replied，detectReply 在结论分支设置） */
      /* 【v26 按用户要求：无兜底无中途返回】删除 9.5 分钟 expired 超时兜底——
         只要还有策划窗没出结论就继续等（宁可一直挂着），全员 _replied 才回注 */
      var pending = arr.filter(function (q) { return !q._replied; }).length;
      if (pending > 0) continue; // 还有策划窗没出结论，继续等，绝不中途返回
      /* 【v23 单角色即时回收】收口箭头只在成员≥2时创建；只剩1个策划窗时 gatherFor 永远失败，
         现在检测该源对话没有收口箭头 → 全部出结论后立即逐个回注 */
      if (!tk_hasConverge(srcId)) {
        var fell1 = 0;
        arr.forEach(function (p) {
          try { if (p._replied && p.el && p.el.isConnected && typeof onArrowClick === 'function') { onArrowClick(p, true); fell1++; } } catch (eF) {}
        });
        arr.forEach(function (p) { p._gatherTs = ts; p._replied = false; });
        if (fell1) { _tkGroupGatherTs = ts; toast('♻ 策划已结束，自动回注 ' + fell1 + ' 条结论', true); }
        continue;
      }
      var ok = false;
      try { ok = window.ZFConvergeArrow && typeof window.ZFConvergeArrow.gatherFor === 'function' && window.ZFConvergeArrow.gatherFor(srcId); } catch (eG) {}
      if (!ok) continue; // 收口箭头未就绪（可能还在判定），下一帧再试，无超时兜底
      arr.forEach(function (p) { p._gatherTs = ts; p._replied = false; });
      _tkGroupGatherTs = ts;
      toast('♻ 全员策划结束，已通过收口箭头一起回注原对话', true);
    }
  }

  function tick() {
    _rafId = 0;
    try {
      for (var i = pairs.length - 1; i >= 0; i--) {
        var p = pairs[i];
        var src = findChat(p.srcId);
        var tk = findChat(p.tkId);
        if (!p.el) { pairs.splice(i, 1); persist(); continue; }
        /* 【撤销保箭头】子对话/源对话临时关闭（含关闭后撤销恢复）时只隐藏箭头，不删配对：
           对话恢复后箭头连同状态（策划中/已策划/轮次等）原样带回来 */
        if (!src || !tk) {
          if (p.el.style.display !== 'none') { p.el.style.display = 'none'; persist(); }
          continue;
        }
        if (p.el.style.display === 'none' || !document.body.contains(p.el)) {
          document.body.appendChild(p.el);
          p.el.style.display = '';
          applyStatus(p);
          persist();
          try { toast('箭头已随对话恢复（状态保留）', true); } catch (eT) {}
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
      if (pairs.length) tryGroupAutoGather(); /* 【v22 全员策划齐步回收】按源对话分组等全部策划窗出结论后统一回注 */
      _rafId = pairs.length ? requestAnimationFrame(tick) : 0;
    }
  }
  var _rafId = 0;
  function ensureLoop() {
    if (!_rafId) _rafId = requestAnimationFrame(tick);
  }
  (function () {
    var _create = create;
  /* 【同步】讨论中箭头点"已汇总"时，同源单箭头跟随反转（状态→applied/已策划） */
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

  /* 【同步】讨论中箭头点"发散"再分发时，同源单箭头跟随反向（状态→pending/策划中） */
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

    window.ZFThinkerArrow = {
      create: function (s, q) { var r = _create(s, q); ensureLoop(); notifyMinimap(); return r; },
      getPairs: function () {
        return pairs.map(function (p) {
          return { srcId: p.srcId, tkId: p.tkId, state: p.state, status: p.status };
        });
      },
      /* 【输入防丢】供收口箭头回收时取走该策划窗单体箭头输入框里的补充文字（取走即清空） */
      takeNoteFor: function (boxId) {
        for (var i = 0; i < pairs.length; i++) {
          var p = pairs[i];
          if (String(p.tkId) === String(boxId) && p.el && p.el.isConnected) return takeNote(p);
      /* 【id 漂移兜底】persist 恢复/箭头重建后 tkId 可能与成员 id 不一致：
         先按 srcId 匹配；仍取不到时，回退到"唯一还留着补充内容的箭头"，确保文字绝不丢 */
      if (String(p.srcId) === String(boxId) && p.el && p.el.isConnected) { var _n = takeNote(p); if (_n) return _n; }
    }
    /* 兜底仅在 boxId 完全未命中任何 pair、且全模块只有唯一一个带内容的箭头时启用，
       防止多窗场景把别的成员框内容"抢"到本窗名下 */
    var _hitAny = false;
    for (var k = 0; k < pairs.length; k++) {
      var pk = pairs[k];
      if (pk.el && pk.el.isConnected && (String(pk.tkId) === String(boxId) || String(pk.srcId) === String(boxId))) { _hitAny = true; break; }
    }
    if (!_hitAny) {
      var _cands = [];
      for (var j = 0; j < pairs.length; j++) {
        var q = pairs[j];
        if (!q.el || !q.el.isConnected) continue;
        var _n2 = (function (pp) { try { var ip = pp.el && pp.el.querySelector('.ta-note input'); return (ip && ip.value.trim()) || (pp.note && String(pp.note).trim()) || ''; } catch (e) { return ''; } })(q);
        if (_n2) _cands.push(q);
      }
      if (_cands.length === 1) return takeNote(_cands[0]);
    }
        return '';
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
      try { raw = localStorage.getItem('zf_thinker_pairs'); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if ((hasSaved && anyBox) || tries > 60) {
        clearInterval(timer);
        if (hasSaved) restorePairs();
      }
    }, 1000);
  })();
  // [thinker-arrow] 策划师紫色箭头模块已加载
})();

