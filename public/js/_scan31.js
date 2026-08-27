const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// load() 函数体完整输出 M80-M115
out.push('=== load() M80-M115 ===');
for (let i = 79; i < 115 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 200));
// defaultList 剩余模型名 M60-M77
out.push('');
out.push('=== defaultList 尾部 M60-M77 ===');
for (let i = 59; i < 77 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 200));
fs.writeFileSync('_r31.txt', out.join(NL), 'utf8');
console.log('done');
