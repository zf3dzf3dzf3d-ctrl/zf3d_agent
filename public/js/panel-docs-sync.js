/* ============================================================
 * panel-docs-sync.js — 设置面板「简介/帮助/版本更新」与 Markdown 文档联动
 * ------------------------------------------------------------
 * 目标：面板内容以 docs/ 下的 MD 文件为唯一维护源，改 MD 即改面板。
 *   - 📖 简介面板  ← docs/01-介绍.md
 *   - ❓ 帮助面板  ← docs/02-帮助.md
 *   - 🕓 版本更新：按用户要求不再注入「关于」面板（保持关于简洁），
 *     loadVersion 函数保留，docs/03-版本更新内容.md 仍由后端 docs 接口可查。
 * 路径真源：启动时向 GET /api/appdocs 拉取后端扫描 docs/ 目录的结果并覆盖
 *   内置默认路径（DEFAULT_URLS 仅作后端不可达/文件缺失时的兜底），因此
 *   升版本或改文档文件名只需动 docs/ 目录，前端零改码。
 * 刷新语义：内容缓存在内存，MD 文件改动后刷新页面即生效（无后台轮询）。
 * 对外接口：window.DocsSync = { loadHelp, loadIntro, loadVersion, refreshUrls }
 * ============================================================ */
