// ═══ 图片加工工具 v4 — 模块化适配版 ═══
let tool='move',scale=1,offsetX=0,offsetY=0;
let isDrawing=false,isPanning=false,lastX=0,lastY=0,panSX=0,panSY=0;
let imgW=0,imgH=0,imgPath=null;
let canvas=document.getElementById('mainCanvas'),ctx=canvas.getContext('2d');
let overlayCanvas=document.getElementById('overlayCanvas'),ovCtx=overlayCanvas.getContext('2d');
let viewport=document.getElementById('viewport');
let canvasBorder=document.getElementById('canvasBorder');
let maskCanvas=document.createElement('canvas'),maskCtx=maskCanvas.getContext('2d');
let hasMaskFlag=false;
let fgColor='#ff0000',bgColor='#000000';

// ── 图层 ──
let layers=[],activeLayerIdx=0;
function createLayer(name,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return{name:name||'图层'+(layers.length+1),canvas:c,ctx:c.getContext('2d'),visible:true,opacity:1.0,blend:'source-over',offsetX:0,offsetY:0};}
function getActiveLayer(){return layers[activeLayerIdx];}
function compositeLayers(){
  if(!imgW)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const l of layers){
    if(!l.visible)continue;
    ctx.globalAlpha=l.opacity;
    ctx.globalCompositeOperation=l.blend;
    ctx.drawImage(l.canvas,l.offsetX,l.offsetY);
  }
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(maskCanvas.width!==imgW){maskCanvas.width=imgW;maskCanvas.height=imgH;}
  drawOverlay();
}

function renderLayerList(){
  const list=document.getElementById('layerList');list.innerHTML='';
  for(let i=layers.length-1;i>=0;i--){
    const l=layers[i];const d=document.createElement('div');
    d.className='layer-item'+(i===activeLayerIdx?' active':'');
    d.draggable=true;d.dataset.idx=i;
    const th=document.createElement('canvas');th.width=28;th.height=28;
    th.getContext('2d').drawImage(l.canvas,0,0,28,28);d.appendChild(th);
    const n=document.createElement('span');n.className='ln';n.textContent=l.name;d.appendChild(n);
    const v=document.createElement('span');v.className='vis';v.textContent=l.visible?'👁':'🚫';
    v.onclick=e=>{e.stopPropagation();l.visible=!l.visible;compositeLayers();renderLayerList();};
    d.appendChild(v);
    d.onclick=()=>{activeLayerIdx=i;renderLayerList();syncLayerControls();};
    d.ondragstart=e=>e.dataTransfer.setData('text',i);
    d.ondragover=e=>e.preventDefault();
    d.ondrop=e=>{e.preventDefault();const from=parseInt(e.dataTransfer.getData('text')),to=i;
      if(from!==to){const item=layers.splice(from,1)[0];layers.splice(to,0,item);
        if(activeLayerIdx===from)activeLayerIdx=to;
        else if(from<activeLayerIdx&&to>=activeLayerIdx)activeLayerIdx--;
        else if(from>activeLayerIdx&&to<=activeLayerIdx)activeLayerIdx++;
        compositeLayers();renderLayerList();}};
    list.appendChild(d);
  }
}
function syncLayerControls(){const l=getActiveLayer();if(!l)return;document.getElementById('blendMode').value=l.blend;document.getElementById('layerOpacity').value=l.opacity*100;document.getElementById('loVal').textContent=Math.round(l.opacity*100);}
function onBlendChange(){const l=getActiveLayer();if(l){l.blend=document.getElementById('blendMode').value;compositeLayers();}}
function onLayerOpacity(){const l=getActiveLayer();if(l){l.opacity=parseInt(document.getElementById('layerOpacity').value)/100;document.getElementById('loVal').textContent=document.getElementById('layerOpacity').value;compositeLayers();}}
function addLayer(){if(!imgW)return;layers.push(createLayer(null,imgW,imgH));activeLayerIdx=layers.length-1;renderLayerList();syncLayerControls();}
function duplicateLayer(){if(!imgW)return;const l=getActiveLayer();const nl=createLayer(l.name+' 副本',imgW,imgH);nl.ctx.drawImage(l.canvas,0,0);layers.push(nl);activeLayerIdx=layers.length-1;renderLayerList();syncLayerControls();}
function deleteLayer(){if(layers.length<=1)return;layers.splice(activeLayerIdx,1);if(activeLayerIdx>=layers.length)activeLayerIdx=layers.length-1;compositeLayers();renderLayerList();syncLayerControls();}

// ── 选区状态 ──
let selRect=null,rectDrawing=false,selEllipse=false;
let lassoPath=[],lassoDrawing=false;
let wandMask=null;
let moveStartOX=0,moveStartOY=0;
let stampSrcCanvas=null,stampSrcX=0,stampSrcY=0;
let gradStart=null,gradDrawing=false;
let textPos=null;
let selectionMode='new'; // 'new'|'add'|'sub'

// ── 工具栏 ──
const TOOLS=[
  {id:'move',icon:'✋',name:'移动',key:'v',tip:'移动当前图层'},
  {id:'rect',icon:'▭',name:'矩形选区',key:'m',tip:'框选区域→双击取消'},
  {id:'ellipse',icon:'◯',name:'椭圆选区',key:'m',tip:'拖拽画椭圆选区'},
  {id:'lasso',icon:'✏',name:'套索',key:'l',tip:'自由手绘选区'},
  {id:'wand',icon:'🔮',name:'魔棒',key:'w',tip:'点击选择相似颜色区域'},
  {id:'crop',icon:'✂',name:'裁剪',key:'c',tip:'框选后自动裁剪'},
  {sep:1},
  {id:'brush',icon:'🖌',name:'画笔',key:'b',tip:'软笔刷 Alt=吸管 Ctrl+左键=调大小透明度'},
  {id:'pencil',icon:'✏',name:'铅笔',key:'n',tip:'方块硬边画笔'},
  {id:'eraser',icon:'🧽',name:'橡皮',key:'e',tip:'擦除当前层'},
  {id:'magicEraser',icon:'✨',name:'魔术橡皮',key:'e',tip:'点击擦除相似颜色区域'},
  {sep:1},
  {id:'stamp',icon:'🔖',name:'图章',key:'s',tip:'Alt+左键设源→左键复制绘制'},
  {id:'eyedropper',icon:'💧',name:'吸管',key:'i',tip:'拾取颜色'},
  {sep:1},
  {id:'gradient',icon:'🌈',name:'渐变',key:'g',tip:'选颜色拉直线渐变填充'},
  {id:'fill',icon:'🪣',name:'填充',key:'f',tip:'用前景色填充选区或全图'},
  {id:'text',icon:'📝',name:'文字',key:'t',tip:'点击输入文字'},
  {sep:1},
  {id:'blur',icon:'💨',name:'模糊',key:'r',tip:'模糊笔刷'},
  {id:'sharpen',icon:'🔪',name:'锐化',key:'r',tip:'锐化笔刷'},
  {id:'dodge',icon:'🔆',name:'加深减淡',key:'o',tip:'左键加深 Alt+左键减淡'},
  {id:'sponge',icon:'🧽',name:'海绵',key:'o',tip:'加色/去色'},
  {sep:1},
  {id:'inpaint',icon:'🧹',name:'去水印',key:'w',tip:'涂抹区域→点✨去除'},
  {id:'hand',icon:'🤚',name:'抓手',key:'h',tip:'拖拽平移视图'},
  {sep:1},
];
const BRUSH_TOOLS=['brush','eraser','stamp','blur','sharpen','dodge','sponge','inpaint'];
const SELECTION_TOOLS=['rect','ellipse','lasso','wand','crop'];

