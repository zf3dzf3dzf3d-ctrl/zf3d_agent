// 【一次性仿真自测】chatbox-11-lazy-history.js v2.0 核心行为验证(跑完即删)
// 场景:A 长对话(200条)恢复→只渲尾部100条且上翻按钮存在(v1.1因st.start恒0按钮刚挂即被摘,本次修复点)
//      B expandAllHistory 一键展开→head归零/_histExpanded打标/按钮移除
//      C 短对话(50条≤120)→全量渲染无按钮
'use strict';
function mkNode(cls) {
    return {
        className: cls || '',
        classList: { contains: function (c) { return (' ' + (cls || '') + ' ').indexOf(' ' + c + ' ') !== -1; } },
        dataset: {}, childNodes: [], style: {}, disabled: false,
        _handlers: {},
        addEventListener: function (t, fn) { this._handlers[t] = fn; },
        setAttribute: function () {},
        appendChild: function (n) { n.parentNode = this; this.childNodes.push(n); return n; },
        insertBefore: function (n, ref) { n.parentNode = this; var i = this.childNodes.indexOf(ref); if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); },
        replaceChild: function (nNew, nOld) { var i = this.childNodes.indexOf(nOld); if (i >= 0) { this.childNodes.splice(i, 1, nNew); nNew.parentNode = this; nOld.parentNode = null; } return nOld; },
        removeChild: function (n) { var i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; },
        get firstChild() { return this.childNodes[0]; }
    };
}
function mkBody() {
    var body = mkNode('chatbox-body');
    body._realChildNodes = []; // 真实子节点(按钮/消息),insertAdjacentHTML 按片段计数生成占位
    body.childNodes = body._realChildNodes;
    body.insertAdjacentHTML = function (pos, html) {
        var n = (html.match(/<div/g) || []).length;
        for (var i = 0; i < n; i++) {
            var nd = mkNode('msg ai');
            if (pos === 'afterbegin') body._realChildNodes.splice(i, 0, nd); else body._realChildNodes.push(nd);
        }
    };
    body.querySelectorAll = function (sel) {
        var parts = sel.replace(/^\./, '').split('.');
        return body._realChildNodes.filter(function (n) {
            var cls = ' ' + n.className + ' ';
            for (var i = 0; i < parts.length; i++) { if (cls.indexOf(' ' + parts[i] + ' ') === -1) return false; }
            return true;
        });
    };
    body.querySelector = function (sel) { return body.querySelectorAll(sel)[0] || null; };
    body.scrollHeight = 5000; body.scrollTop = 0;
    return body;
}
global.document = { createElement: function (t) { return mkNode(t); }, createComment: function () { return mkNode(''); } };
global.requestAnimationFrame = function (fn) { fn(); };
var _timers = [];
global.setTimeout = function (fn) { _timers.push(fn); }; // 收集定时器,泵循环手动执行(模拟事件循环)
global.window = global;
global.App = {
    renderMarkdown: function (s) { return String(s); },
    _escapeHtml: function (s) { return String(s); },
    _refreshUserMsgBtns: function () {}
};
require(__dirname + '/../public/js/chatbox-11-lazy-history.js');

