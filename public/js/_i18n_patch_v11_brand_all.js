
/* ---- v11 patch: 品牌名「朱峰智能体无限」全语言统一命名 ----
 * 中文=朱峰智能体无限；其他语言=各自国家的官方译名（英文 ZF3D AGENT）
 * 覆盖所有品牌键变体：旧键「朱峰社区无限/朱峰社区智能体」、新键「朱峰智能体无限/朱峰社区智能体无限」、
 * 以及带版本号的标题键（如「朱峰社区无限 5.2.5」），保证切换任意语言顶栏/标题都显示对应国家名称。
 * 本文件须在 i18n-data-multi.js 之后、i18n.js 之前加载。
 */
(function () {
  try {
    var G = (typeof window !== 'undefined') ? window : globalThis;

    /* 各语言品牌名（label: 语言代码 -> 本国文字名称） */
    var BRAND = {
      zh:  '朱峰智能体无限',
      zht: '朱峰智能體無限',
      en:  'ZF3D AGENT',
      ja:  'ZF3Dエージェント',
      ko:  'ZF3D 에이전트',
      de:  'ZF3D Agent',
      ar:  'وكيل ZF3D',
      hi:  'ZF3D एजेंट',
      es:  'Agente ZF3D',
      fr:  'Agent ZF3D',
      ru:  'ZF3D Агент'
    };

    /* 需要覆盖的品牌键（含历史键与带版本号标题键） */
    var keys = [
      '朱峰社区无限', '朱峰社区智能体', '朱峰智能体无限', '朱峰社区智能体无限',
      '朱峰社区无限 5.2.5', '朱峰智能体无限 5.2.5',
      '朱峰社区无限 5.3.0', '朱峰智能体无限 5.3.0', '朱峰社区智能体无限 5.3.0',
      '朱峰社区无限 5.4.5', '朱峰智能体无限 5.4.5', '朱峰社区智能体无限 5.4.5'
    ];

    /* 1) 写入多语言词典 __I18N_MULTI（ja/ko/de/ar/hi/es/fr/ru/en 运行时优先查这里） */
    var M = G.__I18N_MULTI || (G.__I18N_MULTI = {});
    ['ja', 'ko', 'de', 'ar', 'hi', 'es', 'fr', 'ru', 'en'].forEach(function (lg) {
      if (!M[lg]) M[lg] = {};
      keys.forEach(function (k) { M[lg][k] = BRAND[lg]; });
    });

    /* 2) 写入英文主词典 __I18N_DATA.en + CN2EN（en 语言查这里；其他语言回退英文层） */
    var D = G.__I18N_DATA;
    if (D) {
      if (!D.en) D.en = {};
      if (!D.CN2EN) D.CN2EN = {};
      keys.forEach(function (k) { D.en[k] = BRAND.en; D.CN2EN[k] = BRAND.en; });
      /* 3) 繁体（ZHT 若已挂载则同步） */
      if (D.ZHT) { keys.forEach(function (k) { D.ZHT[k] = BRAND.zht; }); }
    }

    /* 4) KEY2EN.brand（data-i18n-attr 里 brand 键的英文显示） */
    if (D && D.KEY2EN) D.KEY2EN.brand = BRAND.en;

    /* 5) document.title 动态兜底：任何「品牌名+任意版本号」形式的标题，
     *    即使词典静态键未覆盖（未来新版本号），也实时替换为当前语言的品牌名。
     *    监听 <title> 变化（i18n.js 切语言 / app-version.js 追加版本号均会触发）。 */
    var curLang = 'zh';
    function brandFor(lg) { return BRAND[lg] || BRAND.en; }
    function applyTitle() {
      try {
        var t = document.title || '';
        if (!t) return;
        if (curLang === 'zh' || curLang === 'zht') return; /* 中文标题保持原样 */
        var b = brandFor(curLang);
        /* 命中「品牌开头 + 可选版本号/空白」则整体替换为该国品牌名（保留版本号尾巴） */
        var m = t.match(/^\s*(?:朱峰社区智能体无限|朱峰智能体无限|朱峰社区无限|朱峰社区智能体)\s*([\d.]+.*)?$/);
        if (m) document.title = b + (m[1] ? ' ' + m[1].trim() : '');
      } catch (e) {}
    }
    try {
      /* 跟随 i18n 当前语言：监听 html lang 属性 + 语言切换事件 */
      function syncLang() {
        try {
          var lg = (document.documentElement.getAttribute('lang') || '').toLowerCase();
          if (lg && BRAND[lg.split('-')[0]]) curLang = lg.split('-')[0];
        } catch (e) {}
      }
      document.addEventListener('DOMContentLoaded', function () {
        syncLang(); applyTitle();
      });
      window.addEventListener('zf-lang-change', function (e) {
        try { if (e && e.detail && e.detail.lang && BRAND[e.detail.lang]) curLang = e.detail.lang; } catch (er) {}
        applyTitle();
      });
      var mo = new MutationObserver(function () { syncLang(); applyTitle(); });
      var el = document.documentElement;
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['lang'] });
      var tEl = document.querySelector('title');
      if (tEl) mo.observe(tEl, { childList: true, characterData: true, subtree: true });
    } catch (e) { console.warn('i18n brand v11 title hook err', e); }
  } catch (e) { console.warn('i18n brand v11 patch err', e); }
})();
