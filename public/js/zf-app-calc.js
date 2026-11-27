/* ============================================================
 * i计算器 (zf-app-calc.js)  v3 —— 2026-11-17 仿真重做
 * ①仿真实体计算器外观：机身渐变/金属边框/立体按键/LED显示屏
 * ②标准 / 科学 模式切换（科学含 sin cos tan ln log √ x² 1/x π e 阶乘）
 * ③等号连按继续计算：1+1=2 再按= → 3（重复最后一次二元运算）
 * ④历史记录可折叠，键盘支持
 * API：window.ZFCalc = { onOpen, onClose, calc, clearHistory }
 * ============================================================ */
(function () {
  'use strict';

  var HIST_KEY = 'zfcHistory';
  var MODE_KEY = 'zfcMode';
  var state = { expr: '', result: null, lastOp: null, lastB: null, justEval: false, hist: [], error: '', sci: false };

  /* ---------- 安全求值（手写解析器，零eval） ---------- */
  var FN = {
    sin: function (x) { return Math.sin(x); },
    cos: function (x) { return Math.cos(x); },
    tan: function (x) { return Math.tan(x); },
    ln: function (x) { if (x <= 0) throw new Error('定义域错误'); return Math.log(x); },
    log: function (x) { if (x <= 0) throw new Error('定义域错误'); return Math.log(x) / Math.LN10; },
    sqrt: function (x) { if (x < 0) throw new Error('定义域错误'); return Math.sqrt(x); },
    abs: Math.abs
  };
  function factorial(n) {
    if (n < 0 || n !== Math.floor(n) || n > 170) throw new Error('定义域错误');
    var r = 1; for (var i = 2; i <= n; i++) r *= i; return r;
  }
  function safeEval(raw) {
    var e = String(raw)
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
      .replace(/π/g, '(3.141592653589793)').replace(/(?<![a-z])e(?![0-9a-z])/g, '(2.718281828459045)')
      .replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
    /* 函数名 → f(数字) 形式预标记 */
    if (!/^[0-9+\-*/^().,!\s a-z]*$/i.test(e)) throw new Error('表达式含非法字符');
    var toks = e.match(/\d+(?:\.\d+)?|[a-z]+|[+\-*/^(),!]/gi) || [];
    var i = 0;
    function peek() { return toks[i]; }
    function next() { return toks[i++]; }
    function expr() {
      var v = term();
      while (peek() === '+' || peek() === '-') { var op = next(); v = op === '+' ? v + term() : v - term(); }
      return v;
    }
    function term() {
      var v = unary();
      while (peek() === '*' || peek() === '/') {
        var op = next(); var r = unary();
        if (op === '/') { if (r === 0) throw new Error('不能除以0'); v = v / r; } else v = v * r;
      }
      /* 隐式乘法：2π、2(3+4)、)(  */
      while (peek() && (/^[\d.]/.test(peek()) || peek() === '(' || /^[a-z]+$/i.test(peek()))) {
        v = v * unary();
      }
      return v;
    }
    function unary() {
      if (peek() === '-') { next(); return -unary(); }
      if (peek() === '+') { next(); return unary(); }
      return power();
    }
    function power() {
      var b = postfix();
      if (peek() === '^') { next(); return Math.pow(b, unary()); }
      return b;
    }
    function postfix() {
      var v = primary();
      while (peek() === '!') { next(); v = factorial(v); }
      return v;
    }
    function primary() {
      var t = next();
      if (t === undefined) throw new Error('表达式有误');
      if (t === '(') { var v = expr(); if (next() !== ')') throw new Error('括号不匹配'); return v; }
      if (/^\d/.test(t)) return parseFloat(t);
      if (/^[a-z]+$/i.test(t)) {
        var fname = t.toLowerCase();
        if (!(fname in FN)) throw new Error('未知函数 ' + t);
        var arg;
        if (peek() === '(') { next(); arg = expr(); if (next() !== ')') throw new Error('括号不匹配'); }
        else arg = postfix();
        return FN[fname](arg);
      }
      throw new Error('表达式有误');
    }
    var r = expr();
    if (i < toks.length) throw new Error('表达式有误');
    if (typeof r !== 'number' || !isFinite(r)) throw new Error('结果无效');
    return Math.round(r * 1e12) / 1e12;
  }

  /* 二元运算符识别（连等用） */
  var BIN = /^[+\-*/^×÷−]/;
  function splitLastOp(exprStr) {
    /* 从右往左找最外层二元运算符（深度0），返回 {a, op, b} */
    var depth = 0;
    for (var j = exprStr.length - 1; j >= 0; j--) {
      var c = exprStr[j];
      if (c === ')') depth++;
      else if (c === '(') depth--;
      else if (depth === 0 && '+*/^×÷−'.indexOf(c) >= 0 && j > 0) {
        /* 跳过科学函数名里的字母（不会出现，op为单字符）；负号处理：前一字符也是运算符/开头则不是二元 */
        var prev = exprStr[j - 1];
        if (c === '-' && (j === 0 || '+-*/^(×÷−'.indexOf(prev) >= 0)) continue;
        return { a: exprStr.slice(0, j), op: c, b: exprStr.slice(j + 1) };
      }
    }
    return null;
  }
  function applyOp(op, a, b) {
    switch (op) {
      case '+': return a + b;
      case '−': case '-': return a - b;
      case '×': case '*': return a * b;
      case '÷': case '/': if (b === 0) throw new Error('不能除以0'); return a / b;
      case '^': return Math.pow(a, b);
    }
    throw new Error('未知运算');
  }

  function fmt(n) {
    var s = String(n);
    return s.length > 16 ? parseFloat(n.toPrecision(12)).toString() : s;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var exprEl = document.getElementById('zfcExpr');
    var subEl = document.getElementById('zfcSub');
    var errEl = document.getElementById('zfcErr');
    var listEl = document.getElementById('zfcHistList');
    var emptyEl = document.getElementById('zfcHistEmpty');
    if (exprEl) {
      exprEl.textContent = state.expr || (state.result !== null ? fmt(state.result) : '0');
      var len = exprEl.textContent.length;
      exprEl.style.fontSize = len > 16 ? '15px' : (len > 12 ? '19px' : (len > 8 ? '24px' : '30px'));
    }
    if (subEl) subEl.textContent = state.sub || '';
    if (errEl) errEl.textContent = state.error || '';
    if (listEl) {
      listEl.innerHTML = state.hist.slice(0, 30).map(function (h) {
        return '<div class="zfc-hitem" data-he="' + esc(h.e) + '"><span>' + esc(h.e) + '</span><b>= ' + esc(h.r) + '</b></div>';
      }).join('');
    }
    if (emptyEl) emptyEl.style.display = state.hist.length ? 'none' : 'block';
  }

  function press(k) {
    state.error = '';
    if (k === 'C' || k === 'AC') {
      state.expr = ''; state.result = null; state.lastOp = null; state.lastB = null; state.justEval = false; state.sub = '';
    } else if (k === '⌫') {
      state.expr = state.expr.slice(0, -1); state.justEval = false;
    } else if (k === '=') {
      if (!state.expr && state.result === null) return;
      try {
        var r;
        if (state.expr) {
          r = fmt(safeEval(state.expr));
          var parts = splitLastOp(state.expr);
          if (parts) { state.lastOp = parts.op; state.lastB = parts.b; }
        } else {
          r = fmt(applyOp(state.lastOp, state.result, parseFloat(safeEval(state.lastB))));
        }
        var shown = state.expr || (fmt(state.result) + state.lastOp + state.lastB);
        state.hist.unshift({ e: shown, r: r });
        if (state.hist.length > 100) state.hist.length = 100;
        saveHist();
        state.sub = shown + ' =';
        state.result = parseFloat(r);
        state.expr = '';
        state.justEval = true;
      } catch (err) {
        state.error = err.message || '表达式有误';
        render(); return;
      }
    } else if (state.justEval && BIN.test(k) && k !== '(' && k !== ')') {
      /* 等号后按运算符：以结果为左操作数继续 */
      state.expr = fmt(state.result) + k;
      state.result = null; state.justEval = false;
    } else {
      if (state.justEval) { state.expr = ''; state.result = null; state.justEval = false; }
      /* 防重复小数点（当前数字段内） */
      if (k === '.') {
        var seg = state.expr.split(/[+\-*/^()×÷−]/).pop();
        if (seg.indexOf('.') >= 0) return;
        if (!seg) k = '0.';
      }
      state.expr += k;
    }
    render();
  }

  function saveHist() { try { localStorage.setItem(HIST_KEY, JSON.stringify(state.hist.slice(0, 30))); } catch (e) {} }
  function loadHist() { try { state.hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { state.hist = []; } }

  /* ---------- 按键布局 ---------- */
  var KEYS_STD = [
    ['AC', '⌫', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['(', ')', '0', '.'],
    ['^', 'π', '=', '=']
  ];
  var KEYS_SCI = [
    ['AC', '⌫', '(', ')'],
    ['sin', 'cos', 'tan', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['0', '.', 'e', '^'],
    ['ln', 'log', '√', 'x²'],
    ['1/x', 'x!', '%', '=']
  ];

  function buildPad() {
    var pad = document.getElementById('zfcPad');
    if (!pad) return;
    var keys = state.sci ? KEYS_SCI : KEYS_STD;
    var html = '';
    keys.forEach(function (row) {
      row.forEach(function (k) {
        var cls = 'zfc-k';
        if (k === '=') cls += ' zfc-eq';
        else if ('AC⌫%÷×−+^()'.indexOf(k) >= 0 && k.length <= 2) cls += ' zfc-fn';
        else if (k.length > 1 && k !== '0.') cls += ' zfc-sf';
        html += '<button data-k="' + esc(k) + '" class="' + cls + '">' + esc(k) + '</button>';
      });
    });
    pad.innerHTML = html;
    pad.style.gridTemplateColumns = 'repeat(4,1fr)';
    pad.style.gridAutoRows = state.sci ? 'minmax(0,1fr)' : 'minmax(0,1.4fr)';
  }

  function bind() {
    var body = document.getElementById('zfCalcBody');
    if (!body || body.dataset.zfcBound) return;
    body.dataset.zfcBound = '1';
    body.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-k]');
      if (t) { press(t.dataset.k); return; }
      if (ev.target.closest('#zfcHistClear')) {
        state.hist = []; state.error = ''; saveHist(); render(); return;
      }
      var h = ev.target.closest('.zfc-hitem');
      if (h) { state.expr = h.getAttribute('data-he'); state.justEval = false; render(); return; }
      if (ev.target.closest('#zfcModeBtn')) {
        state.sci = !state.sci;
        try { localStorage.setItem(MODE_KEY, state.sci ? 'sci' : 'std'); } catch (e) {}
        var btn = document.getElementById('zfcModeBtn');
        if (btn) btn.textContent = state.sci ? '科学' : '标准';
        buildPad(); render();
      }
      if (ev.target.closest('#zfcHistToggle')) {
        var box = document.querySelector('.zfc-bodywrap');
        if (box) box.classList.toggle('zfc-hist-open');
      }
    });
    document.addEventListener('keydown', function (e) {
      var win = document.getElementById('zfCalcWin');
      if (!win || !win.classList.contains('open')) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      var map = { 'Enter': '=', '=': '=', 'Backspace': '⌫', '*': '×', '/': '÷', 'Escape': 'AC', 'Delete': 'AC' };
      if (/^[0-9+\-().%^]$/.test(e.key)) { press(e.key); e.preventDefault(); }
      else if (map[e.key]) { press(map[e.key]); e.preventDefault(); }
    });
  }

  /* ---------- 仿真 CSS：实体机身 + LED 屏 + 立体按键 ---------- */
  /* 主题跟随：默认（深色）变量 + html[data-theme="light"] 白色主题覆盖，
     深浅两套配色都走变量，切主题即时生效无需重挂载 */
  var CSS = ''
    + '#zfCalcBody{--zfc-body-a:#2b2f3a;--zfc-body-b:#1c1f28;--zfc-body-c:#14161d;'
    + '  --zfc-btnbg-a:#3d4353;--zfc-btnbg-b:#272b37;--zfc-btnbg-c:#1e222c;--zfc-btn-border:#0e1015;--zfc-btn-txt:#e8eaf2;'
    + '  --zfc-btn-shadow:#14161d;--zfc-fn-a:#4a4258;--zfc-fn-b:#332d44;--zfc-fn-c:#28233a;--zfc-fn-txt:#c9b8ff;--zfc-fn-shadow:#1a1626;'
    + '  --zfc-scr-a:#101812;--zfc-scr-b:#0a100c;--zfc-scr-border:#0a0c10;--zfc-expr:#8df0a8;--zfc-expr-glow:rgba(90,240,140,.55);'
    + '  --zfc-sub:#3e8a5a;--zfc-tbtn-a:#3a3f4d;--zfc-tbtn-b:#2a2e3a;--zfc-tbtn-border:#454b5c;--zfc-tbtn-txt:#aeb6c8;'
    + '  --zfc-brand:#5a6172;--zfc-hist-txt:#8a92a6;--zfc-hist-head:#5a6172;--zfc-hist-empty:#454b5c;'
    + '  flex:1;display:flex;flex-direction:column;overflow:hidden;user-select:none;'
    + '  background:linear-gradient(160deg,var(--zfc-body-a) 0%,var(--zfc-body-b) 40%,var(--zfc-body-c) 100%);}'
    + 'html[data-theme="light"] #zfCalcBody{'
    + '  --zfc-body-a:#eef1f6;--zfc-body-b:#e3e8f0;--zfc-body-c:#d8dee9;'
    + '  --zfc-btnbg-a:#ffffff;--zfc-btnbg-b:#f2f5fa;--zfc-btnbg-c:#e8edf5;--zfc-btn-border:#d3dbe6;--zfc-btn-txt:#2b3242;'
    + '  --zfc-btn-shadow:#c3ccda;--zfc-fn-a:#ece7f8;--zfc-fn-b:#e0d9f3;--zfc-fn-c:#d5cced;--zfc-fn-txt:#6a55c8;--zfc-fn-shadow:#c4bce6;'
    + '  --zfc-scr-a:#f6faf7;--zfc-scr-b:#eaf4ee;--zfc-scr-border:#c9d6cd;--zfc-expr:#1d7a44;--zfc-expr-glow:rgba(40,160,90,.18);'
    + '  --zfc-sub:#4a9c6e;--zfc-tbtn-a:#ffffff;--zfc-tbtn-b:#eef1f6;--zfc-tbtn-border:#d3dbe6;--zfc-tbtn-txt:#4a5468;'
    + '  --zfc-brand:#8a92a6;--zfc-hist-txt:#5a6478;--zfc-hist-head:#8a92a6;--zfc-hist-empty:#b0b8c8;}'
    + '.zfc-top{display:flex;justify-content:space-between;align-items:center;padding:8px 12px 0;}'
    + '.zfc-brand{font-size:11px;letter-spacing:3px;color:var(--zfc-brand);font-weight:700;}'
    + '.zfc-tbtns{display:flex;gap:6px;}'
    + '.zfc-tbtns button{background:linear-gradient(180deg,var(--zfc-tbtn-a),var(--zfc-tbtn-b));border:1px solid var(--zfc-tbtn-border);color:var(--zfc-tbtn-txt);'
    + '  font-size:12px;padding:3px 12px;border-radius:12px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.15);}'
    + '.zfc-tbtns button:active{box-shadow:inset 0 1px 3px rgba(0,0,0,.2);}'
    + '.zfc-screen{margin:10px 14px 6px;padding:10px 14px 6px;border-radius:10px;'
    + '  background:linear-gradient(180deg,var(--zfc-scr-a),var(--zfc-scr-b));border:2px solid var(--zfc-scr-border);'
    + '  box-shadow:inset 0 2px 8px rgba(0,0,0,.18),0 1px 0 rgba(255,255,255,.06);position:relative;overflow:hidden;}'
    + '.zfc-screen::after{content:"";position:absolute;inset:0;pointer-events:none;'
    + '  background:linear-gradient(115deg,rgba(255,255,255,.07) 0%,transparent 30%);}'
    + '#zfcErr{min-height:14px;font-size:11px;color:#e0453a;text-align:right;font-family:Consolas,monospace;}'
    + '#zfcSub{min-height:14px;font-size:12px;color:var(--zfc-sub);text-align:right;font-family:Consolas,monospace;}'
    + '#zfcExpr{min-height:40px;text-align:right;font-family:"Consolas","Courier New",monospace;'
    + '  font-size:30px;font-weight:700;color:var(--zfc-expr);text-shadow:0 0 8px var(--zfc-expr-glow);'
    + '  word-break:break-all;line-height:1.1;transition:font-size .15s;}'
    + '.zfc-bodywrap{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;}'
    + '.zfc-hist{flex:0 0 26%;overflow:auto;padding:6px 14px;font-size:12px;color:var(--zfc-hist-txt);border-top:1px solid rgba(128,140,160,.18);}'
    + '.zfc-hhead{display:flex;justify-content:space-between;align-items:center;padding-bottom:2px;}'
    + '.zfc-hhead span{font-size:11px;color:var(--zfc-hist-head);}'
    + '#zfcHistClear{background:none;border:none;color:var(--zfc-hist-head);font-size:11px;cursor:pointer;padding:2px 6px;border-radius:6px;}'
    + '#zfcHistClear:hover{color:var(--zfc-btn-txt);background:rgba(128,140,160,.15);}'
    + '#zfcHistEmpty{padding:10px 0;text-align:center;color:var(--zfc-hist-empty);font-size:11px;}'
    + '.zfc-hitem{display:flex;justify-content:space-between;gap:10px;padding:2px 0;cursor:pointer;border-radius:4px;}'
    + '.zfc-hitem:hover{background:rgba(128,140,160,.12);}'
    + '.zfc-hitem b{color:var(--zfc-expr);font-weight:600;font-family:Consolas,monospace;}'
    + '#zfcPad{flex:1;display:grid;gap:7px;padding:8px 12px 14px;min-height:0;}'
    + '.zfc-k{border-radius:9px;border:1px solid var(--zfc-btn-border);color:var(--zfc-btn-txt);font-size:17px;font-weight:600;cursor:pointer;'
    + '  background:linear-gradient(180deg,var(--zfc-btnbg-a) 0%,var(--zfc-btnbg-b) 55%,var(--zfc-btnbg-c) 100%);'
    + '  box-shadow:0 3px 0 var(--zfc-btn-shadow),0 4px 6px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.35);'
    + '  transition:filter .1s,transform .05s,box-shadow .05s;font-family:Consolas,monospace;}'
    + '.zfc-k:hover{filter:brightness(1.06);}'
    + '.zfc-k:active{transform:translateY(3px);box-shadow:0 0 0 var(--zfc-btn-shadow),0 1px 3px rgba(0,0,0,.2),inset 0 1px 3px rgba(0,0,0,.15);}'
    + '.zfc-fn{background:linear-gradient(180deg,var(--zfc-fn-a) 0%,var(--zfc-fn-b) 55%,var(--zfc-fn-c) 100%);color:var(--zfc-fn-txt);'
    + '  box-shadow:0 3px 0 var(--zfc-fn-shadow),0 4px 6px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.3);}'
    + '.zfc-sf{font-size:14px;color:#c08a3e;}'
    + 'html[data-theme="light"] .zfc-sf{color:#a06a20;}'
    + '.zfc-eq{background:linear-gradient(180deg,#7c5cff 0%,#6a4ae0 55%,#5a3cc8 100%);color:#fff;font-size:20px;'
    + '  box-shadow:0 3px 0 #3a2490,0 4px 8px rgba(124,92,255,.35),inset 0 1px 0 rgba(255,255,255,.25);grid-row:span 1;}'
    + '.zfc-eq:active{box-shadow:0 0 0 #3a2490,0 1px 3px rgba(0,0,0,.4);transform:translateY(3px);}';

  function ensureStyle() {
    if (document.getElementById('zfc-style')) return;
    var st = document.createElement('style');
    st.id = 'zfc-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function mount(body) {
    if (body.dataset.zfcInner) { buildPad(); render(); return; }
    body.dataset.zfcInner = '1';
    ensureStyle();
    try { state.sci = localStorage.getItem(MODE_KEY) === 'sci'; } catch (e) {}
    body.innerHTML =
      '<div class="zfc-top">' +
        '<span class="zfc-brand">Z F · CALC</span>' +
        '<div class="zfc-tbtns">' +
          '<button id="zfcModeBtn">' + (state.sci ? '科学' : '标准') + '</button>' +
          '<button id="zfcHistToggle">历史</button>' +
        '</div>' +
      '</div>' +
      '<div class="zfc-screen">' +
        '<div id="zfcErr"></div>' +
        '<div id="zfcSub"></div>' +
        '<div id="zfcExpr">0</div>' +
      '</div>' +
      '<div class="zfc-bodywrap">' +
        '<div class="zfc-hist">' +
          '<div class="zfc-hhead"><span>历史记录（点击可复用）</span><button id="zfcHistClear">清空</button></div>' +
          '<div id="zfcHistList"></div>' +
          '<div id="zfcHistEmpty">暂无历史记录</div>' +
        '</div>' +
        '<div id="zfcPad"></div>' +
      '</div>';
    loadHist();
    bind();
    buildPad();
    render();
  }

  /* ---------- 对外 API（dock 调用） ---------- */
  window.ZFCalc = {
    onOpen: function (body) { mount(body); },
    onClose: function () { saveHist(); },
    calc: function (expr) {
      try {
        var r = fmt(safeEval(expr));
        state.hist.unshift({ e: expr, r: r }); saveHist(); render();
        return { ok: true, result: r };
      } catch (e) { return { ok: false, err: e.message }; }
    },
    clearHistory: function () { state.hist = []; saveHist(); render(); }
  };
})();
