// ==== 前后台状态对账：重启续跑/断线重连后，右下角按钮与池内真实运行状态统一 ====
// 原理：池（chat_pool）是服务器侧状态源；/api/chat-pool/active 返回正在跑的 Turn
// （box=对话id, turn_id, state）。页面加载/定时轮询此接口，与本地 chat.isSending 对账：
//   ① 服务器在跑、本地不知情（页面刚加载/刷新，续跑接管）→ 本地补记 isSending=true，按钮变停止态，
//      且记录 slot 信息供 stopSending 正确取消池内 Turn；
//   ② 服务器已终态、本地仍显示 sending（异常残留）→ 清除，按钮回发送态。
// 不干预本地正常循环（本地循环在跑时以其状态为准，不做覆盖）。
(function () {
    'use strict';
    if (window.__poolStateReconcile) return;
    window.__poolStateReconcile = true;

    var BASE = (typeof DB !== 'undefined' && DB.BASE_URL) ? DB.BASE_URL : '';
    var POLL_MS = 10000; // 原 3000，降频防掉帧

    // 请求超时助手：挂死请求 15 秒自动 abort，不再堆积
    function fetchT(url, opts, ms) {
        var ctl = new AbortController();
        var t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms || 15000);
        return fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal }))
            .finally(function () { clearTimeout(t); });
    }

    function snapshotChats() {
        try { return (typeof App !== 'undefined' && App.chatBoxes) || []; }
        catch (e) { return []; }
    }

    function reconcile() {
        if (reconcile._busy) return;      // 防重叠
        if (document.hidden) return; // 后台标签不轮询，防掉帧
        if (window.ActivityGate && !ActivityGate.allow('pool', 300000)) return; // 界面静止休眠，5 分钟心跳
        if (typeof App === 'undefined' || typeof App.updateSendButton !== 'function') return;
        var chats = snapshotChats();
        if (!chats.length) return;
        reconcile._busy = true;
        fetchT(BASE + '/api/chat-pool/active', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data || !data.ok) return;
                var act = data.active || [];
                var byBox = {};
                act.forEach(function (t) { byBox[String(t.box)] = t; });

                chats.forEach(function (chat) {
                    if (!chat) return;
                    var id = String(chat.id || '');
                    var t = byBox[id];

                    // ① 服务器在跑，本地无感知 → 恢复 sending（幂等重连订阅由 SSE 自身处理）
                    if (t && t.state === 'running' && !chat.isSending && !chat.abortController) {
                        chat.isSending = true;
                        try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
                        chat._poolReconciled = true;           // 标记：由对账恢复（非本地发起）
                        chat._poolTurnId = t.turn_id || '';    // 供 stopSending 取消用
                        chat._poolSlotId = id;
                        if (chat.el) {
                            try { App.updateSendButton(chat.el, chat); } catch (e) {}
                        }
                        try {
                            Store.addLog('info', id, 'pool-reconcile',
                                '检测到服务器侧对话正在运行（重启续跑/断线接管），按钮已同步为停止态');
                        } catch (e) {}
                    }

                    // ② 服务器已无此 Turn，本地由对账恢复的 sending → 清除（真实循环不受影响）
                    if (!t && chat.isSending && chat._poolReconciled) {
                        chat.isSending = false;
                        try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
                        chat._poolReconciled = false;
                        if (chat.el) {
                            try { App.updateSendButton(chat.el, chat); } catch (e) {}
                        }
                    }
                });
            })
            .catch(function () {})
            .finally(function () { reconcile._busy = false; });
    }

    // 页面就绪后先对账一次，再定时轮询
    function boot() {
        setTimeout(reconcile, 1500);
        setInterval(reconcile, POLL_MS);
        // 活动门控唤醒（切回页面/有输入/对话恢复运行）→ 立即对账一次
        if (window.ActivityGate) {
            document.addEventListener('activitygate-wake', function () {
                if (!document.hidden) reconcile();
            });
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
