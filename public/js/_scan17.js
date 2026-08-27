const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 找真正的 load: 定义（带函数体的）
let idx = -1;
for (let i = 20; i < lines.length; i++) {
  if (/^\s*(load|async load)\s*[:(]/.test(lines[i]) && /{/.test(lines[i])) { idx = i; break; }
}
out.push('=== load def @ M' + (idx+1) + ' ===');
if (idx >= 0) {
  let depth = 0, started = false;
  for (let i = idx; i < Math.min(idx + 35, lines.length); i++) {
    out.push('M' + (i+1) + '| ' + lines[i].slice(0, 200));
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
}
fs.writeFileSync('_r17.txt', out.join(NL), 'utf8');
