// 全量图标体检：语法 / 裸片段 / 渐变id重复 / 引用缺失（单双引号均支持）
// 用法: node svg_icons/full_check.js
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'public', 'js', 'icons.js');
const s = fs.readFileSync(file, 'utf8');
const mapStart = s.indexOf('{', s.indexOf('var MAP'));
const entryRe = /"([^"]{1,4})":"((?:[^"\\]|\\.)*)"/g;
let m, bad = 0, total = 0;
const gradIds = {}, gradRefs = {};
const ATTR = /id=["']([^"']+)["']/;
while ((m = entryRe.exec(s))) {
  if (m.index < mapStart) continue;
  total++;
  const key = m[1], val = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (!/^<svg[\s>]/.test(val)) { bad++; if (bad <= 5) console.log('BAD ENTRY', JSON.stringify(key), val.slice(0, 60)); continue; }
  if (!val.trim().endsWith('</svg>')) { bad++; if (bad <= 5) console.log('BAD END', JSON.stringify(key)); }
  for (const idm of val.matchAll(/<(linear|radial)Gradient[^>]*id=(["'])([^"']+)\2/g)) {
    (gradIds[idm[3]] = gradIds[idm[3]] || []).push(key);
  }
  for (const rm of val.matchAll(/url\(#([^)'" ]+)\)/g)) (gradRefs[rm[1]] = gradRefs[rm[1]] || []).push(key);
}
console.log('total entries:', total, 'bad:', bad);
const dups = Object.entries(gradIds).filter(([, v]) => v.length > 1);
console.log('duplicate gradient DEFINITIONS:', dups.length ? JSON.stringify(dups) : '无');
const missing = Object.entries(gradRefs).filter(([k]) => !gradIds[k]);
console.log('refs to missing ids:', missing.length ? JSON.stringify(missing) : '无');
try { new Function(s); console.log('syntax OK'); } catch (e) { console.log('SYNTAX ERR:', e.message); }
