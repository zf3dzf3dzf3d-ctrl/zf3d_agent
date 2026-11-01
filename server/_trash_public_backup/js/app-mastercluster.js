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
        { icon: '🔑', label: '密码大师', cls: 'mc-passmaster', title: '跨版本密码库/登录态导入：自动探测老版本浏览器 profile（Login Data/Cookies/Local State），保守导入（永不覆盖），导入前后各打一次 git 快照。注意：不解密不展示任何明文密码；换电脑/换 Windows 账户后 DPAPI 加密的旧密码会失效' },
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
        menu.style.cssText += ';position:absolute;z-index:99999;min-width:150px;background:#1e2430;border:1px solid #3a4356;' +
            'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:4px;font-size:12px;color:#dfe5ef;';

        ITEMS.forEach(function (it) {
            var item = document.createElement('div');
            item.className = 'mc-item ' + it.cls;
            item.textContent = it.label;  // 【去图标】大师菜单项不再显示 emoji 图标，纯文字（与优先级菜单观感统一）
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
            item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;';
            item.addEventListener('mouseenter', function () { item.style.background = 'rgba(120,150,255,.14)'; });
            item.addEventListener('mouseleave', function () { item.style.background = 'transparent'; });
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                closeAllMenus(null);
                try {
                    if (it.cls === 'mc-logmaster') App.logMaster(box);
                    else if (it.cls === 'mc-filemaster') { if (typeof App.fileMaster === 'function') App.fileMaster(box); else if (App._logMasterToast) App._logMasterToast('文件资源管理师脚本未加载'); }
                    else if (it.cls === 'mc-memmaster') { if (typeof App.memoryImportMaster === 'function') App.memoryImportMaster(box); else if (App._logMasterToast) App._logMasterToast('记忆大师脚本未加载'); }
                    else if (it.cls === 'mc-passmaster') { if (typeof App.profileImportMaster === 'function') App.profileImportMaster(box); else if (App._logMasterToast) App._logMasterToast('密码大师脚本未加载'); }
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
        btn.className = 'hd-btn mastercluster-btn mc-toggle';  // 【去图标】去掉 master-icon 图标样式，只留文字
        btn.title = '大师集群：日志大师 / 上下文大师 / 工具大师 / 导师点评 / 对话综合大师';
        btn.textContent = '大师';  // 【去箭头】大师触发器不再显示下箭头
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
            // 【位置修复】按钮已收纳进顶栏（屏幕上半区），改为优先在按钮下方打开，
            // 与优先级菜单一致；下方放不下才向上弹
            if ((window.innerHeight - r.bottom) > (mh + 6)) {
                top = r.bottom + 6;
            } else {
                top = r.top - mh - 6;
            }
            // 钳制在视口内，绝不允许超出屏幕（顶部/底部各留 8px）
            if (top < margin) top = margin;
            if (top + mh > window.innerHeight - margin) top = window.innerHeight - margin - mh;
            if (top < margin) top = margin; // 菜单比视口还高时兜底贴顶
            menu.style.top = top + 'px';
            // 【修复#6·菜单跑到左侧】旧逻辑右对齐按钮并整体右移 30px，
            // 在「⋯更多」下拉内表现为菜单偏到按钮左侧一大截、远离鼠标。
            // 改为菜单左边缘紧挨按钮左边缘出现（鼠标搭上即在原位弹出）。
            // 【修复·大师下拉应在左侧】改为在触发按钮「左侧」弹出（右边缘贴按钮左边缘），
            // 与优先级/上下文菜单一致，不再与按钮重叠铺开。
            var left = r.left - mw - 4;
            if (left < margin) left = Math.max(margin, r.right + 4); // 左侧放不下则贴右
            if (left < margin) left = margin;
            if (left + mw > window.innerWidth - margin) left = window.innerWidth - margin - mw;
            menu.style.right = 'auto';
            menu.style.left = left + 'px';
            if (wasHidden) { menu.style.display = 'none'; menu.style.visibility = ''; }
        }
        btn._placeMenu = placeMenu;

        // 暴露悬停展开入口：供 chatbox-header-more.js 的 hover 引擎在鼠标
        // 搭到「大师集群」项时调用（出现菜单），鼠标离开活动区后由其统一收起。
        btn.__hoverOpen = function () {
            if (menu.style.display !== 'none') return;
            closeAllMenus(menu);
            placeMenu();
            menu.style.display = 'block';
        };

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

        // ① 大师集群按钮搬进「⋯ 更多」菜单（锚点改为菜单容器；菜单未就绪时 relocate 脚本兜底）
        if (box.querySelector('.mastercluster-btn')) return;
        var anchor = box.querySelector('.hd-more-menu')
            || box.querySelector('.model-picker-wrap')
            || box.querySelector('.chatbox-configrow')
            || box.querySelector('.chatbox-inputrow');
        if (anchor && anchor.parentNode) {
            if (anchor.classList && anchor.classList.contains('hd-more-menu')) anchor.appendChild(btn);
            else anchor.parentNode.insertBefore(btn, anchor);
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

        // ⚡ 一键自动收集：全盘扫描 → 一次性保守导入
        function stepAuto() {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">⚡ 一键自动收集</div><div>正在全盘智能扫描所有老版本的记忆库（可能需要十几秒）…<br><span style="color:#8b95a7;">扫描范围：同级目录 + 各盘符常见位置</span></div>');
            post('/api/memory/import/auto').then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">自动收集失败：' + esc(res.err || '未知错误') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button><button class="mi-back" style="padding:6px 14px;margin-left:8px;cursor:pointer;">返回手动选择</button>'); bindClose(); bindBack(); return; }
                var rows = res.results.map(function (r) {
                    if (!r.ok) return '<div style="padding:6px 10px;border:1px solid #3a4356;border-radius:6px;margin-bottom:6px;color:#e74c3c;">❌ ' + esc(r.name) + '：' + esc(r.err || '') + '</div>';
                    return '<div style="padding:6px 10px;border:1px solid #3a4356;border-radius:6px;margin-bottom:6px;"><b>' + esc(r.name) + '</b>：✅ 新增 ' + r.added + ' 个，✏️ 重名改名保留 ' + r.renamed + ' 个</div>';
                }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">⚡ 自动收集完成 ✅</div>' +
                    '<div>共扫描 <b>' + res.sources + '</b> 个版本目录：全新导入 <b style="color:#2ecc71;">' + res.added + '</b> 个文件，重名改名保留 <b style="color:#f39c12;">' + res.renamed + '</b> 个（永不覆盖原记忆）</div><br>' + rows +
                    (res.snapshot_err ? '<div style="color:#f39c12;">⚠️ git 快照异常：' + esc(res.snapshot_err) + '</div>' : '<div style="color:#2ecc71;margin-top:8px;">已自动打 git 快照，可在记忆库历史中回退。</div>') +
                    '<br><div style="text-align:right;"><button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#27ae60;color:#fff;border:none;border-radius:6px;">完成</button></div>');
                bindClose();
            }).catch(function (e) { toast('⚡ 自动收集请求失败：' + e); overlay.remove(); });
        }
        function bindBack() {
            var b = dlg.querySelector('.mi-back');
            if (b) b.addEventListener('click', stepCandidates);
        }

        // 第 1 步：候选列表
        function stepCandidates() {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🧬 记忆大师 · 跨版本记忆导入</div><div>正在全盘智能探测老版本记忆库…</div>');
            post('/api/memory/import/candidates').then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">探测失败：' + esc(res.err || '未知错误') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'); bindClose(); return; }
                if (!res.candidates.length) {
                    html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🧬 记忆大师</div>' +
                        '<div>全盘智能扫描未检测到含记忆库（private/记忆/）的老版本目录。<br>当前版本：' + esc(res.current) + '</div><br>' +
                        '<button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>');
                    bindClose(); return;
                }
                var autoBtn = '<div style="background:#232b3a;border:1px solid #3498db;border-radius:8px;padding:12px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">' +
                    '<div style="flex:1;"><b>⚡ 一键自动收集全部</b><br><span style="color:#8b95a7;font-size:12px;">自动扫描全部 ' + res.candidates.length + ' 个来源，保守导入所有新记忆（永不覆盖，前后 git 快照）</span></div>' +
                    '<button class="mi-auto" style="padding:8px 16px;cursor:pointer;background:#3498db;color:#fff;border:none;border-radius:6px;white-space:nowrap;">立即收集</button></div>';
                var rows = res.candidates.map(function (c, i) {
                    var d = new Date(c.mtime * 1000);
                    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #3a4356;border-radius:6px;margin-bottom:6px;">' +
                        '<input type="radio" name="mi-src" value="' + esc(c.dir) + '"' + (i === 0 ? ' checked' : '') + ' style="cursor:pointer;">' +
                        '<div style="flex:1;"><b>' + esc(c.name) + '</b><br><span style="color:#8b95a7;font-size:12px;">' + c.count + ' 个记忆文件 · ' + d.toLocaleString() + '</span></div></div>';
                }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:4px;">🧬 记忆大师 · 选择来源版本</div>' +
                    '<div style="color:#8b95a7;margin-bottom:10px;">当前版本：' + esc(res.current) + ' · 导入策略：保守导入，永不覆盖/删除，重名自动改名保留</div>' +
                    autoBtn + rows +
                    '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#2c3444;color:#dfe5ef;border:none;border-radius:6px;">取消</button>' +
                    '<button class="mi-next" style="padding:6px 14px;cursor:pointer;background:#3498db;color:#fff;border:none;border-radius:6px;">下一步：预览差异 →</button></div>');
                bindClose();
                dlg.querySelector('.mi-auto').addEventListener('click', stepAuto);
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

    // ==================================================================
    // 🔑 密码大师：跨版本浏览器 profile/密码库导入向导
    // （candidates → scan 预览 → run 导入；不解密不展示任何明文密码）
    // ==================================================================
    App.profileImportMaster = function () {
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
        function bindClose() {
            var c = dlg.querySelector('.mi-close');
            if (c) c.addEventListener('click', function () { overlay.remove(); });
        }
        function bindBack(fn) {
            var b = dlg.querySelector('.mi-back');
            if (b) b.addEventListener('click', fn);
        }

        // ⚡ 一键自动收集
        function stepAuto() {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🔑 密码大师 · ⚡ 一键自动收集</div><div>正在全盘智能扫描所有老版本的浏览器密码库/登录态（可能需要十几秒）…<br><span style="color:#8b95a7;">提示：导入前请关闭浏览器会话，防止数据库文件占用</span></div>');
            post('/api/browser/profile/import/auto').then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">自动收集失败：' + esc(res.err || '未知错误') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button><button class="mi-back" style="padding:6px 14px;margin-left:8px;cursor:pointer;">返回手动选择</button>'); bindClose(); bindBack(stepCandidates); return; }
                var rows = res.results.map(function (r) {
                    if (!r.ok) return '<div style="padding:6px 10px;border:1px solid #3a4356;border-radius:6px;margin-bottom:6px;color:#e74c3c;">❌ ' + esc(r.name) + '：' + esc(r.err || '') + '</div>';
                    return '<div style="padding:6px 10px;border:1px solid #3a4356;border-radius:6px;margin-bottom:6px;"><b>' + esc(r.name) + '</b>：✅ 新增 ' + r.added + ' 个关键文件，✏️ 重名改名保留 ' + r.renamed + ' 个</div>';
                }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">⚡ 密码库收集完成 ✅</div>' +
                    '<div>全新导入 <b style="color:#2ecc71;">' + res.total_add + '</b> 个关键文件，重名改名保留 <b style="color:#f39c12;">' + res.total_rename + '</b> 个（永不覆盖）</div><br>' + rows +
                    '<div style="color:#8b95a7;margin-top:8px;font-size:12px;">⚠️ 换电脑/换 Windows 账户后，DPAPI 加密的旧密码会失效（登录态 Cookie 一般仍有效）。建议重启软件或关闭浏览器会话后重新打开使导入生效。</div>' +
                    '<br><div style="text-align:right;"><button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#27ae60;color:#fff;border:none;border-radius:6px;">完成</button></div>');
                bindClose();
            }).catch(function (e) { toast('🔑 自动收集请求失败：' + e); overlay.remove(); });
        }

        // 第 1 步：候选列表（每个 profile 单元 = 一条）
        function stepCandidates() {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🔑 密码大师 · 跨版本密码库导入</div><div>正在全盘智能探测老版本浏览器 profile（Login Data/Cookies/Local State）…</div>');
            post('/api/browser/profile/import/candidates').then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">探测失败：' + esc(res.err || '未知错误') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'); bindClose(); return; }
                if (!res.candidates.length) {
                    html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🔑 密码大师</div>' +
                        '<div>全盘智能扫描未检测到含浏览器密码库/登录态的老版本目录。<br>当前版本：' + esc(res.current) + '</div><br>' +
                        '<button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>');
                    bindClose(); return;
                }
                var autoBtn = '<div style="background:#232b3a;border:1px solid #3498db;border-radius:8px;padding:12px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">' +
                    '<div style="flex:1;"><b>⚡ 一键自动收集全部</b><br><span style="color:#8b95a7;font-size:12px;">自动扫描全部 ' + res.candidates.length + ' 个 profile 单元，保守导入所有密码库/登录态（永不覆盖，前后 git 快照）</span></div>' +
                    '<button class="mi-auto" style="padding:6px 14px;cursor:pointer;background:#3498db;color:#fff;border:none;border-radius:6px;white-space:nowrap;">⚡ 自动收集</button></div>';
                var rows = res.candidates.map(function (c, i) {
                    var d = new Date(c.mtime * 1000);
                    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #3a4356;border-radius:6px;margin-bottom:6px;">' +
                        '<input type="radio" name="pi-src" value="' + esc(c.dir) + '" data-pp="' + esc(c.profile_path) + '"' + (i === 0 ? ' checked' : '') + ' style="cursor:pointer;">' +
                        '<div style="flex:1;"><b>' + esc(c.name) + '</b><br><span style="color:#8b95a7;font-size:12px;">' + c.count + ' 个关键文件 · ' + c.total_mb + ' MB · ' + d.toLocaleString() + '</span></div></div>';
                }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:4px;">🔑 密码大师 · 选择来源 profile</div>' +
                    '<div style="color:#8b95a7;margin-bottom:10px;">当前版本：' + esc(res.current) + ' · 策略：保守导入，永不覆盖/删除，重名自动改名保留 · 只迁移文件，不解密不展示明文密码</div>' +
                    autoBtn + rows +
                    '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#2c3444;color:#dfe5ef;border:none;border-radius:6px;">取消</button>' +
                    '<button class="mi-next" style="padding:6px 14px;cursor:pointer;background:#3498db;color:#fff;border:none;border-radius:6px;">下一步：预览差异 →</button></div>');
                bindClose();
                var a = dlg.querySelector('.mi-auto');
                if (a) a.addEventListener('click', stepAuto);
                var n = dlg.querySelector('.mi-next');
                if (n) n.addEventListener('click', function () {
                    var sel = dlg.querySelector('input[name="pi-src"]:checked');
                    if (!sel) { toast('请先选择一个来源'); return; }
                    stepScan(sel.value, sel.getAttribute('data-pp'));
                });
            }).catch(function (e) { toast('🔑 探测请求失败：' + e); overlay.remove(); });
        }

        // 第 2 步：scan 预览 → 确认后 run
        function stepScan(src, pp) {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🔑 密码大师 · 差异预览</div><div>正在对比关键文件（Local State / Login Data / Cookies…）…</div>');
            post('/api/browser/profile/import/scan', { src: src, profile_path: pp }).then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">预览失败：' + esc(res.err || '未知错误') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'); bindClose(); return; }
                function fmt(arr, icon, label) {
                    if (!arr.length) return '';
                    return '<div style="margin:8px 0 4px;font-weight:bold;">' + icon + ' ' + label + '（' + arr.length + '）</div>' +
                        arr.slice(0, 30).map(function (x) {
                            var t = x.file ? x.file : x;
                            return '<div style="color:#8b95a7;font-size:12px;padding:2px 0 2px 14px;">' + esc(typeof t === 'string' ? t : (t.file + (x.as ? ' → ' + x.as : ''))) + '</div>';
                        }).join('') + (arr.length > 30 ? '<div style="color:#8b95a7;font-size:12px;padding-left:14px;">…等 ' + arr.length + ' 个</div>' : '');
                }
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:4px;">🔑 密码大师 · 确认导入</div>' +
                    '<div style="color:#8b95a7;margin-bottom:8px;">来源：' + esc(src) + '<br>目标：' + esc(res.dst_profile) + '</div>' +
                    '<div>✅ 全新导入：<b style="color:#2ecc71;">' + res.add.length + '</b> 个 · ✏️ 重名改名保留：<b style="color:#f39c12;">' + res.rename.length + '</b> 个（永不覆盖/删除）</div>' +
                    fmt(res.add, '✅', '全新导入') + fmt(res.rename, '✏️', '重名改名') +
                    '<div style="color:#f39c12;margin-top:10px;font-size:12px;">⚠️ 导入前请确保浏览器会话已关闭（防止 SQLite 占用）。导入前后各打一次 git 快照。</div>' +
                    '<br><div style="display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button class="mi-back" style="padding:6px 14px;cursor:pointer;background:#2c3444;color:#dfe5ef;border:none;border-radius:6px;">← 返回</button>' +
                    '<button class="mi-run" style="padding:6px 14px;cursor:pointer;background:#e67e22;color:#fff;border:none;border-radius:6px;">开始导入</button></div>');
                bindClose();
                bindBack(function () { stepCandidates(); });
                var r = dlg.querySelector('.mi-run');
                if (r) r.addEventListener('click', function () { stepRun(src, pp); });
            }).catch(function (e) { toast('🔑 预览请求失败：' + e); overlay.remove(); });
        }

        // 第 3 步：执行导入
        function stepRun(src, pp) {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🔑 密码大师 · 导入中…</div><div>正在保守导入关键文件（不会覆盖任何现有文件）…</div>');
            post('/api/browser/profile/import/run', { src: src, profile_path: pp }).then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">导入失败：' + esc(res.err || '未知错误') + '</div><br><button class="mi-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'); bindClose(); return; }
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🔑 导入完成 ✅</div>' +
                    '<div>✅ 全新导入：<b>' + res.added + '</b> 个关键文件<br>✏️ 重名改名保留：<b>' + res.renamed + '</b> 个</div>' +
                    '<div style="color:#2ecc71;margin-top:8px;">' + esc(res.hint || '完成') + '</div>' +
                    '<br><div style="text-align:right;"><button class="mi-close" style="padding:6px 14px;cursor:pointer;background:#27ae60;color:#fff;border:none;border-radius:6px;">完成</button></div>');
                bindClose();
            }).catch(function (e) { toast('🔑 导入请求失败：' + e); overlay.remove(); });
        }

        stepCandidates();
    };
})();
