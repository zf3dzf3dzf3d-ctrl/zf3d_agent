/* ============================================================
 * app-flowglam-sessions.js - FlowGlam 会话化 + 真实串联/并联
 * 让每张霓虹流程图的每个节点都变成一个真实会话锚点：
 *   - 单击节点 → 展开一个真实对话（复用 App.createChatBox 全套底层）
 *   - 关闭对话 → 节点自动折叠回去，徽章显示状态（空闲/运行中/已完成）
 *   - 双击节点 → 从该节点启动真实接力（串联：上游结果 → 下游输入；
 *     并联：一个节点多条出边 = 分叉同时发送）
 *   - 连线高亮表示数据流动方向
 * 暴露 window.FGS（FlowGlam Sessions）
 * ============================================================ */
(function () {
  'use strict';

  var FGS = (window.FGS = window.FGS || {});
  var KV_KEY = 'flowglam_sessions';

  // layer.id -> { mermaid, chats: { nodeKey: chatId }, prompts: { nodeKey: prompt } }
  var _bind = {};
  FGS._bind = _bind; // 暴露给 CanvasAgent 等内核读取节点会话绑定
  // 供内核动态建节点后补绑定（不自动开会话，仅占位）
  FGS.ensureNodeBind = function (layer, nodeKey) {
    if (!_bind[layer.id]) _bind[layer.id] = { chats: {}, prompts: {} };
    return _bind[layer.id];
  };

  // ---------- 工具 ----------
  function _esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function findLayer(layerId) {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].id === layerId) return layers[i];
    }
    return null;
  }

  function ensureBind(layer) {
    if (!_bind[layer.id]) {
      _bind[layer.id] = { chats: {}, prompts: {} };
    }
    return _bind[layer.id];
  }

  function nodeInfo(layer, nodeKey) {
    var map = layer._fgNodes || {};
    return map[nodeKey] || null;
  }

  function chatById(chatId) {
    return (App.chatBoxes || []).filter(function (c) { return c.id === chatId; })[0] || null;
  }

  // ---------- 样式 ----------
  function injectStyles() {
    if (document.getElementById('fgs-styles')) return;
    var st = document.createElement('style');
    st.id = 'fgs-styles';
    st.textContent = `
/* ===== FlowGlam 会话化 ===== */
.fg-node { cursor: pointer; }
.fg-node .fg-sess-dot {
  position:absolute; top:-6px; right:-6px; width:14px; height:14px;
  border-radius:50%; display:none; z-index:5;
  border:2px solid rgba(255,255,255,.85);
  box-shadow:0 0 8px rgba(0,0,0,.5);
}
.fg-node.fgs-has-session .fg-sess-dot { display:block; }
.fg-node.fgs-idle .fg-sess-dot { background:#78909c; box-shadow:0 0 8px rgba(120,144,156,.9); }
.fg-node.fgs-running .fg-sess-dot {
  background:#00e5ff; animation:fgs-pulse 1s ease-in-out infinite;
  box-shadow:0 0 12px rgba(0,229,255,.95);
}
.fg-node.fgs-done .fg-sess-dot { background:#00e676; box-shadow:0 0 12px rgba(0,230,118,.95); }
@keyframes fgs-pulse {
  0%,100% { transform:scale(1); opacity:1; }
  50% { transform:scale(1.45); opacity:.6; }
}
.fg-node.fgs-active-glow { filter:brightness(1.35) saturate(1.3); }
.fg-edge-base.fgs-flow-hot { stroke-width:4 !important; filter:drop-shadow(0 0 6px #00e5ff); }
/* 节点提示角标 */
.fg-node .fg-sess-tip {
  position:absolute; bottom:-20px; left:50%; transform:translateX(-50%);
  font-size:9px; white-space:nowrap; color:#8fb4e8; letter-spacing:1px;
  background:rgba(10,14,28,.85); padding:2px 8px; border-radius:8px;
  border:1px solid rgba(120,160,255,.25); opacity:0; transition:opacity .2s;
  pointer-events:none;
}
.fg-node:hover .fg-sess-tip { opacity:1; }
`;
    document.head.appendChild(st);
  }

  // ---------- 会话状态徽章（定时轮询刷新） ----------
  setInterval(function () {
    Object.keys(_bind).forEach(function (layerId) {
      var layer = findLayer(layerId);
      if (!layer || !layer._fgNodes) return;
      var b = _bind[layerId];
      Object.keys(b.chats).forEach(function (k) {
        var info = nodeInfo(layer, k);
        if (!info || !info.el) return;
        var chat = chatById(b.chats[k]);
        info.el.classList.remove('fgs-idle', 'fgs-running', 'fgs-done');
        if (!chat) {
          info.el.classList.add('fgs-idle');
        } else if (chat.isSending) {
          info.el.classList.add('fgs-running');
        } else {
          var hadA = (chat.history || []).some(function (h) { return h.role === 'assistant'; });
          info.el.classList.add(hadA ? 'fgs-done' : 'fgs-idle');
        }
      });
    });
  }, 900);

  // ---------- 打开 / 展开节点会话 ----------
  function openNodeSession(layer, nodeKey) {
    var info = nodeInfo(layer, nodeKey);
    if (!info || !info.el) return;
    var b = ensureBind(layer);
    injectStyles();

    // 已有会话 → 激活并平移画布到它
    var exist = chatById(b.chats[nodeKey]);
    if (exist) {
      App.activate(exist.el);
      exist.el.classList.remove('fgs-collapsed-target');
      flashNode(layer, nodeKey);
      return;
    }

    // 新建会话：位置在节点右侧 40px
    var host = document.getElementById('canvasContent');
    var hr = host.getBoundingClientRect();
    var x = (parseFloat(info.el.style.left) || 0) + (info.w || 190) + 40;
    var y = (parseFloat(info.el.style.top) || 0) - 10;
    var chat = App.createChatBox(x + hr.left, y + hr.top, null);
    if (!chat) return;
    chat._fgLayerId = layer.id;
    chat._fgNodeKey = nodeKey;
    b.chats[nodeKey] = chat.id;

    // 标题绑定节点名
    var label = info.el.querySelector('.fg-label');
    var name = label ? label.textContent : nodeKey;
    App.updateChatTitle(chat.el, '◈ ' + name);

    // 会话关闭 → 节点折叠回去（由 closeChatBox patch 处理，这里只刷徽章）
    info.el.classList.add('fgs-has-session', 'fgs-active-glow');
    addTip(info.el, '双击启动接力');
    save();
    flashNode(layer, nodeKey);
  }

  function addTip(el, text) {
    var tip = el.querySelector('.fg-sess-tip');
    if (!tip) {
      tip = document.createElement('span');
      tip.className = 'fg-sess-tip';
      el.appendChild(tip);
    }
    tip.textContent = text;
  }

  function flashNode(layer, nodeKey) {
    var info = nodeInfo(layer, nodeKey);
    if (!info || !info.el) return;
    info.el.classList.add('fgs-active-glow');
    setTimeout(function () { info.el.classList.remove('fgs-active-glow'); }, 1200);
  }

  // ---------- 会话关闭 → 节点折叠 ----------
  var _origClose = App.closeChatBox;
  App.closeChatBox = function (chat) {
    var r = _origClose.apply(this, arguments);
    try {
      if (chat && chat._fgLayerId && chat._fgNodeKey) {
        var layer = findLayer(chat._fgLayerId);
        if (layer) {
          var info = nodeInfo(layer, chat._fgNodeKey);
          if (info && info.el) {
            info.el.classList.remove('fgs-active-glow');
            info.el.classList.remove('fgs-running', 'fgs-done');
            info.el.classList.add('fgs-idle'); // 折叠态：灰点，点击可重开
            addTip(info.el, '会话已关闭，点击重开');
          }
        }
      }
    } catch (e) {}
    return r;
  };

  // ---------- 真实接力（串联 / 并联） ----------
  function getNodeLabel(layer, k) {
    var info = nodeInfo(layer, k);
    var label = info && info.el && info.el.querySelector('.fg-label');
    return label ? label.textContent : k;
  }

  function sendToChat(chat, msg) {
    var input = chat.el.querySelector('textarea');
    if (input) input.value = '';
    App.addMsg(chat.el, msg, 'user', chat.modelId);
    App.showQueryPin(chat.el, msg);
    chat.history.push({ role: 'user', content: msg });
    App.sendToModel(chat.el, chat);
  }

  function markEdge(layer, from, to, on) {
    var edges = layer._fgEdgeRefs || [];
    edges.forEach(function (e) {
      if (e.from === from && e.to === to) {
        if (e.base) e.base.classList.toggle('fgs-flow-hot', !!on);
        if (e.glow) e.glow.style.opacity = on ? '.6' : '';
      }
    });
  }

  function highlightOutgoing(layer, k) {
    (layer._fgParsedEdges || []).forEach(function (e) {
      if (e.from === k) markEdge(layer, e.from, e.to, true);
    });
  }

  FGS.run = function (layerId, startKey, userPrompt) {
    var layer = findLayer(layerId);
    if (!layer || !layer._fgNodes) return { success: false, message: '未找到流程图图层' };
    var edges = layer._fgParsedEdges || [];
    var b = ensureBind(layer);

    // 入度表
    var indeg = {}, totalIn = {};
    Object.keys(layer._fgNodes).forEach(function (k) { indeg[k] = 0; totalIn[k] = 0; });
    edges.forEach(function (e) { totalIn[e.to] = (totalIn[e.to] || 0) + 1; });

    // 起点：用户指定 or 入度为 0 的源节点
    var starts = startKey ? [startKey] : Object.keys(totalIn).filter(function (k) { return !totalIn[k]; });
    if (!starts.length) starts = [Object.keys(layer._fgNodes)[0]];

    var results = {};   // nodeKey -> 最后一条 assistant 回复
    var fired = {};     // nodeKey -> 已发送
    var firing = {};    // nodeKey -> 待发送（节点忙时重试中）
    var _seqGuard = 0;

    function fireNode(k) {
      if (fired[k]) return;
      // 不再直接 return：占位进 firing 表，由 tick 定时器持续重试
      firing[k] = true;
      trySend(k);
    }

    // 真正执行发送；节点忙（isSending）时保留在 firing 表，下轮 tick 重试
    function trySend(k) {
      if (fired[k]) { delete firing[k]; return true; }
      var chat = chatById(b.chats[k]);
      if (!chat) {
        // 未开过会话：自动开一个再发
        openNodeSession(layer, k);
        chat = chatById(b.chats[k]);
        if (!chat) return false; // 创建失败，留在 firing 表继续重试
      }
      if (chat.isSending) return false; // 下一轮 tick 再试

      delete firing[k];
      fired[k] = true;

      var label = getNodeLabel(layer, k);
      var prompt = (b.prompts && b.prompts[k]) ||
        (layer._fgNodes[k] && layer._fgNodes[k]._caPrompt) ||
        '你是工程流程图节点【' + label + '】。请根据上游输入完成本节点的职责，输出结构化结果。';
      var upstream = edges.filter(function (e) { return e.to === k; })
        .filter(function (e) { return results[e.from] !== undefined; })
        .map(function (e) {
          return '### 来自节点【' + getNodeLabel(layer, e.from) + '】的结果：\n' + results[e.from];
        }).join('\n\n');
      var msg = (k === starts[0] && userPrompt ? userPrompt + '\n\n' : '') + prompt +
        (upstream ? '\n\n===== 上游节点输入 =====\n' + upstream : '');
      sendToChat(chat, msg);
      highlightOutgoing(layer, k);
    }

    // 启动源节点（并联：多条出边 → 各自下游同时触发）
    starts.forEach(fireNode);

    // 完成监控：某节点 isSending→false 且有 assistant 输出 → 结果流向下游
    var timer = setInterval(function () {
      if (++_seqGuard > 1800) { clearInterval(timer); return; } // 30 分钟兜底
      var layerNow = findLayer(layerId);
      if (!layerNow) { clearInterval(timer); return; }
      // 重试待发送节点（节点忙 → 空闲后自动补发）
      Object.keys(firing).forEach(function (k) { trySend(k); });
      var pending = false;
      Object.keys(fired).forEach(function (k) {
        var chat = chatById(b.chats[k]);
        if (!chat) return;
        if (chat.isSending) { pending = true; return; }
        var hadA = (chat.history || []).some(function (h) { return h.role === 'assistant'; });
        if (!hadA || results[k]) return;
        // 刚完成
        var lastA = '';
        for (var i = chat.history.length - 1; i >= 0; i--) {
          if (chat.history[i].role === 'assistant') { lastA = chat.history[i].content; break; }
        }
        results[k] = lastA;
        // 下游（并联分叉：每条出边都注入 → 目标节点满足条件即触发）
        edges.filter(function (e) { return e.from === k; }).forEach(function (e) {
          indeg[e.to] = (indeg[e.to] || 0) + 1;
          if (indeg[e.to] >= (totalIn[e.to] || 1) && !fired[e.to] && !firing[e.to]) {
            fireNode(e.to);
          }
        });
      });
      // 全部完成 → 熄灭连线
      var allDone = Object.keys(layer._fgNodes).every(function (k) { return results[k]; });
      if (allDone) {
        edges.forEach(function (e) { markEdge(layerNow, e.from, e.to, false); });
        clearInterval(timer);
        if (App.toast) App.toast('✅ 流程图接力完成：全部 ' + Object.keys(layer._fgNodes).length + ' 个节点已执行');
      }
    }, 1000);

    return {
      success: true,
      message: '🚀 接力已启动：源节点 ' + starts.map(function (k) { return getNodeLabel(layer, k); }).join('、') +
        '。串联自动顺序执行，分叉自动并联同时发送。'
    };
  };

  // ---------- 持久化 ----------
  function save() {
    if (!window.DB || !DB.kvSet) return;
    try {
      var out = {};
      Object.keys(_bind).forEach(function (layerId) {
        out[layerId] = { chats: _bind[layerId].chats, prompts: _bind[layerId].prompts || {} };
      });
      DB.kvSet(KV_KEY, JSON.stringify(out));
    } catch (e) {}
  }

  FGS.restore = function () {
    if (!window.DB || !DB.kvGet) return Promise.resolve(false);
    return DB.kvGet(KV_KEY).then(function (val) {
      if (!val) return false;
      try {
        var obj = typeof val === 'string' ? JSON.parse(val) : val;
        Object.keys(obj).forEach(function (layerId) {
          _bind[layerId] = {
            chats: obj[layerId].chats || {},
            prompts: obj[layerId].prompts || {}
          };
        });
        return true;
      } catch (e) { return false; }
    }).catch(function () { return false; });
  };

  FGS.setPrompt = function (layerId, nodeKey, prompt) {
    var b = _bind[layerId] || ensureBind({ id: layerId });
    b.prompts[nodeKey] = prompt;
    save();
    return { success: true, message: '已设置节点 [' + nodeKey + '] 的提示词' };
  };

  // 供外部模块（如 CAOps 右键菜单）打开节点会话
  FGS.openSession = function (layerId, nodeKey) {
    var layer = (window.FlowGlam && FlowGlam._layers || []).filter(function (l) { return l.id === layerId; })[0];
    if (!layer || !layer._fgNodes || !layer._fgNodes[nodeKey]) return { success: false, message: '未找到图层或节点' };
    openNodeSession(layer, nodeKey);
    return { success: true, message: '已打开节点 ' + nodeKey + ' 的会话' };
  };

  FGS.list = function () {
    return Object.keys(_bind).map(function (layerId) {
      var b = _bind[layerId];
      return {
        layerId: layerId,
        sessions: Object.keys(b.chats).map(function (k) {
          var chat = chatById(b.chats[k]);
          return { node: k, chatId: b.chats[k], status: chat ? (chat.isSending ? 'running' : 'idle') : 'closed' };
        })
      };
    });
  };

  // ---------- 给每个节点接上点击/双击事件（MutationObserver 自动挂载） ----------
  function wireNode(layer, nodeKey, info) {
    if (info._fgsWired) return;
    info._fgsWired = true;
    var el = info.el;
    var down = null;

    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      down = { x: ev.clientX, y: ev.clientY };
    });

    el.addEventListener('pointerup', function (ev) {
      if (!down) return;
      var moved = Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y);
      down = null;
      if (moved > 5) return; // 是拖拽不是点击
      if (Date.now() - (el._fgsLastTap || 0) < 320) return; // 双击的第二击交给 dblclick
      el._fgsLastTap = Date.now();
      setTimeout(function () {
        if (Date.now() - el._fgsLastTap >= 300) {
          openNodeSession(layer, nodeKey); // 单击
        }
      }, 320);
    });

    el.addEventListener('dblclick', function (ev) {
      ev.stopPropagation();
      var r = FGS.run(layer.id, nodeKey);
      if (r && App.toast) App.toast(r.message);
    });
  }

  // 轮询发现新节点（deploy 动态创建）
  setInterval(function () {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    layers.forEach(function (layer) {
      if (!layer._fgNodes) return;
      if (!layer._fgParsedEdges) {
        // 渲染引擎 deploy 时已把解析结果存在 layer._fgParsed（{nodes, edges}），直接取用
        layer._fgParsedEdges = (layer._fgParsed && layer._fgParsed.edges) ? layer._fgParsed.edges.slice() : [];
      }
      if (!layer._fgEdgeRefs) layer._fgEdgeRefs = [];
      Object.keys(layer._fgNodes).forEach(function (k) {
        wireNode(layer, k, layer._fgNodes[k]);
      });
    });
  }, 800);

  // ---------- 启动 ----------
  setTimeout(function () {
    FGS.restore();
    injectStyles();

  }, 1500);
})();
