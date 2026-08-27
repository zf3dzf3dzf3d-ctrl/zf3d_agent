// ==== 拆分自 tools.js：调用后端 /api/tools/*（异步）_判断是否为终止型_默认展开的工具白_工具显示名称映射 ====
Object.assign(Tools, {
        // ===== 调用后端 /api/tools/*（异步） =====
        _callToolApi: function(tool, payload, label) {
            var self = this;
            if (!payload._chat_id) payload._chat_id = self.currentChatId || '';
            return fetch('/api/tools/' + tool, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function(res) {
                return res.json();
            }).then(function(data) {
                if (data && data.ok) {
                    var msg = '';
                    if (tool === 'read') {
                        if (data.multi && data.files) {
                            // 多文件读取
                            var lines = [];
                            for (var fi = 0; fi < data.files.length; fi++) {
                                var fr = data.files[fi];
                                if (fr.error) {
                                    lines.push('❌ ' + fr.path + '：' + fr.error);
                                } else {
                                    lines.push('📄 ' + fr.path + '（' + fr.meta.size + ' 字节）' + (fr.truncated ? '，内容过长已截断' : '') + '\n' + fr.content);
                                }
                            }
                            msg = '已读取 ' + data.files.length + ' 个文件：\n\n' + lines.join('\n\n---\n\n');
                        } else {
                            msg = '已读取 ' + data.path + '（' + data.meta.size + ' 字节）' + (data.truncated ? '，内容过长已截断' : '') + '\n' + (data.content || '');
                        }
                        // 附加已读文件清单提示，避免重复读取
                        msg += self._getReadFilesHint(self.currentChatId);
                    } else if (tool === 'write') {
                        if (data.multi && data.files) {
                            // 多文件写入
                            var wlines = [];
                            for (var wi = 0; wi < data.files.length; wi++) {
                                var wr = data.files[wi];
                                if (wr.error) {
                                    wlines.push('❌ ' + wr.path + '：' + wr.error);
                                } else {
                                    wlines.push('✅ ' + wr.path + '（' + wr.size + ' 字节）' + (wr.backup ? '，已备份原文件' : ''));
                                }
                            }
                            msg = '已写入 ' + data.files.length + ' 个文件：\n' + wlines.join('\n');
                        } else {
                            msg = '已写入 ' + data.path + '（' + data.size + ' 字节）' + (data.backup ? '，已备份原文件' : '');
                        }
                    } else if (tool === 'run') {
                        if (data.multi && data.runs) {
                            // 多段运行
                            var rlines = [];
                            for (var ri = 0; ri < data.runs.length; ri++) {
                                var rr = data.runs[ri];
                                var rOut = (rr.stdout || '').trim();
                                var rErr = (rr.stderr || '').trim();
                                if (rr.timeout) {
                                    rlines.push('⏱️ 第' + (ri + 1) + '段：' + rErr);
                                } else if (rr.exit_code === 0) {
                                    rlines.push('✅ 第' + (ri + 1) + '段成功（退出码 0）' + (rOut ? '\n' + rOut : ''));
                                } else {
                                    rlines.push('❌ 第' + (ri + 1) + '段失败（退出码 ' + rr.exit_code + '）' + (rErr ? '\n' + rErr : ''));
                                }
                            }
                            msg = '已运行 ' + data.runs.length + ' 段代码：\n\n' + rlines.join('\n\n---\n\n');
                        } else {
                            var out = (data.stdout || '').trim();
                            var err = (data.stderr || '').trim();
                            if (data.timeout) {
                                msg = '⏱️ ' + err;
                            } else if (data.exit_code === 0) {
                                msg = '✅ 运行成功（退出码 0）' + (out ? '\n输出：\n' + out : '');
                            } else {
                                msg = '❌ 运行失败（退出码 ' + data.exit_code + '）' + (err ? '\n错误：\n' + err : '');
                            }
                        }
                    } else if (tool === 'read_lines') {
                        // 后端返回: lines 为字符串数组("12: 内容"), total_lines, start/end
                        // num_only 模式: 只有 total_lines, 无 lines 字段
                        if (data.multi && data.files) {
                            var rlLines = [];
                            for (var rli = 0; rli < data.files.length; rli++) {
                                var rf = data.files[rli];
                                if (rf.error) {
                                    rlLines.push('❌ ' + rf.path + '：' + rf.error);
                                } else if (rf.lines) {
                                    rlLines.push('📄 ' + rf.path + '（共 ' + rf.total_lines + ' 行）\n  ' + rf.lines.join('\n  '));
                                } else {
                                    rlLines.push('📄 ' + rf.path + '（共 ' + rf.total_lines + ' 行）');
                                }
                            }
                            msg = '已读取 ' + data.files.length + ' 个文件：\n\n' + rlLines.join('\n\n---\n\n');
                        } else {
                            var base = '📄 ' + data.path + '（共 ' + data.total_lines + ' 行）';
                            if (data.lines) {
                                msg = base + '，第 ' + data.start + '–' + data.end + ' 行：\n  ' + data.lines.join('\n  ');
                            } else {
                                msg = base;
                            }
                        }
                        // 附加已读文件清单提示
                        msg += self._getReadFilesHint(self.currentChatId);
                    } else if (tool === 'net') {
                        if (data.multi && data.pages) {
                            var nlines = [];
                            for (var pi = 0; pi < data.pages.length; pi++) {
                                var pr = data.pages[pi];
                                if (pr.error) {
                                    nlines.push('❌ ' + pr.url + '：' + pr.error);
                                } else {
                                    nlines.push('🌐 ' + pr.url + (pr.final_url && pr.final_url !== pr.url ? '（→' + pr.final_url + '）' : '') + (pr.title ? '｜' + pr.title : '') + (pr.truncated ? '，内容过长已截断' : '') + '\n' + pr.content);
                                }
                            }
                            msg = '已抓取 ' + data.pages.length + ' 个网页：\n\n' + nlines.join('\n\n---\n\n');
                        } else {
                            if (data.error) {
                                msg = '❌ ' + data.url + '：' + data.error;
                            } else {
                                msg = '🌐 ' + data.url + (data.final_url && data.final_url !== data.url ? '（→' + data.final_url + '）' : '') + (data.title ? '｜' + data.title : '') + (data.truncated ? '，内容过长已截断' : '') + '\n' + (data.content || '');
                            }
                        }
                    }
                    if (tool === 'git_save') {
                        var steps = data.steps || [];
                        var sLines = [];
                        for (var si = 0; si < steps.length; si++) {
                            var st = steps[si];
                            var sIcon = st.exit_code === 0 ? '✅' : '❌';
                            var sDetail = st.stdout || st.stderr || '';
                            sLines.push(sIcon + ' ' + st.step + (sDetail ? '：' + sDetail : ''));
                        }
                        var gIcon = data.nothing_to_commit ? 'ℹ️' : '📦';
                        msg = gIcon + ' Git保存完成' + (data.nothing_to_commit ? '（没有变更需要提交）' : '') + '\n' +
                              '提交信息：' + data.message + '\n' +
                              (data.last_commit ? '最近提交：' + data.last_commit + '\n' : '') +
                              (data.status ? '变更摘要：\n' + data.status + '\n' : '') +
                              '\n步骤详情：\n' + sLines.join('\n');
                    }
                    if (tool === 'project_record') {
                        // 后端返回: list/search 返回 records(纯名字数组), read 返回 records 或单条 name+content,
                        // write 返回 name+size, append 只返回 name, delete 只返回 name
                        var action = data.action || 'list';
                        if (action === 'list') {
                            var recs = data.records || [];
                            if (recs.length === 0) {
                                msg = '📝 项目记录为空（暂无记录）';
                            } else {
                                var rLines = [];
                                for (var ri = 0; ri < recs.length; ri++) {
                                    rLines.push((ri+1) + '. ' + recs[ri]);
                                }
                                msg = '📝 项目记录（共 ' + recs.length + ' 条）：\n' + rLines.join('\n');
                            }
                        } else if (action === 'read') {
                            if (data.multi && data.records) {
                                var fLines = [];
                                for (var fi = 0; fi < data.records.length; fi++) {
                                    var fr = data.records[fi];
                                    if (fr.error) {
                                        fLines.push('❌ ' + fr.name + '：' + fr.error);
                                    } else {
                                        fLines.push('📄 ' + fr.name + '\n' + fr.content);
                                    }
                                }
                                msg = '已读取 ' + data.records.length + ' 条记录：\n\n' + fLines.join('\n\n---\n\n');
                            } else {
                                msg = '📄 ' + data.name + '\n' + (data.content || '');
                            }
                        } else if (action === 'write') {
                            msg = '✅ 已写入记录「' + data.name + '」（' + data.size + ' 字节）';
                        } else if (action === 'append') {
                            msg = '✅ 已追加内容到记录「' + data.name + '」';
                        } else if (action === 'search') {
                            var matches = data.records || [];
                            if (matches.length === 0) {
                                msg = '🔍 未找到包含「' + data.keyword + '」的记录';
                            } else {
                                msg = '🔍 搜索「' + data.keyword + '」找到 ' + matches.length + ' 条记录：\n' + matches.map(function(m, i) { return (i+1) + '. ' + m; }).join('\n');
                            }
                        } else if (action === 'delete') {
                            msg = '🗑️ 已删除记录「' + data.name + '」';
                        }
                    }
                    if (tool === 'wait') {
                        msg = '⏳ 已等待 ' + data.actual + ' 秒（请求 ' + data.seconds + ' 秒）';
                    }
                    if (tool === 'schedule') {
                        msg = data.message || '定时任务操作完成';
                    }
                    if (tool === 'search_chat') {
                        var results = data.results || [];
                        if (results.length === 0) {
                            msg = '🔍 搜索「' + (data.keywords || []).join(', ') + '」未找到匹配结果（搜索了 ' + data.sessions_searched + ' 个窗口）';
                        } else {
                            var sLines = [];
                            for (var si = 0; si < results.length; si++) {
                                var sr = results[si];
                                sLines.push('📌 [' + sr.session_id + '] ' + sr.title + '（' + sr.match_count + ' 处匹配）');
                                for (var mi = 0; mi < sr.matches.length; mi++) {
                                    var m = sr.matches[mi];
                                    var roleLabel = m.role === 'user' ? '👤' : (m.role === 'assistant' ? '🤖' : '⚙️');
                                    sLines.push('  ' + roleLabel + ' ' + (m.snippet || ''));
                                }
                            }
                            var roleFilter = data.role ? '，角色=' + data.role : '';
                            msg = '🔍 搜索「' + (data.keywords || []).join(', ') + '」（' + data.match_mode + '模式' + roleFilter + '）找到 ' + data.total_matches + ' 处匹配，涉及 ' + data.sessions_matched + '/' + data.sessions_searched + ' 个窗口：\n\n' + sLines.join('\n');
                        }
                    }
                    if (tool === 'recent_questions') {
                        var qList = data.questions || [];
                        var kwLabel = '';
                        if (data.keyword) {
                            kwLabel = '，关键字: 「' + data.keyword + '」' + (data.regex ? '(正则)' : '');
                        }
                        if (qList.length === 0) {
                            msg = '🔍 近期没有找到有效的用户问题（共搜索 ' + data.sessions_searched + ' 个窗口，过滤噪音: ' + data.filter_noise + kwLabel + '）';
                        } else {
                            var qLines = [];
                            for (var qi = 0; qi < qList.length; qi++) {
                                var q = qList[qi];
                                qLines.push((qi+1) + '. [' + q.session_id + '] ' + q.session_title + '\n   ' + (q.content || '').substring(0, 300));
                            }
                            var pageMsg = '';
                            if (data.has_more) { pageMsg = '\n\n👉 还有更多，使用 offset=' + data.next_offset + ' 查看下一页'; }
                            msg = '🔍 近期 ' + data.returned + ' 条用户问题（共 ' + data.total_found + ' 条，过滤噪音: ' + data.filter_noise + kwLabel + '）：\n\n' + qLines.join('\n\n') + pageMsg;
                        }
                    }

                    if (tool === 'query_answers') {
                        var aList = data.results || [];
                        var kwLabel2 = '';
                        if (data.keyword) {
                            kwLabel2 = '，关键字: 「' + data.keyword + '」' + (data.regex ? '(正则)' : '');
                        }
                        if (aList.length === 0) {
                            msg = '🔍 未找到匹配「' + data.keyword + '」的问答记录' + kwLabel2;
                        } else {
                            var aLines = [];
                            for (var ai = 0; ai < aList.length; ai++) {
                                var a = aList[ai];
                                var qText = a.question ? '\n   📝 问: ' + (a.question || '').substring(0, 200) : '';
                                var aText = (a.answer || '').substring(0, 500);
                                aLines.push((ai+1) + '. [' + a.session_id + '] ' + a.session_title + qText + '\n   💬 答: ' + aText);
                            }
                            var aPageMsg = '';
                            if (data.has_more) { aPageMsg = '\n\n👉 还有更多，使用 offset=' + data.next_offset + ' 查看下一页'; }
                            msg = '🔍 查询到 ' + data.returned + ' 条问答（共 ' + data.total_found + ' 条' + kwLabel2 + '）：\n\n' + aLines.join('\n\n') + aPageMsg;
                        }
                    }

                    if (tool === 'chat_context') {
                        var cAction = data.action || 'read';
                        if (cAction === 'read') {
                            var cResults = data.results || [];
                            var cLines = [];
                            for (var ci = 0; ci < cResults.length; ci++) {
                                var cr = cResults[ci];
                                cLines.push('📌 [' + cr.session_id + '] ' + cr.title + '（' + cr.count + ' 条消息）');
                                for (var cj = 0; cj < cr.messages.length; cj++) {
                                    var cm = cr.messages[cj];
                                    var cLabel = cm.role === 'user' ? '👤' : (cm.role === 'assistant' ? '🤖' : '⚙️');
                                    cLines.push('  ' + cLabel + ' [' + cm.id + '] ' + (cm.content || '').substring(0, 200));
                                }
                            }
                            msg = '📋 读取 ' + data.sessions + ' 个窗口的上下文：\n\n' + cLines.join('\n');
                        } else if (cAction === 'insert' || cAction === 'append') {
                            var iResults = data.results || [];
                            var iLines = [];
                            for (var ii = 0; ii < iResults.length; ii++) {
                                var ir = iResults[ii];
                                iLines.push('✅ [' + ir.session_id + '] 插入了 ' + ir.count + ' 条消息');
                            }
                            msg = '✅ 向 ' + data.sessions + ' 个窗口插入了消息：\n' + iLines.join('\n');
                        } else if (cAction === 'update') {
                            msg = '✅ 已更新消息 [id=' + data.message_id + ']，影响 ' + data.updated + ' 行';
                        } else if (cAction === 'delete') {
                            msg = '🗑️ 已删除：' + (typeof data.deleted === 'string' ? data.deleted : (data.deleted + ' 条消息'));
                        }
                    }
                    if (tool === 'chat_summary') {
                        var sumAction = data.action || 'generate';
                        if (sumAction === 'generate') {
                            var gResults = data.results || [];
                            var gLines = [];
                            for (var gi = 0; gi < gResults.length; gi++) {
                                var gr = gResults[gi];
                                gLines.push('📌 [' + gr.session_id + '] ' + gr.title + '（模型: ' + gr.model_id + '）');
                                gLines.push('  消息数: ' + gr.total_messages + '（用户 ' + gr.user_messages + ' / 助手 ' + gr.assistant_messages + '）');
                                if (gr.existing_summary) {
                                    var es = gr.existing_summary;
                                    gLines.push('  已有摘要: ' + (es.summary || es).substring(0, 150) + '...');
                                } else {
                                    gLines.push('  已有摘要: 无');
                                }
                                for (var gj = 0; gj < gr.messages.length; gj++) {
                                    var gm = gr.messages[gj];
                                    var gLabel = gm.role === 'user' ? '👤' : (gm.role === 'assistant' ? '🤖' : '⚙️');
                                    gLines.push('  ' + gLabel + ' ' + (gm.content || '').substring(0, 300));
                                }
                            }
                            msg = '📝 获取 ' + data.sessions + ' 个窗口的对话内容（供生成摘要）：\n\n' + gLines.join('\n') + '\n\n💡 提示: ' + (data.hint || '');
                        } else if (sumAction === 'save') {
                            var sResults = data.results || [];
                            msg = '✅ 已保存 ' + data.saved_count + ' 个窗口的摘要';
                        } else if (sumAction === 'read') {
                            var rResults = data.results || [];
                            var rLines = [];
                            for (var ri = 0; ri < rResults.length; ri++) {
                                var rr = rResults[ri];
                                if (rr.summary) {
                                    rLines.push('📌 [' + rr.session_id + '] ' + (rr.title || '') + '\n' + rr.summary);
                                } else {
                                    rLines.push('📌 [' + rr.session_id + '] 无摘要');
                                }
                            }
                            msg = '📋 已保存的摘要：\n\n' + rLines.join('\n\n---\n\n');
                        } else if (sumAction === 'list') {
                            var lSummaries = data.summaries || [];
                            if (lSummaries.length === 0) {
                                msg = '📝 暂无已保存的摘要';
                            } else {
                                var lLines = [];
                                for (var li = 0; li < lSummaries.length; li++) {
                                    var ls = lSummaries[li];
                                    lLines.push((li+1) + '. [' + ls.session_id + '] ' + ls.title + '：' + ls.summary_preview + '...');
                                }
                                msg = '📝 已保存的摘要（共 ' + data.count + ' 条）：\n' + lLines.join('\n');
                            }
                        } else if (sumAction === 'delete') {
                            msg = '🗑️ 已删除 ' + data.deleted + ' 个摘要';
                        }
                    }
                    if (tool === 'task_list') {
                        msg = data.message || '任务清单操作完成';
                        // Build rich HTML if we have list data
                        if (data.list || (data.lists && data.lists.length > 0)) {
                            var html = self._renderTaskListHtml(data);
                            if (html) {
                                return { success: true, message: msg, html: html, tool: tool, data: data };
                            }
                        }
                    }
                    if (tool === 'monitor') {
                        msg = data.message || '监控操作完成';
                    }
                    if (tool === 'diff_preview') {
                        if (data.diff) {
                            msg = '📝 Git 差异' + (data.staged ? '（暂存区）' : '（工作区）') + (data.file ? '｜文件: ' + data.file : '') + '\n' +
                                  '变更统计: ' + data.stats + '\n\n' + data.diff;
                        } else {
                            msg = '✅ 没有未提交的变更' + (data.staged ? '（暂存区干净）' : '（工作区干净）');
                        }
                    }
                    if (tool === 'git_log') {
                        var commits = data.commits || [];
                        if (commits.length === 0) {
                            msg = '📝 没有提交记录';
                        } else {
                            msg = '📝 Git 提交历史（最近 ' + commits.length + ' 条）：\n\n' + data.formatted;
                        }
                    }
                    if (tool === 'code_outline') {
                        var outlines = data.outlines || [];
                        if (outlines.length === 0) {
                            msg = '📋 未能提取代码结构';
                        } else {
                            msg = data.formatted || '📋 代码结构分析完成';
                        }
                    }
                    if (tool === 'move_file') {
                        var mResults = data.results || [];
                        var mLines = [];
                        for (var mi = 0; mi < mResults.length; mi++) {
                            var mr = mResults[mi];
                            if (mr.ok) {
                                mLines.push('  ✅ ' + mr.src + ' → ' + mr.dst);
                            } else {
                                mLines.push('  ❌ ' + mr.src + ' → ' + (mr.error || '失败'));
                            }
                        }
                        msg = '📦 移动完成：' + data.ok_count + '/' + data.total + ' 成功\n' + mLines.join('\n');
                    }
                    if (tool === 'switch_port') {
                        msg = data.message || '端口切换完成';
                    }
                    // ===== 生图/生视频完成：自动上 Kite 画布节点 =====
                    if (data && data.ok) {
                        var canvasApi = (typeof window !== 'undefined' && window.KiteCanvas) ? window.KiteCanvas : null;
                        // 图片（文生图/图生图）
                        if (tool === 'image_gen' && canvasApi && canvasApi.addImageNode) {
                            var imgUrl = data.url || (data.result && data.result.url) || (data.data && data.data.url) || '';
                            if (imgUrl) {
                                try {
                                    canvasApi.addImageNode({
                                        url: imgUrl,
                                        prompt: (payload && (payload.prompt || payload.desc)) || '',
                                        connectToChat: payload._chat_id || self.currentChatId || null
                                    });
                                } catch (e) { /* 画布异常不影响主流程 */ }
                            }
                        }
                        // 视频（文生视频）
                        if (tool === 'video_gen' && canvasApi && canvasApi.addVideoNode) {
                            var vArr = data.videos || (data.result && data.result.videos) || [];
                            if (vArr && vArr.length) {
                                for (var _vi = 0; _vi < vArr.length; _vi++) {
                                    try {
                                        canvasApi.addVideoNode({
                                            url: vArr[_vi].url || vArr[_vi],
                                            prompt: (payload && payload.prompt) || '',
                                            connectToChat: payload._chat_id || self.currentChatId || null
                                        });
                                    } catch (e2) { /* 忽略 */ }
                                }
                            }
                        }
                    }
                    return { success: true, message: msg, tool: tool, data: data };
                }
                return { success: false, message: (data && data.error) ? (label + '失败：' + data.error) : (label + '失败'), tool: tool, data: data || {} };
            }).catch(function(err) {
                return { success: false, message: label + '请求失败：' + err.message, tool: tool };
            });
        },

        // ===== 判断是否为终止型工具（调用后结束循环） =====
        isTerminal: function(name) {
            return name === 'task_complete';
        },

        // ===== 默认展开的工具白名单 =====
        // 只有此列表中的工具渲染时自动展开，其余默认折叠
        // task_complete 始终不可折叠（走单独渲染路径），无需列入
        _defaultExpanded: {
            'ask_user': true,
            'task_list': true
        },

        // ===== 工具显示名称映射 =====
        _toolLabels: {
            'task_complete': '任务结束',
            'read_file': '读取文件',
            'write_file': '写入文件',
            'run_code': '运行代码',
            'read_lines': '按行读取',
            'ask_user': '询问用户',
            'net': '联网',
            'git_save': 'Git保存',
            'project_record': '项目记录',
            'chat_manage': '对话管理',
            'wait': '等待',
            'schedule': '定时任务',
            'search_chat': '搜索对话',
            'recent_questions': '近期问题',
            'query_answers': '查询答案',
            'chat_context': '上下文管理',
            'chat_summary': '对话摘要',
            'monitor': '监控队列',
            'task_list': '任务清单',
            'replace_text': '替换文本',
            'tree_dir': '目录树',
            'list_dir': '列出目录',
            'find_files': '查找文件',
            'search_in_files': '搜索内容',
            'file_info': '文件信息',
            'diff_preview': '差异预览',
            'git_log': '提交历史',
            'code_outline': '代码结构',
            'move_file': '移动文件',
                        'send_email': '发送邮件',
            'regex_search': '正则搜索',
            'work_order': '工单清单',
            'switch_port': '切换端口',
            'switch_tool_category': '切换分类'
        },

        _toolLabel: function(name) {
            return this._toolLabels[name] || name;
        },
});
