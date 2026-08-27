// app-version.js - 统一从 /api/version 读取版本号，填充所有占位
// 占位元素：#pageVersion(已不需要，title 由 document.title 覆盖) / #statusbarVersion / #helpCurrentVersion / #heroVersion
(function(){
  function applyVersion(v){
    if (!v) return;
    try {
      // document.title 末尾追加版本号（页面初始 title 已包含 "朱峰社区智能体无限"，重复时去重）
      var base = document.title.replace(/\s*\d+\.\d+\.\d+.*$/, '').replace(/朱峰社区智能体无限\s*$/, '朱峰社区智能体无限');
      document.title = (base || '朱峰社区智能体无限') + ' ' + v;
    } catch(e) {}
    var ids = ['statusbarVersion', 'helpCurrentVersion', 'heroVersion'];
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    });
    // 暴露给其他模块
    window.APP_VERSION = v;
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
