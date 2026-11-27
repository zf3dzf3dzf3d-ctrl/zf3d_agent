// 【掩码兜底·全局】model.key 可能是脱敏掩码(••••xxxx, U+2022 非 latin-1)，
// 直接进 Authorization 头会让浏览器 fetch 编码异常→请求发不出去；
// 统一转 ASCII ****尾4位，由服务端 _unmask_auth_headers 换回真实密钥。
function _zfMaskAuth(k){k=String(k||'');return k.indexOf('\u2022\u2022\u2022\u2022')!==-1?('****'+k.slice(-4)):k;}
// 【A5-3 20261123】掩码 key 优先发 keyid（线路名）：服务端按 api_keys.json / models.json
// 的名称映射换回真实密钥，同源脚本枚举掩码尾4位反查真 key 的通道就此关闭。
// ****尾4位 反查保留作旧服务端/兜底路径（_zfMaskAuth 不再直用于对外请求头）。
function _zfAuthHeader(model){
    var k = String((model && (model.key || model.apiKey)) || '');
    if (k.indexOf('\u2022\u2022\u2022\u2022') !== -1 && model && model.name) {
        return 'Bearer keyid:' + encodeURIComponent(String(model.name));
    }
    return 'Bearer ' + _zfMaskAuth(k);
}
// ==== 拆分自 app-agent.js：Agent 循环核心 ====
Object.assign(App, {
        // ===== 循环任务早期预警 =====
        // 思路：把每轮工具调用做成签名（工具名+参数摘要），滚动保留最近 N 个。
        // - 重复率 ≥ 60% 且至少重复 4 次 → 第一阶段：对话内警告（黄色），不打断，给模型自我纠正机会；
        // - 警告后仍继续重复 → 第二阶段：打 chat._loopEscalated 标记，小狗守卫巡逻到它时提前介入（停止+注入），不用等 10 分钟超时。
        _loopWarnThreshold: 48,  // 最少重复次数才警告（已再翻倍，减少误报）
        _loopWarnRatio: 0.75,    // 重复率阈值
        _loopSignatures: {},     // {chatId: [sig, ...]} 最近签名，滚动窗口

        // ===== 读/搜目标记录（防"低效徘徊"配套）：记录每步读/搜类工具的目标（文件路径/关键词），供步数预算注入时做目标级重复检测 =====
        _recordReadTarget: function(chat, toolName, toolArgs) {
            try {
                var readTools = ['read_file', 'read_lines', 'search_in_files', 'find_files', 'tree_dir', 'file_info'];
                if (readTools.indexOf(toolName) === -1) return;
                var a = toolArgs || {};
                // 提取目标标识：路径优先，其次关键词，都没有就跳过
                var target = a.path || a.paths && (typeof a.paths === 'string' ? a.paths : (a.paths[0] || '')) || a.keyword || a.pattern || '';
                if (!target || typeof target !== 'string') return;
                target = toolName + ':' + target.substring(0, 150);
                var hist = (chat._recentReadTargets = chat._recentReadTargets || []);
                hist.push(target);
                if (hist.length > 40) hist.shift();
            } catch (e) {}
        },

        _detectAgentLoop: function(box, chat, toolCalls, depth) {
            var sigs = (this._loopSignatures[chat.id] = this._loopSignatures[chat.id] || []);
            var parts = [];
            for (var i = 0; i < toolCalls.length; i++) {
                var tc = toolCalls[i];
                var args = '';
                try { args = JSON.stringify(tc.function.arguments || ''); } catch(e) { args = '?'; }
                if (args.length > 120) args = args.substring(0, 120); // 参数截断，容忍微小变化
                parts.push(tc.function.name + ':' + args);
            }
            var sig = parts.join('|');
            // 终止类调用不算循环
            if (typeof Tools !== 'undefined' && Tools.isTerminal) {
                for (var j = 0; j < toolCalls.length; j++) {
                    if (Tools.isTerminal(toolCalls[j].function.name)) { sigs.length = 0; return; }
                }
            }
            sigs.push(sig);
            if (sigs.length > 48) sigs.shift(); // 滚动窗口 48（已再翻倍）
            if (sigs.length < this._loopWarnThreshold) return;

            // 统计最近 24 个签名中最高重复次数（已再翻倍：12→24）
            var win = sigs.slice(-24);
            var counts = {};
            var maxName = '', maxCnt = 0;
            for (var w = 0; w < win.length; w++) {
                counts[win[w]] = (counts[win[w]] || 0) + 1;
                if (counts[win[w]] > maxCnt) { maxCnt = counts[win[w]]; maxName = win[w]; }
            }
            var ratio = maxCnt / win.length;
            var looping = maxCnt >= this._loopWarnThreshold && ratio >= this._loopWarnRatio;
            if (!looping) return;

            var firstTool = maxName.split(':')[0] || '?';
            if (!chat._loopWarned) {
                // ===== 第一阶段：温和警告，不打断 =====
                chat._loopWarned = true;
                chat._loopWarnDepth = depth;
                try { this.addMsg(box, '⚠️ 循环预警：检测到近几步在重复调用「' + firstTool + '」且结果无进展（疑似原地打转）。请立即停下来检查：是不是在反复用同样的参数调用同一个工具？如果是，请换一种方法，或用 task_complete 结束并说明卡点。', 'warning'); } catch(e) {}
                try { Store.addLog('warn', chat.id, 'loop-detect', '循环预警 depth=' + depth + ' 重复工具=' + firstTool + ' 重复率=' + Math.round(ratio*100) + '%'); } catch(e) {}
            } else if (depth > (chat._loopWarnDepth || 0) + 40) { // 升级缓冲已再翻倍：+6→+12
                // ===== 第二阶段：警告后仍无改变 → 升级标记，交给小狗守卫 =====
                chat._loopEscalated = Date.now();
                this._loopSignatures[chat.id] = []; // 清空，避免升级后立刻又触发
                try { Store.addLog('warn', chat.id, 'loop-detect', '循环未纠正，升级交给小狗守卫处理 depth=' + depth); } catch(e) {}
            }
        },

        // 【2026-10-18 方案A】角色对话判定：策划师/审核员(师)/施工队/协作队/总结师等系统角色窗。
        // 判定方式与 app-chatbox-flip-nav.js 的 isChildChat 保持一致（显式标记 → localStorage → 标题）。
        // 用途：这类对话产出为方案 md/审核意见而非代码改动，git 双快照无可比内容，
        // 直接跳过自验收 start/finish 快照，提速收尾并避免并发对话撞 git index.lock。
        _isRoleChat: function (box) {
            try {
                if (!box) return false;
                var name = '';
                var rname = box.getAttribute && box.getAttribute('data-role-name');
                if (rname) name = rname;
                if (!name) {
                    var rid = box.getAttribute && box.getAttribute('data-role-id');
                    if (rid) {
                        var boxId = (box.dataset && box.dataset.boxId) || box.id;
                        var stored = JSON.parse(localStorage.getItem('zf_role_chat_' + boxId) || 'null');
                        if (stored && stored.name) name = stored.name;
                    }
                }
                if (!name) {
                    var t = box.querySelector && box.querySelector('.chat-title, .chatbox-title, [class*="title"]');
                    if (t && t.textContent) name = t.textContent.trim();
                }
                if (!name) return false;
                var WL = ['策划师', '审核员', '审核师', '施工队', '协作队', '协作师', '总结师', '质检员', '技术可行性', '收口'];
                for (var i = 0; i < WL.length; i++) { if (name.indexOf(WL[i]) !== -1) return true; }
                return false;
            } catch (e) { return false; }
        },

        // 【2026-11-12 子对话静默】宽口径子对话判定（单一真源 ZFChildRel.isSub，
        // 含策划师/审核员/施工队/优化师/安全师/自定义/反驳师/总结师等全部派生窗）。
        // 用途：子对话任务成功收尾时不弹右下角成功提示、不放提示音，只有主对话才弹/响。
        _isSubChat: function (box) {
            try {
                return !!(window.ZFChildRel && window.ZFChildRel.isSub && box && window.ZFChildRel.isSub(box));
            } catch (e) { return false; }
        },

        // ===== Agent 循环核心 =====
        _agentLoop: async function(box, chat, model, messages, depth, retryCount, retryRound, poolTurnId, loopEpoch) {
            // 健康守护与对话完全解耦：它只是给"人"的报时提醒（弹窗+日志），
            // 不暂停、不拦截 Agent 循环（2026-09-09 用户定规则）。
            // ===== 【2026 修复】循环入口守卫：用户已点"停止"则不再继续 =====
            // 修复问题：切换模型后对话无法停止。
            // 根因：用户切换模型 / 模型ID覆盖时，stopSending() 因 isSending=false 直接 return，
            // chat._stopped 永远不会置 true；而旧一轮 _agentLoop 的重试链仍在挂起
            // （setTimeout 重试 / 工具执行），入口没有任何停止检查，导致循环"永动"、无法终止。
            if (chat._stopped) {
                Store.addLog('info', chat.id, 'loop-stopped', '_agentLoop 入口检测到 _stopped，终止残留循环 | depth=' + depth);
                if (!chat._sendCompleteCalled) {
                    this._onSendComplete(box, chat);
                }
                return;
            }

            // ===== 【循环代次 2026-09-10】老代次循环让位检查（杀僵尸核心）=====
            // 新消息（sendToModel）/用户停止（stopSending）都会给 chat._epoch 换代。
            // 挂起的重试链/工具续轮醒来发现自己属于老代次 → 安静退出（不重试、不发新请求），
            // 从根上杜绝「旧循环复活后与新消息互相收割」的死亡风暴（cb222 事故 22:21-22:28）。
            var _myEpoch = (loopEpoch != null) ? loopEpoch : (chat._epoch || 0);
            if (loopEpoch != null && (chat._epoch || 0) !== loopEpoch) {
                Store.addLog('info', chat.id, 'loop-epoch-stale', '老代次循环退出（已停止或被新消息取代）| depth=' + depth);
                return;
            }
            // 【重试幂等】本逻辑步骤的池轮次 id：同一逻辑请求的重试全部复用同一 id
            // （服务端：同 id 仍在跑=幂等重投；同 id 撞上更新 Turn=让位）。
            // 全新步骤（新消息/工具续轮/上下文重建）不传参，在此铸造新 id。
            var _poolTurnId = poolTurnId || ('pt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));

            // ===== 【2026-10 修复】发送按钮状态校正守卫 =====
            // 症状：偶尔对话仍在进行，右下角按钮却显示"发送"而非"停止"。
            // 根因：循环中途（重试链醒来/异常分支等）某次 _onSendComplete 把 isSending
            // 误置回 false，但 _agentLoop 实际仍在继续跑，按钮状态与真实状态脱节。
            // 修复：循环能走到入口且未停止 → 本轮对话确实还在进行，校正回发送中状态。
            if (!chat.isSending && !chat._stopped) {
                chat.isSending = true;
                try { self.updateSendButton(box, chat); } catch (e) {}
                try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
                try { Store.addLog('info', chat.id, 'send-state-fix', '循环仍在进行但 isSending=false，已校正按钮为停止态 | depth=' + depth); } catch (e) {}
            }

            // ===== 【线路切换即时生效】每轮循环按 chat.modelId 重新解析模型 =====
            // 根因：重试/递归链层层传参沿用首轮的旧 model 对象，用户发送中切换线路后，
            // 挂起的重试链仍打旧线路（如火山方舟 429 重试跑满 10 分钟）。现在每轮入口
            // 检测 chat.modelId 与当前 model 不一致时自动换道，切换线路立即生效。
            try {
                // 【修复】识图接管期间不换道：接管后 model 已切到识图引擎且 messages 仍含图片，
                // 若此处按 chat.modelId 换回对话模型，下方图片接管逻辑会再切回识图引擎，
                // 造成每个 depth "GLM→识图→GLM" 来回翻转（vision-takeover / model-switch-adopted 刷屏）。
                var _stillHasImg = messages.some(function (msg) {
                    return msg && Array.isArray(msg.content) && msg.content.some(function (part) {
                        return part && (part.type === 'image_url' || part.type === 'input_image');
                    });
                });
                var _visionHold = model && model._vision接管Of && _stillHasImg;
                if (chat.modelId && model && chat.modelId !== model.id && !_visionHold) {
                    var _freshModel = Models.get(chat.modelId);
                    if (_freshModel && _freshModel.endpoint) {
                        if (depth > 0 || retryCount > 0 || retryRound > 0) {
                            Store.addLog('info', chat.id, 'model-switch-adopted', '重试链换道: ' + (model.name || model.modelId) + ' → ' + (_freshModel.name || _freshModel.modelId) + ' | depth=' + depth);
                        }
                        model = _freshModel;
                    }
                }
            } catch (eMS) {}

            // ===== 深度限制（用户要求：不限制，已禁用）====
            // loopConfig 仅供重试逻辑使用；不做深度上限拦截。
            // 【防失控机制】depth>=30 软提示 + 每15步预算注入 + 递归前检查 chat._stopped。
            // 注意：不要再引入 MAX_AGENT_DEPTH 变量（曾为死变量，2026-09-15 已清理）。
            var loopConfig = this._getContextLoopConfig();

            var self = this;

            // ===== 请求失败自动重试（含上游 400 消息参数错误）=====
            retryCount = retryCount || 0;
            retryRound = retryRound || 0;
            // 网络/限流错误只做少量退避重试，避免失败时重复消耗大量 token。
var MAX_RETRY = (loopConfig.retryMaxPerRound != null ? loopConfig.retryMaxPerRound : 5);
var MAX_RETRY_ROUNDS = (loopConfig.retryRounds != null ? loopConfig.retryRounds : 3); // 网络异常（含服务器重启闪断）默认 3 轮重试：单轮 5 次×3s + 轮间 300s，总容忍约 20 分钟，避免服务器闪断/上游抖动直接判死对话
var MAX_RETRY_ROUNDS_429 = (loopConfig.retryRounds429 != null ? loopConfig.retryRounds429 : 4); // 429 限流专用轮次数（普通错误仍 1 轮；429 可等多轮恢复，避免直接判死）
var RETRY_INTERVAL = (loopConfig.retryIntervalMs != null ? loopConfig.retryIntervalMs : 3000);
var RETRY_ROUND_INTERVAL = (loopConfig.retryRoundIntervalMs != null ? loopConfig.retryRoundIntervalMs : 300000);
// 0=网络错误；400=上游请求/消息格式错误；429=限流（需更长退避）；5xx=服务端错误（可配置）
var RETRY_STATUS = (typeof loopConfig.retryStatusCodes === 'string' ? loopConfig.retryStatusCodes.split(',') : (Array.isArray(loopConfig.retryStatusCodes) ? loopConfig.retryStatusCodes : [0, 400, 429, 500, 502, 503, 504])).map(function(x){ return parseInt(x,10); });
RETRY_STATUS = RETRY_STATUS.filter(function(n){ return !isNaN(n); });
if (!RETRY_STATUS.length) RETRY_STATUS = [0, 400, 429, 500, 502, 503, 504];
// 429 用单独的退避策略，给上游留出充足恢复时间，避免重试雪崩（毫秒，可配置）
var RETRY_BACKOFF_429 = (typeof loopConfig.retryBackoff429Ms === 'string' ? loopConfig.retryBackoff429Ms.split(',') : (Array.isArray(loopConfig.retryBackoff429Ms) ? loopConfig.retryBackoff429Ms : [5000, 15000, 40000, 90000, 180000])).map(function(x){ return parseInt(x,10); });
RETRY_BACKOFF_429 = RETRY_BACKOFF_429.filter(function(n){ return !isNaN(n) && n >= 0; });
if (!RETRY_BACKOFF_429.length) RETRY_BACKOFF_429 = [5000, 15000, 40000, 90000, 180000];
// 【抖动消峰 20261123】等比例随机抖动（0.7~1.3×）：固定退避表会让多聊天框/蜂群在同一时刻
// 集体醒来重试（thundering herd），请求峰值重新对齐 → 再次集体 429 → 再对齐，这就是"抖动"的来源。
// 等比例抖动既打散同步又保留节奏感；不用 full jitter（首退避可能≈0s，刚被拒就回头是反效果），保底 5s×0.7=3.5s。
function _jitterMs(ms) { return Math.round(ms * (0.7 + Math.random() * 0.6)); }
// 【提示降噪 20261123】重试状态原地更新：同一对话同一时刻只有一行临时重试提示（skipSave 不落库），
// 每次尝试改写同一行文本而非新增一行——旧实现一条重试链最多刷 25 行 ⚠（5次×4轮，多框同时卡住时成片刷屏）。
// 链成功/最终失败时 _clearRetryStatus 收尾，详情始终在日志与⛔限流面板。
function _upsertRetryStatus(box, chat, text) {
    var el = chat._retryStatusEl;
    if (!el || !el.isConnected) {
        el = self.addMsg(box, text, 'warning', null, false, true);
        chat._retryStatusEl = el;
    } else {
        try { el.textContent = text; } catch (e) {}
    }
    return el;
}
function _clearRetryStatus(chat) {
    try { if (chat._retryStatusEl && chat._retryStatusEl.isConnected) chat._retryStatusEl.remove(); } catch (e) {}
    chat._retryStatusEl = null;
    chat._retryStatusTotal = 0;
}

            // 【友好错误文案】把开发者向的原始报错（JSON 解析失败、HTTP 状态等）翻译成用户能看懂的人话
            function _friendlyErrMsg(msg) {
                var m = String(msg || '');
                // 【闸门文案直通 20261124】自家对话闸门的拒绝（主脑自动熔断/手动不通过）原文
                // 已写明原因与恢复入口（闸门面板可恢复），不能再按状态码套"检查 API Key"模板
                // 把用户引去查好端端的 Key（今晨事故：上游限流触发熔断，老对话被误导文案卡死）。
                if (/面板可恢复|自动熔断|【不通过】/.test(m)) {
                    return m.length > 200 ? m.substring(0, 200) + '…' : m;
                }
                // JSON 解析失败 + 响应体里带 HTTP 状态页（如 "<h1>429 Too Many Requests"）：提取真实状态码
                var _st = m.match(/<h1>\s*(\d{3})/i) || m.match(/\b(429|402|401|403|500|502|503|504)\b/);
                if (_st) {
                    var code = _st[1];
                    var map = {
                        '401': 'AI 服务认证失败（401），请检查 API Key 或登录状态',
                        '402': 'AI Token 余额已耗尽（402），请充值后重试',
                        '403': 'AI 服务拒绝访问（403），请检查账号权限或 API Key',
                        '429': 'AI 服务繁忙（429 请求过多），当前使用人数较多，稍等片刻会自动恢复',
                        '500': 'AI 服务器内部错误（500），请稍后重试',
                        '502': 'AI 服务网关异常（502），服务可能正在重启，稍后自动恢复',
                        '503': 'AI 服务暂时不可用（503），请稍后重试',
                        '504': 'AI 服务响应超时（504），请求量较大，稍后自动重试'
                    };
                    if (map[code]) return map[code];
                }
                if (/is not valid JSON|JSON\.parse|Unexpected token/i.test(m)) return '服务响应格式异常（可能正在重启或被限流）';
                if (/Failed to fetch|NetworkError|network error/i.test(m)) return '网络连接失败';
                if (/aborted|AbortError/i.test(m)) return '请求被中断';
                if (/timeout|timed?\s?out/i.test(m)) return '请求超时';
                return m.length > 120 ? m.substring(0, 120) + '…' : m; // 其他错误截断展示，避免刷屏
            }

            // 柔和进度提示：每 30 步出现一次（30/60/90...），不中断、不催促、不落库（临时提示）
            if (depth >= 30 && depth >= (chat._depthNoticeStep || 0) + 30) {
                chat._depthNoticeStep = depth;
                try { this.addMsg(box, '已执行 ' + depth + ' 步，继续执行中…', 'notice', null, false, true); } catch(e){}
                try { Store.addLog('info', chat.id, 'depth-notice', 'Agent depth=' + depth + ' (progress notice)'); } catch(e){}
            }

            // ===== 步数预算注入（防"低效徘徊"）：每 10 步向模型注入一条隐形提醒，让它知道自己在烧步数，尽快收敛 =====
            if (depth >= 15 && depth >= (chat._budgetInjectStep || 0) + 15 && depth % 5 === 0) {
                chat._budgetInjectStep = depth;
                // 目标级重复检测：统计最近 10 步中"读/搜"类工具重复操作同一目标的次数
                var _targetWarn = '';
                try {
                    var _readTools = ['read_file', 'read_lines', 'search_in_files', 'find_files', 'tree_dir', 'file_info'];
                    var _hist = (chat._recentReadTargets = chat._recentReadTargets || []);
                    // 由调用方在工具执行前记录目标，这里只消费提示（目标记录在 _recordReadTarget）
                    if (chat._recentReadTargets && chat._recentReadTargets.length >= 10) {
                        var _cnt = {};
                        for (var _ri = Math.max(0, chat._recentReadTargets.length - 20); _ri < chat._recentReadTargets.length; _ri++) {
                            var _tk = chat._recentReadTargets[_ri];
                            _cnt[_tk] = (_cnt[_tk] || 0) + 1;
                        }
                        var _mk = '', _mc = 0;
                        for (var _k in _cnt) { if (_cnt[_k] > _mc) { _mc = _cnt[_k]; _mk = _k; } }
                        if (_mc >= 15) _targetWarn = '\n另外：你最近对「' + _mk + '」这个目标已重复读取/搜索 ' + _mc + ' 次，说明前面的结果没记住或没查清，请换更高效的方式（一次性批量读取/用 run_code 脚本汇总），不要反复小步重查。';
                    }
                } catch(e) {}
                var _recentSummary = '';
                try {
                    var _logs = Store.getMessages ? Store.getMessages(chat.id) : [];
                    var _tcalls = [];
                    for (var _li = _logs.length - 1; _li >= 0 && _tcalls.length < 5; _li--) {
                        if (_logs[_li].type === 'tool_call') _tcalls.unshift(_logs[_li].content.substring(0, 120));
                    }
                    _recentSummary = _tcalls.join(' | ');
                } catch (e) {}
                messages.push({ role: 'user', content: '（系统提醒·不回复此条）当前已连续执行 ' + depth + ' 步工具调用。多数调查类任务只需 5~15 步即可完成。请自我检查：是否在重复做已经做过的调查？是否因为早期读取结果被压缩而反复重查？请立即：① 停止重复检索，用已有信息推进；② 需要的信息用一次批量读取或 run_code 脚本一次拿全；③ 无依赖的工具调用放到同一轮并行发出；④ 目标已达成或无法推进时，直接调用 task_complete 收尾。' + _targetWarn + '（最近5次工具调用结果摘要：' + _recentSummary + '）' });
                try { Store.addLog('info', chat.id, 'budget-inject', '步数预算提醒注入 | depth=' + depth + (_targetWarn ? ' | 目标级重复警告' : '')); } catch(e){}
            }

            // ===== 自由插话（InjectBus 中途插话不停止）：优先于鞭子消费，schema 经 inject-bus.js 单模块 =====
            if (typeof InjectBus !== 'undefined' && InjectBus.size(chat) > 0) {
                var _injItems = InjectBus.drain(chat);   // 同步落 history（_injected 标记），messages 为 live 数组一次注入贯穿全程
                for (var _ij = 0; _ij < _injItems.length; _ij++) {
                    messages.push({ role: 'user', content: '（用户插话·务必响应）' + _injItems[_ij].text });
                }
                try { Store.addLog('info', chat.id, 'inject-inject', '中途插话注入模型 | depth=' + depth + ' | 条数=' + _injItems.length); } catch(e){}
            }

            // ===== 鞭子插话（用户点击 typing 行「鞭子」按钮触发）：注入催促收尾消息，一次性消费 =====
            if (chat._whipRequested) {
                chat._whipRequested = false;
                messages.push({ role: 'user', content: '（用户插话·务必响应）用户催促：请尽快收尾！立即停止不必要的调查、探索和修改，用当前已有的信息直接完成任务，尽早调用 task_complete 结束。不要开启新的搜索或读取。' });
                try { Store.addLog('info', chat.id, 'whip-inject', '用户插话：尽快收尾 | depth=' + depth); } catch(e){}
                try {
                    var _whipBox = box;
                    if (_whipBox) { var _whipEl2 = _whipBox.querySelector('.whip-hint'); if (_whipEl2) _whipEl2.classList.remove('whip-on'); }
                } catch (e) {}
            }

            // 深度硬限制已移除（用户要求去掉），仅保留 depth>=30 的软警告

            // ===== 工具结果管理（每次循环都执行）=====
            if (typeof App !== 'undefined' && App._manageToolResults) { App._manageToolResults(messages, chat.id); } else { try { self._manageToolResults(messages, chat.id); } catch(e) {} }

            // ===== 防卡死(1.6)：上下文长度检查 + 截断超长工具结果（不再做压缩摘要，避免失忆→重复搜索→恶性循环） =====
            var cachePolicy = self._getModelCachePolicy(model, loopConfig);
            // 保存本轮策略，便于日志和供应商返回的缓存统计对照。
            chat._cachePolicy = cachePolicy;
            var _compressed = { compressed: false, beforeTokens: self._estimateTokens(messages), afterTokens: self._estimateTokens(messages), removedCount: 0 };
            var compressStep = loopConfig.steps.find(function(step) { return step.id === 'compress'; });
            if (loopConfig.enabled && (!compressStep || compressStep.enabled !== false)) {
                // 仅截断超长 tool 结果，不删除消息、不做摘要替换
                _compressed = self._truncateToolResultsOnly(messages, model, depth, loopConfig, cachePolicy);
            }
            if (_compressed.compressed) {
                try { Store.addLog('info', chat.id, 'context-compress',
                    '上下文压缩 | depth=' + depth +
                    ' | 压缩前~' + _compressed.beforeTokens + 'tokens' +
                    ' → 压缩后~' + _compressed.afterTokens + 'tokens' +
                    ' | 压缩了' + _compressed.removedCount + '条消息'); } catch(e){}
            }

            // ===== AI 轻量自验收·起点快照（仅 depth==0 新任务）=====
            // 用户提问 → git add -A + commit 打"起点"，任务终止时再打"终点"对比，
            // 两快照差距即轻验收依据。异步 fire-and-forget，不阻塞对话。
            // 【2026-10-18 方案A】策划师/审核师对话跳过快照：产出为方案 md/审核意见而非代码改动，
            // git diff 无可比内容，白跑快照还易与并发对话撞 index.lock → 直接跳过（保留 AI 自审报告）。
            try {
                if (depth === 0 && chat._cachedFolderPath && !self._isRoleChat(box)) {
                    var _scXhrS = new XMLHttpRequest();
                    _scXhrS.open('POST', '/api/self-check/start', true);
                    _scXhrS.setRequestHeader('Content-Type', 'application/json');
                    _scXhrS.send(JSON.stringify({ chatId: String(chat.id || ''), action: 'start', _project_path: chat._cachedFolderPath }));
                }
            } catch (e) { console.warn('[agent] self-check start failed:', e); }

            // 移除上一轮残留的 typing 指示器，避免闪烁
            var _oldTypings = box.querySelectorAll('.msg.typing');
            _oldTypings.forEach(function(t) { t.remove(); });
            // ===== 工具球跨轮存活：球状态挂在 chat 上（_ttNames），typing 行每轮被删重建后自动回放 =====
            // 【2026-10 修复】不再在新一轮(depth===0)时清空 _ttNames：
            // 旧逻辑每轮清空导致"新工具一出现、上一轮积累的球瞬间消失"。
            // 现在球跨轮积累，满 10 颗才进洞消失（UI 层 _ttCount>=10 + 进洞时同步清零）。
            box._typingStart = Date.now(); try { if (window.App) { App._ttRoundMap = App._ttRoundMap || {}; App._ttRoundMap[box.id] = 0; } } catch (e2) {}
            if (!chat._ttNames) chat._ttNames = [];
            // 思考时（depth>0）只显示右侧图标动画（台球等），不再显示"正在思考"文字，更简约
            var typing = this.addMsg(box, depth === 0 ? '正在调用 ' + model.name + ' …' : '', 'typing');
            try {
                (function(_list) {
                    // 立即回放上一轮的球（新行初始为 0，逐颗补回）。
                    // 回放可能触发进洞（历史恰好满 10 颗）→ 回放后同步清空持久名单，
                    // 否则下一轮又回放 10 颗又进洞，死循环导致 10 颗之后永远看不到球。
                    typing._replaying = true;
                    _list.forEach(function(n) {
                        if (typing && typing._ttPush) typing._ttPush(n);
                    });
                    typing._replaying = false;
                    var _sp0 = typing.querySelector('.typing-spinner');
                    if (_sp0 && _sp0.classList.contains('tt-burst')) _list.length = 0;
                    // 此后同轮内新调用继续实时追加到 chat._ttNames
                    var _origPush = typing._ttPush;
                    typing._ttPush = function(name) {
                        var _s2 = typing.querySelector('.typing-spinner');
                        // 进洞动画期间：球已被 UI 层忽略，名单也不记录（保持 10 颗现状）
                        if (_s2 && _s2.classList.contains('tt-burst')) return;
                        _list.push(name);
                        if (_list.length > 10) _list.splice(0, _list.length - 10);
                        _origPush(name);
                        // 本次推球触发进洞 → 持久名单同步清零（DOM 稍后被吸走清空，二者保持一致）
                        if (_s2 && _s2.classList.contains('tt-burst')) _list.length = 0;
                    };
                })(chat._ttNames);
            } catch (e) {}

            // ===== 免费生图模型拦截（imageGen 标记）→ 逻辑已拆分至 agent-02a-imagegen-direct.js =====
            if (model.imageGen) {
                var _handled = self._handleImageGenDirect(box, chat, model, messages);
                if (_handled) return;
            }

            // 请求头
            var headers = {
                'Content-Type': 'application/json',
                'Authorization': _zfAuthHeader(model)
            };
            if (model.headers) {
                for (var hk in model.headers) if (model.headers.hasOwnProperty(hk)) headers[hk] = model.headers[hk];
            }

            // ===== 消息格式清洗 → 逻辑已拆分至 agent-02b-message-sanitize.js =====
            self._sanitizeMessages(messages);

            // ===== 【识图图片一次性发送】历史消息中的图片替换为占位文本（2026-09-30）=====
            // 根因：粘贴的截图以 base64 形式永久存于 chat.history，每轮 Agent 循环/后续新消息
            // 都把整张 base64 全量重发给模型——浪费大量 token、拖慢请求。
            // 规则：AI 对图片回复过一次即视为已识读；每轮请求只保留「最后一条用户消息」的图片，
            // 其余历史消息中的 image_url/input_image 部分统一替换为占位文本。
            // 注：正常路径下数组型 content 经 _buildContext 注入时与 chat.history 共享同一数组
            // 引用（未克隆），替换数组元素会同步把 base64 从 history 中摘除（历史图片 UI 不再
            // 显示属预期行为）；验证轮全量上下文路径走克隆对象，不在同步摘除范围内
            // （base64 会留在 history，但后续每次正常请求仍会被本逻辑剥离，不会重发给模型）。
            try {
                var _lastUserIdx = -1;
                for (var _lui = messages.length - 1; _lui >= 0; _lui--) {
                    if (messages[_lui] && messages[_lui].role === 'user') { _lastUserIdx = _lui; break; }
                }
                for (var _imi = 0; _imi < messages.length; _imi++) {
                    if (_imi === _lastUserIdx) continue;
                    var _mc = messages[_imi] && messages[_imi].content;
                    if (Array.isArray(_mc)) {
                        var _imgStripped = false;
                        for (var _imj = 0; _imj < _mc.length; _imj++) {
                            var _mp = _mc[_imj];
                            if (_mp && (_mp.type === 'image_url' || _mp.type === 'input_image')) {
                                var _iu = (_mp.image_url && _mp.image_url.url) || '';
                                _mc[_imj] = { type: 'text', text: '【@历史图片已识读，不再重发】' + (String(_iu).indexOf('data:') === 0 ? '(内嵌截图)' : _iu) };
                                _imgStripped = true;
                            }
                        }
                        if (_imgStripped) {
                            try { Store.addLog('info', chat.id, 'image-strip', '历史消息中的图片已替换为占位文本，避免每轮重发 base64 | msg#' + _imi); } catch (e) {}
                        }
                    }
                }
            } catch (e) {}

            // 图片理解：对话模型未配置 visionInput 时，自动切换到用户默认识图大模型（models.json 中 vision 类型 isDefault）。
            // imageGen 仅表示生图，不等于识图。
            var _hasImageInput = messages.some(function (msg) {
                return msg && Array.isArray(msg.content) && msg.content.some(function (part) {
                    return part && (part.type === 'image_url' || part.type === 'input_image');
                });
            });
            // 【修复】先判断当前模型自身是否支持识图：支持则直接用当前模型（用户选谁走谁），不再被默认识图模型无条件接管
            var _visionOk = !!(model.visionInput || model.modelType === 'types_vision' || model.modelType === 'vision');
            // 【2026-11-08 同上游免劫持】当前线路与默认识图模型打同一个上游模型时，视为原生支持识图，
            // 不再劫持换道——用户选谁走谁（鉴权头本就是该线路的，避免默认识图中转 401）。
            if (_hasImageInput && !_visionOk) {
                try {
                    var _vDef = (typeof Models !== 'undefined' && Models && typeof Models.getDefaultFor === 'function') ? Models.getDefaultFor('vision') : null;
                    var _sameUpstream = function (a, b) {
                        if (!a || !b) return false;
                        var _ea = String(a.endpoint || a.baseUrl || ''), _eb = String(b.endpoint || b.baseUrl || '');
                        if (!_ea || !_eb) return false;
                        // zf_models_relay 按URL query model= 定位上游，比较完整URL；
                        // 非中转线路 URL 相等不代表同一上游模型，须同时比对 modelId（防同网关不同模型误判）
                        if (_ea === _eb && String(a.modelId || '') === String(b.modelId || '')) return true;
                        var _ra = _ea.match(/zf_models_relay[^?]*\?model=([^&]+)/i), _rb = _eb.match(/zf_models_relay[^?]*\?model=([^&]+)/i);
                        if (_ra && _rb) return decodeURIComponent(_ra[1]) === decodeURIComponent(_rb[1]);
                        // 非中转线路：同一 modelId + 同一域名视为同上游
                        var _hda = (_ea.match(/^https?:\/\/([^\/]+)/i) || [])[1] || '', _hdb = (_eb.match(/^https?:\/\/([^\/]+)/i) || [])[1] || '';
                        return _hda && _hda === _hdb && String(a.modelId || '') === String(b.modelId || '');
                    };
                    if (_vDef && _vDef.visionInput && _sameUpstream(model, _vDef)) {
                        _visionOk = true;
                        try { Store.addLog('info', chat.id, 'vision-same-upstream', '当前线路「' + (model.name || model.modelId) + '」与默认识图模型同上游，直接走当前线路识图'); } catch (e) {}
                    }
                } catch (eSU) {}
            }
            if (_hasImageInput && _visionOk) {
                try { Store.addLog('info', chat.id, 'vision-native', '图片输入：当前模型「' + (model.name || model.modelId || '') + '」原生支持识图，直接使用'); } catch (e) {}
            }
            if (_hasImageInput && !_visionOk) {
                var _visionModel = null;
                try {
                    if (typeof Models !== 'undefined' && Models && typeof Models.list === 'function') {
                        // 【识图选路规则】用户选谁走谁：
                        // 1) 用户设为默认的识图模型若本身可直用（非朱峰登录通道 / 已带 key），直接用它；
                        // 2) 否则优先挑一个「已配置 key、非朱峰通道」的识图模型（避免无谓弹朱峰登录）；
                        // 3) 只有朱峰识图排在第一/是唯一可用选择时，才走朱峰会员通道（此时才会触发朱峰登录）。
                        var _vf = (Models.list || []).filter(function (m) {
                            return m && m.visionInput && m.endpoint && m.enabled !== false;
                        });
                        var _isZfM = function (m) { return !!(m && (m.zfLine || m.zfManaged || m.zfPinned || m.keyRef === 'zf_token' || /127\.0\.0\.1:(8527|8559|8554|8787|8788)/.test(String(m.endpoint || '') + String(m.baseUrl || '')))); };
                        var _isMaskedKey = function (k) { k = String(k || '').trim(); return !k || k.indexOf('****') >= 0 || /^\*{4}/.test(k) || /\*{4}.{0,4}$/.test(k); };
                        var _hasKey = function (m) { return !!(m && (m.key || m.apiKey) && !_isMaskedKey(m.key || m.apiKey)); };
                        // 【2026-11-13 优先用户选择】识图选路第一优先：用户在本对话识图分类里明确选的模型（chat._mpCatModels.types_vision，兼容旧键 vision，见下方 :472 归一读取），
                        // 其次才是 Models.getDefaultFor('vision')（默认识图）。用户选谁走谁，绝不擅自改走朱峰识图。
                        var _def = null;
                        try {
                            var _pickedId = '';
                            try { // 【键名归一】识图 Tab 分类 id=types_vision（选择器按 _mpCatModels[types_vision] 记忆），
                                  // 兼容历史误用的 vision 键；不归一则用户选的识图线路永远取不到 → 恒回落默认朱峰识图
                                _pickedId = (chat && chat._mpCatModels && (chat._mpCatModels.types_vision || chat._mpCatModels.vision)) || ''; } catch (ePK) {}
                            var _picked = _pickedId ? (typeof Models.get === 'function' ? Models.get(_pickedId) : null) : null;
                            if (_picked && _picked.visionInput && _picked.endpoint && _picked.enabled !== false) _def = _picked;
                        } catch (ePick) {}
                        if (!_def) _def = (typeof Models.getDefaultFor === 'function') ? Models.getDefaultFor('vision') : null;
                        if (_def && _def.visionInput && _def.endpoint && (!_isZfM(_def) || _hasKey(_def) || _def.noKeyRequired)) {
                            _visionModel = _def; // 用户明确选择的默认识图模型，可直接用
                        } else if (_def) {
                            // 【2026-11-12 尊重用户选择】默认识图模型不可直用（如朱峰线路未登录/缺key）时，
                            // 不再硬走朱峰弹登录，先在识图候选里挑一个可直用的替代：
                            // ① 与默认同 endpoint 且可直用 → ② 已带 key/免key 的非朱峰线路 → ③ 任意已带 key/免key 线路。
                            // 全都不可直用时才回落朱峰默认（此时才会触发朱峰登录，属于用户仅有此一途）。
                            var _usable = function (m) { return _hasKey(m) || m.noKeyRequired; };
                            var _alt = _vf.find(function (m) { return m !== _def && m.endpoint === _def.endpoint && _usable(m); })
                                    || _vf.find(function (m) { return !_isZfM(m) && _usable(m); })
                                    || _vf.find(function (m) { return _usable(m); });
                            if (_alt) { _visionModel = _alt; try { Store.addLog('info', chat.id, 'vision-fallback', '默认识图模型「' + _def.name + '」不可直用（未登录/缺key），改用可直用的「' + _alt.name + '」，不弹朱峰登录'); } catch (e) {} }
                            else { _visionModel = _def; } // 唯一选择 → 走朱峰（弹登录合理）
                        }
                    } else if (typeof Models !== 'undefined' && Models && typeof Models.getDefaultFor === 'function') {
                        _visionModel = Models.getDefaultFor('vision');
                    }
                } catch (e) {}
                if (_visionModel && _visionModel.visionInput && _visionModel.endpoint) {
                    // 用默认识图引擎接管本次（含后续工具循环轮次）：endpoint/key/headers/modelId 全部切换
                    // 【公共函数】换模型 → 重建 Authorization → 合并模型自定义 headers（与音频接管共用，防改一处忘另一处）
                    var _takeoverModel = function (target, tag) {
                        var _orig = model.name || model.modelId || '当前模型';
                        var _extra = { key: target.key || target.apiKey || '', _takeoverOf: tag + ':' + _orig };
                        // 【修复守卫失配 2026-11-22】入口换道守卫检查的是 _vision接管Of（见上方 _visionHold），
                        // 此前只写 _takeoverOf 导致守卫永远不生效：重试链每轮入口都把识图克隆换回对话模型
                        // 再重新接管，GLM↔识图 来回翻转。识图接管时补上标记，让既有守卫真正生效。
                        if (tag === 'vision') _extra._vision接管Of = _orig;
                        model = Object.assign({}, target, _extra);
                        // 【修复识图401】headers 在上方已用原模型 key 构建完毕，此处必须重建，
                        // 否则继续携带原模型（如火山方舟）的 key 打识图端点 → 401 令牌已过期
                        headers['Authorization'] = _zfAuthHeader(model);
                        if (model.headers) { for (var _thk in model.headers) if (model.headers.hasOwnProperty(_thk)) headers[_thk] = model.headers[_thk]; }
                    };
                    _takeoverModel(_visionModel, 'vision');
                    try { Store.addLog('info', chat.id, 'vision-takeover', '图片输入：使用默认识图模型「' + _visionModel.name + '」'); } catch (e) {}
                } else {
                    var _visionError = '当前模型「' + (model.name || model.modelId || '未命名') + '」不支持识图，且未找到可用的默认识图大模型。请在「⚙️ 模型配置」→ 识图模型 中添加支持图片输入的模型并设为默认。';
                    try { this.addMsg(box, _visionError, 'error'); this._onSendComplete(box, chat); } catch (e) {}
                    try { Store.addLog('warn', chat.id, 'vision-input-rejected', _visionError); } catch (e) {}
                    return;
                }
            }

            // 音频理解：消息含 input_audio 且当前模型不支持音频输入时，自动切换到默认语音/音频大模型。
            var _hasAudioInput = messages.some(function (msg) {
                return msg && Array.isArray(msg.content) && msg.content.some(function (part) {
                    return part && part.type === 'input_audio';
                });
            });
            var _audioOk = !!(model.audioInput || /^(audio|omni|speech|asr)$/i.test(String(model.modelType || '')));
            if (_hasAudioInput && !_audioOk) {
                var _audioModel = null;
                try {
                    if (typeof Models !== 'undefined' && Models && typeof Models.getDefaultFor === 'function') {
                        _audioModel = Models.getDefaultFor('audio');
                    }
                } catch (e) {}
                if (_audioModel && _audioModel.endpoint && (_audioModel.audioInput || /^(audio|omni|speech|asr)$/i.test(String(_audioModel.modelType || '')))) {
                    _takeoverModel(_audioModel, 'audio');
                    try { Store.addLog('info', chat.id, 'audio-takeover', '当前模型不支持音频输入，已自动切换默认语音引擎「' + _audioModel.name + '」'); } catch (e) {}
                    try { this.addMsg(box, '🎧 当前模型不支持音频输入，已自动调用默认语音引擎「' + _audioModel.name + '」…', 'info'); } catch (e) {}
                } else {
                    var _audioError = '当前模型「' + (model.name || model.modelId || '未命名') + '」不支持音频输入，且未找到可用的默认语音大模型。请在「⚙️ 模型配置」→ 语音模型 中添加支持音频输入的模型并设为默认。';
                    try { this.addMsg(box, _audioError, 'error'); this._onSendComplete(box, chat); } catch (e) {}
                    try { Store.addLog('warn', chat.id, 'audio-input-rejected', _audioError); } catch (e) {}
                    return;
                }
            }

            // ===== 图片/视频生成：用户表达生图/生视频意图时，自动调用默认生成模型（models.json 中 vision/video 类型 isDefault）=====
            var _genIntent = ''; // '' | 'image' | 'video'
            var _lastUserText = '';
            (function () {
                for (var _gi = messages.length - 1; _gi >= 0; _gi--) {
                    if (messages[_gi] && messages[_gi].role === 'user') {
                        var _gc = messages[_gi].content;
                        _lastUserText = typeof _gc === 'string' ? _gc : (Array.isArray(_gc) ? _gc.map(function (p) { return (p && p.text) || ''; }).join(' ') : '');
                        break;
                    }
                }
                // v4.5.2 修复误触发：检测本条用户消息是否附带图片（图生图场景）
                var _hasImgAttached = false;
                var _uc = messages[_gi] && messages[_gi].content;
                if (Array.isArray(_uc)) {
                    for (var _uj = 0; _uj < _uc.length; _uj++) {
                        var _up = _uc[_uj];
                        if (_up && (_up.type === 'image_url' || _up.type === 'input_image')) { _hasImgAttached = true; break; }
                    }
                }
                // v4.5.2 修复误触发：「读取/查看/分析/识别图片」类看图意图不得触发视频/图片生成
                if (/(读取|查看|分析|识别|看看|看一下|理解|描述|讲讲|这是什么|帮我看看)[^，。？\n]{0,12}(图片|图|照片|截图|这张|这幅)/i.test(_lastUserText)) { _genIntent = ''; return; }
                // v4.5.2 收紧视频意图：必须是明确的「文生视频/图生视频/生成视频」表达；
                // 且附带图片但没说「图生视频」时，按图片处理，绝不劫持成视频
                if (_hasImgAttached && !/(图生视频|以图生视频)/i.test(_lastUserText)) {
                    // v5.2.6 修复识图误判：附图但没明确要求生成新图（画/绘制/生成/制作/来一张等）时，
                    // 不视为生图意图——默认按识图对话处理，绝不因"发图"本身触发图片生成
                    if (/(p图|修图|重绘|以图生图|图生图|去(掉|除)[^，。？\n]{0,3}(水印|背景|文字))|(画|绘制|生成|创建|制作|换|改|做|来)[^，。？\n]{0,6}(一)?[张幅个]?(新)?的?(图|图片|插画|海报|照片|头像|壁纸|logo|背景图)|(以|用|基于)(这|此|该)?(张|幅)?(图|图片|照片|截图)[^。？\n]{0,8}(生成|画|做|制作|重绘)|(改成|换成|变为)[^。？\n]{0,8}(风格|画风|动漫|油画|水彩|卡通|像素|赛博)/i.test(_lastUserText)) {
                        _genIntent = 'image';
                    }
                } else if (/(文生视频|图生视频|生成(一)?(个)?(段)?(的)?视频|生成(一)?(个)?(段)?短片|制作(一)?(个)?(段)?视频|generate\s+(a\s+)?video)/i.test(_lastUserText)) {
                    _genIntent = 'video';
                } else if (/画(一)?(个)?(段)?(视频|短片)/i.test(_lastUserText) && !/(流程图|架构图|思维导图|拓扑图|图表|示意图|函数图|曲线图|线框图)/i.test(_lastUserText)) {
                    _genIntent = 'video';
                }
                // 排除"流程图/架构图"等图表类词，避免误触发生图
                if (/(流程图|架构图|思维导图|拓扑图|图表|示意图|函数图|曲线图|线框图)/i.test(_lastUserText)) return;
                if (/(文生图|生图|画|绘制|生成|创建|制作|来)(一)?[张幅个]?(图|图片|图画|插画|海报|照片)/i.test(_lastUserText) || /generate\s+(a\s+)?(image|picture|photo)/i.test(_lastUserText)) { _genIntent = 'image'; return; }
            })();
            // v5.1.2 修复：一旦生成过视频，后续普通发送不得再自动触发视频生成；
            // 否定句（不要/不用/取消...）一律不触发；已生成过则必须明确再次要求才触发
            if (_genIntent === 'video') {
                if (/(不要|别|不用|取消|停止|关掉|关闭|先不)[^，。？\n]{0,8}(生成|做|视频|短片)/i.test(_lastUserText)) {
                    _genIntent = '';
                } else if (chat && chat._videoTakenOver
                    && !/(文生视频|图生视频|(再|重新|重|再来|继续)[^，。？\n]{0,4}(生成|制作|画|来|做)[^，。？\n]{0,4}(一)?(个)?(段)?(的)?(短视频|视频|短片)|(生成|制作|画|来|做)(一)?(个)?(段)?(的)?(短视频|视频|短片))/i.test(_lastUserText)) {
                    _genIntent = '';
                }
            }
            // 【移除视频提示词拦截】视频生成不再靠提示词正则抢跑，完全交由大模型走工具调用链路
            if (_genIntent === 'image' && !model.imageGen && (depth || 0) === 0) {
                var _genModel = null;
                try { _genModel = Models.getDefaultFor(_genIntent === 'video' ? 'video' : 'vision'); } catch (e) {}
                var _genValid = !!(_genModel && _genModel.endpoint && (_genIntent === 'video'
                    ? (_genModel.modelType === 'video' || /videos\/generations|generations\/tasks/i.test(_genModel.endpoint || '') || /cogvideox|seedance/i.test(_genModel.modelId || ''))
                    : (/images\/generations/i.test(_genModel.endpoint || '') || _genModel.modelType === 'image' || /seedream|dall-e|flux|sd3|stable-diffusion|irag|seededit/i.test(_genModel.modelId || ''))));
                if (_genValid) {
                    var self3 = this;
                    var _prompt = String(_lastUserText || '').trim() || (_genIntent === 'video' ? 'a short video' : 'a beautiful picture');
                    // 图生图/图生视频：本条用户消息附带图片时，取第一张图片 URL/ DataURL 作为参考图
                    var _refImage = '';
                    (function () {
                        for (var _ri = messages.length - 1; _ri >= 0; _ri--) {
                            var _rc = messages[_ri];
                            if (_rc && _rc.role === 'user' && Array.isArray(_rc.content)) {
                                for (var _rj = 0; _rj < _rc.content.length; _rj++) {
                                    var _rp = _rc.content[_rj];
                                    if (_rp && (_rp.type === 'image_url' || _rp.type === 'input_image')) {
                                        _refImage = (_rp.image_url && _rp.image_url.url) || _rp.url || _rp.image || '';
                                        if (_refImage) return;
                                    }
                                }
                            }
                        }
                    })();
                    var _szM = _prompt.match(/(\d{3,4})\s*[xX×]\s*(\d{3,4})/);
                    // v5.1.3 视频生成确认改为自定义 HTML 对话框（不使用原生 window.confirm）
                    var _showVideoConfirm = function (msg, onOk, onCancel) {
                        var ov = document.createElement('div');
                        ov.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
                        var d = document.createElement('div');
                        d.style.cssText = 'background:#fff;color:#222;border-radius:10px;padding:20px 24px;max-width:420px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,.3);font-family:inherit;';
                        var _esc = String(msg || '').slice(0, 80).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; });
                        d.innerHTML = '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">🎬 确认生成视频？</div>' +
                            '<div style="font-size:13px;line-height:1.6;color:#555;">视频生成消耗较多算力/费用，可能需要较长时间。</div>' +
                            '<div style="font-size:13px;line-height:1.6;color:#555;margin:8px 0 16px;word-break:break-all;">提示词：' + _esc + '</div>' +
                            '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
                            '<button data-act="cancel" style="padding:7px 18px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;color:#333;cursor:pointer;">取消</button>' +
                            '<button data-act="ok" style="padding:7px 18px;border:none;border-radius:6px;background:#3b82f6;color:#fff;cursor:pointer;">确定生成</button></div>';
                        ov.appendChild(d);
                        document.body.appendChild(ov);
                        var _close = function () { try { document.body.removeChild(ov); } catch (e) {} };
                        d.querySelector('[data-act="ok"]').onclick = function () { _close(); onOk && onOk(); };
                        d.querySelector('[data-act="cancel"]').onclick = function () { _close(); onCancel && onCancel(); };
                    };
                    var _doGen = function () {
                        var _apiPath = _genIntent === 'video' ? '/api/video-gen' : '/api/image-gen';
                        var _apiBody = _genIntent === 'video'
                            ? { action: 'generate', prompt: _prompt, size: _szM ? (_szM[1] + 'x' + _szM[2]) : '832x480', model: _genModel.modelId || '', duration: 5, key: _genModel.key || _genModel.apiKey || '', image_url: _refImage || '' }
                            : { action: _refImage ? 'edit' : 'generate', prompt: _prompt, size: _szM ? (_szM[1] + 'x' + _szM[2]) : '1024x1024', model: _genModel.modelId || '', image_url: _refImage || '' };
                        try { Store.addLog('info', chat.id, 'gen-takeover', '已自动调用默认' + (_genIntent === 'video' ? '视频' : '图片') + '生成引擎「' + _genModel.name + '」' + (_refImage ? '（' + (_genIntent === 'video' ? '图生视频' : '图生图') + '模式）' : '')); } catch (e) {}
                        try { self3.addMsg(box, (_genIntent === 'video' ? '🎬' : '🎨') + ' 已调用默认' + (_genIntent === 'video' ? '视频' : '图片') + '生成引擎「' + _genModel.name + '」' + (_refImage ? '（' + (_genIntent === 'video' ? '图生视频' : '图生图') + '）' : '') + '，正在生成…', 'typing'); } catch (e) {}
                        fetch(_apiPath, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(_apiBody)
                        }).then(function (r) { return r.json(); }).then(function (j) {
                        var d = j.data || {};
                        var out = '';
                        if (j.ok) {
                            if (_genIntent === 'video') {
                                var vurl = (d.videos && d.videos[0] && d.videos[0].url) || d.url || '';
                                out = vurl ? ('✅ 视频已生成\n\n🎬 [点击播放/下载视频](' + vurl + ')' + (d.provider ? '\n\n- **引擎**: ' + d.provider : '')) : '❌ 视频生成失败';
                                if (vurl && typeof window.KiteCanvas !== 'undefined' && window.KiteCanvas.addVideoNode) {
                                    try { window.KiteCanvas.addVideoNode({ url: vurl, prompt: _prompt, connectToChat: chat.id || null }); } catch (ve) {}
                                }
                                // v5.1.2 标记本会话已自动生成过视频，后续普通发送不再自动触发
                                if (vurl) { try { chat._videoTakenOver = true; } catch (ve2) {} }
                            } else {
                                var iurl = d.url || '';
                                out = iurl ? ('✅ 已生成\n\n![' + _prompt.slice(0, 30).replace(/[\[\]()]/g, '') + '](' + iurl + ')' + (d.model ? '\n\n- **模型**: ' + d.model : '') + (d.size ? '\n- **尺寸**: ' + d.size : '')) : '❌ 图片生成失败';
                                if (iurl && typeof App !== 'undefined' && App.createImageCanvasNode) {
                                    try { App.createImageCanvasNode(box, iurl, _prompt, { model: d.model || '', channel: d.channel_name || d.channel || '' }); } catch (ie) {}
                                }
                            }
                        } else {
                            out = '❌ 生成失败: ' + (d.error || '未知错误');
                        }
                        try { self3.addMsg(box, out, 'ai', chat.modelId, true); } catch (e2) {}
                        try { self3._onSendComplete(box, chat); } catch (e3) {}
                        }).catch(function (e) {
                            try { self3.addMsg(box, '❌ 生成请求异常: ' + e.message, 'ai', chat.modelId, true); } catch (e2) {}
                            try { self3._onSendComplete(box, chat); } catch (e3) {}
                        });
                    };
                    if (_genIntent === 'video') {
                        _showVideoConfirm(_prompt, _doGen, function () {
                            try { self3.addMsg(box, '⏹ 已取消视频生成（未消耗费用）', 'ai', chat.modelId, true); } catch (e0) {}
                            try { self3._onSendComplete(box, chat); } catch (e0) {}
                        });
                    } else {
                        _doGen();
                    }
                    return;
                } else {
                    // 未配置默认生成模型：提示但不中断，继续走正常对话流程（AI 仍可调 image_gen 工具）
                    var _genTip = '检测到' + (_genIntent === 'video' ? '视频' : '图片') + '生成需求，但未配置默认' + (_genIntent === 'video' ? '视频' : '图片') + '生成模型。可在「⚙️ 模型配置」→ ' + (_genIntent === 'video' ? '视频模型' : '图片模型') + ' 中添加并设为默认。';
                    try { Store.addLog('warn', chat.id, 'gen-takeover-missing', _genTip); } catch (e) {}
                    try { this.addMsg(box, 'ℹ️ ' + _genTip, 'info'); } catch (e) {}
                }
            }

            // ===== per-chat 覆盖生效（底部选择器设置）=====
            // _modelIdOverride: 本对话覆盖模型 ID（不改全局配置）
            // _reasoningEffort: 本对话覆盖思考强度（档位由 config/reasoning_levels.json 定义，如 disable/low/medium/high/ultra）
            if (chat._modelIdOverride) {
                model = Object.assign({}, model, { modelId: chat._modelIdOverride });
            }
            if (chat._reasoningEffort) {
                // 校验 chat._reasoningEffort 是否为当前模型的合法值，防止旧 session 保存的
                // 无效值（如 GLM 不支持的 "medium"）覆盖 models.json 的正确配置导致 400 错误
                // 仅当 ReasoningLevels 已加载（ready）且值在当前模型的合法列表中时才覆盖
                if (typeof ReasoningLevels !== 'undefined' && ReasoningLevels && ReasoningLevels.ready) {
                    var _validEfforts = ReasoningLevels.listFor(model.modelId, model).map(function(l) { return l.value; });
                    if (_validEfforts.indexOf(chat._reasoningEffort) >= 0) {
                        model = Object.assign({}, model, { reasoningEffort: chat._reasoningEffort });
                    }
                }
            }

            // 请求体（加入 tools 定义）
            // maxTokens=null 时不注入 max_tokens，但 GLM 等模型不传 max_tokens 会用很小的默认值(4096)
            // 启用思考模式的模型尤其需要更大预算，null 时默认给 32768
            var _effMaxTokens = chat._maxTokensOverride || model.maxTokens;
            if (!_effMaxTokens && model.reasoningEffort && model.reasoningEffort !== 'off' && model.reasoningEffort !== 'disable') {
                _effMaxTokens = 32768;
            }
            // ===== 发送前 tool_calls 配对净化（修复 qwen 等严格中转 400：messages input is invalid）=====
            // 根因（蜂群审核复核后定位）：悬空 assistant.tool_calls 产生在「当轮 live messages」——
            // 工具回包(role:tool)尚未全部落下时若异常/中断，数组里残留带 tool_calls 而无配对 tool 的
            // assistant。400 自愈重建分支(L948)只从 chat.history 经 _buildContext 重建，剔不掉当轮残尾，
            // 于是同一悬空结构经 L991 回灌 live messages 后反复被严格中转(zf_models_relay.asp)拒绝，烧满
            // rebuild400Max。payload.messages 是当轮循环与重建重试的唯一发送口(L660)，在此净化才覆盖两条路径。
            // 规则：① assistant.tool_calls 其后无覆盖全部 id 的 role:tool 回包 → 剥离该 tool_calls(保留正文)，
            //   并连带丢弃其未配对的 role:tool（防净化后产生孤儿 tool 反向 400）；② 已配对上下文为纯 no-op。
            // 净化真实发生时留痕，便于下次复现捕获真实失败结构（蜂群建议①「补抓真实400请求体」的常驻实现）。
            try {
                var _stripIds = {}; var _anyStrip = false;
                for (var _si = 0; _si < messages.length; _si++) {
                    var _sm = messages[_si];
                    if (_sm && _sm.role === 'assistant' && _sm.tool_calls && _sm.tool_calls.length) {
                        var _need = {}; var _nok = 0;
                        for (var _tj = 0; _tj < _sm.tool_calls.length; _tj++) {
                            var _tcj = _sm.tool_calls[_tj];
                            if (_tcj && _tcj.id) { _need[_tcj.id] = 1; _nok++; }
                        }
                        var _got = 0;
                        for (var _tk = _si + 1; _tk < messages.length; _tk++) {
                            var _tm = messages[_tk];
                            if (_tm && _tm.role === 'tool' && _need[_tm.tool_call_id]) _got++;
                            if (_tm && _tm.role === 'assistant') break; // 回包窗口止于下一轮 assistant
                        }
                        if (_got < _nok) {
                            for (var _nid in _need) { if (_need.hasOwnProperty(_nid)) { _stripIds[_nid] = 1; _anyStrip = true; } }
                        }
                    }
                }
                if (_anyStrip) {
                    var _clean = [];
                    for (var _sj = 0; _sj < messages.length; _sj++) {
                        var _mj = messages[_sj];
                        if (_mj && _mj.role === 'assistant' && _mj.tool_calls) {
                            var _hasStrip = false;
                            for (var _tj2 = 0; _tj2 < _mj.tool_calls.length; _tj2++) {
                                if (_mj.tool_calls[_tj2] && _stripIds[_mj.tool_calls[_tj2].id]) { _hasStrip = true; break; }
                            }
                            if (_hasStrip) {
                                var _cp = Object.assign({}, _mj); delete _cp.tool_calls;
                                if (!_cp.content) _cp.content = '';
                                _clean.push(_cp); continue;
                            }
                        }
                        if (_mj && _mj.role === 'tool' && _stripIds[_mj.tool_call_id]) continue; // 丢弃未配对 tool 回包
                        _clean.push(_mj);
                    }
                    try { Store.addLog('warn', chat.id, 'sanitize-stripped', '发送前净化悬空 tool_calls：剔除 ' + Object.keys(_stripIds).length + ' 个 id 的配对缺失结构，已剥离后重发'); } catch (e) {}
                    messages.length = 0;
                    for (var _sk = 0; _sk < _clean.length; _sk++) messages.push(_clean[_sk]);
                }
            } catch (_se) {
                try { Store.addLog('warn', chat.id, 'sanitize-fail', '发送前配对净化异常已跳过(不阻断请求): ' + ((_se && _se.message) || _se)); } catch (e) {}
            }

            var payload = {
                model: model.modelId,
                messages: messages,
                stream: false,
                tools: Tools.getDefinitions(null, chat.id),
                tool_choice: 'auto',
                _box_id: String(chat.id || ''),
                _pool_turn_id: _poolTurnId   // 【重试幂等】随载荷透传给池（db.js 会提升到 body._turn_id）
            };
            // 【v5.1.3】协议格式：Anthropic 线路把标记传给后端代理（后端转换请求/响应/SSE）
            if (model.apiFormat && model.apiFormat !== 'openai' && model.apiFormat !== 'auto') {
                payload.api_format = String(model.apiFormat);
            }
            // 对话级底层引擎（server/engines/ 可插拔，空 = 服务端默认 zf_core）
            if (chat._engine) {
                payload._engine = String(chat._engine);                // own_tools 风格引擎（codex/pi/deepseek/hermes/claude/openclaw）：
                // 只用引擎自有工具集（服务端 agent_loop 注入），清掉前端全局工具分类的工具
                var _engMeta = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines().filter(function(x){return x.id===chat._engine;})[0] : null;
                if (_engMeta && _engMeta.own_tools) {
                    delete payload.tools;
                    delete payload.tool_choice;
                }
            }
            if (_effMaxTokens) {
                payload.max_tokens = _effMaxTokens;
            }
            if (model.body) {
                for (var bk in model.body) {
                    if (!model.body.hasOwnProperty(bk)) continue;
                    // Local-only context setting. Sending it to OpenAI-compatible APIs can cause 400 errors.
                    if (bk === 'context_rounds') continue;
                    // maxTokens 已由上方 _effMaxTokens 处理，不重复注入
                    if (bk === 'maxTokens') continue;
                    payload[bk] = model.body[bk];
                }
            }
            // 注入思考强度（reasoning_effort），支持火山方舟等模型的深度思考切换
            // off/disable 均视为关闭思考，不注入该字段
            // 【千问400兜底】部分线路（如千问_TokenPlan）档位名是中文业务名（最低/中/最高…），
            //   原样发给 OpenAI 兼容端点会因非法枚举返回 400 且 rebuild 无法自愈。
            //   仅当值为纯 ASCII 合法 token（low/medium/high/none…）才注入；中文/含空格档位跳过，
            //   交给中转端按模型默认处理，避免误伤 GLM/openrouter 等英文线路。
            if (model.reasoningEffort && model.reasoningEffort !== 'off' && model.reasoningEffort !== 'disable'
                && /^[A-Za-z0-9_.\-]+$/.test(String(model.reasoningEffort))) {
                payload.reasoning_effort = model.reasoningEffort;
            }
            // ===== 注入项目路径：后端据此替换提示词模板中的 {PROJECT_ROOT} =====
            // 优先用 chat._cachedFolderPath（首次查到后缓存到对话对象上，后续直接复用）
            // 缓存未命中时：先查 Store.data.projects / App._projAllProjects，都没有则 fetch /projects 从服务端拿
            var _projIdForCtx = chat.projectId
                || (typeof App !== 'undefined' && App._activeProjectId)
                || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId)
                || '';  // 【修复】对话未绑项目时回退到当前选中的项目，保证 _project_path 始终有值
            if (_projIdForCtx) {
                var _projPath = chat.projectId === _projIdForCtx ? (chat._cachedFolderPath || '') : '';
                if (!_projPath) {
                    // 1) 查 Store.data.projects
                    if (typeof Store !== 'undefined' && Store.data && Store.data.projects) {
                        for (var _pi = 0; _pi < Store.data.projects.length; _pi++) {
                            if (Store.data.projects[_pi].id === _projIdForCtx && Store.data.projects[_pi].folder_path) {
                                _projPath = Store.data.projects[_pi].folder_path;
                                break;
                            }
                        }
                    }
                    // 2) 查 App._projAllProjects（含服务端 folder_path）
                    if (!_projPath && typeof App !== 'undefined' && App._projAllProjects) {
                        for (var _pj = 0; _pj < App._projAllProjects.length; _pj++) {
                            if (App._projAllProjects[_pj].id === _projIdForCtx && App._projAllProjects[_pj].folder_path) {
                                _projPath = App._projAllProjects[_pj].folder_path;
                                break;
                            }
                        }
                    }
                    // 3) 本地缓存都没有，直接从服务端拉取（linkFolder 更新了 DB 但本地缓存可能没同步）
                    if (!_projPath && typeof DB !== 'undefined' && DB.getProjects) {
                        try {
                            var _projRes = await DB.getProjects();
                            if (_projRes && _projRes.ok && _projRes.data) {
                                for (var _pk = 0; _pk < _projRes.data.length; _pk++) {
                                    if (_projRes.data[_pk].id === _projIdForCtx && _projRes.data[_pk].folder_path) {
                                        _projPath = _projRes.data[_pk].folder_path;
                                        break;
                                    }
                                }
                                // 同步更新本地缓存，后续不用再 fetch
                                if (typeof Store !== 'undefined' && Store.data) {
                                    Store.data.projects = _projRes.data;
                                }
                            }
                        } catch (e) {
                            console.warn('[Agent] 获取项目路径失败:', e);
                        }
                    }
                    if (_projPath) chat._cachedFolderPath = _projPath;
                }
                if (_projPath) payload._project_path = _projPath;
            }

            // ===== 【协作通气 v3.3 #2】协作窗请求体标记：_collab_team/_collab_codename =====
            // db.js 会把 _collab_* 提升到 body 顶层 → pool_worker.run_upstream 顶层
            // collab_hear_inject 按标记做耳旁听注入（say 提要 + L1 心跳）。
            // 非协作窗 chat 无标记 → 不带字段 → 服务端零注入（零侵入断言 v3.2 已验）。
            try {
                if (chat && chat._collabTeam && chat._collabCodename) {
                    payload._collab_team = String(chat._collabTeam);
                    payload._collab_codename = String(chat._collabCodename);
                }
            } catch (eCollab) {}

            // ===== 上下文展示（仅内存，不留痕迹）：原封不动保存最后一次发送给 AI 的完整请求体，新请求直接覆盖上一条 =====
            try {
                chat._lastContext = JSON.stringify(payload, null, 2);
                if (typeof App !== 'undefined' && App.refreshLogPanelCtx) App.refreshLogPanelCtx(box);
            } catch (e) {}

            var reqStart = Date.now();
            Store.addLog('info', chat.id, 'api-request', '→ ' + model.name + ' (depth=' + depth + ') | model=' + model.modelId);

            // ===== 发送前清洗 messages：移除 reasoning_content 等非标准字段 → 拆分至 agent-02b-message-sanitize.js =====
            self._cleanNonStandardFields(messages);

            var _proxyP;
            chat._realStreamDiv = null;
            chat._realStreamBuf = '';
            chat._streamRafPending = false;
            // 【增量绘制状态复位】与 buf 同生命周期（FPS 修复 2026-11-24）
            chat._zfPaintedLen = 0; chat._zfStreamRendered = 0;
            chat._zfTailNode = null; chat._zfTailEl = null;
            chat._zfRichAt = 0; chat._zfRichCut = 0;
            if (typeof DB.proxyStream === 'function' && payload.stream === true) {
                // ===== 真实流式：最终回复轮走 /api/proxy_stream，逐块增量渲染（失败自动回退聚合代理）=====
                // 注意：不新增 abort 计时器（沿用上方唯一 330 秒 Promise.race 超时），避免双计时器复发「自动停止」
                _proxyP = DB.proxyStream(model.endpoint, headers, payload,
                    chat.abortController ? chat.abortController.signal : null,
                    function(chunk) {
                        // 收到任何增量（含纯思考 reasoning）都证明链路活跃 → 重置无响应计时器
                        if (typeof _armProxyTimeout === 'function') _armProxyTimeout();
                        // 【思考实时翻译】reasoning 增量交给翻译模块（默认关，开启时译文气泡主显）
                        if (chunk && chunk.reasoning && App.zfReasonTranslate) {
                            try { App.zfReasonTranslate.onReasoning(box, chunk.reasoning); } catch (e) {}
                        }
                        if (!chunk || !chunk.content) return;
                        if (!chat._realStreamDiv || !chat._realStreamDiv.parentNode) {
                            var _elsS = box.querySelectorAll('.msg.typing');
                            _elsS.forEach(function(t) { t.remove(); });
                            chat._realStreamDiv = App.addMsg(box, '', 'ai', chat.modelId, false, true);
                            chat._realStreamBuf = '';
                            // 新占位 div：绘制状态归零（FPS 增量绘制 2026-11-24）
                            chat._zfPaintedLen = 0; chat._zfStreamRendered = 0;
                            chat._zfTailNode = null; chat._zfTailEl = null;
                            chat._zfRichAt = 0; chat._zfRichCut = 0;
                        }
                        chat._realStreamBuf += chunk.content;
                        // 【性能优化】SSE chunk 可能每秒几十上百个，每个都全量赋值 textContent +
                        // 读取 scrollHeight 强制同步重排（layout thrashing），对话一长就明显卡顿。
                        // 改为 RAF 合帧：一帧最多更新一次 DOM，滚动也只在真正更新时跟随。
                        if (chat._streamRafPending) return;
                        chat._streamRafPending = true;
                        requestAnimationFrame(function() {
                            var _pf0 = (window.Perf ? performance.now() : 0);
                            chat._streamRafPending = false;
                            var _div = chat._realStreamDiv;
                            if (!_div || !_div.parentNode) return;
                            var _cEl = _div.querySelector('.msg-content') || _div;
                            /* 【性能修复·FPS 2026-11-24】旧实现每帧 `_cEl.textContent = 全量buf`：
                               长回复(几十KB)×每帧全量替换文本节点+整段重排，还把上一帧刚建好的
                               ZFRich 富组件整棵抹掉（有新围栏时又全量重建，O(n²)），多会话并发
                               流式时主线程被数百 ms 级长任务连续占满（实测风筝面板 LT 3.7万次/
                               累计 3596s、FPS 3）。改为【增量绘制】：
                               ① 维护持久 tail 文本节点，每帧只 appendData 新增片段（O(delta)）；
                               ② ZFRich 前缀仅在有新闭合围栏且节流(1.5s/800字符)到达时重建。
                               异常时回退旧行为（全量 textContent），正确性优先。 */
                            var _buf = chat._realStreamBuf || '';
                            if ((chat._zfPaintedLen || 0) > _buf.length) {
                                // 缓冲被重置（新一轮/重试）：绘制状态全部作废，本帧走全量重建
                                chat._zfPaintedLen = 0; chat._zfStreamRendered = 0;
                                chat._zfTailNode = null; chat._zfTailEl = null;
                                chat._zfRichAt = 0; chat._zfRichCut = 0;
                            }
                            try {
                                var _m = _buf.match(/```zfrich[\s\S]*?```|:::zfrich[\s\S]*?(?=\n:::)/g);
                                var _cut = 0;
                                if (_m && _m.length) {
                                    var _last = _m[_m.length - 1];
                                    _cut = _buf.lastIndexOf(_last) + _last.length;
                                }
                                var _nowTs = Date.now();
                                var _richOk = window.App && App.renderMarkdown && _cut > (chat._zfStreamRendered || 0)
                                    && (_nowTs - (chat._zfRichAt || 0) >= 1500 || _cut - (chat._zfRichCut || 0) >= 800);
                                if (_richOk) {
                                    // 【ZFRich v3】有新闭合围栏且通过节流：前缀走完整 renderMarkdown
                                    // （富组件先长出来），尾部未闭合部分交给持久 tail 节点保持原文
                                    chat._zfStreamRendered = _cut;
                                    chat._zfRichAt = _nowTs; chat._zfRichCut = _cut;
                                    var _pre = document.createElement('div');
                                    _pre.className = 'md-body';
                                    _pre.innerHTML = App.renderMarkdown(_buf.slice(0, _cut));
                                    var _tailEl = document.createElement('div');
                                    _tailEl.style.whiteSpace = 'pre-wrap';
                                    chat._zfTailNode = document.createTextNode(_buf.slice(_cut));
                                    _tailEl.appendChild(chat._zfTailNode);
                                    chat._zfTailEl = _tailEl;
                                    _cEl.innerHTML = '';
                                    _cEl.appendChild(_pre);
                                    _cEl.appendChild(_tailEl);
                                    chat._zfPaintedLen = _buf.length;
                                } else {
                                    // 无新围栏：只把增量追加进持久 tail 节点（不动前缀、不整棵重建）
                                    var _delta = _buf.slice(chat._zfPaintedLen || 0);
                                    if (_delta.length) {
                                        if (!chat._zfTailNode || !chat._zfTailNode.parentNode
                                            || !chat._zfTailEl || chat._zfTailEl.parentNode !== _cEl) {
                                            // 首帧/富分支未启动/结构被外层清掉：重建 tail（含未上屏前缀原文）
                                            chat._zfTailEl = document.createElement('div');
                                            chat._zfTailEl.style.whiteSpace = 'pre-wrap';
                                            chat._zfTailNode = document.createTextNode(
                                                _buf.slice(0, chat._zfPaintedLen || 0) + _delta);
                                            chat._zfTailEl.appendChild(chat._zfTailNode);
                                            _cEl.innerHTML = '';
                                            if ((chat._zfStreamRendered || 0) > 0) {
                                                // 富前缀在但 tail 丢失（罕见）：前缀一并重建
                                                var _pre2 = document.createElement('div');
                                                _pre2.className = 'md-body';
                                                _pre2.innerHTML = App.renderMarkdown(_buf.slice(0, chat._zfStreamRendered));
                                                _cEl.appendChild(_pre2);
                                            }
                                            _cEl.appendChild(chat._zfTailEl);
                                        } else {
                                            chat._zfTailNode.appendData(_delta);
                                        }
                                        chat._zfPaintedLen = _buf.length;
                                    }
                                }
                            } catch (_zfE) {
                                console.warn('[ZFRich] 流式增量渲染失败，降级原文:', _zfE);
                                _cEl.textContent = _buf; chat._zfPaintedLen = _buf.length;
                            }
                            // 滚动去重：内容长度没变（如纯光标闪烁帧）时跳过 scrollHeight 读取，避免强制重排
                            var _bufLen = chat._realStreamBuf.length;
                            if (chat._lastScrollLen !== _bufLen) {
                                chat._lastScrollLen = _bufLen;
                                /* 【自动跟随守卫】用户向上滚动查看历史时不被流式输出强制拉回底部：
                                   滚动事件（chatbox-03）在离开底部时置 autoFollowBottom=false，点回底按钮重新置 true。
                                   与打字机路径（chatbox-06:92）/工具结果路径（agent-03:475）同口径；undefined 视为跟随（兼容未绑定窗口） */
                                var _bEl = box.querySelector('.chatbox-body');
                                if (_bEl && chat.autoFollowBottom !== false) _bEl.scrollTop = _bEl.scrollHeight;
                            }
                            if (window.Perf && _pf0) Perf.mark('对话流:streamRender', _pf0);
                        });
                    },
                    null,
                    // 【新增】tool_event 事件回调：敏感工具（鼠标/键盘控制）提示弹 toast
                    function(ev) {
                        try {
                            if (!ev || ev.type !== 'tool_event') return;
                            var d = ev.data || {};
                            var msg = d.msg || '';
                            if (ev.kind === 'sensitive_tool' && msg) {
                                var t = document.createElement('div');
                                t.style.cssText = 'background:rgba(140,20,20,0.94);color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,0.35);max-width:100%;';
                                t.textContent = msg;
                                if (window.ToastStack && ToastStack.show) ToastStack.show(t, 6000);
                                else document.body.appendChild(t), setTimeout(function(){ t.remove(); }, 6000);
                                try { Store.addLog('warn', chat.id, 'sensitive-tool', msg + ' | args=' + JSON.stringify(d.args || {})); } catch (e2) {}
                            }
                        } catch (e) { console.warn('[Agent] tool_event 处理失败', e); }
                    }
                ).catch(function(err) {
                    if (err && err.name === 'AbortError') throw err;  // 用户停止不回退
                    console.warn('[Agent] 流式代理失败，回退聚合模式:', err);
                    try { Store.addLog('warn', chat.id, 'stream-fallback', 'proxyStream failed, fallback to aggregated proxy | ' + ((err && err.message) || err)); } catch (e) {}
                    chat._realStreamDiv = null;
                    return DB.proxy(model.endpoint, headers, payload, chat.abortController ? chat.abortController.signal : null);
                });
            } else {
                // 工具选择轮保持原聚合代理路径
                _proxyP = DB.proxy(model.endpoint, headers, payload, chat.abortController ? chat.abortController.signal : null);
            }
            // ===== 防误杀超时（根除「对话自动停止」）=====
            // 旧逻辑：330 秒总时长硬超时。大上下文/深思考的合法调用（实测存在 3~11 分钟的正常响应）
            // 被拦腰砍断；且超时后不 abort 底层请求，孤儿请求继续占住 服务器→上游 链路（服务端上游
            // 超时默认 1800 秒），重试又叠加新请求——孤儿越滚越多拖慢上游，全部会话连环超时，
            // 即「所有对话一起停止发送」的雪崩根源。新逻辑：
            //   1) 流式路径：每收到一个增量（含思考 reasoning）就重置计时器——只惩罚真无响应；
            //   2) 聚合路径：无法感知进度，超时按请求体大小自适应放宽（大上下文给足时间，上限 +660s）；
            //   3) 超时立即 abort 底层请求并换新 AbortController（重试共用旧控制器，必须换新）；
            //   4) 连续超时 2 次后不再原样重发，走 400 同款上下文重建（见 catch 分支），打断死亡螺旋。
            var _proxyTimedOut = false;
            var _payloadChars = 0;
            try {
                for (var _pi = 0; _pi < messages.length; _pi++) {
                    _payloadChars += (((messages[_pi] || {}).content || '') + '').length;
                }
            } catch (e) {}
            var PROXY_TIMEOUT_BASE = (loopConfig.proxyTimeoutMs != null ? loopConfig.proxyTimeoutMs : 900000);
            var _timeoutMs = PROXY_TIMEOUT_BASE + Math.min(660000, Math.floor(_payloadChars / 500) * 1000);
            var _proxyTimeoutReject = null;
            var _proxyAbortTimer = null;
            var _armProxyTimeout = function() {
                if (_proxyAbortTimer) clearTimeout(_proxyAbortTimer);
                _proxyAbortTimer = setTimeout(function() {
                    _proxyTimedOut = true;
                    // 掐断底层请求：不 abort 的话旧请求会继续占住上游链路，重试再叠新请求
                    try { if (chat.abortController) chat.abortController.abort(); } catch (e) {}
                    // 重试共用 chat.abortController，必须换新的，否则下一轮直接带病拒绝
                    try { chat.abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null; } catch (e) {}
                    if (_proxyTimeoutReject) {
                        var _toErr = new Error('代理请求超时（' + Math.round(_timeoutMs / 1000) + ' 秒无响应），已自动停止以避免卡死。请检查网络/后端服务后重试。');
                        _toErr._proxyTimeout = true;
                        _proxyTimeoutReject(_toErr);
                    }
                }, _timeoutMs);
            };
            _armProxyTimeout();
            var _timeoutP = new Promise(function(_, reject) { _proxyTimeoutReject = reject; });
            Promise.race([_proxyP, _timeoutP]).then(async function(res) {
                if (_proxyAbortTimer) { clearTimeout(_proxyAbortTimer); _proxyAbortTimer = null; }
                // 不在此处移除 typing：工具执行期间保持显示，避免闪烁
                var elapsed = Date.now() - reqStart;

                if (!res.ok || !res.data) {
                    var errMsg = _translateApiError(res.status, res.error || res.raw);
                    // 孤立 Unicode 代理项是本地上下文编码问题，原样重试不会改变输入。
                    var isUnicodeEncodingError = /surrogates not allowed|codec can't encode character/i.test(errMsg);
                    // ===== 400 模型不存在：确定性错误，重建消息毫无用处 =====
                    // 典型成因：models.json 改版后对话残留的 _modelIdOverride 在当前 endpoint 上不存在
                    //（如 mimo 系模型被发到智谱接口）。处理：优先清掉本对话的模型覆盖、用回模型默认
                    // modelId 自动重试一次；若本来就没有覆盖（endpoint 上配置的 modelId 本身不存在），
                    // 直接失败并给出明确提示，绝不能进入下方重建循环空转烧请求。
                    var _modelNotFoundError = /模型不存在|模型代码|model (does not exist|not found|not exist)|invalid model|unknown model/i.test(errMsg);
                    if (res.status === 400 && _modelNotFoundError && !chat._stopped) {
                        if (chat._modelIdOverride) {
                            delete chat._modelIdOverride;
                            try {
                                var _allChats = Store.state && Store.state.chats || {};
                                if (_allChats[chat.id]) { _allChats[chat.id]._modelIdOverride = ''; }
                            } catch (e) {}
                            var _typingElsMdl = box.querySelectorAll('.msg.typing');
                            _typingElsMdl.forEach(function(t) { t.remove(); });
                            self.addMsg(box, '⚠ API 报「模型不存在」(' + errMsg + ')，已自动清除本对话的模型覆盖设置，用回模型默认 ID 重试…', 'warning');
                            Store.addLog('warn', chat.id, 'retry-400-model-notfound', 'clear modelIdOverride → ' + (model.modelIdOptions && model.modelIdOptions[0] || model.modelId) + ' | ' + errMsg);
                            setTimeout(function() {
                                self._agentLoop(box, chat, model, messages, depth, retryCount, retryRound, _poolTurnId, _myEpoch);
                            }, RETRY_INTERVAL);
                            return;
                        }
                        var _typingElsMdl2 = box.querySelectorAll('.msg.typing');
                        _typingElsMdl2.forEach(function(t) { t.remove(); });
                        self.addMsg(box, '❌ API 报「模型不存在」(' + errMsg + ')。当前模型配置的 modelId 在该接口上无效，重建上下文无法解决，已停止。请到模型配置里修正该模型的 modelId。', 'error');
                        Store.addLog('error', chat.id, 'fail-400-model-notfound', 'modelId invalid on endpoint, abort instead of rebuild | ' + errMsg);
                        self._onSendComplete(box, chat);
                        return;
                    }
                    // ===== 400 自愈重建：400 是确定性错误（上游拒绝当前 messages），原样重发必然继续失败 =====
                    // 参照"用户手动发『继续』就能恢复"的成功路径：从 chat.history 重建干净 messages
                    //（_buildContext 自动过滤 tool/思考消息），追加恢复指令后接着干活。最多重建 3 次，超出则直接失败。
                    if (res.status === 400 && !chat._stopped && (chat._rebuild400Count || 0) < loopConfig.rebuild400Max) {
                        chat._rebuild400Count = (chat._rebuild400Count || 0) + 1;
                        var _cleanMsgs = [{ role: 'system', content: Tools.getSystemPrompt(chat.id) }].concat(self._buildContext(chat.history, model, chat));
                        // ===== 体量熔断（修复对话串台/超大上下文） =====
                        // 若 400 是「单条消息长度超硬上限」类尺寸拒绝，说明 history 里混入了巨型内容
                        //（可能是池复用/串台污染）。原样重建必然再次被拒并烧掉数百万字符。
                        // 处理：只保留头部 system(+项目记忆) + 从最新往回累计的尾部消息，砍掉中间巨型段。
                        var _sizeRejected = /单条消息长度|硬上限|超硬上限|context length|too long|maximum.*length|length.*exceed/i.test(errMsg);
                        var _capChars = _sizeRejected ? 400000 : 4000000;
                        (function() {
                            var _total = 0, _i;
                            for (_i = 0; _i < _cleanMsgs.length; _i++) _total += ((_cleanMsgs[_i] && _cleanMsgs[_i].content) || '').length;
                            if (_total <= _capChars) return;
                            var _nHead = (_cleanMsgs[0] && _cleanMsgs[0].role === 'system') ? 1 : 0;
                            if (_cleanMsgs[1] && _cleanMsgs[1].role === 'system') _nHead = 2;
                            var _kept = _cleanMsgs.slice(0, _nHead);
                            var _acc = 0, _start = _cleanMsgs.length;
                            for (_i = _cleanMsgs.length - 1; _i >= _nHead; _i--) {
                                _acc += ((_cleanMsgs[_i] && _cleanMsgs[_i].content) || '').length;
                                if (_acc > _capChars * 0.7) break;
                                _start = _i;
                            }
                            if (_start > _nHead) _kept.push({ role: 'user', content: '（系统提示：因上下文超长，已省略中间 ' + (_start - _nHead) + ' 条历史消息，仅保留最近内容。请基于以上信息继续任务。）' });
                            _kept = _kept.concat(_cleanMsgs.slice(_start));
                            // 超限单条消息做头尾截断（而非整条丢弃），避免"失忆空转"——保留开头指令语境 + 结尾最新意图
                            for (var _ki = 0; _ki < _kept.length; _ki++) {
                                var _m = _kept[_ki];
                                var _c = (_m && _m.content) || '';
                                if (typeof _c === 'string' && _c.length > _capChars * 0.6) {
                                    var _half = Math.floor(_capChars * 0.3);
                                    _m.content = _c.substring(0, _half) + '\n…（中段超长已截断）…\n' + _c.substring(_c.length - _half);
                                }
                            }
                            _cleanMsgs = _kept;
                        })();

                        // ===== 项目记忆注入（400 自愈重建后同样带上，保证模型知道项目目录和 python 路径） =====
                        // 【缓存优化】走会话内快照（只读，不触发生成），与正常发送路径内容一致
                        var _pm400 = self._stableProjMemo(chat);
                        if (_pm400) {
                            _cleanMsgs.splice(1, 0, { role: 'system', content: '【项目背景记忆】' + _pm400 });
                        }
                        _cleanMsgs.push({ role: 'user', content: '（系统自动恢复：上一次请求因消息格式被 API 拒绝而中断，以上是有效对话记录。请继续完成刚才未完成的任务，已完成的部分不要重复执行。）' });
                        messages.length = 0;
                        for (var _mi = 0; _mi < _cleanMsgs.length; _mi++) messages.push(_cleanMsgs[_mi]);
                        var _typingElsFix = box.querySelectorAll('.msg.typing');
                        _typingElsFix.forEach(function(t) { t.remove(); });
                        self.addMsg(box, '⚠ 请求被 API 拒绝（消息格式问题），已自动重建对话上下文（第' + chat._rebuild400Count + '/' + loopConfig.rebuild400Max + '次），' + RETRY_INTERVAL / 1000 + '秒后继续未完成的任务…', 'warning');
                        Store.addLog('warn', chat.id, 'retry-400-rebuild', 'HTTP 400 → rebuild messages from history #' + chat._rebuild400Count + ' | ' + errMsg);
                        setTimeout(function() {
                            self._agentLoop(box, chat, model, messages, depth + 1, retryCount, retryRound, null, _myEpoch);
                        }, RETRY_INTERVAL);
                        return;
                    }
                    // ===== 余额耗尽（402/balance exhausted）：不可恢复，直接停止，绝不重试 =====
                    if (res.status === 402 || /balance exhausted/i.test(errMsg)) {
                        var _typingElsBal2 = box.querySelectorAll('.msg.typing');
                        _typingElsBal2.forEach(function(t) { t.remove(); });
                        var _balDiv = self.addMsg(box, '💰 AI Token 余额已耗尽（402），无法继续对话。请充值后重试（不自动重试，避免空耗）。', 'error');
                        try {
                            var _balBtn = document.createElement('button');
                            _balBtn.className = 'btn-recharge';
                            _balBtn.innerHTML = '💳 前往充值';
                            _balBtn.title = '打开 AI Token 充值页面';
                            _balBtn.style.cssText = 'margin-top:8px;padding:6px 16px;border:none;border-radius:8px;background:linear-gradient(135deg,#f59e0b,#f97316);color:#fff;font-size:13px;font-weight:600;cursor:pointer;';
                            _balBtn.addEventListener('click', function(ev) { ev.stopPropagation(); window.open('https://www.zf3d.com/airecharge.asp', '_blank'); });
                            _balDiv.appendChild(_balBtn);
                        } catch (e) {}
                        Store.addLog('error', chat.id, 'balance-exhausted', errMsg);
                        self._onSendComplete(box, chat);
                        return;
                    }
                    // ===== 请求失败自动重试（400 已由上方自愈分支处理；重建耗尽时不再盲目重发，直接走失败提示）=====
                    if (!isUnicodeEncodingError && res.status !== 400 && RETRY_STATUS.indexOf(res.status) >= 0 && !chat._stopped) {
                        // 【分类对齐】限流/网关抖动判定与错误文案同源。上游网关会把真实 429 裸文本
                        // 包进外壳状态返回（如 status=0/200/500 但 body 是「429 请求过多」），只看
                        // res.status 会漏判成 3 秒固定间隔重试，反向轰击已拥堵的上游，且⛔限流面板
                        // 不计入。res.status 本身已是 429/50x 时直接采信（如 ai_proxy 聚合 502 的
                        // tried 列表里混有零散 401/429 字样，不能被带偏）；否则按 _friendlyErrMsg
                        // 同款规则从原始错误文本提码，提不到再回退 res.status。
                        var _rawCls = String(res.error || res.raw || '');
                        // 【本地假429识别 20261123】ai_proxy 每用户并发信号量满时也返回 429（「并发请求已达上限」），
                        // 那是本机排队而非上游拥堵——旧逻辑与真 429 同貌，误触发 429 长退避表并计入⛔面板，
                        // 用户被误导成"服务繁忙"。识别后走短抖动等待、不计面板；ai_proxy 侧 type 已改 local_concurrency。
                        var _isLocalQueue = /并发请求已达上限|local_concurrency/.test(_rawCls)
                            || /并发请求已达上限/.test(String((res.data && res.data.error && res.data.error.message) || ''));
                        var _effCode = res.status;
                        if (res.status !== 429 && res.status !== 502 && res.status !== 503 && res.status !== 504) {
                            var _stCls = _rawCls.match(/<h1>\s*(\d{3})/i) || _rawCls.match(/\b(429|402|401|403|500|502|503|504)\b/);
                            if (_stCls) _effCode = parseInt(_stCls[1], 10);
                        }
                        if (retryCount < MAX_RETRY) {
                            retryCount++;
                            // 🔄 429 限流专用指数退避（5s/15s/40s/90s/180s），避免重试雪崩
                            var _isRateLimit = (_effCode === 429);
                            // 【20260930】上游网关抖动（502/503/504）也用指数退避（5s/15s/40s/90s/180s），
                            // 避免官方 relay 线路抖动时每 3 秒弹一次重试提示刷屏。
                            var _isGatewayFlap = (_effCode === 502 || _effCode === 503 || _effCode === 504);
                            // 【本地排队 20261123】本机信号量 429 不是上游拥堵：不进 429 长退避、不报⛔面板
                            if (_isLocalQueue) { _isRateLimit = false; _isGatewayFlap = false; }
                            // 📊 限流事件上报（全局面板共享，方案 A：让用户实时看到哪家被限流）
                            if (_isRateLimit && window.RateLimit) { try { window.RateLimit.record(model.id, model.name, 429, chat.id); } catch (e) {} }
                            chat._retryStatusTotal = (chat._retryStatusTotal || 0) + 1;
                            // 【抖动 20261123】等比例随机抖动打散多框同步重试；本地排队/普通错误基线 RETRY_INTERVAL
                            var _baseBackoff = (_isRateLimit || _isGatewayFlap)
                                ? (RETRY_BACKOFF_429[Math.min(retryCount - 1, RETRY_BACKOFF_429.length - 1)])
                                : RETRY_INTERVAL;
                            var _backoffDelay = _jitterMs(_baseBackoff);
                            var _waitSec = Math.round(_backoffDelay / 1000);
                            var _maxRoundsDisp = (_isRateLimit || _isGatewayFlap) ? MAX_RETRY_ROUNDS_429 : MAX_RETRY_ROUNDS;
                            var _retryMsg = '⚠ ' + (_isLocalQueue
                                ? '本机并发排队中（蜂群/多聊天框并发较高，非线路故障），'
                                : '请求失败（' + _friendlyErrMsg(errMsg) + '），')
                                + _waitSec + '秒后自动重试…（第' + retryCount + '/' + MAX_RETRY + '次，第' + (retryRound + 1) + '/' + _maxRoundsDisp + '轮）'
                                + (_isRateLimit && window.RateLimitPanel ? ' —— 右下角⛔面板可查看限流统计并一键切换模型' : '');
                            var _typingEls6 = box.querySelectorAll('.msg.typing');
                            _typingEls6.forEach(function(t) { t.remove(); });
                            // 【降噪 20261123】重试状态原地更新一行（不落库），不再每次尝试新增一行刷屏
                            _upsertRetryStatus(box, chat, _retryMsg);
                            Store.addLog('warn', chat.id, 'retry' + (_isRateLimit ? '-429' : '') + (_isLocalQueue ? '-local' : ''), 'retry round ' + (retryRound + 1) + '/' + _maxRoundsDisp + ', attempt ' + retryCount + '/' + MAX_RETRY + ' | ' + errMsg + ' | backoff=' + _waitSec + 's');
                            setTimeout(function() {
                                self._agentLoop(box, chat, model, messages, depth, retryCount, retryRound, _poolTurnId, _myEpoch);
                            }, _backoffDelay);
                            return;
                        }
                        // 429 用专用多轮（MAX_RETRY_ROUNDS_429），普通错误仍 1 轮，避免限流长冷却期直接判死
                        // 【分类对齐】复用 _effCode 判定（_isRateLimit/_isGatewayFlap），文本裸 429 也享受 429 专用轮数
                        var _maxRounds = (_isRateLimit || _isGatewayFlap) ? MAX_RETRY_ROUNDS_429 : MAX_RETRY_ROUNDS;
                        if (retryRound + 1 < _maxRounds) {
                            var _nextRound = retryRound + 1;
                            var _roundMsg = '⚠ 本轮已重试 ' + MAX_RETRY + ' 次仍失败，5分钟后开始第' + (_nextRound + 1) + '/' + _maxRounds + '轮重试…';
                            var _typingElsRound = box.querySelectorAll('.msg.typing');
                            _typingElsRound.forEach(function(t) { t.remove(); });
                            // 【降噪 20261123】轮间等待同样原地更新，不再新增一行
                            _upsertRetryStatus(box, chat, _roundMsg);
                            Store.addLog('warn', chat.id, 'retry-round-wait', 'wait 300s before retry round ' + (_nextRound + 1) + '/' + _maxRounds);
                            setTimeout(function() {
                                self._agentLoop(box, chat, model, messages, depth, 0, _nextRound, _poolTurnId, _myEpoch);
                            }, RETRY_ROUND_INTERVAL);
                            return;
                        }
                    }
                    // ===== 【朱峰线路 401 自动登录】未登录/令牌失效 → 弹官方登录遮罩，登录成功后自动重取令牌并续发 =====
                    if (res.status === 401) {
                        var _isZfLine401 = !!(model && ((typeof Models !== 'undefined' && Models.isZfOfficial) ? Models.isZfOfficial(model) : (model.zfLine || model.zfManaged || model.zfPinned || model.keyRef === 'zf_token' || model.keyRef === 'server' || /127\.0\.0\.1:(8527|8559|8554|8787|8788)/.test(String(model.endpoint || '') + String(model.baseUrl || '')) || /^zfai_/.test(String(model.key || '')))));
                        if (_isZfLine401 && typeof ApiKeyQuickDialog !== 'undefined') {
                            // 【401 熔断 2026-11-22】本消息轮次（epoch）内最多自动登录 1 次。
                            // ai-token 取到令牌 ≠ 线路可用：zf_models_relay 中转线路的鉴权 Key 在服务端
                            // （heartbeat_api_key → X-ZF-Key 请求头，key 永不下发前端），客户端刷新令牌
                            // 根本救不了它。无熔断时「需要登录→登录成功→仍401」会无限循环刷屏
                            // （发图片触发识图接管、默认识图又是中转线路而本机缺 Key 时必现）。
                            if (chat._zf401LoginEpoch === _myEpoch) {
                                var _upMsg401 = '';
                                try { _upMsg401 = (res.data && res.data.error && (res.data.error.message || res.data.error.type)) || res.error || errMsg || ''; } catch (eU401) {}
                                var _noKey401 = /no-key/i.test(String(_upMsg401));
                                var _typingEls401x = box.querySelectorAll('.msg.typing');
                                _typingEls401x.forEach(function(t) { t.remove(); });
                                self.addMsg(box, _noKey401
                                    ? '❌ 朱峰线路鉴权失败（401 no-key）：本机未持有朱峰线路 Key。请到「设置 → 朱峰账号」退出后重新登录朱峰账号（登录成功会自动下发线路 Key），然后重发消息。'
                                    : '❌ 朱峰线路自动登录后仍被拒绝（401）' + (_upMsg401 ? '：' + _upMsg401 : '') + '。请到「设置 → 朱峰账号」重新登录，或检查该线路的鉴权配置后重发消息。', 'error');
                                Store.addLog('error', chat.id, 'zf-401-circuit-break', '401 persists after auto-login → stop (epoch ' + _myEpoch + ') | ' + String(_upMsg401).slice(0, 200));
                                self._onSendComplete(box, chat);
                                return;
                            }
                            chat._zf401LoginEpoch = _myEpoch;
                            var _typingEls401 = box.querySelectorAll('.msg.typing');
                            _typingEls401.forEach(function(t) { t.remove(); });
                            self.addMsg(box, '⚠️ 朱峰线路需要登录，正在打开登录窗口…', 'warning');
                            Store.addLog('warn', chat.id, 'zf-401-login', '朱峰线路 401 → 弹出登录遮罩');
                            // 清掉失效令牌，走快捷对话框（未登录时内部会调起 zf3dLoginOverlay，登录成功自动重取令牌）
                            try { Models.update(model.id, { apiKey: '' }); } catch (e401) {}
                            model.key = '';
                            ApiKeyQuickDialog.open(model, function(newKey) {
                                var upd = Models.update(model.id, { apiKey: newKey });
                                return Promise.resolve(upd).then(function() {
                                    model.key = newKey;
                                    chat.modelId = model.id;
                                    return Store.saveChatBox(chat);
                                }).then(function() {
                                    chat.isSending = false;
                                    try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
                                    self.updateSendButton(box, chat);
                                    self.addMsg(box, '✅ 登录成功，线路已开通，正在继续处理您的消息…', 'ai');
                                    // 【守卫】登录期间用户可能已停止/发新消息换代（epoch 变化），此时不再续发
                                    if (chat._stopped || (chat._epoch || 0) !== _myEpoch) { return; }
                                    setTimeout(function() { self._agentLoop(box, chat, model, messages, depth, 0, 0, null, _myEpoch); }, 200);
                                });
                            });
                            self._onSendComplete(box, chat);
                            return;
                        }
                    }
                    // ===== 降级逻辑已禁用：保持上下文稳定，不允许模型间自动切换 =====
                    // 所有重试轮次用尽，显示提示
                    var _typingEls5 = box.querySelectorAll('.msg.typing');
                    _typingEls5.forEach(function(t) { t.remove(); });
                    _clearRetryStatus(chat); // 【降噪 20261123】清掉原地重试状态行，换最终失败结论（这条落库）
                    if (retryCount >= MAX_RETRY) {
                        // 仅真正重试满 30 次才显示该消息；否则下面显示单次失败原因。
                        // 原条件 || retryRound >= MAX_RETRY_ROUNDS - 1 在 MAX_RETRY_ROUNDS=1 时恒真，
                        // 导致 0 次重试也误报"已完成最多 30 次重试仍失败"
                        self.addMsg(box, '❌ 已完成最多 ' + MAX_RETRY + ' 次重试仍失败，请检查网络连接或 API 服务后手动重试。\n\n失败原因：' + _friendlyErrMsg(errMsg), 'error');
                    } else {
                        self.addMsg(box, '调用失败：' + _friendlyErrMsg(errMsg), 'error');
                    }
                    Store.addLog('error', chat.id, 'api-error', model.name + '  ' + errMsg + (retryCount > 0 ? ' (retried ' + retryCount + 'x)' : ''));
                    self._onSendComplete(box, chat);
                    return;
                }

                // 【降噪 20261123】请求成功：清重试状态行；本轮若发过自动重试，补一行临时总结（不落库，
                // 持久历史不再留重试刷屏，全量细节在日志与⛔限流面板）。旧实现每条重试链落库 5~25 行 ⚠。
                if ((chat._retryStatusTotal || 0) > 0) {
                    try { self.addMsg(box, '⚠ 本次已自动重试 ' + chat._retryStatusTotal + ' 次后恢复', 'notice', null, false, true); } catch (e) {}
                }
                _clearRetryStatus(chat);

                var choice = res.data.choices && res.data.choices[0];
                if (!choice) {
                    var _typingEls4 = box.querySelectorAll('.msg.typing');
                    _typingEls4.forEach(function(t) { t.remove(); });
                    // 网关 relay 返回的结构化错误（如鉴权失败/余额不足）优先展示具体原因
                    var _gwErr = res.data && res.data.error && (res.data.error.message || res.data.error.type);
                    if (_gwErr) {
                        self.addMsg(box, '❌ 网关拒绝：' + _gwErr, 'error');
                    } else {
                        self.addMsg(box, 'AI 返回格式异常', 'error');
                    }
                    self._onSendComplete(box, chat);
                    return;
                }

                var msg = choice.message || {};
                // ===== 提取 token 使用量 + 缓存命中统计 =====
                if (res.data.usage) {
                    var u = res.data.usage;
                    var promptTokens = Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? 0) || 0;
                    var completionTokens = Number(u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0) || 0;
                    // Providers expose prompt-cache usage under several OpenAI-compatible names.
                    var promptDetails = u.prompt_tokens_details || u.promptTokensDetails || u.input_tokens_details || {};
                    var cacheHit = Number(
                        u.prompt_cache_hit_tokens ?? u.prompt_cache_read_tokens ?? u.prompt_cache_hit ??
                        u.cached_tokens ?? u.cache_read_input_tokens ?? u.cache_read_tokens ??
                        promptDetails.cached_tokens ?? promptDetails.cache_read_input_tokens ??
                        promptDetails.cache_read_tokens ?? 0
                    ) || 0;
                    var cacheMiss = Number(
                        u.prompt_cache_miss_tokens ?? u.prompt_cache_write_tokens ?? u.prompt_cache_miss ??
                        promptDetails.cache_miss_tokens ?? promptDetails.cache_write_tokens ?? 0
                    ) || 0;
                    // Some providers report only hits; the rest of the prompt is uncached.
                    cacheHit = Math.max(0, Math.min(cacheHit, promptTokens));
                    cacheMiss = Math.max(0, Math.min(cacheMiss, promptTokens - cacheHit));
                    if (!cacheMiss && promptTokens > cacheHit) cacheMiss = promptTokens - cacheHit;
                    chat._promptTokens += promptTokens;
                    chat._completionTokens += completionTokens;
                    chat._cacheHitTokens += cacheHit;
                    chat._cacheMissTokens += cacheMiss;
                    chat._tokenCount += (u.total_tokens || (promptTokens + completionTokens));
                    chat._apiCalls++;
                    // 风筝测速：在真实往返点记录间隔（上一次模型响应 → 本次响应；本轮首次 = 起点 → 首响应）。
                    // 数据挂在 chat 上（_lastGapMs/_gapLog），风筝 UI 只读取不再推断，真实可追溯。
                    var _nowApi = Date.now();
                    /*【极速模式】关闭风筝测速统计*/
                    var _prevApi = Number(chat._prevApiAt) || 0;
                    if (_prevApi > 0) {
                        chat._lastGapMs = _nowApi - _prevApi;
                        /* 【秒tok】每次模型往返同时算生成速度：completion_tokens ÷ 间隔秒数 */
                        var _tps = (completionTokens > 0 && _nowApi > _prevApi) ? +(completionTokens / ((_nowApi - _prevApi) / 1000)).toFixed(1) : null;
                        if (!chat._gapLog) chat._gapLog = [];
                        chat._gapLog.push({ t: _nowApi, gap: chat._lastGapMs, tps: _tps });
                        if (chat._gapLog.length > 12) chat._gapLog = chat._gapLog.slice(-12);
                    }
                    chat._prevApiAt = _nowApi;
                    chat._lastApiAt = _nowApi;
                    // 同步累加到会话级累计统计（整个对话历史累计，跨任务不清零）
                    chat._sessionTotalTokens += (u.total_tokens || (promptTokens + completionTokens));
                    chat._sessionTotalApiCalls++;
                    chat._sessionTotalPromptTokens += promptTokens;
                    chat._sessionTotalCompletionTokens += completionTokens;
                    chat._sessionTotalCacheHitTokens += cacheHit;
                    chat._sessionTotalCacheMissTokens += cacheMiss;
                    // 日志记录缓存命中详情
                    var cacheInfo = cacheHit > 0 ? ' | cache: ✅' + cacheHit + '/miss:' + cacheMiss : ' | cache: ❌miss';
                    Store.addLog('info', chat.id, 'token-usage',
                        'prompt:' + promptTokens + ' | completion:' + completionTokens +
                        cacheInfo + ' | cumul: ' + chat._tokenCount + ' | calls: ' + chat._apiCalls);
                }
                Store.addLog('info', chat.id, 'api-response', '← ' + model.name + ' | ' + elapsed + 'ms' + (msg.tool_calls ? ' | tool_calls=' + msg.tool_calls.length : ''));

                // ===== GLM思考模式截断检测：finish_reason=length 且无 content 且无 tool_calls =====
                // 思考过程耗尽了 max_tokens 预算，导致实际回复为空。自动倍增 max_tokens 重试。
                var _finishReason = choice.finish_reason || '';
                var _isEmptyReply = !(msg.content && msg.content.trim()) && !(msg.tool_calls && msg.tool_calls.length);
                if ((_finishReason === 'length' || res.data._truncated) && _isEmptyReply) {
                    var _truncRetry = chat._truncRetryCount || 0;
                    var _curMax = payload.max_tokens || model.maxTokens || 16384;  // null 时从 16384 起步倍增
                    var _newMax = Math.min(_curMax * 2, 65536);
                    var _reasoningText = msg.reasoning_content || msg.reasoning || msg.thinking || '';
                    Store.addLog('warn', chat.id, 'truncation', 'finish_reason=length, content empty, reasoning_len=' + _reasoningText.length + ', max_tokens=' + _curMax + (msg.reasoning_content ? ' (has reasoning_content)' : ''));

                    if (_truncRetry < 3 && _newMax > _curMax) {
                        chat._truncRetryCount = _truncRetry + 1;
                        chat._maxTokensOverride = _newMax;
                        var _typingElsTrunc = box.querySelectorAll('.msg.typing');
                        _typingElsTrunc.forEach(function(t) { t.remove(); });
                        self.addMsg(box, '⚠ 模型思考耗尽输出额度（finish_reason=length），自动提升 max_tokens ' + _curMax + '→' + _newMax + '，重试第' + chat._truncRetryCount + '/3次…', 'warning');
                        setTimeout(function() {
                            self._agentLoop(box, chat, model, messages, depth + 1, null, 0, null, _myEpoch);
                        }, 1000);
                        return;
                    } else {
                        var _typingElsTrunc2 = box.querySelectorAll('.msg.typing');
                        _typingElsTrunc2.forEach(function(t) { t.remove(); });
                        // 【星号残留修复】截断兜底回复前同样清掉流式占位 div
                        if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                        chat._realStreamDiv = null;
                        if (_reasoningText) {
                            self.addMsgStreaming(box, '⚠ 模型思考耗尽了输出额度，未能生成最终回复。以下是思考过程：\n\n' + _reasoningText, 'ai', chat.modelId, true, function() {
                                self._onSendComplete(box, chat);
                            });
                            chat.history.push({ role: 'assistant', content: '模型思考耗尽了输出额度，思考过程：\n' + _reasoningText });
                        } else {
                            self.addMsg(box, '⚠ 模型输出被截断（finish_reason=length），思考过程耗尽了全部输出额度，未生成最终回复。建议降低思考强度或增大 max_tokens。', 'error');
                        }
                        chat._truncRetryCount = 0;
                        delete chat._maxTokensOverride;
                        self._onSendComplete(box, chat);
                        return;
                    }
                }

                // 情况1：AI 调用了工具
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    // ===== 循环任务早期预警：签名重复检测（先警告，再升级交小狗守卫）=====
                    try { self._detectAgentLoop(box, chat, msg.tool_calls, depth); } catch(e) {}
                    // 检测输出被截断（tool_calls 的 JSON 参数可能不完整）
                    // _roundTruncated 存下供本轮工具参数解析失败时区分"模型写错"与"输出上限截断"
                    var _roundTruncated = (choice.finish_reason === 'length' || res.data._truncated);
                    var _truncatedSkipTools = false;
                    if (_roundTruncated) {
                        self.addMsg(box, '\u26a0 AI \u8f93\u51fa\u8fbe\u5230\u6700\u5927 token \u4e0a\u9650\u88ab\u622a\u65ad\uff08finish_reason=length\uff09\uff0c\u672c\u6279 ' + msg.tool_calls.length + ' \u4e2a\u5de5\u5177\u8c03\u7528\u5df2\u5168\u90e8\u4f5c\u5e9f\uff08\u53ef\u80fd\u542b\u534a\u622a\u53c2\u6570\uff09\uff0c\u6b63\u5728\u8bf7\u6c42\u6a21\u578b\u7eed\u5199\u3002', 'warning');
                        Store.addLog('warn', chat.id, 'truncated', 'AI \u8f93\u51fa\u56e0 finish_reason=length \u88ab\u622a\u65ad\uff08tool_calls \u9636\u6bb5\uff09\uff0c\u4f5c\u5e9f ' + msg.tool_calls.length + ' \u4e2a\u5de5\u5177\u8c03\u7528\u5e76\u8bf7\u6c42\u7eed\u5199');
                        // =====【截断保护】与后端 agent_loop_seg2 同策略：截断轮 tool_calls 整批作废，不执行不入历史 =====
                        messages.push({
                            role: 'user',
                            content: '[系统提示] 你的上一条回复因达到最大输出长度被截断，其中包含未完成的工具调用，已全部作废（不会执行）。请从中断处继续：重新发起少量、完整、合法的工具调用（单轮不超过5个）；若已无必要调用工具，则直接给出最终回答。'
                        });
                        _truncatedSkipTools = true;
                    }
                    // ===== 终止轮正文去重（代码级兜底）：本轮含 task_complete 时，正文会与 message 重复显示，直接跳过 =====
                    var _roundHasTerminal = false;
                    for (var _rti = 0; _rti < msg.tool_calls.length; _rti++) {
                        if (msg.tool_calls[_rti].function && Tools.isTerminal(msg.tool_calls[_rti].function.name)) { _roundHasTerminal = true; break; }
                    }
                    // 如果有文本内容，先显示并记录（终止轮跳过，避免与 task_complete 的 message 重复）
                    if (msg.content && !_roundHasTerminal) {
                        // 清洗正文残留的伪工具调用标签（<...task_complete...> 等）
                        msg.content = self._stripFakeToolTags(msg.content);
                        if (msg.content) {
                        // 显示AI文本前移除 typing
                        var _typingEls2 = box.querySelectorAll('.msg.typing');
                        _typingEls2.forEach(function(t) { t.remove(); });
                        // 【星号残留修复】工具轮附带的思考/说明文本也要先清掉流式占位 div
                        if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                        chat._realStreamDiv = null;
                        self.addMsgStreaming(box, msg.content, 'ai', chat.modelId);
                        // 【本地保留全部】思考文字存入 history，但标记 _thinking，_buildContext 发给模型时会过滤掉
                        chat.history.push({ role: 'assistant', content: msg.content, _thinking: true });
                        }
                    }

                    // 将 assistant 的 tool_calls 消息加入 messages
                    // 注意：content 兜底为空字符串而非 null（litellm 等严格校验的中转不接受 null，会返回 400 messages 参数非法）
                    // 【截断保护】作废轮不带 tool_calls（否则后续无 tool 结果回包，API 会报 tool_calls 必须跟 tool 消息）
                    var assistantMsg = {
                        role: 'assistant',
                        content: msg.content || ''
                    };
                    if (!_truncatedSkipTools) {
                        assistantMsg.tool_calls = msg.tool_calls.map(function(tc) {
                            return { id: tc.id, type: 'function', function: tc.function };
                        });
                    }
                    messages.push(assistantMsg);

                    // 设置当前对话 ID，供工具（如 task_list）关联使用
                    Tools.currentChatId = chat.id;

                    // 逐个执行工具（支持异步工具）
                    var lastResult = null;  // 记录最后一个工具的结果（终止判断用）
                    var lastToolName = '';
                    var _terminalResult = null;   // 【修复】本轮内 task_complete 的结果（无论是否为最后一个工具调用）
                    var _terminalTcId = null;     // 【自审门禁v2.2】task_complete 的 tool_call_id（拒绝回填用）
                    var _terminalToolName = '';
                    for (var ti = _truncatedSkipTools ? msg.tool_calls.length : 0; ti < msg.tool_calls.length; ti++) {
                        var tc = msg.tool_calls[ti];
                        var toolName = tc.function.name;
                        // 写/执行类工具触达标记（P0-1）：本任务碰过写类工具却只回纯文本收尾时，情况2 分支拦截。
                        // 随任务在发送入口（sendToModel）重置；白名单与 lite 分级同源 SelfGate.WRITE_TOOLS_RE。
                        try { if (window.SelfGate && SelfGate.WRITE_TOOLS_RE && SelfGate.WRITE_TOOLS_RE.test(toolName)) chat._taskTouchedWriteTools = true; } catch (_eTwt) {}
                        if (window.KiteDragon) window.KiteDragon.tool(chat, toolName);
                        var toolArgs;
                        var toolArgsError = null;
                        var toolArgsSalvaged = false;  // write_file 参数截断被兜底抢救 → 文件内容不完整，需提醒模型补全
                        var rawArgs = tc.function.arguments;
                        // 部分中转层会提前把 arguments 解成对象；不要对对象调用 JSON.parse。
                        if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
                            toolArgs = rawArgs;
                            tc.function.arguments = JSON.stringify(toolArgs);
                        } else {
                            rawArgs = String(rawArgs || '{}');
                            try {
                                toolArgs = JSON.parse(rawArgs);
                            } catch (e) {
                                // 兼容模型生成的未转义路径、实际换行/制表符等非法 JSON 字符。
                                var fixed = '';
                                var inString = false;
                                var escaped = false;
                                for (var ai = 0; ai < rawArgs.length; ai++) {
                                    var ch = rawArgs[ai];
                                    if (escaped) {
                                        fixed += ch;
                                        escaped = false;
                                    } else if (ch === '\\') {
                                        var next = rawArgs[ai + 1] || '';
                                        if (inString && !/["\\\\\/bfnrtu]/.test(next)) fixed += '\\\\';
                                        else { fixed += ch; escaped = true; }
                                    } else if (ch === '"') {
                                        fixed += ch;
                                        inString = !inString;
                                    } else if (inString && ch === '\n') fixed += '\\n';
                                    else if (inString && ch === '\r') fixed += '\\r';
                                    else if (inString && ch === '\t') fixed += '\\t';
                                    else fixed += ch;
                                }
                                try { toolArgs = JSON.parse(fixed); }
                                catch (e2) {
                                    // ===== 【新增】通用截断 JSON 修复 =====
                                    // 部分中转层/模型会在超长参数中插入 <arg_value 之类占位符导致 JSON 被截断。
                                    // 修复：逐字符扫描，补齐未闭合的字符串引号与括号后再解析。
                                    if (!toolArgsError || toolArgsError === e.message) {
                                        try {
                                            var _rp = rawArgs.replace(/<arg_value[^>]*>?/gi, '');
                                            var _stack = [], _inStr = false, _esc = false;
                                            for (var _ri = 0; _ri < _rp.length; _ri++) {
                                                var _rc = _rp[_ri];
                                                if (_esc) { _esc = false; continue; }
                                                if (_rc === '\\') { _esc = true; continue; }
                                                if (_rc === '"') { _inStr = !_inStr; continue; }
                                                if (_inStr) continue;
                                                if (_rc === '{' || _rc === '[') _stack.push(_rc);
                                                else if (_rc === '}' || _rc === ']') _stack.pop();
                                            }
                                            var _repaired = _rp;
                                            if (_esc) _repaired = _repaired.slice(0, -1); // 结尾悬空反斜杠
                                            if (_inStr) _repaired += '"';                // 补齐未闭合字符串
                                            // 尾部收尾循环：去掉孤立逗号 / 孤立键名 / 补缺失值
                                            while (true) {
                                                var _t = _repaired.replace(/\s+$/, '');
                                                if (/,\s*$/.test(_t)) { _repaired = _t.replace(/,\s*$/, ''); continue; }
                                                var _m = _t.match(/,\s*"(?:[^"\\]|\\.)*"$/);
                                                if (_m) { _repaired = _t.slice(0, _t.length - _m[0].length); continue; }
                                                if (/:\s*$/.test(_t)) { _repaired = _t + ' null'; continue; }
                                                break;
                                            }
                                            while (_stack.length) _repaired += (_stack.pop() === '{' ? '}' : ']');
                                            toolArgs = JSON.parse(_repaired);
                                            toolArgsError = null;
                                            console.warn('[agent] tool arguments JSON 被截断/含占位符，已修复补齐解析。工具:', toolName);
                                            if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', toolName + ' → 参数截断已自动修复补齐');
                                        } catch (eRepair) { /* 继续走下方定向兜底 */ }
                                    }
                                    // ===== 【2026 新增】write_file 超长内容截断定向兜底 =====
                                    // 模型写超长文件（如双语帮助文档）时，content 常被单次输出上限截断，
                                    // JSON 字符串未闭合导致解析失败。兜底：按原始文本直接提取 path 与
                                    // content（未闭合也照收），把已生成的部分写入，不再直接报错丢弃。
                                    if (toolName === 'write_file' || toolName === 'write') {
                                        var _pMatch = rawArgs.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                                        var _cIdx = rawArgs.search(/"content"\s*:\s*"/);
                                        if (_pMatch && _cIdx !== -1) {
                                            var _cColon = rawArgs.indexOf(':', _cIdx);
                                            var _cStart = rawArgs.indexOf('"', _cColon) + 1;
                                            var _content = rawArgs.slice(_cStart)
                                                .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                                                .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
                                            toolArgs = {
                                                path: _pMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
                                                content: _content
                                            };
                                            toolArgsError = null;
                                            toolArgsSalvaged = true;
                                            console.warn('[agent] write_file 参数 JSON 被截断，已按原始文本兜底提取（内容可能不完整，建议分段写入）。path:', toolArgs.path);
                                            if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', 'write_file 参数截断，已兜底写入 ' + toolArgs.path);
                                        }
                                    }
                                    // run_code 的 code 字段仍保留一个定向兜底，避免多行代码被截断。
                                    var codeMatch = rawArgs.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                                    if (codeMatch) {
                                        toolArgs = { code: codeMatch[1]
                                            .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                                            .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t') };
                                    }
                                    // ===== 【新增】run_code 的 codes（批量命令数组）定向兜底 =====
                                    // 模型生成的 codes 数组里含未转义引号/换行时 JSON.parse 失败，
                                    // 上面的 code 兜底抓不到数组，这里单独提取每条命令字符串。
                                    if (!codeMatch && /"codes"\s*:\s*\[/.test(rawArgs)) {
                                        try {
                                            var _unesc = function (s) {
                                                return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                                                    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
                                            };
                                            var codesArr = [];
                                            var codesRe = /"(?:[^"\\\n]|\\[\s\S])*"/g; // 逐个提取字符串字面量（允许 \" 跨任意字符转义）
                                            var cm;
                                            var _inArr = false;
                                            // 找到 codes 数组区段：从 "codes": [ 起到对应 ] 或字符串末尾
                                            var _cs = rawArgs.search(/"codes"\s*:\s*\[/);
                                            if (_cs !== -1) {
                                                var _body = rawArgs.slice(_cs).replace(/^.*?"codes"\s*:\s*\[/, '');
                                                // 截到配对的 ]：必须跳过字符串字面量并按括号深度配对，
                                                // 否则命令内部的 [IO.File] 之类会被误认为数组结尾导致截断丢命令。
                                                var _depth = 0; var _end = -1; var _q = false; var _esc2 = false;
                                                for (var _i = 0; _i < _body.length; _i++) {
                                                    var _ch = _body.charAt(_i);
                                                    if (_esc2) { _esc2 = false; continue; }
                                                    if (_ch === '\\') { if (_q) _esc2 = true; continue; }
                                                    if (_ch === '"') { _q = !_q; continue; }
                                                    if (_q) continue;
                                                    if (_ch === '[' || _ch === '{') _depth++;
                                                    else if (_ch === ']' || _ch === '}') {
                                                        _depth--;
                                                        // 未转义引号会让 _q 状态错乱，导致中途误判数组结束（命令被截断）。
                                                        // 兜底：只有当剩余部分不再有 ", " 元素边界时才认作数组结尾。
                                                        if (_depth === 0) {
                                                            var _rest = _body.slice(_i + 1);
                                                            if (/_q_/.test(_rest) || !/",\s*"/.test(_rest)) { _end = _i; break; }
                                                        }
                                                    }
                                                }
                                                if (_end === -1) _end = _body.length; // 未闭合则取到末尾
                                                _body = _body.slice(0, _end);
                                                // 先按数组元素边界 ", " 切分（命令内部的引号不会截断命令本身）
                                                var _parts = _body.split(/",\s*"/);
                                                if (_parts.length > 1) {
                                                    _parts[0] = _parts[0].replace(/^\s*"/, '');
                                                    _parts[_parts.length - 1] = _parts[_parts.length - 1].replace(/"\s*,?\s*$/, '');
                                                    for (var _p = 0; _p < _parts.length; _p++) {
                                                        var _pc = _parts[_p].replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
                                                        if (_pc) codesArr.push(_unesc(_pc));
                                                    }
                                                } else {
                                                    // 单元素或无边界：退回字符串字面量提取
                                                    while ((cm = codesRe.exec(_body)) !== null) {
                                                        codesArr.push(_unesc(cm[0].slice(1, -1)));
                                                    }
                                                    if (!codesArr.length) {
                                                        var _one = _body.replace(/^\s*"|"\s*$/g, '').trim();
                                                        if (_one) codesArr.push(_unesc(_one));
                                                    }
                                                }
                                                if (codesArr.length) {
                                                    toolArgs = { codes: codesArr };
                                                    toolArgsError = null;
                                                    console.warn('[agent] tool arguments JSON 解析失败，已从 codes 数组定向提取', codesArr.length, '条命令。工具:', toolName);
                                                    if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', toolName + ' → codes 参数已定向提取修复');
                                                }
                                            }
                                        } catch (eCodes) { /* 走下方通用失败分支 */ }
                                    }
                                    if (!codeMatch && !(toolArgs && toolArgs.codes)) {
                                        toolArgs = {};
                                        toolArgsError = e.message || '工具参数 JSON 解析失败';
                                        console.warn('[agent] invalid tool arguments', toolName, rawArgs, e);
                                        if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', toolName + ' → ' + toolArgsError);
                                    }
                                    // ===== 【2026 修复】终止型工具(task_complete)定向兜底 =====
                                    // 问题：模型调用 task_complete 时 message 很长/含未转义字符，JSON 解析失败后
                                    // 会走 toolArgsError 分支 → 终止判断成立 → 显示"❌ 任务失败: Invalid tool arguments"，
                                    // 但任务实际已经完成，属于误报失败。
                                    // 修复：先清洗非法控制字符再解析；仍失败则降级为成功+原始文本作为 message。
                                    if (toolArgsError && /task[_\s]?complete/i.test(toolName || '')) {
                                        try {
                                            var _sanitized = String(rawArgs || '{}').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
                                            toolArgs = JSON.parse(_sanitized);
                                            toolArgsError = null;
                                        } catch (e4) {
                                            // 最后一道：尝试宽松提取 message 字段内容
                                            var _msg = '';
                                            var _mm = String(rawArgs).match(/"message"\s*:\s*"([\s\S]*)/);
                                            if (_mm) {
                                                _msg = _mm[1]
                                                    .replace(/",\s*"(?:scope|success|reason|summary)[\s\S]*$/i, '')
                                                    .replace(/",\s*\{[\s\S]*$/, '')
                                                    .replace(/"\s*\}?\s*$/, '');
                                            }
                                            if (!_msg) _msg = String(rawArgs).replace(/^[{\s]*/, '').replace(/[\s}]*$/, '');
                                            try { _msg = _msg.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); } catch (e5) {}
                                            if (!_msg.trim()) _msg = '任务完成';
                                            // success 字段尽量识别，识别不到默认按成功处理（终止型工具+有 message 即视为正常收尾）
                                            var _succM = String(rawArgs).match(/"success"\s*:\s*(false)/i);
                                            toolArgs = { success: !_succM, message: _msg };
                                            toolArgsError = null;
                                            console.warn('[agent] task_complete 参数解析失败，已降级为成功收尾。原文:', rawArgs);
                                            if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', 'task_complete → 参数解析失败，已降级为成功收尾兜底');
                                        }
                                    }
                                    // ===== 【新增】task_list 定向兜底 =====
                                    // 模型有时会生成非法 JSON：tasks 数组元素不加引号（中文裸词）、
                                    // 或把 "title" 键混进数组。宽松提取 action/title/tasks。
                                    if (toolArgsError && /^task[_\s]?list$/i.test(toolName || '')) {
                                        try {
                                            var _tl = String(rawArgs || '');
                                            var _action = (_tl.match(/"action"\s*:\s*"([a-z]+)"/i) || [])[1] || 'create';
                                            var _tlObj = { action: _action };
                                            var _tlTitle = (_tl.match(/"title"\s*:\s*"([^"]*)"/) || [])[1];
                                            if (_tlTitle) _tlObj.title = _tlTitle;
                                            // 提取 tasks 数组区段
                                            var _ts = _tl.search(/"tasks"\s*:\s*\[/);
                                            if (_ts !== -1) {
                                                var _tBody = _tl.slice(_ts).replace(/^.*?"tasks"\s*:\s*\[/, '');
                                                _tBody = _tBody.replace(/\]\s*\}?[\s\S]*$/, ''); // 截掉数组之后的残余
                                                var _tasks = [];
                                                // 情况A：数组里是对象 {title, ...}
                                                var _objRe = /\{[^{}]*\}/g;
                                                var _om;
                                                while ((_om = _objRe.exec(_tBody)) !== null) {
                                                    var _t = (_om[0].match(/"title"\s*:\s*"([^"]*)"/) || [])[1];
                                                    if (_t) _tasks.push({ title: _t });
                                                }
                                                // 情况B：数组里是裸词字符串（未加引号），按逗号/引号字符串混合切分
                                                if (!_tasks.length) {
                                                    _tBody.split(/,\s*/).forEach(function (_seg) {
                                                        var _q = _seg.match(/"([^"]*)"/);
                                                        var _name = _q ? _q[1] : _seg.replace(/^[\s"'\[{]+|[\s"'\]}]+$/g, '');
                                                        _name = _name.replace(/^["']+|["']+$/g, '').trim();
                                                        // 剔除混进数组的键值对残余
                                                        if (_name && !/^"?\w+"?\s*:/.test(_name) && !/^(title|action|tasks)$/i.test(_name)) {
                                                            _tasks.push(_name);
                                                        }
                                                    });
                                                }
                                                if (_tasks.length) _tlObj.tasks = _tasks;
                                            }
                                            if (_tlObj.tasks || _tlTitle || _action !== 'create') {
                                                toolArgs = _tlObj;
                                                toolArgsError = null;
                                                console.warn('[agent] task_list 参数解析失败，已用宽松提取兜底。原文:', rawArgs);
                                                if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', 'task_list → 参数解析失败，已宽松提取兜底');
                                            }
                                        } catch (e5) {}
                                    }
                                }
                            }
                            if (toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs)) {
                                tc.function.arguments = JSON.stringify(toolArgs);
                            }
                        }
                        if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
                            toolArgs = {};
                            toolArgsError = '工具参数必须是 JSON 对象';
                        }

                        // 参数无效时不要继续执行工具，避免空参数产生破坏性副作用。
                        if (toolArgsError) {
                            var _invErrMsg = 'Invalid tool arguments: ' + toolArgsError;
                            // 【截断教学】本轮生成被输出上限截断时，明确告诉模型根因与正确做法，
                            // 否则模型只会看到 "Unterminated string" 而原样重试，无限循环烧 token。
                            if (_roundTruncated) {
                                _invErrMsg += '。根因说明：本轮回复在模型单次输出长度上限处被截断（finish_reason=length），'
                                    + '导致工具参数 JSON 不完整——这不是你的 JSON 写法问题，重试原样的大参数必然再次截断。'
                                    + '正确做法：把大文件拆成多次较小的工具调用，每次 write_file/replace_text 的 content 控制在 6000 字符以内，'
                                    + '先写入文件开头，再用 replace_text 或分段写入补齐后续部分；也可以拆成多个小文件。';
                            }
                            result = { ok: false, error: _invErrMsg };
                            lastResult = result;
                            lastToolName = toolName;
                            Store.addMessage(chat.id, 'tool_call', toolName + ': invalid arguments', 'tool');
                            try { var _tt2 = box.querySelector('.msg.typing'); if (_tt2 && _tt2._ttPush) _tt2._ttPush(toolName); } catch (e) {}
                            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
                            continue;
                        }


                        // ===== 工具球：改为【工具开始执行时】就塞球（原为执行完才塞，球刚出现就随下一轮 typing 重建被删，肉眼看不到）=====
                        try { var _ttS = box.querySelector('.msg.typing'); if (_ttS && _ttS._ttPush) _ttS._ttPush(toolName); } catch (e) {}

                        // ===== 【v6.3 沟通强化A·长睡工具执行中用户插话即时可见】=====
                        // 症状：wait / chat_manage(wait,review_wait) 等长睡工具把本轮 ti 循环阻塞在 await，
                        // 用户插话（InjectBus）只能等下轮循环头 L315 才被消费注入——wait 120 秒插话就黑洞 120 秒。
                        // 修法（零 schema 改动，仅前端循环内）：
                        // ① wait：检测到待响应插话 → seconds 钳到 0.5（工具照常执行，零语义损失），下轮 L315 立即注入插话；
                        // ② chat_manage wait/review_wait：检测到待响应插话 → 不执行，直接回「暂缓」合成工具结果
                        //   （模型下轮先看到插话再自行重新调用等待，协作链不丢、插话不再等待整个超时时长）。
                        if (typeof InjectBus !== 'undefined' && InjectBus.size(chat) > 0
                            && (toolName === 'wait' || (toolName === 'chat_manage' && /^(wait|review_wait)$/i.test(String((toolArgs && toolArgs.action) || ''))))) {
                            try { Store.addLog('info', chat.id, 'inject-fastpath', '待响应插话 → 快速放行 ' + toolName + ' | ' + (toolName === 'wait' ? 'seconds 钳到 0.5' : '等待暂缓')); } catch (e) {}
                            if (toolName === 'wait') {
                                try { toolArgs.seconds = 0.5; tc.function.arguments = JSON.stringify(toolArgs); } catch (e) {}
                            } else {
                                result = { ok: true, deferred: true, note: '有用户插话待响应：本次等待已暂缓。下一轮插话会自动注入上下文；请先回应插话，再重新调用本等待继续原任务。' };
                                lastResult = result;
                                lastToolName = toolName;
                                Store.addMessage(chat.id, 'tool_call', toolName + ': deferred(插话暂缓)', 'tool');
                                try { var _ttD = box.querySelector('.msg.typing'); if (_ttD && _ttD._ttPush) _ttD._ttPush(toolName); } catch (e) {}
                                messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
                                continue;
                            }
                        }

                        // 执行工具（可能是异步 Promise）
                        if (toolName === 'ask_user') {
                            // 询问用户：渲染提问卡片并阻塞等待用户回答，回答作为工具结果回传给 AI
                            // 【留痕】等待开始/结束都落日志：等待中被健康锁弹窗遮住时，DB 里能看到
                            // "卡在等用户输入"而不是零痕迹（13:03 静默停止事故的排查痛点）
                            try { Store.addLog('info', chat.id, 'ask-user-wait', 'ask_user 等待用户回答: ' + String(toolArgs && toolArgs.question || '').slice(0, 80)); } catch (e0) {}
                            var askResult = await self.askUser(toolArgs, box, chat);
                            result = askResult;
                            lastResult = askResult;
                            lastToolName = toolName;
                            // 持久化工具调用日志
                            Store.addMessage(chat.id, 'tool_call', toolName + ': ' + JSON.stringify(toolArgs), 'tool');
                            // 将工具结果（用户回答/超时）加入 messages 回传给 AI
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify(askResult)
                            });
                            // 用户主动取消询问 → 停止 Agent 循环（超时不算取消，继续循环）
                            if (askResult && askResult.cancelled) {
                                Store.addLog('warn', chat.id, 'tool-exec', toolName + ' → 用户取消，对话停止');
                                self.addMsg(box, '⚠ 用户取消了询问，对话已停止。', 'ai', chat.modelId);
                                chat.history.push({ role: 'assistant', content: '用户取消了询问，对话已停止。' });
                                self._onSendComplete(box, chat);
                                return;
                            }
                            if (askResult && askResult._timeout) {
                                Store.addLog('warn', chat.id, 'tool-exec', toolName + ' → 等待超时，已回传超时结果，循环继续');
                            } else {
                                Store.addLog('info', chat.id, 'tool-exec', toolName + ' → success (用户已回答)');
                            }
                            continue;
                        }
                        // ===== 工具执行兜底（防静默挂死）：执行前留痕 + 异步结果加超时 =====
                        // 事故案例：13:03:44 响应返回 tool_calls=1 后，工具（或 await 链中的某个
                        // 永不 settle 的 Promise）卡死 → 8 分钟零日志零报错，循环无声停摆，
                        // 只能靠 DB 反推。现在：① tool-start 日志锁定"执行了但没结束"的状态；
                        // ② 15 分钟兜底超时把错误结果回填给模型，循环继续而不是永久挂死。
                        var _toolStartMs = Date.now();
                        try { Store.addLog('info', chat.id, 'tool-start', toolName + ' args=' + (function(){ try { return JSON.stringify(toolArgs).slice(0, 150); } catch(e){ return '?'; } })()); } catch (e0) {}
                        // 【工具计数】每执行一个工具，右下角导航该对话数字 +1
                        if (!self._isRoleChat(box)) chat._toolUseCount = (chat._toolUseCount || 0) + 1;
                        // 【今日公里数】每次工具执行 = 车子跑一小段路，累计到全局（按自然日重置）
                        try {
                            var _kToday = new Date(); var _kDay = _kToday.getFullYear() + '-' + (_kToday.getMonth() + 1) + '-' + _kToday.getDate();
                            if (window._kiteOdoDay !== _kDay) { window._kiteOdoDay = _kDay; window._kiteOdometer = 0; }
                            window._kiteOdometer = (window._kiteOdometer || 0) + 1; // 1次工具调用=1公里
                        } catch (eOdo) {}
                        if (typeof self.updateMinimap === 'function') self.updateMinimap();
                        // ===== 占位卡片：执行前立即显示"⏳ 执行中"，完成后原地替换为结果卡 =====
                        var _pendingCardEl = null;
                        if (!Tools.isTerminal(toolName) && typeof Tools.renderPendingCard === 'function' && typeof self.addToolCard === 'function') {
                            try {
                                _pendingCardEl = self.addToolCard(box, Tools.renderPendingCard(toolName, toolArgs));
                            } catch (_pe) { console.error('[pending-card]', _pe); }
                        }
                        // 【防中途停止 2026-10】工具执行同步抛异常不再冲出循环：
                        // 旧行为异常会冒泡到总 .catch 被误判成网络错误 → 原样重发整个请求 5×3 次后停止。
                        // 现在把异常转成工具失败结果回传给模型，循环继续（模型可换方式推进或收尾）。
                        var result = null;
                        try {
                            result = Tools.execute(toolName, toolArgs, { chatId: chat.id });
                        } catch (_toolErrSync) {
                            Store.addLog('error', chat.id, 'tool-crash', toolName + ' 同步抛异常: ' + ((_toolErrSync && _toolErrSync.message) || _toolErrSync));
                            result = { success: false, tool: toolName, message: '工具执行抛出异常: ' + ((_toolErrSync && _toolErrSync.message) || _toolErrSync) + '。已作为失败结果回传，循环继续。请勿原样重试该调用，改用其他方式推进或用 task_complete 收尾。' };
                        }
                        if (result && typeof result.then === 'function') {
                            var _TOOL_TIMEOUT_MS = 15 * 60 * 1000;
                            // 【消噪】超时胜出后原工具 Promise 若 reject 已无消费者，会触发 unhandledrejection 控制台噪音：
                            // 预挂一个 .catch 吞掉拒绝事件（race 用原 promise，reject 仍会走下方 try/catch 转失败结果，逻辑不变）
                            try { result.catch(function (_noiseErr) { console.warn('[tool-noise]', toolName, '工具 Promise 拒绝（已被主流程兜底处理）:', (_noiseErr && _noiseErr.message) || _noiseErr); }); } catch (_cn) {}
                            try {
                                result = await Promise.race([
                                    result,
                                    new Promise(function(resolveT) {
                                        setTimeout(function() {
                                            resolveT({ success: false, _timeout: true, tool: toolName,
                                                       message: '工具执行超时（15 分钟未返回），已强制中断。请勿原样重试该工具，改用其他方式推进或用 task_complete 收尾。' });
                                        }, _TOOL_TIMEOUT_MS);
                                    })
                                ]);
                            } catch (_toolErrAsync) {
                                // 异步工具 Promise reject：同样转为失败结果，循环继续而非整轮重发后停止
                                Store.addLog('error', chat.id, 'tool-crash', toolName + ' 异步执行异常: ' + ((_toolErrAsync && _toolErrAsync.message) || _toolErrAsync));
                                result = { success: false, tool: toolName, message: '工具异步执行抛出异常: ' + ((_toolErrAsync && _toolErrAsync.message) || _toolErrAsync) + '。已作为失败结果回传，循环继续。请勿原样重试该调用，改用其他方式推进或用 task_complete 收尾。' };
                            }
                        }
                        // 工具返回归一化
                        if (!result || typeof result !== 'object' || Array.isArray(result)) {
                            result = { success: false, message: '工具执行未返回有效结果', tool: toolName };
                        }
                        if (result && result._timeout) {
                            try { Store.addLog('error', chat.id, 'tool-timeout', toolName + ' 执行 ' + Math.round((Date.now() - _toolStartMs) / 1000) + 's 未返回，已强制中断回填错误结果'); } catch (e0) {}
                        }
                        lastResult = result;
                        lastToolName = toolName;
                        /* 【播报】工具结果同步到蜂群作战室小人/植物叶子（与风筝身体同款气泡播报） */
                        try {
                            if (window.ZFKiteModes && typeof ZFKiteModes.toolResult === 'function') {
                                var _trOk = !(result && (result.success === false || result.ok === false));
                                var _trMsg = String((result && (result.message || result.error)) || (result && result.success === false ? '执行失败' : '执行成功'));
                                ZFKiteModes.toolResult(chat.id, toolName + ': ' + _trMsg, _trOk);
                            }
                        } catch (eTR) {}
                        // 【修复】模型可能同时返回多个工具调用（如 task_list + task_complete），
                        // 只要本轮内出现过 task_complete，就记录其结果供终止块使用，
                        // 避免它不是最后一个工具时终止判断失效 → 弹窗不出现、循环还要再跑一轮。
                        if (toolName === 'task_complete') {
                            _terminalResult = result;
                            _terminalToolName = toolName;
                            _terminalTcId = tc.id;   // 【自审门禁v2.2】记录 tool_call_id，拒绝时回填 role=tool 消息用
                            // ===== 任务完成额外暴击 +1：仅成功时派发（连击系统监听 zf-combo-hit）=====
                            if (result && result.success) {
                                try { window.dispatchEvent(new CustomEvent('zf-combo-hit', { detail: { tool: 'task_complete' } })); } catch (e) {}
                            }
                        }
                        if (toolName === 'task_complete' && result && (result.message || result.success)) {
                            try {
                                var _wlSummary = String(result.message || (result.success ? '任务完成' : '任务失败')).replace(/\s+/g, ' ').trim();
                                // 【展示优化】worklog 摘要只取审核报告标记之前的结论区（报告全文仍在 chat.history）
                                var _sgIdx = _wlSummary.indexOf('—— 审核报告 ——');
                                if (_sgIdx > 0) _wlSummary = _wlSummary.slice(0, _sgIdx).replace(/\s+/g, ' ').trim();
                                if (_wlSummary.length > 600) _wlSummary = _wlSummary.slice(0, 600) + '…';
                                fetch('/api/worklog', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        summary: _wlSummary,
                                        chatId: String(chat.id || ''),
                                        success: !!result.success
                                    })
                                }).catch(function() {});
                            } catch (e) {}
                        }

                        // ===== 朗读助手：占位标记（朗读已移到终止块·自审门禁放行后触发，防止门禁拒绝重试时读两次/提前读） =====
                        var _ttsPending = false;
                        if (toolName === 'task_complete' && window.TTS && TTS.isEnabled() && _terminalResult) {
                            try { _ttsPending = true; } catch (e) {}
                        }

                        // ===== 工具结果数据提取（用于画布建节点等）=====
                        var _toolData = (result && (result.data || result.url || result.video_url)) || null;

                        // ===== image_gen / video_gen：画布建节点（可拖拽/缩放/连线）=====
                        if (toolName === 'image_gen' && _toolData) {
                            var _imgUrl = _toolData.url || result.url;
                            var _imgPrompt = toolArgs.prompt || toolArgs.text || '生图结果';
                            if (_imgUrl && typeof App !== 'undefined' && App.createImageCanvasNode) {
                                try { App.createImageCanvasNode(box, _imgUrl, _imgPrompt); } catch (e) { console.error('[imagenode]', e); }
                            }
                        } else if (toolName === 'video_gen' && _toolData) {
                            var _vidUrl = _toolData.video_url || _toolData.url || result.url;
                            var _vidPrompt = toolArgs.prompt || toolArgs.text || '视频结果';
                            if (_vidUrl && typeof App !== 'undefined' && App.createVideoCanvasNode) {
                                try { App.createVideoCanvasNode(box, _vidUrl, _vidPrompt); } catch (e) { console.error('[videonode]', e); }
                            }
                        }

                        // 显示工具卡片（终止型工具跳过，由 showTaskNotify 展示结果，避免重复）
                        // 【优化】若执行前已插占位卡，则原地替换，不再追加新卡
                        if (!Tools.isTerminal(toolName)) {
                            // 【防中途停止】结果卡渲染异常不冲出循环（否则同样会被总 catch 误判成网络错误后停止）
                            var _finalCardHtml = '';
                            try {
                                _finalCardHtml = Tools.renderToolCard(toolName, toolArgs, result);
                            } catch (_cardErr) {
                                console.error('[tool-card]', _cardErr);
                                try { Store.addLog('error', chat.id, 'tool-card', toolName + ' 结果卡渲染异常: ' + ((_cardErr && _cardErr.message) || _cardErr)); } catch (e2) {}
                                _finalCardHtml = '<div class="tool-wrap"><div class="tool-wrap__header">⚠ ' + String(toolName) + ' 结果渲染失败（执行结果已回传模型，循环继续）</div></div>';
                            }
                            var _replaced = false;
                            if (_pendingCardEl && _pendingCardEl.parentNode) {
                                try {
                                    var _tmp = document.createElement('div');
                                    _tmp.innerHTML = _finalCardHtml;
                                    var _newCard = _tmp.firstElementChild;
                                    _pendingCardEl.parentNode.replaceChild(_newCard, _pendingCardEl);
                                    // 重绑折叠事件（新节点无旧监听）
                                    try {
                                        var _wrap = (_newCard.classList && _newCard.classList.contains('tool-wrap')) ? _newCard : _newCard.querySelector('.tool-wrap');
                                        var _hdr = _newCard.querySelector('.tool-wrap__header');
                                        var _noCol = _wrap && _wrap.classList.contains('tool-wrap--nocollapse');
                                        if (_hdr && !_noCol) {
                                            _hdr.addEventListener('click', function(e) {
                                                e.stopPropagation();
                                                if (_wrap) _wrap.classList.toggle('tool-wrap--collapsed');
                                            });
                                        }
                                    } catch (_re) {}
                                    _replaced = true;
                                } catch (_re2) { console.error('[card-replace]', _re2); }
                            }
                            if (!_replaced) {
                                self.addToolCard(box, _finalCardHtml);
                            }
                        // 任务清单工具执行后，自动刷新右侧任务面板
                        if (toolName === 'task_list' && self.refreshTaskPanel) {
                            self.refreshTaskPanel();
                        }
                        }

                        // ===== 分类切换：更新对话框 UI =====
                        if (toolName === 'switch_tool_category' && result.success && result.category) {
                            var newCat = Tools.categories[result.category];
                            if (newCat) {
                                var catIconEl = box.querySelector('.tool-cat-icon');
                                var catNameEl = box.querySelector('.tool-cat-name');
                                if (catIconEl) catIconEl.textContent = newCat.icon;
                                if (catNameEl) catNameEl.textContent = '工具分类'; // 【固定文字】触发按钮固定显示，不再显示具体分类名
                                // Update menu active state
                                var catMenu = box.querySelector('.tool-cat-menu');
                                if (catMenu) {
                                    catMenu.querySelectorAll('.tool-cat-item').forEach(function(i) {
                                        i.classList.toggle('active', i.dataset.cat === result.category);
                                    });
                                }
                                Store.addLog('info', chat.id, 'cat-switch-ai', 'AI 自动切换工具分类: ' + result.category);

                                // ===== 分类切换提示框 + 声音 =====
                                var swToolList = newCat.tools.filter(function(t) { return t !== 'task_complete' && t !== 'switch_tool_category'; });
                                self.showCategorySwitchNotify({
                                    catName: result.category,
                                    catIcon: newCat.icon,
                                    catDesc: newCat.desc,
                                    toolCount: swToolList.length,
                                    chatId: chat.id
                                });
                                self.playSwitchSound();
                            }
                        }

                        // 持久化工具调用日志
                        Store.addMessage(chat.id, 'tool_call', toolName + ': ' + JSON.stringify(toolArgs), 'tool');
                        // 连击模式：工具执行成功 = 一次打击（失败不计入连击）
                        // 【修复】只有当前正在前台查看的对话才计连击；后台运行/关闭后继续跑的对话不再把暴击数刷爆
                        try {
                            var _isFront = true;
                            try { _isFront = !(window.App && typeof App.getCurrentChatId === 'function') || (App.getCurrentChatId() === chat.id); } catch (_ig) {}
                            if (result && result.success && _isFront && toolName !== 'task_complete') window.dispatchEvent(new CustomEvent('zf-combo-hit', { detail: { tool: toolName } })); // task_complete 的暴击由上方"任务完成额外暴击"单独派发，这里排除避免 +2
                        } catch (_ce) {}
                        // 工具球已在执行开始前塞过（见上方 _ttS），这里不再重复塞，避免一颗工具两颗球
                        Store.addLog('info', chat.id, 'tool-exec', toolName + ' → ' + (result.success ? 'success' : 'failure'));
                        // 记录读/搜目标（供步数预算注入的目标级重复检测用）
                        self._recordReadTarget(chat, toolName, toolArgs);

                        // ===== 工具结果出口限额（源头拦截：进上下文前截断超长结果，原文归档可找回） =====
                        if (typeof Tools !== 'undefined' && Tools.capResult) {
                            try { result = Tools.capResult(toolName, result); } catch (e) {}
                        }
                        // 【截断抢救提醒】write_file 参数截断被兜底写入时，落盘内容不完整，
                        // 必须明确告知模型文件是坏的，否则模型以为写入成功而跳过，留下损坏文件（如缺半截的 engine.js）。
                        if (toolArgsSalvaged && (toolName === 'write_file' || toolName === 'write')) {
                            result.warning = '⚠ 本次写入的文件内容因模型输出长度截断而不完整（抢救出的部分内容），'
                                + '文件很可能损坏。请立即 read_file 检查该文件，并用 replace_text / 分段写入补全缺失部分，再继续后续步骤。';
                            if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', 'write_file 抢救写入不完整文件，已提醒模型补全: ' + (toolArgs.path || ''));
                        }

                        // 将工具结果加入 messages（终止型工具的也会 push，但 return 后不会发给 AI）
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify(result)
                        });
                        // ===== 三档压缩：记录本轮任务的工具结果（截断为6000字，供下一轮压缩模式注入） =====
                        try {
                            if (!chat._curTaskToolResults) chat._curTaskToolResults = [];
                            chat._curTaskToolResults.push({ tool: toolName, content: String(JSON.stringify(result)).slice(0, 6000) });
                            // 【有界化】FIFO 上限 50 条：长任务工具调用成百上千次时无界增长，超出丢弃最旧
                            while (chat._curTaskToolResults.length > 50) chat._curTaskToolResults.shift();
                        } catch (e) {}
                    }

                    // ===== 【工具后插话即时注入 20261126·charlie】修复：wait(≤300s)/浏览器/跑命令等长工具
                    // 执行期间到达的用户插话，原要等下一轮循环开头才 drain（多耗一轮模型往返）。
                    // 现在本轮 tool_calls 全部结果 push 完后立即 drain 注入（顺序 assistant→tool*→user 合法）。
                    // 终止型工具后不 drain——留队列给下一轮开头，避免吞掉插话义务。
                    if (!(_terminalResult && Tools.isTerminal(_terminalToolName)) && !(lastResult && Tools.isTerminal(lastToolName))
                        && typeof InjectBus !== 'undefined' && InjectBus.size(chat) > 0) {
                        var _injItems2 = InjectBus.drain(chat);
                        for (var _ij2 = 0; _ij2 < _injItems2.length; _ij2++) {
                            messages.push({ role: 'user', content: '（用户插话·务必响应）' + _injItems2[_ij2].text });
                        }
                        try { Store.addLog('info', chat.id, 'inject-inject', '工具后即时插话注入 | 条数=' + _injItems2.length); } catch (e0i) {}
                    }

                    // ===== 刷新系统提示词（仅在分类切换时）=====
                    // 只有 AI 调用了 switch_tool_category 时才需要更新 system prompt
                    // 避免每轮都重建 messages[0]，保持前缀稳定以提高 API 缓存命中率
                    var _categoryChanged = false;
                    for (var _ci = 0; _ci < msg.tool_calls.length; _ci++) {
                        if (msg.tool_calls[_ci].function && msg.tool_calls[_ci].function.name === 'switch_tool_category') {
                            _categoryChanged = true;
                            break;
                        }
                    }
                    if (_categoryChanged) {
                        messages[0] = { role: 'system', content: Tools.getSystemPrompt(chat.id) };
                    }

                    // 如果是终止型工具，结束循环（复用已执行的结果，不重复执行）
                    // 【修复】优先取本轮内 task_complete 的结果：即使它不是最后一个工具调用也能正常终止并弹窗
                    var _termRes = _terminalResult || lastResult;
                    var _termName = _terminalToolName || lastToolName;
                    if (Tools.isTerminal(_termName) && _termRes) {
                        // ===== 自审闭环门禁 v2.2（SelfGate）：task_complete 拦截 =====
                        // 规则：最终消息必须含审核报告五部分（逐条核验/自我反驳/自我审视/问题定位/审核结论），
                        // 模糊表述黑名单直接判失败；不通过 → 清空终止态 + 注入自纠指令继续循环（无限自循环，无外部兜底）。
                        // 逃生阀：仅用户发送「selfGate:off」可关（「selfGate:on」恢复，持久于 chat._sgUserOff）；
                        // 模型参数不可关（执行器不透传 selfGate 字段，防模型自拆门禁）；连续 10 轮未过 → 提醒用户可介入。
                        try {
                            var _sgEnabled = !chat._sgUserOff;
                            if (_sgEnabled && _termName === 'task_complete' && window.SelfGate && typeof SelfGate.validate === 'function') {
                                if (!chat._sgRound) chat._sgRound = 0;           // 自审轮次（每任务重置）
                                if (!chat._sgReasonSig) chat._sgReasonSig = null; // 上轮拒绝原因签名（防打转）
                                if (!chat._sgSameSigCount) chat._sgSameSigCount = 0;
                                // 【P2-2】lite 分级已废除（SelfGate v3.1）：所有 task_complete 恒走 full 五部分严格门禁。
                                // 历史：原 lite 判定引用了从未定义的 _roundToolCalls（死代码），实际一直恒走 full；
                                // 勿按"本轮工具调用"维度恢复分级——多轮工程任务收尾轮常只剩只读工具，会被错误降级。
                                var _sgVerdict = SelfGate.validate(String(_termRes.message || ''));
                                if (!_sgVerdict.pass) {
                                    chat._sgRound++;
                                    // 防打转：拒绝原因签名相同连续 3 轮 → 本轮自纠指令强制换思路
                                    var _sig = (_sgVerdict.reasons || []).join('|').slice(0, 300);
                                    var _stuck = (chat._sgReasonSig === _sig);
                                    chat._sgSameSigCount = _stuck ? (chat._sgSameSigCount + 1) : 1;
                                    chat._sgReasonSig = _sig;
                                    var _retry = SelfGate.buildRetryInstruction(_sgVerdict, chat._sgRound, chat._sgSameSigCount >= 3);
                                    if (chat._sgRound >= 10) {
                                        _retry = '【自审门禁·第 ' + chat._sgRound + ' 轮】⚠️ 已连续 10 轮自审未通过。用户可发送「selfGate:off」立即关闭门禁（发送「selfGate:on」恢复），但门禁当前仍然生效，请实质性解决拒绝原因后再交付。\n' + _retry;
                                    }
                                    // S4 degraded 熔断（P1-2 收紧）：同签名连续 ≥5 轮纯格式拒绝，且被拒报告至少含
                                    // 「逐条核验清单+审核结论」两段（各≥10字，lite 最低线）→ 降级放行交付；
                                    // 零报告不放行，第 10 轮起强制兜底放行（防死循环；用户阀 selfGate:off 仍在）。
                                    // 【复验修复】原实现仅替换 _sgVerdict 即落穿到下方拒绝回填——"降级放行"从未真正
                                    // 发生（历史版本同样如此，放行日志是假的）：本轮补上真放行路径。
                                    var _sgDegradeOk = false;
                                    var _sgDegradeRelease = false;
                                    if (chat._sgSameSigCount >= 5 && _sgVerdict.reasons && _sgVerdict.reasons.every(function (r) { return /审核报告(过短|缺少|出现模糊)|不足 2 条|辅助线/.test(r); })) {
                                        try {
                                            var _dpMl = (window.SelfGate && SelfGate.parseReport) ? SelfGate.parseReport(String(_termRes.message || '')) : null;
                                            var _sgSectLen = function (key) {
                                                var _def = null;
                                                for (var _si = 0; _si < SelfGate.SECTIONS.length; _si++) { if (SelfGate.SECTIONS[_si].key === key) { _def = SelfGate.SECTIONS[_si]; break; } }
                                                var _body = (_dpMl && _dpMl.sections && _dpMl.sections[key]) || '';
                                                return _body.trim().replace(/^#+\s*/, '').replace(_def ? _def.title : '', '').trim().length;
                                            };
                                            _sgDegradeOk = !!_dpMl && _sgSectLen('checklist') >= 10 && _sgSectLen('verdict') >= 10;
                                        } catch (_eSgMl) { _sgDegradeOk = false; }
                                        if (_sgDegradeOk || chat._sgRound >= 10) {
                                            chat._sgDegraded = true; // 永久打标（本 chat 内可追溯）
                                            _sgDegradeRelease = true;
                                            try { Store.addLog('warn', chat.id, 'self-gate-degraded', '⚠️ 连续 ' + chat._sgSameSigCount + ' 轮同签名纯格式拒绝，熔断降级放行交付（最低线' + (_sgDegradeOk ? '已满足' : '未满足·第' + chat._sgRound + '轮强制兜底') + '；本 chat 已打标可回退）'); } catch (_eSgd) {}
                                            try { self.addMsg(box, '⚠️ 本任务经 ' + chat._sgRound + ' 轮仍未能产出完整合规审核报告，已降级放行（最低线：核验清单+审核结论；日志 self-gate-degraded）', 'notice', null, false, true); } catch (_eSgdM) {}
                                        }
                                        // 不满足最低线且未到 10 轮：不降级，走下方正常拒绝流程继续循环
                                    }
                                    if (_sgDegradeRelease) {
                                        // 真放行：不回填拒绝消息、不清终止态、lastToolName 保持非 self_gate，
                                        // 下方终止块照常交付本轮 task_complete 的 message（答案正文+未合规报告）；
                                        // 用户已收到上方降级警告行，日志 self-gate-degraded 可追溯。计数器清零（下一任务发送入口还会统一重置）。
                                        chat._sgRound = 0; chat._sgReasonSig = null; chat._sgSameSigCount = 0; chat._sgErrCount = 0;
                                    } else {
                                        // 回填拒绝消息（role=tool），清空终止态，循环继续
                                        messages.push({ role: 'tool', tool_call_id: _terminalTcId || 'selfgate', content: JSON.stringify({ success: false, selfGate: true, message: _retry }) });
                                        _terminalResult = null; _terminalToolName = null; _terminalTcId = null;
                                        lastResult = { success: false, selfGate: true, message: '自审门禁未通过（第 ' + chat._sgRound + ' 轮），已注入自纠指令，循环继续' };
                                        lastToolName = 'self_gate';
                                        try { Store.addLog('warn', chat.id, 'self-gate', '自审未通过第' + chat._sgRound + '轮: ' + ((_sgVerdict.reasons || []).join('; ') || '')); } catch (_eSGL) {}
                                        try { if (window.ZFKiteModes && ZFKiteModes.toolResult) ZFKiteModes.toolResult(chat.id, '自审门禁: 第' + chat._sgRound + '轮未通过，继续自纠', false); } catch (_eSGK) {}
                                    }
                                } else {
                                    chat._sgRound = 0; chat._sgReasonSig = null; chat._sgSameSigCount = 0; chat._sgErrCount = 0;  // 通过即清零（计数器另在发送入口随新任务重置，见 sendToModel）
                                    try { Store.addLog('info', chat.id, 'self-gate', '审核报告通过（' + ((_sgVerdict.score != null) ? _sgVerdict.score + '分' : '结构合格') + '），放行交付'); } catch (_eSGL2) {}
                                }
                            }
                        } catch (_eSG) {
                            // P1-1 fail-open 加界：异常放行必须留痕，连续 ≥2 次升级为用户可见警告（门禁正常通过即清零）
                            chat._sgErrCount = (chat._sgErrCount || 0) + 1;
                            console.warn('[self-gate] 门禁异常，降级放行:', _eSG);
                            try { Store.addLog('error', chat.id, 'self-gate-error', '门禁内部异常放行第' + chat._sgErrCount + '次: ' + ((_eSG && _eSG.message) || _eSG)); } catch (_eSgE1) {}
                            if (chat._sgErrCount >= 2) {
                                try { self.addMsg(box, '⚠️ 自审门禁连续 ' + chat._sgErrCount + ' 次内部异常，本轮未经审核放行（请检查浏览器控制台 self-gate 报错）', 'warning', null, false, true); } catch (_eSgE2) {}
                            }
                        }
                        // 拒绝时守卫：清空 _termRes，使下方终止块整体跳过，循环继续（自纠消息已回填）
                        if (lastToolName === 'self_gate') { _termRes = null; _terminalResult = null; _terminalToolName = null; }
                        // ===== 【v7.1 待命不脱网·终局义务门禁】协作窗 task_complete 终局前查义务 =====
                        // 用户令 2026-11-24「做完了也不能停止」「否则就真的停止很麻烦」：
                        // 协作窗（chat._collabTeam）终局前同步查 /api/plugin/collab/duties ——
                        // 组内还有我的义务（未回应插话/同伴未收口未登记待命）时：回填 role=tool、
                        // 清终止态、注入收尾协作指令继续循环；无义务 → 原样终局（老对话零影响）。
                        // 失败=无义务放行：门禁任何异常绝不拦死正常交付（对齐 self-gate fail-open 精神）。
                        try {
                            if (chat._collabTeam && _termName === 'task_complete' && !chat._stopped && !(_termRes && _termRes.success === false)) {
                                var _cbXhr = new XMLHttpRequest();
                                _cbXhr.open('GET', '/api/plugin/collab/duties?team=' + encodeURIComponent(String(chat._collabTeam)) + '&codename=' + encodeURIComponent(String(chat._collabCodename || '')), false);
                                _cbXhr.send(null);
                                var _cbData = null;
                                try { _cbData = JSON.parse(_cbXhr.responseText); } catch (_cbPe) {}
                                var _cbDuties = (_cbData && _cbData.ok && _cbData.duties) || [];
                                if (_cbDuties.length > 0) {
                                    var _cbLines = [];
                                    for (var _cbI = 0; _cbI < _cbDuties.length; _cbI++) {
                                        var _cbD = _cbDuties[_cbI];
                                        _cbLines.push(_cbD.kind === 'inject_ack'
                                            ? ('collab(action=ack, ref=' + _cbD.ref + ', text=收到+要点复诵) ← 回应 ' + _cbD.from + ' 的定向插话：' + (_cbD.text || '').slice(0, 150))
                                            : ('collab(action=standby) ← ' + (_cbD.note || '同伴未收口，登记待命保持在场')));
                                    }
                                    if (_terminalTcId) {
                                        messages.push({ role: 'tool', tool_call_id: _terminalTcId, content: JSON.stringify({ success: false, collabGate: true, message: 'task_complete 已暂缓：协作组内还有你未清的义务（' + _cbDuties.length + ' 条），清完义务后再次 task_complete。' }) });
                                    }
                                    messages.push({ role: 'user', content: '【协作收尾·务必响应】你属于协作组 ' + chat._collabTeam + '，终局前还有以下组内义务：\n' + _cbLines.join('\n') + '\n逐条处理完毕（义务全清）后再次调用 task_complete 收尾；若义务已失效（如插话话题已被后续消息覆盖），ack 说明情况即可。' });
                                    _terminalResult = null; _terminalToolName = null; _terminalTcId = null; _termRes = null;
                                    try { Store.addLog('info', chat.id, 'collab-terminal-gate', '终局义务门禁：' + _cbDuties.length + ' 条义务未清，继续循环（standby/ack 后放行）'); } catch (_cbL) {}
                                    try { self.addMsg(box, '🤝 收尾时协作组内还有义务（插话未回/同伴未收口），已注入收尾协作指令继续执行', 'notice', null, false, true); } catch (_cbM) {}
                                    self._agentLoop(box, chat, model, messages, depth + 1, null, 0, null, _myEpoch);
                                    return;
                                }
                            }
                        } catch (_cbE) { console.warn('[collab-terminal-gate] 义务查询失败，按无义务放行:', _cbE); }
                        // ===== 【v7.2 待命挂机·程序化值守】义务已清的可停协作窗不真停（用户令 2026-11-24「还是通过程序更好吧」）=====
                        // 上方义务门禁放行 = 无义务。程序在此自动 POST standby 登记待命（不靠模型自觉），
                        // 然后挂 _collabStandbyWatch 心跳（15s/次 GET duties）：同伴插话/未收口义务出现 → 自动拉起循环；
                        // v7.3 无义务且空闲达标时自动注入「自主进化」指令续命（用户令 2026-11-25 就寝：「任务完成后马上继续否则就停止了」），每周期上限 3 次防烧穿。
                        // 三重防失控：① chat._collabStandby===false（用户 standby:off 阀）不值守；
                        // ② 用户点停止/发新消息 → epoch 换代 + _stopped → 心跳醒来即自毁；
                        // ③ task_complete success=false（失败报告）或自审门禁拒绝（_termRes=null）不登记，正常重试/终局。
                        // 老对话零影响：非协作窗（无 _collabTeam）完全不走本分支。
                        try {
                            if (chat._collabTeam && _termName === 'task_complete' && _termRes && !(_termRes.success === false) && !chat._stopped && chat._collabStandby !== false) {
                                // 【v7.4 异步化 2026-11-25 bravo·alpha 移交单点】原同步 POST：服务端挂起时整页锁死在收尾时刻。
                                // 改异步：主流程不阻塞直接走终局块；回调内 ok 才登记值守+启心跳；失败/挂起静默降级为正常终局（不值守优于假值守）。
                                var _sbXhr = new XMLHttpRequest();
                                _sbXhr.open('POST', '/api/plugin/collab/standby', true);
                                _sbXhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
                                _sbXhr.onreadystatechange = function () {
                                    if (_sbXhr.readyState !== 4) return;
                                    if (chat._stopped) return;   // 回调延迟期内用户已点停止 → 放弃值守（心跳自身也有 epoch 自毁，双保险）
                                    var _sbData = null;
                                    try { _sbData = JSON.parse(_sbXhr.responseText); } catch (_sbPe) {}
                                    if (_sbData && _sbData.ok) {
                                        var _sbNow = Date.now();
                                        if (!chat._sbEvolveAt || _sbNow - chat._sbEvolveAt >= 3600000) { chat._sbEvolveCount = 0; chat._sbEvolveAt = 0; chat._sbEvolveBase = _sbNow; }   // v7.3 距上次自进化>=60分钟=新待命周期：配额归零，首次自进化基准=本次登记时刻
                                        if (!chat._sbEvolveBase) { chat._sbEvolveBase = _sbNow; }   // v7.3 首次 ever：以登记时刻为首个自进化基准（同周期内重复登记沿用旧基准）
                                        try { Store.addLog('info', chat.id, 'collab-standby', '已程序化登记待命，进入心跳值守（同伴插话将自动拉起本窗）'); } catch (_sbL) {}
                                        try { self.addMsg(box, '🛰️ 任务已交付，本窗转入协作待命值守（零消耗监听组内义务，同伴唤醒自动接活；用户发送 standby:off 退出值守）', 'notice', null, false, true); } catch (_sbM) {}
                                        self._collabStandbyWatch(chat, box);
                                    } else {
                                        try { console.warn('[collab-standby] 异步登记未确认，按正常终局（不值守）status=' + _sbXhr.status); } catch (_sbW) {}
                                    }
                                };
                                _sbXhr.send(JSON.stringify({ team: String(chat._collabTeam), codename: String(chat._collabCodename || '') }));
                            }
                        } catch (_sbE) { console.warn('[collab-standby] 自动待命失败，按正常终局:', _sbE); }
                        // 【修复 TypeError→误报网络异常 2026-10-18】自审门禁拒绝后 _termRes=null，
                        // 但下方终止块（L1968 String(_termRes.message) 等）并不在 try 内，直接抛
                        // "Cannot read properties of null (reading 'message')"，被外层 .catch 误判为
                        // 网络异常走重试。此处显式跳过终止块，直接继续循环。
                        if (!_termRes) {
                            try { Store.addLog('warn', chat.id, 'self-gate-skip', '门禁拒绝：跳过终止块，继续自纠循环 | depth=' + depth); } catch (_eSk) {}
                            if (!chat._stopped) {
                                self._agentLoop(box, chat, model, messages, depth + 1, null, 0, null, _myEpoch);
                            } else {
                                self._onSendComplete(box, chat);
                            }
                            return;
                        }
                        // ===== 【插话拦截】中途插话不补发：task_complete 时若 InjectBus 仍有未消费插话，
                        // 不允许收尾——注入插话继续循环（与 SelfGate 拒绝同模式），让插话在任务内被响应，
                        // 而不是落到终局 drainToQueueOnFinish 变成「📌插话补发」。仅当未点停止时生效。
                        if (typeof InjectBus !== 'undefined' && InjectBus.size && InjectBus.size(chat) > 0 && !chat._stopped) {
                            try {
                                var _tjItems = InjectBus.drain(chat);
                                for (var _tj = 0; _tj < _tjItems.length; _tj++) {
                                    messages.push({ role: 'user', content: '（用户插话·务必响应）' + _tjItems[_tj].text });
                                }
                                // 回填终止型工具结果（role=tool），保持 messages 合法，再清空终止态继续循环
                                if (_terminalTcId) {
                                    messages.push({ role: 'tool', tool_call_id: _terminalTcId, content: JSON.stringify({ success: true, deferred: true, message: 'task_complete 已暂缓：用户有中途插话待响应，请先处理插话，处理完毕后再次调用 task_complete 收尾。' }) });
                                }
                                _terminalResult = null; _terminalToolName = null; _terminalTcId = null; _termRes = null;
                                try { Store.addLog('info', chat.id, 'inject-terminal-intercept', '收尾拦截：' + _tjItems.length + ' 条插话在任务内注入继续循环（不补发）'); } catch (_eTjL) {}
                                try { self.addMsg(box, '⚡ 收尾时收到插话，已注入继续执行（不补发）', 'notice', null, false, true); } catch (_eTjM) {}
                                self._agentLoop(box, chat, model, messages, depth + 1, null, 0, null, _myEpoch);
                                return;
                            } catch (_eTj) { console.warn('[inject-terminal-intercept] 拦截失败，回退终局补发:', _eTj); }
                        }
                        // ===== 协作流水线动画：任务收尾自动插入（策划案触发时机，角色子窗≥2 且开关开启） =====
                        try {
                            if (window.PipelineAnimation && PipelineAnimation.maybeInject && !self._isRoleChat(box)) {
                                PipelineAnimation.maybeInject(chat.id);
                            }
                        } catch (_ePA) {}
                        // ===== 朗读助手：此处只暂存待读文本，真正朗读移到下方最终答案渲染完成后（读用户看到的全部文字） =====
                        // 【2026 修复】右下角"任务成功"弹窗提前+保护：原先排在统计写入/边框动画之后，
                        // 中间任何一步抛异常（DB.saveStats 等失败）都会跳过弹窗 → 表现为"弹窗没出来"。
                        // 现在放在终止块第一步，且 try/except 包裹，确保必弹。
                        // 【2026-11-12 子对话静默】成功时子对话不弹右下角成功提示（失败仍提醒）
                        var _nr = _termRes || {}; // 守卫：self_gate 拒绝时 _termRes 可能为 null，直接读 .success 会报错
                        var _subQuietNotify = _nr.success && self._isSubChat(box);
                        if (!_subQuietNotify) try {
                            self.showTaskNotify({
                                success: _nr.success,
                                message: _nr.message,
                                chatId: chat.id,
                                modelName: (chat.modelId && (Store.models || [])[chat.modelId] && (Store.models[chat.modelId] || {}).name) || (typeof model !== 'undefined' && model && model.name) || '',
                                scope: _nr.scope
                            });
                        } catch (_eNotify) { console.warn('[agent] showTaskNotify failed:', _eNotify); try { self.showTaskNotify({ success: _nr.success, message: _nr.message, chatId: chat.id, scope: _nr.scope }); } catch (_e2) {} }
                        // ===== AI 轻量自验收（git 双快照对比）=====
                        // 用户提问时已打起点快照（/api/self-check/start），此处终止时打终点快照并对比，
                        // 两快照必有差距 → 差距摘要即"轻验收"依据：与声称交付不符立即暴露。失败不阻塞交付。
                        // 【2026 修复】改为异步请求：原先同步 XHR 会冻结整个页面直到服务端 git 快照完成，
                        // 表现为"任务成功就卡死一阵"。现在先正常产出完成消息，自验收摘要稍后追加。
                        try {
                            var _scOn = true;
                            try { _scOn = (_termRes.selfCheck !== false) && !self._isRoleChat(box); } catch (_eSc0) {}
                            if (_scOn) {
                                fetch('/api/self-check/finish', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ chatId: String(chat.id || ''), action: 'finish' })
                                }).then(function (_r) { return _r.ok ? _r.json() : null; }).then(function (_scData) {
                                    if (!_scData || !_scData.message) return;
                                    var _scMsg = String(_scData.message);
                                    Store.addLog('info', chat.id, 'self-check', _scMsg);
                                    var _scFull = '[自验收] ' + _scMsg;
                                    try {
                                        if (box.id) {
                                            Store.addMessage(box.id, 'assistant', _scFull, 'final', chat.modelId, (Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) || null);
                                        }
                                    } catch (_eScP) {}
                                    // A 方案：不另发新消息，把自验收行并入最后一条 ai-final 答案气泡内（视觉上与答案挨着）
                                    try {
                                        var _scBody = box.querySelector('.chatbox-body');
                                        var _scFinals = _scBody ? _scBody.querySelectorAll('.msg.ai-final') : null;
                                        var _scTarget = (_scFinals && _scFinals.length) ? _scFinals[_scFinals.length - 1] : null;
                                        if (_scTarget) {
                                            var _scDiv = document.createElement('div');
                                            _scDiv.className = 'self-check-inline md-body';
                                            // 修复：自验收结果走 Markdown 渲染（含自验收表格样式），不再用纯文本 textContent
                                            try { _scDiv.innerHTML = self.renderMarkdown ? self.renderMarkdown(_scFull) : App._escapeHtml(_scFull); }
                                            catch (_eScR) { _scDiv.textContent = _scFull; }
                                            _scTarget.appendChild(_scDiv);
                                            if (_scTarget._refreshViewAnswerBtn || self._refreshViewAnswerBtn) { try { self._refreshViewAnswerBtn(_scTarget); } catch (_e2) {} }
                                        } else {
                                            // 兜底：找不到答案气泡才单独发一条
                                            try { self.addMsg(box, _scFull, 'ai', chat.modelId, true, true); } catch (_eScA) {}
                                        }
                                    } catch (_eScM) {
                                        try { self.addMsg(box, _scFull, 'ai', chat.modelId, true, true); } catch (_eScA2) {}
                                    }
                                    // ===== P2-3 矛盾质询闭环：声称改了文件（本任务触碰过写类工具）但 git 快照零改动
                                    // = 自验收与声称矛盾。不再只追加 advisory 行——注入质询继续循环让模型核实
                                    // （走继续轮机制重开一轮；每任务至多 2 次，防与门禁互相顶牛成双死循环）。=====
                                    try {
                                        var _scZeroDiff = /无改动|无差距|零改动|没有(任何)?改动/.test(_scMsg);
                                        if (_scZeroDiff && _termRes && _termRes.success && chat._taskTouchedWriteTools
                                            && !chat._stopped && !chat.isSending && (chat._scChallengeCount || 0) < 2) {
                                            chat._scChallengeCount = (chat._scChallengeCount || 0) + 1;
                                            var _scChallenge = '（系统自验收质询·第' + chat._scChallengeCount + '/2次）你声称完成了文件改动，但 git 双快照对比为零改动。请核实改动是否真的落盘（可能写错路径/被回退/写进了非伺服副本），先实际检查文件现状，再用 task_complete 重新交付：要么附上真实改动证据，要么如实说明改动未落盘的原因。';
                                            chat.history.push({ role: 'user', content: _scChallenge, _verifyRound: true, _continueRound: true });
                                            chat._verifyActive = true;
                                            chat._verifyBubbleShown = false;
                                            try { Store.addLog('warn', chat.id, 'self-check-challenge', '自验收矛盾质询：声称有改动但快照零改动，已注入质询继续核验（第' + chat._scChallengeCount + '/2次）'); } catch (_eScC1) {}
                                            try { self.addMsg(box, '⚠️ 自验收发现矛盾：声称改了文件但快照零改动，已注入质询继续核验（' + chat._scChallengeCount + '/2）', 'notice', null, false, true); } catch (_eScC2) {}
                                            setTimeout(function() { if (!chat._stopped) self.sendToModel(box, chat); }, 600);
                                        }
                                    } catch (_eScCh) { console.warn('[self-check-challenge] 质询注入失败，保持 advisory 行为:', _eScCh); }
                                }).catch(function (_eScN) { console.warn('[agent] self-check finish failed:', _eScN); });
                            }
                        } catch (_eSc) { console.warn('[agent] self-check finish failed:', _eSc); }
// ===== 前缀去重（代码级兜底）：模型 message 自带“✅ 任务完成/❌ 任务失败”时先剥离，避免与 summaryPrefix 叠加显示两次 =====
                        var _rawMsg = self._stripFakeToolTags(String(_termRes.message || ''));
                        var _msgLines = _rawMsg.split('\n');
                        var _firstLine = (_msgLines[0] || '').trim();
                        var _prefixStripped = false;
                        // 情况A：整行恰好是“✅ 任务完成/❌ 任务失败”等（可带括号备注/收尾标点）→ 剥掉整行
                        if (/^[\s#*]*(?:✅|❌)?[\s#*]*(?:任务完成|任务成功|任务失败)(?:[（(][^（）()]{0,20}[）)])?[\s#*]*(?:✅|❌)?[\s#:：。！!？?]*$/.test(_firstLine)) {
                            _msgLines.shift();
                            _prefixStripped = true;
                        } else {
                            // 情况B：首行形如“✅ 任务完成：实际内容”（前缀+分隔符+内容同一行）→ 只剥前缀，保留内容
                            var _pmB = _firstLine.match(/^[\s#*]*(?:✅|❌)[\s#*]*(?:任务完成|任务成功|任务失败)(?:[（(][^（）()]{0,20}[）)])?[\s#*]*(?:✅|❌)?[\s:：\-—–|｜、]*\s*(.+)$/);
                            // 情况C：无 emoji 但以“任务完成：”等开头（要求冒号分隔，避免误伤“任务完成的文件”等正常句子）
                            var _pmC = (!_pmB) ? _firstLine.match(/^(?:任务完成|任务成功|任务失败)(?:[（(][^（）()]{0,20}[）)])?\s*[:：]\s*(.+)$/) : null;
                            var _pm = _pmB || _pmC;
                            if (_pm) {
                                var _rest = (_pm[1] || '').trim();
                                if (_rest) {
                                    _msgLines[0] = _rest;
                                } else {
                                    _msgLines.shift();
                                }
                                _prefixStripped = true;
                            }
                        }
                        if (_prefixStripped) {
                            while (_msgLines.length && !(_msgLines[0] || '').trim()) _msgLines.shift();
                            _termRes.message = _msgLines.join('\n');
                        }
                        // 【P2-4 可观测性】degraded 降级放行的交付：最终消息尾部带永久标记（随 history 持久，
                        // 用户与事后审核都能直接看到这次交付未经完整审核）
                        if (chat._sgDegraded) {
                            _termRes.message += '\n\n⚠️ 本次交付经自审门禁降级放行（未能产出完整合规审核报告，review_score 已扣 20 分；详见日志 self-gate-degraded）。';
                        }
                        // 移除残留的 typing 指示器（防止计时器继续运行）
                        var _typingElsTerm = box.querySelectorAll('.msg.typing');
                        _typingElsTerm.forEach(function(t) { t.remove(); });
                        // 计算任务总耗时
                        var _taskTotalMs = chat._taskStartTime ? (Date.now() - chat._taskStartTime) : 0;
                        var _taskTotalStr = self._formatDuration(_taskTotalMs);
                        Store.addLog(_termRes.success ? 'info' : 'warn', chat.id, 'terminal', _termName + ' → ' + (_termRes.success ? '任务完成' : '任务失败') + ': ' + _termRes.message + ' | 总耗时: ' + _taskTotalStr);
                        // 对话完成率：每个终止任务只写一条成功/失败记录。
                        // [强化A4 2026-10-16] 审核分数生产者：从本会话最后一条 AI 自评气泡解析
                        //   【自评】准确度/完整度/置信度，归一化为 0-100 质量分，随 task_complete
                        //   上报 reviewScore 字段，激活后端 api_dispatch_post 日常审核回流钩子。
                        //   与 agent-06 徽章同源（扫同一 .msg.ai-final），无自评块则不触发（零侵入）。
                        var _reviewScore = 0;
                        try {
                            // 从 history 取最后一条含【自评】的 assistant 原始文本
                            // （不经 agent-06 DOM 剥离，稳健且无时序依赖）。
                            var _rsTxt = '';
                            var _hist = (chat.history || []);
                            for (var _hi = _hist.length - 1; _hi >= 0; _hi--) {
                                var _hm = _hist[_hi];
                                if (_hm && _hm.role === 'assistant') {
                                    _rsTxt = (typeof _hm.content === 'string')
                                        ? _hm.content : JSON.stringify(_hm.content || '');
                                    if (_rsTxt.indexOf('【自评】') > -1) break;
                                }
                            }
                            if (_rsTxt.indexOf('【自评】') > -1) {
                                var _aM = _rsTxt.match(/准确度\s*(\d+)\s*\/\s*10/);
                                var _cM = _rsTxt.match(/完整度\s*(\d+)\s*\/\s*10/);
                                var _fM = _rsTxt.match(/置信度\s*(\d+)\s*%/);
                                // [修复D1虚假分隐患 2026-10-16] 三项必须全部命中才计分；
                                //   任一字段缺失即整体不报分（宁可不报，绝不用默认值造分）。
                                //   生效前提：自评块由 chat_pool inject_instruction 注入（走对话池托管路径），
                                //   且 chat.history 存的是含【自评】原文（未经 strip_blocks 剥离）。
                                if (_aM && _cM && _fM) {
                                    var _a = Math.min(10, +_aM[1]);
                                    var _c = Math.min(10, +_cM[1]);
                                    var _cf = Math.min(100, +_fM[1]);
                                    // 归一化 0-100：准确 40% + 完整 40% + 置信 20%
                                    _reviewScore = Math.round(_a * 4 + _c * 4 + _cf * 0.2);
                                }
                            }
                        } catch (eRS) { /* 静默：解析失败不影响任务终止 */ }
                        if (typeof DB !== 'undefined' && typeof DB.saveStats === 'function') {
                            // 【P2-4 可观测性】degraded 降级放行的交付：review_score 强制 -20（下限 0）+ 降级标记，
                            // 让日常审核回流（api_dispatch_post 钩子消费 review_score）能区分"正常过门"与"降级过门"
                            var _sgPenalized = !!chat._sgDegraded;
                            var _finalReviewScore = _sgPenalized ? Math.max(0, _reviewScore - 20) : _reviewScore;
                            DB.saveStats(chat.id, {
                                success: _termRes.success,
                                task_title: String(_termRes.message || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                                tokens: chat._sessionTotalTokens || 0,
                                api_calls: chat._sessionTotalApiCalls || 0,
                                duration: _taskTotalMs / 1000,
                                review_score: _finalReviewScore,
                                self_gate_degraded: _sgPenalized
                            });
                        }

                        // 1) 对话框边框变色，并保存结果供小地图持续导航。
                        // ===== 结果验证轮：验证轮的成功显示为「二次验证成功」，颜色用金色区分普通绿色 =====
                        // _continueRound：继续轮复用 _verifyActive 机制但不属于验证，不算二次验证成功
                        var _lastUserMsg = (function(){ for (var i = chat.history.length - 1; i >= 0; i--) { if (chat.history[i] && chat.history[i].role === 'user') return chat.history[i]; } return null; })();
                        // 【2026 修复】增加 chat._roundWasVerify 快照判定：验证轮进行中用户插入新消息/守卫注入
                        // 导致 _verifyActive 被提前清除时，任务完成仍按验证轮显示金色，不再漏判成普通绿色
                        var _isVerifySuccess = !!(_termRes.success && (chat._roundWasVerify || chat._verifyRoundActive || (chat._verifyActive && (chat._verifyRoundActive || (_lastUserMsg && _lastUserMsg._verifyRound && !_lastUserMsg._continueRound)))));
                        var borderCls = _termRes.success ? (_isVerifySuccess ? 'task-verify-success' : 'task-success') : 'task-fail';
                        chat._taskStatus = _termRes.success ? 'success' : 'fail';
                        // 【工具计数】任务成功后数字清零
                        if (_termRes.success) { chat._toolUseCount = 0; chat._waterEst = 0; }
                        box.classList.add(borderCls);
                        // 同步：右下角小地图导航也显示边框动画
                        var _minimap = document.getElementById('minimap');
                        if (_minimap) {
                            _minimap.classList.remove('task-success', 'task-fail');
                            _minimap.classList.add(borderCls);
                        }
                        // 边框动画结束后恢复；chat._taskStatus 保留给小地图导航。
                        setTimeout(function() {
                            box.classList.remove(borderCls);
                            if (_minimap) { _minimap.classList.remove(borderCls); }
                            if (self.updateMinimap) self.updateMinimap();
                        }, 4000);
                        if (self.updateMinimap) self.updateMinimap();
                        if (self._updateAllNavArrows) self._updateAllNavArrows(); // 立即刷新成功指示箭头
                        // 立即同步：风筝龙该节颜色（金黄=成功 / 暗红=失败）——不依赖 RAF 下一帧
                        if (window.KiteDragon && window.KiteDragon.refresh) { try { window.KiteDragon.refresh(); } catch (e) {} }

                        // 2) 右下角通知弹窗：已在终止块第一步（showTaskNotify 提前+保护）弹出，此处不再重复调用
                        // 3) 声音提示
                        // 4) 结束总结：持久化保存并进 history，同时在对话框中显示（此前只弹 toast，对话框看不到）
                        // ===== 结果验证轮：显示「✅ 二次验证成功」并带醒目标记，区别于普通「✅ 任务完成」 =====
                        var summaryPrefix = _isVerifySuccess
                            ? "\u2705\u2705 \u4e8c\u6b21\u9a8c\u8bc1\u6210\u529f \uff5c \u672c\u4efb\u52a1\u5df2\u901a\u8fc7\u9a8c\u8bc1\u5ba1\u67e5\n\n"
                            : (_termRes.success ? "\u2705 任务完成\n\n" : "\u274C 任务失败\n\n");
                        // 【查看答案优化】整理最终消息：答案正文在前、审核报告折叠在 <details> 里；
                        // 若 message 里没有正文（全是报告），自动补一条引导语，避免「查看答案」只见报告不见答案
                        var _finalBody = self._formatFinalMessage(_termRes.message);
                        chat.history.push({ role: "assistant", content: summaryPrefix + _finalBody });
                        try {
                            if (box.id) {
                                Store.addMessage(box.id, 'assistant', summaryPrefix + _finalBody, 'final', chat.modelId, (Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) || null);
                            }
                        } catch (e) { console.warn('[Agent] task summary persistence failed:', e); }
                        self.addMsg(box, summaryPrefix + _finalBody, 'ai', chat.modelId, true, true); // 已手动持久化，skipSave 防重复写库
                        // ===== 朗读助手：最终答案已完整渲染后朗读「用户看到的全部文字」 =====
                        // （摘要前缀的任务完成/失败标记、审核报告五部分均不读；只读给人看的答案正文）
                        if (_ttsPending && window.TTS && TTS.isEnabled()) {
                            try {
                                var _ttsFull = String(_termRes.message || (_termRes.success !== false ? '任务完成' : '任务失败'));
                                var _ttsIdx = _ttsFull.indexOf('—— 审核报告 ——');
                                if (_ttsIdx > 0) _ttsFull = _ttsFull.slice(0, _ttsIdx);
                                TTS.speak(_ttsFull);
                            } catch (e) {}
                            _ttsPending = false;
                        }
                        // ===== 结果验证轮：给最终消息气泡加金色「已验证」标记条 =====
                        if (_isVerifySuccess) {
                            var _verifyMsgEl = box.querySelector('.chatbox-body .msg.ai-final:last-child');
                            if (_verifyMsgEl) {
                                _verifyMsgEl.classList.add('ai-verified');
                                var _vBadge = document.createElement('div');
                                _vBadge.className = 'verify-badge';
                                _vBadge.innerHTML = '\u2713 \u5df2\u4e8c\u6b21\u9a8c\u8bc1';
                                _verifyMsgEl.insertBefore(_vBadge, _verifyMsgEl.firstChild);
                            }
                        }
                        // ===== 验证成功后：「结果验证」行的「2 验证」按钮变为金色「✓ 已验证」并禁用（renderCompressSelector 之后还需再执行一次，因其会重建该行） =====
                        if (_isVerifySuccess) { self._markVerifyButton(box); try { chat._verifiedOnce = true; } catch(e){} }
                        if (!_termRes.success || !self._isRoleChat(box)) {
                            // 【2026-11-12 子对话静默】成功时子对话不放提示音（失败仍响），只有主对话才响
                            if (!(_termRes.success && self._isSubChat(box))) self.playTaskSound(_termRes.success);
                        }

                        // 5) 【已移除】「⏱ 本任务总耗时」行：下方状态条已有 34秒/34秒 等时间信息，避免重复

                        // ===== 三档压缩：任务完成后显示下一轮压缩档位选择器 =====
                        self.renderCompressSelector(box, chat);
                        // 验证成功：renderCompressSelector 会重建「结果验证」行，重建后再标一次「✓ 已验证」
                        if (_isVerifySuccess) self._markVerifyButton(box);


                        
                        // ===== 自动邮件通知（任务成功时） =====
                        if (_termRes.success) {
                            self._sendEmailNotify(_termRes.message, model.name, chat.id);
                        }

                        // 清空工具结果存档（任务结束，不再需要）
                        if (typeof Tools !== 'undefined' && Tools.toolResultArchive) {
                            delete Tools.toolResultArchive[chat.id];
                        }

                        self._onSendComplete(box, chat);
                        return;
                    }

                    // 递归调用，继续 Agent 循环（如果用户已停止则不递归）
                    if (!chat._stopped) {
                        self._agentLoop(box, chat, model, messages, depth + 1, null, 0, null, _myEpoch);
                    } else {
                        self._onSendComplete(box, chat);
                    }
                    return;
                }

                // 情况2：AI 返回普通文本
                // 成功获得回复，重置截断重试状态
                chat._truncRetryCount = 0;
                delete chat._maxTokensOverride;
                var reply = '';
                if (msg.content) {
                    reply = msg.content;
                } else if (choice.text) {
                    reply = choice.text;
                } else if (res.data.output_text) {
                    reply = res.data.output_text;
                } else if (msg.reasoning_content || msg.reasoning || msg.thinking) {
                    // content 为空但有思考内容（GLM 思考模式边缘情况）
                    reply = (msg.reasoning_content || msg.reasoning || msg.thinking);
                } else {
                    reply = '（空回复）';
                }
                reply = (reply || '').trim() || '（空回复）';
                // ===== 纯文本收尾拦截（P0-1/F1）：任务已触碰写/执行类工具，模型却不调 task_complete 直接回文字
                // = 遗漏审核交付（自审门禁只挂在 task_complete 上，此路径原本零审核放行）。拦截 3 轮上限知情放行。=====
                try {
                    if (chat._taskTouchedWriteTools && !chat._stopped) {
                        chat._sgTextBypassCount = (chat._sgTextBypassCount || 0) + 1;
                        if (chat._sgTextBypassCount < 3) {
                            var _typingElsTb = box.querySelectorAll('.msg.typing');
                            _typingElsTb.forEach(function(t) { t.remove(); });
                            if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                            chat._realStreamDiv = null;
                            // 本轮文字按工具轮思考文本处理：展示 + 存档（_thinking 标记，重建上下文时过滤），最终答案以 task_complete 交付为准
                            var _tbText = self._stripFakeToolTags(reply);
                            if (_tbText) {
                                self.addMsgStreaming(box, _tbText, 'ai', chat.modelId);
                                chat.history.push({ role: 'assistant', content: _tbText, _thinking: true });
                            }
                            messages.push({ role: 'assistant', content: _tbText || '' });
                            messages.push({ role: 'user', content: '[系统提示] 你的任务已执行过写/执行类工具（工作区可能已有改动），但你没有调用 task_complete 交付。请立即调用 task_complete 收尾，并按五部分格式附完整审核报告；若任务确实无法完成，用 task_complete(success=false) 说明卡点。不要只回复纯文本。' });
                            try { Store.addLog('warn', chat.id, 'self-gate-text-bypass', '纯文本收尾拦截第' + chat._sgTextBypassCount + '/3轮（任务已触碰写类工具），已注入收尾指令继续循环'); } catch (_eTbL) {}
                            self._agentLoop(box, chat, model, messages, depth + 1, null, 0, null, _myEpoch);
                            return;
                        }
                        // 连续 3 轮硬不调 task_complete → 知情放行：照常交付 + 用户可见警告 + 日志留痕
                        reply += '\n\n⚠️ 本任务连续 3 轮未按规范调用 task_complete，已按纯文本交付（未走自审门禁，日志 self-gate-text-bypass 可查）。';
                        try { Store.addLog('warn', chat.id, 'self-gate-text-bypass', '连续3轮纯文本收尾，知情放行交付'); } catch (_eTbL2) {}
                    }
                } catch (_eTb) { console.warn('[text-bypass] 拦截异常，按原样交付:', _eTb); }
                // 检测输出被截断（max_tokens 不足导致 finish_reason=length，但仍有部分 content）
                if (choice.finish_reason === 'length' || res.data._truncated) {
                    reply += '\n\n⚠ **[输出被截断]** AI 回复因达到最大输出 token 上限被截断，可能内容不完整。如需完整回复请发送"继续"。';
                    Store.addLog('warn', chat.id, 'truncated', 'AI 输出因 finish_reason=length 被截断（有部分 content），max_tokens=' + (payload.max_tokens || model.maxTokens || 8192));
                }
                // 显示回复前移除 typing 指示器
                var _typingEls = box.querySelectorAll('.msg.typing');
                _typingEls.forEach(function(t) { t.remove(); });
                // 【星号残留修复】真实流式阶段用 textContent 显示原始 markdown（**未渲染），
                // 最终回复渲染前必须移除流式占位 div，否则带星号的原文永久留在页面上。
                if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                chat._realStreamDiv = null;
                self.addMsgStreaming(box, reply, 'ai', chat.modelId, true, function() {
                    self._onSendComplete(box, chat);
                });
                // ===== 三档压缩：纯文本回复结束同样显示档位选择器（保证每轮都出现） =====
                try { self.renderCompressSelector(box, chat); } catch (e) {}
                chat.history.push({ role: 'assistant', content: reply });
                Store.addLog('info', chat.id, 'ai-reply', 'AI回复 | ' + reply.length + '字 | ' + reply.substring(0, 80) + (reply.length > 80 ? '…' : ''));

            }).catch(function(err) {
                // 统一清洗底层网络/SSL 错误，避免把英文运行时异常直接展示给用户
                var _catchErrorMsg = _translateApiError(0, (err && err.message) || err);
                // 【星号残留修复】错误路径也要清掉流式占位 div，否则带星号的原文会残留在页面上
                if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                chat._realStreamDiv = null;
                // 移除所有 typing 指示器
                var _typingEls3 = box.querySelectorAll('.msg.typing');
                _typingEls3.forEach(function(t) { t.remove(); });
                // 【2025 修复】只有 chat._stopped=true 才视为用户主动停止。
                // 仅凭 AbortError 判定会把内部超时/db.js 旧版 300 秒 abort 误判为用户停止，
                // 导致对话静默终止（无提示、无重试、无日志）——正是「对话自动停止」的根因之一。
                var _isUserAbort = !!chat._stopped;
                if (_isUserAbort) {
                    // 用户停止 - stopSending() 已显示消息并处理排队
                    // 如果 _onSendComplete 尚未被调用（防止遗漏），调用一次
                    if (!chat._sendCompleteCalled) {
                        self._onSendComplete(box, chat);
                    }
                } else if ((chat._epoch || 0) !== _myEpoch) {
                    // 【代次守卫 2026-09-10】本循环已被新消息/停止换代取代：静默退出——
                    // 不渲染错误、不重试、不触碰发送状态（新代次拥有本框生命周期）。
                    // 否则老循环收尾会把 isSending/abortController/队列按新循环的脸重置，打断新消息。
                    Store.addLog('info', chat.id, 'loop-epoch-stale', '老代次循环让位退出（catch）| depth=' + depth);
                } else if (err && err._poolSuperseded) {
                    // 【让位 2026-09-10】本 Turn 已被同框更新的 Turn 取代（新消息/新循环已接管本框）：
                    // 安静退出、绝不重试。旧行为把它当"意外错误"走重试，铸出新 Turn 反杀新消息
                    // 的 Turn → 两条循环互相收割的死亡风暴（cb222 事故 22:21-22:28 实锤：
                    // 16 个 Turn 链式互杀、每个只活 3~10 秒）。
                    Store.addLog('info', chat.id, 'pool-superseded', '让位退出：本Turn已被更新的Turn取代 | depth=' + depth);
                    if (!chat._sendCompleteCalled) {
                        self._onSendComplete(box, chat);
                    }
                } else if (err && err._poolCancelled) {
                    // 【2026-10 修复】pool 权威取消（服务端已把本 Turn 判为 cancelled）：
                    // 等同用户停止语义——安静收尾，绝不重试。旧 bug：排队续发复位 chat._stopped 后，
                    // 该 AbortError 落入下面的「意外中止→自动重试」分支，重投同一个已死的 _poolTurnId，
                    // 命中 cancelled 终态再次秒抛 AbortError → abort-unexpected 每 3s 刷一次、depth 固定的空转死循环。
                    Store.addLog('info', chat.id, 'pool-cancelled-quiet', 'pool 权威取消，安静收尾（不重试死 Turn）| depth=' + depth);
                    if (!chat._sendCompleteCalled) {
                        self._onSendComplete(box, chat);
                    }
                } else if (err && err.name === 'AbortError' && !chat._stopped) {
                    // 非用户触发的 AbortError（本地内部超时等）：明确提示并走重试
                    try { err.message = '请求被中断（疑似超时），将自动重试'; } catch(e) {}
                    Store.addLog('error', chat.id, 'abort-unexpected', 'AbortError without user stop | depth=' + depth + ' | ' + _catchErrorMsg);
                    chat._retryStatusTotal = (chat._retryStatusTotal || 0) + 1;
                    _upsertRetryStatus(box, chat, '⚠ ' + _catchErrorMsg + '，将自动重试…');
                    if (retryCount >= MAX_RETRY) {
                        _clearRetryStatus(chat); // 【降噪 20261123】清状态行换最终失败结论
                        self.addMsg(box, '❌ 已重试 ' + MAX_RETRY + ' 次仍失败，请检查网络连接或 API 服务后手动重试。\n\n失败原因：' + _friendlyErrMsg(_catchErrorMsg), 'error');
                        self._onSendComplete(box, chat);
                        return;
                    }
                    retryCount++;
                    setTimeout(function() {
                        self._agentLoop(box, chat, model, messages, depth, retryCount, retryRound, _poolTurnId, _myEpoch);
                    }, _jitterMs(RETRY_INTERVAL));
                } else if (!chat._stopped) {
                    // ===== 余额耗尽（402）：不可恢复错误，直接停止，绝不重试 =====
                    if (/balance exhausted/i.test(_catchErrorMsg)) {
                        var _typingElsBal = box.querySelectorAll('.msg.typing');
                        _typingElsBal.forEach(function(t) { t.remove(); });
                        var _balDiv = self.addMsg(box, '💰 AI Token 余额已耗尽（402），无法继续对话。请充值后重试（不自动重试，避免空耗）。', 'error');
                        try {
                            var _balBtn = document.createElement('button');
                            _balBtn.className = 'btn-recharge';
                            _balBtn.innerHTML = '💳 前往充值';
                            _balBtn.title = '打开 AI Token 充值页面';
                            _balBtn.style.cssText = 'margin-top:8px;padding:6px 16px;border:none;border-radius:8px;background:linear-gradient(135deg,#f59e0b,#f97316);color:#fff;font-size:13px;font-weight:600;cursor:pointer;';
                            _balBtn.addEventListener('click', function(ev) { ev.stopPropagation(); window.open('https://www.zf3d.com/airecharge.asp', '_blank'); });
                            _balDiv.appendChild(_balBtn);
                        } catch (e) {}
                        Store.addLog('error', chat.id, 'balance-exhausted', _catchErrorMsg);
                        self._onSendComplete(box, chat);
                        return;
                    }
                    // ===== 网络异常自动重试（catch 分支：连接超时、DNS解析失败等）=====
                    if (retryCount >= MAX_RETRY) {
                        if (retryRound + 1 < MAX_RETRY_ROUNDS) {
                            var _nextRound2 = retryRound + 1;
                            _upsertRetryStatus(box, chat, '⚠ 本轮网络异常重试 ' + MAX_RETRY + ' 次仍失败，5分钟后开始第' + (_nextRound2 + 1) + '/' + MAX_RETRY_ROUNDS + '轮重试…');
                            Store.addLog('warn', chat.id, 'retry-round-wait', 'wait 300s before catch retry round ' + (_nextRound2 + 1) + '/' + MAX_RETRY_ROUNDS);
                            setTimeout(function() { self._agentLoop(box, chat, model, messages, depth, 0, _nextRound2, _poolTurnId, _myEpoch); }, RETRY_ROUND_INTERVAL);
                            return;
                        }
                        var _typingElsFinal = box.querySelectorAll('.msg.typing');
                        _typingElsFinal.forEach(function(t) { t.remove(); });
                        _clearRetryStatus(chat); // 【降噪 20261123】清状态行换最终失败结论
                        self.addMsg(box, '❌ 已完成 ' + MAX_RETRY_ROUNDS + ' 轮重试（每轮 ' + MAX_RETRY + ' 次）仍失败，请检查网络连接或 API 服务后手动重试。\n\n失败原因：' + _friendlyErrMsg(_catchErrorMsg), 'error');
                        Store.addLog('error', chat.id, 'proxy-error', _catchErrorMsg + ' (retried ' + MAX_RETRY_ROUNDS + ' rounds)');
                        self._onSendComplete(box, chat);
                        return;
                    } else {
                        retryCount++;
                    }
                    // ===== 无响应超时专项处理（根除「对话自动停止」死亡螺旋）=====
                    var _isProxyTimeout = !!(err && err._proxyTimeout);
                    chat._retryStatusTotal = (chat._retryStatusTotal || 0) + 1;
                    var _waitMs = _jitterMs(RETRY_INTERVAL); // 【抖动 20261123】普通网络错误同样抖动错峰
                    if (_isProxyTimeout) {
                        chat._proxyTimeoutCount = (chat._proxyTimeoutCount || 0) + 1;
                        // 超时重试退避 10s/20s/.../60s：给拥堵的上游喘息，避免重试风暴叠加（乘 0.7~1.3 抖动错峰）
                        _waitMs = _jitterMs(Math.min(60000, 10000 * retryCount));
                        // 连续超时≥2 且本任务还没重建过：原样重发同一个超大 payload 只会再超时，
                        // 改走 400 同款上下文重建（过滤冗余工具/思考消息 + 恢复指令），payload 变小、响应变快
                        if ((chat._proxyTimeoutCount >= 2) && !chat._timeoutRebuilt) {
                            chat._timeoutRebuilt = true;
                            try {
                                var _cleanMsgsTO = [{ role: 'system', content: Tools.getSystemPrompt(chat.id) }].concat(self._buildContext(chat.history, model, chat));
                                // 【缓存优化】走会话内快照（只读，不触发生成），与正常发送路径内容一致
                                var _pmTO = self._stableProjMemo(chat);
                                if (_pmTO) _cleanMsgsTO.splice(1, 0, { role: 'system', content: '【项目背景记忆】' + _pmTO });
                                _cleanMsgsTO.push({ role: 'user', content: '（系统自动恢复：上一次请求因响应超时被中断，以上是有效对话记录。请继续完成刚才未完成的任务，已完成的部分不要重复执行。）' });
                                messages.length = 0;
                                for (var _toi = 0; _toi < _cleanMsgsTO.length; _toi++) messages.push(_cleanMsgsTO[_toi]);
                                Store.addLog('warn', chat.id, 'timeout-rebuild', 'proxy timeout x' + chat._proxyTimeoutCount + ' → rebuild clean context (' + _cleanMsgsTO.length + ' msgs)');
                            } catch (e) {}
                        }
                    }
                    var _retryMsg2 = '⚠ 网络异常（' + _friendlyErrMsg(_catchErrorMsg) + '），' + Math.round(_waitMs / 1000) + '秒后自动重试…（第' + retryCount + '/' + MAX_RETRY + '次，第' + (retryRound + 1) + '/' + MAX_RETRY_ROUNDS + '轮）' + ((_isProxyTimeout && chat._timeoutRebuilt) ? '【已重建精简上下文】' : '');
                    var _typingEls7 = box.querySelectorAll('.msg.typing');
                    _typingEls7.forEach(function(t) { t.remove(); });
                    // 【降噪 20261123】重试状态原地更新一行（不落库），不再每次尝试新增一行刷屏
                    _upsertRetryStatus(box, chat, _retryMsg2);
                    Store.addLog('warn', chat.id, 'retry', 'retry(catch) ' + retryCount + '/' + MAX_RETRY + ' | ' + _catchErrorMsg);
                    setTimeout(function() {
                        self._agentLoop(box, chat, model, messages, depth, retryCount, retryRound, _poolTurnId, _myEpoch);
                    }, _waitMs);
                } else {
                    // 重试次数用尽
                    var _typingEls8 = box.querySelectorAll('.msg.typing');
                    _typingEls8.forEach(function(t) { t.remove(); });
                    _clearRetryStatus(chat); // 【降噪 20261123】清状态行换最终失败结论
                    if (retryCount >= MAX_RETRY) {
                        self.addMsg(box, '❌ 已重试 ' + MAX_RETRY + ' 次仍失败，请检查网络连接或 API 服务后手动重试。\n\n失败原因：' + _friendlyErrMsg(_catchErrorMsg), 'error');
                    } else {
                        self.addMsg(box, '代理请求失败：' + _friendlyErrMsg(_catchErrorMsg), 'error');
                    }
                    Store.addLog('error', chat.id, 'proxy-error', _catchErrorMsg + (retryCount > 0 ? ' (retried ' + retryCount + 'x)' : ''));
                    self._onSendComplete(box, chat);
                }
            });
        },

    // ===== 验证成功后：把「结果验证」行的「2 验证」按钮变为金色「✓ 已验证」并禁用 =====
    // 注意：renderCompressSelector 每次会重建该行，所以需在其执行后再次调用本方法
    _markVerifyButton: function(box) {
        try {
            // 定位操作按钮行：以「撤销」按钮为锚点（按钮重排后已无「结果验证：」标签；早期版本叫「撤销本步」，兼容两者）
            box.querySelectorAll('button').forEach(function(_b) {
                if (_b.textContent.trim() === '撤销' || _b.textContent.trim() === '撤销本步') {
                    var _row = _b.closest('div');
                    if (_row) {
                        _row.querySelectorAll('button').forEach(function(_b2) {
                            // 只改任务「验证」按钮本身；跳过已改名的「查看验证」和「客观验证」按钮，否则会把「客观验证」也改名造成重复
                            var _t = _b2.textContent.trim();
                            if (_t === '验证' || _t === '2 验证' || (_t.indexOf('验证') >= 0 && _t !== '客观验证' && _b2._actionId === 'verify')) {
                                _b2.textContent = '查看验证';
                                _b2.disabled = false;
                                _b2.style.borderColor = 'rgba(255,200,80,.65)';
                                _b2.style.color = '#ffd76a';
                                _b2.style.background = 'rgba(255,200,80,.12)';
                                _b2.style.cursor = 'pointer';
                                _b2.title = '点击查看二次验证结果（滚动到已验证的最终答案位置）';
                                // 点击按钮滚动到已验证的最终答案位置
                                if (!_b2._viewVerifyBound) {
                                    _b2._viewVerifyBound = true;
                                    _b2.addEventListener('click', function(e) {
                                        e.stopPropagation();
                                        try {
                                            var _body = box.querySelector('.chatbox-body');
                                            if (!_body) return;
                                            var _btnRowTop = 0; try { _btnRowTop = (_b2.closest('div') || _b2).getBoundingClientRect().top; } catch (_e2) {}
                                            var _cand = null;
                                            _body.querySelectorAll('.msg.ai-final.ai-verified').forEach(function(_m) {
                                                // 取按钮上方（或最近）的那条已验证消息，而不是全页第一条
                                                if (!_cand) { _cand = _m; return; }
                                                var _dOld = Math.abs(_m.getBoundingClientRect().top - _btnRowTop);
                                                var _dCur = Math.abs(_cand.getBoundingClientRect().top - _btnRowTop);
                                                // 优先取按钮上方最近的；若都在按钮下方则取最靠上的
                                                if ((_m.getBoundingClientRect().top <= _btnRowTop) === (_cand.getBoundingClientRect().top <= _btnRowTop)) {
                                                    if (_dOld < _dCur) _cand = _m;
                                                } else if (_m.getBoundingClientRect().top <= _btnRowTop) {
                                                    _cand = _m;
                                                }
                                            });
                                            var _finalEl = _cand || _body.querySelector('.msg.ai-final.ai-verified') || _body.querySelector('.msg.ai-final:last-of-type') || _body.querySelector('.msg.ai-final:last-child');
                                            if (!_finalEl) return;
                                            // 计算 _finalEl 相对滚动容器 .chatbox-body 的真实位置（offsetTop 可能相对其他 offsetParent，不可靠）
                                            var _bTop = _body.getBoundingClientRect().top;
                                            var _elTop = _finalEl.getBoundingClientRect().top - _bTop + _body.scrollTop;
                                            var _elH = _finalEl.getBoundingClientRect().height;
                                            var _viewH = _body.clientHeight;
                                            // 若消息块比视口高（任务完成标记在块末尾），对齐块底部；否则对齐块顶部并留出 90px 余量
                                            var _top;
                                            if (_elH > _viewH - 100) {
                                                _top = _elTop + _elH - _viewH + 20;
                                            } else {
                                                _top = _elTop - 90;
                                            }
                                            if (_top < 0) _top = 0;
                                            var _maxTop = _body.scrollHeight - _viewH;
                                            if (_top > _maxTop) _top = _maxTop;
                                            _body.scrollTo({ top: _top, behavior: 'smooth' });
                                        } catch (_e) { console.warn('[Agent] scroll to verify result failed:', _e); }
                                    });
                                }
                            }
                        });
                    }
                }
            });
        } catch (e) { console.warn('[Agent] verify button update failed:', e); }
    },

    // ===== 【v7.2 待命挂机·心跳值守】协作窗终局后的程序化值班（bravo 2026-11-24）=====
    // 终局自动登记 standby 后挂本心跳：5s/次查 duties（纯本机 XHR，零 token 消耗）。
    // 【基建提速 20261125 bravo】15s→5s：义务发现延迟÷3，同伴插话唤醒更快接住。
    // 纯本机请求无网络成本；注释里 tick 基准 8 tick=首等 2 分钟、40 tick=间隔 10 分钟同步改为 24/120 tick。
    // 无义务 → 续班；有义务（同伴 inject 我/同伴未收口）→ 注入唤醒指令拉起循环，本值守自毁
    // （新循环终局时终局门禁/自动待命会重新接管）。防失控守卫见函数头注释。
    _collabStandbyWatch: function (chat, box) {
        var self = this;
        var _sbEpoch = (chat._epoch || 0);
        chat._collabStandby = true;
        var _tick = function () {
            // 守卫1：身份没了 / 用户阀 standby:off / 用户点停止 / 发了新消息（代次换代）→ 撤哨自毁
            if (!chat || !chat._collabTeam || chat._collabStandby === false ||
                chat._stopped || (chat._epoch || 0) !== _sbEpoch) {
                chat._collabStandby = false;
                return;
            }
            // 守卫2：循环正在跑（用户插话已触发新轮）→ 不打扰，续班
            if (chat.isSending) { setTimeout(_tick, 5000); return; }
            var _xhr = new XMLHttpRequest();
            try {
                _xhr.open('GET', '/api/plugin/collab/duties?team=' + encodeURIComponent(String(chat._collabTeam)) +
                    '&codename=' + encodeURIComponent(String(chat._collabCodename || '')), false);
                _xhr.send(null);
                var _data = null;
                try { _data = JSON.parse(_xhr.responseText); } catch (_pe) {}
                var _duties = (_data && _data.ok && _data.duties) || [];
                if (_duties.length > 0) {
                    // 有新义务 → 拉起循环处理（注入唤醒指令，模式对齐 monitor 协作唤醒链）
                    chat._collabStandby = false;
                    var _lines = [];
                    for (var _si = 0; _si < _duties.length; _si++) {
                        var _sd = _duties[_si];
                        _lines.push(_sd.kind === 'inject_ack'
                            ? ('collab(action=ack, ref=' + _sd.ref + ', text=收到+要点复诵) ← 回应 ' + _sd.from + ' 的定向插话：' + (_sd.text || '').slice(0, 150))
                            : ('collab(action=standby) ← ' + (_sd.note || '同伴未收口，处理完毕后重新登记待命')));
                    }
                    var _wake = '【协作唤醒·务必响应】你是协作组 ' + chat._collabTeam + ' 的 ' + (chat._collabCodename || '') +
                        '，任务已交付、当前处于待命值守状态，但组内出现了你的新义务：\n' + _lines.join('\n') +
                        '\n逐条处理；处理完再次 task_complete，程序会自动重新登记待命继续值守（用户可发送 standby:off 退出值守）。';
                    self.addMsg(box, _wake, 'user', chat.modelId);
                    chat.history.push({ role: 'user', content: _wake });
                    try { Store.addLog('info', chat.id, 'collab-standby-wake', '待命心跳发现义务 ' + _duties.length + ' 条，自动拉起循环'); } catch (_wl) {}
                    chat._stopped = false;
                    self.sendToModel(chat.el, chat);
                    return;   // 本值守自毁：新循环终局后由终局门禁/自动待命重新接管
                }
                // ===== 【v7.3 空闲自进化续命】无义务且空闲达标 → 注入自主进化指令拉起新循环 =====
                // 用户令 2026-11-25（就寝）：「任务完成后要马上继续否则就停止了」。
                // 防烧穿四闸：①每周期上限 3 次（chat._sbEvolveCount，登记待命时按 60 分钟无活动才重置）；
                // ②首次等 2 分钟（24 tick，留互审/收尾窗口）、后续间隔 10 分钟（120 tick）防高频空转；
                // ③义务优先：有义务走上方拉起，自进化只在完全空闲时；④守卫1/2 照常生效（阀off/停止/换代/isSending 都不触发，用户 standby:off 一键关闭）。
                var _evoNow = Date.now();
                var _evoCnt = chat._sbEvolveCount || 0;
                var _evoBase = chat._sbEvolveBase || _evoNow;   // v7.3 基准=登记待命时刻（登记处已写入，此处仅兜底）；留互审窗口
                var _evoGap = _evoCnt === 0 ? 120000 : 600000;
                if (_evoCnt < 3 && (_evoNow - _evoBase) >= _evoGap) {
                    chat._sbEvolveCount = _evoCnt + 1;
                    chat._sbEvolveAt = _evoNow;
                    chat._collabStandby = false;
                    var _evoMsg = '【自主进化·值守续命·第' + chat._sbEvolveCount + '/3次】用户已就寝并留令（2026-11-25）：「任务完成后要马上继续，否则就停止了」——你被授权在无人值守期间自主进化。本轮请：①从项目记录（继承卡/课题池/调查黑板）或当前系统真实痛点里认领一项可落地、可验证的实质改进（代码修复/功能补全/文档治理/健康巡检均可，优先小而实）；②动手做完并实测验证，git 精确暂存提交（禁 add -A）；③若确无可做之事，做一次轻量巡检（HTTP 健康/工作区状态/同伴状态）并 project_record 留痕；④正常 task_complete 收尾（写清做了什么+证据），值守心跳会再次接管。红线：不做危险写操作、不删数据、不冒领同伴工作、同一问题不重复调查。';
                    self.addMsg(box, _evoMsg, 'user', chat.modelId);
                    chat.history.push({ role: 'user', content: _evoMsg });
                    try { Store.addLog('info', chat.id, 'collab-standby-evolve', '待命空闲自进化触发（第' + chat._sbEvolveCount + '/3次，间隔阈值' + Math.round(_evoGap / 1000) + 's）'); } catch (_elE) {}
                    chat._stopped = false;
                    self.sendToModel(chat.el, chat);
                    return;   // 本值守自毁：自进化新循环终局后由终局门禁/自动待命重新接管（配额按 60 分钟规则重置）
                }
            } catch (_e) { /* 网络抖动：本轮跳过，下轮再查 */ }
            setTimeout(_tick, 5000);
        };
        setTimeout(_tick, 5000);
    },
});
