const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// defaultList 完整对象字段（name/modelId/endpoint/keyRef）
out.push('=== defaultList 字段提取 ===');
let cur = null;
for (let i = 45; i < 80 && i < lines.length; i++) {
  const l = lines[i];
  const n = l.match(/name:\s*'([^']+)'/); if (n) { cur = { name: n[1] }; out.push(''); out.push('# ' + n[1]); }
  const id = l.match(/modelId:\s*'([^']+)'/); if (id && cur) out.push('  modelId: ' + id[1]);
  const ep = l.match(/endpoint:\s*'([^']+)'/); if (ep && cur) out.push('  endpoint: ' + ep[1].slice(0, 80));
  const kr = l.match(/keyRef:\s*'([^']+)'/); if (kr && cur) out.push('  keyRef: ' + kr[1]);
}
// modelOptions 渲染（app-chatbox.js C375-395）
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
out.push('');
out.push('=== app-chatbox.js modelOptions 渲染 C375-C395 ===');
for (let i = 374; i < 395 && i < cl.length; i++) out.push('C' + (i+1) + '| ' + cl[i].trim().slice(0, 190));
// STORAGE_KEY 值
out.push('');
lines.forEach(function(l, i) { if (/STORAGE_KEY\s*=/.test(l)) out.push('STORAGE_KEY: ' + l.trim().slice(0, 120)); });
fs.writeFileSync('_r32.txt', out.join(NL), 'utf8');
console.log('done');
