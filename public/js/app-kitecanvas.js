/* ============================================================
 * app-kitecanvas.js  -  Kite 风格画布模块
 * 当前版本专用：可拖拽节点（图片/视频）、自由曲线连接
 * 全局挂在 window.KiteCanvas，agent 调用 window.KiteCanvas.addNode()
 * ============================================================ */
(function () {
  'use strict';

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
  .kite-dual-create-panel .kite-visual-list { display: flex; flex-direction: column; gap: 6px; }
  /* 🚧 整个视觉栏标注开发中：整栏置灰、禁点击 */
  .kite-dual-create-panel .kite-create-col-visual.kite-col-dev { opacity: .55; pointer-events: auto; }
  .kite-dual-create-panel .kite-create-col-visual.kite-col-dev .kite-visual-list button { cursor: not-allowed; }
  .kite-dual-create-panel .kite-create-col-visual.kite-col-dev .kite-visual-list button:hover { filter: none; background: transparent; }
  .kite-dev-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 400; color: #ffb45c; background: rgba(255,180,92,.12); vertical-align: middle; }
  /* 双栏面板：加宽整体面板 */
  .kite-dual-create-panel.kite-chat-panel { min-width: 560px; }
  /* 双栏面板内：文本列表纵向排列（保持 左文本|右视觉 两列结构），列表加高20px */
  .kite-dual-create-panel .kite-chat-list { flex-direction: column; min-width: 0; min-height: 80px; }
  .kite-dual-create-panel .kite-visual-list { min-height: 80px; }
  .kite-dual-create-panel .kite-chat-group { min-width: 0; width: 100%; }
  .kite-dual-create-panel .kite-chat-item { text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  function getKiteDefaultSize(kind) {
    const fallback = KITE_DEFAULT_SIZES[kind] || KITE_DEFAULT_SIZES.image;
    try {
      const raw = window.UserSettings && UserSettings.get(KITE_DEFAULT_SIZES_KEY);
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const value = saved && saved[kind];
      const w = Number(value && value.w), h = Number(value && value.h);
      if (Number.isFinite(w) && Number.isFinite(h)) {
        return { w: Math.max(fallback.minW, Math.round(w)), h: Math.max(fallback.minH, Math.round(h)) };
      }
    } catch (e) {}
    return { w: fallback.w, h: fallback.h };
  }
  function saveKiteDefaultSize(kind, width, height) {
    const fallback = KITE_DEFAULT_SIZES[kind];
    if (!fallback || !window.UserSettings) return;
    const w = Math.max(fallback.minW, Math.round(Number(width) || 0));
    const h = Math.max(fallback.minH, Math.round(Number(height) || 0));
    if (!w || !h) return;
    try {
      const raw = UserSettings.get(KITE_DEFAULT_SIZES_KEY);
      const sizes = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      sizes[kind] = { w, h };
      UserSettings.set(KITE_DEFAULT_SIZES_KEY, JSON.stringify(sizes));
    } catch (e) {}
  }

  // ===== 文生图设置持久化（private/用户设置/user_settings.json，localStorage 仅作缓存）=====
  // 键: zf3d_image_w / zf3d_image_h / zf3d_image_model（与设置面板 renderImageModelSelect 共用 zf3d_image_model）
  function loadImagePanelSettings(panel) {
    try {
      var w = UserSettings.get('zf3d_image_w'); var h = UserSettings.get('zf3d_image_h');
      if (w) panel.querySelector('.kite-panel-width').value = w;
      if (h) panel.querySelector('.kite-panel-height').value = h;
    } catch (e) {}
  }
  function saveImagePanelSettings(panel) {
    try {
      UserSettings.set('zf3d_image_w', String(panel.querySelector('.kite-panel-width').value || '1024'));
      UserSettings.set('zf3d_image_h', String(panel.querySelector('.kite-panel-height').value || '1024'));
      UserSettings.set('zf3d_image_model', panel.querySelector('.kite-panel-model').value || '');
    } catch (e) {}
  }

  function bindImagePanelControls(panel) {
    const widthInput = panel.querySelector('.kite-panel-width');
    const heightInput = panel.querySelector('.kite-panel-height');
    // 视频选项（时长/帧率）：仅在生成类型为视频时显示
    const mediaTypeSel = panel.querySelector('.kite-panel-media-type');
    const videoOpts = panel.querySelector('.kite-video-opts');
    function syncVideoOpts() {
      if (videoOpts) videoOpts.style.display = (mediaTypeSel && mediaTypeSel.value === 'video') ? '' : 'none';
    }
    if (mediaTypeSel && videoOpts) {
      mediaTypeSel.addEventListener('change', syncVideoOpts);
      syncVideoOpts();
    }
    const swapButton = panel.querySelector('.kite-panel-swap-size');
    if (swapButton && widthInput && heightInput) {
      swapButton.addEventListener('click', () => {
        const width = widthInput.value;
        widthInput.value = heightInput.value;
        heightInput.value = width;
        swapButton.classList.remove('kite-size-swapped');
        requestAnimationFrame(() => swapButton.classList.add('kite-size-swapped'));
      });
    }
    // ⤢ 自适应尺寸：读取参考图（修改面板）或原图的实际像素，自动填入宽高输入框
    const fitBtn = panel.querySelector('.kite-fit-size-btn');
    if (fitBtn && widthInput && heightInput) {
      fitBtn.addEventListener('click', async () => {
        const status = panel.querySelector('.kite-panel-status');
        const prevText = status ? status.textContent : '';
        // 来源优先级：修改面板连入的参考图 > 面板连线图片节点 > 最近查看的图片
        let srcs = [];
        try { srcs = (typeof panel.collectEditInputs === 'function') ? (panel.collectEditInputs().images || []) : []; } catch (e) {}
        if (!srcs.length && panel._imageNodes && panel._imageNodes.length) {
          srcs = panel._imageNodes.map(id => { const nd = state.nodes.get(id); const img = nd && nd.el && nd.el.querySelector('.kite-node-media img'); return img ? img.src : ''; }).filter(Boolean);
        }
        if (!srcs.length && panel._imageNode && state.nodes.has(panel._imageNode.id)) {
          const nd = state.nodes.get(panel._imageNode.id);
          const img = nd && nd.el && nd.el.querySelector('.kite-node-media img');
          if (img && img.src) srcs = [img.src];
        }
        if (!srcs.length && window.ImageViewer && ImageViewer._lastUrl) srcs = [ImageViewer._lastUrl];
        if (!srcs.length) {
          if (status) status.textContent = '请先连入参考图或先生成一张图片';
          return;
        }
        fitBtn.disabled = true;
        try {
          const dims = await Promise.all(srcs.slice(0, 6).map(src => new Promise(resolve => {
            const im = new Image();
            im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = () => resolve(null);
            im.src = src;
          })));
          const ok = dims.filter(Boolean);
          if (!ok.length) throw new Error('无法读取图片尺寸');
          // 多张取最大值；单张取原图像素
          const w = Math.max(...ok.map(d => d.w));
          const h = Math.max(...ok.map(d => d.h));
          const cw = Math.min(4096, Math.max(64, Math.round(w)));
          const ch = Math.min(4096, Math.max(64, Math.round(h)));
          widthInput.value = String(cw);
          heightInput.value = String(ch);
          if (status) status.textContent = '已按图片实际尺寸填充：' + cw + '×' + ch;
        } catch (err) {
          if (status) status.textContent = err.message || '读取图片尺寸失败';
        } finally {
          fitBtn.disabled = false;
          if (status) setTimeout(() => { if (status.textContent.indexOf('已按图片实际尺寸') === 0 || status.textContent === '请先连入参考图或先生成一张图片') status.textContent = prevText; }, 3500);
        }
      });
    }
  }

  function setImagePanelGenerating(panel, generating, message) {
    const status = panel.querySelector('.kite-panel-status');
    const button = panel.querySelector('.kite-panel-generate');
    panel.classList.toggle('kite-panel-generating', generating);
    if (button) button.disabled = generating;
    if (status) status.textContent = message || (generating ? '正在渲染图片...' : '');
  }
  // ===== 图片修改面板：多图导入 + 按视觉顺序编号（上→下、左→右）+ @图片N 引用 =====
  function normalizeDataUrl(value) {
    return String(value || '');
  }
  function insertAtRef(promptEl, n) {
    var el = promptEl;
    var tag = '@图片' + n;
    var pos = (el && typeof el.selectionStart === 'number') ? el.selectionStart : (el ? el.value.length : 0);
    if (el) {
      var before = el.value.slice(0, pos), after = el.value.slice(pos);
      var glue = (!before || /[\s，。,、]$/.test(before)) ? '' : '';
      el.value = before + glue + tag + after;
      try { el.focus(); el.setSelectionRange(pos + tag.length, pos + tag.length); } catch (e2) {}
    }
  }
  function renderEditRows(panel) {
    var rowsBox = panel.querySelector('.kite-edit-rows');
    var countLabel = panel.querySelector('.kite-edit-count');
    var srcs = panel._editImages || [];
    var html = '';
    for (var i = 0; i < srcs.length; i++) {
      html += '<div class="kite-edit-row" draggable="true">'
        + '<img class="kite-edit-thumb" alt="参考图' + (i + 1) + '" title="双击放大查看（图片' + (i + 1) + '）">'
        + '<span class="kite-edit-num">图片' + (i + 1) + '</span>'
        + '<button type="button" class="kite-edit-at" title="在提示词光标处插入引用">@</button>'
        + '<button type="button" class="kite-edit-del" title="移除此图">✕</button></div>';
    }
    if (!srcs.length) {
      html = '<div class="kite-edit-empty">点击下方按钮导入 1~8 张图片<br>按 上→下、左→右 的选择顺序自动编号<br>提示词中用 @图片N 引用对应图片</div>';
    }
    rowsBox.innerHTML = html;
    var thumbs = rowsBox.querySelectorAll('.kite-edit-thumb');
    for (var t = 0; t < thumbs.length; t++) {
      thumbs[t].src = srcs[t];
      thumbs[t].addEventListener('dblclick', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (window.ImageViewer) ImageViewer.show(e.target.src);
      });
    }
    Array.prototype.forEach.call(rowsBox.querySelectorAll('.kite-edit-row'), function (row, idx) {
      row.querySelector('.kite-edit-at').addEventListener('click', function () {
        insertAtRef(panel.querySelector('.kite-panel-prompt'), idx + 1);
      });
      row.querySelector('.kite-edit-del').addEventListener('click', function () {
        panel._editImages.splice(idx, 1); renderEditRows(panel);
      });
      row.addEventListener('dragstart', function (e) { panel._dragEditIndex = idx; try { e.dataTransfer.setData('text/plain', String(idx)); } catch (e2) {} });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = (typeof panel._dragEditIndex === 'number') ? panel._dragEditIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
        var to = idx;
        panel._dragEditIndex = null;
        if (isNaN(from) || from === to || from < 0 || from >= srcs.length) return;
        var moved = panel._editImages.splice(from, 1)[0];
        panel._editImages.splice(to, 0, moved);
        renderEditRows(panel);
      });
    });
    if (countLabel) {
      countLabel.textContent = srcs.length ? ('共 ' + srcs.length + ' 张：' + srcs.map(function (_, i2) { return '图片' + (i2 + 1); }).join(' ')) : '';
    }
  }
  function readFilesAsDataUrls(files, panel) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return f.type && f.type.indexOf('image/') === 0; }).slice(0, 8);
    if (!list.length) return;
    var pending = list.length;
    Array.prototype.forEach.call(list, function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try { panel._editImages.push(normalizeDataUrl(reader.result)); } catch (e) {}
        pending--;
        if (pending <= 0) renderEditRows(panel);
      };
      reader.onerror = function () { pending--; if (pending <= 0) renderEditRows(panel); };
      reader.readAsDataURL(file);
    });
  }
  function bindImageEditControls(panel) {
    panel._editImages = [];
    panel._dragEditIndex = null;
    var fileInput = panel.querySelector('.kite-edit-file');
    var addBtn = panel.querySelector('.kite-edit-add');
    addBtn.addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
    fileInput.addEventListener('change', function () { readFilesAsDataUrls(fileInput.files, panel); });
    panel.querySelector('.kite-edit-clear').addEventListener('click', function () { panel._editImages = []; renderEditRows(panel); });
    var promptEl = panel.querySelector('.kite-panel-prompt');
    ['paste', 'drop'].forEach(function (type) {
      promptEl.addEventListener(type, function (ev) {
        var dt = ev.clipboardData || ev.dataTransfer;
        if (dt && dt.files && dt.files.length) {
          ev.preventDefault();
          readFilesAsDataUrls(dt.files, panel);
          setTimeout(function(){ renderEditRows(panel); }, 350);
        }
      });
    });
    renderEditRows(panel);
  }
  // ===== 视觉模型联动：从 Models.list 的 imageGen 模型动态填充下拉（与设置面板/对话面板一致）=====
  function fillImageModelSelect(select) {
    var saved = '';
    try { saved = UserSettings.get('zf3d_image_model') || ''; } catch (e) {}
    var html = '<option value="pollinations">Pollinations（免费默认）</option><option value="siliconflow">SiliconFlow</option><option value="zhipu">智谱 GLM</option>';
    var list = [];
    try { list = (window.Models && Models.list ? Models.list : []).filter(function (m) { return m.imageGen; }); } catch (e) {}
    list.forEach(function (m) {
      var value = m.modelId || m.id || '';
      html += '<option value="' + String(value).replace(/"/g, '&quot;') + '">' + String(m.name || value).replace(/[<>&]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]; }) + '</option>';
    });
    select.innerHTML = html;
    if (saved) {
      select.value = saved;
      // 视觉模型后来才加上/改名导致保存值不在列表里时，补一个选项避免丢失
      if (select.value !== saved) {
        var opt = document.createElement('option');
        opt.value = saved; opt.textContent = saved;
        select.appendChild(opt); select.value = saved;
      }
    }
  }
  // ---------- 面板 ↔ 图片节点的持久连线 ----------
  // 连线两端始终贴住：面板右侧小圆点 和 图片节点左侧小圆点，随面板/节点移动实时更新
  function panelPortCenter(panel) {
    const host = panel.offsetParent || state.canvas;
    const pr = panel.getBoundingClientRect(), hr = host.getBoundingClientRect();
    return { x: pr.right - hr.left, y: pr.top - hr.top + pr.height / 2 };
  }
  function nodePortCenter(node, side) {
    // 修复：统一用 getBoundingClientRect 换算到画布坐标系（考虑画布平移/缩放），保证连线端点贴住小圆点
    if (node && node.el && state.canvas) {
      const hr = state.canvas.getBoundingClientRect();
      const nr = node.el.getBoundingClientRect();
      const x = side === 'in' ? nr.left - hr.left : nr.right - hr.left;
      return { x, y: nr.top - hr.top + nr.height / 2 };
    }
    return side === 'in'
      ? { x: node.x, y: node.y + node.h / 2 }
      : { x: node.x + node.w, y: node.y + node.h / 2 };
  }
  function refreshPanelLink(panel) {
    const path = panel._linkPath;
    const node = panel._imageNode;
    // 【修复】节点被删除时立即清掉残留连线，而不是默默不刷新
    if (path && (!node || !state.nodes.has(node.id) || !document.body.contains(panel))) {
      path.remove(); panel._linkPath = null; panel._imageNode = null;
      return;
    }
    if (!path || !node) return;
    const a = panelPortCenter(panel);
    const b = nodePortCenter(state.nodes.get(node.id), 'in');
    path.setAttribute('d', bezierPath(a.x, a.y, b.x, b.y));
  }
  function refreshSourceLink(panel) {
    const path = panel._sourceLinkPath;
    const node = panel._sourceNode;
    // 【修复】来源节点或面板被关闭时立即清理连线
    if (path && (!node || !state.nodes.has(node.id) || !panel.isConnected)) {
      path.remove(); panel._sourceLinkPath = null; panel._sourceNode = null;
      if (typeof panel._sourcePromptCleanup === 'function') panel._sourcePromptCleanup();      return;
    }
    if (!path || !node) return;
    const a = nodePortCenter(node, 'out');
    const pr = panel.getBoundingClientRect();
    const hr = (panel.offsetParent || state.canvas).getBoundingClientRect();
    const b = { x: pr.left - hr.left, y: pr.top - hr.top + pr.height / 2 };
    path.setAttribute('d', bezierPath(a.x, a.y, b.x, b.y));
  }
  function bindSourcePrompt(panel, sourceNode, sourceLinkPath) {
    const prompt = panel.querySelector('.kite-panel-prompt');
    if (!prompt || !sourceNode) return;
    panel._sourceNode = sourceNode;
    panel._sourceLinkPath = sourceLinkPath || null;
    prompt.value = sourceNode.text || '';
    prompt.disabled = true;
    prompt.title = '此提示词由关联的提示词节点提供';
    const sourceInput = sourceNode.el.querySelector('.kite-textarea');
    const syncPrompt = () => { prompt.value = sourceNode.text || ''; };
    if (sourceInput) sourceInput.addEventListener('input', syncPrompt);
    panel._sourcePromptCleanup = () => {
      if (sourceInput) sourceInput.removeEventListener('input', syncPrompt);
      if (panel._sourceLinkPath) { panel._sourceLinkPath.remove(); panel._sourceLinkPath = null; }
      panel._sourcePromptCleanup = null; // 防止重复触发
    };
    refreshSourceLink(panel);
  }
  // 面板被拖动/缩放时刷新连线（bindPanelWindow 内部会改 left/top/width/height）
  // 【重构】统一注册中心：全局只挂 1 个 rAF 节流的 mousemove + 缩放/平移/resize 监听，
  // 所有面板的连线刷新函数集中到这里，替代原来每个面板各挂一个监听器的做法。
  const _panelRefreshers = new Set();
  let _refreshQueued = false;
  function scheduleAllPanelRefresh() {
    if (_refreshQueued) return;
    _refreshQueued = true;
    requestAnimationFrame(() => {
      _refreshQueued = false;
      _panelRefreshers.forEach(fn => { try { fn(); } catch (e) {} });
    });
  }
  function registerPanelRefresher(panel, fn) {
    _panelRefreshers.add(fn);
    if (!panel) return fn;
    panel._unregisterPanelRefresher = () => _panelRefreshers.delete(fn);
    return fn;
  }
  // 全局初始化一次（懒加载，首次注册时挂监听）
  function ensureGlobalLinkListeners() {
    if (ensureGlobalLinkListeners._done) return;
    ensureGlobalLinkListeners._done = true;
    document.addEventListener('mousemove', scheduleAllPanelRefresh);
    window.addEventListener('resize', scheduleAllPanelRefresh);
    // 滚轮缩放 / 触摸板滚动：画布 transform 变化后统一刷新所有连线
    const canvasHost = document.getElementById('canvasContent') || document.body;
    canvasHost.addEventListener('wheel', () => {
      scheduleAllPanelRefresh();
      // 再补两帧，覆盖惯性滚动结束后位置
      setTimeout(scheduleAllPanelRefresh, 60);
      setTimeout(scheduleAllPanelRefresh, 180);
    }, { passive: true });
    // 平移通常由 pointer 拖拽完成，mousemove 已覆盖；touch 结束也兜底一次
    canvasHost.addEventListener('touchend', scheduleAllPanelRefresh, { passive: true });

    // ---------- 连线交互：右键/Alt+点击 删除任意连线（含视觉面板连线），悬停高亮走 CSS ----------
    const svgEl = state.svg;
    function deleteLinkPath(p) {
      if (!p || !p.parentNode) return;
      // 清理节点引用
      const f = p.dataset && p.dataset.from, t = p.dataset && p.dataset.to;
      [f, t].forEach(id => {
        if (!id || id === 'panel') return;
        const n = state.nodes.get(id);
        if (n && n._nodeLinks) n._nodeLinks = n._nodeLinks.filter(x => x !== p);
      });
      // 面板持有的连线引用
      document.querySelectorAll('.kite-image-panel').forEach(pl => {
        if (pl._linkPath === p) pl._linkPath = null;
        if (pl._sourceLinkPath === p) pl._sourceLinkPath = null;
        if (pl._visionLinkPath === p) pl._visionLinkPath = null;
        if (Array.isArray(pl._visionSources)) pl._visionSources = pl._visionSources.filter(s => s.id !== f);
      });
      p.remove();
    }
    function showLinkMenu(e, p) {
      e.preventDefault(); e.stopPropagation();
      svgEl.querySelectorAll('.kite-link-menu').forEach(m => m.remove());
      const menu = document.createElement('div');
      menu.className = 'kite-link-menu';
      menu.innerHTML = '<button type="button" data-act="del">🗑️ 删除连线</button>';
      menu.querySelector('button').addEventListener('click', () => { deleteLinkPath(p); menu.remove(); });
      document.body.appendChild(menu);
      menu.style.left = Math.min(e.clientX, window.innerWidth - 140) + 'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight - 60) + 'px';
      setTimeout(() => {
        const dismiss = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
        document.addEventListener('mousedown', dismiss);
      }, 0);
    }
    svgEl.addEventListener('contextmenu', e => {
      const p = e.target.closest && e.target.closest('.kite-curve');
      if (!p) return;
      showLinkMenu(e, p);
    });
    svgEl.addEventListener('mousedown', e => {
      const p = e.target.closest && e.target.closest('.kite-curve');
      if (!p || !e.altKey || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      deleteLinkPath(p);
    });
  }
  function observePanelMove(panel) {
    ensureGlobalLinkListeners();
    const refresh = () => {
      if (document.body.contains(panel)) {
        refreshPanelLink(panel);
        refreshSourceLink(panel);
      } else {
        if (panel._unregisterPanelRefresher) panel._unregisterPanelRefresher();
      }
    };
    registerPanelRefresher(panel, refresh);
    panel._linkObserver = refresh; // 兼容旧的移除逻辑
    scheduleAllPanelRefresh();
  }

  // 从文生图面板两侧端口拉出辅助面板：左侧编辑/创建提示词；右侧(查看)统一改为打开浮动图片查看窗。
  function openImageAuxPanel(kind, imagePanel, host, clientX, clientY) {
    // 图片查看：与其他图片面板统一，直接弹出右侧浮动小图查看窗（可拖拽/调尺寸/记忆）
    if (kind === 'viewer') {
      if (window.ImageViewer) ImageViewer.show(ImageViewer._lastUrl);
      return null;
    }    const old = host.querySelector('.kite-aux-panel[data-aux-kind="' + kind + '"]');
    if (old) old.remove();
    const panel = document.createElement('section');
    panel.className = 'kite-aux-panel';
    panel.dataset.auxKind = kind;
    const title = '✎ 提示词';
    {
      const initial = imagePanel.querySelector('.kite-panel-prompt').value || '';
      panel.innerHTML = '<div class="kite-panel-header"><h3>' + title + '</h3><button type="button" class="kite-panel-close" title="关闭">✕</button></div>' +
        '<label>提示词内容</label><textarea class="kite-textarea kite-aux-prompt" placeholder="输入图片描述或创作提示词"></textarea>' +
        '<div class="kite-aux-hint">创建后会在画布上生成一个提示词节点，可继续连接到文生图面板。</div>' +
        '<div class="kite-aux-actions"><button type="button" class="kite-aux-cancel">取消</button><button type="button" class="primary kite-aux-create">创建提示词</button></div>';
      panel.querySelector('.kite-aux-prompt').value = initial;
      panel.querySelector('.kite-aux-create').addEventListener('click', () => {
        const text = panel.querySelector('.kite-aux-prompt').value.trim();
        if (!text) { panel.querySelector('.kite-aux-hint').textContent = '请输入提示词内容'; return; }
        const hr = host.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        addNode({ type: 'text', text, x: clientX - hr.left - pr.width - 40, y: clientY - hr.top - 80 });
        panel.remove();
      });
      panel.querySelector('.kite-aux-cancel').addEventListener('click', () => panel.remove());
    }
    const hr = host.getBoundingClientRect();
    // 统一管线：对话框/面板直接出现在鼠标释放的位置（视口坐标转画布坐标）
    panel.style.left = Math.max(8, clientX - hr.left) + 'px';
    panel.style.top = Math.max(8, clientY - hr.top) + 'px';
    host.appendChild(panel);
    ['mousedown', 'click', 'dblclick'].forEach(type => panel.addEventListener(type, e => e.stopPropagation()));
    panel.querySelector('.kite-panel-close').addEventListener('click', () => panel.remove());
    bindPanelWindow(panel);
    return panel;
  }

  // ========= 统一端口拉线管线 =========
  // 已抽离为独立文件 public/js/app-kiteportlink.js（window.KitePortLink）。
  // 端口拉线交互统一调用 KitePortLink.bind(port, onRelease)。
  function bindPortLinkDrag(port, onRelease) {
    if (!(window.KitePortLink && typeof KitePortLink.bind === 'function')) {
      console.warn('[KiteCanvas] 缺少 app-kiteportlink.js，端口拉线功能不可用');
      return;
    }
    KitePortLink.bind(port, onRelease);
  }

  function bindAuxPort(port, kind, imagePanel, host) {
    bindPortLinkDrag(port, (_p, _canvasPos, vp) => {
      openImageAuxPanel(kind, imagePanel, host, vp.x, vp.y);
    });
  }

  const dualPanelBuilders = new Map([
    ['image', function (host, anchor, origin) {
      const panel = document.createElement('section');
      panel.className = 'kite-image-panel';
      panel.innerHTML = `<div class="kite-panel-header"><h3>🖼️ 文生图</h3><button type="button" class="kite-panel-close" title="关闭">✕</button></div>
        <label>提示词</label><textarea class="kite-textarea kite-panel-prompt" style="height:76px;min-height:76px;resize:vertical" placeholder="描述你想生成的图片或视频"></textarea>
        <label>生成类型</label><select class="kite-panel-media-type"><option value="image">🖼️ 图片</option><option value="video">🎬 视频</option></select>
        <div class="kite-video-opts" style="display:none">
          <label>视频时长 / 帧率</label><div class="kite-size-row"><div><input class="kite-panel-duration" type="number" min="1" max="30" step="0.5" value="5" title="时长（秒）" aria-label="时长秒"></div><span style="align-self:center;color:#889;font-size:12px;">秒 ·</span><div><input class="kite-panel-fps" type="number" min="4" max="60" step="1" value="30" title="帧率 FPS" aria-label="帧率"></div><span style="align-self:center;color:#889;font-size:12px;">FPS</span></div>
        </div>
        <label>尺寸</label><div class="kite-size-row"><div><input class="kite-panel-width" type="number" min="64" max="4096" value="1024" aria-label="宽度"></div><button type="button" class="kite-panel-swap-size" title="反转宽高比" aria-label="反转宽高比"><span></span></button><div><input class="kite-panel-height" type="number" min="64" max="4096" value="1024" aria-label="高度"></div></div>
        <button type="button" class="kite-fit-size-btn" title="读取参考图/原图的实际像素，自动填入宽高">⤢ 自适应尺寸</button>
        <label>大模型</label><select class="kite-panel-model"></select>
        <div class="kite-panel-status"></div><div class="kite-panel-actions"><button type="button" class="kite-panel-cancel">取消</button><button type="button" class="primary kite-panel-generate">生成</button></div>`;
      const panelSize = getKiteDefaultSize('imagePanel');
      panel.style.left = anchor.x + 'px';
      panel.style.top = anchor.y + 'px';
      panel.style.width = panelSize.w + 'px';
      panel.style.height = panelSize.h + 'px';
      panel.dataset.kiteSizeKind = 'imagePanel';
      host.appendChild(panel);
      bindPanelWindow(panel);
      loadImagePanelSettings(panel);
      bindImagePanelControls(panel);
      fillImageModelSelect(panel.querySelector('.kite-panel-model'));
      // Models 异步加载完成后再补填一次视觉模型
      if (window.Models && !Models._loaded && typeof Models.load === 'function') {
        Models.load().then(function () { fillImageModelSelect(panel.querySelector('.kite-panel-model')); }).catch(function () {});
      }
      // 右侧输出小圆点：拖出一条线，松开后在落点创建图片节点（并与面板建立持久连线，两端贴住小圆点）
      const promptPort = document.createElement('div');
      promptPort.className = 'kite-port kite-port-in kite-panel-in-port';
      promptPort.title = '拖出以创建提示词面板';
      panel.appendChild(promptPort);
      bindAuxPort(promptPort, 'prompt', panel, host);
      const outPort = document.createElement('div');
      outPort.className = 'kite-port kite-port-out kite-panel-out-port';
      outPort.title = '拖出以打开图片查看面板';
      panel.appendChild(outPort);
      bindAuxPort(outPort, 'viewer', panel, host);
      // 【重构】右侧输出端口统一走 KitePortLink 管线（bindAuxPort 已绑定查看面板），
      // 不再叠加自写 mousedown 拖线，避免一次按下同时触发「打开查看器」和「创建图片节点」的双重行为。
      // 建立/重建 面板->图片节点 的持久连线（左侧贴节点入点小圆点，右侧贴面板出点小圆点）
      function createPanelLink(pnl, imgNode) {
        if (pnl._linkPath) { pnl._linkPath.remove(); pnl._linkPath = null; }
        const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p2.setAttribute('class', 'kite-curve');
        p2.dataset.from = 'panel';
        p2.dataset.to = imgNode.id;
        state.svg.appendChild(p2);
        pnl._linkPath = p2;
        pnl._imageNode = imgNode;
        if (!pnl._linkObserver) observePanelMove(pnl);
        refreshPanelLink(pnl);
      }
      panel.createPanelLink = createPanelLink;
      // 关闭面板时同时移除它的连线
      function closePanel() {
        saveImagePanelSettings(panel);
        if (panel._linkPath) { panel._linkPath.remove(); panel._linkPath = null; }
        if (panel._unregisterPanelRefresher) { panel._unregisterPanelRefresher(); panel._unregisterPanelRefresher = null; }
        panel.remove();
      }
      panel.querySelector('.kite-panel-close').addEventListener('click', closePanel);
      panel.querySelector('.kite-panel-cancel').addEventListener('click', closePanel);
      // 生成：若有连线媒体节点则更新它，否则在面板右侧创建（图片/视频由下拉决定）
      panel.querySelector('.kite-panel-generate').addEventListener('click', () => {
        const prompt = panel.querySelector('.kite-panel-prompt').value.trim();
        const width = Math.max(64, Number(panel.querySelector('.kite-panel-width').value) || 1024);
        const height = Math.max(64, Number(panel.querySelector('.kite-panel-height').value) || 1024);
        const model = panel.querySelector('.kite-panel-model').value;
        const mediaTypeSel = panel.querySelector('.kite-panel-media-type');
        const mediaType = mediaTypeSel ? mediaTypeSel.value : 'image';
        const durationInput = panel.querySelector('.kite-panel-duration');
        const fpsInput = panel.querySelector('.kite-panel-fps');
        const vDuration = Math.max(1, Number(durationInput && durationInput.value) || 5);
        const vFps = Math.max(4, Math.round(Number(fpsInput && fpsInput.value) || 30));
        const status = panel.querySelector('.kite-panel-status');
        saveImagePanelSettings(panel); // 生成时也记住本次设置
        if (!prompt) { status.textContent = '请输入提示词'; return; }
        // 未拖出连线时：自动在面板右侧创建结果节点并连线（保持与生成尺寸一致的宽高比）
        if (!panel._imageNode || !state.nodes.has(panel._imageNode.id)) {
          const pr = panel.getBoundingClientRect();
          const hr = host.getBoundingClientRect();
          const nx = pr.left - hr.left + pr.width + 60, ny = pr.top - hr.top + 40;
          const imgNode = addNode({ type: mediaType === 'video' ? 'video' : 'image', src: '', prompt: '', x: nx, y: ny, pending: true, ratio: width / height });
          createPanelLink(panel, imgNode);
        }
        const targetNode = panel._imageNode;
        targetNode.ratio = width / height; // 节点比例与面板一致
        setImagePanelGenerating(panel, true, mediaType === 'video' ? '正在生成视频（可能需要较长时间）...' : '');
        if (mediaType === 'video') {
          // 视频生成：走 video_gen 后端
          const vPayload = { action: 'generate', prompt, size: width + 'x' + height, model, duration: vDuration, fps: vFps };
          let vResult;
          try { vResult = window.Tools && Tools._callToolApi ? Tools._callToolApi('video_gen', vPayload, '双击菜单文生视频') : null; } catch (e) { vResult = null; }
          if (!vResult || typeof vResult.then !== 'function') { setImagePanelGenerating(panel, false, '当前无法调用视频生成接口'); return; }
          vResult.then(data => {
            let url = data && (data.url || (data.data && (data.data.url || ((data.data.videos || [])[0] || {}).url)));
            if (!url && data && data.videos && data.videos[0]) url = data.videos[0].url;
            if (url) {
              applyMediaNodeUrl(targetNode.id, url, prompt, 'video');
              refreshPanelLink(panel);
              setImagePanelGenerating(panel, false, '视频生成完成');
              // 统一输出：生成完成后右侧浮动查看窗同步显示
              if (window.ImageViewer && ImageViewer.show) { try { ImageViewer.show(url); } catch (e) {} }
            } else setImagePanelGenerating(panel, false, (data && data.error) || '视频生成失败');
          }).catch(() => { setImagePanelGenerating(panel, false, '视频生成失败'); });
          return;
        }
        const payload = { action: 'generate', prompt, size: width + 'x' + height, model };
        let result;
        try { result = window.Tools && Tools._callToolApi ? Tools._callToolApi('image_gen', payload, '双击菜单文生图') : null; } catch (e) { result = null; }
        if (!result || typeof result.then !== 'function') { setImagePanelGenerating(panel, false, '当前无法调用生图接口'); return; }
        result.then(data => {
          const url = data && (data.url || (data.data && data.data.url) || (data.result && data.result.url));
          if (url) {
            applyMediaNodeUrl(targetNode.id, url, prompt, 'image');
            refreshPanelLink(panel);
            setImagePanelGenerating(panel, false, '生成完成');
            // 统一输出：生成完成后右侧浮动查看窗同步显示
            if (window.ImageViewer) ImageViewer.show(url);
          } else setImagePanelGenerating(panel, false, (data && data.error) || '生成失败');
        }).catch(() => { setImagePanelGenerating(panel, false, '生成失败'); });
      });
      return panel;
    }],
    // ===== 替换面板：双栏「创建对话框」（左=文本 模型列表，右=视觉 功能项） =====
    // 文本栏：文本类大模型（点击即在双击点创建对话框）；视觉栏：文生图 / 提示词 / 图片查看
    ['chat', function (host, anchor, origin) {
      const panel = document.createElement('section');
      panel.className = 'kite-chat-panel kite-dual-create-panel';
      panel.innerHTML = `<div class="kite-panel-header"><h3>✨ 创建对话框</h3><button type="button" class="kite-panel-close" title="关闭">✕</button></div>
        <div class="kite-create-cols">
          <div class="kite-create-col kite-create-col-text">
            <div class="kite-create-col-title">📝 语言</div>
            <div class="kite-chat-list"></div>
          </div>
          <div class="kite-create-col kite-create-col-visual">
            <div class="kite-create-col-title">🎨 视觉 <span class="kite-dev-badge">🚧 开发中</span></div>
            <div class="kite-visual-list">
              <button type="button" class="kite-chat-item"><span class="ctx-icon">🖼️</span> 文生图</button>
              <button type="button" class="kite-chat-item"><span class="ctx-icon">🖍️</span> 图生图/视频</button>
              <button type="button" class="kite-chat-item"><span class="ctx-icon">✎</span> 提示词</button>
              <button type="button" class="kite-chat-item"><span class="ctx-icon">🔍</span> 图片或视频查看</button>
              <button type="button" class="kite-chat-item"><span class="ctx-icon">👁️</span> 识图/视频</button>
            </div>
          </div>
        </div>`;
      panel.style.left = anchor.x + 'px';
      panel.style.top = anchor.y + 'px';
      // ===== 尺寸记忆（private/用户设置/user_settings.json，关闭智能体后仍保留）=====
      // 只记忆宽度；高度由按钮内容自然撑开，避免模型数量变化后出现空白或裁切。
      try {
        var savedW = UserSettings.get('zf3d_create_panel_w');
        panel.style.width = (savedW || 400) + 'px';
      } catch (e) { panel.style.width = '400px'; }
      panel.style.height = 'auto';
      panel.style.minHeight = '0';
      host.appendChild(panel);
      bindPanelWindow(panel);
      // ===== 点击空白处关闭面板（点面板自身不关）=====
      setTimeout(() => {
        const dismiss = (e) => {
          if (document.body.contains(panel) && !panel.contains(e.target)) {
            panel.remove();
            document.removeEventListener('mousedown', dismiss);
          }
        };
        document.addEventListener('mousedown', dismiss);
      }, 0);
      // ===== 关闭/移除时保存宽度 =====
      // 高度不保存，始终由当前按钮内容自然撑开。
      const saveCreatePanelSize = () => {
        try {
          if (panel.offsetWidth) UserSettings.set('zf3d_create_panel_w', panel.offsetWidth);
        } catch (e) {}
      };
      panel.addEventListener('remove', saveCreatePanelSize);
      const _origRemove = panel.remove.bind(panel);
      panel.remove = function () { saveCreatePanelSize(); _origRemove(); };
      // ✕ 关闭
      panel.querySelector('.kite-panel-close').addEventListener('click', () => panel.remove());
      // ---------- 语言栏：仅列出语言类模型（识图模型不显示） ----------
      const list = panel.querySelector('.kite-chat-list');
      function isTextModel(m) {
        if (m.imageGen) return false;
        if (m.modelType === 'types_vision') return false; // 仅排除专用识图模型，语言模型即使支持传图也保留
        const ep = (m.endpoint || m.baseUrl || '').toLowerCase();
        const mid = (m.modelId || m.id || '').toLowerCase();
        if (ep.includes('/images/')) return false;
        if (ep.includes('tts') || ep.includes('speech') || ep.includes('audio') || mid.includes('tts') || mid.includes('asr') || mid.includes('whisper')) return false;
        if (ep.includes('embedding') || mid.includes('embedding')) return false;
        return true;
      }
      function fillModelList() {
        const models = (window.Models && Models.list ? Models.list : []).filter(function (m) {
          if (!isTextModel(m)) return false;
          return m.visible !== false;
        });
        list.innerHTML = '';
        models.forEach(m => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'kite-chat-item';
          item.innerHTML = '<span class="ctx-icon">💬</span> ' + (m.name || m.id);
          item.title = m.modelId || m.id || '';
          item.addEventListener('click', () => {
            // 画布内坐标 -> 屏幕坐标：createChatBox 接收 clientX/clientY
            const rect = host.getBoundingClientRect();
            const px = rect.left + anchor.x + 12, py = rect.top + anchor.y + 40;
            const chat = window.App && App.createChatBox ? App.createChatBox(px, py, m.id) : null;
            if (chat) panel.remove(); // 创建成功后面板立刻关闭
          });
          list.appendChild(item);
        });
        if (!list.children.length) {
          list.innerHTML = '<div class="kite-chat-empty">暂无文本模型<br>请先在「⚙️ 模型配置」中添加</div>';
        }
      }
      // ---------- 🚧 整个视觉栏标注开发中：点击任何功能项仅提示，不打开面板 ----------
      panel.querySelector('.kite-create-col-visual').classList.add('kite-col-dev');
      panel.querySelector('.kite-visual-list').addEventListener('click', (e) => {
        if (e.target.closest('button')) window.alert('🚧 视觉功能正在开发中，敬请期待');
      });
      // 首次填充：若 Models 尚未异步加载完成，等 load 完成后再填一次
      fillModelList();
      if (window.Models && !Models._loaded && typeof Models.load === 'function') {
        Models.load().then(function() { fillModelList(); }).catch(function() {});
      }
      return panel;
    }],
  ]);

  // ---------- 识图面板：左侧连线输入图片节点 -> 选识图模型识别 -> 结果右侧连线传到提示词/对话框 ----------
  function openVisionPanel(host, anchor) {
    const panel = document.createElement('section');
    panel.className = 'kite-image-panel kite-vision-panel';
    panel.innerHTML = `<div class="kite-panel-header"><h3>👁️ 识图/视频</h3><button type="button" class="kite-panel-close" title="关闭">✕</button></div>
        <label>图片/视频（从左侧小圆点连线引入图片或视频节点，1~8 个）<span class="kite-vision-count"></span></label>
        <div class="kite-edit-rows kite-vision-rows"></div>
        <label>识图要求（可选）</label><textarea class="kite-textarea kite-vision-prompt" style="height:52px;min-height:52px;resize:vertical" placeholder="例如：详细描述图片内容 / 提取图中文字 / 分析设计布局 / 描述视频内容与动作"></textarea>
        <label>识图模型</label><select class="kite-vision-model"></select>
        <div class="kite-panel-status"></div>
        <div class="kite-panel-actions"><button type="button" class="kite-panel-cancel">取消</button><button type="button" class="primary kite-vision-run">开始识图</button></div>`;
    const panelSize = getKiteDefaultSize('visionPanel');
    panel.style.left = anchor.x + 'px';
    panel.style.top = anchor.y + 'px';
    panel.style.width = panelSize.w + 'px';
    panel.style.height = panelSize.h + 'px';
    panel.dataset.kiteSizeKind = 'visionPanel';
    host.appendChild(panel);
    ['mousedown', 'click', 'dblclick'].forEach(type => panel.addEventListener(type, e => e.stopPropagation()));
    bindPanelWindow(panel);
    function closeVisionPanel() {
      if (panel._visionLinkPath) { panel._visionLinkPath.remove(); panel._visionLinkPath = null; }
      if (panel._unregisterPanelRefresher) { panel._unregisterPanelRefresher(); panel._unregisterPanelRefresher = null; }
      if (panel.isConnected) panel.querySelectorAll('._visionSrcPath').forEach(p => p.remove());
      panel.remove();
    }
    panel.querySelector('.kite-panel-close').addEventListener('click', closeVisionPanel);
    panel.querySelector('.kite-panel-cancel').addEventListener('click', closeVisionPanel);

    // ---------- 图片暂存与渲染 ----------
    const MAX_IMAGES = 8, MAX_BYTES = 8 * 1024 * 1024;
    let imgs = [];
    const rowsEl = panel.querySelector('.kite-vision-rows');
    const countEl = panel.querySelector('.kite-vision-count');
    function renderRows() {
      rowsEl.innerHTML = '';
      imgs.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'kite-edit-row';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;';
        const thumb = it.type === 'video'
          ? '<span style="width:56px;height:42px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid #e2e6ee;background:#111;font-size:18px;">🎬</span>'
          : '<img src="' + it.dataUrl + '" alt="" style="width:56px;height:42px;object-fit:cover;border-radius:6px;border:1px solid #e2e6ee;">';
        row.innerHTML = '<span style="font-size:12px;color:#889;flex:none;">' + (it.type === 'video' ? '视' : '图') + (i + 1) + '</span>' +
          thumb +
          '<span style="font-size:11px;color:#99a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (it.name || 'media') + '</span>' +
          '<button type="button" class="kite-vision-del" data-idx="' + i + '" title="移除" style="border:none;background:#f1f2f5;border-radius:5px;padding:2px 8px;cursor:pointer;">×</button>';
        row.querySelector('.kite-vision-del').addEventListener('click', () => { imgs.splice(i, 1); renderRows(); });
        rowsEl.appendChild(row);
      });
      countEl.textContent = imgs.length ? ('（' + imgs.length + ' 个，来自连线节点）') : '';
      // 来源被删除时同步清理，并立即重建输入连线（去掉死线）
      const before = panel._visionSources.length;
      panel._visionSources = panel._visionSources.filter(s => state.nodes.has(s.id));
      if (panel._visionSources.length !== before && typeof refreshVisionSourceLinks === 'function') refreshVisionSourceLinks();
    }
    // ---------- 左侧输入小圆点：从图片节点拖线连入，自动收集节点图片 ----------
    const inPort = document.createElement('div');
    inPort.className = 'kite-port kite-port-in kite-panel-in-port';
    inPort.title = '拖入：连接图片或视频节点作为识图输入（可连多个）';
    panel.appendChild(inPort);
    // 【重构】左侧输入端口统一走 KitePortLink 管线，松开后命中图片节点即连入
    bindPortLinkDrag(inPort, (_pc, _cp, vp) => {
      const hitEl = document.elementsFromPoint(vp.x, vp.y)
        .find(t => t.closest && t.closest('.kite-node'));
      if (!hitEl) return;
      const srcEl = hitEl.closest('.kite-node');
      const src = state.nodes.get(srcEl.dataset.id);
      if (!src || (src.type !== 'image' && src.type !== 'video')) { setVisionStatus(panel, '⚠️ 只能连入图片或视频节点'); return; }
      addVisionSourceNode(src);
    });
    panel._visionSources = []; // [{ id, url }]
    function visionPanelCenter() {
      const pr = panel.getBoundingClientRect(), cr = state.canvas.getBoundingClientRect();
      return { x: pr.left - cr.left, y: pr.top - cr.top + pr.height / 2 };
    }
    function refreshVisionSourceLinks() {
      panel.querySelectorAll('._visionSrcPath').forEach(p => p.remove());
      panel._visionSources.forEach(s => {
        const node = state.nodes.get(s.id);
        if (!node) return;
        const a = nodePortCenter(node, 'out');
        const b = visionPanelCenter();
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', 'kite-curve');
        p.classList.add('_visionSrcPath');
        p.dataset.from = s.id; p.dataset.visionInputLink = '1';
        p.setAttribute('d', bezierPath(a.x, a.y, b.x, b.y));
        state.svg.appendChild(p);
      });
    }
    function addVisionSourceNode(node) {
      if (panel._visionSources.some(s => s.id === node.id)) return;
      if (panel._visionSources.length >= MAX_IMAGES) { setVisionStatus(panel, '⚠️ 最多 ' + MAX_IMAGES + ' 个输入图片/视频'); return; }
      let url, kind;
      if (node.type === 'video') {
        const vEl = node.el.querySelector('.kite-node-media video');
        kind = 'video';
        url = (vEl && vEl.getAttribute('src')) || node.src || '';
        if (!url || !/^data:video\/|^https?:|^blob:/.test(url)) { setVisionStatus(panel, '⚠️ 该视频节点暂无可用视频'); return; }
      } else {
        const imgEl = node.el.querySelector('.kite-node-media img');
        kind = 'image';
        url = imgEl && imgEl.src;
        if (!url || !/^data:image\/|^https?:|^blob:/.test(url)) { setVisionStatus(panel, '⚠️ 该图片节点暂无可用图片'); return; }
      }
      panel._visionSources.push({ id: node.id, name: ((node.text || node.prompt || (node.type === 'video' ? 'video' : 'image')) + '').slice(0, 20), dataUrl: url, type: kind });
      renderVisionSources();
    }
    function renderVisionSources() {
      imgs = panel._visionSources.map(s => ({ dataUrl: s.dataUrl, name: s.name, type: s.type || 'image' }));
      renderRows();
      refreshVisionSourceLinks();
    }

    // ---------- 模型下拉：只列识图模型（visionInput）----------
    const sel = panel.querySelector('.kite-vision-model');
    function fillVisionModels() {
      const models = ((window.Models && Models.list) || []).filter(m => m.visionInput || m.modelType === 'types_vision');
      sel.innerHTML = '';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = '👁️ ' + (m.name || m.id) + (m.modelId ? '（' + m.modelId + '）' : '');
        sel.appendChild(opt);
      });
      if (!models.length) sel.innerHTML = '<option value="">暂无识图模型，请在「⚙️ 模型配置」添加</option>';
    }
    fillVisionModels();
    if (window.Models && !Models._loaded && typeof Models.load === 'function') {
      Models.load().then(fillVisionModels).catch(function () {});
    }

    // ---------- 开始识图：直接调用 OpenAI 兼容 chat/completions ----------
    const runBtn = panel.querySelector('.kite-vision-run');
    runBtn.addEventListener('click', async () => {
      if (!imgs.length) { setVisionStatus(panel, '请先从左侧小圆点连入图片或视频节点'); return; }
      const model = ((window.Models && Models.list) || []).find(m => m.id === sel.value);
      if (!model) { setVisionStatus(panel, '请先在「⚙️ 模型配置」中添加识图模型'); return; }
      const question = (panel.querySelector('.kite-vision-prompt').value || '').trim() ||
        (imgs.some(it => it.type === 'video') ? '请详细描述这些图片/视频的内容。' : '请详细描述这些图片的内容。');
      const content = [{ type: 'text', text: question }].concat(
        imgs.map(it => it.type === 'video'
          ? { type: 'video_url', video_url: { url: it.dataUrl } }
          : { type: 'image_url', image_url: { url: it.dataUrl } })
      );
      runBtn.disabled = true;
      setVisionStatus(panel, '⏳ 正在识图/识视频…');
      try {
        // 【CORS 修复】统一走后端 /api/proxy 代理，避免浏览器直连第三方 API 被跨域拦截
        if (!(window.DB && typeof DB.proxy === 'function')) throw new Error('DB.proxy 不可用');
        const _payload = { model: model.modelId, messages: [{ role: 'user', content: content }], stream: false };
        const _headers = Object.assign({ 'Content-Type': 'application/json' }, model.headers || {}, { 'Authorization': 'Bearer ' + (model.apiKey || model.key || '') });
        // DB.proxy 内部已执行 res.json()，这里直接拿到解析后的对象，不能再调一次 .json()
        const data = await DB.proxy(model.endpoint || model.baseUrl, _headers, _payload);
        const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!text) {
          const emsg = (data && (data.error && (data.error.message || data.error))) || ('HTTP 响应异常');
          throw new Error(typeof emsg === 'string' ? emsg : JSON.stringify(emsg));
        }
        panel._visionResult = text;
        // 已有连线时自动把结果注入目标（提示词节点 / 对话框输入框）
        deliverVisionResult();
      } catch (err) {
        setVisionStatus(panel, '❌ 识图/识视频失败: ' + (err.message || err));
      } finally {
        runBtn.disabled = false;
      }
    });

    // ---------- 结果连线传值：右侧输出小圆点，拖到提示词节点/对话框上建立持久连线，识图结果自动注入 ----------
    function deliverVisionResult() {
      const text = panel._visionResult || '';
      if (!text) return false;
      // 目标1：连接的画布节点（提示词 text 节点）
      let ok = false;
      if (panel._visionTarget && state.nodes.has(panel._visionTarget.id)) {
        const n = state.nodes.get(panel._visionTarget.id);
        const ta = n.el.querySelector('textarea');
        if (ta) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); n.text = text; ok = true; }
        setVisionStatus(panel, '✅ 识图完成，已传入「' + (n.type === 'text' ? '提示词' : '节点') + '」');
        return true;
      }
      // 目标2：连接的对话框（chatbox）——【防护】必须是仍挂在 DOM 里的真实元素才调 querySelector，避免 Uncaught TypeError
      if (panel._visionChatEl && panel._visionChatEl.nodeType === 1 &&
          typeof panel._visionChatEl.querySelector === 'function' &&
          document.body.contains(panel._visionChatEl)) {
        try {
          const box = panel._visionChatEl;
          const ta = box.querySelector('textarea');
          if (ta) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); try { ta.focus(); } catch (e) {} ok = true; }
          setVisionStatus(panel, '✅ 识图完成，已传入右侧对话框');
        } catch (e) { console.warn('[KiteCanvas] 注入对话框失败:', e); setVisionStatus(panel, '⚠️ 结果已生成，但注入对话框失败'); }
        return ok;
      }
      return false;
    }
    panel._deliverVisionResult = deliverVisionResult;
    // 【重构】统一建立 面板出点 -> 目标 的持久连线（节点/对话框共用）
    function linkVisionTarget(kind) {
      if (panel._visionLinkPath) { panel._visionLinkPath.remove(); panel._visionLinkPath = null; }
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'kite-curve');
      p.dataset.from = 'panel'; p.dataset.visionLink = '1';
      state.svg.appendChild(p);
      panel._visionLinkPath = p;
      refreshVisionLink();
    }

    // 持久连线：面板出点 -> 目标（节点入点 / 对话框左侧），随移动刷新
    function refreshVisionLink() {
      const path = panel._visionLinkPath;
      if (!path) return;
      const hr = host.getBoundingClientRect();
      const pr0 = outPort.getBoundingClientRect();
      const a = { x: pr0.left + pr0.width / 2 - hr.left, y: pr0.top + pr0.height / 2 - hr.top };
      let b = null;
      if (panel._visionTarget && state.nodes.has(panel._visionTarget.id)) {
        b = nodePortCenter(state.nodes.get(panel._visionTarget.id), 'in');
      } else if (panel._visionChatEl && document.body.contains(panel._visionChatEl)) {
        const cr = panel._visionChatEl.getBoundingClientRect();
        b = { x: cr.left - hr.left, y: cr.top - hr.top + cr.height / 2 };
      }
      // 【修复】目标失效（节点被删/对话框已关闭）时立即删除连线并清空目标引用
      if (!b || !panel.isConnected) {
        if (path.parentNode) path.remove();
        panel._visionLinkPath = null; panel._visionTarget = null; panel._visionChatEl = null;
        return;
      }
      path.setAttribute('d', bezierPath(a.x, a.y, b.x, b.y));
    }
    // 【重构】连线刷新注册到统一中心（rAF 节流 + 缩放/平移自动触发），不再各挂一个 mousemove
    if (!panel._visionLinkObserver) {
      panel._visionLinkObserver = () => {
        if (document.body.contains(panel)) { refreshVisionLink(); refreshVisionSourceLinks(); }
        else if (panel._unregisterPanelRefresher) panel._unregisterPanelRefresher();
      };
      ensureGlobalLinkListeners();
      registerPanelRefresher(panel, panel._visionLinkObserver);
      scheduleAllPanelRefresh();
    }

    const outPort = document.createElement('div');
    outPort.className = 'kite-port kite-port-out kite-panel-out-port';
    outPort.title = '拖出以连接提示词节点或对话框（传递识图结果）';
    panel.appendChild(outPort);
    // 【重构】右侧输出端口统一走 KitePortLink 管线
    bindPortLinkDrag(outPort, (_pc, cp, vp) => {
      const ev = { clientX: vp.x, clientY: vp.y };
      // 命中已有节点 -> 连线并立即传值
      const hitEl = document.elementsFromPoint(ev.clientX, ev.clientY)
        .find(t => t.closest && t.closest('.kite-node'));
      if (hitEl) {
        const targetEl = hitEl.closest('.kite-node');
        const target = state.nodes.get(targetEl.dataset.id);
        if (target) {
          panel._visionTarget = target; panel._visionChatEl = null;
          linkVisionTarget();
          deliverVisionResult(); // 已有识图结果则直接注入
          return;
        }
      }
      // 命中已有对话框(chatbox) -> 连线
      const chatHit = document.elementsFromPoint(ev.clientX, ev.clientY)
        .find(t => t.closest && t.closest('.chatbox'));
      if (chatHit) {
        panel._visionChatEl = chatHit.closest('.chatbox'); panel._visionTarget = null;
        linkVisionTarget();
        deliverVisionResult();
        return;
      }
      // 空白处：创建文本(提示词)节点并连线上传值
      if (panel._visionResult) {
        const txtNode = addNode({ type: 'text', text: '', x: cp.x - 120, y: cp.y - 40 });
        if (txtNode) {
          panel._visionTarget = txtNode; panel._visionChatEl = null;
          linkVisionTarget();
          setTimeout(() => deliverVisionResult(), 30);
          setVisionStatus(panel, '✅ 已创建提示词节点并注入识图结果');
        }
      } else {
        setVisionStatus(panel, '⚠️ 请先开始识图，再拖出连线传递结果');
      }
    });

    renderVisionSources();
    return panel;
  }

  function setVisionStatus(panel, msg) {
    const el = panel.querySelector('.kite-panel-status');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  // ---------- 图片修改面板：节点式输入 ----------
  // 左侧两个输入小圆：上=提示词节点（提供提示词，可继续编辑），下=图片节点（按连线顺序编号 @图片N）
  // 面板本身不展示图片、无导入按钮；结果输出到右侧连线/自动创建的图片预览节点
  function openImageEditPanel(host, anchor) {
    const panel = document.createElement('section');
    panel.className = 'kite-image-panel kite-edit-panel';
    panel.innerHTML = `<div class="kite-panel-header"><h3>🖍️ 图生图/视频</h3><button type="button" class="kite-panel-close" title="关闭">✕</button></div>
        <label>提示词<span class="kite-edit-src-hint"></span></label><textarea class="kite-textarea kite-panel-prompt" style="height:64px;min-height:64px;resize:vertical" placeholder="描述修改要求；参考图按左下圆点连入顺序编号为 @图片1、@图片2…"></textarea>
        <label>修改类型</label><select class="kite-panel-media-type"><option value="image">🖼️ 图片</option><option value="video">🎬 视频</option></select>
        <label>尺寸</label><div class="kite-size-row"><div><input class="kite-panel-width" type="number" min="64" max="4096" value="1024" aria-label="宽度"></div><button type="button" class="kite-panel-swap-size" title="反转宽高比"><span></span></button><div><input class="kite-panel-height" type="number" min="64" max="4096" value="1024" aria-label="高度"></div></div>
        <button type="button" class="kite-fit-size-btn" title="读取参考图实际像素，自动填入宽高">⤢ 自适应尺寸</button>
        <label>大模型</label><select class="kite-panel-model"></select>
        <div class="kite-panel-status"></div><div class="kite-panel-actions"><button type="button" class="kite-panel-cancel">取消</button><button type="button" class="primary kite-panel-generate">生成新图片/视频</button></div>`;
    const panelSize = getKiteDefaultSize('editPanel');
    panel.style.left = anchor.x + 'px';
    panel.style.top = anchor.y + 'px';
    panel.style.width = panelSize.w + 'px';
    panel.style.height = panelSize.h + 'px';
    panel.dataset.kiteSizeKind = 'editPanel';
    host.appendChild(panel);
    ['mousedown', 'click', 'dblclick'].forEach(type => panel.addEventListener(type, e => e.stopPropagation()));
    bindPanelWindow(panel);
    loadImagePanelSettings(panel);
    bindImagePanelControls(panel);
    fillImageModelSelect(panel.querySelector('.kite-panel-model'));
    if (window.Models && !Models._loaded && typeof Models.load === 'function') {
      Models.load().then(function () { fillImageModelSelect(panel.querySelector('.kite-panel-model')); }).catch(function () {});
    }
    // ----- 连接状态 -----
    panel._promptNodes = [];   // 提示词节点 id（顺序）
    panel._imageNodes = [];    // 参考图片节点 id（顺序=编号顺序）
    panel._editInputs = [];    // 输入连线 { nodeId, path }

    function inputPortCenter(port) {
      const hr = host.getBoundingClientRect();
      const pr = port.getBoundingClientRect();
      return { x: pr.left + pr.width / 2 - hr.left, y: pr.top + pr.height / 2 - hr.top };
    }
    function refreshEditLinks() {
      (panel._editInputs || []).forEach(it => {
        const node = state.nodes.get(it.nodeId);
        if (!node || !document.body.contains(panel)) { it.path.remove(); it.dead = true; return; }
        const port = node.type === 'text' ? panel._promptPort : panel._imagesPort;
        if (!port) return;
        const a = nodePortCenter(node, 'out');
        const b = inputPortCenter(port);
        it.path.setAttribute('d', bezierPath(a.x, a.y, b.x, b.y));
      });
      panel._editInputs = (panel._editInputs || []).filter(it => !it.dead);
      updateSrcHint();
    }
    function addEditLink(nodeId) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'kite-curve kite-curve-in');
      state.svg.appendChild(path);
      panel._editInputs.push({ nodeId: nodeId, path: path });
    }
    function hasLink(nodeId) { return (panel._editInputs || []).some(it => it.nodeId === nodeId); }
    function updateSrcHint() {
      const hint = panel.querySelector('.kite-edit-src-hint');
      if (hint) {
        const n = (panel._imageNodes || []).length;
        hint.textContent = n ? ('　已连 ' + n + ' 张参考图（@图片1~@图片' + n + '）') : '';
      }
    }
    panel.refreshEditLinks = refreshEditLinks;
    function syncPromptFromNodes() {
      const ta = panel.querySelector('.kite-panel-prompt');
      const first = panel._promptNodes.map(id => state.nodes.get(id)).find(Boolean);
      if (first && document.activeElement !== ta) ta.value = first.text || '';
    }

    // ----- 左侧两个输入小圆 -----
    function makeInPort(cls, title) {
      const p = document.createElement('div');
      p.className = 'kite-port kite-port-in kite-edit-in-port ' + cls;
      p.title = title;
      panel.appendChild(p);
      return p;
    }
    const promptPort = makeInPort('kite-edit-prompt-port', '连接提示词节点（提供提示词）');
    const imagesPort = makeInPort('kite-edit-images-port', '连接图片节点作为参考图（按连线顺序编号）');
    panel._promptPort = promptPort; panel._imagesPort = imagesPort;

    // 【修复】输入小圆支持双向连线：从小圆拖出，松在图片/提示词节点上也建立连接
    // （此前小圆只是被动落点，从小圆往外拖线完全无响应；且落点判定无容差容易落空）
    [promptPort, imagesPort].forEach(port => {
      bindPortLinkDrag(port, (_pc, _cp, vp) => {
        // 松开点命中哪个媒体/文本节点
        const hitEl = document.elementsFromPoint(vp.x, vp.y)
          .find(t => t.closest && t.closest('.kite-node'));
        if (!hitEl) return;
        const srcEl = hitEl.closest('.kite-node');
        if (!srcEl) return;
        if (typeof panel.connectNodeToEdit === 'function') panel.connectNodeToEdit(srcEl.dataset.id);
        else if (typeof connectNodeToEdit === 'function') connectNodeToEdit(srcEl.dataset.id);
      });
    });

    function collectImages() {
      return (panel._imageNodes || [])
        .map(id => state.nodes.get(id)).filter(Boolean)
        .map(nd => {
          let media = nd.el.querySelector('.kite-node-media img') || nd.el.querySelector('.kite-node-media video');
          return media ? media.src : '';
        })
        .filter(s => s);
    }
    panel.collectEditInputs = function () {
      syncPromptFromNodes();
      return { prompts: panel._promptNodes.map(id => { const nd = state.nodes.get(id); return nd ? (nd.text || '') : ''; }).filter(Boolean), images: collectImages() };
    };
    // 外部拖线松开到输入圆点时由全局调用
    panel.connectNodeToEdit = function (nodeId) {
      const nd = state.nodes.get(nodeId);
      if (!nd || hasLink(nodeId)) return false;
      if (nd.type === 'text' && !panel._promptNodes.includes(nodeId)) panel._promptNodes.push(nodeId);
      else if ((nd.type === 'image' || nd.type === 'video') && !panel._imageNodes.includes(nodeId)) panel._imageNodes.push(nodeId);
      else return false;
      addEditLink(nodeId);
      syncPromptFromNodes();
      refreshEditLinks();
      return true;
    };

    // ----- 右侧输出小圆：拖出创建结果图片预览节点并持久连线 -----
    function createResultLinkFor(pnl, imgNode) {
      if (pnl._linkPath) { pnl._linkPath.remove(); pnl._linkPath = null; }
      const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p2.setAttribute('class', 'kite-curve');
      p2.dataset.from = 'panel';
      p2.dataset.to = imgNode.id;
      state.svg.appendChild(p2);
      pnl._linkPath = p2;
      pnl._imageNode = imgNode;
      if (!pnl._linkObserver) observePanelMove(pnl);
      refreshPanelLink(pnl);
    }
    panel.createPanelLink = createResultLinkFor;
    const outPort = document.createElement('div');
    outPort.className = 'kite-port kite-port-out kite-panel-out-port';
    outPort.title = '拖出以放置结果图片';
    panel.appendChild(outPort);
    // 【重构】右侧输出端口统一走 KitePortLink 管线：拖出松开后在落点创建结果图片节点
    bindPortLinkDrag(outPort, (_pc, cp) => {
      const imgNode = addNode({ type: 'image', src: '', prompt: '', x: cp.x - 160, y: cp.y - 120, pending: true });
      if (imgNode) createResultLinkFor(panel, imgNode);
    });

    refreshEditLinks();
    // 【重构】输入连线刷新与提示词回填注册到统一中心（rAF 节流 + 缩放/平移自动触发）
    let _lastText = '';
    const _editMove = () => {
      if (document.body.contains(panel)) {
        refreshEditLinks();
        const nd = panel._promptNodes.map(id => state.nodes.get(id)).find(Boolean);
        if (nd && nd.text !== _lastText) { syncPromptFromNodes(); _lastText = nd.text; }
      } else if (panel._unregisterPanelRefresher) panel._unregisterPanelRefresher();
    };
    ensureGlobalLinkListeners();
    registerPanelRefresher(panel, _editMove);
    scheduleAllPanelRefresh();

    function closeEditPanel() {
      saveImagePanelSettings(panel);
      if (panel._linkPath) { panel._linkPath.remove(); panel._linkPath = null; }
      if (panel._linkObserver && panel._unregisterPanelRefresher) { panel._unregisterPanelRefresher(); panel._unregisterPanelRefresher = null; }
      (panel._editInputs || []).forEach(it => it.path.remove());
      if (panel._unregisterPanelRefresher) { panel._unregisterPanelRefresher(); panel._unregisterPanelRefresher = null; }
      panel.remove();
    }
    panel.querySelector('.kite-panel-close').addEventListener('click', closeEditPanel);
    panel.querySelector('.kite-panel-cancel').addEventListener('click', closeEditPanel);

    // 生成：参考图来自下圆点连入的图片节点；提示词=本地编辑优先，否则用连入提示词节点文本
    panel.querySelector('.kite-panel-generate').addEventListener('click', () => {
      const width = Math.max(64, Number(panel.querySelector('.kite-panel-width').value) || 1024);
      const height = Math.max(64, Number(panel.querySelector('.kite-panel-height').value) || 1024);
      const model = panel.querySelector('.kite-panel-model').value;
      const mediaTypeSel = panel.querySelector('.kite-panel-media-type');
      const mediaType = mediaTypeSel ? mediaTypeSel.value : 'image';
      saveImagePanelSettings(panel);
      const inputs = panel.collectEditInputs();
      const editTa = panel.querySelector('.kite-panel-prompt');
      let prompt = editTa.value.trim();
      const linkedPrompt = inputs.prompts.join('\n').trim();
      if (!prompt && linkedPrompt) { prompt = linkedPrompt; editTa.value = prompt; }
      const imgs = inputs.images;
      const status = panel.querySelector('.kite-panel-status');
      if (!imgs.length) { status.textContent = '请先从图片/视频节点的输出圆点拖线连到左下方圆点'; return; }
      if (!prompt) { status.textContent = '请输入修改要求（可用 @图片N 引用）'; return; }
      // 结果：已连结果预览则直接更新；否则右侧自动创建结果节点并连线
      if (!panel._imageNode || !state.nodes.has(panel._imageNode.id)) {
        const pr = panel.getBoundingClientRect();
        const hr = host.getBoundingClientRect();
        const nx = pr.right - hr.left + 60, ny = pr.top - hr.top + 40;
        const imgNode = addNode({ type: mediaType === 'video' ? 'video' : 'image', src: '', prompt, x: nx, y: ny, pending: true, ratio: width / height });
        createResultLinkFor(panel, imgNode);
      }
      panel._imageNode.ratio = width / height;
      setImagePanelGenerating(panel, true, mediaType === 'video' ? '正在生成视频（可能需要较长时间）...' : '正在根据 ' + imgs.length + ' 张参考图生成新图片...');
      if (mediaType === 'video') {
        // 视频修改：把参考图 URL 并入提示词，走 video_gen 通道
        let vPrompt = prompt;
        if (imgs.length) vPrompt += '\n参考素材：' + imgs.join('\n');
        const vPayload = { action: 'generate', prompt: vPrompt, size: width + 'x' + height, model };
        let vResult;
        try { vResult = window.Tools && Tools._callToolApi ? Tools._callToolApi('video_gen', vPayload, '视频修改') : null; } catch (e) { vResult = null; }
        if (!vResult || typeof vResult.then !== 'function') { setImagePanelGenerating(panel, false, '当前无法调用视频生成接口'); return; }
        vResult.then(data => {
          let url = data && (data.url || (data.data && (data.data.url || ((data.data.videos || [])[0] || {}).url)));
          if (!url && data && data.videos && data.videos[0]) url = data.videos[0].url;
          if (url) {
            applyMediaNodeUrl(panel._imageNode.id, url, prompt, 'video');
            refreshPanelLink(panel);
            setImagePanelGenerating(panel, false, '视频生成完成');
            if (window.ImageViewer && ImageViewer.show) { try { ImageViewer.show(url); } catch (e) {} }
          } else setImagePanelGenerating(panel, false, (data && data.error) || '视频生成失败');
        }).catch(() => { setImagePanelGenerating(panel, false, '视频生成失败'); });
        return;
      }
      const payload = { action: 'edit_multi', prompt, size: width + 'x' + height, model, image_urls: imgs };
      let result;
      try { result = window.Tools && Tools._callToolApi ? Tools._callToolApi('image_gen', payload, '图片修改') : null; } catch (e) { result = null; }
      if (!result || typeof result.then !== 'function') { setImagePanelGenerating(panel, false, '当前无法调用生图接口'); return; }
      result.then(data => {
        const url = data && (data.url || (data.data && data.data.url) || (data.result && data.result.url));
        if (url) {
          applyMediaNodeUrl(panel._imageNode.id, url, prompt, 'image');
          refreshPanelLink(panel);
          setImagePanelGenerating(panel, false, '生成完成');
          // 统一输出：图片修改完成后右侧浮动查看窗同步显示
          if (window.ImageViewer) ImageViewer.show(url);
        } else setImagePanelGenerating(panel, false, (data && data.error) || '生成失败');
      }).catch(() => { setImagePanelGenerating(panel, false, '生成失败'); });
    });
    return panel;
  }

  // 双击画布空白处：直接弹出「创建对话框」双栏面板（左=文本模型，右=视觉功能），不再显示三按钮工具条
  function openDualPanels(clientX, clientY) {
    const host = document.getElementById('canvasContent') || document.body;
    // 双击弹出创建面板时立即隐藏画布中央的引导提示（不等真正创建对话框后才消失）
    var _hint = document.getElementById('canvasHint');
    if (_hint && _hint.style.display !== 'none') {
      _hint.style.display = 'none';
      // 标记由面板触发的隐藏：面板关闭且画布仍无对话时应恢复提示
      _hint._hiddenByDualPanel = true;
    }
    // 清掉旧实例
    // 新建创建面板不应关闭已经打开的文生图面板；只替换同类创建面板。
    document.querySelectorAll('.kite-dual-create-panel').forEach(p => p.remove());
    const oldBar = document.querySelector('.kite-toolbar');
    if (oldBar) oldBar.remove();

    // 屏幕坐标 -> 画布内坐标（画布有 transform 平移，getBoundingClientRect 抵消）
    const rect = host.getBoundingClientRect();
    const origin = { x: clientX - rect.left, y: clientY - rect.top };
    const anchor = { x: origin.x + 12, y: origin.y + 16 };
    const panel = dualPanelBuilders.get('chat')(host, anchor, origin);
    if (panel) { panel.classList.add('kite-dual-panel'); panel.style.zIndex = 10001; }
    return { toolbar: null };

  }

  // ---------- 文生图配置面板 ----------
  function openImagePanel(textNode, releasePoint, keepActionMenu, sourceLinkPath) {
    if (!keepActionMenu) closeActionMenu();
    // 打开任意视觉面板（文生图等）时同样隐藏画布中央的「双击创建」引导提示
    var _hint2 = document.getElementById('canvasHint');
    if (_hint2 && _hint2.style.display !== 'none') {
      _hint2.style.display = 'none';
      _hint2._hiddenByDualPanel = true;
    }
    const old = document.querySelector('.kite-image-panel');
    if (old) old.remove();
    const panel = document.createElement('section');
    panel.className = 'kite-image-panel';
    panel.innerHTML = `<div class="kite-panel-header"><h3>文生图</h3><button type="button" class="kite-panel-close" title="关闭">✕</button></div>
      <label>提示词</label><textarea class="kite-textarea kite-panel-prompt" style="height:76px;min-height:76px;resize:vertical">${escapeHtml(textNode.text || '')}</textarea>
      <label>尺寸</label><div class="kite-size-row"><div><input class="kite-panel-width" type="number" min="64" max="4096" value="1024" aria-label="宽度"></div><button type="button" class="kite-panel-swap-size" title="反转宽高比" aria-label="反转宽高比"><span></span></button><div><input class="kite-panel-height" type="number" min="64" max="4096" value="1024" aria-label="高度"></div></div>
      <label>大模型</label><select class="kite-panel-model"></select>
      <div class="kite-panel-status"></div><div class="kite-panel-actions"><button type="button" class="kite-panel-cancel">取消</button><button type="button" class="primary kite-panel-generate">生成</button></div>`;
    // releasePoint 是视口坐标，面板挂在 canvasContent（带 transform 平移），需先转画布内坐标
    const host = document.getElementById('canvasContent') || document.body;
    const hostRect = host.getBoundingClientRect();
    const local = { x: releasePoint.x - hostRect.left, y: releasePoint.y - hostRect.top };
    const panelSize = getKiteDefaultSize('imagePanel');
    panel.style.left = (local.x + 24) + 'px';
    panel.style.top = (local.y + 24) + 'px';
    panel.style.right = 'auto';
    panel.style.width = panelSize.w + 'px';
    panel.style.height = panelSize.h + 'px';
    panel.dataset.kiteSizeKind = 'imagePanel';
    host.appendChild(panel);
    ['mousedown', 'click', 'dblclick'].forEach(type => {
      panel.addEventListener(type, e => e.stopPropagation());
    });
    bindSourcePrompt(panel, textNode, sourceLinkPath);
    // 设置持久化 + 视觉模型联动（与双击菜单文生图面板共用）
    loadImagePanelSettings(panel);
    bindImagePanelControls(panel);
    fillImageModelSelect(panel.querySelector('.kite-panel-model'));
    if (window.Models && !Models._loaded && typeof Models.load === 'function') {
      Models.load().then(function () { fillImageModelSelect(panel.querySelector('.kite-panel-model')); }).catch(function () {});
    }
    function closePanelCleanup() {
      saveImagePanelSettings(panel);
      if (panel._sourcePromptCleanup) panel._sourcePromptCleanup();
      if (panel._linkPath) { panel._linkPath.remove(); panel._linkPath = null; }
      if (panel._linkObserver && panel._unregisterPanelRefresher) { panel._unregisterPanelRefresher(); panel._linkObserver = null; }
      panel.remove();
    }
    panel.querySelector('.kite-panel-close').addEventListener('click', closePanelCleanup);
    panel.querySelector('.kite-panel-cancel').addEventListener('click', closePanelCleanup);
    bindPanelWindow(panel);
    // 右侧输出小圆点：拖出一条线，松开后在落点创建图片节点（并与面板建立持久连线，两端贴住小圆点）
    const outPort = document.createElement('div');
    outPort.className = 'kite-port kite-port-out kite-panel-out-port';
    outPort.title = '拖出以放置生成图片';
    panel.appendChild(outPort);
    const promptPort = document.createElement('div');
    promptPort.className = 'kite-port kite-port-in kite-panel-in-port';
    promptPort.title = '拖出以创建提示词面板';
    panel.appendChild(promptPort);
    bindAuxPort(promptPort, 'prompt', panel, host);
    // 输出端口绑定查看面板管线（viewer），title 只赋最终值，避免冗余赋值造成语义混乱
    outPort.title = '拖出以打开图片查看面板';
    bindAuxPort(outPort, 'viewer', panel, host);
    // 建立/重建 面板->图片节点 的持久连线（左侧贴节点入点小圆点，右侧贴面板出点小圆点）
    function createPanelLinkFor(pnl, imgNode) {
      if (pnl._linkPath) { pnl._linkPath.remove(); pnl._linkPath = null; }
      const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p2.setAttribute('class', 'kite-curve');
      p2.dataset.from = 'panel';
      p2.dataset.to = imgNode.id;
      state.svg.appendChild(p2);
      pnl._linkPath = p2;
      pnl._imageNode = imgNode;
      if (!pnl._linkObserver) observePanelMove(pnl);
      refreshPanelLink(pnl);
    }
    panel.createPanelLink = createPanelLinkFor;
    panel.querySelector('.kite-panel-generate').addEventListener('click', () => {
      const prompt = panel.querySelector('.kite-panel-prompt').value.trim();
      const width = Math.max(64, Number(panel.querySelector('.kite-panel-width').value) || 1024);
      const height = Math.max(64, Number(panel.querySelector('.kite-panel-height').value) || 1024);
      const model = panel.querySelector('.kite-panel-model').value;
      const status = panel.querySelector('.kite-panel-status');
      saveImagePanelSettings(panel); // 生成时也记住本次设置
      if (!prompt) { status.textContent = '请输入提示词'; return; }
      if (!panel._imageNode || !state.nodes.has(panel._imageNode.id)) {
        const hr = host.getBoundingClientRect();
        const local = { x: releasePoint.x - hr.left, y: releasePoint.y - hr.top };
        panel._imageNode = addNode({ type: 'image', src: '', prompt, x: local.x + 24, y: local.y - 100, pending: true, ratio: width / height });
        if (typeof panel.createPanelLink === 'function') panel.createPanelLink(panel, panel._imageNode);
      }
      panel._imageNode.ratio = width / height;
      setImagePanelGenerating(panel, true);
      const payload = { action: 'generate', prompt, size: width + 'x' + height, model };
      let result;
      try { result = window.Tools && Tools._callToolApi ? Tools._callToolApi('image_gen', payload, '画布文生图') : null; } catch (e) { result = null; }
      if (result && typeof result.then === 'function') {
        result.then(data => handleImagePanelResult(data, prompt, textNode, panel, releasePoint)).catch(() => { setImagePanelGenerating(panel, false, '生成失败'); });
      } else {
        setImagePanelGenerating(panel, false, '当前无法调用生图接口');
      }
    });
  }

  function handleImagePanelResult(data, prompt, textNode, panel, releasePoint) {
    const url = data && (data.url || (data.data && data.data.url) || (data.result && data.result.url));
    if (url) {
      // 从提示词节点拉线弹出的面板：图片节点跟随提示词节点右侧，再次生成更新同一节点
      const host = document.getElementById('canvasContent') || document.body;
      const hr = host.getBoundingClientRect();
      const local = { x: releasePoint.x - hr.left, y: releasePoint.y - hr.top };
      if (panel._imageNode && state.nodes.has(panel._imageNode.id)) {
        updateImageNode(panel._imageNode.id, { url, prompt });
      } else {
        panel._imageNode = addNode({ type: 'image', src: url, prompt, x: local.x + 24, y: local.y - 100 });
        // 建立面板->图片节点持久连线（两端贴住小圆点）
        if (typeof panel.createPanelLink === 'function') panel.createPanelLink(panel, panel._imageNode);
      }
      refreshPanelLink(panel);
      setImagePanelGenerating(panel, false, '生成完成');
      // 统一输出：生成完成后右侧浮动查看窗同步显示
      if (window.ImageViewer) ImageViewer.show(url);
    } else setImagePanelGenerating(panel, false, (data && data.error) || '生成失败');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  // 工具面板作为画布窗口：标题栏移动，八方向调整尺寸。
  function bindPanelWindow(panel) {
    let drag = null;
    const header = panel.querySelector('.kite-panel-header');
    if (!header) return;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      drag = { sx: e.clientX, sy: e.clientY, left: panel.offsetLeft, top: panel.offsetTop };
      e.preventDefault();
    });
    const handles = ['nw','ne','se','sw'];
    handles.forEach((dir) => {
      const handle = document.createElement('span');
      handle.className = 'kite-panel-resize kite-panel-resize-' + dir;
      handle.dataset.dir = dir;
      panel.appendChild(handle);
      handle.addEventListener('mousedown', (e) => {
        drag = { mode: 'resize', dir, sx: e.clientX, sy: e.clientY, left: panel.offsetLeft, top: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight };
        e.preventDefault();
        e.stopPropagation();
      });
    });
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (drag.mode === 'resize') {
        let left = drag.left, top = drag.top, width = drag.width, height = drag.height;
        if (drag.dir.includes('e')) width = Math.max(240, drag.width + dx);
        if (drag.dir.includes('w')) { width = Math.max(240, drag.width - dx); left = drag.left + drag.width - width; }
        if (!panel.classList.contains('kite-dual-create-panel')) {
          if (drag.dir.includes('s')) height = Math.max(180, drag.height + dy);
          if (drag.dir.includes('n')) { height = Math.max(180, drag.height - dy); top = drag.top + drag.height - height; }
        }
        Object.assign(panel.style, { left: left + 'px', top: top + 'px', width: width + 'px' });
        if (!panel.classList.contains('kite-dual-create-panel')) panel.style.height = height + 'px';
      } else {
        panel.style.left = (drag.left + dx) + 'px';
        panel.style.top = (drag.top + dy) + 'px';
      }
    };
    const up = () => {
      if (drag && drag.mode === 'resize' && panel.dataset.kiteSizeKind) {
        saveKiteDefaultSize(panel.dataset.kiteSizeKind, panel.offsetWidth, panel.offsetHeight);
      }
      drag = null;
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function closeActionMenu() {
    const menu = document.querySelector('.kite-action-menu');
    if (menu && typeof menu._cleanupLink === 'function') menu._cleanupLink();
    if (menu) menu.remove();
  }

  function showActionMenu(textNode, x, y, link) {
    closeActionMenu();
    const menu = document.createElement('div');
    menu.className = 'kite-action-menu';
    menu.style.left = Math.min(x + 8, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y + 8, window.innerHeight - 70) + 'px';
    menu.innerHTML = '<button type="button" data-create="image"><span class="kite-action-port"></span>文生图</button><button type="button" data-create="prompt"><span class="kite-action-port"></span>提示词</button>';
    const button = menu.querySelector('button[data-create="image"]');
    let linked = false;
    let dismissTimer = null;
    const refreshLink = () => {
      if (!link || !link.path || !link.path.isConnected) return;
      const hr = (state.canvas || document.body).getBoundingClientRect();
      const sp = textNode.el.querySelector('.kite-output-port');
      if (!sp) return;
      const source = sp.getBoundingClientRect();
      const target = button.querySelector('.kite-action-port').getBoundingClientRect();
      link.path.setAttribute('d', bezierPath(source.left + source.width / 2 - hr.left, source.top + source.height / 2 - hr.top, target.left + target.width / 2 - hr.left, target.top + target.height / 2 - hr.top));
    };
    const cleanupLink = () => {
      if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
      if (link && link.path) link.path.remove();
      document.removeEventListener('mousemove', refreshLink);
      window.removeEventListener('resize', refreshLink);
    };
    const dismiss = () => {
      if (!linked) cleanupLink();
      menu.remove();
    };
    menu._cleanupLink = cleanupLink;
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      linked = true;
      if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
      refreshLink();
      openImagePanel(textNode, { x, y }, true, link && link.path ? link.path : null);
    });
    menu.querySelector('button[data-create="prompt"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      linked = true;
      cleanupLink();
      const host = state.canvas || document.getElementById('canvasContent') || document.body;
      const hr = host.getBoundingClientRect();
      const promptNode = addNode({ type: 'text', text: '', x: x - hr.left + 24, y: y - hr.top - 70 });
      if (promptNode) createNodeLink(textNode, promptNode);
      menu.remove();
    });
    document.body.appendChild(menu);
    refreshLink();
    document.addEventListener('mousemove', refreshLink);
    window.addEventListener('resize', refreshLink);
    dismissTimer = setTimeout(dismiss, 3000);
    setTimeout(() => document.addEventListener('mousedown', function dismissOnOutsideClick(e) {
      if (!e.target || !menu.contains(e.target)) dismiss();
      document.removeEventListener('mousedown', dismissOnOutsideClick);
    }, { once: true }), 0);
  }

  // ---------- 创建节点 ----------
  // data: { type:'image'|'video'|'text', src, prompt, text, chatId?, x?, y? }
  function addNode(data) {
    init();
    const id = 'kn' + (state.nextId++);
    const x = data.x ?? (window.scrollX + window.innerWidth / 2 - 160);
    const y = data.y ?? (window.scrollY + window.innerHeight / 2 - 120);

    const nodeKind = data.type === 'text' ? 'prompt' : 'image';
    const nodeSize = getKiteDefaultSize(nodeKind);
    const el = document.createElement('div');
    el.className = 'kite-node kite-node-' + (data.type || 'image');
    el.dataset.id = id;
    el.dataset.kiteSizeKind = nodeKind;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.width = nodeSize.w + 'px';
    el.style.height = nodeSize.h + 'px';
    el.style.zIndex = ++state.zIndex;

    // 文本节点与媒体节点共用同一套拖动/缩放容器。
    if (data.type === 'text') {
      el.classList.add('kite-node-text');
      const header = document.createElement('div');
      header.className = 'kite-text-header kite-node-bar';
      header.innerHTML = '<span class="kite-node-type">✎</span><span class="kite-node-title">提示词</span><button type="button" class="kite-text-close" title="关闭">✕</button>';
      // 缩放手柄拖拽后标记手动高度，让 textarea 填满剩余空间（保持关闭按钮贴右）
      el.addEventListener('mousedown', (e) => {
        const hd = e.target.closest('.kite-handle');
        if (hd && hd.dataset.handle && hd.dataset.handle.includes('s')) {
          requestAnimationFrame(() => { el.classList.add('kite-manual-height'); autoGrowPrompt(input, true); });
        }
      }, true);
      const body = document.createElement('div');
      body.className = 'kite-text-body';
      const input = document.createElement('textarea');
      input.className = 'kite-textarea';
      input.placeholder = '输入图片描述...';
      input.value = data.text || data.prompt || '';
      input.addEventListener('input', () => { node.text = input.value; autoGrowPrompt(input); });
      // 背景适配文字尺寸：不支持 field-sizing 的浏览器用 JS 自适应高度
      requestAnimationFrame(() => autoGrowPrompt(input));
      function autoGrowPrompt(ta, manual) {
        try {
          if (manual && el.classList.contains('kite-manual-height')) { ta.style.height = '100%'; return; }
          if (CSS.supports && CSS.supports('field-sizing', 'content')) return;
          ta.style.height = 'auto';
          ta.style.height = Math.min(Math.max(ta.scrollHeight, 56), 420) + 'px';
          el.style.height = 'auto';
        } catch (e) {}
      }
      body.appendChild(input);
      el.appendChild(header);
      el.appendChild(body);
      // 已移除：提示词节点右侧输出端口小球（kite-output-port）
    } else {
      // 媒体区
      const media = document.createElement('div');
      media.className = 'kite-node-media';
      if (data.type === 'video') {
        const v = document.createElement('video');
        v.src = data.src;
        v.controls = true;
        v.autoplay = true;
        v.loop = true;
        v.muted = true;
        v.playsInline = true;
        media.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = data.src || '';
        img.alt = data.prompt || '';
        media.appendChild(img);
        // 无 src 时显示加载占位
        if (!data.src) {
          const loading = document.createElement('div');
          loading.className = 'kite-node-loading';
          loading.setAttribute('aria-label', '图片渲染中');
          media.appendChild(loading);
        }
        // 原图比例只用于后续等比缩放，不覆盖用户配置的图片缩略图默认尺寸。
        img.addEventListener('load', () => {
          const r = img.naturalWidth / img.naturalHeight;
          if (isFinite(r) && r > 0) node.ratio = r;
        });
      }
      const bar = document.createElement('div');
      bar.className = 'kite-node-bar';
      bar.innerHTML = `
        <span class="kite-node-type">${data.type === 'video' ? '🎬' : '🖼️'}</span>
        <span class="kite-node-title" title="${(data.prompt || '').replace(/"/g, '&quot;')}">${(data.prompt || '').slice(0, 30)}</span>
        <span class="kite-node-actions">
          <button class="kite-btn-zoom" title="放大">⤢</button>
          <button class="kite-btn-del" title="删除">✕</button>
        </span>`;
      // 拖拽条放顶部，媒体区在下方
      el.appendChild(bar);
      el.appendChild(media);
      // 媒体节点（图片/视频）：左侧入点 + 右侧出点小圆点，支持连入连出
      const inPort = document.createElement('div');
      inPort.className = 'kite-port kite-port-in kite-node-in-port';
      inPort.title = '输入端口（可连入）';
      el.appendChild(inPort);
      const outPort = document.createElement('div');
      outPort.className = 'kite-port kite-port-out kite-node-out-port';
      outPort.title = '输出端口（拖出连线）';
      el.appendChild(outPort);
      node_ports_setup(inPort, outPort);
    }

    // 仅四个角落的调节手柄（上下左右边手柄已移除）
    const handles = ['nw','ne','se','sw'];
    handles.forEach(h => {
      const hd = document.createElement('div');
      hd.className = 'kite-handle kite-handle-' + h;
      hd.dataset.handle = h;
      el.appendChild(hd);
    });

    state.canvas.appendChild(el);

    const node = { id, type: data.type || 'image', text: data.text || data.prompt || '', x, y, w: nodeSize.w, h: nodeSize.h, ratio: data.ratio || 0, el };
    state.nodes.set(id, node);
    bindNodeEvents(node);
    if (data.type === 'text') bindTextOutput(node);
    if (data.type === 'text') {
      el.querySelector('.kite-textarea').addEventListener('mousedown', e => e.stopPropagation());
      const close = el.querySelector('.kite-text-close');
      if (close) close.addEventListener('click', (e) => { e.stopPropagation(); removeNode(node.id); });
    }
    // 生成中：节点带 loading 状态可先创建，稍后通过 updateSrc 填充图片
    if (data.pending) node.pending = true;
    return node;
  }

  // 更新图片节点内容（再次生成时复用同一节点，图片跟着更新，不重复创建）
  function applyMediaNodeUrl(id, url, prompt, type) {
    // 按类型把 URL 填入已有节点；若节点类型不匹配则移除重建为对应类型
    const node = state.nodes.get(id);
    if (node && node.type === (type || 'image')) {
      if (type === 'video') return updateVideoNode(id, { url, prompt });
      return updateImageNode(id, { url, prompt });
    }
    if (!node) return null;
    const x = node.x, y = node.y, ratio = node.ratio;
    const oldId = id;
    removeNode(id);
    const newNode = addNode({ type: type === 'video' ? 'video' : 'image', src: url, prompt: prompt || '', x, y, ratio });
    // 【修复】类型切换重建后，把所有仍指向旧节点的面板连线重新挂到新节点上，避免连线永久断开
    if (newNode) {
      document.querySelectorAll('.kite-image-panel').forEach(p => {
        if (p._imageNode && p._imageNode.id === oldId) {
          if (typeof p.createPanelLink === 'function') p.createPanelLink(p, newNode);
          else { p._imageNode = newNode; }
        }
      });
      scheduleAllPanelRefresh();
    }
    return newNode;
  }
  // 更新视频节点内容
  function updateVideoNode(id, data) {
    const node = state.nodes.get(id);
    if (!node || node.type !== 'video') return null;
    let v = node.el.querySelector('.kite-node-media video');
    const loading = node.el.querySelector('.kite-node-loading');
    if (loading) loading.remove();
    if (!v) {
      v = document.createElement('video');
      v.controls = true; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      node.el.querySelector('.kite-node-media').appendChild(v);
    }
    if (data.url) { v.src = data.url; v.play().catch(() => {}); node.pending = false; }
    const title = node.el.querySelector('.kite-node-title');
    if (title && data.prompt) {
      title.textContent = (data.prompt || '').slice(0, 30);
      title.title = data.prompt;
    }
    updateCurvesToNearestChat(node);
    return node;
  }
  function updateImageNode(id, data) {
    const node = state.nodes.get(id);
    if (!node || node.type !== 'image') return null;
    const img = node.el.querySelector('.kite-node-media img');
    const loading = node.el.querySelector('.kite-node-loading');
    if (loading) loading.remove();
    if (img && data.url) {
      img.src = data.url;
      node.pending = false;
    }
    const title = node.el.querySelector('.kite-node-title');
    if (title && data.prompt) {
      title.textContent = (data.prompt || '').slice(0, 30);
      title.title = data.prompt;
    }
    updateCurvesToNearestChat(node);
    return node;
  }

  // ---------- 媒体节点小圆点：左入右出，可拖出连线到其他节点入点 ----------
  function node_ports_setup(inPort, outPort) {
    const el = inPort.parentElement;
    const nodeId = el.dataset.id;
    // 统一管线：出点拉出宽3预览线，松开时命中其它节点/改图面板则建立持久连线
    bindPortLinkDrag(outPort, (_p, _cp, vp) => {
      // 先看是否落在改图面板的输入小圆上（提示词/参考图输入）
      // 【修复】按视口坐标外扩 14px 命中容差，并支持直接落在面板上就近接入对应端口
      const expanded = document.elementsFromPoint(vp.x, vp.y)
        .concat(document.elementsFromPoint(vp.x + 14, vp.y), document.elementsFromPoint(vp.x - 14, vp.y),
                document.elementsFromPoint(vp.x, vp.y - 14), document.elementsFromPoint(vp.x, vp.y + 14));
      let editPanelEl = null;
      for (const t of expanded) {
        const p = t.closest && t.closest('.kite-edit-panel');
        if (p) { editPanelEl = p; break; }
      }
      if (editPanelEl && typeof editPanelEl.connectNodeToEdit === 'function') {
        if (editPanelEl.connectNodeToEdit(nodeId)) return;
      }
      // 命中检测：落在哪个 kite-node 上（排除自身）
      const hitEl = document.elementsFromPoint(vp.x, vp.y)
        .find(t => t.closest && t.closest('.kite-node') && t.closest('.kite-node').dataset.id !== nodeId);
      if (!hitEl) return;
      const targetEl = hitEl.closest('.kite-node');
      const target = state.nodes.get(targetEl.dataset.id);
      if (!target) return;
      // 建立持久连线：源节点出点 -> 目标节点入点
      createNodeLink(state.nodes.get(nodeId), target);
    });
  }
  // 建立 节点->节点 持久连线（from 出点 / to 入点），替换旧的
  function createNodeLink(fromNode, toNode) {
    if (!fromNode || !toNode || fromNode.id === toNode.id) return null;
    state.svg.querySelectorAll(`[data-from="${fromNode.id}"][data-to="${toNode.id}"]`).forEach(s => s.remove());
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'kite-curve');
    p.dataset.from = fromNode.id;
    p.dataset.to = toNode.id;
    state.svg.appendChild(p);
    if (!fromNode._nodeLinks) fromNode._nodeLinks = [];
    fromNode._nodeLinks.push(p);
    if (!toNode._nodeLinks) toNode._nodeLinks = [];
    toNode._nodeLinks.push(p);
    refreshNodeLink(fromNode, toNode, p);
    return p;
  }
  function refreshNodeLink(fromNode, toNode, p) {
    const a = nodePortCenter(fromNode, 'out');
    const b = nodePortCenter(toNode, 'in');
    p.setAttribute('d', bezierPath(a.x, a.y, b.x, b.y));
  }
  // 节点移动/缩放后，刷新与该节点相关的所有节点↔节点连线
  function refreshNodeLinksOf(node) {
    state.svg.querySelectorAll(`[data-from="${node.id}"],[data-to="${node.id}"]`).forEach(p => {
      if (p.dataset.from === 'panel') return; // 面板连线由 updateCurvesToNearestChat 里统一刷新
      const f = state.nodes.get(p.dataset.from), t = state.nodes.get(p.dataset.to);
      if (f && t) refreshNodeLink(f, t, p);
    });
  }


  function bindTextOutput(node) {
    const port = node.el.querySelector('.kite-output-port');
    if (!port) return;
    // 统一管线：拉出宽3预览线，松开时先尝试接入改图面板，否则弹出动作菜单
    bindPortLinkDrag(port, (_p, cp, vp) => {
      const ep = document.elementsFromPoint(vp.x, vp.y)
        .map(t => t.closest && t.closest('.kite-edit-panel')).find(Boolean);
      if (!(ep && typeof ep.connectNodeToEdit === 'function' && ep.connectNodeToEdit(node.id))) {
        showActionMenu(node, vp.x, vp.y, null);
      }
    });
  }

  // ---------- 节点事件：拖动 / 缩放 ----------
  function bindNodeEvents(node) {
    const el = node.el;
    let drag = null;

    // 拖动
    el.querySelector('.kite-node-bar').addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      el.classList.add('dragging');
      drag = { mode: 'move', sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y };
      e.preventDefault();
    });

    // 缩放手柄（图片节点按生成比例等比缩放）
    el.querySelectorAll('.kite-handle').forEach(hd => {
      hd.addEventListener('mousedown', (e) => {
        const ratio = (node.type === 'image' && node.ratio) ? node.ratio : 0;
        drag = { mode: 'resize', dir: hd.dataset.handle, ratio, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y, ow: node.w, oh: node.h };
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // 选中
    el.addEventListener('mousedown', () => {
      state.canvas.querySelectorAll('.kite-node').forEach(n => n.classList.remove('selected'));
      el.classList.add('selected');
      el.style.zIndex = ++state.zIndex;
    });

    // 按钮
    const deleteButton = el.querySelector('.kite-btn-del');
    if (deleteButton) deleteButton.addEventListener('click', (e) => { e.stopPropagation(); removeNode(node.id); });
    const zoomButton = el.querySelector('.kite-btn-zoom');
    if (zoomButton) zoomButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = el.querySelector('img,video')?.src;
      if (!url) return;
      const m = document.createElement('div');
      m.className = 'kite-modal';
      m.innerHTML = `<div class="kite-modal-inner">${node.type === 'video' ? `<video src="${url}" controls autoplay loop muted></video>` : `<img src="${url}">`}<span class="kite-modal-close">✕</span></div>`;
      m.addEventListener('click', () => m.remove());
      document.body.appendChild(m);
    });

    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (drag.mode === 'move') {
        node.x = drag.ox + dx;
        node.y = drag.oy + dy;
        el.style.left = node.x + 'px';
        el.style.top  = node.y + 'px';
        updateCurvesToNearestChat(node);
        refreshNodeLinksOf(node);
      } else if (drag.mode === 'resize') {
        const d = drag.dir;
        // 等比缩放：图片节点保持宽高比（与文生图生成比例一致），文本节点自由缩放
        if (drag.ratio) {
          const ratio = drag.ratio;
          let dx2 = 0, dy2 = 0;
          if (d.includes('e')) dx2 = dx;
          if (d.includes('s')) dy2 = dy;
          if (d.includes('w')) dx2 = -dx;
          if (d.includes('n')) dy2 = -dy;
          // 取变化幅度较大的轴作为基准，另一轴按比例跟随
          let scale = Math.abs(dx2) >= Math.abs(dy2) ? dx2 : dy2 * ratio;
          let newW = Math.max(120, drag.ow + scale);
          let newH = Math.max(90, drag.oh + newW / ratio - drag.ow / ratio);
          node.w = newW; node.h = newH;
          el.style.width = node.w + 'px'; el.style.height = node.h + 'px';
          if (d.includes('w')) node.x = drag.ox + (drag.ow - node.w);
          if (d.includes('n')) node.y = drag.oy + (drag.oh - node.h);
          if (d.includes('w')) el.style.left = node.x + 'px';
          if (d.includes('n')) el.style.top  = node.y + 'px';
        } else {
          if (d.includes('e')) { node.w = Math.max(120, drag.ow + dx); el.style.width = node.w + 'px'; }
          if (d.includes('s')) { node.h = Math.max(90,  drag.oh + dy); el.style.height = node.h + 'px'; }
          if (d.includes('w')) { node.w = Math.max(120, drag.ow - dx); node.x = drag.ox + (drag.ow - node.w); el.style.width = node.w + 'px'; el.style.left = node.x + 'px'; }
          if (d.includes('n')) { node.h = Math.max(90,  drag.oh - dy); node.y = drag.oy + (drag.oh - node.h); el.style.height = node.h + 'px'; el.style.top = node.y + 'px'; }
        }
        updateCurvesToNearestChat(node);
        refreshNodeLinksOf(node);
      }
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      if (drag.mode === 'resize') {
        saveKiteDefaultSize(el.dataset.kiteSizeKind, node.w, node.h);
      }
      el.classList.remove('dragging');
      drag = null;
    });
  }

  function removeNode(id) {
    const n = state.nodes.get(id);
    if (!n) return;
    n.el.remove();
    state.nodes.delete(id);
    state.svg.querySelectorAll(`[data-from="${id}"],[data-to="${id}"]`).forEach(s => s.remove());
  }

  // ---------- 曲线：自动连接节点和最近的对话 ----------
  function updateCurvesToNearestChat(node) {
    // 提示词等文本节点默认不自动连线（手动从小圆点拖出才连）；仅图片/视频等媒体节点自动连最近对话
    if (node && node.type === 'text') return;
    // 只移除非“面板连线”的旧曲线；面板连线（data-from="panel"）保留并在之后刷新
    state.svg.querySelectorAll(`path:not([data-from="panel"])[data-from="${node.id}"], path:not([data-from="panel"])[data-to="${node.id}"]`).forEach(s => s.remove());
    // 刷新所有连到该节点的面板连线（贴住小圆点）
    document.querySelectorAll('.kite-image-panel').forEach(p => {
      if (p._imageNode && p._imageNode.id === node.id) refreshPanelLink(p);
    });
    // 刷新所有以该节点为源的面板连线
    document.querySelectorAll('.kite-image-panel').forEach(p => refreshPanelLink(p));

    const chats = document.querySelectorAll('.chatbox');
    if (!chats.length) return;
    let best = null, bestD = Infinity;
    chats.forEach(c => {
      if (c.offsetParent === null) return;
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(cx - (node.x + node.w / 2), cy - (node.y + node.h / 2));
      if (d < bestD) { bestD = d; best = c; }
    });
    if (!best) return;
    const cr = best.getBoundingClientRect();
    const hr0 = (state.canvas || document.getElementById('canvasContent') || document.body).getBoundingClientRect();
    const cx = cr.left + cr.width / 2 - hr0.left, cy = cr.top + cr.height / 2 - hr0.top;
    const nx = node.x + node.w / 2, ny = node.y + node.h / 2;

    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', bezierPath(nx, ny, cx, cy));
    p.setAttribute('class', 'kite-curve');
    p.dataset.from = node.id;
    p.dataset.to = best.id || '';
    state.svg.appendChild(p);
  }

  // ---------- 暴露 API ----------
  window.KiteCanvas = {
    addNode,
    openDualPanels,
    addTextNode(opts) {
      opts = opts || {};
      return addNode({ type: 'text', text: opts.text || opts.prompt || '', x: opts.x, y: opts.y });
    },
    removeNode,
    // 修复：tools.js 视频生成后调用 addVideoNode({url, prompt, connectToChat}) 自动上画布，原方法不存在导致静默失效
    addVideoNode(opts) {
      opts = opts || {};
      const url = opts.url || '';
      if (!url) return null;
      // 转换为 addNode 需要的 {type, src, prompt, chatId} 格式
      return addNode({ type: 'video', src: url, prompt: opts.prompt || '', chatId: opts.connectToChat || undefined });
    },
    // 生图/修图完成后自动上画布：addImageNode({url, prompt, connectToChat})
    addImageNode(opts) {
      opts = opts || {};
      const url = opts.url || '';
      if (!url) return null;
      // 同一 prompt 的图片节点若已存在则更新（避免重复创建）
      const exist = Array.from(state.nodes.values()).find(n => n.type === 'image' && n.pending);
      if (exist) return updateImageNode(exist.id, { url, prompt: opts.prompt || '' });
      return addNode({ type: 'image', src: url, prompt: opts.prompt || '', chatId: opts.connectToChat || undefined });
    },
    // 显式更新图片节点
    updateImageNode,
    clear() {
      state.nodes.forEach((_, id) => removeNode(id));
    },
    list() { return Array.from(state.nodes.values()); },
    init,
  };

  // 页面加载完自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
