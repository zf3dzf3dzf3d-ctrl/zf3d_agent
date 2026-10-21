/* ============================================================
 * chatbox-input-wheel-line.js
 * 输入框滚轮「整行滚动」优化。
 *
 * 背景：对话框 / 快捷创建条 / 任务面板快发条的 textarea 设置了固定
 * max-height + overflow-y:auto，文字超过可视行数后会出现内部滚动条。
 * 浏览器原生滚轮以「像素」为单位滚动，一次滚轮位移与行高（line-height）
 * 不成整数倍，导致可视区顶部停在半行处，文字被「半截半截」裁剪，阅读体验差。
 *
 * 方案：在这些输入框上拦截 wheel 事件，改为按「整行」滚动，并把 scrollTop
 * 对齐到行高的整数倍，保证每次滚动恰好一行、且始终显示完整行（不出现半截字）。
 * 用 document 级委托监听（capture + passive:false），无需逐实例挂载，
 * 新建对话框 / 动态重建输入框同样生效。
 * ============================================================ */
(function () {
    'use strict';

    // 命中这些输入框才接管滚轮（与 chatbox-input-spark.js 的目标保持一致）
    var TARGETS = [
        '.chatbox .chatbox-inputrow textarea',
        '.qc-sendrow textarea',
        '.cs-qs-inputrow textarea'
    ];

    function matchTarget(el) {
        if (!el || !el.closest) return null;
        for (var i = 0; i < TARGETS.length; i++) {
            var box = el.closest(TARGETS[i]);
            if (box) return box;
        }
        return null;
    }

    // 取单行像素高度：优先 computed line-height，回退 fontSize*1.4
    function lineHeightOf(ta) {
        var lh = parseFloat(getComputedStyle(ta).lineHeight);
        if (!lh || isNaN(lh)) {
            var fs = parseFloat(getComputedStyle(ta).fontSize) || 14;
            lh = fs * 1.4;
        }
        return lh;
    }

    document.addEventListener('wheel', function (e) {
        var ta = matchTarget(e.target);
        if (!ta) return;
        // 内容未超出可视区（无需滚动）时不拦截，保留正常行为
        if (ta.scrollHeight - ta.clientHeight <= 1) return;

        e.preventDefault();
        e.stopPropagation();

        var lh = lineHeightOf(ta);
        var max = ta.scrollHeight - ta.clientHeight;
        var dir = e.deltaY > 0 ? 1 : (e.deltaY < 0 ? -1 : 0);
        if (dir === 0) return;

        // 归一化 deltaMode：0=像素, 1=行(Firefox), 2=页。先把 deltaY 折算成像素，
        // 否则 Firefox 行模式下 deltaY 表示"行数"，除以 lh 会算出 0。
        var factor = e.deltaMode === 1 ? lh : (e.deltaMode === 2 ? ta.clientHeight : 1);
        var deltaPx = Math.abs(e.deltaY) * factor;

        // 一次滚轮约 100~120px，按行高换算滚几行，至少 1 行、最多可视行数
        var visibleLines = Math.max(1, Math.floor(ta.clientHeight / lh));
        var lines = Math.max(1, Math.min(visibleLines, Math.round(deltaPx / lh)));

        // 以「整行」为步进，并把结果对齐到行边界，杜绝半截
        var next = Math.round((ta.scrollTop + dir * lines * lh) / lh) * lh;
        if (next < 0) next = 0;
        if (next > max) next = max;
        ta.scrollTop = next;
    }, { passive: false, capture: true });
})();
