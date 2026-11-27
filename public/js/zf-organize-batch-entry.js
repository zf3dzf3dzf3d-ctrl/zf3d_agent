/* =====================================================================
 * zf-organize-batch-entry.js  v3 【i缩小整理·右键呼出「批量问题」面板】
 * 用户令 2026-11-23（第2轮）：总览(缩小整理)态两个入口分工——
 *   左键双击空白 = 快速创建条（app-quick-create.js，app-quick-create 自带 dblclick 监听，本文件不管）
 *   右键空白     = 「📚 批量问题」面板（app-batch-questions.js 的 ZfBatchQuestions.open()，本文件负责）
 * 快速创建条（app-quick-create.js）零改动。
 *
 * 【为什么挂在 window 捕获】快速创建条在 document 捕获阶段监听 contextmenu
 * （其脚本先加载、监听器先注册，同层顺序无法反超）；捕获阶段 window 比
 * document 更早，这里 stopPropagation 即可让它根本收不到总览态右键，
 * 从而不动快速创建条任何一行代码。
 * 非总览态完全放行（正常模式右键行为一字不变）。
 * 批量问题面板本体挂 body 层 position:fixed 全屏遮罩，天然不随画布滚轮缩放。
 * =====================================================================
 */
(function () {
  'use strict';
  if (window.ZFOrgBatchEntry) return;
  window.ZFOrgBatchEntry = true;

  window.addEventListener('contextmenu', function (e) {
    if (!document.body.classList.contains('zf-overview-mode')) return; // 仅总览态接管
    if (window.__ovPanMoved) return;                                   // 右键拖动平移：不呼出（quick-create 同款标志）
    var t = e.target;
    var area = document.getElementById('canvasArea');
    var onBlank = !!(t && t.closest && area && area.contains(t) &&
      (!window.App || !App._isCanvasBlankTarget || App._isCanvasBlankTarget(t)));
    if (!onBlank) return;                                              // 对话框/面板/小地图上右键不抢
    e.preventDefault();                                                // 抑制系统菜单
    e.stopPropagation();                                               // 快速创建条的 document 监听收不到
    window.__ovPanMoved = false;
    try {
      if (window.ZfBatchQuestions && typeof ZfBatchQuestions.open === 'function') {
        ZfBatchQuestions.open();                                       // 无参=继承当前活动对话的模型/项目
      } else {
        console.warn('[总览右键批量] ZfBatchQuestions 未加载');
      }
    } catch (err) { console.warn('[总览右键批量] 打开失败', err); }
  }, true);
})();
