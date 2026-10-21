/* ============================================================
 * engine2d · 布娃娃小人 v3（硬化版）
 * 改进：身体骨架大幅加固（躯干方形+对角支撑、四肢防折叠支撑），
 *       关键点引用缓存（去掉每帧 filter/sort），性能更流畅
 * 交互：鼠标拖拽任意部位 · A/D 走 · W/空格 跳 · R 重置
 * ============================================================ */
"use strict";

const cv  = document.getElementById("cv");
const ctx = cv.getContext("2d");
const W = cv.width, H = cv.height;

const GRAV = 0.55;
const ITER = 14;          // 提高迭代 = 提高约束刚度
const FLOOR = H - 50;

/* ---------- 点质量 ---------- */
class P {
  constructor(x, y, r = 6, m = 1) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.r = r; this.m = m;   // m: 质量权重，重的点位移少
  }
  step() {
    const vx = (this.x - this.px) * 0.995;
    const vy = (this.y - this.py) * 0.995;
    this.px = this.x; this.py = this.y;
    this.x += vx; this.y += vy + GRAV;
  }
  collide() {
    if (this.y + this.r > FLOOR) {
      const vy = this.y - this.py;
      this.y = FLOOR - this.r;
      this.py = this.y + vy * 0.25;
      this.px = this.x - (this.x - this.px) * 0.55;
    }
    if (this.x - this.r < 0) { this.x = this.r;     this.px = this.x + 2; }
    if (this.x + this.r > W) { this.x = W - this.r; this.px = this.x - 2; }
    if (this.y - this.r < 0) { this.y = this.r;     this.py = this.y + 1; }
  }
}

/* ---------- 骨骼约束（带质量分配 + 可选最小长度防折叠） ---------- */
class C {
  constructor(a, b, stiff = 1, minLen = 0) {
    this.a = a; this.b = b;
    this.len = Math.hypot(a.x - b.x, a.y - b.y);
    this.minLen = minLen || this.len * 0.72; // 折叠下限：原长 72%
    this.stiff = stiff;
  }
  solve() {
    const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    // 只惩罚压缩到 minLen 以下的折叠，正常拉伸按刚度修正
    let target = this.len;
    if (this.minLen && d < this.minLen) target = this.minLen;
    const diff = (d - target) / d * 0.5 * this.stiff;
    const wA = this.b.m / (this.a.m + this.b.m);
    const wB = 1 - wA;
    this.a.x += dx * diff * 2 * wA; this.a.y += dy * diff * 2 * wA;
    this.b.x -= dx * diff * 2 * wB; this.b.y -= dy * diff * 2 * wB;
  }
}

/* ---------- 构建小人 ---------- */
let pts = [], cons = [];
// 缓存引用，绘制不再每帧查找
let head, neck, hipC, shL, shR, elL, elR, haL, haR,
    hipL, hipR, knL, knR, footL, footR;

function link(a, b, stiff = 1, minLen = 0) { cons.push(new C(a, b, stiff, minLen)); }

