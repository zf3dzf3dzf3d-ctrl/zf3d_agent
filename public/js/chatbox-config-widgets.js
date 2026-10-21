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
        // 【修复·⋯下拉两项乱码·源头治理】引擎名/分类名由本函数写入 textContent，传入的
        // catName / 缓存的 cur.name 若编码损坏（持久化对话记录时字节序异常）会直接显示乱码。
        // 旧方案仅靠 chatbox-header-relocate.js 的 5 秒周期兜底，存在"先乱码、后修正"的时序
        // 空窗。改为在写入源头即时检测：命中乱码特征（U+FFFD 替换符 / 锟斤拷 / UTF-8 被按
        // Latin1 误解产生的 Â Ã 高位组合）即回退默认值，杜绝把乱码写进 DOM。
        function _garbled(s) {
            s = String(s == null ? '' : s);
            if (!s.trim()) return true;                       // 空/纯空白 → 视为异常
            if (/\uFFFD/.test(s)) return true;                 // Unicode 替换符
            if (s.indexOf('锟斤拷') >= 0) return true;          // 经典 GBK<->UTF8 互转乱码
            if (/[\u00C2\u00C3][\u0080-\u00BF]/.test(s)) return true; // UTF-8 字节被按 Latin1 误解
            return false;
        }
        try {
            var engMenu = box.querySelector('.eng-menu');
            if (engMenu) engMenu.innerHTML = App.buildEngMenuHtml(engineId);
            // 触发按钮显示当前引擎名
            var engNameSpan = box.querySelector('.eng-trigger .eng-name');
            if (engNameSpan) {
                var engs = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines() : [];
                var cur = engineId ? engs.filter(function (x) { return x.id === engineId; })[0] : null;
                if (!cur) cur = engs.filter(function (x) { return x.default; })[0] || engs[0] || null;
                var engText = cur ? ((cur.icon ? cur.icon + ' ' : '') + cur.name) : '默认';
                if (_garbled(engText)) engText = '默认'; // 引擎名乱码 → 回退默认
                engNameSpan.textContent = engText;
            }
        } catch (e) {}
        try {
            var catMenu = box.querySelector('.tool-cat-menu');
            if (catMenu) catMenu.innerHTML = App.buildToolCatMenuHtml(box.id, engineId);
            var catDef = (typeof Tools !== 'undefined' && Tools.categories) ? Tools.categories[catName] : null;
            var iconSpan = box.querySelector('.tool-cat-trigger .tool-cat-icon');
            var nameSpan = box.querySelector('.tool-cat-trigger .tool-cat-name');
            if (iconSpan) iconSpan.textContent = (catDef && catDef.icon) ? catDef.icon : '📄';
            // 分类名乱码 → 回退「极简」（即使 catDef 查不到也按默认显示，避免写乱码进 DOM）
            nameSpan && (nameSpan.textContent = _garbled(catName) ? '极简' : catName);
        } catch (e) {}
    };
})();
