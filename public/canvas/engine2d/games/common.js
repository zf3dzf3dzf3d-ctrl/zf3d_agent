// common.js — 三个游戏共用的辅助模块 v1.0
// 提供：Sprite（像素画精灵/调色板绘制）、AABB(矩形碰撞)、PlatformPhysics（平台跳跃物理）、
//       HUD（血条/分数/提示）、rand helpers。零依赖，可无头加载。
"use strict";

/* ---------- 矩形碰撞 ---------- */
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/* ---------- 随机助手 ---------- */
const R = {
  range: (a, b) => a + Math.random() * (b - a),
  int: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)]
};

/* ---------- 像素精灵绘制器 ----------
 * 用字符串数组定义像素画，每字符对应调色板颜色，'.'为透明。
 * draw(ctx, x, y, scale, flip) 支持放大与水平翻转。
 */
class Sprite {
  constructor(rows, palette) {
    this.rows = rows;
    this.pal = palette;
    this.w = rows[0].length;
    this.h = rows.length;
    // 预渲染到离屏画布（1px = 1texel），绘制时整数倍放大 + 关闭平滑 → 清晰像素画
    try {
      this.cv = document.createElement("canvas");
      this.cv.width = this.w; this.cv.height = this.h;
      const c = this.cv.getContext("2d");
      for (let j = 0; j < this.h; j++) {
        const row = rows[j];
        for (let i = 0; i < row.length; i++) {
          const col = palette[row[i]];
          if (!col) continue;
          c.fillStyle = col;
          c.fillRect(i, j, 1, 1);
        }
      }
    } catch (e) { this.cv = null; } // 无头环境退化到逐像素绘制
  }
  draw(ctx, x, y, scale = 2, flip = false) {
    if (this.cv) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(Math.round(x), Math.round(y));
      if (flip) { ctx.scale(-1, 1); ctx.translate(-this.w * scale, 0); }
      ctx.drawImage(this.cv, 0, 0, this.w * scale, this.h * scale);
      ctx.restore();
    } else {
      const s = scale;
      for (let j = 0; j < this.h; j++) {
        const row = this.rows[j];
        for (let i = 0; i < row.length; i++) {
          const c = row[i];
          if (c === "." || c === " ") continue;
          const col = this.pal[c];
          if (!col) continue;
          ctx.fillStyle = col;
          ctx.fillRect(x + (flip ? (this.w - 1 - i) : i) * s, y + j * s, s, s);
        }
      }
    }
  }
}

/* ---------- 平台跳跃物理（超级玛丽/魂斗罗共用） ----------
 * 实体需有 x,y,w,h,vx,vy。tileAt(px,py) 返回该像素点所在瓦片是否为实心。
 */
class PlatformPhysics {
  constructor(tileAt, gravity = 1500) {
    this.tileAt = tileAt;
    this.g = gravity;
    this.TS = 16; // 瓦片尺寸（世界单位，绘制时再乘 scale）
  }
  // 返回 {onGround, hitCeil}
  move(e, dt) {
    const TS = this.TS;
    let hitCeil = false;
    // 水平
    e.x += e.vx * dt;
    if (e.vx > 0) {
      const rx = Math.floor((e.x + e.w) / TS);
      for (let py = e.y + 1; py < e.y + e.h; py += TS - 1) {
        if (this.tileAt(rx * TS + 1, py)) { e.x = rx * TS - e.w - 0.01; e.vx = 0; break; }
      }
      if (this.tileAt(rx * TS + 1, e.y + e.h - 1)) { e.x = rx * TS - e.w - 0.01; e.vx = 0; }
    } else if (e.vx < 0) {
      const lx = Math.floor(e.x / TS);
      for (let py = e.y + 1; py < e.y + e.h; py += TS - 1) {
        if (this.tileAt(lx * TS + TS - 1, py)) { e.x = (lx + 1) * TS + 0.01; e.vx = 0; break; }
      }
      if (this.tileAt(lx * TS + TS - 1, e.y + e.h - 1)) { e.x = (lx + 1) * TS + 0.01; e.vx = 0; }
    }
    // 垂直
    e.y += e.vy * dt;
    e.onGround = false;
    if (e.vy > 0) {
      const by = Math.floor((e.y + e.h) / TS);
      for (let px = e.x + 1; px < e.x + e.w; px += TS - 1) {
        if (this.tileAt(px, by * TS + 1)) { e.y = by * TS - e.h; e.vy = 0; e.onGround = true; break; }
      }
      if (this.tileAt(e.x + e.w - 1, by * TS + 1)) { e.y = by * TS - e.h; e.vy = 0; e.onGround = true; }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / TS);
      for (let px = e.x + 1; px < e.x + e.w; px += TS - 1) {
        if (this.tileAt(px, ty * TS + TS - 1)) { e.y = (ty + 1) * TS; e.vy = 0; hitCeil = true; break; }
      }
      if (this.tileAt(e.x + 1, ty * TS + TS - 1)) { e.y = (ty + 1) * TS; e.vy = 0; hitCeil = true; }
    }
    return { onGround: e.onGround, hitCeil };
  }
}

/* ---------- HUD ---------- */
class HUD {
  static text(ctx, txt, x, y, color = "#fff", size = 14, align = "left") {
    ctx.fillStyle = color;
    ctx.font = size + "px Consolas, monospace";
    ctx.textAlign = align;
    ctx.fillText(txt, x, y);
    ctx.textAlign = "left";
  }
  static bar(ctx, x, y, w, h, ratio, fg = "#4c6", bg = "#333") {
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fg; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
    ctx.strokeStyle = "#0008"; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

/* ---------- 简易状态机（loading/playing/over/win 复用） ---------- */
class GameState {
  constructor() { this.cur = "loading"; this.timer = 0; }
  set(s) { this.cur = s; this.timer = 0; }
  is(s) { return this.cur === s; }
  update(dt) { this.timer += dt; }
}

if (typeof module !== "undefined") module.exports = { aabb, R, Sprite, PlatformPhysics, HUD, GameState };
