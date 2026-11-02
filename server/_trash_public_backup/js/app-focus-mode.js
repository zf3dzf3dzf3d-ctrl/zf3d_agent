// ========== app-focus-mode.js - Codex 式专注模式（左项目/会话标签 + 右对话 + 工作台抽屉） ==========
(function () {
  'use strict';
  const LS_KEY = 'zf-focus-mode-on';
  let hostBoxId = null; // 当前被移入舞台的会话 box id
  const prevSnap = new Map(); // boxId -> {parent, next, style}（DOM 引用不能走 JSON，否则 nextSibling 丢失）

  function $ (sel) { return document.querySelector(sel); }
  function $$ (sel) { return Array.from(document.querySelectorAll(sel)); }
  function App () { return window.App || {}; }


  // ---------- UI 构建 ----------
  function build () {
    if ($('#zfFocusRoot')) return;
    const root = document.createElement('div');
    root.id = 'zfFocusRoot';
    root.innerHTML = `
      <aside class="zf-side" id="zfSide">
        <div class="zf-sess-list" id="zfSessList"></div>
      </aside>
      <div class="zf-split" id="zfSplit" title="拖拽调整左栏宽度"></div>
      <div class="zf-main">
        <div class="zf-top">
          <span class="zf-crumb" id="zfCrumb">专注模式</span>
          <button class="zf-btn zf-icon-btn" id="zfBtnNewTop" title="新建对话"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnSide" title="显示/隐藏会话列表"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnWb" title="显示/隐藏工作台"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M10 3v10"/></svg></button>
          <button class="zf-btn zf-icon-btn zf-ic-exit" id="zfBtnExit" title="退出专注模式 (ESC)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5v2a1.5 1.5 0 0 1-1.5 1.5h-2M10 2.5v2a1.5 1.5 0 0 0 1.5 1.5h2M6 13.5v-2a1.5 1.5 0 0 0-1.5-1.5h-2M10 13.5v-2a1.5 1.5 0 0 1 1.5-1.5h2"/></svg></button>
        </div>
        <div class="zf-stage" id="zfStage">
          <div class="zf-wb-handle" id="zfWbHandle" title="展开工作台"></div>
          <div class="zf-empty" id="zfEmpty">暂无会话 —— 点击左栏「＋」新建</div>
        </div>
      </div>
      <div class="zf-split2" id="zfSplit2" title="拖拽调整工作台宽度（双击恢复默认）"></div>
      <div class="zf-wb-dock" id="zfWbDock"></div>`;
    document.body.appendChild(root);

    $('#zfBtnExit').onclick = () => setMode(false);
    $('#zfBtnSide').onclick = () => $('#zfFocusRoot').classList.toggle('side-collapsed');
    $('#zfBtnWb').onclick = toggleWorkbench;
    // 2026-10-18：暴露给对话底部工作台按钮，专注模式内与其共用同一开合逻辑
    window.__focusModeToggleWb = toggleWorkbench;
    initSplitter();
    initSplitter2();
    $('#zfWbHandle').onclick = toggleWorkbench;
    // 2026-10-14：统一新建会话入口。创建后立即把新会话搬进舞台并刷新列表，
    // 解决「新建对话不会直接出现在列表中」的问题。左栏「＋」和顶部「＋新建对话」共用。
    const doNewSession = () => {
      // 注意：openNewSessionModal / showProjectSwitcher 定义在全局 App 对象上，不在 window 上
      const A = window.App || (typeof App !== 'undefined' ? App : null) || {};
      // 2026-10-15：新建对话坐标 = 画布上最新（最右）会话右侧 + 一个间隙（30px），
      // 用画布逻辑坐标（trustedSpawn=true）直调 createChatBox，避免落入屏幕中央。
      let cx = null, cy = null;
      try {
        const boxes = A.chatBoxes || [];
        let last = null, lastLeft = -Infinity;
        boxes.forEach(b => {
          if (b && b.el && b.el.isConnected) {
            const L = parseFloat(b.el.style.left) || 0;
            if (L > lastLeft) { lastLeft = L; last = b; }
          }
        });
        if (!last && boxes.length) {
          last = boxes[boxes.length - 1];
          // 2026-10-15：兜底分支必须同步更新 lastLeft，否则 L65 会算出 -Infinity 飞出画布
          lastLeft = parseFloat(last.el && last.el.style.left) || 0;
        }
        if (last && last.el) {
          const GAP = 30;
          cx = lastLeft + (last.el.offsetWidth || 380) + GAP;
          cy = parseFloat(last.el.style.top) || 0;
        }
      } catch (e) {}
      let created = null;
      if (Number.isFinite(cx) && typeof A.createChatBox === 'function') {
        created = A.createChatBox(cx, cy, null, true);
      }
      if (!created && typeof A.openNewSessionModal === 'function') created = A.openNewSessionModal();
      else if (typeof window.openNewSessionModal === 'function') created = window.openNewSessionModal();
      else if (typeof A.showProjectSwitcher === 'function') A.showProjectSwitcher();
      else if (typeof window.showProjectSwitcher === 'function') window.showProjectSwitcher();
      // openNewSessionModal 返回新建的 chatbox（{id,...}）；host 进舞台 + 刷新列表
      if (created && created.id) {
        try { hostBox(created.id); } catch (e) {}
        try { refreshSess(); } catch (e) {}
      }
    };
    // 左栏「＋」按钮已移除，仅保留顶部工具栏入口
    $('#zfBtnNewTop').onclick = doNewSession;
    // 快捷键
    document.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('zf-focus') && e.key === 'Escape') setMode(false);
      if (e.key === 'F11') { e.preventDefault(); setMode(!isOn()); }
    });
    // 会话变化时刷新标签
    setInterval(refreshSess, 1500);
  }

  function isOn () { return document.body.classList.contains('zf-focus'); }

  // ---------- 左栏宽度拖拽 ----------
  function initSplitter () {
    const root = $('#zfFocusRoot'), bar = $('#zfSplit');
    if (!root || !bar || bar.dataset.bound) return;
    bar.dataset.bound = '1';
    const saved = localStorage.getItem('zf-focus-side-w');
    if (saved) root.style.setProperty('--zf-side-w', saved + 'px');
    let startX = 0, startW = 0, dragging = false;
    // 2026-10-11：改用 Pointer Events，峰控触屏（遥控模式）也能拖拽调宽
    bar.addEventListener('pointerdown', (e) => {
      if (root.classList.contains('side-collapsed')) return;
      dragging = true; startX = e.clientX;
      // 2026-10-15 审核#2：宽度合法 0 时 parseInt=0 会命中 || 兜底导致拖拽起点跳回 260，改用 NaN 判定区分缺失与合法 0
      const _csSide = parseInt(getComputedStyle(root).getPropertyValue('--zf-side-w'));
      startW = Number.isNaN(_csSide) ? 260 : _csSide;
      bar.classList.add('dragging');
      bar.setPointerCapture && bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
      // 2026-10-17：去掉 560px 上限，允许拖到接近全屏（只留最小对话区与窗口边界）
      const maxW = Math.max(160, window.innerWidth - 320);
      // 2026-10-18 侧栏回到最左：向右拖 = 变宽
      const w = clamp(startW + (e.clientX - startX), 0, maxW);
      root.style.setProperty('--zf-side-w', w + 'px');
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false; bar.classList.remove('dragging');
      const w = root.style.getPropertyValue('--zf-side-w');
      if (w) localStorage.setItem('zf-focus-side-w', parseInt(w));
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
  }

  // ---------- 工作台坞宽度拖拽（缝2，Pointer Events 一套通吃鼠标+触屏/峰控） ----------
  const WB_W_KEY = 'zf-focus-wb-w';
  function initSplitter2 () {
    const root = $('#zfFocusRoot'), bar = $('#zfSplit2');
    if (!root || !bar || bar.dataset.bound) return;
    bar.dataset.bound = '1';
    // 触屏（峰控遥控器）宽度按 vw 记忆，避免 px 在小屏溢出；恢复时统一转 px
    const applySavedWbW = () => {
      const saved = localStorage.getItem(WB_W_KEY);
      if (!saved) return false;
      const w = saved.endsWith('vw') ? Math.round(parseFloat(saved) / 100 * window.innerWidth) : parseInt(saved);
      if (w >= 0) root.style.setProperty('--zf-wb-w', w + 'px');
      return true;
    };
    applySavedWbW();
    // 2026-10-11 审核建议：触屏按 vw 记忆，屏幕旋转/窗口缩放后按当前 innerWidth 重新换算，消除视觉偏差
    let rszT = 0;
    window.addEventListener('resize', () => {
      if (root.classList.contains('wb-docked') && (localStorage.getItem(WB_W_KEY) || '').endsWith('vw')) {
        clearTimeout(rszT); rszT = setTimeout(applySavedWbW, 150);
      }
    });
    let startX = 0, startW = 0, dragging = false;
    bar.addEventListener('pointerdown', (e) => {
      if (!root.classList.contains('wb-docked')) return;
      dragging = true; startX = e.clientX;
      // 2026-10-15 审核#2：同上，合法 0 宽不应被 || 兜底重置为 380
      const _csWb = parseInt(getComputedStyle(root).getPropertyValue('--zf-wb-w'));
      startW = Number.isNaN(_csWb) ? 380 : _csWb;
      bar.classList.add('dragging');
      bar.setPointerCapture && bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
      // 向左拖 = 坞变宽（缝2 在坞左侧）
      // 2026-10-17：去掉 0.6 上限，工作台坞可拖到接近全屏（只留最小对话区 320px）
      const maxW = Math.max(220, window.innerWidth - 420);
      // 2026-10-18 坞回到最右：向左拖 = 坞变宽（缝2 在坞左侧）
      const w = clamp(startW + (startX - e.clientX), 0, maxW);
      root.style.setProperty('--zf-wb-w', w + 'px');
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; bar.classList.remove('dragging');
      const w = parseInt(root.style.getPropertyValue('--zf-wb-w'));
      if (w >= 0) {
        // 触屏按 vw 记忆，鼠标按 px 记忆
        const key = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
          ? Math.round(w / window.innerWidth * 100) + 'vw' : w + 'px';
        try { localStorage.setItem(WB_W_KEY, key); } catch (e) {}
      }
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', () => {
      root.style.removeProperty('--zf-wb-w');
      try { localStorage.removeItem(WB_W_KEY); } catch (e) {}
    });
  }

  // ---------- 工作台进坞 / 出坞（把抽屉 DOM reparent 进 #zfWbDock） ----------
  let wbDrawerSnap = null; // 出坞还原快照 {parent, next, style}
  function dockDrawer () {
    const dock = $('#zfWbDock');
    if (!dock) return false;
    const K = window.__KiteNS || {};
    let dw = document.querySelector('.wb-drawer');
    if (!dw || !dw.isConnected) {
      // 抽屉还没建：通过全局 API NS.workbench.open(box)（box=当前 hosted 会话）开一次让它建出来，再搬
      try {
        const hostEl = $('#zfStage .zf-hosted') || document.querySelector('.chatbox.focused');
        if (K.workbench && typeof K.workbench.open === 'function') K.workbench.open(hostEl || undefined);
      } catch (e) {}
    }
    const d2 = document.querySelector('.wb-drawer');
    if (!d2) return false;
    if (d2.parentElement !== dock) {
      // 出坞还原快照（只记一次，防重复进坞覆盖）
      if (!wbDrawerSnap) wbDrawerSnap = { parent: d2.parentElement, next: d2.nextSibling, style: d2.getAttribute('style') };
      dock.appendChild(d2);
    }
    d2.classList.add('zf-wb-docked');
    $('#zfFocusRoot').classList.add('wb-docked');
    d2.classList.add('open');
    // 2026-10-17 修复bug1：抽屉自身被关闭（open 类被移除）时同步出坞，
    // 否则 #zfFocusRoot 一直保留 wb-docked 列，右侧留下空白坞区不重置
    if (!d2._zfCloseObs) {
      d2._zfCloseObs = new MutationObserver(() => {
        const root2 = $('#zfFocusRoot');
        // 2026-10-17 修复：抽屉关闭只移除 .open，坞内始终带 .zf-wb-docked，
        // 旧条件 !zf-wb-docked 永假导致关坞区域不重置。现只看 .open。
        if (root2 && root2.classList.contains('wb-docked') && !d2.classList.contains('open')) {
          undockDrawer();
        }
      });
      d2._zfCloseObs.observe(d2, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    return true;
  }
  function undockDrawer () {
    const root = $('#zfFocusRoot');
    if (root) root.classList.remove('wb-docked');
    const d = document.querySelector('.wb-drawer.zf-wb-docked') || $('#zfWbDock .wb-drawer');
    if (!d) { wbDrawerSnap = null; return; }
    d.classList.remove('zf-wb-docked');
    const s = wbDrawerSnap;
    if (s && s.parent && s.parent.isConnected) {
      try { s.parent.insertBefore(d, s.next || null); } catch (e) {}
      if (s.style !== null && s.style !== undefined) d.setAttribute('style', s.style); else d.removeAttribute('style');
    } else {
      // 原父节点已销毁（退出专注模式画布重排等）：直接摘除，抽屉下次打开会重建
      d.remove();
    }
    wbDrawerSnap = null;
  }

  // ---------- 进入 / 退出 ----------
  function setMode (on) {
    build();
    if (on === isOn()) return;
    if (on) {
      // 进入专注模式不改变窗口尺寸/最大化状态，保持用户当前窗口原样
      document.body.classList.add('zf-focus');
      window._zfFocusActive = true; // 全局标志：专注模式激活期间禁止画布定位（防新窗坐标被舞台基准污染）
      localStorage.setItem(LS_KEY, '1');
      refreshSess();
      autoHostCurrent();
    } else {
      document.body.classList.remove('zf-focus');
      window._zfFocusActive = false;
      localStorage.removeItem(LS_KEY);
      undockDrawer(); // 兜底出坞：防止退出专注模式后抽屉残留在坞里
      // 2026-10-15：退出专注模式后，摄像机跟踪回到专注焦点（最后 host 的那个）对话，
      // 与进入前的视觉焦点保持一致。注意 unhost 末尾会置 hostBoxId=null，必须先取出来。
      var exitFocusId = hostBoxId;
      unhost();
      setTimeout(function () {
        if (!exitFocusId) return;
        try {
          var boxes = App().chatBoxes || [];
          var b = boxes.find(function (x) { return String(x.id) === String(exitFocusId); });
          if (b && b.el && b.el.isConnected && App._focusChatBox) App._focusChatBox(b.id);
        } catch (e) {}
      }, 120); // 等 unhost DOM 还原/画布重排完成后再聚焦
      verifyNoBlackout(); // 黑屏自检：确保窗口真的回到了画布
    }
  }

  // ---------- 会话标签（复用 App.chatBoxes） ----------
  function firstUserText (b) {
    // 取第一条用户消息的纯文本；跳过内部徽标/图片占位等节点
    try {
      const body = b.el && (b.el.querySelector('.chatbox-body') || b.el.querySelector('.messages'));
      if (!body) return '';
      const msgs = body.querySelectorAll('.message.user, .msg.user, .message-me, .chat-msg.user');
      for (const m of msgs) {
        const mClone = m.cloneNode(true);
        // 剔除徽标、图片、按钮等非文本节点，只留正文
        mClone.querySelectorAll('img,button,.badge,.msg-badge,.file-badge,[class*="badge"]').forEach(n => n.remove());
        const txt = (mClone.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt.slice(0, 30);
      }
    } catch (e) {}
    return '';
  }
  const titleCache = new Map(); // boxId -> {sig, title} 避免每轮轮询重复遍历 DOM
  function boxTitle (b) {
    // 标题优先级：已有 title > DOM header 标题（非默认） > 对话第一句用户消息 > 模型名
    if (b.title) return b.title;
    let header = '';
    try {
      const tEl = b.el && b.el.querySelector('.title');
      const t = tEl && tEl.textContent && tEl.textContent.trim();
      if (t && !/^💬\s*对话/.test(t)) header = t;
    } catch (e) {}
    // 签名中加入首条用户消息文本长度作为廉价信号：
    // 新会话首句话发出时 header/modelId 未变也能触发重算，避免标题停留在 modelId 兜底
    const probe = b.title ? '' : firstUserText(b);
    const sig = header + '|' + probe.length + '|' + (b.modelId || '') + '|' + (b.id || '');
    const c = titleCache.get(b.id);
    if (c && c.sig === sig && c.title) return c.title;
    // 2026-10-14：去掉空会话标题兜底值「峰控」，无标题时直接用模型名/会话id，避免顶部和列表显示"峰控"
    const title = header || probe || b.modelId || ('会话 ' + (b.id || ''));
    titleCache.set(b.id, { sig, title });
    return title;
  }
  // 项目分组展开状态；zfGroupOpen=手动展开，zfGroupClosed=手动收起（可覆盖当前会话组的自动展开）
  const zfGroupOpen = new Set(); const zfGroupClosed = new Set();
  function projNameOf (b) {
    let pid = b.projectId || b.project_id || '';
    try { pid = (b.el && (b.el.dataset.projectId || b.el.dataset.project_id)) || pid; } catch (e) {}
    if (!pid) return '未分组';
    const ps = (window.App && App()._projAllProjects) || window._projAllProjects || [];
    for (const p of ps) { if (p && String(p.id) === String(pid)) return p.name || '未命名项目'; }
    return '项目 ' + pid;
  }
  function refreshSess () {
    if (!isOn()) return;
    const list = $('#zfSessList'); if (!list) return;
    const boxes = App().chatBoxes || [];
    // 按项目分组（保持会话原有顺序）
    const groups = []; const idx = new Map();
    boxes.forEach(b => {
      const g = projNameOf(b);
      if (!idx.has(g)) { idx.set(g, { name: g, items: [] }); groups.push(idx.get(g)); }
      idx.get(g).items.push(b);
    });
    // 当前会话所在组自动展开（未被手动收起覆盖时）
    const cur = boxes.find(b => b.id === hostBoxId);
    if (cur && !zfGroupClosed.has(projNameOf(cur))) zfGroupOpen.add(projNameOf(cur));
    list.innerHTML = '';
    let shown = 0;
    groups.forEach(g => {
      const hasCur = g.items.some(b => b.id === hostBoxId);
      const open = hasCur ? !zfGroupClosed.has(g.name) : zfGroupOpen.has(g.name);
      const head = document.createElement('div');
      head.className = 'zf-proj-item zf-group-head' + (hasCur ? ' active' : '') + (open ? ' open' : '');
      head.innerHTML = `<span class="zf-group-arrow">${open ? '▾' : '▸'}</span><span class="zf-group-name"></span><span class="zf-group-count">${g.items.length}</span>`;
      head.querySelector('.zf-group-name').textContent = g.name;
      head.title = (open ? '点击收起' : '点击展开') + '「' + g.name + '」下的会话';
      head.onclick = () => {
        if (open) { zfGroupOpen.delete(g.name); zfGroupClosed.add(g.name); }
        else { zfGroupOpen.add(g.name); zfGroupClosed.delete(g.name); }
        refreshSess();
      };
      list.appendChild(head);
      shown++;
      if (!open) return;
      g.items.forEach(b => {
        shown++;
        const el = document.createElement('div');
        const sending = b.sending || b.isSending || false;
        el.className = 'zf-sess-item' + (b.id === hostBoxId ? ' active' : '');
        el.innerHTML = `<span class="zf-sess-title"></span>`;
        el.querySelector('.zf-sess-title').textContent = boxTitle(b);
        el.title = boxTitle(b) + '（点击切到此会话）';
        el.onclick = () => hostBox(b.id);
        list.appendChild(el);
      });
    });
    if (!shown) list.innerHTML = '<div class="zf-sess-item" style="opacity:.5">（暂无会话）</div>';
    $('#zfEmpty').style.display = boxes.length ? 'none' : 'flex';
    const crumb = $('#zfCrumb');
    crumb.textContent = (cur ? boxTitle(cur) : '专注模式');
  }

  // ---------- 自动 host 当前活跃会话（按上次活跃 id 或最高 zIndex） ----------
  function autoHostCurrent () {
    const A = App();
    const boxes = A.chatBoxes || [];
    if (!boxes.length) return;
    let target = null;
    try {
      const lastId = (window.UserSettings && UserSettings.get && UserSettings.get('last_active_chat_id')) || null;
      if (lastId) target = boxes.find(b => String(b.id) === String(lastId));
    } catch (e) {}
    if (!target) {
      boxes.forEach(b => {
        if (!target || (b.el && parseInt(b.el.style.zIndex) || 0) > (parseInt(target.el && target.el.style.zIndex) || 0)) target = b;
      });
    }
    if (target) hostBox(target.id);
  }

  // ---------- 把会话 chatbox 元素搬进舞台（保事件绑定，纯 DOM 移动） ----------
  function hostBox (id) {
    const stage = $('#zfStage');
    const boxes = App().chatBoxes || [];
    const b = boxes.find(x => String(x.id) === String(id));
    if (!b) return;
    // 找到画布上的 chatbox DOM：
    // 真实约定：box.className='chatbox'，box.id=会话id 本身（形如 cb12-x3f），无 data-id 属性。
    // 所以优先直接用 chatBoxes 项自带的 .el 引用；再兜底 #id 精确匹配。
    let el = b.el && b.el.isConnected ? b.el : null;
    if (!el) el = document.getElementById(String(id)) ||
                  document.querySelector(`.chatbox[id="${CSS.escape(id)}"]`);
    if (!el) {
      // 兜底：遍历按 id 匹配
      el = $$('.chatbox').find(n => String(n.id) === String(id)) || null;
    }
    if (!el) {
      // 仍找不到：给可见提示而不是静默失败
      const empty = $('#zfEmpty');
      if (empty) { empty.textContent = '⚠ 未能找到该会话的画布元素（会话可能未渲染）—— 退出专注模式后再试'; empty.style.display = 'flex'; }
      return;
    }
    if (hostBoxId !== null && hostBoxId !== String(id)) unhost();
    if (el.dataset.zfHosted !== '1') {
      prevSnap.set(String(id), { parent: el.parentNode, next: el.nextSibling, style: el.getAttribute('style') });
      el.dataset.zfHosted = '1';
      el.classList.add('zf-hosted');
    }
    el.style.cssText += ';position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;max-height:none;z-index:2;';
    stage.appendChild(el);
    hostBoxId = String(id);
    // host 成功后重置空态文案，避免残留上次的警告文字
    const empty = $('#zfEmpty');
    if (empty) empty.textContent = '暂无会话 —— 点击左栏「＋」新建';
    refreshSess();
    setupFollowScroll(el);
  }

  // ---------- 消息区自动滚底 + 回到底部按钮 ----------
  let followObserver = null;
  function setupFollowScroll (box) {
    if (followObserver) { followObserver.disconnect(); followObserver = null; }
    const btn = document.getElementById('zfBtnBottom');
    if (btn) btn.remove();
    const body = box.querySelector('.chatbox-body');
    if (!body) return;
    // 记号守卫：同一 body 反复进出时只挂一次 scroll 监听，防累积
    if (!body.dataset.zfScrollBound) {
      body.dataset.zfScrollBound = '1';
      body._zfStick = true;
      body.addEventListener('scroll', () => {
        body._zfStick = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
        const b2 = document.getElementById('zfBtnBottom');
        if (b2) b2.style.display = body._zfStick ? 'none' : 'flex';
      });
    }
    let stick = body._zfStick !== undefined ? body._zfStick : true;
    // 内容变化（新消息/流式输出）时自动滚底
    followObserver = new MutationObserver(() => {
      if (stick) body.scrollTop = body.scrollHeight;
    });
    followObserver.observe(body, { childList: true, subtree: true, characterData: true });
    body.scrollTop = body.scrollHeight;
    // 「回到底部」悬浮按钮
    const stage = document.getElementById('zfStage');
    if (stage) {
      const b = document.createElement('div');
      b.id = 'zfBtnBottom';
      b.textContent = '↓ 回到底部';
      b.style.cssText = 'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);z-index:6;display:none;align-items:center;padding:6px 14px;border-radius:16px;background:rgba(30,30,40,.92);border:1px solid rgba(255,255,255,.2);color:inherit;cursor:pointer;font-size:12px;';
      b.onclick = () => { stick = true; body._zfStick = true; body.scrollTop = body.scrollHeight; b.style.display = 'none'; };
      stage.appendChild(b);
    }
  }

  function unhost () {
    // 【黑屏兜底 2026-10-12】不只依赖 hostBoxId：只要舞台里还有被搬进来的窗口，全部还原。
    // 旧逻辑 hostBoxId 丢失（中途异常/会话 DOM 重渲染）时直接 return，窗口滞留舞台，
    // 退出时 #zfFocusRoot display:none → 窗口跟着隐藏 → 黑屏。
    const stageEls = $$('#zfStage .chatbox');
    if (!hostBoxId && stageEls.length === 0) return;
    const ids = new Set(stageEls.map(el => String(el.id || '')));
    if (hostBoxId) ids.add(String(hostBoxId));
    ids.forEach(function (bid) {
      const el = $('#zfStage .zf-hosted[id="' + (window.CSS && CSS.escape ? CSS.escape(bid) : bid) + '"]') ||
                 $$('#zfStage .chatbox').find(n => String(n.id || '') === bid);
      if (!el) return;
      try {
        const p = prevSnap.get(bid);
        if (p && p.parent && p.parent.isConnected) {
          p.parent.insertBefore(el, p.next || null);
        } else {
          // 快照父节点已脱离文档（专注期间 Codex 布局重排画布 DOM）：
          // 兜底挂回画布容器，否则窗口既不在舞台也不在画布 → 黑屏
          const cv = document.getElementById('canvasContent') ||
                     document.getElementById('canvasArea');
          if (cv) {
            // 2026-10-17 修复：兜底路径不再只清 style —— 清掉后会回退到 CSS 默认
            // width:80%（画布坐标系下非常宽）。显式给一个合理尺寸再挂回画布。
            el.removeAttribute('style'); // 清掉舞台内 absolute 100% 内联样式
            el.style.cssText = 'width:560px;height:680px;left:60px;top:60px;';
            cv.appendChild(el);
            try { window.App && App().canvasSetView && App().canvasSetView(null, null, null); } catch (e) {}
          } else {
            // 最终兜底：画布容器也不存在（DOM 结构改版），至少别让窗口丢失导致黑屏
            el.removeAttribute('style');
            el.style.cssText = 'width:560px;height:680px;left:60px;top:60px;';
            document.body.appendChild(el);
          }
        }
        const style = p ? p.style : null;
        if (p && p.parent && p.parent.isConnected) {
          if (style !== null && style !== undefined) el.setAttribute('style', style); else el.removeAttribute('style');
        }
      } catch (e) { console.warn('[focus-mode] unhost 还原失败', e); }
      el.classList.remove('zf-hosted');
      delete el.dataset.zfHosted;
      prevSnap.delete(bid);
      // 补打出生保护：unhost 恢复的样式是进入专注时的快照，期间可能被污染；
      // 给 chat.el 打 _zfFreshSpawn，让 relative-restore 10 秒内不得用脏偏移"校正"此窗
      try { el._zfFreshSpawn = Date.now(); } catch (e) {}
    });
    hostBoxId = null;
    refreshSess();
  }

  // 【黑屏自检 2026-10-12】退出专注模式后延迟检查：画布容器里若没有任何会话窗口，
  // 而舞台/页面里还有孤立的 .chatbox，强制搬回画布并恢复视图，杜绝任何路径的黑屏。
  function verifyNoBlackout () {
    function check (delay) {
      setTimeout(function () {
        try {
          if (document.body.classList.contains('zf-focus')) return; // 用户又进去了
          const cv = document.getElementById('canvasContent') || document.getElementById('canvasArea');
          if (!cv) return;
          const inCanvas = cv.querySelectorAll('.chatbox');
          if (inCanvas.length > 0) return; // 画布有窗口，正常
          // 找流落在外的窗口（舞台 / body 直挂）
          const lost = $$('#zfStage .chatbox, body > .chatbox');
          if (lost.length === 0) return; // 本来就没有会话，不算黑屏
          lost.forEach(function (el) {
            el.removeAttribute('style');
            el.classList.remove('zf-hosted');
            delete el.dataset.zfHosted;
            cv.appendChild(el);
          });
          try { window.App && App().canvasSetView && App().canvasSetView(null, null, null); } catch (e) {}
          console.warn('[focus-mode] 黑屏自检：已把', lost.length, '个窗口强制搬回画布');
        } catch (e) { console.warn('[focus-mode] 黑屏自检异常', e); }
      }, delay);
    }
    check(350);
    check(1000); // 【二次自检 2026-10-12】防画布容器延迟重渲染导致 350ms 首检漏检
  }

  // ---------- 工作台抽屉（专注模式内 = 进坞到右侧区域；否则透传浮层） ----------
  function toggleWorkbench () {
    if (isOn()) {
      const root = $('#zfFocusRoot');
      if (root.classList.contains('wb-docked')) { undockDrawer(); return; }
      if (dockDrawer()) return;
    }
    const K = window.__KiteNS || {};
    if (typeof K.toggleDrawer === 'function') { try { K.toggleDrawer(); return; } catch (e) {} }
    // 兜底：查找画布上的工作台按钮并点击
    const btn = $('.workbench-toggle, [data-wb-toggle], #workbenchToggle');
    if (btn) btn.click();
  }

  // ---------- 挂载顶栏入口按钮 ----------
  function mountEntry () {
    function place () {
      if ($('#zfFocusEntry')) return true;
      /* 2026-10-08：顶栏右侧已由 dom-topbar.js 注入 topbarFocusBtn（专注模式），
         不再重复追加旧入口，避免出现两个专注按钮 / 图标落在中间区域 */
      if ($('#topbarFocusBtn')) return true;
      const anchor = $('#winControls') || document.querySelector('#zf-topbar, .topbar');
      if (!anchor) return false;
      const btn = document.createElement('button');
      btn.id = 'zfFocusEntry';
      btn.className = 'zf-btn';
      btn.title = '专注模式 (F11)';
      btn.textContent = '⛶';
      btn.style.cssText = 'margin-right:6px;padding:2px 8px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:transparent;color:inherit;cursor:pointer;';
      btn.onclick = () => setMode(!isOn());
      anchor.appendChild(btn);
      return true;
    }
    if (!place()) {
      const mo = new MutationObserver(() => { if (place()) mo.disconnect(); });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  function init () { build(); mountEntry(); if (localStorage.getItem(LS_KEY) === '1') setMode(true); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.zfFocusMode = { set: setMode, toggle: () => setMode(!isOn()), isOn };
})();
