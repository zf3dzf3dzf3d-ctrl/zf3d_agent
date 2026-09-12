/* ============================================================
 * app-tableviewer.js — 数据表查看器（浏览 table_memory 建的表）
 * 后端：GET /api/table-viewer?action=list|rows
 * 入口：任务本面板头部「🗄」按钮 + window.TableViewer.open()
 * v2：表头点击排序（升/降序） + 窗口边缘/角落自由调整大小
 * ============================================================ */
(function () {
  'use strict';

  var API = '/api/table-viewer';
  var openState = false;
  var win = null;
  var currentTable = null;
  // 排序状态
  var sortCol = null;
  var sortDir = 1; // 1=升序 -1=降序
  var lastRowsData = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 位置/尺寸记忆 ----------
  function loadState(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function saveState(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  // ---------- 窗口拖拽移动 ----------
  function makeDraggable(el, handle) {
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('.tv-close')) return;
      var rect = el.getBoundingClientRect();
      var ox = e.clientX - rect.left, oy = e.clientY - rect.top;
      function mv(ev) {
        el.style.left = Math.min(Math.max(0, ev.clientX - ox), window.innerWidth - 80) + 'px';
        el.style.top = Math.min(Math.max(0, ev.clientY - oy), window.innerHeight - 40) + 'px';
        el.style.right = 'auto';
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        saveState('tv_win_pos', { x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  }

  // ---------- 窗口边缘/角落拖拽缩放 ----------
  function makeResizable(el) {
    var edges = [
      { cls: 'tv-rz-n',  dir: 'n'  }, { cls: 'tv-rz-s',  dir: 's'  },
      { cls: 'tv-rz-e',  dir: 'e'  }, { cls: 'tv-rz-w',  dir: 'w'  },
      { cls: 'tv-rz-ne', dir: 'ne' }, { cls: 'tv-rz-nw', dir: 'nw' },
      { cls: 'tv-rz-se', dir: 'se' }, { cls: 'tv-rz-sw', dir: 'sw' }
    ];
    edges.forEach(function (edge) {
      var h = document.createElement('div');
      h.className = edge.cls;
      el.appendChild(h);
      h.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var rect = el.getBoundingClientRect();
        var sx = e.clientX, sy = e.clientY;
        var o = { l: rect.left, t: rect.top, w: rect.width, h: rect.height };
        var d = edge.dir;
        function mv(ev) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          var l = o.l, t = o.t, w = o.w, hh = o.h;
          if (d.indexOf('e') > -1) w = Math.max(360, o.w + dx);
          if (d.indexOf('s') > -1) hh = Math.max(220, o.h + dy);
          if (d.indexOf('w') > -1) { w = Math.max(360, o.w - dx); l = o.l + (o.w - w); }
          if (d.indexOf('n') > -1) { hh = Math.max(220, o.h - dy); t = o.t + (o.h - hh); }
          el.style.left = l + 'px'; el.style.top = t + 'px';
          el.style.right = 'auto';
          el.style.width = Math.min(w, window.innerWidth) + 'px';
          el.style.height = Math.min(hh, window.innerHeight) + 'px';
        }
        function up() {
          document.removeEventListener('mousemove', mv);
          document.removeEventListener('mouseup', up);
          saveState('tv_win_size', { w: parseFloat(el.style.width), h: parseFloat(el.style.height) });
        }
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
      });
    });
  }

  // ---------- API ----------
  function apiGet(params) {
    return fetch(API + '?' + params).then(function (r) { return r.json(); });
  }

  function refresh() {
    var body = document.getElementById('tv-body');
    if (currentTable) {
      apiGet('action=rows&table=' + encodeURIComponent(currentTable)).then(function (d) {
        lastRowsData = d;
        renderRows(d, currentTable);
      });
    } else {
      apiGet('action=list').then(renderList);
    }
  }

  // ---------- 创建窗口 ----------
  function ensureWin() {
    if (win) return;
    win = document.createElement('div');
    win.id = 'tv-win';
    win.innerHTML =
      '<div class="tv-head" id="tv-head">' +
        '<span style="font-size:16px">🗄</span>' +
        '<span class="tv-title">数据表查看器</span>' +
        '<span class="tv-refresh" id="tv-refresh" title="刷新">⟳</span>' +
        '<span class="tv-close" id="tv-close" title="关闭">✕</span>' +
      '</div>' +
      '<div class="tv-body" id="tv-body"></div>';
    document.body.appendChild(win);

    var st = document.createElement('style');
    st.textContent = [
      '#tv-win{position:fixed;top:60px;right:340px;z-index:2147482100;width:680px;max-width:96vw;height:480px;max-height:92vh;',
      '  background:linear-gradient(160deg,rgba(10,14,28,.96),rgba(16,20,40,.92));',
      '  border:1px solid rgba(0,240,255,.25);border-radius:14px;box-shadow:0 12px 50px rgba(0,0,0,.6);',
      '  display:none;flex-direction:column;font-family:system-ui,sans-serif;color:#dbe9f5;overflow:hidden;min-width:360px;min-height:220px}',
      '#tv-win.open{display:flex}',
      '.tv-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(0,240,255,.18)}',
      '.tv-title{flex:1;font-weight:700;letter-spacing:1px;color:#6ff3ff;text-shadow:0 0 14px rgba(0,240,255,.55)}',
      '.tv-refresh{cursor:pointer;color:#6ff3ff;font-size:16px}.tv-refresh:hover{text-shadow:0 0 10px rgba(0,240,255,.8)}',
      '.tv-close{cursor:pointer;color:#9db4c8;opacity:.75;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center}.tv-close:hover{opacity:1;color:#ff8899}',
      '.tv-body{flex:1;overflow:auto;padding:10px 12px;font-size:12px}',
      '.tv-empty{color:#7a93a8;text-align:center;padding:30px 0}',
      '.tv-tlist{display:flex;flex-direction:column;gap:6px}',
      '.tv-table-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid rgba(0,240,255,.15);border-radius:10px;cursor:pointer;background:rgba(255,255,255,.03)}',
      '.tv-table-item:hover{border-color:rgba(0,240,255,.5);background:rgba(0,240,255,.07)}',
      '.tv-tname{font-weight:600;color:#aeeaff;flex:1}',
      '.tv-tcount{font-size:11px;color:#7a93a8}',
      '.tv-back{cursor:pointer;color:#6ff3ff;font-weight:600;margin-bottom:8px;display:inline-block}',
      '.tv-back:hover{text-shadow:0 0 8px rgba(0,240,255,.6)}',
      '.tv-grid{border-collapse:collapse;width:100%;white-space:nowrap}',
      '.tv-grid th{position:sticky;top:0;background:rgba(10,20,40,.95);color:#6ff3ff;font-weight:600;text-align:left;padding:7px 10px;',
      '  border-bottom:1px solid rgba(0,240,255,.35);cursor:pointer;user-select:none}',
      '.tv-grid th:hover{background:rgba(0,240,255,.12)}',
      '.tv-grid th .tv-sort{font-size:10px;margin-left:4px;color:#ffd76f}',
      '.tv-grid td{padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:#cfe3f2;max-width:260px;overflow:hidden;text-overflow:ellipsis}',
      '.tv-grid tr:hover td{background:rgba(0,240,255,.05)}',
      '.tv-grid td.tv-id,.tv-grid th.tv-id{color:#5a7d96;font-size:11px}',
      // ---- 缩放手柄（8 个方位）----
      '.tv-rz-n,.tv-rz-s{position:absolute;left:10px;right:10px;height:6px;cursor:ns-resize}',
      '.tv-rz-e,.tv-rz-w{position:absolute;top:10px;bottom:10px;width:6px;cursor:ew-resize}',
      '.tv-rz-ne,.tv-rz-nw,.tv-rz-se,.tv-rz-sw{position:absolute;width:14px;height:14px;cursor:nwse-resize}',
      '.tv-rz-n{top:-3px}.tv-rz-s{bottom:-3px}.tv-rz-e{right:-3px}.tv-rz-w{left:-3px}',
      '.tv-rz-ne{top:-4px;right:-4px;cursor:nesw-resize}.tv-rz-nw{top:-4px;left:-4px}',
      '.tv-rz-se{bottom:-4px;right:-4px}.tv-rz-sw{bottom:-4px;left:-4px}',
      '.tv-rz-se::after{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;',
      '  border-right:2px solid rgba(0,240,255,.5);border-bottom:2px solid rgba(0,240,255,.5);border-radius:2px}'
    ].join('');
    document.head.appendChild(st);

    document.getElementById('tv-close').addEventListener('click', function () { toggle(false); });
    document.getElementById('tv-refresh').addEventListener('click', function () { refresh(); });

    // 恢复位置与尺寸
    var p = loadState('tv_win_pos');
    if (p && typeof p.x === 'number') {
      win.style.left = Math.min(Math.max(0, p.x), window.innerWidth - 120) + 'px';
      win.style.top = Math.min(Math.max(0, p.y), window.innerHeight - 60) + 'px';
      win.style.right = 'auto';
    }
    var sz = loadState('tv_win_size');
    if (sz && sz.w >= 360) {
      win.style.width = Math.min(sz.w, window.innerWidth) + 'px';
      win.style.height = Math.min(sz.h, window.innerHeight) + 'px';
    }
    makeDraggable(win, document.getElementById('tv-head'));
    makeResizable(win);
  }

  function toggle(v) {
    ensureWin();
    openState = typeof v === 'boolean' ? v : !openState;
    win.classList.toggle('open', openState);
    if (openState) refresh();
  }

  // ---------- 渲染：表列表 ----------
  function renderList(tables) {
    var body = document.getElementById('tv-body');
    if (!tables || !tables.length) {
      body.innerHTML = '<div class="tv-empty">还没有数据表<br>让 AI 用 table_memory 工具建一个吧</div>';
      return;
    }
    var html = ['<div class="tv-tlist">'];
    tables.forEach(function (t) {
      html.push('<div class="tv-table-item" data-table="' + esc(t.name) + '">' +
        '<span>🗂</span><span class="tv-tname">' + esc(t.name) + '</span>' +
        '<span class="tv-tcount">' + t.count + ' 行 · ' + esc((t.created_at || '').slice(0, 10)) + '</span></div>');
    });
    html.push('</div>');
    body.innerHTML = html.join('');
    body.querySelectorAll('.tv-table-item').forEach(function (el) {
      el.addEventListener('click', function () {
        currentTable = el.dataset.table;
        sortCol = null; sortDir = 1;
        renderRows(null, currentTable);
      });
    });
  }

  // ---------- 排序 ----------
  function sortedRows(rows, cols) {
    if (!sortCol) return rows;
    var idx = cols.indexOf(sortCol);
    return rows.slice().sort(function (a, b) {
      var va = a[sortCol], vb = b[sortCol];
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'object') va = JSON.stringify(va);
      if (typeof vb === 'object') vb = JSON.stringify(vb);
      var na = parseFloat(va), nb = parseFloat(vb);
      var r;
      if (!isNaN(na) && !isNaN(nb) && String(na) === String(va).trim() && String(nb) === String(vb).trim()) {
        r = na - nb; // 数值排序
      } else {
        r = String(va).localeCompare(String(vb), 'zh-CN');
      }
      return r * sortDir;
    });
  }

  // ---------- 渲染：表数据网格 ----------
  function renderRows(d, tableName) {
    var body = document.getElementById('tv-body');
    if (!d || !d.ok) {
      body.innerHTML = '<span class="tv-back" id="tv-back">← 返回表列表</span><div class="tv-empty">' + esc((d && d.error) || '加载失败') + '</div>';
      bindBack();
      return;
    }
    var cols = d.columns || [];
    var rows = sortedRows(d.rows || [], cols);
    var html = ['<span class="tv-back" id="tv-back">← 返回表列表</span>'];
    html.push('<div style="color:#6ff3ff;font-weight:600;margin-bottom:6px">🗂 ' + esc(tableName) +
      ' <span style="color:#7a93a8;font-weight:400;font-size:11px">' + d.count + ' 行 · 点击表头可排序</span></div>');
    html.push('<table class="tv-grid"><thead><tr>');
    cols.forEach(function (c) {
      var label = esc(c === '_created_at' ? '创建时间' : c);
      var arrow = '';
      if (sortCol === c) arrow = '<span class="tv-sort">' + (sortDir === 1 ? '▲' : '▼') + '</span>';
      html.push('<th class="' + (c === 'id' || c === '_created_at' ? 'tv-id' : '') + '" data-col="' + esc(c) + '">' + label + arrow + '</th>');
    });
    html.push('</tr></thead><tbody>');
    rows.forEach(function (r) {
      html.push('<tr>');
      cols.forEach(function (c) {
        var v = r[c];
        if (v != null && typeof v === 'object') v = JSON.stringify(v);
        html.push('<td class="' + (c === 'id' || c === '_created_at' ? 'tv-id' : '') + '" title="' + esc(v) + '">' + esc(v) + '</td>');
      });
      html.push('</tr>');
    });
    html.push('</tbody></table>');
    if (!d.count) html.push('<div class="tv-empty">空表，还没有记录</div>');
    body.innerHTML = html.join('');
    bindBack();
    // 绑定表头排序点击
    body.querySelectorAll('.tv-grid th').forEach(function (th) {
      th.addEventListener('click', function () {
        var c = th.dataset.col;
        if (sortCol === c) { sortDir = -sortDir; } else { sortCol = c; sortDir = 1; }
        renderRows(lastRowsData, tableName);
      });
    });
  }

  function bindBack() {
    var back = document.getElementById('tv-back');
    if (back) back.addEventListener('click', function () {
      currentTable = null; sortCol = null; sortDir = 1; refresh();
    });
  }

  // ---------- 对外接口 ----------
  window.TableViewer = {
    open: function (table) {
      toggle(true);
      if (table) { currentTable = table; sortCol = null; sortDir = 1; refresh(); }
    },
    close: function () { toggle(false); },
    toggle: function () { toggle(); }
  };

  // ---------- 启动 ----------
  function injectIntoTasknotes() {
    var head = document.querySelector('#tn-panel .tn-head');
    if (!head || document.getElementById('tn-btn-tableviewer')) return;
    var btn = document.createElement('span');
    btn.id = 'tn-btn-tableviewer';
    btn.textContent = '🗄';
    btn.title = '数据表查看器';
    btn.style.cssText = 'cursor:pointer;font-size:14px;margin-left:6px;';
    btn.addEventListener('click', function (e) { e.stopPropagation(); window.TableViewer.open(); });
    var closeBtn = head.querySelector('.tn-close');
    if (closeBtn) head.insertBefore(btn, closeBtn);
    else head.appendChild(btn);
  }

  function boot() {
    ensureWin();
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var head = document.querySelector('#tn-panel .tn-head');
      if (head) { clearInterval(timer); injectIntoTasknotes(); }
      else if (tries > 100) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
