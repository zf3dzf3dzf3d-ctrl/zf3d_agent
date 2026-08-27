const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 找 Models 对象的 load 方法（数据从哪来）
lines.forEach(function(l, i) {
  if (/localStorage|fetch\(|load\s*[:=]|async|storage\.|api|config/.test(l) && l.trim() && !/^\/\//.test(l.trim())) {
    out.push('M' + (i+1) + '| ' + l.trim().slice(0, 190));
  }
});
fs.writeFileSync('_r28.txt', out.join(NL), 'utf8');
console.log('done', out.length);
