/* ============================================================
 * app-kite-vision.js - Kite 画布模块拆分：识图面板/修图面板/双栏面板
 * 由 app-kitecanvas.js 自动拆分，共享 window.__KiteNS 命名空间。
 * 加载顺序：core -> panels -> vision -> nodes -> links（见 index.html）
 * ============================================================ */
(function () {
  'use strict';
  const NS = (window.__KiteNS = window.__KiteNS || {});
  // ---- 本文件引用的外部符号（由前面的文件定义）----
  const addNode = NS.addNode; // from earlier file
  const applyMediaNodeUrl = NS.applyMediaNodeUrl; // from earlier file
  const bezierPath = NS.bezierPath; // from earlier file
  const bindImagePanelControls = NS.bindImagePanelControls; // from earlier file
  const bindPanelWindow = (p) => NS.bindPanelWindow && NS.bindPanelWindow(p); // defined in nodes.js, load later
  const bindPortLinkDrag = NS.bindPortLinkDrag; // from earlier file
  const dualPanelBuilders = NS.dualPanelBuilders; // from earlier file
  const ensureGlobalLinkListeners = NS.ensureGlobalLinkListeners; // from earlier file
  const fillImageModelSelect = NS.fillImageModelSelect; // from earlier file
  const getKiteDefaultSize = NS.getKiteDefaultSize; // from earlier file
  const loadImagePanelSettings = NS.loadImagePanelSettings; // from earlier file
  const nodePortCenter = NS.nodePortCenter; // from earlier file
  const observePanelMove = NS.observePanelMove; // from earlier file
  const refreshPanelLink = NS.refreshPanelLink; // from earlier file
  const registerPanelRefresher = NS.registerPanelRefresher; // from earlier file
  const saveImagePanelSettings = NS.saveImagePanelSettings; // from earlier file
  const scheduleAllPanelRefresh = NS.scheduleAllPanelRefresh; // from earlier file
  const setImagePanelGenerating = NS.setImagePanelGenerating; // from earlier file
  const state = NS.state; // from earlier file
  // ---- 本文件定义的符号（文件末尾统一写回 NS）----
// openDualPanels, openImageEditPanel, openVisionPanel, setVisionStatus


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

  // ---- 写回共享命名空间 ----
  var __defs = {openDualPanels: openDualPanels, openImageEditPanel: openImageEditPanel, openVisionPanel: openVisionPanel, setVisionStatus: setVisionStatus};
  for (var __k in __defs) NS[__k] = __defs[__k];
})();
