// ========== app-extras.js - 转义/通知/声音 ==========
Object.assign(App, {
        // ===== 将文本安全转义后放入 HTML（问题/回答展示用）=====
        _escapeForAttr: function(str) {
            if (typeof str !== 'string') str = String(str || '');
            var div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        // ===== _esq：_escapeForAttr 的简写别名（供表单渲染转义使用）=====
        _esq: function(str) {
            return this._escapeForAttr(str);
        },

        // ===== 右下角任务通知弹窗 =====
        showTaskNotify: function(opts) {
            var success = opts.success;
            var message = opts.message || '';
            var chatId = opts.chatId || '';
            var modelName = opts.modelName || '';
            var scope = opts.scope || '当前任务';
            var self = this;

            // ===== 系统级兜底（页面在后台/最小化时右下角弹窗看不见） =====
            try {
                var _pageTitle = document.title;
                // 1) 标题栏闪烁提醒（切走时任务栏图标会高亮）
                if (document.hidden || !document.hasFocus()) {
                    if (!self.__titleFlashTimer) {
                        var _flashCount = 0;
                        self.__titleFlashTimer = setInterval(function() {
                            document.title = (_flashCount % 2 === 0) ? '✅ 任务完成 - 朱峰社区智能体' : _pageTitle;
                            if (++_flashCount > 10) { clearInterval(self.__titleFlashTimer); self.__titleFlashTimer = null; document.title = _pageTitle; }
                        }, 900);
                    }
                }
                // 2) 浏览器系统通知（需用户授权一次；最小化也能弹）
                if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
                    var _n = new Notification(success ? '✅ 任务完成' : '❌ 任务失败', {
                        body: (message || '').slice(0, 120) + (chatId ? '　— ' + chatId : ''),
                        tag: 'zf-task-' + chatId
                    });
                    _n.onclick = function() { window.focus(); _n.close(); };
                }
            } catch (eNotify) {}

            // ===== 礼花庆祝：任务成功（含二次验证成功）时，在对应对话框上方放礼花 =====
            if (success) {
                try { var _fw = this; var _isVerify = !!opts.isVerify; var _go = function(){ try { _fw.fireworkCelebrate(chatId, _isVerify); } catch(eFw){} };
                    // 【修复】页面在后台时 requestAnimationFrame 被暂停，礼花画不出来 → 等回到前台再放
                    // 🛡️ 防爆卡：后台期间 rAF 冻结会积压大量礼花秀，切回前台瞬间齐放导致爆卡。
                    // 后台积压的庆祝直接丢弃（只保留最新一个 pending），切回后只放一次
                    /* 防爆卡：后台积压庆祝丢弃，仅保留最新一个 pending，切回前台只放一次 */
                    if (!_fw._fwPend) { if (document.hidden) { _fw._fwPend = true; _fw._fwVisHandler = function(){ if (document.hidden) { return; } document.removeEventListener('visibilitychange', _fw._fwVisHandler); _fw._fwVisHandler = null; _fw._fwPend = false; _go(); }; document.addEventListener('visibilitychange', _fw._fwVisHandler); /* 兜底：若 3s 内事件未正确触发（如标签页被冻结），强制复位防卡死 */ setTimeout(function(){ if (_fw._fwPend && _fw._fwVisHandler) { document.removeEventListener('visibilitychange', _fw._fwVisHandler); _fw._fwVisHandler = null; _fw._fwPend = false; if (!document.hidden) { _go(); } } }, 3000); } else { setTimeout(_go, 200); } }
                } catch (eFw0) {}
            }

            // 确保容器存在
            var container = document.querySelector('.notify-container');
            if (!container) {
                container = document.createElement('div');
                container.className = 'notify-container';
                document.body.appendChild(container);
            }

            var icon = success ? '✅' : '❌';
            var title = success ? '任务成功' : '任务失败';
            // 二次验证成功：与普通任务成功明确区分（✅✅ 金色标题）
            var isVerify = !!opts.isVerify;
            if (success && isVerify) {
                icon = '✅✅';
                title = '二次验证成功';
            }
            if (scope && scope !== '当前任务') {
                title += ' · ' + scope;
            }
            var cls = 'task-notify ' + (success ? (isVerify ? 'task-notify--verify' : 'task-notify--success') : 'task-notify--fail');

            var notify = document.createElement('div');
            notify.className = cls;
            if (chatId) notify.dataset.chatId = chatId;
            notify.innerHTML =
                '<div class="task-notify__header">' +
                    '<span class="task-notify__icon">' + icon + '</span>' +
                    '<span class="task-notify__title">' + title + '</span>' +
                    '<button class="task-notify__close">✕</button>' +
                '</div>' +
                '<div class="task-notify__body">' +
                    '<div class="task-notify__source">' +
                        '<span class="source-tag">' + chatId + '</span>' +
                        '<span class="source-model">' + modelName + '</span>' +
                    '</div>' +
                    '<div class="task-notify__msg">' + Tools.escapeHtml(message) + '</div>' +
                '</div>' +
                '<div class="task-notify__hint">点击关闭 · 双击定位到对话框</div>';

            // 【2026 修复】堆叠上限：容器是 column-reverse，新弹窗往上叠，无上限时会堆出屏幕顶部（实测第6个就到 -57px），
            // 守卫/多对话集中完成时表现为"弹窗没出来"。超过 4 个时移除最旧的。
            try {
                var _existing = container.querySelectorAll('.task-notify');
                while (_existing.length >= 4) {
                    _existing[0].remove();
                    _existing = container.querySelectorAll('.task-notify');
                }
            } catch (eStack) {}

            container.appendChild(notify);

            // 关闭按钮
            var closeBtn = notify.querySelector('.task-notify__close');
            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    notify.classList.add('notify-out');
                    setTimeout(function() { notify.remove(); }, 400);
                });
            }

            // 单击延迟关闭 + 双击定位到对应对话框
            var clickTimer = null;
            notify.addEventListener('click', function(e) {
                if (e.target.classList.contains('task-notify__close')) return;
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
                clickTimer = setTimeout(function() {
                    clickTimer = null;
                    notify.classList.add('notify-out');
                    setTimeout(function() { if (notify.parentNode) notify.remove(); }, 400);
                }, 250);
            });
            // 双击：移动画布视口到对应对话框居中显示
            notify.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                var targetChat = self.chatBoxes.find(function(c) { return c.id === chatId; });
                if (!targetChat || !targetChat.el) return;
                var boxEl = targetChat.el;
                var canvasArea = document.getElementById('canvasArea');
                var vw = canvasArea.clientWidth, vh = canvasArea.clientHeight;
                var cx = boxEl.offsetLeft + boxEl.offsetWidth / 2;
                var cy = boxEl.offsetTop + boxEl.offsetHeight / 2;
                var scale = self.canvasScale ? self.canvasScale() : 1;
                var tx = vw / 2 - cx * scale;
                var ty = vh / 2 - cy * scale;
                if (self.canvasSetView) { self.canvasSetView(tx, ty, scale, true); }
                self.activate(boxEl);
                boxEl.classList.add('task-success');
                // 持久标记成功状态（用于成功导航箭头）并刷新所有箭头
                if (window.ChatBox) {
                    var cbx = window.ChatBox.chatBoxes && window.ChatBox.chatBoxes.filter(function(c){ return c.el === boxEl; })[0];
                    if (cbx) cbx._taskStatus = 'success';
                    if (window.ChatBox._updateAllNavArrows) window.ChatBox._updateAllNavArrows();
                }
                setTimeout(function() { boxEl.classList.remove('task-success'); }, 2000);
                notify.classList.add('notify-out');
                setTimeout(function() { if (notify.parentNode) notify.remove(); }, 400);
            });

        },

        // ===== 礼花庆祝：Canvas 粒子礼花 + WebAudio 立体声礼花声 =====
        // 在对应 chatId 的对话框上方绽放；每次随机调色板/粒子数/大小/弹型，各有变化
        fireworkCelebrate: function(chatId, isVerify) {
            var canvasArea = document.getElementById('canvasArea') || document.body;
            // 【2026 修复】改用视口坐标 + fixed 全屏 canvas：
            // 原来用 offsetLeft/offsetTop + 挂在 canvasArea 上，画布缩放/平移后坐标会偏出屏幕，导致看不到礼花
            var vw = window.innerWidth, vh = window.innerHeight;
            var cx = vw / 2, cy = vh * 0.3;
            try {
                var target = (this.chatBoxes || []).find(function(c) { return String(c.id) === String(chatId) && c.el; });
                if (target && target.el) {
                    var r = target.el.getBoundingClientRect();
                    if (r && r.width > 0) {
                        cx = Math.max(80, Math.min(vw - 80, r.left + r.width / 2));
                        cy = Math.max(60, Math.max(60, r.top - 40)); // 对话框正上方
                    }
                }
            } catch (ePos) {}

            // 【对象池优化】canvas 不再每次新建，全局共享一个礼花画布（引用计数，全部庆祝结束后才移除）
            if (!App.__fwCanvas || !App.__fwCanvas.isConnected) {
                var cv0 = document.createElement('canvas');
                cv0.width = window.innerWidth; cv0.height = window.innerHeight;
                cv0.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;';
                document.body.appendChild(cv0);
                App.__fwCanvas = cv0;
                App.__fwCtx = cv0.getContext('2d');
                App.__fwRefs = 0;
            }
            // 窗口尺寸变化时同步画布分辨率（只改 width/height，不动 DOM）
            var cv = App.__fwCanvas;
            if (cv.width !== vw || cv.height !== vh) { cv.width = vw; cv.height = vh; }
            App.__fwRefs++;
            var ctx = App.__fwCtx;

            // —— 每次不同的"种子"变化 ——
            var PALETTES = [
                [[255,80,120],[255,160,90],[255,230,120]],          // 玫红金
                [[90,200,255],[140,120,255],[220,160,255]],         // 极光紫蓝
                [[120,255,180],[80,230,255],[200,255,140]],         // 翡翠青
                [[255,200,80],[255,120,60],[255,240,180]],          // 暖金橙
                [[255,255,255],[255,180,220],[180,220,255]]         // 银白粉
            ];
            var pal = PALETTES[(Math.random() * PALETTES.length) | 0];
            var burstCount = isVerify ? 3 : (2 + ((Math.random() * 2) | 0));   // 二次验证更隆重
            var shape = ['sphere', 'ring', 'willow'][(Math.random() * 3) | 0]; // 弹型：球形/环形/垂柳
            var baseSize = 1.2 + Math.random() * 1.6;                          // 粒子大小差异
            var baseSpeed = 2.4 + Math.random() * 1.8;

            // —— WebAudio 礼花声（合成爆裂声+上升啸声），按横向位置声像 ——
            var panX = (cx / Math.max(1, vw)) * 2 - 1;  // -1 左 … +1 右
            // 距离衰减：离视口中心越远，声音越小（模拟远近）
            var dist = Math.sqrt(Math.pow(cx - vw / 2, 2) + Math.pow(cy - vh / 2, 2));
            var maxDist = Math.sqrt(vw * vw + vh * vh) / 2;
            var atten = Math.max(0.25, 1 - dist / maxDist); // 中心 1.0 → 最远 0.25
            var boomAt = function(delayMs, strength) {
                try {
                    var AC = window.AudioContext || window.webkitAudioContext;
                    if (!AC) return;
                    if (!App.__fwAudioCtx) App.__fwAudioCtx = new AC();
                    var ac = App.__fwAudioCtx;
                    if (ac.state === 'suspended') ac.resume();
                try { ac.resume && ac.resume(); } catch(eR0) {}
                    var t0 = ac.currentTime + delayMs / 1000;
                    var pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
                    if (pan) pan.pan.value = Math.max(-1, Math.min(1, panX));
                    var master = ac.createGain();
                    master.gain.value = 0.16 * strength * atten;   // 轻一点 + 距离衰减
                    var dest = pan ? (pan.connect(master), pan) : master;
                    master.connect(ac.destination);
                    // 白噪声爆裂（低通滤波衰减）
                    var dur = 0.5 + Math.random() * 0.3;
                    var buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
                    var d = buf.getChannelData(0);
                    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
                    var src = ac.createBufferSource(); src.buffer = buf;
                    var lp = ac.createBiquadFilter(); lp.type = 'lowpass';
                    lp.frequency.setValueAtTime(3200, t0);
                    lp.frequency.exponentialRampToValueAtTime(300, t0 + dur);
                    src.connect(lp); lp.connect(dest);
                    src.start(t0);
                    // 低频"咚"体
                    var osc = ac.createOscillator(), og = ac.createGain();
                    osc.frequency.setValueAtTime(120, t0);
                    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
                    og.gain.setValueAtTime(0.5 * strength * atten, t0);
                    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
                    osc.connect(og); og.connect(dest);
                    osc.start(t0); osc.stop(t0 + 0.35);
                } catch (eAu) {}
            };

            // 粒子集（对象池：复用死亡粒子的对象，避免 GC 抖动）
            if (!App.__fwParts) App.__fwParts = [];
            var parts = App.__fwParts, bursts = [];
            var spawnBurst = function(bx, by, delay) {
                bursts.push({ x: bx, y: by, delay: delay });
                boomAt(delay, 1 + Math.random() * 0.4);
                var n = 60 + ((Math.random() * 50) | 0);
                var cp = pal[(Math.random() * pal.length) | 0];
                for (var i = 0; i < n; i++) {
                    var a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
                    var sp = baseSpeed * (0.55 + Math.random() * 0.75);
                    if (shape === 'ring') sp = baseSpeed * (0.9 + Math.random() * 0.15);
                    if (shape === 'willow' && Math.random() < 0.4) sp *= 0.7;
                    var col = pal[(Math.random() * pal.length) | 0];
                    // 同一发放射以一主色为主，混入少量辅色更真实
                    if (Math.random() < 0.75) col = cp;
                    // 【对象池】优先复用已死亡粒子的对象
                    var p = null;
                    for (var k = parts.length - 1; k >= 0; k--) {
                        if (parts[k].life <= 0) { p = parts[k]; break; }
                    }
                    if (p) { parts.splice(k, 1); }
                    else { p = {}; }
                    p.x = bx; p.y = by;
                    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
                    p.life = 1; p.decay = 0.006 + Math.random() * 0.008;
                    p.size = baseSize * (0.6 + Math.random() * 0.9);
                    p.col = col; p.willow = shape === 'willow';
                    parts.push(p);
                }
            };

            // 发射排程：第一发在对话框正上方，其余在附近随机偏移
            spawnBurst(cx, cy, 0);
            for (var b = 1; b < burstCount; b++) {
                spawnBurst(
                    cx + (Math.random() * 2 - 1) * 160,
                    cy + (Math.random() * 2 - 1) * 90 - 20,
                    b * 380 + Math.random() * 200
                );
            }

            var start = performance.now(), raf;
            var frame = function(now) {
                var el = now - start;
                for (var i = 0; i < bursts.length; i++) {
                    if (!bursts[i]._fired && el >= bursts[i].delay) bursts[i]._fired = true;
                }
                ctx.clearRect(0, 0, cv.width, cv.height);
                ctx.globalCompositeOperation = 'lighter';
                var alive = 0;
                // 【对象池】每帧把死亡粒子换到数组末尾，帧尾截断（对象保留在 App.__fwPool 备用）
                var dead = [];
                for (var j = 0; j < parts.length; j++) {
                    var p = parts[j];
                    if (p.life <= 0) { dead.push(j); continue; }
                    alive++;
                    p.x += p.vx; p.y += p.vy;
                    p.vy += 0.035;            // 重力
                    p.vx *= 0.985; p.vy *= 0.985;
                    if (p.willow) p.vy += 0.02; // 垂柳下垂更明显
                    p.life -= p.decay;
                    var al = Math.max(0, p.life);
                    var r = Math.round(p.col[0]), g = Math.round(p.col[1]), bl = Math.round(p.col[2]);
                    // 拖尾：画短线段
                    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ',' + al + ')';
                    ctx.lineWidth = p.size;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(p.x - p.vx * 2, p.y - p.vy * 2);
                    ctx.lineTo(p.x, p.y);
                    ctx.stroke();
                    // 高光小点
                    if (al > 0.7) {
                        ctx.fillStyle = 'rgba(255,255,255,' + (al - 0.7) * 2 + ')';
                        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.5, 0, 6.284); ctx.fill();
                    }
                }
                // 帧尾移除死亡粒子（对象本体进备用池可复用）
                if (dead.length) {
                    if (!App.__fwPool) App.__fwPool = [];
                    for (var d = 0; d < dead.length; d++) {
                        var di = dead[d] - d;
                        if (App.__fwPool.length < 400) App.__fwPool.push(parts[di]);
                        parts.splice(di, 1);
                    }
                }
                if (alive > 0 && el < 6000) {
                    raf = requestAnimationFrame(frame);
                } else {
                    cancelAnimationFrame(raf);
                    // 【对象池】引用计数归零才移除共享画布
                    App.__fwRefs--;
                    if (App.__fwRefs <= 0 && cv.parentNode) cv.remove();
                }
            };
            raf = requestAnimationFrame(frame);
        },

        // ===== 模式切换确认弹窗 =====
        showModeSwitchConfirm: function(opts) {
            var catName = opts.catName || '';
            var catIcon = opts.catIcon || '';
            var catDesc = opts.catDesc || '';
            var toolCount = opts.toolCount || 0;
            var onConfirm = opts.onConfirm || function() {};

            var existing = document.getElementById('modeSwitchConfirmOverlay');
            if (existing) existing.remove();

            var overlay = document.createElement('div');
            overlay.className = 'overlay show';
            overlay.id = 'modeSwitchConfirmOverlay';
            overlay.style.zIndex = '10001';

            overlay.innerHTML =
                '<div class="modal" style="width:360px;max-width:90vw;">' +
                    '<div class="modal-header">' +
                        '<h3>🔄 切换模式</h3>' +
                        '<button class="modal-close" data-act="cancel">✕</button>' +
                    '</div>' +
                    '<div class="modal-body" style="text-align:center;padding:24px 18px;">' +
                        '<div style="font-size:48px;margin-bottom:12px;">' + catIcon + '</div>' +
                        '<div style="font-size:18px;font-weight:600;margin-bottom:8px;">' + catName + ' 模式</div>' +
                        '<div style="font-size:13px;color:var(--text2,#b8b8cc);margin-bottom:16px;line-height:1.5;">' + Tools.escapeHtml(catDesc) + '</div>' +
                        '<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;background:var(--bg-hover,#252535);font-size:12px;color:var(--text2,#b8b8cc);">' +
                            '<span>📦</span><span>将加载 ' + toolCount + ' 个工具</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="modal-footer">' +
                        '<button class="lp-btn" data-act="cancel" style="padding:8px 20px;">取消</button>' +
                        '<button data-act="confirm" style="padding:8px 20px;background:var(--accent,#6c5ce7);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">确认切换</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) { overlay.remove(); return; }
                var act = e.target.dataset ? e.target.dataset.act : '';
                if (act === 'cancel') {
                    overlay.remove();
                } else if (act === 'confirm') {
                    overlay.remove();
                    onConfirm();
                }
            });
        },

        // ===== 工具分类切换通知弹窗 =====
        showCategorySwitchNotify: function(opts) {
            var catName = opts.catName || '';
            var catIcon = opts.catIcon || '';
            var catDesc = opts.catDesc || '';
            var toolCount = opts.toolCount || 0;
            var chatId = opts.chatId || '';
            var self = this;

            // 确保容器存在
            var container = document.querySelector('.notify-container');
            if (!container) {
                container = document.createElement('div');
                container.className = 'notify-container';
                document.body.appendChild(container);
            }

            var notify = document.createElement('div');
            notify.className = 'task-notify task-notify--info';
            notify.innerHTML =
                '<div class="task-notify__header">' +
                    '<span class="task-notify__icon">' + catIcon + '</span>' +
                    '<span class="task-notify__title">工具分类已切换</span>' +
                    '<button class="task-notify__close">✕</button>' +
                '</div>' +
                '<div class="task-notify__body">' +
                    '<div class="task-notify__source">' +
                        '<span class="source-tag">' + chatId + '</span>' +
                        '<span class="source-model">' + catName + ' · ' + toolCount + ' 个工具</span>' +
                    '</div>' +
                    '<div class="task-notify__msg">' + Tools.escapeHtml(catDesc) + '</div>' +
                '</div>' +
                '<div class="task-notify__hint">点击关闭 · 双击定位到对话框</div>';

            container.appendChild(notify);

            // 关闭按钮
            var closeBtn = notify.querySelector('.task-notify__close');
            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    notify.classList.add('notify-out');
                    setTimeout(function() { notify.remove(); }, 400);
                });
            }

            // 单击延迟关闭 + 双击定位
            var clickTimer = null;
            notify.addEventListener('click', function(e) {
                if (e.target.classList.contains('task-notify__close')) return;
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
                clickTimer = setTimeout(function() {
                    clickTimer = null;
                    notify.classList.add('notify-out');
                    setTimeout(function() { if (notify.parentNode) notify.remove(); }, 400);
                }, 250);
            });
            notify.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                var targetChat = self.chatBoxes.find(function(c) { return c.id === chatId; });
                if (!targetChat || !targetChat.el) return;
                var boxEl = targetChat.el;
                var canvasArea = document.getElementById('canvasArea');
                var vw = canvasArea.clientWidth, vh = canvasArea.clientHeight;
                var cx = boxEl.offsetLeft + boxEl.offsetWidth / 2;
                var cy = boxEl.offsetTop + boxEl.offsetHeight / 2;
                var scale = self.canvasScale ? self.canvasScale() : 1;
                var tx = vw / 2 - cx * scale;
                var ty = vh / 2 - cy * scale;
                if (self.canvasSetView) { self.canvasSetView(tx, ty, scale, true); }
                self.activate(boxEl);
                boxEl.classList.add('task-success');
                // 持久标记成功状态（用于成功导航箭头）并刷新所有箭头
                if (window.ChatBox) {
                    var cbx = window.ChatBox.chatBoxes && window.ChatBox.chatBoxes.filter(function(c){ return c.el === boxEl; })[0];
                    if (cbx) cbx._taskStatus = 'success';
                    if (window.ChatBox._updateAllNavArrows) window.ChatBox._updateAllNavArrows();
                }
                setTimeout(function() { boxEl.classList.remove('task-success'); }, 2000);
                notify.classList.add('notify-out');
                setTimeout(function() { if (notify.parentNode) notify.remove(); }, 400);
            });

            // 6秒后自动消失
            setTimeout(function() {
                if (notify.parentNode) {
                    notify.classList.add('notify-out');
                    setTimeout(function() { if (notify.parentNode) notify.remove(); }, 400);
                }
            }, 6000);
        },

        // ===== 分类切换声音提示（WebAudio 合成，清脆短音） =====
        playSwitchSound: function() {
            try {
                var ctx = new (window.AudioContext || window.webkitAudioContext)();
                var now = ctx.currentTime;

                // 第一声 523Hz (C5)
                var osc1 = ctx.createOscillator();
                var gain1 = ctx.createGain();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(523, now);
                gain1.gain.setValueAtTime(0, now);
                gain1.gain.linearRampToValueAtTime(0.25, now + 0.01);
                gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc1.connect(gain1).connect(ctx.destination);
                osc1.start(now);
                osc1.stop(now + 0.15);

                // 第二声 784Hz (G5) 稍高
                var osc2 = ctx.createOscillator();
                var gain2 = ctx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(784, now + 0.08);
                gain2.gain.setValueAtTime(0, now + 0.08);
                gain2.gain.linearRampToValueAtTime(0.25, now + 0.09);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                osc2.connect(gain2).connect(ctx.destination);
                osc2.start(now + 0.08);
                osc2.stop(now + 0.25);

                // 延迟关闭 AudioContext
                setTimeout(function() { try { ctx.close(); } catch(e) {} }, 1000);
            } catch(e) {
                console.warn('[ZF3D] 切换声音播放失败:', e.message);
            }
        },

        // ===== 声音提示（WebAudio 合成，无需音频文件） =====
        playTaskSound: function(success) {
            try {
                var ctx = new (window.AudioContext || window.webkitAudioContext)();
                // 【修复】浏览器自动播放策略：未经手势解锁/页面后台过久时 ctx 会 suspended，
                // 必须 resume，否则任务完成提示音永远不响
                if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e0) {} }
                var now = ctx.currentTime;

                if (success) {
                    // 成功：两声升调（叮-叮）
                    // 第一声 660Hz
                    var osc1 = ctx.createOscillator();
                    var gain1 = ctx.createGain();
                    osc1.type = 'sine';
                    osc1.frequency.setValueAtTime(660, now);
                    gain1.gain.setValueAtTime(0, now);
                    gain1.gain.linearRampToValueAtTime(0.3, now + 0.02);
                    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                    osc1.connect(gain1).connect(ctx.destination);
                    osc1.start(now);
                    osc1.stop(now + 0.25);

                    // 第二声 880Hz（更高音）
                    var osc2 = ctx.createOscillator();
                    var gain2 = ctx.createGain();
                    osc2.type = 'sine';
                    osc2.frequency.setValueAtTime(880, now + 0.12);
                    gain2.gain.setValueAtTime(0, now + 0.12);
                    gain2.gain.linearRampToValueAtTime(0.3, now + 0.14);
                    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
                    osc2.connect(gain2).connect(ctx.destination);
                    osc2.start(now + 0.12);
                    osc2.stop(now + 0.45);

                } else {
                    // 失败：两声降调（咚-咚）
                    var osc3 = ctx.createOscillator();
                    var gain3 = ctx.createGain();
                    osc3.type = 'sine';
                    osc3.frequency.setValueAtTime(440, now);
                    osc3.frequency.exponentialRampToValueAtTime(330, now + 0.15);
                    gain3.gain.setValueAtTime(0, now);
                    gain3.gain.linearRampToValueAtTime(0.35, now + 0.02);
                    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                    osc3.connect(gain3).connect(ctx.destination);
                    osc3.start(now);
                    osc3.stop(now + 0.3);

                    var osc4 = ctx.createOscillator();
                    var gain4 = ctx.createGain();
                    osc4.type = 'sine';
                    osc4.frequency.setValueAtTime(330, now + 0.18);
                    osc4.frequency.exponentialRampToValueAtTime(220, now + 0.4);
                    gain4.gain.setValueAtTime(0, now + 0.18);
                    gain4.gain.linearRampToValueAtTime(0.35, now + 0.2);
                    gain4.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
                    osc4.connect(gain4).connect(ctx.destination);
                    osc4.start(now + 0.18);
                    osc4.stop(now + 0.55);
                }

                // 延迟关闭 AudioContext
                setTimeout(function() { try { ctx.close(); } catch(e) {} }, 1000);
            } catch(e) {
                console.warn('[ZF3D] 声音播放失败:', e.message);
            }
        },

        // ===== 自动邮件通知（已禁用 - 用户不需要邮件通知） =====
        _lastEmailTime: 0,
        _sendEmailNotify: function(taskMessage, modelName, chatId) {
            // 已禁用：用户不需要邮件通知
            return;
        },

});

// ===== 任务完成系统通知：首次用户点击时自动申请通知权限（浏览器要求必须由手势触发） =====
(function () {
    function requestNotifyPermission() {
        try {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        } catch (e) {}
        document.removeEventListener('click', requestNotifyPermission, true);
    }
    document.addEventListener('click', requestNotifyPermission, true);
})();

