/* ============================================================
 * chatbox-roles.js —— 角色注入 / 角色面板 v3
 * - 头部按钮（工具按钮左侧）显示当前角色头像；无角色时默认 🎭
 * - 面板 = 角色列表（左侧弹出），可拖拽、可缩放，关闭即关
 * - 点角色 = 本对话注入该角色；双击角色或点「新对话」= 开一个该角色的新对话
 * - 对话记住自己的角色（服务端按 box_id 长期保存 + 本地兜底）
 * - 新建/编辑角色：名称 + 头像 emoji 选择器 + 提示词 + ✨AI 生成
 * ============================================================ */
(function () {
    'use strict';
    window.App = window.App || {};

    var boxIdOf = function (box) {
        if (!box) return 'default';
        return box.dataset.boxId || box.id || 'default';
    };

    /* ---------- 自定义轻量弹窗（替代 window.prompt / confirm） ---------- */
    function _dlgMask() {
        var mask = document.createElement('div');
        mask.className = 'zf-dlg-mask';
        mask.innerHTML =
            '<div class="zf-dlg">' +
            '<div class="zf-dlg-title"></div>' +
            '<div class="zf-dlg-body"></div>' +
            '<div class="zf-dlg-btns"><button class="zf-dlg-cancel">取消</button><button class="zf-dlg-ok">确定</button></div>' +
            '</div>';
        mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
        function close() { mask.remove(); }
        document.body.appendChild(mask);
        return mask;
    }
    /* 文本输入弹窗：askText(title, label, defVal, cb(val|null)) */
    function askText(title, label, defVal, cb) {
        var mask = _dlgMask();
        mask.querySelector('.zf-dlg-title').textContent = title;
        mask.querySelector('.zf-dlg-body').innerHTML =
            '<label class="zf-dlg-label">' + label + '</label>' +
            '<input class="zf-dlg-input" type="text">';
        var input = mask.querySelector('.zf-dlg-input');
        input.value = defVal || '';
        var done = false;
        function ok() {
            if (done) return; done = true;
            var v = input.value.trim();
            mask.remove();
            cb(v === '' ? null : v);
        }
        function cancel() {
            if (done) return; done = true;
            mask.remove();
            cb(null);
        }
        mask.querySelector('.zf-dlg-ok').onclick = ok;
        mask.querySelector('.zf-dlg-cancel').onclick = cancel;
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); ok(); }
            if (e.key === 'Escape') cancel();
        });
        setTimeout(function () { input.focus(); input.select(); }, 30);
    }
    /* 确认弹窗：askConfirm(title, msg, cb(true|false)) */
    function askConfirm(title, msg, cb) {
        var mask = _dlgMask();
        mask.querySelector('.zf-dlg-title').textContent = title;
        mask.querySelector('.zf-dlg-body').innerHTML = '<div class="zf-dlg-msg">' + msg + '</div>';
        mask.querySelector('.zf-dlg-input, .zf-dlg-label') && null;
        var done = false;
        function ok() { if (done) return; done = true; mask.remove(); cb(true); }
        function cancel() { if (done) return; done = true; mask.remove(); cb(false); }
        mask.querySelector('.zf-dlg-ok').onclick = ok;
        mask.querySelector('.zf-dlg-cancel').onclick = cancel;
        mask.querySelector('.zf-dlg-cancel').focus();
        mask.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') cancel();
        });
    }

    /* ---------- 角色列表缓存：内存 + localStorage 持久化，秒开 + 后台静默刷新 ---------- */
    var _rolesCache = { ts: 0, box: '', data: null };
    try {
        var _saved = JSON.parse(localStorage.getItem('zf_roles_cache') || 'null');
        if (_saved && _saved.data && _saved.data.ok) _rolesCache = _saved;
    } catch (e) {}
    function _cacheSave() {
        try { localStorage.setItem('zf_roles_cache', JSON.stringify(_rolesCache)); } catch (e) {}
    }
    function apiGet(box, cb, opts) {
        var bid = boxIdOf(box);
        var now = Date.now();
        if (!opts || !opts.force) {
            if (_rolesCache.data && _rolesCache.box === bid && (now - _rolesCache.ts) < 60000) {
                cb(_rolesCache.data);   // 缓存命中：立即渲染
                if ((now - _rolesCache.ts) > 5000) {   // 超 5 秒后台静默刷新（拿到新数据后重绘，保证删除/拖拽后界面同步）
                    apiGet(box, function (fresh) { if (fresh && fresh.ok) { _rolesCache = { ts: Date.now(), box: bid, data: fresh }; _cacheSave(); cb(fresh); } }, { force: true });
                }
                return;
            }
        }
        /* 有旧缓存（哪怕过期/别的 box）：先回旧数据秒开，再后台拉新 */
        if (_rolesCache.data && !opts) {
            cb(_rolesCache.data);
        }
        /* 【性能优化】在途请求共享：连续多次调用（面板打开时 render 可能触发多次）只发一次网络请求 */
        if (apiGet._pending) { apiGet._pending.then(cb); return; }
        var p = fetch('/api/roles?box=' + encodeURIComponent(bid))
            .then(function (r) { return r.json(); })
            .then(function (res) { if (res && res.ok) { _rolesCache = { ts: Date.now(), box: bid, data: res }; _cacheSave(); } cb(res); })
            .catch(function () { cb({ ok: false, roles: [], selected_id: '' }); })
            .finally(function () { apiGet._pending = null; });
        apiGet._pending = p;
    }
    function apiPost(data, cb) {
        fetch('/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(function (r) { return r.json(); })
          .then(function (res) {
              /* 任何写操作后立即失效缓存，下次 render 强制拉最新数据（修复删除/拖拽后不刷新） */
              _rolesCache = { ts: 0, box: '', data: null };
              try { localStorage.removeItem('zf_roles_cache'); } catch (e) {}
              cb(res);
          }).catch(function () { cb({ ok: false }); });
    }

    /* ---------- 本地记忆：对话 ↔ 角色（服务端为主，这里兜底刷新头像） ---------- */
    function localRoleOf(boxId) {
        try { return JSON.parse(localStorage.getItem('zf_role_chat_' + boxId) || 'null'); } catch (e) { return null; }
    }
    function localRoleSet(boxId, role) {
        try {
            if (role) {
                /* 兜底：传入角色缺 chat_skin（如来自旧缓存）时，沿用本框已存的皮肤，避免切换回来皮肤丢失 */
                var prev = null;
                try { prev = JSON.parse(localStorage.getItem('zf_role_chat_' + boxId) || 'null'); } catch (e) {}
                var skin = (role.chat_skin !== undefined && role.chat_skin !== '') ? role.chat_skin
                    : ((prev && String(prev.id) === String(role.id)) ? (prev.chat_skin || '') : (role.chat_skin || ''));
                localStorage.setItem('zf_role_chat_' + boxId, JSON.stringify({ id: role.id, name: role.name, avatar: role.avatar, prompt: role.prompt || '', chat_skin: skin }));
            }
            else localStorage.removeItem('zf_role_chat_' + boxId);
        } catch (e) {}
    }

    /* ---------- 编辑角色后：让所有绑定该角色的对话框立即继承新界面 ---------- */
    /* 遍历页面上所有 .chatbox，凡本地记忆（或 DOM 标记）里是该角色的，
       就把新名字/头像/皮肤写回本地记忆，并刷新角色徽标 + 重新贴皮肤 + 更新标题。
       这样无需刷新页面、无需重新点选，所有该角色的对话界面直接继承最新编辑。 */
    function _syncAllRoleBoxes(roleId, patch) {
        if (!roleId) return 0;
        patch = patch || {};
        var boxes = document.querySelectorAll('.chatbox');
        var n = 0;
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            if (!box || !box.querySelector) continue;
            var bid = boxIdOf(box);
            var lr = localRoleOf(bid);
            /* 判定是否绑定该角色：本地记忆命中，或 DOM 上的 data-role-id 命中 */
            var matched = (lr && String(lr.id) === String(roleId)) ||
                          (box.getAttribute && box.getAttribute('data-role-id') === String(roleId));
            if (!matched) continue;
            var merged = {
                id: String(roleId),
                name: patch.name || (lr && lr.name) || '',
                avatar: patch.avatar || (lr && lr.avatar) || '??',
                prompt: (lr && lr.prompt) || '',
                chat_skin: patch.chat_skin !== undefined ? patch.chat_skin : ((lr && lr.chat_skin) || '')
            };
            localRoleSet(bid, merged);
            try {
                if (window.Theme && typeof Theme.applyToBox === 'function') Theme.applyToBox(box, merged.chat_skin || '');
                if (box.setAttribute) {
                    if (merged.chat_skin) box.setAttribute('data-role-skin', '1');
                    else box.removeAttribute('data-role-skin');
                }
            } catch (e) {}
            if (App._refreshRoleBadge) App._refreshRoleBadge(box);
            /* 标题里的「头像 角色名 · #序号」同步更新 */
            try {
                var seq = box.getAttribute && box.getAttribute('data-role-seq');
                var titleEl = box.querySelector('.chatbox-header-row1 .title') || box.querySelector('.chatbox-header .title');
                if (titleEl && seq) {
                    titleEl.textContent = (merged.avatar ? merged.avatar + ' ' : '') + (merged.name || '角色') + ' · #' + seq;
                }
            } catch (e) {}
            n++;
        }
        return n;
    }
    App._syncAllRoleBoxes = _syncAllRoleBoxes;

    /* ---------- 头部角色按钮刷新 ---------- */
    App._refreshRoleBadge = function (box) {
        if (!box || !box.querySelector) return;
        var btn = box.querySelector('.role-btn');
        var lr = localRoleOf(boxIdOf(box));
        /* 角色皮肤：只作用于本对话框容器，与全局 body/面板风格互不影响 */
        try {
            if (window.Theme && typeof Theme.applyToBox === 'function') {
                Theme.applyToBox(box, (lr && lr.chat_skin) || '');
            }
        } catch (e) {}
        /* 兜底：标记「本框已有角色独立界面」，整体界面方案切换时不再被改写 */
        try {
            if (box && box.setAttribute) {
                if (lr && lr.chat_skin) box.setAttribute('data-role-skin', '1');
                else box.removeAttribute('data-role-skin');
            }
        } catch (e) {}
        if (btn) {
            btn.textContent = (lr && lr.avatar) || '🎭';
            btn.title = (lr && lr.name) ? ('当前角色：' + lr.name + '（点击管理角色）') : '注入角色：为本对话绑定一个角色提示词';
        }
        /* 标题左侧显示当前角色头像（点击打开角色面板；无角色时也显示默认 🎭） */
        var titleEl = box.querySelector('.chatbox-header-row1 .title') || box.querySelector('.chatbox-header .title');
        if (titleEl) {
            var avId = 'chat-role-avatar';
            var av = box.querySelector('#' + avId);
            var avatar = (lr && lr.avatar) || '🎭';
            if (!av) {
                av = document.createElement('span');
                av.id = avId;
                av.className = 'chat-role-avatar';
                av.style.cursor = 'pointer';
                av.onclick = function () {
                    if (typeof App !== 'undefined' && typeof App.rolesOpenPanel === 'function') App.rolesOpenPanel(box);
                };
                titleEl.parentNode.insertBefore(av, titleEl);
            }
            av.textContent = avatar;
            av.title = lr && lr.name ? ('当前角色：' + lr.name + '（点击管理角色）') : '注入角色：为本对话绑定一个角色提示词';
        }
    };

    /* ---------- 图标选择器（emoji 网格） ---------- */
    var AVATAR_LIST = ('🎭 🐶 🐱 🦊 🐼 🐯 🦁 🐸 🐵 🐔 🦉 🐺 🐴 🦄 🐷 🐮 🐹 🐰 🐻 🐨 ' +
        '🤖 👻 👽 🧙 🧚 🧛 🧜 🧟 🎩 👑 🎓 🦸 🥷 🤠 👸 🤴 ' +
        '⚽ 🎮 🎨 🎸 🚀 🛸 ⚡ 🔥 🌟 💎 🍕 🌸 🌊 🏔️ 📚 💻 🔬 🩺 ⚖️ 🧭 🎯').split(/\s+/);

    function buildAvatarPicker(container, input) {
        var grid = document.createElement('div');
        grid.className = 're-avatar-grid';
        AVATAR_LIST.forEach(function (em) {
            var cell = document.createElement('span');
            cell.className = 're-avatar-cell';
            cell.textContent = em;
            cell.onclick = function () {
                input.value = em;
                grid.querySelectorAll('.re-avatar-cell').forEach(function (c) { c.classList.remove('on'); });
                cell.classList.add('on');
            };
            grid.appendChild(cell);
        });
        container.parentNode.insertBefore(grid, container.nextSibling);
        return grid;
    }

    /* ---------- 编辑弹窗（新建 / 修改） ---------- */
    function openRoleEditor(box, role, onDone) {
        var old = document.getElementById('role-editor-mask');
        if (old) old.remove();
        var mask = document.createElement('div');
        mask.id = 'role-editor-mask';
        mask.innerHTML =
            '<div class="role-editor">' +
            '<div class="re-head">' + (role ? '编辑角色' : '新建角色') + '<span class="re-close">✕</span></div>' +
            '<div class="re-body">' +
            '<label>角色名</label>' +
            '<input id="re-name" maxlength="30" placeholder="例如：资深3D建模师" value="' + (role ? (role.name || '').replace(/"/g, '&quot;') : '') + '">' +
            '<label>头像 Emoji（点击下方图标选择，也可手输）</label>' +
            '<input id="re-avatar" maxlength="8" placeholder="🎭" value="' + (role ? (role.avatar || '') : '') + '">' +
            '<label>角色提示词（跟随本对话每一句上下文）</label>' +
            '<textarea id="re-prompt" rows="6" placeholder="例如：你是一名资深3D建模师，说话直接专业…"></textarea>' +
            '<div class="re-row"><button class="re-ai" type="button">✨ AI 生成描述</button><span class="re-hint">填好角色名后点我，AI 自动填充提示词，可人工修改</span></div>' +
            '<label>对话框皮肤（该角色被选中时对话框风格，留空=跟随全局）</label>' +
            '<div id="re-skin" class="re-skin-grid"></div>' +
            '</div>' +
            '<div class="re-foot"><button class="re-save">确定</button></div>' +
            '</div>';
        document.body.appendChild(mask);
        /* ---------- 对话框可拖拽 / 可缩放 / 记住位置大小 ---------- */
        (function () {
            var dlg = mask.querySelector('.role-editor');
            var head = mask.querySelector('.re-head');
            var LSK = 'zf_role_editor_geom';
            // 恢复上次位置与大小
            try {
                var g = JSON.parse(localStorage.getItem(LSK) || 'null');
                if (g && g.w && g.h) {
                    dlg.style.width = g.w + 'px';
                    /* 恢复大小时高度也不得超过视口，否则「确定」按钮又跑出屏幕 */
                    dlg.style.height = Math.min(g.h, Math.max(260, window.innerHeight - 40)) + 'px';
                    dlg.style.maxHeight = (Math.max(260, window.innerHeight - 40)) + 'px';
                    if (g.left != null && g.top != null) {
                        dlg.style.position = 'fixed';
                        dlg.style.left = Math.max(0, Math.min(g.left, window.innerWidth - 80)) + 'px';
                        dlg.style.top = Math.max(0, Math.min(g.top, window.innerHeight - 60)) + 'px';
                        mask.style.alignItems = 'flex-start';
                        mask.style.justifyContent = 'flex-start';
                    }
                }
            } catch (e) {}
            function saveGeom() {
                try {
                    var r = dlg.getBoundingClientRect();
                    localStorage.setItem(LSK, JSON.stringify({
                        w: Math.round(r.width), h: Math.round(r.height),
                        left: Math.round(r.left), top: Math.round(r.top)
                    }));
                } catch (e) {}
            }
            // 拖拽（按住标题栏移动）
            head.style.cursor = 'move';
            head.style.userSelect = 'none';
            var drag = null;
            head.addEventListener('mousedown', function (e) {
                if (e.target === head.querySelector('.re-close')) return;
                var r = dlg.getBoundingClientRect();
                // 首次拖拽时把居中的盒子转为 fixed 定位
                dlg.style.position = 'fixed';
                dlg.style.left = r.left + 'px';
                dlg.style.top = r.top + 'px';
                /* 拖拽转 fixed 后仍锁高度上限，保证底部「确定」按钮始终可见可点 */
                dlg.style.maxHeight = (Math.max(260, window.innerHeight - 40)) + 'px';
                mask.style.alignItems = 'flex-start';
                mask.style.justifyContent = 'flex-start';
                drag = { sx: e.clientX, sy: e.clientY, ol: r.left, ot: r.top };
                e.preventDefault();
            });
            // 缩放（右下角手柄）
            var rz = document.createElement('div');
            rz.style.cssText = 'position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:10;';
            rz.innerHTML = '<svg width="16" height="16"><path d="M14 6 L6 14 M14 10 L10 14" stroke="#9aa4bb" stroke-width="1.5" fill="none"/></svg>';
            dlg.style.position = dlg.style.position || 'relative';
            /* 注意：这里不能再写 dlg.style.overflow='hidden'，
               否则会把 .re-body 的 flex:1 + overflow-y:auto 一起干掉，
               弹窗内容变高时无法滚动、底部的"确定"按钮被挤到屏幕外点不到。
               滚动交给 .re-body 自己处理（见 chatbox-roles.css）。 */
            dlg.appendChild(rz);
            var rsz = null;
            rz.addEventListener('mousedown', function (e) {
                var r = dlg.getBoundingClientRect();
                rsz = { sx: e.clientX, sy: e.clientY, ow: r.width, oh: r.height };
                e.preventDefault(); e.stopPropagation();
            });
            document.addEventListener('mousemove', function (e) {
                if (drag) {
                    dlg.style.left = Math.max(-dlg.offsetWidth + 80, drag.ol + e.clientX - drag.sx) + 'px';
                    dlg.style.top = Math.max(0, drag.ot + e.clientY - drag.sy) + 'px';
                } else if (rsz) {
                    /* 缩放时高度上限锁定视口，避免把「确定」按钮挤出屏幕看不到 */
                    dlg.style.width = Math.max(360, rsz.ow + e.clientX - rsz.sx) + 'px';
                    var maxH = Math.max(260, window.innerHeight - 40);
                    dlg.style.height = Math.min(Math.max(260, rsz.oh + e.clientY - rsz.sy), maxH) + 'px';
                    dlg.style.maxHeight = maxH + 'px';
                }
            });
            document.addEventListener('mouseup', function () {
                if (drag || rsz) { drag = null; rsz = null; saveGeom(); }
            });
        })();
        if (role) mask.querySelector('#re-prompt').value = role.prompt || '';
        // 皮肤宫格容器样式（卡片/预览样式复用 theme.js 注入的 zfStyleGridStyle）
        if (!document.getElementById('reSkinGridStyle')) {
            var sst = document.createElement('style');
            sst.id = 'reSkinGridStyle';
            sst.textContent = '.re-skin-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-height:180px;overflow-y:auto;padding:2px;margin-bottom:8px;}';
            document.head.appendChild(sst);
        }
        // 对话框皮肤宫格：复用主题面板的图片卡片样式（底色 + 卡片条 + 强调点）
        (function () {
            var wrap = mask.querySelector('#re-skin');
            var styles = (window.Theme && window.Theme.styles) || [];
            function mkCard(val, name, vars) {
                var card = document.createElement('div');
                card.className = 'zf-style-card re-skin-card';
                card.setAttribute('data-style', val);
                if (vars) {
                    var p = document.createElement('div');
                    p.className = 'zs-preview';
                    p.style.background = vars.bg;
                    p.innerHTML = '<div class="zs-bar" style="background:' + vars.card + ';border:1px solid ' + vars.border + '"></div>' +
                                  '<div class="zs-dot" style="background:' + vars.accent + '"></div>';
                    card.appendChild(p);
                } else {
                    var p2 = document.createElement('div');
                    p2.className = 'zs-preview';
                    p2.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#3a3f4a;color:#fff;font-size:10px;';
                    p2.textContent = '全局';
                    card.appendChild(p2);
                }
                var n = document.createElement('div');
                n.className = 'zs-name';
                n.textContent = name;
                card.appendChild(n);
                card.addEventListener('click', function () {
                    wrap.querySelectorAll('.re-skin-card').forEach(function (c) { c.classList.remove('active'); });
                    card.classList.add('active');
                    wrap.dataset.value = val;
                    /* 选择即保存：点击立即落库（chat_skin），并给所有绑定该角色的对话框换肤，避免"没点确定看似生效、切换角色后丢失" */
                    if (role && role.id) {
                        try {
                            role.chat_skin = val;
                            apiPost({ action: 'update', id: role.id, name: role.name || '', prompt: role.prompt || '', avatar: role.avatar || '', chat_skin: val }, function (res) {
                                if (res && res.ok && window.App && typeof App._refreshAllRoleSkins === 'function') {
                                    App._refreshAllRoleSkins(role.id, val);
                                }
                            });
                        } catch (e) {
                            if (window.App && typeof App._refreshAllRoleSkins === 'function') App._refreshAllRoleSkins(role.id, val);
                        }
                    }
                });
                wrap.appendChild(card);
                return card;
            }
            var g = mkCard('', '跟随全局主题', null);
            styles.forEach(function (s) { mkCard(s.id, s.name || s.id, s.vars); });
            var cur = (role && role.chat_skin) || '';
            wrap.dataset.value = cur;
            wrap.querySelectorAll('.re-skin-card').forEach(function (c) {
                if (c.getAttribute('data-style') === cur) c.classList.add('active');
            });
        })();
        var grid = buildAvatarPicker(mask.querySelector('#re-avatar'), mask.querySelector('#re-avatar'));
        if (role && role.avatar) {
            grid.querySelectorAll('.re-avatar-cell').forEach(function (c) {
                if (c.textContent === role.avatar) c.classList.add('on');
            });
        }
        mask.querySelector('.re-close').onclick = function () {
            /* 修复：直接关闭（✕/点遮罩）时，若已选择的皮肤与已保存值不同，自动保存，避免风格丢失 */
            try {
                var w2 = mask.querySelector('#re-skin');
                var chosen = w2 ? (w2.dataset.value || '') : '';
                var saved = (role && role.chat_skin) || '';
                if (role && role.id && chosen !== saved) {
                    apiPost({ action: 'update', id: role.id, name: role.name || '', prompt: role.prompt || '', avatar: role.avatar || '', chat_skin: chosen }, function (res2) {
                        if (res2 && res2.ok && window.App && typeof App._refreshAllRoleSkins === 'function') {
                            App._refreshAllRoleSkins(role.id, chosen);
                        }
                    });
                }
            } catch (e) {}
            mask.remove();
        };
        mask.onclick = function (e) {
            if (e.target === mask) {
                try {
                    var w3 = mask.querySelector('#re-skin');
                    var chosen3 = w3 ? (w3.dataset.value || '') : '';
                    var saved3 = (role && role.chat_skin) || '';
                    if (role && role.id && chosen3 !== saved3) {
                        apiPost({ action: 'update', id: role.id, name: role.name || '', prompt: role.prompt || '', avatar: role.avatar || '', chat_skin: chosen3 }, function (res3) {
                            if (res3 && res3.ok && window.App && typeof App._refreshAllRoleSkins === 'function') {
                                App._refreshAllRoleSkins(role.id, chosen3);
                            }
                        });
                    }
                } catch (e) {}
                mask.remove();
            }
        };
        mask.querySelector('.re-ai').onclick = function () {
            var name = mask.querySelector('#re-name').value.trim();
            if (!name) { alert('请先填写角色名，再点 AI 生成'); return; }
            var btn = this;
            btn.disabled = true; btn.textContent = '生成中…';
            var promptField = mask.querySelector('#re-prompt');
            var hintText = (promptField && promptField.value.trim()) || '';
            apiPost({ action: 'ai_fill', name: name, hint: hintText.substring(0, 200) }, function (res) {
                btn.disabled = false; btn.textContent = '✨ AI 生成';
                if (res && res.ok && res.prompt) {
                    mask.querySelector('#re-prompt').value = res.prompt;
                } else {
                    alert((res && res.error) || 'AI 生成失败，请稍后再试');
                }
            });
        };
        mask.querySelector('.re-save').onclick = function () {
            var name = mask.querySelector('#re-name').value.trim();
            var prompt = mask.querySelector('#re-prompt').value.trim();
            var avatar = mask.querySelector('#re-avatar').value.trim() || '🎭';
            var skinWrap = mask.querySelector('#re-skin');
            var chatSkin = skinWrap ? (skinWrap.dataset.value || '') : '';
            if (!name) { alert('请填写角色名'); return; }
            var payload = role
                ? { action: 'update', id: role.id, name: name, prompt: prompt, avatar: avatar, chat_skin: chatSkin }
                : { action: 'create', name: name, prompt: prompt, avatar: avatar, chat_skin: chatSkin };
            apiPost(payload, function (res) {
                if (res && res.ok) {
                    mask.remove();
                    /* 编辑保存后实时换肤：更新内存对象，并刷新所有绑定该角色的对话框（含其它标签页） */
                    if (role) {
                        var rid = (res.role && res.role.id) || role.id;
                        var newName = (res.role && res.role.name) || name;
                        var newAvatar = (res.role && res.role.avatar) || avatar;
                        role.chat_skin = chatSkin;
                        role.name = newName;
                        role.avatar = newAvatar;
                        /* 立即让角色列表缓存失效：防止切换角色时渲染到旧 chat_skin/旧资料 */
                        try { localStorage.removeItem('zf_roles_cache'); } catch (e) {}
                        _rolesCache = { ts: 0, box: '', data: null };
                        if (App._refreshAllRoleSkins) App._refreshAllRoleSkins(rid, chatSkin);
                        /* 全局同步：所有已绑定该角色的对话框立刻继承新界面（标题、角色名、头像、皮肤） */
                        _syncAllRoleBoxes(rid, { name: newName, avatar: newAvatar, chat_skin: chatSkin });
                    }
                    if (!role && res.role && box) {
                        // 新建即注入当前对话
                        apiPost({ action: 'select', box: boxIdOf(box), role_id: res.role.id }, function () {
                            localRoleSet(boxIdOf(box), res.role);
                            App._refreshRoleBadge(box);
                            onDone && onDone();
                        });
                    } else { onDone && onDone(); }
                } else {
                    alert('保存失败：' + ((res && res.error) || '未知错误'));
                }
            });
        };
    }

    /* ---------- 打开某角色的全新对话 ---------- */
    /* opts: { x, y } 可选落点坐标（画布拖拽创建时传入）；同一角色多次拖拽用递增标识区分 */
    function openRoleChat(role, opts) {
        opts = opts || {};
        var App2 = window.App;
        if (!App2 || typeof App2.createChatBox !== 'function') {
            // 对话组件可能尚未初始化完，稍等重试（最多 3 秒）
            var tries = 0;
            var t = setInterval(function () {
                if (++tries > 20) { alert('对话组件未就绪，请刷新页面后重试'); return; }
                if (window.App && typeof window.App.createChatBox === 'function') { clearInterval(t); _do(); }
            }, 150);
            return;
        }
        _do();
        function _do() {
            var cbCount = document.querySelectorAll('.chatbox').length;
            /* 居中创建：放在当前可视区域中间（有落点坐标时以落点为准，轻微错开）
               用递增计数器保证每次创建偏移都不同（cbCount 在批量创建时有竞态，会全部重叠） */
            try { var _seqN = parseInt(localStorage.getItem('zf_role_chat_pos_seq') || '0', 10) || 0; } catch (e) { var _seqN = 0; }
            _seqN = (_seqN + 1) % 8;
            try { localStorage.setItem('zf_role_chat_pos_seq', String(_seqN)); } catch (e) {}
            var w = Math.min(480, window.innerWidth - 40);
            var h = Math.min(560, window.innerHeight - 120);
            /* 【默认落点=源对话右下侧】策划师/审核员等工作角色新建时，优先贴着源对话（当前活跃窗）
               的右下角落位；源窗不存在时才回退屏幕居中。之后仍由 chatbox-spawn-habit 按用户习惯接管。 */
            var _spawnRoles = ['策划师', '审核员', '施工队', '协作队', '总结师', '质检员', '技术可行性', '收口'];
            var _isSpawnRole = false;
            try { var _rn = String(role && role.name || ''); for (var _ri = 0; _ri < _spawnRoles.length; _ri++) { if (_rn.indexOf(_spawnRoles[_ri]) !== -1) { _isSpawnRole = true; break; } } } catch (e) {}
            var _srcBox = null;
            if (_isSpawnRole) {
                try {
                    _srcBox = document.querySelector('.chatbox.active');
                    if (!_srcBox) {
                        var _all = document.querySelectorAll('.chatbox');
                        if (_all.length) _srcBox = _all[_all.length - 1];
                    }
                } catch (e) { _srcBox = null; }
            }
            var _defX, _defY;
            if (_isSpawnRole) {
                /* 有用户习惯记录（chatbox-spawn-habit）时优先按习惯定位，无习惯才用右下默认 */
                try {
                    if (window.SpawnHabit && typeof window.SpawnHabit.queryHabit === 'function') {
                        var _rkName = String(role && role.name || '');
                        for (var _rj = 0; _rj < _spawnRoles.length; _rj++) {
                            if (_rkName.indexOf(_spawnRoles[_rj]) !== -1) {
                                var _hit = window.SpawnHabit.queryHabit(_spawnRoles[_rj]);
                                if (_hit && typeof _hit.x === 'number') { _defX = _hit.x; _defY = _hit.y; }
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }
            if (typeof _defX !== 'number') {
                if (_srcBox && typeof _srcBox.offsetLeft === 'number') {
                    _defX = _srcBox.offsetLeft + _srcBox.offsetWidth - 60;
                    _defY = _srcBox.offsetTop + _srcBox.offsetHeight + 16;
                } else {
                    _defX = Math.max(10, Math.round((window.innerWidth - w) / 2) + _seqN * 30);
                    _defY = Math.max(60, Math.round((window.innerHeight - h) / 2) + _seqN * 22);
                }
            }
            var _stag = _seqN * 24;
            /* 【直接落位·逻辑坐标】x/y 与 chat.el.style.left/top 同一坐标系（画布逻辑坐标），
               严禁用 window.innerWidth/innerHeight 钳制（那是屏幕坐标系，画布平移/缩放后会跑偏）。
               createChatBox 第4参 trustedSpawn=true：底层按逻辑坐标直通，不做缩放换算、不做可视区钳制 */
            var x = (typeof opts.x === 'number') ? Math.round(opts.x) + _stag : Math.round(_defX);
            var y = (typeof opts.y === 'number') ? Math.round(opts.y) : Math.round(_defY);
            var chat = window.App.createChatBox(x, y, null, true);
            /* 标记：本对话由 openRoleChat 直接创建并绑定角色，createChatBox 包装器不要再做角色继承/沿用 */
            try { if (chat && !chat.el) chat._zfRoleDirect = true; if (chat) chat._zfRoleDirect = true; } catch (e) {}
            var box = chat && chat.el ? chat.el : (chat || null);
            if (!box) { alert('创建对话失败'); return; }
            /* 【P1-2 施工队】通用 cwd 绑定：opts.worktreePath 存在时随窗持久化。
               通用机制（不特判施工队）：任何角色未来都可带 worktreePath 建窗。
               持久化两处：① box data 属性（关开重开从 DOM 恢复场景）
               ② localStorage zf_role_worktree_<roleId>_<seq>（窗口重建后按角色+序号恢复） */
            if (opts.worktreePath) {
                var _wt = String(opts.worktreePath);
                try {
                    chat._raceWorktree = _wt;
                    box.setAttribute('data-race-worktree', _wt);
                    box.setAttribute('title', '施工现场: ' + _wt);
                    var key2 = 'zf_role_worktree_' + (role && role.id ? role.id : 'x');
                    var seq0 = box.getAttribute('data-role-seq') || '';
                    if (seq0) localStorage.setItem(key2 + '_' + seq0, _wt);
                } catch (e) {}
            }
            /* 唯一标识：同一角色可多次拖拽建对话，标题带序号避免重复混淆 */
            try {
                var key = 'zf_role_chat_seq_' + role.id;
                var seq = (parseInt(localStorage.getItem(key) || '0', 10) || 0) + 1;
                localStorage.setItem(key, String(seq));
                var titleEl = box.querySelector('.title');
                if (titleEl) {
                    var label = (role.avatar ? role.avatar + ' ' : '') + (role.name || '角色') + ' · #' + seq;
                    titleEl.textContent = label;
                    titleEl.title = '角色对话（唯一标识 #' + seq + '）';
                }
                box.setAttribute('data-role-id', role.id);
                box.setAttribute('data-role-seq', String(seq));
            } catch (e) {}
            var boxId = box.id || (chat && chat.id) || boxIdOf(box);
            apiPost({ action: 'select', box: boxId, role_id: role.id }, function () {
                localRoleSet(boxId, role);
                App._refreshRoleBadge(box);
                /* 新建对话直接继承该角色当前界面（皮肤立即贴上，不等刷新） */
                try {
                    if (window.Theme && typeof Theme.applyToBox === 'function') Theme.applyToBox(box, role.chat_skin || '');
                    if (role.chat_skin && box.setAttribute) box.setAttribute('data-role-skin', '1');
                } catch (e) {}
                try {
                    var body = box.querySelector('.chatbox-body');
                    if (body && !body.querySelector('.msg:not([data-welcome])')) {
                        var w = body.querySelector('[data-welcome]');
                        if (w) w.innerHTML = '<b>' + (role.avatar || '🎭') + ' ' + role.name + '</b> 已加入本对话。直接开始聊吧，也可以在其他对话里用 @' + role.name + ' 呼叫 TA。';
                    }
                } catch (e) {}
            });
            /* 【施工队链路修复】返回创建的 chat，调用方（spawnTeam）直接拿引用，不再盲查 DOM */
            return chat;
        }
    }

    /* ---------- 角色面板（可拖拽 / 可缩放） ---------- */
    function openRolesPanel(box) {
        var old = document.getElementById('roles-panel');
        if (old) { old.remove(); return; }  // 再点一次关闭
        var panel = document.createElement('div');
        panel.id = 'roles-panel';
        panel.innerHTML =
            '<div class="rp-head">' +
            '<span class="rp-title">🎭 角色列表</span>' +
            '<span class="rp-btns"><button class="rp-new" title="新建角色">＋新建</button><button class="rp-newgroup-btn" title="新建分组">📁＋组</button></span>' +
            '<span class="rp-close" title="关闭">✕</span>' +
            '</div>' +
            '<div class="rp-list"></div>' +
            '<div class="rp-resize" title="拖拽调整大小"></div>';
        document.body.appendChild(panel);

        /* 位置与尺寸记忆（localStorage 持久化，重启后恢复） */
        var RP_KEY = 'roles-panel-geom';
        function rpSave() {
            try {
                localStorage.setItem(RP_KEY, JSON.stringify({
                    left: panel.offsetLeft, top: panel.offsetTop,
                    width: panel.offsetWidth, height: panel.offsetHeight
                }));
            } catch (err) {}
        }
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(RP_KEY) || 'null'); } catch (err) {}
        if (saved && typeof saved.left === 'number') {
            var maxL = Math.max(0, window.innerWidth - 120), maxT = Math.max(0, window.innerHeight - 60);
            panel.style.left = Math.min(Math.max(0, saved.left), maxL) + 'px';
            panel.style.top = Math.min(Math.max(0, saved.top), maxT) + 'px';
            panel.style.width = Math.max(220, saved.width || 270) + 'px';
            panel.style.height = Math.max(220, saved.height || 420) + 'px';
        } else {
            /* 默认位置：屏幕左侧 */
            panel.style.left = '16px';
            panel.style.top = '90px';
            panel.style.width = '270px';
            panel.style.height = '420px';
        }

        /* 拖拽移动 */
        var head = panel.querySelector('.rp-head');
        head.addEventListener('mousedown', function (e) {
            if (e.target.closest('.rp-btns')) return;
            var sx = e.clientX - panel.offsetLeft, sy = e.clientY - panel.offsetTop;
            function mv(ev) { panel.style.left = (ev.clientX - sx) + 'px'; panel.style.top = Math.max(0, ev.clientY - sy) + 'px'; }
            function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); rpSave(); }
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
            e.preventDefault();
        });

        /* 右下角缩放 */
        var rz = panel.querySelector('.rp-resize');
        rz.addEventListener('mousedown', function (e) {
            e.stopPropagation(); e.preventDefault();
            var sw = panel.offsetWidth - e.clientX, sh = panel.offsetHeight - e.clientY;
            function mv(ev) {
                panel.style.width = Math.max(220, ev.clientX + sw) + 'px';
                panel.style.height = Math.max(220, ev.clientY + sh) + 'px';
            }
            function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); rpSave(); }
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });

        panel.querySelector('.rp-close').onclick = function () { panel.remove(); };
        panel.querySelector('.rp-new').onclick = function () { openRoleEditor(box, null, render); };
        panel.querySelector('.rp-newgroup-btn').onclick = function () {
            askText('新建分组', '分组名称：', '新建组', function (nm) {
                if (nm === null) return;
                apiPost({ action: 'group_add', name: nm || '新建组' }, function () { render(); });
            });
        };

        /* 分页状态：每页 20 条 */
        var PAGE_SIZE = 20;
        var _rpPage = 1;

        function render() {
            var list = panel.querySelector('.rp-list');
            /* 有缓存先立即渲染，避免"加载中…"闪烁；无缓存才显示加载中 */
            var cached = _rolesCache.data && _rolesCache.box === boxIdOf(box) ? _rolesCache.data : null;
            if (!cached) list.innerHTML = '<div class="rp-empty">加载中…</div>';
            apiGet(box, function (res) {
                var all = (res && res.roles) || [];
                var groups = ((res && res.groups) || []).slice();
                var selId = (res && res.selected_id) || '';
                /* 按后端保存的 order 排序（拖拽调序结果），order 缺失时按名称兜底 */
                var roles = all.slice().sort(function (a, b) {
                    var oa = (a.order == null ? 999999 : a.order), ob = (b.order == null ? 999999 : b.order);
                    if (oa !== ob) return oa - ob;
                    return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
                });
                /* 分页：只对未分组角色生效 */
                var ungrouped = roles.filter(function (r) { return !r.group; });
                var totalPages = Math.max(1, Math.ceil(ungrouped.length / PAGE_SIZE));
                if (_rpPage > totalPages) _rpPage = totalPages;
                var pageRoles = ungrouped.slice((_rpPage - 1) * PAGE_SIZE, _rpPage * PAGE_SIZE);
                list.innerHTML = '';
                // 默认角色：恢复不注入任何角色（点它 = 取消注入）
                var def = document.createElement('div');
                def.className = 'rp-item' + (!selId ? ' on' : '');
                def.innerHTML =
                    '<span class="rp-av">🎭</span>' +
                    '<span class="rp-info"><b>默认角色</b><i>不注入任何角色，使用系统默认助手</i></span>';
                def.onclick = function (e) {
                    if (selId) {
                        /* 点击默认角色 = 立即取消注入（本地乐观更新） */
                        selId = '';
                        localRoleSet(boxIdOf(box), null);
                        App._refreshRoleBadge(box);
                        /* 修复：取消注入时同步清掉角色皮肤并清除标记，避免旧角色风格残留被误恢复 */
                        try {
                            if (window.Theme && typeof Theme.applyToBox === 'function') Theme.applyToBox(box, '');
                            if (box.setAttribute) box.removeAttribute('data-role-skin');
                        } catch (e2) {}
                        apiPost({ action: 'select', box: boxIdOf(box), role_id: '' }, function (res) {
                            if (res && res.ok) render();
                        });
                    }
                };
                list.appendChild(def);

                /* ===== 渲染分组（组在前，未分组角色在后） ===== */
                var _openSet = null;
                try { _openSet = JSON.parse(localStorage.getItem('zf_role_groups_open') || '[]'); } catch (e) { _openSet = []; }
                function isOpen(gid) { return _openSet.indexOf(gid) >= 0; }
                function setOpen(gid, v) {
                    if (v) { if (_openSet.indexOf(gid) < 0) _openSet.push(gid); }
                    else { var i = _openSet.indexOf(gid); if (i >= 0) _openSet.splice(i, 1); }
                    try { localStorage.setItem('zf_role_groups_open', JSON.stringify(_openSet)); } catch (e) {}
                }

                /* 拖拽指示线 */
                var _line = null;
                function showLine(anchor, after) {
                    hideLine();
                    _line = document.createElement('div');
                    _line.className = 'rp-drop-line';
                    if (after && anchor.nextSibling) anchor.parentNode.insertBefore(_line, anchor.nextSibling);
                    else anchor.parentNode.insertBefore(_line, anchor);
                }
                function hideLine() { if (_line) { _line.remove(); _line = null; } }

                /* 角色 DOM 构造（复用原有逻辑），draggable 支持拖拽进组 */
                function buildRoleItem(r, inGroupId) {
                    var item = document.createElement('div');
                    item.className = 'rp-item' + (r.id === selId ? ' on' : '');
                    item.setAttribute('draggable', 'true');
                    item.setAttribute('data-role-id', r.id);
                    item.innerHTML =
                        '<span class="rp-av">' + (r.avatar || '🎭') + '</span>' +
                        '<span class="rp-info"><b>' + (r.name || '未命名') + '</b>' +
                        '<i title="' + (r.prompt || '').replace(/"/g, '&quot;') + '">' + (r.prompt || '（无提示词）') + '</i></span>' +
                        '<span class="rp-ops">' +
                        (inGroupId ? '<button class="rp-out" title="移出分组">↩️</button>' : '') +
                        '<button class="rp-edit" title="编辑">✏️</button>' +
                        '<button class="rp-del" title="删除">🗑️</button></span>';
                    item.ondblclick = function (e) {
                        if (e.target.closest('.rp-ops')) return;
                        openRoleChat(r);
                    };
                    item.onclick = function (e) {
                        if (e.target.closest('.rp-ops')) return;
                        if (_justDragged) return;   /* 刚拖拽完不当作点击 */
                        /* 点击 = 立即切换（本地乐观更新，不等服务端） */
                        var nextId = (r.id === selId) ? '' : r.id;
                        selId = nextId;
                        localRoleSet(boxIdOf(box), nextId ? r : null);
                        App._refreshRoleBadge(box);
                        /* 修复：切换角色后立即重贴界面皮肤（含取消=跟随全局），否则旧角色风格残留/丢失 */
                        try {
                            if (window.Theme && typeof Theme.applyToBox === 'function') Theme.applyToBox(box, nextId ? (r.chat_skin || '') : '');
                            if (box.setAttribute) {
                                if (nextId && r.chat_skin) box.setAttribute('data-role-skin', '1');
                                else box.removeAttribute('data-role-skin');
                            }
                        } catch (e) {}
                        /* 选中/取消走后台静默同步，成功后再重绘（避免 render 拉到旧 selected_id 导致需要点两次） */
                        apiPost({ action: 'select', box: boxIdOf(box), role_id: nextId }, function (res) {
                            if (res && res.ok) {
                                render();
                            } else {
                                selId = nextId ? '' : r.id;
                                localRoleSet(boxIdOf(box), selId ? r : null);
                                App._refreshRoleBadge(box);
                                render();
                            }
                        });
                    };
                    item.querySelector('.rp-edit').onclick = function () { openRoleEditor(box, r, render); };
                    item.querySelector('.rp-del').onclick = function () {
                        askConfirm('删除角色', '删除角色「' + r.name + '」？', function (yes) {
                            if (!yes) return;
                            apiPost({ action: 'delete', id: r.id }, function () {
                                if (r.id === selId) localRoleSet(boxIdOf(box), null);
                                App._refreshRoleBadge(box);
                                render();
                            });
                        });
                    };
                    var outBtn = item.querySelector('.rp-out');
                    if (outBtn) outBtn.onclick = function (e) {
                        e.stopPropagation();
                        apiPost({ action: 'group_assign', role_id: r.id, group_id: '' }, function () { render(); });
                    };
                    /* 拖拽标记：刚拖拽过的 item 短暂屏蔽 click，避免拖完误触发选择 */
                    var _justDragged = false;
                    item.setAttribute('draggable', 'true');
                    item.addEventListener('dragstart', function (e) {
                        _justDragged = true;
                        setTimeout(function () { _justDragged = false; }, 300);
                        e.dataTransfer.setData('text/zf-role', r.id);
                        e.dataTransfer.setData('text/zf-role-order', '1');
                        e.dataTransfer.setData('text/zf-role-group', String(r.group || ''));
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    /* 拖拽调序：悬停到其他角色 item 上时显示插入指示线 */
                    item.addEventListener('dragover', function (e) {
                        if (e.dataTransfer.types.indexOf('text/zf-role-order') < 0) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        var rect = item.getBoundingClientRect();
                        showLine(item, e.clientY > rect.top + rect.height / 2);
                    });
                    item.addEventListener('dragleave', hideLine);
                    item.addEventListener('drop', function (e) {
                        var rid = e.dataTransfer.getData('text/zf-role');
                        hideLine();
                        if (rid && rid !== r.id && e.dataTransfer.types.indexOf('text/zf-role-order') >= 0) {
                            e.preventDefault(); e.stopPropagation();
                            var rect = item.getBoundingClientRect();
                            var after = e.clientY > rect.top + rect.height / 2;
                            var beforeId = r.id;
                            if (after) {
                                var n = item.nextSibling;
                                while (n && !(n.classList && (n.classList.contains('rp-item') || n.classList.contains('rp-group')))) n = n.nextSibling;
                                beforeId = n ? (n.getAttribute('data-role-id') || n.getAttribute('data-group-id') || '') : '';
                            }
                            apiPost({ action: 'role_move', id: rid, before_id: beforeId }, function (res) {
                                if (!res || !res.ok) { alert('调序失败'); render(); return; }
                                /* 跨组调序：目标 item 所在组与被拖角色组不同时，同时改组归属 */
                                var host = item.closest('.rp-group');
                                var toGid = host ? host.getAttribute('data-group-id') : '';
                                var fromGid = e.dataTransfer.getData('text/zf-role-group');
                                if (String(fromGid || '') !== String(toGid || '')) {
                                    apiPost({ action: 'group_assign', role_id: rid, group_id: toGid || '' }, function () { render(); });
                                }
                            });
                        }
                    });
                    return item;
                }

                /* 分组行构造 */
                function buildGroupItem(g) {
                    var gid = g.id;
                    var members = roles.filter(function (r) { return String(r.group) === String(gid); });
                    var open = isOpen(gid);
                    var wrap = document.createElement('div');
                    wrap.className = 'rp-group' + (open ? ' open' : '');
                    wrap.setAttribute('data-group-id', gid);
                    var head = document.createElement('div');
                    head.className = 'rp-item rp-group-head';
                    head.setAttribute('draggable', 'true');
                    head.innerHTML =
                        '<span class="rp-g-arrow">' + (open ? '▼' : '▶') + '</span>' +
                        '<span class="rp-av">📁</span>' +
                        '<span class="rp-info"><b>' + (g.name || '未命名组') + '</b><i>' + members.length + ' 个角色</i></span>' +
                        '<span class="rp-ops">' +
                        '<button class="rp-g-ren" title="重命名">✏️</button>' +
                        '<button class="rp-g-del" title="删除组">🗑️</button></span>';
                    head.onclick = function (e) {
                        if (e.target.closest('.rp-ops')) return;
                        setOpen(gid, !isOpen(gid));
                        render();
                    };
                    head.querySelector('.rp-g-ren').onclick = function (e) {
                        e.stopPropagation();
                        askText('重命名分组', '分组名称：', g.name || '', function (nm) {
                            if (nm === null) return;
                            apiPost({ action: 'group_rename', id: gid, name: nm }, function () { render(); });
                        });
                    };
                    head.querySelector('.rp-g-del').onclick = function (e) {
                        e.stopPropagation();
                        askConfirm('删除分组', '删除分组「' + (g.name || '') + '」？组内角色会变为未分组，不会被删除。', function (yes) {
                            if (!yes) return;
                            apiPost({ action: 'group_delete', id: gid }, function () { render(); });
                        });
                    };
                    /* 组头拖拽排序 */
                    head.addEventListener('dragstart', function (e) {
                        e.dataTransfer.setData('text/zf-group', gid);
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    head.addEventListener('dragover', function (e) {
                        /* 拖组 = 组排序；拖角色 = 加入本组（组收起时也能拖到组头入组） */
                        if (e.dataTransfer.types.indexOf('text/zf-role') >= 0) {
                            e.preventDefault(); e.stopPropagation();
                            e.dataTransfer.dropEffect = 'move';
                            wrap.classList.add('rp-group-drag');
                            return;
                        }
                        if (e.dataTransfer.types.indexOf('text/zf-group') >= 0) {
                            e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                            var rect = head.getBoundingClientRect();
                            showLine(wrap, e.clientY > rect.top + rect.height / 2);
                        }
                    });
                    head.addEventListener('dragleave', function (e) {
                        if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('rp-group-drag');
                        hideLine();
                    });
                    head.addEventListener('drop', function (e) {
                        wrap.classList.remove('rp-group-drag');
                        var g2 = e.dataTransfer.getData('text/zf-group');
                        if (g2 && g2 !== gid) {
                            e.preventDefault(); e.stopPropagation(); hideLine();
                            var rect = head.getBoundingClientRect();
                            var after = e.clientY > rect.top + rect.height / 2;
                            /* before_id 取本组（前插）或下一兄弟（后插） */
                            var next = wrap.nextSibling;
                            var beforeId = null;
                            if (after) {
                                var n = next;
                                while (n && !(n.classList && n.classList.contains('rp-group'))) n = n.nextSibling;
                                beforeId = n ? n.getAttribute('data-group-id') : '';
                            } else beforeId = gid;
                            apiPost({ action: 'group_move', id: g2, before_id: beforeId }, function () { render(); });
                            return;
                        }
                        /* 拖角色到组头 = 加入本组 */
                        var rid = e.dataTransfer.getData('text/zf-role');
                        if (rid) {
                            e.preventDefault(); e.stopPropagation(); hideLine();
                            apiPost({ action: 'group_assign', role_id: rid, group_id: gid }, function () { render(); });
                        } else hideLine();
                    });
                    wrap.appendChild(head);
                    /* 组体：拖入角色进组 */
                    var body = document.createElement('div');
                    body.className = 'rp-group-body';
                    body.addEventListener('dragover', function (e) {
                        if (e.dataTransfer.types.indexOf('text/zf-role') >= 0) {
                            e.preventDefault(); e.stopPropagation();
                            wrap.classList.add('rp-group-drag');
                        }
                    });
                    body.addEventListener('dragleave', function (e) {
                        if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('rp-group-drag');
                    });
                    body.addEventListener('drop', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        wrap.classList.remove('rp-group-drag');
                        var rid = e.dataTransfer.getData('text/zf-role');
                        if (rid) apiPost({ action: 'group_assign', role_id: rid, group_id: gid }, function () { render(); });
                    });
                    if (open) {
                        if (!members.length) {
                            var eh = document.createElement('div');
                            eh.className = 'rp-empty rp-group-empty';
                            eh.textContent = '拖拽角色到这里加入分组';
                            body.appendChild(eh);
                        } else {
                            members.forEach(function (r) { body.appendChild(buildRoleItem(r, true)); });
                        }
                    }
                    wrap.appendChild(body);
                    return wrap;
                }

                /* 未分组角色 item 也要能拖（带 out 按钮 = false） */
                function buildLooseItem(r) { return buildRoleItem(r, false); }

                groups.forEach(function (g) { list.appendChild(buildGroupItem(g)); });

                if (!roles.length && !groups.length) {
                    var empty = document.createElement('div');
                    empty.className = 'rp-empty';
                    empty.textContent = '还没有角色，点右上「＋新建」创建一个吧';
                    list.appendChild(empty);
                    return;
                }
                if (ungrouped.length) {
                    var lgHead = document.createElement('div');
                    lgHead.className = 'rp-loose-head';
                    lgHead.textContent = groups.length ? '未分组角色' : '';
                    if (groups.length) list.appendChild(lgHead);
                }
                pageRoles.forEach(function (r) { list.appendChild(buildLooseItem(r)); });
                /* 松开角色到列表空白 = 移出分组 */
                list.addEventListener('dragover', function (e) {
                    if (e.dataTransfer.types.indexOf('text/zf-role') >= 0) e.preventDefault();
                });
                list.addEventListener('drop', function (e) {
                    if (e.target.closest('.rp-group')) return;
                    var rid = e.dataTransfer.getData('text/zf-role');
                    if (rid) apiPost({ action: 'group_assign', role_id: rid, group_id: '' }, function () { render(); });
                });
                /* 分页控件：上一页 / 页码 / 下一页（仅多于一页时显示） */
                if (totalPages > 1) {
                    var pager = document.createElement('div');
                    pager.className = 'rp-pager';
                    var html = '<button class="rp-pg" data-p="' + (_rpPage - 1) + '"' + (_rpPage <= 1 ? ' disabled' : '') + '>‹ 上一页</button>';
                    for (var p = 1; p <= totalPages; p++) {
                        html += '<button class="rp-pg rp-pg-num' + (p === _rpPage ? ' on' : '') + '" data-p="' + p + '">' + p + '</button>';
                    }
                    html += '<button class="rp-pg" data-p="' + (_rpPage + 1) + '"' + (_rpPage >= totalPages ? ' disabled' : '') + '>下一页 ›</button>';
                    pager.innerHTML = html;
                    pager.querySelectorAll('.rp-pg').forEach(function (b) {
                        b.onclick = function (e) {
                            e.stopPropagation();
                            var p = parseInt(b.getAttribute('data-p'), 10);
                            if (p >= 1 && p <= totalPages && p !== _rpPage) { _rpPage = p; render(); }
                        };
                    });
                    list.appendChild(pager);
                }
            });
        }
        render();
    }


    App.rolesOpenPanel = function (box) { openRolesPanel(box); };

    /* ---------- 入口：画布拖拽创建角色对话（同一角色可多次拖拽，标题带唯一标识） ---------- */
    App.openRoleChat = openRoleChat;

    /* ---------- @提及：为上下文注入场景角色清单 ---------- */
    App.rolesBuildSceneContext = function (text) {
        try {
            var roles = ((_rolesCache.data && _rolesCache.data.roles) || []);
            if (!roles.length || !/@/.test(String(text || ''))) return '';
            var mentioned = [];
            roles.forEach(function (r) {
                if (!r || !r.name) return;
                if (String(text).indexOf('@' + r.name) >= 0) mentioned.push(r);
            });
            if (!mentioned.length) return '';
            var lines = ['【场景中的对话角色】'];
            roles.forEach(function (r) {
                var desc = (r.description || r.intro || r.bio || '').slice(0, 60);
                var mark = mentioned.indexOf(r) >= 0 ? ' ← 本次被@，请优先以此角色身份回应' : '';
                lines.push('- ' + r.name + (desc ? ('：' + desc) : '') + mark);
            });
            return lines.join('\n');
        } catch (e) { return ''; }
    };

    /* ---------- 激活角色：切换本对话注入的角色 ---------- */
    App.rolesActivateRole = function (box, role) {
        if (!box || !role || !role.id) return;
        apiPost({ action: 'select', box: boxIdOf(box), role_id: role.id }, function (res) {
            if (res && res.ok) {
                localRoleSet(boxIdOf(box), role);
                if (App._refreshRoleBadge) App._refreshRoleBadge(box);
                /* 显式继承新角色的界面皮肤（不依赖 _refreshRoleBadge 内部实现） */
                try {
                    if (window.Theme && typeof Theme.applyToBox === 'function') Theme.applyToBox(box, role.chat_skin || '');
                    if (role.chat_skin && box.setAttribute) box.setAttribute('data-role-skin', '1');
                } catch (e) {}
            }
        });
    };

    /* ---------- 角色换肤实时生效：刷新所有绑定该角色的对话框（跨对话框 + 跨标签页广播） ---------- */
    App._refreshAllRoleSkins = function (roleId, newSkin) {
        document.querySelectorAll('.chatbox').forEach(function (box) {
            try {
                var lr = localRoleOf(boxIdOf(box));
                if (!lr || String(lr.id) !== String(roleId)) return;
                lr.chat_skin = newSkin || '';
                try { localStorage.setItem('zf_role_chat_' + boxIdOf(box), JSON.stringify(lr)); } catch (e) {}
                if (App._refreshRoleBadge) App._refreshRoleBadge(box);
            } catch (e) {}
        });
        /* 同步内存角色缓存（_rolesCache / zf_roles_cache），防止切换角色回来时用到旧 chat_skin */
        try {
            if (_rolesCache && _rolesCache.data && _rolesCache.data.roles) {
                _rolesCache.data.roles.forEach(function (r) {
                    if (r && String(r.id) === String(roleId)) r.chat_skin = newSkin || '';
                });
                _cacheSave();
            }
        } catch (e) {}
        /* 通知其它标签页（同浏览器）实时换肤 */
        try { localStorage.setItem('zf_role_skin_changed', JSON.stringify({ roleId: String(roleId), skin: newSkin || '', t: Date.now() })); } catch (e) {}
    };
    /* 监听其它标签页的换肤广播 */
    window.addEventListener('storage', function (e) {
        if (e.key !== 'zf_role_skin_changed') return;
        try {
            var d = JSON.parse(e.newValue || 'null');
            if (!d || !d.roleId) return;
            document.querySelectorAll('.chatbox').forEach(function (box) {
                try {
                    var lr = localRoleOf(boxIdOf(box));
                    if (!lr || String(lr.id) !== String(d.roleId)) return;
                    lr.chat_skin = d.skin || '';
                    try { localStorage.setItem('zf_role_chat_' + boxIdOf(box), JSON.stringify(lr)); } catch (e2) {}
                    if (App._refreshRoleBadge) App._refreshRoleBadge(box);
                } catch (e2) {}
            });
        } catch (e) {}
    });

    /* ---------- 页面就绪兜底：把已有角色皮肤重新贴回所有角色对话框 ---------- */
    window.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () {
            try {
                if (window.Theme && typeof Theme._restoreRoleSkins === 'function') {
                    Theme._restoreRoleSkins();
                }
            } catch (e) {}
        }, 400);
    });
    /* 全局界面方案（主题/皮肤）变化后兜底重贴角色皮肤 */
    try {
        if (window.Theme && Theme.save && !Theme._zfRestoreHooked) {
            Theme._zfRestoreHooked = true;
            var _origSave = Theme.save;
            Theme.save = function () {
                var r = _origSave.apply(this, arguments);
                try { setTimeout(function () { Theme._restoreRoleSkins && Theme._restoreRoleSkins(); }, 0); } catch (e) {}
                return r;
            };
        }
    } catch (e) {}

    /* ---------- 包装 createChatBox：新对话创建后自动刷新角色头像 ---------- */
    document.addEventListener('DOMContentLoaded', function () {
        var tries = 0;
        (function wrap() {
            var A = window.App;
            if (!A || typeof A.createChatBox !== 'function') {
                if (++tries < 60) setTimeout(wrap, 100);
                return;
            }
            if (A._roleWrapped) return;
            A._roleWrapped = true;
            var orig = A.createChatBox.bind(A);
            A.createChatBox = function (x, y, m, t) {
                var chat = orig(x, y, m, t);
            /* openRoleChat 直接创建的对话已自行绑定角色，这里直接走复选通道，不做任何继承/沿用 */
            /* 【关键契约】_zfRoleDirect 标记被策划师/审核员/总结师三处新窗逻辑共同依赖（agent-01-project-memory.js）：
               用于在角色异步绑定前拦截本包装器的继承/沿用，防止角色串窗。改名或删除本标记前必须同步检查这三处！ */
            if (chat && chat._zfRoleDirect) {
                try {
                    var boxD = chat && chat.el ? chat.el : chat;
                    if (boxD) {
                        var lrD = localRoleOf(boxD.id || '');
                        if (lrD && lrD.id) {
                            apiPost({ action: 'select', box: boxD.id, role_id: lrD.id }, function () {});
                            App._refreshRoleBadge(boxD);
                            setTimeout(function () { App._refreshRoleBadge(boxD); }, 300);
                        }
                    }
                } catch (e) {}
                return chat;
            }
            /* 【大师集群绑定】各大师（工具/日志/上下文/文件/综合/接力/即时接力/导师）创建的新对话
               标记 _zfMasterChat（_zfMarkMaster 全局注入），这里按入口名精确绑定「大师集群」分组里的对应大师角色，取不到时回退分组首个 */
            if (chat && chat._zfMasterChat) {
                var boxM = chat && chat.el ? chat.el : chat;
                var wantName = String(chat._zfMasterChat === true ? '' : chat._zfMasterChat || '').trim();
                (function pickMasterRole() {
                    var fresh = false;
                    var apply = function (res) {
                        if (fresh || !res || !res.ok) return; fresh = true;
                        var roles = res.roles || [];
                        var pool = roles.filter(function (r) {
                            var gn = String(r.group_name || r.groupName || '').trim();
                            var nm = String(r.name || '').trim();
                            return gn === '大师集群' || /大师$/.test(nm) || nm === '导师点评';
                        });
                        var m = null;
                        if (wantName) {
                            /* 入口名精确匹配：先全等，再前缀包含（如「工具大师」兼容「XX工具大师」） */
                            m = pool.filter(function (r) { return String(r.name || '').trim() === wantName; })[0]
                                || pool.filter(function (r) { var nm = String(r.name || '').trim(); return nm.indexOf(wantName) !== -1 || wantName.indexOf(nm.replace('点评', '')) !== -1; })[0];
                        }
                        if (!m) m = pool[0];
                        if (m && m.id) {
                            apiPost({ action: 'select', box: boxM.id, role_id: m.id }, function () {
                                localRoleSet(boxM.id, m);
                                App._refreshRoleBadge(boxM);
                            });
                        }
                    };
                    var cached = (_rolesCache && (Date.now() - _rolesCache.ts < 60000)) ? _rolesCache.data : null;
                    if (cached) apply(cached);
                    apiGet(boxM, apply, { force: !cached });
                })();
                return chat;
            }
            /* 【大师集群绑定】全局标记注入：入口名写入 _zfMasterChat 供 createChatBox 包装器识别 */
            window._zfMarkMaster = function (box, entryName) {
                try { var _mc = (box && box.el) ? box : box; if (_mc) _mc._zfMasterChat = entryName || true; } catch (e) {}
            };
            try {
                var box = chat && chat.el ? chat.el : chat;
                if (box) {
                    var lr = localRoleOf(box.id || '');
                    if (!lr) {
                        /* 【问题1修复】新建对话跳过系统角色（主脑/风筝观察员/审核员/策划师/小狗管家等系统分组及同名角色）与「多角色」探讨分组角色：优先继承「上一个焦点对话」的非隔离角色，无焦点对话时才用全局最近选中的非隔离角色 */
                        var _zfSysRoleNames = ['主脑', '风筝观察员', '审核员', '策划师', '小狗管家', '总结师', '施工队'];
                        /* 分组隔离：按分组名或分组 ID 判断（避免硬编码 ID 在分组重建后失效） */
                        var _zfSysGroupIds = ['g1790260194938', 'g_master_1790557378']; /* 系统+大师集群（分组重建时按下方分组名兜底） */
                        var _isSysRole = function (r) { if (!r) return false; var g = String(r.group || r.group_id || ''); var gn = String(r.group_name || r.groupName || '').trim(); var nm = String(r.name || '').trim(); return _zfSysRoleNames.indexOf(nm) !== -1 || _zfSysGroupIds.indexOf(g) !== -1 || gn === '系统' || gn === '系统分组' || gn === '多角色' || gn === '大师集群' || /大师$/.test(nm); };
                            try {
                                var _src = null;
                                var _boxes = document.querySelectorAll('.chatbox.active');
                                for (var _bi = 0; _bi < _boxes.length; _bi++) {
                                    var _bel = _boxes[_bi];
                                    var _bid = _bel.dataset && (_bel.dataset.boxId || _bel.id);
                                    if (_bid && _bid !== box.id) { var _cand = localRoleOf(_bid); if (_cand && !_isSysRole(_cand)) { _src = _cand; break; } }
                                }
                            } catch (e) {}
                            if (_src && _src.id) {
                                apiPost({ action: 'select', box: box.id, role_id: _src.id }, function () {
                                    localRoleSet(box.id, _src);
                                    App._refreshRoleBadge(box);
                                });
                            } else {
                            /* 记住上次选择：新对话默认沿用全局最近选中的角色 */
                            fetch('/api/roles?box=' + encodeURIComponent(box.id || ''))
                                .then(function (r) { return r.json(); })
                                .then(function (res) {
                                    if (res && res.last_id) {
                                        var hit0 = ((res.roles) || []).filter(function (r) { return r.id === res.last_id; })[0];
                                        /* 【问题1修复】全局最近选中的是系统角色或「多角色」分组角色时，新对话不继承，保持无角色 */
                                        if (hit0 && _isSysRole(hit0)) return;
                                        apiPost({ action: 'select', box: box.id, role_id: res.last_id }, function () {
                                            var hit = hit0;
                                            if (hit) { localRoleSet(box.id, hit); App._refreshRoleBadge(box); }
                                        });
                                    }
                                }).catch(function () {});
                            }
                        } else {
                            apiPost({ action: 'select', box: box.id, role_id: lr.id }, function () {});
                        }
                        App._refreshRoleBadge(box);
                        setTimeout(function () { App._refreshRoleBadge(box); }, 300);
                    }
                } catch (e) {}
                return chat;
            };
        })();
    });
})();
