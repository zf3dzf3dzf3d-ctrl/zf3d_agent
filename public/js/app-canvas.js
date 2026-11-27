
/* 自研对话框 shim 已抽取至公共 zf-dialog-shim.js（S4 去重 2026-11-22），本文件不再重复注入 */

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
                if (target.closest('.mo-canvas-dock')) return false;   // 【修复】缩小整理模式底部浮条按钮，不抢事件，保留选中集
                if (target.closest('.zf-crew-panel')) return false;    // 【修复】派出团队面板（含缩小整理 dock 弹出的浮层宿主内），双击/长按不误触发创建对话框面板
                if (target.closest('#qcQuickBar')) return false;       // 【修复 2026-11-28】快速创建条（含模型下拉 select）不算空白：总览态捕获层此前对它 preventDefault+stopPropagation，导致模型下拉点不开、mousedown 被吞
                if (target.closest('.quick-note')) return false;        // 【修复 2026-12-17】随手标题不算空白：总览态捕获层此前把它当空白 preventDefault+stopPropagation+框选接管，标题拖拽/双击编辑/删除在 i缩小整理模式全部失效
                if (target.closest('.zf-grp-head') || target.closest('.zf-grp-card')) return false; // 【用户令v3】分组标签头/折叠卡不算空白：上面双击=重命名、mousedown=拖拽，禁止画布/长按/双击抢事件弹创建面板
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
                scheduleLOD(); // 【LOD 摄像机距离隐藏】统一入口：平移/缩放/总览/飞行动画都走 apply 或 _overviewApply
                if (typeof _scheduleCull === 'function') _scheduleCull(); // 【viewport-culling 触发源补齐】摄像机 transform 变化驱动视口裁剪重算（原仅 scroll/resize，节点移回屏内最长 1.5s 不恢复）
            }

            self.canvasScale = function() { return view.scale; };

            // ================= 【LOD 摄像机距离隐藏】=================
            // 双条件隐藏：scale<0.5（距离远）或 节点矩形出视口+缓冲区 → 加 .lod-hidden（visibility:hidden）
            // 白名单（永不隐藏）：选中中/聚焦中/流式输出中/拖拽中/风筝挂件类节点
            var LOD_SEL = '.chatbox,.kite-node,.fg-node,.browser-node,.engine-node,.video-node,.pres-node';
            var LOD_SCALE_MIN = 0.8;      // 距离阈值：【S2 2026-11-15】0.5→0.8 三档收敛两档，拉远更早降级 lod-mini
            var LOD_PAD = 300;            // 视口裁剪缓冲区（px，世界坐标）
            var _lodRaf = null, _lodShown = 0;
            self._lodHiddenCount = function() { return _lodShown; }; // 供性能面板读取「已剔除节点数」

            function lodWhitelisted(n) {
                if (n.classList.contains('selected')) return true;
                if (n.classList.contains('dragging')) return true;
                if (n.contains(document.activeElement)) return true;
                if (n.getAttribute('data-streaming') === '1') return true; // 流式输出中（事件层兜底也会强制 keep）
                if (n.classList.contains('kite-node')) return true;        // 风筝挂件类（龙头/龙身/挂件）永不隐藏
                return false;
            }

            var _lodNodeCache = null;           // 【60帧优化·第二轮】LOD 节点集缓存：避免每次 updateLOD 全文档 querySelectorAll
            var _lodNodeObserver = null;        // 监听 canvasContent 子树节点增删 → 失效缓存（class/属性变化不失效）
            function lodNodes() {
                if (_lodNodeCache) return _lodNodeCache;
                _lodNodeCache = document.querySelectorAll(LOD_SEL);
                if (!_lodNodeObserver) {
                    /* 【P0-3 策划案 20261122】缓存失效粒度收紧：仅当增删节点涉及 LOD 目标窗
                       （自身命中 LOD_SEL 或其子树内含）才失效缓存；消息追加/气泡更新（.msg 等非
                       LOD_SEL 节点）不再炸缓存引发全量 querySelectorAll 重扫（流式+平移场景主收益）。
                       subtree:true 必须保留——嵌套 .chatbox（画布卡片内层）也要被捕获。 */
                    _lodNodeObserver = new MutationObserver(function(muts) {
                        for (var mi = 0; mi < muts.length; mi++) {
                            var _adds = muts[mi].addedNodes, _rems = muts[mi].removedNodes;
                            for (var k = 0; k < 2; k++) {
                                var _arr = k ? _rems : _adds;
                                for (var j = 0; j < _arr.length; j++) {
                                    var nd = _arr[j];
                                    if (nd.nodeType !== 1) continue;
                                    var _hit = true; // 异常兜底：判不了就按命中处理（宁多失效不漏）
                                    try { _hit = nd.matches(LOD_SEL) || nd.querySelector(LOD_SEL) !== null; } catch (eM) {}
                                    if (_hit) { _lodNodeCache = null; return; }
                                }
                            }
                        }
                    });
                    _lodNodeObserver.observe(content, { childList: true, subtree: true });
                }
                return _lodNodeCache;
            }
            function updateLOD() {
                var _pf0 = (window.Perf ? performance.now() : 0);
                _lodRaf = null;
                var vw = window.innerWidth, vh = window.innerHeight;
                // 视口矩形 → 世界坐标（transform: translate(view.x,view.y) scale(view.scale)，锚点0 0）
                var s = view.scale || 1;
                var wl = -view.x / s - LOD_PAD, wt = -view.y / s - LOD_PAD;
                var wr = (vw - view.x) / s + LOD_PAD, wb = (vh - view.y) / s + LOD_PAD;
                var nodes = lodNodes();
                var shown = 0;
                for (var i = 0; i < nodes.length; i++) {
                    var n = nodes[i];
                    // 【60帧优化·第二轮】消费 _lodDirty：非脏节点且已有可见性判定结果时跳过 classList 操作
                    // （视口每帧都在动，但多数节点的出视口判定不变；白名单节点也跳过重复 remove）
                    if (!n._lodDirty && n._lodVis !== undefined && !n.classList.contains('lod-mini')) {
                        if (n._lodVis) shown++;
                        continue;
                    }
                    n._lodDirty = false;
                    if (lodWhitelisted(n)) {
                        n._lodVis = false;
                        if (n._lodHidden) { n.classList.remove('lod-hidden'); n._lodHidden = false; }
                        continue;
                    }
                    var hide = false;
                    /* 【2026-12 用户指令：隐藏方式移除】出视口/拉远不再隐藏对话，全部保持可见。
                       后期用户会重新设计此部分，先保证任何情况下对话框都看得见 */
                    if (s < LOD_SCALE_MIN) {
                        /* 距离远时降级为 lod-mini（CSS 压缩为紧凑条，标题仍可见），不隐藏 */
                        n.classList.remove('lod-hidden');
                        n.classList.add('lod-mini');
                        if (!n._lodBox || n._lodDirty) { // 占位点需要坐标，此分支也要填缓存
                            n._lodBox = { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight };
                            n._lodDirty = false;
                        }
                        /* 【方案B·40窗卡顿修复 2026-11-21】总览态也做视口懒渲染：
                           原本此分支直接 continue 导致 lod-cv 永远挂不上，屏外窗全量参与 layout/paint。
                           现对完全出视口(含300px缓冲)的 lod-mini 窗同样补挂 lod-cv（content-visibility:auto），
                           浏览器跳过其子树 layout+paint，等效"只渲染外框占位"；滚回视口自动恢复。
                           屏内 mini 窗摘掉 lod-cv，保证可见窗正常渲染。 */
                        var mb = n._lodBox;
                        var offMini = mb.x + mb.w < wl || mb.y + mb.h < wt || mb.x > wr || mb.y > wb;
                        if (offMini) {
                            if (!n.classList.contains('lod-cv')) {
                                n.classList.add('lod-cv');
                                n.style.setProperty('--lod-cv-h', mb.h + 'px');
                            }
                        } else if (n.classList.contains('lod-cv')) {
                            n.classList.remove('lod-cv');
                        }
                        continue;
                    } else {
                        n.classList.remove('lod-mini'); // 恢复正常缩放时撤销降级
                    }
                    /* 【CV懒渲染 2026-11】正常缩放下，完全出视口（含300px缓冲）的对话窗挂 lod-cv 类
                       （content-visibility:auto + contain-intrinsic-size）：浏览器跳过其内部 layout/paint，
                       等效"只保留外框占位"，滚回视口自动恢复全局渲染——即用户要的"靠近才全局渲染"。
                       不用 display/visibility 隐藏（遵守 2026-12"对话不隐藏"指令，布局与占位完全保留）。
                       白名单节点（选中/拖动/聚焦/流式中）在上方 lodWhitelisted 已 continue 跳过。 */
                    var bx = n.offsetLeft, by = n.offsetTop, bw = n.offsetWidth, bh = n.offsetHeight;
                    var offCv = bx + bw < wl || by + bh < wt || bx > wr || by > wb;
                    if (offCv) {
                        if (!n._lodBox || n._lodDirty) { n._lodBox = { x: bx, y: by, w: bw, h: bh }; }
                        if (!n.classList.contains('lod-cv')) {
                            n.classList.add('lod-cv');
                            n.style.setProperty('--lod-cv-h', bh + 'px'); // 占位高度供 contain-intrinsic-size 使用
                        }
                    } else if (n.classList.contains('lod-cv')) {
                        n.classList.remove('lod-cv');
                    }
                    n._lodVis = false;
                    if (n._lodHidden) { n.classList.remove('lod-hidden'); n._lodHidden = false; }
                }
                _lodShown = shown;
                /* 【P0-2 策划案 20261122】syncLodDots(.lod-dot 占位点) 已删：2026-12「对话不隐藏」法令后
                   .lod-hidden 永不挂上，占位点成为死代码，每次 LOD 空跑 O(N) 循环。若未来恢复距离隐藏，
                   从 git 历史本文件 2026-11-22 版本取回 syncLodDots 与 canvas-lod.css .lod-dot 段。 */
                if (window.Perf && _pf0) Perf.mark('画布:updateLOD', _pf0); // 【P1-4 埋点】
            }
            var _lodThrottleTimer = null;
            function scheduleLOD() {
                // 【多对话60帧优化】拖拽平移中 LOD 降频到 ~7fps：拖拽时每帧全量 querySelectorAll+classList.toggle
                // 会触发全节点样式重算，是对话框一多就掉帧的主因之一；松手后 mouseup 兜底 canvasLODInvalidate 精确刷新
                // 【第二轮】飞行动画(canvasSetView)/总览动画(_ovRaf)同样逐帧 apply→scheduleLOD，一并降频；
                // 动画结束分支已有 scheduleLOD+setTimeout(scheduleLOD,100) 双兜底，无漏帧
                if (content.classList.contains('dragging') || _flyRaf !== null || _ovRaf !== null) {
                    if (_lodThrottleTimer) return;
                    _lodThrottleTimer = setTimeout(function() { _lodThrottleTimer = null; scheduleLOD(); }, 140);
                    return;
                }
                if (_lodRaf === null) _lodRaf = requestAnimationFrame(updateLOD);
            }
            self.canvasLODKick = scheduleLOD;            // 外部兜底：节点增删/拖拽/输出结束时可踢一帧
            self.canvasLODInvalidate = function(n) { if (n) n._lodDirty = true; else document.querySelectorAll(LOD_SEL).forEach(function(m){ m._lodDirty = true; }); scheduleLOD(); }; // 坐标失效
            // 兜底：平移/拖拽松手、窗口尺寸变化后强制刷新（坐标缓存失效 + 重算）
            /* 【策划案 20261123 #16】只在「这一次按下到松开之间确实拖动过」时才失效。旧写法画布区域内任何 mouseup
               （点对话框里的按钮、聚焦输入框）都把全部节点置脏，下一帧逐个读写重算，窗口多时每次点击都是一轮
               O(N) 强制布局。节点拖拽/缩放并不自己调失效、全靠这里兜底，所以按「按住期间位移 > 3px」判定，
               而不是只认画布平移。mousedown 捕获阶段记起点（总览态的节点拖拽会在 document 捕获阶段截断事件）。 */
            var _mmDownX = 0, _mmDownY = 0, _mmMoved = false;
            area.addEventListener('mousedown', function(e) { _mmDownX = e.clientX; _mmDownY = e.clientY; _mmMoved = false; }, true);
            document.addEventListener('mousemove', function(e) {
                if (!_mmMoved && (e.buttons & 7) && (Math.abs(e.clientX - _mmDownX) > 3 || Math.abs(e.clientY - _mmDownY) > 3)) _mmMoved = true;
            }, true);
            area.addEventListener('mouseup', function() { if (_mmMoved) self.canvasLODInvalidate(); _mmMoved = false; });
            window.addEventListener('resize', scheduleLOD);
            // ================= 【LOD END】=================

            self.canvasGetView = function() { return { x: view.x, y: view.y, scale: view.scale }; };
            /* 【总览缩小跟随】暴露当前画布缩放，供各箭头模块同步缩小箭头 */
            self.canvasScale = function() { return view.scale; };
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
                        else { _flyRaf = null; view.x = x; view.y = y; apply();
                            // 【LOD 直达刷新】飞行结束视口落定，强制全量失效 LOD 判定缓存并重算，
                            // 防止判定被跳过的节点（_lodVis 已有值）在到达后仍保持 lod-hidden
                            if (self.canvasLODInvalidate) self.canvasLODInvalidate();
                        }
                    }
                    _flyRaf = requestAnimationFrame(_fly);
                    if (typeof Store !== 'undefined' && Store.saveCanvas) { Store.saveCanvas(x, y, 1); }
                    return; // FIX: animate must not jump to endpoint synchronously
                }
                view.x = x; view.y = y; view.scale = 1; // 强制 100%，忽略传入的 scale
                apply();
                // 【LOD 直达刷新】摄像机即时直达后视口大跨度变化，但节点坐标缓存(_lodBox)不失效，
                // 出视口判定沿用旧结果 → 目标节点明明进了视口却仍是 lod-hidden（需手动平移才显示）。
                // 这里强制全量失效缓存并踢一帧重算，保证直达后界面立即恢复显示。
                if (self.canvasLODInvalidate) self.canvasLODInvalidate();
                // 同步保存画布状态到 Store
                if (typeof Store !== 'undefined' && Store.saveCanvas) {
                    Store.saveCanvas(x, y, view.scale);
                }
            };

            // ===== 总览模式（缩小状态）：一键缩小看全图，再点恢复 =====
            // 开发说明：本画布摄像机 = content.style.transform 的 translate+scale（view={x,y,scale}）。
            // canvasSetView 强制 scale=1（缩放锁），因此总览模式自带独立动画，直接驱动 view+apply。
            // 恢复时回到进入前的视口（通常是 100%），所以它天然可替代"整理面板"里"看全图"的职责。
            var _ovRaf = null, _ovOn = false, _ovPrev = null, _ovExitPending = false; // _ovExitPending：【策划案 20261123 #11】退出动画进行中
            function _ovState(v) { // 总览状态广播：body class + window 事件（app-canvas-overview.js 消费）
                _ovOn = v;
                document.body.classList.toggle('zf-overview-mode', v);
                try { window.dispatchEvent(new CustomEvent('wb-canvas-change', { detail: { on: v } })); } catch (e) {}
            }
            self._overviewApply = function() {
                content.style.transform = 'translate(' + Math.round(view.x) + 'px,' + Math.round(view.y) + 'px) scale(' + view.scale + ')';
                if (coord) coord.textContent = 'x:' + Math.round(view.x) + ' · y:' + Math.round(view.y) + ' · ' + Math.round(view.scale * 100) + '%';
                try { window.dispatchEvent(new Event('wb-canvas-view')); } catch (e) {}
                /* 【帧率优化 v3 2026-11-16】平移/缩放中 LOD+视口裁剪全量重算是卡顿真因：
                   80ms 节流（约12次/秒），松手/动画结束再补一次全量（见 stopDrag/_fly 结尾） */
                var _now = performance.now();
                if (_now - (self._ovLodT || 0) > 80) {
                    self._ovLodT = _now;
                    scheduleLOD();
                    if (typeof _scheduleCull === 'function') _scheduleCull();
                }
            };
            /* 【i整理·滚轮缩放 v1】总览态滚轮缩放：以屏幕点 (cx,cy) 为锚（沿鼠标缩放）。
               数学：screen = view.x + world*s ⇒ world=(screen-view.x)/s；
               缩放后要求 screen'==screen ⇒ view.x' = cx - (cx-view.x)/old*ns。
               仅总览态生效（_ovOn），范围 0.12~1.6，缩放后同步小地图。 */
            /* 【帧率优化 v2 2026-11-16】缩放本身轻，卡顿真因是每个 wheel 事件
               都同步 updateMinimap（DOM 全扫描+强制 reflow）+ scheduleLOD 全量重算。
               v2：rAF 合帧（同帧多次滚轮只算一次）+ 小地图 110ms 节流（拖拽期同策略）。 */
            var _zoomRaf = 0, _zoomCx = 0, _zoomCy = 0, _zoomFactor = 1, _mmZoomDraw = 0;
            self.canvasOverviewZoomAt = function(cx, cy, factor) {
                if (!_ovOn) return;
                _zoomCx = cx; _zoomCy = cy;
                _zoomFactor *= factor;
                if (_zoomRaf) return;
                _zoomRaf = requestAnimationFrame(function() {
                    _zoomRaf = 0;
                    var old = view.scale;
                    var ns = Math.max(0.12, Math.min(1.6, old * _zoomFactor));
                    _zoomFactor = 1;
                    if (ns === old) return;
                    view.x = _zoomCx - (_zoomCx - view.x) / old * ns;
                    view.y = _zoomCy - (_zoomCy - view.y) / old * ns;
                    view.scale = ns;
                    self._overviewApply();
                    /* 小地图重绘节流 110ms（与平移/动画同一门槛），不再每滚格全量重绘 */
                    var now = performance.now();
                    if (self.updateMinimap && now - _mmZoomDraw > 110) { _mmZoomDraw = now; self._mmLastFullDraw = now; self.updateMinimap(); }
                });
            };
            self.canvasOverviewBounds = function() {
                var L = 1e9, T = 1e9, R = -1e9, B = -1e9, found = false;
                // 【修复】原来漏掉 .chatbox（普通对话节点），导致画布只有对话时总览按钮无反应（Toast"还没有节点"）
                document.querySelectorAll('.chatbox,.kite-node,.browser-node,.engine-node,.video-node,.fg-node,.pres-node').forEach(function(n) {
                    if (!n.offsetParent) return; // 被 culling 隐藏的跳过
                    found = true;
                    L = Math.min(L, n.offsetLeft); T = Math.min(T, n.offsetTop);
                    R = Math.max(R, n.offsetLeft + n.offsetWidth);
                    B = Math.max(B, n.offsetTop + n.offsetHeight);
                });
                return found ? { x: L, y: T, w: R - L, h: B - T } : null;
            };
            self.canvasOverviewToggle = function(exitTo) {
                /* 【策划案 20261123 #11】记下「这次取消掉的是不是一次没飞完的退出动画」 */
                var _wasExiting = _ovExitPending;
                if (_ovRaf) { cancelAnimationFrame(_ovRaf); _ovRaf = null; }
                _ovExitPending = false;
                var dur = 500, t0 = performance.now(), fx, fy, fs, tx, ty, ts;
                if (!_ovOn) {
                    /* 【策划案 20261123·三种模式积累性修复 #4·模式互斥】专注态下进总览：先退出专注。专注态画布不可见，
                       且被 host 的窗口在舞台坐标系里，会把下面的包围盒算错。recenter:false —— 退出专注默认会把摄像机
                       飞回最后 host 的对话，与随后的总览进入动画同时逐帧写 view，互相把镜头拽来拽去。 */
                    if (window.zfFocusMode && typeof window.zfFocusMode.isOn === 'function' && window.zfFocusMode.isOn()) {
                        try { window.zfFocusMode.set(false, { recenter: false }); } catch (eFm) {}
                    }
                    var b = self.canvasOverviewBounds();
                    if (!b) { if (window.Toast) Toast.show('画布上还没有节点'); return; }
                    /* 【策划案 20261123 #11】从「退出动画途中」被叫回来的，不覆盖原视角快照：此刻 view 是动画中间态
                       （_ovState(false) 在退出动画开始前就已翻转标志），拿它当 _ovPrev 会让之后的「恢复」停在
                       一个中间缩放上，并被退出动画结尾的 saveCanvas 落盘。 */
                    if (!_wasExiting) _ovPrev = { x: view.x, y: view.y, s: view.scale };
                    /* 【错位修复 v4】进入总览即挂起偏移守恒采集/校正：总览中拖动/整理
                       会真实移动窗口，若周期采集（5s setInterval）把总览中间态写成
                       父子偏移基准，退出后守恒校正会按陈旧基准把子窗拉回 → 全部错位。
                       退出动画结束后由下方 endMigration 按最终位置重算基准。 */
                    try { if (window.ZFRelativeRestore && ZFRelativeRestore.beginMigration) ZFRelativeRestore.beginMigration(); } catch (eOv) {}
                    var vw = window.innerWidth, vh = window.innerHeight; // 【全屏总览 2026-11】用户要求缩小整理模式铺满全屏，不再预留左侧 260px/底部 100px
                    ts = Math.min((vw - 60) / b.w, (vh - 60) / b.h, 1);
                    ts = Math.max(0.12, ts);
                    /* 【缩小整理模式·包围盒居中】缩放以世界原点 (0,0) 为锚
                       （content.transformOrigin:'0 0'）。若只缩放不平移，当节点
                       包围盒远离原点时，缩小后内容会整体偏向原点方向、移出可视区，
                       表现为「摄像机跑偏、看不到窗口」。此处必须把包围盒中心平移到
                       可视区中心：screen(worldPt)=view.x+worldPt*ts，令中心落到
                       (vw/2,vh/2) ⇒ tx=vw/2-centerX*ts，ty=vh/2-centerY*ts。 */
                    tx = vw / 2 - (b.x + b.w / 2) * ts;
                    ty = vh / 2 - (b.y + b.h / 2) * ts;
                    _ovState(true);
                    if (ovBtn) { ovBtn.textContent = '⤢ 恢复100%'; ovBtn.classList.add('ov-on'); }
                } else {
                    fx = view.x; fy = view.y; fs = view.scale;
                    /* 【双击聚焦修复 2026-11】exitTo={id}：退出总览时不再飞回 _ovPrev 旧视口，
                       而是直接飞到目标对话框居中位置。修复：旧行为先飞回旧视口（_ovRaf
                       500ms 动画）再让 _focusChatBox 起飞（_flyRaf），两个 rAF 同时逐帧写
                       view 互相覆盖 → 摄像机被拽回旧视口，看似"跑到很远"。 */
                    if (exitTo && exitTo.id != null) {
                        var _fc = null;
                        if (self.chatBoxes) {
                            for (var i = 0; i < self.chatBoxes.length; i++) {
                                if (String(self.chatBoxes[i].id) === String(exitTo.id)) { _fc = self.chatBoxes[i]; break; }
                            }
                        }
                        if (_fc && _fc.el) {
                            var _area = document.getElementById('canvasArea');
                            var _ns = Math.max(fs, Math.min(1, _ovPrev ? _ovPrev.s : 1));
                            tx = (_area ? _area.clientWidth : window.innerWidth) / 2 - (_fc.el.offsetLeft + _fc.el.offsetWidth / 2) * _ns;
                            ty = (_area ? _area.clientHeight : window.innerHeight) / 2 - (_fc.el.offsetTop + _fc.el.offsetHeight / 2) * _ns;
                            ts = _ns;
                            _ovPrev = { x: tx, y: ty, s: _ns }; // 同步记忆视口，避免下次恢复跑偏
                        }
                    }
                    if (tx === undefined) { tx = _ovPrev ? _ovPrev.x : 0; ty = _ovPrev ? _ovPrev.y : 0; ts = _ovPrev ? _ovPrev.s : 1; }
                    _ovState(false);
                    if (ovBtn) { ovBtn.textContent = '⤡ 缩小总览'; ovBtn.classList.remove('ov-on'); }
                    _ovExitPending = true; // 【策划案 20261123 #11】退出动画进行中：期间再进总览不得覆盖 _ovPrev
                    return (function(){ // 恢复走现有飞行动画（水晃等联动），但需要允许 scale 插值
                        fx = view.x; fy = view.y;
                        function _fly(now) {
                            var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
                            view.x = fx + (tx - fx) * e; view.y = fy + (ty - fy) * e;
                            view.scale = fs + (ts - fs) * e;
                            self._overviewApply();
                            // 【总览动画同步】每帧节流重绘小地图，缩小/恢复立即跟随，不再等平移触发
                            if (self.updateMinimap && (!self._mmLastFullDraw || performance.now() - self._mmLastFullDraw > 110)) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); }
                            if (p < 1) _ovRaf = requestAnimationFrame(_fly);
                            else { _ovRaf = null; _ovExitPending = false; if (typeof Store !== 'undefined' && Store.saveCanvas) Store.saveCanvas(view.x, view.y, view.scale); if (self.updateMinimap) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); } try { scheduleLOD(); setTimeout(scheduleLOD, 100); } catch (e) {} /* 【错位修复 v4】退出总览动画结束：按最终真实位置重算偏移基准并放开采集 */ setTimeout(function () { try { if (window.ZFRelativeRestore && ZFRelativeRestore.endMigration) ZFRelativeRestore.endMigration(); } catch (eOv2) {} }, 200); }
                        }
                        _ovRaf = requestAnimationFrame(_fly);
                    })();
                }
                fx = view.x; fy = view.y; fs = view.scale;
                function _fly2(now) {
                    var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
                    view.x = fx + (tx - fx) * e; view.y = fy + (ty - fy) * e;
                    view.scale = fs + (ts - fs) * e;
                    self._overviewApply();
                    // 【总览动画同步】每帧节流重绘小地图，缩小/恢复立即跟随，不再等平移触发
                    if (self.updateMinimap && (!self._mmLastFullDraw || performance.now() - self._mmLastFullDraw > 110)) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); }
                    if (p < 1) _ovRaf = requestAnimationFrame(_fly2);
                    else { _ovRaf = null; if (typeof Store !== 'undefined' && Store.saveCanvas) Store.saveCanvas(view.x, view.y, view.scale); if (self.updateMinimap) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); } /* 【缩小整理·0.1秒刷新】进入动画结束主动踢一帧 LOD，并延时100ms补一帧，立即重显各对话（含派团队行），不必手动平移 */ try { scheduleLOD(); setTimeout(scheduleLOD, 100); } catch (e) {} }
                }
                _ovRaf = requestAnimationFrame(_fly2);
            };
            var ovBtn = null;
            // 【M2 整合】右下角「缩小总览」按钮移除：左上「整理」按钮已直接切换总览，
            //   此处不再创建 canvasOverviewBtn；保留注释说明历史。
            if (false && !document.getElementById('canvasOverviewBtn')) {
                ovBtn = document.createElement('div');
                ovBtn.id = 'canvasOverviewBtn';
                ovBtn.textContent = '⤡ 缩小总览';
                ovBtn.style.cssText = 'position:fixed;right:16px;bottom:44px;z-index:9000;padding:6px 12px;border-radius:8px;cursor:pointer;user-select:none;font-size:12px;color:#cdd3e0;background:rgba(30,30,46,.82);border:1px solid rgba(120,130,160,.35);backdrop-filter:blur(6px);transition:background .18s,border-color .18s;';
                ovBtn.addEventListener('mouseenter', function(){ ovBtn.style.background = 'rgba(60,70,110,.9)'; });
                ovBtn.addEventListener('mouseleave', function(){ ovBtn.style.background = 'rgba(30,30,46,.82)'; });
                ovBtn.addEventListener('click', function(e){ e.stopPropagation(); self.canvasOverviewToggle(); });
                ovBtn.addEventListener('mousedown', function(e){ e.stopPropagation(); }); // 不触发画布平移
                document.body.appendChild(ovBtn);
            } else { ovBtn = document.getElementById('canvasOverviewBtn'); }
            // 【解耦 v2】缩小总览与恢复是两套独立操作：进入只靠总览按钮，退出只靠
            //   Esc/再点按钮（app-canvas-overview.js 接管）。此处不再「mousedown 即
            //   自动退出总览」——总览中平移就是平移缩放后的画布，不触发恢复。

            // 中键/左键空白处平移（rAF 节流，防止高频重排卡死）
            var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, rafId = 0;
            area.addEventListener('mousedown', function(e) {
                // 【平移卡死自愈】__kiteProxyDrag 残留 true 时禁止一切平移（历史 bug 源）。超 3 秒视为残留，自动解除
                if (window.__kiteProxyDrag) {
                    if (!window.__kiteProxyDragAt) { window.__kiteProxyDragAt = Date.now(); }
                    if (Date.now() - window.__kiteProxyDragAt > 3000) { window.__kiteProxyDrag = false; window.__kiteProxyDragAt = 0; }
                    else return;
                } else { window.__kiteProxyDragAt = 0; }
                window.__ovPanMoved = false; // 【策划案 20261123 #8】任何按键按下都先复位「已拖动」标志（旧写法只在右键分支复位）
                if (e.button === 1) {
                    // 中键：直接平移
                    if (window.__ovBkRaf) { cancelAnimationFrame(window.__ovBkRaf); window.__ovBkRaf = 0; } // 拖拽优先，掐掉总览回飞动画防竞争
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    ox = view.x; oy = view.y;
                    content.classList.add('dragging');
                    e.preventDefault();
                } else if (e.button === 2 && document.body.classList.contains('zf-overview-mode') && self._isCanvasBlankTarget(e.target)) {
                    // 【缩小整理模式】总览态右键空白处：平移画布（正常模式右键=创建对话框，互不影响）
                    if (window.__ovBkRaf) { cancelAnimationFrame(window.__ovBkRaf); window.__ovBkRaf = 0; }
                    // 【右键呼出创建条 v2】复位"本次右键是否发生拖动"标志：松开时未拖动 → quick-create 侧视为快速右键，呼出创建条
                    window.__ovPanMoved = false;
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    ox = view.x; oy = view.y;
                    content.classList.add('dragging');
                    document.body.classList.add('zf-ov-pan');
                    e.preventDefault();
                } else if (e.button === 0 && (e.ctrlKey || e.altKey) && self._isCanvasBlankTarget(e.target)) {
                    // Ctrl+左键：加选框选；Alt+左键：减选框选
                    e.preventDefault();
                    startMarquee(e.ctrlKey ? 'add' : 'sub');
                } else if (e.button === 0 && self._isCanvasBlankTarget(e.target)) {
                    // 左键：仅在画布空白区域平移（非对话框、非面板等）
                    if (window.__ovBkRaf) { cancelAnimationFrame(window.__ovBkRaf); window.__ovBkRaf = 0; }
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
                    /* 【FPS 两阶段化 2026-11-19】先一轮纯读(GBCR)再一轮纯写(classList)，消除每帧读写交错强制 layout 的抖动 */
                    var all = document.querySelectorAll(NODE_SEL);
                    var hit = [];
                    var i, n, r;
                    for (i = 0; i < all.length; i++) { // 第一阶段：纯读
                        r = all[i].getBoundingClientRect();
                        if (r.left < R && r.right > L && r.top < B && r.bottom > T) hit.push(all[i]);
                    }
                    var hitSet = new Set(hit);
                    var writeZ = []; // 需要置顶 zIndex 的节点延迟到写阶段末尾统一处理
                    for (i = 0; i < all.length; i++) { // 第二阶段：纯写
                        n = all[i];
                        if (mode === 'add') {
                            if (hitSet.has(n)) { n.classList.add('selected'); if (n.classList.contains('kite-node')) writeZ.push(n); }
                        } else if (mode === 'sub') {
                            // 减选：框外恢复基准选中，框内且非基准移除
                            if (hitSet.has(n) && baseSel.indexOf(n) === -1) n.classList.remove('selected');
                            else if (!hitSet.has(n) && baseSel.indexOf(n) !== -1) n.classList.add('selected');
                        } else { // 普通框选：框内选中框外清除（保持原 add-sub 之外的行为）
                            if (hitSet.has(n)) { n.classList.add('selected'); if (n.classList.contains('kite-node')) writeZ.push(n); }
                        }
                    }
                    writeZ.forEach(function (n) { if (window.KiteCanvas && window.KiteCanvas.list) { var __k = window.KiteCanvas.list().find(function (m) { return m.id === n.dataset.id; }); if (__k && window.__KiteNS && window.__KiteNS.state) n.style.zIndex = ++window.__KiteNS.state.zIndex; } });
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
                // 【右键呼出创建条 v2】总览态右键平移期间标记"已拖动"，松开时据此抑制创建条呼出
                if (document.body.classList.contains('zf-overview-mode') &&
                    Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6) window.__ovPanMoved = true;
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
                document.body.classList.remove('zf-ov-pan'); // 总览态右键平移光标复位
                /* 【修复 2026-11-28】「已拖动」标志不能残留到下一次单击，否则总览态「单击空白关闭创建条」(app-quick-create.js)被永久跳过。
                   【策划案 20261123 #8】但也不能在 mouseup 里同步清零：Windows 的 contextmenu（右键）和 click（左键）都在
                   mouseup 之后才派发，同步清零让 zf-organize-batch-entry.js / app-quick-create.js 的「拖动平移 = 不呼出 /
                   不关闭」判断永远读到 false（实测：总览态右键拖动平移松手必弹「批量问题」面板）。改为延后一个宏任务再清：
                   紧随 mouseup 的 contextmenu/click 仍读到 true；下一次 mousedown 也会先复位（见上方 mousedown 处理）。 */
                if (window.__ovPanMoved) setTimeout(function () { if (!dragging) window.__ovPanMoved = false; }, 0);
                // 历史背景（2026-11-28）：
                                             // 左键拖动后残留 true，导致总览态单击空白关闭创建条的判断(app-quick-create.js)被永久跳过。
                if (dragging) {
                    dragging = false; content.classList.remove('dragging');
                    self._mmKickT = 0; self._flyPx = undefined;
                    if (typeof Store !== 'undefined' && Store.saveCanvas) {
                        Store.saveCanvas(view.x, view.y, view.scale);
                    }
                    // 【平移卡顿优化】拖拽期间跳过了小地图全量重绘，松手时补一次兜底
                    if (self.updateMinimap) { self._mmLastFullDraw = performance.now(); self.updateMinimap(); }
                    self._ovLodT = 0; // 松手补一次 LOD/裁剪全量（拖拽期被 80ms 节流压着）
                    try { scheduleLOD(); if (typeof _scheduleCull === 'function') _scheduleCull(); } catch (eLod) {}
                }
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            }
            document.addEventListener('mouseup', function(e) {
                if (e.button === 1 || e.button === 0 || e.button === 2 || dragging) stopDrag();
            });
            window.addEventListener('blur', stopDrag);
            document.addEventListener('mouseleave', stopDrag);

            // 滚轮缩放已彻底禁用 — 始终保持 100%，阻止一切缩放行为
            // 但在可滚动的子元素（如对话框内容区）上滚动时，允许默认滚动行为
            /* 【策划案 20261123 #17】Map 改 WeakMap（get/set 接口相同）：key 是滚轮目标到画布之间的每个元素，
               旧写法只 set 不 delete，被重渲染/裁剪/关闭对话删掉的消息节点会连同整棵子树被一直持有，长会话里单调增长。 */
            var _scrollCache = new WeakMap(); // 元素 -> {t, scrollable} 可滚动检测结果缓存
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
                var tTapMoved = false; // v6：单指是否为拖动（用于区分纯点击 tap）
                area.addEventListener('touchstart', function(e) {
                    if (!self._isCanvasBlankTarget(e.target)) return; // 节点/面板上不抢手势
                    tTapMoved = false;
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
                        if (Math.abs(e.touches[0].clientX - sx) > 8 || Math.abs(e.touches[0].clientY - sy) > 8) tTapMoved = true;
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
                        if (dragging) {
                            if (!tTapMoved) {
                                // 纯点击（tap）：preventDefault 抑制了合成 mouse 事件，
                                // 这里在触点补发 mousedown/mouseup/click，驱动原有
                                // 点击定位 / 取消选中 / 空白新建 等逻辑（v6 修复手点不动）
                                var ct = (e.changedTouches && e.changedTouches[0]) || null;
                                if (ct) {
                                    var tgt = document.elementFromPoint(ct.clientX, ct.clientY) || area;
                                    var mk = function(tp){ return new MouseEvent(tp, { bubbles: true, cancelable: true, view: window, clientX: ct.clientX, clientY: ct.clientY, button: 0, which: 1 }); };
                                    tgt.dispatchEvent(mk('mousedown'));
                                    tgt.dispatchEvent(mk('mouseup'));
                                    tgt.dispatchEvent(mk('click'));
                                }
                            }
                            dragging = false; content.classList.remove('dragging');
                        }
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
                    /* 【LOD扩容 2026-11】culling 名单从只有 .kite-node 扩到全部画布窗口节点（.chatbox 对话窗是
                       47k DOM 的主要来源，15 个对话窗全量渲染导致 7FPS），屏外对话窗 visibility+content-visibility
                       双重隐藏，跳过 layout/paint 全链路；豁免规则不变（视口中心/选中/流式中不隐藏）。 */
                    var nodes = document.querySelectorAll('.kite-node,.chatbox,.browser-node,.engine-node,.video-node,.fg-node,.pres-node');
                    var cx = vw / 2, cy = vh / 2; // 视口中心点
                    /* 【FPS 两阶段化 2026-11-19】第一轮纯读(GBCR/classList/getAttribute)→第二轮纯写(style)，
                       消除逐节点读→写→读的强制 layout 抖动 */
                    var results = [];
                    var i, el, r, off, centerHit, keep;
                    for (i = 0; i < nodes.length; i++) {
                        el = nodes[i];
                        r = el.getBoundingClientRect();
                        off = r.right < -pad || r.bottom < -pad || r.left > vw + pad || r.top > vh + pad;
                        // 【强制显示豁免】覆盖视口中心的节点（用户正看的位置）、选中中、流式输出中的节点永不隐藏
                        centerHit = r.left <= cx && r.right >= cx && r.top <= cy && r.bottom >= cy;
                        keep = !off || centerHit
                            || el.classList.contains('selected')
                            || el.getAttribute('data-streaming') === '1';
                        results.push(keep);
                    }
                    var shown = false;
                    for (i = 0; i < nodes.length; i++) { // 第二轮纯写
                        el = nodes[i];
                        if (results[i]) {
                            if (el.style.contentVisibility === 'hidden') shown = true;
                            el.style.visibility = ''; el.style.contentVisibility = '';
                        } else { el.style.visibility = 'hidden'; el.style.contentVisibility = 'hidden'; }
                    }
                    /* 【CV 守卫·延后滚底】有节点从隐藏剔除回到可见 → 同步通知（先于本帧绘制）：让"隐藏期间记账的
                       滚到底部"在此刻补滚，回屏即到位、肉眼无跳动（见 chatbox-lazy-offscreen.js zfScrollBottom） */
                    if (shown) { try { document.dispatchEvent(new CustomEvent('zf-render-show')); } catch (e) {} }
                } catch (e) { /* noop */ }
            }
            function _scheduleCull() { if (_cullTimer) return; _cullTimer = setTimeout(_cullNodes, 200); }
            window.addEventListener('scroll', _scheduleCull, { passive: true });
            window.addEventListener('resize', _scheduleCull, { passive: true });
            // 【已删 setInterval(_scheduleCull,1500) 轮询】触发源已补齐（apply/_overviewApply 摄像机更新处），
            // 保留 800ms 首帧兜底 + 事件驱动即可，消除恒定轮询坏味道（代码师步骤3，经审核员通过）
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
                // 【v7.4】随手标题上双击不弹创建面板（双击应是编辑标题）
                if (e.target.closest && e.target.closest('.quick-note')) return;
                /* 【用户令v3】分组标签头/折叠卡上的双击=重命名，禁止弹出创建对话框面板 */
                if (e.target.closest && (e.target.closest('.zf-grp-head') || e.target.closest('.zf-grp-card'))) return;
                // 【缩小整理模式】总览态双击=简洁输入对话框，不再弹「创建对话框」面板（重复）
                if (document.body.classList.contains('zf-overview-mode')) { _lastT = 0; return; }
                e.preventDefault();
                openCreatePanels(e.clientX, e.clientY, e.target);
            });

            // 兜底通道：dblclick 被拖拽/指针捕获/自定义手势吞掉时，
            // 用两次快速且位移极小的 click 模拟双击（去抖：350ms 内、位移 <6px）
            var _lastT = 0, _lastX = 0, _lastY = 0, _lastTarget = null;
            document.addEventListener('click', function(e) {
                if (Date.now() < (window._qcSuppressUntil||0)) { _lastT = 0; return; } // 长按/兜底刚弹出，抑制紧随的 click
                var inC = _inCanvas(e.target);
                if (!inC) { _lastT = 0; return; }
                // 【v7.4】随手标题上双击不弹创建面板（兜底通道同样排除）
                if (e.target.closest && e.target.closest('.quick-note')) { _lastT = 0; return; }
                /* 【用户令v3】分组头/折叠卡上快速双击不弹创建面板 */
                if (e.target.closest && (e.target.closest('.zf-grp-head') || e.target.closest('.zf-grp-card'))) { _lastT = 0; return; }
                // 【缩小整理模式】总览态双击=简洁输入对话框，兜底通道同样不弹「创建对话框」
                if (document.body.classList.contains('zf-overview-mode')) { _lastT = 0; return; }
                var now = Date.now();
                var gap = now - _lastT;
                var dx = Math.abs(e.clientX - _lastX), dy = Math.abs(e.clientY - _lastY);
                // 原生双击判定（detail>=2）或 快速两次近距 click，任一命中即弹
                if (e.detail >= 2 ||
                    (gap < 350 && gap >= 0 && dx < 6 && dy < 6)) {
                    _lastT = 0; // 消费掉，避免三连击触发两次
                    window._qcSuppressUntil = Date.now() + (window.QC_SUPPRESS_MS||800); // 抑制紧随的 dblclick，避免双开
                    openCreatePanels(e.clientX, e.clientY, _lastTarget || e.target);
                } else {
                    _lastT = now; _lastX = e.clientX; _lastY = e.clientY; _lastTarget = e.target;
                }
            }, true);

            // ===== 长按通道：左键按住画布空白处 1.5 秒不动 → 打开创建面板 =====
            var _lpTimer = null, _lpX = 0, _lpY = 0, _lpTarget = null;
            function _lpClear() {
                if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
                document.removeEventListener('mousemove', _lpMove, true);
                document.removeEventListener('mouseup', _lpUp, true);
            }
            function _lpMove(e) {
                // 移动超过 6px 视为拖拽平移，取消长按
                if (Math.abs(e.clientX - _lpX) > 6 || Math.abs(e.clientY - _lpY) > 6) _lpClear();
            }
            function _lpUp() { _lpClear(); }
            document.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                var inC = _inCanvas(e.target);
                if (!inC) return;
                var blank = true;
                try { blank = typeof self._isCanvasBlankTarget === 'function' ? self._isCanvasBlankTarget(e.target) : true; }
                catch (err) { blank = true; }
                if (!blank) return; // 只在空白处长按生效
                _lpX = e.clientX; _lpY = e.clientY; _lpTarget = e.target;
                _lpClear(); // 防重入
                document.addEventListener('mousemove', _lpMove, true);
                document.addEventListener('mouseup', _lpUp, true);
                _lpTimer = setTimeout(function() {
                    _lpClear();
                    // 抑制松开后的 click/兜底双击通道，避免长按松开瞬间误弹两次
                    window._qcSuppressUntil = Date.now() + (window.QC_SUPPRESS_MS||800);
                    openCreatePanels(_lpX, _lpY, _lpTarget);
                }, 1500);
            });

            // ===== 右键长按通道：右键按住画布空白处 1.5 秒不动 → 打开整理面板（网格排列对话框） =====
            var _rpTimer = null, _rpX = 0, _rpY = 0;
            function _rpClear() {
                if (_rpTimer) { clearTimeout(_rpTimer); _rpTimer = null; }
                document.removeEventListener('mousemove', _rpMove, true);
                document.removeEventListener('mouseup', _rpUp, true);
                document.removeEventListener('contextmenu', _rpCtx, true);
            }
            function _rpMove(e) {
                // 移动超过 6px 视为拖拽平移，取消右键长按
                if (Math.abs(e.clientX - _rpX) > 6 || Math.abs(e.clientY - _rpY) > 6) _rpClear();
            }
            function _rpUp() { _rpClear(); }
            function _rpCtx(e) {
                // 右键长按期间吞掉 contextmenu，避免松开时弹出系统右键菜单
                e.preventDefault(); e.stopPropagation();
            }
            document.addEventListener('mousedown', function(e) {
                if (e.button !== 2) return;
                // 【缩小整理模式】总览态右键=平移画布，禁用「右键长按切换总览」通道（正常模式才用右键长按进出总览）
                if (document.body.classList.contains('zf-overview-mode')) return;
                var inC = _inCanvas(e.target);
                if (!inC) return;
                var blank = true;
                try { blank = typeof self._isCanvasBlankTarget === 'function' ? self._isCanvasBlankTarget(e.target) : true; }
                catch (err) { blank = true; }
                if (!blank) return; // 只在空白处右键长按生效
                _rpX = e.clientX; _rpY = e.clientY;
                _rpClear(); // 防重入
                document.addEventListener('mousemove', _rpMove, true);
                document.addEventListener('mouseup', _rpUp, true);
                document.addEventListener('contextmenu', _rpCtx, true);
                _rpTimer = setTimeout(function() {
                    _rpClear();
                    // 抑制松开后的 click/兜底双击通道，避免误弹创建面板
                    window._qcSuppressUntil = Date.now() + (window.QC_SUPPRESS_MS||800);
                    // 【恢复旧版 2026-11-19 用户拍板】右键长按恢复【真对话框缩小版】i缩小整理（canvasOverviewToggle：
                    //   摄像机把真窗口整体缩小铺满全屏 + 派出团队浮条），MinimapOrganize 渐变卡片版降级为兜底。
                    if (window.App && typeof window.App.canvasOverviewToggle === 'function') {
                        window.App.canvasOverviewToggle();
                    } else if (window.MinimapOrganize && typeof window.MinimapOrganize.open === 'function') {
                        // ⛔以下为【作废引擎】兜底分支：MinimapOrganize 是废弃的旧渐变卡片版i整理（用户拍板作废，禁止还原），仅在旧版总览不可用时应急
                        window.MinimapOrganize.open(); // 兜底：旧版总览不可用时才用独立引擎
                    }
                }, 1500);
            });
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
            // QuickNoteLinks 系统已移除，此联动功能废弃
            // 原本用于随手标题跟随对话平移的联动逻辑已移除

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
                // 【防重启复活】先显式清除服务端墓碑（POST /nodes/{id}/revive），
                // 否则后续 saveNode 会被服务端墓碑拦截，导致重启后再次消失。
                var reviveP = (DB._request && DB._request('POST', '/nodes/' + encodeURIComponent(rec.id) + '/revive', {})) || Promise.resolve();
                Promise.resolve(reviveP).catch(function() {})
                    .then(function() { return DB.getNode(rec.id); })
                    .then(function(node) {
                        if (node) { restore(node); }
                        else { restore(rec.node || null); }
                    }).catch(function() { restore(rec.node || null); });
            } else {
                restore(rec.node || null);
            }
        }
});

