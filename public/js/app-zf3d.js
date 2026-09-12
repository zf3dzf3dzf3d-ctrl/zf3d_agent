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
    // ===== 顶栏：时间 + 天气小组件 =====
    zf3dCwWmoMap: {
        0:['☀️','晴'],1:['🌤️','多云'],2:['⛅','多云'],3:['☁️','阴'],
        45:['🌫️','雾'],48:['🌫️','雾凇'],51:['🌦️','小雨'],53:['🌦️','中雨'],55:['🌧️','大雨'],
        56:['🌧️','冻雨'],57:['🌧️','冻雨'],61:['🌦️','小雨'],63:['🌧️','中雨'],65:['🌧️','大雨'],
        66:['🌧️','冻雨'],67:['🌧️','冻雨'],71:['🌨️','小雪'],73:['🌨️','中雪'],75:['❄️','大雪'],
        77:['❄️','雪粒'],80:['🌦️','阵雨'],81:['🌧️','阵雨'],82:['⛈️','强阵雨'],
        85:['🌨️','阵雪'],86:['❄️','阵雪'],95:['⛈️','雷雨'],96:['⛈️','雷雨冰雹'],99:['⛈️','雷雨冰雹']
    },
    zf3dCwWeekMap: ['日','一','二','三','四','五','六'],
    // 天气文字描述（按天气名映射）
    zf3dCwDescMap: {
        '晴': '阳光正好，适合出门走走',
        '多云': '云层渐多，天气依然舒适',
        '阴': '天色阴沉，出门可备一件外套',
        '雾': '有雾出行，注意交通安全',
        '雾凇': '雾凇美景，路面湿滑小心慢行',
        '小雨': '下小雨了，出门记得带伞',
        '中雨': '雨势渐大，尽量减少外出',
        '大雨': '大雨滂沱，请注意防范积水',
        '冻雨': '冻雨路滑，出行务必小心',
        '小雪': '初雪飘落，注意保暖防滑',
        '中雪': '雪花纷飞，出行注意路滑',
        '大雪': '大雪纷飞，注意保暖和出行安全',
        '雪粒': '雪粒簌簌，天寒地冻多添衣',
        '阵雨': '阵雨说来就来，随身带伞',
        '强阵雨': '强阵雨来袭，尽量避免外出',
        '阵雪': '阵雪飘落，路面可能结冰',
        '雷雨': '雷电交加，请留在室内躲避',
        '雷雨冰雹': '雷雨伴冰雹，切勿外出，关好门窗',
        '未知': '天气信息暂不可用'
    },
    zf3dCwSetDesc: function(wxName) {
        var d = document.getElementById('zf3dCwWxDesc');
        if (!d) return;
        var desc = this.zf3dCwDescMap[wxName];
        if (desc) {
            d.textContent = desc;
            d.classList.add('zf3d-cw-show');
        } else {
            d.classList.remove('zf3d-cw-show');
        }
    },
    // ===== 农历算法（1900-2100）=====
    zf3dLunarInfo: [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
        0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
        0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
        0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
        0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
        0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,
        0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
        0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,
        0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
        0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,
        0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
        0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
        0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
        0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
        0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
        0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,
        0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,
        0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,
        0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,
        0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,
        0x0d520],
    zf3dLunarGan: ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'],
    zf3dLunarZhi: ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'],
    zf3dLunarAnimals: ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'],
    zf3dLunarNum: ['正','二','三','四','五','六','七','八','九','十','冬','腊'],
    zf3dLunarDayStr: ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
        '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
        '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'],
    zf3dLunarMonthDays: function(y, m) {
        return (this.zf3dLunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29;
    },
    zf3dSolarToLunar: function(date) {
        var y = date.getFullYear(), base = 1900;
        var offset = Math.floor((Date.UTC(y, date.getMonth(), date.getDate()) -
            Date.UTC(base, 0, 31)) / 86400000);
        var i, days = 0, temp = 0, lunarY = base;
        // 逐月减天数定位农历年：offset < 当年总天数 说明日期落在当年
        for (i = 1900; i < 2101; i++) {
            temp = this.zf3dLunarYearDays(i);
            if (offset < temp) { lunarY = i; break; }
            offset -= temp;
        }
        var leap = this.zf3dLunarLeapMonth(lunarY);
        var isLeap = false, lunarM = 1;
        // 依次扣减各月天数定位农历月（闰月紧跟第 leap 月之后）
        for (i = 1; i <= 12; i++) {
            temp = this.zf3dLunarMonthDays(lunarY, i);
            if (offset < temp) { lunarM = i; break; }
            offset -= temp;
            if (leap > 0 && i === leap) {
                temp = this.zf3dLunarLeapDays(lunarY);
                if (offset < temp) { lunarM = i; isLeap = true; break; }
                offset -= temp;
            }
        }
        if (offset < 0) { offset += temp; }
        var ganIdx = (lunarY - 4) % 10, zhiIdx = (lunarY - 4) % 12;
        var yearStr = this.zf3dLunarGan[ganIdx] + this.zf3dLunarZhi[zhiIdx];
        var mStr = (isLeap ? '闰' : '') + this.zf3dLunarNum[lunarM - 1] + '月';
        var dStr = this.zf3dLunarDayStr[offset];
        return { year: lunarY, text: yearStr + '年（' + this.zf3dLunarAnimals[zhiIdx] + '）' + mStr + dStr };
    },
    zf3dLunarYearDays: function(y) {
        var sum = 348;
        for (var i = 0x8000; i > 0x8; i >>= 1) sum += (this.zf3dLunarInfo[y - 1900] & i) ? 1 : 0;
        return sum + this.zf3dLunarLeapDays(y);
    },
    zf3dLunarLeapMonth: function(y) { return this.zf3dLunarInfo[y - 1900] & 0xf; },
    zf3dLunarLeapDays: function(y) { return this.zf3dLunarLeapMonth(y) ? ((this.zf3dLunarInfo[y - 1900] & 0x10000) ? 30 : 29) : 0; },
    // ===== 天气动画场景 =====
    zf3dCwPhase: function(hour) {
        // 时段天色：dawn清晨(5-8) / day白天(8-17) / dusk傍晚(17-20) / night夜晚
        if (hour === undefined) hour = new Date().getHours();
        if (hour >= 5 && hour < 8) return 'dawn';
        if (hour >= 8 && hour < 17) return 'day';
        if (hour >= 17 && hour < 20) return 'dusk';
        return 'night';
    },
    zf3dCwApplyPhase: function() {
        var scene = document.getElementById('zf3dCwScene');
        if (!scene) return null;
        var phase = this.zf3dCwPhase();
        var changed = false;
        ['dawn', 'day', 'dusk', 'night'].forEach(function(p) {
            var has = scene.classList.contains('zf3d-cw-' + p);
            if (p === phase && !has) { scene.classList.add('zf3d-cw-' + p); changed = true; }
            if (p !== phase && has) { scene.classList.remove('zf3d-cw-' + p); changed = true; }
        });
        // 时段切换时重建场景内容（太阳/月亮/星星）
        if (changed) this.zf3dCwBuildScene(this.zf3dCwLastSceneKind || 'cloudy');
        return phase;
    },
    zf3dCwSceneKind: function(wmo) {
        // 返回场景类型：sunny/cloudy/rain/thunder/snow/fog
        if (wmo === 0 || wmo === 1) return 'sunny';
        if (wmo === 2 || wmo === 3) return 'cloudy';
        if (wmo === 45 || wmo === 48) return 'fog';
        if (wmo === 71 || wmo === 73 || wmo === 75 || wmo === 77 || wmo === 85 || wmo === 86) return 'snow';
        if (wmo === 95 || wmo === 96 || wmo === 99 || wmo === 82) return 'thunder';
        if (wmo >= 51) return 'rain';
        return 'cloudy';
    },
    zf3dCwBuildScene: function(kind) {
        var scene = document.getElementById('zf3dCwScene');
        if (!scene) return;
        this.zf3dCwLastSceneKind = kind;
        scene.className = 'zf3d-cw-scene zf3d-cw-' + kind + ' zf3d-cw-' + this.zf3dCwPhase();
        var html = '';
        var i;
        if (kind === 'sunny') {
            var hour = new Date().getHours();
            if (hour >= 6 && hour < 18) {
                html += '<div class="zf3d-cw-sun"><div class="zf3d-cw-sun-core"></div></div>';
            } else {
                html += '<div class="zf3d-cw-moon"></div>';
                for (i = 0; i < 6; i++) {
                    html += '<div class="zf3d-cw-star" style="left:' + (10 + Math.random() * 80) + '%;top:' + (10 + Math.random() * 40) + '%;animation-delay:' + (Math.random() * 2) + 's"></div>';
                }
            }
            for (i = 0; i < 2; i++) html += '<div class="zf3d-cw-cloud zf3d-cw-cloud-s" style="top:' + (55 + i * 18) + '%;animation-duration:' + (26 + i * 10) + 's"></div>';
        } else if (kind === 'cloudy') {
            html += '<div class="zf3d-cw-cloud"></div><div class="zf3d-cw-cloud zf3d-cw-cloud-s" style="top:60%;animation-duration:30s;animation-delay:-8s"></div>';
        } else if (kind === 'rain') {
            html += '<div class="zf3d-cw-cloud"></div>';
            for (i = 0; i < 12; i++) {
                html += '<div class="zf3d-cw-rain" style="left:' + (12 + i * 7) + '%;animation-delay:' + (Math.random() * 1.2) + 's"></div>';
            }
        } else if (kind === 'thunder') {
            html += '<div class="zf3d-cw-cloud zf3d-cw-cloud-dark"></div><div class="zf3d-cw-bolt">⚡</div>';
            for (i = 0; i < 10; i++) {
                html += '<div class="zf3d-cw-rain" style="left:' + (12 + i * 8) + '%;animation-delay:' + (Math.random() * 1.2) + 's"></div>';
            }
        } else if (kind === 'snow') {
            html += '<div class="zf3d-cw-cloud"></div>';
            for (i = 0; i < 10; i++) {
                html += '<div class="zf3d-cw-snow" style="left:' + (10 + i * 9) + '%;animation-delay:' + (Math.random() * 3) + 's"></div>';
            }
        } else if (kind === 'fog') {
            html += '<div class="zf3d-cw-cloud zf3d-cw-cloud-s" style="top:35%"></div>';
            for (i = 0; i < 3; i++) {
                html += '<div class="zf3d-cw-fog" style="top:' + (50 + i * 16) + '%;animation-delay:' + (i * 1.5) + 's"></div>';
            }
        }
        scene.innerHTML = html;
    },
    zf3dCwInit: function() {
        var self = this;
        function tick() {
            var el = document.getElementById('zf3dCwTime');
            var dEl = document.getElementById('zf3dCwDate');
            if (!el) return;
            var now = new Date();
            function p2(n) { return (n < 10 ? '0' : '') + n; }
            var h24 = now.getHours();
            var use12 = localStorage.getItem('zf3d_cw_time12') === '1';
            var h = h24, ampm = '';
            if (use12) {
                ampm = h24 < 6 ? '凌晨' : h24 < 9 ? '早上' : h24 < 12 ? '上午' : h24 < 13 ? '中午' : h24 < 18 ? '下午' : '晚上';
                h = h24 % 12; if (h === 0) h = 12;
            }
            var timeStr = p2(h) + ':' + p2(now.getMinutes());
            var blink = now.getSeconds() % 2 === 0;
            el.innerHTML = (ampm ? '<span class="zf3d-cw-ampm">' + ampm + '</span>' : '') + p2(h) + '<span class="zf3d-cw-colon' + (blink ? '' : ' zf3d-cw-colon-off') + '">:</span>' + p2(now.getMinutes());
            el.style.cursor = 'pointer';
            el.title = use12 ? '点击切换为24小时制' : '点击切换为12小时制';
            var greet = h24 < 5 ? '深夜' : h24 < 9 ? '早上好' : h24 < 12 ? '上午好' : h24 < 14 ? '中午好' : h24 < 18 ? '下午好' : h24 < 23 ? '晚上好' : '夜深了';
            self.zf3dCwApplyPhase();
            if (dEl) {
                var solar = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + self.zf3dCwWeekMap[now.getDay()];
                var lunar = self.zf3dSolarToLunar(now);
                dEl.innerHTML = '<span class="zf3d-cw-greet">' + greet + '</span> ' + solar;
                var lEl = document.getElementById('zf3dCwLunar');
                var bEl = document.getElementById('zf3dCwBigTime');
                if (bEl) bEl.innerHTML = p2(h) + '<span class="zf3d-cw-colon' + (blink ? '' : ' zf3d-cw-colon-off') + '">:</span>' + p2(now.getMinutes()) + '<span class="zf3d-cw-colon' + (blink ? '' : ' zf3d-cw-colon-off') + '">:</span>' + p2(now.getSeconds());
                var lEl = document.getElementById('zf3dCwLunar');
                if (lEl) {
                    lEl.textContent = '农历 ' + lunar.text;
                    lEl.title = '点击显示/隐藏天气';
                    if (!lEl.dataset.wInit) {
                        lEl.dataset.wInit = '1';
                        lEl.addEventListener('click', function(e) {
                            e.stopPropagation();
                            var w = document.getElementById('zf3dCwPopup');
                            if (w) w.classList.toggle('zf3d-cw-show');
                        });
                    }
                }
            }
        }
        // 点击弹窗外部时关闭已固定的弹窗
        if (!document.body.dataset.zf3dCwOutsideInit) {
            document.body.dataset.zf3dCwOutsideInit = '1';
            document.addEventListener('click', function(e) {
                var box = document.getElementById('zf3dClockWeather');
                var w = document.getElementById('zf3dCwPopup');
                if (w && box && !box.contains(e.target)) w.classList.remove('zf3d-cw-show');
            });
        }
        tick();
        // 点击时间：切换 12/24 小时制并立即重绘
        var timeEl = document.getElementById('zf3dCwTime');
        if (timeEl) {
            timeEl.addEventListener('click', function(e) {
                e.stopPropagation();
                localStorage.setItem('zf3d_cw_time12', localStorage.getItem('zf3d_cw_time12') === '1' ? '0' : '1');
                tick();
            });
        }
        setInterval(tick, 1000);
        // 恢复缓存的天气
        try {
            var cache = JSON.parse(localStorage.getItem('zf3d_cw_weather') || 'null');
            if (cache && cache.text) {
                var el2 = document.getElementById('zf3dCwWeather');
                if (el2) {
                    el2.textContent = cache.icon + ' ' + cache.temp + '℃ ' + cache.text;
                    el2.title = cache.city + ' ' + cache.text + '（点击刷新）';
                }
                self.zf3dCwSetDesc(cache.text);
                // 恢复缓存的天气场景（含雨/雪动画），旧缓存无 kind 时按文字推断
                self.zf3dCwBuildScene(cache.kind || (function(t) {
                    if (!t) return 'cloudy';
                    if (t.indexOf('雷') >= 0) return 'thunder';
                    if (t.indexOf('雨') >= 0) return 'rain';
                    if (t.indexOf('雪') >= 0) return 'snow';
                    if (t.indexOf('雾') >= 0 || t.indexOf('霾') >= 0) return 'fog';
                    if (t.indexOf('晴') >= 0) return 'sunny';
                    return 'cloudy';
                })(cache.text));
            }
        } catch (e) {}
        setTimeout(function() { self.zf3dCwLoadWeather(); }, 1500);
        setInterval(function() { self.zf3dCwLoadWeather(); }, 30 * 60 * 1000); // 每30分钟刷新
    },
    zf3dCwRefresh: function() {
        var el = document.getElementById('zf3dCwWeather');
        if (el) el.textContent = '🔄 刷新中...';
        var self = this;
        // 用户点击手势触发：首次点击时请求真实定位并缓存，后续直接用缓存
        if (navigator.geolocation && !localStorage.getItem('zf3dCwGeo')) {
            navigator.geolocation.getCurrentPosition(function(pos) {
                try {
                    localStorage.setItem('zf3dCwGeo', JSON.stringify({
                        lat: pos.coords.latitude.toFixed(3),
                        lon: pos.coords.longitude.toFixed(3),
                        city: '当前位置'
                    }));
                } catch (e) {}
                self.zf3dCwLoadWeather(true);
            }, function() {
                self.zf3dCwLoadWeather(true);
            }, { timeout: 5000 });
            return;
        }
        this.zf3dCwLoadWeather(true);
    },
    zf3dCwLoadWeather: function(force) {
        var self = this;
        // 定位（失败则用默认坐标：北京）
        function done(lat, lon, city) {
            fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
                  '&current=temperature_2m,weather_code&timezone=auto')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var cur = data.current || {};
                    var code = cur.weather_code != null ? cur.weather_code : 3;
                    var pair = self.zf3dCwWmoMap[code] || ['🌤️', '未知'];
                    var temp = Math.round(cur.temperature_2m != null ? cur.temperature_2m : 0);
                    var el = document.getElementById('zf3dCwWeather');
                    if (el) {
                        el.textContent = pair[0] + ' ' + temp + '℃ ' + pair[1];
                        el.title = city + ' ' + pair[1] + ' ' + temp + '℃（点击刷新）';
                        showLoc(city);
                    }
                    self.zf3dCwSetDesc(pair[1]);
                    self.zf3dCwBuildScene(self.zf3dCwSceneKind(code));
                    try {
                        localStorage.setItem('zf3d_cw_weather', JSON.stringify({
                            icon: pair[0], temp: temp, text: pair[1], city: city, kind: self.zf3dCwLastSceneKind, t: Date.now()
                        }));
                    } catch (e) {}
                })
                .catch(function() {
                    var el = document.getElementById('zf3dCwWeather');
                    if (el) el.textContent = '🌤️ --℃';
                    self.zf3dCwSetDesc('未知');
                });
        }
        var self = this;
        // 在天气栏显示用户位置
        function showLoc(city) {
            var locEl = document.getElementById('zf3dCwLoc');
            if (locEl && city) {
                locEl.textContent = city;
                locEl.title = '点击可切换精确定位（浏览器授权）';
                locEl.style.cursor = 'pointer';
                if (!locEl.dataset.preciseInit) {
                    locEl.dataset.preciseInit = '1';
                    locEl.addEventListener('click', function(ev) {
                        ev.stopPropagation();
                        self.zf3dCwPreciseLocate();
                    });
                }
            }
        }
        // 地址只获取一次即长期保存：有缓存就直接用（不再按时间过期），次日及以后都沿用同一位置
        var cached = null;
        try { cached = JSON.parse(localStorage.getItem('zf3dCwGeo') || 'null'); } catch (e) {}
        if (cached && cached.lat != null) {
            done(cached.lat, cached.lon, cached.city || '上次位置');
            return;
        }
        // 无感 IP 定位（走后端代理，免授权、后台自动），失败回退北京
        fetch('/api/geo/ip').then(function(r) { return r.json(); }).then(function(g) {
            if (g && g.ok && g.lat != null) {
                var city = [g.region, g.city].filter(Boolean).join(' ') || '定位';
                try { localStorage.setItem('zf3dCwGeo', JSON.stringify({ lat: g.lat, lon: g.lon, city: city, t: Date.now() })); } catch (e) {}
                done(g.lat, g.lon, city);
            } else {
                done(39.90, 116.40, '北京');
            }
        }).catch(function() {
            done(39.90, 116.40, '北京');
        });
    },

    // ===== 精确定位：点击天气栏位置后，询问用户并请求浏览器 GPS 授权 =====
    zf3dCwPreciseLocate: function() {
        var self = this;
        if (!navigator.geolocation) { alert('当前浏览器不支持精确定位'); return; }
        if (!confirm('当前显示的是 IP 定位的大概位置（可能不准，如显示北京）。\n\n需要精确定位吗？点击"确定"后请在浏览器弹窗中允许位置授权，将定位到你所在的城市并刷新天气。')) return;
        navigator.geolocation.getCurrentPosition(function(pos) {
            var lat = pos.coords.latitude, lon = pos.coords.longitude;
            // 反查城市名（走后端代理，避免跨域）
            fetch('/api/geo/reverse?lat=' + lat + '&lon=' + lon).then(function(r) { return r.json(); }).then(function(g) {
                var city = (g && g.ok && g.city) ? [g.region, g.city].filter(Boolean).join(' ') : '精确定位';
                try { localStorage.setItem('zf3dCwGeo', JSON.stringify({ lat: lat, lon: lon, city: city, t: Date.now(), precise: true })); } catch (e) {}
                var locEl = document.getElementById('zf3dCwLoc');
                if (locEl) locEl.textContent = city + ' ✦';
                if (self.zf3dCwRefresh) self.zf3dCwRefresh();
            }).catch(function() {
                try { localStorage.setItem('zf3dCwGeo', JSON.stringify({ lat: lat, lon: lon, city: '精确定位', t: Date.now(), precise: true })); } catch (e) {}
                if (self.zf3dCwRefresh) self.zf3dCwRefresh();
            });
        }, function(err) {
            alert('定位失败：' + (err.message || '未获得授权') + '\n\n可检查浏览器地址栏的位置权限设置后重试。');
        }, { enableHighAccuracy: true, timeout: 10000 });
    },

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


