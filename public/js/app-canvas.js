
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  window.alert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

﻿// ========== app-canvas.js - 画布操作 + 右键菜单 ==========
Object.assign(App, {
        // ===== 画布：中键平移 + 滚轮缩放（transform 统一驱动，GPU 加速） =====
        setupCanvas: function() {
            var self = this;
            var area = document.getElementById('canvasArea');
            var content = document.getElementById('canvasContent');
            var coord = document.getElementById('canvasCoord');
            var view = { x: 0, y: 0, scale: 1 };

            // Define this before registering pointer handlers so initialization order cannot break left-drag.
            self._isCanvasBlankTarget = function(target) {
                if (!target || !target.closest) return true;
                if (target.closest('.chatbox')) return false;
                if (target.closest('#minimap')) return false;
                if (target.closest('#pixel-panel')) return false;
                if (target.closest('.kite-dragon')) return false;   // 风筝龙（含龙头/龙身）
                if (target.closest('.kite-node')) return false;    // 风筝画布节点（文本/图片/视频）
                if (target.closest('.kite-image-panel')) return false; // 双面板：文生图
                if (target.closest('.kite-aux-panel')) return false;   // 文生图关联：提示词/图片查看
                if (target.closest('.kite-chat-panel')) return false;   // 双面板：创建对话框
                if (target.closest('.kite-action-menu')) return false;
                if (target.closest('.browser-node')) return false;   // 内置浏览器节点（含地址栏，禁止画布抢事件）
                if (target.closest('.engine-node')) return false;    // 游戏引擎节点
                if (target.closest('.pres-node')) return false;      // 演示/PPT 节点  // 连线动作菜单
                if (target.closest('.video-node')) return false;     // AI 视频剪辑节点（禁止画布平移/框选抢事件）
                if (target.closest('.kite-modal')) return false;       // 放大预览层
                return true;
            };

            function apply() {
                var _pf0 = (window.Perf ? performance.now() : 0);
                content.style.transform = 'translate(' + Math.round(view.x) + 'px,' + Math.round(view.y) + 'px) scale(' + view.scale + ')';
                content.style.transformOrigin = '0 0'; // 缩放锚定左上角，配合手势层的锚点补偿
                if (coord) coord.textContent = 'x:' + Math.round(view.x) + ' · y:' + Math.round(view.y) + ' · ' + Math.round(view.scale * 100) + '%';
                if (self._minimapSloshKick && self._flyPx === undefined) self._flyPx = view.x; // 初始化水晃基准
                // 【平移卡顿优化】拖拽期间全量重绘节流到约9fps，与飞行动画路径一致；松手后有全量重绘兜底
                // 【平移卡顿优化】apply 内不再同步全量重绘小地图（全 DOM 扫描+强制 reflow，拖拽掉帧主因）。
                // 小地图由 mousemove 的 rAF 合并帧统一走 updateMinimap（自带 110ms 节流）。
                if (window.Perf && _pf0) Perf.mark('画布:平移apply', _pf0);
                // wb-canvas-view 派发也合并到 rAF：new Event 每帧同步派发会让所有监听者挤在同一帧
                try { window.dispatchEvent(new Event('wb-canvas-view')); } catch (e) {}

            }

            self.canvasScale = function() { return view.scale; };
            self.canvasGetView = function() { return { x: view.x, y: view.y, scale: view.scale }; };
            var _flyRaf = null;
            self.canvasSetView = function(x, y, scale, animate) {
                // 【修复】动画飞行改为 JS 逐帧插值（替代纯 CSS transition）：
                // 视口坐标每帧真实变化，水晃物理能感知平移速度，导航水面跟随摄像机摇晃
                // 【修复】即时定位（拖拽）必须先取消进行中的飞行动画，
                // 否则飞行 rAF 每帧把视口拽回旧目标，与 mousemove 写入打架 → 抖动不跟手
                if (!animate && _flyRaf) { cancelAnimationFrame(_flyRaf); _flyRaf = null; }
                if (animate) {
                    if (_flyRaf) cancelAnimationFrame(_flyRaf);
                    var fx = view.x, fy = view.y, t0 = performance.now(), dur = 400;
                    function _fly(now) {
                        var p = Math.min(1, (now - t0) / dur);
                        var e = 1 - Math.pow(1 - p, 3); // easeOutCubic
                        view.x = fx + (x - fx) * e;
                        view.y = fy + (y - fy) * e;
                        if (self._minimapSloshKick) {
                            var _pv = (self._flyPx === undefined) ? view.x : self._flyPx;
                            self._minimapSloshKick(-(view.x - _pv) / 0.016);
                            self._flyPx = view.x;
                        }
                        // 【水晃跟随】飞行/拖拽期间让小地图同步重绘，其内部水晃物理才能感知平移速度
                        // 【平移卡顿优化】拖拽期间完全跳过全量重绘小地图（含 DOM 全扫描+强制 reflow），
                    // 仅靠水晃物理自驱动；松手 stopDrag 时做一次兜底全量重绘
                    if (!dragging && self.updateMinimap && (!self._mmLastFullDraw || performance.now() - self._mmLastFullDraw > 110)) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); }
                        apply();
                        if (p < 1) { _flyRaf = requestAnimationFrame(_fly); }
                        else { _flyRaf = null; view.x = x; view.y = y; apply(); }
                    }
                    _flyRaf = requestAnimationFrame(_fly);
                    if (typeof Store !== 'undefined' && Store.saveCanvas) { Store.saveCanvas(x, y, 1); }
                    return; // FIX: animate must not jump to endpoint synchronously
                }
                view.x = x; view.y = y; view.scale = 1; // 强制 100%，忽略传入的 scale
                apply();
                // 同步保存画布状态到 Store
                if (typeof Store !== 'undefined' && Store.saveCanvas) {
                    Store.saveCanvas(x, y, view.scale);
                }
            };

            // 中键/左键空白处平移（rAF 节流，防止高频重排卡死）
            var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, rafId = 0;
            area.addEventListener('mousedown', function(e) {
                if (window.__kiteProxyDrag) return; // 正在拖拽风筝（头/身体）：禁止视口平移
                if (e.button === 1) {
                    // 中键：直接平移
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    ox = view.x; oy = view.y;
                    content.classList.add('dragging');
                    e.preventDefault();
                } else if (e.button === 0 && (e.ctrlKey || e.altKey) && self._isCanvasBlankTarget(e.target)) {
                    // Ctrl+左键：加选框选；Alt+左键：减选框选
                    e.preventDefault();
                    startMarquee(e.ctrlKey ? 'add' : 'sub');
                } else if (e.button === 0 && self._isCanvasBlankTarget(e.target)) {
                    // 左键：仅在画布空白区域平移（非对话框、非面板等）
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    ox = view.x; oy = view.y;
                    content.classList.add('dragging');
                    e.preventDefault();
                }
            });

            // ===== 框选：Ctrl+左键拖拽加选 / Alt+左键拖拽减选 =====
            function startMarquee(mode) {
                var rect = document.createElement('div');
                rect.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;border:1px solid #4f8cff;background:rgba(79,140,255,.14);display:none;';
                document.body.appendChild(rect);
                var mx = -1, my = -1, active = false;
                var baseSel = []; // 框选开始时的已选节点（加选/减选的基准）
                function applySel(x1, y1, x2, y2) {
                    var L = Math.min(x1, x2), R = Math.max(x1, x2);
                    var T = Math.min(y1, y2), B = Math.max(y1, y2);
                    rect.style.display = 'block';
                    rect.style.left = L + 'px'; rect.style.top = T + 'px';
                    rect.style.width = (R - L) + 'px'; rect.style.height = (B - T) + 'px';
                    var NODE_SEL = '.kite-node,.fg-node';
                    if (mode === 'sub') {
                        // 先恢复基准选中，再移除框内
                        document.querySelectorAll(NODE_SEL).forEach(function (n) {
                            if (baseSel.indexOf(n) === -1) n.classList.remove('selected');
                        });
                        baseSel.forEach(function (n) { n.classList.add('selected'); });
                    }
                    var hit = [];
                    document.querySelectorAll(NODE_SEL).forEach(function (n) {
                        var r = n.getBoundingClientRect();
                        var inside = r.left < R && r.right > L && r.top < B && r.bottom > T;
                        if (mode === 'add') {
                            if (inside) { n.classList.add('selected'); if (n.classList.contains('kite-node') && window.KiteCanvas && window.KiteCanvas.list) { var __k = window.KiteCanvas.list().find(function (m) { return m.id === n.dataset.id; }); if (__k && window.__KiteNS && window.__KiteNS.state) n.style.zIndex = ++window.__KiteNS.state.zIndex; } }
                        } else if (inside) hit.push(n);
                    });
                    if (mode === 'sub') hit.forEach(function (n) { n.classList.remove('selected'); });
                }
                function onMove(e) {
                    if (mx < 0) return;
                    if (!active && Math.abs(e.clientX - mx) < 4 && Math.abs(e.clientY - my) < 4) return; // 超过阈值才算框选
                    active = true;
                    applySel(mx, my, e.clientX, e.clientY);
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    rect.remove();
                    mx = my = -1;
                }
                mx = e.clientX; my = e.clientY; active = false;
                baseSel = Array.prototype.slice.call(document.querySelectorAll('.kite-node.selected,.fg-node.selected'));
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                view.x = ox + (e.clientX - sx);
                view.y = oy + (e.clientY - sy);
                if (self._minimapSloshKick) {
                    var _kn = performance.now();
                    var _kx = e.clientX - sx;
                    if (self._mmKickT) {
                        var _kdt = Math.max(8, _kn - self._mmKickT) / 1000;
                        self._minimapSloshKick(-(_kx - (self._mmKickX || 0)) / _kdt);
                    }
                    self._mmKickX = _kx; self._mmKickT = _kn;
                }
                if (!rafId) {
                    rafId = requestAnimationFrame(function() {
                        rafId = 0;                    // 【水晃跟随】小地图重绘由下方 110ms 节流控制，不逐帧同步
                    // 【平移卡顿优化】拖拽期间完全跳过全量重绘小地图（含 DOM 全扫描+强制 reflow），
                    // 仅靠水晃物理自驱动；松手 stopDrag 时做一次兜底全量重绘
                    if (!dragging && self.updateMinimap && (!self._mmLastFullDraw || performance.now() - self._mmLastFullDraw > 110)) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); }
                        apply();
                        // 3D 倾斜功能已彻底移除
                    });
                }
            });
            function stopDrag() {
                if (dragging) {
                    dragging = false; content.classList.remove('dragging');
                    self._mmKickT = 0; self._flyPx = undefined;
                    if (typeof Store !== 'undefined' && Store.saveCanvas) {
                        Store.saveCanvas(view.x, view.y, view.scale);
                    }
                    // 【平移卡顿优化】拖拽期间跳过了小地图全量重绘，松手时补一次兜底
                    if (self.updateMinimap) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); }
                }
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            }
            document.addEventListener('mouseup', function(e) {
                if (e.button === 1 || e.button === 0 || dragging) stopDrag();
            });
            window.addEventListener('blur', stopDrag);
            document.addEventListener('mouseleave', stopDrag);

            // 滚轮缩放已彻底禁用 — 始终保持 100%，阻止一切缩放行为
            // 但在可滚动的子元素（如对话框内容区）上滚动时，允许默认滚动行为
            var _scrollCache = new Map(); // 元素 -> {t, scrollable} 可滚动检测结果缓存
            area.addEventListener('wheel', function(e) {
                // Ctrl+滚轮（防浏览器缩放）：直接拦截，跳过可滚动区检测（省钱且行为不变）
                if (e.ctrlKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.SFX) SFX.play('zoom');
                    return;
                }
                // 检查事件目标是否在可滚动区域内（结果缓存 1000ms，避免每次滚轮都做 getComputedStyle 爬树触发强制重排）
                var el = e.target, now = Date.now();
                while (el && el !== area) {
                    var cached = _scrollCache.get(el);
                    if (!cached || now - cached.t > 5000) { // 5s cache: zero recompute during wheel bursts
                        var style = getComputedStyle(el);
                        cached = {
                            t: now,
                            overflowScrollable: (style.overflowY === 'auto' || style.overflowY === 'scroll')
                        };
                        _scrollCache.set(el, cached);
                    }
    if (cached.overflowScrollable && el.scrollHeight > el.clientHeight) { // cached style, live size
                        // 在可滚动区域内，检查是否已到达边界
                        var atTop = el.scrollTop <= 0;
                        var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
                        var deltaY = e.deltaY;
                        if ((atTop && deltaY < 0) || (atBottom && deltaY > 0)) {
                            // 到达边界，不阻止 — 允许事件冒泡
                        } else {
                            // 在可滚动区域中间滚动，让元素自己滚动
                            return; // 不阻止默认行为
                        }
                        break;
                    }
                    el = el.parentElement;
                }
                // 在画布空白区域或边界外，阻止默认滚轮行为（防缩放）
                e.preventDefault();
                e.stopPropagation();
            }, { passive: false });
            document.addEventListener('wheel', function(e) { if (e.ctrlKey) { e.preventDefault(); } }, { passive: false });
            // 阻止手势缩放（触屏 pinch）
            document.addEventListener('gesturestart', function(e) { e.preventDefault(); });
            document.addEventListener('gesturechange', function(e) { e.preventDefault(); });
            document.addEventListener('gestureend', function(e) { e.preventDefault(); });

            // ===== 触摸手势层（手机端）：单指平移 + 双指捏合缩放（锚点=两指中心） =====
            if ('ontouchstart' in window) {
                area.style.touchAction = 'none'; // 阻止浏览器默认滚动/回弹，由本层接管
                var tDist = 0, tScale = 0, tCx = 0, tCy = 0;
                function tDist2(touches) {
                    var dx = touches[0].clientX - touches[1].clientX;
                    var dy = touches[0].clientY - touches[1].clientY;
                    return Math.hypot(dx, dy);
                }
                area.addEventListener('touchstart', function(e) {
                    if (!self._isCanvasBlankTarget(e.target)) return; // 节点/面板上不抢手势
                    if (e.touches.length === 1) {
                        dragging = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
                        ox = view.x; oy = view.y;
                        content.classList.add('dragging');
                        e.preventDefault(); // 抑制合成 mouse 事件，避免二次平移
                    } else if (e.touches.length === 2) {
                        dragging = false; // 结束单指拖动，进入捏合
                        tDist = tDist2(e.touches);
                        tScale = view.scale;
                        tCx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                        tCy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                        e.preventDefault();
                    }
                }, { passive: false });
                area.addEventListener('touchmove', function(e) {
                    if (e.touches.length === 1 && dragging) {
                        view.x = ox + (e.touches[0].clientX - sx);
                        view.y = oy + (e.touches[0].clientY - sy);
                        if (self._minimapKick) self._minimapKick();
                        apply();
                        e.preventDefault();
                    } else if (e.touches.length === 2 && tDist > 0) {
                        var k = tDist2(e.touches) / tDist;
                        var ns = Math.min(4, Math.max(0.25, tScale * k));
                        var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                        var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                        // 锚点=两指中心：缩放前后中心对应的画布世界坐标不变
                        view.x = cx - (cx - view.x) * (ns / view.scale);
                        view.y = cy - (cy - view.y) * (ns / view.scale);
                        view.scale = ns;
                        apply();
                        e.preventDefault();
                    }
                }, { passive: false });
                area.addEventListener('touchend', function(e) {
                    if (e.touches.length === 0) {
                        if (dragging) { dragging = false; content.classList.remove('dragging'); }
                        tDist = 0;
                        if (typeof Store !== 'undefined' && Store.saveCanvas) Store.saveCanvas(view.x, view.y, view.scale);
                    } else if (e.touches.length === 1) {
                        // 双指松开一根 → 回到单指平移，重设基准防跳变
                        dragging = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
                        ox = view.x; oy = view.y; tDist = 0;
                    }
                });
            }

            // 阻止中键默认行为（自动滚动）
            // ===== viewport-culling: hide off-screen nodes for perf (desktop+mobile) =====
            var _cullTimer = null;
            function _cullNodes() {
                _cullTimer = null;
                try {
                    var vw = window.innerWidth, vh = window.innerHeight, pad = 300;
                    var nodes = document.querySelectorAll('.kite-node');
                    for (var i = 0; i < nodes.length; i++) {
                        var r = nodes[i].getBoundingClientRect();
                        var off = r.right < -pad || r.bottom < -pad || r.left > vw + pad || r.top > vh + pad;
                        if (off) { nodes[i].style.visibility = 'hidden'; nodes[i].style.contentVisibility = 'hidden'; }
                        else { nodes[i].style.visibility = ''; nodes[i].style.contentVisibility = ''; }
                    }
                } catch (e) { /* noop */ }
            }
            function _scheduleCull() { if (_cullTimer) return; _cullTimer = setTimeout(_cullNodes, 200); }
            window.addEventListener('scroll', _scheduleCull, { passive: true });
            window.addEventListener('resize', _scheduleCull, { passive: true });
            setInterval(_scheduleCull, 1500);
            setTimeout(_cullNodes, 800);

            // ===== touch-to-mouse bridge for nodes (mobile) =====
            if ('ontouchstart' in window) {
                var nTouchId = null;
                function synthMouse(type, x, y, target) {
                    var ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 });
                    (target || document).dispatchEvent(ev);
                    return ev;
                }
                document.addEventListener('touchstart', function(e) {
                    if (nTouchId !== null || e.touches.length !== 1) return;
                    var t = e.changedTouches[0];
                    var el = t.target && t.target.closest ? t.target.closest('.kite-node, .kite-panel') : null;
                    if (!el) return;
                    nTouchId = t.identifier;
                    synthMouse('mousedown', t.clientX, t.clientY, el);
                }, { passive: false });
                document.addEventListener('touchmove', function(e) {
                    if (nTouchId === null) return;
                    for (var i = 0; i < e.changedTouches.length; i++) {
                        if (e.changedTouches[i].identifier === nTouchId) {
                            e.preventDefault();
                            synthMouse('mousemove', e.changedTouches[i].clientX, e.changedTouches[i].clientY, document);
                        }
                    }
                }, { passive: false });
                var endNodeTouch = function(e) {
                    if (nTouchId === null) return;
                    for (var i = 0; i < e.changedTouches.length; i++) {
                        if (e.changedTouches[i].identifier === nTouchId) {
                            synthMouse('mouseup', e.changedTouches[i].clientX, e.changedTouches[i].clientY, document);
                            nTouchId = null;
                        }
                    }
                };
                document.addEventListener('touchend', endNodeTouch, { passive: false });
                document.addEventListener('touchcancel', endNodeTouch, { passive: false });
            }

            document.addEventListener('mousedown', function(e) { if (e.button === 1) e.preventDefault(); });
            document.addEventListener('auxclick', function(e) { if (e.button === 1) e.preventDefault(); });
        },

        // ===== 创建面板：左键双击画布空白处打开「创建对话框」面板（document 级 + 快速双击兜底） =====
        setupContextMenu: function() {
            var self = this;

            function _inCanvas(target) {
                var area = document.getElementById('canvasArea');
                return !!(area && target && area.contains(target));
            }

            function openCreatePanels(x, y, target) {
                // 空白判定放宽：target 缺失或判定函数异常时按空白处理，保证面板一定能弹出
                var blank = true;
                try { blank = typeof self._isCanvasBlankTarget === 'function' ? self._isCanvasBlankTarget(target) : true; }
                catch (err) { blank = true; }
                if (!blank) { return; }
                if (!window.KiteCanvas || typeof KiteCanvas.openDualPanels !== 'function') {
                    console.error('[创建面板] 失败：window.KiteCanvas / KiteCanvas.openDualPanels 缺失，kite 模块可能未加载。');
                    return;
                }
                try {
                    KiteCanvas.openDualPanels(x, y);
                    // 打开「创建对话框」面板时触发一次官方模型同步（fire-and-forget，不阻塞面板弹出）
                    fetch('/api/models/refresh', { cache: 'no-store' }).catch(function () {});
                } catch (err) {
                    console.error('[创建面板] openDualPanels 执行抛异常：', err);
                }
            }

            // 主通道：document 级 dblclick（不再绑在可能被子层覆盖/重建的 #canvasArea 上）
            document.addEventListener('dblclick', function(e) {
                if (Date.now() < (window._qcSuppressUntil||0)) { return; } // 兜底已弹出，抑制紧随的 dblclick
                _lastT = 0; // 消费兜底计数，防止重复触发
                var inC = _inCanvas(e.target);
                if (!inC) return;
                e.preventDefault();
                openCreatePanels(e.clientX, e.clientY, e.target);
            });

            // 兜底通道：dblclick 被拖拽/指针捕获/自定义手势吞掉时，
            // 用两次快速且位移极小的 click 模拟双击（去抖：350ms 内、位移 <6px）
            var _lastT = 0, _lastX = 0, _lastY = 0, _lastTarget = null;
            document.addEventListener('click', function(e) {
                var inC = _inCanvas(e.target);
                if (!inC) { _lastT = 0; return; }
                var now = Date.now();
                var gap = now - _lastT;
                var dx = Math.abs(e.clientX - _lastX), dy = Math.abs(e.clientY - _lastY);
                // 原生双击判定（detail>=2）或 快速两次近距 click，任一命中即弹
                if (e.detail >= 2 ||
                    (gap < 350 && gap >= 0 && dx < 6 && dy < 6)) {
                    _lastT = 0; // 消费掉，避免三连击触发两次
                    window._qcSuppressUntil = Date.now() + 500; // 抑制紧随的 dblclick，避免双开
                    openCreatePanels(e.clientX, e.clientY, _lastTarget || e.target);
                } else {
                    _lastT = now; _lastX = e.clientX; _lastY = e.clientY; _lastTarget = e.target;
                }
            }, true);
        },

        // ===== 网格排列对话框弹窗 =====
        showArrangeDialog: function() {
            var self = this;
            // 弹窗计数也排除折叠/收纳中的对话
            var visibleBoxes = (self.chatBoxes || []).filter(function(b) {
                return b && b.el && b.el.isConnected &&
                    !b.el.classList.contains('qn-gone') &&
                    b.el.style.display !== 'none';
            });
            var boxes = visibleBoxes;
            if (!boxes || boxes.length === 0) {
                var hasAny = (self.chatBoxes || []).length > 0;
                self._toast && self._toast(hasAny ? '可排列的对话框为空（折叠中的对话不参与排列）' : '没有可排列的对话框', 'info');
                return;
            }
            var existing = document.getElementById('arrangeOverlay');
            if (existing) existing.remove();

            // 创建遮罩 + 弹窗
            var overlay = document.createElement('div');
            overlay.id = 'arrangeOverlay';
            overlay.className = 'arrange-overlay';

            var html = '' +
                '<div class="arrange-dialog">' +
                    '<div class="arrange-dialog-header" id="arrangeDragHandle" title="按住左键拖动平移窗口">' +
                        '<span class="arrange-dialog-title">网格排列对话框</span>' +
                        '<button class="arrange-dialog-close" title="关闭">✕</button>' +
                    '</div>' +
                    '<div class="arrange-dialog-body">' +
                        '<div class="arrange-section-label">预设布局</div>' +
                        '<div class="arrange-presets arrange-presets-row">' +
                            '<button class="arrange-preset-btn" data-arrange="one-row">一排 · 间距200</button>' +
                        '</div>' +
                        '<div class="arrange-hint">共 ' + boxes.length + ' 个对话框（折叠中的不参与） · 按状态排序（发送中在前）</div>' +
                    '</div>' +
                '</div>';

            overlay.innerHTML = html;
            document.body.appendChild(overlay);

            // 【内存泄露修复】Esc 监听器从 closeDialog 统一移除，
            // 点 X / 点遮罩关闭时也能摘除，不再残留 keydown 监听钉住 overlay DOM
            var _escHandler = function(e) {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', _escHandler);
                    closeDialog();
                }
            };
            function closeDialog() {
                document.removeEventListener('keydown', _escHandler);
                overlay.remove();
            }
            overlay.querySelector('.arrange-dialog-close').addEventListener('click', closeDialog);
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) closeDialog();
            });
            document.addEventListener('keydown', _escHandler);

            // 预设按钮：一排 + 间距 200
            overlay.querySelectorAll('.arrange-preset-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    closeDialog();
                    self.arrangeChatBoxes({ cols: 9999, centerGap: 200 });
                });
            });

            // ---- 弹窗标题栏左键拖拽平移 ----
            (function() {
                var handle = overlay.querySelector('#arrangeDragHandle');
                var dialog = overlay.querySelector('.arrange-dialog');
                var drag = null;
                // 初始改为 fixed 定位模式：以当前位置为起点
                function beginDrag(e) {
                    if (e.button !== 0) return;
                    if (e.target.closest('.arrange-dialog-close')) return;
                    e.preventDefault();
                    var r = dialog.getBoundingClientRect();
                    dialog.style.position = 'fixed';
                    dialog.style.left = r.left + 'px';
                    dialog.style.top = r.top + 'px';
                    dialog.style.margin = '0';
                    drag = { sx: e.clientX, sy: e.clientY, l: r.left, t: r.top };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', endDrag);
                }
                function onMove(e) {
                    if (!drag) return;
                    dialog.style.left = (drag.l + e.clientX - drag.sx) + 'px';
                    dialog.style.top = (drag.t + e.clientY - drag.sy) + 'px';
                }
                function endDrag() {
                    drag = null;
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', endDrag);
                }
                handle.addEventListener('mousedown', beginDrag);
            })();
        },

        // ===== 排列所有对话框（支持网格参数） =====
        // opts.cols = 每行几个，opts.gap = 间距
        arrangeChatBoxes: function(opts) {
            var self = this;
            // 排除被随手标题折叠/钉住收纳的对话（qn-gone = 已收起隐藏），避免排列打乱它们
            var allBoxes = (self.chatBoxes || []).filter(function(b) {
                return b && b.el && b.el.isConnected &&
                    !b.el.classList.contains('qn-gone') &&
                    b.el.style.display !== 'none';
            });
            var boxes = allBoxes;
            if (!boxes || boxes.length === 0) {
                // 兜底：若全部被收纳，提示用户而非报错
                var hasAny = (self.chatBoxes || []).length > 0;
                self._toast && self._toast(hasAny ? '可排列的对话框为空（折叠中的对话不参与排列）' : '没有可排列的对话框', 'info');
                return;
            }

            opts = opts || {};
            var cols = opts.cols || 3;
            var gap = opts.gap != null ? opts.gap : 20;

            // 按状态排序：发送中的在前，空闲的在后
            var sorted = boxes.slice().sort(function(a, b) {
                if (a.isSending && !b.isSending) return -1;
                if (!a.isSending && b.isSending) return 1;
                return (a.createdAt || 0) - (b.createdAt || 0);
            });

            var boxWidth = 370;
            var boxHeight = 520;
            var startX = 20;
            var startY = 20;

            var view = self.canvasGetView ? self.canvasGetView() : { x: 0, y: 0 };

            // ---- 记录排列前各对话的原始位置（用于保持标题-对话相对位置不变） ----
            var prevPos = {};
            boxes.forEach(function (chat) {
                if (!chat.el) return;
                prevPos[chat.id] = {
                    x: parseFloat(chat.el.style.left) || chat.el.offsetLeft || 0,
                    y: parseFloat(chat.el.style.top) || chat.el.offsetTop || 0
                };
            });

            // 两遍扫描：先收集每行宽度累加位置与行内最大高度，再统一落位（宽度不同的对话框也不重叠）
            var rowsInfo = [];
            sorted.forEach(function(chat) {
                if (!chat.el) return;
                var w = chat.el.offsetWidth || boxWidth;
                var h = chat.el.offsetHeight || boxHeight;
                var row = rowsInfo.length ? rowsInfo[rowsInfo.length - 1] : null;
                if (!row || row.items.length >= cols) {
                    row = { items: [], x: startX, maxH: 0 };
                    rowsInfo.push(row);
                }
                row.items.push({ chat: chat, x: row.x, w: w });
                // centerGap 模式：直接按中心距步进（下一个左 = 当前左 + 中心距）；否则按 边缘间距 模式
                row.x += opts.centerGap ? opts.centerGap : (w + gap);
                if (h > row.maxH) row.maxH = h;
            });

            // 第二遍：按行的实际高度累加 y
            var accY = startY;
            rowsInfo.forEach(function(row) {
                row.items.forEach(function(it) {
                    var chat = it.chat;
                    chat.el.style.left = (it.x - view.x) + 'px';
                    chat.el.style.top = (accY - view.y) + 'px';
                    if (typeof Store !== 'undefined' && Store.saveChatBox) {
                        Store.saveChatBox(chat);
                    }
                });
                accY += row.maxH + gap;
            });

            // ---- 跟随排列：绑定了对话框的随手标题跟着对话一起平移 ----
            // 原则：标题相对参照物（绑定的对话 / 父标题）的原始偏移量保持不变，
            //       排列前在对话左上 50px，排列后仍在对话左上 50px（不强制左对齐/正上方）。
            try {
                if (window.QuickNoteLinks && typeof window.QuickNoteLinks.all === 'function') {
                    var linkMap = window.QuickNoteLinks.all() || {}; // {noteId: {chats:[], notes:[]}}
                    var notesApi = window.QuickNote && window.QuickNote._internal;
                    var movedNotes = {};   // noteId -> {el, left, top}
                    var gapAbove = Math.max(gap, 28); // 标题与对话框的最小垂直间距（防重叠兜底）

                    // 0) 快照所有相关标题排列前的原始位置（用于保持相对偏移）
                    var prevNotePos = {}; // noteId -> {x,y}
                    Object.keys(linkMap).forEach(function (noteId) {
                        var ne = document.querySelector('.quick-note[data-qn-id="' + noteId + '"]');
                        if (ne) prevNotePos[noteId] = {
                            x: parseFloat(ne.style.left) || ne.offsetLeft || 0,
                            y: parseFloat(ne.style.top) || ne.offsetTop || 0
                        };
                    });

                    // 1) 绑定对话框的标题：随第一个可见绑定对话平移，保留原始相对偏移
                    Object.keys(linkMap).forEach(function (noteId) {
                        var lk = linkMap[noteId];
                        var ne = document.querySelector('.quick-note[data-qn-id="' + noteId + '"]');
                        if (!ne) return;
                        var chats = (lk && lk.chats) || [];
                        for (var ci = 0; ci < chats.length; ci++) {
                            var hit = sorted.find(function (c) { return c.id === chats[ci] && c.el && c.el.isConnected; });
                            if (hit) {
                                var chatId = hit.id;
                                var newX = parseFloat(hit.el.style.left) || hit.el.offsetLeft;
                                var newY = parseFloat(hit.el.style.top) || hit.el.offsetTop;
                                if (prevPos[chatId]) {
                                    // 新位置 = 对话新位置 + (标题原位置 - 对话原位置)
                                    ne.style.left = (newX + ((parseFloat(ne.style.left) || ne.offsetLeft || 0) - prevPos[chatId].x)) + 'px';
                                    ne.style.top = (newY + ((parseFloat(ne.style.top) || ne.offsetTop || 0) - prevPos[chatId].y)) + 'px';
                                } else {
                                    // 排列前对话不可见（无原始位置），退回正上方规则
                                    ne.style.left = newX + 'px';
                                    ne.style.top = (newY - (ne.offsetHeight || 30) - gapAbove) + 'px';
                                }
                                movedNotes[noteId] = { el: ne, left: ne.style.left, top: ne.style.top };
                                break;
                            }
                        }
                    });

                    // 2) 标题连标题：子标题随父标题平移，保留原始相对偏移（多轮处理支持链式父子）
                    (function followNoteChains() {
                        var pending = Object.keys(linkMap);
                        for (var round = 0; round < 20 && pending.length; round++) {
                            var remaining = [];
                            pending.forEach(function (noteId) {
                                if (movedNotes[noteId]) return;
                                var lk = linkMap[noteId];
                                var ne = document.querySelector('.quick-note[data-qn-id="' + noteId + '"]');
                                if (!ne) return;
                                var notes = (lk && lk.notes) || [];
                                var done = false;
                                for (var ni = 0; ni < notes.length; ni++) {
                                    var parentId = notes[ni];
                                    var parent = movedNotes[parentId];
                                    if (parent) {
                                        if (prevNotePos[parentId]) {
                                            // 新位置 = 父标题新位置 + (子标题原位置 - 父标题原位置)
                                            var px = parseFloat(parent.el.style.left) || parent.el.offsetLeft;
                                            var py = parseFloat(parent.el.style.top) || parent.el.offsetTop;
                                            var dx = (prevNotePos[noteId] ? (parseFloat(ne.style.left) || ne.offsetLeft || 0) : prevNotePos[parentId].x) - prevNotePos[parentId].x;
                                            var dy = (prevNotePos[noteId] ? (parseFloat(ne.style.top) || ne.offsetTop || 0) : prevNotePos[parentId].y) - prevNotePos[parentId].y;
                                            ne.style.left = (px + dx) + 'px';
                                            ne.style.top = (py + dy) + 'px';
                                        } else {
                                            // 父标题排列前无记录，退回正下方规则
                                            ne.style.left = parent.el.style.left;
                                            ne.style.top = (parent.el.offsetTop + (parent.el.offsetHeight || 30) + gapAbove) + 'px';
                                        }
                                        movedNotes[noteId] = { el: ne, left: ne.style.left, top: ne.style.top };
                                        done = true;
                                        break;
                                    }
                                }
                                if (!done) remaining.push(noteId);
                            });
                            if (remaining.length === pending.length) break; // 本轮无进展，防死循环
                            pending = remaining;
                        }
                    })();

                    // 3) 持久化标题新位置
                    if (notesApi && typeof notesApi.notes === 'function' && typeof notesApi.saveAll === 'function') {
                        var changed = false;
                        notesApi.notes().forEach(function (n) {
                            var m = movedNotes[n.id];
                            if (m) {
                                n.x = parseFloat(m.left) || 0;
                                n.y = parseFloat(m.top) || 0;
                                if (n._el) { n._el.style.left = n.x + 'px'; n._el.style.top = n.y + 'px'; }
                                changed = true;
                            }
                        });
                        if (changed) notesApi.saveAll();
                    }
                    // 连线重绘，跟随新位置
                    if (window.QuickNoteLinks && typeof window.QuickNoteLinks.redraw === 'function') {
                        window.QuickNoteLinks.redraw();
                    }
                }
            } catch (eLink) { console.warn('[Arrange] 随手标题跟随排列失败', eLink); }

            if (self._minimapDraw) self._minimapDraw();

            var sendingCount = sorted.filter(function(c) { return c.isSending; }).length;
            var rows = Math.ceil(sorted.length / cols);
            var msg = '✅ 已排列 ' + sorted.length + ' 个对话框（' + cols + '列 × ' + rows + '行）';
            if (sendingCount > 0) {
                msg += '，发送中 ' + sendingCount + ' 个排在前';
            }
            if (self._toast) {
                self._toast(msg, 'ok');
            } else {
                console.log('[Arrange]', msg);
            }

            Store.addLog && Store.addLog('info', '', 'arrange', '排列了 ' + sorted.length + ' 个对话框（' + cols + '列×' + rows + '行，发送中 ' + sendingCount + '）');
        },

        // ===== 摄像机定位工具 (set_camera) =====        // ===== 摄像机定位工具 (set_camera) =====
        setCamera: function(args) {
            args = args || {};
            var self = this;
            var view = self.canvasGetView ? self.canvasGetView() : { x: 0, y: 0, scale: 1 };

            if (Object.keys(args).length === 0) {
                return { success: true, message: "当前摄像机状态", tool: "set_camera", x: view.x, y: view.y, scale: view.scale };
            }

            var targetX = view.x;
            var targetY = view.y;
            var animate = args.animate !== false;

            if (args.target) {
                if (args.target === "center") {
                    targetX = 0; targetY = 0;
                } else if (args.target.indexOf("chat:") === 0) {
                    var chatId = args.target.substring(5);
                    var chatbox = document.getElementById("chatbox-" + chatId) || document.querySelector('[data-chat-id="' + chatId + '"]');
                    if (chatbox) {
                        var rect = chatbox.getBoundingClientRect();
                        var area = document.getElementById("canvasArea");
                        var areaRect = area ? area.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
                        targetX = view.x + (areaRect.width / 2 - rect.left - rect.width / 2);
                        targetY = view.y + (areaRect.height / 2 - rect.top - rect.height / 2);
                    } else {
                        return { success: false, message: "未找到对话ID: " + chatId, tool: "set_camera" };
                    }
                }
            } else {
                if (typeof args.x === "number") targetX = args.x;
                if (typeof args.y === "number") targetY = args.y;
            }

            if (self.canvasSetView) {
                self.canvasSetView(targetX, targetY, 1, animate);
            } else {
                var content = document.getElementById("canvasContent");
                if (content) {
                    if (animate) {
                        content.style.transition = "transform 0.4s cubic-bezier(0.2,0.8,0.2,1)";
                        setTimeout(function() { content.style.transition = ""; }, 450);
                    }
                    content.style.transform = "translate(" + Math.round(targetX) + "px," + Math.round(targetY) + "px) scale(1)";
                }
            }

            var zoomNote = args.zoom && args.zoom !== 1 ? "（缩放已禁用，保持100%）" : "";
            return {
                success: true,
                message: "摄像机已定位到 (" + Math.round(targetX) + ", " + Math.round(targetY) + ")" + zoomNote,
                tool: "set_camera",
                x: targetX, y: targetY, animated: animate
            };
        },

        // ===== 鼠标定位工具 (locate_mouse) =====
        locateMouse: function(args) {
            args = args || {};
            var self = this;
            var action = args.action || "get";

            if (action === "get") {
                var mx = self._lastMouseX || 0;
                var my = self._lastMouseY || 0;
                return { success: true, message: "当前鼠标位置: (" + mx + ", " + my + ")", tool: "locate_mouse", x: mx, y: my, action: "get" };
            }

            var targetX = args.x;
            var targetY = args.y;
            var targetEl = null;

            if (args.target) {
                try { targetEl = document.querySelector(args.target); } catch(e) {
                    return { success: false, message: "无效的选择器: " + args.target, tool: "locate_mouse" };
                }
                if (targetEl) {
                    var rect = targetEl.getBoundingClientRect();
                    targetX = rect.left + rect.width / 2;
                    targetY = rect.top + rect.height / 2;
                } else {
                    return { success: false, message: "未找到目标元素: " + args.target, tool: "locate_mouse" };
                }
            }

            if (typeof targetX !== "number" || typeof targetY !== "number") {
                return { success: false, message: "请提供 x/y 坐标或 target 选择器", tool: "locate_mouse" };
            }

            if (action === "move") {
                var duration = args.duration || 2000;
                var indicator = document.createElement("div");
                indicator.style.cssText = [
                    "position:fixed", "left:" + targetX + "px", "top:" + targetY + "px",
                    "width:40px", "height:40px", "margin-left:-20px", "margin-top:-20px",
                    "border-radius:50%", "border:3px solid #ff4444",
                    "box-shadow:0 0 20px rgba(255,68,68,0.8), 0 0 40px rgba(255,68,68,0.4)",
                    "pointer-events:none", "z-index:999999",
                    "animation:locate-pulse 0.6s ease-in-out infinite alternate"
                ].join(";");
                document.body.appendChild(indicator);

                if (!document.getElementById("locate-mouse-style")) {
                    var style = document.createElement("style");
                    style.id = "locate-mouse-style";
                    style.textContent = "@keyframes locate-pulse { 0% { transform: scale(0.8); opacity: 0.6; } 100% { transform: scale(1.4); opacity: 1; } }";
                    document.head.appendChild(style);
                }

                setTimeout(function() {
                    if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
                }, duration);

                return { success: true, message: "已在 (" + Math.round(targetX) + ", " + Math.round(targetY) + ") 创建高亮指示器，持续 " + duration + "ms", tool: "locate_mouse", x: targetX, y: targetY, action: "move", duration: duration };
            }

            if (action === "click") {
                if (targetEl) {
                    targetEl.click();
                    return { success: true, message: "已点击目标元素: " + args.target, tool: "locate_mouse", action: "click", target: args.target };
                } else {
                    var clickedEl = document.elementFromPoint(targetX, targetY);
                    if (clickedEl) {
                        clickedEl.click();
                        return { success: true, message: "已点击坐标 (" + Math.round(targetX) + ", " + Math.round(targetY) + ") 处的元素: " + (clickedEl.tagName + (clickedEl.id ? "#" + clickedEl.id : "")), tool: "locate_mouse", action: "click", x: targetX, y: targetY };
                    } else {
                        return { success: false, message: "坐标处未找到可点击元素", tool: "locate_mouse" };
                    }
                }
            }

            return { success: false, message: "未知操作: " + action, tool: "locate_mouse" };
        },

        // ===== 更新右键菜单“恢复已关闭的会话”显示状态 =====
        _updateRestoreMenu: function() {
            var item = document.getElementById('ctxRestoreClosed');
            var sep = document.getElementById('ctxSepRestore');
            var has = !!(this._closedStack && this._closedStack.length);
            if (item) item.style.display = has ? '' : 'none';
            if (sep) sep.style.display = has ? '' : 'none';
        },

        // ===== 恢复最近一次关闭的会话 =====
        restoreLastClosed: function() {
            var self = this;
            var stack = self._closedStack || [];
            if (!stack.length) {
                _dlgAlert('没有可恢复的已关闭会话');
                return;
            }
            var rec = stack[stack.length - 1];
            // 已在画布上则直接激活
            for (var i = 0; i < self.chatBoxes.length; i++) {
                if (self.chatBoxes[i].id === rec.id) {
                    self.activate(self.chatBoxes[i].el);
                    return;
                }
            }
            self._closedStack.pop();
            var restore = function(node) {
                try {
                    self.restoreHistoryNode(node);
                } catch (e) {
                    console.error('restoreLastClosed:', e);
                }
            };
            if (typeof DB !== 'undefined' && DB.online) {
                DB.getNode(rec.id).then(function(node) {
                    if (node) { restore(node); }
                    else { restore(rec.node || null); }
                }).catch(function() { restore(rec.node || null); });
            } else {
                restore(rec.node || null);
            }
        }
});
