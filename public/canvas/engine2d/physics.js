// physics.js — 简易 2D 物理系统 v1.0
// AABB 碰撞 + 圆形碰撞、重力/速度/加速度、刚体 + 冲量解算、布娃娃骨架接口
// 零依赖，Node 无头可测（window 缺失自动降级）
"use strict";

/* ============ 工具 ============ */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ============ 碰撞体 ============ */
class Collider {
  constructor(opts = {}) {
    this.type = opts.type || "aabb";     // 'aabb' | 'circle'
    this.x = opts.x || 0; this.y = opts.y || 0;
    // aabb: 半宽半高；circle: 半径
    this.hw = opts.hw ?? (opts.w !== undefined ? opts.w / 2 : 16);
    this.hh = opts.hh ?? (opts.h !== undefined ? opts.h / 2 : 16);
    this.r = opts.r ?? 12;
    this.isSensor = !!opts.isSensor;      // 传感器：只检测不响应
    this.tag = opts.tag || "";
  }
  // 世界坐标包围盒
  bounds(body) {
    const cx = body ? body.x : this.x, cy = body ? body.y : this.y;
    if (this.type === "circle") return { l: cx - this.r, t: cy - this.r, r: cx + this.r, b: cy + this.r };
    return { l: cx - this.hw, t: cy - this.hh, r: cx + this.hw, b: cy + this.hh };
  }
}

/* ============ 刚体 ============ */
let _bodyId = 0;
class RigidBody extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.id = ++_bodyId;
    this.vx = opts.vx || 0; this.vy = opts.vy || 0;
    this.ax = 0; this.ay = 0;
    this.mass = opts.mass ?? 1;
    this.invMass = this.mass === 0 ? 0 : 1 / this.mass;  // mass=0 静态体
    this.restitution = opts.restitution ?? 0.2;  // 弹性 0~1
    this.friction = opts.friction ?? 0.15;
    this.gravityScale = opts.gravityScale ?? 1;
    this.onGround = false;
    this.onHit = opts.onHit || null;   // (other, contact)=>{}
    this.angVel = 0; this.rot = 0;     // 布娃娃/倒地用
  }
  applyImpulse(ix, iy) {
    this.vx += ix * this.invMass;
    this.vy += iy * this.invMass;
  }
}

/* ============ 物理世界 ============ */
class World {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 980;    // px/s²（y 向下）
    this.bodies = [];
    this.bounds = null;                    // {l,t,r,b} 世界边界，可选
  }
  add(body) { this.bodies.push(body); return body; }
  remove(body) { const i = this.bodies.indexOf(body); if (i >= 0) this.bodies.splice(i, 1); }
  clear() { this.bodies.length = 0; }

  step(dt) {
    // 1. 积分
    for (const b of this.bodies) {
      if (b.invMass === 0) continue;
      b.vy += this.gravity * b.gravityScale * dt;
      b.vx += b.ax * dt; b.vy += b.ay * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.onGround = false;
    }
    // 2. 碰撞解算（简单双循环，demo 规模够用；>1000 体可换空间哈希）
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        this._resolve(this.bodies[i], this.bodies[j]);
      }
    }
    // 3. 世界边界
    if (this.bounds) {
      const { l, t, r, b } = this.bounds;
      for (const body of this.bodies) {
        if (body.invMass === 0) continue;
        const bb = body.bounds(body);
        if (bb.b > b) { body.y -= bb.b - b; body.vy = -body.vy * body.restitution; body.onGround = true; body.vx *= (1 - body.friction); }
        if (bb.l < l) { body.x += l - bb.l; body.vx = Math.abs(body.vx) * body.restitution; }
        if (bb.r > r) { body.x -= bb.r - r; body.vx = -Math.abs(body.vx) * body.restitution; }
      }
    }
  }

  _resolve(a, b) {
    const c = collide(a, b);
    if (!c) return;
    if (a.onHit) a.onHit(b, c);
    if (b.onHit) b.onHit(a, c);
    if (a.isSensor || b.isSensor || a.invMass === 0 && b.invMass === 0) return;

    // 位置修正（按质量比例推开）
    const totalM = a.invMass + b.invMass;
    if (totalM === 0) return;
    const pa = a.invMass / totalM, pb = b.invMass / totalM;
    a.x -= c.nx * c.depth * pa; a.y -= c.ny * c.depth * pa;
    b.x += c.nx * c.depth * pb; b.y += c.ny * c.depth * pb;

    // 冲量解算（沿法线）
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const velN = rvx * c.nx + rvy * c.ny;
    if (velN > 0) return; // 正在分离
    const e = Math.min(a.restitution, b.restitution);
    const jImp = -(1 + e) * velN / totalM;
    a.applyImpulse(-jImp * c.nx, -jImp * c.ny);
    b.applyImpulse(jImp * c.nx, jImp * c.ny);

    // 地面标记
    if (c.ny < -0.5) { a.onGround = true; }
    if (c.ny > 0.5) { b.onGround = true; }
    // 摩擦（沿切线）
    const tx = -c.ny, ty = c.nx;
    const velT = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    const fImp = -velT * Math.min(a.friction + b.friction, 1) / totalM;
    a.applyImpulse(-fImp * tx, -fImp * ty);
    b.applyImpulse(fImp * tx, fImp * ty);
  }
}

