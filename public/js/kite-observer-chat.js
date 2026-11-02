/* ============================================================
 * kite-observer-chat.js —— 风筝观察员（复用普通角色对话框版）
 * 双击风筝龙头 → 直接用角色列表的「风筝观察员」角色，
 * 走 App.openRoleChat 创建普通对话框（鼠标位置），无任何私有面板。
 * - 上下文注入：遍历画布上所有可见 chatbox，逐对话隔离收集
 *   （每个对话一个分组标题，不串台），过滤 ≤4 字短文本用户消息
 * - 打开即以观察员身份自动发出首问：「目前感觉如何？有什么建议和意见没有？」
 * ============================================================ */
(function () {
    'use strict';

    var SHORT_RE = /^(继续|好|嗯|哦|ok|okay|行|是的|对|好的|嗯嗯|继续吧|go|yes|收到|明白|1|2|3)\s*[。.!！?？~～]*$/i;
    var FIRST_Q = '目前感觉如何？有什么建议和意见没有？';

    /* ---------- 上下文收集：逐对话隔离，不串台 ---------- */
    function collectContext() {
        var boxes = document.querySelectorAll('.chatbox');
        var groups = [];
        boxes.forEach(function (box) {
            /* 只收集可见对话 */
            if (!box.offsetParent && box.getClientRects().length === 0) return;
            var titleEl = box.querySelector('.title');
            var title = titleEl ? titleEl.textContent.trim() : ('对话' + (groups.length + 1));
            var body = box.querySelector('.chatbox-body') || box;
            var msgs = body.querySelectorAll('.msg');
            var lines = [];
            msgs.forEach(function (m) {
                if (m.hasAttribute('data-welcome')) return;           // 欢迎语跳过
                if (m.classList.contains('typing')) return;           // 打字中跳过
                var cl = m.className || '';
                if (/tool|system|status/i.test(cl)) return;           // 工具/系统消息跳过
                var text = (m.textContent || '').trim();
                if (!text) return;
                var isUser = m.classList.contains('user') || m.classList.contains('msg-user') ||
                             (m.dataset && m.dataset.who === 'user') || /\buser\b/i.test(cl);
                if (isUser) {
                    if (text.length <= 4 || SHORT_RE.test(text)) return;  // 短文本用户问题剔除
                    lines.push('用户：' + text.slice(0, 500));
                } else {
                    lines.push('AI：' + text.slice(0, 500));
                }
            });
            if (lines.length) {
                groups.push('═══ 对话' + (groups.length + 1) + '：「' + title + '」═══\n' + lines.slice(-12).join('\n'));
            }
        });
        return groups.join('\n\n');
    }

    /* ---------- 找角色列表里的风筝观察员 ---------- */
    function findObserverRole(cb) {
        fetch('/api/roles')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var all = (res && (res.roles || res.data)) || [];
                var exact = all.find(function (r) { return (r.name || '').trim() === '风筝观察员'; });
                var loose = all.find(function (r) { return (r.name || '').indexOf('观察员') > -1; });
                cb(exact || loose || null);
            })
            .catch(function () { cb(null); });
    }

    /* ---------- 在最新创建的对话框里自动发出首问（走普通发送管线） ---------- */
    function autoFirstAsk() {
        var boxes = document.querySelectorAll('.chatbox');
        var box = boxes[boxes.length - 1];
        if (!box) return;
        var ctx = collectContext();
        var text = ctx ? ('（以下是我观察到的画布上最近的对话记录，按对话分组）\n\n' + ctx +
                          '\n\n═══ 观察请求 ═══\n' + FIRST_Q)
                       : FIRST_Q;
        var input = box.querySelector('textarea') ||
                    box.querySelector('.chatbox-input') ||
                    box.querySelector('input[type="text"]');
        var btn = box.querySelector('.send-btn');
        if (input && btn) {
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(function () { btn.click(); }, 100);
        }
    }

    /* ---------- 对外入口：双击龙头调用 ---------- */
    function open(x, y) {
        if (!window.App || typeof App.openRoleChat !== 'function') {
            console.warn('[kite-observer] 对话组件未就绪'); return;
        }
        findObserverRole(function (role) {
            App.openRoleChat(role || { id: '', name: '风筝观察员', avatar: '🪁' }, { x: x, y: y });
            setTimeout(autoFirstAsk, 500);
        });
    }

    window.KiteObserverChat = { open: open };
})();
