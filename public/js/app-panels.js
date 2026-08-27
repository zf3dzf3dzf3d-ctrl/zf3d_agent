// ========== app-panels.js - 设置/日志/复制/模型管理 ==========
Object.assign(App, {
        // ===== 设置面板 =====
        setupSettings: function() {
            var self = this;
            document.getElementById('email-enabled') && document.getElementById('email-enabled').addEventListener('change', function() { App._updateEmailToggle(); });
            // 健康守护模式事件
            document.getElementById('health-interval') && document.getElementById('health-interval').addEventListener('input', function() { App._updateHealthSliderLabels(); });
            document.getElementById('health-lock-hours') && document.getElementById('health-lock-hours').addEventListener('input', function() { App._updateHealthSliderLabels(); });
            document.getElementById('health-lock-minutes') && document.getElementById('health-lock-minutes').addEventListener('input', function() { App._updateHealthSliderLabels(); });
            var projBtn = document.getElementById('projectBtn');
            // 项目按钮由 app-project.js 统一绑定，避免重复切换导致面板打开后立即关闭。
            var settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn) settingsBtn.addEventListener('click', function() {
                self.openSettingsPanel('models');
            });
            var statusModelTrigger = document.getElementById('status-model-trigger');
            if (statusModelTrigger) statusModelTrigger.addEventListener('click', function() {
                self.openSettingsPanel('models');
            });
        },

        openSettingsPanel: function(tab) {
            var overlay = document.getElementById('settingsOverlay');
            if (!overlay) return;
            overlay.classList.add('show');
            this.switchSettingsTab(tab || 'models');
        },

        // ===== 设置面板 Tab 切换 =====
        switchSettingsTab: function(tab) {
            var self = this;
            tab = String(tab || 'models').replace(/^settingsPanel-/, '');
            var targetId = 'settingsPanel-' + tab;
            var targetPanel = document.getElementById(targetId);
            // Accept callers that pass the full panel id.
            if (!targetPanel && tab && tab.indexOf('settingsPanel-') === 0) {
                targetId = tab;
                targetPanel = document.getElementById(targetId);
                tab = targetId.slice('settingsPanel-'.length);
            }
            if (!targetPanel) {
                var fallbackPanel = document.querySelector('.settings-panel');
                if (fallbackPanel) fallbackPanel.classList.add('active');
                return;
            }
            document.querySelectorAll('.settings-nav-item').forEach(function(item) {
                item.classList.toggle('active', item.dataset.settingsTab === tab);
            });
            document.querySelectorAll('.settings-panel').forEach(function(panel) {
                panel.classList.toggle('active', panel.id === targetId);
            });
            if (tab === 'models') {
                // 关键：Models.load() 是异步的（GET 后端 JSON）。
                // 如果用户首次点开设置时 Models 还没加载完，
                // 直接 renderModelList() 会看到空 list，显示"尚未配置"。
                // 这里确保等 load 完再 render。
                // [v2 接管] 如果新版 app-models.js 已经接管了模型设置面板的渲染，
                // 就跳过这里的旧版 renderModelList()，避免两个版本抢同一个 #modelList。
                if (window.ModelConfigRewrite && typeof window.ModelConfigRewrite.mount === 'function') {
                    var modelMount = document.getElementById('modelPanelMount');
                    if (modelMount && !modelMount.querySelector('[data-mc-wrap]')) {
                        window.ModelConfigRewrite.mount(modelMount);
                    } else if (window.ModelConfigRewrite.refresh) {
                        window.ModelConfigRewrite.refresh().catch(function(error) {
                            console.warn('[模型配置] 刷新失败', error);
                        });
                    }
                } else if (window.__modelListV2Init) {
                    // 新版会在 tab 切换时自己 load + render，
                    // 这里什么都不做；下拉菜单刷新交给新版。
                    if (window.ModelSettingsV2 && window.ModelSettingsV2.refreshAllSelects) {
                        try { window.ModelSettingsV2.refreshAllSelects(); } catch(ex) { console.warn('[v2] refreshAllSelects failed', ex); }
                    }
                    if (window.ModelSettingsV2 && window.ModelSettingsV2.ensureLoaded) {
                        try { window.ModelSettingsV2.ensureLoaded(); } catch(ex) {}
                    }
                } else {
                    var renderAfterLoad = function() {
                        self.renderModelList();
                    };
                    if (Models._loaded) {
                        renderAfterLoad();
                    } else {
                        Models.load().then(renderAfterLoad).catch(renderAfterLoad);
                    }
                }
            } else if (tab === 'logs') {
                this.switchTab(this._panelTab || 'log');
            } else if (tab === 'email') {
                this.loadEmailConfig();
            } else if (tab === 'backup') {
                this.renderBackupList();
            } else if (tab === 'health') {
                this.loadHealthConfig();
            } else if (tab === 'tools') {
                // 工具设置：首次打开时初始化渲染
                if (typeof window.ToolsSettings !== 'undefined' && typeof window.ToolsSettings.init === 'function') {
                    window.ToolsSettings.init();
                }
            }
        },

        // ===== 日志面板 =====
        setupLogPanel: function() {
            // logBtn 已移入左侧导航，无需单独绑定
        },

        // ===== 面板状态 =====
        _panelTab: 'log',

        showLogPanel: function(tab) {
            this._panelTab = tab || 'log';
            var overlay = document.getElementById('settingsOverlay');
                if (!overlay) return;
                overlay.classList.add('show');
            this.switchSettingsTab('logs');
        },

        switchTab: function(tab) {
            this._panelTab = tab;
            var tabLog = document.getElementById('tabLog');
            var tabChat = document.getElementById('tabChat');
            if (tab === 'log') {
                tabLog.classList.remove('ghost');
                tabChat.classList.add('ghost');
                this._renderLogTab();
            } else {
                tabChat.classList.remove('ghost');
                tabLog.classList.add('ghost');
                this._renderChatTab();
            }
        },

        _renderLogTab: function() {
            var content = document.getElementById('logContent');
            var footer = document.getElementById('panelFooter');
            var logs = Store.getLogs();
            var html = '';

            var errorCount = logs.filter(function(l) { return l.level === 'error'; }).length;
            var warnCount = logs.filter(function(l) { return l.level === 'warn'; }).length;
            var infoCount = logs.filter(function(l) { return l.level === 'info'; }).length;
            html += '<div style="margin-bottom:8px;font-size:12px;color:var(--text2);">' +
                '共 ' + logs.length + ' 条日志 · ' +
                '<span style="color:#28a745;">info:' + infoCount + '</span> · ' +
                '<span style="color:#ffc107;">warn:' + warnCount + '</span> · ' +
                '<span style="color:#f44336;">error:' + errorCount + '</span>' +
                '</div>';

            if (logs.length === 0) {
                html += '<div style="text-align:center;padding:40px 0;color:var(--text2);">暂无日志记录</div>';
            } else {
                logs.slice().reverse().forEach(function(l) {
                    var time = new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false });
                    var ms = new Date(l.ts).getMilliseconds();
                    var levelColor = l.level === 'error' ? '#f44336' : (l.level === 'warn' ? '#ffc107' : '#28a745');
                    var levelIcon = l.level === 'error' ? '❌' : (l.level === 'warn' ? '⚠️' : '✅');
                    html += '<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:11px;font-family:monospace;line-height:1.6;">' +
                        '<span style="color:var(--text2);">' + time + '.' + String(ms).padStart(3,'0') + '</span> ' +
                        '<span style="color:' + levelColor + ';">' + levelIcon + ' [' + l.level + ']</span> ' +
                        (l.boxId ? '<span style="color:#5599ff;">[' + l.boxId + ']</span> ' : '') +
                        '<span style="color:#aaa;">' + l.action + '</span> ' +
                        '<span style="color:var(--text);">' + (l.detail || '') + '</span>' +
                    '</div>';
                });
            }
            content.innerHTML = html;
            footer.innerHTML = '<button class="btn ghost" style="font-size:11px;padding:4px 10px;" onclick="App.copyLogs()">📋 复制日志</button>' +
                '<button class="btn ghost" style="font-size:11px;padding:4px 10px;" onclick="App.clearLogs()">清空日志</button>';
        },

        _renderChatTab: function() {
            var self = this;
            var content = document.getElementById('logContent');
            var footer = document.getElementById('panelFooter');
            var html = '';

            if (this.chatBoxes.length === 0) {
                html += '<div style="text-align:center;padding:40px 0;color:var(--text2);">暂无对话框</div>';
            } else {
                this.chatBoxes.forEach(function(chat) {
                    var msgs = Store.getMessages(chat.id);
                    var modelName = chat.modelId ? (Models.get(chat.modelId) ? Models.get(chat.modelId).name : chat.modelId) : '未选择模型';
                    html += '<div style="margin-bottom:12px;border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
                        '<div style="padding:6px 10px;background:var(--border);font-size:12px;display:flex;align-items:center;justify-content:space-between;">' +
                            '<span><span style="color:#5599ff;">[' + chat.id + ']</span> ' + modelName + ' · ' + msgs.length + ' 条消息</span>' +
                            '<button class="btn ghost" style="font-size:10px;padding:2px 8px;" onclick="App.copyChat(\'' + chat.id + '\')">📋</button>' +
                        '</div>';
                    if (msgs.length === 0) {
                        html += '<div style="padding:8px 10px;font-size:11px;color:var(--text2);">（空）</div>';
                    } else {
                        msgs.forEach(function(m) {
                            var role = m.role === 'user' ? '🧑' : (m.role === 'error' ? '❌' : '🤖');
                            var preview = (m.content || '').substring(0, 120);
                            if ((m.content || '').length > 120) preview += '...';
                            html += '<div style="padding:4px 10px;border-bottom:1px solid var(--border);font-size:11px;line-height:1.5;">' +
                                role + ' <span style="color:var(--text2);">' + preview + '</span>' +
                            '</div>';
                        });
                    }
                    html += '</div>';
                });
            }
            content.innerHTML = html;
            footer.innerHTML = '<button class="btn ghost" style="font-size:11px;padding:4px 10px;" onclick="App.copyAllChats()">📋 复制全部对话</button>';
        },

        clearLogs: function() {
            Store.data.logs = [];
            Store._saveLocal();
            this._renderLogTab();
        },

        // ===== 健康守护 =====
        showHealthSettings: function() {
            var overlay = document.getElementById('settingsOverlay');
                if (!overlay) return;
                overlay.classList.add('show');
            this.switchSettingsTab('health');
        },

        loadHealthConfig: function() {
            var self = this;
            if (typeof HealthGuard === 'undefined') return;
            var cfg = HealthGuard._config;
            var interval = document.getElementById('health-interval');
            var lockHours = document.getElementById('health-lock-hours');
            var lockMinutes = document.getElementById('health-lock-minutes');
            if (interval) interval.value = cfg.intervalMinutes || 30;
            if (lockHours) lockHours.value = cfg.forceLockHours || 4;
            if (lockMinutes) lockMinutes.value = cfg.forceLockMinutes || 10;
            self._updateHealthSliderLabels();
            self._updateHealthStatusDisplay();
        },

        saveHealthConfig: function() {
            var self = this;
            var config = {
                intervalMinutes: parseInt(document.getElementById('health-interval').value),
                forceLockHours: parseInt(document.getElementById('health-lock-hours').value),
                forceLockMinutes: parseInt(document.getElementById('health-lock-minutes').value)
            };
            if (typeof HealthGuard !== 'undefined') {
                HealthGuard.saveConfig(config, function(ok) {
                    if (ok) {
                        App._toast('✅ 健康配置已保存', 'ok');
                        App._updateHealthStatusDisplay();
                    } else {
                        App._toast('❌ 保存失败', 'err');
                    }
                });
            }
        },

        _updateHealthSliderLabels: function() {
            var iv = parseInt(document.getElementById('health-interval').value);
            var lh = parseInt(document.getElementById('health-lock-hours').value);
            var lm = parseInt(document.getElementById('health-lock-minutes').value);
            var ivLabel = document.getElementById('health-interval-value');
            var lhLabel = document.getElementById('health-lock-hours-value');
            var lmLabel = document.getElementById('health-lock-minutes-value');
            if (ivLabel) ivLabel.textContent = iv + ' 分钟';
            if (lhLabel) lhLabel.textContent = lh + ' 小时';
            if (lmLabel) lmLabel.textContent = lm + ' 分钟';
            var tipI = document.getElementById('health-tip-interval');
            var tipH = document.getElementById('health-tip-hours');
            var tipM = document.getElementById('health-tip-minutes');
            if (tipI) tipI.textContent = iv;
            if (tipH) tipH.textContent = lh;
            if (tipM) tipM.textContent = lm;
        },

        _updateHealthStatusDisplay: function() {
            var detail = document.getElementById('healthStatusDetail');
            if (!detail || typeof HealthGuard === 'undefined') return;
            var nextRest = (HealthGuard._config.intervalMinutes || 30) - Math.floor((Date.now() - HealthGuard._lastRestTime) / 60000);
            if (HealthGuard._isLocked) {
                var remain = Math.ceil(HealthGuard.getLockRemaining() / 60);
                detail.textContent = '强制休息中 (剩余 ' + remain + ' 分钟)';
            } else {
                detail.textContent = '下次提醒: ' + Math.max(0, nextRest) + ' 分钟后';
            }
        },

        _testHealthReminder: function() {
            if (typeof HealthGuard === 'undefined') {
                this._toast('HealthGuard 未加载', 'err');
                return;
            }
            var result = document.getElementById('healthTestResult');
            if (result) result.innerHTML = '<div style="color:#ffc107;font-size:12px;">✨ 测试弹出中...</div>';
            HealthGuard._showRestModal(false);
            if (result) result.innerHTML = '<div style="color:#28a745;font-size:12px;">✅ 弹出已显示，检查体操动画</div>';
        },

        // ===== 一键复制工具函数 =====
        _copyToClipboard: function(text, label) {
            // 优先用 execCommand('copy')，HTTP 环境下 navigator.clipboard 会挂起
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            if (ok) {
                this._toast('✅ ' + label + '已复制到剪贴板', 'ok');
                return;
            }
            // execCommand 失败才尝试 clipboard API（加 2 秒超时保护）
            if (navigator.clipboard && navigator.clipboard.writeText) {
                var self = this;
                var done = false;
                var timer = setTimeout(function() {
                    if (!done) { done = true; self._toast('❌ 复制超时', 'err'); }
                }, 2000);
                navigator.clipboard.writeText(text).then(function() {
                    if (!done) { done = true; clearTimeout(timer); self._toast('✅ ' + label + '已复制到剪贴板', 'ok'); }
                }).catch(function() {
                    if (!done) { done = true; clearTimeout(timer); self._toast('❌ 复制失败', 'err'); }
                });
            } else {
                this._toast('❌ 复制失败', 'err');
            }
        },
        _toast: function(msg, type) {
            var el = document.createElement('div');
            el.textContent = msg;
            var bg = type === 'ok' ? '#28a745' : type === 'err' ? '#f44336' : '#3b82f6';
            el.style.cssText =
                'padding:8px 20px;border-radius:6px;font-size:13px;font-weight:bold;' +
                'background:' + bg + ';color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.3);';
            // 使用全局 ToastStack（左下角堆叠排列）
            if (window.ToastStack) {
                window.ToastStack.show(el, 2000);
            } else {
                el.style.cssText += 'position:fixed;bottom:16px;left:16px;z-index:99999;transition:opacity .3s;';
                document.body.appendChild(el);
                setTimeout(function() { el.style.opacity = '0'; }, 1500);
                setTimeout(function() { if(el.parentNode) el.parentNode.removeChild(el); }, 1800);
            }
        },

        // ===== 复制日志 =====
        copyLogs: function() {
            var logs = Store.getLogs();
            if (logs.length === 0) { this._toast('暂无日志', 'err'); return; }
            var text = logs.map(function(l) {
                var d = new Date(l.ts);
                return d.toLocaleString('zh-CN', { hour12: false }) + ' | ' + l.level + ' | ' + l.boxId + ' | ' + l.action + ' | ' + l.detail;
            }).join('\n');
            this._copyToClipboard(text, '日志(' + logs.length + '条) ');
            Store.addLog('info', '', 'copy', '复制日志 ' + logs.length + ' 条');
        },

        // ===== 格式化消息列表用于导出（连续工具调用折叠为一个块） =====
        _formatMsgsForExport: function(msgs) {
            var text = '';
            var toolGroup = [];  // 收集连续的工具调用

            function flushToolGroup() {
                if (toolGroup.length === 0) return;
                var firstTs = new Date(toolGroup[0].ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
                text += '[' + firstTs + '] 🔧 工具调用 (' + toolGroup.length + '次):\n';
                toolGroup.forEach(function(m) {
                    text += '  ' + (m.content || '') + '\n';
                });
                text += '\n';
                toolGroup = [];
            }

            msgs.forEach(function(m) {
                var isTool = (m.type === 'tool' || m.type === 'tool_call' || m.role === 'tool_call');
                if (isTool) {
                    toolGroup.push(m);
                } else {
                    flushToolGroup();
                    var role = m.role === 'user' ? '🧑 用户' : (m.role === 'error' ? '❌ 错误' : '🤖 AI');
                    text += '[' + new Date(m.ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + role + ':\n' + (m.content || '') + '\n\n';
                }
            });
            flushToolGroup();
            return text;
        },

        // ===== 复制全部（对话+日志 一键完整调试报告） =====
        copyAll: function() {
            var self = this;
            var logs = Store.getLogs();
            var totalMsgs = 0;

            var text = '╔══════════════════════════════════════════╗\n';
            text += '║  朱峰社区无限智能体 - 完整调试报告          ║\n';
            text += '╚══════════════════════════════════════════╝\n';
            text += '导出时间: ' + new Date().toLocaleString('zh-CN', { hour12: false }) + '\n';
            text += '对话框数: ' + this.chatBoxes.length + '\n';
            text += '日志条数: ' + logs.length + '\n';
            text += '════════════════════════════════════════════\n\n';

            // ---- 第一部分：全部对话 ----
            text += '【一】对话记录\n';
            text += '────────────────────────────────────────────\n\n';
            if (this.chatBoxes.length === 0) {
                text += '（暂无对话框）\n\n';
            } else {
                this.chatBoxes.forEach(function(chat) {
                    var msgs = Store.getMessages(chat.id);
                    totalMsgs += msgs.length;
                    var modelName = chat.modelId ? (Models.get(chat.modelId) ? Models.get(chat.modelId).name : chat.modelId) : '未选择模型';
                    text += '── 对话框: ' + chat.id + ' | 模型: ' + modelName + ' | 消息数: ' + msgs.length + ' ──\n\n';
                    if (msgs.length === 0) {
                        text += '（空）\n\n';
                    } else {
                        text += self._formatMsgsForExport(msgs);
                    }
                });
            }

            // ---- 第二部分：全部日志 ----
            text += '════════════════════════════════════════════\n';
            text += '【二】运行日志\n';
            text += '────────────────────────────────────────────\n\n';
            if (logs.length === 0) {
                text += '（暂无日志）\n';
            } else {
                logs.forEach(function(l) {
                    var d = new Date(l.ts);
                    text += d.toLocaleString('zh-CN', { hour12: false }) + ' | ' + l.level + ' | ' + (l.boxId || '-') + ' | ' + l.action + ' | ' + (l.detail || '') + '\n';
                });
            }

            text += '\n════════════════════════════════════════════\n';
            text += '报告结束 · 对话' + totalMsgs + '条 · 日志' + logs.length + '条\n';

            this._copyToClipboard(text, '完整报告(对话' + totalMsgs + '+日志' + logs.length + '条) ');
            Store.addLog('info', '', 'copy', '复制全部: 对话' + totalMsgs + '条 + 日志' + logs.length + '条');
        },

        // ===== 复制单个对话框对话 =====
        copyChat: function(chatId) {
            var chat = this.chatBoxes.find(function(c) { return c.id === chatId; });
            if (!chat) return;
            var msgs = Store.getMessages(chatId);
            if (msgs.length === 0) { this._toast('暂无对话内容', 'err'); return; }
            var modelName = chat.modelId ? (Models.get(chat.modelId) ? Models.get(chat.modelId).name : chat.modelId) : '未选择模型';
            var text = '=== 朱峰社区无限智能体 - 对话记录 ===\n';
            text += '对话框ID: ' + chatId + '\n';
            text += '模型: ' + modelName + '\n';
            text += '时间: ' + new Date().toLocaleString('zh-CN') + '\n';
            text += '消息数: ' + msgs.length + '\n';
            text += '=========================================\n\n';
            text += this._formatMsgsForExport(msgs);
            this._copyToClipboard(text, '对话(' + msgs.length + '条) ');
            Store.addLog('info', chatId, 'copy', '复制对话 ' + msgs.length + ' 条');
        },

        // ===== 复制全部对话 =====
        copyAllChats: function() {
            var self = this;
            if (this.chatBoxes.length === 0) { this._toast('暂无对话框', 'err'); return; }
            var text = '=== 朱峰社区无限智能体 - 全部对话记录 ===\n';
            text += '时间: ' + new Date().toLocaleString('zh-CN') + '\n';
            text += '对话框数: ' + this.chatBoxes.length + '\n';
            text += '=========================================\n\n';
            this.chatBoxes.forEach(function(chat) {
                var msgs = Store.getMessages(chat.id);
                var modelName = chat.modelId ? (Models.get(chat.modelId) ? Models.get(chat.modelId).name : chat.modelId) : '未选择模型';
                text += '--- 对话框: ' + chat.id + ' | 模型: ' + modelName + ' | 消息数: ' + msgs.length + ' ---\n\n';
                text += self._formatMsgsForExport(msgs);
                text += '\n';
            });
            this._copyToClipboard(text, '全部对话(' + this.chatBoxes.length + '框) ');
            Store.addLog('info', '', 'copy', '复制全部对话 ' + this.chatBoxes.length + ' 框');
        },

        renderImageModelSelect: function() {
            var select = document.getElementById('image-model-select');
            if (!select || typeof Models === 'undefined') return;
            var selected = UserSettings.get('zf3d_image_model') || '';
            var list = (Models.list || []).filter(function(m) { return m.imageGen; });
            select.innerHTML = '<option value="">默认 pollinations（免费，不自动切换）</option>' + list.map(function(m) {
                var value = m.modelId || m.id || '';
                return '<option value="' + String(value).replace(/"/g, '&quot;') + '">' + String(m.name || value).replace(/[<>&]/g, function(c) { return ({'<':'&lt;','>':'&gt;','&':'&amp;'})[c]; }) + '</option>';
            }).join('');
            select.value = selected;
            select.onchange = function() { UserSettings.set('zf3d_image_model', this.value || ''); };
            // 渲染渠道状态卡片
            this.renderImageChannels();
        },

        // ===== 渲染生图渠道状态列表（官网直达 + 免费积分入口）=====
        renderImageChannels: function() {
            var panel = document.getElementById('image-channels-panel');
            if (!panel) return;
            panel.innerHTML = '<div style="font-size:12px;color:var(--text2);">加载渠道状态中…</div>';
            var self = this;
            fetch('/api/image-gen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) })
                .then(function(res) { return res.json(); })
                .then(function(raw) {
                    var data = raw && raw.data ? raw.data : raw;
                    if (!data || !data.channels || !data.channels.length) {
                        panel.innerHTML = '<div style="font-size:12px;color:var(--text2);">未获取到渠道状态。</div>';
                        return;
                    }
                    var html = '';
                    data.channels.forEach(function(ch) {
                        html += self._channelCardHtml(ch);
                    });
                    panel.innerHTML = html + '<div style="font-size:11px;color:var(--text2);margin-top:2px;">' +
                        '今日共生成 ' + (data.total_today || 0) + ' 张 · ' + (data.hint || '') + '</div>';
                    panel.querySelectorAll('.ch-refresh').forEach(function(b) {
                        b.onclick = function() { self.renderImageChannels(); };
                    });
                })
                .catch(function() {
                    panel.innerHTML = '<div style="font-size:12px;color:#e06c75;">渠道状态加载失败（后端未启动 image-gen 路由？）</div>';
                });
        },

        _channelCardHtml: function(ch) {
            // 匹配 Models.list 拿官方URL
            var officialUrl = '';
            if (typeof Models !== 'undefined') {
                var m = (Models.list || []).filter(function(x) { return x.imageGen && (x.modelId === ch.id || x.modelId === ch.model); })[0];
                if (m && m.officialUrl) officialUrl = m.officialUrl;
            }
            // 状态徽标
            var badge, badgeColor;
            if (ch.exhausted_today) { badge = '今日额度已耗尽'; badgeColor = '#e06c75'; }
            else if (ch.cooldown_left > 0) { badge = '冷却中 ' + Math.ceil(ch.cooldown_left / 60) + ' 分钟'; badgeColor = '#e5c07b'; }
            else if (!ch.ready) { badge = '缺 Key 未启用'; badgeColor = '#7f8c8d'; }
            else if (ch.daily_free) { badge = '每日免费额度'; badgeColor = '#61afef'; }
            else { badge = '可用'; badgeColor = '#98c379'; }
            var usage = ch.daily_free ? ('今日已用 ' + (ch.used_today || 0) + ' 次') : (ch.ready ? '免费无 Key' : '需 API Key');
            // 该渠道是否需要填 Key（pollinations 免费渠道无需）
            var needKey = (String(ch.provider || '') !== 'pollinations');
            var freeBtn = '';
            if (ch.provider === 'zhipu') freeBtn = '<a class="btn ghost" href="https://open.bigmodel.cn/usercenter/apikeys" target="_blank" rel="noopener noreferrer" style="font-size:11px;">🎁 领免费积分</a>';
            else if (ch.provider === 'siliconflow') freeBtn = '<a class="btn ghost" href="https://siliconflow.cn/pricing" target="_blank" rel="noopener noreferrer" style="font-size:11px;">🎁 领免费额度</a>';
            else if (ch.provider === 'miaomio') freeBtn = '<a class="btn ghost" href="https://miaomio.net/" target="_blank" rel="noopener noreferrer" style="font-size:11px;">🎁 官网领积分</a>';
            // Key 输入行（复用文字模型的 mi-keyrow 防自动填充结构，左侧密匙文字提示）
            var keyRow = '';
            if (needKey) {
                var ph = ch.ready ? '已填密钥（留空保持不变）' : '输入API密钥';
                keyRow = '<div class="mi-keyrow" style="margin-top:8px;width:100%;">' +
                    '<span class="mi-key-label">密匙</span>' +
                    '<form onsubmit="return false" style="display:flex;flex:1 1 auto;min-width:0;align-items:center;">' +
                        '<input type="text" name="username" autocomplete="username" aria-label="Username" tabindex="-1" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">' +
                        '<input type="password" data-imgkey-input="' + ch.id + '" placeholder="' + ph + '" autocomplete="new-password" name="imgapikey_' + Math.random().toString(36).slice(2,9) + '" readonly onfocus="this.removeAttribute(\'readonly\');this.value=\'\';" style="width:100%;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);outline:none;" />' +
                    '</form>' +
                '</div>';
            }
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);flex-wrap:wrap;">' +
                '<span style="width:10px;height:10px;border-radius:50%;background:' + badgeColor + ';flex-shrink:0;" title="' + badge + '"></span>' +
                '<div style="flex:1;min-width:150px;">' +
                    '<div style="font-size:13px;font-weight:600;color:var(--text);">' + String(ch.name || ch.id).replace(/[<>&]/g, function(c) { return ({'<':'&lt;','>':'&gt;','&':'&amp;'})[c]; }) + '</div>' +
                    '<div style="font-size:11px;color:var(--text2);margin-top:2px;">' + badge + ' · ' + usage + '</div>' +
                    '<div style="font-size:11px;color:var(--text3);margin-top:2px;">' + (ch.model || '') + '</div>' +
                '</div>' +
                (officialUrl ? '<a class="btn ghost" href="' + officialUrl + '" target="_blank" rel="noopener noreferrer" style="font-size:11px;">直达官网</a>' : '') +
                freeBtn +
                keyRow +
                (needKey ? '<div class="mi-actions" style="width:100%;justify-content:flex-start;">' +
                    '<button class="btn ghost" onclick="App.saveImageChannelKey(&#39;' + ch.id + '&#39;)">保存</button>' +
                    '<button class="btn ghost" onclick="App.clearImageChannelKey(&#39;' + ch.id + '&#39;)">清除</button>' +
                    '</div>' +
                    '<div class="test-result" data-imgtest-result="' + ch.id + '"></div>' : '') +
                '</div>';
        },

        // ===== 保存生图渠道密钥（写入 private/image_gen_keys.json）=====
        saveImageChannelKey: function(id) {
            var container = document.getElementById('image-channels-panel') || document;
            var inp = container.querySelector('[data-imgkey-input="' + id + '"]');
            var result = container.querySelector('[data-imgtest-result="' + id + '"]');
            var setResult = function(html) { if (result) result.innerHTML = html; };
            if (!inp) return;
            var val = (inp.value || '').trim();
            var provider = id;  // 后端 set_key 支持按渠道 id 解析 provider
            if (!val) { setResult('<span class="err">✗ 请先输入 API 密钥再保存</span>'); return; }
            if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('info', id, 'imgkey', '保存生图渠道密钥: ' + id);
            setResult('<span class="muted">保存中…</span>');
            var that = this;
            fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_key', provider: provider, key: val })
            }).then(function(r) { return r.json(); }).then(function(res) {
                if (res && res.ok) {
                    setResult('<span class="ok">✓ 密钥已保存</span>');
                    that.renderImageChannels();
                    // 立即触发一次连通测试
                    setTimeout(function() { that.testImageChannel(id); }, 300);
                } else {
                    var msg = (res && res.data && res.data.error) ? res.data.error : '密钥保存失败';
                    setResult('<span class="err">✗ ' + msg + '</span>');
                }
            }).catch(function(e) {
                setResult('<span class="err">✗ 保存失败: ' + e + '</span>');
            });
        },

        // ===== 清除生图渠道密钥 =====
        clearImageChannelKey: async function(id) {
            var container = document.getElementById('image-channels-panel') || document;
            var result = container.querySelector('[data-imgtest-result="' + id + '"]');
            var setResult = function(html) { if (result) result.innerHTML = html; };
            var ok = await ConfirmDialog.confirm({
                title: '清除生图密钥',
                message: '确定清除该生图渠道已保存的密钥吗？清除后必须重新填写并保存才能连接。',
                okText: '清除', danger: true
            });
            if (!ok) return;
            if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('warn', id, 'imgkey', '清除生图渠道密钥: ' + id);
            var that = this;
            fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'clear_key', provider: id })
            }).then(function(r) { return r.json(); }).then(function(res) {
                if (res && res.ok) {
                    setResult('<span class="ok">✓ 密钥已清除</span>');
                    that.renderImageChannels();
                } else {
                    var msg = (res && res.data && res.data.error) ? res.data.error : '清除失败';
                    setResult('<span class="err">✗ ' + msg + '</span>');
                }
            }).catch(function(e) {
                setResult('<span class="err">✗ 清除失败: ' + e + '</span>');
            });
        },

        // ===== 测试生图渠道连通性（走一次真实生图）=====
        testImageChannel: function(id) {
            var container = document.getElementById('image-channels-panel') || document;
            var result = container.querySelector('[data-imgtest-result="' + id + '"]');
            var setResult = function(html) { if (result) result.innerHTML = html; };
            setResult('<span class="muted">连通测试中…（约需几秒）</span>');
            if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('info', id, 'imgtest', '测试生图渠道: ' + id);
            var that = this;
            fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'generate', channel: id, prompt: 'test', nolog: true })
            }).then(function(r) { return r.json(); }).then(function(res) {
                if (res && res.ok && (res.data && (res.data.url || res.data.image || res.data.b64))) {
                    setResult('<span class="ok">✓ 连通正常（已成功生成测试图）</span>');
                } else {
                    var msg = (res && res.data && res.data.error) ? res.data.error : '测试失败';
                    setResult('<span class="err">✗ 测试失败: ' + msg + '</span>');
                }
                that.renderImageChannels();
            }).catch(function(e) {
                setResult('<span class="err">✗ 测试失败: ' + e + '</span>');
            });
        },


        // ===== 渲染模型列表 =====
        renderModelList: function() {
            var listEl = document.getElementById('modelList');
            var self = this;
            if (!listEl) return;
            if (Models.list.length === 0) {
                listEl.innerHTML = '<div style="font-size:12px;color:var(--text2);padding:8px 0 12px 0;">尚未配置模型。添加一个模型后，右键画布即可选择它创建对话框。</div>' + self._renderAddModelForm();
                self._bindAddModelForm(listEl);
                return;
            }
            var html = '';
            var seen = {};
            Models.list.forEach(function(m) {
                if (m.imageGen) return; // 生图模型不放入聊天模型配置
                if (seen[m.id]) return; // 防重复
                seen[m.id] = true;
                var keyVal = m.key || m.apiKey || '';
                var visible = m.visible !== false;
                var re = m.reasoningEffort || 'medium';
                var esc = function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

                html += '<div class="model-item" data-model-id="' + esc(m.id) + '" draggable="true">' +
                    // 第1行：名称输入框 + 操作按钮
                    '<div class="mi-head">' +
                        '<span class="mi-drag" title="拖拽调整顺序">⋮⋮</span>' +
                        '<input type="text" class="mi-name-input" data-name-input="' + esc(m.id) + '" value="' + esc(m.name) + '" title="' + esc(m.name) + '" />' +
                        '<button class="mi-toggle' + (visible ? ' on' : '') + '" data-toggle="visible" data-id="' + esc(m.id) + '" title="在画布右键菜单中显示/隐藏此模型">' + (visible ? '👁' : '🚫') + '</button>' +
                        '<button class="mi-copy" data-copy="' + esc(m.id) + '" title="复制为新通道（保留规则，清空 API Key）">⧉</button>' +
                        '<button class="mi-del" data-del="' + esc(m.id) + '" title="删除此模型">✕</button>' +
                    '</div>' +
                    // 第2行：模型ID（火山方舟可选模型下拉） + 思考强度
                    '<div class="mi-settings-row">' +
                        '<div class="mi-field"><span class="mi-field-label">模型ID</span>' +
                        '<select data-modelid-input="' + esc(m.id) + '">' +
                            (function() {
                                var PROVIDER_IDS = (typeof Models !== 'undefined' && Models.modelIdsFor) ? Models.modelIdsFor(m.provider) : [];
                                var cur = m.modelId || '';
                                var opts = '';
                                if (cur && PROVIDER_IDS.indexOf(cur) < 0) {
                                    opts += '<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (当前)</option>';
                                }
                                PROVIDER_IDS.forEach(function(mid) {
                                    opts += '<option value="' + esc(mid) + '"' + (mid === cur ? ' selected' : '') + '>' + esc(mid) + '</option>';
                                });
                                return opts;
                            })() +
                        '</select></div>' +
                        '<div class="mi-field"><span class="mi-field-label">思考强度</span>' +
                        '<select data-reasoning-input="' + esc(m.id) + '">' +
                            (function() {
                                // 档位统一由 reasoning_levels.json 提供（按模型 modelId 可覆盖），无图标
                                var list = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(m.modelId) : [];
                                var cur2 = m.reasoningEffort || (list[0] && list[0].value) || '';
                                var o = '';
                                list.forEach(function(it) {
                                    o += '<option value="' + esc(it.value) + '"' + (it.value === cur2 ? ' selected' : '') + '>' + esc(it.label || it.value) + '</option>';
                                });
                                if (cur2 && !list.some(function(it){ return it.value === cur2; })) {
                                    o += '<option value="' + esc(cur2) + '" selected>' + esc(cur2) + ' (当前)</option>';
                                }
                                return o;
                            })() +
                        '</select>' +
                        '<span class="mi-re-stepwrap">' +
                        '<button type="button" class="mi-re-btn" data-re-step="down" data-re-id="' + esc(m.id) + '" title="降低思考强度">−</button>' +
                        '<button type="button" class="mi-re-btn" data-re-step="up" data-re-id="' + esc(m.id) + '" title="提升思考强度">＋</button>' +
                        '</span></div>' +
                    '</div>' +
                    // 第3行：API 网址（可编辑）
                    '<div class="mi-settings-row">' +
                        '<div class="mi-field mi-field-grow"><span class="mi-field-label">API 网址</span>' +
                        '<input type="text" data-endpoint-input="' + esc(m.id) + '" value="' + esc(m.endpoint || '') + '" placeholder="https://..." /></div>' +
                    '</div>' +
                    // 第4行：API 密钥输入（默认显示已存密钥掩码，眼睛可切换明文）
                    '<div class="mi-keyrow">' +
                        '<span class="mi-key-label">密匙</span>' +
                        '<form onsubmit="return false" style="display:flex;gap:6px;flex:1 1 auto;min-width:0;align-items:center;"><input type="text" name="username" autocomplete="username" aria-label="Username" tabindex="-1" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"><input type="password" data-key-input="' + esc(m.id) + '" value="' + esc(keyVal) + '" placeholder="输入API密钥" autocomplete="new-password" name="apikey_' + Math.random().toString(36).slice(2,9) + '" /></form>' +
                        '<button type="button" class="mi-eye" data-eye="' + esc(m.id) + '" title="显示/隐藏密钥">👁</button>' +
                    '</div>' +
                    // 第5行：操作按钮
                    '<div class="mi-actions">' +
                        '<button class="btn ghost" onclick="App.saveModelSettings(\'' + esc(m.id) + '\')">保存</button>' +
                        '<button class="btn ghost" onclick="App.testModel(\'' + esc(m.id) + '\')">测试</button>' +
                        '<button class="btn ghost" onclick="App.clearModelKey(\'' + esc(m.id) + '\')">清除</button>' +
                        (function() { var u = m.officialUrl; return u ? '<a class="btn ghost" href="' + u + '" target="_blank" rel="noopener noreferrer" title="打开模型服务官网">官网</a>' : ''; })() +
                    '</div>' +
                    '<div class="test-result" data-test-result="' + esc(m.id) + '"></div>' +
                '</div>';
            });
            // 底部添加模型表单
            html += self._renderAddModelForm();
            listEl.innerHTML = html;
            // 绑定密钥眼睛切换（显示/隐藏明文）
            listEl.querySelectorAll('[data-eye]').forEach(function(eyeBtn) {
                eyeBtn.addEventListener('click', function() {
                    var input = listEl.querySelector('[data-key-input="' + this.getAttribute('data-eye') + '"]');
                    if (!input) return;
                    if (input.type === 'password') {
                        input.type = 'text';
                        this.textContent = '🙈';
                        this.title = '隐藏密钥';
                    } else {
                        input.type = 'password';
                        this.textContent = '👁';
                        this.title = '显示密钥';
                    }
                });
            });
            this._bindModelListEvents(listEl);
            this._bindAddModelForm(listEl);
        },

        // ===== 添加模型表单 HTML =====
        _renderAddModelForm: function() {
            var esc = function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
            return '<div class="model-item mi-add-form" style="border-style:dashed;">' +
                '<div class="mi-head"><div class="mi-name" style="font-size:13px;">＋ 添加新模型</div></div>' +
                '<div class="mi-settings-row">' +
                    '<div class="mi-field"><span class="mi-field-label">名称</span>' +
                    '<input type="text" id="cfg-name" placeholder="如：火山方舟" /></div>' +
                    '<div class="mi-field"><span class="mi-field-label">模型ID</span>' +
                    '<input type="text" id="cfg-modelid" placeholder="如：glm-5.3" /></div>' +
                '</div>' +
                '<div class="mi-settings-row">' +
                    '<div class="mi-field mi-field-grow"><span class="mi-field-label">API 网址</span>' +
                    '<input type="text" id="cfg-endpoint" placeholder="https://..." /></div>' +
                    '<div class="mi-field"><span class="mi-field-label">思考强度</span>' +
                    '<select id="cfg-reasoning">' +
                        (function() {
                            // 档位统一由 reasoning_levels.json 提供，无图标
                            var list = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor('') : [];
                            var o = '';
                            list.forEach(function(it, idx) {
                                o += '<option value="' + esc(it.value) + '"' + (idx === 0 ? ' selected' : '') + '>' + esc(it.label || it.value) + '</option>';
                            });
                            return o || '<option value="medium" selected>中</option>';
                        })() +
                    '</select>' +
                    '<span style="display:inline-flex;gap:4px;margin-left:4px;">' +
                    '<button type="button" class="mi-re-btn" data-re-step-add="down" title="降低思考强度">−</button>' +
                    '<button type="button" class="mi-re-btn" data-re-step-add="up" title="提升思考强度">＋</button>' +
                    '</span></div>' +
                '</div>' +
                '<div class="mi-keyrow">' +
                    '<span class="mi-key-label">密匙</span>' +
                    '<form onsubmit="return false" style="display:flex;flex:1 1 auto;min-width:0;"><input type="text" name="username" autocomplete="username" aria-label="Username" tabindex="-1" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"><input type="password" id="cfg-key" placeholder="API 密钥" autocomplete="new-password" /></form>' +
                '</div>' +
                '<div class="mi-actions">' +
                    '<button class="btn ghost" id="cfg-test-btn" onclick="App.testModel()">🧪 测试连通</button>' +
                    '<button class="btn ghost" style="background:#2f81f7;color:#fff;" onclick="App.saveModel()">💾 保存模型</button>' +
                '</div>' +
                '<div class="test-result" id="testResult"></div>' +
            '</div>';
        },

        // ===== 绑定添加模型表单事件 =====
        _bindAddModelForm: function(listEl) {
            // Enter 键提交
            var inputs = listEl.querySelectorAll('#cfg-name, #cfg-endpoint, #cfg-modelid, #cfg-key');
            inputs.forEach(function(inp) {
                if (inp._zf3dEnterBound) return;
                inp._zf3dEnterBound = true;
                inp.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); App.saveModel(); }
                });
            });
        },

        // ===== 保存模型设置（名称 + 网址 + 模型ID + 思考强度 + 密钥，一键保存全部项目）=====
        saveModelSettings: async function(id) {
            var container = document.getElementById('modelList');
            var nameInput = container.querySelector('[data-name-input="' + id + '"]');
            var modelIdInput = container.querySelector('[data-modelid-input="' + id + '"]');
            var endpointInput = container.querySelector('[data-endpoint-input="' + id + '"]');
            var reasoningInput = container.querySelector('[data-reasoning-input="' + id + '"]');
            var keyInput = container.querySelector('[data-key-input="' + id + '"]');
            if (!modelIdInput || !reasoningInput) return;
            var newName = nameInput ? nameInput.value.trim() : '';
            var newModelId = modelIdInput.value.trim();
            var newEndpoint = endpointInput ? endpointInput.value.trim() : '';
            var newReasoning = reasoningInput.value;
            var tr = container.querySelector('[data-test-result="' + id + '"]');
            if (!newName) { this._toast('名称不能为空', 'err'); return; }
            if (!newModelId) { this._toast('模型ID不能为空', 'err'); return; }
            if (!newEndpoint) { this._toast('API 网址不能为空', 'err'); return; }
            var m = Models.get(id);
            if (!m) return;
            // 密钥：输入框有值则更新，为空保持原值不变
            var newKey = keyInput ? keyInput.value.trim() : '';
            if (newKey) {
                // 清除可能残留的掩码文本（兼容旧版）
                newKey = newKey.replace(/sk-•+•?/g, '').trim();
                if (newKey) {
                    m.key = newKey;
                    m.apiKey = newKey;
                }
            }
            m.name = newName;
            m.modelId = newModelId;
            m.endpoint = newEndpoint;
            m.baseUrl = newEndpoint;
            m.reasoningEffort = newReasoning;
            var self = this;
            try {
                await Models.save();
            } catch (e) {
                if (tr) tr.innerHTML = '<span class="err">✗ 保存失败:' + (e && e.message ? e.message : e) + '</span>';
                Store.addLog('error', id, 'model-settings', '保存模型设置失败: ' + m.name + ' ' + (e && e.message ? e.message : e));
                return;
            }
            self._toast('✅ 模型设置已保存', 'ok');
            if (tr) tr.innerHTML = '<span class="ok">✓ 设置已保存（名称/网址/模型ID/思考强度/密钥）</span>';
            Store.addLog('info', id, 'model-settings', '更新模型设置: ' + m.name + ' | endpoint=' + newEndpoint + ' | modelId=' + newModelId + ' | reasoning=' + newReasoning);
            self.renderModelList();
            self.updateStatusModelText();
            self.refreshAllModelSelects();
        },

        _bindModelListEvents: function(list) {
            var self = this;
            if (list._eventsBound) return; // 防止重复绑定
            list._eventsBound = true;

            function clearMarks() {
                var marks = list.querySelectorAll('.insert-before, .insert-after');
                for (var i = 0; i < marks.length; i++) marks[i].classList.remove('insert-before', 'insert-after');
            }

            // 删除 + 开关按钮（事件委托，只更新按钮自身，不整列表重渲染）
            list.addEventListener('click', function(e) {
                var del = e.target.closest ? e.target.closest('.mi-del') : null;
                if (del) { App.removeModel(del.getAttribute('data-del')); return; }
                var copy = e.target.closest ? e.target.closest('.mi-copy') : null;
                if (copy) { App.cloneModel(copy.getAttribute('data-copy')); return; }
                var btn = e.target.closest ? e.target.closest('.mi-toggle') : null;
                if (!btn) return;
                var id = btn.getAttribute('data-id');
                var type = btn.getAttribute('data-toggle');
                var m = Models.get(id);
                if (!m) return;
                var on;
                if (type === 'visible') {
                    m.visible = (m.visible === false);
                    Models.setVisible(id, m.visible);
                    on = m.visible;
                } else { return; }
                btn.classList.toggle('on', on);
                btn.innerHTML = on ? '👁' : '🚫';
                try { Store.addLog('info', '', 'model', '「' + m.name + '」窗口可见 → ' + (on ? '开' : '关')); } catch(ex) {}
            });

            // ===== 思考强度 +/− 步进（事件委托）=====
            function stepReasoning(list, sel, dir) {
                if (!sel || list.length === 0) return false;
                var idx = -1;
                for (var i = 0; i < list.length; i++) { if (list[i].value === sel.value) { idx = i; break; } }
                if (idx < 0) idx = 0;
                var ni = idx + dir;
                if (ni < 0) ni = 0;
                if (ni > list.length - 1) ni = list.length - 1;
                if (ni === idx) return false;
                sel.value = list[ni].value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            list.addEventListener('click', function(e) {
                var b = e.target.closest ? e.target.closest('.mi-re-btn') : null;
                if (!b) return;
                e.preventDefault();
                var dir = b.getAttribute('data-re-step') === 'up' ? 1 : -1;
                // 添加表单按钮
                var addDir = b.getAttribute('data-re-step-add');
                if (addDir) {
                    var selAdd = document.getElementById('cfg-reasoning');
                    var lv = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor('') : [];
                    stepReasoning(lv, selAdd, addDir === 'up' ? 1 : -1);
                    return;
                }
                var id = b.getAttribute('data-re-id');
                if (!id) return;
                var sel = list.querySelector('[data-reasoning-input="' + id + '"]');
                if (!sel) return;
                var m2 = Models.get(id);
                var lv2 = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(m2 && m2.modelId || '') : [];
                stepReasoning(lv2, sel, dir);
            });

            // ===== 拖拽排序（HTML5 Drag API + 插入位置预览线）=====
            var dragEl = null;
            list.addEventListener('dragstart', function(e) {
                dragEl = e.target.closest ? e.target.closest('.model-item') : null;
                if (!dragEl) return;
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', dragEl.getAttribute('data-model-id')); } catch(ex) {}
                var el = dragEl;
                setTimeout(function() { el.classList.add('dragging'); }, 0);
            });
            list.addEventListener('dragend', function() {
                if (!dragEl) return;
                dragEl.classList.remove('dragging');
                clearMarks();
                dragEl = null;
            });
            list.addEventListener('dragover', function(e) {
                if (!dragEl) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                var target = e.target.closest ? e.target.closest('.model-item') : null;
                clearMarks();
                if (!target || target === dragEl) return;
                var rect = target.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) {
                    target.classList.add('insert-before');
                } else {
                    target.classList.add('insert-after');
                }
            });
            list.addEventListener('drop', function(e) {
                if (!dragEl) return;
                e.preventDefault();
                var target = e.target.closest ? e.target.closest('.model-item') : null;
                if (!target || target === dragEl) return;
                var dragId = dragEl.getAttribute('data-model-id');
                var rect = target.getBoundingClientRect();
                var isTop = e.clientY < rect.top + rect.height / 2;
                var items = Models.list.filter(function(mm) { return !mm.imageGen; });
                var targetIdx = -1;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].id === target.getAttribute('data-model-id')) { targetIdx = i; break; }
                }
                if (targetIdx < 0) return;
                var insertIdx = isTop ? targetIdx : targetIdx + 1;
                var fromIdx = -1;
                for (var j = 0; j < Models.list.length; j++) {
                    if (Models.list[j].id === dragId) { fromIdx = j; break; }
                }
                if (fromIdx < 0) return;
                if (fromIdx < insertIdx) insertIdx--;
                Models.move(dragId, insertIdx);
                try { Store.addLog('info', '', 'model', '模型顺序已调整'); } catch(ex) {}
                self.renderModelList();
            });
        },

        // ===== 保存模型 =====
        saveModel: function() {
            var name = document.getElementById('cfg-name').value.trim();
            var endpoint = document.getElementById('cfg-endpoint').value.trim();
            var key = document.getElementById('cfg-key').value.trim();
            var modelId = document.getElementById('cfg-modelid').value.trim();
            if (!name || !endpoint || !key || !modelId) {
                document.getElementById('testResult').innerHTML = '<span class="err">请填写完整信息</span>';
                return;
            }
                        // 密钥格式校验：禁止把 JWT token（eyJ...）当模型密钥；该网关 网关只接受 sk- 开头的 Virtual Key
            if (false) {
                document.getElementById('testResult').innerHTML = '<span class="err">✗ 密钥格式错误：检测到 JWT token（eyJ... 开头）。该网关 网关不接受 JWT，请到 服务商控制台的密钥页面 获取 sk- 开头的虚拟密钥节点后重新填写。</span>';
                Store.addLog('error', '', 'model-add', '密钥格式错误: ' + name + ' (检测到 JWT, eyJ... 开头)');
                return;
            }
            if (false) {
                document.getElementById('testResult').innerHTML = '<span class="err">✗ 密钥格式错误：该网关 需要 sk- 开头的虚拟密钥（到 服务商控制台的密钥页面 获取），不能使用 JWT token。</span>';
                Store.addLog('error', '', 'model-add', '密钥格式错误: ' + name + ' (非sk-开头)');
                return;
            }
            // 允许重复 API Key（用户要求：同一 API Key 可添加到多个模型），去掉重复校验
            // var duplicate = Models.list.find(function(item) {
            //     return item && item.key === key;
            // });
            // if (duplicate) {
            //     document.getElementById('testResult').innerHTML = '<span class="err">已经有同样的 API Key 输入了，请换一个不同的 API Key。</span>';
            //     Store.addLog('warn', '', 'model-add', '拒绝重复 API Key: ' + name + ' 与 ' + duplicate.name);
            //     return;
            // }
            var reasoningEl = document.getElementById('cfg-reasoning');
            var reasoningEffort = reasoningEl ? reasoningEl.value : 'medium';
            Models.add({ name: name, endpoint: endpoint, key: key, modelId: modelId, reasoningEffort: reasoningEffort, visible: true, enabled: true }).then(function(r) {
                if (r && r.ok) {
                    Store.addLog('info', '', 'model-add', '添加模型: ' + name + ' | endpoint=' + endpoint + ' | modelId=' + modelId + ' | reasoning=' + reasoningEffort);
                }
            });
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            // 保存后自动测试连通
            this.testModel();
        },

        // saveModelKey 已合并进 saveModelSettings 一键保存（保留兼容入口）
        saveModelKey: async function(id) {
            await this.saveModelSettings(id);
        },

        // ===== 删除模型 =====
        removeModel: async function(id) {
            var m0 = Models.get(id);
            var mName0 = m0 ? m0.name : id;
            var ok = await ConfirmDialog.confirm({
                title: '删除模型',
                message: '确定删除「' + mName0 + '」模型配置？删除后不可恢复。',
                okText: '删除', danger: true
            });
            if (!ok) return;
            var m = Models.get(id);
            var mName = m ? m.name : id;
            Models.remove(id);
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            Store.addLog('warn', id, 'model-remove', '删除模型: ' + mName);
        },

        // ===== 清除模型密钥 =====
        clearModelKey: async function(id) {
            var m = Models.get(id);
            if (!m) return;
            var ok = await ConfirmDialog.confirm({
                title: '清除密钥',
                message: '确定清除「' + m.name + '」当前已保存的密钥吗？清除后必须重新填写并保存才能连接。',
                okText: '清除', danger: true
            });
            if (!ok) return;
            m.key = '';
            m.apiKey = '';
            Models.save();
            if (typeof Store !== 'undefined' && Store.clearModelKey) Store.clearModelKey(id);
            this.renderModelList();
            var tr = document.querySelector('[data-test-result="' + id + '"]');
            if (tr) tr.innerHTML = '<span class="ok">✓ 密钥已清除，请重新填写并保存</span>';
            Store.addLog('warn', id, 'model-key-clear', '清除模型密钥: ' + m.name);
        },

        // ===== 修改模型显示名称 =====
        renameModel: async function(id) {
            var m = Models.get(id);
            if (!m) return;
            var name = await ConfirmDialog.prompt({
                title: '修改模型名称',
                message: '请输入模型显示名称：',
                value: m.name
            });
            if (name === null || name === undefined) return;
            name = (name || '').trim();
            if (!name) {
                await ConfirmDialog.alert({ title: '提示', message: '模型名称不能为空。' });
                return;
            }
            if (name === m.name) return;
            var previousName = m.name;
            m.name = name;
            Models.save();
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            Store.addLog('info', id, 'model-rename', '修改模型名称: ' + previousName + ' → ' + name);
        },

        // ===== 复制模型通道 =====
        cloneModel: function(id) {
            var source = Models.get(id);
            if (!source) return;
            var copy = Models.clone(id);
            if (!copy) return;
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            Store.addLog('info', copy.id, 'model-clone', '复制模型通道: ' + source.name + ' → ' + copy.name + '（API Key 已清空）');
        },

        // ===== 测试连通 =====
        testModel: function(id) {
            var self = this;
            var resultEl;
            var endpoint, key, modelId, name;

            if (id) {
                var m = Models.get(id);
                if (!m) return;
                // 优先从输入框读取当前值（用户可能改了还没保存）
                var container = document.getElementById('modelList');
                var endpointInputEl = container.querySelector('[data-endpoint-input="' + id + '"]');
                var modelIdInputEl = container.querySelector('[data-modelid-input="' + id + '"]');
                var inputEl = container.querySelector('[data-key-input="' + id + '"]');
                endpoint = (endpointInputEl ? endpointInputEl.value.trim() : '') || m.endpoint;
                modelId = (modelIdInputEl ? modelIdInputEl.value.trim() : '') || m.modelId;
                name = m.name;
                var inputVal = inputEl ? inputEl.value.trim() : '';
                if (inputVal) {
                    // 清除可能残留的掩码文本（兼容旧版）
                    inputVal = inputVal.replace(/sk-•+•?/g, '').trim();
                }
                if (inputVal) {
                    // 输入框有密钥（默认回显已存的），先保存再测试
                    m.key = inputVal;
                    m.apiKey = inputVal;
                    Models.save();
                    key = inputVal;
                } else {
                    // 输入框为空 = 用户清空了密钥，提示先保存
                    resultEl = container.querySelector('[data-test-result="' + id + '"]');
                    if (resultEl) resultEl.innerHTML = '<span class="err">请先输入 API 密钥并保存</span>';
                    return;
                }
                if (!key) {
                    resultEl = container.querySelector('[data-test-result="' + id + '"]');
                    if (resultEl) resultEl.innerHTML = '<span class="err">请先输入 API 密钥</span>';
                    return;
                }
                resultEl = container.querySelector('[data-test-result="' + id + '"]');
            } else {
                endpoint = document.getElementById('cfg-endpoint').value.trim();
                key = document.getElementById('cfg-key').value.trim();
                modelId = document.getElementById('cfg-modelid').value.trim();
                name = document.getElementById('cfg-name').value.trim() || '测试';
                resultEl = document.getElementById('testResult');
                if (!endpoint || !key || !modelId) {
                    resultEl.innerHTML = '<span class="err">请先填写完整配置</span>';
                    return;
                }
            }

            resultEl.innerHTML = '<span>正在测试…</span>';
            Store.addLog('info', id || '', 'model-test', '测试连通: ' + name + ' | endpoint=' + endpoint + ' | model=' + modelId);

            // 请求头：基础 + 模型自定义附加头
            var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
            if (id) {
                var mm = Models.get(id);
                if (mm && mm.headers) for (var hk in mm.headers) if (mm.headers.hasOwnProperty(hk)) headers[hk] = mm.headers[hk];
            }
            // 请求体：基础 + 模型自定义附加参数
            var payload = { model: modelId, messages: [{ role: 'user', content: '你好，请回复"连通成功"' }], stream: false };
            // 注入思考强度（与正式对话一致）
            var _re = null;
            if (id) {
                var mm2 = Models.get(id);
                _re = mm2 && mm2.reasoningEffort;
                if (mm2 && mm2.body) for (var bk in mm2.body) if (mm2.body.hasOwnProperty(bk)) payload[bk] = mm2.body[bk];
            } else {
                var _reEl = document.getElementById('cfg-reasoning');
                if (_reEl) _re = _reEl.value;
            }
            if (_re && _re !== 'off') {
                payload.reasoning_effort = _re;
            }

            // 所有模型统一通过标准 OpenAI 兼容代理测试。
            var reqP = DB.proxy(endpoint, headers, payload);
            reqP.then(function(res) {
                if (res.ok && res.data) {
                    resultEl.innerHTML = '<span class="ok">✓ ' + name + ' 连通成功</span>';
                    Store.addLog('info', id || '', 'model-test-ok', '连通成功: ' + name + ' | HTTP ' + (res.status || 200));
                } else {
                    var showMsg = (typeof _translateApiError === 'function')
                        ? _translateApiError(res.status, res.error || res.raw)
                        : ('HTTP ' + (res.status || '?') + ': ' + (res.error || res.raw || '未知错误'));
                    resultEl.innerHTML = '<span class="err">✗ 连通失败：' + showMsg + '</span>';
                    Store.addLog('error', id || '', 'model-test-fail', '连通失败: ' + name + ' | ' + showMsg);
                }
            }).catch(function(err) {
                var _em = (typeof _translateApiError === 'function') ? _translateApiError(0, err.message) : (err.message || '未知错误');
                resultEl.innerHTML = '<span class="err">✗ 代理请求失败：' + _em + '</span>';
                Store.addLog('error', id || '', 'model-test-fail', '代理请求失败: ' + name + ' | ' + _em);
            });
        },

        // ===== 邮件通知配置 =====
        loadEmailConfig: function() {
            var self = this;
            fetch('/api/tools/send_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'get_config' })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.ok && data.config) {
                    var cfg = data.config;
                    document.getElementById('email-enabled').checked = !!cfg.enabled;
                    document.getElementById('email-smtp-host').value = cfg.smtp_host || '';
                    document.getElementById('email-smtp-port').value = cfg.smtp_port || 465;
                    document.getElementById('email-use-ssl').value = String(cfg.use_ssl !== false);
                    document.getElementById('email-smtp-user').value = cfg.smtp_user || '';
                    document.getElementById('email-smtp-pass').value = (cfg.smtp_pass && cfg.smtp_pass.indexOf('•') >= 0) ? '' : (cfg.smtp_pass || '');
                    document.getElementById('email-to').value = cfg.to_email || '';
                    document.getElementById('email-from-name').value = cfg.from_name || '';
                    self._updateEmailToggle();
                } else {
                    // No config yet, set defaults
                    document.getElementById('email-smtp-host').value = 'smtp.qq.com';
                    document.getElementById('email-smtp-port').value = '465';
                    document.getElementById('email-use-ssl').value = 'true';
                    document.getElementById('email-from-name').value = '';
                }
                self._updateEmailToggle();
            }).catch(function(err) {
                console.warn('Load email config failed:', err);
            });
        },

        saveEmailConfig: function() {
            var cfg = {
                enabled: document.getElementById('email-enabled').checked,
                smtp_host: document.getElementById('email-smtp-host').value.trim(),
                smtp_port: parseInt(document.getElementById('email-smtp-port').value) || 465,
                use_ssl: document.getElementById('email-use-ssl').value === 'true',
                smtp_user: document.getElementById('email-smtp-user').value.trim(),
                smtp_pass: document.getElementById('email-smtp-pass').value.trim(),
                to_email: document.getElementById('email-to').value.trim(),
                from_name: document.getElementById('email-from-name').value.trim() || 'AI Agent'
            };
            var result = document.getElementById('emailTestResult');
            if (result) { result.innerHTML = '<span style="color:var(--text2)">正在保存...</span>'; }
            fetch('/api/tools/send_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save_config', config: cfg })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.ok) {
                    if (result) { result.innerHTML = '<span style="color:#4caf50">✓ ' + (data.message || '已保存') + '</span>'; }
                } else {
                    if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (data.error || '操作失败') + '</span>'; }
                }
            }).catch(function(err) {
                if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (err.message || '网络错误') + '</span>'; }
            });
        },

        testEmail: function() {
            var result = document.getElementById('emailTestResult');
            if (result) { result.innerHTML = '<span style="color:var(--text2)">正在发送测试邮件...</span>'; }
            fetch('/api/tools/send_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'test' })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.ok) {
                    if (result) { result.innerHTML = '<span style="color:#4caf50">✓ ' + (data.message || '已发送') + '</span>'; }
                } else {
                    if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (data.error || '操作失败') + '</span>'; }
                }
            }).catch(function(err) {
                if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (err.message || '网络错误') + '</span>'; }
            });
        },

        _updateEmailToggle: function() {
            var cb = document.getElementById('email-enabled');
            if (!cb) return;
            var field = cb.closest ? cb.closest('.email-toggle-field') : null;
            var track = cb.parentElement.querySelector('.email-toggle-track');
            if (cb.checked) {
                if (field) field.classList.add('on');
                if (track) track.classList.add('active');
            } else {
                if (field) field.classList.remove('on');
                if (track) track.classList.remove('active');
            }
        },


});
