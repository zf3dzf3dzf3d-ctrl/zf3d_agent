/* 峰控助手 v32：移植 PC 对话系统消息交互（查看答案/上下箭头/复制/编辑/删除/重新生成/排队/粘贴卡片） */
(function(){
'use strict';
function $(id){return document.getElementById(id)}
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function hist(){try{return curSess().msgs||[]}catch(e){return window._hist||[]}}

/* ===== 1. 消息操作条：复制 / 编辑 / 删除（仅用户消息，默认隐藏，点击显示） ===== */
function addOps(bub, role, idx){
  if(role!=='user')return; /* AI 回复不挂操作条 */
  if(bub.querySelector('.msg-ops'))return;
  var ops=document.createElement('div');ops.className='msg-ops';ops.style.display='none';
  function mk(label,fn){var b=document.createElement('button');b.textContent=label;b.onclick=function(e){e.stopPropagation();fn(b)};ops.appendChild(b)}
  mk('📋 复制',function(b){
    var s=bub._srcText||bub.textContent||'';
    try{if(window.ZFBridge&&ZFBridge.clipboardCopy)ZFBridge.clipboardCopy(s);
    else if(navigator.clipboard)navigator.clipboard.writeText(s);
    else{var ta=document.createElement('textarea');ta.value=s;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}
    b.textContent='✓ 已复制';setTimeout(function(){b.textContent='📋 复制'},1200);
    if(window.pushLog)pushLog('t','已复制');
  }catch(e){if(window.pushLog)pushLog('e','复制失败:'+e.message)}});
  mk('✏️ 编辑',function(){startEdit(bub,idx)});
  mk('🗑 删除',function(){delMsg(idx)});
  /* 点击气泡切换显示操作条，点其他处隐藏 */
  bub.addEventListener('click',function(e){
    e.stopPropagation();
    document.querySelectorAll('.msg-ops').forEach(function(o){if(o!==ops)o.style.display='none'});
    ops.style.display=(ops.style.display==='none'?'flex':'none');
  });
  bub.appendChild(ops);
}
function delMsg(idx){
  var h=hist();if(idx<0||idx>=h.length)return;
  if(!window.confirm('删除这条消息及其之后的内容？'))return;
  h.splice(idx);persist();rerender();
}
function regen(idx){
  var h=hist();if(idx<0||idx>=h.length)return;
  // 取这条 AI 回复对应的上一条 user 提问原样重发，不改写不入历史
  var q=null;for(var i=idx-1;i>=0;i--){if(h[i].role==='user'){q=h[i].content;break}}
  if(!q)return;
  h.splice(idx);persist();rerender();
  var inp=$('inp');inp.value=q;
  var btn=$('send');if(btn)btn.click();
}
function startEdit(bub,idx){
  var h=hist();if(!h[idx])return;
  var old=h[idx].content;
  var ta=document.createElement('textarea');
  ta.value=old;ta.style.cssText='width:100%;min-height:60px;margin:4px 0;border-radius:8px;padding:6px;font-size:14px';
  var ok=document.createElement('button');ok.textContent='保存并重发';
  ok.style.cssText='margin-right:8px;padding:4px 10px;border-radius:8px;background:#2b6cb0;color:#fff;border:none';
  var cc=document.createElement('button');cc.textContent='取消';
  cc.style.cssText='padding:4px 10px;border-radius:8px;border:1px solid #666;background:transparent;color:#ccc';
  var wrap=document.createElement('div');wrap.appendChild(ta);wrap.appendChild(ok);wrap.appendChild(cc);
  bub.innerHTML='';bub.appendChild(wrap);
  cc.onclick=function(){rerender()};
  ok.onclick=function(){
    var nt=ta.value.trim();if(!nt){return}
    h.splice(idx);h.push({role:'user',content:nt});
    persist();rerender();
    var btn=$('send');if(btn)btn.click();
  };
}
/* ===== 2. 查看答案按钮（user 气泡上，跳到对应 AI 最终答案） ===== */
function addViewAnswer(bub, idx){
  if(bub.querySelector('.va-btn'))return;
  var h=hist(),ans=null;
  for(var i=idx+1;i<h.length;i++){if(h[i].role==='assistant'){ans=h[i];break}if(h[i].role==='user')break}
  if(!ans)return;
  var b=document.createElement('button');b.className='va-btn';b.innerHTML='📄 查看答案';
  b.onclick=function(){
    var bubbles=document.querySelectorAll('#chat .bub.ai,#chat .bub.assistant,[class*=bub]');
    var target=null;
    document.querySelectorAll('#chat > *').forEach(function(el,j){if(el._vaIdx===idx+1)target=el});
    if(target&&target.scrollIntoView){target.scrollIntoView({behavior:'smooth',block:'start'})}
  };
  bub.appendChild(b);
}
/* ===== 3. 上下箭头（在用户提问之间跳转） ===== */
function addFlipNav(){
  /* 一键到最下面：PC 同款悬浮圆钮，位于输入栏上方，离开底部时显示
     （放在 flipNav 守卫之前并自带守卫，函数被二次调用也不会漏建） */
  var bt=$('scrollBottomBtn');
  if(!bt){
    bt=document.createElement('button');bt.id='scrollBottomBtn';bt.textContent='▼';bt.title='一键到最下面';
    bt.onclick=function(){var chat=$('chat');if(chat){chat.scrollTo({top:chat.scrollHeight,behavior:'smooth'});setTimeout(function(){if(chat)chat.scrollTop=chat.scrollHeight},350)}};
    document.body.appendChild(bt);
  }
  if($('flipNav'))return;
  var nav=document.createElement('div');nav.id='flipNav';nav.className='flip-nav';
  var up=document.createElement('button');up.textContent='↑';up.title='上一个问题';
  var dn=document.createElement('button');dn.textContent='↓';dn.title='下一个问题';
  nav.appendChild(up);nav.appendChild(dn);document.body.appendChild(nav);
  /* 一键到最下面：PC 同款悬浮圆钮，位于输入栏上方，离开底部时显示 */
  var bt=document.createElement('button');bt.id='scrollBottomBtn';bt.textContent='▼';bt.title='一键到最下面';
  bt.onclick=function(){var chat=$('chat');if(chat){chat.scrollTo({top:chat.scrollHeight,behavior:'smooth'});setTimeout(function(){if(chat)chat.scrollTop=chat.scrollHeight},350)}};
  document.body.appendChild(bt);
  var chatEl=$('chat');
  if(chatEl){
    chatEl.addEventListener('scroll',function(){
      var atBottom=chatEl.scrollTop+chatEl.clientHeight>=chatEl.scrollHeight-40;
      bt.style.display=atBottom?'none':'flex';
    });
    /* 初始化即判定一次位置：刷新后恢复长对话不在底部时按钮也能正确显示 */
    bt.style.display=(chatEl.scrollTop+chatEl.clientHeight>=chatEl.scrollHeight-40)?'none':'flex';
  }
  var qs=[];var cur=-1;
  function collect(){
    qs=[];
    document.querySelectorAll('#chat > *').forEach(function(el){if(el._vaRole==='user')qs.push(el)});
    cur=qs.length-1;
  }
  function go(d){
    collect();if(!qs.length)return;
    cur=Math.max(0,Math.min(qs.length-1,cur+d));
    if(qs[cur]&&qs[cur].scrollIntoView)qs[cur].scrollIntoView({behavior:'smooth',block:'start'});
  }
  up.onclick=function(){go(-1)};dn.onclick=function(){go(1)};
}
/* ===== 4. 排队消息 + 粘贴卡片（输入框大段粘贴折叠） ===== */
var PASTE_LEN=200;
var _queue=[];
function renderQueue(){
  var old=$('queueList');if(old)old.remove();
  if(!_queue.length)return;
  var d=document.createElement('div');d.id='queueList';d.className='queue-list';
  d.innerHTML='<b>📨 排队中 ('+_queue.length+')</b>';
  _queue.forEach(function(q,i){
    var it=document.createElement('div');it.className='queue-item';
    var sp=document.createElement('span');sp.textContent=q.text.slice(0,30);
    var x=document.createElement('span');x.className='qx';x.textContent='✕';x.title='移除';
    x.onclick=function(){_queue.splice(i,1);renderQueue()};
    it.appendChild(sp);it.appendChild(x);d.appendChild(it);
  });
  var bar=$('bar');bar.parentNode.insertBefore(d,bar);
}
function hookSend(){
  var btn=$('send');
  if(btn&&!btn._qHook){
    btn._qHook=true;
    btn.addEventListener('click',function(){
      var inp=$('inp');
      // 发送中 → 排队
      if(window._sending||btn.disabled){
        var t=inp.value.trim();
        if(t){_queue.push({text:t});inp.value='';renderQueue();
          if(window.pushLog)pushLog('t','消息已排队 ('+_queue.length+')');}
      }
    },true);
    // 排队出队：轮询发送状态，空闲且队列非空则发出下一条
    setInterval(function(){
      if(_queue.length&&!window._sending&&!(btn.disabled)){
        var nx=_queue.shift();renderQueue();
        var inp=$('inp');inp.value=nx.text;
        setTimeout(function(){btn.click()},100);
      }
    },1500);
  }
}
function hookBubbles(){
  // 重渲染后给气泡挂操作 + 标记角色/索引（_srcText 由原长按逻辑维护）
  var h=hist();
  document.querySelectorAll('#chat > *').forEach(function(el,i){
    if(el._portDone)return;el._portDone=true;
    var isAI=el.classList.contains('ai')||(el.textContent&&el._srcText!==undefined&&i%2===1);
    el._vaRole=isAI?'assistant':'user';el._vaIdx=i;
    addOps(el,el._vaRole,i);
    if(el._vaRole==='user')addViewAnswer(el,i);
  });
  addFlipNav();
}
var _rt=null;
function watch(){
  var chat=$('chat');
  if(chat&&!chat._portWatch){
    chat._portWatch=true;
    new MutationObserver(function(){
      clearTimeout(_rt);_rt=setTimeout(hookBubbles,120);
    }).observe(chat,{childList:true,subtree:false});
  }
  hookSend();
}
function rerender(){
  // 重渲染当前会话（简单整建）
  var chat=$('chat');if(!chat)return;
  chat.innerHTML='';
  var h=hist();
  var FOLD=window.FOLD_LEN||600;
  h.forEach(function(m){
    var d=document.createElement('div');
    d.style.cssText='margin:8px 0;text-align:'+(m.role==='user'?'right':'left');
    var bub=document.createElement('div');
    bub.className='bub '+(m.role==='user'?'user':'ai');
    bub._srcText=m.content;
    var t=m.content||'';
    if(t.length>FOLD){bub.innerHTML=renderMD(t.slice(0,FOLD))+'<div class="fold-tip">(长按可展开)</div>';bub._folded=true}
    else bub.innerHTML=renderMD(t);
    d.appendChild(bub);chat.appendChild(d);
  });
  chat.scrollTop=chat.scrollHeight;
  hookBubbles();
}
if(typeof renderMD==='undefined'){window.renderMD=function(s){return esc(s).replace(/\n/g,'<br>')}}
document.addEventListener('click',function(){document.querySelectorAll('.msg-ops').forEach(function(o){o.style.display='none'})});
setTimeout(watch,600);
setTimeout(hookBubbles,800);
window._portRegen=regen;window._portRerender=rerender;
})();
