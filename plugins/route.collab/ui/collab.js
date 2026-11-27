/* ============================ chatbox-collab.js ============================
 * 多路协作通气·前端派出与落窗（策划案 v3.3 一期 #1/#2，用户令：单目录，无双目录副本）
 *
 * 职责：
 *   1. ZFCollab.dispatch(srcChat, n) —— 面板「👥 协作师」卡入口：
 *      POST /api/plugin/collab/dispatch 建组 → 拿 {team_id, members:[{codename,token,protocol_head}]}
 *      → 逐窗 App.createChatBox 开「协作师」窗 → 窗挂 _collabTeam/_collabCodename/_collabToken
 *      → 协议头作为首条派单消息注入输入框并发送（per-lane 无全局串号，v3.1 反驳师③裁决落实）。
 *   2. agent-02-loop-core.js 发请求时经 ZFCollab.markPayload(chat, payload) 把
 *      _collab_team/_collab_codename 带进 payload → db.js L668 提升到 body 顶层 →
 *      pool_worker.run_upstream 顶层 collab_hear_inject 生效（耳旁听 + L1 心跳）。
 *   3. 组色徽章 + 耳挡格 + say 涟漪的可视化入口（fx 部分一期内联在本文件，不单开文件）。
 *
 * v4.1 父子收口（2026-11-24 用户令）：建组成功即在「父对话→子窗组」之间建一条
 * ZFConvergeArrow 协作收口箭头（collabTeam 标记；点击=按服务器 done 账本汇总回注父对话）。
 * ========================================================================== */
