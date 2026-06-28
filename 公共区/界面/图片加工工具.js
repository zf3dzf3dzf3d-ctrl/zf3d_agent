// ═══ 图片加工工具 主逻辑 ═══
let tool='move', scale=1, offsetX=0, offsetY=0;
let isDrawing=false, isPanning=false, lastX=0, lastY=0, panSX=0, panSY=0;
let imgW=0, imgH=0, imgPath=null;
let canvas=document.getElementById('mainCanvas'), ctx=canvas.getContext('2d');
let overlayCanvas=document.getElementById('overlayCanvas'), ovCtx=overlayCanvas.getContext('2d');
let viewport=document.getElementById('viewport');
let maskCanvas=document.createElement('canvas'), maskCtx=maskCanvas.getContext('2d');
let history=[], historyIdx=-1;

// ── 图层 ──
let layers=[], activeLayerIdx=0;
function createLayer(name,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return{name:name||'图层'+(layers.length+1),canvas:c,ctx:c.getContext('2d'),visible:true,opacity:1.0,blend:'source-over'};}
function getActiveLayer(){return layers[activeLayerIdx];}
function compositeLayers(){if(!imgW)return;ctx.clearRect(0,0,canvas.width,canvas.height);for(const l of layers){if(!l.visible)continue;ctx.globalAlpha=l.opacity;ctx.globalCompositeOperation=l.blend;ctx.drawImage(l.canvas,0,0);}ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';if(maskCanvas.width!==imgW){maskCanvas.width=imgW;maskCanvas.height=imgH;}drawOverlay();}

function renderLayerList(){
  const list=document.getElementById('layerList');list.innerHTML='';
  for(let i=layers.length-1;i>=0;i--){
    const l=layers[i];const d=document.createElement('div');d.className='layer-item'+(i===activeLayerIdx?' active':'');d.draggable=true;d.dataset.idx=i;
    const th=document.createElement('canvas');th.width=28;th.height=28;th.getContext('2d').drawImage(l.canvas,0,0,28,28);d.appendChild(th);
    const n=document.createElement('span');n.className='ln';n.textContent=l.name;d.appendChild(n);
    const v=document.createElement('span');v.className='vis';v.textContent=l.visible?'👁':'🚫';v.onclick=e=>{e.stopPropagation();l.visible=!l.visible;compositeLayers();renderLayerList();};d.appendChild(v);
    d.onclick=()=>{activeLayerIdx=i;renderLayerList();syncLayerControls();};
    d.ondragstart=e=>e.dataTransfer.setData('text',i);d.ondragover=e=>e.preventDefault();
    d.ondrop=e=>{e.preventDefault();const from=parseInt(e.dataTransfer.getData('text')),to=i;if(from!==to){const item=layers.splice(from,1)[0];layers.splice(to,0,item);if(activeLayerIdx===from)activeLayerIdx=to;else if(from<activeLayerIdx&&to>=activeLayerIdx)activeLayerIdx--;else if(from>activeLayerIdx&&to<=activeLayerIdx)activeLayerIdx++;compositeLayers();renderLayerList();}};
    list.appendChild(d);
  }
}
function syncLayerControls(){const l=getActiveLayer();if(!l)return;document.getElementById('blendMode').value=l.blend;document.getElementById('layerOpacity').value=l.opacity*100;document.getElementById('loVal').textContent=Math.round(l.opacity*100);}
function onBlendChange(){const l=getActiveLayer();if(l){l.blend=document.getElementById('blendMode').value;compositeLayers();}}
function onLayerOpacity(){const l=getActiveLayer();if(l){l.opacity=parseInt(document.getElementById('layerOpacity').value)/100;document.getElementById('loVal').textContent=document.getElementById('layerOpacity').value;compositeLayers();}}
function addLayer(){if(!imgW)return;layers.push(createLayer(null,imgW,imgH));activeLayerIdx=layers.length-1;renderLayerList();syncLayerControls();}
function duplicateLayer(){if(!imgW)return;const l=getActiveLayer();const nl=createLayer(l.name+' 副本',imgW,imgH);nl.ctx.drawImage(l.canvas,0,0);layers.push(nl);activeLayerIdx=layers.length-1;renderLayerList();syncLayerControls();}
function deleteLayer(){if(layers.length<=1)return;layers.splice(activeLayerIdx,1);if(activeLayerIdx>=layers.length)activeLayerIdx=layers.length-1;compositeLayers();renderLayerList();syncLayerControls();}

// ── 选区/工具状态 ──
let selRect=null, rectDrawing=false;
let moveStartData=null, moveOffsetX=0, moveOffsetY=0;
let stampSrc=null, stampSrcX=0, stampSrcY=0;
let gradStart=null, gradDrawing=false;
let textPos=null;

// ── 工具栏 ──
const TOOLS=[
  {id:'rect',icon:'▭',name:'框选',key:'m',tip:'框选区域→双击结束→右侧调节'},
  {id:'move',icon:'✋',name:'移动',key:'v',tip:'移动当前层/选区内容'},
  {id:'crop',icon:'✂',name:'裁剪',key:'c',tip:'框选后自动裁剪'},
  {sep:1},
  {id:'brush',icon:'🖌',name:'画笔',key:'b',tip:'Ctrl+左键左右=大小 上下=透明度'},
  {id:'pencil',icon:'✏',name:'铅笔',key:'n',tip:'硬边像素画笔'},
  {id:'stamp',icon:'🔖',name:'图章',key:'s',tip:'Alt+左键设源→左键绘制'},
  {id:'eraser',icon:'🧽',name:'橡皮',key:'e',tip:'擦除当前层'},
  {sep:1},
  {id:'gradient',icon:'🌈',name:'渐变',key:'g',tip:'选颜色拉直线渐变填充'},
  {id:'text',icon:'📝',name:'文字',key:'t',tip:'点击输入文字'},
  {sep:1},
  {id:'blur',icon:'💨',name:'模糊',key:'r',tip:'模糊笔刷'},
  {id:'dodge',icon:'🔆',name:'加深减淡',key:'d',tip:'左键减淡 Alt+左键加深'},
  {sep:1},
  {id:'inpaint',icon:'🧹',name:'去水印',key:'w',tip:'涂抹区域→点✨去除'},
];

function initToolbar(){
  const bar=document.getElementById('leftbar');bar.innerHTML='';
  for(const t of TOOLS){
    if(t.sep){const s=document.createElement('div');s.className='sep';bar.appendChild(s);continue;}
    const b=document.createElement('button');b.id='tool-'+t.id;b.innerHTML=t.icon+'<span class="tip">'+t.name+': '+t.tip+'</span>';
    b.onclick=()=>setTool(t.id);bar.appendChild(b);
  }
}

function setTool(t){
  tool=t;document.querySelectorAll('.leftbar button').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('tool-'+t);if(btn)btn.classList.add('active');
  canvas.style.cursor=t==='move'?'grab':'crosshair';
  if(t!=='rect'&&t!=='crop'){selRect=null;drawOverlay();}
  if(t!=='inpaint'){maskCtx.clearRect(0,0,imgW||1,imgH||1);drawOverlay();}
  document.getElementById('adjustScope').textContent=selRect?'（选区）':'（全图）';
}

// ── 图片加载 ──
function loadImage(){
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{const img=new Image();img.onload=()=>setImage(img,file.name);img.src=ev.target.result;};reader.readAsDataURL(file);};
  input.click();
}

