// ========== app-chatmgr.js - 对话管理 + 小地图更新 ==========
Object.assign(App, {
        // ===== 对话管理工具（供 Tools.execute 调用） =====
        chatManage: function(args) {
            var self = this;
            var action = args.action || 'list';

            if (action === 'list') {
                // 列出所有对话框
                var boxes = self.chatBoxes.map(function(c) {
                    var title = c.el.querySelector('.title') ? c.el.querySelector('.title').textContent : '';
                    return {
                        id: c.id,
                        title: title,
                        modelId: c.modelId || '',
                        isSending: !!c.isSending,
                        historyLen: c.history.length,
                        queueLen: c.queue.length
                    };
                });
                var msg = '当前共有 ' + boxes.length + ' 个对话：\n';
                boxes.forEach(function(b, i) {
                    msg += (i+1) + '. [' + b.id + '] ' + b.title + ' | 模型: ' + (b.modelId || '未选择模型') + ' | 历史: ' + b.historyLen + '条' + (b.isSending ? ' | 发送中' : '') + '\n';
                });
                return { success: true, message: msg, tool: 'chat_manage', data: { boxes: boxes } };
            }

            if (action === 'create') {
                // 新建对话
                var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
                var cRect = canvas.getBoundingClientRect();
                // 如果有现成对话，在最近的右边偏移创建；否则在画布中心
                var lastBox = self.chatBoxes[self.chatBoxes.length - 1];
                var posX, posY;
                if (typeof args.x === 'number' && typeof args.y === 'number') {
                    posX = args.x;
                    posY = args.y;
                } else if (lastBox && lastBox.el) {
                    posX = parseInt(lastBox.el.style.left) + 60;
                    posY = parseInt(lastBox.el.style.top) + 40;
                } else {
                    // 画布可见区域中心
                    posX = Math.max(10, -cRect.left + 100);
                    posY = Math.max(10, -cRect.top + 60);
                }
                // 防散落保护：若目标位置离所有现有窗口都超过3000px（说明坐标异常/画布曾在坏状态下），
                // 改为跟随最靠右的窗口创建，避免新窗口被放到荒地导致"会话分家"
                if (self.chatBoxes.length > 0) {
                    var minDist = Infinity;
                    var rightBox = null, rightX = -Infinity;
                    self.chatBoxes.forEach(function(c) {
                        if (!c.el) return;
                        var bx = parseFloat(c.el.style.left) || 0;
                        var by = parseFloat(c.el.style.top) || 0;
                        var d = Math.max(Math.abs(bx - posX), Math.abs(by - posY));
                        if (d < minDist) minDist = d;
                        if (bx > rightX) { rightX = bx; rightBox = c; }
                    });
                    if (minDist > 3000 && rightBox && rightBox.el) {
                        console.warn('[ChatManage] 检测到新窗口位置异常（离群 ' + Math.round(minDist) + 'px），已自动吸附到主群右侧');
                        posX = (parseFloat(rightBox.el.style.left) || 0) + 60;
                        posY = (parseFloat(rightBox.el.style.top) || 0) + 40;
                    }
                }
                // 转换为客户端坐标
                var clientX = posX + cRect.left;
                var clientY = posY + cRect.top;
                // 模型ID：优先用参数指定的，否则用最后一个对话的模型
                var modelId = args.model_id || (lastBox ? lastBox.modelId : null);

                var chat = self.createChatBox(clientX, clientY, modelId);
                if (!chat) {
                    return { success: false, message: '创建对话失败', tool: 'chat_manage' };
                }

                // 如果 auto_send=true 且有 message，自动发送
                if (args.auto_send && args.message) {
                    var input = chat.el.querySelector('textarea');
                    if (input) {
                        input.value = args.message;
                    }
                    // 模拟发送流程
                    self.addMsg(chat.el, args.message, 'user', chat.modelId);
                    self.showQueryPin(chat.el, args.message);
                    self.updateChatTitle(chat.el, args.message);
                    chat.history.push({ role: 'user', content: args.message });
                    Store.addLog('info', chat.id, 'send', 'chat_manage 自动发送消息');
                    self.sendToModel(chat.el, chat);
                }

                return {
                    success: true,
                    message: '已新建对话 [' + chat.id + ']，模型: ' + (modelId || '未选择模型') + (args.auto_send && args.message ? '，已自动发送消息' : ''),
                    tool: 'chat_manage',
                    data: { chat_id: chat.id }
                };
            }

            if (action === 'close') {
                var targetId = args.chat_id || '';
                if (targetId === 'all') {
                    // 关闭所有对话
                    var count = self.chatBoxes.length;
                    var toClose = self.chatBoxes.slice(); // 复制数组
                    toClose.forEach(function(c) {
                        self.closeChatBox(c);
                    });
                    return { success: true, message: '已关闭所有 ' + count + ' 个对话', tool: 'chat_manage' };
                }
                // 关闭指定对话
                var target = self.chatBoxes.find(function(c) { return c.id === targetId; });
                if (!target) {
                    return { success: false, message: '未找到对话 [' + targetId + ']，可用 list 操作查看所有对话', tool: 'chat_manage' };
                }
                self.closeChatBox(target);
                return { success: true, message: '已关闭对话 [' + targetId + ']', tool: 'chat_manage' };
            }

            if (action === 'move') {
                var moveId = args.chat_id || '';
                var moveChat = self.chatBoxes.find(function(c) { return c.id === moveId; });
                if (!moveChat) {
                    return { success: false, message: '未找到对话 [' + moveId + ']', tool: 'chat_manage' };
                }
                var newX = parseInt(args.x);
                var newY = parseInt(args.y);
                if (isNaN(newX) || isNaN(newY)) {
                    return { success: false, message: 'move 操作需要 x 和 y 参数', tool: 'chat_manage' };
                }
                moveChat.el.style.left = Math.max(0, newX) + 'px';
                moveChat.el.style.top = Math.max(0, newY) + 'px';
                Store.saveChatBox(moveChat);
                self.updateMinimap();
                return { success: true, message: '已移动对话 [' + moveId + '] 到 (' + newX + ', ' + newY + ')', tool: 'chat_manage' };
            }

            if (action === 'send') {
                var sendId = args.chat_id || '';
                var sendChat = self.chatBoxes.find(function(c) { return c.id === sendId; });
                if (!sendChat) {
                    return { success: false, message: '未找到对话 [' + sendId + ']，可用 list 操作查看所有对话', tool: 'chat_manage' };
                }
                var msg = args.message || '';
                if (!msg.trim()) {
                    return { success: false, message: 'send 操作需要 message 参数', tool: 'chat_manage' };
                }
                if (sendChat.isSending) {
                    return { success: false, message: '对话 [' + sendId + '] 正在发送中，请等待完成后再发送', tool: 'chat_manage' };
                }
                // 发送消息（复用 bindChatBox 中的 send 逻辑）
                self.addMsg(sendChat.el, msg, 'user', sendChat.modelId);
                self.showQueryPin(sendChat.el, msg);
                self.updateChatTitle(sendChat.el, msg);
                sendChat.history.push({ role: 'user', content: msg });
                Store.addLog('info', sendChat.id, 'send', 'chat_manage 发送消息: ' + msg.substring(0, 80));
                self.sendToModel(sendChat.el, sendChat);
                return { success: true, message: '已向对话 [' + sendId + '] 发送消息：' + msg.substring(0, 100), tool: 'chat_manage' };
            }

            return { success: false, message: '未知操作: ' + action + '，支持: create, close, move, send, list', tool: 'chat_manage' };
            if (action === 'arrange') {
                // 如果画布上没有对话框，但数据库中有，先恢复
                if ((!self.chatBoxes || self.chatBoxes.length === 0) && typeof Store !== 'undefined' && Store.data && Store.data.chatBoxes && Store.data.chatBoxes.length > 0) {
                    self.restoreSession();
                }

                // 按状态排列所有对话框（发送中→空闲，水平一字排开）
                var boxes = self.chatBoxes;
                if (!boxes || boxes.length === 0) {
                    return { success: true, message: '没有可排列的对话框', tool: 'chat_manage', data: { count: 0 } };
                }

                // 优先使用已有的 arrangeChatBoxes 方法（支持换行等高级功能）
                if (typeof self.arrangeChatBoxes === 'function') {
                    self.arrangeChatBoxes();
                } else {
                    // 后备：内联排列逻辑
                    var sorted = boxes.slice().sort(function(a, b) {
                        if (a.isSending && !b.isSending) return -1;
                        if (!a.isSending && b.isSending) return 1;
                        return (a.createdAt || 0) - (b.createdAt || 0);
                    });
                    var boxWidth = 370, gap = 20, startX = 20, startY = 20;
                    var view = self.canvasGetView ? self.canvasGetView() : { x: 0, y: 0 };
                    sorted.forEach(function(chat, i) {
                        if (!chat.el) return;
                        chat.el.style.left = (startX + i * (boxWidth + gap) - view.x) + 'px';
                        chat.el.style.top = (startY - view.y) + 'px';
                        if (typeof Store !== 'undefined' && Store.saveChatBox) Store.saveChatBox(chat);
                    });
                    if (self._minimapDraw) self._minimapDraw();
                }

                var count = self.chatBoxes.length;
                var sendingCount = self.chatBoxes.filter(function(c) { return c.isSending; }).length;
                var msg = '已按状态排列 ' + count + ' 个对话框';
                if (sendingCount > 0) {
                    msg += '（发送中 ' + sendingCount + ' 个排在前）';
                }
                return { success: true, message: msg, tool: 'chat_manage', data: { count: count, sending: sendingCount } };
            }

            return { success: false, message: '未知操作: ' + action + '，支持: create, close, move, send, list, arrange', tool: 'chat_manage' };
        },

        updateMinimap: function() {
            // 占位 - 实际函数在 setupMinimap 中动态设置
            if (this._mmRaf) return;
            var self = this;
            this._mmRaf = requestAnimationFrame(function() {
                self._mmRaf = 0;
                if (self._minimapDraw) self._minimapDraw();
            });
        },
});
