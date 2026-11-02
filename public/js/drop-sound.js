/**
 * drop-sound.js —— 工具+1 心跳音效（Web Audio 合成，无需音频文件）
 *
 * v2 改进：
 * 1. 音色升级：主音改为"玻璃风铃"质感（正弦 + 五度泛音 + 更短更脆的皮噪声），
 *    尾音加入柔和高频 shimmer，听起来清脆不闷、不刺耳；
 * 2. 空间感随"对话远近"变化：
 *    - 当前正在查看的对话（near）  → 明亮、近、干，音高高一点（像在耳边叮）
 *    - 其他活跃对话（mid）         → 稍低音高、稍带混响距离感
 *    - 空闲/后台对话（far）        → 音高更低、音量衰减、混响更多，像远处传来
 *    每个对话按 chatId 做音色微差（基于 chatId 哈希微调音高），不同会话声音不同。
 *
 * 对外接口不变：window._zfPlayDropSound(n, opts)
 *   n    : 水滴数量（1~5）
 *   opts : { distance: 'near'|'mid'|'far', chatId: 'xxx' }（均可省略，向后兼容）
 */
(function () {
  'use strict';

  var ctx = null;
  var unlocked = false;   // 是否已收到用户手势（浏览器自动播放策略要求）

  function getCtx() {
    // 浏览器自动播放策略：必须在用户手势后才能创建/恢复 AudioContext，
    // 未解锁前直接不创建，避免控制台警告
    if (!unlocked) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // 用户首次交互后解锁音频（多事件兜底，避免错过 pointerdown 后永久静音）
  function unlock() {
    unlocked = true;
    getCtx();
  }
  ['pointerdown', 'keydown', 'click', 'touchend'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { passive: true });
  });
  // 页面重新可见时也尝试恢复（浏览器后台挂起会 suspend）
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) getCtx();
  });

  // chatId → 稳定音色：不同对话用不同音阶基音+波形，差异明显
  var SCALES = [
    [262, 330, 392],   // 大三和弦（清亮）
    [294, 349, 440],   // 大二组合（圆润）
    [262, 311, 392],   // 小三和弦（柔和）
    [330, 415, 494],   // 偏高亮
    [233, 277, 349],   // 偏低沉
    [311, 392, 466]    // 明快
  ];
  var WAVE_TYPES = ['sine', 'triangle', 'sine', 'square', 'triangle', 'sine'];
  var _hashCache = {};
  function chatVoice(chatId) {
    if (!chatId) return { scale: SCALES[0], mul: 1, wave: 'sine' };
    if (_hashCache[chatId]) return _hashCache[chatId];
    var h = 0;
    for (var i = 0; i < chatId.length; i++) h = (h * 31 + chatId.charCodeAt(i)) % 997;
    var v = {
      scale: SCALES[h % SCALES.length],
      mul: 0.92 + (h % 9) * 0.02,          // 0.92 ~ 1.08 音高微差
      wave: WAVE_TYPES[h % WAVE_TYPES.length]
    };
    _hashCache[chatId] = v;
    return v;
  }

  // 距离档位参数：音高倍率、音量、混响湿度、皮噪声强度
  var DIST = {
    near: { pitch: 1.25, gain: 0.24, wet: 0.05, noise: 0.10, dur: 0.24 },
    mid:  { pitch: 1.0,  gain: 0.18, wet: 0.14, noise: 0.07, dur: 0.30 },
    far:  { pitch: 0.78, gain: 0.10, wet: 0.26, noise: 0.04, dur: 0.40 }
  };

  /** 播放一滴水滴 */
  function playOne(pitchScale, d, voice) {
    var ac = getCtx();
    if (!ac) return;

    var t = ac.currentTime;
    // 音阶三音之一为主音（随 +N 序号上行走音阶），再叠加对话音色与距离档位
    var idx = Math.min(2, Math.floor(Math.random() * 3));
    var base = voice.scale[idx] * (pitchScale || 1) * d.pitch;
    var dur = d.dur * (0.9 + Math.random() * 0.2);

    // ---- 主体：玻璃风铃感（正弦快速下滑 + 五度泛音）----
    var osc = ac.createOscillator();
    osc.type = voice.wave || 'sine';
    osc.frequency.setValueAtTime(base * 1.9, t);
    osc.frequency.exponentialRampToValueAtTime(base, t + 0.035);
    osc.frequency.exponentialRampToValueAtTime(base * 0.82, t + dur);

    var oscGain = ac.createGain();
    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.linearRampToValueAtTime(d.gain, t + 0.005);   // 更快的起音，更"脆"
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // 五度泛音（让声音"亮"而不是"闷"）
    var osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(base * 3.0, t);
    osc2.frequency.exponentialRampToValueAtTime(base * 2.5, t + dur * 0.6);
    var g2 = ac.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(d.gain * 0.22, t + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.55);

    // ---- 皮噪声：极短促，提供"嗒"的质感（越远越弱）----
    var noiseLen = Math.floor(ac.sampleRate * 0.04);
    var buf = ac.createBuffer(1, noiseLen, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 3);
    }
    var noise = ac.createBufferSource();
    noise.buffer = buf;

    var bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 7 + Math.random() * 400;
    bp.Q.value = 1.5;

    var noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(d.noise * (0.8 + Math.random() * 0.4), t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    // ---- 输出总线 + 混响感（越远湿度越大）----
    var out = ac.createGain();
    out.gain.value = 0.9;

    var delay = ac.createDelay(0.3);
    delay.delayTime.value = 0.07 + Math.random() * 0.02 + d.wet * 0.3;
    var fb = ac.createGain();
    fb.gain.value = 0.12 + d.wet * 0.5;
    var wet = ac.createGain();
    wet.gain.value = d.wet;

    osc.connect(oscGain).connect(out);
    osc2.connect(g2).connect(out);
    noise.connect(bp).connect(noiseGain).connect(out);
    out.connect(ac.destination);
    out.connect(delay); delay.connect(fb); fb.connect(delay);
    delay.connect(wet); wet.connect(ac.destination);

    osc.start(t); osc.stop(t + dur + 0.05);
    osc2.start(t); osc2.stop(t + dur + 0.05);
    noise.start(t);
  }

  /**
   * 对外接口：工具+1 时调用
   * @param {number} n          水滴数量
   * @param {object} [opts]     { distance:'near'|'mid'|'far', chatId:'xxx' }
   */
  window._zfPlayDropSound = function (n, opts) {
    try {
      opts = opts || {};
      var d = DIST[opts.distance] || DIST.mid;
      var voice = chatVoice(opts.chatId);
      n = Math.max(1, Math.min(n || 1, 5));
      for (var i = 0; i < n; i++) {
        // 连滴沿音阶上行（如 do-mi-so），悦耳且不同对话走不同音阶
        var scale = voice.mul * (1 + i * 0.12);
        setTimeout(function (s, dd) { playOne(s, dd, voice); }, i * 120, scale, d, voice);
      }
    } catch (e) { /* 静默失败，不影响主流程 */ }
  };
})();
