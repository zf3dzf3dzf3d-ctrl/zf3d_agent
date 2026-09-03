/**
 * app-knowledge-graph.js — 知识图谱可视化（长任务 lp-20260902-051533 · 步骤 4）
 * ---------------------------------------------------------------
 * 零耦合独立模块：全屏覆盖层 + SVG 力导向图。
 *   - 概念为霓虹发光节点（与 FlowGlam 风格统一），关系为连线
 *   - 支持搜索、按关系类型过滤、点击查看详情与来源、拖拽/缩放
 *   - 入口：window.KGView.toggle() / open() / close()
 * 依赖：window.KGData（kg-data.js）。无则提示未安装。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.KGView) return;

  var overlay = null, svg = null, sim = null, nodes = [], links = [];
  var filterType = '', searchTerm = '', selected = null;

  // ---------- 样式（内联注入，避免改 css 文件） ----------
  var CSS = [
    '#kg-overlay{position:fixed;inset:0;z-index:99990;background:radial-gradient(ellipse at 50% 40%,#0d1226 0%,#05070f 100%);display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#cfd8ff;}',
    '#kg-head{display:flex;gap:10px;align-items:center;padding:12px 18px;border-bottom:1px solid rgba(120,160,255,.15);flex-wrap:wrap;}',
    '#kg-head h3{margin:0;font-size:16px;background:linear-gradient(90deg,#7cf,#a6f);-webkit-background-clip:text;background-clip:text;color:transparent;}',
    '#kg-search{background:rgba(255,255,255,.06);border:1px solid rgba(120,160,255,.3);border-radius:8px;color:#fff;padding:6px 12px;width:200px;outline:none;}',
    '#kg-type{background:rgba(255,255,255,.06);border:1px solid rgba(120,160,255,.3);border-radius:8px;color:#cfd8ff;padding:6px 8px;}',
    '#kg-close{margin-left:auto;background:rgba(255,90,90,.15);border:1px solid rgba(255,90,90,.4);color:#ff9;border-radius:8px;padding:6px 14px;cursor:pointer;}',
    '#kg-canvas-wrap{flex:1;position:relative;overflow:hidden;cursor:grab;}',
    '#kg-detail{position:absolute;right:14px;top:14px;width:280px;max-height:70%;overflow:auto;background:rgba(10,16,36,.85);border:1px solid rgba(120,160,255,.25);border-radius:12px;padding:14px;display:none;backdrop-filter:blur(8px);font-size:12px;line-height:1.7;}',
    '#kg-detail h4{margin:0 0 6px;color:#8cf;font-size:14px;}',
    '#kg-detail .kg-src{color:#7a8;}',
    '#kg-stats{padding:8px 18px;font-size:12px;color:#6a7aa8;border-top:1px solid rgba(120,160,255,.12);}'
  ].join('\n');

  var TYPE_COLORS = {
    concept: '#66e0ff', module: '#a78bfa', class: '#f0a35e', function: '#5eeaa0',
    file: '#8a9bb8', tool: '#ff7ab8', feature: '#ffd166', person: '#ff9f68', term: '#9bb8ff'
  };
  function colorOf(t) { return TYPE_COLORS[t] || '#88aaff'; }

  // ---------- 建图 ----------
  function buildGraph() {
    var data = KGData.exportAll() || {};
    var ents = data.entities || {}, rels = data.relations || {};
    var idMap = {}, ns = [], ls = [];
    var keys = Object.keys(ents);
    // 搜索过滤
    if (searchTerm) {
      keys = keys.filter(function (k) {
        var e = ents[k];
        return (e.name || '').toLowerCase().indexOf(searchTerm) >= 0 ||
               (e.desc || '').toLowerCase().indexOf(searchTerm) >= 0;
      });
    }
    keys.forEach(function (k) {
      var e = ents[k];
      var n = { id: k, name: e.name, type: e.type, desc: e.desc, sources: e.sources || [], hits: e.hits || 1 };
      idMap[k] = n; ns.push(n);
    });
    rels.forEach(function (r) {
      if (filterType && r.type !== filterType) return;
      var f = idMap[r.from], t = idMap[r.to];
      if (f && t) ls.push({ source: f, target: t, type: r.type, evidence: r.evidence, source: r.source });
    });
    nodes = ns; links = ls;
  }

  // ---------- 力导向（轻量自实现） ----------
  function runSim() {
    var W = overlay.clientWidth, H = overlay.clientHeight - 80;
    var N = nodes.length;
    if (N === 0) return;
    var big = N > 150;
    nodes.forEach(function (n, i) {
      if (n.x == null) { var a = i / N * Math.PI * 2; var rr = Math.min(W, H) * 0.35; n.x = W / 2 + Math.cos(a) * rr; n.y = H / 2 + Math.sin(a) * rr; }
    });
    var steps = big ? 120 : 300;
    for (var s = 0; s < steps; s++) {
      var k = 1 - s / steps;
      // 斥力
      for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
        var a = nodes[i], b = nodes[j];
        var dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2);
        var f = (big ? 12000 : 26000) / d2;
        var fx = dx / d * f, fy = dy / d * f;
        a.x -= fx * k; a.y -= fy * k; b.x += fx * k; b.y += fy * k;
      }
      // 引力
      links.forEach(function (l) {
        var a = l.source, b = l.target;
        var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        var f = (d - 110) * 0.015;
        var fx = dx / d * f, fy = dy / d * f;
        a.x += fx * k; a.y += fy * k; b.x -= fx * k; b.y -= fy * k;
      });
      // 边界
      nodes.forEach(function (n) {
        n.x = Math.max(40, Math.min(W - 40, n.x));
        n.y = Math.max(40, Math.min(H - 40, n.y));
      });
    }
  }

  function render() {
    svg.innerHTML = '';
    var NS = 'http://www.w3.org/2000/svg';
    links.forEach(function (l) {
      var ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', l.source.x); ln.setAttribute('y1', l.source.y);
      ln.setAttribute('x2', l.target.x); ln.setAttribute('y2', l.target.y);
      ln.setAttribute('stroke', 'rgba(120,160,255,.25)');
      ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln);
      var mid = document.createElementNS(NS, 'text');
      mid.setAttribute('x', (l.source.x + l.target.x) / 2 + 3);
      mid.setAttribute('y', (l.source.y + l.target.y) / 2 - 3);
      mid.setAttribute('fill', 'rgba(150,170,220,.5)');
      mid.setAttribute('font-size', '9');
      mid.textContent = l.type;
      svg.appendChild(mid);
    });
    nodes.forEach(function (n) {
      var g = document.createElementNS(NS, 'g');
      var c = document.createElementNS(NS, 'circle');
      var r = Math.min(6 + n.hits * 1.5, 18);
      c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', r);
      c.setAttribute('fill', colorOf(n.type));
      c.setAttribute('opacity', '0.85');
      c.setAttribute('filter', 'drop-shadow(0 0 6px ' + colorOf(n.type) + ')');
      c.style.cursor = 'pointer';
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', n.x + r + 4); t.setAttribute('y', n.y + 4);
      t.setAttribute('fill', '#cfd8ff'); t.setAttribute('font-size', '11');
      t.textContent = n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name;
      g.appendChild(c); g.appendChild(t);
      c.addEventListener('click', function (ev) { ev.stopPropagation(); showDetail(n); });
      svg.appendChild(g);
    });
    document.getElementById('kg-stats').textContent =
      '实体 ' + nodes.length + ' · 关系 ' + links.length + ' · 拖拽平移 / 滚轮缩放 / 点击节点看详情';
  }

  function showDetail(n) {
    var d = document.getElementById('kg-detail');
    var rels = KGData.relationsOf ? KGData.relationsOf(n.id) : [];
    var relHtml = rels.slice(0, 15).map(function (r) {
      var dir = r.from === n.id ? '→ ' + r.to : '← ' + r.from;
      return '<div>· ' + dir + ' <span style="color:#88a">(' + r.type + ')</span></div>';
    }).join('');
    d.innerHTML = '<h4>' + n.name + '</h4>' +
      '<div style="color:' + colorOf(n.type) + '">' + n.type + ' · 置信度 ' + Math.min(1, n.hits * 0.1 + 0.5).toFixed(2) + '</div>' +
      '<div style="margin:6px 0">' + (n.desc || '（无描述）') + '</div>' +
      '<div class="kg-src">来源: ' + (n.sources && n.sources.length ? n.sources.join(', ') : '未知') + '</div>' +
      '<div style="margin-top:8px;color:#88a">关系 (' + rels.length + '):</div>' + relHtml;
    d.style.display = 'block';
  }

  // ---------- 平移缩放 ----------
  var vx = 0, vy = 0, vs = 1;
  function bindPanZoom() {
    var wrap = document.getElementById('kg-canvas-wrap');
    var drag = false, lx = 0, ly = 0;
    wrap.addEventListener('mousedown', function (e) { drag = true; lx = e.clientX; ly = e.clientY; wrap.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      vx += e.clientX - lx; vy += e.clientY - ly; lx = e.clientX; ly = e.clientY;
      svg.setAttribute('transform', 'translate(' + vx + ',' + vy + ') scale(' + vs + ')');
    });
    window.addEventListener('mouseup', function () { drag = false; if (wrap) wrap.style.cursor = 'grab'; });
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      vs = Math.max(0.2, Math.min(4, vs * (e.deltaY < 0 ? 1.12 : 0.89)));
      svg.setAttribute('transform', 'translate(' + vx + ',' + vy + ') scale(' + vs + ')');
    }, { passive: false });
  }

  function refresh() {
    if (!overlay || !window.KGData) return;
    vx = 0; vy = 0; vs = 1;
    svg.removeAttribute('transform');
    buildGraph(); runSim(); render();
  }

  // ---------- UI ----------
  function open() {
    if (!window.KGData) { alert('知识库未安装（kg-data.js）'); return; }
    if (overlay) { overlay.style.display = 'flex'; refresh(); return; }
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    overlay = document.createElement('div'); overlay.id = 'kg-overlay';
    var relTypes = {};
    var data = KGData.exportAll() || {};
    Object.keys(data.relations || {}).forEach(function (k) { relTypes[data.relations[k].type] = 1; });
    var opts = ['<option value="">全部关系</option>'].concat(Object.keys(relTypes).map(function (t) { return '<option value="' + t + '">' + t + '</option>'; })).join('');
    overlay.innerHTML =
      '<div id="kg-head"><h3>🔮 知识图谱</h3>' +
      '<input id="kg-search" placeholder="搜索概念…">' +
      '<select id="kg-type">' + opts + '</select>' +
      '<button id="kg-rebuild" style="background:rgba(120,160,255,.15);border:1px solid rgba(120,160,255,.35);color:#cfd8ff;border-radius:8px;padding:6px 12px;cursor:pointer">重新布局</button>' +
      '<button id="kg-close">✕ 关闭</button></div>' +
      '<div id="kg-canvas-wrap"><svg id="kg-svg" style="width:100%;height:100%"><g id="kg-g"></g></svg>' +
      '<div id="kg-detail"></div></div>' +
      '<div id="kg-stats"></div>';
    document.body.appendChild(overlay);
    svg = overlay.querySelector('#kg-g');
    document.getElementById('kg-close').onclick = close;
    document.getElementById('kg-rebuild').onclick = refresh;
    document.getElementById('kg-search').oninput = function () { searchTerm = this.value.trim().toLowerCase(); refresh(); };
    document.getElementById('kg-type').onchange = function () { filterType = this.value; refresh(); };
    document.getElementById('kg-canvas-wrap').addEventListener('click', function () {
      var d = document.getElementById('kg-detail'); if (d) d.style.display = 'none';
    });
    bindPanZoom();
    refresh();
  }

  function close() { if (overlay) overlay.style.display = 'none'; }
  function toggle() { (overlay && overlay.style.display === 'flex') ? close() : open(); }

  window.KGView = { open: open, close: close, toggle: toggle, refresh: refresh };
})();
