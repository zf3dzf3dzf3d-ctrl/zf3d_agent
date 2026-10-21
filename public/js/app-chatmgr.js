// ========== app-chatmgr.js - 对话管理 + 小地图更新 ==========
Object.assign(App, {
        // ===== 对话管理工具（供 Tools.execute 调用） =====
        chatManage: function(args, callerId) {
            var self = this;
            args = args || {};
            var action = args.action || 'list';
            // 【跨对话指挥链 G2】身份打通：callerId = 发起本条命令的对话 id（由 tools-04-execute 透传 executionChatId）。
            //   兜底：若上游没透传（如宏/流水线直接调用），退回当前活跃对话 currentChatId。
            //   供 close self 与审核归属判定使用；解析后挂到 args._callerId 供各分支共享。
            var _cid = callerId || self.currentChatId || '';
            args._callerId = _cid;
            self._lastCallerId = _cid;

            if (action === 'list') {
                // 列出所有对话框
                var boxes = self.chatBoxes.map(function(c) {
                    var title = c.el.querySelector('.title') ? c.el.querySelector('.title').textContent : '';
                    return {
                        id: c.id,
                        title: title,
                        modelId: c.modelId || '',
                        isSending: !!c.isSending,
                        historyLen: c.history.length,
                        queueLen: c.queue.length
                    };
                });
                var msg = '当前共有 ' + boxes.length + ' 个对话：\n';
                boxes.forEach(function(b, i) {
                    msg += (i+1) + '. [' + b.id + '] ' + b.title + ' | 模型: ' + (b.modelId || '未选择模型') + ' | 历史: ' + b.historyLen + '条' + (b.isSending ? ' | 发送中' : '') + '\n';
                });
                return { success: true, message: msg, tool: 'chat_manage', data: { boxes: boxes } };
            }

            if (action === 'create') {
                // 新建对话
                var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
                var cRect = canvas.getBoundingClientRect();
                // 如果有现成对话，在最近的右边偏移创建；否则在画布中心
                var lastBox = self.chatBoxes[self.chatBoxes.length - 1];
                var posX, posY;
                // 鼠标位置优先（记录自全局 mousemove），仅 AI 工具调用未指定坐标时使用
                var _m = (typeof window.__zfLastMouse === 'object' && window.__zfLastMouse) ? window.__zfLastMouse : null;
                if (typeof args.x === 'number' && typeof args.y === 'number') {
                    posX = args.x;
                    posY = args.y;
                } else if (_m && typeof _m.clientX === 'number' && typeof _m.clientY === 'number' && (_m.clientX > 0 || _m.clientY > 0)) {
                    // 换算为画布坐标（画布可能被 transform 平移/缩放）
                    var _tf = getComputedStyle(canvas).transform;
                    var _parts = (_tf && _tf !== 'none') ? _tf.match(/matrix\(([^)]+)\)/) : null;
                    var _vals = _parts ? _parts[1].split(',').map(parseFloat) : null;
                    // 优先取 matrix(a,b,c,d,e,f) 中的 a/d；非等比缩放时取几何均值兜底
                    var _scale = 1;
                    if (_vals && _vals.length >= 4 && isFinite(_vals[0]) && isFinite(_vals[3]) && _vals[0] && _vals[3]) {
                        _scale = (_vals[0] === _vals[3]) ? _vals[0] : Math.sqrt(Math.abs(_vals[0] * _vals[3]));
                    }
                    posX = (_m.clientX - cRect.left) / _scale;
                    posY = (_m.clientY - cRect.top) / _scale;
                } else if (lastBox && lastBox.el) {
                    posX = parseInt(lastBox.el.style.left) + 60;
                    posY = parseInt(lastBox.el.style.top) + 40;
                } else {
                    // 画布可见区域左上角
                    posX = Math.max(10, -cRect.left + 100);
                    posY = Math.max(10, -cRect.top + 60);
                }
                // 防散落保护：若目标位置离所有现有窗口都超过3000px（说明坐标异常/画布曾在坏状态下），
                // 改为跟随最靠右的窗口创建，避免新窗口被放到荒地导致"会话分家"
                if (self.chatBoxes.length > 0) {
                    var minDist = Infinity;
                    var rightBox = null, rightX = -Infinity;
                    self.chatBoxes.forEach(function(c) {
                        if (!c.el) return;
                        var bx = parseFloat(c.el.style.left) || 0;
                        var by = parseFloat(c.el.style.top) || 0;
                        var d = Math.max(Math.abs(bx - posX), Math.abs(by - posY));
                        if (d < minDist) minDist = d;
                        if (bx > rightX) { rightX = bx; rightBox = c; }
                    });
                    if (minDist > 3000 && rightBox && rightBox.el) {
                        console.warn('[ChatManage] 检测到新窗口位置异常（离群 ' + Math.round(minDist) + 'px），已自动吸附到主群右侧');
                        posX = (parseFloat(rightBox.el.style.left) || 0) + 60;
                        posY = (parseFloat(rightBox.el.style.top) || 0) + 40;
                    }
                }
                // 转换为客户端坐标
                var clientX = posX + cRect.left;
                var clientY = posY + cRect.top;
                // 模型ID：优先用参数指定的，其次用户习惯（上次选择），最后用最后一个对话的模型
                var modelId = args.model_id;
                if (!modelId) {
                    try {
                        var _hbit = (window.UserSettings && UserSettings.get) ? UserSettings.get('lastModelSelection', null) : null;
                        if (_hbit && _hbit.modelId && Models.get(_hbit.modelId)) modelId = _hbit.modelId;
                    } catch (e) {}
                }
                if (!modelId) modelId = lastBox ? lastBox.modelId : null;

                var chat = self.createChatBox(clientX, clientY, modelId);
                if (!chat) {
                    return { success: false, message: '创建对话失败', tool: 'chat_manage' };
                }

                // 如果 auto_send=true 且有 message，自动发送
                if (args.auto_send && args.message) {
                    var input = chat.el.querySelector('textarea');
                    if (input) {
                        input.value = args.message;
                    }
                    // 模拟发送流程
                    self.addMsg(chat.el, args.message, 'user', chat.modelId);
                    self.showQueryPin(chat.el, args.message);
                    self.updateChatTitle(chat.el, args.message);
                    chat.history.push({ role: 'user', content: args.message });
                    Store.addLog('info', chat.id, 'send', 'chat_manage 自动发送消息');
                    self.sendToModel(chat.el, chat);
                }

                return {
                    success: true,
                    message: '已新建对话 [' + chat.id + ']，模型: ' + (modelId || '未选择模型') + (args.auto_send && args.message ? '，已自动发送消息' : ''),
                    tool: 'chat_manage',
                    data: { chat_id: chat.id }
                };
            }

            if (action === 'wait') {
                // 【指挥链 G1】异步等待目标对话空闲（返回 Promise，不冻结页面）
                var wChat = self.findChat ? self.findChat(args.chat_id) : null;
                if (!wChat) return { success: false, message: 'wait 未找到对话 [' + args.chat_id + ']', tool: 'chat_manage' };
                return self._asyncWaitIdle(wChat, {
                    timeoutMs: args.timeout_ms, idleForMs: args.idle_for_ms,
                    requireReply: args.require_reply, checkQueue: args.check_queue
                });
            }

            if (action === 'review') {
                // 【指挥链 G3】给目标对话派 N 个客观审核窗（复用审核员派单内核 _objectiveVerify）
                var rvChat = self.findChat ? self.findChat(args.chat_id) : null;
                if (!rvChat) return { success: false, message: 'review 未找到对话 [' + args.chat_id + ']', tool: 'chat_manage' };
                if (rvChat.isSending) return { success: false, message: '目标对话 [' + rvChat.id + '] 还在回复中：review 前必须先 wait 等它说完', tool: 'chat_manage' };
                if (typeof App._objectiveVerify !== 'function' || typeof App._objectiveVerifySend !== 'function') {
                    return { success: false, message: '当前页面缺少审核员自动派单能力（App._objectiveVerify 不可用），无法执行 review', tool: 'chat_manage' };
                }
                var rvCount = Math.max(1, Math.min(parseInt(args.count) || 2, 5));
                var rvAuto = (args.gather !== false);
                // 【回收凭证必须在建 pair 之前写入】verify-arrow:431 派单时读凭证给 pair 打 autoloop=true
                //   ⚠️ 写入基准必须是 Date.now()（与真源 agent-01-project-memory.js:1174 同源，过去时间戳）。
                //      曾写 Date.now()+180000（未来时间戳）：autoGatherOn()（verify-arrow:106 判 (now-t)<600000）
                //      有效期虽仍成立，但 tryGroupAutoGather 的 1 秒防抖 :908 `if (t - ts < 1000) return;`
                //      对 ts>now 恒为真（负数）→ 凭证污染期内（约3分钟）所有「非 autoloop」配对分组回收
                //      被整体跳过，连与指挥链无关的用户手动派单自动回收也被阻断（跨功能副作用）。
                //      延长有效期不该靠凭证时间戳，autoloop 配对本就由 autoLoopGather 独立接管（不依赖凭证）。
                try { window._zfAutoGatherNext = rvAuto ? Date.now() : 0; } catch (eG) {}
                // 【批次起点】本次派单的时间下界；review_wait 用 pair._createdAt >= 它 过滤，
                //   排除目标对话上「历史遗留、与本次派单无关」的审核配对（否则误判/空转到超时）
                var _rvBatchStart = Date.now();
                // 【批次凭证】供 review_wait 默认识别"最近一次指挥链派单"（同对话才生效）
                try { window._zfLastReviewBatch = { chatId: String(rvChat.id), ts: _rvBatchStart, count: rvCount }; } catch (eB) {}
                var _pairsBefore = 0;
                // 【复审残余①修正】"派完即走"(wait_for_pairs=false) 的捷径判据必须与派单同源：
                //   原实现用「全局 pair 总数增长」，他对话在本轮 10s 轮询窗口内建箭头会误触发提前结束。
                //   改为只统计 srcId === 本目标对话 的 pair 数（不含批次时间过滤，保持原"有新建即走"语义）。
                try { var _VA0 = (typeof ZFVerifyArrow !== 'undefined' && ZFVerifyArrow.getPairs) ? ZFVerifyArrow : (window.ZFVerifyArrow || null); var _pb0 = _VA0 && _VA0.getPairs ? _VA0.getPairs() : []; for (var _pbI = 0; _pbI < _pb0.length; _pbI++) { if (String(_pb0[_pbI].srcId) === String(rvChat.id)) _pairsBefore++; } } catch (e) {}
                for (var _ri = 0; _ri < rvCount; _ri++) {
                    // 错峰 600ms：防同帧连续建窗被限流/渲染互踩（沿用菜单批量派单节奏）
                    //   ⚠️ setTimeout 第二实参（延时 ms）绝不能省：省了等于全部 0ms 同帧建窗，注释成空话
                    setTimeout((function (c, box, chat, opts) { return function () {
                        try { App._objectiveVerify({ el: chat.el }, chat, opts); } catch (e) {
                            try { if (chat && chat.messages) chat.messages.push({ role: 'assistant', content: '⚠️ 自动派审核失败（' + (e && e.message || e) + '），请改用菜单手动派单' }); } catch (e2) {}
                        }
                    }; })(_ri, App, rvChat, { gather: rvAuto }), _ri * 600);
                }
                var rvWait = args.wait_for_pairs !== false;
                return new Promise(function (resolve) {
                    var _t0 = Date.now(), _hit = 0;
                    var _tk = setInterval(function () {
                        try {
                            var _VAr = (typeof ZFVerifyArrow !== 'undefined' && ZFVerifyArrow.getPairs) ? ZFVerifyArrow : (window.ZFVerifyArrow || null);
                            var ps = _VAr && _VAr.getPairs ? _VAr.getPairs() : [];
                            _hit = 0;
                            var _tgtAll = 0; // 【复审残余①】本目标对话的 pair 总数（不做批次过滤），供"派完即走"捷径同源比对
                            // 【打回②修正】只统计「本批次新建」的 pair（_createdAt >= 批次起点，
                            //   该字段由 verify-arrow:419 建 pair 时必写），排除目标对话上历史遗留的旧审核，
                            //   否则还没真建窗就把旧 pair 计入 _hit → 误报"已建 N 个"
                            for (var i = 0; i < ps.length; i++) {
                                if (String(ps[i].srcId) !== String(rvChat.id)) continue;
                                _tgtAll++;
                                if (!(ps[i]._createdAt > 0 && ps[i]._createdAt < _rvBatchStart)) _hit++;
                            }
                            var done = _hit >= rvCount || (Date.now() - _t0 > 10000);
                            if (!rvWait && _tgtAll > _pairsBefore) done = true;
                            if (!done) return;
                            clearInterval(_tk);
                            resolve({
                                success: _hit >= rvCount,
                                tool: 'chat_manage',
                                message: '目标对话 [' + rvChat.id + '] 审核窗：已建 ' + _hit + '/' + rvCount + ' 个' +
                                    (_hit >= rvCount ? '，回收凭证已挂 ' + rvAuto + '，后续用 review_wait 取结论' : '（部分审核窗可能被闸门拦截：同一对话未审轮数硬顶 2、高分自动收口；也可能页面缺少派单能力——请改用菜单手动派单）'),
                                data: { chat_id: rvChat.id, pairs_created: _hit, pairs_before: _pairsBefore, requested: rvCount, gather: rvAuto, batch_start: _rvBatchStart }
                            });
                        } catch (eT) { clearInterval(_tk); resolve({ success: false, message: 'review 轮询异常: ' + (eT && eT.message || eT), tool: 'chat_manage' }); }
                    }, 400);
                });
            }

            if (action === 'review_wait') {
                // 【指挥链 G4】轮询审核配对直至出结论（事件方案不可行：zf-autoloop-done 全项目 0 监听者）
                var rwChatId = args.chat_id || '';
                var rwTimeout = Math.min(Math.max(parseInt(args.timeout_ms) || 600000, 5000), 720000);
                return new Promise(function (resolve) {
                    var _t0 = Date.now();
                    var _tk = setInterval(function () {
                        try {
                            var _VA = (typeof ZFVerifyArrow !== 'undefined' && ZFVerifyArrow.getPairs) ? ZFVerifyArrow : (window.ZFVerifyArrow || null);
                            var ps = _VA && _VA.getPairs ? _VA.getPairs() : [];
                            // 【打回②修正·批次隔离】batch_start 优先取调用方显式传入（review 返回的
                            //   data.batch_start），缺省回落 window._zfLastReviewBatch（仅同对话才生效），
                            //   两者都没有才退回旧行为（按 srcId 全量）。避免把历史遗留审核配对误当本次结论。
                            var _bs = parseInt(args.batch_start);
                            if (isNaN(_bs)) {
                                _bs = 0;
                                try {
                                    var _lb = window._zfLastReviewBatch;
                                    if (_lb && String(_lb.chatId) === String(rwChatId) && _lb.ts > 0) _bs = _lb.ts;
                                } catch (eBS) {}
                            }
                            var mine = [], staleCnt = 0;
                            for (var i = 0; i < ps.length; i++) {
                                if (String(ps[i].srcId) !== String(rwChatId)) continue;
                                if (_bs && ps[i]._createdAt > 0 && ps[i]._createdAt < _bs) { staleCnt++; continue; }
                                mine.push(ps[i]);
                            }
                            if (mine.length === 0) {
                                if (Date.now() - _t0 > rwTimeout) {
                                    clearInterval(_tk);
                                    resolve({ success: false, tool: 'chat_manage', message: 'review_wait 超时：目标 [' + rwChatId + '] 在本批次（batch_start=' + (_bs || '未指定') + '）内没有任何审核配对' + (staleCnt ? '；该对话上有 ' + staleCnt + ' 个历史遗留配对已被批次隔离排除——请确认是否漏传 review 返回的 data.batch_start' : '（可能还没 review，或箭头已被回收清理）'), data: { chat_id: rwChatId, batch_start: _bs, stale_pairs_excluded: staleCnt, elapsed_ms: Date.now() - _t0 } });
                                }
                                return;
                            }
                            // 【打回②附加·结论态可提前回报】passed=通过；revising/modified=已出结论但要求返工
                            //   （即本轮不通过）；suspended=护栏挂起；failed=失败 —— 都属"审核已给结论"，
                            //   不该再空等到超时（原逻辑只认 passed/suspended，FAIL 场景必然耗满 720s）。
                            //   仍在等结论的是 pending/reviewing。原终态集合里的 'done' 在 STATUS 枚举中不存在，已删。
                            var DECIDED = { passed: 1, revising: 1, modified: 1, suspended: 1, failed: 1 };
                            var allDone = mine.every(function (p) { return !!DECIDED[p.status]; });
                            if (!allDone) {
                                if (Date.now() - _t0 > rwTimeout) {
                                    clearInterval(_tk);
                                    resolve({ success: false, tool: 'chat_manage', message: 'review_wait 超时（' + rwTimeout + 'ms）：仍有审核未出结论（pending/reviewing）', data: { chat_id: rwChatId, batch_start: _bs, pairs: mine, stale_pairs_excluded: staleCnt, elapsed_ms: Date.now() - _t0 } });
                                }
                                return;
                            }
                            clearInterval(_tk);
                            var hist = [], lastExcerpt = '';
                            // 【批次隔离同源】评分轨迹直接取本批次配对的 scoreHistory（getScoreHistory(srcId)
                            //   返回的是"该源对话第一个匹配 pair"的历史，批次隔离后会误读旧审核分数）
                            for (var hi = 0; hi < mine.length; hi++) {
                                var _sh = mine[hi] && mine[hi].scoreHistory;
                                if (_sh && _sh.length) hist = hist.concat(_sh);
                            }
                            var _qc0 = self.findChat ? self.findChat(mine[0].qcId) : null;
                            if (_qc0) { try { lastExcerpt = self._chainLastAssistant(_qc0, parseInt(args.excerpt_chars) || 300); } catch (eL) {} }
                            var _scores = hist.map(function (h) { return h && h.score; }).filter(function (v) { return typeof v === 'number'; });
                            var _passLine = self._chainPassLine(args.pass_score);
                            var _passedAll = mine.every(function (p) { return p.status === 'passed'; });
                            var _needRework = mine.filter(function (p) { return p.status === 'revising' || p.status === 'modified' || p.status === 'failed'; });
                            resolve({
                                success: _passedAll, tool: 'chat_manage',
                                message: '审核完成：本批次 ' + mine.length + ' 个审核窗' + (_bs ? '（batch_start=' + _bs + (staleCnt ? '，已排除历史遗留 ' + staleCnt + ' 个' : '') + '）' : '') +
                                    '，全部通过=' + _passedAll +
                                    (_scores.length ? '，最低分 ' + Math.min.apply(null, _scores) + '（通过线 ' + _passLine + '）' : '') +
                                    (_needRework.length ? '；⚠️ ' + _needRework.length + ' 个审核要求返工/未通过（revising/modified/failed），已提前回报不再空等' : '') +
                                    (_needRework.length && mine.some(function (p) { return p.autoloop; }) ? '；ℹ️ 本批次存在 autoloop 自驱动闭环（收口→回注→原对话改完→自动复审，见 verify-arrow:1107/696），若走自动重审请再次 review_wait（沿用同一 batch_start）取终局 passed，勿拿到返工态就直接关链' : '') +
                                    (mine.some(function (p) { return p.status === 'suspended'; }) ? '；⚠️ 有审核被护栏挂起（suspended，指纹重复/轮数硬顶），需人工介入' : ''),
                                data: {
                                    chat_id: rwChatId, batch_start: _bs, stale_pairs_excluded: staleCnt,
                                    pairs: mine, score_history: hist, pass_line: _passLine,
                                    min_score: _scores.length ? Math.min.apply(null, _scores) : null,
                                    passed_all: _passedAll, need_rework: _needRework.length,
                                    // 【复审残余②】本批次是否有 autoloop 自驱动闭环在跑：有则返工态非终局，
                                    //   应沿用同一 batch_start 再次 review_wait 等"改完→复审→passed"，勿直接关链
                                    autoloop_active: mine.some(function (p) { return !!p.autoloop && !p._loopDone && p.status !== 'suspended'; }),
                                    last_excerpt: lastExcerpt, elapsed_ms: Date.now() - _t0
                                }
                            });
                        } catch (eT2) { clearInterval(_tk); resolve({ success: false, message: 'review_wait 轮询异常: ' + (eT2 && eT2.message || eT2), tool: 'chat_manage' }); }
                    }, 800);
                });
            }

            if (action === 'close') {
                var targetId = args.chat_id || '';
                if (targetId === 'all') {
                    // 关闭所有对话
                    var count = self.chatBoxes.length;
                    var toClose = self.chatBoxes.slice(); // 复制数组
                    toClose.forEach(function(c) {
                        self.closeChatBox(c);
                    });
                    return { success: true, message: '已关闭所有 ' + count + ' 个对话', tool: 'chat_manage' };
                }
                // 关闭指定对话
                // 【指挥链 G5】chat_id='self' = 关闭"发起本条命令的对话自己"（callerId 由 tools-04-execute 透传）
                var isSelf = (targetId === 'self' || targetId === 'current' || targetId === '');
                if (isSelf) {
                    targetId = args._callerId || self.currentChatId || '';
                    if (!targetId) return { success: false, message: 'close self 失败：无法确定发起方对话身份（callerId 为空），请改用具体 chat_id', tool: 'chat_manage' };
                    // 护栏②「仅链最后一步」：关自己必须是整条链的收尾，否则链中途自杀 = 后续步骤没人发。
                    if (args.last_step !== true) {
                        return { success: false, tool: 'chat_manage', chat_id: targetId,
                            message: '已拒绝关闭发起方自己 [' + targetId + ']：close self 必须显式传 last_step:true（确认这是整条指挥链的最后一步、结论已交付完毕）。现在保持存活，可先做 review/review_wait。' };
                    }
                }
                var target = self.chatBoxes.find(function(c) { return c.id === targetId; });
                if (!target) {
                    return { success: false, message: '未找到对话 [' + targetId + ']，可用 list 操作查看所有对话', tool: 'chat_manage' };
                }
                // 护栏③「异常态不关」：正在回复 / 队列非空 / 正在审核中 → 拒绝，不销毁现场
                var _busy = !!target.isSending || (target.queue && target.queue.length);
                var _verifying = false;
                try {
                    var _VAc = (typeof ZFVerifyArrow !== 'undefined' && ZFVerifyArrow.getPairs) ? ZFVerifyArrow : (window.ZFVerifyArrow || null);
                    var _ps = _VAc && _VAc.getPairs ? _VAc.getPairs() : [];
                    _verifying = _ps.some(function (p) { return String(p.srcId) === String(targetId) && p.status !== 'passed' && p.status !== 'done'; });
                } catch (e) {}
                if (_busy || _verifying) {
                    return { success: false, tool: 'chat_manage', chat_id: targetId,
                        message: '已拒绝关闭对话 [' + targetId + ']：' + (_busy ? '仍在回复或队列未清空' : '尚有未出结论的审核配对') + '。请先 wait / review_wait 收尾，避免销毁现场。' };
                }
                // 护栏①「先 flush 结果」：关窗前强制落盘 + 抓最后一条回复留档（关窗后仍可在记录/历史中查到）
                var _flushed = '', _flushOk = false;
                try { _flushed = self._chainLastAssistant(target, 400); } catch (e) {}
                try {
                    if (typeof Store !== 'undefined' && Store.saveChatBox) Store.saveChatBox(target, true); // flushNow=true：关窗前强制落盘（store.js:343）
                    if (typeof Store !== 'undefined' && Store.save) Store.save();
                    _flushOk = true;
                } catch (e) {
                    return { success: false, tool: 'chat_manage', chat_id: targetId,
                        message: '已拒绝关闭对话 [' + targetId + ']：结果落盘失败（' + (e && e.message || e) + '），不关窗以免丢内容。' };
                }
                self.closeChatBox(target);
                self.updateMinimap();
                return { success: true, tool: 'chat_manage', data: { chat_id: targetId, closed_self: isSelf, flushed_chars: _flushed.length, last_reply_excerpt: _flushed },
                    message: '已关闭对话 [' + targetId + ']' + (isSelf ? '（发起方自关，结果已先落盘 ' + _flushed.length + ' 字）' : '') +
                        (_flushed ? '\n【末条回复留档】' + _flushed : '') };
            }

            if (action === 'move') {
                var moveId = args.chat_id || '';
                var moveChat = self.chatBoxes.find(function(c) { return c.id === moveId; });
                if (!moveChat) {
                    return { success: false, message: '未找到对话 [' + moveId + ']', tool: 'chat_manage' };
                }
                var newX = parseInt(args.x);
                var newY = parseInt(args.y);
                if (isNaN(newX) || isNaN(newY)) {
                    return { success: false, message: 'move 操作需要 x 和 y 参数', tool: 'chat_manage' };
                }
                /* 【负坐标修复】原 Math.max(0,..) 会把负坐标压回 0，导致重启后布局挤成一排。
                   改宽松边界：允许负坐标（画布可平移到负区），仅防极端值丢失 */
                var clampX = Math.min(Math.max(newX, -50000), 200000);
                var clampY = Math.min(Math.max(newY, -50000), 200000);
                moveChat.el.style.left = clampX + 'px';
                moveChat.el.style.top = clampY + 'px';
                Store.saveChatBox(moveChat);
                self.updateMinimap();
                return { success: true, message: '已移动对话 [' + moveId + '] 到 (' + newX + ', ' + newY + ')', tool: 'chat_manage' };
            }

            if (action === 'send') {
                var sendId = args.chat_id || '';
                var sendChat = self.chatBoxes.find(function(c) { return c.id === sendId; });
                if (!sendChat) {
                    return { success: false, message: '未找到对话 [' + sendId + ']，可用 list 操作查看所有对话', tool: 'chat_manage' };
                }
                var msg = args.message || '';
                if (!msg.trim()) {
                    return { success: false, message: 'send 操作需要 message 参数', tool: 'chat_manage' };
                }
                if (sendChat.isSending) {
                    return { success: false, message: '对话 [' + sendId + '] 正在发送中，请等待完成后再发送', tool: 'chat_manage' };
                }
                // 发送消息（复用 bindChatBox 中的 send 逻辑）
                self.addMsg(sendChat.el, msg, 'user', sendChat.modelId);
                self.showQueryPin(sendChat.el, msg);
                self.updateChatTitle(sendChat.el, msg);
                sendChat.history.push({ role: 'user', content: msg });
                Store.addLog('info', sendChat.id, 'send', 'chat_manage 发送消息: ' + msg.substring(0, 80));
                self.sendToModel(sendChat.el, sendChat);
                return { success: true, message: '已向对话 [' + sendId + '] 发送消息：' + msg.substring(0, 100), tool: 'chat_manage' };
            }

            if (action === 'pipeline') {
                // 画布流水线：mermaid 文本 -> 真实对话节点 + 流水线连线 + 自动汇流
                if (!window.Pipeline) {
                    return { success: false, message: 'Pipeline 模块未加载', tool: 'chat_manage' };
                }
                var pr = window.Pipeline.deploy(args.mermaid || args.message || '', {
                    name: args.name || '',
                    model_id: args.model_id,
                    prompts: args.prompts || {},
                    finalPrompt: args.final_prompt || ''
                });
                pr.tool = 'chat_manage';
                return pr;
            }

            if (action === 'macro_save') {
                // 保存宏：{action:'macro_save', name, steps:[{use:'chat_manage', args:{...}}, ...], desc}
                // 宏库服务端落盘（private/用户设置/macro_lib.json），localStorage 仅作离线缓存
                var mname = args.name || '';
                if (!mname || !Array.isArray(args.steps) || args.steps.length === 0) {
                    return { success: false, message: 'macro_save 需要 name 和非空 steps 数组', tool: 'chat_manage' };
                }
                if (args.steps.length > 100) return { success: false, message: '宏步骤数超上限(100)', tool: 'chat_manage' };
                var saveRes = self._macroServerSync('POST', { name: mname, desc: args.desc || '', steps: args.steps });
                if (!saveRes || saveRes.ok !== true) {
                    return { success: false, message: '宏保存失败（服务端）: ' + (saveRes && saveRes.error || '网络错误'), tool: 'chat_manage' };
                }
                var lib = self._macroLib(true);
                lib[mname] = { desc: args.desc || '', steps: args.steps, saved_at: Date.now() };
                self._macroSaveCache(lib);
                return { success: true, message: '宏 [' + mname + '] 已保存到服务端宏库（' + args.steps.length + ' 步）', tool: 'chat_manage' };
            }

            if (action === 'macro_list') {
                var lib2 = self._macroLib(true);
                var names = Object.keys(lib2);
                if (names.length === 0) return { success: true, message: '宏库为空', tool: 'chat_manage', data: { macros: [] } };
                var msg2 = '宏库共 ' + names.length + ' 个宏（服务端 private/用户设置/macro_lib.json）：\n';
                names.forEach(function(n) { msg2 += '- ' + n + '：' + (lib2[n].desc || '') + '（' + (lib2[n].steps || []).length + ' 步）\n'; });
                return { success: true, message: msg2, tool: 'chat_manage', data: { macros: names } };
            }

            if (action === 'macro_delete') {
                var delRes = self._macroServerSync('POST', { name: args.name, action: 'delete' });
                if (!delRes || delRes.ok !== true) {
                    return { success: false, message: '宏删除失败（服务端）: ' + (delRes && delRes.error || '网络错误'), tool: 'chat_manage' };
                }
                var lib3 = self._macroLib(true);
                delete lib3[args.name];
                self._macroSaveCache(lib3);
                return { success: true, message: '宏 [' + args.name + '] 已删除', tool: 'chat_manage' };
            }

            if (action === 'macro_run') {
                // 运行宏：{action:'macro_run', name, params:{key:val}, dry_run?:bool}
                // 护栏：含 close/delete 的步骤需步骤 args.confirm===true 才执行；步骤支持 wait:true+timeout_ms 等待目标对话空闲；dry_run 预演不执行
                var lib4 = self._macroLib(true);
                var mac = lib4[args.name];
                if (!mac) return { success: false, message: '宏 [' + args.name + '] 不存在，可用 macro_list 查看', tool: 'chat_manage' };
                var params = args.params || {};
                var results = [];
                var steps = JSON.parse(JSON.stringify(mac.steps));
                var dry = args.dry_run === true;
                if (dry) results.push({ step: 0, use: 'dry_run', ok: true, message: '预演模式：不实际执行' });
                for (var si = 0; si < steps.length; si++) {
                    var st = steps[si];
                    var raw = JSON.stringify(st.args || {});
                    Object.keys(params).forEach(function(k) {
                        raw = raw.split('${' + k + '}').join(String(params[k]));
                    });
                    var stArgs = JSON.parse(raw);
                    // 护栏1：危险操作（close/delete）需显式 confirm
                    var danger = (stArgs.action === 'close' || stArgs.action === 'delete' || stArgs.action === 'macro_delete');
                    if (danger && stArgs.confirm !== true) {
                        return { success: false, message: '宏 [' + args.name + '] 第 ' + (si+1) + ' 步是危险操作（' + stArgs.action + '）但未带 confirm:true，已中止。如确认执行，请在该步骤 args 中加 confirm:true', tool: 'chat_manage', data: { results: results } };
                    }
                    if (dry) {
                        results.push({ step: si + 1, use: st.use, ok: true, message: '[预演] ' + JSON.stringify(stArgs).substring(0, 120) });
                        continue;
                    }
                    var r;
                    try {
                        if (st.use === 'chat_manage') { r = self.chatManage(stArgs); }
                        else if (window.Tools && typeof window.Tools.execute === 'function') { r = window.Tools.execute(st.use, stArgs); }
                        else { r = { success: false, message: '未知步骤工具: ' + st.use }; }
                    } catch (e) { r = { success: false, message: '步骤' + (si+1) + '异常: ' + e.message }; }
                    results.push({ step: si + 1, use: st.use, ok: r && r.success !== false, message: ((r && r.message) || '').substring(0, 120) });
                    if (!r || r.success === false) {
                        return { success: false, message: '宏 [' + args.name + '] 在第 ' + (si+1) + ' 步中止：' + (r && r.message) + '（重跑可能重复建对话，必要时先 chat_manage list 核对）', tool: 'chat_manage', data: { results: results } };
                    }
                    // 护栏2：wait 语义——等待目标对话空闲（流水线编排核心）
                    if (st.wait && stArgs.action === 'send' && r.data && r.data.box_id) {
                        var w = self._macroWaitIdle(r.data.box_id, st.timeout_ms || 300000);
                        results.push({ step: si + 1, use: 'wait', ok: w.ok, message: w.message });
                        if (!w.ok) {
                            return { success: false, message: '宏 [' + args.name + '] 等待第 ' + (si+1) + ' 步完成时超时/失败：' + w.message, tool: 'chat_manage', data: { results: results } };
                        }
                    }
                }
                return { success: true, message: '宏 [' + args.name + ']' + (dry ? ' 预演完成' : ' 执行完成') + '（' + steps.length + ' 步）', tool: 'chat_manage', data: { results: results } };
            }

            if (action === 'register_tool') {
                // 三期自举：受控造工具。{action:'register_tool', name, desc, params, code, dry_run?}
                // 工具保存为 data/user_tools/<name>.js，状态 pending，需审核 approve 后才可执行
                var tname = (args.name || '').trim();
                if (!/^[A-Za-z_][A-Za-z0-9_-]{0,48}$/.test(tname)) {
                    return { success: false, message: '工具名不合法：字母/数字/下划线/连字符，字母开头，≤49字符', tool: 'chat_manage' };
                }
                var tcode = String(args.code || '');
                if (!tcode.trim()) return { success: false, message: 'register_tool 需要非空 code（JS 函数体，可用变量 args/ctx）', tool: 'chat_manage' };
                if (tcode.length > 128 * 1024) return { success: false, message: '代码超上限 128KB', tool: 'chat_manage' };
                // dry_run：本地沙箱试运行一次（不落盘、不持久化），验证代码能跑通
                if (args.dry_run === true) {
                    try {
                        // 【已审计】new Function：自定义工具沙箱试运行，code 来自 register_tool 且落盘后需 approve 审核闸门才可执行，受控
                        var fn0 = new Function('args', 'ctx', '"use strict";\n' + tcode);
                        var out0 = fn0(args.test_args || {}, { sandbox: true });
                        return { success: true, message: '沙箱试运行通过，返回: ' + String(JSON.stringify(out0)).substring(0, 200), tool: 'chat_manage', data: { result: out0 } };
                    } catch (e0) {
                        return { success: false, message: '沙箱试运行失败: ' + e0.message, tool: 'chat_manage' };
                    }
                }
                var rtRes = self._userToolsSync('POST', { action: 'save', name: tname, desc: args.desc || '', params: args.params || {}, code: tcode });
                if (!rtRes || rtRes.ok !== true) {
                    return { success: false, message: '工具注册失败: ' + (rtRes && rtRes.error || '网络错误'), tool: 'chat_manage' };
                }
                self._userToolCache = null; // 失效缓存
                return { success: true, message: '工具 [' + tname + '] 已注册（状态 pending）。需审核 approve（action=approve_tool, approved:true）后才可执行', tool: 'chat_manage' };
            }

            if (action === 'approve_tool' || action === 'disable_tool') {
                // 审核闸门：approve 必须带 approved:true；disable 随时禁用
                if (action === 'approve_tool' && args.approved !== true) {
                    return { success: false, message: 'approve_tool 需显式 approved:true（审核闸门：确认已人工/审核师复核代码）', tool: 'chat_manage' };
                }
                var apRes = self._userToolsSync('POST', { action: action === 'approve_tool' ? 'approve' : 'disable', name: args.name, approved: args.approved });
                if (!apRes || apRes.ok !== true) {
                    return { success: false, message: (action === 'approve_tool' ? '启用' : '禁用') + '失败: ' + (apRes && apRes.error || '网络错误'), tool: 'chat_manage' };
                }
                self._userToolCache = null;
                return { success: true, message: '工具 [' + args.name + '] 已' + (action === 'approve_tool' ? '启用' : '禁用'), tool: 'chat_manage' };
            }

            if (action === 'unregister_tool') {
                // 文件级回滚：直接删 js + 元数据
                var urRes = self._userToolsSync('POST', { action: 'delete', name: args.name });
                if (!urRes || urRes.ok !== true) {
                    return { success: false, message: '删除失败: ' + (urRes && urRes.error || '网络错误'), tool: 'chat_manage' };
                }
                if (self._userToolFns) delete self._userToolFns[args.name];
                self._userToolCache = null;
                return { success: true, message: '工具 [' + args.name + '] 已删除（回滚完成）', tool: 'chat_manage' };
            }

            if (action === 'list_tools') {
                var lt = self._userToolsLoad(true);
                var en = [], pend = [];
                Object.keys(lt).forEach(function(n) {
                    (lt[n].status === 'enabled' ? en : pend).push(n + '（' + lt[n].status + '）: ' + (lt[n].desc || ''));
                });
                var msg3 = '用户自定义工具：已启用 ' + en.length + ' 个，待审/禁用 ' + pend.length + ' 个\n' + en.concat(pend).join('\n');
                if (!en.length && !pend.length) msg3 = '用户自定义工具库为空（可用 register_tool 注册）';
                return { success: true, message: msg3, tool: 'chat_manage', data: { tools: lt } };
            }

            if (action === 'call_tool') {
                // 调用已启用的自定义工具（隔离：单次调用 try/catch，失败不影响主系统）
                var fn = self._userToolGet(args.name);
                if (!fn) {
                    return { success: false, message: '自定义工具 [' + args.name + '] 不可用（不存在/未启用/代码有误）', tool: 'chat_manage' };
                }
                try {
                    var out = fn(args.args || {}, { chatId: '' });
                    return { success: true, message: '工具 [' + args.name + '] 返回: ' + String(JSON.stringify(out)).substring(0, 500), tool: 'chat_manage', data: { result: out } };
                } catch (e1) {
                    return { success: false, message: '工具 [' + args.name + '] 执行异常: ' + e1.message, tool: 'chat_manage' };
                }
            }

            if (action === 'arrange') {
                // 如果画布上没有对话框，但数据库中有，先恢复
                if ((!self.chatBoxes || self.chatBoxes.length === 0) && typeof Store !== 'undefined' && Store.data && Store.data.chatBoxes && Store.data.chatBoxes.length > 0) {
                    self.restoreSession();
                }

                // 按状态排列所有对话框（发送中→空闲，水平一字排开）
                var boxes = self.chatBoxes;
                if (!boxes || boxes.length === 0) {
                    return { success: true, message: '没有可排列的对话框', tool: 'chat_manage', data: { count: 0 } };
                }

                // 优先使用已有的 arrangeChatBoxes 方法（支持换行等高级功能）
                if (typeof self.arrangeChatBoxes === 'function') {
                    self.arrangeChatBoxes();
                } else {
                    // 后备：内联排列逻辑
                    var sorted = boxes.slice().sort(function(a, b) {
                        if (a.isSending && !b.isSending) return -1;
                        if (!a.isSending && b.isSending) return 1;
                        return (a.createdAt || 0) - (b.createdAt || 0);
                    });
                    var boxWidth = 370, gap = 20, startX = 20, startY = 20;
                    var view = self.canvasGetView ? self.canvasGetView() : { x: 0, y: 0 };
                    sorted.forEach(function(chat, i) {
                        if (!chat.el) return;
                        chat.el.style.left = (startX + i * (boxWidth + gap) - view.x) + 'px';
                        chat.el.style.top = (startY - view.y) + 'px';
                        if (typeof Store !== 'undefined' && Store.saveChatBox) Store.saveChatBox(chat);
                    });
                    if (self._minimapDraw) self._minimapDraw();
                }

                var count = self.chatBoxes.length;
                var sendingCount = self.chatBoxes.filter(function(c) { return c.isSending; }).length;
                var msg = '已按状态排列 ' + count + ' 个对话框';
                if (sendingCount > 0) {
                    msg += '（发送中 ' + sendingCount + ' 个排在前）';
                }
                return { success: true, message: msg, tool: 'chat_manage', data: { count: count, sending: sendingCount } };
            }

            return { success: false, message: '未知操作: ' + action + '，支持: create, close, move, send, list, arrange, pipeline, wait, review, review_wait, macro_save, macro_list, macro_run, macro_delete, register_tool, approve_tool, disable_tool, unregister_tool, list_tools, call_tool', tool: 'chat_manage' };
        },

        // ===== 宏库存取（服务端 private/用户设置/macro_lib.json 为准，localStorage 仅离线缓存） =====
        _macroServerSync: function(method, body) {
            // 同步调用 /api/macro-lib；返回 {ok, macros?/error?}
            try {
                var xhr = new XMLHttpRequest();
                xhr.open(method, '/api/macro-lib', false); // 同步：宏指令在工具调用链里需即时结果
                if (method === 'POST') xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(method === 'POST' ? JSON.stringify(body) : null);
                if (xhr.status === 200) return JSON.parse(xhr.responseText);
                return { ok: false, error: 'HTTP ' + xhr.status };
            } catch (e) { return { ok: false, error: e.message }; }
        },
        _macroSrvFailAt: 0, // 服务端最近一次同步失败时间戳（退避：30s 内不再重复同步请求，防阻塞刷屏）
        _macroLib: function(fromServer) {
            var self = this;
            if (fromServer) {
                if (Date.now() - (self._macroSrvFailAt || 0) > 30000) {
                    var res = self._macroServerSync('GET');
                    if (res && res.ok && res.macros) {
                        self._macroSrvFailAt = 0;
                        self._macroSaveCache(res.macros);
                        return res.macros;
                    }
                    self._macroSrvFailAt = Date.now(); // 服务端不可达：30s 内降级本地缓存，不再反复同步阻塞
                }
                // 退避期内直接用本地缓存
            }
            return self._macroReadCache();
        },
        _macroReadCache: function() {
            try { return JSON.parse(localStorage.getItem('zf3d_macro_lib') || '{}'); } catch (e) { return {}; }
        },
        _macroSaveCache: function(lib) {
            try { localStorage.setItem('zf3d_macro_lib', JSON.stringify(lib)); } catch (e) {}
        },

        // ===== 用户自定义工具库（三期自举 register_tool）：服务端 data/user_tools/ 为准 =====
        _userToolsSync: function(method, body) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open(method, '/api/user-tools', false);
                if (method === 'POST') xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(method === 'POST' ? JSON.stringify(body) : null);
                if (xhr.status === 200) return JSON.parse(xhr.responseText);
                try { return JSON.parse(xhr.responseText); } catch (e2) {}
                return { ok: false, error: 'HTTP ' + xhr.status };
            } catch (e) { return { ok: false, error: e.message }; }
        },
        _userToolsLoad: function(fromServer) {
            var self = this;
            if (fromServer) {
                if (Date.now() - (self._userToolsFailAt || 0) > 30000) {
                    var res = self._userToolsSync('GET');
                    if (res && res.ok && res.tools) {
                        self._userToolsFailAt = 0;
                        try { localStorage.setItem('zf3d_user_tools', JSON.stringify(res.tools)); } catch (e2) {}
                        return res.tools;
                    }
                    self._userToolsFailAt = Date.now(); // 退避：30s 内不再同步阻塞
                }
            }
            try { return JSON.parse(localStorage.getItem('zf3d_user_tools') || '{}'); } catch (e) { return {}; }
        },
        _userToolFns: null, // 已编译函数缓存 {name: fn}；仅含 status=enabled 的工具
        _userToolGet: function(name) {
            var self = this;
            // 编译缓存命中直接返回
            if (self._userToolFns && self._userToolFns[name]) return self._userToolFns[name];
            var tools = self._userToolsLoad(true);
            var info = tools[name];
            if (!info || info.status !== 'enabled' || !info.code) return null;
            try {
                // 【已审计】new Function：编译用户自定义工具，仅 status=enabled（经审核闸门）的工具代码，受控
                var fn = new Function('args', 'ctx', '"use strict";\n' + info.code);
                self._userToolFns = self._userToolFns || {};
                self._userToolFns[name] = fn;
                return fn;
            } catch (e) {
                return null; // 代码有误：静默不可用，不拖垮主系统
            }
        },

        // wait 语义：轮询目标对话直到空闲（isSending=false）或超时
        _macroWaitIdle: function(boxId, timeoutMs) {
            var self = this;
            var deadline = Date.now() + (timeoutMs || 300000);
            var box = null;
            while (Date.now() < deadline) {
                box = (self.chatBoxes || []).filter(function(c) { return c.id === boxId || c.boxId === boxId; })[0];
                if (!box) return { ok: false, message: '目标对话 ' + boxId + ' 已不存在' };
                if (!box.isSending) return { ok: true, message: '对话 ' + boxId + ' 已完成' };
                // 同步休眠 500ms（工具调用链为同步语境）
                var t = Date.now() + 500; while (Date.now() < t) {}
            }
            return { ok: false, message: '等待对话 ' + boxId + ' 超时（' + (timeoutMs || 300000) + 'ms）' };
        },

        // ===== 【跨对话指挥链 G1/G3/G4 helper】 =====
        // 按 id 找对话（id 或 boxId 兼容）。此前 App 上没有 findChat，指挥链各分支需要，补此通用方法。
        //   ⚠️ 命名核对：全局 grep 'App.findChat' 原为 0 处使用，新增此名不与既有代码冲突。
        findChat: function(id) {
            if (id === undefined || id === null || id === '') return null;
            var arr = this.chatBoxes || [];
            for (var i = 0; i < arr.length; i++) {
                if (String(arr[i].id) === String(id) || String(arr[i].boxId) === String(id)) return arr[i];
            }
            return null;
        },
        // 通过线真源：window.ZF_PASS_LINE（缺省 60，见 chatbox-verify-arrow.js:50-52）；pass_score 仅作显式覆盖
        _chainPassLine: function(v) {
            var n = parseInt(v);
            if (!isNaN(n)) return n;
            try { if (typeof window.ZF_PASS_LINE === 'number') return window.ZF_PASS_LINE; } catch (e) {}
            return 60;
        },
        // 取对话最后一条 assistant 回复正文（截断，供跨对话结果摘要）
        _chainLastAssistant: function(c, maxChars) {
            if (!c || !c.messages) return '';
            for (var i = c.messages.length - 1; i >= 0; i--) {
                var m = c.messages[i];
                if (m && m.role === 'assistant') {
                    var t = typeof m.content === 'string' ? m.content : ((m.content && m.content.text) || '');
                    if (t) return t.length > maxChars ? t.slice(0, maxChars) + '…' : t;
                }
            }
            return '';
        },
        // 【异步等待·指挥链命门】Promise + setTimeout 轮询，绝不冻结页面。
        //   ⚠️ 严禁复用 _macroWaitIdle 的 `while(Date.now()<t){}` 同步自旋——那会卡死整页。
        //   ⚠️ 内部超时上限 12min：低于工具层 15min 硬超时（agent-02-loop-core.js _TOOL_TIMEOUT_MS），
        //      否则 wait 会被硬杀成「工具超时」错误，拿不到结构化结论。
        _asyncWaitIdle: function(chat, opts) {
            opts = opts || {};
            var self = this;
            var timeoutMs = Math.min(Math.max(parseInt(opts.timeoutMs) || 300000, 1000), 720000);
            var idleForMs = Math.max(parseInt(opts.idleForMs) || 1200, 200);
            var requireReply = !!opts.requireReply;
            var checkQueue = opts.checkQueue !== false;
            var lastCount = chat && chat.messages ? chat.messages.length : 0;
            var idleSince = 0;
            return new Promise(function (resolve) {
                var t0 = Date.now();
                var tk = setInterval(function () {
                    try {
                        // 每轮重新 find：防僵尸对象（对话可能在等待期间被重建/关闭）
                        var c = self.findChat ? self.findChat(chat.id) : chat;
                        if (!c) { clearInterval(tk); resolve({ success: false, message: '目标对话 [' + chat.id + '] 在等待期间已被关闭', tool: 'chat_manage' }); return; }
                        var busy = !!c.isSending;
                        if (checkQueue && c.queue && c.queue.length) busy = true;
                        if (busy) { idleSince = 0; }
                        else if (!idleSince) { idleSince = Date.now(); }
                        var idleOk = idleSince && (Date.now() - idleSince >= idleForMs);
                        var replyOk = true;
                        if (requireReply) {
                            var hist = c.messages || [];
                            var last = hist.length ? hist[hist.length - 1] : null;
                            replyOk = hist.length > lastCount && !!last && last.role === 'assistant';
                        }
                        if (idleOk && replyOk) {
                            clearInterval(tk);
                            resolve({ success: true, tool: 'chat_manage', message: '对话 [' + c.id + '] 已空闲（等待 ' + (Date.now() - t0) + 'ms）', data: { chat_id: c.id, idle_ms: Date.now() - t0, waited_ms: Date.now() - t0, last_reply_excerpt: self._chainLastAssistant(c, opts.excerptChars || 200) } });
                            return;
                        }
                        if (Date.now() - t0 > timeoutMs) {
                            clearInterval(tk);
                            resolve({ success: false, tool: 'chat_manage', message: '等待对话 [' + chat.id + '] 超时（' + timeoutMs + 'ms）：仍在回复中', data: { chat_id: chat.id, waited_ms: Date.now() - t0, timeout: true, isSending: !!c.isSending } });
                        }
                    } catch (e) {
                        clearInterval(tk);
                        resolve({ success: false, message: '异步等待异常: ' + (e && e.message || e), tool: 'chat_manage' });
                    }
                }, 400);
            });
        },

        updateMinimap: function() {
            // 占位 - 实际函数在 setupMinimap 中动态设置
            if (this._mmRaf) return;
            var self = this;
            this._mmRaf = requestAnimationFrame(function() {
                self._mmRaf = 0;
                if (self._minimapDraw) self._minimapDraw();
            });
        },
});
