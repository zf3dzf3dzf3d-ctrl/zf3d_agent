// ============================================================
// ext-external-panel.js — 设置面板「🔗 外部线路」独立页（v1.0）
// （独立文件，删除即下线；主设置面板零污染，DOM 动态注入）
// 功能：外部线路（cli2api 网关）启用开关、网关地址/API Key 配置、
//       双层测试（网关活着 / 通道可用）、模型列表、启停网关
// 入口：panel-settings.js switchSettingsTab('ext-external') → ExternalPanel.init()
// 后端：/api/external/{config,health,models,test,start,stop}（server/external_router.py）
// ============================================================
(function () {
    'use strict';
    var P = window.ExternalPanel = { _inited: false };

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---------- 配置 ----------
    P.loadConfig = function () {
        return fetch('/api/external/config').then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) P.config = d.config || {};
            return P.config || {};
        }).catch(function () { return {}; });
    };

    P.saveConfig = function (patch) {
        return fetch('/api/external/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) P.config = d.config;
            return d;
        });
    };

    P.toggleEnabled = function (checked) {
        P.saveConfig({ enabled: checked }).then(function (d) {
            P._fillForm(d && d.config);
            _dlgAlert(checked ? '✅ 外部线路已开启。模型下拉将出现 🔗 分组。' : '外部线路已关闭。');
        });
    };

    P.saveForm = function () {
        var body = {
            enabled: document.getElementById('extl-enabled').checked,
            gateway: {
                url: document.getElementById('extl-url').value.trim() || 'http://127.0.0.1:3010',
                apiKey: document.getElementById('extl-key').value.trim(),
                binPath: document.getElementById('extl-bin').value.trim(),
                port: parseInt(document.getElementById('extl-port').value, 10) || 3010
            }
        };
        P.saveConfig(body).then(function (d) {
            _dlgAlert(d && d.ok ? '✅ 已保存（API Key 不回显）' : '❌ 保存失败');
        });
    };

    P._fillForm = function (cfg) {
        cfg = cfg || P.config || {};
        var gw = cfg.gateway || {};
        var en = document.getElementById('extl-enabled');
        if (en) en.checked = !!cfg.enabled;
        var u = document.getElementById('extl-url'); if (u) u.value = gw.url || '';
        var b = document.getElementById('extl-bin'); if (b) b.value = gw.binPath || '';
        var pt = document.getElementById('extl-port'); if (pt) pt.value = gw.port || 3010;
        // apiKey 服务端掩码（sk-***abcd），保留掩码原样，用户改了才提交新值
        var k = document.getElementById('extl-key'); if (k) k.value = gw.apiKey || '';
        P._renderStatus('—', '待检测');
    };

    // ---------- 状态与双层测试 ----------
    function _statusCard() { return document.getElementById('extl-status'); }
    P._renderStatus = function (icon, text) {
        var box = _statusCard(); if (box) box.innerHTML = icon + ' ' + text;
    };

    P.testGateway = function () {
        // 第一层：网关进程活着（/health）
        P._renderStatus('⏳', '正在探测网关…');
        fetch('/api/external/health').then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok && d.alive) {
                P._renderStatus('🟢', '网关活着（' + esc(d.url || '') + '）。再点「通道可用」测真实对话。');
            } else {
                P._renderStatus('🔴', '网关不活：' + esc((d && d.error) || '未启动。先点「启动网关」。'));
            }
        }).catch(function () { P._renderStatus('🔴', '探测失败'); });
    };

    P.testChannel = function () {
        // 第二层：真实对话通不通
        P._renderStatus('⏳', '正在测试通道（真实对话）…');
        fetch('/api/external/test').then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok && d.channelOk) {
                P._renderStatus('🟢', '✅ 通道可用！模型: ' + esc(d.model || '') + ' 回复: ' + esc(String(d.reply || '').slice(0, 60)));
            } else {
                P._renderStatus('🔴', '❌ 通道不可用: ' + esc((d && d.error) || '未知错误'));
            }
        }).catch(function () { P._renderStatus('🔴', '测试失败'); });
    };

    P.loadModels = function () {
        var box = document.getElementById('extl-models');
        if (!box) return;
        box.textContent = '加载中…';
        fetch('/api/external/models').then(function (r) { return r.json(); }).then(function (d) {
            var ids = (d && d.models) || [];
            if (!ids.length) { box.textContent = '未获取到模型（网关未启动或未登录通道）'; return; }
            box.innerHTML = ids.map(function (m) { return '<span style="display:inline-block;margin:2px;padding:2px 8px;border:1px solid var(--border);border-radius:10px;font-size:11px;">🔗 ' + esc(m) + '</span>'; }).join('');
        }).catch(function () { box.textContent = '加载失败'; });
    };

    P.startGateway = function () {
        P._renderStatus('⏳', '正在拉起网关…');
        fetch('/api/external/start').then(function (r) { return r.json(); }).then(function (d) {
            _dlgAlert((d && d.ok ? '✅ ' : '❌ ') + (d && d.message || ''));
            P.testGateway();
        });
    };
    P.stopGateway = function () {
        fetch('/api/external/stop').then(function (r) { return r.json(); }).then(function (d) {
            _dlgAlert((d && d.ok ? '🛑 ' : '❌ ') + (d && d.message || ''));
            P.testGateway();
        });
    };

    // ---------- 构建（仿 ExtSettingsPanel 自注入） ----------
    P.build = function () {
        var nav = document.querySelector('.settings-nav');
        if (nav && !nav.querySelector('[data-settings-tab="ext-external"]')) {
            var item = document.createElement('div');
            item.className = 'settings-nav-item';
            item.setAttribute('data-settings-tab', 'ext-external');
            item.innerHTML = '<span class="settings-nav-icon">🔗</span><span>外部线路</span>';
            item.onclick = function () { App.switchSettingsTab('ext-external'); };
            var anchor = nav.querySelector('[data-settings-tab="ext-skills"]') || nav.querySelector('[data-settings-tab="ext-mcp"]');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(item, anchor.nextSibling);
            else nav.appendChild(item);
        }
        var content = document.querySelector('.settings-content');
        if (content && !document.getElementById('settingsPanel-ext-external')) {
            var panel = document.createElement('div');
            panel.className = 'settings-panel';
            panel.id = 'settingsPanel-ext-external';
            panel.innerHTML =
                '<h3 style="margin:0 0 8px 0;">🔗 外部线路（WorkBuddy 白嫖通道）</h3>'
                + '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;">通过 cli2api 网关借用本机 AI 客户端（WorkBuddy / Qoder / Trae 等）的登录线路，变为 OpenAI 兼容模型。与朱峰线路、自定义 API <b>三区完全隔离</b>：独立配置、独立路由、失败直报不降级，默认关闭。</div>'
                + '<div id="extl-status" style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;font-size:12px;background:var(--bg);">— 待检测</div>'
                + '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;background:var(--bg);">'
                + '  <div><div style="font-weight:600;font-size:13px;">🔌 启用外部线路</div><div style="font-size:11px;color:var(--text2);margin-top:2px;">关闭时模型列表零外部模型，行为与未安装此功能完全一致。</div></div>'
                + '  <label style="cursor:pointer;display:flex;align-items:center;gap:8px;flex-shrink:0;"><input type="checkbox" id="extl-enabled" onchange="ExternalPanel.toggleEnabled(this.checked)" style="width:18px;height:18px;cursor:pointer;"></label>'
                + '</div>'
                + '<div class="field"><label>网关地址</label><input type="text" id="extl-url" placeholder="http://127.0.0.1:3010" autocomplete="off"></div>'
                + '<div class="field"><label>API Key（可选，网关无鉴权则留空；保存后显示掩码）</label><input type="password" id="extl-key" placeholder="sk-..." autocomplete="new-password"></div>'
                + '<div class="field"><label>cli2api 可执行文件路径（用于自动拉起，可留空）</label><input type="text" id="extl-bin" placeholder="tools\\external-gateway\\cli2api.exe" autocomplete="off"></div>'
                + '<div class="field"><label>端口</label><input type="number" id="extl-port" value="3010"></div>'
                + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">'
                + '  <button class="btn" onclick="ExternalPanel.saveForm()">保存配置</button>'
                + '  <button class="btn ghost" onclick="ExternalPanel.startGateway()">▶ 启动网关</button>'
                + '  <button class="btn ghost" onclick="ExternalPanel.stopGateway()">⏹ 停止网关</button>'
                + '</div>'
                + '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">测试分两层：<b>网关活着</b>（进程健康）≠ <b>通道可用</b>（真实对话成功）。</div>'
                + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'
                + '  <button class="btn ghost" onclick="ExternalPanel.testGateway()">🩺 网关活着？</button>'
                + '  <button class="btn ghost" onclick="ExternalPanel.testChannel()">💬 通道可用？</button>'
                + '  <button class="btn ghost" onclick="ExternalPanel.loadModels()">🧾 刷新模型列表</button>'
                + '</div>'
                + '<h4 style="margin:12px 0 6px;">模型列表</h4><div id="extl-models" style="font-size:12px;color:var(--text2);"></div>'
                + '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);line-height:1.7;">'
                + '⚠️ 免责：外部线路为社区第三方逆向方案，可能随时失效或违反客户端服务条款；建议使用小号，勿在主力账号启用。删除本文件 js/ext-external-panel.js 即彻底下线、零残留。'
                + '</div>';
            content.appendChild(panel);
        }
    };

    // ---------- 激活（switchSettingsTab('ext-external') 调用） ----------
    P.init = function () {
        P.build();
        P.loadConfig().then(function () {
            P._fillForm();
            P.testGateway();
            P.loadModels();
        });
        P._inited = true;
    };

    // ---------- 【修复】自启动保障 ----------
    // 原先 build()（注入左侧「🔗 外部线路」导航项 + 面板 DOM）只在 init() 里调用，
    // 而 init() 只有点击导航项才会触发 → 导航项不存在就永远无法触发（死锁），
    // 表现为"功能做过但界面看不到"。这里页面加载后自动 build 一次（幂等），
    // 并轮询兜底：settings-nav 若被其他模块重建导致导航项丢失，自动补回。
    function ensureBuilt() {
        try { P.build(); } catch (e) {}
    }
    function boot() {
        setTimeout(ensureBuilt, 300);
        setInterval(ensureBuilt, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
