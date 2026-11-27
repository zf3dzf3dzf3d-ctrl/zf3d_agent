/* zf-app-chess.js — i棋 三合一面板（五子棋/象棋/围棋）
   遵循「一切皆插件」：只 window.ZFDock.register，不改 zf-app-dock.js。
   双副本纪律/缓存号：index.html 引用带 ?v=1，改代码必须 bump。 */
(function () {
  'use strict';

  var ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="4.2"/><circle cx="16.5" cy="16" r="4.2"/><path d="M12 3.2l1.2 2.4 2.6.3-1.9 1.8.5 2.6-2.4-1.3-2.3 1.3.4-2.6-1.9-1.8 2.7-.3z" stroke-width="1.1"/></svg>';

  /* ---------- 状态 ---------- */
  var GAMES = {
    gomoku: { name: '五子棋', rows: 15, cols: 15, colorMe: 1, colorAi: 2 },  // 1=黑(玩家) 2=白(AI)
    cchess: { name: '象棋', rows: 10, cols: 9, colorMe: 1, colorAi: 2 },
    go: { name: '围棋9路', rows: 9, cols: 9, colorMe: 1, colorAi: 2 }         // 1=黑(玩家) 2=白(AI)
  };
  var cur = 'gomoku';
  var board = null;          // 二维数组
  var moves = [];            // 历史
  var goCapturedLast = null; // 围棋上一手提子（劫判定）
  var koPoint = null;
  var busy = false;
  var sel = null;            // 象棋选子状态 {fx,fy}
  var lastMove = null;       // 上一手 {x,y,from?}——虚影高亮用
  var sndOn = true;          // 音效开关
  var ttsOn = false;         // 语音播报开关（默认关，避免吵）
  var panel = null, canvas = null, ctx = null;
  var CELL = 40, PAD = 30;

  /* ---------- 音效（WebAudio，无外部文件） ---------- */
  var AC = null;
  function beep(freq, dur, type, vol) {
    if (!sndOn) return;
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      var o = AC.createOscillator(), gn = AC.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      gn.gain.setValueAtTime(vol || 0.15, AC.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + (dur || 0.12));
      o.connect(gn); gn.connect(AC.destination);
      o.start(); o.stop(AC.currentTime + (dur || 0.12));
    } catch (e) { /* 音频不可用静默 */ }
  }
  var SFX = {
    drop: function () { beep(520, 0.09, 'triangle', 0.2); setTimeout(function(){ beep(380, 0.12, 'sine', 0.15); }, 60); },  // 落子"嗒"
    capture: function () { beep(660, 0.08, 'square', 0.12); setTimeout(function(){ beep(240, 0.18, 'sawtooth', 0.1); }, 70); }, // 提子
    win: function () { [523,659,784,1047].forEach(function(f,i){ setTimeout(function(){ beep(f,0.18,'triangle',0.18); }, i*130); }); },
    lose: function () { [400,320,240].forEach(function(f,i){ setTimeout(function(){ beep(f,0.22,'sine',0.15); }, i*160); }); }
  };
  /* ---------- 语音播报 ---------- */
  function speak(txt) {
    if (!ttsOn) return;
    try {
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(txt);
      u.lang = 'zh-CN'; u.rate = 1.1;
      speechSynthesis.speak(u);
    } catch (e) { /* 静默 */ }
  }

  /* ---------- 棋盘初始化 ---------- */
  function newBoard(game) {
    var g = GAMES[game];
    var b = [];
    for (var y = 0; y < g.rows; y++) { var row = []; for (var x = 0; x < g.cols; x++) row.push(0); b.push(row); }
    if (game === 'cchess') b = null; // 象棋由后端初始盘返回? 无状态——前端自己摆
    return b;
  }

  var CC_INIT = [
    [21,22,23,22,21,22,23,22,21],
    [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [ 0,26, 0, 0, 0, 0, 0,26, 0],
    [27, 0,27, 0,27, 0,27, 0,27],
    [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [17, 0,17, 0,17, 0,17, 0,17],
    [ 0,16, 0, 0, 0, 0, 0,16, 0],
    [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [11,12,13,12,11,12,13,12,11]
  ];
  /* 与后端 cchess.initial_board 一致: 车马象士帅士象马车
     但后端 bottom 是 [11,12,13,12,11,...]? 前端以 (row0=黑上, row9=红下) 一致即可 */

  var CC_NAME = { 11:'帅',12:'士',13:'相',14:'马',15:'车',16:'炮',17:'兵',21:'将',22:'士',23:'象',24:'马',25:'车',26:'炮',27:'卒' };

  function reset() {
    var g = GAMES[cur];
    if (cur === 'cchess') {
      board = [
        [25,24,23,22,21,22,23,24,25],
        [0,0,0,0,0,0,0,0,0],
        [0,26,0,0,0,0,0,26,0],
        [27,0,27,0,27,0,27,0,27],
        [0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0],
        [17,0,17,0,17,0,17,0,17],
        [0,16,0,0,0,0,0,16,0],
        [0,0,0,0,0,0,0,0,0],
        [15,14,13,12,11,12,13,14,15]
      ];
      /* 注意: 后端红方编码 11..17（1帅2士3象4马5车6炮7兵），黑方 21..27
         底线应为 车马象士帅士象马车 = 15,14,13,12,11,12,13,14,15 */
    } else {
      board = [];
      for (var y = 0; y < g.rows; y++) {
        var row = [];
        for (var x = 0; x < g.cols; x++) row.push(0);
        board.push(row);
      }
    }
    moves = []; koPoint = null; goCapturedLast = null; busy = false; sel = null; lastMove = null;
    setStatus(cur === 'cchess' ? '你执红先行，先点自己的棋子再点目标位置' : '你执黑先行，点击棋盘落子');
    draw();
  }

  /* ---------- 渲染 ---------- */
  function setStatus(s) { var el = document.getElementById('zfch-status'); if (el) el.textContent = s; }

  function draw() {
    if (!ctx) return;
    var g = GAMES[cur];
    var W = PAD * 2 + CELL * (g.cols - 1), H = PAD * 2 + CELL * (g.rows - 1);
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = '#e8c88f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#7a5a2b'; ctx.lineWidth = 1;
    var i, p;
    for (i = 0; i < g.rows; i++) {
      ctx.beginPath(); ctx.moveTo(PAD, PAD + i * CELL); ctx.lineTo(PAD + (g.cols - 1) * CELL, PAD + i * CELL); ctx.stroke();
    }
    for (i = 0; i < g.cols; i++) {
      ctx.beginPath(); ctx.moveTo(PAD + i * CELL, PAD); ctx.lineTo(PAD + i * CELL, PAD + (g.rows - 1) * CELL); ctx.stroke();
    }
    // 星位
    var stars = cur === 'gomoku' ? [[7,7],[3,3],[11,11],[3,11],[11,3]] : (cur === 'go' ? [[2,2],[6,2],[2,6],[6,6],[4,4]] : []);
    ctx.fillStyle = '#7a5a2b';
    stars.forEach(function (s) { ctx.beginPath(); ctx.arc(PAD + s[0] * CELL, PAD + s[1] * CELL, 3, 0, 7); ctx.fill(); });

    // 棋子（象棋 11..17红 21..27黑；五子棋/围棋 1=黑 2=白）
    for (var y = 0; y < board.length; y++) {
      for (var x = 0; x < board[y].length; x++) {
        var v = board[y][x];
        if (!v) continue;
        if (cur === 'cchess') drawStone(x, y, v >= 21 ? '#111' : '#fff', v >= 21);
        else drawStone(x, y, v === 1 ? '#111' : '#fff', v === 1);
      }
    }
    // 象棋字
    if (cur === 'cchess') {
      var CH = { 11:'帥',12:'士',13:'相',14:'馬',15:'車',16:'炮',17:'兵',21:'將',22:'士',23:'象',24:'馬',25:'車',26:'炮',27:'卒' };
      ctx.font = 'bold 22px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var yy = 0; yy < board.length; yy++) for (var xx = 0; xx < 9; xx++) {
        var p2 = board[yy][xx];
        if (!p2) continue;
        ctx.fillStyle = p2 >= 21 ? '#f2f2f2' : '#c03030';
        // 黑子浅字（底色#111）红子红字（底色白），保证可读
        ctx.fillText(CH[p2] || '?', PAD + xx * CELL, PAD + yy * CELL);
      }
    }
    // 上一手虚影高亮（AI/玩家最近一手，环形虚线圈 + 起点虚影框）
    if (lastMove) {
      ctx.save();
      ctx.strokeStyle = 'rgba(230,60,60,.85)'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(PAD + lastMove.x * CELL, PAD + lastMove.y * CELL, CELL * 0.5, 0, 7); ctx.stroke();
      if (lastMove.from) { // 象棋：起点也画虚影框，看清从哪走到哪
        ctx.strokeStyle = 'rgba(230,60,60,.45)';
        ctx.beginPath(); ctx.arc(PAD + lastMove.from[0] * CELL, PAD + lastMove.from[1] * CELL, CELL * 0.3, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawStone(x, y, fill, dark) {
    var cx = PAD + x * CELL, cy = PAD + y * CELL;
    ctx.beginPath(); ctx.arc(cx, cy, CELL * 0.42, 0, 7);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = dark ? '#000' : '#888'; ctx.stroke();
  }

  /* ---------- 交互 ---------- */
  function onClick(ev) {
    if (busy) return;
    var rect = canvas.getBoundingClientRect();
    var mx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    var my = (ev.clientY - rect.top) * (canvas.height / rect.height);
    var x = Math.round((mx - PAD) / CELL), y = Math.round((my - PAD) / CELL);
    var g = GAMES[cur];
    if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return;
    if (busy) { return; }

    if (cur === 'cchess') {
      // 象棋：两段交互——先选己方子，再点目标
      var v = board[y][x];
      var mine = v >= 1 && v <= 17; // 红方 11..17（兵17含）
      if (sel && !(x === sel.fx && y === sel.fy)) {
        var mv0 = [sel.fx, sel.fy, x, y];
        if (v >= 1 && v <= 17) { sel = { fx: x, fy: y }; draw(); setStatus('已选 ' + x + ',' + y + '，再点目标'); return; }
        moves.push(mv0);
        var from = board[sel.fy][sel.fx];
        var capturedC = board[y][x];
        board[sel.fy][sel.fx] = 0; board[y][x] = from;
        sel = null;
        lastMove = { x: x, y: y, from: [mv0[0], mv0[1]] };
        if (capturedC) { SFX.capture(); speak('吃' + (CC_NAME[capturedC] || '子')); } else { SFX.drop(); speak((CC_NAME[from] || '') + '，走'); }
        draw();
        aiGo();
        return;
      }
      if (mine) { sel = { fx: x, fy: y }; draw(); setStatus('已选 (' + x + ',' + y + ')，点目标位置走子'); }
      else { setStatus('请先点自己的红棋子'); }
      return;
    }
    if (board[y][x] !== 0) return;
    if (cur === 'go' && koPoint && x === koPoint[0] && y === koPoint[1]) { setStatus('劫争：此处暂不可立即回提'); return; }

    var myColor = g.colorMe;
    if (cur === 'go') {
      board[y][x] = myColor;
      moves.push({ x: x, y: y, color: myColor, captured: null });
      lastMove = { x: x, y: y };
      SFX.drop(); speak('围棋，我落在' + x + '列' + y + '行');
      draw();
      aiGo();
    } else {
      board[y][x] = myColor;
      moves.push([x, y, x, y]);
      lastMove = { x: x, y: y };
      SFX.drop();
      draw();
      if (gomokuWin(board, x, y, myColor)) { setStatus('你赢了！🎉 点「新对局」再来'); SFX.win(); speak('恭喜，你赢了'); return; }
      aiGo();
    }
  }

  function undoLast() {
    // 回滚最后一手（象棋 AI 拒绝着法时用）
    var lm = moves.pop();
    if (!lm || lm.length !== 4) return;
    var fx = lm[0], fy = lm[1], tx = lm[2], ty = lm[3];
    board[fy][fx] = board[ty][tx];
    board[ty][tx] = 0;
    draw();
  }

  function gomokuWin(b, x, y, s) {
    var dirs = [[1,0],[0,1],[1,1],[1,-1]];
    for (var d = 0; d < 4; d++) {
      var c = 1;
      for (var k = 1; k < 5; k++) { var nx = x + dirs[d][0]*k, ny = y + dirs[d][1]*k; if (nx<0||ny<0||nx>=15||ny>=15||b[ny][nx]!==s) break; c++; }
      for (k = 1; k < 5; k++) { nx = x - dirs[d][0]*k; ny = y - dirs[d][1]*k; if (nx<0||ny<0||nx>=15||ny>=15||b[ny][nx]!==s) break; c++; }
      if (c >= 5) return true;
    }
    return false;
  }

  function aiGo() {
    busy = true; setStatus('AI 思考中…');
    var payload = {
      game: cur, side: GAMES[cur].colorAi, difficulty: 2,
      board: board, moves: moves
    };
    fetch('/api/chess/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (res) {
      busy = false;
      if (!res.ok) { setStatus('AI 出错: ' + (res.err || '?')); if (cur === 'cchess' && moves.length) { undoLast(); } return; }
      var m = res.move;
      if (!m) { setStatus(res.pass ? 'AI 停一手' : 'AI 无着可走，你赢了！🎉'); return; }
      if (cur === 'go') {
        // 前端本地提子渲染（后端 best_move 只回坐标）
        var gx = m[0], gy = m[1];
        board[gy][gx] = GAMES.go.colorAi;
        var captured = captureGo(gx, gy, GAMES.go.colorAi);
        moves.push({ x: gx, y: gy, color: GAMES.go.colorAi, captured: captured });
        koPoint = (captured && captured.length === 1) ? [captured[0][0], captured[0][1]] : null;
        lastMove = { x: gx, y: gy };
        if (captured && captured.length) { SFX.capture(); speak('围棋提子' + captured.length + '枚'); } else { SFX.drop(); speak('围棋，第' + (Math.ceil(moves.length / 2)) + '手'); }
        draw();
        setStatus('AI 已落子，请继续');
      } else if (cur === 'gomoku') {
        // 五子棋：move = [x, y]
        var px = m[0], py = m[1];
        board[py][px] = GAMES.gomoku.colorAi;
        moves.push([px, py, px, py]);
        lastMove = { x: px, y: py };
        SFX.drop(); speak('五子棋，AI落在' + px + '列' + py + '行');
        draw();
        if (gomokuWin(board, px, py, GAMES.gomoku.colorAi)) { setStatus('AI 五连，你输了。点「新对局」再战'); SFX.lose(); speak('AI五连，你输了'); return; }
        setStatus('AI 已落子，请继续');
      } else {
        // 象棋：move = [fx, fy, tx, ty]
        var fx = m[0], fy = m[1], tx = m[2], ty = m[3];
        if (fx == null || fy == null || tx == null || ty == null) { setStatus('AI 着法格式异常'); return; }
        var piece = board[fy][fx];
        board[fy][fx] = 0; board[ty][tx] = piece;
        moves.push([fx, fy, tx, ty]);
        lastMove = { x: tx, y: ty, from: [fx, fy] };
        if (board[ty][tx] && piece) { SFX.drop(); speak('象棋，AI走' + (CC_NAME[piece] || '子') + '，到' + tx + '列' + ty + '行'); }
        draw();
        setStatus('AI 已应招，请走子');
      }
    }).catch(function (e) {
      busy = false;
      setStatus('网络错误（断网也可单机玩，AI 应招需服务在线）: ' + e);
    });
  }

  function captureGo(x, y, color) {
    // 简化：落子后检查相邻敌群气数，为0则提
    var opp = 3 - color, captured = [];
    var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    dirs.forEach(function (d) {
      var nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= 9 || ny >= 9 || board[ny][nx] !== opp) return;
      var seen = {}, stack = [[nx, ny]], libs = 0, grp = [];
      while (stack.length) {
        var c = stack.pop(), key = c[0] + ',' + c[1];
        if (seen[key]) continue;
        seen[key] = 1; grp.push(c);
        dirs.forEach(function (d2) {
          var ax = c[0] + d2[0], ay = c[1] + d2[1];
          if (ax < 0 || ay < 0 || ax >= 9 || ay >= 9) return;
          if (board[ay][ax] === 0) libs++;
          else if (board[ay][ax] === opp && !seen[ax + ',' + ay]) stack.push([ax, ay]);
        });
      }
      if (libs === 0) grp.forEach(function (p) { board[p[1]][p[0]] = 0; captured.push(p); });
    });
    return captured;
  }

  /* ---------- 面板 ---------- */
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'zf-chess-panel';
    panel.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;background:#fdf6e3;border:2px solid #7a5a2b;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,.45);padding:14px 16px;display:none;user-select:none;';
    panel.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
        '<b style="font-size:15px;">♟ i棋</b>' +
        ['gomoku', 'cchess', 'go'].map(function (k) {
          return '<button data-g="' + k + '" class="zfch-tab" style="padding:3px 10px;border-radius:6px;border:1px solid #7a5a2b;background:#fff;cursor:pointer;">' + GAMES[k].name + '</button>';
        }).join('') +
        '<span style="flex:1"></span>' +
        '<button id="zfch-new" style="padding:3px 10px;border-radius:6px;border:1px solid #7a5a2b;background:#fff;cursor:pointer;">新对局</button>' +
        '<button id="zfch-snd" title="落子音效开关" style="padding:3px 8px;border-radius:6px;border:1px solid #7a5a2b;background:#fff;cursor:pointer;">🔊</button>' +
        '<button id="zfch-tts" title="语音播报开关" style="padding:3px 8px;border-radius:6px;border:1px solid #7a5a2b;background:#fff;cursor:pointer;">📢</button>' +
        '<button id="zfch-close" style="padding:3px 10px;border-radius:6px;border:1px solid #999;background:#eee;cursor:pointer;">✕</button>' +
      '</div>' +
      '<canvas id="zfch-canvas" style="border-radius:6px;cursor:pointer;display:block;"></canvas>' +
      '<div id="zfch-status" style="margin-top:8px;font-size:13px;color:#55402a;"></div>';
    document.body.appendChild(panel);
    canvas = document.getElementById('zfch-canvas');
    ctx = canvas.getContext('2d');
    canvas.addEventListener('click', onClick);
    document.getElementById('zfch-close').onclick = function () { panel.style.display = 'none'; };
    document.getElementById('zfch-new').onclick = reset;
    var sndBtn = document.getElementById('zfch-snd'), ttsBtn = document.getElementById('zfch-tts');
    function refreshBtns() {
      sndBtn.textContent = sndOn ? '🔊' : '🔇';
      sndBtn.style.background = sndOn ? '#ffe9b8' : '#eee';
      ttsBtn.textContent = ttsOn ? '📢开' : '📢关';
      ttsBtn.style.background = ttsOn ? '#ffe9b8' : '#fff';
    }
    sndBtn.onclick = function () { sndOn = !sndOn; refreshBtns(); if (sndOn) SFX.drop(); };
    ttsBtn.onclick = function () { ttsOn = !ttsOn; refreshBtns(); if (ttsOn) speak('语音播报已开启'); };
    refreshBtns();
    Array.prototype.forEach.call(panel.querySelectorAll('.zfch-tab'), function (btn) {
      btn.onclick = function () { cur = btn.getAttribute('data-g'); reset(); };
    });
    return panel;
  }

  function open() {
    ensurePanel();
    if (panel.style.display !== 'block') { reset(); }
    panel.style.display = 'block';
  }

  /* ---------- Dock 注册（缺席重试） ---------- */
  function register() {
    if (!window.ZFDock || typeof window.ZFDock.register !== 'function') return false;
    ZFDock.register({ id: 'zf-app-chess', name: 'i棋', icon: ICON, onClick: open });
    return true;
  }
  if (!register()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (register() || tries > 50) clearInterval(timer);
    }, 200);
  }
})();
