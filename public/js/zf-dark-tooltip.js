/* zf-dark-tooltip.js — 全局暗色悬浮提示：接管所有带 title 属性的元素，用暗色气泡替代系统白底提示 */
(function () {
    var tip = null, curEl = null, showTimer = null;
    function ensure() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'zf-dark-tooltip';
        tip.style.cssText = 'position:fixed;z-index:2147483647;max-width:360px;padding:6px 10px;'
            + 'background:rgba(24,28,38,.96);color:#e6e9f0;font-size:12px;line-height:1.6;'
            + 'border:1px solid rgba(255,255,255,.14);border-radius:8px;'
            + 'box-shadow:0 6px 20px rgba(0,0,0,.45);pointer-events:none;'
            + 'opacity:0;transition:opacity .12s;white-space:pre-wrap;word-break:break-all;display:none;';
        document.body.appendChild(tip);
        return tip;
    }
    function show(el) {
        var t = el.getAttribute('title') || el.getAttribute('data-tip');
        if (!t) return;
        curEl = el;
        el.setAttribute('data-tip', t);
        el.removeAttribute('title');          // 屏蔽系统原生白底提示
        var box = ensure();
        box.textContent = t;
        box.style.display = 'block';
        box.style.opacity = '0';
        var r = el.getBoundingClientRect();
        // 先定位再测量
        box.style.left = '0px'; box.style.top = '0px';
        var tw = box.offsetWidth, th = box.offsetHeight;
        var x = Math.min(Math.max(6, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 6);
        var y = r.bottom + 8;
        if (y + th > window.innerHeight - 6) y = r.top - th - 8;   // 底部放不下放上方
        box.style.left = x + 'px';
        box.style.top = Math.max(6, y) + 'px';
        requestAnimationFrame(function () { box.style.opacity = '1'; });
    }
    function hide() {
        curEl = null;
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        if (tip) { tip.style.opacity = '0'; tip.style.display = 'none'; }
    }
    document.addEventListener('mouseover', function (e) {
        var el = e.target.closest && e.target.closest('[title],[data-tip]');
        if (el === curEl) return;
        hide();
        if (!el) return;
        showTimer = setTimeout(function () { if (curEl !== el) show(el); }, 120); // 轻微延迟防误闪
        curEl = el;
    });
    document.addEventListener('mouseout', function (e) { hide(); });
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
})();
