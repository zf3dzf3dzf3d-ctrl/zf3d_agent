// ========== app-monitor.js - 监控轮询 + 关于弹窗 + 启动 ==========
// 请求超时助手：挂死请求 15 秒自动 abort，不再堆积拖死浏览器
function fetchT(url, opts, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms || 15000);
    return fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal })).finally(function () { clearTimeout(t); });
}
Object.assign(App, {

        // ===== 监控轮询器 =====
        _monitorTimer: null,
        _monitorPolling: false,

        startMonitorPoll: function() {
            var self = this;
            // 热更新安全：清理幽灵定时器
            if (self._monitorTimer) { clearInterval(self._monitorTimer); self._monitorTimer = null; }
            if (window.__monitorTimer) { clearInterval(window.__monitorTimer); window.__monitorTimer = null; }
            self._monitorTimer = setInterval(function() {
                // 【v7.5 常驻值守】页面上有协作窗（含待命值守）时不因页面切后台而停摆——
                // 协作唤醒消息投递不能断（用户令「尽可能不要让系统停止一个对话」）；无协作窗保持原节流
                if (document.hidden && !self._hasCollabChats()) return; // 页面不可见时跳过，防后台标签堆积请求
                // 活动感知：界面静止+没人+无对话 → 5 分钟一次低保真心跳（有协作窗时放行常驻）
                if (window.ActivityGate && !self._hasCollabChats() && !ActivityGate.allow('monitor', 300000)) return;
                self._monitorPoll();
            }, 8000);  // 每 8 秒检查一次（原 3 秒，降低轮询压力防掉帧）
            window.__monitorTimer = self._monitorTimer;
            // 立即执行一次
            self._monitorPoll();
            // 活动门控唤醒（切回页面/鼠标键盘活动）→ 立即补一次轮询
            if (window.ActivityGate) {
                document.addEventListener('activitygate-wake', function () {
                    if (self._monitorPolling || document.hidden) return;
                    self._monitorPoll();
                });
            }
            // 【v7.5 常驻值守】全局协作哨兵：名册里的成员窗缺失时自动重建拉活（AGI 员工离场自动归位）
            if (self._startCollabSentinel) self._startCollabSentinel();
        },

        stopMonitorPoll: function() {
            if (this._monitorTimer) {
                clearInterval(this._monitorTimer);
                this._monitorTimer = null;
                console.log('[Monitor] 轮询器已停止');
            }
            if (this._collabSentinelTimer) {
                clearInterval(this._collabSentinelTimer);
                this._collabSentinelTimer = null;
            }
        },

        // 【v7.5 常驻值守】页面是否存在协作窗（含最小化/待命值守）——有则监控轮询不被页面隐藏/活动节流拦停
        _hasCollabChats: function() {
            try {
                var arr = this.chatBoxes || [];
                for (var i = 0; i < arr.length; i++) { if (arr[i]._collabTeam) return true; }
                return false;
            } catch (e) { return false; }
        },

        // 【v7.5 常驻值守·全局协作哨兵】定期比对协作组名册与画布上的窗，
        // 名册成员的窗缺失（被关闭/刷新丢失）时按身份自动重建协作窗——AGI 员工离场自动归位，
        // 之后监控轮询投递的唤醒消息即可命中重建窗拉活新循环（用户令 2026-11-25「尽可能不要让系统停止一个对话」）。
        _collabSentinelTimer: null,
        _startCollabSentinel: function () {
            var self = this;
            if (self._collabSentinelTimer) clearInterval(self._collabSentinelTimer);
            self._collabSentinelTimer = setInterval(function () {
                if (document.hidden) return; // 后台页不做（轮询器的 _hasCollabChats 分支会补拉）
                fetchT('/api/collab', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'groups' }) }, 8000)
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (j) {
                        if (!j || !j.ok || !Array.isArray(j.groups)) return;
                        j.groups.forEach(function (g) {
                            if (!g || !g.team_id || !g.members) return;
                            var missing = [];
                            Object.keys(g.members).forEach(function (cn) {
                                var m = g.members[cn];
                                if (!m || m.left || m.done) return; // 已退场/已收口的不重建
                                var bindId = String(m.chat_id || '');
                                var alive = (self.chatBoxes || []).some(function (c) {
                                    return (c._collabTeam === g.team_id && String(c._collabCodename || '') === cn) ||
                                           (bindId && c.id === bindId);
                                });
                                if (!alive) missing.push({ codename: cn, chatId: bindId });
                            });
                            if (!missing.length) return;
                            if ((self.chatBoxes || []).length >= (self.MONITOR_MAX_CHAT || 40)) return;
                            missing.forEach(function (mi) {
                                var _nc = self.createChatBox(window.innerWidth / 2 - 260 + (Math.random() * 80 - 40), window.innerHeight / 2 - 180 + (Math.random() * 60 - 30), null);
                                if (!_nc) return;
                                /* 【修复：窗口ID重启漂移 2026-11-26 charlie】哨兵重建窗沿用成员档案里的原 chat_id
                                   （cb3-mwwzsnubi4pe4 重启后不再变成 cb53-mwwzsnubi4pe4），DB 会话/队列/箭头 bonds 全链不再断：
                                   chatbox-00-toast.js createChatBox 会读 box._reuseChatId 决定沿用 id；
                                   _reviveArrowBonds 仍保留作防御（此前重建窗口执行过、其存档 id 已是新 id 时不白做）。 */
                                try { if (mi.chatId && String(mi.chatId) !== 'null') { _nc._reuseChatId = String(mi.chatId); if (_nc.el) _nc.el.id = String(mi.chatId); /* 【alpha补位审计 2026-11-26】_reuseChatId 挂在 createChatBox 之后已来不及被 box._reuseChatId 读到，charlie 原补丁只改了 el.id 未同步 chat.id → el.id=旧/chat.id=新 半连接不一致，消息仍落新 id，漂移未根治。此处补 chat.id 同步回原 id，DB 会话/队列全链闭合 */ _nc.id = String(mi.chatId); } } catch (eId) {}
                                _nc._collabTeam = String(g.team_id);
                                _nc._collabCodename = String(mi.codename);
                                try { if (_nc.el) { _nc.el._collabTeam = _nc._collabTeam; _nc.el._collabCodename = _nc._collabCodename; } } catch (eElR) {} /* v1.4 双挂：三轻线读 el */
                                /* 【v7.6.1 charlie】重建换新 id → 箭头 bonds 救援（mapId+蜂群迁移+触发各壳补恢复），防协作师箭头消失 */
                                try { self._reviveArrowBonds(mi.chatId, _nc); } catch (eB) {}
                                try { Store.saveChatBox({ id: _nc.id, _collabTeam: _nc._collabTeam, _collabCodename: _nc._collabCodename }); } catch (eS) {}
                                try { self.updateChatTitle(_nc.el, '协作窗·' + mi.codename); } catch (eT) {}
                                try { Store.addLog('info', _nc.id, 'collab-revive', '哨兵：成员窗缺失自动重建（' + mi.codename + '@' + g.team_id + '）'); } catch (eL) {}
                                console.log('[Monitor] v7.5 协作哨兵：重建成员窗 ' + mi.codename + '@' + g.team_id + ' → ' + _nc.id);
                            });
                        });
                    }).catch(function () {});
            }, 60000); // 每分钟巡检一次
        },

        // 【v7.6.1 charlie·箭头 bonds 救援】协作窗被哨兵/唤醒重建时必调：重建 createChatBox 换了全新 id，
        // 而箭头存档（zf_converge_pairs 等）与蜂群注册表记的都是旧 id —— 不做三步救援，协作师箭头重启/重建后永久消失：
        // ① ZFArrow.mapId 登记 旧id→新id：converge/multi/verify 三壳 findChat 经 resolveId 自动换算旧存档 id；
        // ② 蜂群注册表旧条目迁移到新 id + 回挂 box/el 双标记：membersOf/ladderArrange 按标记认成员，
        //    不回挂则重建窗不被认成蜂群成员，收口箭头即使恢复也是 0 成员不可见；
        // ③ 触发五箭头壳补恢复：各壳启动重试循环 600 秒即停（thinker 降频续，其余 clearInterval），
        //    哨兵是分钟级巡检、重建通常发生在循环停止后——不主动触发，存档里的箭头永远不会重建出来。
        _reviveArrowBonds: function (oldId, nc) {
            if (!nc || !nc.el) return;
            var _old = String(oldId || '');
            try { if (window.ZFArrow && ZFArrow.mapId && _old && _old !== 'null') ZFArrow.mapId(_old, String(nc.id)); } catch (eM) {}
            try {
                var _rec = (window.ZFSwarm && ZFSwarm.recordOf && _old) ? ZFSwarm.recordOf(_old) : null;
                if (_rec && _rec.srcId) {
                    if (ZFSwarm.register) ZFSwarm.register(String(nc.id), _rec.role || 'custom', _rec.srcId, _rec.viewIdx);
                    nc._isCustomChat = nc.el._isCustomChat = true;
                    nc._customSrcId = nc.el._customSrcId = String(_rec.srcId);
                }
            } catch (eSw) {}
            setTimeout(function () {
                [window.ZFConvergeArrow, window.ZFMultiArrow, window.ZFVerifyArrow, window.ZFThinkerArrow, window.ZFSummarizerArrow].forEach(function (sh) {
                    try { if (sh && typeof sh.restore === 'function') sh.restore(true); } catch (eR) {}
                });
            }, 800);
        },

        // 聊天窗口数量硬上限（防监控风暴无限新建撑爆画布）
        MONITOR_MAX_CHAT: 40,

        // ===== 合并排队消息到新窗口 =====
        // 当目标窗口忙碌时，把排队消息合并成一条，连同上下文一起发送到新窗口
        // [防风暴熔断] 聊天窗口数达上限时不再新建，丢弃排队消息，避免无限撑爆画布
        _mergeQueueToNewWindow: function(chat_id, queueItems) {
            var self = this;
            // ===== 防风暴熔断：窗口数达上限则丢弃排队消息，停止新建 =====
            var curCount = self.chatBoxes ? self.chatBoxes.length : 0;
            var maxChat = self.MONITOR_MAX_CHAT || 40;
            if (curCount >= maxChat) {
                console.warn('[Monitor] 聊天窗口已达上限(' + curCount + '/' + maxChat + ')，丢弃 ' + (queueItems||[]).length + ' 条排队消息，熔断阻止风暴');
                (queueItems || []).forEach(function(item) {
                    fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                });
                try { Store.addLog('warn', chat_id, 'queue-merge-blocked', '窗口数达上限(' + curCount + ')，熔断阻止自动新建'); } catch(e) {}
                return;
            }
            var targetChat = self.chatBoxes.find(function(c) { return c.id === chat_id; });

            // 确定新窗口位置：在原窗口右侧偏下
            var cx, cy, modelId;
            if (targetChat) {
                var rect = targetChat.el.getBoundingClientRect();
                cx = rect.right + 30;
                cy = rect.top + 60;
                modelId = targetChat.modelId;
            } else {
                cx = window.innerWidth / 2;
                cy = window.innerHeight / 2;
                modelId = null;
            }

            // 创建新窗口
            var newChat = self.createChatBox(cx, cy, modelId);
            if (!newChat) return;

            // 清除新窗口的默认欢迎消息
            var body = newChat.el.querySelector('.chatbox-body');
            if (body) body.innerHTML = '';
            newChat.history = [];

            // 复制原窗口最近的上下文到新窗口（最近10条 user/assistant 消息）
            if (targetChat && targetChat.history && targetChat.history.length > 0) {
                var recentHistory = targetChat.history.slice(-10);
                recentHistory.forEach(function(m) {
                    if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
                        var whoCls = (m.role === 'user' ? 'user' : 'ai');
                        // addMsg 内部已调用 setMsgContent，不需要额外调用
                        self.addMsg(newChat.el, m.content, whoCls, newChat.modelId);
                        newChat.history.push({ role: m.role, content: m.content });
                    }
                });
            }

            // 合并排队消息为一条
            var mergedMessage;
            if (queueItems.length === 1) {
                mergedMessage = queueItems[0].message;
            } else {
                var lines = [];
                for (var i = 0; i < queueItems.length; i++) {
                    lines.push('[' + (i + 1) + '] ' + queueItems[i].message);
                }
                mergedMessage = '\n\n---\n\n以下是需要处理的多个消息，请逐一响应：\n\n' + lines.join('\n\n');
            }

            // 发送合并消息到新窗口
            self.addMsg(newChat.el, mergedMessage, 'user', newChat.modelId);
            self.showQueryPin(newChat.el, mergedMessage);
            self.updateChatTitle(newChat.el, mergedMessage);
            newChat.history.push({ role: 'user', content: mergedMessage });
            Store.addLog('info', newChat.id, 'send', '队列合并→新窗口: ' + mergedMessage.substring(0, 80));
            self.sendToModel(newChat.el, newChat);

            // 删除所有已合并的排队消息
            queueItems.forEach(function(item) {
                fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
            });

            Store.addLog('info', chat_id, 'queue-merge',
                '合并 ' + queueItems.length + ' 条排队消息到新窗口 ' + newChat.id);

            console.log('[Monitor] 队列合并: ' + queueItems.length + ' 条消息 → 新窗口 ' + newChat.id);
        },

        _monitorPoll: function() {
            var self = this;
            // 【6.3 修复·开机清扫】页面加载后首轮轮询时，清掉超龄的 wait 活凭证：
            // wait 是前端 setTimeout 链，整页刷新即死亡且 Promise 永不 resolve——
            // 发起方 AI 的指挥链（wait→review→review_wait→close）就此干挂，项目进度卡死（v6.2 用户实录）。
            // 对策：开机发现 >3 分钟的凭证 → 向发起对话窗补投唤醒消息，让接力者知情重派。
            if (!self._waitLedgerSwept) {
                self._waitLedgerSwept = true;
                try {
                    var _wl = window.__zfWaitLedger || {};
                    var _now = Date.now();
                    Object.keys(_wl).forEach(function (_k) {
                        var _w = _wl[_k];
                        if (!_w || _now - _w.ts < 180000) return; // 3 分钟内的是本页正常挂起，不清理
                        var _cid = _w.callerChatId;
                        delete _wl[_k];
                        if (!_cid) return;
                        var _target = (self.chatBoxes || []).find(function (c) { return c.id === _cid; });
                        if (!_target) return; // 发起窗也没了，无从唤醒（服务端队列也救不了不存在的窗）
                        var _sweepMsg = '【系统唤醒·6.3 对话接力保护】检测到你此前发起的 chat_manage wait（目标对话 ' + (_w.chatId || '?') + '）因页面刷新被强制中断、结果已丢失。请重新评估目标窗口当前状态（建议重新 wait 或直接 send），不要假设旧 wait 仍在生效，避免指挥链干挂。';
                        fetch('/api/monitor/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: _cid, message: _sweepMsg, key: 'wait_sweep_' + _cid + '_' + _now })
                        }).catch(function () {});
                        try { Store.addLog('info', _cid, 'wait-sweep', '开机清扫：超龄 wait 凭证已清理并向发起窗补投唤醒'); } catch (eSL) {}
                    });
                } catch (eWS) {}
            }
            if (self._monitorPolling) return;  // 防止重叠
            if (document.hidden) { return; }   // 后台标签不轮询
            self._monitorPolling = true;
            var ownedChatIds = (self.chatBoxes || []).map(function(chat) { return chat.id; });
            if (ownedChatIds.length === 0) { self._monitorPolling = false; return; }
            var pollQuery = ownedChatIds.map(function(id) { return 'chat_id=' + encodeURIComponent(id); }).join('&');
            fetchT('/api/monitor/poll?' + pollQuery)
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (!data || !data.ok || !data.items || data.items.length === 0) {
                        self._monitorPolling = false;
                        return;
                    }

                    // ===== 按 chat_id 分组排队消息 =====
                    var groups = {};
                    data.items.forEach(function(item) {
                        if (!groups[item.chat_id]) groups[item.chat_id] = [];
                        groups[item.chat_id].push(item);
                    });

                    // [防风暴] 单轮内新建窗口数上限，避免一轮 poll 并发新建多个窗口
                    var maxPerRound = 3;
                    var createdInRound = 0;

                    Object.keys(groups).forEach(function(chatId) {
                        var items = groups[chatId];
                        var targetChat = self.chatBoxes.find(function(c) { return c.id === chatId; });

                        // [防风暴] 聊天窗口总数已达上限 → 本轮不再新建，直接丢弃所有排队消息
                        var curCount = self.chatBoxes ? self.chatBoxes.length : 0;
                        if (curCount >= (self.MONITOR_MAX_CHAT || 40)) {
                            (items || []).forEach(function(item) {
                                fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                            });
                            return;
                        }

                        if (!targetChat) {
                            // 【v7.1 待命不脱网】协作窗唤醒消息（key 前缀 collab_wake_/collab_watchdog_）：目标窗已关时
                            // 不再丢弃——找当前打开的协作窗（同组同代号），把消息以用户消息注入拉它回场。
                            // 用户令 2026-11-24「做完了也不能停止」：done 后同伴 inject 唤醒必须能送达。
                            var _cwKey = (items[0] && items[0].key) || '';
                            // 【v7.5 常驻值守】优先用服务端解析好的 wake_team/wake_codename（key 正则兜底，
                            // 兼容 collab_wake_(team)_(code)_(ts) / collab_watchdog_(team)_(code)_(ts) / 旧短 key）
                            var _cwTeam = (items[0] && items[0].wake_team) || '';
                            var _cwM = _cwTeam ? [null, _cwTeam, (items[0] && items[0].wake_codename) || '']
                                : (/^collab_(?:wake|watchdog)_([a-z0-9_]+)_([a-z]+)_\d+/.exec(String(_cwKey)) || null);
                            if (_cwM && _cwM[1]) {
                                var _cwCode = String(_cwM[2] || '');
                                var _cwTarget = null;
                                var _cwBoxes = self.chatBoxes || [];
                                for (var _cwI = 0; _cwI < _cwBoxes.length; _cwI++) {
                                    if (_cwBoxes[_cwI]._collabTeam && String(_cwBoxes[_cwI]._collabCodename || '') === _cwCode) { _cwTarget = _cwBoxes[_cwI]; break; }
                                }
                                if (!_cwTarget) {
                                    // 【v7.5 自动重建协作窗·用户令 2026-11-25「尽可能不要让系统停止一个对话，长期留存」】
                                    // 名册里的窗已不在画布（被关闭/刷新丢失）：按组身份自动重建协作窗，
                                    // 回挂 _collabTeam/_collabCodename（store.js collabIdentity 自动落库，重启不丢），
                                    // 随后注入唤醒消息拉起新循环——AGI 员工离场自动归位，协作不因关窗而断。
                                    if ((self.chatBoxes ? self.chatBoxes.length : 0) < (self.MONITOR_MAX_CHAT || 40)) {
                                        var _nc = self.createChatBox(window.innerWidth / 2 - 260, window.innerHeight / 2 - 180, null);
                                        if (_nc) {
                                            /* 【修复：窗口ID重启漂移 2026-11-26 charlie】离场唤醒重建窗沿用名册原 chat_id
                                               （此前 cb3-xxx 重启/关窗后重建为全新 cbN-yyy → DB 会话错位、队列错链、幽灵窗）。
                                               createChatBox 内部已生成全新 id 并可能已落 Store（saveChatBox 由后续逻辑触发），
                                               此处返回后立即「双改 id」：chat 对象 id + DOM el.id 同步（真源 L666 chat.id=box.id），
                                               同步清理中间新 id 的脏痕迹：DB.deleteNode(新id) 删 saveNode 落的行、
                                               Tools.chatCategories 键迁移。原 id 已被活窗占用则不沿用（防重复窗），保持新 id。 */
                                            var _oldId = String(item.chat_id || '');
                                            var _dup = _oldId && (self.chatBoxes || []).some(function (c) { return c && c.id === _oldId && c !== _nc; });
                                            if (_oldId && _oldId !== 'null' && !_dup) {
                                                var _stale = String(_nc.id || '');
                                                try {
                                                    _nc.id = _oldId;
                                                    if (_nc.el) _nc.el.id = _oldId;
                                                    try { if (window.Tools && Tools.chatCategories && Tools.chatCategories[_stale]) { Tools.chatCategories[_oldId] = Tools.chatCategories[_stale]; delete Tools.chatCategories[_stale]; } } catch (eCat) {}
                                                    try { if (window.DB && DB.deleteNode) DB.deleteNode(_stale).catch(function(){}); } catch (eDb) {}
                                                } catch (eId) {}
                                            }
                                            /* 【v7.6 charlie·箭头存档救援】重建换了新 id，登记 旧名册id→新id 映射，
                                               三箭头壳 findChat 经 ZFArrow.resolveId 自动换算，防箭头因 id 断裂被真死剔除
                                               （沿用原 id 后 mapId 变恒等映射，无副作用，保留作防御） */
                                            try { if (window.ZFArrow && ZFArrow.mapId) ZFArrow.mapId(String(item.chat_id || ''), String(_nc.id)); } catch (eM) {}
                                            /* 【v7.6.1 charlie】补齐 bonds 救援：蜂群注册表迁移回挂 + 触发各壳补恢复
                                               （此前只做 mapId，存档不删但箭头也不会重建出来=看着还是丢） */
                                            try { self._reviveArrowBonds(String(item.chat_id || ''), _nc); } catch (eB) {}
                                            _nc._collabTeam = String(_cwM[1]);
                                            if (_cwCode) _nc._collabCodename = _cwCode;
                                            try { if (_nc.el) { _nc.el._collabTeam = _nc._collabTeam; _nc.el._collabCodename = _nc._collabCodename || ''; } } catch (eElW) {} /* v1.4 双挂：三轻线读 el */
                                            try { Store.saveChatBox({ id: _nc.id, _collabTeam: _nc._collabTeam, _collabCodename: _nc._collabCodename }); } catch (eS) {}
                                            try { self.updateChatTitle(_nc.el, '协作窗·' + (_cwCode || _cwM[1])); } catch (eT) {}
                                            _cwTarget = _nc;
                                            try { Store.addLog('info', _nc.id, 'collab-revive', '协作窗离场自动重建（组 ' + _cwM[1] + ' / ' + _cwCode + '），注入唤醒拉活'); } catch (eL) {}
                                            console.log('[Monitor] v7.5 协作窗已关闭 → 自动重建 ' + _nc.id + '（' + _cwCode + '@' + _cwM[1] + '）');
                                        }
                                    }
                                }
                                if (_cwTarget && !_cwTarget.isSending) {
                                    var _cwMsg = items.map(function (im) { return im.message; }).join('\n\n---\n\n');
                                    self.addMsg(_cwTarget.el, _cwMsg, 'user', _cwTarget.modelId);
                                    self.showQueryPin(_cwTarget.el, _cwMsg);
                                    _cwTarget.history.push({ role: 'user', content: _cwMsg });
                                    try { Store.addLog('info', _cwTarget.id, 'collab-wake', '协作唤醒注入: ' + _cwMsg.substring(0, 80)); } catch (e) {}
                                    self.sendToModel(_cwTarget.el, _cwTarget);
                                    (items || []).forEach(function (item) {
                                        fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                                    });
                                    console.log('[Monitor] 协作唤醒: ' + items.length + ' 条 → 协作窗 ' + _cwTarget.id + '（代号 ' + _cwCode + '）');
                                    return;
                                }
                            }
                            // [风暴修复] 窗口已被用户手动关闭 → 丢弃排队消息，不再自动新建窗口
                            // 旧逻辑（窗口不存在就新建接续）曾导致批量"继续"窗口风暴
                            (items || []).forEach(function(item) {
                                fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                            });
                            console.log('[Monitor] 窗口 ' + chatId + ' 已不存在（已关闭），丢弃 ' + items.length + ' 条排队消息');
                            try { Store.addLog('info', chatId, 'queue-drop', '窗口已关闭，丢弃 ' + items.length + ' 条排队消息（不自动新建）'); } catch(e) {}
                            return;
                        }

                        // ===== 智能调度：忙时合并到新窗口，闲时直接处理 =====
                        if (targetChat.isSending) {
                            // 窗口忙 → 合并排队消息到新窗口（避免排队等待）
                            if (createdInRound >= maxPerRound) {
                                (items || []).forEach(function(item) {
                                    fetch('/api/monitor/poll/' + encodeURIComponent(item.key) + '?chat_id=' + encodeURIComponent(item.chat_id), { method: 'DELETE' });
                                });
                                return;
                            }
                            // [风暴修复] 窗口忙碌 → 消息留队列，下一轮再投递（不再新建分流窗口）
                            console.log('[Monitor] 窗口 ' + chatId + ' 忙碌，' + items.length + ' 条消息留队列等待下一轮');
                        } else {
                            // 窗口闲 → 只处理第一条，其余留着等下一轮
                            var firstItem = items[0];
                            var msg = firstItem.message;
                            self.addMsg(targetChat.el, msg, 'user', targetChat.modelId);
                            self.showQueryPin(targetChat.el, msg);
                            self.updateChatTitle(targetChat.el, msg);
                            targetChat.history.push({ role: 'user', content: msg });
                            Store.addLog('info', targetChat.id, 'send', '监控轮询触发消息: ' + msg.substring(0, 80));
                            self.sendToModel(targetChat.el, targetChat);
                            // 标记为已处理（从队列删除）
                            fetch('/api/monitor/poll/' + encodeURIComponent(firstItem.key) + '?chat_id=' + encodeURIComponent(firstItem.chat_id), { method: 'DELETE' });
                            // 如果还有多余的排队消息（窗口刚闲下来但积了多条），
                            // 留到下一轮处理（此时窗口又忙了，下一轮会触发合并）
                        }
                    });

                    self._monitorPolling = false;
                })
                .catch(function(err) {
                    self._monitorPolling = false;
                    // 静默失败，下轮重试
                });
        },
});

// ===== 关于弹窗 =====
    // ===== 关于弹窗 =====
    function openAbout() {
        document.getElementById('settingsOverlay').classList.add('show');
        App.switchSettingsTab('about');
    }

    // 启动
    App.init();
