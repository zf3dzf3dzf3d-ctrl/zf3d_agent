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
    var STALL_MS = 3 * 60 * 1000;   // 慢速检测阈值：运行中的对话超过 3 分钟无模型响应 → 红色警报闪烁
    var root, headEl;
    var nodes = [];         // { chatId, chat, el, cardEl, x, y, _hover, autoShowUntil, hint }
    var byId = {};
    var head = { x: 0, y: 0, tx: 0, ty: 0 };
    var anchor = { x: 91, y: 67 };
    var t = 0, lastTs = 0, dragging = false, dragMoved = 0;
    var lastSig = '';
    var popTimer = null;   // 当前气泡的自动隐藏定时器（全局只显示最近一句话）
    var overviewClosed = false;
    var intervalLog = [];   // 全局交互时间戳日志：所有对话每次与模型真实通信的时间点，最近600条
    var lastGlobalActivity = 0;   // 全局最后一次交互时间，用于过期清空统计
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
    function saveAnchor() {
        try { _us.set(STORE_KEY, Math.round(anchor.x) + ',' + Math.round(anchor.y)); } catch (e) {}
    }
    function loadAnchor() {
        try {
            var v = _us.get(STORE_KEY);
            if (v) { var a = v.split(','); if (!isNaN(+a[0]) && !isNaN(+a[1])) { anchor.x = +a[0]; anchor.y = +a[1]; return true; } }
        } catch (e) {}
        return false;
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
        rateBox.textContent = formatMessageRate(node).replace(/^\s+/, '');
    }
    function recordNewMessages(node) {
        // 以真实模型连通次数（chat._apiCalls）计时：循环核心每收到一次大模型响应 +1，
        // 一轮交互 = 一次与模型的真实往返，比"history 条数变化"更准确。
        var chat = node.chat || {};
        var calls = Number(chat._apiCalls || 0);
        if (node._apiCallsSeen === undefined) {
            node._apiCallsSeen = calls;
            return;
        }
        var added = calls - node._apiCallsSeen;
        node._apiCallsSeen = calls;
        if (added <= 0) return;
        var now = Date.now();
        // One timestamp per detected update keeps the reading meaningful when a batch arrives together.
        var prev = node._messageTimes[node._messageTimes.length - 1];
        node._messageTimes.push(now);
        node._messageTimes = node._messageTimes.slice(-6);
        // 全局交互日志：记录每次与模型真实通信的时间点，供龙头整体统计（次/分钟）用
        intervalLog.push(now);
        if (intervalLog.length > 600) intervalLog = intervalLog.slice(-600);
        lastGlobalActivity = now;
        node._lastActive = now;   // 慢速检测：记录最近一次模型响应时间
        if (node._stall) { node._stall = false; node.el.classList.remove('stall'); } // 恢复活动即解除警报
        if (headEl && headEl.matches(':hover')) updateHeadOverview();
    }

    // 过期检测：最后一条时间戳距今超过60秒视为对话已停止，清空计时数据
    var STALE_MS = 60 * 1000;
    function isStale(node) {
        var times = node._messageTimes;
        if (times.length && Date.now() - times[times.length - 1] > STALE_MS) {
            node._messageTimes = [];
            return true;
        }
        return false;
    }

    function formatMessageRate(node) {
        if (isStale(node)) return '';
        var times = node._messageTimes;
        if (times.length < 2) return '';
        var averageSeconds = (times[times.length - 1] - times[0]) / 1000 / (times.length - 1);
        return ' (' + averageSeconds.toFixed(1) + '秒/次)';
    }

    function formatLastSpeed(node) {
        if (isStale(node)) return '暂无速度数据';
        var times = node._messageTimes;
        if (times.length < 2) return '暂无速度数据';
        var seconds = (times[times.length - 1] - times[times.length - 2]) / 1000;
        return '最后速度：' + seconds.toFixed(1) + ' 秒/次';
    }

    function formatHeadRate(node) {
        if (isStale(node)) return '暂无数据';
        var times = node._messageTimes;
        if (times.length < 2) return '暂无数据';
        var seconds = (times[times.length - 1] - times[0]) / 1000 / (times.length - 1);
        return seconds.toFixed(1) + '秒/次';
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

    /* 全局整体速度：统计最近60秒内与模型的真实通信次数 → 平均每次交互的秒数（单值）。
       按真实时间窗口滑动计算，没有通信时自然显示 --，不停留在旧值 */
    function formatGlobalStats() {
        var now = Date.now();
        // 淘汰窗口外的时间戳（含日志整体过期清空）
        if (lastGlobalActivity && now - lastGlobalActivity > STALE_MS) {
            intervalLog = [];
            lastGlobalActivity = 0;
        } else {
            intervalLog = intervalLog.filter(function (ts) { return now - ts <= RATE_WINDOW; });
        }
        // 平均交互间隔 = 窗口首尾时间差 / (次数-1)，不足两次无数据
        if (intervalLog.length < 2) return null;
        var seconds = (intervalLog[intervalLog.length - 1] - intervalLog[0]) / 1000 / (intervalLog.length - 1);
        return { seconds: seconds };
    }

    function updateHeadOverview() {
        if (!headEl || overviewClosed) return;
        var panel = root && root.querySelector('.kite-head-overview');
        if (!panel) return;
        var stats = formatGlobalStats();
        var headHtml = '<div class="kho-title"><span>风筝系统</span><button type="button" class="kho-close" aria-label="关闭">×</button></div>'
            + '<div class="kho-row kho-global-row"><span>整体速度</span><b class="kho-global-total">' + (stats ? stats.seconds.toFixed(1) + '秒/次' : '--') + '</b></div>';
        panel.innerHTML = headHtml;
        panel.classList.add('open');
        nodes.forEach(function (node, index) {
            var row = document.createElement('button');
            row.type = 'button';
            row.className = 'kho-row';
            var st = headStatus(node);
            var stHtml = st ? '<i class="kho-status kho-status--bad">' + st + '</i>' : '';
            row.innerHTML = '<span>' + (index + 1) + ' ' + modelLetter(node.chat) + '</span><b>' + formatHeadRate(node) + stHtml + '</b>';
            row.addEventListener('click', function (e) {
                e.stopPropagation();
                if (window.App && App._focusChatBox) App._focusChatBox(node.chat && node.chat.id);
                else if (window.App && App.activate && node.chat && node.chat.el) App.activate(node.chat.el);
                node.el.classList.add('kite-track');
                setTimeout(function () { node.el.classList.remove('kite-track'); }, 1800);
            });
            panel.appendChild(row);
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
            current._drag = true; current._dragMoved = 0;
            seg.classList.add('dragging');
            seg.setPointerCapture && seg.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        seg.addEventListener('pointermove', function (e) {
            var current = byId[chat.id];
            if (!current || !current._drag) return;
            current._dragMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
            current.x = e.clientX; current.y = e.clientY;   // 球贴住鼠标；松手后由链式约束拉回
        });
        function segUp(e) {
            var current = byId[chat.id];
            if (!current || !current._drag) return;
            current._drag = false;
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
                var nd = { chatId: chat.id, chat: chat, el: seg, cardEl: card, x: p.x, y: p.y, _hover: false, autoShowUntil: 0, hint: '', _drag: false, _dragMoved: 0, _lastStatus: '', _apiCallsSeen: undefined, _messageTimes: [] };
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
        // 隔行换色 + 尾节标记 + 任务状态色
        nodes.forEach(function (n, i) {
            n.el.classList.toggle('alt', i % 2 === 1);
            n.el.classList.toggle('tail', i === nodes.length - 1);
            // —— 模型切换：实时更新球上的模型首字母 ——
            var nl = modelLetter(n.chat);
            var letterEl = n.el.querySelector('.kb-letter');
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

    /* ---------- 工具调用：短暂弹出该节的历史最新一句话（提示用户"AI 正在调用工具"，hint 仍保留供 hover 显示工具名） ---------- */
    function showTool(chat, name) {
        if (!root) return;
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

    /* ---------- 物理链 ---------- */
    function tick(ts) {
        var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
        lastTs = ts;
        t += dt;
        syncChats();

        // 巡航幅度：有存档位置→围绕它小幅呼吸；否则默认位置大幅飘荡
        var amp = HAS_STORED ? 7 : 45;
        if (!dragging) {
            head.tx = anchor.x + Math.sin(t * 0.55) * amp + Math.sin(t * 0.21) * amp * 0.6;
            head.ty = anchor.y + Math.cos(t * 0.47) * (amp * 0.5) + Math.sin(t * 0.29) * (amp * 0.36);
        }
        head.x += (head.tx - head.x) * 0.13;
        head.y += (head.ty - head.y) * 0.13;
        headEl.style.transform = 'translate3d(' + head.x + 'px,' + head.y + 'px,0) rotate(' + (Math.sin(t * 1.1) * 6 - 4) + 'deg)';

        var overview = root && root.querySelector('.kite-head-overview');
        if (overview) {
            overview.style.left = head.x + 'px';
            overview.style.top = head.y + 'px';
            overview.classList.toggle('below', head.y < 180);
        }
        var px = head.x, py = head.y;
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
            var sway = Math.sin(t * 2.4 - i * 0.75) * (dragging ? 11 : 5) * (1 + i / Math.max(1, nodes.length));
            var rot = Math.cos(t * 2.4 - i * 0.75) * (dragging ? 7 : 4);
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

        requestAnimationFrame(tick);
    }

    /* ---------- 拖拽龙头：松手停在原位并记住位置（点击换脸） ---------- */
    function bindHead() {
        function down(e) {
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
            if (dragMoved < 6) { // 点击龙头 → 换一个头像 + 打开语音聊天对话框
                faceIndex = (faceIndex + 1) % faces.length;
                _us.set('zf3d-kite-face', faceIndex);
                var faceEl = headEl.querySelector('.kite-face');
                if (faceEl) faceEl.textContent = faces[faceIndex];
                if (window.KiteVoiceChat && typeof window.KiteVoiceChat.toggle === 'function') {
                    window.KiteVoiceChat.toggle();
                }
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
            if (e.target && e.target.closest && e.target.closest('.kite-dragon')) return;
            if (!active) return;
            active.dispatchEvent(makeEvent(e.type, e));
            active = null;
        }
        document.addEventListener('pointerup', finish, true);
        document.addEventListener('pointercancel', finish, true);
    }

    function init() {
        root = document.createElement('div');
        root.className = 'kite-dragon';
        root.innerHTML =
                        '<div class="kite-head" role="button" tabindex="0"><span class="kite-face"></span><div class="kite-head-overview"></div></div>';
        (document.getElementById('canvasArea') || document.body).appendChild(root);
        // 风筝区域与画布的新建对话手势隔离；对话定位由圆圈单击完成。
        root.addEventListener('dblclick', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.cancelBubble = true;
        }, true);
        headEl = root.querySelector('.kite-head');
        headEl.querySelector('.kite-face').textContent = faces[faceIndex];
        var overview = headEl.querySelector('.kite-head-overview');
        if (overview) root.appendChild(overview); // 脱离头部变换层，面板不随旋转
        bindHead();
        var overview = root.querySelector('.kite-head-overview');
        function closeOverviewButton(e) {
            var close = e.target.closest && e.target.closest('.kho-close');
            if (!close) return;
            e.preventDefault();
            e.stopPropagation();
            overviewClosed = true;
            overview.classList.remove('open');
        }
        overview.addEventListener('pointerdown', closeOverviewButton, true);
        overview.addEventListener('click', closeOverviewButton, true);
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

    window.KiteDragon = { init: init, refresh: syncChats, tool: showTool };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // 绑定 🪁 开关按钮（延迟一点确保 index.html 按钮已存在；并立即应用保存的开关状态）
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { applyKiteHidden(); bindKiteToggleBtn(); });
    else { applyKiteHidden(); bindKiteToggleBtn(); }
})();
