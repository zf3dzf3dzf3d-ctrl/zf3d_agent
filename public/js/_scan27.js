const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 定义体（搜 "modelOptions" 后跟 "function" 或 "(id) {"）
let idx = -1;
for (let i = 0; i < cl.length; i++) {
  if (/modelOptions/.test(cl[i]) && /function|\(.*\)\s*\{|=>/.test(cl[i]) && !/sel\.innerHTML/.test(cl[i])) { idx = i; break; }
}
out.push('=== modelOptions real def @ C' + (idx+1) + ' ===');
if (idx >= 0) {
  let depth = 0, started = false;
  for (let i = idx; i < Math.min(idx + 25, cl.length); i++) {
    out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
    for (const ch of cl[i]) { if (ch === '{') { depth++; started = true; } if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
}
// C370-C396（下拉渲染上下文）
out.push('');
out.push('=== context C370-C396 ===');
for (let i = 369; i < 396 && i < cl.length; i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
fs.writeFileSync('_r27.txt', out.join(NL), 'utf8');
console.log('idx', idx);
