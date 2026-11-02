// core.js — 游戏核心功能包 v1.0
// 提供：EntityManager(实体/对象池) / SceneManager(场景+状态机) / Save(存档JSON+服务端SQLite)
//       UIManager(Button/HPBar/Panel) / CollisionSystem(圆/AABB/触发器+onHit)
//       Camera 增强（多目标跟随/死区/震动 已并入此处 CameraEx） / Config(数值配置表+热更)
// 零依赖，Node 无头可测（Save/Config 走 localStorage 时自动降级）
"use strict";

/* ================= 1. 实体/对象管理 ================= */
class Entity {
  constructor(x = 0, y = 0) {
    this.x = x; this.y = y;
    this.dead = false;            // 延迟销毁标记
    this.tags = new Set();        // 标签分组
    this.scene = null;            // 所属场景
  }
  tag(...ts) { this.tags.add(...ts); return this; }
  has(t) { return this.tags.has(t); }
  update(dt) {}
  onDestroy() {}                  // 销毁前回调（回收/清理资源）
}

class EntityManager {
  constructor() { this.list = []; this._pool = new Map(); }
  add(e) { if (!(e instanceof Entity)) throw new Error("add 需要 Entity 实例"); e.scene = this; this.list.push(e); return e; }
  // 按标签查询（遍历，demo 规模够用）
  byTag(t) { return this.list.filter(e => !e.dead && e.has(t)); }
  count() { let n = 0; for (const e of this.list) if (!e.dead) n++; return n; }
  // 对象池：spawn(cls, ...args)，死亡实体回收复用，避免频繁 GC
  spawn(cls, ...args) {
    const key = cls.name;
    const pool = (this._pool[key] = this._pool[key] || []);
    let e = pool.pop();
    if (e) { Object.assign(e, { dead: false }); if (args[0] !== undefined) e.x = args[0]; if (args[1] !== undefined) e.y = args[1]; }
    else e = new cls(...args);
    return this.add(e);
  }
  kill(e) { if (!e.dead) e.dead = true; }
  // 每帧：更新活实体，收集死实体回收入池
  update(dt) {
    const dead = [];
    for (const e of this.list) {
      if (e.dead) { dead.push(e); continue; }
      e.update(dt);
      if (e.dead) dead.push(e);
    }
    for (const e of dead) {
      e.onDestroy();
      const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1);
      const pool = this._pool[e.constructor.name];
      if (pool && pool.length < 200) pool.push(e);   // 池上限防无限膨胀
    }
  }
}

/* ================= 2. 场景 + 状态机 ================= */
class Scene {
  constructor(name) { this.name = name; this.em = new EntityManager(); this.engine = null; }
  onEnter() {} onExit() {}          // 栈式暂停时走 onPause/onResume
  onPause() {} onResume() {}
  update(dt) { this.em.update(dt); }
  render(r) {}
}

class SceneManager {
  constructor(engine) {
    this.engine = engine;
    this.scenes = new Map();
    this.current = null;
    this._stack = [];               // 暂停栈：push 场景后返回时恢复
  }
  register(scene) { this.scenes.set(scene.name, scene); scene.engine = this.engine; return scene; }
  change(name) {                   // 一行切换，自动 onExit/onEnter
    if (this.current) this.current.onExit();
    this._stack.length = 0;
    this.current = this.scenes.get(name);
    if (!this.current) throw new Error("场景未注册: " + name);
    this.current.onEnter();
    return this.current;
  }
  push(name) {                     // 栈式进入（如 游戏->暂停菜单），底层场景冻结
    const s = this.scenes.get(name);
    if (!s) throw new Error("场景未注册: " + name);
    if (this.current) { this.current.onPause(); this._stack.push(this.current); }
    this.current = s; s.onEnter();
  }
  pop() {                          // 返回上一层（onResume 恢复）
    const s = this._stack.pop();
    if (s) { this.current.onExit(); this.current = s; s.onResume(); }
    return s;
  }
  update(dt) { if (this.current) this.current.update(dt); }
  render(r) { if (this.current) this.current.render(r); }
}

