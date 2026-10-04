// lighting.js — 2D 灯光系统 v1.0：环境光 + N 个点光源（叠加层混合渲染）
// 用法：lights.add({x, y, radius, color:[r,g,b], intensity}); 每帧 lights.render(renderer)
"use strict";
const LIGHT_VERT = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform vec2 uRes; uniform vec2 uPos; uniform vec2 uSize;
void main(){
  vec2 px = uPos + aCorner * uSize;
  vec2 clip = (px / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const LIGHT_FRAG = `#version 300 es
precision mediump float;
uniform vec2 uRes; uniform vec2 uPos; uniform float uRadius;
uniform vec3 uColor; uniform float uIntensity;
out vec4 o;
void main(){
  float d = distance(gl_FragCoord.xy * vec2(1.0, -1.0) + vec2(0.0, uRes.y), uPos);
  float a = 1.0 - smoothstep(0.0, uRadius, d);
  a *= a;                       // 二次衰减更自然
  o = vec4(uColor * uIntensity * a, a * uIntensity);
}`;

class Lighting {
  constructor(renderer) {
    this.renderer = renderer;
    this.gl = renderer.gl;
    this.ambient = 0.25;          // 环境光强度 0~1
    this.lights = [];             // {x,y,radius,color:[r,g,b],intensity}
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, LIGHT_VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, LIGHT_FRAG));
    gl.linkProgram(prog);
    this.prog = prog;
    this.u = {};
    ["uRes","uPos","uSize","uRadius","uColor","uIntensity"].forEach(n => this.u[n] = gl.getUniformLocation(prog, n));
    // 单位四边形
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5,-0.5, 0.5,-0.5, -0.5,0.5, 0.5,0.5]), gl.STATIC_DRAW);
  }

  add(light) { this.lights.push(Object.assign({ radius: 200, color: [1, 0.95, 0.7], intensity: 1 }, light)); return this.lights[this.lights.length - 1]; }
  clear() { this.lights.length = 0; }

  // 在场景精灵绘制完后调用：additive 混合叠加光
  render() {
    const gl = this.gl, r = this.renderer;
    const w = r.canvas.width, h = r.canvas.height;
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes, w, h);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);   // additive
    for (const L of this.lights) {
      // 世界坐标 -> 屏幕（复用摄像机，render 前需已设置 cam）
      const cam = r.camera;
      let sx, sy, rad = L.radius;
      if (cam) {
        [sx, sy] = cam.worldToScreen(L.x, L.y);
        rad *= cam.zoom;
      } else { sx = L.x; sy = L.y; }
      gl.uniform2f(this.u.uPos, sx, h - sy);       // shader 内翻转 y
      gl.uniform2f(this.u.uSize, rad * 2, rad * 2);
      gl.uniform1f(this.u.uRadius, rad);
      gl.uniform3f(this.u.uColor, L.color[0], L.color[1], L.color[2]);
      gl.uniform1f(this.u.uIntensity, L.intensity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // 恢复
  }
}
if (typeof module !== "undefined") module.exports = { Lighting };
