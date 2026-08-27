const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// defaultList 内全部 name
const names = [];
for (const l of lines) {
  const mm = l.match(/name:\s*'([^']+)'/);
  if (mm) names.push(mm[1]);
}
out.push('defaultList models (' + names.length + '):');
names.forEach(function(n, i) { out.push((i+1) + '. ' + n); });
// load 函数体 M255-M295
out.push('');
out.push('=== load() M255-M295 ===');
for (let i = 254; i < 295 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 190));
fs.writeFileSync('_r29.txt', out.join(NL), 'utf8');
console.log('names', names.length);
