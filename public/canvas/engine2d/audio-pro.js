// audio-pro.js — 音频进阶：BGM 交叉淡入淡出、音效对象池、音量分组、Node 无头可 Mock
"use strict";
class AudioManager {
  constructor() {
    this.ctx = null;                       // AudioContext（浏览器内懒建）
    this.groups = { master: 1, bgm: 0.8, sfx: 1, ui: 1 };   // 分组音量
    this._bgm = null;                      // {src, gain, name}
    this._sfxPool = [];                    // 空闲音效节点池
    this._poolSize = 8;
    this._mock = null;                     // 无头测试注入
  }
  _ensure() {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext !== "undefined") this.ctx = new AudioContext();
    else if (this._mock) { this.ctx = this._mock(); return this.ctx; }
    return this.ctx;
  }
  setVolume(group, v) { if (!(group in this.groups)) throw new Error("未知分组: " + group); this.groups[group] = Math.min(1, Math.max(0, v)); if (this._bgm && group === "bgm") this._bgm.gain.gain.value = v; }
  // BGM 播放 + 交叉淡入淡出切换（fadeOut 秒淡出旧的，fadeIn 秒淡入新的）
  playBGM(name, src, { fadeIn = 1, loop = true } = {}) {
    const ctx = this._ensure(); if (!ctx) return null;
    const stopOld = () => {
      if (!this._bgm) return;
      const old = this._bgm; this._bgm = null;
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + fadeIn);
      setTimeout(() => { try { old.src.stop(); } catch (e) {} }, fadeIn * 1000 + 50);
    };
    stopOld();
    const srcNode = ctx.createBufferSource ? ctx.createBufferSource() : ctx.createOscillator();
    if ("loop" in srcNode) srcNode.loop = loop;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    srcNode.connect(gain).connect(ctx.destination);
    try { srcNode.start(); } catch (e) {}
    gain.gain.linearRampToValueAtTime(this.groups.bgm, ctx.currentTime + fadeIn);
    this._bgm = { src: srcNode, gain, name };
    return this._bgm;
  }
  stopBGM(fadeOut = 1) {
    if (!this.ctx || !this._bgm) return;
    const old = this._bgm; this._bgm = null;
    old.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    old.gain.gain.setValueAtTime(old.gain.gain.value, this.ctx.currentTime);
    old.gain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + fadeOut);
    setTimeout(() => { try { old.src.stop(); } catch (e) {} }, fadeOut * 1000 + 50);
  }
  // 音效：优先从池里取，池满则复用最旧
  playSFX(name, { volume = 1, rate = 1 } = {}) {
    const ctx = this._ensure(); if (!ctx) return null;
    let n = this._sfxPool.pop();
    if (!n) n = { gain: ctx.createGain(), src: null };
    n.gain.gain.value = volume * this.groups.sfx * this.groups.master;
    if (n.gain) { try { n.gain.disconnect(); } catch (e) {} n.gain.connect(ctx.destination); }
    return { name, gain: n.gain, rate };
  }
  get sfxPoolFree() { return this._sfxPool.length; }
  get currentBGM() { return this._bgm ? this._bgm.name : null; }
}
if (typeof module !== "undefined") module.exports = { AudioManager };
