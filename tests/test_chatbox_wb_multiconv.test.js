// ==== 多对话端到端回归（Node 直跑真实 viewer + 真实卡片模块 + 最小 DOM 桩）====
// 验证：两个对话（聊天框）各自打开卡片文件 → 内容进各自抽屉、状态按对话隔离、切回恢复。
'use strict';
const fs = require('fs');
const cardSrc = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'chatbox-wb-open.js'), 'utf-8');
const viewerSrc = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'app-workbench-viewer.js'), 'utf-8');

// ---- 最小 DOM 桩 ----
function matchesOne(node, sel) {
  if (!node || !node.attrs) return false;
  const attrs = [];
  const attrRe = /\[([a-zA-Z_-]+)(?:="([^"]*)")?\]/g;
  const stripped = sel.replace(attrRe, (m0, k, v) => { attrs.push([k, v]); return ''; });
  if (stripped.startsWith('.')) {
    const need = stripped.slice(1).split('.').filter(Boolean);
    const have = (node.attrs.class || '').split(/\s+/);
    if (!need.every(n => have.includes(n))) return false;
  } else if (stripped) {
    const tagM = stripped.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (tagM && node.tag !== tagM[1]) return false;
    if (!tagM) return false;
  }
  for (const kv of attrs) {
    if (node.attrs[kv[0]] == null) return false;
    if (kv[1] !== undefined && node.attrs[kv[0]] !== kv[1]) return false;
  }
  return true;
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
    _text: '', _html: '', _handlers: {}, style: {}, value: '', srcdoc: undefined,
    dataset: {},
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
    querySelector(sel) { return findIn(e.children, sel, true)[0] || null; },
    querySelectorAll(sel) {
      const parts = sel.trim().split(/\s+/);
      if (parts.length === 1) return findIn(e.children, sel, true);
      // 通用后代链：node 命中末段，祖先自下而上依次命中前序各段
      const chain = (node) => {
        if (!matches(node, parts[parts.length - 1])) return false;
        let cur = node.parentElement, i = parts.length - 2;
        while (i >= 0) {
          while (cur && !matches(cur, parts[i])) cur = cur.parentElement;
          if (!cur) return false;
          cur = cur.parentElement; i--;
        }
        return true;
      };
      const out = [];
      (function dig(list) { for (const ch of list) { if (chain(ch)) out.push(ch); if (ch.children) dig(ch.children); } })(e.children);
      return out;
    },
    addEventListener(t, fn) { e._handlers[t] = fn; },
    setAttribute(k, v) { e.attrs[k] = v; },
    getAttribute(k) { return e.attrs[k] != null ? e.attrs[k] : null; },
    closest(sel) { let n = e; while (n) { if (matches(n, sel)) return n; n = n.parentElement; } return null; },
    click() { const h = e._handlers.click; if (h) h({ stopPropagation() {}, preventDefault() {}, target: e }); },
  };
  Object.defineProperty(e, 'className', {
    get() { return e.attrs.class || ''; },
    set(v) { e.attrs.class = String(v); e.classList._s = new Set(String(v).split(/\s+/)); },
  });
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); e._html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } });
  Object.defineProperty(e, 'childNodes', { get() { return e.children; } });
  e.remove = () => { if (e.parentElement) e.parentElement.removeChild(e); };
  Object.defineProperty(e, 'firstChild', { get() { return e.children[0] || null; } });
  Object.defineProperty(e, 'lastChild', { get() { return e.children[e.children.length - 1] || null; } });
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html; },
    set(v) {
      e._html = String(v);
      const frag = parseHtml(String(v));
      e.children = frag.children;
      e.children.forEach(ch => { ch.parentElement = e; });
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
const head = el('head');
const body = el('body');
global.document = {
  getElementById: () => null,
  createElement: (t) => el(t),
  addEventListener: () => {},
  execCommand: () => true,
  querySelector: (sel) => findIn(body.children, sel, true)[0] || null,
  querySelectorAll: (sel) => findIn(body.children, sel, true),
  head, body,
};
global.window = global;
global.__copied = 0;
if (!global.navigator) global.navigator = {};
if (!global.navigator.clipboard) {
  Object.defineProperty(global.navigator, 'clipboard', {
    value: { writeText: () => { global.__copied += 1; return Promise.resolve(); } },
    configurable: true,
  });
}
const newTabs = [];
window.open = (u) => { newTabs.push(u); };
global.setTimeout = setTimeout;

// ---- 两个对话（聊天框），先加载真实 viewer 再加载真实卡片模块 ----
window.Tools = { currentChatId: 'convA' };
(new Function(viewerSrc))();          // 真实 WBFileViewer（单例状态按对话隔离）
if (!window.WBFileViewer) { console.log('FATAL: viewer 未导出'); process.exit(1); }

let saveCalls = [];
// 镜像真实服务端：/api/fs/text-save 返回【绝对 realpath】（Windows 反斜杠），落盘在 /public/ 下
const ABS_ROOT = 'E:' + String.fromCharCode(92) + 'proj' + String.fromCharCode(92) + 'public' + String.fromCharCode(92);
global.fetch = (url, opts) => {
  if (url.indexOf('/api/fs/text-save') === 0) {
    const b = JSON.parse(opts.body);
    saveCalls.push(b.path);
    const abs = ABS_ROOT + b.path.slice('public/'.length).split('/').join(String.fromCharCode(92));
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, path: abs }) });
  }
  if (url.indexOf('/api/fs/text?path=') === 0) {
    const p = decodeURIComponent(url.split('path=')[1]);
    const tag = p.indexOf('convA') >= 0 ? '文件甲' : '文件乙';
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, path: p, text: '# ' + tag }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({ ok: false }) });
};

