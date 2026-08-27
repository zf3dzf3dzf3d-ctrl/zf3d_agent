const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 输出文件整体结构：非空行带行号（每行截 190 字）
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.trim()) out.push('M' + (i+1) + '| ' + l.trim().slice(0, 190));
}
fs.writeFileSync('_r19.txt', out.join(NL), 'utf8');
console.log('total lines:', lines.length);
