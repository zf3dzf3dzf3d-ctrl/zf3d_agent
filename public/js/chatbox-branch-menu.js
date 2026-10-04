/**
 * chatbox-branch-menu.js — 对话框 🌿 Git 分支选单（5.2.5 新增）
 * ============================================================
 * 挂在 App 上：toggleBranchMenu(box, chat)
 * 选单三项：
 *   1️⃣ 新建分支（自动命名 conv/MMDD-HHMM，可改名）→ 转交本对话 AI 执行，不本机直建
 *   2️⃣ 切换分支（列出本地分支，当前分支打勾）
 *   3️⃣ 合并到主分支（把当前分支 merge 到 main/master）
 *       └ 若合并冲突：自动新建一个对话，把冲突清单交给 AI 去解，不用用户手动贴
 *   🗑 删除分支 → 同样转交 AI，先查未合并提交再删
 * 依赖后端：GET /api/git/branches、POST /api/git/branch/{checkout,merge}（新建/删除分支不直连 API，由 AI 执行 git 命令）
 * 仓库路径：chat.projectId 对应项目 folder_path > App.activeProject.folder_path
 */
(function() {
    'use strict';

    function _toast(msg, type) {
        if (typeof App !== 'undefined' && typeof App.toast === 'function') {
            App.toast(msg, type || '');
        } else {
            console.log('[branch]', msg);
        }
    }

    function _repoPath(box, chat) {
        // 与 project 按钮一致：chat.projectId > App.activeProject
        var pid = (chat && chat.projectId) || (App.activeProject && App.activeProject.id) || null;
        var proj = null;
        if (pid && App._projAllProjects) {
            proj = App._projAllProjects.find(function(p) { return String(p.id) === String(pid); });
        }
        if (!proj && pid && window.Store && Store.data && Store.data.projects) {
            proj = Store.data.projects.find(function(p) { return String(p.id) === String(pid); }) || null;
        }
        return (proj && proj.folder_path) || (App.activeProject && App.activeProject.folder_path) || '';
    }

    function _api(path, opts) {
        return fetch(path, opts).then(function(r) { return r.json(); });
    }

    // 自制确认弹层（替代 window.confirm：深色浮层 + 确定/取消，风格与系统一致）
    function _confirmBox(text, onOk) {
        var ov = document.createElement('div');
        ov.className = 'branch-confirm-mask';
        ov.innerHTML =
            '<div class="branch-confirm-box">' +
                '<div class="branch-confirm-title">🌿 确认操作</div>' +
                '<div class="branch-confirm-text">' + text + '</div>' +
                '<div class="branch-confirm-btns">' +
                    '<button type="button" class="branch-confirm-cancel">取消</button>' +
                    '<button type="button" class="branch-confirm-ok">确定</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(ov);
        var close = function() { ov.remove(); document.removeEventListener('keydown', esc, true); };
        var esc = function(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        ov.querySelector('.branch-confirm-cancel').onclick = close;
        ov.querySelector('.branch-confirm-ok').onclick = function() { close(); onOk && onOk(); };
        ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
        document.addEventListener('keydown', esc, true);
    }

    function _autoName() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return 'conv/' + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }

    // 对话绑定的分支状态（内存态，随对话存续）
    var _chatBranch = {}; // key: chat.id → {branch, path}

    // 供外部（审核员继承等）读写分支缓存
    App._chatBranchGet = function(chat) {
        return _chatBranch[chat && chat.id] || null;
    };
    App._chatBranchSet = function(chat, info) {
        if (chat && chat.id && info) _chatBranch[chat.id] = info;
    };

    function _labelOf(chat) {
        return _chatBranch[chat && chat.id] || null;
    }

    function _updateBtnLabel(box, chat) {
        try {
            var btn = box.querySelector('.cfg-branch-btn');
            if (!btn) return;
            var st = _labelOf(chat);
            var lbl = btn.querySelector('.branch-label');
            if (lbl) lbl.textContent = (st && st.branch) ? st.branch : '主分支';
        } catch (e) {}
    }

    // 【修复】刷新按钮标签为仓库实际当前分支（供对话框创建时调用）
    // 原问题：_chatBranch 是纯内存态，页面刷新后丢失，按钮 HTML 又写死"主分支"，
    // 导致重启后即便 git 仓库实际在某个分支上，按钮仍显示"主分支"，点开菜单才变对。
    App.refreshBranchBtnLabel = function(box, chat) {
        try {
            var repo = _repoPath(box, chat);
            if (!repo) return;
            _api('/api/git/branches?path=' + encodeURIComponent(repo)).then(function(res) {
                if (!res || !res.ok) return;
                var cur = res.current || res.main || 'main';
                // 只初始化/纠正显示，不覆盖用户刚切换但接口未返回前的状态
                if (!_chatBranch[chat.id] || _chatBranch[chat.id].path === repo) {
                    _chatBranch[chat.id] = { branch: cur, path: repo };
                }
                _updateBtnLabel(box, chat);
            }).catch(function() {});
        } catch (e) {}
    };

    function _closeMenu(box) {
        // 面板挂载在 body 上（fixed 定位），必须从 document 全局查找
        var m = document.querySelector('.branch-menu');
        if (m) {
            if (m._outside) document.removeEventListener('click', m._outside);
            m.remove();
        }
    }

    // ============================================================
    // 合并冲突 → 自动转交 AI
    // 用户点「合并到主分支」若撞上冲突，不再只弹个错误就完事：
    // 直接把冲突清单 + 仓库路径 + 分支名打包成一句话，新建一个对话发给 AI，
    // AI 自己读冲突文件、自己判断怎么解、自己 commit，全程不需要用户再动手。
    // ============================================================
    function _handoffToAI(box, chat, repo, source, target, res) {
        var list = (res.conflicts && res.conflicts.length) ? res.conflicts : [];
        var lines = list.map(function(c, i) {
            var hunks = (c.hunks || c.count || '');
            return (i + 1) + '. `' + c.file + '`' + (hunks ? '（' + hunks + ' 处冲突）' : '');
        }).join('\n');

        var msg = '【Git 合并冲突待解决】\n' +
            '仓库：' + repo + '\n' +
            '要把分支 `' + source + '` 合并到 `' + target + '`，但 git 报告内容冲突，合并已中止。\n\n' +
            (lines ? '冲突文件：\n' + lines + '\n\n' : '') +
            '请你直接处理：\n' +
            '1. 用 git 查看 `' + source + '` 与 `' + target + '` 的差异，读懂两边各自想改什么；\n' +
            '2. 逐个冲突文件判断保留哪边、还是两边融合（注意功能是否重复实现）；\n' +
            '3. 解决完在 `' + target + '` 上提交，提交信息写清合并来源与取舍理由；\n' +
            '4. 处理完简述你改了什么、为什么这么取舍。';

        try {
            if (typeof App.createChatBox !== 'function') {
                _toast('⚠️ 冲突 ' + list.length + ' 个，但打不开新对话，请手动告知 AI', 'err');
                return;
            }
            // 不指定模型：跟随用户当前默认模型，避免硬编码
            var newChat = App.createChatBox();
            var input = newChat.el.querySelector('textarea');
            if (input) input.value = msg;
            App.addMsg(newChat.el, msg, 'user', newChat.modelId);
            if (typeof App.updateChatTitle === 'function') {
                App.updateChatTitle(newChat.el, '解决 ' + source + ' → ' + target + ' 合并冲突');
            }
            newChat.history.push({ role: 'user', content: msg });
            App.sendToModel(newChat.el, newChat);
            _toast('⚠️ 检测到 ' + list.length + ' 个冲突，已转交 AI 处理', 'err');
        } catch (err) {
            _toast('⚠️ 冲突 ' + list.length + ' 个，转交 AI 失败：' + err, 'err');
            console.error('[branch] 冲突转交 AI 失败', err);
        }
    }

    function toggleBranchMenu(box, chat) {
        var old = document.querySelector('.branch-menu');
        if (old) { _closeMenu(box); return; } // 再点一次关闭

        var repo = _repoPath(box, chat);
        if (!repo) { _toast('🌿 请先在 📁 按钮选择一个项目（git 仓库）', 'err'); return; }

        var menu = document.createElement('div');
        menu.className = 'bm-menu branch-menu';
        menu.innerHTML =
            '<div class="bm-head">' +
                '<span class="bm-head-icon">🌿</span>' +
                '<span class="bm-head-title">Git 分支</span>' +
                '<span class="bm-head-cur">…</span>' +
                '<button class="bm-head-close" type="button" title="关闭">✕</button>' +
            '</div>' +
            '<div class="bm-body">' +
                '<div class="bm-loading"><span class="bm-spin"></span>正在读取分支…</div>' +
            '</div>';
        document.body.appendChild(menu);
        menu.querySelector('.bm-head-close').addEventListener('click', function(ev) { ev.stopPropagation(); _closeMenu(box); });
        // 定位：挂 body 用 fixed，向上展开——底边永远贴在 🌿 按钮上方，高度自适应（超出则内部滚动）
        (function() {
            var btn = box.querySelector('.cfg-branch-btn');
            if (!btn) return;
            var br = btn.getBoundingClientRect();
            var left = Math.max(8, Math.min(br.left, window.innerWidth - 330));
            menu.style.left = left + 'px';
            menu.style.bottom = (window.innerHeight - br.top + 6) + 'px';
            // 自适应：最高不超过按钮上方可用空间（留 12px 边距），超出内部滚动
            var maxH = br.top - 12;
            menu.style.maxHeight = Math.max(160, maxH) + 'px';
        })();

        // 点击外部关闭
        var outside = function(e) {
            if (!menu.contains(e.target) && !e.target.closest('.cfg-branch-btn')) _closeMenu(box);
        };
        menu._outside = outside;
        setTimeout(function() { document.addEventListener('click', outside); }, 0);

        _api('/api/git/branches?path=' + encodeURIComponent(repo))
            .then(function(res) {
                var load = menu.querySelector('.bm-loading');
                if (!res.ok) {
                    load.textContent = '❌ ' + (res.error || '获取分支失败');
                    load.style.color = '#f66';
                    return;
                }
                var cur = res.current || 'main';
                var main = res.main || 'main';
                _chatBranch[chat.id] = _chatBranch[chat.id] || { branch: cur, path: repo };
                _updateBtnLabel(box, chat);

                var curTag = menu.querySelector('.bm-head-cur');
                if (curTag) curTag.textContent = cur;

                var body = menu.querySelector('.bm-body');
                var html = '';

                // 新建分支
                var auto = _autoName();
                html += '<div class="bm-section-title">新建分支</div>' +
                    '<div class="bm-item bm-new" title="基于当前分支新建">' +
                        '<input class="bm-name-input" value="' + auto + '" spellcheck="false">' +
                        '<button class="bm-go">＋ 创建</button>' +
                    '</div>';

                // 分支列表
                html += '<div class="bm-section-title">切换分支</div>';
                res.branches.forEach(function(b) {
                    var canDel = (b !== cur && b !== main);
                    html += '<div class="bm-item bm-branch' + (b === cur ? ' bm-current' : '') +
                        '" data-b="' + b + '">' +
                        '<span class="bm-check">' + (b === cur ? '●' : '○') + '</span>' +
                        '<span class="bm-bname">' + b + '</span>' +
                        (b === main ? ' <span class="bm-main-tag">主</span>' : '') +
                        (canDel ? '<button class="bm-del" data-del="' + b + '" title="删除该分支（交给 AI 处理）">🗑</button>' : '') +
                        '</div>';
                });

                // 📊 分支图谱入口
                html += '<div class="bm-section-title">图谱</div>' +
                    '<div class="bm-item bm-graph" data-repo="' + repo + '">' +
                        '<span class="bm-merge-icon">📊</span> 分支图谱' +
                    '</div>';

                // 合并到主分支
                if (cur !== main) {
                    html += '<div class="bm-section-title">合并</div>' +
                        '<div class="bm-item bm-merge" data-src="' + cur + '" data-tgt="' + main + '">' +
                            '<span class="bm-merge-icon">⇥</span> 将 <b>' + cur + '</b> 合并到 <b>' + main + '</b>' +
                        '</div>';
                }
                body.innerHTML = html;


                // 新建分支 → 转交 AI（不在本机直接建，由大模型检查状态后执行）
                menu.querySelector('.bm-new .bm-go').onclick = function(e) {
                    e.stopPropagation();
                    var name = (menu.querySelector('.bm-name-input').value || '').trim();
                    if (!name) return;
                    var msg = '【Git 分支创建请求】\n' +
                        '仓库：' + repo + '\n' +
                        '请帮我新建本地分支 `' + name + '`（基于当前分支 `' + cur + '`）。\n' +
                        '处理要求：\n' +
                        '1. 先检查工作区是否有未提交的改动，有则先按功能独立提交（git functional commit，运行期文件不要入库）；\n' +
                        '2. 检查分支名 `' + name + '` 是否已存在，存在则向我回报并换一个建议名；\n' +
                        '3. 执行 git checkout -b ' + name + ' 创建并切换到新分支；\n' +
                        '4. 回报创建结果和当前分支状态（git status）。';
                    try {
                        var input = box.querySelector('textarea');
                        if (!input || typeof App.sendToModel !== 'function' || !chat) {
                            _toast('⚠️ 无法发送，请手动让 AI 创建', 'err');
                            return;
                        }
                        input.value = msg;
                        App.addMsg(box, msg, 'user', chat.modelId);
                        chat.history.push({ role: 'user', content: msg });
                        App.sendToModel(box, chat);
                        input.value = ''; // 发送后清空输入框，避免请求文本残留
                        _chatBranch[chat.id] = { branch: name, path: repo };
                        _updateBtnLabel(box, chat);
                        _closeMenu(box);
                        _toast('🌿 已在本对话把新建分支 ' + name + ' 的请求发给 AI', '');
                    } catch (err) {
                        _toast('⚠️ 发送失败：' + err, 'err');
                    }
                };
                // 删除分支 → 转交 AI（不直接删，让 AI 确认状态后执行）
                menu.querySelectorAll('.bm-del').forEach(function(btn) {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        var b = btn.getAttribute('data-del');
                        var msg = '【Git 分支删除请求】\n' +
                            '仓库：' + repo + '\n' +
                            '请帮我删除本地分支 `' + b + '`（当前分支是 `' + cur + '`，主分支是 `' + main + '`，均不可删）。\n' +
                            '处理要求：\n' +
                            '1. 先用 git 检查该分支是否有未合并的提交（git log main..' + b + '）；\n' +
                            '2. 若有未合并内容，先向我简述有哪些改动，等我确认再删（或用 -D 前明确告知后果）；\n' +
                            '3. 若无未合并内容，直接 git branch -d ' + b + ' 并回报结果。';
                        try {
                            var input = box.querySelector('textarea');
                            if (!input || typeof App.sendToModel !== 'function' || !chat) {
                                _toast('⚠️ 无法发送，请手动让 AI 删除', 'err');
                                return;
                            }
                            input.value = msg;
                            App.addMsg(box, msg, 'user', chat.modelId);
                            chat.history.push({ role: 'user', content: msg });
                            App.sendToModel(box, chat);
                            input.value = ''; // 发送后清空输入框，避免请求文本残留
                            _closeMenu(box);
                            _toast('🗑 已在本对话把删除分支 ' + b + ' 的请求发给 AI', '');
                        } catch (err) {
                            _toast('⚠️ 发送失败：' + err, 'err');
                        }
                    };
                });
                // 切换分支
                menu.querySelectorAll('.bm-branch').forEach(function(el) {
                    el.onclick = function(e) {
                        e.stopPropagation();
                        var b = el.getAttribute('data-b');
                        if (b === cur) { _closeMenu(box); return; }
                        _api('/api/git/branch/checkout', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: repo, name: b })
                        }).then(function(r) {
                            _toast(r.ok ? '✅ ' + r.message : '❌ ' + r.error, r.ok ? 'ok' : 'err');
                            if (r.ok) {
                                _chatBranch[chat.id] = { branch: b, path: repo };
                                _updateBtnLabel(box, chat);
                                _closeMenu(box);
                            }
                        });
                    };
                });
                // 合并
                var mel = menu.querySelector('.bm-merge');
                if (mel) {
                    mel.onclick = function(e) {
                        e.stopPropagation();
                        var src = mel.getAttribute('data-src');
                        var tgt = mel.getAttribute('data-tgt');
                        // 自制确认弹层（不用 window.confirm）
                        _confirmBox('确认把分支「' + src + '」合并到「' + tgt + '」？', function() {
                            _closeMenu(box);
                            var msg = '【Git 分支合并请求】\n' +
                                '仓库：' + repo + '\n' +
                                '请把分支 `' + src + '` 合并到主分支 `' + tgt + '`。\n' +
                                '处理要求：\n' +
                                '1. 先在 `' + src + '` 上按功能独立提交当前未保存的改动（运行期文件不要入库）；\n' +
                                '2. git checkout ' + tgt + ' → git merge ' + src + '；\n' +
                                '3. 若有冲突，逐个文件判断取舍后解决并在 `' + tgt + '` 上提交，写清合并理由；\n' +
                                '4. 完成后回报：合并结果、涉及文件、当前分支（git status）。';
                            try {
                                var input = box.querySelector('textarea');
                                if (!input || typeof App.sendToModel !== 'function' || !chat) {
                                    _toast('⚠️ 无法发送，请手动让 AI 合并', 'err');
                                    return;
                                }
                                input.value = msg;
                                App.addMsg(box, msg, 'user', chat.modelId);
                                chat.history.push({ role: 'user', content: msg });
                                App.sendToModel(box, chat);
                                input.value = ''; // 发送后清空输入框，避免请求文本残留
                                // 按钮徽标立即切到主分支（AI 合并成功后与实际一致）
                                _chatBranch[chat.id] = { branch: tgt, path: repo };
                                _updateBtnLabel(box, chat);
                                _toast('🔀 已在本对话把合并 ' + src + ' → ' + tgt + ' 的请求发给 AI', '');
                            } catch (err) {
                                _toast('⚠️ 发送失败：' + err, 'err');
                            }
                        });
                    };
                }

                // 📊 分支图谱
                var gel = menu.querySelector('.bm-graph');
                if (gel) {
                    gel.onclick = function(e) {
                        e.stopPropagation();
                        if (typeof window.ZfGitGraph !== 'undefined' && window.ZfGitGraph.open) {
                            window.ZfGitGraph.open(repo);
                        } else {
                            _toast('⚠️ 图谱组件未加载（chatbox-git-graph.js）', 'err');
                        }
                    };
                }
            })
            .catch(function(err) {
                var load = menu.querySelector('.bm-loading');
                if (load) { load.textContent = '❌ 请求失败: ' + err; load.style.color = '#f66'; }
            });
    }

    // 挂到 App
    if (typeof window.App === 'undefined') window.App = {};
    App.toggleBranchMenu = toggleBranchMenu;
})();
