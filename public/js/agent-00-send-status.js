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
            chat._epoch = (chat._epoch || 0) + 1;   // 【循环代次 2026-09-10】停止换代：挂起的重试链醒来即退出，不再借"意外中止重试"复活成僵尸
            chat._dgUserStopped = Date.now(); // 标记：用户主动停止（小狗守卫用来区分"人为停"和"异常停"）
            if (chat.abortController) {
                try { chat.abortController.abort(); } catch(e) {}
            }
            // 【前后台统一 2026】对账恢复的 sending（重启续跑/断线接管，本地无循环）：
            // 本地 abort 不够，需同步取消池内 Turn，否则服务器侧会继续跑完
            if (chat._poolReconciled && chat._poolSlotId && typeof DB !== 'undefined') {
                try {
                    fetch(DB.BASE_URL + '/api/chat-pool/slot/' + encodeURIComponent(chat._poolSlotId) +
                          '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                       body: JSON.stringify({ turn_id: chat._poolTurnId || '' }) })
                        .catch(function() {});
                } catch(e) {}
                chat._poolReconciled = false;
            }
            chat.isSending = false;
            try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
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
                // 【修复】停止时中止请求会先触发一次 _onSendComplete（置 _sendCompleteCalled=true，
                // 占住收尾守卫约 1 秒）。若在这里同步复位，300ms 等待间隙内旧循环的 catch 错误路径
                // 会再次把它置 true，导致定时器里的续发调用被 `if (_sendCompleteCalled) return` 拦下
                // → 停止后排队消息永远发不出去。故把复位挪进 setTimeout 内部，保证续发必然生效。
                chat._verifyActive = false;
                chat._verifyRoundActive = false;
                Store.addLog('info', chat.id, 'stop', '停止当前对话，队列中有 ' + chat.queue.length + ' 条排队消息，即将发送下一条');
                setTimeout(function() {
                    // 【2026 修复】停止路径置了 _stopped=true，但此续发链不经过 send()（send 里才有复位），
                    // 若不复位，_onSendComplete 的 !chat._stopped 会被拦下 → 停止后排队消息永远发不出
                    chat._stopped = false;
                    if (!chat._stopped) {
                        // 在定时器内复位守卫，避免间隙被旧循环错误路径重新置 true
                        chat._sendCompleteCalled = false;
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
            try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
            chat.abortController = null;
            // 【2026-02 修复】工具动画残留兜底：转圈是 infinite 动画，若某些收尾分支漏删
            // .msg.typing（或多条循环链并发时互相覆盖），会出现「任务已结束动画仍在转/连续多行动画」。
            // 收尾时统一强制清除所有残留的 typing 指示行（含工具球、计时器），后续轮次会重建。
            try {
                if (box) {
                    var _leftTypings = box.querySelectorAll('.msg.typing');
                    _leftTypings.forEach(function(t) {
                        if (t._typingInterval) clearInterval(t._typingInterval);
                        if (t._ttRotate) clearInterval(t._ttRotate);
                        t.remove();
                    });
                }
            } catch (e) {}
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
                            _b.blur(); // 【修复】还原时同样去掉焦点框
                            _b.style.outline = '';
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
                var _T = function(s){ try { return (window.I18N && window.I18N.t) ? window.I18N.t(s) : s; } catch(e){ return s; } };
                var _fmtUnit = function(n, unitKey){
                    // n=数量 unitKey='次'/'分'/'秒'；英文模式下单位翻译（次→calls）
                    var u = _T(unitKey);
                    if (window.I18N && window.I18N.getLang && window.I18N.getLang() === 'en') return ' ' + n + u;
                    return n + u;
                };
                var formatDuration2 = function(seconds){
                    seconds = Math.max(0, Math.round(Number(seconds) || 0));
                    var m = Math.floor(seconds / 60);
                    var s = seconds % 60;
                    if (window.I18N && window.I18N.getLang && window.I18N.getLang() === 'en') {
                        return m > 0 ? m + 'm ' + s + 's' : s + 's';
                    }
                    return m > 0 ? m + '分' + s + '秒' : s + '秒';
                };
                var curInfo = _T('单条：') + curM + ' · ' + _T('缓存') + curCacheRate + '% · ' + _fmtUnit(chat._apiCalls, '次') + ' · ' + formatDuration2(tokenDuration);
                // ===== 总共（会话累计） =====
                var sumInfo = _T('总共：') + tokenM + ' · ' + _T('缓存') + cacheRate + '% · ' + _fmtUnit(chat._sessionTotalApiCalls, '次') + ' · ' + formatDuration2(chat._sessionTotalDuration);
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
                try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
                chat.abortController = null;
                this.updateSendButton(box, chat);
                self.updateMinimap();
                // 延迟一点再发送，避免动画冲突
                setTimeout(function() {
                    // 【修复】排队消息出队发送时注入最新项目上下文（入队时只存了纯文本）
                    var _qText = nextItem.text;
                    try {
                        if (typeof self._buildContextPrefix === 'function') {
                            var _qp = self._buildContextPrefix(chat);
                            if (_qp) _qText = _qp + _qText;
                        }
                    } catch (e) {}
                    self.addMsg(box, nextItem.text, 'user', chat.modelId);
                    // 【增强】排队消息带图：出队后把图片渲染进用户气泡并附到 history
                    var _qUserContent = _qText;
                    if (nextItem.images && nextItem.images.length) {
                        try {
                            var _qBody = box.querySelector('.chatbox-body');
                            var _qLastUser = _qBody ? _qBody.lastElementChild : null;
                            if (_qLastUser && _qLastUser.classList.contains('user')) {
                                var _qImgWrap = document.createElement('span');
                                _qImgWrap.className = 'msg-user-imgs';
                                _qImgWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;';
                                for (var _qi = 0; _qi < nextItem.images.length; _qi++) {
                                    (function(_url) {
                                        var _im = document.createElement('img');
                                        _im.src = _url;
                                        _im.alt = '图片';
                                        _im.style.cssText = 'max-width:180px;max-height:180px;width:auto;height:auto;border-radius:8px;cursor:zoom-in;object-fit:contain;border:1px solid rgba(255,255,255,.15);';
                                        _im.addEventListener('click', function(e) {
                                            e.stopPropagation();
                                            if (typeof App._openImageLightbox === 'function') App._openImageLightbox(_url);
                                        });
                                        _qImgWrap.appendChild(_im);
                                    })(nextItem.images[_qi].dataUrl);
                                }
                                _qLastUser.insertBefore(_qImgWrap, _qLastUser.querySelector('.msg-copy-btn') || _qLastUser.firstChild.nextSibling);
                            }
                        } catch (e) {}
                        var _qParts = [];
                        for (var _qj = 0; _qj < nextItem.images.length; _qj++) {
                            _qParts.push({ type: 'image_url', image_url: { url: nextItem.images[_qj].dataUrl } });
                        }
                        if (nextItem.audio) _qParts.push(nextItem.audio);
                        if (_qText) _qParts.push({ type: 'text', text: _qText });
                        _qUserContent = _qParts;
                    } else if (nextItem.audio) {
                        var _qAparts = [nextItem.audio];
                        if (_qText) _qAparts.push({ type: 'text', text: _qText });
                        _qUserContent = _qAparts;
                    }
                    self.showQueryPin(box, nextItem.text);
                    self.updateChatTitle(box, nextItem.text);
                    chat.history.push({ role: 'user', content: _qUserContent, _guardInject: !!nextItem._guardInject, _verifyRound: !!nextItem._multiVerify, _mvRound: nextItem._mvRound || 0, _mvFinal: !!nextItem._mvFinal });
                    Store.addLog('info', chat.id, 'queue-send', '排队消息已发送: ' + nextItem.text.substring(0, 80));
                    self.sendToModel(box, chat);
                }, 300);
                // 【多轮验证·终审轮】终审总结发出后，在本对话追加一条用户消息 + 开新对话独立终审
                try {
                    if (nextItem._multiVerify && nextItem._mvRound >= 3 && typeof self._mvFinalize === 'function') {
                        self._mvFinalize(box, chat);
                    }
                } catch (e) { console.warn('[multi-verify] finalize fail:', e); }
            }
            // 【2026 修复】任务终结（完成/失败/停止/异常）时清除验证轮标记：
            // 残留的 _verifyActive/_verifyRoundActive 会让下一次「自检 / 审核员 / 继续」
            // 被误判为"当前对话正在运行"而拒绝发起（明明空闲却报错的根因之一）。
            // 注意：放在 token 统计之后，避免影响上方"验证轮结束不重复显示统计"的判定。
            chat._verifyActive = false;
            chat._verifyRoundActive = false;
            chat._verifyBubbleShown = false;
            // 【已移除自动验证】不再自动触发二次/三次验证轮，验证改为用户手动点击按钮发起
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
                var _qImgTag = (item.images && item.images.length) ? ' <span style="opacity:.8">🖼️×' + item.images.length + '</span>' : '';
                html += '<div class="queue-item" data-qid="' + item.id + '">' +
                    '<span class="queue-num">' + (i + 1) + '</span>' +
                    '<span class="queue-text" title="点击编辑">' + self.escapeHtmlQueue(preview) + _qImgTag + '</span>' +
                    '<button class="queue-relay" data-qid="' + item.id + '" title="⚡立即接力：新建对话处理这条消息">⚡</button>' +
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
            // ⚡接力按钮：新建对话处理这条排队消息
            queueEl.querySelectorAll('.queue-relay').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var qid = this.getAttribute('data-qid');
                    self.queueRelayItem(box, chat, qid);
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

        // ===== ⚡排队消息接力：新建对话处理这条排队消息 =====
        // 点击后弹自绘确认提示（非 Windows confirm），确认后：
        //   立刻新建对话框 → 注入原对话全部历史 + 该条排队内容 → 立即发送 → 删除该排队任务
        queueRelayItem: function(box, chat, qid) {
            var self = this;
            var item = null;
            for (var i = 0; i < chat.queue.length; i++) {
                if (chat.queue[i].id === qid) { item = chat.queue[i]; break; }
            }
            if (!item) return;

            var preview = item.text.length > 60 ? item.text.substring(0, 60) + '…' : item.text;
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
            var _esc = function(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
            overlay.innerHTML =
                '<div style="background:var(--panel,#1e1e2e);color:var(--text,#e8e8f0);border:1px solid var(--border,#3a3a4a);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);padding:20px 22px;min-width:340px;max-width:460px;">' +
                '<div style="font-size:15px;font-weight:600;margin-bottom:6px;">\u26A1 接力排队消息到新对话</div>' +
                '<div style="font-size:13px;opacity:.8;margin-bottom:10px;">消息：' + _esc(preview) + '</div>' +
                '<div style="font-size:12px;opacity:.65;margin-bottom:14px;line-height:1.6;">将立刻新建一个对话框，把本对话之前的内容（全部历史）发给它，这条排队消息作为新问题交给它处理；确认后该排队任务会从队列中删除，本对话不受影响。</div>' +
                '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
                '<button data-act="cancel" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#3a3a4a);background:transparent;color:inherit;font-size:13px;cursor:pointer;">取消</button>' +
                '<button data-act="ok" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#3a3a4a);background:var(--accent,#4a6cf7);color:#fff;font-size:13px;cursor:pointer;">\u26A1 确认接力</button>' +
                '</div></div>';
            function close() { try { overlay.remove(); } catch (e) {} }
            overlay.addEventListener('click', function(e) {
                var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
                if (!btn) { if (e.target === overlay) close(); return; }
                close();
                if (btn.dataset.act !== 'ok') return;

                // 1. 立刻新建对话框（继承模型，位置偏移）
                var srcModelId = chat.modelId;
                var r = box.getBoundingClientRect();
                var newBox = null;
                try { newBox = App.createChatBox(Math.round(r.left + 46), Math.round(r.top + 46), srcModelId); } catch (err) {}
                if (!newBox) { self._showQueueRelayToast(box, '新建对话失败（可能达到画布上限）'); return; }
                try {
                    if (chat._modelIdOverride) newBox._modelIdOverride = chat._modelIdOverride;
                    if (chat._reasoningEffort) newBox._reasoningEffort = chat._reasoningEffort;
                } catch (e2) {}
                if (newBox.el) newBox = newBox.el;

                // 2. 构建 prompt：之前的内容（全部历史）+ 新问题（排队消息）
                var h = (chat && Array.isArray(chat.history)) ? chat.history : [];
                var lines = [];
                lines.push('===== \u{1F504} 排队接力（你继承原对话全部上下文）=====');
                lines.push('以下【原对话完整记录】是此前全部沟通内容，请视为你自己经历过的对话：');
                lines.push('');
                for (var j = 0; j < h.length; j++) {
                    var m = h[j];
                    if (!m || !m.role) continue;
                    if (m.role === 'tool' || m.role === '_thinking') continue;
                    var who = m.role === 'user' ? '用户' : 'AI';
                    var t = (typeof m.content === 'string') ? m.content : (m.content ? JSON.stringify(m.content) : '');
                    if (!t) continue;
                    if (t.length > 4000) t = t.substring(0, 4000) + '…[已截断]';
                    lines.push('【' + who + '】' + t);
                    lines.push('');
                }
                lines.push('===== 接力记录结束 =====');
                lines.push('');
                lines.push('【本次新问题】（请直接处理，不要重复已完成的工作）：');
                lines.push(item.text);
                var prompt = lines.join('\n');

                // 3. 等新对话就绪后立即发送
                var attempts = 0;
                (function trySend() {
                    attempts++;
                    var newChat = null;
                    for (var k = 0; k < (App.chatBoxes || []).length; k++) {
                        if (App.chatBoxes[k].id === newBox.id) { newChat = App.chatBoxes[k]; break; }
                    }
                    if (newChat && !newChat.isSending && attempts < 20) {
                        try {
                            App.addMsg(newBox, item.text, 'user', newChat.modelId);
                        } catch (e3) {}
                        newChat.history.push({ role: 'user', content: prompt });
                        try { App.updateChatTitle(newBox, '\u26A1 ' + (chat.el && chat.el.querySelector('.title') ? chat.el.querySelector('.title').textContent : '排队接力') + ' · 接力'); } catch (e5) {}
                        App.sendToModel(newBox, newChat);
                        try { App.activate(newBox); } catch (e6) {}

                        // 4. 从排队队列删除该任务
                        for (var d = 0; d < chat.queue.length; d++) {
                            if (chat.queue[d].id === qid) { chat.queue.splice(d, 1); break; }
                        }
                        self.renderQueue(box, chat);
                        try { Store.addLog('info', chat.id, 'queue-relay', '排队消息已接力到新对话 [' + newBox.id + ']: ' + item.text.substring(0, 80)); } catch (e7) {}
                        self._showQueueRelayToast(box, '\u26A1 已接力到新对话：历史内容 + 该条消息已发送，排队任务已删除');
                    } else if (attempts < 20) {
                        setTimeout(trySend, 300);
                    } else {
                        self._showQueueRelayToast(box, '接力启动超时，排队任务保留，可重试');
                    }
                })();
            });
            document.body.appendChild(overlay);
        },

        // ⚡接力用的轻提示（自绘，不用 Windows confirm/alert）
        _showQueueRelayToast: function(box, msg) {
            try {
                var t = document.createElement('div');
                t.textContent = msg;
                t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:100002;background:var(--panel,#1e1e2e);color:var(--text,#e8e8f0);border:1px solid var(--border,#3a3a4a);border-radius:8px;padding:10px 18px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.4);font-family:system-ui,sans-serif;';
                document.body.appendChild(t);
                setTimeout(function() { try { t.remove(); } catch (e) {} }, 3000);
            } catch (e) { console.log('[QueueRelay]', msg); }
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
            // 【缓存优化】去掉"生成时间"等易变行：时间戳一旦刷新会导致 system 前缀逐字节变化，
            // 使其后所有消息的 prompt cache 全部失效。时间只在存储端记录，不再注入请求。
            return mem ? String(mem).trim()
                .replace(/^\s*生成时间[:：].*$/gm, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim() : '';
        } catch (e) {
            return '';
        }
    },
});
