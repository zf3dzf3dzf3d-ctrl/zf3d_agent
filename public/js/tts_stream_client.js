/**
 * 流式TTS播放器（可插拔前端模块）
 * 用法:
 *   TTSStream.say('你好');        // 播报
 *   TTSStream.stop();             // 清空队列+打断当前
 *   TTSStream.setEnabled(false);  // 关闭（断开ws）
 * 配置: window.TTS_STREAM_PORT 默认 8524
 */
(function (global) {
  'use strict';

  var PORT = (global.TTS_STREAM_PORT || 8524);
  var queue = [];        // [{sid, chunks:[ArrayBuffer]}] 待播
  var playing = false;
  var curSid = null;
  var ws = null;
  var enabled = true;
  var ctx = null;        // AudioContext（用户手势后解锁）
  var gain = null;

  function connect() {
    if (!enabled || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
    try {
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
    ws.onclose = function () { ws = null; if (enabled) setTimeout(connect, 3000); };
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
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ t: 'say', text: text, voice: voice || null, rate: rate || 100 }));
      }
    },
    stop: function () {
      queue = []; curSid = null;
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
