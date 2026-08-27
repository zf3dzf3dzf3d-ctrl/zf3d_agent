const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
// modelOptions 函数体 C375-C395
out.push('=== modelOptions body C375-C395 ===');
for (let i = 374; i < 395 && i < cl.length; i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
fs.writeFileSync('_r11.txt', out.join(NL), 'utf8');
