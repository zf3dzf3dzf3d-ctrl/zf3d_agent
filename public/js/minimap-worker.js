// ========== minimap-worker.js - 小地图后台渲染线程（2026 后台化改造） ==========
// 目标：把 drawMinimap 的全部绘制 + 水动画 + 晃动物理搬进 Worker，
// 主线程只做 DOM 快照采集（低频、有缓存）和消息传递，彻底把
// 4-10ms/帧 的 Canvas 绘制 + reflow 从主线程剥离。
//
// 通信协议：
// 主线程 → Worker:
//   { type:'init', canvas: OffscreenCanvas, dpr }
//   { type:'snapshot', boxes:[{x,y,w,h,kind,status,tc,tcTag}], view:{x,y,scale}, vp:{w,h},
//                      hasContent, edges:[{kind:'pipeline'|'fg', pts:[[x,y]x4]}] }
//   { type:'kick', vx }              // 拖拽注水：外部注入水平速度
//   { type:'resize', w, h, dpr }
// Worker → 主线程:
//   { type:'boxRects', rects:[{x,y,w,h,idx}], bounds }   // 悬停热区 + 视口换算边界
'use strict';

var STATUS_COLORS = {
    error:     { fill: 'rgba(255, 85, 85, 0.75)',  stroke: 'rgba(255, 100, 100, 0.9)' },
    success:   { fill: 'rgba(30, 210, 130, 0.9)',   stroke: 'rgba(100, 255, 170, 1)' },
    sending:   { fill: 'rgba(255, 165, 0, 0.8)',   stroke: 'rgba(255, 200, 80, 1)' },
    queued:    { fill: 'rgba(255, 210, 60, 0.7)',  stroke: 'rgba(255, 220, 80, 0.9)' },
    collapsed: { fill: 'rgba(120, 120, 135, 0.3)', stroke: 'rgba(120, 120, 135, 0.25)' },
    active:    { fill: 'rgba(9, 132, 227, 0.8)',   stroke: 'rgba(9, 132, 227, 0.9)' },
    idle:      { fill: 'rgba(100, 160, 220, 0.4)', stroke: 'rgba(100, 160, 220, 0.25)' }
};

// 晃动物理状态（Worker 内持久化，key 为主线程传来的稳定 id）
var slosh = {}; // id -> { off, v }
function _slOf(id) {
    return slosh[id] || (slosh[id] = { off: 0, v: 0 });
}

var ctx = null, off = null, W = 0, H = 0, dpr = 1;
var lastSnap = null;          // 最近一次快照
var pendingDraw = false;      // 合并重绘
var waterUntil = 0;           // 水动画截止时间（Worker 自己的定时器）
var waterTimer = null;        // setInterval 22fps
var lastViewX = null, lastViewT = 0;
var dvxOverride = null;
var lastTcMap = {}, tcAnimMap = {};
var lastBoxRects = [], lastBounds = null;

function postRects(rects, bounds) {
    lastBoxRects = rects; lastBounds = bounds;
    self.postMessage({ type: 'boxRects', rects: rects, bounds: bounds });
}

function scheduleDraw() {
    if (pendingDraw) return;
    pendingDraw = true;
    setTimeout(function() { pendingDraw = false; draw(); }, 8);
}

// 水动画循环：Worker 用 setInterval（~22fps，与原 rAF 节流一致），不占主线程
function _startWaterLoop() {
    var _now = Date.now();
    if (_now > waterUntil) waterUntil = _now + 150;
    if (waterTimer) return;
    waterTimer = setInterval(function() {
        if (Date.now() > waterUntil) { clearInterval(waterTimer); waterTimer = null; draw(); return; }
        draw();
    }, 45);
}

