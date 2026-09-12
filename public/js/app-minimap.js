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

            // 【工具计数徽标】动画状态：上次计数 / 弹出动画时间戳
            var _lastTcMap = {};
            var _tcAnimMap = {};
            var _tcAnimRaf = null;
            // 【装水动画】波浪/气泡需要持续重绘，水位活动期每秒续约一次，闲置自动停
            var _waterRafUntil = 0;
            var _waterRaf = null;
            // 【水晃物理】每个方块独立晃动状态（存在 b._slosh 上），视口平移计时全局一份
            var _viewLastX = null, _viewLastT = 0;
            // ===== 晃水驱动状态（重写）：外部（拖拽/飞行动画）注入平移速度，弹簧+阻尼物理 =====
            var _sloshDrive = 0, _sloshDriveT = 0;
            var _dvxOverride = null; // 【拖拽注水晃】外部注入的水平速度覆盖(px/s)
            var _sloshMap = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
            var _allSlosh = (typeof Set !== 'undefined') ? new Set() : null;
            function _slOf(b) {
                //〈2026修复〉按元素持久化晃动状态：drawMinimap 每帧重建 boxes，
                // 原先挂在 b 上的 _slosh 每帧清零，拖拽/平移时晃动无法积累
                if (_sloshMap && b && b.el) {
                    var _s = _sloshMap.get(b.el);
                    if (!_s) { _s = { off: 0, v: 0 }; _sloshMap.set(b.el, _s); if (_allSlosh) _allSlosh.add(_s); }
                    return _s;
                }
                return b._slosh || (b._slosh = { off: 0, v: 0 });
            }
            function _startWaterAnimLoop(selfRef) {
                if (_waterRaf) return;
                var _lastWaterTick = 0; // throttle ~22fps
                function _tick() {
                    var _wt = Date.now();
                    if (_wt - _lastWaterTick < 45) { _waterRaf = requestAnimationFrame(_tick); return; }
                    _lastWaterTick = _wt;
                    if (Date.now() > _waterRafUntil) { _waterRaf = null; _waterRafUntil = 0; selfRef.updateMinimap(); return; }
                    selfRef.updateMinimap();
                    _waterRaf = requestAnimationFrame(_tick);
                }
                _waterRaf = requestAnimationFrame(_tick);
            }
            // 动画期间用 rAF 持续重绘小地图（结束后自动停）
            function _startTcAnimLoop(selfRef) {
                if (_tcAnimRaf) return;
                var _start = Date.now();
                function _tick() {
                    _tcAnimRaf = null;
                    if (Date.now() - _start > 750) { selfRef.updateMinimap(); return; }
                    selfRef.updateMinimap();
                    _tcAnimRaf = requestAnimationFrame(_tick);
                }
                _tcAnimRaf = requestAnimationFrame(_tick);
            }

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
            function navigateTo(e, animate) {
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
                self.canvasSetView(tx, ty, 1, !!animate);
            }

            canvas.addEventListener('mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                navigateTo(e, true);
            });
            document.addEventListener('mousemove', function(e) {
                if (dragging) {
                    navigateTo(e, false);
                    return;
                }
                // 非拖拽时检测悬停
                checkHover(e);
            });
            document.addEventListener('mouseup', function() {
                if (dragging) {
                    dragging = false;
                    // 【水晃收尾】松手后主动延长水面动画循环，让弹簧+阻尼物理自然衰减到静止
                    //（否则没有重绘触发，水会冻结在半晃状态）
                    if (typeof _waterRafUntil !== 'undefined' && typeof _startWaterAnimLoop === 'function') {
                        var _wNow = Date.now();
                        if (_wNow > _waterRafUntil) _waterRafUntil = _wNow + 200;
                        _startWaterAnimLoop(self);
                    }
                } else {
                    dragging = false;
                }
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
                // 【2026 修复】发送中/排队中的优先级高于上一轮任务结果标记：
                // 排队消息自动续发时导航框应显示「工作状态」，而不是残留上一轮的 success/fail。
                if (chatObj && chatObj.isSending) return 'sending';
                if (chatObj && chatObj.queue && chatObj.queue.length > 0) return 'queued';
                // 任务结果保存在 chat 对象上，避免依赖 4 秒临时 DOM class。
                if (chatObj && chatObj._taskStatus === 'success') return 'success';
                if (el.classList.contains('task-success')) return 'success';
                if (chatObj && chatObj._taskStatus === 'fail') return 'error';
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
                // 【2026 修复】以 DOM 为准收集对话框：此前遍历 self.chatBoxes，
                // 任务完成后（守卫注入/热更新等流程）可能出现数组条目与 DOM 脱节，
                // 导致主画布上明明存在的老对话框在小地图上"全部消失"。
                // 现在直接扫描画布上的 .chatbox 元素，数组仅用于匹配状态对象。
                var _mmRoot = document.getElementById('canvasContent') || document.getElementById('canvasArea');
                if (_mmRoot) {
                    _mmRoot.querySelectorAll('.chatbox').forEach(function(el) {
                        if (!el || !el.isConnected || el.offsetWidth <= 0 || el.offsetHeight <= 0) return;
                        var _c = null;
                        for (var ci = 0; ci < (self.chatBoxes || []).length; ci++) {
                            if (self.chatBoxes[ci] && self.chatBoxes[ci].el === el) { _c = self.chatBoxes[ci]; break; }
                        }
                        boxes.push({
                            x: el.offsetLeft,
                            y: el.offsetTop,
                            w: el.offsetWidth,
                            h: el.offsetHeight,
                            el: el,
                            chat: _c
                        });
                    });
                }

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
                    // 【随手标题】画布便签标记，纳入小地图（黄点 📍）
                    kiteRoot.querySelectorAll('.quick-note').forEach(function(el) {
                        if (el && el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0) {
                            kiteEls.push({ el: el, kind: 'note' });
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

                // 【修复】拖拽上画布的媒体节点（.media-canvas-node）也纳入小地图，图片放到画布后右下角导航可见
                var mediaRoot = document.getElementById('canvasContent');
                if (mediaRoot) {
                    mediaRoot.querySelectorAll('.media-canvas-node').forEach(function(el) {
                        if (el && el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0) {
                            boxes.push({
                                x: el.offsetLeft,
                                y: el.offsetTop,
                                w: el.offsetWidth,
                                h: el.offsetHeight,
                                el: el,
                                chat: null,
                                kite: 'media'
                            });
                        }
                    });
                }

                // ===== FlowGlam 炫酷流程图节点（.fg-node）纳入小地图导航 =====
                if (mediaRoot) {
                    mediaRoot.querySelectorAll('.fg-node').forEach(function(el) {
                        if (el && el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0) {
                            boxes.push({
                                x: el.offsetLeft,
                                y: el.offsetTop,
                                w: el.offsetWidth,
                                h: el.offsetHeight,
                                el: el,
                                chat: null,
                                kite: 'flowglam'
                            });
                        }
                    });
                }

                if (boxes.length === 0) {
                    ctx.fillStyle = 'rgba(136, 136, 153, 0.4)';
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('暂无对话框', w / 2, h / 2);
                    boxRects = [];
                    minimap.classList.remove('has-content');
                    return;
                }
                // 【修复】画布有内容时小地图加 has-content 提高可见度
                minimap.classList.add('has-content');

                var view = self.canvasGetView();
                var area = document.getElementById('canvasArea');
                var vw = area.clientWidth, vh = area.clientHeight;
                var vpMinX = -view.x / view.scale;
                var vpMinY = -view.y / view.scale;
                var vpMaxX = vpMinX + vw / view.scale;
                var vpMaxY = vpMinY + vh / view.scale;

                // 【水晃物理】视口平移 → 所有方块的水轻微晃动（弹簧+阻尼，惯性来回摇摆）
                // 【水晃物理】视口平移 → 所有方块的水轻微晃动（弹簧+阻尼，惯性来回摇摆）
                var _nowT = Date.now();
                if (_viewLastX === null) { _viewLastX = view.x; _viewLastT = _nowT; }
                var _dt = Math.max(8, _nowT - _viewLastT) / 1000;
                var _dvx = (_dvxOverride !== null) ? _dvxOverride : (view.x - _viewLastX) / _dt;
                _dvxOverride = null; // 一次性消耗，避免持续漂移           // 平移速度（px/s，画布坐标）
                _viewLastX = view.x; _viewLastT = _nowT;
                // 冲量注入：速度变化 → 晃动角速度（限幅防爆），注入到每个方块的独立状态
                var _slEnergy = false;
                boxes.forEach(function(b) {
                    var _sl = _slOf(b);
                    _sl.v += Math.max(-3000, Math.min(3000, _dvx)) * 0.000245;
                    // 弹簧回复 + 阻尼衰减
                    _sl.v += -_sl.off * 0.10 - _sl.v * 0.055;
                    _sl.off += _sl.v;
                    if (Math.abs(_sl.off) > 0.0004 || Math.abs(_sl.v) > 0.0004) _slEnergy = true;
                });
                // 仍有晃动能量 → 延长水面重绘循环，动画持续到自然静止
                if (_slEnergy) {
                    var _wNow = Date.now();
                    if (_wNow > _waterRafUntil) _waterRafUntil = _wNow + 150;
                    _startWaterAnimLoop(self);
                }

                // 【水晃物理·对话框拖拽】只有被拖动的方块，其位移速度注入它自己的晃动冲量
                // （拖拽哪个对话框 → 只有那个框的水晃；松手后由弹簧+阻尼惯性衰减收尾）
                boxes.forEach(function(b) {
                    if (!b.el || !b.el.isConnected) return;
                    var _sl = _slOf(b);
                    var _bx = b.el.offsetLeft;
                    if (b._mmLastX === undefined) { b._mmLastX = _bx; b._mmLastT = _nowT; }
                    else {
                        var _bdt = Math.max(8, _nowT - b._mmLastT) / 1000;
                        var _bv = (_bx - b._mmLastX) / _bdt;   // 方块平移速度 px/s
                        b._mmLastX = _bx; b._mmLastT = _nowT;
                        if (Math.abs(_bv) > 1) {
                            // 拖拽中：直接把方块速度（限幅）作为冲量注入，响应更跟手
                            _sl.v += Math.max(-3000, Math.min(3000, _bv)) * 0.00042;
                            _viewLastX = view.x; // 拖拽期间跳过视口平移的重复注入
                        }
                    }
                });

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
                boxes.forEach(function(b, _mmBi) {
                    var p1 = w2m(b.x, b.y);
                    var bw = b.w * s;
                    var bh = b.h * s;
                    if (bw < 2) bw = 2;
                    if (bh < 2) bh = 2;

                    // ===== 风筝画布元素单独绘制：节点（文本/提示词/图片/视频）与文生图面板用不同颜色 =====
                    if (b.kite) {
                        var isPanel = b.kite === 'panel';
                        var isMedia = b.el.classList.contains('kite-node-image') || b.el.classList.contains('kite-node-video');
                        var isDragMedia = b.kite === 'media';
                        var isFG = b.kite === 'flowglam';
                        var isNote = b.kite === 'note';
                        if (isNote) {
                            // 随手标题：黄底便签色系
                            ctx.fillStyle = 'rgba(255, 210, 70, 0.75)';
                            ctx.strokeStyle = 'rgba(255, 230, 130, 0.95)';
                            // FlowGlam 流程图节点：橙金色系（与青/绿/紫区分）
                            ctx.fillStyle = 'rgba(255, 160, 60, 0.55)';
                            ctx.strokeStyle = 'rgba(255, 190, 100, 0.9)';
                        } else if (isPanel) {
                            // 文生图面板：紫色系
                            ctx.fillStyle = 'rgba(170, 110, 255, 0.55)';
                            ctx.strokeStyle = 'rgba(190, 140, 255, 0.9)';
                        } else if (isMedia || isDragMedia) {
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
                        var kiteTag = isNote ? '📍' : (isFG ? '🧭' : (isPanel ? '🎨' : (isDragMedia ? '🖼' : (b.el.classList.contains('kite-node-video') ? '🎬' : (b.el.classList.contains('kite-node-image') ? '🖼' : '✎')))));
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

                    // 【装水动画】方块内液体填充：水位 = 步数/预估总步数（默认30，超出自动扩展为30的倍数）
                    var _tcW = (b.chat && typeof b.chat._toolUseCount === 'number') ? b.chat._toolUseCount : 0;
                    if (_tcW > 0) {
                        var _cidW = (b.chat && b.chat.id) || ('box' + _mmBi);
                        // 预估总步数：默认30；超过后按30的倍数扩展（30→60→90…）
                        var _est = b.chat._waterEst || (b.chat._waterEst = 30);
                        if (_tcW >= _est) { _est = b.chat._waterEst = Math.ceil((_tcW + 1) / 30) * 30; }
                        var _lvl = Math.min(1, _tcW / _est);
                        // 【鱼动画】工具计数每过10，触发一条鱼游过水面（2.6秒）
                        var _fishStage = Math.floor(_tcW / 10);
                        if (_tcW === 0 && b.chat._fishStage) b.chat._fishStage = 0; // 新问题计数清零时同步重置鱼阶段
                        if (!b.chat._fishStage) b.chat._fishStage = 0;
                        if (_fishStage > b.chat._fishStage) {
                            b.chat._fishStage = _fishStage;
                            b.chat._fishStart = Date.now();
                            _startWaterAnimLoop(self);
                        }
                        var _wh = bh * _lvl;
                        var _wy = p1.y + bh - _wh;
                        ctx.save();
                        ctx.beginPath(); ctx.rect(p1.x, p1.y, bw, bh); ctx.clip();
                        // 水体（半透明蓝）+ 顶部波浪
                        ctx.beginPath();
                        ctx.moveTo(p1.x, p1.y + bh);
                        var _wavT = Date.now() / 320;
                        // 【水晃物理】叠加倾斜（off 前段抬后段压）与晃动波幅增益（每个方块独立状态）
                        var _slState = _slOf(b);
                        var _sl = _slState.off;
                        var _slTilt = _sl * bw * 0.245;   // 两端高度差（整体动态 ×0.7）
                        // 晃得越大 → 小波浪越小：增益随 |off| 增大而衰减（基准 1.7，晃猛时降到 0.3）
                        var _slGain = 1.7 - Math.min(1.4, Math.abs(_sl) * 90);
                        _slGain = Math.max(0.12, _slGain * 0.75); // 平时更扁平
                        // 第二维度：晃动能量大时叠加抛物面（中间凹、两边翘），能量为 0 时自动回平
                        var _slAmp = Math.min(bh * 0.22, Math.abs(_sl) * bw * 2.4);
                        for (var _wx = 0; _wx <= bw; _wx += 2) {
                            var _u = 2 * _wx / bw - 1; // -1 ~ 1（左~右）
                            var _parab = _slAmp * (0.5 - 0.5 * _u * _u); // 中心 +amp（凹），两边 -amp（翘）
                            var _slY = -_slTilt * (0.5 - _wx / bw) + Math.sin(_wx * 0.55 + _wavT + _sl * 6) * 0.77 * _slGain + _parab;
                            ctx.lineTo(p1.x + _wx, _wy + _slY);
                        }
                        ctx.lineTo(p1.x + bw, p1.y + bh);
                        ctx.closePath();
                        ctx.fillStyle = 'rgba(64, 158, 255, 0.40)';
                        ctx.fill();
                        // 波浪峰高光线
                        ctx.strokeStyle = 'rgba(140, 200, 255, 0.85)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        for (var _wx2 = 0; _wx2 <= bw; _wx2 += 2) {
                            var _u2 = 2 * _wx2 / bw - 1;
                            var _yy = _wy - _slTilt * (0.5 - _wx2 / bw) + Math.sin(_wx2 * 0.55 + _wavT + _sl * 6) * 0.77 * _slGain + _slAmp * (0.5 - 0.5 * _u2 * _u2);
                            if (_wx2 === 0) ctx.moveTo(p1.x, _yy); else ctx.lineTo(p1.x + _wx2, _yy);
                        }
                        ctx.stroke();
                        // +1 时上升小气泡（700ms 内）
                        var _bubT = _tcAnimMap[_cidW] ? (Date.now() - _tcAnimMap[_cidW]) : 9999;
                        if (_bubT < 700 && _wh > 4) {
                            var _bt = _bubT / 700;
                            ctx.fillStyle = 'rgba(200, 235, 255, 0.9)';
                            for (var _bi = 0; _bi < 3; _bi++) {
                                var _bxp = p1.x + bw * (0.25 + 0.25 * _bi);
                                var _byp = p1.y + bh - _wh * _bt - 1 - _bi * 2;
                                var _br = 0.8 + (_bi % 2) * 0.5;
                                ctx.beginPath(); ctx.arc(_bxp, _byp, _br, 0, Math.PI * 2); ctx.fill();
                            }
                        }
                        ctx.restore();
                        // 灌满庆祝：满格时金色呼吸光晕
                        if (_lvl >= 1) {
                            var _glow = 0.5 + 0.5 * Math.sin(Date.now() / 250);
                            ctx.save();
                            ctx.strokeStyle = 'rgba(255, 200, 60, ' + (0.55 + 0.4 * _glow) + ')';
                            ctx.lineWidth = 1.6;
                            ctx.strokeRect(p1.x - 1, p1.y - 1, bw + 2, bh + 2);
                            ctx.restore();
                        }
                        // 【鱼动画】工具数每过10，一条小鱼在方块水里从左游到右（2.6秒，画在水域裁剪内）
                        if (b.chat._fishStart) {
                            var _fT = (Date.now() - b.chat._fishStart) / 2600;
                            if (_fT < 1) {
                                var _fx2 = p1.x - 8 + _fT * (bw + 16);
                                var _fy2 = p1.y + bh - _wh / 2 + Math.sin(_fT * Math.PI * 3) * 2;
                                var _dir = 1;
                                var _fsz = Math.min(bw, bh) * 0.32 + 2;
                                ctx.save();
                                ctx.translate(_fx2, _fy2);
                                ctx.scale(_dir, 1);
                                ctx.globalAlpha = Math.min(1, _fT * 6) * Math.min(1, (1 - _fT) * 6);
                                ctx.fillStyle = 'rgba(255, 170, 60, 0.9)';
                                ctx.beginPath();
                                ctx.ellipse(0, 0, _fsz * 0.55, _fsz * 0.3, 0, 0, Math.PI * 2);
                                ctx.fill();
                                // 尾巴（摆动）
                                var _tail = Math.sin(Date.now() / 90) * _fsz * 0.18;
                                ctx.beginPath();
                                ctx.moveTo(-_fsz * 0.45, 0);
                                ctx.lineTo(-_fsz * 0.85, -_fsz * 0.3 + _tail);
                                ctx.lineTo(-_fsz * 0.85, _fsz * 0.3 + _tail);
                                ctx.closePath();
                                ctx.fill();
                                // 眼睛
                                ctx.fillStyle = '#222';
                                ctx.beginPath();
                                ctx.arc(_fsz * 0.3, -_fsz * 0.08, Math.max(0.6, _fsz * 0.07), 0, Math.PI * 2);
                                ctx.fill();
                                ctx.restore();
                                // 鱼游动期间持续重绘
                                var _wNow2 = Date.now();
                                if (!_waterRafUntil || _wNow2 > _waterRafUntil) _waterRafUntil = _wNow2 + 250;
                                _startWaterAnimLoop(self);
                            } else {
                                delete b.chat._fishStart;
                            }
                        }
                        // 保证波浪有帧在动：水位在(0,1)区间时持续拉起重绘循环（1秒后自动停）
                        if (_lvl < 1 || Math.abs(_slState.off) > 0.0004 || Math.abs(_slState.v) > 0.0004) {
                            var _wNow = Date.now();
                            if (!_waterRafUntil) _waterRafUntil = _wNow + 250;
                            else if (_wNow > _waterRafUntil) _waterRafUntil = _wNow + 250;
                            _startWaterAnimLoop(self);
                        }
                    }

                    // 【工具计数】对话任务运行中，在方块右上角显示工具调用次数小数字（带 +1 弹出动画）
                    var _tc = (b.chat && typeof b.chat._toolUseCount === 'number') ? b.chat._toolUseCount : null;
                    if (_tc !== null && _tc > 0) {
                        // 检测计数增长 → 记录动画起始时间并启动重绘循环（+1 浮起 + 缩放弹出效果）
                        var _cid = (b.chat && b.chat.id) || (b.el && b.el.dataset ? (b.el.dataset.cid || b.el.id || 'box' + _mmBi) : 'box' + _mmBi);
                        if (_tc !== null && _tc === 0) { delete _lastTcMap[_cid]; delete _tcAnimMap[_cid]; }
                        if (_lastTcMap[_cid] === undefined) _lastTcMap[_cid] = _tc;
                        if (_tc > _lastTcMap[_cid]) {
                            _tcAnimMap[_cid] = Date.now();
                            _startTcAnimLoop(self);
                        }
                        _lastTcMap[_cid] = _tc;

                        var _tcTxt = String(_tc);
                        ctx.save();
                        ctx.font = 'bold 8px sans-serif';
                        var _tw = ctx.measureText(_tcTxt).width;
                        // 右上角定位：贴方块右上边缘
                        var _bw = _tw + 4, _bh = 9;
                        var _bx = p1.x + bw - _bw, _by = p1.y - 4;
                        if (_bx < p1.x) _bx = p1.x;
                        if (_by < 0) _by = 0;

                        // 弹出动画：新计数 0~250ms 内徽标轻微放大回弹
                        var _animT = _tcAnimMap[_cid] ? (Date.now() - _tcAnimMap[_cid]) : 9999;
                        var _scale = 1;
                        if (_animT < 250) {
                            var _t = _animT / 250;
                            _scale = 1 + 0.6 * Math.sin(_t * Math.PI) * (1 - _t * 0.5);
                        }
                        if (_scale !== 1) {
                            ctx.translate(_bx + _bw / 2, _by + _bh / 2);
                            ctx.scale(_scale, _scale);
                            ctx.translate(-(_bx + _bw / 2), -(_by + _bh / 2));
                        }
                        ctx.fillStyle = 'rgba(255, 90, 90, 0.95)';
                        ctx.fillRect(_bx, _by, _bw, _bh);
                        ctx.fillStyle = '#fff';
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'top';
                        ctx.fillText(_tcTxt, _bx + 2, _by + 0.5);
                        ctx.restore();

                        // 【增强】+1 扩散光环：计数增长后 500ms 内，从徽标中心扩散一圈发光冲击波
                        if (_animT < 500) {
                            var _wt = _animT / 500;
                            ctx.save();
                            ctx.globalAlpha = 0.7 * (1 - _wt);
                            ctx.strokeStyle = '#ffcf4d';
                            ctx.lineWidth = 2 * (1 - _wt) + 0.5;
                            ctx.beginPath();
                            ctx.arc(_bx + _bw / 2, _by + _bh / 2, 4 + _wt * 14, 0, Math.PI * 2);
                            ctx.stroke();
                            ctx.restore();
                        }

                        // +1 飘字动画：计数增长后 700ms 内，"+1" 从徽标上方浮起、放大并淡出（带发光）
                        if (_animT < 700) {
                            var _ft = _animT / 700;
                            ctx.save();
                            ctx.globalAlpha = 1 - _ft * _ft;
                            ctx.font = 'bold ' + (9 + 4 * _ft) + 'px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';
                            ctx.lineWidth = 2;
                            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                            ctx.shadowColor = '#ffcf4d';
                            ctx.shadowBlur = 6 * (1 - _ft);
                            var _fx = p1.x + bw - _bw / 2;
                            var _fy = _by - 2 - _ft * 12;
                            ctx.strokeText('+1', _fx, _fy);
                            ctx.fillStyle = '#ffcf4d';
                            ctx.fillText('+1', _fx, _fy);
                            ctx.restore();
                        }
                    }
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

                // ===== 【新增】绘制流水线连线（pipeline-curve）：小地图上也能看到工程图连线 =====
                try {
                    var _plSvg = document.getElementById('kiteCurveSvg');
                    if (_plSvg) {
                        var _plPaths = _plSvg.querySelectorAll('path.pipeline-curve');
                        ctx.strokeStyle = 'rgba(79, 156, 255, 0.85)';
                        ctx.lineWidth = 1.5;
                        ctx.setLineDash([2, 1]);
                        _plPaths.forEach(function(path) {
                            var f = path._fromEl, t = path._toEl;
                            // 兼容旧连线（无元素引用缓存）：按 id 找
                            if (!f) f = document.getElementById(path.dataset.from);
                            if (!t) t = document.getElementById(path.dataset.to);
                            if (!f || !t || !f.isConnected || !t.isConnected) return;
                            var fa = { x: f.offsetLeft + f.offsetWidth, y: f.offsetTop + f.offsetHeight / 2 };
                            var ta = { x: t.offsetLeft, y: t.offsetTop + t.offsetHeight / 2 };
                            var m1 = w2m(fa.x, fa.y), m2 = w2m(ta.x, ta.y);
                            // 与主画布一致的贝塞尔走向（简化为二次曲线即可辨识）
                            ctx.beginPath();
                            ctx.moveTo(m1.x, m1.y);
                            var mx = (m1.x + m2.x) / 2;
                            ctx.bezierCurveTo(mx, m1.y, mx, m2.y, m2.x, m2.y);
                            ctx.stroke();
                            // 终点小箭头（三角）
                            ctx.setLineDash([]);
                            ctx.beginPath();
                            ctx.moveTo(m2.x, m2.y);
                            ctx.lineTo(m2.x - 4, m2.y - 2.5);
                            ctx.lineTo(m2.x - 4, m2.y + 2.5);
                            ctx.closePath();
                            ctx.fillStyle = 'rgba(79, 156, 255, 0.95)';
                            ctx.fill();
                            ctx.setLineDash([2, 1]);
                        });
                        ctx.setLineDash([]);
                    }
                } catch (e) {}

                // ===== 【新增】绘制 FlowGlam 流程图连线（.fg-edge-base）：小地图上显示流程图的线 =====
                try {
                    var _fgEdges = mediaRoot.querySelectorAll('.fg-layer path.fg-edge-base');
                    if (!_fgEdges.length) _fgEdges = document.querySelectorAll('.fg-layer path.fg-edge-base');
                    if (_fgEdges.length) {
                        ctx.strokeStyle = 'rgba(255, 150, 50, 0.9)';
                        ctx.lineWidth = 1.2;
                        ctx.setLineDash([]);
                        _fgEdges.forEach(function(p) {
                            var d = p.getAttribute('d');
                            if (!d) return;
                            // 解析 d："M x y C x y, x y, x y" —— 取起终点与两个控制点
                            var nums = d.match(/-?\d+(?:\.\d+)?/g);
                            if (!nums || nums.length < 8) return;
                            var pts = [];
                            for (var i = 0; i < 8; i += 2) pts.push(w2m(parseFloat(nums[i]), parseFloat(nums[i + 1])));
                            ctx.beginPath();
                            ctx.moveTo(pts[0].x, pts[0].y);
                            ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
                            ctx.stroke();
                        });
                    }
                } catch (e) {}

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

            // 【拖拽注水晃】供 app-canvas.js 拖拽/飞行动画每帧调用：
            // 传入视口水平平移速度(px/s)，直接注入每块的晃动速度，与 drawMinimap 内部的
            // view.x 差分驱动同源叠加；同时延长水动画循环，保证晃动能自然衰减到停止
            self._minimapSloshKick = function(_vx) {
                if (typeof _vx !== 'number' || !isFinite(_vx)) return;
                _dvxOverride = Math.max(-3000, Math.min(3000, _vx));
                var _wNow = Date.now();
                if (_wNow > _waterRafUntil) _waterRafUntil = _wNow + 150;
                _startWaterAnimLoop(self);
            };

            // 【拖拽注水晃】供 app-canvas.js 拖拽/飞行动画每帧调用：
            // 传入视口水平平移速度(px/s)，直接注入每块的晃动速度，与 drawMinimap 内部的
            // view.x 差分驱动同源叠加；同时延长水动画循环，保证晃动能自然衰减到停止

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
                // 【2026 修复】与 drawMinimap 同步：以 DOM 为准收集，避免数组脱节导致漏算
                var _fitRoot = document.getElementById('canvasContent') || document.getElementById('canvasArea');
                if (_fitRoot) {
                    _fitRoot.querySelectorAll('.chatbox').forEach(function(el) {
                        if (el && el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0) {
                            boxes.push({
                                x: el.offsetLeft,
                                y: el.offsetTop,
                                w: el.offsetWidth,
                                h: el.offsetHeight
                            });
                        }
                    });
                }
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
