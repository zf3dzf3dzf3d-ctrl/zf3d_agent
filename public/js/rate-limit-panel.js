/**
 * rate-limit-panel.js — 限流（429）全局可视化面板 + 一键切换
 * 依赖：rate-limit-tracker.js（window.RateLimit）、Models、Store
 * 功能：
 *   1. 顶栏悬浮徽标：最近 60 分钟有 429 时显示，无则隐藏（不打扰）
 *   2. 点击徽标展开面板：每个被限流模型一行（次数/最近时间/受影响对话数）
 *   3. 每个未被限流的候选模型提供"一键切换受影响对话"按钮 —— 由用户手动取舍，
 *      不做自动切换（系统设计约定：不允许模型间自动切换）
 *   4. 切换实现：改 chat.modelId + Store.saveChatBox，重试链每轮入口自动换道采纳
 */
(function (global) {
  'use strict';
  var panelEl = null, ballEl = null, listEl = null, statusEl = null;
  var lastSnapshot = null; // 增量渲染：上次 stats 数据快照
  var confirmState = null;   // 二次确认态 {from, to, timer} —— 确认期间挂起 render 重建
  var lastSwitch = null;     // 撤销记录 {modelId, chats:[{id, prevModelId}]}
  var cooldownTimers = {};   // 冷却倒计时 tick 句柄

  /** 冷却剩余秒数（tracker 提供 lastTs，60 分钟窗口） */
  function cooldownSecs(lastTs) {
    var remain = 60 * 60 * 1000 - (Date.now() - lastTs);
    return remain > 0 ? Math.ceil(remain / 1000) : 0;
  }
  function startCooldownTicker() {
    clearInterval(cooldownTimers._t);
    cooldownTimers._t = setInterval(function () {
      if (!panelEl || panelEl.style.display !== 'block') return;
      var els = listEl.querySelectorAll('[data-cd]');
      if (!els.length) return clearInterval(cooldownTimers._t);
      var stats = (global.RateLimit && global.RateLimit.stats()) || [];
      var byId = {}; stats.forEach(function (s) { byId[s.modelId] = s.lastTs; });
      els.forEach(function (el) {
        var sec = cooldownSecs(byId[el.getAttribute('data-cd')]);
        el.textContent = sec > 0 ? ('冷却 ' + Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2)) : '';
      });
    }, 1000);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function ensureStyles() {
    if (document.getElementById('rlp-style')) return;
    var st = document.createElement('style');
    st.id = 'rlp-style';
    st.textContent = [
      // 定位到右下角导航缩略图(minimap: bottom30+高150≈180)正上方，避开贴底的 .tp-fab-group 按钮栏，不再互相层叠
      '#rlp-ball{position:fixed;right:16px;bottom:200px;z-index:99990;display:none;align-items:center;gap:6px;',
      'padding:5px 11px;border-radius:14px;background:rgba(30,30,46,.88);color:#fca5a5;font-size:12px;cursor:pointer;',
      'box-shadow:0 2px 10px rgba(0,0,0,.35);border:1px solid rgba(248,113,113,.45);user-select:none;backdrop-filter:blur(4px)}',
      '#rlp-ball:hover{background:rgba(45,45,64,.95);border-color:rgba(248,113,113,.8);color:#fecaca}',
      '#rlp-panel{position:fixed;right:16px;bottom:242px;z-index:99991;width:340px;max-height:55vh;overflow:auto;',
      'background:var(--bg-card,#1e1e2e);border:1px solid var(--border,#444);border-radius:12px;',
      'box-shadow:0 8px 32px rgba(0,0,0,.4);padding:14px;display:none;font-size:13px;color:var(--text,#eee)}',
      '#rlp-panel h4{margin:0 0 8px;font-size:14px;display:flex;justify-content:space-between;align-items:center}',
      '#rlp-panel .rlp-row{border-bottom:1px solid var(--border,#333);padding:8px 0}',
      '#rlp-panel .rlp-model{font-weight:600}',
      '#rlp-panel .rlp-meta{color:var(--text2,#999);font-size:12px;margin:2px 0}',
      '#rlp-panel .rlp-cand{display:inline-block;margin:3px 6px 3px 0;padding:3px 10px;border-radius:12px;',
      'border:1px solid var(--border,#555);background:var(--bg,#16161e);cursor:pointer;font-size:12px;color:var(--text,#eee)}',
      '#rlp-panel .rlp-cand:hover{border-color:#4ade80;color:#4ade80}',
      '#rlp-panel .rlp-clear{font-size:12px;color:var(--text2,#999);cursor:pointer;text-decoration:underline}',
      '#rlp-panel .rlp-ok{color:#4ade80;font-size:12px;margin-top:4px}',
      '#rlp-panel .rlp-cand.rlp-dim{opacity:.38;cursor:not-allowed;border-style:dashed}',
      '#rlp-panel .rlp-cand.rlp-confirm{border-color:#fbbf24;color:#fbbf24;background:rgba(251,191,36,.08)}',
      '#rlp-panel .rlp-undo{color:#60a5fa;font-size:12px;cursor:pointer;text-decoration:underline;margin-left:8px}',
      '#rlp-panel .rlp-hot .rlp-model{color:#f87171}',
      '#rlp-panel .rlp-cd{color:#fbbf24;font-size:11px;margin-left:6px}',
      '#rlp-panel .rlp-cand.rlp-switching{pointer-events:none;opacity:.5}',
      '.rlp-undo{color:#60a5fa;cursor:pointer;text-decoration:underline}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /** 受影响对话 = chat.modelId === 被限流模型 id */
  function affectedChats(modelId) {
    try {
      return (global.Store.getChatBoxes() || []).filter(function (c) { return c && c.modelId === modelId; });
    } catch (e) { return []; }
  }

  /** 候选模型：有 endpoint、当前未被限流、不是它自己 */
  function candidates(excludeId) {
    try {
      return (global.Models.list || []).filter(function (m) {
        return m && m.id && m.id !== excludeId && m.endpoint && !(global.RateLimit && global.RateLimit.isLimited(m.id));
      });
    } catch (e) { return []; }
  }

  /** 一键切换：把受影响对话的模型改到目标模型（用户点击触发，非自动） */
  function switchTo(fromModelId, toModelId) {
    var to = null;
    try { to = global.Models.getById(toModelId); } catch (e) {}
    if (!to) return;
    var chats = affectedChats(fromModelId);
    var n = 0;
    var undoRec = { toId: to.id, chats: [] };
    chats.forEach(function (c) {
      try {
        undoRec.chats.push({ id: c.id, prevModelId: c.modelId });
        c.modelId = to.id;
        if (global.Store && global.Store.saveChatBox) global.Store.saveChatBox(c);
        if (global.Store && global.Store.addLog) {
          global.Store.addLog('info', c.id, 'ratelimit-switch',
            '限流后手动切换模型: ' + fromModelId + ' → ' + (to.name || to.modelId || to.id));
        }
        n++;
      } catch (e) {}
    });
    if (n > 0) lastSwitch = undoRec; // 只有实际切换成功才可撤销
    return n;
  }

  /** 底部固定状态条：不参与 innerHTML 重建，反馈不被 render 冲掉；支持有限 HTML（撤销链接） */
  function showStatus(msg) {
    if (!statusEl) return;
    statusEl.innerHTML = msg; // msg 均为内部拼接（含 esc 转义的用户数据），非用户原始输入
    statusEl.style.display = 'block';
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { statusEl.style.display = 'none'; }, 8000);
  }

  function render(force) {
    if (!ballEl || !listEl) return;
    var stats = (global.RateLimit && global.RateLimit.stats()) || [];
    if (!stats.length) {
      ballEl.style.display = 'none';
      if (panelEl) panelEl.style.display = 'none';
      lastSnapshot = null;
      return;
    }
    var total = 0;
    stats.forEach(function (s) { total += s.count; });
    ballEl.style.display = 'flex';
    ballEl.innerHTML = '⛔ 限流 ' + total + ' 次/60min';

    // 增量渲染：数据快照未变时只强刷时间文本，不全量重建（避免点击竞态导致按钮失灵）
    var snapshot = JSON.stringify(stats.map(function (s) {
      return { id: s.modelId, n: s.count, chats: affectedChats(s.modelId).length, cands: candidates(s.modelId).slice(0, 6).map(function (m) { return m.id; }) };
    }));
    if (!force && snapshot === lastSnapshot && !confirmState) {
      // 仅刷新时间显示
      var tsEls = listEl.querySelectorAll('[data-lastts]');
      stats.forEach(function (s, i) {
        if (tsEls[i]) tsEls[i].textContent = '最近 ' + fmtTime(s.lastTs);
      });
      return;
    }
    lastSnapshot = snapshot;

    var html = '<h4>⛔ 近 60 分钟限流统计 <span class="rlp-clear" id="rlp-clear-btn">清空</span></h4>';
    // 阶段3：按 429 次数降序，重灾区(≥5次)整行红色高亮
    var sorted = stats.slice().sort(function (a, b) { return b.count - a.count; });
    sorted.forEach(function (s) {
      var chats = affectedChats(s.modelId);
      var all = candidates(s.modelId);
      // 阶段2：零受影响对话的候选置灰（没东西可切，但保留可点击防误判）
      var cands = all.slice(0, 6);
      var sec = cooldownSecs(s.lastTs);
      html += '<div class="rlp-row' + (s.count >= 5 ? ' rlp-hot' : '') + '">'
        + '<div class="rlp-model">' + esc(s.modelName || s.modelId) + (s.count >= 5 ? ' 🔥' : '') + '</div>'
        + '<div class="rlp-meta">429 × ' + s.count + ' 次 · <span data-lastts>最近 ' + fmtTime(s.lastTs)
        + '</span> · 影响对话 ' + chats.length + ' 个'
        + (sec > 0 ? ' · <span class="rlp-cd" data-cd="' + esc(s.modelId) + '">冷却 ' + Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2) + '</span>' : '')
        + '</div>';
      if (cands.length) {
        html += '<div class="rlp-meta">一键切换' + (chats.length ? '（' + chats.length + ' 个对话）' : '') + '到：</div>';
        cands.forEach(function (m) {
          var dim = chats.length === 0;
          html += '<span class="rlp-cand' + (dim ? ' rlp-dim' : '') + '" data-from="' + esc(s.modelId) + '" data-to="' + esc(m.id) + '"'
            + (dim ? ' title="当前没有使用该模型的对话"' : '')
            + '>' + esc(m.name || m.modelId || m.id) + '</span>';
        });
      } else {
        html += '<div class="rlp-meta">⚠ 暂无未被限流的候选模型</div>';
      }
      html += '</div>';
    });
    html += '<div class="rlp-meta" style="margin-top:8px">切换前需二次确认（5秒内再点一次生效）；切换后可点状态条内「撤销」一键还原。</div>';
    listEl.innerHTML = html;
    // 状态条固定在面板底部（一次性创建，不参与重建）
    if (!statusEl || !statusEl.parentNode) {
      statusEl = document.createElement('div');
      statusEl.className = 'rlp-ok';
      statusEl.style.display = 'none';
      panelEl.appendChild(statusEl);
    }
  }

  /** 事件委托：面板容器只绑一次 click，点击落在任何节点上都有效（根治重建竞态失灵） */
  function bindDelegation() {
    panelEl.addEventListener('click', function (e) {
      var cand = e.target.closest ? e.target.closest('.rlp-cand') : null;
      if (cand && panelEl.contains(cand) && !cand.classList.contains('rlp-dim')) {
        handleCandidateClick(cand);
        return;
      }
      var undo = e.target.closest ? e.target.closest('.rlp-undo') : null;
      if (undo && panelEl.contains(undo)) { undoSwitch(); return; }
      var clear = e.target.closest ? e.target.closest('#rlp-clear-btn') : null;
      if (clear) { cancelConfirm(); global.RateLimit.clear(); }
    });
  }

  /** 二次确认：第一次点进入确认态（5秒超时自动取消），确认期间同按钮再点才真正切换 */
  function handleCandidateClick(cand) {
    var from = cand.getAttribute('data-from'), to = cand.getAttribute('data-to');
    if (confirmState && confirmState.from === from && confirmState.to === to) {
      // 确认生效
      clearTimeout(confirmState.timer);
      confirmState = null;
      var fromName = from, toName = to;
      try { var tm = global.Models.getById(to); toName = tm && (tm.name || tm.id) || to; } catch (e) {}
      cand.classList.add('rlp-switching');
      var n = switchTo(from, to);
      if (n > 0 && lastSwitch) {
        showStatus('✓ 已切换 ' + n + ' 个对话到「' + esc(toName) + '」 · <span class="rlp-undo" id="rlp-undo-btn">撤销</span>');
      } else {
        showStatus(n > 0 ? ('✓ 已切换 ' + n + ' 个对话') : '✓ 未找到使用该模型的对话');
      }
      render(true);
      startCooldownTicker();
      return;
    }
    // 新的确认请求：清除旧确认态，标记该按钮
    cancelConfirm();
    confirmState = { from: from, to: to, timer: setTimeout(cancelConfirm, 5000) };
    panelEl.querySelectorAll('.rlp-cand.rlp-confirm').forEach(function (el) { el.classList.remove('rlp-confirm'); });
    cand.classList.add('rlp-confirm');
    var origText = cand.textContent;
    if (!cand.getAttribute('data-orig')) cand.setAttribute('data-orig', origText);
    cand.textContent = cand.getAttribute('data-orig') + ' ✓再点确认';
    showStatus('⚠ 再点一次「' + esc(cand.getAttribute('data-orig')) + '」确认切换（5秒内），点其他处取消');
  }

  function cancelConfirm() {
    if (!confirmState) return;
    clearTimeout(confirmState.timer);
    confirmState = null;
    if (listEl) listEl.querySelectorAll('.rlp-cand.rlp-confirm').forEach(function (el) {
      el.classList.remove('rlp-confirm');
      if (el.getAttribute('data-orig')) el.textContent = el.getAttribute('data-orig');
    });
  }

  /** 一键撤销：还原上次切换的所有对话到原模型 */
  function undoSwitch() {
    if (!lastSwitch) return;
    var n = 0;
    try {
      var byId = {};
      (global.Store.getChatBoxes() || []).forEach(function (c) { if (c) byId[c.id] = c; });
      lastSwitch.chats.forEach(function (rec) {
        var c = byId[rec.id];
        if (c && c.modelId === lastSwitch.toId) {
          c.modelId = rec.prevModelId;
          if (global.Store.saveChatBox) global.Store.saveChatBox(c);
          n++;
        }
      });
    } catch (e) {}
    var fromName = lastSwitch.toId;
    showStatus(n > 0 ? ('↩ 已撤销 ' + n + ' 个对话，还原到原模型') : '↩ 没有可撤销的对话（可能已被再次修改）');
    lastSwitch = null;
    render(true);
  }

  function init() {
    if (!global.RateLimit) return; // tracker 未加载
    ensureStyles();

    ballEl = document.createElement('div');
    ballEl.id = 'rlp-ball';
    ballEl.title = '模型限流统计（近60分钟）';
    document.body.appendChild(ballEl);

    panelEl = document.createElement('div');
    panelEl.id = 'rlp-panel';
    listEl = document.createElement('div');
    panelEl.appendChild(listEl);
    document.body.appendChild(panelEl);

    ballEl.addEventListener('click', function () {
      panelEl.style.display = (panelEl.style.display === 'block') ? 'none' : 'block';
      render();
    });
    document.addEventListener('click', function (e) {
      if (panelEl.style.display === 'block' && !panelEl.contains(e.target) && e.target !== ballEl && !ballEl.contains(e.target)) {
        panelEl.style.display = 'none';
        cancelConfirm();
      }
    });

    bindDelegation();
    global.addEventListener('ratelimit:changed', function () { render(); });
    render(true);
    // 定时刷新：数据未变时只刷时间文本（增量渲染内部处理）
    setInterval(function () { render(); }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.RateLimitPanel = { render: render, switchTo: switchTo };
})(window);
