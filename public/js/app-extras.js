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

            // 确保容器存在
            var container = document.querySelector('.notify-container');
            if (!container) {
                container = document.createElement('div');
                container.className = 'notify-container';
                document.body.appendChild(container);
            }

            var icon = success ? '✅' : '❌';
            var title = success ? '任务成功' : '任务失败';
            if (scope && scope !== '当前任务') {
                title += ' · ' + scope;
            }
            var cls = 'task-notify ' + (success ? 'task-notify--success' : 'task-notify--fail');

            var notify = document.createElement('div');
            notify.className = cls;
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
