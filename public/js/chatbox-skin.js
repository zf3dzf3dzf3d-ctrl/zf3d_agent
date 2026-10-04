/* ============================================================
 * chatbox-skin.js — 对话框整体风格皮肤切换
 *
 * 10 种风格：默认 / 纸片 paper / 金属 metal / 卡通 cartoon / 酷炫 cool / 极简 minimal / 朴素 plain / 液体 liquid / 科幻 scifi / 玻璃 glass / 霓虹 neon / 木质 wood / 终端 terminal / 像素复古 retro / 折纸 origami / 皮革 leather / 冰晶 ice
 * 颜色不变，只改整体风格（形状/阴影/纹理/描边）。
 * 切换按钮挂在 chatbox-header-row1，选择持久化到 localStorage。
 * ============================================================ */
(function () {
    'use strict';

    var SKINS = [
        { id: '', name: '默认', ico: '◻' },
        { id: 'paper', name: '纸片', ico: '📄' },
        { id: 'metal', name: '金属', ico: '⚙' },
        { id: 'cartoon', name: '卡通', ico: '🎈' },
        { id: 'minimal', name: '极简', ico: '─' },
        { id: 'scifi', name: '科幻', ico: '🛸' },
        { id: 'glass', name: '玻璃', ico: '🧊' },
        { id: 'neon', name: '霓虹', ico: '🌟' },
        { id: 'ice', name: '冰晶', ico: '❄' },
        { id: 'candy', name: '甜蜜', ico: '🍬' },
        { id: 'forest', name: '森系', ico: '🌲' },
    ];
    var KEY = 'zf_chatbox_skin';

    function getSkin() {
        try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
    }

    function applySkin(id) {
        if (id) document.body.setAttribute('data-skin', id);
        else document.body.removeAttribute('data-skin');
        /* 阶段2: data-skin 下沉——同步挂到每个角色框，全局面板不再经过 body 皮肤 */
        document.querySelectorAll('.chatbox').forEach(function (bx) {
            if (id) bx.setAttribute('data-skin', id); else bx.removeAttribute('data-skin');
        });
        try { localStorage.setItem(KEY, id || ''); } catch (e) {}
    }

    function buildMenuHtml() {
        var cur = getSkin();
        var html = '<div class="skin-menu" style="position:absolute;top:100%;right:0;margin-top:6px;z-index:9999;' +
            'background:var(--bg-card,#1e1e2e);border:1px solid var(--border,#444);border-radius:8px;' +
            'padding:6px;display:none;flex-direction:column;gap:2px;min-width:110px;box-shadow:0 8px 24px rgba(0,0,0,.5)">';
        SKINS.forEach(function (s) {
            var sel = s.id === cur;
            html += '<button class="skin-opt" data-skin="' + s.id + '" style="display:flex;align-items:center;gap:8px;' +
                'padding:6px 10px;border:none;border-radius:5px;background:' + (sel ? 'var(--border,#333)' : 'transparent') + ';' +
                'color:var(--text,#ddd);font-size:12px;cursor:pointer;text-align:left;white-space:nowrap">' +
                '<span>' + s.ico + '</span><span>' + s.name + (sel ? ' ✓' : '') + '</span></button>';
        });
        html += '</div>';
        return html;
    }

    function refreshMenus() {
        // 重建所有已打开面板里的菜单 HTML（保持选中态），保持关闭状态
        document.querySelectorAll('.skin-wrap').forEach(function (wrap) {
            var old = wrap.querySelector('.skin-menu');
            var wasOpen = old && old.style.display === 'flex';
            old && old.remove();
            wrap.querySelector('.skin-btn').insertAdjacentHTML('afterend', buildMenuHtml());
            var menu = wrap.querySelector('.skin-menu');
            if (wasOpen) menu.style.display = 'flex';
        });
    }

        function attach(header) {
        // 头部不再注入风格按钮，风格入口统一在主题设置面板
        document.querySelectorAll('.skin-wrap').forEach(function (w) { w.remove(); });
    }

function inject() {
        applySkin(getSkin()); // 应用已保存的皮肤
        document.querySelectorAll('.chatbox-header').forEach(attach);

        // 对话框是动态创建的，监听 DOM 变化持续挂按钮
        // [性能修复] 原实现监听 body 整个子树且每次回调都 querySelectorAll，
        // 聊天流式输出时每秒触发几十次，造成大量 Forced reflow（日志 46ms 重排 / 长任务）。
        // 改为：rAF 节流 + 只监听新增节点（childList 不含 characterData 场景已由 childList 覆盖），
        // 并且仅当新增节点包含/是 .chatbox-header 时才处理。
        var _moPending = false;
        var mo = new MutationObserver(function (muts) {
            if (_moPending) return;
            // 快速过滤：本次变更里若没有任何新增元素节点则直接跳过
            var hasAdded = false;
            for (var i = 0; i < muts.length; i++) {
                if (muts[i].addedNodes.length) { hasAdded = true; break; }
            }
            if (!hasAdded) return;
            _moPending = true;
            requestAnimationFrame(function () {
                _moPending = false;
                var headers = document.querySelectorAll('.chatbox-header:not([data-skin-attached])');
                if (!headers.length) return;
                headers.forEach(function (h) { h.setAttribute('data-skin-attached', '1'); attach(h); });
            });
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    function renderPanelGrid() {
        var grid = document.getElementById('skinGrid');
        if (!grid || grid.dataset.done) return;
        grid.dataset.done = '1';
        SKINS.forEach(function (s) {
            var b = document.createElement('button');
            b.className = 'bg-mode-btn';
            b.textContent = s.ico + ' ' + s.name;
            b.title = '对话框风格: ' + s.name;
            b.onclick = function () {
                applySkin(s.id);
                grid.querySelectorAll('.bg-mode-btn').forEach(function (x) { x.style.outline = ''; });
                b.style.outline = '2px solid var(--accent,#0984e3)';
            };
            grid.appendChild(b);
        });
        // 初始选中态
        var cur = getSkin();
        SKINS.forEach(function (s, i) {
            if (s.id === cur && grid.children[i]) grid.children[i].style.outline = '2px solid var(--accent,#0984e3)';
        });
    }

    var pit = setInterval(function () {
        renderPanelGrid();
        var g = document.getElementById('skinGrid');
        if (g && g.dataset.done) clearInterval(pit);
    }, 500);

    window.ChatboxSkin = {
        list: SKINS,
        get: getSkin,
        set: function (id) { applySkin(id); renderPanelGrid(); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();
