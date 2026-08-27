const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// defaultList L46-L77 完整 + Models 对象导出方式
out.push('=== defaultList L46-L77 ===');
for (let i = 45; i < 77 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 210));
fs.writeFileSync('_r12.txt', out.join(NL), 'utf8');
