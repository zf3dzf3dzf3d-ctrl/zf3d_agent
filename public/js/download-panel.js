/* 多线程下载面板：调 /api/download/list /start /progress /cancel
 * 用法：DownloadPanel.start(url, filename) 或页面上有 data-download-url 元素自动绑定
 * 面板固定在左下角（可拖拽，位置记忆）；标题栏含 关闭(×) 与 折叠(—) 按钮
 * 特性：手动关闭后若无进行中任务自动停轮询；可一键清空已完成/失败任务 */
(function () {
  'use strict';
  if (window.__zfDownloadPanel) return;
  var state = {}; // id -> {name, el, bar, txt, cancel}
  var timer = null;
  var polling = false; // poll 在跑的标志，防止 finally 自续复活已停的轮询
  var cleared = {}; // 被用户手动清空的终态任务 id，poll 时跳过重建
  var STOP_KEY = 'zf-dl-panel-pos';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtSize(n) {
    if (!n || n <= 0) return '';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function ensureBox() {
    var box = document.getElementById('zf-dl-panel');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'zf-dl-panel';
    box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9990;width:320px;' +
      'background:var(--panel-bg,#1e1e2e);color:var(--text,#eee);border:1px solid rgba(128,128,128,.35);' +
      'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:12px;display:none;overflow:hidden;';
    box.innerHTML = '<div id="zf-dl-head" style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;gap:8px;' +
      'background:rgba(128,128,128,.12);font-weight:bold;cursor:move;user-select:none;">' +
      '<span style="flex:1;">下载任务</span>' +
      '<span data-act="clear" title="清空已完成/失败任务" style="cursor:pointer;opacity:.7;padding:0 4px;">清空</span>' +
      '<span data-act="toggle" title="折叠/展开" style="cursor:pointer;opacity:.7;padding:0 4px;">—</span>' +
      '<span data-act="close" title="关闭面板（下载继续）" style="cursor:pointer;opacity:.7;padding:0 4px;">×</span></div>' +
      '<div id="zf-dl-list" style="max-height:260px;overflow-y:auto;"></div>';
    document.body.appendChild(box);

    box.querySelector('[data-act="toggle"]').onclick = function () {
      var l = box.querySelector('#zf-dl-list');
      l.style.display = l.style.display === 'none' ? '' : 'none';
    };
    box.querySelector('[data-act="close"]').onclick = function () {
      box.style.display = 'none';
      box.dataset.closed = '1';
      // 无进行中任务则停止轮询（新任务 start() 会重启）
      if (!hasActive()) stopPoll();
    };
    box.querySelector('[data-act="clear"]').onclick = function () {
      var list = box.querySelector('#zf-dl-list');
      Object.keys(state).forEach(function (id) {
        if (state[id].status === 'done' || state[id].status === 'error' ||
            state[id].status === 'canceled' || state[id].status === 'cancelled') {
          state[id].el.remove();
          delete state[id];
          cleared[id] = true;
        }
      });
      if (!list.children.length && !hasActive()) { box.style.display = 'none'; stopPoll(); }
    };
    // clear 时记录已删除的终态 id，poll 跳过重建

    // 拖拽（标题栏）+ 位置记忆
    var head = box.querySelector('#zf-dl-head');
    head.addEventListener('mousedown', function (e) {
      if (e.target.dataset.act) return; // 点按钮不拖拽
      e.preventDefault();
      var sx = e.clientX, sy = e.clientY;
      var r = box.getBoundingClientRect();
      var ol = parseFloat(box.style.left) || r.left;
      var ob = (window.innerHeight - r.bottom);
      function mv(ev) {
        box.style.left = Math.max(0, Math.min(window.innerWidth - 80, ol + ev.clientX - sx)) + 'px';
        box.style.bottom = Math.max(0, ob - (ev.clientY - sy)) + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        try { localStorage.setItem(STOP_KEY, JSON.stringify({ left: box.style.left, bottom: box.style.bottom })); } catch (e2) {}
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
    // 恢复上次位置
    try {
      var p = JSON.parse(localStorage.getItem(STOP_KEY) || 'null');
      if (p && p.left && p.bottom) { box.style.left = p.left; box.style.bottom = p.bottom; }
    } catch (e3) {}
    return box;
  }

  function row(id, name) {
    var list = ensureBox().querySelector('#zf-dl-list');
    var el = document.createElement('div');
    el.dataset.id = id;
    el.style.cssText = 'padding:8px 10px;border-top:1px solid rgba(128,128,128,.18);';
    el.innerHTML = '<div style="display:flex;justify-content:space-between;gap:6px;">' +
      '<span class="zf-dl-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(name) + '">' + esc(name) + '</span>' +
      '<a data-act="cancel" title="取消此任务" style="cursor:pointer;color:#f66;flex-shrink:0;">取消</a></div>' +
      '<div class="zf-dl-track" style="height:6px;background:rgba(128,128,128,.25);border-radius:3px;margin-top:6px;overflow:hidden;">' +
      '<div class="zf-dl-bar" style="height:100%;width:0;background:#4a9eff;transition:width .3s;"></div></div>' +
      '<div class="zf-dl-txt" style="margin-top:4px;opacity:.7;">准备中…</div>';
    var cancelBtn = el.querySelector('[data-act="cancel"]');
    cancelBtn.onclick = function () {
      if (cancelBtn.dataset.disabled) return;
      cancelBtn.dataset.disabled = '1';
      cancelBtn.style.opacity = '.4';
      fetch('/api/download/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
    };
    list.appendChild(el);
    ensureBox().style.display = '';
    return { el: el, bar: el.querySelector('.zf-dl-bar'), txt: el.querySelector('.zf-dl-txt'), cancel: cancelBtn, status: '' };
  }

  function hasActive() {
    return Object.keys(state).some(function (id) {
      return ['done', 'error', 'canceled', 'cancelled'].indexOf(state[id].status) < 0;
    });
  }

  function stopPoll() {
    polling = false;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  var FINISHED = ['done', 'error', 'canceled', 'cancelled'];
  function poll() {
    polling = true;
    fetch('/api/download/list').then(function (r) { return r.json(); }).then(function (d) {
      var tasks = (d && d.tasks) || [];
      var anyActive = false;
      tasks.forEach(function (t) {
        var s = state[t.id];
        var name = t.filename || t.name || t.url || t.id;
        if (!s) {
          // 用户已手动清空且后端仍是终态 → 不重建（否则清空后又出现）
          var st0 = t.status || t.state || '';
          if (cleared[t.id] && FINISHED.indexOf(st0) >= 0) return;
          s = state[t.id] = row(t.id, name);
        }
        var st = t.status || t.state || '';
        s.status = st;
        var pct = (t.percent != null) ? t.percent : Math.floor((t.progress || 0) * 100);
        s.bar.style.width = pct + '%';
        var speed = t.speed && !FINISHED.includes(st) ? ' · ' + (t.speed / 1048576).toFixed(2) + ' MB/s' : '';
        var size = t.total ? ' · ' + fmtSize(t.done) + '/' + fmtSize(t.total) : '';
        var err = st === 'error' && t.error ? ' · ' + t.error : '';
        var stText = (st === 'canceled' || st === 'cancelled') ? '已取消' : st;
        s.txt.textContent = pct + '%' + size + speed + ' · ' + stText + err;
        if (FINISHED.indexOf(st) < 0) anyActive = true;
        else if (s.cancel) { s.cancel.style.display = 'none'; } // 终态隐藏取消
        if (st === 'done') { s.bar.style.background = '#3fbf6f'; }
        else if (st === 'error') { s.bar.style.background = '#f66'; }
      });
      var box = document.getElementById('zf-dl-panel');
      if (box && anyActive && box.dataset.closed !== '1') box.style.display = '';
      // 手动关闭且无活动任务 → 停轮询省资源
      if (box && box.dataset.closed === '1' && !anyActive) { polling = false; stopPoll(); }
    }).catch(function () {}).finally(function () {
      if (!polling) return; // 已被 stopPoll 停掉，不再自续
      stopPoll();
      timer = setTimeout(poll, 800);
    });
  }

  // 首个任务启动时清除"手动关闭"标记，面板重新弹出（并确保轮询在跑）
  function start(url, name) {
    name = name || decodeURIComponent((url.split('?')[0].split('/').pop() || '下载文件'));
    fetch('/api/download/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, name: name, threads: 8 }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.id) {
          var box = ensureBox();
          box.dataset.closed = '';
          box.style.display = '';
          state[d.id] = row(d.id, name);
          if (!timer) poll();
        }
        else alert('启动下载失败：' + JSON.stringify(d));
      });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-download-url]');
    if (a) { e.preventDefault(); start(a.getAttribute('data-download-url')); }
  });

  window.__zfDownloadPanel = { start: start };
  poll();
})();
