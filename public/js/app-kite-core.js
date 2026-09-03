/* ============================================================
 * app-kite-core.js - Kite 画布模块拆分：核心：状态/初始化/兜底样式/画布事件/默认尺寸
 * 由 app-kitecanvas.js 自动拆分，共享 window.__KiteNS 命名空间。
 * 加载顺序：core -> panels -> vision -> nodes -> links（见 index.html）
 * ============================================================ */
(function () {
  'use strict';
  const NS = (window.__KiteNS = window.__KiteNS || {});
  // ---- 本文件引用的外部符号（由前面的文件定义）----
  const dualPanelBuilders = NS.dualPanelBuilders; // from earlier file
  // ---- 本文件定义的符号（文件末尾统一写回 NS）----
// KITE_DEFAULT_SIZES, KITE_DEFAULT_SIZES_KEY, bezierPath, bindCanvasEvents, init, injectBaseStyles, state



  // 贝塞尔路径工具已抽离到独立文件 app-kiteportlink.js（统一端口拉线管线），
  // 这里保留一个本地引用，兼容本模块内部其它绘制逻辑的既有调用。
  function bezierPath(x1, y1, x2, y2) {
    if (window.KitePortLink && typeof KitePortLink.bezierPath === 'function') {
      return KitePortLink.bezierPath(x1, y1, x2, y2);
    }
    console.warn('[KiteCanvas] 缺少 app-kiteportlink.js，请确认 index.html 中已引入');
    return '';
  }

  // ---------- 状态 ----------
  const state = {
    canvas: null,       // 最外层 <div id="kite-canvas" class="kite-canvas">
    svg: null,          // <svg> 曲线层
    nodes: new Map(),   // id -> {id,type,x,y,w,h,el}
    nextId: 1,
    // Keep kite nodes below chatboxes; preserve ordering only within the kite layer.
    zIndex: 10,
  };

  // ---------- 初始化 ----------
  function init() {
    if (state.canvas) return; // 单例

    // 容器：同时给 id 和 class，并加内联基础样式（即使 style-kite.css 没匹配上也能正常显示）
    // 统一挂到主画布内容层，节点、曲线和工具面板会随画布平移。
    const c = document.getElementById('canvasContent') || document.createElement('div');
    c.id = c.id || 'kite-canvas';
    c.classList.add('kite-canvas');
    c.style.overflow = 'visible';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('kite-svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    c.appendChild(svg);
    state.canvas = c;
    state.svg = c.querySelector('svg');

    // 内联基础样式（兜底，避免 style-kite.css 缺失或选择器不匹配导致节点看不见/点不到）
    injectBaseStyles();

    bindCanvasEvents();
    // 默认不再自动创建提示词节点：曾导致画布中间莫名其妙出现提示词框（init 可能被再次触发，或用户不想要默认节点）。需要时用双击面板的「✎ 提示词」创建。
  }

  // ---------- 兜底 CSS（防止外部样式丢失） ----------
  function injectBaseStyles() {
    if (document.getElementById('kite-base-styles')) return;
    const css = `
      #kite-canvas { position:fixed; left:0; top:0; width:100vw; height:100vh; z-index:1; pointer-events:none; overflow:visible; }
      .kite-svg { position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; overflow:visible; }
      .kite-curve { fill:none; stroke:rgba(91,122,156,.64); stroke-width:3; stroke-linecap:round; pointer-events:visibleStroke; filter:drop-shadow(0 0 3px rgba(126,182,255,.35)); cursor:pointer; transition:stroke .12s ease, stroke-width .12s ease, filter .12s ease; stroke-dasharray:10 7; animation:kite-flow 1.1s linear infinite; }
      @keyframes kite-flow { from { stroke-dashoffset:34; } to { stroke-dashoffset:0; } }
      /* 连线可交互：悬停高亮，右键/Alt+点击 删除 */
      .kite-curve:hover { stroke:#7eb6ff; stroke-width:5; }
      .kite-curve.kite-link-deleting { stroke:#ff5a6e; stroke-width:5; }
      .kite-link-menu { position:fixed; z-index:10005; min-width:120px; padding:4px; background:var(--bg-card,#1b2130); border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,.5); }
      .kite-link-menu button { display:block; width:100%; border:0; background:transparent; color:#e8edf5; text-align:left; padding:8px 11px; border-radius:4px; cursor:pointer; font-size:13px; }
      .kite-link-menu button:hover { background:rgba(255,90,110,.18); color:#ffb3bd; }
      .kite-node {
        position:absolute;
        width:320px; height:240px;
        background:var(--bg-card);
        border:1px solid var(--border);
        border-radius:8px;
        box-shadow:0 8px 30px rgba(0,0,0,0.5);
        overflow:hidden;
        display:flex; flex-direction:column;
        pointer-events:auto;
        user-select:none;
        color:var(--text);
        font:13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif;
      }
      .kite-node.selected { border-color:var(--blue); box-shadow:0 0 0 2px rgba(var(--blue-rgb),.35), 0 8px 30px rgba(0,0,0,0.5); }
      .kite-node.dragging { cursor:grabbing; }
      .kite-node-media { flex:1 1 auto; min-height:0; background:#000; display:flex; align-items:center; justify-content:center; }
      .kite-node-media img, .kite-node-media video { width:100%; height:100%; object-fit:contain; display:block; }
      .kite-node-bar { flex:0 0 auto; display:flex; align-items:center; gap:6px; height:36px; padding:0 8px; background:var(--bg-hover); border-bottom:1px solid var(--border); border-radius:8px 8px 0 0; cursor:move; }
      .kite-node-type { font-size:13px; flex-shrink:0; }
      .kite-node-title { flex:1 1 auto; min-width:0; font-size:14px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* 提示词节点标题占满剩余空间，使关闭按钮始终贴右侧并跟随宽度 */
      .kite-node-actions { display:flex; gap:2px; flex-shrink:0; }
      .kite-node-actions button { background:none; border:0; color:var(--text2); cursor:pointer; padding:2px 5px; border-radius:3px; font-size:13px; }
      .kite-node-actions button:hover { background:var(--border); color:var(--text); }
      .kite-panel-in-port { position:absolute; left:-5px; top:50%; transform:translateY(-50%); width:8px; height:8px; border-radius:50%; background:rgba(126,170,145,.72); border:1px solid rgba(224,232,228,.7); box-shadow:none; cursor:crosshair; z-index:5; }
      .kite-panel-in-port:hover { background:rgba(151,190,166,.86); }
      .kite-panel-out-port { position:absolute; right:-5px; top:50%; transform:translateY(-50%); width:8px; height:8px; border-radius:50%; background:rgba(126,155,190,.72); border:1px solid rgba(224,230,238,.7); box-shadow:none; cursor:crosshair; z-index:5; }
      .kite-node-in-port, .kite-node-out-port { position:absolute; top:50%; transform:translateY(-50%); width:7px; height:7px; border-radius:50%; border:1px solid rgba(224,230,238,.7); box-shadow:none; cursor:crosshair; z-index:6; }
      .kite-node-in-port { left:-4px; background:rgba(126,170,145,.72); opacity:0; pointer-events:none; } /* 隐藏图片左侧竖线状入点圆点 */
      .kite-node-out-port { right:-4px; background:rgba(126,155,190,.72); }
      .kite-node-in-port:hover, .kite-node-out-port:hover { box-shadow:0 0 4px rgba(150,175,205,.45); }
      .kite-panel-out-port:hover { background:rgba(151,178,210,.86); }
      .kite-panel-out-port.dragging { background:rgba(205,215,226,.92); }
      .kite-node-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:9px; background:rgba(12,15,23,.88); color:var(--text); font-size:13px; letter-spacing:1px; }
      .kite-node-loading::before { content:''; width:18px; height:18px; border:2px solid rgba(126,182,255,.28); border-top-color:#7eb6ff; border-radius:50%; animation:kite-render-spin .75s linear infinite; }
      .kite-node-loading::after { content:'渲染中'; animation:kite-render-pulse 1.2s ease-in-out infinite; }
      @keyframes kite-render-pulse { 50% { opacity:.48; } }
      .kite-handle { position:absolute; width:14px; height:14px; background:transparent; border:0; border-radius:50%; z-index:2; }
      .kite-handle::after { content:''; position:absolute; left:4px; top:4px; width:6px; height:6px; border:1px solid rgba(190,200,215,.42); border-radius:50%; background:rgba(45,52,64,.62); transition:background .12s, border-color .12s, box-shadow .12s, transform .12s; }
      .kite-handle-nw:hover::after, .kite-handle-ne:hover::after, .kite-handle-se:hover::after, .kite-handle-sw:hover::after { background:rgba(126,182,255,.9); border-color:rgba(230,242,255,.95); box-shadow:0 0 5px rgba(126,182,255,.5); transform:scale(1.15); }
      .kite-handle-nw { left:-7px; top:-7px; cursor:nwse-resize; }
      .kite-handle-ne { right:-7px; top:-7px; cursor:nesw-resize; }
      .kite-handle-se { right:-7px; bottom:-7px; cursor:nwse-resize; }
      .kite-handle-sw { left:-7px; bottom:-7px; cursor:nesw-resize; }
      .kite-modal { position:fixed; inset:0; background:rgba(0,0,0,.85); display:flex; align-items:center; justify-content:center; z-index:9999; cursor:zoom-out; }
      .kite-modal-inner { position:relative; max-width:92vw; max-height:92vh; }
      .kite-modal-inner img, .kite-modal-inner video { max-width:92vw; max-height:92vh; object-fit:contain; }
      .kite-modal-close { position:absolute; top:-30px; right:0; color:#fff; font-size:20px; cursor:pointer; }
      .kite-node-text { background:var(--bg-card); border-color:var(--border); overflow:visible; }
      /* 提示词节点：默认内容自适应高度，可手动上下拖拽调整（手动后不再回弹为自适应） */
      .kite-node-text { height:auto; min-height:120px; }
      /* 手动调过高度后：textarea 填满剩余空间 */
      .kite-node-text.kite-manual-height .kite-text-body { height:calc(100% - 36px); box-sizing:border-box; }
      .kite-node-text.kite-manual-height .kite-textarea { height:100%; max-height:none; }
      .kite-node-text .kite-text-body { height:auto; min-height:0; }
      .kite-node-text .kite-textarea { height:auto; min-height:56px; max-height:420px; resize:none; overflow-y:auto; field-sizing:content; }
      @supports not (field-sizing: content) {
        .kite-node-text .kite-textarea { height:auto; }
      }
      .kite-text-header { flex:0 0 auto; display:flex; align-items:center; gap:6px; height:36px; padding:0 8px; color:var(--text); font-weight:600; font-size:14px; }
      /* 关闭按钮始终跟随宽度贴右侧：标题占满剩余空间 */
      .kite-text-header .kite-node-title { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .kite-text-header .kite-text-close { margin-left:auto; }
      .kite-text-body { flex:1 1 auto; min-height:0; padding:0 10px 10px; }
      .kite-textarea { width:100%; height:100%; min-height:90px; box-sizing:border-box; resize:none; border:1px solid var(--border); border-radius:6px; padding:8px; background:rgba(0,0,0,.25); color:var(--text); font:13px/1.5 inherit; outline:none; }
      .kite-textarea:focus { border-color:var(--blue); box-shadow:0 0 0 2px rgba(var(--blue-rgb),.15); }
      .kite-output-port { position:absolute; right:-5px; top:50%; width:10px; height:10px; transform:translateY(-50%); box-sizing:content-box; padding:0; border:1px solid rgba(224,230,238,.7); border-radius:50%; background:rgba(126,155,190,.72); box-shadow:none; cursor:crosshair; z-index:5; opacity:0; transition:opacity .18s ease, background .18s ease, transform .18s ease; }
      .kite-node-text:hover .kite-output-port, .kite-output-port:hover, .kite-output-port.dragging { opacity:1; }
      .kite-output-port:hover { background:rgba(151,178,210,.86); transform:translateY(-50%) scale(1.12); }
      .kite-action-menu { position:fixed; z-index:10001; min-width:150px; padding:5px; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,0.5); }
      .kite-action-menu button { position:relative; display:block; width:100%; border:0; background:transparent; color:var(--text); text-align:left; padding:9px 11px 9px 22px; border-radius:4px; cursor:pointer; }
      .kite-action-menu button:hover { background:var(--bg-hover); }
      .kite-action-port { position:absolute; left:9px; top:50%; width:6px; height:6px; transform:translateY(-50%); box-sizing:border-box; border:1px solid rgba(224,232,228,.7); border-radius:50%; background:rgba(126,170,145,.72); box-shadow:none; }
      .kite-image-panel { position:absolute; z-index:10000; width:400px; max-width:min(480px,92vw); min-width:320px; min-height:240px; padding:16px; background:var(--bg-card); color:var(--text); border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,0.5); font:13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif; box-sizing:border-box; }
       .kite-panel-header { display:flex; align-items:center; justify-content:space-between; gap:8px; height:36px; margin:-16px -16px 14px; padding:0 8px; background:var(--bg-hover); border-bottom:1px solid var(--border); border-radius:8px 8px 0 0; cursor:move; }
       .kite-panel-header:active { cursor:grabbing; }
       .kite-panel-header h3 { margin:0; font-size:14px; font-weight:600; color:var(--text); }
       .kite-panel-close, .kite-text-close { flex:0 0 auto; border:0; background:none; color:var(--text2); cursor:pointer; font-size:13px; line-height:1; padding:2px 5px; border-radius:3px; }
       .kite-panel-close:hover, .kite-text-close:hover { color:var(--text); background:var(--border); }
       .kite-panel-resize { position:absolute; z-index:3; width:12px; height:12px; }
       .kite-panel-resize-nw { left:-6px; top:-6px; cursor:nwse-resize; } .kite-panel-resize-ne { right:-6px; top:-6px; cursor:nesw-resize; }
       .kite-panel-resize-se { right:-6px; bottom:-6px; cursor:nwse-resize; } .kite-panel-resize-sw { left:-6px; bottom:-6px; cursor:nesw-resize; }
      .kite-image-panel h3 { margin:0 0 14px; font-size:14px; font-weight:600; color:var(--text); }
      .kite-image-panel label { display:block; margin:10px 0 5px; color:var(--text2); font-size:11px; }
      .kite-image-panel input, .kite-image-panel select, .kite-image-panel textarea, .kite-textarea { transition:border-color .15s, box-shadow .15s; }
      .kite-image-panel input:focus, .kite-image-panel select:focus, .kite-image-panel textarea:focus, .kite-textarea:focus { border-color:var(--blue); box-shadow:0 0 0 2px rgba(var(--blue-rgb),.18); outline:none; }
      /* 下拉列表与整体风格统一：去掉原生外观，自定义箭头 */
      .kite-image-panel select { appearance:none; -webkit-appearance:none; -moz-appearance:none; cursor:pointer; padding-right:26px; border-radius:6px;
        background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23aeb9c9' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat:no-repeat; background-position:right 8px center; }
      .kite-image-panel select option { background:#1b2130; color:#e8edf5; }
      [data-theme="light"] .kite-image-panel select { background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23566a85' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E"); }
      [data-theme="light"] .kite-image-panel select option { background:#1b2130; color:#e8edf5; }
      /* ===== 输入框/下拉必须暗色系（不随主题变化）===== */
      .kite-image-panel input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=color]),
      .kite-image-panel select,
      .kite-image-panel .kite-textarea { background:#141a26 !important; color:#e8edf5 !important; border-color:rgba(255,255,255,.14); }
      .kite-image-panel input::placeholder, .kite-image-panel textarea::placeholder { color:rgba(232,237,245,.38); }
      .kite-image-panel select option { background:#1b2130; color:#e8edf5; }
      .kite-image-panel select option:checked { background:#25304a; }
      /* 生成类型/修改类型下拉：更宽更高 */
      .kite-image-panel .kite-panel-media-type { min-width:220px; width:100%; height:40px; }
      [data-theme="light"] .kite-image-panel select option { background:#1b2130; color:#e8edf5; }
      /* ===== 视觉对话框统一风格：label / 按钮 / 状态行 / 操作区 / textarea ===== */
      .kite-image-panel .kite-textarea { min-height:52px; border-radius:6px; }
      .kite-image-panel button { border:1px solid var(--border); border-radius:6px; padding:7px 12px; cursor:pointer; font:inherit; }
      .kite-image-panel .kite-panel-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
      .kite-image-panel .primary { background:var(--blue); border-color:var(--blue); color:#fff; font-weight:600; }
      .kite-image-panel .primary:hover { filter:brightness(1.1); }
      .kite-image-panel .kite-panel-status { margin-top:8px; font-size:12px; color:var(--text2); min-height:16px; }
      .kite-image-panel .kite-size-row { display:flex; align-items:center; gap:6px; }
      .kite-fit-size-btn { width:100%; margin-top:8px; padding:7px 10px; font-size:12px; color:var(--text2); background:var(--bg-hover); border:1px dashed var(--border); border-radius:6px; cursor:pointer; transition:border-color .15s, color .15s, background .15s; }
      .kite-fit-size-btn:hover { border-color:var(--blue); color:var(--text); }
      .kite-fit-size-btn:disabled { opacity:.6; cursor:wait; }
       .kite-image-panel .kite-panel-swap-size { position:relative; flex:0 0 30px; width:30px; height:30px; min-width:30px; padding:0; border-radius:4px; }
       .kite-panel-swap-size::before, .kite-panel-swap-size::after { content:''; position:absolute; left:8px; width:13px; height:7px; border:2px solid currentColor; opacity:.9; }
       .kite-panel-swap-size::before { top:6px; border-bottom:0; }
       .kite-panel-swap-size::after { bottom:6px; border-top:0; }
       .kite-panel-swap-size span::before, .kite-panel-swap-size span::after { position:absolute; display:block; content:''; width:0; height:0; border-style:solid; }
       .kite-panel-swap-size span::before { right:5px; top:5px; border-width:4px 0 4px 5px; border-color:transparent transparent transparent currentColor; }
       .kite-panel-swap-size span::after { left:5px; bottom:5px; border-width:4px 5px 4px 0; border-color:transparent currentColor transparent transparent; }
       .kite-panel-swap-size.kite-size-swapped { animation:kite-size-swap .28s ease-out; }
       @keyframes kite-size-swap { 50% { transform:rotate(180deg); } }
       .kite-image-panel.kite-panel-generating .kite-panel-status { display:flex; align-items:center; gap:7px; color:var(--text); }
       .kite-image-panel.kite-panel-generating .kite-panel-status::before { content:''; width:12px; height:12px; border:2px solid rgba(126,182,255,.3); border-top-color:#7eb6ff; border-radius:50%; animation:kite-render-spin .75s linear infinite; }
       .kite-image-panel.kite-panel-generating .kite-panel-generate { opacity:.65; cursor:wait; }
       @keyframes kite-render-spin { to { transform:rotate(360deg); } }
      .kite-image-panel .kite-size-row > div { flex:1; }
      .kite-image-panel .kite-panel-actions { display:flex; gap:8px; margin-top:16px; }
      .kite-image-panel button { flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-hover); color:var(--text); cursor:pointer; }
      .kite-image-panel .kite-panel-close { flex:0 0 auto; width:16px; height:16px; min-width:16px; padding:0; border:0; background:none; color:var(--text2); font-size:13px; line-height:16px; text-align:center; border-radius:3px; }
      .kite-image-panel .kite-panel-close:hover { color:var(--text); background:var(--border); }
      .kite-image-panel button.primary { background:rgba(var(--blue-rgb),0.6); border-color:rgba(var(--blue-rgb),0.8); }
      .kite-image-panel button.primary:hover { background:rgba(var(--blue-rgb),0.8); }
      .kite-image-panel .kite-panel-status { min-height:18px; margin-top:10px; color:var(--text2); font-size:12px; }
      /* ===== 图片修改对话框：左侧多图导入区 ===== */
      .kite-image-panel .kite-edit-rows { display:flex; flex-direction:column; gap:6px; max-height:216px; overflow-y:auto; padding-right:2px; }
      .kite-image-panel .kite-edit-empty { padding:14px 8px; border:1px dashed var(--border); border-radius:6px; color:var(--text2); font-size:11px; line-height:1.7; text-align:center; }
      .kite-image-panel .kite-edit-row { display:flex; align-items:center; gap:6px; }
      .kite-image-panel .kite-edit-thumb { flex:0 0 auto; width:54px; height:40px; object-fit:cover; border-radius:5px; border:1px solid var(--border); background:rgba(0,0,0,.3); cursor:zoom-in; display:block; }
      .kite-image-panel .kite-edit-num { flex:0 0 auto; min-width:46px; color:var(--text2); font-size:11px; }
      .kite-image-panel .kite-edit-at, .kite-image-panel .kite-edit-del { flex:0 0 auto; width:26px; padding:3px 0; border-radius:4px; font-size:11px; line-height:1.2; }
      .kite-image-panel .kite-edit-addrow { margin-top:6px; }
      .kite-image-panel .kite-edit-add { width:100%; padding:7px; border-style:dashed; font-size:12px; }
       .kite-aux-panel { position:absolute; z-index:10003; width:300px; min-width:240px; min-height:180px; padding:16px; background:var(--bg-card); color:var(--text); border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,0.5); box-sizing:border-box; font:13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif; }
       .kite-aux-panel .kite-aux-preview { min-height:120px; margin:4px 0 12px; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.22); border:1px solid var(--border); border-radius:6px; overflow:hidden; color:var(--text2); text-align:center; }
       .kite-aux-panel .kite-aux-preview img { display:block; max-width:100%; max-height:180px; object-fit:contain; cursor:zoom-in; }
       .kite-aux-panel .kite-aux-hint { color:var(--text2); font-size:12px; line-height:1.6; }
       .kite-aux-panel .kite-aux-actions { display:flex; gap:8px; margin-top:12px; }
       .kite-aux-panel button { flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-hover); color:var(--text); cursor:pointer; }
       .kite-aux-panel .kite-panel-close { flex:0 0 auto; width:16px; height:16px; min-width:16px; padding:0; border:0; background:none; color:var(--text2); font-size:13px; line-height:16px; text-align:center; border-radius:3px; }
       .kite-aux-panel .kite-panel-close:hover { color:var(--text); background:var(--border); }
       .kite-aux-panel button:hover { border-color:var(--blue); background:var(--border); }
       .kite-aux-panel button.primary { background:rgba(var(--blue-rgb),.6); border-color:rgba(var(--blue-rgb),.8); }
       .kite-aux-panel .kite-aux-prompt { width:100%; height:130px; min-height:90px; box-sizing:border-box; resize:vertical; }
       [data-theme="light"] .kite-aux-panel { background:#fff !important; border-color:rgba(60,100,160,.18) !important; box-shadow:0 8px 32px rgba(33,102,209,.12) !important; color:#1a1a1a !important; }
       [data-theme="light"] .kite-aux-panel .kite-aux-preview, [data-theme="light"] .kite-aux-panel button { background:#f5f9ff !important; border-color:rgba(60,100,160,.15) !important; color:#1a1a1a !important; }
       .kite-chat-panel { position:absolute; z-index:10000; width:auto; min-width:240px; max-width:760px; min-height:0; padding:16px; background:var(--bg-card); color:var(--text); border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,0.5); font:13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif; box-sizing:border-box; display:flex; flex-direction:column; }
       .kite-chat-panel .kite-chat-list { flex:1 1 auto; min-height:60px; overflow-x:auto; overflow-y:auto; display:flex; flex-direction:row; align-items:flex-start; gap:10px; padding:2px; margin-top:4px; }
       .kite-chat-group { display:flex; flex-direction:column; gap:4px; min-width:150px; flex:0 0 auto; }
       .kite-chat-item { width:100%; text-align:left; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-hover); color:var(--text); cursor:pointer; font:inherit; }
       .kite-chat-item:hover { background:var(--border); border-color:var(--blue); }
       .kite-chat-group-title { margin:8px 2px 2px; font-size:12px; font-weight:600; color:var(--text2); letter-spacing:1px; }
       .kite-chat-group-title:first-child { margin-top:0; }
       .kite-chat-empty { padding:14px 8px; text-align:center; color:var(--text2); line-height:1.6; }
       .kite-chat-panel .kite-panel-status { min-height:18px; margin-top:10px; color:var(--text2); font-size:12px; }
       /* ===== 改图面板：左侧两个输入小圆 ===== */
       .kite-edit-panel .kite-edit-in-port { width:14px; height:14px; left:-7px; background:var(--bg-card); border:2px solid var(--blue); z-index:5; cursor:crosshair; }
       .kite-edit-panel .kite-edit-prompt-port { top:86px; }
       .kite-edit-panel .kite-edit-images-port { top:calc(86px + 34px); border-color:#e0953f; }
       .kite-curve-in { stroke:rgba(224,149,63,.75); }
       .kite-edit-src-hint { color:var(--text2); font-weight:400; font-size:12px; }
       /* ===== 双击创建对话框（双栏：文本 | 视觉） ===== */
  .kite-dual-create-panel .kite-create-cols { display: flex; gap: 8px; min-height: 0; }
  .kite-dual-create-panel .kite-create-col { display: flex; flex-direction: column; min-width: 0; }
  .kite-dual-create-panel .kite-create-col-text { flex: 1.2; border-right: 1px solid var(--border); padding-right: 8px; }
  .kite-dual-create-panel .kite-create-col-visual { flex: 1; }
  .kite-dual-create-panel .kite-create-col-title { font-size: 12px; color: var(--text2); margin: 4px 0 6px; font-weight: 600; }
  /* 视觉栏已正式启用（此前🚧占位样式保留兼容，不再使用） */
  /* 双栏面板：加宽整体面板 */
  .kite-dual-create-panel.kite-chat-panel { min-width: 150px; width: min(200px, 90vw); }
  /* 双栏面板内：文本列表纵向排列（保持 左文本|右视觉 两列结构），列表加高20px */
  .kite-dual-create-panel .kite-chat-list { flex-direction: column; min-width: 0; min-height: 80px; }
  .kite-dual-create-panel .kite-chat-group { min-width: 0; width: 100%; }
  .kite-dual-create-panel .kite-chat-item { text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kite-dual-create-panel .kite-chat-model-settings { margin-top: 6px; border-style: dashed; color: var(--text2); }
  .kite-dual-create-panel .kite-chat-model-settings:hover { color: var(--text); border-color: var(--blue); }
  /* 双击弹出的三按钮工具条 */
       .kite-toolbar { position:absolute; z-index:10002; display:flex; gap:6px; padding:6px; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,0.5); }
       .kite-toolbar button { border:1px solid var(--border); border-radius:6px; background:var(--bg-hover); color:var(--text); padding:7px 12px; cursor:pointer; white-space:nowrap; font-size:13px; }
       .kite-toolbar button:hover { background:var(--border); border-color:var(--blue); }
      /* ===== 浅色主题适配（与对话框风格统一） ===== */
      [data-theme="light"] .kite-node { background:#fff !important; border-color:rgba(60,100,160,.18) !important; box-shadow:0 8px 32px rgba(33,102,209,.12), 0 2px 8px rgba(33,102,209,.08) !important; color:#1a1a1a !important; }
      [data-theme="light"] .kite-node-bar { background:#f5f9ff !important; border-bottom-color:rgba(60,100,160,.15) !important; }
      [data-theme="light"] .kite-node-title { color:#1a1a1a !important; }
      [data-theme="light"] .kite-node-actions button { color:#5a6b85 !important; }
      [data-theme="light"] .kite-node-actions button:hover { background:rgba(60,100,160,.12) !important; color:#333 !important; }
      [data-theme="light"] .kite-node-text { background:#fff !important; border-color:rgba(60,100,160,.18) !important; }
      [data-theme="light"] .kite-text-header { color:#1a1a1a !important; }
      [data-theme="light"] .kite-textarea { background:rgba(255,255,255,.9) !important; color:#333 !important; border-color:rgba(60,100,160,.25) !important; }
      [data-theme="light"] .kite-image-panel { background:#fff !important; border-color:rgba(60,100,160,.18) !important; box-shadow:0 8px 32px rgba(33,102,209,.12) !important; color:#1a1a1a !important; }
      [data-theme="light"] .kite-panel-header { background:#f5f9ff !important; border-bottom-color:rgba(60,100,160,.15) !important; }
      [data-theme="light"] .kite-panel-header h3 { color:#1a1a1a !important; }
      [data-theme="light"] .kite-panel-close, [data-theme="light"] .kite-text-close { color:#5a6b85 !important; }
      [data-theme="light"] .kite-panel-close:hover, [data-theme="light"] .kite-text-close:hover { background:rgba(60,100,160,.12) !important; color:#333 !important; }
      [data-theme="light"] .kite-image-panel label { color:#5a6b85 !important; }
      [data-theme="light"] .kite-image-panel input { background:rgba(255,255,255,.9) !important; color:#333 !important; border-color:rgba(60,100,160,.25) !important; }
      /* 下拉列表保持暗色系：去掉白色背景 */
      [data-theme="light"] .kite-image-panel button { background:#f5f9ff !important; border-color:rgba(60,100,160,.15) !important; color:#1a1a1a !important; }
      [data-theme="light"] .kite-image-panel button.primary { background:#2166d1 !important; border-color:#6da5ed !important; color:#fff !important; }
      [data-theme="light"] .kite-image-panel .kite-panel-status { color:#5a6b85 !important; }
      [data-theme="light"] .kite-image-panel .kite-edit-empty { border-color:rgba(60,100,160,.25) !important; color:#5a6b85 !important; }
      [data-theme="light"] .kite-image-panel .kite-edit-thumb { background:#eef3fb !important; }
      [data-theme="light"] .kite-image-panel .kite-edit-at { background:#2166d1 !important; border-color:#6da5ed !important; color:#fff !important; }
      [data-theme="light"] .kite-chat-panel { background:#fff !important; border-color:rgba(60,100,160,.18) !important; box-shadow:0 8px 32px rgba(33,102,209,.12) !important; color:#1a1a1a !important; }
      [data-theme="light"] .kite-chat-item { background:#f5f9ff !important; border-color:rgba(60,100,160,.15) !important; color:#1a1a1a !important; }
      [data-theme="light"] .kite-chat-item:hover { background:rgba(60,100,160,.12) !important; border-color:#2166d1 !important; }
      [data-theme="light"] .kite-chat-group-title { color:#5a6b85 !important; }
      [data-theme="light"] .kite-chat-empty { color:#8a9bb5 !important; }
      [data-theme="light"] .kite-dual-create-panel .kite-create-col-text { border-right-color:rgba(60,100,160,.15) !important; }
      [data-theme="light"] .kite-dual-create-panel .kite-create-col-title { color:#5a6b85 !important; }
      [data-theme="light"] .kite-toolbar { background:#fff !important; border-color:rgba(60,100,160,.18) !important; box-shadow:0 8px 32px rgba(33,102,209,.12) !important; }
      [data-theme="light"] .kite-toolbar button { background:#f5f9ff !important; border-color:rgba(60,100,160,.15) !important; color:#1a1a1a !important; }
      [data-theme="light"] .kite-toolbar button:hover { background:rgba(60,100,160,.12) !important; border-color:#2166d1 !important; }
      [data-theme="light"] .kite-action-menu { background:#fff !important; border-color:rgba(60,100,160,.18) !important; box-shadow:0 8px 32px rgba(33,102,209,.12) !important; }
      [data-theme="light"] .kite-action-menu button { color:#1a1a1a !important; }
      [data-theme="light"] .kite-action-menu button:hover { background:#f5f9ff !important; }
    `;
    const style = document.createElement('style');
    style.id = 'kite-base-styles';
    style.textContent = css + `
      /* Unified ports override legacy node and panel port styles. */
      .kite-curve { stroke:rgba(91,122,156,.64) !important; stroke-width:3 !important; stroke-dasharray:10 7 !important; animation:kite-flow 1.1s linear infinite; }
      /* 悬停/删除时停止流动并切换为高亮实线 */
      .kite-curve:hover, .kite-curve.kite-link-deleting { stroke-dasharray:none !important; animation:none; }
      .kite-curve:hover { filter:drop-shadow(0 0 6px rgba(126,182,255,.65)) !important; }
      .kite-curve:hover, .kite-curve.kite-link-deleting { stroke-width:5 !important; }
      .kite-curve:hover { stroke:#7eb6ff !important; }
      .kite-curve.kite-link-deleting { stroke:#ff5a6e !important; }
      .kite-port, .kite-panel-in-port, .kite-panel-out-port, .kite-node-in-port, .kite-node-out-port, .kite-output-port { position:absolute; top:50%; width:7px; height:7px; box-sizing:content-box; padding:0; transform:translateY(-50%); border:1px solid rgba(224,230,238,.7); border-radius:50%; box-shadow:none; cursor:crosshair; z-index:6; opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease, background .18s ease; }
      .kite-port-in, .kite-panel-in-port, .kite-node-in-port { left:-4px; right:auto; background:rgba(126,170,145,.72); }
      .kite-port-out, .kite-panel-out-port, .kite-node-out-port, .kite-output-port { right:-4px; left:auto; background:rgba(126,155,190,.72); }
      .kite-node:hover .kite-port, .kite-image-panel:hover .kite-port, .kite-node:hover .kite-node-in-port, .kite-node:hover .kite-node-out-port, .kite-image-panel:hover .kite-panel-in-port, .kite-image-panel:hover .kite-panel-out-port, .kite-port:hover, .kite-port.dragging, .kite-node-in-port:hover, .kite-node-out-port:hover, .kite-panel-in-port:hover, .kite-panel-out-port:hover, .kite-output-port:hover, .kite-output-port.dragging { opacity:1; pointer-events:auto; }
      .kite-port:hover, .kite-port.dragging, .kite-node-in-port:hover, .kite-node-out-port:hover, .kite-panel-in-port:hover, .kite-panel-out-port:hover, .kite-output-port:hover, .kite-output-port.dragging { transform:translateY(-50%) scale(1.12); box-shadow:0 0 4px rgba(150,175,205,.45); }
      .kite-port.dragging, .kite-panel-out-port.dragging, .kite-output-port.dragging { background:#fff; }
    `;
    document.head.appendChild(style);
  }

  // ---------- 画布事件：背景点击取消选中 ----------
  function bindCanvasEvents() {
    state.canvas.addEventListener('mousedown', (e) => {
      if (e.target === state.canvas || e.target === state.svg) {
        state.canvas.querySelectorAll('.kite-node').forEach(n => n.classList.remove('selected'));
      }
    });
  }

  // ---------- 双击画布双面板：右=创建对话框 · 左=文生图 ----------
  // 说明：两个面板都挂在 canvasContent 内，随画布平移；标题栏可拖动、八方向可缩放、✕可关闭。
  // 可扩展：注册表 dualPanelBuilders，后续新分类（如视频生成）只需注册一个构造函数即可。
  // ===== 画布节点默认尺寸（private/用户设置/user_settings.json） =====
  // 每种画布模块单独保存为一个 JSON 对象；用户缩放后，后续创建的同类模块沿用该尺寸。
  const KITE_DEFAULT_SIZES_KEY = 'zf3d_kite_default_sizes_v4'; // v4：视觉面板重设计宽高（文生图400x560/图片修改380x500/提示词320x240/识图400x420）；旧尺寸记录作废
  const KITE_DEFAULT_SIZES = {
    prompt: { w: 320, h: 240, minW: 160, minH: 120 },
    imagePanel: { w: 400, h: 560, minW: 320, minH: 260 }, // 文生图/视频面板
    editPanel: { w: 380, h: 500, minW: 320, minH: 260 }, // 图片修改面板
    visionPanel: { w: 400, h: 420, minW: 320, minH: 240 }, // 识图面板
    image: { w: 360, h: 270, minW: 140, minH: 105 },
  };

  // ---- 写回共享命名空间 ----
  var __defs = {KITE_DEFAULT_SIZES: KITE_DEFAULT_SIZES, KITE_DEFAULT_SIZES_KEY: KITE_DEFAULT_SIZES_KEY, bezierPath: bezierPath, bindCanvasEvents: bindCanvasEvents, init: init, injectBaseStyles: injectBaseStyles, state: state};
  for (var __k in __defs) NS[__k] = __defs[__k];
})();
