// particles.js — 粒子系统（Canvas 2D，发射器配置驱动）
// ParticleEmitter({x,y,rate,life,speed,angle,spread,gravity,sizeStart,sizeEnd,
//                  colorStart,colorEnd,alphaStart,alphaEnd,fade,shape})
"use strict";
class Particle {
  constructor() { this.dead = true; }
  init(em, x, y) {
    const a = (em.angle + (Math.random() - 0.5) * em.spread) * Math.PI / 180;
    const sp = em.speed * (0.6 + Math.random() * 0.7);
    this.x = x + (Math.random() - 0.5) * (em.emitW || 0);
    this.y = y + (Math.random() - 0.5) * (em.emitH || 0);
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    this.life = em.life * (0.7 + Math.random() * 0.6); this.age = 0;
    this.size = em.sizeStart; this.dead = false;
    this.cs = em.colorStart; this.ce = em.colorEnd;
    this.alphaStart = em.alphaStart ?? 1; this.alphaEnd = em.alphaEnd ?? 0;
  }
  update(dt, g) {
    this.age += dt; if (this.age >= this.life) { this.dead = true; return; }
    this.vy += (g || 0) * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const t = this.age / this.life;
    this.size = this._s0 + (this._s1 - this._s0) * t;
  }
  draw(ctx) {
    const t = this.age / this.life;
    ctx.globalAlpha = this.alphaStart + (this.alphaEnd - this.alphaStart) * t;
    ctx.fillStyle = t < 0.5 ? this.cs : this.ce;
    ctx.beginPath(); ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class ParticleEmitter {
  constructor(cfg = {}) {
    this.x = cfg.x || 0; this.y = cfg.y || 0;
    this.rate = cfg.rate ?? 30;             // 每秒粒子数
    this.life = cfg.life ?? 1;              // 粒子寿命(秒)
    this.speed = cfg.speed ?? 120;
    this.angle = cfg.angle ?? -90;          // 度，-90 向上
    this.spread = cfg.spread ?? 30;
    this.gravity = cfg.gravity ?? 0;        // 发射器自身附加重力
    this.sizeStart = cfg.sizeStart ?? 4; this.sizeEnd = cfg.sizeEnd ?? 1;
    this.colorStart = cfg.colorStart ?? "#ff8"; this.colorEnd = cfg.colorEnd ?? "#f40";
    this.alphaStart = cfg.alphaStart ?? 1; this.alphaEnd = cfg.alphaEnd ?? 0;
    this.emitW = cfg.emitW || 0; this.emitH = cfg.emitH || 0;
    this.burst = cfg.burst || 0;            // 一次性爆发数量
    this.acc = 0; this.pool = []; this._defer = cfg.defer || null; // 无头测试注入
  }
  _mk() { let p = this.pool.find(p => p.dead); if (!p) { p = new Particle(); this.pool.push(p); } p.init(this, this.x, this.y); p._s0 = this.sizeStart; p._s1 = this.sizeEnd; return p; }
  update(dt) {
    if (this.burst > 0) { for (let i = 0; i < this.burst; i++) this._mk(); this.burst = 0; }
    this.acc += this.rate * dt;
    while (this.acc >= 1) { this._mk(); this.acc--; }
    for (const p of this.pool) if (!p.dead) p.update(dt, this.gravity);
    if (this._defer) this._defer(dt);
  }
  draw(ctx) { for (const p of this.pool) if (!p.dead) p.draw(ctx); }
  get aliveCount() { let n = 0; for (const p of this.pool) if (!p.dead) n++; return n; }
}

// 预设：火焰 / 烟雾 / 爆裂
const ParticlePresets = {
  fire: { rate: 60, life: 0.8, speed: 90, angle: -90, spread: 25, sizeStart: 6, sizeEnd: 1, colorStart: "#ffdd55", colorEnd: "#ff3300", gravity: -60 },
  smoke: { rate: 15, life: 2.2, speed: 30, angle: -90, spread: 40, sizeStart: 5, sizeEnd: 14, colorStart: "#888899", colorEnd: "#555566", alphaStart: 0.35, alphaEnd: 0, gravity: -20 },
  burst: { rate: 0, burst: 40, life: 0.6, speed: 260, angle: 0, spread: 360, sizeStart: 4, sizeEnd: 0.5, colorStart: "#ffee88", colorEnd: "#ff4422", gravity: 500 }
};
if (typeof module !== "undefined") module.exports = { ParticleEmitter, ParticlePresets };
