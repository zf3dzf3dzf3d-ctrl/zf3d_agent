// game.js 鈥?瓒呯骇鐜涗附锛堝钩鍙拌烦璺冿級路 鍩轰簬 engine2d common.js
"use strict";
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const input = new Input();
const TS = 32, COLS = 60, ROWS = 15;      // 32px 鐡︾墖锛?0x15 鍏冲崱
const VIEW_W = cv.width, VIEW_H = cv.height;

/* ---------- 鍏冲崱锛?鐮?B鐮栧潡 ?閲戝竵鐮?|绠￠亾 g鍦伴潰 F鏃楁潌锛?---------- */
const LEVEL = [
"                                                            ",
"                                                            ",
"                                                            ",
"                ?                          ##               ",
"            ###      ?           B?B                        ",
"                                    ##           ?          ",
"                    ?          ?             ###        F   ",
"        B?B        ###    g                 ####       FF   ",
"                            g   ##          #####      FF   ",
"   ?            g          g                 #####     FF   ",
"  ###    ##    gg    ggg   g      gggg      #######    FF   ",
"                                       gg                   ",
"##############################  ############################",
"############################################################",
"############################################################",
];

/* ---------- 绮剧伒 ---------- */
const sprites = {
  mario: new Sprite(["..RRR..","..RRR..","..SSSS.","R.SSS.R","..BBBB.",".B..B..",".B..B..","WW..WW"],{R:"#e44",S:"#fb5",B:"#42a",W:"#642"}),
  goomba: new Sprite(["..BBB..",".BBBBB.","B.WWB.B","BBBBBBB",".B.B.B.","W.....W"],{B:"#a52",W:"#fff"}),
  coin:  new Sprite([".YYY.","YYyYY","YYyYY","YYyYY",".YYY."],{Y:"#fd2",y:"#fa0"}),
};

const solid = c => c === "#" || c === "B" || c === "g" || c === "|" || c === "G";
const tile = (cx, cy) => (cy < 0 || cy >= ROWS || cx < 0 || cx >= COLS) ? "#" : LEVEL[cy][cx];
const tileAtPx = (px, py) => solid(tile(Math.floor(px / TS), Math.floor(py / TS)));
const phys = new PlatformPhysics(tileAtPx, 1800);
phys.TS = TS;
// 镜头拉近：渲染放大 1.5 倍，实际可视区域 480x320（约15x10格，接近FC原作视野）
const ZOOM = 1.5, VW = Math.ceil(VIEW_W / ZOOM), VH = Math.ceil(VIEW_H / ZOOM);

/* ---------- 瀹炰綋 ---------- */
let player, enemies, coins, flag, score, lives, state, camX, camY, time;

function reset(full) {
  if (full) { score = 0; lives = 3; }
  player = { x: 64, y: 320, w: 20, h: 28, vx: 0, vy: 0, onGround: false, face: 1 };
  enemies = []; coins = [];
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    const c = tile(cx, cy);
    if (c === "?") coins.push({ x: cx * TS + 6, y: cy * TS + 6, w: 20, h: 20, got: false });
    if (c === "g") enemies.push({ x: cx * TS, y: cy * TS - 20, w: 24, h: 20, vx: -60, vy: 0, dead: false, squash: 0 });
    if (c === "F" && (!flag || cx * TS < flag.x)) flag = { x: cx * TS, y: 0 };
  }
  // 鍘婚噸閲戝竵鐮栦笂鐨勯噾甯侊紙鍙繚鐣?锛?
  coins = coins.filter(c => !solid(tile(Math.floor((c.x + 10) / TS), Math.floor((c.y + 10) / TS))));
  camX = 0; camY = 0; time = 0;
}

/* ---------- 闊虫晥锛圵ebAudio 铚傞福锛屾棤闇€绱犳潗锛?---------- */
let AC = null;
function beep(freq, dur, type = "square", vol = 0.04) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}

/* ---------- 背景音乐（8-bit 风格循环旋律） ---------- */
let bgmTimer = null;
function playNote(freq, when, dur, type = "square", vol = 0.03) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, AC.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + when + dur);
  o.connect(g).connect(AC.destination); o.start(AC.currentTime + when); o.stop(AC.currentTime + when + dur);
}
const MARIO_MELODY = [659,0,659,0,523,659,0,784,0,0,0,392,0,0,523,0,0,392,0,0,330,0,0,440,494,466,440,392,0,330,392,440,494,0,523,0,330,0,0,262];
const MARIO_BASS   = [131,0,131,0,131,0,0,196,0,0,98,0,0,98,0,0,131,0,131,0,131,0,0,196,0,0,98,0,0,98,0,0,131,0,131,0,131,0,131,0];
function startBGM() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    if (bgmTimer) return;
    const beat = 0.15, len = MARIO_MELODY.length;
    bgmTimer = setInterval(() => {
      if (state !== "playing") return;
      for (let i = 0; i < len; i++) {
        if (MARIO_MELODY[i]) playNote(MARIO_MELODY[i], i * beat, beat * 0.9, "square", 0.025);
        if (MARIO_BASS[i])   playNote(MARIO_BASS[i],   i * beat, beat * 0.9, "triangle", 0.045);
      }
    }, len * beat * 1000);
  } catch (e) {}
}
function stopBGM() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

