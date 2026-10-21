// app-version.js - 统一从 /api/version 读取版本号，填充所有占位
// 占位元素：#pageVersion(已不需要，title 由 document.title 覆盖) / #statusbarVersion / #helpCurrentVersion / #heroVersion / #settingsVersionBadge
// 【新增】设置弹窗左侧导航头部常驻版本徽标：用户打开"设置"即可看到当前版本号，无需切到"关于"页
(function(){
  function applyVersion(v){
    if (!v) return;
    try {
      // document.title 末尾追加版本号（页面初始 title 已包含 "朱峰智能体无限"，重复时去重）
      var base = document.title.replace(/\s*\d+\.\d+\.\d+.*$/, '').replace(/朱峰智能体无限\s*$/, '朱峰智能体无限');
      document.title = (base || '朱峰智能体无限') + ' ' + v;
    } catch(e) {}
    var ids = ['helpCurrentVersion', 'heroVersion', 'statusbarVersion'];
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    });
    // 暴露给其他模块
    window.APP_VERSION = v;
    // 设置面板导航头部注入版本徽标（弹窗 DOM 可能尚未就绪，带重试）
    ensureSettingsBadge(v);
  }

  // 在 .settings-nav-header（"⚙️ 设置"）后追加一行常驻版本徽标
  function ensureSettingsBadge(v){
    var tries = 0;
    function once(){
      tries++;
      try {
        var header = document.querySelector('.settings-nav-header');
        if (!header) {
          if (tries < 10) setTimeout(once, 400); // 弹窗 DOM 还没注入，稍后重试
          return;
        }
        var badge = document.getElementById('settingsVersionBadge');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'settingsVersionBadge';
          badge.style.cssText = 'font-size:11px;color:var(--text2,#888);padding:2px 12px 8px 12px;letter-spacing:.3px;';
          // 插到 header 之后、导航项之前
          if (header.nextSibling) header.parentNode.insertBefore(badge, header.nextSibling);
          else header.parentNode.appendChild(badge);
        }
        badge.textContent = 'v' + v;
        badge.title = '当前版本 ' + v;
      } catch(e) { /* 静默 */ }
    }
    once();
  }

  function fetchVersion(){
    try {
      fetch('/api/version', { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if (j && j.ok && j.version) applyVersion(j.version); })
        .catch(function(){});
    } catch(e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchVersion);
  } else {
    fetchVersion();
  }
})();
