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
                    } else if (act === 'close') {
                        self.closeChatBox(chat);
                    } else if (act === 'tools') {
                        self.toggleToolPanel(box);
                    } else if (act === 'project') {
                        self.showProjectSwitcher(box, chat);
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
                var pendingImgs = (typeof App.takePendingImages === 'function') ? App.takePendingImages(box) : [];
                if (!text && (!pendingImgs || !pendingImgs.length)) return;
                input.value = '';
                input.style.height = '36px';
                try { var _pib = box.querySelector('.pending-images-bar'); if (_pib) _pib.style.display = 'none'; } catch(e) {}
                // 如果正在发送中，加入排队（仅纯文本入队，带图消息需等待当前轮完成）
                if (chat.isSending) {
                    if (pendingImgs && pendingImgs.length) {
                        App.addMsg(box, '⚠️ 当前正在回复中，请等本轮结束后再发送带图消息', 'error');
                        setTimeout(function() { App.renderPendingImages(box); }, 50);
                        return;
                    }
                    var qItem = { id: 'q' + Date.now() + Math.floor(Math.random()*1000), text: text };
                    chat.queue.push(qItem);
                    self.renderQueue(box, chat);
                    Store.addLog('info', chat.id, 'queue', '消息已排队 (' + chat.queue.length + '): ' + text.substring(0, 80));
                    return;
                }
                self.addMsg(box, text || ('[图片 x' + pendingImgs.length + ']'), 'user', chat.modelId);
                self.showQueryPin(box, text || ('[图片 x' + pendingImgs.length + ']'));
                self.updateChatTitle(box, text || '图片消息');
                var userMsg;
                if (pendingImgs && pendingImgs.length) {
                    var parts = [];
                    for (var pi = 0; pi < pendingImgs.length; pi++) {
                        parts.push({ type: 'image_url', image_url: { url: pendingImgs[pi].dataUrl } });
                    }
                    if (text) parts.push({ type: 'text', text: text });
                    userMsg = { role: 'user', content: parts };
                } else {
                    userMsg = { role: 'user', content: text };
                }
                chat.history.push(userMsg);
                Store.addLog('info', chat.id, 'send', pendingImgs.length ? ('用户发送消息(含图片x' + pendingImgs.length + ')') : '用户发送消息');
                self.sendToModel(box, chat);
            }
            if (sendBtn) sendBtn.addEventListener('click', function() {
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

                // textarea 自动跟随高度（多行输入自动增高，发送后回弹）
                function autoResize() {
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
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
                        DB.saveNode(entry).catch(function(e) { console.warn('[Chatbox] node save failed:', e); });
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
