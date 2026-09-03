// ========== app-zf3d.js - 朱峰社区登录/签到 ==========

Object.assign(App, {

    // ===== 朱峰社区：初始化 =====
    zf3dInit: function() {
        // 切换到朱峰社区面板时加载状态
    },

    // ===== 朱峰社区：切换面板时触发 =====
    zf3dOnTabSwitch: function(tab) {
        if (tab === 'zf3d') {
            this.zf3dRefreshStatus();
        }
    },

    // ===== 朱峰社区：登录 =====
    zf3dLogin: function() {
        var self = this;
        var username = (document.getElementById('zf3d-username') || {}).value || '';
        var password = (document.getElementById('zf3d-password') || {}).value || '';
        var resultDiv = document.getElementById('zf3dTestResult');

        if (!username || !password) {
            if (resultDiv) {
                resultDiv.innerHTML = '<span style="color:var(--red);">? 请输入用户名和密码</span>';
            }
            return;
        }

        if (resultDiv) {
            resultDiv.innerHTML = '<span style="color:var(--text2);">? 正在登录...</span>';
        }

        fetch('/api/zf3d/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                if (resultDiv) {
                    resultDiv.innerHTML = '<span style="color:var(--green);">? 登录成功！</span>';
                }
                // 清空密码框
                var pwdInput = document.getElementById('zf3d-password');
                if (pwdInput) pwdInput.value = '';
                self.zf3dRefreshStatus();
            } else {
                if (resultDiv) {
                    resultDiv.innerHTML = '<span style="color:var(--red);">? ' + (data.error || '登录失败') + '</span>';
                }
            }
        })
        .catch(function(err) {
            if (resultDiv) {
                resultDiv.innerHTML = '<span style="color:var(--red);">? 网络错误：' + err.message + '</span>';
            }
        });
    },

    // ===== 朱峰社区：退出登录 =====
    zf3dLogout: function() {
        var self = this;
        // 清除本地 cookie 数据
        fetch('/api/db/app_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'delete',
                filter: { category: 'zf3d' }
            })
        })
        .then(function(r) { return r.json(); })
        .then(function() {
            // 更新 UI
            self.zf3dShowLoginForm();
            var resultDiv = document.getElementById('zf3dTestResult');
            if (resultDiv) {
                resultDiv.innerHTML = '<span style="color:var(--text2);">已退出登录</span>';
            }
        })
        .catch(function() {
            // 即使删除失败也切换UI
            self.zf3dShowLoginForm();
        });
    },

    // ===== 朱峰社区：Toast 通知 =====
    zf3dToast: function(msg, type) {
        type = type || 'info';
        var colors = { success: '#28a745', error: '#dc3545', info: '#17a2b8' };
        var icons = { success: '✅', error: '❌', info: '💡' };
        var el = document.createElement('div');
        el.style.cssText =
            'background:var(--bg-card,#2a2a2a);border:1px solid ' + (colors[type] || colors.info) + ';' +
            'border-radius:8px;padding:12px 16px;font-size:14px;color:var(--text,#eee);' +
            'box-shadow:0 4px 16px rgba(0,0,0,0.3);max-width:380px;word-break:break-all;';
        el.innerHTML = '<span style="margin-right:6px;">' + (icons[type] || icons.info) + '</span>' + msg;
        if (window.ToastStack) {
            window.ToastStack.show(el, type === 'error' ? 5000 : 3000);
        } else {
            document.body.appendChild(el);
            setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
        }
    },

    // ===== 朱峰社区：签到 =====
    zf3dCheckin: function() {
        var self = this;
        var btn = document.getElementById('zf3d-checkin-btn');
        var resultDiv = document.getElementById('zf3d-checkin-result');
        var infoDiv = document.getElementById('zf3d-checkin-info');
        var fromMenu = !resultDiv;  // 从右上角菜单触发时没有面板元素

        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ 签到中...';
        }
        if (resultDiv) {
            resultDiv.innerHTML = '<span style="color:var(--text2);">⏳ 正在签到...</span>';
        }
        if (fromMenu) {
            self.zf3dToast('正在签到...', 'info');
        }

        fetch('/api/zf3d/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                var msg = '';
                if (data.data) {
                    if (data.data.message) msg = data.data.message;
                    else if (data.data.msg) msg = data.data.msg;
                    else if (data.data.data && data.data.data.message) msg = data.data.data.message;
                    else if (data.data.data && data.data.data.msg) msg = data.data.data.msg;
                    else if (data.data.raw) msg = data.data.raw.substring(0, 200);
                    else msg = '签到成功！';
                } else {
                    msg = '签到成功！';
                }
                if (resultDiv) {
                    resultDiv.innerHTML = '<span style="color:var(--green);">? ' + msg + '</span>';
                }
                if (fromMenu) {
                    self.zf3dToast(msg, 'success');
                }
                setTimeout(function() { self.zf3dRefreshStatus(); }, 1000);
                setTimeout(function() { self._zf3dRefreshCheckinForMenu(); }, 1500);
            } else {
                // ===== 兜底：即使 ok=false，只要返回数据里有成功迹象，也判定为签到成功 =====
                var _dd = data.data || data;
                var _hasOk = (_dd && (
                    _dd.success === true ||
                    _dd.code === 0 || _dd.code === 200 || _dd.code === '0' || _dd.code === '200' ||
                    _dd.status === 'ok' || _dd.status === 'success' ||
                    (typeof _dd.msg === 'string' && (/成功|已签到|已领取/.test(_dd.msg))) ||
                    (typeof _dd.message === 'string' && (/成功|已签到|已领取/.test(_dd.message))) ||
                    (_dd.data && typeof _dd.data === 'object' && (
                        _dd.data.success === true || _dd.data.code === 0 || _dd.data.code === 200 ||
                        (typeof _dd.data.msg === 'string' && /成功|已签到|已领取/.test(_dd.data.msg)) ||
                        (typeof _dd.data.message === 'string' && /成功|已签到|已领取/.test(_dd.data.message))
                    ))
                ));
                if (_hasOk) {
                    // 真正的签到成功，后端误判了 ok 字段
                    var _msg = _dd.msg || _dd.message || (_dd.data && (_dd.data.msg || _dd.data.message)) || '签到成功！';
                    if (resultDiv) {
                        resultDiv.innerHTML = '<span style="color:var(--green);">? ' + _msg + '</span>';
                    }
                    if (fromMenu) {
                        self.zf3dToast(_msg, 'success');
                    }
                    setTimeout(function() { self.zf3dRefreshStatus(); }, 1000);
                    setTimeout(function() { self._zf3dRefreshCheckinForMenu(); }, 1500);
                    console.log('[签到] 后端返回 ok:false 但数据含成功标志，按成功处理', data);
                } else {
                    if (resultDiv) {
                        resultDiv.innerHTML = '<span style="color:var(--red);">? ' + (data.error || '签到失败') + '</span>';
                    }
                    if (fromMenu) {
                        self.zf3dToast(data.error || '签到失败', 'error');
                    }
                    if (data.error && data.error.indexOf('登录') >= 0) {
                        self.zf3dShowLoginForm();
                    }
                    console.error('[签到] 失败', data);
                }
            }
        })
        .catch(function(err) {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📅 每日签到';
            }
            if (resultDiv) {
                resultDiv.innerHTML = '<span style="color:var(--red);">? 网络错误：' + err.message + '</span>';
            }
            if (fromMenu) {
                self.zf3dToast('网络错误：' + err.message, 'error');
            }
        });
    },

    // ===== 朱峰社区：刷新状态 =====
    zf3dRefreshStatus: function() {
        var self = this;
        fetch('/api/zf3d/status', { method: 'GET' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok && data.logged_in) {
                self.zf3dShowStatusArea(data.username, data.checkin);
            } else {
                self.zf3dShowLoginForm();
            }
        })
        .catch(function() {
            self.zf3dShowLoginForm();
        });
    },

    // ===== 朱峰社区：显示登录表单 =====
    zf3dShowLoginForm: function() {
        var loginArea = document.getElementById('zf3d-login-area');
        var statusArea = document.getElementById('zf3d-status-area');
        if (loginArea) loginArea.style.display = '';
        if (statusArea) statusArea.style.display = 'none';
    },

    // ===== 朱峰社区：显示状态区域 =====
    zf3dShowStatusArea: function(username, checkinInfo) {
        var loginArea = document.getElementById('zf3d-login-area');
        var statusArea = document.getElementById('zf3d-status-area');
        var userSpan = document.getElementById('zf3d-current-user');
        var infoDiv = document.getElementById('zf3d-checkin-info');

        if (loginArea) loginArea.style.display = 'none';
        if (statusArea) statusArea.style.display = '';
        if (userSpan) userSpan.textContent = username;

        // 显示签到信息
        if (infoDiv && checkinInfo) {
            var html = '';
            if (checkinInfo.checked_today) {
                html += '<div style="padding:8px 12px;border-radius:4px;background:rgba(40,167,69,0.1);margin-bottom:8px;">';
                html += '? 今日已签到';
                html += '</div>';
            } else {
                html += '<div style="padding:8px 12px;border-radius:4px;background:rgba(255,193,7,0.1);margin-bottom:8px;">';
                html += '👉 今日尚未签到，点击上方按钮签到';
                html += '</div>';
            }
            if (checkinInfo.continuous_days !== undefined) {
                html += '<div>🔥 连续签到：<b>' + checkinInfo.continuous_days + '</b> 天</div>';
            }
            if (checkinInfo.total_days !== undefined) {
                html += '<div>📅 累计签到：<b>' + checkinInfo.total_days + '</b> 天</div>';
            }
            if (checkinInfo.points !== undefined) {
                html += '<div>⭐ 积分：<b>' + checkinInfo.points + '</b></div>';
            }
            infoDiv.innerHTML = html;
        } else if (infoDiv) {
            infoDiv.innerHTML = '<div style="font-size:12px;color:var(--text2);">点击「刷新状态」可查看签到详情</div>';
        }
    },

    // ===== 朱峰社区：保存心跳API Key配置 =====
    zf3dSaveHeartbeatConfig: function() {
        var apiKey = (document.getElementById('zf3d-heartbeat-apikey') || {}).value || '';
        var statusDiv = document.getElementById('zf3d-heartbeat-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<span style="color:var(--text2);">? 保存中...</span>';
        }
        fetch('/api/zf3d/heartbeat-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                if (statusDiv) {
                    statusDiv.innerHTML = '<span style="color:var(--green);">? API Key 已保存</span>';
                }
                App.zf3dRefreshHeartbeatStatus();
            } else {
                if (statusDiv) {
                    statusDiv.innerHTML = '<span style="color:var(--red);">? ' + (data.error || '保存失败') + '</span>';
                }
            }
        })
        .catch(function(err) {
            if (statusDiv) {
                statusDiv.innerHTML = '<span style="color:var(--red);">? 网络错误：' + err.message + '</span>';
            }
        });
    },

    // ===== 朱峰社区：刷新心跳状态 =====
    zf3dRefreshHeartbeatStatus: function() {
        var statusDiv = document.getElementById('zf3d-heartbeat-status');
        var apiKeyInput = document.getElementById('zf3d-heartbeat-apikey');
        if (statusDiv) {
            statusDiv.innerHTML = '<span style="color:var(--text2);">? 查询中...</span>';
        }
        fetch('/api/zf3d/heartbeat-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok && data.data) {
                var s = data.data;
                if (apiKeyInput && s.api_key_masked) {
                    apiKeyInput.placeholder = s.api_key_masked;
                }
                var html = '';
                html += '<div style="margin-bottom:6px;"> Machine ID: <code>' + s.machine_id + '</code></div>';
                if (s.api_key_configured) {
                    html += '<div style="margin-bottom:6px;">? API Key: ' + s.api_key_masked + '</div>';
                } else {
                    html += '<div style="margin-bottom:6px;color:var(--text2);">⚠️ 未配置 API Key</div>';
                }
                html += '<div style="margin-bottom:6px;"> Status: ' + (s.running ? '🟢 运行中' : '🔴 已停止') + '</div>';
                html += '<div style="margin-bottom:6px;"> 登录状态: ' + (s.logged_in === 1 ? '🟢 已登录 (' + s.username + ')' : (s.logged_in === -1 ? '🟡 管理员(跳过心跳)' : '🔴 未登录')) + '</div>';
                html += '<div style="margin-bottom:6px;"> 上报间隔: ' + s.interval + ' 秒</div>';
                html += '<div> 上报地址: ' + s.website + '/api/agent_api.asp</div>';
                if (statusDiv) statusDiv.innerHTML = html;
            } else {
                if (statusDiv) {
                    statusDiv.innerHTML = '<span style="color:var(--red);">? ' + (data.error || '查询失败') + '</span>';
                }
            }
        })
        .catch(function(err) {
            if (statusDiv) {
                statusDiv.innerHTML = '<span style="color:var(--red);">? 网络错误：' + err.message + '</span>';
            }
        });
    },

    // ===== 覆写 switchSettingsTab 以支持 zf3d 面板初始化 =====
    _origSwitchSettingsTab: null,
    _patchedSwitchSettingsTab: function() {
        if (this._origSwitchSettingsTab === null) {
            try {
                                this._origSwitchSettingsTab = this.switchSettingsTab.bind(this);
                            } catch (e) {
                                this._origSwitchSettingsTab = function () { /* fallback no-op */ };
                                if (typeof console !== 'undefined') console.warn('[zf3d] switchSettingsTab.bind failed:', e);
                            }
        }
    },
    // ===== 朱峰社区右上角：显示登录遮罩 =====
    zf3dTopbarShowLogin: function() {
        var ov = document.getElementById('zf3dLoginOverlay');
        if (ov) {
            ov.style.display = 'flex';
            var err = document.getElementById('zf3dLoginError');
            if (err) err.style.display = 'none';
            setTimeout(function() {
                var inp = document.getElementById('zf3dLoginUsername');
                if (inp) inp.focus();
            }, 100);
        }
    },

    // ===== 朱峰社区右上角：隐藏登录遮罩 =====
    zf3dTopbarHideLogin: function() {
        var ov = document.getElementById('zf3dLoginOverlay');
        if (ov) ov.style.display = 'none';
        // 清空输入
        var u = document.getElementById('zf3dLoginUsername');
        var p = document.getElementById('zf3dLoginPassword');
        if (u) u.value = '';
        if (p) p.value = '';
    },

    // ===== 朱峰社区右上角：执行登录 =====
    zf3dTopbarDoLogin: function() {
        var self = this;
        var username = (document.getElementById('zf3dLoginUsername') || {}).value || '';
        var password = (document.getElementById('zf3dLoginPassword') || {}).value || '';
        var errDiv = document.getElementById('zf3dLoginError');
        var btn = document.getElementById('zf3dLoginBtn');

        if (!username || !password) {
            if (errDiv) { errDiv.textContent = '请输入用户名和密码'; errDiv.style.display = 'block'; }
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = '登录中...'; }
        if (errDiv) errDiv.style.display = 'none';

        fetch('/api/zf3d/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (btn) { btn.disabled = false; btn.textContent = '登录'; }
            if (data.ok) {
                self.zf3dTopbarHideLogin();
                // 同时更新设置面板里的状态
                self.zf3dRefreshStatus();
                // 更新右上角 UI
                self.zf3dTopbarRefreshUI(true, username);
            } else {
                var msg = data.error || '登录失败';
                if (msg === 'zf3d module removed') {
                    msg = '朱峰社区登录服务未启用（zf3d 模块已剥离），暂无法登录';
                }
                if (errDiv) { errDiv.textContent = msg; errDiv.style.display = 'block'; }
            }
        })
        .catch(function(err) {
            if (btn) { btn.disabled = false; btn.textContent = '登录'; }
            if (errDiv) { errDiv.textContent = '网络错误：' + err.message; errDiv.style.display = 'block'; }
        });
    },

    // ===== 朱峰社区右上角：显示用户下拉菜单 =====
    zf3dTopbarShowUserMenu: function(ev) {
        var self = this;
        // 关闭已有菜单
        var existing = document.querySelector('.zf3d-user-menu');
        if (existing) { existing.remove(); return; }

        var entry = document.getElementById('zf3dUserEntry');
        if (!entry) return;
        var rect = entry.getBoundingClientRect();

        var username = (document.getElementById('zf3dUserName') || {}).textContent || '用户';
        var avatar = (document.getElementById('zf3dUserAvatar') || {}).textContent || '?';

        var menu = document.createElement('div');
        menu.className = 'zf3d-user-menu';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.right = (window.innerWidth - rect.right) + 'px';

        menu.innerHTML =
            '<div class="zf3d-user-menu-header">' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                    '<div class="zf3d-topbar-avatar" style="width:28px;height:28px;font-size:13px">' + avatar + '</div>' +
                    '<div>' +
                        '<div style="font-size:13px;font-weight:bold;color:var(--text)">' + username + '</div>' +
                        '<div style="font-size:11px;color:var(--text2)">朱峰社区账号</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="zf3d-user-menu-item" id="zf3dMenuCheckin">📅 每日签到</div>' +
            '<div class="zf3d-user-menu-item danger" onclick="App.zf3dTopbarLogout()">退出登录</div>';

        document.body.appendChild(menu);

        // 异步查签到状态
        self._zf3dRefreshCheckinForMenu();

        // 点击外部关闭
        setTimeout(function() {
            document.addEventListener('click', _closeMenu);
        }, 0);

        function _closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', _closeMenu);
            }
        }
    },

    // ===== 异步刷新菜单中的签到状态 =====
    _zf3dRefreshCheckinForMenu: function() {
        var checkinItem = document.getElementById('zf3dMenuCheckin');
        if (!checkinItem) return;

        checkinItem.onclick = function() { App.zf3dCheckin(); };
        checkinItem.classList.remove('disabled');
        fetch('/api/zf3d/status', { method: 'GET' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok && data.logged_in && data.checkin) {
                var ci = data.checkin;
                var label = '📅 每日签到';
                if (ci.checked_today) {
                    label = '✅ 今日已签到';
                    if (ci.continuous_days !== undefined) label += ' (' + ci.continuous_days + '天)';
                    checkinItem.classList.add('disabled');
                    checkinItem.onclick = null;
                }
                checkinItem.textContent = label;
            }
        })
        .catch(function() {});
    },

    // ===== 打开设置面板的朱峰社区tab =====
    zf3dTopbarOpenSettings: function() {
        // 关闭菜单
        var menu = document.querySelector('.zf3d-user-menu');
        if (menu) menu.remove();
        // 打开设置面板
        var overlay = document.getElementById('settingsOverlay');
        if (overlay) overlay.classList.add('show');
        if (this.switchSettingsTab) this.switchSettingsTab('zf3d');
    },

    // ===== 朱峰社区右上角：退出登录 =====
    zf3dTopbarLogout: function() {
        var self = this;
        // 关闭菜单
        var menu = document.querySelector('.zf3d-user-menu');
        if (menu) menu.remove();

        // 清除本地 cookie 数据
        fetch('/api/db/app_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'delete',
                filter: { category: 'zf3d' }
            })
        })
        .then(function(r) { return r.json(); })
        .then(function() {
            // 更新右上角 UI
            self.zf3dTopbarRefreshUI(false, '');
            // 更新设置面板
            self.zf3dShowLoginForm();
        })
        .catch(function() {
            // 即使删除失败也更新UI
            self.zf3dTopbarRefreshUI(false, '');
            self.zf3dShowLoginForm();
        });
    },

    // ===== 朱峰社区右上角：更新UI状态 =====
    zf3dTopbarRefreshUI: function(loggedIn, username) {
        var loginEntry = document.getElementById('zf3dLoginEntry');
        var userEntry = document.getElementById('zf3dUserEntry');
        var userNameEl = document.getElementById('zf3dUserName');
        var avatarEl = document.getElementById('zf3dUserAvatar');

        if (loggedIn) {
            if (loginEntry) loginEntry.style.display = 'none';
            if (userEntry) userEntry.classList.add('active');
            if (userNameEl) userNameEl.textContent = username;
            // 头像：取用户名首字
            if (avatarEl) {
                var first = (username || '?').charAt(0).toUpperCase();
                avatarEl.textContent = first;
            }
        } else {
            if (loginEntry) loginEntry.style.display = 'flex';
            if (userEntry) userEntry.classList.remove('active');
            if (userNameEl) userNameEl.textContent = '';
            if (avatarEl) avatarEl.textContent = '';
        }
    },

    // ===== 朱峰社区右上角：启动时检查登录状态 =====
    zf3dTopbarInit: function() {
        var self = this;        fetch('/api/zf3d/status', { method: 'GET' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok && data.logged_in) {
                self.zf3dTopbarRefreshUI(true, data.username);
            } else {
                self.zf3dTopbarRefreshUI(false, '');
            }
        })
        .catch(function() {
            self.zf3dTopbarRefreshUI(false, '');
        });
    },
});

