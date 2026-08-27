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
                if (target.closest('.kite-action-menu')) return false;  // 连线动作菜单
                if (target.closest('.kite-modal')) return false;       // 放大预览层
                return true;
            };

            function apply() {
                content.style.transform = 'translate(' + Math.round(view.x) + 'px,' + Math.round(view.y) + 'px) scale(1)';
                if (coord) coord.textContent = 'x:' + Math.round(view.x) + ' · y:' + Math.round(view.y) + ' · ' + Math.round(view.scale * 100) + '%';
                if (self._minimapDraw) self._minimapDraw();
            }
            self.canvasScale = function() { return view.scale; };
            self.canvasGetView = function() { return { x: view.x, y: view.y, scale: view.scale }; };
            self.canvasSetView = function(x, y, scale, animate) {
                if (animate) {
                    content.style.transition = 'transform 0.4s cubic-bezier(0.2,0.8,0.2,1)';
                    setTimeout(function() { content.style.transition = ''; }, 450);
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
                if (e.button === 1) {
                    // 中键：直接平移
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    ox = view.x; oy = view.y;
                    content.classList.add('dragging');
                    e.preventDefault();
                } else if (e.button === 0 && self._isCanvasBlankTarget(e.target)) {
                    // 左键：仅在画布空白区域平移（非对话框、非面板等）
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    ox = view.x; oy = view.y;
                    content.classList.add('dragging');
                    e.preventDefault();
                }
            });
            document.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                view.x = ox + (e.clientX - sx);
                view.y = oy + (e.clientY - sy);
                if (!rafId) {
                    rafId = requestAnimationFrame(function() {
                        rafId = 0;
                        apply();
                    });
                }
            });
            function stopDrag() {
                if (dragging) {
                    dragging = false; content.classList.remove('dragging');
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
                if (window.KiteCanvas && KiteCanvas.openDualPanels) {
                    KiteCanvas.openDualPanels(e.clientX, e.clientY);
                }
            }

            canvas.addEventListener('contextmenu', openCreatePanels);
            canvas.addEventListener('dblclick', openCreatePanels);
        },

        // ===== 网格排列对话框弹窗 =====
        showArrangeDialog: function() {
            var self = this;
            var boxes = self.chatBoxes;
            if (!boxes || boxes.length === 0) {
                self._toast && self._toast('没有可排列的对话框', 'info');
                return;
            }

            // 如果已存在弹窗，先移除
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
                        '<div class="arrange-hint">共 ' + boxes.length + ' 个对话框 · 按状态排序（发送中在前）</div>' +
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
                        self.arrangeChatBoxes({ cols: 9999, gap: 20 });
                    } else {
                        self.arrangeChatBoxes({ cols: cols, gap: 20 });
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
            var boxes = self.chatBoxes;
            if (!boxes || boxes.length === 0) {
                self._toast && self._toast('没有可排列的对话框', 'info');
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
