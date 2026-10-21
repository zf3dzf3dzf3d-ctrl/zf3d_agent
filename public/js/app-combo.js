/* ============================================================
 * app-combo.js —— 鬼泣暴击系统（Devil May Cry Style Crit System）
 * 每次 AI 工具调用 = 一次暴击打击；短时间密集调用累积暴击连击数，
 * 左下角爆裂式徽章跳动 +N，评级 D→C→B→A→S→SS→SSS，
 * 超过时间窗口连击断裂，点击徽章查看本场战绩。
 *
 * v3 视觉重做（冲击力版）：
 *   - 无背景卡片：只有发光的数字/评级，纯透明底
 *   - 无连击时完全不可见（opacity:0 + visibility:hidden）
 *   - 每次出现都带入场动画；每次命中都有：
 *     冲击波圆环 + 放射火花 + 径向闪光 + 数字爆弹 + 全屏震颤
 *   - 评级升级时追加更大震颤与双环爆发
 *   - 断连时炸裂收缩淡出，彻底隐藏
 * 纯前端，热更新即生效。
 * ============================================================ */
(function () {
    'use strict';
    if (window.__zfComboLoaded) return;
    window.__zfComboLoaded = true;

    var COMBO_WINDOW = 8000;          // 连击时间窗口（毫秒）
    var GRADES = [                    // 评级档位：[最小连击数, 名称, 颜色]
        [100, 'SSS', '#ffd700'],
        [50,  'SS',  '#ff4500'],
        [35,  'S',   '#ff6400'],
        [20,  'A',   '#ff1493'],
        [10,  'B',   '#8a2be2'],
        [5,   'C',   '#1e90ff'],
        [2,   'D',   '#9aa0a6']
    ];

    var combo = 0;
    var maxCombo = 0;
    var sessionHits = 0;              // 本场（当前对话）总打击数
    var toolCount = {};               // 本场各工具调用统计
    var lastHitTime = 0;
    var breakTimer = null;
    var hideTimer = null;
    var muted = false;
    var enabled = true;               // 连击总开关（风筝面板控制）
    var lastGrade = null;             // 上一次评级名（用于判定升级）
    var pos = null;                   // 徽章拖拽位置 {left, top}（持久化，重启后还原）

    try { enabled = localStorage.getItem('zf_combo_enabled') !== '0'; } catch (e) {}
    try { pos = JSON.parse(localStorage.getItem('zf_combo_pos') || 'null'); } catch (e) { pos = null; }

    /* ---------- 服务端 JSON 持久化（private/用户设置/user_preferences.json）
       localStorage 做本地快速缓存，服务端 JSON 做跨浏览器/跨设备持久层 ---------- */
    var _cloudSyncTimer = null;
    function cloudSaveCombo() {
        clearTimeout(_cloudSyncTimer);
        _cloudSyncTimer = setTimeout(function () {
            try {
                fetch('/api/user-preferences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preferences: { combo: { enabled: enabled, pos: pos } } })
                }).catch(function () {});
            } catch (e) {}
        }, 400);  // 防抖：拖拽/开关 400ms 静止后才落盘
    }
    (function cloudLoadCombo() {
        try {
            fetch('/api/user-preferences').then(function (r) { return r.json(); }).then(function (j) {
                var c = j && j.preferences && j.preferences.combo;
                if (!c) return;
                if (typeof c.enabled === 'boolean') {
                    enabled = c.enabled;
                    try { localStorage.setItem('zf_combo_enabled', enabled ? '1' : '0'); } catch (e) {}
                    if (!enabled && typeof badge !== 'undefined' && badge && badge.parentNode) {
                        // 服务端记录为关闭：立即收起徽章，避免"数据关了徽章还亮"的瞬间不一致
                        badge.classList.remove('zf-combo--on');
                        badge.classList.add('zf-combo--off');
                    }
                }
                if (c.pos && typeof c.pos.left === 'number') {
                    pos = c.pos;
                    try { localStorage.setItem('zf_combo_pos', JSON.stringify(pos)); } catch (e) {}
                    applyPos(document.getElementById('zf-combo-badge'));  // 异步回来后补应用一次
                }
            }).catch(function () {});
        } catch (e) {}
    })();

    /* ---------- 位置记忆：夹紧到视口内并写回 localStorage + 服务端 JSON ---------- */
    function clampPos(p) {
        if (!p || typeof p.left !== 'number' || typeof p.top !== 'number') return null;
        return {
            left: Math.max(4, Math.min(p.left, window.innerWidth - 60)),
            top: Math.max(4, Math.min(p.top, window.innerHeight - 60))
        };
    }
    function savePos() {
        try { localStorage.setItem('zf_combo_pos', JSON.stringify(pos)); } catch (err) {}
        cloudSaveCombo();
    }
    function applyPos(el) {
        var p = clampPos(pos);
        if (!p || !el) return false;
        el.style.left = p.left + 'px';
        el.style.top = p.top + 'px';
        el.style.bottom = 'auto';
        return true;
    }
    window.addEventListener('resize', function () {
        pos = clampPos(pos);
        if (pos) { applyPos(document.getElementById('zf-combo-badge')); savePos(); }
    });

    /* ---------- 持久化（按 chatId 存最高连击/总次数） ---------- */
    function loadStore() {
        try { return JSON.parse(localStorage.getItem('zf_combo_stats') || '{}'); }
        catch (e) { return {}; }
    }
    function recordHit() {
        try {
            var s = loadStore();
            var id = getCurrentChatId();
            if (!id) return;
            if (!s[id]) s[id] = { max: 0, total: 0 };
            s[id].total += 1;
            if (combo > s[id].max) s[id].max = combo;
            localStorage.setItem('zf_combo_stats', JSON.stringify(s));
        } catch (e) {}
    }
    function getCurrentChatId() {
        try {
            if (window.Store && Store.getChats) {
                var chats = Store.getChats();
                if (window.App && App.getCurrentChatId) return App.getCurrentChatId();
            }
        } catch (e) {}
        try { return (window.currentChatId) || null; } catch (e) { return null; }
    }

    /* ---------- 评级 ---------- */
    function gradeOf(n) {
        if (n < 2) return null;
        for (var i = 0; i < GRADES.length; i++) if (n >= GRADES[i][0]) return GRADES[i];
        return null;
    }

    /* ---------- UI ---------- */
    var badge = null;
    var panel = null;

    function ensureBadge() {
        if (badge && badge.parentNode) return badge;
        badge = document.createElement('div');
        badge.id = 'zf-combo-badge';
        badge.innerHTML =
            '<div class="zf-combo__stage">' +
                '<div class="zf-combo__flash"></div>' +
                '<div class="zf-combo__num"><span class="zf-combo__x">×</span><span class="zf-combo__count">0</span><div class="zf-combo__grade"></div></div>' +
            '</div>';
        document.body.appendChild(badge);
        /* 应用拖拽记忆位置（每次创建/重建都还原，重启后仍有效） */
        applyPos(badge);
        /* 拖拽：按住徽章可拖到任意位置（与点击展开面板区分：移动超过 6px 视为拖拽） */
        var dragStart = null;
        badge.addEventListener('pointerdown', function (e) {
            dragStart = { x: e.clientX, y: e.clientY, l: badge.offsetLeft, t: badge.offsetTop, moved: false };
            try { badge.setPointerCapture(e.pointerId); } catch (err) {}
        });
        badge.addEventListener('pointermove', function (e) {
            if (!dragStart) return;
            var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
            if (!dragStart.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
            dragStart.moved = true;
            badge.style.pointerEvents = 'auto';
            var nl = Math.max(4, Math.min(dragStart.l + dx, window.innerWidth - 60));
            var nt = Math.max(4, Math.min(dragStart.t + dy, window.innerHeight - 60));
            badge.style.left = nl + 'px';
            badge.style.top = nt + 'px';
            badge.style.bottom = 'auto';
            pos = { left: nl, top: nt };
        });
        badge.addEventListener('pointerup', function (e) {
            if (dragStart && dragStart.moved) {
                savePos();
                dragStart.moved = false;
                dragStart._suppressClick = true;
                setTimeout(function () { dragStart = null; }, 0);
                return;
            }
            dragStart = null;
        });
        /* 展开统计面板（拖拽后不触发） */
        badge.addEventListener('click', function () {
            if (dragStart && dragStart._suppressClick) return;
            if (!enabled) return;
            if (panel && panel.parentNode) { closePanel(); return; }
            openPanel();
        });
        injectCss();
        return badge;
    }

    function injectCss() {
        if (document.getElementById('zf-combo-css')) return;
        var st = document.createElement('style');
        st.id = 'zf-combo-css';
        st.textContent = [
            /* 徽章：无背景、无边框、平时完全透明不可见 */
            '#zf-combo-badge{position:fixed;left:26px;bottom:196px;z-index:9990;',
            '  display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;',
            '  background:none;border:none;padding:0;pointer-events:none;',
            '  opacity:0;visibility:hidden;transform:scale(.5);filter:blur(6px);',
            '  transition:opacity .25s ease,transform .3s cubic-bezier(.16,1.5,.4,1),filter .25s ease,visibility 0s .3s;}',
            '#zf-combo-badge.zf-combo--on{opacity:1;visibility:visible;transform:scale(1);filter:blur(0);pointer-events:auto;',
            '  transition:opacity .12s ease,transform .28s cubic-bezier(.16,1.8,.3,1),filter .18s ease;}',
            '#zf-combo-badge.zf-combo--off{opacity:0;visibility:hidden;transform:scale(.4) rotate(-6deg);filter:blur(8px);pointer-events:none;}',
            '.zf-combo__stage{position:relative;display:flex;align-items:center;justify-content:center;}',
            /* 数字：重发光 + 爆弹动画 */
            '.zf-combo__num{position:relative;z-index:2;font-weight:900;font-size:44px;line-height:1;color:#fff;',
            '  font-family:Arial Black,Arial,sans-serif;letter-spacing:-1px;',
            '  text-shadow:0 0 10px rgba(255,255,255,.85),0 0 26px var(--zc-glow,rgba(255,120,0,.9)),0 0 54px var(--zc-glow,rgba(255,120,0,.6));}',
            '.zf-combo__x{font-size:24px;opacity:.75;margin-right:1px;vertical-align:8px;}',
            '.zf-combo__num.zf-zc-pop{animation:zfZcPop .42s cubic-bezier(.2,1.6,.35,1);}',
            '@keyframes zfZcPop{0%{transform:scale(.15) rotate(-10deg);filter:brightness(3)}',
            '  40%{transform:scale(1.5) rotate(3deg);filter:brightness(2.2)}',
            '  65%{transform:scale(.92) rotate(-1deg)}100%{transform:scale(1) rotate(0);filter:brightness(1)}}',
            /* 评级字母：悬浮在数字右上角（上标） */
            '.zf-combo__grade{position:absolute;right:-10px;top:-10px;z-index:4;font-weight:900;font-size:17px;letter-spacing:2px;',
            '  font-family:Arial Black,Arial,sans-serif;text-shadow:0 0 12px currentColor,0 0 24px currentColor;}',
            '.zf-combo__grade.zf-zc-pop{animation:zfZcGrade .5s cubic-bezier(.2,1.6,.35,1);}',
            '@keyframes zfZcGrade{0%{transform:scale(3) rotateX(80deg);opacity:0}45%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}',
            /* 径向闪光 */
            '.zf-combo__flash{position:absolute;left:50%;top:50%;width:130px;height:130px;margin:-65px 0 0 -65px;border-radius:50%;',
            '  pointer-events:none;opacity:0;background:radial-gradient(circle,rgba(255,255,255,.95) 0%,var(--zc-glow,rgba(255,140,0,.75)) 35%,rgba(255,80,0,0) 70%);z-index:1;}',
            '.zf-combo__flash.zf-zc-play{animation:zfZcFlash .5s ease-out;}',
            '@keyframes zfZcFlash{0%{opacity:.95;transform:scale(.25)}100%{opacity:0;transform:scale(2.4)}}',
            /* 冲击波圆环 */
            '.zf-combo__ring{position:absolute;left:50%;top:50%;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;',
            '  border:3px solid var(--zc-glow,#ff8c00);pointer-events:none;opacity:0;z-index:1;}',
            '.zf-combo__ring.zf-zc-play{animation:zfZcRing .6s cubic-bezier(.1,.7,.3,1) forwards;}',
            '@keyframes zfZcRing{0%{opacity:.95;transform:translate(0,0) scale(.15)}100%{opacity:0;transform:translate(0,0) scale(3.6)}}',
            /* 放射火花 */
            '.zf-combo__spark{position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;',
            '  background:var(--zc-glow,#ffb200);box-shadow:0 0 8px var(--zc-glow,#ffb200);pointer-events:none;opacity:0;z-index:3;}',
            '.zf-combo__spark.zf-zc-play{animation:zfZcSpark var(--zd,.6s) cubic-bezier(.15,.6,.3,1) forwards;}',
            '@keyframes zfZcSpark{0%{opacity:1;transform:translate(0,0) scale(1.2)}',
            '  100%{opacity:0;transform:translate(var(--dx,40px),var(--dy,40px)) scale(.15)}}',
            /* 断连炸裂 */
            '#zf-combo-badge.zf-combo--break .zf-combo__stage{animation:zfZcShatter .45s ease-in forwards;}',
            '@keyframes zfZcShatter{0%{transform:scale(1);filter:brightness(1)}',
            '  25%{transform:scale(1.35) rotate(4deg);filter:brightness(2.5) saturate(2)}',
            '  100%{transform:scale(.1) rotate(-25deg);filter:blur(10px) brightness(.4);opacity:0}}',
            /* 全屏震颤（幅度由 --zc-shake 控制） */
            'body.zf-zc-shake{animation:zfZcShake var(--zc-shake-dur,.28s) cubic-bezier(.36,.07,.19,.97) !important;}',
            '@keyframes zfZcShake{',
            '  0%{transform:translate3d(0,0,0)}',
            '  15%{transform:translate3d(var(--zc-shake,4px),calc(var(--zc-shake,4px) * -.7),0)}',
            '  30%{transform:translate3d(calc(var(--zc-shake,4px) * -1.1),calc(var(--zc-shake,4px) * .6),0)}',
            '  45%{transform:translate3d(calc(var(--zc-shake,4px) * .85),calc(var(--zc-shake,4px) * .8),0)}',
            '  60%{transform:translate3d(calc(var(--zc-shake,4px) * -.7),calc(var(--zc-shake,4px) * -.5),0)}',
            '  75%{transform:translate3d(calc(var(--zc-shake,4px) * .45),calc(var(--zc-shake,4px) * .3),0)}',
            '  100%{transform:translate3d(0,0,0)}}',
            /* 刀光（v6 Slash）：随机方向月牙斩击（宽度 ×0.2：220→44） */
            '.zf-combo__slash{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;',
            '  pointer-events:none;opacity:0;z-index:5;overflow:visible;}',
            '.zf-combo__slash i{position:absolute;left:50%;top:50%;width:40px;height:9px;margin:-4.5px 0 0 -20px;display:block;',
            '  background:linear-gradient(to right, rgba(140,225,255,0) 0%, rgba(190,240,255,.95) 55%, #ffffff 78%, rgba(120,200,255,.9) 88%, rgba(80,160,255,0) 100%);',
            '  border-radius:50%/100% 100% 100% 100%;',
            '  clip-path:polygon(0 50%, 38% 6%, 100% 0, 96% 42%, 100% 100%, 40% 94%);',
            '  filter:drop-shadow(0 0 10px rgba(120,210,255,.95)) drop-shadow(0 0 22px rgba(70,150,255,.7));}',
            '.zf-combo__slash.zf-slash-play{animation:zfSlash var(--sd,.26s) cubic-bezier(.2,.85,.3,1) forwards;}',
            '@keyframes zfSlash{',
            '  0%{opacity:0;transform:rotate(var(--sa,45deg)) scaleX(.05) scaleY(.4)}',
            '  38%{opacity:1;transform:rotate(var(--sa,45deg)) scaleX(1) scaleY(1);filter:brightness(2.2)}',
            '  100%{opacity:0;transform:rotate(var(--sa,45deg)) scaleX(1.45) translateY(calc(var(--sy,90px) * -1)) scaleY(.35)}}',
            /* 统计面板 */
            '#zf-combo-panel{position:fixed;left:26px;bottom:196px;z-index:9991;width:250px;',
            '  background:linear-gradient(145deg,rgba(20,22,30,.96),rgba(35,38,50,.94));',
            '  border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:14px 16px;',
            '  box-shadow:0 8px 28px rgba(0,0,0,.45);color:#e8eaed;font-size:12px;backdrop-filter:blur(8px);}',
            '#zf-combo-panel h4{margin:0 0 8px;font-size:13px;color:#fff;display:flex;justify-content:space-between;}',
            '#zf-combo-panel h4 span{cursor:pointer;opacity:.5;}',
            '#zf-combo-panel h4 span:hover{opacity:1;}',
            '#zf-combo-panel .zcr{display:flex;justify-content:space-between;margin:4px 0;}',
            '#zf-combo-panel .zcr b{color:#ffd700;}',
            '#zf-combo-panel .zc-tools{max-height:150px;overflow-y:auto;margin-top:6px;border-top:1px solid rgba(255,255,255,.1);padding-top:6px;}',
            '#zf-combo-panel .zc-tr{display:flex;justify-content:space-between;margin:3px 0;color:rgba(255,255,255,.75);}',
            '#zf-combo-panel .zc-toggle{margin-top:8px;text-align:center;font-size:11px;opacity:.6;cursor:pointer;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    /* ---------- 爆裂特效 ---------- */
    function restart(el, cls) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth;      // 强制重排，重启动画
        el.classList.add(cls);
    }

    function burstFX(level) {
        // level: 0=普通命中 1=评级升级（更大阵仗）
        var stage = badge.querySelector('.zf-combo__stage');
        restart(badge.querySelector('.zf-combo__flash'), 'zf-zc-play');
        restart(badge.querySelector('.zf-combo__num'), 'zf-zc-pop');
        restart(badge.querySelector('.zf-combo__grade'), 'zf-zc-pop');

        spawnRings(level ? 2 : 1);
        spawnSparks(level ? 14 : Math.min(6 + Math.floor(combo / 2), 12));
        /* 刀光：普通命中 30% 单刀，评级升级 100% 三连斩 */
        if (level) { spawnSlash(); setTimeout(spawnSlash, 60); setTimeout(spawnSlash, 120); }
        else if (Math.random() < 0.3) spawnSlash();
        /* 震颤降频：仅每 30 个连击震一次（评级升级不再额外震动） */
        if (combo % 30 === 0) shakeScreen(level);
    }

    /* ---------- 刀光（v6 Slash）：随机方向月牙斩 ---------- */
    var slashCount = 0;                 // 同帧护栏
    function spawnSlash() {
        if (!enabled || slashCount >= 3) return;
        var host = badge.querySelector('.zf-combo__stage');
        if (!host) return;
        slashCount++;
        var r = Math.random();
        var angle;                       // 挥砍角度（度）
        if (r < 0.10)      angle = 90;   // 10% 竖劈
        else if (r < 0.20) angle = 0;    // 10% 横斩
        else               angle = -70 + Math.random() * 140;  // 斜劈
        var el = document.createElement('div');
        el.className = 'zf-combo__slash zf-slash-play';
        el.style.setProperty('--sa', angle.toFixed(1) + 'deg');
        el.style.setProperty('--sy', (60 + Math.random() * 60).toFixed(0) + 'px');  // 甩出距离
        el.style.setProperty('--sd', (0.22 + Math.random() * 0.08).toFixed(2) + 's');
        // 位置：CSS 已定义居中（left/top 50% + margin -110px），无需 JS 重复设置
        var blade = document.createElement('i');
        el.appendChild(blade);
        host.appendChild(el);
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
            slashCount--;
        }, 300);
    }

    /* ---------- 数字颜色/大小随连击数变化 ---------- */
    function styleNum(n) {
        var el = badge.querySelector('.zf-combo__num');
        if (!el) return;
        var tier;
        if (n >= 100)     tier = { color: '#ffd700', size: 66 };  // SSS
        else if (n >= 50) tier = { color: '#ff4500', size: 62 };  // SS+
        else if (n >= 35) tier = { color: '#ff6400', size: 58 };  // S
        else if (n >= 20) tier = { color: '#ff1493', size: 54 };  // A
        else if (n >= 10) tier = { color: '#8a2be2', size: 50 };  // B
        else              tier = { color: '#ffd54a', size: 44 };  // 10 以下：暖黄
        el.style.color = tier.color;
        el.style.fontSize = tier.size + 'px';
        el.style.textShadow =
            '0 0 10px rgba(255,255,255,.85),0 0 26px ' + tier.color +
            ',0 0 54px ' + tier.color;
        var x = badge.querySelector('.zf-combo__x');
        if (x) x.style.fontSize = Math.round(tier.size * 0.55) + 'px';
    }


    function spawnRings(n) {
        for (var i = 0; i < n; i++) {
            (function (idx) {
                var r = document.createElement('div');
                r.className = 'zf-combo__ring';
                if (idx > 0) r.style.animationDelay = '.09s';
                badge.querySelector('.zf-combo__stage').appendChild(r);
                setTimeout(function () { restart(r, 'zf-zc-play'); }, idx * 20);
                setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 800 + idx * 120);
            })(i);
        }
    }

    function spawnSparks(n) {
        var stage = badge.querySelector('.zf-combo__stage');
        var base = Math.random() * 360;
        for (var i = 0; i < n; i++) {
            (function (i) {
                var s = document.createElement('div');
                s.className = 'zf-combo__spark';
                var ang = base + (360 / n) * i + (Math.random() * 26 - 13);
                var dist = 46 + Math.random() * 52;
                var rad = ang * Math.PI / 180;
                s.style.setProperty('--dx', (Math.cos(rad) * dist).toFixed(1) + 'px');
                s.style.setProperty('--dy', (Math.sin(rad) * dist).toFixed(1) + 'px');
                s.style.setProperty('--zd', (0.45 + Math.random() * 0.35).toFixed(2) + 's');
                stage.appendChild(s);
                setTimeout(function () { restart(s, 'zf-zc-play'); }, Math.random() * 40);
                setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 950);
            })(i);
        }
    }

    function shakeScreen(level) {
        try {
            var amp = Math.min(2.5 + combo * 0.05, 6) + (level ? 3 : 0);
            var dur = (0.24 + (level ? 0.1 : 0)).toFixed(2);
            document.body.style.setProperty('--zc-shake', amp.toFixed(1) + 'px');
            document.body.style.setProperty('--zc-shake-dur', dur + 's');
            document.body.classList.remove('zf-zc-shake');
            void document.body.offsetWidth;
            document.body.classList.add('zf-zc-shake');
        } catch (e) {}
    }

    function endShake() {
        document.body.classList.remove('zf-zc-shake');
    }
    document.addEventListener('animationend', function (e) {
        if (e.animationName === 'zfZcShake') endShake();
    });

    function openPanel() {
        closePanel();
        var s = loadStore();
        var id = getCurrentChatId();
        var rec = (id && s[id]) || { max: maxCombo, total: sessionHits };
        var rows = '';
        var tools = Object.keys(toolCount).sort(function (a, b) { return toolCount[b] - toolCount[a]; });
        tools.slice(0, 15).forEach(function (t) {
            rows += '<div class="zc-tr"><span>' + t + '</span><span>×' + toolCount[t] + '</span></div>';
        });
        panel = document.createElement('div');
        panel.id = 'zf-combo-panel';
        panel.innerHTML =
            '<h4>🔥 连击战绩 <span id="zf-combo-close">✕</span></h4>' +
            '<div class="zcr"><span>当前连击</span><b>×' + combo + '</b></div>' +
            '<div class="zcr"><span>本场最高连击</span><b>×' + maxCombo + '</b></div>' +
            '<div class="zcr"><span>本场总打击</span><b>' + sessionHits + '</b></div>' +
            '<div class="zcr"><span>本对话历史最高</span><b>×' + (rec.max || 0) + '</b></div>' +
            '<div class="zcr"><span>本对话总调用</span><b>' + (rec.total || 0) + '</b></div>' +
            (tools.length ? '<div class="zc-tools">' + rows + '</div>' : '') +
            '<div class="zc-toggle" id="zf-combo-mute">音效：' + (muted ? '🔇 已静音' : '🔊 开启') + '（点击切换）</div>' +
            '<div class="zc-toggle" id="zf-combo-enable">连击特效：' + (enabled ? '✅ 开启中' : '⭕ 已关闭') + '（点击切换）</div>';
        document.body.appendChild(panel);
        /* 面板跟随徽章拖拽位置：贴徽章弹出，并夹紧在视口内 */
        try {
            if (badge && badge.parentNode) {
                var pw = 250, ph = panel.offsetHeight || 220;
                var px = Math.max(4, Math.min(badge.offsetLeft - pw / 2 + 14, window.innerWidth - pw - 4));
                var py = Math.max(4, Math.min(badge.offsetTop + 46, window.innerHeight - ph - 4));
                panel.style.left = px + 'px';
                panel.style.bottom = 'auto';
                panel.style.top = py + 'px';
            }
        } catch (e) {}
        panel.querySelector('#zf-combo-close').onclick = closePanel;
        panel.querySelector('#zf-combo-mute').onclick = function () {
            muted = !muted;
            try { localStorage.setItem('zf_combo_muted', muted ? '1' : '0'); } catch (e) {}
            openPanel(); // 刷新面板文案
        };
        panel.querySelector('#zf-combo-enable').onclick = function () {
            setComboEnabled(!enabled);
            openPanel();
        };
    }

    /* ---------- 连击总开关（供风筝面板调用：window.setComboEnabled） ---------- */
    function __comboEnabled() { return enabled; }
    try {
        Object.defineProperty(window, '__comboEnabled', { value: __comboEnabled, writable: false });
    } catch (e) { window.__comboEnabled = __comboEnabled; }
    function setComboEnabled(v) {
        enabled = !!v;
        try { localStorage.setItem('zf_combo_enabled', enabled ? '1' : '0'); } catch (e) {}
        cloudSaveCombo();
        if (!enabled) {
            // 立即收起徽章与面板
            clearTimeout(breakTimer);
            clearTimeout(hideTimer);
            if (badge && badge.parentNode) {
                badge.classList.remove('zf-combo--on');
                badge.classList.add('zf-combo--off');
            }
            closePanel();
        }
    }
    try {
        Object.defineProperty(window, 'setComboEnabled', { value: setComboEnabled, writable: false });
    } catch (e) { window.setComboEnabled = setComboEnabled; }

    /* ---------- 风筝总览面板开关行（面板 500ms innerHTML 重建；点击由 app-kite.js 面板级
       事件委托 [data-kho2-combo] 接管——inline onclick 会被龙头 setPointerCapture 吞掉，
       且与委托并存会双触发，故此处只出 HTML 不绑事件） ---------- */
    window.__kho2ComboToggleHtml = function () {
        return '<span class="kho2-chip" style="cursor:pointer" data-kho2-combo title="连击特效总开关（点击切换）">'
            + (window.__comboEnabled() ? '🔥连击:开' : '🔥连击:关') + '</span>';
    };
    function closePanel() {
        if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        panel = null;
    }

    /* ---------- 音效（复用全局 __zfSfx，音调随连击升高） ---------- */
    function playTick(n) {
        if (muted) return;
        try {
            var sfx = window.__zfSfx;
            if (!sfx) return;
            if (sfx.play && sfx.play.length >= 2) {
                sfx.play('tick', Math.min(1 + n * 0.04, 2.2));
            } else if (sfx.play) {
                sfx.play('tick');
            }
        } catch (e) {}
    }
    function playBreak() {
        if (muted) return;
        try { if (window.__zfSfx && window.__zfSfx.play) window.__zfSfx.play('error'); } catch (e) {}
    }

    /* ---------- 核心：命中 ---------- */
    function hit(toolName) {
        if (!enabled) return;
        var now = Date.now();
        var expired = now - lastHitTime > COMBO_WINDOW;
        if (expired) {
            // 不在此处调 breakAnim()：下方马上会摘 --break/重排/清 hideTimer，炸裂动画一帧都看不到，
            // 只会白白多响一声 error 音（真炸裂已由 breakTimer 路径负责）。这里只收起徽章、归零。
            combo = 0;
            lastGrade = null;
            if (badge && badge.classList.contains('zf-combo--on')) {
                badge.classList.remove('zf-combo--on');
                badge.classList.add('zf-combo--off');
            }
        }
        lastHitTime = now;
        combo += 1;
        sessionHits += 1;
        if (combo > maxCombo) maxCombo = combo;
        toolCount[toolName] = (toolCount[toolName] || 0) + 1;
        recordHit();

        var b = ensureBadge();
        b.querySelector('.zf-combo__count').textContent = combo;

        var g = gradeOf(combo);
        styleNum(combo);
        var gradeEl = b.querySelector('.zf-combo__grade');
        var upgraded = false;
        if (g) {
            gradeEl.textContent = g[1];
            gradeEl.style.color = g[2];
            upgraded = (lastGrade !== g[1]);
            lastGrade = g[1];
            b.style.setProperty('--zc-glow', g[2]);
        } else {
            gradeEl.textContent = '';
            lastGrade = null;
            b.style.setProperty('--zc-glow', '#ff8c00');
        }

        // 入场/再入场：无连击时是完全透明的，命中才炸出来
        // 若上一轮断连炸裂动画还在播，先解除（防止新命中被 --break 的 fill 动画压住不可见）
        if (b.classList.contains('zf-combo--break')) {
            b.classList.remove('zf-combo--break');
            void b.offsetWidth;
        }
        if (!b.classList.contains('zf-combo--on')) {
            b.classList.remove('zf-combo--off');
            void b.offsetWidth;
            b.classList.add('zf-combo--on');
        }

        burstFX(upgraded ? 1 : 0);
        playTick(combo);

        // 窗口到期 → 断连（彻底隐藏，直到下次连击才再次出现）
        clearTimeout(breakTimer);
        clearTimeout(hideTimer);
        breakTimer = setTimeout(function () {
            if (combo >= 1) breakAnim();   // ×1 也必须炸裂隐藏（v3 徽章默认隐藏，否则裸 ×1 永久滞留）
            combo = 0;
            lastGrade = null;
            try { zfComboReport(0); } catch (err) {}   // 【空闲上报】断连 → 通知后台空闲
        }, COMBO_WINDOW + 200);
    }

    function breakAnim() {
        if (!badge) return;
        restart(badge, 'zf-combo--break');
        playBreak();
        // 炸裂动画结束后彻底隐藏（完全透明不可见）
        hideTimer = setTimeout(function () {
            if (!badge) return;
            badge.classList.remove('zf-combo--break', 'zf-combo--on');
            badge.classList.add('zf-combo--off');
            var ge = badge.querySelector('.zf-combo__grade');
            if (ge) ge.textContent = '';
            var ce = badge.querySelector('.zf-combo__count');
            if (ce) ce.textContent = '0';
        }, 460);
    }

    /* ---------- 空闲上报：combo 状态写入后端，供空闲自动重启判断 ----------
       【5.6.1 修复·文件树卡死真凶】AI 流式输出期间 zf:llm-chunk 每 30ms 触发一次，
       旧实现每个事件都 POST /api/combo-state（长回复 = 每秒 20~30 个请求、无节流无上限）。
       浏览器对同源 HTTP/1.1 只有 6 个并发连接：AI 调用本身（relay-proxy）+ SSE 事件流
       再占掉 1~2 个，其余全被 combo 洪泛占死 → 文件树 /api/fs/browse 排队几分钟
       （表现：点左侧文件夹没反应，右侧缩略图因走 HTTP 缓存反而快）。
       现改为：值变化立即发 + 忙碌期 4s 心跳 + 单飞合并（永远最多 1 个在途，
       在途期间的最新值落pending，返回后补发一次）。服务端消费方 idle_auto_restart
       20 分钟才读一次状态、空闲确认窗口 10s，4s 心跳绰绰有余。 */
    var _comboNet = { lastSent: null, lastSentAt: 0, inFlight: false, pending: undefined };
    function zfComboReport(n) {
        try {
            var nowTs = Date.now();
            if (_comboNet.inFlight) { _comboNet.pending = n; return; }
            if (_comboNet.lastSent === n && (nowTs - _comboNet.lastSentAt) < 4000) return;
            _comboNet.inFlight = true;
            _comboNet.lastSent = n;
            _comboNet.lastSentAt = nowTs;
            fetch('/api/combo-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ combo: n, ts: Date.now() })
            }).then(function () {
                _comboNet.inFlight = false;
                var p = _comboNet.pending; _comboNet.pending = undefined;
                if (p !== undefined && p !== _comboNet.lastSent) zfComboReport(p);
            }).catch(function () {
                _comboNet.inFlight = false;
                _comboNet.pending = undefined;
            });
        } catch (err) {}
    }

    /* ---------- 【v2 忙碌上报】AI 流式输出期间视为忙碌，防止空闲重启误杀长思考对话 ----------
       模型思考/吐字期间没有任何工具命中（combo 会归 0），守护线程会误判"空闲"并无感重启，
       把进行中的对话请求直接掐死（表现为：正在调用 XXX… 长时间卡死后 Failed to fetch）。
       这里监听 zf:llm-chunk（每个 token 到达都触发），持续上报 combo=1 保持忙碌；
       token 停流超过 COMBO_WINDOW+2s 无新 chunk 才回落空闲。 */
    var _llmBusyTimer = null;
    window.addEventListener('zf:llm-chunk', function () {
        try {
            zfComboReport(1);
            clearTimeout(_llmBusyTimer);
            _llmBusyTimer = setTimeout(function () {
                try { zfComboReport(0); } catch (err) {}
            }, COMBO_WINDOW + 2000);
        } catch (err) {}
    });

    /* ---------- 监听全局工具命中事件 ---------- */
    window.addEventListener('zf-combo-hit', function (e) {
        try {
            var d = e.detail || {};
            hit(d.tool || 'tool');
            try { zfComboReport(1); } catch (err) {}   // 【空闲上报】有命中 → 非空闲
        } catch (err) { console.error('[combo]', err); }
    });

    // 静音状态恢复
    try { muted = localStorage.getItem('zf_combo_muted') === '1'; } catch (e) {}
    console.log('[combo] 连击模式已加载（v3 冲击力版：爆环+火花+震颤，8s 窗口，D~SSS 七档）');
})();
