
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

﻿// ==== 拆分自 app-chatbox.js：防风暴提示（右上角轻提示，自动消失）_新建窗口尺寸记忆_创建对话框_Shift+左键 ====
Object.assign(App, {


        // ===== 防风暴提示（右上角轻提示，自动消失） =====
        _showStormToast: function(text, color) {
            try {
                var t = document.createElement('div');
                t.textContent = '🛡 ' + text;
                var bg = color || '#c0392b';
                t.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;background:' + bg + ';color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:system-ui,sans-serif;';
                document.body.appendChild(t);
                setTimeout(function() { t.remove(); }, 4000);
            } catch (e) { console.warn('[ChatBox] toast失败', e); }
        },

        // ===== 自定义确认对话框（替代 window.confirm 原生弹窗，风格与界面统一） =====
        _showCustomConfirm: function(opts) {
            try {
                opts = opts || {};
                var old = document.getElementById('zfCustomConfirm');
                if (old) old.remove();   // 同时只保留一个
                var overlay = document.createElement('div');
                overlay.id = 'zfCustomConfirm';
                overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
                var box = document.createElement('div');
                box.style.cssText = 'min-width:320px;max-width:440px;background:#2d2d2d;color:#eee;border:1px solid #444;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;';
                var title = document.createElement('div');
                title.textContent = opts.title || '提示';
                title.style.cssText = 'padding:10px 16px;font-size:13px;color:#aaa;border-bottom:1px solid #3a3a3a;';
                var body = document.createElement('div');
                body.textContent = opts.message || '';
                body.style.cssText = 'padding:16px;font-size:14px;line-height:1.7;white-space:pre-wrap;';
                var btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:0 16px 16px;';
                function mkBtn(text, primary, fn) {
                    var b = document.createElement('button');
                    b.textContent = text;
                    b.style.cssText = 'padding:8px 22px;border:none;border-radius:6px;font-size:13px;cursor:pointer;' +
                        (primary ? 'background:#1e88e5;color:#fff;' : 'background:#3a3a3a;color:#ddd;');
                    b.onmouseenter = function(){ b.style.filter = 'brightness(1.15)'; };
                    b.onmouseleave = function(){ b.style.filter = ''; };
                    b.onclick = function(){ close(); fn && fn(); };
                    return b;
                }
                function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', onKey); }
                function onKey(e) { if (e.key === 'Escape') { close(); opts.onCancel && opts.onCancel(); } }
                btnRow.appendChild(mkBtn(opts.cancelText || '取消', false, function(){ opts.onCancel && opts.onCancel(); }));
                btnRow.appendChild(mkBtn(opts.okText || '确定', true, function(){ opts.onOk && opts.onOk(); }));
                box.appendChild(title); box.appendChild(body); box.appendChild(btnRow);
                overlay.appendChild(box);
                document.body.appendChild(overlay);
                document.addEventListener('keydown', onKey);
            } catch (e) {
                console.warn('[ChatBox] 自定义确认框失败，退回原生 confirm', e);
                var ok = _dlgConfirmSync(opts && opts.message || '');
                if (ok) { opts && opts.onOk && opts.onOk(); } else { opts && opts.onCancel && opts.onCancel(); }
            }
        },

        // ===== 新建窗口尺寸记忆（localStorage 持久化，重启后依然生效） =====
        getLastBoxSize: function() {
            try {
                var pref = window.UserSettings && UserSettings.getDefaultChatBoxSize ? UserSettings.getDefaultChatBoxSize() : null;
                if (pref) return pref;
                var raw = UserSettings.get('zf3d_lastBoxSize');
                if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
                if (raw) {
                    var o = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                    if (o && typeof o.w === 'number' && typeof o.h === 'number' &&
                        o.w >= 280 && o.w <= 5000 && o.h >= 200 && o.h <= 5000) return o;
                }
            } catch (e) { }
            return null;
        },
        rememberBoxSize: function(w, h) {
            try {
                /* 专注模式下对话区是全屏宽，尺寸不代表普通布局，不记忆，避免新建对话变得很宽 */
                if (document.body && document.body.classList.contains('zf-focus')) return;
                if (w >= 280 && h >= 200) {
                    UserSettings.set('zf3d_lastBoxSize', JSON.stringify({ w: Math.round(w), h: Math.round(h) }));
                    if (window.UserSettings && UserSettings.setChatPreferences) UserSettings.setChatPreferences(null, { w: w, h: h }, null);
                }
            } catch (e) { }
        },


        // ===== 欢迎语构建（可在切换语言后重渲染）=====
        // 许愿空状态文案池（打开窗口随机取一，固化到 box._greetLine 防重渲染闪烁）
        _greetLines: function () {
            return [
                '朱峰带你飞',
                '开始许愿吧！我是灯神',
                '朱峰为你实现任何愿望，请许愿！',
                '来，开始许愿！',
                '你知道的一切都可以实现！',
                '不要害怕，你可以实现任何事情！',
                '让朱峰去思考，你负责指导！',
                '许下愿望，朱峰替你实现',
                '这里是许愿池，扔进你的问题',
                '灯神已上线，请说出你的愿望',
                '大胆说，朱峰接着',
                '每一个愿望都值得被实现',
                '把你的奇思妙想交给朱峰',
                '想到就能做到，开始许愿吧',
                '朱峰聆听中，请许愿',
                '愿望不分大小，尽管开口',
                '此刻起，你的想法会被实现',
                '灯神不打烊，随时来许愿',
                '说出愿望，剩下的交给朱峰',
                '你负责想象，朱峰负责实现',
                '这里没有不可能，只有没许的愿',
                '许一个愿，收获一个答案',
                '朱峰在线，等待你的愿望',
                '别让好点子沉睡，许个愿吧',
                '心有所愿，朱峰有所应',
                '把难题变成愿望，丢给朱峰',
                '许愿的入口就在这里',
                '你的一句话，朱峰的一份力',
                '勇敢许愿，朱峰为你圆梦',
                '愿望清单，从这一句开始'
            ];
        },
        _ensureGreetStyle: function () {
            if (document.getElementById('zf-greet-style')) return;
            var css = [
                '.chatbox-body .msg.ai[data-welcome]{',
                '  width:100%!important;max-width:100%!important;background:transparent!important;',
                '  border:none!important;box-shadow:none!important;padding:0!important;margin:0!important;',
                '  display:flex;align-items:center;justify-content:center;text-align:center;',
                '  position:relative;overflow:hidden;}',
                '.zf-empty-welcome{position:relative;width:100%;display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:center;gap:12px;padding:34px 16px 30px;}',
                '.zf-empty-welcome .zf-ew-logo{width:40px!important;height:40px!important;max-width:40px!important;object-fit:contain!important;flex:0 0 40px!important;z-index:1;filter:grayscale(1) brightness(1.1) drop-shadow(0 4px 14px rgba(160,160,160,.25));border-radius:12px;opacity:.85;}',
                '.zf-empty-welcome .zf-ew-text{z-index:1;font-size:20px;font-weight:600;letter-spacing:1px;color:#5a616c;line-height:1.4;white-space:nowrap;flex:0 1 auto;min-width:0;max-width:calc(100% - 60px);overflow:hidden;text-overflow:ellipsis;background:none!important;-webkit-background-clip:initial!important;-webkit-text-fill-color:#5a616c!important;text-shadow:none!important;animation:zfGreetBreath 4.5s ease-in-out infinite;}',
                // 低调呼吸动画（透明度轻微起伏，无彩色）
                '@keyframes zfGreetBreath{',
                '  0%,100%{opacity:.72;}',
                '  50%{opacity:1;}',
                '}',
                // 窄窗口自适应：文字单行放不下时缩小字号，保证始终横排一行、居中
                '@media (max-width:560px){',
                '  .zf-empty-welcome{gap:8px;}',
                '  .zf-empty-welcome .zf-ew-text{font-size:16px;letter-spacing:0;}',
                '}',
                '@media (max-width:440px){',
                '  .zf-empty-welcome .zf-ew-text{font-size:13px;max-width:calc(100% - 52px);}',
                '}',
                // 出生动画（仅容器带 .zf-birth 时播放，避免模型回填重渲染时反复重播）：
                // logo 旋转弹入（弹性曲线），文字随后模糊滑入（错落 0.4s）
                '.zf-empty-welcome.zf-birth .zf-ew-logo{animation:zfLogoBirth .7s cubic-bezier(.34,1.56,.64,1) both;}',
                '.zf-empty-welcome.zf-birth .zf-ew-text{animation:zfTextBirth .55s cubic-bezier(.22,1,.36,1) .42s both;}',
                // 用户提问后欢迎语立刻淡出+上移消失（带动画）
                '.chatbox-body .msg.ai[data-welcome].zf-welcome-hide{',
                '  animation:zfWelcomeFadeOut .32s ease forwards!important;',
                '  pointer-events:none;}',
                '@keyframes zfWelcomeFadeOut{',
                '  0%{opacity:1;transform:translateY(0) scale(1);}',
                '  100%{opacity:0;transform:translateY(-14px) scale(.96);}',
                '}',
                // 出生：logo 从左上旋转缩放弹入，带轻微过冲，与消失动画形成呼应
                '@keyframes zfLogoBirth{',
                '  0%{opacity:0;transform:translate(-22px,-14px) scale(.3) rotate(-35deg);}',
                '  60%{opacity:.85;transform:translate(2px,2px) scale(1.12) rotate(8deg);}',
                '  100%{opacity:.85;transform:translate(0,0) scale(1) rotate(0deg);}',
                '}',
                // 出生：文字从右侧模糊淡入滑到位
                '@keyframes zfTextBirth{',
                '  0%{opacity:0;transform:translateX(18px);filter:blur(6px);}',
                '  100%{opacity:1;transform:translateX(0);filter:blur(0);}',
                '}'
            ].join('\n');
            try {
                var st = document.createElement('style');
                st.id = 'zf-greet-style';
                st.textContent = css;
                document.head.appendChild(st);
            } catch (e) {}
        },
        // ===== 每日开工简报 + 温和召回（拉 /api/user/brief，异步填充欢迎语下方，可静默失败） =====
        _briefCache: null,
        _fetchBrief: function (cb) {
            if (this._briefCache) { cb(this._briefCache); return; }
            try {
                fetch('/api/briefing', { cache: 'no-store' })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (d && d.ok) cb(d); else cb(null); })
                    .catch(function () { cb(null); });
            } catch (e) { cb(null); }
        },
        _buildBriefLine: function (d) {
            // 温和召回措辞（池化，>2 天变"欢迎回来"），无损失厌恶元素；数据源 /api/briefing
            var b = d.briefing || d;
            var segs = [];
            if (b.daysAway === -1) {
                // 首次：不加召回语
            } else if (b.daysAway >= 2) {
                var pool = ['欢迎回来，接着上次继续', '好久不见，你的项目还在原地等你', '欢迎回来'];
                segs.push(pool[Math.floor(Math.random() * pool.length)]);
            } else if (b.daysAway >= 1) {
                segs.push('新的一天，昨日进度已就绪');
            }
            var plans = b.plans || [];
            if (plans.length > 0) {
                var p = plans[0];
                segs.push('「' + p.title + '」还有 ' + (p.total - p.done) + ' 步待做');
            }
            if (b.last_commit) {
                segs.push(String(b.last_commit).slice(0, 40));
            }
            var recs = b.recent_records || [];
            if (recs.length > 0 && segs.length < 3) {
                segs.push('最近在整理「' + recs[0] + '」');
            }
            // 资产仪表盘（阶段2）：让"越用越懂你"看得见，低调一行
            var s = b.stats || {};
            if (s.memoryTotal) {
                var bits = ['记忆 ' + s.memoryTotal + ' 条'];
                if (s.memoryWeek) bits.push('本周 +' + s.memoryWeek);
                if (s.plansActive) bits.push('进行中 ' + s.plansActive);
                if (s.daysTogether) bits.push('相伴 ' + s.daysTogether + ' 天');
                segs.push('[' + bits.join(' / ') + ']');
            }
            return segs.join(' · ');
        },
        _welcomeHtml: function (box) {
            this._ensureGreetStyle();  // 注入横排+透明背景样式（内部按 id 判重，多次调用安全）
            if (!box._greetLine) {
                var pool = this._greetLines();
                box._greetLine = pool[Math.floor(Math.random() * pool.length)];
            }
            var line = box._greetLine || '请开始您的许愿工程！';
            var logo = 'data:image/png;base64,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';  // 内联 base64，避免图片异步加载导致 logo 比文字慢半拍出现
            var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
            // 仅首次出生时挂 .zf-birth（播放入场动画）。
            // 用 rAF 延后置 done：同步的「模型回填重渲染」发生在首帧绘制前，
            // 浏览器只会绘制最终 DOM 一次，故这次仍带 birth、动画正常播一次；
            // 之后任何重渲染（切换语言/异步回填）不再重播。
            var birthCls = box._zfBIRTHDone ? '' : ' zf-birth';
            if (!box._zfBIRTHPending && !box._zfBIRTHDone) {
                box._zfBIRTHPending = true;
                try {
                    requestAnimationFrame(function () {
                        requestAnimationFrame(function () { box._zfBIRTHDone = true; });
                    });
                } catch (e) { box._zfBIRTHDone = true; }
            }
            return '<div class="zf-empty-welcome' + birthCls + '">' +
                '<img class="zf-ew-logo" src="' + logo + '" alt="朱峰" style="width:40px;height:40px;max-width:40px;object-fit:contain;border-radius:12px;opacity:.85;">' +
                '<div class="zf-ew-text">' + esc(line) + '</div>' +
                '</div>';
        },
        // 简报异步填充（在欢迎语插入 DOM 后调用；失败静默留空）
        _attachBrief: function (box) {
            var self = this;
            this._fetchBrief(function (d) {
                try {
                    if (!d || !box || !box.querySelector) return;
                    var el = box.querySelector('.zf-welcome-brief');
                    if (!el) return;
                    var line = self._buildBriefLine(d);
                    if (line) el.textContent = line;
                    if (d && d.briefing && d.briefing.milestone) {
                        self._celebrate(d.briefing.milestone);
                    }
                } catch (e) {}
            });
        },
        // ===== 里程碑轻庆祝（阶段3）：低调居中提示，几秒淡出，点一下即关，无惩罚 =====
        _celebrateShown: {},
        _celebrate: function (m) {
            try {
                if (!m || !m.title) return;
                if (this._celebrateShown[m.key]) return;
                this._celebrateShown[m.key] = true;
                var old = document.getElementById('zf-milestone-toast');
                if (old) old.parentNode.removeChild(old);
                var t = document.createElement('div');
                t.id = 'zf-milestone-toast';
                t.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);'
                    + 'z-index:99999;max-width:340px;padding:14px 20px;border-radius:14px;'
                    + 'background:rgba(28,30,36,.92);color:#e8ebf0;box-shadow:0 8px 30px rgba(0,0,0,.3);'
                    + 'text-align:center;font-size:14px;line-height:1.5;cursor:pointer;'
                    + 'opacity:0;transition:opacity .5s;backdrop-filter:blur(6px);';
                t.innerHTML = '<div style="font-size:22px;margin-bottom:4px;">✨</div>'
                    + '<div style="font-weight:600;">' + String(m.title) + '</div>'
                    + '<div style="color:#aeb4bf;font-size:12px;margin-top:3px;">' + String(m.msg || '') + '</div>';
                var dismiss = function () {
                    t.style.opacity = '0';
                    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 500);
                };
                t.addEventListener('click', dismiss);
                document.body.appendChild(t);
                requestAnimationFrame(function () { t.style.opacity = '1'; });
                setTimeout(dismiss, 4200);
            } catch (e) {}
        },
        // ===== 欢迎语消失：用户提问（消息插入）后带动画移除欢迎语卡片 =====
        // ===== 欢迎语守护：仅当对话框没有任何真实对话消息时才显示 =====
        // 一旦出现真实消息（用户/AI），欢迎语立刻带动画消失；恢复的空会话则补回欢迎语
        _ensureWelcomeGuard: function (box) {
            try {
                if (!box || box._zfWelcomeGuard) return;
                box._zfWelcomeGuard = true;
                var self = this;
                var body = box.querySelector('.chatbox-body');
                if (!body) return;
                var check = function () {
                    var w = body.querySelector('[data-welcome]');
                    var realMsgs = body.querySelectorAll('.msg:not([data-welcome])');
                    if (realMsgs.length > 0) {
                        // 已有对话内容 → 欢迎语必须消失
                        if (w) self._dismissWelcome(box);
                    } else if (!w && !box._zfWelcomeDismissed) {
                        // 空会话（如恢复后无消息）→ 补回欢迎语
                        var div = document.createElement('div');
                        div.className = 'msg ai';
                        div.setAttribute('data-welcome', '1');
                        div.innerHTML = self._welcomeHtml(box);
                        body.insertBefore(div, body.firstChild);
                    }
                };
                check();
                new MutationObserver(check).observe(body, { childList: true, subtree: true });
            } catch (e) {}
        },
        _dismissWelcome: function (box) {
            try {
                if (!box || !box.querySelector) return;
                box._zfWelcomeDismissed = true;
                var w = box.querySelector('[data-welcome]');
                if (!w || w._zfHiding) return;
                w._zfHiding = true;
                w.classList.add('zf-welcome-hide');
                var rm = function () { if (w.parentNode) w.parentNode.removeChild(w); };
                setTimeout(rm, 360);
                w.addEventListener('animationend', rm, { once: true });
            } catch (e) {}
        },
        // ===== 创建对话框 =====
        createChatBox: function(clientX, clientY, modelId, trustedSpawn) {
            // 【防风暴闸门】所有限流检查在分配 id 之前完成（否则 id 会被浪费性递增）
            var canvas0 = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            var cRect0 = canvas0.getBoundingClientRect();
            var self0 = this;

            var MAX_BOXES = 30;          // 画布窗口总量上限
            var CREATE_WINDOW_MS = 10000; // 频率窗口：10秒
            var MAX_PER_WINDOW = 8;      // 10秒内最多创建 8 个

            var now = Date.now();
            self0._createHistory = self0._createHistory || [];

            // 1) 总量上限：已有窗口 ≥ 30 时拒绝新建（用户双击画布会得到提示，关闭部分窗口后恢复）
            var boxesOnCanvas = document.querySelectorAll('.chatbox').length;
            if (boxesOnCanvas >= MAX_BOXES) {
                console.warn('[ChatBox] 窗口总量已达上限 ' + MAX_BOXES + '，拒绝新建（可能是程序失控，请检查）');
                self0._showStormToast('窗口已达上限 ' + MAX_BOXES + '，请先关闭部分窗口');
                return null;
            }

            // 2) 频率限制：10 秒内创建 > 8 个 → 判定为风暴，拒绝（窗口期过后自动恢复）
            // 【派单信任豁免】trustedSpawn=true（策划师/审核员/多角色等程序化派单链路）跳过频率闸门，总量上限仍生效
            self0._createHistory = self0._createHistory.filter(function(t) { return now - t < CREATE_WINDOW_MS; });
            if (!trustedSpawn && self0._createHistory.length >= MAX_PER_WINDOW) {
                console.warn('[ChatBox] 创建频率超限（10秒内 ' + self0._createHistory.length + ' 个），疑似风暴，已拦截');
                self0._showStormToast('创建过快，10秒后再试（防失控保护）');
                return null;
            }
            self0._createHistory.push(now); // 信任来源也计数（仅一次），防止真风暴刷爆总量

            // 【模型同步】每次打开智能体（新建对话）都触发一次官网模型配置同步，
            // 30 秒节流防刷（时间戳存 localStorage）；同步失败静默，不影响新建对话。
            try {
                var _now = Date.now();
                var _last = parseInt(localStorage.getItem('zf_model_sync_ts') || '0', 10) || 0;
                if (_now - _last > 30000) {
                    localStorage.setItem('zf_model_sync_ts', String(_now));
                    fetch('/api/models/refresh').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
                        if (!data) return;
                        try {
                            if (Models.load) Models.load();
                            var _cur = null;
                            try { _cur = box._modelId || modelId || ''; } catch (e) {}
                            if (_cur && Models.get && !Models.get(_cur)) {
                                // 当前线路已被官网下架 → 三级优先级找默认（官网下发 → 本地 isDefault），都没有则留空白等用户手选，绝不取第一个
                                var _all = Models.list ? Models.list() : [];
                                var _isZf = function (m) { return !!(m && (m.zfLine || m.zfManaged || m.zfPinned || m.keyRef === 'zf_token' || m.keyRef === 'server' || /127\.0\.0\.1:(8527|8559|8554|8787|8788)/.test(String(m.endpoint || '') + String(m.baseUrl || '')))); };
                                var _def = _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint && _isZf(m); }) || _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint; }) || null;
                                if (_def && box._modelId !== undefined) box._modelId = _def.id;
                            }
                        } catch (e) {}
                    }).catch(function () {});
                }
            } catch (e) {}
            // 【模型同步】同上：每次打开智能体都触发一次，30 秒节流。
            try {
                var _now2 = Date.now();
                var _last2 = parseInt(localStorage.getItem('zf_model_sync_ts') || '0', 10) || 0;
                if (_now2 - _last2 > 30000) {
                    localStorage.setItem('zf_model_sync_ts', String(_now2));
                    fetch('/api/models/refresh')
                        .then(function(res) { return res.json(); })
                        .then(function(r) {
                            if (r && r.ok && typeof Models.load === 'function') {
                                Models.load().then(function() {
                                    // 官网已下架当前线路 → 三级优先级找默认（官网下发 → 本地 isDefault），都没有则留空白等用户手选，绝不取第一个
                                    if (self.modelId && !Models.get(self.modelId)) {
                                        var _all = (typeof Models.list === 'function') ? (Models.list() || []) : (Models.list || []);
                                        var _isZf = (typeof Models !== 'undefined' && Models.isZfOfficial) ? Models.isZfOfficial : function (m) { return !!(m && (m.zfLine || m.zfManaged || m.zfPinned)); };
                                        var _def = _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint && _isZf(m); }) || _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint; }) || null;
                                        if (_def) { self.modelId = _def.id; self._modelIdOverride = _def.modelId || ''; }
                                    }
                                });
                            }
                        })
                        .catch(function() {});
                }
            } catch (e) { /* localStorage 不可用时静默跳过 */ }

            var canvas = canvas0;
            // 对话框 absolute 定位的参照容器就是 canvas（canvasContent），
            // 因此坐标须以 canvas 的 getBoundingClientRect() 为基准（画布可经 transform 平移/缩放）。
            var cRect = cRect0;
            var self = self0;

            var box = document.createElement('div');
            box.className = 'chatbox';
            box.id = this.nextBoxId();
            // 【鼠标跟随 + 视口钳制】未传坐标（或传 0/null）时回退到最近一次鼠标位置；
            // 再钳制到画布可视区内（按 scale 已含在 cRect 中），保证顶部/底部/左右不出屏
                            // 【信任派单守卫·v9】trustedSpawn 时传入的是画布逻辑坐标，可为负/超大，
                // 严禁用 !(>=0) 判空回退鼠标屏幕位置——画布平移后逻辑负坐标会被改成鼠标坐标，子窗飞走。
                if (!trustedSpawn && (!(clientX >= 0) || !(clientY >= 0))) {
                var _m = window.__zfLastMouse || {};
                clientX = (_m.clientX != null) ? _m.clientX : cRect.left + 100;
                clientY = (_m.clientY != null) ? _m.clientY : cRect.top + 60;
            }
            var _M = 8;                 // 屏幕边缘留白
            var _DEF_W = 380, _DEF_H = 140; // 新建框的默认估算尺寸（钳制用）
            // 【修复】画布经 transform: translate+scale(transformOrigin 0 0) 驱动，
            // canvasContent 的局部坐标 = (client坐标 - cRect左上) / scale。
            // 原实现漏除 scale，导致缩放/平移画布后新建框跑偏到原点附近的固定位置。
            var _scale = 1;
            try { _scale = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1; } catch (e) { _scale = 1; }
            if (!(_scale > 0)) _scale = 1;
            var _lx, _ly;
            if (trustedSpawn && typeof clientX === 'number' && typeof clientY === 'number') {
                /* 【信任派单·逻辑坐标】策划师/审核员等程序化派单传入的是画布逻辑坐标
                   （与 chat.el.style.left 同一坐标系），直接使用；
                   不能当屏幕坐标换算+视口钳制，否则画布平移/缩放后子窗跑到老远 */
                _lx = clientX;
                _ly = clientY;
            } else {
                _lx = (clientX - cRect.left) / _scale;
                _ly = (clientY - cRect.top) / _scale;
            }
            // 【修复】钳制基准改为「当前可见区域」的局部坐标范围，而非画布 [0, 全宽]。
            // 旧实现钳在 [8, 全宽-388]：画布平移后鼠标局部坐标（如 3000+）被硬拉回固定边界，
            // 表现为"新建框总出现在固定位置不跟鼠标"。
            // 可见区局部范围：canvasContent 原点在视口的偏移 = -translate，即
            // x ∈ [-tx/scale, (-tx + 可视宽)/scale]，translate 从 computed transform 矩阵读取。
            // 【信任派单钳制守卫·v8】trustedSpawn=true 时绝不允许任何可视区钳制改写逻辑坐标——
            // 实测（view.x=-40497 场景）传 41203 会被下方钳制改成 -40397（差 8 万），正是"子对话飞到很远"的元凶。
            // 只有鼠标/双击等屏幕坐标路径（trustedSpawn=false）才做可视区钳制。
            (function () {
                if (trustedSpawn) return;
                var _tx = 0, _ty = 0;
                try {
                    var _tr = getComputedStyle(canvas).transform;
                    if (_tr && _tr !== 'none') {
                        var _m = _tr.match(/matrix\(([^)]+)\)/);
                        if (_m) { var _p = _m[1].split(','); _tx = parseFloat(_p[4]) || 0; _ty = parseFloat(_p[5]) || 0; }
                    }
                } catch (e) {}
                var _visL = -_tx / _scale, _visT = -_ty / _scale;
                var _visR = _visL + cRect.width / _scale, _visB = _visT + cRect.height / _scale;
                var _EDGE = 8, _ESTW = 380, _ESTH = 140; // 边缘留白/新建框估算尺寸（局部作用域，避免遮蔽外层 _M/_DEF_W/_DEF_H）
                var _minX = Math.min(_visL + _EDGE, _visR - _ESTW - _EDGE);
                var _minY = Math.min(_visT + _EDGE, _visB - _ESTH - _EDGE);
                _lx = Math.max(_minX, Math.min(_lx, _visR - _ESTW - _EDGE));
                _ly = Math.max(_minY, Math.min(_ly, _visB - _ESTH - _EDGE));
            })();
            box.style.left = _lx + 'px';
            box.style.top = _ly + 'px';
            box.style.zIndex = ++this.zCounter;

            // 【用户习惯继承】未显式指定模型线路时，使用上次选择的大模型线路
            // （仅继承线路；模型ID覆盖/思考强度一律取所选线路自身的默认值，不继承上次对话的）
            // （持久化于 private/用户设置/user_settings.json，永久保留；仅影响新对话，不改老对话已有设置）
            var _habit = null;
            try {
                _habit = (window.UserSettings && UserSettings.get) ? UserSettings.get('lastModelSelection', null) : null;
            } catch (e) { _habit = null; }
            if (!modelId && _habit && _habit.modelId) {
                try {
                    if (Models.get(_habit.modelId)) modelId = _habit.modelId;
                } catch (e) { }
            }
            var model = modelId ? Models.get(modelId) : null;
            var boxName = model ? model.name : '未选择模型';
            // 新对话以右侧模型设置为初始快照；后续底部选择器的修改仅作用于本对话。
            // 【分层记忆】优先恢复该线路上次用户记住的 模型ID/思考强度（language 分类），无记忆才用线路默认值，
            // 保证新对话能记住用户上次选择，且模型ID与思考强度始终匹配该线路，不会串台。
            var initialModelIdOverride = model ? (model.modelId || '') : '';
            var initialReasoningEffort = model ? (model.reasoningEffort || ReasoningLevels.defaultValue()) : '';
            if (modelId) {
                try {
                    var _memSel = (window.UserSettings && UserSettings.get) ? (UserSettings.get('modelSelectionMemory', null) || {}) : {};
                    var _rec = (_memSel['language'] && _memSel['language'][modelId]) || null;
                    if (_rec) {
                        if (_rec.modelIdOverride) initialModelIdOverride = String(_rec.modelIdOverride);
                        if (_rec.reasoningEffort) initialReasoningEffort = String(_rec.reasoningEffort);
                    }
                    // 思考强度必须与该模型ID的合法档位匹配，否则回退默认档
                    var _reList = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(initialModelIdOverride, model) : null;
                    if (_reList && _reList.length) {
                        var _ok = _reList.some(function (it) { return it.value === initialReasoningEffort; });
                        if (!_ok) initialReasoningEffort = _reList[0].value;
                    }
                } catch (eMem) {}
            }
            // 修复（5.2.5）：新对话不再盲目继承上一个对话的模型ID覆盖/思考强度
            // （改用 modelSelectionMemory 分层记忆：分类→线路→各自记住的值，跨线路不会串台）。

            // 生成工具分类选择器（与恢复路径一致）
            var _newCatName = Tools.activeCategory || '极简';
            if (!Tools.categories[_newCatName]) _newCatName = '极简';
            Tools.chatCategories[box.id] = _newCatName;
            // 新对话引擎（默认引擎或第一个）→ 分类下拉按引擎过滤
            var _newEngId = '';
            try {
                var _de = (typeof DB !== 'undefined' && DB.getEngines && DB.getEngines().length)
                    ? (DB.getEngines().find(function (en) { return en.default; }) || DB.getEngines()[0]) : null;
                _newEngId = _de ? _de.id : '';
            } catch (e) {}

            box.innerHTML =
                App.buildChatboxPanels({
                    header: App.buildChatboxHeader({
                        title: '',
                        headerTitleAttr: '拖拽移动对话；Shift+左键拖拽：按下即在鼠标处复制一个一模一样的对话并跟随拖动',
                        extraBeforeButtons: '<span class="proj-name" style="display:none"></span>'
                    })
                });
                App.fillChatboxConfigWidgets(box, { engineId: '', categoryName: _newCatName });
                // 欢迎消息（新建对话专属，切换语言后自动重渲染）
                box.querySelector('.chatbox-body').innerHTML =
                    '<div class="msg ai" data-welcome="1">' + this._welcomeHtml(box) + '</div>';
                // 【守护】欢迎语只在无对话内容时显示；一旦有消息自动动画消失
                this._ensureWelcomeGuard(box);

            
            // 欢迎语上下文（供切换语言后重渲染使用）
            box._welcomeCtx = { model: model, mid: initialModelIdOverride || '', re: initialReasoningEffort || '', catName: _newCatName || '' };
            // 修复：首次渲染发生在 _welcomeCtx 赋值之前（此时 ctx 为空对象），
            // 导致即便模型已同步命中，欢迎语也会固化"未选择模型"。此处补一次同步重渲染。
            if (model) {
                try {
                    var _wb0 = box.querySelector('[data-welcome]');
                    if (_wb0) _wb0.innerHTML = self0._welcomeHtml(box);
                } catch (e) {}
            }

            // 修复（5.2.5）：Models.load() 为异步，新建对话瞬间模型库可能尚未加载完成，
            // 导致 Models.get() 返回 null → 欢迎语固化"未选择模型"。
            // 此处兜底：模型库加载完成后（轮询等待 _loaded），按 chat 实际模型回填并重渲染欢迎语。
            // 异步兜底：即便初次 model 为 null（模型库未加载完/习惯继承失败），只要存在
            // 期望的模型线路ID（显式传入的或习惯保存的线路），等模型库
            // 加载完成后回填并重渲染欢迎语，避免固化"未选择模型"。
            var _habitMid = (_habit && _habit.modelId) ? String(_habit.modelId) : '';
            if (!model && (initialModelIdOverride || modelId || _habitMid || _habit)) {
                (function _waitModelsReWelcome(tries) {
                    if (tries <= 0) return;
                    if (window.Models && Models._loaded) {
                        try {
                            if (!chat.modelId && _habitMid) chat.modelId = _habitMid;
                            // 修复（5.2.5）：不再用习惯里的 modelIdOverride 覆盖，
                            // 下方按线路默认回填，保证模型ID/思考强度与所选线路匹配。
                            var _m = Models.get(chat._modelIdOverride || chat.modelId) || null;
                            if (!_m && _habitMid) _m = Models.get(_habitMid) || null;
                            if (!_m) {
                                // 仍无具体模型时，尝试用右侧面板/默认模型兜底
                                try {
                                    var _ml = (Models.list && Models.list()) || [];
                                    if (_ml.length) _m = _ml.find(function (x) { return x && x.enabled !== false; }) || _ml[0];
                                } catch (e) {}
                            }
                            if (_m) {
                                chat.modelId = chat.modelId || _m.id;
                                if (!chat._modelIdOverride) chat._modelIdOverride = _m.modelId || '';
                                box._welcomeCtx.model = _m;
                                var _wb2 = box.querySelector('[data-welcome]');
                                if (_wb2) _wb2.innerHTML = self0._welcomeHtml(box);
                            }
                        } catch (e) {}
                        return;
                    }
                    setTimeout(function () { _waitModelsReWelcome(tries - 1); }, 200);
                })(50); // 最多等待 10 秒
            }


            
            try {
                document.addEventListener('i18n:changed', function () {
                    try {
                        var _wb = box.querySelector('[data-welcome]');
                        if (_wb && _wb.parentNode) _wb.innerHTML = self0._welcomeHtml(box);
                    } catch (e) { }
                });
            } catch (e) { }

            canvas.appendChild(box);
            // 【弹出动画】从点击位置缩放弹出的入场动画（transform-only，不影响布局/定位）
            box.classList.add('zf-box-open');
            setTimeout(function() { box.classList.remove('zf-box-open'); }, 300);

            // 新建窗口应用"最后激活窗口"的尺寸（localStorage 记忆，重启后依然生效）
            var lastSize = this.getLastBoxSize();
            if (lastSize) {
                box.style.width = Math.max(280, Math.min(lastSize.w, 5000)) + 'px';
                box.style.height = lastSize.h + 'px';
            }

            // 新会话直接继承用户习惯 JSON 中的默认压缩档位，避免首次发送前异步读取产生竞态。
            var compressionModes = { toolResults: 'minimal', historyAnswers: 'minimal' };
            try {
                if (window.UserSettings && UserSettings.getChatCompressionModes) {
                    compressionModes = UserSettings.getChatCompressionModes(box.id);
                }
            } catch (e) {}

            // 记录对话框状态
            var chat = {
                id: box.id,
                el: box,
                modelId: modelId,
                chatNum: this.chatCounter,
                history: [],
                createdAt: Date.now(),
                isSending: false,
                abortController: null,
                queue: [],
                _stopped: false,
                _compressMode: compressionModes.toolResults,
                _historyMode: compressionModes.historyAnswers,
                _modelIdOverride: initialModelIdOverride,
                _reasoningEffort: initialReasoningEffort,
                _engine: (typeof DB !== 'undefined' && DB._engine) ? String(DB._engine) : ''
            };
            this.chatBoxes.push(chat);

            // 自动归入项目（5.2.5 改版）：优先继承「上一个焦点对话」的项目，无焦点对话时才回退全局活动项目
            // 修复（5.0.2）：启动竞态窗口内 _activeProjectId 可能尚未从 DB 异步加载完成，
            // 导致新建对话丢失项目归属。兜底层级：
            //   0) 焦点对话的项目（5.2.5 新增：新建对话跟着上一个正在用的对话走）
            //   1) 内存值（正常路径，项目面板已加载）
            //   2) localStorage 同步读取（上次会话写入的永久备份，毫秒级可用）
            //   3) DB 异步拉取 + 延迟补归（前两层都为空时，拉到后回填内存并补归本对话）
            var _activePid = null;
            try {
                for (var _fi = 0; _fi < self.chatBoxes.length; _fi++) {
                    var _fc = self.chatBoxes[_fi];
                    if (_fc && _fc.el && _fc.el.classList.contains('active') && _fc.id !== chat.id) {
                        if (_fc.projectId) { _activePid = _fc.projectId; break; } // 无项目的焦点对话不拦截，继续找下一个
                    }
                }
            } catch (e) {}
            if (!_activePid) _activePid = self._activeProjectId || null;
            if (!_activePid) {
                try {
                    var _savedPid = localStorage.getItem('active_project_id');
                    if (_savedPid) {
                        _activePid = _savedPid;
                        self._activeProjectId = _savedPid; // 回填内存，本页后续新建直接命中
                    }
                } catch (e) {}
            }
            if (_activePid) {
                chat.projectId = _activePid;
                for (var _pi = 0; _pi < Store.data.chatBoxes.length; _pi++) {
                    if (Store.data.chatBoxes[_pi].id === chat.id) {
                        Store.data.chatBoxes[_pi].projectId = _activePid;
                        break;
                    }
                }
                if (typeof DB !== 'undefined' && DB.online) {
                    DB.setNodeProject(chat.id, _activePid).catch(function(e) { console.warn('[Chatbox] project link failed:', e); });
                }
                Store.addLog('info', chat.id, 'project-auto', '自动归入活动项目: ' + _activePid);
            } else if (typeof DB !== 'undefined' && DB.getActiveProject) {
                // 第三层兜底：异步拉取 DB 中的活动项目，拉到后补归（不阻塞对话框创建）
                DB.getActiveProject().then(function (res) {
                    if (!res || !res.ok || res.data === null || res.data === undefined) return;
                    var pid2 = res.data;
                    try { pid2 = JSON.parse(pid2); } catch (e) {}
                    if (!pid2) return;
                    // 回填内存 + localStorage，后续新建对话直接命中
                    self._activeProjectId = pid2;
                    try { localStorage.setItem('active_project_id', pid2); } catch (e) {}
                    // 补归当前对话：仅当它仍存活且仍无归属（用户未手动改派到其他项目）时
                    var alive = self.chatBoxes && self.chatBoxes.indexOf(chat) >= 0;
                    if (alive && !chat.projectId) {
                        chat.projectId = pid2;
                        for (var _pj = 0; _pj < Store.data.chatBoxes.length; _pj++) {
                            if (Store.data.chatBoxes[_pj].id === chat.id) {
                                Store.data.chatBoxes[_pj].projectId = pid2;
                                break;
                            }
                        }
                        if (typeof DB !== 'undefined') {
                            DB.setNodeProject(chat.id, pid2).catch(function () {});
                        }
                        if (typeof self._updateProjectBtn === 'function') self._updateProjectBtn(chat);
                        Store.addLog('info', chat.id, 'project-auto', '自动归入活动项目(延迟补归): ' + pid2);
                    }
                }).catch(function () {});
            }

            // 激活
            this.activate(box);

            // 绑定事件
            this.bindChatBox(box, chat);

            // 初始化项目按钮显示
            this._updateProjectBtn(chat);

            // 持久化（立即写入，防抖会因快关/刷新丢数据）
            Store.saveChatBox(chat, true);
            // 【修复】欢迎语（data-welcome）不写入持久化消息，避免重启恢复后进入对话上下文
            var _wm0 = box.querySelector('.msg:not([data-welcome])');
            if (_wm0) Store.addMessage(box.id, 'assistant', _wm0.textContent, 'text', chat.modelId);
            Store.addLog('info', box.id, 'create', '创建对话框，模型: ' + (boxName));

            // 更新状态栏
            if (typeof Tools !== 'undefined' && Tools.toolResultArchive) {
                delete Tools.toolResultArchive[chat.id];
            }
            this.updateStatus();
            this.hideHint();
            this.updateMinimap();

            // 【连击联动】新建对话框 = 一次打击（连击 +1，带爆裂特效）
            try { window.dispatchEvent(new CustomEvent('zf-combo-hit', { detail: { tool: '新建对话' } })); } catch (e) {}

            return chat;
        },

        // ===== Shift+左键拖拽复制对话 =====
        // 行为：按下瞬间（mousedown 且 shiftKey）立即创建一个副本对话（新对话 id、DB 单独一条会话记录），
        // 副本出现在鼠标按下的位置，随后鼠标继续拖拽时副本跟随鼠标移动（原对话不动），
        // 松开后副本停在松开位置。副本内容与原对话完全一致（含渲染方式）。
        cloneChatBox: function(srcChat, pressX, pressY) {
            var self = this;
            if (!srcChat || !srcChat.el) return null;

            // 0) 记录源对话当前信息（必须在创建副本前读取，创建后 DOM 会刷新）
            var srcTitleEl = srcChat.el.querySelector('.title');
            var srcTitle = srcTitleEl ? (srcTitleEl.textContent || '').trim() : ('对话' + (srcChat.chatNum || ''));
            var srcCollapsed = srcChat.el.classList.contains('collapsed');
            var srcModelId = srcChat.modelId || '';
            var srcModelIdOverride = srcChat._modelIdOverride || '';
            var srcReasoningEffort = srcChat._reasoningEffort || '';
            var srcProjectId = srcChat.projectId || null;
            var srcToolCat = (typeof Tools !== 'undefined' && Tools.chatCategories) ? (Tools.chatCategories[srcChat.id] || null) : null;
            var srcEngine = srcChat._engine || '';
            var srcW = srcChat.el.offsetWidth || 480;
            var srcH = srcChat.el.offsetHeight || 520;
            // 消息深拷贝（含 role/content/type/ts/model_id，保证渲染方式一致：final/text 等）
            var srcMsgs = (Store.getMessages(srcChat.id) || []).map(function(m) {
                var cp = {};
                for (var k in m) {
                    if (Object.prototype.hasOwnProperty.call(m, k)) cp[k] = m[k];
                }
                return cp;
            });
            // history 也复制一份（用于发送上下文）
            var srcHistory = (srcChat.history || []).map(function(h) { return { role: h.role, content: h.content }; });

            // 1) 按源对话的画布坐标创建副本，保持鼠标抓取点与原对话一致。
            var newChat = self.createChatBox(srcChat.x, srcChat.y, srcModelId);
            if (!newChat) return null;
            // 副本继承源对话已经独立设置的模型 ID 与思考强度。
            newChat._modelIdOverride = srcModelIdOverride;
            newChat._reasoningEffort = srcReasoningEffort;
            newChat._engine = srcEngine;
            if (typeof newChat._refreshModelPickerBtn === 'function') newChat._refreshModelPickerBtn();

            // 2) 覆盖项目归属：副本属于源对话同一个项目
            newChat.projectId = srcProjectId;
            for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                if (Store.data.chatBoxes[i].id === newChat.id) {
                    Store.data.chatBoxes[i].projectId = srcProjectId;
                    break;
                }
            }
            if (srcProjectId && typeof DB !== 'undefined' && DB.online) {
                DB.setNodeProject(newChat.id, srcProjectId).catch(function() {});
            }

            // 3) 覆盖工具分类（极简/编程/写作）
            if (srcToolCat && typeof Tools !== 'undefined' && Tools.chatCategories) {
                Tools.chatCategories[newChat.id] = srcToolCat;
                // 更新触发按钮显示
                try {
                    var trig = newChat.el.querySelector('.tool-cat-trigger');
                    var catObj = Tools.categories[srcToolCat];
                    if (trig && catObj) {
                        var ic = trig.querySelector('.tool-cat-icon');
                        var nm = trig.querySelector('.tool-cat-name');
                        if (ic) ic.textContent = catObj.icon || '📄';
                        if (nm) nm.textContent = srcToolCat;
                        // 重建下拉菜单并高亮当前分类
                        var menu = trig.nextElementSibling;
                        if (menu) {
                            var catList = Tools.getCategoryList(newChat.id, newChat._engine || '');
                            var catHtml = '';
                            catList.forEach(function(c) {
                                catHtml += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + c.name + '">' +
                                    '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                                    '<span class="tool-cat-item-name">' + c.name + '</span>' +
                                    '</div>';
                            });
                            menu.innerHTML = catHtml;
                        }
                    }
                } catch (e) {}
            }

            // 4) 尺寸/层级与源一致
            newChat.el.style.width = srcW + 'px';
            newChat.el.style.height = srcH + 'px';
            newChat.el.style.zIndex = (++this.zCounter);

            // 5) 折叠状态一致
            if (srcCollapsed) newChat.el.classList.add('collapsed');

            // 6) 标题与源一致（同一渲染方式，仅 id 不同）
            try {
                var newTitleEl = newChat.el.querySelector('.title');
                if (newTitleEl) newTitleEl.textContent = srcTitle;
                newChat.title = srcTitle;
            } catch (e) {}

            // 7) 用源消息完整替换初始欢迎消息：清空 DOM + Store + DB
            var body = newChat.el.querySelector('.chatbox-body');
            if (body) body.innerHTML = '';
            if (typeof Store.clearMessages === 'function') {
                Store.clearMessages(newChat.id);
            } else if (Store.data && Store.data.messages) {
                Store.data.messages[newChat.id] = [];
            }

            // 8) 逐条写入源消息（Store 内存 + SQLite 新会话；保留 role/type/ts，渲染方式与源一致）
            srcMsgs.forEach(function(m) {
                var role = m.role || 'user';
                var content = m.content || '';
                var type = m.type || 'text';
                var mModel = m.model_id || m.modelId || srcModelId || '';
                try {
                    if (typeof Store.addMessage === 'function') {
                        Store.addMessage(newChat.id, role, content, type, mModel);
                    } else {
                        if (!Store.data.messages[newChat.id]) Store.data.messages[newChat.id] = [];
                        Store.data.messages[newChat.id].push({ role: role, content: content, type: type, ts: m.ts || Date.now() });
                    }
                } catch (e) {
                    console.error('[cloneChatBox] 写入消息失败:', e);
                }
            });
            // DB 直接按原始 ts 归档（新会话 id，时间与源一致）
            if (Store.dbOnline && typeof DB !== 'undefined' && srcMsgs.length) {
                DB.clearChatHistory(newChat.id).then(function() {
                    srcMsgs.forEach(function(m) {
                        DB.addChatMessage(newChat.id, m.role || 'user', m.content || '', m.model_id || m.modelId || srcModelId || '', null, m.ts).catch(function() {});
                    });
                }).catch(function() {});
            }

            // 9) 用源的渲染方式逐条渲染到副本 DOM（分块异步渲染，和恢复对话路径一致）
            newChat.history = srcHistory.slice();
            if (srcMsgs.length) {
                var cbody = newChat.el.querySelector('.chatbox-body');
                if (cbody) {
                    var msgIdx = 0;
                    var CHUNK = 8;
                    (function renderChunk() {
                        var end = Math.min(msgIdx + CHUNK, srcMsgs.length);
                        var frag = document.createDocumentFragment();
                        for (; msgIdx < end; msgIdx++) {
                            var m = srcMsgs[msgIdx];
                            // 跳过工具调用日志（实际持久化字段为 role='tool_call'/type='tool'）与打字中占位
                            if (m.type === 'typing' || m.type === 'tool_call' || m.type === 'tool' || m.role === 'tool_call' || m.role === 'tool') continue;
                            var div = document.createElement('div');
                            var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                            div.className = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
                            self.setMsgContent(div, m.content, whoCls);
                            frag.appendChild(div);
                        }
                        cbody.appendChild(frag);
                        if (msgIdx < srcMsgs.length) {
                            requestAnimationFrame(renderChunk);
                        } else {
                            cbody.scrollTop = cbody.scrollHeight;
                        }
                        try { self._refreshUserMsgBtns(cbody); } catch (e) {}
                    })();
                }
            }

            // 10) 副本默认显示在源对话上方（y 坐标更高），避免完全重叠看不到新副本；
            //    保留鼠标在标题栏中的抓取偏移；新副本提升层级显示在原对话上方。
            try {
                var CLONE_OFFSET_Y = -32; // 负值 = 在源对话上方
                var sourceLeft = typeof srcChat.x === 'number' ? srcChat.x : srcChat.el.offsetLeft;
                var sourceTop = typeof srcChat.y === 'number' ? srcChat.y : srcChat.el.offsetTop;
                newChat.el.style.left = sourceLeft + 'px';
                newChat.el.style.top = (sourceTop + CLONE_OFFSET_Y) + 'px';
                newChat.el.style.zIndex = (++self.zCounter);
                newChat.x = sourceLeft;
                newChat.y = sourceTop + CLONE_OFFSET_Y;
            } catch (e) {
                console.warn('[Shift+拖拽] 初始位置设置失败:', e);
            }

            // 11) 持久化节点信息（含新 projectId / 标题 / 尺寸 / 位置）
            Store.saveChatBox(newChat);

            // 12) 日志 + 刷新视图
            Store.addLog('info', newChat.id, 'clone', 'Shift+拖拽复制对话（源: ' + srcChat.id + '，消息 ' + srcMsgs.length + ' 条）');
            if (typeof self.updateProjectView === 'function') { try { self.updateProjectView(); } catch (e) {} }
            if (typeof self.updateStatus === 'function') { try { self.updateStatus(); } catch (e) {} }
            if (typeof self.updateMinimap === 'function') { try { self.updateMinimap(); } catch (e) {} }

            return newChat;
        },
});
