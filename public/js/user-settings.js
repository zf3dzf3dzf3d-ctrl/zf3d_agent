/* 用户设置统一存储（文件版）
   - 所有用户设置（面板宽高、位置、模型选择、表情等）保存到
     private/用户设置/user_settings.json（通过后端 /api/user-settings）
   - localStorage 仅作为快速缓存：启动时同步读取缓存保证 UI 秒开，
     同时异步从服务器加载真实值覆盖；写入时双写（文件 + localStorage 缓存）。
   - 用户迁移：拷贝 private/用户设置/ 文件夹即可。 */
(function () {
  'use strict';
  if (window.UserSettings) return;

  var LS_MIRROR = 'zf3d_user_settings_mirror'; // localStorage 缓存镜像
  var cache = null;          // 当前设置对象（含所有 key）
  var serverLoadPromise = null;
  var pendingWrites = {};    // 待合并写入服务器的 key
  var writeTimer = null;
  var preferencesCache = null;
  var preferencesLoadPromise = null;
  var preferencesPending = {};
  var preferencesWriteTimer = null;

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_MIRROR) || '{}') || {}; } catch (e) { return {}; }
  }
  function lsWrite(obj) {
    try { localStorage.setItem(LS_MIRROR, JSON.stringify(obj)); } catch (e) {}
  }

  cache = lsRead();
  window.UserSettings = {
    /* 同步读取（优先 localStorage 缓存，服务器异步到达后自动覆盖） */
    get: function (key, defVal) {
      if (key in cache && cache[key] !== null && cache[key] !== undefined) return cache[key];
      return defVal;
    },
    /* 写入（内存 + localStorage 缓存 + 防抖合并写服务器 JSON 文件） */
    set: function (key, value) {
      cache[key] = value;
      lsWrite(cache);
      pendingWrites[key] = value;
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(flushToServer, 400);
    },
    remove: function (key) {
      delete cache[key];
      lsWrite(cache);
      pendingWrites[key] = null; // null 表示删除
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(flushToServer, 400);
    },
    /* 异步从服务器加载真实设置（页面启动时调用一次） */
    loadFromServer: function () {
      if (serverLoadPromise) return serverLoadPromise;
      serverLoadPromise = fetch('/api/user-settings', { method: 'GET' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.ok && data.settings && typeof data.settings === 'object') {
            // 服务器为准覆盖缓存
            cache = data.settings;
            lsWrite(cache);
            // 通知页面：设置已从服务器刷新（面板等可监听刷新自身显示）
            try { window.dispatchEvent(new CustomEvent('user-settings-refreshed')); } catch (e) {}
          }
          return cache;
        })
        .catch(function () { return cache; });
      return serverLoadPromise;
    },
    /* 立即把待写内容推送到服务器 */
    flushNow: flushToServer,
    loadPreferences: function () {
      if (preferencesLoadPromise) return preferencesLoadPromise;
      preferencesLoadPromise = fetch('/api/user-preferences', { method: 'GET' }).then(function (r) {
        if (!r.ok) throw new Error('Unable to load user preferences: HTTP ' + r.status);
        return r.json();
      }).then(function (data) {
        if (data && data.ok && data.preferences) preferencesCache = data.preferences;
        return preferencesCache || {};
      }).catch(function () { return preferencesCache || {}; });
      return preferencesLoadPromise;
    },
    getDefaultChatBoxSize: function () {
      var p = preferencesCache && preferencesCache.defaultChatBoxSize;
      if (p && Number(p.width) >= 280 && Number(p.height) >= 200) return { w: Number(p.width), h: Number(p.height) };
      return null;
    },
    getChatCompressionModes: function (chatId) {
      var p = preferencesCache || {}, d = p.defaultCompressionModes || {}, c = p.chatCompressionModes && p.chatCompressionModes[String(chatId)];
      return { toolResults: (c && c.toolResults) || d.toolResults || 'minimal', historyAnswers: (c && c.historyAnswers) || d.historyAnswers || 'minimal' };
    },
    setChatPreferences: function (chatId, size, modes) {
      preferencesCache = preferencesCache || {};
      var changes = {};
      if (size) { preferencesCache.defaultChatBoxSize = { width: Math.round(size.w), height: Math.round(size.h) }; changes.defaultChatBoxSize = preferencesCache.defaultChatBoxSize; }
      if (modes) {
        preferencesCache.defaultCompressionModes = Object.assign({}, preferencesCache.defaultCompressionModes || {}, modes);
        changes.defaultCompressionModes = preferencesCache.defaultCompressionModes;
        if (chatId) {
          preferencesCache.chatCompressionModes = preferencesCache.chatCompressionModes || {};
          preferencesCache.chatCompressionModes[String(chatId)] = Object.assign({}, preferencesCache.chatCompressionModes[String(chatId)] || {}, modes);
          changes.chatCompressionModes = preferencesCache.chatCompressionModes;
        }
      }
      Object.keys(changes).forEach(function (k) { preferencesPending[k] = changes[k]; });
      if (preferencesWriteTimer) clearTimeout(preferencesWriteTimer);
      preferencesWriteTimer = setTimeout(flushPreferences, 400);
    }
  };

  function flushPreferences() {
    var payload = preferencesPending; preferencesPending = {};
    if (!Object.keys(payload).length) return Promise.resolve();
    return fetch('/api/user-preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: payload }) })
      .then(function (r) {
        if (!r.ok) throw new Error('Unable to save user preferences: HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) throw new Error('Unable to save user preferences');
        if (data.preferences) preferencesCache = data.preferences;
      })
      .catch(function () { Object.keys(payload).forEach(function (k) { preferencesPending[k] = payload[k]; }); });
  }

  function flushToServer() {
    var payload = pendingWrites;
    pendingWrites = {};
    var keys = Object.keys(payload);
    if (!keys.length) return Promise.resolve();
    return fetch('/api/user-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: payload })
    }).catch(function () {
      // 失败回滚到待写队列，下次再试
      keys.forEach(function (k) { pendingWrites[k] = payload[k]; });
    });
  }

  // 页面卸载前尽力同步（发送保持型请求）
  window.addEventListener('beforeunload', function () {
    if (Object.keys(pendingWrites).length) {
      try {
        navigator.sendBeacon && navigator.sendBeacon(
          '/api/user-settings',
          new Blob([JSON.stringify({ changes: pendingWrites })], { type: 'application/json' })
        );
      } catch (e) {}
    }
  });

  // 启动时异步加载服务器设置（覆盖 localStorage 缓存）
  UserSettings.loadPreferences();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { UserSettings.loadFromServer(); });
  } else {
    UserSettings.loadFromServer();
  }
})();
