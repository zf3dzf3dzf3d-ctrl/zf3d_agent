// ========== app-auto-resume.js - 🔄 重启后自动续跑未完成对话 ==========
// 功能：
//  服务器重启（或页面刷新）后，若某对话框持久化状态仍是「发送中」(isSending=true)，
//  而池内已无该对话的活动 Turn（对账已收敛为空闲），说明任务中断——
//  延迟数秒后自动隐形补发一次「继续工作」消息（复用 App.triggerContinueRound），
//  让 Agent 循环接着跑，无需用户手动点继续。
// 安全设计：
//  1. 每次页面加载只执行一次检测（sessionStorage 防重入）；
//  2. 延迟 12 秒启动，等待 Store 会话恢复 + 池对账（agent-05）完成；
//  3. 只补发一次，补发前再查 isSending/_verifyActive 防重复；
//  4. 若后端 pool_resume 已重投该 Turn（对账显示服务器侧仍在跑），则跳过不补发。
// 依赖：Store、App.triggerContinueRound（agent-01-project-memory.js）。加载顺序放其后。
(function () {
    'use strict';

    var _RESUME_FLAG = 'auto_resume_done_' + Date.now(); // 每次页面加载一个新 key，天然防同页重入

    function _getChats() {
        try { if (window.App && App.chatBoxes && App.chatBoxes.length) return App.chatBoxes; } catch (e) {}
        try { return (window.Store && Store.data && Store.data.chatBoxes) || []; } catch (e) { return []; }
    }

    function _findBox(chat) {
        try { return document.getElementById(chat.id) || (App.chatBoxes && App.chatBoxes.indexOf(chat) >= 0 ? chat.el : null); } catch (e) { return null; }
    }

    function _toast(msg) {
        try {
            var t = document.createElement('div');
            t.style.cssText = 'position:fixed;top:52px;right:16px;z-index:100000;max-width:360px;' +
                'padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.5;' +
                'background:rgba(20,24,32,.92);border:1px solid rgba(90,200,140,.5);' +
                'color:#e8eef7;box-shadow:0 8px 24px rgba(0,0,0,.35);white-space:pre-wrap;';
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(function () {
                t.style.transition = 'opacity .4s'; t.style.opacity = '0';
                setTimeout(function () { try { t.remove(); } catch (e) {} }, 450);
            }, 4200);
        } catch (e) {}
    }

    function _checkPoolActive(cb) {
        // 询问服务器侧池是否仍有活动 Turn（pool_resume 重投成功则不补发）
        try {
            fetch('/api/chat-pool/active', { cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (j) { cb(!!(j && (j.active || (j.turns && j.turns.length) || j.running))); })
                .catch(function () { cb(false); });
        } catch (e) { cb(false); }
    }

    function _run() {
        if (window.__autoResumeRan) return;
        window.__autoResumeRan = true;
        try { sessionStorage.setItem(_RESUME_FLAG, '1'); } catch (e) {}

        var chats = _getChats();
        if (!chats.length) return;

        // 找出「持久化为发送中」但本地循环已死（无 abortController 且不在池中运行）的对话
        var candidates = [];
        chats.forEach(function (chat) {
            if (!chat) return;
            var persistedSending = chat.isSending === true ||
                (chat._persisted && chat._persisted.isSending === true);
            var loopAlive = !!(chat.abortController || (chat.queue && chat.queue.length) || chat._verifyActive);
            if ((persistedSending || loopAlive) && !chat.abortController && !(chat.queue && chat.queue.length)) {
                candidates.push(chat);
            }
        });
        if (!candidates.length) return;

        _checkPoolActive(function (poolBusy) {
            var resumed = 0;
            candidates.forEach(function (chat) {
                // 池在跑（pool_resume 已重投）→ 前端对账会接管，不补发
                if (poolBusy) return;
                if (chat.isSending || chat._verifyActive || chat.abortController) return;
                var box = _findBox(chat);
                if (!box) return;
                if (typeof App.triggerContinueRound !== 'function') return;
                try {
                    App.triggerContinueRound(box, chat);
                    resumed++;
                } catch (e) {}
            });
            if (resumed > 0) {
                _toast('🔄 检测到 ' + resumed + ' 个对话在重启时任务中断，已自动补发「继续工作」，任务续跑中…');
            }
        });
    }

    // 延迟 12 秒：等 Store 会话恢复、池对账收敛、后端 pool_resume 重投完成
    function _boot() {
        setTimeout(_run, 12000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }
})();
