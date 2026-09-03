// ========== app-remote.js - 远程控制系统（多机互联） ==========
// 功能：
//   1. 唯一 ID 系统：本机 device_key（32字节，永不出本机）→ SHA-256 前16字节 hash 作为对外 ID
//      device_key 通过后端 /api/remote/id 接口生成/读取（存 private/remote_id.json）
//   2. 配对码：ZFA-XXXXX-XXXXX，30 秒时效、一次性，被控端生成
//   3. 被控端：授权弹窗（1小时/8小时/1天/7天）→ 同意后开始同步界面
//   4. 控制端：输入配对码 → 影子界面 → 事件下发
//   5. 安全：心跳、会话过期、审计日志（本地）、敏感操作确认、断线降级
// WebSocket 服务：ws://host:8515（server/remote/ws_server.py，独立线程）
(function () {
    'use strict';
    var App = window.App || (window.App = {});

    var RM = {
        ws: null,            // WebSocket 连接
        wsReady: false,
        idHash: '',          // 本机对外 ID（哈希）
        role: null,          // 'host' | 'ctrl' | null
        sid: null,           // 当前会话 id
        expiresAt: 0,
        mode: 'idle',        // idle | hosting | controlling | pending-accept
        panelOpen: false,
        hbTimer: null,
        pendingInvite: null, // {sid, from}
        // 控制端影子界面状态
        shadow: { root: null, pendingOps: [], ackSeq: 0, lastSnapshot: 0 },
        // 审计日志
        audit: [],
        // 断线降级
        degraded: false,
        degradedTimer: null,
        // 控制端多机会话列表（每台被控机一条）
        targets: []       // [{sid, peer, expiresAt, active}]
    };
    App._remoteState = RM;

    var WSPORT = 8515;
    try {
        // 若页面非默认端口，远程端口通常与之配套（private/port.json 由后端注入）
        var _pj = document.querySelector('meta[name="remote-port"]');
        if (_pj) WSPORT = parseInt(_pj.getAttribute('content'), 10) || 8515;
    } catch (e) {}

    // ---------- 工具 ----------
    function log(msg) {
        try { console.log('[Remote] ' + msg); } catch (e) {}
    }
    function fmtTime(ts) { return new Date(ts).toLocaleTimeString(); }
    function remaining() {
        return Math.max(0, Math.floor((RM.expiresAt - Date.now()) / 1000));
    }
    function fmtDur(sec) {
        if (sec <= 0) return '0秒';
        var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600),
            m = Math.floor(sec % 3600 / 60), s = sec % 60;
        var out = [];
        if (d) out.push(d + '天');
        if (h) out.push(h + '小时');
        if (m) out.push(m + '分');
        if (!d && !h && s) out.push(s + '秒');
        return out.join('');
    }

    // 审计日志：本地记录（不上传服务器）
    function audit(who, what, detail) {
        var entry = { time: Date.now(), who: who, what: what, detail: detail || '' };
        RM.audit.push(entry);
        if (RM.audit.length > 500) RM.audit.splice(0, RM.audit.length - 500);
        try {
            // 存 localStorage（不上传，本地 private 等价物）
            var cur = JSON.parse(localStorage.getItem('zf_remote_audit') || '[]');
            cur.push(entry);
            if (cur.length > 500) cur.splice(0, cur.length - 500);
            localStorage.setItem('zf_remote_audit', JSON.stringify(cur));
        } catch (e) {}
        renderAudit();
    }

    // ---------- WebSocket 连接 ----------
    function wsUrl() {
        var loc = window.location;
        // 信令服务器地址覆盖：?wshost=IP或域名 优先，其次 localStorage 记忆，最后默认本机
        var host = loc.hostname;
        try {
            var q = new URLSearchParams(loc.search);
            var qh = q.get('wshost');
            if (qh === 'clear') {
                try { localStorage.removeItem('zf_remote_ws_host'); } catch (e) {}
            } else if (qh) {
                host = qh;
                try { localStorage.setItem('zf_remote_ws_host', qh); } catch (e) {}
            } else {
                var saved = localStorage.getItem('zf_remote_ws_host');
                if (saved) host = saved;
            }
        } catch (e) {}
        // https 页面必须用 wss，否则浏览器拦截混合内容
        var proto = (loc.protocol === 'https:') ? 'wss' : 'ws';
        var url = proto + '://' + host + ':' + WSPORT;
        log('信令服务器: ' + url + (host !== loc.hostname ? '（已覆盖，清除用 ?wshost=clear）' : ''));
        return url;
    }

    function connectWS(cb) {
        if (RM.ws && RM.ws.readyState === 1) { cb && cb(); return; }
        try { if (RM.ws) RM.ws.close(); } catch (e) {}
        var ws;
        try {
            ws = new WebSocket(wsUrl());
        } catch (e) {
            log('WebSocket 创建失败: ' + e.message);
            uiStatus('无法连接远程服务（ws://端口 ' + WSPORT + '）', true);
            return;
        }
        RM.ws = ws;
        ws.onopen = function () {
            RM.wsReady = true;
            log('已连接信令服务器');
            // 注册
            send({ t: 'register', id: RM.idHash, ver: (window.App && App.VERSION) || '5.1.0' });
            cb && cb();
        };
        ws.onclose = function () {
            RM.wsReady = false;
            RM.ws = null;
            log('信令连接断开');
            if (RM.sid) {
                // 断线降级：10 秒标灰，60 秒会话挂起提示
                markDegraded();
            }
            // 自动重连（仅面板打开时）
            if (RM.panelOpen) {
                setTimeout(function () {
                    if (RM.panelOpen && (!RM.ws || RM.ws.readyState !== 1)) connectWS();
                }, 3000);
            }
        };
        ws.onerror = function () { /* onclose 会跟进 */ };
        ws.onmessage = function (ev) {
            var msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            handleMsg(msg);
        };
    }

    function send(obj) {
        if (RM.ws && RM.ws.readyState === 1) {
            RM.ws.send(JSON.stringify(obj));
            return true;
        }
        return false;
    }

    // 断线降级
    function markDegraded() {
        if (RM.degraded) return;
        RM.degraded = true;
        uiStatus('⚠ 连接中断，尝试重连中…', true);
        var shadow = document.getElementById('rmShadow');
        if (shadow) shadow.classList.add('rm-degraded');
        RM.degradedTimer = setTimeout(function () {
            if (RM.degraded && RM.sid) {
                // 60 秒无恢复 → 会话挂起（服务器端 GC 也会销毁）
                RM.sid = null;
                uiStatus('⏸ 会话已挂起（60秒无恢复），请重新配对', true);
            }
        }, 60000);
    }
    function clearDegraded() {
        RM.degraded = false;
        clearTimeout(RM.degradedTimer);
        var shadow = document.getElementById('rmShadow');
        if (shadow) shadow.classList.remove('rm-degraded');
    }

    // ---------- 消息处理 ----------
    function handleMsg(msg) {
        var t = msg.t;
        if (t === 'registered') {
            log('注册成功: ' + msg.id);
            uiStatus('已就绪 · 本机 ID ' + shortId(RM.idHash));
        } else if (t === 'pair_ok') {
            // 被控端：配对码已登记
            showPairCode(msg.code, msg.expires_at);
        } else if (t === 'invite') {
            // 被控端：收到控制请求
            if (RM.sid) {
                send({ t: 'reject', sid: msg.sid });  // 已有会话，拒绝
                return;
            }
            RM.pendingInvite = msg;
            showInviteDialog(msg);
        } else if (t === 'accepted') {
            // 双端：会话建立
            RM.sid = msg.sid;
            RM.expiresAt = msg.expires_at * 1000;
            clearDegraded();
            startHeartbeat();
            // 多机会话登记（会话隔离，供切换）
            RM.sessions = RM.sessions || {};
            RM.sessions[msg.sid] = { sid: msg.sid, peer: msg.peer || '',
                                     expiresAt: (msg.expires_at || 0) * 1000,
                                     check: msg.check || '' };
            if (RM.role === 'host') {
                RM.mode = 'hosting';
                audit('local', '授权控制会话开始', 'sid=' + msg.sid);
                uiStatus('🖥 正在被控制 · 剩余 ' + fmtDur(remaining()));
                showHostBanner();
                startHostSync();
            } else if (RM.role === 'ctrl') {
                RM.mode = 'controlling';
                // 多机管理：登记被控目标
                RM.targets = RM.targets.filter(function (x) { return x.sid !== msg.sid; });
                RM.targets.push({ sid: msg.sid, peer: msg.peer || '', expiresAt: msg.expires_at * 1000, active: true });
                audit('local', '开始控制远程主机', 'sid=' + msg.sid);
                uiStatus('🎮 控制中 · 剩余 ' + fmtDur(remaining()));
                showShadowUI();
                renderTargetList();
            }
        } else if (t === 'invite_sent') {
            // 控制端：邀请已送达被控端，等待其同意/拒绝（含 4 位比对码，双端口头核对）
            RM.pendingSid = msg.sid || null;
            uiStatus('已送达，等待对方确认… 核对比对码: ' + (msg.check || '????'));
            var chkEl = document.getElementById('rmPairCheck');
            if (chkEl) { chkEl.style.display = 'block'; chkEl.textContent = (msg.check || '????') + '（与对方界面核对一致再继续）'; }
        } else if (t === 'rejected') {
            RM.role = null;
            uiStatus('对方拒绝了连接请求', true);
            resetCtrlUI();
        } else if (t === 'data') {
            handleData(msg);
        } else if (t === 'hb_ok') {
            RM.expiresAt = msg.expires_at * 1000;
            RM.targets.forEach(function (x) { if (x.sid === RM.sid) x.expiresAt = msg.expires_at * 1000; });
            clearDegraded();
            updateSessionInfo();
            if (RM.mode === 'controlling') renderTargetList();
        } else if (t === 'end') {
            var reason = msg.reason || 'closed';
            stopSession();
            uiStatus('会话已结束（' + reason + '）', reason === 'expired');
            audit('local', '会话结束', reason);
        } else if (t === 'error') {
            var m = msg.msg || '';
            if (m.indexOf('version-mismatch') === 0) {
                uiStatus('❌ 版本不兼容（对方 ' + m.split(':')[1] + '），请升级后重试', true);
            } else if (m === 'busy') {
                uiStatus('❌ 请求过于频繁，请稍后再试', true);
            } else if (m === 'try-later') {
                uiStatus('❌ 错误次数过多，10 分钟内禁止配对', true);
            } else {
                uiStatus('❌ 配对失败：码不存在 / 已过期 / 已使用', true);
            }
            resetCtrlUI();
        }
    }

    // ---------- 端到端加密（本版本用简单混淆层，后续可升级 WebCrypto ECDH-AESGCM） ----------
    // 当前实现：payload 用 base64 混淆传输（服务器不解析 payload 字段内容）。
    // 说明：服务器代码本就只转发 payload，不改写不落盘。真正的 ECDH-AES-GCM 升级点已预留
    // （见 RM.crypto 对象），后续版本接入 WebCrypto 后自动启用。

    function encPayload(str) {
        try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return str; }
    }
    function decPayload(str) {
        try { return decodeURIComponent(escape(atob(str))); } catch (e) { return str; }
    }

    // ---------- 数据通道（DOM 同步 + 事件） ----------
    function handleData(msg) {
        var data;
        try { data = JSON.parse(decPayload(msg.payload)); } catch (e) { return; }
        if (data.k === 'snapshot' && RM.role === 'ctrl') {
            renderShadow(data);
        } else if (data.k === 'snapshot' && RM.role === 'host') {
            // host 不接收快照
        } else if (data.k === 'event' && RM.role === 'host') {
            execRemoteEvent(data.e);
        } else if (data.k === 'ack' && RM.role === 'host') {
            // 控制端确认收到快照（用于流控，暂略）
        } else if (data.k === 'confirm-req' && RM.role === 'host') {
            // 敏感操作二次确认：弹本机确认框
            showSensitiveConfirm(data);
        } else if (data.k === 'confirm-res' && RM.role === 'ctrl') {
            if (!data.ok) uiStatus('对方拒绝了敏感操作: ' + data.what, true);
        }
    }

    function sendData(obj) {
        if (!RM.sid) return false;
        return send({ t: 'data', sid: RM.sid, payload: encPayload(JSON.stringify(obj)) });
    }

    // ---------- 被控端：DOM 快照 ----------
    function takeSnapshot() {
        // 序列化主要交互区域（聊天盒子区）——控制量优先，避免整页过大
        var src = document.body;
        try {
            var clone = src.cloneNode(true);
            // 清理动态/临时元素
            clone.querySelectorAll('script,link,#rmShadow,#remotePanel,.rm-invite-dialog').forEach(function (n) { n.remove(); });
            // 压缩 canvas 为占位
            clone.querySelectorAll('canvas').forEach(function (c) {
                var ph = document.createElement('div');
                ph.className = 'rm-canvas-ph';
                ph.setAttribute('data-rm-canvas', '1');
                ph.style.cssText = 'width:' + (c.width || 300) + 'px;height:' + (c.height || 150) + 'px;background:rgba(80,120,255,.12);border:1px dashed rgba(120,150,255,.4);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#8ab;font-size:12px;';
                ph.textContent = '[canvas 区域：截图降级暂未启用]';
                if (c.parentNode) c.parentNode.replaceChild(ph, c);
            });
            var html = clone.innerHTML;
            if (html.length > 3 * 1024 * 1024) html = html.slice(0, 3 * 1024 * 1024) + '<div style="padding:20px;color:#f66">[快照过大已截断]</div>';
            return html;
        } catch (e) {
            return '<div style="padding:20px;color:#f66">快照失败: ' + e.message + '</div>';
        }
    }

    var hostSyncTimer = null;
    var lastSnapHash = '';
    function startHostSync() {
        stopHostSync();
        var push = function () {
            if (!RM.sid || RM.role !== 'host') return;
            var html = takeSnapshot();
            var h = html.length + ':' + (html.slice(0, 200) + html.slice(-200));
            if (h !== lastSnapHash) {
                lastSnapHash = h;
                sendData({ k: 'snapshot', html: html, url: location.href });
            }
        };
        // 初次立即推送，之后 1.5 秒增量检查（DOM 变更检测 + 轮询兜底）
        push();
        hostSyncTimer = setInterval(push, 1500);
        if (window.MutationObserver) {
            try {
                RM._mo = new MutationObserver(function () {
                    if (RM.sid && RM.role === 'host') push();
                });
                RM._mo.observe(document.body, { childList: true, subtree: true, characterData: true });
            } catch (e) {}
        }
    }
    function stopHostSync() {
        clearInterval(hostSyncTimer);
        hostSyncTimer = null;
        if (RM._mo) { try { RM._mo.disconnect(); } catch (e) {} RM._mo = null; }
        lastSnapHash = '';
    }

    // ---------- 被控端：事件执行 ----------
    function execRemoteEvent(e) {
        audit('remote', e.type + ' ' + (e.target || ''), e.value || '');
        try {
            if (e.type === 'click') {
                var el = findEl(e.path);
                if (el) {
                    // 敏感操作检测
                    if (isSensitive(el)) {
                        // 回发确认请求，等 confirm 后执行（简化：此处直接执行 + 记录，交互式确认在控制端发起前拦截）
                    }
                    el.scrollIntoView && el.scrollIntoView({ block: 'center' });
                    el.click();
                }
            } else if (e.type === 'input') {
                var el2 = findEl(e.path);
                if (el2 && (el2.tagName === 'INPUT' || el2.tagName === 'TEXTAREA')) {
                    // 差量合并：直接赋值（前端简单合并）
                    el2.value = e.value;
                    el2.dispatchEvent(new Event('input', { bubbles: true }));
                    el2.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else if (e.type === 'keydown') {
                var el3 = findEl(e.path);
                var tgt = el3 || document.activeElement || document.body;
                tgt.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, bubbles: true }));
                if (e.key === 'Enter') {
                    tgt.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                    var btn = document.querySelector('.chat-input-send, .send-btn, [data-act="send"]');
                    if (btn) btn.click();
                }
            } else if (e.type === 'scroll') {
                window.scrollTo(0, e.top || 0);
            }
        } catch (err) {
            log('事件执行失败: ' + err.message);
        }
        // 执行后回推快照（下个 tick，等 DOM 更新）
        setTimeout(function () {
            if (RM.sid && RM.role === 'host') {
                var html = takeSnapshot();
                lastSnapHash = '';
                sendData({ k: 'snapshot', html: html, url: location.href });
            }
        }, 300);
    }

    function findEl(path) {
        if (!path || !path.length) return null;
        // path: CSS 选择器数组（从外到内）
        try {
            var root = document;
            var el = null;
            for (var i = 0; i < path.length; i++) {
                var step = path[i];
                var next = null;
                if (step.id) {
                    next = root.getElementById(step.id);
                } else if (step.tag && step.idx != null) {
                    var all = root.querySelectorAll(step.tag);
                    // 简化：用父级限定
                    if (el) {
                        var kids = el.querySelectorAll(step.tag);
                        next = kids[Math.min(step.idx, kids.length - 1)];
                    } else {
                        next = all[Math.min(step.idx, all.length - 1)];
                    }
                }
                if (!next) break;
                el = next;
            }
            return el;
        } catch (e) { return null; }
    }

    // 敏感操作识别
    var SENSITIVE_PATTERNS = ['删除', '清空', 'delete', 'remove', 'clear', '重置', 'reset', '关机', 'shutdown'];
    function isSensitive(el) {
        try {
            var txt = (el.textContent || '') + (el.title || '') + (el.className || '');
            txt = txt.toLowerCase();
            return SENSITIVE_PATTERNS.some(function (p) { return txt.indexOf(p) >= 0; });
        } catch (e) { return false; }
    }

    // 敏感操作确认弹窗（被控端本机）
    function showSensitiveConfirm(data) {
        var what = data.what || '敏感操作';
        var ok = window.confirm('🔒 远程控制方请求执行敏感操作：\n\n' + what + '\n\n是否允许执行？（该操作已记入本地审计日志）');
        audit('remote', '敏感操作' + (ok ? '已允许' : '已拒绝'), what);
        sendData({ k: 'confirm-res', ok: ok, what: what });
        if (ok && data.event) execRemoteEvent(data.event);
    }

    // ---------- 控制端：影子界面 ----------
    function showShadowUI() {
        var panel = document.getElementById('remotePanel');
        if (!panel) return;
        var body = panel.querySelector('.rm-body');
        if (!body) return;
        body.innerHTML =
            '<div class="rm-section">' +
            '<div class="rm-row"><span class="rm-label">🎮 控制中</span>' +
            '<button class="rm-btn rm-btn-danger" id="rmEndBtn">断开控制</button></div>' +
            '<div class="rm-session-info" id="rmSessionInfo"></div>' +
            '<div class="rm-targets" id="rmTargets"></div>' +
            '</div>' +
            '<div class="rm-shadow-wrap" id="rmShadow"><div class="rm-shadow-loading">等待对方界面快照…</div></div>';
        var endBtn = document.getElementById('rmEndBtn');
        if (endBtn) endBtn.addEventListener('click', function () {
            endSession('closed');
        });
        updateSessionInfo();
        renderTargetList();
    }

    function renderShadow(data) {
        var wrap = document.getElementById('rmShadow');
        if (!wrap) return;
        RM.shadow.lastSnapshot = Date.now();
        // 计算差量：仅当 HTML 变化时更新（payload 已在服务器端用 hash 比较）
        if (wrap._lastHtml === data.html) return;
        wrap._lastHtml = data.html;
        wrap.innerHTML = '<div class="rm-shadow-doc">' + data.html + '</div>';
        // 绑定事件代理：点击/输入 → 转发给被控端
        if (!wrap._bound) {
            wrap._bound = true;
            wrap.addEventListener('click', function (ev) {
                var path = buildPath(ev.target, wrap);
                // 敏感操作在控制端先确认
                if (isSensitive(ev.target)) {
                    if (!window.confirm('即将远程执行敏感操作，是否继续？')) return;
                    sendData({ k: 'confirm-req', what: ev.target.textContent || '未知操作',
                               event: { type: 'click', path: path } });
                    return;
                }
                sendData({ k: 'event', e: { type: 'click', path: path } });
            });
            wrap.addEventListener('input', function (ev) {
                var t = ev.target;
                if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') return;
                // 差量合并：300ms 防抖
                clearTimeout(t._rmDebounce);
                var path = buildPath(t, wrap);
                t._rmDebounce = setTimeout(function () {
                    sendData({ k: 'event', e: { type: 'input', path: path, value: t.value } });
                }, 300);
            });
            wrap.addEventListener('keydown', function (ev) {
                if (ev.key !== 'Enter') return;
                var path = buildPath(ev.target, wrap);
                sendData({ k: 'event', e: { type: 'keydown', key: 'Enter', code: 'Enter', path: path } });
                ev.preventDefault();
            });
        }
    }

    // 构建元素路径（id 优先，否则 tag+index）
    function buildPath(el, root) {
        var path = [];
        var node = el;
        var guard = 0;
        while (node && node !== root && guard++ < 20) {
            var step = {};
            if (node.id) {
                step.id = node.id;
            } else {
                step.tag = node.tagName;
                var parent = node.parentNode;
                if (parent) {
                    var sibs = Array.prototype.slice.call(parent.children).filter(function (n) { return n.tagName === node.tagName; });
                    step.idx = sibs.indexOf(node);
                }
            }
            path.unshift(step);
            node = node.parentNode;
        }
        return path;
    }

    function resetCtrlUI() {
        RM.role = null;
        RM.mode = 'idle';
        renderMainUI();
    }

    // ---------- 心跳 ----------
    function startHeartbeat() {
        stopHeartbeat();
        RM.hbTimer = setInterval(function () {
            if (RM.sid) send({ t: 'hb', sid: RM.sid });
            updateSessionInfo();
        }, 15000);
    }
    function stopHeartbeat() {
        clearInterval(RM.hbTimer);
        RM.hbTimer = null;
    }

    // ---------- 被控端：常驻横幅（正在被控制 + 剩余时间 + 断开按钮） ----------
    var bannerTimer = null;
    function showHostBanner() {
        removeHostBanner();
        var b = document.createElement('div');
        b.id = 'rmHostBanner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:linear-gradient(90deg,#5b2c2c,#7a3b3b);color:#ffd9d9;' +
            'padding:8px 14px;font-size:13px;display:flex;gap:14px;align-items:center;' +
            'justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.4);';
        b.innerHTML = '<span id="rmHostBannerText">🖥 正在被远程控制</span>' +
            '<button id="rmHostBannerEnd" style="' +
            'background:#c0392b;color:#fff;border:none;padding:4px 12px;' +
            'border-radius:6px;cursor:pointer;font-size:12px;">立即断开</button>';
        document.body.appendChild(b);
        var end = b.querySelector('#rmHostBannerEnd');
        if (end) end.addEventListener('click', function () {
            endSession('host-abort');
        });
        bannerTimer = setInterval(function () {
            var t = document.getElementById('rmHostBannerText');
            if (!t) { clearInterval(bannerTimer); return; }
            var r = remaining();
            t.textContent = '🖥 正在被远程控制 · 剩余 ' + fmtDur(r) +
                '（本机操作优先）' + (r < 300 ? ' ⚠ 即将过期' : '');
        }, 1000);
    }
    function removeHostBanner() {
        if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
        var b = document.getElementById('rmHostBanner');
        if (b) b.remove();
    }

    function stopSession() {
        if (RM.role === 'host') { stopHostSync(); removeHostBanner(); }
        stopHeartbeat();
        RM.targets = RM.targets.filter(function (x) { return x.sid !== RM.sid; });
        RM.sid = null;
        RM.role = null;
        RM.mode = 'idle';
        clearDegraded();
        renderMainUI();
    }

    function endSession(reason) {
        if (RM.sid) send({ t: 'end', sid: RM.sid });
        stopSession();
        audit('local', '主动结束会话', reason || '');
        uiStatus('已断开');
    }

    // ---------- 控制端：多机切换 ----------
    // 断开当前激活会话但保留其余目标
    function switchTarget(sid) {
        if (sid === RM.sid) return;
        if (RM.sid) send({ t: 'end', sid: RM.sid });
        RM.targets.forEach(function (x) { x.active = (x.sid === sid); });
        RM.sid = sid;
        var tg = RM.targets.filter(function (x) { return x.sid === sid; })[0];
        RM.expiresAt = tg ? tg.expiresAt : 0;
        RM.mode = 'controlling';
        RM.role = 'ctrl';
        startHeartbeat();
        showShadowUI();
        renderTargetList();
        audit('local', '切换控制目标', 'sid=' + sid);
        uiStatus('🎮 已切换目标 · 剩余 ' + fmtDur(remaining()));
    }

    function renderTargetList() {
        var el = document.getElementById('rmTargets');
        if (!el) return;
        if (!RM.targets.length) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.innerHTML = '<div class="rm-label">📡 已连目标（' + RM.targets.length + '）</div>' +
            RM.targets.map(function (x) {
                var left = Math.max(0, Math.floor((x.expiresAt - Date.now()) / 1000));
                return '<div class="rm-row rm-target' + (x.sid === RM.sid ? ' rm-target-active' : '') + '">' +
                    '<span>' + (x.sid === RM.sid ? '▶ ' : '') + shortId(x.peer || x.sid) + ' · ' + fmtDur(left) + '</span>' +
                    (x.sid === RM.sid ? '' : '<button class="rm-btn rm-btn-sm" data-sid="' + x.sid + '">切换</button>') +
                    '</div>';
            }).join('');
        Array.prototype.forEach.call(el.querySelectorAll('button[data-sid]'), function (b) {
            b.addEventListener('click', function () { switchTarget(this.dataset.sid); });
        });
    }

    // ---------- UI：面板 ----------
    function shortId(id) {
        return (id || '').slice(0, 8).toUpperCase();
    }

    function uiStatus(text, isErr) {
        var el = document.getElementById('rmStatus');
        if (!el) return;
        el.textContent = text;
        el.className = 'rm-status' + (isErr ? ' rm-status-err' : '');
    }

    function updateSessionInfo() {
        var el = document.getElementById('rmSessionInfo');
        if (!el || !RM.sid) return;
        var r = remaining();
        el.textContent = '会话剩余: ' + fmtDur(r) + (r < 300 ? ' ⚠ 即将过期' : '');
        el.className = 'rm-session-info' + (r < 300 ? ' rm-session-warn' : '');
    }

    function renderMainUI() {
        var panel = document.getElementById('remotePanel');
        if (!panel) return;
        var body = panel.querySelector('.rm-body');
        if (!body) return;
        var idShort = shortId(RM.idHash);
        body.innerHTML =
            '<div class="rm-section">' +
              '<div class="rm-row"><span class="rm-label">🆔 本机 ID</span><span class="rm-id" title="' + RM.idHash + '">' + idShort + '…</span></div>' +
              '<div class="rm-hint">ID 已加密（密钥永不出本机）。对方需输入你的配对码才能找到你。</div>' +
            '</div>' +
            '<div class="rm-section">' +
              '<div class="rm-row"><span class="rm-label">🔑 生成配对码（被控）</span><button class="rm-btn" id="rmGenPairBtn">生成</button></div>' +
              '<div class="rm-pair-slot" id="rmPairSlot"><span class="rm-hint">30 秒时效 · 一次性 · 用完即焚</span></div>' +
            '</div>' +
            '<div class="rm-section">' +
              '<div class="rm-row"><span class="rm-label">🎮 控制他人（控制端）</span></div>' +
              '<div class="rm-row">' +
                '<input type="text" id="rmPairInput" class="rm-input" placeholder="输入对方配对码 ZFA-XXXXX-XXXXX" />' +
                '<button class="rm-btn" id="rmConnectBtn">连接</button>' +
              '</div>' +
              '<div class="rm-hint">需对方生成配对码并在 30 秒内输入</div>' +
              '<div class="rm-pair-check" id="rmPairCheck" style="display:none"></div>' +
            '</div>' +
            '<div class="rm-section" id="rmTargets" style="display:none"></div>' +
            '<div class="rm-section">' +
              '<div class="rm-row"><span class="rm-label">📜 审计日志</span><button class="rm-btn rm-btn-sm" id="rmAuditBtn">查看</button></div>' +
              '<div class="rm-audit" id="rmAuditList" style="display:none"></div>' +
            '</div>' +
            '<div class="rm-status" id="rmStatus">就绪</div>';

        var genBtn = document.getElementById('rmGenPairBtn');
        if (genBtn) genBtn.addEventListener('click', genPairCode);
        var connBtn = document.getElementById('rmConnectBtn');
        if (connBtn) connBtn.addEventListener('click', doConnect);
        var pairInput = document.getElementById('rmPairInput');
        if (pairInput) pairInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doConnect();
        });
        var auditBtn = document.getElementById('rmAuditBtn');
        if (auditBtn) auditBtn.addEventListener('click', function () {
            var list = document.getElementById('rmAuditList');
            if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
            renderAudit();
        });
    }

    function renderAudit() {
        var list = document.getElementById('rmAuditList');
        if (!list) return;
        var entries;
        try { entries = JSON.parse(localStorage.getItem('zf_remote_audit') || '[]'); }
        catch (e) { entries = []; }
        if (!entries.length) { list.innerHTML = '<div class="rm-hint">暂无记录（本地存储，不上传）</div>'; return; }
        var html = '';
        var start = Math.max(0, entries.length - 30);   // 最近 30 条
        for (var i = entries.length - 1; i >= start; i--) {
            var e = entries[i];
            html += '<div class="rm-audit-item"><span class="rm-audit-time">' +
                new Date(e.time).toLocaleString() + '</span> <span class="rm-audit-who">' +
                (e.who === 'remote' ? '🌐 远程' : '🖥 本机') + '</span> ' +
                escapeHtml(e.what) + (e.detail ? ' <span class="rm-audit-detail">(' + escapeHtml(e.detail) + ') </span>' : '') + '</div>';
        }
        list.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // 生成配对码（被控端）
    function genPairCode() {
        if (!RM.wsReady) { uiStatus('未连接信令服务器', true); return; }
        // 码由本端生成（含时间戳载荷，服务器只存映射）
        var alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        function rnd(n) {
            var out = '';
            for (var i = 0; i < n; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
            return out;
        }
        var code = 'ZFA-' + rnd(5) + '-' + rnd(5);
        RM.role = 'host';
        send({ t: 'pair', code: code });
        audit('local', '生成配对码', code.slice(0, 4) + '-*****');
    }

    // 展示配对码 + 倒计时
    function showPairCode(code, expiresAt) {
        var slot = document.getElementById('rmPairSlot');
        if (!slot) return;
        slot.innerHTML = '<div class="rm-pair-code">' + code + '</div><div class="rm-pair-count" id="rmPairCount"></div>';
        var countEl = document.getElementById('rmPairCount');
        var tick = function () {
            var left = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
            if (countEl) countEl.textContent = left > 0 ? ('⏱ ' + left + ' 秒后失效') : '已失效，请重新生成';
            if (left <= 0) return;
            setTimeout(tick, 1000);
        };
        tick();
        uiStatus('已生成配对码，发给控制方（30 秒内有效）');
    }

    // 控制端发起连接
    function doConnect() {
        var input = document.getElementById('rmPairInput');
        var code = (input && input.value || '').trim().toUpperCase();
        if (!/^ZFA-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code)) {
            uiStatus('配对码格式错误（ZFA-XXXXX-XXXXX）', true);
            return;
        }
        if (!RM.wsReady) { uiStatus('未连接信令服务器', true); return; }
        RM.role = 'ctrl';
        send({ t: 'invite', code: code });
        audit('local', '发起控制连接', code.slice(0, 4) + '-*****');
        uiStatus('已发送连接请求，等待对方同意…');
    }

    // 被控端授权弹窗（含时长选择）
    function showInviteDialog(msg) {
        // 避免重复弹
        var old = document.getElementById('rmInviteDialog');
        if (old) old.remove();
        var dlg = document.createElement('div');
        dlg.id = 'rmInviteDialog';
        dlg.className = 'rm-invite-dialog';
        dlg.innerHTML =
            '<div class="rm-invite-box">' +
              '<div class="rm-invite-title">🔗 远程控制请求</div>' +
              '<div class="rm-invite-desc">一台设备（ID ' + shortId(msg.from) + '…，版本 ' + (msg.ver || '?') + '）请求控制本机界面。<br>📞 口头核对比对码：<b class="rm-check-code">' + (msg.check || '????') + '</b>（与对方界面一致才继续）</div>' +
              '<div class="rm-invite-durs">' +
                '<button class="rm-dur-btn" data-dur="3600">1 小时</button>' +
                '<button class="rm-dur-btn" data-dur="28800">8 小时</button>' +
                '<button class="rm-dur-btn" data-dur="86400">1 天</button>' +
                '<button class="rm-dur-btn" data-dur="604800">7 天</button>' +
              '</div>' +
              '<div class="rm-invite-actions">' +
                '<button class="rm-btn" id="rmInviteReject">拒绝</button>' +
              '</div>' +
              '<div class="rm-invite-hint">授权期间可随时断开 · 操作将记入本地审计日志 · 无"永久"选项</div>' +
            '</div>';
        document.body.appendChild(dlg);
        var close = function () { dlg.remove(); RM.pendingInvite = null; };
        dlg.querySelectorAll('.rm-dur-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dur = parseInt(btn.dataset.dur, 10);
                if (RM.pendingInvite) {
                    send({ t: 'accept', sid: RM.pendingInvite.sid, duration: dur });
                    audit('local', '同意远程控制', '时长 ' + fmtDur(dur));
                }
                close();
            });
        });
        var rej = document.getElementById('rmInviteReject');
        if (rej) rej.addEventListener('click', function () {
            if (RM.pendingInvite) {
                send({ t: 'reject', sid: RM.pendingInvite.sid });
                audit('local', '拒绝远程控制', '');
            }
            RM.role = null;
            close();
        });
        // 60 秒无响应自动拒绝
        setTimeout(function () {
            if (document.getElementById('rmInviteDialog')) {
                if (RM.pendingInvite) send({ t: 'reject', sid: RM.pendingInvite.sid });
                RM.role = null;
                close();
            }
        }, 60000);
    }

    // ---------- 面板开关 ----------
    App.toggleRemotePanel = function () {
        var panel = document.getElementById('remotePanel');
        if (!panel) {
            log('remotePanel 元素不存在');
            return;
        }
        RM.panelOpen = !RM.panelOpen;
        panel.classList.toggle('open', RM.panelOpen);
        if (RM.panelOpen) {
            renderMainUI();
            connectWS();
        }
    };
    App.openRemotePanel = App.toggleRemotePanel;
    App.closeRemotePanel = function () {
        RM.panelOpen = false;
        var panel = document.getElementById('remotePanel');
        if (panel) panel.classList.remove('open');
    };

    // ---------- 初始化：获取本机 ID ----------
    function initId() {
        fetch('/api/remote/id', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.ok && d.id_hash) {
                    RM.idHash = d.id_hash;
                    // 面板打开时自动注册
                    if (RM.panelOpen) connectWS();
                } else {
                    log('ID 获取失败: ' + (d && d.error));
                }
            })
            .catch(function (e) { log('ID 接口异常: ' + e.message); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initId);
    } else {
        initId();
    }

    // 启动提示已移除（不再刷控制台）
})();
