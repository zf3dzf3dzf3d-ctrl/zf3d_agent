const fs = require('fs');
const p = 'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.1.2/public/js/app-quick-note.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let fail = false;
function rep(a, b, tag) {
  if (!s.includes(a)) { console.log('MISS:' + tag); fail = true; return; }
  s = s.replace(a, b);
  console.log('OK:' + tag);
}

rep(`      if (v !== note.text) {
        note.text = v;
        textSpan.textContent = v;
        saveAll();
      }`,
`      if (v !== note.text) {
        var oldText = note.text;
        note.text = v;
        textSpan.textContent = v;
        saveAll();
        recordQn({ type: 'qn-note-rename', label: '重命名随手标题', id: id, from: oldText, to: v });
      }`, 'rename');

rep(`        if (moved) {
          note.x = nx; note.y = ny;
          saveAll();`,
`        if (moved) {
          var fx = note.x, fy = note.y;
          note.x = nx; note.y = ny;
          saveAll();
          recordQn({ type: 'qn-note-move', label: '移动随手标题', id: note.id, from: { x: fx, y: fy }, to: { x: nx, y: ny } });`, 'move');

rep(`    _notes.push(note);
    render(note);
    saveAll();
    startEdit(note.id);
    return note;`,
`    _notes.push(note);
    render(note);
    saveAll();
    recordQn({ type: 'qn-note-add', label: '新建随手标题', note: JSON.parse(JSON.stringify(note)) });
    startEdit(note.id);
    return note;`, 'create');

rep(`  function remove(id) {
    var idx = _notes.findIndex(function (n) { return n.id === id; });
    if (idx < 0) return;
    var el = _notes[idx]._el;
    if (el && el.parentNode) el.remove();
    _notes.splice(idx, 1);
    saveAll();
  }`,
`  function removeNote(id) {
    var idx = _notes.findIndex(function (n) { return n.id === id; });
    if (idx < 0) return null;
    var el = _notes[idx]._el;
    if (el && el.parentNode) el.remove();
    var snapshot = JSON.parse(JSON.stringify({ note: _notes[idx], index: idx }));
    _notes.splice(idx, 1);
    saveAll();
    return snapshot;
  }
  function remove(id) {
    var snap = removeNote(id);
    if (snap) recordQn({ type: 'qn-note-remove', label: '删除随手标题', note: snap.note, index: snap.index });
  }`, 'remove');

rep(`  window.QuickNote = {
    create: create,
    remove: remove,
    restoreAll: restoreAll,
    all: function () { return _notes.slice(); }
  };`,
`  window.QuickNote = {
    create: create,
    remove: remove,
    restoreAll: restoreAll,
    all: function () { return _notes.slice(); },
    // ---- 撤销/重做内部句柄（供 app-undo.js 回放）----
    _internal: {
      notes: function () { return _notes; },
      render: render,
      removeNote: removeNote,
      saveAll: saveAll
    }
  };`, 'api');

fs.writeFileSync(p, s);
console.log('SIZE', fs.statSync(p).size, 'FAIL', fail);
