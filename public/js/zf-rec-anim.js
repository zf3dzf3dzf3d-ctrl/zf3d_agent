/* ===== 【2026-11-21 用户要求】i录音 / i录像 动态状态（极简小圈版） =====
   由 zf-app-dock.js 末尾动态加载。
   图标本身不带颜色；仅录制中在右上角显示一个小圈（呼吸动画），
   停止瞬间小圈短暂闪绿一次确认。 */
(function () {
  var css = [
    '/* 录制中：右上角小圈（中性色，不染图标） */',
    '.zf-panel-flat-item.zf-rec-active,.zf-panel-flat-item.zf-sr-active{position:relative;}',
    '.zf-panel-flat-item.zf-rec-active::after,.zf-panel-flat-item.zf-sr-active::after{',
    '  content:\'\';position:absolute;top:5px;right:5px;width:9px;height:9px;border-radius:50%;',
    '  border:2px solid currentColor;opacity:.85;animation:zfRecRing 1.4s ease-in-out infinite;}',
    '@keyframes zfRecRing{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(.7);opacity:.35}}',
    '/* 停止瞬间：小圈闪绿一次 */',
    '.zf-panel-flat-item.zf-rec-done::after,.zf-panel-flat-item.zf-sr-done::after{',
    '  content:\'\';position:absolute;top:5px;right:5px;width:9px;height:9px;border-radius:50%;',
    '  border:2px solid #34c759;box-shadow:0 0 6px rgba(52,199,89,.8);animation:zfRecFade .9s ease-out forwards;}',
    '@keyframes zfRecFade{from{opacity:1}to{opacity:0;transform:scale(1.6)}}'
  ].join('\n');
  var st = document.createElement('style');
  st.id = 'zf-rec-anim-style';
  st.textContent = css;
  document.head.appendChild(st);

  function _findItem(name) {
    var items = document.querySelectorAll('.zf-panel-flat-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].textContent && items[i].textContent.indexOf(name) !== -1) return items[i];
    }
    return null;
  }
  function _flash(el, cls) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 950);
  }
  function _postJson(url) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  var _recOn = false, _srOn = false;
  function _poll() {
    Promise.all([_postJson('/api/record-status'), _postJson('/api/screenrecord-status')]).then(function (rs) {
      var rec = rs[0], sr = rs[1];
      var recNow = !!(rec && rec['录制中']);
      var srNow = !!(sr && sr['录制中']);
      if (_recOn && !recNow) _flash(_findItem('i录音'), 'zf-rec-done');
      if (_srOn && !srNow) _flash(_findItem('i录像'), 'zf-sr-done');
      _recOn = recNow; _srOn = srNow;
      var recEl = _findItem('i录音'), srEl = _findItem('i录像');
      if (recEl) recEl.classList.toggle('zf-rec-active', recNow);
      if (srEl) srEl.classList.toggle('zf-sr-active', srNow);
    });
  }
  setInterval(function () { try { _poll(); } catch (e) {} }, 2000);
  setTimeout(function () { try { _poll(); } catch (e) {} }, 600);
})();
