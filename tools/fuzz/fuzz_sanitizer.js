// fuzz_sanitizer.js —— M2.4 消毒器模糊测试（策划案 M2.4）
//
// 对 md-render.js 的六条净化入口做变异输入轰炸：随机/变异的攻击载荷 × 全部运行模式，
// 判定标准与 tests/test_md_render_security.test.js 的 judge() 一致（按浏览器实际解析的
// DOM 找问题：事件处理器/禁用标签/脚本 URL/iframe 沙箱），另加"入口永不抛异常"。
//
// 用法：
//   ZF_JSDOM_DIR=<含 node_modules/jsdom 的目录> node tools/fuzz/fuzz_sanitizer.js [次数]
//   默认 100000 次。固定随机种子，结果可复现。
//
// 退出码：0 = 无崩溃无泄漏；1 = 发现问题（首轮问题会带变异样本打印）。

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');   // tools/fuzz/ 上溯两级 = 项目根
var N = parseInt(process.argv[2] || '10000', 10) || 10000;
var SEED = parseInt(process.argv[3] || '20261124', 10) || 20261124;

function findJsdom() {
    var cands = [];
    if (process.env.ZF_JSDOM_DIR) cands.push(path.join(process.env.ZF_JSDOM_DIR, 'node_modules', 'jsdom'));
    cands.push('jsdom');
    for (var i = 0; i < cands.length; i++) {
        try { var m = require(cands[i]); if (m && m.JSDOM) return m.JSDOM; } catch (e) {}
    }
    return null;
}

var JSDOM = findJsdom();
if (!JSDOM) {
    console.error('[SKIP] 未找到 jsdom：ZF_JSDOM_DIR=<目录> node tools/fuzz/fuzz_sanitizer.js');
    process.exit(2);
}

var markedSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'marked.min.js'), 'utf8');
var purifySrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'purify.min.js'), 'utf8');
var mdSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'md-render.js'), 'utf8');

function load(opts) {
    var dom = new JSDOM('<!doctype html><html><head></head><body></body></html>',
        { runScripts: 'outside-only', url: 'http://127.0.0.1:8620/index.html' });
    var w = dom.window;
    w.eval(markedSrc);
    if (!opts.marked) w.eval('window.marked = undefined;');
    if (opts.purify) w.eval(purifySrc);
    w.eval(mdSrc);
    return w;
}

// 与安全测试一致的判定器：按浏览器解析出的 DOM 找问题（不对输出跑正则）
var FORBID = ['script', 'form', 'input', 'button', 'select', 'option', 'label', 'textarea',
    'object', 'embed', 'svg', 'math', 'base', 'meta', 'link', 'style', 'frame', 'frameset'];
function judge(w, html) {
    var doc = new w.DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    var issues = [];
    Array.prototype.forEach.call(doc.querySelectorAll('*'), function (el) {
        var tag = el.tagName.toLowerCase();
        Array.prototype.forEach.call(el.attributes, function (a) {
            var n = a.name.toLowerCase(), v = String(a.value);
            if (n.indexOf('on') === 0 && n.length > 2) issues.push('event-handler:' + tag + '.' + n);
            if (n === 'style') issues.push('style-attr:' + tag);
            if (n === 'srcdoc') issues.push('srcdoc:' + tag);
            if (/^(href|src|data|background|poster)$/.test(n) &&
                /^\s*(javascript|vbscript):/i.test(v.replace(/[\t\n\r]/g, ''))) issues.push('script-url:' + tag);
        });
        if (FORBID.indexOf(tag) >= 0) issues.push('forbidden-tag:' + tag);
        if (tag === 'iframe') {
            var sb = el.getAttribute('sandbox') || '';
            if (!/\ballow-scripts\b/.test(sb) || /\ballow-same-origin\b/.test(sb)) issues.push('iframe-sandbox');
        }
    });
    return issues;
}

// 固定种子可复现（mulberry32）
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 种子语料：与安全测试同一批攻击载荷 + 正常文本
var SEEDS = [
    '<span/onpointerover="alert(1)">hover</span>',
    '<img/src=x/onerror="alert(1)">',
    '<<img src=x onerror=alert(1)>',
    '<a href="java&#x09;script:alert(1)">click</a>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<svg><script>alert(1)</script></svg>',
    '<math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    '<style><style/><img src=x onerror=alert(1)>',
    '<xmp><p title="</xmp><img src=x onerror=alert(1)>">',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '任务进度如下。<script><img/src="x"/onerror="alert(1)">',
    '说明文字 <script><a href="javascript:alert(1)">点我</a>',
    '" onclick=<script><iframe srcdoc=](',
    '<table background="javascript:alert(1)">',
    '<form action="/api/x"><input name="pw" type="password"></form>',
    '<div style="position:fixed;width:100vw;height:100vh;z-index:2147483647">覆盖</div>',
    '正常文本，没有标签。',
    '|cmd| 测试\n```\ncode\n```',
];
var ALPHA = '<>/="\'&#;:(){}[]!-\t\n\r abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789onercifjavurl\\x';