function setImage(img,name){
  imgW=img.width;imgH=img.height;canvas.width=imgW;canvas.height=imgH;
  overlayCanvas.width=imgW;overlayCanvas.height=imgH;maskCanvas.width=imgW;maskCanvas.height=imgH;
  maskCtx.clearRect(0,0,imgW,imgH);
  layers=[createLayer('背景',imgW,imgH)];layers[0].ctx.drawImage(img,0,0);activeLayerIdx=0;
  compositeLayers();history=[];historyIdx=-1;pushHistory();fitCanvas();renderLayerList();syncLayerControls();
  document.getElementById('resizeW').value=imgW;document.getElementById('resizeH').value=imgH;
  document.getElementById('statusbar').textContent=name+' '+imgW+'×imgH;
}

function resetAll(){
  if(!history.length)return;
  const img=new Image();img.onload=()=>{
    layers=[createLayer('背景',imgW,imgH)];layers[0].ctx.drawImage(img,0,0);activeLayerIdx=0;
    maskCtx.clearRect(0,0,imgW,imgH);selRect=null;compositeLayers();renderLayerList();pushHistory();
  };img.src=history[0];
}

// ── 视图 ──
function applyTransform(){const t=`translate(${offsetX}px,${offsetY}px) scale(${scale})`;canvas.style.transform=t;overlayCanvas.style.transform=t;document.getElementById('zoomPill').textContent=Math.round(scale*100)+'%';}
function fitCanvas(){if(!imgW)return;const vw=viewport.clientWidth-20,vh=viewport.clientHeight-20;scale=Math.min(vw/imgW,vh/imgH,1);offsetX=(viewport.clientWidth-imgW*scale)/2;offsetY=(viewport.clientHeight-imgH*scale)/2;applyTransform();}
function setActual(){scale=1;offsetX=(viewport.clientWidth-imgW)/2;offsetY=(viewport.clientHeight-imgH)/2;applyTransform();}
function screenToCanvas(e){const r=viewport.getBoundingClientRect();return{x:(e.clientX-r.left-offsetX)/scale,y:(e.clientY-r.top-offsetY)/scale};}

