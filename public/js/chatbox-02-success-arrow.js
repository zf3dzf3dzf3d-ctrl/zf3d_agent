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
        // 【子角色排除】策划师/审核员/施工队(赛马+协作)/总结师窗的成功不计入「查看成功」统计，
        // 中间环节成功对用户无操作价值，与右下角播报静默（showTaskNotify _subSilent）口径一致。
        _getUnreviewedSuccesses: function() {
            var list = [];
            (this.chatBoxes || []).forEach(function(c) {
                if (!c || !c.el || !c.el.isConnected) return;
                var el = c.el;
                var isSubRole = el._isThinkerChat || el._isQcChat || el._isSummarizerChat || el._raceSrcId;
                // 兜底：刷新恢复后标记可能丢失，按窗口标题识别（同 app-taskpanel.js 口径）
                if (!isSubRole) {
                    try {
                        var _ttl = (el.querySelector('.chatbox-title') || {}).textContent || el.dataset.title || '';
                        if (/(策划师|审核员|质检员|总结师|协作现场)/.test(_ttl)) isSubRole = true;
                    } catch (e) {}
                }
                if (isSubRole) return;
                var isSuccess = c._taskStatus === 'success' ||
                    el.classList.contains('task-success') ||
                    el.classList.contains('task-verify-success');
                if (isSuccess && !c._successArrowCentered) list.push(c);
            });
            return list;
        },

        // ===== 【新增】滚动到该对话最后一个答案（final / 已验证优先），效果同「查看答案」按钮 =====
        _scrollChatToLastAnswer: function(chat) {
            try {
                var body = chat && chat.el && chat.el.querySelector('.chatbox-body');
                if (!body) return;
                // 与「查看答案」按钮 100% 一致：找到最后一个带「查看答案」按钮的用户气泡，
                // 程序化触发它的 click —— 定位目标（本条问题对应的 final）、90px 偏移、
                // 等帧 reflow 全部复用按钮自身实现，多轮问答也不会找错答案。
                var lastUserBtn = null;
                var allMsgs = body.querySelectorAll('.msg');
                for (var j = allMsgs.length - 1; j >= 0; j--) {
                    if (allMsgs[j]._vaBtn) { lastUserBtn = allMsgs[j]._vaBtn; break; }
                }
                var fallback = function() {
                    // 兜底：最后一个已验证 final → 最后一个 final → 最后一条消息
                    var target = null;
                    var finals = body.querySelectorAll('.msg.ai-final');
                    if (finals.length) {
                        for (var i = finals.length - 1; i >= 0; i--) {
                            if (finals[i].classList.contains('ai-verified')) { target = finals[i]; break; }
                        }
                        if (!target) target = finals[finals.length - 1];
                    }
                    if (!target) target = body.querySelector('.msg:last-child');
                    if (!target) return;
                    requestAnimationFrame(function() {
                        try {
                            void target.offsetHeight; void body.scrollHeight;
                            var bTop = body.getBoundingClientRect().top;
                            var elTop = target.getBoundingClientRect().top - bTop + body.scrollTop;
                            var elH = target.getBoundingClientRect().height;
                            var viewH = body.clientHeight;
                            var top;
                            if (elH > viewH - 100) top = elTop + elH - viewH + 20;
                            else top = elTop - 90;
                            if (top < 0) top = 0;
                            var maxTop = body.scrollHeight - viewH;
                            if (top > maxTop) top = maxTop;
                            body.scrollTo({ top: top, behavior: 'smooth' });
                        } catch (e2) { console.warn('[App] scroll to last answer (raf) failed:', e2); }
                    });
                };
                if (lastUserBtn && !lastUserBtn.disabled) {
                    // 稍等一下（画布刚跳转/消息刚渲染时），再触发按钮自身的点击逻辑
                    setTimeout(function() {
                        try { lastUserBtn.click(); } catch (e3) { fallback(); }
                    }, 60);
                } else {
                    fallback();
                }
            } catch (e) { console.warn('[App] scroll to last answer failed:', e); }
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
                    // 顺便滚动到该对话最后的答案（同「查看答案」效果）
                    if (self._scrollChatToLastAnswer) self._scrollChatToLastAnswer(t);
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