function initToolbar(){
  const bar=document.getElementById('leftbar');bar.innerHTML='';
  for(const t of TOOLS){
    if(t.sep){const s=document.createElement('div');s.className='sep';bar.appendChild(s);continue;}
    const b=document.createElement('button');b.id='tool-'+t.id;
    b.innerHTML=t.icon+'<span class="tip">'+t.name+': '+t.tip+'</span>';
    b.onclick=()=>setTool(t.id);bar.appendChild(b);
  }
}

function updateToolPanel(){
  // PS风格：只显示当前工具对应的选项组
  document.querySelectorAll('#optBar .opt-group').forEach(g=>{
    g.classList.toggle('show',g.dataset.tool===tool);
  });
}

function setTool(t){
  tool=t;document.querySelectorAll('.leftbar button').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('tool-'+t);if(btn)btn.classList.add('active');
  canvas.style.cursor=t==='move'?'grab':(t==='hand'?'grab':'crosshair');
  selEllipse=(t==='ellipse');
  // 选区持久化：切换工具不清除选区，只有选区工具自己操作时才修改
  if(t!=='inpaint'){maskCtx.clearRect(0,0,imgW||1,imgH||1);hasMaskFlag=false;}
  if(t!=='lasso'){lassoDrawing=false;}
  // 同步前景色到隐藏的fgColor
  syncFgColor();
  document.getElementById('adjustScope').textContent=(selRect||lassoPath.length>2||wandMask)?'（选区）':'（全图）';
  updateToolPanel();drawOverlay();
}

// ── 前景/背景色 ──
function syncFgColor(){
  const fi=document.getElementById('fgColorInput');
  if(fi) fgColor=fi.value;
  // 创建/更新隐藏的fgColor input供旧代码用
  let hidden=document.getElementById('fgColor');
  if(!hidden){hidden=document.createElement('input');hidden.type='hidden';hidden.id='fgColor';document.body.appendChild(hidden);}
  hidden.value=fgColor;
}
function syncBgColor(){
  const bi=document.getElementById('bgColorInput');
  if(bi) bgColor=bi.value;
}
function swapColors(){
  const fi=document.getElementById('fgColorInput'),bi=document.getElementById('bgColorInput');
  if(!fi||!bi)return;
  const tmp=fi.value;fi.value=bi.value;bi.value=tmp;
  fgColor=fi.value;bgColor=bi.value;syncFgColor();
}

// ── 图片加载 ──
function loadImage(){
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.onchange=e=>{const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();reader.onload=ev=>{const img=new Image();img.onload=()=>setImage(img,file.name);img.src=ev.target.result;};
    reader.readAsDataURL(file);};
  input.click();
}
function setImage(img,name){
  imgW=img.width;imgH=img.height;canvas.width=imgW;canvas.height=imgH;
  overlayCanvas.width=imgW;overlayCanvas.height=imgH;
  maskCanvas.width=imgW;maskCanvas.height=imgH;maskCtx.clearRect(0,0,imgW,imgH);hasMaskFlag=false;
  layers=[createLayer('背景',imgW,imgH)];layers[0].ctx.drawImage(img,0,0);activeLayerIdx=0;
  compositeLayers();history=[];historyIdx=-1;pushHistory();renderLayerList();syncLayerControls();
  requestAnimationFrame(()=>fitCanvas());
  document.getElementById('resizeW').value=imgW;document.getElementById('resizeH').value=imgH;
  document.getElementById('statusbar').textContent=name+' '+imgW+'×'+imgH;
  updateToolPanel();
}
function resetAll(){
  if(!history.length)return;
  const img=new Image();img.onload=()=>{
    layers=[createLayer('背景',imgW,imgH)];layers[0].ctx.drawImage(img,0,0);activeLayerIdx=0;
    maskCtx.clearRect(0,0,imgW,imgH);hasMaskFlag=false;selRect=null;lassoPath=[];wandMask=null;
    compositeLayers();renderLayerList();pushHistory();
  };img.src=history[0];
}

// ── 视图 ──
function applyTransform(){const t=`translate(${offsetX}px,${offsetY}px) scale(${scale})`;canvas.style.transform=t;overlayCanvas.style.transform=t;if(canvasBorder){canvasBorder.style.transform=t;canvasBorder.style.width=imgW+'px';canvasBorder.style.height=imgH+'px';}document.getElementById('zoomPill').textContent=Math.round(scale*100)+'%';}
function fitCanvas(){if(!imgW)return;const vw=viewport.clientWidth-20,vh=viewport.clientHeight-20;scale=Math.min(vw/imgW,vh/imgH,1);offsetX=(viewport.clientWidth-imgW*scale)/2;offsetY=(viewport.clientHeight-imgH*scale)/2;applyTransform();}
function setActual(){scale=1;offsetX=(viewport.clientWidth-imgW)/2;offsetY=(viewport.clientHeight-imgH)/2;applyTransform();}
function screenToCanvas(e){const r=viewport.getBoundingClientRect();return{x:(e.clientX-r.left-offsetX)/scale,y:(e.clientY-r.top-offsetY)/scale};}

// ── 鼠标交互 ──
viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;const ns=Math.max(0.05,Math.min(40,scale*(e.deltaY>0?0.9:1.1)));offsetX=mx-(mx-offsetX)*(ns/scale);offsetY=my-(my-offsetY)*(ns/scale);scale=ns;applyTransform();},{passive:false});

viewport.addEventListener('mousedown',e=>{
  if(!imgW)return;const p=screenToCanvas(e);
  // Alt+左键=吸管（任何工具）
  if(e.button===0&&e.altKey&&tool!=='stamp'&&tool!=='dodge'&&tool!=='sponge'){pickColor(p);return;}
  // Ctrl+左键=调笔刷
  if(e.button===0&&e.ctrlKey&&(BRUSH_TOOLS.includes(tool)||tool==='pencil')){
    isPanning=true;panSX=e.clientX;panSY=e.clientY;e.preventDefault();return;}
  // 中键/右键=平移
  if(e.button===1||e.button===2){isPanning=true;panSX=e.clientX;panSY=e.clientY;viewport.style.cursor='grabbing';e.preventDefault();return;}
  if(e.button!==0)return;

  // 图章：Alt+左键设源
  if(tool==='stamp'&&e.altKey){
    stampSrcX=p.x;stampSrcY=p.y;const sz=parseInt(document.getElementById('brushSize').value);
    const sx=Math.max(0,Math.floor(p.x-sz/2)),sy=Math.max(0,Math.floor(p.y-sz/2));
    const sw=Math.min(sz,imgW-sx),sh=Math.min(sz,imgH-sy);
    stampSrcCanvas=document.createElement('canvas');stampSrcCanvas.width=sw;stampSrcCanvas.height=sh;
    // 从合并图层取色
    const merged=getMergedCanvas();
    stampSrcCanvas.getContext('2d').drawImage(merged,sx,sy,sw,sh,0,0,sw,sh);
    document.getElementById('statusbar').textContent='图章源已设置 ('+Math.round(p.x)+','+Math.round(p.y)+')';
    return;
  }
  // 吸管
  if(tool==='eyedropper'){pickColor(p);return;}
  // 文字
  if(tool==='text'){const ti=document.getElementById('textInput');const r=viewport.getBoundingClientRect();
    ti.style.left=(e.clientX-r.left)+'px';ti.style.top=(e.clientY-r.top)+'px';
    ti.style.display='block';ti.value='';ti.focus();textPos=p;return;}
  // 选区工具：Ctrl+左键=加选 Alt+左键=减选
  const selMode=e.ctrlKey?'add':(e.altKey?'sub':'new');
  if(SELECTION_TOOLS.includes(tool)&&(tool!=='crop')){
    if(selMode==='new'){selRect=null;lassoPath=[];wandMask=null;}
    selectionMode=selMode;
  }
  // 套索
  if(tool==='lasso'){lassoDrawing=true;lassoPath=[{x:p.x,y:p.y}];return;}
  // 魔棒
  if(tool==='wand'){doWand(p.x,p.y,selMode);return;}
  // 魔术橡皮
  if(tool==='magicEraser'){doMagicEraser(p.x,p.y);return;}
  // 填充
  if(tool==='fill'){doFill();return;}
  // 抓手
  if(tool==='hand'){isPanning=true;panSX=e.clientX;panSY=e.clientY;viewport.style.cursor='grabbing';return;}
  // 框选/椭圆/裁剪
  if(tool==='rect'||tool==='ellipse'||tool==='crop'){rectDrawing=true;selRect={x0:p.x,y0:p.y,x1:p.x,y1:p.y};return;}
  // 移动
  if(tool==='move'){const l=getActiveLayer();if(!l)return;moveStartOX=l.offsetX;moveStartOY=l.offsetY;isDrawing=true;lastX=e.clientX;lastY=e.clientY;return;}
  // 渐变
  if(tool==='gradient'){gradStart=p;gradDrawing=true;return;}
  // 画笔类
  if(BRUSH_TOOLS.includes(tool)||tool==='pencil'){
    isDrawing=true;lastX=p.x;lastY=p.y;
    if(tool==='inpaint')drawInpaintMask(p.x,p.y);
    else drawBrushDot(p.x,p.y);
  }
});

