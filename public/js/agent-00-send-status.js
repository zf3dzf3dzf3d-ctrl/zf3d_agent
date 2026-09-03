// ==== 拆分自 app-agent.js：发送到模型（Agent 循环）_发送状态管理_更新标题栏状态小_停止发送_发送完成后的处理_渲染排队区域_编辑排队消息_删除排队消息_HTML 转义（_获取项目记忆（用 ====
Object.assign(App, {


        // ===== 发送到模型（Agent 循环） =====

        // ===== 发送状态管理 =====
        updateSendButton: function(box, chat) {
            var sendBtn = box.querySelector('.send-btn');
            if (!sendBtn) return;
            var sendIcon = sendBtn.querySelector('.send-icon');
            var stopIcon = sendBtn.querySelector('.stop-icon');
            if (chat.isSending) {
                if (sendIcon) sendIcon.style.display = 'none';
                if (stopIcon) stopIcon.style.display = '';
                sendBtn.classList.add('sending');
                sendBtn.title = '点击停止当前对话';
            } else {
                if (sendIcon) sendIcon.style.display = '';
                if (stopIcon) stopIcon.style.display = 'none';
                sendBtn.classList.remove('sending');
                sendBtn.title = '发送消息';
            }
            this.updateStatusDot(chat);
        },

        // ===== 更新标题栏状态小圆点（修复：此方法原本被调用但从未定义，导致 updateSendButton 抛 TypeError） =====
        updateStatusDot: function(chat) {
            if (!chat || !chat.el) return;
            var dot = chat.el.querySelector('.status-dot');
            if (!dot) return;
            var status = 'status-idle';
            if (chat.isSending) {
                status = 'status-sending';
            } else if (chat.queue && chat.queue.length) {
                status = 'status-queued';
            } else if (chat._lastStatus === 'error') {
                status = 'status-error';
            } else if (chat._lastStatus === 'success') {
                status = 'status-success';
            }
            dot.className = 'status-dot ' + status;
        },

        // ===== 停止发送 =====
        stopSending: function(chat) {
            // 【2026 修复】兼容"发送中标志丢失但循环实际仍在运行"的情况：
            // 场景一：切换模型/模型ID覆盖后，旧一轮 _agentLoop 的重试链（setTimeout）仍在挂起，
            //         但 chat.isSending 已被 _onSendComplete 置 false → 原逻辑直接 return，
            //         停止按钮失效，用户看到"对话停不下来"
            // 场景二：isSending 丢失但 abortController 还在 / 队列未清 → 同样需要强制停止
            var _loopAlive = !!(chat.abortController || (chat.queue && chat.queue.length));
            if (!chat.isSending && !_loopAlive) return;
            chat._stopped = true;
            chat._dgUserStopped = Date.now(); // 标记：用户主动停止（小狗守卫用来区分"人为停"和"异常停"）
            if (chat.abortController) {
                try { chat.abortController.abort(); } catch(e) {}
            }
            chat.isSending = false;
            // 移除 typing 指示器
            if (chat.el) {
                var typings = chat.el.querySelectorAll('.msg.typing');
                typings.forEach(function(t) { t.remove(); });
            }
            // 显示停止消息
            this.addMsg(chat.el, '\u23F9\uFE0F 对话已停止。', 'ai');
            Store.addLog('info', chat.id, 'stop', '用户停止对话');
            this.updateSendButton(chat.el, chat);
            this.updateMinimap();
            // 处理排队消息（含防重复调用守卫）
            // 【修复】如果有排队的用户消息，点击停止当前对话后应立刻发送下一条排队消息：
            //         先解除 _stopped 标志再走 _onSendComplete 的队列分支（该分支原本因
            //         防残留死循环守卫 !chat._stopped 而被跳过），发送后按钮自然回到
            //         「发送中（点击停止当前对话）」状态；期间若用户再次点停止（_stopped
            //         又置 true），则放弃本次队列续发。
            if (chat.queue && chat.queue.length > 0) {
                var self = this;
                chat._stopped = false;
                Store.addLog('info', chat.id, 'stop', '停止当前对话，队列中有 ' + chat.queue.length + ' 条排队消息，即将发送下一条');
                setTimeout(function() {
                    if (!chat._stopped) {
                        self._onSendComplete(chat.el, chat);
                    }
                }, 300);
            } else {
                this._onSendComplete(chat.el, chat);
            }
        },


        // ===== 发送完成后的处理（处理排队消息）=====
        _onSendComplete: function(box, chat) {
            if (chat._sendCompleteCalled) return;
            chat._sendCompleteCalled = true;
            var self = this;
            this.flushQueryPin(box, chat);
            chat.isSending = false;
            chat.abortController = null;
            // 不在此处重置 chat._stopped，由 sendToModel() 重置
            this.updateSendButton(box, chat);
            self.updateMinimap();
            // 【2026 修复】验证轮被中途打断（用户停止/守卫超时/异常结束）时，把卡住的「⏳ 验证中…」按钮还原为可点的「验证」
            try {
                if (!chat.isSending) {
                    box.querySelectorAll('button').forEach(function(_b) {
                        if (_b.textContent.indexOf('验证中') >= 0) {
                            _b.textContent = '验证';
                            _b.disabled = false;
                            _b.style.borderColor = '';
                            _b.style.color = '';
                            _b.style.background = '';
                            _b.style.cursor = '';
                            _b.title = '验证之前一次的任务：立即与 AI 再通话一轮，要求检查 bug 并确认彻底完成';
                        }
                    });
                }
            } catch (e) {}
            // ===== 显示 token 统计信息 =====
            // 【2026 修复】验证轮/继续轮（_verifyRound）结束时不再重复显示「单条/总共」统计，避免出现四条
            if (chat._verifyActive) {
                try { Store.addLog('info', chat.id, 'token-summary-verify', '验证轮结束，不重复显示统计'); } catch(e){}
            } else if (chat._tokenCount && chat._apiCalls && !chat._statsShown) {
                var tokenDuration = chat._tokenStartTime ? Math.round((Date.now() - chat._tokenStartTime) / 1000) : 0;
                // 累计本次耗时
                chat._sessionTotalDuration += tokenDuration;
                var tokenM = (chat._sessionTotalTokens / 1000000).toFixed(1) + 'M';
                // 计算缓存命中率（按会话累计）
                var cacheDenominator = chat._sessionTotalCacheHitTokens + chat._sessionTotalCacheMissTokens || chat._sessionTotalPromptTokens;
                var cacheRate = cacheDenominator > 0
                    ? Math.round(chat._sessionTotalCacheHitTokens / cacheDenominator * 100)
                    : 0;
                // 显示「单条」和「总共」两组统计（token / 缓存命中率 / 调用次数 / 耗时）
                // ===== 单条（本次任务） =====
                var curCacheDen = chat._cacheHitTokens + chat._cacheMissTokens;
                var curCacheRate = curCacheDen > 0
                    ? Math.round(chat._cacheHitTokens / curCacheDen * 100)
                    : 0;
                var curM = (chat._tokenCount / 1000000).toFixed(1) + 'M';
                var formatDuration = function(seconds) {
                    seconds = Math.max(0, Math.round(Number(seconds) || 0));
                    var minutes = Math.floor(seconds / 60);
                    var remainingSeconds = seconds % 60;
                    return minutes > 0 ? minutes + '分' + remainingSeconds + '秒' : remainingSeconds + '秒';
                };
                var curInfo = '单条：' + curM + ' · 缓存' + curCacheRate + '% · ' + chat._apiCalls + '次 · ' + formatDuration(tokenDuration);
                // ===== 总共（会话累计） =====
                var sumInfo = '总共：' + tokenM + ' · 缓存' + cacheRate + '% · ' + chat._sessionTotalApiCalls + '次 · ' + formatDuration(chat._sessionTotalDuration);
                try { self.addMsg(box, curInfo, 'info'); } catch(e){}
                try { self.addMsg(box, sumInfo, 'info'); } catch(e){}
                chat._statsShown = true; // 标记本轮已显示，验证轮/后续完成不再重复
                try { Store.addLog('info', chat.id, 'token-summary', curInfo + '；' + sumInfo); } catch(e){}
                // 保存到数据库（会话累计 → nodes 表持久化，跨刷新保留）
                try {
                    if (typeof Store !== 'undefined' && Store.saveChatBox) {
                        Store.saveChatBox(chat);
                    }
                } catch(e) {
                    console.warn('[Agent] session totals persistence to node failed:', e);
                }
                try {
                    // 任务完成率仅在 task_complete 的终止处记录；此处只保留会话累计数据在节点中，
                    // 避免每次模型请求被误计为一条 success=0 的失败任务。
                } catch(e) {
                    console.warn('[Agent] token stats persistence failed:', e);
                }
            }
            // 如果有排队消息，处理下一条
            // 【2026 修复】用户刚点过"停止"时不自动发送排队消息，防止残留死循环被再次拉起
            if (chat.queue.length > 0 && !chat._stopped) {
                var nextItem = chat.queue.shift();
                this.renderQueue(box, chat);
                // 【修复】取出排队消息后立即恢复「发送中」状态：
                // 避免在 300ms 延迟间隙内，发送按钮闪回空闲（发送图标）、
                // 导航小地图方框脱离工作状态。sendToModel 会重新接管状态。
                chat.isSending = true;
                chat.abortController = null;
                this.updateSendButton(box, chat);
                self.updateMinimap();
                // 延迟一点再发送，避免动画冲突
                setTimeout(function() {
                    // 【修复】排队消息出队发送时注入最新项目上下文（入队时只存了纯文本）
                    var _qText = nextItem.text;
                    try {
                        if (typeof self._buildContextPrefix === 'function') {
                            var _qp = self._buildContextPrefix();
                            if (_qp) _qText = _qp + _qText;
                        }
                    } catch (e) {}
                    self.addMsg(box, nextItem.text, 'user', chat.modelId);
                    self.showQueryPin(box, nextItem.text);
                    self.updateChatTitle(box, nextItem.text);
                    chat.history.push({ role: 'user', content: _qText, _guardInject: !!nextItem._guardInject });
                    Store.addLog('info', chat.id, 'queue-send', '排队消息已发送: ' + nextItem.text.substring(0, 80));
                    self.sendToModel(box, chat);
                }, 300);
            }
            // 延迟重置守卫标志，允许下次发送完成时再次调用
            setTimeout(function() {
                chat._sendCompleteCalled = false;
            }, 1000);
        },

        // ===== 渲染排队区域 =====
        renderQueue: function(box, chat) {
            var self = this;
            var queueEl = box.querySelector('.chatbox-queue');
            if (!queueEl) return;
            if (chat.queue.length === 0) {
                queueEl.style.display = 'none';
                queueEl.innerHTML = '';
                return;
            }
            queueEl.style.display = 'block';
            var html = '<div class="queue-header">\u{1F4DD} 排队消息 (' + chat.queue.length + ')</div>';
            for (var i = 0; i < chat.queue.length; i++) {
                var item = chat.queue[i];
                var preview = item.text.length > 60 ? item.text.substring(0, 60) + '…' : item.text;
                html += '<div class="queue-item" data-qid="' + item.id + '">' +
                    '<span class="queue-num">' + (i + 1) + '</span>' +
                    '<span class="queue-text" title="点击编辑">' + self.escapeHtmlQueue(preview) + '</span>' +
                    '<button class="queue-edit" data-qid="' + item.id + '" title="编辑">\u270F\uFE0F</button>' +
                    '<button class="queue-delete" data-qid="' + item.id + '" title="删除">\u{1F5D1}\uFE0F</button>' +
                    '</div>';
            }
            queueEl.innerHTML = html;

            // 绑定编辑按钮
            queueEl.querySelectorAll('.queue-edit').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var qid = this.getAttribute('data-qid');
                    self.editQueueItem(box, chat, qid);
                });
            });
            // 绑定删除按钮
            queueEl.querySelectorAll('.queue-delete').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var qid = this.getAttribute('data-qid');
                    self.deleteQueueItem(box, chat, qid);
                });
            });
            // 绑定文本点击编辑
            queueEl.querySelectorAll('.queue-text').forEach(function(span) {
                span.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var qid = this.parentNode.getAttribute('data-qid');
                    self.editQueueItem(box, chat, qid);
                });
            });
        },

        // ===== 编辑排队消息 =====
        editQueueItem: function(box, chat, qid) {
            var self = this;
            var item = null;
            for (var i = 0; i < chat.queue.length; i++) {
                if (chat.queue[i].id === qid) { item = chat.queue[i]; break; }
            }
            if (!item) return;
            var queueEl = box.querySelector('.chatbox-queue');
            var itemEl = queueEl.querySelector('[data-qid="' + qid + '"]');
            if (!itemEl) return;
            // 替换为编辑模式
            itemEl.innerHTML =
                '<span class="queue-num">\u270F\uFE0F</span>' +
                '<input class="queue-edit-input" type="text" value="' + self.escapeHtmlQueue(item.text) + '" />' +
                '<button class="queue-save" data-qid="' + qid + '" title="保存">\u2713</button>' +
                '<button class="queue-cancel" data-qid="' + qid + '" title="取消">\u2715</button>';
            var inputEl = itemEl.querySelector('.queue-edit-input');
            if (inputEl) {
                inputEl.focus();
                inputEl.select();
                // Enter 保存
                inputEl.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        var newText = inputEl.value.trim();
                        if (newText) {
                            item.text = newText;
                        }
                        self.renderQueue(box, chat);
                    } else if (e.key === 'Escape') {
                        self.renderQueue(box, chat);
                    }
                });
            }
            // 保存按钮
            var saveBtn = itemEl.querySelector('.queue-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var newText = inputEl.value.trim();
                    if (newText) {
                        item.text = newText;
                    }
                    self.renderQueue(box, chat);
                });
            }
            // 取消按钮
            var cancelBtn = itemEl.querySelector('.queue-cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.renderQueue(box, chat);
                });
            }
        },

        // ===== 删除排队消息 =====
        deleteQueueItem: function(box, chat, qid) {
            for (var i = 0; i < chat.queue.length; i++) {
                if (chat.queue[i].id === qid) {
                    chat.queue.splice(i, 1);
                    break;
                }
            }
            this.renderQueue(box, chat);
            Store.addLog('info', chat.id, 'queue-delete', '排队消息已删除');
        },

        // ===== HTML 转义（排队用）=====
        escapeHtmlQueue: function(text) {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        /**
     * 构建发送给大模型的上下文（本地 history 保留全部，这里只取精简版）
     * 1. 过滤掉 _thinking 消息（思考过程不发给模型）
     * 2. 过滤掉 tool role（工具结果不发给模型）
     * 3. 只保留最近3轮（3个user + 对应assistant回复）
     */
    // ===== 获取项目记忆（用于首条消息注入，给 AI 快速背景） =====
    _getProjectMemory: function(pid) {
        if (!pid) return '';
        try {
            var mem = '';
            // 1. 从 App._projAllProjects 读取（远程加载的项目数据，含 memory_text）
            if (typeof App !== 'undefined' && App._projAllProjects && App._projAllProjects.length) {
                for (var i = 0; i < App._projAllProjects.length; i++) {
                    if (String(App._projAllProjects[i].id) === String(pid)) {
                        mem = App._projAllProjects[i].memory_text || '';
                        break;
                    }
                }
            }
            // 2. 兜底：从 Store.data.projects 读取（本地离线数据）
            if (!mem && typeof Store !== 'undefined' && Store.data && Store.data.projects) {
                for (var j = 0; j < Store.data.projects.length; j++) {
                    if (String(Store.data.projects[j].id) === String(pid)) {
                        mem = Store.data.projects[j].memory_text || '';
                        break;
                    }
                }
            }
            return mem ? String(mem).trim() : '';
        } catch (e) {
            return '';
        }
    },
});
