// app-update.js — 版本检查与更新提示（v3：安装包模式 / 方案B）
// ============================================================
// 行为：
//   1. 页面加载 5 秒后开始，每 60 秒向 /api/update-status 轮询
//   2. 后端守护线程自动检查新版本（首查延迟30秒、每6小时复查）
//   3. 发现新版本 phase === 'available' → 右下角弹出提示条
//      「发现新版本 x.x.x [立即更新]」
//   4. 用户点击「立即更新」→ POST /api/do-update
//      后台下载新版安装包 → 下载完成后自动弹出安装程序
//      用户按提示下一步安装即可（覆盖安装不丢 private/ 隐私数据）
//   5. 设置面板保留手动「检查更新」按钮兜底
// ============================================================

(function () {
  'use strict';

  var hintEl = null;

  // ---------- 右下角提示条 ----------
  function showAvailableHint(version) {
    if (hintEl) return;
    hintEl = document.createElement('div');
    hintEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;' +
      'background:rgba(30,32,40,.95);color:#fff;padding:12px 16px;border-radius:10px;' +
      'font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;';
    var txt = document.createElement('span');
    txt.textContent = '发现新版本 ' + (version || '') + '，可更新';
    var btn = document.createElement('button');
    btn.textContent = '立即更新';
    btn.style.cssText = 'background:#3b82f6;color:#fff;border:none;border-radius:6px;' +
      'padding:6px 14px;font-size:12px;cursor:pointer;';
    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = '下载中...';
      txt.textContent = '正在下载新版安装包，完成后自动弹出安装程序';
      fetch('/api/do-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            btn.textContent = '已启动';
            txt.textContent = '安装包下载完成后会自动弹出安装窗口，按提示安装即可（数据不会丢失）';
          } else {
            btn.textContent = '重试';
            btn.disabled = false;
            txt.textContent = '更新失败: ' + (data.error || '未知错误');
          }
        })
        .catch(function () {
          btn.textContent = '重试';
          btn.disabled = false;
          txt.textContent = '网络异常，请重试';
        });
    };
    var close = document.createElement('span');
    close.textContent = '✕';
    close.style.cssText = 'cursor:pointer;opacity:.6;margin-left:4px;';
    close.onclick = function () { hintEl.remove(); hintEl = null; };
    hintEl.appendChild(txt);
    hintEl.appendChild(btn);
    hintEl.appendChild(close);
    document.body.appendChild(hintEl);
  }

  // ---------- 轮询 ----------
  function pollAutoUpdate() {
    fetch('/api/update-status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.phase === 'available') {
          showAvailableHint(data.latest_version);
        }
      })
      .catch(function () { /* 静默 */ });
  }

  // ---------- 手动检查（设置面板按钮用） ----------
  window.checkUpdate = function (btn) {
    var statusEl = document.getElementById('updateStatus');
    if (btn) { btn.disabled = true; btn.textContent = '检查中...'; }
    fetch('/api/check-update', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
        if (!statusEl) return;
        if (data.has_update) {
          statusEl.textContent = '发现新版本 ' + (data.latest_version || '') + '，请点击页面右下角「立即更新」。';
          showAvailableHint(data.latest_version);
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

  // 手动执行更新（设置面板「执行更新」按钮，保留兼容）
  window.doUpdate = function (btn) {
    var statusEl = document.getElementById('updateStatus');
    if (btn) { btn.disabled = true; btn.textContent = '下载中...'; }
    fetch('/api/do-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = '执行更新'; }
        if (statusEl) {
          statusEl.textContent = data.success
            ? '正在后台下载新版安装包，完成后自动弹出安装窗口'
            : '更新失败: ' + (data.error || '未知错误');
        }
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.textContent = '执行更新'; }
        if (statusEl) statusEl.textContent = '更新失败: ' + err;
      });
  };

  // 启动轮询：5 秒后开始，每 60 秒一次
  setTimeout(function () {
    pollAutoUpdate();
    setInterval(pollAutoUpdate, 60 * 1000);
  }, 5000);
})();
