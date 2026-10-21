/* ============================================================
 * app-ninja.js — 对话框忍者斩杀彩蛋 v1.0
 * 激活：500ms 内快按 W+A+S+D 四键召唤忍者
 * 玩法：A/D 移动、空格跳、落在 .msg 气泡顶部；气泡上有敌人，接触即斩
 * 退出：Esc 或再次四键；DOM/样式零残留
 * 纯前端零侵入：本文件自注入样式，不依赖任何 CSS 文件
 * ============================================================ */
(function () {
  'use strict';
  if (window.__NINJA_EGG__) return; // 防重复加载
  window.__NINJA_EGG__ = true;

  /* ---------- 常量 ---------- */
  var ACTIVATE_WINDOW = 500;   // 四键激活时间窗 ms
  var GRAVITY = 2200;          // px/s²
  var MOVE_SPEED = 320;        // px/s
  var JUMP_VY = -760;          // 起跳速度
  var CLIMB_SPEED = 220;       // 贴墙攀爬速度 px/s
  var WALL_SLIDE = 140;        // 贴墙下滑速度上限 px/s
  var WALL_PAD = 6;            // 贴墙判定容差 px
  var VIEW_PAD = 200;          // 平台渲染视口外扩 px

  /* ---------- 状态 ---------- */
  var active = false;          // 游戏是否运行
  var styleEl = null;
  var layerEl = null;          // 游戏层
  var ninjaEl = null;
  var platforms = [];          // [{x,y,w,h,el,enemyEl,enemyAlive}]
  var keys = {};
  var pos = { x: 100, y: 100 };
  var vel = { x: 0, y: 0 };
  var onGround = false;
  var jumpHeld = false;         // 跳跃键按住标记（防长按连跳，松开再按才触发下一次）
  var gameStart = 0;            // 本局开始时间（用于敌人数量随时间增长）
  var facing = 1;
  var wall = 0, wallLock = 0;   // 贴墙状态：0 无 / -1 左壁 / 1 右壁；wallLock 蹬墙跳后脱墙锁
  var rafId = 0;
  var lastT = 0;
  var killCount = 0;
  var scoreEl = null;
  var keyTimes = [];           // 激活用：最近按键时间

  /* ---------- 样式注入 ---------- */
  var CSS = [
    '#ninja-layer{position:fixed;inset:0;pointer-events:none;z-index:99998;overflow:hidden;}',
    '.ninja-char{position:absolute;width:34px;height:40px;font-size:32px;line-height:40px;text-align:center;will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));}',
    '.ninja-enemy{position:absolute;font-size:22px;line-height:24px;text-align:center;will-change:transform;animation:ninja-bob 1s ease-in-out infinite;}',
    '@keyframes ninja-bob{0%,100%{margin-top:0}50%{margin-top:-5px}}',
    '.ninja-slash{position:absolute;width:80px;height:80px;pointer-events:none;background:linear-gradient(135deg,transparent 42%,#fff 50%,transparent 58%);clip-path:polygon(0 100%,100% 0,100% 18%,18% 100%);animation:ninja-slash .28s ease-out forwards;}',
    '@keyframes ninja-slash{0%{opacity:1;transform:scale(.4) rotate(-15deg)}100%{opacity:0;transform:scale(1.4) rotate(10deg)}}',
    '.ninja-particle{position:absolute;width:6px;height:6px;border-radius:50%;background:#ff5252;pointer-events:none;}',
    '.ninja-text{position:absolute;font-weight:900;font-size:22px;color:#e53935;text-shadow:0 0 6px #fff,0 1px 2px #000;pointer-events:none;animation:ninja-float .7s ease-out forwards;}',
    '@keyframes ninja-float{0%{opacity:1;transform:translateY(0) scale(.6)}30%{transform:translateY(-14px) scale(1.2)}100%{opacity:0;transform:translateY(-38px) scale(1)}}',
    '.ninja-shake{animation:ninja-shake .2s ease-in-out;}',
    '@keyframes ninja-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}50%{transform:translateX(5px)}75%{transform:translateX(-3px)}}',
    '.ninja-score{position:fixed;top:12px;right:16px;z-index:99999;pointer-events:none;background:rgba(0,0,0,.75);color:#ffd54f;font:700 14px/1.6 monospace;padding:6px 12px;border-radius:8px;border:1px solid #ffd54f55;}',
    '.ninja-hint{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;background:rgba(0,0,0,.7);color:#fff;font:12px/1.6 monospace;padding:5px 14px;border-radius:8px;opacity:.85;}'
  ].join('\n');

  /* ---------- 工具 ---------- */
  function isTypingTarget() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  }

  /* ---------- P2 平台扫描 ---------- */
  function scanPlatforms() {
    if (!active) return;
    var vh = window.innerHeight, vw = window.innerWidth;
    var nodes = document.querySelectorAll('.msg');
    var oldMap = {};
    platforms.forEach(function (p) { if (p.enemyAlive) oldMap[p.key] = p; });

    // 敌人数量随时间增长：开局只有部分气泡有敌人，随时间概率逐渐升至 100%
    var elapsed = (Date.now() - gameStart) / 1000;
    var spawnChance = Math.min(0.25 + elapsed * 0.01, 1); // 每秒 +1%，约 75 秒后满额

    platforms = [];
    nodes.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -VIEW_PAD || r.top > vh + VIEW_PAD || r.width < 20) return;
      var key = el.getAttribute('data-ninja-pid') || (el.setAttribute('data-ninja-pid', Math.random().toString(36).slice(2)), el.getAttribute('data-ninja-pid'));
      var prev = oldMap[key];
      // 新平台按时间概率刷敌；老平台保留原敌（复活再战保持随机感）
      var alive = prev ? prev.enemyAlive : Math.random() < spawnChance;
      var p = { key: key, x: r.left, y: r.top, w: r.width, h: r.height, el: el,
                enemyAlive: alive, enemyEl: prev ? prev.enemyEl : null };
      platforms.push(p);
    });

    // 同步敌人 DOM
    platforms.forEach(function (p) {
      if (p.enemyAlive && !p.enemyEl) {
        p.enemyEl = document.createElement('div');
        p.enemyEl.className = 'ninja-enemy';
        p.enemyEl.textContent = ['👺','👹','🦇','🕷️'][Math.floor(Math.random() * 4)];
        layerEl.appendChild(p.enemyEl);
      }
      if (p.enemyEl) {
        // 敌人位置随机：不总在气泡正中，横向 10%~90% 区间随机驻留
        if (typeof p.enemyOff !== 'number') p.enemyOff = 0.1 + Math.random() * 0.8;
        p.enemyEl.style.left = (p.x + p.w * p.enemyOff - 11) + 'px';
        p.enemyEl.style.top = (p.y - 26) + 'px';
        p.enemyEl.style.display = p.enemyAlive ? '' : 'none';
      }
    });
    resetAnchor(); // 重扫后重置平移补偿基准，防止叠加双重偏移
  }

  var rescanTimer = 0;
  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(scanPlatforms, 150);
  }

  /* ---------- 滚动补偿：直接平移，防抖后重扫 ---------- */
  function onScroll() {
    if (!active) return;
    // 简化处理：scroll 时忍者跟随气泡较难精确，直接防抖重扫（150ms 足够流畅）
    scheduleRescan();
  }

  /* ---------- P3 物理 ---------- */
  function physics(dt) {
    var left = keys['a'] || keys['arrowleft'];
    var right = keys['d'] || keys['arrowright'];
    vel.x = (right ? MOVE_SPEED : 0) - (left ? MOVE_SPEED : 0);
    if (left) facing = -1;
    if (right) facing = 1;

    // 无限连跳：空中也可起跳（jumpHeld 需松开再按，防长按狂跳）
    var jumpKey = keys[' '] || keys['w'] || keys['arrowup'];
    if (jumpKey && !jumpHeld) {
      vel.y = JUMP_VY;
      onGround = false;
    }
    jumpHeld = jumpKey;

    // 下坠跳：按 S/↓ 空中快速下坠
    if (!onGround && (keys['s'] || keys['arrowdown'])) vel.y = Math.max(vel.y, 900);

    vel.y += GRAVITY * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;

    // 贴墙检测：空中水平压向气泡侧面时挂住（可缓降/攀爬/蹬墙跳）
    wall = 0;
    if (wallLock > 0) wallLock -= dt; // 蹬墙跳后短暂脱墙锁，防粘墙
    if (!onGround && wallLock <= 0) {
      for (var wi = 0; wi < platforms.length; wi++) {
        var wp = platforms[wi];
        var withinY = pos.y + 34 > wp.y && pos.y + 6 < wp.y + wp.h; // 身体与气泡纵向有交集
        if (!withinY) continue;
        if (vel.x > 0 && Math.abs((pos.x + 34) - wp.x) <= WALL_PAD) { wall = 1; break; }
        if (vel.x < 0 && Math.abs(pos.x - (wp.x + wp.w)) <= WALL_PAD) { wall = -1; break; }
      }
    }
    if (wall !== 0) {
      // 吸附到墙面
      for (var wi2 = 0; wi2 < platforms.length; wi2++) {
        var wp2 = platforms[wi2];
        var withinY2 = pos.y + 34 > wp2.y && pos.y + 6 < wp2.y + wp2.h;
        if (!withinY2) continue;
        if (wall === 1 && Math.abs((pos.x + 34) - wp2.x) <= WALL_PAD) { pos.x = wp2.x - 34; break; }
        if (wall === -1 && Math.abs(pos.x - (wp2.x + wp2.w)) <= WALL_PAD) { pos.x = wp2.x + wp2.w; break; }
      }
      // 蹬墙跳（空格）：反向弹出
      if (keys[' ']) {
        vel.y = JUMP_VY * 0.9;
        vel.x = -wall * MOVE_SPEED * 1.4;
        wall = 0;
        wallLock = 0.12;
      } else if (keys['w'] || keys['arrowup']) {
        // 攀爬：按 W/↑ 沿墙向上爬
        vel.y = -CLIMB_SPEED;
      } else if (vel.y > WALL_SLIDE) {
        // 贴墙缓降
        vel.y = WALL_SLIDE;
      }
    }

    // 边界
    if (pos.x < 0) pos.x = 0;
    if (pos.x > window.innerWidth - 34) pos.x = window.innerWidth - 34;

    // AABB 落台检测：下落时脚部接触气泡顶部 4px 容差
    var foot = pos.y + 40;
    onGround = false;
    if (vel.y >= 0) {
      for (var i = 0; i < platforms.length; i++) {
        var p = platforms[i];
        var overlapX = pos.x + 30 > p.x && pos.x + 4 < p.x + p.w;
        if (overlapX && foot >= p.y && foot <= p.y + 6 + vel.y * dt) {
          pos.y = p.y - 40;
          vel.y = 0;
          onGround = true;
          break;
        }
      }
      // 地板兜底
      var floor = window.innerHeight - 4;
      if (pos.y + 40 >= floor) { pos.y = floor - 40; vel.y = 0; onGround = true; }
    }

    /* ---------- P4 斩杀判定 ---------- */
    var nx = pos.x + 17, ny = pos.y + 20;
    platforms.forEach(function (p) {
      if (!p.enemyAlive) return;
      var ex = p.x + p.w * (typeof p.enemyOff === 'number' ? p.enemyOff : 0.5), ey = p.y - 14;
      if (Math.abs(nx - ex) < 34 && Math.abs(ny - ey) < 34) killEnemy(p, ex, ey);
    });
  }

  /* ---------- P4 斩杀特效 ---------- */
  function killEnemy(p, ex, ey) {
    p.enemyAlive = false;
    if (p.enemyEl) p.enemyEl.style.display = 'none';
    killCount++;
    updateScore();
    // 派发命中事件给鬼泣连击系统（×1 计数 +1）
    try { window.dispatchEvent(new CustomEvent('zf-combo-hit', { detail: { tool: 'ninja' } })); } catch (e) {}

    // 刀光
    var slash = document.createElement('div');
    slash.className = 'ninja-slash';
    slash.style.left = (ex - 40) + 'px';
    slash.style.top = (ey - 46) + 'px';
    layerEl.appendChild(slash);
    setTimeout(function () { slash.remove(); }, 300);

    // 碎裂粒子
    for (var i = 0; i < 8; i++) {
      (function () {
        var pt = document.createElement('div');
        pt.className = 'ninja-particle';
        pt.style.left = ex + 'px';
        pt.style.top = ey + 'px';
        pt.style.background = ['#ff5252','#ffca28','#ffffff'][i % 3];
        layerEl.appendChild(pt);
        var ang = Math.random() * Math.PI * 2, spd = 60 + Math.random() * 120;
        var t0 = performance.now();
        (function fly(now) {
          var t = (now - t0) / 1000;
          if (t > 0.5) { pt.remove(); return; }
          pt.style.transform = 'translate(' + Math.cos(ang) * spd * t + 'px,' + (Math.sin(ang) * spd * t + 180 * t * t) + 'px)';
          pt.style.opacity = 1 - t * 2;
          requestAnimationFrame(fly);
        })(t0);
      })();
    }

    // 飘「斬!」
    var txt = document.createElement('div');
    txt.className = 'ninja-text';
    txt.textContent = '斬!';
    txt.style.left = (ex - 16) + 'px';
    txt.style.top = (ey - 30) + 'px';
    layerEl.appendChild(txt);
    setTimeout(function () { txt.remove(); }, 700);

    // 气泡抖动
    p.el.classList.remove('ninja-shake');
    void p.el.offsetWidth; // 重触发动画
    p.el.classList.add('ninja-shake');
    setTimeout(function () { p.el.classList.remove('ninja-shake'); }, 220);
  }

  function updateScore() {
    if (scoreEl) scoreEl.textContent = '🥷 斩杀 ×' + killCount;
  }

  /* ---------- 画布平移补偿：rAF 帧间对比锚点 rect 差值，就地平移平台 ---------- */
  var anchorEl = null, anchorRect = null; // 锚点：首个气泡的视口 rect 基准
  function resetAnchor() {
    anchorEl = document.querySelector('.msg');
    anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : null;
  }
  function panCompensate() {
    if (!anchorEl || !anchorRect) { resetAnchor(); return; }
    if (!document.contains(anchorEl)) { resetAnchor(); return; } // 锚点被销毁，重新锚定
    var r = anchorEl.getBoundingClientRect();
    var dx = r.left - anchorRect.left, dy = r.top - anchorRect.top;
    if (dx === 0 && dy === 0) return;
    // 平移所有平台与敌人（不做视口剔除重算，零重扫开销）
    platforms.forEach(function (p) {
      p.x += dx; p.y += dy;
      if (p.enemyEl) {
        p.enemyEl.style.left = (p.x + p.w * p.enemyOff - 11) + 'px';
        p.enemyEl.style.top = (p.y - 26) + 'px';
      }
    });
    anchorRect = r;
    scheduleRescan(); // 静止后防抖重扫（修正视口剔除/尺寸变化）
  }

  /* ---------- 主循环 ---------- */
  function loop(now) {
    if (!active) return;
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    physics(dt);
    panCompensate();
    ninjaEl.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px) scaleX(' + facing + ')';
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- P1/P5 启停 ---------- */
  function start() {
    if (active) return;
    active = true;
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    layerEl = document.createElement('div');
    layerEl.id = 'ninja-layer';
    document.body.appendChild(layerEl);

    ninjaEl = document.createElement('div');
    ninjaEl.className = 'ninja-char';
    ninjaEl.textContent = '🥷';
    layerEl.appendChild(ninjaEl);

    scoreEl = document.createElement('div');
    scoreEl.className = 'ninja-score';
    scoreEl.textContent = '🥷 斩杀 ×0';
    layerEl.appendChild(scoreEl);

    var hint = document.createElement('div');
    hint.className = 'ninja-hint';
    hint.textContent = 'A/D 移动 · 空格跳 · 靠气泡侧面可攀爬（W上爬/缓降/空格蹬墙跳） · Esc 退出';
    layerEl.appendChild(hint);

    pos = { x: window.innerWidth / 2, y: 100 };
    vel = { x: 0, y: 0 };
    killCount = 0;
    gameStart = Date.now();
    scanPlatforms(); // 内部已 resetAnchor

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', scheduleRescan);
    document.addEventListener('visibilitychange', onPauseToggle);
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function onPauseToggle() {
    if (!active) return;
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else {
      lastT = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  function stop(internal) {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', scheduleRescan);
    document.removeEventListener('visibilitychange', onPauseToggle);
    clearTimeout(rescanTimer);
    if (styleEl) styleEl.remove();
    if (layerEl) layerEl.remove();
    document.querySelectorAll('[data-ninja-pid]').forEach(function (el) {
      el.removeAttribute('data-ninja-pid');
      el.classList.remove('ninja-shake');
    });
    platforms = [];
    keys = {};
    anchorEl = null; anchorRect = null;
    styleEl = layerEl = ninjaEl = scoreEl = null;
    // 内部退出（Esc/再次四键）时通知风筝模式系统自动切回，避免界面残留黑屏
    if (internal) {
      try { document.dispatchEvent(new CustomEvent('ninja-egg-stop')); } catch (err) {}
    }
  }

  /* ---------- 激活：500ms 内快按 WASD 四键 ---------- */
  document.addEventListener('keydown', function (e) {
    if (isTypingTarget()) return; // 打字短路
    var k = (e.key || '').toLowerCase();

    if (active && k === 'escape') { stop(true); return; }
    if (active) {
      keys[k] = true;
      // 再次 500ms 内快按 WASD 四键也可退出
      if (['w', 'a', 's', 'd'].indexOf(k) !== -1) {
        var now = Date.now();
        keyTimes.push({ k: k, t: now });
        keyTimes = keyTimes.filter(function (it) { return now - it.t <= ACTIVATE_WINDOW; });
        var seen2 = {};
        keyTimes.forEach(function (it) { seen2[it.k] = true; });
        if (seen2.w && seen2.a && seen2.s && seen2.d) { stop(true); }
      }
      return;
    }

    keyTimes = [];
    if (['w', 'a', 's', 'd'].indexOf(k) === -1) { keyTimes = []; return; }
    var now = Date.now();
    keyTimes.push({ k: k, t: now });
    keyTimes = keyTimes.filter(function (it) { return now - it.t <= ACTIVATE_WINDOW; });
    var seen = {};
    keyTimes.forEach(function (it) { seen[it.k] = true; });
    if (seen.w && seen.a && seen.s && seen.d) {
      keyTimes = [];
      start();
    }
  }, true);

  document.addEventListener('keyup', function (e) {
    keys[(e.key || '').toLowerCase()] = false;
  }, true);

  /* ---------- 对外接口：供风筝模式系统（app-kite-modes.js ninja 模式）调用 ---------- */
  window.NinjaEgg = {
    start: function () { if (!active) start(); },
    stop: function () { if (active) stop(); },
    isActive: function () { return active; }
  };

  console.log('[ninja-egg] 已加载：500ms 内快按 W+A+S+D 召唤忍者（也可在风筝模式菜单点「忍者」）');
})();
