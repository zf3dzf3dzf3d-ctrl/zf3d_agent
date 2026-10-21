/* ============================================================
 * chatbox-header-template.js —— 对话框头部模板（唯一出处）
 *
 * 背景：对话头部 HTML 曾在 4 个文件里各复制一份（app.js 恢复会话、
 * chatbox-00-toast.js 新建对话、chatbox-06-chat-actions.js 创建对话、
 * project-sessions.js 项目会话恢复）。每次加按钮都要改 4 处，曾因漏改
 * 导致 ⚡ 优先级按钮"有时有有时没有"。现统一为一个公共函数。
 *
 * 用法（全局）：App.buildChatboxHeader({ title, headerTitleAttr })
 *
 * 2026-10-14 v4 改版（极简·单入口）：顶栏右侧只留一个「⋯」按钮（承载工具
 * 计数徽章 + 1 飘字动画），其余全部收进它的下拉，以纯文字菜单项呈现。结构：
 *   .hd-menubar
 *     └─ .hd-more-wrap
 *          ├─ 「⋯」.more-btn + .tool-badge（明面徽章，数字/+1 都贴这里）
 *          └─ .hd-more-menu（竖排下拉，文字项）
 *               ├─ 工具 .tool-panel-btn（data-act=tools，点击 toggle 工具面板）
 *               ├─ 日志 .log-panel-btn （data-act=logs，点击 toggle 日志面板）
 *               ├─ 优先级 .prio-btn（data-act=priority，二级弹层）
 *               └─ 引擎 eng-picker-wrap / 分类 tool-cat-wrap / 大师集群
 *                  mastercluster-btn / Git分支 cfg-branch-btn
 *                  （后四项由 chatbox-header-relocate.js 运行时搬入）
 *   再右侧 —  ✕ 两个窗口按钮（最小化仅普通对话窗显示）。
 * hover 行为见 chatbox-header-more.js：搭上「⋯」即展开下拉，下拉内搭上
 * 引擎/分类/优先级即展开各自二级弹层，移开自动收起；点击同样可开合。
 * 徽章锚点：.tool-badge 现直接放在 .more-btn 内（与 agent-03 pulse/飘字、
 * style-chatbox.css 的 .more-btn .tool-badge 定位一致），toggle 工具面板不再
 * 改写按钮 innerHTML（emoji 退化根因已在 project-toolstats.js 修复为只切 .on 类）。
 * data-act 委托与 DOM 位置无关，节点仍在 chatbox 内，querySelector 查找不受影响。
 * ============================================================ */
