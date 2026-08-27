const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 1) defaultList 中每个模型的 name+endpoint+keyRef（L46-L110 段）
out.push('=== defaultList 全字段 L46-L110 ===');
for (let i = 45; i < 110 && i < lines.length; i++) {
  const l = lines[i];
  if (/name:|endpoint:|modelId:|keyRef:|version:/.test(l)) out.push('M' + (i+1) + '| ' + l.trim().slice(0, 190));
}
// 2) save/load 函数定义
out.push('');
out.push('=== save/load 函数 ===');
for (let i = 0; i < lines.length; i++) {
  if (/function (save|load)\s*\(/.test(lines[i])) {
    for (let j = i; j < Math.min(i + 18, lines.length); j++) out.push('M' + (j+1) + '| ' + lines[j].slice(0, 190));
    out.push('---');
  }
}
fs.writeFileSync('_r30.txt', out.join(NL), 'utf8');
console.log('done');
