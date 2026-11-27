// ==== chatbox-status-machine.js — 七态状态机（丢界面≠停摆） ====
// 策划案 P-七态：统一状态枚举 + 持久化 + 恢复 + 广播
// 七态定义（唯一真源 chat.runState，序列化字段 runState）：
//   idle         空闲（灰）
//   streaming    AI 流式输出中（琥珀脉冲）
//   tool_running 工具执行中（蓝脉冲）
//   waiting_user AI 已回复等用户输入（绿）
//   queued       排队中（黄）
//   failed       失败（红）
//   minimized    已最小化到标题（紫）
// 设计原则：
//   1) 渲染层只认 .status-dot class 与 data-state；数据层 chat.runState 是唯一真源
//   2) 恢复时运行态（streaming/tool_running/queued）安全降级 idle —— 丢界面≠停摆：状态可恢复，运行不凭空复活
//   3) 在 P2 三档之上工作：title/minimal 档状态点实时着色
(function () {
    if (typeof window === 'undefined') return;

    var STATES = ['idle', 'streaming', 'tool_running', 'waiting_user', 'queued', 'failed', 'minimized'];
    var RUNNING_STATES = { streaming: 1, tool_running: 1, queued: 1 };
    // 七态 → 现有 status-dot 着色类映射（全部复用 style-chatbox.css 已有颜色，零新增 CSS）
    var DOT_CLASS = {
        idle: 'status-idle',
        streaming: 'status-sending',
        tool_running: 'status-active',
        waiting_user: 'status-success',
        queued: 'status-queued',
        failed: 'status-error',
        minimized: 'status-collapsed'
    };

    function chatOf(box) {
        try {
            /* 【整改 2026-11-23】容器名修正：全站真实容器是 App.chatBoxes（chatbox-00 createChatBox
               push、chatbox-01/06 等消费，全仓 140+ 处），原先写错为 App.chats（恒 undefined），
               导致本模块永远拿不到 chat 对象——runState 不落 chat 内存、set 不持久化不广播。
               （zf-app-collect.js 的 App.chats 仅是其自身的兜底读取，非容器定义） */
            if (window.App && App.chatBoxes && box) {
                for (var i = 0; i < App.chatBoxes.length; i++) if (App.chatBoxes[i].el === box) return App.chatBoxes[i];
            }
        } catch (e) {}
        return null;
    }

    function apply(box, state) {
        if (!box) return;
        var dot = box.querySelector('.status-dot');
        if (dot) dot.className = 'status-dot ' + (DOT_CLASS[state] || 'status-idle');
        box.dataset.state = state;
        var chat = chatOf(box);
        if (chat) chat.runState = state;
    }

    window.ZFStatusMachine = {
        STATES: STATES,
        // 设置状态：写 DOM + 写 chat 内存 + 持久化 + 广播
        set: function (box, state) {
            if (STATES.indexOf(state) < 0 || !box) return;
            apply(box, state);
            var chat = chatOf(box);
            try { if (chat) Store.saveChatBox(chat); } catch (e) {}
            if (chat) this.broadcast(chat.id, state);
        },
        get: function (box) {
            return (box && box.dataset.state) || 'idle';
        },
        // 恢复路径：存档为运行态则安全降级 idle（后台运行上下文已随旧页面消失）
        restore: function (box, saved) {
            var st = (saved && STATES.indexOf(saved) >= 0) ? saved : 'idle';
            if (RUNNING_STATES[st]) st = 'idle';
            apply(box, st);
        },
        // 广播：CustomEvent 通知其他模块/未来多窗（title/minimal 档监听此事件刷新聚合视图）
        broadcast: function (id, state) {
            try { document.dispatchEvent(new CustomEvent('zf:runstate', { detail: { id: id, state: state } })); } catch (e) {}
        }
    };
})();
