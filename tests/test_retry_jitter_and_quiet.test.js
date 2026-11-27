// 【永久回归】重试抖动消峰 + 提示降噪 + 本地假429识别（20261123）。
// 背景：429/网络重试退避为固定表（5s/15s/40s/90s/180s），多聊天框/蜂群同时失败时同刻醒来
// 集体轰上游（thundering herd）→ 再次集体 429 → 同步抖动循环；且每次尝试新增一行 ⚠ 落库提示，
// 一条重试链最多刷 25 行（5次×4轮，多框叠加成片刷屏）。ai_proxy 本机信号量满时也返回 429
// （「并发请求已达上限」），与上游拥堵同貌，误触发 429 长退避并计入⛔面板。
// 修复：①等比例随机抖动 0.7~1.3×（loop-core 全部重试分支 + dispatch_swarm 三处 sleep）
//       ②重试状态原地更新一行（skipSave 不落库），链成功补一行临时总结，最终失败清状态行落结论
//       ③「并发请求已达上限/local_concurrency」识别为本地排队：短抖动等待、不进⛔面板、不按429长退避
// 用法：node tests/test_retry_jitter_and_quiet.test.js   （退出码 0 = PASS）
// 静态扫描源码即可，无需 DOM/网络环境。
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var CORE = path.join(ROOT, 'public', 'js', 'agent-02-loop-core.js');
var SWARM = path.join(ROOT, 'server', 'dispatch_swarm.py');
var PROXY = path.join(ROOT, 'ai_proxy.py');
var INDEX = path.join(ROOT, 'public', 'index.html');

var ok = 0, fail = 0;
function assert(name, cond, detail) {
    if (cond) { ok++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (detail ? ' | ' + detail : '')); }
}

var core = fs.readFileSync(CORE, 'utf8');
var swarm = fs.readFileSync(SWARM, 'utf8');
var proxy = fs.readFileSync(PROXY, 'utf8');
var index = fs.readFileSync(INDEX, 'utf8');

// ===== 一、抖动消峰 =====

// 断言1：_jitterMs 等比例抖动辅助函数存在（0.7~1.3×，拒绝 full jitter——首退避可能≈0s 是反效果）
assert('抖动辅助函数定义存在', /function _jitterMs\(ms\) \{ return Math\.round\(ms \* \(0\.7 \+ Math\.random\(\) \* 0\.6\)\); \}/.test(core));
assert('抖动系数范围正确（0.7~1.3）', /\(0\.7 \+ Math\.random\(\) \* 0\.6\)/.test(core));

// 断言2：主重试分支退避必须过抖动（_baseBackoff → _jitterMs），固定 _backoffDelay 表直取写法必须消失
assert('主分支退避过抖动', /var _backoffDelay = _jitterMs\(_baseBackoff\);/.test(core));
assert('固定退避直取写法已消失', !/var _backoffDelay = \(_isRateLimit \|\| _isGatewayFlap\)\s*\n\s*\? \(RETRY_BACKOFF_429/.test(core));

// 断言3：AbortError 分支与 catch 网络分支退避均过抖动（含超时专项 10s/20s/.../60s）
assert('AbortError 分支退避过抖动', /\}, _jitterMs\(RETRY_INTERVAL\)\);/.test(core));
assert('catch 分支普通等待过抖动', /var _waitMs = _jitterMs\(RETRY_INTERVAL\);/.test(core));
assert('超时专项退避过抖动', /_waitMs = _jitterMs\(Math\.min\(60000, 10000 \* retryCount\)\);/.test(core));

// 断言4：dispatch_swarm 三处重试 sleep 均带 0.7~1.3 抖动，且已 import random
assert('swarm import random', /^import random$/m.test(swarm));
assert('swarm 指数退避抖动×2', (swarm.match(/\(2 \* \(2 \*\* attempt\)\) \* \(0\.7 \+ random\.random\(\) \* 0\.6\)/g) || []).length === 2);
assert('swarm 3s 基线抖动', /time\.sleep\(3 \* \(0\.7 \+ random\.random\(\) \* 0\.6\)\)/.test(swarm));

// ===== 二、提示降噪（原地更新一行）=====

