
/* 自研对话框 shim 已抽取至公共 zf-dialog-shim.js（S4 去重 2026-11-22），本文件不再重复注入 */

﻿// ==== 拆分自 app-chatbox.js：保存编辑后的用户消息：截断历史 + 删除后续消息 + 重新发送_取消编辑用户消息_HTML 转义辅_根据用户第一条提_显示复制提示 t_显示复制成功状态_代码块增强：语法_自动检测AI回复_添加消息_用户问题置顶条_会话结束时：先展 ====
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

            /* 【懒渲染数据破坏修复 2026-11-23】原实现从窗口内 DOM 重建 keptHistory 再整体替换
               chat.history——懒渲染只渲尾部 100 条，头部未渲染区间的历史（含 TASKMETA/任务总结）
               全部蒸发，且 Store.clearMessages 后重写，不可逆丢数据。
               修法：定位截断点后直接 slice 全量 history——头部完整保留，AI 内容不再从 DOM 反推。 */
            var keptHistory = chat.history.slice(0, this._historyCutBefore(body, chat, editIndex, msgList));
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
            if (!_dlgConfirm('确定删除这条消息及其之后的所有内容（包括 AI 回复和工具结果）吗？此操作不可恢复。')) return;

            var body = box.querySelector('.chatbox-body');
            if (!body) return;
            var msgList = Array.from(body.querySelectorAll('.msg'));
            var delIndex = msgList.indexOf(msgDiv);
            if (delIndex === -1) return;

            // 收集该消息之前的 user/ai 历史（与编辑回退逻辑一致）
            /* 【懒渲染数据破坏修复 2026-11-23】同 saveEditedUserMessage：不再从窗口内 DOM 重建
               （会丢头部未渲染区间），改为定位截断点 slice 全量 history，头部完整保留。 */
            var keptHistory = chat.history.slice(0, this._historyCutBefore(body, chat, delIndex, msgList));

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

        // ===== 【懒渲染适配】定位目标消息在全量 chat.history 中的截断点 =====
        // 目标消息（窗口内索引 windowIdx）之前的全量前缀长度 = history 中直到
        // "第 (头部未渲染user数 + 窗口内其前user数) 条 user" 之前。
        // 口径：懒渲染 _lazyHist.renderable[0..head) 是未渲染头部（与 DOM user 序列同序），
        // user 消息全渲染无过滤，计数可与 DOM 对齐；history 里的 TASKMETA/system/任务总结
        // 随 slice 完整保留（原实现会丢）。
        // 兜底铁律：任何异常都返回 history.length（全保不截）——宁可截断失败重试，不可丢数据。
        _historyCutBefore: function(body, chat, windowIdx, msgList) {
            var hist = (chat && chat.history) || [];
            try {
                var _preUsers = 0;
                var _lh = body && body._lazyHist;
                if (_lh && _lh.head > 0 && _lh.renderable) {
                    for (var pi = 0; pi < _lh.head; pi++) {
                        var pe = _lh.renderable[pi];
                        if (pe && pe.m && pe.m.role === 'user') _preUsers++;
                    }
                }
                if (msgList) {
                    for (var qi = 0; qi < windowIdx; qi++) {
                        var qm = msgList[qi];
                        if (qm && qm.classList && qm.classList.contains('user')) _preUsers++;
                    }
                }
                var seen = 0;
                for (var hi = 0; hi < hist.length; hi++) {
                    if (hist[hi] && hist[hi].role === 'user') {
                        if (seen === _preUsers) return hi;
                        seen++;
                    }
                }
                return hist.length;
            } catch (eCut) { return hist.length; }
        },

        // ===== HTML 转义辅助 =====
        /* 【XSS 整改 2026-11-23】补引号转义（&quot; &#39;）：本函数输出除了文本上下文
           （innerHTML 兜底：chatbox-03 自验收表格 title、chatbox-11/app.js 的 md 兜底等），
           还有属性上下文（chatbox-03:1850 title="..." 拼接），必须覆盖引号防属性逃逸。
           与全站唯一实现 ZFMD.escapeHtml（md-render.js）同口径。 */
        _escapeHtml: function(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        },

        // ===== 根据用户第一条提问更新对话标题（标题固定显示第一句）=====
        updateChatTitle: function(box, text) {
            var titleEl = box.querySelector('.chatbox-header .title') || box.querySelector('.chatbox-header-row1 .title');
            if (!titleEl) return;
            // 标题只取第一条用户提问的「正文」：剥离【当前项目上下文】/【用户划选的文本】等注入前缀
            var firstQ = '';
            var body = box.querySelector('.chatbox-body');
            /* 【懒渲染/裁剪口径修正 2026-11-23】标题语义 = 全对话第一句用户提问，真源在数据层。
               原实现从 DOM 取第一条 .msg.user：懒渲染恢复只渲尾部 100 条、实时裁剪窗口保 100 条，
               超长对话里 DOM 第一条是"可见窗口第一条"而非全对话第一条，恢复/撤销/发新消息时
               标题文本与 hover 全文(titleEl.title)会被污染成中间某条提问。
               修法：Store.getMessages 全量 → chat.history 全量 → DOM 兜底（覆盖克隆等无数据层场景）。 */
            var chat = this.chatBoxes.find(function(c) { return c.el === box; });
            var _pickUserText = function(m) {
                if (!m || m.role !== 'user') return null;
                var c = m.content;
                if (typeof c === 'string') return c;
                if (Array.isArray(c)) { // 图片等多模态消息：只拼文本部分
                    var parts = [];
                    for (var i = 0; i < c.length; i++) {
                        if (c[i] && c[i].type === 'text' && c[i].text) parts.push(String(c[i].text));
                    }
                    return parts.join('\n');
                }
                return null;
            };
            try {
                var _msgs = (chat && chat.id && typeof Store.getMessages === 'function') ? Store.getMessages(chat.id) : null;
                if (_msgs && _msgs.length) {
                    for (var mi = 0; mi < _msgs.length; mi++) {
                        var _t = _pickUserText(_msgs[mi]);
                        if (_t && String(_t).trim()) { firstQ = String(_t); break; }
                    }
                }
            } catch (eStore) {}
            if (!firstQ && chat && Array.isArray(chat.history)) {
                for (var hi = 0; hi < chat.history.length; hi++) {
                    var _ht = _pickUserText(chat.history[hi]);
                    if (_ht && String(_ht).trim()) { firstQ = String(_ht); break; }
                }
            }
            if (!firstQ && body) {
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
            // 保存到内存 + SQLite（chat 已在上方数据层取数时查找过）
            if (chat) {
                // 【用户重命名保护】用户手动改过名的对话，AI 不再自动覆盖标题（策划案 P2 提前收割项）
                if ((chat.userRenamed === true) || (titleEl.dataset && titleEl.dataset.userRenamed === '1')) return;
                Store.saveChatBox(chat);
            }
        },

        // ===== 用户重命名对话（双击标题触发，持久 + 不被 AI 覆盖）=====
        renameChatTitle: function(box) {
            var titleEl = box.querySelector('.chatbox-header .title') || box.querySelector('.chatbox-header-row1 .title');
            if (!titleEl || titleEl.querySelector('input')) return;
            var oldName = titleEl.textContent;
            var input = document.createElement('input');
            input.className = 'cbx-rename-input';
            input.value = oldName;
            input.style.cssText = 'width:100%;background:transparent;border:none;outline:none;font:inherit;color:inherit;padding:0;';
            titleEl.textContent = '';
            titleEl.appendChild(input);
            input.focus(); input.select();
            var chat = this.chatBoxes.find(function(c) { return c.el === box; });
            var commit = function() {
                var name = input.value.replace(/\s+/g, ' ').trim() || oldName;
                titleEl.textContent = name;
                titleEl.title = name;
                titleEl.dataset.userRenamed = '1';          // DOM 级标记（会话内防覆盖）
                if (chat) { chat.userRenamed = true; Store.saveChatBox(chat); } // 数据级标记 + 落库
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', function(ev) {
                if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                if (ev.key === 'Escape') { input.value = oldName; input.blur(); }
                ev.stopPropagation();
            });
            input.addEventListener('click', function(ev) { ev.stopPropagation(); });
        },

        // ===== batchSetTitle：批量把全部对话降级为标题档（收起正文，仅保留标题条+状态）=====
        // 提前收割项（策划案 v3.5 执行卡）：B 模式整理态雏形。exceptBox=豁免（如中心主角）。
        // 复用现有 .collapsed 档位（store.js 已持久化 collapsed），零新数据结构。
        batchSetTitle: function(exceptBox) {
            var n = 0;
            this.chatBoxes.forEach(function(chat) {
                if (!chat.el || chat.el === exceptBox) return;
                if (!chat.el.classList.contains('collapsed')) {
                    chat.el.classList.add('collapsed');
                    n++;
                }
                Store.saveChatBox(chat);
            });
            if (window.ToastStack && typeof window.ToastStack.show === 'function') {
                var t = document.createElement('div');
                t.textContent = '已批量收起 ' + n + ' 个对话为标题档';
                window.ToastStack.show(t, 1500);
            }
            return n;
        },

        // batchSetTitle 反向：全部展开
        batchRestoreAll: function() {
            var n = 0;
            this.chatBoxes.forEach(function(chat) {
                if (!chat.el) return;
                if (chat.el.classList.contains('collapsed')) {
                    chat.el.classList.remove('collapsed');
                    n++;
                }
                Store.saveChatBox(chat);
            });
            return n;
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
                    // 【2026-09 修复】兜底分支 ToastStack 不存在时，动画结束后必须移除节点，
                    // 否则每次提示都在 body 永久残留一个 .copy-toast，DOM 总数持续上涨
                    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
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
                btn.textContent = btn._origLabel || '⧉';
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
                    // 按钮挂到外层 code-wrap 上，横向滚动 pre 时按钮位置不动
                    var wrap = pre.parentElement;
                    if (!wrap || !wrap.classList.contains('code-wrap')) {
                        wrap = document.createElement('div');
                        wrap.className = 'code-wrap';
                        pre.parentNode.insertBefore(wrap, pre);
                        wrap.appendChild(pre);
                    }
                    var btn = document.createElement('button');
                    btn.className = 'code-copy-btn';
                    btn.textContent = '⧉';
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
                    wrap.appendChild(btn);
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

            /* 【BUG修复】重复渲染时会重复追加选项按钮容器导致 DOM 无限增长——先移除旧的再建 */
            var _oldOpt = container.querySelector('.auto-option-container');
            if (_oldOpt) _oldOpt.remove();

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
        // ===== 智能精简预览：策划陈列等长内容优先保留结构行 =====
        _smartPreview: function(text, maxLen) {
            try {
                var s = String(text || '');
                // 按行拆分，过滤纯空行
                var lines = s.split(/\n+/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(function (l) { return l; });
                if (!lines.length) return '';
                // 关键行：标题/结论/方案标记/plan_id/涉及文件/风险等结构信息
                var keyRe = /(【|plan_id|lp-[a-z0-9]|方案|结论|目标|风险|涉及文件|采纳|不采纳|✅|⚠️|❌|①|②|③)/;
                var keys = lines.filter(function (l) { return keyRe.test(l); });
                var rest = lines.filter(function (l) { return !keyRe.test(l); });
                var picked = [];
                // 先取关键行（各截 80 字），再补普通行，凑满 maxLen
                function push(l, cap) {
                    if (l.length > cap) l = l.slice(0, cap) + '…';
                    if (picked.join(' ').length + l.length <= maxLen) { picked.push(l); return true; }
                    return false;
                }
                for (var i = 0; i < keys.length; i++) if (!push(keys[i], 80)) break;
                for (var j = 0; j < rest.length && picked.join(' ').length < maxLen; j++) if (!push(rest[j], 60)) break;
                var out = picked.join(' ｜ ');
                if (out.length > maxLen) out = out.slice(0, maxLen) + '…';
                return out || lines[0].slice(0, maxLen);
            } catch (e) {
                return String(text || '').slice(0, maxLen || 60);
            }
        },

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
            // 【精简不裁剪 2026-10-12】智能精简：优先保留关键行（方案/标题/结论/plan_id），
            // 压缩空白后最多 200 字（CSS 限 2 行），全文写入 tooltip 悬停可看，内容不丢失
            var preview = this._smartPreview(text, 200);
            var _full = String(text);
            pin.innerHTML =
                '<span class="query-pin__icon">📌</span>' +
                '<span class="query-pin__text">' + this._escapeHtml(preview) + '</span>' +
                '<span class="query-pin__tooltip">' + this._escapeHtml(_full) + '</span>';
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
                        // 往上找本条提醒之前最近的 AI 回复（遇到第一条就停，它才是离本提醒最近的答案；
                        // 不能一路往上覆盖，否则会拿到这条提问区段最上面那条旧回复）
                        var prev = reminder.previousElementSibling;
                        var found = null;
                        while (prev) {
                            if (prev.classList && prev.classList.contains('msg')) {
                                if (prev.classList.contains('user') || prev.classList.contains('query-reminder')) break;
                                if (prev.classList.contains('ai') || prev.classList.contains('ai-final') || prev.classList.contains('error')) {
                                    found = prev;
                                    break;
                                }
                            }
                            prev = prev.previousElementSibling;
                        }
                        if (found) {
                            // 往上多留 90px，确保能看到答案开头（offsetTop 相对 offsetParent 不可靠，用 getBoundingClientRect 换算）
                            // 【2026-09 修复】先等一帧并强制目标完成布局再定位，防止视口外/估算高度导致滚偏
                            requestAnimationFrame(function() {
                                try { void found.offsetHeight; void body.scrollHeight; } catch (e) {}
                                var targetTop = found.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 90;
                                if (targetTop < 0) targetTop = 0;
                                var maxTop2 = body.scrollHeight - body.clientHeight;
                                if (targetTop > maxTop2) targetTop = maxTop2;
                                body.scrollTo({ top: targetTop, behavior: 'smooth' });
                            });
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
                    });
                    reminder.innerHTML =
                        '<span style="opacity:0.85;font-size:11px;">📎 本次提问：</span><br>' +
                        this.renderMarkdown(fullText);
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
