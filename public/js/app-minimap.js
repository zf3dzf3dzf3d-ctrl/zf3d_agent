// ========== app-minimap.js - 小地图（状态着色版 + 悬停预览最后两次对话） ==========
Object.assign(App, {
        // ===== 小地图（右下角导航预览） =====
        setupMinimap: function() {
            var self = this;
            var minimap = document.getElementById('minimap');
            var canvas = document.getElementById('minimapCanvas');
            var fitBtn = document.getElementById('minimapFit');
            if (!minimap || !canvas) return;

            // =====【整理模式入口】标题栏按钮 + 双击小地图 =====
            var organizeBtn = document.getElementById('minimapOrganize');
            if (organizeBtn) {
                organizeBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (window.MinimapOrganize) MinimapOrganize.toggle();
                });
            }
            minimap.addEventListener('dblclick', function(e) {
                if (document.body.classList.contains('qc-open')) return; // 快速创建面板期间禁止交互（兜底）
                if (e.target.closest('.minimap-header') || e.target === canvas) {
                    if (window.MinimapOrganize) MinimapOrganize.open();
                }
            });

            var ctx = canvas.getContext('2d');
            var dpr = window.devicePixelRatio || 1;

            // ===== 创建悬停预览 tooltip（挂到 body 避免 minimap overflow:hidden 裁剪） =====
            var tooltip = document.createElement('div');
            tooltip.className = 'minimap-tooltip';
            tooltip.style.display = 'none';
            document.body.appendChild(tooltip);

            // =====【小地图可拖拽 + 位置记忆】按住标题栏拖动，位置存 localStorage =====
            (function initMinimapDrag() {
                var header = minimap.querySelector('.minimap-header');
                if (!header) return;
                var POS_KEY = 'zf_minimap_pos';

                // 恢复上次位置
                try {
                    var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
                    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number'
                        && isFinite(saved.left) && isFinite(saved.top)) {
                        // 边界校验（按父容器尺寸）：换分辨率/拖出可视区时，把小地图夹回父容器内，避免"消失"
                        var _parent = minimap.offsetParent || document.body;
                        var _pw = _parent.clientWidth || window.innerWidth;
                        var _ph = _parent.clientHeight || window.innerHeight;
                        var _mw = minimap.offsetWidth || 180, _mh = minimap.offsetHeight || 130;
                        // 记录的坐标明显超出父容器尺寸（例如按窗口坐标存过），视为脏数据直接丢弃走默认位置
                        // 顺带清掉历史脏数据（如 left:1079/top:393 这类屏幕坐标），让面板回到默认右下角
                        if (saved.left > _pw || saved.top > _ph || saved.left < -_mw || saved.top < -_mh) {
                            try { localStorage.removeItem(POS_KEY); } catch (e2) {}
                        } else if (_parent !== document.body && document.body.contains(_parent)
                                   && (saved.left + _mw > _pw - 2 || saved.top + _mh > _ph - 2)) {
                            // 坐标贴边/超出当前父容器可视范围（换分辨率、面板收起后），直接复位默认位置
                            try { localStorage.removeItem(POS_KEY); } catch (e2b) {}
                        } else {
                            var _cl = Math.max(0, Math.min(saved.left, _pw - _mw));
                            var _ct = Math.max(0, Math.min(saved.top, _ph - _mh));
                            minimap.style.left = _cl + 'px';
                            minimap.style.top = _ct + 'px';
                            minimap.style.right = 'auto';
                            minimap.style.bottom = 'auto';
                        }
                    }
                } catch (err) {}

                function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }

                header.addEventListener('mousedown', function(e) {
                    // 标题栏上的居中按钮不触发拖拽
                    if (e.target.closest && e.target.closest('.minimap-btn')) return;
                    // Tab 快速创建面板打开期间（minimap 被搬移到 body + fixed 定位），禁止拖拽，避免污染 zf_minimap_pos
                    if (document.body.classList.contains('qc-open')) return;
                    e.preventDefault();
                    var rect = minimap.getBoundingClientRect();
                    var offX = e.clientX - rect.left;
                    var offY = e.clientY - rect.top;
                    minimap.style.left = rect.left + 'px';
                    minimap.style.top = rect.top + 'px';
                    minimap.style.right = 'auto';
                    minimap.style.bottom = 'auto';
                    minimap.classList.add('dragging');

                    function onMove(ev) {
                        var w = minimap.offsetWidth, h = minimap.offsetHeight;
                        var nl = clamp(ev.clientX - offX, 0, window.innerWidth - w);
                        var nt = clamp(ev.clientY - offY, 0, window.innerHeight - h);
                        minimap.style.left = nl + 'px';
                        minimap.style.top = nt + 'px';
                    }
                    function onUp() {
                        minimap.classList.remove('dragging');
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        try {
                            localStorage.setItem(POS_KEY, JSON.stringify({
                                left: parseFloat(minimap.style.left),
                                top: parseFloat(minimap.style.top)
                            }));
                        } catch (err) {}
                    }
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
            })();

        self.minimapToggleOrganize = function() {
            if (window.MinimapOrganize) MinimapOrganize.toggle();
        };

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
                /* 【极速模式】关闭水面动画 */
                if (window.isTurboMode && window.isTurboMode()) return;
                if (_waterRaf) return;
                var _lastWaterTick = 0; // throttle ~30fps（原45ms有顿挫感，33ms更顺滑，开销仍远低于满帧）
                function _tick() {
                    var _wt = Date.now();
                    if (_wt - _lastWaterTick < 33) { _waterRaf = requestAnimationFrame(_tick); return; }
                    /* 【FPS 自动降级】全局帧率过低时停掉装水动画，恢复后由水位活动自然重启 */
                    if (window.FpsGuard && !window.FpsGuard.allow('minimap')) { _waterRaf = null; return; }
                    _lastWaterTick = _wt;
                    if (Date.now() > _waterRafUntil) { _waterRaf = null; _waterRafUntil = 0; selfRef.updateMinimap(); return; }
                    selfRef.updateMinimap();
                    _waterRaf = requestAnimationFrame(_tick);
                }
                _waterRaf = requestAnimationFrame(_tick);
            }
            // 动画期间用 rAF 持续重绘小地图（结束后自动停）
            function _startTcAnimLoop(selfRef) {
                /* 【极速模式】关闭计数脉冲动画循环 */
                if (window.isTurboMode && window.isTurboMode()) return;
                if (_tcAnimRaf) return;
                /* 【FPS 自动降级】全局帧率过低时跳过计数脉冲动画 */
                if (window.FpsGuard && !window.FpsGuard.allow('minimap')) { selfRef.updateMinimap(); return; }
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

            // 整理工具按钮：打开小方块整理面板（原「居中所有对话框」已移除）
            if (fitBtn) {
                fitBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (window.MinimapOrganize) MinimapOrganize.toggle();
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
                // 【中键劫持】button===1：交给下方 IIFE 处理（命中节点→拖拽，空白→取消选择）
                if (e.button === 1) {
                    return; // 不 preventDefault，由中键拖拽模块统一处理
                }
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                navigateTo(e, true);
            });
            // 中键松开后浏览器可能派发 auxclick/click 触发自动滚动，全拦
            canvas.addEventListener('auxclick', function(e) { if (e.button === 1) e.preventDefault(); });
            canvas.addEventListener('click', function(e) { if (e.button === 1) e.preventDefault(); });
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
                // 【自动分组同步】分组数据缓存（组织面板改动时通过事件置脏，避免每帧 JSON.parse）
                var _mmGroupsCache = null, _mmGroupsIdx = {}, _mmGroupsDirty = true;
                document.addEventListener('zf-minimap-groups-changed', function() { _mmGroupsDirty = true; });
                window.addEventListener('storage', function(e) { if (e.key === 'zf_minimap_groups') _mmGroupsDirty = true; });
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
                // 【跟随主对话框 v9】工作台抽屉不再单独纳入小地图：
                // 它是对话框的一部分（挂在对话框内部），必须完全依托宿主对话框，
                // 不允许在导航里被单独选中/跳转。抽屉随对话框方块联动显示。
                }
                kiteEls.forEach(function(k) {
                    var el = k.el;
                    boxes.push({
                        x: (k.ax !== undefined) ? k.ax : el.offsetLeft,
                        y: (k.ay !== undefined) ? k.ay : el.offsetTop,
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

                // 【缩放视野】让当前视口框最多占小地图约 55%：缩小主画布时，
                // 视口框变小，小地图自动展示更大世界范围（不再被视口撑满"锁死"）
                var _vpW = vpMaxX - vpMinX, _vpH = vpMaxY - vpMinY;
                var _needW = _vpW / 0.55, _needH = _vpH / 0.55;
                var _mcx = (minX + maxX) / 2, _mcy = (minY + maxY) / 2;
                if (maxX - minX < _needW) { minX = _mcx - _needW / 2; maxX = _mcx + _needW / 2; }
                if (maxY - minY < _needH) { minY = _mcy - _needH / 2; maxY = _mcy + _needH / 2; }

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

                // 【整理模式钩子】暴露当前帧收集的 boxes（含 kite 种类），供整理面板复用
                self._minimapGetBoxes = function() { return boxes.slice(); };

                // 清空 boxRects，重新填充
                boxRects = [];

                // ===== 【分组低调框 v9】每个分组画一个整体外框（虚线+极淡填充），成员方块不再单独描边 =====
                try {
                    if (!_mmGroupsCache || _mmGroupsDirty) {
                        _mmGroupsCache = JSON.parse(localStorage.getItem('zf_minimap_groups') || '[]');
                        _mmGroupsIdx = {};
                        _mmGroupsCache.forEach(function(g) { (g.nodeIds || []).forEach(function(nid) { _mmGroupsIdx[nid] = g; }); });
                        _mmGroupsDirty = false;
                    }
                    if ((_mmGroupsCache || []).length > 0) {
                        var _gBoxes = {}; // gid -> {minX,minY,maxX,maxY,g}
                        boxes.forEach(function(b) {
                            var _gid = (b.el && b.el.dataset && b.el.dataset.moId) || b.el.id;
                            var _g = _gid ? _mmGroupsIdx[_gid] : null;
                            if (!_g) return;
                            var _acc = _gBoxes[_g.id];
                            if (!_acc) _gBoxes[_g.id] = { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h, g: _g };
                            else {
                                if (b.x < _acc.minX) _acc.minX = b.x;
                                if (b.y < _acc.minY) _acc.minY = b.y;
                                if (b.x + b.w > _acc.maxX) _acc.maxX = b.x + b.w;
                                if (b.y + b.h > _acc.maxY) _acc.maxY = b.y + b.h;
                            }
                        });
                        Object.keys(_gBoxes).forEach(function(_gidKey) {
                            var _acc = _gBoxes[_gidKey];
                            var _pad = 4;
                            var gp1 = w2m(_acc.minX - _pad, _acc.minY - _pad);
                            var gp2 = w2m(_acc.maxX + _pad, _acc.maxY + _pad);
                            var gw = gp2.x - gp1.x, gh = gp2.y - gp1.y;
                            if (gw < 4 || gh < 4) return;
                            var _gc = _acc.g.color || '#8899aa';
                            ctx.save();
                            // 极淡填充 + 低透明度虚线外框（低调）
                            ctx.fillStyle = 'rgba(128, 128, 128, 0.05)';
                            ctx.fillRect(gp1.x, gp1.y, gw, gh);
                            ctx.strokeStyle = _gc;
                            ctx.globalAlpha = 0.5;
                            ctx.lineWidth = 1;
                            ctx.setLineDash([4, 3]);
                            ctx.strokeRect(gp1.x, gp1.y, gw, gh);
                            ctx.setLineDash([]);
                            ctx.restore();
                        });
                    }
                } catch (e) {}

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
                        var isWb = b.kite === 'workbench';
                        if (isWb) {
                            // 工作台抽屉：青绿色系 + 🧰 标记
                            ctx.fillStyle = 'rgba(74, 153, 136, 0.6)';
                            ctx.strokeStyle = 'rgba(127, 199, 173, 0.95)';
                        } else if (isNote) {
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
                        var kiteTag = isWb ? '🧰' : (isNote ? '📍' : (isFG ? '🧭' : (isPanel ? '🎨' : (isDragMedia ? '🖼' : (b.el.classList.contains('kite-node-video') ? '🎬' : (b.el.classList.contains('kite-node-image') ? '🖼' : '✎'))))));
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

                    // 【工作台虚拟框 v10】对话框若开着工作台抽屉，在其方块左侧渲染一个"虚拟框"：
                    // 跟随对话框位置（左缘外贴、底部对齐，与 .wb-drawer 的 right:100%;bottom:0 一致），
                    // 仅示意不参与交互（不推入 boxRects，无法被点选/拖拽/跳转）
                    try {
                        var _wb = b.el.querySelector(':scope > .wb-drawer.open')
                               || b.el.querySelector('.wb-drawer.open');
                        // 【v12 修复】关闭动画用 opacity:0（offsetWidth 不变），
                        // 仅靠 .open class + offsetWidth 判断会把已关闭的抽屉仍画出来。
                        // 增加 getComputedStyle opacity > 0.05 校验，过渡期间随重绘实时更新。
                        var _wbVisible = false;
                        if (_wb && _wb.offsetWidth > 0) {
                            try {
                                var _wbOp = parseFloat(getComputedStyle(_wb).opacity);
                                _wbVisible = isNaN(_wbOp) || _wbOp > 0.05;
                            } catch (e) { _wbVisible = true; }
                        }
                        if (_wbVisible) {
                            var dw = _wb.offsetWidth, dh = _wb.offsetHeight;
                            // v11：在小地图坐标系内画（v10 用世界坐标 b.x-dw，抽屉数百像素宽会把虚拟框挤出视野被裁掉）
                            // 宽度 = 对话框方块宽 × 抽屉/对话框真实宽度比，并夹紧到方块左侧可用空间；底部对齐
                            var _ratioW = dw / Math.max(1, b.w);
                            var _ratioH = dh / Math.max(1, b.h);
                            var _baseW = bw * _ratioW;
                            var _wbRight = false;
                            try {
                                _wbRight = _wb.classList.contains('wb-side-right')
                                    || (b.el.classList.contains('wb-side-right') && b.el.contains(_wb));
                            } catch (e2) {}
                            // 左右对称夹紧：右侧可用空间 = 画布右界 - (方块右缘)，过窄则不画（ww>=3 同左侧）
                            var ww = Math.max(3, Math.min(_baseW, _wbRight
                                ? (canvas.clientWidth - (p1.x + bw) - 2)
                                : (p1.x - 2)));
                            var wh = Math.max(2, Math.min(bh * _ratioH, bh));
                            var wp1 = { x: _wbRight ? (p1.x + bw) : (p1.x - ww), y: p1.y + bh - wh };
                            ctx.save();
                            ctx.fillStyle = 'rgba(74, 220, 180, 0.45)';
                            ctx.strokeStyle = 'rgba(60, 255, 200, 1)';
                            ctx.globalAlpha = 1;
                            ctx.lineWidth = 2;
                            ctx.fillRect(wp1.x, wp1.y, ww, wh);
                            ctx.strokeRect(wp1.x, wp1.y, ww, wh);
                            ctx.restore();
                        }
                    } catch (e) {}

                    // 【分组低调框 v9】成员方块不再逐个描组色边/角标，改为下方"每分组一个整体外框"

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
                        // 【水位平滑】水位变化用缓动过渡，涨水/退水不再跳变
                        var _lvlShown = (typeof b.chat._lvlShown === 'number') ? b.chat._lvlShown : _lvl;
                        _lvlShown += (_lvl - _lvlShown) * 0.15;
                        if (Math.abs(_lvl - _lvlShown) < 0.002) _lvlShown = _lvl;
                        b.chat._lvlShown = _lvlShown;
                        var _wh = bh * _lvlShown;
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
                        var _wavT2 = Date.now() / 760;
                        // 【双波叠加】主波（快）+ 次波（慢、反向），水面更自然不呆板（时间取值已提出循环外）
                        for (var _wx = 0; _wx <= bw; _wx += 2) {
                            var _u = 2 * _wx / bw - 1; // -1 ~ 1（左~右）
                            var _parab = _slAmp * (0.5 - 0.5 * _u * _u); // 中心 +amp（凹），两边 -amp（翘）
                        var _slY = -_slTilt * (0.5 - _wx / bw) + Math.sin(_wx * 0.55 + _wavT + _sl * 6) * 0.77 * _slGain + Math.sin(_wx * 1.35 - _wavT2 + _sl * 3) * 0.5 * _slGain + _parab;
                            ctx.lineTo(p1.x + _wx, _wy + _slY);
                        }
                        ctx.lineTo(p1.x + bw, p1.y + bh);
                        ctx.closePath();
                        // 【水体渐变】上浅下深，水体更有层次感
                        var _wGrad = ctx.createLinearGradient(0, _wy, 0, p1.y + bh);
                        _wGrad.addColorStop(0, 'rgba(96, 178, 255, 0.50)');
                        _wGrad.addColorStop(1, 'rgba(40, 110, 220, 0.55)');
                        ctx.fillStyle = _wGrad;
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
                        // 【常驻环境气泡】水位超过15%时持续冒泡，画面更鲜活
                        if (_wh > 5 && _lvlShown < 1) {
                            var _ambT = Date.now() / 1000;
                            for (var _abi = 0; _abi < 2; _abi++) {
                                var _aph = ((_ambT * (0.35 + _abi * 0.18) + _abi * 0.5 + (_cidW ? _cidW.length * 0.13 : 0)) % 1);
                                var _abx = p1.x + bw * (0.3 + 0.4 * ((_abi * 0.63 + Math.sin(_ambT * 0.8 + _abi * 3) * 0.5 + 0.5) % 1));
                                var _aby = p1.y + bh - _wh * _aph - 1;
                                ctx.fillStyle = 'rgba(190, 230, 255, ' + (0.65 * (1 - _aph) + 0.15) + ')';
                                ctx.beginPath(); ctx.arc(_abx, _aby, 0.7 + _abi * 0.5, 0, Math.PI * 2); ctx.fill();
                            }
                            // 常驻气泡需要持续重绘
                            var _wNow3 = Date.now();
                            if (!_waterRafUntil || _wNow3 > _waterRafUntil) _waterRafUntil = _wNow3 + 250;
                            _startWaterAnimLoop(self);
                        }
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
                        var _animT = _tcAnimMap[_cid] ? Math.max(0, Date.now() - _tcAnimMap[_cid]) : 9999;
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
                            ctx.arc(_bx + _bw / 2, _by + _bh / 2, Math.max(0.1, 4 + _wt * 14), 0, Math.PI * 2);
                            ctx.stroke();
                            ctx.restore();
                        }

                        // +1 飘字动画：计数增长后 900ms 内，"+1" 从徽标上方浮起、放大、左右微漂并淡出（带发光）
                        if (_animT < 900) {
                            var _ft = _animT / 900;
                            ctx.save();
                            ctx.globalAlpha = 1 - _ft * _ft;
                            ctx.font = 'bold ' + (9 + 5 * Math.sin(Math.min(1, _ft * 1.6) * Math.PI * 0.5)) + 'px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';
                            ctx.lineWidth = 2;
                            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                            ctx.shadowColor = '#ffcf4d';
                            ctx.shadowBlur = 6 * (1 - _ft);
                            var _fx = p1.x + bw - _bw / 2 + Math.sin(_ft * Math.PI) * 3; /* 左右微漂，轨迹更灵动 */
                            var _fy = _by - 2 - _ft * 16;
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

                // ===== 【新增】绘制审核员方向箭头（.zf-verify-arrow）：小地图上显示原对话↔审核员的箭头 =====
                try {
                    if (window.ZFVerifyArrow && typeof ZFVerifyArrow.getPairs === 'function') {
                        var _vaPairs = ZFVerifyArrow.getPairs();
                        // 用聊天框 id 反查已收集的 box（与上方画框共用 boxes 数组）
                        var _findById = function (cid) {
                            for (var bi = 0; bi < boxes.length; bi++) {
                                var _b = boxes[bi];
                                if (_b.chat && _b.chat.id === cid) return _b;
                                if (_b.el && _b.el.dataset && _b.el.dataset.chatId === cid) return _b;
                            }
                            return null;
                        };
                        _vaPairs.forEach(function (p) {
                            var fb = _findById(p.srcId), tb = _findById(p.qcId);
                            if (!fb || !tb) return;
                            // 起终点均为两框中心（世界坐标 → 小地图坐标）
                            var s = w2m(fb.x + (fb.w || 0) / 2, fb.y + (fb.h || 0) / 2);
                            var e = w2m(tb.x + (tb.w || 0) / 2, tb.y + (tb.h || 0) / 2);
                            // 方向：toQC = 原对话→审核员；toSrc = 反向
                            if (p.state === 'toSrc') { var tmp = s; s = e; e = tmp; }
                            // 【v2】按审核状态上色：pending/reviewing=青、revising=橙、passed=绿、failed=灰
                            var _vaColor = 'rgba(0, 229, 255, 0.9)';
                            if (p.status === 'revising') _vaColor = 'rgba(255, 171, 64, 0.9)';
                            else if (p.status === 'passed') _vaColor = 'rgba(0, 230, 118, 0.9)';
                            else if (p.status === 'failed') _vaColor = 'rgba(158, 158, 158, 0.7)';
                            // 进行中状态（pending/reviewing）用虚线流动感
                            ctx.strokeStyle = _vaColor;
                            ctx.lineWidth = 2;
                            ctx.setLineDash((p.status === 'pending' || p.status === 'reviewing') ? [6, 4] : []);
                            ctx.beginPath();
                            ctx.moveTo(s.x, s.y);
                            ctx.lineTo(e.x, e.y);
                            ctx.stroke();
                            // 终点三角箭头（随方向实时反转）
                            var ang = Math.atan2(e.y - s.y, e.x - s.x);
                            var hl = 5;
                            ctx.beginPath();
                            ctx.moveTo(e.x, e.y);
                            ctx.lineTo(e.x - hl * Math.cos(ang - 0.45), e.y - hl * Math.sin(ang - 0.45));
                            ctx.lineTo(e.x - hl * Math.cos(ang + 0.45), e.y - hl * Math.sin(ang + 0.45));
                            ctx.closePath();
                            ctx.fillStyle = _vaColor;
                            ctx.fill();
                            // 【v3】连线中点状态文字胶囊
                            var _vaLabel = ({ pending: '审核中', reviewing: '复审中', revising: '待修改', modified: '修改完成', passed: '审核完成', failed: '已失效' })[p.status];
                            if (_vaLabel && view.s > 0.15) {
                                var mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
                                ctx.font = '10px sans-serif';
                                var tw = ctx.measureText(_vaLabel).width;
                                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                                ctx.beginPath();
                                if (ctx.roundRect) ctx.roundRect(mx - tw / 2 - 6, my - 9, tw + 12, 16, 8); else ctx.rect(mx - tw / 2 - 6, my - 9, tw + 12, 16);
                                ctx.fill();
                                ctx.fillStyle = _vaColor;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(_vaLabel, mx, my);
                                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
                            }
                        });
                    }
                } catch (e) {}

                // ===== 【新增】绘制策划师紫色方向箭头（.zf-thinker-arrow）：原对话↔策划师 =====
                try {
                    if (window.ZFThinkerArrow && typeof ZFThinkerArrow.getPairs === 'function') {
                        var _tkPairs = ZFThinkerArrow.getPairs();
                        var _tkFindById = function (cid) {
                            for (var bi = 0; bi < boxes.length; bi++) {
                                var _b = boxes[bi];
                                if (_b.chat && _b.chat.id === cid) return _b;
                                if (_b.el && _b.el.dataset && _b.el.dataset.chatId === cid) return _b;
                            }
                            return null;
                        };
                        _tkPairs.forEach(function (p) {
                            var fb = _tkFindById(p.srcId), tb = _tkFindById(p.tkId);
                            if (!fb || !tb) return;
                            var s = w2m(fb.x + (fb.w || 0) / 2, fb.y + (fb.h || 0) / 2);
                            var e = w2m(tb.x + (tb.w || 0) / 2, tb.y + (tb.h || 0) / 2);
                            if (p.state === 'toSrc') { var tmp = s; s = e; e = tmp; }
                            // 状态上色：pending=紫、clarified=紫罗兰、applied/done=绿、failed=灰
                            var _tkColor = 'rgba(179, 136, 255, 0.9)';
                            if (p.status === 'clarified') _tkColor = 'rgba(124, 77, 255, 0.95)';
                            else if (p.status === 'applied') _tkColor = 'rgba(0, 230, 118, 0.9)';
                            else if (p.status === 'done') _tkColor = 'rgba(0, 230, 118, 0.9)';
                            else if (p.status === 'failed') _tkColor = 'rgba(158, 158, 158, 0.7)';
                            ctx.strokeStyle = _tkColor;
                            ctx.lineWidth = 2;
                            ctx.setLineDash(p.status === 'pending' ? [6, 4] : []);
                            ctx.beginPath();
                            ctx.moveTo(s.x, s.y);
                            ctx.lineTo(e.x, e.y);
                            ctx.stroke();
                            var ang = Math.atan2(e.y - s.y, e.x - s.x);
                            var hl = 5;
                            ctx.beginPath();
                            ctx.moveTo(e.x, e.y);
                            ctx.lineTo(e.x - hl * Math.cos(ang - 0.45), e.y - hl * Math.sin(ang - 0.45));
                            ctx.lineTo(e.x - hl * Math.cos(ang + 0.45), e.y - hl * Math.sin(ang + 0.45));
                            ctx.closePath();
                            ctx.fillStyle = _tkColor;
                            ctx.fill();
                            // 【v4】策划师连线中点状态文字胶囊
                            var _tkLabel = ({ pending: '策划中', clarifying: '策划中', clarified: '已策划', applied: '已回注', done: '策划完成', modified: '修改完成', failed: '已失效' })[p.status];
                            if (_tkLabel && view.s > 0.15) {
                                var _tmx = (s.x + e.x) / 2, _tmy = (s.y + e.y) / 2;
                                ctx.font = '10px sans-serif';
                                var _ttw = ctx.measureText(_tkLabel).width;
                                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                                ctx.beginPath();
                                if (ctx.roundRect) ctx.roundRect(_tmx - _ttw / 2 - 6, _tmy - 9, _ttw + 12, 16, 8); else ctx.rect(_tmx - _ttw / 2 - 6, _tmy - 9, _ttw + 12, 16);
                                ctx.fill();
                                ctx.fillStyle = _tkColor;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(_tkLabel, _tmx, _tmy);
                                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
                            }
                        });
                    }
                } catch (e) {}

                // ===== 【新增】绘制总结师琥珀色方向箭头（ZFSummarizerArrow）：原对话↔总结师 =====
                try {
                    if (window.ZFSummarizerArrow && typeof ZFSummarizerArrow.getPairs === 'function') {
                        var _smPairs = ZFSummarizerArrow.getPairs();
                        var _smFindById = function (cid) {
                            for (var bi = 0; bi < boxes.length; bi++) {
                                var _b = boxes[bi];
                                if (_b.chat && _b.chat.id === cid) return _b;
                                if (_b.el && _b.el.dataset && _b.el.dataset.chatId === cid) return _b;
                            }
                            return null;
                        };
                        _smPairs.forEach(function (p) {
                            var fb = _smFindById(p.srcId), tb = _smFindById(p.tkId);
                            if (!fb || !tb) return;
                            var s = w2m(fb.x + (fb.w || 0) / 2, fb.y + (fb.h || 0) / 2);
                            var e = w2m(tb.x + (tb.w || 0) / 2, tb.y + (tb.h || 0) / 2);
                            if (p.state === 'toSrc') { var tmp = s; s = e; e = tmp; }
                            // 状态上色：pending/clarified=琥珀、done/applied=绿、failed=灰
                            var _smColor = 'rgba(255, 179, 0, 0.9)';
                            if (p.status === 'clarified') _smColor = 'rgba(255, 143, 0, 0.95)';
                            else if (p.status === 'applied' || p.status === 'done' || p.status === 'modified') _smColor = 'rgba(0, 230, 118, 0.9)';
                            else if (p.status === 'failed') _smColor = 'rgba(158, 158, 158, 0.7)';
                            ctx.strokeStyle = _smColor;
                            ctx.lineWidth = 2;
                            ctx.setLineDash(p.status === 'pending' ? [6, 4] : []);
                            ctx.beginPath();
                            ctx.moveTo(s.x, s.y);
                            ctx.lineTo(e.x, e.y);
                            ctx.stroke();
                            var ang = Math.atan2(e.y - s.y, e.x - s.x);
                            var hl = 5;
                            ctx.beginPath();
                            ctx.moveTo(e.x, e.y);
                            ctx.lineTo(e.x - hl * Math.cos(ang - 0.45), e.y - hl * Math.sin(ang - 0.45));
                            ctx.lineTo(e.x - hl * Math.cos(ang + 0.45), e.y - hl * Math.sin(ang + 0.45));
                            ctx.closePath();
                            ctx.fillStyle = _smColor;
                            ctx.fill();
                            // 总结师连线中点状态文字胶囊
                            var _smLabel = ({ pending: '总结中', clarified: '已总结', done: '总结完成', applied: '已沉淀', modified: '修改完成', failed: '已失效' })[p.status];
                            if (_smLabel && view.s > 0.15) {
                                var _sx = (s.x + e.x) / 2, _sy = (s.y + e.y) / 2;
                                ctx.font = '10px sans-serif';
                                var _stw = ctx.measureText(_smLabel).width;
                                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                                ctx.beginPath();
                                if (ctx.roundRect) ctx.roundRect(_sx - _stw / 2 - 6, _sy - 9, _stw + 12, 16, 8); else ctx.rect(_sx - _stw / 2 - 6, _sy - 9, _stw + 12, 16);
                                ctx.fill();
                                ctx.fillStyle = _smColor;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(_smLabel, _sx, _sy);
                                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
                            }
                        });
                    }
                } catch (e) {}

                // ===== 【新增】绘制施工队橙色方向箭头（ZFRaceArrow）：原对话↔施工队窗 =====
                try {
                    if (window.ZFRaceArrow && typeof ZFRaceArrow.getPairs === 'function') {
                        var _rcFindById = function (cid) {
                            for (var bi = 0; bi < boxes.length; bi++) {
                                var _b = boxes[bi];
                                if (_b.chat && _b.chat.id === cid) return _b;
                                if (_b.el && _b.el.dataset && _b.el.dataset.chatId === cid) return _b;
                            }
                            return null;
                        };
                        (ZFRaceArrow.getPairs() || []).forEach(function (p) {
                            if (!p || p.dead) return;
                            var fb = _rcFindById(p.srcId), tb = _rcFindById(p.raceId);
                            if (!fb || !tb) return;
                            var s = w2m(fb.x + (fb.w || 0) / 2, fb.y + (fb.h || 0) / 2);
                            var e = w2m(tb.x + (tb.w || 0) / 2, tb.y + (tb.h || 0) / 2);
                            if (p.state === 'toSrc') { var tmp = s; s = e; e = tmp; }
                            var _rcColor = p.state === 'construction' ? 'rgba(255, 152, 0, 0.9)' : 'rgba(0, 230, 118, 0.9)';
                            ctx.strokeStyle = _rcColor;
                            ctx.lineWidth = 2;
                            ctx.setLineDash(p.state === 'construction' ? [6, 4] : []);
                            ctx.beginPath();
                            ctx.moveTo(s.x, s.y);
                            ctx.lineTo(e.x, e.y);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            var ang = Math.atan2(e.y - s.y, e.x - s.x);
                            var hl = 5;
                            ctx.beginPath();
                            ctx.moveTo(e.x, e.y);
                            ctx.lineTo(e.x - hl * Math.cos(ang - 0.45), e.y - hl * Math.sin(ang - 0.45));
                            ctx.lineTo(e.x - hl * Math.cos(ang + 0.45), e.y - hl * Math.sin(ang + 0.45));
                            ctx.closePath();
                            ctx.fillStyle = _rcColor;
                            ctx.fill();
                            var _rcLabel = p.state === 'construction' ? '施工中' : '施工完成';
                            if (view.s > 0.15) {
                                var _rx = (s.x + e.x) / 2, _ry = (s.y + e.y) / 2;
                                ctx.font = '10px sans-serif';
                                var _rw = ctx.measureText(_rcLabel).width;
                                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                                ctx.beginPath();
                                if (ctx.roundRect) ctx.roundRect(_rx - _rw / 2 - 6, _ry - 9, _rw + 12, 16, 8); else ctx.rect(_rx - _rw / 2 - 6, _ry - 9, _rw + 12, 16);
                                ctx.fill();
                                ctx.fillStyle = _rcColor;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(_rcLabel, _rx, _ry);
                                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
                            }
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

            // 【提速】外部调用（画布平移/排列/流程图等）统一走 100ms 节流 + rAF 合并：
            // 连续平移时小地图最多 10fps 重绘，平移单帧省下 ~8ms；水动画循环松手后自行补帧
            self._minimapDraw = function(_force) {
                var _nowD = Date.now();
                if (!_force && self._mmDrawLast && _nowD - self._mmDrawLast < 100) {
                    if (self._mmDrawTimer) return;
                    self._mmDrawTimer = setTimeout(function() {
                        self._mmDrawTimer = null;
                        self._mmDrawLast = Date.now();
                        drawMinimap();
                    }, 100 - (_nowD - self._mmDrawLast));
                    return;
                }
                self._mmDrawLast = _nowD;
                drawMinimap();
            };

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
                // 【防死循环】整理模式激活时跳过主小地图重绘，避免与整理面板渲染互相触发形成回环
                try {
                    if (window.MinimapOrganize && window.MinimapOrganize.isActive()) return;
                } catch (e) {}
                // 走节流入口，避免高频 rAF 长任务（每帧重绘 >100ms 会触发浏览器 Violation 提示）
                self._minimapDraw();
            };

            // 定时刷新（2秒），捕获 isSending/queue/error 等状态变化
            if (self._minimapStatusTimer) clearInterval(self._minimapStatusTimer);
            self._minimapStatusTimer = setInterval(function() {
                self.updateMinimap();
            }, 2000);

            // 【v12 修复】工作台抽屉开合/对话框拖动时虚拟框实时跟随：
            // 监听画布容器内 class/style/结构变化（抽屉 .open 切换、节点 left/top 改变），
            // 节流 120ms 触发一次重绘，避免虚拟框滞留旧位置 2 秒才刷新。
            if (!window.__zfMinimapFollowMo) {
                window.__zfMinimapFollowMo = true;
                var _followT = null;
                var _scheduleFollow = function() {
                    if (_followT) return;
                    _followT = setTimeout(function() {
                        _followT = null;
                        try { self.updateMinimap(true); } catch (e) {}
                    }, 120);
                };
                var _followTarget = document.getElementById('canvasContainer')
                    || document.getElementById('canvas')
                    || document.body;
                var _mo = new MutationObserver(function(muts) {
                    for (var i = 0; i < muts.length; i++) {
                        var m = muts[i];
                        if (m.type === 'attributes' &&
                            m.attributeName !== 'class' && m.attributeName !== 'style') continue;
                        _scheduleFollow();
                        break;
                    }
                });
                _mo.observe(_followTarget, {
                    attributes: true,
                    attributeFilter: ['class', 'style'],
                    subtree: true,
                    childList: true
                });
            }

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

// ======================================================================
// 【中键拖拽节点 + 导航面板 resize】v1
// 1. 小地图中键按住节点方块→拖拽真实对话框（rAF 节流，实时跟随）
// 2. 中键点空白→取消当前选中
// 3. （已移除）面板左上角 resize 热区——导航缩略图固定尺寸，不再支持缩放
// ======================================================================
(function() {
    'use strict';
    if (window.__zfMinimapMiddleDrag) return;
    window.__zfMinimapMiddleDrag = true;

    // 等待 minimap 初始化完成
    var _tries = 0;
    var _timer = setInterval(function() {
        _tries++;
        var panel = document.getElementById('minimap');
        var canvas = document.getElementById('minimapCanvas');
        if (panel && canvas) { clearInterval(_timer); _boot(panel, canvas); }
        else if (_tries > 100) clearInterval(_timer);
    }, 300);

    function _boot(panel, canvas) {
        // ---------- 中键拖拽 ----------
        var mDrag = null; // {chat, startX, startY, origL, origT, raf, pendingX, pendingY, moved}

        function _pickChat(e) {
            // 借用渲染层 self._minimapBounds（updateMinimap 每帧写入）做几何反查
            var app = window.App;
            if (!app || !app.chatBoxes) return null;
            var b = app._minimapBounds;
            if (!b) return null;
            var rect = canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left, my = e.clientY - rect.top;
            var w = canvas.clientWidth, h = canvas.clientHeight;
            var worldW = Math.max(1, b.maxX - b.minX), worldH = Math.max(1, b.maxY - b.minY);
            var s = Math.min(w / worldW, h / worldH);
            var offsetX = (w - worldW * s) / 2, offsetY = (h - worldH * s) / 2;
            for (var i = app.chatBoxes.length - 1; i >= 0; i--) {
                var c = app.chatBoxes[i];
                if (!c || !c.el) continue;
                var cx = (c.el.offsetLeft - b.minX) * s + offsetX;
                var cy = (c.el.offsetTop - b.minY) * s + offsetY;
                var cw = Math.max(2, c.el.offsetWidth * s);
                var ch = Math.max(2, c.el.offsetHeight * s);
                if (mx >= cx && mx <= cx + cw && my >= cy && my <= cy + ch) return c;
            }
            return null;
        }

        canvas.addEventListener('mousedown', function(e) {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            var c = _pickChat(e);
            if (!c) {
                // 空白：取消选择
                var act = document.querySelector('.chatbox.active');
                if (act) act.classList.remove('active');
                return;
            }
            var rect = canvas.getBoundingClientRect();
            mDrag = {
                chat: c,
                startX: e.clientX, startY: e.clientY,
                origL: c.el.offsetLeft, origT: c.el.offsetTop,
                moved: false, raf: 0, pendingX: 0, pendingY: 0
            };
            try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) {}
        });

        canvas.addEventListener('auxclick', function(e) { if (e.button === 1) e.preventDefault(); });

        document.addEventListener('mousemove', function(e) {
            if (!mDrag) return;
            e.preventDefault();
            var DRAG_SPEED = 1.5; // 【加速】中键拖拽移动速度 ×1.5
            var _sc = (window.App && App.canvasScale) ? (App.canvasScale() || 1) : 1; // 【修复】屏幕位移按画布缩放换算，缩放后拖拽不再偏慢/偏快
            var dx = (e.clientX - mDrag.startX) / _sc * DRAG_SPEED, dy = (e.clientY - mDrag.startY) / _sc * DRAG_SPEED;
            if (!mDrag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 阈值
            mDrag.moved = true;
            mDrag.pendingX = mDrag.origL + dx;
            mDrag.pendingY = mDrag.origT + dy;
            if (!mDrag.raf) {
                mDrag.raf = requestAnimationFrame(function() {
                    mDrag.raf = 0;
                    if (!mDrag) return;
                    mDrag.chat.el.style.left = mDrag.pendingX + 'px';
                    mDrag.chat.el.style.top = mDrag.pendingY + 'px';
                    mDrag.chat.x = mDrag.pendingX; mDrag.chat.y = mDrag.pendingY;
                    // 【实时跟随】拖拽期间节流重绘小地图，方块跟着走不再滞后
                    var _now = performance.now();
                    if (!mDrag._lastMM || _now - mDrag._lastMM > 120) {
                        mDrag._lastMM = _now;
                        try { if (window.App && typeof App.updateMinimap === 'function') App.updateMinimap(); } catch (err) {}
                        try { if (window.App && App._updateAllNavArrows) App._updateAllNavArrows(); } catch (err) {}
                    }
                    // 【子对话实时跟随】中键拖父窗 → ZFGroupFollow 按绝对位置实时摆好整棵子树
                    // （此前只靠 2s/400ms 漂移轮询兜底，子窗滞后约 0.5s）
                    try {
                        if (window.ZFGroupFollow && typeof ZFGroupFollow.liveFollow === 'function') {
                            ZFGroupFollow.liveFollow(mDrag.chat);
                        }
                    } catch (err) {}
                });
            }
        });

        document.addEventListener('mouseup', function(e) {
            if (!mDrag) return;
            var d = mDrag; mDrag = null;
            if (d.raf) cancelAnimationFrame(d.raf);
            // 【子对话实时跟随收尾】清掉 ZFGroupFollow 的拖拽态并刷新基准，恢复轮询兜底
            try {
                if (window.ZFGroupFollow && typeof ZFGroupFollow.endLiveFollow === 'function') ZFGroupFollow.endLiveFollow();
            } catch (err) {}
            if (d.moved) {
                // 持久化位置
                try {
                    if (window.Store && typeof Store.saveChatBox === 'function') Store.saveChatBox(d.chat);
                } catch (err) {}
                // 刷新小地图
                try {
                    if (window.App && typeof App.updateMinimap === 'function') App.updateMinimap();
                } catch (err) {}
            }
        });

        // 【按需求移除】面板 resize 手柄：右下角导航缩略图固定尺寸，不需要缩放界面 UI 大小
        // （原 zf-minimap-resize 左上角拖拽缩放 + zf_minimap_size 记忆已整体移除）

    }
})();
