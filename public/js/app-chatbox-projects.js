/* Project-related chatbox extensions. */
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

            var currentPid = chat ? (chat.projectId || null) : null;

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
                var isCurrentNone = !currentPid;
                html += '<div class="ps-item' + (isCurrentNone ? ' ps-item-active' : '') + '" data-pid="" style="padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;color:#c0c0d0;font-size:14px;border-radius:6px;margin:2px 8px;' + (isCurrentNone ? 'background:rgba(74,108,247,0.15);' : '') + '">' +
                    '<span style="font-size:16px;">📂</span>' +
                    '<span style="flex:1;">未关联项目</span>' +
                    (isCurrentNone ? '<span style="color:var(--blue);font-size:14px;">✓</span>' : '') +
                '</div>';

                if (projects.length === 0) {
                    html += '<div style="padding:20px;text-align:center;color:#8a8aaa;font-size:13px;">暂无项目，请在右侧项目管理中创建</div>';
                } else {
                    projects.forEach(function(proj) {
                        var isCurrent = (currentPid === proj.id);
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
                        overlay.remove();
                    });
                });
            }

            renderList();

            if (projects.length === 0 && typeof DB !== 'undefined' && DB.online) {
                DB.getProjects().then(function(res) {
                    if (res && res.ok && res.data) {
                        self._projAllProjects = res.data;
                        projects = res.data.slice();
                        renderList();
                    }
                }).catch(function() {});
            }

            dialog.querySelector('.ps-close').addEventListener('click', function() {
                overlay.remove();
            });
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) overlay.remove();
            });
        },

        // ===== 更新对话框项目按钮显示 =====
        _updateProjectBtn: function(chat) {
            if (!chat || !chat.el) return;
            var btn = chat.el.querySelector('[data-act="project"]');
            if (!btn) return;
            var pid = chat.projectId || null;
            var labelEl = btn.querySelector('.proj-label');
            if (pid) {
                var proj = null;
                if (this._projAllProjects) {
                    proj = this._projAllProjects.find(function(p) { return p.id === pid; });
                }
                if (!proj && Store.data && Store.data.projects) {
                    proj = Store.data.projects.find(function(p) { return p.id === pid; });
                }
                var fullProjName = proj ? proj.name : pid;
                var projName = String(fullProjName || '').substring(0, 4);
                btn.title = '当前项目: ' + fullProjName + '（点击切换）';
                if (labelEl) labelEl.textContent = projName;
                btn.classList.remove('no-project');
            } else {
                btn.title = '切换项目';
                if (labelEl) labelEl.textContent = '切换项目';
                btn.classList.add('no-project');
            }
            var nameEl = chat.el.querySelector('.proj-name');
            if (nameEl) {
                if (pid && projName) {
                    nameEl.textContent = projName;
                    nameEl.title = proj ? proj.name : pid;
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
            if (newPid === oldPid) return;

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

            self._updateProjectBtn(chat);

            var projName = '未关联';
            if (newPid) {
                var p = (self._projAllProjects || []).find(function(p) { return p.id === newPid; });
                if (!p && Store.data && Store.data.projects) {
                    p = Store.data.projects.find(function(p) { return p.id === newPid; });
                }
                projName = p ? p.name : newPid;
            }
            Store.addLog('info', chat.id, 'project-switch', '切换项目: ' + projName);

            if (self._projPanelOpen) {
                self.loadProjects();
            }
        },

        // ===== 📁 文件夹关联 =====
        // 从对话框打开文件夹浏览器，选择已有文件夹关联到项目
        // 从对话框打开文件夹浏览器，选择已有文件夹关联到项目
        showFolderBrowser: function(box, chat) {
            var self = this;

            // 如果当前对话已关联项目且有 folder_path，直接打开
            if (chat && chat.projectId) {
                DB.openProjectFolder(chat.projectId).then(function(r) {
                    if (r && r.ok) {
                        self.addMsg(box, '✅ 已打开项目文件夹', 'ai');
                    } else {
                        // 文件夹未关联或不存在，打开浏览器选择
                        self._openFolderPicker(box, chat, chat.projectId);
                    }
                }).catch(function() {
                    self._openFolderPicker(box, chat, chat.projectId);
                });
                return;
            }

            // 未关联项目，先创建项目再选文件夹
            var name = prompt('请输入项目名称：', '新项目');
            if (!name || !name.trim()) return;
            name = name.trim();

            var projId = 'proj_' + Date.now();
            var now = Date.now();

            if (!Store.data.projects) Store.data.projects = [];
            Store.data.projects.push({ id: projId, name: name, created_at: now, updated_at: now });

            if (typeof DB !== 'undefined' && DB.online) {
                DB.createProject(name).then(function(res) {
                    if (res && res.ok && res.id) {
                        var p = Store.data.projects.find(function(p) { return p.id === projId; });
                        if (p) p.id = res.id;
                        projId = res.id;
                    }
                    if (chat) {
                        chat.projectId = projId;
                        for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                            if (Store.data.chatBoxes[i].id === chat.id) {
                                Store.data.chatBoxes[i].projectId = projId;
                                break;
                            }
                        }
                        DB.setNodeProject(chat.id, projId).catch(function() {});
                    }
                    // 打开文件夹选择器
                    self._openFolderPicker(box, chat, projId);
                }).catch(function() {
                    self.addMsg(box, '❌ 创建项目失败，请检查后台服务', 'error');
                });
            } else {
                self.addMsg(box, '❌ 后台服务不可用', 'error');
            }

            Store.addLog('info', chat ? chat.id : '', 'project-create', '创建项目: ' + name);
        },

        // 打开文件夹选择器弹窗
        _openFolderPicker: function(box, chat, projId, onConfirm) {
            var self = this;
            var overlay = document.createElement('div');
            overlay.className = 'folder-picker-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';

            var dialog = document.createElement('div');
            dialog.className = 'folder-picker-dialog';
            dialog.style.cssText = 'background:#2a2a3e;border-radius:10px;width:620px;max-width:calc(100vw - 32px);max-height:78vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

            var currentPath = '';

            dialog.innerHTML =
                '<div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:8px;">' +
                    '<span style="font-size:16px;">📂</span>' +
                    '<span style="flex:1;font-weight:600;color:#e0e0f0;">' + (onConfirm ? '选择项目文件夹' : '选择文件夹') + '</span>' +
                    '<button class="fp-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>' +
                '</div>' +
                '<div class="fp-path-bar" style="padding:8px 16px;font-size:12px;color:#8a8aaa;border-bottom:1px solid rgba(255,255,255,0.05);word-break:break-all;">加载中...</div>' +
                '<div style="display:flex;gap:6px;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.05);flex-wrap:wrap;">' +
                    '<span class="fp-quick" data-p="C:\\Users" style="padding:4px 9px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#c0c0d0;cursor:pointer;font-size:11px;">🏠 用户</span>' +
                    '<span class="fp-quick" data-p="C:\\Users\\Administrator\\Desktop" style="padding:4px 9px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#c0c0d0;cursor:pointer;font-size:11px;">🖥️ 桌面</span>' +
                    '<span class="fp-quick" data-p="C:\\Users\\Administrator\\Downloads" style="padding:4px 9px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#c0c0d0;cursor:pointer;font-size:11px;">⬇️ 下载</span>' +
                    '<span class="fp-quick" data-p="" style="padding:4px 9px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#c0c0d0;cursor:pointer;font-size:11px;">💻 我的电脑</span>' +
                '</div>' +
                '<div class="fp-list" style="flex:1;overflow-y:auto;padding:8px 0;min-height:260px;"></div>' +
                '<div style="padding:12px 16px;border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:8px;">' +
                    '<button class="fp-up" style="flex:0 0 auto;padding:6px 12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#ccc;cursor:pointer;font-size:13px;">↑ 上一级</button>' +
                    '<input class="fp-input" type="text" placeholder="或手动输入路径..." style="flex:1;padding:6px 10px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#e0e0f0;font-size:13px;outline:none;">' +
                    '<button class="fp-confirm" style="flex:0 0 auto;padding:6px 16px;background:var(--blue);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">' + (onConfirm ? '确定' : '关联') + '</button>' +
                '</div>';

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            var pathBar = dialog.querySelector('.fp-path-bar');
            var listEl = dialog.querySelector('.fp-list');
            var upBtn = dialog.querySelector('.fp-up');
            var inputEl = dialog.querySelector('.fp-input');
            var confirmBtn = dialog.querySelector('.fp-confirm');
            var closeBtn = dialog.querySelector('.fp-close');

            dialog.querySelectorAll('.fp-quick').forEach(function(btn) {
                btn.addEventListener('click', function() { loadPath(btn.getAttribute('data-p') || ''); });
                btn.addEventListener('mouseenter', function() { btn.style.background = 'rgba(80,140,255,0.22)'; });
                btn.addEventListener('mouseleave', function() { btn.style.background = 'rgba(255,255,255,0.06)'; });
            });

            function loadPath(path) {
                pathBar.textContent = path || '请选择磁盘...';
                listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#8a8aaa;">加载中...</div>';
                DB.browseFolders(path).then(function(res) {
                    if (res && res.ok) {
                        currentPath = res.path || '';
                        pathBar.textContent = currentPath || '请选择磁盘...';
                        inputEl.value = currentPath;
                        if (!res.dirs || res.dirs.length === 0) {
                            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#8a8aaa;">此目录下没有子文件夹</div>';
                            return;
                        }
                        var html = '';
                        res.dirs.forEach(function(d) {
                            html += '<div class="fp-item" data-name="' + d + '" style="padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;color:#c0c0d0;font-size:13px;border-radius:4px;">' +
                                '<span>📁</span><span>' + d + '</span></div>';
                        });
                        listEl.innerHTML = html;
                        listEl.querySelectorAll('.fp-item').forEach(function(item) {
                            item.addEventListener('mouseenter', function() {
                                this.style.background = 'rgba(255,255,255,0.06)';
                            });
                            item.addEventListener('mouseleave', function() {
                                this.style.background = '';
                            });
                            item.addEventListener('click', function() {
                                var name = this.dataset.name;
                                var newPath = currentPath ? (currentPath + '\\' + name) : name;
                                loadPath(newPath);
                            });
                        });
                        // 保存 parent 用于"上一级"
                        dialog._parent = res.parent || '';
                    } else {
                        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#e55;">' + (res && res.error ? res.error : '加载失败') + '</div>';
                    }
                }).catch(function(err) {
                    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#e55;">网络错误</div>';
                });
            }

            upBtn.addEventListener('click', function() {
                if (dialog._parent !== undefined) {
                    loadPath(dialog._parent);
                }
            });

            inputEl.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    var val = inputEl.value.trim();
                    if (val) loadPath(val);
                }
            });

            confirmBtn.addEventListener('click', function() {
                var targetPath = inputEl.value.trim() || currentPath;
                if (!targetPath) {
                    alert('请先选择或输入文件夹路径');
                    return;
                }
                // 模式1: 通过 onConfirm 回调（项目面板新建项目时，projId=null）
                if (onConfirm) {
                    document.body.removeChild(overlay);
                    onConfirm(targetPath);
                    return;
                }
                // 模式2: 传统关联模式（有 projId 时直接关联）
                confirmBtn.disabled = true;
                confirmBtn.textContent = '关联中...';
                DB.linkFolder(projId, targetPath).then(function(res) {
                    if (res && res.ok) {
                        document.body.removeChild(overlay);
                        if (box) self.addMsg(box, '✅ 已关联文件夹：' + targetPath, 'ai');
                        // 同步更新本地缓存，否则 agent-02 查 Store.data.projects 找不到 folder_path
                        if (typeof Store !== 'undefined' && Store.data && Store.data.projects) {
                            for (var fi = 0; fi < Store.data.projects.length; fi++) {
                                if (Store.data.projects[fi].id === projId) {
                                    Store.data.projects[fi].folder_path = targetPath;
                                    break;
                                }
                            }
                        }
                        if (self._projAllProjects) {
                            for (var fj = 0; fj < self._projAllProjects.length; fj++) {
                                if (self._projAllProjects[fj].id === projId) {
                                    self._projAllProjects[fj].folder_path = targetPath;
                                    break;
                                }
                            }
                        }
                        // 打开文件夹
                        DB.openProjectFolder(projId).catch(function() {});
                    } else {
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = '关联';
                        alert(res && res.error ? res.error : '关联失败');
                    }
                }).catch(function() {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = '关联';
                    alert('网络错误，关联失败');
                });
            });

            closeBtn.addEventListener('click', function() {
                document.body.removeChild(overlay);
            });
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) document.body.removeChild(overlay);
            });

            // 初始加载根目录
            loadPath('');
        },

        // ===== 🔧 工具面板 =====
        toggleToolPanel: function(box) {
            var tp = box.querySelector('.chatbox-toolpanel');
            var body = box.querySelector('.chatbox-body');
            var btn = box.querySelector('.tool-panel-btn');
            if (!tp) return;
            if (tp.classList.contains('open')) {
                tp.classList.remove('open');
                if (body) body.style.display = '';
                if (btn) btn.innerHTML = '🔧<span class="tool-badge" style="display:none">0</span>';
            } else {
                var _lp = box.querySelector('.chatbox-logpanel');
                if (_lp) _lp.classList.remove('open');
                tp.classList.add('open');
                if (body) body.style.display = 'none';
                var tpBody = tp.querySelector('.chatbox-toolpanel-body');
                if (tpBody) tpBody.scrollTop = tpBody.scrollHeight;
                if (btn) btn.innerHTML = '💬<span class="tool-badge" style="display:none">0</span>';
                // ===== 工具统计面板：打开面板时渲染使用频率图表 + 错误汇总 =====
                try { this.renderToolStats(box); } catch (e) { console.error('[toolstats]', e); }
            }
        },

        // ===== 📊 工具统计（使用频率图表 + 出错明细 + 一键复制）=====
        _toolStatsPalette: ['#5b8cff', '#8f6bff', '#35c296', '#e8a851', '#e8657a', '#4ec3e0', '#c66bd4', '#7f95b8'],

        // 收集面板内工具卡片：调用次数、上下文文本估算（约4字符=1 token）和失败明细
        _toolStatsCollect: function(box) {
            var tp = box.querySelector('.chatbox-toolpanel');
            var body = tp ? (tp.querySelector('.chatbox-toolpanel-body') || box.querySelector('.chatbox-body')) : null;
            var counts = {}, context = {}, order = [], fails = [], total = 0, failTotal = 0, contextTotal = 0;
            if (body) {
                var cards = body.querySelectorAll('.tool-wrap');
                for (var i = 0; i < cards.length; i++) {
                    var card = cards[i];
                    var name = card.getAttribute('data-tool') || 'unknown';
                    if (!counts[name]) { counts[name] = 0; context[name] = 0; order.push(name); }
                    counts[name]++;
                    var bodyEl = card.querySelector('.tool-wrap__body');
                    var chars = bodyEl ? String(bodyEl.textContent || '').replace(/\s+/g, ' ').trim().length : 0;
                    var tokens = Math.ceil(chars / 4);
                    context[name] += tokens;
                    contextTotal += tokens;
                    total++;
                    if (card.classList.contains('tool-wrap--fail')) {
                        failTotal++;
                        var resEl = card.querySelector('.tool-wrap__result');
                        var msg = resEl ? String(resEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
                        fails.push({ name: name, msg: msg });
                    }
                }
            }
            var sorted = order.map(function(n) { return { name: n, count: counts[n] }; });
            var contextSorted = order.map(function(n) { return { name: n, tokens: context[n], count: counts[n] }; });
            sorted.sort(function(a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
            contextSorted.sort(function(a, b) { return b.tokens - a.tokens || (a.name < b.name ? -1 : 1); });
            return { total: total, failTotal: failTotal, sorted: sorted, contextSorted: contextSorted, contextTotal: contextTotal, fails: fails, kinds: order.length };
        },

        _toolStatsEsc: function(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        // 渲染统计区（不存在则注入到 header 与 body 之间）
        renderToolStats: function(box) {
            var self = this;
            var tp = box.querySelector('.chatbox-toolpanel');
            var tpBody = tp ? tp.querySelector('.chatbox-toolpanel-body') : null;
            if (!tp || !tpBody) return;

            var st = this._toolStatsCollect(box);
            var statsEl = tp.querySelector('.chatbox-toolstats');
            if (!statsEl) {
                statsEl = document.createElement('div');
                statsEl.className = 'chatbox-toolstats';
                tp.insertBefore(statsEl, tpBody);
            }
            var collapsed = statsEl.classList.contains('toolstats-collapsed');

            // ---- 频率条形图（Top 10，其余折叠为"其他"）----
            var barHtml = '';
            var show = st.sorted.slice(0, 10);
            var rest = st.sorted.length - show.length;
            var maxCount = show.length ? show[0].count : 0;
            for (var i = 0; i < show.length; i++) {
                var it = show[i];
                var pct = st.total ? (it.count * 100 / st.total) : 0;
                var width = maxCount ? Math.max(4, Math.round(it.count * 100 / maxCount)) : 4;
                var color = this._toolStatsPalette[i % this._toolStatsPalette.length];
                var icon = (typeof Tools !== 'undefined' && Tools._toolIcon) ? Tools._toolIcon(it.name) : '🔧';
                barHtml += '<div class="toolstats-row">' +
                    '<span class="toolstats-name" title="' + this._toolStatsEsc(it.name) + '">' + icon + ' ' + this._toolStatsEsc(it.name) + '</span>' +
                    '<div class="toolstats-bar"><div class="toolstats-fill" style="width:' + width + '%;background:' + color + '"></div></div>' +
                    '<span class="toolstats-count">' + it.count + '次 ' + pct.toFixed(1) + '%</span>' +
                '</div>';
            }
            if (rest > 0) barHtml += '<div class="toolstats-more">… 还有 ' + rest + ' 种工具未列出（复制可见全部）</div>';

            // ---- 上下文占用排行（按工具卡片参数+结果文本估算）----
            var contextHtml = '';
            var contextShow = st.contextSorted.slice(0, 10);
            var contextRest = st.contextSorted.length - contextShow.length;
            var maxTokens = contextShow.length ? contextShow[0].tokens : 0;
            for (var j = 0; j < contextShow.length; j++) {
                var ctx = contextShow[j];
                var contextPct = st.contextTotal ? (ctx.tokens * 100 / st.contextTotal) : 0;
                var contextWidth = maxTokens ? Math.max(4, Math.round(ctx.tokens * 100 / maxTokens)) : 4;
                var contextColor = this._toolStatsPalette[j % this._toolStatsPalette.length];
                var contextIcon = (typeof Tools !== 'undefined' && Tools._toolIcon) ? Tools._toolIcon(ctx.name) : '🔧';
                contextHtml += '<div class="toolstats-row">' +
                    '<span class="toolstats-name" title="' + this._toolStatsEsc(ctx.name) + '">' + contextIcon + ' ' + this._toolStatsEsc(ctx.name) + '</span>' +
                    '<div class="toolstats-bar"><div class="toolstats-fill" style="width:' + contextWidth + '%;background:' + contextColor + '"></div></div>' +
                    '<span class="toolstats-count">' + ctx.tokens.toLocaleString() + ' ~tok ' + contextPct.toFixed(1) + '%</span>' +
                '</div>';
            }
            if (contextRest > 0) contextHtml += '<div class="toolstats-more">… 还有 ' + contextRest + ' 种工具未列出（复制可见全部）</div>';

            // ---- 出错摘要（按工具聚合，展示最近一次错误内容）----
            var failHtml = '';
            if (st.failTotal > 0) {
                var byName = {}, failOrder = [];
                st.fails.forEach(function(f) {
                    if (!byName[f.name]) { byName[f.name] = []; failOrder.push(f.name); }
                    byName[f.name].push(f.msg);
                });
                failOrder.sort(function(a, b) { return byName[b].length - byName[a].length; });
                failHtml += '<div class="toolstats-fail-title">❌ 出错 ' + st.failTotal + ' 处 · 涉及 ' + failOrder.length + ' 个工具</div>';
                failOrder.forEach(function(n) {
                    var msgs = byName[n];
                    var last = msgs[msgs.length - 1] || '(无错误详情)';
                    failHtml += '<div class="toolstats-fail-row">' +
                        '<span class="toolstats-fail-name">' + self._toolStatsEsc(n) + ' ×' + msgs.length + '</span>' +
                        '<span class="toolstats-fail-msg" title="' + self._toolStatsEsc(msgs.join('\n---\n')) + '">' +
                            self._toolStatsEsc(last.length > 140 ? last.slice(0, 140) + '…' : last) + '</span>' +
                    '</div>';
                });
            }

            var activeView = statsEl.getAttribute('data-view') || 'usage';
            statsEl.innerHTML =
                '<div class="toolstats-header">' +
                    '<span class="toolstats-title">📊 工具统计</span>' +
                    '<span class="toolstats-sum">' + (activeView === 'context' ? '上下文约 <b>' + st.contextTotal.toLocaleString() + '</b> tokens' : '调用 <b>' + st.total + '</b> 次') + ' · <b>' + st.kinds + '</b> 种工具 · ' +
                        (st.failTotal > 0 ? '<b class="toolstats-failnum">出错 ' + st.failTotal + '</b>' : '<b>无错误</b>') + '</span>' +
                    '<span class="toolstats-tabs" role="tablist">' +
                        '<button class="toolstats-tab' + (activeView === 'usage' ? ' is-active' : '') + '" data-view="usage">调用统计</button>' +
                        '<button class="toolstats-tab' + (activeView === 'context' ? ' is-active' : '') + '" data-view="context">上下文占用</button>' +
                    '</span>' +
                    '<button class="toolstats-copy" title="复制调用统计、上下文占用排行和错误明细">📋 复制统计+错误</button>' +
                    '<button class="toolstats-toggle" title="展开 / 收起统计">' + (collapsed ? '▸' : '▾') + '</button>' +
                '</div>' +
                '<div class="toolstats-body"' + (collapsed ? ' style="display:none"' : '') + '>' +
                    (st.total === 0 ? '<div class="toolstats-empty">暂无工具调用数据，执行任务后自动统计</div>' : (activeView === 'context' ? contextHtml : barHtml + failHtml)) +
                '</div>';

            statsEl.querySelectorAll('.toolstats-tab').forEach(function(tab) {
                tab.addEventListener('click', function(e) {
                    e.stopPropagation();
                    statsEl.setAttribute('data-view', tab.getAttribute('data-view') || 'usage');
                    self.renderToolStats(box);
                });
            });
            var copyBtn = statsEl.querySelector('.toolstats-copy');
            if (copyBtn) copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                self._toolStatsCopy(box, copyBtn);
            });
            var toggleBtn = statsEl.querySelector('.toolstats-toggle');
            if (toggleBtn) toggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                statsEl.classList.toggle('toolstats-collapsed');
                self.renderToolStats(box);
            });
        },

        // 复制：使用频率排行（文本条形图）+ 出错工具及具体错误内容
        _toolStatsCopy: function(box, btn) {
            var st = this._toolStatsCollect(box);
            var lines = [];
            lines.push('===== 工具使用统计 =====');
            lines.push('总调用: ' + st.total + ' 次 | 工具种类: ' + st.kinds + ' 种 | 出错: ' + st.failTotal + ' 处');
            lines.push('');
            lines.push('【上下文占用排行】（按工具参数+结果文本估算，约4字符=1token）');
            if (st.contextSorted.length === 0) {
                lines.push('（暂无工具调用）');
            } else {
                st.contextSorted.forEach(function(it, idx) {
                    var pct = st.contextTotal ? (it.tokens * 100 / st.contextTotal) : 0;
                    lines.push((idx + 1) + '. ' + it.name + ' ' + it.tokens.toLocaleString() + ' tokens (' + pct.toFixed(1) + '%，调用' + it.count + '次)');
                });
            }
            lines.push('');
            lines.push('【工具使用频率排行】');
            if (st.sorted.length === 0) {
                lines.push('（暂无工具调用）');
            } else {
                var maxC = st.sorted[0].count;
                for (var i = 0; i < st.sorted.length; i++) {
                    var it = st.sorted[i];
                    var pct = st.total ? (it.count * 100 / st.total) : 0;
                    var blocks = maxC > 0 ? Math.max(1, Math.round(it.count * 30 / maxC)) : 1;
                    var nm = it.name;
                    var pad = (nm + '                        ').slice(0, 22);
                    lines.push((i + 1) + '. ' + pad + ' ' + new Array(blocks + 1).join('█') + ' ' + it.count + '次 (' + pct.toFixed(1) + '%)');
                }
            }
            lines.push('');
            if (st.failTotal > 0) {
                lines.push('【出错工具明细】共 ' + st.failTotal + ' 处失败（成功工具不列入）');
                var byName = {}, failOrder = [];
                st.fails.forEach(function(f) {
                    if (!byName[f.name]) { byName[f.name] = []; failOrder.push(f.name); }
                    byName[f.name].push(f.msg);
                });
                failOrder.sort(function(a, b) { return byName[b].length - byName[a].length; });
                failOrder.forEach(function(n) {
                    var msgs = byName[n];
                    lines.push('');
                    lines.push('● ' + n + '（失败 ' + msgs.length + ' 次）');
                    msgs.forEach(function(m, idx) {
                        var mm = m || '(无错误详情)';
                        if (mm.length > 500) mm = mm.slice(0, 500) + ' …[已截断]';
                        lines.push('  [' + (idx + 1) + '] ' + mm);
                    });
                });
            } else {
                lines.push('【出错工具明细】本次无工具错误');
            }
            var text = lines.join('\n');

            var done = function(ok) {
                if (!btn) return;
                btn.textContent = ok ? '✅ 已复制' : '❌ 复制失败';
                setTimeout(function() { btn.textContent = '📋 复制统计+错误'; }, 1600);
            };
            var fb = function(t) {
                var ta = document.createElement('textarea');
                ta.value = t;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                var ok = false;
                try { ok = document.execCommand('copy'); } catch (e) {}
                document.body.removeChild(ta);
                done(ok);
            };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() { done(true); }, function() { fb(text); });
                    return;
                }
            } catch (e) {}
            fb(text);
        },

        // ===== 日志面板（日志 | 上下文）=====
        toggleLogPanel: function(box) {
            var lp = box.querySelector('.chatbox-logpanel');
            var body = box.querySelector('.chatbox-body');
            if (!lp) return;
            if (lp.classList.contains('open')) {
                lp.classList.remove('open');
                if (body) body.style.display = '';
            } else {
                var tp = box.querySelector('.chatbox-toolpanel');
                if (tp && tp.classList.contains('open')) this.toggleToolPanel(box);
                lp.classList.add('open');
                if (body) body.style.display = 'none';
                this.renderLogPanel(box);
            }
        },

        _getChatByBoxEl: function(box) {
            for (var i = 0; i < this.chatBoxes.length; i++) {
                if (this.chatBoxes[i].el === box) return this.chatBoxes[i];
            }
            return null;
        },

        renderLogPanel: function(box) {
            var lp = box.querySelector('.chatbox-logpanel');
            if (!lp) return;
            var self = this;
            if (!lp._tab) lp._tab = 'logs';
            var tab = lp._tab;
            var chat = this._getChatByBoxEl(box);
            var esc = function(s) {
                return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            };
            var fmtTs = function(ts) {
                var d = new Date(ts);
                function p(n) { return n < 10 ? '0' + n : '' + n; }
                return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
            };
            var html =
                '<div class="logpanel-tabs">' +
                    '<span class="logpanel-tab' + (tab === 'logs' ? ' active' : '') + '" data-tab="logs">日志</span>' +
                    '<span class="logpanel-tab' + (tab === 'ctx' ? ' active' : '') + '" data-tab="ctx">上下文</span>' +
                    '<span class="logpanel-actions">' +
                        '<button class="lp-btn" data-lp-act="copy" title="复制对话和日志">📋 复制</button>' +
                        '<button class="lp-btn" data-lp-act="clear" title="清空对话和日志">🗑 清空</button>' +
                    '</span>' +
                '</div>';
            if (tab === 'logs') {
                var logs = [];
                try { logs = Store.getLogs() || []; } catch (e) {}
                html += '<div class="logpanel-body logpanel-logs">';
                // ===== 出错统计表（置顶展示） =====
                html += this._renderLogErrorStats(logs);
                if (!logs.length) {
                    html += '<div class="lp-empty">暂无日志</div>';
                } else {
                    var start = Math.max(0, logs.length - 500);
                    for (var j = logs.length - 1; j >= start; j--) {
                        var L = logs[j];
                        html += '<div class="lp-log lp-' + esc(L.level) + '">[' + fmtTs(L.ts) + '] [' + esc(L.level) + '] ' + esc(L.action) +
                            (L.detail ? ' — ' + esc(L.detail) : '') + '</div>';
                    }
                }
                html += '</div>';
            } else {
                var ctx = (chat && chat._lastContext) ? chat._lastContext : '';
                html += '<div class="logpanel-body logpanel-ctx">';
                if (ctx) {
                    // ===== 上下文分类占比统计（可视化） =====
                    var statsHtml = '';
                    try {
                        var parsed = JSON.parse(ctx);
                        var groups = [
                            { key: 'system', name: '🧠 系统提示', color: '#7c5cff', count: 0, chars: 0 },
                            { key: 'user', name: '💬 用户对话', color: '#4caf50', count: 0, chars: 0 },
                            { key: 'assistant', name: '🤖 AI 回复', color: '#2196f3', count: 0, chars: 0 },
                            { key: 'tool', name: '🛠 工具结果', color: '#ff9800', count: 0, chars: 0 }
                        ];
                        var totalChars = 0;
                        var toolDefs = 0, toolDefChars = 0;
                        var msgs = parsed && parsed.messages ? parsed.messages : [];
                        msgs.forEach(function(m) {
                            if (!m || !m.role) return;
                            var g = null;
                            for (var gi = 0; gi < groups.length; gi++) if (groups[gi].key === m.role) { g = groups[gi]; break; }
                            var text = '';
                            if (typeof m.content === 'string') text = m.content;
                            else if (m.content) { try { text = JSON.stringify(m.content); } catch (e) { text = ''; } }
                            if (m.tool_calls && m.tool_calls.length) {
                                try { text += '\n' + JSON.stringify(m.tool_calls); } catch (e) {}
                            }
                            var len = text ? text.length : 0;
                            if (g) { g.count++; g.chars += len; } else {
                                groups[0].count++; groups[0].chars += len;
                            }
                            totalChars += len;
                        });
                        if (parsed && parsed.tools && parsed.tools.length) {
                            toolDefs = parsed.tools.length;
                            try { toolDefChars = JSON.stringify(parsed.tools).length; } catch (e) {}
                            totalChars += toolDefChars;
                        }
                        var shown = groups.filter(function(g) { return g.count > 0 || g.chars > 0; });
                        if (toolDefs > 0) {
                            shown.push({ key: 'tools', name: '🔧 工具定义', color: '#00bcd4', count: toolDefs, chars: toolDefChars, total: toolDefs });
                        }
                        if (shown.length) {
                            var total = 0;
                            shown.forEach(function(g) { total += g.chars; });
                            var totalCount = 0;
                            shown.forEach(function(g) { if (g.key !== 'tools') totalCount += g.count; });
                            statsHtml += '<div class="lp-ctx-stats">' +
                                '<div class="lp-ctx-stats-title">📊 上下文构成（' + total + ' 字符 / ' + totalCount + ' 条消息' + (toolDefs > 0 ? ' + ' + toolDefs + ' 个工具定义' : '') + '）</div>' +
                                '<div class="lp-ctx-stats-bar">';
                            shown.forEach(function(g) {
                                var pct = total > 0 ? (g.chars / total * 100) : 0;
                                statsHtml += '<div class="lp-ctx-stats-seg" style="width:' + pct.toFixed(2) + '%;background:' + g.color + ';" title="' + g.name + ' ' + pct.toFixed(1) + '%"></div>';
                            });
                            statsHtml += '</div><div class="lp-ctx-stats-legend">';
                            shown.forEach(function(g) {
                                var pct = total > 0 ? (g.chars / total * 100) : 0;
                                var sub = (g.key === 'tools' ? g.count + ' 个' : g.count + ' 条 / ' + g.chars + ' 字符');
                                statsHtml += '<span class="lp-ctx-stat-item"><span class="lp-ctx-stat-dot" style="background:' + g.color + ';"></span>' +
                                    '<span class="lp-ctx-stat-name">' + g.name + '</span>' +
                                    '<span class="lp-ctx-stat-pct">' + pct.toFixed(1) + '%</span>' +
                                    '<span class="lp-ctx-stat-sub">' + sub + '</span></span>';
                            });
                            statsHtml += '</div></div>';
                        } else {
                            statsHtml = '<div class="lp-ctx-stats"><div class="lp-ctx-stats-empty">上下文为空</div></div>';
                        }
                    } catch (e) {}
                    html += statsHtml;
                    html += '<div class="lp-ctx-bar"><span class="lp-ctx-tip">最后一次发送给 AI 的完整请求（仅内存展示，不留痕迹，新请求直接覆盖）</span>' +
                        '</div>' +
                        '<pre>' + esc(ctx) + '</pre>';
                } else {
                    html += '<div class="lp-empty">暂无上下文。发送消息后，这里原封不动展示最后一次发送给 AI 的完整请求（只保留最后一条）。</div>';
                }
                html += '</div>';
            }
            lp.innerHTML = html;

            lp.querySelectorAll('.logpanel-tab').forEach(function(t) {
                t.addEventListener('click', function(e) {
                    e.stopPropagation();
                    lp._tab = this.dataset.tab;
                    self.renderLogPanel(box);
                });
            });
            var copyBtn = lp.querySelector('[data-lp-act="copy"]');
            if (copyBtn) copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (lp._tab === 'ctx') {
                    if (chat && chat._lastContext) self._lpCopyText(chat._lastContext);
                    return;
                }
                var cid = chat ? chat.id : box.id;
                var msgs = [];
                try { msgs = Store.getMessages(cid) || []; } catch (e2) {}
                var logs2 = [];
                try { logs2 = Store.getLogs() || []; } catch (e3) {}
                // ===== 出错统计（最前） =====
                var text = self._logErrorStatsText(logs2);
                // ===== 出错日志（优先，在前） =====
                var errLogs = logs2.filter(function(L) { return L && L.level === 'error'; });
                var normalLogs = logs2.filter(function(L) { return !L || L.level !== 'error'; });
                if (errLogs.length) {
                    text += '\n===== 出错日志(' + errLogs.length + '条，优先展示) =====\n';
                    errLogs.forEach(function(L) {
                        text += '[' + fmtTs(L.ts) + '] [' + L.level + '] ' + L.action + (L.detail ? ' - ' + L.detail : '') + '\n';
                    });
                } else {
                    text += '\n===== 出错日志(0条) =====\n(无出错日志)\n';
                }
                // ===== 普通日志（在后） =====
                text += '\n===== 普通日志(' + normalLogs.length + '条) =====\n';
                normalLogs.forEach(function(L) {
                    text += '[' + fmtTs(L.ts) + '] [' + L.level + '] ' + L.action + (L.detail ? ' - ' + L.detail : '') + '\n';
                });
                // ===== 对话记录（最后） =====
                text += '\n===== 对话记录 (' + cid + ') =====\n';
                msgs.forEach(function(m) {
                    text += '[' + (m.role === 'user' ? '用户' : (m.role === 'ai' ? 'AI' : m.role)) + '] ' + (m.content || '') + '\n\n';
                });
                self._lpCopyText(text);
            });
            var clearBtn = lp.querySelector('[data-lp-act="clear"]');
            if (clearBtn) clearBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                ConfirmDialog.confirm({
                    title: '清空对话',
                    message: '确定清空本对话和历史日志吗？',
                    okText: '清空', danger: true
                }).then(function(ok) {
                    if (!ok) return;
                    var body2 = box.querySelector('.chatbox-body');
                    if (body2) body2.innerHTML = '';
                    try { Store.clearMessages(chat ? chat.id : box.id); } catch (e4) {}
                    try { Store.clearLogs(); } catch (e5) {}
                    self.addMsg(box, '对话和日志已清空。', 'ai');
                    self.renderLogPanel(box);
                });
            });
        },

        // ===== 出错日志统计（表格 + 简易条形图，返回 HTML） =====
        _renderLogErrorStats: function(logs) {
            logs = logs || [];
            var errLogs = logs.filter(function(l) { return l && l.level === 'error'; });
            var total = logs.length;
            var errCount = errLogs.length;
            var errPct = total > 0 ? (errCount / total * 100) : 0;
            var s = '<div class="lp-err-stats">';
            s += '<div class="lp-err-stats-title">📊 出错统计（共 ' + total + ' 条日志 · 出错 ' + errCount + ' 条 · 占比 ' + errPct.toFixed(1) + '%）</div>';
            if (!errCount) {
                s += '<div class="lp-err-stats-empty">🎉 没有出错日志</div></div>';
                return s;
            }
            // 按 action 分组统计出错次数
            var groups = {};
            errLogs.forEach(function(l) {
                var k = l.action || '(unknown)';
                if (!groups[k]) groups[k] = { count: 0, boxIds: {} };
                groups[k].count++;
                if (l.boxId) groups[k].boxIds[l.boxId] = true;
            });
            var arr = Object.keys(groups).map(function(k) {
                return { action: k, count: groups[k].count, boxes: Object.keys(groups[k].boxIds).length };
            });
            arr.sort(function(a, b) { return b.count - a.count; });
            var maxCount = arr[0].count;
            s += '<div class="lp-err-table">';
            s += '<div class="lp-err-row lp-err-head"><span class="lp-err-c1">出错类型(action)</span><span class="lp-err-c2">次数</span><span class="lp-err-c3">占比</span><span class="lp-err-c4">图示</span></div>';
            arr.forEach(function(it, idx) {
                var pct = errCount > 0 ? (it.count / errCount * 100) : 0;
                var barW = maxCount > 0 ? (it.count / maxCount * 100) : 0;
                var rank = idx === 0 ? ' 🔴最多' : (idx === 1 && arr.length > 1 ? ' 🟠次多' : '');
                s += '<div class="lp-err-row' + (idx === 0 ? ' lp-err-top' : '') + '">' +
                    '<span class="lp-err-c1">' + this._lpEsc(it.action) + rank + '</span>' +
                    '<span class="lp-err-c2">' + it.count + '</span>' +
                    '<span class="lp-err-c3">' + pct.toFixed(1) + '%</span>' +
                    '<span class="lp-err-c4"><span class="lp-err-bar" style="width:' + barW.toFixed(1) + '%;"></span></span>' +
                '</div>';
            }, this);
            s += '</div></div>';
            return s;
        },

        // ===== 出错统计的纯文本版（复制时用） =====
        _logErrorStatsText: function(logs) {
            var self = this;
            logs = logs || [];
            var errLogs = logs.filter(function(l) { return l && l.level === 'error'; });
            var total = logs.length;
            var errCount = errLogs.length;
            var errPct = total > 0 ? (errCount / total * 100) : 0;
            var s = '===== 出错统计 =====\n';
            s += '共 ' + total + ' 条日志 · 出错 ' + errCount + ' 条 · 占比 ' + errPct.toFixed(1) + '%\n';
            if (!errCount) {
                s += '没有出错日志\n';
                return s;
            }
            var groups = {};
            errLogs.forEach(function(l) {
                var k = l.action || '(unknown)';
                if (!groups[k]) groups[k] = 0;
                groups[k]++;
            });
            var arr = Object.keys(groups).map(function(k) { return { action: k, count: groups[k] }; });
            arr.sort(function(a, b) { return b.count - a.count; });
            var maxCount = arr[0].count;
            var maxBar = 24;
            s += '出错类型(action)              次数    占比      图示\n';
            arr.forEach(function(it, idx) {
                var pct = errCount > 0 ? (it.count / errCount * 100) : 0;
                var barLen = maxCount > 0 ? Math.round(it.count / maxCount * maxBar) : 0;
                if (idx === 0 && arr.length > 1 && it.count === arr[0].count) barLen = maxBar;
                var bar = '';
                for (var i = 0; i < barLen; i++) bar += '█';
                var name = String(it.action || '(unknown)');
                if (name.length > 24) name = name.substring(0, 24);
                var rankTag = (idx === 0 && arr.length > 1) ? ' ←最多' : '';
                s += self._lpPad(name, 26) + self._lpPad(String(it.count), 5, true) + '  ' + self._lpPad(pct.toFixed(1) + '%', 7, true) + '  ' + bar + rankTag + '\n';
            });
            return s;
        },

        _lpEsc: function(s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },

        // 文本对齐辅助：padRight / padLeft（中文按 2 宽度计）
        _lpStrWidth: function(s) {
            var w = 0;
            for (var i = 0; i < s.length; i++) {
                w += s.charCodeAt(i) > 255 ? 2 : 1;
            }
            return w;
        },
        _lpPad: function(s, width, left) {
            s = String(s == null ? '' : s);
            var pad = width - this._lpStrWidth(s);
            if (pad <= 0) return s;
            var spaces = '';
            for (var i = 0; i < pad; i++) spaces += ' ';
            return left ? spaces + s : s + spaces;
        },

        _lpCopyText: function(text) {
            var fb = function(t) {
                var ta = document.createElement('textarea');
                ta.value = t;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (e) {}
                document.body.removeChild(ta);
            };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() {}, function() { fb(text); });
                    return;
                }
            } catch (e) {}
            fb(text);
        },

        refreshLogPanelCtx: function(box) {
            try {
                var lp = box.querySelector('.chatbox-logpanel');
                if (lp && lp.classList.contains('open') && lp._tab === 'ctx') this.renderLogPanel(box);
            } catch (e) {}
        },

        // [已移除] 旧的 toggleProjectPanel — 已由 app-project.js 的独立侧边栏版本替代
        // 保留 loadProjectNodes 等方法供 app-project.js 调用
                loadProjectNodes: function(panel, chat) {
            var self = this;
            if (!panel._sortMode) panel._sortMode = 'time';
            if (!panel._sortDir) panel._sortDir = 'desc';
            var sortMode = panel._sortMode;
            var sortDir = panel._sortDir;
            var sortArrow = sortDir === 'desc' ? '\u25bc' : '\u25b2';

            panel.innerHTML =
                '<div class="project-panel-head">' +
                '<span class="pp-head-title">📁 关联文件夹</span>' +
                '<span class="pp-head-actions">' +
                '<span class="pp-new-btn" title="新建一段对话">➕ 新建</span>' +
                '<span class="pp-close" title="关闭">✕</span>' +
                '</span></div>' +
                '<div class="pp-toolbar">' +
                '<span class="pp-sort-btn' + (sortMode === 'time' ? ' active' : '') + '" data-sort="time">⏱ 时间 <span class="sort-arrow">' + (sortMode === 'time' ? sortArrow : '') + '</span></span>' +
                '<span class="pp-sort-btn' + (sortMode === 'title' ? ' active' : '') + '" data-sort="title">📖 标题 <span class="sort-arrow">' + (sortMode === 'title' ? sortArrow : '') + '</span></span>' +
                '<span class="pp-sort-btn' + (sortMode === 'count' ? ' active' : '') + '" data-sort="count">📊 消息数 <span class="sort-arrow">' + (sortMode === 'count' ? sortArrow : '') + '</span></span>' +
                '<span class="pp-count-badge" id="pp-count"></span>' +
                '</div>' +
                '<div class="pp-search-wrap"><input type="text" class="pp-search" placeholder="🔍 搜索对话..." /></div>' +
                '<div class="pp-body">加载中…</div>';

            panel.querySelector('.pp-new-btn').addEventListener('click', function(e2) {
                e2.stopPropagation();
                self.openNewSessionModal(chat, panel);
            });
            panel.querySelector('.pp-close').addEventListener('click', function(e) {
                e.stopPropagation();
                panel.classList.remove('open');
            });

            panel.querySelectorAll('.pp-sort-btn').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var mode = this.dataset.sort;
                    if (panel._sortMode === mode) {
                        panel._sortDir = panel._sortDir === 'desc' ? 'asc' : 'desc';
                    } else {
                        panel._sortMode = mode;
                        panel._sortDir = 'desc';
                    }
                    self.loadProjectNodes(panel, chat);
                });
            });

            var allNodes = [];
            var searchInput = panel.querySelector('.pp-search');
            searchInput.addEventListener('input', function() {
                var q = this.value.trim().toLowerCase();
                var filtered = allNodes.filter(function(n) {
                    if (!q) return true;
                    var title = (n.title || n.id || '').toLowerCase();
                    var mid = n.modelId || n.model_id || '';
                    var m = mid ? Models.get(mid) : null;
                    var mName = m ? m.name.toLowerCase() : (mid ? mid.toLowerCase() : '未选择模型');
                    return title.indexOf(q) >= 0 || mName.indexOf(q) >= 0;
                });
                render(filtered);
            });

            function render(nodes) {
                allNodes = nodes;
                var countEl = panel.querySelector('#pp-count');
                if (countEl) countEl.textContent = nodes.length + ' 个对话';

                if (!nodes.length) {
                    panel.querySelector('.pp-body').innerHTML =
                        '<div class="pp-empty">' +
                        '<div class="pp-empty-icon">📂</div>' +
                        '<div class="pp-empty-text">暂无历史对话</div>' +
                        '<div class="pp-empty-hint">点击「新建」开始一段新对话</div>' +
                        '</div>';
                    return;
                }

                var pinnedIds = self.getPinnedIds();
                nodes.sort(function(a, b) {
                    var aPin = pinnedIds.indexOf(a.id) >= 0 ? 1 : 0;
                    var bPin = pinnedIds.indexOf(b.id) >= 0 ? 1 : 0;
                    if (aPin !== bPin) return bPin - aPin;
                    var dir = panel._sortDir === 'asc' ? 1 : -1;
                    if (panel._sortMode === 'title') {
                        var ta = (a.title || a.id || '').toLowerCase();
                        var tb = (b.title || b.id || '').toLowerCase();
                        return ta < tb ? -dir : ta > tb ? dir : 0;
                    } else if (panel._sortMode === 'count') {
                        return (self.countMsgs(a.id) - self.countMsgs(b.id)) * dir;
                    } else {
                        return ((b.updated_at || 0) - (a.updated_at || 0)) * dir;
                    }
                });

                var html = '';
                nodes.forEach(function(n) {
                    var title = (n.title && n.title.indexOf('💬') === 0) ? n.title : ('💬 ' + (n.title || n.id));
                    var mid = n.modelId || n.model_id || '';
                    var m = mid ? Models.get(mid) : null;
                    var mName = m ? m.name : (mid ? mid : '未选择模型');
                    var cnt = self.countMsgs(n.id);
                    var t = n.updated_at || n.updatedAt || n.createdAt || 0;
                    var timeStr = t ? (new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : '';
                    var isPinned = pinnedIds.indexOf(n.id) >= 0;
                    var pinIcon = isPinned ? '📌' : '🔽';
                    html += '<div class="pp-item' + (isPinned ? ' pinned' : '') + '" data-id="' + n.id + '" title="点击恢复该对话">' +
                        '<div class="pp-item-row">' +
                        '<span class="pp-item-title">' + title + '</span>' +
                        '<span class="pp-item-pin" data-pin-id="' + n.id + '" title="' + (isPinned ? '取消置顶' : '置顶') + '">' + pinIcon + '</span>' +
                        '<span class="pp-item-ren" data-ren-id="' + n.id + '" title="重命名">✏️</span>' +
                        '<span class="pp-item-del" data-del-id="' + n.id + '" title="删除此对话">🗑</span>' +
                        '</div>' +
                        '<div class="pp-item-meta">' +
                        '<span class="pp-item-model">' + mName + '</span>' +
                        '<span class="pp-item-dot">·</span>' +
                        '<span>' + cnt + '条</span>' +
                        '<span class="pp-item-dot">·</span>' +
                        '<span>' + timeStr + '</span>' +
                        '</div>' +
                        '</div>';
                });
                panel.querySelector('.pp-body').innerHTML = html;

                panel.querySelectorAll('.pp-item').forEach(function(item) {
                    item.addEventListener('click', function(e) {
                        if (e.target.classList.contains('pp-item-del') ||
                            e.target.classList.contains('pp-item-pin') ||
                            e.target.classList.contains('pp-item-ren')) return;
                        e.stopPropagation();
                        var nid = this.dataset.id;
                        for (var i = 0; i < nodes.length; i++) {
                            if (nodes[i].id === nid) { self.restoreHistoryNode(nodes[i]); break; }
                        }
                    });
                });
                panel.querySelectorAll('.pp-item-del').forEach(function(delBtn) {
                    delBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var nid = this.dataset.delId;
                        ConfirmDialog.confirm({
                            title: '删除对话',
                            message: '确定删除此对话？删除后不可恢复。',
                            okText: '删除', danger: true
                        }).then(function(ok) {
                            if (ok) self.deleteHistoryNode(nid, panel, chat);
                        });
                    });
                });
                panel.querySelectorAll('.pp-item-pin').forEach(function(pinBtn) {
                    pinBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var nid = this.dataset.pinId;
                        self.togglePin(nid);
                        self.loadProjectNodes(panel, chat);
                    });
                });
                panel.querySelectorAll('.pp-item-ren').forEach(function(renBtn) {
                    renBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var nid = this.dataset.renId;
                        var item = this.closest('.pp-item');
                        var titleEl = item.querySelector('.pp-item-title');
                        var oldTitle = titleEl.textContent.replace(/^💬s*/, '');
                        var input = document.createElement('input');
                        input.type = 'text';
                        input.className = 'pp-rename-input';
                        input.value = oldTitle;
                        titleEl.replaceWith(input);
                        input.focus();
                        input.select();
                        function saveRename() {
                            var newTitle = input.value.trim();
                            if (newTitle && newTitle !== oldTitle) {
                                self.renameNode(nid, newTitle);
                            }
                            self.loadProjectNodes(panel, chat);
                        }
                        input.addEventListener('blur', saveRename);
                        input.addEventListener('keydown', function(ev) {
                            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                            if (ev.key === 'Escape') { input.value = oldTitle; input.blur(); }
                        });
                    });
                });
            }

            var local = [];
            if (Store.data && Store.data.chatBoxes) {
                local = Store.data.chatBoxes.map(function(b) {
                    return { id: b.id, title: b.title, modelId: b.modelId, x: b.x, y: b.y, w: b.w, h: b.h, z: b.z, collapsed: b.collapsed, scrollPos: b.scrollPos, createdAt: b.createdAt, updated_at: b.createdAt };
                });
            }
            function fallback() { self.mergeAndRender(panel, local, render); }

            if (typeof DB !== 'undefined' && DB.online) {
                DB.getNodes().then(function(res) {
                    var remote = (res && res.data) ? res.data.map(function(r) {
                        return { id: r.id, title: r.title, modelId: r.model_id, model_id: r.model_id, x: r.x, y: r.y, w: r.w, h: r.h, z: r.z_index, collapsed: r.collapsed, scrollPos: r.scroll_pos, createdAt: r.created_at, updated_at: r.updated_at };
                    }) : [];
                    self.mergeAndRender(panel, remote.concat(local), render);
                }).catch(fallback);
            } else {
                fallback();
            }
        },

        // ===== 新建会话弹窗 =====
        openNewSessionModal: function(chat, panel) {
            var self = this;
            var existing = document.getElementById('newSessionOverlay');
            if (existing) existing.remove();

            var overlay = document.createElement('div');
            overlay.className = 'overlay show';
            overlay.id = 'newSessionOverlay';
            overlay.style.zIndex = '99999';

            var currentModelId = chat ? chat.modelId : '';
            var defaultTitle = '对话' + ((Store.data && Store.data.chatBoxes ? Store.data.chatBoxes.length : 0) + 1);

            overlay.innerHTML =
                '<div class="modal new-session-modal">' +
                    '<h3>✨ 新建会话</h3>' +
                    '<div style="font-size:12px;color:var(--text2);margin-bottom:16px;">选择模型并创建一段新对话，可在画布上自由拖拽。</div>' +
                    '<div class="field">' +
                        '<label>选择模型</label>' +
                        '<select id="ns-model" class="ns-select">' + self.modelOptions(currentModelId) + '</select>' +
                    '</div>' +
                    '<div class="field">' +
                        '<label>对话标题</label>' +
                        '<input type="text" id="ns-title" value="' + defaultTitle + '" />' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">' +
                        '<button class="btn ghost" id="ns-cancel">取消</button>' +
                        '<button class="btn" id="ns-create">✨ 创建会话</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) overlay.remove();
            });
            overlay.querySelector('#ns-cancel').addEventListener('click', function() {
                overlay.remove();
            });

            function doCreate() {
                var modelId = overlay.querySelector('#ns-model').value || null;
                var title = overlay.querySelector('#ns-title').value.trim();
                var hb = panel ? panel.closest('.chatbox').getBoundingClientRect() : null;
                var cx = hb ? hb.right + 30 : window.innerWidth / 2;
                var cy = hb ? hb.top + 60 : window.innerHeight / 2;
                var newChat = self.createChatBox(cx, cy, modelId);
                if (title && newChat) {
                    var titleEl = newChat.el.querySelector('.title');
                    if (titleEl) titleEl.textContent = title;
                    newChat.title = title;
                    Store.saveChatBox(newChat);
                }
                if (panel) panel.classList.remove('open');
                overlay.remove();
                Store.addLog('info', newChat ? newChat.id : '', 'new-session', '新建会话' + (title ? ': ' + title : ''));
            }

            overlay.querySelector('#ns-create').addEventListener('click', doCreate);
            overlay.querySelector('#ns-title').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
            });

            // 修复：Models.load() 是异步的（GET /api/models/config）。
            // 若弹窗打开时模型列表尚未加载完成，下拉框会是空的（只剩"请选择模型"占位）。
            // 这里在加载完成后重填一次下拉选项，保证能看到具体模型。
            try {
                if (global.Models && !Models._loaded && typeof Models.load === 'function') {
                    Models.load().then(function() {
                        var sel = overlay.querySelector('#ns-model');
                        if (sel && overlay.isConnected) {
                            var cur = sel.value;
                            sel.innerHTML = self.modelOptions(cur || (chat ? chat.modelId : ''));
                        }
                    }).catch(function() {});
                }
            } catch (e) {}

            setTimeout(function() {
                var titleInput = overlay.querySelector('#ns-title');
                if (titleInput) titleInput.focus();
            }, 50);
        },

        // ===== 删除历史对话节点 =====
        deleteHistoryNode: function(nodeId, panel, chat) {
            if (Store.data && Store.data.chatBoxes) {
                Store.data.chatBoxes = Store.data.chatBoxes.filter(function(b) {
                    return b.id !== nodeId;
                });
                Store.flush();
            }
            Store.clearMessages(nodeId);
            if (typeof DB !== 'undefined' && DB.online) {
                DB.deleteNode(nodeId).catch(function() {});
            }
            Store.addLog('info', nodeId, 'delete', '删除对话节点');
            this.loadProjectNodes(panel, chat);
        },

        // ===== 置顶管理 =====
        getPinnedIds: function() {
            if (!Store.data) Store.data = {};
            if (!Store.data.pinnedIds) Store.data.pinnedIds = [];
            return Store.data.pinnedIds;
        },
        togglePin: function(nodeId) {
            var ids = this.getPinnedIds();
            var idx = ids.indexOf(nodeId);
            if (idx >= 0) { ids.splice(idx, 1); }
            else { ids.push(nodeId); }
            Store.flush();
            Store.addLog('info', nodeId, 'pin', idx >= 0 ? '取消置顶' : '置顶');
        },

        // ===== 重命名 =====
        renameNode: function(nodeId, newTitle) {
            if (Store.data && Store.data.chatBoxes) {
                for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                    if (Store.data.chatBoxes[i].id === nodeId) {
                        Store.data.chatBoxes[i].title = newTitle;
                        break;
                    }
                }
                Store.flush();
            }
            for (var j = 0; j < this.chatBoxes.length; j++) {
                if (this.chatBoxes[j].id === nodeId) {
                    var titleEl = this.chatBoxes[j].el.querySelector('.title');
                    if (titleEl) titleEl.textContent = newTitle;
                    this.chatBoxes[j].title = newTitle;
                    break;
                }
            }
            if (typeof DB !== 'undefined' && DB.online) {
                // 修复：saveNode(node) 接收完整节点对象（原代码调用了不存在的 DB.updateNode）
                var nodeData = null;
                if (window.Store && Store.data && Store.data.chatBoxes) {
                    for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                        if (Store.data.chatBoxes[i].id === nodeId) { nodeData = Store.data.chatBoxes[i]; break; }
                    }
                }
                if (nodeData) DB.saveNode(nodeData).catch(function() {});
            }
            Store.addLog('info', nodeId, 'rename', '重命名为: ' + newTitle);
        },

        mergeAndRender: function(panel, nodes, render) {
            var seen = {}, out = [];
            nodes.forEach(function(n) {
                if (!n.id) return;
                if (seen[n.id]) return;
                seen[n.id] = 1;
                out.push(n);
            });
            out.sort(function(a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
            render(out);
        },

        countMsgs: function(pid) {
            var msgs = Store.getMessages(pid);
            return msgs.length;
        },

        restoreHistoryNode: function(node) {
            for (var i = 0; i < this.chatBoxes.length; i++) {
                if (this.chatBoxes[i].id === node.id) { this.activate(this.chatBoxes[i].el); return; }
            }
            this.buildBoxFromNode(node);
        },

        buildBoxFromNode: function(node) {
            var self = this;
            var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            var box = document.createElement('div');
            box.className = 'chatbox' + (node.collapsed ? ' collapsed' : '');
            box.id = this.nextBoxId();
            box.style.left = (node.x || 100) + 'px';
            box.style.top = (node.y || 100) + 'px';
            box.style.width = (node.w || 360) + 'px';
            box.style.height = (node.h || 480) + 'px';
            box.style.zIndex = ++this.zCounter;

            var modelId = node.modelId || node.model_id || '';
            var model = modelId ? Models.get(modelId) : null;
            var boxName = model ? model.name : '未选择模型';
            var title = node.title || ('对话' + this.chatCounter);
            if (title.indexOf('💬') === 0) title = title.substring(2).trim();
            var _projCatName = Tools.activeCategory || '极简';
            if (!Tools.categories[_projCatName]) _projCatName = '极简';
            Tools.chatCategories[box.id] = _projCatName;
            var _catList = Tools.getCategoryList(box.id);
            var _catHtml = '';
            _catList.forEach(function(c) {
                _catHtml += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + c.name + '">' +
                    '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                    '<span class="tool-cat-item-name">' + c.name + '</span>' +
                    '</div>';
            });
            var _curCat = Tools.categories[_projCatName];
            var _curCatIcon = _curCat ? _curCat.icon : '📄';


            box.innerHTML =
                '<div class="chatbox-header" title="拖拽移动对话；按住 Shift 拖拽可复制一个一模一样的对话到鼠标落点">' +
                    
                    '<div class="chatbox-header-row1">' +
                    
                    '<span class="status-dot status-idle"></span>' +
                    '<span class="title">' + title + '</span>' +
                    '<span class="proj-name" style="display:none"></span>' +
                    '<button class="hd-btn tool-panel-btn" data-act="tools" title="工具执行过程">🔧<span class="tool-badge" style="display:none">0</span></button>' +
                    '<button class="hd-btn log-panel-btn" data-act="logs" title="日志">📜</button>' +
                    '<button class="hd-btn close" data-act="close" title="关闭">✕</button>' +
                    '</div>' +
                '<div class="chatbox-body"></div>' +
                '<div class="chatbox-logpanel">' +
                    '<div class="logpanel-tabs">' +
                        '<span class="logpanel-tab active" data-tab="logs">日志</span>' +
                        '<span class="logpanel-tab" data-tab="ctx">上下文</span>' +
                        '<span class="logpanel-actions">' +
                            '<button class="lp-btn" data-lp-act="copy" title="复制对话和日志">📋 复制</button>' +
                            '<button class="lp-btn" data-lp-act="clear" title="清空对话和日志">🗑 清空</button>' +
                        '</span>' +
                    '</div>' +
                    '<div class="logpanel-body"></div>' +
                '</div>' +
                '<div class="chatbox-queue" style="display:none"></div>' +
                '<button class="prev-user-btn" title="定位到上一条用户问题所在的段落"><span>▲</span></button> <button class="scroll-bottom-btn" title="滚动到底部"><span>▼</span></button>' +
                '<div class="chatbox-inputrow">' +
                    '<button class="upload-btn" title="上传文件 / 文件夹">+</button>' +
                    '<textarea placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>' +
                    '<button class="send-btn" title="发送消息"><svg class="send-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>' +
                '</div>' +
                '<div class="chatbox-configrow">' +
                    '<div class="tool-cat-wrap">' +
                        '<button class="tool-cat-trigger" title="切换工具分类">' +
                            '<span class="tool-cat-icon">' + _curCatIcon + '</span>' +
                            '<span class="tool-cat-name">' + _projCatName + '</span>' +
                            '<span class="tool-cat-arrow">▾</span>' +
                        '</button>' +
                        '<div class="tool-cat-menu" hidden>' + _catHtml + '</div>' +
                    '</div>' +
                    '<button class="cfg-btn cfg-project-btn" data-act="project" title="切换项目">📁<span class="proj-label">切换项目</span></button>' +
                    '<div class="model-picker-wrap">' +
                        '<button class="model-picker-btn" title="点击选择模型 / 模型ID / 思考强度"><span class="model-picker-name">未选择模型</span><span class="model-picker-arrow">▾</span></button>' +
                        '<div class="model-picker-menu" hidden>' +
                            '<div class="mp-search"><input type="text" class="mp-search-input" placeholder="搜索模型名称或模型ID…"></div>' +
                            '<div class="mp-list"></div>' +
                            '<div class="mp-section">模型 ID 覆盖（仅本对话）</div>' +
                            '<div class="mp-modelid-row"><select class="mp-modelid-input" title="选择要覆盖的模型ID"></select><button type="button" class="mp-modelid-add" title="添加模型 ID">+</button><button type="button" class="mp-modelid-remove" title="删除选中的模型 ID">×</button></div>' +
                            '<div class="mp-section">思考强度（reasoning_effort）</div>' +
                            '<div class="mp-re-row"><select class="mp-re-input" title="点击切换思考强度"></select><button type="button" class="mp-re-btn" data-re-dir="-1" title="降低思考强度">−</button><button type="button" class="mp-re-btn" data-re-dir="1" title="提升思考强度">＋</button></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="chatbox-resize"><span class="chatbox-resize-handle south-east"></span><span class="chatbox-resize-handle south-west"></span><span class="chatbox-resize-handle south"></span><span class="chatbox-resize-handle east"></span><span class="chatbox-resize-handle west"></span></div>';

            canvas.appendChild(box);

            var chat = {
                id: box.id,
                el: box,
                modelId: modelId,
                chatNum: this.chatCounter,
                history: [],
                createdAt: node.createdAt || node.created_at || Date.now(),
                projectId: node.projectId || node.project_id || null,
                // ===== 底部选择器覆盖字段（模型ID / 思考强度） =====
                _modelIdOverride: node.modelIdOverride || node.model_id_override || '',
                _reasoningEffort: node.reasoningEffort || node.reasoning_effort || ''
            };
            this.chatBoxes.push(chat);

            // 加载历史消息（本地优先，服务端兜底）
            var body = box.querySelector('.chatbox-body');
            var msgs = Store.getMessages(node.id);
            if (msgs.length) {
                msgs.forEach(function(m) {
                    if (m.type === 'typing') return;
                    if (m.type === 'tool_call') return; // skip tool call records
                    var div = document.createElement('div');
                    var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                    div.className = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
                    var restoredContent = String(m.content || '');
                    if (m.role === 'assistant' && restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) div.classList.add('task-result-success');
                    if (m.role === 'assistant' && (restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0)) div.classList.add('task-result-fail');
                    self.setMsgContent(div, m.content, whoCls);
                    body.appendChild(div);
                    if (m.role === "user" || m.role === "assistant" || m.role === "system") chat.history.push({ role: m.role, content: m.content });
                });
                // 历史渲染完成：标题显示第一句用户提问
                var fu3 = body.querySelector('.msg.user');
                if (fu3) self.updateChatTitle(box, '');
            } else if (typeof DB !== 'undefined' && DB.online) {
                DB.getChatHistory(node.id).then(function(res) {
                    var rows = (res && res.data) ? res.data : [];
                    rows.forEach(function(m) {
                        if (m.type === 'typing') return;
                        if (m.type === 'tool_call') return;
                        if (m.role === 'tool') return;
                        var role = m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai');
                        var div = document.createElement('div');
                        div.className = 'msg ' + role + (m.type === 'final' ? ' ai-final' : '');
                        self.setMsgContent(div, m.content, role);
                        body.appendChild(div);
                    });
                    // DB 历史渲染完成：标题显示第一句用户提问
                    var fu2 = body.querySelector('.msg.user');
                    if (fu2) self.updateChatTitle(box, '');
                }).catch(function() {});
                    self._refreshUserMsgBtns(body);
            }

            body.scrollTop = body.scrollHeight;

            this.activate(box);
            this.bindChatBox(box, chat);
            this._updateProjectBtn(chat);
            Store.saveChatBox(chat);
            Store.addLog('info', chat.id, 'restore', '从项目历史恢复对话: ' + boxName);
            self.updateStatus();
            self.hideHint();
            self.updateMinimap();
        },});
