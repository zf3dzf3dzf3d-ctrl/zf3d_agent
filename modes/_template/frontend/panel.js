// _template/frontend/panel.js - 插件对话面板模板（可选）
// 被 mode_panel_loader.js 在用户切到本模式时动态加载。
// 通过 window.ModePlugins.registerPanel(id, api) 注册，api 由面板自定。
//
// 示例：
// (function() {
//     var panel = {
//         // 面板初始化（切到该模式时触发一次）
//         init: function(container) {
//             container.innerHTML = '<div class="mode-plugin-panel">我的模式面板</div>';
//         },
//         // 发送消息前的钩子：可往 payload 注入额外字段
//         beforeSend: function(payload) { return payload; }
//     };
//     window.ModePlugins && window.ModePlugins.registerPanel('your_mode_id', panel);
// })();
