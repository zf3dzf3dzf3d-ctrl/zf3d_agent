// ========== project-switcher.js - 项目切换器（📁按钮/切换对话所属项目） ==========
// 拆分自 app-chatbox-projects.js（原 1~209 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 📁 项目切换器（对话框上的📁按钮，只能切换已有项目，不能创建） =====
        showProjectSwitcher: function(box, chat) {
            var self = this;

            // 移除已存在的菜单
            var old = document.querySelector('.proj-switcher-overlay');
            if (old) old.remove();

            // 获取所有项目
            var projects = (self._projAllProjects && self._projAllProjects.length) ? self._projAllProjects.slice() : [];
            if (Store.data && Store.data.projects) {
                Store.data.projects.forEach(function(lp) {
                    var exists = projects.find(function(p) { return p.id === lp.id; });
                    if (!exists) projects.push(lp);
                });
            }

            var currentPid = chat ? String(chat.projectId || '') : '';
            // 高亮与按钮显示逻辑保持一致：本对话自己的项目优先，未关联时显示活动项目
            if (!currentPid && App.activeProject && App.activeProject.id) {
                currentPid = String(App.activeProject.id);
            }

            var anchor = box.querySelector('[data-act="project"]');
            var anchorRect = anchor ? anchor.getBoundingClientRect() : null;
            var dialogWidth = Math.min(380, window.innerWidth - 24);
            var dialogMaxHeight = Math.max(180, Math.min(window.innerHeight * 0.6, 480));
            var left = anchorRect ? Math.max(12, Math.min(anchorRect.left, window.innerWidth - dialogWidth - 12)) : Math.max(12, (window.innerWidth - dialogWidth) / 2);
            var top = anchorRect ? anchorRect.top - dialogMaxHeight - 8 : 80;
            if (top < 12 && anchorRect) top = Math.min(window.innerHeight - dialogMaxHeight - 12, anchorRect.bottom + 8);
            top = Math.max(12, top);

            var overlay = document.createElement('div');
            overlay.className = 'proj-switcher-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:transparent;z-index:99999;';

            var dialog = document.createElement('div');
            dialog.className = 'proj-switcher-dialog';
            dialog.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top + 'px;background:#2a2a3e;border-radius:8px;width:' + dialogWidth + 'px;max-height:' + dialogMaxHeight + 'px;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);overflow:hidden;';

            var headerHtml = 
                '<div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:8px;">' +
                    '<span style="font-size:16px;">📁</span>' +
                    '<span style="flex:1;font-weight:600;color:#e0e0f0;">切换项目</span>' +
                    '<button class="ps-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>' +
                '</div>';

            var bodyHtml = '<div class="ps-list" style="flex:1;overflow-y:auto;padding:8px 0;"></div>';

            dialog.innerHTML = headerHtml + bodyHtml;
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            var listEl = dialog.querySelector('.ps-list');

            function renderList() {
                var html = '';
                var isCurrentNone = !currentPid;                html += '<div class="ps-item' + (isCurrentNone ? ' ps-item-active' : '') + '" data-pid="" style="padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;color:#c0c0d0;font-size:14px;border-radius:6px;margin:2px 8px;' + (isCurrentNone ? 'background:rgba(74,108,247,0.15);' : '') + '">' +
                    '<span style="font-size:16px;">📂</span>' +
                    '<span style="flex:1;">未关联项目</span>' +
                    (isCurrentNone ? '<span style="color:var(--blue);font-size:14px;">✓</span>' : '') +
                '</div>';

                if (projects.length === 0) {
                    html += '<div class="ps-empty" style="padding:20px;text-align:center;color:#8a8aaa;font-size:13px;">暂无项目，请在右侧项目管理中创建</div>';
                } else {
                    projects.forEach(function(proj) {
                        var isCurrent = currentPid && String(currentPid) === String(proj.id);
                        html += '<div class="ps-item' + (isCurrent ? ' ps-item-active' : '') + '" data-pid="' + proj.id + '" style="padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;color:#c0c0d0;font-size:14px;border-radius:6px;margin:2px 8px;' + (isCurrent ? 'background:rgba(74,108,247,0.15);' : '') + '">' +
                            '<span style="font-size:16px;">📁</span>' +
                            '<span style="flex:1;">' + self._esq(proj.name) + '</span>' +
                            (isCurrent ? '<span style="color:var(--blue);font-size:14px;">✓</span>' : '') +
                        '</div>';
                    });
                }

                listEl.innerHTML = html;

                listEl.querySelectorAll('.ps-item').forEach(function(item) {
                    item.addEventListener('mouseenter', function() {
                        if (!this.classList.contains('ps-item-active')) {
                            this.style.background = 'rgba(255,255,255,0.06)';
                        }
                    });
                    item.addEventListener('mouseleave', function() {
                        if (!this.classList.contains('ps-item-active')) {
                            this.style.background = '';
                        }
                    });
                    item.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var pid = this.dataset.pid;
                        self._switchChatProject(chat, pid || null);
                        // 同步打开左侧文件树面板（未关联项目时不打开）
                        if (pid && typeof self.openFileTreePanel === 'function') {
                            var _p = (self._projAllProjects || []).find(function(p) { return String(p.id) === String(pid); });
                            self.openFileTreePanel(pid, _p ? _p.name : '');
                        }
                        overlay.remove();
                    });
                });
            }

            try { renderList(); } catch (e) { console.error('renderList error:', e); }

            // 【修复空白】无论在线与否，只要本地没项目就尝试从服务端拉取；DB.online 标志可能滞后于实际连接状态
            if (projects.length === 0 && typeof DB !== 'undefined' && DB.getProjects) {
                DB.getProjects().then(function(res) {
                    if (res && res.ok && res.data && res.data.length) {
                        self._projAllProjects = res.data;
                        projects = res.data.slice();
                        try { renderList(); } catch (e) { console.error('renderList error:', e); }
                    } else if (res && res.ok && (!res.data || !res.data.length)) {
                        // 服务端确实无项目，确保提示已展示
                        try { renderList(); } catch (e) {}
                    }
                }).catch(function(err) {
                    console.warn('getProjects failed:', err);
                    try { renderList(); } catch (e) {}
                });
            }

            dialog.querySelector('.ps-close').addEventListener('click', function() {
                overlay.remove();
            });
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) overlay.remove();
            });
        },

        // ===== 更新对话框项目按钮显示（5.0.4 重写：只读 App.activeProject 单一状态） =====
        _updateProjectBtn: function(chat) {
            if (!chat || !chat.el) return;
            var btn = chat.el.querySelector('[data-act="project"]');
            if (!btn) return;
            var pid = chat.projectId || null;
            var labelEl = btn.querySelector('.proj-label');
            var self = this;

            function _projNameOf(p) {
                if (!p) return '';
                return String(p.name || p.id || '').substring(0, 4);
            }
            function _findProj(p) {
                if (!p) return null;
                if (self._projAllProjects) {
                    var x = self._projAllProjects.find(function(pp){ return String(pp.id) === String(p); });
                    if (x) return x;
                }
                if (Store.data && Store.data.projects) {
                    return Store.data.projects.find(function(pp){ return String(pp.id) === String(p); }) || null;
                }
                return null;
            }

            // 唯一状态源：App.activeProject（兜底：启动竞态/未广播时从 localStorage 恢复）
            var ap = App.activeProject;
            if ((!ap || (!ap.id && !ap.name))) {
                try {
                    var _spid = localStorage.getItem('active_project_id');
                    if (_spid) {
                        ap = { id: _spid, name: localStorage.getItem('active_project_name') || '' };
                        if (!ap.name && typeof self._lookupProjectName === 'function') ap.name = self._lookupProjectName(_spid);
                    }
                } catch (e) {}
            }
            if (!ap) ap = { id: null, name: '' };
            var activePid = ap.id || null;
            var activeName = ap.name || '';

            // 【5.1.0 修复】显示逻辑与 📁 点击逻辑完全一致：chat.projectId（本对话自己选的）优先，
            // 仅当本对话未关联项目时才显示全局活动项目（此时点击也恰好打开活动项目，显示与行为一致）。
            var dispPid = pid || activePid;
            var dispName = '';
            if (pid) {
                var _dp = _findProj(pid);
                dispName = _dp ? (_dp.name || pid) : pid;
            } else if (activePid) {
                dispName = activeName || activePid;
            }
            if (dispName) {
                btn.title = '当前项目: ' + dispName + '（点击切换）';
                if (labelEl) labelEl.textContent = _projNameOf(dispName);
                btn.classList.remove('no-project');
            } else {
                btn.title = '切换项目';
                if (labelEl) labelEl.textContent = '切换项目';
                btn.classList.add('no-project');
            }
            // 对话归属与显示项目一致时高亮按钮
            if (dispPid && String(pid || '') === String(dispPid)) {
                btn.classList.add('proj-pinned');
            } else {
                btn.classList.remove('proj-pinned');
            }
            var nameEl = chat.el.querySelector('.proj-name');
            if (nameEl) {
                var chatProj = pid ? _findProj(pid) : null;
                if (pid && chatProj) {
                    nameEl.textContent = _projNameOf(chatProj);
                    nameEl.title = chatProj.name || pid;
                    nameEl.style.display = '';
                } else {
                    nameEl.textContent = '';
                    nameEl.removeAttribute('title');
                    nameEl.style.display = 'none';
                }
            }
        },

        // ===== 切换对话所属项目 =====
        _switchChatProject: function(chat, newPid) {
            if (!chat) return;
            var self = this;
            var oldPid = chat.projectId || null;
            // 统一为字符串比较（dataset.pid 是字符串，项目 id 可能是数字）
            if (String(newPid || '') === String(oldPid || '')) return;

            chat.projectId = newPid || null;

            if (Store.data && Store.data.chatBoxes) {
                for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                    if (Store.data.chatBoxes[i].id === chat.id) {
                        Store.data.chatBoxes[i].projectId = newPid || null;
                        break;
                    }
                }
            }

            if (self._projAllNodes) {
                for (var j = 0; j < self._projAllNodes.length; j++) {
                    if (self._projAllNodes[j].id === chat.id) {
                        self._projAllNodes[j].projectId = newPid || null;
                        self._projAllNodes[j].project_id = newPid || null;
                        break;
                    }
                }
            }

            if (typeof DB !== 'undefined' && DB.online) {
                if (newPid) {
                    DB.setNodeProject(chat.id, newPid).catch(function() {});
                } else {
                    DB.setNodeProject(chat.id, '').catch(function() {});
                }
            }

            // 切换成功后同步活动项目（统一项目同步系统）：按钮文字实时跟随
            // skipChatSync：本函数刚把 chat.projectId 设为 newPid，禁止全局同步再反写（含劫持其他激活对话）
            var pname = self._lookupProjectName ? self._lookupProjectName(newPid) : '';
            self.setActiveProjectUnified(newPid || null, pname, { skipChatSync: true });
            self._updateProjectBtn(chat);
            // 名称没查到（项目列表未加载/选择器刚打开就点选）：补拉一次列表再刷新按钮
            if (newPid && !pname && typeof self._refreshProjectsData === 'function') {
                self._refreshProjectsData(function() {
                    var n = self._lookupProjectName(newPid);
                    if (n && App.activeProject && String(App.activeProject.id) === String(newPid)) {
                        App.activeProject.name = n;
                        App._persistActiveProject();
                        App._broadcastProjectChange();
                    }
                    self._updateProjectBtn(chat);
                });
            }

            var projName = '未关联';
            if (newPid) {
                var p = (self._projAllProjects || []).find(function(p) { return String(p.id) === String(newPid); });
                if (!p && Store.data && Store.data.projects) {
                    p = Store.data.projects.find(function(p) { return String(p.id) === String(newPid); });
                }
                projName = p ? (p.name || newPid) : newPid;
            }
            Store.addLog('info', chat.id, 'project-switch', '切换项目: ' + projName);

            if (self._projPanelOpen) {
                self.loadProjects();
            }
        },
});
