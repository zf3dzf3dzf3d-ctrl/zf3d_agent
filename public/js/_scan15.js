const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 方法定义（C375 附近，含函数体）
out.push('=== modelOptions method def ===');
for (let i = 370; i < 400 && i < cl.length; i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
fs.writeFileSync('_r15.txt', out.join(NL), 'utf8');
