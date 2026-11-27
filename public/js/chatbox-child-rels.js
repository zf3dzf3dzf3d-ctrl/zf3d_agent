/* ==========================================================================
 * chatbox-child-rels.js — 子对话关系与分数·单一真源（v1，2026-11-09）
 * 收口裁决产物：两份独立实现收敛于此，挂 window.ZFChildRel。
 * 新增子对话角色只改这里一处；分数/成员口径永不漂移。
 * 依赖：window.App.chatBoxes（消费方自行保证时机）
 * ⚠ 动此文件前先读 project_record「挂账台账-子对话确认面板」；
 *   【用户令 20261124】无双目录副本：public/js 为唯一目录（server/public 不存在），改动无需 copy。
 * ---------------------------------------------------------------------------
 * 【消费方清单】(2026-11-12 登记，进化师建议：API 签名变更须按下表全量回归)
 *   1. public/js/app-focus-mode.js        — 树形列表+迷你派生图+关系图谱窗（isSub/srcIdOf/childKeyOf）
 *   2. public/js/chatbox-right-queue.js   — :46,:123
 *   3. public/js/chatbox-next-round-button.js — :17,:24
 *   4. public/js/agent-01-project-memory.js   — :1427
 *   （新增消费方后必须回写本清单）
 * ========================================================================== */
