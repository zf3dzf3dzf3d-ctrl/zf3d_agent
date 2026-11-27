
/* 自研对话框 shim 已抽取至公共 zf-dialog-shim.js（S4 去重 2026-11-22），本文件不再重复注入 */

/* ============================================================
 * app-canvas-more-menu.js - 顶栏「更多」整合下拉按钮
 * 把游戏引擎 🎮 / 内置浏览器 🖥 / 演示 PPT 📽 三个顶栏入口
 * 收进一个「⋯ 更多」下拉菜单，节省顶栏宽度。
 * 右键菜单入口不受影响。挂 window.CanvasMoreMenu
 * ============================================================ */
(function () {
  'use strict';

  var ITEMS = [
    { icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>', label: 'i朱峰社区', title: '访问朱峰社区网站', click: 'zf3dSiteBtn', sysReg: 1 },
    { icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r="0.5"/><circle cx="9" cy="6.5" r="0.5"/><path d="M7 13l3 2.5-3 2.5"/><path d="M12 18h5"/></svg>', label: 'i指挥台', title: '打开智能体 OS 指挥台（宏面板 / Python 工作台，等同 ` 热键）', run: function () { var cp = window.CommandPalette; if (cp && cp.toggle) { cp.toggle(true); } else if (window.showToast) { showToast('指挥台模块尚未加载完成', 'warn'); } }, sysReg: 1 },
    { icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-.8 2-1.7 0-1.4-1.3-1.6-1.3-2.8 0-1 .8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.5-4-8-9-8z"/><circle cx="8" cy="10" r="0.8"/><circle cx="12" cy="7.5" r="0.8"/><circle cx="16" cy="10" r="0.8"/></svg>', label: 'i界面', title: '切换界面主题风格', click: 'themeBtn', sysReg: 1 },
    { icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h8M8 3v2M10.5 5c-.8 3.5-3 6.5-6.5 8.5M6 7.5c1.5 3 4 5.5 7 6.8"/><path d="M13.5 20l3.8-9 3.8 9M14.8 17.2h5"/></svg>', label: 'i语言', title: '循环切换界面语言（中/EN/日/韩/德）', click: 'languageToggle', toggle: 'lang', sysReg: 1 },
    { icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/></svg>', label: 'i等级', title: '查看养成面板（等级·成就）', run: function () { var NS = window.__KiteNS; if (NS && NS.growthPanel) NS.growthPanel.open(); }, sysReg: 1 },
    { icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 1 1 .6-8.96A6 6 0 0 1 19.3 10.5 4 4 0 0 1 18 18H7z"/></svg>', label: 'i管家', title: 'i管家：健康师/工作日志师/游戏导师/长期导师/理财专家，长期记忆随聊随记', run: function () {
      var bp = window.ButlerPanel; if (!bp || !bp.open) { window.showToast && showToast('管家团模块尚未加载完成', 'warn'); return; }
      bp.open(document.getElementById('topbarMoreBtn'));
    }, sysReg: 1 },
    /* 【2026-11-17】朗读助手/关于我们入口已移除：朗读默认开启；「关于」保留在设置面板内 */

  ];

  var _menu = null;

  /* 刷新菜单内开关型条目的状态徽标（语言：中文/EN）；tts 段已随入口移除清理 */
  function refreshStates() {
    if (!_menu) return;
    var langEl = _menu.querySelector('[data-state="lang"]');
    if (langEl) {
      var lg = 'zh';
      try { if (window.getLang) lg = getLang(); else lg = localStorage.getItem('appLang') || 'zh'; } catch (e) {}
      var LANG_NAMES = { zh: '中文', en: 'EN', ja: '日本語', ko: '한국어', de: 'Deutsch' };
      langEl.classList.toggle('on', lg !== 'zh');
      langEl.title = '当前语言：' + (LANG_NAMES[lg] || lg) + '（点击切换下一语言）';
    }
  }

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
      var stateSpan = '';
      if (it.toggle === 'lang') stateSpan = ' <span class="tk-dot" data-state="lang" style="margin-left:auto;"></span>';
      var _lbl = it.label; try { if (window.I18N && I18N.t && window.getLang && getLang() !== 'zh') _lbl = I18N.t(it.label); } catch (e) {}
      if (it.title) { try { if (window.I18N && I18N.t && window.getLang && getLang() !== 'zh') row.title = I18N.t(it.title); else row.title = it.title; } catch (e) { row.title = it.title; } }
      if (it.danger) row.style.color = '#ef4444';
      var _ic = it.icon || '';
      row.innerHTML = (_ic.indexOf('<svg') === 0
        ? '<span style="display:inline-flex;align-items:center;">' + _ic + '</span>'
        : '<span style="font-size:15px">' + _ic + '</span>') + '<span>' + _lbl + '</span>' + stateSpan;
      row.addEventListener('mouseenter', function () { row.style.background = '#2a323f'; });
      row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });
      row.addEventListener('click', function (ev) {
        ev.stopPropagation(); /* 防止冒泡触发 document 级全局关闭逻辑（如主题面板外部点击关闭） */
        if (it.click) {
          var el = document.getElementById(it.click);
          /* 语言切换：开关型，点击后菜单保持打开，实时刷新状态显示 */
          if (it.click === 'languageToggle') {
            /* 切换语言：弹出语种点选列表（列表来自 i18n.LANGS，点击即热切换） */
            var done2 = false;
            try {
              var i18n = window.I18N;
              if (i18n && i18n.setLang && i18n.getLang && i18n.LANGS) {
                closeMenu();
                showLangPicker(i18n, anchor); done2 = true;
              }
              else if (window.setLang && window.getLang) { setLang(getLang() === 'zh' ? 'en' : 'zh'); done2 = true; }
              else if (localStorage) { /* 兜底：直接写偏好并刷新，让 init 时按新语言渲染 */
                var cur = localStorage.getItem('appLang') || 'zh';
                localStorage.setItem('appLang', cur === 'zh' ? 'en' : 'zh');
                closeMenu(); location.reload(); return;
              }
            } catch (e) { console.error('[更多菜单] 语言切换失败:', e); }
            if (done2) { refreshStates(); return; }
            closeMenu();
            _dlgAlert('语言模块尚未加载完成，请刷新页面后重试（Ctrl+F5 强制刷新）');
          } else {
            closeMenu();
            if (el) el.click();
            else if (it.run) it.run();
          }
        } else {
          closeMenu();
          if (it.run) it.run();
        }
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
    refreshStates(); /* 打开菜单时显示当前开关状态 */
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

  window.CanvasMoreMenu = { open: openMenu, close: closeMenu,
    /* 2026-11-14 顶栏收编：暴露菜单项列表给 i无限面板 i功能 分区复用 */
    items: ITEMS,
    pickLang: function (anchorEl) { try { showLangPicker(window.I18N, anchorEl); } catch (e) { if (window.setLang && window.getLang) setLang(getLang() === 'zh' ? 'en' : 'zh'); } }
  };
})();


  /* ---------- 语言点选器：弹出 5 语种列表供直接选择 ---------- */
  function showLangPicker(i18n, anchor) {
    var old = document.getElementById('zfLangPicker');
    if (old) old.remove();
    var LANG_NAMES = { zh: '中文', zht: '繁體中文', en: 'English', ja: '日本語', ko: '한국어', de: 'Deutsch', ar: 'العربية', hi: 'हिन्दी', es: 'Español', fr: 'Français', ru: 'Русский' };
    var cur = i18n.getLang();
    var box = document.createElement('div');
    box.id = 'zfLangPicker';
    box.style.cssText = 'position:fixed;z-index:99999;background:#1e2230;border:1px solid #3a4157;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:6px;min-width:160px;max-height:70vh;overflow:auto;';
    (i18n.LANGS || []).forEach(function (l) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 14px;border-radius:5px;cursor:pointer;font-size:13px;color:#dfe4f2;display:flex;justify-content:space-between;align-items:center;';
      /* 国旗用项目 CSS 手绘国旗（.i18n-flag f-<code>），避免 Windows 不渲染 emoji 国旗降级成 CN/US/JP 字母 */
      var flagHtml = '<i class="i18n-flag f-' + l.code + '" aria-hidden="true" style="margin-right:8px;"></i>';
      item.innerHTML = '<span style="display:inline-flex;align-items:center;">' + flagHtml + (l.label || LANG_NAMES[l.code] || l.code) + '</span>' + (l.code === cur ? '<span style="color:#5ee08a;">✓</span>' : '');
      item.onmouseenter = function () { item.style.background = '#2a3050'; };
      item.onmouseleave = function () { item.style.background = 'transparent'; };
      item.onclick = function () {
        i18n.setLang(l.code);
        box.remove();
        document.removeEventListener('click', onDoc, true);
      };
      box.appendChild(item);
    });
    document.body.appendChild(box);
    var btn = anchor || document.getElementById('topbarMoreBtn') || document.getElementById('btnCanvasMore');
    var r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth / 2 - 75, bottom: 60 };
    /* 【2026-11-23 修复】锚点被隐藏（顶栏按钮 display:none → rect 全零）时不得钉在左上角：
       顶栏入口收编进 i桌面 后 topbarMoreBtn 常态隐藏，原逻辑把语种选择器弹到 (0,6) 屏幕角落。
       全零 rect 一律回退屏幕中上居中，保证选择器任何入口都可见。 */
    if (!r || (!r.width && !r.height && !r.left && !r.top)) {
      r = { left: window.innerWidth / 2 - 75, bottom: 60 };
    }
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 170)) + 'px';
    box.style.top = (r.bottom + 6) + 'px';
    function onDoc(e) { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('click', onDoc, true); } }
    setTimeout(function () { document.addEventListener('click', onDoc, true); }, 0);
  }