viewport.addEventListener('mousemove',e=>{
  if(!imgW)return;const p=screenToCanvas(e);
  // Ctrl拖拽调笔刷
  if(isPanning&&e.ctrlKey&&(BRUSH_TOOLS.includes(tool)||tool==='pencil')){
    const dx=e.clientX-panSX,dy=e.clientY-panSY;
    if(Math.abs(dx)>Math.abs(dy)){const ns=Math.max(1,Math.min(300,parseInt(document.getElementById('brushSize').value)+Math.round(dx/3)));document.getElementById('brushSize').value=ns;document.getElementById('bsVal').textContent=ns;}
    else{const no=Math.max(0,Math.min(100,parseInt(document.getElementById('brushOpacity').value)+Math.round(-dy/3)));document.getElementById('brushOpacity').value=no;document.getElementById('boVal').textContent=no+'%';}
    return;
  }
  if(isPanning){offsetX+=e.clientX-panSX;offsetY+=e.clientY-panSY;panSX=e.clientX;panSY=e.clientY;applyTransform();return;}
  if(isDrawing){
    if(tool==='move'){const l=getActiveLayer();if(!l)return;l.offsetX=moveStartOX+(e.clientX-lastX)/scale;l.offsetY=moveStartOY+(e.clientY-lastY)/scale;compositeLayers();return;}
    if(tool==='brush'||tool==='pencil'||tool==='eraser'){drawBrushLine(lastX,lastY,p.x,p.y);lastX=p.x;lastY=p.y;return;}
    if(tool==='stamp'&&stampSrcCanvas){stampCopy(p.x,p.y);lastX=p.x;lastY=p.y;return;}
    if(tool==='blur'){blurAt(p.x,p.y);lastX=p.x;lastY=p.y;return;}
    if(tool==='sharpen'){sharpenAt(p.x,p.y);lastX=p.x;lastY=p.y;return;}
    if(tool==='dodge'||tool==='sponge'){dodgeBurnAt(p.x,p.y,!e.altKey);lastX=p.x;lastY=p.y;return;}
    if(tool==='inpaint'){drawInpaintLine(lastX,lastY,p.x,p.y);lastX=p.x;lastY=p.y;return;}
  }
  if(rectDrawing){selRect.x1=p.x;selRect.y1=p.y;drawOverlay();return;}
  if(lassoDrawing){lassoPath.push({x:p.x,y:p.y});drawOverlay();return;}
  if(gradDrawing){drawOverlay();ovCtx.strokeStyle='#0078d4';ovCtx.lineWidth=2/scale;ovCtx.beginPath();ovCtx.moveTo(gradStart.x,gradStart.y);ovCtx.lineTo(p.x,p.y);ovCtx.stroke();return;}
});

viewport.addEventListener('mouseleave',()=>{isDrawing=false;});
window.addEventListener('mouseup',e=>{
  if(isPanning&&e.ctrlKey){isPanning=false;viewport.style.cursor='crosshair';return;}
  if(isPanning){isPanning=false;viewport.style.cursor=tool==='move'?'grab':'crosshair';return;}
  if(isDrawing){
    isDrawing=false;
    if(tool==='move'){pushHistory();return;}
    if(tool!=='gradient'&&tool!=='inpaint')pushHistory();
  }
  if(rectDrawing){
    rectDrawing=false;
    if(selRect){const w=Math.abs(selRect.x1-selRect.x0),h=Math.abs(selRect.y1-selRect.y0);
      if(w<3&&h<3){selRect=null;}
      else if(tool==='crop'){doCrop();}
      else if(selectionMode==='add'||selectionMode==='sub'){
        // 把矩形/椭圆转成wandMask并合并
        rectToMaskMerge();
      }
    }
    document.getElementById('adjustScope').textContent=(selRect||lassoPath.length>2||wandMask)?'（选区）':'（全图）';
    updateToolPanel();drawOverlay();
  }
  if(lassoDrawing){lassoDrawing=false;if(lassoPath.length<3){lassoPath=[];}
    else if(selectionMode==='add'||selectionMode==='sub'){
      lassoToMaskMerge();
    }
    document.getElementById('adjustScope').textContent='（选区）';updateToolPanel();drawOverlay();}
  if(gradDrawing){gradDrawing=false;doGradient(screenToCanvas(e));pushHistory();}
});
viewport.addEventListener('contextmenu',e=>e.preventDefault());
viewport.addEventListener('dblclick',()=>{
  if(SELECTION_TOOLS.includes(tool)&&(selRect||lassoPath.length>2||wandMask)){deselectAll();document.getElementById('statusbar').textContent='选区已取消';}
});

// ── 合并画布（工具函数）──
function getMergedCanvas(){
  const m=document.createElement('canvas');m.width=imgW;m.height=imgH;const mc=m.getContext('2d');
  for(const l of layers){if(l.visible){mc.globalAlpha=l.opacity;mc.globalCompositeOperation=l.blend;mc.drawImage(l.canvas,l.offsetX,l.offsetY);}}
  mc.globalAlpha=1;mc.globalCompositeOperation='source-over';return m;
}

// ── 吸管 ──
function pickColor(p){
  const merged=getMergedCanvas();
  const x=Math.max(0,Math.min(imgW-1,Math.floor(p.x))),y=Math.max(0,Math.min(imgH-1,Math.floor(p.y)));
  const d=merged.getContext('2d').getImageData(x,y,1,1).data;
  const hex='#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  const fi=document.getElementById('fgColorInput');if(fi)fi.value=hex;
  fgColor=hex;syncFgColor();
  document.getElementById('statusbar').textContent='吸管取色: '+hex;
}

