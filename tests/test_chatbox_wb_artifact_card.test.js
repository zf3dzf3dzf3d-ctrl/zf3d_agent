// ==== chatbox-wb-open.js 生成物卡片回归测试（Node 直跑，最小 DOM 桩 + innerHTML 解析）====
// 用法: node tests/test_chatbox_wb_artifact_card.test.js  → 六场景全 PASS 输出 ALL PASS
// 生成物卡片行为级验证：跑真实模块源码（最小 DOM 桩，含 innerHTML 简易解析）
'use strict';
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'chatbox-wb-open.js'), 'utf-8');

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
window.ZFWbOpen = null;
(new Function(src))();
if (!window.ZFWbOpen) { console.log('FATAL: 模块未导出'); process.exit(1); }

// ---- 消息构造：md + html 完整页 + html 片段 + 无语言长文本 ----
const longTxt = '这是一段没有语言标注的纯文本。'.repeat(60);
const BT = '```';
const rawText = [
  '前言。', '',
  BT + 'md', '# 项目周报', '', '正文 **加粗**。', BT, '',
  BT + 'html', '<!doctype html>', '<html><head><title>贪吃蛇小游戏</title></head><body><h1>t</h1></body></html>', BT, '',
  BT + 'html', '<div>片段内容</div>', BT, '',
  BT, longTxt, BT, '',
].join('\n');

const msg = el('div', 'msg ai-msg md-body');
function addFence(codeText, langCls) {
  const pre = el('pre'); const code = el('code', langCls);
  code._text = codeText;
  pre.appendChild(code);
  const wrap = el('div', 'code-wrap'); wrap.appendChild(pre); msg.appendChild(wrap);
  return wrap;
}
const wrapMd = addFence('# 项目周报\n\n正文 **加粗**。', 'language-md hljs language-markdown');
const wrapHtmlFull = addFence('<!doctype html>\n<html><head><title>贪吃蛇小游戏</title></head><body></body></html>', 'language-html hljs language-xml');
const wrapHtmlFrag = addFence('<div>片段内容</div>', 'language-html hljs language-xml');
const wrapTxt = addFence(longTxt, '');
// 消息挂进聊天框宿主（attachToCode 经 pre.closest 解析宿主聊天框，供工作台同位挂载）
const hostBox = el('div', 'chatbox focused');
hostBox.appendChild(msg);
body.appendChild(hostBox); // 挂入文档树（document 级查询/菜单收起依赖）

// ---- 场景1：四类围栏均注入卡片，名称/类型正确，卡片在代码块上方 ----
window.ZFWbOpen.enhance(msg, rawText);
function cardInfo(wrap) {
  const c = wrap.querySelector('.zf-artifact-card');
  if (!c) return null;
  return {
    ft: c.attrs['data-filetype'],
    name: c.querySelector('.zf-artifact-name')._text,
    sub: c.querySelector('.zf-artifact-sub')._text,
    first: wrap.children[0] === c,
    preSecond: !!(wrap.children[1] && wrap.children[1].tag === 'pre'),
  };
}
const r1 = [cardInfo(wrapMd), cardInfo(wrapHtmlFull), cardInfo(wrapHtmlFrag), cardInfo(wrapTxt)];
console.log('场景1 卡片 =', JSON.stringify(r1));
const pass1 = r1[0] && r1[0].ft === 'md' && r1[0].name === '项目周报.md' && r1[0].sub === '文档 · Markdown'
  && r1[1] && r1[1].ft === 'html' && r1[1].name === '贪吃蛇小游戏.html' && r1[1].sub === '网站 · HTML'
  && r1[2] && r1[2].ft === 'html' && r1[2].name === '网页.html' && r1[2].sub === '网页片段 · HTML'
  && r1[3] && r1[3].ft === 'txt' && r1[3].name === '文本.txt' && r1[3].sub === '文本 · 纯文本'
  && r1.every(r => r && r.first && r.preSecond);

