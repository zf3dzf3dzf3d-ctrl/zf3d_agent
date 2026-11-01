/* =====================================================================
 * zf-empty-tips.js — 舷窗空态轮换提示词引擎（v1）
 * 职责：54 条主标语（9 类×6 条：功能引导/创意灵感/陪伴语气/能力展示/趣味人格/审核督导/策划蓝图/总结收官/多语种彩蛋）+ 17 条快捷 chip 池 + 分层随机抽签
 *      + sessionStorage 最近 3 条去重 + 纯 CSS 动画样式注入
 * 全局导出：window.ZFEmptyTips.pick() / .renderInto(el)
 * 依赖：零依赖（可在任意模式/页面安全调用）
 * 声线规范（A·雅致克制「舷窗管家」）：①口吻低声克制，幽默藏在字里不喊口号；
 *      ②每条 ≤18 字，不用语气词（吧/哦/啦/呢）；③emoji 每条 ≤1，可省；
 *      ④动词开头优先，画面感优先于形容词堆砌。
 * ===================================================================== */
(function () {
    'use strict';

    /* ---------- 1. 主标语词池：5 类 × 6 条（每条 ≤22 字，全屏层宽度充足） ---------- */
    var MAIN_POOL = [
        /* 功能引导型（A 风格试贴样稿：雅致克制舷窗管家） */
        ['双击画布空白处，建一个新对话',
         '右键空白处，还有别的开门方式',
         '左下角工具箱，收着全部家什',
         '滚轮推拉之间，画布任你巡游',
         '每个对话框可选模型，按需取用',
         '任务挂上风筝队列，转身即走'],
        /* 创意灵感型 */
        ['灵感是流星，接住它就从一句 prompt 开始',
         '空白画布 = 宇宙原点，一切从这里爆炸',
         '今天想造点什么？故事、代码还是一艘飞船',
         '每个伟大项目，都始于一句不着调的念头',
         '把脑内的星云，拖拽成看得见的节点',
         '空舱不是空无，是尚未书写的星图'],
        /* 陪伴语气型 */
        [{ g: 5, t: '晨光落在舷窗上，新的一天从一句问候开始' },
         { g: 12, t: '午后的轨道很平稳，适合把想法变成现实' },
         { g: 18, t: '暮色渐浓，正好点灯续航，再推进一段旅程' },
         { g: 22, t: '夜深了，星河作伴，灵感正在靠站' },
         { g: 2, t: '凌晨的宇宙最安静，适合安心做点大事' },
         '舱温恒定、氧气充足，只等你落座启程'],
        /* 能力展示型 */
        ['能写代码、能画画、能查网页，快来使唤',
         'AI 蜂群模式：多智能体协作干活',
         '上传文件即读即析，知识不过夜',
         '定时任务已就绪，挂机也能产出 ⏰',
         '游戏引擎、浏览器、剪辑台，全舱装配',
         '长记忆随身携带，越聊越懂你'],
        /* 趣味人格型 */
        ['观景舱空着呢…本 AI 已把咖啡续上',
         '检测到船员失踪，请点击下方登舰',
         '雷达无信号，但本舱坚信你会回来',
         '警告：闲置过久的舷窗会长出藤蔓',
         '太空很冷，新对话很暖，选一个？',
         '外星人都开始用 AI 了，你还在观望'],
        /* 审核督导型：任务交付前的质检视角 */
        ['交付前让审核员过目，双保险更稳',
         '双审交叉把关，漏洞无处可藏',
         '审核员已就位：标准、红线、细节全查',
         '先自查再交付，审核报告说服自己',
         '一个审核看质量，一个审核挑毛病',
         '验收清单逐条过，合格才算真完成'],
        /* 策划蓝图型：动手前的规划视角 */
        ['大工程先画蓝图，策划帮你拆步骤',
         '两个策划对碰，方案 A/B 谁更妙？',
         '目标 → 步骤 → 验收，策划三件套备好',
         '先谋后动：让策划把需求掰开揉碎',
         '路线图在手，长任务也不慌',
         '策划一句话：想清楚再动手，返工少一半'],
        /* 总结收官型：收尾沉淀视角 */
        ['任务收官，总结帮你提炼成干货',
         '一段总结，胜过十屏聊天记录',
         '让 AI 把结论、改动、文件一次理清',
         '经验沉淀进记录，下次开局即巅峰',
         '收尾前先复盘，总结官已提笔',
         '今天做的事，值得一份漂亮的小结'],
        /* 多语种彩蛋型：20 种语言变体，全球船员问候 */
        ['Double-click the canvas to launch a new chat',
         '新しい対話で、物語を始めよう',
         '새 대화로 우주 항해를 시작하세요',
         'Créez une conversation, lancez-vous !',
         'Ein Doppelklick, ein neuer Anfang',
         'Doble clic y nace una nueva idea',
         'Двойной клик — и начинается диалог',
         'Doppio clic e la avventura ha inizio',
         'Um clique, uma nova jornada começa',
         '双击一下，开个新对话啦（粤语味）地道啲嚟先好玩',
         'از شروع کن، تازه شروع کن',
         'ابدأ محادثة جديدة الآن',
         'Yeni bir sohbetle başlayalım mı?',
         'Bắt đầu cuộc trò chuyện mới nào',
         'เริ่มบทสนทนาใหม่กันเลย',
         'Inicie uma conversa e decole',
         'Nueva conversación, nuevas estrellas',
         'Type. Create. Conquer.',
         '任重道遠，起於足下 —— 何不始於一問',
         'Nova colloquium incipe, astra pete']
    ];

    /* ---------- 2. 快捷 chip 池（17 条，点击即弹出创建面板） ---------- */
    var CHIP_POOL = [
        '写一篇科幻短篇', '调试一段代码', '生成一张概念图',
        '整理今日待办', '翻译一段外文', '拟几个候选名',
        '整理一份周报', '拆解一个新概念', '把数据讲成故事',
        '搭一个自动化脚本', '规划一场旅行', '闲聊一刻',
        /* 审核×2 策划×2 总结×1（按任务工作流配比扩充） */
        '审核一份方案', '点评一段代码',
        '策划一个项目计划', '把需求拆成步骤',
        '总结对话要点'
    ];

    /* ---------- 3. 分层随机器：先抽类再抽条 + 最近 3 条去重 ---------- */
    var HIST_KEY = 'zfEmptyTipsHist';
    function _hist() {
        try { return JSON.parse(sessionStorage.getItem(HIST_KEY)) || []; }
        catch (e) { return []; }
    }
    function _pushHist(t) {
        try {
            var h = _hist(); h.push(t);
            while (h.length > 3) h.shift();
            sessionStorage.setItem(HIST_KEY, JSON.stringify(h));
        } catch (e) { /* 隐私模式等：静默降级为不去重 */ }
    }
    function _pickFrom(arr, hist) {
        /* 从候选中选出不在 hist 里的随机一条；全被排除时退化为纯随机 */
        var fresh = arr.filter(function (x) { return hist.indexOf(x) === -1; });
        var pool = fresh.length ? fresh : arr;
        return pool[Math.floor(Math.random() * pool.length)];
    }
    /* v2 极简：时段问候前缀已移除（一句话一个按钮，避免冗余） */
    function pick() {
        var hist = _hist();
        /* 类分层：主随机类，陪伴类条目可能带时段问候前缀 */
        var ci = Math.floor(Math.random() * MAIN_POOL.length);
        var raw = _pickFrom(MAIN_POOL[ci].map(function (x) {
            return typeof x === 'string' ? x : x.t;
        }), hist);
        var main = raw;
        /* v2 极简：一句话 + 一个按钮，不再拼接时段问候前缀（避免冗余） */
        /* chip：只抽 1 个按钮，避免一排快捷键堆成乱 */
        var chips = [], pool = CHIP_POOL.slice(), guard = 0;
        while (chips.length < 1 && pool.length && guard++ < 50) {
            var c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
            if (c !== main && chips.indexOf(c) === -1) chips.push(c);
        }
        _pushHist(main);
        return { main: main, chips: chips, category: ci };
    }

    /* ---------- 4. 动画样式注入（纯 CSS，transform/opacity 合成层） ---------- */
    var styleInjected = false;
    function ensureStyle() {
        if (styleInjected) return;
        styleInjected = true;
        var css = ''
            /* 主标语逐字上浮：由 JS 拆 span.zfet-ch，inline-block 才能 transform */
            + '.zfet-root .zfet-main{display:block;text-align:center;font-size:17px;font-weight:600;letter-spacing:.5px;color:#e8f4ff;text-shadow:0 1px 8px rgba(0,40,80,.5);}'
            + '.zfet-root .zfet-ch{display:inline-block;opacity:0;transform:translateY(8px);'
            +   'animation:zfetRise .5s cubic-bezier(.22,1,.36,1) forwards;}'
            + '@keyframes zfetRise{to{opacity:1;transform:translateY(0);}}'
            /* 光标闪烁 */
            + '.zfet-root .zfet-cursor{display:inline-block;opacity:1;margin-left:2px;'
            +   'animation:zfetBlink 1s steps(1) infinite;}'
            + '@keyframes zfetBlink{50%{opacity:0;}}'
            /* chip 依次弹出 */
            + '.zfet-root .zfet-chips{margin-top:8px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;}'
            + '.zfet-root .zfet-chip{pointer-events:auto;cursor:pointer;font-size:14px;line-height:1.4;'
            +   'padding:8px 18px;border-radius:18px;border:1px solid rgba(120,220,255,.35);'
            +   'color:#9fdcff;background:rgba(20,40,60,.55);opacity:0;transform:scale(.8);'
            +   'animation:zfetPop .35s cubic-bezier(.34,1.56,.64,1) forwards;'
            +   'transition:background .15s,border-color .15s;}'
            + '.zfet-root .zfet-chip:hover{background:rgba(60,120,160,.7);border-color:rgba(160,230,255,.7);}'
            + '@keyframes zfetPop{to{opacity:1;transform:scale(1);}}'
            /* 呼吸光环：同心圆，不超圆界 */
            + '.zfet-root.zfet-on::before{content:"";position:absolute;left:50%;top:50%;width:420px;height:420px;'
            +   'transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;'
            +   'background:radial-gradient(circle,rgba(90,180,255,.10) 0%,rgba(90,180,255,0) 65%);'
            +   'animation:zfetHalo 8s ease-in-out infinite;}'
            + '@keyframes zfetHalo{0%,100%{opacity:.5;}50%{opacity:1;}}';
        var st = document.createElement('style');
        st.id = 'zfet-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    /* ---------- 5. 渲染：拆字 + chip + 事件 ---------- */
    function renderInto(el, onChipClick) {
        if (!el) return null;
        ensureStyle();
        var pickRes = pick();
        var mainEl = document.createElement('span');
        mainEl.className = 'zfet-main';
        /* 拆字（保留 emoji 代理对完整）：仅显示瞬间拆一次 */
        var chars = Array.from(pickRes.main);
        chars.forEach(function (c, i) {
            var s = document.createElement('span');
            s.className = 'zfet-ch';
            s.textContent = c;
            s.style.animationDelay = (i * 0.04) + 's';
            mainEl.appendChild(s);
        });
        var cur = document.createElement('span');
        cur.className = 'zfet-cursor';
        cur.textContent = '▍';
        cur.style.animationDelay = (chars.length * 0.04 + 0.3) + 's';
        mainEl.appendChild(cur);

        el.innerHTML = '';
        el.appendChild(mainEl);
        el.classList.add('zfet-on');
        /* chip 行 */
        if (pickRes.chips.length) {
            var wrap = document.createElement('span');
            wrap.className = 'zfet-chips';
            pickRes.chips.forEach(function (txt, i) {
                var chip = document.createElement('span');
                chip.className = 'zfet-chip';
                chip.textContent = txt;
                chip.style.animationDelay = (0.35 + i * 0.12) + 's';
                /* 拦截拖拽/双击冒泡：chip 点击即弹出创建面板，不触发舷窗拖动 */
                chip.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
                chip.addEventListener('dblclick', function (e) { e.stopPropagation(); });
                chip.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (typeof onChipClick === 'function') onChipClick(txt, e);
                });
                wrap.appendChild(chip);
            });
            el.appendChild(wrap);
        }
        return pickRes;
    }

    /* ---------- 6. 导出 ---------- */
    window.ZFEmptyTips = {
        pick: pick,
        renderInto: renderInto,
        ensureStyle: ensureStyle,
        pools: { main: MAIN_POOL, chips: CHIP_POOL }
    };
})();