// ── 笔刷 ──
function drawBrushDot(x,y){
  const l=getActiveLayer();if(!l)return;
  const size=Math.max(1,parseInt(document.getElementById('brushSize').value));
  const color=document.getElementById('fgColor').value;
  const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const hardness=parseInt(document.getElementById('brushHardness').value)/100;
  const cx=l.ctx;cx.globalAlpha=opacity;
  if(tool==='eraser')cx.globalCompositeOperation='destination-out';else cx.globalCompositeOperation='source-over';
  if(tool==='pencil'){
    cx.fillStyle=color;cx.fillRect(Math.floor(x-size/2),Math.floor(y-size/2),size,size);
  }else if(tool==='eraser'||hardness>=0.99){
    cx.fillStyle=color;cx.beginPath();cx.arc(x,y,size/2,0,Math.PI*2);cx.fill();
  }else{
    const r=parseInt(color.slice(1,3),16),g2=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16);
    const g=cx.createRadialGradient(x,y,0,x,y,size/2);
    g.addColorStop(0,`rgba(${r},${g2},${b},1)`);
    g.addColorStop(Math.max(0.01,hardness),`rgba(${r},${g2},${b},1)`);
    g.addColorStop(1,`rgba(${r},${g2},${b},0)`);
    cx.fillStyle=g;cx.beginPath();cx.arc(x,y,size/2,0,Math.PI*2);cx.fill();
  }
  cx.globalAlpha=1;cx.globalCompositeOperation='source-over';compositeLayers();
}
function drawBrushLine(x1,y1,x2,y2){
  const l=getActiveLayer();if(!l)return;
  const size=Math.max(1,parseInt(document.getElementById('brushSize').value));
  const color=document.getElementById('fgColor').value;
  const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const hardness=parseInt(document.getElementById('brushHardness').value)/100;
  const cx=l.ctx;cx.globalAlpha=opacity;
  if(tool==='eraser')cx.globalCompositeOperation='destination-out';else cx.globalCompositeOperation='source-over';
  if(tool==='pencil'){
    const dx=x2-x1,dy=y2-y1;const dist=Math.sqrt(dx*dx+dy*dy);const steps=Math.max(1,Math.ceil(dist));
    cx.fillStyle=color;
    for(let i=0;i<=steps;i++){const t=i/steps;cx.fillRect(Math.floor((x1+dx*t)-size/2),Math.floor((y1+dy*t)-size/2),size,size);}
  }else if(tool==='eraser'||hardness>=0.99){
    cx.strokeStyle=color;cx.lineWidth=size;cx.lineCap='round';cx.lineJoin='round';
    cx.beginPath();cx.moveTo(x1,y1);cx.lineTo(x2,y2);cx.stroke();
  }else{
    // 软笔刷：间隔描点
    const dx=x2-x1,dy=y2-y1;const dist=Math.sqrt(dx*dx+dy*dy);
    const step=Math.max(1,size*0.15);const steps=Math.max(1,Math.ceil(dist/step));
    for(let i=0;i<=steps;i++){const t=i/steps;drawBrushDot(x1+dx*t,y1+dy*t);}
    return;
  }
  cx.globalAlpha=1;cx.globalCompositeOperation='source-over';compositeLayers();
}

// ── 图章（修复版）──
function stampCopy(x,y){
  if(!stampSrcCanvas)return;const l=getActiveLayer();if(!l)return;
  const size=parseInt(document.getElementById('brushSize').value);
  const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  // 计算源位置（保持相对偏移）
  const dx=x-stampSrcX,dy=y-stampSrcY;
  const srcX=stampSrcX-sz/2+dx,srcY=stampSrcY-sz/2+dy;
  // 在目标位置画源区域
  l.ctx.globalAlpha=opacity;l.ctx.globalCompositeOperation='source-over';
  // 用clip限制为圆形笔刷
  l.ctx.save();
  l.ctx.beginPath();l.ctx.arc(x,y,size/2,0,Math.PI*2);l.ctx.clip();
  l.ctx.drawImage(stampSrcCanvas,stampSrcX-stampSrcCanvas.width/2,stampSrcY-stampSrcCanvas.height/2,imgW,imgH,
    srcX-stampSrcCanvas.width/2,srcY-stampSrcCanvas.height/2,imgW,imgH);
  l.ctx.restore();
  l.ctx.globalAlpha=1;l.ctx.globalCompositeOperation='source-over';compositeLayers();
}

// ── 模糊笔刷 ──
function blurAt(x,y){
  const l=getActiveLayer();if(!l)return;
  const size=Math.max(1,parseInt(document.getElementById('brushSize').value));
  const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const blurStrength=parseInt(document.getElementById('blurStrength').value)||3;
  const x0=Math.max(0,Math.floor(x-size/2)),y0=Math.max(0,Math.floor(y-size/2));
  const w=Math.min(size,imgW-x0),h=Math.min(size,imgH-y0);
  if(w<=0||h<=0)return;
  const tc=document.createElement('canvas');tc.width=w;tc.height=h;const tctx=tc.getContext('2d');
  tctx.drawImage(l.canvas,x0,y0,w,h,0,0,w,h);
  tctx.filter='blur('+blurStrength+'px)';tctx.drawImage(tc,0,0);tctx.filter='none';
  // 用圆形clip混合
  l.ctx.save();l.ctx.beginPath();l.ctx.arc(x,y,size/2,0,Math.PI*2);l.ctx.clip();
  l.ctx.globalAlpha=opacity;l.ctx.drawImage(tc,x0,y0);l.ctx.restore();
  l.ctx.globalAlpha=1;compositeLayers();
}

// ── 加深减淡/海绵 ──
function dodgeBurnAt(x,y,isDarken){
  const l=getActiveLayer();if(!l)return;
  const size=Math.max(1,parseInt(document.getElementById('brushSize').value));
  const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const strength=parseInt(document.getElementById('dodgeStrength').value)/100||0.2;
  const x0=Math.max(0,Math.floor(x-size/2)),y0=Math.max(0,Math.floor(y-size/2));
  const w=Math.min(size,imgW-x0),h=Math.min(size,imgH-y0);if(w<=0||h<=0)return;
  const id=l.ctx.getImageData(x0,y0,w,h);const d=id.data;
  if(tool==='sponge'){
    const ss=strength;
    for(let i=0;i<d.length;i+=4){
      const gray=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
      if(isDarken){d[i]+=(d[i]-gray)*ss;d[i+1]+=(d[i+1]-gray)*ss;d[i+2]+=(d[i+2]-gray)*ss;}
      else{d[i]-=(d[i]-gray)*ss;d[i+1]-=(d[i+1]-gray)*ss;d[i+2]-=(d[i+2]-gray)*ss;}
      d[i]=Math.max(0,Math.min(255,d[i]));d[i+1]=Math.max(0,Math.min(255,d[i+1]));d[i+2]=Math.max(0,Math.min(255,d[i+2]));
    }
  }else{
    const factor=isDarken?(1-strength):(1+strength);
    for(let i=0;i<d.length;i+=4){
      d[i]=Math.max(0,Math.min(255,d[i]*factor));
      d[i+1]=Math.max(0,Math.min(255,d[i+1]*factor));
      d[i+2]=Math.max(0,Math.min(255,d[i+2]*factor));
    }
  }
  const tc=document.createElement('canvas');tc.width=w;tc.height=h;tc.getContext('2d').putImageData(id,0,0);
  l.ctx.save();l.ctx.beginPath();l.ctx.arc(x,y,size/2,0,Math.PI*2);l.ctx.clip();
  l.ctx.globalAlpha=opacity;l.ctx.drawImage(tc,x0,y0);l.ctx.restore();
  l.ctx.globalAlpha=1;compositeLayers();
}

// ── 锐化 ──
function sharpenAt(x,y){
  const l=getActiveLayer();if(!l)return;
  const size=Math.max(1,parseInt(document.getElementById('brushSize').value));
  const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const x0=Math.max(0,Math.floor(x-size/2)),y0=Math.max(0,Math.floor(y-size/2));
  const w=Math.min(size,imgW-x0),h=Math.min(size,imgH-y0);if(w<=2||h<=2)return;
  const id=l.ctx.getImageData(x0,y0,w,h);const d=id.data;const src=new Uint8ClampedArray(d);
  const strength=parseInt(document.getElementById('blurStrength').value)/10||0.3;
  for(let y2=1;y2<h-1;y2++){for(let x2=1;x2<w-1;x2++){
    const i=(y2*w+x2)*4;
    for(let c=0;c<3;c++){
      const center=src[i+c];const up=src[i-w*4+c];const down=src[i+w*4+c];const left=src[i-4+c];const right=src[i+4+c];
      d[i+c]=Math.max(0,Math.min(255,center+(center-(up+down+left+right)/4)*strength));
    }
  }}
  const tc=document.createElement('canvas');tc.width=w;tc.height=h;tc.getContext('2d').putImageData(id,0,0);
  l.ctx.save();l.ctx.beginPath();l.ctx.arc(x,y,size/2,0,Math.PI*2);l.ctx.clip();
  l.ctx.globalAlpha=opacity;l.ctx.drawImage(tc,x0,y0);l.ctx.restore();
  l.ctx.globalAlpha=1;compositeLayers();
}

