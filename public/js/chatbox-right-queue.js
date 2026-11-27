/* ==========================================================================
 * chatbox-right-queue.js — 注意力模式·右侧返回队列（P1）
 * 策划案：private/记忆/策划案-注意力模式-右侧返回队列.md（v1.3）
 * 收口箭头全部完成 → 暂存；用户点「回收」返回主对话 + 主对话AI回答完成 → 才入队弹卡
 * 交互：单击卡片主体=关闭（进已忽略折叠区可恢复）；双击=摄像机直达+就绪直接回收；
 *       「⬅ 回收」按钮=复用 ZFConvergeArrow.gatherFor 与点箭头本体 100% 等价
 * 提醒：语音复用 /api/tts+speechSynthesis（与任务成功播报同款晓萱音色）；
 *       窗口后台时 Web Notification（复用 app-extras.js 后台判定口径），srcId 去重
 * ========================================================================== */
(function () {
  'use strict';
  if (window.ZFRightQueue) return;

  var LS_KEY = 'zf_right_queue_items';   // 待处理队列（含成员分数快照）
  var LS_IGN = 'zf_right_queue_ignored'; // 已忽略（可恢复）
  var LS_VOICE = 'zf_rq_voice_enabled';  // 语音开关（默认开）
  var LS_HIST = 'zf_rq_score_history';   // 【v9 分数轮次历史】srcId -> [{round,ts,members:[{name,id,score}]}]

  function lsGet(key, fb) { try { return JSON.parse(localStorage.getItem(key) || fb); } catch (e) { return JSON.parse(fb); } }
  function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  var items = lsGet(LS_KEY, '[]'); // [{srcId,title,members:[{name,score}],ts,notified}]
  var ignored = lsGet(LS_IGN, '[]');

  /* ---------- 【v9 分数轮次历史账本】单一真源，收口面板/卡片共用 ----------
     zf_rq_score_history[srcId] = [{round, ts, members:[{name,id,score}]}]，最多 10 轮 FIFO；
     同 round 已存在 → 原地更新当轮分数（流式期间分数刷新，以最终分为准） */
  var HIST_MAX_ROUNDS = 10;
  function histAll() { return lsGet(LS_HIST, '{}'); }
  function histGet(srcId) { return histAll()[String(srcId)] || []; }
  function histRecord(srcId, members) {
    try {
      var round = 0;
      try {
        if (window.ZFConvergeArrow && window.ZFConvergeArrow.pairs) {
          window.ZFConvergeArrow.pairs.forEach(function (p) {
            if (String(p.srcId) === String(srcId)) round = Math.max(round || 0, (p.rounds || 0) + 1);
          });
        }
        if (!round && window.ZFNextRound && window.ZFNextRound.getRound) round = window.ZFNextRound.getRound(srcId) || 0;
      } catch (e0) {}
      round = round || 1;
      var all = histAll(); var arr = all[String(srcId)] || [];
      var last = null;
      for (var i = 0; i < arr.length; i++) if (arr[i].round === round) { last = arr[i]; break; }
      var snap = (members || []).map(function (m) { return { name: m.name, id: m.id, score: m.score }; });
      if (last) { last.members = snap; last.ts = Date.now(); }
      else { arr.push({ round: round, ts: Date.now(), members: snap }); if (arr.length > HIST_MAX_ROUNDS) arr = arr.slice(-HIST_MAX_ROUNDS); }
      all[String(srcId)] = arr; lsSet(LS_HIST, all);
    } catch (e) {}
  }

  /* ---------- 分数提取：复用单一真源 ZFChildRel.scoreOf（chatbox-child-rels.js）
     【v12 真实分数】用户拍板：分数必须是 AI 回复中的真实分数，不再按长度估分。
     抓不到真实分数时显示「—」 */
  function scoreOf(chat) {
    var s = (window.ZFChildRel && window.ZFChildRel.scoreOf) ? window.ZFChildRel.scoreOf(chat) : null;
    return (s != null) ? s : null;
  }

  /* ---------- 角色名提取：优先 _swarmLabel / 蜂群注册表 viewName / 角色绑定名，
     【v3】没有才退回对话标题（用户要求卡片显示「审核员/策划师」这类角色名而非对话名） ---------- */
  function memberName(chat, srcId) {
    try {
      if (chat && chat.el) {
        if (chat.el._swarmLabel) return String(chat.el._swarmLabel);
        var tEl = chat.el.querySelector('.title');
        var t = tEl ? String(tEl.textContent || '').trim() : '';
        if (/策划|审核|总结师|专家团/.test(t)) return t;
      }
      var reg = JSON.parse(localStorage.getItem('zf_swarm_registry') || '{}');
      var r = reg[String(chat && chat.id)];
      if (r && r.viewName) return String(r.viewName);
      var bind = JSON.parse(localStorage.getItem('zf_role_chat_' + (chat && chat.id)) || 'null');
      if (bind && bind.name) {
        var roleEl = chat && chat.el ? chat.el.querySelector('.title') : null;
        var label = roleEl ? String(roleEl.textContent || '').trim() : '';
        if (/策划|审核|总结师|专家团/.test(label)) return label; /* 标题已是角色形态优先 */
        return bind.name;
      }
    } catch (e) {}
    return chatTitle(chat);
  }

  function findChat(id) {
    var boxes = (window.App && App.chatBoxes) || [];
    for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (b && b.id != null && String(b.id) === String(id)) return b; }
    return null;
  }
  function chatTitle(chat) {
    try { return (chat && (chat.title || (chat.el && chat.el.dataset && chat.el.dataset.chatTitle))) || '对话'; } catch (e) { return '对话'; }
  }

  /* ---------- 收集该 srcId 的成员与分数（遍历收口 pair 的 memberIds） ---------- */
  function membersOf(srcId) {
    var out = [];
    try {
      var gps = window.ZFConvergeArrow && window.ZFConvergeArrow.getPairs ? window.ZFConvergeArrow.getPairs() : [];
      var seen = {};
      gps.forEach(function (g) {
        if (String(g.srcId) !== String(srcId)) return;
        /* 从箭头 DOM 无成员列表，改从 chatBoxes 按 _isThinkerChat/_isQcChat + src 标记兜底收集 */
      });
      var boxes = (window.App && App.chatBoxes) || [];
      boxes.forEach(function (b) {
        if (!b || !b.el) return;
        /* 【v3】isSub/srcId 复用单一真源 ZFChildRel（含总结师 _summarizerSrcId） */
        var CR = window.ZFChildRel;
        if (!CR) return;
        if (!CR.isSub(b.el)) return;
        var sid = CR.srcIdOf(b.el);
        if (sid == null || String(sid) !== String(srcId)) return;
        var key = String(b.id); if (seen[key]) return; seen[key] = 1;
        out.push({ name: memberName(b, srcId), score: scoreOf(b), id: b.id });
      });
    } catch (e) {}
    return out;
  }

  /* ---------- 视角名兜底：读蜂群注册表（v3：memberName 已含注册表逻辑，此处仅对旧快照条目做 name 规范化） ---------- */
  function refineNames(srcId, members) {
    try {
      var reg = JSON.parse(localStorage.getItem('zf_swarm_registry') || '{}');
      members.forEach(function (m) {
        var b = findChat(m.id);
        m.name = memberName(b, srcId);
        var r = reg[String(m.id)];
        if (r && r.viewName && !/策划|审核|总结师|专家团/.test(String(m.name))) m.name = r.viewName;
      });
    } catch (e) {}
    return members;
  }

  /* ---------- DOM ---------- */
  var container = null;
  function ensureContainer() {
    if (container && container.isConnected) return container;
    container = document.createElement('div');
    container.className = 'zf-right-queue';
    container.id = 'zf-right-queue';
    document.body.appendChild(container);
    return container;
  }

  /* ---------- 【v10 动态调整】刷新时：源对话已关闭 → 静默剔除；
     部分子对话关闭 → 卡片成员列表实时收缩（不死快照） ---------- */
  function pruneItems() {
    var changed = false;
    items = items.filter(function (it) {
      var src = findChat(it.srcId);
      if (!src) { if (it._el && it._el.isConnected) { it._el.remove(); } changed = true; return false; }
      var live = membersOf(it.srcId);
      if (live.length) { it.members = refineNames(it.srcId, live); }
      return true; /* 源对话还在：保留（成员可能中途关闭，members 动态收缩） */
    });
    if (changed) lsSet(LS_KEY, items);
  }

  function render() {
    var box = ensureContainer();
    pruneItems(); /* 【v10】每次渲染前动态修剪 */
    /* 【v2 修复·闪烁】改为增量渲染：已存在的卡片不重建，避免每次 zf:converge-ready
       重复触发（更新成员分数也会 render）导致 zfrqIn 入场动画无限重播=按钮闪烁 */
    var seen = {};
    items.forEach(function (it) {
      var key = String(it.srcId);
      seen[key] = true;
      if (it._el && it._el.isConnected) {
        /* 【v29】卡片已在DOM：只刷新积分榜内容（分数实时跟手），不重建整卡不重播动画 */
        try { if (typeof it._el._refreshScore === 'function') it._el._refreshScore(); } catch (eRS) {}
        return;
      }
      it._el = buildCard(it);
      box.appendChild(it._el);
    });
    /* 移除已消失条目的卡片 */
    Array.prototype.slice.call(box.querySelectorAll('.zf-rq-card')).forEach(function (el) {
      if (!seen[el._rqSrcId]) { el.remove(); }
    });
    var igEl = box.querySelector('.zf-rq-ignored');
    if (ignored.length) {
      if (!igEl) {
        igEl = document.createElement('div');
        igEl.className = 'zf-rq-ignored';
        igEl.addEventListener('click', function () {
          items = items.concat(ignored); ignored = [];
          lsSet(LS_KEY, items); lsSet(LS_IGN, ignored); render();
        });
        box.appendChild(igEl);
      }
      igEl.innerHTML = icon('box') + ' 已忽略 ' + ignored.length + ' 条待返回（点击恢复）';
      igEl.title = '点击全部恢复到队列';
    } else if (igEl) {
      igEl.remove();
    }
  }

  function buildCard(it) {
    var card = document.createElement('div');
    card.className = 'zf-rq-card zf-rq-ready';
    card._rqSrcId = String(it.srcId); /* 【v2】增量渲染用：DOM↔条目对应标识 */
    var title = document.createElement('div');
    title.className = 'zf-rq-title';
    /* 【S2 轮次徽标】【v26 修复】优先读收口箭头 pair.rounds（收口真实轮数，每次回收自动+1），
       下一轮面板账本（zfNextRoundRounds）仅在未建箭头时兜底——旧口径只读面板账本，
       用户走「再派出」路径时账本不 bump，导致实际第3轮徽标仍显示第1轮 */
    var roundNo = 0;
    try {
      if (window.ZFConvergeArrow && window.ZFConvergeArrow.pairs) {
        window.ZFConvergeArrow.pairs.forEach(function (p) {
          if (String(p.srcId) === String(it.srcId)) roundNo = Math.max(roundNo, (p.rounds || 0) + 1);
        });
      }
    } catch (eP) {}
    if (!roundNo) {
      try { if (window.ZFNextRound && window.ZFNextRound.getRound) roundNo = window.ZFNextRound.getRound(it.srcId) || 0; } catch (e) {}
    }
    var roundBadge = roundNo > 0 ? '<span class="zf-rq-round" title="该源对话已完成 ' + roundNo + ' 轮收口">' + icon('repeat') + ' 已完成 ' + roundNo + ' 轮</span>' : '';
    /* 【v21 职业名标题】卡片标题=「注意力箭头系统」固定文案+轮数徽标（用户拍板 2026-11-16） */
    title.innerHTML = escapeHtml('注意力箭头系统') + roundBadge +
      '<span class="zf-rq-close" title="关闭这张卡片（子对话不受影响）">' + icon('close') + '</span>';
    card.appendChild(title);
    /* 【v10 关闭按钮】点击 ✕ 只关卡片，不最小化不回收 */
    title.querySelector('.zf-rq-close').addEventListener('click', function (ev) {
      ev.stopPropagation();
      removeItem(it.srcId);
      if (card._el) card._el = null;
      card.classList.add('zf-rq-gone');
      setTimeout(function () { card.remove(); }, 260);
      try { toast && toast('已关闭该返回卡片', true); } catch (e) {}
    });

    /* 【v29 积分榜矩阵】成员为行、轮次为列：每轮分数+彩色增减箭头一张表看清。
       替代旧「按轮积分」流水行 + 成员「88→90 ↑2」序列两块重复展示
       （用户 2026-11-23 反馈：繁琐不清晰，要求每轮积分与变化一目了然）。
       卡片已在 DOM 时 render 只调 _refreshScore 换积分区内容，不重建整卡不重播动画 */
    /* 【v30 修复·积分区钉在按钮上方】旧写法直接 appendChild 到卡片末尾，增量刷新
       （_refreshScore）重建积分区后被挪到按钮排下面（用户 2026-11-23 反馈截图）；
       改为按钮排已存在时 insertBefore 到它前面，仅首次构建（按钮排还没建）才 append。
       【v30】整组没有任何真实积分 → buildScoreBoard 返回 null，整块不渲染不占位 */
    var fillScore = function () {
      var old = card.querySelector('.zf-rq-score, .zf-rq-members');
      if (old) old.remove();
      var board = buildScoreBoard(histGet(it.srcId), it.members || []);
      if (!board) return;
      var anchor = card.querySelector('.zf-rq-actions');
      if (anchor) card.insertBefore(board, anchor); else card.appendChild(board);
    };
    fillScore();
    card._refreshScore = fillScore;

    var actions = document.createElement('div');
    actions.className = 'zf-rq-actions';
    card.appendChild(actions);

    var btn = document.createElement('button');
    btn.className = 'zf-rq-btn zf-rq-primary';
    btn.innerHTML = icon('camera') + ' 直达';
    btn.title = '摄像机直达：镜头移动到该源对话的收口箭头位置';

    var recycleBtn = document.createElement('button');
    recycleBtn.className = 'zf-rq-btn zf-rq-recycle';
    /* 【v8 主对话完成→返回】discuss 阶段=主对话已消化并输出总结 → 按钮变「返回」，
       点击=再分发（箭头反转回角色组）；ready 阶段仍为「回收」（v11 线性图标） */
    var isDiscuss = it.stage === 'discuss';
    recycleBtn.innerHTML = isDiscuss ? icon('fwd') + ' 再派出' : icon('back') + ' 回收';
    recycleBtn.title = isDiscuss
      ? '再派出：把主对话最新结论再分发给角色组（箭头反转），开始新一轮讨论'
      : '与点击收口箭头完全等价：汇总回注源对话';
    actions.appendChild(btn);
    actions.appendChild(recycleBtn);

    /* 【2026-11-16 用户拍板】标题居中重设计：5 按钮合并同一排 + 标题居中 + 宽高可调（见 css） */
    var actions2 = actions; /* 不再单开一排：全部按钮追加进第一排 .zf-rq-actions */
    var sumBtn = document.createElement('button');
    sumBtn.className = 'zf-rq-btn zf-rq-sum';
    sumBtn.innerHTML = icon('doc') + ' 总结';
    sumBtn.title = '直接派出总结师沉淀本次任务，并关闭全部子对话';
    var progBtn = document.createElement('button');
    progBtn.className = 'zf-rq-btn zf-rq-progress';
    progBtn.innerHTML = '📊 查进度';
    progBtn.title = '派一个推进师查询工程进度（其他子对话将关闭）';
    var closeAllBtn = document.createElement('button');
    closeAllBtn.className = 'zf-rq-btn zf-rq-closeall';
    closeAllBtn.innerHTML = icon('trash') + ' 全关';
    closeAllBtn.title = '一键关闭该源对话派生的全部子对话（策划/审核/总结师等）';
    /* 调换按钮已于 v11 应用户要求移除 */
    /* 【2026-11-14 按钮重排】总结 → 查进度 → 全关 */
    actions2.appendChild(sumBtn); actions2.appendChild(progBtn); actions2.appendChild(closeAllBtn);
    /* 【v26 2026-11-20 用户拍板】右下角新增第 6 个「关闭」按钮：直接关闭这张卡片 */
    var closeCardBtn = document.createElement('button');
    closeCardBtn.className = 'zf-rq-btn zf-rq-closecard';
    closeCardBtn.innerHTML = icon('close') + ' 关闭';
    closeCardBtn.title = '关闭这张卡片（子对话与箭头不受影响）';
    closeCardBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      removeItem(it.srcId);
      render();
      try { toast && toast('已关闭这张卡片', true); } catch (eCC) {}
    });
    actions2.appendChild(closeCardBtn);

    /* 关闭子对话通用：遍历 chatBoxes 找 srcId 指向本源的子窗 */
    function closeAllMembers(srcId) {
      var closed = 0;
      try {
        var boxes = (window.App && App.chatBoxes) || [];
        var CR = window.ZFChildRel;
        boxes.slice().forEach(function (b) {
          if (!b || !b.el) return;
          var isSub = CR ? CR.isSub(b.el) : !!(b.el._isThinkerChat || b.el._isQcChat);
          if (!isSub) return;
          var sid = CR ? CR.srcIdOf(b.el) : (b.el._summarizerSrcId != null ? b.el._summarizerSrcId : null);
          if (sid == null || String(sid) !== String(srcId)) return;
          if (window.App && typeof App.closeChatBox === 'function' && document.body.contains(b.el)) { App.closeChatBox(b); closed++; }
        });
      } catch (e) {}
      return closed;
    }

    sumBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      try {
        var src = findChat(it.srcId);
        if (src && window.App && typeof App._summarizerExpand === 'function') {
          App._summarizerExpand(src.el, src); /* 默认工作总结模式，直派不弹菜单 */
          closeAllMembers(it.srcId);
          removeItem(it.srcId); render();
          try { toast && toast('已派出总结师并关闭全部子对话', true); } catch (e2) {}
        } else {
          try { toast && toast('总结师模块未就绪，无法派出', false); } catch (e2) {}
        }
      } catch (e) { try { toast && toast('总结失败：' + (e.message || e), false); } catch (e2) {} }
    });

    /* ── 【查进度 2026-11-14】一键查工程进度：只派一个推进师，其他子对话全部关闭 ── */
    progBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      try {
        var src0 = findChat(it.srcId);
        if (!src0 || !src0.el) { try { toast && toast('源对话已关闭，无法查进度', false); } catch (e0) {} return; }
        var _closedN = 0;
        var n = closeAllMembers(it.srcId);
        _closedN = n;
        if (window.App && typeof App._progressExpand === 'function') {
          try { if (window.ZFDispatchLedger && ZFDispatchLedger.registerExpected) ZFDispatchLedger.registerExpected(it.srcId, 1); } catch (e4) {}
          App._progressExpand(src0.el, src0);
          try { toast && toast('📊 推进师已派出查进度' + (_closedN ? '（已关闭 ' + _closedN + ' 个子对话）' : ''), true); } catch (e5) {}
        } else {
          try { toast && toast('推进师模块未加载', false); } catch (e6) {}
        }
      } catch (e) {
        try { toast && toast('查进度失败：' + (e.message || e), false); } catch (e7) {}
      }
    });

    closeAllBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      var n = closeAllMembers(it.srcId);
      try { toast && toast(n ? ('已关闭 ' + n + ' 个子对话') : '没有存活的子对话', n > 0); } catch (e) {}
      render(); /* 【v10】关完立即刷新：无存活成员的卡片收缩 */
    });



    /* 【v8 总结摘要】主对话摘要已于 v11 应用户要求移除（按钮下方不再展示主对话总结内容） */

    /* 直达按钮：摄像机移动到箭头位置 */
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try { if (window.App && App._focusCameraOn) { var _src = findChat(it.srcId); if (_src && _src.el) App._focusCameraOn(_src.el); } } catch (e) {}
    });

    card.title = '单击卡片=折叠进「已忽略」；双击=摄像机直达（就绪时第二击=回收）';
    card.style.cursor = 'default';
    /* 单/双击手势（300ms 判定）：按钮区即时响应不参与判定 */
    var clickTimer = null;
    card.addEventListener('click', function (ev) {
      if (ev.target === recycleBtn || recycleBtn.contains(ev.target)) return; // 回收按钮自己处理
      if (ev.target === btn || btn.contains(ev.target)) return; // 直达按钮自己处理
      if (ev.target === actions2 || actions2.contains(ev.target)) return; // 【v10】总结/全关按钮自己处理
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; onDblClick(it); return; }
      clickTimer = setTimeout(function () { clickTimer = null; onSingleClick(it); }, 300);
    });
    recycleBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      onRecycle(it);
    });
    return card;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  /* 【v11 线性图标】emoji → 线性 SVG 描边图标（stroke 风格，随文字颜色自适应） */
  var SVG_ICONS = {
    target: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.6"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><circle cx="8" cy="8" r="6"/><path d="M5 8.2l2 2 4-4.2"/></svg>',
    chat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M2.5 3.5h11v7h-6l-2.8 2.5v-2.5h-2.2z" stroke-linejoin="round"/><path d="M5 6.5h6M5 8.5h4"/></svg>',
    close: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" width="10" height="10"><path d="M2 2l8 8M10 2l-8 8"/></svg>',
    repeat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M2.5 8a5.5 5.5 0 019.6-3.6M13.5 8a5.5 5.5 0 01-9.6 3.6" stroke-linecap="round"/><path d="M12.5 1.5v3h-3M3.5 14.5v-3h3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M2.5 2.5v11h11" stroke-linecap="round"/><path d="M5 10.5l3-3.5 2 1.5 3.5-4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    camera: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><rect x="1.5" y="4" width="9" height="8" rx="1.2"/><path d="M10.5 7l4-2.5v7l-4-2.5z" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M14 8H2.5M6.5 3.5L2 8l4.5 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fwd: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M2 8h11.5M9.5 3.5L14 8l-4.5 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    doc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M4 1.8h6l2.5 2.5v9.9H4z" stroke-linejoin="round"/><path d="M6.5 7h3.5M6.5 9.5h3.5"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.8 9h6.4l.8-9" stroke-linejoin="round"/><path d="M6.8 7v4.5M9.2 7v4.5"/></svg>',
    box: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M2 4.5h12v7.5H2zM2 4.5l1.5-2.5h9l1.5 2.5M6 8h4"/></svg>',
    scroll: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" class="zf-rq-ic"><path d="M3.5 2.5h9v11h-9z"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/></svg>',
    up: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" width="9" height="9"><path d="M5 8V2M2 5l3-3 3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" width="9" height="9"><path d="M5 2v6M2 5l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flat: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" width="9" height="9"><path d="M1.5 5h7" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" width="9" height="9"><path d="M3 1.8v8.4L10 6z" stroke-linejoin="round"/></svg>',
    fold: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" width="9" height="9"><path d="M2.5 4.5L6 8l3.5-3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function icon(name) { return SVG_ICONS[name] || ''; }
  /* ---------- 【v29 积分榜矩阵】成员为行、轮次为列：每轮分数 + 与上一轮的增减彩色箭头 ----------
     - 最新一轮整列金色高亮（当前分数所在列，表头带·最新）
     - 增减：↑绿 / ↓红 / –灰，直接标在分数旁
     - 轮次多→横向滚动（角色名首列钉住）；成员多→纵向滚动（表头钉住）
     - 无轮次历史时退回简单成员分数行（.zf-rq-members）
     【v30】对话没有积分就不列出来（用户 2026-11-23 反馈：无分占位行不好看）：
     简单行模式只保留有真实分数的成员；矩阵模式剔除任何一轮都没分的行；
     一个有分的都没有 → 返回 null，整个积分区不渲染 */
  function buildScoreBoard(hist, liveMems) {
    var sec = document.createElement('div');
    if (!hist || !hist.length) {
      var scored = (liveMems || []).filter(function (m) { return m.score != null; });
      if (!scored.length) return null;
      sec.className = 'zf-rq-members';
      scored.forEach(function (m) {
        var row = document.createElement('div');
        row.className = 'zf-rq-mem';
        /* 【v20】「对话」占位名不展示：无有意义名时该行只显示积分 */
        var hasName = m.name && m.name !== '对话';
        var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = hasName ? m.name : '';
        if (!hasName) nm.style.display = 'none';
        var sc = document.createElement('span'); sc.className = 'sc';
        sc.textContent = m.score + ' 分';
        row.appendChild(nm); row.appendChild(sc); sec.appendChild(row);
      });
      return sec;
    }
    sec.className = 'zf-rq-score';
    var t = document.createElement('div');
    t.className = 'zf-rq-score-t';
    t.innerHTML = icon('chart') + ' 积分榜<span class="zfg-lg"><i class="up">↑</i>升 <i class="down">↓</i>降 <i>–</i>持平</span>';
    sec.appendChild(t);

    /* 行集合：当前存活成员优先，历史出现过的成员补在后面（已关闭仍可看其历史分） */
    var rows = []; var seenRow = {};
    function pushRow(id, name) {
      var k = (id != null ? 'i' + id : 'n' + name);
      if (seenRow[k]) return; seenRow[k] = 1;
      rows.push({ id: id, name: name });
    }
    (liveMems || []).forEach(function (m) { pushRow(m.id, m.name); });
    (hist[hist.length - 1].members || []).forEach(function (m) { pushRow(m.id, m.name); });

    /* 单元格取分：id 命中即定（即使该轮无分，显示—也不许同名顶替）；无 id 才退回同名 */
    function scoreIn(roundObj, row) {
      var arr = roundObj.members || []; var i; var m;
      if (row.id != null) {
        for (i = 0; i < arr.length; i++) { m = arr[i]; if (m.id != null && String(m.id) === String(row.id)) return (m.score != null ? m.score : null); }
      }
      for (i = 0; i < arr.length; i++) { m = arr[i]; if (String(m.name) === String(row.name)) return (m.score != null ? m.score : null); }
      return null;
    }

    /* 【v30】任何一轮都没有真实分数的行整行剔除：不再渲染「· — —」占位行；
       全都被剔除 → 返回 null，积分区整体不渲染 */
    rows = rows.filter(function (row) {
      for (var ri = 0; ri < hist.length; ri++) { if (scoreIn(hist[ri], row) != null) return true; }
      return false;
    });
    if (!rows.length) return null;

    var grid = document.createElement('div');
    grid.className = 'zf-rq-score-grid';
    grid.style.setProperty('--zn', String(hist.length));
    var scroll = document.createElement('div');
    scroll.className = 'zf-rq-score-scroll';
    scroll.appendChild(grid);

    function mkCell(cls, txt) { var d = document.createElement('div'); d.className = cls; if (txt) d.textContent = txt; return d; }

    /* 表头：角色 | 第1轮 … 第N轮（最新列金色高亮） */
    grid.appendChild(mkCell('zfg-h zfg-role', '角色'));
    hist.forEach(function (r, ri) {
      var last = ri === hist.length - 1;
      var h = mkCell('zfg-h' + (last ? ' zfg-cur' : ''), '第' + r.round + '轮' + (last && hist.length > 1 ? '·最新' : ''));
      if (last) h.title = '最新一轮（当前分数）';
      grid.appendChild(h);
    });

    rows.forEach(function (row) {
      var dispName = row.name && row.name !== '对话' ? row.name : '';
      var r0 = mkCell('zfg-role', dispName || '·');
      r0.title = dispName || (row.name || '（未命名对话）');
      if (!dispName) r0.classList.add('zfg-blank');
      grid.appendChild(r0);
      var prev = null;
      hist.forEach(function (r, ri) {
        var last = ri === hist.length - 1;
        var sc = scoreIn(r, row);
        var cd = mkCell('zfg-c' + (last ? ' zfg-cur' : ''));
        if (sc == null) {
          cd.textContent = '—';
          cd.classList.add('zfg-noscore');
        } else {
          cd.appendChild(document.createTextNode(String(sc)));
          if (prev != null) {
            var d = sc - prev;
            var dsp = document.createElement('span');
            dsp.className = 'zfg-d' + (d > 0 ? ' zfg-up' : (d < 0 ? ' zfg-down' : ''));
            dsp.textContent = d > 0 ? '↑' + d : (d < 0 ? '↓' + (-d) : '–');
            dsp.title = '较上一轮 ' + (d > 0 ? '+' + d : (d < 0 ? String(d) : '持平'));
            cd.appendChild(dsp);
          }
          prev = sc;
        }
        grid.appendChild(cd);
      });
    });

    sec.appendChild(scroll);
    return sec;
  }
  /* 【v9 S3】TTS 话术片段：有≥2轮且有变化的成员才念「XX分数由60升至90」 */
  function _histVoiceLine(srcId, members) {
    var _h = histGet(srcId); var out = [];
    (members || []).forEach(function (m) {
      var seq = [];
      _h.forEach(function (r) {
        for (var j = 0; j < (r.members || []).length; j++) {
          if (String(r.members[j].id) === String(m.id) && r.members[j].score != null) { seq.push(r.members[j].score); break; }
        }
      });
      if (seq.length >= 2 && seq[seq.length - 1] !== seq[0]) {
        out.push(m.name + '分数由' + seq[0] + (seq[seq.length - 1] > seq[0] ? '升至' : '降至') + seq[seq.length - 1]);
      }
    });
    return out.length ? '，' + out.join('，') : '';
  }

  /* ---------- 三个动作 ---------- */
  function removeItem(srcId) {
    items = items.filter(function (x) { return String(x.srcId) !== String(srcId); });
    lsSet(LS_KEY, items);
  }
  function onSingleClick(it) { // dismiss → 已忽略折叠区
    removeItem(it.srcId);
    ignored.push(it); if (ignored.length > 20) ignored = ignored.slice(-20);
    lsSet(LS_IGN, ignored); render();
  }
  function onDblClick(it) { // 摄像机直达箭头；就绪直接回收
    try { if (window.App && App._focusCameraOn) { var _src2 = findChat(it.srcId); if (_src2 && _src2.el) App._focusCameraOn(_src2.el); } } catch (e2) {}
    /* 就绪 → 第二击语义=直接回收（策划案 2.2 用户拍板口径）。
       gatherFor 自带全员就绪门槛（未就绪自动 no-op 返回 false），不会提前收口 */
    setTimeout(function () { tryGather(it); }, 600);
  }
  function tryGather(it) {
    /* 【v8】discuss 阶段第二击语义=返回（再分发）；ready 阶段=回收 */
    if (it.stage === 'discuss') return tryScatter(it);
    var ok = false;
    try { ok = !!(window.ZFConvergeArrow && ZFConvergeArrow.gatherFor && ZFConvergeArrow.gatherFor(it.srcId)); } catch (e) { ok = false; }
    if (ok) onRecycle(it); // gatherFor 就绪且执行成功 → 卡片了结
  }
  /* 【v8 返回】discuss 阶段：主对话最新结论再分发给角色组（箭头反转）。【v25】成功后卡片彻底了结（不弹「可返回」卡），下一轮由正常收口流程弹卡 */
  function tryScatter(it) {
    var ok = false;
    try { ok = !!(window.ZFConvergeArrow && ZFConvergeArrow.scatterFor && ZFConvergeArrow.scatterFor(it.srcId)); } catch (e) { ok = false; }
    if (ok) {
      /* 【v25 修复 2026-11-15】用户拍板：点「再派出」成功后不再弹「可返回」卡（一秒弹卡属 bug），
         只保留 toast 轻提示；卡片彻底了结，下一轮完成时再由正常收口流程弹卡 */
      removeItem(it.srcId);
      ignored = ignored.filter(function (x) { return String(x.srcId) !== String(it.srcId); });
      lsSet(LS_IGN, ignored);
      render();
      try { toast && toast('已再派出角色组，开始新一轮讨论', true); } catch (e2) {}
    } else {
      try { toast && toast('收口箭头未处于已回收状态（可能成员已关闭），无法返回', false); } catch (e2) {}
      removeItem(it.srcId); render();
    }
  }
  function onRecycle(it) {
    /* 【v8】discuss 阶段的「⬅ 回收」按钮点击 = 返回（再分发）语义 */
    if (it.stage === 'discuss') return tryScatter(it);
    var ok = false;
    try { ok = window.ZFConvergeArrow && ZFConvergeArrow.gatherFor(it.srcId); } catch (e) { ok = false; }
    /* 【v14 修复·P1】ok=false（未就绪/已回收）→ 失败提示并保留卡片供重试，不得误报成功 */
    if (!ok) {
      try { toast && toast('⚠️ 回收未完成：收口箭头未就绪或已被回收，卡片保留，可稍后重试', false); } catch (e2) {}
      return;
    }
    /* 【v14 记账·回收成功后】当前成员分数锚为「上次回笼分数」，重新派出后箭头/面板即显示
       这份回笼分数（child-rels.lastHistScore 同源读取）；成功路径只记一次（converge-ready
       自动回收成功时不落卡，此处是手动回收的唯一记账点，与 L692 自动回收互斥不重复） */
    try {
      var CR2 = window.ZFChildRel;
      if (CR2 && CR2.membersOf) histRecord(it.srcId, CR2.membersOf(it.srcId));
      else histRecord(it.srcId, refineNames(it.srcId, membersOf(it.srcId)));
    } catch (e4) {}
    /* 【v13/v14】一句话轻提示替代弹卡/确认面板：不再打断用户 */
    var _names = (it.members || []).map(function (m) { return m.name; }).join('、');
    try { toast && toast('♻️ 已回收' + (_names ? '（' + _names + '）' : '') + '，汇总已回注主对话', true); } catch (e3) {}
    removeItem(it.srcId);
    /* 同时清掉已忽略里的同 srcId（回收完成即彻底了结） */
    ignored = ignored.filter(function (x) { return String(x.srcId) !== String(it.srcId); });
    lsSet(LS_IGN, ignored); render();
  }
  function readyNow(srcId) {
    /* canGather 是账本内部方法非公开 API；就绪判定交由 gatherFor 自带门槛（未就绪 no-op），
       这里仅作保守估计供双击提示，不作为放行依据 */
    try { return (window.ZFConvergeArrow && ZFConvergeArrow.getPairs ? ZFConvergeArrow.getPairs().some(function (p) { return String(p.srcId) === String(srcId); }) : false); } catch (e) { return false; }
  }

  /* ---------- 语音（复用 /api/tts + speechSynthesis，与任务成功播报同款） ---------- */
  var lastVoiceTs = 0;
  function speak(text) {
    try { if (localStorage.getItem(LS_VOICE) === '0') return; } catch (e) {}
    var now = Date.now();
    if (now - lastVoiceTs < 8000) return; // 频控：8s 内多组并发只播一次
    lastVoiceTs = now;
    var fallback = function () {
      try {
        if (!('speechSynthesis' in window)) return;
        var synth = window.speechSynthesis;
        var vs = synth.getVoices() || [], v = null;
        for (var i = 0; i < vs.length; i++) if (/^zh(\b|[-_])/i.test(vs[i].lang)) { v = vs[i]; break; }
        var u = new SpeechSynthesisUtterance(text);
        if (v) u.voice = v; u.lang = 'zh-CN'; u.rate = 1; u.pitch = 1.05;
        synth.speak(u);
      } catch (e2) {}
    };
    try {
      var voice = localStorage.getItem('zfagent_tts_voice') || 'zh-CN-XiaoxuanNeural';
      var done = false; var fin = function () { if (!done) { done = true; } };
      fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, voice: voice }) })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function (buf) {
          if (!buf || buf.byteLength < 100) { fallback(); return; }
          var url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
          var audio = new Audio(url); audio.volume = 1;
          audio.onended = function () { try { URL.revokeObjectURL(url); } catch (e) {} };
          audio.onerror = function () { fallback(); };
          audio.play().catch(function () { fallback(); }); // 自动播放策略拦截 → 降级
        })
        .catch(function () { fallback(); });
    } catch (e) { fallback(); }
  }

  /* ---------- 系统通知（复用 app-extras 后台判定口径；srcId 去重） ---------- */
  function notify(it) {
    if (it.notified) return;
    try {
      if (!(document.hidden || !document.hasFocus())) return; // 前台不弹，右侧卡片已可见
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var lines = (it.members || []).map(function (m) { return m.name + ' ' + (m.score == null ? '—' : m.score + '分'); }).join('，');
      var n = new Notification('✅ 任务全部完成', { body: (it.title + '\n' + lines).slice(0, 180), tag: 'zf-rq-' + it.srcId });
      n.onclick = function () {
        try { window.focus(); n.close(); } catch (e) {}
        onRecycle(it); // 点击通知 = 聚焦 + 直接回收（策划案验收第8条）
      };
      it.notified = true; lsSet(LS_KEY, items);
    } catch (e) {}
  }

  /* ---------- 入队（srcId 幂等去重） ---------- */
  function enqueue(detail) {
    try {
      var srcId = String(detail.srcId);
      var stage = detail.stage === 'discuss' ? 'discuss' : 'ready';
      var exist = items.some(function (x) { return String(x.srcId) === srcId; });
      if (exist) { // 已在队列：更新成员分数；【v7】discuss 到达 → 升级徽标文案（可返回→可继续讨论）
        items.forEach(function (x) {
          if (String(x.srcId) === srcId) {
            x.members = refineNames(srcId, membersOf(srcId));
            histRecord(srcId, x.members); /* 【v9】记账：同轮原地更新 */
            if (stage === 'discuss' && x.stage !== 'discuss') {
              x.stage = 'discuss';
              if (x._el && x._el.isConnected) { x._el.remove(); x._el = null; } /* 强制重建卡片换文案 */
            }
          }
        });
        lsSet(LS_KEY, items); render(); return;
      }
      var src = findChat(srcId);
      if (!src) return; // 源对话已删除：静默丢弃
      var it = {
        srcId: srcId,
        stage: stage,
        title: chatTitle(src),
        members: refineNames(srcId, membersOf(srcId)),
        ts: Date.now(), notified: false
      };
      histRecord(srcId, it.members); /* 【v9】记账：新卡当轮分数入账本 */
      items.push(it); if (items.length > 10) items = items.slice(-10);
      lsSet(LS_KEY, items); render();
      speak(items.length > 1 ? (items.length + ' 组任务全部完成，可以返回' + _histVoiceLine(srcId, it.members)) : (stage === 'discuss' ? '主对话已消化回收内容，可以继续讨论' + _histVoiceLine(srcId, it.members) : '任务全部完成，可以返回' + _histVoiceLine(srcId, it.members)));
      notify(it);
    } catch (e) {}
  }

  /* ---------- 触发接入【v4 时机改造】----------
     用户拍板弹卡时机 = ①至少回收一次返回主对话 + ②主对话AI回答完成。
     链路：zf:converge-ready(成员全答完)→只暂存不弹卡；
           zf-multi-gathered(用户点「回收」，汇总回注主对话)→标记待主对话答完；
           App._onSendComplete(主对话本轮回答收口，app-sfx 同款挂法)→此刻才 enqueue 弹卡 */
  var stash = {};          /* srcId -> converge-ready 暂存 detail（未回收先攒着） */
  var pendingGather = {};  /* srcId -> true（已回收，等主对话答完） */

  function stashReady(detail) {
    try {
      var srcId = String(detail.srcId);
      var src = findChat(srcId);
      if (!src) return; /* 源对话已删除：静默丢弃 */
      stash[srcId] = { srcId: srcId };
    } catch (e) {}
  }

  /* 包装 _onSendComplete：主对话 AI 回答完成后放行弹卡（幂等，只包一层） */
  var _hookArmed = false;
  function armSendCompleteHook() {
    if (_hookArmed) return;
    _hookArmed = true;
    (function patch() {
      if (!window.App || typeof App._onSendComplete !== 'function') { setTimeout(patch, 300); return; }
      if (App._onSendComplete.__rqGate) return;
      var origComplete = App._onSendComplete;
      App._onSendComplete = function (box, chat) {
        var r = origComplete.apply(this, arguments);
        try {
          var sid = chat && chat.id != null ? String(chat.id) : null;
          if (sid && pendingGather[sid]) {
            /* 【v24 恢复 2026-11-15】用户拍板恢复 v15 删掉的弹卡时机：回收+主对话答完 →
               弹「再派出（可继续讨论）」discuss 卡（只弹再派出，自动回收流程不变、不弹回收卡） */
            delete pendingGather[sid];
            delete stash[sid];
            try {
              var src = findChat(sid);
              if (src) enqueue({ srcId: sid, stage: 'discuss' });
            } catch (e5) {}
          }
        } catch (e) {}
        return r;
      };
      App._onSendComplete.__rqGate = true;
    })();
  }

  document.addEventListener('zf:converge-ready', function (ev) {
    try {
      /* 【v13 全自动回收 2026-11-14】用户拍板：回收应全自动，不再弹卡让用户点。
         成员全部答完 → 直接 gatherFor 回笼（自带就绪门槛，未就绪 no-op），
         成功只给一句话 toast。
         【v25 2026-11-20】gatherFor 首击可能因瞬时原因失败（账本未核销/成员刚脱帧/3秒宽限未过），
         旧逻辑立即落「可返回」卡 → 用户被迫手动点。改为自动重试（最多3次、间隔2s），
         全部失败才落兜底卡。 */
      var d = ev.detail || {};
      var sid = String(d.srcId);
      var attempts = 0;
      var tryGatherAuto = function () {
        attempts++;
        var ok = false;
        try { ok = !!(window.ZFConvergeArrow && ZFConvergeArrow.gatherFor && ZFConvergeArrow.gatherFor(sid)); } catch (e2) { ok = false; }
        if (ok) {
          try {
            var CR2 = window.ZFChildRel;
            histRecord(sid, CR2 && CR2.membersOf ? CR2.membersOf(sid) : refineNames(sid, membersOf(sid)));
          } catch (e3) {}
          var _ms = refineNames(sid, membersOf(sid));
          var _names = _ms.map(function (m) { return m.name; }).join('、');
          try { toast && toast('♻️ 已自动回收' + (_names ? '（' + _names + '）' : '') + '，汇总回注主对话', true); } catch (e4) {}
          return;
        }
        if (attempts < 3) { setTimeout(tryGatherAuto, 2000); return; }
        /* 重试穷尽才落「可返回」卡兜底 */
        var exist = items.some(function (x) { return String(x.srcId) === sid; });
        if (exist) return;
        enqueue({ srcId: sid, stage: 'ready' });
      };
      tryGatherAuto();
    } catch (e) {}
  }, false);

  /* 回收完成广播（converge-arrow.js gatherFor 内 emit）：条件①达成 */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = String((ev.detail || {}).srcId);
      /* 【v5 修复·第二轮不弹卡】不再以 stash 为前置守卫：第一轮 ready→stash→gather 链路完整，
         但第二轮时序下 stash 可能是空的（ready 未发出/刚被消费/3秒宽限未过时用户就点了回收），
         守卫吞掉事件 → pendingGather 永不置位 → 主对话答完也不弹卡。
         修复口径（与用户拍板一致）：带箭头+已回收(条件①) → pendingGather 必置位并武装钩子；
         stash 仅作来源记录，不再是放行门槛。幂等：重复 gathered 不重复置位（delete 后 enqueue 才消费）。 */
      pendingGather[sid] = true;
      armSendCompleteHook();
      delete stash[sid]; /* 已消费，防止残留 */
    } catch (e) {}
  }, false);

  /* ---------- 刷新恢复：按存活对话恢复，源已删除的静默丢弃 ---------- */
  setTimeout(function () {
    try {
      items = items.filter(function (it) { return !!findChat(it.srcId); });
      /* 恢复时补拉一遍成员分数（可能比快照更新） */
      items.forEach(function (it) {
        var ms = membersOf(it.srcId);
        if (ms.length) it.members = refineNames(it.srcId, ms);
      });
      lsSet(LS_KEY, items); render();
    } catch (e) {}
  }, 3000); // 等 App.chatBoxes 就绪

  /* ---------- 对外 API（converge-arrow 挂载/调试用） ---------- */
  window.ZFRightQueue = {
    enqueue: enqueue,
    items: function () { return items.slice(); },
    ignoredCount: function () { return ignored.length; },
    render: render,
    scoreOf: scoreOf,
    /* 【v9】分数轮次历史单一真源：收口面板等复用 */
    scoreHistory: { get: histGet, record: histRecord }
  };
  // [right-queue] 注意力模式右侧返回队列已加载
})();
