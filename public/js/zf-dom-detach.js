// ==== 【DOM 优化】对话折叠时摘除消息区 DOM，展开时挂回 ====
// 机制：对话框 .collapsed（最小化/被遮盖）时，.chatbox-body 内的全部消息节点
// 摘出存入 chat._detachedBodyFrag（DocumentFragment，不参与渲染/样式计算），
// body 留一个占位标记；展开时整体挂回。数据本身在 Store/history，不受影响。
(function () {
    var MAX_KEEP = 2;          // 最多同时保留几个折叠对话的完整消息 DOM，其余直接裁剪
    var _fragStore = new Map(); // chatId -> { frag, chat }

    function _getBody(box) { return box.querySelector('.chatbox-body'); }

    // 摘除：折叠时调用
    App.detachChatMessages = function (box) {
        try {
            var body = _getBody(box);
            if (!body || body.childElementCount === 0) return;
            if (body.dataset.detached === '1') return;
            var chat = (App.chatBoxes || []).find(function (c) { return c.el === box; });
            if (!chat) return;
            var frag = document.createDocumentFragment();
            while (body.firstChild) frag.appendChild(body.firstChild);
            chat._detachedBodyFrag = frag;
            body.dataset.detached = '1';
            _fragStore.set(chat.id, { chat: chat, box: box });
            // 超过上限的，直接丢弃 DOM（历史在 Store，滚动到顶可按需重载）
            var keys = Array.from(_fragStore.keys());
            while (keys.length > MAX_KEEP) {
                var old = _fragStore.get(keys[0]);
                _fragStore.delete(keys[0]);
                if (old && old.chat) old.chat._detachedBodyFrag = null; // 交给 GC（展开时从历史重建）
                keys.shift(); // 【修复】无条件出队：否则 old/frag 为空时 keys 永不缩短，页面死循环卡死
            }
        } catch (e) {}
    };

    // 挂回：展开时调用
    App.reattachChatMessages = function (box) {
        try {
            var body = _getBody(box);
            if (!body || body.dataset.detached !== '1') return;
            var chat = (App.chatBoxes || []).find(function (c) { return c.el === box; });
            if (chat && chat._detachedBodyFrag) {
                body.appendChild(chat._detachedBodyFrag);
                chat._detachedBodyFrag = null;
            } else {
                // 【修复】DOM 超出 MAX_KEEP 已被丢弃：若不重建，展开后消息区永久空白。
                // 从 Store 消息历史重建（与 app-undo 恢复逻辑一致），最多重建最近 120 条。
                try {
                    var _msgs = (typeof Store !== 'undefined' && Store.getMessages)
                        ? Store.getMessages(chat ? chat.id : box.id) : [];
                    _msgs = _msgs.slice(-120);
                    var _frag2 = document.createDocumentFragment();
                    _msgs.forEach(function (m) {
                        if (!m) return;
                        if (m.type === 'typing' || m.type === 'tool_call' || m.type === 'tool' || m.role === 'tool_call' || m.role === 'tool') return;
                        var _who = (m.role === 'user') ? 'user' : (m.role === 'error' ? 'error' : 'ai');
                        var _d = document.createElement('div');
                        _d.className = 'msg ' + _who + (m.type === 'final' ? ' ai-final' : '');
                        if (typeof App.setMsgContent === 'function') App.setMsgContent(_d, m.content || '', _who);
                        else _d.textContent = m.content || '';
                        _frag2.appendChild(_d);
                    });
                    body.appendChild(_frag2);
                } catch (e3) {}
            }
            delete body.dataset.detached;
            if (chat) _fragStore.delete(chat.id);
            body.scrollTop = body.scrollHeight;
        } catch (e) {}
    };

    // 拦截 collapsed class 切换：统一在 add/remove 处挂钩
    // 用 MutationObserver 监听 class 变化，无需改动每个切换点
    var _mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
            var box = m.target;
            if (!box.classList || !box.classList.contains('chatbox')) return;
            if (box.classList.contains('collapsed')) {
                App.detachChatMessages(box);
            } else {
                App.reattachChatMessages(box);
            }
        });
    });
    function _observe(box) {
        try { _mo.observe(box, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
        // 已处于折叠态的（页面加载恢复快照时）
        if (box.classList.contains('collapsed')) App.detachChatMessages(box);
    }
    // 挂钩已有对话创建点
    var _origAppend = null;
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('.chatbox').forEach(_observe);
    });
    // 新对话通过 canvas.appendChild(box) 创建：监听画布子节点
    var _canvasTimer = setInterval(function () {
        var canvas = document.getElementById('canvas') || document.querySelector('#canvas,#chatCanvas,.canvas');
        if (!canvas) return;
        clearInterval(_canvasTimer);
        canvas.querySelectorAll('.chatbox').forEach(_observe);
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                m.addedNodes.forEach(function (n) {
                    if (n.classList && n.classList.contains('chatbox')) _observe(n);
                });
            });
        }).observe(canvas, { childList: true });
    }, 500);
})();
