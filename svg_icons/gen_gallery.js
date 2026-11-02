// 生成图标总览页（审核用）：列出 icons.js 全部 emoji→SVG 映射
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'icons.js'), 'utf8');

// MAP 单行 JSON 式：取 "var MAP = {" 到 "};;" 之间，用逐字符解析提取顶层 key（带转义感知）
const start = src.indexOf('var MAP = {') + 'var MAP = {'.length;
const end = src.indexOf('};;', start);
const body = src.slice(start, end);
const keys = [];
let i = 0;
while (i < body.length) {
  const c = body[i];
  if (c === '"') {
    // 读字符串
    let j = i + 1, k = '';
    while (j < body.length) {
      if (body[j] === '\\') { k += body[j] + body[j + 1]; j += 2; continue; }
      if (body[j] === '"') break;
      k += body[j]; j++;
    }
    // key 之后应是 : 且值以 "<svg 开头
    let m = j + 1;
    while (body[m] === ' ') m++;
    if (body[m] === ':') {
      try { keys.push(JSON.parse('"' + k + '"')); } catch (e) { keys.push(k); }
      // 跳过值字符串
      let p = body.indexOf('"', m + 1);
      while (p < body.length && p !== -1) {
        // 检查前导转义数
        let bs = 0, q = p - 1;
        while (body[q] === '\\') { bs++; q--; }
        if (bs % 2 === 0) break;
        p = body.indexOf('"', p + 1);
      }
      i = p + 1;
      continue;
    }
    i = j + 1;
    continue;
  }
  i++;
}
const uniq = [...new Set(keys)];
console.log('共提取图标数:', uniq.length);

const items = uniq.map(k =>
  '<div class="card"><div class="emoji">' + k + '</div><div class="lbl">' +
  [...k].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ') +
  '</div></div>'
).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<title>图标总览（SVG 替换器映射表，共 ${uniq.length} 个）</title>
<script src="js/icons.js"></script>
<style>
body{font-family:"Segoe UI",sans-serif;background:#1e1f24;color:#eee;padding:24px}
h1{font-size:20px} p.meta{color:#9aa;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:16px}
.card{background:#2a2b31;border:1px solid #3a3b42;border-radius:10px;padding:14px 8px;text-align:center}
.emoji{font-size:36px;line-height:1.3}
.lbl{font-size:10px;color:#889;margin-top:8px;font-family:Consolas,monospace;word-break:break-all}
#tip{position:fixed;top:10px;right:14px;font-size:12px;padding:6px 12px;border-radius:6px}
.ok{background:#1b5e20;color:#c8e6c9}.bad{background:#b71c1c;color:#ffcdd2}
</style></head><body>
<h1>图标总览 — 共 ${uniq.length} 个</h1>
<p class="meta">每张卡片大图即 SVG 替换后的实际渲染效果（本页已加载 icons.js 替换器），下方为对应 Unicode 码点。审核要点：① 所有卡片显示为彩色 SVG 而非原生 emoji；② 无缺漏/截半；③ 风格统一协调。</p>
<span id="tip">检测中…</span>
<div class="grid">
${items}
</div>
<script>
setTimeout(function(){
  var t=document.getElementById('tip');
  var n=document.querySelectorAll('.zf-icons svg.zf-svg').length;
  if(n>Math.floor(${uniq.length}*0.8)){t.textContent='✅ 替换器已生效，本页 '+n+' 个图标已渲染为 SVG';t.className='ok';}
  else{t.textContent='⚠️ 替换器疑似未生效（'+n+' 个已替换），请通过 HTTP 服务器访问本页';t.className='bad';}
},600);
</script>
</body></html>`;

fs.writeFileSync(path.join(ROOT, 'public', 'icons_gallery.html'), html);
fs.writeFileSync(path.join(__dirname, '_keys.txt'), uniq.join('\n'));
console.log('OK -> public/icons_gallery.html');
