// game.js 鈥?榄傛枟缃楋紙妯増灏勫嚮锛壜?鍩轰簬 engine2d common.js
"use strict";
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const input = new Input();
const TS = 32, COLS = 90, ROWS = 15, VIEW_W = cv.width, VIEW_H = cv.height;

/* 鍏冲崱锛?鍦?B绠?|鏍?F缁堢偣闂ㄣ€傛瘮鐜涗附鏇撮暱鏇村钩锛岀獊鍑哄皠鍑?*/
const LEVEL = [
"                                                                                            ",
"                                                                                            ",
"                                                                                            ",
"                                                                                            ",
"            B                    B                  B              B                       ",
"                                            ?                                  ?           ",
"        ##            ##         ##                ###           ##            ###    F    ",
"                                                            B                        F     ",
"                         B                 ##                        B          ####  F    ",
"   ##        ##        ##        ###      ##     ##      ###    ####     ###   #####  F    ",
"###############################################  ##########################################",
"###############################################  ##########################################",
"############################################################  ##############################",
"############################################################################################",
"############################################################################################",
];

const sprites = {
  player: new Sprite(["..BBB..",".BBBBB.","B.WWB.B","..SSS..",".S.S.S.",".S...S.","BB...BB"],{B:"#48f",S:"#fb5",W:"#fff"}),
  soldier: new Sprite(["..GGG..",".GGGGG.","G.RRG.G","..GGG..",".G.G.G.","K.....K"],{G:"#4a4",R:"#f33",K:"#222"}),
  bulletE: new Sprite(["O"],{O:"#f80"}),
};

const solid = c => c === "#" || c === "B";
const tile = (cx, cy) => (cy < 0 || cy >= ROWS || cx < 0 || cx >= COLS) ? (cy >= ROWS ? "." : "#") : LEVEL[cy][cx];
const tileAtPx = (px, py) => solid(tile(Math.floor(px / TS), Math.floor(py / TS)));
const phys = new PlatformPhysics(tileAtPx, 1700);
phys.TS = TS;
// 镜头拉近：渲染放大 1.5 倍，可视区域 480x320
const ZOOM = 1.5, VW = Math.ceil(VIEW_W / ZOOM), VH = Math.ceil(VIEW_H / ZOOM);

let player, bullets, ebullets, enemies, flagX, score, lives, state, camX, camY, fireCd, spawnT;

function reset(full) {
  if (full) { score = 0; lives = 3; }
  player = { x: 64, y: 320, w: 22, h: 30, vx: 0, vy: 0, onGround: false, face: 1 };
  bullets = []; ebullets = []; enemies = [];
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    if (LEVEL[cy][cx] === "F" && (!flagX || cx * TS < flagX)) flagX = cx * TS;
  }
  camX = 0; camY = 0; fireCd = 0; spawnT = 1;
  spawnInitialEnemies();
}
function spawnInitialEnemies() {
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    if (LEVEL[cy][cx] === "?") enemies.push(mkEnemy(cx * TS, cy * TS - 24));
  }
}
function mkEnemy(x, y) {
  return { x, y, w: 24, h: 24, vx: -55, vy: 0, hp: 2, fireCd: R.range(1, 3), dead: false };
}

function beep(freq, dur, type = "square", vol = 0.035) {
  try {
    const AC = window.__AC || (window.__AC = new (window.AudioContext || window.webkitAudioContext)());
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}

/* ---------- 背景音乐（丛林风 8-bit 循环） ---------- */
let bgmTimer = null;
function playNote(freq, when, dur, type = "square", vol = 0.03) {
  const AC = window.__AC;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, AC.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + when + dur);
  o.connect(g).connect(AC.destination); o.start(AC.currentTime + when); o.stop(AC.currentTime + when + dur);
}
const CONTRA_MELODY = [330,0,392,0,523,0,0,0,494,0,0,0,392,0,0,0,330,0,392,0,587,0,0,0,523,0,494,0,392,0,0,0];
const CONTRA_BASS   = [110,0,110,0,110,0,110,0,147,0,147,0,147,0,147,0,110,0,110,0,110,0,110,0,147,0,147,0,147,0,147,0];
function startBGM() {
  try {
    window.__AC = window.__AC || new (window.AudioContext || window.webkitAudioContext)();
    if (window.__AC.state === "suspended") window.__AC.resume();
    if (bgmTimer) return;
    const beat = 0.14, len = CONTRA_MELODY.length;
    bgmTimer = setInterval(() => {
      if (state !== "playing") return;
      for (let i = 0; i < len; i++) {
        if (CONTRA_MELODY[i]) playNote(CONTRA_MELODY[i], i * beat, beat * 0.9, "square", 0.025);
        if (CONTRA_BASS[i])   playNote(CONTRA_BASS[i],   i * beat, beat * 0.9, "sawtooth", 0.035);
      }
    }, len * beat * 1000);
  } catch (e) {}
}
function stopBGM() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

