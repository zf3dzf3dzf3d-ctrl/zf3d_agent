// ========== app-incognito-master.js - 🕶️ 无痕大师（对话级无痕模式） ==========
// 功能：挂在大师集群下拉菜单内（由 app-mastercluster.js 调用注册）。
//   开启后：本对话的所有内容不写入服务器数据库（chat_history / nodes / 流式补写），
//   关闭页面即全部丢失；仅保留在页面内存中，刷新后也不存在。
// 原理：拦截 DB.addChatMessage、DB._request 的 /chat/ POST、sendBeacon 补写、
//   Store.saveChatBox 落库（无痕对话仍保留内存状态，只是不发送到服务器）。
(function () {
    'use strict';

    var INC = { chats: {} };   // chatId -> true

    function chatIdOf(boxEl) {
        if (!boxEl || !boxEl.id) return null;
        return boxEl.id.replace(/^chatbox-/, '') || null;
    }

    function isIncognito(chatId) { return !!(chatId && INC.chats[chatId]); }

    function toggle(boxEl) {
        var chatId = chatIdOf(boxEl);
        if (!chatId) return false;
        if (INC.chats[chatId]) {
            delete INC.chats[chatId];
            return false;   // 已退出无痕
        }
        INC.chats[chatId] = true;
        return true;        // 已进入无痕
    }

    function markBadge(boxEl, on) {
        try {
            var titleEl = boxEl && boxEl.querySelector('.title');
            if (!titleEl) return;
            if (on) {
                if (!titleEl.dataset._incPrev) titleEl.dataset._incPrev = titleEl.textContent;
                titleEl.textContent = '🕶️ ' + titleEl.dataset._incPrev.replace(/^🕶️ /, '');
            } else if (titleEl.dataset._incPrev) {
                titleEl.textContent = titleEl.dataset._incPrev.replace(/^🕶️ /, '');
                delete titleEl.dataset._incPrev;
            }
        } catch (e) {}
    }

    // ---------- 拦截层：挂到 window.DB 加载后（本文件在 db.js 之后加载） ----------
    function installInterceptors() {
        if (typeof DB === 'undefined') return false;

        // 1) 拦截 addChatMessage（主落库通道）
        if (!DB._incOrigAdd) {
            DB._incOrigAdd = DB.addChatMessage;
            DB.addChatMessage = function (sessionId) {
                if (isIncognito(sessionId)) {
                    return Promise.resolve({ ok: true, incognito: true });
                }
                return DB._incOrigAdd.apply(DB, arguments);
            };
        }

        // 2) 拦截 _request 层（兜底：/chat/xxx 的 POST / DELETE、/nodes 直接 saveNode 等）
        if (!DB._incOrigReq && typeof DB._request === 'function') {
            DB._incOrigReq = DB._request;
            DB._request = function (method, path) {
                try {
                    var m = String(path || '').match(/^\/chat\/([^/?]+)/);
                    if (m && method !== 'GET' && isIncognito(decodeURIComponent(m[1]))) {
                        return Promise.resolve({ ok: true, incognito: true });
                    }
                } catch (e) {}
                return DB._incOrigReq.apply(DB, arguments);
            };
        }

        // 3) 拦截 saveNode / saveCanvasView 中的无痕对话（nodes 落库）
        if (!DB._incOrigSaveNode && typeof DB.saveNode === 'function') {
            DB._incOrigSaveNode = DB.saveNode;
            DB.saveNode = function (box) {
                if (box && isIncognito(box.id)) return Promise.resolve({ ok: true, incognito: true });
                return DB._incOrigSaveNode.apply(DB, arguments);
            };
        }

        return true;
    }

    if (!installInterceptors()) {
        // db.js 尚未加载：延迟安装
        var _t = setInterval(function () { if (installInterceptors()) clearInterval(_t); }, 100);
    }

    // 4) 拦截页面关闭前的 sendBeacon 补写（store.js beforeunload 直发 /chat/）
    window.addEventListener('beforeunload', function () {
        try {
            var origSend = navigator.sendBeacon.bind(navigator);
            // 同步场景无法拦截 sendBeacon 本身，改为清空 pending 流式补写
            if (typeof App !== 'undefined' && Array.isArray(App.chatBoxes)) {
                App.chatBoxes.forEach(function (c) {
                    if (c && isIncognito(c.id)) c._pendingStreamSave = null;
                });
            }
        } catch (e) {}
    }, true);

    // 猴子补 sendBeacon：无痕对话的 /chat/ beacon 直接丢弃
    try {
        var origBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
        if (origBeacon) {
            navigator.sendBeacon = function (url, data) {
                try {
                    var m = String(url || '').match(/\/chat\/([^/?]+)/);
                    if (m && isIncognito(decodeURIComponent(m[1]))) return true;   // 假装成功，实际丢弃
                } catch (e) {}
                return origBeacon(url, data);
            };
        }
    } catch (e) {}

    // ---------- 菜单绿点同步：无痕状态变化时刷新下拉菜单里的指示点 ----------
    function updateDockBtn(on) {
        try {
            document.querySelectorAll('.mc-item.mc-incognitomaster .mc-inc-dot').forEach(function (dot) {
                dot.style.background = on ? '#2ecc71' : '#4a5568';
            });
        } catch (e) {}
    }

    // ---------- 开关动画提示：全屏中央短暂横幅 ----------
    function showAnim(on) {
        try {
            var banner = document.createElement('div');
            banner.style.cssText = [
                'position:fixed', 'top:50%', 'left:50%',
                'transform:translate(-50%,-50%) scale(0.9)',
                'z-index:99999', 'pointer-events:none',
                'display:flex', 'align-items:center', 'gap:12px',
                'padding:18px 32px', 'border-radius:14px',
                'font-size:18px', 'font-weight:600', 'color:#fff',
                'background:' + (on ? 'rgba(20,32,26,0.94)' : 'rgba(52,40,22,0.94)'),
                'border:1px solid ' + (on ? '#2ecc71' : '#e0a030'),
                'box-shadow:0 0 30px ' + (on ? 'rgba(46,204,113,0.45)' : 'rgba(224,160,48,0.45)'),
                'opacity:0',
                'transition:opacity .25s ease, transform .25s ease'
            ].join(';');
            var icon = document.createElement('span');
            icon.textContent = '🕶️';
            icon.style.cssText = 'font-size:30px;animation:incWave .9s ease;';
            var txt = document.createElement('div');
            txt.innerHTML = (on ? '已进入 <b>无痕模式</b><br><span style="font-size:13px;opacity:.75;font-weight:400">本对话内容不写入记忆，关闭页面即丢失</span>'
                                   : '已退出无痕模式<br><span style="font-size:13px;opacity:.75;font-weight:400">恢复记忆写入</span>');
            banner.appendChild(icon);
            banner.appendChild(txt);
            document.body.appendChild(banner);

            // 注入动画 keyframes（只注入一次）
            if (!document.getElementById('incognito-anim-style')) {
                var st = document.createElement('style');
                st.id = 'incognito-anim-style';
                st.textContent = '@keyframes incWave{0%{transform:rotate(-20deg) scale(0.5);opacity:0}50%{transform:rotate(10deg) scale(1.2);opacity:1}100%{transform:rotate(0) scale(1)}}';
                document.head.appendChild(st);
            }

            requestAnimationFrame(function () {
                banner.style.opacity = '1';
                banner.style.transform = 'translate(-50%,-50%) scale(1)';
            });
            setTimeout(function () {
                banner.style.opacity = '0';
                banner.style.transform = 'translate(-50%,-50%) scale(0.95)';
                setTimeout(function () { banner.remove(); }, 300);
            }, 1800);
        } catch (e) {}
    }

    // ---------- 对外 API ----------
    window.IncognitoMaster = {
        toggle: function (boxEl) {
            var on = toggle(boxEl);
            markBadge(boxEl, on);
            updateDockBtn(on);
            showAnim(on);
            return on;
        },
        isIncognito: isIncognito
    };
})();
