/* ============================================================
 * app-pipeline.js - 画布流水线引擎（工程图 → 真实对话节点编排）
 * 职责：
 *   1. 解析 Mermaid flowchart 文本 → 拓扑（节点 + 边）
 *   2. 自动分层布局（列=层级，行=同层），大间距铺在无限画布
 *   3. 每个节点 = 真实对话（复用 App.createChatBox）
 *   4. 对话↔对话粗贝塞尔流水线连线（带流动动画+箭头+端口圆点）
 *   5. 上游完成后自动汇流：注入结果到下游并触发
 *   6. 终点节点 = 归总节点，产出最终方案/任务
 * 暴露 window.Pipeline：
 *   - Pipeline.deploy(text, opts)   部署流水线（mermaid 文本）
 *   - Pipeline.list()               列出所有流水线
 *   - Pipeline.status(id)           查看状态
 * ============================================================ */
(function () {
  'use strict';

  var PL = (window.Pipeline = window.Pipeline || {});
  var _pipelines = {};   // id -> {id, name, nodes:{}, edges:[], done}
  var _seq = 0;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- 长任务（long_plan）绑定：流程图是表面，长任务是内部 ----------
  // 部署时把节点按拓扑顺序映射为长任务步骤；每个节点完成 → 自动打勾（plan_batch.report 语义的 progress）
  function lpApi(body) {
    try {
      return fetch('/api/tools/long_plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // 拓扑顺序 = 按 layer 升序（同层并联），生成步骤列表
  function topoOrder(pipeline) {
    return Object.keys(pipeline.nodes).sort(function (a, b) {
      var d = (pipeline.nodes[a].layer || 0) - (pipeline.nodes[b].layer || 0);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }

  function ensureLongPlan(pipeline, opts) {
    pipeline.stepMap = {};   // nodeKey -> stepNo
    pipeline.planId = opts.longPlanId || null;
    var order = topoOrder(pipeline);
    var create = function () {
      return lpApi({
        action: 'create',
        title: '流程图·' + (pipeline.name || '流水线'),
        goal: '流程图 [' + (pipeline.name || '') + '] 的内部执行计划（节点=步骤，自动打勾推进）',
        steps: order.map(function (k) {
          var n = pipeline.nodes[k];
          return {
            title: '节点[' + k + '] ' + n.label,
            detail: '由画布流程图节点「' + n.label + '」的对话自动完成，完成后自动打勾。',
            deliverable: '节点对话产出结果',
            accept: '节点状态变为 done'
          };
        })
      }).then(function (res) {
        if (res && res.ok && res.plan_id) {
          pipeline.planId = res.plan_id;
        }
        bindStepMap(pipeline, order);
      });
    };
    if (pipeline.planId) {
      // 已有计划：读它拿步骤数，做一一绑定（超出节点数的步骤留给终点节点后的人工验证）
      lpApi({ action: 'read', plan_id: pipeline.planId }).then(function (res) {
        var steps = res && res.ok && res.plan && res.plan.steps ? res.plan.steps : null;
        if (!steps || !steps.length) return create();
        bindStepMap(pipeline, order, steps.length);
      }).catch(create);
    } else {
      create();
    }
  }

  function bindStepMap(pipeline, order, totalSteps) {
    var n = Math.min(order.length, totalSteps || order.length);
    for (var i = 0; i < n; i++) pipeline.stepMap[order[i]] = i + 1;
  }

  function markStepDone(pipeline, key) {
    if (!pipeline.planId || pipeline._planClosed) return;
    var no = pipeline.stepMap && pipeline.stepMap[key];
    if (!no) return;
    var label = (pipeline.nodes[key] && pipeline.nodes[key].label) || key;
    lpApi({
      action: 'progress',
      plan_id: pipeline.planId,
      step_nos: [no],
      status: 'completed',
      note: '流程图节点「' + label + '」已完成（自动打勾）'
    }).then(function (res) {
      if (App.toast && !(res && res.ok)) App.toast('⚠️ 长任务打勾失败：' + ((res && res.message) || '接口异常'));
    });
    // 终点节点完成 → 收官
    if (isFinalNode(pipeline, key)) {
      pipeline._planClosed = true;
      var doneCount = Object.keys(pipeline.nodes).filter(function (k) { return pipeline.nodes[k].status === 'done'; }).length;
      if (App.toast) App.toast('🎉 流程图全部节点完成，长任务 ' + pipeline.planId + ' 已收官（' + doneCount + ' 节点）');
    }
  }

  // ---------- 1. Mermaid flowchart 解析 ----------
  function parseMermaid(text) {
    var nodes = {};   // id -> {id, label}
    var edges = [];   // {from, to, label}
    var lines = text.split(/\r?\n/);
    lines.forEach(function (line) {
      line = line.trim();
      if (!line || /^(flowchart|graph|%%|subgraph|end\s*$)/i.test(line)) return;
      // 匹配边: A[标签] -->|标签| B[标签]  或 A --> B
      var re = /([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\[([^\]]*)\]|\(([^)]*)\))?\s*(?:-->\|([^|]*)\|\s*|-->\s*|-.->\s*)([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\[([^\]]*)\]|\(([^)]*)\))?/g;
      var m;
      while ((m = re.exec(line)) !== null) {
        var a = m[1], aLabel = m[2] || m[3] || a;
        var b = m[5], bLabel = m[6] || m[7] || b;
        var eLabel = (m[4] || '').trim();
        if (!nodes[a]) nodes[a] = { id: a, label: aLabel };
        if (!nodes[b]) nodes[b] = { id: b, label: bLabel };
        edges.push({ from: a, to: b, label: eLabel });
      }
    });
    // 节点也可能单独定义（无边的）: X[标题]
    lines.forEach(function (line) {
      var m2 = line.trim().match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[([^\]]*)\]$/);
      if (m2 && !nodes[m2[1]]) nodes[m2[1]] = { id: m2[1], label: m2[2] };
    });
    return { nodes: nodes, edges: edges };
  }

  // ---------- 2. 分层布局 ----------
  function layout(nodes, edges) {
    var depth = {};  // node -> 层级
    var incoming = {};
    Object.keys(nodes).forEach(function (k) { incoming[k] = 0; });
    edges.forEach(function (e) { incoming[e.to] = (incoming[e.to] || 0) + 1; });
    // BFS 求层级
    var queue = Object.keys(nodes).filter(function (k) { return incoming[k] === 0; });
    queue.forEach(function (k) { depth[k] = 0; });
    var visited = {};
    while (queue.length) {
      var cur = queue.shift();
      if (visited[cur]) continue;
      visited[cur] = true;
      edges.filter(function (e) { return e.from === cur; }).forEach(function (e) {
        depth[e.to] = Math.max(depth[e.to] || 0, depth[cur] + 1);
        queue.push(e.to);
      });
    }
    // 按层级分组
    var layers = {};
    Object.keys(nodes).forEach(function (k) {
      var d = depth[k] || 0;
      if (!layers[d]) layers[d] = [];
      layers[d].push(k);
    });
    return { depth: depth, layers: layers };
  }

  // ---------- 3. 流水线连线（对话↔对话 粗曲线） ----------
  function chatPortCenter(chatEl, isOut) {
    var host = document.getElementById('canvasContent') || document.body;
    var hr = host.getBoundingClientRect();
    var r = chatEl.getBoundingClientRect();
    // 对话框：出点=右边缘中部，入点=左边缘中部（转换为画布坐标）
    return {
      x: (isOut ? r.right : r.left) - hr.left,
      y: r.top + r.height / 2 - hr.top
    };
  }

  function createPipelineLink(fromChatEl, toChatEl, label) {
    var svg = document.getElementById('kiteCurveSvg') ||
      (document.getElementById('canvasContent') || document.body).querySelector('svg');
    if (!svg) return null;
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('class', 'kite-curve pipeline-curve');
    // 【修复】对话框 DOM 没有 data-id 属性，只有 id —— 之前存的是空字符串，
    // 导致拖动对话框后按 data-id 查询永远失败、连线不跟随。改存元素引用 + id 双保险。
    p.dataset.from = fromChatEl.id || '';
    p.dataset.to = toChatEl.id || '';
    p._fromEl = fromChatEl;
    p._toEl = toChatEl;
    if (label) p.dataset.label = label;
    svg.appendChild(p);
    // 流动小圆点
    var dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '5');
    dot.setAttribute('class', 'pipeline-flow-dot');
    p._dot = dot;
    svg.appendChild(dot);
    // 箭头
    var arrow = document.createElementNS(SVG_NS, 'polygon');
    arrow.setAttribute('class', 'pipeline-arrow');
    p._arrow = arrow;
    svg.appendChild(arrow);
    refreshPipelineLink(p, fromChatEl, toChatEl);
    // 存到对话元素上方便刷新
    fromChatEl._plLinks = fromChatEl._plLinks || [];
    fromChatEl._plLinks.push(p);
    toChatEl._plLinks = toChatEl._plLinks || [];
    toChatEl._plLinks.push(p);
    return p;
  }

  function refreshPipelineLink(p, fromChatEl, toChatEl) {
    if (!fromChatEl || !toChatEl || !fromChatEl.isConnected || !toChatEl.isConnected) return;
    var a = chatPortCenter(fromChatEl, true);
    var b = chatPortCenter(toChatEl, false);
    var dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
    var d = 'M ' + a.x + ' ' + a.y + ' C ' + (a.x + dx) + ' ' + a.y + ', ' + (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
    p.setAttribute('d', d);
    // 箭头位置（终点，方向沿切线）
    var ax = b.x - dx, ay = b.y;
    var ang = Math.atan2(b.y - ay, b.x - ax);
    var size = 9;
    var pts = [
      [b.x, b.y],
      [b.x - size * Math.cos(ang - 0.4), b.y - size * Math.sin(ang - 0.4)],
      [b.x - size * Math.cos(ang + 0.4), b.y - size * Math.sin(ang + 0.4)]
    ].map(function (pt) { return pt.join(','); }).join(' ');
    p._arrow.setAttribute('points', pts);
    // 端口圆点
    drawPortDot(fromChatEl, true);
    drawPortDot(toChatEl, false);
  }

  function drawPortDot(chatEl, isOut) {
    if (!chatEl) return;
    var cls = isOut ? 'pl-port-out' : 'pl-port-in';
    var dot = chatEl.querySelector(':scope > .' + cls);
    if (!dot) {
      dot = document.createElement('div');
      dot.className = cls;
      chatEl.appendChild(dot);
    }
    dot.style.right = isOut ? '-9px' : '';
    dot.style.left = isOut ? '' : '-9px';
    dot.style.top = '50%';
  }

  // 拖动对话框后刷新相关流水线连线
  function bindChatRefresh(chatEl) {
    var mo = new MutationObserver(function () {
      (chatEl._plLinks || []).forEach(function (p) {
        // 【修复】优先用创建时缓存的元素引用（可靠），id 兜底（对话框 DOM 没有 data-id，只有 id）
        var f = p._fromEl && p._fromEl.isConnected ? p._fromEl :
          document.getElementById(p.dataset.from);
        var t = p._toEl && p._toEl.isConnected ? p._toEl :
          document.getElementById(p.dataset.to);
        if (f && t) refreshPipelineLink(p, f, t);
      });
    });
    mo.observe(chatEl, { attributes: true, attributeFilter: ['style'] });
    chatEl._plObserver = mo;
  }

  // ---------- 4. 部署流水线 ----------
  // 迷你节点：折叠为小方块，点击展开完整对话框；点击 header 上的 ✕ 或再次点标题栏收起
  function makeMini(chat, title) {
    var el = chat.el;
    el.classList.add('pl-mini');
    // 记录按下位置，用于区分"拖动"与"点击"
    var downPos = null;
    el.addEventListener('pointerdown', function (e) {
      downPos = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('click', function (e) {
      if (!el.classList.contains('pl-mini')) return;  // 已展开，正常操作
      // 拖动过的 click 不触发展开
      if (downPos && (Math.abs(e.clientX - downPos.x) > 4 || Math.abs(e.clientY - downPos.y) > 4)) return;
      if (e.target.closest('.hd-btn.close')) return;   // 关闭按钮不触发展开
      expandMini(el);
    });
    // 展开状态下，点击 header（非按钮区域）收起回小方块
    var hdr = el.querySelector('.chatbox-header');
    if (hdr) {
      hdr.addEventListener('click', function (e) {
        if (el.classList.contains('pl-mini')) return;
        if (e.target.closest('.hd-btn') || e.target.closest('.model-picker-btn')) return;
        var dp = downPos;
        if (dp && (Math.abs(e.clientX - dp.x) > 4 || Math.abs(e.clientY - dp.y) > 4)) return; // 拖动不收起
        collapseMini(el);
      });
    }
    // 展开时刷新连线
    el.addEventListener('transitionend', function () {
      (el._plLinks || []).forEach(function (p) {
        var f = p._fromEl && p._fromEl.isConnected ? p._fromEl : document.getElementById(p.dataset.from);
        var t = p._toEl && p._toEl.isConnected ? p._toEl : document.getElementById(p.dataset.to);
        if (f && t) refreshPipelineLink(p, f, t);
      });
    });
  }
  function expandMini(el) {
    el.classList.add('pl-expanding');
    el.classList.remove('pl-mini');
    // 恢复上次正常尺寸（默认 420x420）
    el.style.width = el._plSizeW || '420px';
    el.style.height = el._plSizeH || '420px';
    setTimeout(function () { el.classList.remove('pl-expanding'); }, 200);
    if (window.App && App.toast) App.toast('已展开节点【' + (el.querySelector('.title') || {}).textContent + '】，点击标题栏空白处可收起');
  }
  function collapseMini(el) {
    el._plSizeW = el.style.width; el._plSizeH = el.style.height;  // 记住展开尺寸
    el.classList.add('pl-mini');
  }
  function deploy(text, opts) {
    opts = opts || {};
    var App = window.App;
    if (!App || typeof App.createChatBox !== 'function') {
      return { success: false, message: '画布对话系统未就绪' };
    }
    var parsed = parseMermaid(text);
    var nodeIds = Object.keys(parsed.nodes);
    if (!nodeIds.length) return { success: false, message: '未解析到节点，请提供 flowchart LR 格式的 mermaid 文本' };
    var lay = layout(parsed.nodes, parsed.edges);

    var COL_W = 210;   // 层间距（工程节点 96px 宽 + 连线余量）
    var ROW_H = 70;   // 同层间距（工程节点 36px 高 + 余量）
    var origin = opts.origin || viewOrigin();

    var plId = 'pl-' + (++_seq) + '-' + Date.now().toString(36);
    var pipeline = { id: plId, name: opts.name || ('流水线 ' + _seq), nodes: {}, edges: parsed.edges, results: {} };
    _pipelines[plId] = pipeline;

    // 创建真实对话节点
    var chats = {};  // nodeKey -> chat 对象
    Object.keys(lay.layers).forEach(function (d) {
      lay.layers[d].forEach(function (key, i) {
        var x = origin.x + d * COL_W;
        var y = origin.y + i * ROW_H;
        var title = parsed.nodes[key].label || key;
        var clientX = x + (document.getElementById('canvasContent') || document.body).getBoundingClientRect().left;
        var clientY = y + (document.getElementById('canvasContent') || document.body).getBoundingClientRect().top;
        var chat = App.createChatBox(clientX, clientY, opts.model_id || null);
        if (!chat) return;
        // 标题冠以节点名
        chat.el.dataset.pipelineNode = plId + ':' + key;
        var titleEl = chat.el.querySelector('.title');
        if (titleEl) titleEl.textContent = title;
        chat.el.style.zIndex = 50;
        // 【防误关】流水线节点不允许通过 ✕ 关闭（否则链路断裂），点 ✕ 改为收起/提示
        chat.el.addEventListener('click', function (ev) {
          var btn = ev.target.closest ? ev.target.closest('.hd-btn.close') : null;
          if (btn) {
            ev.stopImmediatePropagation();
            ev.preventDefault();
            if (chat.el.classList.contains('pl-mini')) {
              expandMini(chat.el);
            } else {
              collapseMini(chat.el);
              if (App.toast) App.toast('⚙ 流水线节点受保护，已收起而非关闭（收起后引擎继续跑）');
            }
          }
        }, true);
        chats[key] = chat;
        pipeline.nodes[key] = { key: key, label: title, chatId: chat.id, layer: d, status: 'pending' };
        bindChatRefresh(chat.el);
        // 【迷你节点模式】默认折叠为小方块，点击展开 / 再点收起
        makeMini(chat, title);
      });
    });

    // 建立对话↔对话流水线连线
    parsed.edges.forEach(function (e) {
      var fa = chats[e.from], ta = chats[e.to];
      if (fa && ta) createPipelineLink(fa.el, ta.el, e.label);
    });

    // 节点任务提示词（opts.prompts: {nodeKey: prompt}，缺省用通用模板）
    pipeline.prompts = opts.prompts || {};
    pipeline.chats = chats;
    pipeline.counters = {};  // 下游已收到的上游数
    pipeline.totalIn = {};   // 每个节点的上游总数
    parsed.edges.forEach(function (e) {
      pipeline.totalIn[e.to] = (pipeline.totalIn[e.to] || 0) + 1;
    });

    // 启动：触发所有入度为 0 的源节点
    var starters = Object.keys(parsed.nodes).filter(function (k) { return !pipeline.totalIn[k]; });
    pipeline.starters = starters;
    // 轮询监控完成
    startMonitor(pipeline, opts.finalPrompt);
    // 绑定长任务：流程图=表面，长任务=内部，节点完成自动打勾推进
    if (opts.bindLongPlan !== false) ensureLongPlan(pipeline, opts);
    // 【修复】立即触发源节点（totalIn=0，counters=0 满足条件，fireReady 会给它们发任务）
    fireReady(pipeline, opts.finalPrompt);

    return {
      success: true,
      message: '✅ 流水线 [' + pipeline.name + '] 已部署：' + nodeIds.length + ' 个对话节点、' + parsed.edges.length + ' 条连线。源节点：' + starters.join(', ') + '。同层节点并行执行、跨层串行汇流；已绑定内部长任务（节点完成自动打勾推进）。',
      data: { pipelineId: plId, nodes: Object.keys(pipeline.nodes), edges: parsed.edges, planId: pipeline.planId || null }
    };
  }

  // 画布当前视口中心（画布坐标）
  // 【修复】之前写死 {x:200, y:200}，流水线节点全部堆在画布原点、
  // 和已有对话框叠在一起（视觉上"贴太近/被折叠"）。
  // 现在：视口中心相对 host 的偏移即画布坐标（host 的 rect 已含画布平移/缩放）。
  function viewOrigin() {
    try {
      var host = document.getElementById('canvasContent') || document.body;
      var hr = host.getBoundingClientRect();
      var canvasArea = document.getElementById('canvasArea');
      var vw = canvasArea ? canvasArea.clientWidth : window.innerWidth;
      var vh = canvasArea ? canvasArea.clientHeight : window.innerHeight;
      var ox = (vw / 2 - hr.left);
      var oy = (vh / 2 - hr.top);
      if (isFinite(ox) && isFinite(oy)) {
        // 向右下方偏移，避开视口正中间可能已有的对话/工具面板
        return { x: Math.round(ox + 100), y: Math.round(oy - 150) };
      }
    } catch (e) {}
    return { x: 200, y: 200 };
  }

  // ---------- 5. 完成监控 + 自动汇流 ----------
  function startMonitor(pipeline, finalPrompt) {
    if (pipeline._timer) clearInterval(pipeline._timer);
    var tick = 0;
    pipeline._timer = setInterval(function () {
      tick++;
      var allDone = true;
      var sawActive = false;
      Object.keys(pipeline.nodes).forEach(function (k) {
        var n = pipeline.nodes[k];
        var chat = pipeline.chats[k];
        if (n.status === 'done') return;
        if (n.status === 'running') { allDone = false; return; }
        sawActive = true;
        var sending = chat && chat.isSending;
        var hadInput = (chat.history || []).some(function (h) { return h.role === 'assistant'; });
        if (hadInput && !sending) {
          // 刚完成：提取结果
          n.status = 'done';
          var lastA = '';
          for (var i = chat.history.length - 1; i >= 0; i--) {
            if (chat.history[i].role === 'assistant') { lastA = chat.history[i].content; break; }
          }
          pipeline.results[k] = lastA;
          markStepDone(pipeline, k);   // 【长任务连通】节点完成 → 自动打勾长任务步骤
          // 汇流到下游
          pipeline.edges.filter(function (e) { return e.from === k; }).forEach(function (e) {
            pipeline.counters[e.to] = (pipeline.counters[e.to] || 0) + 1;
          });
          fireReady(pipeline, finalPrompt);
        } else if (sending) {
          allDone = false;
        }
      });
      // 闪连线：running 节点出的边高亮 + 兜底刷新连线位置（覆盖拖动/布局变化的场景）
      Object.keys(pipeline.nodes).forEach(function (k) {
        var n = pipeline.nodes[k];
        var el = pipeline.chats[k] && pipeline.chats[k].el;
        if (el) {
          el.classList.toggle('pl-running', n.status === 'running');
          el.classList.toggle('pl-done', n.status === 'done');
        }
        (pipeline.chats[k] && pipeline.chats[k].el._plLinks || []).forEach(function (p) {
          var isActive = (n.status === 'done' || n.status === 'running') && p.dataset.from === pipeline.chats[k].id;
          p.classList.toggle('pipeline-active', isActive);
          // 【修复】兜底刷新：即使 MutationObserver 失效，1.5 秒内连线也会跟上对话框
          var f = p._fromEl && p._fromEl.isConnected ? p._fromEl : document.getElementById(p.dataset.from);
          var t = p._toEl && p._toEl.isConnected ? p._toEl : document.getElementById(p.dataset.to);
          if (f && t) refreshPipelineLink(p, f, t);
        });
      });
      // 【修复】只要有 pending/running 节点就绝不能结束监控
      if (sawActive) allDone = false;
      if (allDone && tick > 2) {
        clearInterval(pipeline._timer);
        pipeline.done = true;
        // 【长任务连通】兜底：全部节点 done 后，把还没打勾的步骤统一补勾收官
        if (pipeline.planId && !pipeline._planClosed) {
          var nos = Object.keys(pipeline.stepMap || {}).map(function (k) { return pipeline.stepMap[k]; });
          if (nos.length) {
            lpApi({ action: 'progress', plan_id: pipeline.planId, step_nos: nos, status: 'completed', note: '流程图收官：所有节点已完成（兜底补勾）' });
          }
          pipeline._planClosed = true;
        }
      }
    }, 1500);
  }

  // 触发所有"上游已齐"且未启动的节点
  function fireReady(pipeline, finalPrompt) {
    Object.keys(pipeline.nodes).forEach(function (k) {
      var n = pipeline.nodes[k];
      if (n.status !== 'pending') return;
      if ((pipeline.counters[k] || 0) < (pipeline.totalIn[k] || 0)) return;
      // 组装提示词：上游结果注入
      var upstream = pipeline.edges.filter(function (e) { return e.to === k; })
        .map(function (e) {
          var from = pipeline.nodes[e.from];
          return '### 来自节点【' + from.label + '】的结果：\n' + (pipeline.results[e.from] || '（无输出）');
        }).join('\n\n');
      var base = pipeline.prompts[k] ||
        (finalPrompt && isFinalNode(pipeline, k)
          ? finalPrompt
          : '你是流水线节点【' + n.label + '】。请根据上游输入完成本节点的职责，输出结构化结果。');
      var msg = base + '\n\n===== 上游节点输入 =====\n' + upstream;
      var chat = pipeline.chats[k];
      n.status = 'running';
      // 复用 chat_manage send 逻辑
      var input = chat.el.querySelector('textarea');
      if (input) input.value = msg;
      App.addMsg(chat.el, msg, 'user', chat.modelId);
      App.showQueryPin(chat.el, msg);
      App.updateChatTitle(chat.el, '⚙ ' + n.label);
      chat.history.push({ role: 'user', content: msg });
      App.sendToModel(chat.el, chat);
    });
  }

  function isFinalNode(pipeline, key) {
    return !pipeline.edges.some(function (e) { return e.from === key; });
  }

  // ---------- 6. 查询 ----------
  function list() {
    return Object.keys(_pipelines).map(function (id) {
      var p = _pipelines[id];
      return {
        id: id, name: p.name, done: !!p.done,
        nodes: Object.keys(p.nodes).map(function (k) {
          return { key: k, label: p.nodes[k].label, chatId: p.nodes[k].chatId, status: p.nodes[k].status };
        })
      };
    });
  }
  function status(id) {
    var p = _pipelines[id];
    if (!p) return { success: false, message: '未找到流水线 ' + id };
    var planNote = p.planId ? '；内部长任务 ' + p.planId + (p._planClosed ? '（已收官）' : '（节点完成自动打勾推进）') : '';
    return {
      success: true,
      message: '流水线 [' + p.name + '] ' + (p.done ? '✅ 已完成' : '⏳ 运行中') + planNote +
        '\n' + Object.keys(p.nodes).map(function (k) {
          var n = p.nodes[k];
          return '  [' + k + '] ' + n.label + ' → ' + n.status + ' (对话 ' + n.chatId + ')';
        }).join('\n'),
      data: { results: p.results, planId: p.planId || null, planClosed: !!p._planClosed, stepMap: p.stepMap || {} }
    };
  }

  // ---------- 7. 样式注入 ----------
  function injectStyles() {
    if (document.getElementById('pipeline-styles')) return;
    var st = document.createElement('style');
    st.id = 'pipeline-styles';
    st.textContent = [
      '.pipeline-curve{stroke:#4f9cff;stroke-width:4;fill:none;filter:drop-shadow(0 0 6px rgba(79,156,255,.5));}',
      '.pipeline-curve.pipeline-active{stroke:#ffd166;stroke-width:5;filter:drop-shadow(0 0 10px rgba(255,209,102,.7));}',
      '.pipeline-flow-dot{fill:#ffd166;}',
      '.pipeline-arrow{fill:#4f9cff;}',
      '.pl-port-out,.pl-port-in{position:absolute;width:9px;height:9px;border-radius:50%;background:#4f9cff;border:2px solid #0a0f1e;top:50%;transform:translateY(-50%);z-index:60;box-shadow:0 0 6px rgba(79,156,255,.8);}',
      '.pl-port-out{right:-6px;}.pl-port-in{left:-6px;}',
      '.chatbox[data-pipeline-node]{box-shadow:0 0 0 2px rgba(79,156,255,.55), 0 8px 32px rgba(0,0,0,.5);}',
      '.chatbox.pl-mini .pl-port-out{right:-6px;}.chatbox.pl-mini .pl-port-in{left:-6px;}',
      '.chatbox.pl-mini.pl-expanding .pl-port-out,.chatbox.pl-mini.pl-expanding .pl-port-in{display:none;}',
      '.chatbox.pl-mini.pl-expanding{transition:width .18s ease,height .18s ease;}',
      '.pipeline-curve{stroke:#4f9cff;stroke-width:3;}',
      '@keyframes plPulse{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.35);opacity:.6;}}',

      /* ===== 流水线节点 = 工程图小节点：紧凑方块，点击才展开完整对话框 ===== */
      '.chatbox.pl-mini{width:96px !important;height:36px !important;min-width:0;min-height:0;overflow:visible;cursor:pointer;border-radius:6px;',
      'background:#16233f !important;border:1.5px solid rgba(79,156,255,.55);',
      'box-shadow:0 0 0 1px rgba(0,0,0,.6),0 2px 10px rgba(0,0,0,.5);transition:box-shadow .2s,transform .15s;}',
      '.chatbox.pl-mini::before{display:none;}',
      '.chatbox.pl-mini:hover{transform:translateY(-2px);box-shadow:0 0 0 2px rgba(79,156,255,.9),0 0 20px rgba(79,156,255,.4),0 6px 20px rgba(0,0,0,.6) !important;}',
      '.chatbox.pl-mini .chatbox-body,' +
      '.chatbox.pl-mini .chatbox-inputrow,' +
      '.chatbox.pl-mini .chatbox-toolpanel,' +
      '.chatbox.pl-mini .chatbox-logpanel,' +
      '.chatbox.pl-mini .chatbox-queue,' +
      '.chatbox.pl-mini .chatbox-resize,' +
      '.chatbox.pl-mini .prev-user-btn,' +
      '.chatbox.pl-mini .scroll-bottom-btn,' +
      '.chatbox.pl-mini .hd-btn,' +
      '.chatbox.pl-mini .model-picker-btn{display:none !important;}',
      '.chatbox.pl-mini .chatbox-header{width:100%;height:100%;display:flex;align-items:center;gap:6px;padding:0 8px;background:transparent;border-radius:6px;cursor:pointer;}',
      '.chatbox.pl-mini .chatbox-header-row1{flex:1;display:flex;align-items:center;gap:6px;min-width:0;}',
      '.chatbox.pl-mini .status-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#5b6b8c;}',
      '.chatbox.pl-mini .title{display:block !important;font-size:11px;font-weight:600;color:#dce8ff;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      // 状态色：等待=暗蓝 / 运行=琥珀脉冲 / 完成=翠绿
      '.chatbox.pl-mini.pl-running{border-color:rgba(255,177,79,.7);}',
      '.chatbox.pl-mini.pl-running .status-dot{background:#ffb14f;box-shadow:0 0 10px #ffb14f,0 0 3px #fff;animation:plPulse 1s infinite;}',
      '.chatbox.pl-mini.pl-running .title{color:#ffd9a0;}',
      '.chatbox.pl-mini.pl-done{border-color:rgba(56,209,124,.6);}',
      '.chatbox.pl-mini.pl-done .status-dot{background:#38d17c;box-shadow:0 0 10px #38d17c;}',
      '.chatbox.pl-mini.pl-done .title{color:#bdf5d4;}',
      '@keyframes plPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}',
      // 端口圆点更精致
      '.pl-port-out,.pl-port-in{width:12px;height:12px;background:radial-gradient(circle at 35% 35%,#9ecbff,#2f7fe0);border:2px solid #0a0f1e;box-shadow:0 0 10px rgba(79,156,255,.9);}',
      // 展开动画
      '.chatbox.pl-expanding{transition:width .18s ease, height .18s ease;}',
      // 连线底衬：更粗的管线感
      '.pipeline-curve{stroke-linecap:round;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyles);
  else injectStyles();

  // ---------- API ----------
  PL.deploy = deploy;
  PL.list = list;
  PL.status = status;
  PL.parseMermaid = parseMermaid;
})();