(function () {
  'use strict';
  if (window.ZFChildRel) return;

  /* ---------- 子对话类型表（与 agent-01-project-memory.js _aliveSpawnCount 口径一致） ----------
   * 【协作师 20261124·v3.3】新增协作师（多路平等圆桌通气窗，chatbox-collab.js 派出）；
   * 平等窗关系：协作组成员间无父子箭头（不注册 ZFArrow），仅与派出者挂三条轻线（既有父子口径）。
   * 【v1.4 根治 20261126·delta】三轻线只读 el._collabTeam，但身份回挂链路（app.js 恢复回挂/
   * 协议头自愈、app-monitor 哨兵/离场重建）只挂 chatbox 对象不挂 el → 整页重启后 test(el) 恒
   * false：树形/图谱/i导航画不出「协作师↩派出者」轻线=箭头必丢。
   * 根治：collab 规则 test/src 走 _boxOf(el)——el 缺标记时按 box.el===el 从 App.chatBoxes 回读
   * chatbox 身份（双形态入参兼容），恢复链路无需逐一补挂，一处兜底根治两症状。 */
  function _boxOf(el) {
    try {
      if (!el) return null;
      if (el._collabTeam) return el; /* 已双挂的走快路 */
      var _cbs = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < _cbs.length; i++) {
        var b = _cbs[i];
        if (b && (b.el === el || b.id === el.id)) return b; /* chatbox 对象直入或按 el 反查 */
      }
    } catch (e) {}
    return null;
  }
  var CHILD_RULES = [
    { key: 'collab', label: '协作师', test: function (el) { var _b = _boxOf(el); return !!(_b && _b._collabTeam && _b._collabCodename); }, src: function (el) { var _b = _boxOf(el); return _b ? String(_b._collabTeam || '') : ''; } },
    { key: '策划师', test: function (el) { return el._isThinkerChat && el._thinkerSrcId; }, src: function (el) { return el._thinkerSrcId; } },
    { key: '审核员', test: function (el) { return el._isQcChat && el._qcSrcId; }, src: function (el) { return el._qcSrcId; } },
    { key: '施工队', test: function (el) { return el._raceSrcId; }, src: function (el) { return el._raceSrcId; } },
    { key: '优化师', test: function (el) { return el._isPolisherChat && el._polisherSrcId; }, src: function (el) { return el._polisherSrcId; } },
    { key: '安全师', test: function (el) { return el._isSecurityChat && el._securitySrcId; }, src: function (el) { return el._securitySrcId; } },
    { key: '自定义', test: function (el) { return el._isCustomChat && !el._isObjectorChat && !el._isVerifierChat && el._customSrcId; }, src: function (el) { return el._customSrcId; } },
    { key: '反驳师', test: function (el) { return el._isObjectorChat && el._customSrcId; }, src: function (el) { return el._customSrcId; } }
  ];

  /* 宽口径 isSub：含总结师/蜂群/派发/协作师 */
  function isSub(el) {
    if (!el) return false;
    return !!(el._isThinkerChat || el._isQcChat || el._isPolisherChat || el._isSecurityChat ||
              el._isCustomChat || el._isObjectorChat || el._isSummarizerChat || el._raceSrcId ||
              !!(function(){ var _b = _boxOf(el); return !!(_b && _b._collabTeam && _b._collabCodename); })());
  }

  /* src 链（宽口径）：总结师补 _summarizerSrcId，蜂群/派发补 _swarmSrcId/_dispatchSrcId */
  function srcIdOf(el) {
    if (!el) return null;
    return el._swarmSrcId || el._raceSrcId || el._dispatchSrcId ||
           el._thinkerSrcId || el._qcSrcId || el._polisherSrcId || el._securitySrcId ||
           el._customSrcId || el._objectorSrcId || el._summarizerSrcId || null;
  }

  /* 精确关系判定：返回 {key, srcId} 或 null */
  function childKeyOf(el) {
    if (!el) return null;
    for (var i = 0; i < CHILD_RULES.length; i++) {
      try { if (CHILD_RULES[i].test(el)) return { key: CHILD_RULES[i].key, srcId: String(CHILD_RULES[i].src(el)) }; } catch (e) {}
    }
    return null;
  }

  /* ---------- 分数提取（v2 最终分修复 2026-11-15）：
     旧版 _taskScore 单点缓存第一次抓到就永久锁定 → 用户看到的永远是"第一次的分数"。
     新版：从最后一条 assistant 消息向前找分数（AI 回复的最后一次分数为准），
     每次调用都实时重算；_taskScore 仅作回写展示缓存，新回答到来时被覆盖 */
  function scoreOf(chat) {
    try {
      var msgs = chat && (chat.history || chat.messages || chat.lines || []);
      /* 【v2 最终分】先取最后一条 assistant 的文本单独解析：流式/多轮时最后一条才是最新分 */
      for (var i = msgs.length - 1; i >= 0; i--) {
        var m = msgs[i]; if (!m || m.role === 'user' || m.isUser) continue;
        var t = typeof m.content === 'string' ? m.content : (m.content && m.content.text) || (m.text || '');
        var t0 = String(t);
        /* 【v4 收窄】兜底正则不再裸抓「数字+分」——"3 分钟/80 分页" 会误入分数。
           只认三类形态：①「X分制/满分X」 ②「(评|得|总|综合评)分：X」 ③「X/100」 */
        var mt0 = t0.match(/(?:【?(?:验证评分|审核评分|综合评分|推进师评分|评分|得分|分数|总分)】?[:：\s]*([0-9]{1,3})\s*分?)/)
              || t0.match(/(?:^|[^0-9])([0-9]{1,3})\s*分\s*(?:制|之)?[、，。；\s]/)
              || t0.match(/(?:评分|得分|分数|分)[：:：\s]*([0-9]{1,3})\s*(?:\/|／)\s*100/)
              || t0.match(/([0-9]{1,3})\s*(?:\/|／)\s*100/);
        if (mt0) {
          var n0 = parseInt(mt0[1], 10);
          if (n0 >= 0 && n0 <= 100) { return n0; }
        }
        /* 最后一条没有分数 → 继续向前找（上一条 assistant 的分数） */
      }
    } catch (e) {}
    /* 兜底：从对话 DOM 文本里抓分数（消息可能未同步进 chat.history） */
    try {
      if (chat && chat.el) {
        var mt2 = (chat.el.textContent || '').match(/(?:【?(?:验证评分|审核评分|综合评分|推进师评分|评分|得分|分数|总分)】?[:：\s]*([0-9]{1,3})\s*分?)/);
        if (mt2) { var n2 = parseInt(mt2[1], 10); if (n2 >= 0 && n2 <= 100) { return n2; } }
      }
    } catch (e4) {}
    return null;
  }

  function chatTitle(chat) {
    try { return (chat && (chat.title || (chat.el && chat.el.dataset && chat.el.dataset.chatTitle))) || '对话'; } catch (e) { return '对话'; }
  }

  /* ---------- 成员收集：该 srcId 下全部子对话 [{name, score, id, key}] ---------- */
  /* 【v5 回笼分回显】上次回笼分数：读右侧队列统一账本 zf_rq_score_history 末轮快照 */
  function lastHistScore(srcId, memberId) {
    try {
      var all = JSON.parse(localStorage.getItem('zf_rq_score_history') || '{}');
      var arr = all[String(srcId)] || [];
      for (var i = arr.length - 1; i >= 0; i--) {
        var ms = arr[i].members || [];
        for (var j = 0; j < ms.length; j++) {
          if (String(ms[j].id) === String(memberId) && ms[j].score != null) return ms[j].score;
        }
      }
    } catch (e) {}
    return null;
  }
  function membersOf(srcId) {
    var out = [], seen = {};
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      boxes.forEach(function (b) {
        if (!b || !b.el) return;
        if (!isSub(b.el)) return;
        var sid = srcIdOf(b.el);
        if (sid == null || String(sid) !== String(srcId)) return;
        var key = String(b.id); if (seen[key]) return; seen[key] = 1;
        var rel = childKeyOf(b.el);
        /* 【v5 回笼分回显 2026-11-15】重新派出后子对话新轮尚未答完 scoreOf=null →
           回退上次回笼分数（zf_rq_score_history 末轮同 id 快照），箭头/面板不丢上轮分 */
        var sc = scoreOf(b);
        if (sc == null) sc = lastHistScore(srcId, b.id);
        /* 【v13 职业名标题】名称优先职业名（策划师/审核员…），而非对话标题 */
        out.push({ name: (rel && rel.key) || (b.el._isSummarizerChat ? '总结师' : '') || chatTitle(b), score: sc, id: b.id, key: rel ? rel.key : (b.el._isSummarizerChat ? '总结师' : '') });
      });
    } catch (e) {}
    return out;
  }

  window.ZFChildRel = {
    CHILD_RULES: CHILD_RULES,
    isSub: isSub,
    srcIdOf: srcIdOf,
    childKeyOf: childKeyOf,
    scoreOf: scoreOf,
    chatTitle: chatTitle,
    membersOf: membersOf
  };
})();
