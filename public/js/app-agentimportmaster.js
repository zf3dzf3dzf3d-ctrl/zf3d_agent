// 🛰️ 万能智能体数据导入大师：外部 Agent（zcode/codex/claude…）本地会话库只读导入
// 纪律：copy-then-read 三件套齐拷、一源一库、四元指纹去重、敏感文件永不入库
(function () {
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function post(url, body) {
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); });
    }

    App.agentImportMaster = function () {
        // 弹窗骨架（与密码大师同风格）
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;';
        var box = document.createElement('div');
        box.style.cssText = 'background:#1b2230;color:#dfe6f2;border-radius:12px;padding:18px;width:min(680px,92vw);max-height:82vh;overflow:auto;font-size:13px;line-height:1.6;box-shadow:0 8px 40px rgba(0,0,0,.5);';
        ov.appendChild(box); document.body.appendChild(ov);
        function html(h) { box.innerHTML = h; }
        function bind(sel, fn) { var el = box.querySelector(sel); if (el) el.onclick = fn; }
        function close() { ov.remove(); }

        // 第 1 步：候选探测
        function stepCandidates() {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🛰️ 万能导入大师 · 探测本机 Agent 数据源…</div>');
            post('/api/agent/import/candidates').then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">探测失败：' + esc(res.err || '') + '</div>'); return; }
                var rows = res.candidates.map(function (c, i) {
                    var badge = c.ready ? '<span style="color:#2ecc71;">✔ 可导入</span>' : '<span style="color:#8b95a7;">⛔ 不可用' + esc(c.err ? '（' + c.err + '）' : '') + '</span>';
                    return '<label style="display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid #3a4356;border-radius:8px;margin-bottom:6px;cursor:' + (c.ready ? 'pointer' : 'not-allowed') + ';opacity:' + (c.ready ? 1 : .55) + ';">'
                        + '<input type="radio" name="ai-agent" value="' + esc(c.agent) + '"' + (c.ready ? '' : ' disabled') + ' style="cursor:pointer;">'
                        + '<div style="flex:1;"><b>' + c.icon + ' ' + esc(c.label) + '</b> ' + badge + '<br>'
                        + '<span style="color:#8b95a7;font-size:12px;">' + esc(c.path || c.err || '') + (c.size_mb ? ' · ' + c.size_mb + ' MB' : '') + '</span></div></label>';
                }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:4px;">🛰️ 万能导入大师 · 选择数据源</div>'
                    + '<div style="color:#8b95a7;margin-bottom:10px;">机器 ' + esc(res.machine) + ' · 用户 ' + esc(res.user) + ' · 纪律：只读拷贝三件套后抽取，永不改动源库；一源一库隔离；四元指纹去重；敏感文件永不入库</div>'
                    + rows
                    + '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">'
                    + '<button id="ai-close" style="padding:6px 14px;cursor:pointer;">关闭</button>'
                    + '<button id="ai-scan" style="padding:6px 14px;cursor:pointer;background:#2d6cdf;border:none;color:#fff;border-radius:6px;">下一步：预览</button></div>');
                bind('#ai-close', close);
                bind('#ai-scan', function () {
                    var r = box.querySelector('input[name=ai-agent]:checked');
                    if (r) stepScan(r.value);
                });
            });
        }

        // 第 2 步：scan 预览
        function stepScan(agent) {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🛰️ 万能导入大师 · 预览会话清单…</div>');
            post('/api/agent/import/scan', { agent: agent }).then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">预览失败：' + esc(res.err || '') + '</div><button onclick="this.closest(\'div\').parentNode" id="ai-back" style="margin-top:8px;padding:6px 14px;cursor:pointer;">返回</button>'); bind('#ai-back', stepCandidates); return; }
                var rows = res.sessions.slice(0, 200).map(function (s) {
                    return '<div style="padding:4px 8px;border-bottom:1px solid #2a3242;display:flex;gap:8px;"><span style="color:#8b95a7;min-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc((s.project_path || '').split('\\').pop()) + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(s.title) + '</span><span style="color:#8b95a7;">' + s.msg_count + '条</span></div>';
                }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:4px;">🛰️ 万能导入大师 · 共 ' + res.total + ' 个会话（预览前200）</div>'
                    + '<div style="color:#8b95a7;margin-bottom:8px;">指纹前缀：' + esc(res.fingerprint_prefix) + '|… · 拷贝文件：' + esc((res.copied || []).join(', ')) + '</div>'
                    + '<div style="max-height:340px;overflow:auto;border:1px solid #3a4356;border-radius:8px;margin-bottom:12px;">' + rows + '</div>'
                    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
                    + '<button id="ai-back" style="padding:6px 14px;cursor:pointer;">返回</button>'
                    + '<button id="ai-run" style="padding:6px 14px;cursor:pointer;background:#27ae60;border:none;color:#fff;border-radius:6px;">导入到朱峰库</button></div>');
                bind('#ai-back', stepCandidates);
                bind('#ai-run', function () { stepRun(agent); });
            });
        }

        // 第 3 步：执行导入
        function stepRun(agent) {
            html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">🛰️ 万能导入大师 · 正在导入…<br><span style="color:#8b95a7;font-size:12px;">增量导入：已存在的会话只刷新统计，不会重复插入</span></div>');
            post('/api/agent/import/run', { agent: agent }).then(function (res) {
                if (!res.ok) { html('<div style="color:#e74c3c;">导入失败：' + esc(res.err || '') + '</div>'); return; }
                var dbs = (res.dbs || [])[0] || {};
                var projects = (dbs.projects || []).map(function (p) { return '<div style="padding:2px 0;">📁 ' + esc(p) + '</div>'; }).join('');
                html('<div style="font-size:15px;font-weight:bold;margin-bottom:10px;">✅ 导入完成</div>'
                    + '<div>新增会话 <b>' + res.new_sessions + '</b> · 新增正文消息 <b>' + res.new_messages + '</b> · 已存在刷新 <b>' + res.updated_existing + '</b></div>'
                    + '<div style="margin-top:8px;">库文件：<code style="color:#8b95a7;">' + esc(dbs.path || res.dir) + '</code></div>'
                    + '<div style="margin-top:10px;color:#8b95a7;">项目归属（四元指纹隔离，不会与其他机器/用户/Agent 混淆）：</div>'
                    + '<div style="max-height:200px;overflow:auto;border:1px solid #3a4356;border-radius:8px;padding:6px 10px;margin-top:4px;">' + (projects || '（无）') + '</div>'
                    + '<div style="margin-top:12px;text-align:right;"><button id="ai-close" style="padding:6px 14px;cursor:pointer;">完成</button></div>');
                bind('#ai-close', close);
            });
        }

        stepCandidates();
    };
})();
