/* zf-app-idol.js — i偶像 私有档案馆（P0：偶像列表→详情→图/视频瀑布流 + 手动采集）
   接口真源：server/routes/mixin_idol.py（list/detail/file/save/media_add）
   媒体策略（v3 裁决）：图片物理落盘走 /api/idol/file 代理读；视频只存指针 playVia=ivideo 不下载。 */
(function () {
  'use strict';
  if (window.ZFIdol) return;

  var state = { list: [], cur: null, detail: null, loading: false };
  var els = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function apiGet(path, cb) {
    fetch(path).then(function (r) { return r.json(); }).then(cb)
      .catch(function (e) { cb({ ok: false, err: String(e) }); });
  }
  function apiPost(path, body, cb) {
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(cb)
      .catch(function (e) { cb({ ok: false, err: String(e) }); });
  }
  /* 图片 src：已归档走本地代理（thumb=true 走缩略图，瀑布流快载），未归档回退原直链 */
  function imgSrc(m, thumb) {
    if (m.localPath) {
      var rel = m.localPath.replace(/^private\/idols\/[^/]+\//, '');
      return '/api/idol/file?id=' + encodeURIComponent(state.cur) + '&rel=' + encodeURIComponent(rel) + (thumb ? '&w=480' : '');
    }
    return m.url || m.thumb || '';
  }
  /* 头像 src：本地 avatar.jpg 优先（缩略图+缓存戳），否则回退原始直链 */
  function avatarSrc(it, thumb) {
    if (it.avatarRel) return '/api/idol/file?id=' + encodeURIComponent(it.id) + '&rel=' + encodeURIComponent(it.avatarRel) + (thumb ? '&w=160' : '') + '&t=' + (it.updated ? encodeURIComponent(it.updated) : Date.now());
    return it.avatar || '';
  }

  /* ---------- 自研确认对话框（替代原生 confirm） ---------- */
  function zfiConfirm(title, msg, onOk) {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000';
    box.classList.add('zfi-confirm');
    box.innerHTML = '<div style="background:#1b1b1d;border-radius:10px;padding:18px;width:300px;max-width:90%;color:#eee;box-shadow:0 8px 30px rgba(0,0,0,.5)">' +
      '<div style="font-size:15px;font-weight:600;margin-bottom:8px">' + esc(title) + '</div>' +
      '<div style="font-size:12px;opacity:.85;line-height:1.6;margin-bottom:14px">' + esc(msg) + '</div>' +
      '<div style="text-align:right"><button class="zc-no" style="margin-right:8px;padding:5px 14px;border-radius:6px;cursor:pointer;background:#333;border:none;color:#eee">取消</button>' +
      '<button class="zc-ok" style="padding:5px 14px;border-radius:6px;cursor:pointer;background:#c33;border:none;color:#fff">确定删除</button></div></div>';
    document.body.appendChild(box);
    function close() { box.remove(); window.removeEventListener('keydown', onKey, true); }
    /* 【2026-11-17】捕获阶段拦截 Esc/回车，阻止冒泡导致 i偶像 窗口连带被关 */
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }
    window.addEventListener('keydown', onKey, true);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    box.querySelector('.zc-no').addEventListener('click', close);
    box.querySelector('.zc-ok').addEventListener('click', function () { close(); onOk(); });
  }

  /* ---------- 灯箱：点击图片全屏放大查看 ---------- */
  function openLightbox(m) {
    var lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out';
    lb.innerHTML = '<div style="position:relative">' +
      '<img src="' + esc(imgSrc(m)) + '" style="max-width:92vw;max-height:88vh;object-fit:contain;border-radius:6px;transition:transform .05s;transform-origin:0 0;will-change:transform">' +
      '<div style="position:absolute;bottom:-34px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:12px;font-size:12px;color:#ccc">' +
      '<span style="max-width:40vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.title || m.source_site || m.url || '') + '</span>' +
      '<button class="zfi-lb-avatar" style="background:#2860c8;border:none;color:#fff;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:12px">设为头像</button>' +
      '<button class="zfi-lb-del" style="background:#c33;border:none;color:#fff;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:12px">删除此图</button>' +
      '<button class="zfi-lb-close" style="background:#333;border:none;color:#eee;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:12px">关闭</button>' +
      '<span style="opacity:.6">滚轮缩放 · 左键拖动平移 · 双击复位</span>' +
      '</div></div>';
    document.body.appendChild(lb);
    /* 【2026-11-17】捕获阶段拦截 Esc，只关灯箱，阻止冒泡导致 i偶像 窗口被全局 Esc 处理器连带关闭 */
    function lbOnKey(e) {
      if (e.key === 'Escape') {
        /* 确认框打开时让确认框自己处理，灯箱不动 */
        if (document.querySelector('.zfi-confirm')) return;
        e.preventDefault(); e.stopPropagation(); lb.remove(); window.removeEventListener('keydown', lbOnKey, true);
      }
    }
    window.addEventListener('keydown', lbOnKey, true);
    /* 滚轮缩放（以鼠标为中心）+ 中键拖拽平移 + 双击复位 */
    var img = lb.querySelector('img');
    var scale = 1, tx = 0, ty = 0;
    function applyT() { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
    lb.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = img.getBoundingClientRect();
      var cx = e.clientX - r.left, cy = e.clientY - r.top;   // 鼠标在图内坐标
      var old = scale;
      scale = Math.min(8, Math.max(0.2, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      /* 保持鼠标指向的图像点不动：新偏移 = 鼠标位 - (鼠标位-旧偏移)*k */
      tx = cx - (cx - tx) * (scale / old);
      ty = cy - (cy - ty) * (scale / old);
      applyT();
    }, { passive: false });
    var panning = false, px = 0, py = 0;
    lb.addEventListener('mousedown', function (e) {
      if (e.button === 0) { e.preventDefault(); panning = true; px = e.clientX - tx; py = e.clientY - ty; lb._dragStart = { x: e.clientX, y: e.clientY }; lb._dragged = false; lb.style.cursor = 'grabbing'; }
    });
    window.addEventListener('mousemove', function (e) {
      if (panning) {
        if (lb._dragStart && (Math.abs(e.clientX - lb._dragStart.x) > 4 || Math.abs(e.clientY - lb._dragStart.y) > 4)) lb._dragged = true;
        tx = e.clientX - px; ty = e.clientY - py; applyT();
      }
    });
    window.addEventListener('mouseup', function (e) { if (e.button === 0) { panning = false; lb.style.cursor = 'zoom-out'; } });
    img.addEventListener('dblclick', function () { scale = 1; tx = 0; ty = 0; applyT(); });
    lb.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    lb.addEventListener('click', function (e) {
      if (e.target === lb && !lb._dragged) lb.remove();
      lb._dragged = false;
    });
    lb.querySelector('.zfi-lb-close').addEventListener('click', function () { lb.remove(); window.removeEventListener('keydown', lbOnKey, true); });
    lb.querySelector('.zfi-lb-avatar').addEventListener('click', function (e) {
      e.stopPropagation();
      apiPost('/api/idol/avatar/set', { id: state.cur, media_id: m.id }, function (r) {
        if (!r.ok) { els.status.textContent = '设头像失败：' + (r.err || '?'); return; }
        els.status.textContent = '已设为头像';
        loadList();
      });
    });
    lb.querySelector('.zfi-lb-del').addEventListener('click', function (e) {
      e.stopPropagation();
      zfiConfirm('删除图片', '确定删除这张图片？本地文件将一并删除，不可恢复。', function () {
        apiPost('/api/idol/media/remove', { id: state.cur, media_id: m.id }, function (r) {
          if (!r.ok) { els.status.textContent = '删除失败：' + (r.err || '?'); return; }
          lb.remove();
          openDetail(state.cur);
          loadList();
          els.status.textContent = '已删除 1 张图片';
        });
      });
    });
  }

  /* ---------- 左栏：偶像列表 ---------- */
  function renderList() {
    var html = state.list.map(function (it) {
      var av = it.avatar
        ? '<img loading="lazy" src="' + esc(avatarSrc(it, true)) + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex:none">'
        : '<div style="width:34px;height:34px;border-radius:50%;background:#444;flex:none;display:flex;align-items:center;justify-content:center;font-size:15px">' + esc((it.name || '?').slice(0, 1)) + '</div>';
      return '<div class="zfi-item' + (it.id === state.cur ? ' on' : '') + '" data-id="' + esc(it.id) + '" style="display:flex;gap:8px;align-items:center;padding:7px 9px;border-radius:8px;cursor:pointer">' +
        av + '<div style="min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.name) + '</div>' +
        '<span class="zfi-item-del" data-id="' + esc(it.id) + '" title="删除此偶像">×</span></div>';
    }).join('') || '<div style="padding:10px;font-size:12px;opacity:.6">暂无偶像，点右上「+建档」</div>';
    els.list.innerHTML = html;
    /* 【2026-11-23 安全修复】头像 onerror 由内联 JS 串改为事件绑定（防实体解码击穿属性）；
       保留原回退逻辑：加载失败时替换为首字符占位圆（textContent 赋值天然防注入） */
    Array.prototype.forEach.call(els.list.querySelectorAll('.zfi-item img'), function (img) {
      img.addEventListener('error', function () {
        if (this.dataset.fbDone) return;
        this.dataset.fbDone = '1';
        var item = this.closest('.zfi-item');
        var id = item ? item.getAttribute('data-id') : '';
        var it = state.list.filter(function (x) { return x.id === id; })[0] || {};
        var ph = document.createElement('div');
        ph.style.cssText = 'width:34px;height:34px;border-radius:50%;background:#444;flex:none;display:flex;align-items:center;justify-content:center;font-size:15px';
        ph.textContent = (it.name || '?').slice(0, 1);
        this.replaceWith(ph);
      });
    });
    Array.prototype.forEach.call(els.list.querySelectorAll('.zfi-item'), function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.zfi-item-del')) return;
        openDetail(el.getAttribute('data-id'));
      });
    });
    Array.prototype.forEach.call(els.list.querySelectorAll('.zfi-item-del'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        var name = (state.list.filter(function (x) { return x.id === id; })[0] || {}).name || id;
        zfiConfirm('删除偶像「' + name + '」', '将删除该偶像的全部档案：介绍、图片、视频与本地文件，不可恢复。确定删除？', function () {
          apiPost('/api/idol/delete', { id: id, confirmed: 'true' }, function (r) {
            if (!r.ok) { els.status.textContent = '删除失败：' + (r.err || '?'); return; }
            els.status.textContent = '已删除偶像「' + name + '」';
            if (state.cur === id) { state.cur = null; state.detail = null; renderDetail(); }
            loadList();
          });
        });
      });
    });
  }
  function loadList() {
    apiGet('/api/idol/list', function (r) {
      if (!r.ok) { els.status.textContent = '列表加载失败：' + (r.err || '?'); return; }
      state.list = r.list || [];
      renderList();
    });
  }

  /* ---------- 右栏：详情 ---------- */
  function renderDetail() {
    var d = state.detail;
    if (!d) { els.detail.innerHTML = '<div style="padding:20px;opacity:.6">← 选择或新建一个偶像</div>'; return; }
    var p = d.profile || {};
    var media = d.media || [];
    var imgs = media.filter(function (m) { return m.type === 'image'; });
    var vids = media.filter(function (m) { return m.type === 'video'; });
    var head = '<div style="font-size:18px;font-weight:600">' + esc(p.name || d.id) + '</div>' +
      (p.aliases && p.aliases.length ? '<div style="font-size:12px;opacity:.6;margin-top:2px">别名：' + p.aliases.map(esc).join('、') + '</div>' : '') +
      (p.intro ? '<div style="font-size:12px;opacity:.8;margin-top:6px;white-space:pre-wrap">' + esc(p.intro) + '</div>' : '');
    var imgGrid = imgs.map(function (m, idx) {
      return '<div class="zfi-card" title="' + esc(m.title || m.source_site || '') + '" style="position:relative;border-radius:6px;overflow:hidden;background:#222;aspect-ratio:1;cursor:zoom-in">' +
        '<img loading="lazy" data-idx="' + idx + '" src="' + esc(imgSrc(m, true)) + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.opacity=.2">' +
        '<span class="zfi-del" data-mid="' + esc(m.id) + '" title="删除" style="position:absolute;top:2px;right:2px;font-size:11px;background:rgba(200,40,40,.85);color:#fff;width:18px;height:18px;border-radius:50%;display:none;align-items:center;justify-content:center;cursor:pointer">×</span>' +
        (m.generated ? '<span style="position:absolute;top:2px;left:2px;font-size:9px;background:#0a6;color:#fff;padding:1px 4px;border-radius:3px">AI</span>' : '') +
        '</div>';
    }).join('');
    var vidList = vids.map(function (m) {
      return '<a href="' + esc(m.url) + '" target="_blank" style="display:flex;gap:6px;align-items:center;padding:6px;border-radius:6px;background:#222;text-decoration:none;color:inherit;font-size:12px"><span style="color:#e6a">▶</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.title || m.url) + '</span><span style="opacity:.5">' + esc(m.source_site || '') + '</span></a>';
    }).join('');
    els.detail.innerHTML = head +
      '<div style="display:flex;gap:8px;margin:12px 0 8px"><button class="zfi-collect" style="font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer">+ 采集图/视频</button><span style="font-size:11px;opacity:.5;align-self:center">图片自动归档·视频存播放指针 · 点图放大 · 悬停删除</span></div>' +
      '<div style="font-size:13px;margin:10px 0 4px">📷 图片（' + imgs.length + '）</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px">' + (imgGrid || '<div style="font-size:12px;opacity:.5">暂无图片</div>') + '</div>' +
      '<div style="font-size:13px;margin:14px 0 4px">🎬 视频（' + vids.length + '）</div>' +
      '<div style="display:flex;flex-direction:column;gap:5px">' + (vidList || '<div style="font-size:12px;opacity:.5">暂无视频</div>') + '</div>';
    var cb = els.detail.querySelector('.zfi-collect');
    if (cb) cb.addEventListener('click', openCollect);
    /* 图片卡片：点击放大 + 悬停显示删除钮 */
    Array.prototype.forEach.call(els.detail.querySelectorAll('.zfi-card'), function (card, i) {
      card.addEventListener('mouseenter', function () {
        var d = card.querySelector('.zfi-del'); if (d) d.style.display = 'flex';
      });
      card.addEventListener('mouseleave', function () {
        var d = card.querySelector('.zfi-del'); if (d) d.style.display = 'none';
      });
      card.addEventListener('click', function (e) {
        var delBtn = e.target.closest && e.target.closest('.zfi-del');
        var imgs = (state.detail.media || []).filter(function (m) { return m.type === 'image'; });
        if (delBtn) {
          var mid = delBtn.getAttribute('data-mid');
          var m2 = imgs.filter(function (x) { return String(x.id) === mid; })[0];
          if (m2) {
            e.stopPropagation();
            zfiConfirm('删除图片', '确定删除这张图片？本地文件将一并删除，不可恢复。', function () {
              apiPost('/api/idol/media/remove', { id: state.cur, media_id: mid }, function (r) {
                if (!r.ok) { els.status.textContent = '删除失败：' + (r.err || '?'); return; }
                openDetail(state.cur);
                els.status.textContent = '已删除 1 张图片';
              });
            });
          }
          return;
        }
        if (imgs[i]) openLightbox(imgs[i]);
      });
    });
  }
  function openDetail(id) {
    state.cur = id;
    renderList();
    els.status.textContent = '加载中…';
    apiGet('/api/idol/detail?id=' + encodeURIComponent(id), function (r) {
      if (!r.ok) { els.status.textContent = '详情加载失败：' + (r.err || '?'); return; }
      state.detail = r;
      renderDetail();
      els.status.textContent = '「' + (r.profile && r.profile.name || id) + '」';
    });
  }

  /* ---------- 建档 / 采集弹层 ---------- */
  function layer(inner) {
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9';
    box.innerHTML = '<div style="background:#1b1b1d;border-radius:10px;padding:16px;width:340px;max-width:90%;color:#eee">' + inner + '</div>';
    els.root.appendChild(box);
    box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
    return box;
  }
  function openCreate() {
    var box = layer('<div style="font-size:15px;font-weight:600;margin-bottom:10px">新建偶像档案</div>' +
      '<label style="font-size:12px">偶像名称</label>' +
      '<input class="c-name" style="width:100%;box-sizing:border-box;margin:3px 0 10px;padding:6px;border-radius:6px;background:#2a2a2c;border:1px solid #3a3a3c;color:#eee" placeholder="如：刘德华">' +
      '<div style="text-align:right"><button class="c-cancel" style="margin-right:8px;padding:5px 12px;border-radius:6px;cursor:pointer;background:#333;border:none;color:#eee">取消</button>' +
      '<button class="c-ok" style="padding:5px 14px;border-radius:6px;cursor:pointer;background:#e6a;border:none;color:#fff">建档</button></div>');
    box.querySelector('.c-cancel').addEventListener('click', function () { box.remove(); });
    box.querySelector('.c-ok').addEventListener('click', function () {
      var name = box.querySelector('.c-name').value.trim();
      if (!name) { els.status.textContent = '名称不能为空'; return; }
      var id = name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '_').slice(0, 40) || ('idol_' + Date.now());
      apiPost('/api/idol/save', { id: id, confirmed: 'true', profile: { name: name } }, function (r) {
        if (!r.ok) { els.status.textContent = '建档失败：' + (r.err || '?'); return; }
        box.remove();
        loadList();
        openDetail(id);
      });
    });
  }
  function openCollect() {
    if (!state.cur) return;
    var box = layer('<div style="font-size:15px;font-weight:600;margin-bottom:10px">采集媒体到「' + esc((state.detail.profile || {}).name || state.cur) + '」</div>' +
      '<label style="font-size:12px">类型</label>' +
      '<select class="k-type" style="width:100%;margin:3px 0 8px;padding:6px;border-radius:6px;background:#2a2a2c;border:1px solid #3a3a3c;color:#eee"><option value="image">图片（https 自动归档）</option><option value="video">视频（仅存播放指针）</option></select>' +
      '<label style="font-size:12px">URL</label>' +
      '<input class="k-url" style="width:100%;box-sizing:border-box;margin:3px 0 8px;padding:6px;border-radius:6px;background:#2a2a2c;border:1px solid #3a3a3c;color:#eee" placeholder="https://...">' +
      '<label style="font-size:12px">标题（可选）</label>' +
      '<input class="k-title" style="width:100%;box-sizing:border-box;margin:3px 0 10px;padding:6px;border-radius:6px;background:#2a2a2c;border:1px solid #3a3a3c;color:#eee">' +
      '<div style="text-align:right"><button class="k-cancel" style="margin-right:8px;padding:5px 12px;border-radius:6px;cursor:pointer;background:#333;border:none;color:#eee">取消</button>' +
      '<button class="k-ok" style="padding:5px 14px;border-radius:6px;cursor:pointer;background:#e6a;border:none;color:#fff">采集</button></div>');
    box.querySelector('.k-cancel').addEventListener('click', function () { box.remove(); });
    box.querySelector('.k-ok').addEventListener('click', function () {
      var url = box.querySelector('.k-url').value.trim();
      if (!url) { els.status.textContent = 'URL 不能为空'; return; }
      var item = { type: box.querySelector('.k-type').value, url: url,
        title: box.querySelector('.k-title').value.trim(), collected_by: 'user' };
      els.status.textContent = '采集中…';
      apiPost('/api/idol/media/add', { id: state.cur, item: item }, function (r) {
        if (!r.ok) { els.status.textContent = '采集失败：' + (r.err || '?'); return; }
        box.remove();
        openDetail(state.cur);
        els.status.textContent = r.archived ? '已采集并归档' : '已采集（未归档：仅存指针或图非 https）';
      });
    });
  }

  /* ---------- 外壳 ---------- */
  function buildWin(body) {
    els.root = body;
    body.innerHTML =
      '<style>' +
      '.zfi-wrap{display:flex;width:100%;height:100%;position:relative;font-family:inherit;color:#ddd}' +
      '.zfi-side{width:180px;flex:none;border-right:1px solid #2c2c2e;display:flex;flex-direction:column}' +
      '.zfi-side-top{padding:8px;display:flex;align-items:center;gap:6px}' +
      '.zfi-new{margin-left:auto;cursor:pointer;background:#e6a;border:none;color:#fff;border-radius:6px;padding:3px 8px;font-size:12px}' +
      '.zfi-list{flex:1;overflow:auto;padding:0 6px}' +
      '.zfi-item{position:relative}' +
      '.zfi-item.on{background:#2c2c2e}' +
      '.zfi-item:hover{background:#26262a}' +
      '.zfi-item-del{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:rgba(200,40,40,.9);color:#fff;font-size:11px;display:none;align-items:center;justify-content:center;cursor:pointer;line-height:1}' +
      '.zfi-item:hover .zfi-item-del{display:flex}' +
      '.zfi-main{flex:1;overflow:auto;padding:14px 16px;min-width:0}' +
      '.zfi-status{font-size:11px;padding:6px 10px;border-top:1px solid #2c2c2e;opacity:.7}' +
      '</style>' +
      '<div class="zfi-wrap">' +
      '<div class="zfi-side"><div class="zfi-side-top"><span style="font-size:14px;font-weight:600">i偶像</span><button class="zfi-new">+建档</button></div>' +
      '<div class="zfi-list"></div></div>' +
      '<div class="zfi-main"></div>' +
      '<div class="zfi-status"></div>' +
      '</div>';
    els.list = body.querySelector('.zfi-list');
    els.detail = body.querySelector('.zfi-main');
    els.status = body.querySelector('.zfi-status');
    body.querySelector('.zfi-new').addEventListener('click', openCreate);
    renderDetail();
    loadList();
  }

  window.ZFIdol = {
    onOpen: function (body) { buildWin(body); },
    onClose: function () { state = { list: [], cur: null, detail: null, loading: false }; els = {}; },
    search: function (kw) { /* P1 预留：代搜编排入口 */ return null; }
  };
})();
