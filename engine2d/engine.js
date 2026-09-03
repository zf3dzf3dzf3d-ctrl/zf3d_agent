// py-browser-2d 引擎核心 v0.1：WebGL2 instancing 批量精灵渲染
// 一个 draw call 画所有精灵。实例属性：pos.xy, size, color.rgb
"use strict";

const VERT = `#version 300 es
layout(location=0) in vec2 aCorner;      // 单位四边形 [-0.5,0.5]
layout(location=1) in vec2 iPos;
layout(location=2) in vec2 iSize;
layout(location=3) in vec3 iColor;
uniform vec2 uRes;
uniform vec2 uOffset;   // 屏幕震动偏移
out vec3 vColor;
void main(){
  vec2 px = iPos + aCorner * iSize + uOffset;
  vec2 clip = (px / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vColor = iColor;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 o;
void main(){ o = vec4(vColor, 1.0); }`;

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
    this.uRes = gl.getUniformLocation(prog, "uRes");
    this.uOffset = gl.getUniformLocation(prog, "uOffset");

    // 单位四边形
    const quad = new Float32Array([-0.5,-0.5, 0.5,-0.5, -0.5,0.5, 0.5,0.5]);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    // 实例缓冲：每实例 7 floats (pos2 size1... size2 color3)
    this.INSTANCE_FLOATS = 7;
    this.maxInstances = 20000;
    this.instanceData = new Float32Array(this.maxInstances * this.INSTANCE_FLOATS);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    const stride = this.INSTANCE_FLOATS * 4;
    // iPos(2) iSize(2) iColor(3)
    [[1,2,0],[2,2,8],[3,3,16]].forEach(([loc,size,off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    });
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  render(count) {
    const gl = this.gl;
    this.resize();
    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uOffset, this.offsetX || 0, this.offsetY || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, count * this.INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }
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
