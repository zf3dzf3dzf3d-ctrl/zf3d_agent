const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
// 1) 谁引用了 config/models.json
for (const f of ['public/js/models.js','public/js/app-chatbox.js','public/js/api.js','public/index.html','public/js/main.js','server.js','server/index.js']) {
  let t; try { t = fs.readFileSync(f, 'utf8'); } catch(e) { continue; }
  t.split(NL).forEach(function(l, i) {
    if (l.indexOf('config/models') >= 0 || l.indexOf('models.json') >= 0) {
      out.push(f + ':L' + (i+1) + '| ' + l.trim().slice(0, 170));
    }
  });
}
// 2) app-chatbox.js 中 modelOptions 定义体
const c = fs.readFileSync('public/js/app-chatbox.js', 'utf8');
const cl = c.split(NL);
let idx = -1;
for (let i = 0; i < cl.length; i++) { if (/modelOptions/.test(cl[i])) { idx = i; break; } }
if (idx >= 0) {
  out.push('=== modelOptions @ C' + (idx+1) + ' ===');
  for (let i = idx; i < Math.min(idx + 20, cl.length); i++) out.push('C' + (i+1) + '| ' + cl[i].slice(0, 200));
}
fs.writeFileSync('_r14.txt', out.join(NL), 'utf8');
