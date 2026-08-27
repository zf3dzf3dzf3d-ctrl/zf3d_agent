const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// localStorage key 定义
out.push('=== KEY def ===');
lines.forEach(function(l, i) { if (/zf_community_models|STORAGE_KEY =|ACTIVE_KEY =/.test(l)) out.push('M' + (i+1) + '| ' + l.trim().slice(0,180)); });
// load() 函数体 L85-L130
out.push('=== load() L85-L130 ===');
for (let i = 84; i < 130 && i < lines.length; i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 190));
fs.writeFileSync('_r6.txt', out.join(NL), 'utf8');
