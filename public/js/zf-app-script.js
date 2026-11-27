/* ============================================================
 * zf-app-script.js - i剧本杀 前端插件（P1.5，2026-11-21）
 * 依策划案 v2.2（手写本单机局 MVP）实施：
 *  流程：选本 → 领角色 → 开场 → 搜证（线索归属制）→ 讨论（预写台词）
 *        → 投票 → 复盘（程序判凶，LLM 不当裁判）
 *  对接：GET /api/script/list、POST /api/script/start、
 *        POST /api/script/secret、POST /api/script/vote
 *  注册：window.ZFDock.register（一切皆插件，零改 zf-app-dock.js 冻结区）
 * ============================================================ */
(function () {
  'use strict';

  var ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';

  var api = function (url, body, cb) {
    fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); })
      .then(function (j) { cb(j); })
      .catch(function (e) { cb({ ok: false, err: String(e) }); });
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(msg) { if (window.showToast) showToast(msg, 'warn'); }

  /* ---------- 全局局状态（单机局，内存即存档） ---------- */
  var sess = null;      // /api/script/start 返回的公开 session
  var bookId = null;
  var myChar = null;    // 我领的角色 id
  var mySecret = null;  // 我的隐藏剧本
  var foundClues = {};  // clueId -> {name, desc}
  var sayLog = [];      // 讨论记录 [{who, text}]
  var voted = false;

  function reset() {
    sess = null; bookId = null; myChar = null; mySecret = null;
    foundClues = {}; sayLog = []; voted = false;
  }

  function charName(id) {
    if (!sess) return id;
    var c = sess.characters.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }

  /* ---------- 视图渲染 ---------- */
  function render(el) {
    if (!sess) return viewList(el);
    if (voted) return viewResult(el);
    if (!myChar) return viewPick(el);
    return viewPlay(el);
  }

  /* —— ① 选本 —— */
  function viewList(el) {
    el.innerHTML = '<div style="flex:1;overflow:auto;padding:14px;color:#dde">'
      + '<div style="font-size:15px;font-weight:bold;color:#fff;margin-bottom:10px">🎭 i剧本杀 · 选一个本子</div>'
      + '<div id="zfScriptBooks" style="color:#99a">正在加载书架…</div>'
      + '<div style="margin-top:16px;border-top:1px dashed #3a4a66;padding-top:12px">'
      + '<div style="font-weight:bold;color:#fff;margin-bottom:6px">✨ AI 生成新本</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<input id="zfAiTheme" placeholder="主题，如：雪山客栈、校园怪谈…" style="flex:1;min-width:180px;padding:8px;background:#12161f;color:#dde;border:1px solid #3a4a66;border-radius:6px"/>'
      + '<button id="zfAiGen" style="padding:8px 16px;background:#a63;border:none;border-radius:6px;color:#fff;cursor:pointer">生成本子</button></div>'
      + '<div id="zfAiMsg" style="font-size:12px;color:#897;margin-top:6px"></div></div></div>';
    api('/api/script/list', null, function (j) {
      var box = el.querySelector('#zfScriptBooks');
      if (!box) return;
      if (!j.ok || !j.books.length) {
        box.innerHTML = '<div style="color:#e88">书架空：' + esc(j.err || '无剧本') + '</div>';
        return;
      }
      box.innerHTML = j.books.map(function (b) {
        return '<div class="zf-script-book" data-id="' + esc(b.id) + '" style="border:1px solid #3a4a66;border-radius:10px;padding:12px;margin-bottom:10px;cursor:pointer;background:#1e2430">'
          + '<div style="font-weight:bold;color:#fff">' + esc(b.title) + '</div>'
          + '<div style="font-size:12px;color:#8fa;margin-top:4px">人数 ' + (b.player_count ? b.player_count.join('~') : '?') + ' 人</div>'
          + '</div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.zf-script-book'), function (d) {
        d.onclick = function () { startBook(el, d.getAttribute('data-id')); };
      });
      var gbtn = el.querySelector('#zfAiGen');
      if (gbtn) gbtn.onclick = function () {
        var theme = (el.querySelector('#zfAiTheme').value || '').trim();
        var msg = el.querySelector('#zfAiMsg');
        if (!theme) { msg.textContent = '请先输入主题'; return; }
        gbtn.disabled = true; msg.style.color = '#8ad'; msg.textContent = 'AI 正在写本（含推凶链校验，约 10~30 秒）…';
        api('/api/script/gen', { theme: theme }, function (j) {
          gbtn.disabled = false;
          if (!j.ok) { msg.style.color = '#e88'; msg.textContent = '生成失败：' + (j.err || '?'); return; }
          if (j.source === 'template') msg.style.color = '#da8';
          else msg.style.color = '#8a8';
          msg.textContent = j.source === 'template'
            ? 'AI 本未过校验，已降级为模板拼装本《' + j.book.title + '》，可直接游玩'
            : 'AI 本《' + j.book.title + '》已生成并通过推凶链校验';
          // AI 本不落书架刷新，直接把 book 注入开局（AI 本走内存局）
          reset(); bookId = j.book.id; sess = j.book; myChar = null;
          render(el);
        });
      };
    });
  }

  function startBook(el, id) {
    api('/api/script/start', { book: id }, function (j) {
      if (!j.ok) { toast('开局失败：' + (j.err || '?')); return; }
      reset(); bookId = id; sess = j.session;
      render(el);
    });
  }

  /* —— ② 领角色（含查看自己的隐藏剧本） —— */
  function viewPick(el) {
    var chars = sess.characters.filter(function (c) { return !c.is_victim; });
    el.innerHTML = '<div style="flex:1;overflow:auto;padding:14px;color:#dde">'
      + '<div style="font-size:15px;font-weight:bold;color:#fff">🎭 ' + esc(sess.title) + '</div>'
      + '<div style="margin:10px 0;padding:10px;border:1px dashed #3a4a66;border-radius:8px;background:#181d28;font-size:13px;line-height:1.7;color:#bbc">'
      + '<b style="color:#fff">【案情】</b>' + esc(sess.intro)
      + '<br><b style="color:#fff">【背景】</b>' + esc(sess.background) + '</div>'
      + '<div style="font-weight:bold;margin-bottom:8px">选择你扮演的角色（每人只看自己的剧本）：</div>'
      + chars.map(function (c) {
        return '<div class="zf-script-pick" data-id="' + esc(c.id) + '" style="border:1px solid #3a4a66;border-radius:8px;padding:10px;margin-bottom:8px;cursor:pointer;background:#1e2430">'
          + '<b style="color:#fff">' + esc(c.name) + '</b>'
          + '<div style="font-size:12px;color:#9ab;margin-top:3px">' + esc(c.persona) + '</div></div>';
      }).join('')
      + '<div id="zfScriptSecret" style="margin-top:12px"></div>'
      + '<div style="margin-top:14px"><button id="zfScriptBegin" style="display:none;padding:8px 20px;background:#3a7;border:none;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer">开始搜证 →</button></div>'
      + '</div>';
    Array.prototype.forEach.call(el.querySelectorAll('.zf-script-pick'), function (d) {
      d.onclick = function () {
        myChar = d.getAttribute('data-id');
        Array.prototype.forEach.call(el.querySelectorAll('.zf-script-pick'), function (x) {
          x.style.borderColor = '#3a4a66';
        });
        d.style.borderColor = '#3a7';
        var box = el.querySelector('#zfScriptSecret');
        api('/api/script/secret', { book: bookId, char: myChar }, function (j) {
          if (!j.ok) { box.innerHTML = '<span style="color:#e88">剧本加载失败</span>'; return; }
          mySecret = j;
          box.innerHTML = '<div style="border:1px solid #a63;border-radius:8px;padding:10px;background:#2a1e18;font-size:13px;line-height:1.7;color:#ecd">'
            + '<b style="color:#fa6">📖 你的剧本（' + esc(j.name) + '）' + (j.is_murderer ? ' ⚠️ 你是凶手' : '') + '</b>'
            + '<div style="margin-top:6px">' + esc(j.secret) + '</div>'
            + (j.prewritten && j.prewritten.length
              ? '<div style="margin-top:6px;color:#da8">讨论阶段可照读的台词：<br>'
                + j.prewritten.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') + '</div>'
              : '')
            + '</div>';
          var btn = el.querySelector('#zfScriptBegin');
          if (btn) btn.style.display = 'inline-block';
        });
      };
    });
    var begin = el.querySelector('#zfScriptBegin');
    if (begin) begin.onclick = function () { render(el); };
  }

  /* —— ③ 搜证 + 讨论 —— */
  function viewPlay(el) {
    var sceneBtns = sess.scenes.map(function (sc) {
      var spotClues = sess.clues.filter(function (cl) {
        return sc.spots.indexOf(cl.spot) >= 0;
      });
      return '<div style="border:1px solid #3a4a66;border-radius:8px;padding:10px;margin-bottom:8px;background:#1e2430">'
        + '<b style="color:#fff">' + esc(sc.name) + '</b>'
        + '<div style="font-size:12px;color:#9ab;margin:4px 0">' + esc(sc.desc) + '</div>'
        + spotClues.map(function (cl) {
          var got = !!foundClues[cl.id];
          return '<button class="zf-script-clue" data-id="' + esc(cl.id) + '" style="margin:3px 4px 0 0;padding:4px 10px;'
            + (got ? 'background:#274;border-color:#3a7;color:#8f8' : 'background:#2a3242;color:#ccd')
            + ';border:1px solid #3a4a66;border-radius:6px;font-size:12px;cursor:pointer">'
            + (got ? '✓ ' : '🔍 ') + esc(cl.name) + '</button>';
        }).join('')
        + '</div>';
    }).join('');

    var myClues = Object.keys(foundClues).map(function (k) { return foundClues[k]; });
    var saysHtml = sayLog.map(function (s) {
      return '<div style="margin-bottom:4px"><b style="color:#fff">' + esc(s.who) + '：</b><span style="color:#ccd">' + esc(s.text) + '</span></div>';
    }).join('') || '<span style="color:#667">（还没有人发言）</span>';

    el.innerHTML = '<div style="flex:1;overflow:auto;padding:14px;color:#dde">'
      + '<div style="font-size:15px;font-weight:bold;color:#fff">🎭 ' + esc(sess.title)
      + ' · 我扮演 <span style="color:#3a7">' + esc(charName(myChar)) + '</span></div>'
      + '<div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:260px">'
      + '<div style="font-weight:bold;margin-bottom:6px">🔎 搜证</div>' + sceneBtns
      + '<div style="font-weight:bold;margin:10px 0 6px">🗂 我的线索（' + myClues.length + '）</div>'
      + (myClues.length
        ? '<div style="font-size:12px;color:#bcd;line-height:1.7">' + myClues.map(function (c) {
            return '• <b>' + esc(c.name) + '</b>：' + esc(c.desc);
          }).join('<br>') + '</div>'
        : '<div style="font-size:12px;color:#667">点击各场景的 🔍 按钮搜集线索</div>')
      + '</div>'
      + '<div style="flex:1;min-width:260px">'
      + '<div style="font-weight:bold;margin-bottom:6px">💬 讨论（逐个角色照读台词/自由发言）</div>'
      + '<div style="border:1px solid #3a4a66;border-radius:8px;padding:10px;background:#181d28;font-size:13px;max-height:180px;overflow:auto" id="zfScriptLog">' + saysHtml + '</div>'
      + '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">'
      + sess.characters.filter(function (c) { return !c.is_victim; }).map(function (c) {
        return '<button class="zf-script-say" data-id="' + esc(c.id) + '" style="padding:4px 10px;background:#2a3242;color:#ccd;border:1px solid #3a4a66;border-radius:6px;font-size:12px;cursor:pointer">' + esc(c.name.split('（')[0]) + '发言</button>';
      }).join('')
      + '</div>'
      + '<div style="margin-top:10px"><button id="zfScriptVote" style="padding:8px 18px;background:#c63;border:none;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer">⚖️ 进入投票</button></div>'
      + '</div></div></div>';

    Array.prototype.forEach.call(el.querySelectorAll('.zf-script-clue'), function (b) {
      b.onclick = function () {
        var cid = b.getAttribute('data-id');
        var cl = sess.clues.filter(function (x) { return x.id === cid; })[0];
        if (cl && !foundClues[cid]) { foundClues[cid] = { name: cl.name, desc: cl.desc }; render(el); }
      };
    });
    Array.prototype.forEach.call(el.querySelectorAll('.zf-script-say'), function (b) {
      b.onclick = function () { viewAsk(el, b.getAttribute('data-id')); };
    });
    var vbtn = el.querySelector('#zfScriptVote');
    if (vbtn) vbtn.onclick = function () { viewVote(el); };
  }

  /* —— ③.5 AI 问 NPC（P2：每问独立裁剪，服务端防泄底） —— */
  function viewAsk(el, cid) {
    el.innerHTML = '<div style="flex:1;overflow:auto;padding:14px;color:#dde">'
      + '<div style="font-size:15px;font-weight:bold;color:#fff">💬 质询 ' + esc(charName(cid)) + '</div>'
      + '<div style="margin:10px 0;color:#9ab;font-size:12px">向这个角色提问（AI 扮演，不知道的会如实说不知道）'
      + '<button id="zfAskBack" style="float:right;padding:4px 12px;background:#2a3242;color:#ccd;border:1px solid #3a4a66;border-radius:6px;cursor:pointer;font-size:12px">← 返回</button></div>'
      + '<div id="zfAskLog" style="border:1px solid #3a4a66;border-radius:8px;padding:10px;background:#181d28;font-size:13px;max-height:220px;overflow:auto">（还没有问答）</div>'
      + '<div style="margin-top:10px;display:flex;gap:6px">'
      + '<input id="zfAskInput" placeholder="例如：案发时你在哪里？" style="flex:1;padding:8px;background:#12161f;color:#dde;border:1px solid #3a4a66;border-radius:6px"/>'
      + '<button id="zfAskGo" style="padding:8px 16px;background:#36c;border:none;border-radius:6px;color:#fff;cursor:pointer">问</button></div>'
      + '</div>';
    var log = [];
    var logEl = el.querySelector('#zfAskLog');
    function drawLog() {
      logEl.innerHTML = log.map(function (m) {
        return '<div style="margin-bottom:6px"><b style="color:'
          + (m.who === '我' ? '#3a7' : '#fff') + '">' + esc(m.who) + '：</b>'
          + '<span style="color:#ccd">' + esc(m.text) + '</span>'
          + (m.fb ? ' <span style="color:#877;font-size:11px">（降级台词）</span>' : '')
          + '</div>';
      }).join('') || '（还没有问答）';
      logEl.scrollTop = logEl.scrollHeight;
    }
    function ask() {
      var inp = el.querySelector('#zfAskInput');
      var q = (inp.value || '').trim();
      if (!q) return;
      inp.value = '';
      log.push({ who: '我', text: q });
      drawLog();
      log.push({ who: charName(cid), text: '……思考中……' });
      drawLog();
      api('/api/script/ask', { book: bookId, char: cid, question: q }, function (j) {
        log.pop();
        if (!j.ok) { log.push({ who: '系统', text: '质询失败：' + (j.err || '?') }); }
        else { log.push({ who: charName(cid), text: j.text, fb: j.mode === 'fallback' });
          sayLog.push({ who: charName(cid) + '（被质询）', text: j.text }); }
        drawLog();
      });
    }
    el.querySelector('#zfAskGo').onclick = ask;
    el.querySelector('#zfAskInput').onkeydown = function (e) { if (e.key === 'Enter') ask(); };
    el.querySelector('#zfAskBack').onclick = function () { render(el); };
  }

  /* —— ④ 投票 —— */
  function viewVote(el) {
    var cands = sess.characters.filter(function (c) { return !c.is_victim; });
    el.innerHTML = '<div style="flex:1;overflow:auto;padding:14px;color:#dde">'
      + '<div style="font-size:15px;font-weight:bold;color:#fff">⚖️ 指认凶手</div>'
      + '<div style="margin:8px 0;color:#9ab;font-size:13px">点击你认为是凶手的人物（单机局 1 票即过半）：'
      + '<button id="zfScriptBack" style="float:right;padding:4px 12px;background:#2a3242;color:#ccd;border:1px solid #3a4a66;border-radius:6px;cursor:pointer;font-size:12px">← 回到讨论</button></div>'
      + cands.map(function (c) {
        return '<div class="zf-script-vote" data-id="' + esc(c.id) + '" style="border:1px solid #3a4a66;border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;background:#1e2430">'
          + '<b style="color:#fff">' + esc(c.name) + '</b>'
          + '<div style="font-size:12px;color:#9ab;margin-top:3px">' + esc(c.persona) + '</div></div>';
      }).join('') + '</div>';
    var back = el.querySelector('#zfScriptBack');
    if (back) back.onclick = function () { render(el); };
    Array.prototype.forEach.call(el.querySelectorAll('.zf-script-vote'), function (d) {
      d.onclick = function () {
        var vid = d.getAttribute('data-id');
        api('/api/script/vote', { book: bookId, votes: [vid] }, function (j) {
          if (!j.ok) { toast('投票失败：' + (j.err || '?')); return; }
          voted = true;
          sess._verdict = j;
          render(el);
        });
      };
    });
  }

  /* —— ⑤ 复盘 —— */
  function viewResult(el) {
    var v = sess._verdict;
    var murdererId = v.murderer;
    var fullChain = Object.keys(foundClues).length >= 4; /* 简化：线索≥4 视为链完整 */
    var quality = v.hit ? (fullChain ? '完整胜利 🏆' : '低质量胜利（0.5）：投中但复盘链不完整') : '';
    el.innerHTML = '<div style="flex:1;overflow:auto;padding:14px;color:#dde">'
      + '<div style="font-size:16px;font-weight:bold;color:' + (v.hit ? '#3d8' : '#e55') + '">'
      + (v.hit ? '🎉 投中！凶手正是 ' + esc(charName(murdererId)) : '😤 凶手逃脱——真凶是 ' + esc(charName(murdererId)))
      + '</div>'
      + (v.hit ? '<div style="margin:8px 0;color:#da8;font-size:13px">' + esc(quality) + '</div>' : '')
      + '<div style="margin-top:10px;font-weight:bold;color:#fff">📖 真相复盘</div>'
      + '<div style="margin-top:6px;border:1px solid #3a4a66;border-radius:8px;padding:10px;background:#181d28;font-size:13px;line-height:1.8">'
      + '<b style="color:#fa6">' + esc(charName(murdererId)) + '：</b>'
      + (mySecret && mySecret.is_murderer
        ? '你自己的隐藏剧本里有完整作案手法（见你的剧本）。'
        : '重新翻开凶手视角（本机单机局，复盘后可见）：')
      + '</div>'
      + '<div style="margin-top:10px"><b style="color:#fff">票型：</b>'
      + Object.keys(v.tally).map(function (k) {
        return esc(charName(k)) + ' × ' + v.tally[k];
      }).join('、') + '</div>'
      + '<div style="margin-top:14px"><button id="zfScriptAgain" style="padding:8px 20px;background:#3a7;border:none;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer">再开一局</button></div>'
      + '</div>';
    var again = el.querySelector('#zfScriptAgain');
    if (again) again.onclick = function () { reset(); render(el); };
  }

  /* ---------- 窗口 + Dock 注册（一切皆插件） ---------- */
  var win = null;
  function openApp() {
    if (!win) {
      win = window.ZFDock.createAppWindow({
        id: 'zfScriptWin',
        title: 'i剧本杀',
        icon: ICON,
        bodyHtml: '<div id="zfScriptBody" style="flex:1;overflow:hidden;display:flex"></div>',
        onClose: function (w) { w.classList.remove('open'); }
      });
      document.body.appendChild(win);
    }
    win.classList.add('open');
    var body = win.querySelector('#zfScriptBody');
    if (body) render(body);
  }

  function tryReg() {
    if (!window.ZFDock || !window.ZFDock.register) { setTimeout(tryReg, 500); return; }
    window.ZFDock.register({
      id: 'script-app',
      name: 'i剧本杀',
      icon: ICON,
      onClick: function () {
        if (win && win.classList.contains('open')) win.classList.remove('open');
        else openApp();
      }
    });
  }
  tryReg();
})();