/* ================= 3. 存档系统 ================= */
// 本地 JSON（localStorage），有后端时走 /api/save 落 SQLite
class Save {
  static _ls() { return (typeof localStorage !== "undefined") ? localStorage : null; }
  static putLocal(key, data) {
    const ls = this._ls(); if (!ls) return false;
    ls.setItem("gengine_save_" + key, JSON.stringify({ t: Date.now(), d: data })); return true;
  }
  static getLocal(key) {
    const ls = this._ls(); if (!ls) return null;
    const s = ls.getItem("gengine_save_" + key);
    try { return s ? JSON.parse(s).d : null; } catch (e) { return null; }
  }
  static removeLocal(key) { const ls = this._ls(); if (ls) ls.removeItem("gengine_save_" + key); }
  static listLocal() {
    const ls = this._ls(); const out = [];
    if (ls) for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k.startsWith("gengine_save_")) out.push(k.slice(13)); }
    return out;
  }
  // 双通道：有 API_BASE 就同时写服务端 SQLite；失败不抛错（本地为准）
  static async save(key, data) {
    this.putLocal(key, data);
    if (typeof API_BASE !== "undefined" && API_BASE) {
      try {
        await fetch(API_BASE + "/api/save", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, data }) });
      } catch (e) { /* 离线降级 */ }
    }
    return true;
  }
  static async load(key) {
    if (typeof API_BASE !== "undefined" && API_BASE) {
      try {
        const r = await fetch(API_BASE + "/api/save?key=" + encodeURIComponent(key));
        const j = await r.json();
        if (j && j.ok && j.data !== null && j.data !== undefined) return j.data;
      } catch (e) {}
    }
    return this.getLocal(key);
  }
}

/* ================= 4. UI/HUD 组件（Canvas 绘制版，配 Input 使用） ================= */
class UIManager {
  constructor(input) { this.input = input; this.widgets = []; }
  add(w) { w.ui = this; this.widgets.push(w); return w; }
  update(dt) {
    const [mx, my] = [this.input.mouse.x, this.input.mouse.y];
    for (const w of this.widgets) {
      w.hover = typeof w.hit === "function" ? w.hit(mx, my) : false;
      if (w.hover && this.input.mousePressed(0)) { w.pressed = true; if (w.onClick) w.onClick(w); }
      else w.pressed = w.hover && this.input.mouseDown(0);
    }
  }
  render(r) { for (const w of this.widgets) w.render(r); }
  clear() { this.widgets.length = 0; }
}
class Button {
  constructor(o = {}) {
    this.x = o.x || 0; this.y = o.y || 0; this.w = o.w || 140; this.h = o.h || 36;
    this.text = o.text || "Button"; this.onClick = o.onClick || null;
    this.hover = false; this.pressed = false;
    this.color = o.color || [0.25, 0.55, 0.95]; this.hoverColor = o.hoverColor || [0.4, 0.7, 1.0];
  }
  hit(mx, my) { return mx >= this.x && mx <= this.x + this.w && my >= this.y && my <= this.y + this.h; }
  render(r) {
    const c = this.pressed ? [0.2, 0.4, 0.8] : this.hover ? this.hoverColor : this.color;
    r.rect(this.x, this.y, this.w, this.h, c);
    if (r.text) r.text(this.text, this.x + this.w / 2, this.y + this.h / 2, 16, [1, 1, 1], "center", "middle");
  }
}
class HPBar {
  constructor(o = {}) { this.x = o.x || 10; this.y = o.y || 10; this.w = o.w || 200; this.h = o.h || 18; this.max = o.max || 100; this.value = o.value !== undefined ? o.value : this.max; }
  set(v) { this.value = Math.max(0, Math.min(this.max, v)); }
  render(r) {
    const frac = this.value / this.max;
    r.rect(this.x - 2, this.y - 2, this.w + 4, this.h + 4, [0.1, 0.1, 0.12]);   // 底框
    r.rect(this.x, this.y, this.w * frac, this.h, frac > 0.3 ? [0.9, 0.25, 0.3] : [1, 0.1, 0.1]);
  }
}
class Panel {
  constructor(o = {}) { this.x = o.x || 0; this.y = o.y || 0; this.w = o.w || 300; this.h = o.h || 200; this.color = o.color || [0.08, 0.09, 0.13]; }
  hit() { return true; }   // 面板挡输入
  render(r) { r.rect(this.x, this.y, this.w, this.h, this.color); }
}

