// py-browser-2d 骨骼播放器 v0.1：JSON 硬骨骼 + 关键帧插值 + Canvas 绘制
// 设计对齐原 fight 项目「新系统_v2」的硬骨骼思路：骨骼为父子链，
// 每根骨骼存 {parent, x, y, len, angle}，世界变换 = 父矩阵 * 自身平移/旋转。
"use strict";

class SkeletonPlayer {
  constructor(data) {
    this.data = data;
    this.bones = data.bones;
    this.byName = {};
    this.bones.forEach(b => this.byName[b.name] = b);
    // 预计算父索引数组，避免每帧查表
    this.parentIdx = this.bones.map(b => b.parent);
    this.world = this.bones.map(() => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }));
    this.pose = {};          // 当前帧各骨骼 {name -> {angle}}
    this.time = 0;
    this.setAnim(data.loop === false ? Object.keys(data.animations)[0] : "walk");
  }

  setAnim(name) {
    this.animName = name;
    this.anim = this.data.animations[name];
    this.time = 0;
  }

  // 采样动画：关键帧数组均匀分布，线性插值
  _sample(track, t) {
    const n = track.length;
    if (n === 1) return track[0];
    const seg = t * (n - 1);
    const i = Math.min(Math.floor(seg), n - 2);
    const f = seg - i;
    return track[i] + (track[i + 1] - track[i]) * f;
  }

  update(dt) {
    if (!this.anim) return;
    this.time = (this.time + dt) % this.anim.duration;
    const t = this.time / this.anim.duration;
    // 1. 计算本帧 pose（track 值 + 骨骼默认值）
    for (const b of this.bones) {
      let angle = b.angle || 0;
      const tr = this.anim.tracks[b.name];
      if (tr && tr.angle) angle = this._sample(tr.angle, t);
      this.pose[b.name] = { angle };
    }
    // 2. 前向运动学：按 parent 顺序（约定 parent id < 自身 id）
    const w = this.world;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      const p = this.pose[b.name];
      const ang = (p.angle) * Math.PI / 180;
      if (b.parent < 0) {
        w[i].a = Math.cos(ang); w[i].b = Math.sin(ang);
        w[i].c = -Math.sin(ang); w[i].d = Math.cos(ang);
        w[i].tx = b.x; w[i].ty = b.y;
      } else {
        const pw = w[b.parent];
        // 局部：先平移 (b.x,b.y) 再旋转 ang
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const la = cos, lb = sin, lc = -sin, ld = cos;
        w[i].a = pw.a * la + pw.c * lb;
        w[i].b = pw.b * la + pw.d * lb;
        w[i].c = pw.a * lc + pw.c * ld;
        w[i].d = pw.b * lc + pw.d * ld;
        w[i].tx = pw.a * b.x + pw.c * b.y + pw.tx;
        w[i].ty = pw.b * b.x + pw.d * b.y + pw.ty;
      }
    }
  }

  // 画骨骼：每根骨骼画一条从骨骼起点到终点的线段 + 关节点
  draw(ctx, ox, oy, scale) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.lineWidth = 2 / scale;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      const w = this.world[i];
      const ex = b.x + w.a * b.len, ey = b.y + w.b * b.len;
      ctx.strokeStyle = b.parent < 0 ? "#f80" : "#4cf";
      ctx.beginPath();
      ctx.moveTo(w.tx, w.ty);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillRect(w.tx - 2, w.ty - 2, 4, 4);
    }
    ctx.restore();
  }
}

// 暴露给页面
window.SkeletonPlayer = SkeletonPlayer;
