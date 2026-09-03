/* ============================================================
 * panel-docs-sync.js — 设置面板「简介/帮助」与 Markdown 文档联动
 * ------------------------------------------------------------
 * 目标：面板内容以 docs/ 下的 MD 文件为唯一维护源，改 MD 即改面板。
 *   - ❓ 帮助面板  ← docs/使用帮助-5.1.0.md（中文）/ docs/使用帮助-EN.md（英文）
 *   - 📖 简介面板  ← docs/软件介绍-5.1.0.md
 * 对外接口：window.DocsSync = { loadHelp, loadIntro }
 * ============================================================ */
(function () {
    'use strict';

    var MD_URLS = {
        help: { zh: 'docs/使用帮助-5.1.0.md', en: 'docs/使用帮助-EN.md' },
        intro: { zh: 'docs/软件介绍-5.1.0.md', en: 'docs/软件介绍-EN.md' }
    };

    var cache = {};   // url -> markdown 文本
    var loaded = { help: false, intro: false };

    function lang() {
        try { return (window.getLang && window.getLang() === 'en') ? 'en' : 'zh'; }
        catch (e) { return 'zh'; }
    }

    function mdRender(text) {
        try {
            if (typeof marked !== 'undefined' && marked.parse) return marked.parse(text);
        } catch (e) { /* fallthrough */ }
        // 极简兜底：按行转义后输出，保证至少能看到原文
        var esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<pre style="white-space:pre-wrap;">' + esc + '</pre>';
    }

    function fetchText(url) {
        if (cache[url]) return Promise.resolve(cache[url]);
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        }).then(function (t) { cache[url] = t; return t; });
    }

    /* ---------- 简介：软件介绍-5.1.0.md ---------- */
    function loadIntro() {
        var panel = document.getElementById('settingsPanel-intro');
        if (!panel) return;
        fetchText(MD_URLS.intro[lang()] || MD_URLS.intro.zh).then(function (md) {
            panel.innerHTML = '<div class="settings-doc-body guide-card guide-card--wide">' + mdRender(md) + '</div>';
            loaded.intro = true;
        }).catch(function (e) {
            console.warn('[DocsSync] 简介加载失败，保留静态内容:', e);
        });
    }

    /* ---------- 帮助：使用帮助.md / -EN ---------- */
    function slugify(text) {
        // GitHub 风格锚点：去 emoji/标点、空格转 -、小写（中文保留）
        return String(text).toLowerCase()
            .replace(/[\u2000-\u206f\u2e00-\u2e7f'!"#$%&()*+,./:;<=>?@[\]^`{|}~\\]/g, '')
            .replace(/\s+/g, '-');
    }

    function enhanceHelpDoc(panel) {
        // 1. 给所有 h2/h3 标题加锚点 id
        var headings = panel.querySelectorAll('h2, h3');
        var toc = [];
        headings.forEach(function (h, i) {
            if (!h.id) h.id = slugify(h.textContent) || ('sec-' + i);
            if (h.tagName === 'H2') toc.push({ id: h.id, text: h.textContent });
        });
        // 2. 自动生成可点击目录，插在第一个 h2 之前（已有「目录」章节则替换其内容）
        var firstH2 = panel.querySelector('h2');
        if (firstH2 && toc.length > 1) {
            var tocHtml = '<div class="help-toc" style="background:var(--bg2,var(--bg,#f5f5f5));border:1px solid var(--border,#ddd);border-radius:8px;padding:12px 18px;margin-bottom:16px;">'
                + '<div style="font-weight:600;margin-bottom:8px;">📑 目录</div>'
                + '<ol style="margin:0;padding-left:20px;">'
                + toc.map(function (t) {
                    return '<li style="margin:4px 0;"><a href="#' + t.id + '" data-toc-jump="' + t.id + '" style="color:var(--primary,#3b82f6);text-decoration:none;cursor:pointer;">' + t.text + '</a></li>';
                }).join('')
                + '</ol></div>';
            // 文档自带的目录章节（第一个 h2 标题就是"目录"）直接替换成可点击版
            if (/目录|contents/i.test(firstH2.textContent)) {
                var html = panel.innerHTML;
                var afterFirstH2 = html.indexOf('</h2>') + 5;
                var nextH2 = panel.querySelectorAll('h2')[1];
                var endIdx = nextH2 ? html.indexOf('<h2', afterFirstH2) : html.length;
                panel.innerHTML = html.slice(0, afterFirstH2) + tocHtml + html.slice(endIdx);
            } else {
                firstH2.insertAdjacentHTML('beforebegin', tocHtml);
            }
        }
        // 3. 所有锚点链接改为面板内平滑滚动（阻止跳转刷新页面）
        panel.addEventListener('click', function (e) {
            var a = e.target.closest('a');
            if (!a) return;
            var href = a.getAttribute('href') || '';
            if (href.charAt(0) === '#') {
                e.preventDefault();
                var target = panel.querySelector('[id="' + href.slice(1).replace(/"/g, '\\"') + '"]');
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    function loadHelp() {
        var panel = document.getElementById('settingsPanel-help');
        if (!panel) return;
        var key = MD_URLS.help[lang()] || MD_URLS.help.zh;
        fetchText(key).then(function (md) {
            panel.innerHTML = '<div class="settings-doc-body guide-card guide-card--wide" style="max-height:calc(80vh - 60px);overflow-y:auto;">' + mdRender(md) + '</div>';
            var body = panel.querySelector('.settings-doc-body');
            if (body) enhanceHelpDoc(body);
            loaded.help = true;
        }).catch(function (e) {
            console.warn('[DocsSync] 帮助加载失败，保留静态内容:', e);
        });
    }

    /* ---------- 切语言时刷新 ---------- */
    var origSetLang = window.setLang;
    window.setLang = function (l) {
        if (typeof origSetLang === 'function') origSetLang(l);
        if (loaded.help) loadHelp();
        if (loaded.intro) loadIntro();
    };

    /* ---------- 切面板时懒加载 ---------- */
    // 注意：本脚本在 panel-settings.js 之前加载，window.App 此时尚未定义。
    // 用"补丁挂载器"：定义时就尝试，失败则在 load 事件后再试一次，确保挂上。
    function patchSwitchTab() {
        if (!window.App || typeof window.App.switchSettingsTab !== 'function') return false;
        if (window.App.__docsSyncPatched) return true;
        var origSwitch = window.App.switchSettingsTab;
        window.App.switchSettingsTab = function (tab) {
            var r = origSwitch.apply(this, arguments);
            if (tab === 'help') loadHelp();
            if (tab === 'intro') loadIntro();
            return r;
        };
        window.App.__docsSyncPatched = true;
        return true;
    }
    if (!patchSwitchTab()) {
        window.addEventListener('load', patchSwitchTab);
        // 兜底：load 后仍未定义（脚本加载顺序异常）则短暂轮询几次
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (patchSwitchTab() || tries > 20) clearInterval(timer);
        }, 250);
    }

    window.DocsSync = { loadHelp: loadHelp, loadIntro: loadIntro };
})();
