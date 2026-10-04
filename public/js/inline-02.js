
(function(){

  function ready(fn){if(document.readyState!=='loading')fn();else document.addEventListener('DOMContentLoaded',fn);}

  ready(function(){

    var panel=document.getElementById('themePanel'),h=document.getElementById('themePanelResizeCorner');

    if(!panel||!h)return;

    var sw,sh,sx,sy,act=false;

    h.addEventListener('pointerdown',function(e){act=true;var r=panel.getBoundingClientRect();sw=r.width;sh=r.height;sx=e.clientX;sy=e.clientY;h.setPointerCapture(e.pointerId);e.preventDefault();});

    h.addEventListener('pointermove',function(e){if(!act)return;panel.style.width=Math.max(260,Math.min(window.innerWidth*0.94,sw+(e.clientX-sx)))+'px';panel.style.height=Math.max(240,Math.min(window.innerHeight-40,sh+(e.clientY-sy)))+'px';});

    function end(){if(!act)return;act=false;try{var r=panel.getBoundingClientRect();localStorage.setItem('zf_themePanelGeo',JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top),free:panel.style.left!==''&&panel.style.left!=='auto'}));}catch(ex){}}

    h.addEventListener('pointerup',end);h.addEventListener('pointercancel',end);

  });

})();
