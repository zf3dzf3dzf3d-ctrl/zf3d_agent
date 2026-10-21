// tilemap.js — 瓦片地图：Tiled JSON 兼容 + 程序化图集渲染 + 碰撞层
"use strict";
class TileMap {
  // data: Tiled JSON（layers type=tilelayer）或精简格式 {w,h,tileSize,layers:[{name,data:[...] ,solid}]}
  constructor(data) {
    if (data.width && data.tilewidth) data = TileMap.fromTiled(data);
    this.w = data.w; this.h = data.h; this.ts = data.tileSize || 32;
    this.layers = data.layers.map(l => ({ name: l.name, solid: !!l.solid, data: l.data }));
    this.atlas = data.atlas || null;      // {img, cols} 或 null（用色块）
    this.palette = data.palette || ["#3a5", "#567", "#a86", "#987", "#cba", "#456", "#789", "#234"];
  }
  static fromTiled(t) {
    const ts = t.tilewidth;
    return {
      w: t.width, h: t.height, tileSize: ts,
      layers: t.layers.filter(l => l.type === "tilelayer").map(l => ({
        name: l.name, solid: /coll/i.test(l.name || ""),
        data: l.data.map(gid => gid > 0 ? gid - (t.tilesets[0] ? t.tilesets[0].firstgid : 1) : 0)
      })),
      atlas: t.tilesets[0] && t.tilesets[0].image ? { img: null, src: t.tilesets[0].image, cols: t.tilesets[0].columns || Math.floor(t.tilesets[0].imagewidth / ts) } : null
    };
  }
  get(x, y, layer = 0) { return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? 0 : this.layers[layer].data[y * this.w + x]; }
  set(x, y, v, layer = 0) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.layers[layer].data[y * this.w + x] = v; }
  solidAt(px, py) {  // 像素坐标 → 是否实心
    const x = Math.floor(px / this.ts), y = Math.floor(py / this.ts);
    for (const l of this.layers) if (l.solid && this.get(x, y, this.layers.indexOf(l))) return true;
    return false;
  }
  // AABB 碰撞查询（返回是否与实心瓦片重叠）
  hitRect(x, y, w, h) {
    const x0 = Math.floor(x / this.ts), x1 = Math.floor((x + w - 0.01) / this.ts);
    const y0 = Math.floor(y / this.ts), y1 = Math.floor((y + h - 0.01) / this.ts);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++)
      for (const l of this.layers) if (l.solid && this.get(tx, ty, this.layers.indexOf(l))) return true;
    return false;
  }
  draw(ctx, camX = 0, camY = 0, vw = 800, vh = 600) {
    const x0 = Math.max(0, Math.floor(camX / this.ts)), x1 = Math.min(this.w - 1, Math.floor((camX + vw) / this.ts));
    const y0 = Math.max(0, Math.floor(camY / this.ts)), y1 = Math.min(this.h - 1, Math.floor((camY + vh) / this.ts));
    for (let li = 0; li < this.layers.length; li++) {
      const l = this.layers[li];
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const v = l.data[ty * this.w + tx]; if (!v) continue;
        const px = tx * this.ts - camX, py = ty * this.ts - camY;
        if (this.atlas && this.atlas.img) {
          const sx = ((v - 1) % this.atlas.cols) * this.ts, sy = Math.floor((v - 1) / this.atlas.cols) * this.ts;
          ctx.drawImage(this.atlas.img, sx, sy, this.ts, this.ts, px, py, this.ts, this.ts);
        } else {
          ctx.fillStyle = this.palette[(v - 1) % this.palette.length];
          ctx.fillRect(px, py, this.ts, this.ts);
          ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.strokeRect(px + .5, py + .5, this.ts - 1, this.ts - 1);
        }
      }
    }
  }
}
if (typeof module !== "undefined") module.exports = { TileMap };
