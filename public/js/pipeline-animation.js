// ========== pipeline-animation.js - 协作流水线动画化（对话内嵌自包含动画卡片） ==========
// 策划案 v1.1 P2 全量：驳回回流、原因提示条、自动播放、1x/2x、懒播放(IntersectionObserver)、
// 折叠静态时间线、开关(localStorage: pa_enabled)。数据：主窗+角色子窗按 srcId 聚合(extract)。
(function () {
    'use strict';

    var ROLES = [
        { key: 'thinker',    label: '策划师', icon: '🧠', color: '#5b8def' },
        { key: 'reviewer',   label: '审核师', icon: '🔍', color: '#f0a020' },
        { key: 'verifier',   label: '验证师', icon: '🧪', color: '#22b573' },
        { key: 'summarizer', label: '总结师', icon: '📝', color: '#9b59d0' },
        { key: 'evolver',    label: '进化师', icon: '🧬', color: '#e0559a' },
        { key: 'rebuttor',   label: '反驳师', icon: '⚔️', color: '#d95040' }
    ];

    // 开关已移除（用户要求：默认开启，不提供设置项）
    function enabled() { return true; }
    function setEnabled(v) { /* 已废弃：功能恒开 */ }

    function render(div, payload) {
        div.classList.add('msg-ai', 'pipeline-anim-msg');
        var steps = (payload && payload.steps) || [];
        var title = (payload && payload.title) || '协作流水线';

        var wrap = document.createElement('div');
        wrap.className = 'pipeline-anim';
        wrap.innerHTML =
            '<div class="pa-head"><span class="pa-title">' + esc(title) + '</span>' +
            '<span class="pa-ctrl">' +
            '<button class="pa-btn pa-play" title="播放/暂停">▶</button>' +
            '<button class="pa-btn pa-replay" title="重播">↻</button>' +
            '<button class="pa-btn pa-speed" title="倍速">1x</button>' +
            '<button class="pa-btn pa-fold" title="折叠/展开时间线">≡</button>' +
            '<span class="pa-progress"><span class="pa-bar"></span></span>' +
            '</span></div>' +
            '<div class="pa-track">' + steps.map(function (s, i) {
                return '<div class="pa-node' + (s.verdict === 'reject' ? ' pa-reject' : '') + '" data-idx="' + i + '" style="--pa-c:' + (s.color || '#888') + '">' +
                    '<div class="pa-dot">' + (s.icon || '•') + '</div>' +
                    '<div class="pa-label">' + esc(s.label || '') + '</div>' +
                    '<div class="pa-sum"></div></div>';
            }).join('') + '<div class="pa-line"><span class="pa-line-fill"></span></div>' +
            '<div class="pa-orb"></div></div>' +
            '<div class="pa-reject-tip"></div>' +
            '<div class="pa-detail"></div>' +
            '<div class="pa-static-line">' + steps.map(function (s, i) {
                return '<div class="pa-sl-item"><span>' + (s.icon || '•') + ' ' + esc(s.label || '') + '</span>' +
                    (s.verdict === 'reject' ? '<span class="pa-sl-rej">✕ 驳回</span>' : '<span>✓</span>') + '</div>';
            }).join('') + '</div>';

        var nodes = wrap.querySelectorAll('.pa-node');
        var fill = wrap.querySelector('.pa-line-fill');
        var bar = wrap.querySelector('.pa-bar');
        var detail = wrap.querySelector('.pa-detail');
        var rejTip = wrap.querySelector('.pa-reject-tip');
        var orb = wrap.querySelector('.pa-orb');
        var playBtn = wrap.querySelector('.pa-play');
        var speedBtn = wrap.querySelector('.pa-speed');
        var cur = -1, timer = null, playing = false, speed = 1, played = false;

        function show(i) {
            cur = i;
            nodes.forEach(function (n, k) {
                n.classList.toggle('pa-active', k === i);
                n.classList.toggle('pa-done', k < i);
            });
            var pct = steps.length ? ((i + 1) / steps.length * 100) : 0;
            if (fill) fill.style.width = pct + '%';
            if (bar) bar.style.width = pct + '%';
            var s = steps[i] || {};
            // P2：驳回节点闪红 + 光点折返 + 原因提示条
            if (s.verdict === 'reject') {
                rejTip.innerHTML = '<b>⚠ ' + esc(s.label || '') + '驳回</b>' + esc(s.reason || s.summary || '').slice(0, 160);
                rejTip.style.display = 'block';
                if (i > 0) bounceBack(i);
            } else {
                rejTip.style.display = 'none';
            }
            detail.innerHTML = '<b>' + esc(s.label || '') + '</b>' + esc((s.summary || '').slice(0, 200));
            if (i >= steps.length - 1) stop();
        }
        // 光点：从上一节点飞向当前节点；驳回时折返
        function moveOrb(fromIdx, toIdx, back) {
            if (!orb || !nodes.length) return;
            var tr = wrap.querySelector('.pa-track').getBoundingClientRect();
            var a = nodes[clamp(fromIdx)].getBoundingClientRect();
            var b = nodes[clamp(toIdx)].getBoundingClientRect();
            orb.style.transition = back ? 'left .6s cubic-bezier(.4,0,.6,1)' : 'left .5s ease';
            orb.classList.add('pa-orb-run');
            orb.classList.toggle('pa-orb-back', !!back);
            orb.style.left = ((a.left + a.width / 2) - tr.left) + 'px';
            requestAnimationFrame(function () {
                orb.style.left = ((b.left + b.width / 2) - tr.left) + 'px';
                setTimeout(function () { orb.classList.remove('pa-orb-run'); }, 650);
            });
        }
        function bounceBack(i) { moveOrb(i, i - 1, true); }
        function clamp(i) { return Math.max(0, Math.min(i, nodes.length - 1)); }

        function step() {
            if (cur < steps.length - 1) {
                var next = cur + 1;
                if (cur >= 0) moveOrb(cur, next, false);
                show(next);
            } else stop();
        }
        function play() {
            if (playing) return;
            playing = true; playBtn.textContent = '⏸';
            if (cur >= steps.length - 1) show(0);
            timer = setInterval(step, 1200 / speed);
        }
        function stop() {
            playing = false; playBtn.textContent = '▶';
            if (timer) { clearInterval(timer); timer = null; }
        }
        playBtn.addEventListener('click', function () { playing ? stop() : play(); });
        wrap.querySelector('.pa-replay').addEventListener('click', function () { stop(); show(0); play(); });
        speedBtn.addEventListener('click', function () {
            speed = speed === 1 ? 2 : 1;
            speedBtn.textContent = speed + 'x';
            speedBtn.classList.toggle('pa-on', speed === 2);
            if (playing) { clearInterval(timer); timer = setInterval(step, 1200 / speed); }
        });
        wrap.querySelector('.pa-fold').addEventListener('click', function () {
            wrap.classList.toggle('pa-collapsed');
            stop();
        });
        nodes.forEach(function (n, i) { n.addEventListener('click', function () { stop(); show(i); }); });

        div.appendChild(wrap);
        show(0);
        // P2 懒播放：IntersectionObserver 视口内首次进入才自动播一次（默认开，可见即播）
        var doAuto = function () {
            if (played) return; played = true;
            if (enabled()) { show(0); play(); }
        };
        if (typeof IntersectionObserver === 'function') {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    if (en.isIntersecting) { doAuto(); io.disconnect(); }
                });
            }, { threshold: 0.4 });
            io.observe(wrap);
            setTimeout(doAuto, 4000); // 兜底：4s 内未触发则直接播
        } else {
            doAuto();
        }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 角色子窗探测（兼容多套旗标命名：chatbox-converge-arrow.js 用 _isQcChat 表示审核/验证窗，
    // 旧版 _isReviewerChat/_isVerifierChat 等也保留兼容。原版只认 _isReviewerChat 等，
    // 实际代码从未设置这些旗标 → maybeInject 数出 nRoles<2 永远 return false → 动画从不出现。）
    function isRoleChat(c, key) {
        var el = c && c.el;
        var flags = {
            thinker:    ['_isThinkerChat'],
            reviewer:   ['_isReviewerChat', '_isQcChat'],
            verifier:   ['_isVerifierChat', '_isQcChat'],
            summarizer: ['_isSummarizerChat'],
            evolver:    ['_isEvolverChat'],
            rebuttor:   ['_isRebuttorChat']
        };
        var list = flags[key] || ['_is' + cap(key) + 'Chat'];
        return list.some(function (f) { return (el && el[f]) || c[f]; });
    }

    // ===== pipeline_extractor（前端直读版）：按 srcId 聚合主窗+子窗消息 → steps =====
    // verdict=reject 依据：子窗最后一条 AI 消息含驳回特征词（含"不通过/驳回/必须修改"）。
    function extract() {
        var steps = [];
        var chats = (window.App && App.chatBoxes) || [];
        ROLES.forEach(function (r) {
            var sub = null;
            try {
                sub = chats.find(function (c) {
                    return isRoleChat(c, r.key);
                });
            } catch (e) {}
            if (!sub) return;
            var msgs = [];
            try { msgs = (window.Store && Store.getMessages && Store.getMessages(sub.id)) || []; } catch (e) {}
            var lastAi = '';
            for (var i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i] && (msgs[i].role === 'ai' || msgs[i].who === 'ai') && msgs[i].content) { lastAi = msgs[i].content; break; }
            }
            var isReject = /不通过|驳回|必须修改|禁止放行|未能通过/.test(String(lastAi).slice(0, 400));
            steps.push({
                label: r.label, icon: r.icon, color: r.color,
                summary: String(lastAi).slice(0, 200),
                verdict: isReject ? 'reject' : 'pass',
                reason: isReject ? String(lastAi).slice(0, 160) : ''
            });
        });
        return { type: 'pipeline_animation', title: '协作流水线', steps: steps };
    }

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // ===== 任务收尾自动插入（策划案触发时机）：task_complete 且角色子窗≥2 =====
    function maybeInject(chatId) {
        if (!enabled()) return false;
        var chats = (window.App && App.chatBoxes) || [];
        var nRoles = ROLES.filter(function (r) {
            return chats.some(function (c) {
                return isRoleChat(c, r.key);
            });
        }).length;
        if (nRoles < 2) return false;
        try {
            var payload = extract();
            if (!payload.steps.length) return false;
            if (window.ChatActions && ChatActions.addMsg && chatId) {
                ChatActions.addMsg(chatId, 'ai', payload);
                return true;
            }
        } catch (e) {}
        return false;
    }

    window.PipelineAnimation = { render: render, extract: extract, ROLES: ROLES, maybeInject: maybeInject, enabled: enabled };
})();
