const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 定义与使用
let idx = -1;
for (let i = 0; i < cl.length; i++) { if (/modelOptions/.test(cl[i])) { idx = i; break; } }
if (idx >= 0) {
  out.push('=== modelOptions first @ C' + (idx+1) + ' ===');
  for (let i = idx; i < Math.min(idx + 25, cl.length); i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
}
// 所有 modelOptions 出现处
out.push('=== all modelOptions refs ===');
cl.forEach(function(l, i) { if (/modelOptions/.test(l)) out.push('C' + (i+1) + '| ' + l.trim().slice(0, 190)); });
fs.writeFileSync('_r10.txt', out.join(NL), 'utf8');
