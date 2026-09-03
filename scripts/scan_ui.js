// 列 JS 里动态生成的用户可见 UI 文案（排除 console / 注释 / 工具描述），找出词典未覆盖项
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const i18nSrc = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');
const block = i18nSrc.match(/const CN2EN\s*=\s*\{[\s\S]*?\n    \};/);
const dict = new Set();
const re0 = /['"]([^'"]*[\u4e00-\u9fff][^'"]*)['"]\s*:/g;
let m0;
while ((m0 = re0.exec(block[0])) !== null) dict.add(m0[1]);

const files = [];
(function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.js') && f.name !== 'i18n.js') files.push(p);
    }
})(path.join(ROOT, 'js'));

// 关注 UI 拼接特征：innerHTML/textContent/title=/placeholder=/按钮文案/toast/confirm/alert/innerText/insertAdjacentHTML
const uiCtx = /(innerHTML|textContent|innerText|insertAdjacentHTML|title\s*[:=]|placeholder|\.toast|showToast|confirm\(|alert\(|appendChild|label\s*[:=]|text\s*[:=])/;
const results = [];
for (const fp of files) {
    const src = fs.readFileSync(fp, 'utf8');
    const lines = src.split('\n');
    const rel = path.relative(ROOT, fp);
    lines.forEach((ln, i) => {
        const s = ln.trim();
        if (!/[\u4e00-\u9fff]/.test(s)) return;
        if (/^\s*(\/\/|\/\*|\*)/.test(ln)) return;      // 注释
        if (/console\.|throw new|Error\(/.test(s)) return; // 日志/错误
        if (/^['"]?\s*(原文|可选|prompt)/.test(s)) return; // 工具 schema 描述
        if (!uiCtx.test(s)) return;
        // 抽取该行中的中文字符串片段
        const frags = s.match(/['"`][^'"`]*[\u4e00-\u9fff][^'"`]*['"`]/g) || [];
        for (const f0 of frags) {
            const t = f0.slice(1, -1).replace(/\\n/g, ' ').trim();
            if (!/[\u4e00-\u9fff]/.test(t)) continue;
            if (dict.has(t)) continue;
            if ([...dict].some(k => t.includes(k) && k.length > 3)) continue; // 动态拼接已覆盖部分
            results.push({ file: rel, line: i + 1, text: t, ctx: s.slice(0, 120) });
        }
    });
}
console.log('疑似 UI 未翻译项:', results.length);
const seen = new Set();
for (const r of results) {
    const key = r.text;
    if (seen.has(key)) { continue; }
    seen.add(key);
    console.log(`${r.file}:${r.line}  "${r.text}"   | ${r.ctx}`);
}
