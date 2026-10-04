/* 施工队赛马 v1（P1-2）
 * 入口：window.ZFRace.spawnTeam(opts)
 * 流程（顺序锁死，防"有窗无现场"孤儿队）：
 *   1. POST /api/git/race/worktree-add  → 拿物理隔离目录 ../_site_<ts>_<team>
 *   2. 找「施工队」角色（roles_db 同一套注册体系；没有则提示先在角色管理里创建）
 *   3. App.openRoleChat(role, { worktreePath }) → 通用 cwd 绑定随窗持久化
 * 失败任一步不建窗。按钮由用户在需要时调用（控制台 / 后续面板接入）。
 */
(function () {
    'use strict';

    function apiPost(url, data) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
        }).then(function (r) { return r.json(); });
    }

    function findRole(name, cb) {
        /* 修复：原 DB.getRoles 全项目不存在导致永远找不到角色；改为与 app-brain.js 等同口径 fetch('/api/roles') */
        try {
            fetch('/api/roles').then(function (r) { return r.json(); }).then(function (res) {
                var list = (res && res.roles) || [];
                cb(list.filter(function (r) { return (r.name || '').indexOf(name) !== -1; })[0] || null);
            }).catch(function () { cb(null); });
            return;
        } catch (e) {}
        cb(null);
    }

    /* 当前项目仓库路径（与 chatbox-branch-menu.js 的 _repoPath 同口径：
       opts.srcChatId/chat.projectId 对应项目 folder_path > App.activeProject.folder_path > 项目1） */
    function currentRepoPath(opts) {
        opts = opts || {};
        try {
            var pid = opts.srcChatId && window.Chats && Chats.get ? (Chats.get(opts.srcChatId) || {}).projectId : null;
            pid = pid || (App.activeProject && App.activeProject.id) || null;
            var proj = null;
            if (pid && App._projAllProjects) {
                proj = App._projAllProjects.find(function (p) { return String(p.id) === String(pid); });
            }
            if (!proj && pid && window.Store && Store.data && Store.data.projects) {
                proj = Store.data.projects.find(function (p) { return String(p.id) === String(pid); }) || null;
            }
            return (proj && proj.folder_path) || (App.activeProject && App.activeProject.folder_path) ||
                (Store && Store.data && Store.data.projects && Store.data.projects[0] && Store.data.projects[0].folder_path) || '';
        } catch (e) { return ''; }
    }

    function toast(msg, ok) {
        try {
            if (typeof App !== 'undefined' && typeof App.toast === 'function') { App.toast(msg, ok ? 'ok' : 'error'); return; }
        } catch (e) {}
        try { console.warn('[race] ' + msg); } catch (e) {}
    }

    /* 派一支施工队。opts: { team: 't1', x, y } */
    function spawnTeam(opts) {
        opts = opts || {};
        var team = opts.team || ('t' + (parseInt(localStorage.getItem('zf_race_team_seq') || '0', 10) + 1));
        localStorage.setItem('zf_race_team_seq', team.replace(/^t/, '') || '1');
        // 顺序1：先开施工现场（失败不建窗）
        /* 【修复：第2队窗跑到左上角】未传坐标时，按源对话位置 + 逐队错开(每队右下偏 60px)计算落点，
           不再依赖共享 seq 计数器/位置恢复逻辑，保证每队窗都落在可视区内 */
        if (typeof opts.x !== 'number' || typeof opts.y !== 'number') {
            try {
                var _src = opts.srcChatId ? document.getElementById(opts.srcChatId) : null;
                var _r = _src ? _src.getBoundingClientRect() : null;
                var _seqTeam = parseInt(String(team).replace(/^t/, ''), 10) || 1;
                /* 【扇形排布 v2】施工队多路沿右下扇区展开（与策划师/审核员同 ZFSpawnLayout 公式）：
                   θ=45°+i·22°，R=120+i·60，i 取队序-1；模块未加载时回落旧线性错开 */
                if (window.ZFSpawnLayout && typeof window.ZFSpawnLayout.fan === 'function') {
                    var _sw = (window.innerWidth - (_r ? _r.left : 0));
                    var _sh = (window.innerHeight - (_r ? _r.top : 0));
                    var _rp = window.ZFSpawnLayout.fan({
                        cx: _r ? _r.left : 120, cy: _r ? (_r.top + _r.height) : 120,
                        idx: _seqTeam - 1, side: 'br', vw: window.innerWidth, vh: window.innerHeight
                    });
                    opts.x = _rp.x; opts.y = _rp.y;
                } else if (_r && _r.width > 0) {
                    opts.x = Math.min(window.innerWidth - 500, Math.max(10, _r.right + 40 + (_seqTeam - 1) * 60));
                    opts.y = Math.min(window.innerHeight - 620, Math.max(60, _r.top + (_seqTeam - 1) * 60));
                } else {
                    opts.x = Math.min(window.innerWidth - 500, 120 + (_seqTeam - 1) * 60);
                    opts.y = Math.min(window.innerHeight - 620, 120 + (_seqTeam - 1) * 60);
                }
            } catch (e) {}
        }
        var repoPath = currentRepoPath(opts);
        if (!repoPath) { toast('未获取到当前项目仓库路径，无法开施工现场', false); return Promise.reject(new Error('仓库路径为空')); }
        /* 【磁盘治理 P0】限流/安全档提示：RACE_SITE_LIMIT 弹场地管理面板（自服务清场）；收队安全档由后端 worktree-remove 返回 RACE_NEED_CONFIRM */
        /* 【场地管理面板】RACE_SITE_LIMIT 时展示各场地体检明细，0-commit 场地可一键批量清 */
        function _openSiteManager(res, repoPath) {
            var health = (res && res.health) || [];
            var lines = ['⛔ ' + ((res && res.error) || '施工现场已达并发上限'), ''];
            var cleanable = [];
            health.forEach(function (h) {
                var idle = String(h.unmerged) === '0' && String(h.dirty) === '0';
                if (idle) cleanable.push(h.worktree);
                lines.push((idle ? '🟢' : '🟠') + ' ' + (h.worktree || '?').split(/[\\/]/).pop()
                    + '　未合并提交:' + h.unmerged + '　未提交改动:' + h.dirty
                    + (idle ? '（闲置可清）' : '（有工作，清除将确认）'));
            });
            lines.push('', cleanable.length ? ('其中 ' + cleanable.length + ' 个闲置场地（0提交0改动）可安全批量清除。') : '没有可安全清除的闲置场地，请手动收队。');
            if (cleanable.length && confirm(lines.join('\n') + '\n\n确认批量清除这 ' + cleanable.length + ' 个闲置场地吗？')) {
                var _done = 0;
                cleanable.forEach(function (wt) {
                    apiPost('/api/git/race/worktree-remove', { path: repoPath, worktree: wt, force: true }).then(function (r2) {
                        _done++;
                        toast((r2 && r2.ok) ? '🧹 已清场: ' + wt.split(/[\\/]/).pop() : '⚠️ 清场失败: ' + ((r2 && r2.error) || '未知'), !!!(r2 && r2.ok));
                        if (_done === cleanable.length) toast('批量清场完成（' + _done + '/' + cleanable.length + '），可重新派单', true);
                    }).catch(function () { _done++; });
                });
            } else if (!cleanable.length) {
                toast('⛔ ' + ((res && res.error) || '施工现场已达并发上限'), false);
            }
        }
        function _raceErrToast(res, repoPath) {
            if (res && res.code === 'RACE_SITE_LIMIT') {
                _openSiteManager(res, repoPath);
            } else {
                toast('⛔ ' + ((res && res.error) || '开施工现场失败'), false);
            }
        }
        return apiPost('/api/git/race/worktree-add', { team: team, path: repoPath }).then(function (res) {
            if (!res || !res.ok) {
                _raceErrToast(res, repoPath);
                /* 【体验修复】上限类错误是正常业务提示，不是异常：toast 已说明原因，
                   不再 throw（否则控制台出现 Uncaught (in promise) 像隐蔽报错）。
                   调用方通过返回 null 判断「未开成」。其他错误仍抛出便于排查。 */
                if (res && res.code === 'RACE_SITE_LIMIT') return null;
                throw new Error((res && res.error) || '开施工现场失败');
            }
            var wt = res.worktree;
            // 顺序2：找施工队角色
            return new Promise(function (resolve, reject) {
                findRole('施工队', function (role) {
                    if (!role) { reject(new Error('未找到「施工队」角色，请先在角色管理中创建')); return; }
                    // 顺序3：建窗 + 通用 cwd 绑定（worktreePath 随窗持久化）
                    try {
                        var planNote = opts.planId ? ('\n【派单计划】本队负责执行计划 ' + opts.planId +
                            '。开工前先调用 long_plan（read 操作）读取该计划全文，再 plan_batch.claim 认领本批步骤执行；只做本计划内的步骤。') : '';
                        /* 【长期目标】从 worktree 推导主项目根，取 private/计划书 下最新 .md（不写死文件名）；无目录不注入 */
                        var _projRoot = String(wt).split('\\site\\')[0] || String(wt).split('/site/')[0] || '';
                        var goalNote = _projRoot ? ('\n【长期目标·必读】先调用 list/read 工具查看 ' + _projRoot +
                            '\\private\\计划书\\ 目录，读取其中最新的 .md 计划书全文，按其长期目标与改动清单施工；如现场与计划书冲突，只上报、不得自行偏离（目录不存在则跳过，正常施工）。') : '';
                        var welcome = '👷 施工队 ' + team + ' 已进场，施工现场: ' + wt + '（分支 ' + res.branch + '）。所有操作都在该目录内进行。' + planNote + goalNote;
                        App.openRoleChat(role, {
                            x: opts.x, y: opts.y,
                            worktreePath: wt,
                            welcome: welcome
                        });
                        /* 【施工队链路修复 v2】openRoleChat 现在同步返回 chat 对象，直接用引用做箭头+派单注入，
                           彻底废弃「固定延时后盲查 DOM」的竞态写法（旧写法窗口没就绪就静默失败 → 没箭头、没派单、不干活） */
                        var _raceBox = null;
                        try {
                            var _ch = App.openRoleChat.__lastChat; /* 兼容位（未来 openRoleChat 直接 return 时用） */
                        } catch (e0) {}
                        /* openRoleChat 未返回引用的兜底：轮询 DOM（每 300ms，最多 20 次 = 6 秒），拿到就继续 */
                        (function _waitForBox(tries) {
                            tries = tries || 0;
                            var _wtSel = (window.CSS && CSS.escape) ? CSS.escape(wt) : wt.replace(/\\/g, '\\\\');
                            var boxes0 = document.querySelectorAll('[data-race-worktree="' + _wtSel + '"]');
                            _raceBox = boxes0[boxes0.length - 1] || null;
                            if (!_raceBox && tries < 20) { setTimeout(function () { _waitForBox(tries + 1); }, 300); return; }
                            if (!_raceBox) { toast('⚠️ 施工队 ' + team + ' 窗口定位失败，派单消息未注入，请手动粘贴开工消息', false); return; }
                            if (opts.srcChatId) _raceBox._raceSrcId = opts.srcChatId;
                            /* 橙色连线：源对话 ↔ 施工队窗 */
                            var _srcEl = opts.srcChatId ? document.getElementById(opts.srcChatId) : null;
                            if (_srcEl && window.ZFRaceArrow) window.ZFRaceArrow.create(_srcEl, _raceBox, team);
                            /* 派单消息注入：轮询等输入框+发送按钮就绪（每 300ms 最多 20 次） */
                            (function _inject(tries2) {
                                tries2 = tries2 || 0;
                                try {
                                    var input = _raceBox.querySelector('textarea') || _raceBox.querySelector('.chatbox-input') || _raceBox.querySelector('input[type="text"]');
                                    var btn = _raceBox.querySelector('.send-btn');
                                    if (input && btn && !input.value) {
                                        input.value = welcome;
                                        input.dispatchEvent(new Event('input', { bubbles: true }));
                                        setTimeout(function () { try { btn.click(); } catch (e2) {} }, 200);
                                        console.log('[race] 派单消息注入成功（第 ' + (tries2 + 1) + ' 次探测）');
                                    } else if (tries2 < 20) {
                                        setTimeout(function () { _inject(tries2 + 1); }, 300);
                                    } else {
                                        var _why = (!input ? '未找到输入框' : (!btn ? '未找到发送按钮' : '输入框已被占用'));
                                        console.warn('[race] 派单消息注入最终失败：' + _why);
                                        toast('⚠️ 施工队 ' + team + ' 派单消息注入失败（' + _why + '），请手动把开工消息粘贴到该窗口发送', false);
                                    }
                                } catch (eInj) { console.warn('[race] 派单注入异常', eInj); }
                            })(0);
                        })(0);
                        /* 【修复】openRoleChat 不处理 welcome 参数 → 派单消息从未注入，施工队收不到任务不干活。
                           此处补注入：等窗口就绪后把 welcome 写入输入框并触发发送（与 app-brain.js 注入口径一致） */
                        /* 【加固 v6.1】采纳审核建议：单次 400ms 注入失败会静默丢派单消息。
                           改为轮询重试（400/800/1600ms 共 3 次），窗口慢就绪也能注入；输入框被占用/最终失败时 console.warn 明示 */
                        /* 【v2】旧固定延时注入已删：新轮询注入（上方 _waitForBox/_inject）取代，避免发送后输入框清空被旧定时器二次注入 → 重复派单 */
                        // 顺序4：登记窗口↔worktree（remove 前校验活跃窗口用）
                        setTimeout(function () {
                            var boxes = document.querySelectorAll('[data-race-worktree="' + ((window.CSS && CSS.escape) ? CSS.escape(wt) : wt.replace(/\\/g, '\\\\')) + '"]');
                            var last = boxes[boxes.length - 1];
                            var cid = last ? (last.id || '') : '';
                            if (cid) {
                                apiPost('/api/git/race-window-register', { chat_id: cid, worktree: wt, team: team });
                            }
                        }, 200);
                        resolve({ ok: true, worktree: wt, branch: res.branch, team: team });
                    } catch (e) { reject(e); }
                });
            });
        });
    }

    /* 顺序5：关窗钩子——施工队窗关闭时注销登记，防 remove 误拒 + 脏注册累积（防重复 patch） */
    (function () {
        if (typeof App === 'undefined' || !App.closeChatBox) return;
        if (App._zfRaceHooked) return; /* 防脚本重复加载/热更新时二次包装 */
        App._zfRaceHooked = true;
        var _origClose = App.closeChatBox;
        App.closeChatBox = function (chat) {
            try {
                var el = chat && chat.el;
                var wt = el ? el.getAttribute('data-race-worktree') : null;
                var cid = el ? (el.id || '') : '';
                if (wt && cid) {
                    navigator.sendBeacon
                        ? navigator.sendBeacon('/api/git/race-window-unregister', new Blob([JSON.stringify({ chat_id: cid })], { type: 'application/json' }))
                        : apiPost('/api/git/race-window-unregister', { chat_id: cid });
                }
            } catch (e) {}
            return _origClose.apply(this, arguments);
        };
    })();

    window.ZFRace = { spawnTeam: spawnTeam, apiPost: apiPost, retireTeam: _retireTeam };

    /* ===== 收队 retireTeam（磁盘治理 P0-B 前端闭环）：=====
     * 真实前端收队入口（此前只能手工调 API，前端无任何调用点）。
     * 调 /api/git/race/worktree-remove：
     *   - RACE_NEED_CONFIRM → confirm() 展示后端 error 明细（未合并提交/脏文件数），确认后附 force:true 重发
     *   - RACE_SITE_LIMIT 等其他错误 → toast
     * 成功后移除该施工队窗 + 箭头连线。force 时后端会先自动提交保护再删，工作不丢。
     */
    function _retireTeam(opts) {
        opts = opts || {};
        var box = opts.chatEl || null;
        if (!box) {
            /* 兜底：按 worktree 路径找施工队窗 */
            var _sel = (window.CSS && CSS.escape) ? CSS.escape(opts.worktree || '') : (opts.worktree || '');
            box = _sel ? document.querySelector('[data-race-worktree="' + _sel + '"]') : null;
        }
        var wt = box ? box.getAttribute('data-race-worktree') : (opts.worktree || '');
        var team = (box && box._raceTeam) || opts.team || (wt ? wt.replace(/\\/g, '/').split('/').pop() : '');
        if (!wt) { toast('未找到该施工队的施工现场路径，无法收队', false); return Promise.reject(new Error('无 worktree')); }
        /* crew:// 分流：协作队无 _site_ worktree，改调 /api/crew/close 关黑板 */
        if (wt.indexOf('crew://') === 0) {
            var _cid = wt.slice(7);
            if (!opts.force && !window.confirm('确定收队协作队 ' + _cid + ' 吗？将关闭其黑板（分支现场保留，合并须走审核员）。')) {
                return Promise.reject(new Error('用户取消收队'));
            }
            return apiPost('/api/crew/close', { crew_id: _cid }).then(function (res2) {
                if (res2 && res2.ok) {
                    toast('✅ 协作队 ' + _cid + ' 黑板已关闭（分支现场保留）', true);
                    try {
                        if (window.ZFRaceArrow && window.ZFRaceArrow.getPairs) {
                            window.ZFRaceArrow.getPairs().forEach(function (p) {
                                var rb = (p.race && p.race.el) || p.race;
                                if (rb && rb.getAttribute && rb.getAttribute('data-race-worktree') === wt) p.dead = true;
                            });
                        }
                    } catch (eA) {}
                    try {
                        var _sel3 = (window.CSS && CSS.escape) ? CSS.escape(wt) : wt;
                        document.querySelectorAll('[data-race-worktree="' + _sel3 + '"]').forEach(function (b) {
                            if (window.App && App.closeChatBox) App.closeChatBox({ el: b }); else if (b.parentNode) b.parentNode.removeChild(b);
                        });
                    } catch (eC) {}
                    try { var raw = JSON.parse(localStorage.getItem('zf_race_arrows') || '[]');
                        localStorage.setItem('zf_race_arrows', JSON.stringify(raw.filter(function (o) { return o && o.worktree !== wt; }))); } catch (eL) {}
                    return res2;
                }
                toast('⛔ 收队失败: ' + ((res2 && res2.error) || '未知错误'), false);
                return res2;
            }).catch(function (e2) {
                if (e2 && e2.message === '用户取消收队') return null;
                toast('⛔ 收队请求异常: ' + (e2 && e2.message || e2), false);
                throw e2;
            });
        }
        if (!opts.force && !window.confirm('确定收队 ' + team + ' 吗？施工现场 ' + wt + ' 与其分支将被删除。')) {
            return Promise.reject(new Error('用户取消收队'));
        }
        return apiPost('/api/git/race/worktree-remove', { path: currentRepoPath({}), worktree: wt, force: !!opts.force }).then(function (res) {
            if (res && res.ok) {
                toast('✅ 施工队 ' + team + ' 已收队，施工现场已清理', true);
                /* 移除箭头连线 + 关闭施工队窗 */
                try {
                    if (window.ZFRaceArrow && window.ZFRaceArrow.getPairs) {
                        window.ZFRaceArrow.getPairs().forEach(function (p) {
                            var rb = (p.race && p.race.el) || p.race;
                            if (rb && rb.getAttribute && rb.getAttribute('data-race-worktree') === wt) p.dead = true;
                        });
                    }
                } catch (eA) {}
                try {
                    var _sel2 = (window.CSS && CSS.escape) ? CSS.escape(wt) : wt.replace(/\\/g, '\\\\');
                    document.querySelectorAll('[data-race-worktree="' + _sel2 + '"]').forEach(function (b) {
                        if (window.App && App.closeChatBox) App.closeChatBox({ el: b }); else if (b.parentNode) b.parentNode.removeChild(b);
                    });
                } catch (eC) {}
                try { var raw = JSON.parse(localStorage.getItem('zf_race_arrows') || '[]');
                    localStorage.setItem('zf_race_arrows', JSON.stringify(raw.filter(function (o) { return o && o.worktree !== wt; }))); } catch (eL) {}
                return res;
            }
            if (res && res.code === 'RACE_NEED_CONFIRM') {
                /* 安全档：拦得住也要接得住——展示明细，确认后 force 重试（后端会先自动提交保护工作） */
                if (window.confirm('⚠️ ' + team + ' 有未收尾改动：\n' + (res.error || '') +
                    '\n\n点「确定」将自动提交保护后强制收队；点「取消」保留现场。')) {
                    return _retireTeam({ chatEl: box, worktree: wt, team: team, force: true });
                }
                toast('已保留 ' + team + ' 的施工现场', true);
                return res;
            }
            if (res && res.code === 'RACE_SITE_LIMIT') {
                toast('⛔ ' + (res.error || '施工现场已达并发上限'), false);
            } else {
                toast('⛔ 收队失败: ' + ((res && res.error) || '未知错误'), false);
            }
            return res;
        }).catch(function (e) {
            if (e && e.message === '用户取消收队') return null;
            toast('⛔ 收队请求异常: ' + (e && e.message || e), false);
            throw e;
        });
    }

    /* ===== ZFRaceArrow v2：与策划师/审核员同款方向箭头（橙色·施工中徽章·可点击回注） =====
 * 与 chatbox-thinker-arrow.js 同构：div+SVG 粗线+三角箭头+状态徽章，跟随两窗移动，
 * 点击箭头把该队施工摘要回注源对话；中点下方「回注/收队」小按钮组不随箭头旋转。
 * 另挂「🧹 一键收队全部」浮动按钮：一次回收当前所有施工队（错峰逐队走安全确认闭环）。
 */
