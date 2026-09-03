// ========== panel-log-health.js - 日志面板/面板状态/健康守护 ==========
// 拆分自 app-panels.js（原 104~296 行），Object.assign(App,{...}) 注册
Object.assign(App, {
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

        // ===== 日志分页/筛选状态 =====
        _logPage: 1,
        _logLevelFilter: 'all',
        _LOG_PAGE_SIZE: 50,

        _getFilteredLogs: function() {
            var logs = Store.getLogs().slice().reverse(); // 最新的在前
            if (this._logLevelFilter === 'all') return logs;
            return logs.filter(function(l) { return l.level === App._logLevelFilter; });
        },

        _renderLogStats: function(logs) {
            // 按 action 统计占比 + 纯文本表格（方便复制给 AI）
            var byAction = {};
            logs.forEach(function(l) {
                var k = l.action || 'unknown';
                if (!byAction[k]) byAction[k] = { count: 0, error: 0, warn: 0 };
                byAction[k].count++;
                if (l.level === 'error') byAction[k].error++;
                if (l.level === 'warn') byAction[k].warn++;
            });
            var rows = Object.keys(byAction).map(function(k) {
                return { action: k, count: byAction[k].count, error: byAction[k].error, warn: byAction[k].warn,
                    pct: logs.length ? (byAction[k].count * 100 / logs.length) : 0 };
            }).sort(function(a, b) { return b.count - a.count; });

            var maxCount = rows.length ? rows[0].count : 1;
            var html = '<details style="margin-bottom:8px;border:1px solid var(--border);border-radius:6px;padding:6px 10px;background:var(--bg2,rgba(255,255,255,0.03));">' +
                '<summary style="cursor:pointer;font-size:12px;color:var(--text2);user-select:none;">📊 日志统计分析（点击展开 / 收起）</summary>' +
                '<div style="margin-top:8px;">';
            // HTML 表格 + 比例条
            html += '<table style="width:100%;border-collapse:collapse;font-size:11px;font-family:monospace;">' +
                '<tr style="color:var(--text2);">' +
                '<th style="text-align:left;padding:3px 6px;border-bottom:1px solid var(--border);">类别</th>' +
                '<th style="text-align:left;padding:3px 6px;border-bottom:1px solid var(--border);width:30%;">占比</th>' +
                '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);width:60px;">数量</th>' +
                '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);width:60px;">百分比</th>' +
                (rows.some(function(r){return r.warn;}) ? '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);width:50px;color:#ffc107;">⚠️</th>' : '') +
                (rows.some(function(r){return r.error;}) ? '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);width:50px;color:#f44336;">❌</th>' : '') +
                '</tr>';
            rows.forEach(function(r) {
                var barW = Math.round(r.count * 100 / maxCount);
                html += '<tr>' +
                    '<td style="padding:3px 6px;border-bottom:1px solid var(--border);color:#5599ff;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + r.action + '">' + r.action + '</td>' +
                    '<td style="padding:3px 6px;border-bottom:1px solid var(--border);">' +
                        '<span style="display:block;height:9px;background:var(--border);border-radius:3px;overflow:hidden;min-width:50px;">' +
                            '<span style="display:block;height:100%;width:' + barW + '%;background:linear-gradient(90deg,#4a9eff,#28a745);"></span></span></td>' +
                    '<td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;">' + r.count + '</td>' +
                    '<td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;color:var(--text2);">' + r.pct.toFixed(1) + '%</td>' +
                    (rows.some(function(x){return x.warn;}) ? '<td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;color:#ffc107;">' + (r.warn || '') + '</td>' : '') +
                    (rows.some(function(x){return x.error;}) ? '<td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;color:#f44336;">' + (r.error || '') + '</td>' : '') +
                '</tr>';
            });
            html += '</table>';
            // 可复制的纯文本统计表
            var textRows = rows.map(function(r) {
                return r.action + '\t' + r.count + '\t' + r.pct.toFixed(1) + '%' + (r.error ? '\terr:' + r.error : '') + (r.warn ? '\twarn:' + r.warn : '');
            }).join('\n');
            var textTable = '【日志统计】共 ' + logs.length + ' 条\n类别\t数量\t占比' + (rows.some(function(r){return r.error;}) ? '\t错误' : '') + (rows.some(function(r){return r.warn;}) ? '\t警告' : '') + '\n' + textRows;
            html += '<textarea id="logStatsText" style="display:none;">' + textTable.replace(/</g, '&lt;') + '</textarea>';
            html += '</div></details>';
            return html;
        },

        copyLogStats: function() {
            var ta = document.getElementById('logStatsText');
            if (!ta) return;
            navigator.clipboard.writeText(ta.value).then(function() { App._toast('统计表已复制', 'ok'); })
                .catch(function() { ta.style.display = 'block'; ta.select(); document.execCommand('copy'); ta.style.display = 'none'; App._toast('统计表已复制', 'ok'); });
        },

        copyErrorLogs: function() {
            var errs = Store.getLogs().filter(function(l) { return l.level === 'error'; });
            if (errs.length === 0) { this._toast('没有错误日志', 'ok'); return; }
            var text = '【错误日志】共 ' + errs.length + ' 条\n' + errs.map(function(l) {
                return new Date(l.ts).toLocaleString('zh-CN', { hour12: false }) + ' [' + (l.boxId || '-') + '] ' + (l.action || '') + ' ' + (l.detail || '');
            }).join('\n');
            navigator.clipboard.writeText(text).then(function() { App._toast('已复制 ' + errs.length + ' 条错误日志', 'ok'); })
                .catch(function() { App._toast('复制失败', 'err'); });
        },

        _setLogLevelFilter: function(level) {
            this._logLevelFilter = level;
            this._logPage = 1;
            this._renderLogTab();
        },

        _setLogPage: function(p) {
            this._logPage = p;
            this._renderLogTab();
        },

        _renderLogTab: function() {
            var self = this;
            var content = document.getElementById('logContent');
            var footer = document.getElementById('panelFooter');
            var allLogs = Store.getLogs();
            var logs = this._getFilteredLogs(); // 已倒序（最新在前）
            var html = '';

            var errorCount = allLogs.filter(function(l) { return l.level === 'error'; }).length;
            var warnCount = allLogs.filter(function(l) { return l.level === 'warn'; }).length;
            var infoCount = allLogs.filter(function(l) { return l.level === 'info'; }).length;

            // 统计分析（可折叠）
            html += this._renderLogStats(allLogs);

            // 级别筛选按钮
            var levels = [['all', '全部', allLogs.length], ['info', '✅ info', infoCount], ['warn', '⚠️ warn', warnCount], ['error', '❌ error', errorCount]];
            html += '<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;">';
            levels.forEach(function(it) {
                var active = self._logLevelFilter === it[0];
                var c = it[0] === 'error' ? '#f44336' : (it[0] === 'warn' ? '#ffc107' : (it[0] === 'info' ? '#28a745' : 'var(--text2)'));
                html += '<button class="btn ' + (active ? '' : 'ghost') + '" style="font-size:11px;padding:3px 10px;color:' + (active ? '' : c) + ';" onclick="App._setLogLevelFilter(\'' + it[0] + '\')">' + it[1] + ' (' + it[2] + ')</button>';
            });
            html += '</div>';

            if (logs.length === 0) {
                html += '<div style="text-align:center;padding:40px 0;color:var(--text2);">' + (allLogs.length === 0 ? '暂无日志记录' : '该级别暂无日志') + '</div>';
            } else {
                // 分页
                var pageSize = this._LOG_PAGE_SIZE;
                var totalPages = Math.ceil(logs.length / pageSize);
                if (this._logPage > totalPages) this._logPage = totalPages;
                if (this._logPage < 1) this._logPage = 1;
                var page = this._logPage;
                var start = (page - 1) * pageSize;
                var pageLogs = logs.slice(start, start + pageSize);

                html += '<div style="margin-bottom:6px;font-size:12px;color:var(--text2);">第 ' + page + ' / ' + totalPages + ' 页 · 本页 ' + pageLogs.length + ' 条 · 筛选后共 ' + logs.length + ' 条</div>';

                pageLogs.forEach(function(l) {
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

                // 翻页控件
                html += '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:10px;font-size:12px;">' +
                    '<button class="btn ghost" style="font-size:11px;padding:3px 12px;" ' + (page <= 1 ? 'disabled' : '') + ' onclick="App._setLogPage(' + (page - 1) + ')">‹ 上一页</button>' +
                    '<span style="color:var(--text2);">' + page + ' / ' + totalPages + '</span>' +
                    '<button class="btn ghost" style="font-size:11px;padding:3px 12px;" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="App._setLogPage(' + (page + 1) + ')">下一页 ›</button>' +
                    '<button class="btn ghost" style="font-size:11px;padding:3px 12px;" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="App._setLogPage(1)">« 首页(最新)</button>' +
                    '<button class="btn ghost" style="font-size:11px;padding:3px 12px;" ' + (page <= 1 ? 'disabled' : '') + ' onclick="App._setLogPage(' + totalPages + ')">末页(最旧) »</button>' +
                '</div>';
            }
            content.innerHTML = html;
            footer.innerHTML = '<button class="btn ghost" style="font-size:11px;padding:4px 10px;" onclick="App.copyLogs()">📋 复制日志</button>' +
                '<button class="btn ghost" style="font-size:11px;padding:4px 10px;" onclick="App.copyLogStats()">📊 复制统计表</button>' +
                '<button class="btn ghost" style="font-size:11px;padding:4px 10px;" onclick="App.copyErrorLogs()">❌ 复制全部错误日志</button>' +
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
            var graceMinutes = document.getElementById('health-grace-minutes');
            var lockMinutes = document.getElementById('health-lock-minutes');
            if (interval) interval.value = Math.min(60, Math.max(30, cfg.intervalMinutes || 30));
            if (graceMinutes) graceMinutes.value = cfg.graceMinutes || 10;
            if (lockMinutes) lockMinutes.value = cfg.forceLockMinutes || 10;
            self._updateHealthSliderLabels();
            self._updateHealthStatusDisplay();
        },

        saveHealthConfig: function() {
            var self = this;
            var config = {
                intervalMinutes: Math.min(60, Math.max(30, parseInt(document.getElementById('health-interval').value))),
                graceMinutes: parseInt(document.getElementById('health-grace-minutes').value),
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
            var gm = parseInt((document.getElementById('health-grace-minutes') || {}).value || 10);
            var lm = parseInt(document.getElementById('health-lock-minutes').value);
            var ivLabel = document.getElementById('health-interval-value');
            var gmLabel = document.getElementById('health-grace-minutes-value');
            var lmLabel = document.getElementById('health-lock-minutes-value');
            if (ivLabel) ivLabel.textContent = iv + ' 分钟';
            if (gmLabel) gmLabel.textContent = gm + ' 分钟';
            if (lmLabel) lmLabel.textContent = lm + ' 分钟';
            var tipI = document.getElementById('health-tip-interval');
            var tipG = document.getElementById('health-tip-grace');
            var tipM = document.getElementById('health-tip-minutes');
            if (tipI) tipI.textContent = iv;
            if (tipG) tipG.textContent = gm;
            if (tipM) tipM.textContent = lm;
        },

        _updateHealthStatusDisplay: function() {
            var detail = document.getElementById('healthStatusDetail');
            if (!detail || typeof HealthGuard === 'undefined') return;
            if (typeof HealthGuard.getStatus === 'function') {
                detail.textContent = HealthGuard.getStatus();
                return;
            }
            var nextRest = (HealthGuard._config.intervalMinutes || 30) - Math.floor((Date.now() - HealthGuard._lastRestTime) / 60000);
            if (HealthGuard._isLocked) {
                var remain = Math.ceil((HealthGuard._lockRemainSeconds || 0) / 60);
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
});
