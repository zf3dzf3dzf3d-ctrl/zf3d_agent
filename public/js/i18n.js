/* ============================================================
 * i18n.js — 多语言框架 v4（中/英/日/韩/德）
 * - 词典（i18n-data.js）以「中文原文→英文」为基础（CN2EN）
 * - ja/ko/de 提供「中文原文→目标语言」二级词典；未覆盖词条回退英文，再回退中文
 * - scanAll(): 按中文原文自动翻译整个 DOM；MutationObserver 自动翻译新增节点
 * - window.I18N = { t, setLang, getLang, lang, LANGS, scan }
 * ============================================================ */
(function () {
    'use strict';

    const D = (typeof window !== 'undefined' && window.__I18N_DATA) || {};
    const CN2EN = D.CN2EN || {};       /* 中文 → 英文（基础词典） */
    /* 英文补丁：i18n-data-multi.js 的 W 块会把 en 词条回填到 D.en（日/韩/德同理回填 MULTI），
       此处必须合并，否则英文版缺失这部分词条（其他语言正常、唯独英文不生效的根因） */
    (function () { const E = D.en || {}; for (var k in E) if (CN2EN[k] === undefined) CN2EN[k] = E[k]; })();
    const LONG_TIPS = D.LONG_TIPS || {};
    const RULES = D.RULES || [];       /* 中文 → 英文 正则规则 */
    const KEY2EN = D.KEY2EN || {};
    (function () { const E = D.EXTRA || {}; for (var k in E) if (CN2EN[k] === undefined) CN2EN[k] = E[k]; })();
    /* ja/ko/de 二级词典：中文 → 目标语言（由 i18n-data-multi.js 提供） */
    const MULTI = (typeof window !== 'undefined' && window.__I18N_MULTI) || {};
    /* v14: 合入设置面板词典（i18n-data-settings.js 提供的 window.I18N_SETTINGS_PATCH，
       结构为「中文key → {ja/ko/de/...: 译名}」，转换为 MULTI[lang][key] = 译名） */
    (function () { try { const SP = window.I18N_SETTINGS_PATCH || {}; for (const key in SP) { const m = SP[key]; if (!m || typeof m !== 'object') continue; for (const lg in m) { if (!m[lg] || typeof m[lg] !== 'string') continue; MULTI[lg] = MULTI[lg] || {}; if (MULTI[lg][key] === undefined) MULTI[lg][key] = m[lg]; } } } catch (e) { /* ignore */ } })();
    /* 繁体中文词典：简体原文 → 繁体（i18n-data-zht.js） */
    const ZHT = (typeof window !== 'undefined' && window.__I18N_ZHT) || {};

    /* ---------- 反向词典（v14）：译文 → 中文原文，用于还原外语残留 ---------- */
    const REV = {};
    (function () {
        function build(code, map) {
            const r = {};
            for (const zh in map) {
                let v = map[zh];
                if (Array.isArray(v)) v.forEach(function (x) { if (x && typeof x === 'string') r[x.trim()] = zh; });
                else if (v && typeof v === 'string') r[v.trim()] = zh;
            }
            REV[code] = r;
        }
        for (const code in MULTI) build(code, MULTI[code] || {});
        build('en', CN2EN);
        build('zht', ZHT);
    })();
    /* 反查（v15）：文本 → 中文原文；找不到返回 null
       注意：日文含汉字，不能因「含 CJK」就跳过——含汉字的日文残留也要能反查回中文 */
    function revToZh(text) {
        const core = stripEmojiSafe(text).trim();
        if (!core) return null;
        /* 含 CJK 时只查日文/繁体反向表（它们的值含汉字）；纯外语查全部 */
        const codes = hasCJK(core) ? ['ja', 'zht'] : Object.keys(REV);
        for (const code of codes) {
            const zh = REV[code] && REV[code][core];
            if (zh !== undefined) return zh;
        }
        return null;
    }
    function stripEmojiSafe(s) {
        try { return stripEmoji(s); } catch (e) { return s; }
    }

    /* 支持的语言列表（label 为切换按钮显示文字） */
    const LANGS = [
        { code: 'zh', flag: '🇨🇳', label: '中文' },
        { code: 'zht', flag: '🇨🇳', label: '繁體中文' },
        { code: 'en', flag: '🇺🇸', label: 'English' },
        { code: 'ja', flag: '🇯🇵', label: '日本語' },
        { code: 'ko', flag: '🇰🇷', label: '한국어' },
        { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
        { code: 'ar', flag: '🇸🇦', label: 'العربية' },
        { code: 'hi', flag: '🇮🇳', label: 'हिन्दी' },
        { code: 'es', flag: '🇪🇸', label: 'Español' },
        { code: 'fr', flag: '🇫🇷', label: 'Français' },
        { code: 'ru', flag: '🇷🇺', label: 'Русский' }
    ];
    const VALID = LANGS.map(function (l) { return l.code; }).concat(['zht']);

    /* 英文整块翻译表（引导面板）：由 data-enid 匹配 en_guides.js 提供的 window.__EN_HTML */
    const EN_HTML = (typeof window !== 'undefined' && window.__EN_HTML) || {};

    const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|TEXTAREA)$/i;
    const SKIP_SEL = 'script,style,noscript,code,pre,textarea,[contenteditable="true"],[data-no-i18n]';

    let lang = 'zh';
    let observer = null;
    let obsTimer = null;

    function tryRules(s) {
        const v = s.trim();
        for (let i = 0; i < RULES.length; i++) {
            const r = RULES[i];
            if (r[0].test(v)) {
                try { const m = r[0].exec(v); if (m) return r[1](m); } catch (e) { /* ignore */ }
            }
        }
        return null;
    }

    /* ---------- 翻译核心：中文 → 当前语言（多级回退） ---------- */
    function lookup(k) {
        if (lang === 'zh') return null;
        const DICT = (lang === 'zht') ? ZHT : CN2EN;
        const key = String(k).trim();
        if (!key) return null;
        if (LONG_TIPS[key] !== undefined) return LONG_TIPS[key];
        /* 目标语言专属词典优先 */
        const dict = MULTI[lang];
        if (dict && dict[key] !== undefined) return dict[key];
        /* 英文层 */
        if (lang !== 'en') {
            if (CN2EN[key] !== undefined) return CN2EN[key];
            const re = tryRules(key);
            if (re !== null) return re;
            return null; /* 无英文译法则保持中文，不做二次猜测 */
        }
        if (CN2EN[key] !== undefined) return CN2EN[key];
        const r = tryRules(key);
        if (r !== null) return r;
        return null;
    }

    function t(key) {
        if (lang === 'zh') return key;
        if (lang === 'zht') return ZHT[key] !== undefined ? ZHT[key] : key;
        const out = lookup(key);
        return (out !== null && out !== undefined) ? out : key;
    }

    function hasCJK(s) { return /[\u4e00-\u9fff]/.test(s); }

    /* ---------- 文本节点 ---------- */
    function stripEmoji(s) {
        /* 去掉开头的 emoji/符号/图标前缀（含零宽连接符与变体选择符），返回剩余文本 */
        return s.replace(/^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}\uFE0F\u200D\u20E3\ufe0f\s⁉️✅❌⚠️✔✖]+/u, '').trim();
    }
    function translateTextNode(node) {
        const raw = node.nodeValue;
        if (!raw || !raw.trim()) return;
        /* 外语残留（v14/v15）：文本若能反查到中文原文（含日文/繁体等含汉字外语），先记回中文再走正常翻译 */
        {
            const zh = revToZh(raw);
            if (zh !== null) { node.__i18nOrig = zh; node.nodeValue = zh; return; }
        }
        let out = t(raw);
        if (out === raw.trim()) {
            const core = stripEmoji(raw);
            if (core && core !== raw.trim()) {
                const t2 = t(core);
                if (t2 !== core) out = t2;
            }
        }
        if (out !== raw.trim()) {
            node.__i18nOrig = raw;
            node.nodeValue = raw.replace(raw.trim(), out);
        }
    }

    /* ---------- 属性（title / placeholder / data-i18n-attr） ---------- */
    function translateAttrs(el) {
        if (!el || el.nodeType !== 1 || !el.setAttribute) return;
        const saves = el.__i18nAttrSaves || (el.__i18nAttrSaves = {});
        function tr(attr) {
            const cur = el.getAttribute(attr);
            if (cur === null) return;
            const src = saves[attr] !== undefined ? saves[attr] : cur;
            if (!hasCJK(src)) return;
            const out = t(src);
            if (out !== src) { saves[attr] = src; el.setAttribute(attr, out); }
        }
        tr('title');
        tr('placeholder');
        const da = el.getAttribute('data-i18n-attr');
        if (da) {
            try {
                const map = JSON.parse(da);
                for (const a in map) {
                    const en = KEY2EN[map[a]];
                    if (en && el.getAttribute(a) !== null) {
                        if (saves['a_' + a] === undefined) saves['a_' + a] = el.getAttribute(a);
                        el.setAttribute(a, lang === 'en' ? en : t(el.getAttribute(a) || en));
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    /* ---------- 扫描 ---------- */
    function scanElement(root) {
        if (lang === 'zh') return;
        if (root.nodeType === 3) { translateTextNode(root); return; }
        if (root.nodeType !== 1) return;
        if (SKIP.test(root.nodeName)) return;
        /* --- 整块翻译（data-enid → EN_HTML，仅英文模式）--- */
        const _enid = root.getAttribute && root.getAttribute('data-enid');
        if (_enid && EN_HTML[_enid] && lang === 'en') {
            if (root.__i18nBlockOrig === undefined) root.__i18nBlockOrig = root.innerHTML;
            root.innerHTML = EN_HTML[_enid];
            return;
        }
        translateAttrs(root);
        root.querySelectorAll('[title],[placeholder],[data-i18n-attr]').forEach(translateAttrs);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = walker.nextNode())) {
            const pn = n.parentNode;
            if (!pn || SKIP.test(pn.nodeName)) continue;
            if (n.parentElement && n.parentElement.closest(SKIP_SEL)) continue;
            translateTextNode(n);
        }
    }

    function scanAll() {
        scanElement(document.body);
        if (document.querySelectorAll) {
            document.querySelectorAll('[data-enid]').forEach(scanElement);
        }
    }

    /* ---------- 还原中文 ---------- */
    function restoreAll() {
        const els = document.querySelectorAll('*');
        for (let i = 0; i < els.length; i++) {
            const el = els[i], s = el.__i18nAttrSaves;
            if (!s) continue;
            for (const a in s) {
                if (s[a] !== undefined && s[a] !== null) el.setAttribute(a.replace(/^a_/, ''), s[a]);
            }
            el.__i18nAttrSaves = null;
        }
        const _be = document.querySelectorAll('[data-enid]');
        for (let i = 0; i < _be.length; i++) {
            const e = _be[i];
            if (e.__i18nBlockOrig !== undefined) { e.innerHTML = e.__i18nBlockOrig; e.__i18nBlockOrig = undefined; }
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = walker.nextNode())) {
            if (n.__i18nOrig) { n.nodeValue = n.__i18nOrig; n.__i18nOrig = null; }
        }
    }

    /* ---------- MutationObserver：非中文模式下自动翻译新增节点 ---------- */
    function startObserver() {
        if (observer || typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver(function (muts) {
            if (lang === 'zh') return;
            if (obsTimer) clearTimeout(obsTimer);
            obsTimer = setTimeout(function () {
                obsTimer = null;
                for (let i = 0; i < muts.length; i++) {
                    const m = muts[i];
                    if (m.type !== 'childList' && m.type !== 'characterData') continue;
                    for (let j = 0; j < m.addedNodes.length; j++) {
                        if (m.type === 'characterData') { try { translateTextNode(m.target); } catch (e) {} } else { try { scanElement(m.addedNodes[j]); } catch (e) { /* ignore */ } }
                    }
                }
            }, 60);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function stopObserver() {
        if (observer) { observer.disconnect(); observer = null; }
        if (obsTimer) { clearTimeout(obsTimer); obsTimer = null; }
    }

    /* ---------- 切换按钮（顶栏，循环切换 5 种语言） ---------- */
    function updateToggle() {
        const b = document.getElementById('languageToggle');
        if (!b) return;
        buildLangMenu(b);
        renderLangBtn(b);
        try { document.documentElement.lang = lang; } catch (e) { /* ignore */ }
        /* --- 标签页标题跟随语言（v10） --- */
        try {
            if (!document.title) return;
            if (!document.__i18nTitleZh) document.__i18nTitleZh = document.title;
            if (lang === 'zh') {
                document.title = document.__i18nTitleZh;
            } else {
                const _t = t(document.__i18nTitleZh);
                if (_t && _t !== document.__i18nTitleZh) document.title = _t;
            }
        } catch (e) { /* ignore */ }
    }

    /* ---------- 国旗下拉菜单（v10：点击直接选择、热切换） ---------- */
    function buildLangMenu(b) {
        if (b.__i18nMenuBuilt) return;
        b.__i18nMenuBuilt = true;
        b.removeAttribute('onchange');
        if (b.tagName === 'SELECT') { b.style.display = 'none'; return; } /* select 内无法放 div */
        b.innerHTML = '<span class="i18n-cur"></span><span class="i18n-arrow">▾</span><div class="i18n-menu" data-no-i18n></div>';
        const menu = b.querySelector('.i18n-menu');
        if (!menu) return; /* 保护：菜单容器不存在时直接返回 */
        LANGS.forEach(l => {
            const item = document.createElement('div');
            item.className = 'i18n-item';
            item.setAttribute('data-code', l.code);
            item.innerHTML = '<i class="i18n-flag f-' + l.code + '" aria-hidden="true"></i><span class="i18n-name">' + l.label + '</span>';
            item.addEventListener('click', function (ev) {
                ev.stopPropagation();
                menu.classList.remove('open');
                setLang(l.code);   /* 点击即热切换，全页文字跟随 */
            });
            menu.appendChild(item);
        });
        b.addEventListener('click', function (ev) {
            ev.stopPropagation();
            const m = b.querySelector('.i18n-menu');
            m.classList.toggle('open');
        });
        document.addEventListener('click', function () {
            const m = b.querySelector('.i18n-menu');
            if (m) m.classList.remove('open');
        });
    }

    function renderLangBtn(b) {
        const cur = LANGS.find(l => l.code === lang) || LANGS[0];
        const ic = b.querySelector('.i18n-cur');
        if (ic) ic.innerHTML = '<i class="i18n-flag f-' + cur.code + '" aria-hidden="true"></i>';
        b.title = '当前语言：' + cur.label + '（点击切换）';
        const menu = b.querySelector('.i18n-menu');
        if (menu) {
            menu.querySelectorAll('.i18n-item').forEach(it => {
                it.classList.toggle('active', it.getAttribute('data-code') === lang);
            });
        }
    }

function nextLang() {
        const i = LANGS.findIndex(l => l.code === lang);
        return LANGS[(i + 1) % LANGS.length];
    }

    /* ---------- 对外接口 ---------- */
    function setLang(l) {
        lang = VALID.indexOf(l) >= 0 ? l : 'zh';
        try { localStorage.setItem('appLang', lang); } catch (e) { /* ignore */ }
        try { UserSettings.set('appLang', lang); } catch (e) { /* ignore */ }
        stopObserver(); restoreAll();
        if (lang !== 'zh') { scanAll(); startObserver(); }
        updateToggle();
        try { document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: lang } })); } catch (e) { /* ignore */ }
    }

    function getLang() { return lang; }

    window.I18N = { t: t, setLang: setLang, getLang: getLang, lang: lang, LANGS: LANGS, scan: scanAll };
    window.setLang = setLang;
    window.getLang = getLang;

    function init() {
        var saved = null;
        try { saved = localStorage.getItem('appLang'); } catch (e) { /* ignore */ }
        if (!saved && typeof UserSettings !== 'undefined' && UserSettings.get) {
            try { saved = UserSettings.get('appLang'); } catch (e) { /* ignore */ }
        }
        if (VALID.indexOf(saved) >= 0) {
            lang = saved;
        } else {
            /* 首次打开：跟随系统语言自动设置 */
            var nav = (typeof navigator !== 'undefined' && navigator.language) || '';
            var sysLang = null;
            if (/^zh/i.test(nav)) sysLang = 'zh';
            else if (/^ja/i.test(nav)) sysLang = 'ja';
            else if (/^ko/i.test(nav)) sysLang = 'ko';
            else if (/^de/i.test(nav)) sysLang = 'de';
            else if (/^[a-z]{2}([-_]|$)/i.test(nav)) sysLang = 'en'; /* 其他语言 → 英文 */
            if (VALID.indexOf(sysLang) >= 0) lang = sysLang;
        }
        updateToggle();
        if (lang !== 'zh') { scanAll(); startObserver(); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
