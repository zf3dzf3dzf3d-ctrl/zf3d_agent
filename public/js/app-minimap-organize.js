// ========== app-minimap-organize.js - 小地图整理模式 ==========
// 放大版小地图：卡片式节点（标题+颜色块），框选/拖拽/分组/Delete 关闭
// 主画布零改动：面板内拖拽 → 同步真实节点 offsetLeft/offsetTop
// 快捷键：点选=单击 | 拖拽=点住卡片 | 框选=空白拖拽 | Shift+框=加选 | Ctrl+框=减选 | Delete=关闭
(function() {
    'use strict';

    var GROUP_KEY = 'zf_minimap_groups';
    // 【小方块化 v1】false=新版固定 260×300 小方块面板（10×10 色块，无文字）；true=回退旧版大卡片模式
    var MO_LEGACY = false;

    // ===== 分组数据：{id, name, color, nodeIds:[]} =====
    var groups = [];
    try { groups = JSON.parse(localStorage.getItem(GROUP_KEY) || '[]'); } catch (e) { groups = []; }
    function saveGroups() {
        try { localStorage.setItem(GROUP_KEY, JSON.stringify(groups)); } catch (e) {}
        if (typeof _gIdxCache !== 'undefined') _gIdxCache = null; // 【自动分组】组变更 → 角标反查缓存失效
        try { document.dispatchEvent(new CustomEvent('zf-minimap-groups-changed')); } catch (e) {} // 【缩略图同步】通知右下角小地图重读分组
    }
    var GROUP_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63'];

    // ===== DOM 创建（一次） =====
    var overlay = null, panel = null, body = null, cvs = null, ctx = null;
    var btnGroup = null, btnUngroup = null, btnRename = null, btnDissolve = null;
    var namePop = null, nameInput = null;
    var active = false;
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
                    '<span class="mo-title">整理模式</span>' +
                    '<button class="mo-btn" id="moGroupBtn">建组</button>' +
                    '<button class="mo-btn" id="moRenameBtn">重命名</button>' +
                    '<button class="mo-btn" id="moDissolveBtn">解散</button>' +
                    '<button class="mo-btn" id="moAutoBtn" title="按项目标题自动聚类分组：同前缀的对话框归为一组（跳过手动组，落单不入组；可重复点击重算）">⚡自动分组</button>' +
                    '<button class="mo-btn" id="moAutoUndoBtn" title="撤销所有自动分组（手动组不受影响）">撤销自动</button>' +
                    '<span class="mo-sep"></span>' +
                    '<button class="mo-btn mo-arr" data-rows="1" title="所选（未选中则全部）卡片排成 1 个横排，卡片最多按 500px 计宽，间距 80px">1排</button>' +
                    '<button class="mo-btn mo-arr" data-rows="2" title="自动排成 2 个横排，卡片最多按 500px 计宽，间距 80px">2排</button>' +
                    '<button class="mo-btn mo-arr" data-rows="3" title="自动排成 3 个横排，卡片最多按 500px 计宽，间距 80px">3排</button>' +


                    '<button class="mo-close-x" id="moCloseXBtn" title="退出整理模式">×</button>' +
                '</div>' +
                '<div class="mo-body"><canvas class="mo-canvas"></canvas></div>' +
                '<div class="mo-hintbar"><span class="mo-hint">点选 | 拖拽移动 | 滚轮缩放(鼠标中心) | 中键拖动平移 | Shift+滚轮平移 | 空白框选 | Shift加选 | Ctrl减选 | 1~3排=自动排列 | Delete关闭</span></div>' +
                '<div class="mo-rz" data-dir="n"></div><div class="mo-rz" data-dir="s"></div>' +
                '<div class="mo-rz" data-dir="e"></div><div class="mo-rz" data-dir="w"></div>' +
                '<div class="mo-rz mo-rz-se" data-dir="se" title="拖拽调整面板大小"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        panel = overlay.querySelector('.mo-panel');
        body = overlay.querySelector('.mo-body');
        cvs = overlay.querySelector('.mo-canvas');
        ctx = cvs.getContext('2d');
        _gradCache = {};   // 【修复】渐变对象绑定创建时的 context，canvas 重建后旧渐变静默失效，重建时必须清空缓存
        btnGroup = overlay.querySelector('#moGroupBtn');
        btnRename = overlay.querySelector('#moRenameBtn');
        btnDissolve = overlay.querySelector('#moDissolveBtn');
        // 排列按钮：1排/2排/3排/4排 自动横排
        Array.prototype.forEach.call(overlay.querySelectorAll('.mo-arr'), function(b) {
            b.addEventListener('click', function() { arrangeRows(parseInt(b.dataset.rows, 10) || 1); });
        });
        var closeBtn = overlay.querySelector('#moCloseXBtn'); // 【退出按钮已删】只保留右上角 ×，残留的 #moCloseBtn 绑定会因 null 抛错导致后续按钮全部失效
        if (closeBtn) closeBtn.addEventListener('click', function() { close(); });
        btnGroup.addEventListener('click', function() { createGroupFromSelection(); });
        btnRename.addEventListener('click', function() { renameSelectedGroup(); });
        btnDissolve.addEventListener('click', function() { dissolveSelectedGroup(); });
        overlay.querySelector('#moAutoBtn').addEventListener('click', function() { autoGroupByProject(); });
        overlay.querySelector('#moAutoUndoBtn').addEventListener('click', function() { undoAutoGroups(); });

        // 命名弹窗
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
            if (b) { e.preventDefault(); blFocus(b); }
        });
        cvs.addEventListener('contextmenu', function(e) {
            if (MO_LEGACY) return;
            e.preventDefault();
            blMenu(e);
        });
        try { overlay.querySelector('.mo-panel').classList.add('mo-small'); } catch (e) {}
        window.addEventListener('keydown', onKey);
        window.addEventListener('resize', function() { if (active) render(); });

        // ========== 【浮动窗口化 v1】拖拽 + 缩放 + 位置尺寸记忆 ==========
        try {
            var _toolbar = overlay.querySelector('.mo-toolbar');
            var WIN_KEY = 'zf_organize_win';
            var MIN_W = 420, MIN_H = 280;

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
                var w = Math.max(MIN_W, Math.min(panel.offsetWidth, vw - 20));
                var h = Math.max(MIN_H, Math.min(panel.offsetHeight, vh - 20));
                var l = Math.max(20 - w, Math.min(panel.offsetLeft, vw - 60)); // 至少留 60px 可抓回
                var t = Math.max(0, Math.min(panel.offsetTop, vh - 40));
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
                    panel.style.left = (_winDrag.l + dx) + 'px';
                    panel.style.top = Math.max(0, _winDrag.t + dy) + 'px';
                } else {
                    // 外框缩放：按方向调整 left/top/width/height
                    var l = _winDrag.l, t = _winDrag.t, w = _winDrag.w, h = _winDrag.h;
                    if (d.indexOf('e') >= 0) w = _winDrag.w + dx;
                    if (d.indexOf('s') >= 0) h = _winDrag.h + dy;
                    if (d.indexOf('w') >= 0) { w = _winDrag.w - dx; l = _winDrag.l + dx; }
                    if (d.indexOf('n') >= 0) { h = _winDrag.h - dy; t = _winDrag.t + dy; }
                    if (w < MIN_W) { if (d.indexOf('w') >= 0) l = _winDrag.l + (_winDrag.w - MIN_W); w = MIN_W; }
                    if (h < MIN_H) { if (d.indexOf('n') >= 0) t = _winDrag.t + (_winDrag.h - MIN_H); h = MIN_H; }
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
        namePop.style.left = (r.left + r.width / 2 - 110) + 'px';
        namePop.style.top = (r.top + 48) + 'px';
        setTimeout(function() { nameInput.focus(); }, 30);
        _pendingConfirm = cb;
    }
    var _pendingConfirm = null;
    function hideNamePop() {
        namePop.classList.remove('active');
        _editingGroup = null;
        _pendingConfirm = null;
    }

    // ===== 收集节点（与 app-minimap.js 同源，直接复用其收集结果更稳） =====
    function collectBoxes() {
        boxes = [];
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
                if (!_ic && el) {
                    var avEl = el.querySelector('#chat-role-avatar, .chat-role-avatar');
                    if (avEl) _ic = (avEl.textContent || '').trim();
                }
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

    var GROUP_PAD = 14;
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
                var ang2 = Math.atan2(ey - sy, ex - sx), hl2 = 6;
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
            var ang = Math.atan2(ey - sy, ex - sx), hl = 6;
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
    var _blMenu = null;
    function blMenu(e) {
        // 右键原生菜单：面板打开期间恢复浏览器默认（guardUnderlay 只拦 mouse 系，不拦 contextmenu）
        if (_blMenu) { document.body.removeChild(_blMenu); _blMenu = null; }
        var b = blHit(e);
        var menu = document.createElement('div');
        menu.className = 'mo-ctx-menu';
        var items = [];
        if (b) {
            items.push({ label: '📍 定位到主画布', fn: function() { blFocus(b); } });
            items.push({ label: selected.has(b.el) ? '取消选中' : '选中', fn: function() {
                if (selected.has(b.el)) selected.delete(b.el); else { selected.clear(); selected.add(b.el); }
                updateToolbar(); render();
            } });
        }
        if (selected.size > 0) {
            items.push({ label: '建组 (' + selected.size + ')', fn: function() { createGroupFromSelection(); } });
            var g = selectedGroup();
            if (g) items.push({ label: '解散「' + g.name + '」', fn: function() { dissolveSelectedGroup(); } });
        }
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
    function _renderBlocksNow() {
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
        // 【方块过小修复】记录打开后的基准 fit 比例，方块尺寸以此为锚，
        // 不再随布局摊开而塌缩到 4px 下限（那是"方块非常小 + 框选失效"的共同根因）
        // 【锚点修正 v2】锚点只在面板打开时重置（open() 置 0），此处仅懒初始化。
        // 不能比 view 引用——computeView() 每帧新建对象，引用比较恒真会导致锚点
        // 每帧被重置、_k 恒为 1，缩放跟随失效（审核员备注①）
        if (!_blS0) _blS0 = view.s || 0.05;
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
            if (!off) {
                blRects.push(r);
            }
            boxRects.push({ x: b.x, y: b.y, w: b.w, h: b.h, b: b }); // 【连线修复】off 卡片也进 boxRects，保证连线端点不缺（仅绘制被剔除）
        });
        var C = {
            card: themeVar('--bg-card', '#1e1e2e'),
            border: themeVar('--border', 'rgba(255,255,255,0.16)')
        };
        // 组框（虚线包围所选成员的映射方块）
        groups.forEach(function(g) {
            var ms = blRects.filter(function(r) { return g.nodeIds.indexOf(r.b.el.dataset.moId) >= 0; });
            if (!ms.length) return;
            var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            ms.forEach(function(r) { if (r.x < x0) x0 = r.x; if (r.y < y0) y0 = r.y; if (r.x + r.w > x1) x1 = r.x + r.w; if (r.y + r.h > y1) y1 = r.y + r.h; });
            ctx.save();
            ctx.fillStyle = hexToRgba(g.color, 0.07);
            ctx.strokeStyle = hexToRgba(g.color, 0.85);
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            roundRect(x0 - 8, y0 - 8, x1 - x0 + 16, y1 - y0 + 16, 8);
            ctx.fill(); ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = g.color;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(g.name, x0 - 6, y0 - 12);
            ctx.restore();
        });
        // 关系连线（策划/审核状态箭头 + 多角色父子橙金线），按映射坐标绘制
        // 【层级修复】线垫在方块下、文字盖在方块上：两阶段绘制（lines → 方块 → labels）
        drawPairArrows(w2m, view, 'lines');
        // 方块（映射位置，中心=真实卡片中心）
        blRects.forEach(function(r) {
            var b = r.b;
            var isSel = selected.has(b.el);
            var isHov = (hoverBox === b);
            var col = b.color || C.card;
            ctx.fillStyle = hexToRgba(col, isSel ? 0.95 : (isHov ? 0.75 : 0.45));
            roundRect(r.x, r.y, r.w, r.h, 6);
            ctx.fill();
            ctx.lineWidth = isSel ? 2 : 1;
            ctx.strokeStyle = isSel ? col : (isHov ? hexToRgba(col, 0.9) : C.border);
            roundRect(r.x, r.y, r.w, r.h, 6);
            ctx.stroke();
            // 【自动分组角标】方块内画组名前4字（白色带描边），小于 6x5px 的方块不画防糊
            var _mog = groupBoxOfByIdOf(b);
            if (_mog && r.w >= 6 && r.h >= 5) {
                ctx.save();
                // 【4字角标】字号随方块缩放（8~14px），小方块也尽量显示项目名前4字
                var _fs = Math.max(7, Math.min(14, Math.min(r.w / 4, r.h) * 0.9));
                ctx.font = 'bold ' + _fs.toFixed(1) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                var _tag = String(_mog.name || '').replace(/^auto-?/, '').slice(0, 4);
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.strokeText(_tag, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
                ctx.fillStyle = '#fff';
                ctx.fillText(_tag, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
                ctx.restore();
            }
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
        // 【诊断升级】rAF 回调的 console.trace 只有 _renderNow 自己，定位不到来源。
        //   改在 render() 入口记录调用者堆栈（跳过 render 自身两帧），熔断时打印统计。
        try {
            var st = new Error().stack || '';
            var lines = st.split('\n').filter(function(l){ return l.indexOf('render @') === -1 && l.indexOf('render (') === -1 && l.trim() !== 'Error'; });
            var caller = (lines[1] || '').trim().slice(0, 120) || 'unknown';
            // 【审核备注①】若调用方是 rAF/匿名回调，首帧可能是 _renderNow/anonymous，
            //   辨识度有限 → 追加记录 stack 第 2~3 行一起统计，便于精确定位。
            var caller2 = (lines[2] || '').trim().slice(0, 120);
            var caller3 = (lines[3] || '').trim().slice(0, 120);
            if (caller2 && caller.indexOf('_renderNow') !== -1) caller += ' ← ' + caller2;
            else if (caller2 && /anonymous|^at /.test(caller)) caller += ' ← ' + caller2;
            if (caller3 && caller2 && /anonymous/.test(caller2)) caller += ' ← ' + caller3;
            _callers[caller] = (_callers[caller] || 0) + 1;
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
        var _interacting = (mode === 'drag' || mode === 'marquee' || mode === 'pan');
        if (_fuseLockUntil > now && !_interacting) return;
        // 【拖拽掉块修复】拖拽/框选/平移是真实用户交互帧，不计入保险丝（否则高频
        //   mousemove 渲染被误熔断 → 画面停帧，表现为"方块不动/选择态消失/按住左键掉"）
        if (now - _fuseTs > 1000) { _fuseCount = 0; _fuseTs = now; }
        if (!_interacting) _fuseCount++;
        if (_fuseCount > 28 && !_interacting) {
            _fuseTrips++;
            _fuseLockUntil = now + 1500;
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
            card: themeVar('--bg-card', '#1e1e2e'),
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
            // 组名标签（胶囊 chip）：缩得太小（组框显示尺寸不足）时隐藏文字
            if (gb.w * view.s >= 48 && gb.h * view.s >= 24) {
            ctx.font = 'bold 11px sans-serif';
            var tw = ctx.measureText(g.name).width;
            ctx.fillStyle = g.color;
            roundRect(p.x, p.y - 17, tw + 16, 17, 8); ctx.fill();
            ctx.fillStyle = '#111';
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(g.name, p.x + 8, p.y - 5);
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
            boxRects.push({ x: b.x, y: b.y, w: b.w, h: b.h, b: b }); // 【连线修复】off 卡片也进 boxRects，保证连线端点不缺（仅绘制被剔除）
            if (off) return;
            // 【放大卡顿修复】超大卡片降级：单卡面积超 350 万像素²（≈全屏 3 张）时
            // 去掉阴影/渐变/正文，只画色块+边框，绘制成本与面积脱钩
            var huge = (bw * bh > 3500000);
            var isSel = selected.has(b.el);
            var isHov = (hoverBox === b);
            var col = b.color || C.blue;
            var HH = 19;                        // 标题栏高（对应 chatbox 头部）
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
            var _gk = bw + '|' + col;
            var hg = _gradCache['h' + _gk];
            if (!hg) {
                hg = ctx.createLinearGradient(0, 0, bw, 0);
                hg.addColorStop(0, hexToRgba(col, 0.95));
                hg.addColorStop(1, hexToRgba(col, 0.45));
                _gradCache['h' + _gk] = hg;
            }
            // 渐变按相对坐标缓存，用 translate 对齐到卡片位置（平移/缩放不失效）
            ctx.save();
            ctx.translate(p.x, 0);
            // 【修复】正文先铺不透明底色，保证 100% 填充（玻璃渐变是半透明的，网格会透出）
            var bodyH = Math.max(0, bh - HH);
            ctx.fillStyle = C.card;
            ctx.fillRect(0, cy + HH, bw, bodyH);
            ctx.fillStyle = hg;
            ctx.fillRect(0, cy, bw, Math.min(HH, bh));
            // 玻璃质感：正文上亮下暗（仅当正文有高度时画，防 bh<HH 负高度反向绘制/负 key 缓存污染）
            if (bodyH > 0) {
                var gg = _gradCache['v' + bodyH];
                if (!gg) {
                    gg = ctx.createLinearGradient(0, 0, 0, bodyH);
                    gg.addColorStop(0, 'rgba(255,255,255,0.06)');
                    gg.addColorStop(1, 'rgba(0,0,0,0.16)');
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
                // 角色图标未获取到 → 用整体 UI 主题色画头像徽标兜底（主题自适应）
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
            ctx.font = 'bold 11px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
            var tMax = (p.x + bw - 22) - tx;
            var ttl = ttlFull;
            if (ctx.measureText(ttl).width > tMax) {
                var tc = ttl.length;
                while (tc > 1 && ctx.measureText(ttlFull.slice(0, tc) + '…').width > tMax) tc--;
                ttl = ttlFull.slice(0, tc) + '…';
            }
            ctx.fillStyle = themeVar('--text', '#ffffff');
            ctx.fillText(ttl, tx, ty + 0.5);
            // 右上状态点（呼应 chatbox 标题徽标）
            ctx.beginPath();
            ctx.arc(p.x + bw - 9, ty, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fill();
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
            ctx.lineWidth = isSel ? 2 : 1;
            ctx.strokeStyle = isSel ? hexToRgba(col, 0.95) : (isHov ? hexToRgba(col, 0.7) : themeVar('--border', 'rgba(255,255,255,0.16)'));
            roundRect(p.x, cy, bw, bh, 8); ctx.stroke();
            if (isSel) {
                ctx.save();
                ctx.globalAlpha = 0.35;
                ctx.lineWidth = 1;
                roundRect(p.x - 3, cy - 3, bw + 6, bh + 6, 11); ctx.stroke();
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
    function _applyDragFrame() {
        _dragFrame = null;
        if (mode !== 'drag' || !_lastDragPos) return;
        if (!MO_LEGACY) {
            // 【位置映射 v2】拖拽=按面板位移换算真实坐标增量，只更新面板数据 boxes.x/y；
            // 真实 DOM 完全不动，等关闭面板时 commitPendingToReal() 一次性写回
            var wdx2 = _lastDragPos.x / view.s, wdy2 = _lastDragPos.y / view.s;
            // 【父子不跟随 v8】应用户决定：整理面板内拖父亲不再带动子对象
            // （面板内仅移动被拖卡片本身；真实画布落地也不再触发 panelMoved 子树平移），
            // 彻底消除「子卡片被双选 → 落地双倍位移」的隐患。主画布上的父子跟随不受影响。
            dragOrigin.forEach(function(d) {
                var ob = boxes.find(function(bb) { return bb.el === d.el; });
                if (ob) { ob.x = d.x + wdx2; ob.y = d.y + wdy2; ob._moved = true; }
            });
            _lastDragPos = null;
            render();
            return;
        }
        var wdx = _lastDragPos.x / view.s, wdy = _lastDragPos.y / view.s;
        dragOrigin.forEach(function(d) {
            var nx = Math.round(d.x + wdx), ny = Math.round(d.y + wdy);
            var ob = boxes.find(function(bb) { return bb.el === d.el; });
            if (ob) { ob.x = nx; ob.y = ny; ob._pendingCommit = { dx: nx - d.x, dy: ny - d.y }; }
        });
        _lastDragPos = null;
        render();
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
            if (hb !== hoverBox) { hoverBox = hb; render(); }
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
        var rect = cvs.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var uv = ensureUserView();
        if (!MO_LEGACY) {
            // 【位置映射 v2】滚轮=缩放 userView（以鼠标为中心）；Shift+滚轮=平移（与旧版共用同一视图体系）
        }
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
                // 移除已关闭卡片的选中态并刷新
                collectBoxes();
                selected.clear();
                updateToolbar();
                render();
            }
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
        var g = selectedGroup();
        btnGroup.disabled = selected.size === 0;
        btnRename.disabled = !g;
        btnDissolve.disabled = !g;
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
        try { _applyWinRect && _applyWinRect(); } catch (e) {} // 【位置记忆修复】面板可见后再应用记忆位置尺寸（隐藏时 offset 全为 0 会被钳制成 0）
        try { document.body.classList.add('zf-org-mode'); } catch (e) {} // 【v3】全局 Observer 兜底标记
        // 【5.3.1 修订】左上角不再显示项目名，固定显示"整理模式"
        try {
            var _moTitle = overlay.querySelector('.mo-title');
            if (_moTitle) _moTitle.textContent = '整理模式';
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
        /* 【迁移中门禁 v2】写回期间挂起守恒模块采集/校正，防止把写回中间态写成偏移基准
           （否则外部平移触发校正时子窗被按污染基准拉远 → 「确认后平移一点子对话飞远」） */
        try { if (window.ZFRelativeRestore && ZFRelativeRestore.beginMigration) ZFRelativeRestore.beginMigration(); } catch (e) {}
        commitPendingToReal(); // 【位置映射 v2】关闭面板才把面板内整理的最终位置一次性写回真实对话框
        /* 【门禁释放】挂在写回完成后的 setTimeout 回调（写回含父子子树跟随+小地图刷新，
           异步分批）：释放时按最终真实位置重算守恒偏移基准并落库 */
        setTimeout(function () {
          try { if (window.ZFRelativeRestore && ZFRelativeRestore.endMigration) ZFRelativeRestore.endMigration(); } catch (e) {}
        }, 300);
        setCursorForState('default');
        overlay.classList.remove('active');
        setDockDot();
        hideNamePop();
        // 通知主画布刷新小地图
        if (window.App && App.updateMinimap) setTimeout(function() { App.updateMinimap(); }, 50);
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
        }
    };

    // 【v3·新增·全局兜底】外部 MutationObserver 全局遵守静默罩：
    //   整理模式打开期间，页面其他模块若监听 style/attribute 变化并触发回流，
    //   在整理面板高频渲染时会形成"渲染→回流→渲染"反馈风暴 → CPU 100%。
    //   此处在 open/close 时切换 body 的 zf-org-mode 标记，供各模块在回调开头
    //   检查并跳过重活（与 zf-org-rendering 静默罩配套，双标记双保险）。
    //   供各模块在回调开头检查并跳过重活（与 zf-org-rendering 静默罩配套，双标记双保险）。
    (function _globalObserverCompat() {
        if (window.__zfOrgCompatInstalled) return;
        window.__zfOrgCompatInstalled = true;
        // 帮助其他模块判断：整理模式是否激活（暴露只读接口）
        try {
            Object.defineProperty(window.MinimapOrganize, 'isRendering', {
                get: function() {
                    return document.body.classList.contains('zf-org-rendering') ||
                           document.body.classList.contains('zf-org-mode');
                },
                configurable: true
            });
        } catch (e) {}
    })();
})();
