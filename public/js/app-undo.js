// ========== app-undo.js - 左上角画布菜单（保存/打开工作区 JSON + 撤销/重做） ==========
// 设计：按钮位于朱峰社区 logo 右侧 30px，保存/打开收进下拉菜单。
// 后端：/api/workspace/save、/api/workspace/list、/api/workspace/load（JSON 文件存于 private/workspace/）。
(function () {
    'use strict';

    // ===== 撤销/重做历史栈 =====
    var undoStack = [];
    var redoStack = [];
    var MAX_HISTORY = 100;
    var _undoing = false; // 撤销/重做执行期间禁止再记录，防循环

    var CanvasMenu = {
        // ===== 初始化：注入左上角按钮 + 快捷键 =====
        init: function () {
            var self = this;
            // 等待 topbar 出现（bootScreen 之后）
            function tryInject(attempts) {
                var title = document.querySelector('.topbar-title');
                if (!title) {
                    if (attempts > 40) return;
                    setTimeout(function () { tryInject(attempts + 1); }, 250);
                    return;
                }
                self._injectBtn(title);
            }
            tryInject(0);

            // 快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
            document.addEventListener('keydown', function (e) {
                if (!(e.ctrlKey || e.metaKey)) return;
                var k = (e.key || '').toLowerCase();
                var inInput = /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '');
                if (inInput) return;
                if (k === 'z' && !e.shiftKey) { e.preventDefault(); self.undo(); }
                else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); self.redo(); }
            });

            // 点击其他区域关闭菜单
            document.addEventListener('mousedown', function (e) {
                var menu = document.getElementById('canvasMenuDropdown');
                var btn = document.getElementById('canvasMenuBtn');
                if (menu && menu.style.display === 'block' &&
                    !menu.contains(e.target) && !(btn && btn.contains(e.target))) {
                    menu.style.display = 'none';
                }
            });
        },

        _injectBtn: function (titleEl) {
            var self = this;
            var btn = document.createElement('button');
            btn.id = 'canvasMenuBtn';
            btn.className = 'topbar-icon';
            btn.title = '画布：保存 / 打开 / 撤销 / 重做';
            btn.textContent = '🗂️';
            // 整个标题（logo + 文字）右侧 30px
            btn.style.marginLeft = '30px';
            btn.style.fontSize = '15px';
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                self.toggleMenu();
            });
            titleEl.appendChild(btn);

            // 下拉菜单容器
            var menu = document.createElement('div');
            menu.id = 'canvasMenuDropdown';
            menu.style.cssText = 'display:none;position:fixed;top:0;left:0;z-index:10000;min-width:240px;' +
                'background:var(--bg-card,#1e1e1e);border:1px solid var(--border,#333);border-radius:10px;' +
                'box-shadow:0 8px 32px rgba(0,0,0,0.45);padding:6px;font-size:13px;color:var(--text,#eee);';
            document.body.appendChild(menu);
        },

        toggleMenu: function () {
            var menu = document.getElementById('canvasMenuDropdown');
            if (!menu) return;
            if (menu.style.display === 'block') { menu.style.display = 'none'; return; }
            this.renderMenu();
            var btn = document.getElementById('canvasMenuBtn');
            var r = btn.getBoundingClientRect();
            menu.style.top = (r.bottom + 6) + 'px';
            menu.style.left = r.left + 'px';
            menu.style.display = 'block';
        },

        _item: function (label, hint, onclick, disabled) {
            var d = document.createElement('div');
            d.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:16px;' +
                'padding:8px 12px;border-radius:6px;cursor:' + (disabled ? 'default' : 'pointer') + ';' +
                (disabled ? 'opacity:0.4;' : '');
            d.innerHTML = '<span>' + label + '</span><span style="font-size:11px;color:var(--text2,#888);">' + hint + '</span>';
            if (!disabled) {
                d.addEventListener('mouseenter', function () { d.style.background = 'var(--bg,#2a2a2a)'; });
                d.addEventListener('mouseleave', function () { d.style.background = ''; });
                d.addEventListener('click', function () {
                    document.getElementById('canvasMenuDropdown').style.display = 'none';
                    onclick();
                });
            }
            return d;
        },

        _sep: function () {
            var s = document.createElement('div');
            s.style.cssText = 'height:1px;background:var(--border,#333);margin:5px 8px;';
            return s;
        },

        renderMenu: function () {
            var self = this;
            var menu = document.getElementById('canvasMenuDropdown');
            if (!menu) return;
            menu.innerHTML = '';

            menu.appendChild(this._item('✨ 新建', '清空画布', function () { self.newWorkspace(); }, false));
            menu.appendChild(this._item('💾 保存', 'Ctrl+S', function () { self.saveWorkspace(); }, false));
            menu.appendChild(this._item('📂 打开', '', function () { self.showWorkspaceList(); }, false));

            menu.appendChild(this._sep());
            menu.appendChild(this._item('↩️ 撤销', 'Ctrl+Z', function () { self.undo(); }, undoStack.length === 0));
            menu.appendChild(this._item('↪️ 重做', 'Ctrl+Y', function () { self.redo(); }, redoStack.length === 0));

            menu.appendChild(this._sep());
            // 版本备份（快照）
            menu.appendChild(this._item('📸 创建快照', '保存当前状态', function () {
                if (typeof App.createBackup === 'function') { App.createBackup(); }
            }, false));
            menu.appendChild(this._item('⚙️ 备份管理', '', function () {
                if (typeof App.showBackupPanel === 'function') { App.showBackupPanel(); }
            }, false));

            menu.appendChild(this._sep());
            var status = document.createElement('div');
            status.style.cssText = 'padding:4px 12px;font-size:11px;color:var(--text2,#888);';
            status.textContent = '可撤销 ' + undoStack.length + ' 步';
            menu.appendChild(status);

            // 底部：重启 / 退出
            menu.appendChild(this._sep());
            var sysRow = document.createElement('div');
            sysRow.style.cssText = 'display:flex;gap:6px;padding:2px 6px 4px;';
            var btnRestart = document.createElement('div');
            btnRestart.style.cssText = 'flex:1;text-align:center;padding:7px 0;border-radius:6px;cursor:pointer;background:var(--bg2,#2a2a2a);font-size:12px;';
            btnRestart.textContent = '🔄 重启服务';
            btnRestart.addEventListener('click', function () { menu.style.display = 'none'; self.restartApp(); });
            var btnQuit = document.createElement('div');
            btnQuit.style.cssText = 'flex:1;text-align:center;padding:7px 0;border-radius:6px;cursor:pointer;background:var(--bg2,#2a2a2a);font-size:12px;color:var(--red,#ef5350);';
            btnQuit.textContent = '⏻ 退出服务';
            btnQuit.addEventListener('click', function () { menu.style.display = 'none'; self.quitApp(); });
            sysRow.appendChild(btnRestart);
            sysRow.appendChild(btnQuit);
            menu.appendChild(sysRow);
        },

        // ===== 新建：清空当前画布（先自动保存一份，再清空所有节点/消息/项目） =====
        newWorkspace: function () {
            var self = this;
            if (typeof App === 'undefined' || typeof DB === 'undefined') return;
            var doNew = function () {
                App._toast('⏳ 正在新建画布...', 'info');
                // 先自动保存当前画布，防止误删
                var backup = self._collectState().then(function (state) {
                    var name = 'workspace_auto_' + new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '');
                    return App._apiPost('/api/workspace/save', { name: name, data: state });
                }).catch(function () {});
                var nodes = (Store.data && Store.data.chatBoxes) ? Store.data.chatBoxes.slice() : [];
                var jobs = [];
                nodes.forEach(function (b) {
                    jobs.push(DB.deleteNode(b.id));
                    if (b.id) jobs.push(DB.clearChatHistory(b.id));
                });
                jobs.push(DB.saveCanvasView(0, 0, 1));
                Promise.all(jobs.map(function (p) { return p.catch(function () {}); })).then(function () {
                    return backup;
                }).then(function () {
                    self.clearHistory();
                    App._toast('✅ 已新建画布（原画布已自动保存），即将刷新...', 'ok');
                    setTimeout(function () { location.reload(); }, 900);
                });
            };
            var confirmFix = function (opts, fallbackMsg, doAction) {
                if (App._confirmDialog) {
                    // _confirmDialog 返回 Promise（resolve(true)=确认 / resolve(false)=取消）
                    App._confirmDialog(opts).then(function (ok) {
                        if (ok) doAction();
                    });
                } else if (window.confirm(fallbackMsg)) doAction();
            };
            confirmFix({
                title: '新建画布',
                icon: '✨',
                confirmText: '新建并清空',
                html: '<b style="color:var(--red,#ef5350)">此操作将清空当前画布的全部节点与消息！</b><br>' +
                      '<span style="font-size:12px;color:var(--text2,#888)">为防误删，清空前会自动把当前画布保存一份到「打开历史」，可随时找回。</span><br>' +
                      '<span style="font-size:12px;color:var(--text2,#888)">确定要继续吗？</span>'
            }, '将清空当前画布（会自动保存一份），确定？', doNew);
        },

        // ===== 重启服务 =====
        restartApp: function () {
            if (typeof App === 'undefined' || !App._apiPost) return;
            var doRestart = function () {
                App._toast('🔄 正在重启服务，请稍候...', 'info');
                App._apiPost('/api/app/restart', {}).then(function () {
                    // 轮询等服务回来后刷新
                    var tries = 0;
                    var timer = setInterval(function () {
                        tries++;
                        fetch('/', { cache: 'no-store' }).then(function (r) {
                            if (r.ok) { clearInterval(timer); location.reload(); }
                        }).catch(function () {});
                        if (tries > 60) clearInterval(timer);
                    }, 1000);
                }).catch(function (err) {
                    App._toast('❌ 重启失败: ' + err.message, 'err');
                });
            };
            if (App._confirmDialog) {
                App._confirmDialog({ title: '重启服务', icon: '🔄', confirmText: '重启', html: '确定重启朱峰社区智能体服务？<br><span style="font-size:12px;color:var(--text2)">重启期间页面会短暂不可用，完成后自动恢复。</span>' }).then(function (ok) { if (ok) doRestart(); });
            } else if (window.confirm('确定重启服务？')) doRestart();
        },

        // ===== 退出服务 =====
        quitApp: function () {
            if (typeof App === 'undefined' || !App._apiPost) return;
            var doQuit = function () {
                App._apiPost('/api/app/quit', {}).then(function () {
                    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#eee;font-size:16px;background:#111;">服务已退出，可关闭此页面。</div>';
                }).catch(function (err) {
                    App._toast('❌ 退出失败: ' + err.message, 'err');
                });
            };
            if (App._confirmDialog) {
                App._confirmDialog({ title: '退出服务', icon: '⏻', confirmText: '退出', html: '<b style="color:var(--red,#ef5350)">确定退出朱峰社区智能体服务？</b><br><span style="font-size:12px;color:var(--text2)">退出后页面将不可用，需手动重新启动程序。</span>' }).then(function (ok) { if (ok) doQuit(); });
            } else if (window.confirm('确定退出服务？')) doQuit();
        },

        // ===== 收集当前画布状态（节点 + 消息 + 视口 + 项目），序列化为 JSON =====
        _collectState: function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                if (typeof Store === 'undefined' || !Store.data) { reject(new Error('Store 未就绪')); return; }
                var data = Store.data;
                // 【修复】Store.data.chatBoxes 仅在 saveChatBox 后才有内容；
                // 真实运行中的对话在 App.chatBoxes，此处优先采集 App.chatBoxes（含 DOM 位置），避免保存后打开画布为空。
                var boxes = [];
                if (typeof App !== 'undefined' && Array.isArray(App.chatBoxes) && App.chatBoxes.length > 0) {
                    boxes = App.chatBoxes.map(function (c) {
                        var el = c.el;
                        return {
                            id: c.id, title: c.title || (el && el.querySelector('.title') ? el.querySelector('.title').textContent : '') || '',
                            modelId: c.modelId || '', modelIdOverride: c._modelIdOverride || c.modelIdOverride || '',
                            reasoningEffort: c._reasoningEffort || c.reasoningEffort || '', engine: c._engine || '',
                            x: el ? (parseFloat(el.style.left) || 0) : (c.x || 0),
                            y: el ? (parseFloat(el.style.top) || 0) : (c.y || 0),
                            w: el ? (el.offsetWidth || 360) : (c.w || 360),
                            h: el ? (el.offsetHeight || 480) : (c.h || 480),
                            collapsed: el ? el.classList.contains('collapsed') : !!c.collapsed,
                            z: el ? (parseInt(el.style.zIndex) || 50) : (c.z || 0),
                            toolCategory: (typeof Tools !== 'undefined' && Tools.chatCategories && Tools.chatCategories[c.id]) || c.toolCategory || null,
                            projectId: c.projectId || null, createdAt: c.createdAt || null
                        };
                    });
                } else if (data.chatBoxes && data.chatBoxes.length > 0) {
                    boxes = (data.chatBoxes || []).map(function (b) {
                        return {
                            id: b.id, title: b.title || '', modelId: b.modelId || '',
                            modelIdOverride: b.modelIdOverride || '', reasoningEffort: b.reasoningEffort || '',
                            x: b.x, y: b.y, w: b.w || 0, h: b.h || 0,
                            collapsed: !!b.collapsed, z: b.z || 0,
                            toolCategory: b.toolCategory || null,
                            projectId: b.projectId || null, createdAt: b.createdAt || null
                        };
                    });
                }
                var canvas = data.canvas || { x: 0, y: 0, scale: 1 };
                var projects = data.projects || [];
                // 附带每个节点的消息（从内存取）
                var messages = {};
                Object.keys(data.messages || {}).forEach(function (sid) {
                    messages[sid] = (data.messages[sid] || []).map(function (m) {
                        return { role: m.role, content: m.content, type: m.type || 'text', ts: m.ts || null };
                    });
                });
                // 风筝节点（图片/提示词节点）
                var kite = null;
                try {
                    // 优先走 KiteCanvas 公开 API，避免依赖内部命名空间
                    var nodesList = (window.KiteCanvas && typeof window.KiteCanvas.list === 'function')
                        ? window.KiteCanvas.list() : null;
                    if (!nodesList && window.__KiteNS && window.__KiteNS.state
                        && window.__KiteNS.state.nodes && typeof window.__KiteNS.state.nodes.forEach === 'function') {
                        nodesList = [];
                        window.__KiteNS.state.nodes.forEach(function (node) { nodesList.push(node); });
                    }
                    if (Array.isArray(nodesList) || nodesList && typeof nodesList.forEach === 'function') {
                        kite = [];
                        nodesList.forEach(function (node) {
                            kite.push({
                                id: node.id, type: node.type, x: node.x, y: node.y,
                                w: node.w || 0, h: node.h || 0,
                                ratio: node.ratio || 0, text: node.text || '', prompt: node.prompt || node.text || '',
                                src: self._mediaSrc(node)
                            });
                        });
                    }
                } catch (e) {}
                resolve({
                    app: 'zhufeng-community-agent-infinite',
                    type: 'workspace',
                    version: 1,
                    savedAt: new Date().toISOString(),
                    canvas: canvas,
                    chatBoxes: boxes,
                    messages: messages,
                    projects: projects,
                    kiteNodes: kite
                });
            });
        },

        // ===== 保存（JSON 工作区文件，存于 private/workspace/，可自定义文件名） =====
        saveWorkspace: function (customName) {
            if (typeof App === 'undefined' || !App._apiPost) return;
            var self = this;
            var doSave = function (name) {
                self._collectState().then(function (state) {
                    App._toast('⏳ 正在保存画布...', 'info');
                    // 默认名：画布_2026-08-28_1917（本地时间，比 ISO 时间戳可读）
                    function _defaultName() {
                        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
                        return '画布_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
                    }
                    var finalName = (name || '').trim() || _defaultName();
                    return App._apiPost('/api/workspace/save', { name: finalName, data: state });
                }).then(function (res) {
                    if (res && res.ok) {
                        App._toast('✅ 已保存: ' + (res.filename || 'workspace.json') + '（private/workspace/）', 'ok');
                    } else {
                        App._toast('❌ 保存失败: ' + ((res && res.error) || '未知错误'), 'err');
                    }
                }).catch(function (err) {
                    if (App._toast) App._toast('❌ 保存失败: ' + err.message, 'err');
                });
            };
            if (customName !== undefined) { doSave(customName); return; }
            // 弹输入框让用户命名（默认画布_日期_时间）
            var _d = new Date(), _p = function (n) { return (n < 10 ? '0' : '') + n; };
            var def = '画布_' + _d.getFullYear() + '-' + _p(_d.getMonth() + 1) + '-' + _p(_d.getDate()) + '_' + _p(_d.getHours()) + _p(_d.getMinutes());
            if (window.ConfirmDialog && typeof window.ConfirmDialog.prompt === 'function') {
                window.ConfirmDialog.prompt({
                    title: '保存画布', message: '保存为 JSON 文件（存于 private/workspace/）\n留空则自动按时间命名',
                    value: def, placeholder: '文件名（如 我的项目）', okText: '保存'
                }).then(function (name) { if (name !== null && name !== undefined) doSave(name || def); });
            } else {
                var v = window.prompt('保存文件名（存于 private/workspace/，留空自动命名）:', def);
                if (v === null) return;
                doSave(v);
            }
        },

        // ===== 打开（卡片式列出已保存的 JSON 工作区文件） =====
        showWorkspaceList: function () {
            if (typeof App === 'undefined' || !App._apiGet) return;
            var self = this;
            App._apiGet('/api/workspace/list').then(function (res) {
                var files = (res && res.ok) ? (res.files || res.workspaces || []) : [];
                var menu = document.getElementById('canvasMenuDropdown');
                if (!menu) return;
                menu.innerHTML = '';
                menu.style.minWidth = '320px';
                // 修复：点击「打开」时 _item 的 click 已把菜单 display:none，这里必须重新显示并定位，否则列表永远不可见
                menu.style.display = 'block';
                var btn0 = document.getElementById('canvasMenuBtn');
                if (btn0) {
                    var r0 = btn0.getBoundingClientRect();
                    menu.style.top = (r0.bottom + 6) + 'px';
                    menu.style.left = r0.left + 'px';
                }
                var head = document.createElement('div');
                head.style.cssText = 'padding:8px 12px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;gap:8px;';
                head.innerHTML = '<span>📂 选择要打开的画布</span>';
                var back = document.createElement('span');
                back.textContent = '← 返回';
                back.style.cssText = 'font-size:11px;color:var(--blue,#4fc3f7);cursor:pointer;font-weight:normal;white-space:nowrap;';
                back.addEventListener('click', function () { menu.style.minWidth = '240px'; self.renderMenu(); });
                head.appendChild(back);
                menu.appendChild(head);
                menu.appendChild(self._sep());

                if (files.length === 0) {
                    var empty = document.createElement('div');
                    empty.style.cssText = 'padding:16px 12px;color:var(--text2,#888);font-size:12px;';
                    empty.textContent = '暂无保存，先「保存」一次';
                    menu.appendChild(empty);
                    return;
                }
                files.slice(0, 20).forEach(function (f) {
                    // 卡片：左侧图标+文件名+时间大小，右侧删除
                    var card = document.createElement('div');
                    card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;margin:3px 6px;border-radius:8px;cursor:pointer;' +
                        'background:var(--bg2,rgba(255,255,255,0.04));border:1px solid transparent;transition:background .15s,border-color .15s;';
                    card.addEventListener('mouseenter', function () { card.style.background = 'var(--bg3,rgba(255,255,255,0.08))'; card.style.borderColor = 'var(--blue,#4fc3f7)'; });
                    card.addEventListener('mouseleave', function () { card.style.background = 'var(--bg2,rgba(255,255,255,0.04))'; card.style.borderColor = 'transparent'; });
                    var main = document.createElement('div');
                    main.style.cssText = 'flex:1;min-width:0;';
                    var displayName = (f.filename || '').replace(/\.json$/i, '');
                    main.innerHTML =
                        '<div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📄 ' + self._esqHtml(displayName) + '</div>' +
                        '<div style="font-size:11px;color:var(--text2,#888);margin-top:2px;">' + (f.display_time || '') + ' · ' + (f.size_human || '') + '</div>';
                    var del = document.createElement('div');
                    del.textContent = '🗑️';
                    del.title = '删除此历史';
                    del.style.cssText = 'cursor:pointer;padding:6px;border-radius:6px;font-size:13px;opacity:0.5;flex-shrink:0;';
                    del.addEventListener('mouseenter', function () { del.style.opacity = '1'; });
                    del.addEventListener('mouseleave', function () { del.style.opacity = '0.5'; });
                    del.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var doDel = function () {
                            fetch('/api/workspace/delete?name=' + encodeURIComponent(f.filename), { method: 'DELETE' })
                                .then(function (r) { return r.json(); })
                                .then(function (res) {
                                    if (res && res.ok) { App._toast('🗑️ 已删除: ' + f.filename, 'ok'); self.showWorkspaceList(); }
                                    else App._toast('❌ 删除失败', 'err');
                                });
                        };
                        if (App._confirmDialog) {
                            App._confirmDialog({ title: '删除历史', icon: '🗑️', confirmText: '删除', html: '确定删除 <b>' + self._esqHtml(f.filename) + '</b>？<br><span style="font-size:12px;color:var(--text2)">删除后不可恢复。</span>' }).then(function (ok) { if (ok) doDel(); });
                        } else if (window.confirm('确定删除 ' + f.filename + '？')) doDel();
                    });
                    card.appendChild(main);
                    card.appendChild(del);
                    card.addEventListener('click', function () { menu.style.display = 'none'; self.loadWorkspace(f.filename); });
                    menu.appendChild(card);
                });
                // 底部：打开文件夹（维护保存路径）
                menu.appendChild(self._sep());
                var folderRow = document.createElement('div');
                folderRow.style.cssText = 'padding:4px 12px 8px;font-size:11px;color:var(--text2,#888);display:flex;justify-content:space-between;align-items:center;gap:8px;';
                folderRow.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📁 private/workspace/</span>';
                var openBtn = document.createElement('span');
                openBtn.textContent = '打开文件夹';
                openBtn.style.cssText = 'color:var(--blue,#4fc3f7);cursor:pointer;white-space:nowrap;flex-shrink:0;';
                openBtn.addEventListener('click', function () {
                    menu.style.display = 'none';
                    App._apiGet('/api/workspace/open-folder').then(function (r) {
                        if (r && r.ok) App._toast('📁 已打开保存文件夹', 'ok');
                        else App._toast('❌ 打开失败: ' + ((r && r.error) || ''), 'err');
                    }).catch(function () {});
                });
                folderRow.appendChild(openBtn);
                menu.appendChild(folderRow);
            }).catch(function (err) {
                if (App._toast) App._toast('❌ 列表加载失败: ' + err.message, 'err');
            });
        },

        _esqHtml: function (s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        // ===== 读取 JSON 并恢复整个画布 =====
        loadWorkspace: function (filename) {
            if (typeof App === 'undefined') return;
            var self = this;
            var doLoad = function () {
                App._toast('⏳ 正在打开画布，请稍候...', 'info');
                App._apiGet('/api/workspace/load?name=' + encodeURIComponent(filename)).then(function (res) {
                    if (res && res.ok && res.data) {
                        return self._applyState(res.data).then(function () {
                            self.clearHistory();
                            App._toast('✅ 已打开: ' + filename + '，即将刷新页面...', 'ok');
                            setTimeout(function () { location.reload(); }, 900);
                        });
                    } else {
                        App._toast('❌ 打开失败: ' + ((res && res.error) || '无效文件'), 'err');
                    }
                }).catch(function (err) {
                    App._toast('❌ 打开失败: ' + err.message, 'err');
                });
            };
            if (App._confirmDialog) {
                App._confirmDialog({
                    title: '打开画布',
                    icon: '📂',
                    confirmText: '打开',
                    html: '将用 <b style="color:var(--blue)">' + filename + '</b> <b style="color:var(--red,#ef5350)">覆盖当前画布</b>（含全部节点与消息）。<br>' +
                          '<span style="font-size:12px;color:var(--text2)">当前未保存的内容将丢失，刷新后生效。确定继续吗？</span>'
                }).then(function (ok) { if (ok) doLoad(); });
            } else if (window.confirm) {
                if (window.confirm('将用 ' + filename + ' 覆盖当前画布，确定？')) doLoad();
            }
        },

        // ===== 把 JSON 数据写回 SQLite（后台会识别并在刷新时恢复） =====
        _applyState: function (state) {
            return new Promise(function (resolve, reject) {
                if (typeof DB === 'undefined') { reject(new Error('DB 未就绪')); return; }
                var jobs = [];
                // 【修复】先清掉画布上已不存在于存档中的旧节点，避免打开后残留旧内容
                var keepIds = {};
                (state.chatBoxes || []).forEach(function (b) { if (b.id) keepIds[b.id] = true; });
                try {
                    if (typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.chatBoxes)) {
                        Store.data.chatBoxes.forEach(function (b) {
                            if (b.id && !keepIds[b.id]) jobs.push(DB.deleteNode(b.id).catch(function () {}));
                        });
                    }
                } catch (e) {}
                // 清理画布上的风筝节点（DOM 层），刷新后按存档重建
                try {
                    var NS = window.__KiteNS;
                    if (NS && NS.state && NS.state.nodes && typeof NS.state.nodes.forEach === 'function') {
                        if (window.KiteCanvas && typeof window.KiteCanvas.clear === 'function') window.KiteCanvas.clear();
                    }
                } catch (e) {}
                // 画布视口
                if (state.canvas) {
                    jobs.push(DB.saveCanvasView(state.canvas.x || 0, state.canvas.y || 0, state.canvas.scale || 1));
                }
                // 节点
                (state.chatBoxes || []).forEach(function (b) {
                    jobs.push(DB.saveNode(b));
                });
                // 消息
                Object.keys(state.messages || {}).forEach(function (sid) {
                    (state.messages[sid] || []).forEach(function (m) {
                        jobs.push(DB.addChatMessage(sid, m.role, m.content, '', null, m.ts));
                    });
                });
                // 【修复】恢复风筝画布节点（图片/视频/提示词）：_applyState 发生在刷新前，
                // 直接建 DOM 会随刷新丢失 → 先存入 localStorage，页面加载后由启动恢复逻辑重建
                try {
                    localStorage.setItem('zf3d_workspace_kite_restore', JSON.stringify(state.kiteNodes || []));
                } catch (e) {}
                Promise.all(jobs.map(function (p) { return p.catch(function () {}); }))
                    .then(resolve, reject);
            });
        },

        // ================================================================
        // ===== 撤销/重做核心 =====
        // ================================================================
        record: function (op) {
            if (_undoing) return;
            op.ts = Date.now();
            undoStack.push(op);
            if (undoStack.length > MAX_HISTORY) undoStack.shift();
            redoStack.length = 0;
        },

        clearHistory: function () { undoStack.length = 0; redoStack.length = 0; },

        undo: function () {
            var op = undoStack.pop();
            if (!op) return;
            _undoing = true;
            try { this._apply(op, true); } catch (e) { console.warn('[CanvasMenu] undo failed:', e); }
            _undoing = false;
            redoStack.push(op);
            if (typeof App !== 'undefined' && App._toast) {
                App._toast('↩️ 已撤销: ' + (op.label || op.type), 'info');
            }
        },

        redo: function () {
            var op = redoStack.pop();
            if (!op) return;
            _undoing = true;
            try { this._apply(op, false); } catch (e) { console.warn('[CanvasMenu] redo failed:', e); }
            _undoing = false;
            undoStack.push(op);
            if (typeof App !== 'undefined' && App._toast) {
                App._toast('↪️ 已重做: ' + (op.label || op.type), 'info');
            }
        },

        // 执行或回退一条操作。undoDir=true 表示回退，false 表示重做
        _apply: function (op, undoDir) {
            var K = (typeof window.__KiteNS !== 'undefined') ? window.__KiteNS : null;
            switch (op.type) {
                case 'chat-create':
                    // 回退=关闭该框；重做=重新创建
                    if (undoDir) {
                        var chat = this._findChat(op.chatId);
                        if (chat) App.closeChatBox(chat);
                    } else {
                        this._recreateChat(op);
                    }
                    break;
                case 'chat-close':
                    // 回退=恢复该框；重做=再次关闭
                    if (undoDir) {
                        this._recreateChat(op);
                    } else {
                        var c2 = this._findChat(op.box.id);
                        if (c2) App.closeChatBox(c2);
                    }
                    break;
                case 'kite-add':
                    if (undoDir) { if (K && K.removeNode) K.removeNode(op.nodeId); }
                    else { if (K && K.addNode) K.addNode(op.data); }
                    break;
                case 'kite-remove':
                    if (undoDir) { if (K && K.addNode) K.addNode(op.data); }
                    else { if (K && K.removeNode) K.removeNode(op.data.id || op.nodeId); }
                    break;
                case 'chat-move':
                    var chat3 = this._findChat(op.chatId);
                    if (chat3 && chat3.el) {
                        var pos = undoDir ? op.from : op.to;
                        chat3.el.style.left = pos.x + 'px';
                        chat3.el.style.top = pos.y + 'px';
                        if (typeof Store !== 'undefined') Store.saveChatBox(chat3, true);
                    }
                    break;
                // 'viewport'（平移画布）已移除：摄像机平移不参与撤销/重做
            }
        },

        _findChat: function (id) {
            if (typeof App === 'undefined' || !App.chatBoxes) return null;
            return App.chatBoxes.find(function (c) { return c.id === id; }) || null;
        },

        // 从快照数据重建对话框（含历史消息）
        _recreateChat: function (op) {
            var box = op.box || {};
            var chat = App.createChatBox(box.clientX || 200, box.clientY || 200, box.modelId || null);
            if (!chat) return;
            // 恢复位置
            if (chat.el && box.x != null) {
                chat.el.style.left = box.x + 'px';
                chat.el.style.top = box.y + 'px';
            }
            if (box.title && App.updateChatTitle) App.updateChatTitle(chat.el, box.title);
            // 先复用原 ID，再按该 ID 存消息，保证内存/DB 键一致（会话连续）
            if (box.id) chat.id = box.id;
            // 恢复历史消息（内存 + DB）
            var msgs = op.messages || [];
            if (typeof Store !== 'undefined' && typeof DB !== 'undefined') {
                Store.data.messages[chat.id] = msgs.slice();
                msgs.forEach(function (m) {
                    DB.addChatMessage(chat.id, m.role, m.content, m.type || 'text').catch(function () {});
                });
            }
            // 渲染消息气泡到对话框（与 buildBoxFromNode 的恢复逻辑一致）
            var body = (chat.el && chat.el.querySelector) ? chat.el.querySelector('.chatbox-body') : null;
            if (body && msgs.length && typeof App.setMsgContent === 'function') {
                msgs.forEach(function (m) {
                    if (m.type === 'typing' || m.type === 'tool_call') return;
                    var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                    var div = document.createElement('div');
                    div.className = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
                    App.setMsgContent(div, m.content, whoCls);
                    body.appendChild(div);
                });
                body.scrollTop = body.scrollHeight;
                var fuUndo = body.querySelector('.msg.user');
                if (fuUndo && typeof App.updateChatTitle === 'function') App.updateChatTitle(chat.el, '');
            }
            // 恢复 chat.history（供 AI 上下文使用）
            if (chat.history) {
                msgs.forEach(function (m) {
                    if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
                        chat.history.push({ role: m.role, content: m.content });
                    }
                });
            }
            if (box.id && typeof Store !== 'undefined') {
                Store.saveChatBox(chat, true);
            }
        }
    };

    // ===== 拦截点：Hook 注入（在 App/Store 就绪后包装原函数） =====
    function installHooks() {
        if (typeof App === 'undefined' || typeof Store === 'undefined') {
            setTimeout(installHooks, 300);
            return;
        }

        // --- 1. 对话框创建 ---
        if (typeof App.createChatBox === 'function') {
            var origCreate = App.createChatBox;
            App.createChatBox = function (clientX, clientY, modelId) {
                var chat = origCreate.apply(this, arguments);
                if (chat && !_undoing) {
                    var box = _boxSnapshot(chat);
                    CanvasMenu.record({
                        type: 'chat-create', label: '创建对话框',
                        chatId: chat.id,
                        clientX: clientX, clientY: clientY, modelId: modelId,
                        box: box, messages: []
                    });
                }
                return chat;
            };
        }

        // --- 2. 对话框关闭（记录完整数据含消息，便于撤销恢复） ---
        if (typeof App.closeChatBox === 'function') {
            var origClose = App.closeChatBox;
            App.closeChatBox = function (chat) {
                if (chat && !_undoing) {
                    var box = _boxSnapshot(chat);
                    var msgs = [];
                    if (typeof Store !== 'undefined' && Store.data && Store.data.messages[chat.id]) {
                        msgs = Store.data.messages[chat.id].map(function (m) {
                            return { role: m.role, content: m.content, type: m.type || 'text' };
                        });
                    }
                    CanvasMenu.record({
                        type: 'chat-close', label: '关闭对话框',
                        chatId: chat.id, box: box, messages: msgs
                    });
                }
                return origClose.apply(this, arguments);
            };
        }

        // --- 3. 对话框移动（拖拽结束经 Store.saveChatBox 持久化，取位置变化） ---
        if (typeof Store.saveChatBox === 'function') {
            var origSaveBox = Store.saveChatBox;
            Store.saveChatBox = function (chat, flushNow) {
                if (chat && !_undoing && Store.data) {
                    var prev = null;
                    for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                        if (Store.data.chatBoxes[i].id === chat.id) { prev = Store.data.chatBoxes[i]; break; }
                    }
                    var nx = chat.el ? (parseFloat(chat.el.style.left) || 0) : null;
                    var ny = chat.el ? (parseFloat(chat.el.style.top) || 0) : null;
                    if (prev && nx != null && ny != null &&
                        (Math.abs(prev.x - nx) > 2 || Math.abs(prev.y - ny) > 2)) {
                        CanvasMenu.record({
                            type: 'chat-move', label: '移动对话框',
                            chatId: chat.id,
                            from: { x: prev.x, y: prev.y },
                            to: { x: nx, y: ny }
                        });
                    }
                }
                return origSaveBox.apply(this, arguments);
            };
        }

        // --- 4. 画布视口平移：不再记录到撤销历史（平移摄像机无实际意义，避免污染撤销栈） ---

        // --- 5. 风筝节点（图片/视频/提示词）创建与删除 ---
        function hookKite() {
            var NS = window.__KiteNS;
            if (!NS || typeof NS.addNode !== 'function' || typeof NS.removeNode !== 'function') {
                setTimeout(hookKite, 300);
                return;
            }
            var origAdd = NS.addNode;
            NS.addNode = function (data) {
                var node = origAdd.apply(this, arguments);
                if (node && !_undoing) {
                    CanvasMenu.record({
                        type: 'kite-add', label: '创建节点(' + (data.type || 'image') + ')',
                        nodeId: node.id,
                        data: { type: data.type, src: data.src, text: data.text, prompt: data.prompt, x: node.x, y: node.y, ratio: data.ratio || 0 }
                    });
                }
                return node;
            };
            var origRemove = NS.removeNode;
            NS.removeNode = function (id) {
                var node = NS.state && NS.state.nodes ? NS.state.nodes.get(id) : null;
                if (node && !_undoing) {
                    CanvasMenu.record({
                        type: 'kite-remove', label: '删除节点(' + (node.type || 'image') + ')',
                        nodeId: id,
                        data: { type: node.type, src: _mediaSrc(node), text: node.text, prompt: node.text, x: node.x, y: node.y, ratio: node.ratio || 0, id: id }
                    });
                }
                return origRemove.apply(this, arguments);
            };
        }
        hookKite();
    }

    function _boxSnapshot(chat) {
        var el = chat.el;
        return {
            id: chat.id,
            x: el ? (parseFloat(el.style.left) || 0) : 0,
            y: el ? (parseFloat(el.style.top) || 0) : 0,
            clientX: el ? (el.getBoundingClientRect().left) : 200,
            clientY: el ? (el.getBoundingClientRect().top) : 200,
            title: el && el.querySelector('.title') ? el.querySelector('.title').textContent : '',
            modelId: chat.modelId || ''
        };
    }

    function _mediaSrc(node) {
        try {
            var m = node.el.querySelector('img,video');
            return m ? (m.src || '') : '';
        } catch (e) { return ''; }
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { CanvasMenu.init(); installHooks(); _restoreKiteFromWorkspace(); });
    } else {
        CanvasMenu.init();
        installHooks();
        _restoreKiteFromWorkspace();
    }

    // 【修复】打开工作区时把 kiteNodes 存入 localStorage，页面刷新后在此重建画布图片/提示词节点
    function _restoreKiteFromWorkspace() {
        var raw = null;
        try { raw = localStorage.getItem('zf3d_workspace_kite_restore'); } catch (e) {}
        if (!raw) return;
        try { localStorage.removeItem('zf3d_workspace_kite_restore'); } catch (e) {}
        var nodes = [];
        try { nodes = JSON.parse(raw) || []; } catch (e) { return; }
        if (!nodes.length) return;
        // 等 KiteCanvas 就绪后重建
        var tries = 0;
        (function tryRestore() {
            var KC = window.KiteCanvas;
            if (KC && typeof KC.addNode === 'function') {
                nodes.forEach(function (k) {
                    try {
                        var type = k.type || 'image';
                        if (type === 'text') {
                            KC.addTextNode({ text: k.text || k.prompt || '', x: k.x, y: k.y });
                        } else if (k.src) {
                            var n = KC.addNode({ type: type, src: k.src, prompt: k.prompt || '', x: k.x, y: k.y, ratio: k.ratio || 0 });
                            if (n && k.w && k.h) { n.w = k.w; n.h = k.h; n.el.style.width = k.w + 'px'; n.el.style.height = k.h + 'px'; }
                        }
                        // 无 src 的占位节点（生成中遗留）跳过
                    } catch (e) {}
                });
                if (typeof App !== 'undefined' && App.updateMinimap) App.updateMinimap();
            } else if (++tries < 40) {
                setTimeout(tryRestore, 250);
            }
        })();
    }

    // 暴露到全局供调试
    window.CanvasMenu = CanvasMenu;
})();
