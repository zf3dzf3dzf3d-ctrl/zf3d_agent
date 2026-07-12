/**
 * 网站登录管理模块
 * 负责与 zf3d.com 网站认证系统对接
 * 分层锁定：基础功能免登录，节点工作流等高级功能需登录
 * 🔒加密发布：含签到API调用/登录状态管理，发布时必须JS混淆
 */
window.agentAuth = (function() {
    var 已登录 = false;
    var 用户信息 = null;

    /**
     * 检查登录状态（启动时调用）
     */
    async function 初始化() {
        try {
            var resp = await fetch('/api/agent-status');
            var data = await resp.json();
            if (data.已登录) {
                已登录 = true;
                用户信息 = data.用户;
                更新界面();
                // 恢复登录后刷新员工列表
                if (window.empWidget && window.empWidget.refresh) {
                    setTimeout(function() { window.empWidget.refresh(); }, 200);
                }
            }
        } catch(e) {
            console.log('登录状态检查失败:', e);
        }
    }

    /**
     * 显示登录遮罩
     */
    function 显示登录() {
        var ov = document.getElementById('loginOverlay');
        if (ov) {
            ov.style.display = 'flex';
            var err = document.getElementById('loginError');
            if (err) err.style.display = 'none';
            setTimeout(function() {
                var inp = document.getElementById('loginUsername');
                if (inp) inp.focus();
            }, 100);
        }
    }

    /**
     * 隐藏登录遮罩
     */
    function 隐藏登录() {
        var ov = document.getElementById('loginOverlay');
        if (ov) ov.style.display = 'none';
    }

    /**
     * 执行登录
     */
    async function 登录() {
        var 用户名 = document.getElementById('loginUsername').value.trim();
        var 密码 = document.getElementById('loginPassword').value;
        var errDiv = document.getElementById('loginError');
        var btn = document.getElementById('loginBtn');

        if (!用户名 || !密码) {
            errDiv.textContent = '请输入用户名和密码';
            errDiv.style.display = 'block';
            return;
        }

        btn.disabled = true;
        btn.textContent = '登录中...';
        errDiv.style.display = 'none';

        try {
            var resp = await fetch('/api/agent-login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: 用户名, password: 密码})
            });
            var data = await resp.json();

            if (data.成功) {
                已登录 = true;
                用户信息 = data.用户;
                更新界面();
                隐藏登录();
                if (window.showToast) showToast('success', '登录成功', '欢迎 ' + (用户信息.username || ''));
                // 登录成功后刷新员工列表和工作流
                if (window.empWidget && window.empWidget.refresh) {
                    setTimeout(function() { window.empWidget.refresh(); }, 200);
                }
                // 执行待执行的回调（如打开节点工作流）
                if (window._agentAuthPendingCallback) {
                    var cb = window._agentAuthPendingCallback;
                    window._agentAuthPendingCallback = null;
                    setTimeout(function() { cb(); }, 100);
                }
            } else {
                errDiv.textContent = '登录失败: ' + JSON.stringify(data);
                errDiv.style.display = 'block';
            }
        } catch(e) {
            errDiv.textContent = '网络错误: ' + e.message;
            errDiv.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = '登录';
        }
    }

    /**
     * 登出
     */
    async function 登出() {
        var m = document.getElementById('userMenuDropdown');
        if (m) m.remove();
        try {
            await fetch('/api/agent-logout', {method: 'POST'});
        } catch(e) {}
        已登录 = false;
        用户信息 = null;
        更新界面();
        if (window.showToast) showToast('info', '已退出登录');
    }

    /**
     * 更新界面显示
     */
    function 更新界面() {
        var userInfo = document.getElementById('userInfo');
        var loginEntry = document.getElementById('loginEntry');
        var wfBtn = document.getElementById('wfToggleBtn');

        if (已登录 && 用户信息) {
            if (userInfo) {
                userInfo.style.display = 'flex';
                var avatar = document.getElementById('userAvatar');
                var name = document.getElementById('userName');
                if (avatar) {
                    var 头像 = 用户信息.avatar || '';
                    if (头像) {
                        if (!头像.startsWith('http') && !头像.startsWith('data:')) {
                            头像 = 'https://www.zf3d.com/' + 头像.replace(/^\/+/, '');
                        }
                    } else {
                        头像 = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="%23444"/></svg>';
                    }
                    avatar.src = 头像;
                    avatar.onerror = function() {
                        this.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="%23444"/></svg>';
                        this.onerror = null;
                    };
                }
                if (name) name.textContent = 用户信息.username || '';
            }
            if (loginEntry) loginEntry.style.display = 'none';
            if (wfBtn) {
                wfBtn.title = '节点工作流';
                wfBtn.style.opacity = '1';
            }
        } else {
            if (userInfo) userInfo.style.display = 'none';
            if (loginEntry) loginEntry.style.display = 'flex';
            if (wfBtn) {
                wfBtn.title = '节点工作流（需登录）';
                wfBtn.style.opacity = '0.5';
            }
        }
    }

    /**
     * 检查是否已登录，未登录则显示登录框
     * @param {Function} 回调 - 登录成功后执行的回调
     */
    function 需要登录(回调) {
        if (已登录) {
            if (回调) 回调();
        } else {
            显示登录();
            // 存储回调，登录成功后执行
            window._agentAuthPendingCallback = 回调;
        }
    }

    /**
     * 显示用户菜单（点击用户名）
     */
    function 显示用户菜单() {
        if (!已登录) return;
        var old = document.getElementById('userMenuDropdown');
        if (old) { old.remove(); return; }
        var userInfo = document.getElementById('userInfo');
        if (!userInfo) return;
        var rect = userInfo.getBoundingClientRect();
        var menu = document.createElement('div');
        menu.id = 'userMenuDropdown';
        menu.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;right:8px;background:var(--bg-card,#1e1e2e);border:1px solid var(--border,#333);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:99997;min-width:180px;overflow:hidden';
        var vip = 用户信息.vip_start && 用户信息.vip_end;
        var vipText = vip ? (用户信息.vip_start + ' ~ ' + 用户信息.vip_end) : '未开通';
        menu.innerHTML =
            '<div style="padding:12px 14px;border-bottom:1px solid var(--border,#333)">' +
                '<div style="font-size:13px;font-weight:bold;color:var(--text,#ddd)">' + (用户信息.username || '') + '</div>' +
                '<div style="font-size:11px;color:var(--text2,#888);margin-top:3px">' + (用户信息.email || '') + '</div>' +
                '<div style="font-size:11px;color:var(--text2,#888);margin-top:2px">积分: ' + (用户信息.points || 0) + ' | VIP: ' + vipText + '</div>' +
            '</div>' +
            '<div id="checkinMenuItem" onclick="event.stopPropagation();window.agentAuth.checkin()" style="padding:10px 14px;cursor:pointer;font-size:13px;color:var(--text,#ddd);transition:background 0.15s" onmouseover="this.style.background=\'rgba(255,255,255,0.08)\'" onmouseout="this.style.background=\'transparent\'">📅 每日签到</div>' +
            '<div onclick="event.stopPropagation();window.agentAuth.logout()" style="padding:10px 14px;cursor:pointer;font-size:13px;color:#e74c3c;transition:background 0.15s" onmouseover="this.style.background=\'rgba(231,76,60,0.1)\'" onmouseout="this.style.background=\'transparent\'">退出登录</div>';
        document.body.appendChild(menu);
        // 异步查签到状态，更新菜单显示
        _refreshCheckinStatus();
        // 点击外部关闭
        setTimeout(function() {
            document.addEventListener('click', function closer(e) {
                var m = document.getElementById('userMenuDropdown');
                if (m && !m.contains(e.target) && !userInfo.contains(e.target)) {
                    m.remove();
                    document.removeEventListener('click', closer);
                }
            });
        }, 0);
    }

    async function _refreshCheckinStatus() {
        try {
            var resp = await fetch('/api/agent-checkin-status', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
            var data = await resp.json();
            var item = document.getElementById('checkinMenuItem');
            if (!item) return;
            var d = data.data || data.数据 || {};
            if (d.checked_in_today) {
                var html = '✅ 今日已签';
                if (d.continuous_days) html += '（连续' + d.continuous_days + '天）';
                item.innerHTML = html;
                item.style.color = 'var(--text2,#888)';
                item.style.cursor = 'default';
                item.onclick = null;
            }
        } catch(e) {}
    }

    // 监听登录成功后执行回调
    var _原始隐藏登录 = null;

    /**
     * 每日签到
     */
    async function 签到() {
        var menu = document.getElementById('userMenuDropdown');
        if (menu) menu.remove();
        try {
            var resp = await fetch('/api/agent-checkin', {method: 'POST'});
            var data = await resp.json();
            if (data.success || data.成功) {
                var d = data.data || data.数据 || {};
                var msg = '签到成功！';
                if (d.points_awarded) msg += ' +' + d.points_awarded + '积分';
                if (d.continuous_days) msg += '（连续' + d.continuous_days + '天）';
                if (d.total_points) msg += '\n总积分: ' + d.total_points;
                if (window.showToast) showToast('success', '签到成功', msg);
                else alert(msg);
                // 更新积分显示
                if (d.total_points && 用户信息) {
                    用户信息.points = d.total_points;
                }
            } else {
                var errMsg = data.message || data.错误 || data.error || '签到失败';
                var isAlreadyCheckedIn = errMsg.indexOf('已经') >= 0 || errMsg.indexOf('已') >= 0;
                if (window.showToast) showToast(isAlreadyCheckedIn ? 'info' : 'error', isAlreadyCheckedIn ? '已签到' : '签到', errMsg);
                else alert(errMsg);
            }
        } catch(e) {
            if (window.showToast) showToast('error', '签到', '网络错误: ' + e.message);
            else alert('签到失败: ' + e.message);
        }
    }

    return {
        init: 初始化,
        doLogin: 登录,
        showLogin: 显示登录,
        hideLogin: 隐藏登录,
        logout: 登出,
        requireLogin: 需要登录,
        showUserMenu: 显示用户菜单,
        checkin: 签到,
        isLoggedIn: function() { return 已登录; },
        getUser: function() { return 用户信息; }
    };
})();