/* ================= 5. 碰撞系统 ================= */
// shape: {type:'circle', r} 或 {type:'aabb', hw, hh}（半宽半高）
// solid: 实体碰撞（回弹/推开），trigger: 触发器（只回调不阻挡）
class CollisionSystem {
  constructor() { this.items = []; }   // {entity, shape, solid, tag, onEnter, onStay, onExit}
  add(entity, shape, opts = {}) {
    const it = { entity, shape, solid: !!opts.solid, tag: opts.tag || null,
      onEnter: opts.onEnter || null, onStay: opts.onStay || null, onExit: opts.onExit || null, _in: new Set() };
    this.items.push(it); return it;
  }
  remove(entity) { this.items = this.items.filter(i => i.entity !== entity); }
  static _hit(a, b) {
    const dx = b.entity.x - a.entity.x, dy = b.entity.y - a.entity.y;
    if (a.shape.type === "circle" && b.shape.type === "circle") {
      const r = a.shape.r + b.shape.r; return dx * dx + dy * dy <= r * r;
    }
    if (a.shape.type === "aabb" && b.shape.type === "aabb")
      return Math.abs(dx) <= a.shape.hw + b.shape.hw && Math.abs(dy) <= a.shape.hh + b.shape.hh;
    // 圆 vs AABB：取 AABB 上最近点
    const [c, box] = a.shape.type === "circle" ? [a, b] : [b, a];
    const cx = c.entity.x, cy = c.entity.y;
    const nx = Math.max(box.entity.x - box.shape.hw, Math.min(cx, box.entity.x + box.shape.hw));
    const ny = Math.max(box.entity.y - box.shape.hh, Math.min(cy, box.entity.y + box.shape.hh));
    const ddx = cx - nx, ddy = cy - ny;
    return ddx * ddx + ddy * ddy <= c.shape.r * c.shape.r;
  }
  update() {
    // 宽相位：O(n²) 粗测包围球，demo 规模 <500 够用
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const A = this.items[i], B = this.items[j];
        const rA = A.shape.type === "circle" ? A.shape.r : Math.hypot(A.shape.hw, A.shape.hh);
        const rB = B.shape.type === "circle" ? B.shape.r : Math.hypot(B.shape.hw, B.shape.hh);
        const dx = B.entity.x - A.entity.x, dy = B.entity.y - A.entity.y;
        if (dx * dx + dy * dy > (rA + rB) * (rA + rB)) continue;
        if (!CollisionSystem._hit(A, B)) continue;
        this._fire(A, B); this._fire(B, A);
        if (A.solid && B.solid && !A.entity.dead && !B.entity.dead) this._separate(A, B); // 实体互相推开
      }
    }
    // onExit 检测
    for (const it of this.items) {
      for (const other of [...it._in]) {
        const still = this.items.includes(other) && !other.entity.dead && CollisionSystem._hit(it, other);
        if (!still) { it._in.delete(other); if (it.onExit) it.onExit(other.entity); }
      }
    }
  }
  _fire(a, b) {
    if (!a._in.has(b)) { a._in.add(b); if (a.onEnter) a.onEnter(b.entity); }
    else if (a.onStay) a.onStay(b.entity);
  }
  _separate(A, B) { // 沿连线对半推开（AABB 用轴向最大重叠）
    if (A.shape.type === "aabb" && B.shape.type === "aabb") {
      const ox = A.shape.hw + B.shape.hw - Math.abs(B.entity.x - A.entity.x);
      const oy = A.shape.hh + B.shape.hh - Math.abs(B.entity.y - A.entity.y);
      if (ox < oy) { const s = B.entity.x >= A.entity.x ? 1 : -1; A.entity.x -= ox / 2 * s; B.entity.x += ox / 2 * s; }
      else { const s = B.entity.y >= A.entity.y ? 1 : -1; A.entity.y -= oy / 2 * s; B.entity.y += oy / 2 * s; }
    } else {
      const dx = B.entity.x - A.entity.x || 0.01, dy = B.entity.y - A.entity.y || 0.01;
      const d = Math.hypot(dx, dy) || 1, push = 0.5;
      A.entity.x -= dx / d * push; A.entity.y -= dy / d * push;
      B.entity.x += dx / d * push; B.entity.y += dy / d * push;
    }
  }
}

