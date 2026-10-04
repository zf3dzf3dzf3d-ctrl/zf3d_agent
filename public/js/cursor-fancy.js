/* 朱峰智能体 · 漂亮鼠标光标 v2
   依赖 css/cursor-fancy.css
   5 种模式（localStorage: zf_cursor_style）：
     off     原始鼠标（系统光标）
     glow    星辉光环（默认，蓝紫渐变光点 + 惯性光环 + 涟漪）
     neon    霓虹方环（青色霓虹 + 旋转方框）
     rainbow 彩虹拖尾（渐变色点 + 粒子拖尾）
     comet   彗星流光（金色彗核 + 长尾流光）
   提供 window.ZFCursor 供设置面板调用 */
(function(){
  'use strict';

  var STYLES = ['off','comet'];
  var KEY = 'zf_cursor_style';

  function get(){
    try {
      var v = localStorage.getItem(KEY);
      return STYLES.indexOf(v) >= 0 ? v : 'glow';
    } catch(e){ return 'glow'; }
  }
  function set(v){
    if (STYLES.indexOf(v) < 0) return;
    try { localStorage.setItem(KEY, v); } catch(e){}
    apply(v);
  }

  var booted = false, cleanupFns = [];

  function clearCursor(){
    cleanupFns.forEach(function(f){ try{ f(); }catch(e){} });
    cleanupFns = [];
    document.body.classList.remove('fancy-cursor','zf-cur-style-glow','zf-cur-style-neon','zf-cur-style-rainbow','zf-cur-style-comet');
    document.querySelectorAll('.zf-cursor-dot,.zf-cursor-ring,.zf-ripple,.zf-trail-p').forEach(function(el){ el.remove(); });
    booted = false;
  }

  function apply(style){
    if (booted) clearCursor();
    document.documentElement.classList.toggle('no-fancy-cursor-host', style !== 'off');
    if (style === 'off') return; // 原始鼠标：什么都不加
    document.body.classList.add('fancy-cursor', 'zf-cur-style-' + style);
    booted = true;

    var dot = document.createElement('div'); dot.className = 'zf-cursor-dot';
    var ring = document.createElement('div'); ring.className = 'zf-cursor-ring';
    document.body.appendChild(dot); document.body.appendChild(ring);

    var x = innerWidth/2, y = innerHeight/2, rx = x, ry = y;
    var visible = false;
    var lastT = 0, trailOn = (style === 'rainbow' || style === 'comet');

    function onMove(e){
      x = e.clientX; y = e.clientY;
      if (!visible){ rx = x; ry = y; visible = true; dot.style.opacity = 1; ring.style.opacity = 1; }
      var t = e.target;
      var clickable = t.closest && t.closest('button,a,[role=button],input,select,label,.clickable,summary');
      var textable = t.closest && t.closest('input[type=text],input[type=search],textarea,[contenteditable]');
      document.body.classList.toggle('zf-cur-hover', !!clickable);
      document.body.classList.toggle('zf-cur-text', !!textable && !clickable);
      if (trailOn){
        var now = performance.now();
        if (now - lastT > 24){
          lastT = now;
          var p = document.createElement('div');
          p.className = 'zf-trail-p';
          p.style.left = x + 'px'; p.style.top = y + 'px';
          document.body.appendChild(p);
          setTimeout(function(){ p.remove(); }, 700);
        }
      }
    }
    function onDown(){
      document.body.classList.add('zf-cur-down');
      var r = document.createElement('div'); r.className = 'zf-ripple';
      r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.appendChild(r);
      setTimeout(function(){ r.remove(); }, 550);
    }
    function onUp(){ document.body.classList.remove('zf-cur-down'); }
    function out(){ dot.style.opacity = 0; ring.style.opacity = 0; }
    function enter(){ dot.style.opacity = 1; ring.style.opacity = 1; }

    addEventListener('mousemove', onMove, { passive: true });
    addEventListener('mousedown', onDown);
    addEventListener('mouseup', onUp);
    document.addEventListener('mouseleave', out);
    document.addEventListener('mouseenter', enter);
    cleanupFns.push(function(){
      removeEventListener('mousemove', onMove);
      removeEventListener('mousedown', onDown);
      removeEventListener('mouseup', onUp);
      document.removeEventListener('mouseleave', out);
      document.removeEventListener('mouseenter', enter);
    });

    var followK = (style === 'comet') ? 0.22 : 0.16;
    (function loop(){
      rx += (x - rx) * followK; ry += (y - ry) * followK;
      dot.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)' +
        (document.body.classList.contains('zf-cur-hover') ? ' scale(1.55)' :
         document.body.classList.contains('zf-cur-down') ? ' scale(.8)' : '');
      requestAnimationFrame(loop);
    })();
  }

  function init(){
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return; // 触屏不启用
    apply(get());
  }

  window.ZFCursor = {
    styles: [
      { id: 'off',     name: '原始鼠标', icon: '⬆️', desc: '系统默认箭头' },
      { id: 'comet',   name: '流星', icon: '☄️', desc: '金色彗核 + 流光长尾' }
    ],
    get: get,
    set: set,
    render: function(containerId){
      var box = document.getElementById(containerId);
      if (!box) return;
      var cur = get();
      box.innerHTML = '';
      this.styles.forEach(function(s){
        var btn = document.createElement('button');
        btn.className = 'cursor-style-btn' + (cur === s.id ? ' active' : '');
        btn.title = s.desc;
        btn.innerHTML = '<span class="cursor-style-icon">' + s.icon + '</span><span class="cursor-style-name">' + s.name + '</span>';
        btn.onclick = function(){
          ZFCursor.set(s.id);
          box.querySelectorAll('.cursor-style-btn').forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
        };
        box.appendChild(btn);
      });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
