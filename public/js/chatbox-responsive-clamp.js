/* ===== 对话框响应式钳制（v3）：.chatbox 内联定位统一钳制
   规则（v10，2026-11 用户要求「小窗也要居中」）：
   1. 任意宽度的独立浮窗对话框 → 一律水平居中，两侧出现留白（留白=clamp(16,2.5vw,180)）
      （v3~v9 曾规定 ≤500px 小窗保持拖放位置，已废弃）
   2. 垂直方向不强制居中，仍钳制在视口内、底部留 inset 空隙不贴底
   3. v11（UI师审查修复「拖拽即回弹」）：用户在对话框内按下鼠标（pointerdown 捕获）
      即标记 __cbUserDragged，本次页面会话内 clampAll 不再水平拉回居中（仍钳制不出屏）；
      刷新/新开页面后标记消失，自动恢复居中。尊重拖放意图，新会话回归默认居中。
   原理：.chatbox 的 left/top/width/height 由 JS 内联像素写死，CSS clamp 被覆盖，
   必须用本脚本钳制。v3：DOMNodeInserted(废弃) → MutationObserver。 */
(function () {
    'use strict';
    var CENTER_MIN_W = 500;
    function calcSidePad(w) {
        /* 【约束注释】窄窗分支保底 15px：chatbox-bottom-merge.css 输入框对齐公式
           width: calc(100% - 2 * (var(--cb-side-pad) - 10px)) 依赖 pad >= 10px，
           否则 width 会超过 100%（margin 为负）。15px 保底保证 margin 恒为正值。
           改动此下限前必须同步核查该 CSS 公式。 */
        return (w > CENTER_MIN_W)
            ? Math.round(w * 0.10)
            : Math.round(Math.min(180, Math.max(15, (w - 640) * 0.10)));
    } // 兼容保留：仍用于内部 padding 规则（>500 → padding=宽度10%）
    function getInset() {
        var v = 0.025 * window.innerWidth;
        return Math.max(16, Math.min(180, v));
    }
    function clampAll() {
        var inset = getInset();
        var vw = window.innerWidth, vh = window.innerHeight;
        var canvasContent = document.getElementById('canvasContent');
        var canvasArea = document.getElementById('canvasArea');
        document.querySelectorAll('.chatbox').forEach(function (el) {
            /* 【v13 修复 2026-11-30 专注模式新建对话"时好时坏没有10% padding"】
               collapsed 早退原本在本行之前，导致折叠过的对话框 --cb-side-pad 永不写入
               （CSS 回落 10px）。现把 pad 写入提前到 collapsed 检查之前：
               折叠只应豁免"位置钳制"，不应豁免"内部留白变量"。 */
            /* 【v14 修复 2026-12-16 专注模式新建对话"时好时坏没有10% padding"·根修】
               v13 只是挪了写入顺序，真正的竞态还在：doNewSession 里 createChatBox 后
               hostBox 把窗搬进 .zf-stage 并改成 width:100%。在这个瞬间窗口可能尚未
               完成布局（offsetWidth==0 或仍是旧的小宽度），此时 clampAll 按小宽度
               算出 15px 保底并写入，之后没人再触发重算 → 界面上就是"没 padding"。
               时好时坏取决于 MutationObserver 50ms 延时是否恰逢布局完成。
               修复原则：拿不到可信宽度就【不写】（保留旧值/回落），等 ResizeObserver
               在真实尺寸铺开后必然再触发一次写入，最终值一定正确。 */
            var ow0 = el.offsetWidth;
            var swRaw = (el.style.width || '').trim();
            var w0;
            /* 【v15 修复 2026-12-17 专注模式10% padding·竞态终修】
               专注模式下被 host 进 .zf-stage 的窗（width:100%），一律按 .zf-stage
               实际宽度计算 10% padding，不再信 offsetWidth——host 瞬间 offsetWidth
               可能还是旧小宽度，按它算出的错误小值会以 inline 形式残留（CSS 兜底
               会被 inline 覆盖）。stage 宽度远大于 500px，恒走 10% 分支，符合
               用户裁定「专注模式必然 >500px，默认 10%」。 */
            var _zfStage = (document.body.classList.contains('zf-focus') && el.closest && el.closest('.zf-stage')) ? el.closest('.zf-stage') : null;
            if (_zfStage) {
                var _stw = _zfStage.clientWidth;
                if (_stw > 500) {
                    var _pad15 = Math.round(_stw * 0.10) + 'px';
                    if (el.style.getPropertyValue('--cb-side-pad') !== _pad15) {
                        el.style.setProperty('--cb-side-pad', _pad15);
                    }
                    if (el.classList.contains('collapsed')) return;
                    return; /* stage 内窗位置由专注布局接管，无需钳制 */
                }
                /* stage 宽度异常（<500）→ 落到下方通用逻辑，不写则 CSS 兜底 10% 生效 */
            }
            if (ow0 > 0) {
                w0 = ow0;                       // 有真实布局值 → 信 offsetWidth
            } else if (/%$/.test(swRaw)) {
                return;                          // 百分比宽度且无布局值 → 无法计算，跳过本轮
            } else {
                w0 = parseFloat(swRaw) || 0;
                if (!(w0 > 0)) return;           // 完全拿不到宽度 → 跳过本轮
            }
            var pad = calcSidePad(w0);
            var padNext = pad + 'px';
            if (el.style.getPropertyValue('--cb-side-pad') !== padNext) {
                el.style.setProperty('--cb-side-pad', padNext);
            }
            if (el.classList.contains('collapsed')) return;
            /* 【v6 留白修复】画布内对话框：位置钳制早退，但 pad 已在上方写入。 */
            /* 【bug修复 2026-11-15 位置归零】挂在画布 #canvasContent 内的对话框是
               世界坐标节点（跟随摄像机 transform），其 left/top 是画布坐标而非视口坐标，
               一律禁止用视口尺寸钳制——否则画布平移后所有节点会被钳到视口范围，
               全部堆到原点变成一个点。只钳制独立浮窗（不在画布容器内的）。 */
            if (canvasContent && canvasContent.contains(el)) return;
            if (canvasArea && canvasArea.contains(el)) return;
            var left = parseFloat(el.style.left), top = parseFloat(el.style.top);
            var w = parseFloat(el.style.width), h = parseFloat(el.style.height);
            // v4：实际显示宽优先用 offsetWidth —— CSS merge 层可能用 max-width 把
            // 内联 width 压小，用内联值算居中会偏；offsetWidth 是浏览器最终布局值。
            var ow = el.offsetWidth, oh = el.offsetHeight;
            if (ow > 0) w = ow;
            if (oh > 0) h = oh;
            if (isNaN(left)) left = el.offsetLeft;
            if (isNaN(top)) top = el.offsetTop;
            var maxW = vw - inset * 2, maxH = vh - inset * 2;
            if (w > maxW) { w = maxW; el.style.width = w + 'px'; }
            if (h > maxH) { h = maxH; el.style.height = h + 'px'; }
            // 规则1（v10→v11）：默认任意宽度一律水平居中；但用户本会话内
            // 手动拖过该对话框（pointerdown 标记 __cbUserDragged）则尊重其位置，
            // 只做出屏钳制不拉回，刷新页面后恢复默认居中。
            var newLeft = el.__cbUserDragged ? left : Math.round((vw - w) / 2);
            if (newLeft !== left) el.style.left = newLeft + 'px';
            /* v11a（UI师审查②）：首次拖拽标记时弹一次性提示，告知「刷新恢复居中」，
               避免用户下次刷新看到位置回中又当成 bug 报障（本工单即由此而来）。 */
            if (el.__cbUserDragged && !el.__cbDragToastShown) {
                el.__cbDragToastShown = true;
                if (typeof window.showToast === 'function') {
                    window.showToast('已记住对话框拖放位置（本次会话内有效，刷新后恢复居中）');
                }
            }
            // v5：内部两侧留白已在循环开头统一写入（含画布内对话框）
            // 规则2：底部留 inset 空隙
            var newTop = Math.min(Math.max(top, 0), vh - inset - h);
            if (newTop !== top) el.style.top = newTop + 'px';
        });
    }
    /* v11：pointerdown 捕获标记用户拖拽意图。挂在 document 捕获阶段。
       v12（2026-11-16 用户报障「对话框不居中」修复）：旧版只要在对话框内
       任意位置按下鼠标（包括点输入框打字）就标记 __cbUserDragged，导致
       对话框从此不再拉回居中。现收紧为只有按在标题栏（.chatbox-header）
       且不是按钮时才认定拖拽意图；点输入框/消息区不再劫持居中逻辑。 */
    document.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        var header = e.target && e.target.closest && e.target.closest('.chatbox-header');
        if (!header) return;
        if (e.target.closest('.hd-btn') || e.target.closest('button') ||
            e.target.closest('input') || e.target.closest('select')) return;
        var box = header.closest('.chatbox');
        if (!box) return;
        var sx = e.clientX, sy = e.clientY;
        function onMove(ev) {
            var dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (dx * dx + dy * dy > 64) { // 位移 > 8px 才认定真实拖拽
                box.__cbUserDragged = true;
                window.removeEventListener('pointermove', onMove, true);
                window.removeEventListener('pointerup', onUp, true);
            }
        }
        function onUp() {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
        }
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
    }, true);
    var _t = null;
    window.addEventListener('resize', function () {
        clearTimeout(_t); _t = setTimeout(clampAll, 120);
    });
    // 创建/恢复/删除后钳一次（MutationObserver，兼容性好）
    // v4：补监听 attributes.style —— 拖拽/缩放对话框改的是内联 style，
    // 只听 childList 时改宽度不会触发钳制，导致「按宽度调整两侧空白」不生效。
    // 防死循环：clampAll 只在值变化时才回写，收敛后不再触发 observer。
    var _clampT = null;
    function scheduleClamp(delay) {
        clearTimeout(_clampT);
        _clampT = setTimeout(function () { clampAll(); _clampT = null; }, delay || 50);
    }
    new MutationObserver(function () { scheduleClamp(50); })
        .observe(document.body || document.documentElement, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['style']
        });
    // 兜底轮询（前 5 秒，覆盖异步恢复路径）
    var n = 0;
    var iv = setInterval(function () { clampAll(); if (++n >= 16) clearInterval(iv); }, 300);
    /* v8（2026-11-15 用户反馈）：新建对话框一开始不走 padding 规则，最大化窗口后才生效。
       根因：对话框刚创建时 offsetWidth 还是初始小值（宽度是后续 JS/CSS 才铺开的），
       clampAll 当时按小宽度算出 15px 保底；只有窗口 resize 才重算。
       修复：对每个 .chatbox 挂 ResizeObserver，尺寸一变（含创建后铺开的第一帧）
       立即重算 --cb-side-pad，不再依赖 window.resize。 */
    var _ro = new ResizeObserver(function (entries) {
        entries.forEach(function (en) {
            var el = en.target;
            /* 【v14 配套修复】专注模式 hosted 窗 width:100%：内联值解析不出像素，
               拿不到可信宽度时【不写】，避免按 0 算出 15px 保底覆盖正确值。
               clampAll(v14) 同策略；布局铺开后本回调会以真实 offsetWidth 再触发。 */
            var ow = el.offsetWidth;
            var swRaw = (el.style.width || '').trim();
            var w;
            /* 【v15 配套】专注模式 stage 内窗：同 clampAll，按 stage 宽算 10%；
               拿不到可信 stage 宽则直接 return，让 CSS 10% 兜底生效。 */
            var _zfStage = (document.body.classList.contains('zf-focus') && el.closest && el.closest('.zf-stage')) ? el.closest('.zf-stage') : null;
            if (_zfStage) {
                var _stw2 = _zfStage.clientWidth;
                if (!(_stw2 > 500)) return;
                w = _stw2;
            } else if (ow > 0) {
                w = ow;
            } else if (/%$/.test(swRaw)) {
                return;
            } else {
                w = parseFloat(swRaw) || 0;
                if (!(w > 0)) return;
            }
            var pad = calcSidePad(w);
            var padNext = pad + 'px';
            if (el.style.getPropertyValue('--cb-side-pad') !== padNext) {
                el.style.setProperty('--cb-side-pad', padNext);
            }
        });
    });
    function observeChatboxes() {
        document.querySelectorAll('.chatbox').forEach(function (el) {
            if (!el.__cbRO) { _ro.observe(el); el.__cbRO = true; }
        });
    }
    observeChatboxes();
    var _roT = null;
    new MutationObserver(function () {
        clearTimeout(_roT); _roT = setTimeout(observeChatboxes, 30);
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.__chatboxResponsiveClamp = clampAll;
})();
