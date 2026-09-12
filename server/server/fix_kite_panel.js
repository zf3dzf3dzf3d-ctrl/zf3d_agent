var fs = require('fs');
var p = require('path').resolve(__dirname, '../public/js/app-kite.js');
var lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
// 删除所有含 _ov 声明块的行（848-856 附近：注释行 + var _ov 行 + if(_ov) 行）
var out = [];
for (var i = 0; i < lines.length; i++) {
  var L = lines[i];
  if (/拖拽开始立即收起概览面板/.test(L) || /var _ov = root/.test(L) || /if \(_ov\) \{ overviewClosed/.test(L)) continue;
  out.push(L);
}
// 找 down 函数里的 overview 拦截行，其后插入一份
var idx = out.findIndex(function (l) { return l.indexOf("e.target.closest('.kite-head-overview')") >= 0 && l.indexOf('return;') >= 0; });
if (idx < 0) { console.log('ANCHOR NOT FOUND'); process.exit(1); }
var indent = '            ';
out.splice(idx + 1, 0,
  indent + '/* 拖拽开始立即收起概览面板：拖动风筝时面板不再跟着挡视线 */',
  indent + "var _ov = root && root.querySelector('.kite-head-overview');",
  indent + "if (_ov) { overviewClosed = true; _ov.classList.remove('open'); }");
fs.writeFileSync(p, out.join('\n'), 'utf8');
console.log('CLEAN OK at line', idx + 2);
