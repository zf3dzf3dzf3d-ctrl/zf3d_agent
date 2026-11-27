// app-version.js - 统一从 /api/version 读取版本号，填充所有占位
// 占位元素：#pageVersion(已不需要，title 由 document.title 覆盖) / #statusbarVersion / #helpCurrentVersion / #heroVersion
// #settingsVersionBadge（左侧导航版本徽标）已于 2026-11-13 停用：设置面板左上留白治理，见 settings-toggles.css S6 段
(function(){
  function applyVersion(v){
    if (!v) return;
    try {
      // document.title 末尾追加版本号（页面初始 title 已包含 "朱峰智能体无限"，重复时去重）
      var base = document.title.replace(/\s*\d+\.\d+\.\d+.*$/, '').replace(/朱峰智能体无限\s*$/, '朱峰智能体无限');
      document.title = (base || 'i无限') + ' ' + v;
    } catch(e) {}
    var ids = ['helpCurrentVersion', 'heroVersion', 'statusbarVersion'];
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    });
    // 暴露给其他模块
    window.APP_VERSION = v;
    // 2026-11-13 S6 左上留白治理：不再往左侧导航注入版本徽标（版本号仍见状态栏 / 关于页）
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
