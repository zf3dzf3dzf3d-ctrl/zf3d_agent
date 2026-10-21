// text.js — 文本渲染加强 v1.0：WebGL 批量文本（字形图集缓存 + 富文本颜色 + 对齐）
// 渲染到与精灵同一 pipeline：生成每字符的实例数据，由 Renderer.draw 一次画完
"use strict";
class TextRenderer {
  constructor(renderer, { font = "16px monospace", fill = [1,1,1] } = {}) {
    this.r = renderer;
    this.canvas = document.createElement("canvas");   // 字形图集画布
    this.ctx = this.canvas.getContext("2d");
    this.font = font;
    this.glyphs = new Map();     // char -> {u0,v0,u1,v1,w,h,ox,oy,atlas}
    this.atlases = [];           // 图集纹理列表（满了开新图集）
    this.ATLAS = 512;
    this.atlasVersion = 0;
    this.textureVersion = -1;    // renderer 检测变化后重建纹理
  }

  _newAtlas() {
    const c = document.createElement("canvas");
    c.width = c.height = this.ATLAS;
    const tex = this.r.gl.createTexture();
    this.r.gl.bindTexture(this.r.gl.TEXTURE_2D, tex);
    this.r.gl.texImage2D(this.r.gl.TEXTURE_2D, 0, this.r.gl.RGBA, this.ATLAS, this.ATLAS, 0, this.r.gl.RGBA, this.r.gl.UNSIGNED_BYTE, null);
    this.atlases.push({ canvas: c, ctx: c.getContext("2d"), tex, x: 1, y: 1, rowH: 0 });
    return this.atlases[this.atlases.length - 1];
  }

  // 量取/缓存一个字形
  _glyph(ch) {
    let g = this.glyphs.get(ch);
    if (g) return g;
    let atlas = this.atlases[this.atlases.length - 1];
    if (!atlas) atlas = this._newAtlas();
    this.ctx.font = this.font;
    const m = this.ctx.measureText(ch);
    const w = Math.ceil(m.width) + 2, h = Math.ceil((m.actualBoundingBoxAscent || 14) + (m.actualBoundingBoxDescent || 4)) + 2;
    if (atlas.x + w > this.ATLAS) { atlas.x = 1; atlas.y += atlas.rowH + 1; atlas.rowH = 0; }
    if (atlas.y + h > this.ATLAS) { atlas = this._newAtlas(); }
    const ascent = m.actualBoundingBoxAscent || 14;
    atlas.ctx.font = this.font;
    atlas.ctx.fillStyle = "#fff";
    atlas.ctx.textBaseline = "alphabetic";
    atlas.ctx.fillText(ch, atlas.x + 1, atlas.y + 1 + ascent);
    g = {
      atlas, w, h,
      ox: 0, oy: ascent,
      u0: atlas.x / this.ATLAS, v0: atlas.y / this.ATLAS,
      u1: (atlas.x + w) / this.ATLAS, v1: (atlas.y + h) / this.ATLAS,
    };
    atlas.x += w; atlas.rowH = Math.max(atlas.rowH, h);
    this.glyphs.set(ch, g);
    this.atlasVersion++;
    return g;
  }

  // 量取整串宽度（像素，zoom=1）
  measure(str) {
    this.ctx.font = this.font;
    let w = 0;
    for (const ch of str) w += this.glyphs.has(ch) ? this.glyphs.get(ch).w - 2 : this.ctx.measureText(ch).width;
    return w;
  }

  /**
   * 把文本转成精灵实例数据（写入 out 数组，格式与 Renderer 一致: x,y,w,h,r,g,b）
   * 支持：多行 \n、对齐 align: left|center|right、逐 token 富文本颜色 [[text, [r,g,b]], ...]
   */
  emit(out, str, x, y, { align = "left", color = [1, 1, 1], scale = 1 } = {}) {
    const cam = this.r.camera;
    const toScreen = (wx, wy) => cam ? cam.worldToScreen(wx, wy) : [wx, wy];
    const lines = Array.isArray(str) ? [str] : str.split("\n");
    let sy = y;
    for (const line of lines) {
      const tokens = Array.isArray(line) ? line : [[line, color]];
      // 先算整行宽度
      let lineW = 0;
      const prepared = tokens.map(([t, c]) => {
        const chars = [...t].map(ch => ({ g: this._glyph(ch), ch }));
        const tw = chars.reduce((s, o) => s + o.g.w - 2, 0) * scale;
        lineW += tw;
        return { chars, c, tw };
      });
      let sx = align === "center" ? x - lineW / 2 : align === "right" ? x - lineW : x;
      for (const { chars, c, tw } of prepared) {
        for (const { g } of chars) {
          const [px, py] = toScreen(sx, sy);
          out.push(px + g.ox * scale, py + g.oy * scale, g.w * scale, g.h * scale, c[0], c[1], c[2]);
          sx += (g.w - 2) * scale;
        }
      }
      sy += 20 * scale;   // 行高
    }
  }
}
if (typeof module !== "undefined") module.exports = { TextRenderer };
