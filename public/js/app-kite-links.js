/* ============================================================
 * app-kite-links.js - Kite 画布模块拆分：连线刷新/节点连线/暴露 window.KiteCanvas API
 * 由 app-kitecanvas.js 自动拆分，共享 window.__KiteNS 命名空间。
 * 加载顺序：core -> panels -> vision -> nodes -> links（见 index.html）
 * ============================================================ */
(function () {
  'use strict';
  const NS = (window.__KiteNS = window.__KiteNS || {});
  // ---- 本文件引用的外部符号（由前面的文件定义）----
  const addNode = NS.addNode; // from earlier file
  const bezierPath = NS.bezierPath; // from earlier file
  const init = NS.init; // from earlier file
  const openDualPanels = NS.openDualPanels; // from earlier file
  const refreshPanelLink = NS.refreshPanelLink; // from earlier file
  const state = NS.state; // from earlier file
  const updateImageNode = NS.updateImageNode; // from earlier file
  // ---- 本文件定义的符号（文件末尾统一写回 NS）----
// removeNode, updateCurvesToNearestChat


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

  // ---- 写回共享命名空间 ----
  var __defs = {removeNode: removeNode, updateCurvesToNearestChat: updateCurvesToNearestChat};
  for (var __k in __defs) NS[__k] = __defs[__k];
})();
