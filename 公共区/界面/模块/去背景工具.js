/**
 * 去背景工具 — 集成到zf3d智能体图片查看器
 * 点击图片查看器中的"去背景"按钮打开，自动加载当前图片
 * 保存时自动命名 原文件名_去背景.png 存到同目录
 */
(function() {

let bg1 = { r:255, g:255, b:255 };
let bg2 = { r:204, g:204, b:204 };
let origImageData = null;
let originalW = 0, originalH = 0;
let currentImagePath = '';
let currentImageName = '';
let pickTarget = 0;
let historyStack = [];
let historyIndex = -1;
const MAX_HISTORY = 30;

// ── DOM ──
const overlay = document.getElementById('bgRemoverOverlay');
const canvasOrig = document.getElementById('bgCanvasOrig');
const canvasResult = document.getElementById('bgCanvasResult');
const wrapOrig = document.getElementById('bgCanvasWrapOrig');
const wrapResult = document.getElementById('bgCanvasWrapResult');
const swatch1 = document.getElementById('bgSwatch1');
const swatch2 = document.getElementById('bgSwatch2');
const tolInput = document.getElementById('bgTolerance');
const featherInput = document.getElementById('bgFeather');
const eraserSizeInput = document.getElementById('bgEraserSize');
const eraserOpacityInput = document.getElementById('bgEraserOpacity');
const resizePctInput = document.getElementById('bgResizePct');
const undoBtn = document.getElementById('bgUndoBtn');
const redoBtn = document.getElementById('bgRedoBtn');
const downloadBtn = document.getElementById('bgDownloadBtn');
const zoomPill = document.getElementById('bgZoomPill');
const info = document.getElementById('bgRemoverInfo');

// ═════════════════════════════════════════════════════════════════
//  Viewport
// ═════════════════════════════════════════════════════════════════

class VP {
  constructor(canvas, container, isResult) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');
    this.isResult = isResult || false;
    this.scale = 1;
    this.offsetX = 0; this.offsetY = 0;
    this.dragging = false; this.picking = false;
    this.erasing = false; this.restoring = false; this.sizing = false;
    this.lastX = 0; this.lastY = 0;
    this.sizingStartX = 0; this.sizingStartSize = 20;
    this.mouseImgX = -1; this.mouseImgY = -1; this.mouseInside = false;
    this.imageData = null;
    this._off = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d');
    this.bind();
  }

  bind() {
    this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('mousedown', e => this.onDown(e));
    this.canvas.addEventListener('mousemove', e => this.onMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.mouseInside = false; this.redraw(); });
    this.canvas.addEventListener('mouseenter', () => { this.mouseInside = true; });
    window.addEventListener('mouseup', e => this.onUp(e));
  }

  screenToImg(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left - this.offsetX) / this.scale), y: Math.floor((e.clientY - r.top - this.offsetY) / this.scale) };
  }

  onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const ns = Math.max(0.05, Math.min(40, this.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
    this.offsetX = mx - (mx - this.offsetX) * (ns / this.scale);
    this.offsetY = my - (my - this.offsetY) * (ns / this.scale);
    this.scale = ns;
    this.redraw(); updateZoom();
  }

  onDown(e) {
    e.preventDefault();
    const { x, y } = this.screenToImg(e);
    this.mouseImgX = x; this.mouseImgY = y;
    if (e.button === 0 && pickTarget > 0 && !this.isResult) { this.picking = true; this.prevPick(e); return; }
    if (e.button === 0 && this.isResult) {
      if (e.ctrlKey || e.metaKey) { this.sizing = true; this.sizingStartX = e.clientX; this.sizingStartSize = parseInt(eraserSizeInput.value); return; }
      if (e.altKey) { this.restoring = true; pushHistory(this.imageData); this.restoreAt(x, y); return; }
      this.erasing = true; pushHistory(this.imageData); this.eraseAt(x, y); return;
    }
    this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; this.canvas.style.cursor = 'grabbing';
  }

  onMove(e) {
    const { x, y } = this.screenToImg(e);
    this.mouseImgX = x; this.mouseImgY = y; this.mouseInside = true;
    if (this.dragging) { this.offsetX += e.clientX - this.lastX; this.offsetY += e.clientY - this.lastY; this.lastX = e.clientX; this.lastY = e.clientY; this.redraw(); }
    if (this.picking) this.prevPick(e);
    if (this.erasing) this.eraseAt(x, y);
    if (this.restoring) this.restoreAt(x, y);
    if (this.sizing) { const dx = e.clientX - this.sizingStartX; const ns = Math.max(2, Math.min(200, this.sizingStartSize + Math.round(dx / 2))); eraserSizeInput.value = ns; document.getElementById('bgEraserSizeVal').textContent = ns; this.redraw(); }
    if (this.isResult && !this.erasing && !this.restoring && !this.sizing) this.redraw();
  }

  onUp(e) {
    if (this.picking) { this.picking = false; this.confirmPick(e); return; }
    if (this.erasing) { this.erasing = false; return; }
    if (this.restoring) { this.restoring = false; return; }
    if (this.sizing) { this.sizing = false; return; }
    this.dragging = false; this.canvas.style.cursor = '';
  }

  prevPick(e) {
    const { x, y } = this.screenToImg(e);
    if (!origImageData || x < 0 || y < 0 || x >= origImageData.width || y >= origImageData.height) return;
    const i = (y * origImageData.width + x) * 4;
    const d = origImageData.data;
    const r = d[i], g = d[i+1], b = d[i+2];
    const hex = '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
    if (pickTarget === 1) { bg1 = { r, g, b }; swatch1.style.background = hex; }
    else { bg2 = { r, g, b }; swatch2.style.background = hex; }
    processBg();
  }

  confirmPick(e) {
    const { x, y } = this.screenToImg(e);
    if (!origImageData || x < 0 || y < 0 || x >= origImageData.width || y >= origImageData.height) {
      pickTarget = 0; document.getElementById('bgPickHint').style.display = 'none';
      document.getElementById('bgPickBtn1').classList.remove('active');
      document.getElementById('bgPickBtn2').classList.remove('active');
      return;
    }
    pickTarget = 0; document.getElementById('bgPickHint').style.display = 'none';
    document.getElementById('bgPickBtn1').classList.remove('active');
    document.getElementById('bgPickBtn2').classList.remove('active');
  }

  eraseAt(cx, cy) {
    if (!this.imageData) return;
    const sz = parseInt(eraserSizeInput.value), rad = Math.floor(sz / 2);
    const amt = Math.round(255 * parseInt(eraserOpacityInput.value) / 100);
    const d = this.imageData.data, w = this.imageData.width, h = this.imageData.height;
    for (let y = Math.max(0,cy-rad); y <= Math.min(h-1,cy+rad); y++)
      for (let x = Math.max(0,cx-rad); x <= Math.min(w-1,cx+rad); x++) {
        const i = (y*w+x)*4; if (d[i+3] > 0) d[i+3] = Math.max(0, d[i+3] - amt);
      }
    this.redraw();
  }

  restoreAt(cx, cy) {
    if (!this.imageData) return;
    const sz = parseInt(eraserSizeInput.value), rad = Math.floor(sz / 2);
    const amt = Math.round(255 * parseInt(eraserOpacityInput.value) / 100);
    const d = this.imageData.data, w = this.imageData.width, h = this.imageData.height;
    for (let y = Math.max(0,cy-rad); y <= Math.min(h-1,cy+rad); y++)
      for (let x = Math.max(0,cx-rad); x <= Math.min(w-1,cx+rad); x++) {
        const i = (y*w+x)*4; if (d[i+3] < 255) d[i+3] = Math.min(255, d[i+3] + amt);
      }
    this.redraw();
  }

  setFit(w, h) { const cw = this.container.clientWidth, ch = this.container.clientHeight; this.scale = Math.min(cw/w, ch/h); this.offsetX = (cw - w*this.scale)/2; this.offsetY = (ch - h*this.scale)/2; this.redraw(); updateZoom(); }
  setActual() { this.offsetX = 0; this.offsetY = 0; this.scale = 1; this.redraw(); updateZoom(); }
  setImageData(d) { this.imageData = d; this.setFit(d.width, d.height); }
  updateImageData(d) { this.imageData = d; this.redraw(); }

  redraw() {
    const ctx = this.ctx, cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);
    if (!this.imageData) return;
    ctx.imageSmoothingEnabled = false;
    ctx.save(); ctx.translate(this.offsetX, this.offsetY); ctx.scale(this.scale, this.scale);
    if (this._off.width !== this.imageData.width || this._off.height !== this.imageData.height) { this._off.width = this.imageData.width; this._off.height = this.imageData.height; }
    this._offCtx.putImageData(this.imageData, 0, 0);
    ctx.drawImage(this._off, 0, 0);
    ctx.restore();
    if (this.isResult && this.mouseInside && this.mouseImgX >= 0 && !this.dragging && !this.sizing) {
      const sz = parseInt(eraserSizeInput.value);
      const sx = this.mouseImgX * this.scale + this.offsetX - (sz * this.scale) / 2;
      const sy = this.mouseImgY * this.scale + this.offsetY - (sz * this.scale) / 2;
      const col = this.restoring ? '#0f0' : '#f44';
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, sz * this.scale, sz * this.scale);
      ctx.strokeStyle = '#fff'; ctx.setLineDash([3,3]); ctx.lineWidth = 1; ctx.strokeRect(sx, sy, sz * this.scale, sz * this.scale); ctx.setLineDash([]);
      if (this.sizing) { ctx.fillStyle = '#ff0'; ctx.font = '12px sans-serif'; ctx.fillText(sz + 'px', sx + sz * this.scale + 4, sy + 14); }
    }
  }
}

