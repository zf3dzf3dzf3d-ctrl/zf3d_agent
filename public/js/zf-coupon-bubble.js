(function () {
  if (document.getElementById('zf-coupon-bubble')) return;
  var css = document.createElement('style');
  css.textContent = `
  #zf-coupon-bubble{
    position:fixed; left:18px; bottom:96px; z-index:99999;
    width:52px; height:52px; border-radius:50%;
    background:linear-gradient(135deg,#fdf6ec,#fbe8d3);
    border:1px solid #e8c9a8;
    box-shadow:0 4px 14px rgba(180,140,90,.25);
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
    box-shadow:0 6px 20px rgba(180,140,90,.4);
    animation-play-state:paused;
  }
  #zf-coupon-bubble .zf-icon{ font-size:22px; line-height:1; }
  #zf-coupon-bubble .zf-text{
    font-size:10px; color:#a06a3a; margin-top:2px; font-weight:600; letter-spacing:.5px;
  }
  @keyframes zfFloat{
    from{ transform:translateY(0); }
    to{ transform:translateY(-10px); }
  }
  #zf-coupon-tip{
    position:fixed; left:18px; bottom:158px; z-index:100000;
    max-width:220px; padding:10px 14px;
    background:#fffdf8; color:#6b5240;
    border:1px solid #e8d5bd; border-radius:10px;
    box-shadow:0 4px 16px rgba(150,120,80,.18);
    font-size:12.5px; line-height:1.7;
    opacity:0; visibility:hidden; transform:translateY(6px);
    transition:all .25s ease;
    pointer-events:none;
  }
  #zf-coupon-tip.show{ opacity:1; visibility:visible; transform:translateY(0); pointer-events:auto; }
  #zf-coupon-tip .zf-tip-row{ display:flex; align-items:center; gap:10px; }
  #zf-coupon-claim{
    flex:none; padding:4px 12px; border:none; border-radius:14px;
    background:#a06a3a; color:#fff; font-size:12px; cursor:pointer;
  }
  #zf-coupon-claim:hover{ background:#8a5a30; }
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
  claimBtn.addEventListener('click', function () {
    // 已领取：收起提示条并永久隐藏气泡（每个浏览器只出现一次）
    tip.classList.remove('show');
    try { localStorage.setItem('zf_coupon_claimed_v2', '1'); } catch (e) {}
    if (a.parentNode) a.parentNode.removeChild(a);
  });

  function init() {
    // 本浏览器已领取过则不再显示；未领取过则展示一次
    var claimed = null;
    try { claimed = localStorage.getItem('zf_coupon_claimed_v2'); } catch (e) {}
    if (claimed === '1') return;
    document.body.appendChild(tip);
    document.body.appendChild(a);
  }
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
