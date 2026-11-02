const { execSync } = require('child_process');
const fs = require('fs');
const html = fs.readFileSync('public/canvas/进化树/viewer.html', 'utf-8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
fs.writeFileSync('server/zf-trash/_vc.js', m[1]);
try {
  execSync('node --check server/zf-trash/_vc.js', { stdio: 'inherit' });
  console.log('JS_SYNTAX_OK');
} catch (e) {
  console.log('JS_SYNTAX_FAIL');
} finally {
  fs.unlinkSync('server/zf-trash/_vc.js');
}
