// 最终确认：用正则从源码提取 MAP 字面量并 JSON 解析（不执行整份脚本）
// 用法: node svg_icons/final_check.js
const fs = require('fs');
const src = fs.readFileSync('F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.5.0/public/js/icons.js', 'utf8');
const start = src.indexOf('{', src.indexOf('var MAP'));
// 括号配平提取对象字面量
let depth = 0, end = -1, inStr = false, q = '', esc = false;
for (let i = start; i < src.length; i++) {
  const c = src[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === q) inStr = false;
    continue;
  }
  if (c === '"' || c === "'") { inStr = true; q = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const MAP = JSON.parse(src.slice(start, end));
const keys = Object.keys(MAP);
console.log('MAP size:', keys.length);
let bad = 0;
for (const k of keys) {
  const v = MAP[k];
  if (!/^<svg[\s>]/.test(v)) { bad++; console.log('BAD', JSON.stringify(k)); continue; }
  if (!v.trim().endsWith('</svg>')) { bad++; console.log('BADEND', JSON.stringify(k)); continue; }
  const defs = new Set([...v.matchAll(/<(?:linear|radial)Gradient[^>]*id=["']([^"']+)["']/g)].map(m => m[1]));
  const refs = [...v.matchAll(/url\(#([^)"']+)\)/g)].map(m => m[1]);
  for (const r of refs) if (!defs.has(r)) { bad++; console.log('REF-MISS', JSON.stringify(k), r); }
}
console.log('bad:', bad);
for (const k of ['→', '▼', '⬅', '⬆', '⬇', '➡', '▶', '◀', '─', '✕', '⟳', '📌', '🎭', '🐕', '☀', '🌊', '🏆', '🐍', '🏠', '←']) {
  console.log(k, MAP[k] ? 'OK' : 'MISSING');
}
