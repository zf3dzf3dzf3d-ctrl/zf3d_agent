/* ============================================================
 * 画布玩偶 · Canvas Doll
 * 无按钮 3D 角色浮层：全透明背景，同屏一个角色，可拖拽 + 位置记忆
 * 纯前端，零后端改动。挂载：index.html </body> 前
 * 用法（控制台/其他模块）：
 *   window.CanvasDoll.show(url?)         显示（可指定 .vrm 地址）
 *   window.CanvasDoll.hide()             隐藏
 *   window.CanvasDoll.playAction('wave') 动作 wave/nod/happy/shy/angry/sleep
 *   window.CanvasDoll.speak('文字')      TTS 说话 + 口型（优先复用现有 TTS）
 *   window.CanvasDoll.move(x, y)         移动到屏幕坐标（右下角基准）
 * ============================================================ */
(function () {
  'use strict';
  if (window.CanvasDoll) return;

  var LS_KEY = 'canvasDoll.pos.v1';
  var DOLL_W = 320, DOLL_H = 480;          // 浮层尺寸
  var DEFAULT_VRM = 'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

  // ---- 浮层 DOM（背景全透明，只有 3D 角色浮空）----
  var host = document.createElement('div');
  host.id = 'canvas-doll-host';
  host.style.cssText = 'position:fixed;z-index:9000;width:' + DOLL_W + 'px;height:' + DOLL_H +
    'px;pointer-events:none;display:none;background:transparent;will-change:transform;';
  document.body.appendChild(host);

  var stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;pointer-events:auto;cursor:grab;';
  host.appendChild(stage);

  // ---- 状态 ----
  var pos = { x: null, y: null };          // 屏幕坐标（浮层右下角）
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && typeof saved.x === 'number') pos = saved;
  } catch (e) {}
  function savePos() { try { localStorage.setItem(LS_KEY, JSON.stringify(pos)); } catch (e) {} }
  function applyPos() {
    if (pos.x == null) {                  // 默认右下角
      pos.x = window.innerWidth - DOLL_W - 40;
      pos.y = window.innerHeight - DOLL_H - 20;
    }
    pos.x = Math.max(-DOLL_W + 80, Math.min(window.innerWidth - 80, pos.x));
    pos.y = Math.max(40, Math.min(window.innerHeight - 80, pos.y));
    host.style.left = pos.x + 'px';
    host.style.top = pos.y + 'px';
  }

  // ---- Three.js 场景（懒加载，隐藏时不渲染）----
  var renderer = null, scene = null, camera = null, vrm = null, rafId = 0, clock = 0;
  var three = null; // { THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils }

  function loadThree(cb) {
    if (three) return cb();
    var im = document.createElement('script');
    im.type = 'importmap';
    im.textContent = JSON.stringify({
      imports: {
        three: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
        'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/',
        '@pixiv/three-vrm': 'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.2/lib/three-vrm.module.js'
      }
    });
    document.head.appendChild(im);
    var s = document.createElement('script');
    s.type = 'module';
    s.textContent = [
      "import * as THREE from 'three';",
      "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
      "import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';",
      "window.__dollThree = { THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils };",
      "window.dispatchEvent(new Event('doll-three-ready'));"
    ].join('\n');
    document.head.appendChild(s);
    window.addEventListener('doll-three-ready', function () { three = window.__dollThree; cb(); }, { once: true });
  }

  function initScene(cb) {
    loadThree(function () {
      if (renderer) return cb();
      var T = three.THREE;
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(DOLL_W, DOLL_H);
      renderer.outputColorSpace = T.SRGBColorSpace;
      stage.appendChild(renderer.domElement);
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(30, DOLL_W / DOLL_H, 0.1, 100);
      scene.add(new T.HemisphereLight(0xffffff, 0x444466, 1.2));
      var dl = new T.DirectionalLight(0xffffff, 1.8);
      dl.position.set(1, 2, 2);
      scene.add(dl);

      window.addEventListener('resize', function () {
        renderer.setSize(DOLL_W, DOLL_H);
        applyPos();
      });
      cb();
    });
  }

  function fitCamera() {
    if (!vrm) return;
    var T = three.THREE;
    var box = new T.Box3().setFromObject(vrm.scene);
    var size = box.getSize(new T.Vector3());
    var center = box.getCenter(new T.Vector3());
    var h = Math.max(size.y, 0.5);
    var dist = (h / 2) / Math.tan(T.MathUtils.degToRad(camera.fov / 2)) + h * 0.2;
    camera.position.set(center.x, center.y, dist);
    camera.lookAt(center);
  }

  function loadModel(url, cb) {
    initScene(function () {
      var T = three.THREE;
      var loader = new three.GLTFLoader();
      loader.register(function (p) { return new three.VRMLoaderPlugin(p); });
      loader.load(url || DEFAULT_VRM, function (gltf) {
        if (vrm) { scene.remove(vrm.scene); }
        vrm = gltf.userData.vrm;
        three.VRMUtils.removeUnnecessaryVertices(gltf.scene);
        three.VRMUtils.combineSkeletons(gltf.scene);
        three.VRMUtils.rotateVRM0(vrm);
        scene.add(gltf.scene);
        fitCamera();
        if (cb) cb(vrm);
      }, undefined, function (e) { console.error('[CanvasDoll] 模型加载失败', e); });
    });
  }

  // ---- 渲染循环（仅可见时）----
  function loop() {
    if (host.style.display === 'none' || !vrm) { rafId = 0; return; }
    rafId = requestAnimationFrame(loop);
    /* 【FPS 自动降级】全局帧率过低时跳过渲染（玩偶静帧即可），恢复后自动续播 */
    if (window.FpsGuard && !window.FpsGuard.allow('doll')) return;
    clock += 0.016;
    // 待机呼吸 + 轻微浮动
    try {
      var hu = vrm.humanoid;
      if (hu) {
        var b = Math.sin(clock * 1.6) * 0.02;
        hu.getNormalizedBoneNode('spine')?.rotation.set(b * 0.5, 0, 0);
        hu.getNormalizedBoneNode('leftUpperArm').rotation.z = 0.08 + b * 0.3;
        hu.getNormalizedBoneNode('rightUpperArm').rotation.z = -0.08 - b * 0.3;
      }
      tickAction();
      tickMouth();
      vrm.update(clock);
    } catch (e) {}
    renderer.render(scene, camera);
  }

  // ---- 程序化动作系统（与 demo 同款，轻量）----
  var easeIO = function (k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; };
  var act = null; // {name, t, dur, bones, fn}
  var ACTIONS = {
    wave: { dur: 2.0, fn: function (k) {
      var hu = vrm.humanoid;
      var e = easeIO(Math.min(1, k * 3));
      var s = Math.sin(Math.min(1, Math.max(0, (k - 0.25) / 0.65)) * Math.PI);
      hu.getNormalizedBoneNode('rightUpperArm').rotation.z = -2.1 * e;
      hu.getNormalizedBoneNode('rightLowerArm').rotation.z = (-0.5 - s * 0.7) * e;
    }},
    nod: { dur: 1.2, fn: function (k) {
      var e = easeIO(k);
      vrm.humanoid.getNormalizedBoneNode('head').rotation.x = 0.3 * Math.sin(e * Math.PI * 2);
    }},
    happy: { dur: 1.8, fn: function (k) {
      var e = Math.sin(easeIO(k) * Math.PI);
      var hu = vrm.humanoid;
      vrm.expressionManager?.setValue('happy', e);
      hu.getNormalizedBoneNode('leftUpperArm').rotation.z = 1.1 * e;
      hu.getNormalizedBoneNode('rightUpperArm').rotation.z = -1.1 * e;
    }},
    shy: { dur: 1.8, fn: function (k) {
      var s = Math.sin(easeIO(k) * Math.PI);
      var hu = vrm.humanoid;
      vrm.expressionManager?.setValue('happy', s * 0.6);
      hu.getNormalizedBoneNode('head').rotation.x = 0.28 * s;
    }},
    angry: { dur: 1.5, fn: function (k) {
      var e = Math.sin(easeIO(k) * Math.PI);
      vrm.expressionManager?.setValue('angry', e * 0.8);
      var hu = vrm.humanoid;
      hu.getNormalizedBoneNode('leftUpperArm').rotation.z = 0.6 * e;
      hu.getNormalizedBoneNode('rightUpperArm').rotation.z = -0.6 * e;
    }},
    sleep: { dur: 3.0, fn: function (k) {
      var e = easeIO(Math.min(1, k * 2));
      var hu = vrm.humanoid;
      vrm.expressionManager?.setValue('sleepy', Math.min(1, e));
      hu.getNormalizedBoneNode('head').rotation.x = 0.35 * e;
    }}
  };
  function tickAction() {
    if (!act) return;
    act.t += 0.016;
    var k = act.t / act.dur;
    if (k >= 1) {
      try { vrm.expressionManager?.setValue('happy', 0); vrm.expressionManager?.setValue('angry', 0); vrm.expressionManager?.setValue('sleepy', 0); } catch (e) {}
      act = null; return;
    }
    try { act.fn(k); } catch (e) {}
  }

  // ---- 口型（音频音量分析）----
  var mouthCur = 0, audioCtx = null, analyser = null, freqData = null, curAudio = null;
  function tickMouth() {
    var target = 0;
    if (analyser && curAudio && !curAudio.paused) {
      analyser.getByteFrequencyData(freqData);
      var sum = 0; for (var i = 0; i < freqData.length; i++) sum += freqData[i];
      var vol = sum / freqData.length / 255;
      target = vol < 0.02 ? 0 : Math.min(1, vol * 2.2 * (0.85 + Math.random() * 0.3));
    }
    mouthCur += (target - mouthCur) * 0.35;
    try { vrm?.expressionManager?.setValue('aa', mouthCur); } catch (e) {}
  }

  // ---- TTS：优先复用系统现有 TTS，拿不到就用浏览器内置 ----
  function speak(text) {
    playAction('happy');
    var done = false;
    var startMouth = function (audio) {
      curAudio = audio;
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser); analyser.connect(audioCtx.destination);
      audio.play().catch(function () {});
    };
    // 浏览器内置语音兜底
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.onstart = function () { /* 内置语音拿不到音频流，用假口型 */ fakeMouth(true); };
      u.onend = function () { fakeMouth(false); };
      speechSynthesis.speak(u);
    } catch (e) {}
    // 若系统有现成 TTS HTTP 接口（/api/tts），尝试走它
    fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }) }).then(function (r) {
        if (!r.ok) throw 0; return r.blob();
      }).then(function (blob) {
        if (done) return; done = true;
        try { speechSynthesis.cancel(); } catch (e) {}
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        audio.addEventListener('ended', function () { try { URL.revokeObjectURL(url); } catch (e) {} });
        audio.addEventListener('error', function () { try { URL.revokeObjectURL(url); } catch (e) {} });
        startMouth(audio);
      }).catch(function () {});
  }
  var fakeTimer = 0;
  function fakeMouth(on) {
    clearInterval(fakeTimer);
    if (on) fakeTimer = setInterval(function () { mouthCur = Math.random(); }, 90);
  }

  // ---- 拖拽（拖角色本体 = 移动浮层；不拖时点击不拦截画布）----
  var drag = null;
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    drag = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    stage.setPointerCapture(e.pointerId);
    stage.style.cursor = 'grabbing';
    e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) { pos.x = drag.ox + dx; pos.y = drag.oy + dy; applyPos(); }
  });
  stage.addEventListener('pointerup', function () {
    if (drag && drag.moved) savePos();
    else playAction('wave');             // 单击 = 挥手打招呼
    drag = null;
    stage.style.cursor = 'grab';
  });
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    DOLL_W = Math.max(180, Math.min(640, DOLL_W - e.deltaY * 0.3));
    DOLL_H = DOLL_W * 1.5;
    host.style.width = DOLL_W + 'px'; host.style.height = DOLL_H + 'px';
    if (renderer) { renderer.setSize(DOLL_W, DOLL_H); camera.aspect = DOLL_W / DOLL_H; camera.updateProjectionMatrix(); }
    applyPos(); savePos();
  }, { passive: false });

  // ---- 对外 API ----
  var api = {
    show: function (url) {
      host.style.display = 'block';
      applyPos();
      loadModel(url, function () { if (!rafId) rafId = requestAnimationFrame(loop); playAction('happy'); });
    },
    hide: function () {
      host.style.display = 'none';
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },
    get visible() { return host.style.display !== 'none'; },
    playAction: function (name) {
      var a = ACTIONS[name];
      if (a && vrm && !act) act = { t: 0, dur: a.dur, fn: a.fn };
    },
    speak: speak,
    move: function (x, y) { pos.x = x; pos.y = y; applyPos(); savePos(); },
    setModel: function (url) { loadModel(url); }
  };
  window.CanvasDoll = api;

  // ---- 与 mode 角色系统联动（步骤3/4）----
  // 监听模式切换事件（多种事件名兜底），同屏只保留一个角色：
  // 旧角色先隐藏（淡出逻辑由 display 切换承担），新角色若 manifest 配了 avatar.vrm 则加载它
  var _lastVrm = null;
  api.onMode = function (modeId, manifest) {
    try {
      var vrmUrl = manifest && manifest.avatar && manifest.avatar.vrm;
      if (!vrmUrl) { api.hide(); return; }        // 未配置形象的角色不上场
      if (_lastVrm === vrmUrl && api.visible) return;
      _lastVrm = vrmUrl;
      api.show(vrmUrl);
      api.playAction('happy');
    } catch (e) { console.warn('[CanvasDoll] onMode 失败', e); }
  };
  // 尝试挂到常见的全局事件总线
  if (window.ZFBus && typeof window.ZFBus.on === 'function') {
    window.ZFBus.on('mode-changed', function (d) { api.onMode(d && d.id, d && d.manifest); });
  }
  document.addEventListener('mode-changed', function (e) {
    var d = e.detail || {}; api.onMode(d.id, d.manifest);
  });
})();
