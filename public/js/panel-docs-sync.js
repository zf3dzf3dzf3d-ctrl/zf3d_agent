/* ============================================================
 * panel-docs-sync.js — 设置面板「简介/帮助」与 Markdown 文档联动
 * ------------------------------------------------------------
 * 目标：面板内容以 docs/ 下的 MD 文件为唯一维护源，改 MD 即改面板。
 *   - ❓ 帮助面板  ← docs/使用帮助.md（中文）/ docs/使用帮助-EN.md（英文）
 *   - 📖 简介面板  ← docs/软件介绍.md；🕓 版本历史 ← docs/历史版本对照.md
 * 对外接口：window.DocsSync = { loadHelp, loadIntro }
 * ============================================================ */
(function () {
    'use strict';

    var MD_URLS = {
        help: { zh: 'docs/使用帮助.md' },   // 硬编码兜底，正常由 /api/appdocs 动态覆盖
        intro: { zh: 'docs/软件介绍.md' },
        history: { zh: 'docs/历史版本对照.md' }   // 硬编码兜底，正常由 /api/appdocs 动态覆盖
    };

    // 启动时拉取动态映射（升版本只需改 version.json + 放新 MD，零改码）
    (function loadDocsMap() {
        fetch('/api/appdocs', { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (d) {
            if (!d || !d.ok) return;
            if (d.help && d.help.zh) MD_URLS.help = d.help;
            if (d.intro && d.intro.zh) MD_URLS.intro = d.intro;
            if (d.history) MD_URLS.history = (typeof d.history === 'string') ? { zh: d.history } : d.history;
        }).catch(function (e) {
            console.warn('[DocsSync] /api/appdocs 拉取失败，使用内置兜底 URL:', e);
        });
    })();

    var cache = {};   // url -> markdown 文本
    var loaded = { help: false, intro: false, history: false };

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

    function fetchText(url, fallbackUrl) {
        if (cache[url]) return Promise.resolve(cache[url]);
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        }).then(function (t) { cache[url] = t; return t; })
        .catch(function (e) {
            if (fallbackUrl && fallbackUrl !== url) {
                if (cache[fallbackUrl]) return cache[fallbackUrl];
                return fetch(fallbackUrl, { cache: 'no-cache' }).then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.text();
                }).then(function (t) { cache[url] = t; return t; });
            }
            throw e;
        });
    }

    /* ---------- 简介：软件介绍-5.1.2.md ---------- */
    function loadIntro() {
        var panel = document.getElementById('settingsPanel-intro');
        if (!panel) return;
        fetchText(MD_URLS.intro[lang()] || MD_URLS.intro.zh, MD_URLS.intro.zh).then(function (md) {
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
        fetchText(key, MD_URLS.help.zh).then(function (md) {
            panel.innerHTML = '<div class="settings-doc-body guide-card guide-card--wide" style="max-height:calc(80vh - 60px);overflow-y:auto;">' + mdRender(md) + '</div>';
            var body = panel.querySelector('.settings-doc-body');
            if (body) enhanceHelpDoc(body);
            loaded.help = true;
        }).catch(function (e) {
            console.warn('[DocsSync] 帮助加载失败，保留静态内容:', e);
        });
    }

    /* ---------- 版本历史：历史版本对照.md ---------- */
    function loadHistory() {
        var panel = document.getElementById('settingsPanel-history');
        if (!panel || !MD_URLS.history) return;
        fetchText(MD_URLS.history[lang()] || MD_URLS.history.zh, MD_URLS.history.zh).then(function (md) {
            panel.innerHTML = '<div class="settings-doc-body guide-card guide-card--wide" style="max-height:calc(80vh - 60px);overflow-y:auto;">' + mdRender(md) + '</div>';
            loaded.history = true;
        }).catch(function (e) {
            console.warn('[DocsSync] 版本历史加载失败:', e);
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
            if (tab === 'history') loadHistory();
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

    window.DocsSync = { loadHelp: loadHelp, loadIntro: loadIntro, loadHistory: loadHistory };

    /* ---------- 动态注入「🕓 版本历史」导航项 + 内容面板 ----------
       不改 dom-settings-panel.js 的模板字符串，运行时注入，避免转义问题；
       版本历史 Tab 恒可见（history 恒有兜底值）。 */
    function injectHistoryTab() {
        var nav = document.querySelector('.settings-nav-item[data-settings-tab="history"]');
        if (!MD_URLS.history) return false;
        var panel = document.getElementById('settingsPanel-history');
        if (nav && panel) return true;
        // 1) 注入导航项（插在「帮助」项之后）
        if (!nav) {
            var helpNav = document.querySelector('.settings-nav-item[data-settings-tab="help"]');
            if (helpNav) {
                nav = document.createElement('div');
                nav.className = 'settings-nav-item';
                nav.setAttribute('data-settings-tab', 'history');
                nav.setAttribute('onclick', "App.switchSettingsTab('history')");
                nav.innerHTML = '<span class="settings-nav-icon">🕓</span><span>版本历史</span>';
                helpNav.parentNode.insertBefore(nav, helpNav.nextSibling);
            }
        }
        // 2) 注入内容面板（与 help 面板同级）
        if (!panel) {
            var helpPanel = document.getElementById('settingsPanel-help');
            if (helpPanel) {
                panel = document.createElement('div');
                panel.id = 'settingsPanel-history';
                panel.className = helpPanel.className || 'settings-panel settings-panel--guide';
                // 注意：不能写内联 style.display='none'——settings-toggles.css 用 .active 类控制显隐，
                // 内联 display:none 优先级更高，会导致切到「版本历史」时面板永远显示不出来（历史 bug 根因）。
                // .settings-panel 默认即 display:none，无需内联隐藏。
                panel.innerHTML = '<h3>🕓 版本历史</h3><p class="guide-lead">加载中…</p>';
                helpPanel.parentNode.insertBefore(panel, helpPanel.nextSibling);
            }
        }
        return !!(nav && panel);
    }
    // 面板是动态弹出的：轮询 + MutationObserver 双保险，面板何时挂载都能注入
    (function pollInject() {
        if (injectHistoryTab()) return;
        var tries = 0;
        var t = setInterval(function () {
            tries++;
            if (injectHistoryTab() || tries > 40) clearInterval(t);
        }, 500);
        // 兜底：设置面板可能在页面加载很久之后才动态创建，用 MutationObserver 监听
        try {
            var mo = new MutationObserver(function () {
                if (injectHistoryTab()) mo.disconnect();
            });
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (e) { /* 老浏览器忽略 */ }
    })();

})();
