/* ============================================================
 * chatbox-role-trace.js —— 对话标题右侧「子对话痕迹徽章」
 *
 * 位置：标题右侧、工具按钮(🔧)左侧，形如 [标题] [策划2][审核1][总结] 🔧📜⚡—✕
 * 口径：该对话累计派出的各角色子对话数量（子窗关闭后数字不减，累计痕迹）。
 *
 * 原理：零侵入。每 2 秒扫描 App.chatBoxes 内各对话窗 el 上的源对话标记：
 *   策划师  el._isThinkerChat + el._thinkerSrcId
 *   审核员  el._isQcChat      + el._qcSrcId
 *   施工队  el._raceSrcId     + data-race-worktree 非 crew:// 开头（赛马）
 *   协作队  el._raceSrcId     + data-race-worktree 以 crew:// 开头
 *   总结师  el._isSummarizerChat + el._summarizerSrcId
 * 按子窗 id 去重（只记一次，刷新不重复计数），累计值存 localStorage zf_role_trace。
 * 渲染：在各对话头部 .header-actions 前插入/更新徽章 span，头被重建也能自动补回。
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFRoleTrace) return;

  var LS_KEY = 'zf_role_trace';
  var COLORS = {
    '策划': '#7e57c2',  /* 紫 */
    '审核': '#ef6c00',  /* 橙 */
    '施工': '#1e88e5',  /* 蓝 */
    '协作': '#00897b',  /* 青 */
    '总结': '#43a047'   /* 绿 */
  };

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {} }

  /* 从一个子对话 el 识别角色与源对话 id；返回 {role, srcId} 或 null */
  function detect(el) {
    try {
      if (!el) return null;
      if (el._isThinkerChat && el._thinkerSrcId != null) return { role: '策划', srcId: String(el._thinkerSrcId) };
      if (el._isQcChat && el._qcSrcId != null) return { role: '审核', srcId: String(el._qcSrcId) };
      if (el._isSummarizerChat && el._summarizerSrcId != null) return { role: '总结', srcId: String(el._summarizerSrcId) };
      if (el._raceSrcId != null) {
        var wt = '';
        try { wt = el.getAttribute('data-race-worktree') || ''; } catch (e) {}
        var isCrew = String(wt).indexOf('crew://') === 0;
        return { role: isCrew ? '协作' : '施工', srcId: String(el._raceSrcId) };
      }
    } catch (e) {}
    return null;
  }

  function boxIdOf(c) {
    try { return String(c.id || (c.el && c.el.id) || ''); } catch (e) { return ''; }
  }

  /* 扫描：把新出现的子窗计入其源对话的累计痕迹 */
  function scan() {
    var boxes = (window.App && App.chatBoxes) || [];
    if (!boxes.length) return;
    var data = load();
    var dirty = false;
    boxes.forEach(function (c) {
      var hit = detect(c && c.el);
      if (!hit) return;
      var bid = boxIdOf(c);
      if (!bid) return;
      var rec = data[hit.srcId];
      if (!rec) { rec = data[hit.srcId] = { counts: {}, seen: {} }; }
      if (!rec.counts) rec.counts = {};
      if (!rec.seen) rec.seen = {};
      if (!rec.seen[bid]) { rec.seen[bid] = 1; rec.counts[hit.role] = (rec.counts[hit.role] || 0) + 1; dirty = true; }
    });
    if (dirty) { save(data); renderAll(); }
  }

  /* 渲染某个对话头部的徽章（幂等：已有则原地更新） */
  function render(chat) {
    try {
      var el = chat && chat.el;
      if (!el || !el.isConnected) return;
      var actions = el.querySelector('.header-actions');
      if (!actions) return;
      var rec = load()[String(chat.id)];
      var counts = (rec && rec.counts) || {};
      var html = '';
      /* 【v2】徽章附状态：从审核/策划箭头模块读该源对话的箭头状态（取最后一条的实时状态） */
      var statusOf = {};
      try {
        var vp = (window.ZFVerifyArrow && ZFVerifyArrow.getPairs && ZFVerifyArrow.getPairs()) || [];
        vp.forEach(function (p) { if (String(p.srcId) === String(chat.id)) statusOf['审核'] = ({ pending: '审核中', reviewing: '复审中', revising: '待修改', modified: '修改完成', passed: '审核完毕', failed: '已失效' })[p.status] || '审核中'; });
      } catch (e) {}
      try {
        var tp = (window.ZFThinkerArrow && ZFThinkerArrow.getPairs && ZFThinkerArrow.getPairs()) || [];
        tp.forEach(function (p) { if (String(p.srcId) === String(chat.id)) statusOf['策划'] = ({ pending: '策划中', applied: '已回注', modified: '修改完成', done: '策划完毕', clarified: '已澄清' })[p.status] || '策划中'; });
      } catch (e) {}
      Object.keys(COLORS).forEach(function (role) {
        var n = counts[role] || 0;
        if (n <= 0) return;
        var label = role === '总结' ? '总结' : role + n;
        var stTxt = statusOf[role];
        if (stTxt) label += '·' + stTxt;
        var names = { '策划': '策划师', '审核': '审核员', '施工': '施工队', '协作': '协作队', '总结': '总结师' };
        html += '<span class="zf-role-trace-badge" style="display:inline-block;margin-left:4px;padding:0 6px;height:16px;line-height:16px;border-radius:8px;font-size:10px;font-weight:bold;color:#fff;background:' + COLORS[role] + ';opacity:.85;cursor:default;" title="本对话累计派出 ' + n + ' 个' + names[role] + '子对话' + (stTxt ? '（当前：' + stTxt + '）' : '') + '">' + label + '</span>';
      });
      var holder = el.querySelector('.zf-role-trace-holder');
      if (!html) { if (holder) holder.remove(); return; }
      if (!holder) {
        holder = document.createElement('span');
        holder.className = 'zf-role-trace-holder';
        holder.style.cssText = 'display:inline-flex;align-items:center;margin-left:6px;';
        actions.parentNode.insertBefore(holder, actions); /* 标题后、工具按钮前 */
      }
      if (holder.innerHTML !== html) holder.innerHTML = html;
    } catch (e) {}
  }

  function renderAll() {
    var boxes = (window.App && App.chatBoxes) || [];
    boxes.forEach(render);
  }

  /* 3 秒轮询：既做扫描（记新痕迹）也做渲染兜底（头部重建后自动补回） */
  function tick() {
    try { scan(); } catch (e) {}
    try { renderAll(); } catch (e) {}
  }

  window.ZFRoleTrace = { scan: scan, renderAll: renderAll, render: render };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 1000); });
  } else {
    setTimeout(tick, 1000);
  }
  setInterval(tick, 3000);
})();