let vpOrig = null, vpResult = null;

function updateZoom() { if (!vpOrig) return; zoomPill.textContent = `缩放 ${Math.round(vpOrig.scale * 100)}%`; zoomPill.style.display = 'inline-block'; }

// ═════════════════════════════════════════════════════════════════
//  历史
// ═════════════════════════════════════════════════════════════════

function pushHistory(d) {
  historyStack = historyStack.slice(0, historyIndex + 1);
  const s = new ImageData(d.width, d.height); s.data.set(d.data);
  historyStack.push(s);
  if (historyStack.length > MAX_HISTORY) historyStack.shift(); else historyIndex++;
  updateUndoRedo();
}
function undo() { if (historyIndex <= 0) return; historyIndex--; vpResult.updateImageData(historyStack[historyIndex]); updateUndoRedo(); }
function redo() { if (historyIndex >= historyStack.length - 1) return; historyIndex++; vpResult.updateImageData(historyStack[historyIndex]); updateUndoRedo(); }
function updateUndoRedo() { undoBtn.disabled = historyIndex <= 0; redoBtn.disabled = historyIndex >= historyStack.length - 1; }

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
document.addEventListener('keydown', e => {
  if (overlay.style.display === 'none') return;
  if (e.ctrlKey || e.metaKey) { if (e.key === 'z') { e.preventDefault(); undo(); } if (e.key === 'y') { e.preventDefault(); redo(); } }
});