// ── 魔棒（用栈代替队列，性能好）──
function doWand(x,y,mode){
  mode=mode||selectionMode||'new';
  const merged=getMergedCanvas();
  const id=merged.getContext('2d').getImageData(0,0,imgW,imgH);const d=id.data;
  const xi=Math.max(0,Math.min(imgW-1,Math.floor(x))),yi=Math.max(0,Math.min(imgH-1,Math.floor(y)));
  const idx=(yi*imgW+xi)*4;
  const tr=d[idx],tg=d[idx+1],tb=d[idx+2];
  const tol=parseInt(document.getElementById('wandTolerance').value)||30;
  const tol2=tol*tol;
  const visited=new Uint8Array(imgW*imgH);
  const stack=[yi*imgW+xi];visited[yi*imgW+xi]=1;
  const newMask=new Uint8ClampedArray(imgW*imgH*4);
  while(stack.length){
    const pos=stack.pop();const px=pos%imgW,py=Math.floor(pos/imgW);
    const ci=pos*4;const dr=d[ci]-tr,dg=d[ci+1]-tg,db=d[ci+2]-tb;
    if(dr*dr+dg*dg+db*db>tol2)continue;
    newMask[ci]=255;newMask[ci+3]=255;
    if(px>0&&!visited[pos-1]){visited[pos-1]=1;stack.push(pos-1);}
    if(px<imgW-1&&!visited[pos+1]){visited[pos+1]=1;stack.push(pos+1);}
    if(py>0&&!visited[pos-imgW]){visited[pos-imgW]=1;stack.push(pos-imgW);}
    if(py<imgH-1&&!visited[pos+imgW]){visited[pos+imgW]=1;stack.push(pos+imgW);}
  }
  // 与现有wandMask做布尔运算
  if(mode==='add'&&wandMask){
    const old=wandMask.data;
    for(let i=0;i<old.length;i+=4){if(newMask[i]>0){old[i]=255;old[i+3]=255;}}
    // 已修改wandMask.data，无需重建
  }else if(mode==='sub'&&wandMask){
    const old=wandMask.data;
    for(let i=0;i<old.length;i+=4){if(newMask[i]>0){old[i]=0;old[i+1]=0;old[i+2]=0;old[i+3]=0;}}
  }else{
    wandMask=new ImageData(imgW,imgH);wandMask.data.set(newMask);
    selRect=null;lassoPath=[]; // 清除其他选区
  }
  document.getElementById('adjustScope').textContent='（选区）';updateToolPanel();drawOverlay();
}

// ── 魔术橡皮 ──
function doMagicEraser(x,y){
  const l=getActiveLayer();if(!l)return;
  const id=l.ctx.getImageData(0,0,imgW,imgH);const d=id.data;
  const xi=Math.max(0,Math.min(imgW-1,Math.floor(x))),yi=Math.max(0,Math.min(imgH-1,Math.floor(y)));
  const idx=(yi*imgW+xi)*4;
  const tr=d[idx],tg=d[idx+1],tb=d[idx+2];
  const tol=parseInt(document.getElementById('magicEraserTol').value)||30;
  const tol2=tol*tol;
  const visited=new Uint8Array(imgW*imgH);
  const stack=[yi*imgW+xi];visited[yi*imgW+xi]=1;
  while(stack.length){
    const pos=stack.pop();const px=pos%imgW,py=Math.floor(pos/imgW);
    const ci=pos*4;const dr=d[ci]-tr,dg=d[ci+1]-tg,db=d[ci+2]-tb;
    if(dr*dr+dg*dg+db*db>tol2)continue;
    d[ci+3]=0;
    if(px>0&&!visited[pos-1]){visited[pos-1]=1;stack.push(pos-1);}
    if(px<imgW-1&&!visited[pos+1]){visited[pos+1]=1;stack.push(pos+1);}
    if(py>0&&!visited[pos-imgW]){visited[pos-imgW]=1;stack.push(pos-imgW);}
    if(py<imgH-1&&!visited[pos+imgW]){visited[pos+imgW]=1;stack.push(pos+imgW);}
  }
  l.ctx.putImageData(id,0,0);compositeLayers();pushHistory();
}

// ── 填充（修复clip逻辑）──
function doFill(fillColor){
  const l=getActiveLayer();if(!l)return;
  const color=fillColor||fgColor;
  const opacityEl=document.getElementById('brushOpacity');
  const opacity=opacityEl?parseInt(opacityEl.value)/100:1;
  const r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16);
  l.ctx.save();
  l.ctx.globalAlpha=opacity;
  l.ctx.fillStyle=`rgb(${r},${g},${b})`;
  // clip到选区
  if(selRect){
    l.ctx.beginPath();
    if(selEllipse){l.ctx.ellipse((selRect.x0+selRect.x1)/2,(selRect.y0+selRect.y1)/2,Math.abs(selRect.x1-selRect.x0)/2,Math.abs(selRect.y1-selRect.y0)/2,0,0,Math.PI*2);}
    else{l.ctx.rect(Math.min(selRect.x0,selRect.x1),Math.min(selRect.y0,selRect.y1),Math.abs(selRect.x1-selRect.x0),Math.abs(selRect.y1-selRect.y0));}
    l.ctx.clip();
  }else if(lassoPath.length>3){
    l.ctx.beginPath();l.ctx.moveTo(lassoPath[0].x,lassoPath[0].y);
    for(let i=1;i<lassoPath.length;i++)l.ctx.lineTo(lassoPath[i].x,lassoPath[i].y);
    l.ctx.closePath();l.ctx.clip();
  }else if(wandMask){
    const mc=document.createElement('canvas');mc.width=imgW;mc.height=imgH;
    mc.getContext('2d').putImageData(wandMask,0,0);
    l.ctx.globalCompositeOperation='destination-in';l.ctx.drawImage(mc,0,0);
    l.ctx.globalCompositeOperation='source-over'; // 后续fill只在mask区域生效
    l.ctx.beginPath();l.ctx.rect(0,0,imgW,imgH);l.ctx.clip();
    l.ctx.globalCompositeOperation='source-over';
  }
  l.ctx.fillRect(0,0,imgW,imgH);
  l.ctx.restore();
  l.ctx.globalAlpha=1;compositeLayers();pushHistory();
}

// ── 渐变（修复：支持所有选区类型）──
function doGradient(p){
  const l=getActiveLayer();if(!l)return;const color=document.getElementById('fgColor').value;
  const x0=gradStart.x,y0=gradStart.y,x1=p.x,y1=p.y;
  if(Math.abs(x1-x0)<2&&Math.abs(y1-y0)<2)return; // 太短忽略
  const g=l.ctx.createLinearGradient(x0,y0,x1,y1);
  g.addColorStop(0,color);g.addColorStop(1,'rgba(0,0,0,0)');
  l.ctx.save();
  l.ctx.globalAlpha=parseInt(document.getElementById('brushOpacity').value)/100;
  if(selRect){
    l.ctx.beginPath();
    if(selEllipse){l.ctx.ellipse((selRect.x0+selRect.x1)/2,(selRect.y0+selRect.y1)/2,Math.abs(selRect.x1-selRect.x0)/2,Math.abs(selRect.y1-selRect.y0)/2,0,0,Math.PI*2);}
    else{l.ctx.rect(Math.min(selRect.x0,selRect.x1),Math.min(selRect.y0,selRect.y1),Math.abs(selRect.x1-selRect.x0),Math.abs(selRect.y1-selRect.y0));}
    l.ctx.clip();
  }else if(lassoPath.length>3){
    l.ctx.beginPath();l.ctx.moveTo(lassoPath[0].x,lassoPath[0].y);
    for(let i=1;i<lassoPath.length;i++)l.ctx.lineTo(lassoPath[i].x,lassoPath[i].y);
    l.ctx.closePath();l.ctx.clip();
  }
  l.ctx.fillStyle=g;l.ctx.fillRect(0,0,imgW,imgH);
  l.ctx.restore();
  l.ctx.globalAlpha=1;compositeLayers();drawOverlay();
}

