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
        return { job: 'Job 围栏（默认，防失控）', docker: 'Docker 容器（断网强隔离）', off: '关闭（不隔离）' }[m] || m;
    }

    function render(st) {
        const box = document.getElementById('sandboxPanel');
        if (!box) return;
        if (!st || !st.ok) {
            box.innerHTML = '<div style="font-size:12px;color:var(--text2);">无法获取沙箱状态：' + (st && st.error ? st.error : '未知错误') + '</div>';
            return;
        }
        const dockerDisabled = !st.docker_available;
        const dockerTip = dockerDisabled ? '（未检测到 Docker，选择后将自动降级为 Job 围栏）' : '';
        box.innerHTML =
            '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;">' +
            '执行 AI 生成的命令时的隔离方式。当前生效：<b style="color:var(--text);">' + modeLabel(st.mode) + '</b>' +
            '（来源：' + (st.source === 'env' ? '环境变量' : st.source === 'config' ? '本配置' : '默认') +
            ' · 内存限额 ' + st.mem_mb + ' MB）</div>' +
            '<div class="field"><label>沙箱档位</label>' +
            '<select id="sandboxModeSel" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">' +
            '<option value="job">Job 围栏（默认 · 内存/CPU/超时围栏）</option>' +
            '<option value="docker"' + (dockerDisabled ? ' title="' + dockerTip + '"' : '') + '>Docker 容器（断网强隔离）' + (dockerDisabled ? ' — 不可用' : '') + '</option>' +
            '<option value="off">关闭（不隔离，风险自担）</option>' +
            '</select></div>' +
            '<div class="field"><label>内存限额（MB，128–32768）</label>' +
            '<input type="number" id="sandboxMemInput" value="' + st.mem_mb + '" min="128" max="32768" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);"></div>' +
            '<div style="font-size:11px;color:var(--text2);margin:8px 0;">注意：环境变量 ZF_SANDBOX 存在时优先于本配置；修改需重启进程生效。Job 围栏不隔离文件与网络；main_brain 沙箱执行异常会报错而非降级直跑。</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<button class="btn" id="sandboxSaveBtn" style="font-size:12px;padding:6px 16px;">保存配置</button>' +
            '<span id="sandboxSaveMsg" style="font-size:12px;color:var(--text2);"></span></div>';

        box.querySelector('#sandboxModeSel').value = st.mode;
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
