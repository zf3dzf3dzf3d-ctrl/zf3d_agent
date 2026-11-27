// 【永久回归】markdown 渲染层原生 HTML 净化（2026-11-23）。
// 背景：ZFMD（public/js/md-render.js）此前用正则"过滤"原生 HTML 标签的属性，实测可被绕过：
//     ① 白名单内标签的 style 属性原样放行 → 全屏覆盖层（界面伪装）
//     ② "/" 分隔的事件属性不被剥离（<img/src=x/onerror=…>）
//     ③ 实体混淆的 javascript: 链接不拦
//     ④ marked 行内"原始文本块"状态：段落中间垫一个 <script> 或 <pre> 开标签，其后的非规范
//        标签按原文输出 → 默认聊天路径上的脚本执行，无需任何交互
// 修复：标签白名单 + 属性白名单；主路径 DOMPurify（经 LazyLoader 下发）；未到达时严格兜底
//      （从零重建标签）；walkTokens 转义原始文本块里的裸 "<"。
//
// 用法：node tests/test_md_render_security.test.js        （退出码 0 = PASS）
//   第一层（零依赖）：结构断言——消毒规则、依赖完整性、门禁合规（不往 index.html 加静态脚本标签）。
//   第二层（行为级，需要 jsdom）：在真实 DOM 里把 60 条攻击载荷 × 6 条路径 × 4 种运行状态跑一遍，
//     外加良性内容回归与一轮随机变异。jsdom 用环境变量指定：
//       ZF_JSDOM_DIR=<含 node_modules/jsdom 的目录> node tests/test_md_render_security.test.js
//     没有 jsdom 时第二层会跳过并明示（不是通过）。加 --require-dom 可让"缺 jsdom"直接判失败（供 CI 用）。
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var MD = path.join(ROOT, 'public', 'js', 'md-render.js');
var PURIFY = path.join(ROOT, 'public', 'js', 'purify.min.js');
var REG = path.join(ROOT, 'public', 'js', 'inline-lazy-scripts.js');
var INDEX = path.join(ROOT, 'public', 'index.html');
var CSS = path.join(ROOT, 'public', 'css', 'md-render.css');
var LICENSE = path.join(ROOT, 'public', 'js', 'dompurify.LICENSE.txt');

var ok = 0, fail = 0;
function assert(name, cond, detail) {
    if (cond) { ok++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (detail ? ' | ' + detail : '')); }
}
function sha256(buf) {
    return require('crypto').createHash('sha256').update(buf).digest('hex');
}

var md = fs.readFileSync(MD, 'utf8');

// ======================= 第一层：结构断言（零依赖） =======================
console.log('--- 第一层：结构断言 ---');

assert('消毒器不再用正则"过滤"属性（旧 sanTag 的 on* 黑名单已移除）',
    !/\son\[a-z\]\+\\s\*=/.test(md) && md.indexOf('function fallbackOpenTag') !== -1);
assert('属性白名单 + 显式禁用 style / srcdoc / formaction',
    md.indexOf("FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'action', 'srcset', 'background']") !== -1);
assert('富标签集不再包含表单控件（form/input/button/select/option/label）',
    (function () {
        var m = md.match(/var RICH_TAGS = ([^\n]+);/);
        return !!m && !/\|(form|input|button|select|option|label|textarea)\b/.test(m[1]);
    })());
