// ========== project-folder.js - 文件夹关联（工作目录选择与加载） ==========
// 拆分自 app-chatbox-projects.js（原 210~434 行），Object.assign(App,{...}) 注册
Object.assign(App, {
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
                        // 【5.1.0 修复】通知文件树：项目路径已变更，立即重新定位
                        try { document.dispatchEvent(new CustomEvent('project-folder-changed', { detail: { projectId: projId, folderPath: targetPath } })); } catch (e) {}
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
});
