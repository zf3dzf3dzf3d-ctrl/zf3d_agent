// ========== app-upload.js - 文件上传 ==========
Object.assign(App, {
        // ===== 文件上传功能 =====
        _triggerUpload: function(box, chat) {
            var self = this;
            // 创建弹出菜单
            var existing = document.querySelector('.upload-popup-menu');
            if (existing) existing.remove();

            var menu = document.createElement('div');
            menu.className = 'upload-popup-menu';
            menu.innerHTML =
                '<div class="upload-popup-item" data-act="file">' +
                    '<span class="upload-popup-icon">📄</span>' +
                    '<span>上传文件</span>' +
                '</div>' +
                '<div class="upload-popup-item" data-act="openFolder">' +
                    '<span class="upload-popup-icon">📂</span>' +
                    '<span>上传文件夹</span>' +
                '</div>';

            document.body.appendChild(menu);

            // 定位到按钮旁边
            var btn = box.querySelector('.upload-btn');
            if (btn) {
                var rect = btn.getBoundingClientRect();
                menu.style.left = rect.left + 'px';
                menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
            }

            // 动画显示
            setTimeout(function() { menu.classList.add('show'); }, 10);

            // 选择文件（图片文件自动转入识图暂存区，与文件统一入口）
            menu.querySelector('[data-act="file"]').addEventListener('click', function() {
                menu.remove();
                self._pickFiles(box, chat, false);
            });

            // 上传文件夹（选择文件夹路径发送给AI）
            menu.querySelector('[data-act="openFolder"]').addEventListener('click', function() {
                menu.remove();
                self._pickFolder(box, chat, 'open');
            });

            // 点击外部关闭
            setTimeout(function() {
                var closeHandler = function(e) {
                    if (!menu.contains(e.target)) {
                        menu.classList.remove('show');
                        setTimeout(function() { menu.remove(); }, 200);
                        document.removeEventListener('click', closeHandler);
                    }
                };
                document.addEventListener('click', closeHandler);
            }, 50);
        },

        // 文件夹浏览器对话框（可点击导航浏览目录树）
        _pickFolder: function(box, chat, mode) {
            var self = this;

            var title = (mode === 'open') ? '\ud83d\udcc2 \u6253\u5f00\u6587\u4ef6\u5939' : '\ud83d\udcc1 \u4e0a\u4f20\u6587\u4ef6\u5939\u8def\u5f84';
            var btnText = (mode === 'open') ? '\u6253\u5f00' : '\u786e\u5b9a';

            var currentPath = 'C:\\Users';

            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;';

            var dialog = document.createElement('div');
            dialog.style.cssText = 'background:var(--bg-card,#1e1e2e);border:1px solid var(--border,#333);border-radius:12px;padding:0;width:580px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.5);overflow:hidden;';

            dialog.innerHTML =
                '<div style="padding:14px 18px 10px;border-bottom:1px solid var(--border,#333);font-size:14px;font-weight:600;color:var(--text-main,#eee);">' + title + '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border,#333);">' +
                    '<button class="fb-up" title="\u4e0a\u7ea7\u76ee\u5f55" style="flex-shrink:0;width:30px;height:30px;border:1px solid var(--border,#444);border-radius:6px;background:transparent;color:var(--text-sub,#aaa);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">\u2b06</button>' +
                    '<button class="fb-refresh" title="\u5237\u65b0" style="flex-shrink:0;width:30px;height:30px;border:1px solid var(--border,#444);border-radius:6px;background:transparent;color:var(--text-sub,#aaa);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">\ud83d\udd04</button>' +
                    '<input type="text" class="fb-path" style="flex:1;min-width:0;padding:6px 10px;border:1px solid var(--border,#444);border-radius:6px;background:var(--bg-input,#181828);color:var(--text-main,#eee);font-size:12px;outline:none;font-family:monospace;" />' +
                    '<button class="fb-go" style="flex-shrink:0;padding:6px 12px;border:none;border-radius:6px;background:var(--blue);color:#fff;cursor:pointer;font-size:12px;">\u524d\u5f80</button>' +
                '</div>' +
                '<div style="display:flex;gap:4px;padding:6px 12px;border-bottom:1px solid var(--border,#333);flex-wrap:wrap;">' +
                    '<span class="fb-quick" data-p="C:\\Users" style="padding:2px 8px;border-radius:4px;background:var(--bg-input,#181828);border:1px solid var(--border,#444);color:var(--text-sub,#aaa);cursor:pointer;font-size:11px;">\ud83c\udfe0 \u7528\u6237</span>' +
                    '<span class="fb-quick" data-p="C:\\Users\\Administrator\\Desktop" style="padding:2px 8px;border-radius:4px;background:var(--bg-input,#181828);border:1px solid var(--border,#444);color:var(--text-sub,#aaa);cursor:pointer;font-size:11px;">\ud83d\udda5\ufe0f \u684c\u9762</span>' +
                    '<span class="fb-quick" data-p="D:\\" style="padding:2px 8px;border-radius:4px;background:var(--bg-input,#181828);border:1px solid var(--border,#444);color:var(--text-sub,#aaa);cursor:pointer;font-size:11px;">\ud83d\udcbd D\u76d8</span>' +
                    '<span class="fb-quick" data-p="E:\\" style="padding:2px 8px;border-radius:4px;background:var(--bg-input,#181828);border:1px solid var(--border,#444);color:var(--text-sub,#aaa);cursor:pointer;font-size:11px;">\ud83d\udcbd E\u76d8</span>' +
                '</div>' +
                '<div class="fb-list" style="flex:1;overflow-y:auto;padding:6px 0;min-height:280px;max-height:50vh;">' +
                    '<div style="text-align:center;padding:20px;color:var(--text-sub,#888);font-size:12px;">\u52a0\u8f7d\u4e2d...</div>' +
                '</div>' +
                '<div style="padding:10px 14px;border-top:1px solid var(--border,#333);display:flex;align-items:center;justify-content:space-between;">' +
                    '<div class="fb-selected" style="font-size:11px;color:var(--text-sub,#888);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\u672a\u9009\u62e9\u6587\u4ef6\u5939</div>' +
                    '<div style="display:flex;gap:8px;flex-shrink:0;">' +
                        '<button class="fb-cancel" style="padding:7px 18px;border:1px solid var(--border,#444);border-radius:8px;background:transparent;color:var(--text-sub,#aaa);cursor:pointer;font-size:13px;">\u53d6\u6d88</button>' +
                        '<button class="fb-ok" style="padding:7px 18px;border:none;border-radius:8px;background:var(--blue);color:#fff;cursor:pointer;font-size:13px;font-weight:600;">' + btnText + '</button>' +
                    '</div>' +
                '</div>';

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            var pathInput = dialog.querySelector('.fb-path');
            var listDiv = dialog.querySelector('.fb-list');
            var selectedDiv = dialog.querySelector('.fb-selected');
            var okBtn = dialog.querySelector('.fb-ok');
            var selectedPath = '';

            var close = function() { overlay.remove(); };

            var loadDir = function(dirPath) {
                currentPath = dirPath;
                pathInput.value = dirPath;
                selectedPath = dirPath;
                selectedDiv.textContent = '\u5f53\u524d: ' + dirPath;
                listDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-sub,#888);font-size:12px;">\u52a0\u8f7d\u4e2d...</div>';

                fetch('/api/tools/list_dir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: dirPath, sort_by: 'name' })
                }).then(function(r) { return r.json(); }).then(function(data) {
                    if (!data.ok || !data.dirs || data.dirs.length === 0) {
                        listDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red,#e74c3c);font-size:12px;">\u274c \u65e0\u6cd5\u8bfb\u53d6\u76ee\u5f55</div>';
                        return;
                    }
                    var dir = data.dirs[0];
                    if (dir.error) {
                        listDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red,#e74c3c);font-size:12px;">\u274c ' + self._escapeHtml(dir.error) + '</div>';
                        return;
                    }
                    var entries = dir.entries || [];
                    var folders = entries.filter(function(e) { return e.type === 'dir'; });
                    var files = entries.filter(function(e) { return e.type === 'file'; });

                    var html = '';
                    var parentPath = self._getParentPath(dirPath);
                    if (parentPath !== dirPath) {
                        html += '<div class="fb-item" data-p="' + self._escapeAttr(parentPath) + '" style="display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;border-radius:4px;font-size:13px;color:var(--text-sub,#aaa);">\u2b06 .. (\u4e0a\u7ea7\u76ee\u5f55)</div>';
                    }

                    folders.forEach(function(f) {
                        html += '<div class="fb-item" data-p="' + self._escapeAttr(f.path) + '" style="display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;border-radius:4px;font-size:13px;color:var(--text-main,#eee);">\ud83d\udcc1 ' + self._escapeHtml(f.name) + '</div>';
                    });

                    if (files.length > 0) {
                        html += '<div style="padding:4px 14px;margin-top:4px;font-size:11px;color:var(--text-sub,#666);border-top:1px solid var(--border,#222);">\ud83d\udcc4 ' + files.length + ' \u4e2a\u6587\u4ef6</div>';
                        files.slice(0, 30).forEach(function(f) {
                            var sizeStr = self._formatFileSize(f.size);
                            html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 14px;font-size:12px;color:var(--text-sub,#666);"><span style="opacity:0.5;">\ud83d\udcc4</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self._escapeHtml(f.name) + '</span><span style="font-size:10px;opacity:0.5;">' + sizeStr + '</span></div>';
                        });
                        if (files.length > 30) {
                            html += '<div style="padding:2px 14px;font-size:11px;color:var(--text-sub,#555);">... \u8fd8\u6709 ' + (files.length - 30) + ' \u4e2a\u6587\u4ef6</div>';
                        }
                    }

                    if (html === '') html = '<div style="text-align:center;padding:20px;color:var(--text-sub,#888);font-size:12px;">\u7a7a\u76ee\u5f55</div>';
                    listDiv.innerHTML = html;

                    listDiv.querySelectorAll('.fb-item').forEach(function(item) {
                        item.addEventListener('mouseenter', function() { item.style.background = 'var(--bg-hover,#2a2a3e)'; });
                        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
                        item.addEventListener('click', function() {
                            var p = item.getAttribute('data-p');
                            if (p) loadDir(p);
                        });
                    });
                }).catch(function(err) {
                    listDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red,#e74c3c);font-size:12px;">\u274c \u7f51\u7edc\u9519\u8bef: ' + self._escapeHtml(err.message) + '</div>';
                });
            };

            var confirm = function() {
                if (!selectedPath) return;
                close();
                if (mode === 'open') {
                    self._openFolderPath(box, chat, selectedPath);
                } else {
                    self._handleFolderPath(box, chat, selectedPath);
                }
            };

            dialog.querySelector('.fb-up').addEventListener('click', function() { loadDir(self._getParentPath(currentPath)); });
            dialog.querySelector('.fb-refresh').addEventListener('click', function() { loadDir(currentPath); });
            dialog.querySelector('.fb-go').addEventListener('click', function() { var p = pathInput.value.trim(); if (p) loadDir(p); });
            pathInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); dialog.querySelector('.fb-go').click(); } });
            dialog.querySelectorAll('.fb-quick').forEach(function(q) { q.addEventListener('click', function() { loadDir(q.getAttribute('data-p')); }); });
            dialog.querySelector('.fb-cancel').addEventListener('click', close);
            okBtn.addEventListener('click', confirm);
            overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

            loadDir(currentPath);
        },

        _getParentPath: function(p) {
            if (!p) return '';
            p = p.replace(/\//g, '\\\\');
            if (p.length > 3 && p.endsWith('\\')) p = p.slice(0, -1);
            if (p.length <= 3 && /^[A-Z]:\\$/i.test(p)) return p;
            var idx = p.lastIndexOf('\\');
            if (idx < 0) return p;
            var parent = p.substring(0, idx);
            if (parent.length === 2 && /^[A-Z]:$/i.test(parent)) parent += '\\';
            return parent || p;
        },

        _escapeAttr: function(s) {
            if (!s) return '';
            return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },

        _escapeHtml: function(s) {
            if (!s) return '';
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },

        _formatFileSize: function(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            var units = ['B', 'KB', 'MB', 'GB'];
            var i = Math.floor(Math.log(bytes) / Math.log(1024));
            return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
        },

        // 上传文件夹路径模式：只记录路径，不上传文件内容
        _handleFolderPath: function(box, chat, folderPath) {
            var self = this;

            // 构造文件夹路径信息，插入到输入框
            var attachment = '📁 文件夹路径: ' + folderPath;

            var input = box.querySelector('textarea');
            var existingText = input.value.trim();
            if (existingText) {
                input.value = existingText + '\n' + attachment;
            } else {
                input.value = attachment + '\n请查看以上文件夹路径信息，告诉我你的分析或处理意见。';
            }

            // 显示文件夹路径卡片（不上传文件）
            var fileListHtml = '<div class="upload-card">';
            fileListHtml += '<div class="upload-card-title">📁 文件夹路径: ' + self._escapeHtml(folderPath) + '</div>';
            fileListHtml += '</div>';

            var body = box.querySelector('.chatbox-body');
            if (body) {
                var cardDiv = document.createElement('div');
                cardDiv.className = 'msg user';
                cardDiv.innerHTML = fileListHtml;
                body.appendChild(cardDiv);
                body.scrollTop = body.scrollHeight;
            }

            input.focus();
            Store.addLog('info', chat.id, 'upload', '文件夹路径: ' + folderPath);
        },

        // 打开文件夹模式：把文件夹路径发送给AI打开
        _openFolderPath: function(box, chat, folderPath) {
            var self = this;

            // 显示文件夹路径卡片
            var fileListHtml = '<div class="upload-card">';
            fileListHtml += '<div class="upload-card-title">📂 上传文件夹: ' + self._escapeHtml(folderPath) + '</div>';
            fileListHtml += '</div>';

            var body = box.querySelector('.chatbox-body');
            if (body) {
                var cardDiv = document.createElement('div');
                cardDiv.className = 'msg user';
                cardDiv.innerHTML = fileListHtml;
                body.appendChild(cardDiv);
                body.scrollTop = body.scrollHeight;
            }

            // 设置输入框内容并触发发送
            var input = box.querySelector('textarea');
            if (input) {
                input.value = '📂 请读取文件夹: ' + folderPath + '\n请读取该文件夹的内容并进行分析。';
            }
            // 点击发送按钮
            var sendBtn = box.querySelector('.send-btn');
            if (sendBtn) {
                sendBtn.click();
            }
            Store.addLog('info', chat.id, 'upload', '打开文件夹: ' + folderPath);
        },

        // 打开文件选择器（文件模式）
        _pickFiles: function(box, chat, isFolder) {
            var self = this;
            var input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.style.display = 'none';
            input.addEventListener('change', function(e) {
                var files = e.target.files;
                if (!files || files.length === 0) return;
                // 图片文件自动转入识图暂存（转 base64 随消息发送），其余走普通文件上传
                var imgFiles = [], otherFiles = [];
                for (var i = 0; i < files.length; i++) {
                    if (/^image\//.test(files[i].type || '') || /\.(png|jpe?g|webp|gif)$/i.test(files[i].name || '')) {
                        imgFiles.push(files[i]);
                    } else {
                        otherFiles.push(files[i]);
                    }
                }
                if (imgFiles.length) self._addPendingImages(box, imgFiles);
                if (otherFiles.length) self._handleUpload(box, chat, otherFiles, isFolder);
            });
            document.body.appendChild(input);
            input.click();
            // 清理
            setTimeout(function() {
                if (input.parentNode) input.parentNode.removeChild(input);
            }, 5000);
        },

        _handleUpload: function(box, chat, files, isFolder) {
            var self = this;
            var pendingFiles = [];
            var completed = 0;
            var total = files.length;
            var label = total + ' 个文件';

            // 显示上传中提示
            var progressMsg = self.addMsg(box, '📎 正在上传 ' + label + '，共 ' + total + ' 个文件…', 'typing');

            for (var i = 0; i < files.length; i++) {
                (function(file, idx) {
                    var formData = new FormData();
                    formData.append('file', file);
                    formData.append('boxId', chat.id);

                    fetch(DB.BASE_URL + '/api/tools/upload', {
                        method: 'POST',
                        body: formData
                    }).then(function(res) {
                        return res.json();
                    }).then(function(data) {
                        completed++;
                        if (data.ok && data.path) {
                            pendingFiles.push({
                                name: data.original_name || file.name,
                                path: data.path,
                                size: data.size || file.size,
                                type: file.type || '',
                                relativePath: ''
                            });
                        } else {
                            pendingFiles.push({
                                name: file.name,
                                error: data.error || '上传失败'
                            });
                        }
                        if (completed >= total) {
                            progressMsg.remove();
                            self._onUploadComplete(box, chat, pendingFiles, isFolder);
                        }
                    }).catch(function(err) {
                        completed++;
                        pendingFiles.push({
                            name: file.name,
                            error: err.message || '网络错误'
                        });
                        if (completed >= total) {
                            progressMsg.remove();
                            self._onUploadComplete(box, chat, pendingFiles, isFolder);
                        }
                    });
                })(files[i], i);
            }
        },

        _onUploadComplete: function(box, chat, files, isFolder) {
            var self = this;
            var fileInfos = [];
            var hasError = false;

            files.forEach(function(f) {
                if (f.error) {
                    hasError = true;
                    self.addMsg(box, '❌ 上传失败: ' + f.name + ' - ' + f.error, 'error');
                } else {
                    var sizeStr = self._formatFileSize(f.size);
                    fileInfos.push('📎 [' + f.name + '](' + f.path + ') (' + sizeStr + ')');
                }
            });

            if (fileInfos.length === 0) {
                return;
            }

            // 构造附加到用户消息的文件信息
            var attachment = fileInfos.join('\n');
            var input = box.querySelector('textarea');
            var existingText = input.value.trim();

            // 在输入框中插入文件引用信息
            if (existingText) {
                input.value = existingText + '\n' + attachment;
            } else {
                input.value = attachment + '\n请查看以上文件，告诉我你的分析或处理意见。';
            }

            // 显示文件附件卡片
            var fileListHtml = '<div class="upload-card">';
            fileListHtml += '<div class="upload-card-title">📎 已上传 ' + fileInfos.length + ' 个文件</div>';
            files.forEach(function(f) {
                if (!f.error) {
                    var sizeStr = self._formatFileSize(f.size);
                    var icon = self._getFileIcon(f.name);
                    fileListHtml += '<div class="upload-file-item">';
                    fileListHtml += '<span class="upload-file-icon">' + icon + '</span>';
                    fileListHtml += '<span class="upload-file-name">' + self._escapeHtml(f.name) + '</span>';
                    fileListHtml += '<span class="upload-file-size">' + sizeStr + '</span>';
                    fileListHtml += '</div>';
                }
            });
            fileListHtml += '</div>';

            // 在聊天区显示文件上传卡片
            var body = box.querySelector('.chatbox-body');
            if (body) {
                var cardDiv = document.createElement('div');
                cardDiv.className = 'msg user';
                cardDiv.innerHTML = fileListHtml;
                body.appendChild(cardDiv);
                body.scrollTop = body.scrollHeight;
            }

            input.focus();
            Store.addLog('info', chat.id, 'upload', '上传 ' + fileInfos.length + ' 个文件');
        },

        _formatFileSize: function(bytes) {
            if (!bytes || bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
        },

        _getFileIcon: function(filename) {
            var ext = (filename.split('.').pop() || '').toLowerCase();
            var icons = {
                'txt': '📄', 'md': '📝', 'js': '📜', 'ts': '📜', 'py': '🐍',
                'html': '🌐', 'css': '🎨', 'json': '📋', 'xml': '📋',
                'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'svg': '🖼️',
                'pdf': '📕', 'doc': '📘', 'docx': '📘', 'xls': '📗', 'xlsx': '📗',
                'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
                'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'mp3': '🎵', 'wav': '🎵',
                'csv': '📊', 'sql': '🗄️'
            };
            return icons[ext] || '📄';
        },

        // ========== 图片直传识别（visionInput）==========
        // 暂存区：box.id -> [{ dataUrl, name }]
        _pickImages: function(box, chat) {
            var self = this;
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp,image/gif';
            input.multiple = true;
            input.style.display = 'none';
            input.addEventListener('change', function(e) {
                var files = e.target.files;
                if (!files || files.length === 0) return;
                self._addPendingImages(box, Array.prototype.slice.call(files));
            });
            document.body.appendChild(input);
            input.click();
            setTimeout(function() {
                if (input.parentNode) input.parentNode.removeChild(input);
            }, 5000);
        },

        _addPendingImages: function(box, files) {
            var IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
            var arr = this._pendingImages = this._pendingImages || {};
            var list = arr[box.id] = arr[box.id] || [];
            var MAX_IMAGES = 4;        // 单条消息最多 4 张
            var MAX_BYTES   = 8 * 1024 * 1024;  // 单图最大 8MB（base64 后约 11MB）
            var tasks = [];
            for (var i = 0; i < files.length; i++) {
                (function(f) {
                    if (!/^image\//.test(f.type || '') && !IMAGE_EXT_RE.test(f.name)) return;
                    if (f.size > MAX_BYTES) { self_toast('❌ 图片过大（>8MB）: ' + f.name); return; }
                    if (list.length >= MAX_IMAGES) { self_toast('⚠️ 最多附带 ' + MAX_IMAGES + ' 张图片'); return; }
                    tasks.push(new Promise(function(resolve) {
                        var fr = new FileReader();
                        fr.onload = function() {
                            if (typeof fr.result === 'string' && fr.result.indexOf('data:image/') === 0) {
                                list.push({ dataUrl: fr.result, name: f.name });
                            } else {
                                self_toast('❌ 图片读取失败: ' + f.name);
                            }
                            resolve();
                        };
                        fr.onerror = function() { self_toast('❌ 图片读取失败: ' + f.name); resolve(); };
                        fr.readAsDataURL(f);
                    }));
                })(files[i]);
            }
            function self_toast(msg) {
                try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
                try { console.log('[ImageUpload]', msg); } catch (e2) {}
            }
            Promise.all(tasks).then(function() { App.renderPendingImages(box); });
        },

        renderPendingImages: function(box) {
            var bar = box.querySelector('.pending-images-bar');
            var arr = this._pendingImages || {};
            var list = arr[box.id] || [];
            if (!bar) return;
            if (!list.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
            var html = '';
            for (var i = 0; i < list.length; i++) {
                html += '<span class="pending-image-item" data-idx="' + i + '" title="' + this._escapeHtml(list[i].name) + '">' +
                        '<img src="' + list[i].dataUrl + '" alt="img">' +
                        '<button type="button" class="pending-image-del" data-del-idx="' + i + '" title="移除">×</button></span>';
            }
            html += '<span style="font-size:11px;color:var(--text-sub,#888);margin-left:6px;">发送时将随消息一起发给模型识图</span>';
            bar.innerHTML = html;
            bar.style.display = 'flex';
            var dels = bar.querySelectorAll('.pending-image-del');
            for (var d = 0; d < dels.length; d++) {
                dels[d].addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    var idx = parseInt(this.getAttribute('data-del-idx'), 10);
                    var ls = ((App._pendingImages || {})[box.id]) || [];
                    if (idx >= 0 && idx < ls.length) ls.splice(idx, 1);
                    App.renderPendingImages(box);
                });
            }
        },

        takePendingImages: function(box) {
            var arr = this._pendingImages || {};
            var imgs = arr[box.id] || [];
            delete arr[box.id];
            if (arr && Object.keys(arr).length === 0) this._pendingImages = arr;
            return imgs.slice();
        },

        // ===== 粘贴文本卡片 =====
        _addPendingPaste: function(box, text) {
            this._pendingPastes = this._pendingPastes || {};
            var list = this._pendingPastes[box.id] = this._pendingPastes[box.id] || [];
            list.push(String(text));
            this.renderPendingPastes(box);
        },

        renderPendingPastes: function(box) {
            var bar = box.querySelector('.pending-pastes-bar');
            if (!bar) return;
            var list = ((this._pendingPastes || {})[box.id]) || [];
            if (!list.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
            var html = '';
            for (var i = 0; i < list.length; i++) {
                var preview = list[i].replace(/\s+/g, ' ').trim();
                if (preview.length > 40) preview = preview.substring(0, 40) + '…';
                html += '<span class="pending-paste-item" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--border,#4a4a5a);border-radius:10px;background:var(--bg-soft,#2a2a3a);font-size:12px;max-width:280px;" title="粘贴的内容(' + list[i].length + '字符)">' +
                        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📋 ' + this._escapeHtml(preview) + '</span>' +
                        '<button type="button" class="pending-paste-del" data-del-idx="' + i + '" title="删除此粘贴内容" style="border:none;background:none;color:var(--text-sub,#888);cursor:pointer;font-size:13px;padding:0 2px;">×</button></span>';
            }
            html += '<span style="font-size:11px;color:var(--text-sub,#888);">发送时将以代码块附在消息后</span>';
            bar.innerHTML = html;
            bar.style.display = 'flex';
            var dels = bar.querySelectorAll('.pending-paste-del');
            for (var d = 0; d < dels.length; d++) {
                dels[d].addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    var idx = parseInt(this.getAttribute('data-del-idx'), 10);
                    var ls = ((App._pendingPastes || {})[box.id]) || [];
                    if (idx >= 0 && idx < ls.length) ls.splice(idx, 1);
                    App.renderPendingPastes(box);
                });
            }
        },

        takePendingPastes: function(box) {
            var map = this._pendingPastes || {};
            var list = map[box.id] || [];
            delete map[box.id];
            this.renderPendingPastes(box);
            return list.slice();
        },

        bindPasteAndDrop: function(box) {
            var self = this;
            var ta = box.querySelector('textarea');
            if (ta && !ta._pasteImgBound) {
                ta._pasteImgBound = true;
                ta.addEventListener('paste', function(e) {
                    var items = (e.clipboardData && e.clipboardData.items) || [];
                    var files = [];
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].kind === 'file' && /^image\//.test(items[i].type || '')) {
                            var f = items[i].getAsFile();
                            if (f) files.push(f);
                        }
                    }
                    if (files.length) { e.preventDefault(); self._addPendingImages(box, files); return; }
                    // 【粘贴卡片】大段文本(超过80字符或含换行)不直接进输入框，转为可删除卡片
                    if (!e.clipboardData) return;
                    var ptext = e.clipboardData.getData('text/plain');
                    if (ptext && (ptext.length > 80 || /\r?\n/.test(ptext))) {
                        e.preventDefault();
                        self._addPendingPaste(box, ptext);
                    }
                });
            }
            if (!box._dropImgBound) {
                box._dropImgBound = true;
                box.addEventListener('dragover', function(e) {
                    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') >= 0) e.preventDefault();
                });
                box.addEventListener('drop', function(e) {
                    var dtFiles = (e.dataTransfer && e.dataTransfer.files) || [];
                    var imgFiles = [];
                    for (var i = 0; i < dtFiles.length; i++) {
                        if (/^image\//.test(dtFiles[i].type || '')) imgFiles.push(dtFiles[i]);
                    }
                    if (imgFiles.length) { e.preventDefault(); e.stopPropagation(); self._addPendingImages(box, imgFiles); }
                }, true);
            }
            // 【整框拖拽】整个对话区（box）任意位置都可接受文件拖入，带动画提示
            if (!box._fullDropBound) {
                box._fullDropBound = true;
                var overlay = document.createElement('div');
                overlay.className = 'zf-fulldrop-overlay';
                overlay.innerHTML = '<div class="zf-fulldrop-inner">' +
                    '<div class="zf-fulldrop-icon">📂</div>' +
                    '<div class="zf-fulldrop-text">松手放入对话框</div>' +
                    '<div class="zf-fulldrop-sub">图片直接挂到输入框 · 其他文件作为附件发送</div>' +
                    '</div>';
                var st = document.createElement('style');
                st.textContent = [
                    '.zf-fulldrop-overlay{position:absolute;inset:0;z-index:9998;display:none;align-items:center;justify-content:center;',
                    'background:rgba(10,14,30,.72);backdrop-filter:blur(3px);pointer-events:none;}',
                    '.zf-fulldrop-overlay.zf-show{display:flex;animation:zfDropIn .18s ease-out;}',
                    '.zf-fulldrop-inner{border:2px dashed rgba(90,180,255,.85);border-radius:16px;padding:26px 46px;text-align:center;',
                    'animation:zfFloat 1.1s ease-in-out infinite alternate;}',
                    '.zf-fulldrop-icon{font-size:52px;line-height:1;animation:zfBounce .8s ease-in-out infinite;}',
                    '.zf-fulldrop-text{margin-top:10px;font-size:17px;font-weight:600;color:#8fd0ff;letter-spacing:1px;}',
                    '.zf-fulldrop-sub{margin-top:6px;font-size:12px;color:rgba(160,190,230,.75);}',
                    '@keyframes zfDropIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}',
                    '@keyframes zfFloat{from{transform:translateY(-5px)}to{transform:translateY(5px)}}',
                    '@keyframes zfBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}'
                ].join('');
                document.head.appendChild(st);
                box.appendChild(overlay);
                if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
                var hideT = null;
                function showOv() { clearTimeout(hideT); overlay.classList.add('zf-show'); }
                function hideOv() { hideT = setTimeout(function(){ overlay.classList.remove('zf-show'); }, 120); }
                function hasFiles(e) {
                    return !!(e.dataTransfer && e.dataTransfer.types &&
                        Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1);
                }
                box.addEventListener('dragenter', function(e) {
                    if (!hasFiles(e)) return;
                    e.preventDefault(); showOv();
                });
                box.addEventListener('dragover', function(e) {
                    if (!hasFiles(e)) return;
                    e.preventDefault(); showOv();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                });
                box.addEventListener('dragleave', function(e) {
                    if (!hasFiles(e)) return;
                    // 只有真正离开 box（去到外面或窗口）才隐藏，内部移动不闪
                    if (!box.contains(e.relatedTarget)) hideOv();
                });
                box.addEventListener('drop', function(e) {
                    if (!hasFiles(e)) return;
                    e.preventDefault(); e.stopPropagation();
                    overlay.classList.remove('zf-show');
                    var dtFiles = (e.dataTransfer && e.dataTransfer.files) || [];
                    var imgFiles = [], otherFiles = [];
                    for (var i = 0; i < dtFiles.length; i++) {
                        if (/^image\//.test(dtFiles[i].type || '')) imgFiles.push(dtFiles[i]);
                        else otherFiles.push(dtFiles[i]);
                    }
                    if (imgFiles.length) self._addPendingImages(box, imgFiles);
                    if (otherFiles.length) {
                        var names = [];
                        for (var j = 0; j < otherFiles.length; j++) names.push(otherFiles[j].name);
                        try {
                            var ta2 = box.querySelector('textarea');
                            if (ta2) {
                                var note = '\n📎 附件: ' + names.join(', ');
                                ta2.value = (ta2.value || '') + note;
                                ta2.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                            if (window.App && App._toast) App._toast('📎 已接收文件: ' + names.join('、'));
                        } catch (err) {}
                    }
                });
            }
            var bar = box.querySelector('.pending-images-bar');
            if (bar && !bar._bound) { bar._bound = true; self.renderPendingImages(box); }
            // 【粘贴卡片条】输入行上方，展示粘贴的大段文本卡片
            if (!box.querySelector('.pending-pastes-bar')) {
                var ppb = document.createElement('div');
                ppb.className = 'pending-pastes-bar';
                ppb.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 12px;border-top:1px dashed var(--border,#3a3a4a);';
                var inputRow = box.querySelector('.chatbox-inputrow');
                if (inputRow && inputRow.parentNode) inputRow.parentNode.insertBefore(ppb, inputRow);
                else box.appendChild(ppb);
            }
        }
});
