/* ============================================================
 * app-kiteportlink.js - 统一端口拉线管线（独立文件）
 * 职责：所有「小圆圈端口 → 按下拉出一条宽3的贝塞尔预览线 →
 *       松开后在鼠标位置弹出对话框/面板」的交互统一走这里。
 * 全局挂在 window.KitePortLink：
 *   - KitePortLink.bezierPath(x1,y1,x2,y2)  贝塞尔路径工具
 *   - KitePortLink.bind(port, onRelease)    给端口绑定拉线交互
 *     onRelease(portCenter{x,y}, canvasPos{x,y}, viewportPos{x,y})
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 工具：SVG 贝塞尔曲线路径 ----------
  function bezierPath(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // ---------- 统一端口拉线 ----------
  function bindPortLinkDrag(port, onRelease) {
    port.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      port.classList.add('dragging');
      const host = (window.KiteCanvas && KiteCanvas.getHost && KiteCanvas.getHost())
        || document.getElementById('canvasContent')
        || document.body;
      const hr0 = host.getBoundingClientRect();
      const pr = port.getBoundingClientRect();
      const x1 = pr.left + pr.width / 2 - hr0.left, y1 = pr.top + pr.height / 2 - hr0.top;
      // 统一宽3的贝塞尔预览线（.kite-curve stroke-width:3）
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'kite-curve');
      const svg = document.getElementById('kiteCurveSvg') || host.querySelector('svg.kite-svg') || host.querySelector('svg');
      svg.appendChild(path);
      // 【优化】拖线预览用 rAF 节流；松开前每帧重算端口原点，面板/页面移动时预览线不脱节
      let _queued = false, _lastEv = null;
      const draw = () => {
        _queued = false;
        if (!_lastEv) return;
        const hrNow = host.getBoundingClientRect();
        const prNow = port.getBoundingClientRect();
        path.setAttribute('d', bezierPath(
          prNow.left + prNow.width / 2 - hrNow.left,
          prNow.top + prNow.height / 2 - hrNow.top,
          _lastEv.clientX - hrNow.left,
          _lastEv.clientY - hrNow.top));
      };
      const move = (ev) => {
        _lastEv = ev;
        if (_queued) return;
        _queued = true;
        requestAnimationFrame(draw);
      };
      const up = (ev) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        port.classList.remove('dragging');
        path.remove();
        onRelease(
          { x: x1, y: y1 },
          (() => { const hrNow = host.getBoundingClientRect(); return { x: ev.clientX - hrNow.left, y: ev.clientY - hrNow.top }; })(),
          { x: ev.clientX, y: ev.clientY }
        );
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  window.KitePortLink = { bezierPath, bind: bindPortLinkDrag };
})();
