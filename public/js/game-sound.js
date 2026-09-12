/* ============================================================
 * 朱峰社区 - 游戏声音引擎 (game-sound.js)
 * 基于 Web Audio API 的合成音效引擎，零音频文件依赖。
 * 任何 iframe 内游戏引入本文件即可获得音效能力：
 *   <script src="/js/game-sound.js"></script>
 *   GameSound.play('eat');  GameSound.music('bgm1'); GameSound.mute=true;
 * 浏览器要求音频必须在用户首次交互后才能启动，
 * 引擎会自动在第一次 keydown/mousedown/click 时 resume。
 * ============================================================ */
(function (global) {
  "use strict";

  let actx = null;
  let master = null;
  let musicGain = null;
  let musicTimer = null;
  let musicStep = 0;
  let currentTrack = null;

  const engine = {
    /** 总开关（静音） */
    mute: false,
    /** 音量 0~1 */
    volume: 0.5,

    _ensure() {
      if (actx) return true;
      try {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return false;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = engine.volume;
        master.connect(actx.destination);
        musicGain = actx.createGain();
        musicGain.gain.value = 0.35;
        musicGain.connect(master);
      } catch (e) { return false; }
      return true;
    },

    /** 自动解锁：在首次用户交互时恢复 AudioContext */
    unlock() {
      if (!engine._ensure()) return;
      if (actx.state === "suspended") actx.resume();
    },

    setVolume(v) {
      engine.volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = engine.mute ? 0 : engine.volume;
    },

    setMute(m) {
      engine.mute = !!m;
      if (master) master.gain.value = engine.mute ? 0 : engine.volume;
    },

    /**
     * 播放一个合成音效
     * @param {string} name 音效名
     */
    play(name) {
      if (engine.mute || !engine._ensure()) return;
      if (actx.state === "suspended") { actx.resume(); }
      const t = actx.currentTime;
      switch (name) {
        // 短促上扬"哔"——吃食物/得分
        case "eat": case "score": case "coin":
          _beep(880, 0.08, "square", t, 0.25);
          _beep(1320, 0.10, "square", t + 0.06, 0.2);
          break;
        // 低沉下滑——死亡/游戏结束
        case "die": case "gameover":
          _beep(220, 0.18, "sawtooth", t, 0.3);
          _beep(160, 0.22, "sawtooth", t + 0.15, 0.3);
          _beep(110, 0.35, "sawtooth", t + 0.32, 0.3);
          break;
        // 转向/移动嘀嗒
        case "move": case "turn":
          _beep(520, 0.03, "square", t, 0.08);
          break;
        // 暂停
        case "pause":
          _beep(440, 0.06, "triangle", t, 0.15);
          _beep(330, 0.08, "triangle", t + 0.07, 0.15);
          break;
        // 开始/启动，上升琶音
        case "start":
          [262, 330, 392, 523].forEach((f, i) =>
            _beep(f, 0.09, "square", t + i * 0.07, 0.2));
          break;
        // 升级/破纪录，胜利琶音
        case "win": case "levelup":
          [523, 659, 784, 1047, 1319].forEach((f, i) =>
            _beep(f, 0.12, "square", t + i * 0.09, 0.22));
          break;
        // 碰撞/撞击
        case "hit": case "crash":
          _noise(0.15, t, 0.35);
          _beep(120, 0.12, "sawtooth", t, 0.25);
          break;
        // 按钮点击
        case "click":
          _beep(700, 0.03, "triangle", t, 0.12);
          break;
        default:
          _beep(600, 0.05, "square", t, 0.15);
      }
    },

    /**
     * 简单芯片音乐循环（可选，给需要 BGM 的游戏）
     * @param {string} track 曲目名
     */
    music(track) {
      if (currentTrack === track) return;
      engine.stopMusic();
      if (!track || engine.mute || !engine._ensure()) return;
      currentTrack = track;
      const seq = {
        bgm1: [330, 0, 392, 0, 440, 0, 494, 440, 392, 0, 330, 0, 294, 0, 330, 0]
      }[track];
      if (!seq) return;
      musicStep = 0;
      musicTimer = setInterval(() => {
        if (engine.mute) return;
        const f = seq[musicStep % seq.length];
        if (f) _beep(f, 0.14, "triangle", actx.currentTime, 0.12, musicGain);
        musicStep++;
      }, 200);
    },

    stopMusic() {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      currentTrack = null;
    },

    /**
     * 自定义播放：完全控制音量与左右声道
     * @param {number} freq 频率 Hz
     * @param {object} opt {dur:秒, type:波形, vol:0~1, pan:-1左~1右, delay:秒}
     */
    tone(freq, opt) {
      if (engine.mute || !engine._ensure()) return;
      if (actx.state === "suspended") actx.resume();
      opt = opt || {};
      _beep(freq, opt.dur || 0.1, opt.type || "square",
            actx.currentTime + (opt.delay || 0), opt.vol || 0.2, null, opt.pan);
    },

    /**
     * 按声像播放内置音效（如游戏元素在屏幕左/右时）
     * @param {string} name 音效名
     * @param {number} pan -1(左) ~ 1(右)，0 居中
     * @param {number} vol 音量 0~1
     */
    playAt(name, pan, vol) {
      if (engine.mute || !engine._ensure()) return;
      if (actx.state === "suspended") actx.resume();
      const t = actx.currentTime;
      const p = Math.max(-1, Math.min(1, pan || 0));
      const v = vol;
      switch (name) {
        case "eat": case "score": case "coin":
          _beep(880, 0.08, "square", t, v || 0.25, null, p);
          _beep(1320, 0.10, "square", t + 0.06, v || 0.2, null, p);
          break;
        case "die": case "gameover":
          _beep(220, 0.18, "sawtooth", t, v || 0.3, null, p);
          _beep(160, 0.22, "sawtooth", t + 0.15, v || 0.3, null, p);
          _beep(110, 0.35, "sawtooth", t + 0.32, v || 0.3, null, p);
          break;
        case "move": case "turn":
          _beep(520, 0.03, "square", t, v || 0.08, null, p);
          break;
        case "start":
          _beep(440, 0.06, "triangle", t, v || 0.15, null, p);
          _beep(330, 0.08, "triangle", t + 0.07, v || 0.15, null, p);
          break;
        case "hit": case "crash":
          _noise(0.15, t, v || 0.35, p);
          _beep(120, 0.12, "sawtooth", t, v || 0.25, null, p);
          break;
        case "click":
          _beep(700, 0.03, "triangle", t, v || 0.12, null, p);
          break;
        default:
          _beep(600, 0.05, "square", t, v || 0.15, null, p);
      }
    }
  };

  // ---- 内部合成器 ----
  function _panNode(pan) {
    if (pan === undefined || pan === 0) return null;
    if (actx.createStereoPanner) {
      const p = actx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      return p;
    }
    return null; // 老浏览器不支持则忽略声像
  }

  function _beep(freq, dur, type, when, vol, dest, pan) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.2, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g);
    const p = _panNode(pan);
    g.connect(p || dest || master);
    if (p) p.connect(dest || master);
    o.start(when);
    o.stop(when + dur + 0.02);
  }

  function _noise(dur, when, vol, pan) {
    const len = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const g = actx.createGain();
    g.gain.value = vol || 0.2;
    src.connect(g);
    const p = _panNode(pan);
    g.connect(p || master);
    if (p) p.connect(master);
    src.start(when);
  }

  // ---- 自动解锁：首次任意交互即恢复音频上下文 ----
  ["keydown", "mousedown", "pointerdown", "touchstart", "click"].forEach(ev =>
    addEventListener(ev, () => engine.unlock(), { once: false, passive: true }));

  global.GameSound = engine;
})(window);
