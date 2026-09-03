// ========== panel-settings.js - 设置面板与 Tab 切换 ==========
// 拆分自 app-panels.js（原 1~103 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 设置面板 =====
        setupSettings: function() {
            var self = this;
            document.getElementById('email-enabled') && document.getElementById('email-enabled').addEventListener('change', function() { App._updateEmailToggle(); });
            // 健康守护模式事件
            document.getElementById('health-interval') && document.getElementById('health-interval').addEventListener('input', function() { App._updateHealthSliderLabels(); });
            document.getElementById('health-lock-hours') && document.getElementById('health-lock-hours').addEventListener('input', function() { App._updateHealthSliderLabels(); });
            document.getElementById('health-lock-minutes') && document.getElementById('health-lock-minutes').addEventListener('input', function() { App._updateHealthSliderLabels(); });
            var projBtn = document.getElementById('projectBtn');
            // 项目按钮由 app-project.js 统一绑定，避免重复切换导致面板打开后立即关闭。
            var settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn) settingsBtn.addEventListener('click', function() {
                self.openSettingsPanel('models');
            });
            var statusModelTrigger = document.getElementById('status-model-trigger');
            if (statusModelTrigger) statusModelTrigger.addEventListener('click', function() {
                self.openSettingsPanel('models');
            });
        },

        openSettingsPanel: function(tab) {
            var overlay = document.getElementById('settingsOverlay');
            if (!overlay) return;
            overlay.classList.add('show');
            this.switchSettingsTab(tab || 'models');
        },

        // ===== 设置面板 Tab 切换 =====
        switchSettingsTab: function(tab) {
            var self = this;
            tab = String(tab || 'models').replace(/^settingsPanel-/, '');
            var targetId = 'settingsPanel-' + tab;
            var targetPanel = document.getElementById(targetId);
            // Accept callers that pass the full panel id.
            if (!targetPanel && tab && tab.indexOf('settingsPanel-') === 0) {
                targetId = tab;
                targetPanel = document.getElementById(targetId);
                tab = targetId.slice('settingsPanel-'.length);
            }
            if (!targetPanel) {
                var fallbackPanel = document.querySelector('.settings-panel');
                if (fallbackPanel) fallbackPanel.classList.add('active');
                return;
            }
            document.querySelectorAll('.settings-nav-item').forEach(function(item) {
                item.classList.toggle('active', item.dataset.settingsTab === tab);
            });
            document.querySelectorAll('.settings-panel').forEach(function(panel) {
                panel.classList.toggle('active', panel.id === targetId);
            });
            if (tab === 'models') {
                // 关键：Models.load() 是异步的（GET 后端 JSON）。
                // 如果用户首次点开设置时 Models 还没加载完，
                // 直接 renderModelList() 会看到空 list，显示"尚未配置"。
                // 这里确保等 load 完再 render。
                // [v2 接管] 如果新版 app-models.js 已经接管了模型设置面板的渲染，
                // 就跳过这里的旧版 renderModelList()，避免两个版本抢同一个 #modelList。
                if (window.ModelConfigRewrite && typeof window.ModelConfigRewrite.mount === 'function') {
                    var modelMount = document.getElementById('modelPanelMount');
                    if (modelMount && !modelMount.querySelector('[data-mc-wrap]')) {
                        window.ModelConfigRewrite.mount(modelMount);
                    } else if (window.ModelConfigRewrite.refresh) {
                        window.ModelConfigRewrite.refresh().catch(function(error) {
                            console.warn('[模型配置] 刷新失败', error);
                        });
                    }
                } else if (window.__modelListV2Init) {
                    // 新版会在 tab 切换时自己 load + render，
                    // 这里什么都不做；下拉菜单刷新交给新版。
                    if (window.ModelSettingsV2 && window.ModelSettingsV2.refreshAllSelects) {
                        try { window.ModelSettingsV2.refreshAllSelects(); } catch(ex) { console.warn('[v2] refreshAllSelects failed', ex); }
                    }
                    if (window.ModelSettingsV2 && window.ModelSettingsV2.ensureLoaded) {
                        try { window.ModelSettingsV2.ensureLoaded(); } catch(ex) {}
                    }
                } else {
                    var renderAfterLoad = function() {
                        self.renderModelList();
                    };
                    if (Models._loaded) {
                        renderAfterLoad();
                    } else {
                        Models.load().then(renderAfterLoad).catch(renderAfterLoad);
                    }
                }
            } else if (tab === 'logs') {
                this.switchTab(this._panelTab || 'log');
            } else if (tab === 'email') {
                this.loadEmailConfig();
            } else if (tab === 'backup') {
                this.renderBackupList();
            } else if (tab === 'health') {
                this.loadHealthConfig();
            } else if (tab === 'tools') {
                // 工具设置：首次打开时初始化渲染
                if (typeof window.ToolsSettings !== 'undefined' && typeof window.ToolsSettings.init === 'function') {
                    window.ToolsSettings.init();
                }
            } else if (tab === 'ext-mcp' || tab === 'ext-skills') {
                // 扩展子系统（MCP / 技能双独立 tab），独立文件 ext-settings-panel.js
                if (typeof window.ExtSettingsPanel !== 'undefined' && typeof window.ExtSettingsPanel.init === 'function') {
                    window.ExtSettingsPanel.init(tab);
                }
            } else if (tab === 'comparison') {
                // PK 对比：默认选中第一个对手
                var firstBtn = document.querySelector('#pkSelector .pk-btn');
                if (firstBtn) this.selectPk(firstBtn.getAttribute('data-pk'));
            }
        },

        // ===== PK 对比面板：选择对手 =====
        selectPk: function(key) {
            var btns = document.querySelectorAll('#pkSelector .pk-btn');
            for (var i = 0; i < btns.length; i++) {
                btns[i].classList.toggle('active', btns[i].getAttribute('data-pk') === key);
            }
            var tables = document.querySelectorAll('.pk-table');
            for (var j = 0; j < tables.length; j++) {
                tables[j].style.display = (tables[j].id === 'pkTable-' + key) ? '' : 'none';
            }
        },
});