// ---- 场景2：md 卡「打开」→ 落盘对话导出 + 工作台打开（抽屉懒构建重试路径 + 宿主聊天框对齐）----
let viewerOpens = [], built = false, saveCalls = [];
let wbOpenBox = 'unset';
window.__KiteNS = {
  workbenchActiveNode: null,
  workbench: { open(box) { wbOpenBox = box; built = true; } },
};
window.WBFileViewer = { open(p, name, box) { viewerOpens.push({ p: p, box: box }); return built; } };
// 镜像真实服务端：/api/fs/text-save 返回【绝对 realpath】（Windows 反斜杠），落盘在 /public/ 下
// /api/fs/text 用虚拟文件系统：渲染期 ensureSaved 走 GET 探测（404→POST 创建，已存在不覆盖）
const ABS_ROOT = 'E:' + String.fromCharCode(92) + 'proj' + String.fromCharCode(92) + 'public' + String.fromCharCode(92);
const vfs = {};
global.fetch = (url, opts) => {
  if (url.indexOf('/api/fs/text?path=') === 0) {
    const p = decodeURIComponent(url.split('path=')[1]);
    const exists = Object.prototype.hasOwnProperty.call(vfs, p);
    return Promise.resolve({ ok: exists, json: async () => exists ? ({ ok: true, path: p, text: vfs[p] }) : ({ ok: false, error: 'not found' }) });
  }
  const b = JSON.parse(opts.body);
  saveCalls.push(b.path);
  vfs[b.path] = b.text;
  const abs = ABS_ROOT + b.path.slice('public/'.length).split('/').join(String.fromCharCode(92));
  return Promise.resolve({ ok: true, json: async () => ({ ok: true, path: abs }) });
};
const cardMd = wrapMd.querySelector('.zf-artifact-card');
cardMd.querySelector('.zf-artifact-openbtn').click();
setTimeout(() => {
  const mdSaved = saveCalls.some(p => /^public\/canvas\/文档\/对话导出\/chat-[0-9a-f]{8}\.md$/.test(p));
  const pathVisible = /^public\/canvas\/文档\/对话导出\/chat-[0-9a-f]{8}\.md$/.test(cardMd.getAttribute('title') || '');
  const mdOpened = viewerOpens.some(o => o.p.startsWith('public/canvas/文档/对话导出/'));
  const boxAligned = wbOpenBox === hostBox && window.__KiteNS.workbenchActiveNode === hostBox
    && viewerOpens.length > 0 && viewerOpens[0].box === hostBox;
  const pass2 = mdSaved && mdOpened && boxAligned && pathVisible && newTabs.length === 0;
  console.log('场景2 md打开: saved=' + mdSaved + ' opened=' + mdOpened + ' 宿主对齐=' + boxAligned + ' 路径可见=' + pathVisible + ' newTab=' + newTabs.length);

  // ---- 场景3：html 完整页「打开」→ 沙箱预览弹窗（不落新标签）----
  wrapHtmlFull.querySelector('.zf-artifact-openbtn').click();
  setTimeout(() => {
    const mask = body.querySelector('.zf-wb-preview-mask');
    const frame = mask ? mask.querySelector('iframe') : null;
    const sandboxed = !!(frame && frame.attrs.sandbox === 'allow-scripts');
    const pass3 = !!mask && !!frame && sandboxed && newTabs.length === 0;
    console.log('场景3 html完整页: mask=' + !!mask + ' iframe=' + !!frame + ' sandbox=' + (frame ? frame.attrs.sandbox : 'n/a') + ' newTab=' + newTabs.length);

    // ---- 场景4：html 片段「打开」→ srcdoc 沙箱预览（不落盘）----
    viewerOpens = []; saveCalls = [];
    wrapHtmlFrag.querySelector('.zf-artifact-openbtn').click();
    setTimeout(() => {
      const fragNotSaved = saveCalls.length === 0;
      const masks = body.querySelectorAll('.zf-wb-preview-mask');
      const lastMask = masks[masks.length - 1];
      const f2 = lastMask ? lastMask.querySelector('iframe') : null;
      const srcdocOk = !!(f2 && typeof f2.srcdoc === 'string' && f2.srcdoc.indexOf('片段内容') >= 0);
      const pass4 = fragNotSaved && srcdocOk;
      console.log('场景4 html片段: 不落盘=' + fragNotSaved + ' srcdoc含片段=' + srcdocOk);

      // ---- 场景5：▾ 菜单——html 卡含「编辑源码」+「复制」；md 卡仅「复制」----
      viewerOpens = []; saveCalls = [];
      const cardHtml = wrapHtmlFull.querySelector('.zf-artifact-card');
      const menuHtml = cardHtml.querySelector('.zf-artifact-menu');
      const actsHtml = menuHtml.children.map(b => b.attrs['data-act']);
      const menuMd = cardMd.querySelector('.zf-artifact-menu');
      const actsMd = menuMd.children.map(b => b.attrs['data-act']);
      cardHtml.querySelector('.zf-artifact-more').click();
      const openedOnce = menuHtml.classList.contains('open');
      cardHtml.querySelector('.zf-artifact-more').click();
      const closedAgain = !menuHtml.classList.contains('open');
      const editBtn = menuHtml.children.find(b => b.attrs['data-act'] === 'edit');
      menuHtml._handlers.click({ target: editBtn, stopPropagation() {} });
      global.__copied = 0;
      const copyBtn = menuHtml.children.find(b => b.attrs['data-act'] === 'copy');
      menuHtml._handlers.click({ target: copyBtn, stopPropagation() {} });
      setTimeout(() => {
        // 编辑与打开共用 savedRef：场景3 已把 html 卡落盘到 演示/，此处复用 → 零新副本 + 查看器直开
        const editNoNewSave = saveCalls.length === 0;
        const editOpened = viewerOpens.some(o => o.p.startsWith('public/canvas/演示/'));
        const pass5 = JSON.stringify(actsHtml) === JSON.stringify(['edit', 'copy', 'copypath'])
          && JSON.stringify(actsMd) === JSON.stringify(['copy', 'copypath'])
          && openedOnce && closedAgain && editNoNewSave && editOpened && global.__copied === 1;
        console.log('场景5 菜单: html=' + JSON.stringify(actsHtml) + ' md=' + JSON.stringify(actsMd) + ' 开/合=' + openedOnce + '/' + closedAgain + ' 编辑零新副本=' + editNoNewSave + ' 编辑打开=' + editOpened + ' 复制=' + global.__copied);

        // ---- 场景6：重复 enhance 不产生第二张卡 ----
        window.ZFWbOpen.enhance(msg, rawText);
        const dupCount = msg.querySelectorAll('.zf-artifact-card').length;
        const wrapCount = msg.querySelectorAll('.code-wrap').length;
        const pass6 = dupCount === wrapCount;
        console.log('场景6 去重: 卡片=' + dupCount + ' 围栏=' + wrapCount);

        // ---- 场景7：多次打开复用同一路径（不再另存副本，查看器每次都调起）----
        saveCalls = []; viewerOpens = [];
        cardMd.querySelector('.zf-artifact-openbtn').click();
        setTimeout(() => {
          const againOpened = viewerOpens.length >= 1; // 复用路径直接再调起
          cardMd.querySelector('.zf-artifact-openbtn').click();
          setTimeout(() => {
            const noReSave = saveCalls.length === 0;           // 不新增落盘
            const labelRestored = cardMd.querySelector('.zf-artifact-openbtn')._text === '打开';
            const noDeadLabel = !src.includes("'✓ 已打开'");   // 源码不再有「✓ 已打开」死态赋值
            const pass7 = againOpened && noReSave && labelRestored && noDeadLabel;
            console.log('场景7 多次打开: 再调起=' + againOpened + ' 零新副本=' + noReSave + ' 按钮复位=' + labelRestored + ' 无死态文案=' + noDeadLabel);

            // ---- 场景8：审核报告表格首列文件路径 linkify（点击经 tool-path-link 委托直达工作台）----
            viewerOpens = []; saveCalls = [];
            const repCard = el('details', 'zf-sg-report');
            const repSum = el('summary'); repSum._text = '审核报告（7项核验）';
            repCard.appendChild(repSum);
            const repBody = el('div', 'zf-sg-body');
            repBody.innerHTML = '<table><thead><tr><th>文件</th><th>状态</th><th>行数</th></tr></thead>'
              + '<tbody><tr><td>api/conn.asp</td><td>✏️</td><td>+58 -11</td></tr>'
              + '<tr><td>admin_recharge.asp</td><td>NEW</td><td>+8 -1</td></tr>'
              + '<tr><td>合计</td><td></td><td>+119 -44</td></tr></tbody></table>';
            repCard.appendChild(repBody);
            hostBox.appendChild(repCard);
            const reportTxt = '# 审核报告' + String.fromCharCode(10) + '【① 逐条核验清单】见表格。';
            window.ZFWbOpen.enhanceReport(reportTxt, repCard);
            const body = repCard.querySelector('.zf-sg-body');
            const linked = body.classList.contains('zf-paths-linked');
            const rows = body.querySelectorAll('table tbody tr');
            const cell1 = rows[0] && rows[0].querySelector('td');
            const link1 = cell1 && cell1.querySelector('.tool-path-link');
            const link1Ok = !!(link1 && link1.getAttribute('data-ftpath') === 'api/conn.asp'
              && (link1.getAttribute('title') || '').indexOf('工作台') >= 0);
            const cell3 = rows[2] && rows[2].querySelector('td');
            const skipNonPath = !!(cell3 && !cell3.querySelector('.tool-path-link'));
            const summaryFree = !repSum._handlers.click;   // 摘要原生展开/收起不被劫持
            const noBtn = repCard.querySelectorAll('.zf-wb-open-btn').length === 0;
            const pass8 = linked && rows.length === 3 && link1Ok && skipNonPath && summaryFree && noBtn;
            console.log('场景8 报告路径linkify: 已处理=' + linked + ' 行数=' + rows.length
              + ' 首行路径链接=' + link1Ok + ' 非路径行跳过=' + skipNonPath
              + ' 摘要原生保留=' + summaryFree + ' 无按钮=' + noBtn);

            const all = [pass1, pass2, pass3, pass4, pass5, pass6, pass7, pass8];
            console.log(all.every(Boolean) ? 'ALL PASS' : 'SOME FAIL: ' + JSON.stringify(all));
            process.exit(all.every(Boolean) ? 0 : 1);
          }, 1100);
        }, 300);
      }, 300);
    }, 300);
  }, 300);
}, 300);
