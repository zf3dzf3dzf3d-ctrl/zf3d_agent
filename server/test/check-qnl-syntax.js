const fs = require('fs');
const files = [
  'public/js/app.js',
  'public/js/chatbox-06-chat-actions.js',
  'public/js/app-quick-note-link.js'
];
let ok = true;
files.forEach(f => {
  try {
    const src = fs.readFileSync(f, 'utf8');
    new Function(src);
    console.log('SYNTAX OK:', f);
  } catch (e) {
    ok = false;
    console.log('SYNTAX FAIL:', f, e.message);
  }
});
process.exit(ok ? 0 : 1);
