
/* ===== 主题面板拖拽缩放（v31）：上/下/左/右/四角，宽度高度可调，localStorage 记忆 ===== */
(function () {
    var LS_KEY = 'zfThemePanelSize';
    function restore(panel) {
        try {
            var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
            if (s && s.w) {
                panel.style.width = s.w + 'px';
                panel.style.height = s.h ? s.h + 'px' : 'auto';
            }
        } catch (e) {}
    }
    function initPanel(panel) {
        if (!panel || panel.dataset.rzDone) return;
        panel.dataset.rzDone = '1';
        restore(panel);
        var wrap = document.createElement('div');
        wrap.className = 'zf-panel-resize';
        ['n','s','e','w','ne','nw','se','sw'].forEach(function (d) {
            var h = document.createElement('div');
            h.className = 'zf-rz zf-rz-' + d;
            h.dataset.dir = d;
            wrap.appendChild(h);
        });
        panel.appendChild(wrap);
        wrap.addEventListener('mousedown', function (e) {
            var h = e.target.closest('.zf-rz');
            if (!h) return;
            e.preventDefault(); e.stopPropagation();
            var dir = h.dataset.dir;
            var sx = e.clientX, sy = e.clientY;
            var rect = panel.getBoundingClientRect();
            var sw = rect.width, sh = rect.height;
            var minW = 300, minH = 200;
            function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
            function onMove(ev) {
                var dx = ev.clientX - sx, dy = ev.clientY - sy;
                var w = sw, hgt = sh, top = rect.top;
                if (dir.indexOf('e') > -1 || dir === 'e') w = clamp(sw + dx, minW, window.innerWidth - 24);
                if (dir.indexOf('w') > -1) { w = clamp(sw - dx, minW, window.innerWidth - 24); }
                if (dir.indexOf('s') > -1) hgt = clamp(sh + dy, minH, window.innerHeight - 60);
                if (dir.indexOf('n') > -1) { hgt = clamp(sh - dy, minH, window.innerHeight - 60); top = rect.top + (sh - hgt); }
                panel.style.width = w + 'px';
                // 高度：含 s/n 方向一律直接设置固定高度（可拉伸也可收缩）
                if (dir.indexOf('s') > -1) {
                    panel.style.height = hgt + 'px';
                } else if (dir.indexOf('n') > -1) {
                    panel.style.height = hgt + 'px';
                    var nt = clamp(top, 42, window.innerHeight - 80);
                    panel.style.top = nt + 'px';
                }
                if (dir.indexOf('w') > -1) {
                    panel.style.right = 'auto';
                    panel.style.left = clamp(rect.left + (sw - w), 0, window.innerWidth - w) + 'px';
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                var r = panel.getBoundingClientRect();
                var cur = { w: Math.round(r.width) };
                var styleH = panel.style.height;
                cur.h = (styleH && styleH !== 'auto' && parseFloat(styleH) > 100) ? Math.round(r.height) : 0;
                try { localStorage.setItem(LS_KEY, JSON.stringify(cur)); } catch (err) {}
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }
    function boot() {
        var p = document.getElementById('themePanel');
        if (p) initPanel(p);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