(function () {
  'use strict';

  var CODES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
  var HUE = { alpha: 210, bravo: 150, charlie: 30, delta: 285, echo: 95, foxtrot: 330, golf: 60, hotel: 260 }; // 组员色相（同组同色系）
  var API = '/api/plugin/collab/dispatch';

  function toast(msg) {
    try { if (window.App && typeof App._stepToast === 'function') App._stepToast(msg, false); } catch (e) { console.warn(msg); }
  }

  /* ---------- 派出：面板卡 fn 调这里 ---------- */
  /* 【v2 修复 2026-11-24】签名扩展：dispatch(srcChat, n, note, nArg)
     - note   = 面板「一句话叮嘱」（此前协作师卡 note:false → 任务永远空白）
     - nArg   = 点卡次数（卡点 2 次 = 一个 2 人组，不是两个组）
     面板派出循环会对同一角色连续调用 dispatch（错峰 500ms 每次 1 份），
     旧版每次调用都 POST 建组 → 派2个出去4个（两组各2人，实锤）。
     新版：800ms 防抖窗口内的再次调用直接「并入首组」扩员（charlie/delta），
     绝不新建第二组；任务文本三层取材：叮嘱 > 源窗标题 > 源窗首条用户消息。 */
  async function dispatch(srcChat, n, note, nArg) {
    note = String(note == null ? '' : note).trim();
    if (typeof nArg === 'undefined' || nArg === null) nArg = 1;
    nArg = parseInt(nArg, 10);
    if (!nArg || nArg < 1) nArg = 1;
    n = parseInt(n, 10);
    if (!n || n < 2) n = 2;
    if (n > CODES.length) n = CODES.length; // 【v8.0 代号池扩容】上限跟随 CODES（4→8）
    if (!window.App || typeof App.createChatBox !== 'function') { toast('❌ 对话组件未就绪'); return; }
    /* 任务描述四层取材（v3）：面板一句话叮嘱 > 源窗输入框未发送文本 > 源窗标题 > 源窗首条用户消息。
       【第④取材缺口修复 2026-11-24】用户最常见姿势=在源窗输入框打好字（如"写一首诗…李白.txt"）
       直接点 👥 卡派出、不点发送 → 标题/首条消息两层全空 → 协议头永远占位符 → 全组跑偏
       （7f85 组实测铁证：三窗【本次任务】全是"从主对话同步"）。 */
    var task = note;
    if (!task) {
      try {
        var _srcEl = srcChat && (srcChat.el || srcChat);
        var _inp = _srcEl && (_srcEl.querySelector('textarea.chatbox-input') || _srcEl.querySelector('textarea') || _srcEl.querySelector('.chatbox-input') || _srcEl.querySelector('input[type="text"]'));
        var _draft = _inp ? String(_inp.value || '').trim() : '';
        if (_draft) task = _draft.slice(0, 200);
      } catch (eI) {}
    }
    if (!task) {
      try { task = String((srcChat && srcChat.title) || ''); } catch (eT) { task = ''; }
    }
    if (!task && srcChat && srcChat.history && srcChat.history.length) {
      try {
        for (var i0 = 0; i0 < srcChat.history.length; i0++) {
          var m0 = srcChat.history[i0];
          if (m0 && !m0._meta && m0.role === 'user') { task = String(m0.content || '').replace(/<[^>]+>/g, '').slice(0, 200); break; }
        }
      } catch (eH) { task = ''; }
    }

    /* 【v4.3 上下文简报 2026-11-24】协作师出门带父对话背景（审核师/收口蜂群同款思路）：
       从 srcChat.messages/history 提取「最近用户诉求 + 最近 AI 结论」，做成一段
       【主对话背景】注入协议头——子成员不必瞎猜"主对话正在干嘛"，跑偏率大幅下降。
       过滤 _meta/报错占位/协作注入，双向各取 N 条，全部 try 包裹（源窗结构异常时静默降级为无简报）。 */
    function _ctxMsgs(chat) {
      try {
        if (chat && Array.isArray(chat.messages) && chat.messages.length) return chat.messages;
      } catch (eM) {}
      try {
        if (chat && Array.isArray(chat.history)) return chat.history;
      } catch (eH2) {}
      return [];
    }
    function _ctxClean(t) {
      return String(t || '')
        .replace(/<[^>]+>/g, ' ')                          /* 剥 HTML 标签 */
        .replace(/\[(?:协作旁听|协作协议[^\]]*)\][\s\S]*$/g, '') /* 剥协作注入/协议头自身 */
        .replace(/（网络错误，发送失败|⚠️\s*请求失败|请求超时|模型未配置|发送失败）[\s\S]*$/g, '') /* 剥报错占位 */
        .replace(/\s+/g, ' ').trim();
    }
    function _ctxBrief(chat) {
      var ms = _ctxMsgs(chat), brief = { asks: [], replies: [] };
      for (var i = ms.length - 1; i >= 0; i--) {
        var m = ms[i];
        if (!m || m._meta || !m.role) continue;
        if (m.role === 'user' && brief.asks.length < 3) {
          var u = _ctxClean(m.content || m.text || '');
          if (u && u.length > 4 && u.indexOf('【协作') !== 0 && u.indexOf('[协作协议') !== 0) brief.asks.push(u.slice(0, 120));
        } else if (m.role === 'assistant' && brief.replies.length < 2) {
          var a = _ctxClean(m.content || m.text || '');
          if (a && a.length > 20) brief.replies.push(a.slice(0, 150));
        }
        if (brief.asks.length >= 3 && brief.replies.length >= 2) break;
      }
      return brief;
    }
    function _ctxRender(b) {
      if (!b.asks.length && !b.replies.length) return '';
      var out = '\n【主对话背景】（派出你的对话最近在聊什么，供理解任务用；与你的分内事冲突时以【本次任务】为准）';
      if (b.asks.length) out += '\n- 用户最近诉求：' + b.asks.join(' / ');
      if (b.replies.length) out += '\n- AI 最近结论：' + b.replies.join(' / ');
      return out;
    }
    var _ctxB = null;
    try { _ctxB = _ctxRender(_ctxBrief(srcChat)); } catch (eC) { _ctxB = ''; }

    /* 【防抖并入 2026-11-24】800ms 内的再次 dispatch = 面板错峰循环的下一份：
       并入首组扩员（重发 n=groupSize+nArg 建组请求），返回原 team_id 新 members，
       只为新成员开窗；首组已开窗不重开、token 不变，绝无第二组。 */
    try {
      if (dispatch._last && (Date.now() - dispatch._last.ts) < 800) {
        var cur = dispatch._last.groupSize;
        var want = Math.min(4, cur + nArg);
        if (want > cur) {
          var rr = null;
          try {
            rr = await fetch(API, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ task: dispatch._last.task, n: want, team_id: dispatch._last.teamId })
            }).then(function (x) { return x.json(); });
          } catch (eF) { rr = null; }
          if (rr && rr.ok && rr.team_id === dispatch._last.teamId && rr.members) {
            dispatch._last.groupSize = want;
            var opened2 = 0;
            for (var k2 = cur; k2 < rr.members.length; k2++) {
              var c2 = openCollabWindow(rr.members[k2], rr.team_id, dispatch._last.task, k2, srcChat, _ctxB);
              if (c2) opened2++;
            }
            toast('👥 已并入组 ' + rr.team_id + '（扩至 ' + want + ' 路）');
          } else {
            toast('❌ 并入失败：' + ((rr && rr.error) || '未知错误'));
          }
        }
        return; /* 防抖窗内一律并入，绝不建第二组 */
      }
    } catch (eDedup) {}

    // 1) 后端建组（flag 关/内部错都会 ok:false，前端不动任何窗——零残留）
    var r;
    try {
      r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task, n: n, parent_chat_id: (srcChat && srcChat.id) ? String(srcChat.id) : '' })
      }).then(function (x) { return x.json(); });
    } catch (e) { toast('❌ 协作建组请求失败：' + (e.message || e)); return; }
    if (!r || !r.ok || !r.team_id || !r.members || !r.members.length) {
      toast('❌ 协作建组失败：' + ((r && r.error) || '未知错误') + '（协作师通道未启用？）');
      return;
    }
    dispatch._last = { ts: Date.now(), teamId: r.team_id, task: task, groupSize: r.members.length };

    // 2) 逐窗开协作师窗 + 挂 per-lane 标记 + 注入协议头首条消息
    var opened = [];
    for (var k = 0; k < r.members.length; k++) {
      var mem = r.members[k];
      var chat = openCollabWindow(mem, r.team_id, task, k, srcChat, _ctxB);
      if (chat) opened.push(chat);
    }
    if (opened.length) {
      toast('👥 协作组 ' + r.team_id + ' 已派出 ' + opened.length + ' 路（alpha↔bravo 互相旁听，耳挡 L1）');
      // 【v4.5 chat_id 回绑】开窗后把真实窗 id 回绑服务器（修「成员 chat_id 全空」：collect 可定位子窗）
      try {
        var binds = opened.map(function (c, i2) { return { codename: r.members[i2].codename, chat_id: String(c.id || '') }; });
        binds = binds.filter(function (b) { return b.codename && b.chat_id; });
        if (binds.length) {
          fetch('/api/plugin/collab/bind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team_id: r.team_id, binds: binds }) }).catch(function () {});
        }
      } catch (eBind) {}
      // 【v4.1 父子收口·默认开】建组成功 → 父→子组协作收口箭头（点击=按 done 账本汇总回注）
      try { createTeamArrow(srcChat, opened, r.team_id); } catch (eArrow) { console.warn('[ZFCollab] 收口箭头创建失败:', eArrow); }
    } else {
      toast('❌ 协作窗全部创建失败（窗口数量限制？）');
    }
  }

  /* ---------- v4.1 父子收口：建「父→子组」协作收口箭头（复用 ZFConvergeArrow 薄壳） ---------- */
  function createTeamArrow(srcChat, opened, teamId) {
    if (!window.ZFConvergeArrow || typeof window.ZFConvergeArrow.create !== 'function') return;
    var inst = window.ZFConvergeArrow.create(srcChat, opened, '协作组 ' + teamId.slice(-4), null);
    if (!inst) return;
    inst.collabTeam = teamId; /* 收口走服务器 done 账本的标记 */
    try { if (inst.el) inst.el.title = '协作组收口箭头：全员完成后点击 = 按 done 账本汇总回注父对话'; } catch (e) {}
    /* 【v4.4 子箭头】父→每个协作师窗各一条小箭头（用户令：每个协作师都有一个箭头，外加一条总箭头）。
       sub 小号不与总箭头抢屏；组色区分；点击=读该窗最后一条 assistant 回复回注父对话（单窗局部收口）。 */
    try {
      opened.forEach(function (c) {
        var s = makeMemberArrow(srcChat, c, teamId);
        if (s) memberArrows.push(s);
      });
    } catch (eMA) { console.warn('[ZFCollab] 子箭头创建失败:', eMA); }
  }

  /* ---------- v4.4 子箭头（collab-sub）：一条/协作师窗 ---------- */
  var memberArrows = [];           /* 本组子箭头实例（随窗熔断由内核 onMissing 兜底） */
  var SUB_STATUS = {
    working:  { color: '#4fc3f7', text: '协作中', flow: true },
    replied:  { color: '#00e676', text: '已回复', flow: false },
    failed:   { color: '#9e9e9e', text: '已失效', flow: false }
  };
  function makeMemberArrow(srcChat, memberChat, teamId) {
    if (!window.ZFArrow || typeof window.ZFArrow.create !== 'function') return null;
    if (!srcChat || !memberChat || !srcChat.el || !memberChat.el) return null;
    var code = String(memberChat._collabCodename || '?');
    var hue = HUE[code] || 210;
    var lastAns = function (ch) {
      try {
        var META = '\u23F1__TASKMETA__';
        var h = ch.history || [];
        for (var i = h.length - 1; i >= 0; i--) {
          if (h[i].role === 'assistant') {
            var t = String(h[i].content || '');
            if (t.indexOf(META) === 0) continue;
            if (t.trim()) return t;
          }
        }
      } catch (e) {}
      return '';
    };
    var inst = window.ZFArrow.create({
      srcId: srcChat.id, dstId: memberChat.id,
      kind: 'collab-sub',
      type: 'sub', /* 派出小队箭头 → sub 小号（约 main 60%），总箭头保持大号 */
      colors: { line: 'hsl(' + hue + ',80%,60%)', headStroke: '#e1f5fe', badgeText: '#0d1b2a' },
      statuses: SUB_STATUS,
      badge: '协作中',
      state: 'toDst', status: 'working',
      noteInput: false,
      persistKey: 'zf_collab_sub_pairs',
      persist: function () {
        try {
          var list = window.ZFArrow.all().filter(function (p) { return p.kind === 'collab-sub'; });
          localStorage.setItem('zf_collab_sub_pairs', JSON.stringify(list.map(function (p) {
            return { srcId: p.srcId, dstId: p.dstId, state: p.state, status: p.status, team: p.collabTeam || '', code: p.collabCode || '' };
          })));
        } catch (e) {}
      },
      onMissing: function (pair, missing) {
        try {
          if (!pair.el) return;
          if (missing) { if (pair.el.style.display !== 'none') { pair.el.style.display = 'none'; } }
          else if (pair.el.style.display === 'none') { pair.el.style.display = ''; window.ZFArrow.applyStatus(pair); }
        } catch (e) {}
      },
      onClick: function (pair) {
        /* 点击子箭头 = 把该协作师窗最新回复回注父对话（局部收口；总箭头仍走 done 账本全组收口） */
        var findBox = function (id) {
          try {
            var L = (window.App && App.chatBoxes) || [];
            for (var i = 0; i < L.length; i++) {
              var b = L[i];
              if (b && String(b.id) === String(id) && b.el && b.el.isConnected) return b;
            }
          } catch (e) {}
          return null;
        };
        var src = findBox(pair.srcId), dst = findBox(pair.dstId);
        if (!src || !dst) { try { toast('子箭头目标窗已关闭，无法回注'); } catch (e2) {} return; }
        var txt = lastAns(dst);
        if (!txt) { try { toast('该协作师窗还没有回复可收'); } catch (e2) {} return; }
        try {
          src.history.push({ role: 'user', content: '【收口·' + code + '】以下是该协作师的最新回复，请核对其是否完成任务并给出判断：\n' + txt.slice(0, 4000) });
          if (typeof src.render === 'function') src.render();
          if (typeof src.sendToModel === 'function') src.sendToModel();
          pair.status = 'replied'; window.ZFArrow.applyStatus(pair);
          try { toast('已把 ' + code + ' 的回复回注父对话（局部收口）', true); } catch (e2) {}
        } catch (eI) { console.warn('[ZFCollab] 子箭头回注失败:', eI); }
      },
      detect: function (p) {
        /* 徽章联动：该窗有回复 → 已回复 */
        try {
          var L = (window.App && App.chatBoxes) || [];
          for (var i = 0; i < L.length; i++) {
            var b = L[i];
            if (b && String(b.id) === String(p.dstId) && b.el && b.el.isConnected) {
              if (lastAns(b) && p.status === 'working') { p.status = 'replied'; window.ZFArrow.applyStatus(p); }
              break;
            }
          }
        } catch (e) {}
      },
      getTitle: function (p, st) {
        return '协作师·' + (p.collabCode || '?') + ' 子箭头（组 ' + String(p.collabTeam || '').slice(-4) + '）当前：' + st.text + '（点击=把该协作师回复回注父对话）';
      }
    });
    if (inst) {
      inst.collabTeam = String(teamId || memberChat._collabTeam || '');
      inst.collabCode = code;
    }
    return inst || null;
  }

  /* 子箭头恢复：页面刷新后按 localStorage 重建（窗已关的不恢复） */
  function restoreMemberArrows() {
    try {
      var arr = JSON.parse(localStorage.getItem('zf_collab_sub_pairs') || '[]');
      if (!arr.length || !window.ZFArrow) return;
      var boxes = (window.App && App.chatBoxes) || [];
      arr.forEach(function (rec) {
        var src = null, dst = null;
        boxes.forEach(function (b) {
          if (!b || !b.el || !b.el.isConnected) return;
          if (String(b.id) === String(rec.srcId)) src = b;
          if (String(b.id) === String(rec.dstId)) dst = b;
        });
        if (!src || !dst || !dst._collabTeam) return; /* 源/目标窗任一不在 → 放弃该条 */
        var s = makeMemberArrow(src, dst, String(dst._collabTeam || ''));
        if (s) {
          s.collabTeam = rec.team || '';
          s.collabCode = rec.code || (dst._collabCodename || '');
          if (rec.status) s.status = rec.status;
          window.ZFArrow.applyStatus(s);
          memberArrows.push(s);
        }
      });
    } catch (e) {}
  }
  setTimeout(function () { try { restoreMemberArrows(); } catch (e) {} }, 1200);

  /* ---------- 开单窗 ---------- */
  function openCollabWindow(mem, teamId, task, idx, srcChat, ctxBrief) {
    var code = String(mem.codename || CODES[idx] || 'alpha');
    // 落点：贴源窗右下（与施工队/审核员同口径），无源窗回退固定坐标
    var x = 90 + idx * 46, y = 90 + idx * 46;
    try {
      var srcEl = srcChat && srcChat.el;
      if (srcEl && document.body.contains(srcEl)) {
        var offW = srcEl.offsetWidth || 420, offH = srcEl.offsetHeight || 300;
        var _l = parseFloat(srcEl.style.left), _t = parseFloat(srcEl.style.top);
        if (isFinite(_l) && isFinite(_t)) { x = _l + offW + 10 + idx * 20; y = _t + offH + 10 + idx * 20; }
      }
    } catch (e) {}
    var chat = null;
    try { chat = App.createChatBox(Math.round(x), Math.round(y), null, true); } catch (e) { chat = null; }
    if (!chat) { console.warn('[ZFCollab] createChatBox 被拦截:', teamId, code); return null; }

    var boxEl = chat.el ? chat.el : chat;
    // per-lane 协作标记（真源：agent-02-loop-core markPayload 只认这三样；绝不走全局 _zfCustomNoteNext）
    chat._collabTeam = teamId;
    chat._collabCodename = code;
    chat._collabToken = String(mem.token || '');
    try { boxEl.dataset.collabTeam = teamId; boxEl.dataset.collabCode = code; } catch (e) {}

    // 窗头命名 + 组色描边 + 耳挡格（可视化一期内联版）
    var hue = HUE[code] || 210;
    try {
      chat.title = '协作师·' + code;
      boxEl._swarmLabel = '协作师·' + code;
      var tEl = boxEl.querySelector('.title');
      if (tEl) { tEl.textContent = '👥 协作师·' + code; tEl.title = '协作组成员（组 ' + teamId + '·代号 ' + code + '）'; }
      boxEl.style.boxShadow = '0 0 0 2px hsla(' + hue + ',80%,55%,.55), 0 6px 24px rgba(0,0,0,.4)';
      badgeEar(boxEl, 1);
      hudEnsure(boxEl, code); /* 【v6】五件套动态 HUD：眼/耳/嘴/笔/回执 */
      /* 【v5.0 动态可视化·bravo】窗头状态徽章（👁听/💬说/⚙干/✅收/🏁完成/📣被叫）：
         开窗即「在听·眨眼」，人类一眼看出这个窗活着且在旁听 */
      ensureFxLayer(boxEl, code);
      fx(chat, 'hear', '旁听中', true);
    } catch (e) {}

    // 协议头 = 派单首条模型消息（自带 say 用法说明 + per-lane token；模型照协议头自发调 collab 工具）
    var head = String(mem.protocol_head || '');
    var pack = head
      + '\n【本次任务】\n' + (task || '（从主对话同步，见旁听提要）')
      + (ctxBrief || '')   /* 【v4.3】主对话背景简报段（无则不注入） */
      + '\n【协作规约】你是组成员 ' + code + '，另有同伴在并行干活：'
      + '\n- 需要告诉同伴结论/进展时，调 collab 工具 action=say（一句话结论，勿提问；每分钟限 6 条）'
      + '\n- 同伴的动向会以「[协作旁听]」系统消息自动出现在你的对话里，读到即可，无需回复'
      + '\n- 完成自己的分内事优先，say 只在有关键结论时用';
    /* 【v7.6 协议头隐形化·2026-11-26 用户令「像其他师那样不显形」】
       其他师（反驳师等 agent-01 L2281-2295）同款三步隐形链路：
       ① App.addMsg 只显示一条轻量摘要气泡（用户看到的就这一小条）
       ② 完整协议包直接 push 进 chat.history（大模型可见，不上屏）
       ③ App.sendToModel 直接触发模型轮（不走输入框/发送按钮）
       老输入框路径保留为异常兜底（addMsg/sendToModel 不可用时降级，行为同旧版）。 */
    (function _inject(tries) {
      tries = tries || 0;
      try {
        var _canStealth = typeof App !== 'undefined' && typeof App.sendToModel === 'function'
          && (typeof App.addMsg === 'function' || !boxEl.querySelector('textarea'));
        if (_canStealth) {
          // ① 轻量摘要气泡（占位可见的就这一条，样式与「素材包」摘要同口径）
          try {
            if (typeof App.addMsg === 'function') {
              App.addMsg(boxEl, '（协作派单·' + code + '·组 ' + teamId + '，协议+任务共 ' + pack.length + ' 字，已注入）', 'user');
            }
          } catch (eAm) {}
          // ② 完整协议包直接进 history（不进 DOM、不进输入框）
          chat.history.push({ role: 'user', content: pack, _collabBoot: true });
          try { Store && Store.addLog && Store.addLog('info', chat.id, 'collab', '协议头已隐形注入（' + pack.length + ' 字）'); } catch (eLog) {}
          // ③ 直接触发模型轮
          setTimeout(function () { try { App.sendToModel(boxEl, chat); } catch (eStm) { console.warn('[ZFCollab] sendToModel 失败，回退输入框路径:', eStm); _legacyInject(); } }, 60);
          return;
        }
      } catch (e) {}
      _legacyInject();
      function _legacyInject() {
        /* 兜底老路径：塞输入框→点发送（App 链路不可用时才走，行为同旧版显形） */
        try {
          var input = boxEl.querySelector('textarea') || boxEl.querySelector('.chatbox-input') || boxEl.querySelector('input[type="text"]');
          var btn = boxEl.querySelector('.send-btn');
          if (input && btn && !input.value) {
            input.value = pack;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(function () { try { btn.click(); } catch (e) { console.warn('[ZFCollab] btn.click 失败:', e); } }, 60);
            return;
          }
        } catch (e) {}
        if (tries < 20) setTimeout(function () { _inject(tries + 1); }, 300);
        else console.warn('[ZFCollab] 协议头注入失败:', teamId, code);
      }
    })(0);

    fxRippleOn(chat, teamId, code);
    /* 【v5.0】发送按钮挂「干活」钩子：用户/哨兵点发送 → 该窗进入工作态（三点跳动） */
    try {
      var _sb = boxEl.querySelector('.send-btn');
      if (_sb && !_sb._zfCollabWorkHook) {
        _sb._zfCollabWorkHook = true;
        _sb.addEventListener('click', function () { fx(chat, 'work', '干活中…', true); }, true);
      }
    } catch (eW2) {}
    return chat;
  }

  /* ==================== v5.0 动态可视化·bravo（2026-11-24） ====================
   * 用户令：「协作师的眼睛嘴等动态，带动画，让人类一下子知道你们在干什么」。
   * 窗头状态徽章五态（组色染色，人类一眼读懂）：
   *   👂 在听   —— 眨眼动画（hear 旁听；开窗默认态）
   *   💬 在播报 —— 嘴部涟漪扩散（say 广播/定向，半径=让远处也看见）
   *   ⚙ 干活中 —— 三点跳动（工具循环中）
   *   📡 回执   —— ping 波纹一圈（ack 回执）
   *   🏁 完成   —— 绿光呼吸（done 收口）
   *   📣 被插话 —— 红色抖动 2.6s（inject 定向唤醒，最抓眼球）
   * 同步机制：localStorage 'zf_collab_fx' + storage 事件 → 本页所有窗 + 父页组状态条
   * 都能瞬时联动（同页多窗直接 DOM 也可达，storage 事件统一走一条路）。
   * ========================================================================== */
  var FX_KINDS = {
    hear:   { icon: '👂', label: '在听',    cls: 'hear'   },
    say:    { icon: '💬', label: '在播报',  cls: 'say'    },
    work:   { icon: '⚙', label: '干活中…', cls: 'work'   },
    ack:    { icon: '📡', label: '已回执',  cls: 'ack'    },
    done:   { icon: '🏁', label: '完成',    cls: 'done'   },
    inject: { icon: '📣', label: '被插话',  cls: 'inject' }
  };
  var FX_HOLD = { hear: 0, say: 4500, work: 0, ack: 4000, done: 0, inject: 2600 }; // ms，0=常驻态；【v5.2】say 6000→4500 说完 4.5s 还挂「在播报」偏误导

  /* 窗头徽章 DOM：id=徽章+状态文字，一次性创建 */
  function ensureFxLayer(boxEl, code) {
    try {
      if (!boxEl || boxEl.querySelector('.zf-collab-fx')) return;
      var hue = HUE[code] || 210;
      var fx = document.createElement('div');
      fx.className = 'zf-collab-fx';
      fx.style.cssText = 'position:absolute;top:-10px;left:10px;z-index:6;display:flex;align-items:center;gap:4px;'
        + 'background:#1d1d2b;border:1px solid hsla(' + hue + ',80%,55%,.5);border-radius:8px;'
        + 'padding:1px 7px 1px 4px;font-size:10px;color:#cfe3ff;pointer-events:none;'
        + 'box-shadow:0 0 6px hsla(' + hue + ',80%,55%,.35);';
      fx.innerHTML =
        '<span class="zfcfx-dot" style="width:8px;height:8px;border-radius:50%;background:hsl(' + hue + ',80%,60%);"></span>'
        + '<span class="zfcfx-icon" style="font-size:11px;line-height:1;">👂</span>'
        + '<span class="zfcfx-label">在听</span>';
      boxEl.appendChild(fx);
      if (!document.getElementById('zf-collab-fx-style')) {
        var st = document.createElement('style');
        st.id = 'zf-collab-fx-style';
        st.textContent =
          '@keyframes zfcfxBlink{0%,86%,100%{transform:scaleY(1)}90%,94%{transform:scaleY(.15)}}'
          + '@keyframes zfcfxRipple{0%{box-shadow:0 0 0 0 hsla(var(--zfcfx-hue),80%,60%,.7)}100%{box-shadow:0 0 0 14px hsla(var(--zfcfx-hue),80%,60%,0)}}'
          + '@keyframes zfcfxJump{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-3px)}}'
          + '@keyframes zfcfxPing{0%{transform:scale(1);opacity:1}100%{transform:scale(1.9);opacity:0}}'
          + '@keyframes zfcfxBreath{0%,100%{box-shadow:0 0 2px 1px rgba(0,230,118,.25)}50%{box-shadow:0 0 10px 3px rgba(0,230,118,.65)}}'
          + '@keyframes zfcfxShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-3px)}40%{transform:translateX(3px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}'
          + '.zf-collab-fx .zfcfx-icon{display:inline-block;transform-origin:center;}'
          + '.zf-collab-fx.fx-hear .zfcfx-icon{animation:zfcfxBlink 3.2s ease-in-out infinite;}'
          + '.zf-collab-fx.fx-say{--zfcfx-hue:210;animation:zfcfxRipple 1s ease-out 3;}'
          + '.zf-collab-fx.fx-say .zfcfx-icon{animation:zfcfxJump .5s ease-in-out 3;}'
          + '.zf-collab-fx.fx-work .zfcfx-icon{animation:zfcfxJump .9s ease-in-out infinite;}'
          + '.zf-collab-fx.fx-ack .zfcfx-dot{animation:zfcfxPing .7s ease-out 3;}'
          + '.zf-collab-fx.fx-done{animation:zfcfxBreath 2s ease-in-out infinite;border-color:rgba(0,230,118,.7)!important;}'
          + '.zf-collab-fx.fx-inject{animation:zfcfxShake .3s linear 8;border-color:rgba(255,82,82,.85)!important;}'
          + '.zf-collab-fx.fx-inject .zfcfx-icon{font-size:13px;}'
          /* 【v5.2 bravo】状态切换平滑：徽章阴影/边框过渡 + 文字淡入 + 图标弹跳 + 状态条变更行脉冲 */
          + '.zf-collab-fx{transition:box-shadow .25s ease,border-color .25s ease;}'
          + '.zf-collab-fx .zfcfx-label{display:inline-block;}'
          + '@keyframes zfcfxSwap{0%{opacity:0;transform:translateY(3px);}100%{opacity:1;transform:translateY(0);}}'
          + '@keyframes zfcfxPop{0%{transform:scale(1);}40%{transform:scale(1.35);}100%{transform:scale(1);}}'
          + '@keyframes zfcfxRowPulse{0%{box-shadow:0 0 0 0 hsla(var(--rowhue,210),80%,60%,.55);}100%{box-shadow:0 2px 10px rgba(0,0,0,.35);}}';
        document.head.appendChild(st);
      }
    } catch (e) {}
  }

  /* 组状态条：本页所有协作窗状态的汇总浮条（父窗/任意窗都可见，右下角） */
  function ensureTeamBar() {
    try {
      var bar = document.getElementById('zf-collab-teambar');
      if (bar) return bar;
      bar = document.createElement('div');
      bar.id = 'zf-collab-teambar';
      /* 【v7.7 UI微调】组状态条从 right:14 左移到 right:264（用户令：右下角会挡住 i 导航箭头及其弹出成员菜单；264 = 箭头宽240 + 边距14 + 余量10） */
      bar.style.cssText = 'position:fixed;right:264px;bottom:14px;z-index:99997;display:flex;flex-direction:column;gap:5px;'
        + 'pointer-events:none;font-family:inherit;';
      document.body.appendChild(bar);
      return bar;
    } catch (e) { return null; }
  }

  /* 【v5.2 bravo】签名缓存：内容没变不重绘 innerHTML（4s 兜底轮询不再整条闪烁）；
     状态变更行播一次组色脉冲，人类视线自然被引到「刚刚动了的那一行」 */
  var _barSig = '';
  var _barState = {}; // codename → 上次状态
  function fxRenderBar() {
    try {
      var bar = ensureTeamBar();
      if (!bar) return;
      var boxes = (window.App && App.chatBoxes) || [];
      var rows = [], sig = [];
      var _seen = {}; /* 【v5.3 去重·charlie】同一代号多窗只渲染一行：重启恢复常带回旧组遗留协作窗，
         旧逻辑每个带身份的窗各渲染一行 → 同一人堆叠出 N 行「在听」。按代号去重，先到先得。 */
      boxes.forEach(function (c) {
        if (!c || !c._collabTeam || !c._collabCodename || !c.el || !c.el.isConnected) return;
        if (_seen[c._collabCodename]) return;
        _seen[c._collabCodename] = 1;
        var st = c._collabFxState || 'hear';
        var k = FX_KINDS[st] || FX_KINDS.hear;
        var hue = HUE[c._collabCodename] || 210;
        var changed = _barState[c._collabCodename] !== st;
        _barState[c._collabCodename] = st;
        sig.push(c._collabCodename + ':' + st);
        rows.push('<div style="--rowhue:' + hue + ';display:flex;align-items:center;gap:5px;background:rgba(20,20,34,.88);'
          + 'border:1px solid hsla(' + hue + ',80%,55%,.55);border-radius:8px;padding:2px 9px;'
          + 'font-size:11px;color:#dfeaff;box-shadow:0 2px 10px rgba(0,0,0,.35);'
          + (changed && _barSig ? 'animation:zfcfxRowPulse .6s ease-out 2;' : '') + '">'
          + '<b style="color:hsl(' + hue + ',80%,65%);">' + c._collabCodename + '</b>'
          + '<span>' + k.icon + '</span><span>' + k.label + '</span></div>');
      });
      if (!rows.length) { bar.style.display = 'none'; _barSig = ''; return; }
      var newSig = sig.join('|');
      bar.style.display = 'flex';
      if (newSig !== _barSig) { _barSig = newSig; bar.innerHTML = rows.join(''); }
    } catch (e) {}
  }

  /* 状态机：fx(chat, kind, labelText, sticky) —— kind 见 FX_KINDS */
  function fx(chat, kind, labelText, sticky) {
    try {
      var boxEl = chat && (chat.el || chat);
      if (!boxEl || !boxEl.isConnected) return;
      ensureFxLayer(boxEl, chat._collabCodename || 'alpha');
      var fxEl = boxEl.querySelector('.zf-collab-fx');
      if (!fxEl) return;
      var k = FX_KINDS[kind] || FX_KINDS.hear;
      var hue = HUE[chat._collabCodename] || 210;
      var prev = chat._collabFxState || '';
      fxEl.className = 'zf-collab-fx fx-' + k.cls;
      var icoEl = fxEl.querySelector('.zfcfx-icon');
      var labEl = fxEl.querySelector('.zfcfx-label');
      icoEl.textContent = k.icon;
      labEl.textContent = labelText || k.label;
      if (prev && prev !== kind) {
        /* 【v5.2 bravo】状态真切换时：文字淡入 + 图标弹跳各播一次；
           内联动画播完即清空，让位给 class 常驻动画（如 hear 眨眼），防覆盖杀动画 */
        labEl.style.animation = 'zfcfxSwap .22s ease-out';
        icoEl.style.animation = 'zfcfxPop .35s ease-out';
        setTimeout(function () { try { labEl.style.animation = ''; } catch (eL) {} }, 260);
        setTimeout(function () { try { icoEl.style.animation = ''; } catch (eI) {} }, 400);
      }
      fxEl.querySelector('.zfcfx-dot').style.background = 'hsl(' + hue + ',80%,60%)';
      chat._collabFxState = kind;
      chat._collabFxUntil = sticky || !FX_HOLD[kind] ? 0 : (Date.now() + FX_HOLD[kind]);
      if (kind === 'say') { fxEl.style.setProperty('--zfcfx-hue', hue); }
      fxRenderBar();
      /* 跨窗广播：其他 chatbox 页签/父页也能联动（storage 事件） */
      try {
        localStorage.setItem('zf_collab_fx', JSON.stringify({
          team: chat._collabTeam, code: chat._collabCodename, kind: kind, ts: Date.now()
        }));
      } catch (eS) {}
      /* 【v5.2 bravo】回落：瞬时态到点回退，但回落目标不盲选「在听」——
         窗若还在发送/流式干活就回「干活中」，防「明明在跑却显示在听」的误报 */
      if (chat._collabFxUntil) {
        clearTimeout(chat._collabFxTimer);
        chat._collabFxTimer = setTimeout(function () {
          try {
            if (Date.now() < (chat._collabFxUntil || 0)) return;
            var busy = !!(chat._collabBusy || (boxEl.querySelector('.send-btn') || {}).disabled
              || boxEl.querySelector('.msg-streaming, .streaming-cursor'));
            fx(chat, busy ? 'work' : 'hear', busy ? '干活中…' : '在听', true);
          } catch (eR) {}
        }, FX_HOLD[kind] + 60);
      }
    } catch (e) {}
  }

  /* storage 事件联动：收到同伴广播 → 本页同组同名窗同步状态（跨页签） */
  window.addEventListener('storage', function (ev) {
    try {
      if (!ev || ev.key !== 'zf_collab_fx' || !ev.newValue) return;
      var d = JSON.parse(ev.newValue);
      if (!d || !d.code || !FX_KINDS[d.kind]) return;
      var boxes = (window.App && App.chatBoxes) || [];
      boxes.forEach(function (c) {
        if (c && c._collabCodename === d.code) fx(c, d.kind, (FX_KINDS[d.kind] || {}).label, false);
      });
    } catch (e) {}
  });
  /* 【v5.0 bravo】干活→在听 回落哨兵：每 1.2s 扫协作窗，输入框空且无流式光标
     即视为空闲回「在听」（work 是常驻态，靠这里归还，防止干完活还显示干活） */
  setInterval(function () {
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      boxes.forEach(function (c) {
        if (!c || !c._collabTeam || c._collabFxState !== 'work' || !c.el) return;
        var inp = c.el.querySelector('textarea') || c.el.querySelector('.chatbox-input');
        var sending = !!(c._collabBusy || (c.el.querySelector('.send-btn') || {}).disabled);
        var streaming = c.el.querySelector('.msg-streaming, .streaming-cursor');
        if (!sending && !streaming && inp && !String(inp.value || '').trim()) {
          fx(c, 'hear', '在听', true);
        }
      });
    } catch (e) {}
  }, 1200);
  /* 组状态条兜底刷新：有协作窗时每 4s 对齐一次（防漏事件） */
  setInterval(function () { try { fxRenderBar(); } catch (e) {} }, 4000);

  /* ---------- payload 标记：agent-02-loop-core 发请求前调 ---------- */
  function markPayload(chat, payload) {
    try {
      if (chat && chat._collabTeam && chat._collabCodename && payload) {
        payload._collab_team = String(chat._collabTeam);
        payload._collab_codename = String(chat._collabCodename);
        /* 【v5.0 bravo】每轮请求出网 = 该窗「干活中」（三点跳动）；回复静默后由
           fxWorkWatcher 的 1.2s 静默判定回「在听」，人类全程看得见窗在忙 */
        try { if (window.ZFCollab && ZFCollab.fx) fx(chat, 'work', '干活中…', true); } catch (eFx) {}
      }
    } catch (e) {}
    return payload;
  }

  /* ---------- 可视化（一期内联）：耳挡格 / say 涟漪 ---------- */
  function badgeEar(boxEl, level) {
    try {
      var old = boxEl.querySelector('.zf-collab-ear');
      if (old) old.remove();
      var b = document.createElement('div');
      b.className = 'zf-collab-ear';
      /* 【v7.7 UI微调】耳挡徽标从右上挪到左上（用户令：右上角会遮住窗头工具数量角标），排在窗头状态徽章右侧 */
      b.style.cssText = 'position:absolute;top:-10px;left:92px;z-index:5;background:#1d1d2b;'
        + 'border:1px solid hsla(210,80%,55%,.5);border-radius:8px;padding:1px 6px;font-size:10px;color:#9ecbff;pointer-events:none;';
      b.textContent = '👂 L' + (level === 0 ? '0 关耳' : '1 提要');
      boxEl.appendChild(b);
    } catch (e) {}
  }

  function fxRippleOn(chat, teamId, code) {
    // say 涟漪：通道 record_injection 落档案后前端无推送通道（一期从简），改在本窗
    // 发送成功时自闪一圈组色光环，提示"我说了"；真正跨窗涟漪归二期（work_order 事件源）。
    try {
      var boxEl = chat.el ? chat.el : chat;
      var btn = boxEl.querySelector('.send-btn');
      if (!btn || btn._zfRippleOn) return;   /* alpha v6.1：防重复调用叠加监听器 */
      btn._zfRippleOn = 1;
      var hue = HUE[code] || 210;
      btn.addEventListener('click', function () {
        var r = boxEl.getBoundingClientRect();
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;z-index:99998;border-radius:50%;pointer-events:none;'
          + 'border:2px solid hsla(' + hue + ',80%,60%,.8);'
          + 'left:' + (r.left - 6) + 'px;top:' + (r.top - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + (r.height + 12) + 'px;'
          + 'transition:all .8s ease-out;opacity:.9;';
        document.body.appendChild(d);
        requestAnimationFrame(function () {
          d.style.left = (r.left - 30) + 'px'; d.style.top = (r.top - 30) + 'px';
          d.style.width = (r.width + 60) + 'px'; d.style.height = (r.height + 60) + 'px';
          d.style.opacity = '0';
        });
        setTimeout(function () { d.remove(); }, 900);
      }, true);
    } catch (e) {}
  }

  /* ---------- inject 唤醒哨兵（报话ACK·真实回馈闭环）----------
   * 每 2.5s 轮询本页协作窗 → /api/tools/collab status 拿发给我的未回应插话 →
   * 空闲窗（输入框空）注入插话消息并触发发送；忙窗跳过（轮间 hear 兜底，不丢）。
   * 同一插话只送一次（窗上 _injSeen 幂等）。 */
  function startInjectWatch() {
    try {
      var boxes = document.querySelectorAll('.chatbox-window');
      if (!boxes.length) return;
      Array.prototype.forEach.call(boxes, function (el) {
        var chat = el._chat || el;
        var team = chat._collabTeam, code = chat._collabCodename;
        if (!team || !code || chat._collabBusy) return;
        var inp = el.querySelector('textarea') || el.querySelector('.chatbox-input');
        var btn = el.querySelector('.send-btn');
        if (!inp || !btn || String(inp.value || '').trim()) return;
        fetch('/api/tools/collab', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', team: team, codename: code }) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || !j.ok) return;
            var mine = (j.injects || []).filter(function (e) { return e.to === code && !e.answered; });
            if (!mine.length) return;
            var e = mine[mine.length - 1];
            chat._injSeen = chat._injSeen || {};
            if (chat._injSeen[e.id]) return;
            chat._injSeen[e.id] = 1;
            inp.value = '【定向插话·' + e.from + '】' + e.text
              + '\n（务必调 collab(action=ack, ref=' + e.id + ', text=收到+要点复诵) 回应）';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(function () { try { btn.click(); } catch (eC) {} }, 80);
          })
          .catch(function () {});
      });
    } catch (eW) {}
  }

  /* ---------- v6 动态可视化：协作师眼/耳/嘴/笔/回执 HUD + 思考光环 ----------
   * 用户令：把协作师的眼睛嘴等动态做出来，带动画，让人类一眼知道你们在干什么。
   * 数据源（纯前端，零服务器改动）：
   *   - chat.isSending=true → 思考中：整窗组色呼吸光环 + 眼常亮（扫描状）
   *   - fetch 钩子捕获 /api/tools/collab 请求 → 按 action 映射五件套动画：
   *     peek/status=眼扫描；say/inject/review/done=嘴波纹；note=笔书写；
   *     set_ear/wakeup=耳振动；ack/ack_ear=回执打勾 */
  (function () {
    if (document.getElementById('zf-collab-fx-style')) return;
    var st = document.createElement('style');
    st.id = 'zf-collab-fx-style';
    st.textContent =
      '.zf-collab-hud{position:absolute;top:-10px;right:64px;z-index:6;display:flex;gap:3px;' +
      'background:rgba(20,22,36,.82);border:1px solid rgba(120,160,255,.35);border-radius:9px;' +
      'padding:2px 6px;font-size:11px;line-height:16px;pointer-events:none;backdrop-filter:blur(6px);}' +
      '.zf-collab-hud .fxIco{opacity:.28;filter:grayscale(1);transition:all .25s;display:inline-block;}' +
      '.zf-collab-hud .fxIco.on{opacity:1;filter:none;transform:scale(1.2);}' +
      '.zf-collab-hud .fxIco.say.on{animation:fxSay .5s ease-in-out 3;}' +
      '.zf-collab-hud .fxIco.eye.on{animation:fxEye 1.2s ease-in-out 2;}' +
      '.zf-collab-hud .fxIco.pen.on{animation:fxPen .35s ease-in-out 4;}' +
      '.zf-collab-hud .fxIco.ear.on{animation:fxEar .4s ease-in-out 4;}' +
      '.zf-collab-hud .fxIco.tok{color:#00e676;text-shadow:0 0 6px rgba(0,230,118,.8);}' +
      '.zf-collab-think{position:absolute;inset:-3px;border-radius:14px;pointer-events:none;' +
      'z-index:4;animation:fxBreath 1.6s ease-in-out infinite;display:none;}' +
      '@keyframes fxBreath{0%,100%{box-shadow:0 0 4px 1px var(--fxHalo,hsla(210,80%,60%,.25));}' +
      '50%{box-shadow:0 0 18px 4px var(--fxHalo,hsla(210,80%,60%,.6));}}' +
      '@keyframes fxSay{0%,100%{transform:scale(1);}30%{transform:scale(1.45) translateY(-1px);}}' +
      '@keyframes fxEye{0%,100%{transform:scaleX(1);}25%{transform:scaleX(.35);}75%{transform:scaleX(1.2);}}' +
      '@keyframes fxPen{0%,100%{transform:rotate(0);}50%{transform:rotate(-14deg);}}' +
      '@keyframes fxEar{0%,100%{transform:rotate(0);}30%{transform:rotate(12deg);}70%{transform:rotate(-8deg);}}';
    document.head.appendChild(st);
  })();

  /* HUD DOM：五枚图标（眼/耳/嘴/笔/回执）+ 组色呼吸光环层 */
  function hudEnsure(boxEl, code) {
    try {
      var hue = HUE[code] || 210;
      var hud = boxEl.querySelector('.zf-collab-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.className = 'zf-collab-hud';
        hud.innerHTML = '<span class="fxIco eye" title="眼看：查看全组状态">👁</span>'
          + '<span class="fxIco ear" title="耳听：旁听同伴播报">👂</span>'
          + '<span class="fxIco say" title="嘴说：向全组/同伴播报">💬</span>'
          + '<span class="fxIco pen" title="笔记：组便签留痕">✍</span>'
          + '<span class="fxIco tok" title="回执：确认收到同伴消息">✓</span>';
        boxEl.appendChild(hud);
      }
      boxEl.style.setProperty('--fxHalo', 'hsla(' + hue + ',80%,60%,.55)');
      var halo = boxEl.querySelector('.zf-collab-think');
      if (!halo) {
        halo = document.createElement('div');
        halo.className = 'zf-collab-think';
        halo.style.display = 'none';
        boxEl.appendChild(halo);
      }
      return hud;
    } catch (e) { return null; }
  }

  /* 点亮某图标（secs 秒后自动熄灭）；思考期间眼保持常亮 */
  function hudFlash(boxEl, cls, secs) {
    try {
      var hud = boxEl.querySelector('.zf-collab-hud'); if (!hud) return;
      var ico = hud.querySelector('.fxIco.' + cls); if (!ico) return;
      ico.classList.add('on');
      clearTimeout(ico._t);
      ico._t = setTimeout(function () { ico.classList.remove('on'); }, (secs || 2) * 1000);
    } catch (e) {}
  }

  window.ZFCollab = {
    dispatch: dispatch,
    markPayload: markPayload,
    createTeamArrow: createTeamArrow,
    makeMemberArrow: makeMemberArrow,
    restoreMemberArrows: restoreMemberArrows,
    startInjectWatch: startInjectWatch,
    CODES: CODES,
    fx: fx,                 /* 【v5.0 bravo】对外暴露：tools 执行器等外部挂钩调窗头动画 */
    FX_KINDS: FX_KINDS
  };
  /* inject 唤醒哨兵：每 2.5s 轮询各协作窗的未回应定向插话 → 空闲窗注入并发送（真实回馈闭环） */
  (function () {
    if (window.ZFCollab._injectWatchOn) return;
    window.ZFCollab._injectWatchOn = true;
    setInterval(function () { try { startInjectWatch(); } catch (e) {} }, 2500);
  })();

  /* ---------- v6 动态可视化数据线（纯前端零服务器改动）---------- */

  /* A. fetch 钩子：捕获协作师模型调 collab 工具 → POST /api/tools/collab
   *    body._chat_id 定位窗口 → 按 args.action 点亮对应器官动画 */
  (function () {
    if (window.fetch.__zfCollabFx) return;
    var _rawFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (url.indexOf('/api/tools/collab') !== -1 && init && init.method === 'POST' && init.body) {
          var b = JSON.parse(init.body);
          var act = String(b.action || '').toLowerCase();
          var boxEl = null;
          var boxes = (window.App && App.chatBoxes) || [];
          for (var i = 0; i < boxes.length; i++) {
            var c = boxes[i];
            if (c && c._collabTeam && String(b._chat_id || '') === String(c.id || '') && c.el && c.el.isConnected) { boxEl = c.el; break; }
          }
          if (boxEl) {
            if (act === 'say' || act === 'inject' || act === 'review' || act === 'done') hudFlash(boxEl, 'say', 3);
            else if (act === 'peek' || act === 'status') hudFlash(boxEl, 'eye', 2);
            else if (act === 'note') hudFlash(boxEl, 'pen', 3);
            else if (act === 'set_ear' || act === 'wakeup') hudFlash(boxEl, 'ear', 3);
            else if (act === 'ack' || act === 'ack_ear') hudFlash(boxEl, 'tok', 3);
          }
        }
      } catch (e) {}
      return _rawFetch.apply(this, arguments);
    };
    window.fetch.__zfCollabFx = true;
  })();

  /* B. 思考/回复哨兵：每 1.2s 扫协作窗 isSending → 呼吸光环 + 眼常亮；
   *    输入框有草稿 = 在打字 → 嘴微亮。人类一眼看懂谁在干活、谁在敲字、谁说完话了。 */
  setInterval(function () {
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < boxes.length; i++) {
        var c = boxes[i];
        if (!c || !c._collabTeam || !c.el || !c.el.isConnected) continue;
        var busy = !!(c.isSending || c._collabBusy);
        var halo = c.el.querySelector('.zf-collab-think');
        if (halo) halo.style.display = busy ? 'block' : 'none';
        var hud = hudEnsure(c.el, c._collabCodename);
        if (hud) {
          var eye = hud.querySelector('.fxIco.eye');
          if (eye && busy && !eye.classList.contains('on')) { eye.classList.add('on'); eye._t && clearTimeout(eye._t); }
          else if (eye && !busy && eye.classList.contains('on') && !eye._t) { eye.classList.remove('on'); }
        }
        var inp = c.el.querySelector('textarea') || c.el.querySelector('.chatbox-input');
        if (hud && !busy && inp && String(inp.value || '').trim()) {
          if (!c._fxDraftOn) { c._fxDraftOn = true; hudFlash(c.el, 'say', 6); }
        } else if (!busy) { c._fxDraftOn = false; }
      }
    } catch (e) {}
  }, 1200);

  /* ================= 【v7 charlie 2026-11-24】跨窗组级动态（livebar） =================
   * 分工声明：窗内器官动画（眼/嘴/笔/耳闪光+思考光环）= bravo v5.0/v6 体系，本段不碰；
   * charlie 互补增量 = 跨窗组级视野：
   *   1. 右上角「协作组动态条」：全组成员小头像横排 + 最新播报一句话 + 任务名，
   *      谁在说话谁的头像脉冲、谁完成谁变绿跳跃——人类一眼看出"整组"在干什么；
   *   2. 成员 done 上报 → 该成员协作窗绿光庆祝（缓慢跳跃+绿晕）；
   *   3. 数据源：GET /api/plugin/collab/feed?team=..&since=..（只读聚合，charlie 后端），
   *      每 2.5s 增量轮询；接口关闭/组清档 → 动态条自动隐藏，零打扰。
   * ================================================================================ */
  var LB_CSS = [
    '<style id="zf-collab-livebar-css">',
    '#zf-collab-livebar{position:fixed;top:56px;right:14px;z-index:99990;display:none;align-items:center;gap:10px;',
    '  max-width:520px;background:rgba(15,19,33,.9);border:1px solid rgba(120,150,255,.4);border-radius:14px;',
    '  padding:7px 14px;font-size:12px;color:#dfe8ff;box-shadow:0 4px 18px rgba(0,0,0,.45);backdrop-filter:blur(10px);}',
    '#zf-collab-livebar .zf-lb-title{font-weight:600;opacity:.85;letter-spacing:1px;}',
    '#zf-collab-livebar .zf-lb-head{display:flex;gap:7px;}',
    '#zf-collab-livebar .zf-lb-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
    '  font-size:12px;font-weight:700;color:#fff;position:relative;cursor:default;',
    '  background:linear-gradient(135deg,hsla(var(--zf-hue,210),80%,55%,.95),hsla(var(--zf-hue,210),70%,38%,.92));',
    '  box-shadow:0 0 0 1.5px rgba(255,255,255,.35);animation:zfLbBreathe 1.8s ease-in-out infinite;}',
    '#zf-collab-livebar .zf-lb-dot.zf-speaking{animation:zfLbPulse .8s ease-in-out infinite;}',
    '#zf-collab-livebar .zf-lb-dot.zf-speaking::after{content:"💬";position:absolute;top:-9px;right:-7px;font-size:10px;}',
    '#zf-collab-livebar .zf-lb-dot.zf-done{background:linear-gradient(135deg,#2fbf71,#178a4e);animation:zfLbJump .8s ease-in-out infinite;}',
    '#zf-collab-livebar .zf-lb-dot.zf-done::after{content:"✓";position:absolute;top:-8px;right:-6px;font-size:9px;color:#7dff B0;}',
    '#zf-collab-livebar .zf-lb-dot.zf-left{opacity:.35;animation:none;filter:grayscale(.8);}',
    '#zf-collab-livebar .zf-lb-txt{display:flex;flex-direction:column;line-height:1.35;min-width:0;}',
    '#zf-collab-livebar .zf-lb-say{max-width:330px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.95;}',
    '#zf-collab-livebar .zf-lb-task{max-width:330px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.55;font-size:11px;}',
    '/* 成员完成 → 协作窗绿光庆祝 */',
    '.chatbox-window.zf-win-done{animation:zfWinDone 1.6s ease-in-out infinite;}',
    '@keyframes zfWinDone{0%,100%{box-shadow:0 0 0 2px rgba(60,220,130,.9),0 6px 26px rgba(0,0,0,.4)}',
    '  50%{box-shadow:0 0 0 5px rgba(60,220,130,.45),0 0 30px rgba(60,220,130,.5)}}',
    '@keyframes zfLbBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}',
    '@keyframes zfLbPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}',
    '@keyframes zfLbJump{0%,100%{transform:translateY(0)}45%{transform:translateY(-5px)}}',
    '</style>'
  ].join('\n');
  function _lbInjectCss() {
    try {
      if (document.getElementById('zf-collab-livebar-css')) return;
      var h = document.createElement('div'); h.style.display = 'none';
      h.innerHTML = LB_CSS;
      document.head.appendChild(h.firstChild || h);
    } catch (e) {}
  }
  function _livebarEnsure() {
    try {
      var bar = document.getElementById('zf-collab-livebar');
      if (!bar) {
        _lbInjectCss();
        bar = document.createElement('div'); bar.id = 'zf-collab-livebar';
        bar.innerHTML = '<span class="zf-lb-title">👥 协作中</span>'
          + '<span class="zf-lb-head"></span>'
          + '<span class="zf-lb-txt"><span class="zf-lb-say">…</span><span class="zf-lb-task"></span></span>';
        document.body.appendChild(bar);
      }
      return bar;
    } catch (e) { return null; }
  }
  function _livebarRender(bar, teamId, feedData, newestSay) {
    try {
      var members = (feedData && feedData.members) || {};
      var codes = Object.keys(members);
      if (!codes.length) { bar.style.display = 'none'; return; }
      /* alpha v6.1：只有最近 30s 内真实说过话的成员才标「说话中」脉冲，
         其余在场成员保持安静呼吸态——修复此前全员常年 zf-speaking 的误显示 */
      var nowSec = Date.now() / 1000;
      var recentSpeakers = {};
      ((feedData && feedData.says) || []).forEach(function (s) {
        if (nowSec - (s.ts || 0) < 30) recentSpeakers[s.codename] = 1;
      });
      var head = bar.querySelector('.zf-lb-head');
      if (bar._lbSig !== codes.join(',')) {
        bar._lbSig = codes.join(',');
        head.innerHTML = codes.map(function (cn) {
          var hue = HUE[cn] || 210;
          return '<span class="zf-lb-dot" data-code="' + cn + '" title="协作师·' + cn + '" style="--zf-hue:' + hue + '">' + cn.charAt(0).toUpperCase() + '</span>';
        }).join('');
      }
      codes.forEach(function (cn) {
        var dot = head.querySelector('.zf-lb-dot[data-code="' + cn + '"]');
        if (!dot) return;
        var m = members[cn] || {};
        var st = m.left ? 'zf-left' : (m.status === 'done' ? 'zf-done' : (recentSpeakers[cn] ? 'zf-speaking' : ''));
        if (dot.className !== 'zf-lb-dot ' + st) dot.className = 'zf-lb-dot ' + st;
      });
      var sayEl = bar.querySelector('.zf-lb-say');
      var taskEl = bar.querySelector('.zf-lb-task');
      if (sayEl) sayEl.textContent = newestSay
        ? (newestSay.codename + '：' + newestSay.text)
        : '（暂无播报，成员工作中…）';
      if (taskEl) taskEl.textContent = String(feedData.task || '').slice(0, 40) || ('组 ' + String(teamId).slice(0, 20));
      bar.style.display = 'flex';
    } catch (e) {}
  }
  /* done 庆祝：给完成成员的协作窗挂/摘绿光 */
  function _markDoneWindows(teamId, members) {
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < boxes.length; i++) {
        var c = boxes[i];
        if (!c || !c._collabTeam || c._collabTeam !== teamId || !c.el || !c.el.isConnected) continue;
        var m = (members || {})[c._collabCodename] || {};
        var want = m.status === 'done';
        var has = c.el.classList.contains('zf-win-done');
        if (want && !has) c.el.classList.add('zf-win-done');
        else if (!want && has) c.el.classList.remove('zf-win-done');
      }
    } catch (e) {}
  }
  function startLivebarFx() {
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      var teamSet = {};
      for (var i = 0; i < boxes.length; i++) {
        var c = boxes[i];
        if (c && c._collabTeam && c.el && c.el.isConnected) teamSet[c._collabTeam] = 1;
      }
      var teams = Object.keys(teamSet);
      var bar = _livebarEnsure();
      if (!teams.length) { if (bar) bar.style.display = 'none'; return; }
      teams.forEach(function (team) {
        var since = window['_zfLbWater_' + team] || 0;
        fetch('/api/plugin/collab/feed?team=' + encodeURIComponent(team) + '&since=' + since)
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || !j.ok) { if (bar) bar.style.display = 'none'; return; }
            window['_zfLbWater_' + team] = j.server_ts || since;
            var newest = (j.says && j.says.length) ? j.says[j.says.length - 1] : null;
            _livebarRender(bar, team, j, newest);
            _markDoneWindows(team, j.members);
          })
          .catch(function () { if (bar) bar.style.display = 'none'; });
      });
    } catch (e) {}
  }
  window.ZFCollab.startLivebarFx = startLivebarFx;
  /* 组级动态哨兵：每 2.5s 轮询 feed（与 inject 哨兵同节奏，独立容错） */
  (function () {
    if (window.ZFCollab._livebarFxOn) return;
    window.ZFCollab._livebarFxOn = true;
    setInterval(function () { try { startLivebarFx(); } catch (e) {} }, 2500);
  })();

  /* ================================================================================
   * 【v5.4 bravo 2026-11-24】协作对话流面板（用户令「实时看你们工作」·「没看到你们对话」·「协作频率低」）
   * v5.4 新增：活跃度条——全组呼吸条（3min 内有往来即闪）+ 四成员活跃点（2min 内说过话亮）+ 累计往来计数。
   * 全组往来（say/inject）实时流水，像聊天记录一样肉眼可读，右侧瀑布流自动滚动。
   * 数据源：复用 charlie 的 GET /api/plugin/collab/feed（只读）；独立水位 _zfFsWater_*，
   * 与 livebar 的 _zfLbWater_* 各吃各的增量互不干扰；不碰 charlie 任何代码。
   * 布局：livebar 在 top:56px，本面板 top:120px 起，不重叠。文本一律 textContent 注入（XSS 安全）。
   * ================================================================================ */
  (function () {
    if (window.ZFCollab._feedStreamOn) return;
    window.ZFCollab._feedStreamOn = true;
    var CSS = '<style id="zf-feedstream-css">'
      + '#zf-feedstream{position:fixed;top:120px;right:14px;z-index:99989;width:308px;max-height:52vh;'
      + 'background:rgba(13,16,28,.92);border:1px solid rgba(120,150,255,.35);border-radius:12px;'
      + 'backdrop-filter:blur(10px);box-shadow:0 4px 18px rgba(0,0,0,.45);display:none;flex-direction:column;overflow:hidden;}'
      + '#zf-feedstream .zf-fs-head{display:flex;align-items:center;gap:6px;padding:7px 12px 5px;font-size:12px;font-weight:600;color:#cfe0ff;letter-spacing:1px;cursor:pointer;user-select:none;}'
      + '#zf-feedstream .zf-fs-body{overflow-y:auto;padding:4px 10px 10px;display:flex;flex-direction:column;gap:5px;}'
      + '#zf-feedstream .zf-fs-item{background:rgba(30,36,58,.75);border-left:3px solid hsl(var(--hue,210),80%,55%);border-radius:6px;'
      + 'padding:5px 8px;font-size:11px;line-height:1.45;color:#dfe8ff;animation:zfFsIn .28s ease-out;}'
      + '#zf-feedstream .zf-fs-item .zf-fs-meta{font-size:10px;color:#9fb2d8;margin-bottom:2px;display:flex;gap:6px;flex-wrap:wrap;}'
      + '#zf-feedstream .zf-fs-item .zf-fs-time{font-size:9px;color:#8290ad;opacity:.7;margin-left:auto;white-space:nowrap;font-weight:400;}'
      + '#zf-feedstream .zf-fs-item .zf-fs-who{font-weight:700;color:hsl(var(--hue,210),80%,68%);}'
      + '#zf-feedstream .zf-fs-item .zf-fs-txt{word-break:break-all;white-space:pre-wrap;}'
      + '#zf-feedstream .zf-fs-act{display:flex;align-items:center;gap:7px;padding:2px 12px 6px;font-size:10px;color:#9fb2d8;}'
      + '#zf-feedstream .zf-fs-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.14);transition:background .5s,box-shadow .5s;}'
      + '#zf-feedstream .zf-fs-dot.on{background:hsl(var(--hue,210),85%,60%);box-shadow:0 0 6px hsl(var(--hue,210),85%,60%);}'
      + '#zf-feedstream .zf-fs-breathe{width:26px;height:6px;border-radius:3px;background:rgba(255,255,255,.12);transition:background .5s;}'
      + '#zf-feedstream .zf-fs-breathe.on{background:hsl(160,85%,55%);animation:zfFsBreathe 2.4s ease-in-out infinite;}'
      + '@keyframes zfFsBreathe{0%,100%{opacity:.45;transform:scaleX(.72);}50%{opacity:1;transform:scaleX(1);}}'
      + '#zf-feedstream .zf-fs-act .zf-fs-cnt{margin-left:auto;font-variant-numeric:tabular-nums;color:#cfe0ff;font-weight:600;}'
      + '@keyframes zfFsPulse{0%{box-shadow:0 0 0 0 hsl(var(--hue,210),85%,60%);}70%{box-shadow:0 0 0 7px transparent;}100%{box-shadow:0 0 0 0 transparent;}}'
      + '@keyframes zfFsIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}'
      + '</style>';
    var FS_KIND = { progress: '进度', review: '审核', question: '提问', error: '错误' };
    var _fsSeen = {}; // 去重 key → 1
    var _fsAct = { total: 0, lastAny: 0, last: {} }; // 活跃度：累计往来 + 全组/各成员最近往来时间戳
    function fsEnsure() {
      var el = document.getElementById('zf-feedstream');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'zf-feedstream';
      el.innerHTML = CSS
        + '<div class="zf-fs-head" title="点击折叠/展开">📡 协作对话流 <span style="opacity:.55;font-weight:400;font-size:10px;">实时往来 · 点此折叠</span></div>'
        + '<div class="zf-fs-act" title="左端条=全组最近3分钟内有往来即呼吸闪烁；圆点=各成员最近2分钟内说过话则点亮；右侧数字=本组累计往来条数"><span class="zf-fs-breathe"></span>' + CODES.map(function (c) { return '<span class="zf-fs-dot" data-code="' + c + '"></span>'; }).join('') + '<span class="zf-fs-cnt"></span></div>'
        + '<div class="zf-fs-body"></div>';
      document.body.appendChild(el);
      el.querySelector('.zf-fs-head').addEventListener('click', function () {
        var b = el.querySelector('.zf-fs-body');
        var vis = b.style.display !== 'none';
        b.style.display = vis ? 'none' : 'flex';
      });
      return el;
    }
    /* 【v5.6 条目时间·用户令 2026-11-25】meta 行尾部低调时间戳（feed ts 为 time.time() 秒，*1000 转 Date）
       今天内只显 HH:MM:SS，跨天自动补 MM-DD 前缀，方便事后统计往来时间 */
    function fsFmtTs(sec) {
      if (!sec) return '';
      var d = new Date(sec * 1000);
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      var hm = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
      var now = new Date();
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate())
        return (d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + hm;
      return hm;
    }
    function fsRender(j) {
      var el = document.getElementById('zf-feedstream');
      if (!el) return;
      var body = el.querySelector('.zf-fs-body');
      if (!body) return;
      var items = [];
      (j.says || []).forEach(function (s) {
        items.push({ ts: s.ts || 0, who: s.codename || '?',
          kindLabel: FS_KIND[s.type] || '播报',
          to: (s.to && s.to.length) ? s.to.join('/') : '全组',
          hue: HUE[s.codename] || 210, txt: s.text || '' });
      });
      /* 【v8.2 用户令「审核带 0-100 分」】互审记录带分渲染：🧾 审核 92分 | ✅通过：原因 */
      (j.reviews || []).forEach(function (r) {
        var sc = (r.score != null) ? ' ' + r.score + '分' : '';
        items.push({ ts: r.ts || 0, who: r.from || '?',
          kindLabel: '🧾 审核' + sc,
          to: r.to || '?', hue: HUE[r.from] || 210,
          txt: (r.verdict === 'pass' ? '✅ 通过' : '❌ 打回')
            + (r.text ? '：' + r.text : '') });
      });
      (j.injects || []).forEach(function (v) {
        /* 【沟通力升级 2026-11-24】插话显示真实内容（此前只有占位符）；无 text 时才降级占位 */
        var vtxt = v.text
          ? (v.answered ? '✓ ' + v.text : '⏳ ' + v.text)
          : (v.answered ? '（已回应的定向插话）' : '（定向插话·等待回应）');
        items.push({ ts: v.ts || 0, who: v.from || '?', kindLabel: '📣 插话',
          to: v.to || '?', hue: HUE[v.from] || 210,
          txt: vtxt });
      });
      items.sort(function (a, b) { return a.ts - b.ts; });
      var additions = [];
      items.forEach(function (it) {
        var key = it.kindLabel + ':' + it.ts + ':' + it.who + ':' + String(it.txt).slice(0, 24);
        if (_fsSeen[key]) return;
        _fsSeen[key] = 1;
        additions.push(it);
      });
      if (additions.length) {
        _fsAct.total += additions.length;
        additions.forEach(function (a) {
          var t = a.ts || 0;
          if (t > _fsAct.lastAny) _fsAct.lastAny = t;
          var c = String(a.who || '').toLowerCase();
          if (_fsAct.last[c] == null || t > _fsAct.last[c]) _fsAct.last[c] = t;
        });
        fsActivity();
      }
      if (!additions.length) return;
      var atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      additions.forEach(function (a) {
        var d = document.createElement('div');
        d.className = 'zf-fs-item';
        d.style.setProperty('--hue', a.hue);
        d.innerHTML = '<div class="zf-fs-meta"><span class="zf-fs-who"></span>'
          + '<span class="zf-fs-k"></span><span class="zf-fs-to"></span><span class="zf-fs-time"></span></div>'
          + '<div class="zf-fs-txt"></div>';
        d.querySelector('.zf-fs-who').textContent = a.who;
        d.querySelector('.zf-fs-k').textContent = a.kindLabel;
        d.querySelector('.zf-fs-to').textContent = '→ ' + a.to;
        d.querySelector('.zf-fs-time').textContent = fsFmtTs(a.ts);
        d.querySelector('.zf-fs-txt').textContent = a.txt;
        body.appendChild(d);
      });
      while (body.children.length > 40) body.removeChild(body.firstChild); // 上限 40 条防无限膨胀
      if (atBottom) body.scrollTop = body.scrollHeight;
    }
    var _fsAct = { total: 0, lastAny: 0, last: {} }; // 活跃度：累计往来 + 全组/各成员最近往来时间戳
    function fsActivity() {
      var el = document.getElementById('zf-feedstream');
      if (!el) return;
      var now = Date.now();
      /* 【单位陷阱已修】feed 返回 ts 是 time.time() 秒（collab_channel.py L618/L1327），
         Date.now() 是毫秒——必须 *1000 再比较，否则活跃点永远不亮 */
      var br = el.querySelector('.zf-fs-breathe');
      if (br) br.classList.toggle('on', (_fsAct.lastAny || 0) * 1000 > now - 180000);
      CODES.forEach(function (code) {
        var dot = el.querySelector('.zf-fs-dot[data-code="' + code + '"]');
        if (!dot) return;
        dot.classList.toggle('on', _fsAct.last[code] != null && _fsAct.last[code] * 1000 > now - 120000);
      });
      var cnt = el.querySelector('.zf-fs-cnt');
      if (cnt) cnt.textContent = _fsAct.total ? _fsAct.total + ' 往来' : '';
    }
    function fsTick() {
      try {
        /* 【v8.1 刷新存活·bravo 2026-11-25】页面刷新后协作窗没了 → 回退 sessionStorage 记忆的组
           继续拉流，📡 面板不再整块消失（往来是长期档案、重启也在）；本页出现新协作窗时立即跟随新窗。 */
        var boxes = (window.App && App.chatBoxes) || [];
        var team = null;
        for (var i = 0; i < boxes.length; i++) {
          var c = boxes[i];
          if (c && c._collabTeam && c.el && c.el.isConnected) { team = c._collabTeam; break; }
        }
        if (team) { try { sessionStorage.setItem('zfFsTeam', team); } catch (e) {} }
        else { try { team = sessionStorage.getItem('zfFsTeam') || null; } catch (e) {} }
        var elHide = document.getElementById('zf-feedstream');
        if (!team) { if (elHide) elHide.style.display = 'none'; return; }
        var since = window['_zfFsWater_' + team] || 0;
        fetch('/api/plugin/collab/feed?team=' + encodeURIComponent(team) + '&since=' + since)
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || !j.ok) { var e2 = document.getElementById('zf-feedstream'); if (e2) e2.style.display = 'none'; return; }
            window['_zfFsWater_' + team] = j.server_ts || since;
            fsEnsure();
            document.getElementById('zf-feedstream').style.display = 'flex';
            fsRender(j);
            fsActivity();
          })
          .catch(function () {});
      } catch (e) {}
    }
    setInterval(function () { try { fsTick(); } catch (e) {} }, 2500);
  })();
})();
