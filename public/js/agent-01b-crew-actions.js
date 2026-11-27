/* ===== S4 拆分自 agent-01-project-memory.js（纯搬家）：总结师族 + 验证族方法 =====
 * 依赖桥：原文件 IIFE 闭包内的 _msgText 经 window.__PM_DEPS 注入；其余 self._xxx 走 App。
 * 加载顺序：必须在 agent-01-project-memory.js 之后。 */
(function (App) {
    var _D = (typeof window !== 'undefined' && window.__PM_DEPS) || {};
    var _msgText = _D._msgText || function (m) { return (m && typeof m.content === 'string') ? m.content : ''; };
    Object.assign(App, {
    // ===== 总结师：新开对话 + 五项精选注入（不注入全量对话），沉淀经验落盘 =====
    /* 【总结师三模式菜单】点总结师按钮先弹选项：1工作总结(默认沉淀) 2技能总结(只沉淀技能方法) 3智能体广场(总结发帖到广场) */
    _summarizerPickMenu: function(btn, box, chat) {
        var self = this;
        var old = document.getElementById('zf-summarizer-pick-menu');
        if (old) { old.remove(); return; }
        var menu = document.createElement('div');
        menu.id = 'zf-summarizer-pick-menu';
        menu.style.cssText = 'position:fixed;z-index:99999;background:linear-gradient(160deg,#232b3b,#1a2130);color:#e8ecf3;border:1px solid rgba(120,170,255,.28);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.5);padding:6px;min-width:260px;font-size:12px;font-family:inherit;animation:zfSumMenu .18s ease;';
        if (!document.getElementById('zf-sum-keyframes')) {
            var _st = document.createElement('style');
            _st.id = 'zf-sum-keyframes';
            _st.textContent = '@keyframes zfSumIn{to{opacity:1;transform:none;}}@keyframes zfSumMenu{from{opacity:0;transform:scale(.96) translateY(-4px);}to{opacity:1;transform:none;}}';
            document.head.appendChild(_st);
        }
        // 标题栏
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px 8px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:5px;color:#cfe0ff;font-weight:700;font-size:13px;letter-spacing:1px;';
        head.innerHTML = '<span style="font-size:15px;">📝</span><span style="flex:1;">选择总结模式</span>';
        menu.appendChild(head);
        var items = [
            { icon: '📋', color: '#4da3ff', name: '工作总结', tip: '完整总结任务过程和改动清单，存档并 git 提交', fn: function(){ self._summarizerExpand(box, chat); } },
            { icon: '🧠', color: '#7ee0a3', name: '技能总结', tip: '只总结「这次用什么方法解决的」，存成方法论备查', fn: function(){ self._summarizerExpand(box, chat, 'skill'); } },
            { icon: '🌐', color: '#ffb454', name: '智能体广场', tip: '把总结发到智能体广场，让其他对话和用户可见', fn: function(){ self._summarizerExpand(box, chat, 'forum'); } }
        ];
        items.forEach(function(it, itIdx) {
            var b = document.createElement('div');
            b.title = it.tip;
            b.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:background .18s ease,transform .18s ease,border-color .18s ease,box-shadow .18s ease;opacity:0;transform:translateY(6px);animation:zfSumIn .28s ease forwards;animation-delay:' + (itIdx * 60) + 'ms;';
            // 【防注入 2026-09-30】改用 textContent 构建，杜绝日后动态数据带来的 XSS 风险
            var _ic = document.createElement('span');
            _ic.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;flex:none;background:linear-gradient(145deg,' + it.color + '30,' + it.color + '14);border:1px solid ' + it.color + '44;font-size:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06);transition:transform .18s ease,box-shadow .18s ease;';
            _ic.textContent = it.icon;
            var _tx = document.createElement('span');
            _tx.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:8px;';
            var _nm = document.createElement('span');
            _nm.style.cssText = 'flex:none;font-size:13px;font-weight:700;color:' + it.color + ';';
            _nm.textContent = it.name;
            var _tp = document.createElement('span');
            _tp.style.cssText = 'flex:1;min-width:0;font-size:11px;color:#8b98ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            _tp.textContent = it.tip;
            var _ar = document.createElement('span');
            _ar.style.cssText = 'flex:none;color:' + it.color + ';font-size:12px;opacity:0;transform:translateX(-4px);transition:opacity .18s ease,transform .18s ease;';
            _ar.textContent = '›';
            _tx.appendChild(_nm); _tx.appendChild(_tp);
            b.appendChild(_ic); b.appendChild(_tx); b.appendChild(_ar);
            b.onmouseenter = function(){
                b.style.background = it.color + '14';
                b.style.borderColor = it.color + '44';
                b.style.transform = 'translateX(3px)';
                b.style.boxShadow = '0 2px 10px ' + it.color + '18';
                _ic.style.transform = 'scale(1.08)';
                _ar.style.opacity = '1';
                _ar.style.transform = 'none';
            };
            b.onmouseleave = function(){
                b.style.background = 'transparent';
                b.style.borderColor = 'transparent';
                b.style.transform = 'none';
                b.style.boxShadow = 'none';
                _ic.style.transform = 'none';
                _ar.style.opacity = '0';
                _ar.style.transform = 'translateX(-4px)';
            };
            b.onclick = function(){ menu.remove(); it.fn(); };
            menu.appendChild(b);
        });
        // 【自动关闭开关】复选框：用户可选是否总结完成后自动关闭本对话与源对话（记忆到 localStorage，默认开启）
        var _autoCloseOn = true;
        try { _autoCloseOn = localStorage.getItem('zf_sum_auto_close') !== '0'; } catch (e) {}
        var opt = document.createElement('label');
        opt.style.cssText = 'display:flex;align-items:center;gap:7px;margin:4px 6px 0;padding:5px 8px;border-radius:8px;cursor:pointer;font-size:11px;color:#9fb4d8;user-select:none;';
        opt.innerHTML = '<input type="checkbox" id="zf-sum-autoclose" style="accent-color:#4da3ff;cursor:pointer;cursor:pointer;"' + (_autoCloseOn ? ' checked' : '') + '><span>总结完成后自动关闭本对话与源对话</span>';
        opt.querySelector('input').onchange = function (ev) {
            try { localStorage.setItem('zf_sum_auto_close', ev.target.checked ? '1' : '0'); } catch (e) {}
        };
        menu.appendChild(opt);
        // 底部提示栏
        var foot = document.createElement('div');
        foot.style.cssText = 'margin-top:6px;padding:7px 10px 3px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;color:#66748c;display:flex;align-items:center;gap:5px;';
        foot.innerHTML = '<span>💡</span><span>点击任意模式开始总结，点击面板外关闭</span>';
        menu.appendChild(foot);
        var r = btn.getBoundingClientRect();
        menu.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
        menu.style.top = r.bottom + 6 + 'px';
        document.body.appendChild(menu);
        // 【钳位 2026-09-30】append 后按真实高度钳位，替代固定 260px 估算，极矮视口不裁切
        var _mh = menu.offsetHeight || 260;
        menu.style.top = Math.max(4, Math.min(r.bottom + 6, window.innerHeight - _mh - 4)) + 'px';
        menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - menu.offsetWidth - 4)) + 'px';
        setTimeout(function() {
            document.addEventListener('mousedown', function _close(ev) {
                if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', _close); }
            });
        }, 0);
    },

    _summarizerExpand: function(box, chat, _mode) {
        try { chat._summarizerMode = _mode || 'work'; } catch (e) {}
        var self = this;
        var _firstQ = '';
        // ① 任务目标（首问）② 策划师回注结论 ③ 审核结论 ④ 最近一条「✅ 任务完成」答复 ⑤ 项目树
        var _thinkerConcls = [], _qcConcls = [];
        var _finalReply = '';
        for (var _i = 0; _i < chat.history.length; _i++) {
            var _h = chat.history[_i];
            if (!_h) continue;
            var _c = _msgText(_h);
            if (_h.role === 'user') {
                if (_h._guardInject || _h._verifyRound || _h._continueRound || _h._thinkerRound || _h._summarizerRound) continue;
        if (_c.indexOf('（策划师素材包') === 0 || _c.indexOf('（总结师素材包') === 0 || _c.indexOf('（审核员素材包') === 0 || _c.indexOf('（自定义素材包') === 0 || _c.indexOf('【自定义任务】') === 0 || _c.indexOf('【审核员任务】') === 0 || _c.indexOf('（质检员素材包') === 0 || _c.indexOf('【质检员任务】') === 0) continue;
                if (!_firstQ) _firstQ = _c; // 首问=任务目标
            } else if (_h.role === 'assistant' && !_h._meta) {
                _finalReply = _c; // 顺序遍历，最后一条 assistant 覆盖 → 兜底=最后一条非工具 assistant
                if (_c.indexOf('✅ 任务完成') !== -1) _finalReply = _c; // 双锚点：命中完成标记优先（若后面还有普通回复会被覆盖，故再记一次）
            }
            // 回注结论提取（复用策划师去重思路；用 trim 后文本做前缀匹配，容忍前导空白）
            if (_h.role === 'user') {
                /* 【前缀归一 2026-09-30】与回注发送方实际前缀对齐：
                   - 策划师箭头回注 = "（策划方案·陈列）\n这是策划师的扩展思考…"（chatbox-thinker-arrow.js）
                   - 审核员箭头回注 = "这是审核员给你的建议你去改一下：…"（chatbox-verify-arrow.js）
                   提取前先剥掉「（策划方案·陈列）」陈列标记，再匹配正文前缀，避免前缀漂移导致漏收/串内容 */
                var _ct = _c.replace(/^\s+/, '');
                if (_ct.indexOf('（策划方案·陈列）') === 0) _ct = _ct.slice('（策划方案·陈列）'.length).replace(/^[\s\r\n]+/, '');
                if (_ct.indexOf('这是策划师给你的扩展结论') === 0 || _ct.indexOf('这是策划师的扩展思考') === 0) {
                    var _b = _ct.slice(_ct.indexOf('\n\n') !== -1 ? _ct.indexOf('\n\n') + 2 : 0);
                    if (_b.trim()) _thinkerConcls.push(_b.trim());
        } else if (_ct.indexOf('这是审核员的复核结论') === 0 || _ct.indexOf('这是质检员的复核结论') === 0 || _ct.indexOf('这是审核员给你的建议你去改一下') === 0) {
                    var _b2 = _ct.slice(_ct.indexOf('\n\n') !== -1 ? _ct.indexOf('\n\n') + 2 : 0);
                    if (_b2.trim()) _qcConcls.push(_b2.trim());
                }
            }
        }
        // 双锚点兜底修正：重新从尾往前找最近一条带「✅ 任务完成」的 assistant，找不到保持最后一条
        for (var _fi = chat.history.length - 1; _fi >= 0; _fi--) {
            var _fh = chat.history[_fi];
            if (_fh && _fh.role === 'assistant' && !_fh._meta && _msgText(_fh).indexOf('✅ 任务完成') !== -1) { _finalReply = _fh.content; break; }
        }
        if (!_firstQ || !_finalReply) {
            Store.addLog('warn', chat.id, 'summarizer', '总结师失败：缺少首问或最终答复');
            self._stepToast('总结师失败：对话需至少有一次提问和一次 AI 答复', false);
            return;
        }
        var _seen = {};
        _thinkerConcls = _thinkerConcls.filter(function (c) { var k = c.slice(0, 80); if (_seen[k]) return false; _seen[k] = 1; return true; }).slice(-3);
        var _seenQ = {};
        _qcConcls = _qcConcls.filter(function (c) { var k = c.slice(0, 80); if (_seenQ[k]) return false; _seenQ[k] = 1; return true; }).slice(-3);
        // 项目路径
        var _projPath = '';
        var _projName = '';
        var _pid = chat.projectId || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || (typeof App !== 'undefined' && App._activeProjectId) || '';
        var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
        if (_projSrc && _pid) {
            for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                if (String(_projSrc[_pi].id) === String(_pid)) { _projName = _projSrc[_pi].name || _projSrc[_pi].title || ''; _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
            }
        }
        /* 【四要素溯源】项目名/对话主题/时间/所属智能体——结论回注时必须全部带上 */
        var _chatTitle = String(chat.title || '');
        try { if (!_chatTitle && chat.el) { var _te0 = chat.el.querySelector('.title'); if (_te0) _chatTitle = String(_te0.textContent || '').trim(); } } catch (eT2) {}
        var _nowStr = (function () { var _d = new Date(); function _p2(n) { return (n < 10 ? '0' : '') + n; } return _d.getFullYear() + '-' + _p2(_d.getMonth() + 1) + '-' + _p2(_d.getDate()) + ' ' + _p2(_d.getHours()) + ':' + _p2(_d.getMinutes()); })();
        var _projTree = '';
        var _finishSend = function () { self._summarizerExpandSend(box, chat, { projPath: _projPath, firstQ: _firstQ, thinkerConcls: _thinkerConcls, qcConcls: _qcConcls, finalReply: _finalReply, projTree: _projTree, mode: chat._summarizerMode || 'work' }); };
        if (_projPath) {
            try {
                fetch('/api/fs/browse?path=' + encodeURIComponent(_projPath) + '&limit=2000')
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        if (j && j.ok) {
                            var _ds = (j.dirs || []).slice(0, 40).map(function (d) { return '[目录] ' + (d.name || '') + '/'; });
                            var _fs = (j.files || []).slice(0, 150).map(function (f) { return '[文件] ' + (f.name || ''); });
                            _projTree = _ds.concat(_fs).join('\n');
                        }
                    })
                    .catch(function () {})
                    .then(_finishSend);
            } catch (e) { _finishSend(); }
        } else { _finishSend(); }
    },

    _summarizerExpandSend: function(box, chat, ctxData) {
        var self = this;
        var lines = [];
        var _smMode = String(ctxData && ctxData.mode || 'work');
        lines.push('（总结师素材包，共见下文）');
        if (_smMode === 'skill') {
            // 【技能总结模式】只沉淀方法论，禁止 git 提交、禁止修改代码
            lines.push('【总结师任务·技能总结模式】你是一个独立的总结师，当前模式为「技能总结」。用户刚在另一个对话中完成了一项任务，你的职责是把这次任务的通用方法论提炼成技能沉淀。⚠️ 本模式硬性禁令：禁止执行任何 git 命令（不 add、不 commit）；禁止修改/创建任何项目代码文件；你的唯一产出是方法论沉淀。你必须：① 从素材包提炼技能主题；② 调用 project_record 工具（action=write，name=技能-<主题>，主题由你从首问提炼）落盘方法论；③ 最后单独一行以「【总结师沉淀】」开头输出 3~5 条编号精华结论（以【技能沉淀】开头，不含 git 信息），供琥珀色箭头一键回注原对话。');
            /* 一行结论头铁律（与 server/engines/common/material_pack_prefixes.py 的 SUMMARY_HEADLINE_RULE 单源同步，两处必须一起改） */
            lines.push('【输出格式铁律】总结的第一行必须是「一行结论头」，格式：\n【结果】任务：<一句话任务> ｜ 结果：<成功/部分成功/失败> ｜ 一句话简介：<本次干了什么>\n结论头之后空一行，再写详细内容。');
        } else if (_smMode === 'forum') {
            // 【智能体广场模式】精炼成社区帖并调 forum_write 发帖，禁止 git 提交
            lines.push('【总结师任务·智能体广场模式】你是一个独立的总结师，当前模式为「智能体广场」。用户刚在另一个对话中完成了一项任务，你的职责是把这次任务写成一篇面向朱峰社区（智能体广场板块）的分享帖并发布。⚠️ 本模式硬性禁令：禁止执行任何 git 命令；禁止修改/创建任何项目代码文件。你必须：① 从素材包提炼本次任务的亮点（做了什么、效果如何、用了什么巧妙方法）；② 调用 forum_write 工具发帖——topic 固定传「总结」，body 为纯文本，排版格式是硬性要求：第 1 行单独一行放标题（≤20字，吸引人、不加书名号），第 2 行必须空行，正文用「【小节标题】」分 3~5 节（如【干了什么】【怎么解决的】【效果】【可复用经验】），每节之间空一行，节内要点逐行写（一条一行，可用 1. 2. 编号），严禁把全文挤成一段无换行的长文；总字数 ≤1500（工具硬限 5000，留余量）；必须真实调用 forum_write 工具发帖，不调用视为未完成，禁止伪造 post_id；③ 发帖成功后从工具返回结果中取 post_id，并调用 project_record 工具（action=write，name=总结-<主题>）本地落盘，内容含 post_id；若 forum_write 发帖失败（报错/超时），不得伪造 post_id，降级为仅本地落盘并在内容开头注明「发帖失败：<原因>」；④ 最后单独一行以「【总结师沉淀】」开头输出 3~5 条编号精华结论（含帖子链接或发帖状态），供琥珀色箭头一键回注原对话。');
            /* 一行结论头铁律（与 server/engines/common/material_pack_prefixes.py 的 SUMMARY_HEADLINE_RULE 单源同步，两处必须一起改） */
            lines.push('【输出格式铁律】总结的第一行必须是「一行结论头」，格式：\n【结果】任务：<一句话任务> ｜ 结果：<成功/部分成功/失败> ｜ 一句话简介：<本次干了什么>\n结论头之后空一行，再写详细内容。');
        } else {
            // 【工作总结模式】默认：git 提交 + 本地落盘
            lines.push('【总结师任务】你是一个独立的总结师。用户刚在另一个对话中完成了一项任务（策划→执行→审核闭环），你的职责是「向后看」：把这个任务的经验沉淀下来，而不是策划新任务（那是策划师的职责）。你必须：① 从素材包提炼任务主题；② 总结固定结构的沉淀结论（必须包含「技能方法」：这个问题是依靠什么方法解决的——定位手段、排查路径、关键工具、验证方式，并说明下次遇到同类问题如何复用该方法）；③ 执行 git 保存本次任务改动：cd 到「== 项目路径 ==」给出的目录（禁止在其他目录执行），先 git add -A，再按命名规范提交——标题格式：[答] 改动摘要(涉及文件名)，摘要从最终答复的改动清单提炼，20 字以内，禁止使用 "[session-start]"、"[session-end]" 等无信息量标题；示例：[答] app-quick-create.js下拉加暗色背景；④ 调用 project_record 工具把总结落盘为记录「总结-<任务主题>」（主题由你从首问提炼，不要让用户手填），落盘内容必须包含本次 git 提交的 commit hash 与提交标题；⑤ 最后单独一行以「【总结师沉淀】」开头输出 3~5 条编号精华结论（含 git 提交信息），供琥珀色箭头一键回注原对话。');
            /* 一行结论头铁律（与 server/engines/common/material_pack_prefixes.py 的 SUMMARY_HEADLINE_RULE 单源同步，两处必须一起改） */
            lines.push('【输出格式铁律】总结的第一行必须是「一行结论头」，格式：\n【结果】任务：<一句话任务> ｜ 结果：<成功/部分成功/失败> ｜ 一句话简介：<本次干了什么>\n结论头之后空一行，再写详细内容。');
        }
        lines.push('');
        lines.push('== 任务目标（原对话首问） ==');
        lines.push(String(ctxData.firstQ || '').replace(/\s+/g, ' ').trim().slice(0, 800));
        lines.push('');
        lines.push('== 项目路径 ==');
        lines.push(ctxData.projPath || '（未提供）');
        if (ctxData.thinkerConcls && ctxData.thinkerConcls.length) {
            lines.push('');
            lines.push('== 策划师结论（最近 ' + ctxData.thinkerConcls.length + ' 条） ==');
            ctxData.thinkerConcls.forEach(function (c, ci) { lines.push('【策划结论 ' + (ci + 1) + '】' + String(c).slice(0, 6000)); });
        }
        if (ctxData.qcConcls && ctxData.qcConcls.length) {
            lines.push('');
            lines.push('== 审核结论（最近 ' + ctxData.qcConcls.length + ' 条） ==');
            ctxData.qcConcls.forEach(function (c, ci) { lines.push('【审核结论 ' + (ci + 1) + '】' + String(c).slice(0, 6000)); });
        }
        lines.push('');
        lines.push('== 最终完成答复（最近一条「✅ 任务完成」） ==');
        lines.push(String(ctxData.finalReply || '').slice(0, 6000));
        if (ctxData.projTree) {
            lines.push('');
            lines.push('== 项目目录概览（浅层） ==');
            lines.push(ctxData.projTree);
        }
        lines.push('');
        lines.push('== 沉淀输出固定结构（落盘内容必须包含） ==');
        if (_smMode === 'skill') {
            lines.push('【技能主题】一句话技能名；【问题场景】这类问题什么情况下出现；【解决方法/工具链】怎么解决的（定位手段、排查路径、关键工具调用、验证方式）；【复用套路】下次遇到同类问题的直接操作步骤；【注意事项】易错点与边界。');
            lines.push('落盘方式：调用 project_record（action=write，name=技能-<主题>）。这是硬性要求，不落盘视为未完成。禁止 git 提交。⚠️ 跨版本重要技能加固：若该方法论属于「换版本重装也不能丢」的通用技能，再调用 write_file 把内容同步一份到 private/记忆/全局/技能-<主题>.md（全局分类抗重装，升级不丢）。');
        } else if (_smMode === 'forum') {
            lines.push('【总结主题】一句话任务名；【帖子标题与链接】发帖返回的 post_id 与帖子地址；【帖子要点】发布内容的核心摘要；【发帖状态】成功（含 post_id）或失败（含原因，禁止伪造）；【遗留事项】无或二期项。');
            lines.push('落盘方式：先调用 forum_write（topic=总结）发帖，再调用 project_record（action=write，name=总结-<主题>，含 post_id）。两步都是硬性要求；发帖失败则降级仅落盘并注明失败原因。禁止 git 提交。');
        } else {
            lines.push('【总结主题】一句话任务名；【结论】做了什么、结果如何；【技能方法】这个问题是依靠什么方法/思路/工具链解决的（如：定位手段、排查路径、关键工具调用、验证方式），以及下次遇到同类问题如何直接复用这套方法（注意：写通用方法论「怎么解决的、下次的套路」，不要写本项目具体坑位——那些放【可复用经验】）；【改动清单】涉及哪些文件/记录；【git 提交】commit hash + 提交标题（格式 [答] 改动摘要(文件名)）；【可复用经验】下次同类任务直接可用的做法与坑；【遗留事项】未完成/二期项。');
            lines.push('落盘方式：先完成 git 提交，再调用 project_record（action=write，name=总结-<主题>）。这是硬性要求，不落盘视为未完成。');
        }
        var _prompt = lines.join('\n');
        var selfApp = (typeof App !== 'undefined') ? App : null;
        if (!selfApp || typeof selfApp.createChatBox !== 'function') {
            Store.addLog('error', chat.id, 'summarizer', '总结师失败：无法创建新对话');
            self._stepToast('总结师失败：无法创建新对话', false);
            return;
        }
        var canvasArea = document.getElementById('canvasArea');
        var _cw = canvasArea ? canvasArea.clientWidth : window.innerWidth;
        var _ch = canvasArea ? canvasArea.clientHeight : window.innerHeight;
        // 【坐标修复】与审核员同款：内联 style 无效时改用 getBoundingClientRect 相对 canvasArea
        // 取真实渲染位置，并按画布缩放换算回逻辑坐标。原写法只读内联值 + 不校正缩放，
        // 导致总结师新对话被 clamp 到视口右下角很远的地方。
        var _caOff = { left: 0, top: 0 };
        try { if (canvasArea) { var _smCaR = canvasArea.getBoundingClientRect(); _caOff = { left: _smCaR.left, top: _smCaR.top }; } } catch (eSmCa) {}
        /* 【源坐标修复】不再信任 style.left（可能被历史钉回逻辑写入屏幕像素值如95358导致新窗飞到±20000钳制边缘），
           优先用 getBoundingClientRect 反算画布逻辑坐标：(rect-画布区原点-视图偏移)/缩放，style.left 仅作兜底 */
        var _srcL = NaN, _srcT = NaN;
        // 【专注模式防飞窗】源窗若正被搬进专注舞台（left:0,top:0 基准），反算坐标必然全错导致新窗飞到老远；
        // 检测到专注模式激活时先同步退出（unhost 会恢复真实 style，getBoundingClientRect 随后强制重排即可取到正确坐标）
        /* 【2026-11-26 派出不再踢出专注模式】专注模式下源窗被 host 进舞台（left:0,top:0 基准），
           rect 反算坐标必然全错。原做法是强制退出专注模式（用户反馈：派出团队会莫名弹出/退出专注模式，不对）。
           现改为：从 zfFocusMode.realPos 快照取 host 前真实画布坐标；无快照（未被 host）时回退 rect 反算。 */
        try { if (window._zfFocusActive && window.zfFocusMode && typeof window.zfFocusMode.realPos === 'function') { var _fp = window.zfFocusMode.realPos(chat.id); if (_fp) { _srcL = Math.round(_fp.left); _srcT = Math.round(_fp.top); } } } catch (eZF) {}
        try {
            var _sc0 = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc0 > 0)) _sc0 = 1;
            var _cv0 = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
            var _r0 = chat.el.getBoundingClientRect();
            var _caEl0 = document.getElementById('canvasArea');
            var _caR0 = _caEl0 ? _caEl0.getBoundingClientRect() : { left: 0, top: 0 };
            if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = Math.round((_r0.left - _caR0.left - (_cv0.x || 0)) / _sc0);
            _srcT = Math.round((_r0.top - _caR0.top - (_cv0.y || 0)) / _sc0);
            }
        } catch (eSrc0) {}
        /* 【v6 交叉校验】rect 反算依赖 canvasGetView 坐标系一致，实测会得出 95350 类垃圾值把新窗钉飞；
           style.left 由拖拽模块直接写入，最可靠。两源相差 >1500 时以 style.left 为准 */
        var _stL = parseFloat(chat.el && chat.el.style.left), _stT = parseFloat(chat.el && chat.el.style.top);
        if (isFinite(_stL) && isFinite(_stT) && (isNaN(_srcL) || isNaN(_srcT) || Math.abs(_srcL - _stL) + Math.abs(_srcT - _stT) > 1500)) {
            console.log('[定位交叉校验] rect反算(', _srcL, _srcT, ') 与 style.left(', _stL, _stT, ') 不符，采用 style.left');
            _srcL = _stL; _srcT = _stT;
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = parseInt(chat.el && chat.el.style.left, 10);
            _srcT = parseInt(chat.el && chat.el.style.top, 10);
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            try {
                var _smSrcR = chat.el.getBoundingClientRect();
                var _smSc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
                // 【平移校正】扣除画布整体平移量(view.x/view.y)，防止平移后子对话跑到0点
                var _smCv = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
                _srcL = Math.round((_smSrcR.left - _caOff.left - (_smCv.x || 0)) / _smSc);
                _srcT = Math.round((_smSrcR.top - _caOff.top - (_smCv.y || 0)) / _smSc);
            } catch (eSmR) { _srcL = 40; _srcT = 40; }
        }
        if (isNaN(_srcL)) _srcL = 40;
        if (isNaN(_srcT)) _srcT = 40;
        /* 【坐标同系修复】画布逻辑坐标可平移到任意值，不能钳制到视口 [_cw-440/_ch-160]——
           否则画布平移后总结师新窗会被视口钳制拉回视口边缘，表现为"飞很远"。
           与策划师/审核员 fan() 修复同口径：只防 NaN/极端值（±20000） */
        var _smScW = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
        /* 【定位·习惯优先】总结师新窗优先放回用户上次拖拽到的位置（SpawnHabit 习惯记忆），无习惯才用源窗右侧默认 */
        var _tX, _tY;
        /* 【定位统一·右下角10,10】弃用习惯记忆（脏数据会致飞窗）：新窗固定在源窗右下角外10px */
        var _smOffW = Math.round((chat.el && chat.el.offsetWidth || 420) / _smScW);
        var _smOffH = Math.round((chat.el && chat.el.offsetHeight || 300) / _smScW);
        var _tX = _srcL + _smOffW + 10;
        var _tY = _srcT + _smOffH + 10;
        /* 【重叠修复】连续快速创建多个总结师时，同源同偏移会算出完全相同坐标导致两窗完全重叠。
           落点已被占用则向右下级联 +48/+48，直到找到空位（最多级联 20 次） */
        try {
            var _occupied = function (x, y) {
                var boxes = (window.App && App.chatBoxes) || [];
                for (var i = 0; i < boxes.length; i++) {
                    var b = boxes[i];
                    if (!b || !b.el || !document.body.contains(b.el)) continue;
                    if (Math.abs((parseFloat(b.el.style.left) || 0) - x) < 40 && Math.abs((parseFloat(b.el.style.top) || 0) - y) < 40) return true;
                }
                return false;
            };
            var _cascade = 0;
            while (_occupied(_tX, _tY) && _cascade < 20) { _tX += 48; _tY += 48; _cascade++; }
        } catch (eCascade) {}
        if (typeof _tX !== 'number' || isNaN(_tX)) _tX = 120;
        if (typeof _tY !== 'number' || isNaN(_tY)) _tY = 120;
        // 【修复】画布逻辑坐标可无限平移，源窗可能在9万+处；钳制±20000会把新窗强行拉离源窗。
        // 只防 NaN/Infinity，不再限制范围。
        if (!isFinite(_tX)) _tX = 120;
        if (!isFinite(_tY)) _tY = 120;
        var _srcMid = chat.modelId || '';
        var newChat = selfApp.createChatBox(_tX, _tY, _srcMid || null, true);
        if (!newChat) {
            self._stepToast('总结师失败：新对话创建被拦截（窗口数量限制）', false);
            return;
        }
        try { newChat.el._isSummarizerChat = true; newChat.el._summarizerSrcId = chat.id; } catch (e) {}
        // ===== 【总结完成自动关闭】总结师答完后（出现「✅ 任务完成」或「【总结师沉淀】」），自动关闭总结师窗 + 父（源）对话窗 =====
        try {
            var _autoCloseDone = false;
            var _autoClose = function () {
                if (_autoCloseDone) return; _autoCloseDone = true;
                /* 【开关 2026-10-10】用户在模式菜单勾选项控制：未勾选则不自动关闭 */
                try { if (localStorage.getItem('zf_sum_auto_close') === '0') return; } catch (eSkip) { return; }
                try {
                    var _app = (typeof App !== 'undefined') ? App : null;
                    var _srcChat = null;
                    try {
                        var _boxes = (_app && _app.chatBoxes) || [];
                        for (var _ci = 0; _ci < _boxes.length; _ci++) { if (String(_boxes[_ci].id) === String(newChat.el._summarizerSrcId)) { _srcChat = _boxes[_ci]; break; } }
                    } catch (eFind) {}
                    var _delay = 1500; /* 留 1.5s 让用户瞥见总结结论 */
                    setTimeout(function () {
                        try {
                            /* 【扩展】除总结师窗与父对话窗外，父对话派生的其他子对话（策划/审核/蜂群/其他总结师）一并关闭 */
                            var _srcId = (_srcChat ? String(_srcChat.id) : String(newChat.el._summarizerSrcId));
                            var _boxes2 = (_app && _app.chatBoxes) || [];
                            /* 【修复·递归闭包】直接子对话可能又派生了孙级对话（子蜂群/子总结师等），
                               其 SrcId 指向子对话而非源对话，旧逻辑只匹配直接子级会漏关。
                               现多轮扫描：把「SrcId 指向任意待关闭窗」的窗也并入待关集合，直到不再增长。 */
                            var _toCloseIds = {};
                            var _addBox = function (_bx) { if (_bx && _bx.id != null) _toCloseIds[String(_bx.id)] = _bx; };
                            _addBox(_srcChat);
                            var _changed = true, _guard = 0;
                            while (_changed && _guard++ < 10) {
                                _changed = false;
                                for (var _ci2 = 0; _ci2 < _boxes2.length; _ci2++) {
                                    var _b = _boxes2[_ci2]; if (!_b || !_b.el) continue;
                                    if (_toCloseIds[String(_b.id)]) continue;
                                    /* 通用扫描 el 上所有 *_SrcId 属性，覆盖各角色派生窗 */
                                    var _bSrc = null;
                                    try {
                                        for (var _ak in _b.el) {
                                            if (/SrcId$/.test(_ak) && _b.el[_ak]) { _bSrc = _b.el[_ak]; break; }
                                        }
                                    } catch (eAK) {}
                                    if (_bSrc && _toCloseIds[String(_bSrc)]) { _addBox(_b); _changed = true; }
                                }
                            }
                            var _toClose = [];
                            for (var _ck in _toCloseIds) _toClose.push(_toCloseIds[_ck]);
                            for (var _ci3 = 0; _ci3 < _toClose.length; _ci3++) {
                                try { if (_app && typeof _app.closeChatBox === 'function' && document.body.contains(_toClose[_ci3].el)) _app.closeChatBox(_toClose[_ci3]); } catch (eCC) {}
                            }
                            try { if (_app && typeof _app.closeChatBox === 'function' && document.body.contains(newChat.el)) _app.closeChatBox(newChat); } catch (eC2) {}
                            try { if (self._stepToast) self._stepToast('总结完成，已自动关闭总结师、源对话及其子对话', true); } catch (eC3) {}
                        } catch (eCAll) {}
                    }, _delay);
                } catch (eClose) {}
            };
            /* 监听总结师窗消息区新增节点，命中完成标记即触发 */
            var _msgEl0 = newChat.el.querySelector('.messages') || newChat.el;
            var _mo = new MutationObserver(function () {
                if (_autoCloseDone) { try { _mo.disconnect(); } catch (eD) {} return; }
                try {
                    /* 【修复 2026-10 视口裁剪】此处必须用 textContent 而非 innerText：
                       app-canvas.js 的视口裁剪(_cullNodes)会把滚出视口的对话窗设为
                       visibility:hidden + content-visibility:hidden，innerText 依赖渲染，
                       被裁剪的窗 innerText 返回空 → 「【总结师沉淀】」永远找不到 → 自动关闭失灵
                       （表现为"摄像机拉近才能自动关"）。textContent 不依赖渲染，隐藏也能读到全文。 */
                    var _txt = (_msgEl0.textContent || '');
                    // 仅以「【总结师沉淀】」触发（「✅ 任务完成」可能出现在答复开头导致过早关窗）。
                    /* 【修复】不再要求"标记须在全文末尾500字符内"（原条件过苛：总结师沉淀后往往还有
                       工具调用收尾等大段内容，标记之后超500字导致永不触发、双窗关不掉）。
                       现条件：全文出现标记 且 本轮回复已结束（不在发送中）即触发，流式中途不会误关 */
                    /* 【修复 2026-11 关不上】原仅认「【总结师沉淀】」，但素材包格式铁律只强制
                       「【结果】任务：」一行结论头，总结师按格式输出时无沉淀标记 → 永不触发关闭。
                       现两个标记任一命中即触发（仍要求本轮回复已结束，防流式中途误关） */
                    var _mark = '【总结师沉淀】';
                    var _mark2 = '【结果】任务：';
                    var _idx = _txt.lastIndexOf(_mark);
                    var _idx2 = _txt.lastIndexOf(_mark2);
                    /* 【修复】原条件"标记须在全文末尾500字符内"过苛：总结师沉淀后往往还有
                       工具调用收尾、"✅ 任务完成"等大段内容，标记之后超500字导致永不触发、双窗关不掉。
                       改为：全文出现标记 且 本轮回复已结束（不在发送中）即触发，流式中途不会误关 */
                    var _stillSending = false;
                    try { _stillSending = !!newChat.isSending; } catch (eSnd) {}
                    if ((_idx !== -1 || _idx2 !== -1) && !_stillSending) _autoClose();
                    /* 【修复 2026-XX 关不上】标记出现时若仍在流式（isSending=true）会被上面条件跳过，
                       而此后若消息区不再有 DOM 变动，观察器不再回调 → 双窗永远关不掉。
                       兜底：看到标记后启动轮询，每 500ms 查一次 isSending，变 false 即关闭 */
                    else if ((_idx !== -1 || _idx2 !== -1) && _stillSending && !newChat._zfSumClosePoll) {
                        try {
                            var _poll = setInterval(function () {
                                try {
                                    if (_autoCloseDone) { clearInterval(_poll); try { clearTimeout(newChat._zfSumCloseTimeout); } catch (eT0) {} return; }
                                    var _busy = false;
                                    try { _busy = !!newChat.isSending; } catch (eP1) {}
                                    if (!_busy) { clearInterval(_poll); try { clearTimeout(newChat._zfSumCloseTimeout); } catch (eT1) {} _autoClose(); }
                                } catch (eP2) { try { clearInterval(_poll); } catch (eP3) {} }
                            }, 500);
                            newChat._zfSumClosePoll = _poll;
                            /* 保险：轮询最多持续 3 分钟，超时强制关（防 isSending 卡死） */
                            newChat._zfSumCloseTimeout = setTimeout(function () {
                                try { clearInterval(newChat._zfSumClosePoll); if (!_autoCloseDone) _autoClose(); } catch (eP4) {}
                            }, 180000);
                        } catch (ePoll) {}
                    }
                } catch (eChk) {}
            });
            _mo.observe(_msgEl0, { childList: true, subtree: true, characterData: true });
            /* ===== 【兜底看门狗 2026-10 偶发不关闭】观察器依赖"消息区 DOM 变动"才回调，
               若唯一一次带标记的 DOM 变动发生在 isSending=true 时、且其后消息区再无变动，
               上面 else-if 轮询永远不会被挂上 → 双窗关不掉（偶发复现的根因）。
               故从创建时就挂独立看门狗：每 2s 直接读 textContent 查标记 + isSending，
               不依赖观察器是否还活着；标记出现后 3 分钟硬超时强制关。双保险幂等（_autoCloseDone 防重入）。 */
            try {
                var _wdStart = Date.now();
                newChat._zfSumWatchdog = setInterval(function () {
                    try {
                        if (_autoCloseDone) { clearInterval(newChat._zfSumWatchdog); return; }
                        if (!document.body.contains(newChat.el)) { clearInterval(newChat._zfSumWatchdog); return; }
                        var _wdTxt = (newChat.el.querySelector('.messages') || newChat.el).textContent || '';
                        var _wdBusy = false;
                        try { _wdBusy = !!newChat.isSending; } catch (eW1) {}
                        var _wdHit = (_wdTxt.indexOf('【总结师沉淀】') !== -1 || _wdTxt.indexOf('【结果】任务：') !== -1);
                        if (_wdHit && !_wdBusy) { _autoClose(); return; }
                        /* 硬超时：标记已出现但 isSending 卡死超 3 分钟 → 强制关 */
                        if (_wdHit && Date.now() - _wdStart > 180000) { _autoClose(); return; }
                        /* 总保险：窗已存活超 15 分钟且含标记仍未关（极端卡死）→ 强制关 */
                        if (_wdHit && Date.now() - _wdStart > 900000) { _autoClose(); }
                    } catch (eW2) { try { clearInterval(newChat._zfSumWatchdog); } catch (eW3) {} }
                }, 2000);
            } catch (eWd) {}
        } catch (eAutoClose) {}
        /* 【出生保护】标记创建时刻，10s 内 chatbox-relative-restore 不得校正/采集此窗，
           防止陈旧父子偏移基准把新窗拽到远处（"突然飞走"的根源） */
        try { newChat.el._zfFreshSpawn = Date.now(); } catch (e) {}
        // ===== 【角色挂接】总结师新窗优先绑定角色分组里名为「总结师」的角色；找不到则回退用户默认（无角色）=====
        try {
            var _sumApp = selfApp;
            var _sumSrcRole = null;
            try { _sumSrcRole = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null'); } catch (e) {}
            var _sumDoApply = function (role, how) {
                if (!role || !role.id) return false;
                try {
                    localStorage.setItem('zf_role_chat_' + newChat.id, JSON.stringify({
                        id: role.id, name: role.name, avatar: role.avatar, prompt: role.prompt || '',
                        chat_skin: role.chat_skin || ''
                    }));
                    try { if (typeof _sumApp._refreshRoleBadge === 'function') _sumApp._refreshRoleBadge(newChat.el); } catch (e) {}
                    // 【标题同步】把新对话标题改成「头像 角色名」，否则肉眼看不出角色已切换
                    try {
                        var _sTitleEl = newChat.el && newChat.el.querySelector('.title');
                        if (_sTitleEl) {
                            _sTitleEl.textContent = (role.name || '总结师') + ' · 总结';
                            _sTitleEl.title = '总结沉淀对话（角色：' + (role.name || '') + '）';
                        }
                    } catch (e) {}
                    try { if (typeof Theme !== 'undefined' && Theme.applyToBox && newChat.el) Theme.applyToBox(newChat.el, role.chat_skin || ''); } catch (e) {}
                    try {
                        fetch('/api/roles', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'select', box: newChat.id, role_id: role.id })
                        }).catch(function () {});
                    } catch (e) {}
                    Store.addLog('info', newChat.id, 'summarizer', '已绑定角色（' + how + '）：' + (role.name || role.id));
                    return true;
                } catch (e) { return false; }
            };
            // 【兜底无角色】同步直写仅用于 200ms 内抢占绑定权（防包装器继承/沿用覆盖），
            // 200ms 后查列表：找到「总结师」则覆盖绑定；找不到则清除继承角色，回退用户默认（无角色）
            try { newChat._zfRoleDirect = true; } catch (eZF3) {}
            if (_sumSrcRole && _sumSrcRole.id) _sumDoApply(_sumSrcRole, '过渡·' + (_sumSrcRole.name || ''));
            setTimeout(function () {
                try {
                    fetch('/api/roles?box=' + encodeURIComponent(newChat.id))
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            var _sHit = null;
                            ((res && res.roles) || []).forEach(function (r) {
                                if (String(r.name || '').trim() === '总结师') _sHit = r;
                            });
                            if (_sHit && _sHit.id) { _sumDoApply(_sHit, '指定·总结师'); return; }
                            // 角色库无「总结师」：清除过渡继承的角色，回退用户默认（无角色）
                            var _hadInherit = _sumSrcRole && _sumSrcRole.id;
                            try { localStorage.removeItem('zf_role_chat_' + newChat.id); } catch (e) {}
                            try { if (typeof _sumApp._refreshRoleBadge === 'function') _sumApp._refreshRoleBadge(newChat.el); } catch (e) {}
                            try {
                                var _sTitleEl = newChat.el && newChat.el.querySelector('.title');
                                if (_sTitleEl && _hadInherit) { _sTitleEl.textContent = '总结'; _sTitleEl.title = '总结沉淀对话（默认角色）'; }
                            } catch (e) {}
                            try {
                                fetch('/api/roles', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'select', box: newChat.id, role_id: '' })
                                }).catch(function () {});
                            } catch (e) {}
                            if (_hadInherit) Store.addLog('info', newChat.id, 'summarizer', '角色库无「总结师」角色，已回退默认（无角色）');
                        }).catch(function () {});
                } catch (e) {}
            }, 200);
        } catch (e) {}
        // 继承项目
        var _inheritPid = chat.projectId || (typeof App !== 'undefined' && App._activeProjectId) || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || '';
        if (_inheritPid) {
            newChat.projectId = _inheritPid;
            for (var i = 0; i < Store.data.chatBoxes.length; i++) { if (Store.data.chatBoxes[i].id === newChat.id) { Store.data.chatBoxes[i].projectId = _inheritPid; break; } }
            try { if (typeof DB !== 'undefined' && DB.setNodeProject) DB.setNodeProject(newChat.id, _inheritPid).catch(function () {}); } catch (e) {}
        }
        try { Store.saveChatBox(newChat, true); } catch (e) {}
        Store.addLog('info', chat.id, 'summarizer', '总结师已发起：新对话 ' + newChat.id + '，素材包 ' + _prompt.length + ' 字');
        self._stepToast('总结师已发起：新对话已创建并发送沉淀素材包', true);
        // 【琥珀色方向箭头】原始对话 ↔ 总结师对话（沉淀回注通道）
        try { if (window.ZFSummarizerArrow && typeof window.ZFSummarizerArrow.create === 'function') window.ZFSummarizerArrow.create(chat, newChat); } catch (e) {}
        setTimeout(function() {
            try {
                if (typeof selfApp.addMsg === 'function') selfApp.addMsg(newChat.el, '（总结师素材包，共 ' + _prompt.length + ' 字）', 'user', newChat.modelId);
                newChat.history.push({ role: 'user', content: _prompt, _summarizerRound: true });
                Store.addLog('info', newChat.id, 'summarizer', '总结素材包已注入并发送');
                selfApp.sendToModel(newChat.el, newChat);
            } catch (e) {
                Store.addLog('error', newChat.id, 'summarizer', '总结素材包发送异常: ' + e.message);
            }
        }, 400);
    },

    // ===== 审核员：新开对话 + 注入验证素材包（前因后果/工具上下文/改动前后对比） =====
    _objectiveVerify: function(box, chat, opts) {
        var self = this;
        opts = opts || {};
        var _mode = opts.mode || 'obj';
        // =====【审核循环终止闸门 2026-10-17】修复"97分仍进第六轮"永动审核 =====
        // 阈值常量：QC_MAX_PASS_ROUNDS=双审通过即锁收口的轮数上限；QC_HARD_ROUNDS=无条件硬顶；QC_PASS_SCORE=高分线
        try {
            var QC_MAX_PASS_ROUNDS = 3, QC_HARD_ROUNDS = 5, QC_PASS_SCORE = 85;
            // 轮次计数：qcCountFor 存活的审核窗数不可靠（窗口关闭即减），改用评分日志按 srcId 聚合轮数（跨对话持久）
            var _qcRound = 0, _lastPassAll = false;
            try {
                var _log = JSON.parse(localStorage.getItem('zf_verify_score_log_v1') || '[]');
                /* 【角色隔离 v2 2026-11-10 P1泛化】轮次计数与高分锁接入优化师(polisher)/安全师(security)评分（verify-arrow轮询已落日志）；无role老数据默认按审核处理（保留兼容） */
                var _rs = _log.filter(function (r) { return String(r.srcId) === String(chat.id) && (r.role === undefined || r.role === null || r.role === 'qc' || r.role === 'polisher' || r.role === 'security'); });
                _qcRound = _rs.length; // 每个质检员每轮一条 → 即质检回复总数，可作轮次近似（双审则 ×2）
                if (_rs.length >= 2) {
                    var _lastTwo = _rs.slice(-2);
                    /* 按角色区分及格线：qc/安全师 ≥85，优化师 ≥60（日志 passLine 统一60，不能直接用 r.pass） */
                    _lastPassAll = _lastTwo.every(function (r) { return typeof r.score === 'number' && r.score >= (r.role === 'polisher' ? 60 : QC_PASS_SCORE); });
                }
            } catch (eL) {}
            if (_qcRound >= QC_HARD_ROUNDS * 2) {
                // 硬顶：约5轮双审 → 无条件拦截，转用户裁决
                Store.addLog('warn', chat.id, 'obj-verify', '已达审核硬顶(' + _qcRound + '条评分)，拦截发起，转用户裁决');
                self._stepToast('已审核约 ' + Math.floor(_qcRound / 2) + ' 轮，达到硬顶上限，不再发起新一轮审核（如确有问题请人工复查）', false);
                return;
            }
            if (_qcRound >= QC_MAX_PASS_ROUNDS * 2 && _lastPassAll) {
                // 达到轮次上限且最近一轮双审均≥90分 → 锁定收口
                Store.addLog('info', chat.id, 'obj-verify', '审核已高分通过(' + _qcRound + '条评分, 均≥' + QC_PASS_SCORE + ')，锁定收口不再复审');
                self._stepToast('审核已高分通过（双审≥' + QC_PASS_SCORE + '分），结论维持收口，不再重复审核', true);
                return;
            }
        } catch (eGate) { Store.addLog('warn', chat.id, 'obj-verify', '终止闸门异常(不阻断): ' + eGate.message); }
        // =====【终止闸门结束】=====
        // 【2026 修复】审核员基于新对话独立运行，原对话运行中/验证轮中都不再拦截。
        // 原逻辑 chat.isSending || chat._verifyActive 直接 return，导致：
        // 1) 正在跑任务时点审核员被拒（用户希望"随时随地可验证"）；
        // 2) 上轮验证结束后 _verifyActive 残留为 true 时，明明空闲却误报"正在运行"。
        // 现在仅在验证轮进行中给出提示（避免素材包取到半截上下文），但不阻断。
        if (_mode !== 'triple') {
            if (chat._verifyActive && !chat.isSending) {
                Store.addLog('warn', chat.id, 'obj-verify', '上一轮验证尚未结束，本次审核员以上下文可能不完整');
                self._stepToast('上一轮验证尚未结束，审核员素材包可能不完整，已照常发起', false);
            } else if (chat.isSending) {
                Store.addLog('info', chat.id, 'obj-verify', '当前对话运行中发起审核员（新对话独立运行）');
                self._stepToast('当前对话仍在运行，审核员已在新对话独立发起', true);
            }
        }
        // 1. 收集原对话上下文：最近 3 条真实用户问题 + 最近 3 条 AI 回复 + 关键工具调用摘要（取自运行日志，最可靠）
        var _lastAssistant = '', _lastRealUserQ = '', _toolCalls = [];
        var _recentQs = [], _recentAs = [];
        try {
            var _logs = Store.getMessages ? Store.getMessages(chat.id) : [];
            for (var _li = _logs.length - 1; _li >= 0 && _toolCalls.length < 15; _li--) {
                if (_logs[_li].type === 'tool_call') _toolCalls.unshift(_msgText(_logs[_li]).substring(0, 120));
            }
        } catch (e) {}
        for (var _i = chat.history.length - 1; _i >= 0; _i--) {
            var _h = chat.history[_i];
            if (!_h) continue;
            if (_h.role === 'assistant' && !_h._meta) {
                if (_recentAs.length < 3) _recentAs.unshift(_h.content || '');
                if (!_lastAssistant) _lastAssistant = _h.content || '';
            }
        if (_h.role === 'user' && !_h._guardInject && !_h._verifyRound && !_h._continueRound && _msgText(_h).indexOf('（审核员素材包') !== 0 && _msgText(_h).indexOf('【审核员任务】') !== 0 && _msgText(_h).indexOf('（质检员素材包') !== 0 && _msgText(_h).indexOf('【质检员任务】') !== 0 && _msgText(_h).indexOf('（策划师素材包') !== 0 && _msgText(_h).indexOf('【策划师任务】') !== 0 && _msgText(_h).indexOf('（总结师素材包') !== 0 && _msgText(_h).indexOf('【总结师任务】') !== 0 && _msgText(_h).indexOf('（自定义素材包') !== 0 && _msgText(_h).indexOf('【自定义任务】') !== 0) {
                if (_recentQs.length < 3) _recentQs.unshift(_msgText(_h));
                if (!_lastRealUserQ) _lastRealUserQ = _h.content || '';
            }
        }
        // 2. 请求后端素材包（git diff 前后对比 + 步骤日志）
        // 先取原对话绑定的角色（写入素材包 + 供新对话继承）
        var _srcRoleName = '';
        try {
            var _sr = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null');
            if (_sr && _sr.name) _srcRoleName = String(_sr.name);
        } catch (e) {}
        var _projPath = '';
        var _projName = '';
        var _pid = chat.projectId || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || (typeof App !== 'undefined' && App._activeProjectId) || '';
        var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
        if (_projSrc && _pid) {
            for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                if (String(_projSrc[_pi].id) === String(_pid)) { _projName = _projSrc[_pi].name || _projSrc[_pi].title || ''; _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
            }
        }
        /* 【四要素溯源】项目名/对话主题/时间/所属智能体——结论回注时必须全部带上 */
        var _chatTitle = String(chat.title || '');
        try { if (!_chatTitle && chat.el) { var _te0 = chat.el.querySelector('.title'); if (_te0) _chatTitle = String(_te0.textContent || '').trim(); } } catch (eT2) {}
        var _nowStr = (function () { var _d = new Date(); function _p2(n) { return (n < 10 ? '0' : '') + n; } return _d.getFullYear() + '-' + _p2(_d.getMonth() + 1) + '-' + _p2(_d.getDate()) + ' ' + _p2(_d.getHours()) + ':' + _p2(_d.getMinutes()); })();
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/tools/verify_brief', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 30000;
            xhr.onload = function() {
                var res = {};
                try { res = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
                self._objectiveVerifySend(box, chat, {
                    projPath: _projPath, userQ: _lastRealUserQ, aiReply: _lastAssistant,
                    recentQs: _recentQs, recentAs: _recentAs,
                    toolCalls: _toolCalls, brief: res, roleName: _srcRoleName, mode: _mode
                });
            };
            xhr.onerror = function() {
                // 素材包失败也不阻塞：降级为仅上下文验证
                self._objectiveVerifySend(box, chat, { projPath: _projPath, userQ: _lastRealUserQ, aiReply: _lastAssistant, recentQs: _recentQs, recentAs: _recentAs, toolCalls: _toolCalls, brief: { ok: false }, roleName: _srcRoleName, mode: _mode });
            };
            xhr.send(JSON.stringify({ path: _projPath }));
        } catch (e) {
            self._objectiveVerifySend(box, chat, { projPath: _projPath, userQ: _lastRealUserQ, aiReply: _lastAssistant, recentQs: _recentQs, recentAs: _recentAs, toolCalls: _toolCalls, brief: { ok: false }, roleName: _srcRoleName, mode: _mode });
        }
    },


    _objectiveVerifySend: function(box, chat, ctxData) {
        var self = this;
        var brief = ctxData.brief || {};
        var lines = [];
        var mode = ctxData.mode || 'single'; // 【统一取值】显式从 ctxData 取 mode，缺省 single，供链路内统一使用
        lines.push('【审核员任务】你是一个独立的复核者，请基于下面给出的客观素材，对一个已完成的任务做出快速、客观的评价，并指出可能的 bug 与修复方法。若任务/清单中含【反驳项】小节，必须增加【反驳核验】段：逐条核验各反驳项，被证实的写入打回意见，不成立的说明理由；缺失该段视为审核不合格。');
        lines.push('');
        lines.push('== 前因后果 ==');
        lines.push('项目路径：' + (ctxData.projPath || '（未提供）'));
        // 【2026 修复】把原对话的角色/项目等配置显式写进素材包：
        // 新对话虽已在底层继承（角色提示词、项目上下文），但复核者需要知道"我是谁、在验哪个项目"，
        // 否则容易用通用助手视角评价，结论跑偏。
        if (ctxData.roleName) lines.push('原对话角色：' + ctxData.roleName + '（新对话已继承该角色人设与口吻，请以同一角色身份复核）');
        // 【增强】注入最近 3 个用户问题 + 3 条 AI 回复，让复核者看到完整多轮脉络
        var _rq = (ctxData.recentQs && ctxData.recentQs.length) ? ctxData.recentQs : (ctxData.userQ ? [ctxData.userQ] : []);
        var _ra = (ctxData.recentAs && ctxData.recentAs.length) ? ctxData.recentAs : (ctxData.aiReply ? [ctxData.aiReply] : []);
        if (_rq.length) {
            lines.push('');
            lines.push('== 最近的用户问题（最多 3 条，按时间正序） ==');
            _rq.forEach(function(q, i) { lines.push('【问题 ' + (i + 1) + '】' + String(q || '').replace(/\s+/g, ' ').trim().slice(0, 800)); });
        }
        if (_ra.length) {
            lines.push('');
            lines.push('== 执行 AI 的答复（最多 3 条，按时间正序） ==');
            _ra.forEach(function(a, i) { lines.push('【AI 回复 ' + (i + 1) + '】' + String(a || '').slice(0, 6000)); });
        }
        var _tc = (ctxData.toolCalls && ctxData.toolCalls.length) ? ctxData.toolCalls : (typeof _toolCalls !== 'undefined' ? _toolCalls : []);
        if (_tc.length) {
            lines.push('');
            lines.push('== 工具上下文（执行过程中 AI 实际调用过的工具，倒序最近15条） ==');
            _tc.forEach(function(t, i) { lines.push((i + 1) + '. ' + t); });
        }
        if (brief.ok) {
            lines.push('');
            lines.push('== 客观数据：git 改动前后对比 ==');
            lines.push('最近提交：' + (brief.last_commit || '（无）'));
            if (brief.files && brief.files.length) { lines.push('改动文件：\n' + brief.files.join('\n')); }
            if (brief.diff_stat) { lines.push('diff 统计：\n' + brief.diff_stat); }
            if (brief.diff_text) { lines.push('diff 内容（前后对比）：\n' + brief.diff_text); }
            if (brief.steps_log && brief.steps_log.length) {
                lines.push('步骤保存记录：');
                brief.steps_log.forEach(function(s) { lines.push('- step ' + s.step + ' @ ' + s.time + (s.nothing_to_commit ? '（无改动）' : ' commit:' + (s.commit || '?'))); });
            }
        } else {
            lines.push('');
            lines.push('（素材包获取失败，请自行用工具检查项目文件验证）');
        }
        lines.push('');
        lines.push('== 你的任务 ==');
        lines.push('1. 对照用户原始问题与最终答复，判断任务是否真正完成；');
        lines.push('2. 核对 diff 前后对比，确认改动是否与答复声称一致、有无遗漏或引入 bug；');
        lines.push('3. 给出结论：✅ 通过 / ⚠️ 有问题（逐条列出问题点与修复建议）。只做评价与指出问题，不改任何文件。');
        lines.push('【结论分级判定 2026-10-17】发现的问题分为两级，结论规则不同：');
        lines.push('①【正确性问题 → 必须不通过】功能 bug、代码回退、声称与实际不符（虚报完成/虚报删除/虚报在位）、改动未生效（缓存号未升/副本未同步）——发现任一条，结论必须写「不通过」并逐条列出。');
        lines.push('②【纪律类瑕疵 → 扣分但可通过】临时调试文件遗留、措辞出入、文档遗漏、运行时噪声清单出入——只扣分并在「建议整改」清单列出，结论仍可写「通过」。绝不能因纪律类瑕疵把高分工作打回。');
        lines.push('【运行时噪声免检清单】以下内容一律不算问题、不计入扣分，禁止作为打回依据：*.db-wal/*.db-shm、server/logs/、cache_watch、perf_log 等运行时文件；并行会话产生的临时文件（_probe/_diag/_scan/tmp*/_chk* 等，删除后可能被其他会话再生，非本任务责任）；自动快照收编滞后导致的 git 状态出入。');
        lines.push('绝不一边写「通过」一边列正确性问题——那样会被系统按「有问题」打回重审。确认无正确性问题后才写「通过」。');
        lines.push('4. 【评分】对本轮被审核的工作打分（0-100 整数，及格线 60；不及格将自动打回重审）。请综合以下维度给总分：任务完成度(40)、正确性/无 bug(30)、与声称一致/无遗漏(20)、质量规范(10)。');
        lines.push('【评分输出协议·强制】回复的最后一行必须单独输出：【审核评分】NN（NN 为 0-100 整数，例：【审核评分】85）。该行用于机器判定与记录，缺失会被视为未评分。');
        lines.push('【最低交付物约束】你的回复必须包含实质核验内容：至少 1 条对素材/diff/代码的独立核实结果或具体问题点。');
        lines.push('仅回传统计信息（如 token 用量、耗时、次数）而无任何核验结论的回复，视为弃权，不占用收口裁决席位。');
        var _prompt = lines.join('\n');

        // 3. 新开对话（沿用 chat_manage create 的创建链路）
        var selfApp = (typeof App !== 'undefined') ? App : null;
        if (!selfApp || typeof selfApp.createChatBox !== 'function') {
            Store.addLog('error', chat.id, 'obj-verify', '审核员失败：无法创建新对话');
            self._stepToast('审核员失败：无法创建新对话', false);
            return;
        }
        var canvasArea = document.getElementById('canvasArea');
        var cx = canvasArea ? canvasArea.clientWidth / 2 : window.innerWidth / 2;
        var cy = canvasArea ? canvasArea.clientHeight / 2 : window.innerHeight / 2;
        /* 【定位简化·v4】审核员新窗固定出现在源对话右下 90px（相对策划师再错开 30px），
           同批多窗依次 +42px 阶梯错开；不再扇形/位置记忆/拖拽继承，位置永远跟随源对话 */
        var _qIdx = 0;
        try { _qIdx = Math.max(0, ((window.ZFSwarm && window.ZFSwarm.nextIdxFor) ? window.ZFSwarm.nextIdxFor(chat.id, 'qc') : 1) - 1); } catch (eQIdx) {}
        // 【2026 修复】_srcL/_srcT 未定义导致 ReferenceError：与 1830 行同口径，从源对话画布位置解析
        /* 【源坐标修复】不再信任 style.left（可能被历史钉回逻辑写入屏幕像素值如95358导致新窗飞到±20000钳制边缘），
           优先用 getBoundingClientRect 反算画布逻辑坐标：(rect-画布区原点-视图偏移)/缩放，style.left 仅作兜底 */
        var _srcL = NaN, _srcT = NaN;
        // 【专注模式防飞窗】源窗若正被搬进专注舞台（left:0,top:0 基准），反算坐标必然全错导致新窗飞到老远；
        // 检测到专注模式激活时先同步退出（unhost 会恢复真实 style，getBoundingClientRect 随后强制重排即可取到正确坐标）
        /* 【2026-11-26 派出不再踢出专注模式】专注模式下源窗被 host 进舞台（left:0,top:0 基准），
           rect 反算坐标必然全错。原做法是强制退出专注模式（用户反馈：派出团队会莫名弹出/退出专注模式，不对）。
           现改为：从 zfFocusMode.realPos 快照取 host 前真实画布坐标；无快照（未被 host）时回退 rect 反算。 */
        try { if (window._zfFocusActive && window.zfFocusMode && typeof window.zfFocusMode.realPos === 'function') { var _fp = window.zfFocusMode.realPos(chat.id); if (_fp) { _srcL = Math.round(_fp.left); _srcT = Math.round(_fp.top); } } } catch (eZF) {}
        try {
            var _sc0 = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc0 > 0)) _sc0 = 1;
            var _cv0 = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
            var _r0 = chat.el.getBoundingClientRect();
            var _caEl0 = document.getElementById('canvasArea');
            var _caR0 = _caEl0 ? _caEl0.getBoundingClientRect() : { left: 0, top: 0 };
            if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = Math.round((_r0.left - _caR0.left - (_cv0.x || 0)) / _sc0);
            _srcT = Math.round((_r0.top - _caR0.top - (_cv0.y || 0)) / _sc0);
            }
        } catch (eSrc0) {}
        /* 【v6 交叉校验】rect 反算依赖 canvasGetView 坐标系一致，实测会得出 95350 类垃圾值把新窗钉飞；
           style.left 由拖拽模块直接写入，最可靠。两源相差 >1500 时以 style.left 为准 */
        var _stL = parseFloat(chat.el && chat.el.style.left), _stT = parseFloat(chat.el && chat.el.style.top);
        if (isFinite(_stL) && isFinite(_stT) && (isNaN(_srcL) || isNaN(_srcT) || Math.abs(_srcL - _stL) + Math.abs(_srcT - _stT) > 1500)) {
            console.log('[定位交叉校验] rect反算(', _srcL, _srcT, ') 与 style.left(', _stL, _stT, ') 不符，采用 style.left');
            _srcL = _stL; _srcT = _stT;
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = parseInt(chat.el && chat.el.style.left, 10);
            _srcT = parseInt(chat.el && chat.el.style.top, 10);
        }
        var _caOff = { left: 0, top: 0 };
        try { if (canvasArea) { var _caR = canvasArea.getBoundingClientRect(); _caOff = { left: _caR.left, top: _caR.top }; } } catch (eCa) {}
        if (isNaN(_srcL) || isNaN(_srcT)) {
            try {
                var _srcR = chat.el.getBoundingClientRect();
                // 【缩放校正】rect 是屏幕像素，画布可能有 transform scale，需换算回画布逻辑坐标
                var _sc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
                // 【平移校正】画布内容整体被 translate(view.x,view.y) 平移过，必须一并扣除
                var _cv = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
                _srcL = Math.round((_srcR.left - _caOff.left - (_cv.x || 0)) / _sc);
                _srcT = Math.round((_srcR.top - _caOff.top - (_cv.y || 0)) / _sc);
            } catch (eR) { _srcL = 0; _srcT = 0; }
        }
        if (isNaN(_srcL)) _srcL = 0;
        if (isNaN(_srcT)) _srcT = 0;
        /* 【定位·习惯优先】审核员新窗优先放回用户上次拖拽到的位置（SpawnHabit 习惯记忆），
           无习惯记录才用源窗右下 90px 默认，同批多窗依次 +42px 阶梯错开 */
        var _qcX, _qcY;
        /* 【定位统一·右下角10,10】弃用习惯记忆（脏数据会致飞窗）：新窗固定在源窗右下角外10px，同批+42级联 */
        var _qcOffW = Math.round((chat.el && chat.el.offsetWidth || 420) / _sc0);
        var _qcOffH = Math.round((chat.el && chat.el.offsetHeight || 300) / _sc0);
        try { if (window._zfFocusActive && window.zfFocusMode && zfFocusMode.realPos) { var _frq = zfFocusMode.realPos(chat.id); var _scq = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1; if (_frq && _frq.w > 0) _qcOffW = Math.round(_frq.w / _scq); if (_frq && _frq.h > 0) _qcOffH = Math.round(_frq.h / _scq); } } catch (eFSq) {}
        var _qcX = _srcL + _qcOffW + 10 + _qIdx * 20;
        var _qcY = _srcT + _qcOffH + 10 + _qIdx * 20;
        if (typeof _qcX !== 'number' || isNaN(_qcX)) _qcX = 160;
        if (typeof _qcY !== 'number' || isNaN(_qcY)) _qcY = 160;
        if (!isFinite(_qcX)) _qcX = 160;
        if (!isFinite(_qcY)) _qcY = 160;
        // 【模型继承】先解析原对话生效的模型配置 id（本对话 → 用户习惯 → 任意可用），避免新建时落到默认/习惯模型
        var _srcMid = '';
        try {
            _srcMid = (typeof App !== 'undefined' && typeof App._toolMasterResolveModelId === 'function')
                ? (App._toolMasterResolveModelId(chat) || '') : '';
        } catch (e) {}
        if (!_srcMid) _srcMid = chat.modelId || '';
        var newChat = selfApp.createChatBox(_qcX, _qcY, _srcMid || null, true);
        /* 【定位最终重申·v5】无论中间有多少层包装改动位置，创建后多拍强制钉回目标坐标 */
        try {
            var _pinFnQ = function () {
                try {
                    if (!newChat.el || !document.body.contains(newChat.el)) return;
                    var _curL = parseFloat(newChat.el.style.left), _curT = parseFloat(newChat.el.style.top);
                    var _dLq = Math.abs(_curL - _qcX), _dTq = Math.abs(_curT - _qcY);
                    /* 【v6 只微调不传送】偏差 >400px 说明是其他模块有意放置或目标坐标本身有误，放弃钉回 */
                    if ((_dLq > 1 || _dTq > 1) && Math.max(_dLq, _dTq) < 400) {
                        newChat.el.style.left = _qcX + 'px';
                        newChat.el.style.top = _qcY + 'px';
                    } else if (_dLq > 1 || _dTq > 1) {
                        console.log('[审核员定位·放弃钉回] 偏差过大(', _curL, _curT, 'vs', _qcX, _qcY, ')，尊表现有位置');
                    }
                } catch (ePinQ) {}
            };
            _pinFnQ();
            /* 【v7 防闪动】五连拍钉位与创建动画互相拉扯会放大闪动，收敛为两次：立即 + 400ms 兜底 */
            [400].forEach(function (ms) { setTimeout(_pinFnQ, ms); });
        } catch (ePinQ0) {}
        if (!newChat) {
            self._stepToast('审核员失败：新对话创建被拦截（窗口数量限制）', false);
            return;
        }
        // 【审核建议修复】写入移到 newChat 空判之后，避免 null 时抛 TypeError（虽被 try/catch 吞掉但顺序欠佳）
        try {
            newChat.el._isQcChat = true;
            newChat.el._qcSrcId = chat.id; // 【多视角蜂群】记录源对话
            try { window.ZFSwarm && window.ZFSwarm.register(newChat.id, 'qc', chat.id, Math.max(0, window.ZFSwarm.qcCountFor(chat.id) - 2) % 5); } catch (eReg) {} // 【蜂群持久化】注册表兜底（含视角固化），刷新后可恢复
            // 【审核建议修复】把本次原始对话位置存到审核员元素上，
            // 供 saveChatBox 挂钩动态读取（闭包里的 _srcL/_srcT 会随源对话移动/换源而过期）
        } catch (e) {}

        // ===== 【2026 修复】新对话必须「完全继承」原对话，否则验证结论必然跑偏 =====
        // 根因：角色/项目/引擎等配置全部按「对话 id」存储（角色在 localStorage zf_role_chat_<boxId>
        // + 服务端 /api/roles 的 selected 映射，项目在 chat.projectId，引擎在 chat._engine），
        // 而新对话是全新 id，createChatBox 只会归入「当前活动项目」，人设提示词、项目上下文全丢，
        // 新对话退化成通用助手，评价自然偏离原任务语境。
        // 处理：把原对话的角色、项目、引擎、模型覆盖、思考强度、压缩档位、工具分类逐项复制过来。

        // 1) 角色绑定（优先「审核员」角色，回退继承原对话角色）
        try {
            var _srcRole = null;
            try { _srcRole = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null'); } catch (e) {}
            
        // 【角色指定】优先绑定角色分组里名为「审核员」的角色；找不到则回退继承原对话角色
        var _applyRoleNamed = function (roleName, tag, fallbackRole, logTag) {
            var _doApply = function (role, how) {
                if (!role || !role.id) return false;
                try {
                    localStorage.setItem('zf_role_chat_' + newChat.id, JSON.stringify({
                        id: role.id, name: role.name, avatar: role.avatar, prompt: role.prompt || '',
                        chat_skin: role.chat_skin || ''
                    }));
                    try { if (typeof selfApp._refreshRoleBadge === 'function') selfApp._refreshRoleBadge(newChat.el); } catch (e) {}
                    // 【标题同步】把新对话标题改成「头像 角色名」，否则肉眼看不出角色已切换
                    try {
                        var _titleEl = newChat.el && newChat.el.querySelector('.title');
                        if (_titleEl) {
                            var _qLabel = (role.name || '审核员') + ' · 审核';
                            try { if (window.ZFSwarm && window.ZFSwarm.qcCountFor(chat.id) >= 2) _qLabel = (role.name || '审核员') + '#' + window.ZFSwarm.qcCountFor(chat.id) + ' · ' + window.ZFSwarm.qcViewName(chat.id, newChat.id); } catch (eL2) {}
                            _titleEl.textContent = _qLabel;
                            _titleEl.title = '审核扩展对话（角色：' + (role.name || '') + '）';
                        }
                    } catch (e) {}
                    try { if (typeof Theme !== 'undefined' && Theme.applyToBox && newChat.el) Theme.applyToBox(newChat.el, role.chat_skin || ''); } catch (e) {}
                    try {
                        fetch('/api/roles', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'select', box: newChat.id, role_id: role.id })
                        }).catch(function () {});
                    } catch (e) {}
                    Store.addLog('info', newChat.id, logTag, '已绑定角色（' + how + '）：' + (role.name || role.id));
                    return true;
                } catch (e) { return false; }
            };
            /* 【派单竞态修复】绑定改同步直写 + 错峰（仿 _multiRoleStart），见策划师处同款注释 */
            try { newChat._zfRoleDirect = true; } catch (eZF2) {}
            if (fallbackRole && fallbackRole.id) _doApply(fallbackRole, '继承·' + (fallbackRole.name || ''));
            setTimeout(function () {
                try {
                    fetch('/api/roles?box=' + encodeURIComponent(newChat.id))
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            var _hit = null;
                            ((res && res.roles) || []).forEach(function (r) {
                                if (String(r.name || '').trim() === roleName) _hit = r;
                            });
                            if (_hit && _hit.id) { _doApply(_hit, '指定·' + roleName); return; }
                        }).catch(function () {});
                } catch (e) {}
            }, 200);
        };

            _applyRoleNamed('审核员', 'qc', _srcRole, 'obj-verify');
        } catch (e) {}

        // 2) 项目继承（原对话项目优先，其次当前活动项目；内存 + Store + DB 三处同步）
        var _inheritPid = chat.projectId
            || (typeof App !== 'undefined' && App._activeProjectId)
            || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId)
            || '';
        if (_inheritPid) {
            newChat.projectId = _inheritPid;
            for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                if (Store.data.chatBoxes[i].id === newChat.id) { Store.data.chatBoxes[i].projectId = _inheritPid; break; }
            }
            try { if (typeof DB !== 'undefined' && DB.setNodeProject) DB.setNodeProject(newChat.id, _inheritPid).catch(function () {}); } catch (e) {}
            try { if (typeof selfApp._updateProjectBtn === 'function') selfApp._updateProjectBtn(newChat); } catch (e) {}
            Store.addLog('info', newChat.id, 'obj-verify', '已继承原对话项目：' + _inheritPid);
        }

        // 3) 引擎 / 模型线路 / 模型ID覆盖 / 思考强度 / 压缩档位 / 工具分类 继承
        try {
            if (chat._engine) newChat._engine = String(chat._engine);
            // 【模型继承】原对话的模型线路优先：createChatBox 可能因线路无效回退到习惯/默认模型，
            // 这里强制对齐回原对话的线路，保证审核员用「上一个对话的模型」发起
            if (chat.modelId && typeof Models !== 'undefined' && Models.get && Models.get(chat.modelId)) {
                newChat.modelId = chat.modelId;
            }
            // 模型ID覆盖（模型强度对应的具体模型 ID）：无条件继承，与原对话保持一致
            if (chat._modelIdOverride) {
                newChat._modelIdOverride = String(chat._modelIdOverride);
            }
            // 思考强度（模型强度）：无条件继承（含空值=跟随线路默认，与原对话行为一致），
            // 避免 createChatBox 写入的初始档位与原对话不同
            if (chat._reasoningEffort !== undefined && chat._reasoningEffort !== null) {
                newChat._reasoningEffort = String(chat._reasoningEffort || '');
            }
            if (chat._compressMode) newChat._compressMode = chat._compressMode;
            if (chat._historyMode) newChat._historyMode = chat._historyMode;
            if (typeof Tools !== 'undefined' && Tools.chatCategories && Tools.chatCategories[chat.id]) {
                Tools.chatCategories[newChat.id] = Tools.chatCategories[chat.id];
            }
            // 刷新底部模型选择器/欢迎语，让新对话界面显示继承到的模型与强度
            try {
                if (typeof newChat._refreshModelPickerBtn === 'function') newChat._refreshModelPickerBtn();
            } catch (e) {}
            try {
                if (newChat.el && newChat.el._welcomeCtx) {
                    var _ivm = Models.get(newChat.modelId) || null;
                    if (_ivm) {
                        newChat.el._welcomeCtx.model = _ivm;
                        newChat.el._welcomeCtx.mid = newChat._modelIdOverride || (_ivm.modelId || '');
                        newChat.el._welcomeCtx.re = newChat._reasoningEffort || (_ivm.reasoningEffort || '');
                        var _ivwb = newChat.el.querySelector('[data-welcome]');
                        if (_ivwb && typeof selfApp._welcomeHtml === 'function') _ivwb.innerHTML = selfApp._welcomeHtml(newChat.el);
                    }
                }
            } catch (e) {}
            Store.saveChatBox(newChat, true);
            Store.addLog('info', newChat.id, 'obj-verify',
                '已继承原对话模型：线路=' + (newChat.modelId || '-') +
                '，模型ID=' + (newChat._modelIdOverride || '-') +
                '，思考强度=' + (newChat._reasoningEffort || '默认'));
        } catch (e) {}
        Store.addLog('info', chat.id, 'obj-verify', '审核员已发起' + '：新对话 ' + newChat.id + '，素材包 ' + _prompt.length + ' 字');
        self._stepToast('审核员已发起：新对话已创建并发送验证素材包', true);
        // 【审核员方向箭头】在原始对话与审核员新对话之间生成可点击的来回箭头
        try {
            if (window.ZFVerifyArrow && typeof window.ZFVerifyArrow.create === 'function') {
                window.ZFVerifyArrow.create(chat, newChat);
            }
        } catch (e) {}
        setTimeout(function() {
            try {
                if (typeof selfApp.addMsg === 'function') selfApp.addMsg(newChat.el, '（审核员素材包，共 ' + _prompt.length + ' 字）', 'user', newChat.modelId);
                newChat.history.push({ role: 'user', content: _prompt });
                Store.addLog('info', newChat.id, 'obj-verify', '验证素材包已注入并发送');
                selfApp.sendToModel(newChat.el, newChat);
            } catch (e) {
                Store.addLog('error', newChat.id, 'obj-verify', '素材包发送异常: ' + e.message);
            }
        }, 400);
    },

    _S4_MOVED_PLACEHOLDER: function () {} // 防尾逗号
    });
})(window.App);
