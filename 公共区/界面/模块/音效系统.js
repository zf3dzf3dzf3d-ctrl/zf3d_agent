/**
 * 音效系统 — Web Audio API 统一音效管理
 * 全局接口: playSound(name) / playSoundWithVolume(name, vol)
 * 开关: localStorage 'sfxEnabled' (默认开启), 设置面板中可切换
 * 音量: localStorage 'sfxVolume' (0~1, 默认0.3)
 */
(function() {
    'use strict';

    let _audioCtx = null;
    let _enabled = true;
    let _volume = 0.3;

    try {
        const saved = localStorage.getItem('sfxEnabled');
        if (saved === 'false') _enabled = false;
        const vol = localStorage.getItem('sfxVolume');
        if (vol !== null) _volume = Math.max(0, Math.min(1, parseFloat(vol)));
    } catch(e) {}

    function _getCtx() {
        if (!_audioCtx) {
            try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch(e) { return null; }
        }
        // 浏览器策略要求用户交互后才能恢复
        if (_audioCtx.state === 'suspended') _audioCtx.resume();
        return _audioCtx;
    }

    // 单音播放
    function _tone(freq, startTime, duration, type, peakGain) {
        const ctx = _getCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(peakGain * _volume, startTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
    }

    // 噪声播放（用于"嗖"声等）
    function _noise(startTime, duration, peakGain, filterFreq) {
        const ctx = _getCtx();
        if (!ctx) return;
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = filterFreq || 800;
        filter.Q.value = 2;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(peakGain * _volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start(startTime);
        source.stop(startTime + duration);
    }

    // 音效定义表
    const _sounds = {
        // Toast通知
        'toast-success': (ctx, t) => { _tone(880, t, 0.15, 'sine', 0.5); _tone(1318, t + 0.08, 0.18, 'sine', 0.4); },
        'toast-error':   (ctx, t) => { _tone(220, t, 0.25, 'square', 0.3); _tone(180, t + 0.12, 0.3, 'square', 0.25); },
        'toast-info':    (ctx, t) => { _tone(660, t, 0.12, 'sine', 0.35); },

        // 文件操作
        'file-create':   (ctx, t) => { _tone(523, t, 0.08, 'triangle', 0.4); _tone(784, t + 0.05, 0.1, 'triangle', 0.35); },
        'file-delete':   (ctx, t) => { _tone(400, t, 0.1, 'sawtooth', 0.25); _tone(300, t + 0.06, 0.12, 'sawtooth', 0.2); },
        'file-write':    (ctx, t) => { _tone(659, t, 0.06, 'triangle', 0.3); _tone(880, t + 0.04, 0.08, 'triangle', 0.25); },

        // 权限弹窗
        'permission':    (ctx, t) => { _tone(523, t, 0.12, 'sine', 0.4); _tone(659, t + 0.1, 0.12, 'sine', 0.4); _tone(784, t + 0.2, 0.15, 'sine', 0.35); },

        // 下载
        'download-start':(ctx, t) => { _tone(440, t, 0.1, 'sine', 0.3); },
        'download-done': (ctx, t) => { _tone(523, t, 0.1, 'sine', 0.4); _tone(659, t + 0.08, 0.1, 'sine', 0.4); _tone(784, t + 0.16, 0.15, 'sine', 0.35); },

        // 自动更新
        'update-found':  (ctx, t) => { _tone(880, t, 0.08, 'sine', 0.35); _tone(1047, t + 0.06, 0.08, 'sine', 0.35); _tone(1318, t + 0.12, 0.15, 'sine', 0.3); },
        'update-done':   (ctx, t) => { _tone(659, t, 0.1, 'sine', 0.4); _tone(880, t + 0.08, 0.1, 'sine', 0.4); _tone(1047, t + 0.16, 0.1, 'sine', 0.4); _tone(1318, t + 0.24, 0.2, 'sine', 0.35); },

        // AI对话
        'ai-thinking':   (ctx, t) => { _tone(440, t, 0.06, 'sine', 0.2); },
        'ai-done':       (ctx, t) => { _tone(587, t, 0.08, 'sine', 0.3); _tone(784, t + 0.06, 0.1, 'sine', 0.25); _tone(988, t + 0.14, 0.15, 'sine', 0.2); },

        // 路线图
        'roadmap-step':  (ctx, t) => { _tone(988, t, 0.06, 'triangle', 0.25); _tone(1318, t + 0.04, 0.08, 'triangle', 0.2); },
        'roadmap-done':  (ctx, t) => { _tone(659, t, 0.1, 'triangle', 0.35); _tone(880, t + 0.08, 0.1, 'triangle', 0.3); _tone(1047, t + 0.16, 0.12, 'triangle', 0.25); _tone(1318, t + 0.24, 0.2, 'triangle', 0.2); },

        // 通用
        'error':         (ctx, t) => { _tone(200, t, 0.15, 'square', 0.3); _tone(150, t + 0.1, 0.2, 'square', 0.25); },
        'success':       (ctx, t) => { _tone(784, t, 0.08, 'sine', 0.35); _tone(1047, t + 0.06, 0.12, 'sine', 0.3); },
        'tab-close':     (ctx, t) => { _tone(600, t, 0.04, 'triangle', 0.15); },
        'send':          (ctx, t) => { _noise(t, 0.12, 0.15, 1200); },

        // 水滴声（AI回复完成备选）
        'water-drop':    (ctx, t) => { _tone(880, t, 0.05, 'sine', 0.3); _tone(660, t + 0.03, 0.15, 'sine', 0.2); },

        // 点击
        'click':         (ctx, t) => { _tone(1000, t, 0.02, 'sine', 0.1); },
    };

    // 全局播放接口
    window.playSound = function(name, customVolume) {
        if (!_enabled) return;
        const ctx = _getCtx();
        if (!ctx) return;
        const fn = _sounds[name];
        if (!fn) return;
        const oldVol = _volume;
        if (customVolume !== undefined) _volume = Math.max(0, Math.min(1, customVolume));
        try { fn(ctx, ctx.currentTime); } catch(e) {}
        _volume = oldVol;
    };

    // 开关控制
    window.isSoundEnabled = function() { return _enabled; };
    window.setSoundEnabled = function(enabled) {
        _enabled = enabled;
        try { localStorage.setItem('sfxEnabled', enabled ? 'true' : 'false'); } catch(e) {}
    };
    window.getSoundVolume = function() { return _volume; };
    window.setSoundVolume = function(v) {
        _volume = Math.max(0, Math.min(1, v));
        try { localStorage.setItem('sfxVolume', String(_volume)); } catch(e) {}
    };

    // 初始化（首个用户交互后解锁音频）
    function _init() {
        const unlock = () => {
            const ctx = _getCtx();
            if (ctx && ctx.state === 'suspended') ctx.resume();
        };
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('keydown', unlock, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
