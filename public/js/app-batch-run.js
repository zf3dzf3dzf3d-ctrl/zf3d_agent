// ========== app-batch-run.js - ▶ 批量播放 / ■ 停止（一键开启/关闭所有对话） ==========
// 功能：
//  1. 在左上角「文件菜单 🗂️」按钮右侧增加一个播放/停止二合一按钮
//  2. 点播放：立即变成 ■（停止态），同时向所有待工作对话隐形发送"继续工作"批量干活
//  3. 点停止：立即变成 ▶（播放态），同时停止所有正在工作的对话并保存数据（可安全重启不丢）
//  ★ 逻辑：按钮状态由「实时监控」驱动——每秒扫描所有对话，
//    只要有任一对话正在工作（isSending 或 _verifyActive 排队中），按钮显示 ■（批量停止）；
//    全部空闲则显示 ▶（批量播放）。手动单独启动的对话也会让按钮变 ■，点击即快速全部停止。
// 依赖：Store(store.js)、App.triggerContinueRound(agent-01-project-memory.js)。加载顺序放这些之后即可。
(function () {
    'use strict';

    var _btn = null;          // 按钮引用
    var _timer = null;        // 串行触发定时器
    var _mode = 'stop';       // 【显式状态】'run'=批量运行中 'stop'=已停止。点击直接翻转，
                              // 不再靠 _anyWorking() 实时推断（推断经常与用户意图相反 → 不好使）

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

    // 【实时监控】每秒扫描：只要有任一对话正在工作（isSending 或 _verifyActive 排队中），
    // 按钮强制显示 ■（批量停止）；全部空闲才显示 ▶。手动单独启动的对话也会让按钮变 ■。
    function _anyWorking() {
        var boxes = _getBoxes();
        for (var i = 0; i < boxes.length; i++) {
            var ch = boxes[i];
            if (ch && (ch.isSending || ch._verifyActive)) return true;
        }
        return false;
    }
    setInterval(function () {
        var working = _anyWorking();
        var next = working ? 'run' : 'stop';
        if (next !== _mode) { _mode = next; _setBtn(); }
    }, 1000);

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

    // ---- 按钮外观：由显式 _mode 驱动（不做实时监控推断） ----
    function _setBtn() {
        if (!_btn) return;
        if (_mode === 'run') {
            _btn.textContent = '■';
            _btn.title = '批量停止：点击立即停止全部对话并保存数据（可安全重启不丢）';
            _btn.style.color = '#ff6b6b';
        } else {
            _btn.textContent = '▶';
            _btn.title = '批量开始：点击立即向所有待工作对话发送"继续工作"（已工作/验证成功的自动掠过）';
            _btn.style.color = '';
        }
    }

    // 兼容保留：其他模块可能调用此通知函数（已去掉轮询，仅刷新外观）
    window._notifyWorkStateChange = function () { _setBtn(); };

    // ---- 开始：全部对话同时开启（并行触发，无串行队列） ----
    function _start() {
        var boxes = _getBoxes();
        var n = 0, skipped = 0;
        for (var i = 0; i < boxes.length; i++) {
            var ch = boxes[i];
            if (!ch || ch.isSending) continue; // 已在工作的不动
            // 【修复】真正用上跳过判定：验证成功/空对话不再重复触发，避免烧 token 死循环
            var reason = _skipReason(ch);
            if (reason) { skipped++; continue; }
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
        var skipMsg = skipped > 0 ? ('\uff0c跳过 ' + skipped + ' 个\uff08已验证成功/空对话\uff09') : '';
        _toast('\u25b6 已同时开启 ' + n + ' 个对话继续工作' + skipMsg + '.\n再点 \u25a0 即全部停止并保存。');
        _mode = 'run'; _setBtn();
        try { Store.addLog && Store.addLog('info', '', 'batch-run', '批量播放：同时开启 ' + n + ' 个对话继续轮' + (skipped > 0 ? '\uff0c跳过 ' + skipped + ' 个' : '')); } catch (e) {}
    }
    // ---- 停止单个对话（保存数据，防丢失）----
    function _stopOne(ch) {
        if (!ch) return false;
        var _wasWorking = !!(ch.isSending || ch._verifyActive ||
            ch.abortController || (ch.queue && ch.queue.length));
        if (!_wasWorking) { try { ch._batchRunning = false; } catch (e) {} return false; }
        try {
            ch._batchRunning = false;
            // 【修复】优先走官方停止（与单框停止按钮完全一致）：
            // 置 _stopped、_epoch 换代杀挂起重试链（防僵尸复活继续烧 token）、
            // 标记用户主动停、abort 当前请求、同步取消池内 Turn、清理 typing 指示器
            if (typeof App !== 'undefined' && typeof App.stopSending === 'function') {
                App.stopSending(ch);
            } else {
                ch._stopped = true;
                if (ch.abortController) { try { ch.abortController.abort(); } catch (e) {} }
            }
            // 排队继续轮（_verifyActive=true 但还没真正发请求）也要清标记，
            // 否则 _verifyActive 残留，之后批量播放/继续轮全部被 triggerContinueRound 拒绝
            ch._verifyActive = false;
            // 【修复】批量停止语义 = 全部停：丢弃排队消息，否则官方 stopSending 的
            // 队列分支会解除 _stopped 并立刻续发下一条，导致"停了又自己跑起来"
            if (ch.queue && ch.queue.length) {
                try { ch.queue.length = 0; } catch (e) {}
                try { ch._stopped = true; } catch (e) {}
            }
            try { Store.saveChatBox && Store.saveChatBox(ch, true); } catch (e2) {}
            return true;
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
        _mode = 'stop'; _setBtn();
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
        _btn.title = '批量开始：向所有待工作对话发送"继续工作"；再点一次即全部停止并保存';
        _btn.style.marginLeft = '10px';
        _btn.style.fontSize = '14px';
        _btn.addEventListener('click', function (e) {
            e.stopPropagation();
            // 【显式状态切换】一步到位：run 态点击=全部停止，stop 态点击=全部开始。
            // 不再靠 _anyWorking() 实时推断（推断常与用户意图相反 → 经常不好使）
            if (_mode === 'run') {
                _stopAll(true);
            } else {
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

    // 页面刷新/关闭前若有对话在工作，先停止并保存数据（安全兜底）
    window.addEventListener('beforeunload', function () {
        if (_mode === 'run') { try { _stopAll(false); } catch (e) {} }
    });
})();