// ── 鼠标交互 ──
viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;const ns=Math.max(0.05,Math.min(40,scale*(e.deltaY>0?0.9:1.1)));offsetX=mx-(mx-offsetX)*(ns/scale);offsetY=my-(my-offsetY)*(ns/scale);scale=ns;applyTransform();},{passive:false});

viewport.addEventListener('mousedown',e=>{
  if(!imgW)return;const p=screenToCanvas(e);
  // Ctrl+左键=调笔刷大小/透明度（画笔/铅笔/橡皮/图章/模糊/加深减淡）
  if(e.button===0&&e.ctrlKey&&(tool==='brush'||tool==='pencil'||tool==='eraser'||tool==='stamp'||tool==='blur'||tool==='dodge')){
    isPanning=true;panSX=e.clientX;panSY=e.clientY;viewport.style.cursor='crosshair';
    // 记录起始值用于判断水平/垂直
    e.preventDefault();return;
  }
  // 中键/右键=平移
  if(e.button===1||e.button===2||(tool==='move'&&!selRect&&e.button===0)){isPanning=true;panSX=e.clientX;panSY=e.clientY;viewport.style.cursor='grabbing';e.preventDefault();return;}
  if(e.button!==0)return;

  // 图章：Alt+左键设源
  if(tool==='stamp'&&e.altKey){stampSrcX=p.x;stampSrcY=p.y;stampSrc=getActiveLayer().ctx.getImageData(p.x-Math.ceil(parseInt(document.getElementById('brushSize').value)/2),p.y-Math.ceil(parseInt(document.getElementById('brushSize').value)/2),parseInt(document.getElementById('brushSize').value),parseInt(document.getElementById('brushSize').value));document.getElementById('statusbar').textContent='图章源已设置';return;}

  // 文字工具
  if(tool==='text'){const ti=document.getElementById('textInput');const r=viewport.getBoundingClientRect();ti.style.left=(e.clientX-r.left)+'px';ti.style.top=(e.clientY-r.top)+'px';ti.style.display='block';ti.value='';ti.focus();textPos=p;return;}

  // 框选/裁剪
  if(tool==='rect'||tool==='crop'){rectDrawing=true;selRect={x0:p.x,y0:p.y,x1:p.x,y1:p.y};return;}

  // 移动工具+有选区=移动选区内容
  if(tool==='move'&&selRect){moveStartData=getActiveLayer().ctx.getImageData(0,0,imgW,imgH);moveOffsetX=0;moveOffsetY=0;isDrawing=true;return;}
  // 移动工具无选区=移动整个图层
  if(tool==='move'){moveStartData=getActiveLayer().ctx.getImageData(0,0,imgW,imgH);moveOffsetX=0;moveOffsetY=0;isDrawing=true;return;}

  // 渐变
  if(tool==='gradient'){gradStart=p;gradDrawing=true;return;}

  // 画笔类工具
  if(tool==='brush'||tool==='pencil'||tool==='eraser'||tool==='stamp'||tool==='blur'||tool==='dodge'||tool==='inpaint'){
    isDrawing=true;lastX=p.x;lastY=p.y;
    if(tool==='inpaint')drawInpaintMask(p.x,p.y);
    else drawBrushDot(p.x,p.y);
  }
});