var ok = 0, fail = 0;
function assert(name, cond) { if (cond) { ok++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

// ---- 场景 A:长对话 200 条 ----
var boxA = { id: 'chatA', querySelector: function (s) { return s === '.chatbox-body' ? bodyA : null; } };
var bodyA = mkBody();
var chatA = { id: 'chatA', history: [] };
var msgsA = [];
for (var i = 0; i < 200; i++) msgsA.push({ role: i % 2 ? 'user' : 'assistant', content: '消息' + i, ts: i });
App.renderChatTail(boxA, chatA, msgsA, { source: 'test' });
assert('A1 长对话只渲尾部100条(DOM 100消息+1按钮)', bodyA._realChildNodes.length === 101);
assert('A2 chat.history 数据层全量回填200条', chatA.history.length === 200);
var stA = bodyA._lazyHist;
assert('A3 未渲染头部 head=100', stA && stA.head === 100);
assert('A4 上翻按钮存在且为首节点(v1.1按钮刚挂即被误摘,本次修复点)', stA && stA.btn && bodyA._realChildNodes[0] === stA.btn);
assert('A5 按钮文案含全部剩余数100', stA.btn.textContent.indexOf('100') !== -1);

// ---- 场景 B:一键展开全部 ----
stA.btn._handlers.click(); // expandAllHistory 入口(首批同步,drain 后续批次走 setTimeout 队列)
assert('B1 展开即打标 _histExpanded', bodyA._histExpanded === true);
// 泵干定时器队列直到 head 归零且 busy 复位(drain 每轮一批,批间 setTimeout(0)),含最后的按钮移除定时器
var pump = 0;
while (pump++ < 500 && _timers.length && (stA.head > 0 || stA.busy || _timers.length)) { _timers.shift()(); }
assert('B3 全部加载完 head=0(200条消息全可见,按钮已定时移除)', stA.head === 0 && bodyA._realChildNodes.length === 200);
assert('B4 结束后 busy 复位', stA.busy !== true);

// ---- 场景 B2:展开后 _histExpanded 守卫语义(裁剪函数行为在 chatbox-06,这里断言标记供其消费) ----
assert('B5 守卫标记仍在(裁剪 v4/trimMsgDom 见标跳过)', bodyA._histExpanded === true);

// ---- 场景 C:短对话 50 条 ----
var boxC = { id: 'chatC', querySelector: function (s) { return s === '.chatbox-body' ? bodyC : null; } };
var bodyC = mkBody();
var msgsC = [];
for (var j = 0; j < 50; j++) msgsC.push({ role: j % 2 ? 'user' : 'assistant', content: '短' + j, ts: j });
App.renderChatTail(boxC, { id: 'chatC', history: [] }, msgsC, { source: 'test' });
assert('C1 短对话(≤120)全量渲染50条', bodyC._realChildNodes.length === 50);
assert('C2 短对话无上翻按钮', !(bodyC._lazyHist && bodyC._lazyHist.btn));

// ---- 场景 D/E:updateChatTitle 标题真源(懒渲染下 DOM 第一条≠全对话第一条) ----
// 加载被测函数(chatbox-05 Object.assign(App, {...}))
global.Store = {
    _db: {},
    getMessages: function (id) { return this._db[id] || []; },
    saveChatBox: function () {}
};
require(__dirname + '/../public/js/chatbox-05-message-edit.js');

var titleD = { textContent: '', title: '', dataset: {} };
var fakeWinUser = {
    className: 'msg user', dataset: { originalText: '窗口第一条提问' },
    classList: { contains: function (c) { return c === 'user'; } },
    querySelector: function () { return null; }
};
var bodyD = mkBody();
bodyD._realChildNodes = [fakeWinUser]; // 懒渲染后 DOM 可见窗口里只有"窗口第一条提问"
var boxD = {
    id: 'chatD',
    querySelector: function (s) {
        if (s === '.chatbox-body') return bodyD;
        if (s.indexOf('.title') !== -1) return titleD;
        return null;
    }
};
App.chatBoxes = [{ el: boxD, id: 'chatD', userRenamed: false }];
// 数据层全量 300 条:真第一句在最前,窗口第一条(假标题源)在尾部区间
var fullMsgs = [{ role: 'user', content: '真第一句提问', ts: 1 }];
for (var k = 0; k < 299; k++) fullMsgs.push({ role: k % 2 ? 'assistant' : 'user', content: k === 250 ? '窗口第一条提问' : '后续消息' + k, ts: k + 2 });
Store._db['chatD'] = fullMsgs;
App.updateChatTitle(boxD, '');
assert('D1 标题取数据层真第一句(非DOM窗口第一条)', titleD.textContent.indexOf('真第一句提问') !== -1);
assert('D2 hover全文titleEl.title=真第一句', titleD.title === '真第一句提问');

// 场景 E:数据层为空(克隆场景)→ DOM 兜底仍可用
Store._db['chatD'] = [];
App.updateChatTitle(boxD, '');
assert('E1 数据层为空时DOM兜底取窗口第一条', titleD.textContent.indexOf('窗口第一条提问') !== -1);

// 场景 F:多模态消息(数组content)只拼文本部分,不取 [object Object]
Store._db['chatD'] = [
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'x.png' } }, { type: 'text', text: '图片提问文本' }] },
    { role: 'assistant', content: '答' }
];
App.updateChatTitle(boxD, '');
assert('F1 数组content提取text部分当标题', titleD.textContent.indexOf('图片提问文本') !== -1 && titleD.textContent.indexOf('object') === -1);

