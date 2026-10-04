// ==== 拆分自 app-chatbox.js：格式化耗时_关闭对话框_更新右键菜单中"_恢复最后一个关闭 ====
Object.assign(App, {
        // ===== 格式化耗时 =====
        _formatDuration: function(ms) {
            if (!ms || ms < 0) ms = 0;
            var totalSec = Math.floor(ms / 1000);
            if (totalSec < 1) return ms + 'ms';
            if (totalSec < 60) return totalSec + 's';
            var m = Math.floor(totalSec / 60);
            var s = totalSec % 60;
            if (m < 60) return m + 'm' + (s > 0 ? s + 's' : '');
            var h = Math.floor(m / 60);
            m = m % 60;
            return h + 'h' + (m > 0 ? m + 'm' : '') + (s > 0 ? s + 's' : '');
        },

        addMsgStreaming: function(box, text, who, modelId, isFinal, onDone) {
            var self = this;
            text = String(text == null ? '' : text);
            // 【修复：最后一条消息重启后丢失】流式打字动画期间消息未持久化（skipSave），
            // 若用户在动画完成前关闭页面/重启，这条消息就永久丢失。
            // 先把待存消息挂到 chat._pendingStreamSave，Store.flush（beforeunload）检测到后用 sendBeacon 立即补写。
            var _streamChat = this.chatBoxes && this.chatBoxes.find ? this.chatBoxes.find(function(c) { return c.el === box; }) : null;
            var _streamRole = who === 'user' ? 'user' : (who === 'error' ? 'error' : 'assistant');
            if (_streamChat && box.id) {
                _streamChat._pendingStreamSave = {
                    role: _streamRole,
                    content: text,
                    modelId: modelId || '',
                    msgType: isFinal ? 'final' : 'text'
                };
            }
            // skipSave=true：流式内容尚未完整，先不持久化（避免把空内容写入数据库导致重启后回复空白）
            var div = this.addMsg(box, '', who, modelId, isFinal, true);
            if (who !== 'ai' || !text) {
                if (onDone) onDone(div);
                return div;
            }
            var body = box.querySelector('.chatbox-body');
            var index = 0;
            var step = Math.max(1, Math.ceil(text.length / 20)); // 提速：每次tick显示更多字符（较原/30快1.5倍）
            var lastTick = 0;   // 上次 tick 时间戳（检测后台节流用）
            var tick = function() {
                // 页面切到后台时浏览器会节流 setTimeout（后台标签约1秒/次），打字动画会积压；
                // 切回页面后所有工具说明文本会集中"流式重放"，观感异常。
                // 因此：页面不可见 或 两次 tick 间隔异常大（经历后台节流）时，
                // 跳过打字动画直接显示完整内容，切回后看到的就是工具执行完毕的最终结果。
                var now = Date.now();
                if (document.hidden || (lastTick > 0 && now - lastTick > 800)) {
                    index = text.length;
                    self._setMsgContent(div, text);
                    if (body) body.scrollTop = body.scrollHeight;
                    // 动画完成：用完整内容持久化，保证重启后回复可见
                    try {
                        if (box.id && typeof Store !== 'undefined') {
                            var role = who === 'user' ? 'user' : (who === 'error' ? 'error' : 'assistant');
                            var msgType = isFinal ? 'final' : 'text';
                            var msgParentId = null;
                            if (role === 'assistant' && Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) {
                                msgParentId = Store._lastUserMsgIds[box.id];
                            }
                            Store.addMessage(box.id, role, text, msgType, modelId, msgParentId);
                            // 动画完成（或后台节流跳过），清掉待存标记
                            var _scDone = self.chatBoxes && self.chatBoxes.find && self.chatBoxes.find(function(c) { return c.el === box; });
                            if (_scDone) _scDone._pendingStreamSave = null;
                        }
                    } catch (e) {}
                    if (onDone) onDone(div);
                    return;
                }
                lastTick = now;
                index = Math.min(text.length, index + step);
                // [Fix 2026-01-12] 流式阶段严禁重跑 markdown 渲染。
                // 半截 HTML（未闭合的 <table>/<li>/<code> 等）经 marked 反复解析会
                // 产生损坏的 DOM 树，浏览器自动补全闭合标签时会把表格/列表/代码块
                // 搬出原父容器，导致"表格飞走""代码块错位"等渲染 bug。
                // 改为：打字机阶段只更新 textContent，最后一帧才走完整 markdown 管道。
                if (div._streamMd) {
                    self.setMsgContent(div, text, who);
                    div._streamMd = false;
                } else {
                    div.textContent = text.slice(0, index);
                }
                // 【性能优化】仅在用户跟随底部时才滚动，避免每 18ms 读写 scrollHeight 强制重排
                var _chat = self.chatBoxes && self.chatBoxes.find(function(c) { return c.el === box; });
                if (body && (!_chat || _chat.autoFollowBottom)) body.scrollTop = body.scrollHeight;
                if (index < text.length) {
                    if (text.length - index <= step) div._streamMd = true;
                    setTimeout(tick, 18);
                } else {
                    // 动画完成：用完整内容持久化，保证重启后回复可见
                    try {
                        if (box.id && typeof Store !== 'undefined') {
                            var role = who === 'user' ? 'user' : (who === 'error' ? 'error' : 'assistant');
                            var msgType = isFinal ? 'final' : 'text';
                            var msgParentId = null;
                            if (role === 'assistant' && Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) {
                                msgParentId = Store._lastUserMsgIds[box.id];
                            }
                            Store.addMessage(box.id, role, text, msgType, modelId, msgParentId);
                            // 动画完成，清掉待存标记
                            var _scDone2 = self.chatBoxes && self.chatBoxes.find && self.chatBoxes.find(function(c) { return c.el === box; });
                            if (_scDone2) _scDone2._pendingStreamSave = null;
                        }
                    } catch (e) {}
                    if (onDone) onDone(div);
                }
            };
            setTimeout(tick, 18);
            return div;
        },

        _setMsgContent: function(div, text) {
            // 与正常路径 setMsgContent 保持一致（AI 消息走 markdown 渲染）。
            // 旧实现找 .msg-content 子元素，但 AI 消息并无该子元素，
            // 导致后台节流分支直接 textContent 显示原始 markdown（**星号残留）。
            if (!div) return;
            var who = /(^|\s)ai(-final)?(\s|$)/.test(div.className) ? 'ai' : (/\buser\b/.test(div.className) ? 'user' : div.className.replace(/\bmsg\b/, '').trim());
            this.setMsgContent(div, text, who);
        },

        // ===== 最近使用的工具名列表（按时间正序排列，供 thinking 工具字圆圈排队展示） =====
        _recentToolNames: function(box) {
            var names = [];
            try {
                var _chat = this.chatBoxes ? (this.chatBoxes.find(function(c) { return c.el === box; }) || this.chatBoxes.find(function(c) { return c.id === box.id; })) : null;
                var _id = _chat ? _chat.id : box.id;
                var _logs = (typeof Store !== 'undefined' && Store.getMessages && _id) ? (Store.getMessages(_id) || []) : [];
                // 正序收集所有工具调用名（每次调用一个，允许重复），最多保留最近 50 条
                for (var i = 0; i < _logs.length && names.length < 50; i++) {
                    var m = _logs[i];
                    if ((m.type === 'tool_call' || m.role === 'tool_call') && m.content) {
                        var n = String(m.content).split(':')[0].trim();
                        if (n) names.push(n);
                    }
                }
            } catch (e) {}
            return names;
        },

        addMsg: function(box, text, who, modelId, isFinal, skipSave) {
            var self = this;
            var body = box.querySelector('.chatbox-body');
            var div = document.createElement('div');
            div.className = 'msg ' + who + (isFinal && who === 'ai' ? ' ai-final' : '');
            if (who === 'typing') {
                // 增强型 typing 指示器：旋转图标 + 文字 + 实时计时器（每秒更新）
                // 【2026-09 修复 0s bug】起始时间挂在 box 上（跨轮/重建不重置），更新交给全局计时器——
                // 旧方案用闭包 interval，typing 行被删重建/克隆后闭包指向已脱离 DOM 的旧节点，秒数永远停在 0s。
                var _typingStart = box._typingStart || Date.now();
                if (!box._typingStart) box._typingStart = _typingStart;
                div.innerHTML =
                    '<span class="typing-text">' + this._escapeHtml(text) + '</span>' +
                    '<span class="typing-spinner"></span>' +
                    '<span class="thinking-tools" title="最近使用的工具"></span>' +
                    '<span class="typing-timer">0s</span>' +
                    '<span class="whip-hint" title="插话催促：让 AI 尽快收尾（下一个工具请求生效）">' +
                    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                    '<path d="M5 19 L12 12"/>' +
                    '<path d="M12 12 C15 9 18.5 10 18.8 6 C19.1 2.5 15.6 1.6 14.2 4.4"/>' +
                    '</svg></span>';
                var _timerEl = div.querySelector('.typing-timer');
                if (_timerEl) _timerEl.setAttribute('data-start', String(_typingStart));
                // 鞭子按钮：点击后给当前对话打「尽快收尾」标记，下一个模型请求携带该插话
                var _whipEl = div.querySelector('.whip-hint');
                if (_whipEl) {
                    _whipEl.addEventListener('click', function(ev) {
                        ev.stopPropagation();
                        var _wc = null;
                        try {
                            _wc = self.chatBoxes && self.chatBoxes.find && self.chatBoxes.find(function(c) { return c.el === box || c.id === box.id; });
                        } catch (e) {}
                        if (!_wc) return;
                        _wc._whipRequested = !_wc._whipRequested;
                        _whipEl.classList.toggle('whip-on', !!_wc._whipRequested);
                    });
                    // 若标记已生效（typing 行跨轮重建），回显高亮
                    try {
                        var _wc0 = self.chatBoxes && self.chatBoxes.find && self.chatBoxes.find(function(c) { return c.el === box || c.id === box.id; });
                        if (_wc0 && _wc0._whipRequested) _whipEl.classList.add('whip-on');
                    } catch (e) {}
                }
                // 全局计时器：每 500ms 扫描页面上所有 typing 行的计时器统一更新
                if (!self._typingTimerGlobal) {
                    self._typingTimerGlobal = setInterval(function() {
                        try {
                            document.querySelectorAll('.msg.typing .typing-timer').forEach(function(t) {
                                var st = parseInt(t.getAttribute('data-start') || '0', 10);
                                if (!st) return;
                                var secs = Math.floor((Date.now() - st) / 1000);
                                t.textContent = secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm' + (secs % 60) + 's';
                            });
                        } catch (e) {}
                    }, 500);
                }
                // ===== 工具球：直连模式。agent-02-loop-core 每次执行工具时直接调 div._ttPush(工具名) 塞一颗球，
                // 不再依赖 Store 消息库基线（旧方案链路脆弱，基线错位导致一颗球都看不到）。从 0 开始，满 10 颗被转圈吸走清零。
                var _ttCount = 0;
                var _ttRound = 0;
                div._ttPush = function(toolName) {
                    var el = div.querySelector('.thinking-tools');
                    if (!el) {
                        // 防御：容器被外层逻辑清掉时现场重建，插到小圈右侧
                        el = document.createElement('span');
                        el.className = 'thinking-tools';
                        el.title = '最近使用的工具';
                        var _hole0 = div.querySelector('.typing-spinner');
                        if (_hole0 && _hole0.parentNode) _hole0.parentNode.insertBefore(el, _hole0.nextSibling);
                        else div.appendChild(el);
                    }
                    // 进洞动画期间：忽略新球（防计数错乱导致永远清空、看不到球）
                    var _holeGuard = div.querySelector('.typing-spinner');
                    if (_holeGuard && _holeGuard.classList.contains('tt-burst')) return;
                    _ttCount++;
                    var _hole = div.querySelector('.typing-spinner');
                    var ch = String(toolName || '?').charAt(0).toUpperCase();
                    var sp = document.createElement('span');
                    // 【2026-09 修复】回放上一轮的球时（div._replaying）静态放置：
                    // 不加 tt-fly-in（飞入动画）/ tt-new（发光高亮），左侧旧球保持静止，
                    // 否则每轮回放集体重新飞入+发光，看起来像"消失/隐藏/集体发光"。
                    var _isReplay = !!div._replaying;
                    sp.className = _isReplay ? 'tt-circle' : 'tt-circle tt-fly-in tt-new';
                    sp.setAttribute('data-tip', toolName);
                    sp.setAttribute('title', toolName);
                    sp.textContent = ch;
                    el.appendChild(sp); // 从右侧滑入，挨着前面的排队
                    // 撞球效果：新球撞一下左边紧挨的球（回放的球不撞）
                    var prev = sp.previousElementSibling;
                    if (!_isReplay && prev && prev.classList.contains('tt-circle')) {
                        prev.classList.remove('tt-hit');
                        void prev.offsetWidth;
                        prev.classList.add('tt-hit');
                        setTimeout(function() { prev.classList.remove('tt-hit'); }, 600);
                    }
                    // 已有的球摘掉“最新”高亮
                    el.querySelectorAll('.tt-circle').forEach(function(c, idx, arr) {
                        if (idx < arr.length - 1) c.classList.remove('tt-new');
                    });
                    if (_ttCount >= 10) {
                        // 凑够 10 颗：转圈漩涡爆发吞没全部，清零重来
                        try { if (_hole) _hole.classList.add('tt-burst'); } catch (e) {}
                        el.classList.add('tt-potting');
                        // 累计轮次：每凑满 10 颗，在洞口弹一次 +N 浮动提示（一次性，不长期停留）
                        _ttRound++;
                        var _plus = document.createElement('span');
                        _plus.className = 'tt-plus-pop';
                        _plus.textContent = '+' + _ttRound;
                        if (_hole && _hole.parentNode) _hole.parentNode.insertBefore(_plus, _hole);
                        setTimeout(function() { try { if (_plus.parentNode) _plus.remove(); } catch (e) {} }, 1200);
                        setTimeout(function() {
                            el.classList.remove('tt-potting');
                            el.innerHTML = '';
                            _ttCount = 0;
                            try { if (_hole) _hole.classList.remove('tt-burst'); } catch (e) {}
                        }, 700);
                    }
                };
            } else {
                this.setMsgContent(div, text, who);
            }
            // 工具组默认折叠为紧凑条，用户点击展开查看详情
            body.appendChild(div);
            // 【2026 修复】DOM 裁剪：对话越长 DOM 节点越多，渲染/滚动越来越卡。
            // 消息+工具卡片超过 120 条时，移除最旧的非 AI 最终回复节点（最终答案始终保留）。
            // 【2026-09 修复】旧实现遇到第一个受保护节点（ai-final）就 break，
            // 而最终回复通常在消息流前段，导致裁剪从未生效、超过 10 轮明显卡顿。
            // 改为：跳过保护节点继续向后裁剪（保护节点本身不删除）。
            // 【DOM 裁剪 v3】双重限制：条数 + 节点总数。
            // 每条消息内部可能有几十上百个子节点（工具卡片/代码块/图片），
            // 只按条数裁会导致单条巨消息撑爆 DOM。节点总数超过 3000 时，
            // 从最旧开始裁（跳过 ai-final 保护节点），直到降到 1800 以下。
            try {
                var _countNodes = function(el) { return el.getElementsByTagName('*').length + 1; };
                // 【DOM 裁剪 v4】增量节点计数：新增消息只数新增子树，每 50 条全量校准一次，
                // 避免旧版每次 addMsg 都全树扫描（长会话下 O(n) 越滚越卡）。
                if (body._nc == null) { body._nc = _countNodes(body); body._ncTick = 0; }
                else {
                    body._nc += _countNodes(div);
                    if (++body._ncTick >= 50) { body._nc = _countNodes(body); body._ncTick = 0; }
                }
                // 【v4 核心修复】ai-final 不再无限保护：只保留最近 25 条最终回复，
                // 更旧的 ai-final 同样可裁。旧版遇到 ai-final 永远跳过不删，而每轮
                // AI 回复都是 ai-final，长会话里它们只增不减 → 裁剪形同虚设、DOM 无限扩大。
                var _MAX_KEEP_FINAL = 25;
                if (body.childNodes.length > 120 || body._nc > 3000) {
                    var _removed = 0;
                    // 统计 body 直接子级中 ai-final 总数：从旧往新遍历时，
                    // 只有排进"最新 25 条"区间的才保护，更旧的最终回复放行可裁
                    var _finalTotal = 0;
                    for (var _fe = body.firstElementChild; _fe; _fe = _fe.nextElementSibling) {
                        if (_fe.classList && _fe.classList.contains('ai-final')) _finalTotal++;
                    }
                    var _finalSeen = 0;
                    var _node = body.firstChild;
                    while ((body.childNodes.length > 80 || body._nc > 1800) && _removed < 60 && _node) {
                        var _next = _node.nextSibling;
                        if (_node.classList && _node.classList.contains('compress-selector')) {
                            _node = _next; // 压缩选择器：始终保护
                            continue;
                        }
                        if (_node.classList && _node.classList.contains('ai-final')) {
                            _finalSeen++;
                            if (_finalSeen > _finalTotal - _MAX_KEEP_FINAL) {
                                _node = _next; // 属于最新 25 条最终回复：保护
                                continue;
                            }
                            // 更旧的最终回复：放行，落入下方删除逻辑
                        }
                        if (_node._typingInterval) clearInterval(_node._typingInterval);
                        if (_node._ttRotate) clearInterval(_node._ttRotate);
                        body._nc -= (_node.getElementsByTagName ? _countNodes(_node) : 1);
                        body.removeChild(_node);
                        _removed++;
                        _node = _next;
                    }
                    body._nc = _countNodes(body); // 裁完全量校准，保证计数准确
                    body._ncTick = 0;
                }
            } catch (e) {}
            // 记录最后活跃时间：小狗守卫用这个判断"空闲太久没动静"的对话
            // 【2026-09 修复】所有消息（含 AI 回复）都打点，等 AI 回复期间不再累积空闲时长
            var _dgChat = this.chatBoxes.find(function(c) { return c.el === box; });
            if (_dgChat && who !== 'typing') _dgChat._dogGuardLastActivity = Date.now();
            self._refreshUserMsgBtns(body);
            var _chat = this.chatBoxes.find(function(c) { return c.el === box; }) || self.chatBoxes.find(function(c) { return c.id === box.id; });
            if (_chat && _chat.autoFollowBottom) {
                body.scrollTop = body.scrollHeight;
            } else if (!_chat) {
                body.scrollTop = body.scrollHeight;
            }
            var sbb = box.querySelector('.scroll-bottom-btn');
            if (sbb && (!_chat || _chat.autoFollowBottom)) sbb.classList.remove('visible');
            // 持久化（typing 类型是临时的，不保存）
            if (!skipSave && who !== 'typing' && box.id) {
                var role = who === 'user' ? 'user' : (who === 'error' ? 'error' : 'assistant');
            var msgType = isFinal ? 'final' : 'text';
                var msgParentId = null;
                if (role === 'assistant' && Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) {
                    msgParentId = Store._lastUserMsgIds[box.id];
                }
                Store.addMessage(box.id, role, text, msgType, modelId, msgParentId);
                if (who === 'error' && self.updateMinimap) self.updateMinimap();
            }
            return div;
        },

        // ===== 关闭对话框 =====
        closeChatBox: function(chat) {
            // 通知收尾：关闭对话框时收起底层引擎/工具分类下拉菜单
            try { window.dispatchEvent(new CustomEvent('zf-chatbox-closing', { detail: { chatId: chat && chat.id } })); } catch (e) {}
            // 清理 bindChatBox 注册的监听器和定时器（替代 monkey-patch 方案）
            if (chat._cleanup) {
                if (chat._cleanup.scrollBtnTimer) clearInterval(chat._cleanup.scrollBtnTimer);
                if (chat._cleanup.navArrowTimer) clearInterval(chat._cleanup.navArrowTimer);
                chat._cleanup.listeners.forEach(function(item) {
                    item.target.removeEventListener(item.event, item.handler);
                });
                chat._cleanup = null;
            }
            if (chat.el) this.flushQueryPin(chat.el, chat);
            // 【防重启复活】先 abort 在途请求/打关闭标志，再拍快照：
            // abort 阻断 token 统计等异步回调继续执行；_closed 标志让 Store.saveChatBox 守卫拒绝
            // 后续任何在途回调的落库（根治关闭后异步回写把 DB 记录复活的问题）。
            // 注意顺序：快照在打 _closed 之前构建，避免快照对象带上 _closed 标志，
            // 否则「恢复已关闭」经 Store.saveChatBox 重新落库时会被守卫拦截。
            try { if (chat.abortController) chat.abortController.abort(); } catch (e0) {}
            var el = chat.el;
            var snapshot = {
                id: chat.id,
                modelId: chat.modelId || '',
                modelIdOverride: chat._modelIdOverride || '',
                reasoningEffort: chat._reasoningEffort || '',
                x: el ? parseInt(el.style.left) || 0 : 0,
                y: el ? parseInt(el.style.top) || 0 : 0,
                w: el ? el.offsetWidth || 360 : 360,
                h: el ? el.offsetHeight || 480 : 480,
                z: el ? parseInt(el.style.zIndex) || 50 : 50,
                collapsed: el ? el.classList.contains('collapsed') : false,
                title: el && el.querySelector('.title') ? el.querySelector('.title').textContent : '',
                createdAt: chat.createdAt || Date.now(),
                chatNum: chat.chatNum || 0,
                messages: Store.getMessages(chat.id).slice(),
                projectId: chat.projectId || null
            };
            this._closedStack.push(snapshot);
            if (this._closedStack.length > 20) this._closedStack.shift();
            // 快照已构建完毕，现在才打关闭标志（守卫从此刻起生效，且快照不带标志）
            try { chat._closed = true; } catch (eC) {}
            // 更新右键菜单显示
            this._updateRestoreMenu();

            var idx = this.chatBoxes.indexOf(chat);
            if (idx >= 0) this.chatBoxes.splice(idx, 1);
            // 【关闭动画】缩放淡出后再移除，快照已在上方保存，不影响恢复
            if (chat.el) {
                var _closeEl = chat.el;
                if (_closeEl._zfClosing) {
                    _closeEl = null;
                } else {
                    _closeEl._zfClosing = true;
                    try {
                        _closeEl.classList.add('zf-box-close');
                        setTimeout(function() {
                            try { if (_closeEl && _closeEl.parentNode) _closeEl.remove(); } catch (e) {}
                        }, 220);
                    } catch (e) {
                        if (_closeEl.parentNode) _closeEl.remove();
                    }
                }
            }
            // 清理随手标题连线绑定：对话已关闭，绑定关系必须断裂。
            // （对话 id 为 cb+编号会复用，不清理的话新对话会被旧标题残留的绑定"自动关联"）
            if (window.QuickNoteLinks && typeof QuickNoteLinks.unbindChatEverywhere === 'function') {
                try { QuickNoteLinks.unbindChatEverywhere(chat.id); } catch (e) {}
            }
            // 关闭的对话 id 永不复用：把编号写入持久化计数器（防刷新后 nextBoxId 复用旧 id，
            // 导致随手标题残留绑定自动关联到新对话）
            try {
                var _closedNum = parseInt(String(chat.id || '').replace(/^cb/, ''), 10);
                if (_closedNum) {
                    var _cnt = parseInt(localStorage.getItem('zf3d_cb_counter') || '0', 10) || 0;
                    if (_closedNum >= _cnt) localStorage.setItem('zf3d_cb_counter', String(_closedNum));
                }
            } catch (e2) {}
            // 内存中立即删除 chatBox 条目，DB 也立即清理
            // 快照保存在 _closedStack 中，可通过右键菜单"恢复已关闭"还原
            var self2 = this;
            Store.data.chatBoxes = Store.data.chatBoxes.filter(function(b) { return b.id !== chat.id; });
            // 取消防抖定时器
            if (Store._timers['box_' + chat.id]) {
                clearTimeout(Store._timers['box_' + chat.id]);
                Store._timers['box_' + chat.id] = null;
            }
            // 立即清理 DB（不再延迟 3 秒，避免页面关闭后 DB 残留导致重启后重新打开已关闭面板）
            // 快照仍保存在 _closedStack 中用于"恢复已关闭"功能；
            // 恢复时 restoreLastClosed 会通过 Store.saveChatBox + DB.addChatMessage 重新写入 DB
            if (Store.dbOnline && typeof DB !== 'undefined') {
                DB.deleteNode(snapshot.id).catch(function(e) {
                    console.warn('[Chatbox] node delete failed:', e);
                    // 【防重启复活】删除失败（如服务器正在重启）时挂起，下次启动先补删再读节点，
                    // 否则 canvas_nodes 残留会导致重启后已关闭的审核员/策划师等窗口被恢复出来
                    try {
                        var q = JSON.parse(localStorage.getItem('zf_pending_node_deletes') || '[]');
                        if (q.indexOf(snapshot.id) < 0) q.push(snapshot.id);
                        localStorage.setItem('zf_pending_node_deletes', JSON.stringify(q));
                    } catch (e2) {}
                });
                DB.clearChatHistory(snapshot.id).catch(function() {});
            } else {
                // DB 离线时同样挂起，等下次在线启动补删
                try {
                    var q2 = JSON.parse(localStorage.getItem('zf_pending_node_deletes') || '[]');
                    if (q2.indexOf(snapshot.id) < 0) q2.push(snapshot.id);
                    localStorage.setItem('zf_pending_node_deletes', JSON.stringify(q2));
                } catch (e3) {}
            }
            Store.addLog('info', chat.id, 'close', '关闭对话框');
            // 联动清理：删除该对话关联的任务清单，并刷新任务面板
            if (typeof App !== 'undefined' && App._cleanupTaskListsForChat) {
                App._cleanupTaskListsForChat(chat.id);
            }
            // 【跨重启持久化】对话已关闭 → 清理其待发附件暂存（否则重启后会恢复出幽灵附件）
            if (typeof App !== 'undefined' && typeof App.persistChatAttachments === 'function') {
                var _fakeBox = { id: chat.id };
                App._pendingImages = App._pendingImages || {};
                App._pendingPastes = App._pendingPastes || {};
                delete App._pendingImages[chat.id];
                delete App._pendingPastes[chat.id];
                App.persistChatAttachments(_fakeBox);
            }
            this.updateStatus();
            this.updateMinimap();
            // 【赛道释放+池擦除】对话已关闭 → discard 该对话的池槽位：
            // 取消未完成 Turn + 立即清事件缓冲 + 移除槽位，
            // 避免"幽灵车"残留赛道、缓冲内存滞留 30 分钟才回收
            try {
                fetch((typeof DB !== 'undefined' ? DB.BASE_URL : '') + '/api/chat-pool/slot/' + encodeURIComponent(chat.id) + '/discard', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}'
                }).catch(function () {});
            } catch (e3) {}
            // 刷新所有剩余对话框的导航箭头
            this._updateAllNavArrows();
            // 如果所有对话框都已关闭，重新显示画布提示
            if (this.chatBoxes.length === 0) {
                this.showHint();
            }
        },

        // ===== 更新右键菜单中"恢复已关闭"项的显示 =====
        _updateRestoreMenu: function() {
            var item = document.getElementById('ctxRestoreClosed');
            var sep = document.getElementById('ctxSepRestore');
            if (!item || !sep) return;
            var has = this._closedStack.length > 0;
            sep.style.display = has ? '' : 'none';
            item.style.display = has ? '' : 'none';
            if (has) {
                var last = this._closedStack[this._closedStack.length - 1];
                var label = last.title || ('对话' + (last.chatNum || ''));
                if (label.length > 12) label = label.substring(0, 12) + '…';
                item.innerHTML = '<span class="ctx-icon">\u267b\ufe0f</span> 恢复: ' + label;
            }
        },

        // ===== 恢复最后一个关闭的会话 =====
        restoreLastClosed: function() {
            if (this._closedStack.length === 0) return;
            var snapshot = this._closedStack.pop();
            this._updateRestoreMenu();

            var self = this;
            var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            // 若该 id 的旧窗口还在关闭动画中（220ms 内恢复），先立刻移除，防 id 重复/新窗口被动画残留覆盖
            try {
                var _old = document.getElementById(snapshot.id);
                if (_old && _old._zfClosing) _old.remove();
            } catch (e) {}
            var box = document.createElement('div');
            box.className = 'chatbox' + (snapshot.collapsed ? ' collapsed' : '');
            box.id = snapshot.id;
            box.style.left = snapshot.x + 'px';
            box.style.top = snapshot.y + 'px';
            box.style.width = (snapshot.w || 360) + 'px';
            box.style.height = (snapshot.h || 480) + 'px';
            box.style.zIndex = ++this.zCounter;

            var modelId = snapshot.modelId || '';
            var model = modelId ? Models.get(modelId) : null;
            var boxName = model ? model.name : '未选择模型';
            var title = snapshot.title || ('对话' + (snapshot.chatNum || ''));
            if (title.indexOf('\ud83d\udcac') === 0) title = title.substring(2).trim();
            var _restoredCatName = Tools.chatCategories[snapshot.id] || snapshot.toolCategory || Tools.activeCategory;
            if (!Tools.categories[_restoredCatName]) _restoredCatName = '极简';
            Tools.chatCategories[snapshot.id] = _restoredCatName;
            box.innerHTML =
                App.buildChatboxPanels({
                    header: App.buildChatboxHeader({
                        title: title,
                        headerTitleAttr: '拖拽移动对话；Shift+左键拖拽：按下即在鼠标处复制一个一模一样的对话并跟随拖动',
                        extraBeforeButtons:
                            '<span class="proj-name" style="display:none"></span>' +
                            '<button class="hd-btn" data-act="starmap" title="星空知识图谱：本对话项目文件 3D 星图">🌌</button>' +
                            '<button class="hd-btn" data-act="remote" title="远程控制：本机 ID / 被控 / 控制他人">🔗</button>'
                    })
                });
            // 底部配置区控件（引擎菜单/分类菜单）统一填充
            App.fillChatboxConfigWidgets(box, { engineId: snapshot._engine || snapshot.engine || '', categoryName: _restoredCatName });

            canvas.appendChild(box);

            var chat = {
                id: box.id,
                el: box,
                modelId: modelId,
                chatNum: snapshot.chatNum || this.chatCounter,
                history: [],
                createdAt: snapshot.createdAt,
                isSending: false,
                abortController: null,
                queue: [],
                _stopped: false,
                projectId: snapshot.projectId || null,
                // ===== 底部选择器覆盖字段（模型ID / 思考强度） =====
                _modelIdOverride: snapshot.modelIdOverride || '',
                _reasoningEffort: snapshot.reasoningEffort || '',
                _engine: snapshot._engine || snapshot.engine || '',
                // 【压缩档位恢复】从用户习惯 JSON 恢复本对话的保留状态（跨刷新/恢复会话仍生效）
                _compressMode: (function(){ try { return (window.UserSettings && UserSettings.getChatCompressionModes(snapshot.id).toolResults) || 'minimal'; } catch(e) { return 'minimal'; } })(),
                _historyMode: (function(){ try { return (window.UserSettings && UserSettings.getChatCompressionModes(snapshot.id).historyAnswers) || 'minimal'; } catch(e) { return 'minimal'; } })()
            };
            this.chatBoxes.push(chat);
            this._updateProjectBtn(chat);

            // （原 _dbCleanupTimer 已移除，DB 在关闭时立即清理，恢复时重新写入）

            // 恢复消息到 Store 内存
            Store.data.messages[snapshot.id] = snapshot.messages ? snapshot.messages.slice() : [];

            // 重新写入 DB：先清空旧消息（防竞态残留），再逐条写入
            // 传入原始 ts，保持时间一致性（服务端按原始时间归档，避免伪重复）
            if (snapshot.messages && snapshot.messages.length && Store.dbOnline && typeof DB !== 'undefined') {
                var sid = snapshot.id;
                DB.clearChatHistory(sid).then(function() {
                    snapshot.messages.forEach(function(m) {
                        DB.addChatMessage(sid, m.role, m.content, m.modelId || '', null, m.ts).catch(function() {});
                    });
                }).catch(function() {});
            }

            // 渲染消息到 DOM（分块异步渲染，避免大量消息同步阻塞）
            var body = box.querySelector('.chatbox-body');
            var msgs = Store.getMessages(snapshot.id);
            if (msgs.length) {
                var msgIdx = 0;
                var CHUNK_SIZE = 8;
                (function renderChunk() {
                    var end = Math.min(msgIdx + CHUNK_SIZE, msgs.length);
                    var frag = document.createDocumentFragment();
                    for (; msgIdx < end; msgIdx++) {
                        var m = msgs[msgIdx];
                        if (m.type === 'typing' || m.type === 'tool_call') continue;
                        // 任务 meta 消息（⏱__TASKMETA__ 前缀）不渲染本体，由 _restoreTaskMetaRow 统一重绘耗时行+撤销按钮
                        if (m.role === 'assistant' && String(m.content || '').indexOf('\u23F1__TASKMETA__') === 0) {
                            if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') chat.history.push({ role: m.role, content: m.content });
                            continue;
                        }
                        var div = document.createElement('div');
                        var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                        div.className = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
                        var restoredContent = String(m.content || '');
                        // 任务结束总结（✅ 任务完成/❌ 任务失败 开头）不显示给用户，仅保留进 history 供大模型使用
                        var isTaskSummary = m.role === 'assistant' && (restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0 || restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0);
                        if (!isTaskSummary) {
                            if (m.role === 'assistant' && restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) div.classList.add('task-result-success');
                            if (m.role === 'assistant' && (restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0)) div.classList.add('task-result-fail');
                            self.setMsgContent(div, m.content, whoCls);
                            // 【增强】历史消息含图片时渲染缩略图（点击看原图）
                            if (m.role === 'user' && Array.isArray(m.content)) {
                                try {
                                    var _imgUrls = [];
                                    for (var _cp = 0; _cp < m.content.length; _cp++) {
                                        if (m.content[_cp] && m.content[_cp].type === 'image_url' && m.content[_cp].image_url && m.content[_cp].image_url.url) _imgUrls.push(m.content[_cp].image_url.url);
                                    }
                                    if (_imgUrls.length) {
                                        var _imgWrap = document.createElement('span');
                                        _imgWrap.className = 'msg-user-imgs';
                                        _imgWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;';
                                        for (var _iu = 0; _iu < _imgUrls.length; _iu++) {
                                            (function(_url) {
                                                var _im = document.createElement('img');
                                                _im.src = _url;
                                                _im.style.cssText = 'max-width:180px;max-height:180px;width:auto;height:auto;border-radius:8px;cursor:zoom-in;object-fit:contain;border:1px solid rgba(255,255,255,.15);';
                                                _im.addEventListener('click', function(e) {
                                                    e.stopPropagation();
                                                    if (typeof App._openImageLightbox === 'function') App._openImageLightbox(_url);
                                                });
                                                _imgWrap.appendChild(_im);
                                            })(_imgUrls[_iu]);
                                        }
                                        div.appendChild(_imgWrap);
                                    }
                                } catch (e) {}
                            }
                            frag.appendChild(div);
                        }
                        if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') chat.history.push({ role: m.role, content: m.content });
                    }
                    body.appendChild(frag);
                    if (msgIdx < msgs.length) {
                        requestAnimationFrame(renderChunk);
                    } else {
                        body.scrollTop = body.scrollHeight;
                        // 渲染完成：标题显示第一句用户提问
                        var fu = body.querySelector('.msg.user');
                        if (fu) self.updateChatTitle(box, '');
                        // 恢复任务耗时行+撤销按钮
                        if (self._restoreTaskMetaRow) self._restoreTaskMetaRow(box, chat, msgs);
                    }
                        self._refreshUserMsgBtns(body);
                })();
            } else {
                body.scrollTop = body.scrollHeight;
            }

            this.syncChatCounter();
            this.activate(box);
            this.bindChatBox(box, chat);
            // 【修复】恢复已关闭对话后补挂角色头像/角色属性
            try { if (window.App && typeof App._refreshRoleBadge === 'function') App._refreshRoleBadge(box); } catch (e) {}
            this._updateProjectBtn(chat);
            Store.saveChatBox(chat);
            Store.addLog('info', chat.id, 'restore', '恢复已关闭的对话: ' + boxName);
            this.updateStatus();
            this.hideHint();
            this.updateMinimap();
        },

});