/* ===== FPS HUD 角标（?fps=1 或 localStorage.zf_fps=1 开启）=====
   【60对话60帧·量化验收】把"卡不卡"变成可复现数字。<45 标红。不开启时零开销。 */
(function(){try{var q=new URLSearchParams(location.search);
if(!(q.get('fps')==='1'||localStorage.getItem('zf_fps')==='1'))return;
var el=document.createElement('div');el.id='zfFpsHud';
el.style.cssText='position:fixed;right:8px;bottom:8px;z-index:100000;background:rgba(0,0,0,.65);color:#0f0;font:12px/1.4 Consolas,monospace;padding:4px 10px;border-radius:6px;pointer-events:none;white-space:pre;';
document.body.appendChild(el);
var frames=0,last=performance.now(),worst=0;
function loop(t){frames++;var dt=t-last;
if(dt>=1000){var fps=Math.round(frames*1000/dt);
if(fps<worst||worst===0)worst=fps;
el.textContent=fps+' FPS  (\u6700\u4f4e '+worst+')';
el.style.color=fps<45?'#f55':'#0f0';
frames=0;last=t;}
requestAnimationFrame(loop);}
requestAnimationFrame(loop);}catch(e){console.warn('FPS HUD init fail',e);}})();

/* ===== i导航圆盘内部左侧「活跃对话数」微读数（#minimapChatCount）：常驻，1秒一刷。
   只统计正在工作的会话：DOM 数 .chatbox[data-state] 处于运行态（streaming/tool_running/queued），
   兜底 data-streaming='1'（流式输出事件层标记）。悬停 title 显示明细。 ===== */