// ═════════════════════════════════════════════════════════════════
//  打开/关闭
// ═════════════════════════════════════════════════════════════════

window.openBgRemover = function() {
  if (!currentViewFile || currentViewFile.类型 !== '图片') { alert('请先打开一张图片'); return; }
  currentImagePath = currentViewFile.路径;
  currentImageName = currentViewFile.名称;
  overlay.style.display = 'flex';
  // 加载图片
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const w = img.width, h = img.height;
    if (!vpOrig) vpOrig = new VP(canvasOrig, wrapOrig, false);
    if (!vpResult) vpResult = new VP(canvasResult, wrapResult, true);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').drawImage(img, 0, 0);
    origImageData = off.getContext('2d').getImageData(0, 0, w, h);
    originalW = w; originalH = h;
    resizePctInput.value = 100;
    document.getElementById('bgResizeVal').textContent = `100% (${w}×${h})`;
    vpOrig.setImageData(origImageData);
    const rd = off.getContext('2d').createImageData(w, h);
    rd.data.set(origImageData.data);
    vpResult.setImageData(rd);
    historyStack = []; historyIndex = -1; pushHistory(rd);
    info.textContent = `${currentImageName}  ${w}×${h}`;
    autoDetectBg();
  };
  img.onerror = () => { alert('图片加载失败'); closeBgRemover(); };
  img.src = `/api/image?path=${encodeURIComponent(currentImagePath)}`;
};

window.closeBgRemover = function() {
  overlay.style.display = 'none';
};

// ═════════════════════════════════════════════════════════════════
//  自动检测
// ═════════════════════════════════════════════════════════════════

