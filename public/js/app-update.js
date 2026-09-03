// app-update.js — 版本检查与自动更新（v2：全自动模式）
// ============================================================
// 行为（全自动，无需用户任何操作）：
//   1. 页面加载 5 秒后开始，每 60 秒向 /api/update-status 轮询
//   2. 后端守护线程自动检查新版本（首查延迟30秒、每6小时复查），
//      发现新版自动下载+备份+覆盖（private/ 与数据库永不覆盖）
//   3. 前端发现 phase === 'updated' 且 AI 空闲时，静默刷新页面，
//      全程不打断正在生成的对话
// 设置面板仍保留手动「检查更新」按钮作为兜底
// ============================================================

(function () {
  'use strict';

  // ---------- 手动检查（保留原功能，设置面板按钮用） ----------
  window.checkUpdate = function (btn) {
    var statusEl = document.getElementById('updateStatus');
    if (btn) { btn.disabled = true; btn.textContent = '检查中...'; }
    fetch('/api/check-update', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
        if (!statusEl) return;
        if (data.has_update) {
          statusEl.textContent = '发现新版本 ' + (data.latest_version || '') +
            '，正在自动更新，稍后页面将自动刷新。';
        } else {
          statusEl.textContent = data.message || '已是最新版本';
        }
        if (data.error) statusEl.textContent += '（' + data.error + '）';
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
        if (statusEl) statusEl.textContent = '检查失败: ' + err;
      });
  };

  window.doUpdate = function (btn) {
    var statusEl = document.getElementById('updateStatus');
    if (btn) { btn.disabled = true; btn.textContent = '更新中...'; }
    fetch('/api/do-update', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = '执行更新'; }
        if (statusEl) {
          statusEl.textContent = data.success ? ('已更新到 ' + (data.version || '新版本')) : ('更新失败: ' + (data.error || '未知错误'));
        }
        if (data.success) setTimeout(function () { location.reload(); }, 2000);
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.textContent = '执行更新'; }
        if (statusEl) statusEl.textContent = '更新失败: ' + err;
      });
  };

  // ---------- 全自动更新（核心新增） ----------
  // 监控页面活跃请求：AI 生成中不打断，空闲时才刷新
  var activeRequests = 0;

  function wrapFetch() {
    if (window._zf3dFetchWrapped) return;
    window._zf3dFetchWrapped = true;
    var rawFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      activeRequests++;
      return rawFetch.apply(window, args).then(
        function (resp) { activeRequests--; return resp; },
        function (err) { activeRequests--; throw err; }
      );
    };
    // SSE 流式连接同样计数（EventSource 无法被 fetch 包装捕获，单独监听）
    var RawEventSource = window.EventSource;
    if (RawEventSource) {
      window.EventSource = function (url, cfg) {
        var es = new RawEventSource(url, cfg);
        activeRequests++;
        // SSE 没有标准 close 事件：error 时 readyState=2(CLOSED) 才算真正断开。
        // 监听 error + open，用状态轮询兜底，连接失败/被关时正确释放计数，避免泄漏。
        var dec = function () {
          if (es.readyState === 2) { activeRequests--; es._zfCounted = false; }
        };
        es.addEventListener('error', dec);
        // 客户端主动 close()：包装一层让计数同步释放
        var rawClose = es.close.bind(es);
        es.close = function () { if (es._zfCounted !== false) { activeRequests--; es._zfCounted = false; } return rawClose(); };
        // error 后 readyState 可能延迟变为 2，轮询一小段时间兜底
        var t = setInterval(function () {
          if (es.readyState === 2) { clearInterval(t); dec(); }
        }, 1000);
        // 60 秒后停止轮询（长连 SSE 正常运行不受影响）
        setTimeout(function () { clearInterval(t); }, 60000);
        return es;
      };
      window.EventSource.prototype = RawEventSource.prototype;
    }
  }
  wrapFetch();

  var lastUpdatedAt = null;      // 上次见到的更新完成时间戳
  var refreshPending = false;

  function pollAutoUpdate() {
    fetch('/api/update-status').then(function (r) { return r.json(); }).then(function (st) {
      if (!st || !st.success) return;

      // 首次轮询：建立基线（服务器一启动就已完成的更新不触发刷新）
      if (lastUpdatedAt === null) {
        lastUpdatedAt = st.updated_at || 'baseline';
        return;
      }

      // 发现新的一次自动更新完成
      if (st.phase === 'updated' && st.updated_at && st.updated_at !== lastUpdatedAt) {
        if (refreshPending) return;
        refreshPending = true;
        tryWaitingRefresh(st);
      }
    }).catch(function () { /* 网络异常忽略，下轮再试 */ });
  }

  // 等待 AI 空闲（无活跃请求）后刷新；最多等 10 分钟，超时强制刷新
  function tryWaitingRefresh(st) {
    var start = Date.now();
    var hint = showUpdateHint(st.latest_version);
    (function wait() {
      if (activeRequests <= 0) {
        lastUpdatedAt = st.updated_at;
        if (hint) hint.remove();
        location.reload();
        return;
      }
      if (Date.now() - start > 10 * 60 * 1000) {
        if (hint) hint.remove();
        location.reload();
        return;
      }
      setTimeout(wait, 5000); // 每 5 秒探测一次空闲
    })();
  }

  // 右下角小提示（非阻断，点击可跳过等待立即刷新）
  function showUpdateHint(version) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;' +
      'background:rgba(30,32,40,.92);color:#fff;padding:10px 14px;border-radius:8px;' +
      'font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer;';
    el.textContent = '已自动更新到 ' + (version || '新版本') + '，当前任务完成后自动刷新';
    el.title = '点击立即刷新';
    el.onclick = function () { location.reload(); };
    document.body.appendChild(el);
    return el;
  }

  // 启动轮询：5 秒后开始，每 60 秒一次
  setTimeout(function () {
    pollAutoUpdate();
    setInterval(pollAutoUpdate, 60 * 1000);
  }, 5000);
})();
