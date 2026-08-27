const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const m = fs.readFileSync('public/js/models.js', 'utf8');
const lines = m.split(NL);
// 列出所有方法定义行（含 async/load/save/list/active）
lines.forEach(function(l, i) {
  if (/^\s*(async\s+)?[a-zA-Z_]+\s*\(.*\)\s*\{|^\s*(async\s+)?[a-zA-Z_]+\s*:\s*(async\s*)?(function|\().*[{=]/.test(l) && l.trim()) {
    out.push('M' + (i+1) + '| ' + l.trim().slice(0, 180));
  }
});
fs.writeFileSync('_r18.txt', out.join(NL), 'utf8');