function update(dt) {
  if (state !== "playing") {
    if (input.wasPressed("Enter") || input.wasPressed("Space")) { reset(state === "win" ? true : lives <= 0); state = "playing"; startBGM(); }
    return;
  }
  time += dt;
  const SP = 220, JUMP = 620;
  player.vx = 0;
  if (input.isDown("left") || input.isDown("ArrowLeft") || input.isDown("KeyA")) { player.vx = -SP; player.face = -1; }
  if (input.isDown("right") || input.isDown("ArrowRight") || input.isDown("KeyD")) { player.vx = SP; player.face = 1; }
  if ((input.wasPressed("Space") || input.wasPressed("ArrowUp") || input.wasPressed("KeyW")) && player.onGround) { player.vy = -JUMP; beep(440, 0.12, "square", 0.05); }
  player.vy = Math.min(player.vy + phys.g * dt, 900);
  const r = phys.move(player, dt);
  player.onGround = r.onGround;
  if (r.hitCeil) { player.vy = 0; beep(200, 0.08); }

  // 鎺夊潙
  if (player.y > ROWS * TS + 40) {
    lives--; beep(120, 0.4, "sawtooth");
    if (lives <= 0) state = "over"; else reset(false);
    if (state === "over") stopBGM();
    return;
  }

  // 閲戝竵
  for (const c of coins) {
    if (!c.got && aabb(player, c)) { c.got = true; score += 100; beep(880, 0.08, "triangle"); }
  }
  // 鏁屼汉
  for (const e of enemies) {
    if (e.dead) { e.squash += dt; continue; }
    e.vy = Math.min(e.vy + phys.g * dt, 900);
    // 绠€鍗旳I锛氭挒澧?鍒拌竟缂樿浆韬?
    const ahead = tile(Math.floor((e.x + (e.vx > 0 ? e.w + 2 : -2)) / TS), Math.floor((e.y + e.h / 2) / TS));
    const belowAhead = tile(Math.floor((e.x + (e.vx > 0 ? e.w + 2 : -2)) / TS), Math.floor((e.y + e.h + 4) / TS));
    if (solid(ahead) || !solid(belowAhead) || e.x <= 0 || e.x >= COLS * TS - e.w) e.vx = -e.vx;
    phys.move(e, dt);
    if (aabb(player, e)) {
      if (player.vy > 100 && player.y + player.h - player.vy * dt <= e.y + 8) {
        e.dead = true; e.squash = 0; player.vy = -400; score += 200; beep(300, 0.1, "square");
      } else {
        lives--; beep(120, 0.4, "sawtooth");
        if (lives <= 0) { state = "over"; stopBGM(); return; }
        reset(false); return;
      }
    }
  }
  // 閫氬叧
  if (flag && player.x + player.w > flag.x) { state = "win"; score += 1000; stopBGM(); beep(660, 0.3, "triangle"); }
  // 摄像机（世界坐标，视野按缩放后的可视区域计算；纵横向都跟随主角）
  camX = Math.max(0, Math.min(player.x - VW * 0.4, COLS * TS - VW));
  const WORLD_H = ROWS * TS;
  const targetY = Math.max(0, Math.min(player.y + player.h / 2 - VH * 0.55, WORLD_H - VH));
  camY += (targetY - camY) * Math.min(1, dt * 8);
}

function drawTile(c, x, y) {
  if (c === "#") { ctx.fillStyle = "#c84c28"; ctx.fillRect(x, y, TS, TS); ctx.fillStyle = "#0003"; ctx.fillRect(x, y + TS - 4, TS, 4); }
  else if (c === "B") { ctx.fillStyle = "#d88030"; ctx.fillRect(x, y, TS, TS); ctx.strokeStyle = "#7a4010"; ctx.strokeRect(x + 2.5, y + 2.5, TS - 5, TS - 5); }
  else if (c === "g" || c === "|") { ctx.fillStyle = "#0a3"; ctx.fillRect(x + 4, y - 26, TS - 8, 26); }
  else if (c === "F") { ctx.fillStyle = "#0c0"; ctx.fillRect(x + 12, y, 8, TS); }
}

function render() {
  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  ctx.fillStyle = "#5c94fc"; ctx.fillRect(0, 0, VW, VH);
  const cx0 = Math.floor(camX / TS);
  const cy0 = Math.floor(camY / TS);
  for (let cy = cy0; cy <= cy0 + VH / TS + 1 && cy < ROWS; cy++) for (let cx = cx0; cx <= cx0 + VW / TS + 1; cx++) {
    drawTile(tile(cx, cy), cx * TS - camX, cy * TS - camY);
  }
  for (const c of coins) if (!c.got) sprites.coin.draw(ctx, c.x - camX, c.y - camY, 4);
  for (const e of enemies) if (!e.dead) sprites.goomba.draw(ctx, e.x - camX, e.y - camY, 3, e.vx > 0);
  if (player && state !== "over") sprites.mario.draw(ctx, player.x - camX - 5, player.y - camY - 4, 3, player.face < 0);
  ctx.restore();
  HUD.text(ctx, `Coins ${score}   Life ${"\u2665".repeat(Math.max(0, lives))}`, 12, 24, "#fff", 16);
  if (state === "over") { HUD.text(ctx, "娓告垙缁撴潫 鈥?鎸?Enter 閲嶆潵", VIEW_W / 2, VIEW_H / 2, "#f66", 26, "center"); }
  if (state === "win")  { HUD.text(ctx, "閫氬叧锛佸緱鍒?" + score + " 鈥?鎸?Enter 鍐嶇帺", VIEW_W / 2, VIEW_H / 2, "#ff6", 26, "center"); }
  if (state === "loading") HUD.text(ctx, "Press Enter to start", VIEW_W / 2, VIEW_H / 2, "#fff", 24, "center");
}

input.bind("left", "ArrowLeft", "KeyA");
input.bind("right", "ArrowRight", "KeyD");
input.bind("jump", "Space", "ArrowUp", "KeyW");

reset(true); state = "loading";
let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); render(); input.endFrame();
  requestAnimationFrame(frame);
})(performance.now());
