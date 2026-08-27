const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 只取 M17-M80（defaultList 部分）
for (let i = 16; i < 80 && i < lines.length; i++) {
  const l = lines[i];
  if (l.trim()) out.push('M' + (i+1) + '| ' + l.trim().slice(0, 190));
}
fs.writeFileSync('_r20.txt', out.join(NL), 'utf8');
console.log('written', out.length);