var RaceArrow = (function () {
    if (window.ZFRaceArrow) return window.ZFRaceArrow; /* 防热更新重复注册 */
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var ORANGE = '#f59e0b';
    var pairs = [];

    /* 【自动回收修复】读取数量弹窗勾选的一次性标志（60 秒内有效），施工队箭头此前从未消费该标志导致勾选无效 */
    function autoGatherOn() {
        try { var t = window._zfAutoGatherNext; return !!(t && (Date.now() - t) < 60000); } catch (e) { return false; }
    }
    /* 【自动回收·多角色全回收】每 3 秒检查一次：标志有效且「全部」未回注队伍均已产出非空回复 → 才统一自动回注源对话。
       v4：改为全员就绪门槛——不再某队一有回复就先回收，而是等所有存活施工队都有回复后一起回收，保证汇总完整；
       按时间戳凭证各队各消费一次（p._gatherUsedAt 记录已消费的时间戳，同一时间戳不重复触发），60 秒后标志自然过期 */
    setInterval(function () {
        /* v5：凭证即将过期且仍有未回收队伍时提示一次（防静默失效，_zfGatherExpireWarned 防重发） */
        var t0 = window._zfAutoGatherNext;
        if (t0 && (Date.now() - t0) > 45000 && (Date.now() - t0) < 60000 && !window._zfGatherExpireWarned) {
            var pendingN = pairs.filter(function (p) { return !p.dead && p.state === 'construction' && p._gatherUsedAt !== t0; }).length;
            if (pendingN) {
                window._zfGatherExpireWarned = true;
                if (typeof toast === 'function') toast('⏰ 自动回收凭证即将过期，仍有 ' + pendingN + ' 队未回收；如需继续请在数量弹窗重新勾选', false);
            }
        }
        if (!autoGatherOn()) return;
        var t = window._zfAutoGatherNext;
        var alive = pairs.filter(function (p) { return !p.dead && p.state === 'construction' && p._gatherUsedAt !== t; });
        if (!alive.length) return;
        /* 全员就绪检查：任何一支队伍还没有非空回复，就先不回收，等下一轮再查；
           v5：失败/报错回复（短报错文案）不算就绪，避免把失败结果当成功回收 */
        function isErrText(s) {
            s = String(s || '').trim();
            if (!s || s.length > 120) return false;
            return /^(请求失败|调用失败|发送失败|回复失败|生成失败|连接失败|超时|网络错误|接口错误|服务不可用|\[ERR|Error:|错误[:：])/i.test(s);
        }
        var allReady = alive.every(function (p) {
            var race = elOf(p.race);
            if (!race) return false;
            var lastA = null;
            if (race._chatHistory) {
                for (var i = race._chatHistory.length - 1; i >= 0; i--) {
                    if (race._chatHistory[i].role === 'assistant') { lastA = String(race._chatHistory[i].content || '').trim(); break; }
                }
            } else {
                lastA = (race.textContent || '').trim();
            }
            return lastA && !isErrText(lastA);
        });
        if (!allReady) return;
        alive.forEach(function (p, i) {
            p._gatherUsedAt = t;
            setTimeout(function () { if (!p.dead && p.state === 'construction') onArrowClick(p); }, i * 800);
        });
    }, 3000);
    var hitLayer = document.getElementById('zf-race-arrow-hitlayer');
    if (!hitLayer) {
        hitLayer = document.createElement('div');
        hitLayer.id = 'zf-race-arrow-hitlayer';
        hitLayer.setAttribute('style', 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9999;');
        document.body.appendChild(hitLayer);
    }
    function elOf(c) { return (c && c.el) || (typeof c === 'string' ? document.getElementById(c) : c) || null; }
    function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

    function injectResult(p) {
        var src = elOf(p.src), race = elOf(p.race);
        if (!src || !race) { toast('连线已失效，无法回注', false); return; }
        var wt = race.getAttribute('data-race-worktree') || '';
        var team = p.team || race._raceTeam || '';
        /* crew:// 分流：协作队窗不是赛马 worktree，改读黑板 done 摘要回注 */
        if (wt.indexOf('crew://') === 0) {
            var cid = wt.slice(7);
            toast('⏳ 正在读取协作队 ' + cid + ' 的黑板摘要…', true);
            apiPost('/api/crew/board', { crew_id: cid }).then(function (res) {
                if (!res || !res.ok) { toast('读取协作黑板失败: ' + ((res && res.error) || '未知错误'), false); return; }
                var lines = ((res.board && res.board.slices) || []).map(function (s) {
                    return '- [' + s.status + '] ' + s.id + (s.done_summary ? ': ' + s.done_summary : '');
                });
                var text = '【协作结果·' + cid + '】黑板分片摘要:\n' + (lines.join('\n') || '（无分片）');
                setPairState(p, 'injecting');
                var input = src.querySelector('textarea') || src.querySelector('.chatbox-input') || src.querySelector('input[type="text"]');
                var btn = src.querySelector('.send-btn');
                var ta = (input && input.tagName === 'TEXTAREA') ? input : (src.querySelector('textarea') || input);
                if (ta && btn) {
                    ta.focus();
                    ta.value = text;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    /* 【v25】给 Vue/原生框架留 2 帧同步 v-model 的时机，再点发送（与施工队分支对齐）；
                       发送后校验：若输入框仍残留回注文本，说明发送未生效，自动重试一次，仍失败则提示 */
                    requestAnimationFrame(function () { requestAnimationFrame(function () {
                        ta.value = text;
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                        setTimeout(function () {
                            try { btn.click(); } catch (e) {}
                            setTimeout(function () {
                                try {
                                    if (ta.value === text) {
                                        btn.click();
                                        setTimeout(function () {
                                            if (ta.value === text) { toast('⛔ 协作队 ' + cid + ' 回注发送未生效，请检查源对话是否已关闭', false); setPairState(p, 'done'); }
                                            else { toast('✅ 协作队 ' + cid + ' 的黑板摘要已回注源对话', true); setPairState(p, 'done'); }
                                        }, 500);
                                    } else { toast('✅ 协作队 ' + cid + ' 的黑板摘要已回注源对话', true); setPairState(p, 'done'); }
                                } catch (e2) {}
                            }, 600);
                        }, 150);
                    });
                    });
                } else {
                    toast('源对话输入框不可用，摘要已打印控制台', false);
                    try { console.log('[crew] 回注内容:\n' + text); } catch (e) {}
                    setPairState(p, 'done');
                }
            });
            return;
        }
        toast('⏳ 正在读取施工队 ' + team + ' 的改动摘要…', true);
        apiPost('/api/git/race/diff-summary', { path: currentRepoPath({}), worktree: wt }).then(function (res) {
            if (!res || !res.ok) { toast('读取施工摘要失败: ' + ((res && res.error) || '未知错误'), false); return; }
            var text = '【施工结果·' + team + '】施工现场: ' + wt + '\n改动摘要:\n' + (res.summary || '（无改动）');
            /* 状态机：进入回注中 */
            setPairState(p, 'injecting');
            var input = src.querySelector('textarea') || src.querySelector('.chatbox-input') || src.querySelector('input[type="text"]');
            var btn = src.querySelector('.send-btn');
            if (input && btn) {
                input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                setTimeout(function () {
                    try { btn.click(); } catch (e) {}
                    /* 【v24】发送后校验：若输入框仍残留回注文本，说明发送未生效，自动重试一次 */
                    setTimeout(function () {
                        try {
                            if (input.value === text) {
                                btn.click();
                                setTimeout(function () {
                                    if (input.value === text) { toast('⛔ 回注发送未生效，请检查源对话是否已关闭', false); setPairState(p, 'done'); }
                                    else { toast('✅ 施工队 ' + team + ' 的结果已回注源对话', true); setPairState(p, 'done'); }
                                }, 500);
                            } else { toast('✅ 施工队 ' + team + ' 的结果已回注源对话', true); setPairState(p, 'done'); }
                        } catch (e2) {}
                    }, 600);
                }, 150);
            } else {
                toast('源对话输入框不可用，结果已复制要点：' + (res.summary || ''), false);
                try { console.log('[race] 回注内容:\n' + text); } catch (e) {}
                setPairState(p, 'done');
            }
        });
    }

    /* ===== 状态机：construction(施工中) → done(施工完成) → injecting(回注中) → injected(回注完成/反向绿箭头) → suspended(已收队挂起/灰) =====
     * 【v21 箭头往复】回注完成后不再自动收队删除箭头：箭头翻转向源对话并变绿（与策划师/审核师同款交互），
     * 点击可重新回注或收队；收队后箭头变灰挂起保留，点「重新开工」可复活继续施工，来回往复。 */
    var STATE_LABEL = { construction: '施工中', done: '施工完成', injecting: '回注中', injected: '回注完成', suspended: '已收队' };
    var STATE_COLOR = { construction: '#f59e0b', done: '#22c55e', injecting: '#3b82f6', injected: '#22c55e', suspended: '#9ca3af' };
    function setPairState(p, st) {
        if (!p || p.state === st) return;
        p.state = st;
        try { applyStateStyle(p); } catch (e) {}
        persist();
        refreshAllBtn();
    }
    /* 【v21】injected 后箭头视觉翻转：整体旋转 180° 指向源对话，徽章反向旋回保持可读 */
    function applyStateStyle(p) {
        if (!p || !p.el) return;
        var injectedLike = (p.state === 'injected' || p.state === 'suspended');
        p.el.style.transition = 'filter .3s';
        p.el.style.filter = injectedLike
            ? 'drop-shadow(0 0 8px rgba(34,197,94,.9))'
            : 'drop-shadow(0 0 8px rgba(245,158,11,.9))';
        p._flip = !!injectedLike;
        var tipMap = {
            construction: '点击：把该队施工摘要回注源对话',
            done: '点击：把该队施工摘要回注源对话',
            injecting: '回注中，请稍候…',
            injected: '点击：重新回注 / 收队（收队后可再次开工，往复使用）',
            suspended: '点击：重新开工（恢复原队继续施工）'
        };
        p.el.title = tipMap[p.state || 'construction'] || p.el.title;
    }
    function onArrowClick(p) {
        if (p.state === 'injecting') { toast('该队正在回注中，请稍候…', false); return; }
        if (p.state === 'injected') {
            zfConfirm('协作队 ' + (p.team || '?') + ' 已回注完成。\n\n确认或取消：\n「确认收队」= 挂起收队（关闭施工窗、保留黑板与箭头，之后可重新开工）；\n「重新回注」= 再次把施工摘要回注源对话。', function () {
                retireOne(p, { force: false });
            }, function () {
                p.state = 'done';
                injectResult(p);
            }, { okText: '确认收队', noText: '重新回注' });
            return;
        }
        if (p.state === 'suspended') { resumePair(p); return; }        injectResult(p);
    }
    /* 【v21】挂起队重新开工：恢复 construction 状态，箭头翻回正向，施工窗由 chatbox-crew 侧重建。
       【v22 收口】从 worktree 属性(crew://<id>)提取 crew_id、取 p.srcId 传给 resumeCrew，
       多队挂起时各自复活各自的队，不再硬取 zf_crew_recent[0] 串台。 */
    function resumePair(p) {
        /* 【v24】非协作队（_site_ 施工队）：纯前端复活，箭头翻回正向即可继续施工/回注 */
        var raceElR = elOf(p.race);
        var wtR = (raceElR && raceElR.getAttribute && raceElR.getAttribute('data-race-worktree')) || '';
        if (wtR.indexOf('crew://') !== 0) {
            setPairState(p, 'construction');
            toast('🐝 施工队 ' + (p.team || '?') + ' 已重新开工', true);
            return;
        }
        if (window.ZFCrew && ZFCrew.resumeCrew) {
            var raceEl2 = elOf(p.race);
            var wt2 = (raceEl2 && raceEl2.getAttribute && raceEl2.getAttribute('data-race-worktree')) || '';
            var cid = wt2.indexOf('crew://') === 0 ? wt2.slice(7) : '';
            var ok = ZFCrew.resumeCrew(p.team || '', { crewId: cid, srcChatId: p.srcId || null });
            if (ok === false) return;
        } else {
            toast('⚠️ 前端未加载协作队模块，无法重新开工', false);
            return;
        }
        setPairState(p, 'construction');
        toast('🐝 协作队 ' + (p.team || '?') + ' 已重新开工', true);
    }

    /* opts.silent: 一键收队路径；【v21】协作队(crew://)收队改为「挂起」：关施工窗+箭头变灰转 suspended，
       不删连线不删 crew_id，点箭头可重新开工；回笼合并成功后的真正收口走 /api/crew/close（后端仍校验全 done）。 */
    function retireOne(p, opts) {
        opts = opts || {};
        var raceEl = elOf(p.race);
        if (!raceEl) { killPair(p); return; }
        var wtAttr = raceEl.getAttribute ? (raceEl.getAttribute('data-race-worktree') || '') : '';
        /* 【v21】crew:// 协作队收队 = 纯前端「挂起」：关闭施工窗 + 箭头变灰转 suspended。
         * 黑板保持 open 不调 /api/crew/close（真正的收口关闭由回笼合并成功后统一触发），
         * 因此黑板与 crew_id 完整保留，点挂起箭头即可用原 crew_id 重新开工，来回往复。
         * 不再走 ZFRace.retireTeam（该路径会 markDead+删箭头，且 CREW_NOT_ALL_DONE 语义不符）。 */
        if (wtAttr.indexOf('crew://') === 0) {
            /* 【v23】收队不再立即关闭施工对话窗：仅转 suspended（箭头变灰悬空可点复活），施工窗保留可继续看黑板。
             * 用户想关窗时手动点窗的关闭按钮，关窗后箭头由 tick 守护一并清除。 */
            setPairState(p, 'suspended');
            toast('🐝 协作队 ' + (p.team || '?') + ' 已收队挂起（施工窗保留，关闭窗后箭头一并收回，点击箭头可重新开工）', true);
            return;
        }
        /* 【v24 收队=挂起】施工队与协作队统一：收队只挂起（箭头变灰保留、施工窗保留），不再删箭头；点灰箭头可重新开工往复。
         * 后端 worktree-remove 尽力而为：窗口仍开着可能被拒（仍被活跃窗口引用），挂起不受影响，现场可稍后清。 */
        setPairState(p, 'suspended');
        toast('🐝 施工队 ' + (p.team || '?') + ' 已收队挂起（施工窗与箭头保留，点击灰箭头可重新开工）', true);
        if (window.ZFRace && ZFRace.retireTeam) {
            ZFRace.retireTeam({ chatEl: raceEl, team: p.team || '', force: !!opts.force })
                .catch(function (err) {
                    var msg = (err && err.message) || '';
                    if (msg.indexOf('用户取消') === -1) console.warn('[RaceArrow] 现场清理暂缓（挂起保留，可稍后清场）:', p.team, msg);
                });
        }
    }
    /* 彻底移除一条连线：箭头元素 + 中点按钮/指令框 + 存储记录，确保收队/关窗后不残留 */
    function killPair(p) {
        p.dead = true;
        try { if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el); } catch (e) {}
        try { if (p.hit && p.hit.parentNode) p.hit.parentNode.removeChild(p.hit); } catch (e) {}
        try { if (p.cmdBox && p.cmdBox.parentNode) p.cmdBox.parentNode.removeChild(p.cmdBox); } catch (e) {}
        pairs = pairs.filter(function (x) { return x !== p; });
        persist();
        refreshAllBtn();
    }

    /* 【v11】中点小按钮组已移除：箭头返回即回注+自动收队，无需回注/收队按钮（箭头本身可点） */
    function makeHit(p) { return null; }

    function draw(p) {
        var a = elOf(p.src), b = elOf(p.race);
        /* 【v21】suspended（已收队）且施工窗还开着：正常按窗体位置画箭头（不再需要锚点） */
        /* 【v23】施工窗已被关闭（suspended 状态下 b 消失）→ 箭头一并收回，不再残留悬空箭头 */
        if (p.state === 'suspended' && (!b || !b.isConnected)) { killPair(p); return; }
        if (!a || !b || !p.el || !p.el.isConnected) {
            killPair(p); return;
        }
        var ca = center(a), cb = center(b);
        drawBody(p, ca, cb, (ca.x + cb.x) / 2, (ca.y + cb.y) / 2);
    }
    function drawBody(p, ca, cb, mx, my) {
        p.el.style.left = (mx - 120) + 'px';
        p.el.style.top = (my - 36) + 'px';
        var ang = Math.atan2(cb.y - ca.y, cb.x - ca.x) * 180 / Math.PI;
        /* 【v21】回注完成/已收队：箭头整体旋转 180°，尖端反向指向源对话（与策划师/审核师同款） */
        var flip = (p.state === 'injected' || p.state === 'suspended') ? 180 : 0;
        var svg = p.el.querySelector('svg');
        if (svg) {
            svg.style.transformOrigin = '120px 36px';
            svg.style.transform = 'rotate(' + (ang + flip) + 'deg)';
        }
        var badge = p.el.querySelector('.ta-badge');
        if (badge) {
            badge.style.transformOrigin = '120px 36px';
            badge.style.transform = 'rotate(' + (-(ang + flip)) + 'deg)';
        }
        var label = (STATE_LABEL[p.state || 'construction'] || '施工中') + ' · ' + (p.team || '?');
        var t = p.el.querySelector('.ta-badge-text');
        if (t && t.textContent !== label) t.textContent = label;
    }

    function tick() {
        try {
            pairs.forEach(function (p) { if (!p.dead) draw(p); });
            pairs = pairs.filter(function (p) { return !p.dead; });
            /* 【v22】总箭头并入每帧刷新：原来只靠 1.2s 轮询，拖窗时滞后卡顿，与其他箭头不顺滑 */
            if (pairs.length >= 2 || allArrowEl) refreshAllArrow();
        } finally { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);

    function persist() { try { localStorage.setItem('zf_race_arrows', JSON.stringify(pairs.map(function (p) { return { srcId: p.srcId, raceId: p.raceId, team: p.team, state: p.state || 'construction' }; }))); } catch (e) {} }

    /* ===== 一键收队全部（总箭头，与审核/策划同款交互：>=2 支队伍时在连线群中间出现一枚汇聚总箭头，点击自设计弹层确认后一键收队） ===== */
    var allBtn = null; /* 兼容保留（refreshAllBtn 外部有调用），v10 起不再挂右下角浮动按钮 */
    /* 自设计确认弹层（替代 Windows 原生 confirm 弹窗） */
    function zfConfirm(msg, onOk, onCancel, opts) {
        opts = opts || {};
        var ov = document.createElement('div');
        ov.setAttribute('style', 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;');
        var box = document.createElement('div');
        box.setAttribute('style', 'background:#1f2937;color:#f3f4f6;border:1px solid #f59e0b;border-radius:12px;padding:18px 20px;max-width:380px;font-family:inherit;box-shadow:0 8px 30px rgba(0,0,0,.5);');
        var tip = document.createElement('div');
        tip.setAttribute('style', 'font-size:13px;line-height:1.6;white-space:pre-wrap;');
        tip.textContent = msg;
        var row = document.createElement('div');
        row.setAttribute('style', 'margin-top:14px;display:flex;gap:10px;justify-content:flex-end;');
        var yes = document.createElement('button');
        yes.textContent = opts.okText || '确认收队';
        var no = document.createElement('button');
        no.textContent = opts.noText || '取消';
        no.setAttribute('style', 'background:#374151;color:#d1d5db;border:1px solid #4b5563;border-radius:8px;padding:5px 14px;font-size:12px;cursor:pointer;font-family:inherit;');
        no.onclick = function (e) { e.stopPropagation(); close(); onCancel && onCancel(); };
        yes.setAttribute('style', 'background:#f59e0b;color:#fff;border:1px solid #b45309;border-radius:8px;padding:5px 14px;font-size:12px;font-weight:bold;cursor:pointer;font-family:inherit;');
        function close() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
        yes.onclick = function (e) { e.stopPropagation(); close(); onOk && onOk(); };
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        row.appendChild(no); row.appendChild(yes);
        box.appendChild(tip); box.appendChild(row);
        ov.appendChild(box);
        document.body.appendChild(ov);
    }
    /* 总箭头元素（>=2 支活跃队伍时显示，跟随连线群包围盒中心） */
    var allArrowEl = null;
    function refreshAllArrow() {
        var alive = pairs.filter(function (p) { return !p.dead; });
        var need = alive.length >= 2;
        if (!need) {
            if (allArrowEl && allArrowEl.parentNode) allArrowEl.parentNode.removeChild(allArrowEl);
            allArrowEl = null;
            return;
        }
        if (!allArrowEl) {
            allArrowEl = document.createElement('div');
            allArrowEl.className = 'zf-race-all-arrow';
            allArrowEl.style.cssText = 'position:fixed;left:0;top:0;z-index:6000;cursor:pointer;pointer-events:auto;user-select:none;filter:drop-shadow(0 0 10px rgba(245,158,11,.95));';
            /* 【v21】汇聚总箭头造型：粗杆+双翼箭簇，居中「收全部」徽章；旋转由 refreshAllArrow 按 angle 驱动 */
            allArrowEl.innerHTML =
                '<svg width="200" height="64" viewBox="0 0 200 64" xmlns="' + SVG_NS + '" style="overflow:visible">'
                + '<line x1="6" y1="32" x2="118" y2="32" stroke="' + ORANGE + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 10"/>'
                + '<polygon points="112,4 194,32 112,60" fill="' + ORANGE + '" stroke="#fcd34d" stroke-width="3"/>'
                + '<g class="ta-all-badge"><rect x="52" y="17" width="76" height="30" rx="15" fill="#b45309" opacity="0.96"/><text class="ta-all-text" x="90" y="37" text-anchor="middle" font-size="13" font-weight="bold" fill="#fff" font-family="sans-serif">收全部</text></g>'
                + '<style>.zf-race-all-arrow line{animation:zfrFlow2 1s linear infinite;}@keyframes zfrFlow2{to{stroke-dashoffset:-24;}}</style>'
                + '</svg>';
            allArrowEl.title = '一键回收全部施工队（收队=挂起：关施工窗、黑板与 crew_id 保留，点各队灰箭头可重新开工往复）';
            allArrowEl.addEventListener('click', function (ev) {
                ev.stopPropagation();
                var alive2 = pairs.filter(function (p) { return !p.dead; });
                if (!alive2.length) return;
                /* 【v25 审核员式两段回收】第一段=回收：逐队把施工/协作结果回注源对话（错峰）；
                   全部回注完成后（injected/suspended）再点=第二段收队挂起 */
                var pend = alive2.filter(function (p) { return p.state !== 'injected' && p.state !== 'suspended'; });
                if (pend.length) {
                    pend.forEach(function (p, i) {
                        setTimeout(function () { try { injectResult(p); } catch (e) {} }, i * 500);
                    });
                } else {
                    alive2.forEach(function (p, i) {
                        setTimeout(function () { retireOne(p, { force: true }); }, i * 500);
                    });
                }
            });
            document.body.appendChild(allArrowEl);
        }
        /* 【v21】总箭头 = 所有队箭头的汇聚点：取各连线中点的平均中心；
           造型改为汇聚箭头（两支箭头之间、方向指向源对话侧） */
        var midSumX = 0, midSumY = 0, midN = 0, srcAvgX = 0, srcAvgY = 0;
        alive.forEach(function (p) {
            var a = elOf(p.src), b = elOf(p.race);
            if (!a) { b && p._raceAnchor && (midSumX += p._raceAnchor.x, midSumY += p._raceAnchor.y, midN++, srcAvgX += p._raceAnchor.x, srcAvgY += p._raceAnchor.y); return; }
            if (!b) { if (p._raceAnchor) { var _ca = center(a); midSumX += (_ca.x + p._raceAnchor.x) / 2; midSumY += (_ca.y + p._raceAnchor.y) / 2; midN++; srcAvgX += _ca.x; srcAvgY += _ca.y; } return; }
            var ca = center(a), cb = center(b);
            midSumX += (ca.x + cb.x) / 2; midSumY += (ca.y + cb.y) / 2;
            srcAvgX += ca.x; srcAvgY += ca.y; midN++;
        });
        if (!midN) midN = 1;
        var midX = midSumX / midN, midY = midSumY / midN;
        var _sax = srcAvgX / midN, _say = srcAvgY / midN;
        /* 朝向：施工中从汇聚中心指向源对话侧；全部队伍已回注/收队后整体旋转 180°（与单箭头 injected 反转语义一致） */
        var _aliveList = pairs.filter(function (q) { return !q.dead; });
        var _doneN = _aliveList.filter(function (q) { return q.state === 'injected' || q.state === 'suspended'; }).length;
        var _allFlip = (_aliveList.length > 0 && _doneN === _aliveList.length) ? 180 : 0;
        //【修复】总箭头（回收全部）：未收队时指向施工队方向(+180)，全部回注后翻回源对话方向——与单箭头语义一致，点击动作不再"反向"
        var allAng = Math.atan2(_say - midY, _sax - midX) * 180 / Math.PI + (180 - _allFlip);
        allArrowEl.style.left = (midX - 100) + 'px';
        allArrowEl.style.top = (midY - 32) + 'px';
        var _asvg = allArrowEl.querySelector('svg');
        if (_asvg) {
            _asvg.style.transformOrigin = '100px 32px';
            _asvg.style.transform = 'rotate(' + allAng + 'deg)';
        }
        allArrowEl.style.filter = _allFlip ? 'drop-shadow(0 0 8px rgba(34,197,94,.9))' : 'drop-shadow(0 0 8px rgba(245,158,11,.9))';
            var _allDone = _aliveList.length > 0 && _doneN === _aliveList.length;
            var _allBadge = allArrowEl.querySelector('.ta-all-text');
            if (_allBadge) _allBadge.textContent = _allDone ? '收队' : '回收';
        allArrowEl.title = _allFlip ? '全部施工队已回收/收队（箭头已反向指向源对话，点「收队」挂起全部并收回施工窗）' : '一键回收全部施工队（第1段：逐队把结果回注源对话；全部回注完成后再点=第2段收队挂起）';
    }
    function refreshAllBtn() { refreshAllArrow(); }
    /* 保留：对外导出 refreshAllBtn 供外部调用；1.2s 轮询仅作兜底，主驱动为 tick() 每帧刷新 */
    setInterval(refreshAllBtn, 1200);

    function _create(srcChat, raceChat) {
        var s = elOf(srcChat), r = elOf(raceChat);
        if (!s || !r) return null;
        /* 同款去重：同源同队已连线则不重复建 */
        for (var i = 0; i < pairs.length; i++) {
            if (pairs[i].srcId === (s.id || '') && pairs[i].raceId === (r.id || '') && pairs[i].el && pairs[i].el.isConnected) return pairs[i];
        }
        var el = document.createElement('div');
        el.className = 'zf-race-arrow';
        el.style.cssText = 'position:fixed;left:0;top:0;z-index:5000;cursor:pointer;pointer-events:auto;'
            + 'filter:drop-shadow(0 0 8px rgba(245,158,11,.9));user-select:none;';
        el.innerHTML =
            '<svg width="240" height="72" viewBox="0 0 240 72" xmlns="' + SVG_NS + '" style="overflow:visible">'
            + '<line x1="6" y1="36" x2="168" y2="36" stroke="' + ORANGE + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 10"/>'
            + '<polygon points="162,6 234,36 162,66" fill="' + ORANGE + '" stroke="#fcd34d" stroke-width="3"/>'
            + '<g class="ta-badge">'
            + '<rect x="86" y="20" width="68" height="30" rx="15" fill="' + ORANGE + '" opacity="0.95"/>'
            + '<text class="ta-badge-text" x="120" y="41" text-anchor="middle" font-size="14" font-weight="bold" fill="#3b2205" font-family="sans-serif">施工中</text>'
            + '</g>'
            + '<style>.zf-race-arrow line{animation:zfrFlow 1s linear infinite;}@keyframes zfrFlow{to{stroke-dashoffset:-24;}}</style>'
            + '</svg>';
        el.title = '点击：把该队施工摘要回注源对话（施工中/施工完成可点，回注完成后不再重复）';
        el.addEventListener('click', function (ev) { ev.stopPropagation(); onArrowClick(p); });
        document.body.appendChild(el);
        var p = { src: s, race: r, el: el, hit: null, dead: false, state: 'construction',
            srcId: s.id || '', raceId: r.id || '', team: (raceChat && raceChat._raceTeam) || '' };
        pairs.push(p); persist(); refreshAllBtn();
        return p;
    }
    /* 刷新恢复：按 id 找回元素 */
    setTimeout(function restore() {
        try {
            var raw = JSON.parse(localStorage.getItem('zf_race_arrows') || '[]');
            raw.forEach(function (o) {
                var a = document.getElementById(o.srcId), b = document.getElementById(o.raceId);
                if (a && b) { o.team && (b._raceTeam = o.team); var _p = _create(a, b); if (_p && o.state) _p.state = o.state; }
            });
        } catch (e) {}
    }, 2500);
    return { create: function (s, r, team) { try { r._raceTeam = team || ''; } catch (e) {} return _create(s, r); }, getPairs: function () { return pairs; }, refreshAllBtn: refreshAllBtn,
        states: STATE_LABEL };
})();

/* ===== 每队独立指令输入框（类似策划师的单独命令）+ 大模型指令 API ===== */
(function () {
    'use strict';
    function ensureCmdBox(p) {
        if (p.cmdBox && p.cmdBox.isConnected) return p.cmdBox;
        var wrap = document.createElement('div');
        wrap.setAttribute('style', 'position:fixed;z-index:10001;display:flex;gap:4px;pointer-events:auto;user-select:none;');
        var inp = document.createElement('input');
        inp.placeholder = '对该队下达指令…';
        inp.setAttribute('style', 'width:170px;background:#1f2937;color:#f3f4f6;border:1px solid #f59e0b;border-radius:10px;padding:3px 8px;font-size:11px;font-family:inherit;outline:none;');
        var go = document.createElement('button');
        go.textContent = '➤';
        go.title = '把指令发送到该施工队对话窗';
        go.setAttribute('style', 'background:#f59e0b;color:#fff;border:1px solid #b45309;border-radius:10px;padding:3px 9px;font-size:11px;font-family:inherit;cursor:pointer;');
        function send() {
            var v = (inp.value || '').trim();
            if (!v) return;
            if (sendCmdToTeam(p, v)) { inp.value = ''; }
        }
        go.addEventListener('click', function (ev) { ev.stopPropagation(); send(); });
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.stopPropagation(); send(); } });
        wrap.appendChild(inp); wrap.appendChild(go);
        document.body.appendChild(wrap);
        p.cmdBox = wrap;
        return wrap;
    }
    /* 把指令注入该队施工对话窗并自动发送（与派单注入同口径） */
    function sendCmdToTeam(p, text) {
        var race = (p && p.race && p.race.isConnected) ? p.race : (p && typeof p.race === 'string' ? document.getElementById(p.race) : null);
        if (!race) { toast('该队对话窗已关闭，无法下达指令', false); return false; }
        var input = race.querySelector('textarea') || race.querySelector('.chatbox-input') || race.querySelector('input[type="text"]');
        var btn = race.querySelector('.send-btn');
        if (!input || !btn) { toast('未找到该队输入框', false); return false; }
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(function () { try { btn.click(); } catch (e) {} }, 120);
        toast('📨 指令已发给施工队 ' + (p.team || '?'), true);
        return true;
    }
    /* 大模型可调用的集体收队：ZFRaceControl.retireAll({force:true}) —— 无弹窗（供模型自动操作）；默认带保护，force:true 才强收；异步错峰执行，立即返回启动确认 */
    function retireAllTeams(opts) {
        opts = opts || {};
        var alive = (window.ZFRaceArrow && ZFRaceArrow.getPairs ? ZFRaceArrow.getPairs() : []).filter(function (p) { return !p.dead; });
        var n = 0;
        alive.forEach(function (p, i) {
            setTimeout(function () {
                var raceEl = p.race && p.race.isConnected ? p.race : null;
                if (raceEl && window.ZFRace && ZFRace.retireTeam) {
                    ZFRace.retireTeam({ chatEl: raceEl, team: p.team || '', force: opts.force === true })
                        .then(function () { p.dead = true; ZFRaceArrow.refreshAllBtn(); })
                        .catch(function (e) { console.warn('[race] 模型收队失败:', p.team, e && e.message); });
                    n++;
                }
            }, i * 500);
        });
        return { ok: true, teams: alive.length, note: '错峰收队已启动' };
    }
    /* 中点按钮组追加「💬」按钮打开指令框 */
    setInterval(function () {
        var pairs = (window.ZFRaceArrow && ZFRaceArrow.getPairs ? ZFRaceArrow.getPairs() : []) || [];
        pairs.forEach(function (p) {
            if (p.dead) { if (p.cmdBox && p.cmdBox.parentNode) p.cmdBox.parentNode.removeChild(p.cmdBox); return; }
            if (p.hit && !p.cmdBtnAdded) {
                p.cmdBtnAdded = true;
                var b = document.createElement('button');
                b.textContent = '💬';
                b.title = '对该施工队单独下达指令';
                b.setAttribute('style', 'background:#3b82f6;color:#fff;border:1px solid #1d4ed8;border-radius:10px;padding:1px 8px;font-size:11px;font-family:inherit;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);');
                b.addEventListener('click', function (ev) { ev.stopPropagation(); var box = ensureCmdBox(p); box.style.display = (box.style.display === 'none') ? 'flex' : 'none'; });
                p.hit.appendChild(b);
            }
            /* 指令框跟随连线中点 */
            if (p.cmdBox && p.cmdBox.isConnected && p.hit) {
                p.cmdBox.style.left = p.hit.style.left;
                p.cmdBox.style.top = (parseFloat(p.hit.style.top || '0') + 26) + 'px';
            }
        });
    }, 400);
    /* 大模型指令入口：window.ZFRaceControl */
    window.ZFRaceControl = {
        retireAll: retireAllTeams,
        list: function () {
            return ((window.ZFRaceArrow && ZFRaceArrow.getPairs ? ZFRaceArrow.getPairs() : []) || [])
                .filter(function (p) { return !p.dead; })
                .map(function (p) { return { team: p.team, state: p.state || 'construction', raceId: p.raceId, srcId: p.srcId }; });
        },
        sendCmd: function (team, text) {
            var hit = ((window.ZFRaceArrow && ZFRaceArrow.getPairs ? ZFRaceArrow.getPairs() : []) || [])
                .filter(function (p) { return !p.dead && (p.team === team || p.raceId === team); })[0];
            return hit ? sendCmdToTeam(hit, text) : false;
        }
    };
})();
window.ZFRaceArrow = RaceArrow;
})(); 
