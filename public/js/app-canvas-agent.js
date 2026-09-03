/* ============================================================
 * app-canvas-agent.js - 无限画布多智能体内核（架构文档落地）
 *  - 节点状态机：idle/running/success/failed/deleted/pending_deps
 *  - 节点属性：is_fixed / node_type / created_by / 逻辑依赖 / 溯源
 *  - 8 个内核工具：create_node / read_node / read_global_context /
 *      read_tool_store / run_node / delete_node / set_node_fixed / get_canvas_status
 *  - 全局上下文池：任意节点可读其他节点问答结论
 *  - ToolStore：工具调用入参/结果/归属节点全存库，可复用去重
 *  - 元数据注入：节点会话首条消息自动携带全局位置元数据
 * 暴露 window.CanvasAgent（简称 CA）
 * ============================================================ */
(function () {
  'use strict';

  var CA = (window.CanvasAgent = window.CanvasAgent || {});
  var KV_STATE = 'canvas_agent_state';
  var KV_TSTORE = 'canvas_agent_toolstore';
  var KV_CTX = 'canvas_agent_ctxpool';

  var STATES = ['idle', 'running', 'success', 'failed', 'deleted', 'pending_deps', 'waiting', 'blocked', 'reassigned', 'timeout'];
  var STATE_BADGE = {
    idle: { txt: '空闲', cls: 'ca-idle' },
    running: { txt: '执行中', cls: 'ca-running' },
    success: { txt: '✓完成', cls: 'ca-success' },
    failed: { txt: '✗失败', cls: 'ca-failed' },
    deleted: { txt: '已删除', cls: 'ca-deleted' },
    pending_deps: { txt: '等依赖', cls: 'ca-pdeps' },
    waiting: { txt: '⏳求助', cls: 'ca-waiting' },
    blocked: { txt: '⛔受阻', cls: 'ca-blocked' },
    reassigned: { txt: '↻已换人', cls: 'ca-reassigned' },
    timeout: { txt: '⌛超时', cls: 'ca-timeout' }
  };

  // layerId -> nodeKey -> meta
  var _state = {};
  // 全局工具结果仓库：id -> {tool, args, result, ownerLayer, ownerNode, ts, valid}
  var _toolstore = [];
  var _tsSeq = 0;
  // 全局上下文池（缓存最近读取，真实数据来自各节点会话 history）
  var _ctxNotes = {}; // layerId -> { nodeKey: '摘要文本' }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ================= 持久化 =================
  function saveState() {
    try { if (window.DB && DB.kvSet) DB.kvSet(KV_STATE, JSON.stringify(_state)); } catch (e) {}
  }
  function saveToolStore() {
    try {
      if (window.DB && DB.kvSet) {
        var trimmed = (Array.isArray(_toolstore) ? _toolstore : []).slice(-300); // 防膨胀
        DB.kvSet(KV_TSTORE, JSON.stringify(trimmed));
      }
    } catch (e) {}
  }
  function saveCtx() {
    try { if (window.DB && DB.kvSet) DB.kvSet(KV_CTX, JSON.stringify(_ctxNotes)); } catch (e) {}
  }
  function restore() {
    if (!window.DB || !DB.kvGet) return;
    DB.kvGet(KV_STATE).then(function (v) {
      try { _state = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch (e) {}
    }).catch(function () {});
    DB.kvGet(KV_TSTORE).then(function (v) {
      try {
        var _parsed = (typeof v === 'string' ? JSON.parse(v) : v);
        // 【修复】历史数据可能是对象/损坏格式，push 会报 "not a function"，强制归一为数组
        _toolstore = Array.isArray(_parsed) ? _parsed : [];
        if (Array.isArray(_parsed) === false && _parsed && typeof _parsed === 'object') {
          // 兼容旧版 id->record 映射：转成数组保数据
          _toolstore = Object.keys(_parsed).map(function (k) { return _parsed[k]; }).filter(function (r) { return r && typeof r === 'object'; });
        }
      } catch (e) { _toolstore = []; }
    }).catch(function () {});
    DB.kvGet(KV_CTX).then(function (v) {
      try { _ctxNotes = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch (e) {}
    }).catch(function () {});
  }

  // ================= 图层 / 节点查找 =================
  function findLayer(layerId) {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    for (var i = 0; i < layers.length; i++) if (layers[i].id === layerId) return layers[i];
    return null;
  }
  function findLayersByNodeKey(nodeKey) {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    return layers.filter(function (l) { return l._fgNodes && l._fgNodes[nodeKey]; });
  }
  function labelOf(layer, key) {
    var info = layer._fgNodes && layer._fgNodes[key];
    var el = info && info.el;
    var lb = el && el.querySelector('.fg-label');
    return lb ? lb.textContent : key;
  }
  function ensureMeta(layerId, key) {
    if (!_state[layerId]) _state[layerId] = {};
    if (!_state[layerId][key]) {
      _state[layerId][key] = {
        status: 'idle', is_fixed: false, node_type: 'task',
        created_by: 'human', created_at: Date.now(), note: ''
      };
    }
    return _state[layerId][key];
  }
  function edgesOf(layer) {
    if (!layer._fgParsedEdges) {
      layer._fgParsedEdges = (layer._fgParsed && layer._fgParsed.edges) ? layer._fgParsed.edges.slice() : [];
    }
    return layer._fgParsedEdges;
  }

  // ================= 状态机 =================
  function depsSatisfied(layer, key) {
    var st = _state[layer.id] || {};
    var ups = edgesOf(layer).filter(function (e) { return e.to === key; });
    return ups.every(function (e) {
      var m = st[e.from];
      return !m || m.status === 'success' || (m.is_fixed && m.status === 'success');
    });
  }
  function effectiveStatus(layer, key) {
    var m = ensureMeta(layer.id, key);
    if (m.status === 'deleted') return 'deleted';
    if (m.status === 'idle') {
      var ups = edgesOf(layer).filter(function (e) { return e.to === key; });
      if (ups.length && !depsSatisfied(layer, key)) return 'pending_deps';
    }
    return m.status;
  }
  // ================= 状态信箱与事件流（派小弟协议 v1.1 步骤4） =================
  // 信箱：layerId -> 事件数组 [{ts, node, type, detail}]，read_global_context 时一并返回给主脑
  var KV_EVENTS = 'canvas_agent_events';
  var _events = {}; // layerId -> []
  var MAX_EVENTS_PER_LAYER = 200;
  var EVENT_TYPES = ['created', 'running', 'success', 'failed', 'waiting', 'blocked', 'reassigned', 'timeout', 'heartbeat', 'note'];

  function loadEvents() {
    try {
      var raw = (window.KVS && KVS.get) ? KVS.get(KV_EVENTS) : localStorage.getItem(KV_EVENTS);
      if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') _events = o; }
    } catch (e) { _events = {}; }
  }
  function saveEvents() {
    try {
      var raw = JSON.stringify(_events);
      if (window.KVS && KVS.set) KVS.set(KV_EVENTS, raw); else localStorage.setItem(KV_EVENTS, raw);
    } catch (e) { /* 存储满等异常静默 */ }
  }
  loadEvents();

  // 事件入信箱（带节流：同一节点同类型事件 5 秒内去重）
  CA.pushEvent = function (layerId, node, type, detail) {
    if (!layerId) return;
    if (EVENT_TYPES.indexOf(type) < 0) return;
    if (!_events[layerId]) _events[layerId] = [];
    var arr = _events[layerId];
    var last = arr[arr.length - 1];
    if (last && last.node === node && last.type === type && (Date.now() - last.ts) < 5000) {
      last.ts = Date.now(); last.detail = detail; // 合并心跳
    } else {
      arr.push({ ts: Date.now(), node: node, type: type, detail: String(detail || '').slice(0, 200) });
      if (arr.length > MAX_EVENTS_PER_LAYER) arr.splice(0, arr.length - MAX_EVENTS_PER_LAYER);
    }
    saveEvents();
  };
  // ================= 信誉档案（派小弟协议 v1.1 之7.2） =================
  // worker -> { credit, done, fail }，验收结果自动累积，主脑派活可查「该派谁」
  var KV_CREDITS = 'canvas_agent_credits';
  var _credits = {};
  function loadCredits() {
    try {
      var raw = (window.KVS && KVS.get) ? KVS.get(KV_CREDITS) : localStorage.getItem(KV_CREDITS);
      if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') _credits = o; }
    } catch (e) { _credits = {}; }
  }
  function saveCredits() {
    try {
      var raw = JSON.stringify(_credits);
      if (window.KVS && KVS.set) KVS.set(KV_CREDITS, raw); else localStorage.setItem(KV_CREDITS, raw);
    } catch (e) {}
  }
  loadCredits();
  // delta 正分=验收通过，负分=超时/打回/换人；同一节点同一结果只计一次（调方保证）
  CA.addCredit = function (worker, delta, reason) {
    if (!worker) return;
    var w = _credits[worker] = _credits[worker] || { credit: 0, done: 0, fail: 0 };
    w.credit = Math.max(-99, Math.min(99, (w.credit || 0) + delta));
    if (delta > 0) w.done = (w.done || 0) + 1; else if (delta < 0) w.fail = (w.fail || 0) + 1;
    if (reason) w.last_reason = String(reason).slice(0, 120);
    w.updated_at = Date.now();
    saveCredits();
    return w;
  };
  // 信誉查询：默认按 credit 降序返回全部 worker 档案
  CA.getCredits = function (limit) {
    var arr = Object.keys(_credits).map(function (k) {
      var w = _credits[k];
      return { worker: k, credit: w.credit, done: w.done, fail: w.fail, last_reason: w.last_reason || '', updated_at: w.updated_at };
    }).sort(function (a, b) { return b.credit - a.credit; });
    return arr.slice(0, limit || 50);
  };

  // 主脑读信箱（默认只看 30 条）
  // ================= 目标链统一协议 v1.0：charter（人类唯一目标源） =================
  // 人类原话一字不改存档；所有子任务必须可向上追溯，追溯不上 = 漂移 = 砍掉。
  var KV_CHARTER = 'canvas_agent_charter';
  var _charter = {}; // layerId -> { text: 人类原话, ts, set_by }
  function loadCharter() {
    try {
      var raw = (window.KVS && KVS.get) ? KVS.get(KV_CHARTER) : localStorage.getItem(KV_CHARTER);
      if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') _charter = o; }
    } catch (e) { _charter = {}; }
  }
  function saveCharter() {
    try {
      var raw = JSON.stringify(_charter);
      if (window.KVS && KVS.set) KVS.set(KV_CHARTER, raw); else localStorage.setItem(KV_CHARTER, raw);
    } catch (e) {}
  }
  CA.setCharter = function (layerId, text, setBy) {
    if (!layerId || !text || !String(text).trim()) return { success: false, message: 'charter 不能为空（人类原话必须存档）' };
    _charter[layerId] = { text: String(text).trim(), ts: Date.now(), set_by: setBy || '主脑' };
    saveCharter();
    CA.pushEvent(layerId, null, 'charter', 'charter 已设立/更新（目标链唯一目标源）：' + String(text).slice(0, 120));
    return { success: true, charter: _charter[layerId], message: 'charter 已存档，全图节点将自动携带该总目标' };
  };
  CA.getCharter = function (layerId) {
    return _charter[layerId] || null;
  };
  // 终审报告：监工固化全部节点后生成，交人类终审（满意=结束；不满意=charter 重开）
  CA.finalReport = function (layerId) {
    var layer = findLayer(layerId);
    if (!layer) return { success: false, message: '未找到流程图图层' };
    var ch = _charter[layerId];
    var st = CA.getCanvasStatus(layerId);
    var nodes = st.nodes || [];
    var done = nodes.filter(function (n) { return n.status === 'success' && n.is_fixed; });
    var undone = nodes.filter(function (n) { return ['idle', 'running', 'waiting', 'blocked', 'reassigned', 'timeout', 'pending_deps'].indexOf(n.status) >= 0; });
    var report = [
      '===== 终审报告（目标链统一协议 v1.0） =====',
      '人类总目标（charter）：' + (ch ? ch.text : '（未设立）'),
      'charter 设立时间：' + (ch ? new Date(ch.ts).toLocaleString() : 'N/A'),
      '',
      '节点总数：' + nodes.length + '｜已固化完成：' + done.length + '｜未完成：' + undone.length,
      '小弟信誉榜（按 credit 降序）：' + JSON.stringify(CA.getCredits(5).list || CA.getCredits(5)),
      '',
      '未完成节点：' + (undone.map(function (n) { return n.node + '(' + n.label + ')[' + n.status + ']'; }).join('、') || '无'),
      '',
      '监工自述：以上为全图交付情况。请人类终审：满意即结束；不满意请更新 charter，链条将重开。',
      '=========================================='
    ].join('\n');
    return { success: true, report: report, charter: ch || null, stats: { total: nodes.length, done: done.length, undone: undone.length }, ready: undone.length === 0 && !!ch };
  };
  loadCharter();

  CA.readEvents = function (layerId, limit, typeFilter) {
    var arr = (_events[layerId] || []).slice();
    if (typeFilter) arr = arr.filter(function (e) { return e.type === typeFilter; });
    return arr.slice(-(limit || 30)).reverse(); // 最新在前
  };

  // 超时巡检：running 超过任务包 timeout 秒 → 置 timeout 态 + 事件入箱（不自动换人，热替换在步骤7实现）
  setInterval(function () {
    if (document.hidden) return; // 页面不可见时跳过
    Object.keys(_state).forEach(function (layerId) {
      var nodes = _state[layerId] || {};
      Object.keys(nodes).forEach(function (key) {
        var m = nodes[key];
        if (m.status === 'running' && m.started_at && m.timeout) {
          var elapsed = (Date.now() - m.started_at) / 1000;
          if (elapsed > m.timeout) {
            m.status = 'timeout';
            CA.addCredit(m.assigned_to || ('worker#' + key), -2, '执行超时 ' + Math.round(elapsed) + 's，task_id=' + (m.task_id || 'N/A'));
            m.updated_at = Date.now();
            CA.pushEvent(layerId, key, 'timeout',
              '执行超时：' + Math.round(elapsed) + 's > timeout ' + m.timeout + 's，task_id=' + (m.task_id || 'N/A'));
            saveState();
            var layer = findLayer(layerId);
            if (layer) refreshBadge(layer, key);
          }
        }
      });
    });
  }, 5000);

  CA.setStatus = function (layerId, key, status) {
    if (STATES.indexOf(status) < 0) return { success: false, message: '非法状态: ' + status };
    var layer = findLayer(layerId);
    var m = ensureMeta(layerId, key);
    if (m.is_fixed && ['running', 'failed'].indexOf(status) >= 0) {
      return { success: false, message: '节点已固化（is_fixed），不可重跑；先 set_node_fixed 解锁' };
    }
    m.status = status;
    m.updated_at = Date.now();
    if (status === 'running') m.started_at = Date.now();
    saveState();
    if (layer) refreshBadge(layer, key);
    // 状态信箱：状态变化自动入事件流（waiting/blocked/timeout/reassigned/success/failed 均通知主脑）
    if (status !== 'idle') {
      CA.pushEvent(layerId, key, status,
        labelOf(layer, key) + ' → ' + (STATE_BADGE[status] ? STATE_BADGE[status].txt : status) +
        (m.task_id ? '，task_id=' + m.task_id : ''));
    }
    return { success: true, status: status };
  };
  CA.getStatus = function (layerId, key) {
    var layer = findLayer(layerId);
    return {
      node: key, label: layer ? labelOf(layer, key) : key,
      meta: ensureMeta(layerId, key),
      effective: layer ? effectiveStatus(layer, key) : ensureMeta(layerId, key).status
    };
  };
  CA.getCanvasStatus = function (layerId) {
    var layer = findLayer(layerId);
    if (!layer || !layer._fgNodes) return null;
    var out = { layer: layerId, total: 0, nodes: [], mermaid: layer._fgMermaid || '' };
    Object.keys(layer._fgNodes).forEach(function (k) {
      out.total++;
      var m = ensureMeta(layer.id, k);
      out.nodes.push({
        node: k, label: labelOf(layer, k), status: effectiveStatus(layer, k),
        is_fixed: m.is_fixed, node_type: m.node_type, created_by: m.created_by
      });
    });
    return out;
  };

  // 徽章渲染：节点右上角状态点 + 固化标记
  function refreshBadge(layer, key) {
    var info = layer._fgNodes && layer._fgNodes[key];
    if (!info || !info.el) return;
    var el = info.el;
    var m = ensureMeta(layer.id, key);
    var st = effectiveStatus(layer, key);
    var badge = el.querySelector('.ca-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ca-badge';
      el.appendChild(badge);
    }
    var b = STATE_BADGE[st] || STATE_BADGE.idle;
    badge.textContent = b.txt;
    badge.className = 'ca-badge ' + b.cls;
    // 尝试次数标记（热替换后 attempt>=2 时提示已重试）
    var att = el.querySelector('.ca-attempt');
    if ((m.attempt || 0) >= 2 && st !== 'success' && st !== 'deleted') {
      if (!att) { att = document.createElement('span'); att.className = 'ca-attempt'; el.appendChild(att); }
      att.textContent = '×' + m.attempt;
    } else if (att) { att.remove(); }
    // timeout 限时显示（剩余秒数）
    var tmo = el.querySelector('.ca-tmo');
    if (st === 'running' && m.timeout && m.started_at) {
      var left = Math.round((m.started_at + m.timeout * 1000 - Date.now()) / 1000);
      if (left > 0) {
        if (!tmo) { tmo = document.createElement('span'); tmo.className = 'ca-tmo'; el.appendChild(tmo); }
        tmo.textContent = left + 's';
      } else if (tmo) { tmo.remove(); }
    } else if (tmo) { tmo.remove(); }
    el.classList.toggle('ca-fixed', !!m.is_fixed);
    el.classList.toggle('ca-deleted-node', st === 'deleted');
    el.classList.toggle('ca-node-' + st, true);
  }
  function refreshAll() {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    layers.forEach(function (layer) {
      if (!layer._fgNodes) return;
      Object.keys(layer._fgNodes).forEach(function (k) { refreshBadge(layer, k); });
    });
  }

  // ================= 回执单模板强制化（派小弟协议 v1.1 步骤5） =================
  // 回执单标记：小弟最后一条回复里必须包含此标记 + 四要素，否则不给置 success
  var RECEIPT_MARK = '【回执单】';
  var RECEIPT_FIELDS = ['任务编号', '执行状态', '最终产出', '自述与证据'];

  // 给小弟注入的回执单模板（拼进首条消息元数据）
  function buildReceiptTemplate(m) {
    return [
      '===== 回执单要求（强制） =====',
      '你完成本任务后，最终回复的结尾必须附上如下回执单（一字段不能少）：',
      RECEIPT_MARK,
      '任务编号：' + (m.task_id || 'N/A'),
      '执行状态：success / failed / blocked（三选一）',
      '最终产出：<交付物是什么、在哪（路径/链接/结论），一句话>',
      '自述与证据：<做了什么、依据什么判断达标（对应验收标准逐条自检），引用关键证据>',
      '推进charter：<本产出如何推进人类总目标，一句话；无 charter 写 N/A>',
      '注意：缺回执单或字段不全，系统会将你标记为 waiting（等补交），不视为完成。',
      '============================'
    ].join('\n');
  }

  // charter 段落（注入节点元数据，让每个小弟永远知道人类总目标）
  function charterLine(layerId) {
    var ch = _charter[layerId];
    if (!ch) return '人类总目标（charter）：未设立——监工应先 set_charter 登记人类原话，所有任务必须可向上追溯';
    return '人类总目标（charter，一字不改）：' + ch.text + '（一切工作皆为彻底完成该目标，冲突以此为准）';
  }

  // 校验回执单：返回 {ok, missing:[字段]}（第0关：若 charter 已设立，回执需说明产出如何推进 charter）
  CA.validateReceipt = function (text) {
    var t = String(text || '');
    if (t.indexOf(RECEIPT_MARK) < 0) return { ok: false, missing: ['缺少' + RECEIPT_MARK + '整段'] };
    var missing = [];
    RECEIPT_FIELDS.forEach(function (f) {
      if (t.indexOf(f + '：') < 0 && t.indexOf(f + ':') < 0) missing.push(f);
    });
    return { ok: missing.length === 0, missing: missing };
  };

  // ================= 元数据注入（节点永远知道自己的定位） =================
  function buildMetadata(layer, key) {
    var edges = edgesOf(layer);
    var ups = edges.filter(function (e) { return e.to === key; }).map(function (e) { return e.from + '(' + labelOf(layer, e.from) + ')'; });
    var downs = edges.filter(function (e) { return e.from === key; }).map(function (e) { return e.to + '(' + labelOf(layer, e.to) + ')'; });
    var src = edges.filter(function (e) { return !edges.some(function (x) { return x.to === e.from; }); }).map(function (e) { return e.from + '(' + labelOf(layer, e.from) + ')'; });
    var dst = edges.filter(function (e) { return !edges.some(function (x) { return x.from === e.to; }); }).map(function (e) { return e.to + '(' + labelOf(layer, e.to) + ')'; });
    var st = CA.getCanvasStatus(layer.id);
    var m = ensureMeta(layer.id, key);
    return [
      '===== 全局流程图位置元数据（自动注入） =====',
      charterLine(layer.id),
      '整图节点：' + st.nodes.map(function (n) { return n.node + '(' + n.label + ')[' + n.status + (n.is_fixed ? '·固' : '') + ']'; }).join(' → ') || '(单节点)',
      '源节点：' + (src.join('、') || key), '终点节点：' + (dst.join('、') || key),
      '本节点：' + key + '(' + labelOf(layer, key) + ') 状态=' + effectiveStatus(layer, key) +
        ' 类型=' + m.node_type + (m.is_fixed ? ' [已固化]' : ''),
      '直接上游：' + (ups.join('、') || '无（本节点为起点）'),
      '直接下游：' + (downs.join('、') || '无（本节点为终点，输出即最终成果）'),
      '可用内核工具：create_node / read_node / read_global_context / read_tool_store / run_node / delete_node / set_node_fixed / get_canvas_status / analyze_project（一键扫描项目自动生成整图）/ read_shared_context',
      '遇到前置条件不满足或缺信息时：调用 ask_help（参数 need/tried）发标准求助帧给主脑，不要硬编造结果。',
      '如需拆解任务，可调用 create_node 动态生长子节点（AI 自主决定数量与结构）。',
      buildReceiptTemplate(m),
      '=========================================='
    ].join('\n');
  }

  // 拦截节点会话发送：首条消息前注入元数据
  var _origSend = App.sendToModel;
  App.sendToModel = function (el, chat) {
    try {
      if (chat && chat._fgLayerId && chat._fgNodeKey) {
        var layer = findLayer(chat._fgLayerId);
        if (layer) {
          var input = el.querySelector('textarea');
          var val = input ? input.value : '';
          if (val && !(chat.history || []).some(function (h) { return h.role === 'user'; })) {
            input.value = buildMetadata(layer, chat._fgNodeKey) + '\n\n' + val;
          }
          ensureMeta(chat._fgLayerId, chat._fgNodeKey).status = 'running';
          saveState();
          setTimeout(function () { refreshBadge(layer, chat._fgNodeKey); }, 50);
        }
      }
    } catch (e) {}
    return _origSend.apply(this, arguments);
  };

  // 会话回复完成 → 状态 success（沿用 FGS 的轮询思路，轻量轮询）
  setInterval(function () {
    if (document.hidden) return; // 页面不可见时跳过
    (App.chatBoxes || []).forEach(function (chat) {
      if (!chat._fgLayerId || !chat._fgNodeKey) return;
      var layer = findLayer(chat._fgLayerId);
      if (!layer) return;
      var m = ensureMeta(chat._fgLayerId, chat._fgNodeKey);
      if (m.status === 'running' && !chat.isSending && (chat.history || []).some(function (h) { return h.role === 'assistant'; })) {
        var lastA = '';
        for (var i = chat.history.length - 1; i >= 0; i--) {
          if (chat.history[i].role === 'assistant') { lastA = chat.history[i].content; break; }
        }
        // 回执单强制校验：缺回执/字段不全 → 置 waiting（等补交），不算 success
        var rc = CA.validateReceipt(lastA);
        if (!rc.ok) {
          m.status = 'waiting';
          CA.pushEvent(chat._fgLayerId, chat._fgNodeKey, 'waiting',
            '回执单校验未过（' + rc.missing.join('、') + '），已置 waiting 等待补交，task_id=' + (m.task_id || 'N/A'));
          saveState(); refreshBadge(layer, chat._fgNodeKey);
          // 自动追问一次，催小弟补回执（只催一次，避免循环）
          if (!m._receiptChased) {
            m._receiptChased = true; saveState();
            try {
              var cev = new CustomEvent('ca-chase-receipt', { detail: { layerId: chat._fgLayerId, nodeKey: chat._fgNodeKey, chat: chat, missing: rc.missing } });
              window.dispatchEvent(cev);
            } catch (e) {}
          }
          return;
        }
        m.status = 'success';
        CA.addCredit(m.assigned_to || ('worker#' + key), +2, '验收通过（回执齐全），task_id=' + (m.task_id || 'N/A'));
        if (!_ctxNotes[chat._fgLayerId]) _ctxNotes[chat._fgLayerId] = {};
        _ctxNotes[chat._fgLayerId][chat._fgNodeKey] = labelOf(layer, chat._fgNodeKey) + '：' + String(lastA).slice(0, 500);
        saveState(); saveCtx();
        refreshBadge(layer, chat._fgNodeKey);
      }
    });
  }, 1200);

  // ================= 动态生长（create_node / delete_node 视觉 + 逻辑） =================
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function addEdgeVisual(layer, fromKey, toKey) {
    var svg = layer.querySelector('svg.fg-svg');
    if (!svg) return;
    var a = layer._fgNodes[fromKey], b = layer._fgNodes[toKey];
    if (!a || !b) return;
    var x1 = parseFloat(a.el.style.left) + (a.w || 190), y1 = parseFloat(a.el.style.top) + (a.h || 60) / 2;
    var x2 = parseFloat(b.el.style.left), y2 = parseFloat(b.el.style.top) + (b.h || 60) / 2;
    var cx = (x1 + x2) / 2;
    var d = 'M ' + x1 + ' ' + y1 + ' C ' + cx + ' ' + y1 + ', ' + cx + ' ' + y2 + ', ' + x2 + ' ' + y2;
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 'fg-edge-base');
    p.setAttribute('stroke', 'url(#' + (svg.querySelector('linearGradient') || {}).id + ')');
    svg.appendChild(p);
    var g = document.createElementNS(SVG_NS, 'path');
    g.setAttribute('d', d);
    g.setAttribute('class', 'fg-edge-glow');
    g.setAttribute('stroke', 'url(#' + (svg.querySelector('linearGradient') || {}).id + ')');
    svg.insertBefore(g, p);
    layer._fgEdgeRefs.push({ from: fromKey, to: toKey, base: p, glow: g });
  }

    // ================= 派小弟协议 v1.1：任务包字段 + DFS 环路检测 =================
  // DFS 环路检测：在 edges 基础上试加 from->to，判断是否成环
  CA.wouldCycle = function (layer, from, to) {
    if (from === to) return true;
    var adj = {};
    (edgesOf(layer) || []).forEach(function (e) { (adj[e.from] = adj[e.from] || []).push(e.to); });
    (adj[from] = adj[from] || []).push(to); // 试加这条边
    var visiting = {}, done = {};
    function dfs(n) {
      if (done[n]) return false;
      if (visiting[n]) return true; // 成环
      visiting[n] = true;
      var outs = adj[n] || [];
      for (var i = 0; i < outs.length; i++) { if (dfs(outs[i])) return true; }
      visiting[n] = false; done[n] = true;
      return false;
    }
    return dfs(from);
  };

  CA.createNode = function (opts) {
    // opts: {layerId, parentId, direction, label, prompt, node_type,
    //        goal, accept, deliverable, timeout, assigned_to, extra_deps}
    var layer = findLayer(opts.layerId);
    if (!layer || !layer._fgNodes) return { success: false, message: '图层不存在' };
    var host = document.getElementById('canvasContent');
    if (!host) return { success: false, message: '画布未初始化' };

    var parentKey = opts.parentId || null;
    var existing = Object.keys(layer._fgNodes);
    var seq = existing.length + 1;
    var key = 'n' + Date.now().toString(36).slice(-4) + seq;

    // 定位：parent 右/左侧偏移；无 parent 则画布视口
    var x, y;
    if (parentKey && layer._fgNodes[parentKey]) {
      var pi = layer._fgNodes[parentKey];
      x = parseFloat(pi.el.style.left) + (opts.direction === 'before' ? -260 : 260);
      y = parseFloat(pi.el.style.top) + (existing.length % 3) * 100 - 50;
    } else {
      var view = App.canvasGetView ? App.canvasGetView() : { x: 0, y: 0 };
      x = -view.x + 220; y = -view.y + 180;
    }

    var el = document.createElement('div');
    el.className = 'fg-node';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.setProperty('--fg-c1', '#00e676');
    el.style.setProperty('--fg-c2', '#00c853');
    el.style.setProperty('--fg-glow', 'rgba(0,230,118,.5)');
    el.style.pointerEvents = 'auto';
    el.innerHTML = '<span class="fg-icon">🌱</span>' +
      '<span class="fg-label">' + esc(opts.label || 'AI新节点') + '</span>' +
      '<span class="fg-tag">' + key + '</span>';
    layer.appendChild(el);
    layer._fgNodes[key] = { el: el, w: el.offsetWidth || 190, h: el.offsetHeight || 60, _caNew: true, _caPrompt: opts.prompt || '' };

    // 逻辑依赖（非UI连线）：after: parent->new；before: new->parent
    // 派小弟协议 v1.1：所有依赖边先过 DFS 环路检测
    var newEdges = [];
    if (parentKey && layer._fgNodes[parentKey]) {
      newEdges.push(opts.direction === 'before'
        ? { from: key, to: parentKey }
        : { from: parentKey, to: key });
    }
    (opts.extra_deps || []).forEach(function (d) {
      if (d && layer._fgNodes[d] && d !== key) newEdges.push({ from: d, to: key });
    });
    for (var ei = 0; ei < newEdges.length; ei++) {
      var e = newEdges[ei];
      if (CA.wouldCycle(layer, e.from, e.to)) {
        return { success: false, message: '拒绝创建依赖 ' + e.from + '->' + e.to + '：会形成环路（死锁防护），请拆环或调整依赖方向' };
      }
      edgesOf(layer).push(e);
      addEdgeVisual(layer, e.from, e.to);
    }

    // 注册会话绑定 + 元数据
    if (window.FGS) {
      FGS.ensureNodeBind && FGS.ensureNodeBind(layer, key);
    }
    _state[layer.id] = _state[layer.id] || {};
    _state[layer.id][key] = {
      status: 'idle', is_fixed: false,
      node_type: opts.node_type || 'task', created_by: 'ai',
      created_at: Date.now(),
      note: opts.prompt || '', parent: parentKey || '',
      // 派小弟协议 v1.1 标准任务包
      goal: opts.goal || '', accept: opts.accept || '',
      deliverable: opts.deliverable || '',
      timeout: opts.timeout || 300,
      assigned_to: opts.assigned_to || '',
      attempt: 1,          // 尝试次数（reassign 时 +1，>=3 升级回主脑）
      credit: 0,            // 信誉分（验收结果累积）
      task_id: 't-' + Date.now().toString(36) + '-' + key
    };
    saveState();
    refreshBadge(layer, key);
    // 挂接 FGS 点击/双击（复用其 wireNode 的轮询即可自动发现）
    return { success: true, node: key, message: '已创建节点 ' + key + '(' + (opts.label || '') + ')' };
  };

  // ================= 派小弟协议 v1.1 步骤6：固化前自动三关验收 =================
  // set_node_fixed(固化) 前自动跑验收：①节点必须是 success（回执单已过）②最终产出非空
  // ③若任务包有 deliverable（产出物），会话里需提到对应文件/路径或产出描述。
  // 任何一关不过 → 拒绝固化并打回（置 waiting，事件入信箱），主脑可读事件决定补救或热替换。
  // 目标链 v1.0 第0关辅助：取节点会话最后一条 assistant 回复
  function lastAssistantOf(layerId, key) {
    var chat = (App.chatBoxes || []).filter(function (c) { return c._fgLayerId === layerId && c._fgNodeKey === key; })[0];
    if (!chat) return '';
    for (var i = (chat.history || []).length - 1; i >= 0; i--) {
      if (chat.history[i].role === 'assistant') return chat.history[i].content;
    }
    return '';
  }

  CA.autoAccept = function (layerId, key) {
    var m = ensureMeta(layerId, key);
    var problems = [];
    // 目标链 v1.0 第 0 关：这个交付推进了 charter 吗？（charter 已设立时才检查）
    var ch = _charter[layerId];
    if (ch) {
      var lastText = String(lastAssistantOf(layerId, key));
      var rc0 = /推进charter[：:]\s*(?!N\/A)\s*\S+/.test(lastText);
      if (!rc0) problems.push('第0关未过：回执单缺「推进charter」字段或为 N/A——需说明本产出如何推进人类总目标（追溯不上=漂移）');
    }
    if (m.status !== 'success') problems.push('节点状态=' + m.status + '（必须先 success，即回执单校验通过）');
    // 找到该节点绑定的会话，检查最终产出描述
    var chat = (App.chatBoxes || []).filter(function (c) { return c._fgLayerId === layerId && c._fgNodeKey === key; })[0];
    var lastA = '';
    if (chat) {
      for (var i = (chat.history || []).length - 1; i >= 0; i--) {
        if (chat.history[i].role === 'assistant') { lastA = chat.history[i].content; break; }
      }
    }
    var rc = CA.validateReceipt(lastA);
    if (!rc.ok) problems.push('回执单不完整：' + rc.missing.join('、'));
    if (m.deliverable && String(lastA).indexOf(m.deliverable) < 0) {
      // 回执里没直接点名交付物，允许宽松通过（产出描述含路径/文件名即可），但要求产出非空
      if (!/最终产出[：:]\s*\S+/.test(String(lastA))) problems.push('最终产出为空，无法核验交付物：' + m.deliverable);
    }
    if (problems.length) {
      CA.pushEvent(layerId, key, 'waiting', '三关验收未过，拒绝固化：' + problems.join('；') + '，task_id=' + (m.task_id || 'N/A'));
      saveState();
      return { ok: false, problems: problems };
    }
    return { ok: true };
  };

  // ================= 派小弟协议 v1.1 步骤7：小弟热替换 =================
  // reassign_node：完成不顺利时换人——attempt+1，重置状态为 idle 清计数，
  // assigned_to 换新执行者；attempt>=3 时升级回主脑（提示节点文案级处理）。
  CA.reassignNode = function (layerId, key, newWorker, reason) {
    var layer = findLayer(layerId);
    if (!layer || !layer._fgNodes || !layer._fgNodes[key]) return { success: false, message: '节点不存在: ' + key };
    var m = ensureMeta(layerId, key);
    if (m.is_fixed) return { success: false, message: '节点已固化，不可热替换；先 set_node_fixed 解锁' };
    m.attempt = (m.attempt || 1) + 1;
    CA.addCredit(m.assigned_to || ('worker#' + key), -3, '热替换（第' + (m.attempt - 1) + '任被换下，原因=' + (reason || '未说明') + '）');
    m.assigned_to = newWorker || ('worker-' + m.attempt);
    m.status = 'idle';
    m.started_at = 0;
    m._receiptChased = false; // 新执行者重新走回执流程
    m.reassigned_at = Date.now();
    m.reassign_reason = reason || '';
    m.status = 'reassigned';
    CA.pushEvent(layerId, key, 'reassigned',
      '热替换：第' + m.attempt + '次尝试，新执行者=' + m.assigned_to + '，原因=' + (reason || '未说明') + '，task_id=' + (m.task_id || 'N/A'));
    if (m.attempt >= 3) {
      CA.pushEvent(layerId, key, 'blocked', '已尝试 ' + m.attempt + ' 次仍未通过验收，升级回主脑处理，task_id=' + (m.task_id || 'N/A'));
    }
    saveState();
    if (layer) refreshBadge(layer, key);
    var msg = '已热替换节点 ' + key + '：第' + m.attempt + '次尝试，新执行者=' + m.assigned_to;
    if (m.attempt >= 3) msg += '（已达 3 次上限，已升级回主脑，事件已入信箱）';
    return { success: true, attempt: m.attempt, assigned_to: m.assigned_to, escalated: m.attempt >= 3, message: msg };
  };

  CA.deleteNode = function (layerId, key, reason) {
    var layer = findLayer(layerId);
    var m = ensureMeta(layerId, key);
    m.status = 'deleted'; m.deleted_at = Date.now(); m.note = reason || m.note;
    saveState();
    if (layer) refreshBadge(layer, key);
    return { success: true, message: '节点 ' + key + ' 已软删除（逻辑依赖与会话保留，可复用）' };
  };

  // ================= 链路批量操作（内部工具层，暂不接UI） =================
  var KV_CHAINUNDO = 'canvas_agent_chainundo';
  var _chainUndoStack = []; // [{layerId, ts, direction, nodes:{key: beforeMeta}}]
  function saveChainUndo() {
    try { if (window.DB && DB.kvSet) DB.kvSet(KV_CHAINUNDO, JSON.stringify(_chainUndoStack)); } catch (e) {}
  }

  // 沿逻辑依赖遍历整条链，批量软删除。opts: {direction:'downstream'|'upstream', reason, force}
  CA.deleteChain = function (layerId, startKey, opts) {
    opts = opts || {};
    var layer = findLayer(layerId);
    if (!layer || !layer._fgNodes || !layer._fgNodes[startKey]) return { success: false, message: '节点不存在: ' + startKey };
    var dir = opts.direction === 'upstream' ? 'upstream' : 'downstream';
    var edges = edgesOf(layer), seen = {}, queue = [startKey], list = [];
    while (queue.length) {
      var k = queue.shift();
      if (seen[k]) continue;
      seen[k] = 1;
      var mm = ensureMeta(layerId, k);
      if (mm.is_fixed && !opts.force) return { success: false, message: '链路含固化节点 ' + k + '，已中止（需 force=true 才可删除固化节点）' };
      list.push(k);
      edges.forEach(function (e) {
        var next = dir === 'downstream' ? (e.from === k ? e.to : null) : (e.to === k ? e.from : null);
        if (next && !seen[next] && layer._fgNodes[next]) queue.push(next);
      });
    }
    var snap = { layerId: layerId, ts: Date.now(), direction: dir, start: startKey, nodes: {} };
    list.forEach(function (k) {
      var m = ensureMeta(layerId, k);
      snap.nodes[k] = JSON.parse(JSON.stringify(m));
      m.status = 'deleted'; m.deleted_at = Date.now();
      if (opts.reason) m.note = opts.reason;
    });
    _chainUndoStack.push(snap);
    if (_chainUndoStack.length > 20) _chainUndoStack.shift();
    saveChainUndo();
    saveState();
    list.forEach(function (k) { if (layer._fgNodes[k]) refreshBadge(layer, k); });
    return { success: true, deleted: list, count: list.length, message: '已软删除' + (dir === 'upstream' ? '上游' : '下游') + '链路共 ' + list.length + ' 个节点（[' + list.join(', ') + ']，会话与依赖保留），可用 undo_chain 一键恢复' };
  };

  // 链路删除的整体撤销：按撤销栈逆序恢复最近一次（可按 layerId 过滤）
  CA.undoChain = function (layerId) {
    for (var i = _chainUndoStack.length - 1; i >= 0; i--) {
      var s = _chainUndoStack[i];
      if (layerId && s.layerId !== layerId) continue;
      _state[s.layerId] = _state[s.layerId] || {};
      Object.keys(s.nodes).forEach(function (k) { _state[s.layerId][k] = s.nodes[k]; });
      _chainUndoStack.splice(i, 1);
      saveChainUndo();
      saveState();
      var layer = findLayer(s.layerId);
      if (layer) Object.keys(s.nodes).forEach(function (k) { if (layer._fgNodes[k]) refreshBadge(layer, k); });
      return { success: true, restored: Object.keys(s.nodes), message: '已一键恢复链路删除的 ' + Object.keys(s.nodes).length + ' 个节点' };
    }
    return { success: false, message: '没有可撤销的链路删除记录' };
  };

  CA.setFixed = function (layerId, key, isFixed, note) {
    var m = ensureMeta(layerId, key);
    m.is_fixed = !!isFixed;
    if (isFixed) { m.fixed_at = Date.now(); if (m.status === 'success') { /* 锁定成果 */ } }
    m.note = note || m.note;
    saveState();
    var layer = findLayer(layerId);
    if (layer) refreshBadge(layer, key);
    return { success: true, is_fixed: m.is_fixed };
  };

  // ================= 全局上下文池 =================
  CA.readGlobalContext = function (layerId, limit) {
    var out = [];
    (App.chatBoxes || []).forEach(function (chat) {
      if (chat._fgLayerId !== layerId) return;
      var lastA = '', lastU = '';
      (chat.history || []).forEach(function (h) {
        if (h.role === 'assistant') lastA = h.content;
        if (h.role === 'user') lastU = h.content;
      });
      if (lastA) {
        out.push({ node: chat._fgNodeKey, last_user: String(lastU).slice(0, 160), last_result: String(lastA).slice(0, 400) });
      }
    });
    // 附加手动沉淀摘要
    var notes = _ctxNotes[layerId] || {};
    Object.keys(notes).forEach(function (k) {
      if (!out.some(function (o) { return o.node === k; })) {
        out.push({ node: k, last_result: notes[k] });
      }
    });
    return out.slice(0, limit || 20);
  };

  // ================= ToolStore =================
  function toolstoreRecord(tool, args, result, chat) {
    // 【修复】防御：_toolstore 若被历史脏数据写成非数组，push 会抛 "_toolstore.push is not a function"，
    // 该异常会沿 Tools.execute 冒泡进 agent loop 的 catch，被误报成"网络异常"反复重试。
    if (!Array.isArray(_toolstore)) {
      try {
        var _fix = (typeof _toolstore === 'object' && _toolstore) ? Object.keys(_toolstore).map(function (k) { return _toolstore[k]; }) : [];
        _toolstore = _fix.filter(function (r) { return r && typeof r === 'object'; });
      } catch (e) { _toolstore = []; }
    }
    _toolstore.push({
      id: ++_tsSeq, tool: tool,
      args_json: JSON.stringify(args).slice(0, 300),
      result: String(result && (result.message || JSON.stringify(result))).slice(0, 400),
      ownerLayer: (chat && chat._fgLayerId) || '', ownerNode: (chat && chat._fgNodeKey) || '',
      ts: Date.now(), valid: true
    });
    saveToolStore();
  }
  function toolstoreFind(tool, args) {
    if (!Array.isArray(_toolstore)) return null; // 【修复】脏数据防御
    var aj = JSON.stringify(args).slice(0, 300);
    for (var i = _toolstore.length - 1; i >= 0; i--) {
      var r = _toolstore[i];
      if (r.tool === tool && r.args_json === aj && r.valid) return r;
    }
    return null;
  }

  // ================= 8 内核工具执行（挂到 Tools.execute 前置拦截） =================
  function currentChat(context) {
    var id = (context && context.chatId) || '';
    return (App.chatBoxes || []).filter(function (c) { return c.id === id; })[0] || null;
  }
  function resolveLayer(chat, layerId) {
    var lid = layerId || (chat && chat._fgLayerId);
    return lid ? findLayer(lid) : null;
  }

  CA.execKernel = function (name, args, context) {
    var chat = currentChat(context);
    var layer = resolveLayer(chat, args && args.layer_id);

    switch (name) {
      case 'create_node': {
        // 派小弟协议 v1.1：无验收标准禁止派发（防止发出去无法验收）
        if (args.node_type !== 'start' && args.node_type !== 'end' && !args.accept && args.goal) {
          return { success: false, message: '任务包不完整：有 goal 必须有 accept（验收标准），否则无法回收验收' };
        }
        var r = CA.createNode({
          layerId: (layer && layer.id) || (args && args.layer_id),
          parentId: args.parent_id || (chat && chat._fgNodeKey) || null,
          direction: args.direction === 'before' ? 'before' : 'after',
          label: args.label, prompt: args.prompt, node_type: args.node_type,
          goal: args.goal, accept: args.accept, deliverable: args.deliverable,
          timeout: args.timeout, assigned_to: args.assigned_to, extra_deps: args.extra_deps
        });
        if (r && r.success) {
          var meta = _state[layer.id] && _state[layer.id][r.node];
          r.task_id = meta ? meta.task_id : '';
          r.message += ' | 任务包已登记 task_id=' + (r.task_id || 'N/A');
        }
        return r;
      }
      case 'read_node': {
        if (!layer || !layer._fgNodes[args.node_id]) return { success: false, message: '节点不存在: ' + args.node_id };
        var chatN = null;
        if (window.FGS && FGS._bind && FGS._bind[layer.id]) {
          var cid = FGS._bind[layer.id].chats[args.node_id];
          chatN = (App.chatBoxes || []).filter(function (c) { return c.id === cid; })[0];
        }
        var hist = (chatN && chatN.history || []).slice(-(args.limit || 6)).map(function (h) {
          return h.role + ': ' + String(h.content).slice(0, 300);
        });
        return { success: true, node: args.node_id, label: labelOf(layer, args.node_id), status: CA.getStatus(layer.id, args.node_id), recent_dialog: hist };
      }
      case 'read_global_context': {
        if (!layer) return { success: false, message: '未找到流程图图层' };
        return {
          success: true,
          contexts: CA.readGlobalContext(layer.id, args.limit),
          events: CA.readEvents(layer.id, args.event_limit || 30, args.event_type || null)
        };
      }
      case 'read_tool_store': {
        var list = (Array.isArray(_toolstore) ? _toolstore : []).filter(function (r) { return r.valid; }).slice(-(args.limit || 20));
        if (args.tool) list = list.filter(function (r) { return r.tool === args.tool; });
        return { success: true, records: list };
      }
      case 'run_node': {
        if (!layer) return { success: false, message: '未找到流程图图层' };
        var key = args.node_id || (chat && chat._fgNodeKey);
        if (!key || !layer._fgNodes[key]) return { success: false, message: '节点不存在: ' + key };
        var m = ensureMeta(layer.id, key);
        if (m.is_fixed) return { success: false, message: '节点已固化，不可重跑（工业级定稿保护）' };
        if (m.status === 'deleted') return { success: false, message: '节点已软删除' };
        if (!depsSatisfied(layer, key)) return { success: false, message: '前置依赖未完成（pending_deps），先 run 上游节点' };
        m.status = 'running'; saveState(); refreshBadge(layer, key);
        if (window.FGS && FGS.run) {
          var rr = FGS.run(layer.id, key);
          return rr || { success: true, message: '已从节点 ' + key + ' 启动接力' };
        }
        return { success: false, message: 'FGS 未加载' };
      }
      case 'delete_node': {
        if (!layer) return { success: false, message: '未找到流程图图层' };
        return CA.deleteNode(layer.id, args.node_id, args.reason);
      }
      case 'delete_chain': {
        if (!layer) return { success: false, message: '未找到流程图图层' };
        var ck = args.node_id || (chat && chat._fgNodeKey);
        if (!ck) return { success: false, message: '缺少起始节点 node_id' };
        return CA.deleteChain(layer.id, ck, { direction: args.direction, reason: args.reason, force: args.force === true });
      }
      case 'undo_chain': {
        return CA.undoChain(layer ? layer.id : (args && args.layer_id) || null);
      }
      case 'set_node_fixed': {
        if (!layer) return { success: false, message: '未找到流程图图层' };
        // 派小弟协议 v1.1 步骤6：固化前自动三关验收（不过打回）
        if (args.is_fixed !== false) {
          var aa = CA.autoAccept(layer.id, args.node_id);
          if (!aa.ok) {
            return { success: false, rejected: true, problems: aa.problems,
              message: '三关验收未过，已打回（不固化）：' + aa.problems.join('；') + '。请先让小弟补齐回执/产出，或用 reassign_node 热换人。' };
          }
        }
        return CA.setFixed(layer.id, args.node_id, args.is_fixed !== false, args.note);
      }
      case 'reassign_node': {
        // 派小弟协议 v1.1 步骤7：小弟热替换
        if (!layer) return { success: false, message: '未找到流程图图层' };
        return CA.reassignNode(layer.id, args.node_id, args.assigned_to, args.reason);
      }
      case 'get_canvas_status': {
        if (!layer) return { success: false, message: '未找到流程图图层' };
        var st = CA.getCanvasStatus(layer.id);
        st.recent_events = CA.readEvents(layer.id, 10);
        return { success: true, canvas: st };
      }
      case 'set_charter': {
        // 目标链 v1.0：登记人类总目标（一字不改存档），全图节点元数据自动携带
        var lid = (layer && layer.id) || (args && args.layer_id);
        return CA.setCharter(lid, args.text, '监工(' + ((chat && chat.title) || '主脑') + ')');
      }
      case 'get_charter': {
        var lid2 = (layer && layer.id) || (args && args.layer_id);
        var c = CA.getCharter(lid2);
        return { success: true, charter: c, message: c ? ('人类总目标：' + c.text) : '尚未设立 charter，监工应先用 set_charter 登记人类原话' };
      }
      case 'final_report': {
        // 监工终审报告：固化全部节点后生成，交人类终审
        var lid3 = (layer && layer.id) || (args && args.layer_id);
        return CA.finalReport(lid3);
      }
      case 'get_credits': {
        // 主脑查信誉档案：该派谁、timeout 设多长，按 credit 降序
        return { success: true, credits: CA.getCredits(args.limit || 20), hint: 'credit 高=可靠优先派；done/fail=通过/失败次数；主脑可参考设 timeout' };
      }
      case 'ask_help': {
        // 小弟侧反向求助（7.1）：前置条件不满足时，置 waiting 并发标准求助帧入信箱
        if (!layer) return { success: false, message: '未找到流程图图层' };
        var hk = args.node_id || (chat && chat._fgNodeKey);
        if (!hk || !layer._fgNodes[hk]) return { success: false, message: '节点不存在: ' + hk };
        var hm = ensureMeta(layer.id, hk);
        if (hm.status === 'success' || hm.status === 'deleted') return { success: false, message: '节点已完成/已删除，无需求助' };
        var blockType = args.block_type || 'blocked';
        CA.pushEvent(layer.id, hk, blockType === 'waiting' ? 'waiting' : 'blocked',
          '【求助帧】task_id=' + (hm.task_id || 'N/A') + ' 节点=' + hk +
          ' 求助类型=' + blockType +
          ' 需要什么=' + String(args.need || '未说明').slice(0, 160) +
          ' 已尝试=' + String(args.tried || '未说明').slice(0, 160) +
          ' 建议=' + String(args.suggest || '无').slice(0, 120));
        if (blockType === 'blocked') { hm.status = 'blocked'; saveState(); refreshBadge(layer, hk); }
        else { hm.status = 'waiting'; saveState(); refreshBadge(layer, hk); }
        return {
          success: true, message: '求助帧已入主脑信箱（事件流）。请继续：' +
            '①等待主脑 read_global_context 读到该事件并处理；②不要硬编造结果；③收到答复后按回执单模板继续执行。'
        };
      }
    }
    return null; // 非内核工具，交给原逻辑
  };

  // 拦截 Tools.execute：8 工具前置处理 + ToolStore 记录
  var _origExec = Tools.execute;
  Tools.execute = function (name, args, context) {
    var KERNEL = ['create_node', 'read_node', 'read_global_context', 'read_tool_store', 'run_node', 'delete_node', 'delete_chain', 'undo_chain', 'set_node_fixed', 'reassign_node', 'get_canvas_status', 'get_credits', 'ask_help', 'set_charter', 'get_charter', 'final_report'];
    if (KERNEL.indexOf(name) >= 0) {
      // 只读工具命中 ToolStore 缓存直接复用（杜绝重复消耗）
      if ((name === 'read_global_context' || name === 'read_tool_store' || name === 'get_canvas_status') && args && !args._no_cache) {
        var hit = toolstoreFind(name, args);
        if (hit) return Promise.resolve({ success: true, cached: true, cache_id: hit.id, from: hit, message: '[ToolStore 缓存命中] ' + hit.result });
      }
      var r = CA.execKernel(name, args, context);
      if (r !== null && r !== undefined) {
        toolstoreRecord(name, args, r, currentChat(context));
        return Promise.resolve(r);
      }
    }
    var p = _origExec.apply(this, arguments);
    // 非内核工具也记录（归属节点，供全画布复用）
    if (p && typeof p.then === 'function' && currentChat(context) && currentChat(context)._fgNodeKey) {
      var _nm = name, _ag = args, _cx = context;
      p.then(function (res) {
        try { toolstoreRecord(_nm, _ag, res, currentChat(_cx)); } catch (e) {}
      }).catch(function () {});
    }
    return p;
  };

  // ================= 工具 schema 注册 =================
  var _p = function (d) { return { type: 'string', description: d }; };
  var props = {
    node_id: _p('节点ID（画布节点标签，如 A、B2 或 create_node 返回的 key）'),
    layer_id: _p('流程图图层ID（默认当前会话绑定的图层）'),
    parent_id: _p('create_node：父节点ID，新节点从它生长（默认当前节点）'),
    direction: _p('create_node：after=向下游生长（默认）；before=向上游倒推（反向探索）'),
    label: _p('create_node：新节点显示名'),
    prompt: _p('create_node：新节点的职责提示词'),
    node_type: _p('create_node：task/start/end/review，默认 task'),
    reason: _p('delete_node：删除原因（软删除）'),
    is_fixed: _p('set_node_fixed：true 固化 / false 解锁'),
    note: _p('备注'),
    tool: _p('read_tool_store：按工具名过滤'),
    limit: { type: 'integer', description: '数量限制' }
  };
  var def = function (name, desc, req) {
    return { type: 'function', function: { name: name, description: desc, parameters: { type: 'object', properties: props, required: req || [] } } };
  };
  // 工具定义与「流程图」分类注册已抽出至 public/js/canvas/canvas-tools-defs.js（前端声明层）。
  // 本文件仅保留内核执行逻辑（CA.execKernel + Tools.execute 拦截，见下方）。
  // 兼容：若 canvas-tools-defs.js 未加载（老缓存），此处兜底注册分类，避免切换无分类。
  if (window.registerToolDefs && !window.ToolDefinitions.categories['流程图']) {
    registerToolDefs({
      categories: { "流程图": { icon: '🧬', desc: '无限画布多智能体节点图（兜底注册，完整定义见 canvas/canvas-tools-defs.js）', tools: ['task_complete', 'switch_tool_category', 'ask_user', 'create_node', 'read_node', 'read_global_context', 'read_tool_store', 'run_node', 'delete_node', 'delete_chain', 'undo_chain', 'set_node_fixed', 'reassign_node', 'get_canvas_status', 'get_credits', 'ask_help', 'set_charter', 'get_charter', 'final_report', 'analyze_project', 'read_shared_context'] } }
    });
  }

  // ================= 样式 =================
  function injectStyles() {
    if (document.getElementById('ca-styles')) return;
    var st = document.createElement('style');
    st.id = 'ca-styles';
    st.textContent = `
.ca-badge{position:absolute;top:-10px;left:-8px;font-size:10px;line-height:1;padding:3px 6px;border-radius:8px;color:#fff;z-index:6;pointer-events:none;box-shadow:0 0 8px rgba(0,0,0,.4)}
.ca-idle{background:#78909c}.ca-running{background:#ff9100;animation:caPulse 1s infinite}
.ca-success{background:#00c853;box-shadow:0 0 10px rgba(0,200,83,.7)}
.ca-failed{background:#f50057;box-shadow:0 0 10px rgba(245,0,87,.6)}
.ca-deleted{background:#455a64;text-decoration:line-through}.ca-pdeps{background:#7c4dff}
.ca-waiting{background:#ffca28;color:#333;box-shadow:0 0 10px rgba(255,202,40,.7)}
.ca-blocked{background:#d84315;animation:caPulse 2s infinite}
.ca-reassigned{background:#78909c;text-decoration:line-through}
.ca-timeout{background:#bf360c}
@keyframes caPulse{50%{opacity:.5}}
.ca-attempt{position:absolute;top:-10px;right:-8px;font-size:9px;background:#ff6d00;color:#fff;padding:2px 4px;border-radius:6px;z-index:6;pointer-events:none}
.ca-tmo{position:absolute;bottom:-10px;right:-6px;font-size:9px;background:rgba(0,0,0,.65);color:#ffab40;padding:2px 5px;border-radius:6px;z-index:6;pointer-events:none}
/* 节点整体状态描边（霓虹风格） */
.fg-node.ca-node-running{box-shadow:0 0 14px rgba(255,145,0,.75)!important;border-color:#ff9100!important;animation:caGlow 1.6s ease-in-out infinite}
.fg-node.ca-node-success{box-shadow:0 0 12px rgba(0,200,83,.55)!important;border-color:#00c853!important}
.fg-node.ca-node-failed{box-shadow:0 0 14px rgba(245,0,87,.65)!important;border-color:#f50057!important}
.fg-node.ca-node-waiting{border-color:#ffca28!important;box-shadow:0 0 10px rgba(255,202,40,.5)!important}
.fg-node.ca-node-blocked{border-color:#d84315!important}
.fg-node.ca-node-reassigned{opacity:.45;filter:grayscale(1)}
.fg-node.ca-node-timeout{border-color:#bf360c!important}
@keyframes caGlow{50%{box-shadow:0 0 22px rgba(255,145,0,.95)}}
.fg-node.ca-fixed{outline:2px solid #ffd600;outline-offset:2px}
.fg-node.ca-fixed::after{content:'📌';position:absolute;bottom:-8px;right:-6px;font-size:12px}
.fg-node.ca-deleted-node{opacity:.35;filter:grayscale(1)}
`;
    document.head.appendChild(st);
  }

  // 节点发现 → 刷徽章（轻量版：MutationObserver 按需刷新 + 低频兜底 15s，页面隐藏时暂停）
  var _rAFpending = false;
  var _scheduleRefresh = function () {
    if (_rAFpending) return;
    _rAFpending = true;
    setTimeout(function () { _rAFpending = false; injectStyles(); refreshAll(); }, 200);
  };
  var _startWatcher = function () {
    var canvas = document.getElementById('canvasContent');
    if (!canvas) return setTimeout(_startWatcher, 600);
    try {
      new MutationObserver(_scheduleRefresh).observe(canvas, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(function () {
      if (!document.hidden) { injectStyles(); refreshAll(); }
    }, 15000);
  };
  setTimeout(_startWatcher, 1600);

  // 启动
  setTimeout(function () {
    restore();
    injectStyles();

  }, 1600);

  // ===== 内部 API（供 ops/explore/sandbox 模块使用）=====
  // ================= 画布选中节点感知（供对话上下文注入） =================
  // 读取当前画布上被选中的节点（.kite-node / .fg-node），返回结构化描述：
  // 流程图节点附带所属图层、上下游依赖；媒体/提示词节点附带类型与标题。
  CA.getSelectedNodesInfo = function () {
    var out = [];
    document.querySelectorAll('.fg-node.selected').forEach(function (el) {
      var layer = (window.FlowGlam && FlowGlam._layers || []).find(function (l) {
        return l._fgNodes && Object.keys(l._fgNodes).some(function (k) { return l._fgNodes[k].el === el; });
      });
      if (!layer) return;
      var key = Object.keys(layer._fgNodes).find(function (k) { return layer._fgNodes[k].el === el; });
      if (!key) return;
      var label = labelOf(layer, key);
      var edges = edgesOf(layer);
      var ups = edges.filter(function (e) { return e.to === key; }).map(function (e) { return e.from + '(' + labelOf(layer, e.from) + ')'; });
      var downs = edges.filter(function (e) { return e.from === key; }).map(function (e) { return e.to + '(' + labelOf(layer, e.to) + ')'; });
      var m = ensureMeta(layer.id, key);
      out.push('流程图[' + (layer.name || layer.id) + '] 节点 ' + key + '(' + label + ') 状态=' + effectiveStatus(layer, key) +
        ' 类型=' + (m.node_type || 'task') + (m.is_fixed ? ' [已固化]' : '') +
        ' 上游={' + (ups.join('、') || '无') + '} 下游={' + (downs.join('、') || '无') + '}');
    });
    document.querySelectorAll('.kite-node.selected').forEach(function (el) {
      var t = el.querySelector('.kite-node-title') || el.querySelector('.kite-text-header .kite-node-title');
      var img = el.querySelector('img');
      var desc = el.classList.contains('kite-node-text') ? '提示词节点'
        : el.classList.contains('kite-node-video') ? '视频节点' : '图片节点';
      var txt = '';
      if (img && img.src) txt = ' 图片=' + (img.alt || '').slice(0, 60);
      else if (t) txt = ' 标题=' + (t.textContent || '').slice(0, 60);
      out.push(desc + txt);
    });
    return out;
  };

  CA.__api = {
    findLayer: findLayer, ensureMeta: ensureMeta, edgesOf: edgesOf, labelOf: labelOf,
    saveState: saveState, depsSatisfied: depsSatisfied, effectiveStatus: effectiveStatus,
    getState: function () { return _state; },
    setState: function (s) { _state = s || {}; saveState(); },
    getToolStore: function () { return Array.isArray(_toolstore) ? _toolstore : (_toolstore = []); },
    setToolStore: function (t) { _toolstore = Array.isArray(t) ? t : []; saveToolStore(); },
    getCtxNotes: function () { return _ctxNotes; }
  };
})();
