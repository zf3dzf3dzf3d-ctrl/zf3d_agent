// audio.js — 音频模块 v1.0：音效/背景音乐/音量控制（WebAudio，零素材可用合成音）
"use strict";
class AudioSys {
  constructor() {
    this.ctx = null;                 // 首次用户交互后创建（浏览器自动播放策略）
    this.master = null; this.sfxGain = null; this.musicGain = null;
    this.bgm = null;                 // 当前 bgm {src, el}
    this.volumes = { master: 1, sfx: 1, music: 0.6 };
    this._resumeHook();
  }

  _resumeHook() {
    const kick = () => { this._ensure(); if (this.ctx.state === "suspended") this.ctx.resume(); };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
  }

  _ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master);
    this.setVolume("master", this.volumes.master);
    this.setVolume("sfx", this.volumes.sfx);
    this.setVolume("music", this.volumes.music);
  }

  setVolume(channel, v) { // channel: master/sfx/music
    this.volumes[channel] = v;
    const node = channel === "master" ? this.master : channel === "sfx" ? this.sfxGain : this.musicGain;
    if (node) node.gain.value = v;
  }

  // 合成音效：无需素材。kind: hit/shoot/explode/pickup/jump
  play(kind, vol = 1) {
    this._ensure(); if (this.ctx.state === "suspended") return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    const P = {
      hit:     { w: "square",   f0: 220, f1: 80,  d: 0.12 },
      shoot:   { w: "sawtooth", f0: 700, f1: 160, d: 0.10 },
      explode: { w: "triangle", f0: 120, f1: 30,  d: 0.45 },
      pickup:  { w: "sine",     f0: 500, f1: 1200, d: 0.15 },
      jump:    { w: "sine",     f0: 250, f1: 600, d: 0.15 },
      ui:      { w: "sine",     f0: 800, f1: 800,  d: 0.05 },
    }[kind] || { w: "sine", f0: 440, f1: 440, d: 0.1 };
    osc.type = P.w;
    osc.frequency.setValueAtTime(P.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(P.f1, 1), t + P.d);
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + P.d);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc.stop(t + P.d + 0.02);
  }

  // 播放背景音乐（文件 URL），loop=true 循环；传 null 停止
  bgmPlay(url, loop = true, vol) {
    this._ensure();
    this.bgmStop();
    const el = new Audio(url);
    el.loop = loop;
    if (vol != null) this.setVolume("music", vol);
    el.volume = 1; el.connect = () => {};
    // 用 MediaElementSource 挂到 musicGain 上控制音量
    try { const src = this.ctx.createMediaElementSource(el); src.connect(this.musicGain); }
    catch (e) { /* 已连接过则直接播 */ }
    el.play().catch(() => {});
    this.bgm = el;
  }
  bgmStop() { if (this.bgm) { this.bgm.pause(); this.bgm = null; } }
}
if (typeof module !== "undefined") module.exports = { AudioSys };
