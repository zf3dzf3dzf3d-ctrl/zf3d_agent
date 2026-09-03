// ==== 拆分自 app-chatbox.js：设置消息内容（AI 用 Markdown + 代码高亮 + 复制按钮 + 选项按钮，其他用纯文本）_工具：查找本条用_刷新「查看答案」_标题 hover_新增 AI 回复_滚动到上一条/下_更新导航按钮 d_开始编辑用户消息 ====
Object.assign(App, {
        // ===== 设置消息内容（AI 用 Markdown + 代码高亮 + 复制按钮 + 选项按钮，其他用纯文本） =====
        setMsgContent: function(div, text, who) {
            if (who === 'ai' || who === 'ai-final') {
                div.innerHTML = this.renderMarkdown(text);
                div.classList.add('md-body');
                this.enhanceCodeBlocks(div);
                this.renderClickableOptions(div);
                div.dataset.originalText = text;
                var aiCopyBtn = document.createElement('button');
                aiCopyBtn.className = 'msg-copy-btn msg-ai-copy-btn';
                aiCopyBtn.title = '复制答案';
                aiCopyBtn.setAttribute('aria-label', '复制答案');
                aiCopyBtn.innerHTML = '📋';
                aiCopyBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var copyText = div.dataset.originalText || text || '';
                    var copied = function() {
                        aiCopyBtn.innerHTML = '✓';
                        aiCopyBtn.classList.add('copied');
                        setTimeout(function() { aiCopyBtn.innerHTML = '📋'; aiCopyBtn.classList.remove('copied'); }, 1500);
                    };
                    var fallback = function() {
                        var ta = document.createElement('textarea'); ta.value = copyText;
                        ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
                        ta.select(); try { document.execCommand('copy'); copied(); } catch (err) {}
                        document.body.removeChild(ta);
                    };
                    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(copyText).then(copied, fallback);
                    else fallback();
                });
                div.appendChild(aiCopyBtn);
            } else if (who === 'user') {
                // 用户消息：文本 + 复制按钮 + 编辑按钮（hover 时显示）
                div.dataset.originalText = text;
                div.dataset.msgTs = new Date().toTimeString().slice(0, 5); // 提问时间 HH:MM，供标题面板用
                div.innerHTML = '';
                var textSpan = document.createElement('span');
                textSpan.className = 'msg-user-text';
                textSpan.textContent = text;
                div.appendChild(textSpan);
                var copyBtn = document.createElement('button');
                copyBtn.className = 'msg-copy-btn';
                copyBtn.title = '复制消息';
                copyBtn.innerHTML = '📋';
                copyBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var copyText = div.dataset.originalText || textSpan.textContent || '';
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(copyText).then(function() {
                            copyBtn.innerHTML = '✓';
                            copyBtn.classList.add('copied');
                            setTimeout(function() {
                                copyBtn.innerHTML = '📋';
                                copyBtn.classList.remove('copied');
                            }, 1500);
                        });
                    } else {
                        var ta = document.createElement('textarea');
                        ta.value = copyText;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        copyBtn.innerHTML = '✓';
                        copyBtn.classList.add('copied');
                        setTimeout(function() {
                            copyBtn.innerHTML = '📋';
                            copyBtn.classList.remove('copied');
                        }, 1500);
                    }
                });
                div.appendChild(copyBtn);
                var editBtn = document.createElement('button');
                editBtn.className = 'msg-edit-btn';
                editBtn.title = '编辑消息';
                editBtn.innerHTML = '✏️';
                var self = this;
                editBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.startEditUserMessage(div);
                });
                                div.appendChild(editBtn);

                // 删除按钮 - 回退到这一步（删除本条及之后所有消息/工具结果）
                var delBtn = document.createElement('button');
                delBtn.className = 'msg-del-btn';
                delBtn.title = '删除此消息及之后所有内容（回退）';
                delBtn.innerHTML = '🗑️';
                delBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.deleteUserMessageFrom(div);
                });
                div.appendChild(delBtn);
                // 上下导航按钮 - hover 时显示
                var self2 = this;
                var prevBtn = document.createElement('button');
                prevBtn.className = 'msg-nav-prev';
                prevBtn.title = '上一条用户消息';
                prevBtn.innerHTML = '⬆';
                prevBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self2.scrollToUserMsg(div, -1);
                });
                div.appendChild(prevBtn);

                var nextBtn = document.createElement('button');
                nextBtn.className = 'msg-nav-next';
                nextBtn.title = '下一条用户消息';
                nextBtn.innerHTML = '⬇';
                nextBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self2.scrollToUserMsg(div, 1);
                });
                div.appendChild(nextBtn);

                // 初始化导航按钮 disabled 状态
                self2.updateNavBtnState(div);

                // 查看答案按钮 - 精确定位本条用户问题自己对应的 final 答案
                var vaBtn = document.createElement('button');
                vaBtn.className = 'view-answer-btn visible';
                vaBtn.innerHTML = '📄 查看答案';
                vaBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var body = div.closest('.chatbox-body');
                    if (!body) return;
                    var finalEl = self._findFinalAnswer(div);
                    if (finalEl) {
                        // 往上多留 90px，确保能看到答案开头
                        var targetTop = finalEl.offsetTop - 90;
                        if (targetTop < 0) targetTop = 0;
                        body.scrollTo({ top: targetTop, behavior: 'smooth' });
                    } else {
                        // 兜底：答案尚未生成
                        var oldHtml = vaBtn.innerHTML;
                        vaBtn.innerHTML = '⏳ 未出答案';
                        vaBtn.disabled = true;
                        setTimeout(function() {
                            vaBtn.innerHTML = oldHtml;
                            vaBtn.disabled = false;
                        }, 1500);
                    }
                });
                div._vaBtn = vaBtn;
                div.appendChild(vaBtn);
                self._refreshViewAnswerBtn(div);
            } else {
                div.textContent = text;
            }
        },

        // ===== 工具：查找本条用户问题自己对应的 final 答案 =====
        _findFinalAnswer: function(userDiv) {
            var node = userDiv.nextElementSibling;
            while (node) {
                if (node.classList && node.classList.contains('msg') &&
                    (node.classList.contains('ai-final') || node.classList.contains('query-reminder'))) {
                    if (node.classList.contains('query-reminder')) return null;
                    return node;
                }
                node = node.nextElementSibling;
            }
            return null;
        },

        // ===== 刷新「查看答案」按钮显示状态：已出答案才显示 =====
        _refreshViewAnswerBtn: function(div) {
            var self = this;
            var btn = div._vaBtn;
            if (!btn) return;
            var hasAns = !!self._findFinalAnswer(div);
            if (hasAns) {
                btn.classList.add('visible');
                btn.disabled = false;
            } else {
                btn.classList.remove('visible');
                btn.disabled = true;
            }
        },

        // ===== 判断某条提问的任务状态：success / fail / replied / pending =====
        _getMsgTaskStatus: function(um, body) {
            // 从该提问向后扫到下一条提问之间，找 AI final 回复判断
            var node = um.nextElementSibling;
            var finalText = null, hasError = false;
            while (node) {
                if (node.classList && node.classList.contains('msg')) {
                    if (node.classList.contains('user')) break; // 下一条提问，结束
                    if ((node.classList.contains('ai') || node.classList.contains('ai-final'))) {
                        if (node.classList.contains('error') || node.dataset.error === '1') hasError = true;
                        var t = node.textContent || '';
                        if (t.trim()) finalText = t;
                    }
                }
                node = node.nextElementSibling;
            }
            if (hasError) return 'fail';
            if (finalText) {
                var head = finalText.replace(/^\s*[#*\s]*/, '').slice(0, 30);
                if (/^(✅|任务完成|任务成功)/.test(head)) return 'success';
                if (/^(❌|任务失败|运行失败)/.test(head)) return 'fail';
                return 'replied';
            }
            return 'pending';
        },

        // ===== 标题 hover/点击 面板：展示本对话所有用户提问，点击跳转 =====
        _showQuestionsPanel: function(box, titleEl, pinned) {
            var self = this;
            // 拖拽中不弹出面板
            if (self._boxDragging) return;
            self._hideQuestionsPanel(null);
            var body = box.querySelector('.chatbox-body');
            if (!body) return;
            var users = body.querySelectorAll('.msg.user');
            if (!users.length) return;
            var panel = document.createElement('div');
            panel.className = 'cbq-panel' + (pinned ? ' cbq-pinned' : '');
            // 兜底：应用主题为暗色时同步暗色样式（正常由 CSS html[data-theme="dark"] 生效）
            try {
                if (window.Theme && window.Theme.current === 'dark') panel.classList.add('cbq-dark');
                else if (document.documentElement.getAttribute('data-theme') === 'dark') panel.classList.add('cbq-dark');
            } catch (e) {}
            panel.__pinned = !!pinned;
            var head = document.createElement('div');
            head.className = 'cbq-head';
            var headTitle = document.createElement('span');
            headTitle.textContent = '全部提问（' + users.length + '条）';
            // 统计完成率：✅成功 ❌失败 💬已回复 ⏳无结果
            var stats = { success: 0, fail: 0, replied: 0, pending: 0 };
            var STATUS_META = {
                success: { icon: '✅', label: '任务成功' },
                fail:    { icon: '❌', label: '任务失败' },
                replied: { icon: '💬', label: '已回复（非任务结果）' },
                pending: { icon: '⏳', label: '暂无结果' }
            };
            for (var s = 0; s < users.length; s++) stats[self._getMsgTaskStatus(users[s], body)]++;
            headTitle.title = '✅成功 ' + stats.success + '　❌失败 ' + stats.fail + '　💬已回复 ' + stats.replied + '　⏳无结果 ' + stats.pending;
            headTitle.textContent = '全部提问（' + users.length + '条 · ✅' + stats.success + ' ❌' + stats.fail +
                ' 💬' + stats.replied + ' ⏳' + stats.pending + '）';
            var closeBtn = document.createElement('button');
            closeBtn.className = 'cbq-close';
            closeBtn.textContent = '×';
            closeBtn.title = '收起';
            closeBtn.addEventListener('click', function(e) { e.stopPropagation(); self._hideQuestionsPanel(); });
            head.appendChild(headTitle);
            head.appendChild(closeBtn);
            panel.appendChild(head);
            for (var i = 0; i < users.length; i++) {
                (function(idx, um) {
                    var textNode = um.querySelector('.msg-user-text') || um;
                    var txt = (um.dataset.originalText || textNode.textContent || '').replace(/\s+/g, ' ').trim();
                    var item = document.createElement('div');
                    item.className = 'cbq-item';
                    var num = document.createElement('span');
                    num.className = 'cbq-num';
                    num.textContent = (idx + 1);
                    var txtEl = document.createElement('span');
                    txtEl.className = 'cbq-text';
                    // 标题面板正文：同样剥离上下文前缀，短截断
                    var clean = txt.replace(/【当前项目上下文】[\s\S]*?(?=【用户划选的文本】|$)/g, '')
                                   .replace(/【用户划选的文本】[\s\S]*?(?=[^【\n]|\n[^【]|$)/g, '')
                                   .replace(/\n{2,}/g, '\n').trim() || txt;
                    clean = clean.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                    txtEl.textContent = clean.length > 46 ? clean.slice(0, 46) + '…' : clean;
                    txtEl.title = txt;
                    // 任务状态图标
                    var st = self._getMsgTaskStatus(um, body);
                    var meta = STATUS_META[st] || STATUS_META.pending;
                    var stEl = document.createElement('span');
                    stEl.className = 'cbq-status st-' + st;
                    stEl.textContent = meta.icon;
                    stEl.title = meta.label;
                    item.appendChild(stEl);
                    // 提问时间（时:分）
                    if (um.dataset.msgTs) {
                        var timeEl = document.createElement('span');
                        timeEl.className = 'cbq-time';
                        timeEl.textContent = um.dataset.msgTs;
                        item.appendChild(timeEl);
                    }
                    var va = document.createElement('button');
                    va.className = 'cbq-va-btn';
                    va.textContent = '查看答案';
                    item.addEventListener('click', function(e) {
                        if (e.target === va) return;
                        self._scrollToMsg(body, um);
                        self._hideQuestionsPanel(null);
                    });
                    va.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var target = (um._vaBtn && um._vaBtn.__answerEl) ? um._vaBtn.__answerEl : self._findNextFinalAnswer(um);
                        // 「查看答案」多往上偏移 90px，确保答案开头可见
                        self._scrollToMsg(body, target || um, 90);
                        self._hideQuestionsPanel(null);
                    });
                    item.appendChild(num);
                    item.appendChild(txtEl);
                    item.appendChild(va);
                    panel.appendChild(item);
                })(i, users[i]);
            }
            document.body.appendChild(panel);
            var rect = titleEl.getBoundingClientRect();
            var pw = panel.offsetWidth, ph = panel.offsetHeight;
            var left = Math.min(Math.max(8, rect.left), window.innerWidth - pw - 8);
            var top = rect.bottom + 6;
            if (top + ph > window.innerHeight - 8) {
                top = Math.max(8, window.innerHeight - 8 - ph);
            }
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            this._cbqPanel = panel;
            panel.__titleEl = titleEl;
            var _p = panel;
            if (pinned) {
                // 固定面板：点击空白处关闭
                var onDocClick = function(e) {
                    if (_p.contains(e.target)) return;
                    if (titleEl.contains(e.target)) return;
                    self._hideQuestionsPanel();
                };
                setTimeout(function() { document.addEventListener('click', onDocClick, true); }, 0);
                panel.__docClickHandler = onDocClick;
            } else {
                panel.addEventListener('mouseenter', function() { self._cancelHidePanel(); });
                panel.addEventListener('mouseleave', function() {
                    if (self._cbqPanel === _p) self._scheduleHidePanel();
                });
            }
        },

        _findNextFinalAnswer: function(userMsg) {
            if (!userMsg || !userMsg.parentNode) return null;
            var el = userMsg.nextElementSibling;
            while (el) {
                if (el.classList.contains('ai-final')) return el;
                el = el.nextElementSibling;
            }
            return null;
        },

        _scrollToMsg: function(body, msgEl, extraOffset) {
            if (!msgEl || !body) return;
            var extra = extraOffset || 0; // 「查看答案」时传 90，往上多留一段
            if (body.scrollTo) {
                body.scrollTo({ top: msgEl.offsetTop - 40 - extra, behavior: 'smooth' });
            } else {
                body.scrollTop = msgEl.offsetTop - 40 - extra;
            }
            msgEl.classList.remove('msg-nav-highlight');
            void msgEl.offsetWidth;
            msgEl.classList.add('msg-nav-highlight');
            setTimeout(function() { msgEl.classList.remove('msg-nav-highlight'); }, 2200);
        },

        _hideQuestionsPanel: function() {
            this._cancelHidePanel();
            var p = document.querySelector('.cbq-panel');
            if (p) {
                if (p.__docClickHandler) {
                    document.removeEventListener('click', p.__docClickHandler, true);
                }
                p.remove();
            }
            this._cbqPanel = null;
        },

        _setQuestionsPanelDragging: function(dragging) {
            var panel = document.querySelector('.cbq-panel');
            if (!panel) return;
            if (dragging) {
                // 拖拽中：隐藏面板
                panel.style.visibility = 'hidden';
                panel.classList.remove('cbq-drag-hidden');
                panel.__dragHidden = true;
                return;
            }
            // 拖拽结束：
            // 1) 悬停面板（非固定）：直接收起，鼠标搭上标题才会重新弹出
            if (!panel.__pinned) {
                this._hideQuestionsPanel();
                return;
            }
            // 2) 固定面板：保持隐藏并重新定位跟随标题，鼠标搭上标题才恢复显示
            panel.classList.add('cbq-drag-hidden');
            panel.__dragHidden = true;
            if (panel.__titleEl) {
                var rect = panel.__titleEl.getBoundingClientRect();
                var pw = panel.offsetWidth, ph = panel.offsetHeight;
                var left = Math.min(Math.max(8, rect.left), window.innerWidth - pw - 8);
                var top = rect.bottom + 6;
                if (top + ph > window.innerHeight - 8) {
                    top = Math.max(8, window.innerHeight - 8 - ph);
                }
                panel.style.left = left + 'px';
                panel.style.top = top + 'px';
            }
        },

        _scheduleHidePanel: function() {
            var self = this;
            this._cancelHidePanel();
            this._cbqHideTimer = setTimeout(function() { self._hideQuestionsPanel(); }, 300);
        },

        _cancelHidePanel: function() {
            if (this._cbqHideTimer) { clearTimeout(this._cbqHideTimer); this._cbqHideTimer = null; }
        },

        // ===== 新增 AI 回复时刷新本用户消息的按钮状态 =====
        _refreshUserMsgBtns: function(container) {
            var self = this;
            var users = container.querySelectorAll('.msg.user');
            for (var i = 0; i < users.length; i++) {
                if (users[i]._vaBtn) self._refreshViewAnswerBtn(users[i]);
            }
        },
        // ===== 滚动到上一条/下一条用户消息 =====
        scrollToUserMsg: function(currentMsg, dir) {
            var self = this;
            var body = currentMsg.closest('.chatbox-body');
            if (!body) return;
            var userMsgs = Array.prototype.slice.call(body.querySelectorAll('.msg.user:not(.msg-editing)'));
            var idx = userMsgs.indexOf(currentMsg);
            if (idx === -1) {
                userMsgs = Array.prototype.slice.call(body.querySelectorAll('.msg.user'));
                idx = userMsgs.indexOf(currentMsg);
                if (idx === -1) return;
            }
            var targetIdx = idx + dir;
            if (targetIdx < 0 || targetIdx >= userMsgs.length) return;
            var target = userMsgs[targetIdx];
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            self.updateNavBtnState(target);
            target.classList.add('msg-nav-highlight');
            setTimeout(function() {
                target.classList.remove('msg-nav-highlight');
            }, 1200);
        },

        // ===== 更新导航按钮 disabled 状态 =====
        updateNavBtnState: function(msgDiv) {
            var body = msgDiv.closest(".chatbox-body");
            if (!body) return;
            var userMsgs = Array.prototype.slice.call(body.querySelectorAll(".msg.user:not(.msg-editing)"));
            var idx = userMsgs.indexOf(msgDiv);
            if (idx === -1) {
                userMsgs = Array.prototype.slice.call(body.querySelectorAll(".msg.user"));
                idx = userMsgs.indexOf(msgDiv);
                if (idx === -1) return;
            }
            var prevBtn = msgDiv.querySelector(".msg-nav-prev");
            var nextBtn = msgDiv.querySelector(".msg-nav-next");
            if (prevBtn) prevBtn.disabled = (idx <= 0);
            if (nextBtn) nextBtn.disabled = (idx >= userMsgs.length - 1);
        },

        // ===== 开始编辑用户消息 =====
        startEditUserMessage: function(msgDiv) {
            var self = this;
            var originalText = msgDiv.dataset.originalText || msgDiv.textContent || '';
            if (msgDiv.classList.contains('msg-editing')) return;
            msgDiv.classList.add('msg-editing');
            msgDiv.dataset.savedHtml = msgDiv.innerHTML;
            msgDiv.innerHTML = '';
            var textarea = document.createElement('textarea');
            textarea.className = 'msg-edit-textarea';
            textarea.value = originalText;
            msgDiv.appendChild(textarea);
            var btnRow = document.createElement('div');
            btnRow.className = 'msg-edit-btnrow';
            var saveBtn = document.createElement('button');
            saveBtn.className = 'msg-edit-save';
            saveBtn.textContent = '发送';
            saveBtn.title = '保存并重新发送';
            var cancelBtn = document.createElement('button');
            cancelBtn.className = 'msg-edit-cancel';
            cancelBtn.textContent = '取消';
            cancelBtn.title = '取消编辑';
            btnRow.appendChild(saveBtn);
            btnRow.appendChild(cancelBtn);
            msgDiv.appendChild(btnRow);
            textarea.focus();
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
            textarea.addEventListener('input', function() {
                textarea.style.height = 'auto';
                textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
            });
            textarea.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveBtn.click();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelBtn.click();
                }
            });
            saveBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var newText = textarea.value.trim();
                if (!newText) return;
                self.saveEditedUserMessage(msgDiv, newText);
            });
            cancelBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                self.cancelEditUserMessage(msgDiv);
            });
        },

        // ===== 全局图片查看层：点击缩略图弹出原图大图 =====
        _openImageLightbox: function(src) {
            var old = document.getElementById('app-image-lightbox');
            if (old) old.remove();
            var overlay = document.createElement('div');
            overlay.id = 'app-image-lightbox';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
            var img = document.createElement('img');
            img.src = src;
            img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6);';
            overlay.appendChild(img);
            overlay.addEventListener('click', function() { overlay.remove(); });
            document.addEventListener('keydown', function _esc(e) {
                if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _esc); }
            });
            document.body.appendChild(overlay);
        },
});
