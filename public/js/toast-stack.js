/**
 * 全局 Toast 堆栈管理器 (Toast Stack Manager) v5
 * - 固定左下角，垂直堆叠，弹性滑入/滑出
 * - 自绘内联 SVG 图标（无 emoji 依赖）
 * - 同色系深→浅轻微渐变底（纯色渐变，无 backdrop-filter，零 GPU 毛玻璃开销）
 * - 支持 ToastStack.show(el|text, durationOrType)
 */
(function() {
    'use strict';

    var container = null;

    // 类型配置：图标为自绘 SVG；bg 为同色系深→浅轻微渐变
    var TYPES = {
        ok:      { c: '#34c77b', bg: 'radial-gradient(ellipse at center,rgba(35,110,70,0.96) 0%,rgba(16,46,32,0.94) 100%)' },
        error:   { c: '#f4574d', bg: 'radial-gradient(ellipse at center,rgba(150,45,38,0.96) 0%,rgba(60,19,17,0.94) 100%)' },
        warn:    { c: '#f5a623', bg: 'radial-gradient(ellipse at center,rgba(140,92,15,0.96) 0%,rgba(60,42,10,0.94) 100%)' },
        busy:    { c: '#6366f1', bg: 'radial-gradient(ellipse at center,rgba(58,60,140,0.96) 0%,rgba(26,28,60,0.94) 100%)' },
        info:    { c: '#38bdf8', bg: 'radial-gradient(ellipse at center,rgba(22,80,118,0.96) 0%,rgba(9,36,54,0.94) 100%)' }
    };

    function svgIcon(type, color) {
        var inner;
        if (type === 'ok') {
            inner = '<circle cx="12" cy="12" r="10" fill="none" stroke="' + color + '" stroke-width="2"/>' +
                    '<path d="M7.5 12.4l3 3 6-6.5" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
        } else if (type === 'error') {
            inner = '<circle cx="12" cy="12" r="10" fill="none" stroke="' + color + '" stroke-width="2"/>' +
                    '<path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round"/>';
        } else if (type === 'warn') {
            inner = '<path d="M12 3L22 20H2z" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
                    '<path d="M12 9v5" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round"/>' +
                    '<circle cx="12" cy="17" r="1.2" fill="' + color + '"/>';
        } else if (type === 'busy') {
            inner = '<g><circle cx="12" cy="12" r="9" fill="none" stroke="' + color + '" stroke-width="2" opacity="0.25"/>' +
                    '<path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round">' +
                    '<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></path></g>';
        } else {
            inner = '<circle cx="12" cy="12" r="10" fill="none" stroke="' + color + '" stroke-width="2"/>' +
                    '<path d="M12 10.5v6" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round"/>' +
                    '<circle cx="12" cy="7" r="1.3" fill="' + color + '"/>';
        }
        return '<svg width="18" height="18" viewBox="0 0 24 24" style="flex:none;display:block;">' + inner + '</svg>';
    }

    // 主题感知：从 documentElement 的 data-theme 读取当前明暗（由 theme.js 维护并派发 themechange）
    function isLightMode() {
        try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; }
    }

    // 浅色模式底板：白色不透明卡片 + 深色文字，保留左侧色条与彩色图标
    var LIGHT_STYLES = {
        ok:    { bg: 'linear-gradient(180deg,#ffffff 0%,#f0faf4 100%)', text: '#1c5c3a', shadow: '0 6px 18px rgba(20,80,50,0.14)' },
        error: { bg: 'linear-gradient(180deg,#ffffff 0%,#fdf1f0 100%)', text: '#8c2a24', shadow: '0 6px 18px rgba(140,40,30,0.14)' },
        warn:  { bg: 'linear-gradient(180deg,#ffffff 0%,#fdf7ea 100%)', text: '#7a5510', shadow: '0 6px 18px rgba(140,100,20,0.16)' },
        busy:  { bg: 'linear-gradient(180deg,#ffffff 0%,#f1f2fd 100%)', text: '#343788', shadow: '0 6px 18px rgba(50,50,140,0.14)' },
        info:  { bg: 'linear-gradient(180deg,#ffffff 0%,#eef8fd 100%)', text: '#12506e', shadow: '0 6px 18px rgba(15,70,110,0.14)' }
    };

    // 给 toast 元素套用当前主题对应的皮肤（show 与 themechange 刷新共用）
    function applySkin(el, type) {
        var conf = TYPES[type] || TYPES.info;
        if (isLightMode()) {
            var lt = LIGHT_STYLES[type] || LIGHT_STYLES.info;
            el.style.background = lt.bg;
            el.style.color = lt.text;
            el.style.boxShadow = lt.shadow;
        } else {
            el.style.background = conf.bg;
            el.style.color = '#fff';
            el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
        }
        el.style.borderLeftColor = conf.c;
        // 图标重绘（SVG stroke/fill 用类型色，明暗通用）
        var iconWrap = el.querySelector('.toast-icon');
        if (iconWrap) iconWrap.innerHTML = svgIcon(type, conf.c);
    }

    function getContainer() {
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-stack-container';
            container.style.cssText =
                'position:fixed;bottom:72px;left:172px;z-index:999999;' + // left:172px 避让左下三按钮浮层(#zfLeftFloat 占 10~164px)
                'display:flex;flex-direction:column-reverse;gap:8px;' +
                'pointer-events:none;max-width:min(420px,calc(100vw - 190px));';
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
     * @param {HTMLElement|string} el - Toast 元素 或 纯文本（自动套 v5 底板）
     * @param {number|string|Object} durationOrType - 数字=毫秒时长；'ok'/'error'/'warn'/'busy'/'info'=类型；对象={type,duration}
     */
    function show(el, durationOrType) {
        var opts = (durationOrType && typeof durationOrType === 'object' && typeof durationOrType !== 'number') ? durationOrType : null;
        if (opts) durationOrType = (typeof opts.type === 'string') ? opts.type : undefined;
        var type = (typeof durationOrType === 'string') ? durationOrType : 'info';
        var conf = TYPES[type] || TYPES.info;

        if (typeof el === 'string') {
            var t = conf;
            var wrap = document.createElement('div');
            wrap.className = 'toast-item';
            wrap.setAttribute('data-toast-type', type);
            wrap.style.cssText =
                'display:flex;align-items:center;gap:9px;padding:10px 14px 10px 11px;' +
                'border-radius:10px;border-left:4px solid ' + t.c + ';' +
                'font-size:13px;line-height:1.5;' +
                'max-width:100%;overflow:hidden;';
            applySkin(wrap, type);
            wrap.innerHTML = '<span class="toast-icon" style="display:flex;align-items:center;"></span>' + '<span class="toast-msg" style="flex:1;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;" title="' + String(el).replace(/"/g,'&quot;') + '"></span>';
            wrap.querySelector('.toast-icon').innerHTML = svgIcon(type, t.c);
            wrap.querySelector('.toast-msg').textContent = el;
            el = wrap;
        }
        if (!el || !el.style) return;
        var c = getContainer();
        el.style.pointerEvents = 'auto';
        el.style.transition = 'opacity 0.35s cubic-bezier(0.22,1,0.36,1), transform 0.35s cubic-bezier(0.22,1,0.36,1)';
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

        // 只有传入有效数字才作为时长，否则用默认值（防止误传 'ok'/'error' 等类型字符串导致瞬间消失）
        var dur = (opts && typeof opts.duration === 'number' && opts.duration > 0) ? opts.duration
                 : (typeof durationOrType === 'number' && durationOrType > 0) ? durationOrType : 3000;
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

    // 主题切换时刷新已显示 toast 的皮肤（themechange 由 theme.js 派发）
    document.addEventListener('themechange', function() {
        try {
            var c = getContainer();
            c.querySelectorAll('.toast-item[data-toast-type]').forEach(function(el) {
                applySkin(el, el.getAttribute('data-toast-type'));
            });
        } catch (e) {}
    });
})();