/* ================= 6. 摄像机增强（多目标/死区/震动） ================= */
class CameraEx {
  constructor(x = 0, y = 0, zoom = 1) {
    this.x = x; this.y = y; this.zoom = zoom;
    this.viewW = 0; this.viewH = 0;
    this.targets = [];              // 多目标：取包围盒中心
    this.followLerp = 0.12;
    this.deadzone = null;           // {w,h} 死区：目标偏移小于半宽高不跟随
    this.shake = 0; this.shakeX = 0; this.shakeY = 0; this._decay = 8;
  }
  follow(...ts) { this.targets = ts.filter(t => t && "x" in t); }
  setDeadzone(w, h) { this.deadzone = { w, h }; }
  shakeFor(px) { this.shake = Math.max(this.shake, px); }
  _aim() {
    if (!this.targets.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of this.targets) { minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y); }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  update(dt, viewW, viewH) {
    this.viewW = viewW; this.viewH = viewH;
    const a = this._aim();
    if (a) {
      let dx = a.x - this.x, dy = a.y - this.y;
      if (this.deadzone) {         // 死区缓冲：中心偏移超出死区才移动
        const hw = this.deadzone.w / 2, hh = this.deadzone.h / 2;
        if (Math.abs(dx) < hw) dx = 0; else dx -= Math.sign(dx) * hw;
        if (Math.abs(dy) < hh) dy = 0; else dy -= Math.sign(dy) * hh;
      }
      this.x += dx * this.followLerp; this.y += dy * this.followLerp;
    }
    if (this.shake > 0.01) {
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake;
      this.shake *= Math.exp(-this._decay * dt);
    } else { this.shakeX = this.shakeY = 0; this.shake = 0; }
  }
  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom + this.viewW / 2 + this.shakeX,
            (wy - this.y) * this.zoom + this.viewH / 2 + this.shakeY];
  }
  screenToWorld(sx, sy) {
    return [(sx - this.viewW / 2 - this.shakeX) / this.zoom + this.x,
            (sy - this.viewH / 2 - this.shakeY) / this.zoom + this.y];
  }
  bounds() {
    const hw = this.viewW / 2 / this.zoom, hh = this.viewH / 2 / this.zoom;
    return { left: this.x - hw, top: this.y - hh, right: this.x + hw, bottom: this.y + hh };
  }
}

/* ================= 7. 数值配置表 + 热更 ================= */
class Config {
  constructor() { this.data = {}; this.onError = null; }
  // 加载 JSON 表；data 内可直接传（Node 测试），或 path 拉取
  set(obj) {
    const merge = (dst, src) => {
      for (const k in src) {
        const v = src[k];
        if (v === null || typeof v !== "object") dst[k] = v;
        else {
          if (typeof dst[k] !== "object" || dst[k] === null) dst[k] = {};
          merge(dst[k], v);
        }
      }
    };
    for (const k in obj) {
      if (typeof obj[k] !== "object" || obj[k] === null) throw new Error(`配置节 [${k}] 必须是对象`);
      if (typeof this.data[k] !== "object" || this.data[k] === null) this.data[k] = {};
      merge(this.data[k], obj[k]);   // 深合并：热更只覆盖给出的键，其余保留
    }
    return this;
  }
  get(path, fallback) {          // get("player.hp", 100)
    const parts = path.split("."); let cur = this.data;
    for (const p of parts) { if (cur == null || typeof cur !== "object" || !(p in cur)) return fallback; cur = cur[p]; }
    return cur;
  }
  async load(path) {
    const r = await fetch(path); if (!r.ok) throw new Error("配置加载失败: " + path);
    this.set(await r.json()); return this;
  }
  // 热更：轮询带时间戳的同一 URL，变化即 set + 通知（游戏内立即生效，无需重启）
  async watch(path, onChange, intervalMs = 2000) {
    let last = "";
    const tick = async () => {
      try {
        const r = await fetch(path + (path.includes("?") ? "&" : "?") + "_t=" + Date.now(), { cache: "no-store" });
        if (r.ok) {
          const txt = await r.text();
          if (txt !== last) {
            const prev = last; last = txt;
            if (prev) { this.set(JSON.parse(txt)); if (onChange) onChange(this); }
          }
        }
      } catch (e) { if (this.onError) this.onError(e); }
    };
    await tick();                  // 首次拉取记录基线
    this._watchTimer = setInterval(tick, intervalMs);
    return this;
  }
  stopWatch() { if (this._watchTimer) { clearInterval(this._watchTimer); this._watchTimer = null; } }
}

/* ================= 导出 ================= */
const GEngineCore = { Entity, EntityManager, Scene, SceneManager, Save, UIManager, Button, HPBar, Panel,
  CollisionSystem, CameraEx, Config };
if (typeof module !== "undefined") module.exports = GEngineCore;
if (typeof window !== "undefined") Object.assign(window, GEngineCore);
