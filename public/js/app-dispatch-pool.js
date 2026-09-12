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
  var MAX_CONCURRENT = 3;        // 并发上限：最多同时 3 个小弟在跑，防止开屏爆炸
  var state = { timer: null, running: [], log: [], enabled: true, autoClose: true, retried: {} };

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
  var _claimBusy = false, _claimFails = 0;
  function _claim() {
    if (!state.enabled || _claimBusy) return;
    // 并发上限：在跑的小弟满员时本轮不领单
    if (state.running.length >= MAX_CONCURRENT) return;
    _claimBusy = true;
    _post({ action: 'claim', worker: 'browser' }).then(function (r) {
      _claimBusy = false;
      if (r && r.ok) _claimFails = 0;
      else if (++_claimFails > 3) return; // 连续失败时本轮跳过，靠下轮退避
      if (!r || !r.ok || !r.task) return;
      var t = r.task;
      _log('领到任务 ' + t.id + '：' + t.goal.slice(0, 60));
      _dispatch(t);
    });
  }

  // ================================================================
  // =====【节点星环 v3】小弟不再以大对话框示人，折叠为主对话框 =====
  // ===== 边缘的发光小节点：无文字、三态动画、完成后常驻可查 =====
  // ===== hover 出迷你提示，点击展开/收起真实对话，✕ 清空星环 =====
  // ================================================================
  var _nodeCounts = {}; // parentBox.id → 已占用弧位（节点沿主框顶边弧形排开）

  function _injectNodeStyle() {
    if (document.getElementById('dpn-style')) return;
    var st = document.createElement('style');
    st.id = 'dpn-style';
    st.textContent =
      '@keyframes dpnPulse{0%,100%{box-shadow:0 0 0 2px rgba(245,158,11,.9),0 0 10px 2px rgba(245,158,11,.5)}50%{box-shadow:0 0 0 3px rgba(245,158,11,.35),0 0 18px 6px rgba(245,158,11,.8)}}' +
      '@keyframes dpnSpin{to{transform:rotate(360deg)}}' +
      '@keyframes dpnFlash{0%{transform:scale(1)}40%{transform:scale(2)}100%{transform:scale(1)}}' +
      '.dpn-ring{position:absolute;left:0;top:0;right:0;height:0;pointer-events:none;z-index:30;font-size:0}' +
      '.dpn-node{position:absolute;top:-9px;width:14px;height:14px;border-radius:50%;pointer-events:auto;cursor:pointer;background:#f59e0b;transition:transform .2s,background .3s}' +
      '.dpn-node:hover{transform:scale(1.4)}' +
      '.dpn-node .dpn-orb{position:absolute;inset:-5px;border-radius:50%;border:2px dashed rgba(245,158,11,.85);animation:dpnSpin 1.6s linear infinite}' +
      '.dpn-node.dpn-running{background:#f59e0b;animation:dpnPulse 1.4s ease-in-out infinite}' +
      '.dpn-node.dpn-done{background:#22c55e;animation:none;box-shadow:0 0 0 2px rgba(34,197,94,.55),0 0 8px 2px rgba(34,197,94,.4)}' +
      '.dpn-node.dpn-done .dpn-orb,.dpn-node.dpn-failed .dpn-orb{display:none}' +
      '.dpn-node.dpn-failed{background:#ef4444;box-shadow:0 0 0 2px rgba(239,68,68,.55),0 0 8px 2px rgba(239,68,68,.4)}' +
      '.dpn-node.dpn-flash{animation:dpnFlash .6s ease-out}' +
      '.dpn-tip{position:absolute;top:16px;left:50%;transform:translateX(-50%);background:rgba(15,18,25,.95);color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:5px 9px;font-size:11px;line-height:1.5;white-space:nowrap;display:none;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.4);z-index:40;text-align:left}' +
      '.dpn-node:hover .dpn-tip{display:block}' +
      '.dpn-clear{position:absolute;top:-11px;right:8px;width:14px;height:14px;line-height:13px;text-align:center;border-radius:50%;background:rgba(255,255,255,.12);color:#9ca3af;font-size:10px;pointer-events:auto;cursor:pointer;display:none}' +
      '.dpn-ring:hover .dpn-clear{display:block}' +
      '.dpn-clear:hover{background:#ef4444;color:#fff}';
    document.head.appendChild(st);
  }

  function _nodeLayer(parentBox) {
    var el = parentBox.el;
    var ring = null;
    try { ring = el.querySelector(':scope > .dpn-ring'); } catch (e) {}
    if (!ring) {
      _injectNodeStyle();
      ring = document.createElement('div');
      ring.className = 'dpn-ring';
      var clear = document.createElement('div');
      clear.className = 'dpn-clear';
      clear.textContent = '✕';
      clear.title = '清空已完成/失败节点';
      clear.onclick = function (ev) {
        ev.stopPropagation();
        var ns = ring.querySelectorAll('.dpn-node.dpn-done,.dpn-node.dpn-failed');
        for (var k = 0; k < ns.length; k++) ns[k].parentNode.removeChild(ns[k]);
      };
      ring.appendChild(clear);
      el.appendChild(ring);
    }
    return ring;
  }

  // 把真实小弟对话摆到主框下方（展开用）
  function _placeBelow(parentBox, chat, slot) {
    try {
      var px = parseFloat(parentBox.el.style.left) || 100;
      var py = parseFloat(parentBox.el.style.top) || 100;
      chat.el.style.left = (px + slot * 210) + 'px';
      chat.el.style.top = (py + parentBox.el.offsetHeight + 40) + 'px';
    } catch (e) {}
  }

  function _collapseToNode(chat) {
    try {
      if (chat && chat.el && !chat._nodeCollapsed) {
        chat.el.style.display = 'none';
        chat._nodeCollapsed = true;
      }
    } catch (e) {}
  }

  // 新版：在主对话框顶边生成节点，并立即折叠真实对话
  function _attachVisualLink(parentBox, chat, task) {
    try {
      if (!parentBox || !parentBox.el || !chat || !chat.el) return;
      var ring = _nodeLayer(parentBox);
      var pid = parentBox.id || 'p';
      var slot = _nodeCounts[pid] || 0;
      _nodeCounts[pid] = slot + 1;
      var node = document.createElement('div');
      node.className = 'dpn-node dpn-running';
      node.style.left = (14 + slot * 24) + 'px';
      node.innerHTML = '<span class="dpn-orb"></span><div class="dpn-tip">' +
        '<b>#' + ((task && task.id) || '?') + '</b> ' + ((task && task.goal) ? String(task.goal).slice(0, 60) : '派单小弟') +
        '<br>状态：<span class="dpn-tip-st">● 干活中</span>' +
        '<br><span style="opacity:.55">点击展开 / 收起对话</span></div>';
      ring.appendChild(node);
      chat._dispatchNode = node;
      chat._nodeSlot = slot;
      chat._nodeParent = parentBox;
      chat.el.style.display = 'none';   // 立即折叠真实对话，只留节点
      chat._nodeCollapsed = true;
      node.onclick = function (ev) {
        ev.stopPropagation();
        if (!chat.el || !document.body.contains(chat.el)) return;
        if (chat._nodeCollapsed) {
          _placeBelow(parentBox, chat, slot);
          chat.el.style.display = '';
          chat._nodeCollapsed = false;
        } else {
          _collapseToNode(chat);
        }
      };
    } catch (e) { /* 节点创建失败不影响派单本身 */ }
  }

  // 新版：状态切换 → 节点变色 + 短暂亮出真实对话确认后收回
  function _setVisStatus(chat, status) {
    try {
      var node = chat && chat._dispatchNode;
      if (!node || !document.body.contains(node)) return;
      node.classList.remove('dpn-running', 'dpn-done', 'dpn-failed', 'dpn-flash');
      node.classList.add('dpn-' + status, 'dpn-flash');
      var stEl = node.querySelector('.dpn-tip-st');
      if (stEl) stEl.textContent = (status === 'done') ? '✓ 已完成' : '✗ 失败';
      if (status !== 'running') {
        // 短暂亮出真实对话供确认，随后收回节点（节点常驻保留）
        var parentBox = chat._nodeParent, slot = chat._nodeSlot || 0;
        try {
          if (chat._nodeCollapsed) {
            _placeBelow(parentBox, chat, slot);
            chat.el.style.display = '';
            chat._nodeCollapsed = false;
          }
        } catch (e2) {}
        setTimeout(function () {
          try { node.classList.remove('dpn-flash'); } catch (e3) {}
          _collapseToNode(chat);
        }, 1500);
      }
    } catch (e) {}
  }

  function _dispatch(t) {    if (!window.App || typeof App.createChatBox !== 'function') {
      _failOrRetry(t, '前端 App 未就绪，无法创建小弟对话', '');
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
        _attachVisualLink(anchor, chat, t);
      }
    } catch (e) { chat = null; }
    if (!chat) {
      _failOrRetry(t, '创建小弟对话失败', '');
      return;
    }

    try { App.updateChatTitle(chat.el, '小弟·' + t.id); } catch (e) {}
    try { App.addMsg(chat.el, prompt, 'user', chat.modelId); } catch (e) {}
    try {
      chat.history = chat.history || [];
      chat.history.push({ role: 'user', content: prompt });
    } catch (e) {}

    var rec = { id: t.id, chat: chat, parentBox: anchor, startedAt: Date.now(), timer: null };
    try { chat._dispatchWorker = true; } catch (e) {} // 标记：这是派单小弟对话，供收工功能识别
    state.running.push(rec);
    // 等待小弟跑完：isSending 归位且历史里有 assistant 消息
    rec.timer = setInterval(function () { _checkDone(rec); }, FINISH_POLL_MS);
    try { App.sendToModel(chat.el, chat); _log('已派发给小弟对话 ' + chat.id); } catch (e) {
      clearInterval(rec.timer);
      _failOrRetry(t, '派发失败：' + e.message, chat.id);
    }
  }

  function _checkDone(rec) {
    var chat = rec.chat;
    if (!chat || !App.chatBoxes || App.chatBoxes.indexOf(chat) < 0) {
      // 对话被关闭：视为中止
      clearInterval(rec.timer);
      _removeRun(rec);
      _setVisStatus(chat, 'failed');
      _reportToParent(rec.parentBox, rec.id, 'failed', '小弟对话被手动关闭，任务中止');
      _failOrRetry({ id: rec.id, goal: '', accept: '', deliverable: '', constraints: '', priority: 0, parent_chat_id: rec.parentBox ? rec.parentBox.id : '', timeout_sec: 900 }, '小弟对话被手动关闭，任务中止', chat ? chat.id : '');
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
    _setVisStatus(chat, 'done');
    _post({
      action: 'receipt', id: rec.id, result: 'done',
      summary: lastAi.slice(0, 2000),
      evidence: '小弟对话 ' + chat.id + '，消息数 ' + (chat.history || []).length,
      chat_id: chat.id
    });
    _log('任务 ' + rec.id + ' 小弟已完成，回执已写回');
    // 【收工】任务完成 → 延迟 8 秒自动关闭小弟对话（给用户留出看回执的时间）
    // 星环模式：完成后不销毁对话，只收回节点（对话隐藏保留，点节点可展开复查）
    if (state.autoClose) {
      var box = chat;
      setTimeout(function () { _collapseToNode(box); }, 4000);
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

  // 【回执回报】把小弟完成/失败结果以系统消息形式送回主对话框，形成视觉+信息双闭环
  function _reportToParent(parentBox, taskId, result, summary) {
    try {
      if (!parentBox || !parentBox.el || !App.chatBoxes || App.chatBoxes.indexOf(parentBox) < 0) return;
      if (parentBox.isSending) return; // 主对话在跑时不打扰
      var icon = result === 'done' ? '✅' : '❌';
      var text = icon + ' 【小弟回执 #' + taskId + '】' +
        (result === 'done' ? '已完成' : '失败') + '：' + String(summary || '').slice(0, 500);
      try { App.addMsg(parentBox.el, text, 'user', parentBox.modelId); } catch (e1) {}
      try {
        parentBox.history = parentBox.history || [];
        parentBox.history.push({ role: 'user', content: text });
      } catch (e2) {}
    } catch (e) {}
  }

  // 【失败重试】小弟对话被关闭/创建失败时，同一任务自动重试一次（避免偶发故障直接判死）
  function _failOrRetry(t, reason, chatId) {
    if (!state.retried[t.id]) {
      state.retried[t.id] = true;
      _log('任务 ' + t.id + ' 失败（' + reason.slice(0, 40) + '），自动重试一次');
      // 把任务放回池中：直接改状态为 pending 需要后端支持，这里用回执 failed + 重新 submit 等价实现
      _post({ action: 'receipt', id: t.id, result: 'failed', summary: reason, evidence: '', chat_id: chatId || '' });
      _post({
        action: 'submit', goal: t.goal, accept: t.accept,
        deliverable: t.deliverable, constraints: t.constraints,
        priority: t.priority, parent_chat_id: t.parent_chat_id, timeout_sec: t.timeout_sec
      });
      return;
    }
    _receipt(t, 'failed', reason + '（已重试一次仍失败）', chatId);
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
