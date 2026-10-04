/* ============================================================
   storage-guard.js —— 全局 localStorage 禁用守卫（必须最早加载）
   ------------------------------------------------------------
   规则：本项目永远禁用 localStorage 写入。
   - 劫持 window.localStorage，所有代码对其的读写自动重定向到
     服务器 JSON 配置文件 private/用户设置/user_settings.json
     （/api/user-settings 接口，键自动加 "ls:" 前缀）。
   - 启动时：同步拉取服务器 JSON 到内存；一次性把旧 localStorage
     里的历史数据迁移到服务器后清除（只读不写）。
   - 写入：仅内存 + 防抖合并提交服务器 JSON，绝不写回 localStorage。
   - 之后任何新代码调用 localStorage 都自动落 JSON，无需改造。
   ============================================================ */
(function () {
  'use strict';
  if (window.__ZF_STORAGE_GUARD__) return;

  var PREFIX = 'ls:';
  /* EPHEMERAL_KEYS: 临时/可再生数据，直接写真 localStorage，不上服务器 JSON（防膨胀+提速） */
  var EPHEMERAL = /^(undo_ledger_|toolmaster_pending|zf_model_latency_v1)/;
  var realLS = null;
  try { realLS = window.localStorage; } catch (e) { realLS = null; }

  var mem = {};            // 内存主存（不含前缀）
  var dirty = {};          // 待提交变更
  var flushTimer = null;
  var serverReady = false;

  /* ---------- 服务器同步 ---------- */
  function serverGetSync() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/user-settings', false); // 同步，保证后续代码可立即读到
      xhr.send(null);
      if (xhr.status === 200) {
        var d = JSON.parse(xhr.responseText || '{}');
        var s = (d && d.settings) || {};
        delete s['zf3d_user_settings_mirror']; /* 屏蔽自我膨胀的镜像键 */
        return s;
      }
    } catch (e) {}
    return {};
  }

  function flushNow() {
    if (!Object.keys(dirty).length) return;
    var changes = dirty;
    dirty = {};
    var payload = {};
    Object.keys(changes).forEach(function (k) {
      payload[PREFIX + k] = changes[k]; // null 表示删除
    });
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/user-settings', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ changes: payload }));
    } catch (e) {
      // 提交失败则放回待写队列，下次再试
      Object.keys(payload).forEach(function (k) {
        var key = k.slice(PREFIX.length);
        dirty[key] = payload[k];
      });
    }
  }

  function markDirty(key, val) {
    dirty[key] = val;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushNow, 500);
  }

  /* ---------- 启动：拉服务器 + 迁移旧 localStorage ---------- */
  var serverData = serverGetSync();
  Object.keys(serverData).forEach(function (k) {
    if (k.indexOf(PREFIX) === 0) {
      var nk = k.slice(PREFIX.length);
      if (EPHEMERAL.test(nk)) {
        /* 临时键：优先真 localStorage 的值，同时从服务器 JSON 删除 */
        if (realLS) { try { var lv = realLS.getItem(nk); if (lv != null) mem[nk] = lv; } catch (e1) {} }
        if (nk in mem && realLS) { try { realLS.setItem(nk, mem[nk]); } catch (e1b) {} }
        markDirty(nk, null); /* null = 从服务器删除 */
      } else {
        mem[nk] = serverData[k];
      }
    }
  });

  if (realLS) {
    try {
      for (var i = 0; i < realLS.length; i++) {
        var lk = realLS.key(i);
        if (lk == null) continue;
        if (lk === 'zf3d_user_settings_mirror') continue; // UserSettings 自身镜像，弃用
        if (!(lk in mem)) {
          try { mem[lk] = realLS.getItem(lk); } catch (e2) {}
          markDirty(lk, mem[lk]); // 迁移到服务器 JSON
        }
      }
      // 旧数据已迁移，清空真实 localStorage（只删不写）
      try { realLS.clear(); } catch (e3) {}
    } catch (e) {}
  }
  serverReady = true;
  setTimeout(flushNow, 50);

  /* ---------- 伪造 localStorage 实现 ---------- */
  var guard = {
    getItem: function (key) {
      key = String(key);
      return (key in mem) ? mem[key] : null;
    },
    setItem: function (key, value) {
      key = String(key);
      if (key === 'zf3d_user_settings_mirror') return; /* MIRROR_BLOCK: discard writes */
      mem[key] = String(value);
      if (EPHEMERAL.test(key)) { if (realLS) { try { realLS.setItem(key, mem[key]); } catch (eE) {} } return; } /* EPHEMERAL: 只留浏览器 */
      markDirty(key, mem[key]);
    },
    removeItem: function (key) {
      key = String(key);
      if (key === 'zf3d_user_settings_mirror') return;
      delete mem[key];
      if (EPHEMERAL.test(key)) { if (realLS) { try { realLS.removeItem(key); } catch (eE2) {} } return; } /* EPHEMERAL */
      markDirty(key, null);
    },
    clear: function () {
      Object.keys(mem).forEach(function (k) { markDirty(k, null); });
      mem = {};
    },
    key: function (i) {
      var ks = Object.keys(mem);
      return (i >= 0 && i < ks.length) ? ks[i] : null;
    },
    get length() { return Object.keys(mem).length; }
  };

  /* ---------- 劫持并锁死 window.localStorage ---------- */
  try {
    Object.defineProperty(window, 'localStorage', {
      get: function () { return guard; },
      set: function () { /* 禁止覆盖 */ },
      configurable: false
    });
  } catch (e) {
    window.localStorage = guard; // 旧浏览器兜底
  }
  // sessionStorage 同理禁用（重定向到内存，仅会话级，不落盘）
  try {
    var sesMem = {};
    var sesGuard = {
      getItem: function (k) { k = String(k); return (k in sesMem) ? sesMem[k] : null; },
      setItem: function (k, v) { sesMem[String(k)] = String(v); },
      removeItem: function (k) { delete sesMem[String(k)]; },
      clear: function () { sesMem = {}; },
      key: function (i) { var ks = Object.keys(sesMem); return (i >= 0 && i < ks.length) ? ks[i] : null; },
      get length() { return Object.keys(sesMem).length; }
    };
    Object.defineProperty(window, 'sessionStorage', {
      get: function () { return sesGuard; },
      set: function () {},
      configurable: false
    });
  } catch (e) {}

  window.__ZF_STORAGE_GUARD__ = true;

  // 页面卸载前把未提交的变更同步发出
  window.addEventListener('beforeunload', function () {
    if (!Object.keys(dirty).length) return;
    try {
      var payload = {};
      Object.keys(dirty).forEach(function (k) { payload[PREFIX + k] = dirty[k]; });
      navigator.sendBeacon && navigator.sendBeacon(
        '/api/user-settings',
        new Blob([JSON.stringify({ changes: payload })], { type: 'application/json' })
      );
    } catch (e) {}
  });
})();
