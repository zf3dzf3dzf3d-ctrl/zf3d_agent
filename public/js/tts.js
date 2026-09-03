/* ============================================================
 * tts.js — 朗读助手（微软 Edge Online TTS，无需安装任何插件）
 * - 顶栏 🔊 按钮开关，状态存 localStorage
 * - 开启时：任务成功(task_complete)后自动朗读结果前 30 字
 * - 优先使用微软在线语音（晓晓/云希等，音质好听），失败回退本地 TTS
 * ============================================================ */
(function () {
    'use strict';

    var KEY = 'zfagent_tts_enabled';
    var VOICE_KEY = 'zfagent_tts_voice';
    var VOLUME_KEY = 'zfagent_tts_volume';
    var LIMIT_KEY = 'zfagent_tts_limit';
    var READ_LIMIT = 30; // 默认只朗读前 30 个字（右键菜单可改）

    function getLimit() {
        var n = parseInt(localStorage.getItem(LIMIT_KEY), 10);
        return (n > 0 && n <= 500) ? n : READ_LIMIT;
    }

    function getVolume() {
        var v = parseFloat(localStorage.getItem(VOLUME_KEY));
        return isNaN(v) ? 1 : Math.min(1, Math.max(0, v));
    }

    // 微软在线音色（经 speech.platform.bing.com 合成，音质自然）
    var MS_VOICES = [
        'zh-CN-XiaoxiaoNeural',  // 晓晓 女声（默认）
        'zh-CN-YunxiNeural',     // 云希 男声
        'zh-CN-XiaoyiNeural',    // 晓伊 女声
        'en-US-AriaNeural'       // 英文 Aria
    ];

    function isEnabled() {
        var v = localStorage.getItem(KEY);
        // 默认开启：未设置过时视为开启，仅当明确存过 '0' 才算关闭
        return v === null ? true : v === '1';
    }

    function getVoice() {
        return localStorage.getItem(VOICE_KEY) || MS_VOICES[0];
    }

    function setIcon() {
        var btn = document.getElementById('ttsToggle');
        if (!btn) return;
        btn.textContent = isEnabled() ? '🔊' : '🔇';
        btn.style.opacity = isEnabled() ? '1' : '0.45';
        btn.title = isEnabled()
            ? '朗读助手：已开启（点击关闭）'
            : '朗读助手：已关闭（点击开启，朗读任务结果前30字）';
    }

    /* ---------- 取前 N 个"字"（中英文混合按字符计，英文按单词尽量凑齐30字符） ---------- */
    function first30(text) {
        var LIMIT = getLimit();
        var t = String(text || '').replace(/\s+/g, ' ').trim();
        if (!t) return '';
        // 去掉常见 markdown/emoji 前缀符号
        t = t.replace(/^✅|^❌|^\d+[.、]\s*/g, '').trim();
        if (t.length <= LIMIT) return t;
        // 避免把英文单词切一半：若截断点在字母中间则回退到上一个空格
        var cut = t.slice(0, LIMIT);
        if (/[A-Za-z]$/.test(cut) && /[A-Za-z]/.test(t[LIMIT])) {
            var sp = cut.lastIndexOf(' ');
            if (sp > 10) cut = cut.slice(0, sp);
        }
        return cut + '…';
    }

    /* ---------- 方案A：微软在线 TTS（Edge 朗读同款引擎，无需插件） ---------- */
    // Sec-MS-GEC 动态令牌：Win 文件时间取整到5分钟 + TrustedToken 的 SHA256（大写HEX）
    function genGecToken() {
        var WIN_EPOCH = 11644473600;
        var ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
        ticks -= ticks % 300;
        ticks *= 10000000;
        var str = String(ticks) + '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
            .then(function (h) {
                return Array.prototype.map.call(new Uint8Array(h), function (b) {
                    return ('0' + b.toString(16)).slice(-2);
                }).join('').toUpperCase();
            });
    }

    function msSpeak(text, onDone) {
        try {
            // 纯标点/无实际内容的文本不送 TTS（后端会报错），直接视为播完
            if (!/[A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) { onDone && onDone(); return; }
            // 走本地后端 /api/tts 代理（edge-tts 在线好声音），失败自动回退本地 TTS
            fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, voice: getVoice() })
            })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.arrayBuffer();
                })
                .then(function (buf) {
                    var blob = new Blob([buf], { type: 'audio/mpeg' });
                    var audio = new Audio(URL.createObjectURL(blob));
                    audio.volume = getVolume();
                audio.onended = onDone;
                    audio.play();
                    window.__ttsAudio = audio;
                })
                .catch(function () { fallbackSpeak(text, onDone); });
        } catch (e) { fallbackSpeak(text, onDone); }
    }

    /* ---------- 方案B：浏览器本地 TTS（回退） ---------- */
    function fallbackSpeak(text, onDone) {
        try {
            if (!('speechSynthesis' in window)) return;
            var u = new SpeechSynthesisUtterance(text);
            u.lang = 'zh-CN';
            u.rate = 1;
            u.pitch = 1;
            u.volume = getVolume();
            u.onend = onDone || null;
            speechSynthesis.cancel();
            speechSynthesis.speak(u);
        } catch (e) {}
    }

    /* ---------- 对外：朗读一段文本 ---------- */
    function speak(text) {
        if (!isEnabled()) return;
        var seg = first30(text);
        if (!seg) return;
        stop();
        msSpeak(seg, function () {});
    }

    function stop() {
        try {
            if (window.__ttsAudio) { window.__ttsAudio.pause(); window.__ttsAudio = null; }
            if ('speechSynthesis' in window) speechSynthesis.cancel();
        } catch (e) {}
    }

    function toggle() {
        if (isEnabled()) {
            localStorage.setItem(KEY, '0');
            stop();
        } else {
            localStorage.setItem(KEY, '1');
            // 浏览器要求用户手势解锁音频 —— 开启瞬间播一个空提示，顺便解锁
            try {
                var ac = new (window.AudioContext || window.webkitAudioContext)();
                ac.resume && ac.resume();
                var o = ac.createOscillator(), g = ac.createGain();
                g.gain.value = 0.0001; o.connect(g); g.connect(ac.destination);
                o.start(); o.stop(ac.currentTime + 0.01);
            } catch (e) {}
        }
        setIcon();
    }

    /* ---------- 右键设置菜单：音量 + 朗读字数 ---------- */
    function openMenu(e) {
        e.preventDefault();
        var old = document.getElementById('ttsMenu');
        if (old) old.remove();

        var menu = document.createElement('div');
        menu.id = 'ttsMenu';
        menu.style.cssText = 'position:fixed;z-index:99999;background:#1a1a2a;border:1px solid #3a3a55;'
            + 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.5);padding:14px 16px;'
            + 'width:240px;font:13px/1.5 sans-serif;color:#ccc;user-select:none;';

        var vol = Math.round(getVolume() * 100);
        var lim = getLimit();

        menu.innerHTML =
            '<div style="font-weight:bold;margin-bottom:10px;">🔊 朗读助手设置</div>'
            + '<div style="margin-bottom:6px;">音量：<span id="ttsVolVal">' + vol + '</span>%</div>'
            + '<input id="ttsVol" type="range" min="0" max="100" value="' + vol + '" style="width:100%;margin-bottom:12px;">'
            + '<div style="margin-bottom:6px;">朗读字数：<input id="ttsLim" type="number" min="1" max="500" value="' + lim
            + '" style="width:70px;padding:2px 6px;border:1px solid #44446a;border-radius:4px;background:#2b2b46;color:#ccc;"></div>'
            + '<button id="ttsOk" style="margin-top:10px;padding:4px 18px;border:none;border-radius:4px;'
            + 'background:#4a90d9;color:#fff;cursor:pointer;">确定</button>';

        document.body.appendChild(menu);

        var rect = btnEl().getBoundingClientRect();
        var x = Math.min(e.clientX, window.innerWidth - 260);
        var y = Math.min(e.clientY, window.innerHeight - 200);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        var volInput = menu.querySelector('#ttsVol');
        volInput.addEventListener('input', function () {
            menu.querySelector('#ttsVolVal').textContent = volInput.value;
            // 正在朗读时实时调节音量
            try {
                if (window.__ttsAudio) window.__ttsAudio.volume = Number(volInput.value) / 100;
            } catch (err) {}
        });

        menu.querySelector('#ttsOk').addEventListener('click', function () {
            localStorage.setItem(VOLUME_KEY, String(Number(volInput.value) / 100));
            var n = parseInt(menu.querySelector('#ttsLim').value, 10);
            if (n > 0 && n <= 500) localStorage.setItem(LIMIT_KEY, String(n));
            menu.remove();
            setIcon();
        });

        // 点击菜单外关闭
        setTimeout(function () {
            document.addEventListener('click', function closer(ev) {
                if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closer); }
            });
        }, 0);
    }

    function btnEl() { return document.getElementById('ttsToggle'); }

    /* ---------- 暴露全局 ---------- */
    window.TTS = {
        toggle: toggle,
        speak: speak,
        stop: stop,
        isEnabled: isEnabled,
        openMenu: openMenu
    };

    /* ---------- 初始化 ---------- */
    function bindMenu() {
        var btn = document.getElementById('ttsToggle');
        if (btn) btn.addEventListener('contextmenu', openMenu);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setIcon(); bindMenu(); });
    } else {
        setIcon();
        bindMenu();
    }
})();
