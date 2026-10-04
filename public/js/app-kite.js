
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  window.alert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

﻿/* 风筝龙 v4 —— 会话可视化：只有一个龙头+一条线，拖尾各节 = 一个对话。
   特性：
   - 所有对话提示均为纯背景层（z-index:0 + pointer-events:none），绝不遮挡前景、不拦截点击
   - 悬停/工具调用 → 弹出一句话提示（无左侧 AI 栏、无徽章），全局同时只显示最近一句话（新提示自动顶掉旧提示）
   - 工具调用只显示工具的文字提示（如 🔧 运行命令）
   - 龙头可拖拽到任意角落，位置存入 localStorage，下次恢复 */
(function () {
    var _us = window.UserSettings || { get: function(k, d) { return d; }, set: function() {} };
    var faces = ['🙂', '😎', '🤓', '🐼', '🦊', '🐱'];
    var faceIndex = Number(_us.get('zf3d-kite-face', 3)) % faces.length;
    var LINK = 27;          // 节间距（像素）
    var EASE_BASE = 0.20;
    var EASE_MIN = 0.055;
    var STORE_KEY = 'zf3d-kite-anchor';
    var STORE_NODES = 'zf3d-kite-node-positions';
    var _nodePosMap = (function () { // 已保存的节点固定位置 {chatId:{x,y}}
        try { var v = _us.get(STORE_NODES); return v ? JSON.parse(v) : {}; } catch (e) { return {}; }
    })();
    function saveNodePositions() {
        try {
            var m = {};
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (n.fixed) m[n.chatId] = { x: Math.round(n.x), y: Math.round(n.y) };
            }
            _us.set(STORE_NODES, JSON.stringify(m));
        } catch (e) {}
    }
    var STORE_NODES = 'zf3d-kite-node-positions';
    var _nodePosMap = (function () { // 已保存的节点固定位置 {chatId:{x,y}}
        try { var v = _us.get(STORE_NODES); return v ? JSON.parse(v) : {}; } catch (e) { return {}; }
    })();
    function saveNodePositions() {
        try {
            var m = {};
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (n.fixed) m[n.chatId] = { x: Math.round(n.x), y: Math.round(n.y) };
            }
            _us.set(STORE_NODES, JSON.stringify(m));
        } catch (e) {}
    }
    var STALL_MS = 3 * 60 * 1000;   // 慢速检测阈值：运行中的对话超过 3 分钟无模型响应 → 红色警报闪烁
    var root, headEl, _headHover = false;   // hover 状态事件驱动缓存，tick 内不再逐帧 matches(':hover')（强制样式计算）
    var nodes = [];         // { chatId, chat, el, cardEl, x, y, _hover, autoShowUntil, hint }
    var byId = {};
    var head = { x: 0, y: 0, tx: 0, ty: 0 };   /* 首帧坐标由 _syncHeadToAnchor() 同步 */
    var anchor = { x: 0, y: 0 };   /* 0 表示未初始化；loadAnchor 失败时由 applyDefaultAnchor()
    按当前视口算出右下区域的兜底位，绝不再写死左上角 */
    /* 把 head/链条首节对齐到当前 anchor（loadAnchor 或 applyDefaultAnchor 之后调用） */
    function _syncHeadToAnchor() {
        head.x = head.tx = anchor.x;
        head.y = head.ty = anchor.y;
        if (nodes && nodes.length && nodes[0]) {
            nodes[0].x = anchor.x; nodes[0].y = anchor.y;
        }
    }
    var t = 0, lastTs = 0, dragging = false, dragMoved = 0;
    /* ===== 显示与物理解耦（2026-09-20）=====
       物理（巡航/风力摆动/链条约束/自摇）默认完全关闭，
       只有"手拖拽"龙头或身体节点期间才被 arm 激活；
       任何只改 DOM 显隐的路径（风筝开关、未来的"显示身体"工具）
       都不会顺带启动物理。未激活时走 _tickIdle 静态帧：风筝静止挂在原处，
       但仍保留会话同步/面板刷新，保证新对话节点能正常出现。 */
    var _physicsArmed = false;
    var _bodyVisible = true;
    var _idleSyncAt = 0;
    function armPhysics() { _physicsArmed = true; }
    function disarmPhysics() { _physicsArmed = false; }
    // 只切换身体（链条节点）显隐，绝不触碰物理闸——与"启动物理"彻底解耦
    function setBodyVisible(on) {
        _bodyVisible = !!on;
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].el) nodes[i].el.style.display = _bodyVisible ? '' : 'none';
        }
    }
    var _syncTickAcc = 0;
    var _overviewEl = null;
    /* 视口尺寸缓存（0=未初始化）：tick 内每帧读 innerWidth/innerHeight 会强制同步排版，resize 时才重读 */
    /* 初值直接取一次 innerWidth/Height（仅加载时读一次），避免物理激活后首帧 _vpH=0 导致 B1 误剔除 */
    var _vpW = window.innerWidth, _vpH = window.innerHeight;
    window.addEventListener('resize', function () {
        _vpW = 0; _vpH = 0;
        var ov = _overviewEl || (root && root.querySelector('.kite-head-overview'));
        if (ov) { ov._vpDirty = true; ov._szDirty = true; }
    });

    /* ---------- 静止态 CSS 动画接管（2026-09-20 方案A） ----------
       用户不拖拽/无悬停/无气泡时，龙头巡逻与链条 sway 全是固定参数周期运动，
       交给 CSS keyframes（translate/rotate 属性与内联 transform 叠加），
       JS 每帧零物理计算。任何交互（拖拽/悬停/气泡/对话增删）立即唤醒恢复 JS 驱动 */
    var _idleOn = false, _idleAcc = 0, _idleBlend = false;
    var IDLE_ENTER_S = 4;                       /* 静止持续 4 秒后完全交给 CSS 动画 */
    var FADE_S = 1;                             /* 【过渡增强】切入前 1 秒交叉淡化：CSS 幅度 ×k 渐显，JS 摆幅 ×(1-k) 渐隐 */
    var SWAY_PERIOD = 2 * Math.PI / 2.4;        /* 2.618s：与 JS sway 频率 t*2.4 一致 */
    var _idleBlendT0 = 0, _idleBlendK = 0;      /* 【状态卫生】声明前置，避免依赖 var 提升 */
    function kiteWake(reason) {
        if (!_idleOn && !_idleBlend) return;
        _idleOn = false; _idleBlend = false; _idleAcc = 0; _idleBlendK = 0;
        if (root) { root.classList.remove('kite-idle'); root.style.setProperty('--idle-k', '0'); }
        nodes.forEach(function (n) {
            if (n.el) n.el.style.animationDelay = '';
            if (n.cardEl) n.cardEl.style.animationDelay = '';
        });
        if (headEl) headEl.style.animationDelay = '';
    }
    /* 【过渡增强】切入前 1 秒先进入混合态：CSS 动画提前启动并渐显（--idle-k: 0→1），
       JS 摆幅同步 ×(1-k) 渐隐；相位按当前 t 锚定（内联 delay 补偿），松手残余甩尾也在 1s 内自然衰减，
       两边能量曲线连续相交，肉眼无跳变。1 秒后 kiteIdleEnter 完全接管、JS 每帧 return */
    function kiteBlendStart() {
        if (_idleBlend || _idleOn) return;
        _idleBlend = true;
        _ensureHeadIdleKf();
        if (root) { root.classList.add('kite-idle'); root.style.setProperty('--idle-k', '0'); }
        /* 相位锚定：delay = (t*2.4 + (-0.3125*i)) mod 周期 的负值，
           保证 CSS 播到 0% 时正好等于 JS 此刻的 sin(t*2.4 - i*0.75) 相位 */
        nodes.forEach(function (n, i) {
            if (!n.el) return;
            var ph = (((t * 2.4 - 0.3125 * i) % SWAY_PERIOD) + SWAY_PERIOD) % SWAY_PERIOD;
            var d = (-ph).toFixed(4) + 's';
            /* 气泡用同一 keyframes 做反向补偿，必须拿到与球体完全相同的 delay 才同相位，
               否则气泡会在球的上方上下错位漂移（曾漏写 cardEl 导致此问题） */
            n.el.style.animationDelay = d;
            if (n.cardEl) n.cardEl.style.animationDelay = d;
        });
        var hph = (((t * 0.55) % 60) + 60) % 60; /* 龙头巡逻 keyframes 主频率 0.55rad/s，按 t 锚定起点 */
        if (headEl) headEl.style.animationDelay = (-hph).toFixed(4) + 's';
        _idleBlendT0 = t;
    }
    function kiteIdleEnter() {
        _idleBlend = false; _idleOn = true;
        if (root) root.style.setProperty('--idle-k', '1');
    }
    /* 动态生成龙头巡逻 keyframes：与 JS 巡航公式完全同源（sin 叠加），
       60s 一循环，首尾用线性渐变校正强制闭环（60s 跳变一次、幅度<1px，不可感知） */
    function _ensureHeadIdleKf() {
        var amp = HAS_STORED ? 7 : 45;
        var T = 60, N = 120, xs = [], ys = [], rs = [];
        for (var j = 0; j <= N; j++) {
            var tt = T * j / N;
            xs.push(Math.sin(tt * 0.55) * amp + Math.sin(tt * 0.21) * amp * 0.6);
            ys.push(Math.cos(tt * 0.47) * (amp * 0.5) + Math.sin(tt * 0.29) * (amp * 0.36));
            rs.push(Math.sin(tt * 1.1) * 6 - 4);
        }
        function close(a) { for (var j = 0; j < N; j++) a[j] -= a[N] * j / N; a[N] = 0; return a; }
        close(xs); close(ys); close(rs);
        var kf = '@keyframes kiteHeadIdle{';
        for (var j = 0; j <= N; j++) {
            kf += (j / N * 100).toFixed(2) + '%{translate:' + xs[j].toFixed(1) + 'px ' + ys[j].toFixed(1) + 'px;rotate:' + rs[j].toFixed(1) + 'deg;}';
        }
        kf += '}';
        var st = document.getElementById('kiteIdleKf') || document.head.appendChild(document.createElement('style'));
        st.id = 'kiteIdleKf'; st.textContent = kf;
    }
    function _setOverviewHidden(hide){ var r=document.querySelector('.kite-dragon'); if(!r) return; var ov=r.querySelector('.kite-head-overview'); if(ov) ov.style.visibility = hide ? 'hidden' : ''; }
    var lastSig = '';
    var popTimer = null;   // 当前气泡的自动隐藏定时器（全局只显示最近一句话）
    var overviewClosed = false;
    var RATE_WINDOW = 60 * 1000;  // 每分钟统计窗口
    var HAS_STORED = loadAnchor();  // 是否已有用户保存的位置
    if (!HAS_STORED) applyDefaultAnchor();
    _syncHeadToAnchor();

    /* 工具名 → 文字提示 */
    var toolHints = {
        read_file: '读取文件', read_lines: '按行读取', write_file: '写入文件', run_code: '运行命令',
        net: '抓取网页', ask_user: '询问用户', git_save: '保存 Git', git_log: '查看提交历史',
        diff_preview: '查看差异', search_in_files: '搜索文件', regex_search: '正则搜索',
        replace_text: '查找替换', find_files: '查找文件', tree_dir: '查看目录', list_dir: '列出目录',
        file_info: '文件信息', code_outline: '分析代码', move_file: '移动文件',
        image_gen: '生成图片', send_email: '发送邮件', wait: '等待',
        task_list: '任务清单', task_complete: '任务完成', work_order: '工单管理',
        analyze_project: '项目分析', read_shared_context: '读共享上下文',
        long_plan: '超长计划', plan_batch: '分批执行',
        project_record: '项目记录', long_term_memory: '长期记忆', ram_cache: '内存缓存',
        chat_manage: '对话管理', chat_context: '对话上下文', monitor: '监控队列',
        schedule: '定时任务', set_camera: '定位画布', locate_mouse: '定位鼠标',
        switch_tool_category: '切换工具',
        get_tool_result: '找回工具结果', recent_questions: '查询历史提问',
        query_answers: '查询历史答案', search_chat: '搜索对话', chat_summary: '对话摘要'
    };

    function modelLetter(chat) {
        var name = '';
        try { if (window.Models && Models.get) { var m = Models.get(chat && chat.modelId); if (m && m.name) name = String(m.name); } } catch (e) {}
        if (!name) name = (chat && (chat.modelName || chat.modelId || chat.title)) || 'AI';
        return String(name).trim().charAt(0).toUpperCase() || 'A';
    }
    /* 供应商中文名：后端给的是域名（如 open.bigmodel.cn / ark.cn-beijing.volces.com），统一转成可读名称 */
    function providerName(p) {
        var s = String(p || '').toLowerCase();
        if (!s) return '';
        if (s.indexOf('ark') >= 0 || s.indexOf('volces') >= 0 || s.indexOf('volcano') >= 0 || s.indexOf('豆包') >= 0 || s.indexOf('doubao') >= 0) return '火山方舟';
        if (s.indexOf('bigmodel') >= 0 || s.indexOf('zhipu') >= 0 || s.indexOf('chatglm') >= 0) return '智谱';
        if (s.indexOf('siliconflow') >= 0 || s.indexOf('silicon') >= 0) return '硅基流动';
        if (s.indexOf('pollin') >= 0) return 'Pollinations';
        if (s.indexOf('deepseek') >= 0) return 'DeepSeek';
        if (s.indexOf('moonshot') >= 0) return '月之暗面';
        if (s.indexOf('dashscope') >= 0 || s.indexOf('qwen') >= 0 || s.indexOf('aliyun') >= 0) return '通义千问';
        if (s.indexOf('anthropic') >= 0) return 'Claude';
        if (s.indexOf('gemini') >= 0 || s.indexOf('generativelanguage') >= 0) return 'Gemini';
        if (s.indexOf('openai') >= 0) return 'OpenAI';
        return s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
    /* 车道归属商配色（与赛道左侧色条一致） */
    function laneOwnerColor(p) {
        var s = String(p || '');
        if (s.indexOf('ark') >= 0) return '#ff7d66';                        // 火山方舟
        if (s.indexOf('bigmodel') >= 0 || s.indexOf('zhipu') >= 0) return '#4da3ff'; // 智谱
        if (s.indexOf('silicon') >= 0) return '#c79bf5';                    // 硅基流动
        if (s.indexOf('pollin') >= 0) return '#3ecf8e';                     // Pollinations
        return '#9fb3c8';
    }
    function clean(s, len) {
        s = String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        return (len && s.length > len) ? s.slice(0, len) + '…' : s;
    }
    /* 取一句话：截到第一个句末标点，过长则截断 */
    function firstSentence(s) {
        s = clean(s, 0);
        if (!s) return '';
        var cut = s.search(/[。！？!?]/);
        if (cut > -1 && cut < 60) s = s.slice(0, cut + 1);
        else if (s.length > 44) s = s.slice(0, 44) + '…';
        return s;
    }

    /* ---------- 位置保存/恢复 ---------- */
    /* 把锚点钳制在视口可见范围内，防止风筝跑到屏幕外（如左上角/负坐标） */
    function clampAnchor() {
        var w = window.innerWidth || 1280, h = window.innerHeight || 800;
        var m = 40; // 边距
        if (!isFinite(anchor.x)) anchor.x = w * 0.5;
        if (!isFinite(anchor.y)) anchor.y = h * 0.5;
        anchor.x = Math.min(Math.max(anchor.x, m), w - m);
        anchor.y = Math.min(Math.max(anchor.y, m), h - m);
    }
    function saveAnchor() {
        clampAnchor();
        try { _us.set(STORE_KEY, Math.round(anchor.x) + ',' + Math.round(anchor.y)); } catch (e) {}
    }
    function loadAnchor() {
        try {
            var v = _us.get(STORE_KEY);
            if (v) {
                var a = String(v).split(',');
                if (!isNaN(+a[0]) && !isNaN(+a[1])) {
                    var _ax = +a[0], _ay = +a[1];
                    var _w = window.innerWidth || 1280, _h = window.innerHeight || 800;
                    /* 死区保护（与拖拽保存的 clampAnchor 阈值一致）：
                       非法值（0,0 / NaN / 负数）判定无效并清除；
                       贴边但合法的位置不再"拒绝+清空"，而是夹回可见范围——
                       否则用户拖到 40~119px 内保存的位置每次启动都会被误清，表现为"记不住位置" */
                    if (!isFinite(_ax) || !isFinite(_ay) || _ax <= 0 || _ay <= 0) {
                        try { _us.set(STORE_KEY, ''); } catch (e2) {}
                        return false;
                    }
                    if (_ax < 120) _ax = 120;
                    if (_ay < 120) _ay = 120;
                    if (_ax > _w - 40) _ax = _w - 40;
                    if (_ay > _h - 40) _ay = _h - 40;
                    anchor.x = _ax; anchor.y = _ay; clampAnchor(); return true;
                }
            }
        } catch (e) {}
        return false;
    }
    /* 无有效存档时的兜底位置：视口右下区域，绝不放回左上角 */
    function applyDefaultAnchor() {
        var w = window.innerWidth || 1280, h = window.innerHeight || 800;
        anchor.x = Math.max(240, w * 0.62);
        anchor.y = Math.max(240, Math.min(h - 180, h * 0.55));
        clampAnchor();
    }
    /* 窗口尺寸变化时把风筝拉回可见范围 */
    window.addEventListener('resize', function () {
        if (HAS_STORED) { clampAnchor(); saveAnchor(); }
    });
    /* 等服务器设置加载完成后，再恢复一次锚点（服务器值优先于 localStorage 缓存） */
    function reloadAnchorWhenReady() {
        window.addEventListener('user-settings-refreshed', function () {
            /* 关键：服务器设置到达后若无有效锚点存档，必须显式回填兜底位，
               否则 anchor 停留在初始值（旧代码是左上角 91,67），
               tick 里 head.tx = anchor.x 会把已定位好的龙头硬拽回左上角。 */
            if (loadAnchor()) {
                HAS_STORED = true;
            } else {
                HAS_STORED = false;
                applyDefaultAnchor();
            }
            _syncHeadToAnchor();
            /* 幅度可能从 45 变 7（或反之），idle keyframes 里烧死了旧幅度，必须重算 */
            if (_idleOn) _ensureHeadIdleKf();
        });
    }

    /* ---------- 一句话提示气泡（纯背景层，仅一行文字，无 AI 栏） ---------- */
    function buildCard(chat) {
        var card = document.createElement('div');
        card.className = 'kite-card';
        card.innerHTML = '<div class="kc-rate"></div><div class="kc-txt"></div><i class="kc-tail"></i>';
        return card;
    }
    function renderCard(node, text) {
        var card = node.cardEl;
        if (!card) return;
        var box = card.querySelector('.kc-txt');
        var rateBox = card.querySelector('.kc-rate');
        if (!box || !rateBox) return;
        if (text) { box.textContent = text; return; }          // 指定文字（如工具提示）
        var h = (node.chat && node.chat.history) || [];        // 否则取最新一条的一句话
        var s = '';
        for (var i = h.length - 1; i >= 0; i--) {
            var m = h[i];
            if (m && m.content) { s = firstSentence(m.content); if (s) break; }
        }
        recordNewMessages(node);
        box.textContent = s || '…';
        // 速率行 + 🚦交通状态行合并（有闸门票据时可见红绿灯详情）
        var rate = formatMessageRate(node).replace(/^\s+/, '');
        var gd = gateDesc(node.chatId);
        var gt = gateMap[node.chatId];
        if (gt && gt.lane) gd = (gd ? gd + ' ' : '') + '→L' + gt.lane;
        rateBox.textContent = (rate && gd) ? (rate + ' · ' + gd) : (rate || gd || '');
    }
    function recordNewMessages(node) {
        // 测速数据由循环核心在真实往返点现场记录（chat._lastGapMs/_lastApiAt/_gapLog），
        // 风筝只读取、不推断、不清空：轮间隔 = 上一次模型响应（或本轮起点）→ 本次响应的真实时间。
        var chat = node.chat || {};
        var at = Number(chat._lastApiAt) || 0;
        var from = Number(chat._prevApiAt) || 0;
        var latest = Math.max(at, from);   // 上一轮最后响应 与 本轮起点 取较新者：新轮次刚发出即算活动，防止用上一轮旧时间戳误报红色警报
        if (!latest) return;   // 从未与模型往返过（连本轮都未开始）：保持「暂无数据」
        node._lastActive = latest;   // 慢速检测基准：最近一次真实活动时间
        if (node._stall) { node._stall = false; node.el.classList.remove('stall'); } // 恢复活动即解除警报
        if (_headHover) updateHeadOverview();
    }

    // 真实可追溯：不再因超时清空计时数据。间隔大小本身就能看出是否停滞/超时，由使用者自行判断。
    // 只有从未发生过模型往返（_lastApiAt 为空）的对话才显示「暂无数据」。
    function isStale(node) { return false; }

    function formatMessageRate(node) {
        var g = (node.chat && node.chat._gapLog) || [];
        if (!g.length) return '';
        var sum = 0; for (var i = 0; i < g.length; i++) sum += g[i].gap;
        return ' (' + (sum / g.length / 1000).toFixed(1) + '秒/次)';
    }

    function formatLastSpeed(node) {
        var chat = node.chat || {};
        var gap = Number(chat._lastGapMs) || 0;
        if (gap <= 0) {
            var g = chat._gapLog || [];
            if (g.length) gap = Number(g[g.length - 1].gap) || 0;   // 本轮尚无新间隔：回退到历史最后一次真实间隔（刷新恢复后也有效）
        }
        if (gap <= 0) return '暂无数据';   // 从未有模型往返
        return '最后速度：' + (gap / 1000).toFixed(1) + ' 秒/次';
    }

    function formatHeadRate(node) {
        var chat = node.chat || {};
        /* 停止的对话不显示旧速度：只有正在运行（排队/执行/思考中）才显示真实往返速度，否则显示「暂无数据」 */
        var running = !!chat.isSending || !!chat._thinking;   // 真实运行标志：isSending（队列/循环中）或思考中
        if (!running) return '—';   // 非运行中：不显示旧速度也不显示长文案，避免撑爆速度列
        var g = chat._gapLog || [];
        if (g.length) {
            var sum = 0; for (var i = 0; i < g.length; i++) sum += g[i].gap;
            return (sum / g.length / 1000).toFixed(1) + '秒/次';
        }
        var gap = Number(chat._lastGapMs) || 0;
        if (gap > 0) return (gap / 1000).toFixed(1) + '秒/次';
        return '暂无数据';   // 只有从未使用过工具（无模型往返）才是暂无数据
    }

    /* 【对话速度排序】取每对话速率数值（秒/次，越小越快）：运行中取 _gapLog 均值，回退 _lastGapMs，无数据为 Infinity（排序沉底） */
    function headRateNum(node) {
        var chat = node.chat || {};
        var g = chat._gapLog || [];
        if (g.length) {
            var sum = 0; for (var i = 0; i < g.length; i++) sum += (Number(g[i].gap) || 0);
            return sum / g.length / 1000;
        }
        var gap = Number(chat._lastGapMs) || 0;
        return gap > 0 ? gap / 1000 : Infinity;
    }

    /* 状态诊断：只在异常时返回状态文字（正常返回空）。
       优先级：已失败 > 长期停滞(运行中但超过STALL_MS无响应) > 已结束(成功)不显示 */
    function headStatus(node) {
        var s = (node.chat && node.chat._taskStatus) || '';
        var running = !!(node.chat && node.chat.isSending) || !!(node.chat && node.chat._thinking);
        if (node._stall && running) return '长期停滞';
        if (s === 'fail') return '已失败';
        if (running && node._lastActive && Date.now() - node._lastActive > STALL_MS) return '响应缓慢';
        return '';
    }

    /* 全局整体速度：汇总所有对话最近60秒内的真实响应时间点（chat._gapLog）→ 平均每次的秒数。
       数据来自循环核心现场记录，不过期清空、不推断；不足两个点显示 -- */
    function formatGlobalStats() {
        var now = Date.now();
        var pts = [];
        nodes.forEach(function (n) {
            var g = (n.chat && n.chat._gapLog) || [];
            for (var i = 0; i < g.length; i++) if (now - g[i].t <= RATE_WINDOW) pts.push(g[i].t);
        });
        pts.sort(function (a, b) { return a - b; });   // 多对话时间点交错混入，必须排序，否则出现负"秒/次"
        if (pts.length < 2) return null;
        var seconds = (pts[pts.length - 1] - pts[0]) / 1000 / (pts.length - 1);
        return { seconds: seconds };
    }

    /* ---------- FPS & 内存监控 ---------- */
    var _fpsFrames = 0, _fpsT0 = 0;   // tick 内累计帧数，用于计算实时 FPS（【已上移 tick 外层】无条件计数）
    /* 【B2 帧预算熔断 2026-09-28】>33ms 连续 3 帧 → 隔帧 DOM 更新降级；dragging 豁免；连续达标 500ms（按时间窗计）解除（滞后防抖，低帧率下不再迟滞） */
    var _overN = 0, _calmMs = 0, _skipDom = false;
    var _perfPanelT0 = 0;             // 模块延迟面板独立刷新计时器（与 FPS 统计解耦）
    /* 【长任务统计】PerformanceObserver 监听 >50ms 阻塞主线程的任务，用于卡顿归因：
       count=次数 totalMs=累计阻塞耗时 worst=单次最长。面板「性能」列 LT 行显示 */
    window._kiteLongTasks = { count: 0, totalMs: 0, worst: 0 };
    try {
        if (window.PerformanceObserver) {
            var _ltObs = new PerformanceObserver(function (list) {
                var es = list.getEntries();
                for (var i = 0; i < es.length; i++) {
                    window._kiteLongTasks.count++;
                    window._kiteLongTasks.totalMs += es[i].duration;
                    if (es[i].duration > window._kiteLongTasks.worst) window._kiteLongTasks.worst = es[i].duration;
                }
            });
            _ltObs.observe({ entryTypes: ['longtask'] });
        }
    } catch (e) { /* 老浏览器不支持则统计为 0 */ }
    /* 每对话内存估算：DOM 节点数 + 历史消息字符量（浏览器无 per-chat 真实内存，只能估算） */
    function chatMemEstimate(node) {
        try {
            var chars = 0, h = (node.chat && node.chat.history) || [];
            for (var i = 0; i < h.length; i++) {
                var c = h[i] && h[i].content; if (c) chars += String(c).length;
            }
            var doms = node.el ? node.el.querySelectorAll('*').length : 0;
            /* 每字符约 2 字节(UTF-16)，每 DOM 节点约 80 字节经验值 */
            var bytes = chars * 2 + doms * 80;
            if (bytes < 1024) return bytes + 'B';
            if (bytes < 1048576) return (bytes / 1024).toFixed(0) + 'KB';
            return (bytes / 1048576).toFixed(1) + 'MB';
        } catch (e) { return '--'; }
    }
    /* 界面总内存：优先 Chrome performance.memory 真实 JS 堆，否则估算全部对话 */
    function totalMemText() {
        try {
            var pm = performance.memory;
            if (pm && pm.usedJSHeapSize) {
                var mb = pm.usedJSHeapSize / 1048576;
                return mb.toFixed(1) + 'MB' + (pm.jsHeapSizeLimit ? '/' + Math.round(pm.jsHeapSizeLimit / 1048576) + 'MB' : '');
            }
        } catch (e) {}
        var total = 0;
        nodes.forEach(function (n) { total += (n.chat && n.chat.history || []).reduce(function (s, m) { return s + (m && m.content ? String(m.content).length * 2 : 0); }, 0); });
        return '≈' + (total / 1024).toFixed(0) + 'KB';
    }

    var _overviewBuilding = false;
    var _sortBySpeed = false;   /* 【对话速度排序】false=按创建序（默认）；true=按速度升序（最快置顶）。模块级变量：面板 500ms 重建不丢状态 */
    function updateHeadOverview() {
        /* 防重入：构建过程中 recordNewMessages 可能再次触发重建（悬停时），
           把正在构建的行冲乱——表现为第1个风筝掉到面板底部。重建期间直接忽略。 */
        if (_overviewBuilding) return;
        if (!headEl || overviewClosed) return;
        // 性能修复：总览面板整块 innerHTML 重建极贵（曾致单帧 97ms），限频 500ms
        var _now = Date.now();
        if (_now - (updateHeadOverview._lastBuild || 0) < 500) return;
        updateHeadOverview._lastBuild = _now;
        _overviewBuilding = true;
        try { _updateHeadOverviewInner(); } finally { _overviewBuilding = false; }
    }
    function _updateHeadOverviewInner() {
        var panel = root && root.querySelector('.kite-head-overview');
        if (!panel) return;
        var stats = formatGlobalStats();
        /* 油量表 & 里程表：油量=最近60秒平均响应速度映射（越快越满）；里程=今日累计工具次数（1次=1km） */
        var odoVal = (typeof window._kiteOdometer === 'number' ? window._kiteOdometer : 0);
        var odoTxt = odoVal >= 10000 ? Math.round(odoVal / 1000) + 'k' : String(Math.round(odoVal));
        /* v5 概览分区：上=整体区（整体速度+全局闸门红绿灯统计），左=对话明细（红绿灯+供应商中文名+秒数），右=赛道（车道=赛道，车=并发中的请求） */
        var gateHtml = '';
        if (gateGlobal) gateHtml = '<div class="kho-gate">'
            + '<span>🚦 L' + gateGlobal.lanes
                + (gateGlobal.max_lanes && gateGlobal.lanes < gateGlobal.max_lanes ? '/' + gateGlobal.max_lanes : '')
                + '</span>'
            + '<span style="color:#3ecf8e">🟢' + gateGlobal.running + '</span>'
            + '<span style="color:#e8b34b">🟠' + gateGlobal.queue_len + '</span>'
            + '<span style="color:#c79bf5">🟣' + gateGlobal.holding + '</span></div>';
        var spdCls = '';
        if (stats) spdCls = stats.seconds <= 8 ? ' kho-fast' : (stats.seconds >= 20 ? ' kho-slow' : '');
        var topHtml = '<div class="kho-top">'
            + '<span title="整体速度：最近60秒平均响应速度，绿=快 红=慢">整体 <b class="' + spdCls.trim() + '">' + (stats ? stats.seconds.toFixed(1) + '秒/次' : '--') + '</b></span>'
            + '<span class="kho-odo" title="今日总部署：今天所有对话累计执行的工具次数"><b>' + odoTxt + '</b></span>'
            + '<span class="kho-cpu" title="服务器 CPU 使用率（红绿灯轮询每2秒更新）"><b>' + (typeof window._kiteCpu === 'number' ? 'CPU ' + window._kiteCpu + '%' : 'CPU --') + '</b></span>'
            + '</div>';
        var laneHtml = '';
        if (gateGlobal) {
            var laneOwner3 = {};
            (gateGlobal.groups || []).forEach(function (g) {
                (g.lanes || []).forEach(function (l) { laneOwner3[l] = String(g.provider || '?'); });
            });
            var lh3 = (gateGlobal.lanes_health || []).slice();
            if (lh3.length) {
                /* v12 赛道：横向夜赛赛道（俯视），车向右开，虚线滚动速度=车道速率 */
                laneHtml = '<div class="kho-lanes__title">🏁 ' + lh3.length + ' 条赛道</div>'
                    + '<div class="kho-circuit">'
                    + lh3.map(function (l) {
                        var running = Math.max(0, (l.running || (l.active - l.queue) || (l.status === 'run' ? 1 : 0)) | 0);
                        var oc = laneOwnerColor(laneOwner3[l.lane]);
                        var speed = l.rate || l.speed || (l.status === 'run' ? 1 : 0);
                        /* 速度 → 动画时长：快车 0.22s，慢车 1.1s，停止 0（暂停） */
                        var dur = l.status === 'run' ? Math.max(0.22, 1.2 - Math.min(speed, 6) * 0.16).toFixed(2) + 's' : '0s';
                        var carsHtml = '';
                        /* 虚线滚动时长随速度：快车 0.3s/圈，慢车 1.1s/圈 */
                        var roadDur = l.status === 'run' ? Math.max(0.3, 1.4 - Math.min(speed, 6) * 0.18).toFixed(2) + 's' : '0s';
                        carsHtml += '<i class="kho-track__road-dash" style="animation-duration:' + roadDur + '"></i>';
                        /* 终点旗：车从起点开向终点 */
                        carsHtml += '<i class="kho-track__flag">🏁</i>';
                        /* 运行中的车：从起点跑到终点，速度越快圈速越短；多车错峰出发 */
                        /* 进度车：按每个对话的工具数推进（tc/waterEst≈30 → 冲线🏁），任务成功后清零回起点 */
                        var _laneChats = [];
                        nodes.forEach(function (n) {
                            var gi = gateMap[n.chatId];
                            if (gi && gi.lane === l.lane && n.chat && (n.chat.isSending || n.chat._thinking)) {
                                _laneChats.push({ tc: n.chat._toolUseCount || 0, est: n.chat._waterEst || 30 });
                            }
                        });
                        if (_laneChats.length) {
                            _laneChats.forEach(function (c) {
                                var prog = Math.min(1, c.tc / Math.max(1, c.est));
                                carsHtml += '<i class="kho-car kho-car--prog" style="--car:' + oc
                                    + ';left:calc(' + (prog * 100).toFixed(1) + '% - ' + (prog * 18).toFixed(0) + 'px)"'
                                    + ' title="工具进度 ' + c.tc + '/' + c.est + '"></i>';
                            });
                        } else if (l.status === 'run') {
                            /* 找不到对应对话时退回原圈速车（按速度绕圈） */
                            var lap = Math.max(1.6, 7 - Math.min(speed, 6) * 0.9).toFixed(2);
                            var nRun = Math.min(running, 4);
                            for (var ci = 0; ci < nRun; ci++) {
                                carsHtml += '<i class="kho-car kho-car--lap" style="--car:' + oc + ';animation-duration:' + lap + 's;animation-delay:-' + (ci * lap / Math.max(nRun, 1)).toFixed(2) + 's"></i>';
                            }
                        }
                        /* 排队的车：半透明停在起点等放行，+1 亮 1 辆、+2 亮 2 辆 */
                        var nQ = Math.min(l.queue || 0, 3);
                        for (var qi = 0; qi < nQ; qi++) {
                            carsHtml += '<i class="kho-car kho-car--queued" style="--car:' + oc + ';left:' + (3 + qi * 9) + '%"></i>';
                        }
                        var t = 'L' + l.lane + ' · ' + (providerName(laneOwner3[l.lane]) || '共用')
                            + (l.status === 'tight' ? ' · 减速×' + l.gap_mult : '')
                            + (l.longest_wait > 5 ? ' · 最长等' + Math.round(l.longest_wait) + 's' : '');
                        var cls = 'kho-track';
                        if (l.status === 'run') cls += ' kho-track--run';
                        else if (l.status === 'q') cls += ' kho-track--q';
                        else if (l.status === 'tight') cls += ' kho-track--tight';
                        else cls += ' kho-track--idle';
                        var lt = l.status === 'run' ? 'green' : (l.status === 'q' ? 'yellow' : (l.status === 'tight' ? 'red' : 'gray'));
                        return '<div class="' + cls + '" style="--car:' + oc + '" title="' + t + '">'
                            + '<span class="kho-track__no">' + l.lane + '</span>'
                            + '<span class="kho-track__road">'
                            + '<i class="kho-track__curb kho-track__curb--t"></i>'
                            + '<i class="kho-track__curb kho-track__curb--b"></i>'
                            + (carsHtml || '<b class="kho-car--empty">空道</b>')
                            + (l.queue && carsHtml ? '<em class="kho-track__queue">+' + l.queue + '</em>' : '')
                            + '</span>'
                            + '<b class="kho-track__spd">' + (speed ? speed.toFixed ? speed.toFixed(1) : speed : '—') + '</b>'
                            + '<i class="kho-track__light kho-light--' + lt + '" title="红绿灯：绿=运行 黄=排队 红=减速/关闭 灰=空闲"></i>'
                            + '</div>';
                    }).join('')
                    + '</div>';
            }
        }
        /* v14 面板重构：头部凸显整体 + 左（各对话速度）右（连接池赛道）分区 */
        var gateChips = '';
        if (gateGlobal) gateChips = '<span class="kho2-chip" title="闸门：车道数">🚦 L' + gateGlobal.lanes
                + (gateGlobal.max_lanes && gateGlobal.lanes < gateGlobal.max_lanes ? '/' + gateGlobal.max_lanes : '') + '</span>'
            + '<span class="kho2-chip kho2-chip--g" title="运行中">🟢 ' + gateGlobal.running + '</span>'
            + '<span class="kho2-chip kho2-chip--y" title="排队中">🟠 ' + gateGlobal.queue_len + '</span>'
            + '<span class="kho2-chip kho2-chip--p" title="休整中">🟣 ' + gateGlobal.holding + '</span>';
        /* v14.1 一键复制：把面板文字内容复制到剪贴板（便于贴图/贴文字给智能体看） */
        if (!window.__kiteCopyPanel) {
            window.__kiteCopyPanel = function (btn) {
                try {
                    var p = btn.closest('.kite-head-overview');
                    var t = p ? p.innerText : '';
                    var done = function () { btn.textContent = '✅已复制'; setTimeout(function () { btn.textContent = '📋复制'; }, 1200); };
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(t).then(done, done);
                    } else {
                        var ta = document.createElement('textarea');
                        ta.value = t; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); document.body.removeChild(ta); done();
                    }
                } catch (e) { btn.textContent = '❌失败'; setTimeout(function () { btn.textContent = '📋复制'; }, 1200); }
            };
        }
        panel.innerHTML = '<div class="kho2-head">'
            + '<div class="kho2-head__row">'
            + '<span class="kho2-name">风筝系统</span>'
            + '<span class="kho2-copy" title="一键复制面板内容（文字版，便于发给智能体/存档）" onclick="window.__kiteCopyPanel(this)">📋复制</span>'
            + '<span class="kho2-speed ' + spdCls.trim() + '" title="整体速度：最近60秒平均响应速度，绿=快 红=慢">' + (stats ? stats.seconds.toFixed(1) : '--') + '<i>秒/次</i><em class="kho2-lab">速度</em></span>'
            + '<span class="kho2-odo" title="今日总里程：今天所有对话累计执行的工具次数（1次=1km）">' + odoTxt + '<i>km</i><em class="kho2-lab">里程</em></span>'
            + '</div>'
            + '<div class="kho2-head__row kho2-head__row--chips">' + gateChips
            + (window.__kho2LinkStatHtml || '<div class="kho2-empty" id="kho2LinkStat">链路统计中…</div>')
            + '</div>'
            + '</div>'
            + '<div class="kho2-main">'
            + '<div class="kho2-col kho2-col--chats"><div class="kho2-sec kho2-sec--sortable' + (_sortBySpeed ? ' kho2-sec--on' : '') + '" data-kho2-sort="speed" title="点击按速度排名：最快的排最上面（再点一次恢复编号顺序）">各对话速度' + (_sortBySpeed ? ' ▼' : '') + '</div><div class="kho2-rows" id="kho2Rows"></div></div>'
            + '<div class="kho2-col kho2-col--lanes"><div class="kho2-sec">连接池赛道</div>' + (laneHtml || '<div class="kho2-empty">暂无连接池数据</div>') + '</div>'
            + '<div class="kho2-col kho2-col--perf"><div class="kho2-sec">模块延迟</div><div class="kho2-perf" id="kho2Perf">' + (window.__kho2PerfHtml || '<div class="kho2-empty">统计中…</div>') + '</div></div>'
            /* v15 第四列：性能列（从头部行搬过来的 FPS / 渲染延迟 / 内存 / CPU，头部不再拥挤） */
            + '<div class="kho2-col kho2-col--sys">'
            + '<div class="kho2-sec">性能</div>'
            + '<div class="kho2-sys">'
            + '<div class="kho2-sys__row"><span class="kho2-fps" title="界面渲染帧率">' + (typeof window._kiteFps === 'number' ? window._kiteFps : '--') + '<i>FPS</i></span>'
            + '<span class="kho2-fps" id="kho2-lat" title="渲染延迟：每帧平均耗时（ms）。明细见右侧「模块延迟」栏">' + (typeof window._kiteLatency === 'number' ? window._kiteLatency.toFixed(1) : '--') + '<i>ms</i></span></div>'
            + '<div class="kho2-sys__row"><span class="kho2-mem" title="页面 JS 堆内存（Chrome）/ 估算总内存">' + totalMemText() + '</span>'
            + '<span class="kho2-cpu" title="服务器 CPU 使用率（红绿灯轮询更新）">' + (typeof window._kiteCpu === 'number' ? 'CPU ' + Math.round(window._kiteCpu) + '%' : 'CPU --') + '</span></div>'
            /* 卡顿诊断行：长任务（>50ms 阻塞主线程）次数/累计耗时 + DOM 节点总量 */
            + '<div class="kho2-sys__row"><span class="kho2-fps kho2-lt" title="长任务：超过50ms阻塞主线程的任务次数/累计耗时（卡顿元凶，越少越好）"><b>' + (window._kiteLongTasks ? window._kiteLongTasks.count : 0) + '</b><i>LT</i></span>'
            + '<span class="kho2-fps" title="长任务累计阻塞耗时(ms)">' + (window._kiteLongTasks ? Math.round(window._kiteLongTasks.totalMs) : 0) + '<i>ms</i></span>'
            + '<span class="kho2-fps" title="当前页面 DOM 节点总数（含对话气泡/消息流，过多会拖慢渲染）">' + (function () { try { return document.getElementsByTagName('*').length; } catch (e) { return '--'; } })() + '<i>DOM</i></span></div>'
            + '</div>'
            + '</div>'
            + '</div>';
        panel.classList.add('open');
        panel._szDirty = true;
        panel._lx = undefined; panel._ly = undefined; /* 面板打开时尺寸可能变化，标记重读布局 */
        /* 总览行序始终按当前 chatBoxes 顺序实时排序，避免编号错乱 */
        function _createSeq(chatId, chatRef) {
            var id = chatId || (chatRef && chatRef.id) || '';
            var m = /(\d+)/.exec(String(id));
            if (m) return parseInt(m[1], 10);
            return 1e9;
        }
        var _sorted = nodes.slice();
        if (_sortBySpeed) {
            /* 速度排序：秒/次升序（数值小=快，最快排最上），无数据（Infinity）沉底；同速按创建序 */
            _sorted.sort(function (a, b) {
                var ra = headRateNum(a), rb = headRateNum(b);
                if (ra !== rb) return ra - rb;
                return _createSeq(a.chatId, a.chat) - _createSeq(b.chatId, b.chat);
            });
        } else {
            _sorted.sort(function (a, b) {
                return _createSeq(a.chatId, a.chat) - _createSeq(b.chatId, b.chat);
            });
        }
        var rowsBox = panel.querySelector('#kho2Rows');
        _sorted.forEach(function (node, index) {
            var row = document.createElement('div');
            row.className = 'kho-row';
            var st = headStatus(node);
            var gd = gateDesc(node.chatId);
            var gdEmoji = gd ? (gd.slice(0, gd.indexOf(' ')) + ' ') : '';
            var gInfo = gateMap[node.chatId];
            var ownerTxt = (gInfo ? providerName(gInfo.provider) : '') || providerName((node.chat && (node.chat.modelName || node.chat.modelId)) || '') || modelLetter(node.chat);
            var nameHtml = st
                ? '<span class="kho-row__name kho-status kho-status--bad" title="' + st + '">' + st + '</span>'
                : '<span class="kho-row__name" title="' + ownerTxt + '">' + ownerTxt + '</span>';
            /* 状态（响应缓慢/已失败等）不单独占一列，直接替换名字描述 */
            row.innerHTML = '<i class="kho-row__no">' + (index + 1) + '</i>' + nameHtml + '<b>' + formatHeadRate(node) + '</b><i class="kho-row__mem" title="该对话内存估算（历史消息+DOM）">' + chatMemEstimate(node) + '</i><i class="kho-row__light">' + (gdEmoji || '🚦') + '</i>';
            // 面板边界拦截：按下/松开/双击都不冒泡到龙头。否则龙头拖拽的
            // setPointerCapture 会吞掉 click，且双击会误开语音聊天对话框。
            ['pointerdown', 'pointerup', 'dblclick'].forEach(function (t) {
                row.addEventListener(t, function (ev) { if (ev.stopPropagation) ev.stopPropagation(); }, false);
            });
            row.addEventListener('click', function (e) {
                e.stopPropagation();
                // 摄像机直达该对话：优先用 _focusCameraOn 平移画布到风筝节点上
                if (window.App && App._focusCameraOn && node.el) {
                    App._focusCameraOn(node.el);
                    if (App._focusChatBox && node.chat && node.chat.id) {
                        setTimeout(function () {
                            try { App._focusChatBox(node.chat.id); } catch (err) {}
                        }, 420);
                    }
                } else if (window.App && App._focusChatBox && node.chat && node.chat.id) {
                    App._focusChatBox(node.chat.id);
                } else if (window.App && App.activate && node.chat && node.chat.el) {
                    App.activate(node.chat.el);
                }
                node.el.classList.add('kite-track');
                setTimeout(function () { node.el.classList.remove('kite-track'); }, 1800);
                overviewClosed = true;
                panel.classList.remove('open');
        panel._szDirty = true;
            });
            (rowsBox || panel).appendChild(row);
        });
        /* 【对话速度排序】事件委托：面板 500ms 整块 innerHTML 重建，直接绑列头会被冲掉，故绑在 panel 上 */
        if (!panel._sortBound) {
            panel._sortBound = true;
            panel.addEventListener('click', function (e) {
                var t = e.target && e.target.closest ? e.target.closest('[data-kho2-sort]') : null;
                if (!t || !panel.contains(t)) return;
                e.stopPropagation();   // 防冒泡到龙头：setPointerCapture 会吞 click / 双击误开语音框
                _sortBySpeed = !_sortBySpeed;
                _updateHeadOverviewInner();   // 绕过 500ms 限频，立即重建生效
            }, false);
        }
    }
    function setCardShow(node, on) {
        if (!node.cardEl) return;
        node.cardEl.classList.toggle('show', !!on);
        /* 【显示与物理解耦 2026-09-20】气泡/身体显示不再唤醒 JS 物理：
           静止态（CSS 动画接管）下也允许弹出，仅把气泡坐标同步到节点当前坐标，
           与 CSS sway 的 ±3px 叠加偏差可接受。只有手拖拽才会唤醒物理（见下方 _busy 判定）。 */
        if (on && _idleOn && node.el && node.el.isConnected) {
            node.cardEl.style.left = node.x + 'px';
            node.cardEl.style.top = node.y + 'px';
        }
    }
    /* 全局互斥：显示某个气泡前，隐藏其他所有气泡（始终只显示最近一句话） */
    function hideAllCards(except) {
        nodes.forEach(function (m) {
            if (m !== except && m.cardEl) {
                m.cardEl.classList.remove('show');
                m.autoShowUntil = 0;
                m._clickShown = false;
            }
        });
    }

    /* ---------- DOM 构建 ---------- */
    function buildSeg(chat) {
        var seg = document.createElement('div');
        seg.className = 'kite-seg';
        seg.dataset.chatId = chat.id;
        var blob = document.createElement('div');
        blob.className = 'kite-blob';
        var letter = document.createElement('span');
        letter.className = 'kb-letter';
        letter.textContent = modelLetter(chat);
        blob.appendChild(letter);
        // 🚦 红绿灯状态点 + 数字徽章（排位/休整倒数，数据来自 /api/gate/active）
        var light = document.createElement('i');
        light.className = 'kb-light';
        blob.appendChild(light);
        var lightNum = document.createElement('i');
        lightNum.className = 'kb-light-num';
        lightNum.textContent = '';
        blob.appendChild(lightNum);
        seg.appendChild(blob);
        // 悬停显示/隐藏：显示最后一条消息和运行期平均消息间隔
        seg.addEventListener('mouseenter', function () {
            var current = byId[chat.id];
            if (!current) return;
            current._hover = true;
            hideAllCards(current);          // 只显示最近一句：先收起其他气泡
            renderCard(current);
            setCardShow(current, true);
        });
        seg.addEventListener('mouseleave', function () {
            var current = byId[chat.id];
            if (!current) return;
            current._hover = false;
            if (!current.autoShowUntil && !current._clickShown) setCardShow(current, false);
        });
        /* ---------- 每个球都可拖拽：拖动=临时拉离链条（松手自动回链）；单击=切换到对话 ---------- */
        function focusChat(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            if (!chat.el || !window.App) return;
            if (App._focusChatBox) App._focusChatBox(chat.id);
            else if (App.activate) App.activate(chat.el);
        }
        seg.addEventListener('pointerdown', function (e) {
            var current = byId[chat.id];
            if (!current) return;
            if (e.stopPropagation) e.stopPropagation(); // 防止拖球时误触发画布平移
            if (e.preventDefault) e.preventDefault(); // 阻止合成 mousedown 冒泡到画布导致平移
            current._drag = true; current._dragMoved = 0; _setOverviewHidden(true);
            armPhysics(); // 拖尾巴同样要开物理闸：否则节点无人渲染、无链条回弹摆动（松手由 window pointerup 关闸）
            seg.classList.add('dragging');
            seg.setPointerCapture && seg.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        seg.addEventListener('pointermove', function (e) {
            var current = byId[chat.id];
            if (!current || !current._drag) return;
            current._dragMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
            if (dragMoved > 6) _setOverviewHidden(true);
            current.x = e.clientX; current.y = e.clientY;   // 球贴住鼠标；松手后由链式约束拉回
        });
        function segUp(e) {
            var current = byId[chat.id];
            if (!current || !current._drag) return;
            current._drag = false; _setOverviewHidden(false);
            seg.classList.remove('dragging');
            if (current._dragMoved < 6) {
                e.preventDefault();
                focusChat(e);
            }
        }
        seg.addEventListener('pointerup', segUp);
        seg.addEventListener('pointercancel', segUp);
        return seg;
    }
    var node; // 供上方事件闭包使用（syncChats 中赋值）

    function tailPos() {
        var last = nodes.length ? nodes[nodes.length - 1] : head;
        return { x: last.x - LINK, y: last.y };
    }

    function syncChats() {
        if (!window.App || !Array.isArray(App.chatBoxes)) return;
        // sig 包含 id + 任务状态 + 思考态：状态变化时也触发同步
        var sig = App.chatBoxes.map(function (c) {
            return c && c.id ? c.id + ':' + (c._taskStatus || '-') + ':' + (c._thinking ? '1' : '0') + ':' + (c.modelName || c.modelId || '-') : '';
        }).join('|');
        if (sig === lastSig) return;
        lastSig = sig;
        /* 【显示与物理解耦 2026-09-20】对话增删/状态变化不再无条件唤醒 JS 物理：
           只有"身体结构变化"（新增/删除一节）才唤醒，让链条重新排布；
           纯状态/思考态变化只更新 DOM 颜色与文字，静止态下继续由 CSS 动画驱动。 */
        var _structChanged = false;
        var seen = {};
        App.chatBoxes.forEach(function (chat) {
            if (!chat || !chat.id) return;
            seen[chat.id] = true;
            if (!byId[chat.id]) {
                var p = tailPos();
                var seg = buildSeg(chat);
                root.appendChild(seg);
                var card = buildCard(chat);
                root.appendChild(card);
                var nd = { chatId: chat.id, chat: chat, el: seg, cardEl: card, x: p.x, y: p.y, _hover: false, autoShowUntil: 0, hint: '', _drag: false, _dragMoved: 0, _lastStatus: '', _apiCallsSeen: undefined };
                nodes.push(nd); byId[chat.id] = nd;
                node = nd;
                _structChanged = true;
                renderCard(nd, '');
            }
        });
        for (var i = nodes.length - 1; i >= 0; i--) {
            if (!seen[nodes[i].chatId]) {
                nodes[i].el.remove();
                nodes[i].cardEl.remove();
                delete byId[nodes[i].chatId];
                nodes.splice(i, 1);
                _structChanged = true;
            }
        }
        // v5.1.5b: sort by creation order (id number), chatBoxes array order is polluted by track z_index
        function _createSeq2(chatId, chatRef) {
            var id = chatId || (chatRef && chatRef.id) || '';
            var m = /(\d+)/.exec(String(id));
            if (m) return parseInt(m[1], 10);
            return 1e9;
        }
        nodes.sort(function (a, b) {
            return _createSeq2(a.chatId, a.chat) - _createSeq2(b.chatId, b.chat);
        });
        if (_structChanged) kiteWake(); /* 节数变化：退出静止态重新排布链条 */
        nodes.forEach(function (n, i) {
            var letterEl = n.el.querySelector('.kite-letter') || (n.chat && n.chat._kiteLetterEl);
            if (letterEl && letterEl.textContent !== nl) letterEl.textContent = nl;
            // —— 任务态色：根据 chat._taskStatus / _thinking 给 seg 切 class ——
            // 优先级：thinking > success/fail(已结束) > 默认(无)
            var s = (n.chat._taskStatus || '');
            if (n.chat._thinking) s = 'pending';
            if (s !== n._lastStatus) {
                n._lastStatus = s;
                n.el.classList.toggle('task-success', s === 'success');
                n.el.classList.toggle('task-fail',    s === 'fail');
                n.el.classList.toggle('task-pending', s === 'pending');
            }
            // 每轮同步检测真实模型连通次数变化（chat._apiCalls），驱动"秒/轮"速度统计
            recordNewMessages(n);
            // —— 慢速检测：运行/排队中的对话长期无模型响应 → 警报闪烁，提示用户检查 ——
            var running = !!(n.chat && n.chat.isSending) || !!(n.chat && n.chat._thinking);   // 运行中：isSending 或思考中
            if (running) {
                if (n._lastActive === undefined) n._lastActive = Date.now();
                var stalled = (Date.now() - n._lastActive) > STALL_MS;
                if (stalled !== !!n._stall) {
                    n._stall = stalled;
                    n.el.classList.toggle('stall', stalled);
                    if (stalled) {
                        try {
                            if (window.App && App._showStormToast) App._showStormToast('「' + (n.chat.title || n.chatId) + '」已超过 3 分钟无响应，风筝节点红色闪烁，请检查该对话');
                        } catch (e) {}
                        /* 【响应缓慢处理】弹窗让用户选择：确定=打断对话让其继续工作；等待=继续观察并清零计时 */
                        if (!n._stallAsked) {
                            n._stallAsked = true;   // 每次停滞只问一次，避免弹窗轰炸
                            setTimeout(function () {
                                try {
                                    var ok = null;   // true=打断 false=等待
                                    if (window.App && typeof App._showCustomConfirm === 'function') {
                                        App._showCustomConfirm({
                                            title: '响应缓慢',
                                            message: '「' + (n.chat.title || n.chatId) + '」已超过 3 分钟无响应（响应缓慢）。\n\n【打断】打断该对话，让它继续工作\n【继续等待】继续观察（重置计时）',
                                            okText: '打断',
                                            cancelText: '继续等待',
                                            onOk: function() { handleStallChoice(true); },
                                            onCancel: function() { handleStallChoice(false); }
                                        });
                                    } else {
                                        ok = _dlgConfirmSync('「' + (n.chat.title || n.chatId) + '」已超过 3 分钟无响应（响应缓慢）。\n\n【确定】打断该对话，让它继续工作\n【取消/等待】继续观察（重置计时）');
                                        handleStallChoice(!!ok);
                                    }
                                    function handleStallChoice(yes) {
                                        var chatNow = n.chat;
                                    if (yes && chatNow) {
                                        /* 打断对话：优先 App.stopSending，兜底 _stopped 标记 */
                                        if (window.App && typeof App.stopSending === 'function') App.stopSending(chatNow);
                                        else { chatNow._stopped = true; chatNow.isSending = false; }
                                        /* 【2026 改进】打断后立即注入"继续"提示，让 AI 马上接着干活，而不是停在半路 */
                                        setTimeout(function () {
                                            try {
                                                var _kite = n.chatId || (n.chat && n.chat.id);
                                                if (window.App && typeof App._quickSendToChat === 'function' && _kite) {
                                                    /* 【防重复注入】同一对话 15 秒内只允许注入一次"继续"提示，
                                                       防止 tick 多节点/多路径重复触发导致对话框出现两条相同提示 */
                                                    var _nowTs = Date.now();
                                                    if (chatNow._kiteStallInjectedAt && (_nowTs - chatNow._kiteStallInjectedAt) < 15000) {
                                                        if (window.Store && Store.addLog) Store.addLog('info', _kite, 'kite-stall', '🪁 风筝：15秒内已注入过"继续"提示，跳过本次重复注入');
                                                        return;
                                                    }
                                                    chatNow._kiteStallInjectedAt = _nowTs;
                                                    App._quickSendToChat(_kite,
                                                        '刚才检测到响应停滞，已被打断。请继续未完成的任务：1）简要总结目前进度（包括已读取/修改过的文件路径）；2）找出停滞原因；3）换一种方法继续干活，直到任务完成。',
                                                        { isGuardInject: true });
                                                    if (window.Store && Store.addLog) Store.addLog('info', _kite, 'kite-stall', '🪁 风筝：已打断停滞对话并注入"继续"提示');
                                                }
                                            } catch (e3) {}
                                        }, 600);
                                    } else if (n._stall) {
                                        /* 用户选择等待：清零计时重新观察 */
                                        n._lastActive = Date.now();
                                        n._stall = false;
                                        n.el.classList.remove('stall');
                                        n._stallAsked = false;   // 已脱离停滞，下次再次停滞时允许再次询问
                                    }
                                    /* 打断分支不重置 _stallAsked：若打断失败仍停滞，避免弹窗循环；
                                       节点脱离停滞时（下方 else if 分支）统一重置 */
                                     }
                                     } catch (e2) { n._stallAsked = false; }
                            }, 0);
                        }
                    }
                }
                // 悬停气泡显示检查提示（不覆盖正在显示的内容）
                if (stalled && n._hover && n.cardEl && !n.cardEl.classList.contains('show')) {
                    renderCard(n, '⚠️ 长时间无响应，请检查此对话');
                    setCardShow(n, true);
                }
            } else if (n._stall) {
                n._stall = false;
                n._stallAsked = false;   // 脱离停滞，允许下次停滞再次询问
                n.el.classList.remove('stall');
            }
            // 状态变化时若龙头概览正开着，实时刷新显示（含长期停滞状态变化）
            var headSig = s + ':' + (n._stall ? '1' : '0');
            if (_headHover && !overviewClosed && headSig !== n._lastHeadStatus) {
                n._lastHeadStatus = headSig;
                updateHeadOverview();
            }
        });
    }

    /* ---------- 里程表：1次工具调用=1公里，按天累计，存 localStorage 跨刷新不丢 ---------- */
    var ODO_KEY = 'zf3d-kite-odometer';   // 值格式: {"d":"2026-09-10","v":123}
    function odometerLoad() {
        try {
            var o = JSON.parse(localStorage.getItem(ODO_KEY) || 'null');
            var today = new Date().toISOString().slice(0, 10);
            if (o && o.d === today && typeof o.v === 'number') return o.v;
        } catch (e) {}
        return 0;
    }
    function odometerSave(v) {
        try { localStorage.setItem(ODO_KEY, JSON.stringify({ d: new Date().toISOString().slice(0, 10), v: v })); } catch (e) {}
    }
    window._kiteOdometer = odometerLoad();

    /* ---------- 工具调用：短暂弹出该节的历史最新一句话（提示用户"AI 正在调用工具"，hint 仍保留供 hover 显示工具名） ---------- */
    function showTool(chat, name) {
        if (!root) return;
        /* 里程表 +1 公里（1次工具调用=1km），并让概览面板即时刷新 */
        window._kiteOdometer = odometerLoad() + 1;
        odometerSave(window._kiteOdometer);
        /* 修复：只有在鼠标悬停龙头且概览未关闭时才刷新，否则 updateHeadOverview 末尾
           的 panel.classList.add('open') 会把头部面板强行弹开（首次工具调用即触发） */
        if (_headHover && !overviewClosed) updateHeadOverview();
        var nd = (chat && chat.id && byId[chat.id]) ? byId[chat.id] : null;
        if (!nd || !(nd.cardEl && nd.cardEl.isConnected)) return;
        nd.hint = '🔧 ' + (toolHints[name] || name);   // 工具名始终保留在 hint 里，供 hover 显示
        hideAllCards(nd);                              // 只保留最近一句话：先隐藏其他气泡
        // 切换方向A：工具调用时显示历史最新一句话（消息），而不是 🔧 工具名
        renderCard(nd, '');
        nd.autoShowUntil = t + 2.8;
        setCardShow(nd, true);
        if (popTimer) clearTimeout(popTimer);
        popTimer = setTimeout(function () {
            popTimer = null;
            if (nd && nd.cardEl && nd.cardEl.isConnected) { nd.autoShowUntil = 0; if (!nd._hover) setCardShow(nd, false); }
        }, 2800);
    }

    /* ---------- 🚦 红绿灯联动（v4.2）：每 2 秒轮询 /api/gate/active ----------
       把闸门交通状态画到每节球上：绿=放行通信中 / 橙=排队 / 紫=应急休整让道。
       - 状态点 + 数字徽章（排位/休整倒数）+ 球描边色（交通层，不覆盖任务层背景色）
       - 悬停气泡追加一行交通描述；龙头概览显示全局通行/排队/休整统计 */
    var gateMap = {};        // chatId -> {state, queue_pos, run_now, wait_now, hold_left}
    var gateGlobal = null;   // {lanes, running, queue_len, holding}

    function pollGate() {
        try {
            fetch('/api/gate/active', { cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (!j || !j.ok) return;
                    var m = {}, holding = 0;
                    (j.active || []).forEach(function (a) {
                        if (!a || !a.box) return;
                        m[a.box] = a;
                        if (a.state === 'holding') holding++;
                    });
                    gateMap = m;
                    gateGlobal = { lanes: j.lanes || 0, running: j.running || 0,
                                   queue_len: j.queue_len || 0, holding: holding,
                                   max_lanes: j.auto_max_lanes || 0,
                                   groups: j.provider_groups || [],
                                   probe: j.probe || {},
                                   lanes_health: j.lanes_health || [] };
                    if (typeof j.cpu === 'number') window._kiteCpu = Math.round(j.cpu);
                    applyGateLights();
                })
                .catch(function () {});
        } catch (e) {}
    }

    function gateDesc(chatId) {
        var g = gateMap[chatId];
        if (!g) return '';
        if (g.state === 'running') return '🟢 通信中 ' + Math.round(g.run_now || 0) + 's';
        if (g.state === 'holding') return '🟣 应急休剩 ' + Math.ceil(g.hold_left || 0) + 's';
        if (g.state === 'queued' || g.state === 'gapped') {
            var q = (g.queue_pos && g.queue_pos > 0) ? '第' + g.queue_pos + '位 ' : '';
            return '🟠 排队 ' + q + '已等' + Math.round(g.wait_now || 0) + 's';
        }
        return '';
    }

    function applyGateLights() {
        nodes.forEach(function (n) {
            var g = gateMap[n.chatId];
            var cls = '', num = '';
            if (g) {
                if (g.state === 'running') cls = 'gate-run';
                else if (g.state === 'holding') {
                    cls = 'gate-hold';
                    num = Math.ceil(g.hold_left || 0) + 's';
                } else {
                    cls = 'gate-queue';
                    if (g.queue_pos && g.queue_pos > 0) num = '第' + g.queue_pos;
                }
            }
            if (n._gateCls !== cls) {          // 状态变化才动 DOM class
                if (n._gateCls) n.el.classList.remove(n._gateCls);
                if (cls) n.el.classList.add(cls);
                n._gateCls = cls;
                var numEl = n._numEl || (n._numEl = n.el.querySelector('.kb-light-num'));
                if (numEl) numEl.textContent = num;
                // 悬停中的气泡补刷交通行（hover 时状态切换可见）
                if (n._hover && n.cardEl && n.cardEl.classList.contains('show')) renderCard(n, '');
            } else {
                var numEl2 = n._numEl || (n._numEl = n.el.querySelector('.kb-light-num'));
                if (numEl2 && numEl2.textContent !== num) numEl2.textContent = num;
            }
        });
        // 龙头概览开着时实时刷新全局交通统计
        if (_headHover && !overviewClosed) updateHeadOverview();
    }

    /* ---------- 物理链 ---------- */
    function tick(ts) {
        /* 【防冻死】任何一帧内部异常都不允许打断 rAF 主循环（否则风筝永久冻结：不能动、面板也不刷新） */
        try {
            /* 【FPS 统计上移 tick 外层 2026-09-24】无条件计数，不受隐藏/急速/降级/静止跳帧影响。
               旧缺陷：计数在 _tickBody 深处，各跳帧路径 return 后 _fpsT0 停滞，恢复首帧把
               几十秒空窗算进 1 秒窗口 → 曾算出 0FPS / 79589ms 的假样本并挂在面板上。
               空窗超 3 秒（切后台/长阻塞/跳帧期）直接重新校准，不产出假样本。 */
            if (!_fpsT0 || ts - _fpsT0 > 3000) { _fpsT0 = ts; _fpsFrames = 0; }
            _fpsFrames++;
            if (ts - _fpsT0 >= 1000) {
                window._kiteFps = Math.round(_fpsFrames * 1000 / (ts - _fpsT0));
                window._kiteLatency = Math.round((ts - _fpsT0) / _fpsFrames * 10) / 10;
                _fpsFrames = 0; _fpsT0 = ts;
            }
            /* 【B3 页面隐藏挂起】后台标签页 rAF 本就被浏览器降频到 ~1Hz，但部分环境仍以低频执行完整 _tickBody；
               跳过全部计算（外层仍统一续帧，恢复可见时 lastTs 由 dt 钳制兜底） */
            // 注意：哨兵值 0 是合法状态（hidden 挂起时清零），下方 `|| _pfFrame` 回退依赖 0 被 || 吞掉——请勿改为 ?? 或改哨兵为 -1
            if (document.hidden) { lastTs = ts; tick._pfPrev = 0; tick._pfPrev2 = 0; return; }
            /* 【A1 长帧观测】帧耗时 >50ms 记入环形缓冲，供面板/排查回溯峰值（此前 819ms 只能靠推测） */
            var _pfFrame = window.Perf ? performance.now() : 0;
            if (_pfFrame && _pfFrame - (tick._pfPrev || _pfFrame) > 50) {
                (tick._longFrames || (tick._longFrames = [])).push(Math.round(_pfFrame - (tick._pfPrev || _pfFrame)));
                if (tick._longFrames.length > 60) tick._longFrames.shift();
            }
            if (_pfFrame) tick._pfPrev = _pfFrame;
            /* 【B2 帧预算熔断】统计 + 降级判定（dragging 帧不计入，拖拽跟手优先） */
            var _dragging = nodes.some && nodes.some(function (n) { return n._drag; });
            if (_pfFrame && !_dragging) {
                if (_pfFrame - (tick._pfPrev2 || _pfFrame) > 33) { _overN++; _calmMs = 0; } else { _calmMs += _pfFrame - (tick._pfPrev2 || _pfFrame); if (_calmMs >= 500) _overN = 0; }
                tick._pfPrev2 = _pfFrame;
                _skipDom = _overN >= 3;
            } else if (_dragging) { _skipDom = false; _overN = 0; }
            _tickBody(ts);
        } catch (err) {
            try { console.error('[kite] tick frame error (suppressed):', err); } catch (e2) {}
        }
        /* 【rAF 链防重保险】单一循环闸：若未来任何路径（热重载/重复 init）产生第二条链，
           旧链立即自杀，保证全页永远只有一条 tick 循环（根治「动画越跑越多、FPS 越掉越低」） */
        var _myChain = ++window.__kiteRafChain || (window.__kiteRafChain = 1);
        if (_myChain !== window.__kiteRafChain) return; /* 已被更新的链取代，本链终止 */
        window.__kiteRafId = requestAnimationFrame(tick);
    }
    /* ===== 物理未激活时的静态帧：不动坐标、不叠摆动，只做低频同步与面板刷新 ===== */
    function _tickIdle(ts, dt) {
        /* 【修复 2026-09-27】物理闸未开时 t 从不累加，导致 kiteBlendStart 后
           `t - _idleBlendT0 >= FADE_S` 永不成立 → --idle-k 卡在 0，
           身体 kiteSway（乘 --idle-k）不动而头部 kiteHeadIdle（不乘）照摆。
           静态帧路径同样推进时钟，混合态 1 秒后正常切入完全 CSS 接管 */
        t += dt;
        /* 会话同步降频到 ~300ms，保证新对话节点能出现/消失 */
        _idleSyncAt = (_idleSyncAt || 0) + dt;
        if (_idleSyncAt >= 0.3) { _idleSyncAt = 0; try { syncChats(); } catch (e) {} }
        if (!_idleOn && !_idleBlend) { _idleAcc = (_idleAcc || 0) + dt; if (_idleAcc >= IDLE_ENTER_S - FADE_S) kiteBlendStart(); }
        else if (_idleBlend && (t - _idleBlendT0 >= FADE_S)) kiteIdleEnter();
        /* 节点静态定位一次：新建节点后按链序落到龙头下方，之后不再逐帧计算 */
        if (!_idleLaid || _idleLaid !== nodes.length) { _layoutIdle(); _idleLaid = nodes.length; }
        /* 静态帧也要把龙头钉在锚点上：否则 headEl 从未被写过 transform，
           DOM 停在 CSS 默认位置（左上角），看起来就是"龙头初始跑到左上角" */
        var hxf = head.x.toFixed(1), hyf = head.y.toFixed(1);
        var htf = 'translate3d(' + hxf + 'px,' + hyf + 'px,0)';
        if (htf !== headEl._tf) { headEl.style.transform = htf; headEl._tf = htf; }
    }
    var _idleLaid = 0;
    function _layoutIdle() {
        var px = head.x, py = head.y;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var ty = py + LINK;
            n.x += (px - n.x) * 0.3;
            n.y += (ty - n.y) * 0.3;
            var tf = 'translate3d(' + n.x.toFixed(1) + 'px,' + n.y.toFixed(1) + 'px,0)';
            if (tf !== n.el._tf) { n.el.style.transform = tf; n.el._tf = tf; }
            if (n.cardEl && n.cardEl.classList.contains('show')) {
                n.cardEl.style.left = n.x + 'px';
                n.cardEl.style.top = n.y + 'px';
            }
            if (n.autoShowUntil && t > n.autoShowUntil) { n.autoShowUntil = 0; if (!n._hover) setCardShow(n, false); }
            px = n.x; py = n.y;
        }
    }

    function _tickBody(ts) {
        /* 【隐藏不统计】风筝面板隐藏期间完全跳过计算与 Perf 打点（tick 外层已统一 rAF 续帧，
           此处绝不能再 requestAnimationFrame——否则每帧翻倍指数自我复制） */
        if (kiteHidden) {
            lastTs = ts; // 隐藏期间持续校准基准时间，重新显示后首帧 dt 不会跳变
            return;
        }
        /* 【极速模式】跳过全部风筝动画/物理/测速计算（tick 外层已统一 rAF 续帧，
           此处绝不能再 requestAnimationFrame——否则每帧翻倍指数自我复制，急速开启几秒即主线程死循环） */
        if (window.isTurboMode && window.isTurboMode()) {
            lastTs = ts; // 急速期间持续校准基准时间，关闭急速后首帧 dt 不会跳变
            return;
        }
        /* 【FPS 自动降级】全局帧率过低（<10 持续 2 秒）时跳过全部风筝动画计算，避免雪上加霜 */
        if (window.FpsGuard && !window.FpsGuard.allow('kite')) {
            lastTs = ts; // 降级期间持续校准基准时间，恢复后首帧 dt 不会跳变
            return;
        }
        var _perfKiteT0 = window.Perf ? performance.now() : 0;
        var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
        lastTs = ts;
        /* 【物理解耦】物理闸未打开：跳过全部物理计算（巡航/风力摆动/链条约束），
           风筝静止挂在当前位置，只保留低频会话同步与面板刷新。
           拖拽入口（bindHead.down / 节点 pointerdown）会 armPhysics() 打开闸。 */
        if (!_physicsArmed) {
            _tickIdle(ts, dt);
            return;
        }
        t += dt;
        var _frameParity = (t * 60 | 0) & 1; /* 【B2 熔断】隔帧交替奇偶，降级时不同帧写不同半数节点 */
        /* 模块延迟面板刷新：独立 1s 计时器（FPS 统计已上移 tick 外层，此处不再计帧） */
        if (!_perfPanelT0) _perfPanelT0 = ts;
        if (ts - _perfPanelT0 >= 1000) { /* 1s 一次：降低统计与面板重建开销 */
            _perfPanelT0 = ts;
            /* 模块延迟：改用累计快照（不再用 500ms 增量），列表稳定不闪烁，且包含所有 Perf 记录的模块（风筝/画布/对话流/工作台/背景等） */
            if (window.Perf && Perf.snapshot) {
                var _snapAll = Perf.snapshot(), _listAll = [];
                for (var _ka in _snapAll) {
                    var _da = _snapAll[_ka];
                    if (_da && _da.calls > 0) _listAll.push({ name: _ka, ms: _da.total / _da.calls, total: _da.total, calls: _da.calls });
                }
                _listAll.sort(function (a, b) { return b.total - a.total; });
                window._kitePerfList = _listAll.slice(0, 12);
            }
            /* 模块延迟列：面板内第三列常驻显示。
               【防闪烁 2026-09-14】降频为每 3s 刷新一次，且内容签名未变化时完全不动 DOM——
               避免每秒整体重写 innerHTML 造成文字闪烁、忽明忽暗 */
            window.__kitePerfTick = (window.__kitePerfTick || 0) + 1; var _shouldRefresh = (window.__kitePerfTick % 3 === 0);
            var _perfBox = _shouldRefresh ? (_overviewEl || (root && root.querySelector('.kite-head-overview'))) : null;
            _perfBox = _perfBox && _perfBox.querySelector('#kho2Perf');
            if (_perfBox) {
                var list = window._kitePerfList;
                if (!list || !list.length) {
                    /* 无记录时保留上次内容（不闪「统计中」），仅首次显示占位 */
                    var _emptyHtml = window.__kho2PerfHtml || '<div class="kho2-empty">统计中…</div>';
                    if (_perfBox._lastHtml !== _emptyHtml) { _perfBox.innerHTML = _emptyHtml; _perfBox._lastHtml = _emptyHtml; }
                } else {
                    /* 已有数据：清掉残留的「统计中…」占位，避免占位文字和模块行并存 */
                    var _ph = _perfBox.querySelector('.kho2-empty');
                    if (_ph) { _ph.parentNode && _ph.parentNode.removeChild(_ph); if (_perfBox._lastHtml) _perfBox._lastHtml = _perfBox.innerHTML; }
                    var _max = Math.max.apply(null, list.map(function (x) { return x.total || x.ms; })) || 1;
                    var _map = {}; list.forEach(function (it) { _map[it.name] = it; });
                    /* 平滑更新：已有行只改数字/条宽/颜色，新行淡入，消失行不立即删除——文字不突然出现/消失 */
                    var _rows = _perfBox.querySelectorAll('.kho2-perf__row');
                    var _seen = {};
                    Array.prototype.forEach.call(_rows, function (rowEl) {
                        var nm = rowEl.getAttribute('data-name');
                        var it = nm ? _map[nm] : null;
                        if (!it) { rowEl.style.opacity = '0'; rowEl._gone = (rowEl._gone || 0) + 1; if (rowEl._gone >= 2) { rowEl.parentNode && rowEl.parentNode.removeChild(rowEl); } return; }
                        rowEl._gone = 0; rowEl.style.opacity = '';
                        _seen[nm] = true;
                        var final = (typeof it.total === 'number' ? it.total : it.ms * it.calls);
                        var pct = Math.max(6, Math.min(100, Math.round(final / _max * 100)));
                        var hot = final >= 10 ? '#f66' : (final >= 5 ? '#fc6' : '#7d7');
                        var valEl = rowEl.querySelector('.kho2-perf__val'), barEl = rowEl.querySelector('.kho2-perf__bar i');
                        if (valEl) { var nv = final.toFixed(1) + 'ms'; if (valEl.textContent !== nv) { valEl.textContent = nv; valEl.style.color = hot; } }
                        if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = hot; }
                        rowEl.title = it.name + '：累计总耗时 ' + final.toFixed(1) + 'ms（单次均值 ' + it.ms.toFixed(1) + 'ms × ' + it.calls + ' 次调用）';
                    });
                    var _maxKeep = 12;
                    list.forEach(function (it, idx) {
                        if (_seen[it.name]) return;
                        var final = (typeof it.total === 'number' ? it.total : it.ms * it.calls);
                        var pct = Math.max(6, Math.min(100, Math.round(final / _max * 100)));
                        var hot = final >= 10 ? '#f66' : (final >= 5 ? '#fc6' : '#7d7');
                        var div = document.createElement('div');
                        div.className = 'kho2-perf__row'; div.setAttribute('data-name', it.name);
                        div.title = it.name + '：累计总耗时 ' + final.toFixed(1) + 'ms（单次均值 ' + it.ms.toFixed(1) + 'ms × ' + it.calls + ' 次调用）';
                        div.innerHTML = '<div class="kho2-perf__name">' + it.name + '</div>'
                            + '<div class="kho2-perf__bar"><i style="width:' + pct + '%;background:' + hot + '"></i></div>'
                            + '<div class="kho2-perf__val" style="color:' + hot + '">' + final.toFixed(1) + 'ms</div>';
                        div.style.opacity = '0';
                        _perfBox.appendChild(div);
                        requestAnimationFrame(function () { div.style.transition = 'opacity .4s'; div.style.opacity = '1'; });
                    });
                    window.__kho2PerfHtml = _perfBox.innerHTML; /* 缓存：面板整体重建时直接复用，避免文字闪没 */
                }
            }
        }
        // syncChats 降频：sig 计算需遍历全部 chatBoxes，60fps 逐帧算浪费，150ms 一次足够灵敏
        _syncTickAcc = (_syncTickAcc || 0) + dt;
        if (_syncTickAcc >= 0.3) { _syncTickAcc = 0; syncChats(); } /* 300ms 一次足够，降低 DOM 扫描频率 */

        /* —— 静止检测（方案A）：只有手拖拽（龙头拖动/球拖拽）= 忙碌，立即退出 CSS 接管；
              持续空闲 4s 后切入 CSS 动画，此后每帧跳过全部巡逻/阻尼/链条物理计算。
              【显示与物理解耦】气泡/身体显示不再算忙碌：静止态下也能弹气泡（坐标由 setCardShow 同步） —— */
        var _busy = dragging || _headHover;
        if (!_busy) {
            for (var _bi = 0; _bi < nodes.length; _bi++) {
                var _bn = nodes[_bi];
                if (_bn._drag) { _busy = true; break; }
            }
        }
        if (_busy) kiteWake();
        else if (!_idleOn && !_idleBlend) { _idleAcc += dt; if (_idleAcc >= IDLE_ENTER_S - FADE_S) kiteBlendStart(); }
        if (_idleBlend) { _idleBlendK = Math.min(1, (t - _idleBlendT0) / FADE_S); root.style.setProperty('--idle-k', _idleBlendK.toFixed(3)); }
        if (_idleOn) {
            /* 静止态：transform 由 CSS keyframes 驱动（合成器线程），JS 每帧零计算 */
            var _pfIdle = window.Perf ? performance.now() : 0;
            if (window.Perf) { Perf.mark('风筝:头部+视口段', _pfIdle); Perf.mark('风筝:链条节点段', _pfIdle); Perf.mark('风筝:tick动画', _perfKiteT0); }
            return;
        }
        // 巡逻幅度：有存档位置→围绕它小幅呼吸；否则默认位置大幅飘荡
        /* 【过渡增强】混合期巡逻幅度 ×(1-k) 渐隐，避免与 CSS kiteHeadIdle 巡逻叠加 */
        var amp = HAS_STORED ? 7 : 45;
        if (_idleBlend) amp *= 1 - _idleBlendK;
        if (!dragging) {
            head.tx = anchor.x + Math.sin(t * 0.55) * amp + Math.sin(t * 0.21) * amp * 0.6;
            head.ty = anchor.y + Math.cos(t * 0.47) * (amp * 0.5) + Math.sin(t * 0.29) * (amp * 0.36);
        }
        /* 帧率无关阻尼：dt 补偿，低 fps 时平移速度与 60fps 一致（fps 加强调研 2026-09-12） */
        var he = (dt * 60 >= 1) ? 0.13 : 0.13 * dt * 60; /* 【提速】近似替代 Math.pow(0.87, dt*60) */
        head.x += (head.tx - head.x) * he;
        head.y += (head.ty - head.y) * he;
        /* 【提速】坐标量化到 0.1px + 字符串缓存：微小抖动不再触发样式写入 */
        /* 【动画增强 2026-09-25】龙头速度向量：低通平滑后用于朝向倾斜 + 链条甩尾（secondary motion）
           — spdRaw 裸值逐帧跳变会让波纹忽强忽弱，_spdSm 一阶低通让能量曲线连续 */
        var hvx = head.x - (head._px || head.x), hvy = head.y - (head._py || head.y);
        var _hvx = (head._vx || 0) + (hvx - (head._vx || 0)) * 0.18;
        var _hvy = (head._vy || 0) + (hvy - (head._vy || 0)) * 0.18;
        head._vx = _hvx; head._vy = _hvy;
        var _sqrt = Math.sqrt, _sin = Math.sin, _cos = Math.cos, _atan2 = Math.atan2; /* 【修复】别名声明提前：下方 1249/1254 在旧声明(1315)之前就用了，var 提升导致 undefined → 每帧崩帧 */
        var hvLen = _sqrt(_hvx * _hvx + _hvy * _hvy) || 1;
        /* 拖动惯性计时：松手后 1s 内残余速度继续驱动甩尾，尾巴不会瞬间僵直 */
        var _motionAt = (hvLen > 0.5) ? t : (head._motionAt || (t - 2));
        /* 【动画增强 2026-09-25】旋转改为速度驱动：静止时回到基础呼吸角，拖动/巡航时朝运动方向倾斜（翼面迎风）
           — 用平滑速度向量，方向突变时角度连续过渡，无跳变 */
        var _bank = (t - _motionAt < 1) ? (_atan2(_hvy, _hvx) * 180 / Math.PI) : 0;
        var _bankAmt = Math.min(1, hvLen / 14) * 10;
        head._bank = ((head._bank || 0) + (_bank - (head._bank || 0)) * 0.12);
        var hrot = ((Math.sin(t * 1.1) * 6 - 4) + head._bank * _bankAmt * 0.06).toFixed(1);
        var hxf = head.x.toFixed(1), hyf = head.y.toFixed(1);
        var htf = 'translate3d(' + hxf + 'px,' + hyf + 'px,0) rotate(' + hrot + 'deg)';
        if (htf !== headEl._tf) { headEl.style.transform = htf; headEl._tf = htf; }
        var _pfHead = window.Perf ? performance.now() : 0;

        var overview = _overviewEl || (_overviewEl = root && root.querySelector('.kite-head-overview'));
        if (overview && overview.isConnected === false) { _overviewEl = overview = null; }
        if (overview && overview.classList.contains('open')) {
            /* 【视口回流优化 2026-09-20】innerWidth/innerHeight 每帧读会强制同步排版（脏布局时整棵
               风筝 DOM 重排，实测单帧 100ms+）。改为缓存 + resize 失效，与 _szW 同一策略 */
            if (_vpW === 0) { _vpW = window.innerWidth; _vpH = window.innerHeight; }
            /* 面板锚定固定锚点且视口/尺寸没变时，定位结果恒定 → 整段跳过（拖拽/悬停贴龙头时才逐帧算） */
            var follow = dragging || _headHover;
            if (!follow && !overview._szDirty && !overview._vpDirty && overview._posDone) { /* 定位短路，下方物理链照常 */ }
            else {
            /* 视口自适应：默认锚定固定锚点（不随龙头巡逻摆动抖动），仅拖拽/悬停龙头时贴住龙头实时位置 */
            var bx = follow ? head.x : anchor.x, by = follow ? head.y : anchor.y;
            /* 【强制回流优化】offsetWidth/offsetHeight 读布局每帧触发 Forced reflow，是视口卡顿主因之一。
               改为缓存尺寸（元素尺寸很少变化），resize 时才重读 */
            var ow, oh;
            if (!overview._szW || overview._szDirty) { ow = overview.offsetWidth; oh = overview.offsetHeight; overview._szW = ow; overview._szH = oh; overview._szDirty = false; }
            else { ow = overview._szW; oh = overview._szH; }
            var pad = 6;
            var lx = bx, ly = by;
            var minL = ow / 2 + pad, maxL = _vpW - ow / 2 - pad;
            lx = Math.min(Math.max(lx, minL), Math.max(minL, maxL));
            /* 【视口自适应修复】不再用固定 180px 阈值硬判断上/下，而是按面板实际高度
               与龙头上下两侧的可用空间动态选择：默认面板在龙头上方；
               上方放不下（by - oh - 24 - pad < pad）且下方有更多空间时改放龙头下方。
               两个分支都把面板完整钳制在视口内（含边距），避免小屏/角落时溢出屏幕。 */
            var spaceAbove = by - pad;                       /* 龙头以上可用高度 */
            var spaceBelow = _vpH - by - pad;  /* 龙头以下可用高度 */
            var wantBelow = (spaceAbove < oh + 24 + pad) && (spaceBelow > spaceAbove);
            /* 注意：CSS 里 .kite-head-overview 带 transform 位移——
               默认态 translate(-50%, calc(-100% - 24px))：实际渲染顶边 = ly - oh - 24、底边 = ly - 24；
               below 态 translate(-50%, 24px)：实际渲染顶边 = ly + 24。钳制必须按渲染位置算 */
            if (wantBelow) {
                /* 面板在龙头下方：渲染顶边贴龙头+24px，渲染底边不越过视口 */
                ly = Math.min(by, _vpH - oh - 24 - pad);
                ly = Math.max(ly, 0);
            } else {
                /* 面板在龙头上方：渲染底边留 24px 间距（即 ly=by），渲染顶边不越出视口；
                   龙头太靠上放不下时整体下压，保证面板完整可见（may 轻微遮龙头，属可接受回退） */
                ly = Math.max(by, pad + oh + 24);
                ly = Math.min(ly, _vpH - pad);
            }
            if (overview._lx !== lx) { overview.style.left = lx + 'px'; overview._lx = lx; }
            if (overview._ly !== ly) { overview.style.top = ly + 'px'; overview._ly = ly; }
            if (overview._below !== wantBelow || overview._below === undefined) { overview.classList.toggle('below', wantBelow); overview._below = wantBelow; }
            overview._posDone = true; overview._vpDirty = false;
            } /* 定位短路块结束 */
        }
        var px = head.x, py = head.y;
        if (window.Perf && _pfHead) Perf.mark('风筝:头部+视口段', _pfHead);
        var _pfNodes = window.Perf ? performance.now() : 0;
        // 龙头速度 → 波纹能量：拖得越快/摇得越猛，链条波纹越大
        /* 【提速】Math 方法提为局部别名 + hypot 换 sqrt：消除每节点每帧的属性查找（perf 优化 2026-09-14） */
        var _sqrt = Math.sqrt, _sin = Math.sin, _cos = Math.cos, _atan2 = Math.atan2;
        var spd = Math.min(24, _sqrt((head.x - (head._px || head.x)) * (head.x - (head._px || head.x)) + (head.y - (head._py || head.y)) * (head.y - (head._py || head.y))));
        /* 摄像机平移（画布视口）不算进波纹能量，否则拖视口时身体节点会抖动 */
        head._px = head.x; head._py = head.y;
        var _nl = nodes.length;
        for (var i = 0; i < _nl; i++) {
            var n = nodes[i];
            var dx = n.x - px, dy = n.y - py;
            var d = _sqrt(dx * dx + dy * dy) || 1;
            var ang = d < 6 ? Math.PI : _atan2(dy, dx);
            var tx = px + _cos(ang) * LINK;
            var ty = py + _sin(ang) * LINK;
            /* 【提速】ease 与波幅系数 (1+i/len) 每帧值恒定 → 预计算缓存在节点上，循环内不再重复算 */
            var ease = n._ease || (n._ease = Math.max(EASE_MIN, EASE_BASE - i * 0.012));
            var wob = n._wob || (n._wob = 1 + i / _nl);
            /* 帧率无关阻尼：ease 按 dt 补偿，低 fps 时跟随/回链速度不衰减 */
            /* 【提速】近似指数衰减替代 Math.pow（每节点每帧省一次 pow）；60fps 基准 */
            var _e = 1 - ease;
            var easeF = 1 - (_e * _e * _e); /* 一阶泰勒近似 exp(ln(_e)*k)，k=dt*60 取整附近误差可忽略 */
            if (dt * 60 < 1) easeF = ease * dt * 60;
            n.x += (tx - n.x) * easeF;
            n.y += (ty - n.y) * easeF;
            // 拖拽中的球：贴住鼠标，不再叠加自摇（否则球在指针周围晃、无法跟手）
            if (n._drag) {
                n.el.style.transform = 'translate3d(' + n.x + 'px,' + n.y + 'px,0)';
                if (n.cardEl && n.cardEl.classList.contains('show')) {
                    n.cardEl.style.left = n.x + 'px';
                    n.cardEl.style.top = n.y + 'px';
                }
                if (n.autoShowUntil && t > n.autoShowUntil) { n.autoShowUntil = 0; if (!n._hover) setCardShow(n, false); }
                px = n.x; py = n.y;
                continue;
            }
            /* 【动画优化】叠加低频阵风调制：两列不同频率正弦相乘，风忽大忽小，摆动不再机械等幅 */
            var _gust = 1 + 0.35 * _sin(t * 0.9) * (0.6 + 0.4 * _sin(t * 0.37 + 1.3));
            /* 【修正】阵风改为调幅不调相：相位与 t 呈纯线性（不含 t·gust'(t) 项），长时间运行不会放大成相位抖动 */
            var phase = t * 2.4 - i * 0.75;
            var sv = _sin(phase), cv = _cos(phase);
            var base = (3 + spd * 0.55) * _gust;
            /* 【动画增强 2026-09-25】链条甩尾：龙头平滑速度沿链条按 0.85^i 衰减反向传递（secondary motion）
               — 拖快时末端滞后甩出，松手后 1s 内残余速度继续驱动，尾巴自然回摆不僵直 */
            var _decay = n._tdecay || (n._tdecay = 0.85 * (0.4 + 0.6 * (i / _nl)));
            var _tailA = n._tailA || 0;
            _tailA += (-_hvx * _decay * 0.35 - _tailA) * 0.15; /* 一阶追踪反向偏移，带阻尼 */
            n._tailA = _tailA;
            var _tailB = n._tailB || 0;
            _tailB += (-_hvy * _decay * 0.35 - _tailB) * 0.15;
            n._tailB = _tailB;
            /* 【过渡增强】混合期 JS 摆幅 ×(1-k) 渐隐，与 CSS 渐显交叉，能量曲线连续无跳变 */
            var _k1 = 1 - (_idleBlendK || 0);
            var sway = (sv * base * wob * (0.75 + 0.25 * _gust) + _tailB) * _k1;
            var rot = (cv * base * 0.7 * (0.75 + 0.25 * _gust) + _tailA * 0.15) * _k1;
            /* 【提速】变换字符串缓存 + 0.1px 量化：数值微变不再重建字符串/写样式 */
            /* 【B2 熔断隔帧】降级期间隔帧写 DOM（物理坐标照常推进，只省字符串构建与样式写入） */
            /* 【B1 视口剔除】节点远离视口（_vpH 已缓存的画布视口，含 120px 余量）时跳过 DOM 写入，
               物理坐标仍推进，回视口时由 0.1px 量化差异自然恢复，无跳变 */
            var _onscreen = n.y > -120 && n.y < _vpH + 120;
            if ((!_skipDom || (i & 1) === _frameParity) && _onscreen) {
                var tf = 'translate3d(' + (n.x + _tailA).toFixed(1) + 'px,' + (n.y + sway).toFixed(1) + 'px,0) rotate(' + (rot + _tailA * 0.15).toFixed(1) + 'deg)';
                if (tf !== n.el._tf) { n.el.style.transform = tf; n.el._tf = tf; }
                // 气泡：定位到节的屏幕坐标，保持水平（不继承节旋转）
                /* 【提速】气泡只在显示时写 left/top，且带单位字符串缓存 */
                if (n.cardEl && n.cardEl.classList.contains('show')) {
                    var cl = n.x + 'px', ct = (n.y + sway) + 'px';
                    if (n.cardEl._cl !== cl) { n.cardEl.style.left = cl; n.cardEl._cl = cl; }
                    if (n.cardEl._ct !== ct) { n.cardEl.style.top = ct; n.cardEl._ct = ct; }
                }
            }
            // 兜底：自动显示到期立即隐藏，保证全局只剩最近一句话
            if (n.autoShowUntil && t > n.autoShowUntil) { n.autoShowUntil = 0; if (!n._hover) setCardShow(n, false); }
            px = n.x; py = n.y;
        }
        if (window.Perf && _pfNodes) Perf.mark('风筝:链条节点段', _pfNodes);
        if (window.Perf) Perf.mark('风筝:tick动画', _perfKiteT0);
    }

    /* ---------- 拖拽龙头：松手停在原位并记住位置（点击换脸） ---------- */
    function bindHead() {
        function down(e) {
            // 概览面板（整体速度/对话统计行）内按下：绝不启动龙头拖拽。
            // 否则 setPointerCapture 会把后续指针事件重定向到龙头，
            // 统计行的 click 永远不会触发，表现为「点 1/2/3/4 无法摄像机直达对话」。
            if (e.target && e.target.closest && e.target.closest('.kite-head-overview')) return;
            if (e.stopPropagation) e.stopPropagation(); // 阻止冒泡：防止拖拽风筝时误触发画布平移
            dragging = true; dragMoved = 0;
            headEl.classList.add('dragging');
            headEl.setPointerCapture && headEl.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
        function move(e) {
            if (!dragging) return;
            dragMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
            head.tx = e.clientX; head.ty = e.clientY;
        }
        function up(e) {
            if (!dragging) return;
            dragging = false;
            headEl.classList.remove('dragging');

            _setOverviewHidden(false);
            if (dragMoved < 6) { // 单击龙头 → 只换一个头像；双击头部才打开语音聊天对话框（见 bindHead dblclick）
                faceIndex = (faceIndex + 1) % faces.length;
                _us.set('zf3d-kite-face', faceIndex);
                var faceEl = headEl.querySelector('.kite-face');
                if (faceEl) faceEl.textContent = faces[faceIndex];
            } else { // 拖拽：把当前位置记为锚点并保存（下限与 loadAnchor 死区阈值一致=120，
                     // 否则存了 40~119 的位置下次启动会被误判无效清掉）
                anchor.x = Math.min(Math.max(head.x, 120), (window.innerWidth || 1280) - 40);
                anchor.y = Math.min(Math.max(head.y, 120), (window.innerHeight || 800) - 40);
                /* 【平滑过渡】松手不再瞬移贴锚点：只更新目标 tx/ty，让巡航阻尼
                   （he=0.13，帧率无关）自然把龙头 ~0.4s 指数收敛吸回新锚点，
                   消除松手瞬间的生硬跳变。回位期间再按住无冲突（dragging 会覆盖 tx/ty）。 */
                head.tx = anchor.x; head.ty = anchor.y;
                HAS_STORED = true;
                saveAnchor();
            }
        }
        headEl.addEventListener('mouseenter', function () {
            _headHover = true;
            // 修复：第一次关闭概览后 overviewClosed 永远为 true，菜单再也不显示。
            // 重新悬停龙头时重置关闭标志，允许菜单再次打开。
            if (overviewClosed) {
                overviewClosed = false;
            }
            /* 【提速】强制立即打开：reset 500ms 限频。否则鼠标刚搭上龙头若恰逢限频窗口，
               updateHeadOverview 直接 return，面板不加 open，表现为"过一会才出现头部菜单" */

            /* 兜底：若悬停瞬间恰逢上一次构建未结束（防重入 return），下一帧重试一次 */
            if (!root.querySelector('.kite-head-overview') ||
                !root.querySelector('.kite-head-overview').classList.contains('open')) {
                requestAnimationFrame(function () { if (_headHover) updateHeadOverview(); });
            }
        });
        headEl.addEventListener('mouseleave', function () {
            _headHover = false;
        });
        // 修复：鼠标离开龙头后若概览面板仍开着，会一直挂在屏幕上（表现为"没搭在龙头上对话框也在"）。
        // 离开龙头即收起；若鼠标移入概览面板本身则保留（面板 hover 期间不收）。
        headEl.addEventListener('mouseleave', function () {
            var ov = root && root.querySelector('.kite-head-overview');
            if (!ov || !ov.classList.contains('open')) return;
            if (ov.matches(':hover')) return; // 悬停在面板上时不收起
            overviewClosed = true;
            ov.classList.remove('open');
        });
        // 双击头部 → 打开/关闭风筝观察员普通聊天对话框（新版，在鼠标位置创建）
        headEl.addEventListener('dblclick', function (e) {
            if (e.stopPropagation) e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
            if (window.KiteObserverChat && typeof window.KiteObserverChat.open === 'function') {
                window.KiteObserverChat.open(e.clientX, e.clientY);
            }
        });
        headEl.addEventListener('pointerdown', function (e) { armPhysics(); down(e); });
        headEl.addEventListener('pointermove', move);
        headEl.addEventListener('pointerup', up);
        headEl.addEventListener('pointercancel', up);
        /* 兜底：任何一次指针结束（含被代理转发过来的 up）都关掉物理闸，
           保证"松手即停"，不会留下持续的巡逻/摆动 */
        window.addEventListener('pointerup', disarmPhysics, true);
        window.addEventListener('pointercancel', disarmPhysics, true);
        window.addEventListener('blur', disarmPhysics, true);
    }

    /* 对话框位于风筝上层时，浏览器不会把重叠区域的事件命中到风筝。
       在捕获阶段按坐标转发风筝拖拽事件，保持视觉层级不变。 */
    function installPointerProxy() {
        var active = null;
        function makeEvent(type, e) {
            try {
                return new PointerEvent(type, e);
            } catch (_) {
                return e;
            }
        }
        function hit(x, y) {
            // 修复：命中半径从 30 收紧到 18。原半径比龙头视觉范围大，
            // 鼠标在龙头旁边没搭上也会被代理转发龙头事件，导致"没搭在头上对话框也出现"。
            if (head && Math.hypot(x - head.x, y - head.y) <= 18) return headEl;
            for (var i = nodes.length - 1; i >= 0; i--) {
                if (Math.hypot(x - nodes[i].x, y - nodes[i].y) <= 28) return nodes[i].el;
            }
            return null;
        }
        function inOverlay(t) {
            // 设置弹窗/模态框打开时，指针位于遮罩上层，禁止向下层转发（否则点设置面板会“穿透”到风筝/对话框）
            // 文件树面板/任务面板等侧边栏同理：面板盖住风筝区域时，点击应命中面板而不是转发给风筝
            return !!(t && t.closest && t.closest('.overlay.show, .settings-modal.show, .kite-modal, #ftPanel, #ftPanelOverlay, #taskPanel, #taskPanelOverlay'));
        }
        function isInteractiveEl(el) {
            // 真实命中的是可交互控件时绝不代理/取消：取消 pointerdown 会连带取消 click，
            // 导致压在风筝龙头/节点下方的按钮（朱峰底层、极简、切换大模型等）全部点不了
            return !!(el && el.closest && el.closest('button, a, select, input, textarea, label, [onclick], [data-act], [role="button"], .model-picker-wrap, .model-picker-btn, .tool-cat-btn, .tool-cat-trigger, .tool-cat-item, .tool-cat-menu, .eng-trigger, .eng-menu, .eng-item, .cfg-btn, .qc-quick-bar, .qc-overlay'));
        }
        // 真实命中的元素是否属于"前景 UI 层"（聊天框/面板/菜单等），而不是画布空白
        // 只有真实命中画布空白时才允许把 pointerdown 代理给风筝（龙头/节点）。
        // 之前只靠几何 hit() 判断，只要菜单坐标与风筝节点/龙头重叠就会吞掉点击（preventDefault 连带取消 click），
        // 表现为「朱峰底层 / 极简 / 大模型」这一排菜单点不开。
        function isForegroundEl(el) {
            if (!el || !el.closest) return false;
            var canvasArea = document.getElementById('canvasArea');
            var canvasContent = document.getElementById('canvasContent');
            if (canvasArea && (el === canvasArea || el === canvasContent)) return false; // 画布空白 → 允许代理
            // 画布内部元素（图片/媒体节点等）也属于画布层：交互控件已在 isInteractiveEl 中提前放行，
            // 这里放行其余画布元素，避免风筝龙头压在画布节点上时无法拖拽
            if (canvasArea && canvasArea.contains(el) && !el.closest('.chatbox, .qc-overlay, .model-picker-wrap, .eng-menu, .tool-cat-menu, .qc-quick-bar')) return false;
            return true; // 其余一切元素（含 body、聊天框、菜单、面板）都视为前景
        }
        document.addEventListener('pointerdown', function (e) {
            if (e.target && e.target.closest && e.target.closest('.kite-dragon')) return;
            if (inOverlay(e.target)) return;
            // 鼠标位置下若真实存在可交互元素（按钮/输入框等），直接放行原生点击，不做风筝转发
            try {
                var realEl = document.elementFromPoint(e.clientX, e.clientY);
                if (isInteractiveEl(realEl)) return;
                if (isForegroundEl(realEl)) return; // 前景 UI（聊天框/菜单/面板）优先，绝不代理给风筝
            } catch (err) {}
            var target = hit(e.clientX, e.clientY);
            if (!target) return;
            active = target;
            armPhysics(); // 代理转发同样算"手拖拽"：打开物理闸，松手后由 window pointerup 关闭
            window.__kiteProxyDrag = true; // 标记：正在拖拽风筝（头/身体），阻止画布空白平移
            if (e.preventDefault) e.preventDefault(); // 抑制后续合成 mousedown，避免画布平移
            if (target === headEl) e.preventDefault(); // 仅拖拽龙头时取消默认行为（防选中），不再吞掉普通按钮的点击
            target.dispatchEvent(makeEvent('pointerdown', e));
        }, true);
        document.addEventListener('pointermove', function (e) {
            if (e.target && e.target.closest && e.target.closest('.kite-dragon')) return;
            if (!active) return;
            // 已在拖拽风筝时，即使移到面板上方也继续跟随，否则风筝会卡在面板边缘
            e.preventDefault();
            active.dispatchEvent(makeEvent('pointermove', e));
        }, true);
        function finish(e) {
            if (!active) return;
            var inside = e.target && e.target.closest && e.target.closest('.kite-dragon');
            if (!inside) active.dispatchEvent(makeEvent(e.type, e));
            active = null;
            window.__kiteProxyDrag = false; // 无论如何都解除画布平移抑制（防止标志残留导致平移永久失效）
        }
        document.addEventListener('pointerup', finish, true);
        document.addEventListener('pointercancel', finish, true);
        // 兜底：窗口失焦/切换标签页时拖拽中断，防止 __kiteProxyDrag 残留导致画布平移永久失效
        window.addEventListener('blur', function () {
            if (active) { try { active.dispatchEvent(makeEvent('pointerup', { clientX: 0, clientY: 0, pointerId: 1, button: 0 })); } catch (err) {} active = null; }
            window.__kiteProxyDrag = false;
        });
    }

    function init() {
        // 防重复初始化：init 被调用两次会导致两个 tick RAF 循环叠加（实测 FPS 掉一半、tick 调用翻倍）
        if (window.__kiteTickStarted) return;
        /* 【极速模式】开启时不启动风筝 RAF 动画循环（不设防重入标记，关急速后可补建） */
        if (window.isTurboMode && window.isTurboMode()) { window.__kiteTurboSkipped = true; return; }
        window.__kiteTickStarted = true;
        root = document.createElement('div');
        root.className = 'kite-dragon';
        root.id = 'zfKiteRoot'; // 对齐 index.html 急速模式的隐藏/恢复逻辑（按 #zfKiteRoot 查找）
        root.innerHTML =
                        '<div class="kite-head" role="button" tabindex="0"><span class="kite-face"></span><div class="kite-head-overview"></div></div>';
        (document.getElementById('canvasArea') || document.body).appendChild(root);
        // 风筝区域与画布的新建对话手势隔离；对话定位由圆圈单击完成。
        root.addEventListener('dblclick', function (e) {
            // 放行龙头自身的 dblclick（双击头部打开语音聊天对话框），其余区域拦截
            if (e.target === headEl || (e.target.closest && e.target.closest('.kite-head'))) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.cancelBubble = true;
        }, true);
        // 风筝身体（头/节）拖拽时绝不平移画布：拦截冒泡到画布的 mousedown
        root.addEventListener('mousedown', function (e) {
            e.stopPropagation();
        });
        headEl = root.querySelector('.kite-head');
        headEl.querySelector('.kite-face').textContent = faces[faceIndex];
        var overview = headEl.querySelector('.kite-head-overview');
        if (overview) root.appendChild(overview); // 脱离头部变换层，面板不随旋转
        bindHead();
        var overview = root.querySelector('.kite-head-overview');
        document.addEventListener('pointerdown', function (e) {
            var insideDragon = e.target.closest && e.target.closest('.kite-dragon');
            if (!insideDragon) {
                hideAllCards();
                if (overview.classList.contains('open')) {
                    overviewClosed = true;
                    overview.classList.remove('open');
                }
                return;
            }
            if (!overview.classList.contains('open')) return;
            if (e.target.closest && (e.target.closest('.kite-head-overview') || e.target.closest('.kite-head'))) return;
            overviewClosed = true;
            overview.classList.remove('open');
        }, true);
        installPointerProxy();
        // 初始锚点：有存档则锚点已在 loadAnchor 中恢复；无存档时用屏幕比例默认位
        if (!HAS_STORED) {
            anchor.x = Math.max(180, innerWidth - 180);
            anchor.y = Math.max(150, Math.min(innerHeight - 150, innerHeight * 0.42));
        }
        head.x = head.tx = anchor.x;
        head.y = head.ty = anchor.y;
        // 🚦 红绿灯联动：启动闸门状态轮询（2s 一次，轻量接口）
        pollGate();
        // 后台标签页不再空转：原 2s 轮询在 document.hidden 时照样打接口，
        // 桌面卡顿期间与 /api/proxy 抢连接，把主线程拖死
        var _gateTimer = setInterval(function () { if (!document.hidden) pollGate(); }, 2000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) pollGate(); });
        /* 【极速模式】供 index.html 切换时停掉闸门轮询（风筝动画由 tick 内部 turbo 检查跳过） */
        window.__kiteTickStop = function () { if (_gateTimer) { clearInterval(_gateTimer); _gateTimer = null; } };
        /* 急速模式关闭后恢复闸门轮询（index.html 调用），面板统计随之恢复 */
        window.__kiteTickResume = function () {
            if (window.isTurboMode && window.isTurboMode()) return;
            /* 关急速后恢复风筝 DOM 显示（急速期间被 html.turbo CSS 隐藏），
               按用户风筝开关的真实状态恢复，不盲目强显 */
            try {
                if (root) {
                    var _kh = _us.get('zf3d-kite-hidden', '0') === '1';
                    root.style.display = _kh ? 'none' : '';
                } else if (window.KiteDragon && window.KiteDragon.init) {
                    window.KiteDragon.init(); // 急速状态下启动时风筝从未初始化：补建
                }
            } catch (e) {}
            if (!_gateTimer) { pollGate(); _gateTimer = setInterval(function () { if (!document.hidden) pollGate(); }, 2000); }
        };
        requestAnimationFrame(tick);
    }

    /* ---------- 风筝系统开关：🪁 按钮切换整个风筝龙的显示/隐藏 ---------- */
    var kiteHidden = _us.get('zf3d-kite-hidden', '0') === '1';
    function applyKiteHidden() {
        if (root) root.style.display = kiteHidden ? 'none' : '';
        var btn = document.getElementById('kiteToggleBtn');
        if (!btn) return;
        btn.classList.toggle('dog-guard-btn--on', !kiteHidden);
        // 指示灯：文字后小灯，绿=开，灰=关
        var dot = btn.querySelector('.tk-dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'tk-dot';
            btn.appendChild(dot);
        }
        dot.classList.toggle('on', !kiteHidden);
        if (!kiteHidden) {
            btn.title = '风筝系统：已开启（画布上显示风筝龙）。点击关闭';
        } else {
            btn.title = '风筝系统：已关闭（隐藏风筝龙）。点击开启';
        }
    }
    function bindKiteToggleBtn() {
        var btn = document.getElementById('kiteToggleBtn');
        if (!btn || btn.dataset.kiteToggleWired) { applyKiteHidden(); return; }
        btn.dataset.kiteToggleWired = '1';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            /* 急速模式下风筝被强制隐藏：先退出急速再切开关，保证点按钮一定能找回风筝 */
            if (window.isTurboMode && window.isTurboMode()) {
                if (window.setTurboMode) window.setTurboMode(false);
                kiteHidden = false;
                _us.set('zf3d-kite-hidden', '0');
                applyKiteHidden();
                return;
            }
            kiteHidden = !kiteHidden;
            _us.set('zf3d-kite-hidden', kiteHidden ? '1' : '0');
            applyKiteHidden();
        });
    }

    /* ---------- 💣 炸弹开关：按钮切换跟踪导弹的发射/停用 ---------- */

    window.KiteDragon = {
        init: init,
        refresh: syncChats,
        tool: showTool,
        /* 物理解耦对外接口：只切身体显隐/手动开关物理，绝不互相牵连 */
        setBodyVisible: setBodyVisible,
        getBodyVisible: function () { return _bodyVisible; },
        armPhysics: armPhysics,
        disarmPhysics: disarmPhysics,
        isPhysicsArmed: function () { return _physicsArmed; }
    };
    window.addEventListener('resize', function () { if (_overviewEl) _overviewEl._szDirty = true; }, { passive: true });
    reloadAnchorWhenReady();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // 绑定 🪁 开关按钮（延迟一点确保 index.html 按钮已存在；并立即应用保存的开关状态）
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { applyKiteHidden(); bindKiteToggleBtn(); });
    else { applyKiteHidden(); bindKiteToggleBtn(); }
})();
