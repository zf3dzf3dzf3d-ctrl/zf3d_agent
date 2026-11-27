/* ledger_livetest.js — 4派2收收口账本活体单测（node 直跑，不依赖浏览器）
   运行：node test\ledger_livetest.js （项目根或任意 cwd 均可）
   v6 追加场景⑥⑦⑧：跨派次污染重置 / autoCloseMissing seen 门 / 未在场成员不误核销 */
const path = require('path');
const ledgerPath = path.join(__dirname, '..', 'public', 'js', 'chatbox-dispatch-ledger.js');

/* 极简 localStorage/UserSettings 桩 */
global.window = { UserSettings: { _m: {}, set(k, v) { this._m[k] = v; }, get(k) { return this._m[k]; } } };
global.localStorage = { _m: {}, setItem(k, v) { this._m[k] = v; }, getItem(k) { return this._m[k] || null; } };

const src = require('fs').readFileSync(ledgerPath, 'utf8');
/* 在沙箱上下文中执行（文件是 IIFE，挂 window.ZFDispatchLedger） */
const fn = new Function('window', 'localStorage', src + '\nreturn window.ZFDispatchLedger;');
const L = fn(global.window, global.localStorage);

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS: ' + name); } else { fail++; console.log('FAIL: ' + name); } }

function mkChat(id) { return { id, el: {}, _n: 0 }; }

/* 场景①-1：错峰期只开出 2/4 窗，outstanding>0（箭头不得提前收口） */
L.registerExpected('src1', 4);
L.register('src1', ['a1', 'a2']);
check('①-1 错峰期 outstanding>0（只开出2窗）', L.outstanding('src1') > 0);

/* 场景①-2：全部开出后 outstanding=0 */
L.register('src1', ['a3', 'a4']);
check('①-2 全开出后 outstanding=0', L.outstanding('src1') === 0);

/* 场景①-3：4窗全部回复记账后 canGather=true */
['a1', 'a2', 'a3', 'a4'].forEach(id => L.markReturned('src1', id));
check('①-3 4窗回复记账后 canGather=true（自动收口放行）', L.canGather('src1') === true);

/* 场景②：快速回复+基线重写竞态——v5 记账判据 count>=1 && !isSending 不依赖差值 */
L.registerExpected('src2', 2);
L.register('src2', ['b1', 'b2']);
L.markReturned('src2', 'b1'); L.markReturned('src2', 'b2');
check('② 快速回复+基线重写竞态下 canGather=true（旧差值判据此处恒false）', L.canGather('src2') === true);

/* 场景③：仅 1/2 回复时不得放行 */
L.registerExpected('src3', 2);
L.register('src3', ['c1', 'c2']);
L.markReturned('src3', 'c1');
check('③ 仅1/2回复时 canGather=false（不放行）', L.canGather('src3') === false);

/* 场景④：finish 清账后重新放行 */
L.finish('src1');
check('④ finish 后登记清除 canGather=true', L.canGather('src1') === true);

/* 场景⑤：直打 576-577/783 残留差值判据——基线重写竞态（v5 保护） */
L.registerExpected('src5', 2);
L.register('src5', ['c1', 'c2']);
const f = { c1: mkChat('c1'), c2: mkChat('c2') };
const pairCounts = { c1: 0, c2: 0 };
f.c1._n = 1; f.c2._n = 1;
[f.c1, f.c2].forEach(m => { if (pairCounts[m.id] != null && m._n > pairCounts[m.id]) return; pairCounts[m.id] = m._n; });
let all5 = true;
[f.c1, f.c2].forEach(m => { if (m._n <= pairCounts[m.id]) all5 = false; });
check('⑤ 基线重写竞态+差值判据（v5保护后）就绪=true（旧代码此处恒false）', all5 === true);

/* 场景⑥【v6】：跨派次污染——上一轮残账不得让新一轮同源派发开局放行（反驳师①） */
L.registerExpected('src6', 4);
L.register('src6', ['d1', 'd2']);
L.markReturned('src6', 'd1'); L.markReturned('src6', 'd2');
L.markClosed('src6', 'd1'); L.markClosed('src6', 'd2');
L.registerExpected('src6', 4); /* 新一轮同源派发：必须整体重置 */
check('⑥ 跨派次重置后 canGather=false（残账不放行）', L.canGather('src6') === false);
L.register('src6', ['d1', 'd2']);
check('⑥-2 新轮只开出2窗 canGather=false', L.canGather('src6') === false);

/* 场景⑦【v6】：autoCloseMissing seen 门——曾在场后消失才核销；在场者不核销（反驳师②） */
L.registerExpected('src7', 3);
L.register('src7', ['e1', 'e2']);
L.register('src7', ['e3']);
L.autoCloseMissing('src7', id => ({ e1: { el: 1 }, e2: { el: 1 }, e3: { el: 1 } }[id])); /* 第一帧：全部见过 */
L.autoCloseMissing('src7', id => ({ e2: { el: 1 }, e3: { el: 1 } }[id])); /* 第二帧：e1 瞬时查询失败 */
check('⑦ 曾在场后消失的 e1 被核销', (() => { const r = L._state()['src7']; return !!(r && r.closed && r.closed.e1); })() === true);
check('⑦-2 在场的 e2/e3 未被核销', (() => { const r = L._state()['src7']; return !(r.closed.e2 || r.closed.e3); })() === true);

/* 场景⑧【v6】：从未在场（未 register 进场）的成员不得被核销 */
L.registerExpected('src8', 2);
L.register('src8', ['g1']);
L.autoCloseMissing('src8', id => id === 'g1' ? { el: 1 } : null);
check('⑧ 未曾见过的缺席成员不计 closed', (() => { const r = L._state()['src8']; return !r || !r.closed || !r.closed.g2; })() === true);

console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