// 断言5：旧的每次尝试落库新增一行写法必须消失（_retryMsg/_retryMsg2/轮间等待 三处）
assert('旧 _retryMsg 落库新增行已消失', core.indexOf("self.addMsg(box, _retryMsg, 'warning');") === -1);
assert('旧 _retryMsg2 落库新增行已消失', core.indexOf("self.addMsg(box, _retryMsg2, 'warning');") === -1);
assert('旧轮间等待落库新增行已消失', !/self\.addMsg\(box, _roundMsg, 'warning'\)/.test(core));

// 断言6：原地更新辅助函数存在且 skipSave（不落库），主/网络两分支都走 upsert
assert('upsert 辅助函数存在', /function _upsertRetryStatus\(box, chat, text\)/.test(core));
assert('upsert 走 skipSave 不落库', /el = self\.addMsg\(box, text, 'warning', null, false, true\);/.test(core));
assert('主分支状态行原地更新', /_upsertRetryStatus\(box, chat, _retryMsg\);/.test(core));
assert('网络分支状态行原地更新', /_upsertRetryStatus\(box, chat, _retryMsg2\);/.test(core));
assert('主分支轮间等待原地更新', /_upsertRetryStatus\(box, chat, _roundMsg\);/.test(core));

// 断言7：链成功收尾——清状态行 + 补一行临时总结（skipSave），且成功清理在 choice 提取之前
var successCleanup = core.match(/if \(\(chat\._retryStatusTotal \|\| 0\) > 0\) \{[\s\S]{0,200}?_clearRetryStatus\(chat\);[\s\S]{0,80}?var choice = res\.data\.choices/);
assert('成功路径清状态行+临时总结', !!successCleanup);
assert('成功总结行不落库', /本次已自动重试[\s\S]{0,80}'notice', null, false, true/.test(core));

// 断言8：最终失败路径（响应错误链底 / AbortError 用尽 / catch 轮次用尽 / stopped 收尾）都先清状态行
assert('最终失败清状态行≥4处', (core.match(/_clearRetryStatus\(chat\);/g) || []).length >= 4,
    '实际 ' + (core.match(/_clearRetryStatus\(chat\);/g) || []).length + ' 处');
assert('清状态行辅助函数定义存在', /function _clearRetryStatus\(chat\)/.test(core));

// ===== 三、本地假429识别 =====

// 断言9：本地排队识别存在（报错文本 + local_concurrency 双通道，含 res.data.error.message 路径）
assert('本地排队识别存在', /var _isLocalQueue = \/并发请求已达上限\|local_concurrency\/\.test\(_rawCls\)/.test(core));
assert('data.error.message 路径兜底', /并发请求已达上限\/\.test\(String\(\(res\.data && res\.data\.error && res\.data\.error\.message\)/.test(core));

// 断言10：本地排队覆写必须在 ⛔面板上报（RateLimit.record）之前，且 record 行保持原样（真 429 仍进面板）
var idxOverride = core.indexOf('if (_isLocalQueue) { _isRateLimit = false; _isGatewayFlap = false; }');
var idxRecord = core.indexOf('window.RateLimit.record(model.id, model.name, 429, chat.id);');
assert('本地排队覆写先于面板上报', idxOverride !== -1 && idxRecord !== -1 && idxOverride < idxRecord);
assert('真429面板上报行保持原样', /_isRateLimit && window\.RateLimit\) \{ try \{ window\.RateLimit\.record\(model\.id, model\.name, 429, chat\.id\);/.test(core));

// 断言11：本地排队文案与非线路故障措辞存在；本地排队时退避基线走 RETRY_INTERVAL（短等待）
assert('本地排队文案存在', /本机并发排队中（蜂群\/多聊天框并发较高，非线路故障）/.test(core));
assert('本地排队基线短等待', /var _baseBackoff = \(_isRateLimit \|\| _isGatewayFlap\)/.test(core));

// 断言12：ai_proxy 本地信号量 429 改为 local_concurrency 身份（前端据此识别），旧 rate_limit_error 消失
assert('ai_proxy 本地429身份标签', /'type': 'local_concurrency'/.test(proxy));
assert('ai_proxy 旧 rate_limit_error 已消失', proxy.indexOf('rate_limit_error') === -1);
assert('ai_proxy 报错文本未被改动（前端识别依赖）', /当前用户并发请求已达上限/.test(proxy));

// ===== 四、版本配对 bump =====

// 断言13：index.html 中 agent-02-loop-core.js 缓存版本已 bump（v529 → v530）
assert('loop-core 缓存版本已 bump v529→v530', /agent-02-loop-core\.js\?v=530/.test(index)
    && index.indexOf('agent-02-loop-core.js?v=529') === -1);

// 断言14：swarm_pipeline.py 四处重试 sleep 也带抖动（20261123 复审补齐）
var pipe = fs.readFileSync(path.join(ROOT, 'server', 'swarm_pipeline.py'), 'utf8');
assert('swarm_pipeline import random', /^import random$/m.test(pipe));
assert('swarm_pipeline 抖动×4', (pipe.match(/\(0\.7 \+ random\.random\(\) \* 0\.6\)/g) || []).length === 4,
    '实际 ' + (pipe.match(/\(0\.7 \+ random\.random\(\) \* 0\.6\)/g) || []).length + ' 处');

// ===== 五、行为级验证（DOM 桩驱动真实源码函数）=====
// 从 loop-core 提取真实的 _jitterMs/_upsertRetryStatus/_clearRetryStatus 函数体（花括号配平），
// 在桩环境里跑一遍生命周期：首建 skipSave → 原地更新不新增 → 被裁剪自愈重建 → 清理归零。
function extractFn(src, name) {
    var start = src.indexOf('function ' + name + '(');
    if (start === -1) return null;
    var depth = 0, i = src.indexOf('{', start);
    for (var j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
    }
    return null;
}
try {
    var fnJitter = extractFn(core, '_jitterMs');
    var fnUpsert = extractFn(core, '_upsertRetryStatus');
    var fnClear = extractFn(core, '_clearRetryStatus');
    assert('行为验证：三个函数可从源码提取', !!(fnJitter && fnUpsert && fnClear));

    // DOM 桩：元素记录 isConnected/textContent/remove
    function makeEl(body) {
        return {
            _inDom: true,
            body: body,
            get isConnected() { return this._inDom; },
            set textContent(v) { this._text = String(v); },
            get textContent() { return this._text || ''; },
            remove: function () { this._inDom = false; }
        };
    }
    var addMsgCalls = [];
    var fakeBody = { el: makeEl(fakeBody) };
    var self = { addMsg: function (box, text, who, modelId, isFinal, skipSave) {
        addMsgCalls.push({ text: text, who: who, skipSave: skipSave });
        return makeEl(fakeBody);
    } };
    var chat = {};
    var box = {};

    var _jitterMs = eval('(' + fnJitter + ')');
    var _upsertRetryStatus = eval('(' + fnUpsert + ')');
    var _clearRetryStatus = eval('(' + fnClear + ')');

    // 生命周期①：首建（skipSave=true）
    _upsertRetryStatus(box, chat, '第1次重试');
    assert('行为①首建且 skipSave 不落库', addMsgCalls.length === 1 && addMsgCalls[0].skipSave === true && addMsgCalls[0].who === 'warning');
    // 生命周期②：原地更新（不新增元素）
    var el1 = chat._retryStatusEl;
    _upsertRetryStatus(box, chat, '第2次重试，90秒后…');
    assert('行为②原地更新不新增行', addMsgCalls.length === 1 && chat._retryStatusEl === el1 && el1.textContent === '第2次重试，90秒后…');
    // 生命周期③：被 DOM 裁剪后自愈重建
    el1._inDom = false;
    _upsertRetryStatus(box, chat, '重建');
    assert('行为③脱离DOM后自愈重建', addMsgCalls.length === 2 && chat._retryStatusEl !== el1 && chat._retryStatusEl.isConnected);
    // 生命周期④：清理归零
    chat._retryStatusTotal = 7;
    _clearRetryStatus(chat);
    assert('行为④清理移除且计数归零', !chat._retryStatusEl && chat._retryStatusTotal === 0 && !el1.isConnected);
    // 抖动范围：1000ms 基线采样 5000 次全部落在 [700,1300] 且为整数
    var inRange = true;
    for (var _s = 0; _s < 5000; _s++) {
        var v = _jitterMs(1000);
        if (v < 700 || v > 1300 || v !== Math.floor(v)) { inRange = false; break; }
    }
    assert('行为⑤抖动值域 [0.7,1.3]×基线', inRange);
} catch (eB) {
    assert('行为级验证执行无异常', false, String(eB && eB.message || eB));
}

console.log('\n结果: ' + ok + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
