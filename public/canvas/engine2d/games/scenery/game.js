// game.js — 山水间 · 风景漫游（休闲观景，展示 engine2d 场景编辑能力）
// 特性：5 层视差远山 + 水面倒影 + 昼夜循环（黎明/白昼/黄昏/夜晚/深夜）
//      星空/萤火虫/雾气/飞鸟/云/渔船 粒子与元素系统
//      交互：A/D 或方向键漫游，1-5 切换时段，空格点亮岸边灯火，M 静音
"use strict";

const CV = document.getElementById("cv");
const CTX = CV.getContext("2d");
const W = CV.width, H = CV.height;
const WATER_Y = 350;               // 水面基线
const audio = (typeof AudioSys !== "undefined") ? new AudioSys() : null;

// ---------------- 昼夜时段 ----------------
// key: 名字, sky: 天空渐变 [上,下], sun: 太阳颜色, light: 环境光 0-1, stars: 星星透明度
const PHASES = [
  { key: "黎明", sky: ["#2c3e6b", "#f0a06a"], sun: "#ffd9a0", light: 0.72, stars: 0.5 },
  { key: "白昼", sky: ["#4a90d9", "#bfe3f5"], sun: "#fff4c0", light: 1.0,  stars: 0.0 },
  { key: "黄昏", sky: ["#31355f", "#f2683c"], sun: "#ff8c42", light: 0.62, stars: 0.25 },
  { key: "夜晚", sky: ["#0b1026", "#26345c"], sun: "#e8ecf5", light: 0.30, stars: 0.9 },
  { key: "深夜", sky: ["#05070f", "#101a33"], sun: "#cfd8ea", light: 0.18, stars: 1.0 },
];
let phaseIdx = 1;
const lerp = (a, b, t) => a + (b - a) * t;
function hex2rgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
function mixHex(h1, h2, t) {
  const a = hex2rgb(h1), b = hex2rgb(h2);
  return `rgb(${Math.round(lerp(a[0],b[0],t))},${Math.round(lerp(a[1],b[1],t))},${Math.round(lerp(a[2],b[2],t))})`;
}

// 时段间平滑过渡
let fromIdx = 1, toIdx = 1, blend = 1; // blend 0→1
function setPhase(i) {
  if (i === phaseIdx) return;
  fromIdx = phaseIdx; toIdx = i; blend = 0;
}
function curPhase() {
  const A = PHASES[fromIdx], B = PHASES[toIdx];
  return {
    sky: [mixHex(A.sky[0], B.sky[0], blend), mixHex(A.sky[1], B.sky[1], blend)],
    sun: mixHex(A.sun, B.sun, blend),
    light: lerp(A.light, B.light, blend),
    stars: lerp(A.stars, B.stars, blend),
    key: blend < 0.5 ? A.key : B.key,
  };
}

