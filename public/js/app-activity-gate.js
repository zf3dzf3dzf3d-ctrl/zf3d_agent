// ========== app-activity-gate.js - 活动感知轮询门控 ==========
// 目的：界面静止 + 没人操作 + 没有对话在跑 → 所有轮询休眠，不浪费请求/帧率
// 规则：
//   1. 页面不可见(document.hidden) → 休眠
//   2. 页面可见但 IDLE_MS 内无任何输入(鼠标/键盘/滚动/触摸) 且无繁忙任务 → 休眠
//   3. 休眠期间保留 allow(key, heartbeatMs) 心跳：每 heartbeatMs 放行一次，防服务器侧任务失联
//   4. 任何输入或繁忙状态 → 立即唤醒，并派发 'activitygate-wake' 事件（模块可监听后立即补一次轮询）
// 用法：
//   if (window.ActivityGate && !ActivityGate.allow('monitor', 300000)) return;  // 轮询回调第一行
//   document.addEventListener('activitygate-wake', function(){ /* 立即轮询一次 */ });
//   ActivityGate.addBusy(function(){ return ...; });  // 注册额外"繁忙"判定
(function () {
    'use strict';
    if (window.ActivityGate) return;

    var IDLE_MS = 60000;          // 无操作 60 秒 = 界面静止
    var lastActive = Date.now();

    ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (ev) {
        window.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true });
    });

    var busyFns = [];
    function userPresent() { return (Date.now() - lastActive) < IDLE_MS; }

    function busy() {
        try {
            var boxes = (typeof App !== 'undefined' && App.chatBoxes) || [];
            for (var i = 0; i < boxes.length; i++) {
                var c = boxes[i];
                if (c && (c.isSending || c.abortController)) return true;
            }
        } catch (e) {}
        for (var j = 0; j < busyFns.length; j++) {
            try { if (busyFns[j]()) return true; } catch (e) {}
        }
        return false;
    }

    function sleeping() { return document.hidden || boostMode || (!userPresent() && !busy()); }

    // 状态变化时通知（唤醒时派发 wake 事件）
    var wasSleeping = null;
    setInterval(function () {
        var s = sleeping();
        if (s !== wasSleeping) {
            wasSleeping = s;
            if (!s) {
                try { document.dispatchEvent(new CustomEvent('activitygate-wake')); } catch (e) {}
            }
        }
    }, 2000);

    var lastAllow = {};
    var boostMode = false;
    window.ActivityGate = {
        WAKE_EVENT: 'activitygate-wake',
        sleeping: sleeping,
        userPresent: userPresent,
        busy: busy,
        addBusy: function (fn) { busyFns.push(fn); },
        // 提速模式：无论有没有人操作，一律按休眠处理（心跳仍按各模块 heartbeatMs 放行）
        boost: function (on) {
            boostMode = !!on;
            lastActive = on ? 0 : Date.now();  // 开提速 → 立即视为静止；关提速 → 恢复活跃
        },
        isBoost: function () { return boostMode; },
        // 轮询放行判断：活跃时恒放行；休眠时每 heartbeatMs 只放行一次（心跳）
        allow: function (key, heartbeatMs) {
            if (!sleeping()) { lastAllow[key] = 0; return true; }
            var now = Date.now();
            if (!lastAllow[key] || (now - lastAllow[key]) >= (heartbeatMs || 300000)) {
                lastAllow[key] = now;
                return true;
            }
            return false;
        }
    };
})();