viewport.addEventListener('mousemove',e=>{
  if(!imgW)return;const p=screenToCanvas(e);
  // Ctrl+左键拖拽调笔刷
  if(isPanning&&e.ctrlKey&&(tool==='brush'||tool==='pencil'||tool==='eraser'||tool==='stamp'||tool==='blur'||tool==='dodge')){
    const dx=e.clientX-panSX,dy=e.clientY-panSY;
    if(Math.abs(dx)>Math.abs(dy)){const ns=Math.max(1,Math.min(300,parseInt(document.getElementById('brushSize').value)+Math.round(dx/3)));document.getElementById('brushSize').value=ns;document.getElementById('bsVal').textContent=ns;}
    else{const no=Math.max(0,Math.min(100,parseInt(document.getElementById('brushOpacity').value)+Math.round(-dy/3)));document.getElementById('brushOpacity').value=no;document.getElementById('boVal').textContent=no+'%';}
    return;
  }
  if(isPanning){offsetX+=e.clientX-panSX;offsetY+=e.clientY-panSY;panSX=e.clientX;panSY=e.clientY;applyTransform();return;}
  if(isDrawing){
    if(tool==='move'&&moveStartData){moveOffsetX=p.x-lastX;moveOffsetY=p.y-lastY;const l=getActiveLayer();l.ctx.clearRect(0,0,imgW,imgH);l.ctx.putImageData(moveStartData,0,0);l.ctx.translate(moveOffsetX,moveOffsetY);l.ctx.drawImage(l.canvas,0,0);l.ctx.setTransform(1,0,0,1,0,0);compositeLayers();return;}
    if(tool==='brush'||tool==='pencil'||tool==='eraser'){drawBrushLine(lastX,lastY,p.x,p.y);lastX=p.x;lastY=p.y;return;}
    if(tool==='stamp'&&stampSrc){stampCopy(p.x,p.y);lastX=p.x;lastY=p.y;return;}
    if(tool==='blur'){blurAt(p.x,p.y);lastX=p.x;lastY=p.y;return;}
    if(tool==='dodge'){dodgeBurnAt(p.x,p.y,e.altKey);lastX=p.x;lastY=p.y;return;}
    if(tool==='inpaint'){drawInpaintLine(lastX,lastY,p.x,p.y);lastX=p.x;lastY=p.y;return;}
  }
  if(rectDrawing){selRect.x1=p.x;selRect.y1=p.y;drawOverlay();return;}
  if(gradDrawing){drawOverlay();ovCtx.strokeStyle='#0078d4';ovCtx.lineWidth=2/scale;ovCtx.beginPath();ovCtx.moveTo(gradStart.x,gradStart.y);ovCtx.lineTo(p.x,p.y);ovCtx.stroke();return;}
});

viewport.addEventListener('mouseleave',()=>{isDrawing=false;});
window.addEventListener('mouseup',e=>{
  if(isPanning&&e.ctrlKey){isPanning=false;viewport.style.cursor='crosshair';return;}
  if(isPanning){isPanning=false;viewport.style.cursor=tool==='move'?'grab':'crosshair';return;}
  if(isDrawing){
    isDrawing=false;
    if(tool==='move'){moveStartData=null;pushHistory();return;}
    if(tool!=='gradient'&&tool!=='inpaint')pushHistory();
  }
  if(rectDrawing){
    rectDrawing=false;
    if(selRect){const w=Math.abs(selRect.x1-selRect.x0),h=Math.abs(selRect.y1-selRect.y0);if(w<3&&h<3){selRect=null;}else if(tool==='crop'){doCrop();}}
    document.getElementById('adjustScope').textContent=selRect?'（选区）':'（全图）';
    drawOverlay();
  }
  if(gradDrawing){gradDrawing=false;doGradient(screenToCanvas(e));pushHistory();}
});
viewport.addEventListener('contextmenu',e=>e.preventDefault());
viewport.addEventListener('dblclick',e=>{
  if(tool==='rect'&&selRect){selRect=null;document.getElementById('adjustScope').textContent='（全图）';drawOverlay();document.getElementById('statusbar').textContent='选区已取消';}
});

// ── 笔刷 ──
function getBrushCtx(){const l=getActiveLayer();if(!l)return null;const cx=l.ctx;if(tool==='eraser')cx.globalCompositeOperation='destination-out';else cx.globalCompositeOperation='source-over';cx.globalAlpha=parseInt(document.getElementById('brushOpacity').value)/100;return cx;}
function drawBrushDot(x,y){
  const l=getActiveLayer();if(!l)return;const size=parseInt(document.getElementById('brushSize').value);const color=document.getElementById('fgColor').value;const opacity=parseInt(document.getElementById('brushOpacity').value)/100;const hardness=parseInt(document.getElementById('brushHardness').value)/100;
  const cx=l.ctx;cx.globalAlpha=opacity;
  if(tool==='eraser')cx.globalCompositeOperation='destination-out';else cx.globalCompositeOperation='source-over';
  if(tool==='pencil'||tool==='eraser'||hardness>=0.99){
    cx.fillStyle=tool==='eraser'?'rgba(0,0,0,1)':color;cx.beginPath();cx.arc(x,y,size/2,0,Math.PI*2);cx.fill();
  }else{
    // 软笔刷：径向渐变
    const g=cx.createRadialGradient(x,y,0,x,y,size/2);
    const c=color;const r=parseInt(c.slice(1,3),16),g2=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);
    g.addColorStop(0,`rgba(${r},${g2},${b},1)`);
    const hardStop=Math.max(0.01,hardness);
    g.addColorStop(hardStop,`rgba(${r},${g2},${b},1)`);
    g.addColorStop(1,`rgba(${r},${g2},${b},0)`);
    cx.fillStyle=g;cx.beginPath();cx.arc(x,y,size/2,0,Math.PI*2);cx.fill();
  }
  cx.globalAlpha=1;cx.globalCompositeOperation='source-over';compositeLayers();
}
function drawBrushLine(x1,y1,x2,y2){
  const l=getActiveLayer();if(!l)return;const size=parseInt(document.getElementById('brushSize').value);const color=document.getElementById('fgColor').value;const opacity=parseInt(document.getElementById('brushOpacity').value)/100;const hardness=parseInt(document.getElementById('brushHardness').value)/100;
  const cx=l.ctx;cx.globalAlpha=opacity;
  if(tool==='eraser')cx.globalCompositeOperation='destination-out';else cx.globalCompositeOperation='source-over';
  if(tool==='pencil'||tool==='eraser'||hardness>=0.99){
    cx.strokeStyle=tool==='eraser'?'rgba(0,0,0,1)':color;cx.lineWidth=size;cx.lineCap='round';cx.lineJoin='round';cx.beginPath();cx.moveTo(x1,y1);cx.lineTo(x2,y2);cx.stroke();
  }else{
    // 多次描点模拟软笔刷
    const dx=x2-x1,dy=y2-y1;const dist=Math.sqrt(dx*dx+dy*dy);const steps=Math.max(1,Math.ceil(dist/2));
    for(let i=0;i<=steps;i++){const t=i/steps;const px=x1+dx*t,py=y1+dy*t;drawBrushDot(px,py);}
    return;
  }
  cx.globalAlpha=1;cx.globalCompositeOperation='source-over';compositeLayers();
}

