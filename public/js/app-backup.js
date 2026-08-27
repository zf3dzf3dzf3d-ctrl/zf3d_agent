// ========== app-backup.js - 备份管理面板（项目快照） ==========
Object.assign(App, {

    // ===== 备份管理面板 =====
    _backupRefreshing: false,

    showBackupPanel: function() {
        var overlay = document.getElementById('settingsOverlay');
        if (!overlay) return;
        overlay.classList.add('show');
        this.switchSettingsTab('backup');
    },

    renderBackupList: function() {
        var self = this;
        var content = document.getElementById('backupContent');
        var footer = document.getElementById('backupFooter');
        if (!content || !footer) return;

        // 显示加载中
        content.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text2);">🔄 加载中...</div>';

        this._apiGet('/api/backup/list').then(function(res) {
            if (!res.ok) {
                content.innerHTML = '<div style="text-align:center;padding:40px 0;color:#f44336;">❌ 加载失败: ' + (res.error || '未知错误') + '</div>';
                return;
            }

            var backups = res.backups || [];
            var html = '';

            // 状态摘要
            html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">';
            html += '<div style="font-size:13px;color:var(--text2);">';
            html += '📦 共 <b style="color:var(--text);">' + backups.length + '</b> 个快照';
            if (backups.length > 0) {
                var totalSize = backups.reduce(function(s, b) { return s + b.size; }, 0);
                html += ' · 总大小 <b style="color:var(--text);">' + self._formatSize(totalSize) + '</b>';
                var latest = backups[0];
                html += ' · 最新: ' + latest.display_time;
            }
            html += '</div>';
            html += '<div style="display:flex;gap:6px;align-items:center;">';
            html += '<button class="btn" style="font-size:12px;padding:6px 16px;" onclick="App.createBackup()" ' + (self._backupRefreshing ? 'disabled' : '') + '>📸 创建快照</button>';
            html += '<button class="btn ghost" style="font-size:12px;padding:6px 12px;" onclick="App.openBackupFolder()" title="在系统资源管理器中打开备份文件夹">📁 打开文件夹</button>';
            html += '</div>';
            html += '</div>';

            if (backups.length === 0) {
                html += '<div style="text-align:center;padding:60px 20px;color:var(--text2);">';
                html += '<div style="font-size:48px;margin-bottom:12px;opacity:0.3;">📸</div>';
                html += '<div style="font-size:14px;">暂无快照记录</div>';
                html += '<div style="font-size:12px;margin-top:4px;opacity:0.6;">点击「创建快照」保存当前项目状态</div>';
                html += '</div>';
            } else {
                // 卡片网格
                html += '<div class="backup-card-grid">';
                backups.forEach(function(b, idx) {
                    var isLatest = idx === 0;
                    var isSnapshot = b.type === 'snapshot';
                    var sizeColor = b.size > 50 * 1024 * 1024 ? '#ffc107' : '#28a745';
                    var icon = isLatest ? '🟢' : (isSnapshot ? '📦' : '💾');
                    var typeLabel = isSnapshot ? '项目快照' : '数据库备份';
                    var typeColor = isSnapshot ? '#4fc3f7' : '#ffc107';

                    html += '<div class="backup-card' + (isLatest ? ' backup-card-latest' : '') + '">';
                    // 卡片头部
                    html += '<div class="backup-card-header">';
                    html += '<span class="backup-card-icon">' + icon + '</span>';
                    html += '<span class="backup-card-time">' + b.display_time + '</span>';
                    if (isLatest) {
                        html += '<span class="backup-card-badge">最新</span>';
                    }
                    html += '</div>';
                    // 卡片信息
                    html += '<div class="backup-card-body">';
                    html += '<div class="backup-card-info">';
                    html += '<span style="color:' + sizeColor + ';">' + (isSnapshot ? '🗜️ ' : '💾 ') + b.size_human + '</span>';
                    if (isSnapshot) {
                        html += '<span style="color:' + typeColor + ';font-size:10px;margin-left:6px;border:1px solid ' + typeColor + ';padding:1px 4px;border-radius:3px;">' + typeLabel + '</span>';
                    }
                    html += '<span style="color:var(--text2);font-size:10px;margin-left:8px;">#' + (backups.length - idx) + '</span>';
                    html += '</div>';
                    html += '<div class="backup-card-filename" title="' + b.filename + '">' + b.filename + '</div>';
                    html += '</div>';
                    // 卡片操作
                    html += '<div class="backup-card-actions">';
                    html += '<button class="btn ghost backup-btn-restore" onclick="App.restoreBackup(\'' + b.filename + '\')" title="恢复此快照">♻️ 恢复</button>';
                    html += '<button class="btn ghost backup-btn-delete" onclick="App.deleteBackup(\'' + b.filename + '\')" title="删除此快照">🗑️</button>';
                    html += '</div>';
                    html += '</div>';
                });
                html += '</div>';
            }

            content.innerHTML = html;

            // 底部按钮
            footer.innerHTML =
                '<button class="btn ghost" style="font-size:11px;padding:6px 12px;" onclick="App.renderBackupList()" title="刷新列表">🔄 刷新</button>' +
                '<button class="btn ghost" style="font-size:11px;padding:6px 12px;" onclick="App.openBackupFolder()" title="打开备份文件夹">📁 打开文件夹</button>' +
                '<span style="flex:1;"></span>' +
                '<button class="btn ghost" style="font-size:11px;padding:6px 12px;" onclick="document.getElementById(\'settingsOverlay\').classList.remove(\'show\')">关闭</button>';
        }).catch(function(err) {
            content.innerHTML = '<div style="text-align:center;padding:40px 0;color:#f44336;">❌ 加载失败: ' + err.message + '</div>';
        });
    },

    openBackupFolder: function() {
        var self = this;
        this._apiGet('/api/backup/open-folder').then(function(res) {
            if (res.ok) {
                self._toast('📁 已打开备份文件夹', 'ok');
            } else {
                self._toast('❌ 打开失败: ' + (res.error || '未知错误'), 'err');
            }
        }).catch(function(err) {
            self._toast('❌ 打开失败: ' + err.message, 'err');
        });
    },

    createBackup: function() {
        var self = this;
        var content = document.getElementById('backupContent');
        // 禁用按钮，显示进度
        var btns = content.querySelectorAll('button');
        btns.forEach(function(b) { b.disabled = true; });
        var statusDiv = document.createElement('div');
        statusDiv.className = 'backup-progress';
        statusDiv.innerHTML = '<div class="backup-progress-bar"><div class="backup-progress-fill"></div></div><div style="text-align:center;margin-top:8px;font-size:12px;color:var(--text2);">⏳ 正在创建项目快照...</div>';
        content.appendChild(statusDiv);

        this._apiPost('/api/backup/create', {}).then(function(res) {
            if (res.ok) {
                var msg = '✅ 快照创建成功: ' + res.filename + ' (' + res.size_human;
                if (res.file_count) msg += ', ' + res.file_count + ' 个文件';
                msg += ')';
                self._toast(msg, 'ok');
            } else {
                self._toast('❌ 快照创建失败: ' + (res.error || '未知错误'), 'err');
            }
        }).catch(function(err) {
            self._toast('❌ 快照创建失败: ' + err.message, 'err');
        }).finally(function() {
            if (statusDiv.parentNode) statusDiv.parentNode.removeChild(statusDiv);
            self.renderBackupList();
        });
    },

    // ===== 通用危险操作确认弹窗（Promise 化，替代原生 confirm，不可被浏览器"禁止更多对话框"绕过） =====
    _confirmDialog: function(opts) {
        opts = opts || {};
        var title = opts.title || '确认操作';
        var bodyHtml = opts.html || '';
        var confirmText = opts.confirmText || '确认';
        var cancelText = opts.cancelText || '取消';
        var icon = opts.icon || '⚠️';

        return new Promise(function(resolve) {
            var old = document.getElementById('appConfirmModal');
            if (old && old.parentNode) old.parentNode.removeChild(old);

            var overlay = document.createElement('div');
            overlay.id = 'appConfirmModal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;';
            overlay.innerHTML =
                '<div style="max-width:440px;width:100%;background:#1e222d;border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.55);overflow:hidden;font-family:inherit;">' +
                    '<div style="padding:18px 20px 0 20px;display:flex;align-items:center;gap:10px;">' +
                        '<span style="font-size:22px;">' + icon + '</span>' +
                        '<span style="font-size:15px;font-weight:bold;color:#f0f0f0;">' + title + '</span>' +
                    '</div>' +
                    '<div style="padding:12px 20px 4px 20px;font-size:13px;color:#b8bcc8;line-height:1.7;">' + bodyHtml + '</div>' +
                    '<div style="display:flex;justify-content:flex-end;gap:10px;padding:16px 20px 18px 20px;">' +
                        '<button id="appConfirmCancel" style="padding:8px 20px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#c8ccd8;font-size:13px;cursor:pointer;">' + cancelText + '</button>' +
                        '<button id="appConfirmOk" style="padding:8px 20px;border-radius:8px;border:none;background:#e5484d;color:#fff;font-size:13px;font-weight:bold;cursor:pointer;">' + confirmText + '</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            var done = false;
            function close(result) {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(result);
            }
            function onKey(e) { if (e.key === 'Escape') close(false); }
            document.addEventListener('keydown', onKey);
            overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });
            overlay.querySelector('#appConfirmCancel').addEventListener('click', function() { close(false); });
            overlay.querySelector('#appConfirmOk').addEventListener('click', function() { close(true); });
        });
    },

    // 恢复快照：必须先经过二次确认弹窗，未确认绝不下发恢复请求
    restoreBackup: function(filename) {
        var self = this;
        this._confirmDialog({
            title: '确定要从此快照恢复吗？',
            icon: '♻️',
            confirmText: '确认恢复',
            html:
                '<div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 12px;margin-bottom:10px;">' +
                    '<div style="font-size:11px;color:#8b90a0;">快照文件</div>' +
                    '<div style="font-size:12px;color:#e8eaf0;font-family:monospace;word-break:break-all;">' + filename + '</div>' +
                '</div>' +
                '<div style="color:#ffb84d;">⚠️ 注意：</div>' +
                '<ul style="margin:6px 0 0 18px;padding:0;color:#c8ccd8;">' +
                    '<li>项目<b>所有代码和数据库</b>将被替换为快照内容</li>' +
                    '<li>恢复前会自动创建当前状态的快照（可反悔）</li>' +
                    '<li>恢复完成后需要刷新页面</li>' +
                '</ul>'
        }).then(function(ok) {
            if (!ok) return;
            self._doRestoreBackup(filename);
        });
    },

    _doRestoreBackup: function(filename) {
        var self = this;
        var content = document.getElementById('backupContent');
        content.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text2);">' +
            '<div style="font-size:36px;margin-bottom:16px;">♻️</div>' +
            '<div style="font-size:14px;">正在从快照恢复项目...</div>' +
            '<div style="font-size:12px;margin-top:8px;opacity:0.6;">' + filename + '</div>' +
            '<div class="backup-progress-bar" style="margin-top:16px;width:200px;margin-left:auto;margin-right:auto;"><div class="backup-progress-fill"></div></div>' +
            '<div style="font-size:11px;margin-top:8px;color:#ffc107;">⚠️ 请勿关闭页面，恢复后需刷新</div>' +
            '</div>';

        this._apiPost('/api/backup/restore', { filename: filename }).then(function(res) {
            if (res.ok) {
                content.innerHTML = '<div style="text-align:center;padding:40px 20px;">' +
                    '<div style="font-size:48px;margin-bottom:16px;">✅</div>' +
                    '<div style="font-size:16px;color:#28a745;font-weight:bold;">恢复成功！</div>' +
                    '<div style="font-size:12px;margin-top:8px;color:var(--text2);">' + res.message + '</div>' +
                    (res.pre_restore_backup ? '<div style="font-size:11px;margin-top:4px;color:var(--text2);">恢复前快照: ' + res.pre_restore_backup + '</div>' : '') +
                    '<button class="btn" style="margin-top:20px;" onclick="location.reload()">🔄 刷新页面</button>' +
                    '</div>';
            } else {
                self._toast('❌ 恢复失败: ' + (res.error || '未知错误'), 'err');
                self.renderBackupList();
            }
        }).catch(function(err) {
            self._toast('❌ 恢复失败: ' + err.message, 'err');
            self.renderBackupList();
        });
    },

    // 删除快照：同样必须经过确认弹窗（不可撤销操作）
    deleteBackup: function(filename) {
        var self = this;
        this._confirmDialog({
            title: '确定要删除此快照吗？',
            icon: '🗑️',
            confirmText: '确认删除',
            html:
                '<div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 12px;margin-bottom:10px;">' +
                    '<div style="font-size:11px;color:#8b90a0;">快照文件</div>' +
                    '<div style="font-size:12px;color:#e8eaf0;font-family:monospace;word-break:break-all;">' + filename + '</div>' +
                '</div>' +
                '<div style="color:#ff8a8a;">⚠️ 此操作不可撤销，删除后无法找回。</div>'
        }).then(function(ok) {
            if (!ok) return;
            self._doDeleteBackup(filename);
        });
    },

    _doDeleteBackup: function(filename) {
        var self = this;
        this._apiDelete('/api/backup/delete/' + encodeURIComponent(filename)).then(function(res) {
            if (res.ok) {
                self._toast('✅ 已删除: ' + filename, 'ok');
                self.renderBackupList();
            } else {
                self._toast('❌ 删除失败: ' + (res.error || '未知错误'), 'err');
            }
        }).catch(function(err) {
            self._toast('❌ 删除失败: ' + err.message, 'err');
        });
    },

    // ===== 辅助函数 =====
    _formatSize: function(bytes) {
        if (bytes === 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
    },

    _apiGet: function(url) {
        return fetch(url).then(function(res) { return res.json(); });
    },

    _apiPost: function(url, data) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(function(res) { return res.json(); });
    },

    _apiDelete: function(url) {
        return fetch(url, { method: 'DELETE' }).then(function(res) { return res.json(); });
    },

    // ===== 备份面板初始化 =====
    setupBackupPanel: function() {
        // 在设置面板中添加备份管理按钮
        // 通过监听设置面板打开时动态添加
    }
});
