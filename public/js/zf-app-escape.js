/* i密室 前端 v2（2026-11-21 自研交互版）
 * 对接：POST /api/escape/new（JSON body {difficulty:1..3}）、POST /api/escape/action
 * 【2026-11-23】开新局由 GET ?difficulty= 迁为 POST body（GET 写操作可被预取/跨站触发）
 * 零 window.prompt：物品题=背包按钮、密码题=自研数字键盘、顺序题=彩色机关点选、谜语题=自研弹层输入
 */
(function () {
  var ZFEscape = window.ZFEscape = {};
  var runId = null, st = null, level = null;
  var COLORS = ['红', '蓝', '绿', '黄', '紫'];
  var COLOR_HEX = { '红': '#e05555', '蓝': '#5577e0', '绿': '#4bab5e', '黄': '#e0c04d', '紫': '#a55fd0' };

  function api(action, body, cb) {
    var isNew = action.indexOf('new') === 0;
    var opts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isNew ? { difficulty: body && body.difficulty } : (body || {})) };
    fetch(isNew ? '/api/escape/new' : '/api/escape/action', opts)
      .then(function (r) { return r.json(); }).then(cb).catch(function (e) { cb({ ok: false, err: String(e) }); });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function objName(id) { return level && level.objects[id] ? level.objects[id].name : id; }

  /* ---- 自研弹层（替代 window.prompt）---- */
  function modal(el, title, bodyHtml, onOk, okText) {
    closeModal(el);
    var ov = document.createElement('div');
    ov.className = 'zf-escape-modal';
    ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;z-index:99';
    ov.innerHTML =
      '<div style="background:#1e2430;border:1px solid #3a4a66;border-radius:10px;min-width:280px;max-width:92%;padding:14px;color:#eee;box-shadow:0 8px 30px rgba(0,0,0,.5)">'
      + '<div style="font-weight:bold;margin-bottom:10px">' + esc(title) + '</div>'
      + '<div class="zf-escape-modal-body">' + bodyHtml + '</div>'
      + '<div style="margin-top:12px;text-align:right">'
      + '<button class="zf-escape-cancel" style="margin-right:8px;padding:5px 14px;background:#2a3242;color:#ccd;border:none;border-radius:6px;cursor:pointer">取消</button>'
      + '<button class="zf-escape-ok" style="padding:5px 14px;background:#1f6fd0;color:#fff;border:none;border-radius:6px;cursor:pointer">' + esc(okText || '确定') + '</button>'
      + '</div></div>';
    ov.querySelector('.zf-escape-cancel').onclick = function () { closeModal(el); };
    ov.querySelector('.zf-escape-ok').onclick = function () { if (onOk() !== false) closeModal(el); };
    el.appendChild(ov);
  }
  function closeModal(el) {
    var m = el.querySelector('.zf-escape-modal'); if (m) m.remove();
  }

  /* ---- 各谜题类型交互 ---- */
  function solveItem(el, p) {
    var inv = (st.inventory || []).filter(function (id) { return id !== '__none__'; });
    if (!inv.length) { msg(el, '背包是空的——先在地图上走到 📦 处点「拾取」'); return; }
    var btns = inv.map(function (id) {
      return '<button class="zf-esc-inv" data-oid="' + esc(id) + '" style="margin:4px;padding:8px 12px;background:#2a3242;color:#eee;border:1px solid #3a4a66;border-radius:8px;cursor:pointer;font-size:14px">🎒 ' + esc(objName(id)) + '</button>';
    }).join('');
    modal(el, p.question, '<div data-pid="' + esc(p.id) + '">' + btns + '</div>', function () { return false; }, '关闭');
  }
  function solveCode(el, p) {
    var cur = '';
    var keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
    var body = '<div class="zf-esc-code" style="font-size:26px;letter-spacing:8px;text-align:center;background:#12161f;border-radius:8px;padding:8px 0;margin-bottom:10px;min-height:40px;color:#7fd0ff">— — —</div>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">'
      + keys.map(function (k) { return '<button class="zf-esc-key" data-k="' + k + '" style="padding:12px 0;font-size:18px;background:#2a3242;color:#eee;border:1px solid #3a4a66;border-radius:8px;cursor:pointer">' + k + '</button>'; }).join('')
      + '<button class="zf-esc-del" style="padding:12px 0;font-size:15px;background:#2a3242;color:#eee;border:1px solid #3a4a66;border-radius:8px;cursor:pointer">⌫</button>'
      + '</div>';
    modal(el, p.question, body, submit, '提交密码');
    var disp = el.querySelector('.zf-esc-code');
    function paint() { disp.textContent = (cur.padEnd(3, '—').split('').join(' ')); }
    el.querySelector('.zf-escape-modal-body').addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('zf-esc-key') && cur.length < 3) { cur += t.dataset.k; paint(); }
      else if (t.classList.contains('zf-esc-del')) { cur = cur.slice(0, -1); paint(); }
    });
    function submit() {
      if (cur.length < 3) { disp.style.color = '#f88'; return false; }
      act({ action: 'solve', puzzle_id: p.id, answer: cur }, el);
    }
  }
  function solveSequence(el, p) {
    var n = 4, picked = [];
    var body = '<div style="font-size:13px;color:#aab;margin-bottom:6px">按顺序点击机关（可点撤销重选）：</div>'
      + '<div class="zf-esc-seq" style="min-height:34px;margin-bottom:10px"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + COLORS.map(function (c) { return '<button class="zf-esc-col" data-c="' + c + '" style="flex:1;min-width:64px;padding:14px 0;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:15px;background:' + COLOR_HEX[c] + '">' + c + '</button>'; }).join('')
      + '</div><div style="margin-top:8px;text-align:center"><button class="zf-esc-clear" style="padding:4px 12px;background:#2a3242;color:#ccd;border:1px solid #3a4a66;border-radius:6px;cursor:pointer">撤销全部</button></div>';
    modal(el, p.question, body, submit, '扳动机关');
    var seqEl = el.querySelector('.zf-esc-seq');
    function paint() {
      seqEl.innerHTML = picked.length
        ? picked.map(function (c, i) { return '<span style="display:inline-block;margin:2px;padding:4px 10px;border-radius:6px;color:#fff;background:' + COLOR_HEX[c] + '">' + (i + 1) + '. ' + c + '</span>'; }).join('')
        : '<span style="color:#667">（尚未选择）</span>';
    }
    el.querySelector('.zf-escape-modal-body').addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('zf-esc-col')) { picked.push(t.dataset.c); paint(); }
      else if (t.classList.contains('zf-esc-clear')) { picked = []; paint(); }
    });
    paint();
    function submit() {
      if (!picked.length) return false;
      act({ action: 'solve', puzzle_id: p.id, answer: picked }, el);
    }
  }
  function solveRiddle(el, p) {
    var body = '<input class="zf-esc-ans" placeholder="输入你的答案…" style="width:100%;box-sizing:border-box;padding:9px 10px;font-size:15px;background:#12161f;color:#eee;border:1px solid #3a4a66;border-radius:8px;outline:none">';
    modal(el, p.question, body, submit, '回答');
    var inp = el.querySelector('.zf-esc-ans');
    setTimeout(function () { inp.focus(); }, 30);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.querySelector('.zf-escape-ok').click(); });
    function submit() {
      var v = inp.value.trim();
      if (!v) return false;
      var norm = v.replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); }).replace(/\u3000/g, ' ').replace(/\s+/g, '');
      act({ action: 'solve', puzzle_id: p.id, answer: norm }, el);
    }
  }

  function roomOf(p) { return (level && level.rooms && level.rooms[p.room]) || null; }
  function curRoom() { if (!st || !level) return null; for (var rid in (level.rooms || {})) if (level.rooms[rid].pos[0] === st.pos[0] && level.rooms[rid].pos[1] === st.pos[1]) return level.rooms[rid]; return null; }
  function roomNameOf(p) { var r = roomOf(p); return r ? r.name : (p.room || '?'); }
  /* 方向指引：从当前位置指向谜题房间 */
  function dirText(p) {
    if (!st) return '';
    var r = roomOf(p); if (!r) return '';
    var dy = r.pos[0] - st.pos[0], dx = r.pos[1] - st.pos[1];
    if (!dy && !dx) return '就在本房间';
    var d = [];
    if (dy < 0) d.push('↑上'); if (dy > 0) d.push('↓下');
    if (dx < 0) d.push('←左'); if (dx > 0) d.push('→右');
    return '在' + d.join('');
  }
  function hintText(p) {
    var t = { item: '先走遍各房间，走到 📦 处点「拾取」拿到道具，再点「尝试」直接选背包里的道具即可',
      code: '3 位数字密码——先拾取相关道具（📦），密码线索藏在某个房间的物品描述里，逐个房间找',
      sequence: '彩色机关的顺序线索藏在其他房间的物品里，把地图上所有 📦 都拾一遍再看「尝试」面板',
      riddle: '谜语答一个关键词就行，想想谜面描述的是什么东西，直接输入' };
    return t[p.type] || '去别的房间找找线索（地图上的 📦 和 🚪 都值得一看）';
  }


  function msg(el, t) { var m = el.querySelector('.zf-escape-msg'); if (m) m.textContent = t || ''; }

  function renderMap(el) {
    if (!level) return;
    var g = level.grid, h = '';
    for (var y = 0; y < g.length; y++) {
      for (var x = 0; x < g[y].length; x++) {
        var c = g[y][x], here = st && st.pos[0] === y && st.pos[1] === x;
        var room = null;
        for (var rid in (level.rooms || {})) if (level.rooms[rid].pos[0] === y && level.rooms[rid].pos[1] === x) room = level.rooms[rid];
        var obj = null;
        for (var oid in (level.objects || {})) if (level.objects[oid].pos[0] === y && level.objects[oid].pos[1] === x && (st.inventory || []).indexOf(oid) < 0) obj = oid;
        var ch = c === '#' ? '🧱' : here ? '🚶' : room ? '🚪' : obj ? '📦' : '·';
        h += '<span style="display:inline-block;width:26px;text-align:center">' + ch + '</span>';
      }
      h += '<br>';
    }
    el.querySelector('.zf-escape-map').innerHTML = h;
  }

  function render(el) {
    var inv = (st && st.inventory || []).map(function (id) { return esc(objName(id)); }).join('、') || '（空）';
    var pz = '';
    if (level) (level.puzzles || []).forEach(function (p) {
      var done = st && st.solved.indexOf(p.id) >= 0;
      pz += '<div style="margin:4px 0">' + (done ? '✅' : '❓') + ' ' + esc(p.question)
        + (done ? '' : ' <button class="zf-escape-solve" data-pid="' + esc(p.id) + '">尝试</button>'
          + ' <span style="color:#8ab4f8;font-size:13px">📍' + esc(roomNameOf(p)) + '（' + esc(dirText(p)) + '）</span>'
          + ' <button class="zf-escape-hint" data-pid="' + esc(p.id) + '" style="margin-left:4px;padding:2px 8px;font-size:12px;background:#2a3242;color:#ffd479;border:1px solid #3a4a66;border-radius:5px;cursor:pointer">?提示</button>') + '</div>';
    });
    el.innerHTML =
      '<div style="flex:1;overflow:auto;padding:12px;font-family:inherit;color:#eee">'
      + '<div style="margin-bottom:8px">难度：<select class="zf-escape-diff"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>'
      + ' <button class="zf-escape-new">开始新的一局</button>'
      + (st && st.finished ? ' <b style="color:#7f7">🎉 逃脱成功！用时 ' + esc(st.elapsed || '') + ' 秒</b>' : '')
      + '</div>'
      + (level ? '<pre class="zf-escape-map" style="margin:0;line-height:1.3;font-size:15px"></pre>'
        + '<div style="margin-top:8px">位置：' + esc(st.pos.join(',')) + '｜步数：' + esc(st.moves)
        + (curRoom() ? '｜📍当前房间：<b>' + esc(curRoom().name) + '</b>' : '') + '</div>'
        + '<div>背包：' + inv + '</div>'
        + '<div style="margin-top:6px">'
        + ['up|↑上', 'down|↓下', 'left|←左', 'right|→右'].map(function (d) { var a = d.split('|'); return '<button class="zf-escape-move" data-dir="' + a[0] + '">' + a[1] + '</button>'; }).join(' ')
        + '<button class="zf-escape-pickup">拾取</button></div>'
        + '<div style="margin-top:8px"><b>谜题：</b>' + pz + '</div>'
        + '<div class="zf-escape-msg" style="margin-top:6px;color:#ffd479"></div>' : '')
      + '</div>';
    renderMap(el);
  }

  function act(body, el, after) {
    api('action', Object.assign({ run_id: runId }, body), function (r) {
      if (!r.ok) { msg(el, r.err || '请求失败'); return; }
      if (r.state) st = r.state;
      if (r.reason) msg(el, r.reason === 'wall' ? '撞墙了，不能往那边走——只沿地图上 · 和 🚪 走，🧱 是墙'
        : r.reason === 'not in puzzle room' ? (r.hint || '你不在该谜题的房间') + (r.puzzle_room_pos && r.puzzle_room_pos.length ? '（📍' + r.puzzle_room_pos.join(',') + '）' : '')
        : r.reason === 'wrong answer' ? (r.type_hint || '答案不对，再想想——可点谜题旁的「提示」按钮查看思路')
        : r.reason);
      else if (r.picked && r.picked.length) msg(el, '拾取：' + r.picked.map(function (o) { return o.name; }).join('、'));
      else if (body.action === 'solve') msg(el, r.solved ? '解开了！' : '答案不对');
      else if (body.action === 'move' && r.moved && r.room) msg(el, '进入：' + r.room.name + (r.room.desc ? '｜' + r.room.desc : ''));
      else msg(el, '');
      render(el); if (after) after(r);
    });
  }

  function openSolve(el, pid) {
    var p = null;
    (level.puzzles || []).forEach(function (x) { if (x.id === pid) p = x; });
    if (!p) return;
    var t = p.type;
    if (t === 'item') solveItem(el, p);
    else if (t === 'code') solveCode(el, p);
    else if (t === 'sequence') solveSequence(el, p);
    else solveRiddle(el, p);
  }

  ZFEscape.onOpen = function (el) {
    el.style.position = 'relative';
    el.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('zf-esc-inv')) {
        closeModal(el);
        act({ action: 'solve', puzzle_id: t.parentElement.dataset.pid, answer: t.dataset.oid }, el);
      } else if (t.classList.contains('zf-escape-new')) {
        var diff = el.querySelector('.zf-escape-diff').value;
        api('new', { difficulty: diff }, function (r) {
          if (!r.ok) { el.innerHTML = '<div style="padding:12px;color:#f88">生成失败：' + esc(r.err) + '</div>'; return; }
          runId = r.run_id; level = r.level; st = r.state; render(el);
        });
      } else if (t.classList.contains('zf-escape-hint')) {
        var pid = t.dataset.pid, hp = null;
        (level.puzzles || []).forEach(function (x) { if (x.id === pid) hp = x; });
        if (hp) msg(el, '?提示｜' + hintText(hp) + '｜房间：' + roomNameOf(hp) + '（' + dirText(hp) + '）');
      } else if (t.classList.contains('zf-escape-move')) act({ action: 'move', dir: t.dataset.dir }, el);
      else if (t.classList.contains('zf-escape-pickup')) act({ action: 'pickup' }, el);
      else if (t.classList.contains('zf-escape-solve')) openSolve(el, t.dataset.pid);
    });
    render(el);
  };
})();