// ── 图章 ──
function stampCopy(x,y){
  if(!stampSrc)return;const l=getActiveLayer();if(!l)return;const size=parseInt(document.getElementById('brushSize').value);const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const dx=x-stampSrcX,dy=y-stampSrcY;
  // 创建临时canvas放源数据
  const tc=document.createElement('canvas');tc.width=stampSrc.width;tc.height=stampSrc.height;tc.getContext('2d').putImageData(stampSrc,0,0);
  l.ctx.globalAlpha=opacity;l.ctx.globalCompositeOperation='source-over';
  l.ctx.drawImage(tc,x-Math.ceil(size/2),y-Math.ceil(size/2),size,size,dx+x-Math.ceil(size/2),dy+y-Math.ceil(size/2),size,size);
  l.ctx.globalAlpha=1;l.ctx.globalCompositeOperation='source-over';compositeLayers();
}

// ── 模糊笔刷 ──
function blurAt(x,y){
  const l=getActiveLayer();if(!l)return;const size=parseInt(document.getElementById('brushSize').value);const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const x0=Math.max(0,Math.floor(x-size/2)),y0=Math.max(0,Math.floor(y-size/2));
  const w=Math.min(size,imgW-x0),h=Math.min(size,imgH-y0);
  if(w<=0||h<=0)return;
  const tc=document.createElement('canvas');tc.width=w;tc.height=h;const tctx=tc.getContext('2d');
  tctx.drawImage(l.canvas,x0,y0,w,h,0,0,w,h);tctx.filter='blur(3px)';tctx.drawImage(tc,0,0);tctx.filter='none';
  l.ctx.globalAlpha=opacity;l.ctx.drawImage(tc,x0,y0);l.ctx.globalAlpha=1;compositeLayers();
}

// ── 加深减淡 ──
function dodgeBurnAt(x,y,isBurn){
  const l=getActiveLayer();if(!l)return;const size=parseInt(document.getElementById('brushSize').value);const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  const x0=Math.max(0,Math.floor(x-size/2)),y0=Math.max(0,Math.floor(y-size/2));
  const w=Math.min(size,imgW-x0),h=Math.min(size,imgH-y0);if(w<=0||h<=0)return;
  const id=l.ctx.getImageData(x0,y0,w,h);const d=id.data;
  const factor=isBurn?0.92:1.08;
  for(let i=0;i<d.length;i+=4){d[i]=Math.min(255,d[i]*factor);d[i+1]=Math.min(255,d[i+1]*factor);d[i+2]=Math.min(255,d[i+2]*factor);}
  const tc=document.createElement('canvas');tc.width=w;tc.height=h;tc.getContext('2d').putImageData(id,0,0);
  l.ctx.globalAlpha=opacity;l.ctx.drawImage(tc,x0,y0);l.ctx.globalAlpha=1;compositeLayers();
}

