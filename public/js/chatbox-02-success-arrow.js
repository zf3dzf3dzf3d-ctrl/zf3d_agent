// ==== "查看成功"按钮（右下角导航区上方） ====
// 只要有未查看的成功任务（✅ 任务成功 或 ✅✅ 二次验证成功），
// 导航上方显示「查看成功 N」按钮，N 为未查看成功数；
// 点击后摄像机跳转并居中显示该对话，标记为已查看，N 递减、跳到下一个；
// 全部查看完成后按钮消失；新的成功任务出现时按钮重新出现并更新数字。
Object.assign(App, {
        // ===== 更新右下角"查看成功"按钮 =====
        _updateSuccessArrows: function(box, chat) {
            this._updateReviewButton();
        },

        // 收集所有未查看的成功对话（任务成功 / 二次验证成功都算）
        _getUnreviewedSuccesses: function() {
            var list = [];
            (this.chatBoxes || []).forEach(function(c) {
                if (!c || !c.el || !c.el.isConnected) return;
                var isSuccess = c._taskStatus === 'success' ||
                    c.el.classList.contains('task-success') ||
                    c.el.classList.contains('task-verify-success');
                if (isSuccess && !c._successArrowCentered) list.push(c);
            });
            return list;
        },

        _updateReviewButton: function() {
            var targets = this._getUnreviewedSuccesses();

            var minimap = document.getElementById('minimap');
            if (!minimap) return;
            var btn = document.getElementById('reviewNextBtn');
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'reviewNextBtn';
                btn.className = 'minimap-review-btn';
                btn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var self = window.App;
                    var list = self._getUnreviewedSuccesses();
                    if (!list.length) { btn.classList.remove('show'); return; }
                    // 取第一个未查看的成功对话，跳转并居中
                    var t = list[0];
                    // 标记已查看，下次点击跳到下一个
                    t._successArrowCentered = true;
                    // 关闭右下角该对话的「任务成功」通知弹窗（跟随大按钮联动）
                    try {
                        document.querySelectorAll('.task-notify[data-chat-id="' + t.id + '"]').forEach(function(n) {
                            n.classList.add('notify-out');
                            setTimeout(function() { if (n.parentNode) n.remove(); }, 400);
                        });
                    } catch (_e) {}
                    if (self._focusChatBox) self._focusChatBox(t);
                    // 更新剩余数量；全部看完则按钮消失
                    var remain = self._getUnreviewedSuccesses().length;
                    if (remain > 0) {
                        btn.innerHTML = '<span class="rv-icon">✓</span> 查看成功 ' + remain;
                        btn.title = '还有 ' + remain + ' 个成功任务未查看，点击查看下一个';
                    } else {
                        btn.classList.remove('show');
                    }
                    if (self._updateAllNavArrows) self._updateAllNavArrows();
                });
                // 挂到 body：小地图有 backdrop-filter，会把内部 fixed 元素的定位基准变成小地图自己，
                // 导致按钮贴在右下角而不是全屏正中下方。挂 body 后 left:50%/bottom:28px 才是真正的屏幕居中。
                document.body.appendChild(btn);
            }
            if (targets.length) {
                btn.innerHTML = '<span class="rv-icon">✓</span> 查看成功 ' + targets.length;
                btn.title = '共 ' + targets.length + ' 个成功任务未查看，点击查看下一个';
                btn.classList.add('show');
            } else {
                btn.classList.remove('show');
            }
        },
});
