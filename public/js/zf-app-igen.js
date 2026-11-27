/* zf-app-igen.js —— i模型生成 前端界面 v4（2026-11-17）
   v4：模型可选（qwen2512 / zimage）+ 历史缩略图列表 + 图片查看器
       （双击打开 / 滚轮跟随鼠标缩放 / 左键中键平移 / ESC 返回）
   数据源：GET  /api/igen/models  模型清单
           POST /api/igen/generate {prompt,width,height,steps,cfg,seed,model}
           GET  /api/igen/status?prompt_id=xxx 轮询至 done
           GET  /api/igen/history 最近产物列表
           GET  /api/igen/image?rel=... 产物图读 */
(function () {
  'use strict';
  var POLL_MS = 1500, POLL_MAX = 240;
  var timer = null;

  var C = {
    bg: '#111111', text: '#f2f2f2', sub: '#9a9a9a', line: '#333333',
    inputBg: '#1c1c1c', btn: '#f2f2f2', btnText: '#111111',
    ok: '#7dd97d', err: '#ff6b5e'
  };
  /* 【2026-11-18 主题跟随】白主题（大师纸白）下自动切换浅色配色 */
  function applyThemeColors() {
    var light = false;
    try { light = (document.documentElement.getAttribute('data-theme') === 'light'); } catch (e) {}
    if (light) {
      C.bg = '#f5f6f8'; C.text = '#1f2430'; C.sub = '#5a6b85'; C.line = '#d8dfe9';
      C.inputBg = '#ffffff'; C.btn = '#1f2430'; C.btnText = '#ffffff';
    } else {
      C.bg = '#111111'; C.text = '#f2f2f2'; C.sub = '#9a9a9a'; C.line = '#333333';
      C.inputBg = '#1c1c1c'; C.btn = '#f2f2f2'; C.btnText = '#111111';
    }
  }
  applyThemeColors();
  try {
    document.addEventListener('themechange', function () { applyThemeColors(); });
  } catch (e) {}

  var RATIOS = [
    { v: '1:1',  w: 1024, h: 1024, label: '1:1 方形' },
    { v: '4:3',  w: 1152, h: 864,  label: '4:3 横向' },
    { v: '3:4',  w: 864,  h: 1152, label: '3:4 纵向' },
    { v: '16:9', w: 1280, h: 704,  label: '16:9 宽屏' },
    { v: '9:16', w: 704,  h: 1280, label: '9:16 竖屏' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function friendlyErr(j) {
    var raw = j.error || j.err || j.msg || '';
    var s = String(raw);
    if (s.indexOf('10061') !== -1 || s.indexOf('refused') !== -1 || s.indexOf('积极拒绝') !== -1 || s.indexOf('Connection') !== -1) {
      return 'ComfyUI 还没启动（127.0.0.1:8188 连不上）。系统会自动拉起，稍等 30 秒再试。';
    }
    if (s.indexOf('显存不足') !== -1 || s.indexOf('free=') !== -1) {
      return '显存不足（需≥6GB，当前仅约 ' + (String(s).match(/free=([\d.]+)GB/) || ['', '?'])[1] + 'GB）。请关闭占用显存的程序后重试。';
    }
    return raw || '提交失败';
  }

  function imgUrl(rel) { return '/api/igen/image?rel=' + encodeURIComponent(rel); }

  /* ---------- 图片查看器（覆盖全屏层）：滚轮缩放跟随鼠标 / 左键中键平移 / ESC 只关查看器 / 左右切换上下张 ---------- */
  /* v5：传入图列表 + 起始索引，支持 ‹ › 按钮和 ←/→ 方向键切换，ESC/双击只关闭查看器不关窗口 */
  function openViewer(src, caption, list, startIdx) {
    var old = document.getElementById('zfigenViewer');
    if (old) old.remove();
    var items = Array.isArray(list) && list.length ? list : [src];
    var idx = typeof startIdx === 'number' ? startIdx : 0;
    if (idx < 0 || idx >= items.length) idx = 0;
    var v = document.createElement('div');
    v.id = 'zfigenViewer';
    v.innerHTML =
      '<div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:grab;">' +
        '<img id="zfigenViewerImg" src="' + esc(items[idx]) + '" style="transform-origin:0 0;user-select:none;-webkit-user-drag:none;" draggable="false">' +
        '<div id="zfigenViewerCap" style="position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:#999;font-size:12px;pointer-events:none;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(caption || '') + '</div>' +
        '<div style="position:fixed;top:14px;left:50%;transform:translateX(-50%);color:#bbb;font-size:12px;pointer-events:none;">滚轮缩放 · 拖拽平移 · ←/→ 切换 · ESC 关闭图片</div>' +
        (items.length > 1
          ? '<button id="zfigenPrev" title="上一张（←）" style="position:fixed;left:18px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:1px solid #555;background:rgba(30,30,30,.85);color:#eee;font-size:20px;cursor:pointer;z-index:100000;">‹</button>' +
            '<button id="zfigenNext" title="下一张（→）" style="position:fixed;right:18px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:1px solid #555;background:rgba(30,30,30,.85);color:#eee;font-size:20px;cursor:pointer;z-index:100000;">›</button>' +
            '<div id="zfigenCount" style="position:fixed;top:40px;left:50%;transform:translateX(-50%);color:#888;font-size:12px;pointer-events:none;"></div>'
          : '') +
      '</div>';
    document.body.appendChild(v);
    var img = v.querySelector('#zfigenViewerImg');
    var cap = v.querySelector('#zfigenViewerCap');
    var cnt = v.querySelector('#zfigenCount');
    var scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0;

    function apply() {
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    }
    function fit() {
      var vw = window.innerWidth, vh = window.innerHeight;
      var k = Math.min(vw / img.naturalWidth, vh / img.naturalHeight, 1);
      scale = k; tx = (vw - img.naturalWidth * k) / 2; ty = (vh - img.naturalHeight * k) / 2;
      apply();
    }
    function show(i) {
      if (!items.length) return;
      idx = (i + items.length) % items.length;   /* 循环切换 */
      scale = 1; tx = 0; ty = 0;
      img.src = items[idx];
      if (cap) cap.textContent = items[idx].getAttribute ? '' : '';
    }
    img.onload = fit;
    /* 加载已缓存的图（onload 可能不触发） */
    if (img.complete && img.naturalWidth) fit();

    if (cnt) {
      var upd = function () { cnt.textContent = (idx + 1) + ' / ' + items.length; };
      var _show = show;
      show = function (i) { _show(i); upd(); };
      upd();
    }
    var prevBtn = v.querySelector('#zfigenPrev'), nextBtn = v.querySelector('#zfigenNext');
    if (prevBtn) prevBtn.addEventListener('click', function (e) { e.stopPropagation(); show(idx - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function (e) { e.stopPropagation(); show(idx + 1); });
    /* 滚轮缩放（跟随鼠标） */
    v.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var ns = Math.min(Math.max(scale * f, 0.05), 40);
      /* 以鼠标位置为锚：先算鼠标相对当前图原点的坐标 */
      var mx = e.clientX - tx, my = e.clientY - ty;
      tx = e.clientX - mx * (ns / scale);
      ty = e.clientY - my * (ns / scale);
      scale = ns;
      apply();
    }, { passive: false });
    /* 左键/中键平移 */
    v.addEventListener('mousedown', function (e) {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      dragging = true; sx = e.clientX - tx; sy = e.clientY - ty;
      v.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      tx = e.clientX - sx; ty = e.clientY - sy; apply();
    });
    window.addEventListener('mouseup', function () {
      dragging = false; v.style.cursor = 'grab';
    });
    /* ESC / ←→ / 双击：ESC 和双击只关查看器；方向键切换 */
    var onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft') { show(idx - 1); }
      else if (e.key === 'ArrowRight') { show(idx + 1); }
    };
    function close() {
      document.removeEventListener('keydown', onKey, true);
      v.remove();
    }
    document.addEventListener('keydown', onKey, true);
    v.addEventListener('dblclick', function (e) {
      if (e.target === img) close();
    });
  }

  function onOpen(body) {
    if (body.dataset.zfigenReady) { return; }
    body.dataset.zfigenReady = '1';
    var ratioOpts = RATIOS.map(function (r) {
      return '<option value="' + r.v + '">' + r.label + '</option>';
    }).join('');
    body.innerHTML =
      '<div style="flex:1;overflow:auto;padding:18px;color:' + C.text + ';font-size:13px;line-height:1.6;background:' + C.bg + ';">' +
        '<textarea id="igenPrompt" rows="4" placeholder="描述想生成的画面…"></textarea>' +
        '<div id="igenParams">' +
          '<label class="igen-field">模型 <select id="igenModel"></select></label>' +
          '<label class="igen-field">宽高比 <select id="igenRatio">' + ratioOpts + '</select></label>' +
          '<button id="igenGo">生 成</button>' +
        '</div>' +
        '<div id="igenMsg"></div>' +
        '<div id="igenResult"></div>' +
        '<div id="igenHistTitle" style="color:' + C.sub + ';font-size:12px;margin:18px 0 8px;border-top:1px solid ' + C.line + ';padding-top:12px;">历史生成（双击查看 · 滚轮缩放 · 拖拽平移 · ESC 返回）</div>' +
        '<div id="igenHist"></div>' +
      '</div>' +
      '<style>' +
        '#igenPrompt{width:100%;background:' + C.inputBg + ';color:' + C.text + ';border:1px solid ' + C.line + ';border-radius:10px;padding:10px 12px;resize:vertical;box-sizing:border-box;font-size:13px;font-family:inherit;outline:none;transition:border-color .15s;}' +
        '#igenPrompt:focus{border-color:' + C.btn + ';}' +
        '#igenParams{display:flex;gap:10px;align-items:center;margin:12px 0 14px;flex-wrap:wrap;}' +
        '#igenParams .igen-field{display:inline-flex;align-items:center;gap:8px;color:' + C.sub + ';font-size:12px;}' +
        '#igenParams select{background:' + C.inputBg + ';color:' + C.text + ';border:1px solid ' + C.line + ';border-radius:8px;padding:7px 10px;font-size:12px;outline:none;cursor:pointer;transition:border-color .15s;}' +
        '#igenParams select:focus{border-color:' + C.btn + ';}' +
        '#igenGo{margin-left:auto;background:' + C.btn + ';color:' + C.btnText + ';border:none;border-radius:999px;padding:8px 26px;cursor:pointer;font-size:13px;letter-spacing:4px;transition:opacity .15s;}' +
        '#igenGo:hover{opacity:.8;}' +
        '#igenGo:disabled{opacity:.4;cursor:default;}' +
        '#igenMsg{margin-bottom:10px;color:' + C.sub + ';min-height:1.2em;font-size:12px;}' +
        '#igenResult img{max-width:100%;max-height:60vh;border-radius:12px;display:block;border:1px solid ' + C.line + ';cursor:zoom-in;}' +
        '#igenHist{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}' +
        '#igenHist .hcell{position:relative;border:1px solid ' + C.line + ';border-radius:10px;overflow:hidden;background:' + C.inputBg + ';cursor:zoom-in;aspect-ratio:1;}' +
        '#igenHist .hcell img{width:100%;height:100%;object-fit:cover;display:block;}' +
        '#igenHist .hcell:hover{border-color:' + C.sub + ';}' +
      '</style>';

    var $ = function (id) { return body.querySelector('#' + id); };
    var msg = $('igenMsg'), result = $('igenResult'), goBtn = $('igenGo'), hist = $('igenHist');

    /* 参数持久化 */
    var LS_KEY = 'zfigen_params_v3';
    try {
      var saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (saved.prompt != null) $('igenPrompt').value = saved.prompt;
      if (saved.ratio) $('igenRatio').value = saved.ratio;
      if (saved.model) $('igenModel').dataset.pre = saved.model;
    } catch (e) { }
    function saveParams() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          prompt: $('igenPrompt').value, ratio: $('igenRatio').value,
          model: $('igenModel').value
        }));
      } catch (e) { }
    }

    /* 拉模型清单 */
    fetch('/api/igen/models').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok || !j.models || !j.models.length) return;
      $('igenModel').innerHTML = j.models.map(function (m) {
        return '<option value="' + esc(m.key) + '">' + esc(m.label) + '</option>';
      }).join('');
      var pre = $('igenModel').dataset.pre;
      if (pre && j.models.some(function (m) { return m.key === pre; })) $('igenModel').value = pre;
    }).catch(function () { });

    /* 拉历史列表 */
    /* 历史图 URL 列表缓存（供查看器左右切换） */
    var histUrls = [];
    function loadHistory() {
      fetch('/api/igen/history?limit=60').then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok || !j.items || !j.items.length) {
          histUrls = [];
          hist.innerHTML = '<div style="color:' + C.sub + ';font-size:12px;">暂无历史生成</div>';
          return;
        }
        histUrls = j.items.map(function (it) { return imgUrl(it.rel); });
        hist.innerHTML = j.items.map(function (it) {
          return '<div class="hcell" data-rel="' + esc(it.rel) + '" title="' + esc(it.rel) + '">' +
            '<img loading="lazy" src="' + esc(imgUrl(it.rel)) + '"></div>';
        }).join('');
      }).catch(function () { });
    }
    loadHistory();

    /* 事件委托：双击缩略图或当前结果图 → 查看器（带列表上下文，可左右切换） */
    body.addEventListener('dblclick', function (e) {
      var img = e.target.closest ? e.target.closest('img') : null;
      if (!img) return;
      var cell = img.closest('.hcell');
      if (cell) {
        var idx = Array.prototype.indexOf.call(hist.querySelectorAll('.hcell'), cell);
        var srcs = histUrls.length ? histUrls : Array.prototype.map.call(hist.querySelectorAll('.hcell img'), function (i2) { return i2.src; });
        openViewer(img.src, cell.getAttribute('data-rel'), srcs, idx);
      } else {
        openViewer(img.src, img.getAttribute('data-cap') || '', [img.src], 0);
      }
    });
    /* 单击结果大图也打开查看器（结果图并入历史列表末尾，可继续左右切换） */
    result.addEventListener('click', function (e) {
      if (e.target.tagName === 'IMG') {
        var srcs = histUrls.slice();
        var idx = srcs.indexOf(e.target.src);
        if (idx === -1) { srcs.push(e.target.src); idx = srcs.length - 1; }
        openViewer(e.target.src, e.target.getAttribute('data-cap') || '', srcs, idx);
      }
    });

    function setMsg(t, isErr) {
      msg.textContent = t || '';
      msg.style.color = isErr ? C.err : C.sub;
    }
    function finish(t, isErr) {
      clearInterval(timer); timer = null;
      setMsg(t, isErr);
      goBtn.disabled = false; goBtn.textContent = '生 成';
    }

    function poll(pid) {
      var n = 0;
      timer = setInterval(function () {
        if (++n > POLL_MAX) { finish('轮询超时，任务可能仍在后台进行（prompt_id=' + esc(pid) + '）', true); return; }
        fetch('/api/igen/status?prompt_id=' + encodeURIComponent(pid)).then(function (r) { return r.json(); }).then(function (j) {
          if (j.ok && j.done && j.file) {
            var url = imgUrl(j.file);
            finish('✓ 生成完成');
            result.innerHTML = '<img src="' + esc(url) + '" data-cap="' + esc(j.file) + '">' +
              '<div style="color:' + C.sub + ';margin-top:6px;font-size:12px;">已存 private/igen/' + esc(j.file) + ' · 单击可放大查看</div>';
            loadHistory();
          } else if (j.ok && j.done && j.err) {
            finish('✗ 生成失败：' + esc(j.err), true);
          } else if (j.ok === false) {
            finish('✗ ' + esc(friendlyErr(j)), true);
          } else {
            setMsg('生成中…（' + n + '）');
          }
        }).catch(function () { });
      }, POLL_MS);
    }

    goBtn.addEventListener('click', function () {
      var prompt = $('igenPrompt').value.trim();
      if (!prompt) { setMsg('请先输入提示词', true); return; }
      var r = RATIOS.filter(function (x) { return x.v === $('igenRatio').value; })[0] || RATIOS[0];
      var payload = {
        prompt: prompt,
        width: r.w, height: r.h,
        model: $('igenModel').value || 'qwen2512',
        seed: Math.floor(Math.random() * 2147483647)
      };
      saveParams();
      goBtn.disabled = true; goBtn.textContent = '提交中…';
      result.innerHTML = '';
      setMsg('提交任务…');
      fetch('/api/igen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json(); }).then(function (j) {
        if (j.ok && j.prompt_id) {
          setMsg('任务已提交，排队生成中…');
          poll(j.prompt_id);
        } else {
          finish('✗ ' + esc(friendlyErr(j)), true);
        }
      }).catch(function (e) {
        finish('✗ 网络错误：' + esc(e), true);
      });
    });
  }

  function onClose() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  window.ZFIgen = { onOpen: onOpen, onClose: onClose };
})();
