// ========== mode_panel_loader.js - 对话模式插件加载器（前端） ==========
// 规范见 modes/README.md
// 职责：
// 1. 启动时 fetch /api/modes 拉取已启用插件模式
// 2. 把插件模式追加到模式选择 UI（DB._loopMode 可为插件 id）
// 3. 切到插件模式时按 manifest.entry.panel 动态加载面板脚本（去重）
// 4. 提供 ModePlugins.getPanelApi() 给面板脚本对接

var ModePlugins = {
    modes: [],               // [{id,name,icon,description,version}]
    _loadedPanels: {},       // {panel_path: true}

    // ===== 初始化：拉取插件列表 =====
    init: function() {
        var self = this;
        return fetch('/api/modes', { method: 'GET', cache: 'no-store' })
            .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('http ' + res.status)); })
            .then(function(data) {
                self.modes = (data && data.ok && Array.isArray(data.modes)) ? data.modes : [];
                self.renderModeOptions();
                return self.modes;
            })
            .catch(function(err) {
                console.warn('[ModePlugins] load /api/modes failed:', err);
                self.modes = [];
                return [];
            });
    },

    // ===== 把插件模式追加到模式选择 UI =====
    // 兼容两种 UI：select 下拉（#loopModeSelect 等）与自定义按钮组（[data-loop-mode]）
    renderModeOptions: function() {
        if (!this.modes.length) return;
        var self = this;
        // 下拉框
        var selects = document.querySelectorAll('select[data-mode-plugin-container], #loopModeSelect, #chatModeSelect');
        selects.forEach(function(sel) {
            // 防止重复追加
            if (sel.querySelector('option[data-plugin-mode]')) return;
            self.modes.forEach(function(m) {
                var opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = (m.icon ? m.icon + ' ' : '') + m.name;
                opt.setAttribute('data-plugin-mode', m.id);
                if (m.description) opt.title = m.description;
                sel.appendChild(opt);
            });
        });
        // 按钮组
        var groups = document.querySelectorAll('[data-mode-plugin-buttons]');
        groups.forEach(function(g) {
            if (g.querySelector('[data-plugin-mode]')) return;
            self.modes.forEach(function(m) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mode-plugin-btn';
                btn.setAttribute('data-loop-mode', m.id);
                btn.setAttribute('data-plugin-mode', m.id);
                btn.textContent = (m.icon ? m.icon + ' ' : '') + m.name;
                if (m.description) btn.title = m.description;
                g.appendChild(btn);
            });
        });
        // 设置-模型配置面板里的「对话模式」选择区（按需求已移除，不再注入）
        // this.renderSettingsSection();
    },

    // ===== 设置面板内的对话模式选择区 =====
    _settingsSection: null,
    renderSettingsSection: function() {
        var self = this;
        var mount = document.getElementById('modelPanelMount');
        if (!mount) return;
        var wrap = mount.querySelector('[data-mode-picker]');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.setAttribute('data-mode-picker', '');
            wrap.style.cssText = 'margin:0 0 12px 0;padding:10px 12px;border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:8px;background:var(--bg2,rgba(255,255,255,0.04));';
            var label = document.createElement('div');
            label.style.cssText = 'font-size:12px;font-weight:600;color:var(--text2,#667);margin-bottom:8px;';
            label.textContent = '对话模式（当前选中即新对话默认）';
            var btns = document.createElement('div');
            btns.setAttribute('data-mode-plugin-buttons', '');
            btns.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
            wrap.appendChild(label);
            wrap.appendChild(btns);
            var cur = document.createElement('div');
            cur.setAttribute('data-mode-picker-cur', '');
            cur.style.cssText = 'font-size:11px;color:var(--text2,#8b949e);margin-top:8px;';
            wrap.appendChild(cur);
            mount.insertBefore(wrap, mount.firstChild);
        }
        var btnWrap = wrap.querySelector('[data-mode-plugin-buttons]');
        if (!btnWrap || btnWrap.querySelector('[data-mode-picker-default]')) return;

        // 内置三模式按钮（当前选中哪个，哪个就是新对话默认，无需独立"默认"项）
        var DEFAULTS = [
            { id: '1', icon: '💬', name: '直接聊天', desc: '单轮直接回复，不走工具循环' },
            { id: '2', icon: '🔧', name: '工具循环', desc: '可调用工具的多轮循环' },
            { id: '3', icon: '🤖', name: '自主循环', desc: '模型自主规划的多步循环' }
        ];
        DEFAULTS.forEach(function(d) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'mode-plugin-btn';
            b.setAttribute('data-loop-mode', d.id);
            b.setAttribute('data-mode-picker-default', d.id);
            b.textContent = d.icon + ' ' + d.name;
            b.title = d.desc;
            btnWrap.appendChild(b);
        });
        // 插件模式按钮（本函数会在 init 后调用一次；插件晚到时由 renderModeOptions 再次进入）
        this.modes.forEach(function(m) {
            if (btnWrap.querySelector('[data-plugin-mode="' + m.id + '"]')) return;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'mode-plugin-btn';
            b.setAttribute('data-loop-mode', m.id);
            b.setAttribute('data-plugin-mode', m.id);
            b.textContent = (m.icon ? m.icon + ' ' : '') + m.name;
            if (m.description) b.title = m.description;
            btnWrap.appendChild(b);
        });
        if (this._settingsSection) return; // 事件只绑一次
        this._settingsSection = wrap;

        // 点击切换：统一走 DB.setLoopMode（插件模式 id 直接透传，循环后端按插件注入提示词）
        btnWrap.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-loop-mode]');
            if (!btn) return;
            var mode = btn.getAttribute('data-loop-mode');
            if (typeof DB !== 'undefined' && DB.setLoopMode) DB.setLoopMode(mode);
            self._refreshSettingsSelection();
            self._toggleModePanel(mode, mount);
            // 切到插件模式时预加载其面板脚本
            if (self.isPluginMode(mode)) self.loadPanel(mode).catch(function() {});
        });
        // 面板随当前模式恢复（页面刷新后 _settingsSection 重建时）
        if (typeof DB !== 'undefined' && DB._loopMode) self._toggleModePanel(DB._loopMode, mount);
        this._refreshSettingsSelection();
        // 30s 轮询刷新选中态（与 DB._loadLoopModeFromConfig 节奏一致）
        if (!this._settingsTimer) {
            this._settingsTimer = setInterval(function() { self._refreshSettingsSelection(); }, 30000);
        }
    },

    // ===== 插件模式面板：切到插件模式时挂载容器并 init，切回内置模式时移除 =====
    _toggleModePanel: function(modeId, mount) {
        if (!mount) return;
        var host = mount.querySelector('[data-mode-panel-host]');
        var isPlugin = this.isPluginMode(modeId);
        if (!isPlugin) {
            if (host) host.remove();
            return;
        }
        if (!host) {
            host = document.createElement('div');
            host.setAttribute('data-mode-panel-host', '');
            host.style.cssText = 'margin:12px 0 0 0;min-height:340px;max-height:520px;display:flex;flex-direction:column;' +
                'border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:8px;overflow:hidden;';
            mount.appendChild(host);
        }
        var m = this.getMode(modeId);
        var panel = window.ModePlugins.getPanel ? window.ModePlugins.getPanel(modeId) : null;
        if (panel && typeof panel.init === 'function') {
            panel.init(host);
        } else if (m && m.panel) {
            // 面板脚本还没加载完：等 loadPanel 完成后再 init
            var self = this;
            this.loadPanel(modeId).then(function() {
                var p = self.getPanel(modeId);
                if (p && typeof p.init === 'function') p.init(host);
            }).catch(function() {
                host.innerHTML = '<div style="padding:14px;color:var(--text2,#8b949e);font-size:12px;">⚠️ 面板脚本加载失败：' +
                    (m.panel || '') + '</div>';
            });
        }
    },

    _refreshSettingsSelection: function() {
        var wrap = this._settingsSection;
        if (!wrap) return;
        var cur = (typeof DB !== 'undefined' && DB._loopMode) ? String(DB._loopMode) : '1';
        wrap.querySelectorAll('[data-loop-mode]').forEach(function(b) {
            var on = b.getAttribute('data-loop-mode') === cur;
            b.style.background = on ? '#0078d4' : '';
            b.style.color = on ? '#fff' : '';
            b.style.borderColor = on ? '#0078d4' : '';
        });
        var curEl = wrap.querySelector('[data-mode-picker-cur]');
        if (curEl) {
            var btn = wrap.querySelector('[data-loop-mode="' + cur + '"]');
            curEl.textContent = '当前：' + (btn ? btn.textContent : cur);
        }
    },

    // ===== 是否插件模式 =====
    isPluginMode: function(modeId) {
        return this.modes.some(function(m) { return m.id === String(modeId); });
    },

    // ===== 取插件信息 =====
    getMode: function(modeId) {
        var id = String(modeId);
        for (var i = 0; i < this.modes.length; i++) {
            if (this.modes[i].id === id) return this.modes[i];
        }
        return null;
    },

    // ===== 动态加载插件面板脚本（entry.panel），去重 =====
    loadPanel: function(modeId) {
        var m = this.getMode(modeId);
        if (!m) return Promise.resolve(null);
        var panelPath = m.panel || m.entry && m.entry.panel;
        if (!panelPath) return Promise.resolve(null);
        var url = '/modes/' + m.id + '/' + panelPath;
        if (this._loadedPanels[url]) return Promise.resolve(url);
        return new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = url;
            s.onload = function() { resolve(url); };
            s.onerror = function() { reject(new Error('panel load failed: ' + url)); };
            document.head.appendChild(s);
        }).then(function(u) {
            this._loadedPanels[u] = true;
            return u;
        }.bind(this));
    }
};

// 面板脚本对接 API：插件面板通过 window.ModePlugins.registerPanel(id, api) 注册
ModePlugins._panels = {};
ModePlugins.registerPanel = function(id, api) { this._panels[id] = api; };
ModePlugins.getPanel = function(id) { return this._panels[id] || null; };

window.ModePlugins = ModePlugins;
// DOMContentLoaded 在此脚本（页面底部）执行前可能已触发，两种情况都要兜住
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { ModePlugins.init(); });
} else {
    ModePlugins.init();
}
// 设置面板是打开时才渲染/重渲染 #modelPanelMount，打开后补一次对话模式选择区
setInterval(function() {
    if (document.getElementById('modelPanelMount')) ModePlugins.renderModeOptions();
}, 1000);