// ── 文字 ──
function commitText(){
  const ti=document.getElementById('textInput');if(ti.style.display==='none')return;
  const text=ti.value;if(!text||!textPos){ti.style.display='none';return;}
  const l=getActiveLayer();if(!l){ti.style.display='none';return;}
  const color=document.getElementById('fgColor').value;
  const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  l.ctx.globalAlpha=opacity;l.ctx.fillStyle=color;l.ctx.font='24px sans-serif';l.ctx.textBaseline='top';
  l.ctx.fillText(text,textPos.x,textPos.y);
  l.ctx.globalAlpha=1;compositeLayers();pushHistory();ti.style.display='none';textPos=null;
}

// ── 去水印遮罩 ──
function drawInpaintMask(x,y){const size=parseInt(document.getElementById('brushSize').value);maskCtx.fillStyle='#fff';maskCtx.beginPath();maskCtx.arc(x,y,size/2,0,Math.PI*2);maskCtx.fill();hasMaskFlag=true;drawOverlay();}
function drawInpaintLine(x1,y1,x2,y2){const size=parseInt(document.getElementById('brushSize').value);maskCtx.strokeStyle='#fff';maskCtx.lineWidth=size;maskCtx.lineCap='round';maskCtx.beginPath();maskCtx.moveTo(x1,y1);maskCtx.lineTo(x2,y2);maskCtx.stroke();hasMaskFlag=true;drawOverlay();}

async function doInpaint(){
  if(!imgW){alert('请先打开图片');return;}
  let hasMask=false;
  if(hasMaskFlag){hasMask=true;}
  if(!hasMask&&selRect){
    maskCtx.clearRect(0,0,imgW,imgH);maskCtx.fillStyle='#fff';
    maskCtx.fillRect(Math.min(selRect.x0,selRect.x1),Math.min(selRect.y0,selRect.y1),Math.abs(selRect.x1-selRect.x0),Math.abs(selRect.y1-selRect.y0));
    hasMask=true;
  }
  if(!hasMask){alert('请先用🧹工具涂抹区域或用▭框选区域');return;}
  const alg=document.getElementById('inpaintAlg').value;
  const merged=getMergedCanvas();
  const mainBlob=await new Promise(r=>merged.toBlob(r,'image/png'));
  const maskBlob=await new Promise(r=>maskCanvas.toBlob(r,'image/png'));
  const fd=new FormData();fd.append('image',mainBlob,'image.png');fd.append('mask',maskBlob,'mask.png');fd.append('algorithm',alg);fd.append('radius','3');
  document.getElementById('statusbar').textContent='⏳ 正在处理...';
  try{
    const res=await fetch('/api/image-inpaint',{method:'POST',body:fd});const d=await res.json();
    if(d.成功){const img=new Image();img.onload=()=>{
      const l=getActiveLayer();l.ctx.clearRect(0,0,imgW,imgH);l.ctx.drawImage(img,0,0);
      maskCtx.clearRect(0,0,imgW,imgH);hasMaskFlag=false;selRect=null;
      compositeLayers();pushHistory();
      document.getElementById('statusbar').textContent='✅ 去水印完成';
    };img.src='data:image/png;base64,'+d.图片;}
    else{alert('失败: '+d.错误);document.getElementById('statusbar').textContent='❌ '+d.错误;}
  }catch(e){alert('请求失败: '+e.message);document.getElementById('statusbar').textContent='❌ '+e.message;}
}

// ── 调整(亮度/对比度/色相/饱和度) ──
function buildFilterStr(){const b=parseInt(document.getElementById('brightness').value),c=parseInt(document.getElementById('contrast').value),h=parseInt(document.getElementById('hue').value),s=parseInt(document.getElementById('saturate').value);const p=[];if(b)p.push(`brightness(${1+b/100})`);if(c)p.push(`contrast(${1+c/100})`);if(h)p.push(`hue-rotate(${h}deg)`);if(s)p.push(`saturate(${1+s/100})`);return p.length?p.join(' '):'none';}
function previewAdjust(){canvas.style.filter=buildFilterStr();}
function applyAdjust(){
  const fs=buildFilterStr();if(fs==='none')return;
  const l=getActiveLayer();if(!l)return;
  const tmp=getMergedCanvas();
  const tmp2=document.createElement('canvas');tmp2.width=imgW;tmp2.height=imgH;const t2ctx=tmp2.getContext('2d');
  t2ctx.filter=fs;t2ctx.drawImage(tmp,0,0);t2ctx.filter='none';
  if(selRect){const x0=Math.max(0,Math.floor(Math.min(selRect.x0,selRect.x1))),y0=Math.max(0,Math.floor(Math.min(selRect.y0,selRect.y1))),w=Math.min(imgW,Math.ceil(Math.abs(selRect.x1-selRect.x0))),h=Math.min(imgH,Math.ceil(Math.abs(selRect.y1-selRect.y0)));const sd=l.ctx.getImageData(x0,y0,w,h);const nd=t2ctx.getImageData(x0,y0,w,h);for(let i=0;i<sd.data.length;i+=4){sd.data[i]=nd.data[i];sd.data[i+1]=nd.data[i+1];sd.data[i+2]=nd.data[i+2];}l.ctx.putImageData(sd,x0,y0);}
  else{l.ctx.clearRect(0,0,imgW,imgH);l.ctx.drawImage(tmp2,0,0);}
  canvas.style.filter='none';compositeLayers();pushHistory();resetAdjust();
  document.getElementById('statusbar').textContent='✅ 调整已应用'+(selRect?'（选区）':'（全图）');
}
function resetAdjust(){['brightness','contrast','hue','saturate'].forEach(id=>{document.getElementById(id).value=0;});['brVal','ctVal','huVal','saVal'].forEach(id=>{document.getElementById(id).textContent='0';});canvas.style.filter='none';}

// ── 色阶 ──
function previewLevels(){const b=parseInt(document.getElementById('levelBlack').value),w=parseInt(document.getElementById('levelWhite').value);if(w<=b)return;canvas.style.filter=`contrast(${255/(w-b)}) brightness(${1-b/255})`;}
function applyLevels(){
  const b=parseInt(document.getElementById('levelBlack').value),m=parseInt(document.getElementById('levelMid').value),w=parseInt(document.getElementById('levelWhite').value);if(w<=b){alert('白场必须大于黑场');return;}
  const l=getActiveLayer();if(!l)return;
  const tmp=getMergedCanvas();const tctx=tmp.getContext('2d');
  const id=tctx.getImageData(0,0,imgW,imgH);const d=id.data;const range=w-b;const midF=(m-b)/range;
  for(let i=0;i<d.length;i+=4){for(let ch=0;ch<3;ch++){let v=d[i+ch];v=(v-b)/range*255;v=Math.max(0,Math.min(255,v));v=255*Math.pow(v/255,1/(midF*2||1));d[i+ch]=Math.max(0,Math.min(255,v));}}
  tctx.putImageData(id,0,0);
  if(selRect){const x0=Math.max(0,Math.floor(Math.min(selRect.x0,selRect.x1))),y0=Math.max(0,Math.floor(Math.min(selRect.y0,selRect.y1))),sw=Math.min(imgW,Math.ceil(Math.abs(selRect.x1-selRect.x0))),sh=Math.min(imgH,Math.ceil(Math.abs(selRect.y1-selRect.y0)));const sd=l.ctx.getImageData(x0,y0,sw,sh);const nd=tctx.getImageData(x0,y0,sw,sh);for(let i=0;i<sd.data.length;i+=4){sd.data[i]=nd.data[i];sd.data[i+1]=nd.data[i+1];sd.data[i+2]=nd.data[i+2];}l.ctx.putImageData(sd,x0,y0);}
  else{l.ctx.clearRect(0,0,imgW,imgH);l.ctx.drawImage(tmp,0,0);}
  canvas.style.filter='none';compositeLayers();pushHistory();resetLevels();document.getElementById('statusbar').textContent='✅ 色阶已应用';
}
function resetLevels(){document.getElementById('levelBlack').value=0;document.getElementById('levelMid').value=128;document.getElementById('levelWhite').value=255;document.getElementById('lbVal').textContent='0';document.getElementById('lmVal').textContent='128';document.getElementById('lwVal').textContent='255';canvas.style.filter='none';}

