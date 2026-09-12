/* ============================================================
 * i18n.js — 中英文双语框架（v3 大词典版）
 * - CN2EN 词典 + scanAll(): 按中文原文自动翻译整个 DOM
 *   覆盖设置面板静态 HTML 与对话框/顶栏动态生成的文案
 * - RULES 正则层：翻译动态拼接文案（如"消息已排队 (N 条)"）
 * - 英文模式下 MutationObserver 监听新增节点自动翻译
 * - 切中文时通过 _orig 缓存恢复原文
 * - window.I18N = { t, setLang, lang, scan }
 * ============================================================ */
(function () {
    'use strict';

    /* ---------- 中→英 词典（UI 文案） ---------- */
    /* ---------- 数据（由 i18n-data.js 提供，须先于本文件加载） ---------- */
    const D=(typeof window!=='undefined'&&window.__I18N_DATA)||{};
    const CN2EN=D.CN2EN||{};
    const LONG_TIPS=D.LONG_TIPS||{};
    const RULES=D.RULES||[];
    const KEY2EN=D.KEY2EN||{};
    (function(){const E=D.EXTRA||{};for(var k in E)if(CN2EN[k]===undefined)CN2EN[k]=E[k];})();


    /* 英文整块翻译表（引导面板）：由 data-enid 匹配 en_guides.js 提供的 window.__EN_HTML */
    const EN_HTML = (typeof window !== 'undefined' && window.__EN_HTML) || {};

    /* 不参与翻译的标签名（SCRIPT/STYLE/NOSCRIPT/CODE/PRE/TEXTAREA）与选择器 */
    const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|TEXTAREA)$/i;
    const SKIP_SEL = 'script,style,noscript,code,pre,textarea,[contenteditable="true"],[data-no-i18n]';

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

    function t(key) {
        if (lang === 'en') {
            const k = String(key).trim();
            if (!k) return key;
            if (LONG_TIPS[k] !== undefined) return LONG_TIPS[k];
            if (CN2EN[k] !== undefined) return CN2EN[k];
            const r = tryRules(k);
            if (r !== null) return r;
        }
        return key;
    }

    function hasCJK(s) { return /[\u4e00-\u9fff]/.test(s); }

    /* ---------- 文本节点 ---------- */
    function translateTextNode(node) {
        const raw = node.nodeValue;
        if (!raw || !raw.trim() || !hasCJK(raw)) return;
        const out = t(raw);
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
                        el.setAttribute(a, en);
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    /* ---------- 扫描 ---------- */
    function scanElement(root) {
        if (lang !== 'en') return;
        if (root.nodeType === 3) { translateTextNode(root); return; }
        if (root.nodeType !== 1) return;
        if (typeof SKIP === 'undefined' || !SKIP.test(root.nodeName)) return;
        /* --- 整块翻译（data-enid → EN_HTML）--- */
        const _enid = root.getAttribute && root.getAttribute('data-enid');
        if (_enid && EN_HTML[_enid]) {
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
            if (!pn || (typeof SKIP !== 'undefined' && SKIP.test(pn.nodeName))) continue;
            if (n.parentElement && n.parentElement.closest(SKIP_SEL)) continue;
            translateTextNode(n);
        }
    }

    function scanAll() {
        scanElement(document.body);
        /* 额外扫描带 data-enid 的整块翻译元素（如引导面板），每个作为独立 root 触发整块替换 */
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
        /* --- 还原整块内容 --- */
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

    /* ---------- MutationObserver：英文模式下自动翻译新增节点 ---------- */
    function startObserver() {
        if (observer || typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver(function (muts) {
            if (lang !== 'en') return;
            if (obsTimer) clearTimeout(obsTimer);
            obsTimer = setTimeout(function () {
                obsTimer = null;
                for (let i = 0; i < muts.length; i++) {
                    const m = muts[i];
                    if (m.type !== 'childList') continue;
                    for (let j = 0; j < m.addedNodes.length; j++) {
                        try { scanElement(m.addedNodes[j]); } catch (e) { /* ignore */ }
                    }
                }
            }, 60);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: false });
    }

    function stopObserver() {
        if (observer) { observer.disconnect(); observer = null; }
        if (obsTimer) { clearTimeout(obsTimer); obsTimer = null; }
    }

    /* ---------- 状态 ---------- */
    let lang = 'zh';
    let observer = null;
    let obsTimer = null;

    /* ---------- 切换按钮 ---------- */
    function updateToggle() {
        const b = document.getElementById('languageToggle');
        if (!b) return;
        b.textContent = lang === 'en' ? '中' : 'EN';
        b.title = lang === 'en' ? 'Switch to Chinese' : '切换语言';
    }

    /* ---------- 对外接口 ---------- */
    function setLang(l) {
        lang = (l === 'en') ? 'en' : 'zh';
        try { localStorage.setItem('appLang', lang); } catch (e) { /* ignore */ }
        try { UserSettings.set('appLang', lang); } catch (e) { /* ignore */ }
        if (lang === 'en') { scanAll(); startObserver(); }
        else { stopObserver(); restoreAll(); }
        updateToggle();
    }

    function getLang() { return lang; }

    window.I18N = { t: t, setLang: setLang, getLang: getLang, scan: scanAll };
    window.setLang = setLang;
    window.getLang = getLang;

    function init() {
        updateToggle();
        if (lang === 'en') { scanAll(); startObserver(); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();