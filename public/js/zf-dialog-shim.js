/* ============================================================
 * zf-dialog-shim.js — 自研对话框 shim（公共版，S4 去重抽取 2026-11-22）
 * 原 26 个业务 JS 文件头部各自重复注入的同一 ~84 行块，统一收敛于此。
 * 必须在所有业务 JS 之前加载（index.html 已置于第一个 script）。
 * ============================================================ */
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  return _dlgFallbackAlert(typeof msg === 'string' ? msg : String(msg));
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return _dlgFallbackConfirm(msg);
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return _dlgFallbackPrompt(msg, val);
}
/* 无 ConfirmDialog 时的最小 DOM 兜底（不用原生弹窗） */
function _dlgOverlay(){
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;';
  var box = document.createElement('div');
  box.style.cssText = 'background:#2a2a3e;color:#e8e8f0;border-radius:12px;min-width:320px;max-width:90vw;padding:20px;font-family:system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 12px 48px rgba(0,0,0,.5);';
  ov.appendChild(box); document.body.appendChild(ov);
  return { ov: ov, box: box };
}
function _dlgFallbackAlert(msg){
  var d = _dlgOverlay();
  d.box.innerHTML = '<div style="margin-bottom:14px;white-space:pre-wrap;"></div>';
  d.box.firstChild.textContent = msg;
  var btn = document.createElement('button');
  btn.textContent = '知道了';
  btn.style.cssText = 'background:#5b6bd6;color:#fff;border:none;border-radius:8px;padding:8px 22px;cursor:pointer;font-size:14px;';
  btn.onclick = function(){ d.ov.remove(); };
  d.box.appendChild(btn);
  return Promise.resolve();
}
function _dlgFallbackConfirm(msg){
  var d = _dlgOverlay();
  d.box.innerHTML = '<div style="margin-bottom:14px;white-space:pre-wrap;"></div>';
  d.box.firstChild.textContent = msg;
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
  var no = document.createElement('button'); no.textContent = '取消';
  var yes = document.createElement('button'); yes.textContent = '确定';
  var bs = 'border:none;border-radius:8px;padding:8px 22px;cursor:pointer;font-size:14px;';
  no.style.cssText = bs + 'background:#3a3a50;color:#cfcfe0;';
  yes.style.cssText = bs + 'background:#5b6bd6;color:#fff;';
  row.appendChild(no); row.appendChild(yes); d.box.appendChild(row);
  return new Promise(function(res){
    no.onclick = function(){ d.ov.remove(); res(false); };
    yes.onclick = function(){ d.ov.remove(); res(true); };
  });
}
function _dlgFallbackPrompt(msg, val){
  var d = _dlgOverlay();
  d.box.innerHTML = '<div style="margin-bottom:10px;white-space:pre-wrap;"></div>';
  d.box.firstChild.textContent = msg;
  var inp = document.createElement('input');
  inp.value = val || '';
  inp.style.cssText = 'width:100%;box-sizing:border-box;background:#1e1e30;color:#e8e8f0;border:1px solid #44445e;border-radius:8px;padding:8px 10px;font-size:14px;margin-bottom:14px;outline:none;';
  d.box.appendChild(inp);
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
  var no = document.createElement('button'); no.textContent = '取消';
  var yes = document.createElement('button'); yes.textContent = '确定';
  var bs = 'border:none;border-radius:8px;padding:8px 22px;cursor:pointer;font-size:14px;';
  no.style.cssText = bs + 'background:#3a3a50;color:#cfcfe0;';
  yes.style.cssText = bs + 'background:#5b6bd6;color:#fff;';
  row.appendChild(no); row.appendChild(yes); d.box.appendChild(row);
  setTimeout(function(){ inp.focus(); }, 50);
  return new Promise(function(res){
    function done(v){ d.ov.remove(); res(v); }
    no.onclick = function(){ done(null); };
    yes.onclick = function(){ done(inp.value); };
    inp.addEventListener('keydown', function(e){
      if (e.key === 'Enter') { e.preventDefault(); done(inp.value); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
    });
  });
}
