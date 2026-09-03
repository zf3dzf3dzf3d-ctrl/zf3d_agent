// ==== 拆分自 app-chatbox.js：绑定对话框交互_Markdown ====
Object.assign(App, {
        // ===== 绑定对话框交互 =====
        bindChatBox: function(box, chat) {
            var self = this;
            try {
                // 图片预览条：插在输入行上方（app-upload.js 提供 render/bind 能力）
                if (!box.querySelector('.pending-images-bar')) {
                    var pib = document.createElement('div');
                    pib.className = 'pending-images-bar';
                    pib.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 12px;border-top:1px dashed var(--border,#3a3a4a);';
                    var inputRow = box.querySelector('.chatbox-inputrow');
                    if (inputRow && inputRow.parentNode) inputRow.parentNode.insertBefore(pib, inputRow);
                    else box.appendChild(pib);
                }
                // 【文件选择条】显示文件树/缩略图当前选中的文件（插在图片预览条上方）
                if (!box.querySelector('.chat-sel-bar')) {
                    var csb = document.createElement('div');
                    csb.className = 'chat-sel-bar'; csb.id = 'chatSelBar';
                    csb.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 12px;font-size:12px;';
                    var inputRow2 = box.querySelector('.chatbox-inputrow');
                    if (inputRow2 && inputRow2.parentNode) inputRow2.parentNode.insertBefore(csb, inputRow2);
                    else box.appendChild(csb);
                }
                if (typeof App !== 'undefined' && typeof App.bindPasteAndDrop === 'function') {
                    setTimeout(function() { try { App.bindPasteAndDrop(box); } catch (e2) {} }, 0);
                }
            } catch (e) {}
            var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            var header = box.querySelector('.chatbox-header');
            var body = box.querySelector('.chatbox-body');
            var input = box.querySelector('textarea');
            var sendBtn = box.querySelector('.send-btn');
            var uploadBtn = box.querySelector('.upload-btn');
            var resize = box.querySelector('.chatbox-resize');

            // 初始化清理数据（用于 closeChatBox 时移除监听器和定时器，避免 monkey-patch 链式叠加）
            chat._cleanup = { scrollBtnTimer: null, navArrowTimer: null, listeners: [] };
            function trackListener(target, event, handler) {
                if (!target) return;
                target.addEventListener(event, handler);
                chat._cleanup.listeners.push({ target: target, event: event, handler: handler });
            }

            // ===== 标题 hover/click 展示所有用户提问（点击跳转 / 查看答案）=====
            var titleEl = box.querySelector('.chatbox-header-row1 .title') || box.querySelector('.chatbox-header .title');
            if (titleEl) {
                trackListener(titleEl, 'mouseenter', function() {
                    self._cancelHidePanel();
                    self._showQuestionsPanel(box, titleEl);
                });
                trackListener(titleEl, 'mouseleave', function(e) {
                    self._scheduleHidePanel();
                });
                // 点击标题：切换展开/收起提问列表面板（固定显示，不随鼠标离开隐藏）
                trackListener(titleEl, 'click', function(e) {
                    e.stopPropagation();
                    var existing = document.querySelector('.cbq-panel');
                    if (existing && existing.__pinned) { self._hideQuestionsPanel(); return; }
                    self._cancelHidePanel();
                    self._showQuestionsPanel(box, titleEl, true);
                });
            }

            // ===== 模型选择器（底部增强下拉：选模型 / 改模型ID / 切思考强度） =====
            self._initModelPicker(box, chat);

            // 头部按钮 + 底部配置行按钮（project 在底部）
            box.querySelectorAll('.hd-btn, .cfg-project-btn').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var act = this.dataset.act;
                    if (act === 'logs') {
                        self.toggleLogPanel(box);
                    } else if (act === 'mentor') {
                        // 导师点评：收集本对话全部内容（用户/AI/工具结果/日志）→ 新建对话发给导师 AI 评论
                        if (typeof self._mentorReviewChat === 'function') {
                            self._mentorReviewChat(chat);
                        }
                    } else if (act === 'close') {
                        self.closeChatBox(chat);
                    } else if (act === 'starmap') {
                        // 星空知识图谱：以本对话项目的 folder_path 为星域
                        var _sroot = '';
                        try {
                            var _spid = (chat && chat.projectId) || (self.activeProject && self.activeProject.id) || null;
                            if (_spid && self._projAllProjects) {
                                for (var _si = 0; _si < self._projAllProjects.length; _si++) {
                                    if (String(self._projAllProjects[_si].id) === String(_spid)) { _sroot = self._projAllProjects[_si].folder_path || ''; break; }
                                }
                            }
                        } catch (e) {}
                        if (typeof self.toggleStarmapPanel === 'function') self.toggleStarmapPanel(_sroot);
                    } else if (act === 'remote') {
                        // 远程控制面板
                        if (typeof self.toggleRemotePanel === 'function') self.toggleRemotePanel();
                    } else if (act === 'tools') {
                        self.toggleToolPanel(box);
                    } else if (act === 'project') {
                        // 【5.1.0 重写】打开左侧文件树+缩略图：以本对话框【自己选择的项目】为唯一优先。
                        // 取值顺序：chat.projectId（用户在📁切换器里选的）> App.activeProject（全局活动项目）> 无
                        // 注意：不再用 activeProject 覆盖 chat.projectId，也不再用 chat.projectId 覆盖 activeProject，
                        // 各自状态独立，仅在 chat 未关联项目时才借用活动项目（且不回写）。
                        var fpid = (chat && chat.projectId) || (self.activeProject && self.activeProject.id) || null;
                        var fproj = null;
                        if (fpid && self._projAllProjects) {
                            fproj = self._projAllProjects.find(function(p) { return String(p.id) === String(fpid); });
                        }
                        if (!fproj && fpid && Store.data && Store.data.projects) {
                            fproj = Store.data.projects.find(function(p) { return String(p.id) === String(fpid); }) || null;
                        }
                        if (typeof self.openFileTreePanel === 'function') {
                            // 始终显式传入项目 id，避免 openFileTreePanel 内部回退到 App.activeProject
                            self.openFileTreePanel(fpid, fproj ? fproj.name : '');
                        } else if (typeof self.showProjectSwitcher === 'function') {
                            self.showProjectSwitcher(box, chat);
                        }
                    }
                });
            });

            // 上传文件
            if (uploadBtn) {
                uploadBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self._triggerUpload(box, chat);
                });
            }

            // 工具面板关闭按钮
            var tpClose = box.querySelector('.chatbox-toolpanel-close');
            if (tpClose) {
                tpClose.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.toggleToolPanel(box);
                });
            }

            // 底层对话引擎下拉菜单（每对话独立）
            var engTrigger = box.querySelector('.eng-trigger');
            var engMenu = box.querySelector('.eng-menu');
            if (engTrigger && engMenu) {
                // 绑定引擎条目点击（引擎列表是动态的，重建后需重绑）
                var _bindEngItems = function() {
                    engMenu.querySelectorAll('.eng-item').forEach(function(item) {
                        item.addEventListener('click', function(e) {
                            e.stopPropagation();
                            var engId = this.dataset.eng || '';
                            engMenu.hidden = true;
                            chat._engine = engId;
                            // 同步全局默认引擎并持久化：新对话默认用上一次选的引擎，重启后仍生效
                            if (typeof DB !== 'undefined' && typeof DB.setEngine === 'function') {
                                DB.setEngine(engId);
                            }
                            // 高亮选中项 + 更新触发按钮显示
                            engMenu.querySelectorAll('.eng-item').forEach(function(i) {
                                i.classList.toggle('active', i.dataset.eng === engId);
                            });
                            var nameEl = engTrigger.querySelector('.eng-name');
                            if (nameEl) {
                                if (!engId) { nameEl.textContent = '默认'; }
                                else {
                                    var en = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines().filter(function(x){return x.id===engId;})[0] : null;
                                    nameEl.textContent = en ? ((en.icon ? en.icon + ' ' : '') + en.name) : engId;
                                }
                            }
                            Store.saveChatBox(chat);
                            Store.addLog('info', chat.id, 'engine-switch', '用户切换底层对话引擎: ' + (engId || '服务端默认'));

                            // ===== 引擎切换 → 工具分类自动联动 =====
                            // local_loop 引擎（own_tools=true）自带私有工具集：自动切到「XX 引擎」分类；
                            // preprocess 引擎（如 zf_core 默认）不锁工具，若当前停在某个引擎分类则退回「极简」。
                            (function () {
                                var engMeta = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines().filter(function (x) { return x.id === engId; })[0] : null;
                                var ownTools = !!(engMeta && engMeta.own_tools);
                                var targetCat = null;
                                if (ownTools && window.EngineToolCategories && EngineToolCategories[engId]) {
                                    targetCat = EngineToolCategories[engId];
                                } else if (!ownTools) {
                                    var cur = Tools.chatCategories[chat.id] || Tools.activeCategory;
                                    var curCatDef = Tools.categories[cur];
                                    // 当前分类是某个引擎的分类（带 engineId 字段）→ 退回极简
                                    if (curCatDef && curCatDef.engineId) targetCat = '极简';
                                }
                                if (targetCat && Tools.categories[targetCat]) {
                                    Tools.currentChatId = chat.id;
                                    Tools.setCategory(targetCat, chat.id);
                                    chat.toolCategory = targetCat;
                                    var newCat = Tools.categories[targetCat];
                                    var catTrigger2 = box.querySelector('.tool-cat-trigger');
                                    if (catTrigger2) {
                                        var icon2 = catTrigger2.querySelector('.tool-cat-icon');
                                        var name2 = catTrigger2.querySelector('.tool-cat-name');
                                        if (icon2) icon2.textContent = newCat.icon;
                                        if (name2) name2.textContent = targetCat;
                                    }
                                    // ===== 按新引擎重建分类下拉菜单（分类只跟随对应引擎） =====
                                    var catMenu2 = box.querySelector('.tool-cat-menu');
                                    if (catMenu2) {
                                        var _eList2 = Tools.getCategoryList(chat.id, engId);
                                        var _eHtml2 = '';
                                        _eList2.forEach(function (c2) {
                                            _eHtml2 += '<div class="tool-cat-item' + (c2.active ? ' active' : '') + '" data-cat="' + c2.name + '">' +
                                                '<span class="tool-cat-item-icon">' + c2.icon + '</span>' +
                                                '<span class="tool-cat-item-name">' + c2.name + '</span>' +
                                                '</div>';
                                        });
                                        catMenu2.innerHTML = _eHtml2;
                                        // 重新绑定点击（重建后丢失）
                                        catMenu2.querySelectorAll('.tool-cat-item').forEach(function (item2) {
                                            item2.addEventListener('click', function (e2) {
                                                e2.stopPropagation();
                                                var cn2 = this.dataset.cat;
                                                if (!cn2) return;
                                                catMenu2.hidden = true;
                                                if (!Tools.categories[cn2]) return;
                                                Tools.currentChatId = chat.id;
                                                Tools.setCategory(cn2, chat.id);
                                                chat.toolCategory = cn2;
                                                var cdef2 = Tools.categories[cn2];
                                                var tr2 = box.querySelector('.tool-cat-trigger');
                                                if (tr2) {
                                                    var ic2 = tr2.querySelector('.tool-cat-icon');
                                                    var nm2 = tr2.querySelector('.tool-cat-name');
                                                    if (ic2) ic2.textContent = cdef2.icon;
                                                    if (nm2) nm2.textContent = cn2;
                                                }
                                                catMenu2.querySelectorAll('.tool-cat-item').forEach(function (i3) {
                                                    i3.classList.toggle('active', i3.dataset.cat === cn2);
                                                });
                                                Store.saveChatBox(chat);
                                                Store.addLog('info', chat.id, 'cat-switch', '用户切换工具分类(引擎菜单重建): ' + cn2);
                                            });
                                        });
                                    }
                                    Store.saveChatBox(chat);
                                    Store.addLog('info', chat.id, 'cat-switch', '引擎联动切换工具分类: ' + targetCat);
                                }
                            })();
                        });
                    });
                };
                // 打开菜单时动态重建引擎列表（DB.loadEngines 异步，恢复对话路径初始可能为空）
                trackListener(engTrigger, 'click', function(e) {
                    e.stopPropagation();
                    var isOpen = !engMenu.hidden;
                    engMenu.hidden = isOpen;
                    if (!isOpen) {
                        var tr = engTrigger.getBoundingClientRect();
                        var spaceBelow = window.innerHeight - tr.bottom - 12;
                        var openDown = spaceBelow > tr.top - 12;
                        engMenu.classList.toggle('opens-down', openDown);
                        // 重建引擎列表（_engine '' = 服务端默认，固定补一个"默认"项）
                        var _list = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines() : [];
                        var _cur = chat._engine || '';
                        var _h = '<div class="eng-item' + (_cur === '' ? ' active' : '') + '" data-eng="" title="服务端默认引擎 (zf_core)"><span>默认</span></div>';
                        _list.forEach(function(en) {
                            _h += '<div class="eng-item' + (en.id === _cur ? ' active' : '') + '" data-eng="' + en.id + '" title="' + (en.description || '').replace(/"/g, '&quot;') + '"><span>' + (en.icon ? en.icon + ' ' : '') + en.name + '</span>' + (en.default ? '<span style="opacity:.6;font-size:10px;">默认</span>' : '') + '</div>';
                        });
                        engMenu.innerHTML = _h;
                        _bindEngItems();
                    }
                });
                trackListener(document, 'click', function(e) {
                    if (!engMenu.hidden && !engTrigger.contains(e.target) && !engMenu.contains(e.target)) {
                        engMenu.hidden = true;
                    }
                });
                // 恢复按钮显示：对话快照带 _engine 时，触发按钮直接显示引擎名
                if (chat._engine) {
                    var en0 = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines().filter(function(x){return x.id===chat._engine;})[0] : null;
                    var nameEl0 = engTrigger.querySelector('.eng-name');
                    if (nameEl0) nameEl0.textContent = en0 ? ((en0.icon ? en0.icon + ' ' : '') + en0.name) : chat._engine;
                }
            }

            // 发送消息（支持排队）
            // 工具分类下拉菜单
            var catTrigger = box.querySelector('.tool-cat-trigger');
            var catMenu = box.querySelector('.tool-cat-menu');
            if (catTrigger && catMenu) {
                trackListener(catTrigger, 'click', function(e) {
                    e.stopPropagation();
                    var isOpen = !catMenu.hidden;
                    catMenu.hidden = isOpen;
                    if (!isOpen) {
                        var triggerRect = catTrigger.getBoundingClientRect();
                        var spaceAbove = triggerRect.top - 12;
                        var spaceBelow = window.innerHeight - triggerRect.bottom - 12;
                        var openDown = spaceBelow > spaceAbove;
                        var availableHeight = Math.max(120, openDown ? spaceBelow : spaceAbove);
                        catMenu.classList.toggle('opens-down', openDown);
                        catMenu.style.maxHeight = Math.min(320, availableHeight) + 'px';
                        catMenu.scrollTop = 0;
                    }
                });
                // 点击菜单项切换分类（带确认弹窗）
                catMenu.querySelectorAll('.tool-cat-item').forEach(function(item) {
                    item.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var catName = this.dataset.cat;
                        if (!catName) return;
                        var currentCat = Tools.chatCategories[chat.id] || Tools.activeCategory;
                        if (catName === currentCat) { catMenu.hidden = true; return; }
                        var newCat = Tools.categories[catName];
                        if (!newCat) return;
                        catMenu.hidden = true;
                        Tools.currentChatId = chat.id;
                        Tools.setCategory(catName);
                        var iconEl = catTrigger.querySelector('.tool-cat-icon');
                        var nameEl = catTrigger.querySelector('.tool-cat-name');
                        if (iconEl) iconEl.textContent = newCat.icon;
                        if (nameEl) nameEl.textContent = catName;
                        catMenu.querySelectorAll('.tool-cat-item').forEach(function(i) {
                            i.classList.toggle('active', i.dataset.cat === catName);
                        });
                        chat.toolCategory = catName;
                        Store.saveChatBox(chat);
                        Store.addLog('info', chat.id, 'cat-switch', '用户切换工具分类: ' + catName);
                        var swToolList = newCat.tools.filter(function(t) { return t !== 'task_complete' && t !== 'switch_tool_category'; });
                        self.showCategorySwitchNotify({
                            catName: catName,
                            catIcon: newCat.icon,
                            catDesc: newCat.desc,
                            toolCount: swToolList.length,
                            chatId: chat.id
                        });
                        self.playSwitchSound();
                    });
                });
                // 点击外部关闭菜单
                trackListener(document, 'click', function(e) {
                    if (!catMenu.hidden && !catTrigger.contains(e.target) && !catMenu.contains(e.target)) {
                        catMenu.hidden = true;
                    }
                });
            }

            function send() {
                var text = input.value.trim();
                // 【修复】这里只"偷看"不取走：真正取走（takePendingImages）必须发生在 _doSend 里。
                // 旧代码在这里就 take 一次，_doSend 里又 take 一次 → 第二次取到空数组，
                // 用户手动附加的图片在两次 take 之间被静默丢弃（模型永远看不到图）。
                var pendingImgs = ((App._pendingImages || {})[box.id]) || [];
                // 【自动识图】若没有手动附加图片，且项目面板选中了图片，自动带上第一张
                if ((!pendingImgs || !pendingImgs.length) && typeof App._getSelectedImageFiles === 'function') {
                    try {
                        App._getSelectedImageFiles(function(imgFile) {
                            // 文件树没有选中图片时，回退到画布选中的参考图（PureRef 式参考板）
                            if (!imgFile && typeof window.MRef === 'object' && MRef.selected().length) {
                                // 【修复】visionSend() 是异步注入（fetch.then 后才 _addPendingImages），
                                // 不能先 visionSend 再立刻 _doSend（那时图还没进暂存区，发送会丢图）。
                                // 改为与下方【画布识图】相同的同步 fetch → 注入 → 再发送的流程。
                                try {
                                    var _mrefNode2 = MRef.selected().filter(function(n){ var i = n.querySelector('.media-node-el'); return i && i.tagName === 'IMG' && i.src; })[0];
                                    if (_mrefNode2) {
                                        var _mrefImg2 = _mrefNode2.querySelector('.media-node-el');
                                        var _mrefName2 = (_mrefImg2.alt || 'refboard.png').split(/[\\\/]/).pop() || 'refboard.png';
                                        fetch(_mrefImg2.src).then(function(r) { return r.ok ? r.blob() : null; }).then(function(blob) {
                                            if (blob && typeof App._addPendingImages === 'function') {
                                                App._addPendingImages(box, [new File([blob], _mrefName2, { type: blob.type || 'image/png' })]);
                                            }
                                            _withAudio(function(audioPart) { _doSend(text, audioPart); });
                                        }).catch(function() { _withAudio(function(audioPart) { _doSend(text, audioPart); }); });
                                        return;
                                    }
                                } catch (e) {}
                            }
                            if (imgFile && typeof App._addPendingImages === 'function') {
                                App._addPendingImages(box, [imgFile]);
                            }
                            _withAudio(function(audioPart) { _doSend(text, audioPart); });
                        });
                        return;
                    } catch (e) {}
                }
                // 【画布识图】项目面板没选中图片、但画布选中了参考图 → 附加画布图
                if ((!pendingImgs || !pendingImgs.length) && typeof window.MRef === 'object' && MRef.selected().length) {
                    var _mrefBox = box;
                    try {
                        var _mrefNode = MRef.selected().filter(function(n){ var i = n.querySelector('.media-node-el'); return i && i.tagName === 'IMG' && i.src; })[0];
                        if (_mrefNode) {
                            var _mrefImg = _mrefNode.querySelector('.media-node-el');
                            var _mrefName = (_mrefImg.alt || 'refboard.png').split(/[\\\/]/).pop() || 'refboard.png';
                            fetch(_mrefImg.src).then(function(r) { return r.ok ? r.blob() : null; }).then(function(blob) {
                                if (blob && typeof App._addPendingImages === 'function') {
                                    App._addPendingImages(_mrefBox, [new File([blob], _mrefName, { type: blob.type || 'image/png' })]);
                                }
                                _withAudio(function(audioPart) { _doSend(text, audioPart); });
                            }).catch(function() { _withAudio(function(audioPart) { _doSend(text, audioPart); }); });
                            return;
                        }
                    } catch (e) {}
                }
                // 【自动语音】若项目面板选中了音频文件，自动转 base64 随消息发送
                _withAudio(function(audioPart) { _doSend(text, audioPart); });
            }

            // 【自动语音】读取选中音频文件 → OpenAI input_audio 部分
            function _withAudio(cb) {
                if (typeof App._getSelectedAudioFile === 'function') {
                    try {
                        App._getSelectedAudioFile(function(f) {
                            if (!f) { cb(null); return; }
                            var fr = new FileReader();
                            fr.onload = function() {
                                var b64 = String(fr.result || '').split(',')[1] || '';
                                if (!b64) { cb(null); return; }
                                var ext = (String(f.name).split('.').pop() || 'wav').toLowerCase();
                                var fmtMap = { mp3: 'mp3', wav: 'wav', m4a: 'm4a', ogg: 'ogg', flac: 'flac', webm: 'webm' };
                                cb({ type: 'input_audio', input_audio: { data: b64, format: fmtMap[ext] || 'wav' } });
                            };
                            fr.onerror = function() { cb(null); };
                            fr.readAsDataURL(f);
                        });
                        return;
                    } catch (e) {}
                }
                cb(null);
            }

            function _doSend(text, audioPart) {
                // 【修复】发送消息时立即停止语音听写（点发送后录音不应继续）
                try { if (window.VoiceInput && typeof window.VoiceInput.stop === 'function') window.VoiceInput.stop(true); } catch(e) {}
                var pendingImgs = (typeof App.takePendingImages === 'function') ? App.takePendingImages(box) : [];
                // 【粘贴卡片】取出粘贴的大段文本，用标记框住附在消息后，便于模型区分粘贴内容与用户输入
                var pastes = (typeof App.takePendingPastes === 'function') ? App.takePendingPastes(box) : [];
                if (pastes && pastes.length) {
                    var pblock = '';
                    for (var pi = 0; pi < pastes.length; pi++) {
                        pblock += '【粘贴内容 ' + (pi + 1) + ' 开始】\n' + pastes[pi] + '\n【粘贴内容 ' + (pi + 1) + ' 结束】\n';
                    }
                    text = (text ? text + '\n\n' : '') + pblock;
                }
                try { App.renderPendingPastes(box); } catch(e) {}
                if (!text && (!pendingImgs || !pendingImgs.length) && !audioPart) return;
                // 【项目上下文工具】把当前项目/当前浏览目录/缩略图选中文件注入消息
                // 【修复】提取为 App._buildContextPrefix()：排队消息入队时只存纯文本，
                //         出队真正发送时再注入最新上下文，避免界面上显示一大串上下文
                if (typeof App._buildContextPrefix !== 'function') {
                    App._buildContextPrefix = function() {
                        var _ctxPrefix = '';
                        try {
                            if (typeof App.getProjectContext === 'function') {
                                var _pctx = App.getProjectContext();
                                if (_pctx) {
                                    _ctxPrefix = '【当前项目上下文】\n' +
                                        '项目: ' + (_pctx.project_name || '(未指定)') + (_pctx.project_id ? ' (id=' + _pctx.project_id + ')' : '') + '\n' +
                                        '根目录: ' + (_pctx.root || '未关联项目目录') + '\n' +
                                        '当前浏览目录: ' + (_pctx.cwd || '-') + '\n';
                                    if (_pctx.selected && _pctx.selected.length) {
                                        _ctxPrefix += '用户选中的文件:\n';
                                        _pctx.selected.forEach(function(f) { _ctxPrefix += '- ' + f.name + ' → ' + f.path + '\n'; });
                                    } else {
                                        _ctxPrefix += '用户未在缩略图中选中文件\n';
                                    }
                                    // 【缩略图文本预览联动】双击文本文件打开的预览里框选文字 → 注入对话上下文
                                    if (_pctx.preview_selection) {
                                        var _ps = _pctx.preview_selection;
                                        _ctxPrefix += '\n预览文件中框选的文字: 文件: ' + _ps.name + ' → ' + _ps.path + ' (第 ' + _ps.line_start + '-' + _ps.line_end + ' 行)\n---选中内容开始---\n' + _ps.text + '\n---选中内容结束---\n';
                                    }
                                    _ctxPrefix += '\n';
                                }
                            }
                            // 【超长计划自动唤醒】检测未完成的超长计划，注入提醒让新对话无缝续做
                            // （每对话只注入一次，用户明确说做别的也照注入，由模型自行权衡）
                            try {
                                if (!App._longPlanReminded) App._longPlanReminded = {};
                                var _cid = (typeof App.getCurrentChatId === 'function') ? App.getCurrentChatId() : '';
                                if (!App._longPlanReminded[_cid] && typeof callToolApi === 'function') {
                                    // 【性能修复】原为同步 XHR（open(..., false)），每次点发送都阻塞主线程等待后端
                                    // 扫描全部计划文件；后端慢/计划文件多时「点发送特别卡」。改为异步 fetch 不阻塞。
                                    try {
                                        fetch('/api/tools/long_plan', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ action: 'list' })
                                        }).then(function(r) { return r.json(); }).then(function(_lr) {
                                            if (!(_lr && _lr.ok && _lr.plans && _lr.plans.length)) return;
                                            var _open = _lr.plans.filter(function(p) { return !p.finished; });
                                            if (!_open.length || App._longPlanReminded[_cid]) return; // 期间已被注入则跳过
                                            var _p = _open[0];
                                            App._longPlanReminded[_cid] = true;
                                            App._pendingPlanHints = App._pendingPlanHints || {};
                                            App._pendingPlanHints[_cid] = '【超长计划提醒】\n' +
                                                '存在未完成的超长计划: ' + _p.plan_id + '「' + (_p.title || '') + '」\n' +
                                                '进度: ' + _p.done + '/' + _p.total + '\n' +
                                                '强制规则: 请先调用 long_plan.stats(plan_id="' + _p.plan_id + '") 查看进度，再调用 plan_batch.claim 认领下一批继续执行；除非用户明确要求做其他事情（那样也须先告知用户该计划未完成）。\n\n';
                                        }).catch(function() {});
                                    } catch (_e2) {}
                                }
                            } catch (_e) {}
                            // 用户在页面上划选的文本
                            var _sel = window.getSelection ? String(window.getSelection()).trim() : '';
                            if (_sel && _sel.length > 1 && _sel.length < 4000) {
                                _ctxPrefix += '【用户划选的文本】\n' + _sel + '\n\n';
                            }
                            // 【画布选中节点】用户框选/点选的画布节点（流程图节点含上下游）
                            try {
                                if (window.CanvasAgent && typeof CanvasAgent.getSelectedNodesInfo === 'function') {
                                    var _cns = CanvasAgent.getSelectedNodesInfo();
                                    if (_cns && _cns.length) {
                                        _ctxPrefix += '【用户当前选中的画布节点】(共 ' + _cns.length + ' 个)\n';
                                        _cns.forEach(function (_cn) { _ctxPrefix += '- ' + _cn + '\n'; });
                                        _ctxPrefix += '\n';
                                    }
                                }
                            } catch (e) {}
                        } catch (e) {}
                        // 【超长计划提醒】异步检测结果在下一次发送时补上（不再阻塞本次发送）
                        try {
                            var _hintCid = (typeof App.getCurrentChatId === 'function') ? App.getCurrentChatId() : '';
                            if (App._pendingPlanHints && App._pendingPlanHints[_hintCid]) {
                                _ctxPrefix += App._pendingPlanHints[_hintCid];
                                delete App._pendingPlanHints[_hintCid];
                            }
                        } catch (e) {}
                        return _ctxPrefix;
                    };
                }
                var _ctxPrefix = App._buildContextPrefix();
                var _origText = text;
                if (_ctxPrefix) text = _ctxPrefix + text;
                input.value = '';
                input.style.height = '36px';
                try { var _pib = box.querySelector('.pending-images-bar'); if (_pib) _pib.style.display = 'none'; } catch(e) {}
                // 如果正在发送中，加入排队（仅纯文本入队，带图消息需等待当前轮完成）
                if (chat.isSending) {
                    if (pendingImgs && pendingImgs.length) {
                        // 【修复】图片已从暂存区取出，排队前必须放回，否则图片被静默丢弃
                        var _imgStore = App._pendingImages = App._pendingImages || {};
                        _imgStore[box.id] = pendingImgs.concat(_imgStore[box.id] || []);
                        App.renderPendingImages(box);
                        App.addMsg(box, '⚠️ 当前正在回复中，请等本轮结束后再发送带图消息（图片已放回暂存区，不会丢失）', 'error');
                        return;
                    }
                    var qItem = { id: 'q' + Date.now() + Math.floor(Math.random()*1000), text: _origText };
                    chat.queue.push(qItem);
                    self.renderQueue(box, chat);
                    Store.addLog('info', chat.id, 'queue', '消息已排队 (' + chat.queue.length + '): ' + _origText.substring(0, 80));
                    return;
                }
                self.addMsg(box, _origText || ('[图片 x' + pendingImgs.length + ']'), 'user', chat.modelId);
                // 【增强】把用户发送的原始图片渲染进消息气泡（缩略图，点击看原图）
                if (pendingImgs && pendingImgs.length) {
                    try {
                        var _body = box.querySelector('.chatbox-body');
                        var _lastUser = _body ? _body.lastElementChild : null;
                        if (_lastUser && _lastUser.classList.contains('user')) {
                            var _imgWrap = document.createElement('span');
                            _imgWrap.className = 'msg-user-imgs';
                            _imgWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;';
                            for (var _ii = 0; _ii < pendingImgs.length; _ii++) {
                                (function(_url) {
                                    var _im = document.createElement('img');
                                    _im.src = _url;
                                    _im.alt = '图片';
                                    _im.style.cssText = 'max-width:180px;max-height:180px;width:auto;height:auto;border-radius:8px;cursor:zoom-in;object-fit:contain;border:1px solid rgba(255,255,255,.15);';
                                    _im.addEventListener('click', function(e) {
                                        e.stopPropagation();
                                        if (typeof App._openImageLightbox === 'function') App._openImageLightbox(_url);
                                    });
                                    _imgWrap.appendChild(_im);
                                })(pendingImgs[_ii].dataUrl);
                            }
                            _lastUser.insertBefore(_imgWrap, _lastUser.querySelector('.msg-copy-btn') || _lastUser.firstChild.nextSibling);
                        }
                    } catch (e) {}
                }
                self.showQueryPin(box, _origText || ('[图片 x' + pendingImgs.length + ']'));
                self.updateChatTitle(box, _origText || '图片消息');
                var userMsg;
                if (pendingImgs && pendingImgs.length) {
                    var parts = [];
                    for (var pi = 0; pi < pendingImgs.length; pi++) {
                        parts.push({ type: 'image_url', image_url: { url: pendingImgs[pi].dataUrl } });
                    }
                    if (audioPart) parts.push(audioPart);
                    if (text) parts.push({ type: 'text', text: text });
                    userMsg = { role: 'user', content: parts };
                } else if (audioPart) {
                    var _aparts = [audioPart];
                    if (text) _aparts.push({ type: 'text', text: text });
                    userMsg = { role: 'user', content: _aparts };
                } else {
                    userMsg = { role: 'user', content: text };
                }
                chat.history.push(userMsg);
                Store.addLog('info', chat.id, 'send', pendingImgs.length ? ('用户发送消息(含图片x' + pendingImgs.length + ')') : '用户发送消息');
                self.sendToModel(box, chat);
            }
            if (sendBtn) sendBtn.addEventListener('click', function() {
                // 【修复】语音命令触发的发送：AI 正在回复时不停止当前对话，改为走 send() 的排队逻辑
                if (chat.isSending && box.__voiceSendPending) {
                    box.__voiceSendPending = false;
                    send();
                    return;
                }
                if (chat.isSending) {
                    self.stopSending(chat);
                } else {
                    send();
                }
            });
            if (input) {
                input.addEventListener('compositionstart', function() { this._composing = true; });
                input.addEventListener('compositionend', function() { this._composing = false; });
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' && !e.shiftKey && !this._composing) { e.preventDefault(); send(); }
                });

                // textarea 自动跟随高度（超过一行自动变两行，上限两行，发送后回弹）
                function autoResize() {
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 56) + 'px';
                }
                input.addEventListener('input', autoResize);
            }

            // 拖拽移动（rAF 节流 + 除以 scale，保证缩放状态下跟手）
            // Shift+左键拖拽 = 按下瞬间复制一个一模一样的对话（新 id + DB 单独会话），
            // 副本出现在鼠标按下位置并跟随拖拽移动，原对话不动；松开后副本停住。
            var dragging = false, sx = 0, sy = 0, sl = 0, st = 0, dragRaf = 0, dragMoved = false;
            var shiftCloneDone = false;   // 副本是否已创建（按下即创建，避免重复）
            var cloneChat = null;        // 被拖拽的副本 chat 对象
            var cloneBox = null;         // 被拖拽的副本 DOM
            var csl = 0, cst = 0;        // 副本按下时的画布坐标
            var cloneRaf = 0;
            if (header) header.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                if (e.target.closest('.hd-btn') || e.target.closest('.model-select') || e.target.closest('.model-picker-wrap')) return;
                // Shift 按住 = 立即复制模式：按下即生成副本并出现在鼠标位置
                if (e.shiftKey) {
                    if (!shiftCloneDone) {
                        shiftCloneDone = true;
                        cloneChat = null; cloneBox = null;
                        try {
                            if (typeof self.cloneChatBox === 'function') {
                                cloneChat = self.cloneChatBox(chat, e.clientX, e.clientY);
                                if (cloneChat && cloneChat.el) {
                                    cloneBox = cloneChat.el;
                                    // 以副本当前画布坐标为拖拽基准，后续 mousemove 移动副本
                                    csl = cloneBox.offsetLeft;
                                    cst = cloneBox.offsetTop;
                                    sx = e.clientX; sy = e.clientY;
                                    self._setQuestionsPanelDragging(true);
                                }
                            } else {
                                console.warn('[Shift+拖拽] cloneChatBox 方法不存在');
                            }
                        } catch (err) {
                            console.error('[Shift+拖拽] 复制失败:', err);
                        }
                    }
                    dragging = false;
                    e.preventDefault();
                    return;
                }
                shiftCloneDone = false;
                cloneChat = null; cloneBox = null;
                dragging = true; dragMoved = false;
                self._setQuestionsPanelDragging(true);
                sx = e.clientX; sy = e.clientY;
                sl = box.offsetLeft; st = box.offsetTop;
                e.preventDefault();
            });
            trackListener(document, 'mousemove', function(e) {
                // Shift 副本拖拽：移动的是副本，不是原 box
                if (shiftCloneDone && cloneBox) {
                    var cdx = e.clientX - sx, cdy = e.clientY - sy;
                    if (Math.abs(cdx) > 1 || Math.abs(cdy) > 1) dragMoved = true;
                    if (cloneRaf) return;
                    cloneRaf = requestAnimationFrame(function() {
                        cloneRaf = 0;
                        var sc = self.canvasScale();
                        cloneBox.style.left = (csl + cdx / sc) + 'px';
                        cloneBox.style.top = (cst + cdy / sc) + 'px';
                        self._updateAllNavArrows();
                    });
                    return;
                }
                if (!dragging) return;
                var dx = e.clientX - sx, dy = e.clientY - sy;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
                if (!dragRaf) {
                    dragRaf = requestAnimationFrame(function() {
                        dragRaf = 0;
                        var sc = self.canvasScale();
                        box.style.left = (sl + dx / sc) + 'px';
                        box.style.top = (st + dy / sc) + 'px';
                        self._updateAllNavArrows();
                    });
                }
            });
            function stopBoxDrag(e) {
                // Shift 复制拖拽结束：持久化副本位置
                if (shiftCloneDone && cloneBox) {
                    if (cloneChat) {
                        cloneChat.x = cloneBox.offsetLeft;
                        cloneChat.y = cloneBox.offsetTop;
                        Store.saveChatBox(cloneChat);
                        self.updateMinimap();
                        if (self._updateAllNavArrows) self._updateAllNavArrows();
                    }
                    self._setQuestionsPanelDragging(false);
                }
                shiftCloneDone = false;
                cloneChat = null; cloneBox = null;
                if (cloneRaf) { cancelAnimationFrame(cloneRaf); cloneRaf = 0; }
                if (dragging) {
                    Store.saveChatBox(chat); self.updateMinimap(); if (self._updateAllNavArrows) self._updateAllNavArrows();
                    self._setQuestionsPanelDragging(false);
                }
                dragging = false;
                if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
            }
            trackListener(document, 'mouseup', stopBoxDrag);
            trackListener(window, 'blur', stopBoxDrag);

            // ===== 缩放手柄：仅 south / east / west / south-east / south-west =====
            var resizing = false, resizeDir = '', resizeRaf = 0;
            var rStartX = 0, rStartY = 0, rLeft = 0, rTop = 0, rW = 0, rH = 0;
            var MIN_W = 280, MIN_H = 200;
            var DIRS = ['south-east','south-west','south','east','west'];

            box.querySelectorAll('.chatbox-resize-handle').forEach(function(handle) {
                handle.addEventListener('pointerdown', function(e) {
                    e.preventDefault(); e.stopPropagation();
                    resizing = true;
                    resizeDir = DIRS.find(function(d) { return handle.classList.contains(d); }) || '';
                    rStartX = e.clientX; rStartY = e.clientY;
                    rLeft = box.offsetLeft; rTop = box.offsetTop;
                    rW = box.offsetWidth; rH = box.offsetHeight;
                    if (handle.setPointerCapture) { try { handle.setPointerCapture(e.pointerId); } catch(_){} }
                });
            });

            trackListener(document, 'pointermove', function(e) {
                if (!resizing) return;
                e.preventDefault();
                var scale = self.canvasScale() || 1;
                var dx = (e.clientX - rStartX) / scale;
                var dy = (e.clientY - rStartY) / scale;
                if (resizeRaf) return;
                resizeRaf = requestAnimationFrame(function() {
                    resizeRaf = 0;
                    var w = rW, h = rH, left = rLeft, top = rTop;
                    // 右边拉伸
                    if (resizeDir === 'east' || resizeDir === 'south-east')
                        w = Math.max(MIN_W, rW + dx);
                    // 左边拉伸（左边移动，宽度反向）
                    if (resizeDir === 'west' || resizeDir === 'south-west') {
                        w = Math.max(MIN_W, rW - dx);
                        left = rLeft + rW - w;
                    }
                    // 下边拉伸
                    if (resizeDir === 'south' || resizeDir === 'south-east' || resizeDir === 'south-west')
                        h = Math.max(MIN_H, rH + dy);
                    box.style.width = w + 'px';
                    box.style.height = h + 'px';
                    box.style.left = left + 'px';
                    box.style.top = top + 'px';
                    box.classList.remove('collapsed');
                });
            });

            function stopBoxResize() {
                if (resizing) {
                    Store.saveChatBox(chat);
                    self.updateMinimap();
                    if (self._updateAllNavArrows) self._updateAllNavArrows();
                    if (!box.classList.contains('collapsed'))
                        self.rememberBoxSize(box.offsetWidth, box.offsetHeight);
                        try { if (window.UserSettings && UserSettings.setChatPreferences) UserSettings.setChatPreferences(null, { w: box.offsetWidth, h: box.offsetHeight }, null); } catch (e) {}
                }
                resizing = false; resizeDir = '';
                if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
            }
            trackListener(document, 'pointerup', stopBoxResize);
            trackListener(document, 'pointercancel', stopBoxResize);
            trackListener(window, 'blur', stopBoxResize);

            // 滚动到底部浮动按钮（从小圆圈下箭头抄袭升级版：自动跟随 + 脉冲动画）
            var scrollBottomBtn = box.querySelector('.scroll-bottom-btn');
            chat.autoFollowBottom = true;
            chat._scrollBtn = scrollBottomBtn;
            function updateScrollBtn() {
                if (!scrollBottomBtn) return;
                var atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
                if (atBottom) {
                    scrollBottomBtn.classList.remove('visible');
                    scrollBottomBtn.classList.remove('is-processing');
                } else {
                    scrollBottomBtn.classList.add('visible');
                    // AI 正在回复时添加脉冲动画
                    if (chat.isSending) {
                        scrollBottomBtn.classList.add('is-processing');
                    } else {
                        scrollBottomBtn.classList.remove('is-processing');
                    }
                }
            }
            if (scrollBottomBtn) {
                scrollBottomBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    chat.autoFollowBottom = true;
                    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
                    setTimeout(function() {
                        body.scrollTop = body.scrollHeight;
                        updateScrollBtn();
                if (typeof updatePrevUserBtn === 'function') updatePrevUserBtn();
                    }, 220);
                });
            }

            // 上一条用户问题定位按钮（小三角 ▲ 定位到当前视口上方的上一条 user 消息处）
            var prevUserBtn = body.querySelector('.prev-user-btn');
            if (prevUserBtn) {
                var _prevUserVisible = false;
                var updatePrevUserBtn = function() {
                    var users = body.querySelectorAll('.msg.user');
                    var show = users.length >= 2;
                    if (show !== _prevUserVisible) {
                        _prevUserVisible = show;
                        if (show) prevUserBtn.classList.add('visible');
                        else prevUserBtn.classList.remove('visible');
                    }
                };
                prevUserBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var users = body.querySelectorAll('.msg.user');
                    if (users.length === 0) return;
                    var bodyTop = body.getBoundingClientRect().top;
                    var viewTopInBody = body.scrollTop;
                    var target = null;
                    // 倒序查找：找视口顶部上方（含容差）最近的一条 user 消息
                    for (var i = users.length - 1; i >= 0; i--) {
                        var uTopInBody = users[i].getBoundingClientRect().top - bodyTop + body.scrollTop;
                        if (uTopInBody < viewTopInBody + 20) { target = users[i]; break; }
                    }
                    if (!target) target = users[users.length - 1]; // 已到最上方则回到最新一条
                    chat.autoFollowBottom = false;
                    body.scrollTo({ top: Math.max(target.offsetTop - 40, 0), behavior: 'smooth' });
                });
            }

            // 条件滚动：只在自动跟随底部时滚动（用户滚上去后不强制拉回）
            chat.scrollToBottomIfFollowing = function() {
                if (chat.autoFollowBottom) {
                    body.scrollTop = body.scrollHeight;
                }
                updateScrollBtn();
                if (typeof updatePrevUserBtn === 'function') updatePrevUserBtn();
            };

            // 对话框内滚动位置持久化 + 自动跟随状态跟踪
            var scrollTimer = null;
            if (body) body.addEventListener('scroll', function() {
                // 用户手动滚动时更新自动跟随状态
                chat.autoFollowBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
                if (scrollTimer) clearTimeout(scrollTimer);
                scrollTimer = setTimeout(function() {
                    // 更新 entry 的 scrollPos（不触发完整 saveChatBox）
                    var entry = null;
                    for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                        if (Store.data.chatBoxes[i].id === chat.id) {
                            Store.data.chatBoxes[i].scrollPos = body.scrollTop;
                            entry = Store.data.chatBoxes[i];
                            break;
                        }
                    }
                    Store._saveLocal();
                    if (entry && Store.dbOnline && typeof DB !== 'undefined') {
                        DB.saveNode(entry).catch(function(e) {
                            // 网络断开/熔断期间静默，本地已有 _saveLocal 兜底，不刷控制台
                            if (!e || (e.message !== 'circuit-open' && !/Failed to fetch|NetworkError/i.test(e.message || '')))
                                console.warn('[Chatbox] node save failed:', e);
                        });
                    }
                }, 300);
                updateScrollBtn();
                if (typeof updatePrevUserBtn === 'function') updatePrevUserBtn();
            });
            // 定时更新按钮状态（捕获动态内容增长导致的滚动位置变化）
            var _scrollBtnVisible = false; var _scrollBtnProcessing = false;
            var scrollBtnTimer = setInterval(function() {
                if (!scrollBottomBtn) return;
                var atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
                var shouldShow = !atBottom;
                var isProc = !!chat.isSending;
                if (shouldShow !== _scrollBtnVisible) {
                    _scrollBtnVisible = shouldShow;
                    if (shouldShow) scrollBottomBtn.classList.add('visible');
                    else { scrollBottomBtn.classList.remove('visible'); scrollBottomBtn.classList.remove('is-processing'); }
                }
                if (shouldShow && isProc !== _scrollBtnProcessing) {
                    _scrollBtnProcessing = isProc;
                    if (isProc) scrollBottomBtn.classList.add('is-processing');
                    else scrollBottomBtn.classList.remove('is-processing');
                }
            }, 800);
            // 将定时器引用存入 chat._cleanup，供 closeChatBox 清理
            chat._cleanup.scrollBtnTimer = scrollBtnTimer;

            // ===== 会话导航箭头 =====
            self._setupNavArrows(box, chat);
            self._updateAllNavArrows();
            // 定时刷新箭头颜色（捕获 isSending/queue/error 等状态变化）
            var navArrowTimer = setInterval(function() {
                self._updateAllNavArrows();
            }, 2000);
            chat._cleanup.navArrowTimer = navArrowTimer;

        },

        // ===== Markdown 渲染（增强版：代码高亮 + HTML 转义 + 图片增强） =====
        renderMarkdown: function(text) {
            if (typeof marked !== 'undefined') {
                try {
                    if (!marked._zf3dInited) { marked.setOptions({ gfm: true, breaks: true, highlight: function(code, lang) {
                        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                            try { return hljs.highlight(code, { language: lang }).value; } catch(e) {}
                        }
                        return code;
                    }}); marked._zf3dInited = true; }
                    var renderer = new marked.Renderer();
                    renderer.html = function(token) {
                        var raw = typeof token === 'string' ? token : (token && (token.raw || token.text) || '');
                        return App._escapeHtml(raw);
                    };
                    return marked.parse(text, { renderer: renderer });
                } catch(e) {
                    console.warn('[renderMarkdown] marked error:', e);
                }
            }
            // 降级：转义 HTML 后保留换行
            var esc = String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return '<p>' + esc.replace(/\n/g,'<br>') + '</p>';
        },
});
