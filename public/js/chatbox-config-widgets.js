/* ============================================================
 * chatbox-config-widgets.js —— 对话框底部配置区控件（唯一出处）
 *
 * eng-menu（底层引擎菜单）、tool-cat-menu（工具分类菜单）曾分散在
 * 各创建路径里手工拼 HTML，现统一由这里填充。
 *
 * 用法：
 *   App.fillChatboxConfigWidgets(box, { engineId, categoryName })
 *   - engineId:    对话所属引擎 ID（空=默认引擎）
 *   - categoryName:当前工具分类名（空='极简'）
 * 会同时更新触发按钮上的图标/名称显示。
 * ============================================================ */
(function () {
    'use strict';

    window.App = window.App || {};

    function esc(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

    App.buildToolCatMenuHtml = function (chatId, engineId) {
        var list = (typeof Tools !== 'undefined' && Tools.getCategoryList) ? Tools.getCategoryList(chatId, engineId || '') : [];
        var html = '';
        // 顶部标题行 + 右上角设置工具（与引擎菜单同结构）
        html += '<div class="tc-head"><span class="tc-head-title">工具分类</span></div>';
        list.forEach(function (c) {
            html += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + esc(c.name) + '">' +
                '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                '<span class="tool-cat-item-name">' + esc(c.name) + '</span>' +
                '</div>';
        });
        return html;
    };

    App.buildEngMenuHtml = function (engineId) {
        var list = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines() : [];
        var html = '';
        var curName = '朱峰底层';
        if (engineId) {
            var enCur = list.filter(function(x){return x.id===engineId;})[0];
            curName = enCur ? (enCur.name || engineId) : engineId;
        }
        // 顶部当前引擎提示 + 平铺一排按钮
        html += '<div class="eng-cur"><span class="eng-cur-text">当前引擎：<b>' + esc(curName) + '</b>（可设置每个对话循环上下文设置）</span><button class="eng-set-btn" type="button" title="打开引擎参数 / 循环配置">⚙</button></div>';
        html += '<div class="eng-row">';
        html += '<div class="eng-item' + (!engineId ? ' active' : '') + '" data-eng="" title="朱峰底层（服务端默认引擎）"><span>朱峰底层</span></div>';
        list.forEach(function (en) {
            if (en.id === 'zf_core') return; // 默认项已在上方固定，跳过避免重复
            html += '<div class="eng-item' + (engineId && en.id === engineId ? ' active' : '') + '" data-eng="' + esc(en.id) + '" title="' + esc(en.description || '') + '">' +
                '<span>' + (en.icon ? en.icon + ' ' : '') + esc(en.name) + '</span>' +
                (en.default ? '<span class="eng-def-tag">默认</span>' : '') +
                '</div>';
        });
        html += '</div>';
        return html;
    };

    App.fillChatboxConfigWidgets = function (box, opts) {
        opts = opts || {};
        var engineId = opts.engineId || '';
        var catName = opts.categoryName || '极简';
        try {
            var engMenu = box.querySelector('.eng-menu');
            if (engMenu) engMenu.innerHTML = App.buildEngMenuHtml(engineId);
            // 触发按钮显示当前引擎名
            var engNameSpan = box.querySelector('.eng-trigger .eng-name');
            if (engNameSpan) {
                var engs = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines() : [];
                var cur = engineId ? engs.filter(function (x) { return x.id === engineId; })[0] : null;
                if (!cur) cur = engs.filter(function (x) { return x.default; })[0] || engs[0] || null;
                engNameSpan.textContent = cur ? ((cur.icon ? cur.icon + ' ' : '') + cur.name) : '默认';
            }
        } catch (e) {}
        try {
            var catMenu = box.querySelector('.tool-cat-menu');
            if (catMenu) catMenu.innerHTML = App.buildToolCatMenuHtml(box.id, engineId);
            var catDef = (typeof Tools !== 'undefined' && Tools.categories) ? Tools.categories[catName] : null;
            var iconSpan = box.querySelector('.tool-cat-trigger .tool-cat-icon');
            var nameSpan = box.querySelector('.tool-cat-trigger .tool-cat-name');
            if (iconSpan) iconSpan.textContent = (catDef && catDef.icon) ? catDef.icon : '📄';
            if (nameSpan) nameSpan.textContent = catName;
        } catch (e) {}
    };
})();
