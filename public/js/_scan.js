const fs = require('fs');
const NL = String.fromCharCode(10);
const out = [];
for (const f of ['public/js/models.js','public/js/app-chatbox.js','public/js/api.js','public/index.html','public/js/main.js','server.js','public/js/storage.js','public/js/db.js']) {
  let t; try { t = fs.readFileSync(f, 'utf8'); } catch(e) { continue; }
  t.split(NL).forEach(function(l, i) {
    if (l.indexOf('config/models') >= 0 || l.indexOf('models.json') >= 0) {
      out.push(f + ':L' + (i+1) + '| ' + l.trim().slice(0, 170));
    }
  });
}
const m = fs.readFileSync('public/js/models.js', 'utf8');
out.push('=== models.js key lines ===');
m.split(NL).forEach(function(l, i) {
  if (/fetch\(|localStorage|storage\.|api\(|Models\.(list|active|save|load|init)|function /.test(l) && l.trim() && !/^\s*\/\//.test(l)) {
    out.push('M:L' + (i+1) + '| ' + l.trim().slice(0, 170));
  }
});
fs.writeFileSync('_report.txt', out.join(NL), 'utf8');
