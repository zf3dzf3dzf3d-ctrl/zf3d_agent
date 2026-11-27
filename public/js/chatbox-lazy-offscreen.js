// ==== 【FPS 优化】离屏对话框懒渲染（content-visibility:auto）====
// 原理：多窗口画布上大量对话窗口在视口外，浏览器仍对其做 layout/paint。
// 给离屏窗口加 content-visibility:auto 后，浏览器跳过其渲染，DOM 数据完整保留，
// 滚回视口时自动恢复渲染 —— 零功能风险、零 DOM 结构改动，仅省渲染开销。
(function () {
    try {
        var style = document.createElement('style');
        style.textContent =
            '.chatbox.zf-offscreen { content-visibility: auto; contain-intrinsic-size: 360px 480px; }' +
            '.chatbox.collapsed.zf-offscreen { contain-intrinsic-size: auto 40px; }' +
            /* 【多对话60帧优化①】窗口级布局隔离：contain 把每个对话窗的内部布局/样式计算圈在自身子树内，
               任一对话消息更新不再触发全画布样式重算（60 对话场景收益最大）。
               不用 paint（会裁掉下拉菜单/气泡溢出），layout+style 已覆盖主要开销 */
            '#canvasContent .chatbox { contain: layout style; }' +
            /* 【多对话60帧优化②】平移拖拽期间：暂停子树动画/过渡 + 简化重阴影（合成层重建开销大头），
               松手（.dragging 移除）自动恢复原样式，视觉无损 */
            '#canvasContent.dragging .chatbox *, #canvasContent.dragging .fg-node *, ' +
            '#canvasContent.dragging .browser-node *, #canvasContent.dragging .pres-node * ' +
            '{ transition: none !important; animation-play-state: paused !important; }' +
            '#canvasContent.dragging .chatbox { box-shadow: 0 0 0 1px rgba(0,0,0,.3) !important; }';
        document.head.appendChild(style);

        // 【历史教训·勿回退消息级方案】2026-09 曾在 .msg 层用过 content-visibility:auto，
        // 因 Windows 高 DPI 文字栅格化发虚 + getBoundingClientRect 定位不准被回退
        // （见 style-chatbox.css:1293 注释与 :3906 的 .msg 强制 visible 兜底）。
        // 本脚本只在【窗口层】(.chatbox) 启用：离屏窗口整窗跳过渲染无文字可虚，
        // 回屏后 .msg 仍按 3906 行强制 visible 正常渲染，两层互不冲突。
        // 守卫：程序化 scrollIntoView 前先唤醒目标窗口，防止定位到 360x480 占位盒。
        var _siv = Element.prototype.scrollIntoView;
        // 守卫失效保护：若 chatbox DOM 结构将来变动导致 closest 找不到窗口，
        // 这里不能静默——只告警一次，避免刷屏，但保证定位 bug 可排查
        Element.prototype.scrollIntoView = function () {
            try {
                var box = this.closest && this.closest('.chatbox');
                if (box) { box.classList.remove('zf-offscreen'); }
                else if (!Element._zfSivWarned) {
                    Element._zfSivWarned = true;
                    console.warn('[zf-lazy-offscreen] scrollIntoView 守卫未找到 .chatbox（DOM 结构可能已变动，休眠窗口不会被唤醒）');
                }
            } catch (e) {}
            return _siv.apply(this, arguments);
        };

        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.intersectionRatio > 0) {
                    en.target.classList.remove('zf-offscreen');
                } else {
                    // 离屏且非正在拖拽 → 进入休眠渲染
                    if (!en.target._zfDragging) en.target.classList.add('zf-offscreen');
                }
            });
        }, { root: null, rootMargin: '120px 0px', threshold: 0 });

        window._zfObserveChatbox = function (box) {
            if (box && box.classList && box.classList.contains('chatbox')) io.observe(box);
        };
        window._zfUnobserveChatbox = function (box) {
            try { if (box) io.unobserve(box); } catch (e) {}
        };

        /* 【CV 强制布局守卫 2026-11】窗口被 content-visibility:hidden 跳过渲染期间（app-canvas.js _cullNodes 屏外剔除的
           内联样式、.qn-gone 关闭态等），对它【子孙节点】的任何按节点读取——offsetHeight / getBoundingClientRect /
           scrollTop / getComputedStyle(子孙).xxx / innerText / focus——都会逼浏览器强行排版这棵隐藏子树，
           并每次刷一条 Chrome 的 "Rendering was performed in a subtree hidden by content-visibility."。
           轮询/动画在读取几何前先问本谓词：true → 本轮跳过，回屏后下一轮自然追上。
           实测口径（Chrome 157 逐项验证）：读【隐藏根自身】的几何、content-visibility:auto、整文档级布局均不触发。
           实现必须【自顶向下】沿路径逐级判（html → … → el）：每一步取计算样式的元素，其祖先都已确认未隐藏，
           必不在任何隐藏子树内；一旦遇到隐藏根立即返回，绝不触碰其内部。反过来【自底向上】是错的——el 的父元素
           往往仍在隐藏窗口里，对它取 getComputedStyle 本身就是一次"读子孙"（首版自底向上实测：谓词自身反成刷屏源）。 */
        window.zfRenderHidden = function (el) {
            try {
                if (!el || el.nodeType !== 1) return false;
                if (el.style.contentVisibility === 'hidden') return true; // 剔除态快捷路径：零计算样式
                var path = [];
                for (var n = el; n && n.nodeType === 1; n = n.parentElement) path.push(n);
                for (var i = path.length - 1; i >= 0; i--) {
                    if (getComputedStyle(path[i]).contentVisibility === 'hidden') return true;
                }
                return false;
            } catch (e) { return false; }
        };

        /* 【CV 强制布局守卫·延后滚底 2026-11】"滚到聊天底部"（body.scrollTop = body.scrollHeight）落在被隐藏剔除的窗口上时，
           scrollHeight 读取 + scrollTop 写入各是一次强排隐藏子树（各刷一条 Chrome 警告）。启动恢复历史即典型：
           每次加载，屏外对话窗恢复后双 rAF 滚底，恰逢已被剔除 → 每窗 4 条。隐藏期间滚动本就无人看见 →
           先记账，窗口回屏的【同一任务内】补滚：_cullNodes 解除隐藏后同步派发 zf-render-show（先于绘制，肉眼无跳动）；
           非剔除类隐藏（如 i整理关闭态重开）无人派发事件 → 低频兜底扫描追上（仅有待办时才启动，不常驻轮询）。 */
        var _pendingBottom = [];   // 待补滚的 .chatbox-body
        var _bottomSweepTimer = 0;
        function _sweepPendingBottom() {
            if (_bottomSweepTimer) { clearTimeout(_bottomSweepTimer); _bottomSweepTimer = 0; }
            var rest = [];
            for (var i = 0; i < _pendingBottom.length; i++) {
                var pb = _pendingBottom[i];
                if (!pb.isConnected) continue; // 窗口已关闭 → 丢弃
                if (window.zfRenderHidden(pb)) { rest.push(pb); continue; }
                pb.scrollTop = pb.scrollHeight;
            }
            _pendingBottom = rest;
            if (rest.length) _bottomSweepTimer = setTimeout(_sweepPendingBottom, 1500);
        }
        document.addEventListener('zf-render-show', function () { if (_pendingBottom.length) _sweepPendingBottom(); });
        /* 对话滚动区"滚到底部"的统一入口：窗口可见时与原写法完全等价；被隐藏剔除时记账延后（见上） */
        window.zfScrollBottom = function (body) {
            if (!body) return;
            if (!window.zfRenderHidden(body)) { body.scrollTop = body.scrollHeight; return; }
            if (_pendingBottom.indexOf(body) < 0) _pendingBottom.push(body);
            if (!_bottomSweepTimer) _bottomSweepTimer = setTimeout(_sweepPendingBottom, 1500);
        };

        // 观察现有 + 未来新增的对话窗口（MutationObserver 兜底，防各创建路径漏挂）
        function scan() {
            document.querySelectorAll('.chatbox:not([data-zf-lazy])').forEach(function (box) {
                box.setAttribute('data-zf-lazy', '1');
                io.observe(box);
            });
        }
        scan();
        var mo = new MutationObserver(function () { scan(); });
        try { mo.observe(document.getElementById('canvasContent') || document.getElementById('canvasArea') || document.body, { childList: true, subtree: false }); }
        catch (e) { mo.observe(document.body, { childList: true, subtree: true }); }

        // 拖拽中的窗口临时摘掉休眠标记（拖拽预览需要真实渲染）；
        // pointerup 后重新回观察队列
        document.addEventListener('pointerdown', function (ev) {
            var box = ev.target.closest && ev.target.closest('.chatbox');
            if (box) { box._zfDragging = true; box.classList.remove('zf-offscreen'); }
        }, true);
        document.addEventListener('pointerup', function (ev) {
            var box = ev.target.closest && ev.target.closest('.chatbox');
            if (box) { box._zfDragging = false; }
        }, true);
    } catch (e) { console.warn('[zf-lazy-offscreen] init failed', e); }
})();
