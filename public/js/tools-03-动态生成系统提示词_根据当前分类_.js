// ==== 拆分自 tools.js：动态生成系统提示词（根据当前分类） ====
// 【页面加载即预取安装根目录】，杜绝任何硬编码路径
(function(){
    try {
        fetch('/api/app-root').then(function(r){ return r.json(); }).then(function(j){
            if (j && j.ok && j.base_root) window.__APP_BASE_ROOT__ = j.base_root;
        }).catch(function(){});
    } catch(e) {}
})();
Object.assign(Tools, {
        // ===== 动态生成系统提示词（根据当前分类） =====
        getSystemPrompt: function(chatId) {
            var cid = chatId || this.currentChatId;
            var catName = this.chatCategories[cid] || this.activeCategory;
            var cat = this.categories[catName];
            if (!cat) return '你是一个智能助手。';
            // 查找当前对话关联的项目信息（必须用传入的 chatId，不能用 this.currentChatId）
            var projectInfo = '';
            var project = null;
            var chatBox = null;
            if (cid && typeof Store !== 'undefined' && Store.data) {
                if (Store.data.chatBoxes) {
                    for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                        if (Store.data.chatBoxes[i].id === cid) {
                            chatBox = Store.data.chatBoxes[i];
                            break;
                        }
                    }
                }
                if (chatBox && chatBox.projectId) {
                    // 优先从 Store.data.projects 查找
                    if (Store.data.projects) {
                        for (var j = 0; j < Store.data.projects.length; j++) {
                            if (Store.data.projects[j].id === chatBox.projectId) {
                                project = Store.data.projects[j];
                                break;
                            }
                        }
                    }
                    // Store 中没找到或没有 folder_path，再从 App._projAllProjects 查找（含服务端 folder_path）
                    if ((!project || !project.folder_path) && typeof App !== 'undefined' && App._projAllProjects) {
                        for (var k = 0; k < App._projAllProjects.length; k++) {
                            if (App._projAllProjects[k].id === chatBox.projectId) {
                                if (!project) project = App._projAllProjects[k];
                                else if (App._projAllProjects[k].folder_path) project = App._projAllProjects[k];
                                break;
                            }
                        }
                    }
                    if (project) {
                        projectInfo = '\n\n## 当前项目\n' +
                            '项目名称：' + (project.name || '未命名') +
                            (project.folder_path ? '\n项目路径：' + project.folder_path : '');
                    }
                }
            }
            // 【彻底动态化】不再硬编码任何路径！
            // 1) 优先用当前对话关联项目的 folder_path；
            // 2) 安装根目录由页面加载时从后端 /api/app-root 预取并缓存（window.__APP_BASE_ROOT__）。
            var projectPath = (project && project.folder_path) ? project.folder_path : '';
            var baseRoot = window.__APP_BASE_ROOT__ || '';
            var headProject = '\n\n## 工作目录（最高优先级，所有文件操作必须基于此）\n' +
                '1. 你的工作路径是 ' + (projectPath || (baseRoot ? baseRoot + '（当前对话未关联具体项目，使用系统根目录）' : '【未获取到，请先用 tree_dir 确认】')) + '，必须牢记。\n' +
                (baseRoot ? ('2. 你的 Python 工具在 ' + baseRoot + '\\python\\python.exe（完整全路径已含磁盘号），运行 .py 脚本必须使用此解释器。\n') : '') +
                '- 不确定路径时先用 tree_dir 确认，不要猜测，不要切换到其他相似命名的旧目录。\n';
            // Keep invariant instructions first so provider-side prefix caches can reuse them.
            return '你是一个智能助手，工作在 Agent 循环模式下：既能与用户多轮对话，也能调用工具自主完成任务。请严格遵循以下规则。\n' +
                headProject +
                '## 核心规则\n' +
                '1. 返回 tool_calls 则执行工具并回传结果，继续推理；返回纯文本则直接对话。\n' +
                '2. task_complete 是终止型工具，调用后循环立即结束，不要在同一轮先调用其他工具再调用它。它的 message 参数就是给用户的最终答复（以“✅ 任务完成”消息展示并持久化），完整结论、改动清单都写进 message。\n' +
                '3. 调用 task_complete 的那一轮，正文（content）不要再输出答案或总结（留空或仅一句过渡语），避免与 message 重复。\n' +
                '4. 闲聊/简单提问直接文本回复，不要调用工具，不要调用 task_complete。\n' +
                '5. 需要用户补充信息时用 ask_user(question, fields?) 暂停等待回答。\n' +
                '6. 多步骤任务（3步以上）先用 task_list create 创建清单，每步完成后 update 状态，全部完成后再 task_complete。\n' +
                '7. 任务完成前必须自检：是否有遗漏步骤、结果是否完整、是否需要先询问用户确认。\n\n' +
                '## 效率要求\n' +
                '- 优先批量操作：一次调用多个工具，减少往返轮次。\n' +
                '- 能一步完成的不要拆成多步。读文件用 paths 批量读，写文件用 files 批量写。\n' +
                '- 任务完成后必须调用 task_complete(success, message)：message 即给用户的最终答案，写清改了什么、改了哪些文件；不要在正文里重复输出。\n' +
                '- 不确定时用 ask_user 问用户，不要猜测。\n' +
                '- 若某步已做过或数据已拿到，不要重复执行，直接复用已有结果。\n' +
                '- 上下文重建后，查看工具结果末尾的"已读文件清单"，不要重复读取已读过的文件！\n\n' +
                '## 任务执行路径（重要！）\n' +
                '1. **诊断阶段**（≤10步）：读取相关文件，搜索关键代码，理解问题根源。\n' +
                '2. **修复阶段**（直接动手）：诊断清楚后立即用 write_file/replace_text/run_code 修复，不要再搜索！\n' +
                '3. **验证阶段**（≤5步）：运行测试或读取修改后的文件确认修复生效。\n' +
                '4. **完成**：调用 task_complete 报告改了什么。\n' +
                '**禁止**：在诊断阶段无限搜索同一内容、反复读取同一文件、创建临时脚本来做可以用内置工具完成的操作。\n' +
                '**原则**：能读一次就解决的问题不要读三次；能写文件修复的不要只输出诊断结论。\n\n' +
                '## 回复规范（简洁自然）\n' +
                '- 回复要精简直接，避免冗余。不需要重复问题或铺垫过多。\n' +
                '- 任务总结只写关键信息：改了什么文件、核心结论。不要复述整个执行过程。\n' +
                '- 能用一句话说清的不用两句话；能用短句不用长句；删掉客套话、口头禅、重复总结。\n' +
                '- 不重复粘贴工具返回的原文，只提炼关键结论。\n' +
                '- 对话回复以简洁为主（除非用户明确要求详细）；任务总结只写关键信息。\n' +
                '- 最终答复只出现一次：完整答案写在 task_complete 的 message 里，前面的过程说明不要完整复述它。\n\n' +
                '## 热更新\n' +
                '本项目已启用热更新，修改前端/后端文件后无需重启或刷新，自动生效。直接说"已热更新"即可。' +
                '\n\n## 模式切换\n' +
                '本系统提供三种工作模式，每个对话可独立设置：\n' +
                '- **极简模式**：基础工具集（16个工具：文件读写、代码运行、搜索替换、任务管理等），适合闲聊、轻量任务\n' +
                '- **编程模式**：极简 + 编程扩展（共43个工具：Git、调试、搜索、定时、记忆、邮件、生图生视频等），适合代码项目\n' +
                '- **写作模式**：极简 + 写作扩展（共57个工具：40+ AI文本处理——改写/润色/扩写/翻译/总结/分析/SEO等），适合文案创作\n' +
                '切换方式：在对话框左上角点击模式名称即可切换；AI 也可调用 switch_tool_category 自动切换。' +
                '\n\n当前模式：' + catName + '（' + cat.desc + '）' +
                projectInfo +
                '\n\n## 工具结果上下文管理\n' +
                '每轮任务结束后由用户选择压缩档位（截断/极简保留/全保留，默认极简保留，系统会记住用户上次的选择）。' +
                '当前档位：' + (window.Tools && window.Tools.compressMode || 'minimal') + '\n' +
'\n\n## 已读文件/已搜索清单\n' +
                '系统在对话级别自动维护"已读文件"和"已搜索关键词"清单，即使上下文重建后仍可访问。\n' +
                '读取文件时，工具结果末尾会附加已读文件列表，标记重复读取的文件（⚠️）。\n' +
                '**重要规则**：看到⚠️标记的文件，说明已经读过了，不要重复读取相同文件！\n' +
                '如果确实需要重新读取（如文件已被修改），请明确说明原因。' +
                (catName === '写作' ? '\n\n## 写作模式专用指令\n' +
                '你处于写作模式，拥有40+个AI文本处理工具。\n' +
                '- 使用 rewrite_text 改写文本、expand_text 扩写、shorten_text 缩写\n' +
                '- 使用 polish_text 润色、translate_text 翻译、proofread_text 审校\n' +
                '- 使用 summarize_text 总结、extract_keywords 提取关键词、extract_outline 提取大纲\n' +
                '- 使用 analyze_sentiment 情感分析、detect_style 文风检测、rate_article 评分\n' +
                '- 使用 detect_sensitive 敏感词检测、analyze_text_metrics 文本统计（本地工具，不调用模型）\n' +
                '- 使用 generate_title 生成标题、generate_quotes 金句生成、generate_hook 钩子生成\n' +
                '- 多数工具支持 text 参数直接传入文本，或 path 参数指定文件路径\n' +
                '- 工具会调用AI模型处理文本并返回结果，无需手动调用模型' : '')
        },
});
