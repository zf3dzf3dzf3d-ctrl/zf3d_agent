/* =====================================================================
 * app-middle-dbl-note.js  v1
 * 【随手标题·中键双击创建】i缩小整理模式 + 无限画布 通用
 * =====================================================================
 * 用户令（2026-12-15）：
 *   i缩小整理模式：空白的位置，双击鼠标中键 → 建立随手标题
 *   同时在无限画布（正常模式），双击中键 → 在鼠标位置创建随手标题
 *
 * 技术要点（为什么不能用 dblclick 事件）：
 *   浏览器只对【左键】派发 dblclick 事件；中键（button===1）双击不会产生
 *   dblclick，只会连续派发两次 mousedown/mouseup（button=1）。因此必须
 *   自己在 document 上监听 mousedown，检测「短时间内两次快速按下中键」。
 *
 * 与中键拖拽平移（app-canvas.js 的 pan 逻辑）的关系：
 *   画布上中键按下即进入拖拽平移态，真正的「平移操作」按下后鼠标会移动。
 *   本模块只认【两次按下位置几乎不动（≤8px）且两次按下之间无拖动位移】
 *   的按下序列——与拖拽平移互不干扰。
 *
 * 依赖（全部延迟取用，不阻塞加载）：
 *   - App._isCanvasBlankTarget(target)  空白判定真源（与右键长按同一入口）
 *   - App.canvasScale()                 画布缩放（总览态也正确返回 view.scale）
 *   - #canvasContent                    坐标换算宿主（transform-origin 0 0）
 *   - QuickNote.create(x, y, text)      创建随手标题（自动进编辑态并落库）
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__zfMiddleDblNoteLoaded) return;
  window.__zfMiddleDblNoteLoaded = true;

  /* ---- 屏幕坐标 → 画布逻辑坐标（与 openDualPanels 同款公式）----
   * transform-origin 为 0 0：rect = canvasContent.getBoundingClientRect()
   * 已含 view 平移+缩放（rect.left = areaRect.left + view.x），
   * 故 local = (client - rect.left) / scale。总览态 canvasScale() 返回
   * view.scale（0.12~1.6），公式同样成立。 */
  function toCanvasPos(clientX, clientY) {
    var host = document.getElementById('canvasContent');
    if (!host) return { x: clientX, y: clientY };
    var rect = host.getBoundingClientRect();
    var scale = 1;
    try {
      if (window.App && typeof App.canvasScale === 'function') scale = App.canvasScale() || 1;
    } catch (e) {}
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale
    };
  }

  /* ---- 空白判定：复用 App._isCanvasBlankTarget（与右键/长按同一真源）----
   * 点在对话框/小地图/输入框等非空白处时不创建。 */
  function isBlank(target) {
    try {
      if (window.App && typeof App._isCanvasBlankTarget === 'function') {
        return App._isCanvasBlankTarget(target);
      }
    } catch (e) {}
    return true; // 判定函数缺失/异常时按空白处理（与 openCreatePanels 放宽策略一致）
  }

  /* ---- 创建随手标题（QuickNote.create 内部自动进编辑态并落库）---- */
  function createNoteAt(clientX, clientY, target) {
    if (!window.QuickNote || typeof QuickNote.create !== 'function') {
      try { if (window.App && App._toast) App._toast('随手标题组件未加载，无法创建', 'warn'); } catch (e) {}
      return;
    }
    if (!isBlank(target)) return;
    var pos = toCanvasPos(clientX, clientY);
    try {
      QuickNote.create(pos.x, pos.y, '随手标题');
    } catch (err) {
      try { console.error('[中键双击建标题] 创建失败', err); } catch (e2) {}
    }
  }

  /* ---- 中键双击检测（核心）：两次快速 mousedown(button=1) ---- */
  var _lastDown = null;   // {x, y, t}
  var DBL_MS = 500;       // 双击间隔上限（与浏览器双击阈值一致）
  var DBL_PX = 8;         // 两次按下位置差上限（与系统双击 slop 相当）
  var _moved = false;     // 两次按下之间是否发生过 >3px 的鼠标移动（拖拽平移特征）
  var _pending = false;   // 已确认双击、待 260ms 后创建（期间的中键按下全部吞掉，防三连击重复创建）

  /* 拖动位移监控：两次按下之间鼠标移动超过 3px → 取消双击资格 */
  document.addEventListener('mousemove', function (e) {
    if (_lastDown) {
      if (Math.abs(e.clientX - _lastDown.x) > 3 || Math.abs(e.clientY - _lastDown.y) > 3) {
        _moved = true;
      }
    }
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 1) return; // 只看中键
    var now = Date.now();

    // 双击已确认待创建：吞掉后续中键按下（不清 _pending，到点仍创建一次；防三连击建两个）
    if (_pending) return;

    var ok = _lastDown &&
      (now - _lastDown.t) <= DBL_MS &&
      Math.abs(e.clientX - _lastDown.x) <= DBL_PX &&
      Math.abs(e.clientY - _lastDown.y) <= DBL_PX &&
      !_moved;

    if (ok) {
      // 命中双击：记下坐标与目标，立即重置状态
      var cx = e.clientX, cy = e.clientY, tgt = e.target;
      _lastDown = null; _moved = false;
      _pending = true;
      // 延到 260ms 后创建：确认期间没有再按下（第三击已被上面吞掉）
      setTimeout(function () {
        if (_pending) {
          _pending = false;
          createNoteAt(cx, cy, tgt);
        }
      }, 260);
    } else {
      // 记为"第一次按下"候选
      _lastDown = { x: e.clientX, y: e.clientY, t: now };
      _moved = false;
    }
  }, true); // capture：与画布中键拖拽平移并行观察，互不阻塞
})();