// ── 渐变 ──
function doGradient(p){
  const l=getActiveLayer();if(!l)return;const color=document.getElementById('fgColor').value;
  const x0=gradStart.x,y0=gradStart.y,x1=p.x,y1=p.y;
  const g=l.ctx.createLinearGradient(x0,y0,x1,y1);
  g.addColorStop(0,color);g.addColorStop(1,'rgba(0,0,0,0)');
  l.ctx.globalAlpha=parseInt(document.getElementById('brushOpacity').value)/100;
  // 如果有选区，clip
  if(selRect){l.ctx.save();l.ctx.beginPath();l.ctx.rect(Math.min(selRect.x0,selRect.x1),Math.min(selRect.y0,selRect.y1),Math.abs(selRect.x1-selRect.x0),Math.abs(selRect.y1-selRect.y0));l.ctx.clip();}
  l.ctx.fillStyle=g;l.ctx.fillRect(0,0,imgW,imgH);
  if(selRect)l.ctx.restore();
  l.ctx.globalAlpha=1;compositeLayers();drawOverlay();
}

// ── 文字 ──
function commitText(){
  const ti=document.getElementById('textInput');if(ti.style.display==='none')return;
  const text=ti.value;if(!text||!textPos){ti.style.display='none';return;}
  const l=getActiveLayer();if(!l){ti.style.display='none';return;}
  const color=document.getElementById('fgColor').value;const opacity=parseInt(document.getElementById('brushOpacity').value)/100;
  l.ctx.globalAlpha=opacity;l.ctx.fillStyle=color;l.ctx.font='24px sans-serif';l.ctx.textBaseline='top';
  l.ctx.fillText(text,textPos.x,textPos.y);
  l.ctx.globalAlpha=1;compositeLayers();pushHistory();ti.style.display='none';textPos=null;
}

// ── 去水印遮罩 ──
function drawInpaintMask(x,y){const size=parseInt(document.getElementById('brushSize').value);maskCtx.fillStyle='#fff';maskCtx.beginPath();maskCtx.arc(x,y,size/2,0,Math.PI*2);maskCtx.fill();drawOverlay();}
function drawInpaintLine(x1,y1,x2,y2){const size=parseInt(document.getElementById('brushSize').value);maskCtx.strokeStyle='#fff';maskCtx.lineWidth=size;maskCtx.lineCap='round';maskCtx.beginPath();maskCtx.moveTo(x1,y1);maskCtx.lineTo(x2,y2);maskCtx.stroke();drawOverlay();}

async function doInpaint(){
  if(!imgW){alert('请先打开图片');return;}
  // 检查mask或选区
  let hasMask=false;
  if(tool==='inpaint'){const md=maskCtx.getImageData(0,0,imgW,imgH);for(let i=3;i<md.data.length;i+=4){if(md.data[i]>0){hasMask=true;break;}}}
  // 如果有选区但没有mask，用选区生成mask
  if(!hasMask&&selRect){
    maskCtx.clearRect(0,0,imgW,imgH);maskCtx.fillStyle='#fff';
    maskCtx.fillRect(Math.min(selRect.x0,selRect.x1),Math.min(selRect.y0,selRect.y1),Math.abs(selRect.x1-selRect.x0),Math.abs(selRect.y1-selRect.y0));
    hasMask=true;
  }
  if(!hasMask){alert('请先用🧹工具涂抹区域或用▭框选区域');return;}
  const alg=document.getElementById('inpaintAlg').value;
  // 合并图层
  const merged=document.createElement('canvas');merged.width=imgW;merged.height=imgH;const mctx=merged.getContext('2d');
  for(const l of layers){if(l.visible){mctx.globalAlpha=l.opacity;mctx.drawImage(l.canvas,0,0);}}mctx.globalAlpha=1;
  const mainBlob=await new Promise(r=>merged.toBlob(r,'image/png'));
  const maskBlob=await new Promise(r=>maskCanvas.toBlob(r,'image/png'));
  const fd=new FormData();fd.append('image',mainBlob,'image.png');fd.append('mask',maskBlob,'mask.png');fd.append('algorithm',alg);fd.append('radius','3');
  document.getElementById('statusbar').textContent='⏳ 正在处理...';
  try{
    const res=await fetch('/api/image-inpaint',{method:'POST',body:fd});const d=await res.json();
    if(d.成功){const img=new Image();img.onload=()=>{const l=getActiveLayer();l.ctx.clearRect(0,0,imgW,imgH);l.ctx.drawImage(img,0,0);maskCtx.clearRect(0,0,imgW,imgH);selRect=null;compositeLayers();pushHistory();document.getElementById('statusbar').textContent='✅ 去水印完成';};img.src='data:image/png;base64,'+d.图片;}
    else{alert('失败: '+d.错误);document.getElementById('statusbar').textContent='❌ '+d.错误;}
  }catch(e){alert('请求失败: '+e.message);document.getElementById('statusbar').textContent='❌ '+e.message;}
}

