const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 定义处
let defs = [];
for (let i = 0; i < cl.length; i++) {
  if (/modelOptions\s*\(\s*\w*\s*\)/.test(cl[i]) && /[{;]/.test(cl[i])) defs.push(i);
}
out.push('defs at lines: ' + JSON.stringify(defs.map(function(d){return d+1})));
for (const d of defs) {
  out.push('=== def @ C' + (d+1) + ' ===');
  for (let i = d; i < Math.min(d + 14, cl.length); i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
}
// Models.list 使用位置
out.push('=== Models.list refs ===');
cl.forEach(function(l, i) { if (/Models\.list/.test(l)) out.push('C' + (i+1) + '| ' + l.trim().slice(0, 200)); });
fs.writeFileSync('_r26.txt', out.join(NL), 'utf8');
console.log('done');