// ---------------- 世界：程序化山峦（场景编辑能力核心）----------------
const WORLD_W = 4000;              // 世界宽度（可漫游）
let camX = 300;
function mulberry(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function ridge(seed, peaks, baseY, amp, w) {
  // 用正弦叠加生成平滑山脊线
  const rnd = mulberry(seed);
  const layers = [];
  for (let i = 0; i < 3; i++) layers.push({ f: 0.4 + rnd() * 0.6, p: rnd() * 6.28, a: amp * (0.5 - i * 0.15), y: 0 });
  return x => baseY + layers.reduce((s, l) => s + Math.sin(x / w * 6.28 * l.f + l.p) * l.a, 0)
    + Math.sin(x / w * 6.28 * 2.3 + seed) * amp * 0.08;
}
const MOUNTS = [
  { fn: ridge(11, 3, 210, 60, 900),  color: "#5a7fa6", par: 0.15, name: "远山" },
  { fn: ridge(23, 3, 250, 70, 700),  color: "#486a8f", par: 0.30, name: "中山" },
  { fn: ridge(37, 3, 295, 75, 520),  color: "#38567a", par: 0.50, name: "近山" },
  { fn: ridge(51, 3, 330, 60, 380),  color: "#2b4463", par: 0.72, name: "山脚" },
];

// ---------------- 场景元素 ----------------
// 星星
const stars = [];
{ const r = mulberry(7); for (let i = 0; i < 120; i++) stars.push({ x: r() * W, y: r() * WATER_Y * 0.75, s: r() * 1.6 + 0.4, tw: r() * 6.28 }); }
// 云
const clouds = [];
{ const r = mulberry(13); for (let i = 0; i < 7; i++) clouds.push({ x: r() * WORLD_W, y: 40 + r() * 120, s: 0.7 + r() * 0.9, v: 4 + r() * 6 }); }
// 萤火虫（夜里出现）
const flies = [];
{ const r = mulberry(29); for (let i = 0; i < 26; i++) flies.push({ x: r() * WORLD_W, y: 200 + r() * 260, p: r() * 6.28, q: r() * 6.28 }); }
// 岸边灯火（空格点亮）
const lamps = [620, 1250, 1980, 2600, 3300].map((x, i) => ({ x, y: WATER_Y - 14, on: false, flick: i }));
// 树（近岸剪影）
const trees = [];
{ const r = mulberry(41); for (let i = 0; i < 22; i++) trees.push({ x: r() * WORLD_W, h: 46 + r() * 46, w: 5 + r() * 4, lean: (r() - 0.5) * 0.3 }); }
// 飞鸟
const birds = [];
{ const r = mulberry(57); for (let i = 0; i < 5; i++) birds.push({ x: r() * WORLD_W, y: 70 + r() * 90, v: 22 + r() * 18, p: r() * 6.28 }); }
// 渔船
const boat = { x: 1500, v: 9, bob: 0 };
// 雾带
const mists = [];
{ const r = mulberry(71); for (let i = 0; i < 8; i++) mists.push({ x: r() * WORLD_W, y: 240 + r() * 90, w: 180 + r() * 260, h: 16 + r() * 20, v: 5 + r() * 8, a: 0.05 + r() * 0.07 }); }

// ---------------- 输入 ----------------
const keys = {};
window.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (["ArrowLeft","ArrowRight","Space","ArrowUp","ArrowDown"].includes(e.code)) e.preventDefault();
  if (e.code === "Digit1") setPhase(0); if (e.code === "Digit2") setPhase(1);
  if (e.code === "Digit3") setPhase(2); if (e.code === "Digit4") setPhase(3);
  if (e.code === "Digit5") setPhase(4);
  if (e.code === "Space") {
    // 点亮/熄灭视野附近最近一盏灯
    const cx = camX + W / 2;
    let best = null, bd = 1e9;
    for (const l of lamps) { const d = Math.abs(l.x - cx); if (d < bd) { bd = d; best = l; } }
    if (best) { best.on = !best.on; if (audio) audio.play("pickup", 0.5); }
  }
  if (e.code === "KeyM" && audio) audio.setVolume("master", audio.volumes.master > 0 ? 0 : 1);
});
window.addEventListener("keyup", e => keys[e.code] = false);

// ---------------- 更新 ----------------
let t = 0, lastMs = 0;
function update(dt) {
  t += dt;
  if (blend < 1) blend = Math.min(1, blend + dt * 0.8);
  // 漫游
  const sp = 260;
  if (keys["ArrowLeft"] || keys["KeyA"]) camX -= sp * dt;
  if (keys["ArrowRight"] || keys["KeyD"]) camX += sp * dt;
  // 没按键时缓慢自动漫游（观景模式）
  if (!keys["ArrowLeft"] && !keys["ArrowRight"] && !keys["KeyA"] && !keys["KeyD"]) camX += 14 * dt;
  camX = Math.max(0, Math.min(WORLD_W - W, camX));

  for (const c of clouds) { c.x += c.v * dt; if (c.x > WORLD_W + 200) c.x = -200; }
  for (const b of birds) { b.x += b.v * dt; b.p += dt * 6; if (b.x > camX + W + 100) b.x = camX - 100; }
  for (const m of mists) { m.x += m.v * dt; if (m.x > camX + W + m.w) m.x = camX - m.w; }
  boat.x += boat.v * dt; if (boat.x > WORLD_W - 300 || boat.x < 300) boat.v = -boat.v;
  boat.bob += dt * 2;
}

