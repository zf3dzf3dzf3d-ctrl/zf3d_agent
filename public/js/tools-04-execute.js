// ==== 拆分自 tools.js：执行工具 ====
Object.assign(Tools, {
        // ===== 执行工具 =====
        // 注意：read_file / write_file / run_code 为异步工具，返回 Promise
        execute: function(name, args, context) {
            var self = this;
            context = context || {};
            // Keep the caller's chat in this invocation's closure so concurrent chats cannot overwrite it.
            var executionChatId = context.chatId || self.currentChatId || '';
            var callToolApi = function(tool, payload, label) {
                if (!payload._chat_id) payload._chat_id = executionChatId;
                // 注入项目路径，后端工具据此切换工作目录（run.py 的 cwd、tree_dir 的默认路径等）
                var _chat = null;
                if (typeof Store !== 'undefined' && Store.data && Store.data.chatBoxes) {
                    for (var _ci = 0; _ci < Store.data.chatBoxes.length; _ci++) {
                        if (Store.data.chatBoxes[_ci].id === executionChatId) { _chat = Store.data.chatBoxes[_ci]; break; }
                    }
                }
                if (_chat && _chat._cachedFolderPath) {
                    payload._project_path = _chat._cachedFolderPath;
                }
                return self._callToolApi(tool, payload, label);
            };
            // ===== 写作工具分发（在 switch 之前拦截）=====
            if (self._writingTools && self._writingTools[name]) {
                return self._callWritingModel(name, args, context);
            }
            if (name === 'detect_sensitive') { return self._detectSensitive(args); }
            if (name === 'analyze_text_metrics') { return self._analyzeTextMetrics(args); }
            switch (name) {
                case 'task_complete':
                    self._clearToolCache(executionChatId);
                    // 【2026 修复】success 未传时默认按成功处理（仅显式 false 才算失败）。
                    // 原逻辑 !!args.success 导致模型漏传 success 时被误判为"任务失败"。
                    var _tcSuccess = (args.success === false || String(args.success).toLowerCase() === 'false') ? false : true;
                    return {
                        success: _tcSuccess,
                        message: args.message || (_tcSuccess ? '任务完成' : '任务失败'),
                        scope: args.scope || '当前任务',
                        tool: 'task_complete'
                    };
                case 'ask_user':
                    // 返回一个带 pending 标记的同步对象，由 app.js 的循环拦截并弹出输入框等待用户回答。
                    // 用户输入真正被填充到返回结果的 answer 字段中（由 app.js 的 askUser 处理）。
                    // 支持 fields 数组（多字段表单模式），由 app.js 的 askUser 读取并渲染表单。
                    return {
                        success: false,
                        pending: true,
                        question: args.question || '请补充说明：',
                        fields: args.fields || null,
                        answer: '',
                        message: '（等待用户回答…）',
                        tool: 'ask_user'
                    };
                case 'read_file':
                    // 支持单文件（path）与多文件（paths 数组）
                    if (args.paths && args.paths.length) {
                        args.paths.forEach(function(p) { self._trackReadFile(p, executionChatId); });
                    } else if (args.path) {
                        self._trackReadFile(args.path, executionChatId);
                    }
                    if (args.paths && args.paths.length) {
                        return callToolApi('read', { paths: args.paths, max_chars: args.max_chars || 8000 }, '读取文件');
                    }
                    return callToolApi('read', { path: args.path, max_chars: args.max_chars || 8000 }, '读取文件');
                case 'write_file':
                    // 支持单文件（path+content）与批量多文件（files 数组）
                    if (args.files && args.files.length) {
                        var _wf = callToolApi('write', { files: args.files }, '写入文件');
                        return self._ledgerWrap(_wf, executionChatId, function(data, ledger) {
                            (data.files || [data]).forEach(function(fr) {
                                if (fr && fr.path && !fr.error) ledger.push({ op: 'write', path: fr.path, backup_path: fr.backup_path || '' });
                            });
                        });
                    }
                    var _w1 = callToolApi('write', { path: args.path, content: args.content || '' }, '写入文件');
                    return self._ledgerWrap(_w1, executionChatId, function(data, ledger) {
                        if (data && data.path && !data.error) ledger.push({ op: 'write', path: data.path, backup_path: data.backup_path || '' });
                    });
                case 'run_code':
                    // 支持单段（code）与批量多段（codes 数组）
                    if (args.codes && args.codes.length) {
                        return callToolApi('run', { codes: args.codes, timeout: args.timeout || 10 }, '运行代码');
                    }
                    return callToolApi('run', { code: args.code || '', timeout: args.timeout || 10 }, '运行代码');
                case 'net_ping':
                    return callToolApi('net_ping', { host: args.host || '', count: args.count || 4 }, 'Ping 检测');
                case 'port_scan':
                    return callToolApi('port_scan', { host: args.host || '', ports: args.ports || [], timeout: args.timeout || 3 }, '端口检测');
                case 'dns_query':
                    return callToolApi('dns_query', { domain: args.domain || '', type: args.type || 'A' }, 'DNS 查询');
                case 'http_probe':
                    return callToolApi('http_probe', { url: args.url || '', method: args.method || 'GET', timeout: args.timeout || 10 }, 'HTTP 探活');
                case 'ssl_check':
                    return callToolApi('ssl_check', { host: args.host || '', port: args.port || 443 }, 'SSL 证书检查');
                case 'whois_query':
                    return callToolApi('whois_query', { domain: args.domain || '' }, 'WHOIS 查询');
                case 'traceroute':
                    return callToolApi('traceroute', { host: args.host || '', max_hops: args.max_hops || 15 }, '路由追踪');
                case 'ip_geo':
                    return callToolApi('ip_geo', { ip: args.ip || '' }, 'IP 归属查询');
                case 'http_headers':
                    return callToolApi('http_headers', { url: args.url || '' }, '安全响应头检查');
                case 'cdn_check':
                    return callToolApi('cdn_check', { domain: args.domain || '' }, 'CDN 检测');
                case 'password_audit':
                    return callToolApi('password_audit', { password: args.password || '', file: args.file || '' }, '密码强度自检');
                case 'subdomain_enum':
                    return callToolApi('subdomain_enum', { domain: args.domain || '' }, '子域名枚举');
                case 'sensitive_file_probe':
                    return callToolApi('sensitive_file_probe', { url: args.url || '', paths: args.paths || null }, '敏感文件自检');
                case 'net':
                    // 支持单 URL（url）与多 URL（urls 数组）
                    if (args.urls && args.urls.length) {
                        return callToolApi('net', { urls: args.urls, raw_html: !!args.raw_html, max_chars: args.max_chars || 6000, timeout: args.timeout || 15 }, '联网');
                    }
                    return callToolApi('net', { url: args.url || '', raw_html: !!args.raw_html, max_chars: args.max_chars || 6000, timeout: args.timeout || 15 }, '联网');
                case 'read_lines':
                    // 支持单文件（path）与多文件（paths 数组）
                    if (args.path) self._trackReadFile(args.path, executionChatId);
                    if (args.paths && args.paths.length) {
                        args.paths.forEach(function(p) { self._trackReadFile(p, executionChatId); });
                    }
                    if (args.paths && args.paths.length) {
                        return callToolApi('read_lines', {
                            paths: args.paths,
                            start: args.start || 1,
                            end: args.end || null,
                            num: !!args.num,
                            contains: args.contains || null,
                            line_char_limit: args.line_char_limit || 0
                        }, '按行读取');
                    }
                    return callToolApi('read_lines', {
                        path: args.path || '',
                        start: args.start || 1,
                        end: args.end || null,
                        num: !!args.num,
                        contains: args.contains || null
                    }, '按行读取');
                case 'git_save':
                    return callToolApi('git_save', {
                        message: args.message || '',
                        path: args.path || '',
                        push: !!args.push
                    }, 'Git保存');
                case 'project_record':
                    return callToolApi('project_record', {
                        action: args.action || 'list',
                        name: args.name || '',
                        names: args.names || null,
                        content: args.content || '',
                        keyword: args.keyword || ''
                    }, '项目记录');
                case 'tasknote':
                    // 主人任务簿：AI 侧写入/查看/推进（归档 done 仅主人界面可触发）
                    return callToolApi('tasknote', {
                        action: args.action || 'add',
                        title: args.title || '',
                        desc: args.desc || '',
                        remind: args.remind || '',
                        task_id: args.task_id || '',
                        new_status: args.new_status || '',
                        note: args.note || '',
                        status: args.status || '',
                        limit: parseInt(args.limit) || 30
                    }, '任务簿');
                case 'long_plan':
                    return callToolApi('long_plan', {
                        action: args.action || 'list',
                        plan_id: args.plan_id || '',
                        title: args.title || '',
                        goal: args.goal || '',
                        steps: args.steps || null,
                        step_nos: args.step_nos || null,
                        status: args.status || 'completed',
                        note: args.note || ''
                    }, '超长计划');
                case 'plan_batch':
                    return callToolApi('plan_batch', {
                        action: args.action || '',
                        plan_id: args.plan_id || '',
                        batch_size: args.batch_size || 5,
                        items: args.items || null
                    }, '分批执行');
                case 'wait':
                    return callToolApi('wait', {
                        seconds: parseFloat(args.seconds) || 1
                    }, '等待');
                case 'schedule':
                    return callToolApi('schedule', {
                        action: args.action || 'list',
                        name: args.name || '',
                        code: args.code || '',
                        interval: parseFloat(args.interval) || 60,
                        max_times: parseInt(args.max_times) || 0,
                        stop_on_success: args.stop_on_success || false,
                        stop_on_output: args.stop_on_output || ''
                    }, '定时任务');
                case 'chat_manage':
                    // 纯前端工具：直接调用 App.chatManage 操作对话框
                    if (typeof App !== 'undefined' && App.chatManage) {
                        return App.chatManage(args);
                    }
                    return { success: false, message: 'App.chatManage 方法不可用', tool: 'chat_manage' };
                case 'deploy_flowchart':
                    // 炫酷流程图：Mermaid 文本 -> 霓虹发光节点 + 粒子流动连线（纯视觉层）
                    if (window.FlowGlam && FlowGlam.deploy) {
                        return FlowGlam.deploy(args.mermaid || args.message || '', {
                            x: args.x, y: args.y
                        });
                    }
                    return { success: false, message: 'FlowGlam 模块未加载', tool: 'deploy_flowchart' };
                case 'clear_flowcharts':
                    if (window.FlowGlam && FlowGlam.clear) {
                        return FlowGlam.clear();
                    }
                    return { success: false, message: 'FlowGlam 模块未加载', tool: 'clear_flowcharts' };
                case 'search_chat':
                    return callToolApi('search_chat', {
                        keyword: args.keyword || '',
                        keywords: args.keywords || null,
                        session_id: args.session_id || '',
                        session_ids: args.session_ids || null,
                        match_mode: args.match_mode || 'any',
                        limit: args.limit || 50,
                        role: args.role || ''
                    }, '搜索对话');
                case 'recent_questions':
                    return callToolApi('recent_questions', {
                        keyword: args.keyword || '',
                        regex: args.regex || false,
                        limit: args.limit || 0,
                        offset: args.offset || 0,
                        session_id: args.session_id || '',
                        session_ids: args.session_ids || null,
                        filter_noise: args.filter_noise !== false
                    }, '近期问题');

                case 'query_answers':
                    return callToolApi('query_answers', {
                        keyword: args.keyword || '',
                        regex: args.regex || false,
                        limit: args.limit || 0,
                        offset: args.offset || 0,
                        session_id: args.session_id || '',
                        session_ids: args.session_ids || null,
                        answer_max_length: args.answer_max_length || 0,
                        include_question: args.include_question !== false
                    }, '查询答案');

                case 'chat_context':
                    return callToolApi('chat_context', {
                        action: args.action || 'read',
                        session_id: args.session_id || '',
                        session_ids: args.session_ids || null,
                        limit: args.limit || 10,
                        messages: args.messages || null,
                        role: args.role || '',
                        content: args.content || '',
                        message_id: args.message_id || null,
                        message_ids: args.message_ids || null,
                        model_id: args.model_id || ''
                    }, '上下文管理');
                case 'chat_summary':
                    return callToolApi('chat_summary', {
                        action: args.action || 'generate',
                        session_id: args.session_id || '',
                        session_ids: args.session_ids || null,
                        summary: args.summary || '',
                        summaries: args.summaries || null,
                        title: args.title || '',
                        limit: args.limit || 100
                    }, '对话摘要');
                case 'monitor':
                    return callToolApi('monitor', {
                        action: args.action || 'list',
                        chat_id: args.chat_id || '',
                        message: args.message || '',
                        session_id: args.session_id || '',
                        session_ids: args.session_ids || null,
                        limit: args.limit || 5,
                        context_limit: args.context_limit || 10
                    }, '监控队列');
                case 'task_list': {
                    // 按 action 动态构建参数，避免把缺失的必填项强行以 null/'' 发出导致 400 刷屏
                    const action = args.action || 'show';
                    const payload = {
                        action: action,
                        id: args.id || '',
                        chat_id: executionChatId
                    };
                    if (args.title !== undefined && args.title !== null) payload.title = args.title;
                    if (args.tasks !== undefined && args.tasks !== null) payload.tasks = args.tasks;
                    if (args.detail !== undefined && args.detail !== null) payload.detail = args.detail;
                    if (args.task_id !== undefined && args.task_id !== null && args.task_id !== '') {
                        payload.task_id = args.task_id;
                    }

                    if (action === 'update') {
                        const validStatuses = ['pending', 'in_progress', 'completed', 'skipped'];
                        if (payload.task_id === undefined) {
                            return Promise.reject(new Error('任务清单 update 缺少 task_id 参数（任务序号），请先 show 查看后再更新'));
                        }
                        const st = args.status || '';
                        if (!validStatuses.includes(st)) {
                            return Promise.reject(new Error('任务清单 update 缺少或非法 status 参数，必须为: ' + validStatuses.join(' / ')));
                        }
                        payload.status = st;
                    }
                    return callToolApi('task_list', payload, '任务清单');
                }
                case 'replace_text': {
                    var _rtArgs = {
                        path: args.path || '',
                        paths: args.paths || null,
                        old_text: args.old_text || '',
                        new_text: args.new_text || '',
                        all: args.all === true,
                        backup: args.backup !== false
                    };
                    var _rt = callToolApi('replace_text', _rtArgs, '替换文本');
                    var _rtPaths = _rtArgs.paths || (_rtArgs.path ? [_rtArgs.path] : []);
                    return self._ledgerWrap(_rt, executionChatId, function(data, ledger) {
                        var okPaths = [];
                        if (data.multi && data.files) {
                            data.files.forEach(function(fr) { if (fr && fr.path && !fr.error) okPaths.push(fr); });
                        } else if (data && data.path && !data.error) {
                            okPaths.push(data);
                        }
                        okPaths.forEach(function(fr) {
                            ledger.push({ op: 'write', path: fr.path, backup_path: fr.backup_path || '' });
                        });
                        // 记账不足时兜底：按请求路径补记（backup 由后端生成，撤销时再按最新 .bak 还原）
                        if (okPaths.length === 0 && _rtArgs.backup !== false) {
                            _rtPaths.forEach(function(p) {
                                if (p) ledger.push({ op: 'write', path: p, backup_path: '' });
                            });
                        }
                    });
                }
                case 'tree_dir':
                    return callToolApi('tree_dir', {
                        path: args.path || '.',
                        paths: args.paths || null,
                        max_depth: args.max_depth || 3,
                        show_files: args.show_files !== false
                    }, '目录树');
                case 'list_dir':
                    return callToolApi('list_dir', {
                        path: args.path || '',
                        paths: args.paths || null,
                        show_hidden: !!args.show_hidden,
                        sort_by: args.sort_by || 'name'
                    }, '列出目录');
                case 'find_files':
                    if (args.pattern) self._trackSearch('find:' + args.pattern, executionChatId);
                    return callToolApi('find_files', {
                        pattern: args.pattern || '',
                        path: args.path || '.',
                        paths: args.paths || null,
                        max_results: args.max_results || 50,
                        file_type: args.file_type || null
                    }, '查找文件');
                case 'search_in_files':
                    if (args.keyword) self._trackSearch('search:' + args.keyword, executionChatId);
                    return callToolApi('search_in_files', {
                        keyword: args.keyword || '',
                        path: args.path || '',
                        paths: args.paths || null,
                        regex: !!args.regex,
                        case_insensitive: !!args.case_insensitive,
                        max_results: args.max_results || 30,
                        context_lines: args.context_lines !== undefined ? args.context_lines : 1,
                        file_type: args.file_type || null
                    }, '搜索内容');
                case 'file_info':
                    return callToolApi('file_info', {
                        path: args.path || '',
                        paths: args.paths || null
                    }, '文件信息');
                case 'diff_preview':
                    return callToolApi('diff_preview', {
                        path: args.path || '',
                        staged: !!args.staged,
                        file: args.file || '',
                        files: args.files || null,
                        max_lines: args.max_lines || 200
                    }, '差异预览');
                case 'git_log':
                    return callToolApi('git_log', {
                        path: args.path || '',
                        count: args.count || 20,
                        author: args.author || '',
                        oneline: args.oneline !== false,
                        file: args.file || '',
                        files: args.files || null
                    }, '提交历史');
                case 'code_outline':
                    return callToolApi('code_outline', {
                        path: args.path || '',
                        paths: args.paths || null
                    }, '代码结构');
                case 'move_file': {
                    var _mvArgs = {
                        src: args.src || '',
                        dst: args.dst || '',
                        moves: args.moves || null,
                        overwrite: !!args.overwrite
                    };
                    var _mv = callToolApi('move_file', _mvArgs, '移动文件');
                    var _mvPairs = _mvArgs.moves || [{ src: _mvArgs.src, dst: _mvArgs.dst }];
                    return self._ledgerWrap(_mv, executionChatId, function(data, ledger) {
                        var okPairs = [];
                        (data.results || []).forEach(function(mr) {
                            if (mr && mr.ok) okPairs.push({ op: 'move', src: mr.src, dst: mr.dst });
                        });
                        if (okPairs.length === 0 && data.ok && data.results === undefined) {
                            _mvPairs.forEach(function(p) { if (p && p.src && p.dst) okPairs.push({ op: 'move', src: p.src, dst: p.dst }); });
                        }
                        okPairs.forEach(function(p) { ledger.push(p); });
                    });
                }

                case 'undo_task_changes':
                    // 内部工具：撤销本步任务所有文件改动（供"撤销本步"按钮调用，模型不可见）
                    return self._undoTaskChanges(executionChatId);

                case 'switch_tool_category':
                    var swCatName = args.category || '';
                    if (!swCatName) {
                        var catList = [];
                        for (var ck in self.categories) {
                            if (self.categories.hasOwnProperty(ck)) {
                                var cInfo = self.categories[ck];
                                var cTools = cInfo.tools.filter(function(t) { return t !== 'task_complete' && t !== 'switch_tool_category'; });
                                catList.push('  - ' + cInfo.icon + ' ' + ck + ': ' + cInfo.desc + '\\n    tools: ' + cTools.join(', '));
                            }
                        }
                        return { success: true, message: 'Available categories:\\n\\n' + catList.join('\\n\\n') + '\\n\\nCurrent: ' + (self.chatCategories[executionChatId] || self.activeCategory), tool: 'switch_tool_category', category: '', available: Object.keys(self.categories) };
                    }
                    var swCat = self.categories[swCatName];
                    if (!swCat) {
                        for (var fk in self.categories) {
                            if (self.categories.hasOwnProperty(fk) && fk.toLowerCase().indexOf(swCatName.toLowerCase()) >= 0) { swCatName = fk; swCat = self.categories[swCatName]; break; }
                        }
                    }
                    if (swCat) {
                        if (swCatName === (self.chatCategories[executionChatId] || self.activeCategory)) {
                            return { success: true, message: 'Already on: ' + swCat.icon + ' ' + swCatName, tool: 'switch_tool_category', category: swCatName, already_active: true };
                        }
                        self.setCategory(swCatName, executionChatId);
                        var swToolList = swCat.tools.filter(function(t) { return t !== 'task_complete' && t !== 'switch_tool_category'; });
                        return { success: true, message: 'Switched to: ' + swCat.icon + ' ' + swCatName + '\\nDesc: ' + swCat.desc + '\\nTools: ' + swToolList.join(', ') + '\\n(System prompt and tool definitions updated for next round)', tool: 'switch_tool_category', category: swCatName, icon: swCat.icon, desc: swCat.desc, tools: swCat.tools };
                    }
                    return { success: false, message: 'Category not found: ' + swCatName + '. Available: ' + Object.keys(self.categories).join(', '), tool: 'switch_tool_category', category: '', available: Object.keys(self.categories) };
                case 'get_tool_result':
                    var gaAction = args.action || 'list';
                    var gaChatId = executionChatId;
                    var archive = self.toolResultArchive[gaChatId] || [];
                    if (gaAction === 'get' && args.id !== undefined && args.id !== null) {
                        var gaId = parseInt(args.id);
                        var found = null;
                        for (var gi = 0; gi < archive.length; gi++) {
                            if (archive[gi].id === gaId) { found = archive[gi]; break; }
                        }
                        if (found) {
                            return { success: true, message: '存档 #' + found.id + ' [' + found.toolName + ']\n\n' + found.content, tool: 'get_tool_result', id: found.id, toolName: found.toolName, content: found.content };
                        } else {
                            return { success: false, message: '未找到存档 #' + gaId + '。可用 action=list 查看所有存档。', tool: 'get_tool_result' };
                        }
                    } else {
                        // list
                        if (archive.length === 0) {
                            return { success: true, message: '当前没有已存档的工具结果（所有结果都还在上下文中）。', tool: 'get_tool_result', archive: [] };
                        }
                        var listMsg = '已存档 ' + archive.length + ' 条工具结果：\n';
                        for (var li = 0; li < archive.length; li++) {
                            var item = archive[li];
                            var preview = item.content.substring(0, 80);
                            if (item.content.length > 80) preview += '...';
                            listMsg += '#' + item.id + ' [' + item.toolName + '] ' + preview + '\n';
                        }
                        listMsg += '\n使用 action=get + id 查回完整内容。';
                        return { success: true, message: listMsg, tool: 'get_tool_result', archive: archive.map(function(a) { return { id: a.id, toolName: a.toolName, contentLength: a.content.length }; }) };
                    }
                case 'video_gen': {
                    // AI 文生视频：Pollinations Veo-3（免费无key，默认）→ siliconflow Wan2.1
                    var vgAction = args.action || 'generate';
                    var vgParams = {
                        prompt: args.prompt,
                        duration: args.duration || 5,
                        size: args.size || '832x480',
                        model: args.model || 'veo3'
                    };
                    if (vgAction === 'status') {
                        return callToolApi('video_status', {}, 'check video channels status');
                    }
                    var vgResp = callToolApi('video_gen', vgParams, 'generate video');
                    // 如果返回了 video_url 列表，自动在 Kite 画布上添加视频节点
                    if (vgResp && vgResp.success && vgResp.videos && vgResp.videos.length && typeof window.KiteCanvas !== 'undefined' && window.KiteCanvas.addVideoNode) {
                        for (var vi = 0; vi < vgResp.videos.length; vi++) {
                            window.KiteCanvas.addVideoNode({
                                url: vgResp.videos[vi].url || vgResp.videos[vi],
                                prompt: args.prompt,
                                connectToChat: executionChatId || null
                            });
                        }
                    }
                    return vgResp;
                }
                case 'send_email':
                    return callToolApi('send_email', {
                        subject: args.subject || '通知',
                        body: args.body || '',
                        to: args.to || '',
                        is_html: !!args.is_html
                    }, 'send email');
                case 'image_gen':
                    // AI 文生图/图生图(修图)：默认固定 pollinations 免费渠道（不自动切换，不互相轮换）
                    // 参数: action(generate默认/edit修图/status), prompt(必填), size(可选默认1024x1024)
                    //       model(可选渠道id, 用户显式指定才用其他渠道, 传了则只走该渠道)
                    // 生成/修图成功后的画布自动上节点逻辑在 _callToolApi 的 then 链内处理
                    var imgAction = args.action || 'generate';
                    var imgPayload = {
                        action: imgAction,
                        prompt: args.prompt || args.text || args.desc || ''
                    };
                    if (args.size) imgPayload.size = args.size;
                    if (args.model) imgPayload.model = args.model;
                    if (args.image_url) imgPayload.image_url = args.image_url;
                    return callToolApi('image_gen', imgPayload, imgAction === 'status' ? 'image_gen status' : 'generate/edit image');
                case 'set_camera':
                    // 纯前端工具：直接调用 App.setCamera 操作画布摄像机
                    if (typeof App !== 'undefined' && App.setCamera) {
                        return App.setCamera(args);
                    }
                    return { success: false, message: 'App.setCamera 方法不可用', tool: 'set_camera' };
                case 'locate_mouse':
                    // get=获取系统鼠标真实位置（后端 GetCursorPos）
                    // set=真实移动系统鼠标（后端 SetCursorPos，支持 dx/dy 相对移动）
                    // move/click=画布高亮引导/模拟点击（纯前端）
                    if (['get', 'set', 'click', 'scroll'].indexOf(args.action) >= 0) {
                        return callToolApi('locate_mouse', {
                            action: args.action,
                            x: args.x, y: args.y,
                            dx: args.dx, dy: args.dy,
                            button: args.button || 'left',
                            times: args.times || 1,
                            delta: args.delta !== undefined ? args.delta : -120
                        }, { set: '移动鼠标', click: '点击鼠标', scroll: '滚动滚轮' }[args.action] || '获取鼠标位置');
                    }
                    // 纯前端工具：直接调用 App.locateMouse 操作鼠标定位
                    if (typeof App !== 'undefined' && App.locateMouse) {
                        return App.locateMouse(args);
                    }
                    return { success: false, message: 'App.locateMouse 方法不可用', tool: 'locate_mouse' };
                case 'control_keyboard':
                    // get=查询按键是否按下；press=真实敲击系统键盘；text=真实输入文本（均由后端 SendInput 处理）
                    return callToolApi('control_keyboard', {
                        action: args.action || 'get',
                        keys: args.keys || '',
                        hold_ms: args.hold_ms || 0,
                        text: args.text || ''
                    }, args.action === 'press' ? '敲击按键' : args.action === 'text' ? '输入文本' : '查询键盘状态');
                case 'long_term_memory':
                    return callToolApi('long_term_memory', {
                        action: args.action || 'list',
                        title: args.title || '',
                        content: args.content || '',
                        keywords: args.keywords || [],
                        tags: args.tags || [],
                        memory_id: args.memory_id || '',
                        memory_ids: args.memory_ids || [],
                        keyword: args.keyword || '',
                        match_mode: args.match_mode || 'any',
                        limit: args.limit || 20
                    }, 'long_term_memory ' + (args.action || 'list'));
                case 'ram_cache':
                    return callToolApi('ram_cache', {
                        action: args.action || 'list',
                        key: args.key || '',
                        keys: args.keys || [],
                        value: args.value || '',
                        ttl: args.ttl || 0
                    }, 'ram_cache ' + (args.action || 'list'));
                case 'pixel_display':
                    return callToolApi('pixel_display', {
                        action: args.action || 'status',
                        title: args.title || '',
                        data: args.data || '',
                        fps: args.fps || 2
                    }, 'pixel_display ' + (args.action || 'status'));
                case 'regex_search':
                    return callToolApi('regex_search', {
                        pattern: args.pattern || '',
                        path: args.path || '',
                        paths: args.paths || null,
                        case_insensitive: !!args.case_insensitive,
                        max_results: args.max_results || 50,
                        context_lines: args.context_lines !== undefined ? args.context_lines : 2,
                        file_type: args.file_type || null,
                        show_groups: args.show_groups !== false
                    }, '正则搜索');
                case 'work_order':
                    return callToolApi('work_order', {
                        action: args.action || 'show',
                        title: args.title || '',
                        item_type: args.item_type || '',
                        target: args.target || '',
                        action_desc: args.action_desc || '',
                        params: args.params || '',
                        note: args.note || '',
                        item_id: args.item_id || 0,
                        new_note: args.new_note || '',
                        new_status: args.new_status || '',
                        _chat_id: executionChatId
                    }, '工单 ' + (args.action || 'show'));
                case 'analyze_project':
                    // 【一键部署】分析成功且返回 mermaid 时，自动部署到画布（FlowGlam 炫酷流程图）
                    var _ap = callToolApi('analyze_project', {
                        action: args.action || 'analyze',
                        root: args.root || '',
                        max_depth: args.max_depth || 6,
                        _chat_id: executionChatId
                    }, '项目分析 ' + (args.action || 'analyze'));
                    var _tryDeploy = function (res) {
                        try {
                            var _mm = res && (res.mermaid || (res.data && res.data.mermaid));
                            if (_mm && window.FlowGlam && FlowGlam.deploy) {
                                FlowGlam.deploy(_mm, {});
                                if (res && res.data) res.data.deployed = true;
                                else if (res) res.deployed = true;
                            }
                        } catch (e) { console.warn('[analyze_project] 自动部署流程图失败:', e); }
                        return res;
                    };
                    if (_ap && typeof _ap.then === 'function') return _ap.then(_tryDeploy);
                    return _tryDeploy(_ap);
                case 'read_shared_context':
                    return callToolApi('read_shared_context', {
                        key: args.key || 'project_analysis',
                        part: args.part || 'summary',
                        limit: args.limit || 200,
                        _chat_id: executionChatId
                    }, '读共享上下文 ' + (args.part || 'summary'));
                case 'switch_port':
                    return callToolApi('switch_port', {
                        port: args.port || null,
                        start: args.start !== false,
                        open_browser: !!args.open_browser,
                        status: !!args.status
                    }, '切换端口');
                default:
                    return { success: false, message: '未知工具: ' + name, tool: name };
            }
        },
});