// 覆写 switchSettingsTab 以在切到 zf3d 面板时刷新状态
// 防御：若原函数不存在（旧缓存/加载顺序问题），使用内置兜底实现，避免 undefined.call 崩溃
(function() {
    var _orig = (typeof App !== 'undefined' && typeof App.switchSettingsTab === 'function') ? App.switchSettingsTab : null;

    // 内置兜底实现：与 app-panels.js 的 switchSettingsTab 逻辑一致，兼容两种 DOM 结构
    function fallbackSwitch(tab) {
        try {
            var tabs = document.querySelectorAll('.settings-tab, .settings-nav-item');
            tabs.forEach(function (t) {
                var name = t.dataset.tab || t.dataset.settingsTab;
                if (name) t.classList.toggle('active', name === tab);
            });
            var panels = document.querySelectorAll('.settings-panel');
            panels.forEach(function (p) { p.classList.toggle('active', p.id === ('settingsPanel-' + tab).replace('settingsPanel-settingsPanel-', 'settingsPanel-')); });
            if (tab === 'models' && typeof App.renderModelList === 'function') App.renderModelList();
        } catch (e) {
            console.warn('[zf3d] switchSettingsTab fallback error:', e);
        }
    }

    App.switchSettingsTab = function(tab) {
        if (_orig) {
            _orig.call(this, tab);
            document.querySelectorAll('.settings-nav-item, .settings-tab').forEach(function (item) {
                var name = item.dataset.settingsTab || item.dataset.tab;
                item.classList.toggle('active', name === tab);
            });
            document.querySelectorAll('.settings-panel').forEach(function (panel) {
                panel.classList.toggle('active', panel.id === 'settingsPanel-' + tab);
            });
        } else {
            fallbackSwitch(tab);
        }
        if (tab === 'zf3d') {
            // 延迟一下确保面板已显示
            setTimeout(function() {
                if (App.zf3dRefreshStatus) App.zf3dRefreshStatus();
                if (App.zf3dRefreshHeartbeatStatus) App.zf3dRefreshHeartbeatStatus();
            }, 100);
        }
    };
    // Keep the first visible panel valid when the settings modal opens.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { fallbackSwitch('models'); });
    } else {
        fallbackSwitch('models');
    }

})();

// 页面加载后自动检查朱峰社区登录状态（右上角）
(function() {
    function initTopbar() {
        if (typeof App !== 'undefined' && App.zf3dTopbarInit) {
            App.zf3dTopbarInit();
        } else {
            setTimeout(initTopbar, 200);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(initTopbar, 300); });
    } else {
        setTimeout(initTopbar, 300);
    }
})();


