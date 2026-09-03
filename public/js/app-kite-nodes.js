/* ============================================================
 * app-kite-nodes.js - Kite 画布模块拆分：节点：文生图面板/节点创建/事件/更新
 * 由 app-kitecanvas.js 自动拆分，共享 window.__KiteNS 命名空间。
 * 加载顺序：core -> panels -> vision -> nodes -> links（见 index.html）
 * ============================================================ */
(function () {
  'use strict';
  const NS = (window.__KiteNS = window.__KiteNS || {});
  // ---- 本文件引用的外部符号（由前面的文件定义）----
  const bezierPath = NS.bezierPath; // from earlier file
  const bindAuxPort = NS.bindAuxPort; // from earlier file
  const bindImagePanelControls = NS.bindImagePanelControls; // from earlier file
  const bindPortLinkDrag = NS.bindPortLinkDrag; // from earlier file
  const bindSourcePrompt = NS.bindSourcePrompt; // from earlier file
  const fillImageModelSelect = NS.fillImageModelSelect; // from earlier file
  const getKiteDefaultSize = NS.getKiteDefaultSize; // from earlier file
  const init = NS.init; // from earlier file
  const loadImagePanelSettings = NS.loadImagePanelSettings; // from earlier file
  const nodePortCenter = NS.nodePortCenter; // from earlier file
  const observePanelMove = NS.observePanelMove; // from earlier file
  const refreshPanelLink = NS.refreshPanelLink; // from earlier file
  const removeNode = NS.removeNode; // from earlier file
  const saveImagePanelSettings = NS.saveImagePanelSettings; // from earlier file
  const saveKiteDefaultSize = NS.saveKiteDefaultSize; // from earlier file
  const scheduleAllPanelRefresh = NS.scheduleAllPanelRefresh; // from earlier file
  const setImagePanelGenerating = NS.setImagePanelGenerating; // from earlier file
  const state = NS.state; // from earlier file
  const updateCurvesToNearestChat = NS.updateCurvesToNearestChat; // from earlier file
  // ---- 本文件定义的符号（文件末尾统一写回 NS）----
// addNode, applyMediaNodeUrl, bindNodeEvents, bindPanelWindow, bindTextOutput, closeActionMenu, createNodeLink, escapeHtml, handleImagePanelResult, node_ports_setup, openImagePanel, refreshNodeLink, refreshNodeLinksOf, showActionMenu, updateImageNode, updateVideoNode


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
    // 工作区恢复时按存档尺寸重建
    const sizeW = (data.w && data.w > 40) ? data.w : nodeSize.w;
    const sizeH = (data.h && data.h > 40) ? data.h : nodeSize.h;
    const el = document.createElement('div');
    el.className = 'kite-node kite-node-' + (data.type || 'image');
    el.dataset.id = id;
    el.dataset.kiteSizeKind = nodeKind;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.width = sizeW + 'px';
    el.style.height = sizeH + 'px';
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

    const node = { id, type: data.type || 'image', text: data.text || data.prompt || '', x, y, w: sizeW, h: sizeH, ratio: data.ratio || 0, el };
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

    // 选中：普通=单选；Ctrl=加选/切换；Alt=减选
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.altKey) { el.classList.remove('selected'); return; }
        // Ctrl：已选中则取消，未选中则加入
        el.classList.toggle('selected');
        if (el.classList.contains('selected')) el.style.zIndex = ++state.zIndex;
        return;
      }
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


  // ---- 写回共享命名空间 ----
  var __defs = {addNode: addNode, applyMediaNodeUrl: applyMediaNodeUrl, bindNodeEvents: bindNodeEvents, bindPanelWindow: bindPanelWindow, bindTextOutput: bindTextOutput, closeActionMenu: closeActionMenu, createNodeLink: createNodeLink, escapeHtml: escapeHtml, handleImagePanelResult: handleImagePanelResult, node_ports_setup: node_ports_setup, openImagePanel: openImagePanel, refreshNodeLink: refreshNodeLink, refreshNodeLinksOf: refreshNodeLinksOf, showActionMenu: showActionMenu, updateImageNode: updateImageNode, updateVideoNode: updateVideoNode};
  for (var __k in __defs) NS[__k] = __defs[__k];
})();
