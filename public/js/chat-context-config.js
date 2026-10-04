/* ==================================================
 * chat-context-config.js
 * 对话框引擎下拉菜单右上角 ⚙ 配置按钮：
 * 1. 在每个对话底部引擎下拉菜单(.eng-menu)右上角注入 ⚙ 按钮
 * 2. 点击打开卡片式配置面板（上下文/循环/截断/重试/步骤，每项含👁详细用法）
 * 3. 配置按「对话ID|引擎ID」组合键保存到 localStorage(zfChatCtxCfg.<chatId|engId>)
 *    - 同一对话框切换引擎（上面卡片切换）后，各引擎配置相互独立
 *    - 按钮悬停提示当前引擎与配置状态
 * 4. 支持预设方案保存/套用、恢复默认
 * 5. agent-01 通过 window.ChatContextConfig.getOverride(chatId, engId) 读取
 * ================================================== */
(function () {
    'use strict';

    var LS_OVR = 'zfChatCtxOverrides';       // { "chatId" 或 "chatId|engId": config }
    var LS_TPL = 'zfChatCtxTemplates';       // { name: config } 上限 4 个

    // ===== 组合配置键：chatId + 当前引擎（引擎维度独立配置） =====
    function cfgKey(chatId, engId) {
        var k = chatId || '_global';
        if (engId) k += '|' + engId;
        return k;
    }
    // 读取某个 chatbox 的当前引擎 ID（chat._engine 优先，回退全局 DB）
    function getEngId(box) {
        try {
            if (box && box.__chat && box.__chat._engine !== undefined) return box.__chat._engine || '';
            var id = box ? String(box.id).replace(/^chat-/, '') : '';
            if (typeof Store !== 'undefined' && Store.getChatBox) {
                var chat = Store.getChatBox(id);
                if (chat && chat._engine !== undefined) return chat._engine || '';
            }
            if (typeof DB !== 'undefined' && DB._engine !== undefined) return DB._engine || '';
        } catch (e) {}
        return '';
    }
    function getEngName(engId) {
        if (!engId) {
            // 空引擎 = 服务端默认引擎（zf_core/朱峰底层），显示其真实名称
            try {
                if (typeof DB !== 'undefined' && DB.getEngines) {
                    var enDef = DB.getEngines().filter(function (x) { return x.default; })[0];
                    if (enDef) return (enDef.icon ? enDef.icon + ' ' : '') + enDef.name;
                }
            } catch (e) {}
            return '朱峰底层';
        }
        try {
            if (typeof DB !== 'undefined' && DB.getEngines) {
                var en = DB.getEngines().filter(function (x) { return x.id === engId; })[0];
                if (en) return (en.icon ? en.icon + ' ' : '') + en.name;
            }
        } catch (e) {}
        return engId;
    }

    // ===== 配置项元数据（名称 / 介绍 / 详细用法 / 默认值 / min-max）=====
    var FIELDS = [
        { key: 'enabled', type: 'bool', name: '循环总开关', brief: '启用整体工具循环', detail: '关闭后对话退回普通一问一答模式：模型无法调用工具、无法多轮执行、也无法自主拆解任务。适合纯聊天场景临时关闭。', def: true },
        { key: 'maxRounds', type: 'num', name: '最大执行步数', brief: '整体循环最多执行多少步', detail: '整个工具循环的总步数上限。步数越大，模型可以完成越复杂的任务，但失败时空耗更多 token。达到上限后系统会尝试自动收尾并总结。建议复杂任务设 100~400。', def: 200, min: 1, max: 1000 },
        { key: 'compressAfterMessages', type: 'num', name: '压缩触发条数', brief: '消息达到该条数时自动触发压缩', detail: '对话累积的消息条数达到该值时，旧消息会被摘要压缩以释放上下文空间。设很大（如 99999）可基本不自动压缩。', def: 40, min: 2, max: 99999 },
        { key: 'keepRecentMessages', type: 'num', name: '保留近期消息数', brief: '压缩时始终保留最近N条消息不压缩', detail: '触发压缩时会保留最近 N 条消息原文不参与摘要，保证模型能看到最新的对话状态。建议 10~40。', def: 20, min: 2, max: 200 },
        { key: 'observationDelayMs', type: 'num', name: '观察等待(毫秒)', brief: '工具执行完后的等待时间', detail: '每步工具执行完成后等待的毫秒数，用于等待异步结果/文件刷新。太小可能读到不完整的异步结果，太大会拖慢整体节奏。建议 200~800。', def: 300, min: 0, max: 10000 },
        { key: 'loopBreakLimit', type: 'num', name: '循环打断阈值', brief: '重复行为达到此值时打断循环', detail: '循环检测的基础阈值。值越小越容易判定为死循环并打断，但也可能误伤正常的重复性操作（如批量改文件）。建议 30~80。', def: 50, min: 5, max: 200 },
        { key: 'retryMaxPerRound', type: 'num', name: '轮内重试次数', brief: '一次请求失败后轮内重试上限', detail: '网络错误/5xx 时同一轮内的最多重试次数。设 0 表示失败直接进入下一轮。建议 3~5。', def: 3, min: 0, max: 10 },
        { key: 'retryIntervalMs', type: 'num', name: '重试间隔(毫秒)', brief: '两次重试之间的等待', detail: '同轮重试之间的间隔时间，给服务端喘息时间。建议 2000~5000。', def: 3000, min: 0, max: 60000 },
        { key: 'retryRounds', type: 'num', name: '跨轮重试轮数', brief: '连续失败时跨多少轮继续重试', detail: '请求连续失败时，允许跨多少轮持续重试（每轮之间有较长间隔）。超过后放弃本轮执行。', def: 3, min: 0, max: 10 },
        { key: 'retryRounds429', type: 'num', name: '429限流重试轮数', brief: '遇到429限流时的重试轮数', detail: '429 = 请求过于频繁被限流。系统会按退避表等待后重试，这里控制最多重试几轮。', def: 2, min: 0, max: 10 },
        { key: 'retryRoundIntervalMs', type: 'num', name: '跨轮重试间隔(毫秒)', brief: '跨轮重试之间的长等待', detail: '跨轮重试之间的等待时间，默认 5 分钟。429 限流时建议拉长。', def: 300000, min: 0, max: 3600000 },
        { key: 'rebuild400Max', type: 'num', name: '400重建上限', brief: '上下文超限(400)时重建上下文的最大次数', detail: '收到 400（通常是上下文超长）时，系统会压缩/重建上下文后重试。这里限制最多重建几次，防止无限重建。', def: 10, min: 0, max: 50 },
        { key: 'maxDepthRetries', type: 'num', name: '深度接续次数', brief: '任务未完成时自动接续的最大次数', detail: '一步对话没有完成任务时，系统自动开新一轮继续（深度接续）。此值控制最多自动接续几次。', def: 5, min: 0, max: 30 },
        { key: 'loopArgMaxChars', type: 'num', name: '工具参数截断(字符)', brief: '单个工具参数超过此长度截断', detail: '工具调用参数太长时（如把整个文件当参数）会被截断，防止上下文被单个调用撑爆。', def: 50, min: 10, max: 100000 },
        { key: 'loopSigWindow', type: 'num', name: '签名窗口', brief: '检测重复行为时回看的步数', detail: '循环检测会回看最近 N 步的行为签名（工具+参数摘要），窗口越大越敏感也越耗内存。', def: 200, min: 10, max: 1000 },
        { key: 'loopMinSigCount', type: 'num', name: '签名最小重复数', brief: '签名至少重复几次才计入循环', detail: '同一行为签名在窗口内至少出现几次才被视为疑似循环。调大可减少误判。', def: 3, min: 2, max: 20 },
        { key: 'loopConsecutiveThreshold', type: 'num', name: '连续重复阈值', brief: '连续相同行为多少次打断', detail: '完全相同的（工具+参数）连续出现达到该次数时判定为死循环并打断。', def: 30, min: 3, max: 200 },
        { key: 'loopPatternThreshold', type: 'num', name: '模式重复阈值', brief: '相似模式重复多少次打断', detail: '行为模式（忽略次要参数差异）重复达到该次数时打断。与连续阈值配合使用。', def: 25, min: 3, max: 200 },
        { key: 'loopFreqWindowSteps', type: 'num', name: '频率窗口步数', brief: '统计行为频率的窗口大小', detail: '在最近 N 步内统计各工具调用频率，某个工具占比过高说明可能陷入循环。', def: 30, min: 5, max: 200 },
        { key: 'loopFreqMinSteps', type: 'num', name: '频率最少步数', brief: '频率检测需要的最少步数', detail: '总步数不足该值时不做频率检测（样本太少不可靠）。', def: 20, min: 3, max: 100 },
        { key: 'loopReadOnlyThreshold', type: 'num', name: '只读循环阈值', brief: '连续只读操作多少次警告', detail: '连续执行只读类工具（读文件/搜索等）达到该次数时提示模型该动手干活了。', def: 15, min: 3, max: 100 },
        { key: 'loopWriteThreshold', type: 'num', name: '写入循环阈值', brief: '连续写操作多少次打断', detail: '连续写入类操作达到该次数时打断循环（防止反复覆盖同一文件）。', def: 40, min: 5, max: 200 },
        { key: 'loopReReadWindow', type: 'num', name: '重读窗口', brief: '检测重复读取同一资源的窗口', detail: '在最近 N 步内检测是否反复读取同一文件/同一资源。', def: 50, min: 5, max: 200 },
        { key: 'loopReReadMinSteps', type: 'num', name: '重读最少步数', brief: '重读检测需要的最少步数', detail: '总步数不足该值时不做重读检测。', def: 8, min: 2, max: 100 },
        { key: 'loopReReadThreshold', type: 'num', name: '重读打断阈值', brief: '重复读取同一资源多少次打断', detail: '对同一资源的重复读取达到该次数时打断。默认 99 基本不触发（只记录）。', def: 99, min: 2, max: 999 }
    ];

    // ===== 循环步骤元数据 =====
    var STEPS = [
        { id: 'read', name: '读取上下文', brief: '组装消息/压缩历史', detail: '循环第一步：读取对话历史、按压缩规则裁剪、注入系统提示与工具说明。禁用后循环直接从请求开始（一般保持启用）。', defEnabled: true, defMax: 1 },
        { id: 'think', name: '请求大模型', brief: '调用模型生成回复', detail: '把上下文发给大模型并等待回复。包含重试/限流处理。禁用后循环无法思考（仅调试用）。', defEnabled: true, defMax: 20 },
        { id: 'tools', name: '执行工具', brief: '解析并执行工具调用', detail: '从模型回复中解析工具调用并逐个执行。禁用后模型只能输出文字。限制次数可控制每轮最多执行多少个工具。', defEnabled: true, defMax: 40 },
        { id: 'observe', name: '观察结果', brief: '把工具结果回传模型', detail: '等待 observationDelayMs 后把工具执行结果作为观察消息回传给模型，进入下一轮。', defEnabled: true, defMax: 20 },
        { id: 'compress', name: '压缩', brief: '历史摘要压缩', detail: '当消息数超过压缩触发条数时，对旧历史做摘要压缩。禁用后上下文只增不减，长任务容易撑爆。', defEnabled: true, defMax: 1 }
    ];

    function defaults() {
        var cfg = { enabled: true, steps: [] };
        FIELDS.forEach(function (f) { cfg[f.key] = f.def; });
        STEPS.forEach(function (s) {
            cfg.steps.push({ id: s.id, enabled: s.defEnabled, maxExecutions: s.defMax });
        });
        return cfg;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ===== 存取 =====
    function getAll() {
        try { return JSON.parse(localStorage.getItem(LS_OVR) || '{}'); } catch (e) { return {}; }
    }
    function saveAll(all) {
        try { localStorage.setItem(LS_OVR, JSON.stringify(all)); } catch (e) {}
    }
    function getOvr(key) { return getAll()[key] || null; }
    function setOvr(key, cfg) {
        var all = getAll();
        if (cfg) all[key] = cfg; else delete all[key];
        saveAll(all);
    }
    function effective(chatId, engId) {
        var base = defaults();
        try {
            if (typeof ContextLoopConfig !== 'undefined') {
                var configured = typeof ContextLoopConfig.get === 'function' ? ContextLoopConfig.get()
                    : (typeof ContextLoopConfig.load === 'function' ? ContextLoopConfig.load() : null);
                if (configured && typeof configured === 'object') {
                    Object.keys(configured).forEach(function (k) { if (k !== 'steps') base[k] = configured[k]; });
                    if (Array.isArray(configured.steps) && configured.steps.length) {
                        base.steps = base.steps.map(function (s) {
                            var sv = configured.steps.filter(function (x) { return x && x.id === s.id; })[0];
                            return sv ? Object.assign({}, s, sv) : s;
                        });
                    }
                }
            }
        } catch (e) {}
        var ovr = getOvr(cfgKey(chatId, engId)) || getOvr(chatId) || {};
        Object.keys(ovr).forEach(function (k) { if (k !== 'steps') base[k] = ovr[k]; });
        if (Array.isArray(ovr.steps) && ovr.steps.length) {
            base.steps = base.steps.map(function (s) {
                var sv = ovr.steps.filter(function (x) { return x && x.id === s.id; })[0];
                return sv ? Object.assign({}, s, sv) : s;
            });
        }
        return base;
    }

    // 对外接口：agent-01 读取覆盖配置（chatId + 当前引擎）
    window.ChatContextConfig = {
        getOverride: function (chatId, engId) {
            if (!chatId) return null;
            var eng = engId;
            if (eng === undefined) {
                try { if (typeof DB !== 'undefined' && DB._engine !== undefined) eng = DB._engine || ''; } catch (e) { eng = ''; }
            }
            return getOvr(cfgKey(chatId, eng)) || getOvr(chatId) || null;
        },
        getEffective: effective,
        reset: function (chatId, engId) { setOvr(cfgKey(chatId, engId), null); },
        openPanel: function (box) {
            var chatId = box ? String(box.id).replace(/^chat-/, '') : '';
            openPanel(chatId, box);
        }
    };

    // ===== UI =====
    function card(inner, key) {
        return '<div class="ccf-card" data-card="' + (key || '') + '" style="border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:rgba(128,128,128,.05);">' + inner + '</div>';
    }

    function openPanel(chatId, box, engIdOvr) {
        // engIdOvr：顶部切换菜单选定后重开面板时直接指定引擎，避免依赖 box 实时状态
        var engId = (engIdOvr !== undefined && engIdOvr !== null) ? engIdOvr : getEngId(box);
        var old = document.getElementById('ctx-cfg-mask');
        if (old) old.remove();

        var cfg = effective(chatId, engId);
        var isOvr = !!getOvr(cfgKey(chatId, engId));
        var draft = JSON.parse(JSON.stringify(cfg));
        draft._enabled = draft.enabled;

        var mask = document.createElement('div');
        mask.id = 'ctx-cfg-mask';
        mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'position:relative;background:var(--bg,#1e1e1e);color:var(--text,#eee);border-radius:12px;width:660px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.5);border:1px solid rgba(128,128,128,.3);';

        var html = '';
        html += '<div style="padding:14px 18px;border-bottom:1px solid rgba(128,128,128,.25);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
            + '<span style="font-weight:600;font-size:15px;">⚙ 对话循环配置</span>'
            + '<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(64,158,255,.15);color:#6db3f2;">对话: ' + esc(chatId) + '</span>'
            // ---- 引擎切换按钮组（顶部一排，直接点击切换并重开面板加载对应引擎配置）----
            + '<div id="ccf-eng-btns" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;"></div>'
            + '<span class="ccf-eng-badge" style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(139,109,255,.15);color:#a68bff;">引擎: ' + esc(getEngName(engId)) + '</span>'
            + (isOvr ? '<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(255,160,0,.2);color:#e8a33d;">已自定义</span>' : '<span style="font-size:11px;opacity:.5;">默认</span>') + '</div>';
        // 关闭按钮固定在面板右上角（绝对定位，不受标题内容换行影响）
        var closeBtn = document.createElement('span');
        closeBtn.id = 'ccf-close';
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'position:absolute;top:6px;right:12px;cursor:pointer;opacity:.6;font-size:18px;line-height:1;z-index:2;padding:2px 6px;';
        closeBtn.onmouseover = function(){ closeBtn.style.opacity = '1'; };
        closeBtn.onmouseout = function(){ closeBtn.style.opacity = '.6'; };
        panel.appendChild(closeBtn);

        html += '<div id="ccf-body" style="padding:12px 18px;overflow-y:auto;flex:1;">';

        // ---- 总开关 ----
        html += card('<label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="ccf-master" ' + (draft.enabled ? 'checked' : '') + '> <b>启用智能体循环</b><span style="opacity:.6;font-size:12px;margin-left:auto;">关闭后退回普通对话</span></label>', null);

        // ---- 全局参数卡片 ----
        html += '<div style="font-size:12px;font-weight:600;opacity:.6;margin:10px 0 6px;">循环 / 重试 / 截断规则（名称+介绍，点 👁 看详细用法）</div>';
        FIELDS.forEach(function (f) {
            if (f.key === 'enabled') return;
            var v = draft[f.key];
            var eye = '<span class="ccf-eye" data-k="' + f.key + '" title="查看详细用法" style="cursor:pointer;opacity:.4;font-size:13px;flex-shrink:0;">👁</span>';
            var ctrl;
            if (f.type === 'bool') {
                ctrl = '<input type="checkbox" class="ccf-f" data-k="' + f.key + '" data-t="bool" ' + (v ? 'checked' : '') + '>';
            } else {
                ctrl = '<input type="number" class="ccf-f" data-k="' + f.key + '" data-t="num" value="' + esc(v) + '" min="' + f.min + '" max="' + f.max + '" style="width:90px;background:rgba(128,128,128,.12);color:inherit;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:3px 6px;">';
            }
            html += card('<div style="display:flex;align-items:center;gap:8px;"><div style="min-width:0;"><div style="font-size:13px;font-weight:500;">' + esc(f.name) + '</div><div style="font-size:11px;opacity:.6;">' + esc(f.brief) + '</div></div><div style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-shrink:0;">' + ctrl + eye + '</div></div>'
                + '<div class="ccf-detail" data-dk="' + f.key + '" style="display:none;margin-top:8px;padding:8px 10px;background:rgba(128,128,128,.1);border-radius:8px;font-size:12px;line-height:1.6;opacity:.85;">' + esc(f.detail) + '</div>', f.key);
        });

        // ---- 循环步骤卡片 ----
        html += '<div style="font-size:12px;font-weight:600;opacity:.6;margin:12px 0 6px;">循环步骤（每步可启用/禁用并限制次数）</div>';
        STEPS.forEach(function (s) {
            var st = (draft.steps || []).filter(function (x) { return x.id === s.id; })[0] || { enabled: s.defEnabled, maxExecutions: s.defMax };
            var eye = '<span class="ccf-eye" data-k="step-' + s.id + '" title="查看详细用法" style="cursor:pointer;opacity:.4;font-size:13px;flex-shrink:0;">👁</span>';
            html += card('<div style="display:flex;align-items:center;gap:8px;">'
                + '<input type="checkbox" class="ccf-step-en" data-sid="' + s.id + '" ' + (st.enabled ? 'checked' : '') + '>'
                + '<div style="min-width:0;"><div style="font-size:13px;font-weight:500;">' + esc(s.name) + '</div><div style="font-size:11px;opacity:.6;">' + esc(s.brief) + '</div></div>'
                + '<div style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-shrink:0;">'
                + '<span style="font-size:11px;opacity:.6;">次数上限</span>'
                + '<input type="number" class="ccf-step-max" data-sid="' + s.id + '" value="' + esc(st.maxExecutions) + '" min="1" max="9999" style="width:70px;background:rgba(128,128,128,.12);color:inherit;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:3px 6px;">'
                + eye + '</div></div>'
                + '<div class="ccf-detail" data-dk="step-' + s.id + '" style="display:none;margin-top:8px;padding:8px 10px;background:rgba(128,128,128,.1);border-radius:8px;font-size:12px;line-height:1.6;opacity:.85;">' + esc(s.detail) + '</div>', 'step-' + s.id);
        });

        // ---- 底部操作 ----
        html += '</div>';
        html += '<div style="padding:12px 18px;border-top:1px solid rgba(128,128,128,.25);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            + '<button id="ccf-save" style="padding:6px 16px;border:none;border-radius:8px;background:#2f6fed;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">保存（仅此对话+此引擎）</button>'
            + '<button id="ccf-reset" style="padding:6px 12px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:12px;">恢复默认</button>'
            + '<span style="flex:1;"></span>'
            + '<select id="ccf-tpl-sel" style="background:rgba(128,128,128,.12);color:inherit;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:4px 6px;font-size:12px;max-width:140px;"><option value="">— 预设方案 —</option></select>'
            + '<button id="ccf-tpl-use" style="padding:5px 10px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:12px;">套用</button>'
            + '<button id="ccf-tpl-save" style="padding:5px 10px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:12px;">存为预设</button>'
            + '<button id="ccf-tpl-del" style="padding:5px 10px;border:1px solid rgba(244,67,54,.5);border-radius:8px;background:transparent;color:#f44336;cursor:pointer;font-size:12px;">删预设</button>'
            + '</div>';

        panel.innerHTML = html;
        // innerHTML 重挂后再把右上角关闭按钮插回面板（防止被 innerHTML 覆盖）
        panel.appendChild(closeBtn);
        mask.appendChild(panel);
        document.body.appendChild(mask);

        // ---- 顶部引擎切换按钮组：一排按钮直接点击切换，切换后立即重开面板加载该引擎的配置 ----
        (function () {
            var wrap = panel.querySelector('#ccf-eng-btns');
            if (!wrap) return;
            var engs = [{ id: '', name: '朱峰底层' }];
            try {
                if (typeof DB !== 'undefined' && DB.getEngines) {
                    DB.getEngines().forEach(function (e) {
                        engs.push({ id: e.id, name: (e.icon ? e.icon + ' ' : '') + e.name });
                    });
                }
            } catch (e) {}
            wrap.innerHTML = engs.map(function (e, i) {
                var hasOvr = !!getOvr(cfgKey(chatId, e.id));
                var cur = e.id === engId;
                return '<button class="ccf-eng-btn" data-eng="' + esc(e.id) + '" data-i="' + i + '" title="切换到「' + esc(e.name) + '」的循环配置" style="'
                    + 'border:1px solid ' + (cur ? 'rgba(139,109,255,.9)' : 'rgba(128,128,128,.35)') + ';'
                    + 'background:' + (cur ? 'rgba(139,109,255,.25)' : 'rgba(128,128,128,.10)') + ';'
                    + 'color:' + (cur ? '#c5b3ff' : 'inherit') + ';'
                    + 'border-radius:14px;padding:3px 12px;font-size:12px;cursor:pointer;white-space:nowrap;line-height:1.5;">'
                    + esc(e.name) + (hasOvr ? ' <span style="color:#e8a33d;" title="该引擎已自定义配置">●</span>' : '')
                    + '</button>';
            }).join('');
            wrap.addEventListener('click', function (e) {
                e.stopPropagation();
                var btn = e.target.closest('.ccf-eng-btn');
                if (!btn) return;
                var newEng = btn.getAttribute('data-eng') || '';
                if (newEng === engId) return;
                mask.remove();
                try { if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('info', chatId, 'ctx-config', '切换配置面板引擎 → ' + getEngName(newEng)); } catch (e) {}
                openPanel(chatId, box, newEng);
            });
        })();

        // ---- 关闭 ----
        panel.querySelector('#ccf-close').onclick = function () { mask.remove(); };
        mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });

        // ---- 眼睛：展开/收起详细用法 ----
        panel.querySelectorAll('.ccf-eye').forEach(function (eye) {
            eye.addEventListener('click', function () {
                var d = panel.querySelector('.ccf-detail[data-dk="' + this.dataset.k + '"]');
                if (d) d.style.display = (d.style.display === 'none') ? 'block' : 'none';
            });
        });

        // ---- 收集当前面板值 ----
        function collect() {
            var out = { enabled: panel.querySelector('#ccf-master').checked, steps: [] };
            panel.querySelectorAll('.ccf-f').forEach(function (inp) {
                out[inp.dataset.k] = inp.dataset.t === 'bool' ? inp.checked : Number(inp.value);
            });
            STEPS.forEach(function (s) {
                var en = panel.querySelector('.ccf-step-en[data-sid="' + s.id + '"]');
                var mx = panel.querySelector('.ccf-step-max[data-sid="' + s.id + '"]');
                out.steps.push({ id: s.id, enabled: en ? en.checked : true, maxExecutions: mx ? Number(mx.value) : s.defMax });
            });
            return out;
        }

        // ---- 保存 ----
        panel.querySelector('#ccf-save').onclick = function () {
            setOvr(cfgKey(chatId, engId), collect());
            mask.remove();
            try { if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('info', chatId, 'ctx-config', '已保存对话循环配置 (引擎: ' + getEngName(engId) + ')'); } catch (e) {}
        };

        // ---- 恢复默认 ----
        panel.querySelector('#ccf-reset').onclick = function () {
            setOvr(cfgKey(chatId, engId), null);
            mask.remove();
        };

        // ---- 预设方案 ----
        function getTpls() { try { return JSON.parse(localStorage.getItem(LS_TPL) || '{}'); } catch (e) { return {}; } }
        function refreshTplSel(sel) {
            sel.innerHTML = '<option value="">— 预设方案 —</option>';
            var t = getTpls();
            Object.keys(t).forEach(function (n) {
                var o = document.createElement('option');
                o.value = n; o.textContent = n;
                sel.appendChild(o);
            });
        }
        var sel = panel.querySelector('#ccf-tpl-sel');
        refreshTplSel(sel);
        panel.querySelector('#ccf-tpl-use').onclick = function () {
            var t = getTpls()[sel.value];
            if (!t) return;
            // 套用：把预设值写入面板控件
            panel.querySelector('#ccf-master').checked = t.enabled !== false;
            panel.querySelectorAll('.ccf-f').forEach(function (inp) {
                if (inp.dataset.t === 'bool') inp.checked = !!t[inp.dataset.k];
                else if (t[inp.dataset.k] !== undefined) inp.value = t[inp.dataset.k];
            });
            (t.steps || []).forEach(function (sv) {
                var en = panel.querySelector('.ccf-step-en[data-sid="' + sv.id + '"]');
                var mx = panel.querySelector('.ccf-step-max[data-sid="' + sv.id + '"]');
                if (en) en.checked = sv.enabled !== false;
                if (mx && sv.maxExecutions != null) mx.value = sv.maxExecutions;
            });
        };
        panel.querySelector('#ccf-tpl-save').onclick = function () {
            var t = getTpls();
            var names = Object.keys(t);
            if (names.length >= 4 && !t['_slot' + names.length]) {
                alert('预设方案最多 4 个，请先删除不需要的。'); return;
            }
            var name = '';
            // 自定义输入对话框（不用 window.prompt）
            (function () {
                var dlg = document.createElement('div');
                dlg.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:10001;display:flex;align-items:center;justify-content:center;';
                dlg.innerHTML = '<div style="background:var(--bg,#1e1e1e);color:inherit;border:1px solid rgba(128,128,128,.4);border-radius:12px;padding:18px 20px;min-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.5);">'
                    + '<div style="font-size:13px;margin-bottom:10px;">预设方案名称：</div>'
                    + '<input id="ccf-tpl-name" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid rgba(128,128,128,.5);border-radius:8px;background:transparent;color:inherit;font-size:13px;" maxlength="30">'
                    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">'
                    + '<button id="ccf-tpl-cancel" style="padding:6px 14px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:12px;">取消</button>'
                    + '<button id="ccf-tpl-ok" style="padding:6px 14px;border:none;border-radius:8px;background:#4a90d9;color:#fff;cursor:pointer;font-size:12px;">保存</button>'
                    + '</div></div>';
                panel.appendChild(dlg);
                var input = dlg.querySelector('#ccf-tpl-name');
                input.value = '方案' + (names.length + 1);
                input.focus();
                input.select();
                function close() { dlg.remove(); }
                function ok() {
                    name = input.value.trim();
                    close();
                    if (!name) return;
                    t[name] = collect();
                    while (Object.keys(t).length > 4) { delete t[Object.keys(t)[0]]; }
                    localStorage.setItem(LS_TPL, JSON.stringify(t));
                    refreshTplSel(sel);
                    sel.value = name;
                }
                dlg.querySelector('#ccf-tpl-cancel').onclick = close;
                dlg.querySelector('#ccf-tpl-ok').onclick = ok;
                input.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') ok();
                    if (e.key === 'Escape') close();
                });
                dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
            })();
            if (!name) return;
            t[name] = collect();
            while (Object.keys(t).length > 4) { delete t[Object.keys(t)[0]]; }
            localStorage.setItem(LS_TPL, JSON.stringify(t));
            refreshTplSel(sel);
            sel.value = name;
        };
        panel.querySelector('#ccf-tpl-del').onclick = function () {
            if (!sel.value) return;
            var t = getTpls();
            delete t[sel.value];
            localStorage.setItem(LS_TPL, JSON.stringify(t));
            refreshTplSel(sel);
        };
    }

    // ===== 注入 ⚙ 按钮到 .eng-menu 右上角 =====
    function injectBtn(engMenu, box) {
        // 新版引擎菜单顶部已有 .eng-set-btn（打开引擎参数 / 循环配置），不再重复注入旧齿轮；
        // 并清理已存在的旧按钮，避免图标重复
        var old = engMenu.querySelector('.ctx-cfg-btn');
        if (engMenu.querySelector('.eng-set-btn')) {
            if (old) old.remove();
            return;
        }
        if (old) return;
        var btn = document.createElement('div');
        btn.className = 'ctx-cfg-btn';
        btn.textContent = '⚙';
        btn.title = '配置本对话循环规则（上下文/重试/截断/步骤）';
        btn.style.cssText = 'position:absolute;top:4px;right:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;'
            + 'border-radius:6px;cursor:pointer;font-size:13px;opacity:.55;background:rgba(128,128,128,.12);z-index:5;';
        btn.addEventListener('mouseenter', function () {
            btn.style.opacity = '1';
            var engId = getEngId(box);
            var chatId = box ? box.id.replace(/^chat-/, '') : '';
            var has = !!getOvr(cfgKey(chatId, engId));
            btn.title = '配置循环规则 · 当前引擎: ' + getEngName(engId) + (has ? ' · 已自定义' : ' · 默认');
        });
        btn.addEventListener('mouseleave', function () { btn.style.opacity = '.55'; });
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var chatId = box ? box.id.replace(/^chat-/, '') : '';
            openPanel(chatId, box);
        });
        engMenu.appendChild(btn);
        // 引擎菜单需要 relative 定位才能挂右上角
        try {
            var pos = getComputedStyle(engMenu).position;
            if (pos === 'static') engMenu.style.position = 'relative';
        } catch (e) {}
    }

    function scan() {
        try {
            document.querySelectorAll('.eng-menu').forEach(function (m) {
                var box = m.closest('.chat-box, .chatbox, [id^="chat-"]') || m.parentElement;
                injectBtn(m, box);
            });
        } catch (e) {}
    }

    // 引擎切换后按钮悬停提示会即时重算，无需额外监听；定时扫描兜底（菜单被重建后自动补挂）
    setInterval(scan, 1200);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else scan();
})();
