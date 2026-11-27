/* ============================================================
 * chatbox-verify-arrow.js —— 审核员青色方向箭头（v3 薄壳·内核版）
 * 渲染/定位/rAF循环/z-index/悬停提升/隐藏保活/恢复熔断 全部委托 zf-arrow-core.js
 * 本壳只保留业务：7态审核状态机 + 评分管线 + G1指纹护栏 + 齐步上色 + 账本守卫 + autoloop 编排器
 * 用法：window.ZFVerifyArrow.create(srcChat, qcChat) → type:'sub'（派出小队，小号）
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFVerifyArrow) return;

  var CYAN = '#00e5ff';
  var KEY = 'zf_verify_pairs';
  var pairsOf = function () { return window.ZFArrow.all().filter(function (p) { return p.kind === 'verify'; }); };

  var STATUS = {
    pending:   { color: CYAN, text: '审核中',  flow: true },
    revising:  { color: '#ffab40', text: '返回中',  flow: false },
    modified:  { color: '#00e676', text: '返回完成', flow: false },
    reviewing: { color: CYAN, text: '复审中',  flow: true },
    passed:    { color: '#00e676', text: '审核完成',  flow: false },
    failed:    { color: '#9e9e9e', text: '已失效',  flow: false },
    suspended: { color: '#ff5c8a', text: '待人工',  flow: false }
  };
  var PASS_RE = /(✅|通过|合格|没问题|符合要求|可以交付|验收通过|approved|passed|合格品)/i;
  var FAIL_RE = /(不通过|未通过|有问题|存在问题|发现(问题|错误)|存在(遗漏|缺陷|隐患)|需要修改|需修改|待修改|需要修复|待修复|需修复|有问题点|需要补充|待补充|有遗漏|存在.*遗漏|未覆盖|未实现|没有实现|缺少|缺失|建议修复|建议修改|需要完善|待完善|报错|出错了|运行失败|执行失败|测试未通过|不合格|不及格|未达标|有错误|错误点|⚠️|❌|✗|×)/i;
  var NEG_RE = /(没有(任何)?(问题|错误|遗漏|缺陷|毛病)|没(有)?问题|无问题|没毛病|没有发现(问题|错误|遗漏|缺陷)|未(发现|存在|出现)(问题|错误|遗漏|缺陷)|不存在(问题|错误|遗漏|缺陷|毛病)|(不需要|无需|不必)(修改|修复|补充|完善)|没有需要修改的地方|没有明显问题|没有问题)/g;

  /* ===== 评分机制（原样保留） ===== */
  var SCORE_ANCHOR = /【审核评分】[^\d]{0,6}(\d{1,3})\s*(?:\/\s*100)?/;
  var SCORE_ANCHOR_POLISHER = /【优化评分】[^\d]{0,6}(\d{1,3})\s*(?:\/\s*100)?/;
  var SCORE_ANCHOR_SECURITY = /【安全评分】[^\d]{0,6}(\d{1,3})\s*(?:\/\s*100)?/;
  function _vaClampScore(v) { var n = parseInt(v, 10); return (isNaN(n) || n < 0 || n > 100) ? null : n; }
  function vaParseRoleScore(ans) {
    var s = String(ans || ''), m;
    if ((m = s.match(SCORE_ANCHOR_POLISHER))) return { role: 'polisher', score: _vaClampScore(m[1]) };
    if ((m = s.match(SCORE_ANCHOR_SECURITY))) return { role: 'security', score: _vaClampScore(m[1]) };
    if ((m = s.match(SCORE_ANCHOR))) return { role: 'qc', score: _vaClampScore(m[1]) };
    return null;
  }
  function vaPassLine() {
    var v = (typeof window !== 'undefined') ? window.ZF_PASS_LINE : null;
    return (typeof v === 'number' && v >= 0 && v <= 100) ? v : 60;
  }
  function vaParseScore(ans) {
    var s = String(ans || ''), m;
    m = s.match(SCORE_ANCHOR);
    if (!m) m = s.match(/审核评分[^\d]{0,6}(\d{1,3})\s*(?:\/\s*100)?/);
    if (!m) m = s.match(/(?:总分|得分|评分|打分|最终得分|综合评分|本轮评分)[^\d]{0,4}(\d{1,3})/);
    if (!m) m = s.match(/(\d{1,3})\s*[\/／]\s*100/);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return (isNaN(n) || n < 0 || n > 100) ? null : n;
  }
  var SCORE_LOG_KEY = 'zf_verify_score_log_v1';
  function vaAppendScoreLog(rec) {
    try {
      var arr = JSON.parse(localStorage.getItem(SCORE_LOG_KEY) || '[]');
      arr.push(rec);
      if (arr.length > 500) arr = arr.slice(arr.length - 500);
      localStorage.setItem(SCORE_LOG_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  /* 优化师/安全师评分落日志轮询（原样保留） */
  var _roleScoreSeen = {};
  setInterval(function () {
    try {
      var boxes = (typeof App !== 'undefined' && App.chatBoxes) || [];
      boxes.forEach(function (c) {
        if (!c || !c.el || !c.history || c.isSending) return;
        var isP = c.el._isPolisherChat, isS = c.el._isSecurityChat;
        if (!isP && !isS) return;
        var role = isP ? 'polisher' : 'security';
        var cnt = 0;
        c.history.forEach(function (h) { if (h && h.role === 'assistant' && !h._meta) cnt++; });
        if (cnt <= (_roleScoreSeen[c.id] || 0)) return;
        _roleScoreSeen[c.id] = cnt;
        var ans = '';
        for (var i = c.history.length - 1; i >= 0; i--) {
          var h2 = c.history[i];
          if (h2 && h2.role === 'assistant' && !h2._meta) { ans = String(h2.content || ''); break; }
        }
        var rs = vaParseRoleScore(ans);
        if (rs && rs.role === role && typeof rs.score === 'number') {
          vaAppendScoreLog({ t: Date.now(), srcId: (isP ? c.el._polisherSrcId : c.el._securitySrcId) || '', qcId: c.id, round: cnt, score: rs.score, passLine: 60, pass: rs.score >= 60, role: role });
        } else {
          console.warn('[ZFVerifyArrow] ' + (isP ? '优化师' : '安全师') + '窗(' + c.id + ')最新回复缺少评分锚点，评分链路可能断流');
        }
      });
    } catch (e) {}
  }, 5000);
  function vaScoreSummary() {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem(SCORE_LOG_KEY) || '[]'); } catch (e) { return { total: 0, rounds: 0, avg: null, tasks: 0 }; }
    var scored = arr.filter(function (r) { return typeof r.score === 'number'; });
    var sum = scored.reduce(function (a, r) { return a + r.score; }, 0);
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
  function autoGatherOn() { return false; }

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
  function findChat(id) {
    /* 【v7.6 charlie】先过 id 迁移映射（resolveId 不依赖 DOM，早于 try 内调用防被吞） */
    try { if (window.ZFArrow && ZFArrow.resolveId) id = ZFArrow.resolveId(id); } catch (e) {}
    try {
      if (window.App && App.findChatBox) return App.findChatBox(id);
      var list = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) return list[i]; }
    } catch (e) {}
    return null;
  }
  function lastAnswer(chat) {
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
  function isChatBusy(chat) {
    return !!(chat && (chat.isSending || chat._thinking || chat.abortController || (chat.queue && chat.queue.length)));
  }
  function labelOf(p, st) {
    var rounds = p.rounds || 0;
    var hasScore = (typeof p.score === 'number');
    var _passLine = (typeof p.passLine === 'number') ? p.passLine : vaPassLine();
    var _stText = st.text;
    if (hasScore && (p.status === 'pending' || p.status === 'reviewing' || p.status === 'passed')) {
      _stText = (p.score >= _passLine) ? '审核完成' : '返回完成';
    }
    if (p.state === 'toSrc') {
      _stText = (p.status === 'modified' || (hasScore && p.score >= _passLine)) ? '返回完成' : '返回中';
    }
    return _stText + (rounds > 0 ? ('·第' + rounds + '轮') : '');
  }
  function getTitleOf(p, st) {
    return (p.question ? '【' + p.question + '】\n' : '') + '当前状态：' + st.text + '（已审核 ' + (p.rounds || 0) + ' 轮）（点击：把答案传给箭头指向的对话）';
  }

  /* ===== 持久化（数据本壳持有，含服务器双写） ===== */
  function persist() {
    var raw = null;
    try {
      var _mem = pairsOf().map(function (p) {
        return { srcId: p.srcId, qcId: p.dstId, state: p.state === 'toSrc' ? 'toSrc' : 'toQC', status: p.status, qcCount: p.qcCount || 0, rounds: p.rounds || 0, question: p.question || '',
          autoloop: !!p.autoloop, fpHistory: p.fpHistory || [], lastFailAns: p._lastFailAns || '', srcCount: p.srcCount || 0,
          score: (typeof p.score === 'number' ? p.score : null), passLine: p.passLine || vaPassLine(), scoreHistory: p.scoreHistory || [],
          lastHasFail: !!p._lastHasFail };
      });
      /* 【v7.2.2 宽限合并】内核 restore 保留的 _missAt 宽限条目不在内存实例里（对端框尚未恢复），
         persist 直接覆写会把它们洗掉 → 重启慢恢复场景箭头被永久误删。写盘前先合并回来。 */
      try {
        var _prev = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (Array.isArray(_prev)) {
          var _exist = {};
          _mem.forEach(function (x) { _exist[String(x.srcId) + '|' + String(x.qcId)] = 1; });
          _prev.forEach(function (d) {
            if (d && d._missAt && !_exist[String(d.srcId) + '|' + String(d.qcId)]) _mem.push(d);
          });
        }
      } catch (_eM) {}
      raw = JSON.stringify(_mem);
      localStorage.setItem(KEY, raw);
    } catch (e) {}
    if (raw !== null) {
      try {
        fetch('/api/verify-pairs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairs: raw }) }).catch(function () {});
      } catch (e) {}
    }
  }

  /* ===== 点击状态机（业务原样保留） ===== */
  function onArrowClick(pair, fromAuto) {
    var src = findChat(pair.srcId);
    var qc = findChat(pair.dstId);
    if (!src || !qc) { ZFArrow.remove(pair); return; }
    if (!fromAuto) {
      var _busyTarget = (pair.state === 'toDst') ? src : qc;
      if (isChatBusy(_busyTarget)) {
        toast('对方还在忙，等空闲后再点箭头传送', false);
        return;
      }
    }
    var note = pair._takeNote ? pair._takeNote() : '';
    if (pair.state === 'toDst') {
      /* 审核员 → 原对话：把审核建议送回 */
      var ans = lastAnswer(qc);
      if (!ans) { toast('审核员还没有答案，无法传送', false); return; }
      pair.state = 'toSrc';
      pair.srcCount = assistantCount(src);
      ZFArrow.setStatus(pair, 'revising');
      sendTo(src, '这是审核员给你的建议你去改一下：\n\n' + ans + note);
      toast('已把审核员的建议发给原对话（返回中）', true);
    } else {
      /* 原对话 → 审核员复审（重申评分协议） */
      var ans2 = lastAnswer(src);
      if (!ans2) { toast('原对话还没有答案，无法传送', false); return; }
      pair.state = 'toDst';
      pair.qcCount = assistantCount(qc);
      ZFArrow.setStatus(pair, 'reviewing');
      sendTo(qc, '他已经改好了请审核员再次审核（本轮复审同样必须输出评分）：\n\n【评分输出协议·强制】回复的最后一行必须单独输出：【审核评分】NN（NN 为 0-100 整数，例：【审核评分】85）。该行用于机器判定与记录，缺失会被视为未评分。\n\n' + ans2 + note);
      toast('已发给审核员复审（复审中）', true);
    }
  }

  /* ===== G1 指纹护栏（原样保留） ===== */
  function vaFingerprint(ans) {
    var s = String(ans || '').toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。、；：""''（）()\[\]【】!！?？.,;:*#\-—~·`]/g, '');
    s = s.slice(0, 240);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'f' + h.toString(36);
  }
  /* 箭头齐步 v5：同源全组都出结论后才统一上色（原样保留） */
  function _syncGroupStatus(pair) {
    try {
      var _all = pairsOf().filter(function (q) {
        return !q.dead && q.el && q.el.isConnected &&
               String(q.srcId) === String(pair.srcId) &&
               q.status !== 'suspended' && q.status !== 'failed' && !q._loopDone;
      });
      var _allDone = _all.every(function (q) {
        return q._pendingStatus || q.status === 'passed' || q.status === 'revising' || q.status === 'modified';
      });
      if (!_allDone) return;
      _all.forEach(function (q) {
        var _ps = q._pendingStatus;
        if (!_ps) return;
        q._pendingStatus = '';
        if (q.status !== _ps) { q.status = _ps; }
        ZFArrow.applyStatus(q);
      });
      ZFArrow.notifyMinimap(); persist();
    } catch (e) {}
  }

  /* ===== 回复自动检测（内核 detect 钩子） ===== */
  function detectReply(pair) {
    if (pair.status !== 'reviewing' && pair.status !== 'pending') return;
    var qc = findChat(pair.dstId);
    if (!qc) return;
    if (qc.isSending) return; /* v27 卡顿防误判 */
    var nowCount = assistantCount(qc);
    if (nowCount <= (pair.qcCount || 0)) return;
    var ans = lastAnswer(qc);
    if (!ans) return;
    pair.qcCount = nowCount;
    pair.rounds = (pair.rounds || 0) + 1;
    /* 一票否决判定 v2：先清洗否定句式再判 FAIL；分数低于及格线直接打回 */
    var ansCheck = String(ans).replace(NEG_RE, '');
    var _score = vaParseScore(ans);
    var _pass = vaPassLine();
    var hasFail;
    if (_score !== null && _score < _pass) { hasFail = true; }
    else { hasFail = FAIL_RE.test(ansCheck); }
    if (_score !== null && _score < _pass) hasFail = true;
    pair.score = _score;
    pair.passLine = _pass;
    if (_score !== null) {
      if (!Array.isArray(pair.scoreHistory)) pair.scoreHistory = [];
      pair.scoreHistory.push({ round: pair.rounds, score: _score, pass: _score >= _pass });
      try { vaAppendScoreLog({ t: Date.now(), srcId: pair.srcId, qcId: pair.dstId, round: pair.rounds, score: _score, passLine: _pass, pass: _score >= _pass, role: 'qc' }); } catch (e) {}
    }
    pair._lastHasFail = hasFail;
    pair._pendingStatus = hasFail ? 'revising' : 'passed';
    _syncGroupStatus(pair);
    ZFArrow.notifyMinimap(); persist();
    var _tip = '';
    if (_score !== null) _tip = '（评分 ' + _score + '/' + _pass + (hasFail && _score < _pass ? ' 不及格' : '') + '）';
    toast(hasFail ? ('审核员已回复' + _tip + '，点击箭头把建议传回原对话') : ('审核员已回复' + _tip + '，点击箭头即可传话'), !hasFail);
    /* autoloop G1/G4 护栏（原样保留） */
    if (pair.autoloop) {
      pair._verdictAt = Date.now();
      if (!hasFail) {
        pair.fpHistory = []; pair._lastFailAns = '';
        pair._autoPending = 'gather';
      } else {
        var _fp = vaFingerprint(ans);
        var _prev = pair.fpHistory || [];
        if (_prev.length && _prev[_prev.length - 1] === _fp && String(ans).trim() === String(pair._lastFailAns || '').trim()) {
          pair._autoPending = 'gather';
          pair._suspendAfterGather = true;
          return;
        }
        _prev.push(_fp);
        if (_prev.length > 3) _prev.shift();
        pair.fpHistory = _prev;
        pair._lastFailAns = String(ans).trim();
        pair._autoPending = 'gather';
      }
    }
    pair._replied = true;
    /* 收口权唯一化：账本上报 + 事件派发（原样保留） */
    try {
      var Ld = window.ZFDispatchLedger;
      if (Ld && typeof Ld.markReturned === 'function') Ld.markReturned(pair.srcId, pair.dstId);
    } catch (eRD) {}
    try { document.dispatchEvent(new CustomEvent('zf:crew-member-done', { detail: { srcId: String(pair.srcId), memberId: String(pair.dstId), src: 'verify-arrow' } })); } catch (eRE) {}
  }
  /* 原对话修改完成检测（v38 稳定窗口判据，原样保留） */
  var _srcSettleMs = 3500;
  function detectSrcModified(pair) {
    if (pair.status !== 'revising') return;
    var src = findChat(pair.srcId);
    if (!src) return;
    var _srcBusy = !!(src.isSending || src._thinking || src.abortController || (src.queue && src.queue.length));
    if (_srcBusy) { pair._srcSettleAt = 0; return; }
    var nowCount = assistantCount(src);
    if (nowCount <= (pair.srcCount || 0)) return;
    if (pair._srcCountSeen !== nowCount) {
      pair._srcCountSeen = nowCount;
      pair._srcSettleAt = Date.now();
      return;
    }
    if ((Date.now() - (pair._srcSettleAt || 0)) < _srcSettleMs) return;
    pair.srcCount = nowCount;
    pair._srcSettleAt = 0;
    pair._srcCountSeen = 0;
    ZFArrow.setStatus(pair, 'modified');
    ZFArrow.notifyMinimap(); persist();
    if (pair.autoloop) pair._autoPending = 'review';
    else toast('原对话已修改完成，点击箭头可发审核员复审', true);
  }
  /* 隐藏保活（内核 onMissing 钩子） */
  function onMissing(pair, missing) {
    if (!pair.el) return;
    if (missing) {
      if (pair.el.style.display !== 'none') { pair.el.style.display = 'none'; persist(); }
    } else {
      if (pair.el.style.display === 'none') {
        pair.el.style.display = '';
        ZFArrow.applyStatus(pair);
        persist();
        try { if (!pair._restoredToast) { pair._restoredToast = true; toast('箭头已随对话恢复（状态保留）', true); } } catch (eT) {}
      }
    }
  }

  /* ===== 自动回收编排器（保留结构；autoGatherOn 恒 false 即每帧早退） ===== */
  function p_hasConverge(srcId) {
    try {
      var g = window.ZFConvergeArrow && window.ZFConvergeArrow.getPairs ? window.ZFConvergeArrow.getPairs() : [];
      for (var i = 0; i < g.length; i++) if (String(g[i].srcId) === String(srcId)) return true;
    } catch (e) {}
    return false;
  }
  var _groupGatherTs = 0;
  function tryGroupAutoGather() {
    if (!autoGatherOn()) return;
    /* 自动回收已按用户要求停用（2026-11-01），保留结构与守卫供未来恢复 */
  }
  /* autoloop 闭环编排器：已停用（同上），保留钩位 */
  function autoLoopGather() { return; }

  /* ===== 创建（薄壳：渲染全委托内核） ===== */
  function create(srcChat, qcChat) {
    if (!srcChat || !qcChat || !srcChat.el || !qcChat.el) return;
    var inst = window.ZFArrow.create({
      srcId: srcChat.id, dstId: qcChat.id,
      kind: 'verify',
      type: 'sub', /* 派出小队箭头 → sub 小号 */
      colors: { line: CYAN, headStroke: '#7ff3ff', badgeText: '#00222a' },
      statuses: STATUS,
      badge: '审核中',
      state: 'toDst', status: 'pending',
      noteInput: true,
      persistKey: KEY, persist: persist,
      onClick: onArrowClick,
      detect: function (p) { detectReply(p); detectSrcModified(p); },
      onMissing: onMissing,
      getStatus: labelOf,
      getTitle: getTitleOf
    });
    if (inst) {
      inst.state = 'toDst';
      inst.question = firstQuestion(srcChat);
      inst.qcCount = assistantCount(qcChat);
      inst.autoloop = false;
      inst.fpHistory = [];
      inst.score = null;
      inst.scoreHistory = [];
      inst._gathered = false;
      persist();
    }
    return inst;
  }

  /* ===== 恢复（内核熔断 + 状态回填） ===== */
  function restorePairs(silent) {
    var n = window.ZFArrow.restore({
      key: KEY,
      rebuild: function (d) {
        var src = findChat(d.srcId), qc = findChat(d.qcId);
        if (!src || !qc) return null; /* 熔断 */
        var p = create(src, qc);
        if (!p) return null;
        p.state = d.state === 'toSrc' ? 'toSrc' : 'toDst';
        p.status = STATUS[d.status] ? d.status : 'pending';
        p.qcCount = d.qcCount || assistantCount(qc);
        p.rounds = d.rounds || 0;
        p.question = d.question || firstQuestion(src);
        p.fpHistory = d.fpHistory || [];
        p._lastFailAns = d.lastFailAns || '';
        p.score = (typeof d.score === 'number' ? d.score : null);
        p.passLine = d.passLine || vaPassLine();
        p.scoreHistory = d.scoreHistory || [];
        if (d.srcCount) p.srcCount = d.srcCount;
        p._lastHasFail = !!d.lastHasFail;
        ZFArrow.applyStatus(p);
        return p;
      }
    });
    if (n) {
      ZFArrow.notifyMinimap();
      if (!silent) toast('已恢复 ' + n + ' 条审核员箭头（含状态）', true);
      persist();
    }
    return n;
  }

  /* ===== 事件同步（multi 收口/发散联动，原样保留） ===== */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = ev.detail && ev.detail.srcId;
      pairsOf().forEach(function (p) {
        if (String(p.srcId) !== String(sid)) return;
        if (p.state !== 'toDst') return;
        if (p.status === 'suspended') return;
        var _wasPassed = (p.status === 'passed');
        p._autoPending = '';
        p.state = 'toSrc';
        p.srcCount = assistantCount(findChat(p.srcId) || {});
        p._autoPending = '';
        if (!_wasPassed) p.status = 'revising';
        ZFArrow.applyStatus(p); persist();
      });
    } catch (e) {}
  });
  document.addEventListener('zf-multi-scattered', function (ev) {
    try {
      var sid2 = ev.detail && ev.detail.srcId;
      pairsOf().forEach(function (p) {
        if (String(p.srcId) !== String(sid2)) return;
        if (p.state !== 'toSrc') return;
        p.state = 'toDst';
        p.status = 'pending';
        ZFArrow.applyStatus(p); persist();
      });
    } catch (e) {}
  });

  /* ===== 公开 API（签名不变，外部调用方零改动） ===== */
  window.ZFVerifyArrow = {
    create: function (s, q) { var r = create(s, q); ZFArrow.notifyMinimap(); return r; },
    /* 【v7.6.1 charlie】补暴露 restore（converge/thinker/summarizer 三壳均已暴露，唯独本壳漏了）：
       哨兵重建窗后 app-monitor._reviveArrowBonds 按 sh.restore(true) 触发各壳补恢复，无此键则审核箭头救不回来 */
    restore: function (silent) { restorePairs(silent); },
    getPairs: function () {
      return pairsOf().map(function (p) {
        return { srcId: p.srcId, qcId: p.dstId, state: p.state, status: p.status };
      });
    },
    /* 输入防丢（id 漂移兜底，原样保留） */
    takeNoteFor: function (boxId) {
      var arr = pairsOf();
      function takeOf(p) { return p._takeNote ? p._takeNote() : ''; }
      for (var i = 0; i < arr.length; i++) {
        var p = arr[i];
        if (String(p.dstId) === String(boxId) && p.el && p.el.isConnected) return takeOf(p);
        if (String(p.srcId) === String(boxId) && p.el && p.el.isConnected) { var _n = takeOf(p); if (_n) return _n; }
      }
      var _hitAny = false;
      for (var k = 0; k < arr.length; k++) {
        var pk = arr[k];
        if (pk.el && pk.el.isConnected && (String(pk.dstId) === String(boxId) || String(pk.srcId) === String(boxId))) { _hitAny = true; break; }
      }
      if (!_hitAny) {
        var _cands = [];
        for (var j = 0; j < arr.length; j++) {
          var q = arr[j];
          if (!q.el || !q.el.isConnected) continue;
          var _n2 = '';
          try { var ip = q.el.querySelector('.zfa-note input'); _n2 = (ip && ip.value.trim()) || (q.note && String(q.note).trim()) || ''; } catch (e) {}
          if (_n2) _cands.push(q);
        }
        if (_cands.length === 1) return takeOf(_cands[0]);
      }
      return '';
    },
    /* 批量回收（整理面板调用） */
    recallChild: function (boxId) {
      var arr = pairsOf();
      for (var i = 0; i < arr.length; i++) {
        var p = arr[i];
        if (String(p.dstId) === String(boxId) && p.el && p.el.isConnected && p.state === 'toDst') {
          try { onArrowClick(p, true); return true; } catch (e) { return false; }
        }
      }
      return false;
    },
    listAutoLoops: function () {
      return pairsOf().filter(function (p) { return p.autoloop; }).map(function (p) {
        return { srcId: p.srcId, qcId: p.dstId, status: p.status, rounds: p.rounds || 0, active: !p.dead && !p._loopDone };
      });
    },
    pauseAutoLoop: function (srcId) {
      var n = 0;
      pairsOf().forEach(function (p) {
        if (p.autoloop && (!srcId || String(p.srcId) === String(srcId))) { p._autoPending = ''; try { p.el.dataset.autoloop = 'paused'; } catch (e) {} p.autoloop = false; n++; }
      });
      persist(); ZFArrow.notifyMinimap();
      return n;
    },
    resumeAutoLoop: function (srcId) {
      var n = 0;
      pairsOf().forEach(function (p) {
        if ((!srcId || String(p.srcId) === String(srcId)) && (p.status === 'suspended' || (!p.autoloop && p.el && p.el.dataset.autoloop === 'paused'))) {
          p.autoloop = true; p.fpHistory = []; p._lastFailAns = ''; p._loopDone = false; p._verdictAt = Date.now();
          try { p.el.dataset.autoloop = 'on'; } catch (e) {}
          if (p.status === 'suspended') ZFArrow.setStatus(p, p.state === 'toDst' ? 'revising' : 'reviewing');
          n++;
        }
      });
      persist(); ZFArrow.notifyMinimap();
      return n;
    },
    autoGatherActive: function () { return autoGatherOn(); },
    getScoreLog: function () { try { return JSON.parse(localStorage.getItem(SCORE_LOG_KEY) || '[]'); } catch (e) { return []; } },
    scoreSummary: function () { return vaScoreSummary(); },
    getScoreHistory: function (srcId) {
      var arr = pairsOf();
      for (var i = 0; i < arr.length; i++) {
        if (String(arr[i].srcId) === String(srcId)) return (arr[i].scoreHistory || []).slice();
      }
      return [];
    }
  };

  /* ===== 启动恢复（localStorage + 服务器双源，内核熔断） ===== */
  (function waitRestore() {
    var tries = 0, serverFetched = false;
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
        try { _total = (JSON.parse(raw) || []).length; } catch (e) {}
        _done = pairsOf().filter(function (p) { return p.el && p.el.isConnected; }).length;
        if (!_total || _done >= _total) clearInterval(timer);
        return;
      }
      /* 本地无档 → 尝试服务器双写恢复一次 */
      if (!hasSaved && !serverFetched && anyBox && tries > 3) {
        serverFetched = true;
        fetch('/api/verify-pairs').then(function (r) { return r.json(); }).then(function (j) {
          try {
            if (j && j.pairs) { localStorage.setItem(KEY, j.pairs); restorePairs(true); }
          } catch (eS) {}
        }).catch(function () {});
      }
    }, 1000);
  })();
  // [verify-arrow] v3 薄壳已加载（内核版）
})();
