// ==== app-batch-questions.js 批量问题对话框 ====
// 功能：一个入口弹窗，内含多个多行输入框（默认 3 个，可增删），
// 继承当前活动对话的项目 + 模型；点击「批量开始」后：
// 以最后一个对话框右侧 + GAP 为起点，严格横排创建一批对话并立即依次自动发送。
// 多行框粘贴行为与主对话一致（textarea 原生粘贴即可，带图/卡片走主对话 paste 管线由 bindChatBox 接管）。
(function() {
    'use strict';

    var GAP = 80;          // 横排对话框之间的间隙（px，留大一点的间隙）
    var MAX_Q = 20;        // 批量问题条数上限（单次批量提交条数；窗口总量防风暴上限见下方 100）
    var DEFAULT_N = 3;     // 默认 3 个多行框

    function activeChat() {
        try {
            if (window.App && typeof App.getActiveChat === 'function') {
                var c = App.getActiveChat();
                if (c) return c;
            }
            if (window.App && App.chatBoxes && App.chatBoxes.length) {
                // 取 zIndex 最高的可见对话
                var best = null, bz = -1;
                App.chatBoxes.forEach(function(c) {
                    if (!c.el || !c.el.parentNode) return;
                    var z = parseInt(c.el.style.zIndex || '0', 10) || 0;
                    if (z >= bz) { bz = z; best = c; }
                });
                return best;
            }
        } catch (e) {}
        return null;
    }

    function modelName(mid) {
        try {
            if (!mid || !window.Models || !Models.list) return '默认模型';
            var m = Models.list().find(function(x) { return x.id === mid; });
            return (m && (m.name || m.id)) || '默认模型';
        } catch (e) { return '默认模型'; }
    }

    function projectName(pid) {
        try {
            if (!pid || !window.DB || !DB.getProjects) return '';
            var p = DB.getProjects().find(function(x) { return x.id === pid; });
            return (p && (p.name || p.id)) || '';
        } catch (e) { return ''; }
    }

    function openBatchDialog(srcChat) {
        if (document.getElementById('zfBatchQOverlay')) return;
        // 【v2】支持指定来源对话（每个对话右侧「批量」按钮 / 双击面板入口传入该对话）
        // 【v3】支持传 {modelId:'xx'}（创建对话框面板中每条线路右侧的「📚 批量」入口，无需来源对话）
        if (srcChat && !srcChat.el && srcChat.modelId && !('history' in srcChat)) {
            var m = (window.Models && Models.list ? Models.list : []).find(function (x) { return x && x.id === srcChat.modelId; }) || null;
            srcChat = { el: null, modelId: srcChat.modelId, _modelIdOverride: m ? (m.modelId || '') : '', projectId: (window.App && App._activeProjectId) || '' };
        }
        var src = srcChat || activeChat();
        // 【修复】createChatBox 的第 3 参语义是「模型条目/线路 ID」（内部 Models.get 后
        // 自行取 model.modelId 当 override），严禁把 _modelIdOverride（具体模型ID）混入，
        // 否则 Models.get 查不到会回落默认模型——这正是批量窗模型不对的根因。
        var srcModel = src ? (src.modelId || '') : '';
        var srcOverride = src ? (src._modelIdOverride || '') : '';
        var srcProject = src ? (src.projectId || window.App && App._activeProjectId || '') : '';

        var overlay = document.createElement('div');
        overlay.id = 'zfBatchQOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999990;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';

        // 【通用风格】与全站一致：主题变量 --panel/--text/--border，不再单独搞渐变紫
        var panel = document.createElement('div');
        panel.style.cssText = 'width:640px;max-width:92vw;height:600px;max-height:84vh;min-width:420px;min-height:320px;display:flex;flex-direction:column;background:var(--panel,#1e1f24);color:var(--text,#eee);border:1px solid var(--border,rgba(255,255,255,.1));border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.5);overflow:hidden;font-family:system-ui,sans-serif;position:relative;';

        // ===== 位置/尺寸记忆（对齐设置面板 panel-settings-drag.js 的做法）=====
        var WIN_KEY = 'batchQWin';
        function loadWin() {
            try {
                var raw = window.UserSettings && UserSettings.get(WIN_KEY);
                if (!raw) return null;
                var p = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.w) && Number.isFinite(p.h)) return p;
            } catch (e) {}
            return null;
        }
        function saveWin(p) {
            try { if (window.UserSettings) UserSettings.set(WIN_KEY, JSON.stringify(p)); } catch (e) {}
        }
        function applyWin(p) {
            var vw = window.innerWidth, vh = window.innerHeight;
            p.w = Math.max(420, Math.min(p.w, vw - 16));
            p.h = Math.max(320, Math.min(p.h, vh - 16));
            p.x = Math.max(0, Math.min(p.x, vw - 60));
            p.y = Math.max(0, Math.min(p.y, vh - 40));
            panel.style.width = p.w + 'px';
            panel.style.height = p.h + 'px';
            panel.style.maxHeight = 'none';
            overlay.style.alignItems = 'flex-start';
            overlay.style.justifyContent = 'flex-start';
            panel.style.marginLeft = p.x + 'px';
            panel.style.marginTop = p.y + 'px';
            panel.style.marginRight = 'auto';
            panel.style.marginBottom = 'auto';
        }

        // 标题栏（可按住拖动平移）
        var head = document.createElement('div');
        head.style.cssText = 'padding:12px 16px;display:flex;align-items:center;justify-content:space-between;background:var(--card,rgba(255,255,255,.04));border-bottom:1px solid var(--border,rgba(255,255,255,.08));cursor:move;user-select:none;touch-action:none;';
        head.innerHTML = '<div style="font-size:15px;font-weight:600;color:var(--text,#eee)">📚 批量问题</div>';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:none;border:none;color:var(--text,#eee);font-size:16px;cursor:pointer;opacity:.8';
        closeBtn.onclick = close;
        head.appendChild(closeBtn);
        panel.appendChild(head);

        // 拖动平移 + 右下角缩放柄
        var winPos = loadWin();
        if (winPos) applyWin(winPos);
        (function bindDragResize() {
            var rsHandle = document.createElement('div');
            rsHandle.title = '拖拽调整大小';
            rsHandle.style.cssText = 'position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;z-index:10;touch-action:none;';
            rsHandle.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M13 1L1 13M13 6L6 13M13 11l-2 2" stroke="var(--text,#999)" stroke-opacity=".45" stroke-width="1.5" fill="none"/></svg>';
            panel.appendChild(rsHandle);
            function rect() { var r = panel.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
            // --- 拖动平移（标题栏空白处，不拦关闭按钮）---
            var drag = null;
            head.addEventListener('pointerdown', function (e) {
                if (e.button !== 0) return;
                if (e.target.closest && e.target.closest('button')) return;
                drag = rect();
                drag.sx = e.clientX; drag.sy = e.clientY;
                head.setPointerCapture(e.pointerId);
                e.preventDefault();
            });
            head.addEventListener('pointermove', function (e) {
                if (!drag) return;
                winPos = { x: drag.x + (e.clientX - drag.sx), y: drag.y + (e.clientY - drag.sy), w: drag.w, h: drag.h };
                applyWin(winPos);
            });
            function endDrag(e) {
                if (!drag) return;
                drag = null;
                try { head.releasePointerCapture(e.pointerId); } catch (ex) {}
                if (winPos) saveWin(winPos);
            }
            head.addEventListener('pointerup', endDrag);
            head.addEventListener('pointercancel', endDrag);
            // --- 缩放 ---
            var rs = null;
            rsHandle.addEventListener('pointerdown', function (e) {
                if (e.button !== 0) return;
                rs = rect();
                rs.sx = e.clientX; rs.sy = e.clientY;
                rsHandle.setPointerCapture(e.pointerId);
                e.preventDefault();
            });
            rsHandle.addEventListener('pointermove', function (e) {
                if (!rs) return;
                winPos = { x: rs.x, y: rs.y, w: rs.w + (e.clientX - rs.sx), h: rs.h + (e.clientY - rs.sy) };
                applyWin(winPos);
            });
            function endRs(e) {
                if (!rs) return;
                rs = null;
                try { rsHandle.releasePointerCapture(e.pointerId); } catch (ex) {}
                if (winPos) saveWin(winPos);
            }
            rsHandle.addEventListener('pointerup', endRs);
            rsHandle.addEventListener('pointercancel', endRs);
        })();

        // 继承信息条已按需求移除（不再展示模型/项目名）

        // 多行框列表区
        var list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px;';
        panel.appendChild(list);

        function addRow(text) {
            if (list.children.length >= MAX_Q) { toast('最多 ' + MAX_Q + ' 条'); return; }
            var row = document.createElement('div');
            row.style.cssText = 'position:relative;';
            var idx = document.createElement('div');
            idx.className = 'zf-bq-idx';
            idx.style.cssText = 'font-size:11px;color:#8a8fa8;margin-bottom:4px';
            var ta = document.createElement('textarea');
            ta.rows = 1;
            ta.placeholder = '输入问题…（支持粘贴文本/贴图/卡片内容）';
            ta.style.cssText = 'width:100%;box-sizing:border-box;resize:vertical;min-height:60px;padding:8px 10px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.14));background:var(--card,rgba(255,255,255,.05));color:inherit;font-size:13px;font-family:inherit;line-height:1.5;';
            // ===== 文件暂存区（v4）：粘贴/拖拽的文件先暂存到 ta._zfPasteFiles， =====
            // ===== 可视化卡片展示、可单个删除；点「批量开始」后随对话创建自动带上 =====
            function renderFiles() {
                var old = row.querySelector('.zf-bq-files');
                if (old) old.remove();
                var files = ta._zfPasteFiles || [];
                if (!files.length) return;
                var wrap = document.createElement('div');
                wrap.className = 'zf-bq-files';
                wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;';
                files.forEach(function (f, fi) {
                    var isImg = /^image\//.test(f.type || '');
                    var card = document.createElement('div');
                    card.style.cssText = 'position:relative;display:flex;align-items:center;gap:6px;padding:4px 22px 4px 6px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.14));background:var(--card,rgba(255,255,255,.05));font-size:12px;max-width:200px;';
                    if (isImg) {
                        var img = document.createElement('img');
                        try { img.src = URL.createObjectURL(f); } catch (e) {}
                        img.style.cssText = 'width:34px;height:34px;object-fit:cover;border-radius:5px;flex:none;';
                        card.appendChild(img);
                    } else {
                        var ic = document.createElement('span');
                        if (f._text) { ic.textContent = /^🔗/.test(f.name || '') ? '🔗' : '📝'; ic.title = '文本卡片'; }
                        else { ic.textContent = '📄'; ic.title = '文件'; }
                        card.appendChild(ic);
                    }
                    var nm = document.createElement('span');
                    nm.textContent = f.name || (isImg ? '图片' : '文件');
                    nm.title = nm.textContent;
                    nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85;';
                    card.appendChild(nm);
                    var x = document.createElement('button');
                    x.textContent = '×';
                    x.title = '移除此文件';
                    x.style.cssText = 'position:absolute;top:1px;right:3px;background:none;border:none;cursor:pointer;color:inherit;font-size:13px;opacity:.6;padding:0;line-height:1;';
                    x.onclick = function () {
                        ta._zfPasteFiles.splice(fi, 1);
                        renderFiles();
                    };
                    card.appendChild(x);
                    wrap.appendChild(card);
                });
                // 插到删除按钮之前（即 textarea 下方）
                row.insertBefore(wrap, del);
            }
            function collectFiles(fl) {
                ta._zfPasteFiles = (ta._zfPasteFiles || []).concat(fl);
                renderFiles();
                toast('已暂存 ' + fl.length + ' 个文件，创建对话后自动带上');
            }
            // 【卡片】粘贴大段文字/拖拽链接：转为可删除的小卡片，不直接灌进输入框
            function collectTextCard(txt, label) {
                ta._zfPasteFiles = (ta._zfPasteFiles || []).concat([{ name: label, _text: txt, type: 'text/plain' }]);
                renderFiles();
                var brief = txt.replace(/\s+/g, ' ').slice(0, 30);
                toast('已转为文本卡片（' + txt.length + ' 字）：' + brief + (txt.length > 30 ? '…' : ''));
            }
            ta.addEventListener('paste', function(ev) {
                try {
                    var files = [];
                    var items = (ev.clipboardData && ev.clipboardData.items) || [];
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (f) files.push(f); }
                    }
                    if (files.length) {
                        ev.preventDefault();
                        collectFiles(files);
                        return;
                    }
                    // 【大段文字转卡片】超过 80 字符或含换行，与主对话粘贴卡片规则一致
                    var ptext = (ev.clipboardData && ev.clipboardData.getData('text/plain')) || '';
                    if (ptext && (ptext.length > 80 || /\n/.test(ptext))) {
                        ev.preventDefault();
                        collectTextCard(ptext, '📝 文本 ' + ptext.length + ' 字');
                    }
                } catch (e) {}
            });
            // 拖拽文件到该行也可暂存（拖拽链接/图标等无文件的 dt 也转为文本卡片）
            ta.addEventListener('dragover', function (ev) { ev.preventDefault(); ta.style.borderColor = 'var(--accent,#4a6cf7)'; });
            ta.addEventListener('dragleave', function () { ta.style.borderColor = ''; });
            ta.addEventListener('drop', function (ev) {
                ev.preventDefault();
                ta.style.borderColor = '';
                try {
                    var dt = ev.dataTransfer || {};
                    var files = dt.files ? Array.prototype.slice.call(dt.files) : [];
                    if (files.length) { collectFiles(files); return; }
                    // 无文件拖拽：优先取 uri-list（拖拽链接/图标），否则取纯文本
                    var dtext = (dt.getData && (dt.getData('text/uri-list') || dt.getData('text/plain'))) || '';
                    if (dtext && dtext.trim()) collectTextCard(dtext.trim(), '🔗 链接/内容');
                } catch (e) {}
            });
            var del = document.createElement('button');
            del.textContent = '🗑';
            del.title = '删除此条';
            del.style.cssText = 'position:absolute;top:18px;right:6px;background:none;border:none;cursor:pointer;font-size:13px;opacity:.55';
            del.onclick = function() {
                row.remove();
                renumber();
            };
            row.appendChild(idx);
            row.appendChild(ta);
            row.appendChild(del);
            if (text) ta.value = text;
            list.appendChild(row);
            renumber();
            return ta;
        }

        function renumber() {
            Array.prototype.forEach.call(list.querySelectorAll('.zf-bq-idx'), function(el, i) {
                el.textContent = '问题 ' + (i + 1);
            });
            addBtn.style.display = list.children.length >= MAX_Q ? 'none' : '';
        }

        // 底部操作区
        var foot = document.createElement('div');
        foot.style.cssText = 'padding:10px 16px 14px;display:flex;align-items:center;gap:10px;border-top:1px solid rgba(255,255,255,.08);';
        var addBtn = document.createElement('button');
        addBtn.textContent = '＋ 添加一条';
        addBtn.style.cssText = 'padding:7px 14px;border-radius:8px;border:1px dashed var(--border,rgba(255,255,255,.3));background:none;color:var(--text,#eee);cursor:pointer;font-size:13px;';
        addBtn.onclick = function() { addRow(''); };
        foot.appendChild(addBtn);
        var spacer = document.createElement('div');
        spacer.style.flex = '1';
        foot.appendChild(spacer);
        var goBtn = document.createElement('button');
        goBtn.textContent = '🚀 批量开始';
        goBtn.style.cssText = 'padding:8px 22px;border-radius:8px;border:none;background:var(--accent,#4a6cf7);color:#fff;font-size:14px;font-weight:600;cursor:pointer;';
        goBtn.onclick = start;
        foot.appendChild(goBtn);
        panel.appendChild(foot);

        overlay.appendChild(panel);
        overlay.addEventListener('mousedown', function(e) { if (e.target === overlay) close(); });
        document.body.appendChild(overlay);

        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        function toast(msg) {
            try { if (App && App._showStormToast) return App._showStormToast(msg, '#4a6cf7'); } catch (e) {}
            console.log('[批量问题]', msg);
        }

        for (var i = 0; i < DEFAULT_N; i++) addRow('');
        var tas = list.querySelectorAll('textarea');
        if (tas[0]) tas[0].focus();

        // ===== 批量开始 =====
        function start() {
            var items = [];
            Array.prototype.forEach.call(list.querySelectorAll('textarea'), function(ta) {
                var txt = ta.value.trim();
                var all = ta._zfPasteFiles || [];
                var realFiles = [], textParts = [];
                all.forEach(function(f) {
                    // 【文本卡片】粘贴大段文字/拖拽链接生成的卡片：内容拼回问题文本，不走文件管线
                    if (f && f._text) textParts.push(f._text);
                    else if (f) realFiles.push(f);
                });
                var fullText = txt;
                if (textParts.length) fullText = (txt ? txt + '\n\n' : '') + textParts.join('\n\n');
                if (fullText || realFiles.length) items.push({ text: fullText, files: realFiles });
            });
            if (!items.length) { toast('请至少填写一个问题'); return; }

            // 起点：最后一个对话框右侧 + 间隙；没有对话则画布可视区右侧
            // 注意：createChatBox 用的是画布内容坐标系，须把屏幕坐标除以 scale 并减去 view 偏移换算
            var view = (typeof App.canvasGetView === 'function') ? App.canvasGetView() : { x: 0, y: 0, scale: 1 };
            var scale = view.scale || 1;
            function toWorld(sx, sy) { return { x: (sx - view.x) / scale, y: (sy - view.y) / scale }; }
            var last = (App.chatBoxes && App.chatBoxes.length) ? App.chatBoxes[App.chatBoxes.length - 1] : null;
            var startX, startY;
            if (last && last.el) {
                var r = last.el.getBoundingClientRect();
                var w = toWorld(r.right + GAP, r.top);
                startX = Math.round(w.x);
                startY = Math.round(w.y);
            } else {
                var canvas = document.getElementById('canvasArea') || document.body;
                var cr = canvas.getBoundingClientRect();
                var w2 = toWorld(cr.left + cr.width * 0.55, cr.top + 80);
                startX = Math.round(w2.x);
                startY = Math.round(w2.y);
            }

            // 总量预检（防风暴上限 100）
            var existCnt = document.querySelectorAll('.chatbox').length;
            if (existCnt + items.length > 100) {
                toast('窗口总量将超上限 100（现有 ' + existCnt + ' + 批量 ' + items.length + '），请先关闭部分对话');
                return;
            }

            close();
            var created = [], failed = 0;
            // 逐个创建，每个之间间隔 500ms（createChatBox 内部异步初始化，
            // 同步瞬间批量创建会导致模型未绑定/防风暴误判，发送全部失败——参照 diverge.js 的成熟模式）
            // 同步瞬间批量创建会导致模型未绑定/防风暴误判，发送全部失败——参照 diverge.js 的成熟模式）
            function createOne(i) {
                if (i >= items.length) { finish(); return; }
                var item = items[i];
                var chat = null;
                try {
                    chat = App.createChatBox(startX + i * (380 + GAP), startY, srcModel || undefined, true);
                } catch (e) { console.error('[批量问题] 创建失败', e); }
                if (!chat) { failed++; toast('第 ' + (i + 1) + ' 个对话创建失败（可能触发限流）'); setTimeout(function () { createOne(i + 1); }, 500); return; }
                created.push(chat);

                // 继承模型/引擎/项目（对齐 cloneChatBox 的继承做法）
                try {
                    if (srcModel || srcOverride) {
                        if (srcOverride) chat._modelIdOverride = srcOverride; // 具体模型ID仅写 override
                        chat._engine = (src && src._engine) || '';
                        if (typeof chat._refreshModelPickerBtn === 'function') chat._refreshModelPickerBtn();
                    }
                    if (srcProject) {
                        chat.projectId = srcProject;
                        if (typeof App._updateProjectBtn === 'function') App._updateProjectBtn(chat);
                    }
                    if (src && src._reasoningEffort) chat._reasoningEffort = src._reasoningEffort;
                } catch (e) {}

                // 填入问题并发送（复用 chatManage 的发送流程；等 500ms 让窗口初始化完成再发）
                setTimeout(function () {
                    try {
                        var input = chat.el.querySelector('textarea');
                        if (input) input.value = '';
                        if (item.files && item.files.length) {
                            // 【修复】不再用合成 ClipboardEvent 派发 paste（合成事件不携带文件，图片会丢失），
                            // 直接调用主对话同款的暂存管线 _addPendingImages：
                            // 自带可视化缩略图卡片、单个删除按钮、@图N 编号和跨重启持久化，与普通对话完全一致
                            try {
                                if (typeof App._addPendingImages === 'function') {
                                    App._addPendingImages(chat.el, item.files);
                                } else {
                                    console.warn('[批量问题] _addPendingImages 不可用，文件未注入');
                                }
                            } catch (e2) {
                                console.warn('[批量问题] 文件暂存注入失败', e2);
                            }
                        }
                        function doSend() {
                            try {
                                if (item.text) {
                                    // 不往对话框里渲染用户文字气泡，直接入 history 发送
                                    chat.history.push({ role: 'user', content: item.text });
                                    Store.addLog('info', chat.id, 'send', '批量问题自动发送 #' + (i + 1));
                                    // 【修复】同步更新对话框顶部标题：由于未渲染 .msg.user 气泡，
                                    // updateChatTitle 内部取不到首条提问，须显式把本条问题文本传入
                                    try { if (typeof App.updateChatTitle === 'function') App.updateChatTitle(chat.el, item.text); } catch (eT) {}
                                    App.sendToModel(chat.el, chat);
                                } else if (item.files && item.files.length) {
                                    // 纯图片/文件：走主管线发送
                                    try { App.sendToModel(chat.el, chat); } catch (e) {}
                                }
                            } catch (e) { console.error('[批量问题] 发送失败 #' + (i + 1), e); }
                            // 发完本条，隔 500ms 再创建下一个
                            setTimeout(function () { createOne(i + 1); }, 500);
                        }
                        // 图片走 FileReader 异步读取，必须等暂存图片就绪再发送（与主对话 waitForPendingImages 一致）
                        if (typeof App.waitForPendingImages === 'function') {
                            App.waitForPendingImages(chat.el, doSend);
                        } else {
                            doSend();
                        }
                    } catch (e) { console.error('[批量问题] 发送失败 #' + (i + 1), e); }
                }, 500);
            }

            function finish() {
                if (created.length) {
                    toast('已批量创建 ' + created.length + ' 个对话并发送' + (failed ? '（失败 ' + failed + ' 个）' : ''));
                } else if (failed) {
                    toast('批量创建全部失败（共 ' + failed + ' 个），请检查页面状态后重试');
                }
                if (created.length || failed) {
                    // 视口自动平移：若新窗区右缘超出屏幕，把视口推过去看得到第一个新对话
                    try {
                        if (typeof App.canvasSetView === 'function' && typeof App.canvasGetView === 'function') {
                            var v = App.canvasGetView();
                            var firstEl = created[0].el && created[0].el.getBoundingClientRect ? created[0].el : null;
                            if (firstEl && (v.scale || 1) === 1) {
                                var fr = firstEl.getBoundingClientRect();
                                var vw = window.innerWidth || 1280;
                                var vh = window.innerHeight || 800;
                                var outH = fr.right > vw - 20 || fr.left < 0;
                                var outV = fr.bottom > vh - 20 || fr.top < 0;
                                if (outH || outV) {
                                    var tx = v.x, ty = v.y;
                                    if (outH) tx += (vw * 0.5 - (fr.left + Math.min(fr.width, vw) / 2));
                                    if (outV || fr.top < 0) ty += (80 - fr.top);
                                    App.canvasSetView(Math.round(tx), Math.round(ty), 1, true);
                                }
                            }
                        }
                    } catch (e) { console.warn('[批量问题] 视口平移失败', e); }
                    Store.addLog('info', '', 'batch', '批量问题：创建 ' + created.length + ' 个对话' + (failed ? '，失败 ' + failed : '') + '（继承模型 ' + modelName(srcModel) + '）');
                }
            }

            createOne(0); // 逐个创建：每个间隔 500ms
        }
    }
    // 入口：等 App 就绪后往新建对话按钮旁边插「批量」按钮
    // 【v3 已按需移除】该全局入口放错位置，批量入口已下沉到「创建对话框」面板每条线路右侧
    function injectEntry() { return true; }

    function boot() {
        if (injectEntry()) return;
        var tries = 0;
        var timer = setInterval(function() {
            tries++;
            if (injectEntry() || tries > 40) clearInterval(timer);
        }, 500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    window.ZfBatchQuestions = { open: openBatchDialog };

    // ===== 【v2】每个对话框右侧「📚 批量」按钮 + 双击面板打开 =====
    // 批量对话继承该对话的模型/引擎/项目（把该对话作为 src 传给 openBatchDialog）
    function chatOfBox(box) {
        try {
            if (window.App && App.chatBoxes) {
                for (var i = 0; i < App.chatBoxes.length; i++) {
                    if (App.chatBoxes[i] && App.chatBoxes[i].el === box) return App.chatBoxes[i];
                }
            }
        } catch (e) {}
        return null;
    }

    function injectPerChatbox(box) {
        if (!box || box.dataset.zfBatchBtn) return;
        box.dataset.zfBatchBtn = '1';
        var chat = chatOfBox(box);

        // ① 双击 header 面板打开批量
        var hdr = box.querySelector('.chatbox-header');
        if (hdr && !hdr.dataset.zfBatchDbl) {
            hdr.dataset.zfBatchDbl = '1';
            hdr.addEventListener('dblclick', function (e) {
                if (e.target.closest('.hd-btn, .model-picker-btn, button, input, textarea, .header-actions')) return;
                openBatchDialog(chatOfBox(box));
            });
        }

        // ② 【v4 已按需移除】每个对话框右上角/右侧悬浮「批量」按钮（用户要求去掉）
        // 只保留双击标题栏打开批量的入口
    }

    // 扫描已有 + 新建的对话（MutationObserver 兜底动态创建的窗口）
    function scanChatboxes() {
        document.querySelectorAll('.chatbox').forEach(injectPerChatbox);
    }
    function bootPerChat() {
        scanChatboxes();
        var mo = new MutationObserver(function () { scanChatboxes(); });
        try {
            var host = document.getElementById('canvasContent') || document.getElementById('canvasArea') || document.body;
            mo.observe(host, { childList: true, subtree: false });
        } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootPerChat);
    else bootPerChat();
})();
