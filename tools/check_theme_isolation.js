#!/usr/bin/env node
/**
 * check_theme_isolation.js — 主题隔离自检（阶段4 防回归）
 * 规则：
 *  R1 CSS: html[data-theme] 选择器内不得出现 .chatbox（主题不得直达角色框）
 *  R2 CSS: body[data-skin] 已废弃，必须用 .chatbox[data-skin]
 *  R3 JS:  theme.js 不得向 html/body 写背景专属变量（--zf-custom-*, --kite-panel-*, --bg-own-*）
 *  R4 CSS/JS: 风格 body 背景规则必须排除背景层（:not(:has(#bgCustomLayer))），
 *             同时扫描 .css 文件与 theme.js 等内嵌 extraCss 字符串
 * 用法: node tools/check_theme_isolation.js  （有违规则退出码 1）
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let bad = 0;
function walk(dir, cb) {
  for (const f of fs.readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = path.join(dir, f), st = fs.statSync(p);
    st.isDirectory() ? walk(p, cb) : cb(p);
  }
}
walk(path.join(root, 'public'), p => {
  const rel = path.relative(root, p).replace(/\\/g, '/');
  if (p.endsWith('.css')) {
    const t = fs.readFileSync(p, 'utf8');
    // 逐条规则粗扫：按 } 分段
    t.split('}').forEach(seg => {
      const m = seg.match(/([^{}]+)\{/);
      if (!m) return;
      const sel = m[1].trim();
      if (/html\[data-theme\]/.test(sel) && /\.chatbox/.test(sel)) { console.log('R1 违规', rel, ':', sel.slice(0, 120)); bad++; }
      if (/body\[data-skin/.test(sel)) { console.log('R2 违规', rel, ':', sel.slice(0, 120)); bad++; }
      if (/\.zf-style-glow\s+body\s*\{/.test(seg) && !/body:not\(:has\(#bgCustomLayer\)\)/.test(sel)) { console.log('R4 违规', rel, ':', sel.slice(0, 120)); bad++; }
    });
  }
  // R4 扩展：扫描 JS 内嵌 extraCss 字符串（theme.js 等），同样按 } 分段粗扫
  if (p.endsWith('.js')) {
    const t = fs.readFileSync(p, 'utf8');
    t.split('}').forEach(seg => {
      const m = seg.match(/([^{}'"]+)\{/);
      if (!m) return;
      const sel = m[1].trim();
      if (/\.zf-style-glow\s+body\s*\{/.test(seg) && !/body:not\(:has\(#bgCustomLayer\)\)/.test(sel)) { console.log('R4 违规(JS内嵌)', rel, ':', sel.slice(0, 120)); bad++; }
    });
  }
  if (p.endsWith('theme.js')) {
    const t = fs.readFileSync(p, 'utf8');
    // R3 修正版：引号内为非引号字符（负向环视，替代原字符类内无意义的 \1），避免跨字符串误匹配
    const re = /root\.style\.setProperty\(\s*(['"])((?:(?!\1).)+?)\1/g;
    let m;
    while ((m = re.exec(t))) {
      if (/^--(zf-custom|kite-panel|bg-own)/.test(m[2])) { console.log('R3 违规 theme.js: 写背景变量', m[2]); bad++; }
    }
  }
});
console.log(bad ? ('FAIL: ' + bad + ' 处违规') : 'OK: 主题隔离检查通过');
process.exit(bad ? 1 : 0);
