/* ============================================================
 * chatbox-verify-arrow.js —— 审核员方向箭头（v2.0 状态机版）
 * 功能：
 * 1) 箭头比闪电线（stroke 3）大 3 倍：线宽 9、三角头约 54px；
 * 2) 图层 z-index 5000，低于对话框（9998）及设置面板等（10000+）；
 * 3) 点「审核员」创建新对话时，自动在两框中间生成箭头；
 * 4) 点击箭头：在审核员/原对话之间传送答案并反转方向；
 * 5) 【v2 新增】5 态状态机 + 颜色 + 徽标 + 回复自动检测：
 *    pending(审核中·青) / revising(待修改·橙) / reviewing(复审中·青·流动)
 *    / passed(已通过·绿) / failed(失效·灰)
 *    审核员出现新回复时自动判定：含通过语义 → passed，否则 → revising 并自动反转
 * 6) getPairs() 携带 status，小地图按状态上色
 * 用法：window.ZFVerifyArrow.create(srcChat, qcChat)
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFVerifyArrow) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var pairs = []; // { srcId, qcId, el, state, status, qcCount, rounds }

  // 状态定义：颜色 / 徽标文字 / 是否流动动画
  var STATUS = {
    pending:   { color: '#00e5ff', text: '审核中',  flow: true },
    revising:  { color: '#ffab40', text: '待修改',  flow: false },
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    reviewing: { color: '#00e5ff', text: '复审中',  flow: true },
    passed:    { color: '#00e676', text: '已通过',  flow: false },
    failed:    { color: '#9e9e9e', text: '已失效',  flow: false }
  };
  // 审核员回复含这些语义 → 判定通过
  var PASS_RE = /(✅|通过|合格|没问题|符合要求|可以交付|验收通过|approved|passed|合格品)/i;
  // 明确不通过语义（优先级高于 PASS_RE 命中时仍以 PASS_RE 为准？否——不通过词优先，避免"没通过"误判）
  var FAIL_RE = /(不通过|未通过|有问题|需要修改|存在(问题|错误)|不合格|未达标|⚠️|❌)/i;

  /* 【自动回收修复】读取数量弹窗勾选的一次性标志（60 秒内有效），审核员箭头此前从未消费该标志导致勾选无效 */
  function autoGatherOn() {
    try { var t = window._zfAutoGatherNext; return !!(t && (Date.now() - t) < 600000); } catch (e) { return false; }
  }

  // 【v7】清洗问题文本：剥掉"【当前项目上下文】…---上下文结束---"等注入包装与各种前缀，只留用户真正的问题
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
      // 3) 去掉块引用/转发标记前缀，如"（某对话 的用户）""xxx @yyy"
      c = c.replace(/^[（(][^（）()]*[)）]\s*/g, '');
      c = c.replace(/^@[^\s@]{1,20}\s*/g, '');
      // 4) 去掉常见前缀标记（标签、徽章、引导语等）
      c = c.replace(/^(【[^】]{1,20}】|#[^\s#]{1,20}\s*|\[[^\]]{1,20}\])\s*/g, '');
      return c.trim();
    } catch (e) { return c; }
  }

  // 【v4 新增】取原对话第一次用户提问（跳过注入类消息），超长截断，用于箭头上方问题标签
  function firstQuestion(chat) {
    try {
      var h = (chat && chat.history) || [];
      for (var i = 0; i < h.length; i++) {
        if (h[i].role !== 'user') continue;
        var c = String(h[i].content || '').trim();
        if (!c) continue;
        if (c.indexOf('（审核员素材包') === 0 || c.indexOf('【审核员任务】') === 0 || c.indexOf('（质检员素材包') === 0 || c.indexOf('【质检员任务】') === 0) continue; // 跳过素材包注入（含旧版「质检员」前缀兼容）
        // 【v5】扩展注入形态过滤：系统/守卫类注入文本（不带标志位时按内容特征兜底）
        if (/^(【?(系统|系统提示|守卫|安全|注入)|\[?(SYSTEM|GUARD|INJECT)\b)/i.test(c)) continue;
        if (/_guardInject|_verifyRound|_continueRound|_systemInject|_inject/.test(JSON.stringify(h[i]).slice(0, 200))) continue;
        if (h[i]._guardInject || h[i]._verifyRound || h[i]._continueRound) continue;
        // 【v7】清洗注入/包装前缀，只保留用户真正的问题文本
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

  function assistantCount(chat) {
    if (!chat || !chat.history) return 0;
    var n = 0;
    for (var i = 0; i < chat.history.length; i++) {
      if (chat.history[i].role === 'assistant' && String(chat.history[i].content || '').trim()) n++;
    }
    return n;
  }

  // 与审核员素材包发送链路完全一致：addMsg + history.push + sendToModel
  function sendTo(chat, text) {
    try {
      App.addMsg(chat.el, text, 'user', chat.modelId);
      chat.history.push({ role: 'user', content: text });
      App.sendToModel(chat.el, chat);
    } catch (e) {
      try { Store.addLog('error', chat.id, 'verify-arrow', '发送失败: ' + e.message); } catch (e2) {}
    }
  }

  function toast(msg, ok) {
    try { if (App._stepToast) App._stepToast(msg, !!ok); } catch (e) {}
  }

  function centerOf(chat) {
    var r = chat.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ===== 状态渲染：颜色 + 徽标 + 流动动画 =====
  function applyStatus(pair) {
    var st = STATUS[pair.status] || STATUS.pending;
    var svg = pair.el && pair.el.querySelector('svg');
    if (!svg) return;
    var line = svg.querySelector('.va-line');
    var head = svg.querySelector('.va-head');
    var badgeRect = svg.querySelector('.va-badge-rect');
    var badgeText = svg.querySelector('.va-badge-text');
    if (line) line.setAttribute('stroke', st.color);
    if (head) {
      head.setAttribute('fill', st.color);
      head.setAttribute('stroke', st.color);
    }
    if (badgeRect) badgeRect.setAttribute('fill', st.color);
    // 轮数显示：第N轮（N≥1 时加宽徽标），例如「已通过·第2轮」
    var rounds = pair.rounds || 0;
    var label = st.text + (rounds > 0 ? '·第' + rounds + '轮' : '');
    if (badgeText) {
      badgeText.textContent = label;
      if (badgeRect) {
        // 动态宽度：优先用 getComputedTextLength() 实测，半角/全角混排都精确；取不到时退回估宽
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
    // 流动动画：进行中状态虚线流动
    if (st.flow) {
      line.setAttribute('stroke-dasharray', '14 10');
      line.classList.add('va-flow');
    } else {
      line.removeAttribute('stroke-dasharray');
      line.classList.remove('va-flow');
    }
    // 整体辉光颜色跟随状态
    pair.el.style.filter = 'drop-shadow(0 0 8px ' + st.color + ')';
    // 【v4】问题标签边框/辉光跟随状态色，一眼可读
    // 悬停提示同步详细状态
    pair.el.title = (pair.question ? '【' + pair.question + '】\n' : '') + '当前状态：' + st.text + '（已审核 ' + rounds + ' 轮）（点击：把答案传给箭头指向的对话）';
    pair.el.dataset.status = pair.status;
  }

  function setStatus(pair, status) {
    pair.status = status;
    applyStatus(pair);
    persist();
    notifyMinimap();
  }

  // ===== 持久化：配对存 localStorage，重启/刷新后自动恢复箭头 =====
  function persist() {
    try {
      localStorage.setItem('zf_verify_pairs', JSON.stringify(pairs.map(function (p) {
        return { srcId: p.srcId, qcId: p.qcId, state: p.state, status: p.status, qcCount: p.qcCount || 0, rounds: p.rounds || 0, question: p.question || '' };
      })));
    } catch (e) {}
  }
  function restorePairs() {
    var raw = null;
    try { raw = localStorage.getItem('zf_verify_pairs'); } catch (e) { return; }
    if (!raw) return;
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { return; }
    if (!arr || !arr.length) return;
    var restored = 0;
    arr.forEach(function (d) {
      var src = findChat(d.srcId), qc = findChat(d.qcId);
      if (!src || !qc) return;
      var p = create(src, qc);
      if (p) {
        p.state = d.state === 'toSrc' ? 'toSrc' : 'toQC';
        p.status = STATUS[d.status] ? d.status : 'pending';
        p.qcCount = d.qcCount || assistantCount(qc);
        p.rounds = d.rounds || 0;
        // 【v4】恢复时回填问题标签（有记录用记录，无记录重新从原对话历史提取）
        p.question = d.question || firstQuestion(src);
        applyStatus(p);
        restored++;
      }
    });
    if (restored) {
      ensureLoop();
      notifyMinimap();
      toast('已恢复 ' + restored + ' 条审核员箭头（含状态）', true);
      persist(); // 恢复覆盖状态后立即写回，防止下次刷新回退默认值
    }
  }

  function create(srcChat, qcChat) {
    if (!srcChat || !qcChat || !srcChat.el || !qcChat.el) return;
    // 同一对已存在则不重复建
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].srcId === srcChat.id && pairs[i].qcId === qcChat.id && pairs[i].el && pairs[i].el.isConnected) return pairs[i];
    }
    var el = document.createElement('div');
    el.className = 'zf-verify-arrow';
    /* 【v21】删除重复的提前 pair 声明：pair 统一在下方正式创建（L309），
       事件闭包经 var 提升引用同一对象，避免游离引用 */
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:5000;cursor:pointer;pointer-events:auto;' +
      'filter:drop-shadow(0 0 8px rgba(0,229,255,.9));user-select:none;transition:transform .25s;';
    el.innerHTML =
      '<svg width="240" height="72" viewBox="0 0 240 72" xmlns="' + SVG_NS + '" style="overflow:visible">' +
      '<line class="va-line" x1="6" y1="36" x2="168" y2="36" stroke="#00e5ff" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 10"/>' +
      '<polygon class="va-head" points="162,6 234,36 162,66" fill="#00e5ff" stroke="#7ff3ff" stroke-width="3"/>' +
      '<g class="va-badge">' +
      '<rect class="va-badge-rect" x="86" y="20" width="68" height="30" rx="15" fill="#00e5ff" opacity="0.95"/>' +
      '<text class="va-badge-text" x="120" y="41" text-anchor="middle" font-size="18" font-weight="bold" fill="#00121a" font-family="sans-serif">审核中</text>' +
      '</g>' +
      '<style>.va-flow{animation:vaFlow 1s linear infinite;}@keyframes vaFlow{to{stroke-dashoffset:-24;}}</style>' +
      '</svg>' +
      // 【v3 新增】补充要求输入框：平时隐藏，悬停箭头浮现；内容随下一次点击箭头一起送达
      '<div class="va-note" style="position:absolute;left:10px;top:84px;width:220px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:2;">' +
      '<input type="text" placeholder="✎ 补充新要求（点箭头时一并送达）" style="width:100%;box-sizing:border-box;background:rgba(8,24,34,.92);border:1px solid rgba(0,229,255,.55);border-radius:10px;color:#eaffff;font-size:12px;padding:6px 9px;outline:none;box-shadow:0 0 12px rgba(0,229,255,.35);" />' +
      '</div>';
    document.body.appendChild(el);

    // 输入框交互：悬停浮现 / 离开隐藏（输入中保持显示）/ 点击不触发传送 / Enter 快捷传送
    (function () {
      var note = el.querySelector('.va-note');
      var inp = el.querySelector('.va-note input');
      if (!note || !inp) return;
      inp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' && inp.value.trim()) {
          e.preventDefault();
          onArrowClick(pair);                   // 先触送上/送达（成功时 takeNote 内部已清空 note；失败提前 return 时保留内容，下次再送）
          hideNow();                            // 最后隐藏输入框
        } else if (e.key === 'Enter') {
          e.preventDefault();
          hideNow();                            // 空内容回车也隐藏
        }
      });
      // 点击箭头/输入框以外的任何地方（如对话框）：隐藏输入框
      document.addEventListener('mousedown', function (e) {
        if (!el.contains(e.target) && !note.contains(e.target)) hideNow();
      });
      inp.addEventListener('input', function () { pair.note = inp.value; });
      // 【v7 修复】输入框在容器外部(top:84px)，鼠标移向输入框会触发 mouseleave 被立即隐藏，导致无法点击输入。
      // 改为延时 350ms 隐藏，且鼠标进入输入框/输入框聚焦时取消隐藏，保证可点击输入；输入框本身不随箭头旋转。
      var hideTimer = null;
      function showNote() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        note.style.opacity = '1'; note.style.pointerEvents = 'auto';
      }
      function hideNote() {
        if (document.activeElement === inp) return; // 正在输入时不隐藏
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
      note.addEventListener('mouseenter', showNote);   // 移入输入框：取消隐藏
      note.addEventListener('mouseleave', hideNote);
      inp.addEventListener('focus', showNote);
      inp.addEventListener('blur', hideNote);
    })();

    var pair = { srcId: srcChat.id, qcId: qcChat.id, el: el, state: 'toQC', status: 'pending', qcCount: assistantCount(qcChat), rounds: 0, _createdAt: Date.now() };
    pair.question = firstQuestion(srcChat); // 【v4】原对话第一次提问，用于问题标签
    pairs.push(pair);
    applyStatus(pair);

    persist();

    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      onArrowClick(pair);
    });

    return pair;
  }

  // 【v3 新增】取走箭头输入框中的补充要求（有内容时附在消息末尾并清空输入框）
  function takeNote(pair) {
    var note = '';
    try {
      var inp = pair.el && pair.el.querySelector('.va-note input');
      if (inp && inp.value.trim()) { note = inp.value.trim(); inp.value = ''; pair.note = ''; }
      else if (pair.note && String(pair.note).trim()) { note = String(pair.note).trim(); pair.note = ''; if (inp) inp.value = ''; }
    } catch (e) {}
    return note ? '\n\n【补充新要求】\n' + note : '';
  }

  function onArrowClick(pair, fromAuto) {
    var src = findChat(pair.srcId);
    var qc = findChat(pair.qcId);
    if (!src || !qc) { if (pair.el) pair.el.remove(); return; }

    if (pair.state === 'toQC') {
      // 审核员 → 原对话：复制审核员答案给原对话
      var ans = lastAnswer(qc);
      if (!ans) { toast('审核员还没有答案，无法传送', false); return; }
      pair.state = 'toSrc';
      pair.srcCount = assistantCount(src); // 基线：检测原对话修改完成
      setStatus(pair, 'revising'); // 待原对话修改
      sendTo(src, '这是审核员给你的建议你去改一下：\n\n' + ans + takeNote(pair));
      toast('已把审核员的建议发给原对话（待修改）', true);
    } else {
      // 原对话 → 审核员：把原对话改好的答案发给审核员复审
      var ans2 = lastAnswer(src);
      if (!ans2) { toast('原对话还没有答案，无法传送', false); return; }
      pair.state = 'toQC';
      pair.qcCount = assistantCount(qc); // 记录发送前审核员回复数，用于检测新回复
      setStatus(pair, 'reviewing'); // 复审中
      sendTo(qc, '他已经改好了请审核员再次审核：\n\n' + ans2 + takeNote(pair));
      toast('已发给审核员复审（复审中）', true);
    }
  }

  // ===== 回复自动检测：审核员出现新回复时判定通过/待改 =====
  function detectReply(pair) {
    if (pair.status !== 'reviewing' && pair.status !== 'pending') return;
    var qc = findChat(pair.qcId);
    if (!qc) return;
    /* 【v27 卡顿防误判】子对话仍在发送/流式/重试中（isSending=true）时，assistantCount 统计到的
       可能只是半截流式内容甚至失败重试前的残影 → 此时绝不能判定"已回复"，否则网络卡顿会导致
       审核员/策划师提前返回主对话。必须等 isSending=false（本轮真正收尾）再判定 */
    if (qc.isSending) return;
    var nowCount = assistantCount(qc);
    if (nowCount <= (pair.qcCount || 0)) return; // 还没有新回复
    // 新回复已生成且不再是流式占位（内容非空才算，assistantCount 已过滤空）
    var ans = lastAnswer(qc);
    if (!ans) return;
    pair.qcCount = nowCount;
    pair.rounds = (pair.rounds || 0) + 1; // 质检轮数 +1（每次审核员新回复算一轮）
    // 【人工驱动版】不再自动判定通过/待改、不自动反转方向；
    // 审核员出现新回复后仅提示，等用户点击箭头手动传话（点击即按当前方向传话）
    var ansCheck = String(ans).replace(/没有问题/g, '');
    var hasFail = FAIL_RE.test(ansCheck) && !PASS_RE.test(ans);
    if (!hasFail) { setStatus(pair, 'passed'); } else { setStatus(pair, 'revising'); }
    notifyMinimap(); persist();
    toast(hasFail ? '审核员已回复（指出问题），点击箭头把建议传回原对话' : '审核员已回复，点击箭头即可传话', !hasFail);
    /* 【自动回收修复】数量弹窗勾选了自动回收 → 2 秒防抖后自动点击箭头回注。
       【v18 多角色全回收】不再全局置零 _zfAutoGatherNext（单值标志先到先消费导致其余角色永远不回收）；
       改为按时间戳凭证各消费一次：pair._gatherUsedAt 记录已消费的时间戳，同一时间戳不重复触发，60 秒后自然过期 */
    /* 【v19 全员审核齐步回收】不再各自回复各自回注（一个个返回）；
       标记本 pair 已回复，由 tick 里的 tryGroupAutoGather 统一判断：
       同一源对话、同一张自动回收凭证下的全部审核窗都回复完毕（= 全部审核结束）后，
       才一起自动点击箭头批量回注原对话；凭证将过期（9.5 分钟）仍有窗口未回时，只回收已完成部分 */
    pair._replied = true; //【修复】标记必须挂在 pair 对象上，齐步回收 L431/442 判断的是 q._replied/p._replied；此前误写为局部变量 var _replied 导致标记失效、自动回收不触发
  }

  // 位置/方向随对话移动持续更新（requestAnimationFrame 逐帧跟随，平移/缩放不再滞后）
  function detectSrcModified(pair) {
    if (pair.status !== 'revising') return;
    var src = findChat(pair.srcId);
    if (!src) return;
    var nowCount = assistantCount(src);
    if (nowCount <= (pair.srcCount || 0)) return;
    pair.srcCount = nowCount;
    setStatus(pair, 'modified'); // 修改完成
    notifyMinimap(); persist();
    toast('原对话已修改完成，点击箭头可发审核员复审', true);
  }
  /* 【v19 全员审核齐步回收】按源对话分组检查：同一源对话派出的全部审核员箭头都已回复（_replied），
     才统一触发回注（每个箭头各自点击一次 onArrowClick，把各自审核结论送回原对话），一次批量、不先后触发 */
  var _groupGatherTs = 0; // 防重复：一次凭证只触发一批
  /* 【v23】检测该源对话当前是否存在收口箭头（成员≥2时才会创建） */
  function p_hasConverge(srcId) {
    try {
      var g = window.ZFConvergeArrow && window.ZFConvergeArrow.getPairs ? window.ZFConvergeArrow.getPairs() : [];
      for (var i = 0; i < g.length; i++) if (String(g[i].srcId) === String(srcId)) {
        /* 【v26 修复·单窗不回收】membersOf 把策划+审核窗混算成员数，只派 1 个审核但源下残留 1 个
           策划窗时也会创建收口箭头 → 此处误判"有收口"，走 gatherFor 却永远等不到就绪，干等 9.5
           分钟兜底，表现为"单个审核不自动回收"。必须再校验：同角色（审核员）存活成员 ≥2 才算有收口 */
        var boxes = (typeof App !== 'undefined' && App.chatBoxes) || [];
        var sameRole = 0;
        boxes.forEach(function (c) {
          if (c && c.el && c.el._isQcChat && String(c.el._qcSrcId) === String(srcId)) sameRole++;
        });
        if (sameRole >= 2) return true;
      }
    } catch (e) {}
    return false;
  }
  /* 【v20 收口箭头驱动回收】自动回收不再挨个点击各审核箭头（一个个返回），
     而是等该源对话下全部审核窗都回复完毕（= 全部审核结束）后，
     调用收口汇总箭头的 ZFConvergeArrow.gatherFor(srcId)，等价于用户点一下最高的收口箭头：
     所有审核结论汇总成一条一次性回注原对话 */
  function tryGroupAutoGather() {
    if (!autoGatherOn()) return;
    var ts = window._zfAutoGatherNext;
    if (p_checkConsumed(ts)) return;
    var t = Date.now();
    if (t - ts < 1000) return; // 1 秒防抖，等流式稳定
    // 按源对话分组：本凭证（60 秒内）创建的全部审核箭头
    var groups = {};
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p.el || !p.el.isConnected) continue;
      if (p._gatherTs === ts) continue; // 本凭证已消费
      var created = p._createdAt || 0;
      if (created && ts - created > 600000) continue; // 非本凭证派出的（旧箭头），不参与本次回收
      var g = groups[p.srcId] || (groups[p.srcId] = []);
      g.push(p);
    }
    for (var srcId in groups) {
      var arr = groups[srcId];
      if (!arr.length) continue;
      // 审核结束门槛：该源对话下本凭证的全部审核窗都已回复
      /* 【v26 按用户要求：无兜底无中途返回】删除 9.5 分钟 expired 超时兜底——
         只要还有审核窗没回复完就继续等（宁可一直挂着），全员 _replied 才回注 */
      var pending = arr.filter(function (q) { return !q._replied; }).length;
      if (pending > 0) continue; // 还有审核窗没回复完，继续等，绝不中途返回
      /* 【v23 单角色即时回收】收口箭头只在成员≥2时创建；只剩1个审核窗时 gatherFor 永远失败，
         现在检测该源对话没有收口箭头 → 全部回复后立即逐个回注 */
      if (!p_hasConverge(srcId)) {
        var fell1 = 0;
        arr.forEach(function (p) {
          try { if (p._replied && p.el && p.el.isConnected && typeof onArrowClick === 'function') { onArrowClick(p, true); fell1++; } } catch (eF) {}
        });
        arr.forEach(function (p) { p._gatherTs = ts; p._replied = false; });
        if (fell1) { _groupGatherTs = ts; if (typeof toast === 'function') toast('♻ 审核已结束，自动回注 ' + fell1 + ' 条结论', true); }
        continue;
      }
      var ok = false;
      try { ok = window.ZFConvergeArrow && typeof window.ZFConvergeArrow.gatherFor === 'function' && window.ZFConvergeArrow.gatherFor(srcId); } catch (eG) {}
      /* 【v25 简化】不再传 allowPartial：v11 gatherFor 已去掉 memberCounts 自判，
         时机完全由上方 pending===0 全员 _replied 门槛保证，gatherFor 只按位置选最后一个就绪箭头 */
      if (!ok) continue; // 收口箭头未就绪（可能还在判定），下一帧再试，无超时兜底
      arr.forEach(function (p) { p._gatherTs = ts; p._replied = false; });
      _groupGatherTs = ts;
      if (typeof toast === 'function') toast('♻ 全员审核结束，已通过收口箭头一起回注原对话', true);
    }
  }
  function p_checkConsumed(ts) {
    if (!ts) return true;
    if (_groupGatherTs === ts) return true;
    return false;
  }

  function tick() {
    _rafId = 0; // 每帧先清零，异常中断后 ensureLoop 兜底仍可重启
    try {
    for (var i = pairs.length - 1; i >= 0; i--) {
      var p = pairs[i];
      var src = findChat(p.srcId);
      var qc = findChat(p.qcId);
      if (!p.el) { pairs.splice(i, 1); persist(); continue; }
      /* 【撤销保箭头】审核员子对话/源对话临时关闭（含撤销恢复）时只隐藏箭头，不删配对：
         对话恢复后箭头连同状态（审核中/待修改/轮次等）原样带回来 */
      if (!src || !qc) {
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
    }
    tryGroupAutoGather(); // 【v19】每帧检查：全员审核结束后批量回注
    for (var i = pairs.length - 1; i >= 0; i--) {
      var p = pairs[i];
      /* 【撤销保箭头】隐藏中的箭头（对话临时关闭）跳过位置更新，等恢复后再算 */
      if (!p.el || p.el.style.display === 'none' || !document.body.contains(p.el)) continue;
      var src = findChat(p.srcId);
      var qc = findChat(p.qcId);
      if (!src || !qc) continue;
      var a = centerOf(src), b = centerOf(qc);
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var lx = mx - 120, ly = my - 36;
      if (p._lx !== lx || p._ly !== ly) {
        p.el.style.left = lx + 'px';
        p.el.style.top = ly + 'px';
        p._lx = lx; p._ly = ly;
      }
      var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (p.state === 'toSrc') ang += 180;
      // 【v14】角度走最短路径：与上次角度差超过 180° 时加减 360 归一，避免反转时转一大圈
      if (typeof p._ang === 'number') {
        var d = ang - p._ang;
        while (d > 180) { ang -= 360; d = ang - p._ang; }
        while (d < -180) { ang += 360; d = ang - p._ang; }
      }
      p._ang = ang;
      // 【v6 修复】旋转只作用于 SVG 箭头本体，问题标题/悬停文本层不旋转、始终水平，标题固定在箭头中点上方
      // 【v14】徽标文字（审核中/待修改等）反向旋转抵消：跟随箭头中点但永远水平正对用户，箭头朝上/朝下时文字也不会倒立或反向 180°
      var tf = 'rotate(' + ang + 'deg)';
      var tfBadge = 'rotate(' + (-ang) + 'deg)';
      if (p._tf !== tf) {
        p.el.style.transform = 'none';
        var svg = p.el.querySelector('svg');
        if (svg) {
          svg.style.transformOrigin = '120px 36px'; // 绕箭头中点旋转
          svg.style.transition = 'transform .25s'; // 保留平滑旋转动画
          svg.style.transform = tf;
        }
        var badge = p.el.querySelector('.va-badge');
        if (badge) {
          badge.style.transformOrigin = '120px 36px';
          badge.style.transition = 'none'; // 【v15】反向抵消不加过渡，瞬时跟随，避免比箭头慢半拍产生的文字摆动余韵
          badge.style.transform = tfBadge;
        }
        p._tf = tf;
      }
    }
    } finally {
      // 无论是否抛异常都续帧/休眠：异常时 _rafId 已在开头清零，1s 兜底也能救回
      _rafId = pairs.length ? requestAnimationFrame(tick) : 0;
    }
  }
  var _rafId = 0;
  function ensureLoop() {
    if (!_rafId) _rafId = requestAnimationFrame(tick);
  }
  // 创建新箭头/状态反转时唤醒循环；箭头全部消失后循环自动休眠（不空转耗 CPU）
  (function () {
    var _create = create;
  /* 【同步】讨论中箭头点"已汇总"时，同源单箭头跟随反转（状态→modified/修改完成） */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = ev.detail && ev.detail.srcId;
      pairs.forEach(function (p) {
        if (String(p.srcId) !== String(sid)) return;
        if (p.state !== 'toQC') return;
        p.state = 'toSrc';
        p.srcCount = assistantCount(findChat(p.srcId) || {});
        p.status = 'modified';
        applyStatus(p); persist();
      });
    } catch (e) {}
  });

  /* 【同步】讨论中箭头点"发散"再分发时，同源单箭头跟随反向（状态→pending/审核中） */
  document.addEventListener('zf-multi-scattered', function (ev) {
    try {
      var sid2 = ev.detail && ev.detail.srcId;
      pairs.forEach(function (p) {
        if (String(p.srcId) !== String(sid2)) return;
        if (p.state !== 'toSrc') return;
        p.state = 'toQC';
        p.status = 'pending';
        applyStatus(p); persist();
      });
    } catch (e) {}
  });

    window.ZFVerifyArrow = {
      create: function (s, q) { var r = _create(s, q); ensureLoop(); notifyMinimap(); return r; },
      // 【小地图联动】供右下角导航缩略图读取箭头配对（id + 方向 + 审核状态）
      getPairs: function () {
        return pairs.map(function (p) {
          return { srcId: p.srcId, qcId: p.qcId, state: p.state, status: p.status };
        });
      },
      /* 【输入防丢】供收口箭头回收时取走该审核窗单体箭头输入框里的补充文字（取走即清空） */
      takeNoteFor: function (boxId) {
        for (var i = 0; i < pairs.length; i++) {
          var p = pairs[i];
          if (String(p.qcId) === String(boxId) && p.el && p.el.isConnected) return takeNote(p);
      /* 【id 漂移兜底】persist 恢复/箭头重建后 qcId 可能与成员 id 不一致：
         先按 srcId 匹配；仍取不到时，回退到"唯一还留着补充内容的箭头"，确保文字绝不丢 */
      if (String(p.srcId) === String(boxId) && p.el && p.el.isConnected) { var _n = takeNote(p); if (_n) return _n; }
    }
    /* 兜底仅在 boxId 完全未命中任何 pair、且全模块只有唯一一个带内容的箭头时启用，
       防止多窗场景把别的成员框内容"抢"到本窗名下 */
    var _hitAny = false;
    for (var k = 0; k < pairs.length; k++) {
      var pk = pairs[k];
      if (pk.el && pk.el.isConnected && (String(pk.qcId) === String(boxId) || String(pk.srcId) === String(boxId))) { _hitAny = true; break; }
    }
    if (!_hitAny) {
      var _cands = [];
      for (var j = 0; j < pairs.length; j++) {
        var q = pairs[j];
        if (!q.el || !q.el.isConnected) continue;
        var _n2 = (function (pp) { try { var ip = pp.el && pp.el.querySelector('.va-note input'); return (ip && ip.value.trim()) || (pp.note && String(pp.note).trim()) || ''; } catch (e) { return ''; } })(q);
        if (_n2) _cands.push(q);
      }
      if (_cands.length === 1) return takeNote(_cands[0]);
    }
        return '';
      }
    };
  })();
  // 状态反转/创建/删除后通知小地图重绘
  function notifyMinimap() {
    try {
      if (App._minimapDraw) App._minimapDraw();
      else if (App.updateMinimap) App.updateMinimap();
    } catch (e) {}
  }
  // 兜底：万一有旧实例存在也保持跟随
  setInterval(ensureLoop, 1000);
  // 启动恢复：等对话框 DOM 异步加载完成后重建箭头（最多等 60s，每 1s 试一次）
  (function waitRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var raw = null;
      try { raw = localStorage.getItem('zf_verify_pairs'); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if ((hasSaved && anyBox) || tries > 60) {
        clearInterval(timer);
        if (hasSaved) restorePairs();
      }
    }, 1000);
  })();
  // [verify-arrow] 审核员方向箭头模块已加载
})();

