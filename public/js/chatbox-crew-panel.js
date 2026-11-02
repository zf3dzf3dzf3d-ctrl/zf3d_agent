/* =====================================================================
 * chatbox-crew-panel.js — 🐝 小队卡通派出面板（v1.0 2026-10-27）
 * =====================================================================
 * 交互（对应用户定稿）：
 *   1. 一排卡通角色卡（策划🧭 反驳🔥 进化🧬 施工🔨 审核🛡️ 验证🧪 专家🎓 总结📋 加入团队🛠 技能总结🧠 发布广场🌐 普通对话💬 自定义🎭）
 *      点一次 +1，卡片右上角显示数量角标；右键点击 -1（减员）
 *   2. 下方名单列表 = 本次派出去的人（可点 ✕ 取消单人）
 *   3. 「一句话」输入框（必填，空则派出按钮置灰）
 *   4. 大「🚀 派出」按钮：一次多路派出，错峰 500ms
 *   5. 回收全自动：派出前写入 window._zfAutoGatherNext（时间戳标志，
 *      原三种箭头各自读取），不再需要回收按钮/选项
 *   6. 叮嘱注入：每个角色 setTimeout 回调执行前重写 window._zfCustomNoteNext
 *      （原机制首窗消费即置 null，逐个重写 = 每个角色都拿到同一句话）
 *   7. 施工队走 ZFCrew.dispatchCrew（不吃叮嘱）；总结师/自定义吃叮嘱
 * 挂载：幂等守卫 + MutationObserver 常驻轮询重注入（防抽屉重建丢面板）
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFCrewPanel) return; // 幂等守卫
  var P = window.ZFCrewPanel = { version: '1.0' };

  /* ── 白色简约线稿 SVG 图标（stroke 风格，currentColor 随文字色） ── */
  var ICONS = {
    thinker:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M12 7l2 3h-4l2-3z"/><path d="M9.5 12a2.5 2.5 0 0 0 5 0"/></svg>',
    crew:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5l6 6-2 2-6-6 2-2z"/><path d="M11 7L4 14a2 2 0 0 0 0 3l3 3a2 2 0 0 0 3 0l7-7"/><path d="M9 13l2 2"/></svg>',
    objector:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.3-2-.8-3-.5 1-1.2 1.5-1.2 1.5C16.5 6 14 4 12 3z"/><path d="M9 14a3 3 0 1 0 6 0c0-1.5-1-2.5-2-3.5 0 1.5-2 2-2 3.5"/><path d="M5 21h14"/></svg>',
    evolution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8c0 4 3 5 5 8 1.5 2.3 1 4-1 4-3 0-7-3-7-8 0-2 .5-4 3-4z"/><path d="M17 16c0-4-3-5-5-8-1.5-2.3-1-4 1-4 3 0 7 3 7 8 0 2-.5 4-3 4z"/></svg>',
    verifier:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4M11 3v6l-5 8a2.5 2.5 0 0 0 2.2 4h7.6A2.5 2.5 0 0 0 18 17l-5-8V3"/><path d="M8.5 15h7"/></svg>',
    qc:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    summarizer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    sumcrew:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5l5 5M21 5l-5 5"/></svg>',
    sumskill:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 3z"/></svg>',
    sumforum:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9h8M8 12h5"/></svg>',
    polisher:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20L14 10"/><path d="M13 5l1.2 2.8L17 9l-2.8 1.2L13 13l-1.2-2.8L9 9l2.8-1.2L13 5z"/><path d="M18.5 13.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7.7-1.6z"/></svg>',
    security:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z"/><rect x="9.5" y="10.5" width="5" height="4" rx="0.8"/><path d="M10.5 10.5V9.5a1.5 1.5 0 0 1 3 0v1"/></svg>',
    custom:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 15.5c1 1 2 1.5 3.5 1.5s2.5-.5 3.5-1.5"/></svg>',
    plain:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4V5z"/><circle cx="9" cy="10.5" r="0.6" fill="currentColor"/><circle cx="12" cy="10.5" r="0.6" fill="currentColor"/><circle cx="15" cy="10.5" r="0.6" fill="currentColor"/></svg>',
    expert:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9l10-4 10 4-10 4L2 9z"/><path d="M6 11v4c0 1.5 2.7 3 6 3s6-1.5 6-3v-4"/><path d="M22 9v5"/></svg>'
  };
  function icon(key, size) {
    return '<span style="display:inline-flex;width:' + (size || 20) + 'px;height:' + (size || 20) + 'px;color:#fff;">' + (ICONS[key] || '') + '</span>';
  }

  /* ── 角色注册表（表驱动，新增角色只改这里） ── */
  var ROLES = [
    { key: 'thinker',  face: '🧭', name: '策划师',  count: 1, note: true,  fn: function (box, chat) { App._thinkerExpand(box, chat); } },
    { key: 'objector', face: '🔥', name: '反驳师',  count: 0, note: true,  fn: function (box, chat) { App._objectorExpand(box, chat); } },
    { key: 'evolution',face: '🧬', name: '进化师',  count: 0, note: true,  fn: function (box, chat) { App._evolutionistExpand(box, chat); } },
    { key: 'crew',     face: '🔨', name: '施工队',  count: 0, note: false, fn: function (box, chat, n) { if (window.ZFCrew && ZFCrew.dispatchCrew) ZFCrew.dispatchCrew(chat, n); else App._stepToast('协作施工队模块未加载', false); } },
    { key: 'qc',       face: '🛡️', name: '审核师',  count: 0, note: true,  fn: function (box, chat) { App._objectiveVerify(box, chat); } },
    { key: 'verifier', face: '🧪', name: '验证师',  count: 0, note: true,  fn: function (box, chat) { App._verifierExpand(box, chat); } },
    { key: 'polisher', face: '✨', name: '优化师',  count: 0, note: true,  fn: function (box, chat) { App._polisherExpand ? App._polisherExpand(box, chat) : App._stepToast('优化师模块未加载', false); } },
    { key: 'security', face: '🔒', name: '安全师',  count: 0, note: true,  fn: function (box, chat) { App._securityExpand ? App._securityExpand(box, chat) : App._stepToast('安全师模块未加载', false); } },
    { key: 'expert',   face: '🎓', name: '专家团',  count: 0, note: true,  fn: function (box, chat) { if (window.ZFExpertTeam && window.ZFExpertTeam.dispatch) App._expertDispatch(box, chat); else App._stepToast('专家团模块未加载', false); } },
    { key: 'summarizer',face:'📋', name: '总结师',  count: 0, note: true,  fn: function (box, chat) { App._summarizerExpand ? App._summarizerExpand(box, chat) : App._stepToast('总结师请从角色列表选择', true); } },
    { key: 'sumcrew',   face:'🛠', name: '加入团队', count: 0, note: true, fn: function (box, chat) {
        // AI 全自动：无任何弹窗，后端读对话历史 + AI 总结成员名/接手线索/路径，直接入库
        var chatId = String((chat && chat.id) || window.__zfChatId || window.__chatId || (window.currentSession && window.currentSession.id) || '');
        App._stepToast ? App._stepToast('🛠 AI 正在总结本对话并加入团队…', false) : null;
        fetch('/api/butler/team', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'auto_join', chat_id: String(chatId) })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (x) {
              if (!x.ok || x.j.ok === false) throw new Error(x.j.err || x.j.error || ('HTTP ' + x.ok));
              App._stepToast ? App._stepToast('✅ 已自动加入工作台团队：' + x.j.name, true) : alert('✅ 已自动加入工作台团队：' + x.j.name);
          })
          .catch(function (e) { alert('加入失败：' + (e.message || e)); });
      } },
    { key: 'sumskill',  face:'🧠', name: '技能总结', count: 0, note: true,  fn: function (box, chat) { App._summarizerExpand ? App._summarizerExpand(box, chat, 'skill') : App._stepToast('总结师请从角色列表选择', true); } },
    { key: 'sumforum',  face:'🌐', name: '发布广场', count: 0, note: true, fn: function (box, chat) { App._summarizerExpand ? App._summarizerExpand(box, chat, 'forum') : App._stepToast('总结师请从角色列表选择', true); } },
    { key: 'plain',    face: '💬', name: '普通对话', count: 0, note: true,  fn: function (box, chat) { App._plainExpand ? App._plainExpand(box, chat) : App._stepToast('普通对话模块未加载', false); } },
    { key: 'custom',   face: '🎭', name: '自定义',  count: 0, note: true,  fn: function (box, chat) { App._customExpand(box, chat); } }
  ];
  /* 全部 15 个角色都进面板，两排×7（第三排1个） */

  /* ── 面板状态（挂 chat 上，切对话独立） ── */
  function state(chat) {
    if (!chat._crewPanel) chat._crewPanel = { picks: {}, note: '', collapsed: true };
    return chat._crewPanel;
  }

  /* ── 渲染面板（注入到按钮行 wrap 之后的 body 里；找不到就返回 null 等下轮） ── */
  function mount(box, chat) {
    var body = box && box.querySelector ? box.querySelector('.chatbox-body') : null;
    if (!body) return false;
    var _exist = body.querySelector('.zf-crew-panel');
    if (_exist) {
      /* 【常驻中部】面板固定挂在「自验收/本次提问」按钮行（.msg.compress-selector）之后——
         那一排原来就是审核/策划等按钮的位置，派出团队面板应与其同区，而不是跟到最后一条消息后面
         （流式追加/尾部工具行都不会把它挤走） */
      var _btnRow = body.querySelector('.msg.compress-selector');
      if (_btnRow) { if (_btnRow.previousElementSibling !== _exist) _btnRow.before(_exist); }
      else {
        /* 兜底：按钮行还没渲染时先跟在最后一条消息后，按钮行出现后下轮重挂会自动归位 */
        var _msgs = body.querySelectorAll('.msg');
        var _lastM = _msgs.length ? _msgs[_msgs.length - 1] : null;
        if (_lastM) { if (_lastM.nextElementSibling !== _exist) _lastM.after(_exist); }
        else if (body.lastElementChild !== _exist) body.appendChild(_exist);
      }
      return true; // 已挂载
    }
    var st = state(chat);

    var panel = document.createElement('div');
    panel.className = 'zf-crew-panel';
    panel.style.cssText = 'margin:0;padding:10px 12px;border:1px solid rgba(255,163,77,.35);border-radius:12px;background:rgba(255,163,77,.06);';
    panel.innerHTML =
      '<div class="zfp-head" style="display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;padding:2px 0;">' +
      '<span class="zfp-title" style="font-size:13px;font-weight:bold;">派出团队</span>' +
      '</div>' +
      '<div class="zfp-body" style="display:none;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
      '<div class="zfp-cards" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;flex:1;"></div>' +
      '</div>' +
      '<div class="zfp-roster" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:10px;"></div>' +
      '<div style="display:flex;gap:8px;align-items:stretch;">' +
      '<input class="zfp-note" type="text" placeholder="一句话叮嘱（选填，可不写）…" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-size:13px;box-sizing:border-box;min-width:0;">' +
      '<button class="zfp-go" style="padding:8px 22px;border-radius:8px;border:none;background:#4da3ff;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;"><svg class="zfp-go-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><line x1="12" y1="21" x2="12" y2="3"></line><polygon points="12 3 5 12 12 12 12 21 19 12 12 3"></polygon></svg> 派出</button>' +
      '</div></div>';

    var cardsEl = panel.querySelector('.zfp-cards');
    var rosterEl = panel.querySelector('.zfp-roster');
    var noteEl = panel.querySelector('.zfp-note');
    var goBtn = panel.querySelector('.zfp-go');

    noteEl.value = st.note || '';

    function total() {
      var t = 0; ROLES.forEach(function (r) { t += st.picks[r.key] || 0; }); return t;
    }

    function render() {
      /* 角色卡 */
      cardsEl.innerHTML = '';
      ROLES.forEach(function (r) {
        var n = st.picks[r.key] || 0;
        var card = document.createElement('div');
        card.className = 'zfp-card';
        var sel = n > 0;
        card.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:5px 2px;border-radius:10px;cursor:pointer;user-select:none;transition:background .15s,border-color .15s;box-sizing:border-box;width:100%;border:1px solid ' + (sel ? '#4da3ff' : 'rgba(255,255,255,.18)') + ';background:' + (sel ? 'rgba(77,163,255,.18)' : 'transparent') + ';';
        card.innerHTML = icon(r.key, 20) +
          '<span style="font-size:11px;opacity:.8;">' + r.name + '</span>' +
          (sel ? '<span style="position:absolute;top:-7px;right:-7px;background:#4da3ff;color:#fff;font-size:11px;min-width:18px;height:18px;line-height:18px;text-align:center;border-radius:9px;font-weight:bold;">' + n + '</span>' : '');
        card.onclick = function () {
          st.picks[r.key] = (st.picks[r.key] || 0) + 1;
          render();
        };
        /* 【右键减员】右键点击卡片 = -1（数量为 0 时不再减） */
        card.oncontextmenu = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          st.picks[r.key] = Math.max(0, (st.picks[r.key] || 0) - 1);
          render();
          return false;
        };
        cardsEl.appendChild(card);
      });
      /* 名单 */
      rosterEl.innerHTML = '';
      var any = false;
      ROLES.forEach(function (r) {
        var n = st.picks[r.key] || 0;
        for (var i = 0; i < n; i++) {
          any = true;
          (function (r, idx) {
            var chip = document.createElement('span');
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);font-size:11px;';
            chip.innerHTML = icon(r.key, 14) + ' ' + r.name + (n > 1 ? (idx + 1) : '') +
              ' <b data-del="1" style="cursor:pointer;color:#ff7a7a;padding:0 2px;">✕</b>';
            chip.querySelector('[data-del]').onclick = function (ev) {
              ev.stopPropagation();
              st.picks[r.key] = Math.max(0, (st.picks[r.key] || 0) - 1);
              render();
            };
            rosterEl.appendChild(chip);
          })(r, i);
        }
      });
      rosterEl.style.display = any ? 'flex' : 'none';
      /* 派出按钮态：只要选了人即可；一句话叮嘱选填（2026-10-27 改） */
      var ok = total() > 0;
      goBtn.style.opacity = ok ? '1' : '.4';
      goBtn.style.pointerEvents = ok ? 'auto' : 'none';
      goBtn.innerHTML = ok ? '<svg class="zfp-go-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><line x1="12" y1="21" x2="12" y2="3"></line><polygon points="12 3 5 12 12 12 12 21 19 12 12 3"></polygon></svg> 派出 ' + total() + ' 人' : '<svg class="zfp-go-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><line x1="12" y1="21" x2="12" y2="3"></line><polygon points="12 3 5 12 12 12 12 21 19 12 12 3"></polygon></svg> 派出';
    }

    /* ── 折叠交互：默认折叠，点标题栏展开/收起（2026-10-27 恢复） ── */
    var headEl = panel.querySelector('.zfp-head');
    var arrowEl = panel.querySelector('.zfp-arrow');
    var bodyEl0 = panel.querySelector('.zfp-body');

    function renderCollapse() {
      var c = st.collapsed !== false;
      bodyEl0.style.display = c ? 'none' : '';
      /* 【居中修复】折叠时收紧面板内边距，让标题文字垂直居中、下方不再多出一截空白 */
      panel.style.padding = c ? '0 12px;' : '10px 12px;';
      var arrowEl = panel.querySelector('.zfp-arrow');
      if (arrowEl) arrowEl.style.transform = '';
    }
    headEl.onclick = function () {
      st.collapsed = (st.collapsed === false);
      renderCollapse();
    };
    renderCollapse();

    noteEl.addEventListener('input', function () { st.note = noteEl.value; render(); });

    goBtn.onclick = function () {
      var note = noteEl.value.trim();
      var _crewTotal = total();
      if (_crewTotal <= 0) return;
      /* 【v10 防提前收口·账本登记】派出团队派发时向派发登记账本登记派出份数（重置式开新账），
         使 gatherFor 的账本闸门生效：①outstanding>0（窗口未全开出）不收口；②canGather（回收+核销
         < 派出数）不收口。此前仅专家团登记（expert-team.js L73），派出团队漏登 → 收口判据只查
         pair.memberIds，后开出/未开出的成员不在名单内即可被提前回收汇总（用户实锤场景）。 */
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.registerExpected) ZFDispatchLedger.registerExpected(chat.id, _crewTotal); } catch (eLed) {}
      try { if (App && typeof App._onSendComplete === 'function' && !chat.isSending) App._onSendComplete(box, chat); } catch (e) {}
      /* ♻ 全自动回收：写入时间戳标志，三种箭头各自读取（60s 内有效） */
      /* 【2026-11-01 彻底移除自动返回】凭证永不写入 */
      try { window._zfAutoGatherNext = 0; window._zfGatherExpireWarned = false; } catch (e) {}
      /* 逐角色错峰派出：每个角色执行前重写叮嘱标志（原机制首窗消费即置 null） */
      var seq = [];
      ROLES.forEach(function (r) {
        var n = st.picks[r.key] || 0;
        for (var i = 0; i < n; i++) seq.push(r);
      });
      /* 【v2 普通对话派发前置】同一批派出前写入：①独立叮嘱标志（防跨角色串扰）；
         ②批次 id（_plainExpand 内所有窗共享，登记到 Store.data.plainBatches） */
      var _plainCnt = st.picks['plain'] || 0;
      if (_plainCnt > 0) {
        if (note) window._zfPlainNoteNext = { note: note.slice(0, 500), ts: Date.now() };
        window._zfPlainBatchNext = 'pb_' + chat.id + '_' + Date.now();
      }
      seq.forEach(function (r, i) {
        setTimeout(function () {
          try {
            if (r.note && note) {
              window._zfCustomNoteNext = { note: note.slice(0, 500), ts: Date.now(), imgs: [], pastes: [] };
            }
            r.fn(box, chat, st.picks[r.key] || 1);
            try { if (App._bumpSpawnCount) App._bumpSpawnCount(r.name, 1, chat); } catch (e2) {}
          } catch (e) {
            try { console.warn('[crew-panel] 派出失败:', r.name, e); } catch (e2) {}
            try { App._stepToast('派出「' + r.name + '」失败：' + (e.message || e), false); } catch (e3) {}
          }
        }, i * 500);
      });
      try { App._stepToast('🐝 小队已派出：' + seq.map(function (r) { return r.name; }).join('、'), true); } catch (e) {}
      /* 派出后收起面板：已派出完成，收起来不占地方（2026-10-27 恢复折叠） */
      st.picks = {};
      st.collapsed = true;
      renderCollapse();
      render();
    };

    /* ── 【v2 P2 一键回收+并排展示】多路普通对话答案回收 ── */
    function _renderGather() {
      var _old = panel.parentNode && panel.parentNode.querySelector('.zfp-plain-gather');
      if (_old) _old.remove();
      var _batches = (window.Store && Store.data && Store.data.plainBatches) || {};
      var _mine = Object.keys(_batches).map(function (k) { return _batches[k]; })
        .filter(function (b) { return b.srcChatId === chat.id && b.members && b.members.length; })
        .sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
      if (!_mine.length) return;
      var _latest = _mine[0];
      var _done = 0;
      _latest.members.forEach(function (m) {
        try {
          var _c = Store.data.chatBoxes.find(function (c) { return c.id === m.chatId; });
          if (_c && _c.history && _c.history.some(function (h) { return h.role === 'assistant' && !h._meta && (h.content || '').trim(); })) _done++;
        } catch (e) {}
      });
      var _g = document.createElement('div');
      _g.className = 'zfp-plain-gather';
      _g.style.cssText = 'margin:6px 0 2px;padding:8px 10px;border:1px dashed rgba(120,200,255,.4);border-radius:10px;background:rgba(120,200,255,.06);';
      var _html = '<div style="font-size:11px;color:#8fc4ff;margin-bottom:6px;">💬 多路答案批次（' + _done + '/' + _latest.members.length + ' 已回答）' +
        '<button class="zfp-gather-btn" style="float:right;font-size:11px;padding:2px 10px;border-radius:8px;border:1px solid rgba(120,200,255,.5);background:rgba(120,200,255,.12);color:#8fc4ff;cursor:pointer;">一键回收并排展示</button></div>';
      _g.innerHTML = _html;
      _g.querySelector('.zfp-gather-btn').onclick = function () {
        try {
          var _items = _latest.members.map(function (m, i) {
            var _c = Store.data.chatBoxes.find(function (c) { return c.id === m.chatId; });
            var _ans = '';
            if (_c && _c.history) {
              for (var j = _c.history.length - 1; j >= 0; j--) {
                var _h = _c.history[j];
                if (_h && _h.role === 'assistant' && !_h._meta && (_h.content || '').trim()) { _ans = String(_h.content).trim(); break; }
              }
            }
            return { idx: i + 1, chatId: m.chatId, modelId: m.modelId || '（源模型）', ans: _ans };
          });
          if (!_items.some(function (it) { return it.ans; })) { App._stepToast('普通对话尚未产生回答，稍后再试', false); return; }
          var _out = ['【多路普通对话答案并排对比 · 共 ' + _items.length + ' 路 · 叮嘱：' + String(_latest.srcNote || '').slice(0, 60) + '】', ''];
          _items.forEach(function (it) {
            _out.push('—— 第 ' + it.idx + ' 路（' + it.modelId + (it.ans ? '' + (it.ans.length) + '字' : '，未回答') + '）——');
            _out.push(it.ans || '（未回答）');
            _out.push('');
          });
          _out.push('（以上为多路独立作答，请人工择优采纳；各路原对话窗口保留在画布上）');
          /* addMsg 签名 (box, text, who, modelId, isFinal, skipSave)：box 为 DOM 元素，skipSave=true 只展示不写入历史 */
          App.addMsg(chat.el, _out.join('\n'), 'user', chat.modelId, false, true);
          App._stepToast('💬 已回收 ' + _items.length + ' 路答案并排展示到本对话', true);
        } catch (eG) {
          try { App._stepToast('回收失败：' + (eG.message || eG), false); } catch (e2) {}
        }
      };
      panel.after(_g);
    }
    _renderGather();
    var _gatherTimer = setInterval(function () {
      try {
        if (!document.body.contains(panel)) { clearInterval(_gatherTimer); return; }
        _renderGather();
      } catch (e) { clearInterval(_gatherTimer); }
    }, 3000);

    /* 插到「自验收/本次提问」按钮行（.msg.compress-selector）之后——与审核/策划等按钮同区；
       按钮行尚未渲染时兜底跟在最后一条消息后，按钮行出现后常驻重挂逻辑会自动归位 */
    var _btnRow = body.querySelector('.msg.compress-selector');
    if (_btnRow) _btnRow.before(panel);
    else {
      var _msgs0 = body.querySelectorAll('.msg');
      var _lastM0 = _msgs0.length ? _msgs0[_msgs0.length - 1] : null;
      if (_lastM0) _lastM0.after(panel); else body.appendChild(panel);
    }
    renderCollapse();
    render();
    return true;
  }

  /* ── 常驻重注入：MutationObserver 监听聊天区重建，面板丢了就补 ── */
  function tryMountAll() {
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      boxes.forEach(function (chat) {
        if (!chat || !chat.el || chat._meta) return;
        if (chat._isThinkerChat || chat._isQcChat || chat._isObjectorChat || chat._isCustomChat || chat._raceChat || chat._isVerifierChat || chat._isPolisherChat || chat._isSecurityChat || chat._isPlainChat) return; // 子窗不挂
        if (chat._crewPanel && chat._crewPanel._closed) return; // 用户主动关闭过，不再重挂
        mount(chat.el, chat);
      });
    } catch (e) {}
  }

  function boot() {
    tryMountAll();
    var mo = new MutationObserver(function () { tryMountAll(); });
    function start() {
      var anchor = document.body;
      if (!anchor) { setTimeout(start, 300); return; }
      mo.observe(anchor, { childList: true, subtree: true });
      setInterval(tryMountAll, 2000); // 兜底轮询
    }
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
