const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 函数体
const idx = cl.findIndex(l => l.indexOf('modelOptions') >= 0 && /modelOptions\s*[:=(]/.test(l));
if (idx >= 0) {
  out.push('=== modelOptions @ line ' + (idx+1) + ' ===');
  for (let i = idx; i < Math.min(idx + 40, cl.length); i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
}
// Models.list 使用处
out.push('=== Models.list usages ===');
cl.forEach(function(l, i) { if (/Models\.list/.test(l)) out.push('C' + (i+1) + '| ' + l.trim().slice(0, 200)); });
fs.writeFileSync('_r3.txt', out.join(NL), 'utf8');
