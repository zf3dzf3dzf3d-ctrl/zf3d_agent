const fs = require('fs');
const p = 'public/js/zf-app-dock.js';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('var esc = function (s)')) { console.log('ALREADY'); process.exit(0); }
const a = '    (function () {\n      var iT = {';
if (!s.includes(a)) { console.log('NO_ANCHOR'); process.exit(1); }
const escFn = '      var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"\']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" }[c]; }); };';
s = s.replace(a, '    (function () {\n' + escFn + '\n      var iT = {');
fs.writeFileSync(p, s);
console.log('WROTE');
setTimeout(function () {
  const v = fs.readFileSync(p, 'utf8');
  console.log('after2s:', v.includes('var esc = function (s)'));
}, 2000);
