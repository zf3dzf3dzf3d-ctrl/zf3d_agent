// game.js 鈥?娌欑綏鏇艰泧锛堢旱鐗堥琛屽皠鍑伙細娉㈡鏁屾満 + Boss锛壜?鍩轰簬 engine2d common.js
"use strict";
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const input = new Input();
const W = cv.width, H = cv.height;

const sprites = {
  ship:  new Sprite(["...F...","..FFF..",".FFFFF.","FFFWFFF","F.F.F.F","W.....W"],{F:"#4cf",W:"#fff"}),
  enemy: new Sprite(["R.....R",".RRRRR.",".REEER.","RRRRRRR",".R.R.R."],{R:"#e55",E:"#fff"}),
  boss:  new Sprite(["..PPPPP..",".PPPPPPP.","PPWPPPWPP","PPPPPPPPP",".PP.P.PP.","P.......P"],{P:"#a5e",W:"#f66"}),
};

let player, pbullets, ebullets, enemies, boss, score, state, camX, wave, fireCd, waveT, bgStars;

function reset() {
  player = { x: W / 2, y: H - 70, w: 26, h: 24, hp: 5, inv: 0 };
  pbullets = []; ebullets = []; enemies = []; boss = null;
  score = 0; wave = 0; fireCd = 0; waveT = 1.2;
  bgStars = Array.from({ length: 60 }, () => ({ x: R.range(0, W), y: R.range(0, H), s: R.range(20, 90) }));
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

/* ---------- 背景音乐（太空射击风 8-bit 循环） ---------- */
let bgmTimer = null;
function playNote(freq, when, dur, type = "square", vol = 0.03) {
  const AC = window.__AC;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, AC.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + when + dur);
  o.connect(g).connect(AC.destination); o.start(AC.currentTime + when); o.stop(AC.currentTime + when + dur);
}
const SALA_MELODY = [440,0,554,0,659,0,554,0,440,0,554,0,740,0,659,0,587,0,494,0,587,0,740,0,587,0,494,0,440,0,0,0];
const SALA_BASS   = [110,0,0,110,0,0,110,0,110,0,0,110,0,0,110,0,123,0,0,123,0,0,123,0,123,0,0,123,0,0,123,0];
function startBGM() {
  try {
    window.__AC = window.__AC || new (window.AudioContext || window.webkitAudioContext)();
    if (window.__AC.state === "suspended") window.__AC.resume();
    if (bgmTimer) return;
    const beat = 0.15, len = SALA_MELODY.length;
    bgmTimer = setInterval(() => {
      if (state !== "playing") return;
      for (let i = 0; i < len; i++) {
        if (SALA_MELODY[i]) playNote(SALA_MELODY[i], i * beat, beat * 0.9, "square", 0.025);
        if (SALA_BASS[i])   playNote(SALA_BASS[i],   i * beat, beat * 0.9, "triangle", 0.045);
      }
    }, len * beat * 1000);
  } catch (e) {}
}
function stopBGM() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

function mkEnemy(x, y, kind) {
  return { x, y, w: kind === "zig" ? 24 : 26, h: 20, kind,
    hp: kind === "zig" ? 1 : 2,
    t: 0, baseX: x, vx: kind === "zig" ? 130 : 0, vy: kind === "zig" ? 90 : 120,
    fireCd: R.range(0.8, 2.2), dead: false };
}

function spawnWave() {
  wave++;
  if (wave % 4 === 0) { // Boss 娉?
    boss = { x: W / 2, y: -60, w: 90, h: 60, hp: 60 + wave * 10, t: 0, fireCd: 1, dead: false };
    return;
  }
  const n = 4 + Math.min(6, wave);
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      if (state !== "playing") return;
      const kind = Math.random() < 0.5 ? "zig" : "straight";
      enemies.push(mkEnemy(R.range(40, W - 80), -30, kind));
    }, i * 450);
  }
}

function hurt() {
  if (player.inv > 0) return;
  player.hp--; player.inv = 1.5;
  beep(120, 0.35, "sawtooth");
  if (player.hp <= 0) { state = "over"; stopBGM(); }
}

