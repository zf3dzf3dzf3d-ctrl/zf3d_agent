/* ============================================================
 * canvas-node-modal-lock.js - 画布「游戏引擎/内置浏览器/演示」节点
 * 打开期间的对话交互锁定（统一入口）
 *
 * 规则：只要画布上存在任一此类节点，聊天输入框/发送按钮即被禁用，
 * 后续对话无法交互；全部节点关闭后自动恢复。
 *
 * 用法（由各节点文件在 add()/remove() 中调用）：
 *   CanvasNodeLock.update()   // 重新统计当前节点数并加/解锁
 *   CanvasNodeLock.isLocked() // 是否处于锁定状态
 * ============================================================ */
(function () {
  'use strict';

  var _refs = [];   // 各节点注册的 { id, el }

  function _chatboxes() {
    return Array.prototype.slice.call(document.querySelectorAll('.chatbox'));
  }

  function _genericModalVisible() {
    // 通用弹出面板检测：只算真正的模态弹窗（设置弹窗、风筝弹窗等）。
    // 【2026-09 修正】#ftPanel（文件树）/ #taskPanel（任务面板）是常驻侧边面板，
    // 之前把它们也算"弹窗"导致只要面板开着所有对话就被锁——按用户要求移除。
    var els = document.querySelectorAll('.overlay.show, .modal.show, .kite-modal');
    if (!els.length) return false; // 快速路径：无候选元素则不做 getComputedStyle（避免强制回流）
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      if (!el.offsetParent && cs.position !== 'fixed') continue;
      return true;
    }
    return false;
  }

  function _apply() {
    var locked = _refs.length > 0 || _genericModalVisible();
    document.body.classList.toggle('node-modal-lock', locked);

    // 【2026-09 按用户要求】不再禁用对话框的任何元素（textarea/按钮保持可用），
    // 只由下方捕获阶段的点击守卫拦住"发送/上传/语音"等按钮点击；
    // 键盘输入不拦截，输入框可正常聚焦打字。

    // 兜底：锁定期间捕获阶段拦截输入行的按钮点击
    if (locked && !_bindGuard) {
      _bindGuard = true;
      document.addEventListener('click', _guardClick, true);
    } else if (!locked && _bindGuard) {
      _bindGuard = false;
      document.removeEventListener('click', _guardClick, true);
    }
  }

  var _bindGuard = false;
  function _inLockedChatbox(t) {
    if (!t || !t.closest) return null;
    var box = t.closest('.chatbox');
    if (!box) return null;
    // 只拦输入行里的按钮点击；textarea 的点击/聚焦放行，打字不受影响
    if (t.closest('.chatbox-inputrow textarea')) return null;
    if (t.closest('.chatbox-inputrow')) return box;
    return null;
  }
  function _guardClick(e) {
    var box = _inLockedChatbox(e.target);
    if (box) { e.preventDefault(); e.stopPropagation(); }
  }

  window.CanvasNodeLock = {
    /** 节点 add() 时调用：node 传 { id, el } */
    register: function (ref) {
      if (ref && _refs.indexOf(ref) < 0) _refs.push(ref);
      _apply();
    },
    /** 节点 remove() 时调用（按 id 匹配，支持传新对象） */
    unregister: function (ref) {
      if (!ref) return;
      _refs = _refs.filter(function (r) { return r.id !== ref.id; });
      _apply();
    },
    /** 兼容入口：直接按当前已注册节点重算 */
    update: function () { _refs = _refs.filter(function (r) { return r && r.el && r.el.isConnected !== false; }); _apply(); },
    isLocked: function () { return _refs.length > 0; },
    refs: function () { return _refs.slice(); }
  };

  // chatbox 是动态创建的：DOM 结构变化时对新增 chatbox 生效；
  // 面板开/关（class/style 变化）由 500ms 低频轮询兜底，不监听属性变化（减少全页 observer 开销）
  // 【2026-09 性能优化】旧实现 500ms 全页轮询直接 _apply() -> getComputedStyle 强制回流，画布掉帧主因。
  // 改为：rAF 合并去抖 + 属性窄化监听 + 轮询放宽到 2s。
  var _pendingApply = false;
  function _scheduleApply() {
    if (_pendingApply) return;
    _pendingApply = true;
    requestAnimationFrame(function () { _pendingApply = false; _apply(); });
  }
  function _watchChatboxes() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(_scheduleApply);
    // 【2026-09 性能优化】只监听 class 属性：style 属性变化（画布平移/流式吐字）每帧都发生，
    // 是 Forced reflow 的主要触发源；弹窗显隐都靠 .show class 切换，监听 class 已足够。
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
    setInterval(_scheduleApply, 3000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _watchChatboxes);
  } else {
    _watchChatboxes();
  }
})();
