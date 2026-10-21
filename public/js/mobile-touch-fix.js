/* mobile-touch-fix.js —— 手机版触摸修复
   问题：手机上在对话框（输入行/配置行/标题栏等非消息区域）上下滑动，
   无法像滚轮一样滚动聊天记录。
   方案：监听对话卡片上的 touchmove，凡是目标不在 .chatbox-body 内部
   （消息区自己滚自己的）且不在 textarea（打字需要），就把滑动位移
   换算成消息区的 scrollTop，实现"哪里滑都能滚聊天记录"。 */
(function () {
    'use strict';
    var active = null; // { y, body }

    document.addEventListener('touchstart', function (e) {
        // v4：遥控器影子区修复。#rmShadow 内是被控端整页快照克隆，外层 overflow:auto 才是真正可滚容器；
        // 克隆体里的 .chatbox/.chatbox-body 高度未约束、自身不溢出，按桌面端逻辑会取错滚动目标导致拖不动。
        var shadow = e.target.closest && e.target.closest('#rmShadow');
        if (shadow) {
            if (e.target.closest('textarea, input, select')) { active = null; return; }
            active = { y: e.touches[0].clientY, body: shadow, shadow: true };
            return;
        }
        var box = e.target.closest && e.target.closest('.chatbox');
        if (!box) { active = null; return; }
        // textarea/输入控件自己处理；消息区不排除——由 touchmove 做边缘兜底判断
        if (e.target.closest('textarea, input, select, .mp-menu, .eng-menu, .tool-cat-menu')) { active = null; return; }
        var body = box.querySelector('.chatbox-body');
        if (!body) { active = null; return; }
        active = { y: e.touches[0].clientY, body: body };
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
        if (!active) return;
        var y = e.touches[0].clientY;
        var dy = active.y - y; // 上滑为正 → 向下滚
        if (Math.abs(dy) < 2) return;
        var body = active.body;
        if (active.shadow) {
            // 影子区：直接跟手滚动外层容器 #rmShadow（内容必然溢出）
            body.scrollTop += dy;
            active.y = y;
            e.preventDefault();
            return;
        }
        var inBody = !!(e.target.closest && e.target.closest('.chatbox-body'));
        if (inBody) {
            // 原生惯性滚动优先；但 WebView 原生触摸滚动可能失效——
            // 记录起点，若本轮原生没有产生位移则手动接管（v3 兜底）
            if (active.nativeTried === undefined) {
                active.nativeTried = true;
                active.nativeStart = body.scrollTop;
                return; // 第一段位移先让原生试
            }
            var moved = Math.abs(body.scrollTop - active.nativeStart);
            var canScroll = dy > 0
                ? body.scrollTop + body.clientHeight < body.scrollHeight - 1
                : body.scrollTop > 1;
            if (moved > 1 || !canScroll) {
                // 原生已滚 or 已到边缘：只做边缘防穿透
                if (!canScroll) e.preventDefault();
                active.y = y;
                return;
            }
            // 原生没滚 → 手动接管（跟手 1:1，保证触摸可滑动）
            body.scrollTop += dy;
            active.y = y;
            e.preventDefault();
            return;
        }
        // 非消息区（标题栏/配置行等）：滑动换算成消息区滚动
        active.y = y;
        body.scrollTop += dy * 1.2; // 稍作放大，接近滚轮手感
        e.preventDefault(); // 阻止页面橡皮筋
    }, { passive: false });

    document.addEventListener('touchend', function () { active = null; }, { passive: true });
    document.addEventListener('touchcancel', function () { active = null; }, { passive: true });
})();
