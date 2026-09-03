/* ============================================================
 * app-flowglam-edit.js - FlowGlam 流程图手动编辑层
 * 提供编辑模式下的：新增节点 / 改名 / 删除节点 / 连线 / 删连线 / 框选 / 撤销
 * 交互入口：流程图面板上的 ✏️ 编辑模式按钮（FGEdit.toggle()）
 * 数据同步：所有编辑最终更新 layer._fgMermaid（重新生成 mermaid 文本）
 *           再调用 FG._persist()，与持久化、会话层、AI 工具完全兼容。
 * ============================================================ */
(function () {
  'use strict';
  var FG = (window.FlowGlam = window.FlowGlam || {});
  var E = (window.FGEdit = window.FGEdit || {});
  var editing = false;       // 编辑模式开关
  var seq = 0;              // 新节点 id 自增
  var undoStack = [];       // 撤销栈：{layerId, mermaid, positions}
  var selected = {};        // 框选选中的节点 {nodeId: true}
  var linkFrom = null;      // 连线起点 nodeId
  var linkLine = null;      // 连线预览 SVG line
  var selBox = null;        // 框选矩形
  var selStart = null;

  /* ---------- 工具函数 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function unesc(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  }
  // 当前编辑目标：取最后一个图层（最近部署的）
  function curLayer() {
    var ls = FG._layers || [];
    return ls.length ? ls[ls.length - 1] : null;
  }
  function getGraph(layer) {
    return (window.FGParse && layer) ? FGParse(layer._fgMermaid || '') : { nodes: {}, edges: [] };
  }
  // 由图结构重新生成 mermaid 文本（保持布局由 positions 持久化，不写坐标）
  function buildMermaid(g) {
    var lines = ['flowchart TD'];
    Object.keys(g.nodes).forEach(function (id) {
      var lb = g.nodes[id].label || id;
      if (lb !== id) lines.push('  ' + id + '[' + lb.replace(/[\[\]]/g, '') + ']');
      else lines.push('  ' + id);
    });
    g.edges.forEach(function (e) {
      if (e.label) lines.push('  ' + e.from + ' -->|' + e.label + '| ' + e.to);
      else lines.push('  ' + e.from + ' --> ' + e.to);
    });
    return lines.join('\n');
  }
  // 取节点标签文字（从 DOM）
  function nodeLabel(el) {
    var lb = el.querySelector('.fg-label');
    return lb ? unesc(lb.textContent) : '';
  }
  function genId(g) {
    var id;
    do { id = 'N' + (++seq); } while (g.nodes[id]);
    return id;
  }
  // 保存撤销快照
  function snapshot() {
    var layer = curLayer();
    if (!layer) return;
    var pos = {};
    layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (id) {
      var el = layer._fgNodes[id].el;
      pos[id] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    });
    undoStack.push({ mermaid: layer._fgMermaid, positions: pos });
    if (undoStack.length > 50) undoStack.shift();
  }
  // 重新部署（保留各节点位置）
  function redeploy(layer) {
    if (!layer) return;
    var g = getGraph(layer);
    var pos = {};
    layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (id) {
      var el = layer._fgNodes[id].el;
      pos[id] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    });
    var idx = FG._layers.indexOf(layer);
    var x = layer._fgX, y = layer._fgY;
    layer.remove();
    if (idx >= 0) FG._layers.splice(idx, 1);
    // 新节点的位置补进 pos（首次 redeploy 时可能不在里面）
    var newMermaid = buildMermaid(g);
    var parsed = FGParse(newMermaid);
    Object.keys(parsed.nodes).forEach(function (id) {
      if (!pos[id]) {
        // 新节点没有保存位置：放在图层原点附近网格
        pos[id] = { x: x + 400 + Math.random() * 200, y: y + 300 + Math.random() * 200 };
      }
    });
    FG.deploy(newMermaid, { x: x, y: y, positions: pos });
    FG._persist();
    // 重新部署后重新应用编辑模式视觉
    applyEditingLook();
  }
  function confirmDialog(msg) {
    return window.confirm(msg);
  }
  function toast(msg) {
    try { if (window.App && App.toast) { App.toast(msg); return; } } catch (e) {}
    console.log('[FGEdit] ' + msg);
  }

  /* ---------- 编辑模式视觉 ---------- */
  function applyEditingLook() {
    (FG._layers || []).forEach(function (l) {
      l.classList.toggle('fg-editing', editing);
    });
    var panelBtn = document.getElementById('fgEditToggleBtn');
    if (panelBtn) {
      panelBtn.textContent = editing ? '✅ 退出编辑' : '✏️ 编辑模式';
      panelBtn.classList.toggle('fg-edit-btn-on', editing);
      panelBtn.title = editing ? '点击退出编辑模式' : '点击进入编辑模式：增删节点/连线/框选';
    }
  }

  /* ---------- 面板按钮注入 ---------- */
  function ensurePanelButton() {
    var host = document.getElementById('canvasContent');
    if (!host) return;
    var old = document.getElementById('fgEditBar');
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.id = 'fgEditBar';
    bar.style.cssText = 'position:absolute;right:14px;bottom:60px;z-index:60;display:none;gap:8px;pointer-events:auto;';
    var gear=document.getElementById('fgEditGear');
    if(!gear){gear=document.createElement('div');gear.id='fgEditGear';gear.textContent='⚙️';gear.title='画布工具（编辑模式）';gear.style.cssText='position:absolute;right:14px;bottom:60px;z-index:60;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(10,20,35,.85);border:1px solid rgba(0,229,255,.4);font-size:16px;pointer-events:auto;box-shadow:0 0 12px rgba(0,229,255,.25);';gear.addEventListener('click',function(){bar.style.display=(bar.style.display==='none')?'flex':'none';});host.appendChild(gear);}
    var btn = document.createElement('button');
    btn.id = 'fgEditToggleBtn';
    btn.textContent = editing ? '✅ 退出编辑' : '✏️ 编辑模式';
    btn.title = '进入编辑模式后：双击空白建节点、双击节点改名、Delete 删除选中、拖节点边缘连线';
    btn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(0,229,255,.5);' +
      'background:rgba(10,20,35,.85);color:#9fe8ff;cursor:pointer;font-size:13px;backdrop-filter:blur(4px);' +
      'box-shadow:0 0 12px rgba(0,229,255,.25);';
    btn.onclick = function () { E.toggle(); };
    bar.appendChild(btn);
    host.appendChild(bar);
  }

  /* ---------- 编辑操作 ---------- */
  // 新建节点：双击空白
  function addNode(clientX, clientY) {
    var layer = curLayer();
    if (!layer) { toast('画布上还没有流程图'); return; }
    var g = getGraph(layer);
    promptInput('新增节点', '节点名称', '', function (label) {
      if (!label) return;
      snapshot();
      var id = genId(g);
      var host = document.getElementById('canvasContent');
      var view = (App.canvasGetView ? App.canvasGetView() : { x: 0, y: 0 });
      var x = clientX - host.getBoundingClientRect().left - view.x;
      var y = clientY - host.getBoundingClientRect().top - view.y;
      g.nodes[id] = { id: id, label: label };
      // 记下新节点绝对位置（redeploy 里通过 newIds 优先使用）
      layer._fgNewNodePos = layer._fgNewNodePos || {};
      layer._fgNewNodePos[id] = { x: x, y: y };
      // 注入位置：redeploy 用节点 el 的位置，新节点没有 el，这里先把位置塞进 _fgNodes 之外的临时表
      // 简化：redeploy 内对未保存位置节点随机；我们改为直接传 positions
      var pos = {};
      layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (nid) {
        var el = layer._fgNodes[nid].el;
        pos[nid] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
      });
      pos[id] = { x: x, y: y };
      layer._fgPendingPositions = pos;
      var newMermaid = buildMermaid(g);
      var idx = FG._layers.indexOf(layer);
      var lx = layer._fgX, ly = layer._fgY;
      layer.remove();
      if (idx >= 0) FG._layers.splice(idx, 1);
      FG.deploy(newMermaid, { x: lx, y: ly, positions: pos });
      FG._persist();
      applyEditingLook();
      toast('已新增节点「' + label + '」，可从其右侧边缘拖出连线');
    });
  }

  // 改名：双击节点
  function renameNode(el) {
    var old = nodeLabel(el);
    promptInput('修改节点', '新名称', old, function (label) {
      if (!label || label === old) return;
      snapshot();
      var layer = curLayer();
      if (!layer) return;
      var g = getGraph(layer);
      // 找到 id
      var tag = el.querySelector('.fg-tag');
      var id = tag ? tag.textContent : old;
      if (g.nodes[id]) g.nodes[id].label = label;
      // 直接改 DOM 免整图重绘
      var lb = el.querySelector('.fg-label');
      if (lb) lb.textContent = label;
      layer._fgMermaid = buildMermaid(g);
      FG._persist();
    });
  }

  // 删除节点（含确认）
  function deleteNodes(ids) {
    var layer = curLayer();
    if (!layer) return;
    var g = getGraph(layer);
    var valid = ids.filter(function (id) { return g.nodes[id]; });
    if (!valid.length) return;
    if (!confirmDialog('确定删除 ' + valid.length + ' 个节点？相关连线会一并删除。')) return;
    snapshot();
    valid.forEach(function (id) { delete g.nodes[id]; });
    g.edges = g.edges.filter(function (e) {
      return valid.indexOf(e.from) < 0 && valid.indexOf(e.to) < 0;
    });
    var pos = {};
    layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (nid) {
      if (valid.indexOf(nid) >= 0) return;
      var el = layer._fgNodes[nid].el;
      pos[nid] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    });
    var newMermaid = buildMermaid(g);
    var idx = FG._layers.indexOf(layer);
    var lx = layer._fgX, ly = layer._fgY;
    layer.remove();
    if (idx >= 0) FG._layers.splice(idx, 1);
    FG.deploy(newMermaid, { x: lx, y: ly, positions: pos });
    FG._persist();
    applyEditingLook();
    toast('已删除 ' + valid.length + ' 个节点');
  }

  // 连线：从起点节点拖到目标节点
  function startLink(fromId, ev) {
    linkFrom = fromId;
    var layer = curLayer();
    if (!layer) return;
    var svg = layer.querySelector('svg.fg-svg');
    if (!svg) return;
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'fg-link-preview');
    line.setAttribute('stroke', '#00e5ff');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-dasharray', '7 5');
    svg.appendChild(line);
    linkLine = { el: line, svg: svg, host: layer };
    moveLink(ev);
  }
  function moveLink(ev) {
    if (!linkLine) return;
    var host = document.getElementById('canvasContent');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    var view = App.canvasGetView ? App.canvasGetView() : { x: 0, y: 0 };
    var mx = ev.clientX - rect.left - view.x;
    var my = ev.clientY - rect.top - view.y;
    var s = linkStart;
    linkLine.el.setAttribute('x1', s.x); linkLine.el.setAttribute('y1', s.y);
    linkLine.el.setAttribute('x2', mx); linkLine.el.setAttribute('y2', my);
  }
  function endLink(targetId) {
    if (!linkLine) { linkFrom = null; return; }
    try { linkLine.el.remove(); } catch (e) {}
    linkLine = null;
    var from = linkFrom;
    linkFrom = null;
    if (!from || !targetId || from === targetId) return;
    var layer = curLayer();
    if (!layer) return;
    var g = getGraph(layer);
    var dup = g.edges.some(function (e) { return e.from === from && e.to === targetId; });
    if (dup) { toast('这两个节点之间已有连线'); return; }
    snapshot();
    g.edges.push({ from: from, to: targetId, label: '' });
    var pos = {};
    layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (nid) {
      var el = layer._fgNodes[nid].el;
      pos[nid] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    });
    var newMermaid = buildMermaid(g);
    var idx = FG._layers.indexOf(layer);
    var lx = layer._fgX, ly = layer._fgY;
    layer.remove();
    if (idx >= 0) FG._layers.splice(idx, 1);
    FG.deploy(newMermaid, { x: lx, y: ly, positions: pos });
    FG._persist();
    applyEditingLook();
    toast('已连线 ' + from + ' → ' + targetId);
  }
  var linkStart = { x: 0, y: 0 };

  // 删除连线：悬停高亮 + 点击删除按钮
  function bindEdgeDelete(layer) {
    var refs = layer._fgEdgeRefs || [];
    refs.forEach(function (r) {
      if (!r.path || r._fgDelBound) return;
      r._fgDelBound = true;
      var svg = r.path.parentNode;
      r.path.style.cursor = 'crosshair';
      r.path.addEventListener('pointerenter', function () {
        if (!editing) return;
        r.path.setAttribute('stroke-width', '5');
        r.path.setAttribute('filter', 'drop-shadow(0 0 8px #ff4081)');
      });
      r.path.addEventListener('pointerleave', function () {
        r.path.setAttribute('stroke-width', '2');
        r.path.removeAttribute('filter');
      });
      r.path.addEventListener('click', function (ev) {
        if (!editing) return;
        ev.stopPropagation();
        if (!confirmDialog('删除这条连线（' + r.from + ' → ' + r.to + '）？')) return;
        snapshot();
        var g = getGraph(layer);
        g.edges = g.edges.filter(function (e) { return !(e.from === r.from && e.to === r.to); });
        var pos = {};
        layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (nid) {
          var el = layer._fgNodes[nid].el;
          pos[nid] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
        });
        var newMermaid = buildMermaid(g);
        var idx = FG._layers.indexOf(layer);
        var lx = layer._fgX, ly = layer._fgY;
        layer.remove();
        if (idx >= 0) FG._layers.splice(idx, 1);
        FG.deploy(newMermaid, { x: lx, y: ly, positions: pos });
        FG._persist();
        applyEditingLook();
        toast('已删除连线 ' + r.from + ' → ' + r.to);
      });
    });
  }

  /* ---------- 框选 ---------- */
  function startSelBox(ev) {
    var host = document.getElementById('canvasContent');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    var view = App.canvasGetView ? App.canvasGetView() : { x: 0, y: 0 };
    selStart = { x: ev.clientX - rect.left - view.x, y: ev.clientY - rect.top - view.y };
    selBox = document.createElement('div');
    selBox.style.cssText = 'position:absolute;z-index:99;border:1.5px dashed #00e5ff;background:rgba(0,229,255,.08);pointer-events:none;';
    host.appendChild(selBox);
    moveSelBox(ev);
  }
  function moveSelBox(ev) {
    if (!selBox || !selStart) return;
    var host = document.getElementById('canvasContent');
    var rect = host.getBoundingClientRect();
    var view = App.canvasGetView ? App.canvasGetView() : { x: 0, y: 0 };
    var x = ev.clientX - rect.left - view.x, y = ev.clientY - rect.top - view.y;
    selBox.style.left = Math.min(selStart.x, x) + 'px';
    selBox.style.top = Math.min(selStart.y, y) + 'px';
    selBox.style.width = Math.abs(x - selStart.x) + 'px';
    selBox.style.height = Math.abs(y - selStart.y) + 'px';
  }
  function endSelBox() {
    if (!selBox || !selStart) return;
    var b = selBox.getBoundingClientRect();
    selBox.remove(); selBox = null;
    selected = {};
    var layer = curLayer();
    if (!layer) return;
    layer._fgNodes && Object.keys(layer._fgNodes).forEach(function (id) {
      var el = layer._fgNodes[id].el;
      var r = el.getBoundingClientRect();
      var hit = !(r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom);
      if (hit) {
        selected[id] = true;
        el.classList.add('fg-selected');
      }
    });
    var n = Object.keys(selected).length;
    if (n) toast('已框选 ' + n + ' 个节点：Delete 删除 / 拖动任一选中节点整体移动');
    selStart = null;
  }
  function clearSelection() {
    selected = {};
    (FG._layers || []).forEach(function (l) {
      l.querySelectorAll('.fg-node.fg-selected').forEach(function (el) { el.classList.remove('fg-selected'); });
    });
  }

  /* ---------- 输入框（替代原生 prompt，可 Esc 取消） ---------- */
  var _promptCb = null;
  function promptInput(title, label, def, cb) {
    var old = document.getElementById('fgEditPrompt');
    if (old) old.remove();
    var mask = document.createElement('div');
    mask.id = 'fgEditPrompt';
    mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'width:320px;padding:18px;border-radius:12px;background:#0d1626;color:#cdefff;' +
      'border:1px solid rgba(0,229,255,.45);box-shadow:0 0 30px rgba(0,229,255,.25);font-size:14px;';
    box.innerHTML = '<div style="margin-bottom:10px;font-weight:bold;">' + esc(title) + '</div>' +
      '<input id="fgEditPromptInput" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;' +
      'border:1px solid rgba(0,229,255,.4);background:#0a1018;color:#e0f7ff;font-size:14px;outline:none;" />' +
      '<div style="margin-top:14px;text-align:right;">' +
      '<button id="fgEditPromptOk" style="padding:6px 16px;margin-left:8px;border-radius:8px;cursor:pointer;' +
      'border:1px solid rgba(0,229,255,.5);background:rgba(0,229,255,.15);color:#9fe8ff;">确定</button>' +
      '<button id="fgEditPromptNo" style="padding:6px 16px;margin-left:8px;border-radius:8px;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.25);background:transparent;color:#aaa;">取消</button></div>';
    mask.appendChild(box);
    document.body.appendChild(mask);
    var input = box.querySelector('#fgEditPromptInput');
    input.value = def || '';
    input.focus(); input.select();
    function close() { mask.remove(); _promptCb = null; }
    function ok() { var v = input.value.trim(); close(); if (v) cb(v); }
    _promptCb = close;
    box.querySelector('#fgEditPromptOk').onclick = ok;
    box.querySelector('#fgEditPromptNo').onclick = close;
    input.onkeydown = function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') ok();
      if (ev.key === 'Escape') close();
    };
    mask.onmousedown = function (ev) { if (ev.target === mask) close(); };
  }

  /* ---------- 主事件绑定（绑定在 canvasContent，代理模式） ---------- */
  var bound = false;
  function bindGlobal() {
    if (bound) return;
    bound = true;
    var host = document.getElementById('canvasContent');
    if (!host) return;

    host.addEventListener('dblclick', function (ev) {
      if (!editing) return;
      var nodeEl = ev.target.closest ? ev.target.closest('.fg-node') : null;
      if (nodeEl) { renameNode(nodeEl); return; }
      if (ev.target.closest && ev.target.closest('.fg-layer')) {
        // 双击图层空白（非节点）→ 新建节点
        addNode(ev.clientX, ev.clientY);
      }
    });

    // 节点交互（拖动改由节点本身已有的 dragging 处理；这里只处理边缘连线与点选）
    host.addEventListener('pointerdown', function (ev) {
      if (!editing || ev.button !== 0) return;
      // 捕获阶段先于节点自身的拖拽监听，保证连线/框选手势优先
      var nodeEl = ev.target.closest ? ev.target.closest('.fg-node') : null;
      if (nodeEl) {
        var layer = curLayer();
        var tag = nodeEl.querySelector('.fg-tag');
        var id = tag ? tag.textContent : '';
        // 点击端口小圆点或靠近右边缘 14px 内 → 触发连线而非拖动
        var r = nodeEl.getBoundingClientRect();
        var portEl = ev.target.closest ? ev.target.closest('.fg-port') : null;
        if ((portEl || ev.clientX > r.right - 14) && layer && layer._fgNodes[id]) {
          if (!ev._fgLinkTaken) { ev._fgLinkTaken = true; ev.stopPropagation(); ev.preventDefault(); }
          var rect = host.getBoundingClientRect();
          var view = App.canvasGetView ? App.canvasGetView() : { x: 0, y: 0 };
          linkStart = { x: r.right - rect.left - view.x, y: (r.top + r.bottom) / 2 - rect.top - view.y };
          startLink(id, ev);
          function onMove(e2) { moveLink(e2); }
          function onUp(e2) {
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onUp, true);
            var over = document.elementFromPoint(e2.clientX, e2.clientY);
            var tEl = over && over.closest ? over.closest('.fg-node') : null;
            var tTag = tEl ? tEl.querySelector('.fg-tag') : null;
            endLink(tTag ? tTag.textContent : null);
          }
          document.addEventListener('pointermove', onMove, true);
          document.addEventListener('pointerup', onUp, true);
          return;
        }
        // 点选节点：单击单选，Ctrl/Shift 加选
        if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) clearSelection();
        if (selected[id]) { delete selected[id]; nodeEl.classList.remove('fg-selected'); }
        else { selected[id] = true; nodeEl.classList.add('fg-selected'); }
        return;
      }
      // 图层空白 → 框选
      if (ev.target.closest && ev.target.closest('.fg-layer') && !ev.target.closest('.fg-node')) {
        clearSelection();
        startSelBox(ev);
        function onMove2(e2) { moveSelBox(e2); }
        function onUp2() {
          document.removeEventListener('pointermove', onMove2, true);
          document.removeEventListener('pointerup', onUp2, true);
          endSelBox();
        }
        document.addEventListener('pointermove', onMove2, true);
        document.addEventListener('pointerup', onUp2, true);
      }
    }, true);

    // Delete 键删除选中
    document.addEventListener('keydown', function (ev) {
      if (!editing) return;
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || ev.target.isContentEditable) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        var ids = Object.keys(selected);
        if (ids.length) { ev.preventDefault(); deleteNodes(ids); }
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault(); E.undo();
      } else if (ev.key === 'Escape') {
        clearSelection();
      }
    });
  }

  /* ---------- 撤销 ---------- */
  E.undo = function () {
    var snap = undoStack.pop();
    if (!snap) { toast('没有可撤销的操作'); return; }
    var layer = curLayer();
    if (!layer) return;
    var idx = FG._layers.indexOf(layer);
    var lx = layer._fgX, ly = layer._fgY;
    layer.remove();
    if (idx >= 0) FG._layers.splice(idx, 1);
    FG.deploy(snap.mermaid, { x: lx, y: ly, positions: snap.positions });
    FG._persist();
    applyEditingLook();
    toast('已撤销上一步');
  };

  /* ---------- 开关 ---------- */
  E.toggle = function () {
    editing = !editing;
    if (!editing) clearSelection();
    applyEditingLook();
    if (editing) {
      // 挂上所有已有图层的边删除交互
      (FG._layers || []).forEach(bindEdgeDelete);
      toast('编辑模式已开启：双击空白建节点 / 双击节点改名 / 拖节点右缘连线 / 点连线删连线 / 空白拖动框选 / Ctrl+Z 撤销');
    } else {
      toast('编辑模式已关闭');
    }
  };
  E.isEditing = function () { return editing; };

  // deploy 之后自动补绑定（钩子：包装 FG.deploy）
  var _origDeploy = null;
  function hookDeploy() {
    if (_origDeploy) return;
    _origDeploy = FG.deploy;
    FG.deploy = function (text, opts) {
      var res = _origDeploy.apply(FG, arguments);
      setTimeout(function () {
        try {
          var layer = curLayer();
          if (layer) bindEdgeDelete(layer);
          if (editing) applyEditingLook();
        } catch (e) {}
      }, 800);
      return res;
    };
  }

  /* ---------- 启动 ---------- */
  function init() {
    // 注入编辑模式样式
    var st = document.createElement('style');
    st.textContent =
      '.fg-layer .fg-node { transition: box-shadow .15s, border-color .15s; }' +
      '.fg-layer.fg-editing .fg-node::after {' +
      '  content:""; position:absolute; right:0; top:0; bottom:0; width:14px;' +
      '  border-radius:0 12px 12px 0; background:linear-gradient(90deg, transparent, rgba(0,229,255,.25));' +
      '  cursor:crosshair; }' +
      '.fg-layer.fg-editing .fg-node { outline:1px dashed rgba(0,229,255,.35); outline-offset:3px; }' +
      '.fg-layer .fg-node.fg-selected { outline:2px solid #00e5ff !important; outline-offset:3px;' +
      '  box-shadow:0 0 22px rgba(0,229,255,.6) !important; }' +
      '.fg-layer .fg-edge-base { transition: stroke-width .15s; }' +
      /* 关键修复：fg-layer / fg-svg 默认 pointer-events:none，编辑模式下必须开回来，
         否则双击空白建节点、空白框选、点击连线删除全部收不到事件 */
      '.fg-layer.fg-editing { pointer-events:auto !important; }' +
      '.fg-layer.fg-editing .fg-svg { pointer-events:auto !important; }' +
      '.fg-layer.fg-editing .fg-edge-base { cursor:crosshair; }' +
      '#fgEditToggleBtn.fg-edit-btn-on { background:rgba(0,229,255,.35) !important; color:#fff !important;' +
      '  box-shadow:0 0 18px rgba(0,229,255,.6) !important; }';
    document.head.appendChild(st);
    bindGlobal();
    ensurePanelButton();
    hookDeploy();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
  // 画布可能晚初始化，兜底再挂一次按钮
  setTimeout(function () { ensurePanelButton(); bindGlobal(); }, 2500);
})();
