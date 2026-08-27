const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 找 load 逻辑和 defaultList 名称
const names = [];
for (const l of lines) {
  const mm = l.match(/name:\s*'([^']+)'/);
  if (mm) names.push(mm[1]);
}
out.push('defaultList names (' + names.length + '): ' + names.join(' | '));
out.push('');
// localStorage / fetch 相关行
lines.forEach(function(l, i) {
  if (/localStorage|fetch\(|storage\.|api\/|config\/models|models\.json/.test(l) && l.trim()) {
    out.push('M' + (i+1) + '| ' + l.trim().slice(0, 190));
  }
});
fs.writeFileSync('_r24.txt', out.join(NL), 'utf8');
console.log('done');
