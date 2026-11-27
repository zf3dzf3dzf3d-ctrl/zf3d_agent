/* ============================================================
 * chatbox-summarizer-arrow.js —— 总结师琥珀色方向箭头（v2 薄壳·内核版）
 * 渲染/定位/rAF循环/z-index/悬停提升/恢复熔断 全部委托 zf-arrow-core.js
 * 本壳只保留业务：总结状态机 + 沉淀提取 + 回注原对话
 * 状态：pending(总结中·琥珀·流动) / clarified(已总结·深琥珀) / applied(已沉淀·绿) / failed(失效·灰)
 * 用法：window.ZFSummarizerArrow.create(srcChat, thinkerChat) → type:'sub'（派出小队，小号）
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFSummarizerArrow) return;

  var AMBER = '#ffb300';
  var AMBER_D = '#ff8f00';
  var KEY = 'zf_summarizer_pairs';
  var CONCLUSION_RE = /【总结师沉淀】/;

  var STATUS = {
    modified:  { color: '#00e676', text: '修改完成', flow: false },
    done:      { color: '#00e676', text: '总结完成', flow: false },
    pending:   { color: AMBER, text: '总结中', flow: true },
    clarified: { color: AMBER_D, text: '已总结', flow: false },
    applied:   { color: '#00e676', text: '已沉淀', flow: false },
    failed:    { color: '#9e9e9e', text: '已失效', flow: false }
  };

  function findChat(id) {
    try {
      if (window.App && App.findChatBox) return App.findChatBox(id);
      var list = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) return list[i]; }
    } catch (e) {}
    return null;
  }
  function lastAnswer(chat) {
    try {
      var h = (chat && chat.history) || [];
      for (var i = h.length - 1; i >= 0; i--) {
        if (h[i].role === 'assistant' && String(h[i].content || '').trim()) return String(h[i].content);
      }
    } catch (e) {}
    return '';
  }
  function lastUserMsg(chat) {
    try {
      var h = (chat && chat.history) || [];
      for (var i = h.length - 1; i >= 0; i--) {
        if (h[i].role !== 'user') continue;
        var c = String(h[i].content || '').trim();
        if (!c || c.indexOf('（策划师素材包') === 0 || c.indexOf('（审核员素材包') === 0 || c.indexOf('（总结师素材包') === 0) continue;
        if (/^【?(系统|系统提示|素材包)/.test(c)) continue;
        return c;
      }
    } catch (e) {}
    return '';
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
        if (/^【?(系统|系统提示|素材包)/.test(c)) continue;
        /* 【v8 上下文后置】取【当前项目上下文】之前正文 */
        var idx8 = c.indexOf('【当前项目上下文】');
        if (idx8 > 0) c = c.slice(0, idx8);
        else {
          var m = c.match(/-{2,}\s*上下文结束\s*-{2,}/);
          if (m && m.index !== undefined) c = c.slice(m.index + m[0].length);
        }
        c = c.replace(/^[（(][^（）()]*[)）]\s*/g, '');
        c = c.replace(/^@[^\s@]{1,20}\s*/g, '');
        c = c.replace(/^(【[^】]{1,20}】|#[^\s#]{1,20}\s*|\[[^\]]{1,20}\])\s*/g, '');
        return c.trim().slice(0, 40);
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

  // 提取总结师最新沉淀段落（【总结师沉淀】…），无则返回 ''
  function lastConclusion(chat) {
    var ans = lastAnswer(chat);
    if (!ans) return '';
    var idx = ans.lastIndexOf('【总结师沉淀】');
    if (idx < 0) return '';
    var tail = String(ans).slice(idx);
    var lines = tail.split('\n');
    var first = (lines[0] || '').trim();
    if (first.length > '【总结师沉淀】'.length) return first;
    var collected = [lines[0]];
    for (var li = 1; li < lines.length; li++) {
      var ln = lines[li].trim();
      if (!ln) { if (collected.length > 1) break; continue; }
      if (/^#{1,3}\s/.test(ln) && collected.length > 1) break;
      collected.push(lines[li]);
    }
    return collected.join('\n').trim();
  }

  /* ---------- 存档（数据仍本壳持有，序列化简单干净） ---------- */
  function persist() {
    try {
      var _mem = window.ZFArrow.all().filter(function (p) { return p.kind === 'summarizer'; }).map(function (p) {
        return { srcId: p.srcId, tkId: p.dstId, state: p.state, status: p.status, phase: p.phase || '', tkCount: p.tkCount || 0, rounds: p.rounds || 0, question: p.question || '' };
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
  function onArrowClick(p) {
    var src = findChat(p.srcId), tk = findChat(p.dstId);
    if (!src || !tk) { ZFArrow.remove(p); return; }
    var note = p._takeNote ? p._takeNote() : '';

    if (p.phase === 'sent') {
      var concl = lastConclusion(tk);
      var ans = lastAnswer(tk);
      if (!ans) { toast('总结师还没有沉淀结论，无法回注', false); return; }
      var msg = concl
        ? ('这是总结师对本任务的沉淀结论，请作为经验参考：可复用要点纳入后续做法、遗留事项可考虑跟进；本条仅为参考信息，不需要执行新任务，严禁 ask_user 追问：\n\n' + concl)
        : ('这是总结师对本任务的整体总结思考，请作为经验参考归档（不需要执行新任务，不要追问）：\n\n' + ans);
      p.phase = 'injected';
      p.state = 'toSrc';
      p.tkCount = assistantCount(tk);
      ZFArrow.setStatus(p, concl ? 'done' : 'applied');
      sendTo(src, msg + note);
      toast('已回注沉淀到原对话；原对话可继续任务或直接结束', true);
      return;
    }
    var userNew = lastUserMsg(src);
    var ans2 = lastAnswer(src);
    if (!userNew && !ans2) { toast('原对话还没有内容，无法传送', false); return; }
    var body = userNew ? userNew : ans2;
    p.state = 'toDst';
    p.phase = 'sent';
    p.tkCount = assistantCount(tk);
    ZFArrow.setStatus(p, 'pending');
    sendTo(tk, '请针对以下内容做任务总结与沉淀（提炼技能方法：这个问题依靠什么方法解决的、下次如何复用该方法/可复用经验/改动清单/遗留事项），最终给出【总结师沉淀】：\n\n' + body + note);
    toast('已送总结师总结（总结中）', true);
  }

  /* ---------- 回复自动检测（挂在内核 tick 的 detect 钩子） ---------- */
  function detectReply(p) {
    if (p.status !== 'pending') return;
    var tk = findChat(p.dstId);
    if (!tk) return;
    var nowCount = assistantCount(tk);
    if (nowCount <= (p.tkCount || 0)) return;
    var ans = lastAnswer(tk);
    if (!ans) return;
    p.tkCount = nowCount;
    p.rounds = (p.rounds || 0) + 1;
    if (CONCLUSION_RE.test(ans)) {
      p.phase = 'sent';
      ZFArrow.setStatus(p, 'clarified');
      toast('总结师已给出沉淀结论，点击箭头即可回注原对话', true);
    } else {
      ZFArrow.setStatus(p, 'pending');
    }
  }
  function detectSrcModified(p) {
    if (p.status !== 'applied' && p.status !== 'done') return;
    var src = findChat(p.srcId);
    if (!src) return;
    var nowCount = assistantCount(src);
    if (nowCount <= (p.srcCount || 0)) return;
    p.srcCount = nowCount;
    ZFArrow.setStatus(p, 'modified');
    toast('原对话已按策划结论修改完成', true);
  }

  /* ---------- 创建（薄壳：只传配置，渲染全在内核） ---------- */
  function create(srcChat, tkChat) {
    if (!srcChat || !tkChat || !srcChat.el || !tkChat.el) return;
    var inst = window.ZFArrow.create({
      srcId: srcChat.id, dstId: tkChat.id,
      kind: 'summarizer',
      type: 'sub', /* 派出小队箭头 → sub 小号 */
      colors: { line: AMBER, badgeText: '#1a0a2e' },
      statuses: STATUS,
      badge: '总结中',
      state: 'toDst', status: 'pending',
      noteInput: true,
      persistKey: KEY, persist: persist,
      onClick: onArrowClick,
      detect: function (p) { detectReply(p); detectSrcModified(p); },
      getTitle: function (p, st) {
        return (p.question ? '【' + p.question + '】\n' : '') + '当前状态：' + st.text + '（已总结 ' + (p.rounds || 0) + ' 轮）（点击：把总结师沉淀回注箭头指向的对话）';
      }
    });
    if (inst) {
      inst.question = firstQuestion(srcChat);
      inst.tkCount = assistantCount(tkChat);
      persist();
    }
    return inst;
  }

  /* ---------- 恢复（内核熔断：对端已删直接清档，杜绝无限循环 OOM） ---------- */
  function restorePairs(silent) {
    var n = window.ZFArrow.restore({
      key: KEY,
      rebuild: function (d) {
        var src = findChat(d.srcId), tk = findChat(d.tkId);
        if (!src || !tk) return null; /* 熔断：对端已删 → null → 内核剔档 */
        var p = create(src, tk);
        if (!p) return null;
        p.state = d.state === 'toSrc' ? 'toSrc' : 'toDst';
        p.status = STATUS[d.status] ? d.status : 'pending';
        p.phase = d.phase || '';
        p.tkCount = d.tkCount || assistantCount(tk);
        p.rounds = d.rounds || 0;
        p.question = d.question || firstQuestion(src);
        window.ZFArrow.applyStatus(p);
        return p;
      }
    });
    if (n && !silent) toast('已恢复 ' + n + ' 条总结师箭头（含状态）', true);
    if (n) persist();
    return n;
  }

  /* ---------- 事件同步（multi 总箭头收口/发散联动，原样保留） ---------- */
  document.addEventListener('zf-multi-gathered', function (ev) {
    try {
      var sid = ev.detail && ev.detail.srcId;
      window.ZFArrow.all().forEach(function (p) {
        if (p.kind !== 'summarizer' || String(p.srcId) !== String(sid)) return;
        if (p.state !== 'toDst') return;
        p.state = 'toSrc'; p.phase = 'injected';
        p.tkCount = assistantCount(findChat(p.dstId) || {});
        p.status = 'applied';
        window.ZFArrow.applyStatus(p); persist();
      });
    } catch (e) {}
  });
  document.addEventListener('zf-multi-scattered', function (ev) {
    try {
      var sid2 = ev.detail && ev.detail.srcId;
      window.ZFArrow.all().forEach(function (p) {
        if (p.kind !== 'summarizer' || String(p.srcId) !== String(sid2)) return;
        if (p.state !== 'toSrc') return;
        p.state = 'toDst'; p.phase = 'sent'; p.status = 'pending';
        window.ZFArrow.applyStatus(p); persist();
      });
    } catch (e) {}
  });

  window.ZFSummarizerArrow = {
    create: create,
    restore: restorePairs,
    getPairs: function () {
      return window.ZFArrow.all().filter(function (p) { return p.kind === 'summarizer'; })
        .map(function (p) { return { srcId: p.srcId, tkId: p.dstId, state: p.state, status: p.status }; });
    },
    recallChild: function (boxId) {
      var list = window.ZFArrow.all().filter(function (p) { return p.kind === 'summarizer'; });
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (String(p.dstId) === String(boxId) && p.el && p.el.isConnected && p.phase === 'sent') {
          try { onArrowClick(p); return true; } catch (e) { return false; }
        }
      }
      return false;
    }
  };

  /* ---------- 启动恢复（含 DOM 异步挂载重试，最多 600 秒，恢复满即停） ---------- */
  (function waitRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
      var hasSaved = raw && raw !== '[]' && raw !== 'null';
      var anyBox = window.App && App.chatBoxes && App.chatBoxes.length > 0;
      if (tries > 600) { clearInterval(timer); return; }
      if (hasSaved && anyBox) {
        restorePairs(true);
        var total = 0;
        try { total = (JSON.parse(raw) || []).length; } catch (e) {}
        var done = window.ZFArrow.all().filter(function (p) { return p.kind === 'summarizer' && p.el && p.el.isConnected; }).length;
        if (!total || done >= total) clearInterval(timer);
      }
    }, 1000);
  })();
  // [summarizer-arrow] v2 薄壳已加载（内核版）
})();
