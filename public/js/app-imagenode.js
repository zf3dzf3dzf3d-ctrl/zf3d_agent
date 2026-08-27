// ========== app-imagenode.js - 画布图片节点 + 动态连线 ==========
// 在画布上创建可拖拽、可调大小的图片框
// 并在 chatbox 与图片框之间绘制动态贝塞尔曲线连接
// 依赖：App 已加载（Object.assign 在文件末尾统一合并）

(function () {
    'use strict';

    const _connections = new Set();
    const IMAGE_ASSET_STORAGE_KEY = 'zf3d.imageCanvasAssets.v1';
    let _imgNodeIdCounter = 0;
    let _lineIdCounter = 0;

    function getNodeAnchors(el) {
        if (!el) return null;
        const left = parseFloat(el.style.left) || el.offsetLeft || 0;
        const top = parseFloat(el.style.top) || el.offsetTop || 0;
        const w = el.offsetWidth || 280;
        const h = el.offsetHeight || 280;
        return {
            x: left + w / 2, y: top + h / 2,
            left: { x: left, y: top + h / 2 },
            right: { x: left + w, y: top + h / 2 },
            top: { x: left + w / 2, y: top },
            bottom: { x: left + w / 2, y: top + h }
        };
    }

    function createImageCanvasNode(fromBox, imgUrl, prompt, assetMeta) {
        if (!App || !App.canvasContent) {
            // console.error('[imagenode] App.canvasContent 不存在');
            return null;
        }
        const canvas = App.canvasContent;
        const fromAnchors = getNodeAnchors(fromBox);
        if (!fromAnchors && !assetMeta) {
            // console.error('[imagenode] fromBox 无效');
            return null;
        }
        const startX = Number.isFinite(Number(assetMeta && assetMeta.x)) ? Number(assetMeta.x) : (fromAnchors ? fromAnchors.right.x + 60 : 80);
        const startY = Number.isFinite(Number(assetMeta && assetMeta.y)) ? Number(assetMeta.y) : (fromAnchors ? fromAnchors.right.y - 140 : 80);
        const w = Number.isFinite(Number(assetMeta && assetMeta.width)) ? Number(assetMeta.width) : 280;
        const h = Number.isFinite(Number(assetMeta && assetMeta.height)) ? Number(assetMeta.height) : 320;
        const node = document.createElement('div');
        node.className = 'img-canvas-node';
        node.id = 'imgnode-' + (++_imgNodeIdCounter) + '-' + Date.now().toString(36);
        node.dataset.fromChatId = fromBox ? fromBox.id : ((assetMeta && assetMeta.fromChatId) || '');
        node.dataset.imageUrl = imgUrl || '';
        node.dataset.prompt = prompt || '';
        node.dataset.model = (assetMeta && assetMeta.model) || '';
        node.dataset.channel = (assetMeta && (assetMeta.channel || assetMeta.channelName)) || '';
        node.style.left = startX + 'px';
        node.style.top = Math.max(20, startY) + 'px';
        node.style.width = w + 'px';
        node.style.height = h + 'px';
        node.innerHTML = `
            <div class="img-node-header">
                <span class="img-node-icon">🖼</span>
                <span class="img-node-title" title="${(prompt || '').replace(/"/g, '&quot;')}">${escapeHtml(truncate(prompt || '生图结果', 18))}</span>
                <button class="img-node-action img-node-regenerate" title="使用当前提示词重新生成" aria-label="重新生成">↻</button>
                <button class="img-node-action img-node-edit" title="修改提示词并生成" aria-label="修改图片">✎</button>
                <button class="img-node-close" title="关闭">×</button>
            </div>
            <div class="img-node-body"><img class="img-node-img" src="${escapeAttr(imgUrl)}" draggable="false" /></div>
            <div class="img-node-resize" title="拖动调整大小"></div>
        `;
        canvas.appendChild(node);
        bindNodeDrag(node);
        bindNodeResize(node);
        node.querySelector('.img-node-close').addEventListener('click', (e) => {
            e.stopPropagation();
            removeImageNode(node);
        });
        node.querySelector('.img-node-regenerate').addEventListener('click', (e) => {
            e.stopPropagation();
            regenerateImageNode(node, node.dataset.prompt || '', false);
        });
        node.querySelector('.img-node-edit').addEventListener('click', (e) => {
            e.stopPropagation();
            const change = window.prompt('请输入对图片的修改要求', '');
            if (change && change.trim()) regenerateImageNode(node, change.trim(), true);
        });
        node.querySelector('.img-node-img').addEventListener('dblclick', (e) => {
            e.stopPropagation();
            // 双击：打开全屏查看器（滚轮缩放/中键平移）
            if (window.ImageViewer) window.ImageViewer.show(node.dataset.imageUrl || imgUrl);
            else window.open(node.dataset.imageUrl || imgUrl, '_blank');
        });
        if (fromBox) drawConnectionLine(fromBox, node);
        requestAnimationFrame(() => node.classList.add('img-node-enter'));
        return node;
    }

    async function regenerateImageNode(node, instruction, isEdit) {
        if (!node || node.dataset.generating === '1') return;
        const oldPrompt = node.dataset.prompt || '';
        const prompt = isEdit && oldPrompt ? oldPrompt + '\n修改要求：' + instruction : instruction;
        if (!prompt.trim()) return;
        const buttons = node.querySelectorAll('.img-node-action');
        node.dataset.generating = '1';
        node.classList.add('img-node-generating');
        buttons.forEach(button => { button.disabled = true; });
        try {
            let model = '';
            try { model = UserSettings.get('zf3d_image_model') || ''; } catch (err) {}
            const response = await fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: isEdit ? 'edit' : 'generate',
                    prompt: isEdit ? '' : prompt,
                    source_prompt: isEdit ? oldPrompt : '',
                    instruction: isEdit ? instruction : '',
                    source_image: isEdit ? (node.dataset.imageUrl || node.dataset.imgUrl || '') : '',
                    size: '1024x1024',
                    model: model || null
                })
            });
            const result = await response.json();
            const data = result.data || {};
            if (!response.ok || !result.ok || !data.url) throw new Error(data.error || '图片生成失败');
            if (isEdit) {
                createImageCanvasNode(node, data.url, prompt, {
                    x: (parseFloat(node.style.left) || 0) + 40,
                    y: (parseFloat(node.style.top) || 0) + 40,
                    width: node.offsetWidth || 280,
                    height: node.offsetHeight || 320,
                    model: data.model || data.channel_name || node.dataset.model || '',
                    channel: data.channel || data.channel_name || node.dataset.channel || ''
                });
            } else {
                node.dataset.imageUrl = data.url;
            node.dataset.prompt = prompt;
            node.dataset.model = data.model || data.channel_name || node.dataset.model || '';
            node.dataset.channel = data.channel || data.channel_name || node.dataset.channel || '';
            node.querySelector('.img-node-img').src = data.url;
            const title = node.querySelector('.img-node-title');
            if (title) { title.textContent = truncate(prompt, 18); title.title = prompt; }
            saveImageNodes();
            updateConnectionsFor(node);
            }
        } catch (err) {
            window.alert(err.message || '图片生成失败');
        } finally {
            node.dataset.generating = '0';
            node.classList.remove('img-node-generating');
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    function saveImageNodes() {
        if (!App || !App.canvasContent) return;
        const assets = Array.from(App.canvasContent.querySelectorAll('.img-canvas-node')).map(node => ({
            imageUrl: node.dataset.imageUrl || '', prompt: node.dataset.prompt || '',
            model: node.dataset.model || '', channel: node.dataset.channel || '',
            fromChatId: node.dataset.fromChatId || '', x: parseFloat(node.style.left) || 0,
            y: parseFloat(node.style.top) || 0, width: node.offsetWidth || parseFloat(node.style.width) || 280,
            height: node.offsetHeight || parseFloat(node.style.height) || 320
        })).filter(asset => asset.imageUrl);
        try { localStorage.setItem(IMAGE_ASSET_STORAGE_KEY, JSON.stringify(assets)); } catch (err) { /* console.warn('[imagenode] 保存失败', err); */ }
    }

    function loadImageNodes() {
        if (!App || !App.canvasContent) return;
        let assets = [];
        try { assets = JSON.parse(localStorage.getItem(IMAGE_ASSET_STORAGE_KEY) || '[]'); } catch (err) {}
        assets.forEach(asset => {
            const fromBox = asset.fromChatId ? document.getElementById(asset.fromChatId) : null;
            createImageCanvasNode(fromBox, asset.imageUrl, asset.prompt, asset);
        });
    }

    function removeImageNode(node) {
        if (!node) return;
        Array.from(_connections).filter(connection => connection.from === node || connection.to === node).forEach(connection => removeConnection(connection));
        saveImageNodes();
        node.classList.add('img-node-leave');
        setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); saveImageNodes(); }, 220);
    }

    function bindNodeDrag(node) {
        const header = node.querySelector('.img-node-header');
        let dragging = false, startX, startY, origLeft, origTop;
        const onDown = (e) => {
            if (e.target.closest('.img-node-close, .img-node-action')) return;
            dragging = true;
            const p = getEventPoint(e);
            startX = p.x; startY = p.y;
            origLeft = parseFloat(node.style.left) || 0;
            origTop = parseFloat(node.style.top) || 0;
            node.classList.add('img-node-dragging');
            e.preventDefault(); e.stopPropagation();
        };
        const onMove = (e) => {
            if (!dragging) return;
            const p = getEventPoint(e);
            node.style.left = (origLeft + p.x - startX) + 'px';
            node.style.top = (origTop + p.y - startY) + 'px';
            updateConnectionsFor(node);
        };
        const onUp = () => { if (dragging) { dragging = false; node.classList.remove('img-node-dragging'); saveImageNodes(); } };
        header.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    function bindNodeResize(node) {
        const handle = node.querySelector('.img-node-resize');
        let resizing = false, startX, startY, startW, startH;
        const onDown = (e) => { resizing = true; const p = getEventPoint(e); startX = p.x; startY = p.y; startW = node.offsetWidth; startH = node.offsetHeight; e.preventDefault(); e.stopPropagation(); };
        const onMove = (e) => { if (!resizing) return; const p = getEventPoint(e); node.style.width = Math.max(160, startW + p.x - startX) + 'px'; node.style.height = Math.max(160, startH + p.y - startY) + 'px'; updateConnectionsFor(node); };
        const onUp = () => { if (resizing) { resizing = false; saveImageNodes(); } };
        handle.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    }

    function getEventPoint(e) { return { x: e.clientX, y: e.clientY }; }
    function truncate(text, length) { return String(text || '').length > length ? String(text).slice(0, length) + '…' : String(text || ''); }
    function escapeHtml(text) { return String(text || '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])); }
    function escapeAttr(text) { return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

    function drawConnectionLine(fromBox, toNode) {
        if (!fromBox || !toNode || typeof SVG_NS === 'undefined') return;
        const svg = document.getElementById('svg-layer');
        if (!svg) return;
        const line = document.createElementNS(SVG_NS, 'path');
        const dot = document.createElementNS(SVG_NS, 'circle');
        line.classList.add('img-connection-line'); dot.classList.add('img-connection-dot');
        svg.appendChild(line); svg.appendChild(dot);
        const connection = { from: fromBox, to: toNode, line, dot, id: 'line-' + (++_lineIdCounter) };
        _connections.add(connection); updateConnection(connection);
    }
    function removeConnection(connection) { if (!connection) return; connection.line.remove(); connection.dot.remove(); _connections.delete(connection); }
    function updateConnection(connection) { const a = getNodeAnchors(connection.from), b = getNodeAnchors(connection.to); if (!a || !b) return; const d = `M ${a.right.x} ${a.right.y} C ${a.right.x + 60} ${a.right.y}, ${b.left.x - 60} ${b.left.y}, ${b.left.x} ${b.left.y}`; connection.line.setAttribute('d', d); connection.dot.setAttribute('cx', b.left.x); connection.dot.setAttribute('cy', b.left.y); }
    function updateConnectionsFor(node) { _connections.forEach(connection => { if (connection.from === node || connection.to === node) updateConnection(connection); }); }
    function watchCanvasTransform() { window.addEventListener('resize', () => _connections.forEach(updateConnection)); }

    Object.assign(App, { createImageCanvasNode, saveImageNodes, loadImageNodes, _imageConnections: _connections, watchCanvasTransform });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { watchCanvasTransform(); loadImageNodes(); });
    else setTimeout(() => { watchCanvasTransform(); loadImageNodes(); }, 200);
    // console.log('[imagenode] 图片节点 + 连线模块已加载');  // 已去除
})();

