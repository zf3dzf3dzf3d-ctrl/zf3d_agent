const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// load() 函数：找到它并完整输出
let idx = -1;
for (let i = 0; i < lines.length; i++) { if (/load\s*[:=(]/.test(lines[i])) { idx = i; break; } }
out.push('=== load() @ M' + (idx+1) + ' ===');
if (idx >= 0) {
  let depth = 0, started = false;
  for (let i = idx; i < Math.min(idx + 40, lines.length); i++) {
    out.push('M' + (i+1) + '| ' + lines[i].slice(0, 200));
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
}
// api() 函数：找 fetch 调用
let idx2 = -1;
for (let i = 0; i < lines.length; i++) { if (/api\s*[:=(]/.test(lines[i]) && /fetch|storage|config/.test(lines.slice(i, i+30).join(NL))) { idx2 = i; break; } }
out.push('');
out.push('=== api-related @ M' + (idx2+1) + ' ===');
if (idx2 >= 0) {
  for (let i = idx2; i < Math.min(idx2 + 30, lines.length); i++) out.push('M' + (i+1) + '| ' + lines[i].slice(0, 200));
}
fs.writeFileSync('_r16.txt', out.join(NL), 'utf8');
