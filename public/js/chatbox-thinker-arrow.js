/* ============================================================
 * chatbox-thinker-arrow.js —— 策划师紫色方向箭头（v2 薄壳·内核版）
 * 渲染/定位/rAF循环/z-index/悬停提升/恢复熔断 全部委托 zf-arrow-core.js
 * 本壳只保留业务：策划/讨论/反驳/进化/验证 五种角色文案分表 + 结论回注 + 隐藏保活
 * 状态：pending(策划中·紫·流动) / clarified(已策划·紫罗兰) / applied(已策划·绿) / failed(失效·灰)
 * 用法：window.ZFThinkerArrow.create(srcChat, thinkerChat) → type:'sub'（派出小队，小号）
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFThinkerArrow) return;

  var PURPLE = '#b388ff';
  var VIOLET = '#7c4dff';
  var KEY = 'zf_thinker_pairs';

  var STATUS = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '策划完成', flow: false },
    pending:   { color: PURPLE, text: '策划中', flow: true },
    clarified: { color: VIOLET, text: '已策划', flow: false },
    applied:   { color: '#00e676', text: '已策划', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };
  /* 【自定义角色·讨论文案】自定义角色复用紫色箭头时，「策划中/已策划」名不副实，改用「讨论中」系文案 */
  var STATUS_DISCUSS = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '讨论完成', flow: false },
    pending:   { color: PURPLE, text: '讨论中', flow: true },
    clarified: { color: VIOLET, text: '已讨论', flow: false },
    applied:   { color: '#00e676', text: '已讨论', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };
  /* 【反驳师·红队文案】反驳师复用紫色箭头时，文案改用「反驳中」系（与策划/审核并列的第三种角色） */
  var STATUS_OBJECTOR = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '反驳完成', flow: false },
    pending:   { color: PURPLE, text: '反驳中', flow: true },
    clarified: { color: VIOLET, text: '已反驳', flow: false },
    applied:   { color: '#00e676', text: '已反驳', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };
  /* 【进化师·进化文案】进化师复用反驳师链路时，箭头文案用「进化中」系（判定优先级：进化 > 反驳 > 自定义） */
  var STATUS_EVOLUTION = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '进化完成', flow: false },
    pending:   { color: PURPLE, text: '进化中', flow: true },
    clarified: { color: VIOLET, text: '已进化', flow: false },
    applied:   { color: '#00e676', text: '已进化', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };
  /* 【验证师·终验文案】验证师窗（_isVerifierChat）用「验证中」系（判定优先级：验证 > 进化 > 反驳 > 自定义） */
  var STATUS_VERIFIER = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '验证完成', flow: false },
    pending:   { color: PURPLE, text: '验证中', flow: true },
    clarified: { color: VIOLET, text: '已验证', flow: false },
    applied:   { color: '#00e676', text: '已验证', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };
  /* 兼容结论标记：策划师/思想家（旧）/自定义角色（自定义·结论）/反驳师/进化师/验证师 */
  var CONCLUSION_RE = /【(?:策划师|思想家|自定义·?|反驳师|进化师|验证师)结论】/;

  function findChat(id) {
    var boxes = (window.App && App.chatBoxes) || [];
    for (var i = 0; i < boxes.length; i++) {
      var c = boxes[i];
      if (c && String(c.id) === String(id) && c.el && c.el.isConnected) return c;
    }
    return null;
  }
  function lastAnswer(chat) {
    /* 跳过 ⏱__TASKMETA__ 元数据消息，避免把 meta 行当结论回注 */
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
  function cleanQuestionText(c) {
    try {
      var idx8 = c.indexOf('【当前项目上下文】');
      if (idx8 > 0) c = c.slice(0, idx8);
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
        if (/^【?(系统|系统提示|守卫|安全|注入)|^\[?(SYSTEM|GUARD|INJECT)\b/i.test(c)) continue;
        if (h[i]._guardInject || h[i]._verifyRound || h[i]._continueRound || h[i]._thinkerRound) continue;
        c = cleanQuestionText(c);
        if (!c) continue;
        c = c.replace(/\s+/g, ' ').trim();
        return c.length > 60 ? c.slice(0, 60) + '…' : c;
      }
    } catch (e) {}
    return '';
  }
  // 提取最新结论行（兼容策划师/思想家/自定义/反驳师/进化师/验证师标记），无则返回 ''
  function lastConclusion(chat) {
    var ans = lastAnswer(chat);
    if (!ans) return '';
    var idx = Math.max(ans.lastIndexOf('【策划师结论】'), ans.lastIndexOf('【思想家结论】'), ans.lastIndexOf('【自定义·结论】'), ans.lastIndexOf('【自定义结论】'), ans.lastIndexOf('【反驳师结论】'), ans.lastIndexOf('【进化师结论】'), ans.lastIndexOf('【验证师结论】'));
    if (idx < 0) return '';
    var tail = String(ans).slice(idx);
    var lines = tail.split('\n');
    var first = (lines[0] || '').trim();
    if (first.length > '【策划师结论】'.length || first.length > '【思想家结论】'.length) return first;
    var collected = [lines[0]];
    for (var li = 1; li < lines.length; li++) {
      var ln = lines[li].trim();
      if (!ln) { if (collected.length > 1) break; continue; }
      if (/^#{1,3}\s/.test(ln) && collected.length > 1) break;
      collected.push(lines[li]);
    }
    return collected.join('\n').trim();
  }

  /* ---------- 角色文案表选择 ---------- */
  function tableOf(p) {
    var useDiscuss = !!p.custom && !p.objector && !p.evolution && !p.verifier;
    return p.verifier ? STATUS_VERIFIER : (p.evolution ? STATUS_EVOLUTION : (p.objector ? STATUS_OBJECTOR : (useDiscuss ? STATUS_DISCUSS : STATUS)));
  }

  /* ---------- 存档（数据本壳持有） ---------- */
  function persist() {
    try {
      var _mem = window.ZFArrow.all().filter(function (p) { return p.kind === 'thinker'; }).map(function (p) {
        return { srcId: p.srcId, tkId: p.dstId, state: p.state, status: p.status, phase: p.phase || '', tkCount: p.tkCount || 0, rounds: p.rounds || 0, question: p.question || '', custom: !!p.custom, objector: !!p.objector, evolution: !!p.evolution, verifier: !!p.verifier };
      });
      /* 【v7.2.3 宽限合并·charlie】内核 restore 保留的 _missAt 宽限条目不在内存实例里（对端框尚未恢复），
         persist 直接覆写会把它们洗掉 → 重启慢恢复场景箭头被永久误删；restorePairs 的 if(n)persist() 在
         部分恢复成功时也会触发此洗档。写盘前先合并回来。 */
      try {
        var _prev = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (Array.isArray(_prev)) {
          var _exist = {};
          _mem.forEach(function (x) { _exist[String(x.srcId) + '|' + String(x.tkId)] = 1; });
          _prev.forEach(function (d) {
            if (d && d._missAt && !_exist[String(d.srcId) + '|' + String(d.tkId)]) _mem.push(d);
          });
        }
      } catch (eM) {}
      localStorage.setItem(KEY, JSON.stringify(_mem));
    } catch (e) {}
  }

  /* ---------- 点击状态机（业务原样保留） ---------- */
  function onArrowClick(pair, fromAuto) {
    var src = findChat(pair.srcId);
    var tk = findChat(pair.dstId);
    /* 【修复·2026-11 子对话收不到父消息】对端临时关闭（el 已断连）时旧逻辑直接 ZFArrow.remove(pair)，导致箭头被误删、消息丢失；改为保留档案并提示用户重新打开对应窗口 */
    if (!src && !tk) { toast('父对话与子对话均已关闭，箭头暂无法使用（保留待恢复）', false); return; }
    if (!src) { toast('父对话窗口已关闭，无法传送；请先重新打开父对话', false); return; }
    if (!tk) { toast('子对话窗口已关闭，消息暂未送达；请重新打开该子对话后再点箭头', false); return; }
    var note = pair._takeNote ? pair._takeNote() : '';

    // 状态机（pair.phase）：
    //  - 未送出/已回注完（phase 为空或 'injected'）：点击 → 把原对话最新内容送策划师扩展
    //  - 'sent'（已送策划师，等回复）：点击 → 回注策划师结论到原对话
    if (pair.phase === 'sent') {
      var concl = lastConclusion(tk);
      var ans = lastAnswer(tk);
      if (!ans) { toast(pair.objector ? '反驳师还没有结论，无法回注' : (pair.custom ? '自定义角色还没有结论，无法回注' : '策划师还没有结论，无法回注'), false); return; }
      var msg;
      if (pair.custom) {
        msg = pair.objector
          ? ('（反驳结论·回注）\n这是反驳师（红队）的攻击性意见，逐条列出前提漏洞/隐藏风险/可行性问题及严重度，仅供你参考，是否据此修正方案由用户决定：\n\n' + (concl || ans))
          : ('（自定义结论·回注）\n这是自定义角色的结论，仅供你参考，是否采纳由用户决定：\n\n' + (concl || ans));
      } else {
        msg = concl
        ? ('（策划方案·陈列）\n这是策划师回笼的方案结论，仅供汇总对比与用户裁决，【禁止直接开工】：在用户明确下达开工指令（主对话执行或派施工队）之前，不得修改任何代码文件、不得调用 plan_batch.claim 执行计划。请先做多方案对比陈列（各自目标/涉及文件/风险），并标出各方案末行的 plan_id 供派单。\n【参数已确认】以下结论中的参数与口径视为用户已确认，严禁再次 ask_user 追问这些信息：\n\n' + concl)
        : ('（策划方案·陈列）\n这是策划师的扩展思考，仅供参考对比，【禁止直接开工】——用户未明确下令前不得改代码文件。请参考并把任务清晰化后继续（其中已明确的参数视为已确认，不要重复追问）：\n\n' + ans);
        msg += '\n【落盘与定稿规则】① 若上述结论含「【策划案路径：…】」标记：请 read_file 读取该 md 存为「待定稿策划案」，向用户陈列要点并等待定稿（用户说「定稿/开工/按方案做」等明确指令才放行）；未定稿前禁止修改任何业务代码文件。② 若结论没有路径标记：请提示策划师补落盘 md 并在结论行末尾补「【策划案路径：…】」标记后再定稿。③ 定稿后：施工派单时把该 md 路径随任务上下文带给施工队（施工队按策划书施工）。';
        if (concl && ans && ans !== concl) {
          msg += '\n\n<details>\n<summary>📄 策划师完整思考（点击展开）</summary>\n\n' + ans.slice(0, 20000) + '\n\n</details>';
        }
      }
      pair.phase = 'injected';
      pair.state = 'toSrc';
      pair.tkCount = assistantCount(tk);
      ZFArrow.setStatus(pair, concl ? 'done' : 'applied');
      sendTo(src, msg + note);
      toast('已回注原对话；在原对话补充意见后点击箭头即可送回' + (pair.objector ? '反驳师' : (pair.custom ? '自定义角色' : '策划师')), true);
      return;
    }

    // 初始段：原对话 → 策划师（首轮扩展，或用户在原对话补充修改意见后送回）
    var userNew = lastUserMsg(src);
    var ans2 = lastAnswer(src);
    if (!userNew && !ans2) { toast('原对话还没有内容，无法传送', false); return; }
    var body = userNew ? userNew : ans2;
    pair.state = 'toDst';
    pair.phase = 'sent';
    pair.tkCount = assistantCount(tk);
    ZFArrow.setStatus(pair, 'pending');
    sendTo(tk, pair.objector
      ? ('请针对以下内容做反驳（红队方案攻击）：攻击前提假设、隐藏风险、可行性漏洞。每条反驳标注严重度【高/中/低】，无实质问题则明说，不许为反驳而反驳。最终在结论行给出【反驳师结论】标记：\n\n' + body)
      : (pair.custom
        ? ('请针对以下内容按你的角色职责处理（多轮追问也可），最终在结论行给出【自定义结论】标记：\n\n' + body)
        : ('请针对以下内容做任务策划与澄清（多轮追问也可），最终给出【策划师结论】：\n\n' + body)) + note);
    toast(pair.objector ? '已送反驳师反驳（进行中）' : (pair.custom ? '已送自定义角色处理（进行中）' : '已送策划师策划（策划中）'), true);
  }

  /* ---------- 回复自动检测（内核 tick detect 钩子） ---------- */
  function detectReply(pair) {
    if (pair.status !== 'pending') return;
    var tk = findChat(pair.dstId);
    if (!tk) return;
    /* 策划师仍在发送/流式/重试中时不判定"已回复"（v27 卡顿防误判） */
    if (tk.isSending) return;
    var nowCount = assistantCount(tk);
    if (nowCount <= (pair.tkCount || 0)) return;
    var ans = lastAnswer(tk);
    if (!ans) return;
    pair.tkCount = nowCount;
    pair.rounds = (pair.rounds || 0) + 1;
    if (CONCLUSION_RE.test(ans)) {
      pair.phase = 'sent';
      ZFArrow.setStatus(pair, 'clarified');
      toast('策划师已给出结论，点击箭头即可传回原对话', true);
      pair._replied = true;
    } else {
      ZFArrow.setStatus(pair, 'pending');
    }
  }
  function detectSrcModified(pair) {
    if (pair.status !== 'applied' && pair.status !== 'done') return;
    var src = findChat(pair.srcId);
    if (!src) return;
    var nowCount = assistantCount(src);
    if (nowCount <= (pair.srcCount || 0)) return;
    pair.srcCount = nowCount;
    ZFArrow.setStatus(pair, 'modified');
    toast('原对话已按策划结论修改完成', true);
  }

  /* ---------- 隐藏保活：对端临时关闭只隐藏不删（内核 tick hide/show 钩子） ---------- */
  function onMissing(pair, missing) {
    if (!pair.el) return;
    if (missing) {
      if (pair.el.style.display !== 'none') { pair.el.style.display = 'none'; persist(); }
    } else {
      if (pair.el.style.display === 'none') {
        pair.el.style.display = '';
        ZFArrow.applyStatus(pair);
        persist();
        try { if (!pair._restoredToast) { pair._restoredToast = true; toast('箭头已随对话恢复（状态保留）', true); } } catch (e) {}
      }
    }
  }

  /* ---------- 创建（薄壳） ---------- */
  function create(srcChat, tkChat) {
    if (!srcChat || !tkChat || !srcChat.el || !tkChat.el) return;
    var inst = window.ZFArrow.create({
      srcId: srcChat.id, dstId: tkChat.id,
      kind: 'thinker',
      /* 派出小队箭头（主↔子角色）→ sub 小号（约 main 60%），减少同屏拥挤；swarm 汇聚总箭头保持大号 */
      type: 'sub',
      colors: { line: PURPLE, headStroke: '#d9c2ff', badgeText: '#1a0a2e' },
      statuses: STATUS, /* 运行时按角色分表重选（见 refreshTable） */
      badge: '策划中',
      state: 'toDst', status: 'pending',
      noteInput: true,
      persistKey: KEY, persist: persist,
      onClick: onArrowClick,
      detect: function (p) { detectReply(p); detectSrcModified(p); },
      onMissing: onMissing,
      getTitle: function (p, st) {
        var useDiscuss = !!p.custom && !p.objector && !p.evolution && !p.verifier;
        return (p.question ? '【' + p.question + '】\n' : '') + '当前状态：' + st.text + (useDiscuss ? '（已讨论 ' : '（已策划 ') + (p.rounds || 0) + ' 轮）（点击：把' + (useDiscuss ? '自定义角色' : '策划师') + '结论回注箭头指向的对话）';
      }
    });
    if (inst) {
      /* 角色标志判定（优先级：验证 > 进化 > 反驳 > 自定义） */
      try { inst.verifier = !!(tkChat.el && tkChat.el._isVerifierChat); } catch (e) { inst.verifier = false; }
      try { inst.evolution = !!(tkChat.el && tkChat.el._isEvolutionChat); } catch (e) { inst.evolution = false; }
      try { inst.objector = !!(tkChat.el && tkChat.el._isObjectorChat); } catch (e) { inst.objector = false; }
      try { inst.custom = !!(tkChat.el && tkChat.el._isCustomChat); } catch (e) { inst.custom = false; }
      /* 【协议化接入·反驳师⑤建议】新角色只需 _isTeam_ 前缀标志，零内核改动：
         el._isTeam_<角色名>=true → 自动生成该角色的文案表（「<角色名>中」系），注册一次即可 */
      try {
        if (!inst.verifier && !inst.evolution && !inst.objector && !inst.custom && tkChat.el) {
          for (var k in tkChat.el) {
            if (k.indexOf('_isTeam_') === 0 && tkChat.el[k]) {
              var rn = k.slice(8);
              var tKey = 'team_' + rn;
              if (!ZFArrow.TYPES._teamTables) ZFArrow.TYPES._teamTables = {};
              if (!ZFArrow.TYPES._teamTables[tKey]) {
                ZFArrow.TYPES._teamTables[tKey] = {
                  modified: { color: '#00e676', text: '修改完成', flow: false },
                  done: { color: '#00e676', text: rn + '完成', flow: false },
                  pending: { color: PURPLE, text: rn + '中', flow: true },
                  clarified: { color: VIOLET, text: '已' + rn, flow: false },
                  applied: { color: '#00e676', text: '已' + rn, flow: false },
                  failed: { color: '#9e9e9e', text: '已失效', flow: false }
                };
              }
              inst.teamRole = tKey;
              break;
            }
          }
        }
      } catch (eT) {}
      inst.question = firstQuestion(srcChat);
      inst.tkCount = assistantCount(tkChat);
      applyStatusThin(inst);
      persist();
    }
    return inst;
  }
  /* 按角色分表重刷状态（statuses 替换后重应用） */
  function applyStatusThin(p) {
    var t = tableOf(p);
    if (p.teamRole && ZFArrow.TYPES._teamTables && ZFArrow.TYPES._teamTables[p.teamRole]) t = ZFArrow.TYPES._teamTables[p.teamRole];
    p.statuses = t;
    ZFArrow.applyStatus(p);
  }
  function refreshAll() {
    window.ZFArrow.all().forEach(function (p) { if (p.kind === 'thinker') applyStatusThin(p); });
  }

  /* ---------- 恢复（内核熔断） ---------- */
  function restorePairs(silent) {
    var n = window.ZFArrow.restore({
      key: KEY,
      rebuild: function (d) {
        var src = findChat(d.srcId), tk = findChat(d.tkId);
        if (!src || !tk) return null; /* 熔断 */
        try { if (tk.el && tk.el._isSummarizerChat) return null; } catch (e) {} /* 防串扰 */
        var p = create(src, tk);
        if (!p) return null;
        p.state = d.state === 'toSrc' ? 'toSrc' : 'toDst';
        p.status = STATUS[d.status] ? d.status : 'pending';
        p.phase = d.phase || '';
        p.tkCount = d.tkCount || assistantCount(tk);
        p.rounds = d.rounds || 0;
        p.question = d.question || firstQuestion(src);
        /* 标志持久化：优先存档值，老数据按 DOM 重判 */
        try { p.custom = (d.custom === true || d.custom === false) ? d.custom : !!(tk.el && tk.el._isCustomChat); } catch (e) {}
        try { p.objector = (d.objector === true || d.objector === false) ? d.objector : !!(tk.el && tk.el._isObjectorChat); } catch (e) {}
        try { p.evolution = (d.evolution === true || d.evolution === false) ? d.evolution : !!(tk.el && tk.el._isEvolutionChat); } catch (e) {}
        try { p.verifier = (d.verifier === true || d.verifier === false) ? d.verifier : !!(tk.el && tk.el._isVerifierChat); } catch (e) {}
        applyStatusThin(p);
        return p;
      }
    });
    if (n && !silent) toast('已恢复 ' + n + ' 条策划师箭头（含状态）', true);
    if (n) persist();
    return n;
  }

  /* ---------- 事件同步（multi 收口/发散联动，原样保留） ---------- */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = ev.detail && ev.detail.srcId;
      window.ZFArrow.all().forEach(function (p) {
        if (p.kind !== 'thinker' || String(p.srcId) !== String(sid)) return;
        if (p.state !== 'toDst') return;
        p.state = 'toSrc'; p.phase = 'injected';
        p.tkCount = assistantCount(findChat(p.dstId) || {});
        p.status = 'applied';
        applyStatusThin(p); persist();
      });
    } catch (e) {}
  });
  document.addEventListener('zf-multi-scattered', function (ev) {
    try {
      var sid2 = ev.detail && ev.detail.srcId;
      window.ZFArrow.all().forEach(function (p) {
        if (p.kind !== 'thinker' || String(p.srcId) !== String(sid2)) return;
        if (p.state !== 'toSrc') return;
        p.state = 'toDst'; p.phase = 'sent'; p.status = 'pending';
        applyStatusThin(p); persist();
      });
    } catch (e) {}
  });

  window.ZFThinkerArrow = {
    create: create,
    restore: restorePairs,
    refreshAll: refreshAll,
    getPairs: function () {
      return window.ZFArrow.all().filter(function (p) { return p.kind === 'thinker'; })
        .map(function (p) { return { srcId: p.srcId, tkId: p.dstId, state: p.state, status: p.status, custom: !!p.custom, objector: !!p.objector, evolution: !!p.evolution, verifier: !!p.verifier }; });
    },
    /* 【输入防丢】收口箭头回收时取走输入框补充文字（取走即清空；含 id 漂移兜底） */
    takeNoteFor: function (boxId) {
      var list = window.ZFArrow.all().filter(function (p) { return p.kind === 'thinker'; });
      function takeOf(p) { return p._takeNote ? p._takeNote() : ''; }
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (String(p.dstId) === String(boxId) && p.el && p.el.isConnected) return takeOf(p);
        if (String(p.srcId) === String(boxId) && p.el && p.el.isConnected) { var _n = takeOf(p); if (_n) return _n; }
      }
      var _hitAny = false;
      for (var k = 0; k < list.length; k++) {
        var pk = list[k];
        if (pk.el && pk.el.isConnected && (String(pk.dstId) === String(boxId) || String(pk.srcId) === String(boxId))) { _hitAny = true; break; }
      }
      if (!_hitAny) {
        var _cands = [];
        for (var j = 0; j < list.length; j++) {
          var q = list[j];
          if (!q.el || !q.el.isConnected) continue;
          var _n2 = '';
          try { var ip = q.el.querySelector('.zfa-note input'); _n2 = (ip && ip.value.trim()) || (q.note && String(q.note).trim()) || ''; } catch (e) {}
          if (_n2) _cands.push(q);
        }
        if (_cands.length === 1) return takeOf(_cands[0]);
      }
      return '';
    },
    recallChild: function (boxId) {
      var list = window.ZFArrow.all().filter(function (p) { return p.kind === 'thinker'; });
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (String(p.dstId) === String(boxId) && p.el && p.el.isConnected && p.phase === 'sent') {
          try { onArrowClick(p, true); return true; } catch (e) { return false; }
        }
      }
      return false;
    }
  };

  /* ---------- 启动恢复（含挂载重试 + OOM 治理：无进展即停） ---------- */
  (function waitRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if (tries > 600) {
        if (tries % 5 !== 0) return; /* 600 秒后降频 5 秒一试 */
      }
      if ((hasSaved && anyBox) || tries > 60) {
        if (hasSaved) restorePairs(true);
        var _total = 0, _done = 0;
        try { _total = (JSON.parse(raw) || []).length; } catch (e) { _total = 0; }
        _done = window.ZFArrow.all().filter(function (p) { return p.kind === 'thinker' && p.el && p.el.isConnected; }).length;
        if (_total && _done >= _total) { clearInterval(timer); return; }
        if (_done > (timer._lastDone || 0)) { timer._lastDone = _done; timer._stagnant = 0; }
        else if (tries > 600) { timer._stagnant = (timer._stagnant || 0) + 1; if (timer._stagnant >= 60) { clearInterval(timer); return; } }
        if (!hasSaved && _total === 0) { clearInterval(timer); }
      }
    }, 1000);
  })();
  // [thinker-arrow] v2 薄壳已加载（内核版）
})();
