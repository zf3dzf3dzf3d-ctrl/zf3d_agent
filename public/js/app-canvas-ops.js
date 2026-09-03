/* ============================================================
 * app-canvas-ops.js - 画布精细操作 + 双探索模式 + 沙箱/正式双环境
 * 依赖：app-canvas-agent.js（CA.__api）、app-flowglam.js、app-flowglam-sessions.js
 *
 * 【步骤5】双探索模式：
 *   - 正向探索：固定起点，AI run 过程中 create_node(after) 向后生长
 *   - 反向探索：固定终点，AI 倒推前置依赖 create_node(before)
 *   - 模式面板：正向/反向切换，为 AI 注入探索策略提示词
 *
 * 【步骤6】节点级精细操作：
 *   - 节点右键菜单：重试/重跑、软删除、固化/解锁、撤销
 *   - 节点级撤销栈（最多 40 步），撤销不污染其他节点
 *
 * 【步骤7】沙箱 + 正式双环境隔离：
 *   - 画布快照分 sandbox / 正式 两套
 *   - 沙箱内一切操作不落正式基线（CA 状态/ToolStore 分池）
 *   - 手动【应用到正式】才合并差异，应用前自动存正式快照
 *   - 支持版本对比 + 丢弃沙箱
 * 暴露 window.CAOps
 * ============================================================ */
