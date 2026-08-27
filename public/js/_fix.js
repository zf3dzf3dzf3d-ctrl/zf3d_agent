const fs = require('fs');
const f = 'models.js';
let src = fs.readFileSync(f, 'utf8');

// L224: replace(/\\/+$/, '') -> replace(/\/+$/, '')
// L225: /\\/api\\/plan(\\/|$)/ -> /\/api\/plan(\/|$)/
const before = src;
src = src
  .replace(/replace\(\/\\\\\/\+\$\/, ''\)/, "replace(/\\/+$/, '')")
  .replace(/\/\\\/api\\\/plan\(\\\/\|\$\)\//, "/\\/api\\/plan(\\/|$)/");

console.log('changed:', src !== before);
fs.writeFileSync(f, src, 'utf8');
console.log('size:', src.length);