function mutate(rng, s) {
    var a = s.split('');
    var ops = rng() < 0.3 ? 1 : (rng() < 0.6 ? 2 : 4);
    for (var i = 0; i < ops; i++) {
        var r = rng();
        var pos = Math.floor(rng() * (a.length + 1));
        if (r < 0.3) a.splice(pos, 0, ALPHA[Math.floor(rng() * ALPHA.length)]);
        else if (r < 0.55 && a.length > 1) a.splice(pos, 1);
        else if (r < 0.75 && a.length > 1) {
            var p2 = Math.floor(rng() * a.length);
            var tmp = a[pos % a.length]; a[pos % a.length] = a[p2]; a[p2] = tmp;
        } else if (r < 0.9 && a.length > pos) {
            a.splice(pos, 0, a[pos % a.length]);   // 重复片段（吃解析器状态机）
        } else {
            a = a.concat(a.slice(0, Math.floor(rng() * 6)));
        }
    }
    return a.join('');
}

var MODES = [
    { name: 'marked+purify', opts: { marked: true, purify: true } },
    { name: 'marked严格兜底', opts: { marked: true, purify: false } },
    { name: '内置+purify', opts: { marked: false, purify: true } },
    { name: '内置严格兜底', opts: { marked: false, purify: false } },
];
var windows = MODES.map(function (m) { return { name: m.name, opts: m.opts, w: load(m.opts) }; });
var MAIN = windows[0];

var entries = [
    ['render', function (w, p) { return w.ZFMD.render(p); }],
    ['render富', function (w, p) { return w.ZFMD.render(p, { tags: 'rich', media: true, wrap: 'zfmd' }); }],
    ['inline', function (w, p) { return w.ZFMD.inline(p, {}); }],
    ['inline富', function (w, p) { return w.ZFMD.inline(p, { tags: 'rich' }); }],
    ['sanitizeHtml', function (w, p) { return w.ZFMD.sanitizeHtml(p); }],
    ['sanTag', function (w, p) {
        var out = '';
        (p.match(/<[^>]*>?/g) || []).forEach(function (t) { out += w.ZFMD.sanTag(t, { tags: 'rich' }) + ' '; });
        return out || p;
    }],
];

var rng = mulberry32(SEED);
var throws = 0, leaks = 0, firsts = [];
var t0 = Date.now();
for (var i = 0; i < N; i++) {
    var base = SEEDS[Math.floor(rng() * SEEDS.length)];
    var payload = rng() < 0.25 ? base : mutate(rng, base);
    // 主路径全量跑
    for (var e = 0; e < 2; e++) {
        var name = entries[e][0], fn = entries[e][1], out;
        try { out = fn(MAIN.w, payload); }
        catch (err) {
            throws++;
            if (firsts.length < 5) firsts.push('THROW #' + i + ' ' + name + ': ' + String(err).slice(0, 80) + ' 样本: ' + JSON.stringify(payload).slice(0, 120));
            continue;
        }
        var issues = judge(MAIN.w, String(out));
        if (issues.length) {
            leaks++;
            if (firsts.length < 8) firsts.push('LEAK #' + i + ' ' + name + ': ' + issues.join(',') + ' 样本: ' + JSON.stringify(payload).slice(0, 120) + ' 输出: ' + String(out).slice(0, 120));
        }
    }
    // 其余模式/入口每 1000 个样本轮询一次
    if (i % 1000 === 0) {
        for (var wi = 1; wi < windows.length; wi++) {
            for (var ei = 2; ei < entries.length; ei++) {
                try {
                    var o2 = entries[ei][1](windows[wi].w, payload);
                    var is2 = judge(windows[wi].w, String(o2));
                    if (is2.length && firsts.length < 8) firsts.push('LEAK #' + i + ' ' + windows[wi].name + '/' + entries[ei][0] + ': ' + is2.join(','));
                } catch (err) {
                    throws++;
                    if (firsts.length < 8) firsts.push('THROW #' + i + ' ' + windows[wi].name + '/' + entries[ei][0]);
                }
            }
        }
    }
    // jsdom 的 DOMParser 文档不会被 GC 及时回收（实测 5 万次吃满 4GB 堆）——
    // 每 5000 个样本重建全部窗口并强制 GC，防模糊器自身内存泄漏污染结果
    if (i % 5000 === 4999) {
        windows = MODES.map(function (m) { return { name: m.name, opts: m.opts, w: load(m.opts) }; });
        MAIN = windows[0];
        if (global.gc) global.gc();
    }
    if (i % 20000 === 0 && i > 0) console.log('  …' + i + '（throws=' + throws + ' leaks=' + leaks + '，' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
}

console.log('模糊测试完成: %d 个变异输入（seed=%d）', N, SEED);
console.log('RESULT throws=%d leaks=%d 耗时=%ds', throws, leaks, Math.round((Date.now() - t0) / 1000));
firsts.forEach(function (s) { console.log('  ' + s); });
if (throws || leaks) { console.log('[FAIL] 发现问题'); process.exit(1); }
console.log('[OK] 100%% 变异输入通过（无崩溃、无泄漏）');
