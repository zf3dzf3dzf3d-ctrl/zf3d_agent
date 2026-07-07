/**
 * 员工浮窗 - 可拖拽气泡 + 员工列表 + 员工对话
 * 独立模块，通过API与后端交互
 */
(function() {
    'use strict';

    let employees = [];
    let empCategories = [];  // [{id, name, collapsed, employeeNames:[]}]
    let empCatId = 0;
    let currentEmployee = '母体';
    let panelOpen = false;
    let chatOpen = false;
    let chatTarget = null;
    let chatSending = false;
    let dragData = null;
    let chatHistory = {};  // {员工名: [{role, content}, ...]}

    function init() {
        const bubble = document.createElement('div');
        bubble.className = 'emp-bubble';
        bubble.id = 'empBubble';
        bubble.innerHTML = '👥<span class="emp-badge online" id="empBadge" style="display:none">0</span>';
        bubble.title = '数字员工';
        document.body.appendChild(bubble);

        // 恢复上次位置（带边界检查）
        const savedPos = localStorage.getItem('empBubblePos');
        if (savedPos) {
            try {
                const pos = JSON.parse(savedPos);
                const x = Math.max(0, Math.min(window.innerWidth - 36, pos.x));
                const y = Math.max(0, Math.min(window.innerHeight - 36, pos.y));
                bubble.style.left = x + 'px';
                bubble.style.top = y + 'px';
                bubble.style.right = 'auto';
                bubble.style.transform = 'none';
            } catch (e) {}
        }

        const panel = document.createElement('div');
        panel.className = 'emp-panel';
        panel.id = 'empPanel';
        panel.innerHTML = `
            <div class="emp-panel-header">
                <span class="emp-panel-title">🏢 数字员工</span>
                <button class="emp-panel-close" onclick="window.empWidget.openWorkflow()" title="节点工作流">🔀</button>
                <button class="emp-panel-close" onclick="window.empWidget.openCreatePanel()" title="创建员工">➕</button>
                <button class="emp-panel-close" onclick="window.empWidget.togglePanel()" title="关闭">✕</button>
            </div>
            <div class="emp-list" id="empList"></div>
        `;
        document.body.appendChild(panel);

        const chatOverlay = document.createElement('div');
        chatOverlay.className = 'emp-chat-overlay';
        chatOverlay.id = 'empChatOverlay';
        chatOverlay.innerHTML = `
            <div class="emp-chat-box">
                <div class="emp-chat-header" id="empChatHeader"></div>
                <div class="emp-chat-body" id="empChatBody">
                    <div class="emp-chat-empty">开始与员工对话</div>
                </div>
                <div class="emp-chat-input">
                    <textarea id="empChatInput" placeholder="输入消息..." rows="1"></textarea>
                    <button id="empChatSend" onclick="window.empWidget.sendChat()">➤</button>
                </div>
            </div>
        `;
        document.body.appendChild(chatOverlay);

        // 节点工作流编辑器
        const wfOverlay = document.createElement('div');
        wfOverlay.className = 'emp-wf-overlay';
        wfOverlay.id = 'empWfOverlay';
        wfOverlay.innerHTML = `
            <div class="emp-wf-panel" id="empWfPanel">
                <div class="emp-wf-header" id="empWfHeader">
                    <div class="emp-wf-toolbar-left">
                        <button class="emp-wf-tool-btn" id="wfFileMenuBtn" title="文件">📁</button>
                        <div class="emp-wf-file-menu" id="empWfFileMenu" style="display:none">
                            <div onclick="window.empWidget.clearWorkflow(); window.empWidget._closeFileMenu()">📄 新建</div>
                            <div onclick="window.empWidget.loadWorkflowFile(); window.empWidget._closeFileMenu()">📂 加载</div>
                            <div onclick="window.empWidget.saveWorkflowFile(); window.empWidget._closeFileMenu()">💾 保存</div>
                            <div onclick="window.empWidget.saveWorkflowAs(); window.empWidget._closeFileMenu()">📋 另存为</div>
                            <div onclick="document.getElementById('wfImportInput').click(); window.empWidget._closeFileMenu()">📥 导入</div>
                            <div onclick="window.empWidget.exportWorkflow(); window.empWidget._closeFileMenu()">📤 导出</div>
                            <div class="emp-wf-menu-sep" style="height:1px;background:var(--border);margin:4px 0;padding:0"></div>
                            <div onclick="window.empWidget.closeWorkflow(); window.empWidget._closeFileMenu()" style="color:var(--red)">退出</div>
                        </div>
                    </div>
                    <span class="emp-wf-title">🔀 节点工作流</span>
                    <div class="emp-wf-toolbar-right">
                        <button class="emp-wf-tool-btn" onclick="window.empWidget.wfUndo()" title="撤销(Ctrl+Z)">↩️</button>
                        <button class="emp-wf-tool-btn" onclick="window.empWidget.wfRedo()" title="重做(Ctrl+Y)">↪️</button>
                        <span class="emp-wf-tool-sep"></span>
                        <button class="emp-wf-tool-btn" onclick="window.empWidget.createWfFrame()" title="分组">📦</button>
                        <button class="emp-wf-tool-btn" onclick="window.empWidget.autoLayout()" title="自动对齐">📐</button>
                        <button class="emp-wf-tool-btn" onclick="window.empWidget.autoDesign()" title="AI设计">🤖</button>
                        <button class="emp-wf-tool-btn" onclick="window.empWidget.fitWorkflow()" title="适应窗口">⊡</button>
                        <button class="emp-wf-tool-btn" onclick="window.empWidget._toggleScissors()" title="剪刀模式(按住Y)" id="wfScissorsBtn">✂️</button>
                        <button class="emp-wf-tool-btn" onclick="window.empWidget.clearWorkflow()" title="清空">🗑️</button>
                        <span class="emp-wf-tool-sep"></span>
                        <button class="emp-wf-close-btn" onclick="window.empWidget.closeWorkflow()" title="关闭">✕</button>
                    </div>
                </div>
                <div class="emp-wf-body">
                    <div class="emp-wf-canvas-wrap" id="empWfCanvasWrap">
                        <input type="file" id="wfImportInput" accept=".json" style="display:none" onchange="window.empWidget.importWorkflow(this)">
                        <div class="emp-wf-canvas" id="empWfCanvas">
                            <svg class="emp-wf-svg" id="empWfSvg"></svg>
                            <svg class="emp-wf-anim-overlay" id="empWfAnimOverlay"></svg>
                            <svg class="emp-wf-cut-svg" id="empWfCutSvg" style="display:none"></svg>
                            <div class="emp-wf-selection-box" id="wfSelBox"></div>
                        </div>
                        <div class="emp-wf-log" id="empWfLog"></div>
                    </div>
                </div>
                <div class="emp-wf-footer">
                    <button class="emp-wf-exec-btn" id="empWfExec" onclick="window.empWidget.executeWorkflow()">🚀 执行</button>
                    <div class="progress-bar"><div class="progress-fill" id="empWfProgressFill"></div></div>
                    <div class="progress-text" id="empWfProgressText">0 / 0</div>
                    <div class="info" id="empWfInfo">节点: 0 | 连接: 0</div>
                    <div class="info" id="empWfFileName" style="color:var(--orange);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
                    <div class="info" id="empWfZoom">100%</div>
                </div>
                <div class="emp-wf-panel-resize-l" data-presize="l"></div>
                <div class="emp-wf-panel-resize-r" data-presize="r"></div>
                <div class="emp-wf-panel-resize-t" data-presize="t"></div>
                <div class="emp-wf-panel-resize-b" data-presize="b"></div>
                <div class="emp-wf-panel-resize-bl" data-presize="bl"></div>
                <div class="emp-wf-panel-resize-br" data-presize="br"></div>
                <div class="emp-wf-panel-resize-tl" data-presize="tl"></div>
                <div class="emp-wf-panel-resize-tr" data-presize="tr"></div>
            </div>
        `;
        document.body.appendChild(wfOverlay);

        bindEvents();
        bindWfEvents();
        _bindScissorsEvents();
        refresh();
    }

    function bindEvents() {
        const bubble = document.getElementById('empBubble');

        // 左键和右键都激活面板
        bubble.addEventListener('click', function(e) {
            if (!dragData || !dragData.moved) togglePanel();
        });
        bubble.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            togglePanel();
        });

        // 气泡拖拽
        bubble.addEventListener('mousedown', function(e) {
            dragData = { x: e.clientX, y: e.clientY, moved: false, startX: bubble.offsetLeft, startY: bubble.offsetTop };
            bubble.classList.add('dragging');

            function onMove(ev) {
                if (!dragData) return;
                const dx = ev.clientX - dragData.x;
                const dy = ev.clientY - dragData.y;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragData.moved = true;
                if (dragData.moved) {
                    let nx = Math.max(0, Math.min(window.innerWidth - 48, dragData.startX + dx));
                    let ny = Math.max(0, Math.min(window.innerHeight - 48, dragData.startY + dy));
                    bubble.style.left = nx + 'px';
                    bubble.style.top = ny + 'px';
                    bubble.style.transform = 'none';
                    updatePanelPosition(nx, ny);
                }
            }
            function onUp() {
                bubble.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                // 保存位置
                localStorage.setItem('empBubblePos', JSON.stringify({x: bubble.offsetLeft, y: bubble.offsetTop}));
                setTimeout(function() { dragData = null; }, 50);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // 聊天框+面板拖拽（通过header拖拽）
        document.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            const isChatHeader = e.target.closest('#empChatHeader');
            const isPanelHeader = e.target.closest('.emp-panel-header');
            const dragHeader = isChatHeader || isPanelHeader;
            if (!dragHeader) return;
            const box = isChatHeader
                ? document.getElementById('empChatOverlay').querySelector('.emp-chat-box')
                : document.getElementById('empPanel');
            if (!box) return;
            const startX = e.clientX, startY = e.clientY;
            const boxRect = box.getBoundingClientRect();
            let moved = false;

            function onMove(ev) {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                if (moved) {
                    box.style.position = 'fixed';
                    box.style.left = Math.max(0, Math.min(window.innerWidth - boxRect.width, boxRect.left + dx)) + 'px';
                    box.style.top = Math.max(0, Math.min(window.innerHeight - boxRect.height, boxRect.top + dy)) + 'px';
                    box.style.transform = 'none';
                    box.style.margin = '0';
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                // 保存面板/聊天框位置
                if (isChatHeader) {
                    localStorage.setItem('empChatPos', JSON.stringify({x: parseInt(box.style.left), y: parseInt(box.style.top)}));
                } else {
                    localStorage.setItem('empPanelPos', JSON.stringify({x: parseInt(box.style.left), y: parseInt(box.style.top)}));
                }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        const input = document.getElementById('empChatInput');
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                window.empWidget.sendChat();
            }
        });
        input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });

        document.getElementById('empChatOverlay').addEventListener('click', function(e) {
            if (e.target === this) window.empWidget.closeChat();
        });
    }

    // 面板位置自动调整：气泡在右半屏时面板向左展开
    function updatePanelPosition(bubbleX, bubbleY) {
        const panel = document.getElementById('empPanel');
        const panelWidth = 240;
        const isRight = bubbleX > window.innerWidth / 2;
        if (isRight) {
            panel.style.right = 'auto';
            panel.style.left = (bubbleX - panelWidth - 8) + 'px';
        } else {
            panel.style.left = (bubbleX + 42) + 'px';
        }
        panel.style.top = Math.max(40, bubbleY) + 'px';
        panel.style.transform = 'none';
    }

    function togglePanel() {
        panelOpen = !panelOpen;
        const panel = document.getElementById('empPanel');
        const bubble = document.getElementById('empBubble');
        panel.classList.toggle('show', panelOpen);
        if (panelOpen) {
            // 恢复面板位置或使用默认位置
            const savedPanelPos = localStorage.getItem('empPanelPos');
            if (savedPanelPos) {
                try {
                    const pos = JSON.parse(savedPanelPos);
                    panel.style.left = pos.x + 'px';
                    panel.style.top = pos.y + 'px';
                    panel.style.right = 'auto';
                    panel.style.transform = 'none';
                } catch (e) {
                    // 默认位置已在CSS中设定
                }
            }
            // 恢复面板宽高
            const savedSize = localStorage.getItem('empPanelSize');
            if (savedSize) {
                try {
                    const size = JSON.parse(savedSize);
                    panel.style.width = size.w + 'px';
                    panel.style.height = size.h + 'px';
                } catch (e) {}
            }
            // 监听resize保存宽高
            if (!panel._resizeBound) {
                panel._resizeBound = true;
                const resizeObserver = new ResizeObserver(function() {
                    const rect = panel.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        localStorage.setItem('empPanelSize', JSON.stringify({w: rect.width, h: rect.height}));
                    }
                });
                resizeObserver.observe(panel);
            }
            // 无保存位置时CSS已设定 right:200px; top:15px
            refresh();
        }
    }

    // 面板打开时定时刷新
    let panelRefreshInterval = null;
    function startPanelRefresh() {
        if (panelRefreshInterval) return;
        panelRefreshInterval = setInterval(function() {
            if (panelOpen) refresh();
        }, 5000);
    }

    // ========== 拖拽分配 + 右键菜单 ==========
    let dragName = null;

    function bindDragDrop() {
        const list = document.getElementById('empList');
        list.addEventListener('dragstart', function(e) {
            const item = e.target.closest('.emp-draggable');
            if (!item) return;
            dragName = item.dataset.name;
            e.dataTransfer.effectAllowed = 'move';
            item.style.opacity = '0.4';
        });
        list.addEventListener('dragend', function(e) {
            const item = e.target.closest('.emp-draggable');
            if (item) item.style.opacity = '';
            dragName = null;
        });
        list.addEventListener('dragover', function(e) {
            const item = e.target.closest('.emp-draggable');
            if (item && dragName && item.dataset.name !== dragName) {
                e.preventDefault();
                item.style.background = 'rgba(0,122,204,0.15)';
            }
        });
        list.addEventListener('dragleave', function(e) {
            const item = e.target.closest('.emp-draggable');
            if (item) item.style.background = '';
        });
        list.addEventListener('drop', async function(e) {
            e.preventDefault();
            const item = e.target.closest('.emp-draggable');
            if (item) item.style.background = '';
            if (!item || !dragName) return;
            var _dragName = dragName;  // 本地快照，防止dragend清空
            if (_dragName === '🎯目标' || _dragName === '📋打印') return;
            const target = item.dataset.name;
            if (target === _dragName) return;
            // 检查是否已经是target的下属
            const treeResp = await fetch('/api/employee-tree');
            const treeData = await treeResp.json();
            const tree = treeData.data || treeData.数据 || [];
            let isSubordinate = false;
            function checkSub(node) {
                if (node.姓名 === target || node.name === target) {
                    (node.下属 || []).forEach(function(s) {
                        if ((s.姓名 || s.name) === _dragName) isSubordinate = true;
                    });
                }
                (node.下属 || []).forEach(checkSub);
            }
            tree.forEach(checkSub);
            if (isSubordinate) {
                // 已是下属 → 移除分配（脱离关系）
                await fetch('/api/employee-unassign', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({员工名: _dragName, 老板名: target})
                });
                showToast('已将「' + _dragName + '」从「' + target + '」名下移除', 'success');
            } else {
                // 不是下属 → 分配
                await fetch('/api/employee-assign', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({员工名: _dragName, 老板名: target})
                });
                showToast('已将「' + _dragName + '」分配给「' + target + '」', 'success');
            }
            await refresh();
        });
    }

    let contextMenuEl = null;
    function showContextMenu(e, name) {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        contextMenuEl = document.createElement('div');
        contextMenuEl.className = 'emp-context-menu';
        contextMenuEl.style.left = e.clientX + 'px';
        contextMenuEl.style.top = e.clientY + 'px';
        contextMenuEl.innerHTML =
            '<div onclick="window.empWidget.openChat(\'' + name + '\'); window.empWidget.closeContextMenu();">💬 对话</div>' +
            '<div onclick="window.empWidget.openEditPanel(\'' + name + '\')">✏️ 编辑资料</div>' +
            '<div onclick="window.empWidget.clearSuperiors(\'' + name + '\')">🔓 清除上级</div>' +
            '<div onclick="window.empWidget.clearSubordinates(\'' + name + '\')">🔓 清除下属</div>' +
            '<div onclick="window.empWidget.deleteEmployee(\'' + name + '\'); window.empWidget.closeContextMenu();">🗑️ 删除员工</div>';
        document.body.appendChild(contextMenuEl);
    }

    function closeContextMenu() {
        if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
    }

    async function setBossPrompt(name) {
        closeContextMenu();
        // 清除上级，设为顶层老板
        await fetch('/api/employee-update', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({姓名: name, 配置: {上级: []}})
        });
        refresh();
        showToast('「' + name + '」已设为老板（顶层）', 'success');
    }

    async function clearSuperiors(name) {
        closeContextMenu();
        await fetch('/api/employee-update', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({姓名: name, 配置: {上级: []}})
        });
        refresh();
        showToast('已清除「' + name + '」的上级关系', 'success');
    }

    async function clearSubordinates(name) {
        closeContextMenu();
        const resp = await fetch('/api/employee-list');
        const data = await resp.json();
        if (data.success || data.成功) {
            const all = data.data || data.数据 || [];
            for (const emp of all) {
                if (!(emp.isMother || emp.是母体) && (emp.name || emp.姓名) !== name) {
                    const superiors = emp.上级 || emp.superiors || [];
                    if (superiors && superiors.includes(name)) {
                        await fetch('/api/employee-unassign', {
                            method: 'POST', headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({员工名: emp.name || emp.姓名, 老板名: name})
                        });
                    }
                }
            }
        }
        refresh();
        showToast('已清除「' + name + '」的所有下属', 'success');
    }

    async function openEditPanel(name) {
        closeContextMenu();
        const emp = employees.find(function(e) { return (e.name || e.姓名) === name; });
        if (!emp) return;
        const 姓名 = emp.name || emp.姓名;
        const 头像 = emp.avatar || emp.头像 || '🙂';
        const 角色 = emp.role || emp.角色 || '';

        // 获取详细配置（人设追加等）
        let 人设追加 = '';
        let 工具调用 = false;
        try {
            const resp = await fetch('/api/employee-config?%E5%A7%93%E5%90%8D=' + encodeURIComponent(姓名));
            const jsonData = await resp.json();
            if (jsonData.成功 || jsonData.success) {
                const d = jsonData.数据 || jsonData.data || {};
                人设追加 = d.人设追加 || '';
                工具调用 = d.工具调用 || false;
            }
        } catch (e) {}

        // 创建编辑面板
        const overlay = document.createElement('div');
        overlay.className = 'emp-chat-overlay';
        overlay.id = 'empEditOverlay';
        overlay.innerHTML = `
            <div class="emp-chat-box" style="width:380px;height:360px">
                <div class="emp-chat-header">
                    <div class="emp-avatar">✏️</div>
                    <div><div class="emp-name">编辑员工</div><div class="emp-role">${姓名}</div></div>
                    <div class="emp-chat-actions">
                        <button class="emp-chat-btn" onclick="document.getElementById('empEditOverlay').remove()">✕</button>
                    </div>
                </div>
                <div class="emp-chat-body" style="padding:16px;gap:12px">
                    <input id="editAvatar" type="hidden" value="${头像}">
                    <div class="form-group">
                        <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">姓名</label>
                        <input id="editName" type="text" value="${姓名}" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:4px;font-size:13px">
                    </div>
                    <div class="form-group">
                        <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">描述</label>
                        <input id="editRole" type="text" value="${角色}" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:4px;font-size:13px">
                    </div>
                    <div class="form-group">
                        <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">AI生成的人设（点击按钮生成，只读）</label>
                        <div style="display:flex;gap:8px;align-items:flex-start">
                            <textarea id="editPersona" rows="4" readonly placeholder="点击右侧按钮生成..." style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text2);padding:6px 10px;border-radius:4px;font-size:13px;resize:vertical;font-family:inherit">${人设追加}</textarea>
                            <button id="editGenBtn" style="background:var(--bg3);border:1px solid var(--border);color:var(--blue);padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;flex-shrink:0;white-space:nowrap" onclick="window.empWidget.generatePersona('edit')">🤖 生成</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer">
                            <input type="checkbox" id="editToolCall" ${工具调用?'checked':''} style="width:16px;height:16px;cursor:pointer">
                            <span>🔧 工具调用 — 允许该员工使用文件、代码、生图等操作（高级员工）</span>
                        </label>
                    </div>
                </div>
                <div class="emp-chat-input" style="justify-content:flex-end;padding:10px 16px">
                    <button class="emp-chat-btn" style="background:var(--blue);color:#fff;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:13px" onclick="window.empWidget.saveEdit('${姓名}')">💾 保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.classList.add('show');
        overlay.addEventListener('click', function(e) {
            if (e.target === this) this.remove();
        });
    }

    async function saveEdit(originalName) {
        const overlay = document.getElementById('empEditOverlay');
        if (!overlay) return;
        const 姓名 = document.getElementById('editName').value.trim();
        const 头像 = document.getElementById('editAvatar').value.trim() || '🙂';
        const 描述 = document.getElementById('editRole').value.trim();
        const 工具调用 = document.getElementById('editToolCall')?.checked || false;
        const personaEl = document.getElementById('editPersona');
        if (!姓名) { alert('姓名不能为空'); return; }
        if (!描述) { alert('描述不能为空'); return; }

        // 如果人设还没生成，提示先生成
        let 人设追加 = personaEl.value.trim();
        if (!人设追加 || 人设追加 === '正在生成人设...') {
            alert('请先点击「生成人设」按钮');
            return;
        }

        await fetch('/api/employee-update', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({姓名: originalName, 配置: {姓名, 头像, 角色: 描述, 目标: 描述, 人设追加, 工具调用, 状态: '在岗'}})
        });
        overlay.remove();
        refresh();
        showToast('已保存「' + 姓名 + '」的修改', 'success');
    }

    function openCreatePanel() {
        const overlay = document.createElement('div');
        overlay.className = 'emp-chat-overlay';
        overlay.id = 'empCreateOverlay';
        overlay.innerHTML = `
            <div class="emp-chat-box" style="width:380px;height:380px">
                <div class="emp-chat-header">
                    <div class="emp-avatar">➕</div>
                    <div><div class="emp-name">创建新员工</div><div class="emp-role">填写信息后AI自动生成人设和头像</div></div>
                    <div class="emp-chat-actions">
                        <button class="emp-chat-btn" onclick="document.getElementById('empCreateOverlay').remove()">✕</button>
                    </div>
                </div>
                <div class="emp-chat-body" style="padding:16px;gap:12px">
                    <div class="form-group">
                        <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">姓名 *</label>
                        <input id="createName" type="text" placeholder="如：小张" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:4px;font-size:13px">
                    </div>
                    <div class="form-group">
                        <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">描述 *</label>
                        <input id="createRole" type="text" placeholder="如：程序员 / 设计师 / 数据分析师" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:4px;font-size:13px">
                    </div>
                    <div class="form-group">
                        <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">AI生成的人设（点击按钮生成，只读）</label>
                        <div style="display:flex;gap:8px;align-items:flex-start">
                            <textarea id="createPersona" rows="4" readonly placeholder="点击右侧按钮生成..." style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text2);padding:6px 10px;border-radius:4px;font-size:13px;resize:vertical;font-family:inherit"></textarea>
                            <button id="createGenBtn" style="background:var(--bg3);border:1px solid var(--border);color:var(--blue);padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;flex-shrink:0;white-space:nowrap" onclick="window.empWidget.generatePersona('create')">🤖 生成</button>
                        </div>
                    </div>
                </div>
                <div class="emp-chat-input" style="justify-content:flex-end;padding:10px 16px">
                    <button class="emp-chat-btn" style="background:var(--blue);color:#fff;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:13px" onclick="window.empWidget.saveCreate()">➕ 创建</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.classList.add('show');
        overlay.addEventListener('click', function(e) {
            if (e.target === this) this.remove();
        });
        setTimeout(function() { document.getElementById('createName').focus(); }, 100);
    }

    async function generatePersona(mode) {
        const prefix = mode === 'edit' ? 'edit' : 'create';
        const nameEl = document.getElementById(prefix + 'Name');
        const roleEl = document.getElementById(prefix + 'Role');
        const personaEl = document.getElementById(prefix + 'Persona');
        const btn = document.getElementById(prefix + 'GenBtn');
        const 姓名 = nameEl.value.trim();
        const 描述 = roleEl.value.trim();
        if (!姓名) { alert('请先填写姓名'); return; }
        if (!描述) { alert('请先填写描述'); return; }

        personaEl.value = '正在生成...';
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
        try {
            const resp = await fetch('/api/employee-generate-persona', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({姓名: 姓名, 角色: 描述})
            });
            const data = await resp.json();
            if (data.成功 || data.success) {
                personaEl.value = (data.数据 || data.data || '').trim();
                // AI随机选头像
                var avatars = ['👨‍💻','👩‍💻','📝','🎨','🔬','📊','📷','🎵','🛠️','⚙️','📋','🧮','💡','🔧','🚀','🏆','🤖','🧑‍💼','👩‍💼','👨‍🔧','🧑‍🎨','🧑‍🔬','🧑‍🏫','🧑‍🌾'];
                var randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];
                var avatarInput = document.getElementById(prefix + 'Avatar');
                if (avatarInput) avatarInput.value = randomAvatar;
                var avatarDisplay = document.getElementById(prefix + 'AvatarDisplay');
                if (avatarDisplay) avatarDisplay.textContent = randomAvatar;
            } else {
                personaEl.value = '生成失败：' + (data.错误 || data.error || '');
            }
        } catch (e) {
            personaEl.value = '生成失败：' + e.message;
        }
        if (btn) { btn.disabled = false; btn.textContent = '🤖 生成'; }
    }

    async function saveCreate() {
        const overlay = document.getElementById('empCreateOverlay');
        if (!overlay) return;
        const 姓名 = document.getElementById('createName').value.trim();
        var 头像 = document.getElementById('createAvatar')?.value || '';
        if (!头像) {
            var avatars = ['👨‍💻','👩‍💻','📝','🎨','🔬','📊','📷','🎵','🛠️','⚙️','📋','🧮','💡','🔧','🚀','🏆','🤖','🧑‍💼','👩‍💼','👨‍🔧','🧑‍🎨','🧑‍🔬','🧑‍🏫','🧑‍🌾'];
            头像 = avatars[Math.floor(Math.random() * avatars.length)];
        }
        const 描述 = document.getElementById('createRole').value.trim();
        const personaEl = document.getElementById('createPersona');
        if (!姓名) { alert('姓名不能为空'); return; }
        if (!描述) { alert('请填写描述'); return; }

        let 人设追加 = personaEl.value.trim();
        if (!人设追加 || 人设追加 === '正在生成人设...') {
            alert('请先点击「生成」按钮生成人设');
            return;
        }

        const resp = await fetch('/api/employee-create', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({配置: {姓名, 头像, 角色: 描述, 目标: 描述, 人设追加, 独立记忆: true, 状态: '在岗'}})
        });
        const data = await resp.json();
        if (data.成功 || data.success) {
            overlay.remove();
            refresh();
            showToast('已创建「' + 姓名 + '」', 'success');
        } else {
            alert('创建失败：' + (data.错误 || data.error || '未知错误'));
        }
    }

    async function refresh() {
        try {
            if (empCategories.length === 0) loadCategories();
            const resp = await fetch('/api/employee-list');
            const data = await resp.json();
            if (data.success || data.成功) {
                employees = data.data || data.数据 || [];
                const online = employees.filter(function(e) {
                    return (e.status || e.状态) === '在岗' && !(e.isMother || e.是母体);
                }).length;
                const badge = document.getElementById('empBadge');
                badge.textContent = online;
                badge.style.display = online > 0 ? 'flex' : 'none';
            }
            // 获取树形结构
            const treeResp = await fetch('/api/employee-tree');
            const treeData = await treeResp.json();
            if (treeData.success || treeData.成功) {
                lastTreeData = treeData.data || treeData.数据 || [];
                renderTree(lastTreeData);
            }
        } catch (e) {
            console.error('员工列表刷新失败:', e);
        }
    }

    function renderTree(tree) {
        const list = document.getElementById('empList');
        let html = '';
        // 收集所有员工名
        const allNames = {};
        const collectNames = function(node) {
            allNames[node.姓名 || node.name] = true;
            (node.下属 || []).forEach(collectNames);
        };
        tree.forEach(collectNames);
        // 自由人
        const freeEmps = employees.filter(function(e) {
            return !(e.isMother || e.是母体) && !allNames[(e.name || e.姓名)];
        });
        freeEmps.forEach(function(e) { allNames[e.name || e.姓名] = true; });

        // 找出已分类的员工
        const categorizedNames = {};
        empCategories.forEach(function(cat) {
            (cat.employeeNames || []).forEach(function(n) { categorizedNames[n] = cat.id; });
        });

        // 渲染分类
        empCategories.forEach(function(cat) {
            const collapsed = cat.collapsed;
            const catColor = cat.color || '#007ACC';
            html += '<div class="emp-category" data-cat-id="' + cat.id + '">' +
                '<div class="emp-category-header" style="border-left:3px solid ' + catColor + '">' +
                    '<span class="emp-cat-drag" draggable="true" data-cat-drag="' + cat.id + '" title="拖拽排序">⠿</span>' +
                    '<span class="emp-category-toggle" onclick="event.stopPropagation();window.empWidget._toggleCategory(\'' + cat.id + '\')" style="color:' + catColor + '">' + (collapsed ? '▶' : '▼') + '</span>' +
                    '<span class="emp-category-name-text" style="color:' + catColor + '">' + escapeHtml(cat.name) + '</span>' +
                    '<button class="emp-cat-rename-btn" onclick="event.stopPropagation();window.empWidget._renameCategory(\'' + cat.id + '\')" title="重命名">✏️</button>' +
                    '<span class="emp-cat-color-dot" data-cat-color="' + cat.id + '" style="background:' + catColor + '" onclick="event.stopPropagation();window.empWidget._cycleCategoryColor(\'' + cat.id + '\')"></span>' +
                    '<button class="emp-category-del" draggable="false" onmousedown="event.stopPropagation()" onclick="event.stopPropagation();window.empWidget._deleteCategory(\'' + cat.id + '\')">✕</button>' +
                '</div>';
            if (!collapsed) {
                html += '<div class="emp-category-body" data-cat-drop="' + cat.id + '" style="border-left:2px solid ' + catColor + '40">';
                (cat.employeeNames || []).forEach(function(name) {
                    const emp = employees.find(function(e) { return (e.name || e.姓名) === name; });
                    if (!emp) return;
                    html += _renderEmpItem(emp, name, false);
                });
                if (!cat.employeeNames || cat.employeeNames.length === 0) {
                    html += '<div class="emp-category-empty">拖入员工到此处</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        });

        // 分隔线（如果有分类）
        if (empCategories.length > 0) html += '<div class="emp-list-divider"></div>';

        // 未分类的自由人 — 树状结构渲染
        const uncategorized = employees.filter(function(e) {
            if (e.isMother || e.是母体) return false;
            const name = e.name || e.姓名;
            return !categorizedNames[name];
        });
        // 构建上级→下属映射
        const 下属映射 = {};
        employees.forEach(function(e) {
            if (e.isMother || e.是母体) return;
            const 上级 = e.上级 || e.superiors || [];
            上级.forEach(function(boss) {
                if (!下属映射[boss]) 下属映射[boss] = [];
                下属映射[boss].push(e);
            });
        });
        // 找出未分类且没有上级的（顶层）
        const 顶层 = uncategorized.filter(function(e) {
            const 上级 = e.上级 || e.superiors || [];
            return 上级.length === 0;
        });
        function renderEmpTree(emp, depth) {
            const name = emp.name || emp.姓名;
            let h = '<div class="emp-tree-node" style="padding-left:' + (8 + depth * 16) + 'px">';
            h += _renderEmpItem(emp, name, false, true);
            h += '</div>';
            // 递归渲染下属
            const subs = 下属映射[name] || [];
            subs.forEach(function(sub) {
                h += renderEmpTree(sub, depth + 1);
            });
            return h;
        }
        顶层.forEach(function(emp) { html += renderEmpTree(emp, 0); });

        // 添加分类按钮
        html += '<div class="emp-list-divider"></div>';
        html += '<button class="emp-category-add" onclick="window.empWidget._addCategory()">+ 新建分类</button>';

        list.innerHTML = html;

        // 绑定分类拖放
        bindCategoryDnd();
    }

    function _renderEmpItem(emp, name, isFixed, isTree) {
        const avatar = emp.avatar || emp.头像 || '🙂';
        const role = emp.role || emp.角色 || '';
        const status = emp.status || emp.状态 || '在岗';
        const dotCls = status === '在岗' ? 'online' : 'offline';
        const cls = 'emp-item emp-draggable' + (name === currentEmployee ? ' active' : '');
        var actions = '';
        if (!isFixed) {
            actions = '<div class="emp-item-actions">' +
                '<button class="emp-item-btn" onclick="event.stopPropagation();window.empWidget.openEditPanel(\'' + name + '\')" title="编辑">⚙️</button>' +
                '<button class="emp-item-btn danger" onclick="event.stopPropagation();window.empWidget.deleteEmployee(\'' + name + '\')" title="删除">🗑️</button>' +
            '</div>';
        }
        return '<div class="' + cls + '" draggable="true" data-name="' + name + '" ' +
            'onclick="window.empWidget.selectEmployee(\'' + name + '\')" ' +
            'oncontextmenu="window.empWidget.showContextMenu(event,\'' + name + '\'); return false;">' +
            '<div class="emp-avatar">' + avatar + '</div>' +
            '<div class="emp-info"><div class="emp-name">' + name + '</div><div class="emp-role">' + role + '</div></div>' +
            actions +
            '<div class="emp-status-dot ' + dotCls + '"></div></div>';
    }

    function bindCategoryDnd() {
        const list = document.getElementById('empList');
        if (!list) return;
        // 分类体作为drop目标
        list.querySelectorAll('[data-cat-drop]').forEach(function(zone) {
            zone.addEventListener('dragover', function(e) {
                if (!dragName) return;
                e.preventDefault();
                zone.classList.add('cat-drop-over');
            });
            zone.addEventListener('dragleave', function() { zone.classList.remove('cat-drop-over'); });
            zone.addEventListener('drop', function(e) {
                e.preventDefault();
                zone.classList.remove('cat-drop-over');
                if (!dragName || dragName === '🎯目标' || dragName === '📋打印') return;
                const catId = zone.dataset.catDrop;
                const cat = empCategories.find(function(c) { return c.id == catId; });
                if (!cat) return;
                if (!cat.employeeNames) cat.employeeNames = [];
                // 从其他分类移除
                empCategories.forEach(function(c) {
                    if (c.id != catId) c.employeeNames = (c.employeeNames || []).filter(function(n) { return n !== dragName; });
                });
                if (!cat.employeeNames.includes(dragName)) cat.employeeNames.push(dragName);
                saveCategories();
                renderTree(getTreeData());
            });
        });
        // 分类header拖拽排序
        let catDragId = null;
        list.querySelectorAll('[data-cat-drag]').forEach(function(el) {
            el.addEventListener('dragstart', function(e) { catDragId = el.dataset.catDrag; el.style.opacity = '0.4'; });
            el.addEventListener('dragend', function() { el.style.opacity = ''; _clearCatDropIndicator(); });
            el.addEventListener('dragover', function(e) {
                if (!catDragId) return;
                e.preventDefault();
                var catEl = el.closest('.emp-category');
                if (catEl) {
                    _clearCatDropIndicator();
                    var rect = catEl.getBoundingClientRect();
                    var midY = rect.top + rect.height / 2;
                    catEl.classList.add('cat-drop-indicator');
                    if (e.clientY > midY) catEl.classList.add('after'); else catEl.classList.remove('after');
                }
            });
            el.addEventListener('dragleave', function() {
                var catEl = el.closest('.emp-category');
                if (catEl) catEl.classList.remove('cat-drop-indicator');
            });
            el.addEventListener('drop', function(e) {
                e.preventDefault();
                e.stopPropagation();
                _clearCatDropIndicator();
                if (!catDragId) return;
                const targetId = el.dataset.catDrag;
                if (catDragId === targetId) return;
                const fromIdx = empCategories.findIndex(function(c) { return c.id == catDragId; });
                const toIdx = empCategories.findIndex(function(c) { return c.id == targetId; });
                if (fromIdx < 0 || toIdx < 0) return;
                const moved = empCategories.splice(fromIdx, 1)[0];
                empCategories.splice(toIdx, 0, moved);
                saveCategories();
                renderTree(getTreeData());
            });
        });
    }
    function _clearCatDropIndicator() {
        document.querySelectorAll('.cat-drop-indicator').forEach(function(el) { el.classList.remove('cat-drop-indicator'); });
    }

    function getTreeData() {
        // 返回空树触发自由人渲染
        try {
            const treeResp = fetch('/api/employee-tree');
            // 同步返回最近一次的树
        } catch(e) {}
        return lastTreeData || [];
    }
    let lastTreeData = [];

    function _addCategory() {
        const colors = ['#007ACC','#4EC9B0','#CE9178','#DCDCAA','#9CDCFE','#C586C0','#F44747','#61AFEF','#E06C75','#98C379','#D19A66','#56B6C2'];
        const color = colors[empCategories.length % colors.length];
        const cat = {id: 'cat_' + (++empCatId), name: '新分类', collapsed: false, employeeNames: [], color: color};
        empCategories.push(cat);
        saveCategories();
        renderTree(lastTreeData);
    }
    function _deleteCategory(id) {
        const cat = empCategories.find(function(c) { return c.id == id; });
        if (cat && cat.employeeNames && cat.employeeNames.length > 0) {
            showToast('分类「' + cat.name + '」内有' + cat.employeeNames.length + '个员工，请先移出', 'error');
            return;
        }
        empCategories = empCategories.filter(function(c) { return c.id != id; });
        saveCategories();
        renderTree(lastTreeData);
    }
    function _renameCategory(id) {
        const cat = empCategories.find(function(c) { return c.id == id; });
        if (!cat) return;
        const overlay = document.createElement('div');
        overlay.className = 'emp-chat-overlay';
        overlay.style.zIndex = '9800';
        overlay.innerHTML = '<div class="emp-chat-box" style="width:320px;height:180px">' +
            '<div class="emp-chat-header"><div class="emp-avatar">✏️</div>' +
            '<div><div class="emp-name">重命名分类</div></div>' +
            '<div class="emp-chat-actions"><button class="emp-chat-btn" onclick="this.closest(\'.emp-chat-overlay\').remove()">✕</button></div></div>' +
            '<div class="emp-chat-body" style="padding:16px"><input id="catRenameInput" type="text" value="' + escapeHtml(cat.name) + '" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:4px;font-size:14px"></div>' +
            '<div class="emp-chat-input" style="justify-content:flex-end;padding:10px 16px">' +
            '<button class="emp-chat-btn" style="background:var(--blue);color:#fff;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:13px" onclick="window.empWidget._confirmRenameCategory(\'' + id + '\')">确定</button></div></div>';
        document.body.appendChild(overlay);
        overlay.classList.add('show');
        overlay.addEventListener('click', function(e) { if (e.target === this) this.remove(); });
        setTimeout(function() { var inp = document.getElementById('catRenameInput'); if (inp) { inp.focus(); inp.select(); inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') window.empWidget._confirmRenameCategory(id); }); } }, 100);
    }
    function _confirmRenameCategory(id) {
        const inp = document.getElementById('catRenameInput');
        if (!inp) return;
        const newName = inp.value.trim();
        if (!newName) return;
        const cat = empCategories.find(function(c) { return c.id == id; });
        if (cat) { cat.name = newName; saveCategories(); renderTree(lastTreeData); }
        const ov = inp.closest('.emp-chat-overlay');
        if (ov) ov.remove();
    }
    var _catColorPalette = ['#007ACC','#4EC9B0','#CE9178','#DCDCAA','#9CDCFE','#C586C0','#F44747','#61AFEF','#E06C75','#98C379','#D19A66','#56B6C2'];
    function _cycleCategoryColor(id) {
        const cat = empCategories.find(function(c) { return c.id == id; });
        if (!cat) return;
        var idx = _catColorPalette.indexOf(cat.color || '#007ACC');
        idx = (idx + 1) % _catColorPalette.length;
        cat.color = _catColorPalette[idx];
        saveCategories();
        renderTree(lastTreeData);
    }
    function _toggleCategory(id) {
        const cat = empCategories.find(function(c) { return c.id == id; });
        if (cat) { cat.collapsed = !cat.collapsed; saveCategories(); renderTree(lastTreeData); }
    }
    function _updateCategoryName(id, name) {
        const cat = empCategories.find(function(c) { return c.id == id; });
        if (cat) { cat.name = name; saveCategories(); }
    }
    function _updateCategoryColor(id, color) {
        const cat = empCategories.find(function(c) { return c.id == id; });
        if (cat) {
            cat.color = color; saveCategories();
            // 直接更新DOM样式，不重新渲染（避免拖拽色条时闪烁）
            var catEl = document.querySelector('[data-cat-id="' + id + '"]');
            if (catEl) catEl.style.borderLeftColor = color;
            var header = document.querySelector('[data-cat-drag="' + id + '"]')?.closest('.emp-category-header');
            if (header) {
                header.style.borderLeftColor = color;
                var nameInput = header.querySelector('.emp-category-name');
                if (nameInput) nameInput.style.color = color;
                var toggle = header.querySelector('.emp-category-toggle');
                if (toggle) toggle.style.color = color;
            }
            var body = document.querySelector('[data-cat-drop="' + id + '"]');
            if (body) body.style.borderLeftColor = color + '40';
            // 更新色条指示器位置
            var indicator = document.querySelector('.emp-category-colorbar[data-cat-color="' + id + '"] .emp-colorbar-indicator');
            if (indicator) indicator.style.left = hslToPercent(color) + '%';
        }
    }
    function saveCategories() {
        try { localStorage.setItem('empCategories', JSON.stringify(empCategories)); } catch(e) {}
    }
    function loadCategories() {
        try {
            const saved = localStorage.getItem('empCategories');
            if (saved) {
                empCategories = JSON.parse(saved);
                empCatId = Math.max(empCatId, ...empCategories.map(function(c) {
                    const m = (c.id || '').match(/cat_(\d+)/);
                    return m ? parseInt(m[1]) : 0;
                }), 0);
            }
        } catch(e) {}
    }

    function renderTreeNode(node, depth) {
        const name = node.姓名 || node.name || '';
        const avatar = node.头像 || node.avatar || '🙂';
        const role = node.角色 || node.role || '';
        const status = node.状态 || node.status || '在岗';
        const subordinates = node.下属 || [];
        const dotCls = status === '在岗' ? 'online' : 'offline';
        const cls = 'emp-item' + (name === currentEmployee ? ' active' : '');
        const indent = depth * 20;
        const isBoss = subordinates.length > 0;
        let html = '<div class="' + cls + ' emp-draggable" draggable="true" ' +
            'data-name="' + name + '" ' +
            'style="padding-left:' + (10 + indent) + 'px" ' +
            'onclick="window.empWidget.selectEmployee(\'' + name + '\')" ' +
            'oncontextmenu="window.empWidget.showContextMenu(event,\'' + name + '\'); return false;">' +
            '<div class="emp-avatar">' + avatar + '</div>' +
            '<div class="emp-info"><div class="emp-name">' + name + (isBoss ? ' <span style="font-size:10px;color:var(--blue)">(' + subordinates.length + '人)</span>' : '') + '</div>' +
            '<div class="emp-role">' + role + '</div></div>' +
            '<div class="emp-status-dot ' + dotCls + '"></div></div>';
        subordinates.forEach(function(sub) {
            html += renderTreeNode(sub, depth + 1);
        });
        return html;
    }

    async function selectEmployee(name) {
        currentEmployee = name;
        当前员工名 = name || '母体';
        refresh();
        try {
            await fetch('/api/employee-switch', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({姓名: name})
            });
        } catch (e) {}
        openChat(name);
    }

    async function openChat(name) {
        chatTarget = name;
        chatOpen = true;
        const emp = employees.find(function(e) { return (e.name || e.姓名) === name; });
        if (!emp && name) return;

        const avatar = emp ? (emp.avatar || emp.头像 || '🙂') : '➕';
        const role = emp ? (emp.role || emp.角色 || '') : '描述你想要的员工';
        const displayName = emp ? name : '创建新员工';
        const isMother = emp ? (emp.isMother || emp.是母体) : false;
        const header = document.getElementById('empChatHeader');
        header.style.cursor = 'move';
        let actionsHtml = '';
        if (!isMother && emp) {
            actionsHtml = '<button class="emp-chat-btn" onclick="window.empWidget.editEmployee(\'' + name + '\')" title="修改">⚙️</button>' +
                          '<button class="emp-chat-btn" onclick="window.empWidget.clearChat(\'' + name + '\')" title="清除聊天记录">🧹</button>' +
                          '<button class="emp-chat-btn danger" onclick="window.empWidget.deleteEmployee(\'' + name + '\')" title="删除员工">🗑️</button>';
        }
        header.innerHTML =
            '<div class="emp-avatar">' + avatar + '</div>' +
            '<div><div class="emp-name">' + displayName + '</div><div class="emp-role">' + role + '</div></div>' +
            '<div class="emp-chat-actions">' + actionsHtml +
            '<button class="emp-chat-btn" onclick="window.empWidget.closeChat()" title="关闭">✕</button></div>';

        // 恢复聊天框位置或居中
        const box = document.getElementById('empChatOverlay').querySelector('.emp-chat-box');
        const savedChatPos = localStorage.getItem('empChatPos');
        if (savedChatPos) {
            try {
                const pos = JSON.parse(savedChatPos);
                box.style.position = 'fixed';
                box.style.left = pos.x + 'px';
                box.style.top = pos.y + 'px';
                box.style.transform = 'none';
                box.style.margin = '0';
            } catch (e) {
                box.style.position = '';
                box.style.left = '';
                box.style.top = '';
                box.style.transform = '';
                box.style.margin = '';
            }
        } else {
            box.style.position = '';
            box.style.left = '';
            box.style.top = '';
            box.style.transform = '';
            box.style.margin = '';
        }

        const body = document.getElementById('empChatBody');
        if (emp) {
            // 从后端加载对话历史
            try {
                const resp = await fetch('/api/employee-history?姓名=' + encodeURIComponent(name));
                const data = await resp.json();
                if ((data.success || data.成功) && (data.data || data.数据)) {
                    const messages = data.data || data.数据;
                    chatHistory[name] = [];
                    for (const m of messages) {
                        const role = m.role || m.角色 || 'user';
                        const content = m.content || m.内容 || '';
                        if (content) {
                            chatHistory[name].push({role: role === 'assistant' ? 'assistant' : 'user', content: content});
                        }
                    }
                }
            } catch (e) {}
            // 统一渲染（带删除按钮）
            renderChatBody(name);
        } else {
            body.innerHTML = '<div class="emp-chat-msg system">描述你想创建的员工，比如："创建一个会做数据分析的员工，叫小张"</div>';
        }
        document.getElementById('empChatOverlay').classList.add('show');

        const input = document.getElementById('empChatInput');
        input.value = '';
        input.placeholder = emp ? '输入消息...' : '描述你想要的员工...';
        setTimeout(function() { input.focus(); }, 100);
    }

    function closeChat() {
        chatOpen = false;
        document.getElementById('empChatOverlay').classList.remove('show');
    }

    async function sendChat() {
        const input = document.getElementById('empChatInput');
        const msg = input.value.trim();
        console.log('[empWidget] sendChat called, msg=' + msg + ', sending=' + chatSending);
        if (!msg || chatSending) return;

        chatSending = true;
        document.getElementById('empChatSend').disabled = true;
        input.value = '';
        input.style.height = 'auto';

        const body = document.getElementById('empChatBody');
        if (body.querySelector('.emp-chat-empty')) body.querySelector('.emp-chat-empty').remove();
        if (body.querySelector('.emp-chat-msg.system') && body.children.length === 1) body.querySelector('.emp-chat-msg.system').remove();
        const userMsg = document.createElement('div');
        userMsg.className = 'emp-chat-msg user';
        userMsg.innerHTML = formatMessage(msg);
        body.appendChild(userMsg);
        // 保存到前端历史
        if (!chatHistory[chatTarget]) chatHistory[chatTarget] = [];
        chatHistory[chatTarget].push({role: 'user', content: msg});
        const loadingEl = document.createElement('div');
        loadingEl.className = 'emp-chat-loading';
        loadingEl.id = 'empChatLoading';
        loadingEl.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
        body.appendChild(loadingEl);
        body.scrollTop = body.scrollHeight;

        try {
            // 获取工作目录
            let wd = '';
            try { wd = currentRoot || ''; } catch(e) {}
            console.log('[empWidget] fetching /api/employee-chat, target=' + chatTarget);
            const resp = await fetch('/api/employee-chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    消息: msg,
                    姓名: chatTarget,
                    当前文件夹: wd
                })
            });
            console.log('[empWidget] response status=' + resp.status);

            // 用reader逐块读取，遇到"完成"就停
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let replyText = '';
            let buffer = '';

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;
                    try {
                        const d = JSON.parse(trimmed.substring(6));
                        const type = d.类型 || d.type;
                        if (type === '完成' || type === 'complete') {
                            const r = d.result || d.结果 || {};
                            replyText = r.reply || r.回复 || '';
                            // 收到完成，主动中断reader
                            reader.cancel();
                            break;
                        }
                    } catch (e) {}
                }
                if (replyText) break;
            }
            reader.cancel();

            const loading = document.getElementById('empChatLoading');
            if (loading) loading.remove();

            if (replyText) {
                const replyEl = document.createElement('div');
                replyEl.className = 'emp-chat-msg assistant';
                // Markdown渲染
                if (typeof marked !== 'undefined') {
                    replyEl.innerHTML = formatMessage(replyText);
                } else {
                    replyEl.textContent = replyText;
                }
                body.appendChild(replyEl);
                // 语音播报
                if (typeof speakText === 'function') {
                    speakText(replyText);
                }
                // 保存到前端历史
                if (chatTarget) {
                    if (!chatHistory[chatTarget]) chatHistory[chatTarget] = [];
                    chatHistory[chatTarget].push({role: 'assistant', content: replyText});
                    // 重新渲染整个聊天区（带删除按钮）
                    renderChatBody(chatTarget);
                }
            } else {
                const sysEl = document.createElement('div');
                sysEl.className = 'emp-chat-msg system';
                sysEl.textContent = '未收到回复';
                body.appendChild(sysEl);
            }
        } catch (e) {
            console.error('[empWidget] sendChat error:', e);
            const loading = document.getElementById('empChatLoading');
            if (loading) loading.remove();
            const errEl = document.createElement('div');
            errEl.className = 'emp-chat-msg system';
            errEl.textContent = '连接失败: ' + e.message;
            body.appendChild(errEl);
        }

        body.scrollTop = body.scrollHeight;
        chatSending = false;
        document.getElementById('empChatSend').disabled = false;
        document.getElementById('empChatInput').focus();
    }

    function addEmployee() {
        chatTarget = null;
        openChat(null);
    }

    function editEmployee(name) {
        closeChat();
        const mainInput = document.getElementById('chatInput');
        if (mainInput) {
            mainInput.value = '修改员工「' + name + '」的配置，先告诉我他现在的详情';
            mainInput.focus();
            showToast('已在主对话框输入，按回车发送');
        } else {
            openChat(null);
            const input = document.getElementById('empChatInput');
            input.value = '修改员工「' + name + '」的配置';
            input.focus();
        }
    }

    async function deleteEmployee(name) {
        if (!confirm('确认删除员工「' + name + '」？')) return;
        try {
            await fetch('/api/employee-delete', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({姓名: name})
            });
            closeChat();
            refresh();
            showToast('已删除「' + name + '」', 'success');
        } catch (e) {
            showToast('删除失败', 'error');
        }
    }

    async function clearChat(name) {
        if (!confirm('确认清除与「' + name + '」的所有聊天记录？\n（不影响员工的技能和经验）')) return;
        try {
            await fetch('/api/employee-clear-history', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({姓名: name})
            });
            // 清空前端缓存
            chatHistory[name] = [];
            // 清空显示
            const body = document.getElementById('empChatBody');
            body.innerHTML = '<div class="emp-chat-empty">聊天记录已清除</div>';
            showToast('已清除聊天记录', 'success');
        } catch (e) {
            showToast('清除失败', 'error');
        }
    }

    function deleteMessage(name, index) {
        // 删除单条消息（前后配对：用户+助手）
        if (!chatHistory[name]) return;
        // 找到这条消息的索引
        const msg = chatHistory[name][index];
        if (!msg) return;
        // 如果是user消息，连同下一条assistant一起删
        if (msg.role === 'user' && chatHistory[name][index + 1] && chatHistory[name][index + 1].role === 'assistant') {
            chatHistory[name].splice(index, 2);
        } else {
            chatHistory[name].splice(index, 1);
        }
        // 同步到后端
        fetch('/api/employee-save-history', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({姓名: name, 历史: chatHistory[name]})
        }).catch(function() {});
        // 重新渲染
        renderChatBody(name);
    }

    function renderChatBody(name) {
        const body = document.getElementById('empChatBody');
        const history = chatHistory[name] || [];
        if (history.length === 0) {
            body.innerHTML = '<div class="emp-chat-empty">与「' + name + '」对话</div>';
            return;
        }
        body.innerHTML = '';
        for (let i = 0; i < history.length; i++) {
            const m = history[i];
            const el = document.createElement('div');
            el.className = 'emp-chat-msg ' + m.role;
            el.innerHTML = formatMessage(m.content);
            const delBtn = document.createElement('button');
            delBtn.className = 'msg-del';
            delBtn.textContent = '✕';
            delBtn.title = '删除此条';
            delBtn.onclick = function() { deleteMessage(name, i); };
            el.appendChild(delBtn);
            body.appendChild(el);
        }
        body.scrollTop = body.scrollHeight;
    }

    function formatMessage(content) {
        if (!content) return '';
        // 先转义HTML
        const div = document.createElement('div');
        div.textContent = content;
        let html = div.innerHTML;
        // @提及高亮
        html = html.replace(/@([^\s@，。、！？\n]+)/g, function(match, name) {
            return '<span class="emp-mention" onclick="window.empWidget.openChat(\'' + name + '\')">@' + name + '</span>';
        });
        // Markdown渲染（assistant消息）
        if (typeof marked !== 'undefined' && (content.includes('**') || content.includes('#') || content.includes('\n-') || content.includes('```'))) {
            // 先恢复@标记，再渲染markdown
            const mentionPlaceholder = '\x00MENTION\x00';
            let mentions = [];
            html = html.replace(/<span class="emp-mention"[^>]*>[^<]*<\/span>/g, function(m) {
                mentions.push(m);
                return mentionPlaceholder + (mentions.length - 1) + '\x00';
            });
            html = marked.parse(div.textContent.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));
            // 注意：marked会转义，所以重新处理
            html = marked.parse(content);
            // 恢复@标记
            html = html.replace(new RegExp(mentionPlaceholder + '(\\d+)\x00', 'g'), function(m, idx) {
                return mentions[parseInt(idx)];
            });
        }
        return html;
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function hexToHsl(hex) {
        var r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
        var max = Math.max(r,g,b), min = Math.min(r,g,b), h=0, s=0, l=(max+min)/2;
        if (max!==min) {
            var d = max-min;
            s = l>0.5 ? d/(2-max-min) : d/(max+min);
            switch(max) {
                case r: h = (g-b)/d + (g<b?6:0); break;
                case g: h = (b-r)/d + 2; break;
                case b: h = (r-g)/d + 4; break;
            }
            h *= 60;
        }
        return {h:h, s:s*100, l:l*100};
    }

    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        var c = (1 - Math.abs(2*l - 1)) * s;
        var x = c * (1 - Math.abs((h/60) % 2 - 1));
        var m = l - c/2;
        var r,g,b;
        if (h < 60) { r=c; g=x; b=0; } else if (h < 120) { r=x; g=c; b=0; }
        else if (h < 180) { r=0; g=c; b=x; } else if (h < 240) { r=0; g=x; b=c; }
        else if (h < 300) { r=x; g=0; b=c; } else { r=c; g=0; b=x; }
        var toHex = function(v) { return Math.round((v+m)*255).toString(16).padStart(2,'0'); };
        return '#' + toHex(r) + toHex(g) + toHex(b);
    }

    function hslToPercent(hex) {
        var hsl = hexToHsl(hex);
        return (hsl.h / 360) * 100;
    }

    function showToast(msg, type) {
        const t = document.createElement('div');
        t.className = 'toast ' + (type || 'info');
        t.innerHTML = '<span class="toast-msg">' + msg + '</span>';
        const container = document.getElementById('toastContainer') || document.body;
        container.appendChild(t);
        setTimeout(function() { t.remove(); }, 3000);
    }

    // ========== 定时提醒 ==========
    let notifyInterval = null;

    function startNotifyPolling() {
        if (notifyInterval) return;
        notifyInterval = setInterval(async function() {
            try {
                const resp = await fetch('/api/employee-notify');
                const data = await resp.json();
                if (data.success || data.成功) {
                    const items = data.data || data.数据 || [];
                    for (const item of items) {
                        showNotify(item);
                    }
                }
            } catch (e) {}
        }, 30000);
    }

    function showNotify(item) {
        const name = item.姓名 || item.name || '员工';
        const avatar = item.头像 || item.avatar || '🙂';
        const message = item.消息 || item.message || '';
        const time = item.时间 || item.time || '';
        const duration = item.弹窗时长秒 || item.duration || 30;
        if (!message) return;
        const el = document.createElement('div');
        el.className = 'emp-notify';
        el.innerHTML =
            '<div class="emp-notify-header">' +
                '<span class="emp-notify-avatar">' + avatar + '</span>' +
                '<span class="emp-notify-name">' + name + '</span>' +
                '<span class="emp-notify-time">' + time + '</span>' +
            '</div>' +
            '<div class="emp-notify-body">' + (typeof marked !== 'undefined' ? marked.parse(message) : message) + '</div>' +
            '<div class="emp-notify-actions">' +
                '<button class="emp-notify-btn primary" onclick="window.empWidget.openChat(\'' + name + '\')">💬 回复</button>' +
                '<button class="emp-notify-btn close" onclick="this.closest(\'.emp-notify\').remove()">✕ 关闭</button>' +
            '</div>';
        document.body.appendChild(el);
        setTimeout(function() { if (el.parentNode) el.remove(); }, duration * 1000);
    }

    // ========== 节点工作流编辑器 ==========
    let wfNodes = [];
    let wfConns = [];
    let wfNodeId = 0;
    let wfSelectedNode = null;
    let wfConnectFrom = null;
    let wfConnectFromList = [];  // 多选时同时连线的节点列表
    let wfConnectMode = null;  // 'forward' = 输出→输入, 'reverse' = 输入→输出
    let wfDragNode = null;     // {id, offsetX, offsetY}
    let wfZoom = 1;
    let wfPanX = 0;
    let wfPanY = 0;
    let wfPanning = false;
    let wfPanStart = null;
    let wfSelectedNodes = [];
    let wfBoxSelect = null;
    let wfFrames = [];
    let wfFrameId = 0;
    let wfDragFrame = null;

    // 撤销/重做
    let wfHistory = [];
    let wfRedoStack = [];
    const WF_HISTORY_MAX = 50;

    function wfSnapshot() {
        return JSON.stringify({
            nodes: wfNodes.map(function(n) { return JSON.parse(JSON.stringify(n)); }),
            conns: wfConns.map(function(c) { return JSON.parse(JSON.stringify(c)); }),
            frames: wfFrames.map(function(f) { return JSON.parse(JSON.stringify(f)); })
        });
    }

    function wfPushHistory() {
        wfHistory.push(wfSnapshot());
        if (wfHistory.length > WF_HISTORY_MAX) wfHistory.shift();
        wfRedoStack = [];
    }

    function wfRestoreSnapshot(snap) {
        const data = JSON.parse(snap);
        clearWorkflow();
        (data.nodes || []).forEach(function(n) { wfNodes.push(n); renderWfNode(n); });
        wfConns = data.conns || [];
        wfFrames = data.frames || [];
        wfFrames.forEach(function(f) { renderWfFrame(f); });
        wfNodeId = Math.max(wfNodeId, ...wfNodes.map(function(n) { var m = n.id.match(/^wf_(\d+)$/); return m ? parseInt(m[1]) : 0; }), 0);
        wfFrameId = Math.max(wfFrameId, ...wfFrames.map(function(f) { var m = f.id.match(/^frame_(\d+)$/); return m ? parseInt(m[1]) : 0; }), 0);
        wfSelectedNodes = [];
        updateNodeSelection();
        redrawWfConnections();
        updateWfInfo();
    }

    function wfUndo() {
        if (wfHistory.length === 0) return;
        wfRedoStack.push(wfSnapshot());
        const snap = wfHistory.pop();
        wfRestoreSnapshot(snap);
        autoSaveWorkflow();
    }

    function wfRedo() {
        if (wfRedoStack.length === 0) return;
        wfHistory.push(wfSnapshot());
        const snap = wfRedoStack.pop();
        wfRestoreSnapshot(snap);
        autoSaveWorkflow();
    }

    function applyWfTransform() {
        const canvas = document.getElementById('empWfCanvas');
        if (canvas) {
            canvas.style.transform = 'translate(' + wfPanX + 'px,' + wfPanY + 'px) scale(' + wfZoom + ')';
        }
        const z = document.getElementById('empWfZoom');
        if (z) z.textContent = Math.round(wfZoom * 100) + '%';
        redrawWfConnections();
    }

    function fitWorkflow() {
        if (wfNodes.length === 0) return;
        // 计算所有节点的包围盒
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        wfNodes.forEach(function(n) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + 180);
            maxY = Math.max(maxY, n.y + 100);
        });
        // 也考虑背景框
        wfFrames.forEach(function(f) {
            minX = Math.min(minX, f.x);
            minY = Math.min(minY, f.y);
            maxX = Math.max(maxX, f.x + f.w);
            maxY = Math.max(maxY, f.y + f.h);
        });
        const contentW = maxX - minX;
        const contentH = maxY - minY;
        const wrap = document.getElementById('empWfCanvasWrap');
        if (!wrap) return;
        const wrapRect = wrap.getBoundingClientRect();
        const padding = 60;
        // 计算缩放：内容能放进画布，留padding边距
        const zoomX = (wrapRect.width - padding * 2) / contentW;
        const zoomY = (wrapRect.height - padding * 2) / contentH;
        wfZoom = Math.max(0.2, Math.min(2, Math.min(zoomX, zoomY)));
        // 计算平移：内容居中
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        wfPanX = wrapRect.width / 2 - centerX * wfZoom;
        wfPanY = wrapRect.height / 2 - centerY * wfZoom;
        applyWfTransform();
    }

    async function autoDesign() {
        // 弹出输入框
        const overlay = document.createElement('div');
        overlay.className = 'emp-chat-overlay';
        overlay.style.zIndex = '9700';
        overlay.innerHTML = '<div class="emp-chat-box" style="width:420px;height:300px">' +
            '<div class="emp-chat-header">' +
                '<div class="emp-avatar">🤖</div>' +
                '<div><div class="emp-name">AI自动设计工作流</div><div class="emp-role">描述需求，AI自动生成节点图</div></div>' +
                '<div class="emp-chat-actions"><button class="emp-chat-btn" onclick="this.closest(\'.emp-chat-overlay\').remove()">✕</button></div>' +
            '</div>' +
            '<div class="emp-chat-body" style="padding:16px">' +
                '<textarea id="wfAutoDesignInput" rows="4" placeholder="描述你的需求，如：出3道算术题，经理出题，2个计算师分别做题，最后组合器汇总" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:none;font-family:inherit"></textarea>' +
                '<div id="wfAutoDesignStatus" style="margin-top:8px;font-size:12px;color:var(--text2)"></div>' +
            '</div>' +
            '<div class="emp-chat-input" style="justify-content:flex-end;padding:10px 16px">' +
                '<button class="emp-chat-btn" style="background:var(--blue);color:#fff;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:13px" id="wfAutoDesignBtn">🤖 生成</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(overlay);
        overlay.classList.add('show');
        overlay.addEventListener('click', function(e) { if (e.target === this) this.remove(); });

        // 对话框可拖拽
        const adBox = overlay.querySelector('.emp-chat-box');
        const adHeader = overlay.querySelector('.emp-chat-header');
        if (adHeader && adBox) {
            adHeader.style.cursor = 'move';
            adHeader.addEventListener('mousedown', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                const sx = e.clientX, sy = e.clientY;
                const r = adBox.getBoundingClientRect();
                let moved = false;
                function mv(ev) {
                    const dx = ev.clientX - sx, dy = ev.clientY - sy;
                    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                    if (moved) { adBox.style.position = 'fixed'; adBox.style.left = Math.max(0, Math.min(window.innerWidth - r.width, r.left + dx)) + 'px'; adBox.style.top = Math.max(0, Math.min(window.innerHeight - r.height, r.top + dy)) + 'px'; adBox.style.transform = 'none'; adBox.style.margin = '0'; }
                }
                function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
                document.addEventListener('mousemove', mv);
                document.addEventListener('mouseup', up);
            });
        }

        const input = document.getElementById('wfAutoDesignInput');
        input.focus();
        const btn = document.getElementById('wfAutoDesignBtn');
        const status = document.getElementById('wfAutoDesignStatus');

        btn.onclick = async function() {
            const 需求 = input.value.trim();
            if (!需求) { input.focus(); return; }
            btn.disabled = true;
            status.textContent = '⏳ 正在获取员工列表...';
            try {
                // 获取员工列表
                const empResp = await fetch('/api/employee-list');
                const empData = await empResp.json();
                const empList = empData.数据 || empData.data || [];
                const empNames = empList.filter(function(e) { return !(e.是母体 || e.isMother); }).map(function(e) {
                    return {姓名: e.姓名 || e.name, 角色: e.角色 || e.role || ''};
                });
                status.textContent = '⏳ 正在让AI设计工作流...';
                // 调后端生成
                const resp = await fetch('/api/wf-auto-design', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({需求: 需求, 员工列表: empNames})
                });
                const data = await resp.json();
                if (data.成功 || data.success) {
                    const 图 = data.图 || data.data || {};
                    const 新建员工 = data.新建员工 || [];
                    status.textContent = '✅ 生成成功，正在渲染...';
                    overlay.remove();
                    // 刷新员工列表
                    if (新建员工.length > 0) await refresh();
                    // 加载到画布
                    loadWorkflowFromData(图);
                    // 如果AI返回了frame，自动创建分组
                    if (图.frame && wfNodes.length > 0) {
                        // 用加载后的实际节点ID
                        wfSelectedNodes = wfNodes.map(function(n) { return n.id; });
                        updateNodeSelection();
                        // 创建frame
                        createWfFrame();
                        // 设置frame名称和颜色
                        if (wfFrames.length > 0) {
                            var lastFrame = wfFrames[wfFrames.length - 1];
                            lastFrame.text = 图.frame.text || 'AI生成';
                            if (图.frame.color) lastFrame.color = 图.frame.color;
                            renderWfFrame(lastFrame);
                        }
                        wfSelectedNodes = [];
                        updateNodeSelection();
                        autoSaveWorkflow();
                    }
                    // 自动排列
                    setTimeout(function() { autoLayout(); fitWorkflow(); }, 100);
                    if (新建员工.length > 0) {
                        showToast('AI已生成工作流，新建了' + 新建员工.length + '个员工：' + 新建员工.join('、'), 'success');
                    } else {
                        showToast('AI已生成工作流', 'success');
                    }
                } else {
                    status.textContent = '❌ 失败: ' + (data.错误 || data.error || '未知错误');
                    status.style.color = 'var(--red)';
                }
            } catch(e) {
                status.textContent = '❌ 连接失败: ' + e.message;
                status.style.color = 'var(--red)';
            }
            btn.disabled = false;
        };
    }

    function autoLayout() {
        if (wfNodes.length === 0) return;
        wfPushHistory();
        // 对齐到网格（24px网格）
        const grid = 24;
        wfNodes.forEach(function(n) {
            n.x = Math.round(n.x / grid) * grid;
            n.y = Math.round(n.y / grid) * grid;
            const el = document.getElementById('wfNode_' + n.id);
            if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
        });
        redrawWfConnections();
        autoSaveWorkflow();
        showToast('已对齐到网格', 'success');
    }

    function wfScreenToCanvas(sx, sy) {
        const wrap = document.getElementById('empWfCanvasWrap');
        if (!wrap) return {x: sx, y: sy};
        const rect = wrap.getBoundingClientRect();
        return {
            x: (sx - rect.left - wfPanX) / wfZoom,
            y: (sy - rect.top - wfPanY) / wfZoom
        };
    }

    function updateNodeSelection() {
        document.querySelectorAll('.emp-wf-node').forEach(function(el) {
            const nid = el.id.replace('wfNode_', '');
            el.classList.toggle('selected', wfSelectedNodes.includes(nid));
        });
    }

    function bindWfEvents() {
        const canvas = document.getElementById('empWfCanvas');
        const canvasWrap = document.getElementById('empWfCanvasWrap');
        if (!canvas) return;

        // 文件菜单按钮
        const fileMenuBtn = document.getElementById('wfFileMenuBtn');
        const fileMenu = document.getElementById('empWfFileMenu');
        if (fileMenuBtn && fileMenu) {
            fileMenuBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                fileMenu.style.display = fileMenu.style.display === 'none' ? 'block' : 'none';
            });
            document.addEventListener('click', function(e) {
                if (!fileMenu.contains(e.target) && e.target !== fileMenuBtn) fileMenu.style.display = 'none';
            });
        }

        // 中键平移 + 滚轮缩放
        canvasWrap.addEventListener('mousedown', function(e) {
            if (e.button === 1) {
                e.preventDefault();
                wfPanning = true;
                wfPanStart = {x: e.clientX - wfPanX, y: e.clientY - wfPanY};
                canvasWrap.classList.add('panning');
            }
        });
        canvasWrap.addEventListener('wheel', function(e) {
            e.preventDefault();
            const rect = canvasWrap.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const oldZoom = wfZoom;
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            wfZoom = Math.max(0.2, Math.min(3, wfZoom * delta));
            wfPanX = mx - (mx - wfPanX) * (wfZoom / oldZoom);
            wfPanY = my - (my - wfPanY) * (wfZoom / oldZoom);
            applyWfTransform();
        });

        // 从员工列表拖入画布 / 文件拖入
        canvasWrap.addEventListener('dragenter', function(e) {
            e.preventDefault();
        });
        canvasWrap.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = dragName ? 'move' : 'copy';
        });
        canvasWrap.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var dt = e.dataTransfer;
            // 浏览器外部文件拖入 → 创建input节点
            if (dt && dt.files && dt.files.length > 0) {
                var p = wfScreenToCanvas(e.clientX, e.clientY);
                if (!isFinite(p.x) || !isFinite(p.y)) { p = {x: 200, y: 200}; }
                var files = [];
                for (var i = 0; i < dt.files.length; i++) { files.push(dt.files[i]); }
                appendWfLog('📥 拖入 ' + files.length + ' 个文件', 'header');
                _handleFileDrop(files, p);
                return;
            }
            // 内部文件树拖入 → 解析路径创建input节点
            var textData = dt.getData('text/plain');
            if (textData) {
                try {
                    var parsed = JSON.parse(textData);
                    if (parsed.paths && Array.isArray(parsed.paths)) {
                        var p2 = wfScreenToCanvas(e.clientX, e.clientY);
                        if (!isFinite(p2.x) || !isFinite(p2.y)) { p2 = {x: 200, y: 200}; }
                        // 将路径转为伪 File 对象
                        var pseudoFiles = parsed.paths.map(function(path) {
                            var name = path.split('/').pop().split('\\').pop();
                            var dotIdx = name.lastIndexOf('.');
                            var ext = dotIdx >= 0 ? name.substring(dotIdx+1).toLowerCase() : '';
                            var isDir = !ext;
                            return { name: name, path: path, ext: ext, isDir: isDir };
                        });
                        appendWfLog('📥 从文件树拖入 ' + pseudoFiles.length + ' 个文件', 'header');
                        _handleFileDrop(pseudoFiles, p2);
                        return;
                    }
                } catch(err) { /* 不是JSON格式，忽略 */ }
            }
            // 员工拖入
            if (!dragName) return;
            var dropP = wfScreenToCanvas(e.clientX, e.clientY);
            if (dragName === '🎯目标' || dragName === '📋打印') return;
            {
                const emp = employees.find(function(em) { return (em.name || em.姓名) === dragName; });
                const avatar = emp ? (emp.avatar || emp.头像 || '🙂') : '🙂';
                const role = emp ? (emp.role || emp.角色 || '') : '';
                addWfNode('employee', dropP.x, dropP.y, avatar + ' ' + dragName, {员工名: dragName, 指令: ''}, {员工名: dragName, avatar: avatar, role: role});
            }
        });

        // SVG连线点击删除 / 双击配置循环
        const svg = document.getElementById('empWfSvg');
        svg.addEventListener('click', function(e) {
            if (e.target.tagName === 'path' && !e.target.classList.contains('temp')) {
                const from = e.target.dataset.from;
                const to = e.target.dataset.to;
                wfConns = wfConns.filter(function(c) { return !(c.from === from && c.to === to); });
                redrawWfConnections();
                updateWfInfo();
                autoSaveWorkflow();
                wfPushHistory();
            }
        });

        // 面板header拖拽
        const wfHeader = document.getElementById('empWfHeader');
        const wfPanel = document.getElementById('empWfPanel');
        wfHeader.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            const startX = e.clientX, startY = e.clientY;
            const panelRect = wfPanel.getBoundingClientRect();
            let moved = false;
            function onMove(ev) {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                if (moved) {
                    wfPanel.style.left = Math.max(0, Math.min(window.innerWidth - panelRect.width, panelRect.left + dx)) + 'px';
                    wfPanel.style.top = Math.max(0, Math.min(window.innerHeight - panelRect.height, panelRect.top + dy)) + 'px';
                    wfPanel.style.transform = 'none';
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (moved) {
                    const rect = wfPanel.getBoundingClientRect();
                    const cur = JSON.parse(localStorage.getItem('empWfPanelState') || '{}');
                    cur.x = rect.left; cur.y = rect.top;
                    cur.w = rect.width; cur.h = rect.height;
                    localStorage.setItem('empWfPanelState', JSON.stringify(cur));
                }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // 面板resize手柄（左/下/左下角）
        wfPanel.querySelectorAll('[data-presize]').forEach(function(handle) {
            handle.addEventListener('mousedown', function(e) {
                e.stopPropagation();
                e.preventDefault();
                var dir = handle.dataset.presize;
                var startX = e.clientX, startY = e.clientY;
                var rect = wfPanel.getBoundingClientRect();
                var startW = rect.width, startH = rect.height, startL = rect.left, startT = rect.top;
                // 拖拽开始时立即清除居中transform，固定面板到绝对坐标
                wfPanel.style.transform = 'none';
                wfPanel.style.left = startL + 'px';
                wfPanel.style.top = startT + 'px';
                function onMove(ev) {
                    var dx = ev.clientX - startX, dy = ev.clientY - startY;
                    if (dir === 'l' || dir === 'bl' || dir === 'tl') {
                        var nw = Math.max(400, startW - dx);
                        wfPanel.style.left = (startL + (startW - nw)) + 'px';
                        wfPanel.style.width = nw + 'px';
                    }
                    if (dir === 'r' || dir === 'br' || dir === 'tr') {
                        wfPanel.style.width = Math.max(400, startW + dx) + 'px';
                    }
                    if (dir === 't' || dir === 'tl' || dir === 'tr') {
                        var nh = Math.max(300, startH - dy);
                        wfPanel.style.top = (startT + (startH - nh)) + 'px';
                        wfPanel.style.height = nh + 'px';
                    }
                    if (dir === 'b' || dir === 'bl' || dir === 'br') {
                        wfPanel.style.height = Math.max(300, startH + dy) + 'px';
                    }
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    var r = wfPanel.getBoundingClientRect();
                    var cur = JSON.parse(localStorage.getItem('empWfPanelState') || '{}');
                    cur.x = r.left; cur.y = r.top; cur.w = r.width; cur.h = r.height;
                    localStorage.setItem('empWfPanelState', JSON.stringify(cur));
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });

        // 双击节点 → 弹出详情对话框（同一时间只允许一个）
        canvasWrap.addEventListener('dblclick', function(e) {
            const nodeEl = e.target.closest('.emp-wf-node');
            // 空白处双击 → 关闭所有弹出属性窗
            if (!nodeEl) {
                const existing = document.querySelector('.wf-popup');
                if (existing) {
                    existing.classList.remove('show');
                    setTimeout(function() { existing.remove(); }, 200);
                }
                return;
            }
            if (e.target.classList.contains('del')) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            // 双击端口（小球）→ 弹出该端口关联连线的循环配置
            if (e.target.classList.contains('emp-wf-port')) {
                var portNodeId = e.target.dataset.node;
                var isOutput = e.target.classList.contains('output');
                var conn = wfConns.find(function(c) {
                    return isOutput ? c.from === portNodeId : c.to === portNodeId;
                });
                if (conn) {
                    _showConnConfig(conn.from, conn.to);
                } else {
                    showToast('该端口没有连线', 'info');
                }
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            const nid = nodeEl.id.replace('wfNode_', '');
            const existing = document.querySelector('.wf-popup');
            if (existing) { existing.classList.remove('show'); existing.remove(); }
            _wfShowNodeDetail(nid, e.clientX, e.clientY);
            e.stopPropagation();
            e.preventDefault();
        });

        // 右键节点 → 弹出员工操作菜单
        canvasWrap.addEventListener('contextmenu', function(e) {
            const nodeEl = e.target.closest('.emp-wf-node');
            if (!nodeEl) return;
            const node = wfNodes.find(function(n) { return n.id === nodeEl.id.replace('wfNode_', ''); });
            if (!node || node.type !== 'employee') return;
            e.preventDefault();
            e.stopPropagation();
            const 员工名 = node.config.员工名 || node.name;
            showContextMenu(e, 员工名);
        });

        // ===== 统一鼠标事件分发器 =====
        canvasWrap.addEventListener('mousedown', function(e) {
            if (e.button !== 0 || wfPanning) return;
            // 拖拽文件时不触发画布操作
            if (e.target && e.target.tagName === 'HTML') return;
            const target = e.target;

            // 输出端口 → 开始连线（正向：输出→输入）
            // 输出端口 → 开始连线（正向：输出→输入）
            if (target.classList && target.classList.contains('emp-wf-port') && target.classList.contains('output')) {
                e.preventDefault(); e.stopPropagation();
                // 如果选中了多个节点，全部参与连线
                var portNodeId = target.dataset.node;
                if (wfSelectedNodes.length > 1 && wfSelectedNodes.includes(portNodeId)) {
                    wfConnectFromList = wfSelectedNodes.slice();
                } else {
                    wfConnectFromList = [portNodeId];
                }
                wfConnectFrom = portNodeId;  // 主线从拖拽的端口画
                wfConnectMode = 'forward';
                return;
            }
            // 输入端口 → 开始反向连线（反向：输入→输出）
            if (target.classList && target.classList.contains('emp-wf-port') && target.classList.contains('input')) {
                if (wfConnectFrom && wfConnectMode === 'forward') {
                    // 正在正向连线，点击输入端口完成
                    var toId = target.dataset.node;
                    if (wfConnectFrom !== toId) {
                        var exists = wfConns.some(function(c) { return c.from === wfConnectFrom && c.to === toId; });
                        if (!exists) {
                            wfConns.push({from: wfConnectFrom, to: toId});
                            redrawWfConnections(); updateWfInfo(); autoSaveWorkflow();
                        }
                    }
                    wfConnectFrom = null; wfConnectMode = null; wfConnectFromList = [];
                    var svgEl = document.getElementById('empWfSvg');
                    if (svgEl) { var t = svgEl.querySelector('path.temp'); if (t) t.remove(); }
                    redrawWfConnections();
                    return;
                }
                // 否则开始反向连线（从输入端口拉出）
                e.preventDefault(); e.stopPropagation();
                var portNodeId = target.dataset.node;
                // 多选时全部参与反向连线
                if (wfSelectedNodes.length > 1 && wfSelectedNodes.includes(portNodeId)) {
                    wfConnectFromList = wfSelectedNodes.slice();
                } else {
                    wfConnectFromList = [portNodeId];
                }
                wfConnectFrom = portNodeId;
                wfConnectMode = 'reverse';
                return;
            }

            // 背景框 → 拖拽移动框内所有节点
            const frameEl = target.closest('.wf-frame');
            if (frameEl) {
                const fid = frameEl.dataset.id;
                const frame = wfFrames.find(function(f) { return f.id === fid; });
                if (frame) {
                    if (e.target.classList.contains('wf-frame-del')) { _wfDeleteFrame(fid); return; }
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                    const p = wfScreenToCanvas(e.clientX, e.clientY);
                    wfDragFrame = {id: fid, lastX: p.x, lastY: p.y};
                    e.preventDefault();
                    return;
                }
            }

            // 节点header → 拖动或复制
            const headerEl = target.closest('.emp-wf-node-header');
            if (headerEl) {
                const nodeEl2 = headerEl.closest('.emp-wf-node');
                // 验证点击确实在这个节点内（防止重叠节点误选）
                if (nodeEl2) {
                    const nodeRect = nodeEl2.getBoundingClientRect();
                    if (e.clientX < nodeRect.left || e.clientX > nodeRect.right || e.clientY < nodeRect.top || e.clientY > nodeRect.bottom) {
                        // 点击不在该节点范围内，跳过
                        return;
                    }
                }
                const nid = nodeEl2 ? nodeEl2.id.replace('wfNode_', '') : headerEl.dataset.node;
                if (e.target.classList.contains('del')) return;
                const node = wfNodes.find(function(n) { return n.id === nid; });
                if (!node) return;
                if (e.shiftKey) {
                    // shift+拖拽=复制选中节点+连线
                    const idsToCopy = wfSelectedNodes.includes(nid) ? wfSelectedNodes : [nid];
                    const idMap = {};
                    const newIds = [];
                    // 鼠标在画布上的位置
                    var mouseP = wfScreenToCanvas(e.clientX, e.clientY);
                    // 计算鼠标在原节点上的偏移量（鼠标→被拖拽节点的左上角）
                    var srcNode = wfNodes.find(function(x) { return x.id === nid; });
                    var grabOffsetX = mouseP.x - srcNode.x;
                    var grabOffsetY = mouseP.y - srcNode.y;
                    // 复制：保持鼠标在节点上的相对位置不变
                    idsToCopy.forEach(function(oldId) {
                        const src = wfNodes.find(function(x) { return x.id === oldId; });
                        if (!src) return;
                        const copy = JSON.parse(JSON.stringify(src));
                        do { copy.id = 'wf_' + (++wfNodeId); } while (document.getElementById('wfNode_' + copy.id));
                        idMap[oldId] = copy.id;
                        // 复制节点 = 原位置 + (鼠标偏移量保持一致)
                        copy.x = src.x;
                        copy.y = src.y;
                        wfNodes.push(copy);
                        renderWfNode(copy);
                        newIds.push(copy.id);
                    });
                    // 复制选中节点之间的连线
                    wfConns.filter(function(c) { return idsToCopy.includes(c.from) && idsToCopy.includes(c.to); }).forEach(function(c) {
                        const nf = idMap[c.from], nt = idMap[c.to];
                        if (nf && nt && !wfConns.some(function(x) { return x.from === nf && x.to === nt; })) {
                            wfConns.push({from: nf, to: nt});
                        }
                    });
                    wfSelectedNodes = newIds;
                    updateNodeSelection();
                    redrawWfConnections();
                    updateWfInfo(); autoSaveWorkflow();
                    // 开始拖拽：offset = 鼠标到复制节点左上角的距离（和原节点一样）
                    const mainCopy = wfNodes.find(function(n) { return n.id === (idMap[nid] || newIds[0]); });
                    wfDragNode = {id: mainCopy.id, offsetX: grabOffsetX, offsetY: grabOffsetY, lastX: mouseP.x, lastY: mouseP.y};
                } else {
                    // ctrl=加选, alt=减选, 普通=替换
                    if (e.altKey) {
                        wfSelectedNodes = wfSelectedNodes.filter(function(n) { return n !== nid; });
                    } else if (e.ctrlKey) {
                        if (!wfSelectedNodes.includes(nid)) wfSelectedNodes.push(nid);
                    } else if (!wfSelectedNodes.includes(nid)) {
                        wfSelectedNodes = [nid];
                    }
                    updateNodeSelection();
                    const p = wfScreenToCanvas(e.clientX, e.clientY);
                    wfDragNode = {id: nid, offsetX: p.x - node.x, offsetY: p.y - node.y, lastX: p.x, lastY: p.y};
                }
                e.preventDefault();
                return;
            }

            // 节点其他部分 → 选中
            const nodeEl = target.closest('.emp-wf-node');
            if (nodeEl) {
                const nid = nodeEl.id.replace('wfNode_', '');
                if (e.altKey) {
                    wfSelectedNodes = wfSelectedNodes.filter(function(n) { return n !== nid; });
                } else if (e.ctrlKey) {
                    if (!wfSelectedNodes.includes(nid)) wfSelectedNodes.push(nid);
                } else if (!wfSelectedNodes.includes(nid)) {
                    wfSelectedNodes = [nid];
                }
                updateNodeSelection();
                return;
            }

            // 空白 → 框选
            if (wfConnectFrom) {
                wfConnectFrom = null; wfConnectMode = null; wfConnectFromList = [];
                const svgEl = document.getElementById('empWfSvg');
                if (svgEl) { const t = svgEl.querySelector('path.temp'); if (t) t.remove(); }
                redrawWfConnections();
                return;
            }
            if (!e.ctrlKey && !e.altKey) {
                wfSelectedNodes = [];
                updateNodeSelection();
            }
            const p = wfScreenToCanvas(e.clientX, e.clientY);
            wfBoxSelect = {startX: p.x, startY: p.y, ctrl: e.ctrlKey, alt: e.altKey};
            const box = document.getElementById('wfSelBox');
            if (box) { box.style.display = 'block'; box.style.left = p.x + 'px'; box.style.top = p.y + 'px'; box.style.width = '0'; box.style.height = '0'; }
        });

        // 统一mousemove
        document.addEventListener('mousemove', function(e) {
            if (wfPanning) {
                wfPanX = e.clientX - wfPanStart.x;
                wfPanY = e.clientY - wfPanStart.y;
                applyWfTransform();
                return;
            }
            if (wfDragFrame) {
                const p = wfScreenToCanvas(e.clientX, e.clientY);
                const dx = p.x - wfDragFrame.lastX;
                const dy = p.y - wfDragFrame.lastY;
                const frame = wfFrames.find(function(f) { return f.id === wfDragFrame.id; });
                if (frame) {
                    frame.x += dx; frame.y += dy;
                    const el = document.getElementById('wfFrame_' + frame.id);
                    if (el) { el.style.left = frame.x + 'px'; el.style.top = frame.y + 'px'; }
                    // 用nodeIds追踪内部节点，而不是bounds check
                    if (frame.nodeIds) {
                        frame.nodeIds.forEach(function(nid) {
                            const n = wfNodes.find(function(x) { return x.id === nid; });
                            if (n) {
                                n.x += dx; n.y += dy;
                                const ne = document.getElementById('wfNode_' + n.id);
                                if (ne) { ne.style.left = n.x + 'px'; ne.style.top = n.y + 'px'; }
                            }
                        });
                    }
                    redrawWfConnections();
                }
                wfDragFrame.lastX = p.x; wfDragFrame.lastY = p.y;
                return;
            }
            if (wfDragNode) {
                const p = wfScreenToCanvas(e.clientX, e.clientY);
                const dx = p.x - wfDragNode.lastX;
                const dy = p.y - wfDragNode.lastY;
                const node = wfNodes.find(function(n) { return n.id === wfDragNode.id; });
                if (node) {
                    node.x = p.x - wfDragNode.offsetX;
                    node.y = p.y - wfDragNode.offsetY;
                    const el = document.getElementById('wfNode_' + node.id);
                    if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
                }
                // 多选时一起移动
                if (wfSelectedNodes.length > 1) {
                    wfSelectedNodes.forEach(function(sid) {
                        if (sid === wfDragNode.id) return;
                        const sn = wfNodes.find(function(n) { return n.id === sid; });
                        if (sn) {
                            sn.x += dx; sn.y += dy;
                            const se = document.getElementById('wfNode_' + sid);
                            if (se) { se.style.left = sn.x + 'px'; se.style.top = sn.y + 'px'; }
                        }
                    });
                }
                redrawWfConnections();
                wfDragNode.lastX = p.x; wfDragNode.lastY = p.y;
                return;
            }
            if (wfConnectFrom) {
                const svgEl = document.getElementById('empWfSvg');
                if (!svgEl) return;
                // 清除旧的临时线
                svgEl.querySelectorAll('path.temp').forEach(function(p) { p.remove(); });
                const canvasEl = document.getElementById('empWfCanvas');
                const canvasRect = canvasEl.getBoundingClientRect();
                const p = wfScreenToCanvas(e.clientX, e.clientY);
                var nodesToDraw = (wfConnectFromList.length > 0 ? wfConnectFromList : [wfConnectFrom]);
                nodesToDraw.forEach(function(fromId) {
                    var fromEl = document.getElementById('wfNode_' + fromId);
                    if (!fromEl) return;
                    var portSelector = wfConnectMode === 'reverse' ? '.emp-wf-port.input' : '.emp-wf-port.output';
                    var fromPort = fromEl.querySelector(portSelector);
                    if (!fromPort) return;
                    var fromRect = fromPort.getBoundingClientRect();
                    var x1 = (fromRect.left + fromRect.width/2 - canvasRect.left) / wfZoom;
                    var y1 = (fromRect.top + fromRect.height/2 - canvasRect.top) / wfZoom;
                    var dx = Math.abs(p.x - x1) * 0.5;
                    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + (x1+dx) + ' ' + y1 + ', ' + (p.x-dx) + ' ' + p.y + ', ' + p.x + ' ' + p.y);
                    path.setAttribute('class', 'temp');
                    svgEl.appendChild(path);
                });
                return;
            }
            if (wfBoxSelect) {
                const p = wfScreenToCanvas(e.clientX, e.clientY);
                const box = document.getElementById('wfSelBox');
                if (box) {
                    box.style.left = Math.min(wfBoxSelect.startX, p.x) + 'px';
                    box.style.top = Math.min(wfBoxSelect.startY, p.y) + 'px';
                    box.style.width = Math.abs(p.x - wfBoxSelect.startX) + 'px';
                    box.style.height = Math.abs(p.y - wfBoxSelect.startY) + 'px';
                }
                return;
            }
        });

        // 统一mouseup
        document.addEventListener('mouseup', function(e) {
            if (wfPanning) { wfPanning = false; canvasWrap.classList.remove('panning'); }
            if (wfDragNode) {
                // 保存所有移动过的节点尺寸
                wfSelectedNodes.concat(wfDragNode.id).forEach(function(nid) {
                    var el = document.getElementById('wfNode_' + nid);
                    var n = wfNodes.find(function(x) { return x.id === nid; });
                    if (el && n) { n.w = el.offsetWidth; n.h = el.offsetHeight; }
                });
                autoSaveWorkflow(); wfPushHistory(); wfDragNode = null;
            }
            if (wfDragFrame) { autoSaveWorkflow(); wfPushHistory(); wfDragFrame = null; }
            if (wfConnectFrom) {
                // 临时禁用SVG的pointer-events，让elementFromPoint能找到下面的节点
                var svgForHit = document.getElementById('empWfSvg');
                var svgOldPE = svgForHit ? svgForHit.style.pointerEvents : '';
                if (svgForHit) svgForHit.style.pointerEvents = 'none';
                const under = document.elementFromPoint(e.clientX, e.clientY);
                if (svgForHit) svgForHit.style.pointerEvents = svgOldPE;
                var toId = null;
                // 检查是否在端口上
                if (under && under.classList && under.classList.contains('emp-wf-port')) {
                    toId = under.dataset.node;
                } else {
                    // 检查是否在节点上（端口旁边的节点本体也算）
                    const nodeUnder = under ? under.closest('.emp-wf-node') : null;
                    if (nodeUnder) toId = nodeUnder.id.replace('wfNode_', '');
                }
                if (toId) {
                    var added = false;
                    var nodesToConnect = (wfConnectFromList.length > 0 ? wfConnectFromList : [wfConnectFrom]);
                    nodesToConnect.forEach(function(fromId) {
                        if (!fromId || fromId === toId) return;
                        if (wfConnectMode === 'forward') {
                            var exists = wfConns.some(function(c) { return c.from === fromId && c.to === toId; });
                            if (!exists) { wfConns.push({from: fromId, to: toId}); added = true; }
                        } else if (wfConnectMode === 'reverse') {
                            var exists2 = wfConns.some(function(c) { return c.from === toId && c.to === fromId; });
                            if (!exists2) { wfConns.push({from: toId, to: fromId}); added = true; }
                        }
                    });
                    if (added) { redrawWfConnections(); updateWfInfo(); autoSaveWorkflow(); }
                }
                wfConnectFrom = null; wfConnectMode = null; wfConnectFromList = [];
                // 清除所有临时线（不只是第一条）
                if (svgForHit) { svgForHit.querySelectorAll('path.temp').forEach(function(p) { p.remove(); }); }
                redrawWfConnections();
            }
            if (wfBoxSelect) {
                const p = wfScreenToCanvas(e.clientX, e.clientY);
                const x1 = Math.min(wfBoxSelect.startX, p.x);
                const y1 = Math.min(wfBoxSelect.startY, p.y);
                const x2 = Math.max(wfBoxSelect.startX, p.x);
                const y2 = Math.max(wfBoxSelect.startY, p.y);
                const box = document.getElementById('wfSelBox');
                if (box) box.style.display = 'none';
                if (Math.abs(x2 - x1) > 5 && Math.abs(y2 - y1) > 5) {
                    const inBox = wfNodes.filter(function(n) {
                        return n.x < x2 && n.x + 180 > x1 && n.y < y2 && n.y + 100 > y1;
                    }).map(function(n) { return n.id; });
                    if (wfBoxSelect.alt) {
                        wfSelectedNodes = wfSelectedNodes.filter(function(id) { return !inBox.includes(id); });
                    } else if (wfBoxSelect.ctrl) {
                        inBox.forEach(function(id) { if (!wfSelectedNodes.includes(id)) wfSelectedNodes.push(id); });
                    } else {
                        wfSelectedNodes = inBox;
                    }
                    updateNodeSelection();
                }
                wfBoxSelect = null;
            }
        });

        // Delete键删除 + Ctrl+C/V复制粘贴
        let wfClipboard = [];  // {nodes: [...], conns: [...]}
        let wfMouseX = 0, wfMouseY = 0;  // 记录鼠标在画布上的位置
        // 跟踪鼠标位置（用于粘贴时定位）
        document.addEventListener('mousemove', function(e) {
            const wrap = document.getElementById('empWfCanvasWrap');
            if (!wrap) return;
            const rect = wrap.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const p = wfScreenToCanvas(e.clientX, e.clientY);
                wfMouseX = p.x; wfMouseY = p.y;
            }
        });
        document.addEventListener('keydown', function(e) {
            if (!document.getElementById('empWfOverlay').classList.contains('show')) return;
            // Ctrl+C 复制选中节点+连线
            if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && wfSelectedNodes.length > 0) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                wfClipboard = {
                    nodes: wfSelectedNodes.map(function(nid) {
                        const n = wfNodes.find(function(x) { return x.id === nid; });
                        return n ? JSON.parse(JSON.stringify(n)) : null;
                    }).filter(Boolean),
                    conns: wfConns.filter(function(c) {
                        return wfSelectedNodes.includes(c.from) && wfSelectedNodes.includes(c.to);
                    }).map(function(c) { return JSON.parse(JSON.stringify(c)); })
                };
                e.preventDefault();
                return;
            }
            // Ctrl+V 粘贴节点+连线，位置偏移30px
            if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && wfClipboard.nodes && wfClipboard.nodes.length > 0) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                // 建立旧ID→新ID映射
                const idMap = {};
                wfSelectedNodes = [];
                // 以鼠标位置为粘贴中心，保持节点间相对位置
                const clipMinX = Math.min(...wfClipboard.nodes.map(function(n) { return n.x; }));
                const clipMinY = Math.min(...wfClipboard.nodes.map(function(n) { return n.y; }));
                const pasteOffsetX = wfMouseX - clipMinX;
                const pasteOffsetY = wfMouseY - clipMinY;
                wfClipboard.nodes.forEach(function(n) {
                    const copy = JSON.parse(JSON.stringify(n));
                    const oldId = copy.id;
                    do { copy.id = 'wf_' + (++wfNodeId); } while (document.getElementById('wfNode_' + copy.id));
                    idMap[oldId] = copy.id;
                    copy.x += pasteOffsetX; copy.y += pasteOffsetY;
                    wfNodes.push(copy);
                    renderWfNode(copy);
                    wfSelectedNodes.push(copy.id);
                });
                // 复制连线
                wfClipboard.conns.forEach(function(c) {
                    const newFrom = idMap[c.from];
                    const newTo = idMap[c.to];
                    if (newFrom && newTo) {
                        const exists = wfConns.some(function(x) { return x.from === newFrom && x.to === newTo; });
                        if (!exists) wfConns.push({from: newFrom, to: newTo});
                    }
                });
                updateNodeSelection();
                redrawWfConnections();
                updateWfInfo();
                autoSaveWorkflow();
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (wfSelectedNodes.length === 0) return;
                wfPushHistory();  // 批量删除前只推一次历史
                wfSelectedNodes.forEach(function(nid) { _wfDeleteNodeNoHistory(nid); });
                wfSelectedNodes = [];
                autoSaveWorkflow();
                e.preventDefault();
            }
            if (e.key === 'Escape' && wfConnectFrom) {
                wfConnectFrom = null; wfConnectMode = null; wfConnectFromList = [];
                const svgEl = document.getElementById('empWfSvg');
                if (svgEl) { const t = svgEl.querySelector('path.temp'); if (t) t.remove(); }
                redrawWfConnections();
            }
            // Ctrl+G = 创建背景框
            if (e.ctrlKey && (e.key === 'g' || e.key === 'G') && wfSelectedNodes.length > 0) {
                e.preventDefault();
                createWfFrame();
            }
            // Ctrl+Z = 撤销, Ctrl+Y / Ctrl+Shift+Z = 重做
            if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                wfUndo();
            }
            if (e.ctrlKey && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                wfRedo();
            }
            // Y键 = 按住开启剪刀模式
            if (!e.ctrlKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (!wfScissorsMode) _scissorsOn();
                e.preventDefault();
            }
        });
        // 松开Y键 = 关闭剪刀模式
        document.addEventListener('keyup', function(e) {
            if ((e.key === 'y' || e.key === 'Y') && wfScissorsMode && !e.ctrlKey && !e.shiftKey) {
                _scissorsOff();
            }
        });
    }

    // ========== 剪刀模式 ==========
    let wfScissorsMode = false;
    let wfCutPath = [];

    function _scissorsOn() {
        wfScissorsMode = true;
        const btn = document.getElementById('wfScissorsBtn');
        const cutSvg = document.getElementById('empWfCutSvg');
        const wrap = document.getElementById('empWfCanvasWrap');
        if (btn) { btn.style.background = 'rgba(241,76,76,0.2)'; btn.style.color = 'var(--red)'; }
        if (wrap) wrap.style.cursor = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><text y=\'18\' font-size=\'18\'>✂️</text></svg>") 2 2, crosshair';
        if (cutSvg) cutSvg.style.display = 'block';
    }

    function _scissorsOff() {
        wfScissorsMode = false;
        const btn = document.getElementById('wfScissorsBtn');
        const cutSvg = document.getElementById('empWfCutSvg');
        const wrap = document.getElementById('empWfCanvasWrap');
        if (btn) { btn.style.background = ''; btn.style.color = ''; }
        if (wrap) wrap.style.cursor = 'default';
        if (cutSvg) { cutSvg.style.display = 'none'; cutSvg.innerHTML = ''; }
        wfCutPath = [];
    }

    function _toggleScissors() {
        if (wfScissorsMode) _scissorsOff(); else _scissorsOn();
    }

    function _bindScissorsEvents() {
        const wrap = document.getElementById('empWfCanvasWrap');
        if (!wrap) return;
        wrap.addEventListener('mousedown', function(e) {
            if (!wfScissorsMode || e.button !== 0) return;
            const p = wfScreenToCanvas(e.clientX, e.clientY);
            wfCutPath = [p];
            e.preventDefault();
        });
        wrap.addEventListener('mousemove', function(e) {
            if (!wfScissorsMode || wfCutPath.length === 0) return;
            const p = wfScreenToCanvas(e.clientX, e.clientY);
            wfCutPath.push(p);
            var cutSvg = document.getElementById('empWfCutSvg');
            if (cutSvg) {
                var d = 'M ' + wfCutPath.map(function(pt) { return pt.x + ' ' + pt.y; }).join(' L ');
                cutSvg.innerHTML = '<path d="' + d + '" stroke="rgba(241,76,76,0.8)" stroke-width="2" fill="none" stroke-dasharray="4 3" style="pointer-events:none"/>';
            }
        });
        document.addEventListener('mouseup', function() {
            if (!wfScissorsMode || wfCutPath.length < 2) { wfCutPath = []; return; }
            _executeCut();
            wfCutPath = [];
            var cutSvg = document.getElementById('empWfCutSvg');
            if (cutSvg) cutSvg.innerHTML = '';
        });
    }

    function _segmentsIntersect(x1,y1,x2,y2,x3,y3,x4,y4) {
        var d1 = (x2-x1)*(y3-y1) - (x3-x1)*(y2-y1);
        var d2 = (x2-x1)*(y4-y1) - (x4-x1)*(y2-y1);
        var d3 = (x4-x3)*(y1-y3) - (x1-x3)*(y4-y3);
        var d4 = (x4-x3)*(y2-y3) - (x2-x3)*(y4-y3);
        return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
    }

    function _executeCut() {
        var removed = 0;
        wfConns = wfConns.filter(function(c) {
            var fromEl = document.getElementById('wfNode_' + c.from);
            var toEl = document.getElementById('wfNode_' + c.to);
            if (!fromEl || !toEl) return true;
            var fromPort = fromEl.querySelector('.emp-wf-port.output');
            var toPort = toEl.querySelector('.emp-wf-port.input');
            var canvas = document.getElementById('empWfCanvas');
            var canvasRect = canvas.getBoundingClientRect();
            var fromRect = fromPort.getBoundingClientRect();
            var toRect = toPort.getBoundingClientRect();
            var x1 = (fromRect.left + fromRect.width/2 - canvasRect.left) / wfZoom;
            var y1 = (fromRect.top + fromRect.height/2 - canvasRect.top) / wfZoom;
            var x2 = (toRect.left + toRect.width/2 - canvasRect.left) / wfZoom;
            var y2 = (toRect.top + toRect.height/2 - canvasRect.top) / wfZoom;
            for (var i = 0; i < wfCutPath.length - 1; i++) {
                var a = wfCutPath[i], b = wfCutPath[i+1];
                if (_segmentsIntersect(x1,y1,x2,y2, a.x,a.y, b.x,b.y)) { removed++; return false; }
            }
            return true;
        });
        if (removed > 0) {
            redrawWfConnections(); updateWfInfo(); autoSaveWorkflow(); wfPushHistory();
            showToast('剪断了 ' + removed + ' 条连线', 'success');
        }
    }

    function _handleFileDrop(files, startPos) {
        wfPushHistory();
        var cols = Math.min(3, Math.ceil(Math.sqrt(files.length)));
        var doneCount = 0;
        files.forEach(function(file, idx) {
            (function(file, idx) {
                var col = idx % cols, row = Math.floor(idx / cols);
                var x = startPos.x + col * 200;
                var y = startPos.y + row * 140;
                var fileName = file.name;
                var filePath = file.path || file.name;
                var isDir = !!file.isDir;
                var ext = file.ext || (fileName.split('.').pop() || '').toLowerCase();
                var icon = isDir ? '📁' : '📄';
                var fileType = 'text';
                if (isDir) { fileType = 'folder'; }
                else if (['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) { icon = '🖼️'; fileType = 'image'; }
                else if (ext === 'json') { icon = '📋'; fileType = 'json'; }
                else if (['csv','xlsx','xls'].includes(ext)) { icon = '📊'; fileType = 'data'; }
                else if (['py','js','ts','css','html','md','txt','sh','bat'].includes(ext)) { icon = '📜'; }
                else if (['mp4','webm','mkv','avi','mov'].includes(ext)) { icon = '🎬'; }
                else if (['mp3','wav','ogg','flac'].includes(ext)) { icon = '🎵'; }
                else if (['blend'].includes(ext)) { icon = '🟠'; }
                else if (['exe'].includes(ext)) { icon = '⚙️'; }

                // 内部文件树拖入（有path属性，是伪File对象）→ 只存路径，不预读内容
                if (file.path && !file.size) {
                    appendWfLog('📥 已导入: ' + fileName, 'info');
                    addWfNode('input', x, y, icon + ' ' + fileName, {文件名: fileName, 内容: '', 类型: fileType, 路径: filePath}, {文件名: fileName, 类型: fileType, 图标: icon});
                    doneCount++;
                    if (doneCount === files.length) { redrawWfConnections(); fitWorkflow(); }
                    return;
                }
                // 浏览器外部文件拖入 → FileReader 读取
                var sizeKB = file.size ? (file.size/1024).toFixed(1) : '?';
                appendWfLog('📥 正在读取: ' + fileName + ' (' + sizeKB + 'KB)', 'info');
                if (fileType === 'image') {
                    var reader = new FileReader();
                    reader.onload = function(e) {
                        var content = e.target.result;
                        addWfNode('input', x, y, icon + ' ' + fileName, {文件名: fileName, 内容: content, 类型: fileType, 路径: filePath}, {文件名: fileName, 类型: fileType, 图标: icon});
                        doneCount++;
                        appendWfLog('✅ 已导入: ' + fileName, 'success');
                        if (doneCount === files.length) { redrawWfConnections(); fitWorkflow(); }
                    };
                    reader.onerror = function() { appendWfLog('❌ 读取失败: ' + fileName, 'error'); };
                    reader.readAsDataURL(file);
                } else {
                    var reader2 = new FileReader();
                    reader2.onload = function(e) {
                        var content = e.target.result;
                        if (content.length > 5000) content = content.substring(0, 5000) + '\n...(截断，共' + content.length + '字符)';
                        addWfNode('input', x, y, icon + ' ' + fileName, {文件名: fileName, 内容: content, 类型: fileType, 路径: filePath}, {文件名: fileName, 类型: fileType, 图标: icon});
                        doneCount++;
                        appendWfLog('✅ 已导入: ' + fileName, 'success');
                        if (doneCount === files.length) { redrawWfConnections(); fitWorkflow(); }
                    };
                    reader2.onerror = function() { appendWfLog('❌ 读取失败: ' + fileName, 'error'); };
                    reader2.readAsText(file);
                }
            })(file, idx);
        });
    }

    function addWfNode(type, x, y, name, config, extra) {
        wfPushHistory();
        // 确保ID唯一
        let id;
        do { id = 'wf_' + (++wfNodeId); } while (document.getElementById('wfNode_' + id));
        const node = {id: id, type: type, x: x - 60, y: y - 15, name: name, config: config || {}, extra: extra || {}};
        wfNodes.push(node);
        renderWfNode(node);
        updateWfInfo();
        autoSaveWorkflow();
        console.log('[WF] 创建节点:', id, type, name, 'at', node.x, node.y);
        return node;
    }

    function renderWfNode(node) {
        const canvas = document.getElementById('empWfCanvas');
        const el = document.createElement('div');
        el.className = 'emp-wf-node';
        el.id = 'wfNode_' + node.id;
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';

        let bodyHtml = '';
        if (node.type === 'target') {
            bodyHtml = '<div class="field"><input type="text" value="' + (node.config.目标||'') + '" placeholder="目标" oninput="window.empWidget._wfUpdateConfig(\'' + node.id + '\',\'目标\',this.value)"></div>' +
                       '<div class="field"><input type="number" value="' + (node.config.数量||3) + '" min="1" max="50" style="width:50px" oninput="window.empWidget._wfUpdateConfig(\'' + node.id + '\',\'数量\',this.value)"></div>';
        } else if (node.type === 'employee') {
            var toolIcon = '';
            // 检查员工是否启用工具调用
            var emp = employees.find(function(e) { return (e.name || e.姓名) === (node.config.员工名 || node.name); });
            if (emp && (emp.工具调用)) toolIcon = ' <span style="font-size:10px" title="工具调用">🔧</span>';
            bodyHtml = '<div class="field" style="color:var(--text2)">' + (node.extra.role || '') + toolIcon + '</div>' +
                       '<div class="field"><input type="text" value="' + (node.config.指令||'') + '" placeholder="指令(可选)" oninput="window.empWidget._wfUpdateConfig(\'' + node.id + '\',\'指令\',this.value)"></div>';
        } else if (node.type === 'print') {
            bodyHtml = '<div class="field" style="color:var(--text2)">显示上游输出</div>';
        } else if (node.type === 'input') {
            var 图标 = node.extra.图标 || '📄';
            var 文件名 = escapeHtml(node.config.文件名 || '');
            if (node.config.类型 === 'image') {
                var imgSrc = node.config.内容 || ('/api/image?path=' + encodeURIComponent(node.config.路径 || ''));
                bodyHtml = '<div class="wf-input-thumb"><img src="' + imgSrc + '" draggable="false" onerror="this.parentElement.innerHTML=\'<span class=wf-loading>❌</span>\'"></div>' +
                    '<div class="wf-input-name">' + 图标 + ' ' + 文件名 + '</div>';
            } else {
                bodyHtml = '<div class="wf-input-icon">' + 图标 + '</div>' +
                    '<div class="wf-input-name">' + 文件名 + '</div>';
            }
        }

        el.innerHTML =
            '<div class="emp-wf-port input" data-node="' + node.id + '"></div>' +
            '<div class="emp-wf-node-header" data-node="' + node.id + '">' +
                '<span class="name">' + node.name + '</span>' +
                '<span class="del" onclick="window.empWidget._wfDeleteNode(\'' + node.id + '\')">✕</span>' +
            '</div>' +
            '<div class="emp-wf-node-body">' + bodyHtml + '</div>' +
            '<div class="emp-wf-node-status" id="wfStatus_' + node.id + '"></div>' +
            '<div class="emp-wf-port output" data-node="' + node.id + '"></div>' +
            '<div class="wf-node-resize" data-node="' + node.id + '"></div>';

        canvas.appendChild(el);
        // 恢复节点尺寸
        if (node.w) el.style.width = node.w + 'px';
        if (node.h) el.style.height = node.h + 'px';

        // 节点右下角拖拽缩放
        var resizeHandle = el.querySelector('.wf-node-resize');
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', function(e) {
                e.stopPropagation();
                e.preventDefault();
                var startX = e.clientX, startY = e.clientY;
                var startW = el.offsetWidth, startH = el.offsetHeight;
                var nid = node.id;
                function onMove(ev) {
                    var nw = Math.max(120, startW + (ev.clientX - startX));
                    var nh = Math.max(60, startH + (ev.clientY - startY));
                    el.style.width = nw + 'px';
                    el.style.height = nh + 'px';
                    node.w = nw; node.h = nh;
                    // 缩略图高度跟随节点高度
                    var thumb = el.querySelector('.wf-input-thumb');
                    if (thumb) thumb.style.height = (nh - 70) + 'px';
                    redrawWfConnections();
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    autoSaveWorkflow(); wfPushHistory();
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
    }

    function redrawWfConnections() {
        const svg = document.getElementById('empWfSvg');
        if (!svg) return;
        svg.innerHTML = '';
        // 构建折叠frame的节点→frame位置映射
        var collapsedFramePos = {};
        wfFrames.forEach(function(f) {
            if (f.collapsed && f.nodeIds) {
                f.nodeIds.forEach(function(nid) { collapsedFramePos[nid] = f; });
            }
        });
        wfConns.forEach(function(c) {
            const fromEl = document.getElementById('wfNode_' + c.from);
            const toEl = document.getElementById('wfNode_' + c.to);
            if (!fromEl || !toEl) return;
            // 如果节点在折叠frame内，用frame位置替代
            var fromFrame = collapsedFramePos[c.from];
            var toFrame = collapsedFramePos[c.to];
            var fromRef = fromFrame ? document.getElementById('wfFrame_' + fromFrame.id) : fromEl;
            var toRef = toFrame ? document.getElementById('wfFrame_' + toFrame.id) : toEl;
            if (!fromRef || !toRef) return;
            const fromPort = fromEl.querySelector('.emp-wf-port.output');
            const toPort = toEl.querySelector('.emp-wf-port.input');
            const canvas = document.getElementById('empWfCanvas');
            const canvasRect = canvas.getBoundingClientRect();
            // 非折叠：用端口的实际位置（小球到小球）
            var fromRect, toRect;
            if (fromFrame) { fromRect = fromRef.getBoundingClientRect(); }
            else { fromRect = fromPort ? fromPort.getBoundingClientRect() : fromRef.getBoundingClientRect(); }
            if (toFrame) { toRect = toRef.getBoundingClientRect(); }
            else { toRect = toPort ? toPort.getBoundingClientRect() : toRef.getBoundingClientRect(); }
            // 如果折叠，连到frame右侧/左侧中心
            var x1, y1, x2, y2;
            if (fromFrame) { x1 = (fromRect.right - canvasRect.left) / wfZoom; y1 = (fromRect.top + fromRect.height/2 - canvasRect.top) / wfZoom; }
            else { x1 = (fromRect.left + fromRect.width/2 - canvasRect.left) / wfZoom; y1 = (fromRect.top + fromRect.height/2 - canvasRect.top) / wfZoom; }
            if (toFrame) { x2 = (toRect.left - canvasRect.left) / wfZoom; y2 = (toRect.top + toRect.height/2 - canvasRect.top) / wfZoom; }
            else { x2 = (toRect.left + toRect.width/2 - canvasRect.left) / wfZoom; y2 = (toRect.top + toRect.height/2 - canvasRect.top) / wfZoom; }
            const dx = Math.abs(x2 - x1) * 0.5;
            var dStr = 'M ' + x1 + ' ' + y1 + ' C ' + (x1+dx) + ' ' + y1 + ', ' + (x2-dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
            // 透明粗路径：扩大点击/双击区域
            var hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitPath.setAttribute('d', dStr);
            hitPath.setAttribute('stroke', 'transparent');
            hitPath.setAttribute('stroke-width', '16');
            hitPath.setAttribute('fill', 'none');
            hitPath.style.pointerEvents = 'stroke';
            hitPath.style.cursor = 'pointer';
            hitPath.dataset.from = c.from;
            hitPath.dataset.to = c.to;
            svg.appendChild(hitPath);
            // 可见路径
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', dStr);
            path.dataset.from = c.from;
            path.dataset.to = c.to;
            path.id = 'wfPath_' + c.from + '_' + c.to;
            path.style.pointerEvents = 'none';
            // 循环连线样式
            if (c.loop) {
                path.classList.add('loop');
                if (c.loop.type === 'for') path.setAttribute('stroke-dasharray', '6 3');
                else if (c.loop.type === 'while') path.setAttribute('stroke-dasharray', '3 3');
                path.style.stroke = '#E06C75';
            }
            svg.appendChild(path);
            if (!fromFrame && fromPort) fromPort.classList.add('connected');
            if (!toFrame && toPort) toPort.classList.add('connected');
        });
        // 清除未连接端口的标记
        document.querySelectorAll('.emp-wf-node').forEach(function(el) {
            const nid = el.id.replace('wfNode_', '');
            const hasIn = wfConns.some(function(c) { return c.to === nid; });
            const hasOut = wfConns.some(function(c) { return c.from === nid; });
            const inPort = el.querySelector('.emp-wf-port.input');
            const outPort = el.querySelector('.emp-wf-port.output');
            if (inPort && !hasIn) inPort.classList.remove('connected');
            if (outPort && !hasOut && wfConnectFrom !== nid) outPort.classList.remove('connected');
        });
    }

    function _showConnConfig(fromId, toId) {
        var conn = wfConns.find(function(c) { return c.from === fromId && c.to === toId; });
        if (!conn) return;
        var fromNode = wfNodes.find(function(n) { return n.id === fromId; });
        var toNode = wfNodes.find(function(n) { return n.id === toId; });
        var fromName = fromNode ? fromNode.name : fromId;
        var toName = toNode ? toNode.name : toId;
        var loop = conn.loop || {};
        var type = loop.type || 'none';
        var count = loop.count || 3;
        var condition = loop.condition || '';
        var maxLoop = loop.maxLoop || 10;

        var overlay = document.createElement('div');
        overlay.className = 'emp-chat-overlay';
        overlay.style.zIndex = '9800';
        overlay.innerHTML = '<div class="emp-chat-box" style="width:380px;height:400px">' +
            '<div class="emp-chat-header">' +
                '<div class="emp-avatar">🔗</div>' +
                '<div><div class="emp-name">连线设置</div><div class="emp-role">' + escapeHtml(fromName) + ' → ' + escapeHtml(toName) + '</div></div>' +
                '<div class="emp-chat-actions"><button class="emp-chat-btn" onclick="this.closest(\'.emp-chat-overlay\').remove()">✕</button></div>' +
            '</div>' +
            '<div class="emp-chat-body" style="padding:16px;gap:12px">' +
                '<div style="display:flex;flex-direction:column;gap:8px">' +
                    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer">' +
                        '<input type="radio" name="loopType" value="none" ' + (type==='none'?'checked':'') + '> 单次执行（默认）</label>' +
                    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer">' +
                        '<input type="radio" name="loopType" value="for" ' + (type==='for'?'checked':'') + '> 固定循环次数</label>' +
                    '<div id="forConfig" style="display:' + (type==='for'?'block':'none') + ';padding-left:24px">' +
                        '<label style="font-size:12px;color:var(--text2)">循环次数</label>' +
                        '<input type="number" id="loopCount" value="' + count + '" min="1" max="100" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-size:13px;margin-left:8px">' +
                        '<div style="font-size:11px;color:var(--text2);margin-top:4px">每轮输出累积追加，最终合并所有结果</div>' +
                    '</div>' +
                    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer">' +
                        '<input type="radio" name="loopType" value="while" ' + (type==='while'?'checked':'') + '> 条件循环（While）</label>' +
                    '<div id="whileConfig" style="display:' + (type==='while'?'block':'none') + ';padding-left:24px">' +
                        '<label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">判断条件（大白话）</label>' +
                        '<input type="text" id="loopCondition" value="' + escapeHtml(condition) + '" placeholder="如：评分是否大于8分" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:4px;font-size:13px">' +
                        '<label style="font-size:12px;color:var(--text2);display:block;margin-top:8px">最大循环次数（安全上限）</label>' +
                        '<input type="number" id="loopMaxLoop" value="' + maxLoop + '" min="1" max="50" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-size:13px;margin-top:4px">' +
                        '<div style="font-size:11px;color:var(--text2);margin-top:4px">每轮结束后AI判断条件，满足则跳出。超过最大次数强制停止。</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="emp-chat-input" style="justify-content:flex-end;padding:10px 16px">' +
                '<button class="emp-chat-btn" style="background:var(--blue);color:#fff;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:13px" onclick="window.empWidget._saveConnConfig(\'' + fromId + '\',\'' + toId + '\')">确定</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(overlay);
        overlay.classList.add('show');
        overlay.addEventListener('click', function(e) { if (e.target === this) this.remove(); });
        // radio切换显示/隐藏
        overlay.querySelectorAll('input[name="loopType"]').forEach(function(r) {
            r.addEventListener('change', function() {
                overlay.querySelector('#forConfig').style.display = this.value === 'for' ? 'block' : 'none';
                overlay.querySelector('#whileConfig').style.display = this.value === 'while' ? 'block' : 'none';
            });
        });
    }

    function _saveConnConfig(fromId, toId) {
        var conn = wfConns.find(function(c) { return c.from === fromId && c.to === toId; });
        if (!conn) return;
        var type = document.querySelector('input[name="loopType"]:checked');
        type = type ? type.value : 'none';
        if (type === 'none') {
            delete conn.loop;
        } else if (type === 'for') {
            conn.loop = {type: 'for', count: parseInt(document.getElementById('loopCount').value) || 3};
        } else if (type === 'while') {
            conn.loop = {type: 'while', condition: document.getElementById('loopCondition').value.trim(), maxLoop: parseInt(document.getElementById('loopMaxLoop').value) || 10};
        }
        var ov = document.querySelector('.emp-chat-overlay[style*="9800"]');
        if (ov) ov.remove();
        redrawWfConnections();
        autoSaveWorkflow();
        wfPushHistory();
        showToast('连线设置已保存', 'success');
    }

    function _wfAnimateConn(fromId, toId) {
        var path = document.getElementById('wfPath_' + fromId + '_' + toId);
        if (!path) return;
        // 用独立的overlay SVG，确保动画显示在节点之上
        var overlay = document.getElementById('empWfAnimOverlay');
        if (!overlay) return;
        var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', '#4EC9B0');
        circle.setAttribute('opacity', '0.95');
        circle.setAttribute('filter', 'drop-shadow(0 0 4px #4EC9B0)');
        var motion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
        motion.setAttribute('dur', '0.8s');
        motion.setAttribute('repeatCount', '1');
        motion.setAttribute('fill', 'freeze');
        var mpath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
        mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + path.id);
        motion.appendChild(mpath);
        circle.appendChild(motion);
        overlay.appendChild(circle);
        motion.beginElement();
        setTimeout(function() { if (circle.parentNode) circle.remove(); }, 900);
    }

    function updateWfInfo() {
        const info = document.getElementById('empWfInfo');
        if (info) info.textContent = '节点: ' + wfNodes.length + ' | 连接: ' + wfConns.length;
    }

    function openWorkflow() {
        const overlay = document.getElementById('empWfOverlay');
        const panel = document.getElementById('empWfPanel');
        overlay.classList.add('show');

        // 恢复面板位置和大小
        const saved = localStorage.getItem('empWfPanelState');
        if (saved) {
            try {
                const s = JSON.parse(saved);
                if (s.x != null && s.y != null) {
                    panel.style.left = s.x + 'px';
                    panel.style.top = s.y + 'px';
                    panel.style.transform = 'none';
                }
                if (s.w != null && s.h != null) {
                    panel.style.width = s.w + 'px';
                    panel.style.height = s.h + 'px';
                }
            } catch (e) {}
        }
        // 监听resize保存大小
        if (!panel._wfResizeBound) {
            panel._wfResizeBound = true;
            const ro = new ResizeObserver(function() {
                const rect = panel.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    const cur = JSON.parse(localStorage.getItem('empWfPanelState') || '{}');
                    cur.w = rect.width; cur.h = rect.height;
                    localStorage.setItem('empWfPanelState', JSON.stringify(cur));
                }
            });
            ro.observe(panel);
        }
        // 首次打开时自动载入保存的节点图
        if (wfNodes.length === 0) loadWorkflowAuto();
        redrawWfConnections();
    }

    function closeWorkflow() {
        document.getElementById('empWfOverlay').classList.remove('show');
    }

    function clearWorkflow() {
        wfPushHistory();
        wfNodes = [];
        wfConns = [];
        wfFrames = [];
        wfConnectFrom = null; wfConnectMode = null; wfConnectFromList = [];
        wfCurrentFileName = null;
        document.querySelectorAll('.emp-wf-node').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.wf-frame').forEach(function(el) { el.remove(); });
        redrawWfConnections();
        updateWfInfo();
        const fill = document.getElementById('empWfProgressFill');
        if (fill) fill.style.width = '0%';
        const text = document.getElementById('empWfProgressText');
        if (text) text.textContent = '0 / 0';
        autoSaveWorkflow();
    }

    function _wfDeleteNode(id) {
        wfPushHistory();
        _wfDeleteNodeNoHistory(id);
    }

    function _wfDeleteNodeNoHistory(id) {
        wfNodes = wfNodes.filter(function(n) { return n.id !== id; });
        wfConns = wfConns.filter(function(c) { return c.from !== id && c.to !== id; });
        const el = document.getElementById('wfNode_' + id);
        if (el) el.remove();
        redrawWfConnections();
        updateWfInfo();
    }

    function createWfFrame() {
        if (wfSelectedNodes.length === 0) { showToast('请先框选节点', 'info'); return; }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        wfSelectedNodes.forEach(function(nid) {
            const n = wfNodes.find(function(x) { return x.id === nid; });
            if (n) {
                // 用实际DOM尺寸，没有DOM就猜180x100
                const el = document.getElementById('wfNode_' + nid);
                const w = el ? el.offsetWidth : 180;
                const h = el ? el.offsetHeight : 100;
                minX = Math.min(minX, n.x);
                minY = Math.min(minY, n.y);
                maxX = Math.max(maxX, n.x + w);
                maxY = Math.max(maxY, n.y + h);
            }
        });
        const padding = 24;
        const headerH = 28;
        const frame = {
            id: 'frame_' + (++wfFrameId),
            x: minX - padding, y: minY - padding - headerH,
            w: maxX - minX + padding * 2, h: maxY - minY + padding * 2 + headerH,
            text: '分组', color: '#CE9178', collapsed: false,
            nodeIds: wfSelectedNodes.slice(),
            conns: wfConns.filter(function(c) {
                return wfSelectedNodes.includes(c.from) || wfSelectedNodes.includes(c.to);
            }).map(function(c) { return {from: c.from, to: c.to}; })
        };
        wfFrames.push(frame);
        renderWfFrame(frame);
        autoSaveWorkflow();
        showToast('已创建组: ' + frame.text, 'success');
    }

    function renderWfFrame(frame) {
        const canvas = document.getElementById('empWfCanvas');
        const old = document.getElementById('wfFrame_' + frame.id);
        if (old) old.remove();
        const el = document.createElement('div');
        el.className = 'wf-frame' + (frame.collapsed ? ' collapsed' : '');
        el.id = 'wfFrame_' + frame.id;
        el.dataset.id = frame.id;
        el.style.left = frame.x + 'px';
        el.style.top = frame.y + 'px';
        el.style.borderColor = frame.color || '#CE9178';
        const colorBg = (frame.color || '#CE9178') + '22';

        if (frame.collapsed) {
            el.style.width = '150px';
            el.style.height = 'auto';
            el.innerHTML = '<div class="wf-frame-header" style="background:' + colorBg + '">' +
                '<span class="wf-frame-icon">📦</span>' +
                '<span class="wf-frame-name-text" style="color:' + (frame.color || '#CE9178') + '">' + escapeHtml(frame.text) + '</span>' +
                '<button class="wf-frame-btn" onclick="event.stopPropagation();window.empWidget._wfRenameFrame(\'' + frame.id + '\')" title="重命名">✏️</button>' +
                '<button class="wf-frame-btn" onclick="event.stopPropagation();window.empWidget._wfToggleFrame(\'' + frame.id + '\')" title="展开">展开</button>' +
                '<button class="wf-frame-btn" onclick="event.stopPropagation();window.empWidget._wfDeleteFrame(\'' + frame.id + '\')" title="删除">删除</button>' +
            '</div>' +
            '<div style="padding:4px 8px;font-size:10px;color:var(--text2)">' + (frame.nodeIds ? frame.nodeIds.length : 0) + ' 个节点</div>';
        } else {
            el.style.width = frame.w + 'px';
            el.style.height = frame.h + 'px';
            el.innerHTML = '<div class="wf-frame-header" style="background:' + colorBg + '">' +
                '<span class="wf-frame-icon">📦</span>' +
                '<span class="wf-frame-name-text" style="color:' + (frame.color || '#CE9178') + '">' + escapeHtml(frame.text) + '</span>' +
                '<button class="wf-frame-btn" onclick="event.stopPropagation();window.empWidget._wfRenameFrame(\'' + frame.id + '\')" title="重命名">✏️</button>' +
                '<span class="wf-frame-color-single" style="background:' + (frame.color || '#CE9178') + '" onclick="event.stopPropagation();window.empWidget._wfCycleFrameColor(\'' + frame.id + '\')" title="点击切换颜色"></span>' +
                '<button class="wf-frame-btn" onclick="event.stopPropagation();window.empWidget._wfToggleFrame(\'' + frame.id + '\')" title="收缩">收缩</button>' +
                '<button class="wf-frame-btn" onclick="event.stopPropagation();window.empWidget._wfDeleteFrame(\'' + frame.id + '\')" title="删除">删除</button>' +
            '</div>' +
            '<div class="wf-frame-resize-t" data-resize="t" data-frame="' + frame.id + '"></div>' +
            '<div class="wf-frame-resize-r" data-resize="r" data-frame="' + frame.id + '"></div>' +
            '<div class="wf-frame-resize-b" data-resize="b" data-frame="' + frame.id + '"></div>' +
            '<div class="wf-frame-resize-l" data-resize="l" data-frame="' + frame.id + '"></div>' +
            '<div class="wf-frame-resize-tl" data-resize="tl" data-frame="' + frame.id + '"></div>' +
            '<div class="wf-frame-resize-tr" data-resize="tr" data-frame="' + frame.id + '"></div>' +
            '<div class="wf-frame-resize-bl" data-resize="bl" data-frame="' + frame.id + '"></div>' +
            '<div class="wf-frame-resize-br" data-resize="br" data-frame="' + frame.id + '"></div>';
        }
        canvas.insertBefore(el, canvas.firstChild);
        _bindFrameResize(el, frame);
    }

    var _wfFrameColors = ['#CE9178','#4EC9B0','#DCDCAA','#9CDCFE','#C586C0','#F44747','#61AFEF','#98C379'];
    function _wfCycleFrameColor(id) {
        var frame = wfFrames.find(function(f) { return f.id === id; });
        if (!frame) return;
        var idx = _wfFrameColors.indexOf(frame.color || '#CE9178');
        idx = (idx + 1) % _wfFrameColors.length;
        frame.color = _wfFrameColors[idx];
        renderWfFrame(frame);
        autoSaveWorkflow();
    }

    function _bindFrameResize(el, frame) {
        el.querySelectorAll('[data-resize]').forEach(function(handle) {
            handle.addEventListener('mousedown', function(e) {
                e.stopPropagation();
                e.preventDefault();
                var dir = handle.dataset.resize;
                var startX = e.clientX, startY = e.clientY;
                var startW = frame.w, startH = frame.h, startX0 = frame.x, startY0 = frame.y;
                function onMove(ev) {
                    var dx = ev.clientX - startX, dy = ev.clientY - startY;
                    if (dir === 'r' || dir === 'br' || dir === 'tr') frame.w = Math.max(120, startW + dx);
                    if (dir === 'b' || dir === 'br' || dir === 'bl') frame.h = Math.max(80, startH + dy);
                    if (dir === 'l' || dir === 'bl' || dir === 'tl') { var nw = Math.max(120, startW - dx); frame.x = startX0 + (startW - nw); frame.w = nw; }
                    if (dir === 't' || dir === 'tl' || dir === 'tr') { var nh = Math.max(80, startH - dy); frame.y = startY0 + (startH - nh); frame.h = nh; }
                    el.style.left = frame.x + 'px'; el.style.top = frame.y + 'px';
                    el.style.width = frame.w + 'px'; el.style.height = frame.h + 'px';
                    redrawWfConnections();
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    autoSaveWorkflow(); wfPushHistory();
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
    }

    function _wfToggleFrame(id) {
        const frame = wfFrames.find(function(f) { return f.id === id; });
        if (!frame) return;
        frame.collapsed = !frame.collapsed;
        // 收缩时隐藏内部节点，展开时显示
        if (frame.nodeIds) {
            frame.nodeIds.forEach(function(nid) {
                const el = document.getElementById('wfNode_' + nid);
                if (el) el.style.display = frame.collapsed ? 'none' : '';
            });
        }
        // 先渲染frame，再更新连线（确保折叠frame的DOM已更新）
        renderWfFrame(frame);
        // 用requestAnimationFrame确保DOM更新后再画线
        requestAnimationFrame(function() { redrawWfConnections(); });
        autoSaveWorkflow();
    }

    function _wfFrameColor(id, color) {
        const frame = wfFrames.find(function(f) { return f.id === id; });
        if (frame) { frame.color = color; renderWfFrame(frame); autoSaveWorkflow(); }
    }

    function _wfUpdateFrame(id, text) {
        const frame = wfFrames.find(function(f) { return f.id === id; });
        if (frame) { frame.text = text; autoSaveWorkflow(); }
    }

    function _wfRenameFrame(id) {
        var frame = wfFrames.find(function(f) { return f.id === id; });
        if (!frame) return;
        var newName = prompt('请输入分组名称：', frame.text);
        if (newName === null) return;
        newName = newName.trim();
        if (!newName) return;
        frame.text = newName;
        renderWfFrame(frame);
        autoSaveWorkflow();
    }

    function _wfDeleteFrame(id) {
        wfFrames = wfFrames.filter(function(f) { return f.id !== id; });
        const el = document.getElementById('wfFrame_' + id);
        if (el) el.remove();
        autoSaveWorkflow();
    }

    function getWfData() {
        return {nodes: wfNodes, conns: wfConns, frames: wfFrames, zoom: wfZoom, panX: wfPanX, panY: wfPanY};
    }

    let wfCurrentFileName = null;  // 当前保存的文件名

    function autoSaveWorkflow() {
        try { localStorage.setItem('empWfGraph', JSON.stringify(getWfData())); } catch(e) {}
        // 更新文件名显示
        const fnEl = document.getElementById('empWfFileName');
        if (fnEl) fnEl.textContent = wfCurrentFileName ? '📄 ' + wfCurrentFileName : '';
        // 如果已绑定文件名，同时保存到服务器
        if (wfCurrentFileName) {
            fetch('/api/wf-save', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({文件名: wfCurrentFileName, 图: getWfData()})
            }).catch(function() {});
        }
    }

    function loadWorkflowFromData(data) {
        clearWorkflow();
        // 仅当数据中包含 zoom/pan 时才恢复，否则保持默认视图
        if (data.zoom != null) wfZoom = data.zoom;
        if (data.panX != null) wfPanX = data.panX;
        if (data.panY != null) wfPanY = data.panY;
        applyWfTransform();
        (data.nodes || []).forEach(function(n, idx) {
            // 确保ID唯一：如果已存在则重新分配
            if (wfNodes.some(function(x) { return x.id === n.id; }) || document.getElementById('wfNode_' + n.id)) {
                n.id = 'wf_' + (++wfNodeId);
            }
            // 确保 extra 字段存在，否则 renderWfNode 会报错
            if (!n.extra) n.extra = {};
            if (!n.config) n.config = {};
            // 如果没有坐标，自动分散排列
            if (n.x == null || n.y == null) {
                var cols = Math.ceil(Math.sqrt((data.nodes || []).length));
                var col = idx % cols, row = Math.floor(idx / cols);
                n.x = col * 220 + 100;
                n.y = row * 160 + 100;
            }
            wfNodes.push(n);
            renderWfNode(n);
        });
        // 更新计数器为最大ID
        wfNodeId = Math.max(wfNodeId, ...wfNodes.map(function(n) {
            const m = n.id.match(/^wf_(\d+)$/);
            return m ? parseInt(m[1]) : 0;
        }), 0);
        wfConns = data.conns || [];
        wfFrames = data.frames || [];
        // 更新frame计数器
        wfFrameId = Math.max(wfFrameId, ...wfFrames.map(function(f) {
            const m = f.id.match(/^frame_(\d+)$/);
            return m ? parseInt(m[1]) : 0;
        }), 0);
        wfFrames.forEach(function(f) { renderWfFrame(f); });
        redrawWfConnections();
        updateWfInfo();
    }

    function loadWorkflowAuto() {
        const saved = localStorage.getItem('empWfGraph');
        if (saved) {
            try {
                loadWorkflowFromData(JSON.parse(saved));
            } catch(e) {}
        }
    }

    function saveWorkflow() {
        autoSaveWorkflow();
        showToast('已保存', 'success');
    }

    async function saveWorkflowFile() {
        if (wfCurrentFileName) {
            // 已有文件名，直接覆盖保存
            try {
                const resp = await fetch('/api/wf-save', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({文件名: wfCurrentFileName, 图: getWfData()})
                });
                const data = await resp.json();
                if (data.成功 || data.success) {
                    autoSaveWorkflow();
                    showToast('已覆盖保存: ' + wfCurrentFileName, 'success');
                } else { showToast('保存失败', 'error'); }
            } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
        } else {
            // 没有文件名，走另存为
            saveWorkflowAs();
        }
    }

    async function saveWorkflowAs() {
        const 文件名 = prompt('请输入保存名称：', wfCurrentFileName || '工作流_' + new Date().toISOString().slice(0,10));
        if (!文件名) return;
        try {
            const resp = await fetch('/api/wf-save', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({文件名: 文件名, 图: getWfData()})
            });
            const data = await resp.json();
            if (data.成功 || data.success) {
                wfCurrentFileName = 文件名;
                autoSaveWorkflow();
                showToast('已另存为: ' + 文件名, 'success');
            } else { showToast('保存失败', 'error'); }
        } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
    }

    async function loadWorkflowFile() {
        try {
            const resp = await fetch('/api/wf-load', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({})
            });
            const data = await resp.json();
            if (!(data.成功 || data.success)) { showToast('载入失败', 'error'); return; }
            const 列表 = data.列表 || [];
            if (列表.length === 0) { showToast('节点图目录为空', 'info'); return; }
            // 弹出选择列表
            const overlay = document.createElement('div');
            overlay.className = 'emp-chat-overlay';
            overlay.style.zIndex = '9300';
            let items = 列表.map(function(name) {
                return '<div class="wf-file-item" data-name="' + name + '">' +
                    '<span>📄 ' + name + '</span>' +
                    '<button class="wf-file-del" data-del="' + name + '">🗑️</button></div>';
            }).join('');
            overlay.innerHTML = '<div class="emp-chat-box" style="width:360px;height:420px">' +
                '<div class="emp-chat-header">' +
                    '<div class="emp-avatar">📂</div>' +
                    '<div><div class="emp-name">载入节点图</div><div class="emp-role">节点图/ 目录</div></div>' +
                    '<div class="emp-chat-actions"><button class="emp-chat-btn" onclick="this.closest(\'.emp-chat-overlay\').remove()">✕</button></div>' +
                '</div>' +
                '<div class="emp-chat-body" style="padding:8px" id="wfFileList">' + items + '</div>' +
            '</div>';
            document.body.appendChild(overlay);
            overlay.classList.add('show');
            overlay.addEventListener('click', function(e) {
                if (e.target === this) this.remove();
                const item = e.target.closest('.wf-file-item');
                if (item && !e.target.classList.contains('wf-file-del')) {
                    const name = item.dataset.name;
                    loadWfByName(name);
                    overlay.remove();
                }
                if (e.target.classList.contains('wf-file-del')) {
                    e.stopPropagation();
                    const name = e.target.dataset.del;
                    // 删除文件
                    fetch('/api/wf-delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({文件名: name})})
                    .then(function() { e.target.closest('.wf-file-item').remove(); });
                }
            });
        } catch(e) { showToast('载入失败: ' + e.message, 'error'); }
    }

    async function loadWfByName(name) {
        try {
            const resp = await fetch('/api/wf-load', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({文件名: name})
            });
            const data = await resp.json();
            if (data.成功 || data.success) {
                loadWorkflowFromData(data.图 || {});
                wfCurrentFileName = name;
                showToast('已载入 ' + name, 'success');
            } else { showToast('载入失败', 'error'); }
        } catch(e) { showToast('载入失败: ' + e.message, 'error'); }
    }

    async function exportWorkflow() {
        const data = JSON.stringify(getWfData(), null, 2);
        // 下载到本地
        const blob = new Blob([data], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '工作流_' + new Date().toISOString().slice(0,10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        // 同时保存到服务器节点图目录
        try {
            await fetch('/api/wf-save', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({文件名: '导出_' + new Date().toISOString().slice(0,10), 图: getWfData()})
            });
        } catch(e) {}
    }

    function importWorkflow(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                loadWorkflowFromData(data);
                autoSaveWorkflow();
                showToast('已载入', 'success');
            } catch(err) {
                showToast('文件格式错误', 'error');
            }
        };
        reader.readAsText(file);
        input.value = '';
    }

    function _wfUpdateConfig(id, key, value) {
        const node = wfNodes.find(function(n) { return n.id === id; });
        if (node) node.config[key] = value;
    }

    let wfRunning = false;
    let wfAbortController = null;

    async function executeWorkflow() {
        const execBtn = document.getElementById('empWfExec');
        // 执行中再次点击 = 停止
        if (wfRunning) {
            wfRunning = false;
            if (wfAbortController) wfAbortController.abort();
            appendWfLog('⏹ 已停止执行', 'error');
            execBtn.disabled = false;
            execBtn.textContent = '🚀 执行';
            return;
        }
        if (wfNodes.length === 0) { alert('请先添加节点'); return; }
        if (wfConns.length === 0) { alert('请先连线（至少一条连接才能执行）'); return; }
        // 收集画布上的节点位置
        const nodesData = wfNodes.map(function(n) {
            return {id: n.id, type: n.type, name: n.name, config: n.config, 员工名: n.config.员工名 || n.name};
        });
        const connsData = wfConns.map(function(c) {
            var d = {from: c.from, to: c.to};
            if (c.loop) d.loop = c.loop;
            return d;
        });

        // 重置状态：所有节点标记为待执行（灰色），移除之前的状态
        document.querySelectorAll('.emp-wf-node').forEach(function(el) {
            el.classList.remove('running', 'done', 'error', 'pending');
            el.classList.add('pending');
        });
        document.querySelectorAll('.emp-wf-node-status').forEach(function(el) {
            el.textContent = '⏸ 待执行'; el.className = 'emp-wf-node-status pending';
        });
        document.querySelectorAll('.emp-wf-node-result').forEach(function(el) { el.remove(); });
        wfRunning = true;
        execBtn.disabled = false;
        execBtn.textContent = '⏹ 停止';
        const logEl = document.getElementById('empWfLog');
        if (logEl) logEl.innerHTML = '';
        appendWfLog('🚀 工作流开始执行，共 ' + nodesData.length + ' 个节点', 'header');

        let wd = '';
        try { wd = currentRoot || ''; } catch(e) {}

        wfAbortController = new AbortController();
        try {
            const resp = await fetch('/api/employee-workflow', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({节点: nodesData, 连接: connsData, 当前文件夹: wd}),
                signal: wfAbortController.signal
            });

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let total = nodesData.length;
            let done = 0;

            while (wfRunning) {
                const {done: readerDone, value} = await reader.read();
                if (readerDone) break;
                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;
                    try {
                        const d = JSON.parse(trimmed.substring(6));
                        const type = d.类型 || d.type;
                        if (type === '调试') {
                            appendWfLog('⚠️ ' + (d.消息 || d.message || ''), 'error');
                        } else if (type === '节点开始') {
                            const el = document.getElementById('wfNode_' + d.id);
                            if (el) { el.classList.remove('pending'); el.classList.add('running'); }
                            const st = document.getElementById('wfStatus_' + d.id);
                            if (st) { st.textContent = '⏳ ' + d.name + ' 执行中...'; st.className = 'emp-wf-node-status running'; }
                            appendWfLog('⏳ ' + d.name + ' 开始执行', 'info');
                            // 连线小球动画：上游→当前节点
                            wfConns.filter(function(c) { return c.to === d.id; }).forEach(function(c) {
                                _wfAnimateConn(c.from, c.to);
                            });
                        } else if (type === '节点完成') {
                            const el = document.getElementById('wfNode_' + d.id);
                            if (el) { el.classList.remove('running'); el.classList.add(d.成功 !== false ? 'done' : 'error'); }
                            const st = document.getElementById('wfStatus_' + d.id);
                            if (st) {
                                st.textContent = d.成功 !== false ? '✅ 完成' : '❌ 失败';
                                st.className = 'emp-wf-node-status ' + (d.成功 !== false ? 'done' : 'error');
                            }
                            // 显示输入输出
                            showWfNodeResult(d.id, d.name, d.输入 || '', d.输出 || '', d.成功 !== false);
                            appendWfLog((d.成功 !== false ? '✅ ' : '❌ ') + d.name + (d.成功 !== false ? ' 完成' : ' 失败') + (d.输出 ? ': ' + d.输出.substring(0,60) : ''), d.成功 !== false ? 'success' : 'error');
                        } else if (type === '进度') {
                            done = d.已完成 || d.current || done + 1;
                            total = d.总数 || d.total || total;
                            const fill = document.getElementById('empWfProgressFill');
                            if (fill) fill.style.width = Math.round(done/total*100) + '%';
                            const text = document.getElementById('empWfProgressText');
                            if (text) text.textContent = done + ' / ' + total;
                        } else if (type === '循环轮次') {
                            appendWfLog('🔄 第' + (d.轮次||1) + '轮' + (d.总数 ? '/' + d.总数 + '轮' : '') + (d.信息 ? ' — ' + d.信息 : ''), 'header');
                            // 重置节点状态为pending，准备下一轮
                            if (d.重置) {
                                d.重置.forEach(function(nid) {
                                    var el = document.getElementById('wfNode_' + nid);
                                    if (el) { el.classList.remove('done', 'error'); el.classList.add('pending'); }
                                    var st = document.getElementById('wfStatus_' + nid);
                                    if (st) { st.textContent = '⏸ 第' + (d.轮次||1) + '轮等待'; st.className = 'emp-wf-node-status pending'; }
                                });
                            }
                        } else if (type === '循环结束') {
                            appendWfLog('✅ ' + (d.信息 || '循环结束'), 'success');
                            showToast(d.信息 || '循环结束', 'success');
                            // 循环连线发光动画
                            if (d.循环类型 === 'for' || d.循环类型 === 'while') {
                                // 找到所有循环连线，逐条高亮发光 + 小球动画
                                wfConns.forEach(function(c) {
                                    if (c.loop) {
                                        var path = document.getElementById('wfPath_' + c.from + '_' + c.to);
                                        if (path) {
                                            path.style.transition = 'all 0.3s';
                                            path.style.stroke = '#4EC9B0';
                                            path.style.strokeWidth = '4';
                                            path.style.filter = 'drop-shadow(0 0 8px #4EC9B0)';
                                            setTimeout(function() {
                                                path.style.stroke = '';
                                                path.style.strokeWidth = '';
                                                path.style.filter = '';
                                                path.style.transition = '';
                                            }, 1500);
                                        }
                                        // 最终小球滑过
                                        _wfAnimateConn(c.from, c.to);
                                    }
                                });
                                // 循环节点标记为最终完成
                                wfConns.forEach(function(c) {
                                    if (c.loop) {
                                        [c.from, c.to].forEach(function(nid) {
                                            var el = document.getElementById('wfNode_' + nid);
                                            if (el) { el.classList.remove('pending', 'running'); el.classList.add('done'); }
                                            var st = document.getElementById('wfStatus_' + nid);
                                            if (st) { st.textContent = '✅ 完成'; st.className = 'emp-wf-node-status done'; }
                                        });
                                    }
                                });
                                // 画布中央闪一个"循环完成"标记
                                var wrap = document.getElementById('empWfCanvasWrap');
                                if (wrap) {
                                    var badge = document.createElement('div');
                                    badge.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:50;font-size:24px;font-weight:bold;color:#4EC9B0;text-shadow:0 0 20px #4EC9B0;pointer-events:none;opacity:0;transition:opacity 0.3s';
                                    badge.textContent = d.循环类型 === 'for' ? '🔄 循环完成 ×' + (d.总轮次||'') : '✅ 条件满足，跳出';
                                    wrap.appendChild(badge);
                                    requestAnimationFrame(function() { badge.style.opacity = '1'; });
                                    setTimeout(function() {
                                        badge.style.opacity = '0';
                                        setTimeout(function() { badge.remove(); }, 300);
                                    }, 1800);
                                }
                            }
                        } else if (type === '完成') {
                            const fill = document.getElementById('empWfProgressFill');
                            if (fill) fill.style.width = '100%';
                            const text = document.getElementById('empWfProgressText');
                            if (text) text.textContent = total + ' / ' + total;
                            appendWfLog('🎉 工作流执行完成！', 'header');
                            showToast('✅ 工作流执行完成！', 'success');
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                appendWfLog('⏹ 执行已取消', 'error');
            } else {
                appendWfLog('❌ 连接失败: ' + e.message, 'error');
                showToast('连接失败: ' + e.message, 'error');
            }
        }

        wfRunning = false;
        wfAbortController = null;
        execBtn.disabled = false;
        execBtn.textContent = '🚀 执行';
    }

    function appendWfLog(msg, cls) {
        const log = document.getElementById('empWfLog');
        if (!log) return;
        const entry = document.createElement('div');
        entry.className = 'wf-log-entry' + (cls ? ' ' + cls : '');
        entry.textContent = msg;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    function showWfNodeResult(nodeId, name, input, output, success) {
        const el = document.getElementById('wfNode_' + nodeId);
        if (!el) return;
        // 存储结果到节点数据上，点击时弹出
        const node = wfNodes.find(function(n) { return n.id === nodeId; });
        if (node) {
            node._result = {input: input, output: output, success: success};
        }
        // 节点底部显示简短状态
        const old = el.querySelector('.emp-wf-node-result');
        if (old) old.remove();
        const result = document.createElement('div');
        result.className = 'emp-wf-node-result';
        if (output) {
            const trunc = output.length > 50 ? output.substring(0, 50) + '...' : output;
            result.innerHTML = '<div class="wf-result-summary" onclick="window.empWidget._wfShowNodeDetail(\'' + nodeId + '\')">' +
                '<span class="wf-result-label ' + (success ? '' : 'error') + '">' + (success ? '✅' : '❌') + '</span>' +
                '<span class="wf-result-text">' + escapeHtml(trunc) + '</span></div>';
        }
        el.appendChild(result);

        // 如果该节点的详情弹窗正打开着，自动刷新内容
        const popup = document.querySelector('.wf-popup');
        if (popup && popup.dataset.nodeId === nodeId) {
            _wfShowNodeDetail(nodeId, null, null);
        }
    }

    function _wfShowNodeDetail(nodeId, mouseX, mouseY) {
        const node = wfNodes.find(function(n) { return n.id === nodeId; });
        if (!node) return;
        const r = node._result || {input: '', output: '', success: null};
        let html = '';
        if (r.input) {
            html += '<div style="margin-bottom:12px"><div style="font-size:12px;color:var(--text2);margin-bottom:4px">⬇️ 输入</div><div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;white-space:pre-wrap;font-size:13px;max-height:200px;overflow-y:auto">' + escapeHtml(r.input) + '</div></div>';
        }
        if (r.output) {
            html += '<div><div style="font-size:12px;color:var(--text2);margin-bottom:4px">⬆️ 输出</div><div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;white-space:pre-wrap;font-size:13px;max-height:300px;overflow-y:auto">' + (typeof marked !== 'undefined' ? marked.parse(r.output) : escapeHtml(r.output)) + '</div></div>';
        }
        if (!html) html = '<div style="color:var(--text2);text-align:center;padding:40px">该节点尚未执行，暂无输入输出数据<br><br>请点击底部"🚀执行"按钮运行工作流</div>';
        const popup = showWfPopup(node.name + ' — 节点详情', html, mouseX, mouseY);
        if (popup) popup.dataset.nodeId = nodeId;
    }

    function _wfShowFull(field, nodeId) {
        const el = document.querySelector('#wfNode_' + nodeId + ' .emp-wf-node-result');
        if (!el) return;
        const content = el.dataset[field.toLowerCase()] || '';
        const node = wfNodes.find(function(n) { return n.id === nodeId; });
        const title = (node ? node.name : nodeId) + ' - ' + field;
        showWfPopup(title, content);
    }

    function showWfPopup(title, content, mouseX, mouseY) {
        // 同一时间只允许一个弹窗
        const existing = document.querySelector('.wf-popup');
        // 记录旧弹窗位置（用于自动刷新时保持位置）
        let oldX = null, oldY = null;
        if (existing) {
            oldX = parseInt(existing.style.left) || null;
            oldY = parseInt(existing.style.top) || null;
            existing.remove();
        }
        const box = document.createElement('div');
        box.className = 'wf-popup';
        box.innerHTML = '<div class="wf-popup-header" id="wfPopupHeader">' +
                '<span class="wf-popup-title">' + title + '</span>' +
                '<button class="wf-popup-close" onclick="var p=this.closest(\'.wf-popup\'); p.classList.remove(\'show\'); setTimeout(function(){p.remove();},200)">✕</button>' +
            '</div>' +
            '<div class="wf-popup-body">' +
                content +
            '</div>';
        document.body.appendChild(box);

        // 触发渐入动画
        requestAnimationFrame(function() { box.classList.add('show'); });

        // 恢复上次弹窗位置和大小（优先使用保存的位置，而非鼠标位置）
        var savedPopup = null;
        try { savedPopup = JSON.parse(localStorage.getItem('wfPopupState') || '{}'); } catch(e) {}
        const hasSaved = savedPopup.x != null;
        const x = hasSaved ? savedPopup.x : (mouseX != null ? mouseX : (window.innerWidth - 360) / 2);
        const y = hasSaved ? savedPopup.y : (mouseY != null ? mouseY : (window.innerHeight - 300) / 2);
        box.style.left = Math.min(x, window.innerWidth - 200) + 'px';
        box.style.top = Math.min(y, window.innerHeight - 100) + 'px';
        if (savedPopup.w) box.style.width = savedPopup.w + 'px';
        if (savedPopup.h) box.style.height = savedPopup.h + 'px';

        // 拖拽移动 → 保存位置
        const header = box.querySelector('.wf-popup-header');
        header.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            const startX = e.clientX, startY = e.clientY;
            const rect = box.getBoundingClientRect();
            function onMove(ev) {
                box.style.left = Math.max(0, Math.min(window.innerWidth - rect.width, rect.left + ev.clientX - startX)) + 'px';
                box.style.top = Math.max(0, Math.min(window.innerHeight - rect.height, rect.top + ev.clientY - startY)) + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                // 保存位置
                try { localStorage.setItem('wfPopupState', JSON.stringify({x: parseInt(box.style.left), y: parseInt(box.style.top), w: box.offsetWidth, h: box.offsetHeight})); } catch(e) {}
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // resize监听 → 保存大小
        if (window.ResizeObserver) {
            var ro = new ResizeObserver(function() {
                try { localStorage.setItem('wfPopupState', JSON.stringify({x: parseInt(box.style.left), y: parseInt(box.style.top), w: box.offsetWidth, h: box.offsetHeight})); } catch(e) {}
            });
            ro.observe(box);
        }

        return box;
    }

    function _toggleTtsSettings(引擎) {
        const local = document.getElementById('editTtsLocal');
        const edge = document.getElementById('editTtsEdge');
        if (!local || !edge) return;
        local.style.display = 引擎 === '本地' ? 'block' : 'none';
        edge.style.display = 引擎 === 'edge' ? 'block' : 'none';
    }

    function _testEmpTTS() {
        fetch('/api/tts', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({文本: '你好，这是该员工的语音测试。', 音量: 100, 员工名: document.getElementById('editName')?.value || ''})
        }).catch(() => {});
    }

    window.empWidget = {
        init: init, togglePanel: togglePanel, refresh: refresh,
        selectEmployee: selectEmployee, openChat: openChat, closeChat: closeChat,
        sendChat: sendChat, addEmployee: addEmployee,
        editEmployee: editEmployee, deleteEmployee: deleteEmployee,
        clearChat: clearChat, deleteMessage: deleteMessage,
        showContextMenu: showContextMenu, closeContextMenu: closeContextMenu,
        setBossPrompt: setBossPrompt, clearSuperiors: clearSuperiors, clearSubordinates: clearSubordinates,
        openEditPanel: openEditPanel, saveEdit: saveEdit,
        openCreatePanel: openCreatePanel, saveCreate: saveCreate,
        generatePersona: generatePersona,
        openWorkflow: openWorkflow, closeWorkflow: closeWorkflow, clearWorkflow: clearWorkflow,
        executeWorkflow: executeWorkflow, _wfDeleteNode: _wfDeleteNode, _wfUpdateConfig: _wfUpdateConfig,
        _wfShowFull: _wfShowFull,
        _wfShowNodeDetail: _wfShowNodeDetail,
        _wfUpdateFrame: _wfUpdateFrame, _wfDeleteFrame: _wfDeleteFrame,
        _wfToggleFrame: _wfToggleFrame, _wfFrameColor: _wfFrameColor, _wfCycleFrameColor: _wfCycleFrameColor, _wfRenameFrame: _wfRenameFrame, createWfFrame: createWfFrame,
        saveWorkflow: saveWorkflow, exportWorkflow: exportWorkflow, importWorkflow: importWorkflow,
        saveWorkflowFile: saveWorkflowFile, saveWorkflowAs: saveWorkflowAs, loadWorkflowFile: loadWorkflowFile,
        fitWorkflow: fitWorkflow, autoLayout: autoLayout, autoDesign: autoDesign,
        _addCategory: _addCategory, _deleteCategory: _deleteCategory, _toggleCategory: _toggleCategory, _updateCategoryName: _updateCategoryName, _updateCategoryColor: _updateCategoryColor,
        _renameCategory: _renameCategory, _confirmRenameCategory: _confirmRenameCategory, _cycleCategoryColor: _cycleCategoryColor,
        _toggleTtsSettings: _toggleTtsSettings, _testEmpTTS: _testEmpTTS,
        _closeWfMenu: function() { var m = document.getElementById('empWfMenu'); if (m) m.style.display = 'none'; },
        _closeFileMenu: function() { var m = document.getElementById('empWfFileMenu'); if (m) m.style.display = 'none'; },
        _toggleScissors: _toggleScissors,
        _saveConnConfig: _saveConnConfig,
        wfUndo: wfUndo, wfRedo: wfRedo
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { init(); startNotifyPolling(); startPanelRefresh(); bindDragDrop(); document.addEventListener('click', closeContextMenu); });
    } else {
        init(); startNotifyPolling(); startPanelRefresh(); bindDragDrop(); document.addEventListener('click', closeContextMenu);
    }
    // 关闭页面前自动保存
    window.addEventListener('beforeunload', function() { autoSaveWorkflow(); });
})();
