/* ============================================================
 * chatbox-panels-template.js —— 对话框主体面板模板（唯一出处）
 *
 * 对话框 header 以下的结构：body / toolpanel / logpanel / queue /
 * 导航按钮 / inputrow / configrow / resize。曾在 4 个文件里各复制一份
 * （面板顺序甚至不一致），现统一在这里生成。
 *
 * 依赖：App.buildChatboxHeader（chatbox-header-template.js）
 *
 * 用法：App.buildChatboxPanels({
 *   header:    <header HTML>（必填，通常来自 App.buildChatboxHeader）
 *   bodyHtml:  对话体初始内容（新建路径传欢迎消息，恢复路径传 ''）
 *   panelOrder: 'toolpanel-first'（旧默认）| 'logpanel-first'
 *               兼容历史差异；新代码建议统一 'toolpanel-first'。
 * })
 * ============================================================ */
(function () {
    'use strict';

    window.App = window.App || {};

    function toolPanelHtml() {
        return '<div class="chatbox-toolpanel">' +
            '<div class="chatbox-toolpanel-header">' +
            '<span class="chatbox-toolpanel-title">🔧 工具执行过程</span>' +
            '<button class="chatbox-toolpanel-close" title="关闭面板">✕</button>' +
            '</div>' +
            '<div class="chatbox-toolpanel-body"></div>' +
            '</div>';
    }

    function logPanelHtml() {
        return '<div class="chatbox-logpanel">' +
            '<div class="logpanel-tabs">' +
            '<span class="logpanel-tab active" data-tab="logs">日志</span>' +
            '<span class="logpanel-tab" data-tab="ctx">上下文</span>' +
            '<span class="logpanel-actions">' +
            '<button class="lp-btn" data-lp-act="copy" title="复制对话和日志">📋 复制</button>' +
            '<button class="lp-btn" data-lp-act="clear" title="清空对话和日志">🗑 清空</button>' +
            '</span>' +
            '</div>' +
            '<div class="logpanel-body"></div>' +
            '</div>';
    }

    App.buildChatboxPanels = function (opts) {
        opts = opts || {};
        var header = opts.header || '';
        var bodyHtml = opts.bodyHtml || '';
        var order = opts.panelOrder === 'logpanel-first' ? [logPanelHtml(), toolPanelHtml()] : [toolPanelHtml(), logPanelHtml()];

        return header +
            '<div class="chatbox-body">' + bodyHtml + '</div>' +
            order[0] + order[1] +
            '<div class="chatbox-queue" style="display:none"></div>' +
            '<button class="prev-user-btn" title="定位到上一条用户问题所在的段落"><span>⬆</span></button> ' +
            /* ⚠ 这两个按钮的事件绑定在别处，改这里须同步核对：
               chatbox-03-chat-interaction.js（scroll-bottom-btn / prev-user-btn 绑定）、chatbox-06-chat-actions.js、app.js、app-pipeline.js */
            '<button class="scroll-bottom-btn" title="滚动到底部"><span>▼</span></button>' +
            '<div class="chatbox-inputrow">' +
            '<button class="upload-btn" title="上传文件 / 文件夹">+</button>' +
            '<button class="voice-btn" type="button" title="语音输入"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button>' +
            '<textarea placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>' +
            '<button class="send-btn" title="发送消息"><svg class="send-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>' +
            '</div>' +
            '<div class="chatbox-configrow">' +
            '<div class="eng-picker-wrap">' +
            '<button class="eng-trigger" title="底层对话引擎（对话处理管线）">' +
            '<span class="eng-name">默认</span>' +
            '<span class="eng-arrow">▾</span>' +
            '</button>' +
            '<div class="eng-menu" hidden></div>' + /* 引擎菜单内容由 chatbox-config-widgets.js 统一填充 */
            '</div>' +
            '<div class="tool-cat-wrap">' +
            '<button class="tool-cat-trigger" title="切换工具分类">' +
            '<span class="tool-cat-icon">📄</span>' +
            '<span class="tool-cat-name">极简</span>' +
            '</button>' +
            '<div class="tool-cat-menu" hidden></div>' + /* 分类菜单由 chatbox-config-widgets.js 统一填充 */
            '</div>' +
            '<button class="cfg-btn cfg-project-btn" data-act="project" title="切换项目">📁<span class="proj-label">切换项目</span></button>' +
            '<button class="cfg-btn cfg-branch-btn" data-act="branch" title="Git 分支：新建 / 选择 / 合并到主分支">🌿<span class="branch-label">主分支</span></button>' +
            '<div class="model-picker-wrap">' +
            '<button class="model-picker-btn" title="点击选择模型 / 模型ID / 思考强度"><span class="model-picker-name">未选择模型</span><span class="model-picker-arrow">▾</span></button>' +
            '<div class="model-picker-menu mp-horizontal" hidden>' +
            '<div class="mp-cats"></div>' +
            '<div class="mp-row">' +
            '<select class="mp-line-select" title="选择大模型"></select>' +
            '<select class="mp-modelid-input" title="选择模型 ID"></select>' +
            '<select class="mp-re-input" title="思考强度（reasoning_effort）"></select>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="chatbox-resize"><span class="chatbox-resize-handle south-east"></span><span class="chatbox-resize-handle south-west"></span><span class="chatbox-resize-handle south"></span><span class="chatbox-resize-handle east"></span><span class="chatbox-resize-handle west"></span></div>';
    };
})();
