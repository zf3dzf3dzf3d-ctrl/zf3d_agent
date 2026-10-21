/* ============================================================
 * chatbox-font-zoom.js —— 对话框字体缩放快捷键
 *
 * Ctrl + 加号(+)/等号(=) 放大 | Ctrl + 减号(-) 缩小 | Ctrl + 0 还原
 * 档位存 localStorage（key: zf-chatbox-font-zoom），刷新后保持。
 * 作用范围：消息正文 / 输入框 / 时间戳（经 --chatbox-font-scale 变量联动）。
 * 缩放范围 0.7 ~ 2.0，步进 0.1，toast 提示当前百分比。
 * ============================================================ */
(function () {
    'use strict';

    var STORE_KEY = 'zf-chatbox-font-zoom';
    var MIN = 0.7, MAX = 2.0, STEP = 0.1;
    var DEFAULT = 1.0;

    function loadScale() {
        var v = parseFloat(localStorage.getItem(STORE_KEY));
        if (isNaN(v)) return DEFAULT;
        return Math.min(MAX, Math.max(MIN, v));
    }

    function saveScale(s) {
        try { localStorage.setItem(STORE_KEY, String(s)); } catch (e) { /* 忽略 */ }
    }

    // 生效目标：优先鼠标悬停的对话框，其次焦点所在，否则全部对话框
    function targetBoxes() {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('.chatbox'));
        if (!boxes.length) return [];
        var hovered = boxes.filter(function (b) { return b.matches(':hover'); });
        if (hovered.length) return hovered;
        var focused = boxes.filter(function (b) { return b.contains(document.activeElement); });
        if (focused.length) return focused;
        return boxes;
    }

    function applyScale(scale, boxes) {
        (boxes || document.querySelectorAll('.chatbox')).forEach(function (box) {
            box.style.setProperty('--chatbox-font-scale', scale);
        });
    }

    function toast(msg) {
        if (typeof window.zfToast === 'function') { window.zfToast(msg); return; }
        var t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:999999;background:rgba(20,24,32,.92);color:#ffe9a8;font-size:13px;padding:6px 14px;border-radius:8px;border:1px solid rgba(255,220,120,.45);pointer-events:none;transition:opacity .3s;';
        document.body.appendChild(t);
        setTimeout(function () { t.style.opacity = '0'; }, 900);
        setTimeout(function () { t.remove(); }, 1300);
    }

    document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

        var key = e.key;
        var isPlus = (key === '+' || key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal');
        var isMinus = (key === '-' || e.code === 'NumpadSubtract');
        var isReset = (key === '0' || e.code === 'Numpad0');
        if (!isPlus && !isMinus && !isReset) return;

        var boxes = targetBoxes();
        if (!boxes.length) return; // 没有对话框时不接管

        e.preventDefault();
        e.stopPropagation();

        var scale = loadScale();
        if (isPlus) scale = Math.min(MAX, Math.round((scale + STEP) * 10) / 10);
        else if (isMinus) scale = Math.max(MIN, Math.round((scale - STEP) * 10) / 10);
        else scale = DEFAULT;

        saveScale(scale);
        applyScale(scale, boxes);
        toast('对话框字体 ' + Math.round(scale * 100) + '%' + (scale === DEFAULT ? '（已还原）' : ''));
    }, true);

    function boot() { applyScale(loadScale()); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
