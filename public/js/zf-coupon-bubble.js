(function () {
  if (document.getElementById('zf-coupon-bubble')) return;
  var css = document.createElement('style');
  css.textContent = `
  #zf-coupon-bubble{
    position:fixed; left:18px; bottom:96px; z-index:99999;
    width:52px; height:52px; border-radius:50%;
    background:linear-gradient(135deg,#1a1d24,#262a33);
    border:1px solid rgba(120,150,200,.35);
    box-shadow:0 4px 14px rgba(0,0,0,.45);
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    cursor:pointer; user-select:none; text-decoration:none;
    animation:zfFloat 3s ease-in-out infinite alternate;
    font-family:inherit;
  }
  #zf-coupon-bubble .zf-inner{
    width:100%; height:100%; border-radius:50%;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    transition:transform .2s ease;
  }
  #zf-coupon-bubble:hover .zf-inner{
    transform:scale(1.1);
  }
  #zf-coupon-bubble:hover{
    box-shadow:0 6px 20px rgba(120,150,220,.35);
    animation-play-state:paused;
  }
  #zf-coupon-bubble .zf-icon{ font-size:22px; line-height:1; }
  #zf-coupon-bubble .zf-text{
    font-size:10px; color:#8fb4e8; margin-top:2px; font-weight:600; letter-spacing:.5px;
  }
  @keyframes zfFloat{
    from{ transform:translateY(0); }
    to{ transform:translateY(-10px); }
  }
  #zf-coupon-tip{
    position:fixed; left:18px; bottom:158px; z-index:100000;
    max-width:220px; padding:10px 14px;
    background:#1e222b; color:#c9d4e8;
    border:1px solid rgba(120,150,200,.3); border-radius:10px;
    box-shadow:0 4px 16px rgba(0,0,0,.5);
    font-size:12.5px; line-height:1.7;
    opacity:0; visibility:hidden; transform:translateY(6px);
    transition:all .25s ease;
    pointer-events:none;
  }
  #zf-coupon-tip.show{ opacity:1; visibility:visible; transform:translateY(0); pointer-events:auto; }
  #zf-coupon-tip .zf-tip-row{ display:flex; align-items:center; gap:10px; }
  #zf-coupon-claim{
    flex:none; padding:4px 12px; border:none; border-radius:14px;
    background:#3d6bd8; color:#fff; font-size:12px; cursor:pointer;
  }
  #zf-coupon-claim:hover{ background:#2f55ab; }
  `;
  document.head.appendChild(css);

  var a = document.createElement('a');
  a.id = 'zf-coupon-bubble';
  a.href = 'https://www.zf3d.com/aitoken.asp';
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = '<span class="zf-inner"><span class="zf-icon">🎫</span><span class="zf-text">10元券</span></span>';

  var tip = document.createElement('div');
  tip.id = 'zf-coupon-tip';
  tip.innerHTML = '<div class="zf-tip-row"><span>邮箱注册朱峰账户立刻领取免费十元优惠券，每日还有免费 token 赠送</span><button id="zf-coupon-claim" type="button">已领取</button></div>';

  var hideTimer;
  a.addEventListener('mouseenter', function () {
    clearTimeout(hideTimer);
    tip.classList.add('show');
  });
  a.addEventListener('mouseleave', function () {
    hideTimer = setTimeout(function () { tip.classList.remove('show'); }, 200);
  });
  tip.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
  tip.addEventListener('mouseleave', function () { tip.classList.remove('show'); });

  var claimBtn = tip.querySelector('#zf-coupon-claim');

  // 已领取状态双保险持久化：localStorage（同 origin 快路径）+ cookie（跨端口/清站点数据后仍保留）。
  // cookie 按 host 共享、不分端口：服务重启换端口导致 origin 变化时 localStorage 会丢，cookie 不丢。
  // 修复 bug：重启后十元券气泡重现、已领取状态丢失。
  function couponCookieSet() {
    try { document.cookie = 'zf_coupon_claimed=1; max-age=31536000; path=/; SameSite=Lax'; } catch (e) {}
  }
  function couponCookieGet() {
    try { return document.cookie.split(/;\s*/).indexOf('zf_coupon_claimed=1') !== -1; } catch (e) { return false; }
  }

  claimBtn.addEventListener('click', function () {
    // 已领取：收起提示条并永久隐藏气泡（本浏览器持久记住：重启/换端口/清缓存都不再出现）
    tip.classList.remove('show');
    try { localStorage.setItem('zf_coupon_claimed_v2', '1'); } catch (e) {}
    couponCookieSet();
    if (a.parentNode) a.parentNode.removeChild(a);
  });

  function show() {
    document.body.appendChild(tip);
    document.body.appendChild(a);
  }

  function init() {
    // 本浏览器手动点过"已领取"则不再显示（localStorage 或 cookie 任一命中即隐藏）
    var claimed = null;
    try { claimed = localStorage.getItem('zf_coupon_claimed_v2'); } catch (e) {}
    if (claimed === '1' || couponCookieGet()) return;

    // 查询右上角同源登录状态：已登录朱峰账户说明已注册/领取过，不再显示
    try {
      fetch('/api/zf3d/status', { method: 'GET', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.logged_in) return; // 已登录，隐藏气泡
          show();
        })
        .catch(function () { show(); }); // 查询失败则默认显示
    } catch (e) { show(); }
  }
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
