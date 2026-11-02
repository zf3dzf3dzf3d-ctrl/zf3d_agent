/* ============================================================
 * agent-loop-remote.js —— 前端瘦终端（D2）
 * 作用：浏览器只做「发任务、看进度、点审批」；真正的模型循环跑在
 *       服务端 loop_s.py 内核（后台线程），关页面任务照跑。
 * API：POST /api/loop_s/start · GET /api/loop_s/events(SSE,cursor 续读)
 *      GET /api/loop_s/status · POST /api/loop_s/stop · POST /api/approval/<id>
 * 依赖：复用主界面的消息渲染（window.appendChatMsg / addApprovalCard），
 *       缺失时降级为 console + alert，保证瘦终端可独立自测。
 * 开关：window.LOOP_REMOTE_ENABLED=true 时启用；默认不接管现有浏览器循环。
 * ============================================================ */
(function () {
  'use strict';
  if (window.LoopRemote) return; // 防重复加载

  var API = {
    start:   '/api/loop_s/start',
    events:  '/api/loop_s/events',
    status:  '/api/loop_s/status',
    stop:    '/api/loop_s/stop',
    approval: '/api/approval/'
  };

  // ---- 渲染降级：主界面缺钩子时不崩 ----
  function render(kind, data) {
    if (typeof window.appendChatMsg === 'function') {
      try { window.appendChatMsg(kind, data); return; } catch (e) { /* fallthrough */ }
    }
    console.log('[loop-remote]', kind, data);
  }
  function approvalCard(req) {
    if (typeof window.addApprovalCard === 'function') {
      try { window.addApprovalCard(req); return; } catch (e) { /* fallthrough */ }
    }
    console.warn('[loop-remote] 审批待决：', req);
  }

  // ---- SSE 订阅（cursor 断线续读）----
  function subscribe(runId, cursor, handlers) {
    cursor = cursor || 0;
    var es = null, stopped = false;
    function connect() {
      if (stopped) return;
      es = new EventSource(API.events + '?run_id=' + encodeURIComponent(runId) + '&cursor=' + cursor);
      es.onmessage = function () {}; // 心跳
      ['turn_start', 'model_reply', 'tool_result', 'tool_result_truncated',
       'tool_repaired', 'loop_warning', 'loop_fatal', 'approval',
       'approval_resolved', 'stop_requested', 'stopped', 'done',
       'max_turns', 'error', 'gone'].forEach(function (kind) {
        es.addEventListener(kind, function (ev) {
          var d = {}; try { d = JSON.parse(ev.data); } catch (e) {}
          if (d.seq) cursor = d.seq;
          render(kind, d);
          if (kind === 'approval') approvalCard(d);
          if (handlers && handlers[kind]) try { handlers[kind](d); } catch (e) {}
          if (kind === 'done' || kind === 'error' || kind === 'max_turns' ||
              kind === 'stopped' || kind === 'gone') {
            es.close(); stopped = true;
            if (handlers && handlers.end) try { handlers.end(kind, d); } catch (e) {}
          }
        });
      });
      es.onerror = function () {
        es.close();
        if (stopped) return;
        // 断线续读：1s 后带 cursor 重连（loop_s 事件流按 seq 持久保存于内存 run）
        setTimeout(connect, 1000);
      };
    }
    connect();
    return { close: function () { stopped = true; if (es) es.close(); } };
  }

  // ---- 发起运行 ----
  function start(payload) {
    return fetch(API.start, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (r) { return r.json(); });
  }

  // ---- 停止 ----
  function stop(runId) {
    return fetch(API.stop, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: runId })
    }).then(function (r) { return r.json(); });
  }

  // ---- 审批决议 ----
  function resolveApproval(reqId, action, reason) {
    return fetch(API.approval + encodeURIComponent(reqId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, reason: reason || '' })
    }).then(function (r) { return r.json(); });
  }

  // ---- 审批列表 ----
  function listApprovals(status) {
    return fetch('/api/approval/list' + (status ? ('?status=' + status) : ''))
      .then(function (r) { return r.json(); });
  }

  // ---- 一键启动+订阅组合 ----
  function run(payload, handlers) {
    return start(payload).then(function (res) {
      if (!res.ok) throw new Error(res.err || 'start failed');
      var sub = subscribe(res.run_id, 0, handlers);
      return { run_id: res.run_id, sub: sub,
               stop: function () { return stop(res.run_id); } };
    });
  }

  window.LoopRemote = {
    start: start, stop: stop, subscribe: subscribe,
    resolveApproval: resolveApproval, listApprovals: listApprovals,
    run: run,
    enabled: function () { return window.LOOP_REMOTE_ENABLED === true; }
  };
  console.log('[loop-remote] 瘦终端就绪（默认不接管；设 window.LOOP_REMOTE_ENABLED=true 启用）');
})();