function autoDetectBg() {
  if (!origImageData) return;
  const d = origImageData.data, w = origImageData.width, h = origImageData.height;
  const corners = [[0,0],[w-5,0],[0,h-5],[w-5,h-5]];
  let br = {r:0,g:0,b:0,c:0}, dk = {r:0,g:0,b:0,c:0};
  for (const [cx,cy] of corners) for (let y=cy;y<cy+5&&y<h;y++) for (let x=cx;x<cx+5&&x<w;x++) {
    const i = (y*w+x)*4, lum = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
    if (lum >= 128) { br.r+=d[i]; br.g+=d[i+1]; br.b+=d[i+2]; br.c++; } else { dk.r+=d[i]; dk.g+=d[i+1]; dk.b+=d[i+2]; dk.c++; }
  }
  if (br.c > 0) { bg1 = { r:Math.round(br.r/br.c), g:Math.round(br.g/br.c), b:Math.round(br.b/br.c) }; swatch1.style.background = '#' + [bg1.r,bg1.g,bg1.b].map(v=>v.toString(16).padStart(2,'0')).join(''); }
  if (dk.c > 0) { bg2 = { r:Math.round(dk.r/dk.c), g:Math.round(dk.g/dk.c), b:Math.round(dk.b/dk.c) }; swatch2.style.background = '#' + [bg2.r,bg2.g,bg2.b].map(v=>v.toString(16).padStart(2,'0')).join(''); }
  processBg();
}

document.getElementById('bgAutoBtn').addEventListener('click', autoDetectBg);

// 吸色按钮
document.getElementById('bgPickBtn1').addEventListener('click', function() {
  const on = pickTarget !== 1; pickTarget = on ? 1 : 0;
  this.classList.toggle('active', on);
  document.getElementById('bgPickBtn2').classList.remove('active');
  const hint = document.getElementById('bgPickHint');
  hint.style.display = on ? 'inline' : 'none';
  hint.textContent = on ? '拖拽原图取色→颜色1' : '';
});
document.getElementById('bgPickBtn2').addEventListener('click', function() {
  const on = pickTarget !== 2; pickTarget = on ? 2 : 0;
  this.classList.toggle('active', on);
  document.getElementById('bgPickBtn1').classList.remove('active');
  const hint = document.getElementById('bgPickHint');
  hint.style.display = on ? 'inline' : 'none';
  hint.textContent = on ? '拖拽原图取色→颜色2' : '';
});

// ═════════════════════════════════════════════════════════════════
//  去背景处理
// ═════════════════════════════════════════════════════════════════

function processBg() {
  if (!origImageData || !vpResult) return;
  const tol = parseInt(tolInput.value), fea = parseInt(featherInput.value);
  const src = origImageData.data, w = origImageData.width, h = origImageData.height;
  const result = new ImageData(w, h), dst = result.data;
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i+1], b = src[i+2];
    const d1 = Math.sqrt((r-bg1.r)**2 + (g-bg1.g)**2 + (b-bg1.b)**2);
    const d2 = Math.sqrt((r-bg2.r)**2 + (g-bg2.g)**2 + (b-bg2.b)**2);
    const md = Math.min(d1, d2);
    if (md <= tol) { dst[i]=r; dst[i+1]=g; dst[i+2]=b; dst[i+3]=0; }
    else if (md <= tol + fea) { dst[i]=r; dst[i+1]=g; dst[i+2]=b; dst[i+3]=Math.round(255*(md-tol)/fea); }
    else { dst[i]=r; dst[i+1]=g; dst[i+2]=b; dst[i+3]=255; }
  }
  vpResult.updateImageData(result);
  historyStack = []; historyIndex = -1; pushHistory(result);
}

[tolInput, featherInput].forEach(el => el.addEventListener('input', () => {
  document.getElementById('bgTolVal').textContent = tolInput.value;
  document.getElementById('bgFeatherVal').textContent = featherInput.value;
  processBg();
}));
[eraserSizeInput, eraserOpacityInput].forEach(el => el.addEventListener('input', () => {
  document.getElementById('bgEraserSizeVal').textContent = eraserSizeInput.value;
  document.getElementById('bgEraserOpacityVal').textContent = eraserOpacityInput.value;
  if (vpResult) vpResult.redraw();
}));

// ═════════════════════════════════════════════════════════════════
//  缩放
// ═════════════════════════════════════════════════════════════════

resizePctInput.addEventListener('input', () => {
  const pct = parseInt(resizePctInput.value) || 100;
  document.getElementById('bgResizeVal').textContent = `${pct}% (${Math.round(originalW*pct/100)}×${Math.round(originalH*pct/100)})`;
});

