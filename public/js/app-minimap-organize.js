// ============================================================
// 【⚠️ 部分作废 · 口径澄清 2026-11-22 策划案】
// 此文件的【旧渐变卡片 i整理面板 UI】已作废（2026-11-19 用户拍板），禁止启用、禁止还原；
// 当前正确版本是【真对话框缩小版】：app-canvas.js 的 canvasOverviewToggle（摄像机缩小真窗口+总览 dock）。
// 但本文件的【总览 dock 段（buildDock：新建/一排/隐藏/显示/省电/派出/建组/展开/返回）】
// 【zf-chat-hidden/zf-group-hidden 隐藏样式注入与 5s 恢复轮询】【组隐藏联动 _applyGroupHiddenToDom】
// 仍是【现行实现】，index.html 正常加载中——拆文件/删代码时务必保留这些段落，勿整文件作废！
// 详见 docs/策划案-画布对话FPS优化-20261122.md §三#4（口径漂移清单）。
// ============================================================
// ========== app-minimap-organize.js - 小地图i整理 ==========
// 放大版小地图：卡片式节点（标题+颜色块），框选/拖拽/分组/Delete 关闭
// 主画布零改动：面板内拖拽 → 同步真实节点 offsetLeft/offsetTop
// 快捷键：点选=单击 | 拖拽=点住卡片 | 框选=空白拖拽 | Shift+框=加选 | Ctrl+框=减选 | Delete=关闭
(function() {
    'use strict';

    var GROUP_KEY = 'zf_minimap_groups';
    // 【小方块化 v1】true=全屏i缩小整理最佳版（渐变卡片+标题+圆点+滚轮缩放）；false=废弃小方块色板版
    var MO_LEGACY = true; // 【2026-11-19 用户拍板】true=全屏i缩小整理最佳版（渐变卡片+标题+左上角圆点+滚轮缩放）；false=废弃小方块色板版，勿再反转

    // ===== 分组数据：{id, name, color, nodeIds:[]} =====
    var groups = [];
    try { groups = JSON.parse(localStorage.getItem(GROUP_KEY) || '[]'); } catch (e) { groups = []; }
    function saveGroups() {
        try { localStorage.setItem(GROUP_KEY, JSON.stringify(groups)); } catch (e) {}
        if (typeof _gIdxCache !== 'undefined') _gIdxCache = null; // 【自动分组】组变更 → 角标反查缓存失效
        try { document.dispatchEvent(new CustomEvent('zf-minimap-groups-changed')); } catch (e) {} // 【缩略图同步】通知右下角小地图重读分组
        _applyGroupHiddenToDom(); // 【组隐藏联动 v1】折叠/隐藏组 → 成员 chatbox 同步 zf-group-hidden 类（画布/i导航真隐藏提帧率）
        _orgSyncGroupsToServer(); // 【S3 落库 v1】分组归属同步 canvas_node_ext(src='org')
    }

    // =====【组隐藏联动 v1】折叠/隐藏组的成员 chatbox 挂 zf-group-hidden 类 =====
    // 语义（用户拍板 2026-11-21）：分组最小化(折叠)/隐藏 都算"隐藏"→ 无限画布普通模式 & i导航 display:none
    // 真隐藏（移出渲染树→真实提帧率）；i整理模式留 content-visibility:hidden 虚线框（见 zf-chat-hidden-style 注入段）。
    function _applyGroupHiddenToDom() {
        try {
            var hideIds = {};
            groups.forEach(function (g) {
                if (g && (g.hidden || g.collapsed)) (g.nodeIds || []).forEach(function (nid) { hideIds[nid] = true; });
            });
            var boxes = document.querySelectorAll('.chatbox');
            for (var i = 0; i < boxes.length; i++) {
                var bx = boxes[i];
                /* 【P0-1 策划案 20261122】专注模式舞台上的窗（zfHosted）跳过回挂：hostBox 上台时
                   已摘 zf-group-hidden 唤醒显示，5s 轮询若打回会导致舞台空白；撤台时 unhost 按唤醒记录还原 */
                if (hideIds[bx.id]) { if (!bx.classList.contains('zf-group-hidden') && bx.dataset.zfHosted !== '1') bx.classList.add('zf-group-hidden'); }
                else if (bx.classList.contains('zf-group-hidden')) bx.classList.remove('zf-group-hidden');
            }
        } catch (e) {}
    }

    // =====【S3 落库 v1】分组归属持久化到后端 canvas_node_ext（src='org'，与 i工程 'eng' 并存隔离） =====
    // 策略：组内节点 upsert group_id=<组id>；曾属组现在不在任何组的节点写 group_id=''（清除）。
    // fire-and-forget：后端 404（非画布节点）静默跳过，失败不阻塞本地 localStorage 主路径。
    var _orgSyncedMap = {}; // nid -> 上次同步的 group_id（避免重复推送）
    var _orgServerLoaded = false;
    function _orgSyncGroupsToServer() {
        if (_orgServerLoaded !== true) return; // 启动还原完成前不推，防用旧本地数据覆盖后端新数据
        var want = {}; // nid -> groupId
        groups.forEach(function (g) {
            (g.nodeIds || []).forEach(function (nid) { want[nid] = g.id; });
        });
        Object.keys(_orgSyncedMap).forEach(function (nid) {
            if (!(nid in want)) want[nid] = ''; // 移出组 → 清 group_id
        });
        Object.keys(want).forEach(function (nid) {
            if (_orgSyncedMap[nid] === want[nid]) return;
            _orgSyncedMap[nid] = want[nid];
            try {
                fetch('/api/engineering/node/upsert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: nid, group_id: want[nid], src: 'org' })
                }).catch(function () { _extEnqueue({ id: nid, group_id: want[nid], src: 'org' }); }); // 【P2 门禁】失败回弹重试队列
            } catch (e) {}
        });
    }
    // 启动还原：拉 /api/engineering/graph，把 src='org' 的 group_id 并回本地分组（并集，不覆盖本地新增）
    (function _orgRestoreGroups() {
        try {
            fetch('/api/engineering/graph').then(function (r) { return r.json(); }).then(function (d) {
                if (!d || d.ok !== true || !Array.isArray(d.nodes)) { _orgServerLoaded = true; return; }
                var dirty = false;
                d.nodes.forEach(function (n) {
                    if (n.src !== 'org' || !n.groupId) return;
                    var g = null;
                    for (var i = 0; i < groups.length; i++) { if (groups[i].id === n.groupId) { g = groups[i]; break; } }
                    if (!g) { // 后端有、本地无此组 → 重建组壳（名字用组id，颜色取色板轮转）
                        g = { id: n.groupId, name: n.groupId, color: GROUP_COLORS[groups.length % GROUP_COLORS.length], nodeIds: [] };
                        groups.push(g); dirty = true;
                    }
                    if ((g.nodeIds || []).indexOf(n.id) < 0) { g.nodeIds.push(n.id); dirty = true; }
                    _orgSyncedMap[n.id] = n.groupId;
                });
                if (dirty) {
                    try { localStorage.setItem(GROUP_KEY, JSON.stringify(groups)); } catch (e) {}
                    try { document.dispatchEvent(new CustomEvent('zf-minimap-groups-changed')); } catch (e) {}
                }
                /* 【done 恢复闭环】graph 回读 ext.done → 回填 zf_org_done（修复「已完成」标记刷新后丢失；
                   只增不删：本地未标记的节点才回填，避免覆盖用户本地取消操作） */
                try {
                    var _dm = JSON.parse(localStorage.getItem('zf_org_done') || '{}');
                    var _dDirty = false;
                    d.nodes.forEach(function (n) {
                        if (n && n.id && n.done && !_dm[n.id]) { _dm[n.id] = 1; _dDirty = true; }
                    });
                    if (_dDirty) try { localStorage.setItem('zf_org_done', JSON.stringify(_dm)); } catch (eD2) {}
                } catch (eD1) {}
                _orgServerLoaded = true;
            }).catch(function () { _orgServerLoaded = true; });
        } catch (e) { _orgServerLoaded = true; }
    })();
    var GROUP_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63'];

    // ===== DOM 创建（一次） =====
    var overlay = null, panel = null, body = null, cvs = null, ctx = null;
    var btnGroup = null, btnUngroup = null, btnRename = null, btnDissolve = null;
    var namePop = null, nameInput = null;
    var active = false;
    var _$orgTickTs = 0; // 【S1 收编】主渲染循环内 1s 节流时间戳（渲染闭包内可见）
    var _pendingWinRect = null; // 【位置记忆修复】ensureDom 时面板 display:none，offset 值全为 0，当场 _clampRect 会把记忆覆盖成 0；延迟到 open() 面板可见后再应用
    var _applyWinRect = null;   // ensureDom 内注入的应用函数（供 open 调用）
    var boxes = [];           // 卡片：{el, x, y, w, h, title, color}
    var boxRects = [];        // 面板坐标缓存
    var selected = new Set(); // el -> true
    var groupsNeedSync = false;

    // 【加减选修复】修饰键真实状态跟踪（作用域：IIFE 顶层，onDown/onMove 可访问）
    // mousemove 的 e.shiftKey/e.ctrlKey 在部分场景（焦点切换/事件合成/按键瞬间）读不到，
    // 用 window 级 keydown/keyup 维护权威状态，取事件标志与键状态的"或"。
    var _shiftHeld = false, _ctrlHeld = false, _altHeld = false;
    var _stackSampleTs = 0; // 【fps v11】render() 调用者堆栈采样时间戳
    var _dragBoxIdx = null, _dragBoxIdxDirty = true; // 【fps v11】拖拽帧 el->box Map 索引（boxes 重建后置脏）
    // 【工作台虚拟框修复】_wbVisCache 原先从未声明，首次读取抛 ReferenceError 被 catch 吞掉，
    // 导致 _renderBlocksNow 里整段虚拟框绘制逻辑静默失效（面板上看不到工作台虚拟框）
    var _wbVisCache = {};
    function modsHeld(e) {
        return {
            shift: !!(e && e.shiftKey) || _shiftHeld,
            ctrl: !!(e && e.ctrlKey) || _ctrlHeld,
            alt: !!(e && e.altKey) || _altHeld
        };
    }
    // 【键位映射 v2】修饰键语义（用户钦定）：
    //   Ctrl = 加选（点选 + 框选）  Alt = 减选（点选 + 框选）  Shift = 加选别名（兼容旧习惯）
    //   无修饰键 = 全新选择/单击空白清除选择

    function ensureDom() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'minimap-organize-overlay';
        overlay.innerHTML =
            '<div class="mo-panel">' +
                '<div class="mo-toolbar">' +
                    '<div class="mo-tools">' +   /* 【窄面板 v1】左侧按钮区：可被裁切，天然隐藏溢出按钮 */
                        '<button class="mo-btn mo-back" id="moBackBtn" title="返回主窗口（退出i整理，位置自动写回）">← 返回</button>' +
                        '<span class="mo-title">i整理</span>' +
                        '<span class="mo-sep"></span>' +
                        '<button class="mo-btn mo-arr" data-rows="1" title="所选（未选中则全部）卡片排成 1 个横排，卡片最多按 500px 计宽，间距 80px">1排</button>' +
                        '<span class="mo-sep"></span>' +
                        '<button class="mo-btn" id="moRunBtn" title="只对框选中的对话生效：播放=批量继续工作，停止=停止并保存数据。绿色=待播放，红色=运行中">▷ 播放</button>' +
                    '</div>' +
                    '<button class="mo-close-x" id="moCloseXBtn" title="关闭工具栏（与「← 返回」等价，位置自动写回）">×</button>' +   /* 【窄面板 v1】绝对定位右上，任何宽度都可见 */
                '</div>' +
                '<div class="mo-body"><canvas class="mo-canvas"></canvas></div>' +   /* 【修复】小方块模式改版时丢失了画布容器，导致 cvs=null 在 getContext 抛错，namePop/关闭按钮绑定全部未执行 → 面板空白、× 不可用 */
                '<div class="mo-subbar">' +   /* 【v4】角色派发按钮下沉到面板底部独立工具条 */
                    '<button class="mo-btn mo-role" data-role="thinker" title="对所选（未选中则全部）对话批量派发策划师：开新窗出策划案">策划师</button>' +
                    '<button class="mo-btn mo-role" data-role="verify" title="对所选（未选中则全部）对话批量派发审核员：开新窗独立审核">审核员</button>' +
                    '<button class="mo-btn mo-role" data-role="summarizer" title="对所选（未选中则全部）对话批量派发总结师：沉淀总结并落盘">总结师</button>' +
                    '<button class="mo-btn mo-role" data-role="custom" title="对所选（未选中则全部）对话批量派发自定义角色（共用一句话叮嘱）">自定义</button>' +
                    '<span class="mo-sep"></span>' +
                '</div>' +
                '<div class="mo-rz" data-dir="n"></div><div class="mo-rz" data-dir="s"></div>' +
                '<div class="mo-rz" data-dir="e"></div><div class="mo-rz" data-dir="w"></div>' +
                '<div class="mo-rz mo-rz-se" data-dir="se" title="拖拽调整面板大小"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        // 【2026-11-22 修复·废弃面板裸露条】minimap-organize.css 已随旧 i整理下线物理删除（9427e946），
        //   但总览 dock（buildDock→ensureDom）仍需这里创建的面板 DOM 供事件绑定/桥接复用，
        //   overlay 失去原 CSS 的 display:none 兜底后，进入 i缩小整理时旧面板以裸块形式常驻页面底部
        //   （用户看到「← 返回|i整理|1排|▷播放 ×」+「策划师/审核员/总结师/自定义」压扁条）。
        //   与下方 moNamePopCss 同模式注入自包含样式：默认强制隐藏；旧 open() 兜底通道万一被调用仍按 active 正常显示。
        if (!document.getElementById('moLegacyPanelCss')) {
            var _olCss = document.createElement('style');
            _olCss.id = 'moLegacyPanelCss';
            _olCss.textContent =
                '.minimap-organize-overlay{display:none;position:fixed;inset:0;z-index:100050;}' +
                '.minimap-organize-overlay.active{display:flex;align-items:center;justify-content:center;}';
            document.head.appendChild(_olCss);
        }

        panel = overlay.querySelector('.mo-panel');
        body = overlay.querySelector('.mo-body');
        cvs = overlay.querySelector('.mo-canvas');
        if (cvs) { ctx = cvs.getContext('2d'); } else { console.error('[organize] .mo-canvas 缺失'); }
        _gradCache = {};   // 【修复】渐变对象绑定创建时的 context，canvas 重建后旧渐变静默失效，重建时必须清空缓存
        // 排列按钮：1排/2排/3排/4排 自动横排
        Array.prototype.forEach.call(overlay.querySelectorAll('.mo-arr'), function(b) {
            b.addEventListener('click', function() { arrangeRows(parseInt(b.dataset.rows, 10) || 1); });
        });
        var closeBtn = overlay.querySelector('#moCloseXBtn'); // 【退出按钮已删】只保留右上角 ×，残留的 #moCloseBtn 绑定会因 null 抛错导致后续按钮全部失效
        if (closeBtn) closeBtn.addEventListener('click', function() { close(); });
        // 【返回按钮 v103】工具栏左侧「← 返回」：与右上角 × 等价，调用同一 close()（位置写回逻辑完全一致）
        var backBtn = overlay.querySelector('#moBackBtn');
        if (backBtn) backBtn.addEventListener('click', function() { close(); });

        // ===== 播放/停止切换（v2：原左上角批量按钮迁入；v3：仅对选中对话生效） =====
        // 只对所选对话生效（未选中则提示先框选）；颜色即状态：绿 ▶=待播放，红 ■=运行中（每秒刷新）
        var _moRunBtn = overlay.querySelector('#moRunBtn');
        function _moRunTargets() {
            // 仅收集所选（有 chat 的）对话；未选中时返回空数组，由调用方提示
            var src = selected.size ? Array.from(selected) : [];
            var targets = [];
            src.forEach(function(el) {
                var _c = null;
                for (var i = 0; i < boxes.length; i++) {
                    if (boxes[i].el === el) { _c = boxes[i].chat; break; }
                }
                if (_c) targets.push({ chat: _c, el: el });
            });
            return targets;
        }
        function _refreshMoRunBtn() {
            if (!active || !_moRunBtn) return;
            // 未框选时回退按全部对话判断 working 状态，保证按钮颜色如实反映后台运行情况（仅显示用）
            var targets = _moRunTargets().length ? _moRunTargets() : _collectTargets();
            var working = window.BatchRunAPI && BatchRunAPI.anyWorking(targets);
            _moRunBtn.textContent = working ? '▢ 停止' : '▷ 播放';
            _moRunBtn.style.color = working ? '#ff6b6b' : '#5ee08a';
            _moRunBtn.title = working
                ? '运行中：点击停止所选正在工作的对话并保存数据'
                : '待播放：点击让所选对话批量继续工作（未框选对话时无效）';
        }
        _moRunBtn.addEventListener('click', function() {
            if (!window.BatchRunAPI) { _dlgAlert('批量运行模块未加载'); return; }
            var targets = _moRunTargets();
            if (!targets.length) { _dlgAlert('请先在面板中框选要操作的对话框，再点播放/停止'); return; }
            if (BatchRunAPI.anyWorking(targets)) {
                BatchRunAPI.stop(targets, true);
            } else {
                BatchRunAPI.start(targets);
            }
            _refreshMoRunBtn();
        });
        setInterval(_refreshMoRunBtn, 1000);

        // ===== 角色批量派发（策划师/审核员/总结师/自定义） =====
        overlay.querySelectorAll('.mo-role').forEach(function(btn) {
            btn.addEventListener('click', function() { dispatchRole(btn.getAttribute('data-role'), btn); });
        });


        // 命名弹窗
        // 【2026-11-30 修复·裸弹窗黑框】.mo-name-pop 的 CSS 在历史重构中丢失，
        //   无 display:none 兜底导致弹窗以默认块级元素常驻页面底部（用户看到"黑框"）。
        //   此处注入自包含样式：默认隐藏，active 时居中浮层显示。
        if (!document.getElementById('moNamePopCss')) {
            var _npCss = document.createElement('style');
            _npCss.id = 'moNamePopCss';
            _npCss.textContent =
                '.mo-name-pop{display:none;position:fixed;z-index:100000;background:#1f1f1f;' +
                'border:1px solid #4a4a4a;border-radius:8px;padding:10px;gap:8px;align-items:center;' +
                'box-shadow:0 6px 24px rgba(0,0,0,.45)}' +
                '.mo-name-pop.active{display:flex}' +
                '.mo-name-pop input{flex:1;min-width:150px;background:#111;color:#eee;' +
                'border:1px solid #555;border-radius:4px;padding:5px 8px;font-size:13px;outline:none}' +
                '.mo-name-pop input:focus{border-color:#7aa2f7}';
            document.head.appendChild(_npCss);
        }
        namePop = document.createElement('div');
        namePop.className = 'mo-name-pop';
        namePop.innerHTML = '<input type="text" placeholder="输入组名…"><button class="mo-btn">确定</button>';
        document.body.appendChild(namePop);
        nameInput = namePop.querySelector('input');
        namePop.querySelector('button').addEventListener('click', confirmName);

        // 【加减选修复】修饰键真实状态跟踪：mousemove 的 e.shiftKey/e.ctrlKey 在部分场景
        // （焦点切换/事件合成/按键瞬间）读不到，导致加选/减选静默回退成全新框选。
        // 这里用 window 级 keydown/keyup 维护权威状态，取事件标志与键状态的"或"。
        // 【作用域修复】状态与 modsHeld 定义在 IIFE 顶层（原在 ensureDom 内，onDown/onMove 访问不到会 ReferenceError）
        window.addEventListener('keydown', function(ev) {
            if (ev.key === 'Shift') _shiftHeld = true;
            if (ev.key === 'Control') _ctrlHeld = true;
            if (ev.key === 'Alt') _altHeld = true;
            // Alt 单独按会触发浏览器菜单栏聚焦（Windows），面板激活时吞掉默认行为
            if (active && ev.key === 'Alt') ev.preventDefault();
        });
        window.addEventListener('keyup', function(ev) {
            if (ev.key === 'Shift') _shiftHeld = false;
            if (ev.key === 'Control') _ctrlHeld = false;
            if (ev.key === 'Alt') _altHeld = false;
        });
        // 【键卡死修复】窗口失焦/Alt+Tab 时 keyup 会丢，修饰键状态全部复位，
        // 否则键状态卡在"按住"→ 之后所有框选被误判为加/减选（"框选失效"的隐形根因）
        window.addEventListener('blur', function() { _shiftHeld = false; _ctrlHeld = false; _altHeld = false; });

        // 面板内所有鼠标交互（mousemove 挂 window：拖出画布仍跟手）
        cvs.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        cvs.addEventListener('wheel', onWheel, { passive: false });
        cvs.addEventListener('auxclick', function(e) { e.preventDefault(); }); // 防中键默认行为
        // 【小方块模式】双击定位 + 右键原生菜单
        cvs.addEventListener('dblclick', function(e) {
            if (MO_LEGACY) return;
            var b = blHit(e);
            if (b) { e.preventDefault(); _openTitleInput(b, e.clientX, e.clientY); return; } // 【点击改题 v1】双击节点 → 弹出标题输入框（回车保存并定位，Esc取消）
            // 【双击创建 v3·S3a】空白双击 → 与普通无限画布完全一致：弹出「创建对话框」双栏面板
            // （旧 v1 直接 chatManage create 会在世界坐标生成一个脱离屏幕的小框，已废弃；
            //   v3 统一走 _openCreateDialog，弹出成功才退出整理面板，KiteCanvas 缺失时面板保持打开）
            if (_openCreateDialog(e.clientX, e.clientY)) close();
        });
        cvs.addEventListener('contextmenu', function(e) {
            if (MO_LEGACY) return;
            e.preventDefault();
            blMenu(e);
        });
        try { if (!MO_LEGACY) overlay.querySelector('.mo-panel').classList.add('mo-small'); } catch (e) {} // 【全屏版 v2】MO_LEGACY=true 时不挂 mo-small 类，避免 720×480 浮窗 !important 规则钉回浮窗
        // ========== 【移动端触屏适配 v1】手机/平板也可正常操作整理面板 ==========
        try { _installTouch(); } catch (e) { console.warn('[organize] 触屏适配初始化失败', e); }
        window.addEventListener('keydown', onKey);
        window.addEventListener('resize', function() { if (active) render(); });

        // ========== 【浮动窗口化 v1】拖拽 + 缩放 + 位置尺寸记忆 ==========
        try {
            var _toolbar = overlay.querySelector('.mo-toolbar');
            var WIN_KEY = 'zf_organize_win';
            function _minW() { return Math.min(180, window.innerWidth - 16); } // 【窄面板 v2】动态计算，窗口变窄后下限不再钳超视口
            function _minH() { return Math.min(280, window.innerHeight - 16); }

            function _saveWin() {
                try {
                    localStorage.setItem(WIN_KEY, JSON.stringify({
                        l: panel.offsetLeft, t: panel.offsetTop,
                        w: panel.offsetWidth, h: panel.offsetHeight
                    }));
                } catch (e) {}
            }
            function _clampRect() {
                var vw = window.innerWidth, vh = window.innerHeight;
                var w = Math.max(_minW(), Math.min(panel.offsetWidth, vw - 20));
                var h = Math.max(_minH(), Math.min(panel.offsetHeight, vh - 20));
                /* 【无限拖拽 v2 2026-12】允许拖到视口外（负坐标），仅保证任一边露出
                   ≥60px 可抓回，防止面板彻底丢失在屏外拿不回来。 */
                var GRAB = 60;
                var l = Math.max(GRAB - w, Math.min(panel.offsetLeft, vw - GRAB));
                var t = Math.max(GRAB - h, Math.min(panel.offsetTop, vh - GRAB));
                panel.style.width = w + 'px'; panel.style.height = h + 'px';
                panel.style.left = l + 'px'; panel.style.top = t + 'px';
            }
            // 打开时还原记忆位置尺寸 —— 【持久化修复】此处面板尚未 active（display:none），
            // offsetWidth/offsetTop 全是 0，若当场 _clampRect() 会用 0 覆盖记忆值导致重启丢失。
            // 改为只读取存档挂起，等 open() 面板可见后再应用 + 钳制。
            var _saved = null;
            try { _saved = JSON.parse(localStorage.getItem(WIN_KEY) || 'null'); } catch (e) {}
            _pendingWinRect = (_saved && _saved.w > 0) ? _saved : null;
            _applyWinRect = function() {
                if (!_pendingWinRect) return;
                var r = _pendingWinRect; _pendingWinRect = null;
                panel.style.left = r.l + 'px'; panel.style.top = r.t + 'px';
                panel.style.width = r.w + 'px'; panel.style.height = r.h + 'px';
                _clampRect();
            };

            var _winDrag = null; // {sx, sy, l, t, w, h, dir}  dir: 'move' 或 'n/s/e/w/ne/nw/se/sw'
            var _winFrame = 0;
            var EDGE = 8; // 外框边缘热区（像素）
            function _edgeDir(e) {
                var rz = e.target.closest ? e.target.closest('.mo-rz') : null;
                return (rz && panel.contains(rz)) ? rz.dataset.dir : '';
            }
            function _winApply() {
                _winFrame = 0;
                if (!_winDrag) return;
                var dx = _winDrag.cx - _winDrag.sx, dy = _winDrag.cy - _winDrag.sy;
                var d = _winDrag.dir;
                if (d === 'move') {
                    /* 【无限拖拽 v2 2026-12】拖拽中放开 top>=0 钳制，允许自由拖出视口
                       （松手后 _clampRect 仍保证露出 60px 可抓回，不会丢）。 */
                    panel.style.left = (_winDrag.l + dx) + 'px';
                    panel.style.top = (_winDrag.t + dy) + 'px';
                    // 【无限拖拽 v3】拖拽中不钳制，面板完全跟手；松手时 _winEnd 统一钳回
                    if (active) render(); // 已有 rAF 节流，拖动中实时重绘
                    return;
                } else {
                    // 外框缩放：按方向调整 left/top/width/height
                    var l = _winDrag.l, t = _winDrag.t, w = _winDrag.w, h = _winDrag.h;
                    if (d.indexOf('e') >= 0) w = _winDrag.w + dx;
                    if (d.indexOf('s') >= 0) h = _winDrag.h + dy;
                    if (d.indexOf('w') >= 0) { w = _winDrag.w - dx; l = _winDrag.l + dx; }
                    if (d.indexOf('n') >= 0) { h = _winDrag.h - dy; t = _winDrag.t + dy; }
                    var mw = _minW(), mh = _minH();
                    if (w < mw) { if (d.indexOf('w') >= 0) l = _winDrag.l + (_winDrag.w - mw); w = mw; }
                    if (h < mh) { if (d.indexOf('n') >= 0) t = _winDrag.t + (_winDrag.h - mh); h = mh; }
                    panel.style.width = w + 'px'; panel.style.height = h + 'px';
                    panel.style.left = l + 'px'; panel.style.top = t + 'px';
                }
                _clampRect();
                if (active) render(); // 已有 rAF 节流，拖动中实时重绘
            }
            function _winStart(e, dir) {
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                _winDrag = { sx: e.clientX, sy: e.clientY,
                    cx: e.clientX, cy: e.clientY,
                    l: panel.offsetLeft, t: panel.offsetTop,
                    w: panel.offsetWidth, h: panel.offsetHeight,
                    dir: dir || 'move' };
                try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
            }
            function _winMove(e) {
                // 悬停外框边缘时给出缩放光标提示（未按下时）
                if (!_winDrag) {
                    var hd = _edgeDir(e);
                    if (active && hd) { panel.style.cursor = hd + '-resize'; }
                    else if (panel.style.cursor) { panel.style.cursor = ''; }
                    return;
                }
                _winDrag.cx = e.clientX; _winDrag.cy = e.clientY;
                if (!_winFrame) _winFrame = requestAnimationFrame(_winApply);
            }
            function _winEnd() {
                if (!_winDrag) return;
                _winDrag = null;
                if (_winFrame) { cancelAnimationFrame(_winFrame); _winFrame = 0; }
                _clampRect(); // 【无限拖拽 v3】松手时才钳到“至少露出 60px 可抓回”，拖拽过程中完全自由
                _saveWin();
            }
            _toolbar.addEventListener('pointerdown', function(e) {
                // 按钮不触发拖拽
                if (e.target.closest('button')) return;
                _winStart(e);
            });
            // 拖拽外框（面板边缘热区条）缩放整体大小
            Array.prototype.forEach.call(overlay.querySelectorAll('.mo-rz'), function(rz) {
                rz.addEventListener('pointerdown', function(e) {
                    if (!active) return;
                    _winStart(e, rz.dataset.dir);
                });
            });
            window.addEventListener('pointermove', _winMove);
            window.addEventListener('pointerup', _winEnd);
            window.addEventListener('pointercancel', _winEnd);
        } catch (e) {}
        // ========== 浮动窗口化结束 ==========
    // 主题切换（暗↔亮/风格切换）时实时重绘卡片配色
    document.addEventListener('themechange', function() { _tvCache = {}; if (active) render(); });

        // 【防点穿】整理面板打开时，捕获阶段拦截落到下层画布/对话框上的鼠标事件，
        // 避免误点到底下对话框的按钮（工具栏/命名弹窗/更高层系统弹窗不受影响）
        function guardUnderlay(ev) {
            if (!active) return;
            var t = ev.target;
            if (!t || !t.closest) return;
            if (overlay.contains(t) || (namePop && namePop.contains(t))) return;
            var under = t.closest('#canvasContent, #canvasArea, .chatbox, .chat-box, .kite-node, .kite-image-panel, .quick-note, .media-canvas-node, #minimap, .ft-dock');
            if (under) {
                ev.stopPropagation();
                ev.preventDefault();
            }
        }
        ['mousedown', 'mouseup', 'click', 'dblclick'].forEach(function(ev) {
            document.addEventListener(ev, guardUnderlay, true);
        });
    }

    // ===== 光标状态：悬停卡片=grab，抓取中/平移中=grabbing，框选=crosshair =====
    function setCursorForState(state) {
        if (!cvs) return;
        cvs.style.cursor = state || 'default';
    }

    function confirmName() {
        var name = (nameInput.value || '').trim() || ('组 ' + (groups.length + 1));
        var ids = Array.from(selected).map(function(el) { return el.dataset.moId; });
        if (_editingGroup) {
            _editingGroup.name = name;
        } else {
            groups.push({
                id: 'g' + Date.now(),
                name: name,
                color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
                nodeIds: ids
            });
        }
        saveGroups();
        hideNamePop();
        render();
    }
    var _editingGroup = null;
    function showNamePop(cb) {
        namePop.classList.add('active');
        nameInput.value = '';
        var r = panel.getBoundingClientRect();
        // 【M3 总览接管】缩小总览态下整理面板隐藏（r.width=0），命名框若按 panel 定位会跑到
        //   视口左上角外而不可见。此时改定位到屏幕中下偏上（避开底部 dock：bottom:18px）。
        if (!r.width) {
            namePop.style.left = (window.innerWidth / 2 - 110) + 'px';
            namePop.style.top = (window.innerHeight / 2 - 40) + 'px';
        } else {
            namePop.style.left = (r.left + r.width / 2 - 110) + 'px';
            namePop.style.top = (r.top + 48) + 'px';
        }
        setTimeout(function() { nameInput.focus(); }, 30);
        _pendingConfirm = cb;
    }
    var _pendingConfirm = null;
    function hideNamePop() {
        if (namePop) namePop.classList.remove('active');
        _editingGroup = null;
        _pendingConfirm = null;
    }

    // ===== 收集节点（与 app-minimap.js 同源，直接复用其收集结果更稳） =====
    var _orgTitles = {}; // 【标题双轨 v1】ext.title 自定义名覆盖 DOM 标题（启动拉取+改名写入）
