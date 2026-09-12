/* ============================================================
 * app-canvas-more-menu.js - 顶栏「更多」整合下拉按钮
 * 把游戏引擎 🎮 / 内置浏览器 🖥 / 演示 PPT 📽 三个顶栏入口
 * 收进一个「⋯ 更多」下拉菜单，节省顶栏宽度。
 * 右键菜单入口不受影响。挂 window.CanvasMoreMenu
 * ============================================================ */
(function () {
  'use strict';

  var ITEMS = [
    { icon: '🔊', label: '朗读助手', title: '朗读助手：左键开关，右键设置音量/字数', click: 'ttsToggle' },
    { icon: 'EN', label: '切换语言', title: '切换语言', click: 'languageToggle' },
    { icon: '🌐', label: '朱峰社区网站', title: '访问朱峰社区网站', click: 'zf3dSiteBtn' },
    { icon: '❤', label: '关于我们', title: '关于', click: 'aboutBtn' },
    { icon: '🎨', label: '主题设置', title: '主题设置', click: 'themeBtn' },
    { sep: true },
    { icon: '🎮', label: '游戏引擎', title: '在画布上打开游戏引擎节点', run: function () { try { window.EngineNode && EngineNode.add(); } catch (e) {} } },
    { icon: '🖥', label: '内置浏览器', title: '在画布上打开内置浏览器节点', run: function () { try { window.BrowserNode && BrowserNode.add(); } catch (e) {} } },
    { icon: '📽', label: '演示 PPT', title: '在画布上打开 HTML 演示节点', run: function () { try { window.PresNode && PresNode.add(); } catch (e) {} } },
    { icon: '🎬', label: '视频剪辑', title: '在画布上打开 AI 视频剪辑工作台', run: function () { try { window.VideoNode && VideoNode.add(); } catch (e) {} } }
  ];

  var _menu = null;

  function closeMenu() {
    if (_menu && _menu.parentNode) _menu.parentNode.removeChild(_menu);
    _menu = null;
    document.removeEventListener('mousedown', _kill, true);
  }
  function _kill(ev) {
    if (_menu && _menu.contains(ev.target)) return;
    closeMenu();
  }

  function openMenu(anchor) {
    if (_menu) { closeMenu(); return; }
    var m = document.createElement('div');
    m.id = 'canvasMoreMenu';
    m.style.cssText =
      'position:fixed;z-index:12000;min-width:150px;background:#1c222b;border:1px solid #3a4150;' +
      'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:4px;display:none;';
    ITEMS.forEach(function (it) {
      if (it.sep) {
        var sep = document.createElement('div');
        sep.style.cssText = 'height:1px;margin:4px 8px;background:#3a4150;';
        m.appendChild(sep);
        return;
      }
      var row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;' +
        'font-size:13px;color:#d7dde6;white-space:nowrap;';
      row.innerHTML = '<span style="font-size:15px">' + it.icon + '</span><span>' + it.label + '</span>';
      row.addEventListener('mouseenter', function () { row.style.background = '#2a323f'; });
      row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });
      row.addEventListener('click', function (ev) {
        ev.stopPropagation(); /* 防止冒泡触发 document 级全局关闭逻辑（如主题面板外部点击关闭） */
        closeMenu();
        if (it.click) {
          var el = document.getElementById(it.click);
          /* 朗读助手/语言切换：直接调用全局函数，避免依赖隐藏按钮与加载时序 */
          if (it.click === 'ttsToggle') {
            var done1 = false;
            if (window.TTS && TTS.toggle) { try { TTS.toggle(); done1 = true; } catch (e) { console.error('[更多菜单] 朗读助手开关失败:', e); } }
            if (!done1) { var b1 = document.getElementById('ttsToggle'); if (b1) { b1.click(); done1 = true; } }
            if (!done1) alert('朗读助手模块尚未加载完成，请刷新页面后重试（Ctrl+F5 强制刷新）');
          } else if (it.click === 'languageToggle') {
            var done2 = false;
            if (window.setLang && window.getLang) { try { setLang(getLang() === 'zh' ? 'en' : 'zh'); done2 = true; } catch (e) { console.error('[更多菜单] 语言切换失败:', e); } }
            if (!done2) { var b2 = document.getElementById('languageToggle'); if (b2) { b2.click(); done2 = true; } }
            if (!done2) alert('语言模块尚未加载完成，请刷新页面后重试（Ctrl+F5 强制刷新）');
          } else if (el) el.click();
          else if (it.run) it.run();
        } else if (it.run) it.run();
      });
      m.appendChild(row);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 6;
    var left = Math.min(r.left, window.innerWidth - 170);
    m.style.top = top + 'px';
    m.style.left = left + 'px';
    m.style.display = 'block';
    _menu = m;
    setTimeout(function () { document.addEventListener('mousedown', _kill, true); }, 50);
  }

  /* ---------- 顶栏按钮 ---------- */
  function injectToolbarButton() {
    // 顶栏已有静态「⋯」按钮（topbarMoreBtn），直接绑定即可，不再动态注入
    var btn = document.getElementById('topbarMoreBtn') || document.getElementById('btnCanvasMore');
    if (!btn) return;
    if (btn.dataset.moreMenuBound) return;
    btn.dataset.moreMenuBound = '1';
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); openMenu(btn); });
  }

  function boot(retries) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      injectToolbarButton();
      return;
    }
    if ((retries || 0) < 40) setTimeout(function () { boot((retries || 0) + 1); }, 500);
  }
  boot();

  window.CanvasMoreMenu = { open: openMenu, close: closeMenu };
})();
