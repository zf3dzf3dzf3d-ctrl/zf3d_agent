// pinball/game.js — 弹球打砖块 · 圆形-矩形物理碰撞：法线反射 + 挡板角度控制 + 速度衰减
"use strict";

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const W = cv.width, H = cv.height;
const audio = new AudioSys();

/* ---------- 输入 ---------- */
const keys = {};
window.addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "Enter" || e.code === "Space") e.preventDefault(); });
window.addEventListener("keyup", e => { keys[e.code] = false; });
let mouseX = W / 2;
cv.addEventListener("mousemove", e => {
  const r = cv.getBoundingClientRect();
  mouseX = (e.clientX - r.left) * (W / r.width);
});
cv.addEventListener("click", () => { if (state !== "playing") reset(); });

/* ---------- 状态 ---------- */
const PADDLE_W = 110, PADDLE_H = 14, PADDLE_Y = H - 46;
const BALL_R = 8;
const BRICK_ROWS = 6, BRICK_COLS = 10, BRICK_W = 48, BRICK_H = 20;
const BRICK_TOP = 70, BRICK_LEFT = (W - BRICK_COLS * BRICK_W) / 2;
const ROW_COLORS = ["#ff5252", "#ff9800", "#ffeb3b", "#4caf50", "#42a5f5", "#9c27b0"];

let state = "ready";           // ready / playing / win / over
let score = 0, lives = 3, combo = 0, frame = 0;
let stuck = true;              // 球吸附在挡板上待发射

const paddle = { x: W / 2 - PADDLE_W / 2, w: PADDLE_W, h: PADDLE_H, y: PADDLE_Y };
const ball = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_R, spin: 0 };
let bricks = [];

function buildBricks() {
  bricks = [];
  for (let r = 0; r < BRICK_ROWS; r++)
    for (let c = 0; c < BRICK_COLS; c++)
      bricks.push({ x: BRICK_LEFT + c * BRICK_W, y: BRICK_TOP + r * BRICK_H, w: BRICK_W, h: BRICK_H, row: r, hp: r < 2 ? 2 : 1, alive: true });
}

function reset() {
  score = 0; lives = 3; combo = 0; stuck = true;
  paddle.x = W / 2 - paddle.w / 2;
  attachBall();
  buildBricks();
  state = "playing";
  startBGM();
}

function attachBall() {
  ball.x = paddle.x + paddle.w / 2;
  ball.y = PADDLE_Y - ball.r - 1;
  ball.vx = 0; ball.vy = 0; ball.spin = 0;
}

function launch() {
  if (!stuck) return;
  stuck = false;
  const a = (-Math.PI / 2) + (Math.random() * 0.5 - 0.25);
  const sp = 420;
  ball.vx = Math.cos(a) * sp; ball.vy = Math.sin(a) * sp;
  beep(600, 0.08, "square", 0.06);
}

/* ---------- 音效 ---------- */
function beep(f, d, w, v) { try { audio.play("ui"); } catch (e) {} }

