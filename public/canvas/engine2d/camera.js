// camera.js — 摄像机 v1.0：平移/缩放/跟随/屏幕<->世界坐标转换/屏幕震动
"use strict";
class Camera {
  constructor(x = 0, y = 0, zoom = 1) {
    this.x = x; this.y = y; this.zoom = zoom;
    this.viewW = 0; this.viewH = 0;   // 视口世界尺寸（render 时更新）
    this.shake = 0;                   // 震动强度（像素）
    this.shakeX = 0; this.shakeY = 0;
    this._decay = 8;                  // 震动衰减速度
    this.target = null;               // 跟随对象 {x,y}
    this.followLerp = 0.15;           // 跟随平滑系数
  }

  follow(target, lerp = 0.15) { this.target = target; this.followLerp = lerp; }

  shakeFor(px) { this.shake = Math.max(this.shake, px); }

  update(dt, viewW, viewH) {
    this.viewW = viewW; this.viewH = viewH;
    if (this.target) {
      this.x += (this.target.x - this.x) * this.followLerp;
      this.y += (this.target.y - this.y) * this.followLerp;
    }
    if (this.shake > 0.01) {
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake;
      this.shake *= Math.exp(-this._decay * dt);
    } else { this.shakeX = this.shakeY = 0; this.shake = 0; }
  }

  // 世界 -> 屏幕（像素）
  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom + this.viewW / 2 + this.shakeX,
            (wy - this.y) * this.zoom + this.viewH / 2 + this.shakeY];
  }
  // 屏幕（像素）-> 世界
  screenToWorld(sx, sy) {
    return [(sx - this.viewW / 2 - this.shakeX) / this.zoom + this.x,
            (sy - this.viewH / 2 - this.shakeY) / this.zoom + this.y];
  }
  // 可视世界范围（用于裁剪/生成单位）
  bounds() {
    const hw = this.viewW / 2 / this.zoom, hh = this.viewH / 2 / this.zoom;
    return { left: this.x - hw, top: this.y - hh, right: this.x + hw, bottom: this.y + hh };
  }
}
if (typeof module !== "undefined") module.exports = { Camera };
