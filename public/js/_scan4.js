const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 函数定义体（搜 "modelOptions:" 或 "modelOptions =" 或 "modelOptions("）
let idx = -1;
for (let i = 0; i < cl.length; i++) {
  if (/modelOptions\s*[:=]/.test(cl[i]) || /modelOptions\s*\(\s*\w*\s*\)\s*\{/.test(cl[i])) { idx = i; break; }
}
if (idx >= 0) {
  out.push('=== modelOptions def @ C' + (idx+1) + ' ===');
  let depth = 0, started = false;
  for (let i = idx; i < Math.min(idx + 30, cl.length); i++) {
    const l = cl[i];
    out.push('C' + (i+1) + '| ' + l.slice(0, 200));
    for (const ch of l) { if (ch === '{') { depth++; started = true; } if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
} else out.push('modelOptions def NOT FOUND');
// Models.list.forEach 上下文 C381 附近
out.push('=== C381 context ===');
for (let i = 375; i < 410 && i < cl.length; i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
fs.writeFileSync('_r4.txt', out.join(NL), 'utf8');
