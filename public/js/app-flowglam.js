/* ============================================================
 * app-flowglam.js - 炫酷流程图渲染引擎 FlowGlam v1（表面功夫版）
 * 把 Mermaid flowchart 渲染成画布上的霓虹工程图（纯视觉层）：
 *   - 玻璃拟态霓虹发光节点（渐变描边 + 呼吸光晕 + 悬停辉光）
 *   - 贝塞尔发光连线（流动虚线 + 沿线奔跑的粒子光点）
 *   - 错落入场动画（节点逐个弹出 + 连线描画生长）
 *   - 支持画布平移跟随（挂在 canvasContent 内）
 * 暴露 window.FlowGlam：
 *   - FlowGlam.deploy(text, opts)  部署炫酷流程图
 *   - FlowGlam.clear()             清除所有 FlowGlam 图层
 * ============================================================ */
(function () {
  'use strict';

  var FG = (window.FlowGlam = window.FlowGlam || {});
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var _layers = [];      // 已部署的图层容器（便于整体清除/平移跟随）
  FG._layers = _layers;  // 暴露给 FGS/CA/CAOps 等模块读取（同一数组引用）
  var _seq = 0;

  // 配色主题：按节点层级取色（青 → 蓝 → 紫 → 粉 → 橙 循环）
  var THEME = [
    { c1: '#00e5ff', c2: '#00b0ff', glow: 'rgba(0,229,255,.55)' },
    { c1: '#7c4dff', c2: '#536dfe', glow: 'rgba(124,77,255,.55)' },
    { c1: '#ff4081', c2: '#f50057', glow: 'rgba(255,64,129,.5)' },
    { c1: '#00e676', c2: '#00c853', glow: 'rgba(0,230,118,.5)' },
    { c1: '#ffb300', c2: '#ff6d00', glow: 'rgba(255,179,0,.5)' }
  ];

  // 展示风格注册表（顺序即 UI 顺序）
  var STYLES = [
    { key: 'neon',      name: '霓虹赛博', layerClass: '' },
    { key: 'blueprint', name: '全息蓝图', layerClass: 'fg-style-blueprint' },
    { key: 'matrix',    name: '终端矩阵', layerClass: 'fg-style-matrix' },
    { key: 'glass',     name: '浅色玻璃', layerClass: 'fg-style-glass' },
    { key: 'ink',       name: '墨韵宣纸', layerClass: 'fg-style-ink' },
    { key: 'pixel',     name: '像素游戏', layerClass: 'fg-style-pixel' },
    { key: 'gold',      name: '暗夜鎏金', layerClass: 'fg-style-gold' },
    { key: 'candy',     name: '粉彩泡泡', layerClass: 'fg-style-candy' }
  ];
  var _styleKey = 'neon'; // 全局当前风格（持久化在 kv_store）
  var _scale = 0.5;       // 全局整体缩放（0.25 ~ 2，持久化在 kv_store），默认缩小一半

  FG.setStyle = function (key) {
    var found = STYLES.some(function (s) { return s.key === key; });
    if (!found) return { success: false, message: '未知风格: ' + key };
    _styleKey = key;
    _layers.forEach(function (layer) {
      STYLES.forEach(function (s) { if (s.layerClass) layer.classList.remove(s.layerClass); });
      var st = STYLES.filter(function (s) { return s.key === key; })[0];
      if (st.layerClass) layer.classList.add(st.layerClass);
    });
    _updateStyleBar();
    try { FG._persist(); } catch (e) {}
    var name = STYLES.filter(function (s) { return s.key === key; })[0].name;
    return { success: true, message: '✨ 流程图风格已切换为「' + name + '」' };
  };
  FG.getStyles = function () { return STYLES.map(function (s) { return { key: s.key, name: s.name }; }); };

  // ---------- 昼夜模式（dark=黑夜霓虹 / light=白天明亮），独立于展示风格 ----------
  var _modeKey = 'dark';
  FG.setMode = function (mode) {
    if (mode !== 'dark' && mode !== 'light') return { success: false, message: '未知模式: ' + mode };
    _modeKey = mode;
    _layers.forEach(function (layer) { layer.classList.toggle('fg-light', mode === 'light'); });
    _updateModeBtn();
    try { if (window.DB && DB.kvSet) DB.kvSet('flowglam_mode', mode); } catch (e) {}
    return { success: true, message: mode === 'light' ? '☀️ 已切换到白天模式' : '🌙 已切换到黑夜模式' };
  };
  FG.toggleMode = function () { return FG.setMode(_modeKey === 'dark' ? 'light' : 'dark'); };
  FG.getMode = function () { return _modeKey; };

  // ---------- 全局整体缩放（0.25 ~ 2，作用于所有流程图图层） ----------
  function _applyScale() {
    _layers.forEach(function (layer) {
      layer.style.transformOrigin = '0 0';
      layer.style.transform = 'scale(' + _scale + ')';
    });
  }
  FG.setScale = function (v) {
    var n = parseFloat(v);
    if (!isFinite(n)) return { success: false, message: '缩放值无效' };
    n = Math.max(0.25, Math.min(2, n));
    _scale = n;
    _applyScale();
    _updateScaleUI();
    try { if (window.DB && DB.kvSet) DB.kvSet('flowglam_scale', String(n)); } catch (e) {}
    return { success: true, message: '🔍 流程图整体缩放已调整为 ' + Math.round(n * 100) + '%' };
  };
  FG.getScale = function () { return _scale; };
  function _updateScaleUI() {
    var slider = document.getElementById('fgScaleRange');
    var label = document.getElementById('fgScaleValue');
    if (slider) slider.value = String(Math.round(_scale * 100));
    if (label) label.textContent = Math.round(_scale * 100) + '%';
  }
  function _updateModeBtn() {
    // 昼夜按钮已集成到主题面板（此函数保留以兼容调用）
  }

  function _currentStyle() {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].key === _styleKey) return STYLES[i];
    return STYLES[0];
  }

  // 昼夜跟随全局主题（主题面板切换白天/黑夜时自动联动流程图昼夜模式）
  document.addEventListener('themechange', function (ev) {
    var mode = ev && ev.detail && ev.detail.mode;
    if ((mode === 'dark' || mode === 'light') && mode !== _modeKey) FG.setMode(mode);
  });

  // 流程图风格：不再使用画布左上角悬浮条，集成到主题设置面板（#themePanel）
  function _buildStyleBar() {
    var host = document.getElementById('fgThemeStyles');
    if (!host) return; // 主题面板未加载则跳过（仍可用 FlowGlam.setStyle API 切换）
    if (!host.querySelector('button[data-fg-style]')) {
      host.innerHTML = STYLES.map(function (s) {
        return '<button class="bg-mode-btn" data-fg-style="' + s.key + '">' + s.name + '</button>';
      }).join('');
    }
    if (!host.dataset.fgBound) { // 防止重复部署时叠加 click 监听器
      host.dataset.fgBound = '1';
      host.addEventListener('click', function (ev) {
        var btn = ev.target.closest ? ev.target.closest('button[data-fg-style]') : null;
        if (btn) FG.setStyle(btn.getAttribute('data-fg-style'));
      });
      // 缩放滑条
      var slider = document.getElementById('fgScaleRange');
      if (slider && !slider.dataset.fgBound) {
        slider.dataset.fgBound = '1';
        slider.addEventListener('input', function () { FG.setScale(parseInt(slider.value, 10) / 100); });
      }
    }
    _updateStyleBar();
    _updateScaleUI();
  }
  function _updateStyleBar() {
    var host = document.getElementById('fgThemeStyles');
    if (!host) return;
    host.querySelectorAll('button[data-fg-style]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-fg-style') === _styleKey);
    });
  }

  // ---------- 样式注入 ----------
  function injectStyles() {
    if (document.getElementById('flowglam-styles')) return;
    var st = document.createElement('style');
    st.id = 'flowglam-styles';
    st.textContent = `
/* ===== FlowGlam 炫酷流程图 ===== */
.fg-node { touch-action: none; }
.fg-node.fg-dragging { z-index: 40; transform: scale(1.05); cursor: grabbing !important; }
@keyframes fg-pop {
  0%   { opacity:0; transform:translateY(26px) scale(.55); filter:blur(6px); }
  60%  { opacity:1; transform:translateY(-6px) scale(1.06); filter:blur(0); }
  100% { opacity:1; transform:translateY(0) scale(1); }
}
@keyframes fg-breathe {
  0%,100% { box-shadow: 0 0 18px var(--fg-glow), inset 0 0 22px rgba(255,255,255,.04); }
  50%     { box-shadow: 0 0 42px var(--fg-glow), inset 0 0 30px rgba(255,255,255,.08); }
}
@keyframes fg-border-spin {
  0%   { background-position: 0% 50%; }
  100% { background-position: 300% 50%; }
}
@keyframes fg-dash-flow {
  to { stroke-dashoffset: -240; }
}
@keyframes fg-fade-in {
  from { opacity:0; } to { opacity:1; }
}
.fg-node {
  position:absolute;
  min-width:150px; max-width:260px;
  padding:14px 22px;
  border-radius:14px;
  background: linear-gradient(145deg, rgba(20,26,44,.92), rgba(10,14,28,.88));
  backdrop-filter: blur(6px);
  color:#eaf2ff;
  font-size:14px; font-weight:600; letter-spacing:.5px;
  text-align:center;
  cursor:default;
  opacity:0;
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards, fg-breathe 3.2s ease-in-out .6s infinite;
  transition: transform .18s ease, filter .18s ease;
  z-index: 20;
  user-select:none;
}
.fg-node::before {
  content:'';
  position:absolute; inset:0;
  border-radius:14px;
  padding:1.5px;
  background: linear-gradient(90deg, var(--fg-c1), var(--fg-c2), var(--fg-c1), var(--fg-c2), var(--fg-c1));
  background-size: 300% 100%;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  animation: fg-border-spin 5s linear infinite;
  pointer-events:none;
}
.fg-node:hover {
  transform: translateY(-4px) scale(1.04);
  filter: brightness(1.25) drop-shadow(0 0 12px var(--fg-glow));
}
.fg-node .fg-icon {
  display:block; font-size:19px; margin-bottom:4px;
  filter: drop-shadow(0 0 6px var(--fg-glow));
}
.fg-node .fg-tag {
  position:absolute; top:-9px; right:-9px;
  min-width:20px; height:20px; line-height:20px;
  padding:0 5px; border-radius:10px;
  background: linear-gradient(135deg, var(--fg-c1), var(--fg-c2));
  color:#0a0e1c; font-size:11px; font-weight:800;
  box-shadow: 0 0 10px var(--fg-glow);
}
.fg-svg {
  position:absolute; left:0; top:0;
  width:100%; height:100%;
  pointer-events:none; overflow:visible; z-index: 15;
}
.fg-edge-base {
  fill:none; stroke-width:2.5; stroke-linecap:round;
  opacity:.9;
  stroke-dasharray: 200 400;
  animation: fg-dash-flow 2.6s linear infinite, fg-fade-in .8s ease forwards;
}
.fg-edge-glow {
  fill:none; stroke-width:7; stroke-linecap:round;
  opacity:.22; filter: blur(4px);
  animation: fg-fade-in 1.2s ease forwards;
}
.fg-edge-label {
  position:absolute;
  padding:2px 9px;
  border-radius:9px;
  background:rgba(8,12,26,.85);
  color:#9fc3ff; font-size:11px;
  border:1px solid rgba(120,160,255,.3);
  white-space:nowrap;
  transform:translate(-50%,-50%);
  z-index:18;
  opacity:0;
  animation: fg-pop .5s ease forwards;
}

/* 风格切换悬浮条已废弃（集成到主题面板） */

/* ===== 风格 2：全息蓝图 ===== */
.fg-layer.fg-style-blueprint .fg-node {
  background: rgba(10,30,60,.55);
  border-radius:2px;
  color:#bfe8ff;
  font-family:'Consolas','Courier New',monospace;
  font-weight:400; letter-spacing:1px;
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards;
  border:1px solid rgba(90,180,255,.55);
  box-shadow:0 0 0 1px rgba(90,180,255,.12), inset 0 0 30px rgba(60,140,255,.08);
}
.fg-layer.fg-style-blueprint .fg-node::before { display:none; }
.fg-layer.fg-style-blueprint .fg-node .fg-icon { display:none; }
.fg-layer.fg-style-blueprint .fg-node .fg-tag {
  background:rgba(10,30,60,.9); color:#7fd4ff;
  border:1px solid rgba(90,180,255,.5); border-radius:2px;
  box-shadow:none; font-family:monospace;
}
/* 四角瞄准标记 */
.fg-layer.fg-style-blueprint .fg-node::after {
  content:''; position:absolute; inset:-5px; pointer-events:none;
  background:
    linear-gradient(#5ab4ff,#5ab4ff) left top/10px 1px no-repeat,
    linear-gradient(#5ab4ff,#5ab4ff) left top/1px 10px no-repeat,
    linear-gradient(#5ab4ff,#5ab4ff) right top/10px 1px no-repeat,
    linear-gradient(#5ab4ff,#5ab4ff) right top/1px 10px no-repeat,
    linear-gradient(#5ab4ff,#5ab4ff) left bottom/10px 1px no-repeat,
    linear-gradient(#5ab4ff,#5ab4ff) left bottom/1px 10px no-repeat,
    linear-gradient(#5ab4ff,#5ab4ff) right bottom/10px 1px no-repeat,
    linear-gradient(#5ab4ff,#5ab4ff) right bottom/1px 10px no-repeat;
  opacity:.85;
}
.fg-layer.fg-style-blueprint .fg-edge-base {
  stroke:#5ab4ff !important; stroke-dasharray:6 5; stroke-width:1.5;
  animation: fg-dash-flow 1.4s linear infinite;
}
.fg-layer.fg-style-blueprint .fg-edge-glow { stroke:#3a8fd4 !important; opacity:.15; }
.fg-layer.fg-style-blueprint .fg-edge-label {
  background:rgba(8,24,48,.9); color:#8fd0ff;
  border:1px solid rgba(90,180,255,.4); border-radius:2px; font-family:monospace;
}

/* ===== 风格 3：终端矩阵 ===== */
.fg-layer.fg-style-matrix .fg-node {
  background:rgba(2,12,4,.9);
  border-radius:4px;
  border:1px solid #00ff88;
  color:#7dffb0;
  font-family:'Consolas','Courier New',monospace;
  font-weight:500; letter-spacing:.5px;
  text-shadow:0 0 8px rgba(0,255,136,.6);
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards;
  box-shadow:0 0 14px rgba(0,255,136,.22), inset 0 0 20px rgba(0,255,136,.05);
}
.fg-layer.fg-style-matrix .fg-node::before { display:none; }
.fg-layer.fg-style-matrix .fg-node:hover {
  filter:brightness(1.35) drop-shadow(0 0 10px rgba(0,255,136,.6));
}
.fg-layer.fg-style-matrix .fg-node .fg-tag {
  background:#00ff88; color:#03130a; border-radius:2px; box-shadow:0 0 8px rgba(0,255,136,.6);
  font-family:monospace;
}
.fg-layer.fg-style-matrix .fg-node .fg-icon { display:none; }
.fg-layer.fg-style-matrix .fg-edge-base {
  stroke:#00ff88 !important; stroke-dasharray:3 6; stroke-width:1.8;
  animation: fg-dash-flow 1.1s linear infinite;
}
.fg-layer.fg-style-matrix .fg-edge-glow { stroke:#00ff88 !important; opacity:.2; }
.fg-layer.fg-style-matrix .fg-edge-label {
  background:rgba(2,12,4,.92); color:#7dffb0;
  border:1px solid rgba(0,255,136,.4); border-radius:2px; font-family:monospace;
}

/* ===== 风格 4：浅色玻璃 ===== */
.fg-layer.fg-style-glass .fg-node {
  background:linear-gradient(145deg, rgba(255,255,255,.92), rgba(238,243,255,.85));
  color:#1c2540;
  border-radius:18px;
  border:1px solid rgba(255,255,255,.9);
  box-shadow:0 8px 28px rgba(60,80,160,.18), 0 2px 6px rgba(60,80,160,.10);
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards;
}
.fg-layer.fg-style-glass .fg-node::before { display:none; }
.fg-layer.fg-style-glass .fg-node .fg-tag {
  box-shadow:none; border:1px solid rgba(255,255,255,.7);
}
.fg-layer.fg-style-glass .fg-edge-base { stroke-width:3; }
.fg-layer.fg-style-glass .fg-edge-glow { opacity:.18; }
.fg-layer.fg-style-glass .fg-edge-label {
  background:rgba(255,255,255,.92); color:#41539e;
  border:1px solid rgba(120,140,220,.35);
}

/* ===== 风格 5：墨韵宣纸（水墨中国风） ===== */
.fg-layer.fg-style-ink .fg-node {
  background:linear-gradient(160deg, rgba(250,247,240,.96), rgba(240,235,222,.92));
  color:#2b2620;
  border-radius:6px;
  border:1.5px solid rgba(90,80,65,.55);
  box-shadow:0 6px 18px rgba(60,50,35,.16), inset 0 0 24px rgba(120,105,80,.07);
  font-family:'KaiTi','STKaiti','SimSun',serif;
  letter-spacing:1px;
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards;
}
.fg-layer.fg-style-ink .fg-node::before { display:none; }
.fg-layer.fg-style-ink .fg-node:hover { filter:brightness(1.02) drop-shadow(0 0 8px rgba(90,80,60,.35)); }
.fg-layer.fg-style-ink .fg-node .fg-tag {
  background:#3a342a; color:#f5f0e4; border-radius:2px;
  box-shadow:none; font-family:'KaiTi','STKaiti',serif;
}
.fg-layer.fg-style-ink .fg-node .fg-icon { display:none; }
.fg-layer.fg-style-ink .fg-edge-base {
  stroke:#4a4238 !important; stroke-dasharray:10 7; stroke-width:1.8;
  animation: fg-dash-flow 2s linear infinite;
}
.fg-layer.fg-style-ink .fg-edge-glow { stroke:#6b6050 !important; opacity:.14; }
.fg-layer.fg-style-ink .fg-edge-label {
  background:rgba(250,247,240,.95); color:#3a342a;
  border:1px solid rgba(90,80,65,.45); border-radius:2px;
  font-family:'KaiTi','STKaiti',serif;
}
/* 墨韵白天：本来就是纸色，仅微调 */
.fg-layer.fg-style-ink.fg-light .fg-node { box-shadow:0 5px 14px rgba(60,50,35,.13); }

/* ===== 风格 6：像素游戏（8-bit 复古） ===== */
.fg-layer.fg-style-pixel .fg-node {
  background:#1a1c3a;
  color:#e8e8ff;
  border-radius:0;
  border:3px solid #ffd23f;
  box-shadow:4px 4px 0 #7b2ff7, 0 0 16px rgba(123,47,247,.25);
  font-family:'Courier New',monospace;
  font-weight:700; letter-spacing:1px;
  image-rendering:pixelated;
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards;
}
.fg-layer.fg-style-pixel .fg-node::before { display:none; }
.fg-layer.fg-style-pixel .fg-node:hover {
  transform:translate(-2px,-2px);
  box-shadow:6px 6px 0 #7b2ff7, 0 0 22px rgba(123,47,247,.45);
}
.fg-layer.fg-style-pixel .fg-node .fg-tag {
  background:#ff3864; color:#fff; border-radius:0;
  box-shadow:2px 2px 0 rgba(0,0,0,.5); font-family:'Courier New',monospace;
}
.fg-layer.fg-style-pixel .fg-node .fg-icon { display:none; }
.fg-layer.fg-style-pixel .fg-edge-base {
  stroke:#ffd23f !important; stroke-dasharray:8 6; stroke-width:2.2;
  animation: fg-dash-flow .9s steps(6) infinite;
}
.fg-layer.fg-style-pixel .fg-edge-glow { stroke:#ff3864 !important; opacity:.2; filter:none; }
.fg-layer.fg-style-pixel .fg-edge-label {
  background:#1a1c3a; color:#ffd23f;
  border:2px solid #ffd23f; border-radius:0;
  font-family:'Courier New',monospace; font-weight:700;
}
/* 像素白天：掌机亮屏风 */
.fg-layer.fg-style-pixel.fg-light .fg-node {
  background:#fdfdf2; color:#2a2a55;
  border-color:#e05a7a; box-shadow:4px 4px 0 #38b6ff;
}
.fg-layer.fg-style-pixel.fg-light .fg-node .fg-tag { background:#38b6ff; color:#fff; }
.fg-layer.fg-style-pixel.fg-light .fg-edge-base { stroke:#e05a7a !important; }
.fg-layer.fg-style-pixel.fg-light .fg-edge-label {
  background:#fdfdf2; color:#c23a5e; border-color:#e05a7a;
}

/* ===== 风格 7：暗夜鎏金（黑金奢华） ===== */
.fg-layer.fg-style-gold .fg-node {
  background:linear-gradient(160deg, rgba(30,24,10,.96), rgba(18,14,6,.94));
  color:#f2e3b8;
  border-radius:10px;
  border:1px solid rgba(212,175,55,.7);
  box-shadow:0 0 18px rgba(212,175,55,.18), inset 0 0 26px rgba(212,175,55,.07);
  font-family:Georgia,'Times New Roman',serif;
  letter-spacing:.5px;
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards;
}
.fg-layer.fg-style-gold .fg-node::before { display:none; }
.fg-layer.fg-style-gold .fg-node:hover {
  border-color:#ffd700;
  box-shadow:0 0 26px rgba(255,215,0,.35), inset 0 0 30px rgba(255,215,0,.1);
}
.fg-layer.fg-style-gold .fg-node .fg-tag {
  background:linear-gradient(135deg,#d4af37,#a67c00); color:#1a1405;
  border-radius:3px; box-shadow:0 0 8px rgba(212,175,55,.5);
  font-family:Georgia,serif;
}
.fg-layer.fg-style-gold .fg-node .fg-icon { display:none; }
.fg-layer.fg-style-gold .fg-edge-base {
  stroke:#d4af37 !important; stroke-dasharray:14 9; stroke-width:1.8;
  animation: fg-dash-flow 2.2s linear infinite;
}
.fg-layer.fg-style-gold .fg-edge-glow { stroke:#a67c00 !important; opacity:.16; }
.fg-layer.fg-style-gold .fg-edge-label {
  background:rgba(26,20,5,.94); color:#f2e3b8;
  border:1px solid rgba(212,175,55,.55); border-radius:3px;
  font-family:Georgia,serif;
}
/* 鎏金白天：香槟金纸面 */
.fg-layer.fg-style-gold.fg-light .fg-node {
  background:linear-gradient(160deg, rgba(255,252,240,.96), rgba(250,242,220,.92));
  color:#4a3a10; box-shadow:0 5px 16px rgba(166,124,0,.18);
}
.fg-layer.fg-style-gold.fg-light .fg-node .fg-tag { background:linear-gradient(135deg,#c9a227,#8a6508); color:#fff8e0; }
.fg-layer.fg-style-gold.fg-light .fg-edge-base { stroke:#a67c00 !important; }
.fg-layer.fg-style-gold.fg-light .fg-edge-label {
  background:rgba(255,252,240,.96); color:#6b5210;
  border-color:rgba(166,124,0,.5);
}

/* ===== 风格 8：粉彩泡泡（糖果色） ===== */
.fg-layer.fg-style-candy .fg-node {
  background:linear-gradient(145deg, #fff5fa, #ffeef8);
  color:#7a3a6e;
  border-radius:24px;
  border:2px solid rgba(255,158,206,.75);
  box-shadow:0 8px 24px rgba(255,130,190,.22), 0 2px 6px rgba(255,130,190,.12);
  font-weight:600;
  animation: fg-pop .55s cubic-bezier(.22,1.4,.36,1) forwards;
}
.fg-layer.fg-style-candy .fg-node::before { display:none; }
.fg-layer.fg-style-candy .fg-node:hover {
  transform:translateY(-3px);
  box-shadow:0 14px 32px rgba(255,130,190,.35), 0 3px 8px rgba(255,130,190,.16);
}
.fg-layer.fg-style-candy .fg-node .fg-tag {
  background:linear-gradient(135deg,#ff9ece,#b892ff); color:#fff;
  border-radius:14px; box-shadow:0 2px 8px rgba(255,130,190,.4);
}
.fg-layer.fg-style-candy .fg-edge-base {
  stroke:#ff9ece !important; stroke-dasharray:4 8; stroke-width:3;
  animation: fg-dash-flow 1.6s linear infinite;
}
.fg-layer.fg-style-candy .fg-edge-glow { stroke:#b892ff !important; opacity:.2; }
.fg-layer.fg-style-candy .fg-edge-label {
  background:rgba(255,245,250,.95); color:#a04a8a;
  border:1px solid rgba(255,158,206,.6); border-radius:14px;
}
/* 粉彩白天：本来就是浅色，仅微调 */
.fg-layer.fg-style-candy.fg-light .fg-node { box-shadow:0 6px 18px rgba(255,130,190,.20); }

/* ===== 昼夜模式：白天（light）——整体提亮，各风格统一覆盖 ===== */
/* 默认（霓虹赛博）白天 */
.fg-layer.fg-light { --fg-bg-dim:1; }
.fg-layer.fg-light .fg-node {
  background:linear-gradient(145deg, rgba(255,255,255,.94), rgba(236,242,255,.88));
  color:#1c2540;
  border:1.5px solid rgba(255,255,255,.95);
  box-shadow:0 8px 26px rgba(60,80,160,.16), 0 2px 6px rgba(60,80,160,.10), inset 0 0 0 1px rgba(120,140,220,.12);
  text-shadow:none;
}
.fg-layer.fg-light .fg-node::before {
  background:conic-gradient(from var(--fg-angle,0deg), var(--fg-c1), var(--fg-c2), var(--fg-c1));
  opacity:.85;
}
.fg-layer.fg-light .fg-node .fg-tag {
  background:linear-gradient(135deg, var(--fg-c1), var(--fg-c2));
  color:#fff; box-shadow:0 1px 4px rgba(60,80,160,.25);
}
.fg-layer.fg-light .fg-node:hover { filter:brightness(1.02) drop-shadow(0 4px 14px rgba(60,80,160,.28)); }
.fg-layer.fg-light .fg-edge-base { stroke:#5a6ca8 !important; opacity:.75; }
.fg-layer.fg-light .fg-edge-glow { opacity:.12; }
.fg-layer.fg-light .fg-edge-label {
  background:rgba(255,255,255,.95); color:#3a4a80;
  border:1px solid rgba(120,140,220,.4);
  box-shadow:0 2px 6px rgba(60,80,160,.12);
}
/* 蓝图 + 白天：转向羊皮纸工程图 */
.fg-layer.fg-style-blueprint.fg-light .fg-node {
  background:rgba(255,253,244,.9); color:#274a6e;
  border:1px solid rgba(70,130,190,.6);
  box-shadow:0 3px 12px rgba(70,120,180,.15);
  font-family:monospace;
}
.fg-layer.fg-style-blueprint.fg-light .fg-node::before { display:none; }
.fg-layer.fg-style-blueprint.fg-light .fg-node .fg-tag {
  background:rgba(70,130,190,.15); color:#274a6e; box-shadow:none;
  border:1px solid rgba(70,130,190,.45); font-family:monospace;
}
.fg-layer.fg-style-blueprint.fg-light .fg-edge-base { stroke:#4a7fb5 !important; stroke-dasharray:4 4; }
.fg-layer.fg-style-blueprint.fg-light .fg-edge-label {
  background:rgba(255,253,244,.95); color:#274a6e;
  border:1px solid rgba(70,130,190,.45); font-family:monospace;
}
/* 矩阵 + 白天：纸上代码风 */
.fg-layer.fg-style-matrix.fg-light .fg-node {
  background:rgba(250,255,250,.92); color:#0a5c30;
  border:1px solid rgba(20,150,80,.55);
  text-shadow:none;
  font-family:'Consolas','Courier New',monospace;
  box-shadow:0 3px 12px rgba(20,150,80,.14);
}
.fg-layer.fg-style-matrix.fg-light .fg-node .fg-tag {
  background:#0a9c50; color:#fff; box-shadow:none;
}
.fg-layer.fg-style-matrix.fg-light .fg-edge-base { stroke:#0a9c50 !important; }
.fg-layer.fg-style-matrix.fg-light .fg-edge-label {
  background:rgba(250,255,250,.95); color:#0a5c30;
  border:1px solid rgba(20,150,80,.45);
}
/* 玻璃 + 白天本来就是浅色，只微调对比 */
.fg-layer.fg-style-glass.fg-light .fg-node { box-shadow:0 10px 30px rgba(60,80,160,.20), 0 2px 8px rgba(60,80,160,.12); }
/* 风格选择已集成到主题面板，画布悬浮条样式废弃 */
`;
    document.head.appendChild(st);
  }

  // ---------- Mermaid 解析（复用流水线同款规则） ----------
  function parseMermaid(text) {
    var nodes = {}, edges = [], seq = 0;
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || /^(flowchart|graph|%%|subgraph|end\s*$)/i.test(line)) return;
      var re = /([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\[([^\]]*)\]|\(([^)]*)\))?\s*(?:-->\|([^|]*)\|\s*|-->\s*|-\.->\s*)([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\[([^\]]*)\]|\(([^)]*)\))?/g;
      var m;
      while ((m = re.exec(line)) !== null) {
        var a = m[1], aLabel = m[2] || m[3] || a;
        var b = m[5], bLabel = m[6] || m[7] || b;
        if (!nodes[a]) nodes[a] = { id: a, label: aLabel };
        if (!nodes[b]) nodes[b] = { id: b, label: bLabel };
        edges.push({ from: a, to: b, label: (m[4] || '').trim() });
      }
      var m2 = line.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[([^\]]*)\]$/);
      if (m2 && !nodes[m2[1]]) nodes[m2[1]] = { id: m2[1], label: m2[2] };
    });
    return { nodes: nodes, edges: edges };
  }

  // 分层布局 + 位置计算
  function layout(nodeMap, edges) {
    // 计算层级
    var depth = {};
    Object.keys(nodeMap).forEach(function (id) { depth[id] = 0; });
    var changed = true, guard = 0;
    while (changed && guard++ < 100) {
      changed = false;
      edges.forEach(function (e) {
        if (depth[e.to] < depth[e.from] + 1) { depth[e.to] = depth[e.from] + 1; changed = true; }
      });
    }
    // 同层分行
    var cols = {};
    Object.keys(nodeMap).forEach(function (id) {
      (cols[depth[id]] = cols[depth[id]] || []).push(id);
    });
    var NODE_W = 190, NODE_H = 78, GAP_X = 170, GAP_Y = 60;
    window.FG_NODE_W = NODE_W; // 暴露给 deploy() 使用（原 bug：deploy 第645行引用不到局部变量）
    var pos = {};
    var maxRows = 1;
    Object.keys(cols).forEach(function (d) { maxRows = Math.max(maxRows, cols[d].length); });
    var totalW = Object.keys(cols).length * (NODE_W + GAP_X);
    Object.keys(cols).forEach(function (d) {
      var list = cols[d];
      var colH = list.length * (NODE_H + GAP_Y);
      var startY = (maxRows * (NODE_H + GAP_Y) - colH) / 2 + 120;
      list.forEach(function (id, i) {
        pos[id] = {
          x: d * (NODE_W + GAP_X) + 80,
          y: startY + i * (NODE_H + GAP_Y),
          depth: +d
        };
      });
    });
    return { pos: pos, maxDepth: Math.max.apply(null, Object.keys(cols).map(Number).concat([0])) };
  }

  // 供会话层等外部模块解析 mermaid 拓扑
  window.FGParse = parseMermaid;

  // ---------- 部署 ----------
  FG.deploy = function (text, opts) {
    opts = opts || {};
    var host = document.getElementById('canvasContent');
    if (!host) return { success: false, message: '画布未初始化' };
    injectStyles();

    var parsed = parseMermaid(text || '');
    var nodeIds = Object.keys(parsed.nodes);
    if (!nodeIds.length) return { success: false, message: '未解析到流程图节点，请检查 mermaid 文本' };

    var lay = layout(parsed.nodes, parsed.edges);
    var startX = typeof opts.x === 'number' ? opts.x : (App.canvasGetView ? -App.canvasGetView().x + 200 : 200);
    var startY = typeof opts.y === 'number' ? opts.y : (App.canvasGetView ? -App.canvasGetView().y + 160 : 160);

    // 图层容器（节点 + SVG + 标签全挂在层内，便于整体清除/平移跟随）
    var layer = document.createElement('div');
    layer.className = 'fg-layer';
    layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:15;';
    layer.id = 'fg-layer-' + (++_seq);
    var curStyle = _currentStyle();
    if (curStyle.layerClass) layer.classList.add(curStyle.layerClass);
    if (_modeKey === 'light') layer.classList.add('fg-light'); // 同步当前昼夜模式
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'fg-svg');
    layer.appendChild(svg);
    host.appendChild(layer);
    _layers.push(layer);
    layer.style.transformOrigin = '0 0';
    layer.style.transform = 'scale(' + _scale + ')';
    layer._fgMermaid = text;
    layer._fgX = startX; layer._fgY = startY;
    layer._fgParsed = parsed; // 供会话层（FGS）读取边拓扑
    layer._fgEdgeRefs = [];

    var icons = ['🚀', '⚙️', '✨', '🧠', '💡', '🔥', '🎯', '🧩'];
    var nodeEls = {};
    var savedPos = (opts && opts.positions) || null;

    // 1. 霓虹节点
    nodeIds.forEach(function (id, i) {
      var n = parsed.nodes[id], p = lay.pos[id];
      if (savedPos && savedPos[id] && typeof savedPos[id].x === 'number') {
        p = { x: savedPos[id].x - startX, y: savedPos[id].y - startY, depth: p.depth };
      }
      var t = THEME[p.depth % THEME.length];
      var el = document.createElement('div');
      el.className = 'fg-node';
      el.style.left = (startX + p.x) + 'px';
      el.style.top = (startY + p.y) + 'px';
      el.style.setProperty('--fg-c1', t.c1);
      el.style.setProperty('--fg-c2', t.c2);
      el.style.setProperty('--fg-glow', t.glow);
      el.style.animationDelay = (i * 0.14) + 's, .6s';
      el.style.pointerEvents = 'auto';
      el.innerHTML =
        '<span class="fg-icon">' + icons[i % icons.length] + '</span>' +
        '<span class="fg-label">' + _esc(n.label) + '</span>' +
        '<span class="fg-tag">' + id + '</span>' +
        '<span class="fg-port" title="拖拽连线"></span>';
      layer.appendChild(el);
      var NODE_W = (window.FG_NODE_W || 190); nodeEls[id] = { el: el, w: el.offsetWidth || NODE_W, h: el.offsetHeight || 60 };
    });
    layer._fgNodes = nodeEls;

    // 2. 发光连线（贝塞尔 + 流动虚线 + 粒子）
    var defs = document.createElementNS(SVG_NS, 'defs');
    var hueId = 'fg-hue-' + _seq;
    defs.innerHTML =
      '<linearGradient id="' + hueId + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
      THEME.map(function (t, i) {
        return '<stop offset="' + (i / (THEME.length - 1) * 100) + '%" stop-color="' + t.c1 + '"/>';
      }).join('') +
      '</linearGradient>';
    svg.appendChild(defs);

    var delayBase = nodeIds.length * 0.14 + 0.3;
    parsed.edges.forEach(function (e, i) {
      var a = nodeEls[e.from], b = nodeEls[e.to];
      if (!a || !b) return;
      var x1 = startX + lay.pos[e.from].x + a.w, y1 = startY + lay.pos[e.from].y + a.h / 2;
      var x2 = startX + lay.pos[e.to].x,        y2 = startY + lay.pos[e.to].y + b.h / 2;
      var cx = (x1 + x2) / 2;
      var d = 'M ' + x1 + ' ' + y1 + ' C ' + cx + ' ' + y1 + ', ' + cx + ' ' + y2 + ', ' + x2 + ' ' + y2;

      // 底层辉光
      var glow = document.createElementNS(SVG_NS, 'path');
      glow.setAttribute('d', d);
      glow.setAttribute('class', 'fg-edge-glow');
      glow.setAttribute('stroke', 'url(#' + hueId + ')');
      glow.style.opacity = '0';
      svg.appendChild(glow);

      // 主线：流动虚线
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'fg-edge-base');
      path.setAttribute('stroke', 'url(#' + hueId + ')');
      path.style.animationDelay = (delayBase + i * 0.08) + 's, ' + (delayBase + i * 0.08) + 's';
      svg.appendChild(path);

      // 奔跑粒子（2 个错开的发光圆点沿线移动）
      for (var k = 0; k < 2; k++) {
        var pt = document.createElementNS(SVG_NS, 'circle');
        pt.setAttribute('r', k ? 3 : 4.5);
        pt.setAttribute('fill', THEME[k % THEME.length].c1);
        pt.style.filter = 'drop-shadow(0 0 6px ' + THEME[k % THEME.length].glow + ')';
        var anim = document.createElementNS(SVG_NS, 'animateMotion');
        anim.setAttribute('dur', (2.4 + k * 0.9) + 's');
        anim.setAttribute('repeatCount', 'indefinite');
        anim.setAttribute('begin', (delayBase + i * 0.08 + k * 0.6) + 's');
        var mpath = document.createElementNS(SVG_NS, 'mpath');
        mpath.setAttribute('href', '#' + (path.id = (path.id || 'fgp-' + _seq + '-' + i)));
        anim.appendChild(mpath);
        pt.appendChild(anim);
        pt.style.opacity = '0';
        setTimeout(function (el) { return function () { el.style.opacity = '1'; }; }(pt), (delayBase + i * 0.08) * 1000);
        svg.appendChild(pt);
      }

      // 边标签
      if (e.label) {
        var lb = document.createElement('div');
        lb.className = 'fg-edge-label';
        lb.textContent = e.label;
        lb.style.left = ((x1 + x2) / 2) + 'px';
        lb.style.top = ((y1 + y2) / 2 - 14) + 'px';
        lb.style.animationDelay = (delayBase + i * 0.08 + 0.2) + 's';
        layer.appendChild(lb);
      }
    });

    // 让节点尺寸在渲染后精确用于连线（再画一遍边更准：先粗画，600ms 后按真实尺寸重画）
    _buildStyleBar();
    setTimeout(function () {
      nodeIds.forEach(function (id) {
        nodeEls[id].w = nodeEls[id].el.offsetWidth;
        nodeEls[id].h = nodeEls[id].el.offsetHeight;
      });
      var refs = redrawEdges(svg, layer, parsed, nodeEls, lay, startX, startY, hueId, _seq);
      layer._fgEdgeRefs = refs; // 供会话层（FGS）高亮数据流
      if (typeof enableDragging === 'function') enableDragging(layer, nodeEls, refs);
      FG._persist();
    }, 650);

    var view = App.canvasGetView ? App.canvasGetView() : { x: 0, y: 0 };
    if (App.canvasSetView) {
      // 不自动移动视口，仅返回位置信息
    }

    // 【修复】画布上已有流程图图层，隐藏中心的「双击创建」提示
    try { if (App && App.hideHint) App.hideHint(); } catch (err) {}

    // 【新增】图层关闭按钮（定位到流程图节点区域的右上角，而非整个画布右上角）
    var closeBtn = document.createElement('div');
    closeBtn.className = 'fg-layer-close';
    closeBtn.textContent = '×';
    closeBtn.title = '关闭此流程图';
    // 计算所有节点的包围盒，把按钮放在节点区域右上角（外扩 10px）
    try {
      var ids = Object.keys(nodeEls);
      var maxX = -Infinity, minY = Infinity;
      ids.forEach(function (id) {
        var el = nodeEls[id].el;
        var x = parseFloat(el.style.left) || 0;
        var y = parseFloat(el.style.top) || 0;
        if (x + (nodeEls[id].w || 190) > maxX) maxX = x + (nodeEls[id].w || 190);
        if (y < minY) minY = y;
      });
      if (isFinite(maxX) && isFinite(minY)) {
        closeBtn.style.left = Math.max(0, maxX + 6) + 'px';
        closeBtn.style.top = Math.max(0, minY - 36) + 'px';
      }
    } catch (e) {}
    closeBtn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    closeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try {
        var idx = _layers.indexOf(layer);
        if (idx >= 0) _layers.splice(idx, 1);
        layer.remove();
        FG._persist();
        try { App._minimapDraw ? App._minimapDraw() : (App.updateMinimap && App.updateMinimap()); } catch (e) {}
        // 全部关完后，若画布无对话/面板/媒体节点，恢复中心提示
        try { if (App && App.showHint) App.showHint(); } catch (e) {}
      } catch (e) { console.warn('[FlowGlam] 关闭图层失败:', e); }
    });
    layer.appendChild(closeBtn);

    return {
      success: true,
      message: '✨ 炫酷流程图已部署到画布：' + nodeIds.length + ' 个节点、' + parsed.edges.length + ' 条发光连线',
      data: { nodes: nodeIds.length, edges: parsed.edges.length }
    };
  };

  // 按真实节点尺寸重画边（粒子 mpath 指向新 path）
  function redrawEdges(svg, layer, parsed, nodeEls, lay, startX, startY, hueId, seq) {
    // 移除旧 path/粒子/标签
    svg.querySelectorAll('path, circle').forEach(function (el) { el.remove(); });
    layer.querySelectorAll('.fg-edge-label').forEach(function (el) { el.remove(); });
    var refs = [];
    parsed.edges.forEach(function (e, i) {
      var a = nodeEls[e.from], b = nodeEls[e.to];
      if (!a || !b) return;
      var x1 = startX + lay.pos[e.from].x + a.w, y1 = startY + lay.pos[e.from].y + a.h / 2;
      var x2 = startX + lay.pos[e.to].x,        y2 = startY + lay.pos[e.to].y + b.h / 2;
      var cx = (x1 + x2) / 2;
      var d = 'M ' + x1 + ' ' + y1 + ' C ' + cx + ' ' + y1 + ', ' + cx + ' ' + y2 + ', ' + x2 + ' ' + y2;
      var pid = 'fgr-' + seq + '-' + i;

      var glow = document.createElementNS(SVG_NS, 'path');
      glow.setAttribute('d', d); glow.setAttribute('class', 'fg-edge-glow');
      glow.setAttribute('stroke', 'url(#' + hueId + ')'); glow.style.opacity = '.22';
      svg.appendChild(glow);

      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d); path.setAttribute('class', 'fg-edge-base');
      path.setAttribute('stroke', 'url(#' + hueId + ')');
      path.id = pid; path.style.opacity = '1';
      path.style.animationDelay = '0s, 0s';
      svg.appendChild(path);

      for (var k = 0; k < 2; k++) {
        var pt = document.createElementNS(SVG_NS, 'circle');
        pt.setAttribute('r', k ? 3 : 4.5);
        pt.setAttribute('fill', THEME[k % THEME.length].c1);
        pt.style.filter = 'drop-shadow(0 0 6px ' + THEME[k % THEME.length].glow + ')';
        var anim = document.createElementNS(SVG_NS, 'animateMotion');
        anim.setAttribute('dur', (2.4 + k * 0.9) + 's');
        anim.setAttribute('repeatCount', 'indefinite');
        var mp = document.createElementNS(SVG_NS, 'mpath');
        mp.setAttribute('href', '#' + pid);
        anim.appendChild(mp); pt.appendChild(anim);
        svg.appendChild(pt);
      }
      if (e.label) {
        var lb = document.createElement('div');
        lb.className = 'fg-edge-label'; lb.textContent = e.label;
        lb.style.left = ((x1 + x2) / 2) + 'px';
        lb.style.top = ((y1 + y2) / 2 - 14) + 'px';
        lb.style.opacity = '1';
        layer.appendChild(lb);
        refs.push({ from: e.from, to: e.to, glow: glow, path: path, label: lb });
      } else {
        refs.push({ from: e.from, to: e.to, glow: glow, path: path, label: null });
      }
    });
    if (App.drawCurveLinks) { try { App.drawCurveLinks(); } catch (err) {} }
    // 部署完成后立即刷新小地图导航，让流程图节点马上在导航里可见
    setTimeout(function () {
      try {
        if (App && App._minimapDraw) App._minimapDraw();
        else if (App && App.updateMinimap) App.updateMinimap();
      } catch (err) {}
    }, 350);
    return refs;
  }

  // ---------- 拖拽：节点可拖，连线/粒子/标签实时跟随 ----------
  function enableDragging(layer, nodeEls, edgeRefs) {
    // 保存每个节点的最新位置（offset，含 startX/Y）
    var pos = {};
    Object.keys(nodeEls).forEach(function (id) {
      var el = nodeEls[id].el;
      pos[id] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    });

    function refreshEdges() {
      edgeRefs.forEach(function (r) {
        var a = nodeEls[r.from], b = nodeEls[r.to];
        if (!a || !b) return;
        var p1 = pos[r.from], p2 = pos[r.to];
        var x1 = p1.x + a.w, y1 = p1.y + a.h / 2;
        var x2 = p2.x,        y2 = p2.y + b.h / 2;
        var cx = (x1 + x2) / 2;
        var d = 'M ' + x1 + ' ' + y1 + ' C ' + cx + ' ' + y1 + ', ' + cx + ' ' + y2 + ', ' + x2 + ' ' + y2;
        r.glow.setAttribute('d', d);
        r.path.setAttribute('d', d);
        if (r.label) {
          r.label.style.left = ((x1 + x2) / 2) + 'px';
          r.label.style.top = ((y1 + y2) / 2 - 14) + 'px';
        }
      });
    }

    Object.keys(nodeEls).forEach(function (id) {
      var el = nodeEls[id].el;
      el.style.cursor = 'grab';
      el.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        ev.preventDefault();
        var start = { x: ev.clientX, y: ev.clientY };
        var orig = { x: pos[id].x, y: pos[id].y };
        el.classList.add('fg-dragging');
        try { el.setPointerCapture(ev.pointerId); } catch (err) {}

        function onMove(e2) {
          pos[id].x = orig.x + (e2.clientX - start.x);
          pos[id].y = orig.y + (e2.clientY - start.y);
          el.style.left = pos[id].x + 'px';
          el.style.top = pos[id].y + 'px';
          refreshEdges();
        }
        function onUp(e2) {
          el.classList.remove('fg-dragging');
          document.removeEventListener('pointermove', onMove, true);
          document.removeEventListener('pointerup', onUp, true);
          try { FG._persist(); } catch (err) {}
          try { App._minimapDraw ? App._minimapDraw() : (App.updateMinimap && App.updateMinimap()); } catch (err) {}
        }
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
      });
    });
  }

  FG.clear = function () {
    _layers.forEach(function (l) { l.remove(); });
    _layers.length = 0;
    FG._persist();
    // 全部清除后，若画布无对话/面板/媒体节点，恢复中心提示
    try { if (App && App.showHint) App.showHint(); } catch (e) {}
    try { App._minimapDraw ? App._minimapDraw() : (App.updateMinimap && App.updateMinimap()); } catch (e) {}
    return { success: true, message: '已清除所有炫酷流程图' };
  };

  // ---------- 关闭按钮样式（昼夜两套配色） ----------
  var _closeCss = document.createElement('style');
  _closeCss.textContent = [
    '.fg-layer-close{position:absolute;top:10px;right:auto;left:auto;z-index:99;width:30px;height:30px;line-height:28px;text-align:center;',
    'font-size:18px;font-weight:bold;cursor:pointer;border-radius:8px;color:rgba(255,255,255,.75);',
    'background:rgba(20,20,28,.55);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(6px);',
    'transition:all .18s ease;pointer-events:auto;user-select:none;}',
    '.fg-layer-close:hover{color:#ff5a5a;background:rgba(255,90,90,.15);border-color:rgba(255,90,90,.5);transform:scale(1.12);}',
    '.fg-light .fg-layer-close, .fg-layer.fg-light .fg-layer-close{color:rgba(30,30,40,.7);',
    'background:rgba(255,255,255,.6);border-color:rgba(30,30,40,.15);}',
    '.fg-light .fg-layer-close:hover, .fg-layer.fg-light .fg-layer-close:hover{color:#d03030;background:rgba(255,90,90,.12);border-color:rgba(208,48,48,.5);}',
    // 连线端口小圆点：节点右侧外凸，可见可拖
    '.fg-layer .fg-node .fg-port{position:absolute;right:-9px;top:50%;margin-top:-7px;width:14px;height:14px;border-radius:50%;',
    'background:rgba(0,229,255,.85);border:2px solid rgba(255,255,255,.9);box-shadow:0 0 10px rgba(0,229,255,.8);',
    'cursor:crosshair;pointer-events:auto;z-index:20;transition:transform .15s ease;}',
    '.fg-layer .fg-node .fg-port:hover{transform:scale(1.4);}',
    '.fg-layer.fg-light .fg-node .fg-port{background:rgba(0,150,200,.85);border-color:rgba(255,255,255,.95);}'
  ].join('');
  (document.head || document.documentElement).appendChild(_closeCss);

  // ---------- 持久化（SQLite kv_store，经 DB.kvSet/kvGet，刷新不丢） ----------
  var FG_KV_KEY = 'flowglam_layers';
  FG._persist = function () {
    if (!window.DB || !DB.kvSet) return;
    try {
      var arr = _layers.map(function (layer) {
        var nodes = {};
        layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (id) {
          var el = layer._fgNodes[id].el;
          nodes[id] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
        });
        return { mermaid: layer._fgMermaid || '', x: layer._fgX, y: layer._fgY, nodes: nodes, style: _styleKey };
      }).filter(function (l) { return l.mermaid; });
      DB.kvSet(FG_KV_KEY, JSON.stringify(arr));
    } catch (e) { console.warn('[FlowGlam] 持久化失败:', e); }
  };

  // 启动恢复：读取 kv_store，逐层重绘（带真实节点位置）
  FG.restore = function () {
    if (!window.DB || !DB.kvGet) return Promise.resolve(false);
    var loadScale = (window.DB && DB.kvGet)
      ? DB.kvGet('flowglam_scale').then(function (v) {
          var n = parseFloat(v);
          if (isFinite(n) && n >= 0.25 && n <= 2) { _scale = n; _applyScale(); }
        }).catch(function () {})
      : Promise.resolve();
    return loadScale.then(function () {
    return DB.kvGet(FG_KV_KEY).then(function (val) {
      if (val === null || val === undefined) return false; // 键不存在
      var arr;
      try { arr = typeof val === 'string' ? JSON.parse(val) : val; } catch (e) { return false; }
      if (!Array.isArray(arr) || !arr.length) return false;
      if (arr[0] && arr[0].style) { try { FG.setStyle(arr[0].style); } catch (e) {} }
      arr.forEach(function (saved) {
        if (!saved || !saved.mermaid) return;
        var opts = { x: saved.x, y: saved.y };
        if (saved.nodes) opts.positions = saved.nodes;
        FG.deploy(saved.mermaid, opts);
      });
      console.log('[FlowGlam] 已从数据库恢复 ' + arr.length + ' 张流程图');
      return true;
    }).catch(function (e) { console.warn('[FlowGlam] 恢复失败:', e); return false; });
    });
  };

  function _esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
})();


// ===== 启动：优先从数据库恢复持久化的流程图；没有才部署演示图 =====
window.FG_SELFTEST = true;
(function () {
  function st() {
    try {
      if (!document.getElementById('canvasContent')) { setTimeout(st, 500); return; }
      if (!window.DB || !DB.kvGet) {
        setTimeout(st, 500); // DB 未就绪：等待，不再部署演示图
        return;
      }
      FlowGlam.restore().then(function (ok) {
        if (!ok) {
          // 仅首次安装（kv 无 flowglam_layers 键）才部署演示图；空数组=用户已清空，不部署
          DB.kvHas('flowglam_layers').then(function (has) {
            if (!has) FlowGlam.deploy('flowchart TD\nA[需求分析] --> B{架构设计}\nB --> C[前端开发]\nB --> D[后端开发]\nC --> E[联调测试]\nD --> E\nE --> F[上线部署]');
          }).catch(function () {});
        }
      });
    } catch (e) { console.error("[FlowGlam] 启动失败:", e); }
  }
  setTimeout(st, 1200);
})();
