// game.js 鈥?澶┖灏勫嚮锛圓I 鎸夎鑼冪敓鎴愮殑绗竴涓父鎴忥級
// 渚濊禆锛歩nput.js / core.js锛堝叏灞€锛欼nput, Entity, EntityManager, CollisionSystem, Config锛?
"use strict";

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const input = new Input(cv);
const cfg = new Config();

/* ---------- 瀹炰綋 ---------- */
class Player extends Entity {
  constructor(x, y) { super(x, y); this.hp = cfg.get("player.hp", 3); this.cd = 0; }
  update(dt) {
    const sp = cfg.get("player.speed", 260);
    if (input.isDown("left"))  this.x -= sp * dt;
    if (input.isDown("right")) this.x += sp * dt;
    if (input.isDown("up"))    this.y -= sp * dt;
    if (input.isDown("down"))  this.y += sp * dt;
    this.x = Math.max(16, Math.min(cfg.get("world.w", 720) - 16, this.x));
    this.y = Math.max(16, Math.min(cfg.get("world.h", 520) - 16, this.y));
    this.cd -= dt;
    if (input.isDown("shoot") && this.cd <= 0) {
      this.cd = cfg.get("player.fireInterval", 0.22);
      em.spawn(Bullet, this.x, this.y - 14);
      Telemetry.event("shoot");
    }
  }
}
class Bullet extends Entity {
  constructor(x, y) { super(x, y); }
  update(dt) {
    this.y -= cfg.get("bullet.speed", 520) * dt;
    if (this.y < -10) this.dead = true;
  }
}
class Enemy extends Entity {
  constructor(x, wave) {
    super(x, -20);
    this.speed = cfg.get("enemy.speed", 110) + wave * 8;  // 娉㈡瓒婂悗瓒婂揩
    this.r = cfg.get("enemy.radius", 14);
  }
  update(dt) {
    this.y += this.speed * dt;
    if (this.y > cfg.get("world.h", 520) + 30) { this.dead = true; Telemetry.event("leak"); }
  }
}

/* ---------- 鍏ㄥ眬鐘舵€?---------- */
const em = new EntityManager();
const col = new CollisionSystem();
let state = "loading";   // loading / playing / over
let score = 0, wave = 1, spawnT = 0, player = null;

function startGame() {
  em.list.length = 0; col.items.length = 0;
  player = em.add(new Player(cfg.get("world.w", 720) / 2, cfg.get("world.h", 520) - 60));
  col.add(player, { type: "circle", r: cfg.get("player.radius", 12) }, {
    tag: "player", onEnter: (hit) => {
      if (hit instanceof Enemy && !hit.dead) {
        hit.dead = true; player.hp -= cfg.get("enemy.damage", 1);
        Telemetry.event("hurt", { hp: player.hp });
        if (player.hp <= 0) gameOver("death");
      }
    }
  });
  score = 0; wave = 1; spawnT = 0; state = "playing";
  Telemetry.begin();
}

function gameOver(status) {
  state = "over";
  Telemetry.data.score = score;
  Telemetry.data.max_progress = "wave-" + wave;
  Telemetry.end(status);
}

/* ---------- 杈撳叆鏄犲皠 ---------- */
input.bind("up", "KeyW", "ArrowUp"); input.bind("down", "KeyS", "ArrowDown");
input.bind("left", "KeyA", "ArrowLeft"); input.bind("right", "KeyD", "ArrowRight");
input.bind("shoot", "Space");

/* ---------- 涓诲惊鐜?---------- */
function update(dt) {
  if (state === "loading") return;
  if (state === "over") {
    if (input.isDown("shoot")) startGame();
    return;
  }
  // 鏁屼汉鍒锋柊锛氭尝娆?姣?0绉?1
  wave = 1 + Math.floor(performance.now() / 20000);
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = Math.max(0.25, cfg.get("enemy.spawnInterval", 1.1) - wave * 0.05);
    const e = em.spawn(Enemy, 30 + Math.random() * (cfg.get("world.w", 720) - 60), wave);
    col.add(e, { type: "circle", r: e.r }, { tag: "enemy" });
  }
  em.update(dt);
  // 瀛愬脊 vs 鏁屼汉
  for (const b of em.byTag ? em.list.filter(e => e instanceof Bullet) : em.list) {
    for (const e of em.list) {
      if (e instanceof Enemy && !e.dead && !b.dead) {
        const dx = b.x - e.x, dy = b.y - e.y, r = e.r + cfg.get("bullet.radius", 3);
        if (dx * dx + dy * dy <= r * r) {
          e.dead = true; b.dead = true; score += 10; Telemetry.event("kill", { score }); Telemetry.data.score = score; Telemetry.data.max_progress = "wave-" + wave;
        }
      }
    }
  }
  col.update();
}

function render() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#9df";
  ctx.font = "14px Consolas";
  if (state === "playing" || state === "over") {
    // 鐜╁
    if (player && !player.dead) {
      ctx.fillStyle = "#4cf";
      ctx.beginPath(); ctx.moveTo(player.x, player.y - 14);
      ctx.lineTo(player.x - 12, player.y + 12); ctx.lineTo(player.x + 12, player.y + 12);
      ctx.closePath(); ctx.fill();
      // 琛€鏉?
      for (let i = 0; i < player.hp; i++) { ctx.fillStyle = "#f66"; ctx.fillRect(10 + i * 18, 10, 14, 8); }
    }
    // 瀹炰綋
    for (const e of em.list) {
      if (e instanceof Bullet) { ctx.fillStyle = "#ff6"; ctx.beginPath(); ctx.arc(e.x, e.y, cfg.get("bullet.radius", 3), 0, 7); ctx.fill(); }
      else if (e instanceof Enemy) {
        ctx.fillStyle = "#f55"; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill();
        ctx.fillStyle = "#faa"; ctx.fillRect(e.x - 8, e.y - 3, 16, 6);
      }
    }
    // HUD
    ctx.fillStyle = "#9df"; ctx.fillText(`Score ${score}   Wave ${wave}`, 10, 36);
    if (state === "over") {
      ctx.fillStyle = "#fff"; ctx.font = "28px Consolas";
      ctx.fillText("Game Over - press Space to restart", cv.width / 2 - 150, cv.height / 2);
    }
  }
  input.endFrame();
}

/* ---------- 鍚姩 ---------- */
(async () => {
  try {
    await cfg.load("config.json");
    cfg.watch("config.json");  // 2绉掔儹鏇?
    startGame();
  } catch (e) {
    state = "over";
    ctx.fillStyle = "#f66"; ctx.font = "16px Consolas";
    ctx.fillText("Load failed: " + e.message + " (access via server.py)", 20, cv.height / 2);
  }
  let last = performance.now();
  (function frame(now) {
    update(Math.min(0.05, (now - last) / 1000)); last = now;
    render();
    requestAnimationFrame(frame);
  })(performance.now());
})();
