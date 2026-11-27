/* ============================================================
 * zf-app-trustee.js - i托管（P2：Dock 图标 + 唯一开关 + 简报面板）
 * 依策划案 private/记忆/策划案-i托管-20261115.md v1.7 + P2 收口裁决：
 *  - 唯一开关哲学：开=AI 全自动；关=人类接手（关→开是熔断唯一解除路径）
 *  - 简报真源：GET /api/trustee/status（服务端内存态，trustee.json 为落盘镜像）
 *  - P2 收口铁律：工程进度≥95 且 审核>90 才可收口；否则 LLM 双分数分带
 *    （<60 重做 / 60-94 优化/验证）→ 宏命令库自动派小镇团队成员，失败转人工
 * 后端：server/routes/mixin_trustee.py + server/trustee_llm_review.py
 * ============================================================ */
(function () {
  'use strict';

  var API_STATUS = '/api/trustee/status';
  var API_CONFIG = '/api/trustee/config';

  var ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/></svg>';

  /* ---------- 面板 DOM ---------- */
  var panelEl = null;
  /* 打开期间 30s 轻量轮询（面板关了就只查可见性不 fetch，前台保持轻） */
  var pollTimer = null;

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'zfTrusteePanel';
    /* 用户要求：默认左侧中间（不挡右侧弹窗），且可拖拽（localStorage 持久化位置） */
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('zfTrusteePos') || 'null'); } catch (e) { saved = null; }
    var left = (saved && typeof saved.left === 'number') ? saved.left : 16;
    var top = (saved && typeof saved.top === 'number')
      ? saved.top : Math.max(12, Math.round(window.innerHeight * 0.5 - 180));
    var _tl = false;
    try { _tl = (document.documentElement.getAttribute('data-theme') === 'light'); } catch (e) {}
    panelEl.style.cssText = 'position:fixed;left:' + left + 'px;top:' + top + 'px;width:300px;max-height:60vh;' +
      (_tl
        ? 'overflow:auto;background:rgba(248,250,253,.98);color:#1f2430;border:1px solid #d8dfe9;'
        : 'overflow:auto;background:rgba(20,22,30,.96);color:#d8dce6;border:1px solid rgba(120,140,255,.35);') +
      'border-radius:4px;padding:12px 14px;font-size:13px;line-height:1.6;z-index:99999;' +
      'box-shadow:none;outline:none;display:none;font-family:inherit;';
    document.body.appendChild(panelEl);
    enableDrag(panelEl);
    return panelEl;
  }

  /* 拖拽：按住面板标题区（前 40px 高度内）移动；越界钳制；位置落 localStorage */
  function enableDrag(p) {
    p.addEventListener('mousedown', function (e) {
      if (p.style.display !== 'block') return;
      var rect = p.getBoundingClientRect();
      /* 只有标题条（面板顶部 40px）可拖，正文可正常选中复制 */
      if (e.clientY - rect.top > 40) return;
      if (e.target.tagName === 'BUTTON') return; /* 不干扰关闭/开关按钮 */
      var dx = e.clientX - rect.left, dy = e.clientY - rect.top;
      function onMove(ev) {
        var L = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx));
        var T = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
        p.style.left = L + 'px';
        p.style.top = T + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try {
          localStorage.setItem('zfTrusteePos', JSON.stringify(
            { left: parseInt(p.style.left, 10), top: parseInt(p.style.top, 10) }));
        } catch (err) { /* 隐私模式等存不了就算了 */ }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtTime(ts) {
    if (!ts) return '-';
    var d = new Date(ts * 1000);
    function p(n) { return n < 10 ? '0' + n : n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function stateBadge(s) {
    var c = { running: '#6cf', streaming: '#6cf', tool_running: '#fa0', waiting_user: '#f80',
      queued: '#99f', waiting: '#99f', done: '#5c5', failed: '#f55', cancelled: '#888', stale: '#a6a' }[s] || '#888';
    var zh = { waiting: '排队中', queued: '排队中', running: '进行中', streaming: '输出中',
      tool_running: '工具执行中', waiting_user: '等待用户', done: '已完成', failed: '失败',
      cancelled: '已取消', stale: '已停·转人工' }[s] || (s || '?');
    return '<span style="color:' + c + ';font-weight:bold">' + esc(zh) + '</span>';
  }

  /* 双分数徽章（对照铁律门槛着色：进度≥95 达标；审核>90 达标——与后端铁律完全一致） */
  function scoreBadge(label, v, pass, gt) {
    if (v == null) return '<span style="color:#667" title="本轮审批未给出该分数">' + label + '?</span>';
    var ok = gt ? (v > pass) : (v >= pass);
    var c = ok ? '#5c5' : (v >= 60 ? '#f80' : '#f55');
    return '<span style="color:' + c + ';font-weight:bold" title="' + label +
      ' ' + v + '分（门槛：' + (gt ? '>' : '≥') + pass + '）">' + label + v + '</span>';
  }

  /* 简报折叠状态（面板关闭即重置为折叠，符合"打开先看摘要"习惯） */
  var briefOpen = false;
  /* 迷你条（最小化为一排）状态：localStorage 持久化，长期挂机友好 */
  function isMini() { try { return localStorage.getItem('zfTrusteeMini') === '1'; } catch (e) { return false; } }
  function setMini(v) { try { localStorage.setItem('zfTrusteeMini', v ? '1' : '0'); } catch (e) {} }

  function render(st) {
    var p = ensurePanel();
    var enabled = !!st.enabled, fused = !!st.fused;
    var pp = st.progress_pass || 95, rp = st.review_pass || 90;
    var switchTxt = enabled ? '关闭（人类接手）' : '开启（AI 全自动）';
    var swColor = enabled ? '#e55' : '#5b5';
    var html = '';
    /* ---- 迷你条模式：整面板只剩一条极窄状态行（用户要求：最小化更小、宽度不太宽）。
     * 图标语义（用户反馈"最小化/还原按钮反了"修复）：完整面板显示「—」=点了变小；
     * 迷你条显示「❐」=点了还原。「✕」=关面板（后台托管不受影响）。 ---- */
    if (isMini()) {
      var mStat = enabled
        ? '<span style="color:#5c5;font-weight:bold">● 托管中</span>'
        : '<span style="color:#889">○ 未托管</span>';
      if (fused) mStat = '<span style="color:#f55;font-weight:bold">■ 已熔断</span>';
      var mBits = [];
      if (st.pool_enabled === false) mBits.push('<span style="color:#f80">池关</span>');
      var mErr = (st.brief || []).filter(function (b) { return b.level === 'error' || b.level === 'warn'; }).length;
      if (mErr) mBits.push('<span style="color:#f80;font-weight:bold">报' + mErr + '</span>');
      if (st.team_today) mBits.push('派团<span style="color:#8cf;font-weight:bold">' + st.team_today + '</span>');
      mBits.push('巡查' + (st.poll_count || 0));
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap;cursor:move" id="zfTrusteeMiniBar" title="' +
        mStat.replace(/<[^>]+>/g, '') + '｜巡查' + (st.poll_count || 0) + '次｜最近' + fmtTime(st.last_poll_at) + '。点击「❐」还原面板">' +
        '<span id="zfTrusteeMiniState">' + mStat + '</span>' +
        '<span style="color:#667">' + mBits.join('·') + '</span>' +
        '<span style="flex:1"></span>' +
        '<button id="zfTrusteeMini" title="还原完整面板" style="border:none;background:transparent;color:#889;cursor:pointer;padding:2px;display:flex">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 4H5a1 1 0 0 0-1 1v11"/></svg></button>' +
        '<button id="zfTrusteeClose" title="关闭面板" style="border:none;background:transparent;color:#889;cursor:pointer;padding:2px;display:flex">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
    } else {
    /* 标题条：title(拖) + [最小化] [关闭]。 */
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<b style="color:#aabfff;display:flex;align-items:center;gap:6px">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>' +
      'i托管</b>' +
      '<span style="color:#556;font-size:10px;cursor:move" title="按住此处拖动面板">⠿ 拖动</span>' +
      '<span style="display:flex;align-items:center;gap:4px">' +
      '<button id="zfTrusteeMini" title="最小化为一排（长期挂机）" style="border:none;background:transparent;color:#889;cursor:pointer;padding:2px;display:flex">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg>' +
      '</button>' +
      '<button id="zfTrusteeClose" title="关闭面板" style="border:none;background:transparent;color:#889;cursor:pointer;padding:2px;display:flex">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span></div>';
    /* 唯一开关 */
    html += '<button id="zfTrusteeSwitch" style="width:100%;border:1px solid ' + swColor +
      ';background:transparent;color:' + swColor + ';border-radius:8px;padding:8px;cursor:pointer;' +
      'font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;gap:8px">' +
      (enabled
        ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 5v14M16 5v14"/></svg>'
        : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M7 4l13 8-13 8z"/></svg>') +
      switchTxt + '</button>';
    if (fused) {
      html += '<div style="margin-top:8px;padding:8px;color:#f55;border:1px solid rgba(255,120,120,.6);border-radius:2px">■ 已熔断转人工。关闭→重新开启开关即解除（唯一解除路径）</div>';
    }
    /* 铁律门槛行（P2 收口裁决） */
    html += '<div style="margin-top:8px;color:#99a;font-size:12px">收口门槛：进度 <b style="color:#aabfff">≥' + (pp) + '</b> 且 审核 <b style="color:#aabfff">&gt;' + (rp) + '</b>｜低于60 自动重做｜宏命令 ' +
      (st.macros || []).filter(function (m) { return m.enabled; }).length + '/' + (st.macros || []).length + ' 启用</div>';
    /* 状态行 */
    html += '<div style="margin-top:4px;color:#99a;font-size:12px">巡查 ' + (st.poll_count || 0) + ' 次｜最近 ' +
      fmtTime(st.last_poll_at) + '｜池开关 ' + (st.pool_enabled === true ? '开' : st.pool_enabled === false ? '<span style="color:#f80">关（降级只读）</span>' : '?') +
      '｜已见任务 ' + (st.seen_count || 0) +
      '｜重派 ' + ((st.redispatch_count || 0)) + ' 次｜派团 <b style="color:#8cf">' + (st.team_today || 0) +
      (st.team_daily_cap != null ? '/' + st.team_daily_cap : '') + '</b>' +
      (st.team_enabled === false ? '<span style="color:#f80">（派团已关）</span>' : '') + '</div>';
    if (st.pool_enabled === false) {
      html += '<div style="color:#f80;margin-top:4px">⚠ 对话池已关闭，托管降级只读对账模式（无告警失明防护已生效）</div>';
    }
    /* 在途任务（含最近一次审批双分数） */
    var recent = st.seen_recent || [];
    if (recent.length) {
      html += '<div style="margin-top:10px;color:#aabfff;font-weight:bold">在途 / 最近任务</div>';
      recent.forEach(function (t) {
        var sc = '';
        if (t.progress != null || t.review != null) {
          sc = '<span style="flex-shrink:0;font-size:11px">' +
            scoreBadge('进度', t.progress, pp, false) + ' ' + scoreBadge('审核', t.review, rp, true) + '</span>';
        }
        html += '<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px dotted #334;padding:3px 0">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help" title="标题原文：' + esc(t.title || t.turn_id) + '\n任务ID：' + esc(t.turn_id) + '">' +
          esc(t.title || t.turn_id) + '</span>' +
          '<span style="flex-shrink:0">' + sc + stateBadge(t.state) + '</span></div>';
      });
    }
    /* 派出团队（P2.2 宏命令自动派小镇成员工单台账，最近 5 条） */
    var jobs = st.team_jobs_recent || [];
    if (jobs.length) {
      html += '<div style="margin-top:10px;color:#aabfff;font-weight:bold">已派团队成员</div>';
      jobs.slice(0, 5).forEach(function (j) {
        var dzh = { adopt: '收口', dispatch_verify: '验证', dispatch_optimize: '优化', redo: '重做', escalate_human: '转人工' }[j.decision] || j.decision;
        html += '<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px dotted #334;padding:3px 0;font-size:12px;cursor:help" title="工单 ' + esc(j.job_id) + '\n任务：' + esc(j.title) + '\n理由：' + esc(j.reason || '') + '">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="color:#8cf">' + esc(j.role) + '</b>·' + esc(dzh) + ' ' + esc(j.title) + '</span>' +
          '<span style="flex-shrink:0;color:#667">' + fmtTime(j.ts) + '</span></div>';
      });
    }
    /* 简报（默认折叠，点击标题展开/收起；一键复制按钮方便贴给 AI） */
    var brief = st.brief || [];
    if (brief.length) {
      var briefLines = brief.slice(0, 20).map(function (b) {
        var lc = { warn: '#f80', error: '#f55' }[b.level] || '#aab';
        return '<div style="color:' + lc + '">' + fmtTime(b.ts) + ' ' + esc(b.line) + '</div>';
      }).join('');
      html += '<div style="margin-top:10px;display:flex;align-items:center;gap:10px">' +
        '<span id="zfTrusteeBriefToggle" style="color:#aabfff;font-weight:bold;cursor:pointer;user-select:none">' +
        (briefOpen ? '▾' : '▸') + ' 简报（' + brief.length + ' 条）</span>' +
        '<button id="zfTrusteeCopy" title="复制全部简报文本" style="border:1px solid #556;background:transparent;color:#99a;cursor:pointer;border-radius:4px;padding:1px 8px;font-size:11px;display:flex;align-items:center;gap:4px">' +
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>复制</button></div>';
      if (briefOpen) html += '<div style="margin-top:4px">' + briefLines + '</div>';
    }
    /* 托管中：旋转动画指示器（一眼看出在巡查）；关闭则不转 */
    var style = document.getElementById('zfTrusteeStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'zfTrusteeStyle';
      style.textContent =
        '@keyframes zfTrusteeSpin{to{transform:rotate(360deg)}}' +
        '.zfTrusteeSpin{animation:zfTrusteeSpin 1.2s linear infinite}';
      document.head.appendChild(style);
    }
    if (enabled) {
      html = html.replace('i托管</b>',
        '<svg class="zfTrusteeSpin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#5c5" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg> 托管巡查中</b>');
    }
    } /* end else（非迷你条模式） */
    /* 迷你条模式：压缩为极窄小条（用户要求：最小化的时候更小、宽度不太宽） */
    if (isMini()) {
      p.style.width = 'auto'; p.style.maxWidth = '280px'; p.style.maxHeight = 'none'; p.style.padding = '4px 10px'; p.style.overflow = 'visible'; p.style.fontSize = '12px';
    } else {
      p.style.width = '300px'; p.style.maxWidth = 'none'; p.style.maxHeight = '60vh'; p.style.padding = '12px 14px'; p.style.overflow = 'auto'; p.style.fontSize = '13px';
    }
    p.innerHTML = html;
    p.style.display = 'block';
    var closeBtn = p.querySelector('#zfTrusteeClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { p.style.display = 'none'; });
    var miniBtn = p.querySelector('#zfTrusteeMini');
    function toggleMini() { setMini(!isMini()); refresh(true); }
    if (miniBtn) miniBtn.addEventListener('click', toggleMini);
    var sw = p.querySelector('#zfTrusteeSwitch');
    if (sw) sw.addEventListener('click', function () {
      /* 即时反馈：点击后立即禁用按钮+显示"切换中…"，避免后端响应慢时像卡死 */
      sw.disabled = true;
      sw.style.opacity = '0.5';
      sw.style.cursor = 'wait';
      sw.innerHTML = '<span>⏳ 切换中…（正在通知后台，请稍候 1~2 秒）</span>';
      toggleSwitch(!enabled, function () { refresh(true); });
    });
    var bt = p.querySelector('#zfTrusteeBriefToggle');
    if (bt) bt.addEventListener('click', function () { briefOpen = !briefOpen; refresh(); });
    var cp = p.querySelector('#zfTrusteeCopy');
    if (cp) cp.addEventListener('click', function () {
      var txt = (st.brief || []).map(function (b) {
        return fmtTime(b.ts) + ' ' + b.line;
      }).join('\n');
      function ok() { if (window.showToast) showToast('简报已复制到剪贴板', 'ok'); }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(ok).catch(function () { fallbackCopy(txt); ok(); });
        } else { fallbackCopy(txt); ok(); }
      } catch (e) { fallbackCopy(txt); ok(); }
    });
  }

  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  function toggleSwitch(enabled, done) {
    try {
      fetch(API_CONFIG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (window.showToast) showToast(j.ok ? (enabled ? 'i托管开启：AI 全自动接管' : 'i托管关闭：人类接手') : '操作失败', j.ok ? 'ok' : 'err');
        if (done) done();
      }).catch(function () {
        if (window.showToast) showToast('请求失败（后端未重启或不可达）', 'err');
      });
    } catch (e) {
      if (window.showToast) showToast('请求异常: ' + e.message, 'err');
    }
  }

  function refresh(force) {
    try {
      fetch(API_STATUS).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) {
          /* 轮询护栏：面板已关就不 render（防止后台轮询把用户关掉的面板又顶开）；
             force=用户主动动作（点 Dock/切迷你）才强制渲染 */
          var vis = panelEl && panelEl.style.display === 'block';
          if (force || vis) render(j);
        }
        else if (force && window.showToast) showToast('i托管后端未就绪（需重启服务加载新模块）', 'warn');
      }).catch(function () {
        if (force && window.showToast) showToast('i托管后端未就绪（需重启服务加载新模块）', 'warn');
      });
    } catch (e) { /* 静默：面板未打开时不打扰 */ }
  }

  /* 打开期间 30s 轻量轮询：面板可见才 fetch；关了只做空可见性判断（前台保持轻） */
  function ensurePollTimer() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (panelEl && panelEl.style.display === 'block') refresh();
    }, 30000);
  }

  /* ---------- Dock 注册 ---------- */
  function register() {
    if (!window.ZFDock || typeof window.ZFDock.register !== 'function') return false;
    ZFDock.register({
      id: 'zf-app-trustee', name: 'i托管', icon: ICON,
      onClick: function () {
        var p = ensurePanel();
        if (p.style.display === 'block') { p.style.display = 'none'; return; }
        ensurePollTimer();
        refresh(true);
      }
    });
    return true;
  }
  var tries = 0;
  (function tryReg() {
    tries++;
    if (register()) return;
    if (tries < 20) setTimeout(tryReg, 500);
  })();
})();