// ── 快速操作 ──
function doGray(){const l=getActiveLayer();if(!l)return;const id=l.ctx.getImageData(0,0,imgW,imgH);const d=id.data;for(let i=0;i<d.length;i+=4){const g=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;d[i]=d[i+1]=d[i+2]=g;}l.ctx.putImageData(id,0,0);compositeLayers();pushHistory();}
function doBlur(){const l=getActiveLayer();if(!l)return;const tmp=getMergedCanvas();l.ctx.clearRect(0,0,imgW,imgH);l.ctx.filter='blur(5px)';l.ctx.drawImage(tmp,0,0);l.ctx.filter='none';compositeLayers();pushHistory();}

// ── 图像大小 ──
let aspectRatio=1;
function onResizeW(){if(document.getElementById('linkAspect').checked){const w=parseInt(document.getElementById('resizeW').value)||0;document.getElementById('resizeH').value=Math.round(w/aspectRatio);}}
function onResizeH(){if(document.getElementById('linkAspect').checked){const h=parseInt(document.getElementById('resizeH').value)||0;document.getElementById('resizeW').value=Math.round(h*aspectRatio);}}
function applyResize(){const nw=parseInt(document.getElementById('resizeW').value),nh=parseInt(document.getElementById('resizeH').value);if(!nw||!nh||nw<1||nh<1){alert('请输入有效宽高');return;}if(nw===imgW&&nh===imgH)return;for(const l of layers){const nc=document.createElement('canvas');nc.width=nw;nc.height=nh;const nctx=nc.getContext('2d');nctx.imageSmoothingEnabled=true;nctx.imageSmoothingQuality='high';nctx.drawImage(l.canvas,0,0,nw,nh);l.canvas=nc;l.ctx=nctx;}imgW=nw;imgH=nh;canvas.width=nw;canvas.height=nh;overlayCanvas.width=nw;overlayCanvas.height=nh;maskCanvas.width=nw;maskCanvas.height=nh;aspectRatio=nw/nh;compositeLayers();pushHistory();fitCanvas();renderLayerList();document.getElementById('statusbar').textContent='✅ 已缩放 '+nw+'×'+nh;}

// ── 裁剪 ──
function doCrop(){if(!selRect)return;const x0=Math.max(0,Math.floor(Math.min(selRect.x0,selRect.x1))),y0=Math.max(0,Math.floor(Math.min(selRect.y0,selRect.y1))),x1=Math.min(imgW,Math.ceil(Math.max(selRect.x0,selRect.x1))),y1=Math.min(imgH,Math.ceil(Math.max(selRect.y0,selRect.y1)));const cw=x1-x0,ch=y1-y0;if(cw<1||ch<1){selRect=null;drawOverlay();return;}for(const l of layers){const nc=document.createElement('canvas');nc.width=cw;nc.height=ch;nc.getContext('2d').drawImage(l.canvas,x0,y0,cw,ch,0,0,cw,ch);l.canvas=nc;l.ctx=nc.getContext('2d');}imgW=cw;imgH=ch;canvas.width=cw;canvas.height=ch;overlayCanvas.width=cw;overlayCanvas.height=ch;maskCanvas.width=cw;maskCanvas.height=ch;selRect=null;compositeLayers();pushHistory();fitCanvas();renderLayerList();document.getElementById('resizeW').value=cw;document.getElementById('resizeH').value=ch;aspectRatio=cw/ch;document.getElementById('statusbar').textContent='✅ 已裁剪 '+cw+'×'+ch;}

// ── 叠加层（优化：不再每次getImageData）──
function drawOverlay(){
  if(!imgW)return;
  ovCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  if(hasMaskFlag){ovCtx.globalAlpha=0.35;ovCtx.drawImage(maskCanvas,0,0);ovCtx.globalAlpha=1;}
  if(wandMask){ovCtx.globalAlpha=0.3;const mc=document.createElement('canvas');mc.width=imgW;mc.height=imgH;mc.getContext('2d').putImageData(wandMask,0,0);ovCtx.drawImage(mc,0,0);ovCtx.globalAlpha=1;}
  if(lassoPath.length>2){
    ovCtx.strokeStyle='#0078d4';ovCtx.lineWidth=1/scale;ovCtx.setLineDash([4/scale,4/scale]);
    ovCtx.beginPath();ovCtx.moveTo(lassoPath[0].x,lassoPath[0].y);
    for(let i=1;i<lassoPath.length;i++)ovCtx.lineTo(lassoPath[i].x,lassoPath[i].y);
    if(!lassoDrawing)ovCtx.closePath();
    ovCtx.stroke();ovCtx.setLineDash([]);
  }
  if(selRect){
    const x0=Math.min(selRect.x0,selRect.x1),y0=Math.min(selRect.y0,selRect.y1),w=Math.abs(selRect.x1-selRect.x0),h=Math.abs(selRect.y1-selRect.y0);
    ovCtx.fillStyle='rgba(0,0,0,0.3)';
    ovCtx.fillRect(0,0,imgW,imgH);
    ovCtx.globalCompositeOperation='destination-out';
    if(selEllipse){ovCtx.beginPath();ovCtx.ellipse(x0+w/2,y0+h/2,w/2,h/2,0,0,Math.PI*2);ovCtx.fill();}
    else{ovCtx.fillRect(x0,y0,w,h);}
    ovCtx.globalCompositeOperation='source-over';
    ovCtx.strokeStyle='#fff';ovCtx.lineWidth=1/scale;ovCtx.setLineDash([4/scale,4/scale]);
    if(selEllipse){ovCtx.beginPath();ovCtx.ellipse(x0+w/2,y0+h/2,w/2,h/2,0,0,Math.PI*2);ovCtx.stroke();}
    else{ovCtx.strokeRect(x0,y0,w,h);}
    ovCtx.setLineDash([]);
  }
  if(stampSrcCanvas&&tool==='stamp'){ovCtx.strokeStyle='#0f0';ovCtx.lineWidth=2/scale;const s=parseInt(document.getElementById('brushSize').value);ovCtx.strokeRect(stampSrcX-s/2,stampSrcY-s/2,s,s);}
}