function draw() {
    if (!ctx || !lastSnap) return;
    var snap = lastSnap;
    var w = W, h = H;
    if (w <= 0 || h <= 0) return;
    var boxes = snap.boxes || [];

    ctx.clearRect(0, 0, w, h);

    if (!boxes.length) {
        ctx.fillStyle = 'rgba(136, 136, 153, 0.4)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无对话框', w / 2, h / 2);
        postRects([], null);
        return;
    }

    var view = snap.view;
    var vw = snap.vp.w, vh = snap.vp.h;
    var vpMinX = -view.x / view.scale;
    var vpMinY = -view.y / view.scale;
    var vpMaxX = vpMinX + vw / view.scale;
    var vpMaxY = vpMinY + vh / view.scale;

    // ===== 晃动物理：视口平移速度 → 每块晃动速度注入（与原逻辑同源） =====
    var _nowT = Date.now();
    if (lastViewX === null) { lastViewX = view.x; lastViewT = _nowT; }
    var _dt = Math.max(8, _nowT - lastViewT) / 1000;
    var _dvx = (dvxOverride !== null) ? dvxOverride : (view.x - lastViewX) / _dt;
    dvxOverride = null;
    lastViewX = view.x; lastViewT = _nowT;

    var _slEnergy = false;
    boxes.forEach(function(b) {
        var _sl = _slOf(b.id);
        _sl.v += Math.max(-3000, Math.min(3000, _dvx)) * 0.000245;
        _sl.v += -_sl.off * 0.10 - _sl.v * 0.055;
        _sl.off += _sl.v;
        if (Math.abs(_sl.off) > 0.0004 || Math.abs(_sl.v) > 0.0004) _slEnergy = true;
    });
    if (_slEnergy) _startWaterLoop();

    // ===== 拖拽注水：盒子自身移动速度（主线程快照已带 x，直接差分） =====
    boxes.forEach(function(b) {
        if (b._lastX === undefined) { b._lastX = b.x; b._lastT = _nowT; }
        else {
            var _bdt = Math.max(8, _nowT - b._lastT) / 1000;
            var _bv = (b.x - b._lastX) / _bdt;
            b._lastX = b.x; b._lastT = _nowT;
            if (Math.abs(_bv) > 1) {
                var _sl2 = _slOf(b.id);
                _sl2.v += Math.max(-3000, Math.min(3000, _bv)) * 0.00042;
                lastViewX = view.x;
                _startWaterLoop();
            }
        }
    });

    // ===== 世界包围盒 =====
    var minX = vpMinX, minY = vpMinY, maxX = vpMaxX, maxY = vpMaxY;
    boxes.forEach(function(b) {
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
        if (b.y + b.h > maxY) maxY = b.y + b.h;
    });
    var pad = 30;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var worldW = Math.max(1, maxX - minX);
    var worldH = Math.max(1, maxY - minY);
    var s = Math.min(w / worldW, h / worldH);
    var offsetX = (w - worldW * s) / 2;
    var offsetY = (h - worldH * s) / 2;
    function w2m(px, py) { return { x: (px - minX) * s + offsetX, y: (py - minY) * s + offsetY }; }
    var bounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };

    var now = Date.now();
    var rects = [];

    // ===== 连线（画在盒子下面）=====
    var edges = snap.edges || [];
    if (edges.length) {
        ctx.strokeStyle = 'rgba(79, 156, 255, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 1]);
        edges.forEach(function(e) {
            if (e.kind === 'fg') { ctx.strokeStyle = 'rgba(255, 150, 50, 0.9)'; ctx.lineWidth = 1.2; ctx.setLineDash([]); }
            var p0 = w2m(e.pts[0][0], e.pts[0][1]);
            var p1 = w2m(e.pts[1][0], e.pts[1][1]);
            var p2 = w2m(e.pts[2][0], e.pts[2][1]);
            var p3 = w2m(e.pts[3][0], e.pts[3][1]);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
            ctx.stroke();
            if (e.kind !== 'fg') {
                // 蓝色管线带箭头
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(p3.x, p3.y);
                ctx.lineTo(p3.x - 4, p3.y - 2.5);
                ctx.lineTo(p3.x - 4, p3.y + 2.5);
                ctx.closePath();
                ctx.fillStyle = 'rgba(79, 156, 255, 0.95)';
                ctx.fill();
                ctx.setLineDash([2, 1]);
            }
        });
        ctx.setLineDash([]);
    }

    // ===== 盒子绘制 =====
    boxes.forEach(function(b, bi) {
        var p1 = w2m(b.x, b.y);
        var bw = Math.max(2, b.w * s);
        var bh = Math.max(2, b.h * s);

        if (b.kind) {
            // 非对话元素（kite 节点/面板/笔记/媒体/FlowGlam）
            var colorsMap = {
                note:     ['rgba(255, 160, 60, 0.55)', 'rgba(255, 190, 100, 0.9)'],
                panel:    ['rgba(170, 110, 255, 0.55)', 'rgba(190, 140, 255, 0.9)'],
                media:    ['rgba(80, 220, 130, 0.5)', 'rgba(120, 240, 160, 0.85)'],
                flowglam: ['rgba(80, 220, 130, 0.5)', 'rgba(120, 240, 160, 0.85)'],
                node:     ['rgba(60, 200, 220, 0.5)', 'rgba(110, 230, 245, 0.85)']
            };
            var cc = colorsMap[b.kind] || colorsMap.node;
            ctx.fillStyle = cc[0]; ctx.strokeStyle = cc[1];
            ctx.lineWidth = 1;
            ctx.fillRect(p1.x, p1.y, bw, bh);
            ctx.strokeRect(p1.x, p1.y, bw, bh);
            var tagMap = { note: '??', flowglam: '??', panel: '??', media: '??', node: '?' };
            var kiteTag = b.tag || tagMap[b.kind] || '?';
            if (bw >= 10 && bh >= 8) {
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.strokeText(kiteTag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.fillText(kiteTag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
            }
            rects.push({ x: p1.x - 3, y: p1.y - 3, w: bw + 6, h: bh + 6, idx: bi, kite: true });
            return;
        }

        // 对话框
        var status = b.status || 'idle';
        var colors = STATUS_COLORS[status] || STATUS_COLORS.idle;
        var alpha = (status === 'sending') ? 0.7 + 0.3 * Math.sin(now / 400) : 1;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colors.fill;
        ctx.fillRect(p1.x, p1.y, bw, bh);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = (status === 'sending' || status === 'error') ? 1 : 0.5;
        ctx.strokeRect(p1.x, p1.y, bw, bh);
        ctx.globalAlpha = 1;

        // 装水进度 + 晃动波浪 + 小鱼
        var _tcW = b.tc || 0;
        if (_tcW > 0) {
            var _est = b.waterEst || 30;
            var _lvl = Math.min(1, _tcW / _est);
            var _wh = bh * _lvl;
            var _wy = p1.y + bh - _wh;
            ctx.save();
            ctx.beginPath(); ctx.rect(p1.x, p1.y, bw, bh); ctx.clip();
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y + bh);
            var _wavT = now / 320;
            var _slState = _slOf(b.id);
            var _sl = _slState.off;
            var _slTilt = _sl * bw * 0.245;
            var _slGain = 1.7 - Math.min(1.4, Math.abs(_sl) * 90);
            _slGain = Math.max(0.12, _slGain * 0.75);
            var _slAmp = Math.min(bh * 0.22, Math.abs(_sl) * bw * 2.4);
            for (var _wx = 0; _wx <= bw; _wx += 2) {
                var _u = 2 * _wx / bw - 1;
                var _parab = _slAmp * (0.5 - 0.5 * _u * _u);
                var _slY = -_slTilt * (0.5 - _wx / bw) + Math.sin(_wx * 0.55 + _wavT + _sl * 6) * 0.77 * _slGain + _parab;
                ctx.lineTo(p1.x + _wx, _wy + _slY);
            }
            ctx.lineTo(p1.x + bw, p1.y + bh);
            ctx.closePath();
            ctx.fillStyle = 'rgba(64, 158, 255, 0.40)';
            ctx.fill();
            ctx.restore();

            // 小鱼（每 10 次进一阶段，2.6 秒游动）
            var _fishStage = Math.floor(_tcW / 10);
            var _fishKey = 'fish_' + b.id;
            if (!slosh[_fishKey]) slosh[_fishKey] = { stage: 0 };
            var _fst = slosh[_fishKey];
            if (_fishStage > _fst.stage) { _fst.stage = _fishStage; _fst.start = now; _startWaterLoop(); }
            if (_tcW === 0 && _fst.stage) _fst.stage = 0;
            if (_fst.start && (now - _fst.start) < 2600) {
                var _fT = (now - _fst.start) / 2600;
                var _fx = p1.x + bw * (0.2 + 0.6 * _fT);
                var _fy = _wy - 3;
                var _fsz = Math.min(bw * 0.4, 9);
                var _dir = Math.sin(_fT * Math.PI * 3) >= 0 ? 1 : -1;
                ctx.save();
                ctx.translate(_fx, _fy);
                ctx.scale(_dir, 1);
                ctx.globalAlpha = Math.min(1, _fT * 6) * Math.min(1, (1 - _fT) * 6);
                ctx.fillStyle = 'rgba(255, 170, 60, 0.9)';
                ctx.beginPath();
                ctx.ellipse(0, 0, _fsz * 0.55, _fsz * 0.3, 0, 0, Math.PI * 2);
                ctx.fill();
                var _tail = Math.sin(now / 90) * _fsz * 0.18;
                ctx.beginPath();
                ctx.moveTo(-_fsz * 0.45, 0);
                ctx.lineTo(-_fsz * 0.85, -_fsz * 0.3 + _tail);
                ctx.lineTo(-_fsz * 0.85, _fsz * 0.3 + _tail);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#222';
                ctx.beginPath();
                ctx.arc(_fsz * 0.3, -_fsz * 0.08, Math.max(0.6, _fsz * 0.07), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                _startWaterLoop();
            }
            if (_lvl < 1 || Math.abs(_slState.off) > 0.0004 || Math.abs(_slState.v) > 0.0004) {
                _startWaterLoop();
            }
        }

        // 右上角调用计数 + 动画
        if (_tcW > 0) {
            var _cid = b.id;
            if (_tcW === 0) { delete lastTcMap[_cid]; delete tcAnimMap[_cid]; }
            if (lastTcMap[_cid] === undefined) lastTcMap[_cid] = _tcW;
            if (_tcW > lastTcMap[_cid]) { tcAnimMap[_cid] = now; _startWaterLoop(); }
            lastTcMap[_cid] = _tcW;

            var _tcTxt = String(_tcW);
            ctx.save();
            ctx.font = 'bold 8px sans-serif';
            var _tw = ctx.measureText(_tcTxt).width;
            var _bw2 = _tw + 4, _bh2 = 9;
            var _bx = p1.x + bw - _bw2, _by = p1.y - 4;
            if (_bx < p1.x) _bx = p1.x;
            if (_by < 0) _by = 0;
            var _animT = tcAnimMap[_cid] ? (now - tcAnimMap[_cid]) : 9999;
            var _scale = 1;
            if (_animT < 250) {
                var _t = _animT / 250;
                _scale = 1 + 0.6 * Math.sin(_t * Math.PI) * (1 - _t * 0.5);
            }
            if (_scale !== 1) {
                ctx.translate(_bx + _bw2 / 2, _by + _bh2 / 2);
                ctx.scale(_scale, _scale);
                ctx.translate(-(_bx + _bw2 / 2), -(_by + _bh2 / 2));
            }
            ctx.fillStyle = 'rgba(255, 90, 90, 0.95)';
            ctx.fillRect(_bx, _by, _bw2, _bh2);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillText(_tcTxt, _bx + 2, _by + 0.5);
            ctx.restore();
            if (_animT < 500) {
                var _wt = _animT / 500;
                ctx.save();
                ctx.globalAlpha = 0.7 * (1 - _wt);
                ctx.strokeStyle = '#ffcf4d';
                ctx.lineWidth = 2 * (1 - _wt) + 0.5;
                ctx.beginPath();
                ctx.arc(_bx + _bw2 / 2, _by + _bh2 / 2, 4 + _wt * 14, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
            if (_animT < 700) {
                var _ft = _animT / 700;
                ctx.save();
                ctx.globalAlpha = 1 - _ft * _ft;
                ctx.font = 'bold ' + (9 + 4 * _ft) + 'px sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                ctx.shadowColor = '#ffcf4d';
                ctx.shadowBlur = 6 * (1 - _ft);
                var _fx2 = p1.x + bw - _bw2 / 2;
                var _fy2 = _by - 2 - _ft * 12;
                ctx.strokeText('+1', _fx2, _fy2);
                ctx.fillStyle = '#ffcf4d';
                ctx.fillText('+1', _fx2, _fy2);
                ctx.restore();
                _startWaterLoop();
            }
        }

        // 模型标签
        if (b.tcTag && bw >= 10 && bh >= 8) {
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.strokeText(b.tcTag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fillText(b.tcTag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
        }
        rects.push({ x: p1.x - 3, y: p1.y - 3, w: bw + 6, h: bh + 6, idx: bi, kite: false });
    });

    // ===== 当前视口矩形 =====
    var vp1 = w2m(vpMinX, vpMinY);
    var vp2 = w2m(vpMaxX, vpMaxY);
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(vp1.x, vp1.y, vp2.x - vp1.x, vp2.y - vp1.y);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 200, 80, 0.06)';
    ctx.fillRect(vp1.x, vp1.y, vp2.x - vp1.x, vp2.y - vp1.y);

    postRects(rects, bounds);

    // 每帧把离屏画面转成 ImageBitmap 回传主线程（异步 transfer，零拷贝）
    try {
        if (off && typeof off.transferToImageBitmap === 'function') {
            var bmp = off.transferToImageBitmap();
            self.postMessage({ type: 'frame', bitmap: bmp }, [bmp]);
        }
    } catch (err) {}
}

self.onmessage = function(e) {
    var msg = e.data || {};
    if (msg.type === 'init') {
        dpr = msg.dpr || 1;
        W = msg.w || 0; H = msg.h || 0;
        try {
            // 自建离屏画布（主线程画布控制权保留在主线程，可安全降级）
            off = new OffscreenCanvas(Math.max(1, W), Math.max(1, H));
            ctx = off.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } catch (err) { ctx = null; }
        return;
    }
    if (msg.type === 'resize') {
        W = msg.w; H = msg.h; dpr = msg.dpr || dpr;
        try {
            if (off && typeof OffscreenCanvas !== 'undefined') {
                off.width = Math.max(1, W); off.height = Math.max(1, H);
                ctx = off.getContext('2d');
            }
            if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } catch (err) {}
        draw();
        return;
    }
    if (msg.type === 'kick') {
        dvxOverride = Math.max(-3000, Math.min(3000, msg.vx || 0));
        _startWaterLoop();
        return;
    }
    if (msg.type === 'snapshot') {
        lastSnap = msg;
        scheduleDraw();
        return;
    }
};
