// 【永久回归】_agentLoop 参数错位守卫：retryRound 槽不得接收 epoch。
// 背景：工具续轮等 5 处递归调用曾写成 7 参 (…, depth + 1, null, _myEpoch)，
// 第 7 参 _myEpoch（对话代次，每发消息/停止 +1）错落进 retryRound（重试轮次）槽 →
// 重试提示显示「第5/3轮」这类代次当轮次的乱码，且轮次续命条件 retryRound+1<上限
// 在 epoch≥2 后恒假 —— 任务中途多轮耐心重试被静默锁死。
// 修复：9 参 (…, depth + 1, null, 0, null, _myEpoch)，新逻辑步骤轮次归零。
// 用法：node tests/test_agent_loop_retry_args.test.js   （退出码 0 = PASS）
// 静态扫描源码即可，无需 DOM/网络环境。签名：
// _agentLoop(box, chat, model, messages, depth, retryCount, retryRound, poolTurnId, loopEpoch)
'use strict';
var fs = require('fs');
var path = require('path');

var FILES = [
    path.join(__dirname, '..', 'public', 'js', 'agent-02-loop-core.js'),
    path.join(__dirname, '..', 'public', 'js', 'agent-01-project-memory.js')
];

var ok = 0, fail = 0;
function assert(name, cond, detail) {
    if (cond) { ok++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (detail ? ' | ' + detail : '')); }
}

var calls = []; // {file, args:[...]}
FILES.forEach(function (f) {
    var src = fs.readFileSync(f, 'utf8');
    var re = /(?:self|this)\._agentLoop\(([^()]*)\)/g, m;
    while ((m = re.exec(src))) {
        calls.push({ file: path.basename(f), args: m[1].split(',').map(function (s) { return s.trim(); }) });
    }
});

assert('调用点扫描到足够样本（loop-core 13 + agent-01 2）', calls.length >= 15, '实际 ' + calls.length);

// 断言1（核心）：retryRound 槽（第7参）凡是被传参，绝不能是 Epoch 表达式
var epochInRoundSlot = calls.filter(function (c) { return c.args.length >= 7 && /Epoch/i.test(c.args[6]); });
assert('retryRound 槽无 Epoch 错位', epochInRoundSlot.length === 0,
    JSON.stringify(epochInRoundSlot.map(function (c) { return c.file + ':' + c.args.join(','); })));

// 断言2：参数个数只允许已知安全形状 5/7/9（6/8 参即错位前兆）
var badShapes = calls.filter(function (c) { return [5, 7, 9].indexOf(c.args.length) === -1; });
assert('参数个数均为合法形状 5/7/9', badShapes.length === 0,
    JSON.stringify(badShapes.map(function (c) { return c.file + ':' + c.args.length + '参'; })));

// 断言3：7 参调用的第 7 参（retryRound 槽）必须是字面量 0（新步骤归零）或轮次转移值
var sevenArg = calls.filter(function (c) { return c.args.length === 7; });
var badSeven = sevenArg.filter(function (c) { return !/^(0|_nextRound2?)$/.test(c.args[6]); });
assert('7 参调用 retryRound 槽取值合法', badSeven.length === 0,
    JSON.stringify(badSeven.map(function (c) { return c.file + ':' + c.args.join(','); })));

// 断言4：钉住修复形态——工具续轮 9 参全量传参（轮次归零+保留 epoch）在 loop-core 恰好 5 处
var fixedSrc = fs.readFileSync(FILES[0], 'utf8');
var fixedCount = (fixedSrc.match(/self\._agentLoop\(box, chat, model, messages, depth \+ 1, null, 0, null, _myEpoch\);/g) || []).length;
assert('工具续轮 9 参修复形态恰好 5 处', fixedCount === 5, '实际 ' + fixedCount);

// 断言5：loop-core 所有 9 参调用第 9 参必须是 _myEpoch（代次保留，僵尸循环守卫不失效）
var nineArgCore = calls.filter(function (c) { return c.file === 'agent-02-loop-core.js' && c.args.length === 9; });
var badEpoch = nineArgCore.filter(function (c) { return c.args[8] !== '_myEpoch'; });
assert('loop-core 9 参调用均保留 _myEpoch', nineArgCore.length > 0 && badEpoch.length === 0,
    JSON.stringify(badEpoch.map(function (c) { return c.args.join(','); })));

// ===== 退避分类对齐守卫（retryRound 修复同批引入）=====
// 背景：上游网关会把真实 429 裸文本包进外壳状态（status=0/200/500 + body「429 请求过多」），
// 旧逻辑只看 res.status → 漏判成 3 秒固定间隔重试，反向轰击拥堵上游且⛔限流面板不计入。
// 修复：res.status 已是 429/50x 时直接采信；否则按 _friendlyErrMsg 同款规则从原始文本提码。
var coreSrc = fs.readFileSync(FILES[0], 'utf8');

// 断言6：分类不再直接依赖 res.status 判 429/50x（旧写法必须消失）
assert('限流判定不再直读 res.status', coreSrc.indexOf('var _isRateLimit = (res.status === 429);') === -1
    && coreSrc.indexOf('var _isGatewayFlap = (res.status === 502 || res.status === 503 || res.status === 504);') === -1);

// 断言7：_effCode 分类块存在，且带「res.status 已是特殊码则直接采信」守卫
//（防误伤 ai_proxy 聚合 502：tried 列表文本混有零散 401/429 字样时不得被带偏）
var effBlock = coreSrc.match(/var _effCode = res\.status;[\s\S]{0,600}?var _isRateLimit = \(_effCode === 429\);/);
assert('_effCode 分类块存在', !!effBlock);
assert('特殊外壳状态直采信守卫存在', /res\.status !== 429 && res\.status !== 502 && res\.status !== 503 && res\.status !== 504/.test(effBlock ? effBlock[0] : ''));

// 断言8：文本提码规则与 _friendlyErrMsg 同源（同两条正则：<h1> 提码 + 白名单提码）
assert('提码正则与 _friendlyErrMsg 同源', /_rawCls\.match\(\/<h1>\\s\*\(\\d\{3\}\)\/i\) \|\| _rawCls\.match\(\/\\b\(429\|402\|401\|403\|500\|502\|503\|504\)\\b\//.test(coreSrc));

// 断言9：轮数上限复用对齐后的布尔值（文本裸 429 享受 429 专用轮数）
assert('_maxRounds 复用对齐布尔值', /var _maxRounds = \(_isRateLimit \|\| _isGatewayFlap\) \? MAX_RETRY_ROUNDS_429 : MAX_RETRY_ROUNDS;/.test(coreSrc));

// 断言10：⛔限流面板上报仍挂在 _isRateLimit 上（对齐后自动覆盖文本裸 429）
assert('RateLimit.record 挂在 _isRateLimit 上', /_isRateLimit && window\.RateLimit\) \{ try \{ window\.RateLimit\.record\(model\.id, model\.name, 429, chat\.id\);/.test(coreSrc));

console.log('\n结果: ' + ok + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
