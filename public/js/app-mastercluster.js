// ========== app-mastercluster.js - 🧙 大师集群（下拉集合） ==========
// 功能：把原对话框头部第一排的 4 个大师图标收进一个下拉按钮：
//   📊 日志大师 / 🧠 上下文大师 / 🧙 工具大师 / 🎓 导师点评
// 位置：header 第一排 · 关闭 ✕ 按钮左侧。旧独立图标自动移除、注入函数转为空操作。
(function () {
    'use strict';

    var ITEMS = [
        { icon: '📊', label: '日志大师', cls: 'mc-logmaster', title: '打包日志统计+全部错误日志发送给 AI，检查有没有问题/bug 并优化' },
        { icon: '🧠', label: '上下文大师', cls: 'mc-contextmaster', title: '把最后一次发送给 AI 的完整上下文发给 AI，找出不合理/bug 的地方并修复' },
        { icon: '🧙', label: '工具大师', cls: 'mc-toolmaster', title: '打包本对话全部工具结果/统计/上下文占用/错误，发送到新对话进行 bug 分析' },
        { icon: '🎓', label: '导师点评', cls: 'mc-mentor', title: '把本对话全部内容发给新对话的导师 AI 评论任务处理情况、找 bug' }
    ];

    // ---------- 下拉菜单显隐 ----------
    function closeAllMenus(except) {
        document.querySelectorAll('.mc-menu').forEach(function (m) {
            if (m !== except) { m.style.display = 'none'; }
        });
    }

    // 滚动/窗口变化时关闭所有菜单（fixed 定位不跟随 header）
    window.addEventListener('resize', function () { closeAllMenus(null); });
    window.addEventListener('scroll', function () { closeAllMenus(null); }, true);

    document.addEventListener('click', function (e) {
        if (!e.target.closest || (!e.target.closest('.mc-toggle') && !e.target.closest('.mc-menu'))) {
            closeAllMenus(null);
        }
    }, true);

    function buildMenu(box, btn) {
        var menu = document.createElement('div');
        menu.className = 'mc-menu';
        menu.style.display = 'none';
        menu.style.cssText += ';position:absolute;z-index:99999;min-width:190px;background:#1e2430;border:1px solid #3a4356;' +
            'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:4px;font-size:13px;color:#dfe5ef;';

        ITEMS.forEach(function (it) {
            var item = document.createElement('div');
            item.className = 'mc-item ' + it.cls;
            item.textContent = it.icon + ' ' + it.label;
            item.title = it.title;
            item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;';
            item.addEventListener('mouseenter', function () { item.style.background = '#2c3444'; });
            item.addEventListener('mouseleave', function () { item.style.background = 'transparent'; });
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                closeAllMenus(null);
                try {
                    if (it.cls === 'mc-logmaster') App.logMaster(box);
                    else if (it.cls === 'mc-contextmaster') App.contextMaster(box);
                    else if (it.cls === 'mc-toolmaster') App.toolMaster(box);
                    else if (it.cls === 'mc-mentor') {
                        var chat = (App.chatBoxes || []).find(function (c) { return c && c.el === box; });
                        if (chat && typeof App._mentorReviewChat === 'function') App._mentorReviewChat(chat);
                        else if (App._logMasterToast) App._logMasterToast('未找到该对话，无法发起导师点评');
                    }
                } catch (err) {
                    console.error('[MasterCluster]', err);
                }
            });
            menu.appendChild(item);
        });
        return menu;
    }

    // ---------- 注入「大师集群」按钮 ----------
    function injectMasterCluster(box) {
        if (!box) return;
        var row1 = box.querySelector('.chatbox-header-row1');
        if (!row1) return;

        // 1) 清掉旧独立图标（仅 header 第一排；日志/工具面板内部的保留不动）
        row1.querySelectorAll('.logmaster-btn, .contextmaster-btn, .toolmaster-btn')
            .forEach(function (b) { try { b.remove(); } catch (e) {} });

        // 2) 已有集群按钮则只做位置校正（确保在关闭左侧）
        var cluster = row1.querySelector('.mastercluster-btn');
        var closeBtn = row1.querySelector('.hd-btn.close');
        if (cluster) {
            if (closeBtn && cluster.nextElementSibling !== closeBtn) closeBtn.parentNode.insertBefore(cluster, closeBtn);
            return;
        }
        if (!closeBtn) return;

        var btn = document.createElement('button');
        btn.className = 'hd-btn mastercluster-btn master-icon mc-toggle';
        btn.title = '大师集群：日志大师 / 上下文大师 / 工具大师 / 导师点评';
        btn.textContent = '🧙 ▾';
        btn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;';

        var menu = buildMenu(box, btn);
        // 菜单挂到 body，fixed 定位，避免被 header 的 overflow:hidden 裁剪
        btn.style.position = '';
        menu.style.position = 'fixed';
        menu.style.display = 'none';
        document.body.appendChild(menu);
        // 打开时按按钮实际位置摆放
        function placeMenu() {
            var r = btn.getBoundingClientRect();
            menu.style.top = (r.bottom + 4) + 'px';
            menu.style.right = (window.innerWidth - r.right) + 'px';
            menu.style.left = 'auto';
        }
        btn._placeMenu = placeMenu;

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            var open = menu.style.display !== 'none';
            closeAllMenus(menu);
            if (open) {
                menu.style.display = 'none';
            } else {
                placeMenu();
                menu.style.display = 'block';
            }
        });

        // … 🧙 ▾ ✕（集群按钮插在关闭按钮左侧）
        closeBtn.parentNode.insertBefore(btn, closeBtn);
    }

    // ---------- 旧注入函数转空操作（防止日志大师/工具大师再往 header 塞独立图标） ----------
    function neutralize() {
        try { if (typeof App.injectLogMasterButtons === 'function') App.injectLogMasterButtons = function () {}; } catch (e) {}
        try { if (typeof App.injectToolMasterButton === 'function') App.injectToolMasterButton = function () {}; } catch (e) {}
    }

    // ---------- 入口 ----------
    function injectAll() {
        neutralize();
        document.querySelectorAll('.chatbox').forEach(injectMasterCluster);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectAll);
    } else {
        setTimeout(injectAll, 0);
    }

    // 动态新建/恢复的对话框：MutationObserver 兜底注入
    try {
        var mo = new MutationObserver(function () { injectAll(); });
        var root = document.getElementById('canvasContent') || document.getElementById('canvasArea') || document.body;
        mo.observe(root, { childList: true, subtree: true });
    } catch (e) {}

    // 兜底：钩住 createChatBox
    try {
        var orig = App.createChatBox;
        if (typeof orig === 'function') {
            App.createChatBox = function () {
                var b = orig.apply(this, arguments);
                try { neutralize(); injectMasterCluster(b); } catch (e) {}
                return b;
            };
        }
    } catch (e) {}

    App._injectMasterCluster = injectMasterCluster;
})();