(function () {
    'use strict';

    window.App = window.App || {};

    // ===== 顶栏图标化精简样式（一次性注入，自洽不依赖外部 CSS 加载顺序） =====
    (function injectHdStyle() {
        if (document.getElementById('zf-hd-icon-style')) return;
        var css = [
            '.chatbox-header-row1 .header-actions{gap:2px;margin-left:auto;}',
            // 三个明面操作按钮：方形透明底、等宽等高、白线图标居中
            '.chatbox-header-row1 .hd-btn.more-btn,',
            '.chatbox-header-row1 .hd-btn.min-btn,',
            '.chatbox-header-row1 .hd-btn.close{',
            '  display:inline-flex;align-items:center;justify-content:center;',
            '  width:22px;height:22px;padding:0;border-radius:5px;',
            '  color:var(--text2);opacity:.62;background:transparent;',
            '  transition:opacity .15s,background .15s,color .15s;',
            '}',
            '.chatbox-header-row1 .hd-btn.more-btn:hover,',
            '.chatbox-header-row1 .hd-btn.min-btn:hover{',
            '  opacity:1;background:rgba(var(--blue-rgb),.14);color:var(--text);',
            '}',
            // 关闭：默认中性灰，hover 转警示红，降低常驻刺眼
            '.chatbox-header-row1 .hd-btn.close{opacity:.5;}',
            '.chatbox-header-row1 .hd-btn.close:hover{',
            '  opacity:1;background:rgba(229,83,83,.18);color:#e55353;',
            '}',
            // 白线图标本体：描边随 currentColor，block 消除底部空隙
            '.chatbox-header-row1 .hd-ico{display:block;flex:none;}',
            // 折叠态：卡片收起时折叠图标旋转 180°（向上 V），表达"展开"
            '.chatbox.collapsed .chatbox-header-row1 .hd-btn.min-btn .hd-ico{transform:rotate(180deg);}'
        ].join('');
        var s = document.createElement('style');
        s.id = 'zf-hd-icon-style';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
    })();

    // ===== 顶栏白线描边图标（统一 16×16 viewBox，stroke=currentColor 随主题） =====
    // fold=折叠收起（向下V，展开态由 CSS 旋转）；close=关闭（X）；more=更多（三个空心圆点）
    App._hdIcon = function (kind) {
        var open = '<svg class="hd-ico" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
        if (kind === 'fold') return open + '<path d="M3 6l5 5 5-5"/></svg>';
        if (kind === 'close') return open + '<path d="M4 4l8 8M12 4l-8 8"/></svg>';
        if (kind === 'new') return open + '<path d="M8 3v10M3 8h10"/></svg>';
        // more：三个空心圆点（白线绘制，描边非实心）
        return '<svg class="hd-ico" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3">' +
            '<circle cx="3" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="13" cy="8" r="1.1"/></svg>';
    };

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

        // 「极简单入口菜单栏」：顶栏只留一个「⋯」(more-btn，承载工具徽章)，
        // 工具/日志/优先级等全部作为下拉里的纯文字菜单项，点开才展开对应面板。
        // hideMin 窗口（项目/缩略图等）没有工具/日志/优先级，整条菜单栏隐藏，只留 ✕。
        // .prio-btn 带 data-keepopen（其档位二级弹层不被 hover 逻辑误收）；
        // 工具/日志是普通项，点击直接 toggle 面板，由 chatbox-03 的 data-act 委托处理。
        // 徽章 .tool-badge 放进 .more-btn 内：agent-03 pulse/飘字锚定 more-btn，
        // style-chatbox.css 也有 .more-btn .tool-badge 定位，数字与 +1 都贴在「⋯」上。
        var menubar = hideMin ? '' :
            '<div class="hd-menubar">' +
            '<div class="hd-more-wrap">' +
            '<button class="hd-btn menu-btn more-btn" data-act="more" title="更多（工具执行过程 / 日志 / 优先级 / 引擎 / 工具分类 / 集群 / 分支）">' + App._hdIcon('more') + '<span class="tool-badge" style="display:none">0</span></button>' +
            '<div class="hd-more-menu" style="display:none">' +
            '<button class="hd-btn menu-btn tool-panel-btn" data-act="tools" title="工具执行过程（点击展开/收起面板）">工具</button>' +
            '<button class="hd-btn menu-btn log-panel-btn" data-act="logs" title="日志（点击展开/收起面板）">日志</button>' +
            '<button class="hd-btn prio-btn" data-act="priority" data-tier="0" data-keepopen="1" title="对话优先级（只影响同一个大模型的排队）：点击/悬停弹出档位；空闲10分钟自动降回">优先级</button>' +
            '<button class="hd-btn ctx-btn" data-act="ctxmode" data-keepopen="1" title="上下文处理（上一轮工具过程与旧回复的保留档位）：点击/悬停弹出档位">上下文</button>' +
            '</div>' +
            '</div>' +
            '</div>';

        return '<div class="chatbox-header"' + headerAttr + '>' +
            '<div class="chatbox-header-row1">' +
            '<span class="status-dot status-idle"></span>' +
            '<span class="title">' + title + '</span>' +
            extra +

            '<span class="header-actions">' +
            menubar +
            (hideMin ? '' : '<button class="hd-btn min-btn" data-act="minimize" title="折叠 / 展开">' + App._hdIcon('fold') + '</button>') +
            '<button class="hd-btn close" data-act="close" title="关闭">' + App._hdIcon('close') + '</button>' +
            '</span>' +
            '</div>' +
        '</div>';
    };
})();