function build(x0, y0) {
  pts = []; cons = [];
  const S = 1.6;
  const pt = (dx, dy, r, m) => { const p = new P(x0 + dx * S, y0 + dy * S, r, m); pts.push(p); return p; };

  head  = pt(0, -66, 22, 1.4);   // 头（重，摆动慢）
  neck  = pt(0, -38, 6, 1.2);
  shL   = pt(-20, -34, 6, 1);
  shR   = pt(20, -34, 6, 1);
  elL   = pt(-30, -12, 6, 0.8);
  elR   = pt(30, -12, 6, 0.8);
  haL   = pt(-36, 10, 7, 0.7);
  haR   = pt(36, 10, 7, 0.7);
  hipC  = pt(0, 0, 8, 1.3);      // 骨盆中心（重）
  hipL  = pt(-14, 2, 6, 1);
  hipR  = pt(14, 2, 6, 1);
  knL   = pt(-16, 32, 7, 0.9);
  knR   = pt(16, 32, 7, 0.9);
  footL = pt(-18, 66, 8, 0.9);
  footR = pt(18, 66, 8, 0.9);

  /* 脊柱 + 头颈（头部加固：头-肩三角 + 头-髋长撑，头几乎不晃） */
  link(head, neck, 1);
  link(neck, hipC, 1);
  link(head, shL, 0.9); link(head, shR, 0.9);
  link(head, hipC, 0.5);
  /* 躯干硬化：肩-肩、髋-髋、四根对角支撑 → 躯干接近刚性 */
  link(shL, shR, 1);
  link(hipL, hipR, 1);
  link(hipL, hipC, 1);  link(hipR, hipC, 1);
  link(neck, hipL, 1);  link(neck, hipR, 1);   // 躯干左右侧
  link(shL, hipR, 0.9); link(shR, hipL, 0.9);  // 对角交叉支撑
  link(shL, hipC, 1);   link(shR, hipC, 1);
  /* 肩胛连接 */
  link(neck, shL, 1);   link(neck, shR, 1);
  link(shL, hipL, 1);   link(shR, hipR, 1);

  /* 手臂：防肘部反折（min 支撑 肩-手） */
  link(shL, elL, 1); link(elL, haL, 1);
  link(shR, elR, 1); link(elR, haR, 1);
  link(shL, haL, 0.35, 0); // 轻微保持臂形
  link(shR, haR, 0.35, 0);

  /* 腿：防膝反折（min 支撑 髋-脚） */
  link(hipL, knL, 1); link(knL, footL, 1);
  link(hipR, knR, 1); link(knR, footR, 1);
  link(hipL, footL, 0.3, 0);
  link(hipR, footR, 0.3, 0);
  /* 两腿间撑开，避免绞在一起 */
  link(knL, knR, 0.4, 0);
  link(footL, footR, 0.4, 0);
}

function reset() { build(W / 2, H / 2 - 60); }
reset();

/* ---------- 输入 ---------- */
const keys = {};
let drag = null, dragOff = { x: 0, y: 0 };

function toCanvas(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
cv.addEventListener("mousedown", e => {
  const { x: mx, y: my } = toCanvas(e);
  let best = null, bd = 1e9;
  for (const p of pts) {
    const d = Math.hypot(p.x - mx, p.y - my);
    if (d < bd && d < 70) { bd = d; best = p; }
  }
  if (best) { drag = best; dragOff.x = best.x - mx; dragOff.y = best.y - my; cv.style.cursor = "grabbing"; }
});
window.addEventListener("mousemove", e => {
  if (!drag) return;
  const { x: mx, y: my } = toCanvas(e);
  drag.x = mx + dragOff.x; drag.y = my + dragOff.y;
  drag.px = drag.x; drag.py = drag.y;
});
window.addEventListener("mouseup", () => { drag = null; cv.style.cursor = "grab"; });
window.addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "KeyR") reset(); });
window.addEventListener("keyup", e => keys[e.code] = false);

/* ---------- 物理（固定步长，物理与渲染解耦，消除卡顿感） ---------- */
const STEP = 1000 / 60;
let acc = 0, last = performance.now();
let walkT = 0, jumpT = 0;
const S2 = 1.6; // 与 build() 中 S 一致的缩放（肩高偏移用）

