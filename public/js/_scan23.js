const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// 找 modelOptions( 参数) 的真正定义：形如 modelOptions(id) { 或 modelOptions: function(id) {
let defs = [];
for (let i = 0; i < cl.length; i++) {
  if (/modelOptions\s*\(\s*\w+\s*\)\s*\{|modelOptions\s*:\s*function\s*\(|modelOptions\s*\(id\)/.test(cl[i])) {
    defs.push(i);
  }
}
out.push('defs found: ' + JSON.stringify(defs.map(function(d){return d+1})));
for (const d of defs) {
  out.push('=== def @ C' + (d+1) + ' ===');
  let depth = 0, started = false;
  for (let i = d; i < Math.min(d + 30, cl.length); i++) {
    out.push('C' + (i+1) + '| ' + cl[i].slice(0, 190));
    for (const ch of cl[i]) { if (ch === '{') { depth++; started = true; } if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
}
fs.writeFileSync('_r23.txt', out.join(NL), 'utf8');
console.log('defs', defs.length);
