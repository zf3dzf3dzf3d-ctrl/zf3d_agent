const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 提取所有模型 name（defaultList 内）
const names = [];
for (const l of lines) {
  const mm = l.match(/name:\s*'([^']+)'/);
  if (mm) names.push(mm[1]);
}
out.push('ALL defaultList names (' + names.length + '):');
names.forEach(function(n, i) { out.push((i+1) + '. ' + n); });
// load() 函数 L77-L110
out.push('');
out.push('=== load() L77-L112 ===');
for (let i = 76; i < 112 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 200));
fs.writeFileSync('_r13.txt', out.join(NL), 'utf8');
