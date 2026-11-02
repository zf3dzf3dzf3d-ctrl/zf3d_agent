// ========== agent-06-self-eval.js —— AI 自评分徽章 + 接棒者按钮条（接力机制 v1.0） ==========
// 扫描 .msg.ai-final 气泡中的【自评】/【接棒】结构化块：
//   【自评】准确度 x/10 | 完整度 y/10 | 置信度 z%   → 渲染评分徽章
//   【接棒】角色|数量|任务说明                      → 渲染接棒按钮条（数量宏 1-3）
// 点击按钮 → POST /api/dispatch_successor → 后端 dispatch_swarm.submit 派出接棒 AI
// 原始标记文本在气泡中隐藏（仅展示徽章与按钮），解析失败静默不展示。
(function () {
    'use strict';
    if (window.__selfEvalInit) return;
    window.__selfEvalInit = true;

    var RE_EVAL = /【自评】\s*([^\n]{0,120})/;
    var RE_SUCC = /【接棒】\s*([^\n]{0,200})/;
    var RE_REC = /【推荐接棒】\s*([^\n]{0,400})/;

    function parseEval(txt) {
        var m = txt.match(RE_EVAL);
        if (!m) return null;
        var s = m[1], out = {};
        var acc = s.match(/准确度\s*(\d+)\s*\/\s*10/);
        var com = s.match(/完整度\s*(\d+)\s*\/\s*10/);
        var con = s.match(/置信度\s*(\d+)\s*%/);
        if (acc) out.acc = +acc[1];
        if (com) out.com = +com[1];
        if (con) out.conf = +con[1];
        out.raw = s;
        return (out.acc != null || out.com != null || out.conf != null) ? out : null;
    }

    function parseSucc(txt) {
        var m = txt.match(RE_SUCC);
        if (!m) return null;
        var parts = m[1].split(/[|｜]/).map(function (x) { return x.trim(); });
        var role = parts[0] || '审核师';
        if (role === '无' || role === '无需接棒' || role === '不需要') return null;
        var count = parseInt(parts[1], 10);
        if (!(count >= 1 && count <= 3)) count = 2;
        var task = (parts[2] && parts[2] !== '无') ? parts[2] : '';
        return { role: role, count: count, task: task };
    }

    // ===== 派单确认弹窗：点击接棒按钮先弹确认卡（角色+可编辑预写提示词+上下文预览），确认后才真正派发 =====
    function openDispatch(succ, ctx, btn) {
        // 若已有弹窗打开，先关闭
        var old = document.getElementById('__dispatchModal');
        if (old) old.remove();
        var overlay = document.createElement('div');
        overlay.id = '__dispatchModal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
        var card = document.createElement('div');
        card.style.cssText = 'width:min(560px,92vw);max-height:86vh;overflow:auto;background:var(--bg,#1e1e1e);color:inherit;border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.4);font-size:13px;line-height:1.6;';
        card.innerHTML = '<div style="font-size:15px;font-weight:700;margin-bottom:10px;">🐝 确认派出接棒 AI</div>'
            + '<div style="margin-bottom:8px;">角色：<b style="color:#58a6ff;">' + String(succ.role).replace(/</g, '&lt;') + '</b>　派出数量：<b style="color:#ffa657;font-size:17px;">🐝 × ' + succ.count + '</b></div>'
            + '<label style="display:block;margin-bottom:4px;opacity:.8;">接棒指令（AI 预写，可编辑）：</label>'
            + '<textarea id="__dmTask" style="width:100%;min-height:88px;box-sizing:border-box;padding:8px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;font:inherit;resize:vertical;"></textarea>'
            + '<details style="margin:8px 0;"><summary style="cursor:pointer;opacity:.75;">上下文预览（' + ctx.length + ' 字）</summary>'
            + '<div style="max-height:160px;overflow:auto;white-space:pre-wrap;padding:8px;margin-top:4px;background:rgba(128,128,128,.08);border-radius:8px;font-size:12px;"></div></details>'
            + '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">'
            + '<button id="__dmCancel" style="padding:6px 16px;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;cursor:pointer;">取消</button>'
            + '<button id="__dmOk" style="padding:6px 18px;border-radius:8px;border:none;background:#1a7f37;color:#fff;cursor:pointer;font-weight:600;">确认派发</button></div>';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        card.querySelector('#__dmTask').value = succ.task || (succ.role === '审核师' ? '复核并指出问题' : '评审并提出改进');
        card.querySelector('details > div').textContent = ctx.slice(0, 2000) + (ctx.length > 2000 ? '\n…（仅预览前 2000 字，派发携带全文）' : '');
        function close() { overlay.remove(); if (btn) { btn.disabled = false; btn.textContent = btn._origText; } }
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        card.querySelector('#__dmCancel').onclick = close;
        card.querySelector('#__dmOk').onclick = function () {
            var t = card.querySelector('#__dmTask').value.trim() || succ.task || '扩展思考';
            overlay.remove();
            dispatch({ role: succ.role, count: succ.count, task: t }, ctx, btn);
        };
    }

    var dispatch2 = openDispatch; // 统一收口：所有接棒按钮点击先弹确认卡

    function dispatch(succ, context, btn) {
        if (btn) { btn.disabled = true; btn.textContent = '派发中…'; }
        fetch('/api/dispatch_successor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: succ.role,
                count: succ.count,
                task: succ.task || (succ.role === '审核师' ? '复核并指出问题' : '评审并提出改进'),
                context: context
            })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (!btn) return;
            if (!d || !d.ok) {
                btn.disabled = false;
                btn.textContent = '❌ ' + ((d && d.err) || '派发失败');
                setTimeout(function () { btn.textContent = btn._origText; }, 5000);
                return;
            }
            btn.textContent = '⏳ 接棒AI工作中…（批次 ' + String(d.batch_id || '').slice(0, 10) + '）';
            pollSuccessor(d.batch_id, btn, succ);
        }).catch(function (e) {
            if (btn) { btn.disabled = false; btn.textContent = '❌ 网络错误'; setTimeout(function () { btn.textContent = btn._origText; }, 5000); }
        });
    }

    // 轮询批次状态并弹出接棒 AI 的审核结论
    function pollSuccessor(batchId, btn, succ) {
        var tries = 0, maxTries = 240; // 最多等 20 分钟（5s/次）
        (function poll() {
            tries++;
            fetch('/api/swarm/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batch_id: batchId })
            }).then(function (r) { return r.json(); }).then(function (d) {
                var b = d && d.batch;
                var tasks = (b && b.tasks) || [];
                var done = tasks.filter(function (t) { return t.status === 'done' || t.status === 'failed'; }).length;
                if (b && (b.status === 'done' || done >= tasks.length && tasks.length > 0)) {
                    var outs = tasks.map(function (t, i) {
                        return '── 接棒AI ' + (i + 1) + '（' + (t.status === 'done' ? (succ && succ.role || '接棒') : '失败') + '）──\n' + (t.output || t.status);
                    }).join('\n\n');
                    showSuccessorResult(btn, outs, tasks.length);
                    btn.disabled = false;
                    return;
                }
                if (tries >= maxTries) {
                    btn.disabled = false;
                    btn.textContent = '⚠ 等待超时，结果可在蜂群面板查看（' + batchId.slice(0, 10) + '）';
                    setTimeout(function () { btn.textContent = btn._origText; }, 8000);
                    return;
                }
                btn.textContent = '⏳ 接棒AI工作中… ' + done + '/' + tasks.length;
                setTimeout(poll, 5000);
            }).catch(function () {
                if (tries >= maxTries) { btn.disabled = false; btn.textContent = btn._origText; return; }
                setTimeout(poll, 5000);
            });
        })();
    }

    // 展示接棒结论：气泡内嵌结果卡 + 右下角气泡通知
    function showSuccessorResult(btn, outs, n) {
        btn.textContent = '✅ ' + n + ' 个接棒AI已完成（点击收起/展开）';
        btn._resultOpen = false;
        btn.onclick = function () {
            btn._resultOpen = !btn._resultOpen;
            var card = btn._resultCard;
            if (card) card.style.display = btn._resultOpen ? 'block' : 'none';
        };
        var bubble = btn.closest('.msg');
        var card = document.createElement('div');
        card.className = 'successor-result-card';
        card.style.cssText = 'margin-top:8px;padding:10px 12px;background:rgba(128,128,128,.08);border:1px solid rgba(128,128,128,.25);border-radius:8px;white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:420px;overflow:auto;display:none;';
        card.textContent = outs;
        btn._resultCard = card;
        (bubble || btn.parentElement).appendChild(card);
        btn._resultOpen = true;
        card.style.display = 'block';
        try {
            var toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;right:18px;bottom:78px;z-index:99999;background:#1a7f37;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.3);';
            toast.textContent = '🐝 ' + n + ' 个接棒AI已完成，结论已附在原回答下方';
            document.body.appendChild(toast);
            setTimeout(function () { toast.remove(); }, 6000);
        } catch (e) {}
    }

    function enhance(bubble) {
        if (bubble.__selfEvalDone) return;
        // 防套娃：接棒AI结论卡/蜂群面板内不再注入自评按钮
        if (bubble.closest && (bubble.closest('.successor-result-card') || bubble.closest('.swarm-panel'))) return;
        var txt = bubble.textContent || '';
        var ev = parseEval(txt);
        var sc = parseSucc(txt);
        if (!ev && !sc) return;
        bubble.__selfEvalDone = true;

        // 【已停用徽章渲染 2026-10-17】用户反馈自评/接棒几乎没用，要求移除。
        // 仅保留：剥离原始标记行（含历史消息），不再渲染评分徽章与接棒按钮条。
        try {
            var walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
            var n;
            while ((n = walker.nextNode())) {
                if (n.nodeValue.indexOf('【自评】') > -1 || n.nodeValue.indexOf('【接棒】') > -1 || n.nodeValue.indexOf('【推荐接棒】') > -1) {
                    n.nodeValue = n.nodeValue
                        .replace(/【自评】[^\n]{0,120}/g, '')
                        .replace(/【接棒】[^\n]{0,200}/g, '')
                        .replace(/【推荐接棒】[^\n]{0,400}/g, '');
                }
            }
        } catch (e) {}
        bubble.__selfEvalDone = true;
        return;
    }

    function scan(root) {
        try {
            (root || document).querySelectorAll('.msg.ai-final').forEach(enhance);
        } catch (e) {}
    }

    function boot() {
        scan(document);
        var mo = new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                for (var i = 0; i < m.addedNodes.length; i++) {
                    var n = m.addedNodes[i];
                    if (n.nodeType !== 1) continue;
                    if (n.classList && n.classList.contains('ai-final')) enhance(n);
                    else if (n.querySelectorAll) scan(n);
                }
            });
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
