/* ============================================================
 * i18n.js — 中英文双语框架（v3 大词典版）
 * - CN2EN 词典 + scanAll(): 按中文原文自动翻译整个 DOM
 *   覆盖设置面板静态 HTML 与对话框/顶栏动态生成的文案
 * - RULES 正则层：翻译动态拼接文案（如"消息已排队 (N 条)"）
 * - 英文模式下 MutationObserver 监听新增节点自动翻译
 * - 切中文时通过 _orig 缓存恢复原文
 * - window.I18N = { t, setLang, lang, scan }
 * ============================================================ */
(function () {
    'use strict';

    /* ---------- 中→英 词典（UI 文案） ---------- */
    const CN2EN = {
        /* ===== 顶栏 / 全局 ===== */
        '模型: 未配置': 'Model: Not configured',
        '点击配置模型': 'Click to configure model',
        '⚙️ 设置': '⚙️ Settings',
        '切换开关': 'Toggle',
        '未命名': 'Untitled',
        '关闭': 'Close',
        '刷新': 'Refresh',
        '精简': 'Compact',
        '详细': 'Detailed',
        '摘要': 'Summary',
        '下载': 'Download',
        '上传': 'Upload',
        '确认': 'Confirm',
        '取消': 'Cancel',
        '保存': 'Save',
        '删除': 'Delete',
        '重命名': 'Rename',
        '搜索': 'Search',
        '复制': 'Copy',
        '编辑': 'Edit',
        '测试': 'Test',
        '启用': 'Enable',
        '停用': 'Disable',
        '恢复': 'Restore',
        '新建': 'New',
        '打开': 'Open',
        '发送': 'Send',
        '清空': 'Clear',
        '全部': 'All',
        '无': 'None',
        '是': 'Yes',
        '否': 'No',
        '加载中…': 'Loading…',
        '加载中...': 'Loading...',
        '处理中…': 'Processing…',
        '思考中…': 'Thinking…',
        '思考中...': 'Thinking...',
        '生成中…': 'Generating…',
        '生成中...': 'Generating...',
        '等待中': 'Waiting',
        '已完成': 'Completed',
        '已取消': 'Cancelled',
        '失败': 'Failed',
        '成功': 'Success',
        '错误': 'Error',
        '警告': 'Warning',
        '信息': 'Info',
        '调试': 'Debug',

        /* ===== 设置面板导航 ===== */
        '模型配置': 'Model Config',
        '运行日志': 'Logs',
        '邮件通知': 'Email Notify',
        '备份管理': 'Backup',
        '健康守护': 'Health Guard',
        '独有功能与对比': 'Features & Compare',
        '简介': 'Intro',
        '帮助': 'Help',
        '关于': 'About',

        /* ===== 模型配置 ===== */
        '🤖 模型配置': '🤖 Model Config',
        '添加自定义模型': 'Add Custom Model',
        '模型名称（显示用）': 'Model name (display)',
        'API 接口地址': 'API endpoint URL',
        'API 審钥': 'API key',
        'API 審钥（可选）': 'API key (optional)',
        '模型 ID': 'Model ID',
        '保存并测试': 'Save & Test',
        '📋 日志': '📋 Logs',
        '💬 对话': '💬 Chat',
        '📋 复制全部': '📋 Copy All',
        '模型: ': 'Model: ',
        '模型顺序已调整': 'Model order updated',
        '自定义模型': 'Custom Model',
        '应用': 'Apply',
        '设为默认': 'Set as default',
        '默认': 'Default',
        '当前': 'Current',
        '未配置': 'Not configured',
        '连接成功': 'Connected',
        '连接失败': 'Connection failed',
        '测试通过': 'Test passed',
        '测试失败': 'Test failed',
        '密钥已配置': 'Key configured',
        '密钥未配置': 'Key not configured',
        '接口地址': 'Endpoint URL',
        '密钥': 'Key',
        '名称': 'Name',
        '状态': 'Status',
        '操作': 'Actions',
        '模型列表': 'Model list',
        '排序': 'Order',
        '上移': 'Move up',
        '下移': 'Move down',
        '删除模型': 'Delete model',
        '确认删除该模型？': 'Delete this model?',
        '拖拽调整顺序': 'Drag to reorder',

        /* ===== 邮件通知 ===== */
        '📧 邮件通知': '📧 Email Notification',
        '启用邮件通知': 'Enable email notification',
        '开启': 'On',
        '关闭': 'Off',
        'SMTP 服务器地址': 'SMTP server',
        'SMTP 端口': 'SMTP port',
        'SSL（端口 465）': 'SSL (port 465)',
        'STARTTLS（端口 587）': 'STARTTLS (port 587)',
        '发件邮箱地址': 'Sender email',
        'SMTP 授权码': 'SMTP auth code',
        '收件邮箱地址': 'Recipient email',
        '发送测试邮件': 'Send test email',
        '测试邮件已发送': 'Test email sent',
        '测试邮件发送失败': 'Failed to send test email',
        '邮件功能已开启': 'Email enabled',
        '邮件功能已关闭': 'Email disabled',

        /* ===== 备份管理 ===== */
        '💾 备份管理': '💾 Backup',
        '新建备份': 'New backup',
        '恢复备份': 'Restore backup',
        '删除备份': 'Delete backup',
        '下载数据库': 'Download database',
        '上传数据库': 'Upload database',
        '备份时间': 'Backup time',
        '备份名称': 'Backup name',
        '快照': 'Snapshot',
        '恢复此备份': 'Restore this backup',
        '删除此备份': 'Delete this backup',
        '当前数据库已备份': 'Database backed up',
        '备份已恢复': 'Backup restored',
        '备份已删除': 'Backup deleted',
        '确认恢复此备份吗？': 'Restore this backup?',
        '确认删除此备份吗？': 'Delete this backup?',

        '自动回复': 'Auto reply',
        '恢复模式': 'Recovery mode',
        '定时唤醒': 'Scheduled wake',
        '唤醒间隔（分）': 'Wake interval (min)',
        '多窗口轮询': 'Multi-window polling',
        '自动处理': 'Auto process',
        '自动合并': 'Auto merge',
        '监控队列': 'Monitor queue',
        '队列消息': 'Queued messages',

        /* ===== 健康守护 ===== */
        '🛡️ 健康守护': '🛡️ Health Guard',
        '启用健康守护': 'Enable Health Guard',
        '检查间隔（分）': 'Check interval (min)',
        '自动重启': 'Auto restart',
        '异常告警': 'Alert on error',
        '内存阈值（MB）': 'Memory threshold (MB)',
        '心跳检测': 'Heartbeat',
        '守护进程': 'Daemon',
        '运行状态': 'Status',
        '上次检查': 'Last check',
        '运行时长': 'Uptime',
        '重启应用': 'Restart app',

        /* ===== 简介帮助关于 ===== */
        '📖 简介': '📖 Intro',
        '❓ 帮助': '❓ Help',
        'ℹ️ 关于': 'ℹ️ About',
        '版本': 'Version',
        '作者': 'Author',
        '检查更新': 'Check for updates',
        '已是最新版本': 'Already up to date',
        '使用说明': 'Instructions',
        '功能介绍': 'Features',
        '快捷键': 'Shortcuts',
        '常见问题': 'FAQ',
        '联系作者': 'Contact author',
        '联系我们': 'Contact Us',

        /* ===== 对话框 ===== */
        '✕': '✕',
        '停止': 'Stop',
        '重新生成': 'Regenerate',
        '继续': 'Continue',
        '刷新回答': 'Refresh answer',
        '置顶': 'Pin',
        '取消置顶': 'Unpin',
        '关闭对话': 'Close chat',
        '最小化': 'Minimize',
        '最大化': 'Maximize',
        '还原': 'Restore',
        '输入消息...': 'Type a message...',
        '输入消息，Enter 发送': 'Type message, Enter to send',
        '发送 (Enter)': 'Send (Enter)',
        '新对话': 'New chat',
        '对话历史': 'Chat history',
        '历史记录': 'History',
        '复制对话': 'Copy chat',
        '导出对话': 'Export chat',
        '清空对话': 'Clear chat',
        '确认清空对话？': 'Clear this chat?',
        'AI 正在输入': 'AI is typing',
        '正在思考': 'Thinking',
        '正在回复': 'Replying',
        '已停止': 'Stopped',
        '已复制': 'Copied',
        '复制成功': 'Copied',
        '复制失败': 'Copy failed',
        '已排队': 'Queued',
        '已发送': 'Sent',
        '发送失败': 'Send failed',
        '重新发送': 'Resend',
        '消息太长': 'Message too long',
        '编辑消息': 'Edit message',
        '保存编辑': 'Save edit',
        '取消编辑': 'Cancel edit',
        '采纳建议': 'Accept',
        '复制代码': 'Copy code',
        '复制消息': 'Copy message',
        '复制成功！': 'Copied!',
        '已复制到剪贴板': 'Copied to clipboard',

        /* ===== 消息状态类 ===== */
        '请求中': 'Requesting',
        '流式输出中': 'Streaming',
        '已完成。': 'Completed.',
        '已取消。': 'Cancelled.',
        '请求失败': 'Request failed',
        '请求超时': 'Request timed out',
        '网络错误': 'Network error',
        '模型未配置': 'Model not configured',
        '请先配置模型': 'Please configure a model first',
        '密钥错误': 'API key error',
        '额度不足': 'Insufficient quota',
        '速率限制': 'Rate limited',
        '服务不可用': 'Service unavailable',

        /* ===== 欢迎消息（动态拼接，走 RULES） ===== */

        /* ===== 日志面板 ===== */
        '📋 运行日志': '📋 Logs',
        '自动滚动': 'Auto scroll',
        '日志级别': 'Log level',
        '清空日志': 'Clear logs',
        '确认清空日志？': 'Clear all logs?',
        '日志已清空': 'Logs cleared',
        '复制日志': 'Copy logs',
        '下载日志': 'Download logs',
        '展开': 'Expand',
        '收起': 'Collapse',

        /* ===== 画布 / 顶栏 ===== */
        '回到中心': 'Back to center',
        '适应窗口': 'Fit to window',
        '排列窗口': 'Arrange windows',
        '新建对话': 'New chat',
        '打开设置': 'Open settings',
        '缩放': 'Zoom',
        '重置缩放': 'Reset zoom',
        '全部收起': 'Collapse all',
        '全部展开': 'Expand all',
        '背景': 'Background',
        '网格': 'Grid',
        '全部关闭': 'Close all',

        /* ===== 监控 ===== */
        '监控': 'Monitor',
        '开始监控': 'Start monitoring',
        '停止监控': 'Stop monitoring',
        '监控中': 'Monitoring',
        '已暂停': 'Paused',
        '待处理': 'Pending',
        '处理中': 'Processing',
        '合并对话': 'Merge chats',
        '自动排列': 'Auto arrange',
        '窗口列表': 'Window list',

        /* ===== 通用动态文案 ===== */
        '条': 'items',
        '条消息': 'messages',
        '个对话': 'chats',
        '个窗口': 'windows',
        '条记录': 'records',

        /* ===== 占位符 placeholder ===== */
        '如：DeepSeek、GPT-4o、Claude': 'e.g. DeepSeek, GPT-4o, Claude',
        '如：https://api.deepseek.com/v1/chat/completions': 'e.g. https://ai.deepseek.com/v1/chat/completions',
        '如：deepseek-chat、gpt-4o': 'e.g. deepseek-chat, gpt-4o',
        '如：smtp.qq.com': 'e.g. smtp.qq.com',
        '465（SSL）或 587（STARTTLS）': '465 (SSL) or 587 (STARTTLS)',
        '如：zf3d@vip.qq.com': 'e.g. zf3d@vip.qq.com',
        'QQ邮箱需用授权码（非登录密码）': 'QQ Mail requires auth code (not password)',
        '如：朱峰智能体': 'e.g. ZhuFeng Agent',
        '输入消息…': 'Type a message…',
        '输入关键词搜索': 'Search by keyword',

    /* ---------- 通用词典补充 ---------- */
        '「': '"',
  '代理请求超时（330 秒未响应），已自动停止以避免卡死。请检查网络/后端服务后重试。': 'Proxy request timed out (no response in 330s), auto-stopped to avoid hang. Check network/backend then retry.',
  '该模型尚未配置 API 密钥，请点击右上角⚙️设置 → 输入密钥 → 保存密钥。': 'API key not configured for this model. Click ⚙️ Settings (top right) → enter key → save.',
  '等待用户输入超时，已自动继续，请稍后重试。': 'Timed out waiting for user input, auto-continued, please retry later.',
  '⚠ 用户取消了询问，对话已停止。': '⚠ User cancelled the question, chat stopped.',
  '」调用失败，自动降级到备用模型「': '" failed, auto-fallback to backup model "',
  '」': '"',
  '⚠️ 原模型配置不存在，已自动切换为「': '⚠️ Original model config not found, auto-switched to "',
        '请查看你的消息，避开死循环，然后继续监护。': 'Please check your messages, avoid dead loops, then continue monitoring.',
  '请查看你的消息，避免死_loop，然后继续监护。': 'Please check your messages, avoid dead loops, then continue monitoring.',
  '请稍等...': 'Please wait...',
  '请稍等': 'Please wait',
  '请稍候...': 'Please wait...',
  '请先登录': 'Please log in first',
  '请先选择一个窗口': 'Please select a window first',
  '请先在上方下拉列表选择一个模型。': 'Please select a model from the dropdown above.',
  '请先选择一个模型': 'Please select a model first',
  '请先选择一个对话': 'Please select a chat first',
  '请先选择': 'Please select first',
  '请输入内容': 'Please enter content',
  '请输入消息...': 'Enter a message...',
  '你好': 'Hello',
  '晚安': 'Good night',
  '晚上好': 'Good evening',
  '下午好': 'Good afternoon',
  '早上好': 'Good morning',
  '欢迎回来': 'Welcome back',
  '面板设置': 'Panel settings',
  '任务面板': 'Task panel',
  '在设置面板配置': 'Configure in settings',
  '在设置中开启': 'Enable in settings',
  '在任务面板查看': 'View in task panel',
  '已关闭健康守护': 'Health guard disabled',
  '已开启健康守护': 'Health guard enabled',
  '已关闭监控': 'Monitoring stopped',
  '已开启监控': 'Monitoring started',
  '已关闭': 'Turned off',
  '已开启': 'Turned on',
  '已断开连接': 'Disconnected',
  '已连接': 'Connected',
  '已断开': 'Disconnected',
  '已恢复': 'Recovered',
  '已升级': 'Upgraded',
  '已删除': 'Deleted',
  '已保存': 'Saved',
  '已加载': 'Loaded',
  '已禁用': 'Disabled',
  '已启用': 'Enabled',
  '正在重试': 'Retrying',
  '打字机效果。': 'Typewriter effect.',
  '打字机效果': 'Typewriter effect',
  '真实流式': 'Real streaming',
  '服务器': 'Server',
  '本地': 'Local',
  '面板': 'Panel',
  '自动清理': 'Auto cleanup',
  '自动清空': 'Auto clear',
  '预测性监控': 'Predictive monitoring',
  '设置失败': 'Failed to set',
  '设置成功': 'Set successfully',
  '菜单': 'Menu',
  '内容': 'Content',
  '级别': 'Level',
  '时间': 'Time',
  '分钟​': 'min',
  '未启用': 'Not enabled',
  '秒。': 'sec.',
  '秒)': 'sec)',
  '秒': 'sec',
  '秒': 'sec',
  '分钟 (': 'min (',
  '分钟': 'min',
  '分钟)': 'min)',
  '分钟': 'min',
  '分钟。': 'min.',
  '后续将每隔': 'Then every',
  '启用并最小化': 'Enable and minimize',
  '启用于': 'Enabled since',
  '离开(自动)': 'Leave (auto)',
  '离开': 'Leave',
  '在线 · 隐身': 'Online · Invisible',
  '在线 · 勿扰': 'Online · DND',
  '在线 · 忙碌': 'Online · Busy',
  '在线 · 空闲': 'Online · Idle',
  's, 检查间隔': 's, check interval',
  '秒（超过阈值': 'sec (over threshold',
  '重启': 'Restart',
  '暂停': 'Pause',
  '开始': 'Start',
  '脚本': 'Script',
  '前端': 'Frontend',
  '后端': 'Backend',
  '循环': 'Loop',
  '周期': 'Cycle',
  '天)': 'days)',
  '年': 'years',
  '月': 'months',
  '周': 'weeks',
  '天': 'days',
  '小时': 'hours',
  '秒': 'sec',
  '分钟': 'min',
  '正在下载...': 'Downloading...',
  '正在下载': 'Downloading',
  '正在上传...': 'Uploading...',
  '正在上传': 'Uploading',
  '未知错误': 'Error: unknown',
  '请稍后重试': 'Please try again later',
  '保存失败': 'Failed to save',
  '保存成功': 'Saved',
  '正在加载': 'Loading',
  '操作失败': 'Failed',
  '操作成功': 'Success',
  '更多操作': 'More actions',
  '简洁': 'Simple',
  '提示': 'Tip',
  '清理': 'Clean',
  '总对话数': 'Total chats',
  '总消息数': 'Total messages',
  '注意': 'Notice',
  '添加好友': 'Add friend',
  '添加': 'Add',
  '搜索...': 'Search...',
  '保存并关闭': 'Save and close',
  '确定': 'OK',
  '粘贴': 'Paste',
  '剪切': 'Cut',
        '请查看你的消息，避免死循环，然后继续监护。': 'Please check your messages, avoid dead loops, then continue monitoring.',
  '在线': 'Online',
  '离线': 'Offline',
  '网络错误：': 'Network error: ',
  '上报地址': 'Report URL',
  '累计签到': 'Total check-ins',
  '连续签到': 'Streak days',
  '积分': 'Points',
  '登录后可用': 'Available after login',
  '注册': 'Register',
  '忘记密码': 'Forgot password',
  '记住我': 'Remember me',
  '密码': 'Password',
  '用户名': 'Username',
  '用户': 'User',
  '正在签到...': 'Checking in...',
  '每日签到': 'Daily check-in',
  '今日已签到': 'Already checked in today',
  '签到中...': 'Checking in...',
  '签到失败': 'Check-in failed',
  '签到成功！': 'Checked in successfully!',
  '签到': 'Check-in',
  '登录失败': 'Login failed',
  '登录中...': 'Logging in...',
  '请输入用户名和密码': 'Please enter username and password',
  '退出登录': 'Log out',
  '登录': 'Login',
  '未登录': 'Not logged in',
  '已登录': 'Logged in',
  '账户信息': 'Account info',
  '账户': 'Account',
  '换一批头像': 'Refresh avatars',
  '换一批': 'Refresh',
  '第一视角': 'First person view',
  '头像': 'Avatar',
  '支持一下': 'Support us',
  '项目地址': 'Project repository',
  'MIT': 'MIT',
  '开源协议': 'Open source license',
  '版本号': 'Version',
    };

    /* ---------- 长提示语整段翻译 ---------- */
    const LONG_TIPS = {
    };

    /* ---------- 动态拼接文案规则（正则捕获组） ---------- */
    const RULES = [
        /* 欢迎消息 */
        [/^你好！这是对话(\d+)，当前模型：(.+?)。请输入消息开始。$/, function (m) {
            return 'Hello! This is chat ' + m[1] + ', current model: ' + m[2] + '. Type a message to start.';
        }],
        /* 排队/计数 */
        [/^消息已排队 \((\d+) 条\)$/, function (m) { return 'Message queued (' + m[1] + ')'; }],
        [/^队列中 (\d+) 条$/, function (m) { return m[1] + ' in queue'; }],
        [/^共 (\d+) 条$/, function (m) { return m[1] + ' total'; }],
        [/^共 (\d+) 条记录$/, function (m) { return m[1] + ' records'; }],
        /* 模型/配置状态 */
        [/^模型: (.+)$/, function (m) { return 'Model: ' + m[1]; }],
        [/^密钥: (.+)$/, function (m) { return 'Key: ' + m[1]; }],
        [/^状态: (.+)$/, function (m) { return 'Status: ' + m[1]; }],
        [/^版本: (.+)$/, function (m) { CN2EN[m[1]] !== undefined ? m[1] = CN2EN[m[1]] : null; return 'Version: ' + m[1]; }],
        /* 时间 */
        [/^(\d+) 分钟前$/, function (m) { return m[1] + ' min ago'; }],
        [/^(\d+) 小时前$/, function (m) { return m[1] + 'h ago'; }],
        [/^(\d+) 天前$/, function (m) { return m[1] + 'd ago'; }],
        [/^刚刚$/, function () { return 'just now'; }],
        [/^(\d+)秒后重试$/, function (m) { return 'retry in ' + m[1] + 's'; }],
        /* 文件/窗口 */
        [/^窗口 (\d+)$/, function (m) { return 'Window ' + m[1]; }],
        [/^对话 (\d+)$/, function (m) { return 'Chat ' + m[1]; }],
        [/^备份 (.+)$/, function (m) { return 'Backup ' + m[1]; }],
        [/^快照 (.+)$/, function (m) { return 'Snapshot ' + m[1]; }],
        /* 错误提示 */
        [/^(.+) 失败，请重试$/, function (m) { return m[1] + ' failed, please retry'; }],
        [/^请输入(.+)$/, function (m) { return 'Please enter ' + m[1]; }],
        [/^正在加载(.+)$/, function (m) { return 'Loading ' + m[1]; }],
    ];

    let lang = (window.UserSettings && UserSettings.get('appLang')) || localStorage.getItem('appLang') || 'zh';
    let observer = null;
    let obsTimer = null;
    const SKIP = /^(SCRIPT|STYLE|CODE|TEXTAREA|INPUT|IFRAME|CANVAS|SVG|PRE)$/;
    /* 消息正文容器：内容是用户/AI 生成，绝不能翻译 */
    const SKIP_SEL = '.md-body, .msg-user-text, .msg-copy-btn, code, pre';

    /* ---------- 词典补齐（顶栏等，不覆盖已有词条） ---------- */
    (function () {
        var extra = {
            '朱峰社区智能体无限': 'ZF3D Community Agent ∞',
            '切换语言': 'Switch language',
            '访问朱峰社区网站': 'Visit zf3d.com',
            '设置 / 模型配置': 'Settings / Model Config',
            '新建对话': 'New chat',
            '新建': 'New'
        };
        for (var k in extra) if (CN2EN[k] === undefined) CN2EN[k] = extra[k];
    })();

    /* data-i18n-attr 专用 key */
    const KEY2EN = {
        language: 'Switch language',
        about: 'About',
        brand: 'ZF3D Community Agent ∞'
    };

    /* 英文整块翻译表（引导面板）：由 data-enid 匹配 en_guides.js 提供的 window.__EN_HTML */
    const EN_HTML = (typeof window !== 'undefined' && window.__EN_HTML) || {};

    function tryRules(s) {
        const v = s.trim();
        for (let i = 0; i < RULES.length; i++) {
            const r = RULES[i];
            if (r[0].test(v)) {
                try { const m = r[0].exec(v); if (m) return r[1](m); } catch (e) { /* ignore */ }
            }
        }
        return null;
    }

    function t(key) {
        if (lang === 'en') {
            const k = String(key).trim();
            if (!k) return key;
            if (LONG_TIPS[k] !== undefined) return LONG_TIPS[k];
            if (CN2EN[k] !== undefined) return CN2EN[k];
            const r = tryRules(k);
            if (r !== null) return r;
        }
        return key;
    }

    function hasCJK(s) { return /[\u4e00-\u9fff]/.test(s); }

    /* ---------- 文本节点 ---------- */
    function translateTextNode(node) {
        const raw = node.nodeValue;
        if (!raw || !raw.trim() || !hasCJK(raw)) return;
        const out = t(raw);
        if (out !== raw.trim()) {
            node.__i18nOrig = raw;
            node.nodeValue = raw.replace(raw.trim(), out);
        }
    }

    /* ---------- 属性（title / placeholder / data-i18n-attr） ---------- */
    function translateAttrs(el) {
        if (!el || el.nodeType !== 1 || !el.setAttribute) return;
        const saves = el.__i18nAttrSaves || (el.__i18nAttrSaves = {});
        function tr(attr) {
            const cur = el.getAttribute(attr);
            if (cur === null) return;
            const src = saves[attr] !== undefined ? saves[attr] : cur;
            if (!hasCJK(src)) return;
            const out = t(src);
            if (out !== src) { saves[attr] = src; el.setAttribute(attr, out); }
        }
        tr('title');
        tr('placeholder');
        const da = el.getAttribute('data-i18n-attr');
        if (da) {
            try {
                const map = JSON.parse(da);
                for (const a in map) {
                    const en = KEY2EN[map[a]];
                    if (en && el.getAttribute(a) !== null) {
                        if (saves['a_' + a] === undefined) saves['a_' + a] = el.getAttribute(a);
                        el.setAttribute(a, en);
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    /* ---------- 扫描 ---------- */
    function scanElement(root) {
        if (lang !== 'en') return;
        if (root.nodeType === 3) { translateTextNode(root); return; }
        if (root.nodeType !== 1) return;
        if (SKIP.test(root.nodeName)) return;
        if (root.closest && root.closest(SKIP_SEL)) return;
        /* --- 整块翻译（data-enid → EN_HTML）--- */
        const _enid = root.getAttribute && root.getAttribute('data-enid');
        if (_enid && EN_HTML[_enid]) {
            if (root.__i18nBlockOrig === undefined) root.__i18nBlockOrig = root.innerHTML;
            root.innerHTML = EN_HTML[_enid];
            return;
        }
        translateAttrs(root);
        root.querySelectorAll('[title],[placeholder],[data-i18n-attr]').forEach(translateAttrs);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = walker.nextNode())) {
            const pn = n.parentNode;
            if (!pn || SKIP.test(pn.nodeName)) continue;
            if (n.parentElement && n.parentElement.closest(SKIP_SEL)) continue;
            translateTextNode(n);
        }
    }

    function scanAll() {
        scanElement(document.body);
        /* 额外扫描带 data-enid 的整块翻译元素（如引导面板），每个作为独立 root 触发整块替换 */
        if (document.querySelectorAll) {
            document.querySelectorAll('[data-enid]').forEach(scanElement);
        }
    }

    /* ---------- 还原中文 ---------- */
    function restoreAll() {
        const els = document.querySelectorAll('*');
        for (let i = 0; i < els.length; i++) {
            const el = els[i], s = el.__i18nAttrSaves;
            if (!s) continue;
            for (const a in s) {
                if (s[a] !== undefined && s[a] !== null) el.setAttribute(a.replace(/^a_/, ''), s[a]);
            }
            el.__i18nAttrSaves = null;
        }
        /* --- 还原整块内容 --- */
        const _be = document.querySelectorAll('[data-enid]');
        for (let i = 0; i < _be.length; i++) {
            const e = _be[i];
            if (e.__i18nBlockOrig !== undefined) { e.innerHTML = e.__i18nBlockOrig; e.__i18nBlockOrig = undefined; }
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = walker.nextNode())) {
            if (n.__i18nOrig) { n.nodeValue = n.__i18nOrig; n.__i18nOrig = null; }
        }
    }

    /* ---------- MutationObserver：英文模式下自动翻译新增节点 ---------- */
    function startObserver() {
        if (observer || typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver(function (muts) {
            if (lang !== 'en') return;
            if (obsTimer) clearTimeout(obsTimer);
            obsTimer = setTimeout(function () {
                obsTimer = null;
                for (let i = 0; i < muts.length; i++) {
                    const m = muts[i];
                    if (m.type !== 'childList') continue;
                    for (let j = 0; j < m.addedNodes.length; j++) {
                        try { scanElement(m.addedNodes[j]); } catch (e) { /* ignore */ }
                    }
                }
            }, 60);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: false });
    }

    function stopObserver() {
        if (observer) { observer.disconnect(); observer = null; }
        if (obsTimer) { clearTimeout(obsTimer); obsTimer = null; }
    }

    /* ---------- 切换按钮 ---------- */
    function updateToggle() {
        const b = document.getElementById('languageToggle');
        if (!b) return;
        b.textContent = lang === 'en' ? '中' : 'EN';
        b.title = lang === 'en' ? 'Switch to Chinese' : '切换语言';
    }

    /* ---------- 对外接口 ---------- */
    function setLang(l) {
        lang = (l === 'en') ? 'en' : 'zh';
        try { localStorage.setItem('appLang', lang); } catch (e) { /* ignore */ }
        try { UserSettings.set('appLang', lang); } catch (e) { /* ignore */ }
        if (lang === 'en') { scanAll(); startObserver(); }
        else { stopObserver(); restoreAll(); }
        updateToggle();
    }

    function getLang() { return lang; }

    window.I18N = { t: t, setLang: setLang, getLang: getLang, scan: scanAll };
    window.setLang = setLang;
    window.getLang = getLang;

    function init() {
        updateToggle();
        if (lang === 'en') { scanAll(); startObserver(); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();