/* ============ 碰撞检测（返回法线/深度，null=不碰） ============ */
function collide(a, b) {
  if (a.type === "circle" && b.type === "circle") return _circleCircle(a, b);
  if (a.type === "aabb" && b.type === "aabb") return _aabbAabb(a, b);
  // 混合：圆 vs AABB（统一转成 circle(a) vs aabb(b)）
  const circ = a.type === "circle" ? a : b, box = a.type === "circle" ? b : a;
  const c = _circleAabb(circ, box);
  if (!c) return null;
  if (a.type === "aabb") { c.nx = -c.nx; c.ny = -c.ny; }  // 法线始终由 a 指向 b
  return c;
}

function _aabbAabb(a, b) {
  const A = a.bounds(a), B = b.bounds(b);
  const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l);
  const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t);
  if (ox <= 0 || oy <= 0) return null;
  return ox < oy
    ? { nx: A.cx !== undefined ? 0 : (a.x < b.x ? -1 : 1), ny: 0, depth: ox }
    : { nx: 0, ny: a.y < b.y ? -1 : 1, depth: oy };
}

function _circleCircle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy), rSum = a.r + b.r;
  if (dist >= rSum) return null;
  const d = dist || 0.0001;
  return { nx: dx / d, ny: dy / d, depth: rSum - dist };
}

function _circleAabb(c, b) {
  const B = b.bounds(b);
  const cx = clamp(c.x, B.l, B.r), cy = clamp(c.y, B.t, B.b);
  const dx = c.x - cx, dy = c.y - cy;
  const dist2 = dx * dx + dy * dy;
  if (dist2 > c.r * c.r) return null;
  if (dist2 < 1e-8) { // 圆心在盒内：推向最近边
    const left = c.x - B.l, right = B.r - c.x, top = c.y - B.t, bot = B.b - c.y;
    const m = Math.min(left, right, top, bot);
    if (m === left) return { nx: -1, ny: 0, depth: c.r + left };
    if (m === right) return { nx: 1, ny: 0, depth: c.r + right };
    if (m === top) return { nx: 0, ny: -1, depth: c.r + top };
    return { nx: 0, ny: 1, depth: c.r + bot };
  }
  const d = Math.sqrt(dist2);
  return { nx: dx / d, ny: dy / d, depth: c.r - d };
}

/* ============ 布娃娃（Ragdoll）接口 ============
   用距离约束把多个圆/胶囊刚体串成骨架，碰撞时倒地晃动。
   后期骨骼动画(skeleton.js)驱动时可把每个 Bone 映射成一个 Body。 */
class DistanceJoint {
  constructor(a, b, opts = {}) {
    this.a = a; this.b = b;
    this.len = opts.len ?? Math.hypot(b.x - a.x, b.y - a.y);
    this.stiffness = opts.stiffness ?? 0.8;  // 0~1，1=硬约束
  }
  solve() {
    const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const diff = (dist - this.len) / dist * this.stiffness;
    const totalM = this.a.invMass + this.b.invMass;
    if (totalM === 0) return;
    const ma = this.a.invMass / totalM, mb = this.b.invMass / totalM;
    this.a.x += dx * diff * ma; this.a.y += dy * diff * ma;
    this.b.x -= dx * diff * mb; this.b.y -= dy * diff * mb;
  }
}

class Ragdoll {
  constructor(world, x, y, opts = {}) {
    this.world = world;
    const scale = opts.scale ?? 1;
    const mk = (dx, dy, r) => world.add(new RigidBody({
      type: "circle", x: x + dx * scale, y: y + dy * scale, r: r * scale,
      mass: 0.3, restitution: 0.1, friction: 0.6, tag: "ragdoll"
    }));
    // 头/躯干/臀 + 双腿（简易人形）
    this.head = mk(0, -34, 9);
    this.chest = mk(0, -16, 8);
    this.hips = mk(0, 0, 8);
    this.footL = mk(-6, 26, 5);
    this.footR = mk(6, 26, 5);
    this.joints = [
      new DistanceJoint(this.head, this.chest, { len: 18 * scale }),
      new DistanceJoint(this.chest, this.hips, { len: 16 * scale }),
      new DistanceJoint(this.hips, this.footL, { len: 26 * scale, stiffness: 0.5 }),
      new DistanceJoint(this.hips, this.footR, { len: 26 * scale, stiffness: 0.5 }),
    ];
  }
  // 每帧在世界 step 之后调用（或挂到 World.onAfterStep）
  solve() { for (const j of this.joints) j.solve(); }
  destroy() { for (const b of [this.head, this.chest, this.hips, this.footL, this.footR]) this.world.remove(b); }
}

// 让 World 自动解 Ragdoll 关节
const _origStep = World.prototype.step;
World.prototype.step = function (dt) {
  _origStep.call(this, dt);
  for (const r of (this.ragdolls || [])) r.solve();
};
World.prototype.addRagdoll = function (rd) {
  (this.ragdolls || (this.ragdolls = [])).push(rd); return rd;
};

/* ============ 导出（浏览器 + Node 双端） ============ */
const Physics = { Collider, RigidBody, World, Ragdoll, DistanceJoint, collide };
if (typeof window !== "undefined") window.Physics = Physics;
if (typeof module !== "undefined") module.exports = Physics;
