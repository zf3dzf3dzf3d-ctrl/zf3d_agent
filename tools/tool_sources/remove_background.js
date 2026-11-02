const { createApp } = Vue;
createApp({components:{HeaderComponent,FooterComponent,CookieConsent}}).mount('#app');

(() => {
    const maxPixels = 12000000, maxHistory = 6;
    const fileInput = document.getElementById('rb-file'), dropZone = document.getElementById('rb-drop'), sourceEditor = document.getElementById('rb-source-editor'), resultEditor = document.getElementById('rb-result-editor'), resultEmpty = document.getElementById('rb-result-empty');
    const sourceCanvas = document.getElementById('rb-source'), resultCanvas = document.getElementById('rb-result'), sourceCanvasWrap = document.getElementById('rb-source-wrap');
    const sourceCtx = sourceCanvas.getContext('2d', {willReadFrequently:true}), resultCtx = resultCanvas.getContext('2d', {willReadFrequently:true});
    sourceCtx.imageSmoothingEnabled = false; resultCtx.imageSmoothingEnabled = false;
    const tolerance = document.getElementById('rb-tolerance'), feather = document.getElementById('rb-feather'), brush = document.getElementById('rb-brush'), colorInput = document.getElementById('rb-color'), colorValue = document.getElementById('rb-color-value'), pickColorButton = document.getElementById('rb-pick-color'), randomBackgroundButton = document.getElementById('rb-random-bg'), previewBackgroundValue = document.getElementById('rb-preview-bg-value'), brushRing = document.getElementById('rb-brush-ring'), resultCanvasWrap = resultCanvas.parentElement;
    const undoButton = document.getElementById('rb-undo'), redoButton = document.getElementById('rb-redo'), fitButton = document.getElementById('rb-fit'), resetButton = document.getElementById('rb-reset'), downloadButton = document.getElementById('rb-download'), libraryLink = document.getElementById('rb-library-link'), tokenBalance = document.getElementById('rb-token-balance');
    const cropX = document.getElementById('rb-crop-x'), cropY = document.getElementById('rb-crop-y'), cropW = document.getElementById('rb-crop-w'), cropH = document.getElementById('rb-crop-h'), cropPreviewButton = document.getElementById('rb-crop-preview'), cropApply = document.getElementById('rb-crop-apply'), cropBox = document.getElementById('rb-crop-box'), cropSize = document.getElementById('rb-crop-size');
    const resizeW = document.getElementById('rb-resize-w'), resizeH = document.getElementById('rb-resize-h'), resizeLock = document.getElementById('rb-resize-lock'), resizeApply = document.getElementById('rb-resize-apply');
    let original = null, result = null, background = {r:255,g:255,b:255}, undoHistory = [], redoHistory = [], mode = 'erase', fileName = 'image', pointerOperation = null, isSaving = false, pickingColor = false, cropPreview = false, cropRect = null, cropOperation = null;
    const sourceView = { scale: 1, x: 0, y: 0 }, resultView = { scale: 1, x: 0, y: 0 };

    function setValue(input, output) { output.textContent = input.value; }
    [[tolerance,'rb-tolerance-value'],[feather,'rb-feather-value'],[brush,'rb-brush-value']].forEach(([input,id]) => { setValue(input, document.getElementById(id)); input.addEventListener('input', () => { setValue(input, document.getElementById(id)); if (original && input !== brush) processBackground(); }); });
    document.querySelectorAll('.rb-mode button').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; document.querySelectorAll('.rb-mode button').forEach(item => item.classList.toggle('active', item === button)); }));

    function setStatus(message) { document.getElementById('rb-status').textContent = message || ''; }
    async function loadTokenBalance() {
        try {
            const response = await fetch('/api/tool_api.asp?a=balance', {credentials:'same-origin', cache:'no-store'});
            const raw = await response.text();
            let payload;
            try { payload = JSON.parse(raw); } catch (error) { throw new Error('invalid response'); }
            if (payload.success && payload.data) tokenBalance.textContent = payload.data.token_balance;
            else tokenBalance.textContent = (payload.message || '').indexOf('登录') >= 0 ? '登录后查看' : '暂不可用';
        } catch (error) {
            tokenBalance.textContent = '加载失败';
        }
    }
    loadTokenBalance();
    function cloneImageData(data) { const copy = new ImageData(data.width, data.height); copy.data.set(data.data); return copy; }
    function updateActions() { const ready = !!result; undoButton.disabled = undoHistory.length === 0; redoButton.disabled = redoHistory.length === 0; fitButton.disabled = !ready; resetButton.disabled = !ready; downloadButton.disabled = !ready || isSaving; cropPreviewButton.disabled = !ready; cropApply.disabled = !ready; resizeApply.disabled = !ready; }
    function drawSource() { sourceCtx.putImageData(original, 0, 0); }
    function drawResult() { resultCtx.putImageData(result, 0, 0); }
    function pushHistory() { if (!result) return; undoHistory.push(cloneImageData(result)); if (undoHistory.length > maxHistory) undoHistory.shift(); redoHistory = []; updateActions(); }
    function baseCanvasSize(canvas) {
        const wrap = canvas.parentElement;
        const availableWidth = Math.max(1, wrap.clientWidth - 20);
        const availableHeight = Math.max(1, wrap.clientHeight - 20);
        const fitScale = Math.min(1, availableWidth / canvas.width, availableHeight / canvas.height);
        return { width: Math.max(1, Math.round(canvas.width * fitScale)), height: Math.max(1, Math.round(canvas.height * fitScale)) };
    }
    function applyView(canvas, view) {
        const base = baseCanvasSize(canvas);
        canvas.style.width = Math.max(1, Math.round(base.width * view.scale)) + 'px';
        canvas.style.height = Math.max(1, Math.round(base.height * view.scale)) + 'px';
        canvas.style.imageRendering = 'pixelated';
        canvas.style.transform = 'translate(calc(-50% + ' + Math.round(view.x) + 'px),calc(-50% + ' + Math.round(view.y) + 'px))';
        if (canvas === sourceCanvas && cropPreview) requestAnimationFrame(renderCropBox);
    }
    function fitViews() { Object.assign(sourceView, {scale:1,x:0,y:0}); Object.assign(resultView, {scale:1,x:0,y:0}); applyView(sourceCanvas, sourceView); applyView(resultCanvas, resultView); }
    function updateTransformFields() { if (!original) return; cropRect={x:0,y:0,w:original.width,h:original.height}; cropX.value=0; cropY.value=0; cropW.value=original.width; cropH.value=original.height; resizeW.value=original.width; resizeH.value=original.height; document.getElementById('rb-file-meta').textContent=original.width+' x '+original.height+' px'; }
    function readCropRect() { if (!original) return null; const x=Math.max(0,Math.min(original.width-1,Math.floor(Number(cropX.value)||0))), y=Math.max(0,Math.min(original.height-1,Math.floor(Number(cropY.value)||0))); return {x:x,y:y,w:Math.max(1,Math.min(original.width-x,Math.floor(Number(cropW.value)||1))),h:Math.max(1,Math.min(original.height-y,Math.floor(Number(cropH.value)||1)))}; }
    function syncCropFields() { if (!cropRect) return; cropX.value=cropRect.x; cropY.value=cropRect.y; cropW.value=cropRect.w; cropH.value=cropRect.h; }
    function renderCropBox() { if (!cropPreview || !cropRect || !original) return; const canvasRect=sourceCanvas.getBoundingClientRect(), wrapRect=sourceCanvasWrap.getBoundingClientRect(); if (!canvasRect.width || !canvasRect.height) return; const scaleX=canvasRect.width/original.width, scaleY=canvasRect.height/original.height; cropBox.style.left=(canvasRect.left-wrapRect.left+cropRect.x*scaleX)+'px'; cropBox.style.top=(canvasRect.top-wrapRect.top+cropRect.y*scaleY)+'px'; cropBox.style.width=Math.max(1,cropRect.w*scaleX)+'px'; cropBox.style.height=Math.max(1,cropRect.h*scaleY)+'px'; cropSize.textContent=cropRect.w+' x '+cropRect.h+' px'; }
    function toggleCropPreview() { if (!original) return; cropPreview=!cropPreview; if (cropPreview) { cropRect=readCropRect(); cropBox.hidden=false; cropPreviewButton.textContent='退出预览'; requestAnimationFrame(renderCropBox); setStatus('拖动裁剪框或边缘滑块调整区域，确认后才会裁剪图片。'); } else { cropBox.hidden=true; cropPreviewButton.textContent='裁剪预览'; setStatus('已退出裁剪预览。'); } }
    function replaceImageSize(width, height, sourceX, sourceY, sourceWidth, sourceHeight) {
        if (!original || width < 1 || height < 1 || width * height > maxPixels) { setStatus('图片尺寸无效，或超过 1200 万像素限制。'); return false; }
        const temp=document.createElement('canvas'); temp.width=width; temp.height=height; const ctx=temp.getContext('2d', {willReadFrequently:true}); ctx.imageSmoothingEnabled=true; ctx.drawImage(sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height); original=ctx.getImageData(0,0,width,height); sourceCanvas.width=resultCanvas.width=width; sourceCanvas.height=resultCanvas.height=height; sourceCtx.putImageData(original,0,0); detectBackground(); processBackground(); fitViews(); updateTransformFields(); return true;
    }
    function applyCrop() { if (!original) return; const selected=cropPreview && cropRect ? cropRect : readCropRect(); const x=selected.x, y=selected.y, w=selected.w, h=selected.h; if (cropPreview) toggleCropPreview(); if (replaceImageSize(w,h,x,y,w,h)) setStatus('裁剪已应用，可继续去背景和修边。'); }
    function applyResize() { if (!original) return; const w=Math.floor(Number(resizeW.value)||0), h=Math.floor(Number(resizeH.value)||0); if (replaceImageSize(w,h,0,0,original.width,original.height)) setStatus('自定义尺寸已应用，可继续去背景和修边。'); }
    function hexPart(value) { return ('0' + Math.max(0, Math.min(255, Math.round(value))).toString(16)).slice(-2); }
    function updateBackgroundColor(r, g, b) { background = {r:Math.round(r),g:Math.round(g),b:Math.round(b)}; const hex = '#' + hexPart(background.r) + hexPart(background.g) + hexPart(background.b); colorInput.value = hex; colorValue.textContent = hex.toUpperCase(); }
    function randomPreviewBackground() {
        const hue = Math.floor(Math.random() * 360), saturation = 45 + Math.floor(Math.random() * 36), lightness = 28 + Math.floor(Math.random() * 46);
        const color = 'hsl(' + hue + ' ' + saturation + '% ' + lightness + '%)';
        resultCanvasWrap.style.backgroundImage = 'none';
        resultCanvasWrap.style.backgroundColor = color;
        previewBackgroundValue.textContent = color;
        randomBackgroundButton.style.backgroundColor = color;
        randomBackgroundButton.style.color = lightness > 58 ? '#111827' : '#ffffff';
        if (result) setStatus('已切换预览背景，保存 PNG 保持透明。');
    }
    function distance(r,g,b) { return Math.sqrt((r-background.r)**2 + (g-background.g)**2 + (b-background.b)**2); }
    function detectBackground() {
        const data = original.data, w = original.width, h = original.height, points = [[0,0],[w-1,0],[0,h-1],[w-1,h-1]];
        let r=0,g=0,b=0,count=0;
        points.forEach(([cx,cy]) => { for(let y=Math.max(0,cy-3); y<=Math.min(h-1,cy+3); y++) for(let x=Math.max(0,cx-3); x<=Math.min(w-1,cx+3); x++){ const i=(y*w+x)*4; r+=data[i];g+=data[i+1];b+=data[i+2];count++; } });
        updateBackgroundColor(r/count, g/count, b/count);
    }
    function processBackground() {
        if (!original) return;
        const tol = Number(tolerance.value), soft = Math.max(1, Number(feather.value)), src = original.data, next = new ImageData(original.width, original.height), dst = next.data;
        for (let i=0;i<src.length;i+=4) { const d = distance(src[i],src[i+1],src[i+2]); dst[i]=src[i];dst[i+1]=src[i+1];dst[i+2]=src[i+2]; dst[i+3] = d <= tol ? 0 : (d < tol + soft ? Math.round(255 * (d - tol) / soft) : src[i+3]); }
        result = next; undoHistory = []; redoHistory = []; drawResult(); updateActions(); setStatus('已根据图片边角自动检测背景色，可继续调节容差或修边。');
    }
    function setupImage(file) {
        if (!file || !file.type.startsWith('image/')) return;
        fileName = file.name.replace(/\.[^.]+$/, '') || 'image'; const image = new Image(), url = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(url); let w=image.naturalWidth,h=image.naturalHeight; if (w*h > maxPixels) { const scale=Math.sqrt(maxPixels/(w*h));w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale)); setStatus('原图较大，已在浏览器中缩放后处理。'); }
            cropPreview=false; cropBox.hidden=true; cropPreviewButton.textContent='裁剪预览';
            sourceCanvas.width=resultCanvas.width=w; sourceCanvas.height=resultCanvas.height=h; sourceCtx.imageSmoothingEnabled=false; resultCtx.imageSmoothingEnabled=false; sourceCtx.drawImage(image,0,0,w,h); original=sourceCtx.getImageData(0,0,w,h); drawSource(); fitViews(); detectBackground(); processBackground(); updateTransformFields(); sourceEditor.classList.add('show'); resultEditor.classList.add('show'); resultEmpty.style.display='none'; dropZone.style.display='none'; document.getElementById('rb-file-name').textContent=file.name;document.getElementById('rb-file-meta').textContent=w+' x '+h+' px';
            requestAnimationFrame(fitViews);
        };
        image.onerror=()=>setStatus('图片读取失败，请换一张图片重试。'); image.src=url;
    }
    fileInput.addEventListener('change', event => setupImage(event.target.files[0]));
    ['dragenter','dragover'].forEach(eventName => dropZone.addEventListener(eventName, event => { event.preventDefault();dropZone.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(eventName => dropZone.addEventListener(eventName, event => { event.preventDefault();dropZone.classList.remove('dragover'); }));
    dropZone.addEventListener('drop', event => setupImage(event.dataTransfer.files[0]));
    resetButton.addEventListener('click', () => { if (original) { detectBackground(); processBackground(); fitViews(); } });
    colorInput.addEventListener('input', () => { const value=colorInput.value; updateBackgroundColor(parseInt(value.slice(1,3),16),parseInt(value.slice(3,5),16),parseInt(value.slice(5,7),16)); if (original) processBackground(); });
    pickColorButton.addEventListener('click', () => { if (!original) { setStatus('请先选择图片。'); return; } pickingColor = !pickingColor; pickColorButton.classList.toggle('active', pickingColor); pickColorButton.textContent = pickingColor ? '按住原图取色' : '从原图取色'; sourceCanvas.style.cursor = pickingColor ? 'crosshair' : ''; setStatus(pickingColor ? '请在左侧原图按住鼠标左键取色，移动可实时预览，松开确认。' : '已取消取色。'); });
    randomBackgroundButton.addEventListener('click', randomPreviewBackground);
    undoButton.addEventListener('click', undo);
    redoButton.addEventListener('click', redo);
    fitButton.addEventListener('click', fitViews);
    cropPreviewButton.addEventListener('click', toggleCropPreview);
    cropApply.addEventListener('click', applyCrop);
    [cropX,cropY,cropW,cropH].forEach(input => input.addEventListener('input', () => { cropRect=readCropRect(); if (cropPreview) requestAnimationFrame(renderCropBox); }));
    resizeApply.addEventListener('click', applyResize);
    resizeW.addEventListener('input', () => { if (!resizeLock.checked || !original) return; resizeH.value=Math.max(1,Math.round(Number(resizeW.value||1)*original.height/original.width)); });
    resizeH.addEventListener('input', () => { if (!resizeLock.checked || !original) return; resizeW.value=Math.max(1,Math.round(Number(resizeH.value||1)*original.width/original.height)); });
    function undo() { if (!undoHistory.length) return; redoHistory.push(cloneImageData(result)); result = undoHistory.pop(); drawResult(); updateActions(); setStatus('已撤销上一次修边。'); }
    function redo() { if (!redoHistory.length) return; undoHistory.push(cloneImageData(result)); result = redoHistory.pop(); drawResult(); updateActions(); setStatus('已重做上一次修边。'); }
    function pointFromEvent(event, canvas) { const rect = canvas.getBoundingClientRect(); return {x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height}; }
    function applyBrushAt(point, restore) { const radius=Number(brush.value)/2, data=result.data,w=result.width,h=result.height; for(let y=Math.max(0,Math.floor(point.y-radius));y<=Math.min(h-1,Math.ceil(point.y+radius));y++) for(let x=Math.max(0,Math.floor(point.x-radius));x<=Math.min(w-1,Math.ceil(point.x+radius));x++){ const dx=x-point.x,dy=y-point.y;if(dx*dx+dy*dy<=radius*radius){const i=(y*w+x)*4;data[i+3]=restore?255:0;} } }
    function applyBrushSegment(from, to, restore) { if (!result) return; const distance=Math.hypot(to.x-from.x,to.y-from.y), steps=Math.max(1,Math.ceil(distance/Math.max(1,Number(brush.value)/2))); for(let i=0;i<=steps;i++) applyBrushAt({x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps},restore); drawResult(); }
    function previewColorFromSource(event) { const point=pointFromEvent(event,sourceCanvas), x=Math.max(0,Math.min(sourceCanvas.width-1,Math.floor(point.x))), y=Math.max(0,Math.min(sourceCanvas.height-1,Math.floor(point.y))), pixel=original.data.slice((y*sourceCanvas.width+x)*4,(y*sourceCanvas.width+x)*4+3); updateBackgroundColor(pixel[0],pixel[1],pixel[2]); processBackground(); }
    function stopColorPicking() { pickingColor=false; pickColorButton.classList.remove('active'); pickColorButton.textContent='从原图取色'; sourceCanvas.style.cursor=''; setStatus('已吸取背景色，可继续微调容差和羽化。'); }
    function updateBrushPreview(event) { if (!result) return; const canvasRect=resultCanvas.getBoundingClientRect(), wrapRect=resultCanvas.parentElement.getBoundingClientRect(); if (event.clientX<canvasRect.left || event.clientX>canvasRect.right || event.clientY<canvasRect.top || event.clientY>canvasRect.bottom) { brushRing.style.display='none'; return; } const diameter=Math.max(4,Number(brush.value)*canvasRect.width/resultCanvas.width); brushRing.style.width=diameter+'px'; brushRing.style.height=diameter+'px'; brushRing.style.left=(event.clientX-wrapRect.left)+'px'; brushRing.style.top=(event.clientY-wrapRect.top)+'px'; brushRing.style.display='block'; }
    function zoomAtPointer(event, canvas, view) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect(), wrapRect = canvas.parentElement.getBoundingClientRect();
        const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        const nextScale = Math.max(.15, Math.min(32, view.scale * (event.deltaY > 0 ? .9 : 1.1)));
        const base = baseCanvasSize(canvas), nextWidth = base.width * nextScale, nextHeight = base.height * nextScale;
        const nextLeft = event.clientX - ratioX * nextWidth, nextTop = event.clientY - ratioY * nextHeight;
        view.x = nextLeft - (wrapRect.left + wrapRect.width / 2 - nextWidth / 2);
        view.y = nextTop - (wrapRect.top + wrapRect.height / 2 - nextHeight / 2);
        view.scale = nextScale;
        applyView(canvas, view);
    }
    function bindViewport(canvas, view, editable) {
        canvas.addEventListener('wheel', event => zoomAtPointer(event, canvas, view), {passive:false});
        canvas.addEventListener('pointerdown', event => {
            if (!result) return;
            if (!editable && pickingColor && event.button === 0) { event.preventDefault(); pointerOperation={kind:'pick',canvas}; try { canvas.setPointerCapture(event.pointerId); } catch (ignore) {} previewColorFromSource(event); setStatus('正在预览背景颜色，松开鼠标左键确认。'); return; }
            if (event.button === 1) { event.preventDefault(); pointerOperation={kind:'pan',canvas,view,lastX:event.clientX,lastY:event.clientY}; try { canvas.setPointerCapture(event.pointerId); } catch (ignore) {} canvas.style.cursor='grabbing'; return; }
            if (!editable || event.button !== 0) return;
            event.preventDefault(); try { canvas.setPointerCapture(event.pointerId); } catch (ignore) {}
            if (event.ctrlKey || event.metaKey) { pointerOperation={kind:'size',canvas,startX:event.clientX,startSize:Number(brush.value)}; return; }
            const startPoint=pointFromEvent(event,resultCanvas); pointerOperation={kind:'brush',canvas,restore:event.altKey,lastPoint:startPoint}; pushHistory(); applyBrushSegment(startPoint,startPoint,event.altKey||mode==='restore');
        });
        canvas.addEventListener('pointermove', event => {
            if (editable) updateBrushPreview(event);
            if (!pointerOperation || pointerOperation.canvas !== canvas) return;
            if (pointerOperation.kind === 'pan') { pointerOperation.view.x += event.clientX-pointerOperation.lastX; pointerOperation.view.y += event.clientY-pointerOperation.lastY; pointerOperation.lastX=event.clientX; pointerOperation.lastY=event.clientY; applyView(canvas,pointerOperation.view); }
            if (pointerOperation.kind === 'pick') { previewColorFromSource(event); return; }
            if (pointerOperation.kind === 'size') { brush.value=Math.max(4,Math.min(240,pointerOperation.startSize+Math.round((event.clientX-pointerOperation.startX)/2))); setValue(brush,document.getElementById('rb-brush-value')); if (editable) updateBrushPreview(event); }
            if (pointerOperation.kind === 'brush') { const nextPoint=pointFromEvent(event,resultCanvas); applyBrushSegment(pointerOperation.lastPoint,nextPoint,pointerOperation.restore||mode==='restore'); pointerOperation.lastPoint=nextPoint; }
        });
        canvas.addEventListener('pointerleave', () => { if (editable && (!pointerOperation || pointerOperation.canvas !== canvas)) brushRing.style.display='none'; });
        ['pointerup','pointercancel','lostpointercapture'].forEach(eventName => canvas.addEventListener(eventName, () => { if (pointerOperation && pointerOperation.canvas === canvas) { const finishedOperation=pointerOperation; pointerOperation=null; canvas.style.cursor=editable?'crosshair':''; if (finishedOperation.kind === 'pick') stopColorPicking(); } }));
    }
    function updateCropFromPointer(event) {
        if (!cropOperation || !original) return;
        const canvasRect=sourceCanvas.getBoundingClientRect(), scaleX=canvasRect.width/original.width, scaleY=canvasRect.height/original.height;
        if (!scaleX || !scaleY) return;
        const dx=(event.clientX-cropOperation.startClientX)/scaleX, dy=(event.clientY-cropOperation.startClientY)/scaleY, start=cropOperation.startRect, handle=cropOperation.handle, minW=Math.min(16,original.width), minH=Math.min(16,original.height);
        let left=start.x, top=start.y, right=start.x+start.w, bottom=start.y+start.h;
        if (handle === 'move') { left=Math.max(0,Math.min(original.width-start.w,start.x+dx)); top=Math.max(0,Math.min(original.height-start.h,start.y+dy)); right=left+start.w; bottom=top+start.h; }
        else {
            if (handle.indexOf('w') >= 0) left+=dx;
            if (handle.indexOf('e') >= 0) right+=dx;
            if (handle.indexOf('n') >= 0) top+=dy;
            if (handle.indexOf('s') >= 0) bottom+=dy;
            left=Math.max(0,Math.min(original.width-minW,left)); right=Math.max(minW,Math.min(original.width,right)); top=Math.max(0,Math.min(original.height-minH,top)); bottom=Math.max(minH,Math.min(original.height,bottom));
            if (right-left<minW) { if (handle.indexOf('w') >= 0) left=right-minW; else right=left+minW; }
            if (bottom-top<minH) { if (handle.indexOf('n') >= 0) top=bottom-minH; else bottom=top+minH; }
        }
        cropRect={x:Math.round(left),y:Math.round(top),w:Math.max(1,Math.round(right-left)),h:Math.max(1,Math.round(bottom-top))}; syncCropFields(); renderCropBox();
    }
    cropBox.addEventListener('pointerdown', event => {
        if (!cropPreview || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); const handle=event.target.dataset.handle || 'move'; cropOperation={handle:handle,startClientX:event.clientX,startClientY:event.clientY,startRect:{x:cropRect.x,y:cropRect.y,w:cropRect.w,h:cropRect.h}}; try { cropBox.setPointerCapture(event.pointerId); } catch (ignore) {}
    });
    cropBox.addEventListener('pointermove', event => updateCropFromPointer(event));
    ['pointerup','pointercancel','lostpointercapture'].forEach(eventName => cropBox.addEventListener(eventName, () => { cropOperation=null; }));
    bindViewport(sourceCanvas, sourceView, false);
    bindViewport(resultCanvas, resultView, true);
    document.addEventListener('keydown', event => { if (!(event.ctrlKey || event.metaKey)) return; const key=event.key.toLowerCase(); if (key==='z') { event.preventDefault(); undo(); } if (key==='y') { event.preventDefault(); redo(); } });
    downloadButton.addEventListener('click', () => {
        if (!result || isSaving) return;
        isSaving = true; updateActions(); downloadButton.textContent = '正在保存...'; setStatus('正在同步到个人图片库...');
        resultCanvas.toBlob(async blob => {
            if (!blob) { isSaving = false; downloadButton.textContent = '保存到我的图片库'; updateActions(); setStatus('生成图片失败，请重试。'); return; }
            const saveController = new AbortController();
            const saveTimeout = window.setTimeout(() => saveController.abort(), 45000);
            try {
                const imageData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
                const response = await fetch('/api/tool_api.asp?a=background_save', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body:'image_data=' + encodeURIComponent(imageData), signal:saveController.signal});
                const responseText = await response.text();
                let payload;
                try { payload = JSON.parse(responseText); } catch (ignore) { throw new Error('服务端保存异常，请稍后重试。'); }
                if (!payload.success) {
                    if ((payload.message || '').indexOf('登录') >= 0) { window.location.href = '/login.html?redirect=/remove_background.asp'; return; }
                    throw new Error(payload.message || '保存失败');
                }
                tokenBalance.textContent = payload.data.token_balance;
                setStatus('已保存到个人图片库，本次消耗 1 次，剩余 ' + payload.data.token_balance + ' 次。');
            } catch (error) {
                setStatus(error.name === 'AbortError' ? '保存超时，请稍后重试。' : (error.message || '网络错误，请稍后重试。'));
            } finally {
                window.clearTimeout(saveTimeout);
                isSaving = false; downloadButton.textContent = '保存到我的图片库'; updateActions();
            }
        }, 'image/png');
    });
})();