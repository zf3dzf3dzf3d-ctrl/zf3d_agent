/**
 * timeline-view.js — 时间线浏览器（改不坏防护体系 lp-20260902-053009 · 步骤 6）
 * ---------------------------------------------------------------
 * 零耦合独立模块：全屏覆盖层，多维回溯入口。
 *   - 聚合展示：账本步骤（ledger-step）/ 快照（snapshot）/ git 提交（commit）
 *   - 操作：撤销到某账本步骤（undo_step，安全回退）、revert 某提交、查看详情
 *   - 入口：window.TLView.toggle() / open() / close()；控制台直接 TLView.toggle()
 * 依赖：后端 /api/tools/timeline（tools/coding/backend/timeline.py）。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.TLView) return;

  var overlay = null, items = [];
  var _lastLoad = 0;        // 节流：距上次加载毫秒数
  var _lastSig = '';       // 数据签名：内容没变就不重绘，防闪烁
  var _escBound = false;   // ESC 监听只绑一次
  var _loadTimer = null;   // 单飞：同一时刻只允许一个加载请求在途

  var CSS = [
    '#tl-overlay{position:fixed;inset:0;z-index:99989;background:radial-gradient(ellipse at 50% 40%,#0d1226 0%,#05070f 100%);display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#cfd8ff;}',
    '#tl-head{display:flex;gap:10px;align-items:center;padding:12px 18px;border-bottom:1px solid rgba(120,160,255,.15);flex-wrap:wrap;}',
    '#tl-head h3{margin:0;font-size:16px;background:linear-gradient(90deg,#7cf,#a6f);-webkit-background-clip:text;background-clip:text;color:transparent;}',
    '#tl-refresh{background:rgba(120,160,255,.15);border:1px solid rgba(120,160,255,.4);color:#cfd8ff;border-radius:8px;padding:6px 14px;cursor:pointer;}',
    '#tl-close{margin-left:auto;background:rgba(255,90,90,.15);border:1px solid rgba(255,90,90,.4);color:#ff9;border-radius:8px;padding:6px 14px;cursor:pointer;}',
    '#tl-list{flex:1;overflow:auto;padding:10px 18px;}',
    '#tl-stats{padding:4px 18px;opacity:.6;font-size:12px;}',
    '.tl-item{display:flex;gap:10px;align-items:center;padding:8px 10px;margin:6px 0;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(120,160,255,.12);flex-wrap:wrap;}',
    '.tl-badge{flex:0 0 auto;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;}',
    '.tl-b-step{background:rgba(120,220,160,.15);color:#7fe0a0;border:1px solid rgba(120,220,160,.4);}',
    '.tl-b-auto{background:rgba(250,200,90,.12);color:#ffd47f;border:1px solid rgba(250,200,90,.35);}',
    '.tl-b-snap{background:rgba(180,140,255,.15);color:#c9a6ff;border:1px solid rgba(180,140,255,.4);}',
    '.tl-b-commit{background:rgba(120,160,255,.12);color:#8ab6ff;border:1px solid rgba(120,160,255,.35);}',
    '.tl-time{flex:0 0 auto;font-size:11px;opacity:.65;white-space:nowrap;}',
    '.tl-msg{flex:1 1 200px;font-size:12px;word-break:break-all;}',
    '.tl-btn{flex:0 0 auto;background:rgba(120,160,255,.15);border:1px solid rgba(120,160,255,.4);color:#9cf;border-radius:8px;padding:3px 10px;cursor:pointer;font-size:12px;}',
    '.tl-btn:hover{background:rgba(120,160,255,.3);}',
    '.tl-undone{opacity:.45;text-decoration:line-through;}'
  ].join('\n');

  function api(action, body) {
    return fetch('/api/tools/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, body || {}))
    }).then(function (r) { return r.json(); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(t) {
    if (!t) return '';
    if (typeof t === 'string') return t.replace('T', ' ').slice(0, 19);
    try { var d = new Date(Number(t) * 1000); return d.toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(t); }
  }

  function badge(it) {
    if (it.type === 'ledger-step') return it.auto ? ['auto', 'tl-b-auto'] : ['step ' + it.step, 'tl-b-step'];
    if (it.type === 'snapshot') return ['snapshot', 'tl-b-snap'];
    return ['commit', 'tl-b-commit'];
  }

  function render() {
    var list = document.getElementById('tl-list');
    if (!list) return;
    if (!items.length) { list.innerHTML = '<div style="opacity:.6;padding:20px;">暂无时间线记录</div>'; return; }
    // 数据签名：未变化则不重绘（防刷新闪烁跳动）
    var sig = items.map(function (it) { return [it.type, it.step, it.commit, it.undone].join('|'); }).join(';');
    if (sig === _lastSig && list.children.length) { _lastSig = sig; return; }
    _lastSig = sig;
    var html = items.map(function (it, idx) {
      var b = badge(it);
      var undone = (it.type === 'ledger-step' && it.undone) ? ' tl-undone' : '';
      var msg = it.type === 'ledger-step' ? (it.message || '')
        : it.type === 'snapshot' ? (it.name + '（' + it.size_mb + ' MB）')
        : ((it.commit || '') + ' ' + (it.message || ''));
      var btn = '';
      if (it.type === 'ledger-step' && !it.undone && it.commit) {
        btn = '<button class="tl-btn" data-act="undo" data-step="' + it.step + '" data-commit="' + esc(it.commit) + '">↩ 撤销</button>';
      } else if (it.type === 'commit' && it.commit) {
        btn = '<button class="tl-btn" data-act="revert" data-commit="' + esc(it.commit) + '">↩ revert</button>';
      }
      return '<div class="tl-item' + undone + '">' +
        '<span class="tl-badge ' + b[1] + '">' + b[0] + '</span>' +
        '<span class="tl-time">' + esc(fmtTime(it.time_str || it.time)) + '</span>' +
        '<span class="tl-msg">' + esc(msg) + '</span>' + btn + '</div>';
    }).join('');
    list.innerHTML = html;
    document.getElementById('tl-stats').textContent =
      '共 ' + items.length + ' 条 · 账本步骤/快照/提交 · 点「撤销」按步骤安全回退（revert，不删历史）';
    list.querySelectorAll('.tl-btn').forEach(function (btn) {
      btn.onclick = function () {
        var act = btn.getAttribute('data-act');
        var commit = btn.getAttribute('data-commit');
        var step = btn.getAttribute('data-step');
        if (!(window.confirm || function () { return true; })()) return;
        btn.disabled = true; btn.textContent = '执行中…';
        var p = act === 'undo'
          ? api('rollback', { step: Number(step) })
          : api('rollback', { commit: commit });
        p.then(function (res) {
          alert(res && res.ok ? '✅ 回滚完成：' + (res.output || res.head_now || '') : '❌ 失败：' + ((res && (res.error || res.output)) || '未知'));
          load();
        }).catch(function (e) { alert('❌ 请求失败：' + e.message); btn.disabled = false; btn.textContent = '↩ 重试'; });
      };
    });
  }

  function load() {
    var st = document.getElementById('tl-stats');
    // 节流：2 秒内重复加载直接跳过（防轮询/重复触发导致闪烁）
    var now = Date.now();
    if (now - _lastLoad < 2000) return Promise.resolve();
    // 单飞：上一个请求还在途时不发起新请求（防止响应乱序交替渲染导致闪烁）
    if (_loadTimer) return Promise.resolve();
    _lastLoad = now;
    if (st) st.textContent = '加载中…';
    _loadTimer = api('list', { limit: 60 }).then(function (res) {
      _loadTimer = null;
      items = (res && res.timeline) || [];
      if (overlay) render();
    }).catch(function (e) {
      _loadTimer = null;
      if (st) st.textContent = '加载失败：' + e.message;
    });
    return _loadTimer;
  }

  function open() {
    if (overlay) { overlay.style.display = 'flex'; load(); return; }
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    overlay = document.createElement('div');
    overlay.id = 'tl-overlay';
    overlay.innerHTML =
      '<div id="tl-head"><h3>🕰 时间线浏览器（多维回溯）</h3>' +
      '<button id="tl-refresh">🔄 刷新</button>' +
      '<button id="tl-close">✕ 关闭</button></div>' +
      '<div id="tl-list"></div><div id="tl-stats"></div>';
    document.body.appendChild(overlay);
    document.getElementById('tl-close').onclick = function () { overlay.style.display = 'none'; };
    document.getElementById('tl-refresh').onclick = function () { _lastLoad = 0; load(); };
    // ESC 快捷退出：任何情况下按 ESC 关闭面板
    if (!_escBound) {
      _escBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') {
          overlay.style.display = 'none';
        }
      });
    }
    load();
  }

  function close() { if (overlay) overlay.style.display = 'none'; }
  function toggle() { (overlay && overlay.style.display === 'flex') ? close() : open(); }

  window.TLView = { open: open, close: close, toggle: toggle, refresh: load };
})();
