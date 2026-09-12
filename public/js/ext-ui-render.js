// ============================================================
// ext-ui-render.js — 声明式 UI 前端渲染器（extensions 阶段2，独立文件）
// 协议见 extensions/declarative_ui.py 顶层注释 / GET /api/ext/declarative_ui/schema
// 工作方式：包装 Tools.renderToolCard —— 工具结果含 result.ui 时在卡片下追加渲染面板。
// 主流程零改动：删除本文件即完全下线。
// 全局命名空间：window.ExtUI
// ============================================================
(function () {
    'use strict';
    var ExtUI = window.ExtUI = {};

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---------- 样式（注入一次，全部带 ext-ui- 前缀防冲突） ----------
    ExtUI.injectStyles = function () {
        if (document.getElementById('ext-ui-style')) return;
        var st = document.createElement('style');
        st.id = 'ext-ui-style';
        st.textContent = [
            '.ext-ui{margin:8px 0;padding:10px 12px;border:1px solid var(--border-color,#ddd);border-radius:10px;background:var(--panel-bg,#fafafa);font-size:13px;}',
            '.ext-ui__title{font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;}',
            '.ext-ui__badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--accent-soft,#e8f0fe);color:var(--accent,#3b7cff);}',
            '.ext-ui-field{margin:6px 0;display:flex;flex-direction:column;gap:3px;}',
            '.ext-ui-field label{font-size:12px;color:var(--text-2,#666);}',
            '.ext-ui-field input,.ext-ui-field select,.ext-ui-field textarea{padding:5px 8px;border:1px solid var(--border-color,#ccc);border-radius:6px;font-size:13px;background:var(--input-bg,#fff);color:var(--text-1,#222);}',
            '.ext-ui-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}',
            '.ext-ui-btn{padding:5px 14px;border-radius:7px;border:1px solid var(--border-color,#ccc);background:var(--btn-bg,#fff);color:var(--text-1,#222);cursor:pointer;font-size:12px;}',
            '.ext-ui-btn--primary{background:var(--accent,#3b7cff);border-color:var(--accent,#3b7cff);color:#fff;}',
            '.ext-ui-btn--danger{background:var(--danger,#e5484d);border-color:var(--danger,#e5484d);color:#fff;}',
            '.ext-ui-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;}',
            '.ext-ui-card{border:1px solid var(--border-color,#ddd);border-radius:9px;padding:9px;background:var(--card-bg,#fff);}',
            '.ext-ui-card img{max-width:100%;border-radius:6px;}',
            '.ext-ui-card h4{margin:0 0 4px;font-size:13px;}',
            '.ext-ui-card .sub{font-size:11px;color:var(--text-3,#999);margin-bottom:4px;}',
            '.ext-ui-card .body{font-size:12px;color:var(--text-2,#555);white-space:pre-wrap;}',
            '.ext-ui table{border-collapse:collapse;width:100%;font-size:12px;}',
            '.ext-ui th,.ext-ui td{border:1px solid var(--border-color,#ddd);padding:4px 8px;text-align:left;}',
            '.ext-ui th{background:var(--panel-bg,#f2f2f2);}',
            '.ext-ui-md{white-space:pre-wrap;font-size:13px;line-height:1.55;}',
            '.ext-ui-confirm{padding:6px 0;font-size:13px;}',
            '.ext-ui-form-actions{display:flex;gap:8px;margin-top:8px;}'
        ].join('');
        document.head.appendChild(st);
    };

    // ---------- 各类型渲染（返回 HTML 字符串） ----------
    function renderFields(fields) {
        return (fields || []).map(function (f) {
            var common = ' data-fname="' + esc(f.name) + '"';
            var inner;
            if (f.type === 'select' || f.type === 'radio') {
                inner = f.type === 'select'
                    ? '<select' + common + '>' + (f.options || []).map(function (o) {
                        var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
                        return '<option value="' + esc(v) + '"' + (String(f.default) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
                    }).join('') + '</select>'
                    : (f.options || []).map(function (o) {
                        var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
                        return '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><input type="radio"' + common + ' name="extui_' + esc(f.name) + '" value="' + esc(v) + '"' + (String(f.default) === String(v) ? ' checked' : '') + '>' + esc(l) + '</label>';
                    }).join('');
            } else if (f.type === 'checkbox') {
                inner = (f.options || []).map(function (o) {
                    var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
                    return '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><input type="checkbox"' + common + ' value="' + esc(v) + '"' + ((f.default || []).indexOf(v) >= 0 ? ' checked' : '') + '>' + esc(l) + '</label>';
                }).join('');
            } else if (f.type === 'textarea') {
                inner = '<textarea' + common + ' rows="3" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.default || '') + '</textarea>';
            } else {
                inner = '<input type="' + (f.type === 'number' ? 'number' : 'text') + '"' + common + ' placeholder="' + esc(f.placeholder || '') + '" value="' + esc(f.default != null ? f.default : '') + '">';
            }
            return '<div class="ext-ui-field"><label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>' + inner + '</div>';
        }).join('');
    }

    function renderActions(actions) {
        return '<div class="ext-ui-actions">' + (actions || []).map(function (a, i) {
            return '<button class="ext-ui-btn' + (a.style === 'primary' ? ' ext-ui-btn--primary' : a.style === 'danger' ? ' ext-ui-btn--danger' : '') +
                '" data-ext-action="' + esc(JSON.stringify(a)) + '">' + esc(a.label || '按钮' + (i + 1)) + '</button>';
        }).join('') + '</div>';
    }

    function renderBody(ui) {
        switch (ui.type) {
            case 'form':
                return '<form class="ext-ui-form" onsubmit="return false;">' + renderFields((ui.form || {}).fields) +
                    '<div class="ext-ui-form-actions">' + renderActions((ui.form || {}).actions || ui.actions).slice(26) + '</div></form>';
            case 'cards':
                return '<div class="ext-ui-cards">' + (ui.cards || []).map(function (c) {
                    return '<div class="ext-ui-card">' + (c.image ? '<img src="' + esc(c.image) + '" alt="">' : '') +
                        (c.title ? '<h4>' + esc(c.title) + '</h4>' : '') +
                        (c.subtitle ? '<div class="sub">' + esc(c.subtitle) + '</div>' : '') +
                        (c.body ? '<div class="body">' + esc(c.body) + '</div>' : '') + '</div>';
                }).join('') + '</div>' + renderActions(ui.actions);
            case 'table':
                return '<table><thead><tr>' + (ui.table.columns || []).map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    (ui.table.rows || []).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' + renderActions(ui.actions);
            case 'markdown':
                return '<div class="ext-ui-md">' + esc(ui.markdown) + '</div>' + renderActions(ui.actions);
            case 'confirm':
                return '<div class="ext-ui-confirm">' + esc((ui.confirm || {}).message) + '</div>' + renderActions((ui.confirm || {}).actions || ui.actions);
        }
        return '';
    }

    // ---------- 渲染入口：result.ui → DOM 元素 ----------
    ExtUI.render = function (ui, toolName) {
        ExtUI.injectStyles();
        var wrap = document.createElement('div');
        wrap.className = 'ext-ui';
        wrap.dataset.extUi = '1';
        wrap.dataset.extTool = toolName || '';
        wrap.innerHTML =
            '<div class="ext-ui__title">🧩 ' + esc(ui.title || '交互面板') +
            '<span class="ext-ui__badge">' + esc(ui.type) + '</span></div>' + renderBody(ui);
        return wrap;
    };

    // ---------- 动作事件（事件委托，绑定一次）：按钮 → 执行工具/调用接口 ----------
    function collectFormValues(container) {
        var out = {};
        container.querySelectorAll('.ext-ui-field [data-fname]').forEach(function (el) {
            var n = el.dataset.fname;
            if (el.type === 'checkbox') {
                if (el.checked) { (out[n] = out[n] || []).push(el.value); }
            } else if (el.type === 'radio') {
                if (el.checked) out[n] = el.value;
            } else {
                out[n] = el.value;
            }
        });
        return out;
    }

    document.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-ext-action]');
        if (!btn) return;
        var panel = btn.closest('.ext-ui');
        var action;
        try { action = JSON.parse(btn.dataset.extAction); } catch (e) { return; }
        var args = Object.assign({}, action.arguments || {});
        if (panel) {
            var vals = collectFormValues(panel);
            for (var k in vals) {
                if (!(k in args)) args[k] = vals[k];   // 显式 arguments 优先，表单值兜底
            }
        }
        if (action.url) { window.open(action.url, '_blank'); return; }
        var tool = action.tool || (panel ? panel.dataset.extTool : '');
        if (!tool) return;
        // 优先走本页 Agent 工具执行器（同步/异步均可），否则回落 /api/ext/mcp/call
        if (typeof Tools !== 'undefined' && Tools.execute) {
            Promise.resolve(Tools.execute(tool, args, {})).then(function () { /* 结果由正常工具卡片流程展示 */ })
                .catch(function (e) { console.error('[ExtUI]', e); });
        } else if (tool.indexOf('mcp_') === 0) {
            fetch('/api/ext/mcp/call', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: tool, arguments: args })
            });
        }
    });

    // ---------- 挂钩 Tools.renderToolCard：结果含 ui 时在卡片 HTML 后直接追加渲染面板 ----------
    // 事件全部走 document 委托，无需额外绑定；addToolCard 用 innerHTML 插入可正常解析。
    ExtUI.install = function () {
        if (typeof Tools === 'undefined' || !Tools.renderToolCard || Tools._extUiHooked) return;
        Tools._extUiHooked = true;
        var orig = Tools.renderToolCard;
        Tools.renderToolCard = function (name, args, result) {
            var html = orig.call(this, name, args, result);
            try {
                if (result && result.ui && typeof result.ui === 'object') {
                    html += ExtUI.render(result.ui, name).outerHTML;
                }
            } catch (e) { console.error('[ExtUI] render failed:', e); }
            return html;
        };
    };

    // 自动安装（Tools 加载晚于本文件时等 DOM ready 重试）
    function boot() {
        if (typeof Tools !== 'undefined' && Tools.renderToolCard) { ExtUI.install(); }
        else { setTimeout(boot, 300); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    // ===========================================================
    // 技能 UI 面板：根据输入框文字匹配技能，展示技能自带 ui 面板
    // ===========================================================
    ExtUI.mountSkillPanel = function (container) {
        ExtUI.injectStyles();
        var host = document.createElement('div');
        host.className = 'ext-ui-skillpanel';
        host.style.cssText = 'padding:4px 10px;font-size:12px;';
        var cur = '';
        function tryMatch(text) {
            text = (text || '').trim();
            if (!text || text === cur) return;
            cur = text;
            fetch('/api/ext/skills/ui?text=' + encodeURIComponent(text))
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d || !d.ok || !d.panels || !d.panels.length) { host.innerHTML = ''; return; }
                    host.innerHTML = d.panels.map(function (p) {
                        var el = ExtUI.render(p.ui, '');
                        el.dataset.extPanel = 'skill';
                        el.dataset.skillId = p.id || '';
                        return '<div class="ext-ui-skillpanel__head" style="opacity:.7;margin:2px 0;">🧩 技能面板：' +
                            esc(p.name) + '</div>' + el.outerHTML;
                    }).join('');
                }).catch(function () { });
        }
        // 挂到输入框：监听输入 + 每 1.5s 兜底轮询（兼容值被程序填充）
        var input = document.getElementById('chat-input') ||
                    document.querySelector('textarea, input[type=text]');
        if (input) {
            input.addEventListener('input', function () { tryMatch(input.value); });
            setInterval(function () { tryMatch(input.value); }, 1500);
        }
        (container || document.body).appendChild(host);
        return host;
    };
    ExtUI._skillPanelMounted = false;
    ExtUI.ensureSkillPanel = function () {
        if (ExtUI._skillPanelMounted) return;
        var chatArea = document.getElementById('chat-container') ||
                       document.getElementById('chat') || document.body;
        ExtUI._skillPanelMounted = true;
        ExtUI.mountSkillPanel(chatArea);
    };
    setTimeout(function () { try { ExtUI.ensureSkillPanel(); } catch (e) { } }, 1200);
})();
