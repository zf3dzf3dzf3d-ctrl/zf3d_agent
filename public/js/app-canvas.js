// ========== app-canvas.js - 画布操作 + 右键菜单 ==========
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
                content.style.transform = 'translate(' + Math.round(view.x) + 'px,' + Math.round(view.y) + 'px) scale(1)';
                if (coord) coord.textContent = 'x:' + Math.round(view.x) + ' · y:' + Math.round(view.y) + ' · ' + Math.round(view.scale * 100) + '%';
                if (self._minimapDraw) self._minimapDraw();
            }

            // ===== CSS3D 三维画布：按 3 键切换立体/平面，拖拽时轻微摆动增强纵深感 =====
            var tiltEl = document.getElementById('canvas3d') ? document.querySelector('.canvas-tilt') : null;
            if (tiltEl) {
                document.addEventListener('keydown', function(e) {
                    if (e.key === '3' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                        var tag = (e.target && e.target.tagName || '').toLowerCase();
                        if (tag === 'input' || tag === 'textarea') return;
                        document.body.classList.toggle('canvas-flat');
                        if (window.SFX) SFX.play('toggle3d');
                        if (typeof Store !== 'undefined' && Store.save) Store.save('canvasFlat', document.body.classList.contains('canvas-flat'));
                    }
                });
                try {
                    if (Store && Store.load && Store.load('canvasFlat')) document.body.classList.add('canvas-flat');
                } catch (err) {}
                // 拖拽平移时根据移动方向轻微 rotateY/rotateX，松手回正
                var baseTilt = null;
                self._canvas3dWobble = function(dx, dy) {
                    if (!tiltEl || document.body.classList.contains('canvas-flat')) return;
                    if (baseTilt === null) baseTilt = (tiltEl.style.transform || '').trim() || null;
                    self._wobblePending = [dx, dy]; // 只记录，渲染统一交给 rAF
                };
                self._canvas3dReset = function() {
                    if (!tiltEl) return;
                    tiltEl.style.transition = '';
                    tiltEl.style.transform = '';
                };
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
                        if (self.updateMinimap && (!self._mmLastFullDraw || performance.now() - self._mmLastFullDraw > 110)) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); } // 【平移卡顿优化】拖拽/缩放期间全量重绘节流到约9fps（全量重绘含DOM全扫描+强制reflow，是卡顿主因），松手后有全量重绘兜底
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
                if (self._canvas3dWobble) self._canvas3dWobble(e.clientX - sx, e.clientY - sy);
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
                        rafId = 0;                    // 【水晃跟随】左键拖拽画布期间让小地图同步重绘，水晃物理才能感知平移速度
                    if (self.updateMinimap && (!self._mmLastFullDraw || performance.now() - self._mmLastFullDraw > 110)) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); } // 【平移卡顿优化】拖拽/缩放期间全量重绘节流到约9fps（全量重绘含DOM全扫描+强制reflow，是卡顿主因），松手后有全量重绘兜底
                        apply();
                        // 3D 倾斜每帧只渲染一次（wobble 只记录，这里统一应用）
                        if (self._wobblePending) {
                            var _w = self._wobblePending; self._wobblePending = null;
                            if (tiltEl && !document.body.classList.contains('canvas-flat')) {
                                var _ry = Math.max(-6, Math.min(6, _w[0] * 0.02));
                                var _rx = 28 - Math.max(0, Math.min(8, _w[1] * 0.02));
                                tiltEl.style.transition = 'none';
                                tiltEl.style.transform = 'rotateX(' + _rx + 'deg) rotateY(' + _ry + 'deg) scale(1.05)';
                            }
                        }
                    });
                }
            });
            function stopDrag() {
                if (dragging) {
                    dragging = false; content.classList.remove('dragging');
                    self._mmKickT = 0; self._flyPx = undefined;
                    if (self._canvas3dReset) self._canvas3dReset();
                    if (typeof Store !== 'undefined' && Store.saveCanvas) {
                        Store.saveCanvas(view.x, view.y, view.scale);
                    }
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
            area.addEventListener('wheel', function(e) {
                // 检查事件目标是否在可滚动区域内
                var el = e.target;
                while (el && el !== area) {
                    var style = getComputedStyle(el);
                    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
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
                if (window.SFX && e.ctrlKey) SFX.play('zoom');
            }, { passive: false });
            document.addEventListener('wheel', function(e) { if (e.ctrlKey) { e.preventDefault(); } }, { passive: false });
            // 阻止手势缩放（触屏 pinch）
            document.addEventListener('gesturestart', function(e) { e.preventDefault(); });
            document.addEventListener('gesturechange', function(e) { e.preventDefault(); });
            document.addEventListener('gestureend', function(e) { e.preventDefault(); });

            // 阻止中键默认行为（自动滚动）
            document.addEventListener('mousedown', function(e) { if (e.button === 1) e.preventDefault(); });
            document.addEventListener('auxclick', function(e) { if (e.button === 1) e.preventDefault(); });
        },

        // ===== 创建面板：右键与左键双击复用同一双面板 =====
        setupContextMenu: function() {
            var canvas = document.getElementById('canvasArea');
            var self = this;

            function openCreatePanels(e) {
                if (!self._isCanvasBlankTarget(e.target)) return;
                e.preventDefault();
                // 文件树为常驻侧边栏：打开创建面板时不再关闭文件树，允许边看文件树边操作画布
                if (window.KiteCanvas && KiteCanvas.openDualPanels) {
                    KiteCanvas.openDualPanels(e.clientX, e.clientY);
                }
            }

            // 右键已改为呼出快速创建条（app-quick-create.js），这里仅保留双击打开创建面板
            canvas.addEventListener('dblclick', openCreatePanels);
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
                    '<div class="arrange-dialog-header">' +
                        '<span class="arrange-dialog-title">网格排列对话框</span>' +
                        '<button class="arrange-dialog-close" title="关闭">✕</button>' +
                    '</div>' +
                    '<div class="arrange-dialog-body">' +
                        '<div class="arrange-section-label">预设布局（每行几个）</div>' +
                        '<div class="arrange-presets">' +
                            '<button class="arrange-preset-btn" data-cols="2">2 列</button>' +
                            '<button class="arrange-preset-btn" data-cols="3">3 列</button>' +
                            '<button class="arrange-preset-btn" data-cols="4">4 列</button>' +
                            '<button class="arrange-preset-btn" data-cols="5">5 列</button>' +
                            '<button class="arrange-preset-btn" data-cols="6">6 列</button>' +
                            '<button class="arrange-preset-btn" data-cols="0">一字排开</button>' +
                        '</div>' +
                        '<div class="arrange-divider"></div>' +
                        '<div class="arrange-section-label">自定义</div>' +
                        '<div class="arrange-custom">' +
                            '<div class="arrange-input-group">' +
                                '<label>每行几个</label>' +
                                '<input type="number" class="arrange-input" id="arrangeCustomCols" value="3" min="1" max="20">' +
                            '</div>' +
                            '<span class="arrange-times">×</span>' +
                            '<div class="arrange-input-group">' +
                                '<label>间距 (px)</label>' +
                                '<input type="number" class="arrange-input" id="arrangeCustomGap" value="20" min="0" max="200">' +
                            '</div>' +
                            '<button class="arrange-apply-btn" id="arrangeApplyBtn">应用</button>' +
                        '</div>' +
                        '<div class="arrange-hint">共 ' + boxes.length + ' 个对话框（折叠中的不参与） · 按状态排序（发送中在前）</div>' +
                    '</div>' +
                '</div>';

            overlay.innerHTML = html;
            document.body.appendChild(overlay);

            // 关闭逻辑
            function closeDialog() {
                overlay.remove();
            }
            overlay.querySelector('.arrange-dialog-close').addEventListener('click', closeDialog);
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) closeDialog();
            });
            document.addEventListener('keydown', function escHandler(e) {
                if (e.key === 'Escape') {
                    closeDialog();
                    document.removeEventListener('keydown', escHandler);
                }
            });

            // 预设按钮
            overlay.querySelectorAll('.arrange-preset-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var cols = parseInt(this.dataset.cols);
                    closeDialog();
                    if (cols === 0) {
                        self.arrangeChatBoxes({ cols: 9999, gap: 36 });
                    } else {
                        self.arrangeChatBoxes({ cols: cols, gap: 24 });
                    }
                });
            });

            // 自定义应用按钮
            overlay.querySelector('#arrangeApplyBtn').addEventListener('click', function() {
                var cols = parseInt(overlay.querySelector('#arrangeCustomCols').value) || 3;
                var gap = parseInt(overlay.querySelector('#arrangeCustomGap').value) || 20;
                cols = Math.max(1, Math.min(20, cols));
                gap = Math.max(0, Math.min(200, gap));
                closeDialog();
                self.arrangeChatBoxes({ cols: cols, gap: gap });
            });

            // 回车应用
            overlay.querySelector('#arrangeCustomCols').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') overlay.querySelector('#arrangeApplyBtn').click();
            });
            overlay.querySelector('#arrangeCustomGap').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') overlay.querySelector('#arrangeApplyBtn').click();
            });
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

            sorted.forEach(function(chat, i) {
                if (!chat.el) return;
                var actualWidth = chat.el.offsetWidth || boxWidth;
                var actualHeight = chat.el.offsetHeight || boxHeight;

                var row = Math.floor(i / cols);
                var col = i % cols;
                var x = startX + col * (actualWidth + gap);
                var y = startY + row * (actualHeight + gap);

                chat.el.style.left = (x - view.x) + 'px';
                chat.el.style.top = (y - view.y) + 'px';

                if (typeof Store !== 'undefined' && Store.saveChatBox) {
                    Store.saveChatBox(chat);
                }
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
                alert('没有可恢复的已关闭会话');
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
