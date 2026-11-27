/* ---------- i音乐 (ZFMusic) ----------
 * 搜索(网易云元数据) -> 播放(B站转MP3流/本地文件)
 * 收藏/最近播放走 localStorage
 * 依赖 dock: createAppWindow / openMusic()
 */
(function () {
  'use strict';
  var LS_FAV = 'zf_music_favs';
  var LS_HIS = 'zf_music_history';
  var LS_QUEUE = 'zf_music_queue'; // 【M1】播放队列持久化（只存元数据+bvid，不存 url）

  function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var state = {
    kw: '', songs: [], tab: 'search', // search|fav|local
    cur: null, audio: null, playing: false
  };

  var $body = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function favs() { return lsGet(LS_FAV, []); }
  function isFav(id) { return favs().some(function (f) { return f.id === id; }); }
  function toggleFav(song) {
    var arr = favs();
    var i = arr.findIndex(function (f) { return f.id === song.id; });
    if (i >= 0) arr.splice(i, 1); else arr.push(song);
    lsSet(LS_FAV, arr);
  }
  function pushHis(song) {
    var arr = lsGet(LS_HIS, []).filter(function (s) { return s.id !== song.id; });
    arr.unshift(song); arr = arr.slice(0, 50);
    lsSet(LS_HIS, arr);
  }

  // ---------- 播放队列【M1】 ----------
  // 只存元数据（name/artist/id/bvid），不存 url（bstream url 可能过期/失效）
  function queue() { return lsGet(LS_QUEUE, []); }
  function setQueue(arr) { lsSet(LS_QUEUE, arr); renderQueue(); renderBar(); }
  function queueAdd(song) {
    var arr = queue();
    if (arr.some(function (s) { return s.id === song.id; })) { setTip('已在队列中'); return; }
    arr.push(song); setQueue(arr); setTip('已加入队列');
  }
  function queueRemove(id) {
    setQueue(queue().filter(function (s) { return s.id !== id; }));
  }
  function queueClear() { setQueue([]); }
  // qIndex 按 song.id 重定位（防删歌后索引漂移——策划案实现要点）
  function qIndex() {
    if (!state.cur) return -1;
    return queue().findIndex(function (s) { return s.id === state.cur.id; });
  }
  function queueNext() {
    var arr = queue(), i = qIndex();
    if (i < 0 || i + 1 >= arr.length) return null;
    return arr[i + 1];
  }
  // 入队时锁 bvid（反驳师②修：连播确定性），失败降级为无 bvid
  function resolveBvid(song, cb) {
    if (song.bvid) return cb(song.bvid);
    if (song.url) return cb(null); // 本地歌曲无需
    fetch('/api/music/resolve?kw=' + encodeURIComponent(song.artist + ' ' + song.name))
      .then(function (r) { return r.json(); })
      .then(function (d) { cb(d.ok ? d.bvid : null); })
      .catch(function () { cb(null); });
  }
  // 队列抽屉
  function toggleDrawer() {
    var dw = $body && $body.querySelector('#zfMusQueue');
    if (dw) dw.classList.toggle('open');
    renderQueue();
  }
  function renderQueue() {
    var dw = $body && $body.querySelector('#zfMusQueue');
    if (!dw) return;
    var arr = queue();
    var badge = $body.querySelector('#zfMusQBadge');
    if (badge) badge.textContent = arr.length || '';
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #333">' +
      '<b>播放队列（' + arr.length + '）</b><span style="cursor:pointer;color:#e74c3c" id="zfMusQClear">清空</span></div>';
    if (!arr.length) {
      dw.innerHTML = head + '<div class="zf-mus-empty">队列空：搜索结果行尾点 ＋ 加入</div>';
      var c0 = dw.querySelector('#zfMusQClear');
      if (c0) c0.onclick = queueClear;
      return;
    }
    var curId = state.cur && state.cur.id;
    dw.innerHTML = head + arr.map(function (s, i) {
      var on = curId === s.id;
      return '<div class="zf-mus-row q' + (on ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="zf-mus-name">' + (on ? '▶ ' : '') + esc(s.name) + '</span>' +
        '<span class="zf-mus-artist">' + esc(s.artist || '') + '</span>' +
        '<span class="zf-mus-qdel" data-id="' + esc(s.id) + '" style="color:#888;cursor:pointer;padding:0 6px">✕</span>' +
        '</div>';
    }).join('');
    var c = dw.querySelector('#zfMusQClear');
    if (c) c.onclick = queueClear;
    dw.querySelectorAll('.zf-mus-row.q').forEach(function (row) {
      row.onclick = function () {
        var s = queue()[+row.getAttribute('data-i')];
        if (s) play(s);
      };
    });
    dw.querySelectorAll('.zf-mus-qdel').forEach(function (x) {
      x.onclick = function (e) { e.stopPropagation(); queueRemove(x.getAttribute('data-id')); };
    });
  }

  // ---------- 播放 ----------
  function playUrl(song) {
    if (song.url) return song.url; // 本地
    var u = '/api/music/bstream?kw=' + encodeURIComponent(song.artist + ' ' + song.name);
    if (song.bvid) u += '&bvid=' + encodeURIComponent(song.bvid); // 队列连播锁定
    return u;
  }

  // 【反驳师④修配套】bstream 未命中缓存时返回 202，前端轮询等后台转码完成
  function playWithRetry(song, tries) {
    var a = state.audio;
    a.src = playUrl(song);
    if (a.play) { /* src 赋值后由浏览器加载，202 会以 error/短音频形式出现，统一在 onerror 处理 */ }
  }

  function play(song, rowEl) {
    stopAudio();
    if (!state.audio) state.audio = new Audio();
    var a = state.audio;
    a.src = playUrl(song);
    state.cur = song;
    state.playing = true;
    lsSet('zf_music_last_id', song.id); // 刷新恢复用
    pushHis(song);
    // 【M1核心】onended 自动连播：队列下一首 -> 播；队列尾 -> 循环回第0首
    a.onended = function () {
      var arr = queue(), i = qIndex();
      if (!arr.length) return;
      var nx = queueNext();
      play(nx || arr[0]); // 尾部循环
    };
    a.onerror = function () {
      // 202(pending) 或失败：前若干次静默重试（后台转码中），超限提示
      if ((song._tries || 0) < 20) {
        song._tries = (song._tries || 0) + 1;
        setTimeout(function () {
          if (state.cur === song && state.audio === a) {
            a.src = playUrl(song) + (playUrl(song).indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now();
            a.load(); a.play().catch(function () {});
          }
        }, 1500);
      } else {
        setTip('转码超时或源不可用');
        song._tries = 0;
      }
    };
    a.play().catch(function () {
      setTip('播放失败：源不可用，可尝试其他版本');
    });
    renderBar();
    highlight(rowEl);
    loadLyric(song);
  }

  function stopAudio() {
    if (state.audio) { state.audio.pause(); state.audio.src = ''; }
    state.playing = false;
  }

  function toggle() {
    if (!state.audio || !state.cur) return;
    if (state.playing) { state.audio.pause(); state.playing = false; }
    else { state.audio.play().catch(function () {}); state.playing = true; }
    renderBar();
  }

  function setTip(t) {
    var el = $body && $body.querySelector('#zfMusTip');
    if (el) { el.textContent = t || ''; if (t) setTimeout(function () { el.textContent = ''; }, 3000); }
  }

  function highlight(rowEl) {
    var old = $body && $body.querySelector('.zf-mus-row.active');
    if (old) old.classList.remove('active');
    if (rowEl) rowEl.classList.add('active');
  }

  // ---------- 歌词 ----------
  var lyricTimer = null;
  function loadLyric(song) {
    clearInterval(lyricTimer);
    var box = $body && $body.querySelector('#zfMusLrc');
    if (!box || !song.id) return;
    box.textContent = '加载歌词…';
    fetch('/api/music/lyric?id=' + song.id).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok || !d.lrc) { box.innerHTML = '<div class="zf-mus-lrc-line">暂无歌词</div>'; return; }
      var lines = parseLrc(d.lrc);
      renderLyric(lines);
      startSync(lines);
    }).catch(function () { box.textContent = '歌词加载失败'; });
  }

  function parseLrc(text) {
    var out = [];
    text.split('\n').forEach(function (line) {
      var m = line.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)$/);
      if (m) out.push({ t: (+m[1]) * 60 + (+m[2]) + (+('0.' + (m[3] || '0'))), txt: m[4].trim() });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  var curLines = [];
  function renderLyric(lines) {
    var box = $body && $body.querySelector('#zfMusLrc');
    if (!box) return;
    curLines = lines;
    box.innerHTML = lines.map(function (l, i) {
      return '<div class="zf-mus-lrc-line" data-i="' + i + '">' + esc(l.txt || '·') + '</div>';
    }).join('') || '<div class="zf-mus-lrc-line">暂无歌词</div>';
  }

  function startSync(lines) {
    clearInterval(lyricTimer);
    lyricTimer = setInterval(function () {
      if (!state.audio || !state.playing) return;
      var t = state.audio.currentTime || 0;
      var idx = -1;
      for (var i = 0; i < lines.length; i++) { if (lines[i].t <= t) idx = i; else break; }
      var box = $body.querySelector('#zfMusLrc');
      if (!box) { clearInterval(lyricTimer); return; }
      var els = box.querySelectorAll('.zf-mus-lrc-line');
      els.forEach(function (el, i) { el.classList.toggle('on', i === idx); });
      var on = box.querySelector('.zf-mus-lrc-line.on');
      if (on) box.scrollTop = on.offsetTop - box.clientHeight / 2;
    }, 500);
  }

  // ---------- 渲染 ----------
  function renderBar() {
    var bar = $body && $body.querySelector('#zfMusBar');
    if (!bar) return;
    var s = state.cur;
    bar.querySelector('#zfMusBarName').textContent = s ? (s.name + ' - ' + (s.artist || '本地')) : '未播放';
    bar.querySelector('#zfMusBtnPlay').textContent = state.playing ? '⏸' : '▶';
    var badge = bar.querySelector('#zfMusQBadge');
    var n = queue().length;
    badge.textContent = n;
    badge.style.display = n ? 'inline-block' : 'none';
  }

  function songRow(s) {
    var d = document.createElement('div');
    d.className = 'zf-mus-row' + (isFav(s.id) ? ' fav' : '');
    d.innerHTML =
      '<span class="zf-mus-fav">' + (isFav(s.id) ? '♥' : '♡') + '</span>' +
      '<span class="zf-mus-name">' + esc(s.name) + '</span>' +
      '<span class="zf-mus-artist">' + esc(s.artist || '') + '</span>' +
      '<span class="zf-mus-dur">' + fmtDur(s.duration) + '</span>' +
      '<span class="zf-mus-qadd" style="color:#4aa3ff;cursor:pointer;padding:0 4px;font-weight:bold">＋</span>';
    d.querySelector('.zf-mus-fav').onclick = function (e) {
      e.stopPropagation(); toggleFav(s); d.classList.toggle('fav');
      this.textContent = isFav(s.id) ? '♥' : '♡';
    };
    d.querySelector('.zf-mus-qadd').onclick = function (e) {
      e.stopPropagation();
      var self = this;
      resolveBvid(s, function (bvid) {
        if (bvid) s.bvid = bvid;
        queueAdd(s);
        self.textContent = '✓';
        setTimeout(function () { self.textContent = '＋'; }, 800);
      });
    };
    d.onclick = function () { play(s, d); };
    return d;
  }

  function fmtDur(ms) {
    if (!ms) return '';
    var t = Math.round(ms / 1000);
    return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2);
  }

  function renderList() {
    var list = $body.querySelector('#zfMusList');
    list.innerHTML = '';
    if (state.tab === 'fav') {
      var arr = favs();
      if (!arr.length) { list.innerHTML = '<div class="zf-mus-empty">还没有收藏，去搜索页点 ♡ 吧</div>'; return; }
      arr.forEach(function (s) { list.appendChild(songRow(s)); });
    } else if (state.tab === 'local') {
      list.innerHTML = '<div class="zf-mus-empty">加载中…</div>';
      fetch('/api/music/local').then(function (r) { return r.json(); }).then(function (d) {
        list.innerHTML = '';
        (d.songs || []).forEach(function (s) {
          list.appendChild(songRow({ id: 'local:' + s.name, name: s.name, artist: '本地', url: s.url }));
        });
        if (!(d.songs || []).length) list.innerHTML = '<div class="zf-mus-empty">本地无音乐（server/public/music/local/）</div>';
      }).catch(function () { list.innerHTML = '<div class="zf-mus-empty">加载失败</div>'; });
    } else {
      if (!state.songs.length) { list.innerHTML = '<div class="zf-mus-empty">输入关键词搜索歌曲</div>'; return; }
      state.songs.forEach(function (s) { list.appendChild(songRow(s)); });
    }
  }

  function doSearch() {
    var kw = $body.querySelector('#zfMusKw').value.trim();
    if (!kw) return;
    var list = $body.querySelector('#zfMusList');
    list.innerHTML = '<div class="zf-mus-empty">搜索中…</div>';
    fetch('/api/music/search?kw=' + encodeURIComponent(kw)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { list.innerHTML = '<div class="zf-mus-empty">搜索失败：' + esc(d.err) + '</div>'; return; }
      state.songs = d.songs || [];
      state.tab = 'search';
      renderList();
      setTip(state.songs.length ? '' : '无结果');
    }).catch(function () { list.innerHTML = '<div class="zf-mus-empty">搜索失败（网络）</div>'; });
  }

  function build(body) {
    $body = body;
    body.innerHTML =
      '<style>' +
      '#zfMusRoot{display:flex;flex-direction:column;height:100%;font-size:13px;color:#ddd}' +
      '.zf-mus-tabs{display:flex;gap:6px;padding:8px 10px 0}' +
      '.zf-mus-tab{padding:4px 12px;border-radius:6px;cursor:pointer;background:#2a2a2e}' +
      '.zf-mus-tab.on{background:#c0392b;color:#fff}' +
      '.zf-mus-search{display:flex;gap:6px;padding:8px 10px}' +
      '.zf-mus-search input{flex:1;background:#1b1b1f;border:1px solid #333;border-radius:6px;color:#eee;padding:6px 10px;outline:none}' +
      '.zf-mus-search button{background:#c0392b;border:none;color:#fff;border-radius:6px;padding:6px 14px;cursor:pointer}' +
      '#zfMusList{flex:1;overflow-y:auto;padding:0 6px}' +
      '.zf-mus-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer}' +
      '.zf-mus-row:hover{background:#2a2a2e}.zf-mus-row.active{background:#3a2a28}' +
      '.zf-mus-fav{width:18px;color:#e74c3c;cursor:pointer;flex:none}' +
      '.zf-mus-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.zf-mus-artist{color:#888;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.zf-mus-dur{color:#666;flex:none}' +
      '.zf-mus-empty{color:#777;text-align:center;padding:30px 0}' +
      '#zfMusBar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid #333;background:#1b1b1f}' +
      '#zfMusBtnPlay{width:30px;height:30px;border-radius:50%;background:#c0392b;color:#fff;border:none;cursor:pointer;font-size:13px}' +
      '#zfMusBarName{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}' +
      '#zfMusLrcWrap{display:none;position:absolute;inset:0;background:#161619;z-index:5;flex-direction:column}' +
      '#zfMusLrcWrap.open{display:flex}' +
      '#zfMusLrc{flex:1;overflow-y:auto;padding:40px 20px;text-align:center;scroll-behavior:smooth}' +
      '.zf-mus-lrc-line{padding:6px 0;color:#777;font-size:13px;transition:color .3s}' +
      '.zf-mus-lrc-line.on{color:#fff;font-size:15px}' +
      '#zfMusTip{position:absolute;bottom:52px;left:0;right:0;text-align:center;color:#e67e22;font-size:12px;pointer-events:none}' +
      '#zfMusQueue{display:none;position:absolute;left:0;right:0;bottom:46px;top:100px;background:#161619;z-index:4;overflow-y:auto;border-top:1px solid #333}' +
      '#zfMusQueue.open{display:block}' +
      '#zfMusQBadge{background:#c0392b;color:#fff;border-radius:8px;padding:0 6px;font-size:11px;min-width:12px;text-align:center;display:inline-block}' +
      '</style>' +
      '<div id="zfMusRoot" style="position:relative">' +
      ' <div class="zf-mus-search"><input id="zfMusKw" placeholder="搜索歌曲 / 歌手"/><button id="zfMusBtn">搜索</button></div>' +
      ' <div class="zf-mus-tabs">' +
      '  <div class="zf-mus-tab on" data-t="search">搜索</div>' +
      '  <div class="zf-mus-tab" data-t="fav">收藏</div>' +
      '  <div class="zf-mus-tab" data-t="local">本地</div>' +
      ' </div>' +
      ' <div id="zfMusList"></div>' +
      ' <div id="zfMusTip"></div>' +
      ' <div id="zfMusQueue"></div>' +
      ' <div id="zfMusBar"><button id="zfMusBtnPlay">▶</button><span id="zfMusBarName">未播放</span><span id="zfMusQBadge" style="display:none"></span><button id="zfMusBtnQ" style="background:none;border:none;color:#888;cursor:pointer">≡</button><button id="zfMusBtnLrc" style="background:none;border:none;color:#888;cursor:pointer">词</button></div>' +
      ' <div id="zfMusLrcWrap"><div style="text-align:right;padding:6px 10px"><button id="zfMusLrcClose" style="background:none;border:none;color:#aaa;cursor:pointer">✕ 关闭</button></div><div id="zfMusLrc"></div></div>' +
      '</div>';

    body.querySelector('#zfMusBtn').onclick = doSearch;
    body.querySelector('#zfMusKw').onkeydown = function (e) { if (e.key === 'Enter') doSearch(); };
    body.querySelectorAll('.zf-mus-tab').forEach(function (t) {
      t.onclick = function () {
        body.querySelectorAll('.zf-mus-tab').forEach(function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        state.tab = t.getAttribute('data-t');
        renderList();
      };
    });
    body.querySelector('#zfMusBtnPlay').onclick = toggle;
    body.querySelector('#zfMusBtnQ').onclick = toggleDrawer;
    body.querySelector('#zfMusBtnLrc').onclick = function () {
      body.querySelector('#zfMusLrcWrap').classList.add('open');
    };
    body.querySelector('#zfMusLrcClose').onclick = function () {
      body.querySelector('#zfMusLrcWrap').classList.remove('open');
    };
    renderList();
    renderBar();
  }

  window.ZFMusic = {
    search: function (kw) {
      if (!kw || !$body) return null;
      var input = $body.querySelector('#zfMusKw');
      if (input) input.value = kw;
      doSearch();
      return true; /* truthy：告诉 dock 指令通道已消费，停止重试 */
    },
    /* 兼容带 q: 前缀的搜索入口（onOpen pendingKw 也走这里） */
    playByName: function (kws) {
      var k = String(kws || '');
      if (k.indexOf('q:') === 0) return this.playQueue(k.slice(2));
      return this.search(k);
    },
    /* 【v1.5 AI歌单】playQueue('歌名1|歌名2|...')：逐个搜索→resolve锁bvid→写入播放队列→播第一首
       供 AI 指令通道 pollCmds 的 'q:' 前缀调用，实现"直接弄成列表并播放" */
    playQueue: function (kws) {
      if (!kws || !$body) return;
      if (this._busy) return true; /* 防重入闸：pollCmds 与 pendingKw 双通道只消费一次 */
      this._busy = true;
      var self = this;
      setTimeout(function () { self._busy = false; }, 15000); /* 15秒后闸门自动放行 */
      var names = String(kws).split('|').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!names.length) return;
      queueClear();
      setTip('正在生成播放列表（' + names.length + '首）…');
      var first = null, done = 0, started = false;
      function tryStart() {
        if (started) return;
        if (first) { started = true; play(first); return; }
        if (done >= names.length) {
          var arr = queue();
          if (arr.length) { started = true; play(arr[0]); }
          else setTip('播放列表生成失败：全部搜索无结果');
        }
      }
      names.forEach(function (kw, idx) {
        fetch('/api/music/search?kw=' + encodeURIComponent(kw)).then(function (r) { return r.json(); }).then(function (d) {
          var s = (d.songs || [])[0];
          if (!s) { done++; tryStart(); return; }
          fetch('/api/music/resolve?kw=' + encodeURIComponent(s.artist + ' ' + s.name)).then(function (r) { return r.json(); }).then(function (rd) {
            if (rd && rd.ok && rd.bvid) s.bvid = rd.bvid;
            var arr = queue();
            if (!arr.some(function (x) { return x.id === s.id; })) arr.push(s);
            setQueue(arr);
            if (idx === 0) first = s;
            done++; tryStart();
          }).catch(function () {
            var arr = queue(); arr.push(s); setQueue(arr);
            if (idx === 0) first = s;
            done++; tryStart();
          });
        }).catch(function () { done++; tryStart(); });
      });
      return true; /* truthy：告诉 dock 指令通道已消费，停止重试 */
    },
    onOpen: function (body) {
      if (!body.querySelector('#zfMusRoot')) build(body); else { $body = body; renderList(); }
      // 【反驳师⑤修】刷新恢复：队列还原为暂停态，高亮当前曲（存 id，重定位元数据）
      var savedId = lsGet('zf_music_last_id', null);
      if (savedId) {
        var s = queue().find(function (x) { return x.id === savedId; });
        if (s) state.cur = s; // 不自动播放，play() 只在用户点击时触发
        lsSet('zf_music_last_id', null);
      }
      renderList(); renderBar(); renderQueue();
      var pk = window.__zfMusicPendingKw;
      if (pk) { window.__zfMusicPendingKw = ''; this.playByName(pk); }
    },
    onClose: function () { clearInterval(lyricTimer); }
  };
})();
