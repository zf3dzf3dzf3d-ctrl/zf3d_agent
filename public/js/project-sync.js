// ========== project-sync.js - 统一项目同步系统（5.0.4 重写） ==========
// 核心思想：全应用只有一个"活动项目"状态 App.activeProject = {id, name}。
// 任何地方切换项目（项目面板单选 / 文件树钉住 / 文件树"我的项目" / 对话框📁切换器）
// 只需调用 App.setActiveProjectUnified(id, name)，它做三件事：
//   1. 更新内存状态 + localStorage（同步备份，防止刷新丢失）
//   2. 广播 projectchange 事件（document 级，所有订阅者各自刷新 UI）
//   3. 同步当前激活对话的项目归属
// 所有显示处（对话框📁按钮 .proj-label、面板高亮）只监听事件，不做兜底猜测。
// 修复：热更新/脚本乱序时 App 可能尚未创建，必须先挂到 window 上，否则
// Object.assign(undefined) 会抛异常导致整个文件失效（emitProjectChange 未定义）。
window.App = window.App || {};
Object.assign(App, {

    // ===== 唯一的状态入口 =====
    activeProject: { id: null, name: '' },

    // 【修复 5.0.8】_activeProjectId 不能放进 Object.assign（assign 会立即求值 getter，
    // 把它落成静态普通属性，之后永不更新 → 新建对话被归入旧项目）。
    // 移到文件末尾用 Object.defineProperty 挂真正的访问器，实时映射 activeProject.id。

    // ===== 切换活动项目（唯一入口）=====
    // opts.skipChatSync = true：不把全局活动项目反写进当前激活对话（用于 📁 切换器自己已设好归属的场景，
    // 防止全局状态劫持其他对话框的项目选择）
    setActiveProjectUnified: function(pid, pname, opts) {
        pid = pid || null;
        opts = opts || {};
        var prev = this.activeProject ? String(this.activeProject.id || '') : '';
        var next = String(pid || '');
        if (prev === next) {
            // id 相同也要刷新名称（首次钉住未关联文件夹 → 之后关联项目的情况）
            if (pname && this.activeProject && this.activeProject.name !== pname) {
                this.activeProject.name = pname;
                this._persistActiveProject();
                this._broadcastProjectChange();
            }
            return;
        }
        this.activeProject = { id: pid, name: pname || this._lookupProjectName(pid) || '' };
        this._persistActiveProject();
        if (!opts.skipChatSync) this._syncActiveChatProject(pid);
        this._broadcastProjectChange();
        Store.addLog('info', '', 'project-active', '设为当前项目: ' + (this.activeProject.name || pid || '无'));
    },

    // ===== 持久化：localStorage（主）+ DB（辅，离线不阻塞）=====
    _persistActiveProject: function() {
        try {
            var pid = this.activeProject.id;
            if (pid) {
                localStorage.setItem('active_project_id', pid);
                // 名称也存一份，刷新后项目列表未加载时按钮能立即显示
                localStorage.setItem('active_project_name', this.activeProject.name || '');
            } else {
                localStorage.removeItem('active_project_id');
                localStorage.removeItem('active_project_name');
            }
        } catch (e) {}
        try { if (typeof DB !== 'undefined' && DB.setActiveProject) DB.setActiveProject(this.activeProject.id).catch(function(){}); } catch (e) {}
        try { if (typeof UserSettings !== 'undefined' && UserSettings.set && this.activeProject.id) UserSettings.set('active_project_id', this.activeProject.id); } catch (e) {}
    },

    // ===== 从项目列表反查名称 =====
    _lookupProjectName: function(pid) {
        if (!pid) return '';
        var lists = [];
        if (this._projAllProjects) lists.push(this._projAllProjects);
        if (Store.data && Store.data.projects) lists.push(Store.data.projects);
        for (var i = 0; i < lists.length; i++) {
            for (var j = 0; j < lists[i].length; j++) {
                if (String(lists[i][j].id) === String(pid)) return lists[i][j].name || '';
            }
        }
        return '';
    },

    // ===== 同步当前激活对话的项目归属 =====
    _syncActiveChatProject: function(pid) {
        try {
            var act = null;
            if (this.chatBoxes) {
                for (var i = 0; i < this.chatBoxes.length; i++) {
                    var cb = this.chatBoxes[i];
                    if (cb && cb.el && cb.el.classList.contains('active')) { act = cb; break; }
                }
            }
            if (act && String(act.projectId || '') !== String(pid || '')) {
                act.projectId = pid || null;
                if (Store.data && Store.data.chatBoxes) {
                    for (var k = 0; k < Store.data.chatBoxes.length; k++) {
                        if (Store.data.chatBoxes[k].id === act.id) { Store.data.chatBoxes[k].projectId = pid || null; break; }
                    }
                }
                if (typeof DB !== 'undefined' && DB.online && DB.setNodeProject) {
                    DB.setNodeProject(act.id, pid || '').catch(function(){});
                }
                Store.addLog('info', act.id, 'project-switch', '跟随当前项目: ' + (this.activeProject.name || pid || '无'));
            }
        } catch (e) {}
    },

    // ===== 广播事件（document 级 projectchange）=====
    _broadcastProjectChange: function() {
        var detail = { id: this.activeProject.id, name: this.activeProject.name };
        try { document.dispatchEvent(new CustomEvent('projectchange', { detail: detail })); } catch (e) {}
    },

    // 供旧代码直接调用的快捷广播（已设置好 App.activeProject 后调用）
    emitProjectChange: function() {
        this._persistActiveProject();
        this._syncActiveChatProject(this.activeProject.id);
        this._broadcastProjectChange();
    },

    // ===== 启动：从 localStorage 恢复（刷新后立即有值，不等 DB）=====
    restoreActiveProject: function() {
        try {
            var pid = localStorage.getItem('active_project_id');
            var pname = localStorage.getItem('active_project_name') || '';
            if (!pid) {
                // 兜底：从文件树记忆恢复
                var ft = JSON.parse(localStorage.getItem('ft_last_proj') || 'null');
                if (ft && ft.id) { pid = ft.id; pname = ft.name || pname; }
            }
            if (pid) {
                this.activeProject = { id: pid, name: pname || this._lookupProjectName(pid) };
                // 名称空则异步从 DB 补
                if (!this.activeProject.name && typeof DB !== 'undefined' && DB.getProjects) {
                    var self = this;
                    DB.getProjects().then(function(res) {
                        if (res && res.ok && res.data) {
                            self._projAllProjects = res.data;
                            var n = self._lookupProjectName(pid);
                            if (n && n !== self.activeProject.name) {
                                self.activeProject.name = n;
                                self._broadcastProjectChange();
                            }
                        }
                    }).catch(function(){});
                }
                this._broadcastProjectChange();
            }
        } catch (e) {}
    },

    // ===== 订阅：所有 UI 显示处统一在这里注册 =====
    initProjectSync: function() {
        var self = this;
        if (this._projSyncInited) return;
        this._projSyncInited = true;
        this.restoreActiveProject();

        // 【修复 5.0.5】启动时若 DB 已在线，异步以 DB 中的活动项目为准补一次恢复。
        // 之前只有打开项目面板才恢复，新建对话/发消息时上下文显示「项目: (未指定)」。
        try {
            if (typeof DB !== 'undefined' && DB.getActiveProject) {
                DB.getActiveProject().then(function(res) {
                    if (!res || !res.ok || res.data === null || res.data === undefined) return;
                    var pid = res.data;
                    try { pid = JSON.parse(pid); } catch (e) {}
                    // 【修复】DB 空串视为无记录，不覆盖 localStorage 记忆
                    if (pid === '' || pid === '""') return;
                    if (pid && (!self.activeProject || !self.activeProject.id)) {
                        var pname = self._lookupProjectName(pid);
                        self.activeProject = { id: pid, name: pname };
                        self._persistActiveProject();
                        self._broadcastProjectChange();
                        // 项目列表可能后到，名称为空时再异步补一次
                        if (!pname && typeof DB.getProjects === 'function') {
                            DB.getProjects().then(function(r2) {
                                if (r2 && r2.ok && r2.data) {
                                    self._projAllProjects = r2.data;
                                    var n = self._lookupProjectName(pid);
                                    if (n) { self.activeProject.name = n; self._persistActiveProject(); self._broadcastProjectChange(); }
                                }
                            }).catch(function(){});
                        }
                    }
                }).catch(function(){});
            }
        } catch (e) {}

        document.addEventListener('projectchange', function(e) {
            var d = (e && e.detail) || {};
            var pid = d.id || null;
            var pname = d.name || '';

            // 1) 刷新所有对话框📁按钮：与 📁 点击逻辑一致——chat.projectId（本对话自己的）优先，
            //    仅在无归属时才显示活动项目。避免"显示 A 实际打开 B"。
            if (self.chatBoxes) {
                for (var i = 0; i < self.chatBoxes.length; i++) {
                    var chat = self.chatBoxes[i];
                    if (!chat || !chat.el) continue;
                    var btn = chat.el.querySelector('[data-act="project"]');
                    if (!btn) continue;
                    var labelEl = btn.querySelector('.proj-label');
                    // 本对话自己的项目优先，其次活动项目
                    var _cp = chat.projectId || pid || null;
                    var _cn = '';
                    if (chat.projectId) {
                        var _cproj = null;
                        if (self._projAllProjects) _cproj = self._projAllProjects.find(function(pp){ return String(pp.id) === String(chat.projectId); });
                        if (!_cproj && Store.data && Store.data.projects) _cproj = Store.data.projects.find(function(pp){ return String(pp.id) === String(chat.projectId); }) || null;
                        _cn = _cproj ? (_cproj.name || chat.projectId) : chat.projectId;
                    } else if (pname) {
                        _cn = pname;
                    } else if (pid) {
                        _cn = pid;
                    }
                    if (_cn) {
                        btn.title = '当前项目: ' + _cn + '（点击切换）';
                        if (labelEl) labelEl.textContent = String(_cn).substring(0, 4);
                        btn.classList.remove('no-project');
                    } else {
                        btn.title = '切换项目';
                        if (labelEl) labelEl.textContent = '切换项目';
                        btn.classList.add('no-project');
                    }
                    // 对话归属与显示项目一致时高亮
                    if (_cp && String(chat.projectId || '') === String(_cp)) {
                        btn.classList.add('proj-pinned');
                    } else {
                        btn.classList.remove('proj-pinned');
                    }
                }
            }

            // 2) 刷新项目面板高亮（单选圆点）
            try {
                if (self._projPanelOpen && typeof self._renderProjects === 'function') self._renderProjects();
            } catch (e2) {}
        });
    },
});

// 【修复 5.0.8】真正的访问器挂载（见文件顶部注释）：实时映射 App.activeProject.id
Object.defineProperty(App, '_activeProjectId', {
    get: function () { return App.activeProject ? App.activeProject.id : null; },
    set: function (v) { if (App.activeProject) App.activeProject.id = v || null; },
    configurable: true,
    enumerable: true,
});
