// ========== inject-bus.js - 中途插话总线（schema 冻结单模块，v1.3 第11节） ==========
// 所有 inject 对象的构造/入队/消费只允许经本模块，禁止绕过。
// schema: { id, text, ts, source ('user'), refToolId (可空), injected (bool) }
// 优先级规则：inject 先于 whip（入队时间序）；上限 10 条，超出丢弃最旧。
// 语义位置约束：落 history 必须在当前轮 user 消息之后（push 到尾部天然满足）。
var InjectBus = {
    MAX: 10,
    _whipSchema: '（用户插话·务必响应）',

    // 入队：插话进 chat._injectQueue（内存）+ saveChatBox 持久化（防刷新丢失）
    enqueue: function(chat, text) {
        if (!chat) return null;
        if (!chat._injectQueue) chat._injectQueue = [];
        // 上限保护：超出丢最旧
        while (chat._injectQueue.length >= this.MAX) chat._injectQueue.shift();
        var item = {
            id: 'inj' + Date.now() + Math.floor(Math.random() * 1000),
            text: String(text || '').trim(),
            ts: Date.now(),
            source: 'user',
            refToolId: null,
            injected: false
        };
        if (!item.text) return null;
        chat._injectQueue.push(item);
        // 持久化（flushNow 立即写，防刷新丢失）
        try { if (typeof Store !== 'undefined' && Store.saveChatBox) Store.saveChatBox(chat, true); } catch (e) {}
        try { Store.addLog('info', chat.id, 'inject-enqueue', '用户中途插话入队 (' + chat._injectQueue.length + '): ' + item.text.substring(0, 80)); } catch (e) {}
        return item;
    },

    // 消费：批量取出并同步落 history（injected 标记防重复注入；live 数组一次注入贯穿全程）
    // 返回本次消费的条目数组；history 落库走同一同步调用（无异步竞态）
    drain: function(chat) {
        if (!chat || !chat._injectQueue || !chat._injectQueue.length) return [];
        var items = chat._injectQueue.splice(0, chat._injectQueue.length);
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            it.injected = true;
            // 同步落 history（语义位置：push 到尾部 = 当前轮 user 消息之后）
            try { chat.history.push({ role: 'user', content: this._whipSchema + ' ' + it.text, _injected: true }); } catch (e) {}
            try { Store.addLog('info', chat.id, 'inject-consume', '插话注入模型 | depth时点见上下文: ' + it.text.substring(0, 80)); } catch (e) {}
        }
        // 清空后同步持久化
        try { if (typeof Store !== 'undefined' && Store.saveChatBox) Store.saveChatBox(chat, true); } catch (e) {}
        return items;
    },

    // 查看队列头（不消费）
    peek: function(chat) {
        return (chat && chat._injectQueue && chat._injectQueue.length) ? chat._injectQueue[0] : null;
    },

    // 队列长度（UI 待注入提示用）
    size: function(chat) {
        return (chat && chat._injectQueue) ? chat._injectQueue.length : 0;
    },

    // 终局残留消费：任务结束时残留插话转正常用户消息补发（可见性：UI 标注📌插话补发）
    // 返回 true 表示有残留已转队列续发
    drainToQueueOnFinish: function(chat, box) {
        var items = this.drain(chat);
        if (!items.length) return false;
        var texts = [];
        for (var i = 0; i < items.length; i++) texts.push(items[i].text);
        var text = texts.join('\n');
        // 标注可见性：📌插话补发
        var _visText = '📌插话补发：' + text;
        try {
            if (typeof App !== 'undefined' && App.addMsg) App.addMsg(box, _visText, 'user', chat.modelId);
            else if (typeof self !== 'undefined' && self.addMsg) self.addMsg(box, _visText, 'user', chat.modelId);
        } catch (e) {}
        // 走正常排队通道续发（等价用户手动补发）
        try {
            if (!chat.queue) chat.queue = [];
            chat.queue.push({ id: 'q' + Date.now() + Math.floor(Math.random() * 1000), text: _visText, _injectRelay: true });
            if (typeof App !== 'undefined' && App.renderQueue) App.renderQueue(box, chat);
            Store.addLog('info', chat.id, 'inject-relay', '终局残留插话转排队补发: ' + text.substring(0, 80));
        } catch (e) {}
        return true;
    }
};
if (typeof window !== 'undefined') window.InjectBus = InjectBus;
