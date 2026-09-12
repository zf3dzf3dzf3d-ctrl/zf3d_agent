/* 风筝龙 v4 —— 会话可视化：只有一个龙头+一条线，拖尾各节 = 一个对话。
   特性：
   - 所有对话提示均为纯背景层（z-index:0 + pointer-events:none），绝不遮挡前景、不拦截点击
   - 悬停/工具调用 → 弹出一句话提示（无左侧 AI 栏、无徽章），全局同时只显示最近一句话（新提示自动顶掉旧提示）
   - 工具调用只显示工具的文字提示（如 🔧 运行命令）
   - 龙头可拖拽到任意角落，位置存入 localStorage，下次恢复 */
(function () {
    var _us = window.UserSettings || { get: function(k, d) { return d; }, set: function() {} };
    var faces = ['🙂', '😎', '🤓', '🧑‍🚀', '🦊', '🐼'];
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
    var root, headEl;
    var nodes = [];         // { chatId, chat, el, cardEl, x, y, _hover, autoShowUntil, hint }
    var byId = {};
    var head = { x: 0, y: 0, tx: 0, ty: 0 };
    var anchor = { x: 91, y: 67 };
    var t = 0, lastTs = 0, dragging = false, dragMoved = 0;
    function _setOverviewHidden(hide){ var r=document.querySelector('.kite-dragon'); if(!r) return; var ov=r.querySelector('.kite-head-overview'); if(ov) ov.style.visibility = hide ? 'hidden' : ''; }
    var lastSig = '';
    var popTimer = null;   // 当前气泡的自动隐藏定时器（全局只显示最近一句话）
    var overviewClosed = false;
    var RATE_WINDOW = 60 * 1000;  // 每分钟统计窗口
    var HAS_STORED = loadAnchor();  // 是否已有用户保存的位置

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
        if (s.indexOf('ark') >= 0 || s.indexOf('volces') >= 0 || s.indexOf('volcano') >= 0) return '火山方舟';
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
            if (v) { var a = String(v).split(','); if (!isNaN(+a[0]) && !isNaN(+a[1])) { anchor.x = +a[0]; anchor.y = +a[1]; clampAnchor(); return true; } }
        } catch (e) {}
        return false;
    }
    /* 窗口尺寸变化时把风筝拉回可见范围 */
    window.addEventListener('resize', function () {
        if (HAS_STORED) { clampAnchor(); saveAnchor(); }
    });
    /* 等服务器设置加载完成后，再恢复一次锚点（服务器值优先于 localStorage 缓存） */
    function reloadAnchorWhenReady() {
        window.addEventListener('user-settings-refreshed', function () {
            if (loadAnchor()) { HAS_STORED = true; }
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
        if (headEl && headEl.matches(':hover')) updateHeadOverview();
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
        var g = chat._gapLog || [];
        if (g.length) {
            var sum = 0; for (var i = 0; i < g.length; i++) sum += g[i].gap;
            return (sum / g.length / 1000).toFixed(1) + '秒/次';
        }
        var gap = Number(chat._lastGapMs) || 0;
        if (gap > 0) return (gap / 1000).toFixed(1) + '秒/次';
        return '暂无数据';   // 只有从未使用过工具（无模型往返）才是暂无数据
    }

    /* 状态诊断：只在异常时返回状态文字（正常返回空）。
       优先级：已失败 > 长期停滞(运行中但超过STALL_MS无响应) > 已结束(成功)不显示 */
    function headStatus(node) {
        var s = (node.chat && node.chat._taskStatus) || '';
        var running = (s === 'pending') || (s === 'running') || (node.chat && node.chat._thinking);
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
        if (pts.length < 2) return null;
        var seconds = (pts[pts.length - 1] - pts[0]) / 1000 / (pts.length - 1);
        return { seconds: seconds };
    }

    var _overviewBuilding = false;
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
                        for (var ci = 0; ci < Math.min(running, 4); ci++) {
                            /* 车在赛道上的前后位置：快车在前，同赛道多车梯次排开，向右开 */
                            var left = 8 + ci * 24;
                            if (left > 72) left = 72 - ci * 8;
                            carsHtml += '<i class="kho-car" style="left:' + left + '%;--car:' + oc + ';animation-duration:' + dur + '"></i>';
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
        var bombOn = _us.get('zf3d-kite-bomb', '1') === '1';
                /* v14 面板重构：头部凸显整体 + 左（各对话速度）右（连接池赛道）分区 */
        var bombOn = _us.get('zf3d-kite-bomb', '1') === '1';
        var gateChips = '';
        if (gateGlobal) gateChips = '<span class="kho2-chip" title="闸门：车道数">🚦 L' + gateGlobal.lanes
                + (gateGlobal.max_lanes && gateGlobal.lanes < gateGlobal.max_lanes ? '/' + gateGlobal.max_lanes : '') + '</span>'
            + '<span class="kho2-chip kho2-chip--g" title="运行中">🟢 ' + gateGlobal.running + '</span>'
            + '<span class="kho2-chip kho2-chip--y" title="排队中">🟠 ' + gateGlobal.queue_len + '</span>'
            + '<span class="kho2-chip kho2-chip--p" title="休整中">🟣 ' + gateGlobal.holding + '</span>';
        panel.innerHTML = '<div class="kho2-head">'
            + '<div class="kho2-head__row">'
            + '<span class="kho2-name">风筝系统</span>'
            + '<span class="kho2-speed ' + spdCls.trim() + '" title="整体速度：最近60秒平均响应速度，绿=快 红=慢">' + (stats ? stats.seconds.toFixed(1) : '--') + '<i>秒/次</i></span>'
            + '<span class="kho2-odo" title="今日总里程：今天所有对话累计执行的工具次数（1次=1km）">' + odoTxt + '<i>km</i></span>'
            + '</div>'
            + '<div class="kho2-head__row kho2-head__row--chips">' + gateChips
            + ''
            + '</div>'
            + '</div>'
            + '<div class="kho2-main">'
            + '<div class="kho2-col kho2-col--chats"><div class="kho2-sec">各对话速度</div><div class="kho2-rows" id="kho2Rows"></div></div>'
            + '<div class="kho2-col kho2-col--lanes"><div class="kho2-sec">连接池赛道</div>' + (laneHtml || '<div class="kho2-empty">暂无连接池数据</div>') + '</div>'
            + '</div>';
        /* 面板内单选开关：切换炸弹开/关（与状态栏按钮同步） */
        var bombOpt = panel.querySelector('#khoBombOpt');
        if (bombOpt) {
            ['pointerdown', 'pointerup', 'dblclick'].forEach(function (t) {
                bombOpt.addEventListener(t, function (ev) { if (ev.stopPropagation) ev.stopPropagation(); }, false);
            });
            bombOpt.addEventListener('change', function (e) {
                e.stopPropagation();
                _us.set('zf3d-kite-bomb', bombOpt.checked ? '1' : '0');
                applyBombBtn();
            });
        }
        panel.classList.add('open');
        /* 总览行序始终按当前 chatBoxes 顺序实时排序，避免编号错乱 */
        function _createSeq(chatId, chatRef) {
            var id = chatId || (chatRef && chatRef.id) || '';
            var m = /(\d+)/.exec(String(id));
            if (m) return parseInt(m[1], 10);
            return 1e9;
        }
        var _sorted = nodes.slice().sort(function (a, b) {
            return _createSeq(a.chatId, a.chat) - _createSeq(b.chatId, b.chat);
        });
        var rowsBox = panel.querySelector('#kho2Rows');
        _sorted.forEach(function (node, index) {
            var row = document.createElement('button');
            row.type = 'button';
            row.className = 'kho-row';
            var st = headStatus(node);
            var stHtml = st ? '<i class="kho-status kho-status--bad">' + st + '</i>' : '';
            var gd = gateDesc(node.chatId);
            var gdEmoji = gd ? (gd.slice(0, gd.indexOf(' ')) + ' ') : '';
            var gInfo = gateMap[node.chatId];
            var ownerTxt = (gInfo ? providerName(gInfo.provider) : '') || modelLetter(node.chat);
            row.innerHTML = '<i class="kho-row__no">' + (index + 1) + '</i><span class="kho-row__name">' + ownerTxt + '</span><b>' + formatHeadRate(node) + '</b>' + stHtml + '<i class="kho-row__light">' + (gdEmoji || '🚦') + '</i>';
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
            });
            (rowsBox || panel).appendChild(row);
        });
    }
    function setCardShow(node, on) {
        if (!node.cardEl) return;
        node.cardEl.classList.toggle('show', !!on);
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
                renderCard(nd, '');
            }
        });
        for (var i = nodes.length - 1; i >= 0; i--) {
            if (!seen[nodes[i].chatId]) {
                nodes[i].el.remove();
                nodes[i].cardEl.remove();
                delete byId[nodes[i].chatId];
                nodes.splice(i, 1);
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
            var running = (s === 'pending') || (s === 'running') || n.chat._thinking;
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
                    }
                }
                // 悬停气泡显示检查提示（不覆盖正在显示的内容）
                if (stalled && n._hover && n.cardEl && !n.cardEl.classList.contains('show')) {
                    renderCard(n, '⚠️ 长时间无响应，请检查此对话');
                    setCardShow(n, true);
                }
            } else if (n._stall) {
                n._stall = false;
                n.el.classList.remove('stall');
            }
            // 状态变化时若龙头概览正开着，实时刷新显示（含长期停滞状态变化）
            var headSig = s + ':' + (n._stall ? '1' : '0');
            if (headEl && headEl.matches(':hover') && !overviewClosed && headSig !== n._lastHeadStatus) {
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
        updateHeadOverview();
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
        /* 💣 炸弹开关（默认关闭，持久化 UserSettings） */
        if (_us.get('zf3d-kite-bomb', '1') !== '1') return;
        /* 🚀 跟踪导弹：从该节风筝身体发射，追踪小狗守卫并命中（带尾焰粒子+爆炸+音效） */
        if (false) { /* 导弹系统已移除：不再发射导弹 */ launchMissile(nd); }
    }

    /* ---------- 🚀 跟踪导弹：龙头 → 目标小狗，命中爆炸 + 音效 ---------- */
    var audioCtx = null;
    function boomSound() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            var ac = audioCtx, now = ac.currentTime;
            /* 发射嗖声：锯齿波扫频上扬 */
            var o = ac.createOscillator(), g = ac.createGain();
            o.type = 'sawtooth'; o.frequency.setValueAtTime(220, now); o.frequency.exponentialRampToValueAtTime(880, now + 0.12);
            g.gain.setValueAtTime(0.05, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            o.connect(g).connect(ac.destination); o.start(now); o.stop(now + 0.3);
            /* 命中爆炸：低频轰 */
            var o2 = ac.createOscillator(), g2 = ac.createGain();
            o2.type = 'triangle'; o2.frequency.setValueAtTime(160, now + 0.85); o2.frequency.exponentialRampToValueAtTime(40, now + 1.15);
            g2.gain.setValueAtTime(0.001, now + 0.85); g2.gain.exponentialRampToValueAtTime(0.1, now + 0.9); g2.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
            o2.connect(g2).connect(ac.destination); o2.start(now + 0.85); o2.stop(now + 1.3);
        } catch (e) {}
    }
    /* ---------- 🚀 对象池：炮弹/尾焰/爆炸粒子复用 DOM 节点，避免频繁创建销毁卡顿 ---------- */
    var MAX_MISSILES = 5;      /* 同屏炮弹上限 5 发 */
    var MISSILE_LIFE = 5;      /* 炮弹生命 5 秒，超时未命中淡出消失 */
    var missileCount = 0;
    var missilePool = [], missileTrailPool = [], boomPool = [];
    function poolGet(pool, cls) {
        var el = pool.pop();
        if (!el) { el = document.createElement('i'); el.className = cls; }
        return el;
    }
    function poolPut(pool, el) {
        if (!el) return;
        el.style.opacity = '0';
        if (el.parentNode) el.parentNode.removeChild(el);
        if (pool.length < 80) pool.push(el);
    }
    function spawnBoom(x, y) {
        for (var i = 0; i < 14; i++) {
            var b = poolGet(boomPool, 'kite-boom');
            if (!b.parentNode) root.appendChild(b);
            var a = Math.random() * Math.PI * 2, dd = 8 + Math.random() * 30;
            b.style.left = x + 'px'; b.style.top = y + 'px';
            b.style.setProperty('--bx', Math.cos(a) * dd + 'px');
            b.style.setProperty('--by', Math.sin(a) * dd + 'px');
            /* 重启 CSS 动画 */
            b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
            b.style.opacity = '';
            setTimeout(function (el) { return function () { poolPut(boomPool, el); }; }(b), 620);
        }
    }
    function launchMissile(nd) {
        if (!nd || !nd.el || !nd.el.isConnected || !headEl) return;
        /* 🎯 发射点：该节风筝球（身体）中心；目标：小狗守卫（在其附近巡逻时才攻击） */
        var nr = nd.el.getBoundingClientRect();
        var sx = nr.left + nr.width / 2, sy = nr.top + nr.height / 2;
        var dog = (window.App && App._dogGuardEl) ? App._dogGuardEl : null;
        var chatPanel = dog && dog.querySelector('.dog-guard-chat');
        var dogVisible = dog && dog.isConnected && (!chatPanel || chatPanel.style.display === 'none');
        var tx, ty, targetEl;
        if (dogVisible) {
            var dr = dog.getBoundingClientRect();
            tx = dr.left + dr.width / 2; ty = dr.top + dr.height / 2;
            targetEl = dog;
        } else {
            tx = nr.left + nr.width / 2; ty = nr.top + nr.height / 2;   // 小狗不在场则原地命中
            targetEl = nd.el;
        }
        /* 🎯 同屏炮弹上限：最多 5 发，满了就不再发射 */
        if (missileCount >= MAX_MISSILES) return;
        missileCount++;
        var m = poolGet(missilePool, 'kite-missile');
        if (!m.parentNode) root.appendChild(m);
        m.style.left = sx + 'px'; m.style.top = sy + 'px';
        m.style.opacity = '1'; m.style.transition = '';
        m.style.transform = 'translate(-50%,-50%)';
        var x = sx, y = sy, vx = 0, vy = 0, life = 0, trailTimer = 0, alive = true;
        function trail() {
            var p = poolGet(missileTrailPool, 'kite-mtrail');
            if (!p.parentNode) root.appendChild(p);
            p.style.left = x + 'px'; p.style.top = y + 'px';
            /* 重启 CSS 动画（对象池复用同一节点时需要重新触发） */
            p.style.animation = 'none'; void p.offsetWidth; p.style.animation = '';
            setTimeout(function () { poolPut(missileTrailPool, p); }, 480);
        }
        function step() {
            if (!alive) return;
            /* 实时追踪小狗守卫当前位置 */
            if (targetEl === dog && dog && dog.isConnected) {
                var drr = dog.getBoundingClientRect();
                tx = drr.left + drr.width / 2; ty = drr.top + drr.height / 2;
            }
            var dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) || 1;
            vx += dx / d * 1400 * 0.016; vy += dy / d * 1400 * 0.016;
            var sp = Math.hypot(vx, vy), maxSp = 620;
            if (sp > maxSp) { vx = vx / sp * maxSp; vy = vy / sp * maxSp; }
            x += vx * 0.016; y += vy * 0.016; life += 0.016;
            var ang = Math.atan2(vy, vx) * 180 / Math.PI - 135;  /* 🚀字形朝右上45°，减135=顺时针多转90°，弹头正对飞行方向 */
            m.style.left = x + 'px'; m.style.top = y + 'px';
            m.style.transform = 'translate(-50%,-50%) rotate(' + ang + 'deg)';
            if (++trailTimer % 2 === 0) trail();
            if (d < 14) { hit(false); return; }
            /* ⏳ 生命 5 秒：超时未命中 → 淡出消失（不计入击中） */
            if (life > MISSILE_LIFE) { hit(true); return; }
            requestAnimationFrame(step);
        }
        function hit(expired) {
            if (!alive) return;
            alive = false; missileCount = Math.max(0, missileCount - 1);
            if (expired) {
                /* 超时消失：淡出后归还对象池，无爆炸 */
                m.style.transition = 'opacity .35s'; m.style.opacity = '0';
                setTimeout(function () { poolPut(missilePool, m); }, 380);
                return;
            }
            m.style.opacity = '0';
            poolPut(missilePool, m);
            spawnBoom(tx, ty); boomSound();
            /* 被命中的小狗抖一下 */
            if (targetEl === dog && dog && dog.isConnected) {
                dog.classList.add('dog-hit');
                setTimeout(function () { dog.classList.remove('dog-hit'); }, 500);
            } else {
                nd.el.classList.add('kite-hit');
                setTimeout(function () { nd.el.classList.remove('kite-hit'); }, 500);
            }
        }
        requestAnimationFrame(step);
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
        if (headEl && headEl.matches(':hover') && !overviewClosed) updateHeadOverview();
    }

    /* ---------- 物理链 ---------- */
    function tick(ts) {
        var _perfKiteT0 = window.Perf ? performance.now() : 0;
        var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
        lastTs = ts;
        t += dt;
        // syncChats 降频：sig 计算需遍历全部 chatBoxes，60fps 逐帧算浪费，150ms 一次足够灵敏
        _syncTickAcc = (_syncTickAcc || 0) + dt;
        if (_syncTickAcc >= 0.15) { _syncTickAcc = 0; syncChats(); }

        // 巡航幅度：有存档位置→围绕它小幅呼吸；否则默认位置大幅飘荡
        var amp = HAS_STORED ? 7 : 45;
        if (!dragging) {
            head.tx = anchor.x + Math.sin(t * 0.55) * amp + Math.sin(t * 0.21) * amp * 0.6;
            head.ty = anchor.y + Math.cos(t * 0.47) * (amp * 0.5) + Math.sin(t * 0.29) * (amp * 0.36);
        }
        head.x += (head.tx - head.x) * 0.13;
        head.y += (head.ty - head.y) * 0.13;
        headEl.style.transform = 'translate3d(' + head.x + 'px,' + head.y + 'px,0) rotate(' + (Math.sin(t * 1.1) * 6 - 4) + 'deg)';

        var overview = _overviewEl || (_overviewEl = root && root.querySelector('.kite-head-overview'));
        if (overview && overview.isConnected === false) _overviewEl = overview = null;
        if (overview && overview.classList.contains('open')) {
            /* 视口自适应：默认锚定固定锚点（不随龙头巡逻摆动抖动），仅拖拽/悬停龙头时贴住龙头实时位置 */
            var follow = dragging || (headEl && headEl.matches(':hover'));
            var bx = follow ? head.x : anchor.x, by = follow ? head.y : anchor.y;
            var ow = overview.offsetWidth, oh = overview.offsetHeight;
            var pad = 6;
            var lx = bx, ly = by;
            var minL = ow / 2 + pad, maxL = window.innerWidth - ow / 2 - pad;
            lx = Math.min(Math.max(lx, minL), Math.max(minL, maxL));
            if (ly < 180) { /* 面板在龙头下方 */ 
                ly = Math.min(Math.max(ly, pad), window.innerHeight - oh - 28 - pad);
            } else {       /* 面板在龙头上方 */
                ly = Math.max(Math.min(ly, window.innerHeight - pad), oh + 24 + pad);
            }
            if (overview._lx !== lx) { overview.style.left = lx + 'px'; overview._lx = lx; }
            if (overview._ly !== ly) { overview.style.top = ly + 'px'; overview._ly = ly; }
            overview.classList.toggle('below', ly !== by || by < 180);
        }
        var px = head.x, py = head.y;
        // 龙头速度 → 波纹能量：拖得越快/摇得越猛，链条波纹越大
        var spd = Math.min(24, Math.hypot(head.x - (head._px || head.x), head.y - (head._py || head.y)));
        // 摄像机平移（画布视口）不算进波纹能量，否则拖视口时身体节点会抖动
        head._px = head.x; head._py = head.y;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var dx = n.x - px, dy = n.y - py;
            var d = Math.sqrt(dx * dx + dy * dy) || 1;
            var ang = d < 6 ? Math.PI : Math.atan2(dy, dx);
            var tx = px + Math.cos(ang) * LINK;
            var ty = py + Math.sin(ang) * LINK;
            var ease = EASE_BASE - i * 0.012; if (ease < EASE_MIN) ease = EASE_MIN;
            n.x += (tx - n.x) * ease;
            n.y += (ty - n.y) * ease;
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
            // 波纹幅度随龙头/链条运动速度增大：静止时只有轻微呼吸（无锯齿感），
            // 拖动/摇晃时波纹沿链条自然传导，越靠尾部越明显
            var base = 3 + spd * 0.55;
            var sway = Math.sin(t * 2.4 - i * 0.75) * base * (1 + i / Math.max(1, nodes.length));
            var rot = Math.cos(t * 2.4 - i * 0.75) * base * 0.7;
            n.el.style.transform = 'translate3d(' + n.x + 'px,' + (n.y + sway) + 'px,0) rotate(' + rot + 'deg)';
            // 气泡：定位到节的屏幕坐标，保持水平（不继承节旋转）
            if (n.cardEl && n.cardEl.classList.contains('show')) {
                n.cardEl.style.left = n.x + 'px';
                n.cardEl.style.top = (n.y + sway) + 'px';
            }
            // 兜底：自动显示到期立即隐藏，保证全局只剩最近一句话
            if (n.autoShowUntil && t > n.autoShowUntil) { n.autoShowUntil = 0; if (!n._hover) setCardShow(n, false); }
            px = n.x; py = n.y;
        }
        if (window.Perf) Perf.mark('风筝:tick动画', _perfKiteT0);

        requestAnimationFrame(tick);
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
            } else { // 拖拽：把当前位置记为锚点并保存
                anchor.x = head.x; anchor.y = head.y;
                HAS_STORED = true;
                saveAnchor();
            }
        }
        headEl.addEventListener('mouseenter', function () {
            overviewClosed = false;
            updateHeadOverview();
        });
        // 双击头部 → 打开/关闭语音聊天对话框
        headEl.addEventListener('dblclick', function (e) {
            if (e.stopPropagation) e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
            if (window.KiteVoiceChat && typeof window.KiteVoiceChat.toggle === 'function') {
                window.KiteVoiceChat.toggle();
            }
        });
        headEl.addEventListener('pointerdown', down);
        headEl.addEventListener('pointermove', move);
        headEl.addEventListener('pointerup', up);
        headEl.addEventListener('pointercancel', up);
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
            if (head && Math.hypot(x - head.x, y - head.y) <= 30) return headEl;
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
        root = document.createElement('div');
        root.className = 'kite-dragon';
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
        setInterval(pollGate, 2000);
        requestAnimationFrame(tick);
    }

    /* ---------- 风筝系统开关：🪁 按钮切换整个风筝龙的显示/隐藏 ---------- */
    var kiteHidden = _us.get('zf3d-kite-hidden', '0') === '1';
    function applyKiteHidden() {
        if (root) root.style.display = kiteHidden ? 'none' : '';
        var btn = document.getElementById('kiteToggleBtn');
        if (!btn) return;
        btn.classList.toggle('dog-guard-btn--on', !kiteHidden);
        // 与小狗守卫一致的"开/关"角标
        var badge = btn.querySelector('.dog-guard-state-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dog-guard-state-badge';
            btn.appendChild(badge);
        }
        if (!kiteHidden) {
            badge.textContent = '开';
            badge.classList.add('dog-guard-state-badge--on');
            badge.classList.remove('dog-guard-state-badge--off');
            btn.title = '风筝系统：已开启（画布上显示风筝龙）。点击关闭';
        } else {
            badge.textContent = '关';
            badge.classList.add('dog-guard-state-badge--off');
            badge.classList.remove('dog-guard-state-badge--on');
            btn.title = '风筝系统：已关闭（隐藏风筝龙）。点击开启';
        }
    }
    function bindKiteToggleBtn() {
        var btn = document.getElementById('kiteToggleBtn');
        if (!btn || btn.dataset.kiteToggleWired) { applyKiteHidden(); return; }
        btn.dataset.kiteToggleWired = '1';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            kiteHidden = !kiteHidden;
            _us.set('zf3d-kite-hidden', kiteHidden ? '1' : '0');
            applyKiteHidden();
        });
    }

    /* ---------- 💣 炸弹开关：按钮切换跟踪导弹的发射/停用 ---------- */
    function applyBombBtn() {
        var on = _us.get('zf3d-kite-bomb', '1') === '1';
        var btn = document.getElementById('kiteBombBtn');
        if (btn) {
            btn.classList.toggle('dog-guard-btn--on', on);
            btn.title = on ? '炸弹开关：已开启（风筝身体发射跟踪导弹攻击小狗守卫）。点击关闭'
                           : '炸弹开关：已关闭。点击开启';
        }
        /* 龙头概览面板里的单选开关同步 */
        var opt = root && root.querySelector('#khoBombOpt');
        if (opt) opt.checked = on;
    }
    function bindBombBtn() {
        var btn = document.getElementById('kiteBombBtn');
        if (btn && !btn.dataset.kiteBombWired) {
            btn.dataset.kiteBombWired = '1';
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var on = _us.get('zf3d-kite-bomb', '1') === '1';
                _us.set('zf3d-kite-bomb', on ? '0' : '1');
                applyBombBtn();
            });
        }
        applyBombBtn();
    }

    window.KiteDragon = { init: init, refresh: syncChats, tool: showTool };
    reloadAnchorWhenReady();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // 绑定 🪁 开关按钮（延迟一点确保 index.html 按钮已存在；并立即应用保存的开关状态）
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { applyKiteHidden(); bindKiteToggleBtn(); applyBombBtn(); bindBombBtn(); });
    else { applyKiteHidden(); bindKiteToggleBtn(); applyBombBtn(); bindBombBtn(); }
})();
