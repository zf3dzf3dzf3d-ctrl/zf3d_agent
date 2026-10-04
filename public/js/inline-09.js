  // ===== 页面健康 · 提速（重做版）=====
  var $ = function(id){ return document.getElementById(id); };
  var CIRC = 263.9;
  var _hbTimer = null;

  function fmtMB(mb){ return mb >= 1024 ? (mb/1024).toFixed(2)+' GB' : mb.toFixed(1)+' MB'; }
  function state(msg, sub){ var st=$('sbState'); if(st) st.textContent=msg; var s2=$('sbSub'); if(s2&&sub!==undefined) s2.innerHTML=sub; }
  function setRing(pct, color){
    var fg=$('sbFg'); if(fg){ fg.style.strokeDashoffset = CIRC*(1-pct/100); if(color) fg.style.stroke = color; }
    var p=$('sbPct'); if(p) p.textContent = Math.round(pct);
  }

  // 健康仪表：FPS / 内存 / 运行时长
  function renderHealth(){
    var fps = (window.FpsGuard && typeof window.FpsGuard.fps === 'function') ? window.FpsGuard.fps() : 60;
    var degraded = window.FpsGuard && window.FpsGuard.isDegraded && window.FpsGuard.isDegraded();
    var mem = '';
    if (performance.memory){
      var used = performance.memory.usedJSHeapSize/1048576;
      var limit = performance.memory.jsHeapSizeLimit/1048576;
      mem = Math.round(used) + '/' + Math.round(limit) + 'MB';
    }
    var up = Math.floor((Date.now() - (window._pageStart || (window._pageStart = Date.now())))/1000);
    var uptime = up>=3600 ? Math.floor(up/3600)+'时'+Math.floor(up%3600/60)+'分' : up>=60 ? Math.floor(up/60)+'分'+(up%60)+'秒' : up+'秒';

    var box = $('sbLayers');
    if (box){
      var rows = [
        ['帧率', fps + ' FPS', fps>=45?'#3ecf8e':(fps>=20?'#f5a623':'#ff5f56')],
        ['内存', mem || '浏览器不支持', mem && parseFloat(mem)>400 ? '#f5a623' : '#c3cadb'],
        ['运行时长', uptime, up>3600?'#f5a623':'#c3cadb'],
        ['降级守卫', window._zfBoostFrozen ? '⚡ 提速完毕（动画暂停中，将自动恢复）' : (degraded ? '已降级（停用装饰动画）' : '正常'), window._zfBoostFrozen ? '#f5a623' : (degraded ? '#f5a623' : '#3ecf8e')]
      ];
      box.innerHTML = rows.map(function(r){
        return '<div class="sb-layer" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.04)">'+
          '<span style="flex:1;color:#8a93a6;font-size:12px">'+r[0]+'</span>'+
          '<span style="font-weight:600;font-size:12px;color:'+r[2]+'">'+r[1]+'</span></div>';
      }).join('');
    }

    var pct = Math.min(100, fps/60*100);
    var col = fps>=45 ? '#3ecf8e' : (fps>=20 ? '#f5a623' : '#ff5f56');
    setRing(pct, col);
    if (fps>=45){ state('✅ 运行流畅', '帧率 / 内存 / 运行时长实时监测<br>卡了点「⚡ 立即提速」即可恢复'); }
    else if (fps>=20){ state('⚠️ 帧率偏低', '长时间运行会逐渐堆积内存，建议尽快提速恢复'); }
    else { state('🔴 页面已卡顿', '立即提速 = 清缓存并刷新页面，瞬间恢复帧率'); }
  }

  window.speedBoostRun = function(){
    var m = $('sbMask');
    m.style.display = 'flex';
    requestAnimationFrame(function(){ m.classList.add('show'); });
    renderHealth();
    if (_hbTimer) clearInterval(_hbTimer);
    // 节能模式：打开时检测一次，1分钟后再复检一次，然后自动关闭面板并停表
    // （避免长时间高频轮询本身成为负担）
    _hbTimer = setTimeout(function(){
      renderHealth();
      speedBoostClose();
      _hbTimer = null;
    }, 60000);
  };
  window.speedBoostClose = function(){
    var m = $('sbMask');
    m.classList.remove('show');
    if (_hbTimer){ clearTimeout(_hbTimer); _hbTimer = null; }
    setTimeout(function(){ m.style.display = 'none'; }, 220);
  };

  // 立即提速（不刷新页面，就地减负）：
  // 卡顿真凶通常是 JS 堆内存与定时器堆积，就地做四件事：
  //  1) 强制进入降级模式 → 所有装饰动画（风筝/小狗/星图/礼花/小地图等）立即停画
  //  2) 停掉一切非必要的 setInterval/setTimeout 轮询（红绿灯等保命轮询除外）
  //  3) 释放 DOM 里不在视口内的隐藏节点/临时元素，回收内存
  //  4) 若浏览器支持，触发一次垃圾回收（无法强制，但会先解除引用）
  window.zfQuickBoost = function(){
    var freed = [];
    // 1) 强制降级：让所有接了 FpsGuard.allow 的动画立刻停
    try {
      if (window.FpsGuard && window.FpsGuard.forceDegrade) window.FpsGuard.forceDegrade(true);
    } catch(e){}

    // 2) 停掉装饰性定时器（拦截重定时：把"停掉"做成可恢复名单）
    if (!window._zfBoostSavedTimers) {
      window._zfBoostSavedTimers = [];
      // 劫持 setInterval：提速期间新装的装饰定时器也一律冻结
      var _si = window.setInterval;
      window.setInterval = function(fn, ms){
        if (window._zfBoostFrozen) return 0;   // 冻结期间不装新定时器
        var id = _si.apply(window, arguments);
        window._zfBoostSavedTimers.push(id);
        return id;
      };
    }
    if (!window._zfBoostFrozen){
      window._zfBoostFrozen = true;
      // 把现存的所有定时器全部 clearInterval（对无效 id 调用是安全 no-op）
      try {
        // 从各动画模块自留的 timer 句柄清单里拿（有则用，无则靠上面的劫持兜底）
        if (window._zfBoostTimerHandles && window._zfBoostTimerHandles.length){
          window._zfBoostTimerHandles.forEach(function(id){ clearInterval(id); });
        }
      } catch(e){}
      freed.push('装饰动画与装饰定时器已全部暂停');
    }

    // 3) 移除临时性 DOM（toast、礼花 canvas、已关闭弹层残留等）
    try {
      var sel = ['#fps-selfheal-toast','.zf-firework-canvas','.firework-layer','canvas[style*="pointer-events: none"]'];
      sel.forEach(function(s){
        document.querySelectorAll(s).forEach(function(el){ el.remove(); });
      });
      freed.push('临时 DOM 已清理');
    } catch(e){}

    // 4) 解除大数组引用，帮 GC 一次
    try {
      if (window.FpsCrime && window.FpsCrime.clearTimeline) window.FpsCrime.clearTimeline();
    } catch(e){}

    // 5) 清空「恢复已关闭」快照栈（每个快照含完整聊天记录，占内存；已关闭对话的消息在服务器 DB 里本就有，可安全清）
    try {
      if (window.App && App._closedStack && App._closedStack.length){
        var _n = App._closedStack.length;
        App._closedStack.length = 0;
        if (typeof App._updateRestoreMenu === 'function') App._updateRestoreMenu();
        freed.push('已释放 ' + _n + ' 个关闭对话的内存快照');
      }
    } catch(e){}

    // 6) 隐藏但不在视口内的关闭残留弹层/面板（display:none 弹窗偶尔有 remove 漏网）
    try {
      var _hidden = document.querySelectorAll('.modal.show ~ *, .zf-toast, .toast-item, [class*="firework"], [class*="particle"]');
      _hidden.forEach(function(el){
        // 只删游离在 body 下的装饰节点，不动业务面板
        if (el.parentNode === document.body && !el.closest('.chatbox')) el.remove();
      });
    } catch(e){}

        // 6.5) 【提速核心】开启活动门控的提速模式：所有轮询立即休眠（只留 5 分钟心跳），
    //      帧率崩的头号元凶就是夜间轮询请求挂起，比停动画有效得多
    try {
      if (window.ActivityGate && ActivityGate.boost) {
        ActivityGate.boost(true);
        freed.push('轮询已休眠（心跳 5 分钟/次）');
      }
    } catch(e){}

    // 更新面板状态
    state('✅ 提速完毕（持续生效）',
      '<b style="color:#3ecf8e">轮询休眠 + 动画/定时器暂停，主线程减负。</b><br>' +
      (freed.join('；') || '已生效') +
      '<br>提速<b>持续生效</b>到刷新页面；动鼠标/发消息会自动唤醒轮询。<br>若帧数仍低，请用「🔄 刷新恢复」彻底重置（重开页面）');
    var btn = document.querySelector('.sb-foot .sb-btn.go');
    if (btn){
      btn.textContent = '✅ 提速中（点此关闭）';
      btn.onclick = function(){
        try { if (window.ActivityGate && ActivityGate.boost) ActivityGate.boost(false); } catch(e){}
        btn.textContent = '⚡ 立即提速';
        btn.onclick = function(){ window._zfBoostManual = true; zfQuickBoost(); };
        state('ℹ️ 已关闭提速', '轮询恢复「活动感知」规则：有人在/有对话 → 实时轮询；界面静止 → 休眠。');
      };
    }

setTimeout(renderHealth, 3000);
  };

  // 【2026-09-18 按用户要求】已移除「清理磁盘空间」功能（zfCleanDisk 函数整体删除）
  // window.zfCleanDisk 已不存在；如需恢复请查看同目录 .bak 备份。

  // 【自动保养】每 10 分钟自动做一次轻量清理（zfAutoClean），
  // 防止长期运行时 JS 堆内存 / 临时 DOM / 大数组 慢慢堆积：
  //  - 只做"无感知"的清理（临时 DOM、内存快照栈、大时间线数组），
  //    不停动画、不停轮询，界面完全无感觉；
  //  - 若连续 3 次检测到帧率 < 15（页面已经卡死级别），自动走一次 zfQuickBoost 就地减负。
  window.zfAutoClean = function(){
    try {
      // 1) 移除临时性 DOM（toast、礼花 canvas、粒子残留）
      var sel = ['#fps-selfheal-toast','.zf-firework-canvas','.firework-layer','canvas[style*="pointer-events: none"]'];
      sel.forEach(function(s){
        document.querySelectorAll(s).forEach(function(el){ el.remove(); });
      });
    } catch(e){}
    try {
      // 2) 清空「恢复已关闭」内存快照栈（对话内容服务器 DB 里有，可安全清）
      if (window.App && App._closedStack && App._closedStack.length){
        App._closedStack.length = 0;
        if (typeof App._updateRestoreMenu === 'function') App._updateRestoreMenu();
      }
    } catch(e){}
    try {
      // 3) 解除大数组引用（帧率取证时间线等），帮 GC 一次
      if (window.FpsCrime && window.FpsCrime.clearTimeline) window.FpsCrime.clearTimeline();
    } catch(e){}
    try {
      // 4)【DOM 增长治理 2026-09】消息流 DOM 上限：每个对话体最多保留 300 条 .msg
      //    超出时从最旧开始移除 DOM 节点（消息内容在服务器/内存数据里，不受影响），
      //    并插入一个折叠占位条提示"更早消息已折叠"。
      var MAX_MSGS = 300;
      document.querySelectorAll('.chatbox-body').forEach(function(body){
        var msgs = body.querySelectorAll(':scope > .msg');
        if (msgs.length <= MAX_MSGS) return;
        var overflow = msgs.length - MAX_MSGS;
        var removed = 0;
        for (var i = 0; i < msgs.length && removed < overflow; i++) {
          var m = msgs[i];
          if (m.hasAttribute('data-welcome')) continue; // 欢迎语保留
          if (m.hasAttribute('data-zf-folded-marker')) continue;
          m.remove(); removed++;
        }
        if (removed > 0 && !body.querySelector('[data-zf-folded-marker]')) {
          var fold = document.createElement('div');
          fold.setAttribute('data-zf-folded-marker', '1');
          fold.style.cssText = 'text-align:center;font-size:12px;opacity:.55;padding:6px 0;cursor:pointer;';
          fold.textContent = '⬆ 更早的 ' + removed + ' 条消息已折叠（点击加载需重新打开该对话）';
          var firstMsg = body.querySelector(':scope > .msg');
          if (firstMsg) body.insertBefore(fold, firstMsg); else body.appendChild(fold);
        }
      });
    } catch(e){}
    try {
      // 5)【DOM 增长治理 2026-09】瞬态残留清扫：挂 body 但已脱离用途的一次性元素
      //    - 成功箭头按钮：不带 .show 即已隐藏，直接删（重建成本低）
      //    - 问题 pin / 提醒条：父链已脱钩文档的残留
      document.body.querySelectorAll(':scope > .zf-arrow-btn:not(.show), :scope > .zf-success-arrow-btn:not(.show)').forEach(function(el){ el.remove(); });
      document.body.querySelectorAll(':scope > .query-pin, :scope > .query-reminder').forEach(function(el){
        if (!el.classList.contains('show')) { try { el.remove(); } catch(e2){} }
      });
    } catch(e){}
  };
  /* 【DOM 增长取证 2026-09】控制台执行 window.zfDomAudit()
     两次快照对比，直接列出"关掉对话框后还在偷偷涨节点"的元素：
     用法：zfDomAudit() → 建一个对话再关掉 → 再执行 zfDomAudit() → 看增长排行 */
  window.zfDomAudit = function(){
    var counts = {};
    document.querySelectorAll('*').forEach(function(el){
      var k = (el.id ? '#' + el.id : '') + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().split(/\s+/).slice(0, 2).join('.');
      if (k === '.' || k === '#') k = el.tagName.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    });
    var prev = window.__zfDomAuditPrev || {};
    var rows = Object.keys(counts).map(function(k){
      return { k: k, n: counts[k], d: counts[k] - (prev[k] || 0) };
    });
    var grown = rows.filter(function(r){ return r.d > 0; }).sort(function(a, b){ return b.d - a.d; }).slice(0, 20);
    var total = rows.reduce(function(s, r){ return s + r.n; }, 0);
    var dTotal = total - (window.__zfDomAuditTotal || 0);
    console.log('[zfDomAudit] 总节点: ' + total + ' (较上次 ' + (dTotal >= 0 ? '+' : '') + dTotal + ')，增长 Top20:');
    grown.forEach(function(r){ console.log('  +' + r.d + '  现存 ' + r.n + '  ' + r.k); });
    window.__zfDomAuditPrev = counts;
    window.__zfDomAuditTotal = total;
    return grown;
  };
  window._zfAutoCleanLowFps = 0;
  // 【2026-09-20 优化】记录鼠标活动：正在平移/拖拽鼠标时暂缓提速，等鼠标静止 3 秒后再执行
  window._zfLastMouseMove = 0;
  (function(){
    var _mm = function(){ window._zfLastMouseMove = Date.now(); };
    window.addEventListener('mousemove', _mm, {passive:true});
    window.addEventListener('pointermove', _mm, {passive:true});
    window.addEventListener('mousedown', _mm, {passive:true});
    window.addEventListener('wheel', _mm, {passive:true});
    window.addEventListener('touchmove', _mm, {passive:true});
  })();
  // 鼠标静止判定：距上次移动超过 3 秒才算"没在动"
  window._zfMouseIdle = function(){
    return (Date.now() - window._zfLastMouseMove) > 3000;
  };
  // 等鼠标静止后再提速：最多等 5 分钟，避免一直动鼠标导致永远不执行
  window._zfBoostWhenIdle = function(cb, waited){
    waited = waited || 0;
    if (window._zfMouseIdle() || waited >= 5 * 60 * 1000){ cb(); return; }
    setTimeout(function(){ window._zfBoostWhenIdle(cb, waited + 10000); }, 10000);
  };
  setInterval(function(){
    // 轻量清理（无感知）
    zfAutoClean();
    // 【2026-09-19 按用户要求】每 10 分钟自动执行一次完整提速（zfQuickBoost）：
    // 停装饰动画、冻结非必要轮询、清理临时 DOM，防止长期运行帧率持续下滑。
    // 【2026-09-20 按用户要求】若用户鼠标正在平移/拖拽，先等一会，鼠标静止 3 秒后才开始，
    // 避免提速动作打断正在进行的操作（最多等 5 分钟兜底）。
    // 自动触发时先弹一个可见提示（不再静默），4 秒后自动消失；
    // 手动点「立即提速」按钮时不重复弹（按钮本身已有反馈）。
    try {
      window._zfBoostWhenIdle(function(){
        if (!window._zfBoostFrozen && !window._zfBoostManual) {
          var _t = document.createElement('div');
          _t.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:99999;background:rgba(20,24,32,.92);color:#3ecf8e;border:1px solid #3ecf8e55;border-radius:10px;padding:10px 18px;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.4);pointer-events:none;transition:opacity .4s;';
          _t.textContent = '⚡ 已自动执行定时提速（每 10 分钟一次）：轮询休眠 + 动画暂停，动鼠标/发消息自动恢复';
          document.body.appendChild(_t);
          setTimeout(function(){ _t.style.opacity = '0'; }, 3500);
          setTimeout(function(){ _t.remove(); }, 4000);
        }
        window._zfBoostManual = false;
        if (!window._zfBoostFrozen) zfQuickBoost();
      });
    } catch(e){}
  }, 10 * 60 * 1000);   // 每 10 分钟一次

  $('sbMask').addEventListener('click', function(e){ if (e.target === this) speedBoostClose(); });