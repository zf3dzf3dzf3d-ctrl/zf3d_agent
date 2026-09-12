// 只列 index.html 设置面板区域的未翻译中文 + i18n.js 词典未覆盖项
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const i18nSrc = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');
const block = i18nSrc.match(/const CN2EN\s*=\s*\{[\s\S]*?\n    \};/);
const dict = new Set();
const re0 = /['"]([^'"]*[\u4e00-\u9fff][^'"]*)['"]\s*:/g;
let m0;
while ((m0 = re0.exec(block[0])) !== null) dict.add(m0[0].slice(1, -2));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lines = html.split('\n');
// 设置面板：找 modal/panel id
const out = [];
const re = />([^<>]*[\u4e00-\u9fff][^<>]*)</g;
lines.forEach((ln, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(ln)) !== null) {
        const t = m[1].trim();
        if (!t) continue;
        if ([...dict].some(k => k === t)) continue;
        // 词典键完全相同才跳过；再检查 t 是否是某键前缀包含（跳过即可，因为整 DOM 会按完整文本节点匹配）
        out.push({ line: i + 1, text: t });
    }
});
console.log('index.html 未被词典精确覆盖的文本节点:', out.length);
const seen = new Set();
for (const o of out) {
    if (seen.has(o.text)) continue;
    seen.add(o.text);
    console.log(`L${o.line}: ${o.text}`);
}
