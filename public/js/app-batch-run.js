// ========== app-batch-run.js - ▶ 批量播放 / ■ 停止（一键开启/关闭所有对话） ==========
// 功能：
//  1. 在左上角「文件菜单 🗂️」按钮右侧增加一个播放/停止二合一按钮
//  2. 点播放：立即变成 ■（停止态），同时向所有待工作对话隐形发送"继续工作"批量干活
//  3. 点停止：立即变成 ▶（播放态），同时停止所有正在工作的对话并保存数据（可安全重启不丢）
//  ★ 逻辑极简化：按钮状态只由「点击」驱动——点播放立刻变停止，点停止立刻变播放，
//    不再轮询"是否有对话在工作"（手动单独启动的对话也一样：点停止即全部关掉）。
// 依赖：Store(store.js)、App.triggerContinueRound(agent-01-project-memory.js)。加载顺序放这些之后即可。
(function () {
    'use strict';

    var _btn = null;          // 按钮引用
    var _running = false;     // 当前按钮状态：true=停止态(■) / false=播放态(▶)
    var _timer = null;        // 串行触发定时器

    // ---- 轻量提示（不依赖 toast-stack，自绘右上角浮层，避免函数名差异） ----
    function _toast(msg, isErr) {
        try {
            var t = document.createElement('div');
            t.style.cssText = 'position:fixed;top:52px;right:16px;z-index:100000;max-width:360px;' +
                'padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.5;' +
                'background:rgba(20,24,32,.92);border:1px solid ' + (isErr ? 'rgba(255,110,110,.6)' : 'rgba(90,200,140,.5)') + ';' +
                'color:#e8eef7;box-shadow:0 8px 24px rgba(0,0,0,.35);white-space:pre-wrap;';
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(function () {
                t.style.transition = 'opacity .4s'; t.style.opacity = '0';
                setTimeout(function () { try { t.remove(); } catch (e) {} }, 450);
            }, 3600);
        } catch (e) {}
    }

    function _getBoxes() {
        // 【关键修复】必须用 App.chatBoxes（页面内存中的"活"对话对象），
        // 之前误用 Store.data.chatBoxes（持久化副本），对副本触发/abort 完全不影响真实对话 → 原地不动
        try { if (window.App && App.chatBoxes && App.chatBoxes.length) return App.chatBoxes; } catch (e) {}
        try { return (window.Store && Store.data && Store.data.chatBoxes) || []; } catch (e) { return []; }
    }

    // ---- 跳过判定：返回跳过原因（空串=不跳过，需要继续工作） ----
    function _skipReason(chat) {
        if (!chat) return '无效对话';
        // 正在工作的：掠过
        if (chat.isSending) return '正在工作中';
        var h = chat.history || [];
        // 【修复】刷新后 chat.history 可能尚未恢复（消息在 Store.data.messages 中异步恢复），
        // history 为空时回退读 Store.data.messages，避免把有内容的对话误判为「空对话」跳过
        if (!h.length) {
            try {
                var _fb = (window.Store && Store.data && Store.data.messages && Store.data.messages[chat.id]) || [];
                if (_fb.length) h = _fb;
            } catch (e) {}
        }
        if (!h.length) return '空对话';
        // 从最后往前找最近一条 user/assistant 消息
        for (var i = h.length - 1; i >= 0; i--) {
            var m = h[i];
            if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
            if (m.role === 'user') {
                // 继续轮消息：若后面还没有 assistant 回复（排队中/上轮被停），不算已工作，允许再次触发
                if (m._continueRound) return '';
                break;
            }
            // 最后一条是 assistant 答案：若为验证成功（答案结论），掠过
            var c = String(m.content || '');
            if (c.indexOf('二次验证成功') >= 0 || chat._verifiedOnce) return '验证成功';
            break;
        }
        return '';
    }

    // ---- 按钮外观：完全由 _running 状态驱动，点击即切换，无轮询 ----
    function _setBtn() {
        if (!_btn) return;
        if (_running) {
            _btn.textContent = '■';
            _btn.title = '批量停止：点击立即停止全部对话并保存数据（可安全重启不丢）';
            _btn.style.color = '#ff6b6b';
        } else {
            _btn.textContent = '▶';
            _btn.title = '批量播放：点击立即向所有待工作对话发送"继续工作"（已工作/验证成功的自动掠过）';
            _btn.style.color = '';
        }
    }

    // ---- 播放：全部对话同时开启（并行触发，无串行队列） ----
    function _start() {
        var boxes = _getBoxes();
        var n = 0;
        for (var i = 0; i < boxes.length; i++) {
            var ch = boxes[i];
            if (!ch || ch.isSending) continue; // 已在工作的不动
            try {
                ch._stopped = false;      // 清除历史停止标记，允许继续轮发送
                ch._verifyActive = false; // 清除残留的验证/继续轮标记，否则 triggerContinueRound 开头直接 return
                ch._batchRunning = true;
                if (typeof App !== 'undefined' && typeof App.triggerContinueRound === 'function') {
                    App.triggerContinueRound(ch.el || null, ch);
                    try { Store.saveChatBox && Store.saveChatBox(ch, true); } catch (e2) {}
                    n++;
                }
            } catch (e) {
                try { Store.addLog && Store.addLog('error', (ch && ch.id) || '', 'batch-run', '触发失败: ' + e.message); } catch (e2) {}
            }
        }
        _toast('▶ 已同时开启 ' + n + ' 个对话继续工作。\n再点 ■ 即全部停止并保存。');
        try { Store.addLog && Store.addLog('info', '', 'batch-run', '批量播放：同时开启 ' + n + ' 个对话继续轮'); } catch (e) {}
    }

    // ---- 停止单个对话（保存数据，防丢失）----
    function _stopOne(ch) {
        if (!ch) return false;
        try {
            ch._batchRunning = false;
            // 排队继续轮（_verifyActive=true 但还没真正发请求，isSending=false）也要停并清标记，
            // 否则 _verifyActive 残留，之后批量播放/继续轮全部被 triggerContinueRound 拒绝
            if (ch.isSending || ch._verifyActive) {
                ch._stopped = true;        // 置停止标记：内部 600ms 延迟发送/验证轮都会被拦截
                ch._verifyActive = false;  // 清除验证/继续轮标记：解除 triggerContinueRound 的入口拦截
                if (ch.abortController) { try { ch.abortController.abort(); } catch (e) {} }
                try { Store.saveChatBox && Store.saveChatBox(ch, true); } catch (e2) {}
                return true;
            }
        } catch (e) {}
        return false;
    }

    // ---- 停止：停掉所有正在工作的对话 + 保存数据（防丢失，可安全重启） ----
    function _stopAll(showTip) {
        if (_timer) { clearTimeout(_timer); _timer = null; }
        var boxes = _getBoxes();
        var n = 0;
        for (var i = 0; i < boxes.length; i++) {
            if (_stopOne(boxes[i])) n++;
        }
        // 全量强制保存一次（对话可能已停但还有未落盘的中间态，Store.flush 触发所有防抖定时器立即写）
        try { if (typeof Store !== 'undefined' && typeof Store.flush === 'function') Store.flush(); } catch (e) {}
        try { Store.addLog && Store.addLog('info', '', 'batch-run', '批量停止：停止 ' + n + ' 个对话，数据已保存'); } catch (e) {}
        if (showTip !== false) {
            _toast(n ? ('■ 已停止 ' + n + ' 个正在工作的对话，数据已保存。\n重启浏览器/刷新都不会丢失数据。') : '已停止：没有正在工作的对话，数据已保存。');
        }
    }

    // ---- 注册按钮：插到左上角「文件菜单」按钮（canvasMenuBtn）出现后，插到其右侧 ----
    function _inject() {
        var anchor = document.getElementById('canvasMenuBtn');
        if (!anchor) { setTimeout(_inject, 800); return; }
        if (document.getElementById('batchRunBtn')) return;
        _btn = document.createElement('button');
        _btn.id = 'batchRunBtn';
        _btn.className = 'topbar-icon';
        _btn.textContent = '▶';
        _btn.title = '批量播放：向所有待工作对话发送"继续工作"；点击后立即变为停止，再点一次即全部停止并保存';
        _btn.style.marginLeft = '10px';
        _btn.style.fontSize = '14px';
        _btn.addEventListener('click', function (e) {
            e.stopPropagation();
            // 【极简逻辑】点击即切换状态：播放→立即变 ■ 并批量开启；停止→立即变 ▶ 并批量关闭
            if (_running) {
                _running = false;
                _setBtn();          // 立刻变 ▶
                _stopAll(true);
            } else {
                _running = true;
                _setBtn();          // 立刻变 ■
                _start();
            }
        });
        anchor.parentNode.insertBefore(_btn, anchor.nextSibling);
        _setBtn();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _inject);
    } else {
        _inject();
    }

    // 页面刷新/关闭前若还在播放，先保存数据（安全兜底）
    window.addEventListener('beforeunload', function () {
        if (_running) { try { _stopAll(false); } catch (e) {} }
    });
})();
