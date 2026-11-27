/* 真沙箱设置 — 设置面板「安全隔离」组（读 /api/sandbox/status，写 /api/sandbox/set）
   独立模块，删除本文件 + index.html 一行即下线 */
(function () {
    'use strict';

    function _T(s) { try { return (window.I18N && window.I18N.t) ? window.I18N.t(s) : s; } catch (e) { return s; } }

    async function fetchStatus() {
        try { const r = await fetch('/api/sandbox/status', { method: 'POST' }); return await r.json(); }
        catch (e) { return { ok: false, error: String(e) }; }
    }

    function modeLabel(m) {
        return { job: '标准保护（推荐）', docker: '最高保护（Docker）', off: '关闭保护' }[m] || m;
    }

    function modeDesc(m) {
        return {
            job: 'AI 运行的每条命令都被关进一个"带围栏的笼子"：限制内存和运行时长，并藏好你的 API 密钥。万一 AI 写出失控的命令，最多卡住或超时，不会拖垮你的电脑。适合绝大多数用户。',
            docker: '把 AI 的命令关进一个完全独立的"小房间"：不能联网、只能看你的项目文件夹。即使 AI 被恶意内容诱导，也拿不走你的密钥、碰不到电脑其他文件。需要电脑上装了 Docker，推荐处理不受信任内容（如陌生网页、来历不明的文件）的用户使用。',
            off: 'AI 的命令直接在你的电脑上裸跑，没有任何保护。运行更快，但 AI 出错时可能影响系统。不建议普通用户选择。'
        }[m] || '';
    }

    function render(st) {
        const box = document.getElementById('sandboxPanel');
        if (!box) return;
        if (!st || !st.ok) {
            box.innerHTML = '<div style="font-size:12px;color:var(--text2);">无法获取沙箱状态：' + (st && st.error ? st.error : '未知错误') + '</div>';
            return;
        }
        const dockerDisabled = !st.docker_available;
        const dockerTip = dockerDisabled ? '你的电脑还没安装 Docker，选了也会自动退回"标准保护"' : '';
        box.innerHTML =
            '<div style="font-size:13px;line-height:1.7;color:var(--text2);margin-bottom:12px;">' +
            'AI 干活时会执行命令、修改文件。这个设置决定<b style="color:var(--text);">给 AI 的操作上几道"安全锁"</b>，' +
            '防止 AI 万一出错或被恶意内容骗到时，搞乱你的电脑。<br>' +
            '当前生效：<b style="color:var(--text);">' + modeLabel(st.mode) + '</b>' +
            '（单条命令最多可用内存 ' + st.mem_mb + ' MB）</div>' +
            '<div class="field"><label>保护级别</label>' +
            '<select id="sandboxModeSel" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">' +
            '<option value="job">🟢 标准保护（推荐 · 已默认开启）</option>' +
            '<option value="docker"' + (dockerDisabled ? ' title="' + dockerTip + '"' : '') + '>🟡 最高保护（Docker' + (dockerDisabled ? ' · 未安装 Docker' : '') + '）</option>' +
            '<option value="off">🔴 关闭保护（不建议）</option>' +
            '</select></div>' +
            '<div id="sandboxModeDesc" style="font-size:12px;color:var(--text2);line-height:1.7;margin:4px 0 14px 0;padding:10px 12px;background:rgba(0,122,204,0.06);border-left:3px solid rgba(0,122,204,0.5);border-radius:0 6px 6px 0;"></div>' +
            '<div class="field"><label>单条命令内存上限（MB，普通使用不用改）</label>' +
            '<input type="number" id="sandboxMemInput" value="' + st.mem_mb + '" min="128" max="32768" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);"></div>' +
            '<div style="font-size:11px;color:var(--text2);margin:8px 0;">' +
            '💡 常见问题：<br>' +
            '· AI 报"内存超限/命令超时"？→ 在上方把内存上限调大一点再试。<br>' +
            '· 选了最高保护却没生效？→ 需要先安装并启动 Docker。<br>' +
            '· 改完设置什么时候生效？→ 保存后重启软件即可。' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<button class="btn" id="sandboxSaveBtn" style="font-size:12px;padding:6px 16px;">保存配置</button>' +
            '<span id="sandboxSaveMsg" style="font-size:12px;color:var(--text2);"></span></div>';

        const descBox = box.querySelector('#sandboxModeDesc');
        const sel = box.querySelector('#sandboxModeSel');
        function syncDesc() { descBox.textContent = modeDesc(sel.value) + (sel.value === 'docker' && dockerDisabled ? ' ' + dockerTip : ''); }
        sel.value = st.mode;
        syncDesc();
        sel.addEventListener('change', syncDesc);
        box.querySelector('#sandboxSaveBtn').addEventListener('click', async function () {
            const msg = box.querySelector('#sandboxSaveMsg');
            msg.textContent = '保存中…';
            try {
                const r = await fetch('/api/sandbox/set', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: box.querySelector('#sandboxModeSel').value, mem_mb: parseInt(box.querySelector('#sandboxMemInput').value, 10) || undefined })
                });
                const j = await r.json();
                msg.textContent = j.ok ? (j.msg || '已保存') : ('失败：' + (j.msg || '未知错误'));
                if (j.ok && j.status) { box.querySelector('#sandboxModeSel').value = j.status.mode; }
            } catch (e) { msg.textContent = '失败：' + String(e); }
        });
    }

    function init() {
        const box = document.getElementById('sandboxPanel');
        if (!box) return;
        fetchStatus().then(render);
    }

    // 设置面板打开时刷新
    document.addEventListener('click', function (e) {
        const t = e.target;
        if (t && t.closest && t.closest('[data-settings-tab="sandbox"]')) setTimeout(init, 50);
    });

    window.App = window.App || {};
    window.App.refreshSandboxPanel = init;
})();
