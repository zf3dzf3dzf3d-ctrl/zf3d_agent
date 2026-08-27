const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// defaultList 内所有 name 字段
const names = [];
for (const l of lines) {
  const mm = l.match(/name:\s*'([^']+)'/);
  if (mm) names.push(mm[1]);
}
out.push('defaultList models (' + names.length + '):');
names.forEach(function(n, i) { out.push((i+1) + '. ' + n); });

// app-chatbox.js modelOptions 函数体
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
let idx = -1;
for (let i = 0; i < cl.length; i++) { if (/modelOptions/.test(cl[i]) && /modelOptions\s*[:=(]/.test(cl[i])) { idx = i; break; } }
out.push('');
out.push('=== app-chatbox.js modelOptions @ C' + (idx+1) + ' ===');
if (idx >= 0) {
  let depth = 0, started = false;
  for (let i = idx; i < Math.min(idx + 30, cl.length); i++) {
    out.push('C' + (i+1) + '| ' + cl[i].slice(0, 190));
    for (const ch of cl[i]) { if (ch === '{') { depth++; started = true; } if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
}
// HTML 中模型下拉元素
const h = fs.readFileSync('public/index.html', 'utf8');
hl = h.split(NL);
out.push('');
out.push('=== index.html model select ===');
hl.forEach(function(l, i) { if (/model-select|modelSelect|模型/.test(l)) out.push('H' + (i+1) + '| ' + l.trim().slice(0, 170)); });
fs.writeFileSync('_r21.txt', out.join(NL), 'utf8');
console.log('done');
