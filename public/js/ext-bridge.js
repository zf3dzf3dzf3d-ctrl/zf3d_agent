// ============================================================
// ext-bridge.js — 扩展子系统 ↔ Agent 主循环桥接（独立文件，删除即下线）
// 职责：
//   1. 启动/管理面板变更时拉取 /api/ext/mcp/tools，注册进 ToolDefinitions
//   2. Tools.execute 拦截 mcp_ 前缀工具 → POST /api/ext/mcp/call
//   3. getSystemPrompt 注入技能提示词（/api/ext/skills/prompt?text=用户输入）
//   4. 技能表单提交 → 组装技能 prompt + 表单值发起对话
// 主工具（tool/、tools-defs-*.js）零污染。
// 全局命名空间：window.ExtBridge
// ============================================================
(function () {
    'use strict';
    var B = window.ExtBridge = {
        mcpTools: {},          // full name -> function schema
        skillPromptCache: { text: '', prompt: '', ts: 0 },
        _mcpLoading: false,
        settings: { mcp: true, skills: true }   // 扩展总开关（与 /api/ext/settings 同步）
    };

    // ---------- 0. 扩展总开关 ----------
    B.loadSettings = function () {
        return fetch('/api/ext/settings')
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.ok) B.settings = d.settings; })
            .catch(function () { });
    };
    B.mcpEnabled = function () { return B.settings.mcp !== false; };
    B.skillsEnabled = function () { return B.settings.skills !== false; };

    // ---------- 1. MCP 工具注册 ----------
    B.loadMcpTools = function () {
        if (B._mcpLoading) return Promise.resolve();
        B._mcpLoading = true;
        if (!B.mcpEnabled()) {
            // 总开关关闭：清空全部 mcp 工具注册
            B._mcpLoading = false;
            var defs0 = (window.ToolDefinitions && window.ToolDefinitions.allTools) || null;
            if (defs0) Object.keys(defs0).forEach(function (k) { if (k.indexOf('mcp_') === 0) delete defs0[k]; });
            B.mcpTools = {};
            return Promise.resolve();
        }
        return fetch('/api/ext/mcp/tools')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.ok) return;
                // 重建：先清掉旧的 mcp_ 工具，避免 server 删除后残留
                var defs = (window.ToolDefinitions && window.ToolDefinitions.allTools) || null;
                if (defs) {
                    Object.keys(defs).forEach(function (k) { if (k.indexOf('mcp_') === 0) delete defs[k]; });
                }
                B.mcpTools = {};
                (d.tools || []).forEach(function (t) {
                    var fname = t.function && t.function.name;
                    if (!fname) return;
                    B.mcpTools[fname] = t;
                    if (defs) defs[fname] = t;   // 注册进 allTools，getDefinitions 的 self[name] 回退可命中
                });
                if (d.errors && Object.keys(d.errors).length) {
                }
            })
            .catch(function () { })
            .finally(function () { B._mcpLoading = false; });
    };

    // getDefinitions 后追加 mcp 工具（由 getDefinitions 包装调用）
    B.appendMcpDefs = function (definitions) {
        definitions = definitions || [];
        Object.keys(B.mcpTools).forEach(function (k) {
            definitions.push(B.mcpTools[k]);
        });
        return definitions;
    };

    // ---------- 2. MCP 工具执行 ----------
    B.isMcpTool = function (name) { return String(name || '').indexOf('mcp_') === 0 && name.indexOf('__') > 0; };

    B.callMcp = function (name, args) {
        return fetch('/api/ext/mcp/call', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: name, arguments: args || {} })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.ok) return { success: false, message: 'MCP 调用失败: ' + (d.error || '未知错误'), tool: name };
            var res = d.result || {};
            // 提取 MCP content 数组中的文本
            var texts = [];
            if (Array.isArray(res.content)) {
                res.content.forEach(function (c) { if (c && c.type === 'text' && c.text) texts.push(c.text); });
            }
            var msg = texts.join('\n') || JSON.stringify(res, null, 2).slice(0, 2000);
            return { success: !res.isError, message: msg, tool: name, ui: res.ui || null, raw: res };
        });
    };

    // execute 包装：mcp 工具拦截
    B.installExecuteHook = function () {
        if (typeof Tools === 'undefined' || !Tools.execute || Tools._extBridgeHooked) return;
        Tools._extBridgeHooked = true;
        var orig = Tools.execute;
        Tools.execute = function (name, args, context) {
            if (B.isMcpTool(name)) {
                if (!B.mcpEnabled()) {
                    return Promise.resolve({ success: false, message: 'MCP 扩展已在设置中关闭', tool: name });
                }
                if (!B.mcpTools[name]) {
                    // 定义缺失（如页面刚刷新）：尝试即时拉一次再调用
                    return B.loadMcpTools().then(function () {
                        return B.callMcp(name, args);
                    });
                }
                return B.callMcp(name, args);
            }
            return orig.call(this, name, args, context);
        };
    };

    // ---------- 3. 技能提示词注入 ----------
    // 同步走缓存；异步预热（缓存过期且文本变化时刷新）
    B.getSkillPrompt = function (userText) {
        userText = (userText || '').trim();
        if (!userText) return '';
        var c = B.skillPromptCache;
        // 命中缓存：文本前缀相同且未过期（60s）
        if (c.prompt && (userText === c.text || userText.indexOf(c.text) === 0) && Date.now() - c.ts < 60000) {
            return c.prompt;
        }
        // 异步刷新，不阻塞本次请求
        fetch('/api/ext/skills/prompt?text=' + encodeURIComponent(userText.slice(0, 200)))
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.ok) {
                    B.skillPromptCache = { text: userText.slice(0, 200), prompt: d.prompt || '', ts: Date.now() };
                }
            }).catch(function () { });
        // 首次无缓存：【性能修复】不再同步 XHR 阻塞主线程（sendToModel 是发送链路，
        // 同步请求会卡住整个页面，后端慢时「点发送特别卡」）。改为：本次返回空，
        // 异步拉取后写入缓存，下一次请求即可命中。
        if (!c.prompt || c.prompt && userText.indexOf(c.text) !== 0) {
            fetch('/api/ext/skills/prompt?text=' + encodeURIComponent(userText.slice(0, 200)))
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d && d.ok) {
                        B.skillPromptCache = { text: userText.slice(0, 200), prompt: d.prompt || '', ts: Date.now() };
                    }
                }).catch(function () { });
        }
        return c.prompt || '';
    };

    // ---------- 4. 技能表单提交 → 发起对话 ----------
    // 处理 skill-panel 中 data-ext-action 的 submit 类动作
    B.submitSkillForm = function (panel, action) {
        if (!panel) return false;
        var vals = {};
        panel.querySelectorAll('.ext-ui-field [data-fname]').forEach(function (el) {
            var n = el.dataset.fname;
            if (el.type === 'checkbox') {
                if (el.checked) (vals[n] = vals[n] || []).push(el.value);
            } else if (el.type === 'radio') {
                if (el.checked) vals[n] = el.value;
            } else { vals[n] = el.value; }
        });
        var skillId = panel.dataset.skillId || (action && action.skill) || '';
        var parts = ['请使用技能「' + skillId + '」处理以下内容：'];
        Object.keys(vals).forEach(function (k) { parts.push(k + ': ' + vals[k]); });
        var text = parts.join('\n');
        // 走输入框注入 + 触发发送
        var input = document.getElementById('chat-input') ||
                    document.querySelector('textarea, input[type=text]');
        if (!input) return false;
        input.value = text;
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
        // 找发送按钮
        var sendBtn = document.getElementById('chat-send') ||
                      document.getElementById('send-btn') ||
                      (input.closest('form') && input.closest('form').querySelector('button[type=submit]'));
        if (sendBtn) { sendBtn.click(); return true; }
        if (typeof Tools !== 'undefined' && typeof App !== 'undefined') {
            // 回退：直接触发回车
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            return true;
        }
        return false;
    };

    // 挂到发送链路：sendToModel 前注入技能提示词（sendToModel 挂在 App 上）
    B.installSkillInject = function () {
        var target = (typeof App !== 'undefined' && App.sendToModel) ? App
                   : (typeof Tools !== 'undefined' && Tools.sendToModel) ? Tools : null;
        if (!target) {
            // App 加载晚于本文件时重试（agent-*.js 定义 sendToModel）
            setTimeout(B.installSkillInject, 500);
            return;
        }
        var self = B;
        target._extSkillInjectHooked = true;
        var orig = target.sendToModel;
        target.sendToModel = function (box, chat) {
            try {
                    if (!self.skillsEnabled()) { chat._extSkillPrompt = null; return orig.call(this, box, chat); }
                    // 取最后一条用户消息做技能匹配
                    var lastUser = '';
                    if (chat && chat.history) {
                        for (var i = chat.history.length - 1; i >= 0; i--) {
                            if (chat.history[i] && chat.history[i].role === 'user') {
                                lastUser = typeof chat.history[i].content === 'string'
                                    ? chat.history[i].content
                                    : (chat.history[i].content && JSON.stringify(chat.history[i].content)) || '';
                                break;
                            }
                        }
                    }
                    var sp = self.getSkillPrompt(lastUser);
                    if (sp) {
                        // 延迟到 messages 构造后注入：包装 push 不可行，改在下一 tick 修改 messages[0]
                        // 简化：把技能提示词缓存到 chat 上，agent-01 组装 messages 时读取
                        chat._extSkillPrompt = sp;
                    } else {
                        chat._extSkillPrompt = null;
                    }
                } catch (e) { }
            return orig.call(this, box, chat);
        };
    };

    // ---------- 5. 技能面板动作处理（提交按钮） ----------
    B.installSkillPanelSubmit = function () {
        // 扩展 ext-ui-render 的动作委托：面板 data-ext-panel="skill" 时拦截为技能提交
        document.addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-ext-action]');
            if (!btn) return;
            var panel = btn.closest('.ext-ui');
            if (!panel || panel.dataset.extPanel !== 'skill') return;
            var action;
            try { action = JSON.parse(btn.dataset.extAction); } catch (e) { return; }
            if (action.type !== 'submit' && !action.skill) return; // 非 skill 提交动作放行
            ev.stopImmediatePropagation();
            B.submitSkillForm(panel, action);
        }, true); // capture 先于 ext-ui-render 的委托执行
    };

    // ---------- 启动 ----------
    function boot() {
        if (typeof Tools === 'undefined') { setTimeout(boot, 300); return; }
        B.loadSettings().then(function () { B.loadMcpTools(); });
        B.installExecuteHook();
        B.installSkillInject();
        B.installSkillPanelSubmit();
        // getDefinitions 包装：追加 mcp 工具定义
        if (Tools.getDefinitions && !Tools._extBridgeDefsHooked) {
            Tools._extBridgeDefsHooked = true;
            var origDefs = Tools.getDefinitions;
            Tools.getDefinitions = function (options, chatId) {
                return B.appendMcpDefs(origDefs.call(this, options, chatId));
            };
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