// ── 调整(亮度/对比度/色相/饱和度) ──
function buildFilterStr(){const b=parseInt(document.getElementById('brightness').value),c=parseInt(document.getElementById('contrast').value),h=parseInt(document.getElementById('hue').value),s=parseInt(document.getElementById('saturate').value);const p=[];if(b)p.push(`brightness(${1+b/100})`);if(c)p.push(`contrast(${1+c/100})`);if(h)p.push(`hue-rotate(${h}deg)`);if(s)p.push(`saturate(${1+s/100})`);return p.length?p.join(' '):'none';}
function previewAdjust(){canvas.style.filter=buildFilterStr();}
function applyAdjust(){
  const fs=buildFilterStr();if(fs==='none')return;
  const l=getActiveLayer();if(!l)return;
  // 合并可见图层到临时
  const tmp=document.createElement('canvas');tmp.width=imgW;tmp.height=imgH;const tctx=tmp.getContext('2d');
  for(const ly of layers){if(ly.visible){tctx.globalAlpha=ly.opacity;tctx.drawImage(ly.canvas,0,0);}}tctx.globalAlpha=1;
  // 应用filter
  const tmp2=document.createElement('canvas');tmp2.width=imgW;tmp2.height=imgH;const t2ctx=tmp2.getContext('2d');
  t2ctx.filter=fs;t2ctx.drawImage(tmp,0,0);t2ctx.filter='none';
  // 如果有选区，只更新选区
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
  const l=getActiveLayer();if(!l)return;const tmp=document.createElement('canvas');tmp.width=imgW;tmp.height=imgH;const tctx=tmp.getContext('2d');
  for(const ly of layers){if(ly.visible){tctx.globalAlpha=ly.opacity;tctx.drawImage(ly.canvas,0,0);}}tctx.globalAlpha=1;
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
function doBlur(){const l=getActiveLayer();if(!l)return;const tmp=document.createElement('canvas');tmp.width=imgW;tmp.height=imgH;for(const ly of layers){if(ly.visible){tmp.getContext('2d').globalAlpha=ly.opacity;tmp.getContext('2d').drawImage(ly.canvas,0,0);}}l.ctx.clearRect(0,0,imgW,imgH);l.ctx.filter='blur(5px)';l.ctx.drawImage(tmp,0,0);l.ctx.filter='none';compositeLayers();pushHistory();}

// ── 图像大小 ──
let aspectRatio=1;
function onResizeW(){if(document.getElementById('linkAspect').checked){const w=parseInt(document.getElementById('resizeW').value)||0;document.getElementById('resizeH').value=Math.round(w/aspectRatio);}}
function onResizeH(){if(document.getElementById('linkAspect').checked){const h=parseInt(document.getElementById('resizeH').value)||0;document.getElementById('resizeW').value=Math.round(h*aspectRatio);}}
function applyResize(){const nw=parseInt(document.getElementById('resizeW').value),nh=parseInt(document.getElementById('resizeH').value);if(!nw||!nh||nw<1||nh<1){alert('请输入有效宽高');return;}if(nw===imgW&&nh===imgH)return;for(const l of layers){const nc=document.createElement('canvas');nc.width=nw;nc.height=nh;const nctx=nc.getContext('2d');nctx.imageSmoothingEnabled=true;nctx.imageSmoothingQuality='high';nctx.drawImage(l.canvas,0,0,nw,nh);l.canvas=nc;l.ctx=nctx;}imgW=nw;imgH=nh;canvas.width=nw;canvas.height=nh;overlayCanvas.width=nw;overlayCanvas.height=nh;maskCanvas.width=nw;maskCanvas.height=nh;aspectRatio=nw/nh;compositeLayers();pushHistory();fitCanvas();renderLayerList();document.getElementById('statusbar').textContent='✅ 已缩放 '+nw+'×'+nh;}

// ── 裁剪 ──
function doCrop(){if(!selRect)return;const x0=Math.max(0,Math.floor(Math.min(selRect.x0,selRect.x1))),y0=Math.max(0,Math.floor(Math.min(selRect.y0,selRect.y1))),x1=Math.min(imgW,Math.ceil(Math.max(selRect.x0,selRect.x1))),y1=Math.min(imgH,Math.ceil(Math.max(selRect.y0,selRect.y1)));const cw=x1-x0,ch=y1-y0;if(cw<1||ch<1){selRect=null;drawOverlay();return;}for(const l of layers){const nc=document.createElement('canvas');nc.width=cw;nc.height=ch;nc.getContext('2d').drawImage(l.canvas,x0,y0,cw,ch,0,0,cw,ch);l.canvas=nc;l.ctx=nc.getContext('2d');}imgW=cw;imgH=ch;canvas.width=cw;canvas.height=ch;overlayCanvas.width=cw;overlayCanvas.height=ch;maskCanvas.width=cw;maskCanvas.height=ch;selRect=null;compositeLayers();pushHistory();fitCanvas();renderLayerList();document.getElementById('resizeW').value=cw;document.getElementById('resizeH').value=ch;aspectRatio=cw/ch;document.getElementById('statusbar').textContent='✅ 已裁剪 '+cw+'×'+ch;}

// ── 叠加层 ──
function drawOverlay(){
  if(!imgW)return;
  ovCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  // mask预览
  const md=maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height);
  let hasMask=false;for(let i=3;i<md.data.length;i+=4){if(md.data[i]>0){hasMask=true;break;}}
  if(hasMask){ovCtx.globalAlpha=0.35;ovCtx.drawImage(maskCanvas,0,0);ovCtx.globalAlpha=1;}
  // 选区
  if(selRect){
    const x0=Math.min(selRect.x0,selRect.x1),y0=Math.min(selRect.y0,selRect.y1),w=Math.abs(selRect.x1-selRect.x0),h=Math.abs(selRect.y1-selRect.y0);
    // 蚂蚁线
    ovCtx.strokeStyle='#0078d4';ovCtx.lineWidth=1/scale;ovCtx.setLineDash([4/scale,4/scale]);ovCtx.strokeRect(x0,y0,w,h);ovCtx.setLineDash([]);
    // 暗化选区外
    ovCtx.fillStyle='rgba(0,0,0,0.3)';
    ovCtx.fillRect(0,0,imgW,y0);ovCtx.fillRect(0,y0,x0,h);ovCtx.fillRect(x0+w,y0,imgW-x0-w,h);ovCtx.fillRect(0,y0+h,imgW,imgH-y0-h);
    // 选区边框
    ovCtx.strokeStyle='#fff';ovCtx.lineWidth=1/scale;ovCtx.setLineDash([4/scale,4/scale]);ovCtx.strokeRect(x0,y0,w,h);ovCtx.setLineDash([]);
  }
  // 图章源标记
  if(stampSrc&&tool==='stamp'){ovCtx.strokeStyle='#0f0';ovCtx.lineWidth=2/scale;const s=parseInt(document.getElementById('brushSize').value);ovCtx.strokeRect(stampSrcX-s/2,stampSrcY-s/2,s,s);}
}

