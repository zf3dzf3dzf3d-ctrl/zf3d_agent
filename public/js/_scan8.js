const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// defaultList L54-L69 中段（被截断部分）
out.push('=== defaultList L54-L69 ===');
for (let i = 53; i < 69 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 200));
fs.writeFileSync('_r8.txt', out.join(NL), 'utf8');
