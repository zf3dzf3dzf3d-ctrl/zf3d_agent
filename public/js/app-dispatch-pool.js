/**
 * app-dispatch-pool.js — 派单池浏览器桥（命令行侧直接派小弟）
 * ---------------------------------------------------------------
 * 轮询 POST /api/dispatch/pool {action:'claim'} 领任务包，
 * 领到后自动创建一个小弟对话（复用 chat_manage create + auto_send 全套流程），
 * 小弟跑完后（isSending 归位 + 有最后一条 AI 消息）回写回执。
 *
 * 挂 window.DispatchPool：DispatchPool.status() 查看 / DispatchPool.stop() 停。
 * 零侵入：只依赖 App.createChatBox / App.sendToModel / App.addMsg，不改动其他文件。
 */
(function () {
  'use strict';
  if (window.DispatchPool) return;

  var POLL_MS = 5 * 1000;        // 领单轮询间隔
  var FINISH_POLL_MS = 2 * 1000; // 等小弟跑完的检查间隔
  var state = { timer: null, running: [], log: [], enabled: true, autoClose: true };

  function _log(m) {
    state.log.unshift('[' + new Date().toLocaleTimeString() + '] ' + m);
    if (state.log.length > 100) state.log.pop();
    // console.log 已移除：控制台不再输出启动提示（内部日志保留在 state.log，DispatchPool.status() 可查）
  }

  function _post(body) {
    return fetch('/api/dispatch/pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); }).catch(function (e) {
      return { ok: false, error: String(e) };
    });
  }

  // ---------- 组装任务包提示词（目标链统一协议 v1.0） ----------
  function _buildPrompt(t) {
    var p = '';
    p += '【派单任务 #' + t.id + '】（来自命令行侧主控智能体的派单）\n';
    p += '目标：' + t.goal + '\n';
    p += '验收标准：' + (t.accept || '自述完成且给出产出') + '\n';
    p += '交付物：' + (t.deliverable || '文字结论') + '\n';
    if (t.constraints) p += '约束：' + t.constraints + '\n';
    p += '\n要求：完成后用 task_complete 结束，并在最终消息中写清：做了什么、产出在哪、';
    p += '自我评估是否达标（三关验收：存在性/正确性/无副作用）。';
    return p;
  }

  // ---------- 领单 → 派给小弟 ----------
  function _claim() {
    if (!state.enabled) return;
    _post({ action: 'claim', worker: 'browser' }).then(function (r) {
      if (!r || !r.ok || !r.task) return;
      var t = r.task;
      _log('领到任务 ' + t.id + '：' + t.goal.slice(0, 60));
      _dispatch(t);
    });
  }

  // ===== 【视觉关联】主对话框 ↔ 小弟对话框 =====
  // 1. SVG 连线（正下方 50px 间隙中的一条发光连线）
  // 2. 同色系边框高亮，一眼看出从属关系
  // 3. 跟随移动：主对话移动/关闭时连线实时更新
  var _linkLayer = null;
  function _getLinkLayer() {
    if (_linkLayer && document.body.contains(_linkLayer)) return _linkLayer;
    _linkLayer = document.createElement('div');
    _linkLayer.id = 'dispatch-link-layer';
    _linkLayer.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:99998;';
    document.body.appendChild(_linkLayer);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'position:absolute;inset:0;';
    _linkLayer.appendChild(svg);
    _linkLayer._svg = svg;
    return _linkLayer;
  }

  function _attachVisualLink(parentBox, chat) {
    try {
      var layer = _getLinkLayer();
      var svg = layer._svg;
      var ns = 'http://www.w3.org/2000/svg';
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('stroke', '#f59e0b');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6 4');
      line.style.cssText = 'filter:drop-shadow(0 0 3px #f59e0b);';
      svg.appendChild(line);

      // 小弟框高亮：橙色边框 + 角标，与连线同色呼应
      chat.el.style.boxShadow = '0 0 0 2px #f59e0b, 0 4px 14px rgba(245,158,11,.35)';
      var badge = document.createElement('div');
      badge.textContent = '↓ 小弟 · ' + (chat.id || '');
      badge.style.cssText =
        'position:absolute;top:-10px;left:10px;background:#f59e0b;color:#000;' +
        'font-size:11px;font-weight:bold;padding:1px 8px;border-radius:8px;' +
        'white-space:nowrap;z-index:1;box-shadow:0 0 6px rgba(245,158,11,.6);';
      chat.el.appendChild(badge);

      function draw() {
        if (!document.body.contains(chat.el) || !document.body.contains(parentBox.el)) {
          line.remove(); badge.remove();
          try { chat.el.style.boxShadow = ''; } catch (e) {}
          return;
        }
        var a = parentBox.el.getBoundingClientRect();
        var b = chat.el.getBoundingClientRect();
        // 连主对话底边中点 → 小弟顶边中点
        line.setAttribute('x1', a.left + a.width / 2);
        line.setAttribute('y1', a.bottom);
        line.setAttribute('x2', b.left + b.width / 2);
        line.setAttribute('y2', b.top);
      }
      draw();
      // 跟随：主对话或小弟任一方拖动/缩放时实时重画
      var mo = new MutationObserver(draw);
      mo.observe(parentBox.el, { attributes: true, attributeFilter: ['style'] });
      mo.observe(chat.el, { attributes: true, attributeFilter: ['style'] });
      window.addEventListener('resize', draw);
      window.addEventListener('scroll', draw, true);
      // 画布 transform（平移/缩放）也会改变视口坐标，低频轮询兜底
      var poll = setInterval(function () {
        if (!document.body.contains(chat.el) || !document.body.contains(parentBox.el)) {
          clearInterval(poll); mo.disconnect();
          line.remove(); try { badge.remove(); } catch (e) {}
          try { chat.el.style.boxShadow = ''; } catch (e) {}
          return;
        }
        draw();
      }, 500);
    } catch (e) { /* 视觉关联失败不影响派单本身 */ }
  }

  function _dispatch(t) {    if (!window.App || typeof App.createChatBox !== 'function') {
      _receipt(t, 'failed', '前端 App 未就绪，无法创建小弟对话', '');
      return;
    }
    // 找个空闲模型：沿用最右侧对话的模型，或第一个
    var modelId = null;
    try {
      var boxes = App.chatBoxes || [];
      for (var i = boxes.length - 1; i >= 0; i--) {
        if (boxes[i] && boxes[i].modelId && !boxes[i].isSending) { modelId = boxes[i].modelId; break; }
      }
      if (!modelId && boxes.length) modelId = boxes[0].modelId;
    } catch (e) {}
    if (!modelId) {
      _receipt(t, 'failed', '无可用模型（请先在任一对话选择模型）', '');
      return;
    }

    var prompt = _buildPrompt(t);
    var chat = null;
    try {
      // 【视觉关联】优先：定位到「主对话框」（派单来源对话）正下方约 50px、左右对齐
      var x = 0, y = 0, anchor = null;
      var parentBox = null;
      if (t.parent_chat_id) {
        var bs = App.chatBoxes || [];
        for (var i = 0; i < bs.length; i++) {
          if (bs[i] && bs[i].id === t.parent_chat_id) { parentBox = bs[i]; break; }
        }
      }
      if (!parentBox) {
        // 未指定父对话：用当前画布上最高的（视觉主）对话框作锚点
        var best = -1, bs2 = App.chatBoxes || [];
        for (var j = 0; j < bs2.length; j++) {
          if (!bs2[j] || !bs2[j].el) continue;
          var ty = parseFloat(bs2[j].el.style.top) || 0;
          if (ty < best || best < 0) { best = ty; parentBox = bs2[j]; }
        }
      }
      if (parentBox && parentBox.el) {
        anchor = parentBox;
        x = parseFloat(parentBox.el.style.left) || 100;            // 左右对齐
        y = (parseFloat(parentBox.el.style.top) || 100)
            + parentBox.el.offsetHeight + 50;                        // 正下方 50px 间隙
      } else {
        var last = (App.chatBoxes && App.chatBoxes.length) ? App.chatBoxes[App.chatBoxes.length - 1] : null;
        x = last ? (parseFloat(last.el.style.left) || 100) + 40 : 100;
        y = last ? (parseFloat(last.el.style.top) || 100) + 40 : 100;
      }
      chat = App.createChatBox(x, y, modelId);
      if (chat && anchor && chat.el) {
        _attachVisualLink(anchor, chat);
      }
    } catch (e) { chat = null; }
    if (!chat) {
      _receipt(t, 'failed', '创建小弟对话失败', '');
      return;
    }

    try { App.updateChatTitle(chat.el, '小弟·' + t.id); } catch (e) {}
    try { App.addMsg(chat.el, prompt, 'user', chat.modelId); } catch (e) {}
    try {
      chat.history = chat.history || [];
      chat.history.push({ role: 'user', content: prompt });
    } catch (e) {}

    var rec = { id: t.id, chat: chat, startedAt: Date.now(), timer: null };
    try { chat._dispatchWorker = true; } catch (e) {} // 标记：这是派单小弟对话，供收工功能识别
    state.running.push(rec);
    // 等待小弟跑完：isSending 归位且历史里有 assistant 消息
    rec.timer = setInterval(function () { _checkDone(rec); }, FINISH_POLL_MS);
    try { App.sendToModel(chat.el, chat); _log('已派发给小弟对话 ' + chat.id); } catch (e) {
      clearInterval(rec.timer);
      _receipt(t, 'failed', '派发失败：' + e.message, chat.id);
    }
  }

  function _checkDone(rec) {
    var chat = rec.chat;
    if (!chat || !App.chatBoxes || App.chatBoxes.indexOf(chat) < 0) {
      // 对话被关闭：视为中止
      clearInterval(rec.timer);
      _removeRun(rec);
      _post({ action: 'receipt', id: rec.id, result: 'failed', summary: '小弟对话被手动关闭，任务中止', evidence: '', chat_id: chat ? chat.id : '' });
      _log('任务 ' + rec.id + ' 对话被关闭，中止');
      return;
    }
    if (chat.isSending) return; // 还在跑
    var lastAi = '';
    try {
      for (var i = (chat.history || []).length - 1; i >= 0; i--) {
        if (chat.history[i].role === 'assistant') { lastAi = chat.history[i].content || ''; break; }
      }
    } catch (e) {}
    if (!lastAi) return; // 还没开始回（发送中排队等）
    clearInterval(rec.timer);
    _removeRun(rec);
    _post({
      action: 'receipt', id: rec.id, result: 'done',
      summary: lastAi.slice(0, 2000),
      evidence: '小弟对话 ' + chat.id + '，消息数 ' + (chat.history || []).length,
      chat_id: chat.id
    });
    _log('任务 ' + rec.id + ' 小弟已完成，回执已写回');
    // 【收工】任务完成 → 延迟 8 秒自动关闭小弟对话（给用户留出看回执的时间）
    if (state.autoClose) {
      var box = chat;
      setTimeout(function () { _closeWorker(box, rec.id); }, 8000);
    }
  }

  // ---------- 收工：关闭小弟对话 ----------
  function _closeWorker(chat, taskId) {
    if (!chat) return;
    try {
      if (App.chatBoxes && App.chatBoxes.indexOf(chat) < 0) return; // 已被手动关闭
      if (chat.isSending) { // 还在跑，不收工
        _log((taskId ? '任务 ' + taskId + ' ' : '') + '小弟 ' + chat.id + ' 仍在运行，暂不收工');
        return;
      }
      try { App.closeChatBox(chat); } catch (e1) {
        try {
          if (chat.el && chat.el.parentNode) chat.el.parentNode.removeChild(chat.el);
          if (App.chatBoxes) { var i = App.chatBoxes.indexOf(chat); if (i >= 0) App.chatBoxes.splice(i, 1); }
        } catch (e2) {}
      }
      _log((taskId ? '任务 ' + taskId + ' ' : '') + '小弟对话 ' + chat.id + ' 已收工关闭');
    } catch (e) { _log('收工失败：' + e.message); }
  }

  // 收工全部小弟：只关 _dispatchWorker 标记的、且当前空闲的对话；force=true 连在跑的一起关
  function closeAllWorkers(force) {
    var closed = [];
    try {
      var boxes = (App.chatBoxes || []).slice();
      for (var i = 0; i < boxes.length; i++) {
        var c = boxes[i];
        if (!c || !c._dispatchWorker) continue;
        if (!force && c.isSending) continue;
        _closeWorker(c, null);
        closed.push(c.id);
      }
    } catch (e) { _log('收工全部失败：' + e.message); }
    _log('收工完毕，共关闭 ' + closed.length + ' 个小弟：' + closed.join(', '));
    return closed;
  }

  function _removeRun(rec) {
    var i = state.running.indexOf(rec);
    if (i >= 0) state.running.splice(i, 1);
  }

  function _receipt(t, result, summary, chatId) {
    _post({ action: 'receipt', id: t.id, result: result, summary: summary, evidence: '', chat_id: chatId || '' });
    _log('任务 ' + t.id + ' → ' + result + '：' + summary.slice(0, 60));
  }

  // ---------- 启动 ----------
  function start() {
    if (state.timer) return;
    state.timer = setInterval(_claim, POLL_MS);
    _log('派单池浏览器桥已启动（每 5s 领单）');
    _claim();
  }

  function stop() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.running.forEach(function (r) { if (r.timer) clearInterval(r.timer); });
    state.running = [];
    state.enabled = false;
    _log('派单池浏览器桥已停止');
  }

  window.DispatchPool = {
    start: start, stop: stop,
    closeAll: closeAllWorkers, // 收工：关闭所有空闲小弟对话；closeAll(true) 强制连在跑的一起关
    setAutoClose: function (v) { state.autoClose = !!v; _log('自动收工已' + (v ? '开启' : '关闭')); return state.autoClose; },
    status: function () {
      return {
        enabled: state.enabled, autoClose: state.autoClose,
        running: state.running.map(function (r) { return r.id; }),
        log: state.log.slice(0, 20)
      };
    }
  };

  function boot(retries) {
    if (window.App && typeof App.createChatBox === 'function') { start(); return; }
    if ((retries || 0) < 40) setTimeout(function () { boot((retries || 0) + 1); }, 500);
    else _log('App 未加载，派单桥未启动');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); });
  else boot();
})();
