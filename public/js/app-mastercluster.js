// ========== app-mastercluster.js - 🧙 大师集群（下拉集合） ==========
// 功能：把原对话框头部第一排的 4 个大师图标收进一个下拉按钮：
//   📊 日志大师 / 🧠 上下文大师 / 🧙 工具大师 / 🎓 导师点评 / 🧩 对话综合大师
// 位置：header 第一排 · 关闭 ✕ 按钮左侧。旧独立图标自动移除、注入函数转为空操作。
(function () {
    'use strict';

    var ITEMS = [
        { icon: '📊', label: '日志大师', cls: 'mc-logmaster', title: '打包日志统计+全部错误日志发送给 AI，检查有没有问题/bug 并优化' },
        { icon: '🧠', label: '上下文大师', cls: 'mc-contextmaster', title: '把最后一次发送给 AI 的完整上下文发给 AI，找出不合理/bug 的地方并修复' },
        { icon: '🧙', label: '工具大师', cls: 'mc-toolmaster', title: '打包本对话全部工具结果/统计/上下文占用/错误，发送到新对话进行 bug 分析' },
        { icon: '🎓', label: '导师点评', cls: 'mc-mentor', title: '把本对话全部内容发给新对话的导师 AI 评论任务处理情况、找 bug' },
        { icon: '🧩', label: '对话综合大师', cls: 'mc-synthmaster', title: '一次性打包工具执行过程+日志+完整上下文+对话历史，发到新对话综合评判：工具是否合理、上下文是否合理、对话有无问题、智能体整体 bug 和水平' },
        { icon: '🔗', label: '对话接力大师', cls: 'mc-relaymaster', title: '把问答清单发给新对话，并附上最后一个问题的完整工具结果，让 AI 接着最后的任务继续做（旧轮次工具结果丢弃）' },
        { icon: '🧹', label: '文件资源管理师', cls: 'mc-filemaster', title: '项目文件体检：垃圾文件扫描、bak 收容、陈旧 bak 清理（二次确认）、git 卫生检查' },
        { icon: '🧬', label: '记忆大师', cls: 'mc-memmaster', title: '跨版本记忆导入：自动探测兄弟版本目录的记忆库，保守导入（永不覆盖/删除，重名改名保留），导入前后各打一次 git 快照' },
        { icon: '🕶️', label: '无痕模式', cls: 'mc-incognitomaster', title: '无痕模式：开启后本对话所有内容不写入记忆/数据库，关闭页面即全部丢失' }
    ];

    // ---------- 下拉菜单显隐 ----------
    function closeAllMenus(except) {
        document.querySelectorAll('.mc-menu').forEach(function (m) {
            if (m !== except) { m.style.display = 'none'; }
        });
    }

    // 滚动/窗口变化时关闭所有菜单（fixed 定位不跟随 header）
    window.addEventListener('resize', function () { closeAllMenus(null); });
    window.addEventListener('scroll', function () { closeAllMenus(null); }, true);

    document.addEventListener('click', function (e) {
        if (!e.target.closest || (!e.target.closest('.mc-toggle') && !e.target.closest('.mc-menu'))) {
            closeAllMenus(null);
        }
    }, true);

    function buildMenu(box, btn) {
        var menu = document.createElement('div');
        menu.className = 'mc-menu';
        menu.style.display = 'none';
        menu.style.cssText += ';position:absolute;z-index:99999;min-width:190px;background:#1e2430;border:1px solid #3a4356;' +
            'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:4px;font-size:13px;color:#dfe5ef;';

        ITEMS.forEach(function (it) {
            var item = document.createElement('div');
            item.className = 'mc-item ' + it.cls;
            item.textContent = it.icon + ' ' + it.label;
            item.title = it.title;
            if (it.cls === 'mc-incognitomaster') {
                var incDot = document.createElement('span');
                incDot.className = 'mc-inc-dot';
                incDot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#4a5568;margin-left:auto;flex-shrink:0;';
                item.appendChild(incDot);
                item._incDot = incDot;
                try {
                    var _c = (App.chatBoxes || []).find(function (c) { return c && c.el === box; });
                    var _cid = _c ? _c.id : (box && box.id ? box.id.replace(/^chatbox-/, '') : null);
                    if (_cid && window.IncognitoMaster && IncognitoMaster.isIncognito(_cid)) incDot.style.background = '#2ecc71';
                } catch (e) {}
            }
            item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;';
            item.addEventListener('mouseenter', function () { item.style.background = '#2c3444'; });
            item.addEventListener('mouseleave', function () { item.style.background = 'transparent'; });
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                closeAllMenus(null);
                try {
                    if (it.cls === 'mc-logmaster') App.logMaster(box);
                    else if (it.cls === 'mc-filemaster') { if (typeof App.fileMaster === 'function') App.fileMaster(box); else if (App._logMasterToast) App._logMasterToast('文件资源管理师脚本未加载'); }
                    else if (it.cls === 'mc-memmaster') { if (typeof App.memoryImportMaster === 'function') App.memoryImportMaster(box); else if (App._logMasterToast) App._logMasterToast('记忆大师脚本未加载'); }
                    else if (it.cls === 'mc-contextmaster') App.contextMaster(box);
                    else if (it.cls === 'mc-toolmaster') App.toolMaster(box);
                    else if (it.cls === 'mc-synthmaster') App.synthMaster(box);
                    else if (it.cls === 'mc-relaymaster') App.relayMaster(box);
                    else if (it.cls === 'mc-incognitomaster') {
                        var _on = (window.IncognitoMaster && IncognitoMaster.toggle(box)) || false;
                        var _chat = (App.chatBoxes || []).find(function (c) { return c && c.el === box; });
                        var _cid = _chat ? _chat.id : (box && box.id ? box.id.replace(/^chatbox-/, '') : null);
                        if (_cid && window.IncognitoMaster) { /* toggle 已按 box.id 处理 */ }
                        var _toast = (App._logMasterToast || function (m) { console.log(m); });
                        if (item._incDot) item._incDot.style.background = _on ? '#2ecc71' : '#4a5568';
                        _toast(_on ? '🕶️ 已进入无痕模式：本对话内容不再写入记忆，关闭页面即丢失' : '已退出无痕模式，恢复记忆写入');
                    }
                    else if (it.cls === 'mc-mentor') {
                        var chat = (App.chatBoxes || []).find(function (c) { return c && c.el === box; });
                        if (chat && typeof App._mentorReviewChat === 'function') App._mentorReviewChat(chat);
                        else if (App._logMasterToast) App._logMasterToast('未找到该对话，无法发起导师点评');
                    }
                } catch (err) {
                    console.error('[MasterCluster]', err);
                }
            });
            menu.appendChild(item);
        });
        return menu;
    }

    // ---------- 注入「大师集群」按钮 ----------
    function injectMasterCluster(box) {
        if (!box) return;

        // 【性能修复】必须先查重再创建！旧逻辑每次都先 buildMenu 挂到 body、末尾才查重，
        // 而 MutationObserver 每条消息渲染都触发 injectAll → body 上堆积数千个孤儿 .mc-menu。
        var _oldBtn = box.querySelector('.mastercluster-btn');
        if (_oldBtn && _oldBtn._menu && _oldBtn._menu.isConnected) return; // 已注入且菜单健在，直接跳过
        if (_oldBtn) { try { _oldBtn.remove(); } catch (e) {} }            // 按钮在但菜单已丢，重建

        var btn = document.createElement('button');
        btn.className = 'hd-btn mastercluster-btn master-icon mc-toggle';
        btn.title = '大师集群：日志大师 / 上下文大师 / 工具大师 / 导师点评 / 对话综合大师';
        btn.textContent = '🧙 ▾';
        btn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;';

        // 菜单挂到 body，fixed 定位，避免被 overflow:hidden 裁剪
        var menu = buildMenu(box, btn);
        btn._menu = menu; // 反向引用，供查重与孤儿清扫
        menu.style.position = 'fixed';
        menu.style.display = 'none';
        document.body.appendChild(menu);
        // 打开时按按钮实际位置摆放（在底部配置行 → 向上弹出）
        function placeMenu() {
            // 菜单隐藏时 offsetHeight/offsetWidth 为 0，先临时显示以便测量
            var wasHidden = (menu.style.display === 'none');
            if (wasHidden) { menu.style.visibility = 'hidden'; menu.style.display = 'block'; }
            var r = btn.getBoundingClientRect();
            var mh = menu.offsetHeight || 200;
            var mw = menu.offsetWidth || 190;
            var margin = 8;
            var top;
            // 优先在按钮上方打开；若上方放不下而下方放得下，则改在下方打开
            if (r.top - mh - 6 < margin && (window.innerHeight - r.bottom) > (mh + 6)) {
                top = r.bottom + 6;
            } else {
                top = r.top - mh - 6;
            }
            // 钳制在视口内，绝不允许超出屏幕（顶部/底部各留 8px）
            if (top < margin) top = margin;
            if (top + mh > window.innerHeight - margin) top = window.innerHeight - margin - mh;
            if (top < margin) top = margin; // 菜单比视口还高时兜底贴顶
            menu.style.top = top + 'px';
            var MC_OFFSET_X = 30; // 菜单整体向右偏移像素
            var left = r.right - menu.offsetWidth + MC_OFFSET_X;
            if (left < margin) left = margin;
            if (left + mw > window.innerWidth - margin) left = window.innerWidth - margin - mw;
            menu.style.right = 'auto';
            menu.style.left = left + 'px';
            if (wasHidden) { menu.style.display = 'none'; menu.style.visibility = ''; }
        }
        btn._placeMenu = placeMenu;

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            var open = menu.style.display !== 'none';
            closeAllMenus(menu);
            if (open) {
                menu.style.display = 'none';
            } else {
                placeMenu();
                menu.style.display = 'block';
            }
        });

        // … 🧙 ▾（集群按钮插在底部「选择大模型」按钮左侧）
        if (box.querySelector('.mastercluster-btn')) return;
        var anchor = box.querySelector('.model-picker-wrap')
            || box.querySelector('.model-select')
            || box.querySelector('.chatbox-cfg-row')
            || box.querySelector('.chatbox-input-row');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(btn, anchor);
        } else if (typeof box.appendChild === 'function') {
            box.appendChild(btn);
        }
    }

    // ---------- 旧注入函数转空操作（防止日志大师/工具大师再往 header 塞独立图标） ----------
    function neutralize() {
        try { if (typeof App.injectLogMasterButtons === 'function') App.injectLogMasterButtons = function () {}; } catch (e) {}
        try { if (typeof App.injectToolMasterButton === 'function') App.injectToolMasterButton = function () {}; } catch (e) {}
        // 【清扫】移除历史上已被注入的独立大师图标（大师集群已接管入口）
        try {
            document.querySelectorAll('.chatbox .toolmaster-btn, .chatbox .logmaster-btn, .chatbox .contextmaster-btn').forEach(function (b) { try { b.remove(); } catch (e) {} });
        } catch (e) {}
    }

    // ---------- 入口 ----------
    // 【性能修复】清扫历史泄漏的孤儿菜单：body 上不属于任何存活按钮的 .mc-menu 全部移除
    function sweepOrphanMenus() {
        var live = new Set();
        document.querySelectorAll('.mastercluster-btn').forEach(function (b) {
            if (b._menu) live.add(b._menu);
        });
        Array.prototype.forEach.call(document.body.children, function (m) {
            if (m.classList && m.classList.contains('mc-menu') && !live.has(m)) m.remove();
        });
    }

    function injectAll() {
        neutralize();
        sweepOrphanMenus();
        document.querySelectorAll('.chatbox').forEach(injectMasterCluster);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectAll);
    } else {
        setTimeout(injectAll, 0);
    }

    // 动态新建/恢复的对话框：MutationObserver 兜底注入
    try {
        var mo = new MutationObserver(function () { injectAll(); });
        var root = document.getElementById('canvasContent') || document.getElementById('canvasArea') || document.body;
        mo.observe(root, { childList: true, subtree: true });
    } catch (e) {}

    // 兜底：钩住 createChatBox
    try {
        var orig = App.createChatBox;
        if (typeof orig === 'function') {
            App.createChatBox = function () {
                var b = orig.apply(this, arguments);
                try { neutralize(); injectMasterCluster(b); } catch (e) {}
                return b;
            };
        }
    } catch (e) {}

    App._injectMasterCluster = injectMasterCluster;

    // ==================================================================
    // 🧬 记忆大师：跨版本记忆导入向导（candidates → scan 预览 → run 导入）
    // ==================================================================
    App.memoryImportMaster = function () {
        var toast = App._logMasterToast || function (m) { alert(m); };
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
        var dlg = document.createElement('div');
        dlg.style.cssText = 'width:560px;max-width:92vw;max-height:80vh;overflow:auto;background:#1e2430;border:1px solid #3a4356;border-radius:10px;padding:18px;color:#dfe5ef;font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.6);';
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        function html(t) { dlg.innerHTML = t; }
        function post(url, body) {
            return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
                .then(function (r) { return r.json(); });
        }

        // 第 1 步：候选列表
        function stepCandidates() {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🧬 记忆大师 · 跨版本记忆导入</div><div>正在探测兄弟版本目录的记忆库…</div>');
            post('/api/memory/import/candidates').then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">探测失败：' + esc(res.err || '未知错误') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'); bindClose(); return; }
                if (!res.candidates.length) {
                    html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🧬 记忆大师</div>' +
                        '<div>未检测到含记忆库（private/记忆/）的兄弟版本目录。<br>当前版本：' + esc(res.current) + '</div><br>' +
                        '<button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>');
                    bindClose(); return;
                }
                var rows = res.candidates.map(function (c, i) {
                    var d = new Date(c.mtime * 1000);
                    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #3a4356;border-radius:6px;margin-bottom:6px;">' +
                        '<input type="radio" name="mi-src" value="' + esc(c.dir) + '"' + (i === 0 ? ' checked' : '') + ' style="cursor:pointer;">' +
                        '<div style="flex:1;"><b>' + esc(c.name) + '</b><br><span style="color:#8b95a7;font-size:12px;">' + c.count + ' 个记忆文件 · ' + d.toLocaleString() + '</span></div></div>';
                }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:4px;">🧬 记忆大师 · 选择来源版本</div>' +
                    '<div style="color:#8b95a7;margin-bottom:10px;">当前版本：' + esc(res.current) + ' · 导入策略：保守导入，永不覆盖/删除，重名自动改名保留</div>' +
                    rows +
                    '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#2c3444;color:#dfe5ef;border:none;border-radius:6px;">取消</button>' +
                    '<button class="mi-next" style="padding:6px 14px;cursor:pointer;background:#3498db;color:#fff;border:none;border-radius:6px;">下一步：预览差异 →</button></div>');
                bindClose();
                dlg.querySelector('.mi-next').addEventListener('click', function () {
                    var sel = dlg.querySelector('input[name="mi-src"]:checked');
                    if (sel) stepScan(sel.value);
                });
            }).catch(function (e) { toast('🧬 探测请求失败：' + e); overlay.remove(); });
        }

        // 第 2 步：差异预览
        function stepScan(src) {
            html('<div>正在对比差异…</div>');
            post('/api/memory/import/scan', { src: src }).then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">预览失败：' + esc(res.err || '') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'); bindClose(); return; }
                function lst(arr, key) {
                    if (!arr.length) return '<li style="color:#8b95a7;">（无）</li>';
                    return arr.map(function (x) { return '<li>' + esc(typeof x === 'string' ? x : (x.file + ' → ' + x['as'])); }).join('') + '</li>';
                }
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🧬 导入预览 · ' + esc(src) + '</div>' +
                    '<div><b style="color:#2ecc71;">✅ 全新导入（' + res.add.length + '）</b><ul style="margin:4px 0 10px 18px;">' + lst(res.add) + '</ul>' +
                    '<b style="color:#f39c12;">✏️ 重名改名保留（' + res.rename.length + '）</b><ul style="margin:4px 0 10px 18px;">' + lst(res.rename) + '</ul>' +
                    '<b style="color:#8b95a7;">⏭️ 跳过（' + res.skip.length + '）</b><ul style="margin:4px 0 10px 18px;">' + lst(res.skip) + '</ul></div>' +
                    '<div style="color:#8b95a7;margin-bottom:12px;">导入前、后各自动打一次 git 快照，可整体回退。</div>' +
                    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#2c3444;color:#dfe5ef;border:none;border-radius:6px;">取消</button>' +
                    '<button class="mi-run" style="padding:6px 14px;cursor:pointer;background:#27ae60;color:#fff;border:none;border-radius:6px;">执行导入</button></div>');
                bindClose();
                dlg.querySelector('.mi-run').addEventListener('click', function () { stepRun(src); });
            }).catch(function (e) { toast('🧬 预览请求失败：' + e); overlay.remove(); });
        }

        // 第 3 步：执行导入
        function stepRun(src) {
            html('<div>正在导入…（含前后两次 git 快照，请稍候）</div>');
            post('/api/memory/import/run', { src: src }).then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">导入失败：' + esc(res.err || '') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'); bindClose(); return; }
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🧬 导入完成 ✅</div>' +
                    '<div>✅ 全新导入：<b>' + res.added + '</b> 个文件<br>✏️ 重名改名保留：<b>' + res.renamed + '</b> 个文件' +
                    (res.snapshot_err ? '<br><span style="color:#f39c12;">⚠️ git 快照异常：' + esc(res.snapshot_err) + '（文件已导入，仅快照未完成）</span>' : '<br><span style="color:#2ecc71;">已自动打 git 快照，可在记忆库历史中回退</span>') +
                    '</div><br><div style="text-align:right;"><button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#27ae60;color:#fff;border:none;border-radius:6px;">完成</button></div>');
                bindClose();
            }).catch(function (e) { toast('🧬 导入请求失败：' + e); overlay.remove(); });
        }

        function bindClose() {
            var c = dlg.querySelector('.mi-close');
            if (c) c.addEventListener('click', function () { overlay.remove(); });
        }

        stepCandidates();
    };
})();
