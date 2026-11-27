/* zf-app-collect.js — i采集 · 通用网页媒体采集（甩网址→自动发送→窗口内直接看结果）
   流程：输入网址 → 点「发起采集」→ 指令自动注入当前对话并【自动发送】→
   AI 按 server/public/prompts/模式2_工具循环/08_i采集.txt 执行（browser_control 打开网页 →
   万能 JS 提取全页图片+视频清单 → 用户确认后归档到 private/idols/）。
   本窗口新增：右侧结果面板实时镜像当前对话的最新 AI 回复（采集清单表格直接显示在 i采集窗口内）。
   暴露 window.ZFCollect.onOpen(body) 供 Dock 挂载。 */
(function () {
  'use strict';
  if (window.ZFCollect) return;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 获取当前聚焦对话的 box 与 chat 对象 */
  function getChatCtx() {
    var box = document.querySelector('.chatbox.focused') || document.querySelector('.chatbox');
    if (!box) return { ok: false, err: '没有可用的对话窗口' };
    var chat = box._chatRef || null;
    // 兜底：chat 对象池真源是 App.chatBoxes（数组，chat.el 指向 box）；次选 Store.getChatBoxes()
    if (!chat && window.App && Array.isArray(App.chatBoxes)) {
      chat = App.chatBoxes.find(function (c) { return c && (c.el === box || c.box === box); });
    }
    if (!chat && window.Store && typeof Store.getChatBoxes === 'function') {
      var pool = Store.getChatBoxes() || [];
      pool.forEach(function (c) { if (!chat && c && (c.el === box || c.box === box)) chat = c; });
    }
    if (!chat && window.App) {
      var pool2 = App.chats || App.chatList || [];
      if (Array.isArray(pool2)) chat = pool2.find(function (c) { return c && (c.el === box || c.box === box); });
      else if (pool2 && typeof pool2.forEach === 'function') { pool2.forEach(function (c) { if (!chat && c && (c.el === box || c.box === box)) chat = c; }); }
    }
    if (!chat) return { ok: false, err: '找不到对话对象（chat）' };
    return { ok: true, box: box, chat: chat };
  }

  /* 指令注入并自动发送到当前对话 */
  function sendToChat(url, note) {
    var ctx = getChatCtx();
    if (!ctx.ok) return ctx;
    var input = ctx.box.querySelector('textarea') || ctx.box.querySelector('[contenteditable="true"]');
    if (!input) return { ok: false, err: '对话输入框未找到' };
    var msg = 'i采集：帮我采集这个网页的全部图片和视频：' + url + (note ? '（' + note + '）' : '');
    if (input.tagName === 'TEXTAREA') input.value = msg;
    else input.textContent = msg;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // 自动发送：优先走统一发送入口
    var sent = false;
    try {
      if (window.App && typeof App.sendToModel === 'function') { App.sendToModel(ctx.box, ctx.chat); sent = true; }
    } catch (e) { sent = false; }
    if (!sent) {
      // 兜底：模拟点击发送按钮
      var btn = ctx.box.querySelector('.send-btn');
      if (btn) { btn.click(); sent = true; }
    }
    if (!sent) { input.focus(); return { ok: true, auto: false }; }
    return { ok: true, auto: true };
  }

  /* 结果面板：实时镜像最新 AI 回复 */
  function bindMirror(body, outEl, stateEl) {
    if (body.dataset.zfcMirror) return;
    body.dataset.zfcMirror = '1';
    var lastLen = 0;
    function tick() {
      try {
        var ctx = getChatCtx();
        if (!ctx.ok) return;
        var hist = ctx.chat.history || [];
        var last = hist[hist.length - 1];
        if (!last || last.role !== 'assistant') return;
        var txt = String(last.content || '');
        // 发送中：最新 assistant 还在流式增长
        if (ctx.chat.isSending) {
          stateEl.textContent = '⏳ AI 采集中…（实时更新）';
          if (txt && txt.length !== lastLen) { outEl.textContent = txt; lastLen = txt.length; outEl.scrollTop = outEl.scrollHeight; }
        } else if (txt) {
          stateEl.textContent = '✅ 采集完成';
          if (txt.length !== lastLen) { outEl.textContent = txt; lastLen = txt.length; outEl.scrollTop = outEl.scrollHeight; }
        }
      } catch (e) {}
    }
    setInterval(tick, 800);
    tick();
  }

  function onOpen(body) {
    if (body.dataset.zfcInit) return;
    body.dataset.zfcInit = '1';
    body.innerHTML = [
      '<div style="flex:1;overflow:auto;padding:22px 26px;display:flex;flex-direction:column;gap:14px;',
      'font-family:inherit;color:var(--fg,#eee);">',
      '<div style="font-size:15px;font-weight:600;">🌐 i采集 · 通用网页采集</div>',
      '<div style="font-size:12.5px;opacity:.7;line-height:1.7;">',
      '输入网址点「发起采集」，AI 自动开始采集，<b>采集结果和 AI 回复直接显示在下方结果区</b>（同步自当前对话）。',
      '</div>',
      '<div style="display:flex;gap:8px;">',
      '<input id="zfcUrl" type="text" placeholder="粘贴网址，如 example.com/gallery" style="flex:1;padding:9px 12px;border-radius:8px;',
      'border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:inherit;font-size:13px;outline:none;" />',
      '<input id="zfcNote" type="text" placeholder="备注（可选）" style="width:160px;padding:9px 12px;border-radius:8px;',
      'border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:inherit;font-size:13px;outline:none;" />',
      '<button id="zfcGo" style="padding:9px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;',
      'background:#3b82f6;color:#fff;font-weight:600;">发起采集</button>',
      '</div>',
      '<div id="zfcStatus" style="font-size:12.5px;min-height:18px;opacity:.85;"></div>',
      '<div id="zfcState" style="font-size:12.5px;color:#7ab0ff;min-height:16px;"></div>',
      '<div id="zfcOut" style="flex:1;min-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;',
      'border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:14px;background:rgba(0,0,0,.25);',
      'font-size:12.5px;line-height:1.75;color:var(--fg,#ddd);">（采集结果将实时显示在这里…）</div>',
      '<div style="font-size:11.5px;opacity:.6;line-height:1.7;">',
      '提示：仅采集公开内容；视频只存播放指针不下载；图片归档在 private/idols/（私有目录，HTTP 不可直读）。<br>',
      '最近采集：<span id="zfcRecent" style="opacity:.8;">（暂无）</span>',
      '</div>',
      '</div>'
    ].join('');

    var urlEl = body.querySelector('#zfcUrl');
    var noteEl = body.querySelector('#zfcNote');
    var statusEl = body.querySelector('#zfcStatus');
    var stateEl = body.querySelector('#zfcState');
    var outEl = body.querySelector('#zfcOut');
    var recentEl = body.querySelector('#zfcRecent');
    var recent = [];
    try { recent = JSON.parse(localStorage.getItem('zfcRecentUrls') || '[]'); } catch (e) { recent = []; }
    function renderRecent() {
      if (!recent.length) { recentEl.textContent = '（暂无）'; return; }
      recentEl.innerHTML = recent.slice(0, 4).map(function (u) {
        return '<a href="#" data-u="' + esc(u) + '" style="color:#7ab0ff;text-decoration:none;">' + esc(u) + '</a>';
      }).join(' · ');
      recentEl.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); urlEl.value = a.dataset.u; });
      });
    }
    renderRecent();

    function go() {
      var url = (urlEl.value || '').trim();
      if (!url) { statusEl.textContent = '⚠️ 请先粘贴网址'; return; }
      if (!/^https?:\/\//i.test(url) && !/\./.test(url)) { statusEl.textContent = '⚠️ 网址格式不对'; return; }
      var note = (noteEl.value || '').trim();
      var r = sendToChat(url, note);
      if (!r.ok) { statusEl.textContent = '❌ ' + r.err; return; }
      recent.unshift(url); recent = recent.slice(0, 8);
      try { localStorage.setItem('zfcRecentUrls', JSON.stringify(recent)); } catch (e) {}
      renderRecent();
      if (r.auto) {
        statusEl.innerHTML = '🚀 已自动发送采集指令，AI 开始工作。<b style="color:#7ab0ff;">下方结果区实时显示 AI 回复与采集清单</b>。';
        outEl.textContent = '（等待 AI 采集结果…）';
        bindMirror(body, outEl, stateEl);
      } else {
        statusEl.innerHTML = '⚠️ 自动发送失败，指令已填入对话输入框，请<b style="color:#7ab0ff;">回对话窗口手动点发送</b>。';
        bindMirror(body, outEl, stateEl);
      }
    }

    body.querySelector('#zfcGo').addEventListener('click', go);
    urlEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) go(); });
    // 窗口打开时就挂上镜像，能看到进行中的采集
    bindMirror(body, outEl, stateEl);
  }

  window.ZFCollect = { onOpen: onOpen };
})();
