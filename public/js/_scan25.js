const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
// 1) 谁引用了 config/models.json 或 /api/config/models
const targets = ['public/js/models.js','public/js/app-chatbox.js','public/js/api.js','public/index.html','public/js/main.js','server.js','server/index.js','app.py','handler_routes.py'];
for (const f of targets) {
  let t; try { t = fs.readFileSync(f, 'utf8'); } catch(e) { continue; }
  t.split(NL).forEach(function(l, i) {
    if (l.indexOf('config/models') >= 0 || l.indexOf('models.json') >= 0 || l.indexOf('api_keys.json') >= 0) {
      out.push(f + ':L' + (i+1) + '| ' + l.trim().slice(0, 170));
    }
  });
}
fs.writeFileSync('_r25.txt', out.join(NL), 'utf8');
console.log('refs:', out.length);
