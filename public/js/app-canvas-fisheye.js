// ========== app-canvas-fisheye.js - 画布玻璃高光（无透视无变形版） =========
// 原鱼眼三维透视效果已彻底移除（不再有任何 perspective/rotate/scale/translateZ）。
// 保留：离屏幕中心越远的节点，玻璃高光质感越明显——
//   左上高光、厚玻璃断面亮边（inset 高光）、边缘青蓝辉光。
// 节点本身完全不动、不缩放、不倾斜、不压暗。
(function () {
    'use strict';

    var ENABLE_KEY = 'fisheyeEnabled';

    // ===== 参数持久化（localStorage + UserSettings） =====
    var CFG_KEY = 'fisheyeConfig';
    var CFG_DEFAULTS = {
        glow: 0.5   // 玻璃高光强度（0~1）
    };
    var cfg = { glow: CFG_DEFAULTS.glow };

    function loadCfg() {
        var saved = null;
        try {
            if (window.UserSettings && UserSettings.get) saved = UserSettings.get(CFG_KEY, null);
            if (!saved) saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
        } catch (e) {}
        if (saved && typeof saved === 'object') {
            Object.keys(CFG_DEFAULTS).forEach(function (k) {
                var v = parseFloat(saved[k]);
                if (!isNaN(v)) cfg[k] = v;
            });
        }
    }
    function saveCfg() {
        var out = {};
        Object.keys(CFG_DEFAULTS).forEach(function (k) { out[k] = cfg[k]; });
        try { localStorage.setItem(CFG_KEY, JSON.stringify(out)); } catch (e) {}
        try { if (window.UserSettings && UserSettings.set) UserSettings.set(CFG_KEY, out); } catch (e) {}
    }

    function enabled() {
        try { return localStorage.getItem(ENABLE_KEY) === '1'; } catch (e) { return false; }
    }

    var ticking = false;

    function applyGlass() {
        ticking = false;
        try { applyGlassInner(); } catch (e) {}
    }

    function clearNode(el) {
        el.style.transform = el._fisheyeOrigTransform || '';
        el.style.transformOrigin = '';
        el.style.filter = '';
        el.style.boxShadow = '';
        el.style.transition = '';
        el.classList.remove('fe-edge', 'fe-sweep');
        if (el._feDim && el._feDim.parentNode) el._feDim.parentNode.removeChild(el._feDim);
        el._feDim = null;
        el._feF = undefined;
        el._fisheyeApplied = false;
    }

    function applyGlassInner() {
        var content = document.getElementById('canvasContent');
        if (!content) return;

        var boxes = content.querySelectorAll('.chatbox, .glam-node, .image-node-x, .engine-node');
        if (!boxes.length) return;

        var dragging = content.classList.contains('dragging');
        if (dragging) return; // 拖拽期间冻结，松手后恢复

        var cx = window.innerWidth / 2;
        var cy = window.innerHeight / 2;
        var rx = window.innerWidth * 0.62;
        var ry = window.innerHeight * 0.62;

        var on = enabled();

        // —— 读写分离：先全部读 rect，再统一写 ——
        var rects = new Array(boxes.length);
        for (var i = 0; i < boxes.length; i++) rects[i] = boxes[i].getBoundingClientRect();

        var vw = window.innerWidth, vh = window.innerHeight;
        var MARGIN = 240;

        for (var i = 0; i < boxes.length; i++) {
            var el = boxes[i];
            if (!on) { if (el._fisheyeApplied) clearNode(el); continue; }

            var r = rects[i];
            if (r.width === 0 && r.height === 0) continue;
            if (r.bottom < -MARGIN || r.top > vh + MARGIN || r.right < -MARGIN || r.left > vw + MARGIN) {
                if (el._fisheyeApplied) clearNode(el);
                continue;
            }

            // 离屏幕中心的归一化距离（与原鱼眼相同的衰减曲线）
            var dx = (r.left + r.width / 2 - cx) / rx;
            var dy = (r.top + r.height / 2 - cy) / ry;
            if (dx > 1) dx = 1; else if (dx < -1) dx = -1;
            if (dy > 1) dy = 1; else if (dy < -1) dy = -1;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d > 1) d = 1;
            var f = Math.pow(d, 0.9);
            f = f * f;

            // 正中心节点：完全不加高光，保持素净
            if (f < 0.35) {
                if (el._fisheyeApplied) clearNode(el);
                continue;
            }

            var sheen = (f - 0.35) / 0.65; // 0→1 渐进
            var g = cfg.glow;

            // 玻璃高光叠加层
            var sh = el.querySelector(':scope > .fe-dim') || null;
            if (!sh && el.firstElementChild) {
                sh = document.createElement('div');
                sh.className = 'fe-dim';
                sh.style.cssText = 'position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:9;';
                el.appendChild(sh);
                el._feDim = sh;
            }
            if (sh) {
                var prevF = el._feF;
                if (prevF === undefined || Math.abs(prevF - f) >= 0.005) {
                    el._feF = f;
                    // 左上玻璃高光（不压暗，纯高光）
                    sh.style.background =
                        'linear-gradient(155deg,' +
                        'rgba(170,210,255,' + (0.14 * sheen * g).toFixed(3) + ') 0%,' +
                        'rgba(120,170,255,' + (0.06 * sheen * g).toFixed(3) + ') 22%,' +
                        'rgba(255,255,255,0) 45%,' +
                        'rgba(255,255,255,0) 100%)';
                    // 厚玻璃断面亮边 + 顶部高光线 + 底部厚度反光
                    sh.style.boxShadow =
                        'inset 1.5px 0 1px -1px rgba(190,225,255,' + (0.75 * sheen * g).toFixed(3) + '),' +
                        'inset -1.5px 0 1px -1px rgba(190,225,255,' + (0.55 * sheen * g).toFixed(3) + '),' +
                        'inset 0 1.5px 1px -1px rgba(220,240,255,' + (0.85 * sheen * g).toFixed(3) + '),' +
                        'inset 0 -2px 3px -1px rgba(140,190,255,' + (0.45 * sheen * g).toFixed(3) + ')';
                }
            }
            // 外部辉光（青蓝柔和光晕，玻璃悬浮感，无投影变形）
            el.style.boxShadow =
                '0 ' + Math.round(10 * sheen) + 'px ' + Math.round(30 * sheen) + 'px rgba(90,160,255,' + (0.32 * sheen * g).toFixed(2) + '),' +
                '0 0 ' + Math.round(28 * sheen) + 'px rgba(70,200,255,' + (0.45 * sheen * g).toFixed(2) + '),' +
                'inset 0 1px 0 rgba(255,255,255,' + (0.08 * sheen * g).toFixed(3) + ')';
            el._fisheyeApplied = true;
        }
    }

    function requestApply() {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(applyGlass);
        }
    }

    function boot() {
        var content = document.getElementById('canvasContent');
        if (!content) { setTimeout(boot, 600); return; }

        var interactTimer = null;
        function markInteracting() {
            document.body.classList.add('fe-interacting');
            clearTimeout(interactTimer);
            interactTimer = setTimeout(function () {
                document.body.classList.remove('fe-interacting');
            }, 160);
        }
        ['pointerdown', 'wheel', 'scroll'].forEach(function (evName) {
            window.addEventListener(evName, function () { markInteracting(); requestApply(); }, { passive: true, capture: true });
        });

        content.addEventListener('scroll', function () { requestApply(); }, { passive: true });
        content.addEventListener('pointermove', function () { requestApply(); }, { passive: true });

        window.addEventListener('resize', requestApply);

        var mo = new MutationObserver(function (m) {
            for (var i = 0; i < m.length; i++) {
                if (m[i].type === 'attributes' || m[i].type === 'childList') { requestApply(); return; }
            }
        });
        mo.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    }

    // ===== 开关：Ctrl+Alt+F / App.toggleFisheye() / 设置面板复选框 =====
    function syncToggle() {
        var cb = document.getElementById('fisheyeToggle');
        if (cb) cb.checked = enabled();
    }
    window.App = window.App || {};
    App.toggleFisheye = function (on) {
        localStorage.setItem(ENABLE_KEY, on === undefined ? (enabled() ? '0' : '1') : (on ? '1' : '0'));
        requestApply();
        syncToggle();
    };

    // ===== 设置面板滑杆（仅高光强度） =====
    var SLIDERS = [
        { key: 'glow', id: 'feRimGlow', label: '玻璃高光强度', min: 0, max: 1, step: 0.05 }
    ];
    function syncSliders() {
        SLIDERS.forEach(function (s) {
            var el = document.getElementById(s.id);
            if (el) el.value = cfg[s.key];
            var val = document.getElementById(s.id + 'Val');
            if (val) val.textContent = cfg[s.key].toFixed(2);
        });
    }
    App.setFisheyeParam = function (key, v) {
        v = parseFloat(v);
        if (isNaN(v)) return;
        cfg[key] = v;
        saveCfg();
        requestApply();
        syncSliders();
    };
    App.resetFisheyeParams = function () {
        Object.keys(CFG_DEFAULTS).forEach(function (k) { cfg[k] = CFG_DEFAULTS[k]; });
        saveCfg();
        requestApply();
        syncSliders();
    };
    window.addEventListener('user-settings-refreshed', function () { loadCfg(); requestApply(); syncSliders(); });

    window.addEventListener('keydown', function (ev) {
        if (ev.ctrlKey && ev.altKey && (ev.key === 'f' || ev.key === 'F')) {
            ev.preventDefault();
            App.toggleFisheye();
        }
    });

    loadCfg();
    boot();

    document.addEventListener('DOMContentLoaded', function () { syncToggle(); syncSliders(); });
    setInterval(function () { syncToggle(); syncSliders(); }, 1000);
})();