(function () {
  'use strict';

  var CA = window.CanvasAgent || {};
  var api = CA.__api || null;
  if (!api) { console.warn('[CAOps] CanvasAgent 未加载，延迟重试'); return setTimeout(arguments.callee, 300); }

  var FGS = window.FGS || {};
  var KV_SNAP = 'canvas_ops_snapshots';
  var KV_MODE = 'canvas_ops_mode';
  var KV_UNDO = 'canvas_ops_undo';

  var _undoStack = [];   // [{layerId, nodeKey, before:{...meta}}]
  var _mode = 'forward'; // forward | backward
  var _env = 'prod';     // prod | sandbox

  // ---------- 快照数据 ----------
  // snap = { ts, env, state: CA._state 快照, toolstore: [...], mermaid: {...layerId: text} }
  function takeSnapshot(env) {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    var mermaid = {};
    layers.forEach(function (l) { if (l._fgMermaid) mermaid[l.id] = l._fgMermaid; });
    return {
      ts: Date.now(), env: env,
      state: JSON.parse(JSON.stringify(api.getState())),
      toolstore: JSON.parse(JSON.stringify(api.getToolStore())),
      ctxnotes: JSON.parse(JSON.stringify(api.getCtxNotes())),
      mermaid: mermaid,
      fg_layers: (window.DB && DB.kvGetSync) ? null : undefined
    };
  }

  function loadKV(key, def) {
    if (!window.DB || !DB.kvGet) return Promise.resolve(def);
    return DB.kvGet(key).then(function (v) {
      if (!v) return def;
      try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return def; }
    }).catch(function () { return def; });
  }
  function saveKV(key, val) {
    try { if (window.DB && DB.kvSet) DB.kvSet(key, JSON.stringify(val)); } catch (e) {}
  }

  // ================= 步骤5：双探索模式 =================
  var EXPLORER_PROMPTS = {
    forward: '【探索模式：正向生长】当前画布处于正向探索模式：你持有一个固定的起点节点（源），任务是从起点出发向前推进。' +
      '需要拆解时用 create_node(direction=after) 向下游生长新节点并写清其职责 prompt；' +
      '结构（串行/并联/分支数量）由你根据工程判断自主决定；生成的下游节点用 run_node 依序/并行推进到完成。' +
      '注意：终点不确定，随探索自然收敛。',
    backward: '【探索模式：反向倒推】当前画布处于反向探索模式：你持有一个固定的终点节点（目标）。' +
      '不要直接回答目标，先用 create_node(direction=before) 倒推"达成该目标需要先完成什么"，一层层向上游补齐前置节点；' +
      '每补齐一层用 read_global_context 检查全图完整性；最上游节点补齐后，从源节点 run_node 正向执行整条链，验证能否自然到达目标。' +
      '若链路走不通，回到中间节点 delete_node 重建。'
  };

  function currentLayer() {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    // 取最近激活的图层（最后一个带节点的）
    for (var i = layers.length - 1; i >= 0; i--) { if (layers[i]._fgNodes) return layers[i]; }
    return layers[0] || null;
  }

  // 探索模式面板（画布左下角悬浮）
  function buildExplorePanel() {
    if (document.getElementById('cao-explore-panel')) return;
    var host = document.getElementById('canvasContent');
    if (!host) return;
    var p = document.createElement('div');
    p.id = 'cao-explore-panel';
    p.innerHTML =
      '<div class="cao-exp-title">🧭 探索模式</div>' +
      '<button class="cao-btn" data-mode="forward">➡️ 正向（起点固定）</button>' +
      '<button class="cao-btn" data-mode="backward">⬅️ 反向（终点倒推）</button>' +
      '<div class="cao-env-row">' +
      '  <span id="cao-env-label">环境：<b>正式</b></span>' +
      '  <button class="cao-btn cao-btn-sm" id="cao-env-toggle">进入沙箱</button>' +
      '</div>' +
      '<div class="cao-env-row">' +
      '  <button class="cao-btn cao-btn-sm" id="cao-apply">📤 应用到正式</button>' +
      '  <button class="cao-btn cao-btn-sm" id="cao-discard">🗑 丢弃沙箱</button>' +
      '</div>';
    host.appendChild(p);
    var chip=document.getElementById('cao-exp-chip');
    if(!chip){chip=document.createElement('div');chip.id='cao-exp-chip';chip.textContent='🧭';chip.title='探索模式 / 沙箱工具（点击展开/收起）';chip.addEventListener('click',function(){p.style.display=(p.style.display==='none'||!p.style.display)?'flex':'none';});host.appendChild(chip);}

    p.querySelectorAll('[data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.getAttribute('data-mode')); });
    });
    document.getElementById('cao-env-toggle').addEventListener('click', toggleEnv);
    document.getElementById('cao-apply').addEventListener('click', applySandbox);
    document.getElementById('cao-discard').addEventListener('click', discardSandbox);
    paintPanel();
  }

  function paintPanel() {
    var p = document.getElementById('cao-explore-panel');
    if (!p) return;
    p.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('cao-on', b.getAttribute('data-mode') === _mode);
    });
    var lb = document.getElementById('cao-env-label');
    var tg = document.getElementById('cao-env-toggle');
    var ap = document.getElementById('cao-apply');
    var ds = document.getElementById('cao-discard');
    // 【防闪烁】内容没变就不重写 DOM：避免 1.5s 轮询重绘导致的视觉跳动（F12 开面板时尤其明显）
    var wantLabel = '环境：<b>' + (_env === 'sandbox' ? '🧪 沙箱' : '正式') + '</b>';
    var wantToggle = _env === 'sandbox' ? '返回正式' : '进入沙箱';
    if (lb && lb.innerHTML !== wantLabel) lb.innerHTML = wantLabel;
    if (tg && tg.textContent !== wantToggle) tg.textContent = wantToggle;
    if (ap) ap.disabled = (_env !== 'sandbox');
    if (ds) ds.disabled = (_env !== 'sandbox');
  }

  function setMode(m) {
    _mode = m;
    saveKV(KV_MODE, { mode: _mode });
    paintPanel();
    if (window.App && App.toast) App.toast(m === 'forward' ? '已切到正向探索：起点固定，AI 向后生长' : '已切到反向探索：终点固定，AI 向上倒推');
  }

  // 探索模式提示词注入（在 CA 元数据之后追加策略段）
  var _origSendRef = null;
  function hookExploreSend() {
    if (_origSendRef || !window.App || !App.sendToModel) return;
    _origSendRef = App.sendToModel;
    App.sendToModel = function (el, chat) {
      try {
        if (chat && chat._fgLayerId && chat._fgNodeKey) {
          var input = el.querySelector('textarea');
          if (input && input.value && input.value.indexOf('【探索模式') < 0) {
            // 在 CA 元数据块之后追加探索策略
            input.value = input.value + '\n' + EXPLORER_PROMPTS[_mode];
          }
        }
      } catch (e) {}
      return _origSendRef.apply(this, arguments);
    };
  }

  // ================= 步骤6：节点级精细操作 =================
  function pushUndo(layerId, nodeKey) {
    var m = api.ensureMeta(layerId, nodeKey);
    _undoStack.push({ layerId: layerId, nodeKey: nodeKey, before: JSON.parse(JSON.stringify(m)), ts: Date.now() });
    if (_undoStack.length > 40) _undoStack.shift();
    saveKV(KV_UNDO, _undoStack);
  }

  CA.opsUndo = function (layerId, nodeKey) {
    // 找最近一条该节点的撤销记录
    for (var i = _undoStack.length - 1; i >= 0; i--) {
      var u = _undoStack[i];
      if (u.nodeKey === nodeKey && (!layerId || u.layerId === layerId)) {
        var st = api.getState();
        if (!st[u.layerId]) st[u.layerId] = {};
        st[u.layerId][u.nodeKey] = u.before;
        api.saveState();
        var layer = api.findLayer(u.layerId);
        if (layer) { try { refreshBadgeSafe(layer, u.nodeKey); } catch (e) {} }
        _undoStack.splice(i, 1);
        saveKV(KV_UNDO, _undoStack);
        return { success: true, message: '节点 ' + u.nodeKey + ' 已撤销到之前状态（' + (u.before.status || '?') + '）' };
      }
    }
    return { success: false, message: '该节点没有可撤销的操作' };
  };

  function refreshBadgeSafe(layer, key) {
    // CA 内部函数，借用 2 秒轮询刷新即可，这里直接触发状态类
    var m = api.ensureMeta(layer.id, key);
    var el = layer._fgNodes && layer._fgNodes[key] && layer._fgNodes[key].el;
    if (el) {
      el.classList.toggle('ca-fixed', !!m.is_fixed);
      el.classList.toggle('ca-deleted-node', m.status === 'deleted');
    }
  }

  // 右键菜单
  function buildCtxMenu() {
    if (document.getElementById('cao-ctxmenu')) return;
    var menu = document.createElement('div');
    menu.id = 'cao-ctxmenu';
    document.body.appendChild(menu);
    document.addEventListener('click', function () { menu.style.display = 'none'; });

    menu.addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (!act) return;
      var d = menu._ctx; if (!d) return;
      ev.stopPropagation();
      menu.style.display = 'none';
      doNodeAction(act, d.layer, d.key);
    });
  }

  function doNodeAction(act, layer, key) {
    var layerId = layer.id, r;
    switch (act) {
      case 'undo': r = CA.opsUndo(layerId, key); break;
      case 'retry': {
        pushUndo(layerId, key);
        var m = api.ensureMeta(layerId, key);
        if (m.is_fixed) { r = { success: false, message: '已固化节点，请先解锁' }; break; }
        m.status = 'idle'; api.saveState();
        r = runNodeSafe(layer, key);
        break;
      }
      case 'del': {
        pushUndo(layerId, key);
        r = CA.deleteNode(layerId, key, '手动右键删除');
        break;
      }
      case 'fix': {
        pushUndo(layerId, key);
        var mm = api.ensureMeta(layerId, key);
        r = CA.setFixed(layerId, key, !mm.is_fixed, mm.is_fixed ? '右键解锁' : '右键固化');
        break;
      }
      case 'open': openSessionSafe(layer, key); return;
      case 'run': r = runNodeSafe(layer, key); break;
    }
    if (r && window.App && App.toast) App.toast(r.message || JSON.stringify(r));
  }

  function runNodeSafe(layer, key) {
    try {
      if (window.FGS && FGS.run) {
        var rr = FGS.run(layer.id, key);
        return rr || { success: true, message: '已启动 ' + key };
      }
      return { success: false, message: 'FGS 未加载' };
    } catch (e) { return { success: false, message: '执行失败: ' + e.message }; }
  }
  function openSessionSafe(layer, key) {
    try {
      if (window.FGS && FGS.openSession) {
        var r = FGS.openSession(layer.id, key);
        if (r && r.success) { toast(r.message); return; }
      }
      var ev = new CustomEvent('cao-open-node', { detail: { layerId: layer.id, nodeKey: key } });
      document.dispatchEvent(ev);
    } catch (e) {}
  }

  // 节点右键挂接（轮询发现新节点统一处理）
  function wireCtxMenus() {
    var layers = (window.FlowGlam && FlowGlam._layers) || [];
    layers.forEach(function (layer) {
      if (!layer._fgNodes || layer._caoCtxWired) return;
      layer._caoCtxWired = true;
      Object.keys(layer._fgNodes).forEach(function (k) { wireOne(layer, k); });
    });
  }
  function wireOne(layer, key) {
    var info = layer._fgNodes[key];
    if (!info || !info.el || info.el._caoWired) return;
    info.el._caoWired = true;
    info.el.addEventListener('contextmenu', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var menu = document.getElementById('cao-ctxmenu');
      if (!menu) return;
      var m = api.ensureMeta(layer.id, key);
      menu._ctx = { layer: layer, key: key };
      menu.innerHTML =
        '<div class="cao-menu-title">' + key + ' · ' + (m.status) + (m.is_fixed ? ' 📌' : '') + '</div>' +
        '<div data-act="open">💬 打开会话</div>' +
        '<div data-act="run">▶️ 运行/接力</div>' +
        '<div data-act="retry">🔁 重试（回退到 idle 再跑）</div>' +
        '<div data-act="undo">↩️ 撤销本节点</div>' +
        '<div data-act="fix">' + (m.is_fixed ? '🔓 解锁固化' : '📌 固化定稿') + '</div>' +
        '<div data-act="del" class="cao-danger">🗑 软删除</div>';
      menu.style.display = 'block';
      menu.style.left = Math.min(ev.clientX, window.innerWidth - 170) + 'px';
      menu.style.top = Math.min(ev.clientY, window.innerHeight - 200) + 'px';
    });
  }

  // ================= 步骤7：沙箱 / 正式双环境 =================
  var _prodSnapshot = null; // 进入沙箱时抓的正式基线
  var _sandboxSnapshots = []; // 应用前的正式版本历史（版本对比）

  function toggleEnv() {
    if (_env === 'prod') enterSandbox(); else backToProd();
  }

  function enterSandbox() {
    if (_env === 'sandbox') return;
    _prodSnapshot = takeSnapshot('prod');
    _env = 'sandbox';
    saveKV(KV_SNAP, { prod: _prodSnapshot, history: _sandboxSnapshots.slice(-5) });
    _sandboxSnapshots.push(JSON.parse(JSON.stringify(_prodSnapshot)));
    saveKV(KV_SNAP, { prod: _prodSnapshot, history: _sandboxSnapshots.slice(-5) });
    paintPanel();
    markSandboxUI(true);
    if (window.App && App.toast) App.toast('🧪 已进入沙箱：此处一切修改不影响正式基线');
  }

  function backToProd() {
    if (_env !== 'sandbox') return;
    // 回正式 = 丢弃沙箱（回到进入时基线）
    discardSandbox(true);
  }

  function restoreSnapshot(snap) {
    if (!snap) return;
    api.setState(snap.state || {});
    api.setToolStore(snap.toolstore || []);
    if (snap.ctxnotes) {
      var cn = api.getCtxNotes();
      Object.keys(snap.ctxnotes).forEach(function (k) { cn[k] = snap.ctxnotes[k]; });
    }
  }

  function applySandbox() {
    if (_env !== 'sandbox') { toast('当前已在正式环境'); return; }
    if (!confirm('确认把沙箱的全部修改应用到正式基线？应用前会自动保存一份正式快照（可版本对比）。')) return;
    // 把当前（沙箱内改好的）状态先存入历史
    _sandboxSnapshots.push(takeSnapshot('sandbox'));
    var merged = takeSnapshot('prod'); // 当前沙箱内容即为新正式
    merged.env = 'prod';
    _prodSnapshot = merged;
    _env = 'prod';
    saveKV(KV_SNAP, { prod: _prodSnapshot, history: _sandboxSnapshots.slice(-5) });
    paintPanel(); markSandboxUI(false);
    toast('✅ 沙箱已应用到正式（历史版本 +1，可对比/回滚）');
  }

  function discardSandbox(silent) {
    if (_env !== 'sandbox' && !silent) { toast('不在沙箱中'); return; }
    if (!silent && !confirm('丢弃沙箱中的全部修改，回到正式基线？')) return;
    if (_prodSnapshot) restoreSnapshot(_prodSnapshot);
    _env = 'prod';
    saveKV(KV_SNAP, { prod: _prodSnapshot, history: _sandboxSnapshots.slice(-5) });
    paintPanel(); markSandboxUI(false);
    if (!silent) toast('已丢弃沙箱修改，回到正式基线');
  }

  // 版本对比（简单弹窗：最近两份快照差异）
  function compareVersions() {
    var h = _sandboxSnapshots;
    if (h.length < 2) { toast('版本历史不足（需至少 2 次）'); return; }
    var a = h[h.length - 2], b = h[h.length - 1];
    function countNodes(s) {
      var n = 0; var st = s.state || {};
      Object.keys(st).forEach(function (lid) { n += Object.keys(st[lid]).length; });
      return n;
    }
    var lines = [
      '版本对比（近两份快照）',
      '—— 旧版 ' + new Date(a.ts).toLocaleTimeString() + '：节点数 ' + countNodes(a) + '，工具记录 ' + (a.toolstore || []).length,
      '—— 新版 ' + new Date(b.ts).toLocaleTimeString() + '：节点数 ' + countNodes(b) + '，工具记录 ' + (b.toolstore || []).length
    ];
    alert(lines.join('\n'));
  }

  function markSandboxUI(on) {
    var host = document.getElementById('canvasContent');
    if (host) host.classList.toggle('cao-sandbox', on);
  }

  function toast(msg) { if (window.App && App.toast) App.toast(msg); else console.log('[CAOps]', msg); }

  // 沙箱视觉边框
  function injectSandboxStyle() {
    if (document.getElementById('cao-styles')) return;
    var st = document.createElement('style');
    st.id = 'cao-styles';
    st.textContent = `
#cao-explore-panel{position:fixed;left:14px;bottom:130px;z-index:9000;display:none;flex-direction:column;gap:6px;}
#cao-exp-chip{position:fixed;left:14px;bottom:86px;z-index:9000;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(12,16,32,.92);border:1px solid rgba(120,160,255,.3);font-size:17px;box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(8px);user-select:none}
  background:rgba(12,16,32,.92);border:1px solid rgba(120,160,255,.3);border-radius:12px;padding:10px;min-width:172px;
  box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(8px)}
.cao-exp-title{font-size:11px;color:#8fb4e8;letter-spacing:2px;margin-bottom:2px}
.cao-btn{cursor:pointer;border:1px solid rgba(120,160,255,.35);background:rgba(30,40,80,.6);color:#cfe3ff;
  border-radius:8px;padding:5px 8px;font-size:12px;text-align:left;transition:.15s}
.cao-btn:hover{background:rgba(60,90,180,.5);border-color:#6fa8ff}
.cao-btn.cao-on{background:linear-gradient(90deg,#1565c0,#00acc1);border-color:#4fc3f7;color:#fff}
.cao-btn-sm{font-size:11px;padding:4px 6px}
.cao-btn:disabled{opacity:.35;cursor:not-allowed}
.cao-env-row{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;color:#9fb8dd}
.cao-env-row .cao-btn{flex:none}
#canvasContent.cao-sandbox::after{content:'🧪 沙箱环境（修改不影响正式）';position:fixed;top:8px;left:50%;transform:translateX(-50%);
  z-index:9999;background:rgba(255,145,0,.92);color:#1a1200;font-size:12px;padding:4px 16px;border-radius:14px;font-weight:bold;
  box-shadow:0 4px 18px rgba(255,145,0,.4);pointer-events:none}
#cao-ctxmenu{display:none;position:fixed;z-index:10001;background:rgba(14,18,36,.96);border:1px solid rgba(120,160,255,.35);
  border-radius:10px;padding:6px;min-width:158px;box-shadow:0 10px 34px rgba(0,0,0,.6)}
#cao-ctxmenu>div{padding:6px 10px;font-size:12px;color:#cfe3ff;border-radius:6px;cursor:pointer}
#cao-ctxmenu>div:hover{background:rgba(70,110,220,.45)}
#cao-ctxmenu .cao-danger{color:#ff8a80}
#cao-ctxmenu .cao-menu-title{font-size:10px;color:#8fb4e8;border-bottom:1px solid rgba(120,160,255,.2);
  margin-bottom:4px;padding-bottom:4px;cursor:default}
`;
    document.head.appendChild(st);
  }

  // 恢复
  function restoreAll() {
    loadKV(KV_MODE, { mode: 'forward' }).then(function (m) {
      _mode = m.mode === 'backward' ? 'backward' : 'forward';
      paintPanel();
    });
    loadKV(KV_SNAP, null).then(function (s) {
      if (s && s.prod) { _prodSnapshot = s.prod; _sandboxSnapshots = s.history || []; }
    });
    loadKV(KV_UNDO, []).then(function (u) { _undoStack = Array.isArray(u) ? u : []; });
  }

  // FGS.run 状态回写钩子：run 完成由 CA 轮询负责，此处仅补 failed 检测
  // （节点会话报错 → isSending false 且无 assistant → failed，由 CA 已有逻辑扩展）

  // 启动
  var boot = function () {
    if (!document.getElementById('canvasContent')) return setTimeout(boot, 600);
    injectSandboxStyle();
    buildExplorePanel();
    buildCtxMenu();
    hookExploreSend();
    restoreAll();
    // 轻量版：上下文菜单挂接用事件委托代替 1.5s 轮询；面板仅 8s 低频刷新且页面隐藏时跳过
    var _caoCtx = function (e) {
      var n = e.target;
      while (n && n !== document) {
        if (n.classList && (n.classList.contains('fg-node') || n.classList.contains('kite-node'))) { wireCtxMenus(); paintPanel(); break; }
        n = n.parentNode;
      }
    };
    document.addEventListener('mousedown', _caoCtx, true);
    setInterval(function () { if (!document.hidden) { wireCtxMenus(); paintPanel(); } }, 8000);
    // 双击对比快捷：Shift+点击面板标题 → 版本对比
    var t = document.querySelector('.cao-exp-title');
    if (t) t.addEventListener('dblclick', compareVersions);

  };
  setTimeout(boot, 1800);
})();