// ── 撤销/重做（修复：保存所有图层状态）──
let history=[],historyIdx=-1;
function pushHistory(){
  history=history.slice(0,historyIdx+1);
  const state=layers.map(l=>({
    name:l.name,
    dataURL:l.canvas.toDataURL(),
    visible:l.visible,opacity:l.opacity,blend:l.blend,
    offsetX:l.offsetX,offsetY:l.offsetY
  }));
  history.push({layers:state,w:imgW,h:imgH});
  if(history.length>15)history.shift();else historyIdx++;
}
function undo(){if(historyIdx<=0)return;historyIdx--;restoreHistory();}
function redo(){if(historyIdx>=history.length-1)return;historyIdx++;restoreHistory();}
function restoreHistory(){
  const state=history[historyIdx];if(!state)return;
  imgW=state.w;imgH=state.h;canvas.width=imgW;canvas.height=imgH;
  overlayCanvas.width=imgW;overlayCanvas.height=imgH;maskCanvas.width=imgW;maskCanvas.height=imgH;
  layers=state.layers.map(s=>{
    const l=createLayer(s.name,imgW,imgH);l.visible=s.visible;l.opacity=s.opacity;l.blend=s.blend;l.offsetX=s.offsetX;l.offsetY=s.offsetY;
    const img=new Image();img.onload=()=>{l.ctx.drawImage(img,0,0);compositeLayers();};img.src=s.dataURL;
    return l;
  });
  renderLayerList();syncLayerControls();
}

// ── 保存 ──
function saveImage(){if(!imgW){alert('请先打开图片');return;}const m=getMergedCanvas();m.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);const bn=imgPath?imgPath.replace(/[\\/]/g,'/').split('/').pop().replace(/\.[^.]+$/,''):'image';a.download=bn+'_edited.png';a.click();document.getElementById('statusbar').textContent='💾 已保存 '+a.download;},'image/png');}

// ── 键盘 ──
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  // Ctrl+Delete = 填充背景色
  if((e.ctrlKey||e.metaKey)&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();doFill(bgColor);return;}
  // Alt+Delete = 填充前景色
  if(e.altKey&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();doFill(fgColor);return;}
  if(e.ctrlKey||e.metaKey){if(e.key==='z'){e.preventDefault();undo();}if(e.key==='y'){e.preventDefault();redo();}if(e.key==='s'){e.preventDefault();saveImage();}if(e.key==='d'){e.preventDefault();deselectAll();}if(e.key==='i'&&e.shiftKey){e.preventDefault();inverseSelection();}return;}
  // X = 切换前景/背景色
  if(e.key==='x'||e.key==='X'){swapColors();return;}
  // D = 默认黑白色
  if(e.key==='d'||e.key==='D'){const fi=document.getElementById('fgColorInput'),bi=document.getElementById('bgColorInput');if(fi)fi.value='#000000';if(bi)bi.value='#ffffff';fgColor='#000000';bgColor='#ffffff';syncFgColor();return;}
  if(e.key==='['){const s=document.getElementById('brushSize');if(s){s.value=Math.max(1,parseInt(s.value)-5);const v=document.getElementById('bsVal');if(v)v.textContent=s.value;}return;}
  if(e.key===']'){const s=document.getElementById('brushSize');if(s){s.value=Math.min(300,parseInt(s.value)+5);const v=document.getElementById('bsVal');if(v)v.textContent=s.value;}return;}
  const map={m:'rect',v:'move',c:'crop',b:'brush',n:'pencil',e:'eraser',s:'stamp',i:'eyedropper',g:'gradient',t:'text',r:'blur',o:'dodge',w:'inpaint',h:'hand',l:'lasso',f:'fill'};
  if(map[e.key.toLowerCase()])setTool(map[e.key.toLowerCase()]);
});

// ── 选区布尔运算辅助 ──
function rectToMaskMerge(){
  if(!selRect)return;
  const x0=Math.max(0,Math.floor(Math.min(selRect.x0,selRect.x1))),y0=Math.max(0,Math.floor(Math.min(selRect.y0,selRect.y1)));
  const x1=Math.min(imgW,Math.ceil(Math.max(selRect.x0,selRect.x1))),y1=Math.min(imgH,Math.ceil(Math.max(selRect.y0,selRect.y1)));
  if(!wandMask){wandMask=new ImageData(imgW,imgH);}
  const d=wandMask.data;
  if(selectionMode==='add'){
    for(let y=y0;y<y1;y++){for(let x=x0;x<x1;x++){
      if(selEllipse){const cx=(x0+x1)/2,cy=(y0+y1)/2,rx=(x1-x0)/2,ry=(y1-y0)/2;if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1){const i=(y*imgW+x)*4;d[i]=255;d[i+3]=255;}}
      else{const i=(y*imgW+x)*4;d[i]=255;d[i+3]=255;}
    }}
  }else if(selectionMode==='sub'){
    for(let y=y0;y<y1;y++){for(let x=x0;x<x1;x++){
      if(selEllipse){const cx=(x0+x1)/2,cy=(y0+y1)/2,rx=(x1-x0)/2,ry=(y1-y0)/2;if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1){const i=(y*imgW+x)*4;d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=0;}}
      else{const i=(y*imgW+x)*4;d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=0;}
    }}
  }
  selRect=null; // 合并后清除矩形，保留wandMask
}
function lassoToMaskMerge(){
  if(lassoPath.length<3)return;
  // 在临时canvas上画套索路径得到mask
  const tc=document.createElement('canvas');tc.width=imgW;tc.height=imgH;const tctx=tc.getContext('2d');
  tctx.fillStyle='#fff';tctx.beginPath();tctx.moveTo(lassoPath[0].x,lassoPath[0].y);
  for(let i=1;i<lassoPath.length;i++)tctx.lineTo(lassoPath[i].x,lassoPath[i].y);
  tctx.closePath();tctx.fill();
  const newMask=tctx.getImageData(0,0,imgW,imgH).data;
  if(!wandMask){wandMask=new ImageData(imgW,imgH);}
  const d=wandMask.data;
  if(selectionMode==='add'){
    for(let i=0;i<d.length;i+=4){if(newMask[i]>0){d[i]=255;d[i+3]=255;}}
  }else if(selectionMode==='sub'){
    for(let i=0;i<d.length;i+=4){if(newMask[i]>0){d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=0;}}
  }
  lassoPath=[]; // 合并后清除套索，保留wandMask
}

// ── 选区操作 ──
function deselectAll(){selRect=null;lassoPath=[];wandMask=null;selectionMode='new';document.getElementById('adjustScope').textContent='（全图）';updateToolPanel();drawOverlay();}
function inverseSelection(){
  if(wandMask){
    const d=wandMask.data;
    for(let i=0;i<d.length;i+=4){if(d[i]>0){d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=0;}else{d[i]=255;d[i+1]=255;d[i+2]=255;d[i+3]=255;}}
    drawOverlay();document.getElementById('statusbar').textContent='已反选';
  }else{
    // 矩形/套索反选：生成mask
    const mask=new Uint8ClampedArray(imgW*imgH*4);
    for(let i=3;i<mask.length;i+=4)mask[i]=255; // 先全选
    if(selRect){
      const x0=Math.max(0,Math.floor(Math.min(selRect.x0,selRect.x1))),y0=Math.max(0,Math.floor(Math.min(selRect.y0,selRect.y1)));
      const x1=Math.min(imgW,Math.ceil(Math.max(selRect.x0,selRect.x1))),y1=Math.min(imgH,Math.ceil(Math.max(selRect.y0,selRect.y1)));
      for(let y=y0;y<y1;y++){for(let x=x0;x<x1;x++){const i=(y*imgW+x)*4;mask[i]=0;mask[i+3]=0;}}
    }
    wandMask=new ImageData(imgW,imgH);wandMask.data.set(mask);
    selRect=null;lassoPath=[];
    drawOverlay();document.getElementById('adjustScope').textContent='（选区）';updateToolPanel();
    document.getElementById('statusbar').textContent='已反选';
  }
}

// ── 初始化 ──
initToolbar();syncFgColor();syncBgColor();updateToolPanel();
(function(){const params=new URLSearchParams(location.search);imgPath=params.get('path');if(!imgPath)return;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{setImage(img,imgPath.replace(/[\\/]/g,'/').split('/').pop());aspectRatio=img.width/img.height;};img.onerror=()=>{document.getElementById('statusbar').textContent='图片加载失败';};img.src='/api/image?path='+encodeURIComponent(imgPath);})();
