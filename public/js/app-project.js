// ========== app-project.js - 独立项目面板（右侧侧边栏，支持项目分组管理对话） ==========
// v1.0 — 从对话框内嵌面板重构为全局侧边栏，支持项目CRUD + 对话分组
Object.assign(App, {

    // ===== 项目面板状态 =====
    _projPanelOpen: false,
    _projExpanded: {},      // { projId: true/false }
    _projChatVisible: {},   // { projId: num_visible }
    _projAllProjects: [],
    _projAllNodes: [],
    _projSortMode: 'time',
    _projSortDir: 'desc',
    _projSearchQ: '',
    _activeProjectId: null,  // 当前选中的项目ID（新建对话自动归入此项目）
    _projPanelResizing: false,
    _projPanelResizeStartX: 0,
    _projPanelResizeStartWidth: 340,

    // ===== 打开/关闭面板 =====
    // 兼容旧调用 toggleProjectPanel(box, chat) — 忽略参数，打开独立侧边栏
    toggleProjectPanel: function(box, chat) {
        if (this._projPanelOpen) {
            this.closeProjectPanel();
        } else {
            this.openProjectPanel();
        }
    },

    openProjectPanel: function() {
        var panel = document.getElementById('projPanel');
        if (!panel) return;
        panel.classList.add('open');
        // 修复（5.0.1）：面板初始 translateX(100%) 在视口外，Chromium 合成器可能
        // 跳过其图层重绘 ->「状态已开但画面不显示」。CSS 已加 will-change:transform，
        // 这里再强制同步回流 + 直接写内联 transform + 触发布局读取，三重保险。
        void panel.offsetWidth;
        panel.style.transform = 'translateX(0)';
        panel.getBoundingClientRect();
        var projBtn = document.getElementById('projectBtn');
        if (projBtn) projBtn.classList.add('active');
        var overlay = document.getElementById('projPanelOverlay');
        if (overlay) overlay.classList.add('open');
        this._projPanelOpen = true;
        this._loadActiveProject();
        this.loadProjects();
    },

    // 加载记忆中的活动项目（永久记忆：DB 优先 + localStorage 备份）
    _loadActiveProject: function() {
        var self = this;
        // 1. 先从 localStorage 快速恢复（防止 DB 离线时丢失）
        try {
            var saved = localStorage.getItem('active_project_id');
            if (saved) {
                self._activeProjectId = saved;
            }
        } catch(e) {}
        // 2. 再从 DB 加载最新值（如果在线，以 DB 为准）
        if (typeof DB !== 'undefined') {
            DB.getActiveProject().then(function(res) {
                if (res && res.ok && res.data !== null && res.data !== undefined) {
                    var pid = res.data;
                    try { pid = JSON.parse(pid); } catch(e) {}
                    self._activeProjectId = pid || null;
                    // 同步到 localStorage
                    try {
                        if (self._activeProjectId) {
                            localStorage.setItem('active_project_id', self._activeProjectId);
                            try { UserSettings.set('active_project_id', self._activeProjectId); } catch (e) {}
                        } else {
                            localStorage.removeItem('active_project_id');
                        }
                    } catch(e) {}
                }
            }).then(function() {
                // 修复（5.0.1）：DB 值异步到达后刷新面板高亮（单选圆点），
                // 否则启动竞态窗口内打开面板会显示旧状态
                try {
                    if (self._projPanelOpen) self._renderProjects();
                    if (typeof self._updateAllChatProjectBtns === 'function') self._updateAllChatProjectBtns();
                } catch (e) {}
            }).catch(function() {});
        }
    },

    // 刷新所有对话框的项目按钮显示（活动项目从 DB 异步到达后调用）
    _updateAllChatProjectBtns: function() {
        if (!this.chatBoxes || !this._updateProjectBtn) return;
        for (var i = 0; i < this.chatBoxes.length; i++) {
            try { this._updateProjectBtn(this.chatBoxes[i]); } catch (e) {}
        }
    },

    // 设置当前活动项目（单选，永久保存到 DB + localStorage）
    setActiveProject: function(pid) {
        var self = this;
        if (pid === '_uncategorized') pid = null;
        this._activeProjectId = pid;
        // 写入 localStorage 作为永久备份（DB 离线时也能恢复）
        try {
            if (pid) {
                localStorage.setItem('active_project_id', pid);
                try { UserSettings.set('active_project_id', pid); } catch (e) {}
            } else {
                localStorage.removeItem('active_project_id');
            }
        } catch(e) {}
        // 写入 DB（如果在线）
        if (typeof DB !== 'undefined') {
            DB.setActiveProject(pid).catch(function() {});
        }
        Store.addLog('info', '', 'project-active', '设为当前项目: ' + (pid || '无'));
        this._renderProjects();
    },

    closeProjectPanel: function() {
        var panel = document.getElementById('projPanel');
        if (!panel) return;
        panel.classList.remove('open');
        // 清掉打开时写入的内联 transform，交还 CSS 的 translateX(100%) 过渡
        panel.style.transform = '';
        var projBtn = document.getElementById('projectBtn');
        if (projBtn) projBtn.classList.remove('active');
        var overlay = document.getElementById('projPanelOverlay');
        if (overlay) overlay.classList.remove('open');
        this._projPanelOpen = false;
    },

    // ===== 加载项目列表 =====
    loadProjects: function() {
        var self = this;
        var body = document.getElementById('projPanelBody');
        if (!body) return;
        body.innerHTML = '<div class="proj-loading">加载中…</div>';

        // 本地节点
        var localNodes = [];
        if (Store.data && Store.data.chatBoxes) {
            localNodes = Store.data.chatBoxes.map(function(b) {
                return {
                    id: b.id, title: b.title, modelId: b.modelId,
                    x: b.x, y: b.y, w: b.w, h: b.h, z: b.z,
                    collapsed: b.collapsed, scrollPos: b.scrollPos,
                    createdAt: b.createdAt, updated_at: b.createdAt,
                    projectId: b.projectId || null, project_id: b.projectId || null
                };
            });
        }

        function proceed(remoteProjects, remoteNodes) {
            self._projAllProjects = remoteProjects || [];
            self._projAllNodes = self._mergeNodes(localNodes, remoteNodes);
            // 合并本地项目（离线时）
            if (Store.data && Store.data.projects) {
                Store.data.projects.forEach(function(lp) {
                    var exists = self._projAllProjects.find(function(rp) { return rp.id === lp.id; });
                    if (!exists) {
                        self._projAllProjects.push(lp);
                    }
                });
            }
            self._renderProjects();
        }

        if (typeof DB !== 'undefined' && DB.online) {
            Promise.all([
                DB.getProjects().catch(function() { return { ok: false, data: [] }; }),
                DB.getNodes().catch(function() { return { ok: false, data: [] }; })
            ]).then(function(results) {
                var projects = (results[0] && results[0].ok && results[0].data) ? results[0].data : [];
                var remoteNodes = (results[1] && results[1].data) ? results[1].data.map(function(r) {
                    return {
                        id: r.id, title: r.title, modelId: r.model_id, model_id: r.model_id,
                        x: r.x, y: r.y, w: r.w, h: r.h, z: r.z_index,
                        collapsed: r.collapsed, scrollPos: r.scroll_pos,
                        createdAt: r.created_at, updated_at: r.updated_at,
                        projectId: r.project_id || null, project_id: r.project_id || null
                    };
                }) : [];
                proceed(projects, remoteNodes);
            }).catch(function() {
                proceed([], []);
            });
        } else {
            proceed([], []);
        }
    },

    _mergeNodes: function(local, remote) {
        var seen = {}, out = [];
        remote.forEach(function(n) {
            if (n.id && !seen[n.id]) { seen[n.id] = 1; out.push(n); }
        });
        local.forEach(function(n) {
            if (n.id && !seen[n.id]) { seen[n.id] = 1; out.push(n); }
        });
        return out;
    },

    // ===== 渲染项目列表 =====
    _renderProjects: function() {
        var self = this;
        var body = document.getElementById('projPanelBody');
        if (!body) return;

        var projects = this._projAllProjects;
        var nodes = this._projAllNodes;

        // 搜索过滤
        var q = this._projSearchQ;
        if (q) {
            nodes = nodes.filter(function(n) {
                var title = (n.title || n.id || '').toLowerCase();
                var mid = n.modelId || n.model_id || '';
                var m = mid ? (typeof Models !== 'undefined' ? Models.get(mid) : null) : null;
                var mName = m ? m.name.toLowerCase() : (mid ? mid.toLowerCase() : '未选择模型');
                return title.indexOf(q) >= 0 || mName.indexOf(q) >= 0;
            });
        }

        // 未分类节点
        var uncategorized = nodes.filter(function(n) {
            return !n.project_id && !n.projectId;
        });

        if (projects.length === 0 && uncategorized.length === 0) {
            body.innerHTML =
                '<div class="proj-empty">' +
                '<div class="proj-empty-icon">📂</div>' +
                '<div class="proj-empty-text">暂无项目</div>' +
                '<div class="proj-empty-hint">点击上方「新建项目」开始</div>' +
                '</div>';
            return;
        }

        var html = '';

        // 渲染每个项目
        projects.forEach(function(p) {
            var projNodes = nodes.filter(function(n) {
                return n.project_id === p.id || n.projectId === p.id;
            });
            // 如果搜索中且该项目无匹配节点，跳过
            if (q && projNodes.length === 0) return;
            projNodes.sort(function(a, b) {
                return self._sortNodes(a, b);
            });
            html += self._renderProjectItem(p, projNodes, false);
        });

        // 渲染未分类
        if (uncategorized.length > 0) {
            uncategorized.sort(function(a, b) {
                return self._sortNodes(a, b);
            });
            var defaultProj = { id: '_uncategorized', name: '未分类对话' };
            html += self._renderProjectItem(defaultProj, uncategorized, true);
        }

        body.innerHTML = html;
        self._bindProjectEvents();
    },

    _sortNodes: function(a, b) {
        var dir = this._projSortDir === 'asc' ? 1 : -1;
        if (this._projSortMode === 'title') {
            var ta = (a.title || a.id || '').toLowerCase();
            var tb = (b.title || b.id || '').toLowerCase();
            return ta < tb ? -dir : ta > tb ? dir : 0;
        } else if (this._projSortMode === 'count') {
            return (this.countMsgs(a.id) - this.countMsgs(b.id)) * dir;
        } else {
            return ((b.updated_at || b.createdAt || 0) - (a.updated_at || a.createdAt || 0)) * dir;
        }
    },

    _renderProjectItem: function(proj, nodes, isDefault) {
        var self = this;
        var expanded = this._projExpanded[proj.id];
        var arrow = expanded ? '▼' : '▶';
        var bodyStyle = expanded ? '' : 'display:none';
        var visible = this._projChatVisible[proj.id] || 4;
        var showNodes = nodes.slice(0, visible);
        var hasMore = nodes.length > visible;

        var isActive = (this._activeProjectId === proj.id);
        var html = '<div class="proj-item' + (expanded ? ' expanded' : '') + (isActive ? ' proj-item-active' : '') + '" data-pid="' + proj.id + '">' +
            '<div class="proj-item-header">' +
                '<span class="proj-radio' + (isActive ? ' checked' : '') + '" data-pid="' + proj.id + '" title="设为当前项目（新建对话将自动归入此项目）">' + (isActive ? '●' : '○') + '</span>' +
                '<span class="proj-arrow">' + arrow + '</span>' +
                '<span class="proj-name" title="' + this._esq(proj.name) + '">' + this._esq(proj.name) + '</span>' +
                '<span class="proj-count">' + nodes.length + '</span>' +
                '<span class="proj-actions">' +
                    '<span class="proj-act-btn proj-add-chat" title="在此项目新建对话" data-pid="' + proj.id + '">➕</span>';
        if (!isDefault) {
            html += '<span class="proj-act-btn proj-rename" title="重命名" data-pid="' + proj.id + '">✏️</span>' +
                    '<span class="proj-act-btn proj-delete" title="删除项目" data-pid="' + proj.id + '">🗑</span>';
        }
        html += '</span>' +
            '</div>' +
            '<div class="proj-item-body" style="' + bodyStyle + '">';

        if (showNodes.length === 0) {
            html += '<div class="proj-no-chats">暂无对话，点击 ➕ 新建</div>';
        } else {
            showNodes.forEach(function(n) {
                var title = (n.title && n.title.indexOf('💬') === 0) ? n.title : ('💬 ' + (n.title || n.id));
                var mid = n.modelId || n.model_id || '';
                var m = mid ? (typeof Models !== 'undefined' ? Models.get(mid) : null) : null;
                var mName = m ? m.name : (mid ? mid : '未选择模型');
                var cnt = self.countMsgs(n.id);
                var t = n.updated_at || n.createdAt || 0;
                var timeStr = t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                html += '<div class="proj-chat-item" data-nid="' + n.id + '" title="点击恢复该对话">' +
                    '<div class="proj-chat-row">' +
                    '<span class="proj-chat-title" title="' + self._esq(title) + '">' + self._esq(title) + '</span>' +
                    '<span class="proj-chat-del" data-nid="' + n.id + '" title="删除对话">🗑</span>' +
                    '</div>' +
                    '<div class="proj-chat-meta">' +
                    '<span class="proj-chat-model">' + mName + '</span>' +
                    '<span class="proj-chat-dot">·</span>' +
                    '<span>' + cnt + '条</span>' +
                    '<span class="proj-chat-dot">·</span>' +
                    '<span>' + timeStr + '</span>' +
                    '</div>' +
                    '</div>';
            });
        }

        if (hasMore) {
            html += '<div class="proj-more" data-pid="' + proj.id + '">更多 ▼ (' + (nodes.length - visible) + ' 个)</div>';
        }

        html += '</div></div>';
        return html;
    },

    // ===== HTML 转义 =====
    _esq: function(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    // ===== 绑定事件 =====
    _bindProjectEvents: function() {
        var self = this;
        var body = document.getElementById('projPanelBody');
        if (!body) return;

        // 展开/收起
        body.querySelectorAll('.proj-item-header').forEach(function(header) {
            header.addEventListener('click', function(e) {
                if (e.target.closest('.proj-actions')) return;
                var item = this.closest('.proj-item');
                if (!item) return;
                var pid = item.dataset.pid;
                self._projExpanded[pid] = !self._projExpanded[pid];
                if (self._projExpanded[pid] && !self._projChatVisible[pid]) {
                    self._projChatVisible[pid] = 4;
                }
                self._renderProjects();
            });
        });

        // 单选设为当前项目
        body.querySelectorAll('.proj-radio').forEach(function(radio) {
            radio.addEventListener('click', function(e) {
                e.stopPropagation();
                self.setActiveProject(this.dataset.pid);
            });
        });

        // 新对话
        body.querySelectorAll('.proj-add-chat').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                self.addChatToProject(this.dataset.pid);
            });
        });

        // 重命名
        body.querySelectorAll('.proj-rename').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                self.renameProjectInline(this.dataset.pid);
            });
        });

        // 删除项目
        body.querySelectorAll('.proj-delete').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                self.deleteProject(this.dataset.pid);
            });
        });

        // 点击对话项恢复
        body.querySelectorAll('.proj-chat-item').forEach(function(item) {
            item.addEventListener('click', function(e) {
                if (e.target.classList.contains('proj-chat-del')) return;
                e.stopPropagation();
                self.restoreChatFromProject(this.dataset.nid);
            });
        });

        // 删除对话
        body.querySelectorAll('.proj-chat-del').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var nid = this.dataset.nid;
                ConfirmDialog.confirm({
                    title: '删除对话',
                    message: '确定删除此对话？删除后不可恢复。',
                    okText: '删除', danger: true
                }).then(function(ok) {
                    if (ok) self.deleteChatFromProject(nid);
                });
            });
        });

        // 更多
        body.querySelectorAll('.proj-more').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var pid = this.dataset.pid;
                self._projChatVisible[pid] = (self._projChatVisible[pid] || 4) + 4;
                self._renderProjects();
            });
        });
    },

    // ===== 新建项目（直接打开文件夹选择器，文件夹名=项目名）=====
    createNewProject: function() {
        var self = this;
        // 直接打开文件夹选择器，不再先提示输入名称
        self._openFolderPicker(null, null, null, function(folderPath) {
            // 从路径中提取文件夹名称作为项目名称
            var parts = folderPath.split(/[\\/]/);
            var folderName = '';
            for (var i = parts.length - 1; i >= 0; i--) {
                if (parts[i].trim()) { folderName = parts[i].trim(); break; }
            }
            if (!folderName) folderName = '新项目';

            var now = Date.now();
            var localProjId = 'proj_' + now;

            // 先本地创建
            if (!Store.data.projects) Store.data.projects = [];
            Store.data.projects.push({ id: localProjId, name: folderName, created_at: now, updated_at: now });

            // 服务端创建项目 + 关联文件夹
            if (typeof DB !== 'undefined' && DB.online) {
                DB.createProject(folderName).then(function(res) {
                    var projId = (res && res.ok && res.id) ? res.id : localProjId;
                    // 替换本地临时ID为服务端ID
                    var p = Store.data.projects.find(function(p) { return p.id === localProjId; });
                    if (p) p.id = projId;

                    // 关联文件夹到项目
                    DB.linkFolder(projId, folderPath).then(function() {
                        Store.addLog('info', '', 'project-create', '创建项目: ' + folderName + ' (文件夹: ' + folderPath + ')');
                        self.loadProjects();
                        // 设为当前活动项目
                        self.setActiveProject(projId);
                        // 打开文件夹
                        DB.openProjectFolder(projId).catch(function() {});
                    }).catch(function() {
                        self.loadProjects();
                    });
                }).catch(function() {
                    self.loadProjects();
                });
            } else {
                self.loadProjects();
            }

            Store.addLog('info', '', 'project-create', '创建项目: ' + folderName);
        });
    },

    // ===== 重命名项目（内联编辑）=====
    renameProjectInline: function(pid) {
        var self = this;
        if (pid === '_uncategorized') return;

        var item = document.querySelector('.proj-item[data-pid="' + pid + '"]');
        if (!item) return;
        var nameEl = item.querySelector('.proj-name');
        if (!nameEl) return;
        var oldName = nameEl.textContent;

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'proj-rename-input';
        input.value = oldName;
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        function save() {
            var newName = input.value.trim();
            if (newName && newName !== oldName) {
                self.doRenameProject(pid, newName);
            } else {
                self._renderProjects();
            }
        }
        input.addEventListener('blur', save);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = oldName; input.blur(); }
        });
    },

    doRenameProject: function(pid, newName) {
        var self = this;
        // 本地
        if (Store.data.projects) {
            var p = Store.data.projects.find(function(p) { return p.id === pid; });
            if (p) { p.name = newName; p.updated_at = Date.now(); }
        }
        var ap = this._projAllProjects.find(function(p) { return p.id === pid; });
        if (ap) { ap.name = newName; }

        // 服务端
        if (typeof DB !== 'undefined' && DB.online) {
            DB.renameProject(pid, newName).catch(function() {});
        }
        Store.addLog('info', '', 'project-rename', '重命名项目: ' + newName);
        this._renderProjects();
    },

    // ===== 删除项目 =====
    deleteProject: async function(pid) {
        var self = this;
        if (pid === '_uncategorized') return;

        var ok = await ConfirmDialog.confirm({
            title: '删除项目',
            message: '确定删除此项目？\n项目内的对话不会被删除，将归入"未分类"。',
            okText: '删除', danger: true
        });
        if (!ok) return;

        // 本地
        if (Store.data.projects) {
            Store.data.projects = Store.data.projects.filter(function(p) { return p.id !== pid; });
        }
        this._projAllProjects = this._projAllProjects.filter(function(p) { return p.id !== pid; });

        // 清除节点的 project_id
        if (Store.data && Store.data.chatBoxes) {
            Store.data.chatBoxes.forEach(function(b) {
                if (b.projectId === pid) {
                    b.projectId = null;
                    Store.saveChatBox({ id: b.id, el: null, modelId: b.modelId, projectId: null, createdAt: b.createdAt });
                }
            });
        }
        this._projAllNodes.forEach(function(n) {
            if (n.project_id === pid || n.projectId === pid) {
                n.project_id = null;
                n.projectId = null;
            }
        });

        // 服务端
        if (typeof DB !== 'undefined' && DB.online) {
            DB.deleteProject(pid).catch(function() {});
        }

        // 如果删除的是当前活动项目，清除选择
        if (self._activeProjectId === pid) {
            self._activeProjectId = null;
            if (typeof DB !== 'undefined' && DB.online) {
                DB.setActiveProject('').catch(function() {});
            }
        }
        Store.addLog('info', '', 'project-delete', '删除项目: ' + pid);
        this._renderProjects();
    },


    // ===== 在项目中新建对话 =====
    addChatToProject: function(pid) {
        var self = this;
        var projName = '';
        if (pid === '_uncategorized') {
            projName = '未分类';
        } else {
            var p = this._projAllProjects.find(function(p) { return p.id === pid; });
            projName = p ? p.name : '';
        }

        // 在画布中央创建新对话
        var canvasArea = document.getElementById('canvasArea');
        var cx = canvasArea ? canvasArea.clientWidth / 2 : window.innerWidth / 2;
        var cy = canvasArea ? canvasArea.clientHeight / 2 : window.innerHeight / 2;
        var chat = this.createChatBox(cx, cy, null);

        // 设置项目关联
        if (chat && pid !== '_uncategorized') {
            chat.projectId = pid;
            // 更新 Store
            for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                if (Store.data.chatBoxes[i].id === chat.id) {
                    Store.data.chatBoxes[i].projectId = pid;
                    break;
                }
            }
            // 保存到服务端（带 project_id）
            if (typeof DB !== 'undefined' && DB.online) {
                DB.setNodeProject(chat.id, pid).catch(function() {});
            }
            Store.addLog('info', chat.id, 'project-assign', '对话归入项目: ' + projName);
        }

        // 刷新面板
        setTimeout(function() { self.loadProjects(); }, 300);
    },

    // ===== 从项目面板恢复对话 =====
    restoreChatFromProject: function(nid) {
        // 查找节点数据
        var node = null;
        for (var i = 0; i < this._projAllNodes.length; i++) {
            if (this._projAllNodes[i].id === nid) {
                node = this._projAllNodes[i];
                break;
            }
        }
        if (!node) return;

        // 如果对话框已在画布上，直接激活
        for (var j = 0; j < this.chatBoxes.length; j++) {
            if (this.chatBoxes[j].id === nid) {
                this.activate(this.chatBoxes[j].el);
                return;
            }
        }

        // 否则从历史恢复
        this.restoreHistoryNode(node);
    },

    // ===== 从项目删除对话 =====
    deleteChatFromProject: function(nid) {
        var self = this;

        // 从内存删除
        if (Store.data && Store.data.chatBoxes) {
            Store.data.chatBoxes = Store.data.chatBoxes.filter(function(b) { return b.id !== nid; });
        }
        Store.clearMessages(nid);

        // 从画布删除（如果存在）
        for (var i = 0; i < this.chatBoxes.length; i++) {
            if (this.chatBoxes[i].id === nid) {
                var el = this.chatBoxes[i].el;
                if (el && el.parentNode) el.parentNode.removeChild(el);
                this.chatBoxes.splice(i, 1);
                break;
            }
        }

        // 服务端删除
        if (typeof DB !== 'undefined' && DB.online) {
            DB.deleteNode(nid).catch(function() {});
            DB.clearChatHistory(nid).catch(function() {});
        }

        Store.addLog('info', nid, 'delete', '从项目删除对话');
        this._renderProjects();
        this.updateStatus();
        this.updateMinimap();
    },

    // ===== 搜索/排序事件绑定（在 HTML 初始化时调用）=====
    _bindProjPanelHeader: function() {
        var self = this;

        // 新建项目按钮
        var newBtn = document.getElementById('projNewBtn');
        if (newBtn) {
            newBtn.addEventListener('click', function() {
                self.createNewProject();
            });
        }

        // 关闭按钮
        var closeBtn = document.getElementById('projCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                self.closeProjectPanel();
            });
        }

        // 搜索框
        var searchInput = document.getElementById('projSearchInputPrimary') || document.getElementById('projSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                self._projSearchQ = this.value.trim().toLowerCase();
                self._renderProjects();
            });
        }

        // 排序按钮
        var sortBtns = document.querySelectorAll('.proj-sort-btn');
        sortBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var mode = this.dataset.sort;
                if (self._projSortMode === mode) {
                    self._projSortDir = self._projSortDir === 'desc' ? 'asc' : 'desc';
                } else {
                    self._projSortMode = mode;
                    self._projSortDir = 'desc';
                }
                self._updateSortButtons();
                self._renderProjects();
            });
        });
    },

    _bindProjectPanelResize: function() {
        var self = this;
        var panel = document.getElementById('projPanel');
        if (!panel) return;
        if (panel.dataset.resizeBound === 'true') return;
        panel.dataset.resizeBound = 'true';
        // → 关闭按钮的 click 事件被吞掉 → "项目管理关闭不上"
        var applyWidth = function(width) {
            var minWidth = 280;
            var maxWidth = Math.max(minWidth, window.innerWidth - 40);
            var safeWidth = Math.min(Math.max(Math.round(width), minWidth), maxWidth);
            panel.style.setProperty('--proj-panel-width', safeWidth + 'px');
            return safeWidth;
        };
        // 恢复上次保存的面板宽度
        try {
            var savedWidth = Number(UserSettings.get('project_panel_width'));
            if (Number.isFinite(savedWidth) && savedWidth > 0) applyWidth(savedWidth);
        } catch (e) {}
        var RESIZE_ZONE = 8;
        panel.addEventListener('pointerdown', function(event) {
            if (event.button !== 0) return;
            if (event.clientX > panel.getBoundingClientRect().left + RESIZE_ZONE) return;
            // 进入"准备拖拽"状态，但先不调 setPointerCapture / preventDefault
            // 等用户在 pointermove 中真正移动后才升级为正式拖拽，避免吞掉相邻元素的 click
            self._projPanelResizing = 'pending';
            self._projPanelResizeStartX = event.clientX;
            self._projPanelResizeStartWidth = panel.getBoundingClientRect().width;
            self._projPanelResizePointerId = event.pointerId;
        });
        panel.addEventListener('pointermove', function(event) {
            // pending 状态：如果用户开始移动，升级为正式 resizing
            if (self._projPanelResizing === 'pending') {
                var dx = Math.abs(event.clientX - self._projPanelResizeStartX);
                if (dx < 3) return; // 移动不到 3px 视为点击，不升级
                // 升级为正式拖拽
                self._projPanelResizing = true;
                panel.classList.add('resizing');
                try {
                    panel.setPointerCapture(self._projPanelResizePointerId);
                    event.preventDefault();
                } catch (e) {}
            }
            if (self._projPanelResizing !== true) return;
            var minWidth = 280;
            var maxWidth = Math.max(minWidth, window.innerWidth - 40);
            var width = self._projPanelResizeStartWidth + self._projPanelResizeStartX - event.clientX;
            applyWidth(width);
        });
        var stopResize = function(event) {
            if (self._projPanelResizing === 'pending') {
                // 从未升级为正式拖拽 → 是普通点击，不做任何事（让 click 正常触发）
                self._projPanelResizing = false;
                self._projPanelResizeStartX = undefined;
                self._projPanelResizeStartWidth = undefined;
                self._projPanelResizePointerId = undefined;
                return;
            }
            if (self._projPanelResizing !== true) return;
            self._projPanelResizing = false;
            panel.classList.remove('resizing');
            try { panel.releasePointerCapture(event.pointerId); } catch (e) {}
            try { UserSettings.set('project_panel_width', String(Math.round(panel.getBoundingClientRect().width))); } catch (e) {}
        };
        panel.addEventListener('pointerup', stopResize);
        panel.addEventListener('pointercancel', stopResize);
        // ✅ 兜底：pointerleave 时也强制清理 resizing 状态，防止卡住
        panel.addEventListener('pointerleave', function(event) {
            if (self._projPanelResizing === 'pending') {
                self._projPanelResizing = false;
            }
        });
        window.addEventListener('beforeunload', function() {
            try { UserSettings.set('project_panel_width', String(Math.round(panel.getBoundingClientRect().width))); } catch (e) {}
        });
    },

    _updateSortButtons: function() {
        var arrow = this._projSortDir === 'desc' ? '▼' : '▲';
        var btns = document.querySelectorAll('.proj-sort-btn');
        var self = this;
        btns.forEach(function(btn) {
            var mode = btn.dataset.sort;
            if (mode === self._projSortMode) {
                btn.classList.add('active');
                var arrowEl = btn.querySelector('.sort-arrow');
                if (arrowEl) arrowEl.textContent = arrow;
            } else {
                btn.classList.remove('active');
                var arrowEl2 = btn.querySelector('.sort-arrow');
                if (arrowEl2) arrowEl2.textContent = '';
            }
        });
    },

    // ===== 初始化（在页面加载完成后调用）=====
    _initProjectPanel: function() {
        this._bindProjPanelHeader();
        this._bindProjectPanelResize();

        var projectBtn = document.getElementById('projectBtn');
        if (projectBtn && !projectBtn.dataset.projectBound) {
            projectBtn.dataset.projectBound = 'true';
            projectBtn.addEventListener('click', function() { App.toggleProjectPanel(); });
        }
        // 点击遮罩关闭
        var overlay = document.getElementById('projPanelOverlay');
        if (overlay) {
            overlay.addEventListener('click', function() {
                App.closeProjectPanel();
            });
        }

        // 启动时立即加载已保存的活动项目（永久记忆）
        this._loadActiveProject();
    }
});
