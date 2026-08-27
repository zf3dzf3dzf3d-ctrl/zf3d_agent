const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 1) STORAGE_KEY 与 api 相关行
lines.forEach(function(l, i) {
  if (/STORAGE_KEY|ACTIVE_KEY|localStorage|fetch\(|storage\.|api\/|\/api|defaultList|seed|migration|旧版/.test(l) && l.trim()) {
    out.push('M' + (i+1) + '| ' + l.trim().slice(0, 190));
  }
});
fs.writeFileSync('_r5.txt', out.join(NL), 'utf8');
