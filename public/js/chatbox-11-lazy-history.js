// ========== chatbox-11-lazy-history.js - 历史消息懒渲染+上翻页（v2.0） ==========
// 【背景】重启恢复/恢复已关闭/克隆/会话面板等恢复路径此前全量渲染整段历史，
// 每条走完整 md 管线（hljs 高亮等），再由 trimMsgDom 把头部摘掉——先花大力气渲染再扔掉。
// 【方案】恢复时只渲尾部 TAIL 条（批量 HTML 拼接一次插入 + md 渲染 LRU 缓存），
// 头部留"显示更早的全部"按钮（带 compress-selector 类防 trimMsgDom 误摘），
// 点击一次分批向前补载到最早（批间 setTimeout(0) 让出主线程，单批高度差补偿防滚动跳动），
// 消息导航/定位经 ensureMsgVisible 自动补载。
// 【v2.0 口径升级 2026-11-23】用户拍板"对话框显示100条，点击向上看到上面全部内容"：
// TAIL 30→100、FULL 40→120；按钮从"每点一次补 30 条"改为一键展开全部；
// 展开后 body._histExpanded=true，实时裁剪 v4 / trimMsgDom 见标记跳过（不再裁掉展开的历史）。
// 数据层零改动：Store/DB/chat.history 照旧，AI 上下文、搜索、导出（经 loadAllBeforeExport）不受影响。
// 【v2.1 口径升级 2026-11-26】用户再拍板"新对话要实时顶掉老对话"：
// ①发现泄漏：_histExpanded 一键展开后永久停裁 → 用户点过一次展开的窗从此不顶掉，历史越滚越多回到卡顿
//   （实测：400 条重 md = 2.8 万 DOM 节点，滚动到底 707ms，构建 208ms，真机更甚）。
// ②修复=展开态自动降级：展开后挂 _histExpTimer（默认 90s 无新消息交互即收回到 TAIL 窗口，
//   _histExpanded 复位、恢复上翻按钮，数据层零动——用户要看再点上翻，分批渲染防长任务）。
// ③每条新消息（App.addMsg）都会 bumpTimer 重置倒计时：正在聊的展开窗保持展开，停下 90s 后自然收回。
// ④展开历史区挂 content-visibility:auto 懒渲染（屏外气泡跳过 layout/paint，治展开态滚动卡）。
(function () {
    'use strict';
    var TAIL = 100;     // 初始渲染尾部条数（用户拍板 100 条口径）
    var FULL = 120;     // 总条数 ≤ FULL 时全量渲染（短对话零感知）
    var BATCH = 30;     // 单批渲染粒度（展开全部时逐批让出主线程防长任务卡帧）
    var COLLAPSE_IDLE_MS = 90000; // 【v2.1】展开态自动降级倒计时：90 秒无新消息即收回到 TAIL 窗口
    // 【md 渲染 LRU 缓存】key = chatId + '::' + 序号 + '::' + 内容 hash，命中即零解析
    var _cache = new Map();
    var _CACHE_MAX = 600;

    function _hash(s) {
        var h = 0, i, c;
        s = String(s || '');
        for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h = ((h << 5) - h + c) | 0; }
        return h;
    }

    function _cachedMdHtml(chatId, idx, content, role) {
        // 【口径统一 2026-11-23】user 气泡与 AI 气泡渲染管线不同，缓存 key 加角色位防串缓存
        var key = chatId + '::' + idx + '::' + _hash(content) + '::' + (role === 'user' ? 'u' : 'a');
        var hit = _cache.get(key);
        if (hit !== undefined) { _cache.delete(key); _cache.set(key, hit); return hit; }
        var html;
        try {
            if (role === 'user' && App._renderUserInlineMd) {
                // 用户气泡：与实时路径（chatbox-04 setMsgContent → _renderUserInlineMd）同口径的
                // 行内轻渲染（ZFMD.inline，内部已转义防 XSS），不再走块级 renderMarkdown——
                // 块级管线会把用户提问渲染成 <p>/<table>/<h*> 等块级标签，与实时气泡样式漂移。
                html = App._renderUserInlineMd(String(content || ''));
            } else {
                html = App.renderMarkdown ? App.renderMarkdown(content) : App._escapeHtml(String(content || ''));
            }
        }
        catch (e) { html = App._escapeHtml(String(content || '')); }
        _cache.set(key, html);
        if (_cache.size > _CACHE_MAX) _cache.delete(_cache.keys().next().value);
        return html;
    }

    // 【气泡 HTML 拼接】与原恢复路径的类名/跳过规则同口径
    function _bubbleHtml(m, chatId, idx) {
        var content = String(m.content == null ? '' : m.content);
        var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
        var cls = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
        if (m.role === 'assistant' && content.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) cls += ' task-result-success';
        if (m.role === 'assistant' && (content.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || content.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0)) cls += ' task-result-fail';
        var inner = _cachedMdHtml(chatId, idx, content, m.role);
        return '<div class="' + cls + '">' + inner + '</div>';
    }

    // 【可渲染判定】与原路径 skip 规则同口径
    function _isTaskMeta(m) { return m && m.role === 'assistant' && String(m.content || '').indexOf('\u23F1__TASKMETA__') === 0; }
    function _isTaskSummary(m) {
        if (!m || m.role !== 'assistant') return false;
        var c = String(m.content || '');
        return c.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0 || c.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || c.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0;
    }
    function _isSelfCheck(m) { return m && m.role === 'assistant' && String(m.content || '').indexOf('[\u81EA\u9A8C\u6536]') === 0; }
// 【v7.6 协议头隐形化】协作派单协议包消息：恢复/懒加载时只出轻量摘要，不渲染大坨本体
function _isCollabBoot(m) { return m && m.role === 'user' && String(m.content || '').indexOf('\u3010\u534f\u4f5c\u534f\u8bae\u00b7') === 0; }
    function _renderable(m, opts) {
        opts = opts || {};
        if (!m) return false;
        if (m.type === 'typing' || m.type === 'tool_call' || m.type === 'tool') return false;
        if (m.role === 'tool_call' || m.role === 'tool') return false;
        // 【preFilter】调用方全过滤（如 app.js 欢迎语）：不渲染且不进 history
        if (typeof opts.preFilter === 'function') { try { if (opts.preFilter(m) === false) return false; } catch (e) {} }
        if (_isTaskMeta(m)) return false; // meta 由 _restoreTaskMetaRow 重绘（history 仍要推）
        // 【hideTaskSummary】chatbox-06 口径：✅/❌ 任务总结不渲染本体，history 保留
        if (opts.hideTaskSummary && _isTaskSummary(m)) return false;
        if (_isSelfCheck(m)) return false; // 自验收已并入上一条（原 app.js 行为）
        return true;
    }

    function _historyPushable(m) {
        return m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system');
    }

    // 【构建"显示更早的全部"按钮】compress-selector 类防 trimMsgDom 误摘（chatbox-06 L566 既有跳过分支）
    function _buildLoadBtn(body, remaining) {
        var btn = document.createElement('button');
        btn.className = 'lazy-load-earlier compress-selector';
        btn.textContent = '\u2b06\ufe0f \u663e\u793a\u66f4\u65e9\u7684\u5168\u90e8 ' + remaining + ' \u6761';
        btn.style.cssText = 'display:block;margin:8px auto;padding:4px 14px;font-size:12px;border-radius:12px;' +
            'background:rgba(128,128,128,.15);color:inherit;border:1px solid rgba(128,128,128,.3);cursor:pointer;opacity:.8;';
        btn.addEventListener('click', function () { App.expandAllHistory(body); });
        return btn;
    }

    function _countRenderable(msgs, opts) {
        var n = 0;
        for (var i = 0; i < msgs.length; i++) if (_renderable(msgs[i], opts)) n++;
        return n;
    }

    // 【惰性状态】记录本 body 未渲染的头部区间
    function _state(body) {
        if (!body._lazyHist) body._lazyHist = { chatId: '', start: 0, msgs: null, btn: null };
        return body._lazyHist;
    }

    function _removeBtn(body) {
        var st = _state(body);
        if (st.btn && st.btn.parentNode) st.btn.parentNode.removeChild(st.btn);
        st.btn = null;
    }

    function _updateBtn(body) {
        var st = _state(body);
        if (!st.msgs) return;
        if (st.busy) return; // 展开全部进行中：按钮由 expandAllHistory 接管，不重置文案/状态
        // 【v2.0 bug修复】原读 st.start（恒为 0，renderChatTail 只写不更新）→ 长对话按钮刚挂即被
        // _removeBtn 摘掉，上翻按钮从未出现过。真实"未渲染头部个数"存在 st.head。
        var remain = st.head; // renderable 中 [0, head) 未渲染
        if (remain <= 0) { _removeBtn(body); return; }
        if (!st.btn) {
            st.btn = _buildLoadBtn(body, remain);
            body.insertBefore(st.btn, body.firstChild);
        } else {
            st.btn.textContent = '\u2b06\ufe0f \u663e\u793a\u66f4\u65e9\u7684\u5168\u90e8 ' + remain + ' \u6761';
            st.btn.disabled = false;
            st.btn.style.opacity = '.8';
        }
    }

    // ============ 核心入口 1：renderChatTail —— 替代全量恢复渲染 ============
    // 用法：App.renderChatTail(box, chat, msgs, opts)
    // opts: { preFilter(m), hideTaskSummary:bool, mergeSelfCheck:bool, onBubble(m, div),
    //         onDone:fn, noHistory:bool(克隆路径防双写), source:'tag'(探测日志标识) }
    // 内部完成：chat.history 全量回填（数据层不缺，noHistory=true 时跳过）+ 尾部 TAIL 条批量渲染 + 头部按钮。
    // 【复制按钮补挂·2026-11-14】懒渲染路径此前用 innerHTML 直拼气泡，AI 答案没有复制按钮；
    // 与 setMsgContent（实时路径）同款：给 .msg.ai / .msg.ai-final 挂右上角复制按钮。
    // 【2026-11-14 作用域修复】原声明在 renderChatTail 函数体内，loadEarlierMessages 不可见
    // （补载路径调用会抛 ReferenceError），提升至 IIFE 顶层供两处共享。
    function _attachAiCopyBtn(div) {
        if (!div || div._copyBtnAttached) return;
        if (!div.classList.contains('ai') && !div.classList.contains('ai-final')) return;
        div._copyBtnAttached = true;
        var aiCopyBtn = document.createElement('button');
        aiCopyBtn.className = 'msg-copy-btn msg-ai-copy-btn';
        aiCopyBtn.title = '复制答案';
        aiCopyBtn.setAttribute('aria-label', '复制答案');
        aiCopyBtn.innerHTML = '\ud83d\udccb';
        aiCopyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var copyText = div.dataset.originalText || div.textContent || '';
            var copied = function() {
                aiCopyBtn.innerHTML = '\u2713';
                aiCopyBtn.classList.add('copied');
                setTimeout(function() { aiCopyBtn.innerHTML = '\ud83d\udccb'; aiCopyBtn.classList.remove('copied'); }, 1500);
            };
            var fallback = function() {
                var ta = document.createElement('textarea'); ta.value = copyText;
                ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
                ta.select(); try { document.execCommand('copy'); copied(); } catch (err) {}
                document.body.removeChild(ta);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(copyText).then(copied, fallback);
            else fallback();
        });
        div.appendChild(aiCopyBtn);
    }

    // 【用户气泡复制按钮补挂·2026-11-23】懒渲染路径此前只补挂 AI 复制按钮，用户提问气泡没有任何
    // 操作按钮。此处按"现有 helper 能力范围"补挂：仅纯文本复制按钮（与上方 _attachAiCopyBtn 同款
    // 模式）。【能力范围注明】实时路径（chatbox-04 setMsgContent）用户气泡另有带图复制/编辑(✏️)/
    // 导航/查看回答等按钮——本文件不新造编辑/删除逻辑，懒渲染只补纯文本复制这一档。
    function _attachUserCopyBtn(div) {
        if (!div || div._userCopyBtnAttached) return;
        if (!div.classList.contains('user')) return;
        div._userCopyBtnAttached = true;
        var userCopyBtn = document.createElement('button');
        userCopyBtn.className = 'msg-copy-btn msg-user-copy-btn';
        userCopyBtn.title = '复制消息';
        userCopyBtn.setAttribute('aria-label', '复制消息');
        userCopyBtn.innerHTML = '\ud83d\udccb';
        userCopyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var copyText = div.dataset.originalText || div.textContent || '';
            var copied = function() {
                userCopyBtn.innerHTML = '\u2713';
                userCopyBtn.classList.add('copied');
                setTimeout(function() { userCopyBtn.innerHTML = '\ud83d\udccb'; userCopyBtn.classList.remove('copied'); }, 1500);
            };
            var fallback = function() {
                var ta = document.createElement('textarea'); ta.value = copyText;
                ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
                ta.select(); try { document.execCommand('copy'); copied(); } catch (err) {}
                document.body.removeChild(ta);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(copyText).then(copied, fallback);
            else fallback();
        });
        div.appendChild(userCopyBtn);
    }

    App.renderChatTail = function (box, chat, msgs, opts) {
        opts = opts || {};
        var body = box.querySelector('.chatbox-body');
        if (!body) return;
        var chatId = chat.id || box.id || '';

        // 0) 若该 body 已有惰性状态（重复恢复同一 body），先清掉旧按钮防残留
        _removeBtn(body);

        // 1) chat.history 全量回填（数据层零缺，AI 上下文/搜索不受影响）
        if (!opts.noHistory && chat && chat.history) {
            for (var hi = 0; hi < msgs.length; hi++) {
                var hm = msgs[hi];
                if (opts.preFilter && typeof opts.preFilter === 'function') {
                    try { if (opts.preFilter(hm) === false) continue; } catch (ePf) {}
                }
                if (_historyPushable(hm)) chat.history.push({ role: hm.role, content: hm.content });
            }
        }

        // 2) 过滤出可渲染序列
        var renderable = [];
        for (var i = 0; i < msgs.length; i++) if (_renderable(msgs[i], opts)) renderable.push({ m: msgs[i], idx: i });
        var total = renderable.length;

        // 3) 全量渲染 或 尾部 TAIL 条
        var fromIdx = total > FULL ? total - TAIL : 0;
        var htmlParts = [];
        for (var r = fromIdx; r < total; r++) htmlParts.push(_bubbleHtml(renderable[r].m, chatId, renderable[r].idx));
        // 【插入起点基线】插入前记录既有 .msg 个数：beforeend 恒把新节点追加在尾部，
        // 用"插入前基线"而非"总数-条数"反推，免疫 body 非空（重复恢复/残留节点）时的错位。
        var _baseMsgCnt = body.querySelectorAll('.msg').length;
        // 批量一次插入（突破师杠杆A：替代逐条解析+逐条 DOM 插入）
        body.insertAdjacentHTML('beforeend', htmlParts.join(''));
        // 恢复/补载插入后：给本次插入的 AI 气泡挂复制按钮 + 写回 originalText（供复制纯文本）
        // 【2026-11-23】用户气泡同批补挂纯文本复制按钮（_attachUserCopyBtn，能力范围注明见其定义）
        (function _attachCopyBtnsToInserted() {
            var _ins = body.querySelectorAll('.msg');
            var _cnt = renderable.length;
            var _start = _baseMsgCnt;
            for (var _k = 0; _k < _cnt; _k++) {
                var _d = _ins[_start + _k];
                if (!_d) continue;
                var _mm = renderable[_k].m;
                try { if (!_d.dataset.originalText) _d.dataset.originalText = String(_mm.content || ''); } catch (eT) {}
                _attachAiCopyBtn(_d);
                _attachUserCopyBtn(_d);
            }
        })();

        // 【mergeSelfCheck】app.js 口径：[自验收] 并入上一条 ai-final 气泡（插入后处理，需 DOM 就位）
        if (opts.mergeSelfCheck) {
            var _nodes = body.querySelectorAll('.msg');
            for (var _i = 0; _i < msgs.length; _i++) {
                var _m = msgs[_i];
                if (!_isSelfCheck(_m)) continue;
                // 找 renderable 序列中该自验收前的最后一条 ai-final 对应 DOM
                var _target = null;
                for (var _j = _nodes.length - 1; _j >= 0; _j--) { if (_nodes[_j].classList.contains('ai-final')) { _target = _nodes[_j]; break; } }
                if (_target) {
                    var _scDiv = document.createElement('div');
                    _scDiv.className = 'self-check-inline md-body';
                    try { _scDiv.innerHTML = App.renderMarkdown ? App.renderMarkdown(String(_m.content || '')) : App._escapeHtml(String(_m.content || '')); }
                    catch (_eSc) { _scDiv.textContent = String(_m.content || ''); }
                    _target.appendChild(_scDiv);
                }
            }
        }
        // 【onBubble】调用方逐气泡增强（如 chatbox-06 用户图片缩略图）
        if (typeof opts.onBubble === 'function') {
            var _bn = body.querySelectorAll('.msg');
            for (var _b = 0; _b < renderable.length && _b < _bn.length; _b++) {
                try { opts.onBubble(renderable[_b].m, _bn[_bn.length - renderable.length + _b]); } catch (eB) {}
            }
        }
        // 4) 头部未渲完 → 挂按钮（记录 opts 供补载沿用同口径）
        if (fromIdx > 0) {
            var st = _state(body);
            st.chatId = chatId;
            st.msgs = msgs;
            st.start = 0;
            st.renderable = renderable;
            st.head = fromIdx; // renderable 中尚未渲染的头部个数
            st.opts = opts;    // 补载沿用同口径（hideTaskSummary/onBubble/preFilter 等）
            _updateBtn(body);
        }

        // 5) 收尾回调（标题/任务行/滚动由调用方或 onDone 处理）
        /* 【2026-11-22 Violation修复】插入尾部消息后立刻读 scrollHeight 会强制整页回流：
           启动恢复路径实测 55~69ms，触发 Chrome "[Violation] Forced reflow while executing
           JavaScript" 控制台警告。双 rAF 推迟一帧——首帧渲染管线自然完成布局后，二帧读取
           时布局缓存已干净，零强制回流。
           【CV 强制布局守卫 2026-11】改走 zfScrollBottom：窗口若已被屏外剔除（content-visibility:hidden），
           滚底是对隐藏子树的强排（刷 Chrome "Rendering was performed…" 警告）→ 记账延后到回屏补滚 */
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (window.zfScrollBottom) window.zfScrollBottom(body); else body.scrollTop = body.scrollHeight;
            });
        });
        if (opts.onDone) try { opts.onDone(); } catch (e) {}
    };

    // ============ 核心入口 2：loadEarlierMessages —— 上翻页补载 ============
    App.loadEarlierMessages = function (body) {
        if (!body) return;
        var st = _state(body);
        if (!st.renderable || st.head <= 0) { _removeBtn(body); return; }
        var end = Math.max(0, st.head - BATCH);
        var opts = st.opts || {};
        var htmlParts = [];
        for (var r = end; r < st.head; r++) htmlParts.push(_bubbleHtml(st.renderable[r].m, st.chatId, st.renderable[r].idx));
        // 高度差补偿：加载的头部在上方，保滚动位置稳定
        var prevH = body.scrollHeight;
        var prevTop = body.scrollTop;
        if (st.btn && st.btn.parentNode) {
            var btnParent = st.btn.parentNode;
            var tmp = document.createComment('lazy-anchor');
            btnParent.replaceChild(tmp, st.btn);
            body.insertAdjacentHTML('afterbegin', htmlParts.join(''));
            btnParent.replaceChild(st.btn, tmp);
        } else {
            body.insertAdjacentHTML('afterbegin', htmlParts.join(''));
        }
        var newH = body.scrollHeight;
        body.scrollTop = prevTop + (newH - prevH);
        // 【复制按钮补挂·2026-11-14】补载批次同口径（与 renderChatTail 一致）
        // 【2026-11-23】补载是 afterbegin 头插：新节点恒为文档序最前的 _cnt2 个 .msg，
        // 用户气泡同批补挂纯文本复制按钮（能力范围注明见 _attachUserCopyBtn 定义）
        (function _attachCopyBtnsToPrepended() {
            var _en2 = body.querySelectorAll('.msg');
            var _cnt2 = st.head - end;
            for (var _k2 = 0; _k2 < _cnt2 && _k2 < _en2.length; _k2++) {
                var _d2 = _en2[_k2];
                var _mm2 = st.renderable[end + _k2].m;
                try { if (!_d2.dataset.originalText) _d2.dataset.originalText = String(_mm2.content || ''); } catch (eT2) {}
                _attachAiCopyBtn(_d2);
                _attachUserCopyBtn(_d2);
            }
        })();
        // 【onBubble】补载批次同样逐气泡增强
        if (typeof opts.onBubble === 'function') {
            var _en = body.querySelectorAll('.msg');
            for (var _b = 0; _b < (st.head - end) && _b < _en.length; _b++) {
                try { opts.onBubble(st.renderable[end + _b].m, _en[_b]); } catch (eB) {}
            }
        }
        st.head = end;
        _updateBtn(body);
        if (end <= 0) {
            st.btn && (st.btn.textContent = '\u2713 \u5df2\u5230\u6700\u65e9\u6d88\u606f', st.btn.disabled = true, st.btn.style.opacity = '.45');
            setTimeout(function () { _removeBtn(body); }, 2500);
        }
        st._via = '';
        try { if (typeof App._refreshUserMsgBtns === 'function') App._refreshUserMsgBtns(body); } catch (e) {}
    };

    // ============ v2.1 展开态自动降级 —— "新对话实时顶掉老对话"闭环 ============
    // 【为什么】v2.0 的一键展开 = _histExpanded=true 永久停裁（历史越滚越多→卡顿回归）。
    // 【怎么做】展开后挂倒计时定时器；90s 无新消息即 collapseExpandedHistory 收回到 TAIL 窗口；
    // App.addMsg 每条新消息调 bumpExpandedTimer 重置倒计时（正在聊保持展开，停下自动收回）。
    // 数据层零动：chat.history 从未被裁，收回只是摘 DOM，用户再点上翻分批重渲（有 LRU 缓存秒回）。
    function _armTimer(body, ms) {
        var st = _state(body);
        if (st._collapseTimer) { clearTimeout(st._collapseTimer); st._collapseTimer = null; }
        st._collapseTimer = setTimeout(function () {
            st._collapseTimer = null;
            // 到点复核：仍处展开态才收（期间可能已被 reset/手动复位）
            if (body._histExpanded) App.collapseExpandedHistory(body);
        }, ms || COLLAPSE_IDLE_MS);
    }
    // 新消息进来重置倒计时（chatbox-06 addMsg 裁剪路径调用；展开态才有效）
    App.bumpExpandedTimer = function (body) {
        if (!body || !body._histExpanded) return;
        _armTimer(body);
    };
    // 收回展开态：摘掉超出的头部气泡 DOM（保留最后 TAIL 条 + 按钮钩子），复位 _histExpanded
    App.collapseExpandedHistory = function (body) {
        if (!body) return 0;
        var st = _state(body);
        if (st._collapseTimer) { clearTimeout(st._collapseTimer); st._collapseTimer = null; }
        if (!st.renderable || !st.msgs) return 0; // 无惰性状态（短对话全量渲染）不适用
        var els = body.querySelectorAll('.msg');
        var totalRenderable = st.renderable.length;
        var keep = Math.min(TAIL, totalRenderable);
        var removeN = els.length - keep;
        if (removeN <= 0) { body._histExpanded = false; _updateBtn(body); return 0; }
        // 记录收起前沿感知：如果用户正盯着底部（几乎滚到底），收头部无需滚动补偿；否则保底部锚
        var nearBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 60;
        var prevTop = body.scrollTop;
        var prevH = body.scrollHeight;
        for (var i = 0; i < removeN; i++) {
            var el = els[i];
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }
        st.head = totalRenderable - keep; // 头部未渲染个数复位
        body._histExpanded = false;
        if (!nearBottom) {
            var newH = body.scrollHeight;
            body.scrollTop = Math.max(0, prevTop - (prevH - newH));
        }
        _updateBtn(body); // 重新挂"显示更早的全部 N 条"按钮
        return removeN;
    };
    // 展开历史区挂 content-visibility 懒渲染：屏外气泡跳过 layout/paint（v2.1 治展开态滚动卡）
    function _markExpandedCv(body) {
        if (!body) return;
        body.classList.add('zf-hist-expanded');
        // 只给头部已渲染但屏外的气泡挂 cv（尾屏气泡保留即时布局，防滚底跳动）
        var els = body.querySelectorAll('.msg');
        var cvFrom = Math.max(0, els.length - TAIL);
        for (var i = 0; i < cvFrom; i++) {
            if (!els[i].style.contentVisibility) els[i].style.contentVisibility = 'auto';
            if (!els[i].style.containIntrinsicSize) els[i].style.containIntrinsicSize = 'auto 120px';
        }
    }

    // ============ 核心入口 2b：expandAllHistory —— 点击一次看到上面全部内容（v2.0） ============
    // 用户拍板口径："点击向上可以看到上面全部内容"。分批调 loadEarlierMessages（每批自带
    // 高度差补偿 + 复制按钮补挂），批间 setTimeout(0) 让出主线程防长任务卡帧。
    // 展开即打 body._histExpanded=true：实时裁剪 v4 / trimMsgDom 见标记跳过，
    // 保证已展开的全部历史不被新消息触发的自动裁剪裁掉（刷新/关开窗口自然复位）。
    App.expandAllHistory = function (body) {
        if (!body) return;
        var st = _state(body);
        if (!st.renderable || st.head <= 0 || st.busy) return;
        st.busy = true;
        body._histExpanded = true;
        if (st.btn) {
            st.btn.disabled = true;
            st.btn.style.opacity = '.55';
        }
        (function drain() {
            var st2 = _state(body);
            if (!st2.renderable || st2.head <= 0) {
                st2.busy = false;
                // 【v2.1】展开完成：①给屏外历史挂 content-visibility 懒渲染 ②武装 90s 自动降级倒计时
                try { _markExpandedCv(body); } catch (eCv) {}
                _armTimer(body);
                return;
            } // 最后一批内已置灰"✓ 已到最早消息"并定时移除
            if (st2.btn) st2.btn.textContent = '\u23f3 \u6b63\u5728\u52a0\u8f7d\u5168\u90e8\u5386\u53f2\u2026\u5269\u4f59 ' + st2.head + ' \u6761';
            App.loadEarlierMessages(body);
            setTimeout(drain, 0);
        })();
    };

    // ============ 核心入口 3：ensureMsgVisible —— 导航/定位兜底 ============
    // 目标消息在未渲染区间时自动补载到可见，返回已渲染的 DOM 节点（或 null 找不到）
    App.ensureMsgVisible = function (body, matchFn) {
        if (!body || typeof matchFn !== 'function') return null;
        var els = body.querySelectorAll('.msg');
        for (var i = 0; i < els.length; i++) { try { if (matchFn(els[i])) return els[i]; } catch (e) {} }
        // 未渲染区间逐步补载查找
        var guard = 0;
        while (_state(body).head > 0 && guard++ < 100) {
            var before = _state(body).head;
            _state(body)._via = 'ensure\u00b7\u7591\u8def\u5f84\u9057\u6f0f';
            App.loadEarlierMessages(body);
            if (_state(body).head === before) break; // 防死循环
            els = body.querySelectorAll('.msg');
            for (var j = 0; j < els.length; j++) { try { if (matchFn(els[j])) return els[j]; } catch (e2) {} }
        }
        return null;
    };

    // ============ 导出补载（反驳师①：chatbox-08 走 DOM 导出，导出前必须补全） ============
    App.loadAllBeforeExport = function (body, done) {
        if (!body) { done && done(); return; }
        var st = _state(body);
        if (!st.head || st.head <= 0) { done && done(); return; }
        (function drain() {
            if (_state(body).head > 0) { App.loadEarlierMessages(body); setTimeout(drain, 0); }
            else done && done();
        })();
    };

    // ============ 状态复位（对话真正切换/清空 body 时调用，防串扰） ============
    App.resetLazyHistory = function (body) {
        if (!body) return;
        var st = body._lazyHist;
        if (st && st._collapseTimer) { clearTimeout(st._collapseTimer); st._collapseTimer = null; } // 【v2.1】清降级倒计时
        if (body.classList) body.classList.remove('zf-hist-expanded'); // 【v2.1】摘展开标记
        delete body._lazyHist;
    };
})();
