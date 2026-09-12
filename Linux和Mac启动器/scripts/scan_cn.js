// 扫描 public/js/*.js + index.html 中的硬编码中文，对比 i18n 词典找出未覆盖项
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'public');

// 1. 提取 i18n.js 的 CN2EN 键
const i18nSrc = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');
// 抓取 CN2EN = { ... } 的键：'xxx': 或 "xxx":
const cn2enBlock = i18nSrc.match(/const CN2EN\s*=\s*\{[\s\S]*?\n    \};/);
const dictKeys = new Set();
if (cn2enBlock) {
    const re = /['"]([^'"]*[\u4e00-\u9fff][^'"]*)['"]\s*:/g;
    let m;
    while ((m = re.exec(cn2enBlock[0])) !== null) dictKeys.add(m[1]);
}
console.log('词典键数量:', dictKeys.size);

// RULES 正则（翻译动态文案）
const rulesBlock = i18nSrc.match(/RULES\s*=\s*\[[\s\S]*?\n    \];/);
const rulesSrc = rulesBlock ? rulesBlock[0] : '';
console.log('RULES 存在:', !!rulesBlock);

// 2. 收集 JS 文件中的中文字符串
function scanFile(fp, kind) {
    const src = fs.readFileSync(fp, 'utf8');
    const rel = path.relative(ROOT, fp);
    const found = [];
    if (kind === 'js') {
        // 抓单引号/双引号/反引号字符串里的中文（简化：直接找含中文的字符串字面量）
        const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*[\u4e00-\u9fff](?:\\.|(?!\1)[^\\\n])*)\1/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            found.push({ text: m[2], line: src.slice(0, m.index).split('\n').length });
        }
        // 注释里的中文单独统计但不算问题
    } else {
        // html: 抓 >text< 和属性值中的中文
        const re = />([^<>]*[\u4e00-\u9fff][^<>]*)<|([-\w]+)="([^"]*[\u4e00-\u9fff][^"]*)"/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            const t = (m[1] || m[3] || '').trim();
            if (t) found.push({ text: t, line: src.slice(0, m.index).split('\n').length });
        }
    }
    return found.map(f => ({ ...f, file: rel }));
}

const files = [];
(function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.js')) files.push([p, 'js']);
    }
})(path.join(ROOT, 'js'));
files.push([path.join(ROOT, 'index.html'), 'html']);

const issues = [];
for (const [fp, kind] of files) {
    for (const f of scanFile(fp, kind)) {
        const t = f.text;
        if (dictKeys.has(t)) continue;
        // 词典键是否以该文本开头（部分匹配，如 RULES 动态文案）——先不判，全部列出再人工筛
        issues.push(f);
    }
}

// 去重统计
const byText = {};
for (const it of issues) {
    (byText[it.text] = byText[it.text] || []).push(it.file + ':' + it.line);
}
const texts = Object.keys(byText).sort((a, b) => byText[b].length - byText[a].length);
console.log('未直接命中的中文片段总数（含注释/日志等误报）:', texts.length);
console.log('==== 出现次数 TOP 200 ====');
for (const t of texts.slice(0, 200)) {
    console.log(`[${byText[t].length}x] ${t}`);
    console.log('    ' + byText[t].slice(0, 3).join(' | '));
}