(function(){try{
var el=null,tries=0;
var timer=setInterval(function(){
  el=document.getElementById('minimapChatCount');
  if(el){clearInterval(timer);start();}
  else if(++tries>100){clearInterval(timer);}
},50);
function start(){
function tick(){
  try{
    /* 【活跃口径】只数正在工作的会话（七态机运行态），不算全部对话。
       七态机把 box.dataset.state 标为 streaming/tool_running/queued；
       流式事件层还有 data-streaming='1' 兜底（状态机未覆盖瞬间）。 */
    var boxes=document.querySelectorAll('.chatbox');
    var n=0,names=[];
    for(var i=0;i<boxes.length;i++){
      var st=boxes[i].dataset.state||'';
      var streaming=boxes[i].getAttribute('data-streaming')==='1';
      if(st==='streaming'||st==='tool_running'||st==='queued'||streaming){
        n++;
        if(names.length<10)names.push((boxes[i].querySelector('.chatbox-title')||{}).textContent||(boxes[i].title||'对话'));
      }
    }
    el.textContent='忙'+n;
    el.title='正在工作的对话：'+n+' 个'+(n?'\n（'+names.join('\n')+(names.length<n?'\n…':'')+'）':'');
  }catch(e){}
}
tick();
setInterval(tick,1000);
}
}catch(e){}})();