function hurt() {
  lives--; beep(110, 0.4, "sawtooth");
  if (lives <= 0) { state = "over"; stopBGM(); } else { const s = score; reset(false); score = s; }
}

function update(dt) {
  if (state !== "playing") {
    if (input.wasPressed("Enter") || input.wasPressed("Space")) { reset(true); state = "playing"; startBGM(); }
    return;
  }
  const SP = 200, JUMP = 560;
  player.vx = 0;
  if (input.isDown("left") || input.isDown("KeyA") || input.isDown("ArrowLeft")) { player.vx = -SP; player.face = -1; }
  if (input.isDown("right") || input.isDown("KeyD") || input.isDown("ArrowRight")) { player.vx = SP; player.face = 1; }
  if ((input.wasPressed("Space") || input.wasPressed("KeyW") || input.wasPressed("ArrowUp")) && player.onGround) { player.vy = -JUMP; beep(330, 0.1); }
  // 鏈濆悜灏勫嚮
  fireCd -= dt;
  if ((input.isDown("KeyJ") || input.isDown("KeyX") || input.mouseDown(0)) && fireCd <= 0) {
    fireCd = 0.25;
    bullets.push({ x: player.x + player.w / 2 + player.face * 14, y: player.y + 10, w: 10, h: 4, vx: player.face * 520, dead: false });
    beep(700, 0.05, "square", 0.03);
  }
  player.vy = Math.min(player.vy + phys.g * dt, 900);
  const r = phys.move(player, dt); player.onGround = r.onGround;
  if (player.y > ROWS * TS + 40) { hurt(); return; }

  // 鏁屼汉琛ュ厖娉細浠庡睆骞曞彸渚у鐢熸垚
  spawnT -= dt;
  if (spawnT <= 0 && enemies.filter(e => !e.dead).length < 8) {
    spawnT = R.range(1.2, 2.4);
    enemies.push(mkEnemy(camX + VIEW_W + 30, ROWS * TS - 2 * TS - 26));
  }
  for (const e of enemies) {
    if (e.dead) continue;
    e.vy = Math.min(e.vy + phys.g * dt, 900);
    const aheadX = e.x + (e.vx > 0 ? e.w + 2 : -2);
    if (solid(tile(Math.floor(aheadX / TS), Math.floor((e.y + e.h / 2) / TS))) ||
        !solid(tile(Math.floor(aheadX / TS), Math.floor((e.y + e.h + 4) / TS)))) e.vx = -e.vx;
    // 闈㈠悜鐜╁涓斿湪瑙嗛噹鍐呭垯寮€鏋?
    e.fireCd -= dt;
    const dx = player.x - e.x;
    if (Math.abs(dx) < 420 && Math.abs(player.y - e.y) < 80 && e.fireCd <= 0) {
      e.fireCd = R.range(1.4, 2.6);
      ebullets.push({ x: e.x + e.w / 2, y: e.y + 10, w: 8, h: 4, vx: Math.sign(dx) * 300, dead: false });
      beep(220, 0.06, "sawtooth", 0.02);
    }
    phys.move(e, dt);
    if (aabb(player, e)) { hurt(); return; }
  }
  for (const b of bullets) { b.x += b.vx * dt; if (Math.abs(b.x - player.x) > VIEW_W) b.dead = true;
    for (const e of enemies) if (!e.dead && aabb(b, e)) { e.hp--; b.dead = true; beep(500, 0.03, "square", 0.02); if (e.hp <= 0) { e.dead = true; score += 150; } }
    if (solid(tile(Math.floor((b.x + (b.vx > 0 ? b.w : 0)) / TS), Math.floor(b.y / TS)))) b.dead = true;
  }
  for (const b of ebullets) { b.x += b.vx * dt; if (Math.abs(b.x - player.x) > VIEW_W) b.dead = true;
    if (aabb(b, player)) { b.dead = true; hurt(); return; } }
  if (player.x + player.w > flagX) { state = "win"; score += 1000; stopBGM(); beep(660, 0.3, "triangle"); }
  camX = Math.max(0, Math.min(player.x - VW * 0.4, COLS * TS - VW));
  const targetY = Math.max(0, Math.min(player.y + player.h / 2 - VH * 0.55, ROWS * TS - VH));
  camY += (targetY - camY) * Math.min(1, dt * 8);
}