// 抽屉懒构建桩：模拟 buildDrawer 把抽屉挂进宿主聊天框
function makeDrawer() {
  const d = el('div', 'wb-drawer');
  const tabsBar = el('div', 'wb-drawer-tabs');
  const filesBtn = el('button', 'wb-tab');
  filesBtn.attrs['data-wbtab'] = 'files';
  tabsBar.appendChild(filesBtn);
  const bodyDiv = el('div', 'wb-drawer-body');
  const pane = el('div', 'wb-workbench');
  pane.attrs['data-wbwork'] = 'files';
  bodyDiv.appendChild(pane);
  d.appendChild(tabsBar);
  d.appendChild(bodyDiv);
  return d;
}
window.__KiteNS = {
  workbenchActiveNode: null,
  workbench: { open(box) {
    const had = !!(box && box.querySelector('.wb-drawer'));
    if (box && !had) box.appendChild(makeDrawer());
  } },
};

(new Function(cardSrc))();
if (!window.ZFWbOpen) { console.log('FATAL: 卡片模块未导出'); process.exit(1); }
// 探针：包装真实 viewer.open 记录每次调用的宿主
const _realOpen = window.WBFileViewer.open.bind(window.WBFileViewer);
window.WBFileViewer.open = function (p, n, b) {
  return _realOpen(p, n, b);
};

function makeChatBox(id) {
  const box = el('div', 'chatbox focused');
  box.attrs['data-cid'] = id;
  const msg = el('div', 'msg ai-msg md-body');
  const BT = '```';
  const raw = BT + 'md\n# 对话' + (id === 'convA' ? '甲' : '乙') + '的文档\n\n正文。\n' + BT;
  const pre = el('pre'); const code = el('code', 'language-md hljs language-markdown');
  code._text = '# 对话' + (id === 'convA' ? '甲' : '乙') + '的文档\n\n正文。';
  pre.appendChild(code);
  const wrap = el('div', 'code-wrap'); wrap.appendChild(pre); msg.appendChild(wrap);
  box.appendChild(msg);
  body.appendChild(box);
  return { box, msg, wrap, raw };
}
const A = makeChatBox('convA');
const B = makeChatBox('convB');

