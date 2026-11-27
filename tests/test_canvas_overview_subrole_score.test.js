// ==== app-canvas-overview.js 缩小整理面板回归测试（Node 直跑真实源码 + 最小 DOM 桩）====
// 用法: node tests/test_canvas_overview_subrole_score.test.js → 全部 PASS 输出 ALL PASS
// 覆盖【20261123·用户令】两需求：
//   ①子对话只显角色名：垃圾师（角色卡）/审核员（固定角色表）/总结师/窗头标题清洗四路解析；
//     主对话仍显示用户第一条消息，不受角色收敛影响
//   ②仅子对话含分数 → 标题下方居中大字 .ov-score（真源 ZFChildRel.scoreOf，流式实时刷新，
//     无分数不占位），DECOR_DEPS 豁免隐藏 + 退出总览彻底清理；
//     主对话永不显分数【20261123·用户令】：scoreOf 只解析本窗，主对话正文回显的旧分
//     被兜底正则误抓且不随子窗更新 → 非子窗不建 .ov-score 节点、残留就地移除
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ================= 最小 DOM 桩 ================= */
const REGISTRY = []; // 所有创建过的元素（document 级查询候选池）

function matchTok(el, tok) { /* 单 token：tag / .class / [attr] / .class[attr] */
  tok = String(tok || '').trim();
  const m = tok.match(/^([a-zA-Z][\w-]*?)?((?:\.[\w-]+)*(?:\[[^\]]+\])*)$/);
  if (!m) return false;
  if (m[1] && el.tag !== m[1]) return false;
  const rest = m[2] || '';
  const re = /\.([\w-]+)|\[([^\]]+)\]/g;
  let t;
  while ((t = re.exec(rest))) {
    if (t[1]) { if (!(el.classList && el.classList.contains(t[1]))) return false; }
    else {
      const kv = t[2].split('=');
      const key = kv[0], want = kv.length > 1 ? kv[1].replace(/^["']|["']$/g, '') : undefined;
      let val;
      if (key.indexOf('data-') === 0) {
        const dk = key.slice(5).replace(/-([a-z])/g, (x, c) => c.toUpperCase());
        val = el.dataset ? el.dataset[dk] : undefined;
      } else val = el.attrs ? el.attrs[key] : undefined;
      if (val == null) return false;
      if (want !== undefined && String(val) !== want) return false;
    }
  }
  return true;
}

function flatten(root) {
  const out = [];
  (function walk(el) { (el.children || []).forEach(c => { out.push(c); walk(c); }); })(root);
  return out;
}

/* 支持：逗号列表 / 'A > B' 两段子代链 / ':scope > B' / 单 token 深查（本项目桩内只用这些形态） */
function qsel(root, sel) {
  const res = [];
  const cands = root ? flatten(root) : REGISTRY;
  String(sel).split(',').forEach(p => {
    p = p.trim(); if (!p) return;
    let scope = false;
    if (/^:scope\s*>\s*/.test(p)) { scope = true; p = p.replace(/^:scope\s*>\s*/, ''); }
    const segs = p.split('>').map(s => s.trim()).filter(Boolean);
    cands.forEach(el => {
      if (!matchTok(el, segs[segs.length - 1])) return;
      if (segs.length === 1) { res.push(el); return; }
      const par = el.parentElement;
      if (!par) return;
      if (scope) { if (par === root && matchTok(par, segs[0])) res.push(el); return; }
      if (par && matchTok(par, segs[0])) res.push(el); /* 两段子代链 */
    });
  });
  return res;
}

function mkEl(tag, cls) {
  const e = {
    tag: tag || 'div', children: [], attrs: {}, dataset: {}, _text: '',
    parentElement: null, parentNode: null,
    offsetLeft: 0, offsetTop: 60, offsetWidth: 400, offsetHeight: 40, offsetParent: null,
    innerHTML: '',
    style: {
      setProperty(k, v) { e.style[k] = String(v); },
      removeProperty(k) { delete e.style[k]; },
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 250 }; },
    classList: {
      _s: new Set(cls ? String(cls).split(/\s+/) : []),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) {
        if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (f) this._s.add(c); else this._s.delete(c);
      },
    },
    appendChild(ch) { ch.parentElement = e; ch.parentNode = e; e.children.push(ch); return ch; },
    removeChild(ch) {
      const i = e.children.indexOf(ch);
      if (i >= 0) { e.children.splice(i, 1); ch.parentElement = null; ch.parentNode = null; }
    },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return e.attrs[k] != null ? e.attrs[k] : null; },
    addEventListener() {},
    closest(sel) { let n = e; while (n) { if (matchTok(n, sel)) return n; n = n.parentElement; } return null; },
    querySelector(sel) { return qsel(e, sel)[0] || null; },
    querySelectorAll(sel) { return qsel(e, sel); },
  };
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); } });
  Object.defineProperty(e, 'className', { /* 源码用 el.className='x' 建装饰类，须同步 classList */
    get() { return [...e.classList._s].join(' '); },
    set(v) { e.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  REGISTRY.push(e);
  return e;
}

/* ---------- 桩环境 ---------- */
const CANVAS = mkEl('div', 'canvas-area');
CANVAS.offsetHeight = 2000;
const WIN_HANDLERS = {};
const INTVALS = []; // 捕获 setInterval 回调（总览 1.5s 状态/分数轮询就在这里）
const LS = new Map();

const documentStub = {
  hidden: false,
  body: mkEl('body'),
  head: mkEl('head'),
  createElement(t) { return mkEl(t); },
  getElementById() { return null; },
  addEventListener() {}, removeEventListener() {},
  querySelector(sel) { return qsel(null, sel)[0] || null; },
  querySelectorAll(sel) { return qsel(null, sel); },
};

const sandbox = {
  document: documentStub,
  localStorage: {
    getItem(k) { return LS.has(k) ? LS.get(k) : null; },
    setItem(k, v) { LS.set(k, String(v)); },
    removeItem(k) { LS.delete(k); },
  },
  MutationObserver: function (cb) { this.observe = function () {}; this.disconnect = function () {}; },
  setInterval(fn) { INTVALS.push(fn); return INTVALS.length; },
  clearInterval() {},
  setTimeout() { return 0; },
  clearTimeout() {},
  performance: { now() { return Date.now(); } },
  console,
  addEventListener(t, fn) { (WIN_HANDLERS[t] = WIN_HANDLERS[t] || []).push(fn); },
  removeEventListener() {},
};
sandbox.window = sandbox; // 模块里 window.X 与裸 X 同源

const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chatbox-child-rels.js'), 'utf-8'), ctx, { filename: 'chatbox-child-rels.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-canvas-overview.js'), 'utf-8'), ctx, { filename: 'app-canvas-overview.js' });

/* ---------- 造 7 张卡：A垃圾师 B审核员 C总结师 C2标题清洗 D主对话 E带分数 F无分数 ---------- */
const CHATS = [];
sandbox.App = { chatBoxes: CHATS };

function mkChatBox(id, opts) {
  opts = opts || {};
  const root = mkEl('div', 'chatbox');
  CANVAS.appendChild(root);
  root.offsetParent = CANVAS; // nodes() 可见性过滤
  root.offsetWidth = 400; root.offsetHeight = 500;
  const hdr = mkEl('div', 'chatbox-header');
  root.appendChild(hdr);
  if (opts.title) { const t = mkEl('div', 'title'); t.textContent = opts.title; hdr.appendChild(t); }
  const chat = { id: id, el: root, history: opts.history || [], isSending: false, queue: [] };
  Object.keys(opts.flags || {}).forEach(k => { root[k] = opts.flags[k]; });
  CHATS.push(chat);
  return { root, chat };
}

const A = mkChatBox('a1', { // 垃圾师：首条消息=整段任务提示词（用户截图实锤场景），角色卡兜底
  flags: { _isCustomChat: true, _customSrcId: 'src1' },
  history: [{ role: 'user', content: '【垃圾师任务】你是垃圾师（垃圾识别）：专门挑项目里的垃圾。输出必须包含清单与风险，绝对禁止执行删除。' }],
});
LS.set('zf_role_chat_a1', JSON.stringify({ name: '垃圾师' }));

const B = mkChatBox('b1', { // 审核员：无角色卡，走 ZFChildRel.childKeyOf 固定角色表
  flags: { _isQcChat: true, _qcSrcId: 'src1' },
  history: [{ role: 'user', content: '请评审以下方案' }],
});

const C = mkChatBox('c1', { // 总结师：固定角色表没有，走 summarizer 专列
  flags: { _isSummarizerChat: true, _summarizerSrcId: 'src1' },
  title: '📋 总结 · 会议纪要',
});

const C2 = mkChatBox('c2', { // 故意缺 _qcSrcId → childKeyOf 落空 → 窗头标题清洗（emoji/#序号/·尾缀）
  flags: { _isQcChat: true },
  title: '🛡️ 审核员#3 · 审核',
});

const D = mkChatBox('d1', { // 主对话：非子级，必须显示用户第一条消息原样
  history: [
    { role: 'user', content: '帮我做一个官网首页' },
    { role: 'assistant', content: '各子窗已回笼。综合评分：85分' }, // 正文回显子窗旧分——恰是主对话误显分数的病根
  ],
});

const E = mkChatBox('e1', { // 审核员子对话带真实分数
  flags: { _isQcChat: true, _qcSrcId: 'srcX' },
  history: [
    { role: 'user', content: '请审核' },
    { role: 'assistant', content: '整体完成度不错，问题已列出。审核评分：88分' },
  ],
});

const F = mkChatBox('f1', { // 已回答但无分数
  history: [
    { role: 'user', content: '在吗' },
    { role: 'assistant', content: '好的，已完成' },
  ],
});

const G = mkChatBox('g9', { // 施工队工人：_swarmLabel 必须整名保留（工种不丢，right-queue 同口径）
  flags: { _raceSrcId: 'src1', _swarmLabel: '施工队·瓦工' },
  title: '🐝 施工队·瓦工',
});

const H = mkChatBox('h9', { // 专家团子窗：不在 isSub 口径，靠 _isExpertChat+_swarmLabel 纳入
  flags: { _isExpertChat: true, _expertSrcId: 'src1', _swarmLabel: '专家团·张三' },
  title: '🎓 专家团·张三',
});

/* ---------- 断言工具 ---------- */
let fails = 0;
function assertEq(actual, expected, label) {
  if (actual !== expected) { fails++; console.log('FAIL', label, '| 实际 =', JSON.stringify(actual), '| 期望 =', JSON.stringify(expected)); }
  else console.log('PASS', label);
}
const titleOf = root => { const t = root.querySelector(':scope > .ov-panel-title'); return t ? t.textContent : null; };
const scoreOfEl = root => root.querySelector(':scope > .ov-score');

/* ---------- 进入缩小整理模式 ---------- */
(WIN_HANDLERS['wb-canvas-change'] || []).forEach(fn => fn({ detail: { on: true } }));

/* 场景1：垃圾师子对话只显角色名（角色卡源） */
assertEq(titleOf(A.root), '垃圾师', '场景1 垃圾师卡标题=角色名（不再显示整段提示词）');
assertEq(A.root.dataset.ovRole, '垃圾师', '场景1 dataset.ovRole 标记');

/* 场景2：审核员走固定角色表 */
assertEq(titleOf(B.root), '审核员', '场景2 审核员卡标题=角色名（childKeyOf）');

/* 场景3：总结师专列 */
assertEq(titleOf(C.root), '总结师', '场景3 总结师卡标题=角色名');

/* 场景4：窗头标题清洗（emoji/#序号/·尾缀） */
assertEq(titleOf(C2.root), '审核员', '场景4 窗头标题清洗 → 角色名');

/* 场景4b：施工队工人 _swarmLabel 整名保留（工种不丢） */
assertEq(titleOf(G.root), '施工队·瓦工', '场景4b 施工队·瓦工 整名显示（_swarmLabel 真源）');

/* 场景4c：专家团子窗纳入子窗门槛 */
assertEq(titleOf(H.root), '专家团·张三', '场景4c 专家团·张三 整名显示');

/* 场景5：主对话仍显示首条用户消息，不被角色收敛 */
assertEq(titleOf(D.root), '帮我做一个官网首页', '场景5 主对话标题=首条用户消息');
assertEq('ovRole' in D.root.dataset, false, '场景5 主对话无角色标记');

/* 场景5b：主对话永不显分数【20261123·用户令】正文回显子窗旧分也不建 .ov-score 节点；
   历史版本残留节点经 refreshDecor（decorateOne 主对话分支）就地移除 */
assertEq(scoreOfEl(D.root), null, '场景5b 主对话（含回显分数正文）不建 .ov-score 节点');
const _resid = mkEl('div', 'ov-score'); _resid.textContent = '85'; D.root.appendChild(_resid);
if (sandbox.ZFCanvasOverview && sandbox.ZFCanvasOverview.refreshDecor) sandbox.ZFCanvasOverview.refreshDecor();
assertEq(scoreOfEl(D.root), null, '场景5b 主对话残留 .ov-score 被 decorateOne 就地移除');

/* 场景6：有分数 → .ov-score 大字显示，值取真源 */
const scE = scoreOfEl(E.root);
assertEq(scE ? scE.textContent : null, '88', '场景6 分数=88（ZFChildRel.scoreOf 真源）');
assertEq(scE ? scE.style.display : '', 'block', '场景6 有分数时显式 block（不能用空串=回落CSS默认none）');
assertEq(titleOf(E.root), '审核员', '场景6 分数卡标题仍是角色名');
assertEq(scE ? scE.style.fontSize : '', '96px', '场景6 分数字号随缩放反算（48/0.5）');
assertEq(scE ? scE.style.top : '', '120px', '场景6 分数紧贴标题下沿（60+40+20）');

/* 场景7：无分数 → 不占位；F 无子窗标记=主对话口径 → 干脆不建 .ov-score 节点 */
const scF = scoreOfEl(F.root);
assertEq(scF, null, '场景7 无标记卡（主对话口径）不建 .ov-score 节点');
const scA = scoreOfEl(A.root);
assertEq(scA ? scA.style.display : null, 'none', '场景7 垃圾师卡（未答）分数同样隐藏');

/* 场景8：注入 CSS 豁免链与规则包含 .ov-score（DECOR_DEPS 派生） */
const styleEl = documentStub.head.children.find(n => n.tag === 'style');
assertEq(styleEl ? styleEl.textContent.includes(':not(.ov-score)') : false, true, '场景8 CSS 隐藏豁免链含 .ov-score');
assertEq(styleEl ? styleEl.textContent.includes('.chatbox > .ov-score') : false, true, '场景8 分数样式规则已注入');

/* 场景9：流式实时刷新（history 追加新分数 → 1.5s 轮询后 88 → 92） */
E.chat.history.push({ role: 'assistant', content: '修订后达标。综合评分：92分' });
INTVALS.forEach(fn => fn()); // 触发 applyColors / refreshTitleSizes 轮询
assertEq(scoreOfEl(E.root) ? scoreOfEl(E.root).textContent : null, '92', '场景9 轮询后分数实时更新 88→92');

/* 场景10：退出总览 → 装饰（含分数）彻底移除，不留残留 div */
(WIN_HANDLERS['wb-canvas-change'] || []).forEach(fn => fn({ detail: { on: false } }));
assertEq(scoreOfEl(A.root), null, '场景10 退出后 .ov-score 移除');
assertEq(A.root.querySelector(':scope > .ov-panel-title'), null, '场景10 退出后标题装饰移除');
assertEq('ovSt' in A.root.dataset, false, '场景10 退出后状态标记清除');

if (fails === 0) console.log('ALL PASS');
else { console.log(fails + ' FAILED'); process.exit(1); }
