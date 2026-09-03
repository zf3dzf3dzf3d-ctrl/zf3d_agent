// ========== engines_ui.js - 底层对话引擎选择器（前端） ==========
// 说明：
// 引擎列表数据（DB.loadEngines）供聊天框底部 eng-picker 使用。
// 设置面板（#modelPanelMount）不再展示「底层引擎」选择器，
// 引擎切换只保留在聊天框底部按钮。
var EnginesUI = {
    engines: [],
    _section: null,

    init: function() {
        var self = this;
        return fetch('/api/engines', { method: 'GET', cache: 'no-store' })
            .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('http ' + res.status)); })
            .then(function(data) {
                self.engines = (data && data.ok && Array.isArray(data.engines)) ? data.engines : [];
                return self.engines;
            })
            .catch(function(err) {
                console.warn('[EnginesUI] load /api/engines failed:', err);
                self.engines = [];
                return [];
            });
    },

    // 已禁用：设置面板不再渲染引擎选择器
    render: function() { return; },

    refresh: function() { return; }
};

window.EnginesUI = EnginesUI;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { EnginesUI.init(); });
} else {
    EnginesUI.init();
}
