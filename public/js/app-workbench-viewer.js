/* ============================================================
 * app-workbench-viewer.js —— 工作台「文件」面板：多标签文本/代码/Markdown 查看编辑
 * - md 用 marked 渲染；代码用 highlight.js（VSCode Dark+ 配色，见 highlight-theme.min.css）
 * - 复用后端 /api/fs/text（读）与 /api/fs/text-save（写，GBK 兼容）
 * - 挂在工作台抽屉 data-wbwork="files" 面板内，多文件标签切换
 * ============================================================ */
(function () {
    'use strict';
    if (window.WBFileViewer) return;

    var MAX_TABS = 10;
    var LANG_MAP = {
        js: 'javascript', mjs: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'javascript',
        py: 'python', html: 'xml', htm: 'xml', vue: 'xml', xml: 'xml', svg: 'xml',
        css: 'css', scss: 'scss', less: 'less', json: 'json', md: 'markdown', markdown: 'markdown',
        sh: 'bash', bat: 'bat', cmd: 'bat', ps1: 'powershell', yml: 'yaml', yaml: 'yaml',
        java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go',
        rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql', lua: 'lua', ini: 'ini', toml: 'ini',
        txt: 'plaintext', log: 'plaintext'
    };
    var tabs = [];          // {path, name, text, orig, dirty, mode: 'view'|'edit'}
    var activePath = null;
    var rootBuilt = false, tabBar, content;
    // 【对话独立】每个对话各自维护文件标签状态，切换对话互不串台
    var convStore = {};     // cid -> {tabs, activePath}
    var curCid = null;
    function curConvId() {
        try { if (window.Tools && Tools.currentChatId) return 'c:' + Tools.currentChatId; } catch (e) {}
        try { if (window.App && App.curSlot) return 's:' + App.curSlot; } catch (e) {}
        return 'default';
    }
    function ensureConv() {
        var cid = curConvId();
        if (cid === curCid) return;
        if (curCid !== null) convStore[curCid] = { tabs: tabs, activePath: activePath };
        var st = convStore[cid];
        if (!st) { st = { tabs: [], activePath: null }; convStore[cid] = st; }
        curCid = cid;
        tabs = st.tabs; activePath = st.activePath;
        rootBuilt = false;   // 重建面板 DOM，渲染本对话自己的标签
        buildRoot();
    }
    // 切到「📝 文本」页签时检查对话是否已切换（防串台）
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest && e.target.closest('.wb-tab[data-wbtab="files"]');
        if (b) ensureConv();
    }, true);

    function esq(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
    function isMd(name) { return ext(name) === 'md' || ext(name) === 'markdown'; }

    function drawerEl() { return document.querySelector('.wb-drawer'); }
    function paneEl() {
        var d = drawerEl(); if (!d) return null;
        return d.querySelector('.wb-workbench[data-wbwork="files"]');
    }
    function activateFilesTab() {
        var d = drawerEl(); if (!d) return;
        var btn = d.querySelector('.wb-tab[data-wbtab="files"]');
        if (btn && !btn.classList.contains('active')) btn.click();
    }

    function buildRoot() {
        if (rootBuilt) return;
        var pane = paneEl(); if (!pane) return;
        pane.innerHTML = '';
        pane.style.cssText = 'display:none;flex-direction:column;height:100%;min-height:0;background:#1e1e1e';
        tabBar = document.createElement('div');
        tabBar.className = 'wfv-tabbar';
        content = document.createElement('div');
        content.className = 'wfv-content';
        var empty = document.createElement('div');
        empty.className = 'wfv-empty';
        empty.innerHTML = '📄 在左侧文件树中双击 md / 代码 / 文本文件，即在此打开标签<br>支持 Markdown 渲染与代码高亮（VSCode Dark+）';
        content.appendChild(empty);
        pane.appendChild(tabBar);
        pane.appendChild(content);
        rootBuilt = true;
    }

    function renderTabBar() {
        tabBar.innerHTML = '';
        tabs.forEach(function (t) {
            var b = document.createElement('div');
            b.className = 'wfv-tab' + (t.path === activePath ? ' active' : '');
            b.title = t.path;
            var icon = isMd(t.name) ? '📝' : '📄';
            b.innerHTML = '<span class="wfv-tab-ico">' + icon + '</span><span class="wfv-tab-name">' + esq(t.name) +
                (t.dirty ? '<i class="wfv-dot" title="未保存">●</i>' : '') +
                '</span><span class="wfv-tab-close" title="关闭">×</span>';
            b.querySelector('.wfv-tab-close').addEventListener('click', function (e) { e.stopPropagation(); closeTab(t.path); });
            b.addEventListener('click', function () { activePath = t.path; renderTabBar(); renderContent(); });
            tabBar.appendChild(b);
        });
    }

    function findTab(p) { for (var i = 0; i < tabs.length; i++) if (tabs[i].path === p) return tabs[i]; return null; }

    function closeTab(p) {
        var t = findTab(p); if (!t) return;
        if (t.dirty && !window.confirm('「' + t.name + '」有未保存修改，确定关闭？')) return;
        tabs.splice(tabs.indexOf(t), 1);
        if (activePath === p) activePath = tabs.length ? tabs[tabs.length - 1].path : null;
        renderTabBar(); renderContent();
    }

    function sanitizeMd(container) {
        container.querySelectorAll('script,iframe,object,embed,form').forEach(function (n) { n.remove(); });
        container.querySelectorAll('*').forEach(function (n) {
            Array.prototype.slice.call(n.attributes).forEach(function (a) {
                if (/^on/i.test(a.name) || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
            });
        });
    }

    function renderContent() {
        Array.prototype.forEach.call(content.childNodes, function (n) { if (!n.classList || !n.classList.contains('wfv-empty')) n.remove(); });
        var empty = content.querySelector('.wfv-empty');
        if (empty) empty.style.display = tabs.length ? 'none' : '';
        var t = findTab(activePath);
        if (!t) return;
        var view = document.createElement('div');
        view.className = 'wfv-view';
        view.dataset.wfvpath = t.path;
        // 工具栏
        var bar = document.createElement('div');
        bar.className = 'wfv-toolbar';
        var modeBtn = document.createElement('button');
        modeBtn.className = 'wfv-btn';
        if (isMd(t.name)) modeBtn.textContent = t.mode === 'edit' ? '📖 预览' : '✏️ 编辑源码';
        else modeBtn.textContent = t.mode === 'edit' ? '👁 高亮预览' : '✏️ 编辑';
        modeBtn.addEventListener('click', function () { t.mode = t.mode === 'edit' ? 'view' : 'edit'; renderContent(); });
        var status = document.createElement('span');
        status.className = 'wfv-status';
        if (t.dirty) { status.textContent = '● 未保存'; status.style.color = '#e2c08d'; }
        var saveBtn = document.createElement('button');
        saveBtn.className = 'wfv-btn wfv-save';
        saveBtn.textContent = '💾 保存 (Ctrl+S)';
        saveBtn.addEventListener('click', function () { doSave(t); });
        bar.appendChild(modeBtn); bar.appendChild(status); bar.appendChild(saveBtn);
        view.appendChild(bar);
        // 内容区
        var body = document.createElement('div');
        body.className = 'wfv-body';
        if (t.mode === 'edit') {
            var ta = document.createElement('textarea');
            ta.className = 'wfv-editor';
            ta.value = t.text; ta.spellcheck = false; ta.wrap = 'off';
            ta.addEventListener('input', function () {
                t.text = ta.value;
                var d = t.text !== t.orig;
                if (d !== t.dirty) { t.dirty = d; renderTabBar(); status.textContent = d ? '● 未保存' : ''; status.style.color = d ? '#e2c08d' : ''; }
            });
            ta.addEventListener('keydown', function (e) {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    var s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
                    ta.value = v.slice(0, s) + '    ' + v.slice(en);
                    ta.selectionStart = ta.selectionEnd = s + 4;
                    ta.dispatchEvent(new Event('input'));
                }
            });
            body.appendChild(ta);
            setTimeout(function () { ta.focus(); }, 30);
        } else if (isMd(t.name) && window.marked) {
            var md = document.createElement('div');
            md.className = 'wfv-markdown';
            try { md.innerHTML = window.marked.parse ? window.marked.parse(t.text) : window.marked(t.text); }
            catch (e) { md.textContent = t.text; }
            sanitizeMd(md);
            body.appendChild(md);
        } else {
            var pre = document.createElement('pre');
            pre.className = 'wfv-code hljs';
            var code = document.createElement('code');
            var lang = LANG_MAP[ext(t.name)];
            var ok = false;
            try {
                if (window.hljs && lang && window.hljs.getLanguage(lang)) {
                    code.innerHTML = window.hljs.highlight(t.text, { language: lang, ignoreIllegals: true }).value;
                    ok = true;
                } else if (window.hljs) {
                    var r = window.hljs.highlightAuto(t.text);
                    code.innerHTML = r.value; ok = true;
                }
            } catch (e) { ok = false; }
            if (!ok) code.textContent = t.text;
            pre.appendChild(code);
            body.appendChild(pre);
        }
        view.appendChild(body);
        content.appendChild(view);
    }

    function doSave(t) {
        if (!t) return;
        fetch('/api/fs/text-save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: t.path, text: t.text })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) {
                t.orig = t.text; t.dirty = false;
                renderTabBar(); renderContent();
                if (window.ToastStack && ToastStack.show) ToastStack.show('已保存: ' + t.name, 'ok');
                try { document.dispatchEvent(new CustomEvent('fttextsaved', { detail: { path: t.path } })); } catch (e) {}
            } else if (window.ToastStack && ToastStack.show) ToastStack.show('保存失败: ' + ((d && d.error) || ''), 'error');
        }).catch(function (err) {
            if (window.ToastStack && ToastStack.show) ToastStack.show('保存失败: ' + err.message, 'error');
        });
    }

    // Ctrl+S：当「文件」面板处于激活且当前标签有改动时保存
    document.addEventListener('keydown', function (e) {
        if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) return;
        var pane = paneEl();
        if (!pane || !pane.classList.contains('active')) return;
        var t = findTab(activePath);
        if (t && t.dirty) { e.preventDefault(); doSave(t); }
    });

    function open(path, name) {
        var pane = paneEl();
        if (!pane) return false;   // 抽屉未就绪，调用方回退旧预览
        ensureConv();
        buildRoot();
        var exist = findTab(path);
        if (exist) { activePath = path; renderTabBar(); renderContent(); }
        else {
            if (tabs.length >= MAX_TABS) {
                if (window.ToastStack && ToastStack.show) ToastStack.show('最多同时打开 ' + MAX_TABS + ' 个文件标签', 'info');
                return true;
            }
            fetch('/api/fs/text?path=' + encodeURIComponent(path)).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (j) {
                var text = (j && j.text) || '';
                tabs.push({
                    path: (j && j.path) || path,
                    name: name || (String(path).split(/[\\/]/).pop() || path),
                    text: text, orig: text, dirty: false,
                    mode: isMd(name) ? 'view' : 'view'
                });
                activePath = tabs[tabs.length - 1].path;
                renderTabBar(); renderContent();
            }).catch(function (err) {
                if (window.ToastStack && ToastStack.show) ToastStack.show('无法打开文件: ' + err.message, 'error');
            });
        }
        activateFilesTab();
        return true;
    }

    window.WBFileViewer = { open: open };
})();
