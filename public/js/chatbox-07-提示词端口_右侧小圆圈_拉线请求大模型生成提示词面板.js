// ==== 对话框右侧提示词小圆圈：拉线 → 在松开点创建「✎ 提示词」节点 → 调大模型生成提示词并回填 ====
(function () {
  'use strict';
  function boot() {
    if (!(window.App && typeof App.bindChatBox === 'function')) {
      setTimeout(boot, 50); return;
    }
    var _origBind = App.bindChatBox;
    App.bindChatBox = function (box, chat) {
      var r = _origBind.apply(this, arguments);
      try { _bindPromptPort(box, chat); } catch (e) { console.warn('[PromptPort]', e); }
      return r;
    };
  }

  function _bindPromptPort(box, chat) {
    if (!box || !chat || box.querySelector('.cbx-prompt-port')) return;
    var port = document.createElement('div');
    port.className = 'cbx-prompt-port';
    port.title = '拉线生成提示词面板（松开即在画布生成 ✎ 提示词节点，由大模型根据对话历史提炼）';
    port.style.cssText = 'position:absolute;right:-9px;top:50%;transform:translateY(-50%);width:16px;height:16px;'
      + 'border-radius:50%;background:linear-gradient(135deg,#7c6cff,#4ecdc4);border:2px solid rgba(255,255,255,.85);'
      + 'box-shadow:0 0 8px rgba(124,108,255,.55);cursor:crosshair;z-index:60;opacity:0;transition:opacity .15s;';
    // hover 对话框时显示
    var el = chat.el || box;
    el.addEventListener('mouseenter', function () { port.style.opacity = '1'; });
    el.addEventListener('mouseleave', function () {
      if (!port.classList.contains('dragging')) port.style.opacity = '0';
    });

    // 取对话上下文最近几条（兼容多模态 content 数组），作为生成提示词的素材
    function buildHistory() {
      try {
        return (chat.history || []).slice(-6).map(function (h) {
          var c = h && h.content;
          if (Array.isArray(c)) {
            c = c.map(function (p) { return (p && p.text) ? p.text : ''; }).join(' ');
          }
          return { role: (h && h.role) || 'user', content: String(c || '').slice(0, 500) };
        }).filter(function (m) { return m.content; });
      } catch (e) { return []; }
    }

    // 拉线 → 松开 → 创建提示词节点（先生成中占位）→ 异步请求大模型 → 回写节点
    function onRelease(portCenter, canvasPos, vp) {
      try {
        if (!window.KiteCanvas || typeof KiteCanvas.addTextNode !== 'function') {
          console.warn('[PromptPort] 画布模块(KiteCanvas)不可用');
          return;
        }
        var hist = buildHistory();
        // 有历史时显示生成中占位；无历史直接给兜底文案
        var node = KiteCanvas.addTextNode({
          text: hist.length ? '⏳ 正在根据对话历史生成提示词…' : '',
          x: canvasPos ? canvasPos.x : undefined,
          y: canvasPos ? canvasPos.y : undefined
        });

        if (!hist.length) return; // 新对话无可提炼内容，留空由用户手写

        fetch('/api/prompt-gen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ history: hist })
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (!node || !KiteCanvas.list().some(function (n) { return n.id === node.id; })) return; // 节点已被删
          var ta = node.el.querySelector('.kite-textarea');
          if (!ta) return;
          if (data && data.ok && data.prompt) {
            ta.value = data.prompt;
            ta.dispatchEvent(new Event('input', { bubbles: true })); // 同步 node.text + 自适应高度
          } else {
            ta.value = '⚠️ 提示词生成失败：' + ((data && data.error) || '未知错误');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }).catch(function (err) {
          console.warn('[PromptPort]', err);
          if (node && node.el) {
            var ta2 = node.el.querySelector('.kite-textarea');
            if (ta2) { ta2.value = '⚠️ 提示词生成失败：' + err.message; ta2.dispatchEvent(new Event('input', { bubbles: true })); }
          }
        });
      } catch (e) { console.warn('[PromptPort]', e); }
    }

    if (window.KitePortLink && typeof KitePortLink.bind === 'function') {
      KitePortLink.bind(port, onRelease);
    } else {
      port.addEventListener('mousedown', function (e) { e.preventDefault(); onRelease(null, null, { x: e.clientX, y: e.clientY }); });
    }
    box.appendChild(port);
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
