// ========== app-focus-mode.js - Codex 式专注模式（左项目/会话标签 + 右对话 + 工作台抽屉） ==========
(function () {
  'use strict';
  const LS_KEY = 'zf-focus-mode-on';
  /* 【统一新生管线 v1】非鼠标定位的新建对话统一间距：跟随主对话右侧 200px。
     未来调节只需改这一个常量（或 localStorage 'zf_spawn_gap' 覆盖）。 */
  const SPAWN_GAP = (() => {
    const v = parseInt(localStorage.getItem('zf_spawn_gap'), 10);
    return Number.isFinite(v) && v > 0 ? v : 200;
  })();
  const SPAWN_W = 380;   // 新对话默认宽度（批量横排步进用）
  let hostBoxId = null; // 当前被移入舞台的会话 box id
  const prevSnap = new Map(); // boxId -> {parent, next, style}（DOM 引用不能走 JSON，否则 nextSibling 丢失）
  /* 【策划案 20261123·三种模式积累性修复 #7】新建对话「焦点保持卫兵」的三件套句柄（interval / 重试 timeout /
     MutationObserver）。旧代码全是 doNewSession 里的局部变量：专注退出后它们照跑，回调里的 hostBox 又不判断
     模式 → 新对话被搬进已隐藏的舞台；用户想切到别的会话也会在 500ms 内被拉回。句柄提到模块级，
     供 setMode(false) 与「用户主动切换会话」统一取消。_newGuardTarget = 卫兵正在保护的那个新对话。 */
  let _newGuardIv = null, _newGuardTo = null, _newGuardMo = null, _newGuardTarget = null;
  function cancelNewSessionGuard () {
    if (_newGuardIv) { clearInterval(_newGuardIv); _newGuardIv = null; }
    if (_newGuardTo) { clearTimeout(_newGuardTo); _newGuardTo = null; }
    if (_newGuardMo) { try { _newGuardMo.disconnect(); } catch (e) {} _newGuardMo = null; }
    _newGuardTarget = null;
  }

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
      <div class="zf-main" id="zfMain">
        <!-- 2026-12-18 顶栏整行移除；2026-11-17 ②轮迭代：按钮组重排为 5 个 =
             更多 / 关闭(当前对话) / 新建对话 / 显示隐藏会话列表 / 退出专注模式，最右是退出。
             「显示/隐藏工作台」按钮彻底移除；更多与关闭复用对话框自身的 ⋯/✕ 逻辑。
             host 会话时并入对话框 .header-actions 右端，与对话自身图标并排；无会话时浮在舞台右上角。 -->
        <div class="zf-top-actions" id="zfTopActions">
          <button class="zf-btn zf-icon-btn" id="zfBtnMore" title="更多（工具 / 日志 / 优先级 / 引擎等）"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="3" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="13" cy="8" r="1.1"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnClose" title="关闭当前对话"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnNewTop" title="新建对话"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnSide" title="显示/隐藏会话列表"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg></button>
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
    ensureTopActions();
    // 2026-11-14 移除：派生关系总览按钮已删
    // 2026-10-18：暴露给对话底部工作台按钮，专注模式内与其共用同一开合逻辑
    window.__focusModeToggleWb = toggleWorkbench;
    initSplitter();
    initSplitter2();
    $('#zfWbHandle').onclick = toggleWorkbench;
    // 快捷键
    document.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('zf-focus') && e.key === 'Escape') setMode(false);
      if (e.key === 'F11') { e.preventDefault(); setMode(!isOn()); }
    });
    // 会话变化时刷新标签
    // 【P1-3 策划案 20261122】1500→3000ms：focus 态下全量重建列表 DOM 的成本减半；
    // 关闭态已有 isOn() 早退守卫（本轮询空闲零成本），3000ms 只影响专注态列表刷新延迟
    setInterval(refreshSess, 3000);
  }

  /* 【2026-11-23 修复「关闭当前对话后右上角按钮全消失」】按钮组 #zfTopActions 停靠时
     住在被 host 对话的 .header-actions 里；用户点对话自身 ✕（或任何关闭路径）时，
     对话 DOM 连带按钮组一起被移除，而 build() 因 #zfFocusRoot 仍在直接早退，
     新建/折叠侧栏/退出按钮再无重建入口，专注模式只剩 ESC 可退。
     现把「组缺失即重建 + 重新绑定」抽成幂等入口，build / refreshSess(3s 轮询) /
     dockTopActions 三处调用，任何删除路径 ≤3s 内自愈。
     【同日跟进】发现该版把绑定放进「重建」分支后，build() 模板内联创建的组永远走不到绑定
     → 重启后按钮全死。已解耦：重建只管建，绑定无条件幂等执行（详见函数内注释）。 */
  function ensureTopActions () {
    /* 2026-11-23 再修「重启后右上角按钮全失效」：build() 模板本身就内联创建了 #zfTopActions，
       旧版此处「已存在即 return」把绑定一并跳过 → 首次加载出来的按钮全是死按钮
       （只有组被连带删除后的自愈重建路径才带绑定）。现把「创建」与「绑定」解耦：
       组缺失才重建，绑定幂等每次都做（onclick 赋值天然幂等）。 */
    if (!document.getElementById('zfTopActions')) {
    const host = $('#zfMain') || $('#zfFocusRoot .zf-main') || $('#zfFocusRoot');
    if (!host) return;
    const grp = document.createElement('div');
    grp.className = 'zf-top-actions';
    grp.id = 'zfTopActions';
    grp.innerHTML = `
          <button class="zf-btn zf-icon-btn" id="zfBtnMore" title="更多（工具 / 日志 / 优先级 / 引擎等）"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="3" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="13" cy="8" r="1.1"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnClose" title="关闭当前对话"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnNewTop" title="新建对话"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></button>
          <button class="zf-btn zf-icon-btn" id="zfBtnSide" title="显示/隐藏会话列表"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg></button>
          <button class="zf-btn zf-icon-btn zf-ic-exit" id="zfBtnExit" title="退出专注模式 (ESC)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5v2a1.5 1.5 0 0 1-1.5 1.5h-2M10 2.5v2a1.5 1.5 0 0 0 1.5 1.5h2M6 13.5v-2a1.5 1.5 0 0 0-1.5-1.5h-2M10 13.5v-2a1.5 1.5 0 0 1 1.5-1.5h2"/></svg></button>`;
    host.appendChild(grp);
    }
    $('#zfBtnExit').onclick = () => setMode(false);
    $('#zfBtnSide').onclick = () => $('#zfFocusRoot').classList.toggle('side-collapsed');
    // 2026-11-17 ②轮：「更多」= 触发当前 host 对话自身的 ⋯ 菜单（复用对话逻辑，不改对话框代码）
    $('#zfBtnMore').onclick = () => {
      const boxEl = hostBoxId ? document.getElementById(hostBoxId) : null;
      const more = boxEl && boxEl.querySelector('.chatbox-header .more-btn');
      if (more) more.click();
    };
    // 「关闭」= 触发当前 host 对话自身的 ✕ 关闭（复用对话 data-act=close 委托）
    $('#zfBtnClose').onclick = () => {
      const boxEl = hostBoxId ? document.getElementById(hostBoxId) : null;
      const close = boxEl && boxEl.querySelector('.chatbox-header .hd-btn.close');
      if (close) close.click();
    };
    $('#zfBtnNewTop').onclick = doNewSession;
    /* 重建时舞台上若已有被 host 的对话（旧对话删除连带组消失、新对话已上台），立刻重新停靠 */
    const hosted = document.querySelector('#zfStage .chatbox[data-zf-hosted="1"]');
    if (hosted) { try { dockTopActions(hosted); } catch (e) {} }
  }
  // 2026-10-14：统一新建会话入口。创建后立即把新会话搬进舞台并刷新列表，
  // 解决「新建对话不会直接出现在列表中」的问题。左栏「＋」和顶部「＋新建对话」共用。
  // （2026-11-23 提升为模块级函数：ensureTopActions 重建按钮组后也要重绑本入口。）
  function doNewSession () {
      cancelNewSessionGuard(); /* 再点一次「＋」：先清上一轮卫兵，避免多个卫兵并存、旧卫兵去抢最新的新窗（策划案 20261123 #7） */
      // 注意：openNewSessionModal / showProjectSwitcher 定义在全局 App 对象上，不在 window 上
      const A = window.App || (typeof App !== 'undefined' ? App : null) || {};
      // 2026-11-25 修复：专注模式下 host 进舞台的对话 style.left/top 已被重置为舞台基准(0,0)，
      // 直接读 style 必然算错导致新窗飞到老远。改为：优先用 prevSnap 里保存的 host 前
      // 真实坐标快照（= 最后一个对话），把新对话放在它的右侧 +30px；
      // 无快照（非专注/未 host）时回退旧逻辑（最右会话右侧）。
      let cx = null, cy = null;
      try {
        const boxes = A.chatBoxes || [];
        /* 【统一新生管线 v1】基准 = 主对话（host 的会话）；不跟随子对话。
           无 host 时回退「最右主对话」（跳过子对话，childKeyOf 判定）。 */
        const isSub = (b) => {
          try {
            const R = window.ZFChildRel;
            return !!(R && b && b.el && typeof R.childKeyOf === 'function' && R.childKeyOf(b.el));
          } catch (e) { return false; }
        };
        let last = null, lastLeft = -Infinity, lastTop = null;
        // 优先：当前被 host 的对话（专注模式下的「主对话」），取 host 前快照坐标
        if (hostBoxId && prevSnap && prevSnap.get(hostBoxId)) {
          const snap = prevSnap.get(hostBoxId);
          // snap.style 是 host 前的完整 style 字符串（getAttribute('style')），需解析出 left/top
          const sl = snap && typeof snap.style === 'string' ? snap.style : '';
          const mL = sl.match(/(?:^|;)\s*left\s*:\s*(-?[\d.]+)px/);
          const mT = sl.match(/(?:^|;)\s*top\s*:\s*(-?[\d.]+)px/);
          if (mL && mT) {
            lastLeft = parseFloat(mL[1]) || 0;
            lastTop = parseFloat(mT[1]) || 0;
            last = boxes.find(b => String(b.id) === String(hostBoxId)) || { el: { offsetWidth: SPAWN_W } };
          }
        }
        // 回退：画布上最右（style.left 最大）的【主对话】（跳过子对话）
        if (!last) {
          boxes.forEach(b => {
            if (b && b.el && b.el.isConnected && !isSub(b)) {
              const L = parseFloat(b.el.style.left) || 0;
              if (L > lastLeft) { lastLeft = L; last = b; }
            }
          });
          if (!last && boxes.length) {
            last = boxes[boxes.length - 1];
            // 2026-10-15：兜底分支必须同步更新 lastLeft，否则会算出 -Infinity 飞出画布
            lastLeft = parseFloat(last.el && last.el.style.left) || 0;
          }
          if (last && last.el) lastTop = parseFloat(last.el.style.top) || 0;
        }
        if (last) {
          /* 【统一新生管线 v1】间距统一 SPAWN_GAP（默认200，localStorage 'zf_spawn_gap' 可覆盖）。
             hosted 窗 width:100%，offsetWidth 不能当对话宽用，一律回退 SPAWN_W。 */
          const _isHosted = last.el && last.el.classList && last.el.classList.contains('zf-hosted');
          const w = (!_isHosted && last.el && last.el.offsetWidth) || SPAWN_W;
          cx = lastLeft + w + SPAWN_GAP;
          cy = (lastTop != null) ? lastTop : 0;
        }
      } catch (e) {}
      /* 【批量创建 v1→简化】专注模式新建对话不再弹「创建几个」询问，默认一次只建 1 个。 */
      let batchN = 1;
      /* 2026-12-18 修复「新建对话仍不成为焦点」真因#3：旧代码 _beforeIds 快照在
         createChatBox 调用【之后】才拍（第139行）。而 undo/logmaster/toolmaster 等包装层
         会改写返回 id（created.id ≠ 真实入列 id），导致真实新窗 id 已混进 _beforeIds，
         兜底 _fallbackHostNewest 永远拒绝它、_fallbackDone 永远 false，重试 18s 后静默放弃。
         现把快照提前到【点击时刻、创建之前】，新窗无论 id 被谁改写都在 beforeIds 之外。 */
      const _beforeIds = new Set(((A.chatBoxes) || []).map(b => String(b.id)));
      for (let bi = 0; bi < batchN; bi++) {
        const bx = Number.isFinite(cx) ? cx + bi * (SPAWN_W + SPAWN_GAP) : null;
        const by = cy;
        let created = null;
        if (Number.isFinite(bx) && typeof A.createChatBox === 'function') {
          created = A.createChatBox(bx, by, null, true);
        }
        if (!created && typeof A.openNewSessionModal === 'function') created = A.openNewSessionModal();
        else if (typeof window.openNewSessionModal === 'function') created = window.openNewSessionModal();
        else if (typeof A.showProjectSwitcher === 'function') A.showProjectSwitcher();
        else if (typeof window.showProjectSwitcher === 'function') window.showProjectSwitcher();
        // openNewSessionModal 返回新建的 chatbox（{id,...}）；host 进舞台 + 刷新列表
        // 2026-12-13 修复「新建对话仍不成为焦点」根因：旧兜底 _fallbackHostNewest 遍历
        // 「任意未托管」窗，新会话尚未入列时会把画布上别的旧窗误 host 上台，随后
        // _fallbackDone 判「换新」即 true → 重试全退，新对话永远上不了台。
        // 现改为：点击时刻先快照 beforeIds（当前画布全部 chatbox id），兜底只允许
        // host「beforeIds 之外新出现」的窗；_fallbackDone 同样只认新窗。
        // 2026-12-09 修复：hostBox 内部靠 chatBoxes.find 找会话，新建会话若尚未入列/DOM 未就绪会静默 return，
        // 导致「点了新建对话，焦点还留在旧对话，要手动切换」。改为带重试的 host（最多 10 次×100ms），
        // 与双击标题路径（setTimeout 80ms 后 hostBox）同套路，确保新对话立刻成为舞台焦点。
        /* 2026-12-19 终修：不再要求 created.id 必有（undo/logmaster/toolmaster 等包装层
           可能返回 undefined 或改写 id）。_newId 为 null 时走「点击后新出现的窗」兜底
           跟踪，跟踪器/卫兵照常启动，绝不因拿不到 id 就整段跳过。 */
        {
          const _newId = (created && created.id != null) ? String(created.id) : null;
          /* _beforeIds 已提前到点击时刻（创建之前）拍快照，此处不再重复拍 */
          /* 2026-12-11 加强：1s 重试窗口实测不够（新建走慢路径：模型同步 fetch/持久化/DOM 渲染
             可能晚于 10×100ms），焦点留在旧对话。改为 30×150ms（4.5s）+ MutationObserver 兜底：
             只要新 chatbox 元素一挂进画布，立刻补 host，确保 100% 成为舞台焦点。 */
          let _tries = 0;
          let _moDone = false;
          /* 2026-12-12 修复「新建对话仍不成为焦点」：原逻辑只按 _newId 找，若包装层（undo/logmaster/
             toolmaster 等 createChatBox 包装）改写 id 或会话延迟入列，hostBox(_newId) 永远静默失败。
             现加双保险：① _newId host 失败时，兜底 host 画布上「最新创建且未被托管」的 chatbox；
             ② MutationObserver 改挂 document.body + subtree，覆盖任意挂载点。 */
          const _fallbackHostNewest = () => {
            try {
              const A2 = window.App || (typeof App !== 'undefined' ? App : null);
              const boxes = (A2 && A2.chatBoxes) || [];
              for (let i = boxes.length - 1; i >= 0; i--) {
                const b = boxes[i];
                /* 2026-12-13：只允许 host 点击时刻之后新出现的窗，绝不误抓旧窗 */
                if (b && b.el && b.el.isConnected && b.el.dataset &&
                    b.el.dataset.zfHosted !== '1' && !_beforeIds.has(String(b.id))) {
                  try { hostBox(b.id, true); } catch (e2) {} // true=程序自动上台：不触发「用户切换即取消卫兵」
                  if (hostBoxId === String(b.id)) return true;
                }
              }
            } catch (e) {}
            return false;
          };
          const _hostNewOnce = () => {
            if (!isOn()) { cancelNewSessionGuard(); return false; } // 专注已退出：整条兜底链自停（策划案 20261123 #7）
            try { hostBox(_newId, true); } catch (e) {}
            if (hostBoxId !== _newId) _fallbackHostNewest();
            try { refreshSess(); } catch (e) {}
            if ((hostBoxId === _newId || _fallbackDone()) && !_moDone) {
              _moDone = true;
              try { _mo.disconnect(); } catch (e) {}
            }
            return _moDone;
          };
          const _fallbackDone = () => {
            /* 2026-12-12b 修复「新建对话不成为焦点」真因：旧判定是"舞台上有任意 hosted 元素"，
               而旧对话本来就 host 在舞台上，首判即 true → _moDone=true → 重试/Observer 全部
               立刻退出，新对话 host 永远没机会成功。改为：hosted 元素必须是"换新"的
               （≠ 进入重试前的 _prevHostedEl），或 hostBoxId 已直接等于 _newId。
               2026-12-13 再修：换新元素还必须属于点击后新出现的窗（∉ _beforeIds），
               防止兜底误抓旧窗上台后被误判为成功。 */
            try {
              const stage2 = document.getElementById('zfStage');
              const el2 = stage2 && stage2.querySelector('.chatbox[data-zf-hosted="1"]');
              if (!el2 || el2 === _prevHostedEl) return false;
              /* 换新的窗必须是新窗：hostBoxId 在 _beforeIds 之外（新出现）才算成功 */
              return !!(hostBoxId && !_beforeIds.has(String(hostBoxId)));
            } catch (e) { return false; }
          };
          /* 记录重试开始前的旧 hosted 元素，供 _fallbackDone 判"换新" */
          const _prevHostedEl = (() => {
            try {
              const s0 = document.getElementById('zfStage');
              return s0 && s0.querySelector('.chatbox[data-zf-hosted="1"]') || null;
            } catch (e) { return null; }
          })();
          const _canvasEl = document.getElementById('canvasContent') || document.getElementById('canvasArea');
          /* 2026-12-14 修复「新建对话不成为焦点」真因#2：旧代码 _obsTarget 为 canvas 时
             subtree:false，只观察 canvas 直接子节点；新 chatbox 若挂进画布深层容器
             （如zf-stage 包装层/分组容器），childList 变化发生在深层，Observer 永远不触发。
             改为一律挂 document.body + subtree:true，任意挂载点都能捕获。 */
          const _mo = _newGuardMo = new MutationObserver(() => { _hostNewOnce(); });
          if (!_hostNewOnce() && isOn()) { // 专注已退出则不再挂观察（策划案 20261123 #7）
            try { _mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
          }
          /* 2026-12-14 按用户实测反馈：新建对话有时要等几秒才真正渲染，4.5s 重试窗口不够。
             重试窗口延长到 60×300ms=18s，且每轮之间 Observer 持续在线，双保险直到成功。 */
          (function _hostNewRetry () {
            if (!isOn()) { cancelNewSessionGuard(); return; } // 专注已退出：重试链自停（策划案 20261123 #7）
            if (_moDone || _hostNewOnce()) {
              try { _mo.disconnect(); } catch (e) {}
              /* 2026-12-17 焦点保持卫兵：用户实测新会话约 2s 后才真正渲染完成，期间主程序
                 可能重建 DOM/重设焦点，把刚 host 上台的新对话顶掉（表现为"还是不跳转"）。
                 首次 host 成功后再守 10s：每 500ms 检查，新对话一旦不在舞台上立刻重新 host。 */
              /* 2026-12-19 终修：卫兵改为跟踪「点击后新出现的窗」（∉ _beforeIds），
                 完全不依赖 _newId（包装层改写 id / created.id 缺失都能兜住）。
                 用户实测新会话约 2s 后才渲染、期间主程序会重建 DOM 把新窗顶下台，
                 卫兵窗口延长到 60×500ms=30s，期间只要新窗不在台上立刻重新 host。 */
              let _g = 0;
              _newGuardTarget = hostBoxId ? String(hostBoxId) : null; // 卫兵保护的「新窗」：用户主动切到别的会话时据此取消（见 hostBox）
              _newGuardIv = setInterval(() => {
                if (!isOn() || !_newGuardTarget) { cancelNewSessionGuard(); return; } // 专注已退出 / 已无新窗可守：自停（策划案 20261123 #7）
                try {
                  const A2 = window.App || (typeof App !== 'undefined' ? App : null);
                  const boxes = (A2 && A2.chatBoxes) || [];
                  const staged = document.querySelector('#zfStage .chatbox[data-zf-hosted="1"]');
                  const stagedId = staged ? String(staged.id) : null;
                  /* 当前台上是否已是「新窗」（beforeIds 之外） */
                  const stagedIsNew = stagedId && !_beforeIds.has(stagedId);
                  if (!stagedIsNew) {
                    /* 台上不是新窗 → 找最新出现的新窗重新 host */
                    for (let i = boxes.length - 1; i >= 0; i--) {
                      const b = boxes[i];
                      if (b && b.el && b.el.isConnected && !_beforeIds.has(String(b.id))) {
                        try { hostBox(b.id, true); } catch (e2) {}
                        break;
                      }
                    }
                  }
                } catch (e) {}
                if (++_g >= 60) { clearInterval(_newGuardIv); _newGuardIv = null; _newGuardTarget = null; }
              }, 500);
              return;
            }
            if (++_tries < 60) _newGuardTo = setTimeout(_hostNewRetry, 300);
            else { try { _mo.disconnect(); } catch (e) {} }
          })();
        }
      }
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

  /* 【2026-12-20 终极兜底：全局新窗自动上台】此前焦点跟踪只绑在专注模式自己的
     #zfBtnNewTop 按钮上；用户走任何其他新建入口（对话头部按钮/全局按钮/快捷键/
     其他模块 createChatBox）时，重试+卫兵逻辑根本不会启动 → 新对话永不上台。
     现改为：专注模式期间挂全局 MutationObserver，画布上任何「新出现的 chatbox」
     （id 不在进入时刻快照里、且不在舞台上）一律自动 host 上台。覆盖所有新建路径。 */
  let _newWatchObs = null;
  let _newWatchKnown = new Set();
  let _newWatchDebounce = null;
  function _scanNewBoxes () {
    if (!isOn()) return;
    try {
      const stage = document.getElementById('zfStage');
      const boxes = App().chatBoxes || [];
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (!b || b.id == null) continue;
        const bid = String(b.id);
        if (_newWatchKnown.has(bid)) continue;
        const el = b.el && b.el.isConnected ? b.el : null;
        if (!el) continue;
        /* 已在舞台上的不算新窗（hostBoxId 那个） */
        if (stage && stage.contains(el)) { _newWatchKnown.add(bid); continue; }
        /* 新窗 → 上台 */
        _newWatchKnown.add(bid);
        try { hostBox(b.id, true); } catch (e) {} // 程序自动上台：不触发「用户切换即取消卫兵」（策划案 20261123 #7）
        break; /* 一次只 host 一个，下一轮 tick 再看 */
      }
    } catch (e) {}
  }
  function startNewBoxWatch () {
    _newWatchKnown = new Set(((App().chatBoxes) || []).map(b => String(b.id)));
    if (_newWatchObs) { try { _newWatchObs.disconnect(); } catch (e) {} }
    _newWatchObs = new MutationObserver(() => {
      if (_newWatchDebounce) return;
      _newWatchDebounce = setTimeout(() => { _newWatchDebounce = null; _scanNewBoxes(); }, 100);
    });
    try { _newWatchObs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  function stopNewBoxWatch () {
    if (_newWatchObs) { try { _newWatchObs.disconnect(); } catch (e) {} _newWatchObs = null; }
    if (_newWatchDebounce) { clearTimeout(_newWatchDebounce); _newWatchDebounce = null; }
  }

  // ---------- 进入 / 退出 ----------
  function setMode (on, opts) {
    build();
    if (on === isOn()) return;
    if (on) {
      /* 【策划案 20261123·三种模式积累性修复 #4·模式互斥】专注与缩小整理不能叠加：总览的「隐藏卡片正文」规则
         （body.zf-overview-mode .chatbox > …{visibility:hidden !important}）会命中搬进舞台的对话 → 舞台一片空白，
         两侧的 document 级捕获监听也会互相干扰。进专注前先退出总览（退出动画在看不见的画布上照常跑完）。 */
      if (document.body.classList.contains('zf-overview-mode')) {
        try { if (window.App && typeof window.App.canvasOverviewToggle === 'function') window.App.canvasOverviewToggle(); } catch (eOv) {}
      }
      // 进入专注模式不改变窗口尺寸/最大化状态，保持用户当前窗口原样
      document.body.classList.add('zf-focus');
      window._zfFocusActive = true; // 全局标志：专注模式激活期间禁止画布定位（防新窗坐标被舞台基准污染）
      /* 【2026-12-16 侧栏半透明】读取背景蒙版透明度（Background.bgVeil，用户在背景设置里调的
         「蒙版强度」），取一半写入 CSS 变量 --zf-panel-alpha，供 focus-mode.css 让左栏/顶栏/
         工作台坞底色以「背景透明度的一半」透出轮动背景。只做读取不改 Background 状态。 */
      try {
        var bv = (window.Background && typeof Background.bgVeil === 'number') ? Background.bgVeil : 0.5;
        var alpha = Math.max(0, Math.min(1, bv / 2)); // 一半透明度，夹到 0~1
        document.getElementById('zfFocusRoot').style.setProperty('--zf-panel-alpha', alpha);
      } catch (e) {}
      try { localStorage.setItem(LS_KEY, '1'); } catch (eLs) {} // 存不进去也不该让专注「进一半」（下面的刷新/上台/监听照常执行）
      refreshSess();
      autoHostCurrent();
      startNewBoxWatch(); /* 全局新窗监听：任何入口新建的对话都立刻上台 */
    } else {
      /* 先取再清理：unhost 末尾会置 hostBoxId=null；后面每步各自 try，任何一步抛错都不会让对话留在隐藏舞台 */
      var exitFocusId = hostBoxId; // 2026-10-15：退出后摄像机回到最后 host 的对话（与进入前的视觉焦点一致）
      cancelNewSessionGuard(); /* 退出专注：停掉新建卫兵/重试链/观察器，否则它们会把对话搬进已隐藏的舞台（策划案 20261123 #7） */
      document.body.classList.remove('zf-focus');
      window._zfFocusActive = false;
      try { localStorage.removeItem(LS_KEY); } catch (eLs2) {}
      stopNewBoxWatch(); /* 退出专注模式：停掉全局新窗监听 */
      try { undockDrawer(); } catch (eDk) { console.warn('[focus-mode] 出坞异常', eDk); } // 兜底出坞：防止退出专注模式后抽屉残留在坞里
      try { unhost(); } catch (eUh) { console.warn('[focus-mode] unhost 异常', eUh); }
      /* 【2026-11-23 父子偏离修复】退出即重算父子偏移基准：unhost 已同步还原全部窗口
         DOM，此刻画布位置 = 用户认可的退出态真值。若不重算，relative-restore 的
         applyRestore 重试循环（专注期间被挂起，退出后 1.5~3s 内恢复）会按 localStorage
         里可能过时/被历史污染的旧基准把子窗拽到错误位置（实测：cb6 被拽离 3500px）。
         立即 rebase 后无漂移可校；父窗位置本身不对的场景由用户拖正时 markUserDragged
         自然重建基准。 */
      try { if (window.ZFRelativeRestore && typeof ZFRelativeRestore.rebase === 'function') ZFRelativeRestore.rebase(); } catch (eRB) {}
      /* recenter:false（由 app-canvas.js 在「从专注切到缩小整理」时传入）：退出专注不再把摄像机飞回最后 host
         的对话——它会和紧随其后的总览进入动画同时逐帧写 view，互相把镜头拽来拽去（策划案 20261123 #4） */
      var skipRecenter = !!(opts && opts.recenter === false);
      setTimeout(function () {
        if (!exitFocusId || skipRecenter) return;
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
    /* 【2026-11-23 自愈】组随被关对话被删时，3s 内在此重建（无新停靠动作也能恢复按钮） */
    ensureTopActions();
    const list = $('#zfSessList'); if (!list) return;
    const boxes = App().chatBoxes || [];
    /* 【策划案 20261123 #10】标题缓存只增不减：顺手清掉已不在 chatBoxes 里的条目（每轮 O(N)，量小） */
    if (titleCache.size > boxes.length) {
      const _liveIds = new Set(boxes.map(b => b.id));
      for (const k of titleCache.keys()) if (!_liveIds.has(k)) titleCache.delete(k);
    }
    // 【三模式共享状态 v1】i整理里被用户「关闭」的对话：专注模式左侧列表也不显示（状态共享，模式各自消费互不干涉）
    const _hidMap = (() => { try { return JSON.parse(localStorage.getItem('zf_org_closed') || '{}'); } catch (e) { return {}; } })();
    const _visMap = (() => { try { return JSON.parse(localStorage.getItem('zf_org_visin') || '{}'); } catch (e) { return {}; } })();
    const _visBoxes = boxes.filter(b => {
      const vid = (b.el && (b.el.id || (b.el.dataset && b.el.dataset.moId))) || String(b.id);
      if (_hidMap[vid]) return false;
      const rule = _visMap[vid];
      return !(rule && rule.focus === false);
    });
    // 按项目分组（保持会话原有顺序）
    const groups = []; const idx = new Map();
    _visBoxes.forEach(b => {
      const g = projNameOf(b);
      if (!idx.has(g)) { idx.set(g, { name: g, items: [] }); groups.push(idx.get(g)); }
      idx.get(g).items.push(b);
    });
    // 当前会话所在组自动展开（未被手动收起覆盖时）
    const cur = _visBoxes.find(b => b.id === hostBoxId);
    if (cur && !zfGroupClosed.has(projNameOf(cur))) zfGroupOpen.add(projNameOf(cur));
    list.innerHTML = '';
    let shown = 0;
    // 【2026-11-12 子对话关系展示】用 ZFChildRel 单一真源识别父子关系：
    // 父对话行带「↳ N」徽标（派出几个子对话一目了然），子对话缩进挂在父行下方。
    const R = window.ZFChildRel || null;
    const childMap = new Map();  // 父boxId -> [子box,...]
    const childIds = new Set();  // 子对话 id 集合（主列表跳过，避免重复出现）
    if (R) {
      try {
        const idSet = new Set(_visBoxes.map(b => String(b.id)));
        const orphanMap = new Map(); // 孤儿子对话: 源父id -> [子box]，父已关闭也展示，不静默消失
        _visBoxes.forEach(b => {
          if (!b || !b.el || !R.isSub(b.el)) return;
          const sid = R.srcIdOf(b.el);
          const k = (sid == null) ? null : String(sid);
          if (k == null) return;
          if (!idSet.has(k)) { // 源父对话已关：归入孤儿组，仍渲染（带提示）
            if (!orphanMap.has(k)) orphanMap.set(k, []);
            orphanMap.get(k).push(b);
            childIds.add(String(b.id));
            return;
          }
          if (!childMap.has(k)) childMap.set(k, []);
          childMap.get(k).push(b);
          childIds.add(String(b.id));
        });
        /* 【策划案 20261123 #23】空表要显式置空：旧写法只在非空时赋值，最后一批孤儿子对话关掉后旧 Map
           仍留在 window 上，钉着已关闭对话的对象（含 el 和 history）。读取方已判空。 */
        window.__zfOrphanChildren = orphanMap.size ? orphanMap : null;
      } catch (e) { console.warn('[专注模式] 子对话关系聚合失败，降级平铺', e); }
    }
    groups.forEach(g => {
      try {
      const hasCur = g.items.some(b => b.id === hostBoxId);
      const open = hasCur ? !zfGroupClosed.has(g.name) : zfGroupOpen.has(g.name);
      const head = document.createElement('div');
      head.className = 'zf-proj-item zf-group-head' + (hasCur ? ' active' : '') + (open ? ' open' : '');
      head.innerHTML = `<span class="zf-group-arrow">${open ? '▾' : '▸'}</span><span class="zf-group-name"></span><span class="zf-group-count">${g.items.filter(b => !childIds.has(String(b.id))).length}</span>`;
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
        if (childIds.has(String(b.id))) return; // 子对话不单独占行，挂在父行下
        shown++;
        const kids = childMap.get(String(b.id)) || [];
        const el = document.createElement('div');
        const sending = b.sending || b.isSending || false;
        el.className = 'zf-sess-item' + (b.id === hostBoxId ? ' active' : '');
        /* 【2026-11-2x 主对话状态点】主对话行也加状态小点：进行中●橙色脉冲 / 已完成✓绿色 / 失败✗红色 */
        const bDone = (b._taskStatus === 'success');
        const bFail = (b._taskStatus === 'error' || b._taskStatus === 'failed');
        el.innerHTML = `<span class="zf-sess-title"></span>` + (kids.length ? `<span class="zf-child-badge" title="该对话派出了 ${kids.length} 个子对话 · 点击查看派生关系图">↳ ${kids.length}</span>` : '') + (bDone ? '<span class="zf-child-done" title="已完成">✓</span>' : (sending ? '<span class="zf-child-run" title="进行中">●</span>' : (bFail ? '<span class="zf-child-fail" title="失败">✗</span>' : '')));
        el.querySelector('.zf-sess-title').textContent = boxTitle(b);
        el.title = boxTitle(b) + (kids.length ? `（派出了 ${kids.length} 个子对话）` : '') + '（点击切到此会话）';
        el.onclick = () => hostBox(b.id);
        const badge = el.querySelector('.zf-child-badge');
                list.appendChild(el);
        // 【S1 迷你派生图】父行下方一条状态格条：每格=一个子对话，颜色=状态，点击定位到子行
        if (kids.length) {
          const strip = document.createElement('div');
          strip.className = 'zf-child-strip';
          kids.forEach(k => {
            const dot = document.createElement('span');
            const kS = k.sending || k.isSending || false;
            const kD = (k._taskStatus === 'success');
            const kF = (k._taskStatus === 'error' || k._taskStatus === 'failed');
            dot.className = 'zf-strip-dot' + (kS ? ' run' : kD ? ' done' : kF ? ' fail' : '');
            dot.title = boxTitle(k) + (kS ? ' · 进行中' : kD ? ' · 已完成' : kF ? ' · 失败' : '');
            dot.onclick = (ev) => {
              ev.stopPropagation();
              const row = list.querySelector(`.zf-sess-child[data-zf-cid="${k.id}"]`);
              if (row) { row.scrollIntoView({ block: 'nearest' }); row.classList.add('zf-flash'); setTimeout(() => row.classList.remove('zf-flash'), 1200); }
              hostBox(k.id);
            };
            strip.appendChild(dot);
          });
          list.appendChild(strip);
        }
        // 子对话行：树形缩进 + 角色名 + 状态点，点击同样可 host 到舞台
        kids.forEach(k => {
          shown++;
          const ke = document.createElement('div');
          ke.dataset.zfCid = k.id;
          const kSending = k.sending || k.isSending || false;
          const krel = (R && R.childKeyOf(k.el)) || null;
          /* 【2026-11-15 角色名精简】子对话行只显示角色名（如「代码师」「验证师」），
             不再显示「子对话/自定义」这类冗余标签；完整标题保留在悬停 title 提示里 */
          var _rawRole = krel ? String(krel.key) : ((k.el && k.el._isSummarizerChat) ? '总结师' : '子对话');
          const krole = (function () {
            if (_rawRole !== '自定义' && _rawRole !== '子对话') return _rawRole;
            var t = '';
            try { t = boxTitle(k) || ''; } catch (eT) {}
            var m = t.match(/(验证师|代码师|优化师|安全师|反驳师|总结师|策划师|审核员|进化师|图标师|推进师|突破师|质检员)/);
            if (m) return m[1];
            /* 标题里没匹配到已知角色名：取标题首个短词（≤6字）当角色名，避免重复冗长 */
            var tt = t.replace(/\s+/g, '');
            if (tt && tt.length <= 6) return tt;
            return _rawRole;
          })();
          const kdone = (k._taskStatus === 'success');
          /* 【专注模式子对话分数 2026-11-15】用户需求②：左栏子对话行显示真实分数，
             单一真源 ZFChildRel.scoreOf（与右侧回收队列同源），抓不到显示「—」 */
          let kScore = null;
          try { kScore = (window.ZFChildRel && window.ZFChildRel.scoreOf) ? window.ZFChildRel.scoreOf(k) : null; } catch (e2) {}
          const kScoreTxt = (kScore != null) ? String(kScore) : '—';
          const kScoreCls = (kScore != null && Number(kScore) >= 80) ? ' zf-child-score-good' : ((kScore != null && Number(kScore) < 60) ? ' zf-child-score-low' : '');
          ke.className = 'zf-sess-item zf-sess-child' + (k.id === hostBoxId ? ' active' : '') + (kSending ? ' zf-sub-running' : '');
          ke.className = 'zf-sess-item zf-sess-child' + (k.id === hostBoxId ? ' active' : '') + (kSending ? ' zf-sub-running' : '');
          /* 【2026-11-15 去重精简】用户需求：子对话行只显示角色名（如「代码师」「验证师」），
             不再重复拼接会话标题；完整标题保留在悬停 title 提示里。 */
          /* 【2026-11-23 单行版】用户需求：角色名 + 分数 + 状态点同一排，节约竖排空间。
             结构：zf-child-col（横向 flex：角色名徽章 + 分数徽章同行）+ 行尾状态点 */
          ke.innerHTML = `<span class="zf-child-col"><span class="zf-child-role"></span>` +
            (kScore != null
              ? `<span class="zf-child-big-score${kScoreCls}" title="AI 评出分数：${kScoreTxt}">${kScoreTxt}</span>`
              : `<span class="zf-child-score" title="暂无评分">—</span>`) +
            `</span>` + (kdone ? '<span class="zf-child-done" title="已完成">✓</span>' : (kSending ? '<span class="zf-child-run" title="进行中">●</span>' : ''));
          ke.querySelector('.zf-child-role').textContent = krole; // textContent 转义，防 key 含特殊字符破版
          ke.title = boxTitle(k) + `（${krole} · 点击切到此子对话）`;
          ke.onclick = () => hostBox(k.id);
          list.appendChild(ke);
        });
      });
      } catch (eG) { console.warn('[专注模式] 项目组「' + g.name + '」渲染异常，跳过该组（不影响其他组）', eG); }
    });
    // 孤儿子对话统一渲染区（列表末尾）
    if (window.__zfOrphanChildren && window.__zfOrphanChildren.size) {
      try {
      const oh = document.createElement('div');
      oh.className = 'zf-group-head zf-orphan-head';
      oh.innerHTML = '<span class="zf-group-arrow">▾</span><span class="zf-group-name"></span>';
      oh.querySelector('.zf-group-name').textContent = '⌫ 源对话已关闭的子对话';
      list.appendChild(oh);
      window.__zfOrphanChildren.forEach(orphanKids => {
        orphanKids.forEach(k => {
          shown++;
          const ke = document.createElement('div');
          const krel = (R && R.childKeyOf(k.el)) || null;
          /* 【2026-11-15 角色名精简】子对话行只显示角色名（如「代码师」「验证师」），
             不再显示「子对话/自定义」这类冗余标签；完整标题保留在悬停 title 提示里 */
          var _rawRole = krel ? String(krel.key) : ((k.el && k.el._isSummarizerChat) ? '总结师' : '子对话');
          const krole = (function () {
            if (_rawRole !== '自定义' && _rawRole !== '子对话') return _rawRole;
            var t = '';
            try { t = boxTitle(k) || ''; } catch (eT) {}
            var m = t.match(/(验证师|代码师|优化师|安全师|反驳师|总结师|策划师|审核员|进化师|图标师|推进师|突破师|质检员)/);
            if (m) return m[1];
            /* 标题里没匹配到已知角色名：取标题首个短词（≤6字）当角色名，避免重复冗长 */
            var tt = t.replace(/\s+/g, '');
            if (tt && tt.length <= 6) return tt;
            return _rawRole;
          })();
          ke.className = 'zf-sess-item zf-sess-child zf-sess-orphan' + (k.id === hostBoxId ? ' active' : '');
          /* 2026-12-08 修复：孤儿行 innerHTML 只有 .zf-child-role/.zf-orphan-tag，没有 .zf-sess-title，
             原代码 querySelector('.zf-sess-title') 必返回 null，.textContent 赋值抛 TypeError，
             导致每次 1.5s 轮询刷新在孤儿区中断——新建对话/派出团队后左栏看起来不更新 */
          const _orphanTitle = document.createElement('span');
          _orphanTitle.className = 'zf-sess-title';
          _orphanTitle.textContent = boxTitle(k);
          ke.innerHTML = `<span class="zf-child-role"></span><span class="zf-orphan-tag" title="源父对话已关闭">源已关</span>`;
          ke.appendChild(_orphanTitle);
          ke.querySelector('.zf-child-role').textContent = krole;
          ke.title = boxTitle(k) + `（${krole} · 源对话已关闭 · 点击切到此子对话）`;
          ke.onclick = () => hostBox(k.id);
          list.appendChild(ke);
        });
      });
      } catch (eO) { console.warn('[专注模式] 孤儿子对话区渲染异常，跳过', eO); }
    }
    if (!shown) list.innerHTML = '<div class="zf-sess-item" style="opacity:.5">（暂无会话）</div>';
    $('#zfEmpty').style.display = boxes.length ? 'none' : 'flex';
    const crumb = $('#zfCrumb'); // 2026-12-18 顶栏整行移除后 zfCrumb 不存在，容错跳过
    if (crumb) crumb.textContent = (cur ? boxTitle(cur) : '专注模式');
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
  function hostBox (id, _auto) {
    /* 【策划案 20261123 #7】专注未开启不上台：迟到的定时器/重试链（双击标题 80ms、新建卫兵等）
       不再把对话搬进已隐藏的舞台。 */
    if (!isOn()) return;
    /* 用户主动切到别的会话 → 取消「新建卫兵」。卫兵的职责是新会话渲染期间被主程序顶下台时拉回，
       不该拦着用户切走（旧表现：点＋后 30 秒内点左栏任何旧会话都会在 500ms 内被拉回新对话）。
       _auto=true 为程序自动上台（卫兵自身/新窗监听/兜底重试），不触发取消。 */
    if (!_auto && _newGuardIv && id != null && _newGuardTarget && String(id) !== String(_newGuardTarget)) cancelNewSessionGuard();
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
    /* 【2026-11-2x 修复「点击被隐藏的对话，右侧不显示」】zf-chat-hidden（i缩小整理隐藏对话）
       的 display:none !important 会跟着 DOM 一起进舞台，导致舞台空白。用户主动点击=主动查看，
       上台时解除隐藏：摘类 + 从 localStorage 白名单移除（否则 5s 轮询 applyHiddenToDom 打回）。 */
    try {
      if (el.classList.contains('zf-chat-hidden')) {
        el.classList.remove('zf-chat-hidden');
        const hid = JSON.parse(localStorage.getItem('zf_chat_hidden_ids') || '[]');
        const kept = hid.filter(i => i !== String(id));
        if (kept.length !== hid.length) localStorage.setItem('zf_chat_hidden_ids', JSON.stringify(kept));
      }
    } catch (eH) {}
    if (el.dataset.zfHosted !== '1') {
      /* x/y：host 前的逻辑画布坐标（chat.x/y）。退出时回写，防 host 期间被任何
         路径写脏后残留（store/拖拽/跟随已各有守卫，此处兜底） */
      prevSnap.set(String(id), { parent: el.parentNode, next: el.nextSibling, style: el.getAttribute('style'), x: b.x, y: b.y });
      el.dataset.zfHosted = '1';
      el.classList.add('zf-hosted');
    }
    /* 【P0-1 策划案 20261122】收纳态上台唤醒：分组折叠成员带 inline display:none
       （app-canvas-groups.js collapseGroup）、随手折叠带 qn-gone、旧组隐藏带 zf-group-hidden，
       这些隐藏态跟着 DOM 进舞台 = 舞台空白。上台=主动查看（与下方 zf-chat-hidden 同语义）：
       记录被清除的隐藏态到 __zfWokenHidden，撤台时按记录还原——不依赖 style 快照还原，
       因为快照可能是更早上台时存的旧样式（期间窗被折叠过），按快照还原会漏掉 display:none。 */
    try {
      const woke = {};
      if (el.style.display === 'none') { woke.disp = true; el.style.display = ''; }
      if (el.dataset.zfGrpHidden === '1') woke.grpInline = true; // 仅记录；标记保留，expandGroup 仍认它
      if (el.classList.contains('zf-group-hidden')) { woke.grpCls = true; el.classList.remove('zf-group-hidden'); }
      if (el.classList.contains('qn-gone')) { woke.gone = true; el.classList.remove('qn-gone'); }
      if (Object.keys(woke).length) {
        if (!window.__zfWokenHidden) window.__zfWokenHidden = new Map();
        window.__zfWokenHidden.set(String(id), woke);
      }
    } catch (eW) {}
    /* 【2026-12-30 修复「点击其他对话右侧空白」】chatbox-lazy-offscreen 的 FPS 优化会给
       离屏窗口打 zf-offscreen（content-visibility:auto），DOM 搬进舞台后窗口相对视口仍
       "离屏"（IO 持续打回休眠标记），内容折叠成 360x480 占位盒 → 舞台空白。
       上台时强制唤醒：摘 zf-offscreen + 内联 important 取消 content-visibility
       （压过样式表规则）+ 解除 IO 观察（防 5s 内被打回休眠）。撤下时在 unhost 恢复。
       注意：必须放在 prevSnap 快照之后，否则唤醒内联样式会混进快照、撤下时残留。 */
    try {
      el.classList.remove('zf-offscreen');
      el.style.setProperty('content-visibility', 'visible', 'important');
      if (typeof window._zfUnobserveChatbox === 'function') window._zfUnobserveChatbox(el);
    } catch (eLazy) {}
    el.style.cssText += ';position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;max-height:none;z-index:2;';
    stage.appendChild(el);
    hostBoxId = String(id);
    // 2026-12-18 顶栏按钮并入对话框头部右侧（最右是退出专注模式）
    dockTopActions(el);
    // host 成功后重置空态文案，避免残留上次的警告文字
    const empty = $('#zfEmpty');
    if (empty) empty.textContent = '暂无会话 —— 点击左栏「＋」新建';
    refreshSess();
    setupFollowScroll(el);
  }

  // ---------- 消息区自动滚底 + 回到底部按钮 ----------
  let followObserver = null;
  /* 【策划案 20261123 #6】撤台/退出专注时断开跟随：旧代码只在「下一次 host」时才断开，退出专注后它仍挂在
     原对话上，画布里那个对话一有新内容就被强制滚到底。 */
  function stopFollowScroll () {
    if (followObserver) { followObserver.disconnect(); followObserver = null; }
    const btn = document.getElementById('zfBtnBottom');
    if (btn) btn.remove();
  }
  function setupFollowScroll (box) {
    stopFollowScroll();
    const body = box.querySelector('.chatbox-body');
    if (!body) return;
    // 记号守卫：同一 body 反复进出时只挂一次 scroll 监听，防累积
    if (!body.dataset.zfScrollBound) {
      body.dataset.zfScrollBound = '1';
      body.addEventListener('scroll', () => {
        body._zfStick = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      });
    }
    body._zfStick = true; // 上台即贴底
    // 内容变化（新消息/流式输出）时自动滚底。
    /* 【策划案 20261123 #6】贴底标志实时读 body._zfStick：旧代码把 host 那一刻的值冻结在闭包里（stick），
       scroll 监听更新的是 body._zfStick，回调读的却是旧值 → 用户上翻后仍被判为贴底，
       AI 输出时每个增量都把滚动条拽回底部（实测 0 → 1959）。 */
    followObserver = new MutationObserver(() => {
      if (body._zfStick !== false) body.scrollTop = body.scrollHeight;
    });
    followObserver.observe(body, { childList: true, subtree: true, characterData: true });
    body.scrollTop = body.scrollHeight;
    // 【2026-11-17 移除】「回到底部」悬浮按钮（zfBtnBottom）：与对话框原有向下箭头重复，用户要求去掉
  }

  // ---------- 顶栏按钮停靠：并入对话头部右侧 / 撤回浮动组 ----------
  // 2026-12-18：zf-top 整行移除后，4 个按钮平时浮在舞台右上角；有 hosted 对话时
  // 搬进对话 .chatbox-header .header-actions 的最前面（原对话按钮仍在其右，✕ 关闭仍是
  // 对话自身最右按钮，退出专注模式紧邻其左）。撤出时搬回 #zfTopActions 原位。
  function dockTopActions (boxEl) {
    /* 2026-11-23：停靠前先确保按钮组存在（被关对话连带删除时随停靠即时重建） */
    ensureTopActions();
    const grp = document.getElementById('zfTopActions');
    if (!grp || !boxEl) return;
    const ha = boxEl.querySelector('.chatbox-header .header-actions');
    if (!ha || grp.dataset.docked === boxEl.id) return;
    // 记住浮动组原父节点，撤出时用
    if (!grp.dataset.homeParent) {
      /* 2026-11-23 修复：原逻辑硬编码 #zfStage 当「原位」，但组的真身原位是 .zf-main
         （只有 .zf-main > .zf-top-actions 有右上角绝对定位规则）；回 #zfStage 的组没有任何
         定位规则，会以静态流裸排在舞台左上角、被后上台的对话(z-index:2)盖住＝按钮"消失"。
         现在：原位本来就在 .zf-main（现在有 id=zfMain）时记它，否则才回退 #zfStage。 */
      const p0 = grp.parentNode;
      const homeEl = (p0 && p0.id) ? p0 : document.getElementById('zfMain');
      grp.dataset.homeParent = (homeEl && homeEl.id) || 'zfMain';
    }
    // 2026-11-17 ②轮：停靠改为插到对话自身按钮之后（用户要求最右是「退出专注模式」）
    ha.appendChild(grp);
    // 2026-12-25 修复「右上角更多/关闭图标重复」：对话 .header-actions 自带 ⋯(更多) 和
    // ✕(关闭)，专注组的 zfBtnMore/zfBtnClose 功能与其完全重复（就是 click 同一按钮）。
    // 停靠状态下隐藏这两个重复按钮；撤回浮动时恢复显示。
    const dupMore = document.getElementById('zfBtnMore');
    const dupClose = document.getElementById('zfBtnClose');
    if (dupMore) dupMore.style.display = 'none';
    /* 2026-12-30 修复「关闭与对话自身 ✕ 重复」：上一行写成了 display='' 导致关闭按钮未隐藏，
       现与更多按钮一致，停靠状态下都隐藏（对话自身的 ⋯/✕ 已覆盖同功能）。 */
    if (dupClose) dupClose.style.display = 'none';
    grp.dataset.docked = boxEl.id || '1';
  }
  function undockTopActions () {
    const grp = document.getElementById('zfTopActions');
    if (!grp) return;
    /* 2026-12-19 修复「退出专注模式后新对话右上角残留专注按钮」：旧逻辑 dataset.docked
       丢失（对话 DOM 被包装层克隆/重建，或按钮组被搬进后 dataset 被清）时直接 return，
       按钮组永久滞留在对话头部。现改为：只要按钮组还挂在任何 .chatbox 里，一律强制搬回
       舞台原位；同时摘除可能被克隆出来的重复 .zf-top-actions（id 只允许一个）。 */
    const _home = grp.dataset.homeParent ? document.getElementById(grp.dataset.homeParent)
                                         : document.getElementById('zfStage');
    if (grp.closest && grp.closest('.chatbox')) {
      (_home || grp.parentNode || document.body).appendChild(grp);
    }
    delete grp.dataset.docked;
    /* 撤回浮动：恢复「更多/关闭」按钮显示（停靠时因与对话自身 ⋯/✕ 重复被隐藏） */
    const _m = document.getElementById('zfBtnMore');
    const _c = document.getElementById('zfBtnClose');
    if (_m) _m.style.display = '';
    if (_c) _c.style.display = '';
    /* 摘除克隆副本（克隆的节点不在 #zfTopActions id 上，按 class 找） */
    document.querySelectorAll('.chatbox .zf-top-actions').forEach(function (n) {
      if (n !== grp) n.remove();
    });
  }

  function unhost () {
    // 【策划案 20261123 #6】先断开滚动跟随：无论下面有没有窗口要还原，原 host 对话都不该再被强制滚底
    stopFollowScroll();
    // 2026-12-18 顶栏按钮撤回浮动组（顶栏整行已移除）
    undockTopActions();
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
      /* 【策划案 20261123 #10】台上找不到这个窗（host 期间被关闭，或被别的路径搬走）也要清快照：
         旧代码在这里直接 return，走不到末尾的 prevSnap.delete；快照里的 next 是画布兄弟节点的活引用，
         兄弟之后被关掉时它的整棵对话 DOM 会被一直钉在内存里（每关一次多一条）。 */
      if (!el) {
        prevSnap.delete(bid);
        try { if (window.__zfWokenHidden) window.__zfWokenHidden.delete(bid); } catch (e) {}
        return;
      }
      try {
        const p = prevSnap.get(bid);
        const style = p ? p.style : null;
        if (p && p.parent && p.parent.isConnected) {
          /* 【策划案 20261123 #5】p.next 是 host 时刻的兄弟节点：专注期间它被关掉后已不在父节点下，
             insertBefore 会抛 NotFoundError。旧代码被外层 catch 吞掉 → 既不搬回也不还原样式，窗口滞留
             隐藏舞台、从画布消失（verifyNoBlackout 因画布还有别的窗口而不救）。现兜底 appendChild 回原父节点。 */
          try { p.parent.insertBefore(el, p.next || null); }
          catch (eIns) { try { p.parent.appendChild(el); } catch (eAp) {} }
        } else {
          // 快照父节点已脱离文档（专注期间 Codex 布局重排画布 DOM）：
          // 兜底挂回画布容器，否则窗口既不在舞台也不在画布 → 黑屏
          const cv = document.getElementById('canvasContent') ||
                     document.getElementById('canvasArea');
          if (cv) {
            // 2026-10-17 修复：兜底路径不再只清 style —— 清掉后会回退到 CSS 默认
            // width:80%（画布坐标系下非常宽）。显式给一个合理尺寸再挂回画布。
            /* 2026-11-23 父子偏离修复：有快照 style 时整份还原（真实画布坐标/尺寸，
               与正常还原路径同一份快照）；无快照才退固定 60,60 —— 硬编码坐标会让
               该窗相对其父子树整体偏离。 */
            if (style !== null && style !== undefined) {
              el.setAttribute('style', style);
            } else {
              el.removeAttribute('style'); // 清掉舞台内 absolute 100% 内联样式
              el.style.cssText = 'width:560px;height:680px;left:60px;top:60px;';
              /* 【策划案 20261123 #5】只有「无快照、窗口被放在 (60,60)」时才把摄像机归位；有快照时窗口已回到
                 原坐标，再把摄像机拉到 (0,0) 反而让它落到视野外，看起来像又丢了一次 */
              try { window.App && App().canvasSetView && App().canvasSetView(null, null, null); } catch (e) {}
            }
            cv.appendChild(el);
          } else {
            // 最终兜底：画布容器也不存在（DOM 结构改版），至少别让窗口丢失导致黑屏
            el.removeAttribute('style');
            el.style.cssText = 'width:560px;height:680px;left:60px;top:60px;';
            document.body.appendChild(el);
          }
        }
      } catch (e) { console.warn('[focus-mode] unhost 还原失败', e); }
      /* 【策划案 20261123 #5】样式还原与「搬移是否成功」解耦：上面任何一步抛错都不该让窗口带着舞台样式
         （absolute / 100% 宽高 / z-index:2）留在画布上。只要快照父节点还在文档里就按快照还原。 */
      try {
        const p = prevSnap.get(bid);
        if (p && p.parent && p.parent.isConnected) {
          if (p.style !== null && p.style !== undefined) el.setAttribute('style', p.style); else el.removeAttribute('style');
        }
      } catch (eSt) {}
      /* 【2026-11-23 父子偏离修复】回写 host 前的逻辑画布坐标：host 期间若被任何
         路径写脏（拖拽残留/落库读取舞台几何），退出后 chat.x/y 与视觉位置不一致，
         后续落库与 relative-restore 的父窗稳定门禁都会按脏值连锁偏离 */
      try {
        const p = prevSnap.get(bid);
        const bb = (App().chatBoxes || []).find(function (x2) { return String(x2.id) === String(bid); });
        if (bb && p && typeof p.x === 'number' && typeof p.y === 'number') { bb.x = p.x; bb.y = p.y; }
      } catch (eXY) {}
      el.classList.remove('zf-hosted');
      /* 【2026-12-30】撤下舞台时恢复懒渲染观察：清掉上台时的唤醒内联样式，
         重新交给 chatbox-lazy-offscreen 的 IO 管理（离屏窗口回休眠省渲染） */
      try { el.style.removeProperty('content-visibility'); } catch (eCv) {}
      try { if (typeof window._zfObserveChatbox === 'function') window._zfObserveChatbox(el); } catch (eObs) {}
      /* 【P0-1 策划案 20261122】上台唤醒的隐藏态还原（分组折叠/qn-gone/旧组隐藏）。
         必须在 style 快照还原之后执行（快照还原会整体覆盖 style）。
         · disp：仅当 zfGrpHidden 标记仍在才回填 display:none——期间若用户展开过组
           （expandGroup 已摘标记），不再强行藏回；
         · grpCls/qn-gone：无条件回挂，若组/收纳态已解除，5s 轮询与事件驱动方会自行摘掉。 */
      try {
        const wk = window.__zfWokenHidden && window.__zfWokenHidden.get(bid);
        if (wk) {
          if (wk.disp && el.dataset.zfGrpHidden === '1') el.style.display = 'none';
          if (wk.grpCls) el.classList.add('zf-group-hidden');
          if (wk.gone) el.classList.add('qn-gone');
          window.__zfWokenHidden.delete(bid);
        }
      } catch (eWk) {}
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

  // ---------- 【2026-11-30 快捷手势】对话标题栏：左键双击=进入专注模式并聚焦该对话；右键双击=i整理 ----------
  // 说明：绑定在 document capture 阶段（chatbox 标题 DOM 可能被重建，绑具体元素易失效）。
  // 左键双击：目标在 .chatbox 的标题区（.title 等）→ 进入专注模式并把该对话 host 到舞台；
  //   若已处于专注模式且舞台正是该对话 → 视为开关，退出专注模式。
  // 右键双击：同一对话标题 500ms 内两次 contextmenu → 触发 i整理（organizeDockBtn）。
  //   注意：标题区右键菜单被吞（preventDefault），这是双击右键手势的必要代价。
  function setupTitleGestures () {
    if (document.__zfTitleGestures) return;
    document.__zfTitleGestures = true;
    function isTitleTarget (t) {
      try {
        return !!(t && t.closest && t.closest('.chatbox') &&
          t.closest('.title, .chatbox-header, .chatbox-header-row1'));
      } catch (e) { return false; }
    }
    function boxIdOf (t) {
      try { const cb = t.closest('.chatbox'); return cb ? (cb.id || null) : null; }
      catch (e) { return null; }
    }
    // 左键双击 → 专注模式
    document.addEventListener('dblclick', function (e) {
      if (!isTitleTarget(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      const id = boxIdOf(e.target);
      if (isOn() && id && hostBoxId === String(id)) { setMode(false); return; } // 再双击同对话标题 = 退出
      setMode(true);
      if (id) setTimeout(function () { try { hostBox(id); } catch (err) {} }, 80); // 覆盖 autoHostCurrent，确保焦点就是双击的对话
    }, true);
    // 中键双击 → i工程（window.ZFEngineering.open，由 zf-app-engineering.js 提供）
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 1 || e.detail !== 2) return;
      if (!isTitleTarget(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      // 2026-11-15 i工程前端下线（i整理接替），中键双击改开 i整理；window.ZFEngineering 守门保留兜底
      if (window.ZFEngineering && typeof window.ZFEngineering.open === 'function') window.ZFEngineering.open();
      else { const ob = document.getElementById('organizeDockBtn'); if (ob) ob.click(); }
    }, true);
    // 右键双击 → i整理
    let rT = 0, rBox = null, rTimer = null;
    document.addEventListener('contextmenu', function (e) {
      if (!isTitleTarget(e.target)) { rT = 0; return; }
      e.preventDefault(); e.stopPropagation();
      const id = boxIdOf(e.target);
      const now = Date.now();
      if (rT && now - rT < 500 && rBox === id) {
        rT = 0; if (rTimer) { clearTimeout(rTimer); rTimer = null; }
        const ob = document.getElementById('organizeDockBtn');
        if (ob) ob.click(); // i整理按钮被收编进 i无限面板后 DOM 仍在（display:none 保活监听），click 依然生效
      } else {
        rT = now; rBox = id;
        if (rTimer) clearTimeout(rTimer);
        rTimer = setTimeout(function () { rT = 0; }, 520);
      }
    }, true);
  }

  // ---------- 【2026-12-对话内长按手势】对话框内部：长按左键 600ms=进入专注模式；长按右键 600ms=i整理 ----------
  // 与标题栏双击手势并存：长按判定 = mousedown 后 600ms 内未弹起、未移动超过 8px。
  //   - 左键长按：进入专注模式并 host 该对话（复用 zfFocusMode.set/host 语义，再按一次退出由标题双击/按钮负责）。
  //   - 右键长按：触发 i整理（organizeDockBtn.click()），并吞掉本次 contextmenu 防止长按后弹出系统菜单。
  //   - 排除可编辑元素（input/textarea/contenteditable）：避免输入时停顿误触；文本选择不受影响（不 preventDefault mousedown）。
  function setupBoxLongPress () {
    if (document.__zfBoxLongPress) return;
    document.__zfBoxLongPress = true;
    var LONG_MS = 600, MOVE_PX = 8;
    var st = null;        // 进行中的长按状态 {button,x,y,timer,boxId}
    var suppressCtx = 0;  // 长按右键触发后的吞菜单截止时间戳
    function isBoxTarget (t) {
      try { return !!(t && t.closest && t.closest('.chatbox')); } catch (e) { return false; }
    }
    function isEditable (t) {
      try {
        if (!t || !t.closest) return false;
        return !!t.closest('input, textarea, [contenteditable="true"], [contenteditable=""], button, a, select, [role="button"]');
      } catch (e) { return false; }
    }
    function clear () {
      if (st && st.timer) { clearTimeout(st.timer); st.timer = null; }
      st = null;
    }
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0 && e.button !== 2) return;
      if (!isBoxTarget(e.target) || isEditable(e.target)) { clear(); return; }
      var boxId = null;
      try { var cb = e.target.closest('.chatbox'); boxId = cb ? (cb.id || null) : null; } catch (err) {}
      clear();
      st = { button: e.button, x: e.clientX, y: e.clientY, boxId: boxId, timer: null };
      st.timer = setTimeout(function () {
        var fired = st;
        st = null; // 先置空，防止 mouseup 再走 clear
        suppressCtx = Date.now() + 400; // 长按后短暂吞 contextmenu
        if (fired.button === 0) {
          // 长按左键 → 进入专注模式并聚焦该对话
          window.zfFocusMode.set(true);
          if (fired.boxId) setTimeout(function () {
            try { window.zfFocusMode.host(fired.boxId); } catch (err) {}
          }, 80);
        } else {
          // 长按右键 → i整理
          var ob = document.getElementById('organizeDockBtn');
          if (ob) ob.click();
        }
      }, LONG_MS);
    }, true);
    document.addEventListener('mousemove', function (e) {
      if (st && (Math.abs(e.clientX - st.x) > MOVE_PX || Math.abs(e.clientY - st.y) > MOVE_PX)) clear();
    }, true);
    document.addEventListener('mouseup', function (e) {
      if (st && e.button === st.button) clear();
    }, true);
    // 长按右键触发后吞掉紧随的 contextmenu（否则会弹出系统右键菜单）；
    // 未满时长的正常右键不吞（无 st，suppressCtx 未更新），走标题栏双击手势/正常菜单。
    document.addEventListener('contextmenu', function (e) {
      if (Date.now() < suppressCtx) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  function init () { build(); mountEntry(); setupTitleGestures(); setupBoxLongPress(); if (localStorage.getItem(LS_KEY) === '1') setMode(true); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.zfFocusMode = { set: setMode, toggle: () => setMode(!isOn()), isOn,
    /* 【2026-11-15 成功弹窗联动】host(id)：把指定会话搬上专注舞台（供「查看成功」成功箭头点击时
       直接把该对话弄成焦点；非专注模式返回 false 不影响原画布跳转逻辑） */
    host: function (boxId) {
      try {
        if (!isOn()) return false;
        hostBox(String(boxId));
        return true;
      } catch (e) { return false; }
    },
    /* 【2026-11-26 派出不再踢出专注模式】realPos(boxId)：返回被 host 对话 host 前的真实画布坐标
       （从 prevSnap 快照解析），供派出团队/生成子对话的坐标计算使用；非专注或无快照返回 null */
    realPos: function (boxId) {
      try {
        if (!isOn() || !prevSnap) return null;
        var snap = prevSnap.get(String(boxId));
        if (!snap || typeof snap.style !== 'string') return null;
        var mL = snap.style.match(/(?:^|;)\s*left\s*:\s*(-?[\d.]+)px/);
        var mT = snap.style.match(/(?:^|;)\s*top\s*:\s*(-?[\d.]+)px/);
        if (!mL || !mT) return null;
        /* 【2026-11-26 realSize】专注模式下源窗 inline 宽高被改成 100%（舞台全屏），
           派单用 offsetWidth/offsetHeight 会拿到全屏尺寸把新窗飞到老远；
           这里从快照一并解析 host 前真实宽高，供坐标计算用 */
        var mW = snap.style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)px/);
        var mH = snap.style.match(/(?:^|;)\s*height\s*:\s*([\d.]+)px/);
        /* 整体回退+视口夹取: w/h 任一字段失效则整体回退0, 有效值夹取到视口-100 */
        var w = mW ? (parseFloat(mW[1]) || 0) : 0;
        var h = mH ? (parseFloat(mH[1]) || 0) : 0;
        if (!w || !h) return { left: parseFloat(mL[1]) || 0, top: parseFloat(mT[1]) || 0, w: 0, h: 0 };
        var vw = (window.innerWidth || 1920) - 100, vh = (window.innerHeight || 1080) - 100;
        if (w > vw) w = vw; if (h > vh) h = vh;
        return { left: parseFloat(mL[1]) || 0, top: parseFloat(mT[1]) || 0, w: w, h: h };
      } catch (e) { return null; }
    } };
})();
