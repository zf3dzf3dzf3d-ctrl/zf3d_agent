/* ============================================================
 * chatbox-verify-arrow.js —— 审核员方向箭头（v2.0 状态机版）
 * 功能：
 * 1) 箭头比闪电线（stroke 3）大 3 倍：线宽 9、三角头约 54px；
 * 2) 图层 z-index 5000（悬停时提升 9800），低于大箭头（5200）、对话框（9998）及设置面板等（10000+）；
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
    revising:  { color: '#ffab40', text: '返回中',  flow: false },
    modified:  { color: '#00e676', text: '返回完成', flow: false },
    reviewing: { color: '#00e5ff', text: '复审中',  flow: true },
    passed:    { color: '#00e676', text: '审核完成',  flow: false },
    failed:    { color: '#9e9e9e', text: '已失效',  flow: false },
    /* 【自动重审 G1 护栏】同指纹连续 2 轮未消除 → 挂起待人工（质量刹车，非次数限制） */
    suspended: { color: '#ff5c8a', text: '待人工',  flow: false }
  };
  // 审核员回复含这些语义 → 判定通过
  var PASS_RE = /(✅|通过|合格|没问题|符合要求|可以交付|验收通过|approved|passed|合格品)/i;
  // 明确不通过语义（【一票否决】命中其中任一条即视为该轮不合格，需打回重审）
  var FAIL_RE = /(不通过|未通过|有问题|存在问题|发现(问题|错误)|存在(遗漏|缺陷|隐患)|需要修改|需修改|待修改|需要修复|待修复|需修复|有问题点|需要补充|待补充|有遗漏|存在.*遗漏|未覆盖|未实现|没有实现|缺少|缺失|建议修复|建议修改|需要完善|待完善|报错|出错了|运行失败|执行失败|测试未通过|不合格|不及格|未达标|有错误|错误点|⚠️|❌|✗|×)/i;
  /* 【否定式清洗】审核员常写"没问题/无需修改/没有发现错误"等否定表述，
     若不剔除会被 FAIL_RE 误命中。下面把常见否定短语整段抹掉后再判 FAIL，
     保证"任一条错误未通过"才触发打回，而非被否定句式误伤。 */
  var NEG_RE = /(没有(任何)?(问题|错误|遗漏|缺陷|毛病)|没(有)?问题|无问题|没毛病|没有发现(问题|错误|遗漏|缺陷)|未(发现|存在|出现)(问题|错误|遗漏|缺陷)|不存在(问题|错误|遗漏|缺陷|毛病)|(不需要|无需|不必)(修改|修复|补充|完善)|没有需要修改的地方|没有明显问题|没有问题)/g;

  /* ============================================================
   * 【评分机制】审核员对本轮工作打分（100 分制），不及格（< 及格线）等同打回。
   * 协议：审核员回复须含一行锚点「【审核评分】NN」或「【审核评分】NN/100」，NN 为 0-100 整数。
   * 解析稳健：取锚点后第一个 0-100 整数；解析不到记 null，绝不臆断（不因缺分判 fail，也不默认满分）。
   * 及格线默认 60，可由 window.ZF_PASS_LINE（0-100）调整。
   * ============================================================ */
  // 【兜底放宽】锚点与数字之间允许夹杂 ：：** 等 markdown/标点（原仅 \s* 会漏判「【审核评分】：**85**」）
  var SCORE_ANCHOR = /【审核评分】[^\d]{0,6}(\d{1,3})\s*(?:\/\s*100)?/;
  function vaPassLine() {
    var v = (typeof window !== 'undefined') ? window.ZF_PASS_LINE : null;
    return (typeof v === 'number' && v >= 0 && v <= 100) ? v : 60;
  }
  function vaParseScore(ans) {
    var s = String(ans || '');
    // 解析稳健：锚点优先，再退到多种中文表述，最后退到「NN/100」裸形式，最大程度避免「偶尔没分」
    var m = s.match(SCORE_ANCHOR);
    if (!m) m = s.match(/审核评分[^\d]{0,6}(\d{1,3})\s*(?:\/\s*100)?/);            // 无方括号
    if (!m) m = s.match(/(?:总分|得分|评分|打分|最终得分|综合评分|本轮评分)[^\d]{0,4}(\d{1,3})/);
    if (!m) m = s.match(/(\d{1,3})\s*[\/／]\s*100/);                              // 裸 NN/100 形式
    if (!m) return null;
    var n = parseInt(m[1], 10);
    if (isNaN(n) || n < 0 || n > 100) return null;
    return n;
  }

  /* 【评分日志 · 供后期总结】每个任务每轮评分追加到独立累计日志 localStorage，
     跨对话持久保存，总结环节可经 window.ZFVerifyArrow.getScoreLog()/scoreSummary() 读取。 */
  var SCORE_LOG_KEY = 'zf_verify_score_log_v1';
  /* 【审核健全性 v4·阈值常量化】≥80 分直接通过的阈值提为常量，后续调阈值只改这里 */
  var AUTO_PASS_SCORE = 80;
  function vaAppendScoreLog(rec) {
    try {
      var arr = JSON.parse(localStorage.getItem(SCORE_LOG_KEY) || '[]');
      arr.push(rec);
      if (arr.length > 500) arr = arr.slice(arr.length - 500); // 上限防膨胀
      localStorage.setItem(SCORE_LOG_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  function vaScoreSummary() {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem(SCORE_LOG_KEY) || '[]'); } catch (e) { return { total: 0, rounds: 0, avg: null, tasks: 0 }; }
    var scored = arr.filter(function (r) { return typeof r.score === 'number'; });
    var sum = scored.reduce(function (a, r) { return a + r.score; }, 0);
    // 按 srcId 聚合任务数与每任务最终评分
    var byTask = {};
    arr.forEach(function (r) { (byTask[r.srcId] || (byTask[r.srcId] = [])).push(r); });
    var finals = Object.keys(byTask).map(function (k) {
      var rs = byTask[k]; var lastS = null;
      for (var i = rs.length - 1; i >= 0; i--) { if (typeof rs[i].score === 'number') { lastS = rs[i].score; break; } }
      return { srcId: k, rounds: rs.length, finalScore: lastS };
    });
    var passLine = vaPassLine();
    return {
      rounds: arr.length, scoredRounds: scored.length, total: sum,
      avg: scored.length ? Math.round(sum / scored.length) : null,
      tasks: Object.keys(byTask).length,
      passLine: passLine,
      failedRounds: scored.filter(function (r) { return r.score < passLine; }).length,
      byTask: finals
    };
  }

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
      if (c && String(c.id) === String(id) && c.el && c.el.isConnected) return c;
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
    /* 【v42 徽标 HTML 化】文字渲染改为写 .va-label 胶囊：宽度自适应（white-space:nowrap +
       translate(-50%,-50%)），颜色/文字随状态更新；胶囊锚定在箭头中点(120,36)，
       不受 SVG 旋转与画布缩放影响，任何角度都严格居中于线段中点且文字水平可读 */
    var rounds = pair.rounds || 0;
    var hasScore = (typeof pair.score === 'number');
    var labelEl = pair.el && pair.el.querySelector('.va-label');
    if (labelEl) {
      var _passLine = (typeof pair.passLine === 'number') ? pair.passLine : vaPassLine();
      var _stText = st.text;
      /* 【v41 四态文案】审核中 / 审核完成 / 返回中 / 返回完成；有分时按分数语义改写 */
      if (hasScore && (pair.status === 'pending' || pair.status === 'reviewing' || pair.status === 'passed')) {
        _stText = (pair.score >= _passLine) ? '审核完成' : '返回完成';
      }
      if (pair.state === 'toSrc') {
        _stText = (pair.status === 'modified' || (hasScore && pair.score >= _passLine)) ? '返回完成' : '返回中';
      }
      var _roundsPart = (rounds > 0) ? ('·第' + rounds + '轮') : '';
      /* 【去掉左侧回收图标】不再在状态文字前拼 ♻ 前缀图标（autoloop 功能本身保留，仅去视觉标记） */
      labelEl.textContent = _stText + _roundsPart;
      labelEl.style.background = st.color;
      labelEl.style.display = '';
    }
    var badgeText = null, badgeRect = null; /* 旧 SVG 徽标已停用（v42），引用置空跳过下方分支 */
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
    var raw = null;
    try {
      raw = JSON.stringify(pairs.map(function (p) {
        /* 【自动重审 PR1】持久化 autoloop 标志与指纹护栏历史，跨对话/刷新可恢复闭环 */
        return { srcId: p.srcId, qcId: p.qcId, state: p.state, status: p.status, qcCount: p.qcCount || 0, rounds: p.rounds || 0, question: p.question || '',
          autoloop: !!p.autoloop, fpHistory: p.fpHistory || [], lastFailAns: p._lastFailAns || '', srcCount: p.srcCount || 0,
          /* 【评分机制】持久化本轮评分、及格线与评分轨迹，供收口/后期总结与重启恢复 */
          score: (typeof p.score === 'number' ? p.score : null), passLine: p.passLine || vaPassLine(), scoreHistory: p.scoreHistory || [],
          /* 【自动回收重审 v49】持久化 _lastHasFail，防刷新/重启后 undefined 使齐步回注判据失效 */
          lastHasFail: !!p._lastHasFail };
      }));
      localStorage.setItem('zf_verify_pairs', raw);
    } catch (e) {}
    /* 【v56 服务器端双写】同时推一份到后台磁盘（private/db/verify_pairs.json），
       客户端本地存储被清/换分区时仍可从服务器恢复，根治"重启后箭头全丢" */
    if (raw !== null) {
      try {
        fetch('/api/verify-pairs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairs: raw }) }).catch(function () {});
      } catch (e) {}
    }
  }
  function restorePairs(silent) {
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
        /* 【自动重审 PR1】恢复自驱动闭环：create() 仅在凭证有效期内才自动置 autoloop，
           跨对话/刷新后凭证已过期，须用持久化的 autoloop 标志回填，保证闭环续跑；
           同时回填指纹护栏历史与 srcCount 基线（防恢复后 detectSrcModified 误判"修改完成"） */
        if (d.autoloop) p.autoloop = true;
        p.fpHistory = d.fpHistory || [];
        p._lastFailAns = d.lastFailAns || '';
        /* 【评分机制】恢复评分、及格线与轨迹 */
        p.score = (typeof d.score === 'number' ? d.score : null);
        p.passLine = d.passLine || vaPassLine();
        p.scoreHistory = d.scoreHistory || [];
        if (d.srcCount) p.srcCount = d.srcCount;
        p._lastHasFail = !!d.lastHasFail;
        if (d.autoloop) { try { p.el.dataset.autoloop = 'on'; } catch (e) {} }
        applyStatus(p);
        restored++;
      }
    });
    if (restored) {
      ensureLoop();
      notifyMinimap();
      if (!silent) toast('已恢复 ' + restored + ' 条审核员箭头（含状态）', true);
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
      '<g class="va-badge" style="display:none"></g>' +
      '<style>.va-flow{animation:vaFlow 1s linear infinite;}@keyframes vaFlow{to{stroke-dashoffset:-24;}}</style>' +
      '</svg>' +
      /* 【v42 徽标 HTML 化】状态文字徽标从 SVG 内部（需反向旋转抵消，动态宽度/缩放下易错位、
         大角度时文字被甩出胶囊）改为独立 HTML 胶囊：用 translate(-50%,-50%) 锚定在箭头中点
         (120,36)，不参与 SVG 旋转/缩放，任何角度都严格居中于线条中点且文字永远水平可见 */
      '<div class="va-label" style="position:absolute;left:120px;top:36px;transform:translate(-50%,-50%);' +
      'background:#00e5ff;color:#fff;font:bold 15px sans-serif;padding:5px 14px;border-radius:16px;white-space:nowrap;' +
      'text-shadow:0 1px 2px rgba(0,20,26,.72);box-shadow:0 0 8px rgba(0,0,0,.35);pointer-events:none;z-index:2;">审核中</div>' +
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
        /* 【v37 防遮挡】悬停时把本箭头整体提到最上层（兄弟箭头同为 z-index:5000，
           后创建的会盖住先创建箭头的补充输入框，导致输入内容看不见/点不到）；隐藏时还原 */
        try { if (el) el.style.zIndex = '9800'; } catch (eZ) {}
        try { note.style.zIndex = '10'; } catch (eZ2) {}
        note.style.opacity = '1'; note.style.pointerEvents = 'auto';
      }
      function hideNote() {
        if (document.activeElement === inp) return; // 正在输入时不隐藏
        hideTimer = setTimeout(function () {
          if (document.activeElement === inp) return;
          note.style.opacity = '0'; note.style.pointerEvents = 'none'; inp.blur();
        try { if (el) el.style.zIndex = '5000'; } catch (eZ) {} /* 【v37 防遮挡】收起后还原层序 */
        }, 350);
      }
      function hideNow() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        note.style.opacity = '0'; note.style.pointerEvents = 'none'; inp.blur();
        try { if (el) el.style.zIndex = '5000'; } catch (eZ) {} /* 【v37 防遮挡】收起后还原层序 */
      }
      el.addEventListener('mouseenter', showNote);
      el.addEventListener('mouseleave', hideNote);
      note.addEventListener('mouseenter', showNote);   // 移入输入框：取消隐藏
      note.addEventListener('mouseleave', hideNote);
      inp.addEventListener('focus', showNote);
      inp.addEventListener('blur', hideNote);
    })();

    var pair = { srcId: srcChat.id, qcId: qcChat.id, el: el, state: 'toQC', status: 'pending', qcCount: assistantCount(qcChat), rounds: 0, _createdAt: Date.now(),
      /* 【自动回收重审核 · PR1】per-pair 自驱动闭环标志：首轮由一次性凭证认领（autoGatherOn），
         之后即使凭证过期也由 autoloop 接力"回注→复审→再回注"直到全 PASS 或护栏挂起 */
      autoloop: false,
      /* 【G1 指纹护栏】审核员每轮 FAIL 回复的问题指纹历史（规范化文本 hash） */
      fpHistory: [],
      /* 【评分机制】本轮评分（null=未给分）、评分轨迹 scoreHistory */
      score: null, scoreHistory: [],
      /* 本轮问题是否已自动回注原对话（区分「等回注」与「等复审」两阶段，防重复触发） */
      _gathered: false };
    pair.question = firstQuestion(srcChat); // 【v4】原对话第一次提问，用于问题标签
    /* 【PR1 自动重审】派单时若数量弹窗已勾选"自动回收重审核"（凭证有效期内），
       认领为自驱动闭环：本轮起全程自动 回注→修复→复审→再回注，无需再点箭头 */
    try { if (autoGatherOn()) { pair.autoloop = true; pair._gatherTs = window._zfAutoGatherNext || 0; } } catch (e) {}
    pairs.push(pair);
    applyStatus(pair);

    persist();

    el.addEventListener('click', function (ev) {
      /* 【防误点策略·邻域感知热区收窄】当本箭头附近存在橙金收口总箭头（zf-converge-arrow）时，
         误点小箭头的概率大增。此时点击必须命中箭头图形本体（线条/箭头头/徽标）才触发传送，
         点到 240x72 容器的透明边缘空白则忽略；附近无总箭头时保持原来的整块可点行为 */
      try {
        var _r = el.getBoundingClientRect();
        var _hasConvergeNear = false;
        var _cvs = document.querySelectorAll('.zf-converge-arrow');
        for (var _i = 0; _i < _cvs.length; _i++) {
          var _cr = _cvs[_i].getBoundingClientRect();
          var _dx = Math.max(0, Math.max(_cr.left - _r.right, _r.left - _cr.right));
          var _dy = Math.max(0, Math.max(_cr.top - _r.bottom, _r.top - _cr.bottom));
          if (Math.hypot(_dx, _dy) < 80) { _hasConvergeNear = true; break; }
        }
        if (_hasConvergeNear) {
          var _t = ev.target;
          var _onBody = _t && (_t.closest && _t.closest('.va-line,.va-head,.va-badge'));
          if (!_onBody) return; /* 命中透明空白区：忽略，防误触 */
        }
      } catch (eG) {}
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
      toast('已把审核员的建议发给原对话（返回中）', true);
    } else {
      // 原对话 → 审核员：把原对话改好的答案发给审核员复审
      var ans2 = lastAnswer(src);
      if (!ans2) { toast('原对话还没有答案，无法传送', false); return; }
      pair.state = 'toQC';
      pair.qcCount = assistantCount(qc); // 记录发送前审核员回复数，用于检测新回复
      setStatus(pair, 'reviewing'); // 复审中
      /* 【错误3 修复·复审缺评分】首轮派单话术强制了【审核评分】协议，但复审话术未重申，
         导致第二轮审核员常只给结论不给分（pair.score=null，徽标不显示分数）。
         复审同样重申评分输出协议，确保每一轮都有评分。 */
      sendTo(qc, '他已经改好了请审核员再次审核（本轮复审同样必须输出评分）：\n\n【评分输出协议·强制】回复的最后一行必须单独输出：【审核评分】NN（NN 为 0-100 整数，例：【审核评分】85）。该行用于机器判定与记录，缺失会被视为未评分。\n\n' + ans2 + takeNote(pair));
      toast('已发给审核员复审（复审中）', true);
    }
  }

  /* 【自动重审 G1 指纹】把审核员一轮的 FAIL 回复规范化为短指纹：折叠空白、去标点、
     取前 240 字符做 djb2 hash。两轮指纹相同视为"同一问题未解决"。 */
  function vaFingerprint(ans) {
    var s = String(ans || '').toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。、；：""''（）()\[\]【】!！?？.,;:*#\-—~·`]/g, '');
    s = s.slice(0, 240);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'f' + h.toString(36);
  }
  /* 【箭头齐步 v5】同源全组都出结论后才统一上色：
     只要同源还有审核窗在 pending/reviewing（未出结论），已出结论的箭头保持"审核中"外观；
     全组齐了 → 一次性把各自 _pendingStatus 落到真实状态，整组箭头同帧变色翻向。
     suspended/autoloop 挂起等终态已上色的不重复处理。 */
  function _syncGroupStatus(pair) {
    try {
      var _all = pairs.filter(function (q) {
        return !q.dead && q.el && q.el.isConnected &&
               String(q.srcId) === String(pair.srcId) &&
               q.status !== 'suspended' && q.status !== 'failed' && !q._loopDone;
      });
      var _allDone = _all.every(function (q) {
        return q._pendingStatus || q.status === 'passed' || q.status === 'revising' || q.status === 'modified';
      });
      if (!_allDone) return; // 还有审核窗没出结论，全组保持"审核中"外观，继续等
      _all.forEach(function (q) {
        var _ps = q._pendingStatus;
        if (!_ps) return; // 已是终态/上过色
        q._pendingStatus = '';
        if (q.status !== _ps) { q.status = _ps; }
        applyStatus(q);
      });
      notifyMinimap(); persist();
    } catch (e) {}
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
    /* 【一票否决判定 v2】先清洗否定句式（"没问题/无需修改"等），再判 FAIL：
       命中任一错误语义即 hasFail=true（不再因回复里出现"通过"字样而豁免——
       审核员若一边写"通过"一边列问题，以"有问题"为准打回）。 */
    var ansCheck = String(ans).replace(NEG_RE, '');
    /* 【审核健全性 v2·分级判定】旧逻辑只要回复含任何"问题类"词就打回，导致 80+ 高分
       因审核员附带"建议优化/可改进"等弱建议字样也被打回。现改为三级：
       ① 有分且 < 及格线 → 直接打回（分数优先）；
       ② 有分且 ≥80（高分）→ 仅命中"强不合格语义"（FAIL_STRICT_RE：不通过/不合格/
          需要修改/❌/报错 等，即审核员明确判某项不合格）才打回；弱建议词不再触发打回；
       ③ 其余（60~79 分或无分）→ 沿用原 FAIL_RE 全词判定（其中任何项目不合格都打回）。 */
    var _score = vaParseScore(ans);
    var _pass = vaPassLine();
    /* 【审核健全性 v3·明确打回词收窄】此前 90 分审核只要附带"建议优化/发现一处小遗漏/需要修改"等
       弱表述也会被 FAIL_STRICT_RE 打回重审（表现为两位审核 90+ 分仍二审）。现收窄为：
       80+ 高分仅当审核员明确判负（不通过/未通过/不合格/打回/❌/报错/运行失败 等）才打回；
       "需要修改/需修复/存在…问题/发现…遗漏"等弱表述降级为建议，不再触发重审。 */
    /* 【审核健全性 v4·80分直接通过（写死）】审核员给出 ≥80 分 → 无条件直接通过，
       不再匹配任何打回词（连"不通过/不合格/❌"等强不合格语义也以分数为准）。
       理由：分数是审核员的最终量化结论，高分附带的问题字样按建议处理。
       分数 < 及格线仍必打回；无分或 <80 分沿用原词判定。 */
    var FAIL_STRICT_RE = /(不通过|未通过|不合格|不及格|打回|需打回|❌|✗|报错|出错了|运行失败|执行失败|测试未通过)/;
    var _ansForFail = ansCheck;
    var hasFail;
    if (_score !== null && _score < _pass) {
      hasFail = true;                                  // ① 低于及格线：必打回
    } else if (_score !== null && _score >= AUTO_PASS_SCORE) {
      hasFail = false;                                 // ② ≥80 分（AUTO_PASS_SCORE）：写死直接通过，忽略一切打回词
    } else {
      hasFail = FAIL_RE.test(_ansForFail);             // ③ 常规：任一项目不合格即打回
    }
    var scoreFail = (_score !== null && _score < _pass);
    if (scoreFail) hasFail = true;
    pair.score = _score;           // 本轮评分（null=审核员未给分）
    pair.passLine = _pass;         // 判定采用的及格线
    if (_score !== null) {
      if (!Array.isArray(pair.scoreHistory)) pair.scoreHistory = [];
      pair.scoreHistory.push({ round: pair.rounds, score: _score, pass: _score >= _pass }); // 评分轨迹，供收口/总结
      /* 【分数平台期收口 v1】连续 2 轮评分都 ≥80 且差值 ≤3 分 → 判定为收敛（分数已进入
         平台期，继续打回只会产生"85→83→86"式微调循环，浪费轮次）。此时强制视为通过：
         hasFail 覆盖为 false，走正常 PASS 收口链路（汇总回注主对话），评审建议随
         _autoExtras 草稿一并带回，不丢失审核员意见。注意：若本轮命中强不合格语义
         （FAIL_STRICT_RE），说明审核员明确指出实质缺陷，仍以缺陷为准不豁免。 */
      if (!hasFail && _score >= 80 && pair.scoreHistory.length >= 2) {
        var _prevRec = pair.scoreHistory[pair.scoreHistory.length - 2];
        if (_prevRec && typeof _prevRec.score === 'number' && _prevRec.score >= 80 && Math.abs(_prevRec.score - _score) <= 3) {
          hasFail = false;
          scoreFail = false;
          pair._plateauPass = true; // 标记平台期通过，供 toast/收口文案说明
        }
      }
      /* 每轮评分写入独立累计日志（供后期总结，跨对话持久） */
      try { vaAppendScoreLog({ t: Date.now(), srcId: pair.srcId, qcId: pair.qcId, round: pair.rounds, score: _score, passLine: _pass, pass: _score >= _pass }); } catch (e) {}
    }
    /* 【v37 打回不吞绿】把本轮真实判定记在 pair 上，供收口事件 zf-multi-gathered 按结论上色
       （此前收口"已汇总"会把所有单箭头无差别刷成绿色 modified，58 分不及格也照样全绿） */
    pair._lastHasFail = hasFail;
    /* 【箭头齐步 v5·全员完成才变脸】不再回复瞬间单独变色——快审核员先完成时若立即置
       passed/revising，会出现「一个箭头已绿/橙、另一个还青色审核中」的不同步。
       现改为只把结论记到 _pendingStatus，由 _syncGroupStatus 统一判断：
       同源全组审核窗都出结论后，才一次性整组上色，箭头视觉始终同步。
       内部数据（score/_autoPending/_lastHasFail/rounds）不受影响，回注时机照旧。 */
    pair._pendingStatus = hasFail ? 'revising' : 'passed';
    _syncGroupStatus(pair);
    notifyMinimap(); persist();
    var _tip = '';
    if (_score !== null) _tip = '（评分 ' + _score + '/' + _pass + (scoreFail ? ' 不及格' : '') + '）';
    toast(hasFail ? ('审核员已回复' + _tip + '，点击箭头把建议传回原对话') : ('审核员已回复' + _tip + '，点击箭头即可传话'), !hasFail);
    /* 【自动重审 G1/G4 护栏】autoloop 配对：记录本轮 FAIL 指纹，同指纹连续 2 轮未消除 → 挂起待人工。
       这是"质量刹车"而非"次数限制"（只要每轮问题在变化就一直自动审），不违背用户"无限制次数"要求，
       规避旧坑《蜂群审核重复与死循环》。PASS 时清空指纹历史。 */
    if (pair.autoloop) {
      pair._verdictAt = Date.now(); // 本轮结论出现时间，编排器齐步防抖用
      if (!hasFail) {
        pair.fpHistory = []; pair._lastFailAns = '';
        /* 【箭头一致 v3·PASS 也要先返回】旧逻辑 PASS 立即置 passed 终态、箭头钉死在 toQC 指向审核窗，
           收口/复审后其余箭头全部翻向主对话，唯独它不翻 → 表现为"3 个箭头方向来回切换不一致"。
           现改为：PASS 先走编排器统一回注主对话（置 _autoPending='gather'），回注动作完成后
           由 autoLoopGather 的收口分支统一置 passed/_loopDone —— 所有箭头同帧同向。 */
        pair._autoPending = 'gather';
      } else {
        var _fp = vaFingerprint(ans);
        var _prev = pair.fpHistory || [];
        // 同一回复（本轮与上轮完全相同）或同一指纹连续出现 → 判定空烧，挂起
        /* 【箭头一致 v3·挂起也先返回】suspended 前同样先参与齐步回注，箭头不钉死 */
        if (_prev.length && _prev[_prev.length - 1] === _fp && String(ans).trim() === String(pair._lastFailAns || '').trim()) {
          pair._autoPending = 'gather';   // 先挂入回注队列，让箭头与全组一起返回主对话
          pair._suspendAfterGather = true; // 回注完成后编排器再置 suspended
          return; // 不再标记 _replied，避免继续自动回注
        }
        _prev.push(_fp);
        if (_prev.length > 3) _prev.shift();
        pair.fpHistory = _prev;
        pair._lastFailAns = String(ans).trim();
        // 本轮 FAIL 且未触发挂起 → 标记待自动回注原对话（编排器齐步发送）
        pair._autoPending = 'gather';
      }
    }
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
  var _srcSettleMs = 3500; // 【v38 防提前复审】本体空闲且回复计数静置此毫秒数（不再增长）才算"改完"
  function detectSrcModified(pair) {
    if (pair.status !== 'revising') return;
    var src = findChat(pair.srcId);
    if (!src) return;
    // 【v27 同理】原对话仍在流式/重试中，半截内容不算"修改完成"；并清空稳定计时
    if (src.isSending) { pair._srcSettleAt = 0; return; }
    var nowCount = assistantCount(src);
    if (nowCount <= (pair.srcCount || 0)) return;
    /* 【v38 核心修复·防提前二轮】本体是 Agent 工具循环，每个工具 turn 都会新增一条 assistant
       回复，而 isSending 在「调用工具→等结果→发下一轮」的往返间隙会短暂变 false。
       旧逻辑此时即误判"改完"→编排器把半成品送审核窗复审，表现为"没等本体出完答案就直接第二轮审核"。
       改为稳定窗口判据：计数变化即刷新计时起点并返回；只有本轮计数静置超过 _srcSettleMs
       （本体空闲且不再产出新回复 = 最终答案已出完）才真正置 modified 送复审。 */
    if (pair._srcCountSeen !== nowCount) {
      pair._srcCountSeen = nowCount;
      pair._srcSettleAt = Date.now();
      return; // 计数刚变，等待稳定，暂不送复审
    }
    if ((Date.now() - (pair._srcSettleAt || 0)) < _srcSettleMs) return; // 尚未稳定满窗口
    // 稳定达标 → 确认本体已出完答案、真正修改完成
    pair.srcCount = nowCount;
    pair._srcSettleAt = 0;
    pair._srcCountSeen = 0;
    setStatus(pair, 'modified'); // 修改完成
    notifyMinimap(); persist();
    /* 【自动重审 PR1 接力】autoloop 配对：原对话改完 → 标记待复审，由编排器 autoLoopGather
       把最新结果齐步发回该源对话下的全部审核窗（rounds++ 在审核窗下次回复时计入），无需人工点箭头 */
    if (pair.autoloop) pair._autoPending = 'review';
    else toast('原对话已修改完成，点击箭头可发审核员复审', true);
  }
  /* ============================================================
   * 【自动回收重审核 · 形态A 闭环编排器 autoLoopGather】
   * 不依赖一次性凭证，由 pair.autoloop 自驱动，跨轮持续接力：
   *   审核窗出本轮结论(全齐) → 齐步回注原对话(gather)
   *   → 原对话改完(全齐)     → 齐步发回各审核窗复审(review, rounds++)
   *   → 仍 FAIL 继续循环；全 PASS 自动收口(loopDone)
   * 护栏：G1 同指纹连续2轮挂起(detectReply 内置)、suspended/passed 终态退出循环、停止按钮断链。
   * 审核权始终在各审核窗（形态A 复用一审那几个窗），本体 AI 绝不自评。
   * ============================================================ */
  var _loopStableMs = 900; // 齐步防抖：本轮结论出现后稳定此毫秒数才动作，避开流式半截/并发串台
  /* 【自动/手动表现对齐】自动回注也带回：成员子窗草稿 + 箭头输入框补充。
     此前只有手动点收口箭头才带这两类补充，自动模式会静默丢失用户输入。
     现抽成公共函数，gather（打回）与 pass（全通过）两条自动回注分支统一调用，行为与手动一致。 */
  function _autoExtras(qcId) {
    var out = [];
    try {
      var _qc2 = findChat(qcId);
      var _nm2 = (_qc2 && _qc2.el && _qc2.el._swarmLabel) || '审核员';
      if (_qc2 && _qc2.el) {
        var _ta2 = _qc2.el.querySelector('textarea');
        var _draft2 = _ta2 ? _ta2.value.trim() : '';
        if (_draft2) {
          out.push('✎ ' + _nm2 + '（用户手动补充，未发送）：\n' + _draft2);
          try { _ta2.value = ''; } catch (eD2) {}
        }
      }
      var _note2 = (window.ZFVerifyArrow && typeof ZFVerifyArrow.takeNoteFor === 'function' && ZFVerifyArrow.takeNoteFor(qcId)) ||
                   (window.ZFThinkerArrow && typeof ZFThinkerArrow.takeNoteFor === 'function' && ZFThinkerArrow.takeNoteFor(qcId)) || '';
      if (_note2) out.push('✎ ' + _nm2 + '（用户在箭头输入框补充的新要求）：\n' + String(_note2).replace(/^\s*\n\n【[^】]*】\n/, '').trim());
    } catch (eAE) {}
    return out;
  }
  function autoLoopGather() {
    try {
      // 按源对话分组收集所有存活 autoloop 配对
      var bySrc = {};
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i];
        /* failed 为箭头销毁终态，须排除，否则一个失效配对会让整组齐步判据恒不满足而卡死 */
        if (!p.autoloop || p.dead || p._loopDone || p.status === 'failed') continue;
        (bySrc[p.srcId] || (bySrc[p.srcId] = [])).push(p);
      }
      var now = Date.now();
      for (var sid in bySrc) {
        var ps = bySrc[sid];
        if (!ps.length) continue;
        // 全通过 → 自动收口：本组闭环完成，提示并派发事件，退出循环
        var allPassed = ps.every(function (q) { return q.status === 'passed'; });
        /* 【箭头一致 v3】收口判据改造：PASS 的配对先被标记 _autoPending='gather' 参与
           齐步回注（与 FAIL 一致，箭头先翻回主对话），回注动作完成后此处统一终态化。
           allPassPending = 全组都已 PASS 且已挂入回注队列 → 一次性回注通过结论后置 passed。 */
        var allPassPending = ps.every(function (q) { return q.status === 'passed' || (q._lastHasFail !== true && q._autoPending === 'gather'); });
        if (allPassPending && ps.every(function (q) { return q._autoPending === 'gather' && q.state === 'toQC'; })) {
          var _srcP0 = findChat(sid);
          if (_srcP0 && _srcP0.isSending) continue;
          /* 一次性汇总回注全部审核员通过结论（天然同时返回），随后全部箭头同帧翻向主对话 */
          var _passLines = ps.map(function (q) {
            var _qc = findChat(q.qcId);
            var _nm = (_qc && _qc.el && _qc.el._swarmLabel) || '审核员';
            var _sc = (typeof q.score === 'number') ? ('（评分 ' + q.score + '/' + (q.passLine || vaPassLine()) + '）') : '';
            return '▶ ' + _nm + _sc + '：审核通过';
          });
          /* 【自动/手动对齐】全通过收口同样带回草稿与箭头输入框补充 */
          ps.forEach(function (q) { var _ex = _autoExtras(q.qcId); if (_ex.length) _passLines = _passLines.concat(_ex); });
          try {
            sendTo(_srcP0, '【自动重审收口】所有审核员已审核通过（共 ' + _passLines.length + ' 位）。审核蜂群已全员确认任务达标，请继续/收口，不要再重复追问已确认信息：\n\n' + _passLines.join('\n\n'));
          } catch (eS) {}
          ps.forEach(function (q) { q._autoPending = ''; q.state = 'toSrc'; q._loopDone = true; setStatus(q, 'passed'); });
          try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: sid, manual: true } })); } catch (eEv) {}
          notifyMinimap(); persist();
          var _scTag2 = ps.map(function (q) { return (typeof q.score === 'number') ? q.score : null; }).filter(function (x) { return x !== null; });
          var _scText2 = _scTag2.length ? ('，评分 ' + _scTag2.join('/')) : '';
          toast('✅ 自动重审通过：原对话经 ' + (ps[0].rounds || 1) + ' 轮审核全部合格' + _scText2 + '，已回注主对话', true);
          continue;
        }
        if (allPassed) {
          /* 收口评分：取本轮各审核窗评分（有分则拼展示），随事件带出评分轨迹供后期总结 */
          var _scTag = ps.map(function (q) { return (typeof q.score === 'number') ? q.score : null; }).filter(function (x) { return x !== null; });
          var _scText = _scTag.length ? ('，评分 ' + _scTag.join('/')) : '';
          /* 【错误4 修复·审核通过后必须返回主对话框】
             此前全通过后只 dispatch(zf-autoloop-done)+toast，从不把结论 sendTo 主对话，
             且全项目无任何 zf-autoloop-done 监听者 → 主对话 Agent 不知道审核已通过、停在原地，
             表现为「第二轮审核完成后没有返回到主对话框」。
             现将各审核员的通过结论汇总成一条回注主对话，告知审核全部通过、可收口/继续。
             主对话仍在流式/发送(isSending)时先不置 _loopDone，下一帧再试，避免 sendTo 被忙拦截后丢通知。 */
          var _srcP = findChat(sid);
          if (_srcP && _srcP.isSending) continue;
          ps.forEach(function (q) { q._loopDone = true; });
          var _verdicts = ps.map(function (q) {
            var qcP = findChat(q.qcId);
            var _nm = (qcP && qcP.el && qcP.el._swarmLabel) || '审核员';
            var _ans = (qcP ? lastAnswer(qcP) : '').slice(0, 1500);
            return '▶ ' + _nm + '：' + (_ans.trim() || '审核通过');
          });
          try {
            sendTo(_srcP, '【自动重审收口】所有审核员已审核通过（共 ' + _verdicts.length + ' 位' + _scText + '）。以下是各审核员最终结论，请据此确认任务已达标并继续/收口，不要再重复追问已确认信息：\n\n' + _verdicts.join('\n\n'));
          } catch (eS) {}
          notifyMinimap(); persist();
          try { document.dispatchEvent(new CustomEvent('zf-autoloop-done', { detail: { srcId: sid, rounds: Math.max.apply(null, ps.map(function (q) { return q.rounds || 0; })), scores: _scTag, scoreHistory: (ps[0].scoreHistory || []) } })); } catch (e) {}
          toast('✅ 自动重审通过：原对话经 ' + (ps[0].rounds || 1) + ' 轮审核全部合格' + _scText + '，已回注主对话', true);
          continue;
        }
        // 本轮已出结论的判据：没有 pair 仍停在 pending/reviewing（即都在等本轮结果，全出结果）
        /* 【v37 兜底】modified 是 detectSrcModified 置的"修改完成待复审"中转态，须计入本轮已出结论，
           否则万一恢复态/异常下 _autoPending 丢失而停在 modified，allVerdict 会永假导致整组卡死 */
        var allVerdict = ps.every(function (q) {
          return q.status === 'passed' || q.status === 'suspended' || q.status === 'revising' || q.status === 'modified' || q._autoPending === 'review';
        });
        // 最近结论时间稳定判据
        var latestVerdict = ps.reduce(function (m, q) { return Math.max(m, q._verdictAt || 0); }, 0);
        var stable = (now - latestVerdict) > _loopStableMs;
        // ---- gather 阶段：审核结论（FAIL 或先回注再挂起）→ 齐步回注原对话（state=toQC 走回注分支）----
        var gatherSet = ps.filter(function (q) { return q._autoPending === 'gather' && q.state === 'toQC'; });
        if (allVerdict && stable && gatherSet.length) {
          /* 【健壮性】原对话正在流式/发送(isSending)时回注会被 sendTo 忙拦截，但 onArrowClick 已先改状态
             → 状态与实际发送不一致。空闲才动，忙则保留 _autoPending 下一帧再试，杜绝空改状态 */
          var _src = findChat(sid);
          if (_src && _src.isSending) continue;
          /* 【错误1+错误2 修复·全员同时返回且中间箭头跟随】
             此前 autoloop 的 gather 阶段逐个 onArrowClick(q)，每个都各自 sendTo 主对话：
             ① 主对话是 Agent 循环，第 1 条 sendTo 后立刻 busy(isSending=true)，第 2 条 sendTo 被忙拦截
                → 表现为「两个审核员不是同时返回、甚至丢一条」；
             ② 该路径完全绕过收口箭头，不派发 zf-multi-gathered，中间/收口箭头不反转
                → 表现为「打回重审时中间箭头没有跟着返回」。
             现改为「自主汇总成一条」：把本组全部已出结论的审核员回复拼成一条消息一次性 sendTo 主对话
             （天然同时返回、不被 busy 拆散），随后显式把每条单箭头方向翻成 toSrc/待修改（中间箭头跟随返回），
             并派发 zf-multi-gathered 让收口箭头/小地图同步。多轮复审同样走此路径，不再依赖收口箭头 phase。
             单窗（gatherSet.length===1）退化为一条同样成立，无需特殊分支。 */
          var _lines = gatherSet.map(function (q) {
            var _qc = findChat(q.qcId);
            var _nm = (_qc && _qc.el && _qc.el._swarmLabel) ||
                      (_qc && _qc.el && _qc.el.querySelector && _qc.el.querySelector('.title') && _qc.el.querySelector('.title').textContent) || '审核员';
            var _ans = (_qc ? lastAnswer(_qc) : '').slice(0, 2000);
            return '▶ ' + _nm + '：\n' + ((_ans && _ans.trim()) || '（无内容）');
          });
          /* 【自动/手动对齐】打回回注同样带回草稿与箭头输入框补充 */
          gatherSet.forEach(function (q) { _lines = _lines.concat(_autoExtras(q.qcId)); });
          var _gmsg = '这是审核蜂群本轮的打回汇总（共 ' + _lines.length + ' 位审核员给出修改意见）。请逐条对比各方意见，明确说明采纳哪些、不采纳哪些及理由，然后据此修改，不要重复向用户追问已确认信息：\n\n' + _lines.join('\n\n');
          try { sendTo(_src, _gmsg); } catch (eG) {}
          gatherSet.forEach(function (q) {
            q._autoPending = '';
            q.state = 'toSrc';
            q.srcCount = assistantCount(_src || {});
            /* 【箭头一致 v3】先回注再挂起：同指纹连续 2 轮的配对在此刻才终态化 suspended
               （此前是回复瞬间直接挂起、箭头钉死在 toQC 不跟组返回）。回注消息已带上它的意见，
               挂起后等人工处理，不参与后续复审队列。 */
            if (q._suspendAfterGather) {
              q._suspendAfterGather = false;
              setStatus(q, 'suspended');
              try { if (q.el) q.el.dataset.autoloop = 'paused'; } catch (e) {}
              try { document.dispatchEvent(new CustomEvent('zf-autoloop-paused', { detail: { srcId: q.srcId, qcId: q.qcId, rounds: q.rounds } })); } catch (e) {}
              toast('⏸️ 审核员连续 2 轮指出同一问题（第 ' + q.rounds + ' 轮），意见已随汇总回注，已挂起待人工处理', false);
            } else {
              setStatus(q, 'revising');
            }
          });
          try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: sid } })); } catch (eEv) {}
          persist();
          continue;
        }
        // ---- review 阶段：原对话改完 → 齐步发回各审核窗复审（state=toSrc 走复审分支）----
        var needReview = ps.filter(function (q) { return q.status !== 'passed' && q.status !== 'suspended'; });
        var reviewAll = needReview.length > 0 && needReview.every(function (q) { return q._autoPending === 'review' && q.state === 'toSrc'; });
        if (reviewAll && stable) {
          /* 【健壮性】齐步发回各审核窗：任一目标审核窗正忙(isSending)则整组下一帧再发，
             避免 onArrowClick 先改状态而 sendTo 被拦导致状态与实际不一致 */
          var allQcFree = needReview.every(function (q) { var _qc = findChat(q.qcId); return !(_qc && _qc.isSending); });
          if (!allQcFree) continue;
          needReview.forEach(function (q) { q._autoPending = ''; onArrowClick(q, true); });
          /* 【大小箭头方向一致】复审（二审/三审…）齐步发回各审核窗时派发 scattered，
             收口总箭头(大)与各单箭头(小)同帧反转回 toGroup/审核中，方向保持一致 */
          try { document.dispatchEvent(new CustomEvent('zf-multi-scattered', { detail: { srcId: sid } })); } catch (eSc) {}
          persist();
          continue;
        }
      }
    } catch (e) {}
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
      /* 【自动重审 PR1】autoloop 配对由专用编排器 autoLoopGather 全权接管（不依赖一次性凭证，
         可跨轮续跑），此处排除，避免凭证逻辑与自驱动逻辑双驱动重复回注 */
      if (p.autoloop) continue;
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
      /* 【v23 单角色即时回收 / v39 修复·汇总一条】收口箭头只在成员≥2时创建；
         这里走「无收口箭头」降级路径，但此前对每个审核箭头各自 onArrowClick → 各自 sendTo 一条。
         主对话是 Agent 循环，收到第 1 条注入后立即 isSending=true，第 2 条 sendTo 被忙拦截/排队丢弃
         → 表现为「注入两次而不是同时全部注入、其中一个审核单独返回、其余丢失、判断混乱」。
         现改为与 autoLoopGather 同口径：把本组全部已回复审核员的结论「汇总成一条」一次性 sendTo，
         天然同时返回、不被忙拆散；随后逐个把箭头翻成 toSrc/待修改（方向反转，状态一致），
         并派发 zf-multi-gathered 让中间箭头/小地图同步。主对话忙（isSending）时不消费凭证，下一帧再试。 */
      if (!p_hasConverge(srcId)) {
        var _csrc = findChat(srcId);
        if (!_csrc) continue;                     // 源对话已不在，保留凭证待下一帧/由 tick 清理失效箭头
        if (_csrc.isSending) continue;            // 主对话忙，不在此刻注入，避免首条把后续挤掉/吞掉
        var _toGather = arr.filter(function (p) { return p._replied && p.state === 'toQC'; });
        if (!_toGather.length) {                  // 无可回注内容：直接消费凭证，避免空凭证反复重试
          arr.forEach(function (p) { p._gatherTs = ts; p._replied = false; });
          _groupGatherTs = ts;
          continue;
        }
        var _clines = _toGather.map(function (p) {
          var _qc = findChat(p.qcId);
          var _nm = (_qc && _qc.el && _qc.el._swarmLabel) ||
                    (_qc && _qc.el && _qc.el.querySelector && _qc.el.querySelector('.title') && _qc.el.querySelector('.title').textContent) || '审核员';
          var _ans = (_qc ? lastAnswer(_qc) : '').slice(0, 2000);
          return '▶ ' + _nm + '：\n' + ((_ans && _ans.trim()) || '（无内容）');
        });
        var _cmsg = _toGather.length > 1
          ? ('这是审核蜂群本轮的打回汇总（共 ' + _toGather.length + ' 位审核员给出修改意见）。请逐条对比各方意见，明确说明采纳哪些、不采纳哪些及理由，然后据此修改，不要重复向用户追问已确认信息：\n\n' + _clines.join('\n\n'))
          : ('这是审核员给你的建议你去改一下：\n\n' + _clines[0]);
        try { sendTo(_csrc, _cmsg); } catch (eCg) {}
        _toGather.forEach(function (p) {
          p.state = 'toSrc';
          p.srcCount = assistantCount(_csrc);
          setStatus(p, 'revising');
        });
        try { document.dispatchEvent(new CustomEvent('zf-multi-gathered', { detail: { srcId: srcId } })); } catch (eCe) {}
        arr.forEach(function (p) { p._gatherTs = ts; p._replied = false; });
        _groupGatherTs = ts;
        notifyMinimap(); persist();
        if (typeof toast === 'function') {
          toast(_toGather.length > 1 ? ('♻ 审核已结束，' + _toGather.length + ' 位审核员结论已汇总成一条回注原对话') : '♻ 审核已结束，已自动回注原对话', true);
        }
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
        try { if (!p._restoredToast) { p._restoredToast = true; toast('箭头已随对话恢复（状态保留）', true); } } catch (eT) {}
      }
      detectReply(p); detectSrcModified(p);
    }
    tryGroupAutoGather(); // 【v19】每帧检查：全员审核结束后批量回注
    /* 【自动重审 PR1】每帧检查自驱动闭环（仅当存在活跃 autoloop 配对才跑，轻量守卫省开销）*/
    if (pairs.some(function (p) { return p.autoloop && !p.dead && !p._loopDone; })) autoLoopGather();
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
      /* 【总览缩小跟随】画布缩小时箭头同步缩小（保底 0.35），围绕箭头中点缩放 */
      var _sc = (window.App && App.canvasScale) ? Math.max(0.35, Math.min(1, App.canvasScale())) : 1;
      p.el.style.transformOrigin = '120px 36px';
      p.el.style.transform = _sc < 0.99 ? 'scale(' + _sc + ')' : '';
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
      var tf = 'rotate(' + ang + 'deg)';
      if (p._tf !== tf) {
        p.el.style.transform = _sc < 0.99 ? 'scale(' + _sc + ')' : ''; /* 【修复】角度变化分支恢复本帧 scale，否则清掉 L525 刚设的缩放导致回跳闪烁 */
        var svg = p.el.querySelector('svg');
        if (svg) {
          svg.style.transformOrigin = '120px 36px'; // 绕箭头中点旋转
          svg.style.transition = 'transform .25s'; // 保留平滑旋转动画
          svg.style.transform = tf;
        }
        /* 【v42】SVG 内徽标已移除（改为 HTML .va-label，天然水平居中于箭头中点），
           不再需要反向旋转抵消逻辑；保留空壳 .va-badge 仅为兼容旧引用 */
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
  /* 【同步】收口箭头点"已汇总"回注原对话时，同源单箭头跟随反转方向（状态→revising/待修改）
     【v37】不再置 modified：详见下方修复注释 */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = ev.detail && ev.detail.srcId;
      var _manual = !!(ev.detail && ev.detail.manual); /* 用户手动点大箭头（收口）→ 必须跟随 */
      pairs.forEach(function (p) {
        if (String(p.srcId) !== String(sid)) return;
        if (p.state !== 'toQC') return;
        /* 【v37 打回不吞绿 · 修复"卡死没返回"】
           autoloop 配对的回注/复审由编排器 autoLoopGather 全权接管（若在此抢占改 state，
           gatherSet/state==='toQC' 判据落空 → 整组卡死）；suspended 为挂起态，保持不动。 */
        if (p.status === 'suspended') return;
        /* 【方向同步修复】passed(通过) 箭头此前被当终态整条跳过 → 收口回注后"其中 1 个箭头
           不跟随返回、方向还指着审核窗"（数据已回注、箭头没翻）。结论既然已随收口汇总回注，
           方向必须同步翻回源对话；只是 passed 不改判 revising，保持通过色，不算待修改。 */
        var _wasPassed = (p.status === 'passed');
        /* 【跟随返回修复】中间/收口箭头自动返回时，本体箭头此前因 autoloop 被整条 return 跳过，
           表现为"中间箭头返回、本体没跟随"。autoloop 抢占风险仅在它正排队等编排器回注
           (_autoPending==='gather') 时存在——此时必须留在 toQC 等编排器执行；其余 autoloop 情形
           (用户手动点收口箭头触发回注，未排队) 则让本体跟随翻转方向，与收口保持一致。
           【手动点击跟随修复】用户手动点大箭头时同样带 manual：既然用户已经手动收口，
           编排器的排队已无意义，清掉 _autoPending 并强制小箭头跟随反转，杜绝"点大箭头小箭头不动"。 */
        if (p.autoloop && p._autoPending === 'gather' && !_manual) return;
        if (_manual) p._autoPending = '';
        p.state = 'toSrc';
        p.srcCount = assistantCount(findChat(p.srcId) || {});
        /* 【箭头一致 v4·排队守卫补充】清掉 review 排队：用户已手动收口，编排器的复审排队
           同样无意义（收口回注的内容就是最新结论），否则会出现"手动收口后编排器又擅自发复审"的双驱动冲突。 */
        if (_manual && p._autoPending === 'review') p._autoPending = '';
        /* 关键修复：不再无差别刷成 modified(绿·修改完成)。收口刚刚把汇总建议送回原对话，
           此刻原对话还没改，正确语义是"待修改"。而 detectSrcModified 开头
           `if (pair.status !== 'revising') return;`，一旦被刷成 modified 就永不再执行，
           "原对话改完→自动送复审"链路就此断死 —— 表现为审核打了 58 分却全绿、既不显示打回也不再返回。
           因此非终态一律置 revising(橙)，_lastHasFail 仅作为结论留痕供后续展示/总结。 */
        /* 【方向同步修复】passed(通过) 的箭头跟随翻转方向但不改判 revising：
           它的结论已随收口回注、没有打回意见，保持"通过"色，只是方向与收口同步指回源对话。 */
        if (!_wasPassed) p.status = 'revising';
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
      },
      /* 【批量回收】整理面板调用：把某审核子窗已有审核结论回注其源对话（等价用户点箭头）。
         仅在方向指向源对话（state==='toQC'，点击即回注）时执行；否则返回 false */
      recallChild: function (boxId) {
        for (var i = 0; i < pairs.length; i++) {
          var p = pairs[i];
          if (String(p.qcId) === String(boxId) && p.el && p.el.isConnected && p.state === 'toQC') {
            try { onArrowClick(p, true); return true; } catch (e) { return false; }
          }
        }
        return false;
      },
      /* ===== 【自动回收重审核 · G3 控制 API】供 UI/外部断链、查询、人工恢复 ===== */
      // 列出全部 autoloop 配对状态（srcId/qcId/status/rounds/是否活跃）
      listAutoLoops: function () {
        return pairs.filter(function (p) { return p.autoloop; }).map(function (p) {
          return { srcId: p.srcId, qcId: p.qcId, status: p.status, rounds: p.rounds || 0, active: !p.dead && !p._loopDone };
        });
      },
      // 按源对话暂停闭环（保留状态，停止自动 回注/复审；用户可改回手动点箭头）
      pauseAutoLoop: function (srcId) {
        var n = 0;
        for (var i = 0; i < pairs.length; i++) {
          var p = pairs[i];
          if (p.autoloop && (!srcId || String(p.srcId) === String(srcId))) { p._autoPending = ''; try { p.el.dataset.autoloop = 'paused'; } catch (e) {} p.autoloop = false; n++; }
        }
        persist(); notifyMinimap();
        return n;
      },
      // 挂起(suspended)配对手动恢复：清指纹历史继续审（用户在审核窗里给新指令后可一键续跑）
      resumeAutoLoop: function (srcId) {
        var n = 0;
        for (var i = 0; i < pairs.length; i++) {
          var p = pairs[i];
          if ((!srcId || String(p.srcId) === String(srcId)) && (p.status === 'suspended' || (!p.autoloop && p.el && p.el.dataset.autoloop === 'paused'))) {
            p.autoloop = true; p.fpHistory = []; p._lastFailAns = ''; p._loopDone = false; p._verdictAt = Date.now();
            try { p.el.dataset.autoloop = 'on'; } catch (e) {}
            if (p.status === 'suspended') setStatus(p, p.state === 'toQC' ? 'revising' : 'reviewing');
            n++;
          }
        }
        persist(); notifyMinimap();
        return n;
      },
      // 当前自动回收凭证是否有效（派单时供 UI 判断能否认领 autoloop）
      autoGatherActive: function () { return autoGatherOn(); },
      /* ===== 【评分机制 · 供后期总结读取】 ===== */
      // 原始评分累计日志（每轮一条 {t,srcId,qcId,round,score,passLine,pass}）
      getScoreLog: function () { try { return JSON.parse(localStorage.getItem(SCORE_LOG_KEY) || '[]'); } catch (e) { return []; } },
      // 评分汇总（总轮次/均分/及格线/任务数/不及格轮数/每任务最终分），总结时直接调用
      scoreSummary: function () { return vaScoreSummary(); },
      // 读取某任务(srcId)的评分轨迹
      getScoreHistory: function (srcId) {
        for (var i = 0; i < pairs.length; i++) {
          if (String(pairs[i].srcId) === String(srcId)) return (pairs[i].scoreHistory || []).slice();
        }
        return [];
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
    var serverFetched = false;
    var timer = setInterval(function () {
      tries++;
      var raw = null;
      try { raw = localStorage.getItem('zf_verify_pairs'); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      /* 【v56 服务器端兜底】本地无存档时，从后台磁盘拉一份（客户端存储被清/换分区后仍能恢复）
         【重启后箭头消失修复】原先只尝试一次：首次 fetch 时服务器未就绪/失败即永久放弃，
         改为每 5 秒重试直到拿到数据，拿到后才写回 localStorage 并停止重试 */
      if (!hasSaved && !serverFetched) {
        serverFetched = true;
        try {
          fetch('/api/verify-pairs').then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.ok && j.pairs) {
              try { localStorage.setItem('zf_verify_pairs', j.pairs); } catch (e) {}
            } else {
              /* 服务器也没存档：5 秒后重置标志重试（防服务器重启窗口期 404/连接失败），tries 每秒 +1，上限 200 轮 */
              if (tries < 200) setTimeout(function () { serverFetched = false; }, 5000);
            }
          }).catch(function () {
            if (tries < 200) setTimeout(function () { serverFetched = false; }, 5000);
          });
        } catch (e) {
          if (tries < 200) setTimeout(function () { serverFetched = false; }, 5000);
        }
      }
      try { raw = localStorage.getItem('zf_verify_pairs'); } catch (e) { raw = null; }
      hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if ((hasSaved && anyBox) || tries > 60) {
        /* 【toast 去死分支】统一传 true 静默恢复（历史版本曾按首次/重试区分传参，现已简化为始终静默） */
        if (hasSaved) { restorePairs(true); }
        /* 【重启后箭头消失修复】对话框 DOM 异步挂载中，首试可能 findChat 全落空只恢复一部分：
           不再立即停止，继续每秒重试，直到恢复数达到存档数或超过 120 秒 */
        /* 【v26 修复·重启后箭头再次丢失】120 秒上限不够：后台重启/大量对话恢复时
           DOM 挂载可远超 2 分钟，恢复循环提前放弃导致箭头全丢。放宽到 600 秒，
           正常情况仍按「恢复数==存档数」提前停，不会空转。 */
        if (tries > 600) { clearInterval(timer); return; }
        var _total = 0, _done = 0;
        try { _total = (JSON.parse(raw) || []).length; } catch (e) { _total = 0; }
        try { _done = pairs.filter(function (p) { return p.el && p.el.isConnected; }).length; } catch (e) {}
        if (_total && _done >= _total) clearInterval(timer);
        if (_total === 0) { clearInterval(timer); } // 无存档时不再空转 120 秒
      }
    }, 1000);
  })();
  // [verify-arrow] 审核员方向箭头模块已加载
})();

