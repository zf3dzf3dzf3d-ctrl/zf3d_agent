// ========== app-network-restart.js - 🔄 后台网络一键重启 ==========
// 功能：
//  1. 悬浮按钮组加一个 🔄 按钮，点击后调 POST /api/restart_server 一键重启后台
//  2. 每 60 秒查询 /api/network_guard，断网持续中时按钮变红提示
//  3. 使用自绘确认弹窗（不用浏览器原生 confirm），重启期间显示全屏进度遮罩，
//     轮询 /api/health，恢复后自动刷新页面
Object.assign(App, {

    _netRestartInit: function() {
        if (this.__netRestartWired) return;
        this.__netRestartWired = true;
        this._ensureNetRestartBadge();
        // 定时检查断网状态（60秒一次）
        setInterval(this._checkNetworkStatus.bind(this), 60000);
        setTimeout(this._checkNetworkStatus.bind(this), 3000);
    },

    // 断网红点角标：挂到左上角文件菜单按钮上（入口已收进文件菜单）
    _ensureNetRestartBadge: function() {
        var host = document.getElementById('canvasMenuBtn');
        if (!host || document.getElementById('netRestartBadge')) return;
        host.style.position = 'relative';
        var badge = document.createElement('span');
        badge.id = 'netRestartBadge';
        badge.style.cssText = 'display:none;position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:#ff4d4f;z-index:9999;';
        host.appendChild(badge);
    },

    // ===== 自绘确认弹窗（替代浏览器原生 confirm） =====
    _restartConfirmDialog: function(onOk) {
        var old = document.getElementById('zfRestartMask');
        if (old) old.remove();

        var mask = document.createElement('div');
        mask.id = 'zfRestartMask';
        mask.style.cssText = 'position:fixed;inset:0;z-index:999990;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.35);width:380px;max-width:92vw;overflow:hidden;animation:zfRestartPop .18s ease-out;';

        var style = document.createElement('style');
        style.textContent = '@keyframes zfRestartPop{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}';
        mask.appendChild(style);

        var head = document.createElement('div');
        head.style.cssText = 'padding:18px 22px 6px;font-size:16px;font-weight:600;color:#2c3e50;';
        head.textContent = '🔄 重启后台服务';
        box.appendChild(head);

        var body = document.createElement('div');
        body.style.cssText = 'padding:6px 22px 18px;font-size:13px;line-height:1.8;color:#555;';
        body.innerHTML = '重启期间（约 5~10 秒）所有对话会暂时无响应。<br>后台恢复后将<b style="color:#27ae60">自动刷新页面</b>，无需手动操作。';
        box.appendChild(body);

        var foot = document.createElement('div');
        foot.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:12px 22px 18px;';

        var cancel = document.createElement('button');
        cancel.textContent = '取消';
        cancel.style.cssText = 'padding:8px 20px;border-radius:8px;border:1px solid #dcdfe6;background:#fff;color:#606266;font-size:13px;cursor:pointer;';
        cancel.onmouseover = function(){ cancel.style.background = '#f5f7fa'; };
        cancel.onmouseout = function(){ cancel.style.background = '#fff'; };

        var ok = document.createElement('button');
        ok.textContent = '确认重启';
        ok.style.cssText = 'padding:8px 20px;border-radius:8px;border:none;background:#e67e22;color:#fff;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(230,126,34,.4);';
        ok.onmouseover = function(){ ok.style.background = '#d35400'; };
        ok.onmouseout = function(){ ok.style.background = '#e67e22'; };

        function close() { mask.remove(); }
        cancel.onclick = close;
        mask.onclick = function(e) { if (e.target === mask) close(); };
        ok.onclick = function() { close(); onOk(); };

        foot.appendChild(cancel);
        foot.appendChild(ok);
        box.appendChild(foot);
        mask.appendChild(box);
        document.body.appendChild(mask);
    },

    // ===== 重启进度遮罩（炫酷霓虹版：渐变旋转光环 + 脉冲粒子 + 玻璃拟态） =====
    _restartOverlay: function() {
        var old = document.getElementById('zfRestartOverlay');
        if (old) old.remove();
        var mask = document.createElement('div');
        mask.id = 'zfRestartOverlay';
        mask.style.cssText = 'position:fixed;inset:0;z-index:999999;background:radial-gradient(ellipse at center, rgba(20,30,55,.78), rgba(5,8,18,.92));display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;animation:zfFadeIn .3s ease-out;';

        var box = document.createElement('div');
        box.style.cssText = 'text-align:center;color:#fff;position:relative;';

        // 双层光环：外层渐变旋转 + 内层反向呼吸
        var ringWrap = document.createElement('div');
        ringWrap.style.cssText = 'position:relative;width:110px;height:110px;margin:0 auto 26px;';

        var glow = document.createElement('div');
        glow.style.cssText = 'position:absolute;inset:-14px;border-radius:50%;background:radial-gradient(circle, rgba(255,140,0,.35), transparent 70%);animation:zfRestartPulse 1.6s ease-in-out infinite;';
        ringWrap.appendChild(glow);

        var ring = document.createElement('div');
        ring.id = 'zfRestartRing';
        ring.style.cssText = 'position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg, transparent 0%, #f39c12 25%, #ff6b9d 50%, #8e5cff 75%, transparent 100%);-webkit-mask:radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px));mask:radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px));animation:zfRestartSpin 1.1s linear infinite;filter:drop-shadow(0 0 8px rgba(255,150,50,.8));';
        ringWrap.appendChild(ring);

        var ringInner = document.createElement('div');
        ringInner.style.cssText = 'position:absolute;inset:12px;border-radius:50%;border:2px solid rgba(255,255,255,.12);border-top-color:rgba(255,200,120,.9);animation:zfRestartSpinR 2.2s linear infinite;';
        ringWrap.appendChild(ringInner);

        var core = document.createElement('div');
        core.textContent = '🔄';
        core.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;filter:drop-shadow(0 0 12px rgba(255,160,60,.9));animation:zfRestartFloat 2s ease-in-out infinite;';
        ringWrap.appendChild(core);

        box.appendChild(ringWrap);

        // 三条霓虹光带扫过背景
        var beams = document.createElement('div');
        beams.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:14px;';
        for (var i = 0; i < 3; i++) {
            var b = document.createElement('div');
            b.style.cssText = 'position:absolute;top:' + (18 + i * 30) + '%;left:-30%;width:26%;height:2px;background:linear-gradient(90deg, transparent, rgba(255,160,60,' + (0.35 - i * 0.08) + '), transparent);animation:zfRestartBeam ' + (2.4 + i * 0.7) + 's linear infinite ' + (i * 0.5) + 's;';
            beams.appendChild(b);
        }
        box.appendChild(beams);

        // ===== 阶段指示器：确认重启 → 结束旧进程 → 拉起新进程 → 恢复服务 =====
        var PHASES = ['确认重启', '结束旧进程', '拉起新进程', '恢复服务'];
        var phaseRow = document.createElement('div');
        phaseRow.style.cssText = 'display:flex;justify-content:center;align-items:flex-start;margin-bottom:18px;';
        var phaseDots = [];
        PHASES.forEach(function(name, idx) {
            if (idx > 0) {
                var seg = document.createElement('div');
                seg.style.cssText = 'width:30px;height:2px;background:rgba(255,255,255,.15);margin:10px 5px 0;transition:background .5s,box-shadow .5s;border-radius:1px;';
                phaseRow.appendChild(seg);
            }
            var cell = document.createElement('div');
            cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;';
            var dot = document.createElement('div');
            dot.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:12px;color:transparent;transition:all .5s;background:rgba(255,255,255,.04);box-sizing:border-box;';
            var lbl = document.createElement('div');
            lbl.textContent = name;
            lbl.style.cssText = 'font-size:11px;color:rgba(255,255,255,.4);transition:color .5s;white-space:nowrap;';
            cell.appendChild(dot); cell.appendChild(lbl);
            phaseRow.appendChild(cell);
            phaseDots.push({ dot: dot, lbl: lbl, seg: null });
        });
        // 把连接线引用回填到 phaseDots（phaseRow 子元素顺序：dot,seg,dot,seg,dot,seg,dot）
        for (var pi = 1; pi < phaseDots.length; pi++) {
            phaseDots[pi].seg = phaseRow.children[pi * 2 - 1];
        }
        box.appendChild(phaseRow);

        // ===== 流光进度条（随阶段推进，成功时冲到 100% 并发光） =====
        var barWrap = document.createElement('div');
        barWrap.style.cssText = 'width:280px;height:6px;border-radius:3px;background:rgba(255,255,255,.08);margin:0 auto 12px;overflow:hidden;position:relative;box-shadow:inset 0 1px 3px rgba(0,0,0,.4);';
        var bar = document.createElement('div');
        bar.id = 'zfRestartBar';
        bar.style.cssText = 'height:100%;width:6%;border-radius:3px;background:linear-gradient(90deg,#8e5cff,#ff6b9d,#f39c12);transition:width .8s cubic-bezier(.4,0,.2,1);position:relative;';
        var barShine = document.createElement('div');
        barShine.style.cssText = 'position:absolute;inset:0;border-radius:3px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent);background-size:200% 100%;animation:zfBarShine 1.4s linear infinite;';
        bar.appendChild(barShine);
        barWrap.appendChild(bar);
        box.appendChild(barWrap);

        // ===== 已用时计时器 =====
        var timerEl = document.createElement('div');
        timerEl.id = 'zfRestartTimer';
        timerEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,.5);margin-bottom:6px;font-variant-numeric:tabular-nums;letter-spacing:1px;';
        timerEl.textContent = '已用时 0.0 秒';
        box.appendChild(timerEl);
        mask.__zfPhaseDots = phaseDots; // 挂到遮罩上，供 _restartOverlaySet 联动

        var title = document.createElement('div');
        title.id = 'zfRestartOverlayTitle';
        title.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:10px;text-shadow:0 0 18px rgba(255,150,50,.55);';
        title.textContent = '🔄 正在重启后台服务…';
        box.appendChild(title);

        var sub = document.createElement('div');
        sub.id = 'zfRestartOverlaySub';
        sub.style.cssText = 'font-size:13px;color:rgba(255,255,255,.75);line-height:1.8;max-width:340px;';
        sub.textContent = '正在结束旧进程并拉起新进程（前台页面保持不动），请稍候';
        box.appendChild(sub);

        var style = document.createElement('style');
        style.textContent = [
            '@keyframes zfRestartSpin{to{transform:rotate(360deg)}}',
            '@keyframes zfRestartSpinR{to{transform:rotate(-360deg)}}',
            '@keyframes zfRestartPulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}',
            '@keyframes zfRestartFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}',
            '@keyframes zfRestartBeam{0%{left:-30%}100%{left:130%}}',
            '@keyframes zfFadeIn{from{opacity:0}to{opacity:1}}',
            '@keyframes zfFadeOut{from{opacity:1}to{opacity:0}}',
            '@keyframes zfRestartOk{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}',
            '@keyframes zfRestartBurst{0%{box-shadow:0 0 0 0 rgba(46,204,113,.6)}100%{box-shadow:0 0 0 60px rgba(46,204,113,0)}}',
            '@keyframes zfPhasePulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.18);opacity:1}}',
            '@keyframes zfBarShine{0%{background-position:200% 0}100%{background-position:-200% 0}}'
        ].join('\n');
        mask.appendChild(style);
        mask.appendChild(box);
        document.body.appendChild(mask);
        return mask;
    },

    // 遮罩淡出关闭（成功恢复时使用，前台页面不刷新）
    _restartOverlayFadeOut: function() {
        var mask = document.getElementById('zfRestartOverlay');
        if (!mask) return;
        var ringWrap = mask.querySelector('div > div');
        if (ringWrap) { ringWrap.style.animation = 'zfRestartBurst .9s ease-out forwards'; }
        mask.style.animation = 'zfFadeOut .7s ease-in .5s forwards';
        setTimeout(function() { mask.remove(); }, 1400);
    },

    _restartOverlaySet: function(title, sub, color) {
        var t = document.getElementById('zfRestartOverlayTitle');
        var s = document.getElementById('zfRestartOverlaySub');
        if (t) t.textContent = title;
        if (s) s.textContent = sub;
        if (t && color) t.style.color = color;

        // ===== 阶段/进度条/计时器联动 =====
        var mask = document.getElementById('zfRestartOverlay');
        if (!mask) return;

        // 1) 计时器：从遮罩出现开始计时
        if (!mask.__zfStartTime) mask.__zfStartTime = Date.now();
        var timerEl = document.getElementById('zfRestartTimer');
        if (timerEl) {
            var secs = (Date.now() - mask.__zfStartTime) / 1000;
            timerEl.textContent = '已用时 ' + secs.toFixed(1) + ' 秒';
        }

        // 2) 阶段判定：根据标题/副文案关键词推进圆点
        var txt = (title || '') + (sub || '');
        var phase = 0; // 0=确认重启 1=结束旧进程 2=拉起新进程 3=恢复服务
        if (txt.indexOf('已恢复') >= 0 || txt.indexOf('✅') >= 0) phase = 3;
        else if (txt.indexOf('等待恢复') >= 0 || txt.indexOf('新进程') >= 0 || txt.indexOf('初始化') >= 0) phase = 2;
        else if (txt.indexOf('结束旧进程') >= 0 || txt.indexOf('旧进程') >= 0) phase = 1;
        else if (txt.indexOf('尚未恢复') >= 0 || txt.indexOf('⚠') >= 0) phase = -1; // 失败

        var dots = mask.__zfPhaseDots || [];
        var PHASE_COLORS = ['#f39c12', '#ff6b9d', '#8e5cff', '#2ecc71'];
        for (var i = 0; i < dots.length; i++) {
            var d = dots[i];
            if (phase < 0) {
                // 失败：当前及之后的点变红
                if (i >= Math.max(1, mask.__zfFailPhase || 1)) {
                    d.dot.style.borderColor = '#e74c3c';
                    d.dot.style.background = 'rgba(231,76,60,.2)';
                    d.dot.style.boxShadow = '0 0 10px rgba(231,76,60,.7)';
                    d.lbl.style.color = '#ff8a80';
                }
                continue;
            }
            if (i < phase) { // 已完成
                d.dot.style.borderColor = '#2ecc71';
                d.dot.style.background = 'rgba(46,204,113,.18)';
                d.dot.style.color = '#2ecc71';
                d.dot.style.boxShadow = '0 0 8px rgba(46,204,113,.5)';
                d.dot.textContent = '✓';
                d.lbl.style.color = 'rgba(255,255,255,.85)';
                if (d.seg) { d.seg.style.background = 'linear-gradient(90deg,#2ecc71,' + PHASE_COLORS[i + 1] + ')'; d.seg.style.boxShadow = '0 0 6px rgba(46,204,113,.6)'; }
            } else if (i === phase) { // 进行中：霓虹脉冲
                d.dot.style.borderColor = PHASE_COLORS[phase];
                d.dot.style.background = 'rgba(255,255,255,.08)';
                d.dot.style.color = 'transparent';
                d.dot.style.boxShadow = '0 0 12px ' + PHASE_COLORS[phase];
                d.dot.textContent = '';
                d.dot.style.animation = 'zfPhasePulse 1.2s ease-in-out infinite';
                d.lbl.style.color = PHASE_COLORS[phase];
            } else { // 未开始
                d.dot.style.borderColor = 'rgba(255,255,255,.25)';
                d.dot.style.background = 'rgba(255,255,255,.04)';
                d.dot.style.boxShadow = 'none';
                d.dot.style.animation = 'none';
                d.dot.textContent = '';
                d.lbl.style.color = 'rgba(255,255,255,.4)';
            }
        }

        // 3) 进度条：阶段基线 + 时间推进（90 秒满）
        var bar = document.getElementById('zfRestartBar');
        if (bar) {
            var base = [8, 30, 55, 100][Math.max(0, phase)];
            mask.__zfPhase = phase;
            mask.__zfBase = base;
            var timePct = Math.min(1, (Date.now() - mask.__zfStartTime) / 90000) * 40;
            var pct = phase === 3 ? 100 : Math.min(92, base + timePct);
            bar.style.width = pct + '%';
            if (phase === 3) {
                bar.style.background = 'linear-gradient(90deg,#2ecc71,#a8ff78)';
                bar.style.boxShadow = '0 0 14px rgba(46,204,113,.8)';
            }
        }
    },

    // 供轮询处每秒刷新计时/进度（不改变阶段判定，只刷计时与进度）
    _restartOverlayTick: function() {
        var mask = document.getElementById('zfRestartOverlay');
        if (!mask || !mask.__zfStartTime) return;
        var timerEl = document.getElementById('zfRestartTimer');
        if (timerEl) {
            var secs = (Date.now() - mask.__zfStartTime) / 1000;
            timerEl.textContent = '已用时 ' + secs.toFixed(1) + ' 秒';
        }
        var bar = document.getElementById('zfRestartBar');
        if (bar && mask.__zfPhase !== 3 && mask.__zfPhase !== -1) {
            var timePct = Math.min(1, (Date.now() - mask.__zfStartTime) / 90000) * 40;
            bar.style.width = Math.min(92, (mask.__zfBase || 8) + timePct) + '%';
        }
    },

    _restartOverlayFail: function(msg) {
        // 死胡同修复：重启失败后遮罩原本永远停留且无法关闭，把整个页面锁死。
        // 现在失败态下遮罩可点击 → 刷新页面重试（后台若已恢复即可正常进入）。
        var mask = document.getElementById('zfRestartOverlay');
        if (mask) mask.__zfFailPhase = Math.max(1, mask.__zfPhase || 1); // 记录失败发生在哪个阶段
        this._restartOverlaySet('⚠️ 后台尚未恢复', msg, '#e74c3c');
        // 失败态：进度条变红并停止在当前位置
        var bar = document.getElementById('zfRestartBar');
        if (bar) { bar.style.background = 'linear-gradient(90deg,#e74c3c,#ff8a80)'; bar.style.boxShadow = '0 0 10px rgba(231,76,60,.6)'; }
        var timerEl = document.getElementById('zfRestartTimer');
        if (timerEl) timerEl.textContent = '已用时 ' + ((Date.now() - (mask && mask.__zfStartTime ? mask.__zfStartTime : Date.now())) / 1000).toFixed(1) + ' 秒 · 已中止';
        var mask = document.getElementById('zfRestartOverlay');
        if (!mask) return;
        // 失败态也允许点击关闭（页面无需刷新即可关闭遮罩；需要重试时刷新页面即可）
        mask.style.cursor = 'pointer';
        mask.title = '点击关闭（如需重试请刷新页面）';
        mask.onclick = function() { mask.remove(); };
    },

    _doRestart: function() {
        var self = this;
        // 防连点 / 防重复触发
        if (self.__restarting) return;
        self._restartConfirmDialog(function() {
            self.__restarting = true;
            self._restartOverlay();

            var steps = [
                [0,    '🔄 正在重启后台服务…', '正在结束旧进程并拉起新进程，请稍候'],
                [2500, '🔄 正在重启后台服务…', '旧进程已结束，等待新进程启动'],
                [6000, '🔄 正在重启后台服务…', '新进程启动中，正在初始化服务'],
                [12000,'🔄 还在重启，请再稍等…', '初始化耗时较长（模型/引擎加载中），继续等待']
            ];
            steps.forEach(function(st) {
                setTimeout(function() { self._restartOverlaySet(st[1], st[2]); }, st[0]);
            });

            var started = Date.now();
            // 带超时的 health 请求：重启间隙连接可能挂起不响应，
            // 无超时的 fetch 会永远 pending → 遮罩卡死在"还在重启"。
            function hFetch() {
                var ctl = new AbortController();
                var t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 4000);
                return fetch('/api/health', { cache: 'no-store', signal: ctl.signal })
                    .finally(function () { clearTimeout(t); });
            }
            fetch('/api/restart_server', { method: 'POST' })
                .then(function(r) { return r.json(); })
                .catch(function() { return { ok: true }; })  // 服务器退出时请求会失败，属正常
                .then(function() {
                    // 阶段一：先等旧进程真正退出（health 请求失败才算），避免旧服务器还没死就误报"已恢复"
                    var downStart = Date.now();
                    function waitDown() {
                        var waited = Math.round((Date.now() - started) / 1000);
                        self._restartOverlaySet('🔄 正在重启后台服务…', '正在结束旧进程…（' + waited + ' 秒）');
                        hFetch()
                            .then(function() {
                                // 还能连上 = 旧进程还活着，1.2 秒后再查
                                if (Date.now() - downStart > 25000) { startPolling(); return; } // 兜底：25 秒还没死也进入等待恢复
                                setTimeout(waitDown, 1200);
                            })
                            .catch(function() { startPolling(); }); // 连不上了 = 旧进程已退出
                    }
                    // 阶段二：轮询等新后台恢复（最长 90 秒）
                    function startPolling() {
                    var tries = 0;
                    var timer = setInterval(function() {
                        tries++;
                        var waited = Math.round((Date.now() - started) / 1000);
                        self._restartOverlaySet('🔄 正在重启后台服务…', '等待恢复中（' + waited + ' 秒）');
                        hFetch()
                            .then(function(r) { return r.json(); })
                            .then(function(h) {
                                if (h && h.ok) {
                                    clearInterval(timer);
                                    self.__restarting = false;
                                    self._restartOverlaySet('✅ 后台已恢复', '重启用时 ' + waited + ' 秒，前台页面保持不动，界面即将继续使用…', '#2ecc71');
                                    var ring = document.getElementById('zfRestartRing');
                                    if (ring) { ring.style.background = 'conic-gradient(from 0deg, transparent 0%, #2ecc71 30%, transparent 60%)'; ring.style.filter = 'drop-shadow(0 0 10px rgba(46,204,113,.9))'; }
                                    setTimeout(function() { self._restartOverlayFadeOut(); }, 900);
                                } else if (tries > 45) {
                                    clearInterval(timer);
                                    self.__restarting = false;
                                    self._restartOverlayFail('已等待超过 90 秒。后台可能仍在启动，或启动失败——点击本提示刷新页面重试。');
                                }
                            })
                            .catch(function() {
                                if (tries > 45) {
                                    clearInterval(timer);
                                    self.__restarting = false;
                                    self._restartOverlayFail('已等待超过 90 秒。后台可能仍在启动，或启动失败——点击本提示刷新页面重试。');
                                }
                            });
                    }, 2000);
                    }
                    setTimeout(waitDown, 1500); // 先给响应送达 + os._exit 留时间
                });
        });
    },

    _checkNetworkStatus: function() {
        fetch('/api/network_guard', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                var badge = document.getElementById('netRestartBadge');
                if (!badge) return;
                if (d && d.down_seconds > 60) {
                    badge.style.display = 'block';
                    var mins = Math.floor(d.down_seconds / 60);
                    if (window.App && App._showStormToast) App._showStormToast('🌐 上游网络已断开 ' + mins + ' 分钟' +
                        (d.down_seconds >= 600 ? '，即将自动重启后台' : '，若持续10分钟将自动重启后台'), 'error');
                } else {
                    badge.style.display = 'none';
                }
            })
            .catch(function() {});
    }
});

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        if (typeof App !== 'undefined' && App._netRestartInit) {
            App._netRestartInit();
        }
    }, 1500);
});
