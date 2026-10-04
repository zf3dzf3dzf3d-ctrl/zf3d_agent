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
  var panelEl = null, ballEl = null, listEl = null;

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
      '#rlp-ball{position:fixed;right:18px;bottom:18px;z-index:99990;display:none;align-items:center;gap:6px;',
      'padding:8px 14px;border-radius:20px;background:#b91c1c;color:#fff;font-size:13px;cursor:pointer;',
      'box-shadow:0 4px 16px rgba(185,28,28,.45);border:1px solid #f87171;user-select:none}',
      '#rlp-ball:hover{background:#dc2626}',
      '#rlp-panel{position:fixed;right:18px;bottom:60px;z-index:99991;width:340px;max-height:60vh;overflow:auto;',
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
      '#rlp-panel .rlp-ok{color:#4ade80;font-size:12px;margin-top:4px}'
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
    chats.forEach(function (c) {
      try {
        c.modelId = to.id;
        if (global.Store && global.Store.saveChatBox) global.Store.saveChatBox(c);
        if (global.Store && global.Store.addLog) {
          global.Store.addLog('info', c.id, 'ratelimit-switch',
            '限流后手动切换模型: ' + fromModelId + ' → ' + (to.name || to.modelId || to.id));
        }
        n++;
      } catch (e) {}
    });
    return n;
  }

  function render() {
    if (!ballEl || !listEl) return;
    var stats = (global.RateLimit && global.RateLimit.stats()) || [];
    if (!stats.length) {
      ballEl.style.display = 'none';
      if (panelEl) panelEl.style.display = 'none';
      return;
    }
    var total = 0;
    stats.forEach(function (s) { total += s.count; });
    ballEl.style.display = 'flex';
    ballEl.innerHTML = '⛔ 限流 ' + total + ' 次/60min';

    var html = '<h4>⛔ 近 60 分钟限流统计 <span class="rlp-clear" id="rlp-clear-btn">清空</span></h4>';
    stats.forEach(function (s) {
      var chats = affectedChats(s.modelId);
      var cands = candidates(s.modelId).slice(0, 6);
      html += '<div class="rlp-row">'
        + '<div class="rlp-model">' + esc(s.modelName || s.modelId) + '</div>'
        + '<div class="rlp-meta">429 × ' + s.count + ' 次 · 最近 ' + fmtTime(s.lastTs)
        + ' · 影响对话 ' + chats.length + ' 个</div>';
      if (cands.length) {
        html += '<div class="rlp-meta">一键切换' + (chats.length ? '（' + chats.length + ' 个对话）' : '') + '到：</div>';
        cands.forEach(function (m) {
          html += '<span class="rlp-cand" data-from="' + esc(s.modelId) + '" data-to="' + esc(m.id) + '">'
            + esc(m.name || m.modelId || m.id) + '</span>';
        });
      } else {
        html += '<div class="rlp-meta">⚠ 暂无未被限流的候选模型</div>';
      }
      html += '</div>';
    });
    html += '<div class="rlp-meta" style="margin-top:8px">切换仅由你手动点击触发；正在重试的对话会自动换道到新模型。</div>';
    listEl.innerHTML = html;

    // 绑定事件
    listEl.querySelectorAll('.rlp-cand').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = switchTo(btn.getAttribute('data-from'), btn.getAttribute('data-to'));
        var tip = document.createElement('div');
        tip.className = 'rlp-ok';
        tip.textContent = n > 0 ? ('✓ 已切换 ' + n + ' 个对话，重试链下一轮自动换道') : '✓ 未找到使用该模型的对话';
        btn.parentElement.appendChild(tip);
        setTimeout(function () { tip.remove(); }, 4000);
      });
    });
    var clearBtn = document.getElementById('rlp-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', function () { global.RateLimit.clear(); });
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
      }
    });

    global.addEventListener('ratelimit:changed', render);
    render();
    // 定时刷新"最近时间"显示
    setInterval(render, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.RateLimitPanel = { render: render, switchTo: switchTo };
})(window);
