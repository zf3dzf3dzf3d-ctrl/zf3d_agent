// ========== app-minimap.js - 小地图（状态着色版 + 悬停预览最后两次对话） ==========
Object.assign(App, {
        // ===== 小地图（右下角导航预览） =====
        setupMinimap: function() {
            var self = this;
            var minimap = document.getElementById('minimap');
            var canvas = document.getElementById('minimapCanvas');
            var fitBtn = document.getElementById('minimapFit');
            if (!minimap || !canvas) return;

            var ctx = canvas.getContext('2d');
            var dpr = window.devicePixelRatio || 1;

            // ===== 创建悬停预览 tooltip（挂到 body 避免 minimap overflow:hidden 裁剪） =====
            var tooltip = document.createElement('div');
            tooltip.className = 'minimap-tooltip';
            tooltip.style.display = 'none';
            document.body.appendChild(tooltip);

            // 存储方块在 canvas 上的位置，供悬停检测
            var boxRects = [];
            var hoveredBox = null;

            function resizeCanvas() {
                var w = canvas.clientWidth;
                var h = canvas.clientHeight;
                canvas.width = w * dpr;
                canvas.height = h * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
            resizeCanvas();

            window.addEventListener('resize', function() {
                resizeCanvas();
                self.updateMinimap();
            });

            // 居中所有对话框（最大化按钮）
            if (fitBtn) {
                fitBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.minimapFitAll();
                });
            }

            // 拖拽导航
            var dragging = false;
            function navigateTo(e) {
                var rect = canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                var bounds = self._minimapBounds;
                if (!bounds) return;
                var cw = canvas.clientWidth;
                var ch = canvas.clientHeight;
                var wx = bounds.minX + (mx / cw) * (bounds.maxX - bounds.minX);
                var wy = bounds.minY + (my / ch) * (bounds.maxY - bounds.minY);
                var view = self.canvasGetView();
                var area = document.getElementById('canvasArea');
                var vw = area.clientWidth, vh = area.clientHeight;
                var tx = vw / 2 - wx * 1; // scale 强制 1（100%）
                var ty = vh / 2 - wy * 1;
                self.canvasSetView(tx, ty, 1, true);
            }

            canvas.addEventListener('mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                navigateTo(e);
            });
            document.addEventListener('mousemove', function(e) {
                if (dragging) {
                    navigateTo(e);
                    return;
                }
                // 非拖拽时检测悬停
                checkHover(e);
            });
            document.addEventListener('mouseup', function() {
                dragging = false;
            });

            // ===== 悬停检测：鼠标在小地图某个方块上时显示 tooltip =====
            function checkHover(e) {
                var rect = canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                // 只在鼠标在 canvas 区域内时检测
                if (mx < 0 || my < 0 || mx > canvas.clientWidth || my > canvas.clientHeight) {
                    hideTooltip();
                    return;
                }

                var found = null;
                for (var i = boxRects.length - 1; i >= 0; i--) {
                    var r = boxRects[i];
                    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
                        found = r;
                        break;
                    }
                }

                if (found) {
                    if (hoveredBox !== found) {
                        hoveredBox = found;
                        showTooltip(found);
                    }
                    // 更新 tooltip 位置（跟随鼠标）
                    positionTooltip(e);
                } else {
                    hideTooltip();
                }
            }

            // 获取对话框最后 N 条用户消息
            function getLastUserMessages(chatObj, count) {
                if (!chatObj || !chatObj.history) return [];
                var userMsgs = [];
                for (var i = chatObj.history.length - 1; i >= 0; i--) {
                    if (chatObj.history[i].role === 'user') {
                        userMsgs.unshift(chatObj.history[i].content);
                        if (userMsgs.length >= count) break;
                    }
                }
                return userMsgs;
            }

            // 简单文本截断
            function truncate(text, maxLen) {
                if (!text) return '';
                // 去掉 HTML 标签
                var tmp = document.createElement('div');
                tmp.innerHTML = text;
                text = tmp.textContent || tmp.innerText || '';
                if (text.length > maxLen) {
                    return text.substring(0, maxLen) + '…';
                }
                return text;
            }

            function showTooltip(boxInfo) {
                var chat = boxInfo.chat;
                if (!chat || !chat.el) { hideTooltip(); return; }
                var chatTitle = '';
                // 获取对话框标题
                var titleEl = chat.el.querySelector('.chatbox-header .title');
                if (titleEl) chatTitle = titleEl.textContent || titleEl.innerText || '';
                if (!chatTitle) chatTitle = chat.id || '对话框';

                var userMsgs = getLastUserMessages(chat, 2);
                var html = '<div class="mmt-header">' + self._escapeHtml(chatTitle) + '</div>';


                // Tooltip: full model name
                var modelName = self._minimapModelName(chat);
                if (modelName) {
                    html += '<div class="mmt-item" style="margin-bottom:6px;">';
                    html += '<div class="mmt-label">模型</div>';
                    html += '<div class="mmt-text">' + self._escapeHtml(modelName) + '</div>';
                    html += '</div>';
                }
                if (userMsgs.length === 0) {
                    html += '<div class="mmt-empty">暂无用户消息</div>';
                } else {
                    userMsgs.forEach(function(msg, idx) {
                        var label = userMsgs.length === 1 ? '提问' : ('提问 ' + (idx + 1));
                        html += '<div class="mmt-item">';
                        html += '<div class="mmt-label">' + label + '</div>';
                        html += '<div class="mmt-text">' + self._escapeHtml(truncate(msg, 120)) + '</div>';
                        html += '</div>';
                    });
                }

                tooltip.innerHTML = html;
                tooltip.style.display = 'block';
            }

            function positionTooltip(e) {
                // tooltip 挂在 body 上，直接用 viewport 坐标
                var mx = e.clientX;
                var my = e.clientY;
                var tw = tooltip.offsetWidth;
                var th = tooltip.offsetHeight;
                var vw = window.innerWidth;
                var vh = window.innerHeight;

                // 默认放在鼠标左上方
                var tx = mx - tw - 12;
                var ty = my - th - 12;

                // 如果左侧空间不够，放右侧
                if (tx < 4) tx = mx + 12;
                // 如果上方空间不够，放下方
                if (ty < 4) ty = my + 12;
                // 确保不超出视口右边界
                if (tx + tw > vw - 4) tx = vw - tw - 4;
                // 确保不超出视口下边界
                if (ty + th > vh - 4) ty = vh - th - 4;

                tooltip.style.left = Math.max(4, tx) + 'px';
                tooltip.style.top = Math.max(4, ty) + 'px';
            }

            function hideTooltip() {
                tooltip.style.display = 'none';
                hoveredBox = null;
            }

            // 鼠标离开 canvas 时隐藏 tooltip
            canvas.addEventListener('mouseleave', function() {
                hideTooltip();
            });

            // ===== 状态颜色定义 =====
            // 优先级：error > success > sending > queued > collapsed > active > idle
            var STATUS_COLORS = {
                error:     { fill: 'rgba(255, 85, 85, 0.75)',  stroke: 'rgba(255, 100, 100, 0.9)' },
                success:   { fill: 'rgba(30, 210, 130, 0.9)',   stroke: 'rgba(100, 255, 170, 1)' },
                sending:   { fill: 'rgba(255, 165, 0, 0.8)',   stroke: 'rgba(255, 200, 80, 1)' },
                queued:    { fill: 'rgba(255, 210, 60, 0.7)',  stroke: 'rgba(255, 220, 80, 0.9)' },
                collapsed: { fill: 'rgba(120, 120, 135, 0.3)', stroke: 'rgba(120, 120, 135, 0.25)' },
                active:    { fill: 'rgba(9, 132, 227, 0.8)',   stroke: 'rgba(9, 132, 227, 0.9)' },
                idle:      { fill: 'rgba(100, 160, 220, 0.4)', stroke: 'rgba(100, 160, 220, 0.25)' }
            };

            // Use the first character of the resolved model name, including custom systems.
            self._minimapModelTag = function(chat) {
                if (chat == null || chat.modelId == null) return '';
                var name = String(self._minimapModelName(chat) || '').trim();
                // Model names are resolved through Models.get, including custom systems.
                // Use the resolved model name directly, including custom systems.



                          




                // --- 兜底：按名称关键词匹配（自定义线路）---


                








                return name.charAt(0) || '';
            };

            // 获取模型完整名称（小地图悬停提示用）
            self._minimapModelName = function(chat) {
                if (chat == null || chat.modelId == null) return '';
                var m = window.Models && Models.get ? Models.get(chat.modelId) : null;
                return (m && m.name) ? String(m.name) : String(chat.modelId || '');
            };

            // 判断单个对话框的状态
            function getBoxStatus(el, chatObj) {
                // 检查最后一条消息是否是 error
                var hasError = false;
                var msgs = el.querySelectorAll('.msg');
                if (msgs.length > 0) {
                    var lastMsg = msgs[msgs.length - 1];
                    if (lastMsg.classList.contains('error')) hasError = true;
                }
                if (hasError) return 'error';
                // 任务结果保存在 chat 对象上，避免依赖 4 秒临时 DOM class。
                if (chatObj && chatObj._taskStatus === 'success') return 'success';
                if (el.classList.contains('task-success')) return 'success';
                if (chatObj && chatObj._taskStatus === 'fail') return 'error';
                if (chatObj && chatObj.isSending) return 'sending';
                if (chatObj && chatObj.queue && chatObj.queue.length > 0) return 'queued';
                if (el.classList.contains('collapsed')) return 'collapsed';
                if (el.classList.contains('active')) return 'active';
                return 'idle';
            }

            // 绘制小地图
            function drawMinimap() {
                var w = canvas.clientWidth;
                var h = canvas.clientHeight;
                if (w === 0 || h === 0) return;

                ctx.clearRect(0, 0, w, h);

                var boxes = [];
                self.chatBoxes.forEach(function(c) {
                    if (c.el && c.el.isConnected && c.el.offsetWidth > 0 && c.el.offsetHeight > 0) {
                        boxes.push({
                            x: c.el.offsetLeft,
                            y: c.el.offsetTop,
                            w: c.el.offsetWidth,
                            h: c.el.offsetHeight,
                            el: c.el,
                            chat: c
                        });
                    }
                });

                // ===== 风筝画布元素：kite-node（文本/提示词/图片/视频节点）+ kite-image-panel（文生图面板）=====
                // 与对话框同一坐标系（都挂在 canvasContent 内，随画布平移），一并纳入小地图小方块
                var kiteEls = [];
                var kiteRoot = document.getElementById('kite-canvas') || document.getElementById('canvasContent');
                if (kiteRoot) {
                    // 文本/图片/视频节点
                    kiteRoot.querySelectorAll('.kite-node').forEach(function(el) {
                        if (el && el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0) {
                            kiteEls.push({ el: el, kind: 'node' });
                        }
                    });
                    // 文生图面板（双击菜单面板与文本节点右键面板）
                    kiteRoot.querySelectorAll('.kite-image-panel').forEach(function(el) {
                        if (el && el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0) {
                            kiteEls.push({ el: el, kind: 'panel' });
                        }
                    });
                }
                kiteEls.forEach(function(k) {
                    var el = k.el;
                    boxes.push({
                        x: el.offsetLeft,
                        y: el.offsetTop,
                        w: el.offsetWidth,
                        h: el.offsetHeight,
                        el: el,
                        chat: null,
                        kite: k.kind
                    });
                });

                if (boxes.length === 0) {
                    ctx.fillStyle = 'rgba(136, 136, 153, 0.4)';
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('暂无对话框', w / 2, h / 2);
                    boxRects = [];
                    return;
                }

                var view = self.canvasGetView();
                var area = document.getElementById('canvasArea');
                var vw = area.clientWidth, vh = area.clientHeight;
                var vpMinX = -view.x / view.scale;
                var vpMinY = -view.y / view.scale;
                var vpMaxX = vpMinX + vw / view.scale;
                var vpMaxY = vpMinY + vh / view.scale;

                var minX = vpMinX, minY = vpMinY, maxX = vpMaxX, maxY = vpMaxY;
                boxes.forEach(function(b) {
                    if (b.x < minX) minX = b.x;
                    if (b.y < minY) minY = b.y;
                    if (b.x + b.w > maxX) maxX = b.x + b.w;
                    if (b.y + b.h > maxY) maxY = b.y + b.h;
                });

                var pad = 30;
                minX -= pad; minY -= pad; maxX += pad; maxY += pad;

                var worldW = maxX - minX;
                var worldH = maxY - minY;
                if (worldW < 1) worldW = 1;
                if (worldH < 1) worldH = 1;

                var scaleX = w / worldW;
                var scaleY = h / worldH;
                var s = Math.min(scaleX, scaleY);

                var offsetX = (w - worldW * s) / 2;
                var offsetY = (h - worldH * s) / 2;

                function w2m(px, py) {
                    return {
                        x: (px - minX) * s + offsetX,
                        y: (py - minY) * s + offsetY
                    };
                }

                self._minimapBounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };

                // 当前时间，用于脉冲动画
                var now = Date.now();

                // 清空 boxRects，重新填充
                boxRects = [];

                // 绘制对话框小方块（带状态着色）
                boxes.forEach(function(b) {
                    var p1 = w2m(b.x, b.y);
                    var bw = b.w * s;
                    var bh = b.h * s;
                    if (bw < 2) bw = 2;
                    if (bh < 2) bh = 2;

                    // ===== 风筝画布元素单独绘制：节点（文本/提示词/图片/视频）与文生图面板用不同颜色 =====
                    if (b.kite) {
                        var isPanel = b.kite === 'panel';
                        var isMedia = b.el.classList.contains('kite-node-image') || b.el.classList.contains('kite-node-video');
                        if (isPanel) {
                            // 文生图面板：紫色系
                            ctx.fillStyle = 'rgba(170, 110, 255, 0.55)';
                            ctx.strokeStyle = 'rgba(190, 140, 255, 0.9)';
                        } else if (isMedia) {
                            // 图片/视频节点：绿色系
                            ctx.fillStyle = 'rgba(80, 220, 130, 0.5)';
                            ctx.strokeStyle = 'rgba(120, 240, 160, 0.85)';
                        } else {
                            // 文本/提示词节点：青色系
                            ctx.fillStyle = 'rgba(60, 200, 220, 0.5)';
                            ctx.strokeStyle = 'rgba(110, 230, 245, 0.85)';
                        }
                        ctx.lineWidth = 1;
                        ctx.fillRect(p1.x, p1.y, bw, bh);
                        ctx.strokeRect(p1.x, p1.y, bw, bh);
                        // 标记：图片🖼 视频🎬 文本✎ 面板🎨
                        var kiteTag = isPanel ? '🎨' : (b.el.classList.contains('kite-node-video') ? '🎬' : (b.el.classList.contains('kite-node-image') ? '🖼' : '✎'));
                        if (bw >= 10 && bh >= 8) {
                            ctx.font = 'bold 8px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.lineWidth = 2;
                            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
                            ctx.strokeText(kiteTag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                            ctx.fillText(kiteTag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
                        }
                        var hitPad0 = 3;
                        boxRects.push({
                            x: p1.x - hitPad0,
                            y: p1.y - hitPad0,
                            w: bw + hitPad0 * 2,
                            h: bh + hitPad0 * 2,
                            el: b.el,
                            chat: null,
                            kite: b.kite
                        });
                        return; // 风筝元素不走对话框状态绘制
                    }

                    var status = getBoxStatus(b.el, b.chat);
                    var colors = STATUS_COLORS[status];

                    // sending 状态添加脉冲效果
                    var alpha = 1;
                    if (status === 'sending') {
                        // 0.6~1.0 之间脉动
                        alpha = 0.7 + 0.3 * Math.sin(now / 400);
                    }

                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = colors.fill;
                    ctx.fillRect(p1.x, p1.y, bw, bh);
                    ctx.strokeStyle = colors.stroke;
                    ctx.lineWidth = (status === 'sending' || status === 'error') ? 1 : 0.5;
                    ctx.strokeRect(p1.x, p1.y, bw, bh);
                    ctx.globalAlpha = 1;

                    // 记录方块位置（稍微扩大检测区域，方便悬停到小方块）
                    // 方块中央标注模型单字母（如 D/G/T，悬停显示全名）
                    var tag = self._minimapModelTag(b.chat);
                    if (tag && bw >= 10 && bh >= 8) {
                        ctx.font = 'bold 9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
                        ctx.strokeText(tag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                        ctx.fillText(tag, p1.x + bw / 2, p1.y + bh / 2 + 0.5);
                    }
                    var hitPad = 3;
                    boxRects.push({
                        x: p1.x - hitPad,
                        y: p1.y - hitPad,
                        w: bw + hitPad * 2,
                        h: bh + hitPad * 2,
                        el: b.el,
                        chat: b.chat
                    });
                });

                // 绘制当前视口矩形（黄色虚线框）
                var vp1 = w2m(vpMinX, vpMinY);
                var vp2 = w2m(vpMaxX, vpMaxY);
                var vpW = vp2.x - vp1.x;
                var vpH = vp2.y - vp1.y;
                ctx.strokeStyle = 'rgba(255, 200, 80, 0.8)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 2]);
                ctx.strokeRect(vp1.x, vp1.y, vpW, vpH);
                ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(255, 200, 80, 0.06)';
                ctx.fillRect(vp1.x, vp1.y, vpW, vpH);
            }

            self._minimapDraw = function() { drawMinimap(); };

            self.updateMinimap = function() {
                if (self._mmRaf) return;
                self._mmRaf = requestAnimationFrame(function() {
                    self._mmRaf = 0;
                    drawMinimap();
                });
            };

            // 定时刷新（2秒），捕获 isSending/queue/error 等状态变化
            if (self._minimapStatusTimer) clearInterval(self._minimapStatusTimer);
            self._minimapStatusTimer = setInterval(function() {
                self.updateMinimap();
            }, 2000);

            self.minimapFitAll = function() {
                var boxes = [];
                self.chatBoxes.forEach(function(c) {
                    if (c.el && c.el.isConnected && c.el.offsetWidth > 0 && c.el.offsetHeight > 0) {
                        boxes.push({
                            x: c.el.offsetLeft,
                            y: c.el.offsetTop,
                            w: c.el.offsetWidth,
                            h: c.el.offsetHeight
                        });
                    }
                });
                if (boxes.length === 0) return;

                var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                boxes.forEach(function(b) {
                    if (b.x < minX) minX = b.x;
                    if (b.y < minY) minY = b.y;
                    if (b.x + b.w > maxX) maxX = b.x + b.w;
                    if (b.y + b.h > maxY) maxY = b.y + b.h;
                });
                var cx = (minX + maxX) / 2;
                var cy = (minY + maxY) / 2;

                var area = document.getElementById('canvasArea');
                var vw = area.clientWidth, vh = area.clientHeight;
                var scale = 1; // 强制 100%，不缩放

                var tx = vw / 2 - cx * scale;
                var ty = vh / 2 - cy * scale;
                self.canvasSetView(tx, ty, scale, true);
                self.updateMinimap();
            };

            // 初始绘制
            setTimeout(function() { self.updateMinimap(); }, 200);
        },
});
