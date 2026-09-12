/**
 * drop-sound.js — 工具+1 轻鼓点音效（Web Audio 合成，无需音频文件）
 * 风格：温暖的小鼓"咚/噗"声，短促有弹性，好听不吵
 * 每次鼓声音高、衰减、力度都微微随机，听感统一但不重复
 * 批量多工具落地时连播（间隔 110ms，音高微微上行，最多 5 声防刷屏）
 * 需要用户首次交互后才出声（浏览器自动播放策略）
 */
(function () {
  'use strict';

  var ctx = null;

  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 解锁：首次交互后允许出声
  function unlock() { getCtx(); }
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  /**
   * 播放一颗轻鼓声
   * @param {number} pitchScale 音高缩放（1 = 正常，>1 音更高）
   */
  function playOne(pitchScale) {
    var ac = getCtx();
    if (!ac) return;

    var t = ac.currentTime;
    // 微随机：基频 170~200Hz（鼓腔感），每颗不同
    var base = (170 + Math.random() * 30) * (pitchScale || 1);
    var dur = 0.28 + Math.random() * 0.08;

    // ---- 鼓面主体：低频正弦，音高快速下滑（鼓的"弹性"感）----
    var osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(base, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(base * 0.75, t + dur);

    var oscGain = ac.createGain();
    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.linearRampToValueAtTime(0.22, t + 0.006); // 快速起音
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // ---- 鼓皮轻击：一段短噪声提供"皮"的质感 ----
    var noiseLen = Math.floor(ac.sampleRate * 0.05);
    var buf = ac.createBuffer(1, noiseLen, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 2.5);
    }
    var noise = ac.createBufferSource();
    noise.buffer = buf;

    var bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 6 + Math.random() * 300;
    bp.Q.value = 1.2;

    var noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.10 + Math.random() * 0.04, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

    // ---- 输出：轻微混响感（短延迟叠加）----
    var out = ac.createGain();
    out.gain.value = 0.9;

    var delay = ac.createDelay(0.2);
    delay.delayTime.value = 0.09 + Math.random() * 0.02;
    var fb = ac.createGain();
    fb.gain.value = 0.18;
    var wet = ac.createGain();
    wet.gain.value = 0.12;

    osc.connect(oscGain).connect(out);
    noise.connect(bp).connect(noiseGain).connect(out);
    out.connect(ac.destination);
    out.connect(delay); delay.connect(fb); fb.connect(delay);
    delay.connect(wet); wet.connect(ac.destination);

    osc.start(t);
    osc.stop(t + dur + 0.05);
    noise.start(t);
  }

  /** 对外接口：工具+1 时调用。n 为本次新增数量 */
  window._zfPlayDropSound = function (n) {
    try {
      n = Math.max(1, Math.min(n || 1, 5));
      for (var i = 0; i < n; i++) {
        // 音高微微上行，像连敲几下渐亮
        var scale = 1 + i * 0.06;
        setTimeout(function (s) { playOne(s); }, i * 110, scale);
      }
    } catch (e) { /* 静默失败，不影响主流程 */ }
  };
})();
