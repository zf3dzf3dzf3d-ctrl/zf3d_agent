/* ============================================================
 * kite-voice-chat.js — 风筝龙头语音聊天（一问一答）
 * 点击风筝龙头 → 右侧弹出轻量语音对话框。
 * - 语音输入：浏览器 Web Speech API（免费，Chrome/Edge）
 * - 回答：直接调用当前配置的大模型（不使用任何工具），提示词强制简短口语化
 * - 语音输出：复用后端 /api/tts（edge-tts 好声音），失败回退浏览器 TTS
 * - 说完自动听 → 自动答 → 自动继续听，形成实时对话感
 * ============================================================ */
(function () {
    'use strict';

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    var els = {};        // { panel, log, micBtn, status, closeBtn }
    var rec = null;      // 识别实例
    var listening = false;
    var wantStop = false;
    var busy = false;    // 正在请求模型/播放语音
    var history = [];    // [{role, content}] 轻量上下文（保留最近8条）
    var restartTimer = null;

    /* ---------- UI ---------- */
    function build() {
        if (els.panel) return;
        var p = document.createElement('div');
        p.className = 'kvc-panel';
        p.innerHTML =
            '<div class="kvc-head">' +
                '<span class="kvc-title">🪁 风筝语音聊天</span>' +
                '<button class="kvc-close" title="关闭">✕</button>' +
            '</div>' +
            '<div class="kvc-log"></div>' +
            '<div class="kvc-status">点击麦克风开始说话</div>' +
            '<div class="kvc-foot">' +
                '<button class="kvc-mic" title="语音输入（点击开始说话）"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button>' +
                '<input class="kvc-input" type="text" placeholder="输入消息，回车或点发送…">' +
                '<button class="kvc-send" title="发送">发送</button>' +
            '</div>';
        (document.body).appendChild(p);
        els.panel = p;
        els.log = p.querySelector('.kvc-log');
        els.micBtn = p.querySelector('.kvc-mic');
        els.status = p.querySelector('.kvc-status');
        els.input = p.querySelector('.kvc-input');
        els.sendBtn = p.querySelector('.kvc-send');
        p.querySelector('.kvc-close').addEventListener('click', function () { toggle(); });
        els.micBtn.addEventListener('click', function () {
            if (busy) { setStatus('正在回答，请稍等…'); return; }
            if (listening) stopListen(); else startListen();
        });
        function sendInput() {
            var t = (els.input.value || '').trim();
            if (!t || busy) return;
            els.input.value = '';
            askModel(t);
        }
        els.sendBtn.addEventListener('click', sendInput);
        els.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(); }
            e.stopPropagation();
        });
        // 防止点击面板触发画布/画布手势
        p.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        p.addEventListener('dblclick', function (e) { e.stopPropagation(); });
        loadPos();
        dragToMove();
    }

    function setStatus(t) { if (els.status) els.status.textContent = t; }

    function addMsg(role, text) {
        if (!els.log) return;
        var d = document.createElement('div');
        d.className = 'kvc-msg kvc-' + role;
        d.textContent = text;
        els.log.appendChild(d);
        els.log.scrollTop = els.log.scrollHeight;
    }

    /* ---------- 语音识别 ---------- */
    function startListen() {
        if (!SR) { setStatus('当前浏览器不支持语音识别，请用 Chrome / Edge'); return; }
        try {
            if (!rec) {
                rec = new SR();
                rec.lang = 'zh-CN';
                rec.interimResults = true;
                rec.continuous = false; // 说完一句自动结束，点麦克风才开始录音
                rec.onresult = onResult;
                rec.onerror = function (e) {
                    if (e.error === 'not-allowed') { setStatus('麦克风权限被拒绝'); listening = false; setMic(false); return; }
                    if (e.error !== 'no-speech' && e.error !== 'aborted') { setStatus('识别出错：' + e.error); }
                };
                rec.onend = function () {
                    // 说完一句话后 onend 触发：不自动重启，等用户再点麦克风
                    listening = false; setMic(false);
                };
            }
            wantStop = false;
            listening = true;
            setMic(true);
            setStatus('请说话…');
            try { rec.start(); } catch (_) {} // 已启动时忽略
        } catch (e) { listening = false; setMic(false); }
    }

    function stopListen() {
        wantStop = true;
        listening = false;
        setMic(false);
        clearTimeout(restartTimer);
        try { rec && rec.stop(); } catch (_) {}
        setStatus('已停止');
    }

    var pendingFinal = '';
    // 与普通对话语音输入一致的「发送」语音命令判定（同 voice-input.js）
    var KVC_SEND_RE = /^(?:请|帮我|给我|现在)?(?:发送消息|发送一下|发送出去|发送吧|发送|提交|送出|发出去|send)(?:吧|一下|消息)?$/i;
    var KVC_TRAIL_PUNCT_RE = /[。．.,，!！?？～~\s]+$/;
    function onResult(e) {
        var final = '', interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
            var r = e.results[i];
            if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
        }
        if (interim) setStatus('听到：' + interim);
        if (final) {
            final = final.trim();
            if (!final) return;
            pendingFinal = '';
            // 语音命令：整句话就是「发送/提交」→ 直接发送输入框内容（与普通对话一致）
            if (KVC_SEND_RE.test(final.replace(KVC_TRAIL_PUNCT_RE, '').trim())) {
                var t = (els.input.value || '').trim();
                if (t && !busy) {
                    els.input.value = '';
                    setStatus('已通过语音命令发送');
                    askModel(t);
                } else {
                    setStatus(t ? '正在回答，稍等…' : '输入框为空，没有可发送的内容');
                }
                return;
            }
            // 语音识别结果填入输入框，由用户点发送（和普通会话一样）
            els.input.value = final;
            setStatus('已识别，点击发送、回车，或说「发送」');
        }
    }

    /* ---------- 询问大模型（不使用工具，回答简短） ---------- */
    function pickModel() {
        try {
            if (!window.Models) return null;
            var list = (Models.list || []).filter(function (m) { return m && m.endpoint && m.visible !== false; });
            if (!list.length) return null;
            // 优先语言类默认模型，其次当前激活，再取第一个
            var m = null;
            try { if (Models.getDefaultFor) m = Models.get(Models.getDefaultFor('language')); } catch (_) {}
            if (!m && Models.activeId && Models.get) { try { m = Models.get(Models.activeId); } catch (_) {} }
            if (!m || !m.endpoint) m = list.find(function (x) { return x.key; }) || list[0];
            return (m && m.endpoint) ? m : null;
        } catch (e) { return null; }
    }

    function askModel(text) {
        var model = pickModel();
        if (!model) { setStatus('未配置可用模型'); addMsg('ai', '（还没有配置可用的模型，去设置里加一个吧）'); return; }
        listening = false; busy = true; setMic(false);
        setStatus('思考中…');
        addMsg('user', text);

        history.push({ role: 'user', content: text });
        history = history.slice(-8);

        var sys = '你是语音聊天助手。要求：1.回答必须极简，一般一到两句话、不超过40个字；2.口语化，像面对面聊天；3.不使用任何工具，直接回答；4.不用markdown、不用表情。';

        var payload = {
            model: model.modelId || model.model || model.id || '',
            messages: [{ role: 'system', content: sys }].concat(history),
            stream: false, temperature: 0.7, max_tokens: 120
        };
        var headers = { 'Content-Type': 'application/json' };
        try { var k = model.apiKey || model.key; if (k) headers['Authorization'] = 'Bearer ' + k; } catch (e) {}
        var useProxy = false;
        try { useProxy = /^https?:/.test(model.endpoint || '') && model.endpoint.indexOf(location.origin) !== 0; } catch (e) { useProxy = true; }
        var url = useProxy ? '/api/proxy' : model.endpoint;
        if (useProxy) payload = { _target_url: model.endpoint, _method: 'POST', _headers: headers, _body: payload };

        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) {
            return r.text().then(function (txt) {
                var data = null;
                try { data = JSON.parse(txt); } catch (e) {
                    console.warn('[风筝语音] 响应不是JSON：', txt.slice(0, 300));
                    return { __raw__: txt.slice(0, 200) };
                }
                return data;
            });
        }).then(function (data) {
            // /api/proxy 会包装成 {ok, status, data:{choices...}}，这里两种结构都兼容
            var root = (data && typeof data === 'object' && data.data && (data.data.choices || data.data.content)) ? data.data : data;
            var ans = '';
            try { ans = (root.choices && root.choices[0] && root.choices[0].message && root.choices[0].message.content) || root.content || ''; } catch (e) {}
            if (!ans) { // 兜底：在任意嵌套结构里找第一个有内容的 message/content
                try {
                    var found = JSON.stringify(data).match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                    if (found) ans = JSON.parse('"' + found[1] + '"');
                } catch (e) {}
            }
            if (!ans && data && data.error) { ans = '（请求出错：' + (typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error))).slice(0, 80) + '）'; }
            ans = String(ans || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\*\*/g, '').trim();
            if (!ans) { ans = '（模型没返回内容，再试一次吧）'; }
            history.push({ role: 'assistant', content: ans });
            history = history.slice(-8);
            addMsg('ai', ans);
            speak(ans, function () {
                // 播完回到空闲，等待用户下次说话/输入
                busy = false;
                setStatus('点击麦克风继续');
            });
        }).catch(function () {
            busy = false;
            addMsg('ai', '（网络出错，再试一次吧）');
            setStatus('请求失败');
        });
    }

    /* ---------- 语音合成 ---------- */
    var curAudio = null;
    function speak(text, onDone) {
        try { if (curAudio) { curAudio.pause(); curAudio = null; } } catch (e) {}
        try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
        // 纯标点/无实际内容的文本不送 TTS（后端会报错），直接视为播完
        if (!/[A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) { onDone && onDone(); return; }
        setStatus('🗣️ ' + text);
        fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, voice: getVoice() })
        }).then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.arrayBuffer();
        }).then(function (buf) {
            var audio = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' })));
            curAudio = audio;
            audio.onended = function () { curAudio = null; onDone && onDone(); };
            audio.onerror = function () { curAudio = null; fallbackSpeak(text, onDone); };
            audio.play();
        }).catch(function () { fallbackSpeak(text, onDone); });
    }

    function getVoice() {
        try { return localStorage.getItem('zfagent_tts_voice') || 'zh-CN-XiaoxiaoNeural'; } catch (e) { return 'zh-CN-XiaoxiaoNeural'; }
    }

    function fallbackSpeak(text, onDone) {
        try {
            if (!('speechSynthesis' in window)) { onDone && onDone(); return; }
            var u = new SpeechSynthesisUtterance(text);
            u.lang = 'zh-CN';
            u.onend = function () { onDone && onDone(); };
            u.onerror = function () { onDone && onDone(); };
            speechSynthesis.speak(u);
        } catch (e) { onDone && onDone(); }
    }

    /* ---------- 开关 / 拖动 ---------- */
    function setMic(on) { if (els.micBtn) els.micBtn.classList.toggle('on', on); }

    function toggle() {
        build();
        var show = !els.panel.classList.contains('show');
        els.panel.classList.toggle('show', show);
        if (show) placeNearHead();
        if (show) {
            setStatus('点击麦克风说话，或在输入框打字');
        } else {
            stopListen();
        }
    }

    /* 打开时把对话框定位到风筝龙头旁边（跟随龙头当前位置），龙头在画布坐标系，位置即视口坐标 */
    function placeNearHead() {
        try {
            if (els.panel.dataset.userMoved === '1') return; // 用户手动拖过就不再自动贴
            var headEl = document.querySelector('.kite-head');
            var hx = null, hy = null;
            if (headEl) {
                var r = headEl.getBoundingClientRect();
                hx = r.left; hy = r.bottom;
            }
            if (hx == null || (!hx && !hy)) { hx = innerWidth - 320; hy = innerHeight - 480; }
            var w = els.panel.offsetWidth || 300, h = els.panel.offsetHeight || 480;
            var left = Math.min(Math.max(8, hx + 46), innerWidth - w - 8);
            var top = Math.min(Math.max(8, hy + 8), innerHeight - h - 8);
            els.panel.style.left = left + 'px';
            els.panel.style.top = top + 'px';
            els.panel.style.right = 'auto';
            els.panel.style.bottom = 'auto';
        } catch (e) {}
    }

    function dragToMove() {
        var head = els.panel.querySelector('.kvc-head');
        var sx, sy, ox, oy, drag = false;
        head.addEventListener('pointerdown', function (e) {
            if (e.target.closest('.kvc-close')) return;
            drag = true;
            sx = e.clientX; sy = e.clientY;
            var r = els.panel.getBoundingClientRect();
            ox = r.left; oy = r.top;
            head.setPointerCapture && head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', function (e) {
            if (!drag) return;
            els.panel.dataset.userMoved = '1'; // 手动拖过后不再自动贴龙头
            els.panel.style.left = (ox + e.clientX - sx) + 'px';
            els.panel.style.top = (oy + e.clientY - sy) + 'px';
            els.panel.style.right = 'auto';
            els.panel.style.bottom = 'auto';
        });
        head.addEventListener('pointerup', function () {
            if (!drag) return;
            drag = false;
            try { localStorage.setItem('zf-kvc-pos', JSON.stringify({ l: els.panel.style.left, t: els.panel.style.top })); } catch (e) {}
        });
    }
    function loadPos() {
        try {
            var s = JSON.parse(localStorage.getItem('zf-kvc-pos') || 'null');
            if (s && s.l) { els.panel.style.left = s.l; els.panel.style.top = s.t; els.panel.style.right = 'auto'; els.panel.style.bottom = 'auto'; }
            if (s && s.w) { els.panel.style.width = s.w; els.panel.style.height = s.h; }
            /* 右下角拖拽调整大小后保存 */
            if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(function () {
                    try {
                        var o = JSON.parse(localStorage.getItem('zf-kvc-pos') || '{}');
                        o.w = els.panel.offsetWidth + 'px';
                        o.h = els.panel.offsetHeight + 'px';
                        localStorage.setItem('zf-kvc-pos', JSON.stringify(o));
                    } catch (e) {}
                }).observe(els.panel);
            }
        } catch (e) {}
    }

    window.KiteVoiceChat = { toggle: toggle };
})();
