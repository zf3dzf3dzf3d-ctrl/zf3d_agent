// ==========================================================================
// chatbox-next-round-button.js — 子对话收口引导（v3，2026-11-09）
// v4 (S1 P0，2026-11-10)：收口决策面板改造（策划案 v1）——
//   ① 标题带「第 N 轮」：localStorage 轮次账本 zfNextRoundRounds[key=父对话chatId]（v1.1 统一键名，旧键 zfRoundLedger 自动迁移）；
//   ② 每成员「本轮分数 + 与上轮差值箭头」（▲绿/▼红/－灰）+ 轮均分对比条；
//   ③ 按均分引导推荐：≥85 建议总结收尾（高亮总结按钮）/ <70 建议再派一轮（高亮下一轮按钮），
//      只建议不代决，最终点击仍由用户完成。
// 需求：父对话派出子对话（策划师/审核员/施工队/自定义等），当全部子对话都已完成
//      （_taskStatus === 'success' 或 fail）且父对话也有过一轮答案时，
//      右侧出现「下一步」引导按钮，点击直达目标并弹出三选确认：
//        ① 🔄 进行第二轮（聚焦父对话输入框，方便用户直接追问）
//        ② 📝 总结并关闭（触发已有的总结师流程 _summarizerExpand，完成后级联关闭）
//        ③ 👁 跳转查看（摄像机跳到父对话并滚动到最后答案）
// v2/v3 新增：确认面板展示「本轮子对话分数」每个成员一行；有上一轮记录时并列
//      「上一轮分数」对比，两轮成员有变化时提示「⚠ 成员有变化」（UI师 中2）；
//      轮次签名 = 成员 id + 分数（突破师：同批子对话复用跑第二轮也能重新弹）。
// 设计原则：纯前端、只读检测；子对话关系/分数统一消费 window.ZFChildRel 单一真源
//      （收口裁决：进化师建议一 + 代码师 S2，消除双份类型表漂移）。
// ==========================================================================
(function () {
  'use strict';
  if (window.ZFNextRound) return;

  var CR = window.ZFChildRel; /* 单一真源：childKeyOf/scoreOf/chatTitle/membersOf */

  /* 【XSS 整改 2026-11-23】父对话标题等文本拼入 innerHTML 前统一转义（全站唯一实现 ZFMD.escapeHtml） */
  function _escH(s) {
    if (window.ZFMD && ZFMD.escapeHtml) return ZFMD.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 兜底与持久化：刷新恢复后 el 标记可能丢失 ----------
     childKeyOf 成功时把 childId→srcId 存 localStorage；
     childKeyOf 失败但标题像子对话时，从 localStorage 恢复 srcId。 */
  var LS_KEY = 'zfNextRoundChildMap';
  var TITLE_RE = /(策划师|审核员|质检员|施工|协作现场|优化师|安全师|反驳师|总结师)/;
  function isChildByTitle(el) {
    try {
      var t = (el.querySelector('.chatbox-title') || {}).textContent || el.dataset.title || '';
      return TITLE_RE.test(t);
    } catch (e) { return false; }
  }
  function loadChildMap() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
  function rememberChild(childId, srcId) {
    try {
      var m = loadChildMap();
      if (m[String(childId)] === String(srcId)) return;
      m[String(childId)] = String(srcId);
      localStorage.setItem(LS_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  function resolveChildRel(c) {
    var rel = CR.childKeyOf(c.el);
    if (rel) { rememberChild(c.id, rel.srcId); return rel; }
    if (isChildByTitle(c.el)) {
      var sid = loadChildMap()[String(c.id)];
      if (sid != null) {
        try { c.el._zfRecoveredSrcId = sid; } catch (e) {}
        return { key: 'restored', srcId: sid };
      }
    }
    return null;
  }

  /* ---------- 成员快照：[{key, name, score}]（真源 membersOf + 标题兜底） ---------- */
  function snapshotMembers(srcId) {
    var ms = CR.membersOf(srcId);
    if (ms.length) return ms;
    /* membersOf 只认 el 标记，刷新恢复场景用 childMap 兜底 */
    try {
      var m = loadChildMap(), byId = {};
      ((window.App && App.chatBoxes) || []).forEach(function (c) { if (c && c.id != null) byId[String(c.id)] = c; });
      Object.keys(m).forEach(function (cid) {
        if (String(m[cid]) !== String(srcId)) return;
        var b = byId[cid]; if (!b) return;
        ms.push({ name: CR.chatTitle(b), score: CR.scoreOf(b), id: b.id, key: '' });
      });
    } catch (e) {}
    return ms;
  }

  /* ---------- 轮次签名：成员 id + 分数 + 最后消息数/时间（突破师残影盲区：同批复用且分数不变时，消息数/时间变=新轮） ---------- */
  function roundSig(chat, srcId) {
    var ms = snapshotMembers(srcId);
    var byId = {};
    try { ((window.App && App.chatBoxes) || []).forEach(function (c) { if (c && c.id != null) byId[String(c.id)] = c; }); } catch (e) {}
    return ms.map(function (m) {
      var n = 0, ts = 0;
      try {
        var b = byId[String(m.id)];
        var msgs = (b && (b.messages || b.lines)) || [];
        n = msgs.length;
        var lm = msgs[msgs.length - 1];
        ts = (lm && (lm.ts || lm.time || lm.t)) || 0;
        if (typeof ts === 'string') ts = ts.length ? ts : 0;
      } catch (e) {}
      return String(m.id) + ':' + (m.score == null ? '-' : m.score) + ':' + n + ':' + ts;
    }).sort().join('|');
  }

  /* ---------- 收口检测：找出「有子对话、且子对话全部已答完」的父对话 ---------- */
  function collectReadyParents() {
    var boxes = (window.App && App.chatBoxes) || [];
    var byId = {};
    boxes.forEach(function (c) { if (c && c.id != null) byId[String(c.id)] = c; });

    /* 1) 聚合每个父对话的子对话状态 */
    var parents = {};   // srcId -> { total, doneN }
    boxes.forEach(function (c) {
      if (!c || !c.el || !c.el.isConnected) return;
      var rel = resolveChildRel(c);
      if (!rel) return;
      var p = parents[rel.srcId] || (parents[rel.srcId] = { total: 0, doneN: 0 });
      p.total++;
      var st = c._taskStatus;
      if (st === 'success' || st === 'fail') p.doneN++;
    });

    /* 2) 过滤：父对话存在、子对话全部答完、且本轮（签名）未处理过 */
    var out = [];
    Object.keys(parents).forEach(function (srcId) {
      var p = parents[srcId];
      var chat = byId[srcId];
      if (!chat || !chat.el || !chat.el.isConnected) return;
      if (!p.total || p.doneN < p.total) return;
      if (isHandled(chat, roundSig(chat, srcId))) return; /* 签名相同才跳过：分数/成员变→重新弹 */
      if (chat._taskStatus !== 'success' && chat._taskStatus !== 'fail') return;
      out.push(chat);
    });
    return out;
  }

  /* ---------- 按钮与弹层 ---------- */
  var btn = null;
  function ensureBtn() {
    if (btn && btn.isConnected) return btn;
    btn = document.createElement('button');
    btn.id = 'nextRoundBtn';
    btn.className = 'minimap-review-btn next-round-btn';
    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      /* 直达+确认一体：点击先跳到目标对话，同时在按钮旁弹出三选确认 */
      var list = collectReadyParents();
      if (!list.length) { btn.classList.remove('show'); return; }
      var chat;
      if (e.shiftKey && btn._lastJumpId != null) {
        var idx = -1;
        list.forEach(function (c, i) { if (String(c.id) === String(btn._lastJumpId)) idx = i; });
        chat = list[(idx + 1) % list.length];
      } else {
        chat = list[0];
      }
      btn._lastJumpId = chat.id;
      jumpToChat(chat);
      openMenu(chat, btn);
    });
    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var list = collectReadyParents();
      if (list.length) openMenu(list[0]);
    });
    document.body.appendChild(btn);
    return btn;
  }

  function openMenu(chat, anchorBtn) {
    var old = document.getElementById('nextRoundMenu');
    if (old) old.remove();
    var centered = !anchorBtn;
    var mask = document.createElement('div');
    mask.id = 'nextRoundMenu';
    mask.style.cssText = centered
      ? 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;'
      : 'position:fixed;inset:0;z-index:100002;background:transparent;';
    var dlg = document.createElement('div');
    dlg.style.cssText = 'background:#1e1533;border:1px solid rgba(102,187,106,.5);border-radius:14px;padding:18px 22px;min-width:300px;max-width:86vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.6);';
    var title = '子对话已全部完成';
    try { title = '「' + ((chat.el.querySelector('.chatbox-title') || {}).textContent || '父对话') + '」的子对话已全部完成'; } catch (e) {}
    var srcId = chat.id; /* 必须先于 roundNo 取值（mock 动态验收发现：var 提升致 getRound(undefined) 恒第1轮） */
    /* v4：标题带轮数（【XSS 整改 2026-11-23】title 来自 .chatbox-title textContent，可能含 <>，esc 后拼入） */
    var roundNo = getRound(srcId);
    dlg.innerHTML = '<div style="color:#c8e6c9;font-size:15px;font-weight:bold;margin-bottom:12px;">🎯 收口决策 · 第 ' + roundNo + ' 轮 · ' + _escH(title) + '</div>';

    var members = snapshotMembers(srcId);
    var prev = loadLastRound(srcId, roundSig(chat, srcId));
    var prevMap = {};
    if (prev) (prev.members || []).forEach(function (m) { if (m.id != null) prevMap[String(m.id)] = m.score; });
    var avgCur = avgScore(members), avgPrev = prev ? avgScore(prev.members) : null;
    var rec = recommend(avgCur); /* v4：只建议不代决 */

    /* 本轮子对话分数（UI师 中1：长名 ellipsis 截断） */
    if (members.length) {
      var cur = document.createElement('div');
      cur.style.cssText = 'margin-bottom:10px;';
      var curH = document.createElement('div');
      curH.style.cssText = 'font-size:11px;color:#8fa;opacity:.8;margin-bottom:4px;';
      curH.textContent = '本轮子对话分数';
      cur.appendChild(curH);
      members.forEach(function (m) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;color:#fff;padding:2px 0;';
        var nm = document.createElement('span');
        nm.style.cssText = 'flex:1;min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nm.textContent = m.name; nm.title = m.name;
        var sc = document.createElement('span');
        sc.style.cssText = 'font-weight:bold;color:' + (m.score == null ? '#999' : '#7ce38b') + ';white-space:nowrap;';
        sc.innerHTML = (m.score == null ? '—' : m.score + ' 分') + scoreArrow(m.score, prevMap, m.id); /* v4：差值箭头 */
        row.appendChild(nm); row.appendChild(sc); cur.appendChild(row);
      });
      /* v4：轮均分对比条 */
      if (avgCur != null) {
        var avgRow = document.createElement('div');
        avgRow.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px dashed rgba(255,255,255,.18);font-size:12px;color:#cde;';
        avgRow.textContent = '轮均分：' + (avgPrev != null ? '上一轮 ' + avgPrev + ' → ' : '') + '本轮 ' + avgCur;
        cur.appendChild(avgRow);
      }
      dlg.appendChild(cur);
    }

    /* v1.1 R4 半更新防护：快照写入失败时旧值不可信，降级提示不冒充对比 */
    if (lastRoundSaveFailed && prev) {
      var warnRow = document.createElement('div');
      warnRow.style.cssText = 'margin-bottom:8px;padding:6px 10px;border-radius:8px;font-size:12px;color:#e6b455;background:rgba(230,180,85,.12);';
      warnRow.textContent = '⚠️ 本轮分数存储失败，下方"上一轮分数"可能为过期数据，仅供参考';
      dlg.appendChild(warnRow);
    }

    /* v4：推荐引导横幅（只建议不代决） */
    if (rec) {
      var banner = document.createElement('div');
      banner.style.cssText = 'margin-bottom:10px;padding:8px 12px;border-radius:9px;font-size:13px;background:' +
        (rec.hi === 'sum' ? 'rgba(102,187,106,.18);color:#9fdca8;' :
         rec.hi === 'next' ? 'rgba(230,150,60,.18);color:#f0b878;' :
         'rgba(255,255,255,.08);color:#ccc;') + 'border:1px solid rgba(255,255,255,.15);';
      banner.textContent = rec.msg;
      dlg.appendChild(banner);
    }

    /* 上一轮分数对比（sig 不同才显示；UI师 中2：成员变化提示） */
    if (prev) {
      var prevBox = document.createElement('div');
      prevBox.style.cssText = 'margin-bottom:10px;padding-top:8px;border-top:1px dashed rgba(255,255,255,.18);';
      var changed = memberSetChanged(prev.members, members);
      var prevH = document.createElement('div');
      prevH.style.cssText = 'font-size:11px;color:#9aa;opacity:.8;margin-bottom:4px;';
      prevH.textContent = '上一轮分数' + (changed ? '　⚠ 成员有变化' : '');
      if (changed) prevH.style.color = '#e6b455';
      prevBox.appendChild(prevH);
      prev.members.forEach(function (m) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;color:#bbb;padding:2px 0;';
        var nm = document.createElement('span');
        nm.style.cssText = 'flex:1;min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nm.textContent = m.name; nm.title = m.name;
        var sc = document.createElement('span');
        sc.style.cssText = 'white-space:nowrap;color:' + (m.score == null ? '#888' : '#9fd8a8') + ';';
        sc.textContent = m.score == null ? '—' : m.score + ' 分';
        row.appendChild(nm); row.appendChild(sc); prevBox.appendChild(row);
      });
      dlg.appendChild(prevBox);
    }

    var list = document.createElement('div');

    function mkItem(icon, name, desc, go, hi) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:10px 14px;margin:6px 0;border-radius:9px;background:rgba(102,187,106,.10);border:1px solid rgba(102,187,106,.35);color:#fff;font-size:14px;cursor:pointer;';
      /* v4：按推荐高亮目标按钮（只建议不代决） */
      if (hi) {
        item.style.background = hi === 'sum' ? 'rgba(102,187,106,.30)' : 'rgba(230,150,60,.25)';
        item.style.borderColor = hi === 'sum' ? 'rgba(102,187,106,.9)' : 'rgba(230,150,60,.85)';
        item.style.boxShadow = '0 0 10px ' + (hi === 'sum' ? 'rgba(102,187,106,.35)' : 'rgba(230,150,60,.3)');
      }
      function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
      item.innerHTML = '<div style="font-weight:bold;">' + icon + ' ' + esc(name) + '</div><div style="font-size:11px;opacity:.75;margin-top:3px;">' + esc(desc) + '</div>';
      item.addEventListener('mouseenter', function () { item.style.background = 'rgba(102,187,106,.25)'; });
      item.addEventListener('mouseleave', function () { item.style.background = 'rgba(102,187,106,.10)'; });
      item.addEventListener('click', function () { mask.remove(); markHandled(chat, roundSig(chat, srcId)); go(); });
      return item;
    }

    list.appendChild(mkItem('🔄', '派出下一轮', '基于本轮结论继续派出下一批子对话（轮数预写 N+1）', function () {
      bumpRound(srcId); /* v4：轮次账本预写 N+1 */
      recordChoice(srcId, avgCur, 'next'); /* v1.1 阈值校准数据采集 */
      if (App._focusChatBox) App._focusChatBox(chat);
      setTimeout(function () {
        try {
          var inp = chat.el.querySelector('textarea, .chat-input, [contenteditable]');
          if (inp) inp.focus();
        } catch (e) {}
      }, 300);
    }, rec && rec.hi === 'next'));

    list.appendChild(mkItem('📝', '派出总结师', '派出总结师汇总本轮成果，完成后自动级联关闭（封存轮次账本）', function () {
      closeRound(srcId); /* v4：封存，不再计数 */
      recordChoice(srcId, avgCur, 'sum'); /* v1.1 阈值校准数据采集 */
      try {
        if (App._summarizerExpand) { App._summarizerExpand(null, chat); return; }
      } catch (e) {}
      if (App._focusChatBox) App._focusChatBox(chat);
    }, rec && rec.hi === 'sum'));

    list.appendChild(mkItem('👁', '直达查看', '摄像机跳到父对话并滚动到最后答案', function () {
      if (App._focusChatBox) App._focusChatBox(chat);
      if (App._scrollChatToLastAnswer) App._scrollChatToLastAnswer(chat);
    }));

    dlg.appendChild(list);
    var cancel = document.createElement('div');
    /* UI师 低4：加大热区 */
    cancel.style.cssText = 'text-align:center;color:#999;font-size:12px;margin-top:10px;cursor:pointer;padding:8px 0;';
    cancel.textContent = '稍后再说';
    cancel.addEventListener('click', function () { mask.remove(); });
    dlg.appendChild(cancel);
    mask.appendChild(dlg);
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    if (!centered && anchorBtn) {
      /* 锚点模式（UI师 低3：offsetWidth 动态计算，不硬编码 340） */
      dlg.style.position = 'fixed';
      try {
        var r = anchorBtn.getBoundingClientRect();
        var w = dlg.offsetWidth || 340;
        dlg.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
        dlg.style.top = Math.min(window.innerHeight - 260, r.bottom + 12) + 'px';
      } catch (e2) { dlg.style.left = '50%'; dlg.style.top = '40%'; }
    }
    document.body.appendChild(mask);
  }

  /* ---------- 已处理标记：按轮次签名（成员id+分数），同批子对话跑第二轮会重新弹 ---------- */
  var HANDLED_KEY = 'zfNextRoundHandled';
  function loadHandled() { try { return JSON.parse(localStorage.getItem(HANDLED_KEY) || '{}'); } catch (e) { return {}; } }
  function markHandled(chat, sig) {
    try {
      chat._zfNextRoundHandledSig = sig;
      var h = loadHandled();
      h[String(chat.id)] = sig;
      saveLastRound(chat.id, sig, snapshotMembers(chat.id));
      localStorage.setItem(HANDLED_KEY, JSON.stringify(h));
    } catch (e) {}
  }
  function isHandled(chat, sig) {
    if (chat._zfNextRoundHandledSig === sig) return true;
    var h = loadHandled();
    return h[String(chat.id)] === sig;
  }

  /* ---------- 上轮分数快照：localStorage zfNextRoundLastRound[srcId] = {sig, members, ts} ----------
     【v9 联动】loadLastRound 改优先读统一历史账本 ZFRightQueue.scoreHistory（zf_rq_score_history）：
     取末两轮做对比；旧键保留兼容读取（账本无数据时回退），逐步退役 ---------- */
  var LAST_KEY = 'zfNextRoundLastRound';
  function loadLastRound(srcId, curSig) {
    try {
      /* v9 优先：统一账本末两轮（round 单调即 sig 不同） */
      var RQ = window.ZFRightQueue && window.ZFRightQueue.scoreHistory;
      if (RQ) {
        var arr = RQ.get(srcId) || [];
        if (arr.length >= 2) {
          var a = arr[arr.length - 2], b = arr[arr.length - 1];
          var sameRound = a.round === b.round;
          if (!sameRound) return { sig: 'hist-' + a.round, members: a.members, ts: a.ts };
        }
      }
      var all = JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
      var e = all[String(srcId)];
      if (!e || e.sig === curSig) return null;
      return e;
    } catch (e2) { return null; }
  }
  function saveLastRound(srcId, sig, members) {
    try {
      var all = JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
      all[String(srcId)] = { sig: sig, members: members, ts: Date.now() };
      localStorage.setItem(LAST_KEY, JSON.stringify(all));
      lastRoundSaveFailed = false;
    } catch (e) { lastRoundSaveFailed = true; } /* v1.1 R4：写失败置位，面板降级提示 */
  }
  var lastRoundSaveFailed = false; /* v1.1 R4 半更新防护：true=上次快照写入失败，面板禁止拿旧值冒充本轮对比 */
  /* v1.1 阈值 choices 校准：记录（均分，用户选择），攒够后动态校准阈值 */
  var CHOICES_KEY = 'zfNextRoundChoices';
  function recordChoice(srcId, avg, choice) {
    try {
      var all = JSON.parse(localStorage.getItem(CHOICES_KEY) || '[]');
      all.push({ srcId: String(srcId), avg: avg, choice: choice, ts: Date.now() });
      if (all.length > 200) all = all.slice(-200);
      localStorage.setItem(CHOICES_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function calibratedThresholds() {
    var base = { sum: 85, next: 70 };
    try {
      var all = JSON.parse(localStorage.getItem(CHOICES_KEY) || '[]');
      if (!all || all.length < 20) return base; /* v1.1：不足 20 条用默认，不动态调 */
      var sums = [], nxts = [];
      all.forEach(function (e) {
        if (e.avg == null) return;
        if (e.choice === 'sum') sums.push(e.avg); else if (e.choice === 'next') nxts.push(e.avg);
      });
      /* 校准：sum 阈值=用户点总结时的均分均值下取整；next 阈值=点下一轮时的均分均值下取整 */
      function mean(a) { return a.length ? Math.floor(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; }
      var s = mean(sums), n = mean(nxts);
      if (s != null && s > 50 && s < 100) base.sum = s;
      if (n != null && n > 30 && n < 90 && (!base.sum || n < base.sum)) base.next = n;
    } catch (e) {}
    return base;
  }
  function memberSetChanged(a, b) {
    var ka = {}, kb = {};
    (a || []).forEach(function (m) { ka[String(m.id)] = 1; });
    (b || []).forEach(function (m) { kb[String(m.id)] = 1; });
    var k;
    for (k in ka) if (!kb[k]) return true;
    for (k in kb) if (!ka[k]) return true;
    return false;
  }

  /* ---------- v1.1 轮次账本：zfNextRoundRounds[srcId] = {round, closed} ----------
     派下一轮时预写 N+1（doNextRound），总结时封存（closed=true 不再计数）。
     v1.1 键名统一（裁决 fa6af38）：原 v4 用的 zfRoundLedger 在 loadRounds 里一次性迁移。
     突破师冷水①：localStorage 跨设备会丢，仅作展示用途；后续 S3 可上 server 真源。 */
  var ROUND_KEY = 'zfNextRoundRounds';
  var LEGACY_ROUND_KEY = 'zfRoundLedger'; /* v4 旧键名，迁移后删除 */
  function loadRounds() {
    try {
      var all = JSON.parse(localStorage.getItem(ROUND_KEY) || '{}');
      /* v1.1 存量迁移：旧键有数据且新键为空时搬过来，删旧键，杜绝双账本 */
      try {
        var legacy = localStorage.getItem(LEGACY_ROUND_KEY);
        if (legacy && localStorage.getItem(ROUND_KEY) == null) {
          all = JSON.parse(legacy) || {};
          localStorage.setItem(ROUND_KEY, JSON.stringify(all));
          localStorage.removeItem(LEGACY_ROUND_KEY);
        } else if (legacy) {
          localStorage.removeItem(LEGACY_ROUND_KEY);
        }
      } catch (e2) {}
      return all;
    } catch (e) { return {}; }
  }
  function getRound(srcId) {
    var r = loadRounds()[String(srcId)];
    return (r && !r.closed && r.round > 0) ? r.round : 1;
  }
  function bumpRound(srcId) {
    try {
      var all = loadRounds();
      var r = all[String(srcId)] || { round: 1 };
      r.round = (r.round || 1) + 1; r.closed = false; r.ts = Date.now();
      all[String(srcId)] = r;
      localStorage.setItem(ROUND_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function closeRound(srcId) {
    try {
      var all = loadRounds();
      var r = all[String(srcId)] || { round: 1 };
      r.closed = true; r.ts = Date.now();
      all[String(srcId)] = r;
      localStorage.setItem(ROUND_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  /* v4 均分与差值箭头 */
  function avgScore(members) {
    var s = 0, n = 0;
    (members || []).forEach(function (m) { if (m.score != null) { s += Number(m.score) || 0; n++; } });
    return n ? Math.round(s / n) : null;
  }
  function scoreArrow(cur, prevMap, id) {
    if (cur == null) return '';
    var p = prevMap && prevMap[String(id)];
    if (p == null) return '';
    var d = Number(cur) - Number(p);
    if (d > 0) return ' <span style="color:#7ce38b;font-size:11px;">▲+' + d + '</span>';
    if (d < 0) return ' <span style="color:#e57373;font-size:11px;">▼' + d + '</span>';
    return ' <span style="color:#999;font-size:11px;">－持平</span>';
  }
  /* v1.1 推荐引导：只建议不代决；阈值经 choices 校准 */
  function recommend(avg) {
    if (avg == null) return null;
    var th = calibratedThresholds();
    if (avg >= th.sum) return { msg: '✅ 质量较高（均分 ' + avg + ' ≥ ' + th.sum + '），建议总结收尾', hi: 'sum' };
    if (avg < th.next) return { msg: '⚠️ 分数偏低（均分 ' + avg + ' < ' + th.next + '），建议再派一轮补强', hi: 'next' };
    return { msg: '⚖️ 质量中等（均分 ' + avg + '），两可，由您拍板', hi: null };
  }

  /* ---------- 直达跳转：摄像机跳到目标对话 + 滚到最后答案 + 高亮提示 ---------- */
  function jumpToChat(chat) {
    try {
      if (App._focusChatBox) App._focusChatBox(chat.id != null ? chat.id : chat);
      if (App._scrollChatToLastAnswer) App._scrollChatToLastAnswer(chat);
      if (chat.el) {
        var old = chat.el.style.boxShadow;
        chat.el.style.boxShadow = '0 0 0 3px rgba(102,187,106,.9)';
        setTimeout(function () { try { chat.el.style.boxShadow = old; } catch (e) {} }, 900);
      }
    } catch (e) {}
  }

  /* ---------- 轮询刷新（2s，轻量只读） ---------- */
  function tick() {
    try {
      if (!window.App || !App.chatBoxes) return;
      var targets = collectReadyParents();
      var b = ensureBtn();
      /* 2026-11-15 中间「子对话已完成」悬浮按钮已下线：与注意力箭头系统功能重复。
         仅保留 collectReadyParents 账本逻辑与 ZFNextRound 导出（mile-balls/right-queue 依赖 getRound），不再渲染/显示按钮。 */
      b.classList.remove('show');
    } catch (e) {}
  }

  function start() {
    if (window.ZFNextRound) return;
    window.ZFNextRound = { collectReadyParents: collectReadyParents, refresh: tick, getRound: getRound };
    setInterval(tick, 2000);
    try {
      var _origRender = App.renderMessages;
      if (typeof _origRender === 'function') {
        App.renderMessages = function () {
          var r = _origRender.apply(this, arguments);
          setTimeout(tick, 200);
          return r;
        };
      }
    } catch (e) {}
    tick();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
