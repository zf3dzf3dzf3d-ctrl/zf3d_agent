var fs = require('fs');
var p = require('path').resolve(__dirname, '../public/js/app-kite.js');
var lines = fs.readFileSync(p, 'utf8').split('\n');
console.log('total lines:', lines.length);
// 找到 down 函数中含 kite-head-overview 且含 return 的行
var hits = [];
lines.forEach(function (l, i) { if (l.indexOf('kite-head-overview') >= 0) hits.push([i + 1, JSON.stringify(l.trim())]); });
console.log(JSON.stringify(hits, null, 1));
