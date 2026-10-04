/* ============================================================
 * chat-tool-toggles.js —— 对话级工具开关（每个对话独立，持久化）
 *
 * 功能：
 *   1. 在每个对话框「工具分类」下拉菜单(.tool-cat-menu)右上角注入 ⚙ 按钮
 *      （风格与 .eng-menu 右上角的 ⚙ 循环配置按钮一致）；
 *   2. 点击弹出对话框，中文列表（多选 checkbox）展示当前分类全部工具：
 *      工具中文名 + 英文小字 + 备注（取工具 description）；
 *   3. 顶部「全选 / 全不选」快捷按钮；
 *   4. 开关按对话 ID 独立保存到 localStorage(zfChatToolToggles)，
 *      重启 / 刷新后自动恢复，各对话互不影响；
 *   5. 通过包装 Tools.getDefinitions 过滤工具 schema，
 *      被关闭的工具不再下发给模型（meta 工具始终保留）。
 * ============================================================ */
(function () {
    'use strict';

    var LS_KEY = 'zfChatToolToggles';
    // 始终保留的核心元工具（关掉会破坏对话闭环）
    var META = ['task_complete', 'switch_tool_category', 'ask_user'];

    // ===== 工具中文名映射（未覆盖的回退英文原名） =====
    var CN = {
        task_complete: '结束任务', switch_tool_category: '切换工具分类', ask_user: '向用户提问',
        read_file: '读取文件', read_lines: '按行读取文件', write_file: '写入文件', run_code: '运行代码',
        replace_text: '替换文本', tree_dir: '目录树', find_files: '查找文件', search_in_files: '内容搜索',
        file_info: '文件信息', move_file: '移动文件', project_record: '项目记录', long_plan: '长期计划',
        plan_batch: '计划分批执行', task_list: '任务清单', get_tool_result: '取回存档结果',
        browser_control: '浏览器控制', image_gen: '图片生成', video_gen: '视频生成',
        video_edit: '视频编辑', video_status: '视频状态', set_camera: '设置相机', monitor: '系统监控',
        dispatch_swarm: '蜂群派发', chat_context: '对话上下文', chat_manage: '对话管理',
        chat_summary: '对话摘要', code_outline: '代码大纲', diff_preview: '差异预览',
        git_log: 'Git 日志', git_save: 'Git 保存', timeline: '时间线', list_dir: '列目录',
        locate_mouse: '鼠标定位', control_keyboard: '键盘控制', long_term_memory: '长期记忆',
        net: '网络请求', query_answers: '查询答案', ram_cache: '内存缓存', recent_questions: '近期问题',
        regex_search: '正则搜索', schedule: '定时计划', search_chat: '搜索对话', send_email: '发送邮件',
        switch_port: '切换端口', wait: '等待', work_order: '工单', table_memory: '表格记忆',
        table_viewer: '表格查看器',
        rewrite_text: '改写文本', expand_text: '扩写文本', shorten_text: '精简文本', polish_text: '润色文本',
        translate_text: '翻译文本', proofread_text: '校对文本', change_tone: '语气改写',
        professional_edit: '专业编辑', fix_punctuation: '标点修正', convert_chars: '繁简转换',
        summarize_text: '总结文本', write_outline: '写大纲', quick_article: '快速成文',
        extract_keywords: '提取关键词', extract_outline: '提取大纲', analyze_sentiment: '情感分析',
        detect_style: '文风检测', rate_article: '文章评分', detect_sensitive: '敏感词检测',
        analyze_text_metrics: '文本统计', generate_title: '生成标题', generate_quotes: '生成金句',
        generate_hook: '生成钩子',
        // ===== 黑客 / 网络 =====
        net_ping: 'Ping 探测', port_scan: '端口扫描', dns_query: 'DNS 查询', http_probe: 'HTTP 探活',
        http_headers: 'HTTP 响应头', ssl_check: 'SSL 证书检查', whois_query: 'WHOIS 查询', traceroute: '路由追踪',
        ip_geo: 'IP 归属地', cdn_check: 'CDN 检测', subdomain_enum: '子域名枚举', password_audit: '密码强度自检',
        sensitive_file_probe: '敏感文件探测',
        // ===== 写作补充 =====
        adapt_audience: '适配受众', bystander_view: '旁观者视角', novice_view: '新手视角',
        opposing_view: '对立观点', expert_review: '专家评审', fact_check: '事实核查',
        color_text: '润色文字', compare_text: '文本对比', format_beautify: '格式美化',
        generate_description: '生成描述', group_discussion: '小组讨论', interpret_document: '文档解读',
        list_formats: '列出格式', optimize_ends: '优化结尾', play_devil_advocate: '魔鬼代言人',
        praise_text: '赞赏点评', role_brainstorm: '角色头脑风暴', seo_optimize: 'SEO 优化'
    };

    // ===== 持久化存储 =====
    var store = {};
    try { store = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { store = {}; }
    function save() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {}
    }

    window.Tools = window.Tools || {};
    Tools.chatToolToggles = store;   // { chatId: { toolName: true/false } }

    // ===== 包装 getDefinitions：按对话开关过滤 schema =====
    if (!Tools._origGetDefinitions) {
        Tools._origGetDefinitions = Tools.getDefinitions;
        Tools.getDefinitions = function (options, chatId) {
            var list = this._origGetDefinitions ? this._origGetDefinitions.call(this, options, chatId) : [];
            var cid = chatId || this.currentChatId;
            var tg = (cid && store[cid]) || null;
            if (!tg) return list;
            return list.filter(function (t) {
                var n = t && t.function && t.function.name;
                if (!n) return true;
                if (META.indexOf(n) >= 0) return true;   // 元工具始终保留
                return tg[n] !== false;                  // 未配置视为开启
            });
        };
    }

    // ===== 当前对话的分类名 =====
    function getCatName(chatId) {
        return (Tools.chatCategories && Tools.chatCategories[chatId]) || Tools.activeCategory || '极简';
    }

        // ===== 注入 ⚙ 按钮到分类菜单 .tool-cat-menu 内部右上角 =====
    function injectGear(wrap) {
        if (!wrap) return;
        // 菜单内容可能被 innerHTML 重建，每次检查补挂
        // 只注入到真正的分类菜单；找不到时跳过（绝不能兜底挂到 wrap，
        // 否则 ⚙ 会以绝对定位出现在「极简」触发按钮旁，看起来莫名其妙）
        var menu = wrap.querySelector('.tool-cat-menu');
        if (!menu) return;
        // 移除历史残留的旧按钮，避免图标重复
        var oldBtn = menu.querySelector('.tool-toggle-btn');
        if (oldBtn) oldBtn.remove();
        menu.__chatbox = wrap.closest('.chatbox') || wrap.closest('[id^="chat-"]');
        var btn = document.createElement('div');
        btn.className = 'tool-toggle-btn';
        btn.title = '修改本对话可用工具';
        btn.textContent = '⚙';
        // 挂在菜单右上角（与 .eng-menu 的 ⚙ 配置按钮风格一致）
        btn.style.cssText = 'position:absolute;top:4px;right:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;'
            + 'border-radius:6px;cursor:pointer;font-size:13px;opacity:.55;background:rgba(128,128,128,.12);z-index:5;';
        btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
        btn.addEventListener('mouseleave', function () { btn.style.opacity = '.55'; });
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var box = btn.closest('.chatbox') || btn.closest('[id^="chat-"]') || menu.__chatbox;
            openDialog(box, box ? box.id : '');
        });
        menu.appendChild(btn);
        // 菜单需要 relative 定位才能挂右上角
        try {
            var pos = getComputedStyle(menu).position;
            if (pos === 'static') menu.style.position = 'relative';
        } catch (e) {}
    }

    // 兜底轮询：所有 .tool-cat-wrap 注入按钮（覆盖各种创建路径）
    setInterval(function () {
        var wraps = document.querySelectorAll('.tool-cat-wrap');
        for (var i = 0; i < wraps.length; i++) injectGear(wraps[i]);
    }, 1200);

    // ===== 对话框 =====
    function openDialog(box, chatId, tabCat) {
        closeDialog();
        if (!chatId) return;
        var catName = tabCat || getCatName(chatId);
        var cat = Tools.categories && Tools.categories[catName];
        // 解析 includes：分类可声明 includes:["极简"]，动态继承被包含分类中当前启用的工具
        function resolveTools(cname, seen) {
            seen = seen || {};
            if (seen[cname]) return [];
            seen[cname] = true;
            var c = Tools.categories && Tools.categories[cname];
            if (!c) return [];
            var list = (c.tools || []).slice();
            (c.includes || []).forEach(function (inc) {
                resolveTools(inc, seen).forEach(function (n) {
                    if (list.indexOf(n) < 0) list.push(n);
                });
            });
            return list;
        }
        var tools = resolveTools(catName);
        var tg = store[chatId] || (store[chatId] = {});

        var mask = document.createElement('div');
        mask.id = 'chat-tool-toggle-mask';
        mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998;display:flex;align-items:center;justify-content:center;';

        var catNames = Tools.categories ? Object.keys(Tools.categories) : [catName];
        if (catNames.indexOf(catName) < 0) catNames.unshift(catName);
        var tabsHtml = catNames.map(function (c) {
            var short = esc(c).replace(/引擎/g, '');
            return '<span class="ctt-tab" data-cat="' + esc(c) + '" title="' + esc(c) + '" style="padding:3px 10px;border-radius:14px;cursor:pointer;font-size:12px;white-space:nowrap;' +
                (c === catName ? 'background:#4a7dff;color:#fff;font-weight:600;' : 'background:rgba(128,128,128,.12);') + '">' + short + '</span>';
        }).join('');
        var html = '<div id="ctt-dialog" style="background:var(--panel-bg,#1e1e2e);color:var(--text,#eee);border:1px solid rgba(128,128,128,.35);border-radius:12px;width:860px;max-width:94vw;max-height:82vh;display:flex;flex-direction:column;position:relative;box-shadow:0 8px 32px rgba(0,0,0,.5);">' +
            '<div style="padding:12px 16px 8px;font-weight:600;font-size:14px;border-bottom:1px solid rgba(128,128,128,.25);display:flex;justify-content:space-between;align-items:center;">' +
            '<span>🔧 本对话可用工具 — ' + esc(chatId) + '</span>' +
            '<span id="ctt-close" style="cursor:pointer;opacity:.6;font-size:16px;">✕</span></div>' +
            '<div style="padding:6px 16px 0;display:flex;gap:5px;flex-wrap:wrap;row-gap:6px;">' + tabsHtml + '</div>' +
            '<div style="padding:6px 16px 0;font-size:11px;opacity:.55;">关闭的工具下次对话立即生效</div>' +
            '<div id="ctt-list" style="flex:1;overflow-y:auto;padding:10px 16px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;align-content:start;">';
        tools.forEach(function (name) {
            var isMeta = META.indexOf(name) >= 0;
            var checked = isMeta || tg[name] !== false;
            var t = Tools.allTools && Tools.allTools[name];
            var desc = (t && t.function && t.function.description) || '';
            if (desc.length > 30) desc = desc.slice(0, 30) + '…';
            html += '<label style="display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px solid rgba(128,128,128,.25);border-radius:10px;cursor:pointer;' + (isMeta ? 'opacity:.55;' : '') + '">' +
                '<input type="checkbox" class="ctt-cb" data-tool="' + esc(name) + '"' + (checked ? ' checked' : '') + (isMeta ? ' disabled' : '') + ' style="margin-top:3px;cursor:pointer;">' +
                '<span style="line-height:1.4;min-width:0;"><b style="font-size:13px;">' + esc(CN[name] || name) + '</b>' +
                ' <small style="opacity:.5;font-size:10px;font-family:monospace;">' + esc(name) + (isMeta ? '（系统必需）' : '') + '</small>' +
                (desc ? '<br><span style="opacity:.65;font-size:11px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(desc) + '</span>' : '') +
                '</span>' +
                '<span class="ctt-view-btn" data-tool="' + esc(name) + '" title="查看完整说明（可复制）" style="margin-left:auto;flex-shrink:0;align-self:flex-start;cursor:pointer;opacity:.45;font-size:13px;padding:2px 4px;line-height:1;" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'.45\'">👁</span>' +
                '</label>';
        });
        // ===== 配置模板栏（4 个预制槽位：载入 / 存入 / 删除，localStorage 持久化，按分类独立） =====
        var TPL_KEY = 'zfChatToolTemplates';
        var TPL_SLOTS = 4;
        function loadTpls() { try { return JSON.parse(localStorage.getItem(TPL_KEY) || '{}') || {}; } catch (e) { return {}; } }
        function saveTpls(s) { try { localStorage.setItem(TPL_KEY, JSON.stringify(s)); } catch (e) {} }
        function tplKey(slot) { return catName + '::' + slot; }
        // ===== 自建弹窗（替代原生 prompt/confirm） =====
        function showMiniDialog(opts) {
            // opts: { title, inputValue, confirmText, danger, onOk(inputVal), onCancel }
            var old = document.getElementById('ctt-mini-dialog'); if (old) old.remove();
            var mini = document.createElement('div');
            mini.id = 'ctt-mini-dialog';
            mini.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;';
            var inputHtml = opts.inputValue !== undefined
                ? '<input id="ctt-mini-input" value="' + esc(String(opts.inputValue || '')) + '" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:rgba(128,128,128,.08);color:inherit;font-size:13px;outline:none;">'
                : '';
            mini.innerHTML = '<div style="background:var(--panel-bg,#1e1e2e);color:var(--text,#eee);border:1px solid rgba(128,128,128,.35);border-radius:12px;width:360px;max-width:90vw;padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.5);">'
                + '<div style="font-size:14px;font-weight:600;margin-bottom:12px;">' + esc(opts.title || '') + '</div>'
                + inputHtml
                + '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">'
                + '<button id="ctt-mini-cancel" style="padding:6px 16px;cursor:pointer;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;">取消</button>'
                + '<button id="ctt-mini-ok" style="padding:6px 16px;cursor:pointer;border-radius:8px;border:none;font-weight:600;color:#fff;background:' + (opts.danger ? '#e5484d' : '#4a7dff') + ';">' + esc(opts.confirmText || '确定') + '</button>'
                + '</div></div>';
            document.body.appendChild(mini);
            function close(val) { mini.remove(); if (val) { opts.onOk && opts.onOk(val); } else { opts.onCancel && opts.onCancel(); } }
            var input = mini.querySelector('#ctt-mini-input');
            if (input) {
                input.focus(); input.select();
                input.addEventListener('keydown', function (e) { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(null); });
            }
            mini.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(null); });
            mini.addEventListener('click', function (e) { if (e.target === mini) close(null); });
            mini.querySelector('#ctt-mini-cancel').onclick = function () { close(null); };
            mini.querySelector('#ctt-mini-ok').onclick = function () { close(input ? input.value : true); };
            return mini;
        }
        function tplBarHtml() {
            var tpls = loadTpls();
            var h = '<span style="font-size:12px;font-weight:600;opacity:.75;">💾 配置模板：</span>';
            for (var i = 0; i < TPL_SLOTS; i++) {
                var t = tpls[tplKey(i)];
                var label = t ? t.name : '空槽位' + (i + 1);
                h += '<span class="ctt-tpl-slot" data-slot="' + i + '" style="display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 10px;border:1px solid rgba(128,128,128,.35);border-radius:14px;font-size:12px;' + (t ? 'border-color:#4a7dff;' : 'opacity:.75;') + '">' +
                    '<span class="ctt-tpl-load" data-slot="' + i + '" style="cursor:pointer;" title="载入该模板（覆盖当前勾选状态）">' + esc(label) + '</span>' +
                    '<span class="ctt-tpl-save" data-slot="' + i + '" style="cursor:pointer;opacity:.6;padding:0 3px;" title="把当前勾选状态保存到该槽位">💾</span>' +
                    (t ? '<span class="ctt-tpl-del" data-slot="' + i + '" style="cursor:pointer;opacity:.6;padding:0 3px;" title="删除该模板">🗑</span>' : '') +
                    '</span>';
            }
            return h;
        }
        html += '</div>' +
            '<div class="ctt-tpl-bar" style="padding:8px 16px 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px dashed rgba(128,128,128,.25);">' + tplBarHtml() + '</div>' +
            '<div style="padding:10px 16px;border-top:1px solid rgba(128,128,128,.25);display:flex;gap:10px;align-items:center;justify-content:space-between;">' +
            '<button id="ctt-bulk-btn" style="cursor:pointer;font-size:12px;padding:6px 16px;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:rgba(128,128,128,.12);color:inherit;">✅ 全选</button>' +
            '<div style="display:flex;gap:10px;">' +
            '<button id="ctt-cancel" style="padding:6px 18px;cursor:pointer;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;">取消</button>' +
            '<button id="ctt-save" style="padding:6px 18px;cursor:pointer;border-radius:8px;border:none;background:#4a7dff;color:#fff;font-weight:600;">保存</button></div></div>' +
            '</div>';
        mask.innerHTML = html;
        document.body.appendChild(mask);

        mask.addEventListener('click', function (e) { if (e.target === mask) closeDialog(); });
        var tabs = mask.querySelectorAll('.ctt-tab');
        for (var ti = 0; ti < tabs.length; ti++) {
            tabs[ti].addEventListener('click', (function (cat) {
                return function () { closeDialog(); openDialog(box, chatId, cat); };
            })(tabs[ti].getAttribute('data-cat')));
        }
        mask.querySelector('#ctt-close').onclick = closeDialog;
        mask.querySelector('#ctt-cancel').onclick = closeDialog;
        // ===== 模板事件：载入 / 存入 / 删除 =====
        function currentChecks() {
            var obj = {};
            mask.querySelectorAll('.ctt-cb').forEach(function (cb) { obj[cb.getAttribute('data-tool')] = cb.checked; });
            return obj;
        }
        function applyChecks(obj) {
            mask.querySelectorAll('.ctt-cb').forEach(function (cb) {
                var n = cb.getAttribute('data-tool');
                if (META.indexOf(n) >= 0) return; // 元工具不可关
                cb.checked = obj[n] !== false;
            });
        }
        function renderTplBar() {
            var bar = mask.querySelector('.ctt-tpl-bar');
            if (bar) bar.innerHTML = tplBarHtml();
            bindTplEvents();
        }
        function bindTplEvents() {
            var tpls;
            mask.querySelectorAll('.ctt-tpl-load').forEach(function (el) {
                el.onclick = function (ev) {
                    ev.stopPropagation();
                    var slot = el.getAttribute('data-slot');
                    var t = loadTpls()[tplKey(slot)];
                    if (!t) { // 空槽位：提示先存入
                        try { (window.App && App.showToast || window.showToast || function(){}).call(null, '该槽位为空，请先点 💾 存入当前配置'); } catch (e) {}
                        return;
                    }
                    applyChecks(t.checks || {});
                    try { (window.App && App.showToast || window.showToast || function(){}).call(null, '✅ 已载入模板「' + (t.name || '槽位' + slot) + '」，点保存后生效'); } catch (e) {}
                };
            });
            mask.querySelectorAll('.ctt-tpl-save').forEach(function (el) {
                el.onclick = function (ev) {
                    ev.stopPropagation();
                    var slot = el.getAttribute('data-slot');
                    showMiniDialog({
                        title: '💾 存入模板到槽位 ' + (Number(slot) + 1),
                        inputValue: '我的配置' + (Number(slot) + 1),
                        confirmText: '存入',
                        onOk: function (name) {
                            tpls = loadTpls();
                            tpls[tplKey(slot)] = { name: (name || '模板' + (Number(slot) + 1)), checks: currentChecks(), savedAt: Date.now() };
                            saveTpls(tpls);
                            renderTplBar();
                            try { (window.App && App.showToast || window.showToast || function(){}).call(null, '💾 模板已保存到槽位 ' + (Number(slot) + 1)); } catch (e) {}
                        }
                    });
                };
            });
            mask.querySelectorAll('.ctt-tpl-del').forEach(function (el) {
                el.onclick = function (ev) {
                    ev.stopPropagation();
                    var slot = el.getAttribute('data-slot');
                    showMiniDialog({
                        title: '🗑 确定删除槽位 ' + (Number(slot) + 1) + ' 的模板？',
                        confirmText: '删除',
                        danger: true,
                        onOk: function () {
                            tpls = loadTpls();
                            delete tpls[tplKey(slot)];
                            saveTpls(tpls);
                            renderTplBar();
                            try { (window.App && App.showToast || window.showToast || function(){}).call(null, '🗑 已删除槽位 ' + (Number(slot) + 1) + ' 的模板'); } catch (e) {}
                        }
                    });
                };
            });
        }
        bindTplEvents();

        // ===== 查看工具完整说明（👁 按钮：弹窗展示描述+参数，可复制，只读不可改） =====
        mask.addEventListener('click', function (e) {
            var vb = e.target.closest ? e.target.closest('.ctt-view-btn') : null;
            if (!vb) return;
            e.preventDefault();
            e.stopPropagation();
            var tname = vb.getAttribute('data-tool');
            var t = Tools.allTools && Tools.allTools[tname];
            var fn = t && t.function ? t.function : null;
            var fullDesc = (fn && fn.description) || '（无描述）';
            var paramsTxt = '';
            try {
                var props = fn && fn.parameters && fn.parameters.properties || {};
                var req = (fn && fn.parameters && fn.parameters.required) || [];
                var keys = Object.keys(props);
                if (keys.length) {
                    paramsTxt = keys.map(function (k) {
                        var p = props[k] || {};
                        return '• ' + k + (req.indexOf(k) >= 0 ? '（必填）' : '') + '：' + (p.type || '?') + (p.description ? ' — ' + p.description : '');
                    }).join('\n');
                } else paramsTxt = '（无参数）';
            } catch (err) { paramsTxt = '（无参数）'; }
            var copyText = '【工具】' + (CN[tname] || tname) + ' (' + tname + ')\n\n【描述】\n' + fullDesc + '\n\n【参数说明】\n' + paramsTxt;
            var oldD = document.getElementById('ctt-detail-mask'); if (oldD) oldD.remove();
            var dm = document.createElement('div');
            dm.id = 'ctt-detail-mask';
            dm.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100000;display:flex;align-items:center;justify-content:center;';
            dm.innerHTML = '<div style="background:var(--panel-bg,#1e1e2e);color:var(--text,#eee);border:1px solid rgba(128,128,128,.35);border-radius:12px;width:640px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.5);">' +
                '<div style="padding:12px 16px 8px;font-weight:600;font-size:14px;border-bottom:1px solid rgba(128,128,128,.25);display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                '<span>👁 ' + esc(CN[tname] || tname) + ' <small style="opacity:.5;font-family:monospace;font-weight:400;">' + esc(tname) + '</small></span>' +
                '<span id="ctt-detail-close" style="cursor:pointer;opacity:.6;font-size:16px;">✕</span></div>' +
                '<div style="flex:1;overflow-y:auto;padding:12px 16px;font-size:12px;line-height:1.7;">' +
                '<div style="opacity:.6;margin-bottom:4px;">描述</div>' +
                '<div style="white-space:pre-wrap;background:rgba(128,128,128,.08);border-radius:8px;padding:8px 10px;margin-bottom:10px;">' + esc(fullDesc) + '</div>' +
                '<div style="opacity:.6;margin-bottom:4px;">参数说明</div>' +
                '<div style="white-space:pre-wrap;background:rgba(128,128,128,.08);border-radius:8px;padding:8px 10px;">' + esc(paramsTxt) + '</div>' +
                '<div style="opacity:.45;font-size:11px;margin-top:10px;">只读查看：如需修改工具说明，请在对话中与 AI 商量后由 AI 修改。</div>' +
                '</div>' +
                '<div style="padding:10px 16px;border-top:1px solid rgba(128,128,128,.25);display:flex;justify-content:flex-end;gap:10px;">' +
                '<button id="ctt-detail-copy" style="padding:6px 18px;cursor:pointer;border-radius:8px;border:none;background:#4a7dff;color:#fff;font-weight:600;">📋 复制全文</button>' +
                '<button id="ctt-detail-ok" style="padding:6px 18px;cursor:pointer;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;">关闭</button></div></div>';
            document.body.appendChild(dm);
            dm.addEventListener('click', function (ev) { if (ev.target === dm) dm.remove(); });
            dm.querySelector('#ctt-detail-close').onclick = function () { dm.remove(); };
            dm.querySelector('#ctt-detail-ok').onclick = function () { dm.remove(); };
            dm.querySelector('#ctt-detail-copy').onclick = function () {
                function fallbackCopy(txt) {
                    var ta = document.createElement('textarea');
                    ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0;'; document.body.appendChild(ta);
                    ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
                }
                var btn = dm.querySelector('#ctt-detail-copy');
                function done() { btn.textContent = '✅ 已复制'; setTimeout(function () { btn.textContent = '📋 复制全文'; }, 1500); }
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(copyText).then(done).catch(function () { fallbackCopy(copyText); done(); });
                } else { fallbackCopy(copyText); done(); }
            };
        });

        // 初始状态同步
        var bulkBtn = mask.querySelector('#ctt-bulk-btn');
        if (bulkBtn) {
            bulkBtn.addEventListener('click', function () {
                var cbs = mask.querySelectorAll('.ctt-cb:not(:disabled)');
                var allOn = true;
                for (var i = 0; i < cbs.length; i++) { if (!cbs[i].checked) { allOn = false; break; } }
                var toAll = !allOn;   // 当前全开 → 点击变为全不选；否则 → 全选
                cbs.forEach(function (cb) { cb.checked = toAll; });
                bulkBtn.textContent = toAll ? '⬜ 全不选' : '✅ 全选';
                /* 程序设置 checked 不触发 change 事件，这里手动同步并立即保存 */
                mask.querySelectorAll('.ctt-cb').forEach(function (cb) { tg[cb.getAttribute('data-tool')] = cb.checked; });
                save();
            });
            // 初始状态同步
            var initCbs = mask.querySelectorAll('.ctt-cb:not(:disabled)');
            var initAll = true;
            for (var ii = 0; ii < initCbs.length; ii++) { if (!initCbs[ii].checked) { initAll = false; break; } }
            bulkBtn.textContent = initAll ? '⬜ 全不选' : '✅ 全选';
        }
        // 任意开关变动时自动保存（无需点保存按钮）
        mask.addEventListener('change', function (e) {
            if (e.target && e.target.classList && e.target.classList.contains('ctt-cb')) {
                mask.querySelectorAll('.ctt-cb').forEach(function (cb) { tg[cb.getAttribute('data-tool')] = cb.checked; });
                save();
                try {
                    if (window.App && App.showToast) App.showToast('💾 已自动保存');
                    else if (window.showToast) showToast('💾 已自动保存');
                } catch (err) {}
            }
        });
        mask.querySelector('#ctt-save').onclick = function () {
            mask.querySelectorAll('.ctt-cb').forEach(function (cb) { tg[cb.getAttribute('data-tool')] = cb.checked; });
            save();   /* 保存后不关闭面板，仅提示；由用户点 ✕ 或「取消」时才关闭 */
            try {
                if (window.App && App.showToast) App.showToast('✅ 本对话工具配置已保存（' + catName + '）');
                else if (window.showToast) showToast('✅ 本对话工具配置已保存');
            } catch (e) {}
        };
    }

    function closeDialog() {
        var m = document.getElementById('chat-tool-toggle-mask');
        if (m) m.remove();
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    // ===== 全局兜底：点击空白处关闭工具分类下拉菜单 =====
    // 用捕获阶段，即使内部 handler stopPropagation 也能收到；
    // 菜单可能被移挂到 body，直接查 document 里可见的 .tool-cat-menu。
    document.addEventListener('click', function (e) {
        var menus = document.querySelectorAll('.tool-cat-menu');
        for (var i = 0; i < menus.length; i++) {
            var m = menus[i];
            if (m.hidden) continue;
            // 点击触发按钮本身时交给按钮自己的 toggle 逻辑处理（打开时点击应关闭），
            // 否则菜单挂在 body 上时找不到 trigger，会被误判为外部点击：先关闭又被 toggle 重新打开
            if (e.target.closest && e.target.closest('.tool-cat-trigger')) continue;
            var trigger = m.parentElement && m.parentElement.querySelector('.tool-cat-trigger');
            if (m.contains(e.target) || (trigger && trigger.contains(e.target))) continue;
            if (window.__closeToolCatMenu) window.__closeToolCatMenu();
            else {
                m.hidden = true;
                if (m.__origParent) {
                    try { m.__origParent.insertBefore(m, m.__origNext); } catch (err) {}
                    m.__origParent = null; m.__origNext = null;
                    m.style.position = ''; m.style.left = ''; m.style.top = '';
                    m.style.bottom = ''; m.style.width = ''; m.style.maxWidth = ''; m.style.maxHeight = '';
                }
            }
        }
    }, true);
})();
