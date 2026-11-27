/* zf-applock.js —— App 应用锁前端密码盘（i隐私子能力，策划案 v2）
 * 用法：window.ZFAppLock.gate(appKey, onPass)  —— 已解锁或无需锁则直接 onPass()，否则弹密码盘
 *       window.ZFAppLock.lock(appKey)          —— 🔒 一键锁回
 * Token 在服务端 HttpOnly Cookie，前端不接触 token 本体；TTL 30 分钟由服务端管理。
 */
(function () {
  'use strict';
  var overlay = null, currentApp = null, currentCb = null;

  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'zfAppLockOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(8,10,16,.72);backdrop-filter:blur(4px)';
    overlay.innerHTML =
      '<div style="width:300px;padding:22px 24px;border-radius:16px;background:#141821;color:#e8eaf0;box-shadow:0 12px 48px rgba(0,0,0,.5);text-align:center;font-family:inherit">' +
      '  <div style="font-size:38px;line-height:1;margin-bottom:6px">🔒</div>' +
      '  <div id="zfAlTitle" style="font-size:14px;opacity:.85;margin-bottom:14px">此应用已上锁</div>' +
      '  <div style="display:flex;gap:8px;justify-content:center;margin-bottom:10px">' +
      '    <input id="zfAlPw" type="password" inputmode="numeric" autocomplete="off" placeholder="输入密码" style="width:190px;padding:9px 12px;border-radius:9px;border:1px solid #2c3342;background:#0e1117;color:#e8eaf0;font-size:16px;letter-spacing:4px;text-align:center;outline:none"/>' +
      '  </div>' +
      '  <div id="zfAlMsg" style="min-height:18px;font-size:12px;color:#e5636c;margin-bottom:6px"></div>' +
      '  <div style="display:flex;gap:8px;justify-content:center">' +
      '    <button id="zfAlOk" style="padding:8px 22px;border:0;border-radius:9px;background:#3b7cff;color:#fff;font-size:13px;cursor:pointer">解锁</button>' +
      '    <button id="zfAlCancel" style="padding:8px 18px;border:1px solid #2c3342;border-radius:9px;background:transparent;color:#9aa3b5;font-size:13px;cursor:pointer">取消</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#zfAlOk').addEventListener('click', tryVerify);
    overlay.querySelector('#zfAlPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryVerify(); });
    overlay.querySelector('#zfAlCancel').addEventListener('click', hide);
    return overlay;
  }

  function show(app, cb) {
    currentApp = app; currentCb = cb;
    var el = ensureOverlay();
    el.querySelector('#zfAlMsg').textContent = '';
    el.querySelector('#zfAlPw').value = '';
    el.style.display = 'flex';
    setTimeout(function () { el.querySelector('#zfAlPw').focus(); }, 50);
  }
  function hide() { if (overlay) overlay.style.display = 'none'; }

  function tryVerify() {
    if (!currentApp) return;
    var pw = overlay.querySelector('#zfAlPw').value;
    var msg = overlay.querySelector('#zfAlMsg');
    if (!pw) { msg.textContent = '请输入密码'; return; }
    api('/api/applock/verify', { app: currentApp, pw: pw }).then(function (res) {
      if (res && res.ok) {
        hide();
        try { currentCb && currentCb(); } catch (e) { console.error('[applock]', e); }
      } else if (res && res.err === 'locked') {
        msg.textContent = '错误次数过多，请 ' + Math.ceil((res.retryAfter || 300) / 60) + ' 分钟后再试';
      } else {
        msg.textContent = '密码错误' + (res && res.fails ? ('（已错 ' + res.fails + ' 次，错 5 次锁 5 分钟）') : '');
        overlay.querySelector('#zfAlPw').value = '';
        overlay.querySelector('#zfAlPw').focus();
      }
    }).catch(function () { msg.textContent = '网络异常，请重试'; });
  }

  window.ZFAppLock = {
    /* 打开 app 前的门禁：未设锁→直通；已设锁且 Cookie 有效→直通；否则弹盘 */
    gate: function (app, onPass) {
      api('/api/applock/check?app=' + encodeURIComponent(app)).then(function (res) {
        if (res && res.ok && !res.needUnlock) { onPass(); }
        else if (res && res.wait > 0) {
          alert('该应用因多次密码错误被锁定，请 ' + Math.ceil(res.wait / 60) + ' 分钟后再试');
        } else { show(app, onPass); }
      }).catch(onPass); /* 查询失败不拦人（服务器不可达时前端不该更严） */
    },
    /* 🔒 一键锁回 */
    lock: function (app) { return api('/api/applock/lock', { app: app }); },
    /* 设置密码（首次上锁用） */
    set: function (app, pw, old) { return api('/api/applock/set', { app: app, pw: pw, old: old || '' }); },
    reset: function (app) { return api('/api/applock/reset', { app: app }); }
  };
})();
