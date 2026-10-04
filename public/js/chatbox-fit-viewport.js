/* ========== chatbox-fit-viewport.js ==========
   对话框自适应底部：加载/窗口变化时，若对话框底部超出可视区，
   自动向上拉回（按画布缩放换算），并同步保存位置。
   画布坐标换算：content 容器有 transform: translate(x,y) scale(s)，
   屏幕像素差 / s = 画布坐标差。 */
(function () {
    'use strict';
    var MARGIN = 16;          // 距屏幕底部保留间距
    var MIN_VISIBLE = 120;    // 至少保证可见高度

    function getScale() {
        var content = document.getElementById('content') ||
                      document.querySelector('.canvas-content') ||
                      document.querySelector('.chatbox').parentElement;
        if (!content) return 1;
        var t = getComputedStyle(content).transform;
        if (t && t !== 'none') {
            var m = t.match(/matrix\(([^)]+)\)/);
            if (m) { var s = parseFloat(m[1].split(',')[3]); if (s > 0) return s; }
        }
        return 1;
    }

    function fitOne(box) {
        if (!box || box.classList.contains('is-minimized')) return false;
        var r = box.getBoundingClientRect();
        if (r.height <= 0) return false;
        var limit = window.innerHeight - MARGIN;

        /* 【F12 偏移修复】先尝试还原：如果之前因窗口变矮（如 F12 开 DevTools）被上拉过，
           现在窗口变高，去掉历史偏移后完全可见，就还原原始位置并清除记录。 */
        if (box._fitShift && typeof box._fitBaseTop === 'number') {
            var baseTop = box._fitBaseTop;
            var curT = parseInt(box.style.top, 10) || 0;
            var rBack = { top: r.top - (curT - baseTop) * getScale(), height: r.height };
            if (rBack.top >= 0 && rBack.top + rBack.height <= limit) {
                box.style.top = baseTop + 'px';
                box._fitShift = 0;
                try {
                    var chatBack = box._chat || (window.Tools && Tools.chatBoxes &&
                        Tools.chatBoxes.find(function (c) { return c.el === box; }));
                    if (chatBack && window.Store && Store.saveChatBox) Store.saveChatBox(chatBack);
                } catch (e) {}
                return true;
            }
        }

        // 完全可见或可见部分足够，就不动
        if (r.bottom <= limit) return false;
        if (window.innerHeight - r.top >= MIN_VISIBLE && r.top >= 0) return false;
        var s = getScale();
        var dy = Math.round((r.bottom - limit) / s);
        var curTop = parseInt(box.style.top, 10) || 0;
        var newTop = curTop - dy;
        if (newTop < 0) newTop = 0;
        if (newTop === curTop) return false;
        /* 记录本次校准偏移（首次记录原始 top），供窗口恢复时还原 */
        if (!box._fitShift) box._fitBaseTop = curTop;
        box._fitShift = (box._fitShift || 0) + (curTop - newTop);
        box.style.top = newTop + 'px';
        try {
            var chat = box._chat || (window.Tools && Tools.chatBoxes &&
                Tools.chatBoxes.find(function (c) { return c.el === box; }));
            if (chat && window.Store && Store.saveChatBox) Store.saveChatBox(chat);
        } catch (e) {}
        return true;
    }

    function fitAll() {
        var boxes = document.querySelectorAll('.chatbox');
        /* 【父子窗口变化同步修复】全屏↔非全屏切换时，此前逐窗独立校准会把
           父窗和子对话各自独立上拉，子窗与父窗相对阵型脱节；
           随后 ZFGroupFollow 漂移轮询又按父窗位移整体平移子树 → 子对话跳位/上移。
           现改为：子对话（关系边里的 child）不独立校准，只校准父窗，
           父窗位移量经 ZFGroupFollow.panelMoved 同步给整棵子树（并刷新其基准）。 */
        var childSet = {};
        var hasEdges = false;
        try {
            if (window.ZFGroupFollow && typeof window.ZFGroupFollow.collectEdges === 'function') {
                window.ZFGroupFollow.collectEdges().forEach(function (e) {
                    childSet[String(e.child)] = true;
                });
                hasEdges = true;
            }
        } catch (e) {}
        var chatOf = function (el) {
            var arr = (window.App && window.App.chatBoxes) ||
                      (window.Tools && window.Tools.chatBoxes) || [];
            for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].el === el) return arr[i]; }
            return null;
        };
        var changed = false;
        boxes.forEach(function (b) {
            var chat = chatOf(b);
            if (hasEdges && chat && childSet[String(chat.id)]) return; /* 子窗跟父窗走 */
            var beforeTop = parseInt(b.style.top, 10) || 0;
            if (fitOne(b)) {
                changed = true;
                if (chat && window.ZFGroupFollow && typeof window.ZFGroupFollow.panelMoved === 'function') {
                    var dy = (parseInt(b.style.top, 10) || 0) - beforeTop;
                    if (dy) {
                        try { window.ZFGroupFollow.panelMoved(chat.id, 0, dy); } catch (e) {}
                    }
                }
            }
        });
        if (changed && window.App && typeof App.updateMinimap === 'function') {
            try { App.updateMinimap(); } catch (e) {}
        }
        return changed;
    }

    // 【已移除】pointerup 被动校准：框选/平移画布结束后会误判"出界"并把窗口上拉。

    var raf = 0;
    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; fitAll(); });
    }

    // 【修复】只在窗口尺寸真正变化时校准。
    // 之前在 load/轮询/pointerup 时也执行，导致用户平移画布后，
    // 对话框在屏幕坐标里"出界"被误判，位置被永久上拉（表现为对话框莫名被抬高）。
    window.addEventListener('resize', schedule);

    window.ChatBoxFitViewport = { fitAll: fitAll, fitOne: fitOne };
})();
