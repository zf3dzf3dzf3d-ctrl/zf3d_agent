/* ============================================================
 * app-sfx.js - 全局交互音效（WebAudio 合成，零素材零依赖）
 * 覆盖：发送、回复完成、停止、出错、画布拖拽起/落、节点拖动、
 *       连线建立、弹窗开关、点击反馈。
 * 可用 localStorage zf3d_sfx_off = '1' 关闭音效。
 * ============================================================ */
(function () {
  'use strict';
  if (window.__zfSfx) return;

  var _ctx = null;
  var _unlocked = false;   // 用户手势解锁标志：浏览器要求 AudioContext 必须在用户手势后才允许出声
  function _armUnlock() { _unlocked = true; }
  ['pointerdown','keydown','touchstart'].forEach(function (ev) { document.addEventListener(ev, _armUnlock, { once: true, capture: true }); });
  function ctx() {
    if (!_ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _ctx = new AC();
    }
    if (_ctx.state === 'suspended') { try { _ctx.resume(); } catch (e) {} }
    return _ctx;
  }

  var enabled = function () {
    try { return localStorage.getItem('zf3d_sfx_off') !== '1'; } catch (e) { return true; }
  };

  // ---- 基础合成器 ----
  function tone(freq, dur, type, vol, delay, slideTo) {
    if (!_unlocked) return;   // 未发生用户手势前静默跳过，避免 AudioContext 警告刷屏
    var c = ctx(); if (!c || !enabled()) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, filterFreq) {
    if (!_unlocked) return;   // 未发生用户手势前静默跳过，避免 AudioContext 警告刷屏
    var c = ctx(); if (!c || !enabled()) return;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq || 1800; f.Q.value = 0.8;
    var g = c.createGain(); g.gain.value = vol || 0.08;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start();
  }

  // ---- 音效库 ----
  var SFX = {
    send:    function () { noise(0.12, 0.05, 3000); tone(320, 0.16, 'sine', 0.12, 0, 760); },            // 嗖~上升
    done:    function () { tone(660, 0.14, 'sine', 0.14); tone(880, 0.18, 'sine', 0.12, 0.09); tone(1320, 0.22, 'sine', 0.08, 0.18); }, // 叮-叮-叮
    stop:    function () { tone(440, 0.12, 'triangle', 0.12, 0, 220); },                                  // 下降
    error:   function () { tone(200, 0.16, 'sawtooth', 0.10); tone(160, 0.20, 'sawtooth', 0.10, 0.12); },// 低鸣
    tick:    function () { tone(1200, 0.04, 'square', 0.04); },                                           // 抓起
    drop:    function () { tone(500, 0.08, 'sine', 0.10, 0, 900); },                                      // 放下
    link:    function () { tone(700, 0.10, 'sine', 0.12, 0, 1200); tone(1400, 0.12, 'sine', 0.08, 0.08); },// 连线成功
    click:   function () { tone(900, 0.05, 'triangle', 0.07); },                                          // 普通点击
    open:    function () { tone(520, 0.10, 'sine', 0.08, 0, 900); },                                      // 弹窗开
    close:   function () { tone(800, 0.10, 'sine', 0.08, 0, 420); },                                      // 弹窗关
    pop:     function () { tone(300, 0.10, 'sine', 0.12, 0, 1500); noise(0.06, 0.05, 2500); }             // 新建节点
  };

  // 节流：同一类音效 60ms 内只放一次
  var _last = {};
  function play(name) {
    if (!enabled()) return;
    var now = Date.now();
    if (_last[name] && now - _last[name] < 60) return;
    _last[name] = now;
    try { SFX[name] && SFX[name](); } catch (e) {}
  }

  // ================= 挂钩 =================

  // 1) 发送按钮 / 停止按钮（事件委托，覆盖所有对话节点）
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.send-btn') : null;
    if (btn) {
      if (btn.classList.contains('sending')) play('stop');
      else play('send');
      return;
    }
    if (e.target.closest && e.target.closest('button, .btn, .toggle, label[for]')) play('click');
  }, true);

  // 2) 回复完成 / 停止 / 出错 —— 包一层 App 钩子
  function patchApp() {
    if (!window.App) { setTimeout(patchApp, 300); return; }

    var origComplete = App._onSendComplete;
    if (typeof origComplete === 'function' && !origComplete.__sfx) {
      App._onSendComplete = function (box, chat) {
        var wasErr = chat && chat._lastStatus === 'error';
        var r = origComplete.apply(this, arguments);
        play(wasErr ? 'error' : 'done');
        return r;
      };
      App._onSendComplete.__sfx = true;
    }

    var origStop = App.stopSending;
    if (typeof origStop === 'function' && !origStop.__sfx) {
      App.stopSending = function (chat) {
        var r = origStop.apply(this, arguments);
        play('stop');
        return r;
      };
      App.stopSending.__sfx = true;
    }

    var origDot = App.updateStatusDot;
    if (typeof origDot === 'function' && !origDot.__sfx) {
      App.updateStatusDot = function (chat) {
        var r = origDot.apply(this, arguments);
        try {
          if (chat && chat._lastStatus === 'error' && !chat.isSending) play('error');
        } catch (e) {}
        return r;
      };
      App.updateStatusDot.__sfx = true;
    }
  }
  patchApp();

  // 3) 画布拖拽（平移/抓取）音效：canvasArea mousedown=抓起，mouseup=放下
  var area = document.getElementById('canvasArea') || document.body;
  area.addEventListener('mousedown', function (e) {
    if (e.button === 0) play('tick');
  }, true);
  document.addEventListener('mouseup', function () { play('drop'); }, true);

  // 4) 弹窗开关（modal 显示/隐藏）
  var _modalState = {};
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.target.id && /modal|panel|drawer/i.test(m.target.id)) {
        var vis = getComputedStyle(m.target).display !== 'none';
        var key = m.target.id;
        if (_modalState[key] !== vis) {
          _modalState[key] = vis;
          play(vis ? 'open' : 'close');
        }
      }
    });
  }).observe(document.body, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });

  // 5) 新建节点（quick-note / chatbox 插入画布时 pop 一声）
  var host = document.getElementById('canvasContent');
  if (host) {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          if (n.classList && (n.classList.contains('quick-note') || n.classList.contains('chatbox'))) play('pop');
        });
      });
    }).observe(host, { childList: true });
  }

  // 6) 连线成功（随手标题绑定连线 onUp 建立）：监听 window 自定义事件 + 画布落点兜底
  window.addEventListener('zf-sfx', function (e) { play(e.detail && e.detail.name || 'click'); });

  // 对外暴露
  window.__zfSfx = { play: play, SFX: SFX, enabled: enabled };
})();