/* ===== i导航圆盘内部右侧 FPS 微读数（#minimapFps）：常驻，10px 淡灰小字，1秒一刷。
   <45 变淡红提示。无背景框不遮对话，元素由 dom-canvas.js 的 minimap 模板提供。
   样式本体在 style-extras.css（minimap 圆形舷窗改造段之后）。 ===== */
(function(){try{
var el=null,tries=0;
/* 【时序修复】元素由 dom-canvas.js 脚本注入，本脚本执行时可能尚未存在；
   旧逻辑拿不到直接 return 导致 FPS 永远不出现。改为每 50ms 轮询，最长等 5 秒。 */
var timer=setInterval(function(){
  el=document.getElementById('minimapFps');
  if(el){clearInterval(timer);start();}
  else if(++tries>100){clearInterval(timer);}
},50);
function start(){
var frames=0,last=performance.now(),worst=0;
function loop(t){frames++;var dt=t-last;
if(dt>=1000){var fps=Math.round(frames*1000/dt);
if(fps<worst||worst===0)worst=fps;
el.textContent='fps'+fps;
el.title='画布帧率 '+fps+' FPS（最低 '+worst+'）';
el.className='minimap-fps'+(fps<45?' fps-warn':'');
frames=0;last=t;}
requestAnimationFrame(loop);}
requestAnimationFrame(loop);}
}catch(e){}})();
