/* B1 前端 ui-mounts 装载器（2026-11-17）
 * 职责：GET /api/plugin-manager/ui-mounts 拉取已启用插件的 UI 挂载声明，
 *       按 slot 注入 assets（script/css）到对应挂载点；插件被 disable 时后端
 *       ui_mounts 即不含该插件声明，刷新页面即卸载（真插件化消费端）。
 * 约定：assets 为相对路径数组，经 /plugins-ui/ 静态通道下发（mixin_static.py 分支）。
 * 安全：不 eval 任何返回内容，只按声明注入 <script>/<link>；加载失败不阻塞主页面。
 */
(function () {
  'use strict';
  var SLOT_PREFIX = 'zfPluginUiSlot-';      // 按 slot 分容器（body 末尾），防多插件同 slot 叠置顺序不可控
  var loaded = {};                          // 去重表：url -> 1

  function ensureContainer(slot) {
    var id = SLOT_PREFIX + String(slot || 'default').replace(/[^a-z0-9_-]/gi, '');
    var box = document.getElementById(id);
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      box.style.display = 'none';
      document.body.appendChild(box);
    }
    return box;
  }

  function injectAssets(mounts) {
    (mounts || []).forEach(function (m) {
      var box = ensureContainer(m.slot);
      if (!/^[a-z0-9._-]+$/i.test(String(m.plugin || ''))) return; // 插件id白名单校验，防越界url
      (m.assets || []).forEach(function (asset) {
        var url = '/plugins-ui/' + m.plugin + '/' + String(asset).replace(/^\/+/, '');
        if (loaded[url]) return;
        loaded[url] = 1;
        if (/\.css(\?|$)/.test(url)) {
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = url;
          box.appendChild(link);
        } else if (/\.js(\?|$)/.test(url)) {
          var s = document.createElement('script');
          s.src = url;
          s.async = false;
          s.onerror = function () { console.warn('[ui-mounts] 资源加载失败:', url); };
          box.appendChild(s);
        }
      });
    });
  }

  function boot() {
    fetch('/api/plugin-manager/ui-mounts')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.ui_mounts)) injectAssets(d.ui_mounts);
      })
      .catch(function (e) {
        console.debug('[ui-mounts] 声明拉取跳过（插件管理不可用或非本机）:', e);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
