const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// defaultList 完整函数体 L46-L76
out.push('=== models.js L46-L77 defaultList ===');
for (let i = 45; i < 77 && i < lines.length; i++) out.push('L' + (i+1) + '| ' + lines[i].slice(0, 200));
// STORAGE_KEY 定义
out.push('=== STORAGE keys ===');
lines.forEach(function(l, i) { if (/STORAGE_KEY|ACTIVE_KEY|zf_models/.test(l)) out.push('L' + (i+1) + '| ' + l.trim().slice(0,170)); });
// app-chatbox.js 中模型下拉渲染
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
out.push('=== app-chatbox.js model render lines ===');
cl.forEach(function(l, i) { if (/Models\.(list|activeId|name)|model-select|modelSelect|select.*model|模型选择|option/.test(l) && l.trim()) out.push('C' + (i+1) + '| ' + l.trim().slice(0, 180)); });
fs.writeFileSync('_r2.txt', out.join(NL), 'utf8');
