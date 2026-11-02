// py-browser-2d 引擎核心 v0.3：WebGL2 instancing 批量精灵渲染
// 一个 draw call 画所有精灵。实例属性：pos.xy, size, color.rgb
// v0.3 新增：摄像机（uniform 相机变换）、字形图集纹理文本渲染、灯光叠加接口
"use strict";

const VERT = `#version 300 es
layout(location=0) in vec2 aCorner;      // 单位四边形 [-0.5,0.5]
layout(location=1) in vec2 iPos;
layout(location=2) in vec2 iSize;
layout(location=3) in vec3 iColor;
layout(location=4) in vec2 iUV;          // 文本字形 uv（纯色精灵传 0）
uniform vec2 uRes;
uniform vec3 uCam;      // camera x,y,zoom
uniform vec2 uShake;    // 屏幕震动偏移
uniform bool uTextured; // 是否启用字形图集
uniform sampler2D uAtlas;
out vec3 vColor;
out vec2 vUV;
flat out float vTextured;
void main(){
  // 世界 -> 相机 -> 屏幕像素
  vec2 px = (iPos - uCam.xy) * uCam.z + uRes * 0.5 + aCorner * iSize * uCam.z + uShake;
  vec2 clip = (px / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vColor = iColor;
  vUV = iUV;
  vTextured = uTextured ? 1.0 : 0.0;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
in vec2 vUV;
flat in float vTextured;
uniform sampler2D uAtlas;
out vec4 o;
void main(){
  vec4 c = vec4(vColor, 1.0);
  if (vTextured > 0.5) {
    float a = texture(uAtlas, vUV).a;   // 字形 alpha
    c.a = a;
  }
  o = c;
}`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("需要 WebGL2");
    this.gl = gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    this.prog = prog;
    ["uRes","uCam","uShake","uTextured","uAtlas"].forEach(n => this[n] = gl.getUniformLocation(prog, n));

    // 单位四边形
    const quad = new Float32Array([-0.5,-0.5, 0.5,-0.5, -0.5,0.5, 0.5,0.5]);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    // 实例缓冲：每实例 9 floats (pos2 size2 color3 uv2)
    this.INSTANCE_FLOATS = 9;
    this.maxInstances = 20000;
    this.instanceData = new Float32Array(this.maxInstances * this.INSTANCE_FLOATS);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    const stride = this.INSTANCE_FLOATS * 4;
    // iPos(2) iSize(2) iColor(3) iUV(2)
    [[1,2,0],[2,2,8],[3,3,16],[4,2,28]].forEach(([loc,size,off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    });
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.camera = null;   // 可挂 Camera 实例
    this.text = null;     // 可挂 TextRenderer
  }

  resize() {
    // 固定 16:9 宽高比：在视口内取最大可容纳区域，letterbox 居中
    const vw = innerWidth, vh = innerHeight;
    const AR = 16 / 9;
    let cw = vw, chh = Math.floor(vw / AR);
    if (chh > vh) { chh = vh; cw = Math.floor(vh * AR); }
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.floor(cw * dpr), h = Math.floor(chh * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = chh + 'px';
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = Math.floor((vw - cw) / 2) + 'px';
    this.canvas.style.top = Math.floor((vh - chh) / 2) + 'px';
    this.canvas.style.background = '#05070d';
  }

  // 批量提交实例：data 是 [x,y,w,h,r,g,b, u0,v0(可选)...] 平铺数组（支持普通数组或 TypedArray）
  submit(data, count) {
    const n = count * this.INSTANCE_FLOATS;
    if (data && typeof data.subarray === 'function') {
      this.instanceData.set(data.subarray(0, n));
    } else {
      for (let i = 0; i < n; i++) this.instanceData[i] = data[i];
    }
    return count;
  }

  render(count) {
    const gl = this.gl;
    this.resize();
    // 每帧清屏（深空底色），避免残影/黑屏
    if (this._clearC === undefined) this._clearC = [0.02, 0.027, 0.05, 1];
    gl.clearColor(this._clearC[0], this._clearC[1], this._clearC[2], this._clearC[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    const w = this.canvas.width, h = this.canvas.height;
    gl.uniform2f(this.uRes, w, h);
    const cam = this.camera;
    if (cam && this._autoCam !== false) { cam.update(this._dt || 1/60, w / (cam.zoom || 1), h / (cam.zoom || 1)); }
    const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, z = cam ? cam.zoom : 1;
    gl.uniform3f(this.uCam, cx, cy, z);
    gl.uniform2f(this.uShake, cam ? cam.shakeX : (this.offsetX || 0), cam ? cam.shakeY : (this.offsetY || 0));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, count * this.INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  /** 文本渲染：str 支持多行/富文本 [[text,color],...]，见 TextRenderer.emit */
  drawText(str, x, y, opts = {}) {
    if (!this.text) throw new Error("未挂载 TextRenderer");
    const gl = this.gl;
    const tmp = [];
    this.text.emit(tmp, str, x, y, opts);
    // 更新字形图集纹理（若有新字形）
    const t = this.text;
    if (t.atlasVersion !== this._atlasSeen) {
      this._atlasSeen = t.atlasVersion;
      for (const a of t.atlases) {
        gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, a.canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }
    gl.useProgram(this.prog);
    gl.uniform1i(this.uTextured, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.atlases[t.atlases.length - 1].tex);
    gl.uniform1i(this.uAtlas, 0);
    this.submit(tmp, tmp.length / this.INSTANCE_FLOATS);
    const n = tmp.length / this.INSTANCE_FLOATS;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, n * this.INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.uniform1i(this.uTextured, 0);
  }

  /* ---- 即时绘制兼容层（core-demo.html 等页面使用 begin/rect/end API）---- */
  begin() { this._q = []; }
  rect(x, y, w, h, c) {
    const q = this._q || (this._q = []);
    if (q.length + this.INSTANCE_FLOATS > this.instanceData.length) return; // 超上限丢弃，防溢出
    q.push(x, y, w, h, c[0], c[1], c[2], 0, 0);
  }
  end() {
    if (this._q && this._q.length) {
      const n = this._q.length / this.INSTANCE_FLOATS;
      this.submit(this._q, n);
      this.render(n);
    }
    this._q = null;
  }

  /** 灯光叠加：传入 Lighting 实例，在场景绘制后调用 */
  drawLights(lighting) { lighting.render(); }
}

// FPS 统计
class Fps {
  constructor(el) { this.el = el; this.frames = 0; this.t0 = performance.now(); }
  tick() {
    this.frames++;
    const now = performance.now();
    if (now - this.t0 >= 500) {
      this.el.textContent = `FPS: ${(this.frames * 1000 / (now - this.t0)).toFixed(1)}`;
      this.frames = 0; this.t0 = now;
    }
  }
}
if (typeof module !== "undefined") { module.exports = { Renderer, Fps }; }