(function () {
    'use strict';

    // 内置兜底路径（后端 /api/appdocs 不可达、或其返回的文件 404 时使用）
    var DEFAULT_URLS = {
        intro: { zh: 'docs/01-介绍.md' },
        help: { zh: 'docs/02-帮助.md' },
        version: { zh: 'docs/03-版本更新内容.md' }
    };
    // 当前生效路径：初始 = 兜底，ensureUrls() 成功后被后端结果覆盖
    var MD_URLS = {
        intro: { zh: DEFAULT_URLS.intro.zh },
        help: { zh: DEFAULT_URLS.help.zh },
        version: { zh: DEFAULT_URLS.version.zh }
    };

    var cache = {};   // url -> markdown 文本
    var loaded = { help: false, intro: false, version: false };
    var urlsPromise = null;

    function lang() {
        try { return (window.getLang && window.getLang() === 'en') ? 'en' : 'zh'; }
        catch (e) { return 'zh'; }
    }

    /* ---------- 动态路径：/api/appdocs ---------- */
    // 后端 mixin_docs.get_appdocs 扫描 docs/*.md，按「01-介绍 / 02-帮助 /
    // 03-版本更新内容」及旧版命名（软件介绍/使用帮助/历史版本）归类，
    // 返回 {ok, version, intro:{zh,en}, help:{zh,en}, history}。
    function applyApiUrls(d) {
        if (!d || d.ok === false) return false;
        var hit = false;
        if (d.intro) {
            if (d.intro.zh) { MD_URLS.intro.zh = d.intro.zh; hit = true; }
            if (d.intro.en) MD_URLS.intro.en = d.intro.en;
        }
        if (d.help) {
            if (d.help.zh) { MD_URLS.help.zh = d.help.zh; hit = true; }
            if (d.help.en) MD_URLS.help.en = d.help.en;
        }
        if (d.history) { MD_URLS.version.zh = d.history; hit = true; }
        return hit;
    }

    function ensureUrls(force) {
        if (urlsPromise && !force) return urlsPromise;
        urlsPromise = fetch('/api/appdocs', { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (d) {
            if (applyApiUrls(d)) {
                console.log('[DocsSync] 文档路径来自 /api/appdocs:', d.version, MD_URLS);
            } else {
                console.warn('[DocsSync] /api/appdocs 返回无有效映射，沿用内置默认路径:', d);
            }
            return MD_URLS;
        }).catch(function (e) {
            console.warn('[DocsSync] /api/appdocs 不可达，沿用内置默认路径:', e);
            urlsPromise = null; // 允许下次重试
            return MD_URLS;
        });
        return urlsPromise;
    }

    function mdRender(text) {
        // 统一渲染层 ZFMD：表格空行修复/带圈序号拆行/### 标题修复/*** ** * 全套强调 + 内置兜底解析
        if (typeof ZFMD !== 'undefined') return ZFMD.render(text, { wrap: 'zfmd' });
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

    // 动态路径指向的文件若 404（后端扫到了但静态服务取不到等异常），回退内置默认路径
    function fetchDoc(group, fallbackGroup) {
        var l = lang();
        var url = MD_URLS[group][l] || MD_URLS[group].zh;
        var fb = (fallbackGroup || group);
        var fbUrl = DEFAULT_URLS[fb][l] || DEFAULT_URLS[fb].zh;
        return ensureUrls().then(function () {
            return fetchText(url).catch(function (e) {
                if (fbUrl && fbUrl !== url) {
                    console.warn('[DocsSync] ' + url + ' 加载失败，回退 ' + fbUrl, e);
                    return fetchText(fbUrl);
                }
                throw e;
            });
        });
    }

    /* ---------- 简介：01-介绍.md ---------- */
    function loadIntro() {
        var panel = document.getElementById('settingsPanel-intro');
        if (!panel) return;
        fetchDoc('intro').then(function (md) {
            panel.innerHTML = '<div class="settings-doc-body guide-card guide-card--wide">' + mdRender(md) + '</div>';
            loaded.intro = true;
        }).catch(function (e) {
            console.warn('[DocsSync] 简介加载失败，保留静态内容:', e);
        });
    }

    /* ---------- 帮助：02-帮助.md ---------- */
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
        // 2. 自动生成可点击目录，插在第一个 h2 之前
        var firstH2 = panel.querySelector('h2');
        if (firstH2 && toc.length > 1) {
            var tocHtml = '<div class="help-toc" style="background:var(--bg2,var(--bg,#f5f5f5));border:1px solid var(--border,#ddd);border-radius:8px;padding:12px 18px;margin-bottom:16px;">'
                + '<div style="font-weight:600;margin-bottom:8px;">📑 目录</div>'
                + '<ol style="margin:0;padding-left:20px;">'
                + toc.map(function (t) {
                    return '<li style="margin:4px 0;"><a href="#' + t.id + '" data-toc-jump="' + t.id + '" style="color:var(--primary,#3b82f6);text-decoration:none;cursor:pointer;">' + t.text + '</a></li>';
                }).join('')
                + '</ol></div>';
            firstH2.insertAdjacentHTML('beforebegin', tocHtml);
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
        fetchDoc('help').then(function (md) {
            panel.innerHTML = '<div class="settings-doc-body guide-card guide-card--wide" style="max-height:calc(80vh - 60px);overflow-y:auto;">' + mdRender(md) + '</div>';
            var body = panel.querySelector('.settings-doc-body');
            if (body) enhanceHelpDoc(body);
            loaded.help = true;
        }).catch(function (e) {
            console.warn('[DocsSync] 帮助加载失败，保留静态内容:', e);
        });
    }

    /* ---------- 版本更新：03-版本更新内容.md → 关于面板 ---------- */
    function loadVersion() {
        var panel = document.getElementById('settingsPanel-about');
        if (!panel) return;
        // 已有动态区块则整体替换（不重复堆积），否则插到面板首个 h3 之后
        var box = document.getElementById('settingsVersionBox');
        var render = function (md) {
            var html = '<div id="settingsVersionBox" class="settings-doc-body guide-card guide-card--wide" style="margin-bottom:20px;">'
                + '<h3 style="margin-top:0;">🕓 版本更新</h3>' + mdRender(md) + '</div>';
            var cur = document.getElementById('settingsVersionBox') || box;
            if (cur && cur.parentNode) {
                cur.outerHTML = html;
            } else {
                var firstH3 = panel.querySelector('h3');
                if (firstH3) firstH3.insertAdjacentHTML('afterend', html);
                else panel.insertAdjacentHTML('afterbegin', html);
            }
            loaded.version = true;
        };
        fetchDoc('version').then(render).catch(function (e) {
            console.warn('[DocsSync] 版本更新加载失败，保留静态内容:', e);
        });
    }

    /* ---------- 切语言时刷新 ---------- */
    var origSetLang = window.setLang;
    window.setLang = function (l) {
        if (typeof origSetLang === 'function') origSetLang(l);
        if (loaded.help) loadHelp();
        if (loaded.intro) loadIntro();
        if (loaded.version) loadVersion();
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
            // 关于面板不再注入「版本更新」长文（用户要求关于里保持简洁）。
            // loadVersion 仍保留，需要时把上一行的注释恢复即可。
            // if (tab === 'about') loadVersion();
            return r;
        };
        window.App.__docsSyncPatched = true;
        return true;
    }
    if (!patchSwitchTab()) {
        window.addEventListener('load', patchSwitchTab);
        // 兜底：load 后仍未定义（脚本加载顺序异常）则短暂轮询几次（仅用于挂补丁，
        // 不是文档刷新轮询）
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (patchSwitchTab() || tries > 20) clearInterval(timer);
        }, 250);
    }

    // 提前拉一次路径映射，避免首次切面板时的等待
    ensureUrls();

    window.DocsSync = { loadHelp: loadHelp, loadIntro: loadIntro, loadVersion: loadVersion, refreshUrls: function () { return ensureUrls(true); } };
})();
