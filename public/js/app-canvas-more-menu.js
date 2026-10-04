
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  window.alert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

/* ============================================================
 * app-canvas-more-menu.js - 顶栏「更多」整合下拉按钮
 * 把游戏引擎 🎮 / 内置浏览器 🖥 / 演示 PPT 📽 三个顶栏入口
 * 收进一个「⋯ 更多」下拉菜单，节省顶栏宽度。
 * 右键菜单入口不受影响。挂 window.CanvasMoreMenu
 * ============================================================ */
(function () {
  'use strict';

  var ITEMS = [
    { icon: '🔊', label: '朗读助手', title: '朗读助手：左键开关，右键设置音量/字数', click: 'ttsToggle', toggle: 'tts' },
    { icon: '🌐', label: '朱峰社区网站', title: '访问朱峰社区网站', click: 'zf3dSiteBtn' },
    { icon: '❤', label: '关于我们', title: '关于', click: 'aboutBtn' },
    { sep: true },

  ];

  var _menu = null;

  /* 刷新菜单内开关型条目的状态徽标（朗读助手：开/关；语言：中文/EN） */
  function refreshStates() {
    if (!_menu) return;
    var ttsEl = _menu.querySelector('[data-state="tts"]');
    if (ttsEl) {
      var on = false;
      try { on = window.TTS && TTS.isEnabled ? TTS.isEnabled() : (localStorage.getItem('zfagent_tts_enabled') !== '0'); } catch (e) {}
      /* 小绿灯指示：绿=开，灰=关（与守卫/风筝一致） */
      ttsEl.classList.toggle('on', !!on);
      ttsEl.title = on ? '朗读助手已开启' : '朗读助手已关闭';
    }
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
      if (it.toggle === 'tts') stateSpan = ' <span class="tk-dot" data-state="tts" style="margin-left:auto;"></span>';
      if (it.toggle === 'lang') stateSpan = ' <span class="tk-dot" data-state="lang" style="margin-left:auto;"></span>';
      var _lbl = it.label; try { if (window.I18N && I18N.t && window.getLang && getLang() !== 'zh') _lbl = I18N.t(it.label); } catch (e) {}
      if (it.title) { try { if (window.I18N && I18N.t && window.getLang && getLang() !== 'zh') row.title = I18N.t(it.title); else row.title = it.title; } catch (e) { row.title = it.title; } }
      row.innerHTML = '<span style="font-size:15px">' + it.icon + '</span><span>' + _lbl + '</span>' + stateSpan;
      row.addEventListener('mouseenter', function () { row.style.background = '#2a323f'; });
      row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });
      row.addEventListener('click', function (ev) {
        ev.stopPropagation(); /* 防止冒泡触发 document 级全局关闭逻辑（如主题面板外部点击关闭） */
        if (it.click) {
          var el = document.getElementById(it.click);
          /* 朗读助手/语言切换：开关型，点击后菜单保持打开，实时刷新状态显示 */
          if (it.click === 'ttsToggle') {
            var done1 = false;
            if (window.TTS && TTS.toggle) { try { TTS.toggle(); done1 = true; } catch (e) { console.error('[更多菜单] 朗读助手开关失败:', e); } }
            if (!done1) { var b1 = document.getElementById('ttsToggle'); if (b1) { b1.click(); done1 = true; } }
            if (done1) { refreshStates(); return; }
            closeMenu();
            _dlgAlert('朗读助手模块尚未加载完成，请刷新页面后重试（Ctrl+F5 强制刷新）');
            var done2 = false;
            try {
              var i18n = window.I18N;
              if (i18n && i18n.setLang && i18n.getLang && i18n.LANGS) {
                /* 5 语言循环切换：zh → en → ja → ko → de → zh */
                /* 弹出 5 语种点选列表 */
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

  window.CanvasMoreMenu = { open: openMenu, close: closeMenu };
})();


  /* ---------- 语言点选器：弹出 5 语种列表供直接选择 ---------- */
  function showLangPicker(i18n, anchor) {
    var old = document.getElementById('zfLangPicker');
    if (old) old.remove();
    var LANG_NAMES = { zh: '中文', en: 'English', ja: '日本語', ko: '한국어', de: 'Deutsch' };
    var cur = i18n.getLang();
    var box = document.createElement('div');
    box.id = 'zfLangPicker';
    box.style.cssText = 'position:fixed;z-index:99999;background:#1e2230;border:1px solid #3a4157;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:6px;min-width:150px;';
    i18n.LANGS.forEach(function (l) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 14px;border-radius:5px;cursor:pointer;font-size:13px;color:#dfe4f2;display:flex;justify-content:space-between;align-items:center;';
      item.innerHTML = '<span>' + (LANG_NAMES[l.code] || l.code) + '</span>' + (l.code === cur ? '<span style="color:#5ee08a;">✓</span>' : '');
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
    box.style.left = Math.min(r.left, window.innerWidth - 170) + 'px';
    box.style.top = (r.bottom + 6) + 'px';
    function onDoc(e) { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('click', onDoc, true); } }
    setTimeout(function () { document.addEventListener('click', onDoc, true); }, 0);
  }
