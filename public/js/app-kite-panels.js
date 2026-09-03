/* ============================================================
 * app-kite-panels.js - Kite 画布模块拆分：图片面板：设置读写/控件绑定/端口连线辅助面板
 * 由 app-kitecanvas.js 自动拆分，共享 window.__KiteNS 命名空间。
 * 加载顺序：core -> panels -> vision -> nodes -> links（见 index.html）
 * ============================================================ */
(function () {
  'use strict';
  const NS = (window.__KiteNS = window.__KiteNS || {});
  // ---- 本文件引用的外部符号（由前面的文件定义）----
  const KITE_DEFAULT_SIZES = NS.KITE_DEFAULT_SIZES; // from earlier file
  const KITE_DEFAULT_SIZES_KEY = NS.KITE_DEFAULT_SIZES_KEY; // from earlier file
  const addNode = NS.addNode; // from earlier file
  const applyMediaNodeUrl = NS.applyMediaNodeUrl; // from earlier file
  const bezierPath = NS.bezierPath; // from earlier file
  const bindPanelWindow = (p) => NS.bindPanelWindow && NS.bindPanelWindow(p); // defined in nodes.js, load later
  const state = NS.state; // from earlier file
  // ---- 本文件定义的符号（文件末尾统一写回 NS）----
// _panelRefreshers, _refreshQueued, bindAuxPort, bindImageEditControls, bindImagePanelControls, bindPortLinkDrag, bindSourcePrompt, dualPanelBuilders, ensureGlobalLinkListeners, fillImageModelSelect, getKiteDefaultSize, insertAtRef, loadImagePanelSettings, nodePortCenter, normalizeDataUrl, observePanelMove, openImageAuxPanel, panelPortCenter, readFilesAsDataUrls, refreshPanelLink, refreshSourceLink, registerPanelRefresher, renderEditRows, saveImagePanelSettings, saveKiteDefaultSize, scheduleAllPanelRefresh, setImagePanelGenerating


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
        </div>`;
      panel.style.left = anchor.x + 'px';
      panel.style.top = anchor.y + 'px';
      // ===== 尺寸记忆（private/用户设置/user_settings.json，关闭智能体后仍保留）=====
      // 只记忆宽度；高度由按钮内容自然撑开，避免模型数量变化后出现空白或裁切。
      try {
        var savedW = parseInt(UserSettings.get('zf3d_create_panel_w'), 10) || 0;
        panel.style.width = Math.min(savedW || 200, 200) + 'px'; // 单栏竖排按钮，宽度压窄
      } catch (e) { panel.style.width = '200px'; }
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
        // 创建对话只允许：语言模型 + 语音模型；图片/视频/识图/向量化即使可见也不显示
        if (m.imageGen) return false;
        const t = String(m.modelType || '').toLowerCase();
        if (t !== 'language' && t !== 'speech' && t !== 'audio' && t !== 'omni') return false;
        const ep = (m.endpoint || m.baseUrl || '').toLowerCase();
        if (ep.includes('/images/')) return false;
        if (ep.includes('embedding')) return false;
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
        // ===== 列表最下面：设置大模型入口（直接跳到任务面板的大模型设置页） =====
        const settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'kite-chat-item kite-chat-model-settings';
        settingsBtn.innerHTML = '<span class="ctx-icon">⚙️</span> 设置大模型';
        settingsBtn.title = '打开设置面板 · 大模型配置';
        settingsBtn.addEventListener('click', () => {
          panel.remove(); // 先关掉创建面板，避免遮挡
          try {
            // 打开设置面板的「大模型」配置页（与顶栏 ⚙️ 入口一致），而不是右侧任务面板
            if (window.App && typeof App.openSettingsPanel === 'function') {
              App.openSettingsPanel('models');
            } else {
              var ov = document.getElementById('settingsOverlay');
              if (ov) ov.classList.add('show');
            }
          } catch (err) { console.warn('打开设置大模型失败', err); }
        });
        list.appendChild(settingsBtn);
        if (list.children.length === 1) {
          list.innerHTML = '<div class="kite-chat-empty">暂无文本模型<br>请先在「⚙️ 模型配置」中添加</div>';
          list.appendChild(settingsBtn);
        }
      }
      // 首次填充：若 Models 尚未异步加载完成，等 load 完成后再填一次
      fillModelList();
      if (window.Models && !Models._loaded && typeof Models.load === 'function') {
        Models.load().then(function() { fillModelList(); }).catch(function() {});
      }
      return panel;
    }],
  ]);

  // ---------- 识图面板：左侧连线输入图片节点 -> 选识图模型识别 -> 结果右侧连线传到提示词/对话框 ----------

  // ---- 写回共享命名空间 ----
  var __defs = {_panelRefreshers: _panelRefreshers, _refreshQueued: _refreshQueued, bindAuxPort: bindAuxPort, bindImageEditControls: bindImageEditControls, bindImagePanelControls: bindImagePanelControls, bindPortLinkDrag: bindPortLinkDrag, bindSourcePrompt: bindSourcePrompt, dualPanelBuilders: dualPanelBuilders, ensureGlobalLinkListeners: ensureGlobalLinkListeners, fillImageModelSelect: fillImageModelSelect, getKiteDefaultSize: getKiteDefaultSize, insertAtRef: insertAtRef, loadImagePanelSettings: loadImagePanelSettings, nodePortCenter: nodePortCenter, normalizeDataUrl: normalizeDataUrl, observePanelMove: observePanelMove, openImageAuxPanel: openImageAuxPanel, panelPortCenter: panelPortCenter, readFilesAsDataUrls: readFilesAsDataUrls, refreshPanelLink: refreshPanelLink, refreshSourceLink: refreshSourceLink, registerPanelRefresher: registerPanelRefresher, renderEditRows: renderEditRows, saveImagePanelSettings: saveImagePanelSettings, saveKiteDefaultSize: saveKiteDefaultSize, scheduleAllPanelRefresh: scheduleAllPanelRefresh, setImagePanelGenerating: setImagePanelGenerating};
  for (var __k in __defs) NS[__k] = __defs[__k];
})();
