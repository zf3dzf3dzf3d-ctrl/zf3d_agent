const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 方法体（不是调用处，是定义处 "modelOptions: function" 或 "modelOptions(m")
let idx = -1;
for (let i = 0; i < cl.length; i++) {
  if (/modelOptions\s*(\(|:\s*function|\=\s*function)/.test(cl[i])) { idx = i; break; }
}
out.push('=== modelOptions DEF @ C' + (idx+1) + ' ===');
if (idx >= 0) {
  let depth = 0, started = false;
  for (let i = idx; i < Math.min(idx + 30, cl.length); i++) {
    out.push('C' + (i+1) + '| ' + cl[i].slice(0, 190));
    for (const ch of cl[i]) { if (ch === '{') { depth++; started = true; } if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
}
fs.writeFileSync('_r22.txt', out.join(NL), 'utf8');
console.log('idx', idx);
