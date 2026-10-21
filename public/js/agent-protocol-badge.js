/* eslint-disable */
/**
 * agent-protocol-badge.js — 协议状态徽章（v5.1.3）
 * 在聊天窗口右下角显示一个小小的协议徽标，点击展开最近几轮实际协议记录。
 * 数据源：GET /api/agent/protocol/last（dual_protocol._record_protocol 写入）
 * 特性：不醒目（低饱和、半透明、小字号）；无记录时自动隐藏；轮询节流。
 */
(function () {
  'use strict';

  var POLL_MS = 15000;        // 空闲轮询间隔
  var POLL_MS_BUSY = 4000;    // 检测到新记录后的短轮询
  var _timer = null;
  var _lastTs = 0;            // 最近一条记录时间戳，用于增量判断

  function $(id) { return document.getElementById(id); }

  function fmtTime(ts) {
    try {
      var d = new Date(ts * 1000);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } catch (e) { return ''; }
  }

  // 协议 → 徽标文案（极简，小写）
  function badgeText(protocol) {
    if (protocol === 'responses') return 'responses';
    if (protocol === 'anthropic') return 'anthropic';
    if (protocol === 'chat') return 'chat';
    return protocol || '—';
  }

  function buildPanel(items) {
    var html = '<div class="apb-panel-title">最近协议（新→旧）</div>';
    if (!items || !items.length) {
      html += '<div class="apb-empty">暂无记录，发一条消息后出现</div>';
    } else {
      for (var i = 0; i < items.length && i < 8; i++) {
        var it = items[i];
        var mode = it.mode ? ' · ' + it.mode : '';
        var note = it.note ? ' · ' + it.note : '';
        html += '<div class="apb-row"><span class="apb-row-p">' + badgeText(it.protocol) +
          '</span><span class="apb-row-t">' + fmtTime(it.ts) + mode + note + '</span></div>';
      }
      if (items.length > 8) html += '<div class="apb-empty">…共 ' + items.length + ' 条</div>';
    }
    return html;
  }

  function fetchAndUpdate() {
    fetch('/api/agent/protocol/last?_=' + Date.now(), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok) return;
        var items = j.items || [];
        var badge = $('apbBadge');
        var panel = $('apbPanel');
        if (!badge) return;
        if (!items.length) { badge.style.display = 'none'; if (panel) panel.style.display = 'none'; schedule(false); return; }
        badge.style.display = '';
        var latest = items[0] || {};
        if (latest.ts && latest.ts !== _lastTs) {
          _lastTs = latest.ts;
          // 新记录：徽标轻微提亮一次
          badge.classList.remove('apb-flash'); void badge.offsetWidth; badge.classList.add('apb-flash');
          // 若面板开着，同步刷新内容
          if (panel && panel.style.display !== 'none') panel.innerHTML = buildPanel(items);
          schedule(true);
          return;
        }
        if (panel && panel.style.display !== 'none') panel.innerHTML = buildPanel(items);
        schedule(false);
      })
      .catch(function () { schedule(false); });
  }

  function schedule(brief) {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(fetchAndUpdate, brief ? POLL_MS_BUSY : POLL_MS);
  }

  function togglePanel(force) {
    var badge = $('apbBadge'), panel = $('apbPanel');
    if (!badge || !panel) return;
    var show = (force !== undefined) ? force : (panel.style.display === 'none');
    if (show) {
      panel.innerHTML = buildPanel([]); // 先占位
      panel.style.display = 'block';
      fetchAndUpdate();
    } else {
      panel.style.display = 'none';
    }
  }

  function mount() {
    if ($('apbBadge')) return; // 已挂载
    var host = document.body;
    if (!host) { setTimeout(mount, 600); return; }

    var badge = document.createElement('div');
    badge.id = 'apbBadge';
    badge.className = 'apb-badge';
    badge.title = 'Agent 接口协议（点击看最近记录）';
    badge.textContent = '·';
    badge.style.display = 'none';

    var panel = document.createElement('div');
    panel.id = 'apbPanel';
    panel.className = 'apb-panel';
    panel.style.display = 'none';

    badge.addEventListener('click', function (e) { e.stopPropagation(); togglePanel(); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { togglePanel(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') togglePanel(false); });

    host.appendChild(panel);
    host.appendChild(badge);
    fetchAndUpdate();
  }

  // ===== 样式（低饱和、半透明，刻意不醒目） =====
  function injectCss() {
    if ($('apbStyle')) return;
    var st = document.createElement('style');
    st.id = 'apbStyle';
    st.textContent = [
      '.apb-badge{position:fixed;right:12px;bottom:42px;z-index:9700;',
      'font:10px/1 -apple-system,"Segoe UI",Arial,sans-serif;color:rgba(128,128,128,.75);',
      'background:rgba(128,128,128,.06);border:1px solid rgba(128,128,128,.18);',
      'border-radius:9px;padding:2px 7px;cursor:pointer;user-select:none;',
      'opacity:.55;transition:opacity .2s,background .2s;pointer-events:auto;}',
      '.apb-badge:hover{opacity:.9;background:rgba(128,128,128,.12);}',
      '.apb-badge.apb-flash{background:rgba(88,150,255,.14);color:rgba(88,150,255,.85);}',
      '.apb-panel{position:fixed;right:12px;bottom:66px;z-index:9701;min-width:210px;max-width:280px;',
      'background:var(--panel-bg,rgba(24,26,32,.96));color:var(--fg,#ddd);',
      'border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:8px 10px;',
      'box-shadow:0 6px 22px rgba(0,0,0,.28);font:11px/1.6 -apple-system,"Segoe UI",Arial,sans-serif;}',
      '.apb-panel-title{font-weight:600;opacity:.85;margin-bottom:4px;font-size:11px;}',
      '.apb-row{display:flex;gap:8px;align-items:baseline;white-space:nowrap;}',
      '.apb-row-p{font-family:Consolas,monospace;color:rgba(88,150,255,.85);min-width:64px;}',
      '.apb-row-t{opacity:.65;overflow:hidden;text-overflow:ellipsis;}',
      '.apb-empty{opacity:.5;font-size:10px;}'
    ].join('');
    document.head.appendChild(st);
  }

  function init() { injectCss(); mount(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
