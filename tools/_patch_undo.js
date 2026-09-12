const fs = require('fs');
const p = 'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.1.2/public/js/app-undo.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let fail = false;
function rep(a, b, tag) {
  if (!s.includes(a)) { console.log('MISS:' + tag); fail = true; return; }
  s = s.replace(a, b);
  console.log('OK:' + tag);
}

// 在 _apply 的 switch 末尾（'viewport' 注释处）追加随手标题操作分支
rep(`                // 'viewport'（平移画布）已移除：摄像机平移不参与撤销/重做
            }`,
`                // 'viewport'（平移画布）已移除：摄像机平移不参与撤销/重做

                // ===== 随手标题：新建 / 删除 / 重命名 / 移动 =====
                case 'qn-note-add': {
                    var QN1 = window.QuickNote && QuickNote._internal;
                    if (undoDir) {
                        // 回退新建 = 删除该标题
                        if (QN1) QN1.removeNote(op.note.id);
                    } else {
                        if (QN1) {
                            var notes1 = QN1.notes();
                            if (!notes1.some(function (n) { return n.id === op.note.id; })) {
                                notes1.push(JSON.parse(JSON.stringify(op.note)));
                                QN1.render(notes1[notes1.length - 1]);
                                QN1.saveAll();
                            }
                        }
                    }
                    break;
                }
                case 'qn-note-remove': {
                    var QN2 = window.QuickNote && QuickNote._internal;
                    if (undoDir) {
                        // 回退删除 = 恢复该标题到原位置
                        if (QN2) {
                            var notes2 = QN2.notes();
                            if (!notes2.some(function (n) { return n.id === op.note.id; })) {
                                var idx2 = Math.min(op.index || notes2.length, notes2.length);
                                notes2.splice(idx2, 0, JSON.parse(JSON.stringify(op.note)));
                                QN2.render(notes2[idx2]);
                                QN2.saveAll();
                            }
                        }
                    } else {
                        if (QN2) QN2.removeNote(op.note.id);
                    }
                    break;
                }
                case 'qn-note-rename': {
                    var QN3 = window.QuickNote && QuickNote._internal;
                    if (QN3) {
                        var n3 = QN3.notes().find(function (n) { return n.id === op.id; });
                        if (n3) {
                            n3.text = undoDir ? op.from : op.to;
                            var el3 = n3._el;
                            if (el3) { var t3 = el3.querySelector('.qn-text'); if (t3) t3.textContent = n3.text; }
                            QN3.saveAll();
                        }
                    }
                    break;
                }
                case 'qn-note-move': {
                    var QN4 = window.QuickNote && QuickNote._internal;
                    if (QN4) {
                        var n4 = QN4.notes().find(function (n) { return n.id === op.id; });
                        if (n4) {
                            var pos4 = undoDir ? op.from : op.to;
                            n4.x = pos4.x; n4.y = pos4.y;
                            var el4 = n4._el;
                            if (el4) { el4.style.left = pos4.x + 'px'; el4.style.top = pos4.y + 'px'; }
                            QN4.saveAll();
                        }
                    }
                    break;
                }
            }`, 'undo-switch');

fs.writeFileSync(p, s);
console.log('SIZE', fs.statSync(p).size, 'FAIL', fail);