// ── 撤销/重做 ──
function pushHistory(){history=history.slice(0,historyIdx+1);const m=document.createElement('canvas');m.width=imgW;m.height=imgH;const mc=m.getContext('2d');for(const l of layers){if(l.visible){mc.globalAlpha=l.opacity;mc.drawImage(l.canvas,0,0);}}history.push(m.toDataURL());if(history.length>20)history.shift();else historyIdx++;}
function undo(){if(historyIdx<=0)return;historyIdx--;restoreHistory();}
function redo(){if(historyIdx>=history.length-1)return;historyIdx++;restoreHistory();}
function restoreHistory(){const img=new Image();img.onload=()=>{if(layers.length>0){layers[0].ctx.clearRect(0,0,imgW,imgH);layers[0].ctx.drawImage(img,0,0);for(let i=1;i<layers.length;i++)layers[i].ctx.clearRect(0,0,imgW,imgH);compositeLayers();}};img.src=history[historyIdx];}

// ── 保存 ──
function saveImage(){if(!imgW){alert('请先打开图片');return;}const m=document.createElement('canvas');m.width=imgW;m.height=imgH;const mc=m.getContext('2d');for(const l of layers){if(l.visible){mc.globalAlpha=l.opacity;mc.drawImage(l.canvas,0,0);}}m.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);const bn=imgPath?imgPath.replace(/[\\/]/g,'/').split('/').pop().replace(/\.[^.]+$/,''):'image';a.download=bn+'_edited.png';a.click();document.getElementById('statusbar').textContent='💾 已保存 '+a.download;},'image/png');}

// ── 键盘 ──
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  if(e.ctrlKey||e.metaKey){if(e.key==='z'){e.preventDefault();undo();}if(e.key==='y'){e.preventDefault();redo();}if(e.key==='s'){e.preventDefault();saveImage();}return;}
  const map={m:'rect',v:'move',c:'crop',b:'brush',n:'pencil',s:'stamp',e:'eraser',g:'gradient',t:'text',r:'blur',d:'dodge',w:'inpaint'};
  if(map[e.key.toLowerCase()])setTool(map[e.key.toLowerCase()]);
});

// ── 初始化 ──
initToolbar();
(function(){const params=new URLSearchParams(location.search);imgPath=params.get('path');if(!imgPath)return;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{setImage(img,imgPath.replace(/[\\/]/g,'/').split('/').pop());aspectRatio=img.width/img.height;};img.onerror=()=>{document.getElementById('statusbar').textContent='图片加载失败';};img.src='/api/image?path='+encodeURIComponent(imgPath);})();