document.getElementById('bgResizeApplyBtn').addEventListener('click', () => {
  if (!vpResult.imageData) return;
  const pct = parseInt(resizePctInput.value) || 100;
  if (pct === 100) return;
  const nw = Math.max(1, Math.round(originalW * pct / 100)), nh = Math.max(1, Math.round(originalH * pct / 100));
  pushHistory(vpResult.imageData);
  const off = document.createElement('canvas'); off.width = vpResult.imageData.width; off.height = vpResult.imageData.height;
  off.getContext('2d').putImageData(vpResult.imageData, 0, 0);
  const sc = document.createElement('canvas'); sc.width = nw; sc.height = nh;
  const sctx = sc.getContext('2d'); sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(off, 0, 0, nw, nh);
  const nd = sctx.getImageData(0, 0, nw, nh);
  vpResult.updateImageData(nd);
  // 同步原图
  const off2 = document.createElement('canvas'); off2.width = origImageData.width; off2.height = origImageData.height;
  off2.getContext('2d').putImageData(origImageData, 0, 0);
  const sc2 = document.createElement('canvas'); sc2.width = nw; sc2.height = nh;
  const o2 = sc2.getContext('2d'); o2.imageSmoothingEnabled = true; o2.imageSmoothingQuality = 'high';
  o2.drawImage(off2, 0, 0, nw, nh);
  origImageData = o2.getImageData(0, 0, nw, nh);
  vpOrig.updateImageData(origImageData);
  pushHistory(nd);
  vpOrig.setFit(nw, nh); vpResult.setFit(nw, nh);
  info.textContent = `${currentImageName}  ${nw}×${nh} (撤销可恢复)`;
});

document.getElementById('bgFitBtn').addEventListener('click', () => { if (origImageData) { vpOrig.setFit(origImageData.width, origImageData.height); vpResult.setFit(origImageData.width, origImageData.height); } });
document.getElementById('bgActualBtn').addEventListener('click', () => { vpOrig.setActual(); vpResult.setActual(); });

// ═════════════════════════════════════════════════════════════════
//  背景色切换
// ═════════════════════════════════════════════════════════════════

document.querySelectorAll('.bg-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bg-color-btn').forEach(b => b.style.borderColor = '#555');
    btn.style.borderColor = '#6c5ce7';
    const bg = btn.dataset.bg;
    if (bg === 'checker') {
      wrapResult.style.backgroundImage = 'linear-gradient(45deg,#2a2a3a 25%,transparent 25%),linear-gradient(-45deg,#2a2a3a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a3a 75%),linear-gradient(-45deg,transparent 75%,#2a2a3a 75%)';
      wrapResult.style.backgroundSize = '16px 16px'; wrapResult.style.backgroundColor = '';
    } else {
      wrapResult.style.backgroundImage = 'none'; wrapResult.style.backgroundColor = bg;
    }
  });
});

// ═════════════════════════════════════════════════════════════════
//  保存 — 调用 /api/save-image
// ═════════════════════════════════════════════════════════════════

downloadBtn.addEventListener('click', async () => {
  if (!vpResult.imageData) return;
  // 生成保存路径：原文件名_去背景.png（保持原路径分隔符）
  const lastSep = Math.max(currentImagePath.lastIndexOf('/'), currentImagePath.lastIndexOf('\\'));
  const dir = currentImagePath.substring(0, lastSep);
  const baseName = currentImageName.replace(/\.[^.]+$/, '');
  const sep = currentImagePath.includes('\\') ? '\\' : '/';
  const savePath = dir + sep + baseName + '_去背景.png';
  // 导出为base64
  const off = document.createElement('canvas');
  off.width = vpResult.imageData.width; off.height = vpResult.imageData.height;
  off.getContext('2d').putImageData(vpResult.imageData, 0, 0);
  off.toBlob(async (blob) => {
    // 用 FileReader 转 base64
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      try {
        downloadBtn.textContent = '保存中...';
        const res = await fetch('/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 路径: savePath, 数据: dataUrl })
        });
        const d = await res.json();
        if (d.成功) {
          downloadBtn.textContent = '✅ 已保存';
          info.textContent = `已保存: ${baseName}_去背景.png`;
          setTimeout(() => { downloadBtn.textContent = '⬇️ 保存PNG'; }, 2000);
          if (typeof refreshTree === 'function') refreshTree();
        } else {
          alert('保存失败: ' + (d.错误 || '未知错误'));
          downloadBtn.textContent = '⬇️ 保存PNG';
        }
      } catch (e) {
        alert('保存失败: ' + e.message);
        downloadBtn.textContent = '⬇️ 保存PNG';
      }
    };
    reader.readAsDataURL(blob);
  }, 'image/png');
});

// 阻止右键菜单
overlay.addEventListener('contextmenu', e => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });

})();
