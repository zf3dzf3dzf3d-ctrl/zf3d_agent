const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 完整模型名单：提取所有 name:
const names = [];
for (const l of lines) {
  const mm = l.match(/name:\s*'([^']+)'/);
  if (mm) names.push(mm[1]);
}
out.push('ALL model names in defaultList:');
names.forEach(function(n, i) { out.push((i+1) + '. ' + n); });
// load() 函数 L85+ 前后
out.push('');
out.push('=== load/save/init area L76-L110 ===');
for (let i = 75; i < 110 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 190));
fs.writeFileSync('_r9.txt', out.join(NL), 'utf8');
