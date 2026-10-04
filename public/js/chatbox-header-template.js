/* ============================================================
 * chatbox-header-template.js —— 对话框头部模板（唯一出处）
 *
 * 背景：对话头部 HTML 曾在 4 个文件里各复制一份（app.js 恢复会话、
 * chatbox-00-toast.js 新建对话、chatbox-06-chat-actions.js 创建对话、
 * project-sessions.js 项目会话恢复）。每次加按钮都要改 4 处，曾因漏改
 * 导致 ⚡ 优先级按钮"有时有有时没有"。现统一为一个公共函数。
 *
 * 用法（全局）：App.buildChatboxHeader({ title, headerTitleAttr })
 *  - title:        <span class="title"> 的内容（必填）
 *  - headerTitleAttr: chatbox-header 的 title 提示（可省略）
 *  - extraBeforeButtons: 标题后、按钮前的额外 HTML（如项目名的 span，可省略）
 * 以后加/改头部按钮只改这里一处，4 个入口自动生效。
 * ============================================================ */
(function () {
    'use strict';

    window.App = window.App || {};

    App.buildChatboxHeader = function (opts) {
        opts = opts || {};
        var title = opts.title || '';
        var extra = opts.extraBeforeButtons || '';
        // 项目/缩略图文件夹等窗口不需要最小化按钮（只保留关闭）
        var _t = String(title);
        var hideMin = opts.hideMin || /项目|缩略图|📁|🖼|🗂/.test(_t);
        var headerAttr = opts.headerTitleAttr
            ? ' title="' + String(opts.headerTitleAttr).replace(/"/g, '&quot;') + '"'
            : '';

        return '<div class="chatbox-header"' + headerAttr + '>' +
            '<div class="chatbox-header-row1">' +
            '<span class="status-dot status-idle"></span>' +
            '<span class="title">' + title + '</span>' +
            extra +

            '<span class="header-actions">' +

            '<button class="hd-btn tool-panel-btn" data-act="tools" title="工具执行过程">🔧<span class="tool-badge" style="display:none">0</span></button>' +
            '<button class="hd-btn log-panel-btn" data-act="logs" title="日志">📜</button>' +
            '<button class="hd-btn prio-btn" data-act="priority" data-tier="0" title="对话优先级（只影响同一个大模型的排队）：点击弹出菜单选择档位；空闲10分钟自动降回">⚡</button>' +
            (hideMin ? '' : '<button class="hd-btn min-btn" data-act="minimize" title="最小化">—</button>') +
            '<button class="hd-btn close" data-act="close" title="关闭">✕</button>' +
            '</span>' +
            '</div>' +
        '</div>';
    };
})();