/* ---------- 背景音乐：循环电子琶音 ---------- */
const MELO = [440, 554, 659, 554, 587, 740, 880, 740, 392, 494, 587, 494, 523, 659, 784, 659];
let bgmTimer = null;
function tone(freq, dur, type = "triangle", vol = 0.03) {
  try {
    audio._ensure();
    const t = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
function startBGM() {
  if (bgmTimer) return;
  const beat = 0.14, len = MELO.length;
  bgmTimer = setInterval(() => {
    if (state !== "playing") return;
    const i = (bgmStep++ % len);
    tone(MELO[i], beat * 0.9, "triangle", 0.03);
    if (i % 4 === 0) tone(MELO[i] / 4, beat * 1.6, "sine", 0.05);
  }, beat * 1000);
}
let bgmStep = 0;

/* ---------- 物理核心：圆-矩形碰撞 ---------- */
// 返回最近点，据此求法线并反射速度；同时把球推出穿透，防止连续帧重复反弹
function circleRectHit(bx, by, r, rx, ry, rw, rh) {
  const cx = Math.max(rx, Math.min(bx, rx + rw));
  const cy = Math.max(ry, Math.min(by, ry + rh));
  const dx = bx - cx, dy = by - cy;
  const d2 = dx * dx + dy * dy;
  return { hit: d2 <= r * r, cx, cy, dx, dy, d2 };
}

function reflect(nx, ny) {
  const dot = ball.vx * nx + ball.vy * ny;
  const e = 0.99;                          // 轻微能量损失
  ball.vx = (ball.vx - 2 * dot * nx) * e;
  ball.vy = (ball.vy - 2 * dot * ny) * e;
}

function clampSpeed(min, max) {
  const s = Math.hypot(ball.vx, ball.vy);
  if (s === 0) return;
  const ns = Math.max(min, Math.min(max, s));
  ball.vx = ball.vx / s * ns; ball.vy = ball.vy / s * ns;
}

/* ---------- 更新 ---------- */
function update(dt) {
  frame++;
  if (state !== "playing") {
    if (keys["Enter"] || keys["Space"]) reset();
    return;
  }

  // 挡板：键盘 + 鼠标
  const SP = 560;
  if (keys["ArrowLeft"] || keys["KeyA"]) paddle.x -= SP * dt;
  if (keys["ArrowRight"] || keys["KeyD"]) paddle.x += SP * dt;
  paddle.x = mouseX >= 0 && mouseX <= W && keys["ArrowLeft"] === undefined ? paddle.x : paddle.x; // 占位，鼠标直接吸附
  if (mouseX !== undefined) {
    const target = mouseX - paddle.w / 2;
    if (!keys["ArrowLeft"] && !keys["ArrowRight"] && !keys["KeyA"] && !keys["KeyD"])
      paddle.x += (target - paddle.x) * Math.min(1, dt * 18);
  }
  paddle.x = Math.max(6, Math.min(W - paddle.w - 6, paddle.x));

  if (stuck) { attachBall(); if (keys["Space"] || keys["Enter"] || audioClick()) launch(); return; }

  // 子步进积分，防高速穿透
  const steps = Math.ceil(Math.hypot(ball.vx, ball.vy) * dt / 6);
  for (let s = 0; s < steps; s++) {
    const h = dt / steps;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    // 墙壁反射
    if (ball.x - ball.r < 6)      { ball.x = 6 + ball.r;       reflect(1, 0); hitSfx(); }
    if (ball.x + ball.r > W - 6)  { ball.x = W - 6 - ball.r;   reflect(-1, 0); hitSfx(); }
    if (ball.y - ball.r < 6)      { ball.y = 6 + ball.r;       reflect(0, 1); hitSfx(); }

    // 挡板碰撞：反弹角随击中位置变化（模拟真实打砖块）
    if (circleRectHit(ball.x, ball.y, ball.r, paddle.x, PADDLE_Y, paddle.w, paddle.h).hit && ball.vy > 0) {
      const off = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);   // -1..1
      const ang = -Math.PI / 2 + off * (Math.PI / 3);                      // 最多偏 60°
      const sp = Math.min(Math.hypot(ball.vx, ball.vy) * 1.02, 760);
      ball.vx = Math.cos(ang) * sp; ball.vy = Math.sin(ang) * sp;
      ball.y = PADDLE_Y - ball.r - 0.5;
      combo = 0; hitSfx();
    }

    // 砖块碰撞
    for (const b of bricks) {
      if (!b.alive) continue;
      const c = circleRectHit(ball.x, ball.y, ball.r, b.x, b.y, b.w, b.h);
      if (!c.hit) continue;
      // 用最近点方向确定法线
      let nx, ny;
      if (c.d2 > 0.0001) { const d = Math.sqrt(c.d2); nx = c.dx / d; ny = c.dy / d; }
      else { // 球心在砖内，按最小穿透轴推出
        const ox = Math.min(ball.x - b.x, b.x + b.w - ball.x);
        const oy = Math.min(ball.y - b.y, b.y + b.h - ball.y);
        if (ox < oy) { nx = (ball.x - b.x < b.x + b.w - ball.x) ? -1 : 1; ny = 0; }
        else { nx = 0; ny = (ball.y - b.y < b.y + b.h - ball.y) ? -1 : 1; }
      }
      reflect(nx, ny);
      // 推出穿透
      const pen = ball.r - Math.sqrt(c.d2) + 0.5;
      if (c.d2 > 0.0001) { ball.x += nx * pen; ball.y += ny * pen; }

      b.hp--;
      if (b.hp <= 0) {
        b.alive = false;
        score += (BRICK_ROWS - b.row) * 10 * Math.max(1, combo);
        combo++;
        tone(300 + combo * 60, 0.08, "square", 0.05);
      } else { score += 10; hitSfx(); }
      break;
    }
  }
  clampSpeed(260, 760);

  // 掉落
  if (ball.y - ball.r > H) {
    lives--;
    combo = 0;
    tone(150, 0.4, "sawtooth", 0.06);
    if (lives <= 0) { state = "over"; stopBGM(); }
    else { stuck = true; attachBall(); }
  }

  // 通关
  if (bricks.every(b => !b.alive)) { state = "win"; stopBGM(); }
}
let clickFlag = false;
cv.addEventListener("pointerdown", () => { clickFlag = true; });
function audioClick() { const v = clickFlag; clickFlag = false; return v; }

function hitSfx() { tone(220 + Math.random() * 80, 0.06, "square", 0.04); }
function stopBGM() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

/* ---------- 渲染 ---------- */
function draw() {
  // 背景网格
  ctx.fillStyle = "#0d1520"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(80,120,180,.08)"; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // 墙壁
  ctx.strokeStyle = "#3a5a8a"; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(6, H); ctx.lineTo(6, 6); ctx.lineTo(W - 6, 6); ctx.lineTo(W - 6, H); ctx.stroke();

  // 砖块
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.fillStyle = ROW_COLORS[b.row];
    ctx.globalAlpha = b.hp === 2 ? 1 : 0.75;
    ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
    ctx.globalAlpha = 1;
    if (b.hp === 2) { ctx.strokeStyle = "#fff8"; ctx.strokeRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8); }
  }

  // 挡板
  const grad = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
  grad.addColorStop(0, "#42a5f5"); grad.addColorStop(0.5, "#e3f2fd"); grad.addColorStop(1, "#42a5f5");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(paddle.x, PADDLE_Y, paddle.w, paddle.h, 7);
  ctx.fill();

  // 球 + 拖尾
  if (!stuck) {
    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.beginPath(); ctx.arc(ball.x - ball.vx * 0.012, ball.y - ball.vy * 0.012, ball.r * 0.8, 0, 7); ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill();
  ctx.fillStyle = "#9ad";
  ctx.beginPath(); ctx.arc(ball.x + 2, ball.y + 2, ball.r * 0.4, 0, 7); ctx.fill();

  // HUD
  ctx.fillStyle = "#cde"; ctx.font = "16px Consolas";
  ctx.fillText(`分数 ${score}`, 20, 32);
  ctx.fillText(`生命 ${"♥".repeat(Math.max(0, lives))}`, 140, 32);
  if (combo > 1) ctx.fillText(`连击 x${combo}`, 260, 32);

  ctx.textAlign = "center";
  if (state === "ready") { ctx.fillStyle = "#fff"; ctx.font = "24px Consolas"; ctx.fillText("点击开始 · 弹球打砖块", W / 2, H / 2); }
  if (stuck && state === "playing") { ctx.fillStyle = "#fff"; ctx.font = "16px Consolas"; ctx.fillText("空格 / 点击 发射", W / 2, PADDLE_Y - 60); }
  if (state === "over") { ctx.fillStyle = "#f66"; ctx.font = "32px Consolas"; ctx.fillText("游戏结束", W / 2, H / 2); ctx.fillStyle = "#cde"; ctx.font = "16px Consolas"; ctx.fillText("Enter 重开", W / 2, H / 2 + 36); }
  if (state === "win")  { ctx.fillStyle = "#6f6"; ctx.font = "32px Consolas"; ctx.fillText("通关！物理大师", W / 2, H / 2); ctx.fillStyle = "#cde"; ctx.font = "16px Consolas"; ctx.fillText("Enter 再来一局", W / 2, H / 2 + 36); }
  ctx.textAlign = "left";
}

/* ---------- 主循环 ---------- */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); return this;
  };
}
let last = performance.now();
function loop(t) {
  const dt = Math.min(0.033, (t - last) / 1000);
  last = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
draw();
requestAnimationFrame(loop);