(function _orgRestoreTitles() {
    try {
        fetch('/api/engineering/graph').then(function (r) { return r.json(); }).then(function (d) {
            (d.nodes || []).forEach(function (n) { if (n.title_ext) _orgTitles[n.id] = n.title_ext; });
        }).catch(function () {});
    } catch (e) {}
})();
function collectBoxes() {
        boxes = [];
        _dragBoxIdxDirty = true; // 【fps v11】boxes 重建 → 拖拽 Map 索引失效
        var root = document.getElementById('canvasContent');
        if (!root) return;
        // 【修复】工作台抽屉挂在对话框内部，offsetLeft 是相对对话框的；
        // 用 offsetParent 累加算出相对画布的绝对坐标（其他直接子元素结果不变）
        function absOf(el) {
            var x = 0, y = 0, n = el;
            while (n) {
                x += n.offsetLeft; y += n.offsetTop;
                if (n.id === 'canvasContent' || n.id === 'kite-canvas') break;
                // 【兜底】offsetParent 链未经过画布根直达 body 时，扣回 body 偏移防异常
                if (!n.offsetParent || n.offsetParent === document.body) { n = null; break; }
                n = n.offsetParent;
            }
            return { x: x, y: y };
        }
        function addEl(el, title, color, chat) {
            if (!el || !el.isConnected || el.offsetWidth <= 0) return;
            // 【刷新修复】关闭中/已关闭的对话框不收集（关闭动画 220ms 内元素仍在 DOM）
            if (el._zfClosing || (chat && chat._closed)) return;
            var _cid0 = (chat && chat.id) || el.id || '';
            if (_cid0 && _vidClosed(_cid0)) return; // 【可见性指挥台】关闭态三模式全隐（整理面板不再绘制）
            if (!el.dataset.moId) el.dataset.moId = 'mo' + Math.random().toString(36).slice(2, 9);
            var _ap = absOf(el);
            var box = {
                el: el,
                chatId: (chat && chat.id) || el.id || '',
                x: _ap.x,
                y: _ap.y,
                w: el.offsetWidth,
                h: el.offsetHeight,
                title: title || (el.querySelector('.chatbox-header .title, .chatbox-title, .chat-title, .box-title, .title-text') || {}).textContent || (el.dataset.title) || '节点',
                extTitle: ((chat && chat.id) || el.id || '') ? (_orgTitles[(chat && chat.id) || el.id] || '') : '',
                color: color || groupColorOf(el),
                chat: chat || null,
                firstUser: '',
                avatar: 'AI'
            };
            // 用户第一条提问
            function stripHtml(t) {
                var d = document.createElement('div'); d.innerHTML = t || '';
                return (d.textContent || d.innerText || '').trim();
            }
            if (box.chat && Array.isArray(box.chat.history)) {
                for (var hi = 0; hi < box.chat.history.length; hi++) {
                    var m = box.chat.history[hi];
                    if (m && m.role === 'user' && m.content) { box.firstUser = stripHtml(String(m.content)); break; }
                }
            }
            if (!box.firstUser && box.chat && box.chat._pendingUserInput) box.firstUser = stripHtml(String(box.chat._pendingUserInput));
            // 【已回答标记】AI 至少回复过一次 → 面板画「答」绿标，提示该对话已可送审
            box.answered = false;
            if (box.chat && Array.isArray(box.chat.history)) {
                for (var ai2 = 0; ai2 < box.chat.history.length; ai2++) {
                    var ma = box.chat.history[ai2];
                    // 与「完毕」扫描同标准：过滤 _meta 系统消息与空白 HTML（如 <p><br></p>），避免误标已回答
                    if (ma && !ma._meta && ma.role === 'assistant' && stripHtml(String(ma.content || '')).trim()) { box.answered = true; break; }
                }
            }
            if (!box.firstUser) {
                /* 【懒渲染适配 2026-11-23】摘要语义=全对话第一句用户提问，真源在数据层：
                   懒渲染只渲尾部 100 条/裁剪窗口保 100 条，DOM 第一条 .msg.user 是"可见窗口
                   第一条"而非全对话第一条。history 全量 → Store 全量 → DOM 兜底。 */
                var _fuScan = function (arr) {
                    if (!Array.isArray(arr)) return '';
                    for (var fi = 0; fi < arr.length; fi++) {
                        var fm = arr[fi];
                        if (!fm || fm.role !== 'user') continue;
                        var ft = typeof fm.content === 'string' ? fm.content
                            : (Array.isArray(fm.content) ? fm.content.filter(function (p) { return p && p.type === 'text' && p.text; }).map(function (p) { return p.text; }).join('\n') : '');
                        if (ft && stripHtml(String(ft)).trim()) return stripHtml(String(ft)).trim();
                    }
                    return '';
                };
                var _fuT = _fuScan(box.chat && box.chat.history);
                if (!_fuT && box.chat && box.chat.id && typeof Store !== 'undefined' && Store.getMessages) {
                    try { _fuT = _fuScan(Store.getMessages(box.chat.id)); } catch (eFU) {}
                }
                if (_fuT) box.firstUser = _fuT;
            }
            if (!box.firstUser && el) {
                var fu = el.querySelector('.msg.user .content, .message.user .content, .msg.user .msg-text');
                if (fu) box.firstUser = (fu.textContent || '').trim();
            }
            if (!box.firstUser && box.title && box.title !== '节点') box.firstUser = box.title;
            // 角色名（头像）：优先 chat 对象上的角色名，其次 DOM
            var roleName = '';
            if (box.chat) roleName = box.chat.agentName || box.chat.roleName || box.chat.role || box.chat.agent || '';
            if (!roleName && el) {
                var rn = el.querySelector('.chat-agent-name, .agent-name, .role-name, .chat-role');
                if (rn) roleName = rn.textContent.trim();
            }
            roleName = String(roleName).trim();
            box.avatar = roleName ? roleName.slice(0, 2) : 'AI';
            // 角色图标（emoji）：chat 对象 > 标题栏头像 > 角色缓存按名匹配
            box.icon = '';
            try {
                var _ic = '';
                // 优先：本对话绑定的角色（zf_role_chat_<boxId>，与主界面角色绑定同一存储）
                try {
                    var _bid = (box.chat && box.chat.id) || (el && el.id) || '';
                    var _cr = _bid ? JSON.parse(localStorage.getItem('zf_role_chat_' + _bid) || 'null') : null;
                    if (_cr && _cr.avatar) _ic = String(_cr.avatar).trim();
                } catch (e) {}
                if (!_ic && box.chat && typeof box.chat.avatar === 'string') _ic = box.chat.avatar.trim();
                if ((!_ic || _ic === '??') && roleName) {
                    var _rc = JSON.parse(localStorage.getItem('zf_roles_cache') || 'null');
                    var _rl = (_rc && _rc.data && _rc.data.roles) || [];
                    for (var ri = 0; ri < _rl.length; ri++) {
                        if (_rl[ri] && String(_rl[ri].name || '').trim() === roleName) { _ic = String(_rl[ri].avatar || ''); break; }
                    }
                }
                if (_ic && _ic !== '??') box.icon = String.fromCodePoint(_ic.codePointAt(0));
            } catch (e) {}
            if (!box.firstUser) box.firstUser = '（空对话）';
            boxes.push(box);
        }
        // 对话框
        var minimapBoxes = (window.App && App._minimapGetBoxes) ? App._minimapGetBoxes() : null;
        if (minimapBoxes && minimapBoxes.length) {
            minimapBoxes.forEach(function(b) {
                var title = (b.chat && (b.chat.title || b.chat.name)) || '';
                if (!title && b.el) {
                    var t = b.el.querySelector('.chatbox-header .title, .chatbox-title, .chat-title, .box-title, .title-text');
                    title = t ? t.textContent.trim() : (b.kite ? b.kite : '节点');
                }
                addEl(b.el, title, b.kite ? kiteColor(b.kite) : null, b.chat || null);
            });
        } else {
            // 兜底收集：对话框需匹配 App.chatBoxes 拿到 chat 对象，否则 Delete 无法关闭
            var _cb = (window.App && App.chatBoxes) || [];
            root.querySelectorAll('.chatbox, .chat-box, .kite-node, .kite-image-panel, .quick-note, .media-canvas-node, .fg-node').forEach(function(el) {
                // 【跟随主对话框 v9】不再收集 .wb-drawer（工作台抽屉）：
                // 抽屉是对话框内部的一部分，必须完全依托宿主对话框、不允许在整理面板中被单独选中/拖动；
                // 宿主对话框被拖动时抽屉自然跟随，回到无限画布后位置也一致。
                var _c = null;
                for (var ci = 0; ci < _cb.length; ci++) {
                    if (_cb[ci] && _cb[ci].el === el) { _c = _cb[ci]; break; }
                }
                var t = el.querySelector('.chatbox-header .title, .chatbox-title, .chat-title, .box-title, .title-text');
                addEl(el, (_c && (_c.title || _c.name)) || (t ? t.textContent.trim() : '') || '节点', null, _c);
            });
        }
    }
    // ===== 角色批量派发 =====
    var ROLE_DEFS = {
        thinker:    { label: '策划师', fn: function(chat) { return App._thinkerExpand({ el: chat.el }, chat); } },
        verify:     { label: '审核员', fn: function(chat) { return App._objectiveVerify({ el: chat.el }, chat); } },
        summarizer: { label: '总结师', fn: function(chat) { return App._summarizerExpand({ el: chat.el }, chat); } },
        custom:     { label: '自定义', fn: function(chat) { return App._customExpand({ el: chat.el }, chat); } }
    };

    function _collectTargets() {
        // 有选中则派发选中；未选中返回空数组（由调用方提示），不再静默回退派全部对话
        // 【缺陷残留分支修复】旧行为「selected 为空 → 派全部」与本任务修复的
        // 「框选才派团队」核心诉求语义矛盾（面板内角色按钮换入口即复发），已移除
        var src = selected.size ? Array.from(selected) : [];
        var targets = [];
        src.forEach(function(el) {
            var _c = null;
            for (var i = 0; i < boxes.length; i++) {
                if (boxes[i].el === el && boxes[i].chat) { _c = boxes[i].chat; break; }
            }
            if (_c) targets.push(_c);
        });
        return targets;
    }

    function dispatchRole(roleKey, btn) {
        var def = ROLE_DEFS[roleKey];
        if (!def) return;
        var targets = _collectTargets();
        if (!targets.length) {
            try { if (App.toast) App.toast('没有可派发的对话卡片', false); } catch (e) {}
            return;
        }
        /* 【恢复数量选择 + 自绘对话框】点角色按钮先弹自定义「派出几名」弹窗（1~9），
           超过 5 个新窗时用自绘确认框二次确认（不再用 window.confirm 原生对话框）。
           自定义角色先消费一次 localStorage 记住的一次性叮嘱（_customExpand 内部读取），策划师走默认多角色探讨 */
        var first = targets[0];
        var n = 1;
        var doDispatch = function () {
                var ok = 0, fail = 0, total = targets.length * n, seq = 0, doneCnt = 0;
                /* 【修复假串行】原 (ok+fail)*500 在调度时求值（此时均为0）→ 全部 0ms 齐发。
                   改为按派发序号 seq 计延迟 seq*500，真正串行 500ms 间隔 */
                targets.forEach(function(chat) {
                    for (var j = 0; j < n; j++) {
                        (function (chat, j, delayMs) {
                            setTimeout(function () {
                                try {
                                    def.fn(chat);
                                    // 写入角色派发状态（round 累加），随对话持久化
                                    var prev = chat.roleStatus && chat.roleStatus.role === def.label ? chat.roleStatus : null;
                                    chat.roleStatus = { role: def.label, round: (prev ? (prev.round || 0) : 0) + 1, state: '进行中', at: Date.now() };
                                    try { Store.saveChatBox(chat); } catch (eS) {}
                                    ok++;
                                } catch (eD) { fail++; }
                                doneCnt++;
                                // 派发完毕汇总
                                if (doneCnt === total) {
                                    try { if (App.toast) App.toast(def.label + '批量派发完成：成功 ' + ok + ' 个' + (fail ? '，失败 ' + fail + ' 个' : ''), !fail); } catch (eT) {}
                                    render(); // 重绘角标
                                }
                            }, delayMs);
                        })(chat, j, seq * 500);
                        seq++;
                    }
                });
            };
        /* 自绘确认框（替代 window.confirm，不用 Windows/WebView 原生对话框） */
        var zfConfirm = function (msg, cb) {
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
            var dlg = document.createElement('div');
            dlg.style.cssText = 'background:#1c2230;color:#dde5f0;border:1px solid #3a4658;border-radius:10px;padding:18px 22px;box-shadow:0 10px 40px rgba(0,0,0,.5);font:14px/1.6 system-ui;max-width:360px;';
            dlg.innerHTML = '<div style="margin-bottom:14px;">' + msg + '</div>'
                + '<div style="text-align:right;"><button data-c="0" style="padding:6px 18px;margin-right:8px;border-radius:8px;border:1px solid #4a5870;background:transparent;color:#8fa0b8;cursor:pointer;">取消</button>'
                + '<button data-c="1" style="padding:6px 18px;border-radius:8px;border:1px solid #4da3ff;background:#2b5fb0;color:#fff;cursor:pointer;">确认</button></div>';
            ov.appendChild(dlg);
            document.body.appendChild(ov);
            ov.addEventListener('click', function (e) {
                var b = e.target.closest('button');
                if (!b) return;
                document.body.removeChild(ov);
                cb(b.dataset.c === '1');
            });
        };
        /* 数量选择弹窗（自绘）：点角色按钮先选每对话派出几名（1~9） */
        var pickCount = function (cb) {
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
            var dlg = document.createElement('div');
            dlg.style.cssText = 'background:#1c2230;color:#dde5f0;border:1px solid #3a4658;border-radius:10px;padding:18px 22px;box-shadow:0 10px 40px rgba(0,0,0,.5);font:14px/1.6 system-ui;min-width:280px;';
            var opts = '';
            for (var i = 1; i <= 9; i++) {
                opts += '<button data-n="' + i + '" style="width:38px;height:38px;margin:4px;border-radius:8px;border:1px solid #4a5870;background:#242d3f;color:#dde5f0;font-size:15px;cursor:pointer;">' + i + '</button>';
            }
            dlg.innerHTML = '<div style="margin-bottom:6px;font-weight:600;">派出几名「' + def.label + '」？</div>'
                + '<div style="color:#8fa0b8;margin-bottom:8px;">将对 ' + targets.length + ' 个对话各派出所选数量</div>'
                + '<div style="display:flex;flex-wrap:wrap;justify-content:center;">' + opts + '</div>'
                + '<div style="text-align:center;margin-top:10px;"><button data-x="1" style="padding:6px 18px;border-radius:8px;border:1px solid #4a5870;background:transparent;color:#8fa0b8;cursor:pointer;">取消</button></div>';
            ov.appendChild(dlg);
            document.body.appendChild(ov);
            ov.addEventListener('click', function (e) {
                var b = e.target.closest('button');
                if (!b) return;
                document.body.removeChild(ov);
                if (b.dataset.x) return;
                cb(parseInt(b.dataset.n, 10) || 1);
            });
        };
        pickCount(function (picked) {
            n = picked;
            var run = function () { doDispatch(); };
            if (targets.length * n > 5) {
                zfConfirm('将对 ' + targets.length + ' 个对话各派 ' + n + ' 名「' + def.label + '」（共 ' + (targets.length * n) + ' 个新窗），确认？', function (okc) { if (okc) run(); });
            } else run();
        });
    }

    // 角色角标：面板卡片 canvas 顶部小色点（角色=颜色，实心=进行中，绿=完毕）
    function _roleBadgeOf(el) {
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].el === el) {
                var rs = boxes[i].chat && boxes[i].chat.roleStatus;
                return rs || null;
            }
        }
        return null;
    }
    var ROLE_COLORS = { '策划师': '#4da3ff', '审核员': '#ffb454', '总结师': '#7ee0a3', '自定义': '#c792ea' };

    // 「完毕」自动判定：面板开启期间每 3 秒扫一次，最新 assistant 消息末尾 500 字符内命中「✅ 任务完成」→ 翻完毕
    setInterval(function() {
        if (!active) return;
        boxes.forEach(function(b) {
            var rs = b.chat && b.chat.roleStatus;
            if (!rs || rs.state === '完毕') return;
            try {
                var h = b.chat.history || [];
                for (var i = h.length - 1; i >= 0; i--) {
                    if (h[i] && h[i].role === 'assistant' && !h[i]._meta) {
                        var t = String(h[i].content || '');
                        var tail = t.slice(-500);
                        var pos = tail.lastIndexOf('\u2705 \u4efb\u52a1\u5b8c\u6210'); // ✅ 任务完成
                        if (pos >= 0) {
                            rs.state = '完毕';
                            try { Store.saveChatBox(b.chat); } catch (eS) {}
                            render();
                        }
                        break; // 只看最新一条 assistant
                    }
                }
            } catch (e) {}
        });
    }, 3000);

    // 【新窗自动刷新修复】面板打开期间每 2 秒重新收集方块：
    // 否则在整理面板开着时新派发/新建的审核师等对话窗不会出现在面板里。
    // 已拖动的方块按 moId 恢复坐标；框选/拖拽/平移交互中跳过，避免打断操作。
    setInterval(function() {
        if (!active || document.hidden) return;
        if (mode === 'drag' || mode === 'marquee' || mode === 'pan') return;
        var _oldPos = {}, _oldSel = {};
        boxes.forEach(function(ob) {
            var mid = ob.el && ob.el.dataset.moId;
            if (mid) _oldPos[mid] = { x: ob.x, y: ob.y, moved: !!ob._moved };
        });
        var _had = boxes.length;
        try { collectBoxes(); } catch (e) { return; }
        boxes.forEach(function(b) {
            var mid = b.el.dataset.moId;
            if (mid && _oldPos[mid]) {
                b.x = _oldPos[mid].x; b.y = _oldPos[mid].y; b._moved = _oldPos[mid].moved;
            }
        });
        // 数量有变化才重绘，避免空转触发渲染保险丝
        if (boxes.length !== _had) render();
    }, 2000);

    // ===== 【状态配色 v2】方块颜色与右下角导航缩略图 STATUS_COLORS 对齐 =====
    // 错误=红 / 发送中=橙 / 排队=黄 / 已回答(AI答过)=绿 / 活动=蓝 / 空闲=淡蓝
    var MO_STATUS_COLORS = {
        error:    { fill: 'rgba(255, 85, 85, 0.75)',  stroke: 'rgba(255, 100, 100, 0.9)' },
        sending:  { fill: 'rgba(255, 165, 0, 0.8)',   stroke: 'rgba(255, 200, 80, 1)' },
        queued:   { fill: 'rgba(255, 210, 60, 0.7)',  stroke: 'rgba(255, 220, 80, 0.9)' },
        answered: { fill: 'rgba(30, 210, 130, 0.9)',  stroke: 'rgba(100, 255, 170, 1)' },
        active:   { fill: 'rgba(255, 200, 30, 0.85)',  stroke: 'rgba(255, 215, 60, 0.95)' },
        idle:     { fill: 'rgba(255, 210, 90, 0.45)', stroke: 'rgba(255, 210, 90, 0.35)' }
    };
    function statusOfBox(b) {
        var el = b.el, c = b.chat || null;
        try {
            // 与 app-minimap.js getBoxStatus 同标准：最后一条消息带 error → 错误
            var msgs = el.querySelectorAll('.msg');
            if (msgs.length > 0 && msgs[msgs.length - 1].classList.contains('error')) return 'error';
            if (c && c.isSending) return 'sending';
            if (c && c.queue && c.queue.length > 0) return 'queued';
            // AI 已回答：任务成功标记 或 历史里存在 assistant 回复（addEl 已算好 box.answered）
            if (c && c._taskStatus === 'success') return 'answered';
            if (c && c._taskStatus === 'fail') return 'error';
            if (b.answered) return 'answered';
            if (el.classList.contains('active')) return 'active';
        } catch (e) {}
        return 'idle';
    }

    function kiteColor(kind) {
        if (kind === 'note') return 'rgba(255,210,70,0.9)';
        if (kind === 'panel') return 'rgba(170,110,255,0.9)';
        if (kind === 'workbench') return 'rgba(74,153,136,0.95)';
        if (kind === 'media' || kind === 'node') return 'rgba(80,220,130,0.9)';
        return null;
    }
    function groupColorOf(el) {
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].nodeIds.indexOf(el.dataset.moId) >= 0) return groups[i].color;
        }
        return 'rgba(100,160,220,0.85)';
    }

    // ===== 视图/渲染 =====
    var view = { minX: 0, minY: 0, s: 1, ox: 0, oy: 0 };
    // 【拖拽修复】旧版每次 render 都重新自动 fit：拖动方块 → 包围盒变化 → 视图回中，
    // 方块在屏幕上几乎不动，表现为"小方块无法拖拽"。
    // 现在：userView 为空才自动 fit；拖拽开始 / 滚轮操作时冻结为 userView（用户视图）。
    var userView = null;
    function ensureUserView() {
        if (!userView) userView = { minX: view.minX, minY: view.minY, s: view.s, ox: view.ox, oy: view.oy };
        return userView;
    }
    function computeView() {
        var w = cvs.clientWidth, h = cvs.clientHeight;
        if (userView) { view = { minX: userView.minX, minY: userView.minY, s: userView.s, ox: userView.ox, oy: userView.oy }; return; }
        if (boxes.length === 0) { view = { minX: 0, minY: 0, s: 1, ox: 0, oy: 0 }; return; }
        var bb = worldBounds();
        var s = Math.min(w / Math.max(1, bb.w), h / Math.max(1, bb.h));
        s = Math.min(3, s); // 【缩放约束】fit 自动比例同样钳制上限 3，防止极小布局被放大到糊屏
        view = {
            minX: bb.minX, minY: bb.minY, s: s,
            ox: (w - bb.w * s) / 2,
            oy: (h - bb.h * s) / 2
        };
    }
    function worldBounds() {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        boxes.forEach(function(b) {
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.x + b.w > maxX) maxX = b.x + b.w;
            if (b.y + b.h > maxY) maxY = b.y + b.h;
        });
        var pad = 40;
        minX -= pad; minY -= pad; maxX += pad; maxY += pad;
        return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
    }
    function w2m(px, py) { return { x: (px - view.minX) * view.s + view.ox, y: (py - view.minY) * view.s + view.oy }; }
    function m2w(px, py) { return { x: (px - view.ox) / view.s + view.minX, y: (py - view.oy) / view.s + view.minY }; }

    var GROUP_PAD = 26; // 【v3】加大内边距：组框与对话框距离更远，不贴边
    // 按方块反查所在组（自动分组角标用），带缓存避免每帧 O(组×成员) 扫描
    var _gIdxCache = null;
    function groupBoxOfByIdOf(b) {
        var id = b.el && b.el.dataset ? b.el.dataset.moId : '';
        if (!id) return null;
        if (!_gIdxCache) {
            _gIdxCache = {};
            groups.forEach(function(g) { g.nodeIds.forEach(function(nid) { _gIdxCache[nid] = g; }); });
        }
        var g = _gIdxCache[id];
        return (g && g.nodeIds.indexOf(id) >= 0) ? g : null;
    }

    function groupBoxOf(g) {
        var members = boxes.filter(function(b) { return g.nodeIds.indexOf(b.el.dataset.moId) >= 0; });
        if (!members.length) return null;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        members.forEach(function(b) {
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.x + b.w > maxX) maxX = b.x + b.w;
            if (b.y + b.h > maxY) maxY = b.y + b.h;
        });
        return { x: minX - GROUP_PAD, y: minY - GROUP_PAD, w: maxX - minX + GROUP_PAD * 2, h: maxY - minY + GROUP_PAD * 2 };
    }


    // 【放大卡顿修复】themeVar 每帧缓存：渲染循环里每张卡片多次调用 getComputedStyle
    // 会造成每帧几十次强制回流，放大后卡片变大变多时 CPU 被拉满。改为每帧首取后缓存。
    var _tvCache = {};
    function themeVar(n, fb) {
        if (n in _tvCache) { var cv = _tvCache[n]; return cv || fb; }
        var v = null;
        try { v = getComputedStyle(document.documentElement).getPropertyValue(n); v = v && v.trim(); } catch (e) {}
        _tvCache[n] = v || '';
        return v || fb;
    }
    // 星点网格背景：随视图平移/缩放，呼应主画布星空风格
    function drawGrid(w, h) {
        var stepW = 90;
        var scr = stepW * view.s;
        if (scr < 14 || scr > 260) return; // 太密/太疏不画
        var w0 = m2w(0, 0), w1 = m2w(w, h);
        var x0 = Math.floor(w0.x / stepW) * stepW, y0 = Math.floor(w0.y / stepW) * stepW;
        var cols = Math.ceil((w1.x - w0.x) / stepW) + 1, rows = Math.ceil((w1.y - w0.y) / stepW) + 1;
        if (cols * rows > 4000) return;
        ctx.fillStyle = hexToRgba(themeVar('--text', '#ffffff'), 0.09);
        // 【性能·去负债】旧版每点 beginPath+arc+fill（最多4000次独立绘制调用）；
        //   改为单 path 批量 rect 后一次 fill，绘制调用从 N 次 → 1 次
        ctx.beginPath();
        for (var gx = 0; gx <= cols; gx++) {
            for (var gy = 0; gy <= rows; gy++) {
                var sp = w2m(x0 + gx * stepW, y0 + gy * stepW);
                ctx.rect(sp.x - 1, sp.y - 1, 2.2, 2.2);
            }
        }
        ctx.fill();
    }
    var _shadowSpriteCache = {};
    var _gradCache = {};   // 【性能·去负债】渐变对象缓存（key 见卡片绘制处）
    function getShadowSprite(color, blur) {
        var key = color + '|' + blur;
        if (_shadowSpriteCache[key] !== undefined) return _shadowSpriteCache[key];
        try {
            var s = 64, pad = 16;   // 【修复】旧版 pad=blur*4=32 导致 fillRect(32,32,0,0) 内芯为空、贴图全透明；改 pad=16，内芯 32×32
            var c = document.createElement('canvas');
            c.width = s; c.height = s;
            var cx2 = c.getContext('2d');
            cx2.shadowColor = 'rgba(0,0,0,0.5)';
            cx2.shadowBlur = blur;
            cx2.shadowOffsetY = 3;
            cx2.fillStyle = color;
            cx2.fillRect(pad, pad, s - pad * 2, s - pad * 2);
            _shadowSpriteCache[key] = c;
        } catch (e) { _shadowSpriteCache[key] = null; }
        return _shadowSpriteCache[key];
    }
    // 【CPU 100% 死机根治·三重保险】
    // 保险1：渲染保险丝
    // 保险1：渲染保险丝——1 秒内最多 45 帧（远超正常交互需求）。任何未知的
    //   render→外部Observer→render 反馈环路都会被保险丝熔断，CPU 不会再被打满死机。
    var _renderPending = false; // 【rAF 合并渲染】同帧多次 render 只重绘一次
    var _fuseCount = 0, _fuseTs = 0;
    var _fuseTrips = 0;          // 连续熔断次数（真实交互解除后清零）
    var _fuseLockUntil = 0;      // 熔断冷却截止时间戳
    var _wheelUntil = 0;         // 【滚轮缩放豁免】滚轮缩放帧豁免窗口截止时间戳（onWheel 每次刷新 +250ms，冷却期内滚轮帧不被丢弃）
    var _callers = {};           // 【调用来源统计】render() 入口记录调用者函数名→次数，熔断时打印 Top 来源
    // 保险2：渲染静默罩——渲染同步执行期间给 body 挂标记，页面上的
    //   MutationObserver[pipeline/medianode/modal-lock/...] 在回调开头读到该标记时
    //   直接 return，跳过 getComputedStyle/offsetWidth 等强制回流读取，
    //   避免外部渲染触发"渲染→回流→渲染"。
    var _silentN = 0;
    function _renderSilent() {
        // 【放大卡顿修复】续期式静默罩：连续渲染期间 class 只 add 一次，
        // 停止渲染后统一延迟摘除。旧版每帧 add/remove 突变 body class，
        // 高频缩放时会持续触发全页 MutationObserver → 回流 → CPU 打满。
        _silentN++;
        document.body.classList.add('zf-org-rendering');
        var n = _silentN;
        setTimeout(function() {
            if (_silentN === n) {
                _silentN = 0;
                setTimeout(function() { document.body.classList.remove('zf-org-rendering'); }, 50);
            }
        }, 80);
    }
    // 【v3·新开发】读取策划师/审核员箭头配对，在整理面板中画连线与状态文字
    function drawPairArrows(w2m, view, phase) {
        // phase: undefined/'all' 全画；'lines' 只画线+箭头（垫在方块下）；'labels' 只画文字胶囊（盖在方块上）
        var all = [];
        try { if (window.ZFVerifyArrow && ZFVerifyArrow.getPairs) all = all.concat(ZFVerifyArrow.getPairs().map(function (p) { p._kind = 'verify'; return p; })); } catch (e) {}
        try { if (window.ZFThinkerArrow && ZFThinkerArrow.getPairs) all = all.concat(ZFThinkerArrow.getPairs().map(function (p) { p._kind = 'thinker'; return p; })); } catch (e) {}
        /* 【总结师连线】琥珀色：原对话↔总结师 */
        try { if (window.ZFSummarizerArrow && ZFSummarizerArrow.getPairs) all = all.concat(ZFSummarizerArrow.getPairs().map(function (p) { p._kind = 'sum'; return p; })); } catch (e) {}
        /* 【施工队连线】橙色：原对话↔施工队窗 */
        try {
            if (window.ZFRaceArrow && ZFRaceArrow.getPairs) {
                all = all.concat(ZFRaceArrow.getPairs().filter(function (p) { return p && !p.dead; }).map(function (p) {
                    return { srcId: p.srcId, tkId: p.raceId, status: p.state || 'construction', _kind: 'race' };
                }));
            }
        } catch (e) {}
        /* 【多角色跟随】多角色父子配对：父→每个成员各画一条橙金线（区分策划/审核青色线） */
        try {
            if (window.ZFMultiArrow && ZFMultiArrow.pairs) {
                ZFMultiArrow.pairs.forEach(function (p) {
                    if (!p || !p.el || !p.el.isConnected) return;
                    (p.memberIds || []).forEach(function (mid) {
                        var cp = { srcId: p.srcId, memberId: mid, groupName: p.groupName || '多角色', _kind: 'multi' };
                        all.push(cp);
                    });
                });
            }
        } catch (e) {}
        if (!all.length) return;
        var LABELS = { pending: ['审核中', '#00e5ff'], reviewing: ['复审中', '#00e5ff'], revising: ['待修改', '#ffab40'], applied: ['已回注', '#7c8cff'], modified: ['修改完成', '#00e676'], passed: ['审核完成', '#00e676'], failed: ['已失效', '#9e9e9e'], done: ['策划完成', '#00e676'] };
        all.forEach(function (p) {
            function boxMatch(r, id) { if (!r || !r.b) return false; var c = r.b.chat || {}; return c.id === id || (r.b.el && (r.b.el.id === id || r.b.el.dataset.chatId === id || r.b.el.dataset.id === id)); }
            var a = boxRects.find(function (r) { return boxMatch(r, p.srcId); });
            var b = boxRects.find(function (r) { return boxMatch(r, p.qcId || p.tkId || p.memberId); });
            if (!a || !b) return;
            // 【修复·连线错位】boxRects 是世界坐标，必须经 w2m 映射到画布坐标，
            // 否则缩放/平移后连线与状态文字和方块错位（文字/线比方块显得大且偏上）
            var _ma = w2m(a.x + a.w / 2, a.y + a.h / 2);
            var _mb = w2m(b.x + b.w / 2, b.y + b.h / 2);
            var sx = _ma.x, sy = _ma.y;
            var ex = _mb.x, ey = _mb.y;
            if (p.state === 'toSrc') { var t = sx; sx = ex; ex = t; t = sy; sy = ey; ey = t; }
            /* 【多角色】橙金色总箭头：父→子，中点标组名，实线细线与策划/审核区分 */
            if (p._kind === 'multi') {
                if (phase === 'labels') return;
                ctx.save();
                ctx.strokeStyle = '#ffb300';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
                var ang2 = Math.atan2(ey - sy, ex - sx), hl2 = 8;
                ctx.beginPath();
                ctx.moveTo(ex, ey);
                ctx.lineTo(ex - hl2 * Math.cos(ang2 - 0.45), ey - hl2 * Math.sin(ang2 - 0.45));
                ctx.lineTo(ex - hl2 * Math.cos(ang2 + 0.45), ey - hl2 * Math.sin(ang2 + 0.45));
                ctx.closePath();
                ctx.fillStyle = '#ffb300'; ctx.fill();
                ctx.restore();
                return;
            }
            var info;
            if (p._kind === 'sum') info = ({ pending: ['总结中', '#ffb300'], clarified: ['已总结', '#ff8f00'], done: ['总结完成', '#00e676'], applied: ['已沉淀', '#00e676'], failed: ['已失效', '#9e9e9e'] })[p.status] || ['总结中', '#ffb300'];
            else if (p._kind === 'race') info = p.status === 'construction' ? ['施工中', '#ff9800'] : (p.status === 'done' ? ['施工完成', '#00e676'] : ['施工中', '#ff9800']);
            else info = LABELS[p.status] || ['进行中', '#00e5ff'];
            ctx.save();
            // 状态线：'labels' 阶段跳过（线已垫在方块下方画过）
            if (phase !== 'labels') {
            ctx.strokeStyle = info[1];
            ctx.lineWidth = 2;
            ctx.setLineDash((p.status === 'pending' || p.status === 'reviewing') ? [6, 4] : []);
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.setLineDash([]);
            // 终点箭头三角
            var ang = Math.atan2(ey - sy, ex - sx), hl = 8;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - hl * Math.cos(ang - 0.45), ey - hl * Math.sin(ang - 0.45));
            ctx.lineTo(ex - hl * Math.cos(ang + 0.45), ey - hl * Math.sin(ang + 0.45));
            ctx.closePath();
            ctx.fillStyle = info[1]; ctx.fill();
            }
            if (phase === 'lines') { ctx.restore(); return; } // 线阶段不画文字，文字最后统一盖顶
            // 中点状态文字胶囊
            var mx = (sx + ex) / 2, my = (sy + ey) / 2;
            var label = info[0];
            ctx.font = 'bold 11px sans-serif';
            var tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(mx - tw / 2 - 7, my - 10, tw + 14, 18, 9); else ctx.rect(mx - tw / 2 - 7, my - 10, tw + 14, 18);
            ctx.fill();
            ctx.fillStyle = info[1];
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, mx, my);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.restore();
        });
    }

    // =====================================================================
    // 【小方块化 v1】方块模式核心：面板内 10×10 固定色块网格，视图固定不平移不缩放。
    //   - 每个真实对话框 → 一个 26×26 色块（组色优先），10 列换行
    //   - 拖动色块 → 同步真实对话框 offsetLeft/offsetTop（30ms 合并提交）
    //   - 双击色块 → 关面板 + 主画布居中该对话框；右键 → 原生菜单
    //   - 框选/Shift/Ctrl 加减选、建组/重命名/解散、N排 排列、Delete 关闭 全部保留
    // =====================================================================
    var BL = {
        SIZE: 26,        // 色块边长 px
        GAP: 8,          // 色块间距
        COLS: 10,        // 每行方块数
        PAD: 16,         // 网格边距
        BASE_X: 0,       // 网格世界坐标原点（固定，无视图变换）
        BASE_Y: 0
    };
    var blRects = [];    // 面板像素坐标缓存（渲染时重建）
    var _blS0 = 0; // 【方块过小修复】打开后的基准 fit 比例锚点（只在 open() 重置）
    // 【小方块模式·视图变换】支持平移/缩放：面板逻辑坐标 → 屏幕坐标
    var blView = { ox: 0, oy: 0, s: 1 };
    function blApply() {
        // 渲染前调用：把 blView 应用到 BL 原点与方块尺寸（命中/绘制共用，保证一致）
        BL.BASE_X = blView.ox;
        BL.BASE_Y = blView.oy;
        BL.SIZE = blView.s <= 0.01 ? 0.01 : blView.s; // 覆盖常量 26，缩放即改方块尺寸
    }
    function blResetView() {
        blView = { ox: 0, oy: 0, s: 26 }; // s 存实际方块尺寸，基准 26
    }

    function blPanelSize() {
        var n = Math.max(1, boxes.length);
        var rows = Math.ceil(n / BL.COLS);
        return {
            w: BL.PAD * 2 + BL.COLS * BL.SIZE + (BL.COLS - 1) * BL.GAP,
            h: BL.PAD * 2 + rows * BL.SIZE + (rows - 1) * BL.GAP
        };
    }
    function blGridRect(i) {
        return {
            x: BL.PAD + (i % BL.COLS) * (BL.SIZE + BL.GAP),
            y: BL.PAD + Math.floor(i / BL.COLS) * (BL.SIZE + BL.GAP)
        };
    }
    function blHit(e) {
        if (!cvs) return null;
        var rect = cvs.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        for (var i = blRects.length - 1; i >= 0; i--) {
            var r = blRects[i];
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.b;
        }
        return null;
    }
    function blCenterPanel() {
        // 面板内容按需自适应尺寸（不超过画布），并让网格在画布中水平居中
        if (!cvs) return;
        var ps = blPanelSize();
        var availW = cvs.clientWidth, availH = cvs.clientHeight;
        BL.PAD = 16;
        // 【有自定义视图（平移/缩放过）时不重置 BASE，保留用户视角】
        if (blView.ox || blView.oy || blView.s !== 26) { blApply(); return; }
        BL.BASE_X = Math.max(BL.PAD, (availW - ps.w) / 2 + BL.PAD);
        BL.BASE_Y = Math.max(BL.PAD, (availH - ps.h) / 2 + BL.PAD);
        blView.ox = BL.BASE_X; blView.oy = BL.BASE_Y;
    }
    // =====【点击改题 v1】双击/单击节点 → 就地弹出标题输入框（原生 DOM 浮层，不缩放变形）=====
    // 回车 = 保存标题（双轨落盘 canvas_node_ext）并定位到主画布进入该对话直接输入；
    // Esc = 取消。输入失败/留空回车则只定位。
    function _openTitleInput(b, clientX, clientY) {
        var _vid = b ? (b.chatId || (b.el && (b.el.dataset.moId || b.el.dataset.nodeId)) || '') : '';
        var pop = document.createElement('div');
        pop.style.cssText = 'position:fixed;z-index:99999;background:#1e2430;border:1px solid #3d8bfd;border-radius:8px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.5);width:260px;font-size:13px;color:#dde3ec;';
        pop.innerHTML = '<div style="margin-bottom:6px;opacity:.75;">✎ 修改标题（回车保存并发送 / Esc取消）</div>' +
            '<input type="text" style="width:100%;box-sizing:border-box;background:#12161d;border:1px solid #3a4150;border-radius:6px;color:#fff;padding:7px 9px;font-size:13px;outline:none;" />';
        var inp = pop.querySelector('input');
        inp.value = b.extTitle || b.title || '';
        document.body.appendChild(pop);
        var x = Math.min(clientX || window.innerWidth / 2, window.innerWidth - 290);
        var y = Math.min(clientY || window.innerHeight / 2, window.innerHeight - 110);
        pop.style.left = Math.max(8, x) + 'px';
        pop.style.top = Math.max(8, y) + 'px';
        setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 60);
        function cleanup() { try { pop.remove(); } catch (e) {} document.removeEventListener('keydown', onKey, true); }
        function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); cleanup(); } }
        document.addEventListener('keydown', onKey, true);
        inp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') { ev.stopPropagation(); cleanup(); }
            else if (ev.key === 'Enter') {
                ev.preventDefault();
                var nn = inp.value.trim();
                if (nn && _vid) {
                    _orgTitles[_vid] = nn; b.extTitle = nn;
                    try { _extPost({ id: _vid, title_ext: nn, src: 'org' }); } catch (e) {}
                    try { var P1 = window.MinimapOrganize && window.MinimapOrganize.P1; if (P1 && P1.index && P1.index[_vid]) P1.index[_vid].title = nn; } catch (e) {}
                    try { render(); } catch (e) {}
                }
                cleanup();
                blFocus(b); // 保存后定位到主画布，直接进入该对话输入消息
            }
        });
        pop.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
        inp.addEventListener('blur', function () { setTimeout(function () { if (pop.isConnected) { try { document.activeElement !== inp && cleanup(); } catch (e) {} } }, 150); });
    }
    function blFocus(b) {
        // 双击定位：退出整理面板 + 主画布居中该对话框
        close();
        try {
            if (window.App && App.minimapFocusChatBox) { App.minimapFocusChatBox(b); return; }
            var el = b.el;
            if (el && window.App && App.canvasSetView) {
                var area = document.getElementById('canvasArea');
                var vw = area ? area.clientWidth : window.innerWidth;
                var vh = area ? area.clientHeight : window.innerHeight;
                App.canvasSetView(vw / 2 - el.offsetLeft, vh / 2 - el.offsetTop, 1, true);
            }
        } catch (e) {}
    }
    // 【可见性指挥台 v1】vid → closed 态存 localStorage + ext（P3 规则表落库；queryVisible 消费同键）
    function _vidClosedMap() { try { return JSON.parse(localStorage.getItem('zf_org_closed') || '{}'); } catch (e) { return {}; } }
    function _vidClosed(vid) { return !!_vidClosedMap()[vid]; }
    function _vidSetClosed(vid, closed) {
        var mp = _vidClosedMap();
        if (closed) mp[vid] = 1; else delete mp[vid];
        try { localStorage.setItem('zf_org_closed', JSON.stringify(mp)); } catch (e) {}
        try {
            var P1 = window.MinimapOrganize && window.MinimapOrganize.P1;
            if (P1 && P1.index && P1.index[vid]) { P1.index[vid].closed = closed; P1.syncExt(); }
        } catch (e) {}
        // 立即作用于主画布：qn-gone（app-canvas.js:901/999 以该 class 剔除拾取与渲染）
        try {
            var el = document.getElementById(vid) || (boxes.filter(function(x) { return x.chatId === vid; })[0] || {}).el;
            if (el) el.classList.toggle('qn-gone', closed);
        } catch (e) {}
        _extPost({ id: vid, closed: closed, src: 'org' });
    }
    // 【P3 可见性规则表 v1】按模式显隐：{normal:bool, focus:bool}，false=该模式隐藏
    function _vidVisInMap() { try { return JSON.parse(localStorage.getItem('zf_org_visin') || '{}'); } catch (e) { return {}; } }
    function _vidSetVisibleIn(vid, mode, show) {
        var mp = _vidVisInMap();
        var rule = mp[vid] || {};
        if (show) delete rule[mode]; else rule[mode] = false;
        if (!Object.keys(rule).length) delete mp[vid]; else mp[vid] = rule;
        try { localStorage.setItem('zf_org_visin', JSON.stringify(mp)); } catch (e) {}
        try {
            var P1 = window.MinimapOrganize && window.MinimapOrganize.P1;
            if (P1 && P1.index && P1.index[vid]) { P1.index[vid].visibleIn = rule; P1.syncExt(); }
        } catch (e) {}
        // 主画布作用：normal/focus 任一隐藏 → qn-gone（organize 面板内由 queryVisible 消费规则）
        try {
            var el = document.getElementById(vid) || (boxes.filter(function(x) { return x.chatId === vid; })[0] || {}).el;
            if (el) el.classList.toggle('qn-gone', (rule.normal === false || rule.focus === false));
        } catch (e) {}
        _extPost({ id: vid, visible_in: rule, src: 'org' });
    }
    function _vidVisIn(vid, mode) { var r = _vidVisInMap()[vid] || {}; return r[mode] !== false; }
    // 【完成状态 v1】用户手写「已完成/未完成」：localStorage zf_org_done + ext done 落库（三模式共享真源）
    function _doneMap() { try { return JSON.parse(localStorage.getItem('zf_org_done') || '{}'); } catch (e) { return {}; } }
    function _vidDone(vid) { return !!_doneMap()[vid]; }
    function _vidSetDone(vid, done) {
        var mp = _doneMap();
        if (done) mp[vid] = 1; else delete mp[vid];
        try { localStorage.setItem('zf_org_done', JSON.stringify(mp)); } catch (e) {}
        try {
            var P1 = window.MinimapOrganize && window.MinimapOrganize.P1;
            if (P1 && P1.index && P1.index[vid]) { P1.index[vid].done = done; P1.syncExt(); }
        } catch (e) {}
        _extPost({ id: vid, done: done, src: 'org' });
    }
    function _extPost(body) { _extQueue(body); }
    // 【P2 数据层门禁 v1】写失败回弹：fetch 失败/异常 → 入队，每 8s 重试，成功即出队（断网不丢写）
    var _extPending = []; var _extRetryTimer = null;
    function _extQueue(body) {
        try {
            fetch('/api/engineering/node/upsert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
                .catch(function () { _extEnqueue(body); });
        } catch (e) { _extEnqueue(body); }
    }
    function _extEnqueue(body) {
        _extPending.push(body);
        if (_extPending.length > 200) _extPending.shift(); // 防积压无限膨胀
        if (!_extRetryTimer) _extRetryTimer = setInterval(_extFlush, 8000);
    }
    function _extFlush() {
        if (!_extPending.length) { clearInterval(_extRetryTimer); _extRetryTimer = null; return; }
        var body = _extPending[0];
        fetch('/api/engineering/node/upsert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); _extPending.shift(); })
            .catch(function () {});
    }
    var _blMenu = null;
    function blMenu(e) {
        // 右键原生菜单：面板打开期间恢复浏览器默认（guardUnderlay 只拦 mouse 系，不拦 contextmenu）
        if (_blMenu) { document.body.removeChild(_blMenu); _blMenu = null; }
        var b = blHit(e);
        // 【组右键菜单 v2】命中展开组框（kind:'full'）→ 组管理菜单（命名/底色/折叠/隐藏/解散）
        try {
            var _gr = cvs.getBoundingClientRect();
            var _gmx = e.clientX - _gr.left, _gmy = e.clientY - _gr.top;
            var _bars0 = window._moGroupBars || [];
            for (var _bi0 = _bars0.length - 1; _bi0 >= 0; _bi0--) {
                var _br0 = _bars0[_bi0];
                if (_br0.kind !== 'full') continue;
                if (_gmx >= _br0.x && _gmx <= _br0.x + _br0.w && _gmy >= _br0.y && _gmy <= _br0.y + _br0.h) {
                    var _mg = _br0.g;
                    var _gitems = [];
                    _gitems.push({ label: '✎ 组重命名：' + (_mg.name || ''), fn: function() {
                        _editingGroup = _mg; showNamePop(function() { confirmName(); });
                    } });
                    GROUP_COLORS.forEach(function(_c, _ci) {
                        _gitems.push({ label: '◇ 底色 ' + (_ci + 1) + (_mg.color === _c ? ' ✓' : ''), fn: function() {
                            _mg.color = _c;
                            boxes.forEach(function(mb) { if (_mg.nodeIds.indexOf(mb.el.dataset.moId) >= 0) mb.color = _c; });
                            saveGroups(); render();
                        } });
                    });
                    _gitems.push({ label: _mg.collapsed ? '↕ 展开组' : '▾ 折叠组（成员隐藏只留标题条）', fn: function() {
                        _mg.collapsed = !_mg.collapsed; if (_mg.collapsed) _mg.hidden = false;
                        saveGroups(); render();
                    } });
                    _gitems.push({ label: _mg.hidden ? '◎ 组眼睛：开' : '◯ 组眼睛：关（整组隐藏）', fn: function() {
                        _mg.hidden = !_mg.hidden; if (_mg.hidden) _mg.collapsed = false;
                        saveGroups(); render();
                    } });
                    _gitems.push({ label: '✕ 解散组（保留节点）', fn: function() {
                        var _gi = groups.indexOf(_mg);
                        if (_gi >= 0) groups.splice(_gi, 1);
                        saveGroups(); render();
                    } });
                    var _gmenu = document.createElement('div');
                    _gmenu.className = 'mo-ctx-menu';
                    _gitems.forEach(function(it) {
                        var d = document.createElement('div');
                        d.className = 'mo-ctx-item';
                        d.textContent = it.label;
                        d.addEventListener('click', function() { it.fn(); if (_blMenu) { document.body.removeChild(_blMenu); _blMenu = null; } });
                        _gmenu.appendChild(d);
                    });
                    document.body.appendChild(_gmenu);
                    _gmenu.style.left = Math.min(e.clientX, window.innerWidth - _gmenu.offsetWidth - 6) + 'px';
                    _gmenu.style.top = Math.min(e.clientY, window.innerHeight - _gmenu.offsetHeight - 6) + 'px';
                    _blMenu = _gmenu;
                    setTimeout(function() {
                        document.addEventListener('mousedown', function _closeG(ev) {
                            if (_blMenu && !_blMenu.contains(ev.target)) { document.body.removeChild(_blMenu); _blMenu = null; }
                            document.removeEventListener('mousedown', _closeG);
                        });
                    }, 0);
                    return;
                }
            }
        } catch (eGm) {}
        var menu = document.createElement('div');
        menu.className = 'mo-ctx-menu';
        var items = [];
        var _vid = b ? (b.chatId || b.el.dataset.moId || '') : '';
        if (b) {
            items.push({ label: '◎ 定位到主画布', fn: function() { blFocus(b); } });
            items.push({ label: '✎ 改名（标题双轨）', fn: function() {
                var nn = prompt('自定义标题（留空恢复原题）', b.extTitle || b.title || '');
                if (nn === null) return;
                if (nn) { _orgTitles[_vid] = nn; b.extTitle = nn; _extPost({ id: _vid, title_ext: nn, src: 'org' }); }
                else { delete _orgTitles[_vid]; delete b.extTitle; _extPost({ id: _vid, title_ext: '', src: 'org' }); }
                try { var P1 = window.MinimapOrganize && window.MinimapOrganize.P1; if (P1 && P1.index && P1.index[_vid]) P1.index[_vid].title = nn || b.title; } catch (e) {}
                render();
            } });
            items.push({ label: _vidClosed(_vid) ? '◉ 显示（普通/专注模式）' : '◯ 关闭（三模式隐藏）', fn: function() {
                var now = !_vidClosed(_vid);
                _vidSetClosed(_vid, now);
                render();
            } });
            // 【完成状态 v1】用户手写完成标记（只改徽标，不动任务状态）
            items.push({ label: _vidDone(_vid) ? '☑ 已完成 → 点击改未完成' : '☐ 未完成 → 点击改已完成', fn: function() {
                _vidSetDone(_vid, !_vidDone(_vid));
                render();
            } });
            // 【P3 规则表】按模式批量显隐（false=该模式隐藏，画布立即生效）
            items.push({ label: _vidVisIn(_vid, 'normal') ? '▢ 普通模式：显示 → 点击隐藏' : '▢ 普通模式：隐藏 → 点击显示', fn: function() {
                _vidSetVisibleIn(_vid, 'normal', !_vidVisIn(_vid, 'normal'));
                render();
            } });
            items.push({ label: _vidVisIn(_vid, 'focus') ? '▣ 专注模式：显示 → 点击隐藏' : '▣ 专注模式：隐藏 → 点击显示', fn: function() {
                _vidSetVisibleIn(_vid, 'focus', !_vidVisIn(_vid, 'focus'));
                render();
            } });
            // 【P2 折叠/眼睛 v1】作用于所在组：折叠=成员只留标题条；隐藏=整组隐（点条恢复）
            // 【P2 v1.1 重构】拆行：一次查组，两处复用，消除三元内嵌赋值
            var _mog2 = groupBoxOfByIdOf(b); // 【P2 v1.1】组折叠/眼睛菜单用（声明提前防隐式全局）
            items.push({ label: _mog2 && _mog2.collapsed ? '↕ 展开本组' : '▾ 折叠本组（只留标题条）', fn: function() {
                var g = groupBoxOfByIdOf(b); if (!g) return;
                g.collapsed = !g.collapsed;
                if (g.collapsed) g.hidden = false;
                saveGroups(); render();
            } });
            items.push({ label: _mog2 && _mog2.hidden ? '◎ 组眼睛：开' : '◯ 组眼睛：关（整组隐藏）', fn: function() {
                var g = groupBoxOfByIdOf(b); if (!g) return;
                g.hidden = !g.hidden;
                if (g.hidden) g.collapsed = false;
                saveGroups(); render();
            } });
            items.push({ label: selected.has(b.el) ? '取消选中' : '选中', fn: function() {
                if (selected.has(b.el)) selected.delete(b.el); else { selected.clear(); selected.add(b.el); }
                updateToolbar(); render();
            } });
            // 【框选建组 v1】选中多个后可一键建组（含当前卡片）
            if (selected.size >= 2) {
                items.push({ label: '▤ 将选中的 ' + selected.size + ' 个建组', fn: function() {
                    createGroupFromSelection();
                } });
            }
        }
        // 【空白右键创建·S3a】右键 → 与双击/Tab 一致弹出「创建对话框」双栏面板（统一走 _openCreateDialog，
        // 移除旧 chatManage 兜底：普通画布无兜底，KiteCanvas 缺失时 console.error 对齐）
        items.push({ label: '＋ 创建对话框（弹出创建面板）', fn: function() {
            if (_openCreateDialog(e.clientX, e.clientY)) close();
        } });
        if (!items.length) items.push({ label: '（空白处右键）', fn: null });
        items.forEach(function(it) {
            var d = document.createElement('div');
            d.className = 'mo-ctx-item' + (it.fn ? '' : ' disabled');
            d.textContent = it.label;
            if (it.fn) d.addEventListener('click', function() { it.fn(); removeMenu(); });
            menu.appendChild(d);
        });
        function removeMenu() { if (_blMenu && _blMenu.parentNode) _blMenu.parentNode.removeChild(_blMenu); _blMenu = null; }
        document.body.appendChild(menu);
        menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 6) + 'px';
        menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 6) + 'px';
        _blMenu = menu;
        setTimeout(function() {
            document.addEventListener('mousedown', function _close(ev) {
                if (_blMenu && !_blMenu.contains(ev.target)) removeMenu();
                document.removeEventListener('mousedown', _close);
            });
        }, 0);
    }
    // 【悬停平滑放大 v2】图标重绘：悬停方块平滑放大到 1.18 倍（rAF 插值，ease-out 手感顺滑）
    var _moScaleMap = new Map(); // box -> 当前缩放
    var _moAnimId = null;
    function _moScaleOf(b) { var v = _moScaleMap.get(b); return v === undefined ? 1 : v; }
    /* 【四球摄像机缩放补偿 v5·用户令】画布缩得越小，四球屏幕基准越大（同分组按钮 data-zf-base 思路），保证缩小整理模式四球始终可辨 */
    function _moComp() {
      var host = document.getElementById('canvasContent');
      if (!host) return 1;
      var rc = host.getBoundingClientRect();
      var k = (host.offsetWidth > 0 && rc.width > 0) ? rc.width / host.offsetWidth : 1;
      return 1 / Math.max(k, 0.05);
    }
    function _moAnimTick() {
        _moAnimId = null;
        var busy = false;
        _moScaleMap.forEach(function(v, k) {
            var target = (hoverBox === k) ? 1.18 : 1;
            var nv = v + (target - v) * 0.22; // 指数趋近，顺滑无跳变
            if (Math.abs(nv - target) < 0.004) nv = target;
            else busy = true;
            _moScaleMap.set(k, nv);
        });
        if (_moScaleMap.size > 400) { // 清理已消失的方块，防泄漏
            var alive = new Set(boxes);
            _moScaleMap.forEach(function(v, k) { if (!alive.has(k) && _moScaleMap.get(k) === 1) _moScaleMap.delete(k); });
        }
        if (active) render();
        if (busy && active) _moAnimId = requestAnimationFrame(_moAnimTick);
    }
    function startMoAnim() { if (active && !_moAnimId) _moAnimId = requestAnimationFrame(_moAnimTick); }
    // =====【性能 v6·3000节点目标】每帧热点消除 =====
    // ① 标题截断缓存：while+measureText 逐字回退每帧每方块重算是最大热点（3000节点=每帧数千次 measureText）
    //    按 text|maxW|font 缓存结果；LRU 上限 4096 防膨胀
    var _truncCache = new Map();
    function _truncText(text, maxW, font) {
        if (!text) return '';
        var key = font + '|' + maxW + '|' + text;
        var hit = _truncCache.get(key);
        if (hit !== undefined) return hit;
        ctx.font = font;
        var out = text;
        if (ctx.measureText(text).width > maxW) {
            var c = text.length;
            while (c > 1 && ctx.measureText(text.slice(0, c) + '…').width > maxW) c--;
            out = text.slice(0, c) + '…';
        }
        if (_truncCache.size > 4096) _truncCache.clear();
        _truncCache.set(key, out);
        return out;
    }
    // ② 方块描边渐变缓存：旧版每方块每帧 createLinearGradient（分配/GC 压力大头）。
    //    渐变定义在原点坐标系，绘制时 translate 对齐方块（平移不失效，尺寸变化才重建）
    var _blkGradCache = new Map();
    function _blkGrad(r, strokeCol, col) {
        var key = Math.round(r.w) + 'x' + Math.round(r.h) + '|' + strokeCol + '|' + col;
        var g = _blkGradCache.get(key);
        if (!g) {
            g = ctx.createLinearGradient(0, 0, r.w, r.h);
            g.addColorStop(0, strokeCol || '#9aa');
            g.addColorStop(1, hexToRgba(col, 0.85));
            if (_blkGradCache.size > 2048) _blkGradCache.clear();
            _blkGradCache.set(key, g);
        }
        return g;
    }
    function _renderBlocksNow() {
        // =====【S1 收编轮询 + P1 NodeIndex 同步】_orgEnhance 1s 轮询并入主渲染循环 =====
        // 面板开着才跑、节流 1s；索引增量重建 + 仅 dirty 节点上报 ext（详见文件尾部 _p1 模块）
        try {
            var _tn = Date.now();
            if ((!_$orgTickTs || _tn - _$orgTickTs > 1000)) {
                _$orgTickTs = _tn;
                if (window.__orgEnhanceTick) { try { window.__orgEnhanceTick(); } catch (eT) {} }
                try { _p1Rebuild(); _p1SyncExt(); } catch (eP1) {}
            }
        } catch (eS1) {}
        if (!cvs || !ctx) return;
        var w = cvs.clientWidth, h = cvs.clientHeight;
        var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        var rw = Math.max(1, Math.round(w * dpr)), rh = Math.max(1, Math.round(h * dpr));
        if (cvs.width !== rw || cvs.height !== rh) { cvs.width = rw; cvs.height = rh; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // 【位置映射 v2】小方块=真实对话框位置的等比映射（复用 fit 视图），面板布局与主画布一一对应
        computeView();
        blRects = []; boxRects = [];
        var _ghostRects = []; // 【隐藏幽灵框 v1】closed/普通模式隐藏的节点：面板内画虚线空框，保留位置感
        // 【方块过小修复】记录打开后的基准 fit 比例，方块尺寸以此为锚，
        // 不再随布局摊开而塌缩到 4px 下限（那是"方块非常小 + 框选失效"的共同根因）
        // 【锚点修正 v2】锚点只在面板打开时重置（open() 置 0），此处仅懒初始化。
        // 不能比 view 引用——computeView() 每帧新建对象，引用比较恒真会导致锚点
        // 每帧被重置、_k 恒为 1，缩放跟随失效（审核员备注①）
        if (!_blS0) _blS0 = view.s || 0.05;
        // =====【P1 绘制消费 v1】LOD 判级驱动绘制 =====
        // 面板可见区反推世界矩形 → assignLod 世界坐标视口；本帧可见世界包围盒外 ±80px（世界单位近似）缓存 L2
        // L0=完整绘制(文字+边框+角标) | L1=纯色块无文字 | L2=屏外不画（blRects 不收）
        var _lodStat = { l0: 0, l1: 0, l2: 0 };
        try {
            if (typeof P1 !== 'undefined' && P1 && P1.assignLod && boxes.length && view) {
                var _pad = 80 / Math.max(0.01, view.s);
                var _tl = m2w(0, 0), _br = m2w(cvs.clientWidth, cvs.clientHeight);
                _lodStat = P1.assignLod(_tl.x - _pad, _tl.y - _pad, _br.x + _pad, _br.y + _pad) || _lodStat;
            }
        } catch (eLod) {}
        boxes.forEach(function(b) {
            var p = w2m(b.x, b.y);
            var cx = p.x + b.w * view.s / 2, cy = p.y + b.h * view.s / 2;
            // 【导航同款 v4】方块 = 真实对话框在面板视图下的等比投影（与右下角小地图完全同款）：
            // 宽高 = b.w/b.h × view.s，宽高比与真实对话一模一样，位置与大小天然对齐、永不重叠。
            // 仅设 3px 可见下限（比导航的 2px 略大），滚轮缩放可放大（userView 体系）。
            var sideW = Math.max(3, b.w * view.s);
            var sideH = Math.max(3, b.h * view.s);
            var r = { x: cx - sideW / 2, y: cy - sideH / 2, w: sideW, h: sideH, b: b };
            var off = (r.x > w + 40 || r.y > h + 40 || r.x + r.w < -40 || r.y + r.h < -40);
            var _lodN = null;
            try { if (typeof P1 !== 'undefined' && P1 && P1.node) _lodN = P1.node(b.id || (b.el && (b.el.dataset.moId || b.el.dataset.nodeId))); } catch (eN) {}
            // 【P2 分组折叠+组眼睛 v1】组 hidden=整组隐藏（成员方块不画也不进 hitBox）；collapsed=折叠（成员不画，画组标题条）
            if (!_boxGroupState) _boxGroupState = null;
            var _ownG = groupBoxOfByIdOf(b);
            if (_ownG && (_ownG.hidden || _ownG.collapsed)) off = true;
            if (_lodN && _lodN.lod === 2) off = true; // 【P1 LOD v1】判级 L2（视口+±80px 缓冲外）→ 不进 blRects 不画
            /* 【可见性消费 v1】queryVisible 统一拦截（P3 规则表+closed）：面板绘制端正式消费，
               修复「写入侧通、消费侧断」——closed/visibleIn=false 的节点不再被画出（仍进 boxRects 保连线端点） */
            try {
                var _qvId = b.id || (b.el && (b.el.dataset.moId || b.el.dataset.nodeId));
                if (typeof P1 !== 'undefined' && P1 && P1.queryVisible && _qvId && !P1.queryVisible(_qvId, 'organize')) off = true;
                // 【隐藏幽灵框 v1】被隐藏（关闭/普通模式隐藏）且在本帧视口内的节点 → 收入幽灵框列表
                var _gh = false;
                try { _gh = (_vidClosed(_qvId) || !_vidVisIn(_qvId, 'normal')) && !off; } catch (eGh) {}
                if (_gh) _ghostRects.push(r);
            } catch (eQV) {}
            if (!off) {
                blRects.push(r);
            }
            boxRects.push({ x: b.x, y: b.y, w: b.w, h: b.h, b: b }); // 【设计意图留痕·勿删勿修】off/被剔除卡片也进 boxRects：queryVisible/closed/视口剔除的节点仍计连线端点——有意为之（连线不缺端点），非 bug 非残留；坐标是「幽灵坐标」（节点不画但有位置），S2c 双管线或连线高亮改造时须保留此语义
        });
        var C = {
            card: 'rgba(0,0,0,0)',   // 【全透明 v4·用户令】卡片底色透明：直接透出对话背景，白字照读（原 --bg-card #1e1e2e 黑底已去）
            border: themeVar('--border', 'rgba(255,255,255,0.16)')
        };
        // 组框（虚线包围所选成员的映射方块）
        // 【P2 折叠/眼睛 v1】_moGroupBars：折叠/隐藏组的标题条像素矩形，供点击命中（折叠条点击=展开，眼睛条点击=切换显隐）
        window._moGroupBars = [];
        groups.forEach(function(g) {
            var ms = blRects.filter(function(r) { return g.nodeIds.indexOf(r.b.el.dataset.moId) >= 0; });
            // 【P2 v1】折叠组：成员不进 blRects → 用 boxRects（世界坐标）自算包围盒，画标题条代替组框
            if (g.collapsed || g.hidden) {
                var mm = boxRects.filter(function(rr) { return g.nodeIds.indexOf(rr.b.el.dataset.moId) >= 0; });
                if (!mm.length) return;
                var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
                mm.forEach(function(rr) {
                    var pp = w2m(rr.x, rr.y);
                    var ww = Math.max(3, rr.w * view.s), hh = Math.max(3, rr.h * view.s);
                    var ccx = pp.x + ww / 2, ccy = pp.y + hh / 2;
                    if (ccx - ww / 2 < bx0) bx0 = ccx - ww / 2; if (ccy - hh / 2 < by0) by0 = ccy - hh / 2;
                    if (ccx + ww / 2 > bx1) bx1 = ccx + ww / 2; if (ccy + hh / 2 > by1) by1 = ccy + hh / 2;
                });
                ctx.save();
                // 【v3】折叠组标题条：字号随摄像机缩放自适应（钳制 10~22px），条高随字号，距卡片更远
                var _cfs = Math.max(10, Math.min(22, 11 * view.s));
                var _bh = Math.round(_cfs + 10);
                var barY = Math.max(2, by0 - _bh - 16);
                var _bwx = Math.max(120, bx1 - bx0);
                // 【组卡片美化 v2】水平渐变卡片替代旧纯色条：圆角+描边+居中布局（图标 组名 徽标）
                var _bg2 = ctx.createLinearGradient(bx0, barY, bx0 + _bwx, barY + _bh);
                _bg2.addColorStop(0, hexToRgba(g.color, g.hidden ? 0.35 : 0.9));
                _bg2.addColorStop(1, hexToRgba(g.color, g.hidden ? 0.18 : 0.55));
                ctx.fillStyle = _bg2;
                roundRect(bx0, barY, _bwx, _bh, 8);
                ctx.fill();
                ctx.strokeStyle = hexToRgba(g.color, g.hidden ? 0.55 : 0.95);
                ctx.lineWidth = 1.5;
                if (g.hidden) { ctx.setLineDash([4, 3]); }
                ctx.stroke();
                ctx.setLineDash([]);
                // 内容【v3】：图标 + 组名 + 数量徽标（整体居中，字号随摄像机缩放）
                ctx.font = 'bold ' + _cfs + 'px sans-serif';
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                var _ico = g.hidden ? '◌' : (g.collapsed ? '▤' : '▸');
                var _gn2 = String(g.name || '').slice(0, 12);
                var _gc2 = ' ' + (g.nodeIds || []).length;
                var _iw = ctx.measureText(_ico + ' ').width;
                var _nw2 = ctx.measureText(_gn2).width;
                ctx.font = Math.round(_cfs * 0.9) + 'px sans-serif';
                var _cw2 = ctx.measureText(_gc2).width;
                var _tw2 = _iw + _nw2 + _cw2;
                var _tx2 = bx0 + 10; /* 【左上角定位 v1】折叠组标题条文字靠左上，不再水平居中——用户反馈：居中易找不到分组位置 */
                ctx.font = _cfs + 'px sans-serif';
                ctx.fillStyle = g.hidden ? 'rgba(255,255,255,0.6)' : '#fff';
                ctx.fillText(_ico, _tx2, barY + _bh / 2 + 0.5);
                ctx.font = 'bold ' + _cfs + 'px sans-serif';
                ctx.fillText(_gn2, _tx2 + _iw, barY + _bh / 2 + 0.5);
                ctx.font = Math.round(_cfs * 0.9) + 'px sans-serif';
                ctx.globalAlpha = 0.85;
                ctx.fillText(_gc2, _tx2 + _iw + _nw2 + 2, barY + _bh / 2 + 0.5);
                ctx.globalAlpha = 1;
                ctx.restore();
                window._moGroupBars.push({ x: bx0, y: barY, w: Math.max(60, bx1 - bx0), h: _bh, g: g, kind: 'bar' });
                return;
            }
            if (!ms.length) return;
            var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            ms.forEach(function(r) { if (r.x < x0) x0 = r.x; if (r.y < y0) y0 = r.y; if (r.x + r.w > x1) x1 = r.x + r.w; if (r.y + r.h > y1) y1 = r.y + r.h; });
            // 【分组美化 v3】加大 padding：组框与成员卡片距离更远；字号随摄像机缩放自适应
            var _gpad = 50; /* 【用户令v2】26→50 组框内边距加大 */
            ctx.save();
            var _gx0 = x0 - _gpad, _gy0 = y0 - _gpad - 24, _gw0 = x1 - x0 + _gpad * 2, _gh0 = y1 - y0 + _gpad * 2 + 24;
            var _gg = ctx.createLinearGradient(_gx0, _gy0, _gx0 + _gw0, _gy0 + _gh0);
            _gg.addColorStop(0, hexToRgba(g.color, 0.22));
            _gg.addColorStop(1, hexToRgba(g.color, 0.08));
            ctx.fillStyle = _gg;
            ctx.strokeStyle = hexToRgba(g.color, 0.85);
            ctx.lineWidth = 2;
            roundRect(_gx0, _gy0, _gw0, _gh0, 10);
            ctx.fill(); ctx.stroke();
            // 胶囊标题【v3】：字号随摄像机缩放（钳制 9~20px），背景更实、内 padding 更大
            var _fs = Math.max(9, Math.min(20, 11 * view.s));
            var _gname = String(g.name || '').slice(0, 14);
            var _gcnt = ' ' + (g.nodeIds || []).length;
            ctx.font = 'bold ' + _fs + 'px sans-serif';
            var _tw = ctx.measureText(_gname).width;
            ctx.font = Math.round(_fs * 0.9) + 'px sans-serif';
            var _cw = ctx.measureText(_gcnt).width;
            var _ph2 = Math.round(_fs + 9);
            var _pw2 = _tw + _cw + Math.round(_ph2 * 1.4);
            var _px2 = Math.max(2, _gx0 + 8), _py2 = Math.max(2, _gy0 - Math.round(_ph2 / 2) - 2);
            ctx.fillStyle = hexToRgba(g.color, 0.95);
            roundRect(_px2, _py2, _pw2, _ph2, _ph2 / 2);
            ctx.fill();
            ctx.strokeStyle = hexToRgba(g.color, 0.9);
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.font = 'bold ' + _fs + 'px sans-serif';
            ctx.fillText(_gname, _px2 + Math.round(_ph2 * 0.7), _py2 + _ph2 / 2 + 0.5);
            ctx.font = Math.round(_fs * 0.9) + 'px sans-serif';
            ctx.globalAlpha = 0.9;
            ctx.fillText(_gcnt, _px2 + Math.round(_ph2 * 0.7) + _tw + 4, _py2 + _ph2 / 2 + 0.5);
            ctx.globalAlpha = 1;
            ctx.restore();
            // 【组拖拽/组菜单 v2】展开组整框像素矩形入命中缓存（kind:'full'）：空白拖动=拖整组，右键=组菜单
            window._moGroupBars.push({ x: _gx0, y: _gy0, w: _gw0, h: _gh0, g: g, kind: 'full' });
        });
        // 关系连线（策划/审核状态箭头 + 多角色父子橙金线），按映射坐标绘制
        // 【层级修复】线垫在方块下、文字盖在方块上：两阶段绘制（lines → 方块 → labels）
        drawPairArrows(w2m, view, 'lines');
        // 【隐藏幽灵框 v1】被隐藏节点画灰色虚线空框（无标题无球），垫在正常方块下，提示"此处有隐藏对话"
        _ghostRects.forEach(function(r) {
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(160,160,180,0.45)';
            roundRect(r.x, r.y, r.w, r.h, 6);
            ctx.stroke();
            ctx.restore();
        });
        // 方块（映射位置，中心=真实卡片中心）
        blRects.forEach(function(r) {
            var b = r.b;
            var isSel = selected.has(b.el);
            var isHov = (hoverBox === b);
            var col = b.color || C.card;
            // 【悬停平滑放大 v2】以方块中心为锚缩放绘制矩形（命中区 blRects 保持原尺寸，点击热区不变）
            var _sc = _moScaleOf(b);
            if (Math.abs(_sc - 1) > 0.001) {
                var _gw = r.w * _sc - r.w, _gh = r.h * _sc - r.h;
                r = { x: r.x - _gw / 2, y: r.y - _gh / 2, w: r.w + _gw, h: r.h + _gh, b: b };
            }
            // 【空心化 v2】方块不再实心填充：只画一条「状态色→组色」对角渐变外框，内部透明（网格透出）。
            // 保留：宽高比（等比投影不变）、可点选/拖拽（blRects 命中区不变）、悬停平滑放大。
            // 「四球系统」挂载在真实对话框 DOM 头部（chatbox-mile-balls），不在本画布绘制范围，天然保留。
            var _moSt = statusOfBox(b);
            var _moSc = MO_STATUS_COLORS[_moSt] || MO_STATUS_COLORS.idle;
            var _dnOrg = false; try { _dnOrg = _vidDone(b.chatId || b.el.dataset.moId || ''); } catch (eDn) {}
            var _gradOrg = _blkGrad(r, _moSc.stroke, col); // 【性能 v6】缓存渐变，绘制时 translate 对齐
            ctx.save();
            ctx.translate(r.x, r.y); // 渐变按相对坐标缓存，平移对齐（尺寸变化才重建）
            ctx.lineWidth = isSel ? 2.5 : (isHov ? 2 : 1.5);
            ctx.strokeStyle = isSel ? col : _gradOrg;
            roundRect(0, 0, r.w, r.h, 6);
            ctx.stroke();
            ctx.restore();
            // 【标题 v2】外框内顶部一行（空心化后唯一保留内容），宽度不足截断省略
            var _ttFull = String(b.extTitle || b.title || (b.chat && b.chat.name) || '').replace(/\s+/g, ' ').trim();
            if (_ttFull && r.w >= 12 && r.h >= 10) {
                var _fsH = Math.max(6, Math.min(9, r.h * 0.22)); // 【v6】标题字号缩小（用户反馈"标题有点大"）
                ctx.save();
                ctx.font = 'bold ' + _fsH.toFixed(1) + 'px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                var _ttH = _truncText(_ttFull, r.w - 8, ctx.font); // 【性能 v6】截断走缓存
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(255,255,255,0.25)'; // 【可读性 v6】暗主题下描边改浅色半透明，白字更清晰
                ctx.strokeText(_ttH, r.x + 4, r.y + 5 + _fsH / 2);
                ctx.fillStyle = '#fff';
                ctx.fillText(_ttH, r.x + 4, r.y + 5 + _fsH / 2);
                ctx.restore();
            }
            // 【四球系统 v4·用户令】四球常驻左上角：未点亮画暗球占位；总结球在任务成功/已回答时
            // 显示白色对号（不依赖 _milestone.summary 是否解析出），保证"成功→对号"必现
            try {
                var _mb = (b.chat && b.chat._milestone) || {};
                if (r.w >= 26 && r.h >= 12) {
                    var _moBalls = [
                        { k: 'plan',    c: 'rgba(77,163,255,.95)',  lit: !!_mb.plan },
                        { k: 'progress',c: 'rgba(74,222,128,.95)',  lit: !!_mb.progress },
                        { k: 'audit',   c: (function(){ var v = _mb.audit ? Number(_mb.audit.val) : NaN; return (v >= 60) ? 'rgba(245,197,66,.95)' : 'rgba(240,90,90,.95)'; })(), lit: !!_mb.audit },
                        { k: 'summary', c: 'rgba(177,140,255,.95)', lit: !!_mb.summary, ok: !!_mb.summary || !!b.answered }
                    ];
                    var _mc = _moComp(); // 【四球摄像机缩放补偿 v5】与分组按钮同思路：屏幕尺寸恒定，摄像机缩多小球都不消失；上限12px防与标题重叠
                    var _br = Math.max(3, Math.min(12, 4.5 * _mc));
                    var _bx0 = r.x + 4 + _br, _by0 = r.y + 4 + _br;
                    _moBalls.forEach(function (mb2, bi) {
                        var _cx2 = _bx0 + bi * (_br * 2 + 1.5);
                        var _cy2 = _by0;
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(_cx2, _cy2, _br, 0, Math.PI * 2);
                        ctx.fillStyle = mb2.lit ? mb2.c : 'rgba(255,255,255,0.13)'; // 未点亮=暗球占位
                        ctx.fill();
                        // 球面文字：进度百分比/审核分数直接上球，太小时跳过文字只留色球
                        var _face2 = !mb2.lit ? ''
                                  : mb2.k === 'progress' ? String(_mb.progress.val || '%')
                                  : mb2.k === 'audit' ? String(_mb.audit.val || '')
                                  : mb2.k === 'summary' ? '✓' : '#';
                        if (mb2.k === 'summary' && mb2.ok && _face2 !== '✓') _face2 = '✓'; // 成功对号保底
                        if (_br >= 4 && _face2.length <= 3) {
                            ctx.fillStyle = '#fff';
                            ctx.font = 'bold ' + Math.max(4, _br).toFixed(1) + 'px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(_face2, _cx2, _cy2 + 0.5);
                        }
                        ctx.restore();
                    });
                }
            } catch (eBalls) {}
            // 【工作台虚拟框 v14】宿主对话框若开着工作台抽屉，在其方块左侧渲染虚拟框（与右下角导航同款）：
            // 位置每帧由宿主方块 r 推导（左缘外贴、底部对齐），宿主被拖动/移动时自动跟随；
            // 左侧空间不足（贴面板左缘）时改为叠加画在方块内部，避免被裁剪；
            // 可见性检测结果按方块缓存 300ms，降低每帧 querySelector/getComputedStyle 开销；
            // 纯绘制不进 blRects/boxRects，不可点选/拖拽（与导航虚拟框交互语义一致）。
            try {
                var _bKey = b.id || b.el.__oid || (b.el.__oid = 'b' + (b.el.offsetTop || 0) + '_' + (b.el.offsetLeft || 0));
                var _owbCache = _wbVisCache[_bKey];
                var _now = Date.now();
                var _owbVis = false, _oW = 0, _oH = 0, _oSide = false;
                if (_owbCache && _now - _owbCache.t < 300) {
                    _owbVis = _owbCache.v; _oW = _owbCache.w; _oH = _owbCache.h; _oSide = !!_owbCache.s;
                } else {
                    var _owb = b.el.querySelector(':scope > .wb-drawer.open') || b.el.querySelector('.wb-drawer.open');
                    if (_owb && _owb.offsetWidth > 0) {
                        try {
                            var _oOp = parseFloat(getComputedStyle(_owb).opacity);
                            _owbVis = isNaN(_oOp) || _oOp > 0.05;
                        } catch (e2) { _owbVis = true; }
                        _oW = _owb.offsetWidth; _oH = _owb.offsetHeight;
                        // 【v16】缓存左右侧状态，避免缓存命中期间误判
                        try { _oSide = (_owb.classList && _owb.classList.contains('wb-side-right'))
                            || (b.el.classList.contains('wb-side-right') && b.el.contains(_owb)); } catch (es) {}
                    }
                    _wbVisCache[_bKey] = { t: _now, v: _owbVis, w: _oW, h: _oH, s: _oSide };
                }
                if (_owbVis && _oW > 0 && _oH > 0) {
                    var _fullW = r.w * (_oW / Math.max(1, b.w));
                    var _oRH = Math.max(2, Math.min(r.h * (_oH / Math.max(1, b.h)), r.h));
                    var _oX, _oRW;
                    // 【v15/v16 修复】抽屉切到右侧（wb-side-right）时虚拟框画在方块右侧，与实际位置一致
                    var _oRight = _oSide;
                    if (_oRight) {
                        var _cw = 0;
                        try { _cw = cvs ? (cvs.clientWidth || cvs.width) : 0; } catch (ecw) {}
                        if (_cw - (r.x + r.w) >= _fullW + 4) {
                            _oRW = Math.max(3, _fullW);
                            _oX = r.x + r.w; // 右缘外贴
                        } else {
                            _oRW = Math.max(3, Math.min(_fullW, r.w - 4));
                            _oX = r.x + (r.w - _oRW) / 2; // 空间不足，叠加画在方块内部
                        }
                    } else if (r.x >= _fullW + 4) {
                        _oRW = Math.max(3, _fullW);
                        _oX = r.x - _oRW; // 左缘外贴
                    } else {
                        _oRW = Math.max(3, Math.min(_fullW, r.w - 4));
                        _oX = r.x + (r.w - _oRW) / 2; // 空间不足，叠加画在方块内部
                    }
                    var _oY = r.y + r.h - _oRH;
                    ctx.save();
                    ctx.fillStyle = 'rgba(74, 153, 136, 0.35)';
                    ctx.strokeStyle = 'rgba(127, 232, 199, 1)';
                    ctx.shadowColor = 'rgba(127, 232, 199, 0.8)';
                    ctx.shadowBlur = 6;
                    ctx.globalAlpha = 0.95;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.fillRect(_oX, _oY, _oRW, _oRH);
                    ctx.strokeRect(_oX, _oY, _oRW, _oRH);
                    ctx.restore();
                }
            } catch (e1) {}
            if (isSel) {
                // 【选中态强化 v2】发光外圈 + 四角括号 + 中心亮线，一眼可辨
                ctx.save();
                ctx.shadowColor = col;
                ctx.shadowBlur = 10;
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = '#ffffff';
                roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 7);
                ctx.stroke();
                ctx.shadowBlur = 0;
                var cl = Math.max(4, Math.min(r.w, r.h) * 0.3); // 角括号长度
                ctx.lineWidth = 2;
                ctx.strokeStyle = col;
                var x2 = r.x - 5, y2 = r.y - 5, x3 = r.x + r.w + 5, y3 = r.y + r.h + 5;
                ctx.beginPath();
                ctx.moveTo(x2 + cl, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 + cl);
                ctx.moveTo(x3 - cl, y2); ctx.lineTo(x3, y2); ctx.lineTo(x3, y2 + cl);
                ctx.moveTo(x2 + cl, y3); ctx.lineTo(x2, y3); ctx.lineTo(x2, y3 - cl);
                ctx.moveTo(x3 - cl, y3); ctx.lineTo(x3, y3); ctx.lineTo(x3, y3 - cl);
                ctx.stroke();
                ctx.restore();
            }
        });
        // 状态文字胶囊最后画，盖在方块之上
        drawPairArrows(w2m, view, 'labels');
        // 【悬停完整标题 v6】字号缩小 + 鼠标悬停时浮出完整标题（不截断），解决"标题大看不全"
        if (hoverBox && !MO_LEGACY) {
            var _hb = blRects.filter(function(rr) { return rr.b === hoverBox; })[0];
            var _htFull = String(hoverBox.extTitle || hoverBox.title || (hoverBox.chat && hoverBox.chat.name) || '').replace(/\s+/g, ' ').trim();
            if (_hb && _htFull) {
                ctx.save();
                ctx.font = '11px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                var _hw = Math.min(ctx.measureText(_htFull).width + 16, cvs.clientWidth - 8);
                var _hx = Math.min(Math.max(4, _hb.x + _hb.w / 2 - _hw / 2), cvs.clientWidth - _hw - 4);
                var _hy = _hb.y - 26; if (_hy < 2) _hy = _hb.y + _hb.h + 4;
                ctx.fillStyle = 'rgba(15, 20, 30, 0.92)';
                ctx.strokeStyle = 'rgba(127, 232, 199, 0.7)';
                ctx.lineWidth = 1;
                roundRect(_hx, _hy, _hw, 20, 6); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.fillText(_htFull, _hx + 8, _hy + 10.5, _hw - 14);
                ctx.restore();
            }
        }
        // 框选框（小方块版）：颜色区分 + 角落标签（默认=蓝 | Shift加选=绿＋ | Ctrl减选=红－）
        if (_marquee && mode === 'marquee') {
            var mCol = marqueeOp === 'add' ? '#2ecc71' : (marqueeOp === 'sub' ? '#e74c3c' : themeVar('--blue', '#0984e3'));
            var mLabel = marqueeOp === 'add' ? '＋ 加选' : (marqueeOp === 'sub' ? '－ 减选' : '');
            ctx.save();
            ctx.fillStyle = hexToRgba(mCol, 0.12);
            ctx.strokeStyle = mCol;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.fillRect(_marquee.x, _marquee.y, _marquee.w, _marquee.h);
            ctx.strokeRect(_marquee.x, _marquee.y, _marquee.w, _marquee.h);
            ctx.setLineDash([]);
            if (mLabel) {
                ctx.font = 'bold 11px sans-serif';
                var lw = ctx.measureText(mLabel).width + 12;
                var lx = _marquee.x, ly = _marquee.y - 18;
                if (ly < 2) ly = _marquee.y + 4;
                if (lx + lw > cvs.clientWidth - 2) lx = cvs.clientWidth - 2 - lw;
                ctx.fillStyle = mCol;
                roundRect(lx, ly, lw, 16, 8); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.fillText(mLabel, lx + 6, ly + 8);
            }
            ctx.restore();
        }
    }

    function render() {
        if (_renderPending) return; // 已有排队渲染，本帧合并（不计入保险丝）
        // 【fps v11】调用者堆栈采样式收集：旧版每次 render() 都 new Error().stack + split + 正则
        //   匹配——拖拽/滚轮时每帧一次，堆栈捕获本身 0.3~1ms，是高频路径上的固定税。
        //   改为：默认每 2s 采一次样；仅当保险丝计数过半（疑似失控渲染）时每帧收集用于定位。
        try {
            var _nowS = Date.now();
            var _wantStack = (_fuseCount > 30) || (_nowS - (_stackSampleTs || 0) > 2000);
            if (_wantStack) {
                _stackSampleTs = _nowS;
                var st = new Error().stack || '';
                var lines = st.split('\n').filter(function(l){ return l.indexOf('render @') === -1 && l.indexOf('render (') === -1 && l.trim() !== 'Error'; });
                var caller = (lines[1] || '').trim().slice(0, 120) || 'unknown';
                var caller2 = (lines[2] || '').trim().slice(0, 120);
                var caller3 = (lines[3] || '').trim().slice(0, 120);
                if (caller2 && caller.indexOf('_renderNow') !== -1) caller += ' ← ' + caller2;
                else if (caller2 && /anonymous|^at /.test(caller)) caller += ' ← ' + caller2;
                if (caller3 && caller2 && /anonymous/.test(caller2)) caller += ' ← ' + caller3;
                _callers[caller] = (_callers[caller] || 0) + 1;
            }
        } catch (e) {}
        _renderPending = true;
        requestAnimationFrame(_renderNow);
    }
    function _renderNow() {
        _renderPending = false;
        if (!active) return; // 面板已关闭则丢弃
        if (document.hidden) return; // 页面隐藏时跳过绘制
        // 【CPU 100% 死机根治·保险丝 v2】只在"真正执行的帧"计数。
        //   旧版在 render() 请求入口计数，鼠标滑动/悬停等正常调用会把保险丝
        //   虚熔断，真正失控的渲染回路反而漏网 → 每秒仍跑满 30 帧重绘。
        //   新版：1 秒内实际执行 >28 帧 → 冷却 1.5 秒静默丢弃；
        //   连续 3 次熔断 → 进入"停机保护"，只允许真实用户事件
        //   （mousedown/wheel/keydown/resize/主题切换）解除，未知回路无法自愈复活。
        var now = Date.now();
        // 【框选框可见性修复 v3】交互豁免提前：拖拽/框选/平移是真实用户交互帧，
        //   即使保险丝已熔断（冷却/停机保护）也不得丢弃，否则框选框/选择态被吞，
        //   表现为"看不到框、加减选像没生效"。未知失控回路依旧无法绕过（它不会切 mode）。
        // 【滚轮缩放豁免 v1】onWheel 后 250ms 内的帧 = 真实滚轮交互帧：豁免冷却丢弃、不计熔断计数。
        //   否则连续滚动或其他渲染源占满帧预算时，缩放帧被静默吞掉，画面停旧帧（"滚了没反应"）。
        var _wheeling = (now < _wheelUntil);
        var _interacting = (mode === 'drag' || mode === 'marquee' || mode === 'pan' || _wheeling);
        if (_fuseLockUntil > now && !_interacting) return;
        // 【拖拽掉块修复】拖拽/框选/平移/滚轮缩放是真实用户交互帧，不计入保险丝（否则高频
        //   mousemove/滚轮渲染被误熔断 → 画面停帧，表现为"方块不动/选择态消失/缩放没反应"）
        if (now - _fuseTs > 1000) { _fuseCount = 0; _fuseTs = now; }
        if (!_interacting) _fuseCount++;
        if (_fuseCount > 60 && !_interacting) {
            _fuseTrips++;
            _fuseLockUntil = now + 800;
            _fuseCount = 0;
            if (_fuseTrips === 1) {
                console.warn('[organize] 渲染保险丝首次熔断，调用栈如下（定位失控渲染来源）：');
                try { console.trace(); } catch (e) {}
                // 【调用来源统计】打印本统计窗口内谁在反复调 render()（Top 8）
                try {
                    var entries = Object.keys(_callers).map(function(k){ return [k, _callers[k]]; })
                        .sort(function(a,b){ return b[1]-a[1]; }).slice(0, 8);
                    console.warn('[organize] render() 调用来源 Top8：\n' + entries.map(function(e){ return '  ' + e[1] + ' 次 ← ' + e[0]; }).join('\n'));
                    _callers = {};
                } catch (e) {}
            }
            if (_fuseTrips >= 3) {
                _fuseLockUntil = now + 365 * 86400000; // 停机保护：未知渲染回路被永久隔离
                console.warn('[organize] 渲染保险丝连续熔断3次，进入停机保护（点击面板/滚轮/按键可解除）');
            }
            return;
        }
        if (!MO_LEGACY) {
            // 【小方块模式】同款节流由保险丝兜底，直接走轻量方块渲染
            _renderSilent();
            try { _renderBlocksNow(); } catch (err) { console.error('[organize] block render error:', err); }
            return;
        }
        _renderSilent(); // 【续期式静默罩】内部自动延迟摘除，不再返回 _unsilence
        try {
        var w = cvs.clientWidth, h = cvs.clientHeight;
        var dpr = Math.min(window.devicePixelRatio || 1, 1.5); // 【dpr 封顶】高 dpr 屏(2/3x)画布像素量翻4~9倍，首帧渲染成本剧增 → 封顶 1.5
        // 【取整比较】分数 dpr(1.25/1.5) 下 w*dpr 为小数，与画布整数值永不相等→每帧重设画布清空→CPU 100%
        var rw = Math.max(1, Math.round(w * dpr)), rh = Math.max(1, Math.round(h * dpr));
        if (cvs.width !== rw || cvs.height !== rh) {
            cvs.width = rw; cvs.height = rh;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        computeView();
        boxRects = [];

        // 继承主界面主题变量（与 chatbox 同一套色板，暗/亮主题自适应）
        var C = {
            card: 'rgba(0,0,0,0)',   // 【全透明 v4·用户令】卡片底色透明：直接透出对话背景，白字照读（原 --bg-card #1e1e2e 黑底已去）
            text2: themeVar('--text2', '#b8b8cc'),
            blue: themeVar('--blue', '#0984e3')
        };
        drawGrid(w, h);

        // 【连线修复】画线挪到卡片循环之后（boxRects 在卡片循环里才填充，之前画时是空数组→永远无线）


        // 组框
        groups.forEach(function(g) {
            var gb = groupBoxOf(g);
            if (!gb) return;
            var p = w2m(gb.x, gb.y);
            ctx.save();
            ctx.fillStyle = hexToRgba(g.color, 0.07);
            ctx.strokeStyle = hexToRgba(g.color, 0.85);
            ctx.lineWidth = 1.5;
            ctx.setLineDash([7, 5]);
            roundRect(p.x, p.y, gb.w * view.s, gb.h * view.s, 10);
            ctx.fill(); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            // 组名标签（胶囊 chip）【v3】：字号随摄像机缩放（钳制 9~20px），距组框更远
            var _chipFs = Math.max(9, Math.min(20, 11 * view.s));
            var _chipH = Math.round(_chipFs + 7);
            if (gb.w * view.s >= 48 && gb.h * view.s >= 24) {
            ctx.font = 'bold ' + _chipFs + 'px sans-serif';
            var tw = ctx.measureText(g.name).width;
            ctx.fillStyle = hexToRgba(g.color, 0.95);
            roundRect(p.x, p.y - _chipH - 6, tw + _chipH * 1.6, _chipH, _chipH / 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(g.name, p.x + _chipH * 0.8, p.y - 6 - _chipH / 2 + 0.5);
            }
        });

        // 卡片（继承主界面 chatbox UI：彩色渐变标题栏 + 图标 + 状态点 + 深色玻璃体 + 悬停/选中发光）
        boxes.forEach(function(b) {
            var p = w2m(b.x, b.y);
            // 卡片宽高 = 原始对话框宽高 × 缩放比例：滚轮缩小时始终与原始宽高保持一致（等比、不变形、持续跟随缩放）
            // 不再做 150/60 保底钳制——分别钳制宽/高会让缩小后卡片变形、到达下限后不再跟随滚轮缩放
            var bw = b.w * view.s;
            var bh = b.h * view.s;
            // 【放大卡顿修复】视口剔除：完全在屏幕外的卡片直接跳过（放大后大部分卡片在屏外，
            // 旧版每帧全量绘制阴影+渐变，绘制面积随缩放平方级膨胀 → CPU 100%）
            var off = (p.x > w + 80 || p.y > h + 80 || p.x + bw < -80 || p.y + bh < -80);
            boxRects.push({ x: b.x, y: b.y, w: b.w, h: b.h, b: b }); // 【设计意图留痕·勿删勿修】off/被剔除卡片也进 boxRects：queryVisible/closed/视口剔除的节点仍计连线端点——有意为之（连线不缺端点），非 bug 非残留；坐标是「幽灵坐标」（节点不画但有位置），S2c 双管线或连线高亮改造时须保留此语义
            if (off) return;
            // 【放大卡顿修复】超大卡片降级：单卡面积超 350 万像素²（≈全屏 3 张）时
            // 去掉阴影/渐变/正文，只画色块+边框，绘制成本与面积脱钩
            var huge = (bw * bh > 3500000);
            var isSel = selected.has(b.el);
            var isHov = (hoverBox === b);
            var col = b.color || C.blue;
            // 【状态配色 v2】标题栏渐变色改用状态色（与右下角导航一致）：错误红/发送橙/排队黄/已答绿/活动蓝/空闲淡蓝
            var _moSt2 = statusOfBox(b);
            var _moSc2 = MO_STATUS_COLORS[_moSt2] || MO_STATUS_COLORS.idle;
            var HH = 38;                        // 标题栏高【放大 v2·用户令】19→38 放大一倍：标题字号加倍后文字自然下移，避开左上角四球系统
            var oy = (isHov && !isSel) ? -2 : 0; // 悬停微抬
            var cy = p.y + oy;

            // 阴影（选中彩色辉光 / 悬停加深 / 常态投影；超大卡片跳过）
            // 【性能·去负债】shadowBlur 是 canvas 最贵操作之一（放大后卡片大、
            //   blur 半径平方级成本）。改为"预渲染离屏阴影贴图 + drawImage"：
            //   每种 (blur, 选中/常态) 组合只渲染一次 8px 小图，运行时 GPU 拉伸贴图。
            if (!huge) {
            ctx.save();
            if (isSel || isHov) {
                // 选中/悬停卡片数量极少，保留原生高质量辉光
                ctx.shadowColor = isSel ? hexToRgba(col, 0.65) : 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = isSel ? 16 : 13;
                ctx.shadowOffsetY = 3;
                ctx.fillStyle = C.card;
                roundRect(p.x, cy, bw, bh, 8); ctx.fill();
            } else {
                var _sd = getShadowSprite(C.card, 8);
                if (_sd) ctx.drawImage(_sd, p.x - 16, cy - 13, bw + 32, bh + 32);   // 【修复】按内芯 32×32/贴图 64 等比换算：四周出血 16px，含 shadowOffsetY=3（上 13 下 19 对称覆盖）
                else {
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 8;
                    ctx.shadowOffsetY = 3;
                    ctx.fillStyle = C.card;
                    roundRect(p.x, cy, bw, bh, 8); ctx.fill();
                }
            }
            ctx.restore();
            } else {
            ctx.fillStyle = C.card;
            roundRect(p.x, cy, bw, bh, 8); ctx.fill();
            }

            // 裁剪到卡片内绘制内容
            ctx.save();
            ctx.beginPath(); roundRect(p.x, cy, bw, bh, 8); ctx.clip();

            // 标题栏：状态/组颜色渐变（同 chatbox 头部设计语言）
            // 【性能·去负债】createLinearGradient 每帧每卡新建是 GC 压力大头；
            //   标题栏是水平渐变，与卡片高度无关 → 按 (bw, col) 缓存复用。
            //   玻璃渐变同理按 (bh) 缓存（颜色固定，仅纵向尺寸变化）。
            // 【渐变升级 v5】标题栏改三段渐变（亮→饱和→深），质感更接近原生 app 图标；
            //   新增标题栏顶部高光条（类 macOS 光泽），全部走 _gradCache 缓存，零额外每帧成本。
            var _gk = bw + '|' + _moSc2.fill;   // 【状态配色 v2】渐变按状态色缓存
            var hg = _gradCache['h' + _gk];
            if (!hg) {
                // 三段水平渐变：左亮 (fill) → 中饱和 (stroke 色系更浓) → 右深 (组色过渡)
                hg = ctx.createLinearGradient(0, 0, bw, 0);
                hg.addColorStop(0, _moSc2.fill);
                hg.addColorStop(0.55, _moSc2.stroke);
                hg.addColorStop(1, hexToRgba(col, 0.45));   // 渐变尾保留组色过渡，可辨识分组
                _gradCache['h' + _gk] = hg;
            }
            // 顶部高光条渐变：上白 20% → 透明（纵向，按 HH 缓存，HH 恒定 19 只建一次）
            var shg = _gradCache['shine'];
            if (!shg) {
                shg = ctx.createLinearGradient(0, 0, 0, 8);
                shg.addColorStop(0, 'rgba(255,255,255,0.22)');
                shg.addColorStop(1, 'rgba(255,255,255,0)');
                _gradCache['shine'] = shg;
            }
            // 渐变按相对坐标缓存，用 translate 对齐到卡片位置（平移/缩放不失效）
            ctx.save();
            ctx.translate(p.x, 0);
            // 【修复】正文先铺不透明底色，保证 100% 填充（玻璃渐变是半透明的，网格会透出）
            var bodyH = Math.max(0, bh - HH);
            ctx.fillStyle = C.card;
            ctx.fillRect(0, cy + HH, bw, bodyH);
            // 【去标题栏背景 v3·用户令】文字放大后背景色条移除：标题栏不再填充状态色渐变与顶部高光，只保留文字（正文底色照旧）
            // 【渐变升级 v5】标题栏顶部高光条（macOS 光泽感，仅标题栏上 8px）
            ctx.save();
            ctx.translate(0, cy);
            // 【去标题栏背景 v3】顶部高光条随标题栏背景一并移除（原 8px 白色高光会盖在标题文字背后）
            ctx.restore();
            // 玻璃质感：正文上亮下暗（仅当正文有高度时画，防 bh<HH 负高度反向绘制/负 key 缓存污染）
            if (bodyH > 0) {
                var gg = _gradCache['v' + bodyH];
                if (!gg) {
                    gg = ctx.createLinearGradient(0, 0, 0, bodyH);
                    // 【渐变升级 v5】玻璃质感增强：顶部高光略提、中段增透光带（60% 处微亮模拟反光）、底部暗角加深
                    gg.addColorStop(0, 'rgba(255,255,255,0.10)');
                    gg.addColorStop(0.08, 'rgba(255,255,255,0.03)');
                    gg.addColorStop(0.55, 'rgba(255,255,255,0)');
                    gg.addColorStop(0.85, 'rgba(0,0,0,0.10)');
                    gg.addColorStop(1, 'rgba(0,0,0,0.24)');
                    _gradCache['v' + bodyH] = gg;
                }
                // 缓存渐变定义在 y∈[0,bodyH]，此处临时 translate 对齐到正文起点，避免区间外钳制为端点色
                ctx.save();
                ctx.translate(p.x, cy + HH);
                ctx.fillStyle = gg;
                ctx.fillRect(0, 0, bw, bodyH);
                ctx.restore();
            }
            ctx.restore();

            // 标题栏内容：角色图标 + 角色名 + 状态点
            var tx = p.x + 7, ty = cy + HH / 2;
            // 缩小太多 → 文字隐藏（阈值按卡片实际显示宽高，太小时只保留色块卡片）
            // 【放大卡顿修复】超大卡片(huge)只画色块+边框，跳过渐变/图标/文字绘制
            var showHead = !huge && bw >= 64;
            var showBody = !huge && bw >= 96 && bh >= HH + 40;
            if (showHead) {
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            if (b.icon) {
                ctx.font = '13px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
                ctx.fillText(b.icon, tx, ty + 0.5);
                tx += 18;
            } else {
                // 【圆点还原 v1】按用户令恢复 4b035c3a 左上角头像圆点：主题色圆徽标（同历史版画法），标题从圆点右侧排起
                var _avTxt = String(b.avatar || 'AI').slice(0, 2);
                ctx.beginPath();
                ctx.arc(tx + 8, ty, 8.5, 0, Math.PI * 2);
                ctx.fillStyle = hexToRgba(col, 0.95);
                ctx.fill();
                var _pa = ctx.textAlign;
                ctx.textAlign = 'center';
                ctx.fillStyle = themeVar('--text', '#ffffff');
                ctx.font = 'bold 9px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                ctx.fillText(_avTxt, tx + 8, ty + 0.5);
                ctx.textAlign = _pa;
                ctx.font = '13px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
                tx += 20;
            }
            var ttlFull = String(b.title || b.avatar || '对话').replace(/\s+/g, ' ').trim() || '对话';
            // 标题走 UI 主题样式（字体 + 主题文字色，暗/亮主题自适应）
            ctx.font = 'bold 22px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'; // 【放大 v2·用户令】11→22 放大一倍
            var tMax = (p.x + bw - 22) - tx;
            var ttl = ttlFull;
            if (ctx.measureText(ttl).width > tMax) {
                var tc = ttl.length;
                while (tc > 1 && ctx.measureText(ttlFull.slice(0, tc) + '…').width > tMax) tc--;
                ttl = ttlFull.slice(0, tc) + '…';
            }
            ctx.fillStyle = themeVar('--text', '#ffffff');
            ctx.fillText(ttl, tx, ty + 0.5);
            // 【已回答绿标】AI 已回答过 → 标题右侧内联小绿点+「答」，一眼识别可送审对话（内联定位避免遮挡图标/头像）
            if (b.answered) {
                var _aw = ctx.measureText(ttl).width;
                ctx.beginPath();
                ctx.arc(tx + _aw + 6, ty, 6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(46,204,113,0.95)';
                ctx.fill();
                ctx.textAlign = 'center';
                ctx.font = 'bold 8px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                ctx.fillStyle = '#fff';
                ctx.fillText('答', tx + _aw + 6, ty + 0.5);
                ctx.textAlign = 'left';
            }
            // 右上状态点（呼应 chatbox 标题徽标）；有角色派发状态时 → 角色色点 + 轮次角标
            var _rs = b.chat && b.chat.roleStatus;
            if (_rs && _rs.role) {
                var _rc = ROLE_COLORS[_rs.role] || '#ffffff';
                var _done = _rs.state === '完毕';
                // 【图标重绘 v2】按用户要求：右侧小灯（状态点）与轮次数字全部移除，不画任何状态点
            } // 无角色状态时不画占位点（避免噪音）
            // 【新增·方块上方角色状态胶囊】呼应对话窗标题徽标：如「审核完毕」「策划中·第2轮」
            if (_rs && _rs.role && !huge) {
                var _short = ({ '策划师': '策划', '审核员': '审核', '总结师': '总结', '自定义': '角色' })[_rs.role] || _rs.role;
                var _pill = _short + (_rs.state === '完毕' ? '完毕' : '中') + ((_rs.round || 0) > 0 ? '·第' + _rs.round + '轮' : '');
                var _pf = 'bold 10px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                ctx.font = _pf;
                var _pw = ctx.measureText(_pill).width + 12, _ph = 14;
                var _px = p.x + bw / 2 - _pw / 2, _py = Math.max(p.y - _ph - 4, 2);
                ctx.save();
                ctx.beginPath();
                var _rr = _ph / 2;
                ctx.moveTo(_px + _rr, _py);
                ctx.arcTo(_px + _pw, _py, _px + _pw, _py + _ph, _rr);
                ctx.arcTo(_px + _pw, _py + _ph, _px, _py + _ph, _rr);
                ctx.arcTo(_px, _py + _ph, _px, _py, _rr);
                ctx.arcTo(_px, _py, _px + _pw, _py, _rr);
                ctx.closePath();
                ctx.fillStyle = hexToRgba(ROLE_COLORS[_rs.role] || '#ffffff', _rs.state === '完毕' ? 0.35 : 0.8);
                ctx.fill();
                if (_rs.state !== '完毕') { // 进行中：脉冲描边
                    ctx.strokeStyle = hexToRgba(ROLE_COLORS[_rs.role] || '#ffffff', 0.9);
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                ctx.fillStyle = themeVar('--text', '#ffffff');
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.font = _pf;
                ctx.fillText(_pill, p.x + bw / 2, _py + _ph / 2 + 0.5);
                ctx.restore();
                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            }
            } // if (showHead)

            // 【项目名居中·标题层】每个方块中央都画项目标题（前4字），任何缩放可见
            if (!huge && bw >= 40 && bh >= 40) {
                var pn = String(b.title || b.avatar || '').replace(/\s+/g, ' ').trim();
                if (pn === '节点') pn = String(b.avatar || '').trim().slice(0, 4) || '项目';
                if (pn) pn = pn.slice(0, 4);
                if (pn) {
                    var pcx = p.x + bw / 2, pcy = cy + bh / 2;
                    // 字号随方块大小自适应，钳制在 11~22
                    var pf = Math.max(11, Math.min(22, Math.min(bw / (pn.length * 0.9), bh * 0.3)));
                    ctx.save();
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.font = 'bold ' + pf + 'px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                    // 两层：深色描边保证亮背景可读 + 主题文字色
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = themeVar('--bg', 'rgba(0,0,0,0.55)');
                    ctx.globalAlpha = 0.85;
                    ctx.strokeText(pn, pcx, pcy + 0.5);
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = themeVar('--text', '#ffffff');
                    ctx.fillText(pn, pcx, pcy + 0.5);
                    ctx.restore();
                }
            }

            if (showBody) {
            // 正文：用户第一条提问（两行，超出省略，色板继承 --text2）
            var txtX = p.x + 10, txtY = cy + HH + 16, maxW = bw - 20;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.font = '11px sans-serif';
            ctx.fillStyle = C.text2;
            var full = String(b.firstUser || b.title || '').replace(/\s+/g, ' ').trim();
            var line1 = full, line2 = '';
            if (ctx.measureText(full).width > maxW) {
                var cut = full.length;
                while (cut > 1 && ctx.measureText(full.slice(0, cut) + '…').width > maxW) cut--;
                line1 = full.slice(0, cut);
                var rest = full.slice(cut);
                line2 = rest;
                if (ctx.measureText(rest).width > maxW) {
                    var cut2 = rest.length;
                    while (cut2 > 1 && ctx.measureText(rest.slice(0, cut2) + '…').width > maxW) cut2--;
                    line2 = rest.slice(0, cut2) + '…';
                }
            }
            ctx.fillText(line1 + (line2 ? '' : (full === line1 ? '' : '…')), txtX, txtY);
            if (line2) ctx.fillText(line2, txtX, txtY + 14);
            } // if (showBody)
            ctx.restore(); // 取消卡片裁剪

            // 边框：常态细边 / 悬停高亮 / 选中彩色粗边 + 外发光双圈
            // 【渐变升级 v5】常态/悬停边框改对角渐变描边（左上状态色→右下组色，缓存按 bw|bh|状态），质感统一
            if (!huge && !isSel) {
                var _bk = bw + '|' + bh + '|' + (isHov ? 'hov' : 'n') + '|' + _moSc2.fill;
                var _bg1 = _gradCache['bd' + _bk];
                if (!_bg1) {
                    _bg1 = ctx.createLinearGradient(p.x, cy, p.x + bw, cy + bh);
                    _bg1.addColorStop(0, isHov ? hexToRgba(_moSc2.stroke, 0.85) : hexToRgba(_moSc2.fill, 0.55));
                    _bg1.addColorStop(1, isHov ? hexToRgba(col, 0.8) : themeVar('--border', 'rgba(255,255,255,0.16)'));
                    _gradCache['bd' + _bk] = _bg1;
                }
                ctx.lineWidth = isHov ? 1.5 : 1;
                ctx.strokeStyle = _bg1;
            } else {
                ctx.lineWidth = isSel ? 2 : 1;
                ctx.strokeStyle = isSel ? hexToRgba(col, 0.95) : (isHov ? hexToRgba(col, 0.7) : themeVar('--border', 'rgba(255,255,255,0.16)'));
            }
            roundRect(p.x, cy, bw, bh, 8); ctx.stroke();
            if (isSel) {
                ctx.save();
                ctx.globalAlpha = 0.35;
                ctx.lineWidth = 1;
                roundRect(p.x - 3, cy - 3, bw + 6, bh + 6, 11); ctx.stroke();
                // 【渐变升级 v5】选中态第三圈微光描边（更亮的状态色，alpha 递减，形成三层光晕）
                ctx.globalAlpha = 0.15;
                roundRect(p.x - 6, cy - 6, bw + 12, bh + 12, 14); ctx.stroke();
                ctx.restore();
            }
        });

        // 【v3·新开发】策划师/审核员箭头连线 + 状态文字（在卡片循环之后，boxRects 已填满）
        drawPairArrows(w2m, view);

        // 框选拖拽框：实时可见 + 加选/减选视觉区分（默认=蓝 | Shift加选=绿+ | Ctrl减选=红−）
        if (_marquee && mode === 'marquee') {
            var mCol = marqueeOp === 'add' ? '#2ecc71' : (marqueeOp === 'sub' ? '#e74c3c' : themeVar('--blue', '#0984e3'));
            var mLabel = marqueeOp === 'add' ? '＋ 加选' : (marqueeOp === 'sub' ? '－ 减选' : '');
            ctx.save();
            ctx.fillStyle = hexToRgba(mCol, 0.12);
            ctx.strokeStyle = mCol;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.fillRect(_marquee.x, _marquee.y, _marquee.w, _marquee.h);
            ctx.strokeRect(_marquee.x, _marquee.y, _marquee.w, _marquee.h);
            ctx.setLineDash([]);
            // 角落标签：标明当前是加选还是减选
            if (mLabel) {
                ctx.font = 'bold 11px sans-serif';
                var lw = ctx.measureText(mLabel).width + 12;
                var lx = _marquee.x, ly = _marquee.y - 18;
                if (ly < 2) ly = _marquee.y + 4;
                if (lx + lw > w - 2) lx = w - 2 - lw;
                ctx.fillStyle = mCol;
                roundRect(lx, ly, lw, 16, 8); ctx.fill();
                ctx.fillStyle = '#fff'; // 红底配深灰对比度低，统一白字
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.fillText(mLabel, lx + 6, ly + 8);
            }
            ctx.restore();
        }
        } catch (err) { console.error('[organize] render error:', err); } // 【防御】单帧异常不中断后续渲染（静默罩由 _renderSilent 内部延迟自动摘除，无需手动 _unsilence）
    }
    function roundRect(x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    function hexToRgba(hex, a) {
        if (hex.indexOf('rgba') === 0) return hex;
        var m = hex.match(/^#([0-9a-f]{6})$/i);
        if (!m) return hex;
        var v = parseInt(m[1], 16);
        return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
    }

    // ===== 交互状态机 =====
    var mode = null; // 'drag' | 'marquee' | 'pending-drag'
    var startM = null, startRects = null, marqueeSelBase = null, marqueeOp = 'new';
    var dragOrigin = null;
    var _downBox = null;
    var DRAG_THRESHOLD = 4;

    function hitBox(mx, my) {
        // 【小方块模式】命中判定走 blRects（色块网格），boxRects 只在旧版渲染中填充
        var src = (!MO_LEGACY && blRects.length) ? blRects : boxRects;
        for (var i = src.length - 1; i >= 0; i--) {
            var r = src[i];
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.b;
        }
        // 【框选/点选失效修复】blRects 只含视口内方块（渲染时 off 的不进缓存），
        // 保险丝停机后画面停更时缓存还会过期 → 命中判定漏块，表现为"点不到/框不中"。
        // 兜底：直接遍历 boxes 用 w2m 实时投影判定，与渲染完全同源，永不漏。
        if (!MO_LEGACY && boxes.length) {
            computeView();
            for (var j = boxes.length - 1; j >= 0; j--) {
                var bb = boxes[j];
                var p = w2m(bb.x, bb.y);
                var rw = Math.max(3, bb.w * view.s), rh = Math.max(3, bb.h * view.s);
                if (mx >= p.x && mx <= p.x + rw && my >= p.y && my <= p.y + rh) return bb;
            }
        }
        return null;
    }

    // 中键平移的起始状态
    var _panStart = null;

    // ========== 【移动端触屏适配 v1】单指=点选/拖卡片（空白即平移+双击空白框选由平移替代）、双指=捏合缩放/平移 ==========
    var _isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var _pinch = null; // {d0, s0, cx0, cy0, ox0, oy0}
    function _touchDist(t) {
        var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
        return Math.hypot(dx, dy);
    }
    function _installTouch() {
        if (!_isTouchDevice) return;
        // 触屏上把画布 touch 事件映射到鼠标交互体系：
        // 单指在卡片上 → 模拟左键（点选/拖动）；单指在空白 → 平移视图（手机上没有中键，这是唯一平移手段）
        cvs.addEventListener('touchstart', function(e) {
            if (!active) return;
            e.preventDefault();
            var ts = e.touches;
            if (ts.length >= 2) {
                // 双指捏合缩放 + 中心平移（以初始视图为准）
                var uv = ensureUserView();
                var r = cvs.getBoundingClientRect();
                _pinch = {
                    d0: _touchDist(ts), s0: uv.s,
                    cx0: (ts[0].clientX + ts[1].clientX) / 2 - r.left,
                    cy0: (ts[0].clientY + ts[1].clientY) / 2 - r.top,
                    ox0: uv.ox, oy0: uv.oy
                };
                mode = null; _marquee = null; _lastDragPos = null;
                return;
            }
            var t = ts[0];
            var rect = cvs.getBoundingClientRect();
            var mx = t.clientX - rect.left, my = t.clientY - rect.top;
            var b = hitBox(mx, my);
            if (b) {
                // 点卡片：单选（触屏无修饰键；长按/菜单由右键模拟逻辑处理，这里保持单选）
                if (!selected.has(b.el)) { selected.clear(); selected.add(b.el); }
                mode = 'pending-drag';
                startM = { x: mx, y: my };
                _downBox = b;
                dragOrigin = [];
                selected.forEach(function(el) {
                    var ob = boxes.find(function(bb) { return bb.el === el; });
                    if (ob) dragOrigin.push({ el: el, x: ob.x, y: ob.y });
                });
            } else {
                // 空白：单指平移
                mode = 'pan';
                startM = { x: mx, y: my };
                var uv2 = ensureUserView();
                _panStart = { ox: uv2.ox, oy: uv2.oy };
            }
            render();
        }, { passive: false });
        cvs.addEventListener('touchmove', function(e) {
            if (!active) return;
            e.preventDefault();
            var ts = e.touches;
            if (ts.length >= 2 && _pinch) {
                var uv = ensureUserView();
                var k = _touchDist(ts) / Math.max(1, _pinch.d0);
                var ns = Math.min(3, Math.max(0.05, _pinch.s0 * k));
                var r = cvs.getBoundingClientRect();
                var cx = (ts[0].clientX + ts[1].clientX) / 2 - r.left;
                var cy = (ts[0].clientY + ts[1].clientY) / 2 - r.top;
                // 缩放中心的世界坐标保持不动，中心移动量转为平移
                var wx = (_pinch.cx0 - _pinch.ox0) / _pinch.s0 + uv.minX;
                var wy = (_pinch.cy0 - _pinch.oy0) / _pinch.s0 + uv.minY;
                uv.s = ns;
                uv.ox = cx - (wx - uv.minX) * ns;
                uv.oy = cy - (wy - uv.minY) * ns;
                render();
                return;
            }
            if (ts.length !== 1) return;
            var rect = cvs.getBoundingClientRect();
            var mx = ts[0].clientX - rect.left, my = ts[0].clientY - rect.top;
            var dx = mx - startM.x, dy = my - startM.y;
            if (mode === 'pan') {
                var uv2 = ensureUserView();
                uv2.ox = _panStart.ox + dx;
                uv2.oy = _panStart.oy + dy;
                render();
            } else if (mode === 'pending-drag' || mode === 'drag') {
                if (mode === 'pending-drag' && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                mode = 'drag';
                _lastDragPos = { x: dx, y: dy };
                if (!_dragFrame) _dragFrame = requestAnimationFrame(_applyDragFrame);
            }
        }, { passive: false });
        function _endTouch(e) {
            if (!active) return;
            if (e.touches && e.touches.length > 0) { // 双指抬剩一根时结束捏合
                _pinch = null;
                mode = null;
                return;
            }
            _pinch = null;
            if (mode) {
                if (_dragFrame) { cancelAnimationFrame(_dragFrame); _dragFrame = null; }
                _applyDragFrame();
                _lastDragPos = null;
                _commitDragToReal();
                mode = null; startM = null; _marquee = null; _downBox = null; _panStart = null;
                updateToolbar();
                _fuseLockUntil = 0; _fuseCount = 0; _fuseTrips = 0; _fuseTs = Date.now();
                _renderPending = false;
                requestAnimationFrame(_renderNow);
            }
        }
        cvs.addEventListener('touchend', _endTouch);
        cvs.addEventListener('touchcancel', _endTouch);
    }

    function onDown(e) {
        if (e.button === 1) {
            // 鼠标中键按下 → 平移视图（同时阻止浏览器中键自动滚动）
            e.preventDefault();
            var prect = cvs.getBoundingClientRect();
            mode = 'pan';
            setCursorForState('grabbing');
            startM = { x: e.clientX - prect.left, y: e.clientY - prect.top };
            ensureUserView();
            _panStart = { ox: userView.ox, oy: userView.oy };
            return;
        }
        if (e.button !== 0) return;
        var rect = cvs.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        // 【P2 折叠/眼睛 v1】组标题条命中优先于方块/框选：折叠条点击=展开；隐藏条点击=恢复显示
        try {
            var _bars = window._moGroupBars || [];
            for (var _bi = _bars.length - 1; _bi >= 0; _bi--) {
                var _bar = _bars[_bi];
                if (mx >= _bar.x && mx <= _bar.x + _bar.w && my >= _bar.y && my <= _bar.y + _bar.h) {
                    if (_bar.kind === 'full') {
                        // 【组拖拽 v2】按住组框空白拖动 → 整组成员跟随（含组外框内成员），不改变折叠/显隐状态
                        var _gid = _bar.g.id;
                        var _grp = _bar.g;
                        var _memEls = [];
                        var _memBox = [];
                        boxes.forEach(function(mb) {
                            var mid = mb.el.dataset.moId;
                            if (_grp.nodeIds.indexOf(mid) >= 0) { _memEls.push(mb.el); _memBox.push(mb); }
                        });
                        if (_memBox.length) {
                            mode = 'group-drag';
                            setCursorForState('grabbing');
                            try { if (cvs.setPointerCapture && e.pointerId !== undefined) cvs.setPointerCapture(e.pointerId); } catch (errG) {}
                            startM = { x: mx, y: my };
                            _downBox = null;
                            dragOrigin = _memBox.map(function(mb) { return { el: mb.el, x: mb.x, y: mb.y }; });
                            ensureUserView();
                            // 同步选中成员（视觉一致，松手不改）
                            selected.clear(); _memEls.forEach(function(me) { selected.add(me); });
                        }
                        return;
                    }
                    if (_bar.g.hidden) { _bar.g.hidden = false; }
                    else if (_bar.g.collapsed) { _bar.g.collapsed = false; }
                    saveGroups(); render();
                    return;
                }
            }
        } catch (eBar) {}
        var b = hitBox(mx, my);
        if (b) {
            // 点选（键位 v2：Ctrl=加选 | Alt=减选 | Shift=加选别名 | 无=单选）
            if (e.ctrlKey || e.shiftKey) { selected.add(b.el); }
            else if (e.altKey) { selected.delete(b.el); }
            else if (!selected.has(b.el)) { selected.clear(); selected.add(b.el); }
            // 先进入 pending-drag，移动超过阈值才算拖拽（避免误拖）
            mode = 'pending-drag';
            setCursorForState('grab');
            // 【拖拽掉块修复】指针捕获：拖出面板/快速甩动时 mouseup 也能收到，不会"掉块"
            try { if (cvs.setPointerCapture && e.pointerId !== undefined) cvs.setPointerCapture(e.pointerId); } catch (err) {}
            try { cvs.releasePointerCapture && cvs.addEventListener('lostpointercapture', function() {}, { once: true }); } catch (err) {}
            startM = { x: mx, y: my };
            _downBox = b;
            dragOrigin = [];
            selected.forEach(function(el) {
                var ob = boxes.find(function(bb) { return bb.el === el; });
                if (ob) dragOrigin.push({ el: el, x: ob.x, y: ob.y });
            });
            // 【父子跟随 v10】拖父带子：收集被拖卡片的未选中后代，拖拽帧同量平移
            _collectFollow();
            // 【分组仅标注 v9】应户决定：自动分组只作视觉归类，拖动组内成员不再自动带动整组
        } else {
            // 空白 → 框选
            mode = 'marquee';
            setCursorForState('crosshair');
            startM = { x: mx, y: my };
            var _md = modsHeld(e);
            // 键位 v2：Ctrl=加选 | Alt=减选 | Shift=加选别名 | 无=全新选择
            marqueeOp = (_md.ctrl || _md.shift) ? 'add' : (_md.alt ? 'sub' : 'new');
            // 【加减选修复】框选也走指针捕获：快速甩出画布时 move/up 不丢，框选不会"卡住失效"
            try { if (cvs.setPointerCapture && e.pointerId !== undefined) cvs.setPointerCapture(e.pointerId); } catch (err) {}
            // 【选择清除修复】默认框选（不带修饰键）= 全新选择：基集合必须清空，
            // 否则 move 分支 selected = new Set(marqueeSelBase) 会把旧选择还原回来，
            // 表现为"空白处点击或拖拽后，之前的选择不消失"
            if (marqueeOp === 'new') { marqueeSelBase = new Set(); selected.clear(); }
            else marqueeSelBase = new Set(selected);
            // 【框选可见性兜底】框选/单击空白属于真实交互，重置保险丝保证重绘帧不被吞
            _fuseLockUntil = 0; _fuseCount = 0; _fuseTrips = 0; _fuseTs = Date.now();
        }
        render();
    }

    // 【架构改造·按用户方案】拖拽期间只更新面板画布数据（boxes），完全不碰真实 DOM；
    // 松手确认后才把最终位置一次性写入真实对话框 style，再刷新小地图。
    // 旧版每帧写 style → 触发全页 MutationObserver 风暴 → CPU 100% 死机。
    var _dragFrame = null, _lastDragPos = null;
    // 【父子跟随 v10】拖父带子：从 dragOrigin（根）出发，把未选中的后代卡片也纳入 dragOrigin
    // 记录其初始位置；拖拽帧统一按 (dx,dy) 平移，落地时后代按自身 origin 落位，不会双倍
    function _collectFollow() {
        if (!window.ZFGroupFollow || typeof ZFGroupFollow.collectSubtree !== 'function') return;
        var inDrag = {};
        dragOrigin.forEach(function(d) { inDrag[d.el.id || d.el.dataset.moId] = true; });
        var roots = dragOrigin.map(function(d) { return d.el; });
        // 逐根收集子树（collectSubtree 返回 chat 对象数组，不含根）
        roots.forEach(function(rootEl) {
            var rootChat = (window.App && App.chatBoxes || []).find(function(c) { return c && c.el === rootEl; });
            if (!rootChat || !rootChat.id) return;
            var subs = [];
            try { subs = ZFGroupFollow.collectSubtree(rootChat.id) || []; } catch (e) {}
            subs.forEach(function(c) {
                if (!c || !c.el) return;
                var key = c.el.id || c.el.dataset.moId;
                if (inDrag[key]) return; // 已在拖拽集合（被显式选中）则跳过，防双倍
                var ob = boxes.find(function(bb) { return bb.el === c.el; });
                if (!ob) return;
                inDrag[key] = true;
                dragOrigin.push({ el: c.el, x: ob.x, y: ob.y, _follow: true });
            });
        });
    }
    function _applyDragFrame() {
        _dragFrame = null;
        if ((mode !== 'drag' && mode !== 'group-drag') || !_lastDragPos) return;
        if (!MO_LEGACY) {
            // 【位置映射 v2】拖拽=按面板位移换算真实坐标增量，只更新面板数据 boxes.x/y；
            // 真实 DOM 完全不动，等关闭面板时 commitPendingToReal() 一次性写回
            var wdx2 = _lastDragPos.x / view.s, wdy2 = _lastDragPos.y / view.s;
            // 【fps v11】boxes 线性 find 是 O(n×m)（父子跟随后 m 可达数千），改 Map 索引一次建、整帧用
            if (!_dragBoxIdx || _dragBoxIdxDirty) {
                _dragBoxIdx = new Map();
                boxes.forEach(function(bb) { _dragBoxIdx.set(bb.el, bb); });
                _dragBoxIdxDirty = false;
            }
            dragOrigin.forEach(function(d) {
                var ob = _dragBoxIdx.get(d.el);
                if (ob) { ob.x = d.x + wdx2; ob.y = d.y + wdy2; ob._moved = true; }
            });
            _lastDragPos = null;
            /* 【箭头实时跟随修复】拖拽帧直接同步重绘（绕过 render 的 rAF 排队）：
               旧路径 boxes 坐标第 N 帧更新、绘制排到 N+1 帧 → 连线箭头恒定落后
               一帧，表现为拖拽时箭头跟随卡顿。拖拽属真实交互帧，保险丝已豁免，
               直接调 _renderNow() 让方块与箭头同帧重绘，完全实时。 */
            _renderNow();
            return;
        }
        var wdx = _lastDragPos.x / view.s, wdy = _lastDragPos.y / view.s;
        if (!_dragBoxIdx || _dragBoxIdxDirty) {
            _dragBoxIdx = new Map();
            boxes.forEach(function(bb) { _dragBoxIdx.set(bb.el, bb); });
            _dragBoxIdxDirty = false;
        }
        dragOrigin.forEach(function(d) {
            var nx = Math.round(d.x + wdx), ny = Math.round(d.y + wdy);
            var ob = _dragBoxIdx.get(d.el);
            if (ob) { ob.x = nx; ob.y = ny; ob._pendingCommit = { dx: nx - d.x, dy: ny - d.y }; }
        });
        _lastDragPos = null;
        _renderNow(); // 【箭头实时跟随修复】同上：拖拽帧同步重绘，消除一帧滞后
    }
    // 【修复】打开面板时：把真实对话框当前位置同步进面板数据（boxes.x/y），
    // 保证面板色块反映真实布局，但不写回真实 DOM —— 用户没拖动就不改画布
    function syncRealToGrid() {
        boxes.forEach(function(b) {
            var x = parseFloat(b.el.style.left) || b.el.offsetLeft || 0;
            var y = parseFloat(b.el.style.top) || b.el.offsetTop || 0;
            b.x = x; b.y = y;
            b._pendingCommit = null;
            b._moved = false; // 同步重置，防止面板打开期间外部移动导致旧增量误写
        });
    }
    // 松手后一次性落地：把面板内最终位置写入真实对话框，只写一次，无风暴
    function _commitDragToReal() {
        if (!MO_LEGACY) return; // 【位置映射 v2】小方块模式：松手不写真实 DOM，关闭面板时 commitPendingToReal() 一次性写回
        // 【legacy 回退路径】把 _pendingCommit 标记过的卡片最终坐标写入真实 DOM
        var _any = false;
        boxes.forEach(function(ob) {
            if (!ob._pendingCommit) return;
            ob._pendingCommit = null;
            _any = true;
            ob.el.style.left = Math.round(ob.x) + 'px';
            ob.el.style.top = Math.round(ob.y) + 'px';
        });
        if (_any) {
            try { if (window.App && App.updateMinimap) setTimeout(function() { App.updateMinimap(); }, 30); } catch (e) {}
        }
    }
    // 【延迟写回】关闭面板时，把面板内最终位置一次性写入真实对话框（带父子跟随）
    // 【双倍移动修复 v5】父子同选拖动时必须祖先先落地：父 commit 时 panelMoved 已把
    //   整棵子树平移到目标位；后代再轮到自己时，oldX/oldY 从（已被父更新的）真实 el
    //   重新读取，残差为 0 自动跳过 → 不会叠加第二次 ddx。若后代确实被单独拖过，
    //   残差即其自身额外位移，也会被正确补上。
    function commitPendingToReal() {
        var _moved = false;
        // 剩余待提交集合（祖先优先循环选取）
        var _remain = boxes.filter(function(ob) { return ob._moved; });
        function _cidOf(ob) { return ob.chatId || ob.el.id; }
        function _inSubtree(cid, rootId) {
            if (!cid || !rootId) return false; // 【防护】id 缺失时不做子树判断，避免误判为祖先提前落地
            try {
                var sub = ZFGroupFollow.collectSubtree(rootId) || [];
                for (var i = 0; i < sub.length; i++) {
                    if ((sub[i].id || sub[i]) === cid) return true;
                }
            } catch (e) {}
            // 【双倍移动修复 v6】兜底：多角色箭头成员关系也计入子树，与拖拽阶段
            // _kidEls 的收集口径（collectSubtree + ZFMultiArrow.pairs）保持一致。
            // 否则"子先于父落地"时：子先按自身 dx 落位，父 commit 的 panelMoved
            // 又对同一成员按 dx 再平移一次 → 子级别双倍移动；嵌套链逐层叠加。
            try {
                if (window.ZFMultiArrow && ZFMultiArrow.pairs) {
                    var _stack = [rootId], _seen = {};
                    while (_stack.length) {
                        var _pid = _stack.pop();
                        if (_seen[_pid]) continue;
                        _seen[_pid] = 1;
                        var _pairs = ZFMultiArrow.pairs;
                        for (var pi = 0; pi < _pairs.length; pi++) {
                            var p = _pairs[pi];
                            if (p && p.srcId === _pid && Array.isArray(p.memberIds)) {
                                for (var k = 0; k < p.memberIds.length; k++) {
                                    if (p.memberIds[k] === cid) return true;
                                    _stack.push(p.memberIds[k]);
                                }
                            }
                        }
                    }
                }
            } catch (e) {}
            return false;
        }
        while (_remain.length) {
            var _pick = null;
            for (var i = 0; i < _remain.length; i++) {
                var cid = _cidOf(_remain[i]), isRoot = true;
                for (var j = 0; j < _remain.length; j++) {
                    if (i === j) continue;
                    if (_inSubtree(cid, _cidOf(_remain[j]))) { isRoot = false; break; }
                }
                if (isRoot) { _pick = _remain[i]; break; }
            }
            if (!_pick) _pick = _remain[0]; // 兜底：环/异构关系按序处理
            _remain.splice(_remain.indexOf(_pick), 1);
            var ob = _pick;
            var oldX = parseFloat(ob.el.style.left), oldY = parseFloat(ob.el.style.top);
            if (isNaN(oldX)) oldX = ob.el.offsetLeft;
            if (isNaN(oldY)) oldY = ob.el.offsetTop;
            var ddx = ob.x - oldX, ddy = ob.y - oldY;
            if (!ddx && !ddy) { ob._moved = false; continue; }
            ob._moved = false;
            _moved = true;
            ob.el.style.left = Math.round(ob.x) + 'px';
            ob.el.style.top = Math.round(ob.y) + 'px';
            /* 【双倍跳转修复 v7】同步内存态 chat.x/y：只写 el.style 不改 chat.x/y，
               后续任何按 chat.x/y 刷新/落库的模块会把窗口按旧坐标重写一次 →
               平移画布时父子双倍跳的第三来源（v8 起整理面板已禁用 panelMoved 子树平移） */
            try {
                var _acb = (window.App && App.chatBoxes || []);
                for (var _ai = 0; _ai < _acb.length; _ai++) {
                    if (_acb[_ai] && _acb[_ai].id === _cidOf(ob)) {
                        _acb[_ai].x = Math.round(ob.x);
                        _acb[_ai].y = Math.round(ob.y);
                        /* 【落盘修复】同步改内存后必须立即持久化，否则刷新页面位置回跳
                           （此前只写 el.style + 内存 chat.x/y，localStorage 仍是旧坐标） */
                        try { if (window.Store && typeof Store.saveChatBox === 'function') Store.saveChatBox(_acb[_ai]); } catch (eS) {}
                        break;
                    }
                }
            } catch (e) {}
            /* 【父子不跟随 v8】整理面板内禁用落地子树平移：即使父子被同时框选，
               也只按各自面板位移落地，不再触发 panelMoved（否则父的 panelMoved
               与子的自身位移叠加 → 子双倍跳转）。主画布直接拖拽的父子跟随不受影响。 */
        }
        if (_moved && window.App && App.updateMinimap) setTimeout(function() { App.updateMinimap(); }, 30);
    }
    function onMove(e) {
        if (!active) return;
        var rect = cvs.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (!mode) {
            // 悬停反馈：指向卡片=抓手(grab)+高亮，空白=默认
            var hb = hitBox(mx, my);
            setCursorForState(hb ? 'grab' : 'default');
            if (hb !== hoverBox) { hoverBox = hb; if (hb) { _moScaleMap.set(hb, _moScaleOf(hb)); } startMoAnim(); render(); }
            return;
        }
        var dx = mx - startM.x, dy = my - startM.y;

        // 中键平移：视口跟随鼠标移动
        if (mode === 'pan') {
            setCursorForState('grabbing');
            // 【位置映射 v2】统一走 userView 平移（小方块模式与旧版共用 fit 视图体系）
            var puv = ensureUserView();
            puv.ox = _panStart.ox + dx;
            puv.oy = _panStart.oy + dy;
            render();
            return;
        }

        // pending-drag：超过阈值才真正开始拖拽
        if (mode === 'pending-drag') {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            mode = 'drag';
            setCursorForState('grabbing');
            ensureUserView(); // 拖拽期间冻结视图，不再自动 fit（否则方块拖不动）
        }

        // 【组拖拽 v2】组框拖动复用卡片拖拽帧路径
        if (mode === 'group-drag') {
            setCursorForState('grabbing');
            _lastDragPos = { x: dx, y: dy };
            if (!_dragFrame) _dragFrame = requestAnimationFrame(_applyDragFrame);
            return;
        }
        if (mode === 'drag') {
            setCursorForState('grabbing');
            // 【死循环修复】不再每条 mousemove 同步写真实节点 style（会触发页面上的多个
            // MutationObserver[pipeline/medianode/modal-lock] 反复回流，形成反馈风暴死循环）。
            // 改为：记录最新鼠标位置，rAF 每帧只写一次样式。
            _lastDragPos = { x: dx, y: dy };
            if (!_dragFrame) {
                _dragFrame = requestAnimationFrame(_applyDragFrame);
            }
        } else if (mode === 'marquee') {
            setCursorForState('crosshair');
            // 【键位 v2】修饰键优先级：Ctrl/Shift(加) > Alt(减)。中途切换为累加式：
            // 切换时以当前已选为新基础，松键不清空中途框住的项。
            // 修饰键用权威键状态（modsHeld），不再只依赖事件标志
            var _mv = modsHeld(e);
            var newOp = (_mv.ctrl || _mv.shift) ? 'add' : (_mv.alt ? 'sub' : 'new');
            if (newOp !== marqueeOp) {
                marqueeOp = newOp;
                marqueeSelBase = new Set(selected); // 以当前已选为基础切换
            }
            _marquee = { x: Math.min(startM.x, mx), y: Math.min(startM.y, my), w: Math.abs(dx), h: Math.abs(dy) };
            // 实时选区（原地更新同一 Set，避免外部持有的旧引用读到陈旧选择）
            selected.clear();
            marqueeSelBase.forEach(function(el) { selected.add(el); });
            if (!MO_LEGACY) {
                // 【框选失效修复】不再依赖 blRects 缓存（停帧后过期、视口外方块缺失），
                // 改为实时 w2m 投影判定，与渲染/hitBox 完全同源
                computeView();
                boxes.forEach(function(b) {
                    var p = w2m(b.x, b.y);
                    var rw = Math.max(3, b.w * view.s), rh = Math.max(3, b.h * view.s);
                    var bx0 = _marquee.x, bx1 = _marquee.x + _marquee.w, by0 = _marquee.y, by1 = _marquee.y + _marquee.h;
                    var inR = p.x < bx1 && p.x + rw > bx0 && p.y < by1 && p.y + rh > by0;
                    if (marqueeOp === 'sub') { if (inR) selected.delete(b.el); }
                    else if (inR) selected.add(b.el);
                });
            } else {
                var w0 = m2w(_marquee.x, _marquee.y), w1 = m2w(_marquee.x + _marquee.w, _marquee.y + _marquee.h);
                boxes.forEach(function(b) {
                    var inR = b.x < w1.x && b.x + b.w > w0.x && b.y < w1.y && b.y + b.h > w0.y;
                    if (marqueeOp === 'add') { if (inR) selected.add(b.el); }
                    else if (marqueeOp === 'sub') { if (inR) selected.delete(b.el); }
                    else { if (inR) selected.add(b.el); }
                });
            }
            render();
        }
    }
    var _marquee = null;
    var hoverBox = null;           // 悬停中的卡片（render 高亮用）

    function onUp(e) {
        if (!active) return;
        // 【空白单击取消选择修复】空白按下→没怎么移动就松手 = 单击空白：
        //   默认框选（new）已在 down 时清空选择，但若保险丝此前熔断，清空后的
        //   重绘帧可能被吞，画面停留旧帧，看起来"没取消"。此处兜底强制重置
        //   保险丝并补绘（在下方松手补绘统一处理，这里只保证选择集合正确）。
        if (mode === 'marquee' && marqueeOp === 'new' && startM && e && typeof e.clientX === 'number') {
            var _ur = cvs.getBoundingClientRect();
            var _ux = e.clientX - _ur.left, _uy = e.clientY - _ur.top;
            // 【框选建组 v3】松手覆盖 ≥2 个节点且移动超阈值 → 自动弹命名建组（用户要求：框选即画组框把节点框进来）
            if (_marquee && (_marquee.w > 18 || _marquee.h > 18) && selected.size >= 2) {
                createGroupFromSelection(); /* 建组修复 v4：内部自带命名弹窗（预填组名回车确认），不再二次弹框防重复建组 */
            } else
            if (Math.abs(_ux - startM.x) < DRAG_THRESHOLD && Math.abs(_uy - startM.y) < DRAG_THRESHOLD) {
                selected.clear(); // 单击空白 = 取消全部选择
            }
            // 【空白框选落空取消选择】框选结束若没框到任何对话框 → 取消全部选择
            if (_marquee && selected.size > 0) {
                computeView();
                var _hitAny = false;
                var _bx1 = _marquee.x + _marquee.w, _by1 = _marquee.y + _marquee.h;
                boxes.forEach(function(b) {
                    if (_hitAny) return;
                    var p = w2m(b.x, b.y);
                    var rw = Math.max(3, b.w * view.s), rh = Math.max(3, b.h * view.s);
                    if (p.x < _bx1 && p.x + rw > _marquee.x && p.y < _by1 && p.y + rh > _marquee.y) _hitAny = true;
                });
                if (!_hitAny) selected.clear();
            }
        }
        if (mode) {
            // 【拖拽掉块修复】释放指针捕获
            try { if (cvs.releasePointerCapture && e.pointerId !== undefined) cvs.releasePointerCapture(e.pointerId); } catch (err) {}
            mode = null; startM = null; _marquee = null; _downBox = null; _panStart = null;
            // 【死循环修复】松手时若还有排队的拖拽帧，取消面板重绘（面板内位置已由最终帧数据保留），
            // 然后一次性把最终位置写入真实对话框 —— 拖拽全程真实 DOM 不动，确认后才动一次
            if (_dragFrame) { cancelAnimationFrame(_dragFrame); _dragFrame = null; }
            // 松手时把排队的最后一帧同步执行完，保证面板数据已是最终位置再落地
            _applyDragFrame();
            _lastDragPos = null;
            _commitDragToReal();
            updateToolbar();
        }
        // 松手后按当前位置恢复光标：卡片上=grab，空白=default
        if (e && typeof e.clientX === 'number') {
            var rect = cvs.getBoundingClientRect();
            var mx = e.clientX - rect.left, my = e.clientY - rect.top;
            hoverBox = hitBox(mx, my); setCursorForState(hoverBox ? 'grab' : 'default');
        } else {
            setCursorForState('default');
        }
        // 【bug修复：框选松手后框不消失】快速框选时保险丝可能已熔断（>28帧/秒冷却1.5s），
        // 松手这帧"清除选框"的重绘会被静默丢弃，画面停留旧帧。强制重置保险丝并补绘一帧。
        _fuseLockUntil = 0; _fuseCount = 0; _fuseTrips = 0; _fuseTs = Date.now();
        _renderPending = false;
        requestAnimationFrame(_renderNow);
    }

    // ===== 滚轮：默认以鼠标为中心缩放；Shift+滚轮平移 =====
    function onWheel(e) {
        if (!active) return;
        e.preventDefault();
        // 【滚轮缩放豁免】标记未来 250ms 内的渲染帧为滚轮交互帧：
        //   保险丝冷却期/停机保护不再丢弃它们（否则连续滚动或其他渲染源占满帧预算时，
        //   缩放帧被静默吞掉，画面停旧帧，表现为"滚轮缩放没反应"）
        _wheelUntil = Date.now() + 250;
        var rect = cvs.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (!MO_LEGACY) {
            // 【小方块模式·滚轮缩放 v1】可见视图是 blView（方块尺寸+原点），不是 userView。
            // 以鼠标为中心缩放：缩放前后鼠标下的网格坐标保持不动。
            var d0 = (e.deltaY !== 0 ? e.deltaY : e.deltaX);
            var k0 = Math.pow(1.0018, -d0);
            var ns0 = Math.min(90, Math.max(6, blView.s * k0)); // 方块尺寸 6~90px
            var fx = ns0 / blView.s;
            blView.ox = mx - (mx - blView.ox) * fx;
            blView.oy = my - (my - blView.oy) * fx;
            blView.s = ns0;
            blApply();
            render();
            return;
        }
        var uv = ensureUserView();
        if (e.shiftKey && !e.ctrlKey) {
            // 平移
            uv.ox -= (e.deltaX || 0);
            uv.oy -= e.deltaY;
        } else {
            // 以鼠标为中心缩放：缩放前后鼠标下的世界坐标保持不动
            var d = (e.deltaY !== 0 ? e.deltaY : e.deltaX);
            var k = Math.pow(1.0018, -d);
            // 【缩放约束 v2】上限 3；下限=min(0.25, fit 比例的一半)，超大布局 fit 本身很小时不被弹大
            var fitS = 0.25;
            try {
                var bb0 = worldBounds();
                fitS = Math.min(cvs.clientWidth / Math.max(1, bb0.w), cvs.clientHeight / Math.max(1, bb0.h));
            } catch (e2) { console.warn('[整理面板] worldBounds 异常，fitS 回退 0.25', e2); }
            var sMin = Math.min(0.25, fitS * 0.5);
            var ns = Math.min(3, Math.max(sMin, uv.s * k));
            var wx = (mx - uv.ox) / uv.s + uv.minX;
            var wy = (my - uv.oy) / uv.s + uv.minY;
            uv.s = ns;
            uv.ox = mx - (wx - uv.minX) * ns;
            uv.oy = my - (wy - uv.minY) * ns;
        }
        render();
    }

    function onKey(e) {
        if (!active) return;
        // 【新建对话框可输入修复】焦点在对话输入框/命名框等文本控件时，面板全局按键全部让路：
        // （否则 Backspace/Delete 会被当成"关闭选中对话框"，打字删字直接把对话关掉）
        var _ae = document.activeElement;
        if (_ae && (_ae.tagName === 'TEXTAREA' || _ae.tagName === 'INPUT' || _ae.isContentEditable)) return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            // 焦点在命名输入框时不处理
            if (document.activeElement === nameInput) return;
            e.preventDefault();
            // Delete = 关闭选中的对话框（非对话框节点忽略）
            var closed = 0;
            boxes.forEach(function(b) {
                if (!selected.has(b.el)) return;
                if (b.chat) { try { App.closeChatBox(b.chat); closed++; } catch (err) {} }
            });
            if (closed > 0) {
                // 【刷新修复】closeChatBox 是 220ms 动画后才移除 DOM，立即 collectBoxes
                // 会把"关闭中"的元素再次收集回来 → 框不消失。此处直接从 boxes 剔除。
                var _closedIds = {};
                boxes.forEach(function(b) {
                    if (selected.has(b.el) && b.chat) _closedIds[b.chat.id] = true;
                });
                boxes = boxes.filter(function(b) {
                    return !(_closedIds[(b.chat && b.chat.id) || ''] ||
                             (b.el && b.el._zfClosing) ||
                             (b.chat && b.chat._closed));
                });
                selected.clear();
                updateToolbar();
                render();
            }
        } else if (e.key === 'Tab') {
            // 【Tab 创建 v2·S3a】Tab 键 = 与普通画布双击空白处一致，弹出「创建对话框」双栏面板（屏幕居中）
            if (document.activeElement === nameInput) return; // 命名输入中不抢焦点
            e.preventDefault();
            if (_openCreateDialog(window.innerWidth / 2, window.innerHeight / 2)) close();
        } else if (e.key === 'Escape') {
            if (namePop.classList.contains('active')) hideNamePop(); else close();
        } else if (e.key === 'Enter' && namePop.classList.contains('active')) {
            confirmName();
        }
    }

    // ===== 分组操作 =====
    function selectedGroup() {
        // 选中集全部属于同一组 → 该组
        if (selected.size === 0) return null;
        var gid = null;
        for (var i = 0; i < groups.length; i++) {
            var all = true;
            selected.forEach(function(el) {
                if (groups[i].nodeIds.indexOf(el.dataset.moId) < 0) all = false;
            });
            // 组内成员与选中不完全重合也算（部分选中）→ 只要第一个命中的组
            var any = false;
            selected.forEach(function(el) {
                if (groups[i].nodeIds.indexOf(el.dataset.moId) >= 0) any = true;
            });
            if (any) return groups[i];
        }
        return null;
    }
    function updateToolbar() {
        /* 分组按钮已移除，工具栏无需按选中态切换 disabled */
    }
    function createGroupFromSelection() {
        if (selected.size === 0) return;
        showNamePop();
    }
    function renameSelectedGroup() {
        var g = selectedGroup();
        if (!g) return;
        _editingGroup = g;
        showNamePop();
        nameInput.value = g.name;
    }
    function dissolveSelectedGroup() {
        var g = selectedGroup();
        if (!g) return;
        groups = groups.filter(function(x) { return x !== g; });
        saveGroups();
        render(); updateToolbar();
    }

    // ===== 【自动分组 v1】按项目标题聚类：同前缀对话框归为一组 =====
    // 依据（实查修正版）：
    //  - 父子链（data-parent-box）无写入端，仅 spawn-habit 读取 → 不可靠，不用
    //  - 主依据：标题首个分隔符（- _ ｜ | 空格·【 等）前的 token 相同 → 同项目
    //  - 组名 = 项目前缀前2字；组员≥2 才建组（防"全部归一组"）；跳过已有手动/自动组
    //  - 组 id 带 auto- 前缀 + auto:true 标记，「撤销自动」可整批清除，不影响手动组
    var AUTO_COLORS = ['#e17055', '#00b894', '#6c5ce7', '#e84393', '#0984e3', '#fdcb6e', '#00cec9', '#d63031', '#a29bfe', '#2ecc71'];
    function _projectPrefix(title) {
        // 【修复】先剥掉【】[]包裹（占位），否则"【项目A】任务1"整段当前缀，永远配不了对
        var t = String(title || '').trim().replace(/^【([^】]{1,12})】/, '$1-').replace(/^\[([^\]]{1,12})\]/, '$1-');
        if (!t || t === '节点' || t === '（空对话）') return '';
        var m = t.match(/^[【\[]?\s*([^\-—_｜|:：·\s.,，。、()（）]{2,12})/);
        return m ? m[1] : '';
    }
    function _assignedGroupOf(id) {
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].nodeIds.indexOf(id) >= 0) return groups[i];
        }
        return null;
    }
    // 统一提示：App.toast 不存在时降级为自制浮层，杜绝"无反应不报错"
    function _toast(msg) {
        try {
            if (window.App && typeof App.toast === 'function') { App.toast(msg); return; }
        } catch (e) {}
        try {
            var t = document.getElementById('moOrgToast');
            if (!t) {
                t = document.createElement('div'); t.id = 'moOrgToast';
                t.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:60px;transform:translateX(-50%);background:rgba(20,20,20,.88);color:#fff;padding:9px 18px;border-radius:8px;font-size:13px;pointer-events:none;transition:opacity .3s;opacity:0;';
                document.body.appendChild(t);
            }
            t.textContent = msg; t.style.opacity = '1';
            clearTimeout(t._tm); t._tm = setTimeout(function() { t.style.opacity = '0'; }, 2600);
        } catch (e) { console.warn('[organize]', msg); }
    }
    function autoGroupByProject() {
        try {
        // 【移动不被自动分组冲掉 v1】collectBoxes 会从真实 DOM 重建 boxes，
        // 把面板内已拖动但未关闭（还没 commit 回真实画布）的坐标冲掉。
        // 重建前按 moId 快照面板坐标，重建后恢复，保住用户的移动。
        var _oldPos = {};
        boxes.forEach(function(ob) {
            var mid = ob.el && ob.el.dataset.moId;
            if (mid) _oldPos[mid] = { x: ob.x, y: ob.y, moved: !!ob._moved };
        });
        collectBoxes(); // 【修复】每次点击都重新收集，否则新对话框/新标题不生效，且旧标题全是"节点"导致静默无分组
        boxes.forEach(function(b) {
            var p = _oldPos[b.el.dataset.moId];
            if (p) { b.x = p.x; b.y = p.y; b._moved = p.moved; }
        });
        console.warn('[organize][自动分组] 点击，收集到方块 ' + boxes.length + ' 个');
        // ===== v3 无对话框直建流程：扫描场景 → 按项目名前缀聚类 → 直接建组 =====
        var items = boxes.map(function(b) { return { b: b, id: b.el.dataset.moId, asg: _assignedGroupOf(b.el.dataset.moId) }; })
                         .filter(function(it) { return it.id && (!it.asg || it.asg.auto); }); // 手动组跳过；自动组成员参与重算
        if (!items.length) { _toast('场景中没有可分组的对话框（收集到 ' + boxes.length + ' 个方块）'); return; }
        // 按项目名前缀（剥【】[]后，取到首个空格/分隔符，兜底前4字）聚类
        // 【优先 projectId】按对话框所属项目（chat.projectId）聚类，组名=项目名；无 projectId 再退回标题前缀
        var _projNameOf = function(pid) {
            try {
                if (window.App && App._projAllProjects && App._projAllProjects.length) {
                    for (var i = 0; i < App._projAllProjects.length; i++) {
                        if (String(App._projAllProjects[i].id) === String(pid)) return App._projAllProjects[i].name || '';
                    }
                }
                if (window.Store && Store.projects && Store.projects.length) {
                    for (var j = 0; j < Store.projects.length; j++) {
                        if (String(Store.projects[j].id) === String(pid)) return Store.projects[j].name || '';
                    }
                }
            } catch (e) {}
            return '';
        };
        var projBuckets = {};
        items.forEach(function(it) {
            var pid = it.b.chat && (it.b.chat.projectId || it.b.chat.project_id);
            // 【兜底】chat 对象被裁剪丢 projectId 时，经 chat.id 回查 Store.data.chatBoxes（持久化层必含 projectId）
            if (!pid && it.b.chat && it.b.chat.id && window.Store && Store.data && Store.data.chatBoxes) {
                try {
                    for (var k = 0; k < Store.data.chatBoxes.length; k++) {
                        var _e = Store.data.chatBoxes[k];
                        if (_e && String(_e.id) === String(it.b.chat.id) && _e.projectId) { pid = _e.projectId; break; }
                    }
                } catch (e) {}
            }
            if (pid) {
                var key = 'pid:' + pid;
                (projBuckets[key] = projBuckets[key] || []).push(it.b);
                projBuckets[key]._name = _projNameOf(pid) || String(key);
                return;
            }
            var t = String(it.b.title || '').trim().replace(/^【([^】]{1,12})】/, '').replace(/^\[([^\]]{1,12})\]/, '');
            var m = t.match(/^[^\s·\-—－_：:]+/);
            var pf = (m ? m[0] : t).slice(0, 8);
            if (!pf || pf === '节点' || pf === '（空') return;
            (projBuckets[pf] = projBuckets[pf] || []).push(it.b);
        });
        var projs = Object.keys(projBuckets).sort(function(a, b) { return projBuckets[b].length - projBuckets[a].length; });
        if (!projs.length) { _toast('未识别到项目（对话框标题为空或全是"节点"）'); return; }
        console.warn('[organize][自动分组] 候选项目：' + projs.join('、'));
        applyAutoGroups(projs, projBuckets);
        } catch (err) { console.error('[organize][自动分组] 异常：', err); _toast('自动分组出错：' + err.message); }
    }
    // 【v3 无对话框】检测到几个项目就直接建几个组（成员≥2），不再弹选择框
    function applyAutoGroups(projs, projBuckets) {
        var added = 0, builtN = 0;
        var usedColors = groups.map(function(g) { return g.color; });
        var ci = 0;
        projs.forEach(function(pf) {
            var members = projBuckets[pf];
            if (!members || members.length < 2) return; // 落单不入组
            var g = null;
            for (var i = 0; i < groups.length; i++) {
                if (groups[i].auto && groups[i]._pf === pf) { g = groups[i]; break; }
            }
            if (!g) {
                while (ci < AUTO_COLORS.length && usedColors.indexOf(AUTO_COLORS[ci]) >= 0) ci++;
                var color = AUTO_COLORS[ci % AUTO_COLORS.length]; // 全占用时取模复用，不空转
                g = { id: 'auto' + Date.now() + Math.random().toString(36).slice(2, 5), name: (projBuckets[pf]._name || pf).slice(0, 12), color: color, nodeIds: [], auto: true, _pf: pf };
                groups.push(g);
                builtN++;
            }
            members.forEach(function(b) {
                if (g.nodeIds.indexOf(b.el.dataset.moId) < 0) { g.nodeIds.push(b.el.dataset.moId); added++; }
            });
        });
        groups = groups.filter(function(g) { return !g.auto || g.nodeIds.length > 0; }); // 清理空 auto 组
        saveGroups();
        // 【两次点击变色 v2】应户决定：第一次点击只建组（方块不变色），第二次点击才刷新方块颜色。
        // builtN>0 说明本次新建了组 → 保持原色；builtN===0 说明组已存在（第二次点）→ 此时才上色。
        if (builtN === 0) {
            try {
                boxes.forEach(function(b) {
                    var gc = groupColorOf(b.el);
                    if (gc) b.color = gc;
                });
            } catch (e) {}
        }
        render(); updateToolbar();
        try { _toast(added ? '自动分组完成：' + builtN + ' 个项目，共 ' + added + ' 个对话框' : '各项目都不足 2 个对话框，未建组'); } catch (e) {}
        console.warn('[organize][自动分组] 完成，项目：' + projs.join('、') + '，入组 ' + added + ' 个');
    }
    function undoAutoGroups() {
        var before = groups.length;
        groups = groups.filter(function(g) { return !g.auto; });
        var removed = before - groups.length;
        saveGroups();
        render(); updateToolbar();
        try { if (window.App && App.toast) App.toast(removed ? '已撤销 ' + removed + ' 个自动分组' : '没有可撤销的自动分组'); } catch (e) {}
    }

    // =====【框选建组 v1】把当前选中的对话框一键建成一个组 =====
    function createGroupFromSelection() {
        try {
            if (!selected.size) { try { _toast('请先框选或点选对话框'); } catch (e2) {} return; }
            var ids = [];
            selected.forEach(function(el) {
                var id = el.dataset && (el.dataset.moId || el.dataset.nodeId);
                if (id) ids.push(id);
            });
            if (ids.length < 2) { try { _toast('至少选中 2 个才能建组'); } catch (e2) {} return; }
            var usedColors = groups.map(function(g) { return g.color; });
            var color = AUTO_COLORS.filter(function(c) { return usedColors.indexOf(c) < 0; })[0] || AUTO_COLORS[groups.length % AUTO_COLORS.length];
            var g = { id: 'man' + Date.now() + Math.random().toString(36).slice(2, 5), name: '组' + (groups.length + 1), color: color, nodeIds: ids, auto: false };
            groups.push(g);
            // 立即上色成员方块
            try {
                boxes.forEach(function(b) { if (ids.indexOf(b.el.dataset.moId) >= 0) b.color = color; });
            } catch (e3) {}
            saveGroups(); render(); updateToolbar();
            /* 建组命名 v4：建组后弹命名框预填组名，回车确认改名（走 _editingGroup 分支不重复建组），Esc 保持默认名 */
            _editingGroup = g;
            showNamePop();
            nameInput.value = g.name;
            try { _toast('已建组（' + ids.length + ' 个）：输入组名回车确认'); } catch (e2) {}
        } catch (err) { try { console.error('[organize][建组] 异常：', err); } catch (e4) {} }
    }

    // ===== 自动排列：把所选（未选则全部）卡片排成 N 个横排，每张间隔 300px =====
    function arrangeRows(rowCount) {
        if (!boxes.length) return;
        var list = boxes.filter(function(b) { return selected.size === 0 || selected.has(b.el); });
        if (list.length < 2) return;
        if (!MO_LEGACY) {
            // 【位置映射 v2】排列=只更新面板坐标（boxes.x/y），真实 DOM 关面板才写回
            // 【宽度收敛 v3】排列时卡片宽度按最多 500px 计，避免超宽卡片把一排拉得过长；横/纵间距统一 80px
            list.sort(function(a, b) { return (a.y - b.y) || (a.x - b.x); });
            var GAPX = 80, GAPY = 80; // 横向/纵向统一间距
            var maxW = 500; // 排列计宽上限
            var bh = Math.min.apply(null, list.map(function(b) { return Math.max(40, Math.min(b.h, 400)); })) + GAPY;
            var perRow2 = Math.ceil(list.length / rowCount);
            var baseX = Math.min.apply(null, list.map(function(b) { return b.x; }));
            var baseY = Math.min.apply(null, list.map(function(b) { return b.y; }));
            var idx = 0, yy = baseY;
            for (var r2 = 0; r2 < rowCount && idx < list.length; r2++) {
                var row = list.slice(idx, idx + perRow2); idx += perRow2;
                var xx = baseX;
                row.forEach(function(b) { b.w = Math.min(Math.max(b.w, 120), maxW); b.x = Math.round(xx); b.y = Math.round(yy); b._moved = true; xx += b.w + GAPX; });
                yy += bh;
            }
            userView = null;
            render();
            updateToolbar();
            return;
        }
        // 按当前视觉顺序排序：先按 y 分行带，再按 x
        list.sort(function(a, b) { return (a.y - b.y) || (a.x - b.x); });

        var GAP = MO_LEGACY ? 400 : 140; // 【间隔+100】旧版 400；小方块模式 140
        var perRow = Math.ceil(list.length / rowCount);
        // 以所选集合当前左上角为基准，保持原位
        var baseX = Math.min.apply(null, list.map(function(b) { return b.x; }));
        var baseY = Math.min.apply(null, list.map(function(b) { return b.y; }));
        // 每行该行最高的卡片决定行高
        var idx = 0;
        var y = baseY;
        for (var r = 0; r < rowCount && idx < list.length; r++) {
            var row = list.slice(idx, idx + perRow);
            idx += perRow;
            var x = baseX;
            var rowH = 0;
            row.forEach(function(b) {
                var nx = Math.round(x), ny = Math.round(y);
                // 【防风暴】排列时只更新面板数据，真实 DOM 由 _commitDragToReal()/commitPendingToReal() 一次性写入
                b.x = nx; b.y = ny; b._pendingCommit = true; b._moved = true;
                x += b.w + GAP;
                if (b.h > rowH) rowH = b.h;
            });
            y += rowH + GAP;
        }
        // 排列计算完毕，一次性落地到真实对话框（避免逐个写 style 触发 Observer 风暴）
        _commitDragToReal();
        // 排列后回到自动 fit 视图，保证全部可见
        userView = null;
        render();
        updateToolbar();
    }

    // ===== 打开/关闭 =====
    var _openning = false;
    function setDockDot() {
        var dot = document.getElementById('organizeDot');
        if (dot) dot.classList.toggle('on', !!active);
        var ob = document.getElementById('organizeDockBtn');
        if (ob) ob.classList.toggle('organize-on', !!active);
    }
    function open() {
        if (active || _openning) return; // 【防重入】已打开/正在打开时忽略，避免重复初始化与事件叠加导致死循环
        // ⛔作废引擎运行时警告（2026-11-19 用户拍板）：旧渐变卡片版 i整理面板已作废（正确入口：app-canvas.js canvasOverviewToggle），
        // 任何对它的【真实调用】在此报出，便于发现误还原。警告挂在打开入口而非文件头——本文件的 dock/隐藏注入/组隐藏联动段
        // 仍是现行实现、每次启动都会加载，挂在文件头等于每次启动必刷一条"已废弃"，既是噪音又与文件头"勿整文件作废"相矛盾。
        console.warn('⛔[作废] 调用了已作废的旧渐变卡片版 i整理（MinimapOrganize.open）。正确版本为 app-canvas.js canvasOverviewToggle（真对话框缩小版）。');
        _openning = true;
        try { ensureDom(); } catch (e) { _openning = false; throw e; }
        try { collectBoxes(); } catch (e) { try { console.error('[整理面板] collectBoxes 异常:', e); } catch (e2) {} }
        userView = null; // 每次打开回到自动 fit 视图
        _blS0 = 0; // 【方块过小修复】重开面板重算基准缩放锚点
        if (!MO_LEGACY) blResetView(); // 【小方块模式】重置面板视角（平移/缩放归零）
        active = true;
        /* 【迁移中门禁 v2】整理期间挂起守恒模块采集/校正：拖动只改面板数据不写真实 DOM，
           周期采集会把面板态误判为漂移并写成偏移基准 → 确认后平移触发校正把子窗拉远 */
        try { if (window.ZFRelativeRestore && ZFRelativeRestore.beginMigration) ZFRelativeRestore.beginMigration(); } catch (e) {}
        overlay.classList.add('active');
        /* 【移动端适配 v1】小屏触屏设备：面板强制全屏，忽略记忆位置尺寸（否则记忆的 720 宽浮窗在手机上溢出且拖不动） */
        try {
            if (MO_LEGACY) {
                // 【全屏版 v2】i缩小整理：无条件真全屏，忽略 localStorage 浮窗记忆（zf_organize_win 是废弃浮窗版的残留）
                var _mp = overlay.querySelector('.mo-panel');
                _mp.style.left = '0px'; _mp.style.top = '0px';
                _mp.style.width = '100vw'; _mp.style.height = '100vh';
            } else if (_isTouchDevice || window.innerWidth < 720) { // 【遥控器模式 v2】触屏设备一律全屏适配，不依赖记忆位置尺寸，无需手动拖拽
                var _mp = overlay.querySelector('.mo-panel');
                _mp.style.left = '0px'; _mp.style.top = '0px';
                _mp.style.width = '100vw'; _mp.style.height = '100vh';
            } else { _applyWinRect && _applyWinRect(); }
        } catch (e) {}
        try { document.body.classList.add('zf-org-mode'); } catch (e) {} // 【v3】全局 Observer 兜底标记
        // 【5.3.1 修订】左上角不再显示项目名，固定显示"i整理"
        try {
            var _moTitle = overlay.querySelector('.mo-title');
            if (_moTitle) _moTitle.textContent = 'i整理';
        } catch (e) {}
        setCursorForState('default');
        setDockDot();
        // 等一帧让面板有尺寸
        // 【面板打不开修复】rAF 回调若抛异常，_openning 会永远卡在 true，之后点击整理按钮
        //   open() 直接 return → 面板再也无法打开。用 try/finally 保证标志复位 + 超时兜底。
        var _opened = false;
        var _openTimer = setTimeout(function() {
            if (!_opened) { _openning = false; }
        }, 500);
        requestAnimationFrame(function() {
            try {
                if (!MO_LEGACY) {
                    // 【小方块模式】打开时只同步真实位置到面板数据，不动真实画布
                    // （避免"仅打开面板"就重排用户布局；只有拖块/排列后才写回）
                    syncRealToGrid();
                }
                render();
                updateToolbar();
            } catch (e) {
                try { console.error('[整理面板] open 渲染异常:', e); } catch (e2) {}
            } finally {
                _opened = true;
                _openning = false;
                clearTimeout(_openTimer);
            }
        });
    }
    function close() {
        if (!active) return; // 【防重入】未打开时忽略
        active = false;
        mode = null;
        hoverBox = null;
        try { document.body.classList.remove('zf-org-mode'); } catch (e) {} // 【v3】撤销全局 Observer 兜底标记
        /* 【迁移中门禁 v2】写回期间挂起守卫模块采集/校正，防止把写回中间态写成偏移基准
           （否则外部平移触发校正时子窗被按污染基准拉远 → 「确认后平移一点子对话飞远」） */
        try { if (window.ZFRelativeRestore && ZFRelativeRestore.beginMigration) ZFRelativeRestore.beginMigration(); } catch (e) {}
        setCursorForState('default');
        overlay.classList.remove('active'); // 【先隐藏再写回】若 commitPendingToReal 抛异常，面板也能正常关闭（此前写在后面导致写回异常时面板卡住关不掉）
        setDockDot();
        hideNamePop();
        try { commitPendingToReal(); } catch (e) { try { console.error('[整理面板] close 写回异常:', e); } catch (e2) {} } // 【位置映射 v2】关闭面板才把面板内整理的最终位置一次性写回真实对话框
        /* 【门禁释放】挂在写回完成后的 setTimeout 回调（写回含父子子树跟随+小地图刷新，
           异步分批）：释放时按最终真实位置重算守恒偏移基准并落库 */
        setTimeout(function () {
          try { if (window.ZFRelativeRestore && ZFRelativeRestore.endMigration) ZFRelativeRestore.endMigration(); } catch (e) {}
        }, 300);
        // 通知主画布刷新小地图
        if (window.App && App.updateMinimap) setTimeout(function() { App.updateMinimap(); }, 50);
    }
    // =====【快速创建 v2】三入口（双击空白/右键空白/Tab）改为「就地创建真实对话框」=====
    // 为什么不再走 KiteCanvas.openDualPanels 双栏面板：整理面板下滚轮已缩放画布，双栏面板会被
    // 缩放 transform 拖成小点且无法输入，用户必须切回普通模式才能发消息，等于死的。
    // 新方案：直接用 App.createChatBox 在鼠标位置创建真实对话框（原生 chatbox，天然支持
    // 打字回车发送、粘贴图片/粘贴文字），创建后立即聚焦输入框，无需离开整理面板。
    // 返回 true=创建成功（调用方可退出整理面板）；false=失败（面板保持打开）。
    function _openCreateDialog(clientX, clientY) {
        var app = window.App;
        if (!app || typeof app.createChatBox !== 'function') {
            console.error('[整理面板·快速创建] 失败：window.App.createChatBox 缺失。');
            return false;
        }
        try {
            // 【鼠标位置修复 v2】整理面板是全屏覆盖层，覆盖层下的真实画布可能不在视口内，
            // 直接读 getBoundingClientRect/canvasGetView 都可能拿到过期或错位基准。
            // 改为传屏幕坐标 + trustedSpawn=false，让 createChatBox 内部统一做
            // 「(client - cRect)/scale」正确换算 + 可视区钳制，天然落在鼠标位置。
            var chat = app.createChatBox(clientX, clientY, null, false);
            if (!chat || !chat.el) {
                console.warn('[整理面板·快速创建] createChatBox 返回空（可能触发限流/上限）');
                return false;
            }
            // 聚焦输入框，让用户直接打字回车发送（原生 chatbox 已支持粘贴图片/文字）
            var input = chat.el.querySelector('textarea');
            if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);
            return true;
        } catch (err) {
            console.error('[整理面板·快速创建] createChatBox 执行抛异常：', err);
            return false;
        }
    }
    function toggle() { active ? close() : open(); }

    // 【停机保护解除】只有真实用户输入才能唤醒渲染：未知渲染回路（MutationObserver/
    //   回流反馈风暴）无法伪造这些事件，面板不会永远黑屏，误伤也能一键恢复
    ['mousedown', 'wheel', 'keydown', 'touchstart'].forEach(function(ev) {
        document.addEventListener(ev, function() {
            if (_fuseLockUntil > Date.now()) {
                _fuseLockUntil = 0;
                _fuseTrips = 0;
                _fuseCount = 0;
                _fuseTs = Date.now();
            }
        }, true);
    });

    // ===== 导出 =====
    window.MinimapOrganize = {
        open: open,
        close: close,
        toggle: toggle,
        isActive: function() { return active; },
        getGroups: function() { return groups; },
        // 【工作台虚拟框联动】供抽屉开合时立即重绘整理面板（含 300ms 可见性缓存清除）
        refresh: function() {
            try { _wbVisCache = {}; } catch (e) {}
            if (active) render();
        },
        // 【测试钩子】断网回弹演练用：直查队列/手动补推，不改动生产逻辑
        _extDebug: {
            pending: function() { return _extPending.slice(); },
            flush: function() { _extFlush(); }
        }
    };

    /* =================【P1 骨架 v1】NodeIndex + 空间网格桶 + LOD三级 + queryVisible =================
       依据：ii整理2.0最终方案 v3.0（真源=canvas_node_ext，localStorage只缓存；draw()+桶逻辑从
       p0-stress-test.html 搬运）。P1 为可抛弃脚手架口径：DOM 仍是坐标真源，索引只读镜像。
       LOD 硬规则：视口内 ≤300 恒 L0(文字+边框)；>300 全体降 L1(纯色块)；屏外(±80px 外)不画=L2。
       宽高比缓存：collectBoxes 后事件驱动增量上报 dirty 节点（唯一 DOM 尺寸读取口）。 */
    var P1 = (function() {
        var _byId = {};        // id -> index 节点（id/x/y/w/h/group/title/ratio/dirty/lod）
        var _buckets = {};     // "gx,gy" -> [node] 空间网格桶（CELL=300 面板像素）
        var CELL = 300;
        var _extQ = [];        // 待上报 ext 的 dirty 节点 id 队列
        var _lodNote = false;  // 降级提示只弹一次

        function _gkey(x, y) { return Math.floor(x / CELL) + ',' + Math.floor(y / CELL); }
        function _rebucket(n) {
            if (n._bk) { var a = _buckets[n._bk]; if (a) { var i = a.indexOf(n); if (i >= 0) a.splice(i, 1); } }
            n._bk = _gkey(n.x, n.y);
            (_buckets[n._bk] = _buckets[n._bk] || []).push(n);
        }
        /* 增量重建：以 boxes 为源（DOM 坐标真源），只更新变化节点，不整体重建 */
        function rebuild() {
            /* 【可见性种子 v1】每次 rebuild 缓存一份 localStorage 规则镜像（幂等，开销可忽略） */
            function _closedMap0() { try { return JSON.parse(localStorage.getItem('zf_org_closed') || '{}'); } catch (e) { return {}; } }
            function _visinMap0() { try { return JSON.parse(localStorage.getItem('zf_org_visin') || '{}'); } catch (e) { return {}; } }
            try {
                if (typeof boxes === 'undefined' || !boxes) return;
                var seen = {};
                boxes.forEach(function(b) {
                    var id = b.id || (b.el && (b.el.dataset.moId || b.el.dataset.nodeId)) || null;
                    if (!id) return;
                    seen[id] = true;
                    var n = _byId[id];
                    var w = b.w || (b.el ? b.el.offsetWidth : 0) || 200;
                    var h = b.h || (b.el ? b.el.offsetHeight : 0) || 140;
                    if (!n) {
                        n = _byId[id] = { id: id, x: b.x, y: b.y, w: w, h: h,
                            title: (b.el && (b.el.dataset.title || b.el.title)) || '', group: null, lod: 0 };
                        _rebucket(n);
                    } else if (n.x !== b.x || n.y !== b.y || n.w !== w || n.h !== h) {
                        n.x = b.x; n.y = b.y; n.w = w; n.h = h;
                        _rebucket(n);
                    }
                    /* 【可见性种子 v1】新节点首见时从 localStorage 回填 closed/visibleIn（刷新后规则不丢；
                       _vidSetClosed/_vidSetVisibleIn 写入侧本就直写索引，此处只补冷启动缺口，一次性不覆盖运行态） */
                    if (!n._seeded) {
                        n._seeded = true;
                        try { if (_closedMap0()[id]) n.closed = true; } catch (eC0) {}
                        try { var _r0 = _visinMap0()[id]; if (_r0) n.visibleIn = _r0; } catch (eV0) {}
                        try { if ((JSON.parse(localStorage.getItem('zf_org_done') || '{}'))[id]) n.done = true; } catch (eDn0) {}
                        // 【隐藏态回填 v1】刷新后给隐藏节点的 DOM 补挂 qn-gone（否则普通模式照常渲染，隐藏白设）
                        try {
                            if (n.closed || (n.visibleIn && n.visibleIn.normal === false)) {
                                var _el0 = document.getElementById(id);
                                if (_el0) _el0.classList.add('qn-gone');
                            }
                        } catch (eR0) {}
                    }
                });
                // 节点已消失（关闭对话）→ 从索引与桶中清除（硬约束：索引跟随删除事件清理）
                Object.keys(_byId).forEach(function(id) {
                    if (!seen[id]) { var n = _byId[id]; if (n._bk) { var a = _buckets[n._bk]; var i = a ? a.indexOf(n) : -1; if (i >= 0) a.splice(i, 1); } delete _byId[id]; }
                });
            } catch (e) {}
        }
        /* 查询矩形命中（空间桶，O(桶数)） */
        function queryRect(x0, y0, x1, y1, out) {
            out = out || [];
            var g0x = Math.floor(x0 / CELL), g1x = Math.floor(x1 / CELL);
            var g0y = Math.floor(y0 / CELL), g1y = Math.floor(y1 / CELL);
            for (var gx = g0x; gx <= g1x; gx++) for (var gy = g0y; gy <= g1y; gy++) {
                var arr = _buckets[gx + ',' + gy];
                if (!arr) continue;
                for (var i = 0; i < arr.length; i++) {
                    var n = arr[i];
                    if (n.x < x1 && n.x + n.w > x0 && n.y < y1 && n.y + n.h > y0) out.push(n);
                }
            }
            return out;
        }
        /* LOD 判级：0=文字+边框 | 1=纯色块 | 2=不画。视口≤300恒L0，>300全体L1，屏外L2 */
        function assignLod(wx0, wy0, wx1, wy1) { // 【P1绘制消费 v1】改世界坐标视口（旧面板像素签名系空间错位）
            var vis = queryRect(wx0, wy0, wx1, wy1);
            var inView = [];
            vis.forEach(function(n) { if (n.x + n.w > wx0 && n.x < wx1 && n.y + n.h > wy0 && n.y < wy1) inView.push(n); });
            var lod0 = inView.length <= 300;
            inView.forEach(function(n) { n.lod = lod0 ? 0 : 1; });
            vis.forEach(function(n) { if (inView.indexOf(n) < 0) n.lod = 2; }); // 【死代码清理 v1】删 inView.includes 空分支与重复降级行
            if (!lod0 && !_lodNote) {
                _lodNote = true;
                try { if (window.Toast) Toast.show('节点较多，外围已简化渲染，放大查看细节'); } catch (e) {}
            }
            return { l0: lod0 ? inView.length : 0, l1: lod0 ? 0 : inView.length, l2: vis.length - inView.length };
        }
        /* queryVisible(node, mode)：可见性指挥台统一拦截入口（P1 预埋，P3 接规则表）
           mode: 'organize'|'normal'|'focus'；返回 true=该模式应显示 */
        function queryVisible(node, mode) {
            try {
                var n = typeof node === 'string' ? _byId[node] : node;
                if (!n) return true; // 索引外的节点默认可见（不误伤）
                if (n.closed) return false;               // 「关闭」态：三模式全隐
                if (n.visibleIn && n.visibleIn[mode] === false) return false; // 「显示」分库
                if (n.group) { // 节点级覆盖组级
                    var g = _groupById(n.group);
                    if (g && g.closed) return false;
                }
            } catch (e) {}
            return true;
        }
        function _groupById(gid) {
            try { if (typeof groups !== 'undefined' && groups) for (var i = 0; i < groups.length; i++) if (groups[i].id === gid) return groups[i]; } catch (e) {}
            return null;
        }
        /* ext 上报：只推 dirty 节点（宽高比唯一 DOM 读取口 = collectBoxes 后的 rebuild 差异） */
        function syncExt() {
            try {
                Object.keys(_byId).forEach(function(id) {
                    var n = _byId[id];
                    if (!n.dirty) return;
                    n.dirty = false;
                    fetch('/api/engineering/node/upsert', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: id, aspect_ratio: n.w / Math.max(1, n.h), title_ext: n.title || '', src: 'org' })
                    }).catch(function() {}); // 写失败静默（索引是只读镜像，无回弹需求；真源写失败回弹属 P2 数据层）
                });
            } catch (e) {}
        }
        function stats() { return { nodes: Object.keys(_byId).length, buckets: Object.keys(_buckets).length }; }
        return { rebuild: rebuild, queryRect: queryRect, assignLod: assignLod, queryVisible: queryVisible, syncExt: syncExt, stats: stats, index: _byId, node: function(id) { return _byId[id] || null; } };
    })();
    // S1 收编钩子：主渲染循环每 1s 调（见 _renderBlocksNow 顶部）；_orgEnhance._tick 保留为兜底
    function _p1Rebuild() { try { P1.rebuild(); } catch (e) {} }
    function _p1SyncExt() { try { P1.syncExt(); } catch (e) {} }
    try {
        window.__orgEnhanceTick = null; // 占位：_orgEnhance 模块挂载后此钩子接管其 tick
        window.MinimapOrganize = window.MinimapOrganize || {};
        window.MinimapOrganize.P1 = P1;
        window.MinimapOrganize.queryVisible = P1.queryVisible;
    } catch (e) {}

    // ===== 【总览即整理 M3】canvas 后端桥：总览模式下把工具条借到画布底部 =====
    // 原理：ZFCanvasOverview 负责真窗口点选/框选/拖动（el 引用与 boxes 一致），
    //   点停靠条按钮时先把总览选择集同步进 selected → collectBoxes() 重建 boxes →
    //   再触发面板内同 id 按钮的原生 click，动作函数零改动。
    (function _canvasBackendBridge() {
        if (window.__zfMoCanvasBridge) return;
        window.__zfMoCanvasBridge = true;

        var dock = null;
        // 允许借到总览用的按钮（排除重命名/解散/×/播放/排列——依赖面板画布或语义不合）
        //   【M3 补全】放行 moGroupBtn（建组）：showNamePop 已加总览态定位兜底，命名框可正常显示。
        var ALLOW = {};   /* 分组/回收按钮已移除，总览 dock 仅借角色派发按钮 */
        // 【修复】角色按钮改按 data-role 属性放行（见 buildDock），不再依赖文字白名单 ALLOW_ROLE。

        function selectedFromOverview() {
            try {
                if (!window.ZFCanvasOverview) return 0;
                var list = window.ZFCanvasOverview.selected() || [];
                selected.clear();
                list.forEach(function (el) { selected.add(el); });
                return list.length;
            } catch (e) { return 0; }
        }

        // 【缩小整理·一排】总览态直接横向重排选中的真实对话框（chatbox），
        //   解决"对话太远根本看不到"：写真实 style.left/top（与 overview 拖动同一机制），
        //   面板里的「1排」(arrangeRows) 只改面板 boxes 数据、关面板才写回，不能用于总览态，故单列此函数。
        function arrangeRealRow(list) {
            try {
                if (!list || !list.length) return;
                if (list.length < 2) {
                    // 一排语义需≥2个才有意义；单窗点击给明确提示，避免静默无反应（与按钮 title 一致）
                    try { if (window.Toast) Toast.show('一排至少需要选择 2 个对话框'); else _dlgAlert('一排至少需要选择 2 个对话框'); } catch (eT) {}
                    return;
                }
                var items = list.map(function (el) {
                    return {
                        el: el,
                        left: parseFloat(el.style.left) || 0,
                        top: parseFloat(el.style.top) || 0,
                        w: (el.offsetWidth || 300)
                    };
                });
                // 按当前视觉顺序：先按 top 分行带、再按 left
                items.sort(function (a, b) { return (a.top - b.top) || (a.left - b.left); });
                var GAP = 40;
                var baseTop = Math.min.apply(null, items.map(function (i) { return i.top; }));
                var x = Math.min.apply(null, items.map(function (i) { return i.left; }));
                items.forEach(function (i) {
                    i.el.style.left = Math.round(x) + 'px';
                    i.el.style.top = Math.round(baseTop) + 'px';
                    /* 【错位修复 v2】同步内存态 chat.x/y：只写 el.style 不改 chat.x/y，
                       后续按 chat.x/y 落库/刷新的模块会把窗口按旧坐标写回 → 退出整理后错位。
                       （与 commitPendingToReal v7 同一口径） */
                    try {
                        var _cid = i.el.id;
                        var _acb = (window.App && window.App.chatBoxes) || [];
                        for (var ai = 0; ai < _acb.length; ai++) {
                            if (_acb[ai] && (_acb[ai].id === _cid || (_acb[ai].el && _acb[ai].el === i.el))) {
                                _acb[ai].x = Math.round(x);
                                _acb[ai].y = Math.round(baseTop);
                                break;
                            }
                        }
                    } catch (eS) {}
                    x += i.w + GAP;
                });
                // 全量持久化（复用 overview 拖动结束的保存方式，无需逐个匹配 el）
                try {
                    var boxes = (window.App && window.App.chatBoxes) || [];
                    for (var i = 0; i < boxes.length; i++) {
                        try { if (window.Store && Store.saveChatBox) Store.saveChatBox(boxes[i]); } catch (e0) {}
                    }
                } catch (e1) {}
                try { if (window.ZFCanvasOverview && ZFCanvasOverview.refresh) ZFCanvasOverview.refresh(); } catch (e2) {}
            } catch (err) { try { console.error('[整理dock] 一排重排异常:', err); } catch (e3) {} }
        }

        function buildDock() {
            ensureDom();
            if (dock) return dock;
            dock = document.createElement('div');
            dock.className = 'mo-canvas-dock';
            dock.style.cssText = 'display:none;position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:9002;align-items:center;gap:6px;padding:4px 6px;border-radius:14px;background:transparent;border:1px solid transparent;';
            /* 底部浮条按钮（2026-11-22 用户令 v4.1：整体加大/文字悬浮在图标上方/hover 深黑底/固定尺寸防抖动）：
               「新建」+「一排」+「隐藏」+「显示」+「省电」+「派出」+「建组」+「展开」+「返回·最右」（共 9 枚）：
               · bottom 演进：18px（与 #zfAppDock bottom:10px 完全叠死）→ 88px（用户嫌太靠上）→ 48px（用户令下移40px。
                 注：#zfAppDock 顶≈64px（10+4+46），48px 与其有约16px交叠区，用户实view后拍板，若冲突再微调）；
               · 按钮固定 46×46，文字走 .mo-btn-tip 绝对定位浮层（不改布局流）→ hover 零位移防抖动；
               · 新建=QuickCreate.toggle()，与双击空白/右键空白/Tab 同一入口；
               · 派出=派出团队面板（15 角色全量，弹出宿主 bottom 已同步上调）；
               · 建组/展开=原右上角 zfGrpToolbar 图标工具栏并入（app-canvas-groups.js showToolbar 已置空壳）；
               · 省电=一键批量真隐藏（P1-1 策划案 20261122，走 zf-chat-hidden 通道，流式/选中/活跃豁免，再点恢复本次的）；
               · 返回=退出缩小i整理（与 Esc 等价），固定 dock 最末（最右侧）。
               ⚠ 历史教训：改按钮数量/顺序/文字/位置务必同步本注释。 */
            // 【缩小整理·一排】追加一排按钮：把总览选中的真实对话框横向排成一行（解决对话太远看不到）
            (function () {
                var rb = document.createElement('button');
                rb.className = 'mo-btn mo-arr mo-dock-row1';
                rb.textContent = '一排';
                rb.title = '把总览中选中的（未选中则全部可见）对话框横向排成 1 排，间距 40px，解决对话太远看不到';
                rb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var n = selectedFromOverview();
                    var list = (window.ZFCanvasOverview && ZFCanvasOverview.selected && ZFCanvasOverview.selected()) || [];
                    if (!list.length) {
                        // 未选中：对全部可见 chatbox 一排
                        //   【对齐 title「全部可见」】两重通用过滤（不依赖任何隐藏态类名）：
                        //   ① offsetParent !== null 挡掉 display:none/整体脱离布局的对话框；
                        //   ② getComputedStyle(el).visibility !== 'hidden' 挡掉所有「保留布局但视觉
                        //      隐藏」的窗。canvas-lod.css 的 .lod-hidden 即用 visibility:hidden
                        //      （保留布局，offsetParent 仍非 null，第①重挡不住）。这里改用 computed
                        //      visibility 通用判定，而非硬编码 'lod-hidden' 类名 —— 这样未来若新增
                        //      任何以 visibility:hidden 隐藏窗口的态（不限类名）也会被自动排除，
                        //      彻底消除「漏排视觉隐藏窗」隐患（审核#2 前瞻观察收口，本轮修复）。
                        //      注：一排为低频点击、chatbox 数量有限，逐个 getComputedStyle 可接受。
                        try { list = Array.prototype.slice.call(document.querySelectorAll('.chatbox')).filter(function (el) { if (el.offsetParent === null) return false; try { return window.getComputedStyle(el).visibility !== 'hidden'; } catch (e1) { return true; } }); } catch (e2) { list = []; }
                    }
                    if (!list.length) {
                        try { if (window.Toast) Toast.show('没有可排的对话框'); else _dlgAlert('没有可排的对话框'); } catch (e3) {}
                        return;
                    }
                    arrangeRealRow(list);
                });
                dock.appendChild(rb);
            })();
            /* =====【隐藏/显示 v2】两个独立按钮（无图标）=====
               隐藏语义（需求拍板 2026-11-21）：
               · 无限画布普通模式 & i缩略图：真隐藏（display:none，彻底移出渲染树 → 真实提升帧率）；
               · i缩小整理模式：留框（透明占位虚线框，仍可点选/框选，不丢位置）；
               · 专注模式：同样真隐藏（不在整理模式范围内）。
               状态持久化 localStorage['zf_chat_hidden_ids']，刷新/重启不丢。 */
            (function () {
                function _sel() {
                    var list = (window.ZFCanvasOverview && ZFCanvasOverview.selected && ZFCanvasOverview.selected()) || [];
                    if (!list.length) {
                        /* 未选中：对全部可见 chatbox 生效（与「一排」按钮同一双重过滤口径） */
                        try { list = Array.prototype.slice.call(document.querySelectorAll('.chatbox')).filter(function (el) { if (el.offsetParent === null) return false; try { return window.getComputedStyle(el).visibility !== 'hidden'; } catch (e1) { return true; } }); } catch (e2) { list = []; }
                    }
                    return list;
                }
                /* 隐藏按钮 */
                var hb = document.createElement('button');
                hb.className = 'mo-btn mo-arr mo-dock-hide';
                hb.textContent = '隐藏';
                hb.title = '把总览中选中的（未选中则全部可见）对话框隐藏：普通画布与i缩略图完全不可见（真隐藏提帧率），整理模式中留透明虚线框';
                hb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var sel = _sel().filter(function (el) { return !el.classList.contains('zf-chat-hidden'); });
                    if (!sel.length) { try { if (window.Toast) Toast.show('没有可隐藏的对话框'); } catch (eT) {} return; }
                    var ids; try { ids = JSON.parse(localStorage.getItem('zf_chat_hidden_ids') || '[]'); } catch (eJ) { ids = []; }
                    sel.forEach(function (el) { el.classList.add('zf-chat-hidden'); if (ids.indexOf(el.id) < 0) ids.push(el.id); });
                    try { localStorage.setItem('zf_chat_hidden_ids', JSON.stringify(ids)); } catch (eS) {}
                    try { window.dispatchEvent(new CustomEvent('zf-chat-hidden-changed')); } catch (eE) {}
                    try { if (window.Toast) Toast.show('已隐藏 ' + sel.length + ' 个对话框：普通画布/i缩略图真隐藏（提帧率），整理模式留虚线框', true); } catch (eT2) {}
                });
                dock.appendChild(hb);
                /* 显示按钮 */
                var sb = document.createElement('button');
                sb.className = 'mo-btn mo-arr mo-dock-show';
                sb.textContent = '显示';
                sb.title = '把选中的已隐藏对话框恢复显示（未选中则恢复全部隐藏对话框）';
                sb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var picked = (window.ZFCanvasOverview && ZFCanvasOverview.selected && ZFCanvasOverview.selected()) || [];
                    var sel = picked.length ? picked.filter(function (el) { return el.classList.contains('zf-chat-hidden'); }) : Array.prototype.slice.call(document.querySelectorAll('.chatbox.zf-chat-hidden'));
                    if (!sel.length) { try { if (window.Toast) Toast.show('没有已隐藏的对话框可显示'); } catch (eT) {} return; }
                    var ids; try { ids = JSON.parse(localStorage.getItem('zf_chat_hidden_ids') || '[]'); } catch (eJ) { ids = []; }
                    sel.forEach(function (el) { el.classList.remove('zf-chat-hidden'); ids = ids.filter(function (i) { return i !== el.id; }); });
                    try { localStorage.setItem('zf_chat_hidden_ids', JSON.stringify(ids)); } catch (eS) {}
                    try { window.dispatchEvent(new CustomEvent('zf-chat-hidden-changed')); } catch (eE) {}
                    try { if (window.Toast) Toast.show('已显示 ' + sel.length + ' 个对话框', true); } catch (eT2) {}
                });
                dock.appendChild(sb);
            })();
            /* =====【P1-1 一键省电 v1 策划案 20261122】=====
               语义：把「未选中 / 未流式 / 非最近活跃」的可见对话批量走既有 zf-chat-hidden 真隐藏通道
               （display:none 移出渲染树 → 真实提帧率）；再点「省电」只恢复【本次省电隐藏】的窗，
               不动用户此前手动隐藏的。用户主动触发，不违反 2026-12「对话不隐藏」法令。
               豁免：总览选中窗、data-streaming=1 流式窗、UserSettings.last_active_chat_id 最近活跃窗、
               焦点所在窗。按钮激活态不持久化：刷新后隐藏集仍在（zf_chat_hidden_ids 持久），
               按钮回「未激活」态，用「显示」按钮即可批量恢复。 */
            (function () {
                var pb = document.createElement('button');
                pb.className = 'mo-btn mo-arr mo-dock-power';
                pb.textContent = '省电';
                pb.title = '一键省电：把未选中/未流式/非活跃的对话批量隐藏（真隐藏提帧率）；再点恢复本次隐藏的。流式中、总览选中、最近活跃的对话不受影响';
                var _myIds = null; // null=未激活；数组=本次省电新增隐藏的 id 集
                pb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var ids; try { ids = JSON.parse(localStorage.getItem('zf_chat_hidden_ids') || '[]'); } catch (eJ) { ids = []; }
                    if (_myIds === null) {
                        /* 激活：收集豁免集 → 逐窗挂 zf-chat-hidden */
                        var keep = {};
                        var sel = (window.ZFCanvasOverview && ZFCanvasOverview.selected && ZFCanvasOverview.selected()) || [];
                        sel.forEach(function (el) { keep[el.id] = 1; });
                        try {
                            var la = (window.UserSettings && UserSettings.get && UserSettings.get('last_active_chat_id')) || null;
                            if (la) keep[String(la)] = 1;
                        } catch (eU) {}
                        var boxes = document.querySelectorAll('.chatbox');
                        var hidden = 0;
                        var mine = [];
                        for (var i = 0; i < boxes.length; i++) {
                            var bx = boxes[i];
                            if (keep[bx.id]) continue;                                  // 选中/最近活跃豁免
                            if (bx.getAttribute('data-streaming') === '1') continue;    // 流式中豁免
                            if (bx.classList.contains('zf-chat-hidden')) continue;      // 已隐藏的不重复登记
                            try { if (bx.contains(document.activeElement)) continue; } catch (eF) {} // 焦点窗豁免
                            bx.classList.add('zf-chat-hidden');
                            if (ids.indexOf(bx.id) < 0) { ids.push(bx.id); mine.push(bx.id); }
                            hidden++;
                        }
                        try { localStorage.setItem('zf_chat_hidden_ids', JSON.stringify(ids)); } catch (eS) {}
                        try { window.dispatchEvent(new CustomEvent('zf-chat-hidden-changed')); } catch (eE) {}
                        _myIds = mine.length ? mine : null; // 无新增可隐藏 → 不进入激活态，按钮保持可再次点
                        try { if (window.Toast) Toast.show(hidden ? ('⚡ 已省电隐藏 ' + hidden + ' 个对话（流式/选中/活跃除外）· 再点「省电」恢复') : '没有可省电隐藏的对话（都已隐藏或全在豁免中）', true); } catch (eT) {}
                    } else {
                        /* 恢复：只恢复本次省电新增的 id，用户手动隐藏的不动 */
                        var n = 0;
                        _myIds.forEach(function (mid) {
                            var el = document.getElementById(mid);
                            if (el && el.classList.contains('zf-chat-hidden')) { el.classList.remove('zf-chat-hidden'); n++; }
                            ids = ids.filter(function (x) { return x !== mid; });
                        });
                        try { localStorage.setItem('zf_chat_hidden_ids', JSON.stringify(ids)); } catch (eS2) {}
                        try { window.dispatchEvent(new CustomEvent('zf-chat-hidden-changed')); } catch (eE2) {}
                        _myIds = null;
                        try { if (window.Toast) Toast.show('已恢复 ' + n + ' 个省电对话', true); } catch (eT2) {}
                    }
                    pb.classList.toggle('mo-power-on', _myIds !== null);
                });
                dock.appendChild(pb);
            })();
            document.body.appendChild(dock);
            /* 【复用派出团队面板·v20261103】dock 追加「☰ 派出团队」入口：点击在 dock 上方弹出
               ZFCrewPanel（15 角色全量卡通卡+叮嘱+➤），与旧 4 个快速按钮并存。
               派发接管（onDispatch）：混编 payLoad.picks × 框选目标 全组合，复用 dispatchRole
               的 roleStatus 登记 + seq*500 真串行骨架；施工队等吃 box 参数的角色以伪 box 验证。 */
            (function () {
                if (dock.__crewEntryAdded) return;
                dock.__crewEntryAdded = true;
                var cb = document.createElement('button');
                cb.className = 'mo-btn mo-arr mo-dock-crew';
                cb.textContent = '派出';
                cb.title = '打开派出团队面板（15 角色全量）：点卡通卡选人数、写一句话叮嘱、➤ 错峰派出到框选的对话';
                cb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    /* 【重复标题修复 v2 20261130】已弹过（host 存活）时直接切换隐藏，不重复挂载面板 */
                    var _openHost = dock.__crewHost;
                    if (_openHost && _openHost.parentNode) {
                        if (_openHost.__docClose) window.removeEventListener('mousedown', _openHost.__docClose, true);
                        _openHost.parentNode.removeChild(_openHost);
                        dock.__crewHost = null;
                        return;
                    }
                    /* 【框选针对修复 v2】先同步总览框选到 selected 集合：
                       原来只调 collectBoxes() 不同步选中，selected 为空时 _collectTargets()
                       回退到全部对话 → 框选了部分对话却派给全部。改为：框选了 N 个 → 只派这 N 个；
                       未框选 → 提示先框选，不再静默派全部。 */
                    var nSel = selectedFromOverview();
                    if (!nSel) { try { if (window.Toast) Toast.show('请先在总览中点选/框选要派出团队的目标对话'); else _dlgAlert('请先在总览中点选/框选要派出团队的目标对话'); } catch (e3) {} return; }
                    try { collectBoxes(); } catch (e2) {}
                    var targets = _collectTargets();
                    var firstChat = targets[0];
                    /* 弹出宿主：fixed 定位浮层，dock 上方居中 */
                    var host = document.createElement('div');
                    host.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:9003;max-height:70vh;overflow:auto;background:rgba(24,26,38,.95);border:1px solid rgba(120,130,160,.4);border-radius:12px;padding:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);';
                    document.body.appendChild(host);
                    dock.__crewHost = host; /* 【v2】登记到 dock，供重复点击切换隐藏 */
                    var closeHost = function () { if (host.__docClose) window.removeEventListener('mousedown', host.__docClose, true); if (host.parentNode) host.parentNode.removeChild(host); dock.__crewHost = null; };
                    /* 点面板外自动关（不含 dock 自己）。
                       【空白点击关闭修复 v2 20261130】原来挂 document 捕获，但总览态
                       app-canvas-overview.js 的 mousedown 捕获处理器先注册先执行，对空白处
                       preventDefault+stopPropagation → _docClose 永远收不到事件 → 空白点击
                       关不掉。改挂 window 捕获（window 早于 document 触发），抢在 stopPropagation 之前。 */
                    setTimeout(function () {
                        var _docClose = function (ev) {
                            var _tt = ev.target;
                            /* 点在面板内或 dock（含其按钮）上：不关 */
                            if (!host.contains(_tt) && !dock.contains(_tt)) { closeHost(); window.removeEventListener('mousedown', _docClose, true); }
                        };
                        window.addEventListener('mousedown', _docClose, true);
                        host.__docClose = _docClose;
                    }, 0);
                    var dispatched = false;
                    var okMount = window.ZFCrewPanel && window.ZFCrewPanel.mountTo
                        ? ZFCrewPanel.mountTo(host, firstChat, { collapsed: false, hideHead: true, onDispatch: function (payload) {
                            dispatched = true;
                            closeHost();
                            /* 混编派发：picks{roleKey:n} × targets 全组合，复用 seq*500 真串行 + roleStatus 登记 */
                            /* 【拖拽排序 v1.1】优先按面板传来的 orderedKeys（用户拖拽排序），兼容旧面板回退 Object.keys */
                            var entries = [];
                            var _rkList = (payload.orderedKeys && payload.orderedKeys.length) ? payload.orderedKeys : Object.keys(payload.picks || {});
                            _rkList.forEach(function (rk) {
                                var n = payload.picks[rk];
                                if (!n) return;
                                var def = null;
                                (window.ZFCrewPanel && ZFCrewPanel.ROLES || []).forEach(function (r) { if (r.key === rk) def = r; });
                                if (!def) return;
                                for (var j = 0; j < n; j++) targets.forEach(function (ch) { entries.push({ def: def, chat: ch, label: def.name }); });
                            });
                            if (!entries.length) return;
                            var _run = function () {
                                var ok = 0, fail = 0, done = 0, seq = 0;
                                entries.forEach(function (en) {
                                    (function (en, delayMs) {
                                        setTimeout(function () {
                                            try {
                                                /* 伪 box 派发（与 dispatchRole 现行做法一致）；施工队走 chat 参数不吃 box */
                                                en.def.fn({ el: en.chat.el }, en.chat, 1);
                                                var prev = en.chat.roleStatus && en.chat.roleStatus.role === en.label ? en.chat.roleStatus : null;
                                                en.chat.roleStatus = { role: en.label, round: (prev ? (prev.round || 0) : 0) + 1, state: '进行中', at: Date.now() };
                                                try { Store.saveChatBox(en.chat); } catch (eS) {}
                                                ok++;
                                            } catch (eD) { fail++; }
                                            done++;
                                            if (done === entries.length) {
                                                try { if (App.toast) App.toast('派出团队混编派发完成：成功 ' + ok + ' 个' + (fail ? '，失败 ' + fail + ' 个' : ''), !fail); } catch (eT) {}
                                                try { render(); } catch (eR) {}
                                            }
                                        }, delayMs);
                                    })(en, seq * 500);
                                    seq++;
                                });
                            };
                            if (entries.length > 5) {
                                /* 复用自绘确认框风格：总数超 5 二次确认 */
                                var ov = document.createElement('div');
                                ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
                                var dlg = document.createElement('div');
                                dlg.style.cssText = 'background:#1c2230;color:#dde5f0;border:1px solid #3a4658;border-radius:10px;padding:18px 22px;box-shadow:0 10px 40px rgba(0,0,0,.5);font:14px/1.6 system-ui;max-width:360px;';
                                dlg.innerHTML = '<div style="margin-bottom:14px;">混编派发共 ' + entries.length + ' 个新窗（' + targets.length + ' 个对话 × 多角色），确认？</div>'
                                    + '<div style="text-align:right;"><button data-c="0" style="padding:6px 18px;margin-right:8px;border-radius:8px;border:1px solid #4a5870;background:transparent;color:#8fa0b8;cursor:pointer;">取消</button>'
                                    + '<button data-c="1" style="padding:6px 18px;border-radius:8px;border:1px solid #4da3ff;background:#2b5fb0;color:#fff;cursor:pointer;">确认</button></div>';
                                ov.appendChild(dlg); document.body.appendChild(ov);
                                ov.addEventListener('click', function (ev) {
                                    var b = ev.target.closest('button'); if (!b) return;
                                    document.body.removeChild(ov);
                                    if (b.dataset.c === '1') _run();
                                });
                            } else _run();
                        } })
                        : null;
                    if (!okMount) {
                        closeHost();
                        try { if (window.Toast) Toast.show('派出团队面板模块未加载（chatbox-crew-panel.js）'); else _dlgAlert('派出团队面板模块未加载'); } catch (e4) {}
                    }
                });
                dock.appendChild(cb);
            })();
            /* 【返回按钮】dock 追加「返回」：退出总览i整理（与 Esc 等价，位置自动写回）。
               创建后先按顺序落位，最终由末尾图标化 v3 段 appendChild 收敛到 dock 最末（最右侧）。 */
            (function () {
                var xb = document.createElement('button');
                xb.className = 'mo-btn mo-arr mo-dock-exit';
                xb.textContent = '返回';
                xb.title = '返回主窗口（退出总览i整理，位置自动写回）';
                xb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    try {
                        if (window.App && typeof window.App.canvasOverviewToggle === 'function') { window.App.canvasOverviewToggle(); return; }
                        if (window.MinimapOrganize && typeof window.MinimapOrganize.close === 'function') { window.MinimapOrganize.close(); }
                    } catch (e1) { try { console.error('[整理dock] 返回失败:', e1); } catch (e2) {} }
                });
                dock.appendChild(xb);
            })();
            /* 【分组操作并入 dock v2 20261121】原右上角图标工具栏（📁建组/✚展开）取消，
               按用户令改为纯文字按钮并入底部 dock 一排（现显示为「建组」「展开」两枚）。
               ⚠ 按钮顺序调整务必同步 buildDock 头部注释。 */
            (function () {
                var gb = document.createElement('button');
                gb.className = 'mo-btn mo-arr mo-dock-group';
                gb.textContent = '建组';
                gb.title = '建分组：把当前框选/点选的对话编为一组（快捷键 G）';
                gb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    try {
                        if (window.ZFCanvasGroups && typeof window.ZFCanvasGroups.create === 'function') { window.ZFCanvasGroups.create(); return; }
                        try { if (window.Toast) Toast.show('分组模块未加载'); } catch (e3) {}
                    } catch (e1) { try { console.error('[整理dock] 建分组失败:', e1); } catch (e2) {} }
                });
                dock.appendChild(gb);
                var eb = document.createElement('button');
                eb.className = 'mo-btn mo-arr mo-dock-expand';
                eb.textContent = '展开';
                eb.title = '展开全部：展开所有折叠的分组卡片';
                eb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    try {
                        if (window.ZFCanvasGroups && typeof window.ZFCanvasGroups.expandAll === 'function') { window.ZFCanvasGroups.expandAll(); return; }
                        try { if (window.Toast) Toast.show('分组模块未加载'); } catch (e3) {}
                    } catch (e1) { try { console.error('[整理dock] 展开全部失败:', e1); } catch (e2) {} }
                });
                dock.appendChild(eb);
            })();
            /* 【新建对话按钮 v1 20261121】dock 追加「新建对话」：直接调 window.QuickCreate.toggle()，
               与双击空白/右键空白/Tab 完全同一入口（app-quick-create.js 的快速创建条）。 */
            (function () {
                var nb = document.createElement('button');
                nb.className = 'mo-btn mo-arr mo-dock-newchat';
                nb.textContent = '新建';
                nb.title = '新建对话：打开快速新建对话面板（与双击空白/右键空白/Tab 相同）';
                nb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    try {
                        if (window.QuickCreate && typeof window.QuickCreate.toggle === 'function') { window.QuickCreate.toggle(); return; }
                        try { if (window.Toast) Toast.show('快速创建模块未加载'); } catch (e3) {}
                    } catch (e1) { try { console.error('[整理dock] 新建对话失败:', e1); } catch (e2) {} }
                });
                dock.appendChild(nb);
            })();
            /* =====【用户令 2026-11-22·图标化 v4】新建最左 + 返回最右 + 大图标纯透明默认态 =====
               · 新建 insertBefore 到 dock 首位；返回 appendChild 到 dock 最末（最右侧）；
               · 每枚 .mo-btn 固定 46×46（防 hover 抖动关键：尺寸恒定 → dock 总宽不变 → 居中平移不发生）；
               · 注入 22×22 线性 SVG 白线图标（stroke:currentColor，带投影保证浅色画布可读）；
               · 默认态：无背景无边框纯图标；
               · hover 态：深黑底（rgba(8,11,18,.85)）+白描边浮现——用户反馈浅蓝底看不清；图标微放大；
               · 文字走 .mo-btn-tip 绝对定位浮层（图标上方黑底白字），完全不进布局流 → 零抖动；
               · !important 压制 theme-paper-fix.css 的 [data-theme="light"] .mo-btn 浅底规则。 */
            (function () {
                var NS = 'http://www.w3.org/2000/svg';
                var ICONS = {
                    'mo-dock-newchat': '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
                    'mo-dock-row1': '<rect x="3" y="9" width="5" height="6" rx="1"/><rect x="9.5" y="9" width="5" height="6" rx="1"/><rect x="16" y="9" width="5" height="6" rx="1"/>',
                    'mo-dock-hide': '<path d="M3 3l18 18"/><path d="M10.6 5.2A9.5 9.5 0 0 1 12 5c7 0 10 7 10 7a17.5 17.5 0 0 1-3.2 4.3M6.2 6.2A16.8 16.8 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
                    'mo-dock-show': '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
                    'mo-dock-crew': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.4 4.4 2.2 5 5.4"/>',
                    'mo-dock-exit': '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
                    'mo-dock-group': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
                    'mo-dock-expand': '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
                    'mo-dock-power': '<path d="M13 2L6 13h5l-1 9 7-12h-5z"/>'
                };
                /* 顺序收敛：新建最左、返回最右（用户令 2026-11-22，与创建顺序解耦） */
                var nc = dock.querySelector('.mo-dock-newchat');
                if (nc && dock.firstChild !== nc) dock.insertBefore(nc, dock.firstChild);
                var xb = dock.querySelector('.mo-dock-exit');
                if (xb && dock.lastChild !== xb) dock.appendChild(xb);
                /* 统一样式：固定尺寸大图标，hover 深黑底 + 图标上方文字浮层（零布局位移） */
                if (!document.getElementById('zf-dock-icon-style')) {
                    var st = document.createElement('style');
                    st.id = 'zf-dock-icon-style';
                    st.textContent =
                        '.mo-canvas-dock .mo-btn{position:relative;display:flex;align-items:center;justify-content:center;width:46px;height:46px;padding:0;background:transparent !important;border:1px solid transparent !important;border-radius:12px;color:rgba(255,255,255,.92) !important;cursor:pointer;overflow:visible;transition:background-color .22s ease,border-color .22s ease,color .22s ease,box-shadow .22s ease,transform .22s cubic-bezier(.22,.61,.36,1);}' +
                        '.mo-canvas-dock .mo-btn svg{width:22px;height:22px;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55));transition:transform .22s cubic-bezier(.34,1.56,.64,1);}' +
                        '.mo-canvas-dock .mo-btn svg *{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}' +
                        '.mo-canvas-dock .mo-btn .mo-btn-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translate(-50%,4px);padding:5px 10px;border-radius:8px;background:rgba(8,10,16,.92) !important;border:1px solid rgba(255,255,255,.18);color:#fff !important;font-size:13px;line-height:1;white-space:nowrap;opacity:0;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.45);transition:opacity .18s ease,transform .22s cubic-bezier(.22,.61,.36,1);}' +
                        '.mo-canvas-dock .mo-btn:hover{background:rgba(8,11,18,.85) !important;border-color:rgba(255,255,255,.25) !important;color:#fff !important;box-shadow:0 6px 18px rgba(0,0,0,.5);}' +
                        '.mo-canvas-dock .mo-btn:hover svg{transform:scale(1.08);}' +
                        '.mo-canvas-dock .mo-btn:hover .mo-btn-tip,.mo-canvas-dock .mo-btn:focus-visible .mo-btn-tip{opacity:1;transform:translate(-50%,0);}' +
                        '.mo-canvas-dock .mo-btn:active{transform:scale(.94);box-shadow:0 2px 8px rgba(0,0,0,.3);}' +
                        /* 【P1-1 省电激活态】蓝底提示当前处于省电（批量隐藏）状态 */
                        '.mo-canvas-dock .mo-btn.mo-power-on{background:rgba(40,110,230,.5) !important;border-color:rgba(120,180,255,.65) !important;}';
                    document.head.appendChild(st);
                }
                /* 逐按钮注入图标 + 文字包浮层 span（已注入过跳过，防 dock 重建后重复） */
                Array.prototype.forEach.call(dock.querySelectorAll('.mo-btn'), function (btn) {
                    if (btn.__iconDone) return;
                    var cls = '';
                    for (var k in ICONS) { if (btn.classList.contains(k)) { cls = k; break; } }
                    if (!cls) return;
                    var svg = document.createElementNS(NS, 'svg');
                    svg.setAttribute('viewBox', '0 0 24 24');
                    svg.setAttribute('aria-hidden', 'true');
                    svg.innerHTML = ICONS[cls];
                    btn.insertBefore(svg, btn.firstChild);
                    /* 裸文字节点移出布局流，包成 span.mo-btn-tip（图标上方悬浮文字） */
                    Array.prototype.slice.call(btn.childNodes).forEach(function (n) {
                        if (n.nodeType === 3 && n.textContent.trim()) {
                            btn.removeChild(n);
                            var sp = document.createElement('span');
                            sp.className = 'mo-btn-tip';
                            sp.textContent = n.textContent.trim();
                            btn.appendChild(sp);
                        }
                    });
                    btn.__iconDone = true;
                });
            })();
            return dock;
        }

        function showDock(v) {
            if (v) {
                buildDock();
                // 【防御】面板 overlay 整树重渲染后 __srcBtn 可能失联，重建 dock 保证引用新鲜
                if (dock && (!dock.isConnected || Array.prototype.some.call(dock.children, function (c) { return c.__srcBtn && !c.__srcBtn.isConnected; }))) {
                    dock.remove(); dock = null; buildDock();
                }
                dock.style.display = 'flex';
            }
            else if (dock) dock.style.display = 'none';
        }

        window.addEventListener('wb-canvas-change', function (e) {
            showDock(!!(e.detail && e.detail.on));
        });

        /* =====【隐藏/显示 v1】样式注入 + 启动恢复（挂在此 IIFE 内，与 dock 同生命周期） ===== */
        (function () {
            /* 1) 注入全局样式（一次性）【现行口径：v3 全模式真隐藏，策划案 20261122 §三#4】：
               · 无限画布普通模式 & i缩略图 & 专注模式 & i缩小整理模式：一律 display:none →
                 彻底移出渲染树，真实提升帧率（下方 v3 注释为准）。
               · 【过时说明，勿照此还原】v1/v2 曾让整理模式「留虚线框」，v3 已取消；
                 「留虚线框占位」语义现在由另一通道 .qn-gone 承担（css/qn-gone-hidden.css，
                 visibility:hidden+content-visibility:hidden+pointer-events:none）。 */
            var st = document.createElement('style');
            st.id = 'zf-chat-hidden-style';
            st.textContent =
                'body:not(.zf-overview-mode) .chatbox.zf-chat-hidden{display:none !important;}' +
                'body.zf-overview-mode .chatbox.zf-chat-hidden{display:none !important;}' +
                /* 【组隐藏联动 v1】折叠/隐藏组的成员：在无限画布普通模式与i导航中同款真隐藏（display:none 跳过渲染 → 真实提帧率），整理模式中留 content-visibility:hidden 虚线框 */
                'body:not(.zf-overview-mode) .chatbox.zf-group-hidden{display:none !important;}' +
                'body.zf-overview-mode .chatbox.zf-group-hidden{display:none !important;}' +
                /* 【v3 整理模式也真隐藏】隐藏对话 display:none 彻底移出渲染树（真实提帧率）；
                   整理模式中的「已隐藏·虚线框」占位提示随之取消——需要恢复时用「显示」按钮/框选恢复，功能不受影响（类名与 localStorage 机制不变）。 */
            document.head.appendChild(st);

            /* 2) 启动/运行期恢复：按 localStorage 的 id 集合给对应 chatbox 补挂 zf-chat-hidden 类。
               节点可能晚于本脚本挂载（异步创建/恢复会话），用低频轮询兜底（5s，低调不抢帧）。 */
            function _readIds() { try { return JSON.parse(localStorage.getItem('zf_chat_hidden_ids') || '[]'); } catch (e) { return []; } }
            function applyHiddenToDom() {
                var ids = _readIds();
                if (!ids.length) return;
                var boxes = document.querySelectorAll('.chatbox');
                for (var i = 0; i < boxes.length; i++) {
                    if (ids.indexOf(boxes[i].id) >= 0 && !boxes[i].classList.contains('zf-chat-hidden')) boxes[i].classList.add('zf-chat-hidden');
                }
            }
            applyHiddenToDom();
            setInterval(applyHiddenToDom, 5000);
            window.addEventListener('zf-chat-hidden-changed', applyHiddenToDom);
            /* 【组隐藏联动 v1】折叠/隐藏组类同步：启动一次+低频轮询兜底（组晚于 chatbox 挂载场景），saveGroups 实时驱动 */
            try { if (typeof _applyGroupHiddenToDom === 'function') { _applyGroupHiddenToDom(); setInterval(_applyGroupHiddenToDom, 5000); } } catch (eG) {}

            /* 3) 防呆：localStorage 里有 id 但画布已无该对话（被关闭）→ 清理孤儿 id */
            setInterval(function () {
                var ids = _readIds();
                if (!ids.length) return;
                var alive = {};
                document.querySelectorAll('.chatbox').forEach(function (el) { alive[el.id] = 1; });
                /* 【策划案 20261123·三种模式积累性修复 #21】以数据层判活：会话恢复是异步的（数据先于 DOM 就绪），
                   只看 DOM 会把「尚未渲染出来」的隐藏对话当成已删除而清掉它的隐藏状态。
                   App.chatBoxes 与已保存记录一并算作存活。 */
                try {
                    ((window.App && App.chatBoxes) || []).forEach(function (b) { if (b && b.id != null) alive[String(b.id)] = 1; });
                    ((typeof Store !== 'undefined' && Store.data && Store.data.chatBoxes) || []).forEach(function (b) { if (b && b.id != null) alive[String(b.id)] = 1; });
                } catch (eA) {}
                var kept = ids.filter(function (i) { return alive[i]; });
                if (kept.length !== ids.length) { try { localStorage.setItem('zf_chat_hidden_ids', JSON.stringify(kept)); } catch (e) {} }
            }, 15000);
        })();
    })();

})();