function physics() {
  // 行走：骨盆/头自然起伏 + 前倾，摆腿带抬脚动画
  let walk = 0;
  if (keys.KeyA || keys.ArrowLeft)  walk -= 1;
  if (keys.KeyD || keys.ArrowRight) walk += 1;
  if (walk !== 0) {
    walkT += 0.25;                                 // 步态相位
    const bob = Math.abs(Math.sin(walkT)) * 3.2;   // 身体上下起伏
    hipC.x += walk * 2.4; hipC.px = hipC.x - walk * 1.6;
    hipC.y -= bob * 0.6;                           // 骨盆起伏
    neck.x += walk * 1.2;
    neck.y = hipC.y - 60 * S2 + Math.sin(walkT * 2) * 1.5; // 肩部反向微摆
    head.x += walk * 1.2;
    head.y -= bob;                                 // 头部起伏最明显
    // 腿交替摆动：前面的腿迈大步并抬起，像走路
    const fs = walk > 0 ? [footL, footR] : [footR, footL];
    const ks = walk > 0 ? [knL, knR]    : [knR, knL];
    const swing = Math.sin(walkT);
    fs[0].x += walk * 3.4 + swing * 1.5; fs[0].px = fs[0].x - walk * 1.2;
    fs[0].y -= Math.max(0, swing) * 7;           // 迈步腿抬脚
    fs[1].x += walk * 1.6; fs[1].px = fs[1].x - walk * 1.8;
    ks[0].y -= Math.max(0, swing) * 4;           // 膝盖配合抬起
    // 手臂反相摆动
    const hAs = walk > 0 ? [haL, haR] : [haR, haL];
    const eAs = walk > 0 ? [elL, elR] : [elR, elL];
    hAs[0].y -= swing * 3; hAs[1].y += swing * 3;
    eAs[0].y -= swing * 2; eAs[1].y += swing * 2;
  } else {
    walkT = 0;
  }
  const grounded = footL.y + footL.r >= FLOOR - 4 || footR.y + footR.r >= FLOOR - 4;
  if ((keys.KeyW || keys.Space) && grounded) {
    jumpT = 22;                                    // 跳跃动画计时
    for (const p of pts) { p.y -= 3; p.py = p.y + 9; }
    // 跳跃姿势：双腿收起、手臂上扬
    footL.y -= 8; footR.y -= 8; knL.y -= 6; knR.y -= 6;
    haL.y -= 10;  haR.y -= 10;  elL.y -= 7;  elR.y -= 7;
  }
  if (jumpT > 0) {
    jumpT--;
    // 空中时手臂持续上举、腿保持收起姿态的张力
    haL.y -= 0.4; haR.y -= 0.4;
    if (grounded && jumpT < 12) jumpT = 0;
  }
  if (drag) { drag.px = drag.x; drag.py = drag.y; }

  for (const p of pts) p.step();
  for (let i = 0; i < ITER; i++) {
    for (const c of cons) c.solve();
    if (drag) { drag.x = drag.px; drag.y = drag.py; }
    for (const p of pts) p.collide();
  }
}

/* ---------- 绘制 ---------- */
function limb(a, b, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

let bgGrad = null;
function draw() {
  if (!bgGrad) { // 背景渐变只建一次
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#16233c"); bgGrad.addColorStop(1, "#22314f");
  }
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b3d2f"; ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.strokeStyle = "#4a7a55"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.lineTo(W, FLOOR); ctx.stroke();

  const RED = "#c23b3b", BLUE = "#3b56a8", SKIN = "#e8b88a", SHOE = "#6b4a2b";
  // 腿
  limb(hipL, knL, 14, BLUE); limb(knL, footL, 12, BLUE);
  limb(hipR, knR, 14, BLUE); limb(knR, footR, 12, BLUE);
  limb(knL, footL, 8, SHOE); limb(knR, footR, 8, SHOE);
  // 躯干
  limb(hipC, neck, 28, RED);
  limb(shL, shR, 24, RED);
  // 手臂
  limb(shL, elL, 11, RED); limb(elL, haL, 10, SKIN);
  limb(shR, elR, 11, RED); limb(elR, haR, 10, SKIN);
  // 头
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(head.x, head.y, 22, 0, 7); ctx.fill();
  ctx.fillStyle = "#3a2a1a"; // 头发
  ctx.beginPath(); ctx.arc(head.x, head.y - 6, 22, Math.PI, 2 * Math.PI); ctx.fill();
  const face = (haR.x + haR.y > haL.x + haL.y) ? 1 : -1; // 朝手的方向
  ctx.fillStyle = "#222";
  ctx.beginPath(); ctx.arc(head.x + 8 * face, head.y - 2, 3, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(head.x - 2 * face, head.y - 2, 3, 0, 7); ctx.fill();
  ctx.strokeStyle = "#7a4a3a"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(head.x + 4 * face, head.y + 8, 5, 0.2, Math.PI - 0.2); ctx.stroke();

  if (drag) {
    ctx.strokeStyle = "rgba(255,255,120,.9)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(drag.x, drag.y, drag.r + 8, 0, 7); ctx.stroke();
  }
}

/* ---------- 主循环 ---------- */
(function loop(now) {
  acc += Math.min(now - last, 100); last = now;
  while (acc >= STEP) { physics(); acc -= STEP; }
  draw();
  requestAnimationFrame(loop);
})(performance.now());
