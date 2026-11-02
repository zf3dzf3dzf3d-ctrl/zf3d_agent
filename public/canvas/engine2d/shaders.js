// shaders.js — WebGL 片元 Shader 通道（可挂精灵/全屏）：溶解 / 波纹 / 颜色替换 / 自定义
// 用法：const fx = new ShaderFX(canvas); fx.apply(targetCtx, sourceCanvas, {type:'ripple', time:t})
"use strict";
const ShaderFX = (() => {
  const VERT = "attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}";
  const FRAG_HEAD = `precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform float time;uniform vec4 params;uniform vec3 color;`;
  const FRAGS = {
    dissolve: FRAG_HEAD + `
      float n=fract(sin(dot(uv*params.x,vec2(12.9898,78.233)))*43758.5453);
      float edge=abs(n-params.y);
      if(n<params.y){discard;}
      vec4 c=texture2D(tex,uv);
      if(edge<0.08){c.rgb=mix(color,c.rgb,edge/0.08);}
      gl_FragColor=c;`,
    ripple: FRAG_HEAD + `
      vec2 o=uv+vec2(sin(uv.y*40.+time*4.)*params.x/640.,0.);
      gl_FragColor=texture2D(tex,o);`,
    recolor: FRAG_HEAD + `
      vec4 c=texture2D(tex,uv);
      float d=distance(c.rgb,color);
      if(d<params.x){c.rgb=mix(vec3(params.y,params.z,1.),c.rgb,smoothstep(params.x*.6,params.x,d));}
      gl_FragColor=c;`,
    flash: FRAG_HEAD + `
      vec4 c=texture2D(tex,uv);
      c.rgb=mix(c.rgb,vec3(1.),params.y*params.y);
      gl_FragColor=c;`
  };
  let glCache = null;
  // 内部离屏 WebGL canvas：同一 canvas 不能同时持有 2d 和 webgl context，
  // 因此 shader 处理统一在离屏 canvas 上做，结果再拷回目标 2d canvas
  function getGL() {
    if (glCache && glCache.gl) return glCache.gl;
    const c = document.createElement("canvas");
    c.width = 4; c.height = 4;
    const gl = c.getContext("webgl", { preserveDrawingBuffer: true })
            || c.getContext("experimental-webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("当前环境不支持 WebGL，无法使用 ShaderFX");
    glCache = { canvas: c, gl };
    return gl;
  }
  function compile(gl, src, type) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader 编译失败: " + gl.getShaderInfoLog(s));
    return s;
  }
  function buildProgram(gl, name) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, VERT, gl.VERTEX_SHADER));
    gl.attachShader(prog, compile(gl, FRAGS[name] || FRAGS.flash, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link 失败: " + gl.getProgramInfoLog(prog));
    return prog;
  }
  // 把 sourceCanvas 经 shader 处理后画到 targetCtx
  function apply(targetCtx, source, opts = {}) {
    const name = opts.type || "flash";
    if (!FRAGS[name]) throw new Error("未知 shader: " + name + "，可选: " + Object.keys(FRAGS).join("/"));
    const gl = getGL();
    const glc = glCache.canvas;
    const W = source.width || canvas.width, H = source.height || canvas.height;
    if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H; }
    gl.viewport(0, 0, W, H);
    const prog = buildProgram(gl, name);
    gl.useProgram(prog);
    // 全屏两三角
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    // 纹理
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform1i(gl.getUniformLocation(prog, "tex"), 0);
    gl.uniform1f(gl.getUniformLocation(prog, "time"), opts.time || 0);
    const p4 = opts.params || [0.5, 0.5, 0.5, 1];
    gl.uniform4f(gl.getUniformLocation(prog, "params"), p4[0], p4[1], p4[2], p4[3]);
    const c3 = opts.color || [1, 0, 0];
    gl.uniform3f(gl.getUniformLocation(prog, "color"), c3[0], c3[1], c3[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 把 WebGL 结果拷回目标 2d canvas（按目标尺寸绘制）
    targetCtx.drawImage(glc, 0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
    // 清理
    gl.deleteBuffer(buf); gl.deleteTexture(tex); gl.deleteProgram(prog);
  }
  return { apply, list: () => Object.keys(FRAGS) };
})();
if (typeof module !== "undefined") module.exports = { ShaderFX };
