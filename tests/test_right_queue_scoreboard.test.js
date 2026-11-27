// ==== chatbox-right-queue.js 注意力箭头系统·积分榜回归测试（Node 直跑，最小 DOM 桩）====
// 用法: node tests/test_right_queue_scoreboard.test.js → 五场景全 PASS 输出 ALL PASS
// 覆盖（用户 2026-11-23 反馈两点）：
//   ①积分区永远在按钮排上方（含 render 增量刷新 _refreshScore 重建后不挪到按钮下面）
//   ②矩阵模式：任何一轮都没分的对话整行剔除（不再渲染「· — —」占位行）
//   ③矩阵模式：全组无任何真实积分 → 整个积分区不渲染
//   ④简单行模式（无轮次历史）：只列有真实分数的成员，无分不占位
//   ⑤简单行模式：全员无分 → 不渲染
'use strict';
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'chatbox-right-queue.js'), 'utf-8');

// ---- 最小 DOM 桩（同 test_chatbox_wb_artifact_card 惯例，含 innerHTML 简易解析）----
function matchesOne(node, sel) {
  if (!node || !node.attrs) return false;
  if (sel.startsWith('.')) {
    const need = sel.slice(1).split('.');
    const have = (node.attrs.class || '').split(/\s+/);
    return need.every(n => have.includes(n));
  }
  const tagM = sel.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (tagM && node.tag !== tagM[1]) return false;
  return !!tagM;
}
function matches(node, sel) {
  if (!node || !node.attrs) return false;
  return sel.split(',').some(s => matchesOne(node, s.trim()));
}
function findIn(list, sel, deep) {
  const out = [];
  for (const ch of list) {
    if (matches(ch, sel)) out.push(ch);
    if (deep && ch.children) out.push(...findIn(ch.children, sel, deep));
  }
  return out;
}
function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) attrs[m[1]] = m[2];
  return attrs;
}
function el(tag, cls) {
  const e = {
    tag, children: [], parentElement: null, attrs: cls ? { class: cls } : {},
    _text: '', _html: '', _handlers: {}, style: {}, value: '',
    classList: {
      _s: new Set(cls ? cls.split(/\s+/) : []),
      _sync() { e.attrs.class = [...this._s].filter(Boolean).join(' '); },
      forEach(cb) { [...this._s].forEach(cb); },
      add(c) { this._s.add(c); this._sync(); },
      remove(c) { this._s.delete(c); this._sync(); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(ch) { ch.parentElement = e; e.children.push(ch); return ch; },
    insertBefore(ch, ref) {
      ch.parentElement = e;
      const i = ref ? e.children.indexOf(ref) : -1;
      if (i < 0) e.children.push(ch); else e.children.splice(i, 0, ch);
      return ch;
    },
    removeChild(ch) { const i = e.children.indexOf(ch); if (i >= 0) e.children.splice(i, 1); },
    remove() { if (e.parentElement) e.parentElement.removeChild(e); },
    querySelector(sel) { return findIn(e.children, sel, true)[0] || null; },
    querySelectorAll(sel) { return findIn(e.children, sel, true); },
    addEventListener(t, fn) { e._handlers[t] = fn; },
    setAttribute(k, v) { e.attrs[k] = v; },
    getAttribute(k) { return e.attrs[k] != null ? e.attrs[k] : null; },
  };
  e.style.setProperty = function (k, v) { this[k] = v; };
  Object.defineProperty(e, 'className', {
    get() { return e.attrs.class || ''; },
    set(v) { e.attrs.class = String(v); e.classList._s = new Set(String(v).split(/\s+/)); },
  });
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html; },
    set(v) {
      e._html = String(v);
      const frag = parseHtml(String(v));
      e.children = frag.children;
      e.children.forEach(ch => { ch.parentElement = e; });
    },
  });
  Object.defineProperty(e, 'isConnected', {
    get() {
      let n = e;
      while (n) { if (global.document && n === global.document.body) return true; n = n.parentElement; }
      return false;
    },
  });
  return e;
}
function parseHtml(html) {
  const root = el('#frag');
  const stack = [root];
  const re = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)?(\/)?>/g;
  let m, prev = 0;
  while ((m = re.exec(html)) !== null) {
    if (m.index > prev) stack[stack.length - 1]._text += html.slice(prev, m.index);
    const closing = !!m[1], tag = m[2], attrsRaw = m[3] || '', selfClose = !!m[4];
    if (closing) { if (stack.length > 1) stack.pop(); }
    else {
      const node = el(tag, '');
      Object.assign(node.attrs, parseAttrs(attrsRaw));
      if (node.attrs.class) node.classList._s = new Set(node.attrs.class.split(/\s+/));
      stack[stack.length - 1].appendChild(node);
      if (!selfClose) stack.push(node);
    }
    prev = re.lastIndex;
  }
  if (prev < html.length) stack[stack.length - 1]._text += html.slice(prev);
  return root;
}
const body = el('body');
global.document = {
  getElementById: () => null,
  createElement: (t) => el(t),
  createTextNode: (t) => ({ tag: '#text', attrs: {}, children: [], _text: String(t), parentElement: null }),
  addEventListener: () => {},
  querySelectorAll: (sel) => findIn(body.children, sel, true),
  head: el('head'), body,
};
global.window = global;

