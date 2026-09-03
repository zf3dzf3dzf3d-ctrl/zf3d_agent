// ==== 拆分自 app-chatbox.js：保存编辑后的用户消息：截断历史 + 删除后续消息 + 重新发送_取消编辑用户消息_HTML 转义辅_根据用户第一条提_显示复制提示 t_显示复制成功状态_代码块增强：语法_自动检测AI回复_添加消息_用户问题置顶条_会话结束时：先展 ====
Object.assign(App, {
        // ===== 保存编辑后的用户消息：截断历史 + 删除后续消息 + 重新发送 =====
        saveEditedUserMessage: function(msgDiv, newText) {
            var self = this;
            var box = msgDiv.closest('.chatbox');
            if (!box) return;
            var chat = this.chatBoxes.find(function(c) { return c.el === box; });
            if (!chat) return;

            // 如果正在发送中，不允许编辑
            if (chat.isSending) {
                self.addMsg(box, '⏳ 当前正在对话中，请等待完成后再编辑消息。', 'ai');
                self.cancelEditUserMessage(msgDiv);
                return;
            }

            var body = box.querySelector('.chatbox-body');
            if (!body) return;
            var allMsgs = body.querySelectorAll('.msg');
            var msgList = Array.from(allMsgs);
            var editIndex = msgList.indexOf(msgDiv);
            if (editIndex === -1) return;

            // 收集编辑位置之前的所有 user/ai 消息的原始文本
            var keptHistory = [];
            for (var i = 0; i < editIndex; i++) {
                var m = msgList[i];
                if (m.classList.contains('user')) {
                    var uText = m.dataset.originalText || m.textContent || '';
                    keptHistory.push({ role: 'user', content: uText });
                } else if (m.classList.contains('ai') && !m.classList.contains('typing') && !m.classList.contains('query-reminder')) {
                    // AI 消息：从 chat.history 中找到对应的消息
                    var aiCount = keptHistory.filter(function(h) { return h.role === 'assistant'; }).length;
                    var aiMsgs = chat.history.filter(function(h) { return h.role === 'assistant'; });
                    if (aiCount < aiMsgs.length) {
                        keptHistory.push({ role: 'assistant', content: aiMsgs[aiCount].content });
                    } else {
                        keptHistory.push({ role: 'assistant', content: m.textContent || '' });
                    }
                }
            }
            // 添加新的用户消息
            keptHistory.push({ role: 'user', content: newText });

            // 删除该消息之后的所有消息
            for (var j = msgList.length - 1; j > editIndex; j--) {
                msgList[j].remove();
            }

            // 更新当前消息为新文本
            msgDiv.classList.remove('msg-editing');
            self.setMsgContent(msgDiv, newText, 'user');

            // 更新 chat.history
            chat.history = keptHistory;

            // 更新 query-pin 和标题
            self.showQueryPin(box, newText);
            self.updateChatTitle(box, newText);

            // 重建 Store 消息（串行 await 确保 parent_id 追踪正确）
            Store.clearMessages(chat.id);
            (async function() {
                for (var h = 0; h < chat.history.length; h++) {
                    var role = chat.history[h].role === 'user' ? 'user' : 'assistant';
                    await Store.addMessage(chat.id, role, chat.history[h].content, 'text', chat.modelId);
                }
                Store.addLog('info', chat.id, 'edit-resend', '用户编辑消息并重新发送: ' + newText.substring(0, 80));
                // 重新发送给模型
                self.sendToModel(box, chat);
            })();
        },

        // ===== 取消编辑用户消息 =====
        cancelEditUserMessage: function(msgDiv) {
            msgDiv.classList.remove('msg-editing');
            if (msgDiv.dataset.savedHtml) {
                msgDiv.innerHTML = msgDiv.dataset.savedHtml;
                delete msgDiv.dataset.savedHtml;
                var editBtn = msgDiv.querySelector('.msg-edit-btn');
                if (editBtn) {
                    var self = this;
                    editBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        self.startEditUserMessage(msgDiv);
                    });
                }
            } else {
                var originalText = msgDiv.dataset.originalText || '';
                this.setMsgContent(msgDiv, originalText, 'user');
            }
        },

        // ===== 删除用户消息：回退到这一步（删除本条及之后所有消息/工具结果） =====
        deleteUserMessageFrom: function(msgDiv) {
            var self = this;
            var box = msgDiv.closest('.chatbox');
            if (!box) return;
            var chat = this.chatBoxes.find(function(c) { return c.el === box; });
            if (!chat) return;

            if (chat.isSending) {
                self.addMsg(box, '⏳ 当前正在对话中，请等待完成后再删除消息。', 'ai');
                return;
            }

            // 二次确认
            if (!confirm('确定删除这条消息及其之后的所有内容（包括 AI 回复和工具结果）吗？此操作不可恢复。')) return;

            var body = box.querySelector('.chatbox-body');
            if (!body) return;
            var msgList = Array.from(body.querySelectorAll('.msg'));
            var delIndex = msgList.indexOf(msgDiv);
            if (delIndex === -1) return;

            // 收集该消息之前的 user/ai 历史（与编辑回退逻辑一致）
            var keptHistory = [];
            for (var i = 0; i < delIndex; i++) {
                var m = msgList[i];
                if (m.classList.contains('user')) {
                    keptHistory.push({ role: 'user', content: m.dataset.originalText || m.textContent || '' });
                } else if (m.classList.contains('ai') && !m.classList.contains('typing') && !m.classList.contains('query-reminder')) {
                    var aiCount = keptHistory.filter(function(h) { return h.role === 'assistant'; }).length;
                    var aiMsgs = chat.history.filter(function(h) { return h.role === 'assistant'; });
                    if (aiCount < aiMsgs.length) {
                        keptHistory.push({ role: 'assistant', content: aiMsgs[aiCount].content });
                    } else {
                        keptHistory.push({ role: 'assistant', content: m.textContent || '' });
                    }
                }
            }

            // 删除该消息及其之后的所有 DOM（包括工具结果卡片等）
            for (var j = msgList.length - 1; j >= delIndex; j--) {
                msgList[j].remove();
            }

            // 清空工具面板中的所有工具卡片（工具面板属于整个对话，回退后一并清除）
            var tp = box.querySelector('.chatbox-toolpanel-body');
            if (tp) tp.innerHTML = '';
            var badge = box.querySelector('.tool-badge');
            if (badge) {
                badge.textContent = '0';
                badge.style.display = 'none';
            }

            // 更新 chat.history
            chat.history = keptHistory;

            // 更新 query-pin 和标题（若删光了则显示占位）
            var firstQ = keptHistory.filter(function(h) { return h.role === 'user'; })[0];
            if (firstQ) {
                self.showQueryPin(box, firstQ.content);
            } else {
                var pin = box.querySelector('.query-pin');
                if (pin) pin.remove();
            }

            // 重建 Store 消息（串行 await 确保 parent_id 追踪正确）
            Store.clearMessages(chat.id);
            (async function() {
                for (var h = 0; h < chat.history.length; h++) {
                    var role = chat.history[h].role === 'user' ? 'user' : 'assistant';
                    await Store.addMessage(chat.id, role, chat.history[h].content, 'text', chat.modelId);
                }
                Store.addLog('info', chat.id, 'delete-msg', '用户删除消息并回退对话: 已删除第 ' + (delIndex + 1) + ' 条之后的所有内容');
                self.updateNavBtnState && self.updateNavBtnState(box);
            })();
        },

        // ===== HTML 转义辅助 =====
        _escapeHtml: function(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        },

        // ===== 根据用户第一条提问更新对话标题（标题固定显示第一句）=====
        updateChatTitle: function(box, text) {
            var titleEl = box.querySelector('.chatbox-header .title') || box.querySelector('.chatbox-header-row1 .title');
            if (!titleEl) return;
            // 标题只取第一条用户提问的「正文」：剥离【当前项目上下文】/【用户划选的文本】等注入前缀
            var firstQ = '';
            var body = box.querySelector('.chatbox-body');
            if (body) {
                var firstUser = body.querySelector('.msg.user');
                if (firstUser) {
                    var tn = firstUser.querySelector('.msg-user-text') || firstUser;
                    firstQ = (firstUser.dataset.originalText || tn.textContent || '');
                }
            }
            var src = firstQ || text || '';
            if (src) {
                src = src.replace(/【当前项目上下文】[\s\S]*?(?=【用户划选的文本】|$)/g, '')
                         .replace(/【用户划选的文本】[\s\S]*?(?=[^【\n]|\n[^【]|$)/g, '');
                src = src.replace(/\n{2,}/g, '\n').trim();
            }
            // 清理换行、多余空白
            var preview = src.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            // 截断到 30 字符
            if (preview.length > 30) preview = preview.substring(0, 30) + '…';
            titleEl.textContent = preview;
            titleEl.title = src;  // 鼠标悬停看全文
            // 保存到内存 + SQLite
            var chat = this.chatBoxes.find(function(c) { return c.el === box; });
            if (chat) {
                Store.saveChatBox(chat);
            }
        },

        // ===== 显示复制提示 toast =====
        _copyToast: null,
        _showCopyToast: function(text) {
            var toast = document.createElement('div');
            toast.textContent = '✓ ' + (text || '已复制');
            // 适配深色/浅色主题
            var isLight = document.documentElement.getAttribute('data-theme') === 'light';
            if (isLight) {
                toast.style.cssText =
                    'background:#fff;color:var(--blue);border:1px solid var(--border,#ddd);' +
                    'border-radius:6px;padding:8px 18px;font-size:13px;' +
                    'box-shadow:0 4px 16px rgba(0,0,0,0.15);';
            } else {
                toast.style.cssText =
                    'background:#1a1a2e;color:#4EC9B0;border:1px solid #2a2a44;' +
                    'border-radius:6px;padding:8px 18px;font-size:13px;' +
                    'box-shadow:0 4px 12px rgba(0,0,0,.3);';
            }
            // 使用全局 ToastStack（左下角堆叠排列）
            if (window.ToastStack) {
                window.ToastStack.show(toast, 1500);
            } else {
                toast.className = 'copy-toast';
                document.body.appendChild(toast);
                toast.classList.add('copy-toast-in');
                setTimeout(function() {
                    toast.classList.remove('copy-toast-in');
                    toast.classList.add('copy-toast-out');
                }, 1500);
            }
        },

        // ===== 显示复制成功状态（按钮上 ✓ 反馈） =====
        _showCopySuccess: function(btn, ms) {
            if (!btn) return;
            ms = ms || 1500;
            if (!btn._origLabel) btn._origLabel = btn.textContent;
            if (btn._restoreTimer) clearTimeout(btn._restoreTimer);
            btn.textContent = '✓';
            btn._restoreTimer = setTimeout(function() {
                btn.textContent = btn._origLabel || '📦';
                delete btn._restoreTimer;
            }, ms);
        },

        // ===== 代码块增强：语法高亮 + Mermaid 流程图 + 复制按钮 =====
        enhanceCodeBlocks: function(container) {
            if (!container) return;
            var self = this;

            // Mermaid 流程图渲染（按需加载：首次遇到 mermaid 代码块才拉 3.5MB 库）
            var mermaidBlocks = container.querySelectorAll('pre code.language-mermaid');
            if (mermaidBlocks.length > 0) {
                LazyLoader.load('mermaid', function (err) {
                    if (err || typeof mermaid === 'undefined') { console.warn('Mermaid 未加载:', err); return; }
                    var toRender = [];
                    mermaidBlocks.forEach(function(block) {
                        var code = block.textContent;
                        var pre = block.parentElement;
                        var div = document.createElement('div');
                        div.className = 'mermaid';
                        div.textContent = code;
                        pre.replaceWith(div);
                        toRender.push(div);
                    });
                    try {
                        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
                        mermaid.run({ nodes: toRender }).catch(function(e) {
                            console.warn('Mermaid 渲染失败:', e);
                        });
                    } catch(e) { console.warn('Mermaid init error:', e); }
                });
            }

            // 像素显示器：拦截 pxl 代码块，渲染为 Canvas 图片
            if (typeof PixelDisplay !== 'undefined') {
                try { PixelDisplay.scanAndRender(container); } catch(e) { console.warn('[PixelDisplay] error:', e); }
            }

            // 语法高亮 + 复制按钮
            container.querySelectorAll('pre code').forEach(function(block) {
                if (typeof hljs !== 'undefined' && !block.dataset.highlighted) {
                    var langClass = Array.from(block.classList || []).find(function(c) { return c.startsWith('language-'); });
                    var lang = langClass ? langClass.slice('language-'.length).trim() : '';
                    if (!lang || hljs.getLanguage(lang)) {
                        // 高亮前清理未转义的 HTML 子节点，避免 highlight.js 报安全警告
                        if (block.querySelector('*')) {
                            block.textContent = block.textContent;
                        }
                        try { hljs.highlightElement(block); block.dataset.highlighted = '1'; } catch(e) { block.dataset.highlighted = '1'; }
                    } else {
                        block.classList.add('no-highlight');
                        block.dataset.highlighted = '1';
                    }
                }
                var pre = block.parentElement;
                if (pre && !pre.querySelector('.code-copy-btn')) {
                    var btn = document.createElement('button');
                    btn.className = 'code-copy-btn';
                    btn.textContent = '📦';
                    btn.title = '复制代码';
                    btn.addEventListener('click', function() {
                        var code = block.textContent;
                        if (navigator.clipboard) {
                            navigator.clipboard.writeText(code).then(function() {
                                self._showCopySuccess(btn);
                                self._showCopyToast('已复制代码');
                            });
                        } else {
                            var ta = document.createElement('textarea');
                            ta.value = code;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            self._showCopySuccess(btn);
                            self._showCopyToast('已复制代码');
                        }
                    });
                    pre.appendChild(btn);
                }
            });
        },

        // ===== 自动检测AI回复中的选项列表，渲染为可点击按钮 =====
        renderClickableOptions: function(container) {
            if (!container) return;
            var self = this;
            var text = container.textContent || '';
            var keywords = ['请告诉我', '请选择', '您想做什么', '您的具体需求', '请确认', '您想让我', '请说明'];
            var hasAsk = keywords.some(function(w) { return text.indexOf(w) >= 0; });
            if (!hasAsk) return;
            var items = container.querySelectorAll('li');
            if (!items || items.length < 2) return;
            if (items.length > 6) return;
            var options = [];
            items.forEach(function(li) {
                var t = li.textContent.trim();
                if (t && t.length < 100) options.push(t);
            });
            if (options.length < 2) return;

            // 找到所属的 chatbox
            var box = container.closest('.chatbox');
            var chat = null;
            if (box) {
                for (var i = 0; i < self.chatBoxes.length; i++) {
                    if (self.chatBoxes[i].el === box) { chat = self.chatBoxes[i]; break; }
                }
            }

            var btnContainer = document.createElement('div');
            btnContainer.className = 'auto-option-container';
            options.forEach(function(opt) {
                var btn = document.createElement('button');
                btn.className = 'auto-option-btn';
                btn.textContent = opt;
                btn.addEventListener('click', function() {
                    if (box && chat) {
                        var input = box.querySelector('textarea');
                        var sendBtn = box.querySelector('.send-btn');
                        if (input) {
                            input.value = opt;
                            input.focus();
                            if (sendBtn) sendBtn.click();
                        }
                    }
                });
                btnContainer.appendChild(btn);
            });
            container.appendChild(btnContainer);
        },

        // ===== 添加消息 =====
        // ===== 用户问题置顶条 =====
        showQueryPin: function(box, text) {
            // 移除旧的 pin（如果有）
            var oldPin = box.querySelector('.query-pin');
            if (oldPin) oldPin.remove();
            var body = box.querySelector('.chatbox-body');
            if (!body) return;
            var pin = document.createElement('div');
            pin.className = 'query-pin';
            pin.dataset.fullText = text;
            // 截断显示（单行）
            var preview = text.length > 60 ? text.substring(0, 60) + '…' : text;
            preview = preview.replace(/\n/g, ' ');
            pin.innerHTML =
                '<span class="query-pin__icon">📌</span>' +
                '<span class="query-pin__text">' + this._escapeHtml(preview) + '</span>';
            // 插入到 body 最前面
            body.insertBefore(pin, body.firstChild);
        },

        // ===== 会话结束时：先展示全文到对话中，再移除 pin =====
        flushQueryPin: function(box, chat) {
            var pin = box.querySelector('.query-pin');
            if (!pin) return;
            var fullText = pin.dataset.fullText || '';
            // 在对话中再次展示用户问题（作为提醒）
            if (fullText) {
                var body = box.querySelector('.chatbox-body');
                if (body) {
                    var reminder = document.createElement('div');
                    reminder.className = 'msg query-reminder';
                    // 在本次提问右上角添加“查看答案”按钮
                    var vaBtn = document.createElement('button');
                    vaBtn.className = 'view-answer-btn visible';
                    vaBtn.title = '查看答案';
                    vaBtn.innerHTML = '📄 查看答案';
                    vaBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        // 找到本条 query-reminder 之前最近的 final AI 消息，滚动过去
                        var prev = reminder.previousElementSibling;
                        while (prev) {
                            if (prev.classList && prev.classList.contains('msg') && (prev.classList.contains('ai-final') || prev.classList.contains('query-reminder'))) {
                                break;
                            }
                            prev = prev.previousElementSibling;
                        }
                        if (prev) {
                            // 往上多留 90px，确保能看到答案开头
                            var targetTop = prev.offsetTop - 90;
                            if (targetTop < 0) targetTop = 0;
                            body.scrollTo({ top: targetTop, behavior: 'smooth' });
                        } else {
                            // 未找到对应 AI 回复 → 提示未出答案
                            var oldHtml2 = vaBtn.innerHTML;
                            vaBtn.innerHTML = '⏳ 未出答案';
                            vaBtn.disabled = true;
                            setTimeout(function() {
                                vaBtn.innerHTML = oldHtml2;
                                vaBtn.disabled = false;
                            }, 1500);
                        }
                    });                    reminder.innerHTML =
                        '<span style="opacity:0.6;font-size:11px;">📎 本次提问：</span><br>' +
                        this._escapeHtml(fullText);
                    reminder.appendChild(vaBtn);
                    body.appendChild(reminder);
                    if (chat.autoFollowBottom) {
                        body.scrollTop = body.scrollHeight;
                    }
                }
            }
            // 移除 pin（带淡出动画）
            pin.classList.add('query-pin--out');
            setTimeout(function() {
                if (pin.parentNode) pin.remove();
            }, 300);
        },
});