function render() {
  // 瑙嗗樊灞?
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, "#123"); g.addColorStop(1, "#456");
  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = "#0004";
  for (let i = 0; i < 6; i++) {
    const mx = ((i * 300 - camX * 0.3) % (VW + 300) + VW + 300) % (VW + 300) - 150;
    ctx.beginPath(); ctx.moveTo(mx - 120, VH); ctx.lineTo(mx, 220); ctx.lineTo(mx + 120, VH); ctx.fill();
  }
  const cx0 = Math.floor(camX / TS);
  const cy0 = Math.floor(camY / TS);
  for (let cy = cy0; cy <= cy0 + VH / TS + 1 && cy < ROWS; cy++) for (let cx = cx0; cx <= cx0 + VW / TS + 1; cx++) {
    const c = tile(cx, cy);
    if (c === "#") { ctx.fillStyle = "#3a5f3a"; ctx.fillRect(cx * TS - camX, cy * TS - camY, TS, TS); ctx.fillStyle = "#2a4a2a"; ctx.fillRect(cx * TS - camX, cy * TS - camY, TS, 5); }
    else if (c === "B") { ctx.fillStyle = "#868"; ctx.fillRect(cx * TS - camX, cy * TS - camY, TS, TS); ctx.strokeStyle = "#333"; ctx.strokeRect(cx * TS - camX + 2.5, cy * TS - camY + 2.5, TS - 5, TS - 5); }
    else if (c === "F") { ctx.fillStyle = "#0df"; ctx.fillRect(cx * TS - camX + 12, cy * TS - camY, 8, TS); }
  }
  for (const e of enemies) if (!e.dead) sprites.soldier.draw(ctx, e.x - camX, e.y - camY, 3, e.vx > 0);
  ctx.fillStyle = "#ff6";
  for (const b of bullets) ctx.fillRect(b.x - camX, b.y - camY, b.w, b.h);
  ctx.fillStyle = "#f80";
  for (const b of ebullets) ctx.fillRect(b.x - camX, b.y - camY, b.w, b.h);
  if (player && state !== "over") sprites.player.draw(ctx, player.x - camX - 4, player.y - camY - 4, 3, player.face < 0);
  ctx.restore();
  HUD.text(ctx, `Score ${score}   Life ${"\u2665".repeat(Math.max(0, lives))}`, 12, 24, "#fff", 16);
  if (state === "over") HUD.text(ctx, "浠诲姟澶辫触 鈥?鎸?Enter 閲嶆潵", VIEW_W / 2, VIEW_H / 2, "#f66", 26, "center");
  if (state === "win")  HUD.text(ctx, "浠诲姟瀹屾垚锛佸緱鍒?" + score, VIEW_W / 2, VIEW_H / 2, "#6f6", 26, "center");
  if (state === "loading") HUD.text(ctx, "J/X or Mouse shoot - press Enter to start", VIEW_W / 2, VIEW_H / 2, "#fff", 22, "center");
}

input.bind("left", "ArrowLeft", "KeyA");
input.bind("right", "ArrowRight", "KeyD");

reset(true); state = "loading";
let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); render(); input.endFrame();
  requestAnimationFrame(frame);
})(performance.now());