// ---- localStorage 桩 + 种子数据（模块加载时读取）----
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
store['zf_right_queue_items'] = JSON.stringify([
  { srcId: 'src-1', title: '主对话', stage: 'ready', ts: 1, notified: false,
    members: [{ name: '审核员·审核', id: 'c1', score: 82 }, { name: '', id: 'c2', score: null }] },
  { srcId: 'src-2', title: '主对话', stage: 'ready', ts: 2, notified: false,
    members: [{ name: '策划师', id: 'c3', score: null }] },
  { srcId: 'src-3', title: '主对话', stage: 'ready', ts: 3, notified: false,
    members: [{ name: '审核员·审核', id: 'c5', score: 90 }, { name: '策划师', id: 'c6', score: null }] },
  { srcId: 'src-4', title: '主对话', stage: 'ready', ts: 4, notified: false,
    members: [{ name: '策划师', id: 'c7', score: null }] },
]);
store['zf_rq_score_history'] = JSON.stringify({
  'src-1': [
    { round: 1, ts: 11, members: [{ name: '审核员·审核', id: 'c1', score: 88 }] },
    { round: 2, ts: 12, members: [{ name: '审核员·审核', id: 'c1', score: 82 }] },
  ],
  'src-2': [
    { round: 1, ts: 21, members: [{ name: '策划师', id: 'c3', score: null }] },
  ],
});
window.App = { chatBoxes: [{ id: 'src-1' }, { id: 'src-2' }, { id: 'src-3' }, { id: 'src-4' }] };

(new Function(src))();
const RQ = window.ZFRightQueue;
if (!RQ) { console.log('FATAL: 模块未导出'); process.exit(1); }

function flatText(n) {
  let s = typeof n._text === 'string' ? n._text : '';
  (n.children || []).forEach(ch => { s += flatText(ch); });
  return s;
}
function idxOf(card, cls) {
  return card.children.findIndex(c => c.classList && c.classList.contains(cls));
}
function itemBySrc(id) { return RQ.items().find(x => String(x.srcId) === id); }

// ---- 场景①：积分区在按钮排上方；增量刷新（_refreshScore）后仍在上方且卡片不重建 ----
RQ.render();
const card1 = itemBySrc('src-1')._el;
const iScore = idxOf(card1, 'zf-rq-score'), iAct = idxOf(card1, 'zf-rq-actions');
const passOrderFirst = iScore > -1 && iAct > -1 && iScore < iAct;
card1.__marker = 1; // 标记旧卡片，验证刷新走增量路径（不重建）
RQ.render();
const card1b = itemBySrc('src-1')._el;
const sameEl = card1b === card1 && card1.__marker === 1;
const iScore2 = idxOf(card1b, 'zf-rq-score'), iAct2 = idxOf(card1b, 'zf-rq-actions');
const pass1 = passOrderFirst && sameEl && iScore2 > -1 && iScore2 < iAct2;
console.log('场景1 积分区位置: 首建=' + passOrderFirst + '(score@' + iScore + ',actions@' + iAct + ') 刷新后同卡=' + sameEl + ' 仍在上方=' + (iScore2 < iAct2) + '(score@' + iScore2 + ',actions@' + iAct2 + ')');

// ---- 场景②：矩阵模式剔除无分行（「· — —」占位行不再渲染，有分行保留）----
const grid = card1b.querySelector('.zf-rq-score-grid');
const blankCells = grid ? findIn(grid.children, '.zfg-blank', true) : [];
const cells = grid ? findIn(grid.children, '.zfg-c', true) : [];
const dashCells = cells.filter(c => flatText(c).trim() === '—');
const has88 = cells.some(c => flatText(c).indexOf('88') === 0);
const has82Down6 = cells.some(c => flatText(c).indexOf('82') === 0 && flatText(c).indexOf('↓6') > 0);
const headerCount = grid ? findIn(grid.children, '.zfg-h', true).length : 0;
const pass2 = !!grid && blankCells.length === 0 && dashCells.length === 0 && has88 && has82Down6
  && headerCount === 3 && grid.children.length === 6; /* 表头3格 + 1成员行×3格 */
console.log('场景2 无分行剔除: grid=' + !!grid + ' 占位行=' + blankCells.length + ' 无分「—」格=' + dashCells.length + ' 88保留=' + has88 + ' 82↓6保留=' + has82Down6 + ' 表头=' + headerCount + ' 总格数=' + (grid ? grid.children.length : 0));

// ---- 场景③：矩阵模式全组无分 → 整个积分区不渲染 ----
const card2 = itemBySrc('src-2')._el;
const pass3 = idxOf(card2, 'zf-rq-score') === -1 && idxOf(card2, 'zf-rq-members') === -1;
console.log('场景3 全无分不渲染: score区=' + idxOf(card2, 'zf-rq-score') + ' members区=' + idxOf(card2, 'zf-rq-members'));

// ---- 场景④：简单行模式只列有分成员（无分成员不占位）----
const card3 = itemBySrc('src-3')._el;
const mem3 = card3.querySelector('.zf-rq-members');
const rows3 = mem3 ? mem3.querySelectorAll('.zf-rq-mem') : [];
const pass4 = !!mem3 && rows3.length === 1 && flatText(rows3[0]).indexOf('90 分') >= 0;
console.log('场景4 简单行过滤: 区块=' + !!mem3 + ' 行数=' + rows3.length + ' 内容=' + (rows3[0] ? flatText(rows3[0]) : ''));

// ---- 场景⑤：简单行模式全员无分 → 不渲染 ----
const card4 = itemBySrc('src-4')._el;
const pass5 = !card4.querySelector('.zf-rq-members') && !card4.querySelector('.zf-rq-score');
console.log('场景5 全无分不渲染: members区=' + !!card4.querySelector('.zf-rq-members') + ' score区=' + !!card4.querySelector('.zf-rq-score'));

const all = [pass1, pass2, pass3, pass4, pass5];
console.log(all.every(Boolean) ? 'ALL PASS' : 'SOME FAIL: ' + JSON.stringify(all));
process.exit(all.every(Boolean) ? 0 : 1);