assert('iframe 强制无同源沙箱：DOMPurify 钩子与严格兜底两处都写死 allow-scripts',
    (md.match(/sandbox', 'allow-scripts'\)/g) || []).length === 1 && md.indexOf('sandbox="allow-scripts"') !== -1
    && !/allow-same-origin/.test(md.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')));
assert('marked 路径的原生 HTML 令牌统一经 ZFMD 净化（不再逐标签跑旧 sanTag）',
    md.indexOf("return Z.sanitizeFragment(raw || '', opts);") !== -1);
assert('walkTokens 钩子：原始文本块里的裸 "<" 被转义（第 ④ 条绕过）',
    md.indexOf("walkTokens: function (token)") !== -1 && md.indexOf("token.text.replace(/</g, '&lt;')") !== -1);
assert('DOMPurify 经项目懒加载通道触发，不自行硬编码进 index.html',
    md.indexOf("global.LazyLoader.load('DOMPurify', function () {});") !== -1);

var purify = fs.readFileSync(PURIFY);
var mVer = String(purify.slice(0, 400).toString('utf8')).match(/DOMPurify (\d+\.\d+\.\d+)/);
assert('purify.min.js 存在且带 3.5.0 许可证头', !!mVer && mVer[1] === '3.5.0', mVer ? mVer[1] : 'no banner');
assert('purify.min.js 与入库时经 npm 官方 SHA-512 校验的构建逐字节一致（防篡改/防误替换）',
    sha256(purify) === 'f69a46022ab1f53e969c8ebbca98172c8995785a9b3be72ea4a12d25b1a1bf67',
    sha256(purify).slice(0, 16));
assert('许可证与来源记录随库文件一并入库', fs.existsSync(LICENSE) && fs.readFileSync(LICENSE, 'utf8').indexOf('Apache License') !== -1);

var reg = fs.readFileSync(REG, 'utf8');
var mReg = reg.match(/DOMPurify:\s*\{\s*file:\s*'purify\.min\.js',\s*v:\s*'([^']+)'/);
assert('懒加载注册表登记了 DOMPurify，且 v 值与库文件版本一致（长缓存靠它失效）',
    !!mReg && mVer && mReg[1] === mVer[1], mReg ? mReg[1] : 'no entry');

var index = fs.readFileSync(INDEX, 'utf8');
assert('index.html 没有为 purify 新增静态 <script src>（遵守"一切皆插件"门禁 R4）',
    !/<script[^>]*\bsrc\s*=\s*["'][^"']*purify/i.test(index));
assert('index.html 仍按原样加载 md-render.js（在其之前已有 lazy-loader 与注册表）',
    (function () {
        var a = index.indexOf('lazy-loader.js'), b = index.indexOf('inline-lazy-scripts.js'), c = index.indexOf('js/md-render.js');
        return a > 0 && b > a && c > b;
    })());
assert('样式表提供 .zfmd-iframe（原生 iframe 不再带内联 style）',
    fs.readFileSync(CSS, 'utf8').indexOf('.zfmd-iframe') !== -1);

// ======================= 第二层：行为级（需要 jsdom） =======================
console.log('\n--- 第二层：行为级（真实 DOM） ---');

function findJsdom() {
    var candidates = [];
    if (process.env.ZF_JSDOM_DIR) candidates.push(path.join(process.env.ZF_JSDOM_DIR, 'node_modules', 'jsdom'));
    candidates.push('jsdom');
    for (var i = 0; i < candidates.length; i++) {
        try {
            var mod = require(candidates[i]);                 // jsdom 导出的是 { JSDOM }，不是构造函数本身
            if (mod && typeof mod.JSDOM === 'function') return mod.JSDOM;
        } catch (e) {}
    }
    return null;
}
var JSDOM = findJsdom();
if (!JSDOM) {
    console.log('[SKIP] 未找到 jsdom，行为级验证未执行（第一层结构断言已全部运行）。');
    console.log('       启用方法：在仓库外任一目录 npm i jsdom，然后');
    console.log('       ZF_JSDOM_DIR=<该目录> node tests/test_md_render_security.test.js');
    if (process.argv.indexOf('--require-dom') !== -1) fail++;
} else {
    (function () {
        var markedSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'marked.min.js'), 'utf8');
        var purifySrc = purify.toString('utf8');

        function load(opts) {
            var dom = new JSDOM('<!doctype html><html><head></head><body></body></html>',
                { runScripts: 'outside-only', url: 'http://127.0.0.1:8620/index.html' });
            var w = dom.window;
            w.eval(markedSrc);
            if (!opts.marked) w.eval('window.marked = undefined;');
            if (opts.purify) w.eval(purifySrc);
            w.eval(md);
            return w;
        }

        // 把输出解析回 DOM，按浏览器实际看到的结构找问题（不对字符串跑正则）
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
                    if (/^(href|src|data|background|poster)$/.test(n) && /^\s*(javascript|vbscript):/i.test(v.replace(/[\t\n\r]/g, '')))
                        issues.push('script-url:' + tag + '.' + n);
                });
                if (FORBID.indexOf(tag) >= 0) issues.push('forbidden-tag:' + tag);
                if (tag === 'iframe') {
                    var sb = el.getAttribute('sandbox') || '';
                    if (!/\ballow-scripts\b/.test(sb) || /\ballow-same-origin\b/.test(sb)) issues.push('iframe-sandbox:' + (sb || '(none)'));
                }
                if (tag === 'a' && (el.getAttribute('target') || '').toLowerCase() === '_blank' &&
                    !/noopener/.test(el.getAttribute('rel') || '')) issues.push('link-without-noopener');
            });
            return issues;
        }

        var ATTACK = [
            '<span/onpointerover="alert(1)">hover me</span>',
            '<span style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647">会话已过期</span>',
            '<img/src=x/onerror="alert(1)">',
            '<img/src="x"/onerror="alert(1)">',
            '<img src="x" alt="a>b" onerror="alert(1)">',
            '<img src=x onerror=alert(1)//>',
            '<<img src=x onerror=alert(1)>',
            '<a href="java&#x09;script:alert(1)">click</a>',
            '<a href="jav&#x09;ascript:alert(1)">click</a>',
            '<a href=" &#14; javascript:alert(1)">click</a>',
            '<a href="&#106;avascript:alert(1)">x</a>',
            '<a href="&#x6A;avascript:alert(1)">x</a>',
            '<a href="java\tscript:alert(1)">x</a>',
            '<a href="jAvAsCrIpT:alert(1)">x</a>',
            '<a href="vbscript:msgbox(1)">x</a>',
            '<a href="data:text/html,<script>alert(1)</script>">x</a>',
            '<a href="https://evil.example" target="_blank">no-rel</a>',
            '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
            '<iframe src="https://evil.example/" sandbox="allow-scripts allow-same-origin"></iframe>',
            '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
            '<form action="/api/x"><input name="pw" type="password"><button>登录</button></form>',
            '<input autofocus onfocus=alert(1)>',
            '<select autofocus onfocus=alert(1)><option>a</option></select>',
            '<textarea autofocus onfocus=alert(1)>',
            '<button formaction="javascript:alert(1)">go</button>',
            '<svg onload="alert(1)"></svg>',
            '<svg><script>alert(1)</script></svg>',
            '<math><mtext><script>alert(1)</script></mtext></math>',
            '<details open ontoggle="alert(1)">x</details>',
            '<video><source onerror="alert(1)"><track src=x onerror=alert(1)></video>',
            '<div style="background:url(javascript:alert(1))">x</div>',
            '<div onpointerenter=alert(1) style="color:red">x</div>',
            '<b style="color:red" onclick="x">bold</b>',
            '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
            '<object data="javascript:alert(1)"></object>',
            '<embed src="javascript:alert(1)">',
            '<style>@import url(https://evil.example/x.css)</style>',
            '<link rel="stylesheet" href="https://evil.example/x.css">',
            '<base href="https://evil.example/">',
            '<meta http-equiv="refresh" content="0;url=https://evil.example">',
            '<table background="javascript:alert(1)"><tr><td background="javascript:alert(1)">x</td></tr></table>',
            '<!-- --><script>alert(1)</script>-->',
            '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
            '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
            '<style><style/><img src=x onerror=alert(1)>',
            '<xmp><p title="</xmp><img src=x onerror=alert(1)>">',
            '<listing><img src=x onerror=alert(1)></listing>',
            '<marquee onstart=alert(1)>x</marquee>',
            '<p id="zfmd-probe" class="a" style="x" data-k="v" title="t">attrs</p>',
            '<td colspan="2" onmouseover="alert(1)">cell</td>',
            '<li value="1" onclick="alert(1)">item</li>',
            // ---- marked 行内"原始文本块"状态（第 ④ 条）----
            '任务进度如下。<script><img/src="x"/onerror="alert(1)">',
            '说明文字 <script><svg onload=alert(1)>',
            '说明文字 <pre><img/src="x"/onerror="alert(1)"></pre>',
            '说明文字 <style><iframe srcdoc="<img src=x onerror=alert(1)>"></style>',
            '说明文字 <textarea><img/src="x"/onerror="alert(1)"></textarea>',
            '" onclick=<script><iframe srcdoc=](',
            '说明文字 <script><a href="javascript:alert(1)">点我</a>',
            '说明文字 <script><span style="position:fixed;top:0;left:0;width:100vw;height:100vh">覆盖</span>',
            '说明文字 <script><form action="/api/x"><input name="pw"></form>'
        ];
        var RICH = { tags: 'rich', media: true, wrap: 'zfmd' };

        var MODES = [
            ['marked + DOMPurify（桌面主路径）', { marked: true, purify: true }],
            ['marked，DOMPurify 未到达（严格兜底）', { marked: true, purify: false }],
            ['内置解析器 + DOMPurify', { marked: false, purify: true }],
            ['内置解析器，严格兜底', { marked: false, purify: false }]
        ];
        MODES.forEach(function (mode) {
            var w = load(mode[1]), leaks = [], throws = 0, firstOut = '';
            var ready = w.ZFMD.purifierReady();
            assert(mode[0] + '：purifierReady 与运行状态一致', ready === mode[1].purify, String(ready));
            ATTACK.forEach(function (p) {
                [
                    ['render 默认', function () { return w.ZFMD.render(p); }],
                    ['render 富', function () { return w.ZFMD.render(p, RICH); }],
                    ['inline 默认', function () { return w.ZFMD.inline(p, {}); }],
                    ['inline 富', function () { return w.ZFMD.inline(p, { tags: 'rich' }); }],
                    ['sanitizeHtml', function () { return w.ZFMD.sanitizeHtml(p); }],
                    ['sanTag 逐标签', function () {
                        var out = '';
                        (p.match(/<[^>]*>?/g) || []).forEach(function (t) { out += w.ZFMD.sanTag(t, RICH) + ' '; });
                        return out;
                    }]
                ].forEach(function (pair) {
                    var out;
                    try { out = pair[1](); } catch (e) { throws++; leaks.push('THROW ' + pair[0] + ' :: ' + e.message); return; }
                    var iss = judge(w, String(out));
                    if (iss.length) { leaks.push(pair[0] + ' ' + p.slice(0, 50) + ' => ' + iss.join(',')); if (!firstOut) firstOut = String(out); }
                });
            });
            assert(mode[0] + '：' + ATTACK.length + ' 条攻击载荷 × 6 条路径全部被化解',
                leaks.length === 0, leaks.slice(0, 3).join(' | ') + (firstOut ? ' :: ' + firstOut.slice(0, 120) : ''));
            assert(mode[0] + '：渲染过程零异常', throws === 0, String(throws));
        });

        // ---- 良性内容回归：默认模式必须原样保留格式；富模式保留结构与安全属性 ----
        var w = load({ marked: true, purify: true });
        function domOf(html) { return new w.DOMParser().parseFromString('<body>' + html + '</body>', 'text/html'); }
        function textOf(html) { return domOf(html).body.textContent.replace(/\s+/g, ' ').trim(); }

        var o = String(w.ZFMD.render('行内 <b>加粗</b>、<span class="k">高亮</span>、<code>x&lt;y</code>、<br>换行、<kbd>Ctrl</kbd>、<em>强调</em>'));
        var d = domOf(o);
        assert('良性默认：白名单内行内标签与 class 原样保留、文字不变',
            d.querySelectorAll('b').length === 1 && d.querySelector('span.k') && d.querySelectorAll('code,kbd,em,br').length === 4
            && textOf(o) === '行内 加粗、高亮、x<y、换行、Ctrl、强调', o);

        o = String(w.ZFMD.render('| 列A | 列B |\n|---|---|\n| 1 | 2 |'));
        d = domOf(o);
        assert('良性默认：markdown 表格、列表、代码块照常渲染',
            d.querySelectorAll('table tr').length === 2 && d.querySelectorAll('th').length === 2
            && domOf(String(w.ZFMD.render('- 一\n- 二'))).querySelectorAll('li').length === 2
            && domOf(String(w.ZFMD.render('```py\nprint("<x>")\n```'))).querySelector('pre code').textContent.indexOf('print("<x>")') === 0, o);

        o = String(w.ZFMD.render('<a href="https://example.com" title="标题">富链接</a>', RICH));
        d = domOf(o);
        assert('良性富：链接保留 href/title，强制 target=_blank + rel 含 noopener',
            d.querySelector('a[title="标题"][href="https://example.com"][target="_blank"][rel~="noopener"]')
            && d.querySelector('a').textContent === '富链接', o);

        o = String(w.ZFMD.render('<iframe src="https://example.com/embed"></iframe>', RICH));
        d = domOf(o);
        assert('良性富：iframe 保留 src，带 allow-scripts 沙箱与 .zfmd-iframe 类',
            d.querySelector('iframe.zfmd-iframe[src="https://example.com/embed"][sandbox="allow-scripts"]'), o);

        o = String(w.ZFMD.render('<table><tr><td colspan="2">合并</td></tr></table>', RICH));
        assert('良性富：原生表格的 colspan 保留（依赖上下文的标签经包裹解析）',
            domOf(o).querySelector('td[colspan="2"]') && domOf(o).querySelector('td').textContent === '合并', o);

        o = String(w.ZFMD.render('<div class="card">\n<p>卡片 <strong>粗</strong></p>\n</div>', RICH));
        assert('良性富：div 块的嵌套结构与 class 保留',
            domOf(o).querySelector('div.card > p > strong') && textOf(o) === '卡片 粗', o);

        // ---- 随机变异（确定性种子）：任何畸形输入都不得漏出危险结构或抛异常 ----
        var seed = 0x5eed1234;
        function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 0x100000000); }
        function pick(a) { return a[Math.floor(rnd() * a.length)]; }
        var FRAG = ['<img', '<a', '<span', '<div', '<iframe', '<svg', '<math', '<form', '<details', '<b', '<p', '<td', '<li', '<pre', '<script', '<style',
            ' src=', ' href=', ' style=', ' onerror=', 'onload=', ' sandbox=', ' srcdoc=', ' title=', ' class=', ' colspan=', ' data-x=',
            '"', "'", '`', '=', '/', ' ', '\t', '\n', '>', '>>', '<', '<<', '//', 'x', 'alert(1)', 'javascript:', 'java&#x09;script:',
            'position:fixed', 'allow-same-origin', 'allow-scripts', '&lt;', '&quot;', '&#x6A;', '&amp;', '</', '/>', '-->', '<!--', '</script>', 'text', '中文', '**粗**', '](', '[x]'];
        var fLeaks = 0, fThrows = 0, fSample = '';
        var fw = load({ marked: true, purify: true });
        for (var i = 0; i < 800; i++) {
            var s = '', n = 3 + Math.floor(rnd() * 14);
            for (var k = 0; k < n; k++) s += pick(FRAG);
            if (rnd() < 0.3) s = s.toUpperCase();
            [['render 默认', function () { return fw.ZFMD.render(s); }],
             ['render 富', function () { return fw.ZFMD.render(s, RICH); }],
             ['inline 默认', function () { return fw.ZFMD.inline(s, {}); }],
             ['inline 富', function () { return fw.ZFMD.inline(s, { tags: 'rich' }); }],
             ['sanitizeHtml', function () { return fw.ZFMD.sanitizeHtml(s); }]].forEach(function (pair) {
                var out;
                try { out = pair[1](); } catch (e) { fThrows++; return; }
                if (typeof out !== 'string') { fThrows++; return; }
                var iss = judge(fw, out);
                if (iss.length) { fLeaks++; if (!fSample) fSample = pair[0] + ' ' + JSON.stringify(s) + ' => ' + iss.join(','); }
            });
        }
        assert('随机变异 800 条 × 5 条路径：零漏出、零异常', fLeaks === 0 && fThrows === 0, fSample || (fLeaks + '/' + fThrows));
    })();
}

console.log('\n结果: ' + ok + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
