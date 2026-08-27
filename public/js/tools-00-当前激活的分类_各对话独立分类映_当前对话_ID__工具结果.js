// ==== 拆分自 tools.js：核心定义（var Tools 骨架） ====
// 使用 Object.assign 合并到已有 Tools 对象，热更新重载时不会丢失 tools-01~99 添加的方法
window.Tools = Object.assign(window.Tools || {}, {

        // ===== 当前激活的分类 =====
        activeCategory: '极简',

        // ===== 各对话独立分类映射（chatId → 分类名） =====
        chatCategories: {},

        // ===== 当前对话 ID（由 app-agent.js 在工具执行前设置） =====
        currentChatId: '',

        // ===== 工具结果上下文管理配置（三档压缩模式：由用户在任务完成后选择，见 App._applyCompressMode） =====
        toolResultConfig: {
            keepRecent: 3,      // 保留最近 N 条 tool 结果原文，更早的替换为 [已丢弃]
            maxKeep: 50,         // 总上限安全阀，防止无限增长
            maxCharsPerTool: 1500 // 单条 tool 结果保留的最大字符数（超出截断为头尾摘要），0=不限制
        },

        // ===== 工具结果存档（丢弃前存档，AI 可通过 get_tool_result 找回，task_complete 时清空） =====
        toolResultArchive: {},  // { chatId: [ {id, toolName, content, archivedAt}, ... ] }
        _archiveCounter: 0,     // 自增 ID 计数器

        // ===== 工具结果出口限额（源头拦截：进上下文前截断，配置统一来自 private/tool_result_limits.json） =====
        exitLimits: {
            enabled: true,
            defaults: { max_chars: 6000, head_ratio: 0.7, tail_ratio: 0.3 },
            tools: {},
            _exempt: ['get_tool_result', 'task_complete', 'ask_user'],
            _loaded: false
        },

        // ===== 已读文件/已搜索关键词缓存（对话级别，上下文重建后仍可访问） =====
        // 格式: { chatId: { readFiles: { 'path': readCount, ... }, searchedKeywords: { 'keyword': searchCount, ... } } }
        _toolCache: {},
        _getToolCache: function(chatId) {
            var cid = chatId || this.currentChatId;
            if (!cid) return { readFiles: {}, searchedKeywords: {} };
            if (!this._toolCache[cid]) this._toolCache[cid] = { readFiles: {}, searchedKeywords: {} };
            return this._toolCache[cid];
        },
        // 记录已读文件
        _trackReadFile: function(path, chatId) {
            if (!path) return;
            var cache = this._getToolCache(chatId);
            cache.readFiles[path] = (cache.readFiles[path] || 0) + 1;
        },
        // 记录已搜索关键词
        _trackSearch: function(keyword, chatId) {
            if (!keyword) return;
            var cache = this._getToolCache(chatId);
            cache.searchedKeywords[keyword] = (cache.searchedKeywords[keyword] || 0) + 1;
        },
        // 获取已读文件提示（供工具结果附加）
        _getReadFilesHint: function(chatId) {
            var cache = this._getToolCache(chatId);
            var paths = Object.keys(cache.readFiles);
            if (paths.length === 0) return '';
            var lines = ['\n\n--- 已读文件清单（避免重复读取）---'];
            paths.forEach(function(p) {
                var cnt = cache.readFiles[p];
                lines.push('  ' + p + (cnt > 1 ? ' (已读' + cnt + '次⚠️重复)' : ''));
            });
            return lines.join('\n');
        },
        // 获取已搜索提示
        _getSearchedHint: function(chatId) {
            var cache = this._getToolCache(chatId);
            var kws = Object.keys(cache.searchedKeywords);
            if (kws.length === 0) return '';
            var lines = ['\n\n--- 已搜索关键词清单（避免重复搜索）---'];
            kws.forEach(function(k) {
                var cnt = cache.searchedKeywords[k];
                lines.push('  "' + k + '"' + (cnt > 1 ? ' (已搜' + cnt + '次⚠️重复)' : ''));
            });
            return lines.join('\n');
        },
        // 清空对话缓存（task_complete 时调用）
        _clearToolCache: function(chatId) {
            var cid = chatId || this.currentChatId;
            if (cid && this._toolCache[cid]) delete this._toolCache[cid];
        },

        // ===== category definitions (provided by tools-definitions.js) =====
        categories: window.ToolDefinitions.categories,

        // ===== tool definitions (provided by tools-definitions.js) =====
        allTools: window.ToolDefinitions.allTools,
        getDefinitions: function(options, chatId) {
            var cid = chatId || this.currentChatId;
            var catName = this.chatCategories[cid] || this.activeCategory;
            var cat = this.categories[catName];
            if (!cat) return [];
            var result = [];
            var self = this;
            var compact = !options || options.compact !== false;
            cat.tools.forEach(function(name) {
                // ===== 元工具（switch_tool_category / task_complete）始终包含，不受设置过滤 =====
                var isMeta = (name === 'switch_tool_category' || name === 'task_complete');
                if (!isMeta && typeof window.ToolsSettings !== 'undefined' &&
                    typeof window.ToolsSettings.isToolEnabled === 'function' &&
                    !window.ToolsSettings.isToolEnabled(name)) {
                    return;
                }
                var t = self.allTools[name] || self[name];
                if (!t) return;
                if (!compact) { result.push(t); return; }
                result.push({ type: t.type, function: {
                    name: t.function.name,
                    description: t.function.description,
                    parameters: self._compactToolSchema(t.function.parameters)
                }});
            });
            return result;
        },

        // Remove non-essential schema metadata before sending tool definitions.
        // Keep the JSON Schema structure required by OpenAI-compatible endpoints.
        _compactToolSchema: function(schema) {
            if (!schema || typeof schema !== 'object') return schema;
            var compact = {};
            var allowed = ['type', 'description', 'enum', 'const', 'default', 'required', 'additionalProperties'];
            allowed.forEach(function(key) {
                if (Object.prototype.hasOwnProperty.call(schema, key)) {
                    compact[key] = schema[key];
                }
            });
            if (schema.properties && typeof schema.properties === 'object') {
                compact.properties = {};
                Object.keys(schema.properties).forEach(function(key) {
                    compact.properties[key] = Tools._compactToolSchema(schema.properties[key]);
                });
            }
            if (schema.items && typeof schema.items === 'object') {
                compact.items = Tools._compactToolSchema(schema.items);
            }
            if (schema.anyOf && Array.isArray(schema.anyOf)) {
                compact.anyOf = schema.anyOf.map(function(item) {
                    return Tools._compactToolSchema(item);
                });
            }
            if (schema.oneOf && Array.isArray(schema.oneOf)) {
                compact.oneOf = schema.oneOf.map(function(item) {
                    return Tools._compactToolSchema(item);
                });
            }
            return compact;
        },

        // ===== 获取分类列表（用于渲染切换菜单） =====
});