// ---------------- 绘制 ----------------
function darken(hex, light) { // 按环境光压暗
  const [r, g, b] = hex2rgb(hex);
  const k = light;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

function draw() {
  const P = curPhase();
  // 天空
  const g = CTX.createLinearGradient(0, 0, 0, WATER_Y);
  g.addColorStop(0, P.sky[0]); g.addColorStop(1, P.sky[1]);
  CTX.fillStyle = g; CTX.fillRect(0, 0, W, WATER_Y);

  // 星星
  if (P.stars > 0.02) {
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + s.tw);
      CTX.fillStyle = `rgba(255,255,240,${P.stars * tw * 0.9})`;
      CTX.fillRect(s.x, s.y, s.s, s.s);
    }
  }
  // 太阳/月亮
  const sunX = W * 0.72, sunY = P.light > 0.8 ? 90 : 150;
  CTX.save();
  CTX.shadowColor = P.sun; CTX.shadowBlur = 40;
  CTX.fillStyle = P.sun;
  CTX.beginPath(); CTX.arc(sunX, sunY, P.light > 0.8 ? 26 : 18, 0, 6.283); CTX.fill();
  CTX.restore();

  // 云
  for (const c of clouds) {
    const sx = c.x - camX * 0.10;
    if (sx < -300 || sx > W + 300) continue;
    CTX.fillStyle = `rgba(255,255,255,${0.10 + P.light * 0.28})`;
    for (let i = 0; i < 4; i++) {
      CTX.beginPath();
      CTX.ellipse(sx + i * 34 * c.s - 40, c.y + Math.sin(i * 1.7) * 8, 46 * c.s, 16 * c.s, 0, 0, 6.283);
      CTX.fill();
    }
  }

  // 飞鸟（简单两笔翅膀）
  for (const b of birds) {
    const sx = b.x - camX * 0.3;
    if (sx < -40 || sx > W + 40) continue;
    const flap = Math.sin(b.p) * 5;
    CTX.strokeStyle = `rgba(30,40,55,${0.35 + P.light * 0.4})`; CTX.lineWidth = 1.6;
    CTX.beginPath();
    CTX.moveTo(sx - 7, b.y + flap); CTX.quadraticCurveTo(sx, b.y - 3, sx, b.y);
    CTX.quadraticCurveTo(sx, b.y - 3, sx + 7, b.y + flap);
    CTX.stroke();
  }

  // 山峦（多层视差 + 倒影）
  for (const m of MOUNTS) {
    const off = camX * m.par;
    CTX.fillStyle = darken(m.color, 0.55 + P.light * 0.45);
    CTX.beginPath(); CTX.moveTo(0, WATER_Y);
    for (let x = 0; x <= W; x += 8) CTX.lineTo(x, m.fn(x + off));
    CTX.lineTo(W, WATER_Y); CTX.closePath(); CTX.fill();
    // 水中倒影
    CTX.save(); CTX.globalAlpha = 0.22; CTX.translate(0, WATER_Y * 2); CTX.scale(1, -1);
    CTX.beginPath(); CTX.moveTo(0, WATER_Y);
    for (let x = 0; x <= W; x += 8) CTX.lineTo(x, m.fn(x + off));
    CTX.lineTo(W, WATER_Y); CTX.closePath(); CTX.fill();
    CTX.restore();
  }

  // 雾带
  for (const m of mists) {
    const sx = m.x - camX * 0.55;
    if (sx < -m.w - 50 || sx > W + 50) continue;
    const mg = CTX.createLinearGradient(sx, m.y, sx + m.w, m.y);
    mg.addColorStop(0, "rgba(255,255,255,0)");
    mg.addColorStop(0.5, `rgba(255,255,255,${m.a})`);
    mg.addColorStop(1, "rgba(255,255,255,0)");
    CTX.fillStyle = mg;
    CTX.fillRect(sx, m.y, m.w, m.h);
  }

  // 水面
  const wg = CTX.createLinearGradient(0, WATER_Y, 0, H);
  wg.addColorStop(0, darken("#3d6f96", 0.5 + P.light * 0.5));
  wg.addColorStop(1, darken("#1d3a55", 0.5 + P.light * 0.5));
  CTX.fillStyle = wg; CTX.fillRect(0, WATER_Y, W, H - WATER_Y);
  // 水波纹
  CTX.strokeStyle = `rgba(255,255,255,${0.05 + P.light * 0.10})`; CTX.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    const y = WATER_Y + 8 + i * 7.5;
    const amp = 3 + i * 0.5;
    CTX.beginPath();
    for (let x = 0; x <= W; x += 16) CTX.lineTo(x, y + Math.sin(x * 0.03 + t * (1 + i * 0.12) + i) * amp * 0.4);
    CTX.stroke();
  }
  // 日光水路（太阳倒影光带）
  CTX.save(); CTX.globalAlpha = 0.20;
  CTX.fillStyle = P.sun;
  for (let i = 0; i < 14; i++) {
    const y = WATER_Y + i * 10, w = 30 + i * 9 + Math.sin(t * 2 + i) * 8;
    CTX.fillRect(sunX - w / 2, y, w, 4);
  }
  CTX.restore();

  // 近岸与树（视差最大层，固定在"地面"）
  CTX.fillStyle = darken("#1f3348", 0.5 + P.light * 0.5);
  CTX.fillRect(0, WATER_Y - 6, W, 6);
  for (const tr of trees) {
    const sx = tr.x - camX * 0.9 + W * 0; // 近层视差 0.9
    const px = ((sx % WORLD_W) + WORLD_W) % WORLD_W;
    if (px < -60 || px > W + 60) continue;
    if (tr.x - camX * 0.9 < -60 || tr.x - camX * 0.9 > W + 60) continue;
    const bx = tr.x - camX * 0.9;
    if (bx < -60 || bx > W + 60) continue;
    CTX.strokeStyle = darken("#22384e", 0.55 + P.light * 0.45); CTX.lineWidth = tr.w;
    CTX.beginPath();
    CTX.moveTo(bx, WATER_Y - 4);
    CTX.quadraticCurveTo(bx + tr.lean * 20, WATER_Y - 4 - tr.h * 0.6, bx + tr.lean * 40, WATER_Y - 4 - tr.h);
    CTX.stroke();
    // 树冠
    const tx = bx + tr.lean * 40, ty = WATER_Y - 4 - tr.h;
    CTX.fillStyle = darken("#2a4a38", 0.55 + P.light * 0.45);
    CTX.beginPath(); CTX.ellipse(tx, ty, tr.h * 0.36, tr.h * 0.22, tr.lean * 0.5, 0, 6.283); CTX.fill();
  }

  // 渔船（水中，随波轻摇）
  {
    const sx = boat.x - camX;
    if (sx > -80 && sx < W + 80) {
      const bob = Math.sin(boat.bob) * 1.2;
      CTX.save(); CTX.translate(sx, WATER_Y + 26 + bob); CTX.rotate(Math.sin(boat.bob * 0.8) * 0.018);
      CTX.fillStyle = darken("#241a12", 0.5 + P.light * 0.5);
      CTX.beginPath(); CTX.moveTo(-26, 0); CTX.lineTo(26, 0); CTX.lineTo(18, 10); CTX.lineTo(-18, 10); CTX.closePath(); CTX.fill();
      CTX.strokeStyle = darken("#241a12", 0.5 + P.light * 0.5); CTX.lineWidth = 2;
      CTX.beginPath(); CTX.moveTo(0, 0); CTX.lineTo(0, -26); CTX.stroke();
      CTX.fillStyle = darken("#d8cfc0", 0.5 + P.light * 0.5);
      CTX.beginPath(); CTX.moveTo(2, -26); CTX.lineTo(20, -8); CTX.lineTo(2, -8); CTX.closePath(); CTX.fill();
      // 船的倒影
      CTX.globalAlpha = 0.25; CTX.scale(1, -0.6);
      CTX.fillStyle = darken("#241a12", 0.5 + P.light * 0.5);
      CTX.beginPath(); CTX.moveTo(-26, 0); CTX.lineTo(26, 0); CTX.lineTo(18, 10); CTX.lineTo(-18, 10); CTX.closePath(); CTX.fill();
      CTX.restore();
    }
  }

  // 岸边灯火（点亮的灯有光晕，水面有光斑）
  for (const l of lamps) {
    const sx = l.x - camX * 0.9;
    if (sx < -40 || sx > W + 40) continue;
    CTX.strokeStyle = darken("#2a3a4d", 0.5 + P.light * 0.5); CTX.lineWidth = 2;
    CTX.beginPath(); CTX.moveTo(sx, WATER_Y - 4); CTX.lineTo(sx, WATER_Y - 26); CTX.stroke();
    if (l.on) {
      const fl = 0.8 + 0.2 * Math.sin(t * 9 + l.flick);
      CTX.save(); CTX.shadowColor = "#ffca7a"; CTX.shadowBlur = 18 * fl;
      CTX.fillStyle = `rgba(255,205,130,${0.75 + P.stars * 0.25})`;
      CTX.beginPath(); CTX.arc(sx, WATER_Y - 30, 3.5, 0, 6.283); CTX.fill();
      CTX.restore();
      // 水面光斑
      CTX.save(); CTX.globalAlpha = 0.30 * fl;
      for (let i = 0; i < 8; i++) {
        const y = WATER_Y + i * 9, w = 8 + i * 5;
        CTX.fillStyle = "#ffca7a";
        CTX.fillRect(sx - w / 2, y, w, 3);
      }
      CTX.restore();
    } else {
      CTX.fillStyle = darken("#41576e", 0.5 + P.light * 0.5);
      CTX.beginPath(); CTX.arc(sx, WATER_Y - 30, 3, 0, 6.283); CTX.fill();
    }
  }

  // 萤火虫（夜晚/深夜出现）
  if (P.stars > 0.4) {
    for (const f of flies) {
      const sx = f.x - camX * 0.85 + Math.sin(t * 0.7 + f.p) * 30;
      const sy = f.y + Math.cos(t * 0.9 + f.q) * 16;
      if (sx < -20 || sx > W + 20) continue;
      const glow = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.6 + f.p * 3));
      CTX.save(); CTX.shadowColor = "#d6ff7a"; CTX.shadowBlur = 8;
      CTX.fillStyle = `rgba(214,255,122,${glow * P.stars})`;
      CTX.beginPath(); CTX.arc(sx, sy, 1.8, 0, 6.283); CTX.fill();
      CTX.restore();
    }
  }

  // 环境光晕（夜晚整体压暗遮罩）
  if (P.light < 0.95) {
    CTX.fillStyle = `rgba(8,12,28,${(1 - P.light) * 0.28})`;
    CTX.fillRect(0, 0, W, H);
  }

  // HUD：时段名
  CTX.fillStyle = "rgba(0,0,0,0.35)";
  CTX.fillRect(10, 10, 150, 26);
  CTX.fillStyle = "#fff"; CTX.font = "14px Consolas, monospace";
  CTX.fillText("现在是：" + P.key + "  (1-5切换)", 18, 28);
}

function loop(ms) {
  const dt = Math.min(0.05, (ms - lastMs) / 1000 || 0.016);
  lastMs = ms;
  update(dt); draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
