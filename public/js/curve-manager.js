/**
 * curve-manager.js
 * 画布贝塞尔曲线管理器
 *  - 在 #canvasContent 内维护一个 <svg> 层
 *  - 维护一组连接 (source 端点 + target 端点) → 渲染一条贝塞尔曲线
 *  - 提供 connect / disconnect / updateAll 接口
 *  - 端点可以是：
 *      A) 元素 id（chatbox id / image node id）→ 自动取元素中心
 *      B) 一个回调函数，返回 {x, y, side}  → 灵活支持气泡边缘中点
 *  - side: 'auto' (默认) / 'left' / 'right' / 'top' / 'bottom'
 */
(function (global) {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var layer = null;
    var defs = null;
    var connections = []; // [{id, source, target, pathEl, hitEl, endpointSrcEl, endpointDstEl}]

    function ensureLayer() {
        if (layer && layer.parentNode) return layer;
        var content = document.getElementById('canvasContent');
        if (!content) return null;
        layer = document.createElementNS(SVG_NS, 'svg');
        layer.setAttribute('class', 'curve-layer');
        layer.setAttribute('width', '10000');
        layer.setAttribute('height', '10000');
        layer.style.position = 'absolute';
        layer.style.top = '0';
        layer.style.left = '0';

        defs = document.createElementNS(SVG_NS, 'defs');
        var grad = document.createElementNS(SVG_NS, 'linearGradient');
        grad.setAttribute('id', 'curveGradient');
        grad.setAttribute('x1', '0%');
        grad.setAttribute('x2', '100%');
        var s1 = document.createElementNS(SVG_NS, 'stop');
        s1.setAttribute('offset', '0%');
        s1.setAttribute('stop-color', '#6c7ae0');
        var s2 = document.createElementNS(SVG_NS, 'stop');
        s2.setAttribute('offset', '100%');
        s2.setAttribute('stop-color', '#9b6dd6');
        grad.appendChild(s1);
        grad.appendChild(s2);
        defs.appendChild(grad);
        layer.appendChild(defs);

        content.appendChild(layer);
        return layer;
    }

    /**
     * 计算一个端点坐标（基于元素 id 或函数）
     * @param {string|function} endpoint
     * @param {string} side - 'left'/'right'/'top'/'bottom'/'auto'
     * @returns {{x:number, y:number}|null}
     */
    function resolveEndpoint(endpoint, side) {
        side = side || 'auto';
        if (typeof endpoint === 'function') {
            try {
                var p = endpoint();
                if (p && typeof p.x === 'number') return { x: p.x, y: p.y };
            } catch (e) { return null; }
            return null;
        }
        if (typeof endpoint === 'string') {
            // 优先查 image-node，再查 chatbox
            var el = document.getElementById(endpoint)
                  || (global.ImageNode && global.ImageNode.getById && global.ImageNode.getById(endpoint) && global.ImageNode.getById(endpoint).el);
            if (!el) return null;
            var r = el.getBoundingClientRect();
            var content = document.getElementById('canvasContent');
            if (!content) return null;
            var cr = content.getBoundingClientRect();
            // 转成 canvasContent 内部坐标
            var lx = r.left - cr.left;
            var ly = r.top - cr.top;
            var cx = lx + r.width / 2;
            var cy = ly + r.height / 2;

            // 根据 side 决定取边中点
            if (side === 'left')   return { x: lx, y: cy };
            if (side === 'right')  return { x: lx + r.width, y: cy };
            if (side === 'top')    return { x: cx, y: ly };
            if (side === 'bottom') return { x: cx, y: ly + r.height };

            // auto: 选距离目标端点更近的边
            // 暂返回中心，后续由 caller 决定
            return { x: cx, y: cy, _rect: { l: lx, t: ly, r: lx + r.width, b: ly + r.height, cx: cx, cy: cy } };
        }
        return null;
    }

    /**
     * 自动选择两个矩形之间的最优连线侧
     */
    function pickSides(rectA, rectB) {
        var aCx = rectA.cx, aCy = rectA.cy;
        var bCx = rectB.cx, bCy = rectB.cy;
        var dx = bCx - aCx;
        var dy = bCy - aCy;
        if (Math.abs(dx) > Math.abs(dy)) {
            // 水平主导：左右连接
            if (dx > 0) return { src: 'right', dst: 'left' };
            else        return { src: 'left',  dst: 'right' };
        } else {
            if (dy > 0) return { src: 'bottom', dst: 'top' };
            else        return { src: 'top',    dst: 'bottom' };
        }
    }

    function endpointAtSide(rect, side) {
        if (!rect) return null;
        switch (side) {
            case 'left':   return { x: rect.l, y: rect.cy };
            case 'right':  return { x: rect.r, y: rect.cy };
            case 'top':    return { x: rect.cx, y: rect.t };
            case 'bottom': return { x: rect.cx, y: rect.b };
            default:       return { x: rect.cx, y: rect.cy };
        }
    }

    /**
     * 计算贝塞尔 path
     *   M sx,sy
     *   C (sx + dxOut),sy   (tx - dxIn),ty   tx,ty
     */
    function buildBezierPath(sx, sy, tx, ty) {
        var dx = tx - sx;
        var dy = ty - sy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var c = Math.max(60, Math.min(280, dist * 0.45));
        // 水平走向时用水平控制点；垂直走向时用垂直控制点
        var horizontal = Math.abs(dx) > Math.abs(dy);
        if (horizontal) {
            return 'M ' + sx + ',' + sy +
                   ' C ' + (sx + c) + ',' + sy +
                     ' ' + (tx - c) + ',' + ty +
                     ' ' + tx + ',' + ty;
        } else {
            return 'M ' + sx + ',' + sy +
                   ' C ' + sx + ',' + (sy + c) +
                     ' ' + tx + ',' + (ty - c) +
                     ' ' + tx + ',' + ty;
        }
    }

    function createConn() {
        var pathEl = document.createElementNS(SVG_NS, 'path');
        pathEl.setAttribute('class', 'curve-path');
        var hitEl = document.createElementNS(SVG_NS, 'path');
        hitEl.setAttribute('class', 'curve-hit');
        var srcDot = document.createElementNS(SVG_NS, 'circle');
        srcDot.setAttribute('class', 'curve-endpoint');
        srcDot.setAttribute('r', '3.5');
        var dstDot = document.createElementNS(SVG_NS, 'circle');
        dstDot.setAttribute('class', 'curve-endpoint');
        dstDot.setAttribute('r', '3.5');
        layer.appendChild(hitEl);
        layer.appendChild(pathEl);
        layer.appendChild(srcDot);
        layer.appendChild(dstDot);
        return { pathEl: pathEl, hitEl: hitEl, srcDot: srcDot, dstDot: dstDot };
    }

    /**
     * 创建一个连接
     * @param {object} cfg - { source: id|fn, target: id|fn, animated: bool, onClick: fn }
     * @returns {string} connId
     */
    function connect(cfg) {
        ensureLayer();
        if (!layer) return null;
        var connId = 'conn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        var dom = createConn();
        var conn = {
            id: connId,
            source: cfg.source,
            target: cfg.target,
            sourceSide: cfg.sourceSide || 'auto',
            targetSide: cfg.targetSide || 'auto',
            animated: cfg.animated !== false,
            onClick: cfg.onClick || null,
            pathEl: dom.pathEl,
            hitEl: dom.hitEl,
            srcDot: dom.srcDot,
            dstDot: dom.dstDot
        };
        if (conn.onClick) {
            conn.hitEl.style.pointerEvents = 'stroke';
            conn.hitEl.style.cursor = 'pointer';
            conn.hitEl.addEventListener('click', function (e) {
                e.stopPropagation();
                conn.onClick(conn);
            });
        }
        connections.push(conn);
        updateConn(conn);
        if (conn.animated) {
            // 强制重排后加 class 触发动画
            conn.pathEl.getBoundingClientRect();
            conn.pathEl.classList.add('animated');
            // 动画结束后去掉 class，避免影响后续重绘
            setTimeout(function () { conn.pathEl.classList.remove('animated'); }, 800);
        }
        return connId;
    }

    function updateConn(conn) {
        // 解析两端
        var sRaw = resolveEndpoint(conn.source, 'auto');
        var tRaw = resolveEndpoint(conn.target, 'auto');
        if (!sRaw || !tRaw) {
            // 端点未就绪（DOM 还没挂上），隐藏
            conn.pathEl.setAttribute('d', '');
            conn.hitEl.setAttribute('d', '');
            return;
        }
        var sRect = sRaw._rect;
        var tRect = tRaw._rect;

        var srcPt, dstPt;
        if (sRect && tRect) {
            // auto 模式：根据两矩形位置自动选边
            var sides = pickSides(sRect, tRect);
            srcPt = endpointAtSide(sRect, sides.src);
            dstPt = endpointAtSide(tRect, sides.dst);
        } else {
            // 函数式端点直接用 (x, y)
            srcPt = { x: sRaw.x, y: sRaw.y };
            dstPt = { x: tRaw.x, y: tRaw.y };
        }

        var d = buildBezierPath(srcPt.x, srcPt.y, dstPt.x, dstPt.y);
        conn.pathEl.setAttribute('d', d);
        conn.hitEl.setAttribute('d', d);
        conn.srcDot.setAttribute('cx', srcPt.x);
        conn.srcDot.setAttribute('cy', srcPt.y);
        conn.dstDot.setAttribute('cx', dstPt.x);
        conn.dstDot.setAttribute('cy', dstPt.y);
    }

    function updateAll() {
        for (var i = 0; i < connections.length; i++) {
            updateConn(connections[i]);
        }
    }

    function disconnect(connId) {
        var idx = connections.findIndex(function (c) { return c.id === connId; });
        if (idx < 0) return;
        var c = connections[idx];
        c.pathEl.remove();
        c.hitEl.remove();
        c.srcDot.remove();
        c.dstDot.remove();
        connections.splice(idx, 1);
    }

    function disconnectByNode(nodeId) {
        // 移除所有 source 或 target 引用了 nodeId 的连接
        var toRemove = [];
        for (var i = 0; i < connections.length; i++) {
            var c = connections[i];
            var refsNode = false;
            if (typeof c.source === 'string' && c.source === nodeId) refsNode = true;
            if (typeof c.target === 'string' && c.target === nodeId) refsNode = true;
            if (refsNode) toRemove.push(c.id);
        }
        toRemove.forEach(function (id) { disconnect(id); });
    }

    function clear() {
        while (connections.length) disconnect(connections[connections.length - 1].id);
    }

    // 暴露 API
    global.CurveManager = {
        connect: connect,
        updateAll: updateAll,
        disconnect: disconnect,
        disconnectByNode: disconnectByNode,
        clear: clear
    };

    // 监听画布平移/缩放（throttle 到 rAF）
    var rafQueued = false;
    function scheduleUpdate() {
        if (rafQueued) return;
        rafQueued = true;
        requestAnimationFrame(function () {
            rafQueued = false;
            updateAll();
        });
    }
    // 暴露给 app-canvas 调用（如果它支持回调的话），否则监听 transform 变化
    document.addEventListener('canvasViewportChanged', scheduleUpdate);
    // 兜底：定时器每 500ms 同步一次（处理画布被外层 transform 但没派发事件的情况）
    setInterval(scheduleUpdate, 800);

})(window);
