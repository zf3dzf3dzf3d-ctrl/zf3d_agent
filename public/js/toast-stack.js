/**
 * 全局 Toast 堆栈管理器 (Toast Stack Manager)
 * 
 * 统一管理所有 Toast 通知：
 * - 固定在左下角 (bottom:16px; left:16px)
 * - 垂直排列，新的在上方（column-reverse + appendChild）
 * - 自动动画进出 + 定时消失
 * - 支持多个 Toast 同时存在，互不干扰
 * - 当某个 Toast 消失时，其余 Toast 自动下移填补空位
 */
(function() {
    'use strict';

    var container = null;

    function getContainer() {
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-stack-container';
            container.style.cssText =
                'position:fixed;bottom:16px;left:16px;z-index:999999;' +
                'display:flex;flex-direction:column-reverse;gap:8px;' +
                'pointer-events:none;max-width:420px;';
            // 等待 DOM 就绪
            if (document.body) {
                document.body.appendChild(container);
            } else {
                document.addEventListener('DOMContentLoaded', function() {
                    document.body.appendChild(container);
                });
            }
        }
        return container;
    }

    /**
     * 显示一个 Toast
     * @param {HTMLElement} el - Toast 元素（已有内容和视觉样式，无需定位样式）
     * @param {number} duration - 显示时长（毫秒），默认 3000
     */
    function show(el, duration) {
        var c = getContainer();
        el.style.pointerEvents = 'auto';
        el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
        el.style.opacity = '0';
        el.style.transform = 'translateY(16px) scale(0.95)';

        c.appendChild(el);

        // 双层 rAF 确保浏览器先渲染初始状态再触发动画
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0) scale(1)';
            });
        });

        var dur = duration || 3000;
        var removed = false;

        function removeToast() {
            if (removed) return;
            removed = true;
            el.style.opacity = '0';
            el.style.transform = 'translateY(16px) scale(0.95)';
            setTimeout(function() {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 350);
        }

        setTimeout(removeToast, dur);

        // 支持点击关闭
        el.style.cursor = 'pointer';
        el.addEventListener('click', removeToast);
    }

    window.ToastStack = {
        show: show,
        getContainer: getContainer
    };
})();
