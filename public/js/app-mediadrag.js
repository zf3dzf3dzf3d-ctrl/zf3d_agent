// ========== app-mediadrag.js - 会话媒体拖拽上无限画布（无边框 + 四角等比缩放） ==========
// 1. 会话中消息里的 <img>/<video> 可直接拖拽（HTML5 原生拖拽）到无限画布
// 2. 落点生成无边框媒体节点（干净展示，可多图平铺）
// 3. 悬停时四角出现控制点，任意角拖动均等比缩放（保持原始宽高比）
// 4. 节点可整体拖动，位置/尺寸持久化到 localStorage
(function () {
    'use strict';

    var MEDIA_KEY = 'zf3d.mediaCanvasAssets.v1';
    var _seq = 0;

    function getView() {
        try { if (typeof App !== 'undefined' && App.canvasGetView) return App.canvasGetView(); } catch (e) {}
        return { x: 0, y: 0, scale: 1 };
    }

    // ---------- 会话媒体：原生拖拽支持 ----------
    function bindMediaDraggable() {
        document.addEventListener('dragstart', function (e) {
            var media = e.target;
            if (!media || (media.tagName !== 'IMG' && media.tagName !== 'VIDEO')) return;
            var inMsg = media.closest && media.closest('.msg-content, .msg, .chatbox-body');
            if (!inMsg) return;
            var src = media.currentSrc || media.src || '';
            if (!src) return;
            var type = media.tagName === 'VIDEO' ? 'video' : 'image';
            var alt = (media.getAttribute('alt') || media.getAttribute('title') || '生成结果').slice(0, 60);
            e.dataTransfer.setData('text/plain', src);
            try { e.dataTransfer.setData('application/x-zfmedia', JSON.stringify({ type: type, src: src, prompt: alt })); } catch (err) {}
            e.dataTransfer.effectAllowed = 'copy';
            media.style.cursor = 'grabbing';
        });
        document.addEventListener('dragend', function (e) {
            if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO')) e.target.style.cursor = '';
        });
    }

    // ---------- 画布落点 ----------
    function bindCanvasDrop() {
        var host = document.getElementById('canvasContent');
        if (!host) { setTimeout(bindCanvasDrop, 500); return; }
        // drop 绑在更外层容器，覆盖面更大
        var surface = host.parentElement || host;
        surface.addEventListener('dragover', function (e) {
            if (!e.dataTransfer.types || Array.prototype.indexOf.call(e.dataTransfer.types, 'application/x-zfmedia') === -1) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        surface.addEventListener('drop', function (e) {
            var raw = '';
            try { raw = e.dataTransfer.getData('application/x-zfmedia'); } catch (err) {}
            if (!raw) return;
            e.preventDefault(); e.stopPropagation();
            var info;
            try { info = JSON.parse(raw); } catch (err) { return; }
            if (!info || !info.src) return;
            var v = getView();
            var node = createMediaNode({
                type: info.type, src: info.src, prompt: info.prompt || '',
                x: e.clientX - v.x - 90, y: e.clientY - v.y - 90
            });
            // 【修复】画布上有媒体节点时隐藏「双击创建」引导提示
            try {
                var _hint = document.getElementById('canvasHint');
                if (_hint) _hint.style.display = 'none';
            } catch (err) {}
            // blob: 地址刷新后必失效 → 立即上传换持久 URL
            if (node && info.src && info.src.indexOf('blob:') === 0) {
                _persistBlobNode(node, info.src);
            }
        });
    }

    // ---------- blob 节点持久化：fetch blob → base64 上传 → 替换为服务器持久 URL ----------
    function _persistBlobNode(node, blobSrc) {
        try {
            fetch(blobSrc).then(function (r) { return r.ok ? r.blob() : null; }).then(function (blob) {
                if (!blob) return;
                var reader = new FileReader();
                reader.onload = function () {
                    fetch('/api/refboard-media-save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: 'canvas.png', dataBase64: reader.result })
                    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (res) {
                        if (res && res.ok && res.url && document.body.contains(node)) {
                            var img = node.querySelector('.media-node-el');
                            if (img) img.src = res.url;
                            node.dataset.src = res.url;
                            saveMediaNodes();
                        }
                    }).catch(function () {});
                };
                reader.readAsDataURL(blob);
            }).catch(function () {});
        } catch (e) {}
    }

    // ---------- 无边框媒体节点 ----------
    function createMediaNode(opts) {
        var host = document.getElementById('canvasContent');
        if (!host || !opts.src) return null;
        var node = document.createElement('div');
        node.className = 'media-canvas-node';
        node.id = 'medianode-' + (++_seq) + '-' + Date.now().toString(36);
        node.dataset.mediaType = opts.type || 'image';
        node.dataset.src = opts.src;
        node.dataset.prompt = opts.prompt || '';
        node.style.left = Math.max(20, opts.x || 80) + 'px';
        node.style.top = Math.max(20, opts.y || 80) + 'px';
        node.style.width = (opts.width || 260) + 'px';

        var inner;
        if ((opts.type || 'image') === 'video') {
            inner = '<video class="media-node-el" src="' + escAttr(opts.src) + '" controls loop muted playsinline draggable="false"></video>';
        } else {
            inner = '<img class="media-node-el" src="' + escAttr(opts.src) + '" draggable="false" alt="' + escAttr(opts.prompt) + '" />';
        }
        node.innerHTML =
            '<div class="media-node-actions">' +
            '<button class="media-act media-act-open" title="在新标签打开">↗</button>' +
            '<button class="media-act media-act-remove" title="从画布移除">×</button>' +
            '</div>' + inner +
            '<span class="media-h media-h-nw" data-dir="nw"></span>' +
            '<span class="media-h media-h-ne" data-dir="ne"></span>' +
            '<span class="media-h media-h-sw" data-dir="sw"></span>' +
            '<span class="media-h media-h-se" data-dir="se"></span>';
        host.appendChild(node);

        // 等比：加载完成后按自然比例设定高度
        var el = node.querySelector('.media-node-el');
        var fixRatio = function () {
            var nw = el.videoWidth || el.naturalWidth || 1;
            var nh = el.videoHeight || el.naturalHeight || 1;
            var w = parseFloat(node.style.width) || 260;
            node.style.height = Math.round(w * nh / nw) + 'px';
            saveMediaNodes();
        };
        if ((opts.type || 'image') === 'video') { el.addEventListener('loadedmetadata', fixRatio, { once: true }); }
        else if (el.complete && el.naturalWidth) { fixRatio(); }
        else { el.addEventListener('load', fixRatio, { once: true }); }

        node.querySelector('.media-act-remove').addEventListener('click', function (e) {
            e.stopPropagation(); node.remove(); saveMediaNodes();
            // 【修复】画布上不再有媒体节点时恢复「双击创建」提示
            try {
                if (!document.querySelector('.media-canvas-node') && !document.querySelector('.kite-node-image,.kite-node-video') &&
                    typeof App !== 'undefined' && App.showHint) App.showHint();
            } catch (err) {}
        });
        node.querySelector('.media-act-open').addEventListener('click', function (e) {
            e.stopPropagation(); window.open(node.dataset.src, '_blank');
        });

        bindNodeMove(node);
        bindCornerResize(node);
        saveMediaNodes();
        return node;
    }

    // ---------- 整体拖动 ----------
    function bindNodeMove(node) {
        var moving = false, sx, sy, ol, ot;
        node.addEventListener('pointerdown', function (e) {
            if (e.target.closest('.media-act') || e.target.classList.contains('media-h')) return;
            if (e.target.tagName === 'VIDEO') return; // 视频控制条交互优先
            moving = true; sx = e.clientX; sy = e.clientY;
            ol = parseFloat(node.style.left) || 0; ot = parseFloat(node.style.top) || 0;
            e.preventDefault();
        });
        window.addEventListener('pointermove', function (e) {
            if (!moving) return;
            node.style.left = (ol + e.clientX - sx) + 'px';
            node.style.top = (ot + e.clientY - sy) + 'px';
        });
        window.addEventListener('pointerup', function () {
            if (!moving) return; moving = false; saveMediaNodes();
        });
    }

    // ---------- 四角等比缩放 ----------
    function bindCornerResize(node) {
        var el = node.querySelector('.media-node-el');
        node.querySelectorAll('.media-h').forEach(function (h) {
            var resizing = false, dir = '', sx, sy, sw, sh, ol, ot, ratio;
            h.addEventListener('pointerdown', function (e) {
                resizing = true; dir = h.dataset.dir;
                sx = e.clientX; sy = e.clientY;
                sw = node.offsetWidth; sh = node.offsetHeight;
                ol = parseFloat(node.style.left) || 0; ot = parseFloat(node.style.top) || 0;
                ratio = (el.videoHeight || el.naturalHeight || 1) / (el.videoWidth || el.naturalWidth || 1);
                e.preventDefault(); e.stopPropagation();
            });
            window.addEventListener('pointermove', function (e) {
                if (!resizing) return;
                var dx = e.clientX - sx, dy = e.clientY - sy;
                var w = sw;
                if (dir === 'ne' || dir === 'se') w = sw + dx; else w = sw - dx;
                w = Math.max(80, w);
                var nh = Math.round(w * ratio);
                node.style.width = w + 'px';
                node.style.height = nh + 'px';
                if (dir === 'nw' || dir === 'sw') { node.style.left = (ol + (sw - w)) + 'px'; }
                if (dir === 'nw' || dir === 'ne') { node.style.top = (ot + (sh - nh)) + 'px'; }
            });
            window.addEventListener('pointerup', function () {
                if (!resizing) return; resizing = false; saveMediaNodes();
            });
        });
    }

    // ---------- 持久化 ----------
    function saveMediaNodes() {
        var host = document.getElementById('canvasContent');
        if (!host) return;
        var items = Array.prototype.map.call(host.querySelectorAll('.media-canvas-node'), function (n) {
            var el = n.querySelector('.media-node-el');
            var nw = el && (el.videoWidth || el.naturalWidth) || 1;
            var nh = el && (el.videoHeight || el.naturalHeight) || 1;
            return {
                type: n.dataset.mediaType, src: n.dataset.src, prompt: n.dataset.prompt || '',
                x: parseFloat(n.style.left) || 0, y: parseFloat(n.style.top) || 0,
                width: n.offsetWidth || 260, ratio: nh / nw
            };
        }).filter(function (i) { return i.src && i.src.indexOf('blob:') !== 0; }); // blob: 临时地址刷新后失效，不持久化
        try { localStorage.setItem(MEDIA_KEY, JSON.stringify(items)); } catch (e) {}
    }

    function loadMediaNodes() {
        var items = [];
        try { items = JSON.parse(localStorage.getItem(MEDIA_KEY) || '[]'); } catch (e) {}
        items.filter(function (i) { return i.src && i.src.indexOf('blob:') !== 0; }).forEach(function (i) { // 跳过失效的 blob: 旧数据
            createMediaNode({ type: i.type, src: i.src, prompt: i.prompt, x: i.x, y: i.y, width: i.width });
        });
    }

    function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

    // ---------- 样式：无边框 + 四角控制点 ----------
    var css = '' +
        '.media-canvas-node{position:absolute;border:none;border-radius:10px;overflow:visible;cursor:grab;user-select:none;}' +
        '.media-canvas-node:active{cursor:grabbing;}' +
        '.media-canvas-node .media-node-el{display:block;width:100%;height:100%;object-fit:cover;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:auto;}' +
        '.media-canvas-node video.media-node-el{object-fit:contain;background:transparent;}' +
        '.media-canvas-node .media-node-actions{position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transition:opacity .15s;z-index:3;}' +
        '.media-canvas-node:hover .media-node-actions{opacity:1;}' +
        '.media-act{width:22px;height:22px;border:none;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font-size:13px;cursor:pointer;line-height:1;}' +
        '.media-act:hover{background:rgba(0,0,0,.8);}' +
        '.media-h{position:absolute;width:14px;height:14px;border-radius:50%;background:#4da3ff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);opacity:0;transition:opacity .15s;z-index:4;cursor:nwse-resize;}' +
        '.media-canvas-node:hover .media-h{opacity:1;}' +
        '.media-h-nw{left:-7px;top:-7px;cursor:nwse-resize;}' +
        '.media-h-ne{right:-7px;top:-7px;cursor:nesw-resize;}' +
        '.media-h-sw{left:-7px;bottom:-7px;cursor:nesw-resize;}' +
        '.media-h-se{right:-7px;bottom:-7px;cursor:nwse-resize;}' +
        // 会话中的媒体暗示可拖拽
        '.msg-content img,.msg-content video{cursor:grab;}';
    function injectStyle() {
        var s = document.createElement('style');
        s.id = 'media-drag-style';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function init() {
        injectStyle();
        bindMediaDraggable();
        bindCanvasDrop();
        setTimeout(loadMediaNodes, 600);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    Object.assign(window, { createMediaCanvasNode: createMediaNode });
})();
