/* ============================================================
 * zf-app-news.js v2 — i新闻 内容模块（M2 真数据版）
 * 挂载点：#zfNewsBody（由 zf-app-dock.js openNews 懒挂载）
 * 契约：window.ZFNews = { onOpen(body), onClose() }
 * 采纳收口裁决：
 *  - 突破师杠杆2：M1 数据走前端常量假数据（M2 再议后端）
 *  - 突破师杠杆3：单态卡片列表 + 内联展开（不做两态阅读器）
 *  - 反驳师缺口⑤：内容脚本不自行绑定 Esc，由 dock 层统一关窗
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFNews) return;

  var ICONS = {
    news: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="15" height="15" rx="2"/><path d="M6.5 8h8M6.5 11.5h8M6.5 15h5"/><path d="M18 9h2.5v8.5a2 2 0 0 1-2 2H6"/></svg>'
  };

  /* M2：数据源改为 /api/news/list；NEWS_DATA 仅作请求失败时的兜底 */
  var NEWS_DATA = [
    { id: 1, cat: 'AI 前沿', title: '多智能体协作蜂群模式上线：收口汇总机制首次实战', time: '今天 21:20', src: '朱峰社区', summary: '本轮 i新闻开发采用「小队收口」多视角蜂群：策划师出方案、反驳师红队审查、突破师挑战定式、进化师给建议，收口后一次性裁决采纳，开发效率显著提升。' },
    { id: 2, cat: '产品动态', title: 'Dock 应用矩阵再添新成员：i新闻正式接入', time: '今天 21:25', src: '官方发布', summary: '继 i漫画、i聊天、i硬件、i计算器之后，i新闻以卡片新闻流形态接入 Dock，复用 createAppWindow 窗口工厂与懒挂载机制，Esc/F11 全部继承通用行为。' },
    { id: 3, cat: '工程纪律', title: '前端缓存号升级纪律再次强调：改 js 必升 ?v=', time: '今天 20:10', src: '项目纪律', summary: '历史曾因浏览器缓存旧版 js 导致"改了不生效"误判为 bug 返工。本次 zf-app-dock.js 改动后已将 index.html 缓存号升级，M1 验收含此项硬指标。' },
    { id: 4, cat: 'AI 前沿', title: '一切皆插件：从硬编码四分支到注册表架构的演进', time: '昨天', src: '技术周刊', summary: 'Dock 已沉淀 register 通用通道，窗口工厂 createAppWindow 支持任意 App 复用；未来 i视频/i音乐等新 App 可按「注册 1 条 + 内容模块 1 个」接入。' },
    { id: 5, cat: '社区动态', title: '调查黑板机制运行良好：跨视角结论可追溯', time: '昨天', src: '社区公告', summary: '反驳师/进化师/突破师本轮结论均已落盘调查黑板并更新索引，形成完整的决策证据链，方便后续复盘与审计。' },
    { id: 6, cat: '产品动态', title: 'i漫画全屏阅读与窗口拖拽体验优化回顾', time: '前天', src: '官方发布', summary: '窗口位置尺寸记忆、边缘贴靠吸附、F11 通用全屏等能力均沉淀在 createAppWindow 工厂层，所有 Dock App 自动继承。' }
  ];

  var CATS = ['全部', 'AI 前沿', '产品动态', '工程纪律', '社区动态'];
  var READ_KEY = 'zfNewsReadIds';
  var body, ui = {};

  /* 【XSS】服务端（/api/news/list）与兜底数据进 innerHTML 前统一转义
     （ZFMD.escapeHtml 优先，未加载时本地兜底），覆盖 &<>"' */
  function esc(s) {
    if (window.ZFMD && ZFMD.escapeHtml) return ZFMD.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getRead() {
    try { return JSON.parse(localStorage.getItem(READ_KEY) || '[]'); } catch (e) { return []; }
  }
  function markRead(id) {
    var r = getRead();
    if (r.indexOf(id) < 0) { r.push(id); try { localStorage.setItem(READ_KEY, JSON.stringify(r)); } catch (e) {} }
  }

  function render() {
    var cat = ui.catSel.value;
    var kw = (ui.search.value || '').trim().toLowerCase();
    var read = getRead();
    var list = NEWS_DATA.filter(function (n) {
      if (cat !== '全部' && n.cat !== cat) return false;
      if (kw && (n.title + n.summary + n.src).toLowerCase().indexOf(kw) < 0) return false;
      return true;
    });
    var html = list.map(function (n) {
      var isRead = read.indexOf(n.id) >= 0;
      return '<div class="zfn-card' + (isRead ? ' zfn-read' : '') + '" data-id="' + esc(n.id) + '">' +
        '<div class="zfn-card-top"><span class="zfn-cat">' + esc(n.cat) + '</span>' +
        '<span class="zfn-meta">' + esc(n.time) + ' · ' + esc(n.src) + (isRead ? ' · 已读' : '') + '</span></div>' +
        '<div class="zfn-title">' + esc(n.title) + '</div>' +
        '<div class="zfn-summary">' + esc(n.summary) + '</div></div>';
    });
    ui.list.innerHTML = html.length ? html.join('') :
      '<div class="zfn-empty">没有匹配的新闻</div>';
    ui.count.textContent = list.length + ' 条' + (cat !== '全部' ? ' · ' + cat : '');
  }

  function toggleCard(card) {
    var open = card.classList.toggle('zfn-open');
    if (open) {
      var id = parseInt(card.dataset.id);
      markRead(id);
      card.classList.add('zfn-read');
      var n = NEWS_DATA.filter(function (x) { return x.id === id; })[0];
      if (n) card.querySelector('.zfn-meta').textContent = n.time + ' · ' + n.src + ' · 已读';
    }
  }

  function injectCss() {
    if (document.getElementById('zfnStyle')) return;
    var st = document.createElement('style');
    st.id = 'zfnStyle';
    st.textContent =
      '.zfn-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#141519;color:#d8d8e0;font-size:13px}' +
      '.zfn-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);flex:0 0 auto;flex-wrap:wrap}' +
      '.zfn-logo{display:flex;align-items:center;gap:6px;font-weight:600;color:#fff;font-size:14px}' +
      '.zfn-logo svg{color:#5aa2ff}' +
      '.zfn-count{color:#8a8a94;font-size:12px;margin-left:auto}' +
      '.zfn-search{background:#1e2026;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#d8d8e0;padding:5px 10px;font-size:12px;width:150px;outline:none}' +
      '.zfn-search:focus{border-color:#5aa2ff}' +
      '.zfn-chips{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.06);flex:0 0 auto;flex-wrap:wrap}' +
      '.zfn-chip{border:1px solid rgba(255,255,255,.14);background:transparent;color:#a8a8b2;border-radius:999px;padding:3px 12px;font-size:12px;cursor:pointer;transition:all .15s}' +
      '.zfn-chip:hover{border-color:#5aa2ff;color:#d8d8e0}' +
      '.zfn-chip.on{background:#5aa2ff;border-color:#5aa2ff;color:#fff}' +
      '.zfn-list{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}' +
      '.zfn-card{background:#1b1d23;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;cursor:pointer;transition:border-color .15s,transform .15s}' +
      '.zfn-card:hover{border-color:rgba(90,162,255,.5);transform:translateY(-1px)}' +
      '.zfn-card-top{display:flex;align-items:center;gap:10px;margin-bottom:6px}' +
      '.zfn-cat{background:rgba(90,162,255,.15);color:#5aa2ff;border-radius:4px;padding:1px 8px;font-size:11px}' +
      '.zfn-meta{color:#77777f;font-size:11px}' +
      '.zfn-title{color:#eee;font-size:14px;font-weight:600;line-height:1.45;margin-bottom:6px}' +
      '.zfn-summary{color:#9a9aa4;font-size:12.5px;line-height:1.6;max-height:3.2em;overflow:hidden;transition:max-height .25s}' +
      '.zfn-card.zfn-open .zfn-summary{max-height:20em}' +
      '.zfn-card.zfn-read .zfn-title{color:#9a9aa4;font-weight:500}' +
      '.zfn-empty{text-align:center;color:#66666e;padding:40px 0}' +
      '@media (max-width:640px){.zfn-search{width:110px}}';
    document.head.appendChild(st);
  }

  function onOpen(el) {
    body = el;
    injectCss();
    if (el.dataset.zfnUi) { return; }   /* 已构建，仅重开 */
    el.dataset.zfnUi = '1';
    el.innerHTML =
      '<div class="zfn-wrap">' +
      '  <div class="zfn-bar">' +
      '    <div class="zfn-logo">' + ICONS.news + '<span>i新闻</span></div>' +
      '    <input class="zfn-search" placeholder="搜索新闻…" />' +
      '    <span class="zfn-count"></span>' +
      '  </div>' +
      '  <div class="zfn-chips"></div>' +
      '  <div class="zfn-list"></div>' +
      '</div>';
    ui.search = el.querySelector('.zfn-search');
    ui.count = el.querySelector('.zfn-count');
    ui.chips = el.querySelector('.zfn-chips');
    ui.list = el.querySelector('.zfn-list');

    ui.chips.innerHTML = CATS.map(function (c, i) {
      return '<button class="zfn-chip' + (i === 0 ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    ui.chips.addEventListener('click', function (e) {
      var b = e.target.closest('.zfn-chip');
      if (!b) return;
      ui.chips.querySelectorAll('.zfn-chip').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      render();
    });
    ui.catSel = { value: '全部' };  /* 借用 chips 选中态 */
    ui.search.addEventListener('input', render);
    ui.list.addEventListener('click', function (e) {
      var card = e.target.closest('.zfn-card');
      if (card) toggleCard(card);
    });
    render();
    fetchNews();
  }

  /* M2：拉取真数据，成功则替换 NEWS_DATA 并重渲染；失败静默保留兜底 */
  function fetchNews() {
    fetch('/api/news/list')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.items) && d.items.length) {
          NEWS_DATA = d.items;
          var cats = ['全部'];
          d.items.forEach(function (n) { if (cats.indexOf(n.cat) < 0) cats.push(n.cat); });
          CATS.length = 0; cats.forEach(function (c) { CATS.push(c); });
          rebuildChips();
          render();
        }
      })
      .catch(function () { /* API 不可用时保留内置兜底数据 */ });
  }

  function rebuildChips() {
    if (!ui.chips) return;
    ui.chips.innerHTML = CATS.map(function (c, i) {
      return '<button class="zfn-chip' + (i === 0 ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    ui.catSel = { value: '全部' };
  }

  function onClose() { /* 无定时器/媒体，暂无需清理 */ }

  window.ZFNews = { onOpen: onOpen, onClose: onClose };
})();
