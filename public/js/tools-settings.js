/* ========== tools-settings.js - 工具设置面板逻辑 ==========
 * 功能：在设置面板中按分类（极简/编程/写作）以卡片方式展示所有工具，
 *       用户可多选勾选"对话中使用的工具"，保存后对话请求只携带勾选的工具。
 */
(function () {
    var LS_KEY = 'zf3d.toolSelection.v1';
    var containerId = 'toolsSettingsCategories';
    var statusId = 'toolsSettingsStatus';

    // ===== 工具中文名映射（英文工具名 -> 中文名） =====
    var TOOL_CN_NAMES = {
        'task_complete': '完成任务',
        'switch_tool_category': '切换工具分类',
        'switch_port': '切换端口',
        'image_gen': '生成图片',
        'read_file': '读取文件',
        'write_file': '写入文件',
        'run_code': '运行代码',
        'read_lines': '读取行',
        'net': '抓取网页',
        'ask_user': '询问用户',
        'git_save': 'Git保存',
        'project_record': '项目记录',
        'chat_manage': '对话管理',
        'wait': '等待',
        'schedule': '定时任务',
        'search_chat': '搜索对话',
        'recent_questions': '近期问题',
        'query_answers': '查询答案',
        'chat_context': '对话上下文',
        'chat_summary': '对话摘要',
        'monitor': '监控队列',
        'task_list': '任务清单',
        'long_plan': '超长计划', 'plan_batch': '分批执行',
        'replace_text': '查找替换',
        'tree_dir': '目录树',
        'list_dir': '列出目录',
        'find_files': '查找文件',
        'search_in_files': '文件搜索',
        'file_info': '文件信息',
        'send_email': '发送邮件',
        'set_camera': '定位画布',
        'locate_mouse': '鼠标定位',
        'control_keyboard': '键盘控制',
        'long_term_memory': '长期记忆',
        'ram_cache': '内存缓存',
        'get_tool_result': '找回工具结果',
        'create_node': '新建节点',
        'read_node': '读节点',
        'read_global_context': '读全局上下文',
        'read_tool_store': '读工具仓库',
        'run_node': '运行节点',
        'delete_node': '删除节点',
        'set_node_fixed': '固化节点',
        'get_canvas_status': '看板状态',
        'regex_search': '正则搜索',
        'work_order': '工单清单',
        'Read': '读文件(引擎)',
        'Write': '写文件(引擎)',
        'Edit': '精确替换(引擎)',
        'Glob': '文件匹配(引擎)',
        'Grep': '内容搜索(引擎)',
        'Bash': '执行命令(引擎)',
        'TodoWrite': '任务清单(引擎)',
        'codex_read': '读文件',
        'codex_read_lines': '按行读',
        'codex_list_dir': '目录树',
        'codex_propose_write': '提议写入',
        'codex_apply_write': '确认写入',
        'codex_replace': '精确替换',
        'codex_diffstat': '差异统计',
        'codex_audit': '审计回放',
        'codex_run_code': '运行代码',
        'codex_set_approval': '设置审批',
        'ds_read': '读文件',
        'ds_write': '写文件',
        'ds_files': '查找文件',
        'ds_grep': '内容搜索',
        'ds_run': '运行命令',
        'h_read': '读文件',
        'h_write': '写文件',
        'h_grep': '内容搜索',
        'h_run': '运行命令',
        'skill_list': '技能列表',
        'skill_view': '查看技能',
        'skill_save': '保存技能',
        'o_routes': '路由列表',
        'o_bind': '绑定路由',
        'o_task': '任务编排',
        'o_list': '列出条目',
        'o_read': '读数据',
        'o_write': '写数据',
        'o_run': '运行命令',
        'pi_read': '读文件',
        'pi_read_lines': '按行读',
        'pi_files': '查找文件',
        'pi_grep': '内容搜索',
        'pi_run': '运行命令',
        'pi_write': '写文件',
        'diff_preview': '差异预览',
        'git_log': 'Git日志',
        'code_outline': '代码结构',
        'move_file': '移动文件',
        'rewrite_text': '改写文本',
        'expand_text': '扩写文本',
        'shorten_text': '精简文本',
        'polish_text': '润色文本',
        'translate_text': '翻译文本',
        'proofread_text': '审校文本',
        'change_tone': '改变语气',
        'professional_edit': '专业编辑',
        'fix_punctuation': '修正标点',
        'convert_chars': '字符转换',
        'summarize_text': '总结文本',
        'write_outline': '写大纲',
        'quick_article': '快速成文',
        'extract_keywords': '提取关键词',
        'extract_outline': '提取大纲',
        'analyze_sentiment': '情感分析',
        'detect_style': '风格检测',
        'detect_sensitive': '敏感词检测',
        'analyze_text_metrics': '文本分析',
        'compare_text': '文本对比',
        'rate_article': '文章评分',
        'fact_check': '事实核查',
        'opposing_view': '对立观点',
        'role_brainstorm': '角色头脑风暴',
        'expert_review': '专家评审',
        'novice_view': '新手视角',
        'bystander_view': '旁观者视角',
        'group_discussion': '群体讨论',
        'play_devil_advocate': '唱反调',
        'praise_text': '赞美文本',
        'list_formats': '格式列举',
        'optimize_ends': '优化结尾',
        'generate_quotes': '生成引言',
        'generate_hook': '生成钩子',
        'seo_optimize': 'SEO优化',
        'adapt_audience': '适配受众',
        'interpret_document': '解读文档',
        'format_beautify': '格式美化',
        'color_text': '彩色文本',
        'generate_title': '生成标题',
        'generate_description': '生成描述'
    };

    // ===== 状态 =====
    var selectedTools = {}; // name -> true
    var initialized = false;
    var stateLoaded = false;
    var searchTerm = '';
    // ===== 引擎分类过滤：设置面板只显示与当前默认引擎相关的分类 =====
// 带 engineId 的分类（各 local_loop 引擎私有工具集）只在默认引擎为该引擎时显示；
// preprocess 引擎（如 zf_core/朱峰社区默认）只显示常规分类（极简/编程/写作/流程图等）。
function visibleCats() {
    var cats = window.ToolDefinitions ? window.ToolDefinitions.categories : {};
    var engId = '';
    try { if (typeof DB !== 'undefined' && DB._engine) engId = DB._engine; } catch (e) {}
    var showOwn = false;
    if (engId) {
        var em = (typeof DB !== 'undefined' && DB.getEngines)
            ? DB.getEngines().filter(function (x) { return x.id === engId; })[0] : null;
        showOwn = !!(em && em.own_tools);
    }
    var out = {};
    Object.keys(cats).forEach(function (k) {
        var def = cats[k];
        if (def.engineId) {
            if (showOwn && def.engineId === engId) out[k] = def;
        } else {
            out[k] = def;
        }
    });
    return out;
}
var activeCatFilter = null; // null=全部, 或分类名

    // ===== 工具函数 =====
    function $(id) { return document.getElementById(id); }

    // 懒加载：确保 selectedTools 已初始化（init 前被调用时自动加载）
    function ensureLoaded() {
        if (stateLoaded) return;
        stateLoaded = true;
        initSelected();
    }

    function load() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (data && data.tools && Array.isArray(data.tools)) return data.tools;
        } catch (e) {}
        return null;
    }

    function save() {
        var arr = Object.keys(selectedTools).filter(function (k) { return selectedTools[k]; });
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({ tools: arr, updatedAt: Date.now() }));
        } catch (e) {}
        return arr;
    }

    // 默认：全部选中
    function selectAllInCategories() {
        var cats = visibleCats();
        Object.keys(cats).forEach(function (catName) {
            (cats[catName].tools || []).forEach(function (name) {
                selectedTools[name] = true;
            });
        });
    }

    function initSelected() {
        var saved = load();
        if (saved && saved.length > 0) {
            saved.forEach(function (name) { selectedTools[name] = true; });
            // 【新工具自动补全】分类里存在但旧保存列表中没有的工具，自动启用，
            // 避免系统升级新增工具后被旧 localStorage 数据屏蔽。
            // 用户明确取消勾选过的工具（保存列表中不存在其记录）不在补全范围内——
            // 说明用户保存时间早于该工具出现，或该工具是新增的，都应默认启用。
            var known = {};
            saved.forEach(function (name) { known[name] = true; });
            var cats = visibleCats();
            Object.keys(cats).forEach(function (catName) {
                (cats[catName].tools || []).forEach(function (name) {
                    if (!known[name]) { selectedTools[name] = true; known[name] = true; }
                });
            });
        } else {
            // 无保存记录 -> 默认全部选中
            selectAllInCategories();
        }
    }

    // 获取勾选的工具集合（供 Tools.getDefinitions 过滤使用）
    function getEnabledSet() {
        ensureLoaded();
        var set = {};
        Object.keys(selectedTools).forEach(function (k) {
            if (selectedTools[k]) set[k] = true;
        });
        return set;
    }

    // 获取当前保存状态摘要
    function getStatusText() {
        ensureLoaded();
        var total = 0, enabled = 0;
        var cats = visibleCats();
        Object.keys(cats).forEach(function (catName) {
            (cats[catName].tools || []).forEach(function (name) {
                total++;
                if (selectedTools[name]) enabled++;
            });
        });
        return '已启用 ' + enabled + ' / ' + total + ' 个工具';
    }

    // ===== 渲染 =====
    function render() {
        ensureLoaded();
        var container = $(containerId);
        if (!container) return;
        var statusEl = $(statusId);
        var cats = visibleCats();

        // 状态
        if (statusEl) {
            statusEl.textContent = getStatusText();
            statusEl.classList.remove('saved');
        }

        // 分类筛选 chips
        var filterEl = $('toolsSettingsCatFilter');
        if (filterEl) {
            filterEl.classList.add('tools-settings-category-filter');
            var catNames = Object.keys(cats);
            var chipsHtml = '<button class="tsf-chip' + (activeCatFilter ? '' : ' active') + '" data-cat="">全部</button>';
            catNames.forEach(function (cn) {
                chipsHtml += '<button class="tsf-chip' + (activeCatFilter === cn ? ' active' : '') + '" data-cat="' + cn + '">' + cn + '</button>';
            });
            filterEl.innerHTML = chipsHtml;
        }

        var catNames = Object.keys(cats);
        if (activeCatFilter && catNames.indexOf(activeCatFilter) === -1) {
            activeCatFilter = null;
        }
        var shownCats = activeCatFilter ? [activeCatFilter] : catNames;

        var html = '';
        shownCats.forEach(function (catName) {
            var cat = cats[catName];
            var tools = cat.tools || [];
            var enabledCount = 0, matched = 0;
            var cardHtml = '';
            tools.forEach(function (name) {
                var def = window.ToolDefinitions.allTools[name];
                var desc = '';
                if (def && def.function && def.function.description) {
                    desc = def.function.description;
                }
                // 搜索过滤
                if (searchTerm) {
                    var low = searchTerm.toLowerCase();
                    var hit = name.toLowerCase().indexOf(low) >= 0 ||
                              (TOOL_CN_NAMES[name] || '').toLowerCase().indexOf(low) >= 0 ||
                              desc.toLowerCase().indexOf(low) >= 0;
                    if (!hit) return;
                }
                matched++;
                var isSel = !!selectedTools[name];
                if (isSel) enabledCount++;
                var cnName = TOOL_CN_NAMES[name] || '';
                cardHtml += '<div class="tools-settings-tool-card' + (isSel ? ' selected' : '') +
                    '" data-tool="' + name + '" title="' + escapeHtml(name) + '">' +
                    '<div class="tools-settings-tool-checkbox"></div>' +
                    '<div class="tools-settings-tool-info">' +
                    '<div><span class="tools-settings-tool-name">' + escapeHtml(name) + '</span>' +
                    (cnName ? '<span class="tools-settings-tool-name-cn">' + escapeHtml(cnName) + '</span>' : '') +
                    '</div>' +
                    '<div class="tools-settings-tool-desc">' + escapeHtml(desc) + '</div>' +
                    '</div></div>';
            });

            var headerHtml = '<div class="tools-settings-category" data-cat="' + catName + '">' +
                '<div class="tools-settings-category-header">' +
                '<span class="tools-settings-category-icon">' + (cat.icon || '📦') + '</span>' +
                '<span class="tools-settings-category-name">' + escapeHtml(catName) + '</span>' +
                '<span class="tools-settings-category-desc">' + escapeHtml(cat.desc || '') + '</span>' +
                '<span class="tools-settings-category-count">' + enabledCount + '/' + tools.length + '</span>' +
                '</div>' +
                '<div class="tools-settings-category-body">' +
                (matched === 0 ? '<div class="tools-settings-empty">未找到匹配的工具</div>' : cardHtml) +
                '</div></div>';

            html += headerHtml;
        });

        container.innerHTML = html;
    }

    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ===== 事件绑定 =====
    function bindEvents() {
        var container = $(containerId);
        if (!container) return;

        // 卡片点击（事件委托）
        container.addEventListener('click', function (e) {
            var card = e.target.closest ? e.target.closest('.tools-settings-tool-card') : null;
            if (card) {
                var name = card.getAttribute('data-tool');
                selectedTools[name] = !selectedTools[name];
                card.classList.toggle('selected', !!selectedTools[name]);
                var statusEl = $(statusId);
                if (statusEl) {
                    statusEl.textContent = getStatusText();
                    statusEl.classList.remove('saved');
                }
                // 更新分类计数
                var catEl = card.closest('.tools-settings-category');
                if (catEl) {
                    var countEl = catEl.querySelector('.tools-settings-category-count');
                    var catName = catEl.getAttribute('data-cat');
                    var cats = window.ToolDefinitions.categories;
                    if (countEl && cats[catName]) {
                        var tools = cats[catName].tools || [];
                        var enabled = 0;
                        tools.forEach(function (n) { if (selectedTools[n]) enabled++; });
                        countEl.textContent = enabled + '/' + tools.length;
                    }
                }
                return;
            }
            // 分类折叠/展开
            var header = e.target.closest ? e.target.closest('.tools-settings-category-header') : null;
            if (header) {
                var catEl = header.closest('.tools-settings-category');
                if (catEl) catEl.classList.toggle('open');
            }
        });

        // 分类筛选 chips（事件委托）
        var filterEl = $('toolsSettingsCatFilter');
        if (filterEl) {
            filterEl.addEventListener('click', function (e) {
                var chip = e.target.closest ? e.target.closest('.tsf-chip') : null;
                if (!chip) return;
                activeCatFilter = chip.getAttribute('data-cat') || null;
                render();
            });
        }
    }

    // ===== 工具栏操作 =====
    function selectAllVisible() {
        ensureLoaded();
        var cats = visibleCats();
        Object.keys(cats).forEach(function (catName) {
            (cats[catName].tools || []).forEach(function (name) {
                selectedTools[name] = true;
            });
        });
        render();
    }

    function selectNone() {
        ensureLoaded();
        var cats = visibleCats();
        Object.keys(cats).forEach(function (catName) {
            (cats[catName].tools || []).forEach(function (name) {
                delete selectedTools[name];
            });
        });
        render();
    }

    function resetDefault() {
        selectedTools = {};
        stateLoaded = true;
        selectAllInCategories();
        render();
    }

    function saveSettings() {
        ensureLoaded();
        var arr = save();
        var statusEl = $(statusId);
        if (statusEl) {
            statusEl.textContent = '✅ 已保存：' + getStatusText();
            statusEl.classList.add('saved');
        }
        // 触发 Tools 刷新
        if (window.Tools && typeof window.Tools.onToolSelectionChanged === 'function') {
            window.Tools.onToolSelectionChanged(arr);
        }
        return arr;
    }

    // ===== 初始化 =====
    function init() {
        if (initialized) return;
        initialized = true;
        ensureLoaded();
        bindEvents();

        // 工具栏按钮
        var btnAll = $('toolsSettingsSelectAll');
        var btnNone = $('toolsSettingsSelectNone');
        var btnReset = $('toolsSettingsReset');
        var btnSave = $('toolsSettingsSave');
        if (btnAll) btnAll.addEventListener('click', selectAllVisible);
        if (btnNone) btnNone.addEventListener('click', selectNone);
        if (btnReset) btnReset.addEventListener('click', resetDefault);
        if (btnSave) btnSave.addEventListener('click', saveSettings);

        // 搜索框
        var searchEl = $('toolsSettingsSearch');
        if (searchEl) {
            searchEl.addEventListener('input', function () {
                searchTerm = searchEl.value.trim();
                render();
            });
        }

        // 渲染
        render();
    }

    // 暴露全局接口
    window.ToolsSettings = {
        init: init,
        render: render,
        getEnabledSet: getEnabledSet,
        getEnabledArray: function () {
            ensureLoaded();
            return Object.keys(selectedTools).filter(function (k) { return selectedTools[k]; });
        },
        getStatusText: getStatusText,
        resetDefault: resetDefault,
        save: saveSettings,
        isToolEnabled: function (name) {
            ensureLoaded();
            return !!selectedTools[name];
        }
    };
})();
