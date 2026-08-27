// ========== app-imageviewer.js - 浮动「图片或视频查看」面板（重做版） ==========
//   - 挂在 body 上，position: fixed 视口定位 -> 不再受画布平移/缩放影响，
//     默认出现在视口右上角（彻底解决默认跑到左边 (0,0) 的问题）
//   - 双击面板/媒体 → 最大化模式（覆盖整个视口），再次双击还原
//   - 滚轮以鼠标为中心缩放；左键按住拖拽平移媒体
//   - 标题栏可拖拽移动面板（记忆位置）；右下角手柄调整尺寸（记忆尺寸）
// 接口：ImageViewer.show(url) / ImageViewer.hide() / ImageViewer.isOpen / ImageViewer._lastUrl
(function () {
    'use strict';

    if (window.ImageViewer) return; // 防止重复加载

    const POS_KEY = 'zf3d_imageviewer_pos';
    const SIZE_KEY = 'zf3d_imageviewer_size';

    let panel = null;
    let stage = null, imgEl = null, vidEl = null, emptyEl = null, scaleLabel = null;
    let mediaIsVideo = false;
    let scale = 1, tx = 0, ty = 0;
    const MIN_SCALE = 0.05, MAX_SCALE = 40;
    let naturalW = 0, naturalH = 0;
    let lastUrl = '';
    let maximized = false;
    let savedGeom = null;

    function clampScale(s) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }

    function usGet(key) {
        try { if (window.UserSettings) return UserSettings.get(key); } catch (e) {}
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function usSet(key, value) {
        try { if (window.UserSettings) { UserSettings.set(key, value); return; } } catch (e) {}
        try { localStorage.setItem(key, value); } catch (e3) {}
    }

    function loadSavedSize() {
        try {
            const raw = usGet(SIZE_KEY);
            const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const w = Number(v && v.w), h = Number(v && v.h);
            if (Number.isFinite(w) && Number.isFinite(h)) return { w: Math.min(Math.max(w, 280), window.innerWidth - 40), h: Math.min(Math.max(h, 220), window.innerHeight - 60) };
        } catch (e) {}
        return null; // 默认 480x380
    }

    // 视口坐标系的记忆位置：非法或飘出可视区时返回 null（用右上角默认位）
    function loadSavedPos() {
        try {
            const raw = usGet(POS_KEY);
            const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const x = Number(v && v.x), y = Number(v && v.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            if (x < -40 || y < -20 || x > window.innerWidth - 120 || y > window.innerHeight - 80) return null;
            return { x, y };
        } catch (e) {}
        return null;
    }

    // 默认位置：视口右上角（fixed 定位下直接就是视觉正确位置，不会再跑到左上角 0,0）
    function defaultPos() {
        const sz = loadSavedSize() || { w: 480 };
        return { x: Math.max(12, window.innerWidth - sz.w - 24), y: 76 };
    }

    function applyTransform() {
        const t = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
        if (imgEl) imgEl.style.transform = t;
        if (vidEl) vidEl.style.transform = t;
        if (scaleLabel) scaleLabel.textContent = mediaIsVideo ? '视频' : Math.round(scale * 100) + '%';
    }

    function fitToPanel() {
        if (!naturalW || !naturalH || !stage) return;
        const r = stage.getBoundingClientRect();
        const availW = Math.max(40, r.width - 24);
        const availH = Math.max(40, r.height - 24);
        scale = clampScale(Math.min(availW / naturalW, availH / naturalH));
        tx = (r.width - naturalW * scale) / 2;
        ty = (r.height - naturalH * scale) / 2;
        applyTransform();
    }

    function zoomAt(cx, cy, factor) {
        if (!stage) return;
        const r = stage.getBoundingClientRect();
        const lx = cx - r.left, ly = cy - r.top;
        const newScale = clampScale(scale * factor);
        if (newScale === scale) return;
        const px = (lx - tx) / scale, py = (ly - ty) / scale;
        tx = lx - px * newScale;
        ty = ly - py * newScale;
        scale = newScale;
        applyTransform();
    }

    function zoomCenter(factor) {
        if (!stage) return;
        const r = stage.getBoundingClientRect();
        zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    }

    function build() {
        panel = document.createElement('div');
        panel.className = 'iv-float-panel';
        panel.innerHTML =
            '<div class="iv-header">' +
                '<span class="iv-title">🖼 图片或视频查看</span>' +
                '<button type="button" class="iv-close" title="关闭 (Esc)">✕</button>' +
            '</div>' +
            '<div class="iv-stage">' +
                '<img class="iv-img" draggable="false" alt="" />' +
                '<video class="iv-video" controls playsinline style="display:none"></video>' +
                '<div class="iv-empty">暂无可查看的图片或视频<br><span>生成图片/视频后自动在此显示，或双击画布节点。</span></div>' +
            '</div>' +
            '<div class="iv-footer">' +
                '<button type="button" class="iv-btn" data-act="zoomout" title="缩小">－</button>' +
                '<span class="iv-scale">100%</span>' +
                '<button type="button" class="iv-btn" data-act="zoomin" title="放大">＋</button>' +
                '<button type="button" class="iv-btn" data-act="fit" title="适应窗口">⛶ 适应</button>' +
                '<span class="iv-hint" title="双击最大化 · 滚轮以鼠标为中心缩放 · 左键拖拽平移">双击最大化 · 滚轮缩放 · 拖拽平移</span>' +
            '</div>' +
            '<span class="iv-resize-grip" title="拖动调整大小"></span>';

        document.body.appendChild(panel); // fixed 定位挂在 body

        stage = panel.querySelector('.iv-stage');
        imgEl = panel.querySelector('.iv-img');
        vidEl = panel.querySelector('.iv-video');
        emptyEl = panel.querySelector('.iv-empty');
        scaleLabel = panel.querySelector('.iv-scale');

        // --- 记忆尺寸与位置（fixed 视口坐标） ---
        const sz = loadSavedSize();
        panel.style.width = (sz ? sz.w : 480) + 'px';
        panel.style.height = (sz ? sz.h : 380) + 'px';
        const pos = loadSavedPos() || defaultPos();
        panel.style.left = pos.x + 'px';
        panel.style.top = pos.y + 'px';

        // --- 标题栏拖拽（fixed 无需换算画布缩放比） ---
        const header = panel.querySelector('.iv-header');
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            ox = parseFloat(panel.style.left) || 0;
            oy = parseFloat(panel.style.top) || 0;
            e.preventDefault();
        });
        window.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            panel.style.left = (ox + e.clientX - sx) + 'px';
            panel.style.top = (oy + e.clientY - sy) + 'px';
        });
        window.addEventListener('pointerup', () => {
            if (!dragging) return;
            dragging = false;
            usSet(POS_KEY, JSON.stringify({ x: parseFloat(panel.style.left) || 0, y: parseFloat(panel.style.top) || 0 }));
        });

        // --- 右下角尺寸手柄 ---
        const grip = panel.querySelector('.iv-resize-grip');
        let resizing = false, rsx = 0, rsy = 0, rw = 0, rh = 0;
        grip.addEventListener('pointerdown', (e) => {
            resizing = true;
            rsx = e.clientX; rsy = e.clientY;
            rw = panel.offsetWidth; rh = panel.offsetHeight;
            e.preventDefault();
            e.stopPropagation();
        });
        window.addEventListener('pointermove', (e) => {
            if (!resizing) return;
            panel.style.width = Math.min(Math.max(rw + e.clientX - rsx, 280), window.innerWidth - 20) + 'px';
            panel.style.height = Math.min(Math.max(rh + e.clientY - rsy, 220), window.innerHeight - 20) + 'px';
            if (naturalW && !maximized) fitToPanel();
        });
        window.addEventListener('pointerup', () => {
            if (!resizing) return;
            resizing = false;
            usSet(SIZE_KEY, JSON.stringify({ w: panel.offsetWidth, h: panel.offsetHeight }));
            if (naturalW) fitToPanel();
        });

        // --- 关闭按钮 / Esc ---
        const closeBtn = panel.querySelector('.iv-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (maximized) exitMaximized();
            else hide();
        });
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !isOpen()) return;
            const t = e.target;
            if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
            if (maximized) exitMaximized(); else hide();
        });

        // --- 工具条 ---
        panel.querySelector('[data-act="zoomin"]').addEventListener('click', () => zoomCenter(1.25));
        panel.querySelector('[data-act="zoomout"]').addEventListener('click', () => zoomCenter(1 / 1.25));
        panel.querySelector('[data-act="fit"]').addEventListener('click', () => { if (naturalW) fitToPanel(); });

        // --- 滚轮：始终以鼠标为中心缩放 ---
        stage.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
        }, { passive: false });

        // --- 左键拖拽平移媒体 ---
        let panning = false, px0 = 0, py0 = 0, txx = 0, tyy = 0;
        stage.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            panning = true;
            px0 = e.clientX; py0 = e.clientY;
            txx = tx; tyy = ty;
            stage.classList.add('iv-grabbing');
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!panning) return;
            tx = txx + e.clientX - px0;
            ty = tyy + e.clientY - py0;
            applyTransform();
        });
        window.addEventListener('mouseup', () => {
            if (!panning) return;
            panning = false;
            stage.classList.remove('iv-grabbing');
        });

        // --- 双击最大化 <-> 还原 ---
        function enterMaximized() {
            maximized = true;
            savedGeom = { left: panel.style.left, top: panel.style.top, width: panel.style.width, height: panel.style.height };
            panel.classList.add('iv-max');
            panel.style.left = '8px';
            panel.style.top = '8px';
            panel.style.width = (window.innerWidth - 16) + 'px';
            panel.style.height = (window.innerHeight - 16) + 'px';
            closeBtn.textContent = '⤡';
            closeBtn.title = '退出最大化 (Esc)';
            if (naturalW) fitToPanel();
        }
        function exitMaximized() {
            maximized = false;
            panel.classList.remove('iv-max');
            if (savedGeom) {
                panel.style.left = savedGeom.left;
                panel.style.top = savedGeom.top;
                panel.style.width = savedGeom.width;
                panel.style.height = savedGeom.height;
            }
            closeBtn.textContent = '✕';
            closeBtn.title = '关闭 (Esc)';
            if (naturalW) fitToPanel();
        }
        panel.addEventListener('dblclick', (e) => {
            if (e.target.closest('button') || e.target === vidEl) return; // 不干扰视频控件
            e.preventDefault();
            e.stopPropagation();
            if (maximized) exitMaximized(); else enterMaximized();
        });

        imgEl.addEventListener('load', () => {
            naturalW = imgEl.naturalWidth || 1;
            naturalH = imgEl.naturalHeight || 1;
            fitToPanel();
        });

        vidEl.addEventListener('loadedmetadata', () => {
            if (!mediaIsVideo) return;
            naturalW = vidEl.videoWidth || 640;
            naturalH = vidEl.videoHeight || 360;
            fitToPanel();
        });

        panel.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    function isOpen() { return !!(panel && panel.style.display !== 'none'); }

    function openPanel() {
        if (!panel) build();
        // fixed 坐标系下钳制到当前视口，绝不允许默认在 (0,0)
        const pw = parseFloat(panel.style.width) || 480;
        const ph = parseFloat(panel.style.height) || 380;
        let x = parseFloat(panel.style.left), y = parseFloat(panel.style.top);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < -pw + 80 || y < -10 || x > window.innerWidth - 100 || y > window.innerHeight - 80) {
            const d = defaultPos();
            x = d.x; y = d.y;
        }
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.display = 'flex';
        panel.style.zIndex = 100010;
    }

    function hide() {
        if (panel) {
            if (maximized) exitMaximized();
            panel.style.display = 'none';
            try { if (vidEl) vidEl.pause(); } catch (e) {}
        }
    }

    function isVideoUrl(u) {
        if (!u) return false;
        const clean = u.split('?')[0].split('#')[0].toLowerCase();
        return /\.(mp4|webm|ogv|ogg|mov|m4v|avi|mkv)$/.test(clean);
    }

    function stopMedia() {
        try { if (vidEl) { vidEl.pause(); vidEl.removeAttribute('src'); vidEl.load(); } } catch (e) {}
        try { if (imgEl) imgEl.removeAttribute('src'); } catch (e) {}
    }

    function show(url) {
        if (url) lastUrl = url;
        openPanel();
        if (!imgEl || !vidEl) return;
        if (!lastUrl) {
            stopMedia();
            imgEl.style.display = 'none';
            vidEl.style.display = 'none';
            emptyEl.style.display = 'grid';
            naturalW = naturalH = 0;
            mediaIsVideo = false;
            if (scaleLabel) scaleLabel.textContent = '--';
            updateToolbarState();
            return;
        }
        mediaIsVideo = isVideoUrl(lastUrl);
        emptyEl.style.display = 'none';
        scale = 1; tx = 0; ty = 0; naturalW = naturalH = 0;
        if (mediaIsVideo) {
            imgEl.style.display = 'none';
            vidEl.style.display = 'block';
            applyTransform();
            updateToolbarState();
            vidEl.src = lastUrl;
            vidEl.play().catch(function () {});
        } else {
            vidEl.style.display = 'none';
            stopMedia();
            imgEl.style.display = 'block';
            applyTransform();
            updateToolbarState();
            imgEl.src = lastUrl;
        }
    }

    function updateToolbarState() {
        if (!panel) return;
        var fitBtn = panel.querySelector('[data-act="fit"]');
        if (fitBtn) fitBtn.disabled = !!mediaIsVideo;
        var hint = panel.querySelector('.iv-hint');
        if (hint) hint.textContent = mediaIsVideo ? '视频模式 · 双击最大化 · 拖拽平移' : '双击最大化 · 滚轮缩放 · 拖拽平移';
    }

    window.ImageViewer = {
        show,
        hide,
        get isOpen() { return isOpen(); },
        get _lastUrl() { return lastUrl; }
    };
})();