window.ZFWbOpen.enhance(A.msg, A.raw);
window.ZFWbOpen.enhance(B.msg, B.raw);

function paneOf(box) {
  const d = box.querySelector('.wb-drawer');
  return d ? d.querySelector('.wb-workbench') : null;
}
function tabNames(box) {
  const p = paneOf(box);
  if (!p) return null;
  return p.querySelectorAll('.wfv-tab').map(t => {
    const n = t.querySelector('.wfv-tab-name');
    return n ? n._text : '?';
  });
}

// ---- 步骤1：对话甲点卡片打开 → 甲抽屉出现标签，乙为空 ----
window.Tools.currentChatId = 'convA';
A.wrap.querySelector('.zf-artifact-openbtn').click();
setTimeout(() => {
  const namesA = tabNames(A.box);
  const namesB = tabNames(B.box);
  const s1 = Array.isArray(namesA) && namesA.length === 1 && (namesB === null || namesB.length === 0); // 乙未点开时无抽屉=null 属正确
  console.log('步骤1 甲打开: 甲抽屉标签=' + JSON.stringify(namesA) + ' 乙抽屉标签=' + JSON.stringify(namesB));

  // ---- 步骤2：切到对话乙打开 → 乙抽屉出现自己的标签，甲不受污染 ----
  window.Tools.currentChatId = 'convB';
  B.wrap.querySelector('.zf-artifact-openbtn').click();
  setTimeout(() => {
    const namesA2 = tabNames(A.box);
    const namesB2 = tabNames(B.box);
    const bOnlyOwn = namesB2 && namesB2.length === 1 && namesB2[0].indexOf('.md') >= 0;
    const aUntouched = namesA2 && namesA2.length === 1;
    const s2 = bOnlyOwn && aUntouched;
    console.log('步骤2 乙打开: 甲=' + JSON.stringify(namesA2) + ' 乙=' + JSON.stringify(namesB2) + ' 乙含自己文件=' + bOnlyOwn + ' 甲未污染=' + aUntouched);

    // ---- 步骤3：切回对话甲，再点甲卡片（复用路径）→ 甲内容恢复刷新，乙不受影响 ----
    window.Tools.currentChatId = 'convA';
    const saveBefore = saveCalls.length;
    A.wrap.querySelector('.zf-artifact-openbtn').click();
    setTimeout(() => {
      const namesA3 = tabNames(A.box);
      const namesB3 = tabNames(B.box);
      const aRestored = namesA3 && namesA3.length === 1 && namesA3[0].indexOf('.md') >= 0;
      const bStill = namesB3 && namesB3.length === 1;
      const noNewSave = saveCalls.length === saveBefore;   // 复用路径不再另存
      const s3 = aRestored && bStill && noNewSave;
      console.log('步骤3 切回甲: 甲=' + JSON.stringify(namesA3) + ' 乙=' + JSON.stringify(namesB3) + ' 零新副本=' + noNewSave);

      // ---- 步骤4：乙再点自己的卡片 → 乙抽屉内容刷新且不含甲的标签 ----
      window.Tools.currentChatId = 'convB';
      B.wrap.querySelector('.zf-artifact-openbtn').click();
      setTimeout(() => {
        const namesB4 = tabNames(B.box);
        const namesA4 = tabNames(A.box);
        const b4ok = namesB4 && namesB4.length === 1;
        const a4ok = namesA4 && namesA4.length === 1;
        const all = [s1, s2, s3, b4ok, a4ok];
        console.log('步骤4 乙复开: 乙=' + JSON.stringify(namesB4) + ' 甲=' + JSON.stringify(namesA4));
        console.log(all.every(Boolean) ? 'MULTI-CONV ALL PASS' : 'SOME FAIL: ' + JSON.stringify(all));
        process.exit(all.every(Boolean) ? 0 : 1);
      }, 500);
    }, 500);
  }, 500);
}, 500);
