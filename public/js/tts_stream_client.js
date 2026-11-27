/**
 * 流式TTS播放器（可插拔前端模块）
 * 用法:
 *   TTSStream.say('你好');        // 播报
 *   TTSStream.stop();             // 清空队列+打断当前
 *   TTSStream.setEnabled(false);  // 关闭（断开ws）
 * 配置: 端口由 /api/tts/config 下发（真源 private/port.json 的 tts_stream.port）；
 *       window.TTS_STREAM_PORT 可手动覆盖；兜底默认 8622（6.2.0 端口段）。
 */
(function (global) {
  'use strict';

  var PORT = (global.TTS_STREAM_PORT || 8622);
  var queue = [];        // [{sid, chunks:[ArrayBuffer]}] 待播
  var playing = false;
  var curSid = null;
  var ws = null;
  var enabled = true;
  var ctx = null;        // AudioContext（用户手势后解锁）
  var gain = null;
  var pendingSends = [];   // CONNECTING 期间排队的 say 消息，onopen 后依序冲账
  var currentSources = []; // 正在播放的 BufferSource 登记（stop 打断用）

  // 端口解析：连接前向 /api/tts/config 拉一次真源（与 /api/plaza/config 同模式）。
  // 【20261123 修复】旧版硬编码 8524，6.2.0 端口段迁移后服务端实绑 8622，前端静默失联。
  var _portResolved = !!(global.TTS_STREAM_PORT);
  var _portWaiters = [];
  function resolvePort(then) {
    if (_portResolved) { then(); return; }
    _portWaiters.push(then);
    if (_portWaiters.length > 1) return;   // 只发一次请求，其余等同一结果
    var done = function () {
      var waiters = _portWaiters; _portWaiters = [];
      waiters.forEach(function (fn) { fn(); });
    };
    try {
      fetch('/api/tts/config').then(function (r) { return r.json(); }).then(function (cfg) {
        if (cfg && cfg.ok) {
          if (cfg.port) PORT = cfg.port;
          if (cfg.enabled === false) enabled = false;
        }
      }).catch(function () {}).then(function () {
        _portResolved = true;   // fetch 完成后才置位，等待机制才真正生效
        done();
      });
    } catch (e) { _portResolved = true; done(); }
  }
  resolvePort(function () {});   // 载入即解析，用户首次播报前端口已就绪

  function connect() {
    if (!enabled || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
    resolvePort(function () {
      if (!enabled || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
      try {
        // 【已审计】WebSocket 连本机 TTS 流端口（经 /api/tts/config 下发，仅 127.0.0.1，无 SSRF 面）
        ws = new WebSocket('ws://127.0.0.1:' + PORT);
      } catch (e) { return; }
      ws.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'start') {
          curSid = m.sid;
          queue.push({ sid: m.sid, chunks: [] });
        } else if (m.t === 'chunk') {
          if (m.sid !== curSid) return;          // 已被打断的旧任务
          var bin = atob(m.data);
          var buf = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          var item = queue[queue.length - 1];
          if (item) item.chunks.push(buf.buffer);
        } else if (m.t === 'end') {
          if (m.sid === curSid) curSid = null;
          if (!playing) playNext();
        } else if (m.t === 'error') {
          console.warn('[TTSStream]', m.msg);
        }
      };
      ws.onopen = function () {
        // 冲账：把 CONNECTING 期间排队的 say 依序发出
        var ps = pendingSends; pendingSends = [];
        ps.forEach(function (msg) { try { if (ws && ws.readyState === 1) ws.send(msg); } catch (e) {} });
      };
      var sock = ws;   // 闭包快照：防旧 socket 的迟到 onclose 误杀新连接
      ws.onclose = function () {
        if (ws !== sock) return;
        ws = null; if (enabled) setTimeout(connect, 3000);
      };
    });
  }

  function audioCtx() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      gain = ctx.createGain();
      gain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  document.addEventListener('click', audioCtx, { once: true });

  function playNext() {
    if (!enabled || playing) return;
    var item = queue.shift();
    if (!item) return;
    playing = true;
    decodeQueue(item.chunks, function (buffers) {
      var ac = audioCtx();
      if (!ac || !buffers.length) { playing = false; playNext(); return; }
      var when = ac.currentTime + 0.05;
      buffers.forEach(function (b) {
        var src = ac.createBufferSource();
        src.buffer = b;
        src.connect(gain);
        currentSources.push(src);   // 登记，供 stop() 打断
        src.onended = function () {
          var idx = currentSources.indexOf(src);
          if (idx >= 0) currentSources.splice(idx, 1);
        };
        src.start(when);
        when += b.duration;
      });
      var total = (when - ac.currentTime) * 1000;
      setTimeout(function () { playing = false; playNext(); }, total + 50);
    });
  }

  function decodeQueue(bufs, cb) {
    var ac = audioCtx();
    if (!ac) { cb([]); return; }
    var out = [], pending = bufs.length;
    if (!pending) { cb(out); return; }
    bufs.forEach(function (b) {
      ac.decodeAudioData(b, function (d) {
        out.push(d);
        if (--pending === 0) out.sort(function (a, c) { return 0; }), cb(out);
      }, function () { if (--pending === 0) cb(out); });
    });
  }

  global.TTSStream = {
    say: function (text, voice, rate) {
      if (!enabled || !text) return;
      connect();
      var msg = JSON.stringify({ t: 'say', text: text, voice: voice || null, rate: rate || 100 });
      if (ws && ws.readyState === 1) {
        ws.send(msg);
      } else {
        // CONNECTING(0) 或尚未建连：排队，onopen 后依序冲账发送
        pendingSends.push(msg);
      }
    },
    stop: function () {
      queue = []; curSid = null;
      // 打断当前播放：逐个停掉已登记的 BufferSource
      var cs = currentSources; currentSources = [];
      cs.forEach(function (src) { try { src.stop(); } catch (e) {} });
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'stop' }));
    },
    setEnabled: function (on) {
      enabled = !!on;
      if (!on) { this.stop(); if (ws) { try { ws.close(); } catch (e) {} ws = null; } }
      else connect();
    },
    get enabled() { return enabled; }
  };
})(window);