function update(dt) {
  if (state !== "playing") {
    if (input.wasPressed("Enter") || input.wasPressed("Space")) { reset(); state = "playing"; startBGM(); }
    return;
  }
  for (const s of bgStars) { s.y += s.s * dt; if (s.y > H) { s.y = -2; s.x = R.range(0, W); } }
  player.inv = Math.max(0, player.inv - dt);
  const SP = 280;
  if (input.isDown("left") || input.isDown("KeyA") || input.isDown("ArrowLeft")) player.x -= SP * dt;
  if (input.isDown("right") || input.isDown("KeyD") || input.isDown("ArrowRight")) player.x += SP * dt;
  if (input.isDown("up") || input.isDown("KeyW") || input.isDown("ArrowUp")) player.y -= SP * dt;
  if (input.isDown("down") || input.isDown("KeyS") || input.isDown("ArrowDown")) player.y += SP * dt;
  player.x = Math.max(16, Math.min(W - 16, player.x));
  player.y = Math.max(30, Math.min(H - 30, player.y));
  fireCd -= dt;
  if ((input.isDown("KeyJ") || input.isDown("KeyX") || input.isDown("Space") || input.mouseDown(0)) && fireCd <= 0) {
    fireCd = 0.18;
    pbullets.push({ x: player.x, y: player.y - 16, r: 3, vy: -560, dead: false });
    if (wave >= 2) { pbullets.push({ x: player.x - 12, y: player.y - 8, r: 2.5, vy: -520, vx: -80, dead: false });
                     pbullets.push({ x: player.x + 12, y: player.y - 8, r: 2.5, vy: -520, vx: 80, dead: false }); }
    beep(760, 0.05, "square", 0.025);
  }

  // 娉㈡鎺ㄨ繘
  waveT -= dt;
  if (waveT <= 0 && !boss && enemies.length === 0) { spawnWave(); waveT = 3.5; }

  for (const b of pbullets) { b.y += (b.vy || -520) * dt; b.x += (b.vx || 0) * dt; if (b.y < -10) b.dead = true; }

  for (const e of enemies) {
    if (e.dead) continue;
    e.t += dt;
    if (e.kind === "zig") e.x = e.baseX + Math.sin(e.t * 3) * 60;
    e.y += e.vy * dt;
    if (e.y > H + 30) { e.dead = true; continue; }
    e.fireCd -= dt;
    if (e.fireCd <= 0 && e.y > 0 && e.y < H * 0.6) {
      e.fireCd = R.range(1.5, 3);
      const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1;
      ebullets.push({ x: e.x, y: e.y + 10, r: 4, vx: dx / d * 220, vy: dy / d * 220, dead: false });
    }
    if (Math.hypot(player.x - e.x, player.y - e.y) < 22) { e.dead = true; hurt(); }
  }
  enemies = enemies.filter(e => !e.dead);

  if (boss) {
    if (!boss.dead && boss.y < 80) boss.y += 60 * dt;
    boss.t += dt;
    boss.x = W / 2 + Math.sin(boss.t * 0.8) * (W / 2 - 110);
    boss.fireCd -= dt;
    if (boss.fireCd <= 0) {
      boss.fireCd = 0.9;
      for (let k = -2; k <= 2; k++) {
        const a = Math.PI / 2 + k * 0.28;
        ebullets.push({ x: boss.x, y: boss.y + 30, r: 5, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, dead: false });
      }
      beep(150, 0.12, "sawtooth", 0.03);
    }
    // 鍑讳腑 Boss
    for (const b of pbullets) {
      if (!b.dead && boss && !boss.dead && Math.abs(b.x - boss.x) < boss.w / 2 && Math.abs(b.y - boss.y) < boss.h / 2) {
        b.dead = true; boss.hp -= 1; score += 20; beep(420, 0.03, "square", 0.02);
        if (boss.hp <= 0) { boss.dead = true; boss = null; score += 2000; beep(880, 0.4, "triangle"); waveT = 3; }
      }
    }
  }

  // 鐜╁瀛愬脊 vs 鏁屾満
  for (const b of pbullets) {
    for (const e of enemies) {
      if (!e.dead && !b.dead && Math.hypot(b.x - e.x, b.y - e.y) < 18) {
        b.dead = true; e.hp--;
        if (e.hp <= 0) { e.dead = true; score += 100; beep(520, 0.06, "square", 0.02); }
      }
    }
  }
  // 鏁屽脊 vs 鐜╁
  for (const b of ebullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y > H + 10 || b.y < -10 || b.x < -10 || b.x > W + 10) b.dead = true;
    if (!b.dead && player.inv <= 0 && Math.hypot(b.x - player.x, b.y - player.y) < 14) { b.dead = true; hurt(); }
  }
  pbullets = pbullets.filter(b => !b.dead);
  ebullets = ebullets.filter(b => !b.dead);
}

function render() {
  ctx.fillStyle = "#04070f"; ctx.fillRect(0, 0, W, H);
  for (const s of bgStars) { ctx.fillStyle = `rgba(200,220,255,${0.25 + s.s / 150})`; ctx.fillRect(s.x, s.y, 2, 2); }
  for (const e of enemies) sprites.enemy.draw(ctx, e.x - 13, e.y - 10, 2.4, e.kind === "zig");
  if (boss) sprites.boss.draw(ctx, boss.x - 45, boss.y - 28, 4, false);
  for (const b of pbullets) { ctx.fillStyle = "#ff6"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); }
  for (const b of ebullets) { ctx.fillStyle = "#f55"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); }
  if (player && state !== "over") {
    ctx.globalAlpha = player.inv > 0 && Math.floor(player.inv * 10) % 2 === 0 ? 0.35 : 1;
    sprites.ship.draw(ctx, player.x - 21, player.y - 18, 3, false);
    ctx.globalAlpha = 1;
  }
  HUD.text(ctx, `Score ${score}   Wave ${wave}   Life ${"\u2665".repeat(Math.max(0, player ? player.hp : 0))}`, 12, 24, "#cde", 16);
  if (boss && !boss.dead) HUD.bar(ctx, W / 2 - 100, 34, 200, 10, boss.hp / (60 + wave * 10), "#e55");
  if (state === "over") HUD.text(ctx, "You died - press Enter to restart", W / 2, H / 2, "#f66", 26, "center");
  if (state === "loading") HUD.text(ctx, "WASD/Arrows move - J/Space/Mouse shoot - press Enter to start", W / 2, H / 2, "#fff", 18, "center");
}

input.bind("left", "ArrowLeft", "KeyA");
input.bind("right", "ArrowRight", "KeyD");
input.bind("up", "ArrowUp", "KeyW");
input.bind("down", "ArrowDown", "KeyS");

reset(); state = "loading";
let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); render(); input.endFrame();
  requestAnimationFrame(frame);
})(performance.now());
