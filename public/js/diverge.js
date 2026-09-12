/* ============================================================
 * diverge.js - 发散/收敛多视角对话系统
 *
 * 功能：
 * 1. 发散：从当前对话派出多个子对话，每个子对话以不同视角（工程师/美工/程序员等）
 *    真实调用大模型分析父问题；子对话自动围绕父对话排列并连线。
 * 2. 收敛：所有子对话回复完成后，汇总各视角回复再次真实调用大模型，
 *    生成综合结论写回父对话（带样式卡片），可继续循环发散。
 *
 * 依赖：App（chatBoxes / createChatBox / sendToModel / addMsg / updateChatTitle / showQueryPin / activate）
 *      Store / Tools（getSystemPrompt）
 * ============================================================ */
(function () {
    'use strict';

    if (typeof App === 'undefined') {
        console.warn('[Diverge] App 未定义，diverge.js 未加载');
        return;
    }

    var DIVERGE_KEY = 'zf3d.divergeConfig.v1';
    var PRESETS = [
        {
            id: 'dev', name: '项目开发', views: [
                { name: '工程师', prompt: '你是一名资深工程师，擅长系统设计与技术选型。' },
                { name: '程序员', prompt: '你是一名经验丰富的程序员，擅长具体编码实现与踩坑经验。' },
                { name: '美工', prompt: '你是一名游戏美工，擅长视觉风格、界面与美术资源规划。' },
                { name: '产品经理', prompt: '你是一名产品经理，擅长需求分析、优先级与用户体验。' }
            ]
        },
        {
            id: 'swot', name: 'SWOT 分析', views: [
                { name: '优势视角', prompt: '你从优势(S)视角分析问题，只关注可行的长处与机会。' },
                { name: '劣势视角', prompt: '你从劣势(W)视角分析问题，只关注短板与风险点。' },
                { name: '机会视角', prompt: '你从机会(O)视角分析问题，只关注外部机会与趋势红利。' },
                { name: '威胁视角', prompt: '你从威胁(T)视角分析问题，只关注外部威胁与竞争压力。' }
            ]
        },
        {
            id: 'creative', name: '头脑风暴', views: [
                { name: '乐观派', prompt: '你是头脑风暴中的乐观派，专挑大胆创新、天马行空的想法。' },
                { name: '质疑派', prompt: '你是头脑风暴中的质疑派，专挑漏洞和反例，帮助方案更严密。' },
                { name: '实用派', prompt: '你是头脑风暴中的实用派，只关心落地成本与执行可行性。' },
                { name: '用户派', prompt: '你是头脑风暴中的用户代言派，只从最终用户的角度评判。' }
            ]
        }
    ];

    function loadPresets() {
        try {
            var saved = JSON.parse(localStorage.getItem(DIVERGE_KEY) || 'null');
            if (saved && Array.isArray(saved.presets) && saved.presets.length) return saved.presets;
        } catch (e) {}
        return PRESETS.slice();
    }
    function savePresets(presets) {
        try { localStorage.setItem(DIVERGE_KEY, JSON.stringify({ presets: presets })); } catch (e) {}
    }

    // ---- 发散组注册表：parentChatId -> { children: [chatId...], converged: bool, views: [name...] } ----
    var groups = {};

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function chatById(id) {
        return (App.chatBoxes || []).find(function (c) { return c.id === id; });
    }

    /* ================= 发散按钮注入（每个对话框创建时） ================= */
    var origBindChatBox = App.bindChatBox;
    App.bindChatBox = function (box, chat) {
        var r = origBindChatBox ? origBindChatBox.apply(this, arguments) : undefined;
        // 2026-09-02 按用户要求：去掉显式「发散」按钮，改为隐式触发（对话中对 AI 说“发散/多视角分析”即可）
        return r;
    };

    var LAST_VIEWS_KEY = 'zf3d.divergeLastViews.v1';
    function loadLastViews() {
        try { return JSON.parse(localStorage.getItem(LAST_VIEWS_KEY) || 'null'); } catch (e) { return null; }
    }
    function saveLastViews(views) {
        try { localStorage.setItem(LAST_VIEWS_KEY, JSON.stringify(views)); } catch (e) {}
    }

    /* ================= 发散入口（已改为隐式：AI 在对话中识别“发散/多视角”意图时调用，不再注入按钮） ================= */

    /* ================= 快选菜单（左键）：选模板直接发散 ================= */
    function openDivergeQuickMenu(box, chat) {
        closeDivergePanel();
        var presets = loadPresets();
        var menu = document.createElement('div');
        menu.className = 'diverge-panel diverge-quickmenu';
        var html = '<div class="dp-header"><span>🔀 选择发散模板</span><button class="dp-close" title="关闭">×</button></div><div class="dp-body">';
        presets.forEach(function (p, i) {
            var names = p.views.map(function (v) { return esc(v.name); }).join(' / ');
            html += '<div class="dp-quick-item" data-idx="' + i + '" title="' + names + '">' +
                '<div class="dp-quick-name">' + esc(p.name) + '</div>' +
                '<div class="dp-quick-views">' + names + '</div></div>';
        });
        html += '<div class="dp-quick-item dp-quick-config" title="配置模板与视角"><div class="dp-quick-name">⚙️ 配置模板…</div><div class="dp-quick-views">自定义视角、增删模板</div></div>';
        html += '</div>';
        menu.innerHTML = html;

        menu.querySelector('.dp-close').addEventListener('click', closeDivergePanel);
        menu.querySelectorAll('.dp-quick-item[data-idx]').forEach(function (item) {
            item.addEventListener('click', function () {
                var p = presets[parseInt(item.dataset.idx, 10)];
                if (!p) return;
                closeDivergePanel();
                // 选中模板直接发散（取代发送按钮的语义）
                App.diverge(box, chat, JSON.parse(JSON.stringify(p.views)));
            });
        });
        menu.querySelector('.dp-quick-config').addEventListener('click', function () {
            openDivergePanel(box, chat);
        });

        document.body.appendChild(menu);
        try {
            var r = box.getBoundingClientRect();
            menu.style.left = Math.max(10, Math.min(window.innerWidth - 320, r.left)) + 'px';
            menu.style.top = Math.max(10, r.top - 20) + 'px';
        } catch (e) {}
        setTimeout(function () {
            var off = function (e) { if (!menu.contains(e.target)) closeDivergePanel(); };
            document.addEventListener('mousedown', off, { once: true });
        }, 0);
    }

    /* ================= 发散配置面板 ================= */
    function openDivergePanel(box, chat) {
        closeDivergePanel();
        var presets = loadPresets();
        var panel = document.createElement('div');
        panel.className = 'diverge-panel';
        panel.innerHTML =
            '<div class="dp-header"><span>🔀 发散设置</span><button class="dp-close" title="关闭">×</button></div>' +
            '<div class="dp-body">' +
                '<div class="dp-row"><label>发散视角数量</label><input class="dp-count" type="number" min="2" max="6" value="3"></div>' +
                '<div class="dp-row"><label>视角预设</label><select class="dp-preset"></select><button class="dp-apply-preset">应用</button><button class="dp-save-preset" title="将当前视角列表保存为新模板">💾 存为模板</button></div>' +
                '<div class="dp-views"></div>' +
                '<div class="dp-hint">每个视角将派出一个子对话，真实调用大模型进行发散分析。全部回复后自动收敛汇总。</div>' +
            '</div>' +
            '<div class="dp-footer"><button class="dp-go">🚀 开始发散</button></div>';

        var viewsEl = panel.querySelector('.dp-views');
        var countEl = panel.querySelector('.dp-count');

        function renderViews(list) {
            viewsEl.innerHTML = '';
            list.forEach(function (v, i) {
                var row = document.createElement('div');
                row.className = 'dp-view-row';
                row.innerHTML =
                    '<input class="dp-v-name" placeholder="视角名" value="' + esc(v.name) + '">' +
                    '<input class="dp-v-prompt" placeholder="视角提示词" value="' + esc(v.prompt) + '">' +
                    '<button class="dp-v-del" title="删除该视角">×</button>';
                row.querySelector('.dp-v-del').addEventListener('click', function () {
                    list.splice(i, 1); renderViews(list); syncCount();
                });
                viewsEl.appendChild(row);
            });
            syncCount();
        }
        function readViews() {
            var list = [];
            viewsEl.querySelectorAll('.dp-view-row').forEach(function (row) {
                var name = row.querySelector('.dp-v-name').value.trim();
                var prompt = row.querySelector('.dp-v-prompt').value.trim();
                if (name || prompt) list.push({ name: name || ('视角' + (list.length + 1)), prompt: prompt });
            });
            return list;
        }
        function syncCount() { countEl.value = viewsEl.querySelectorAll('.dp-view-row').length; }

        var presetSel = panel.querySelector('.dp-preset');
        presets.forEach(function (p, i) {
            var opt = document.createElement('option');
            opt.value = String(i); opt.textContent = p.name;
            presetSel.appendChild(opt);
        });
        var optCustom = document.createElement('option');
        optCustom.value = '-1'; optCustom.textContent = '自定义…';
        presetSel.appendChild(optCustom);

        panel.querySelector('.dp-apply-preset').addEventListener('click', function () {
            var idx = parseInt(presetSel.value, 10);
            if (idx >= 0 && presets[idx]) renderViews(JSON.parse(JSON.stringify(presets[idx].views)));
        });

        panel.querySelector('.dp-save-preset').addEventListener('click', function () {
            var views = readViews();
            if (views.length < 1) { App.addMsg(box, '⚠️ 请先配置至少一个视角再保存。', 'error'); return; }
            var name = prompt('模板名称：', '我的模板' + (presets.length + 1));
            if (!name) return;
            presets.push({ id: 'custom_' + Date.now(), name: name, views: views });
            savePresets(presets);
            var opt = document.createElement('option');
            opt.value = String(presets.length - 1); opt.textContent = name;
            presetSel.insertBefore(opt, presetSel.querySelector('option[value="-1"]'));
            presetSel.value = String(presets.length - 1);
        });

        countEl.addEventListener('change', function () {
            var n = Math.max(2, Math.min(6, parseInt(countEl.value, 10) || 3));
            var list = readViews();
            while (list.length < n) list.push({ name: '视角' + (list.length + 1), prompt: '' });
            list.length = Math.min(list.length, n);
            renderViews(list);
        });

        panel.querySelector('.dp-close').addEventListener('click', closeDivergePanel);
        panel.querySelector('.dp-go').addEventListener('click', function () {
            var views = readViews();
            if (views.length < 1) { App.addMsg(box, '⚠️ 请至少配置一个发散视角。', 'error'); return; }
            closeDivergePanel();
            App.diverge(box, chat, views);
        });

        // 默认应用上次的视角设置，否则用第一个预设
        var lastViews = loadLastViews();
        if (lastViews && lastViews.length >= 2) {
            renderViews(JSON.parse(JSON.stringify(lastViews)));
        } else if (presets[0]) {
            renderViews(JSON.parse(JSON.stringify(presets[0].views)));
        }

        document.body.appendChild(panel);
        // 定位：紧贴当前对话框上方
        try {
            var r = box.getBoundingClientRect();
            var pw = 320;
            panel.style.left = Math.max(10, Math.min(window.innerWidth - pw - 10, r.left)) + 'px';
            panel.style.top = Math.max(10, r.top - 20) + 'px';
        } catch (e) {}
        setTimeout(function () {
            var off = function (e) { if (!panel.contains(e.target)) closeDivergePanel(); };
            document.addEventListener('mousedown', off, { once: true });
        }, 0);
    }
    function closeDivergePanel() {
        document.querySelectorAll('.diverge-panel').forEach(function (p) { p.remove(); });
    }

    /* ================= 对话式发散：大模型分配视角，与用户商量后执行 ================= */
    var PLAN_TAG_BEGIN = '[[DIVERGE_PLAN]]';
    var PLAN_TAG_END = '[[/DIVERGE_PLAN]]';

    function planSystemPrompt() {
        return '你现在是「发散规划助手」。用户会给你一个问题（或调整意见），请你设计一个「流程图方案」来解决这个问题。\n' +
            '核心规则：\n' +
            '1. 分支数量完全由你决定（1~8 个都可以），结构也由你决定：可以串联、并联、多级发散、中途汇流再发散，用工程思维画最优结构，不需要问用户该分几个。\n' +
            '2. 每个节点是一个具体职责（如 需求分析/架构设计/前端实现/测试/美术评审），根据问题灵活设计。\n' +
            '3. 用简短友好的中文向用户介绍你的流程图思路（几条线、怎么汇合、为什么），并邀请用户调整。\n' +
            '4. 回复的最后必须输出一个标记块，格式严格如下（不要加代码围栏）：\n' +
            PLAN_TAG_BEGIN + '{"question":"要解决的原始问题（精炼版）","mermaid":"flowchart LR; A[节点名]-->B[节点名]; B-->C[节点名]","prompts":{"A":"节点A的系统提示词（一两句话描述职责）","B":"节点B的提示词"},"final_prompt":"终点节点（无下游的节点）的归总提示词"}' + PLAN_TAG_END + '\n' +
            '5. mermaid 用 flowchart LR，节点写法必须是 A[中文名]，连线用 -->，可用 A-->B & C 一行多连，不要用子图/样式语法。\n' +
            '6. 用户提出调整意见时，按新方案重新输出介绍和标记块。';
    }

    function parsePlan(text) {
        var i = text.indexOf(PLAN_TAG_BEGIN);
        var j = text.indexOf(PLAN_TAG_END);
        if (i < 0 || j <= i) return null;
        try {
            var obj = JSON.parse(text.substring(i + PLAN_TAG_BEGIN.length, j).trim());
            var mermaid = String(obj.mermaid || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
            if (!obj || !mermaid || !/flowchart|graph/i.test(mermaid)) return null;
            return {
                question: String(obj.question || ''),
                mermaid: mermaid,
                prompts: obj.prompts && typeof obj.prompts === 'object' ? obj.prompts : {},
                final_prompt: String(obj.final_prompt || '')
            };
        } catch (e) { return null; }
    }

    // 从渲染出的消息 DOM 中剥离 JSON 块（气泡里不显示原始 JSON）
    function stripPlanTag(text) {
        var i = text.indexOf(PLAN_TAG_BEGIN);
        var j = text.indexOf(PLAN_TAG_END);
        if (i < 0 || j <= i) return text;
        return (text.substring(0, i) + text.substring(j + PLAN_TAG_END.length)).trim();
    }

    // 发送规划消息并监听回复（复用 sendToModel 的回调注入）
    function sendPlanTurn(box, chat, userText) {
        chat.history.push({ role: 'user', content: userText, _divergePlanRound: true });
        // 规划系统提示只在「发给模型时」临时前置，不写入历史（由下方发送前组装），避免污染后续上下文
        var h = chat.history[chat.history.length - 1];
        h._planSystemPrefix = planSystemPrompt();
        App.showQueryPin && App.showQueryPin(box, '🔀 商量发散方案');
        App.sendToModel(box, chat);
        // 监听回复完成：isSending 结束后扫描最后一条 assistant 消息
        var t = setInterval(function () {
            if (chat.isSending) return;
            clearInterval(t);
            var last = null;
            for (var i = chat.history.length - 1; i >= 0; i--) {
                if (chat.history[i].role === 'assistant') { last = chat.history[i]; break; }
            }
            if (!last) return;
            var views = parsePlan(last.content || '');
            if (!views) {
                App.addMsg(box, '⚠️ 未能解析出流程图方案，请再试一次（点 🔀 重新开始）。', 'error');
                return;
            }
            last._divergePlanViews = views;
            // 从历史中剥离标记块，气泡内只保留介绍文字
            var clean = stripPlanTag(last.content || '');
            if (clean && clean !== last.content) {
                last.content = clean;
                // 找到对应的最后一条 AI 气泡，替换其文本
                var body = box.querySelector('.chatbox-body');
                if (body) {
                    var bubbles = body.querySelectorAll('.msg.ai');
                    var lastBubble = bubbles[bubbles.length - 1];
                    if (lastBubble && typeof App.setMsgContent === 'function') {
                        try { App.setMsgContent(lastBubble, clean, 'ai'); } catch (e) {}
                    }
                }
            }
            attachPlanButton(box, chat, views);
        }, 800);
    }

    // 在父对话最新一条 AI 气泡下挂「按此方案部署流程图」按钮
    function attachPlanButton(box, chat, plan) {
        var body = box.querySelector('.chatbox-body');
        if (!body) return;
        var old = box.querySelector('.diverge-plan-btn'); if (old) old.remove();
        var bar = document.createElement('div');
        bar.className = 'diverge-plan-btn';
        bar.innerHTML = '<button class="dp-launch">🚀 按此方案部署流程图（跑起来）</button>';
        bar.querySelector('.dp-launch').addEventListener('click', function () {
            bar.remove();
            deployDivergePlan(box, chat, plan);
        });
        body.appendChild(bar);
        body.scrollTop = body.scrollHeight;
    }

    // 部署：调用画布流水线引擎，把 AI 设计的 mermaid 图变成真实对话节点并自动运行
    function deployDivergePlan(box, chat, plan) {
        if (typeof App.divergePlanRunning === 'function' && App.divergePlanRunning()) {
            App.addMsg(box, '⚠️ 已有方案标记在运行中。', 'error'); return;
        }
        chat.history.forEach(function (h) { delete h._divergePlanViews; });
        var PL = window.Pipeline;
        if (!PL || typeof PL.deploy !== 'function') {
            App.addMsg(box, '⚠️ 流程图引擎（Pipeline）未加载。', 'error'); return;
        }
        var origin = { x: (parseInt(box.style.left) || 100) + 480, y: (parseInt(box.style.top) || 100) - 120 };
        var r = PL.deploy(plan.mermaid, {
            name: '发散·' + (plan.question || '流程图').substring(0, 16),
            prompts: plan.prompts || {},
            finalPrompt: plan.final_prompt || '',
            origin: origin
        });
        if (r && r.success) {
            App.addMsg(box, '✅ ' + r.message, 'user');
            if (App.toast) App.toast('🔀 流程图已部署，节点将按连线顺序自动运行');
        } else {
            App.addMsg(box, '⚠️ ' + ((r && r.message) || '部署失败'), 'error');
        }
    }

    // 入口：隐式触发（对话中对 AI 说“发散”即可；也暴露 window.Diverge 供 AI 工具调用）
    function startDivergePlan(box, chat) {
        if (!chat || chat.isSending) {
            App.addMsg(box, '⚠️ 当前对话正在发送中，请等待完成后再发散。', 'error');
            return;
        }
        // 直接发散：有输入内容或历史用户消息就立刻派子对话，不再协商
        var input = box.querySelector('.chatbox-input');
        var question = input ? input.value.trim() : '';
        if (!question) {
            for (var i = chat.history.length - 1; i >= 0; i--) {
                if (chat.history[i].role === 'user' && !chat.history[i]._convergeRound && !chat.history[i]._divergePlanRound) {
                    question = chat.history[i].content;
                    break;
                }
            }
        }
        if (!question) {
            App.addMsg(box, '⚠️ 请先在输入框写下要发散的问题。', 'error');
            return;
        }
        if (input) input.value = '';
        // 流程图化：一律进入协商轮，由 AI 自主设计流程图方案（数量/结构 AI 决定）
        sendPlanTurn(box, chat, question);
    }

    // 协商后续轮：用户在父对话里正常发消息时，如果上一条 AI 回复带方案，则自动转入继续商量。
    // 注意：不能靠 DOM 事件拦截（原发送监听先注册会先执行，stopImmediatePropagation 拦不住，还会双发），
    // 实际拦截由下方对 App.sendToModel 的包装实现。
    function hookPlanFollowups(box, chat) { /* 由 sendToModel 包装统一处理，无需 DOM 拦截 */ }

    // 核心：包装 App.sendToModel，父对话存在待执行方案时，把用户普通发送转成商量轮
    if (!App._divergeSendPatched) {
        App._divergeSendPatched = true;
        var origSendToModel = App.sendToModel;
        App.sendToModel = function (box, chat) {
            try {
                if (chat && chat.history && chat.history.length) {
                    var lastH = chat.history[chat.history.length - 1];
                    // 收敛轮 / 商量轮自身发起的调用：直接放行（发送前临时前置规划提示词）
                    if (lastH._convergeRound || lastH._divergePlanRound) {
                        if (lastH._divergePlanRound && lastH._planSystemPrefix) {
                            var sendArgs = Array.prototype.slice.call(arguments);
                            var patched = box || sendArgs[0];
                            var prefix = lastH._planSystemPrefix;
                            var lastUser = lastH.content;
                            lastH.content = prefix + '\n\n---\n\n用户输入：' + lastUser;
                            var res = origSendToModel.apply(this, arguments);
                            // 发送结束后还原（流式请求异步读历史，不能用 setTimeout(0)）
                            var rt = setInterval(function () {
                                if (chat && chat.isSending) return;
                                clearInterval(rt);
                                try { lastH.content = lastUser; } catch (e) {}
                            }, 500);
                            return res;
                        }
                        return origSendToModel.apply(this, arguments);
                    }
                    // 发散子对话：放行
                    if (chat._divergeParent) return origSendToModel.apply(this, arguments);
                    // 父对话存在待执行方案，且用户输入了内容 → 转入商量轮
                    var plan = lastPlanInHistory(chat);
                    var input = box ? box.querySelector('.chatbox-input') : null;
                    var text = input ? input.value.trim() : '';
                    if (plan && text) {
                        input.value = '';
                        App.addMsg(box, text, 'user');
                        sendPlanTurn(box, chat, text);
                        return;
                    }
                }
            } catch (e) { console.warn('[Diverge] 拦截失败，放行正常发送', e); }
            return origSendToModel.apply(this, arguments);
        };
    }
    function lastPlanInHistory(chat) {
        // 只看「最后一条」AI 消息：只有它带方案标记才算待商量。
        // 否则旧方案会永久劫持后续普通对话（bug 修复）。
        for (var i = chat.history.length - 1; i >= 0; i--) {
            var h = chat.history[i];
            if (h.role !== 'assistant') continue;
            return h._divergePlanViews ? h : null;
        }
        return null;
    }

    /* ================= 发散执行 ================= */
    App.diverge = function (box, chat, views) {
        // 清除协商方案标记，恢复正常对话流程
        chat.history.forEach(function (h) { delete h._divergePlanViews; });
        var pb = box.querySelector('.diverge-plan-btn'); if (pb) pb.remove();
        if (!chat || chat.isSending) {
            App.addMsg(box, '⚠️ 当前对话正在发送中，请等待完成后再发散。', 'error');
            return;
        }
        // 父问题 = 输入框内容（优先）或最后一条用户消息
        var input = box.querySelector('.chatbox-input');
        var question = input ? input.value.trim() : '';
        if (!question) {
            for (var i = chat.history.length - 1; i >= 0; i--) {
                if (chat.history[i].role === 'user' && !chat.history[i]._convergeRound) {
                    question = chat.history[i].content;
                    break;
                }
            }
        }
        if (!question) {
            App.addMsg(box, '⚠️ 请先在输入框写下要发散的问题。', 'error');
            return;
        }
        if (input) input.value = '';

        saveLastViews(views);

        var group = { parentId: chat.id, children: [], views: views.map(function (v) { return v.name; }), converged: false };
        groups[chat.id] = group;
        chat._divergeGroup = group;

        // 父对话消息气泡
        App.addMsg(box, '🔀 **开始发散**：从 ' + views.length + ' 个视角分析「' + question.substring(0, 60) + (question.length > 60 ? '…' : '') + '」', 'user');
        Store.addLog('info', chat.id, 'diverge', '发起发散：' + views.map(function (v) { return v.name; }).join('/'));

        var basePos = null;
        try { basePos = { x: parseInt(box.style.left) || 100, y: parseInt(box.style.top) || 100 }; } catch (e) {}
        var boxW = box.offsetWidth || 420;
        var overlapX = 60;           // 子对话水平重叠排开
        var gapY = 12;               // 紧贴父对话上方
        var startY = basePos.y - (chat.el.offsetHeight || 500) - gapY;

        views.forEach(function (v, idx) {
            var x = basePos.x + idx * (boxW - overlapX);
            var y = startY;
            var child = App.createChatBox(x, y, chat.modelId);
            if (!child) { App.addMsg(box, '⚠️ 创建子对话失败（可能触发防风暴保护），请稍后重试。', 'error'); return; }
            child._divergeParent = chat.id;
            child._divergeView = v;
            group.children.push(child.id);

            // 视角系统提示注入子对话
            var viewPrompt = (v.prompt || '你是一名多视角分析专家。') +
                '\n\n## 角色约束\n你是发散讨论中的「' + v.name + '」视角。' +
                '请只从你的专业视角分析问题，给出具体、可执行的观点，不要替其他视角发言。' +
                '回复保持精炼（200-500字），直接给结论和理由，不要调用工具。';
            if (typeof Tools !== 'undefined' && Tools.chatCategories) {
                Tools.chatCategories[child.id] = Tools.chatCategories[child.id] || '极简';
            }

            var msg = viewPrompt + '\n\n## 待分析的问题\n' + question;
            child.history.push({ role: 'user', content: msg });
            App.addMsg(child.el, '【' + v.name + ' 视角】' + question, 'user', child.modelId);
            App.updateChatTitle(child.el, '🔀' + v.name + '：' + question.substring(0, 20));
            Store.addLog('info', child.id, 'diverge-child', '发散子对话创建，视角：' + v.name);
            setTimeout(function () { App.sendToModel(child.el, child); }, 200 + idx * 300);
        });

        renderDivergeLinks(group);
        removeDivergeLinks(group.parentId); // 不需要连线（用户反馈太丑），仅保留位置关系
        // 收敛按钮挂到父对话框
        attachConvergeButton(box, chat, group);
        watchChildren(group, box, chat);
    };

    /* ================= 连线可视化 ================= */
    function renderDivergeLinks(group) {
        removeDivergeLinks(group.parentId);
        var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
        if (!canvas) return;
        var parent = chatById(group.parentId);
        if (!parent) return;
        var svg = canvas.querySelector('.diverge-svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('diverge-svg');
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5;';
            canvas.appendChild(svg);
        }
        group.children.forEach(function (cid, i) {
            var child = chatById(cid);
            if (!child) return;
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'diverge-link');
            path.setAttribute('data-parent', group.parentId);
            path.setAttribute('data-child', cid);
            svg.appendChild(path);
            var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('class', 'diverge-link-label');
            label.setAttribute('data-parent', group.parentId);
            label.setAttribute('data-child', cid);
            label.textContent = group.views[i] || '';
            svg.appendChild(label);
        });
        updateDivergeLinks();
    }
    function removeDivergeLinks(parentId) {
        // 只删除指定父对话组的连线（parentId 为空时才清全部），避免多组发散共存时互相删除
        document.querySelectorAll('.diverge-link, .diverge-link-label').forEach(function (el) {
            if (!parentId || el.getAttribute('data-parent') === String(parentId)) el.remove();
        });
        document.querySelectorAll('.diverge-svg').forEach(function (s) {
            if (!parentId || !s.querySelector('.diverge-link')) s.remove();
        });
    }
    App.updateDivergeLinks = function () { updateDivergeLinks(); };
    function updateDivergeLinks() {
        var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
        if (!canvas) return;
        // canvas 可能有 transform（缩放/平移），需换算
        var cRect = canvas.getBoundingClientRect();
        var scale = cRect.width ? (canvas.offsetWidth / cRect.width) : 1;
        var paths = document.querySelectorAll('.diverge-link');
        if (!paths.length) return;
        // 每条连线用自己的 data-parent 找父对话，支持多组发散共存
        var parentEls = {};
        paths.forEach(function (path) {
            var pid = path.getAttribute('data-parent');
            var p = chatById(pid);
            if (!p) { path.remove(); return; }
            parentEls[pid] = p;
        });

        paths.forEach(function (path) {
            var pid = path.getAttribute('data-parent');
            var parentEl = parentEls[pid];
            if (!parentEl) return;
            var pRect = parentEl.el.getBoundingClientRect();
            var px = (pRect.left + pRect.width / 2 - cRect.left) * scale;
            var py = (pRect.bottom - cRect.top) * scale;
            var child = chatById(path.getAttribute('data-child'));
            if (!child) { path.remove(); return; }
            var cr = child.el.getBoundingClientRect();
            var cx = (cr.left + cr.width / 2 - cRect.left) * scale;
            var cy = (cr.top - cRect.top) * scale;
            var my = (py + cy) / 2;
            path.setAttribute('d', 'M' + px + ',' + py + ' C' + px + ',' + my + ' ' + cx + ',' + my + ' ' + cx + ',' + cy);
            path.classList.toggle('sending', !!child.isSending);
            path.classList.toggle('done', !child.isSending && child.history.length > 1);
            var label = document.querySelector('.diverge-link-label[data-child="' + child.id + '"]');
            if (label) {
                label.setAttribute('x', (px + cx) / 2);
                label.setAttribute('y', my - 6);
                label.setAttribute('text-anchor', 'middle');
            }
        });
    }

    /* ================= 收敛：完成检测 + 按钮 ================= */
    function watchChildren(group, box, chat) {
        var timer = setInterval(function () {
            var all = group.children.length > 0 && group.children.every(function (cid) {
                var c = chatById(cid);
                return c && !c.isSending && c.history.length > 1;
            });
            if (all) {
                clearInterval(timer);
                group._ready = true;
                refreshConvergeButtons(group);
                updateDivergeLinks();
                // 自动回炉：所有子视角回复完成后自动收敛，无需手动点击
                if (!group.converged && !group._converging && !group._autoDone) {
                    group._autoDone = true;
                    App.addMsg(box, '🎯 所有视角回复完成，**自动收敛**中…');
                    App.converge(box, chat, group);
                }
            }
        }, 1500);
        group._watchTimer = timer;
    }

    function refreshConvergeButtons(group) {
        var parent = chatById(group.parentId);
        if (!parent) return;
        var btn = parent.el.querySelector('.converge-btn');
        if (btn) {
            btn.classList.toggle('ready', !!group._ready);
            btn.title = group._ready ? '收敛：汇总所有视角回复' : '等待所有子视角回复完成…';
        }
    }

    function attachConvergeButton(box, chat, group) {
        if (box.querySelector('.converge-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'converge-btn';
        btn.innerHTML = '🎯 收敛';
        btn.title = '等待所有子视角回复完成后可收敛';
        btn.addEventListener('click', function () {
            if (!group._ready) { App.addMsg(box, '⏳ 还有子视角未回复完成，请稍候。', 'error'); return; }
            App.converge(box, chat, group);
        });
        var inputRow = box.querySelector('.chatbox-inputrow');
        if (inputRow) inputRow.appendChild(btn);
    }

    /* ================= 收敛执行 ================= */
    App.converge = function (box, chat, group) {
        if (group._converging) return;
        group._converging = true;
        var parts = [];
        group.children.forEach(function (cid, i) {
            var c = chatById(cid);
            if (!c) return;
            // 取子对话最后一条 assistant 回复
            var reply = '';
            for (var j = c.history.length - 1; j >= 0; j--) {
                if (c.history[j].role === 'assistant') { reply = c.history[j].content; break; }
            }
            parts.push({ view: group.views[i] || ('视角' + (i + 1)), reply: reply });
        });

        App.addMsg(box, '🎯 **收敛中**：正在汇总 ' + parts.length + ' 个视角的回复…', 'user');
        Store.addLog('info', chat.id, 'converge', '开始收敛，汇总 ' + parts.length + ' 个视角');

        // 收敛消息：以用户身份注入父对话（真实调用大模型，结论写入父对话上下文）
        var summary = parts.map(function (p, i) {
            return '【视角' + (i + 1) + '：' + p.view + '】\n' + p.reply;
        }).join('\n\n---\n\n');

        var convergeMsg = '## 收敛请求\n' +
            '以下是多个视角对同一问题的发散分析结果，请汇总为一份综合结论：\n' +
            '- 提炼共识（各视角一致的观点）\n- 标注分歧（视角间冲突之处及原因）\n- 给出综合后的行动建议（分点列出）\n' +
            '- 结论要精炼，直接可用。\n\n' + summary;

        chat.history.push({ role: 'user', content: convergeMsg, _convergeRound: true });
        chat._convergeGroup = group;
        App.showQueryPin && App.showQueryPin(box, '🎯 收敛 ' + parts.length + ' 个视角');
        App.sendToModel(box, chat);

        // 收敛完成后恢复状态（监听 isSending 结束）
        var t = setInterval(function () {
            if (!chat.isSending) {
                clearInterval(t);
                group._converging = false;
                group.converged = true;
                // 收敛完成：关闭所有子视角对话（用户反馈：发散出去的子对话要能收回来）
                group.children.forEach(function (cid) {
                    var c = chatById(cid);
                    if (c && typeof App.closeChatBox === 'function') {
                        try { App.closeChatBox(c); } catch (e) {}
                    }
                });
                group.children = [];
                // 移除父对话上的收敛按钮
                var cb = box.querySelector('.converge-btn');
                if (cb) cb.remove();
                removeDivergeLinks(group.parentId);
                if (chat._divergeGroup === group) delete chat._divergeGroup;
                Store.addLog('info', chat.id, 'converge', '收敛完成');
                // 收敛完成：在父对话挂「下一步」询问条（继续讨论 / 转长任务 / 结束）
                attachNextStepBar(box, chat);
            }
        }, 1500);
    };

    /* ================= 收敛完成后的「下一步」询问条 ================= */
    function attachNextStepBar(box, chat) {
        var body = box.querySelector('.chatbox-body');
        if (!body) return;
        var old = box.querySelector('.diverge-nextstep-bar');
        if (old) old.remove();
        var bar = document.createElement('div');
        bar.className = 'diverge-nextstep-bar';
        bar.innerHTML =
            '<span class="dn-label">🎯 收敛完成，接下来？</span>' +
            '<button class="dn-continue" title="回到正常对话，继续和大模型讨论，随时可再点 🔀 发散">💬 继续讨论</button>' +
            '<button class="dn-longtask" title="把收敛结论交给大模型创建超长计划（long_plan）并开始执行">📜 转长任务</button>' +
            '<button class="dn-close" title="结束发散流程">✅ 结束</button>';
        bar.querySelector('.dn-continue').addEventListener('click', function () {
            bar.remove();
            var input = box.querySelector('.chatbox-input');
            if (input) input.focus();
            App.addMsg(box, '💬 已回到正常对话。可以继续讨论，也可以随时再点 🔀 发散。');
        });
        bar.querySelector('.dn-longtask').addEventListener('click', function () {
            bar.remove();
            startLongTaskFromConverge(box, chat);
        });
        bar.querySelector('.dn-close').addEventListener('click', function () {
            bar.remove();
            App.addMsg(box, '✅ 发散收敛流程已结束。');
        });
        body.appendChild(bar);
        body.scrollTop = body.scrollHeight;
    }

    // 转长任务：发一条指令让大模型基于收敛结论创建 long_plan 并开始执行
    function startLongTaskFromConverge(box, chat) {
        if (!chat || chat.isSending) {
            App.addMsg(box, '⚠️ 当前对话正在发送中，请稍后再试。', 'error');
            return;
        }
        // 取最后一条 assistant 消息作为收敛结论
        var conclusion = '';
        for (var i = chat.history.length - 1; i >= 0; i--) {
            if (chat.history[i].role === 'assistant') { conclusion = chat.history[i].content; break; }
        }
        if (!conclusion) {
            App.addMsg(box, '⚠️ 未找到收敛结论，无法转长任务。', 'error');
            return;
        }
        var msg = '基于上面的收敛结论，创建一个超长计划（long_plan）来落地执行：\n' +
            '1. 调用 long_plan.create，把结论拆解为清晰、可逐步验收的步骤（5 步以上请拆细，每步写明说明/产出/验收标准）。\n' +
            '2. 创建成功后立即调用 plan_batch.claim 认领第一批步骤并开始逐项执行，每完成一步 plan_batch.report 汇报。\n' +
            '3. 如果结论信息不足以拆解，先用 ask_user 问我细节，不要瞎编。\n\n' +
            '--- 收敛结论 ---\n' + conclusion;
        chat.history.push({ role: 'user', content: msg, _convergeRound: true });
        App.showQueryPin && App.showQueryPin(box, '📜 收敛结论 → 长任务');
        App.addMsg(box, '📜 正在把收敛结论转为长任务计划…', 'user');
        App.sendToModel(box, chat);
    }

    /* ================= 画布拖动/缩放时刷新连线 ================= */
    var _updRaf = 0;
    function scheduleUpdate() {
        if (_updRaf) return;
        _updRaf = requestAnimationFrame(function () { _updRaf = 0; updateDivergeLinks(); });
    }
    setInterval(scheduleUpdate, 800);

    // 暴露隐式入口：用户在对话中对 AI 说“发散/多视角分析”，AI 或控制台可直接调用
    window.Diverge = {
        start: startDivergePlan,
        config: openDivergePanel,
        quickMenu: openDivergeQuickMenu
    };

})();
