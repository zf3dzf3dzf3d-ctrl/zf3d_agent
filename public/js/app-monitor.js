// ========== app-monitor.js - 监控轮询 + 关于弹窗 + 启动 ==========
Object.assign(App, {

        // ===== 监控轮询器 =====
        _monitorTimer: null,
        _monitorPolling: false,

        startMonitorPoll: function() {
            var self = this;
            // 热更新安全：清理幽灵定时器
            if (self._monitorTimer) { clearInterval(self._monitorTimer); self._monitorTimer = null; }
            if (window.__monitorTimer) { clearInterval(window.__monitorTimer); window.__monitorTimer = null; }
            self._monitorTimer = setInterval(function() {
                self._monitorPoll();
            }, 3000);  // 每 3 秒检查一次
            window.__monitorTimer = self._monitorTimer;
            // 立即执行一次
            self._monitorPoll();
        },

        stopMonitorPoll: function() {
            if (this._monitorTimer) {
                clearInterval(this._monitorTimer);
                this._monitorTimer = null;
                console.log('[Monitor] 轮询器已停止');
            }
        },

        // 聊天窗口数量硬上限（防监控风暴无限新建撑爆画布）
        MONITOR_MAX_CHAT: 40,

        // ===== 合并排队消息到新窗口 =====
        // 当目标窗口忙碌时，把排队消息合并成一条，连同上下文一起发送到新窗口
        // [防风暴熔断] 聊天窗口数达上限时不再新建，丢弃排队消息，避免无限撑爆画布
        _mergeQueueToNewWindow: function(chat_id, queueItems) {
            var self = this;
            // ===== 防风暴熔断：窗口数达上限则丢弃排队消息，停止新建 =====
            var curCount = self.chatBoxes ? self.chatBoxes.length : 0;
            var maxChat = self.MONITOR_MAX_CHAT || 40;
            if (curCount >= maxChat) {
                console.warn('[Monitor] 聊天窗口已达上限(' + curCount + '/' + maxChat + ')，丢弃 ' + (queueItems||[]).length + ' 条排队消息，熔断阻止风暴');
                (queueItems || []).forEach(function(item) {
                    fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                });
                try { Store.addLog('warn', chat_id, 'queue-merge-blocked', '窗口数达上限(' + curCount + ')，熔断阻止自动新建'); } catch(e) {}
                return;
            }
            var targetChat = self.chatBoxes.find(function(c) { return c.id === chat_id; });

            // 确定新窗口位置：在原窗口右侧偏下
            var cx, cy, modelId;
            if (targetChat) {
                var rect = targetChat.el.getBoundingClientRect();
                cx = rect.right + 30;
                cy = rect.top + 60;
                modelId = targetChat.modelId;
            } else {
                cx = window.innerWidth / 2;
                cy = window.innerHeight / 2;
                modelId = null;
            }

            // 创建新窗口
            var newChat = self.createChatBox(cx, cy, modelId);
            if (!newChat) return;

            // 清除新窗口的默认欢迎消息
            var body = newChat.el.querySelector('.chatbox-body');
            if (body) body.innerHTML = '';
            newChat.history = [];

            // 复制原窗口最近的上下文到新窗口（最近10条 user/assistant 消息）
            if (targetChat && targetChat.history && targetChat.history.length > 0) {
                var recentHistory = targetChat.history.slice(-10);
                recentHistory.forEach(function(m) {
                    if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
                        var whoCls = (m.role === 'user' ? 'user' : 'ai');
                        // addMsg 内部已调用 setMsgContent，不需要额外调用
                        self.addMsg(newChat.el, m.content, whoCls, newChat.modelId);
                        newChat.history.push({ role: m.role, content: m.content });
                    }
                });
            }

            // 合并排队消息为一条
            var mergedMessage;
            if (queueItems.length === 1) {
                mergedMessage = queueItems[0].message;
            } else {
                var lines = [];
                for (var i = 0; i < queueItems.length; i++) {
                    lines.push('[' + (i + 1) + '] ' + queueItems[i].message);
                }
                mergedMessage = '\n\n---\n\n以下是需要处理的多个消息，请逐一响应：\n\n' + lines.join('\n\n');
            }

            // 发送合并消息到新窗口
            self.addMsg(newChat.el, mergedMessage, 'user', newChat.modelId);
            self.showQueryPin(newChat.el, mergedMessage);
            self.updateChatTitle(newChat.el, mergedMessage);
            newChat.history.push({ role: 'user', content: mergedMessage });
            Store.addLog('info', newChat.id, 'send', '队列合并→新窗口: ' + mergedMessage.substring(0, 80));
            self.sendToModel(newChat.el, newChat);

            // 删除所有已合并的排队消息
            queueItems.forEach(function(item) {
                fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
            });

            Store.addLog('info', chat_id, 'queue-merge',
                '合并 ' + queueItems.length + ' 条排队消息到新窗口 ' + newChat.id);

            console.log('[Monitor] 队列合并: ' + queueItems.length + ' 条消息 → 新窗口 ' + newChat.id);
        },

        _monitorPoll: function() {
            var self = this;
            if (self._monitorPolling) return;  // 防止重叠
            self._monitorPolling = true;
            var ownedChatIds = (self.chatBoxes || []).map(function(chat) { return chat.id; });
            if (ownedChatIds.length === 0) { self._monitorPolling = false; return; }
            var pollQuery = ownedChatIds.map(function(id) { return 'chat_id=' + encodeURIComponent(id); }).join('&');
            fetch('/api/monitor/poll?' + pollQuery)
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (!data || !data.ok || !data.items || data.items.length === 0) {
                        self._monitorPolling = false;
                        return;
                    }

                    // ===== 按 chat_id 分组排队消息 =====
                    var groups = {};
                    data.items.forEach(function(item) {
                        if (!groups[item.chat_id]) groups[item.chat_id] = [];
                        groups[item.chat_id].push(item);
                    });

                    // [防风暴] 单轮内新建窗口数上限，避免一轮 poll 并发新建多个窗口
                    var maxPerRound = 3;
                    var createdInRound = 0;

                    Object.keys(groups).forEach(function(chatId) {
                        var items = groups[chatId];
                        var targetChat = self.chatBoxes.find(function(c) { return c.id === chatId; });

                        // [防风暴] 聊天窗口总数已达上限 → 本轮不再新建，直接丢弃所有排队消息
                        var curCount = self.chatBoxes ? self.chatBoxes.length : 0;
                        if (curCount >= (self.MONITOR_MAX_CHAT || 40)) {
                            (items || []).forEach(function(item) {
                                fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                            });
                            return;
                        }

                        if (!targetChat) {
                            // [风暴修复] 窗口已被用户手动关闭 → 丢弃排队消息，不再自动新建窗口
                            // 旧逻辑（窗口不存在就新建接续）曾导致批量"继续"窗口风暴
                            (items || []).forEach(function(item) {
                                fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                            });
                            console.log('[Monitor] 窗口 ' + chatId + ' 已不存在（已关闭），丢弃 ' + items.length + ' 条排队消息');
                            try { Store.addLog('info', chatId, 'queue-drop', '窗口已关闭，丢弃 ' + items.length + ' 条排队消息（不自动新建）'); } catch(e) {}
                            return;
                        }

                        // ===== 智能调度：忙时合并到新窗口，闲时直接处理 =====
                        if (targetChat.isSending) {
                            // 窗口忙 → 合并排队消息到新窗口（避免排队等待）
                            if (createdInRound >= maxPerRound) {
                                (items || []).forEach(function(item) {
                                    fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                                });
                                return;
                            }
                            // [风暴修复] 窗口忙碌 → 消息留队列，下一轮再投递（不再新建分流窗口）
                            console.log('[Monitor] 窗口 ' + chatId + ' 忙碌，' + items.length + ' 条消息留队列等待下一轮');
                        } else {
                            // 窗口闲 → 只处理第一条，其余留着等下一轮
                            var firstItem = items[0];
                            var msg = firstItem.message;
                            self.addMsg(targetChat.el, msg, 'user', targetChat.modelId);
                            self.showQueryPin(targetChat.el, msg);
                            self.updateChatTitle(targetChat.el, msg);
                            targetChat.history.push({ role: 'user', content: msg });
                            Store.addLog('info', targetChat.id, 'send', '监控轮询触发消息: ' + msg.substring(0, 80));
                            self.sendToModel(targetChat.el, targetChat);
                            // 标记为已处理（从队列删除）
                            fetch('/api/monitor/poll/' + encodeURIComponent(firstItem.key) + '?chat_id=' + encodeURIComponent(firstItem.chat_id), { method: 'DELETE' });
                            // 如果还有多余的排队消息（窗口刚闲下来但积了多条），
                            // 留到下一轮处理（此时窗口又忙了，下一轮会触发合并）
                        }
                    });

                    self._monitorPolling = false;
                })
                .catch(function(err) {
                    self._monitorPolling = false;
                    // 静默失败，下轮重试
                });
        },
});

// ===== 关于弹窗 =====
    // ===== 关于弹窗 =====
    function openAbout() {
        document.getElementById('settingsOverlay').classList.add('show');
        App.switchSettingsTab('about');
    }

    // 启动
    App.init();