// ---- 场景 G:_historyCutBefore 编辑/删除截断点定位(数据破坏修复的核心) ----
// 全量 history 10 条,未渲染头部=head 条 renderable,窗口内目标 user 按计数定位截断点。
var histG = [
    { role: 'user', content: 'U1' },                          // 全对话第1条user(索引0)
    { role: 'assistant', content: 'A1' },
    { role: 'assistant', content: '\u23F1__TASKMETA__x' },     // TASKMETA:原实现会丢,新实现保留
    { role: 'user', content: 'U2' },                          // 第2条user(索引3)
    { role: 'assistant', content: 'A2' },
    { role: 'assistant', content: '\u2705 \u4efb\u52a1\u5b8c\u6210' }, // 任务总结:原实现会丢
    { role: 'user', content: 'U3' },                          // 第3条user(索引6,未渲染区间最后一条)
    { role: 'assistant', content: 'A3' },
    { role: 'user', content: 'U4' },                          // 第4条user(索引8)=窗口内被编辑目标
    { role: 'assistant', content: 'A4' }
];
var chatG = { id: 'chatG', history: histG };
var mkMsgNode = function (cls) { var n = mkNode(cls); n.querySelector = function () { return null; }; return n; };
// G1:头部未渲染区间=索引[0..7)含 U1/U2/U3 共 3 条 user;编辑窗口内第0条(U4),其前窗口 user=0
// → 前缀 user 数=3 → 截断点=U4 的 history 索引 8(头部 TASKMETA/任务总结随 slice 保留)
var bodyG = mkBody();
bodyG._lazyHist = { chatId: 'chatG', head: 7, renderable: histG.slice(0, 7).map(function (m) { return { m: m }; }) };
var winListG = [mkMsgNode('msg user'), mkMsgNode('msg ai')];
var cutG = App._historyCutBefore(bodyG, chatG, 0, winListG);
assert('G1 编辑窗口内首条user→截断点=8(头部TASKMETA/任务总结保留)', cutG === 8);
// G2:计数越界(头部3条user > history实际2条user)→找不到第N条→兜底全保不截
var chatG2 = { id: 'chatG2', history: [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }] };
var bodyG2 = mkBody();
bodyG2._lazyHist = { head: 7, renderable: histG.slice(0, 7).map(function (m) { return { m: m }; }) };
var cutG2 = App._historyCutBefore(bodyG2, chatG2, 0, []);
assert('G2 计数越界兜底全保不截(宁失败不丢数据)', cutG2 === chatG2.history.length);
// G3:真异常(msgList 元素访问 classList 即 throw)→catch 兜底全保
var evilList = [new Proxy({}, { get: function () { throw new Error('boom'); } })];
var cutG3 = App._historyCutBefore(mkBody(), chatG, 1, evilList);
assert('G3 异常兜底全保', cutG3 === histG.length);
// G4:无懒渲染(短对话全渲)窗口内第2条user(win4[2]),其前窗口 user=1 → 全对话第2条user=U2索引3
var bodyG4 = mkBody();
var win4 = [mkMsgNode('msg user'), mkMsgNode('msg ai'), mkMsgNode('msg user')];
var cutG4 = App._historyCutBefore(bodyG4, chatG, 2, win4);
assert('G4 短对话(无未渲染区间)按窗口内计数定位', cutG4 === 3);

console.log('\n结果: ' + ok + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
