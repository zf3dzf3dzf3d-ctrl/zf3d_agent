// 对话框「更多」菜单乱码兜底守护
// 无论乱码从哪条路径（缓存/持久化/动态数据）写入 DOM，本脚本周期扫描并纠正。
// 触发按钮与菜单标题均为固定文案，发现乱码特征即回退。
(function () {
    'use strict';
    function _garbled(s) {
        s = String(s == null ? '' : s);
        if (!s) return false;
        if (/[\uFFFD]/.test(s)) return true;                 // Unicode 替换符
        if (/[\u952F\u9368]/.test(s)) return true;           // 锟/拷 经典互转乱码
        if (/[\u93C5\u93C8\u93FE]/.test(s)) return true;     // 鏈/钘 等 UTF8->GBK 特征字
        if (/[\u00C2\u00C3][\u0080-\u00BF]/.test(s)) return true; // Latin1 误解组合
        // 【加固】单字节损坏型乱码（如 朱峰底屋：层 E5 B1 82 尾字节损坏成 屋 E5 B1 8B）
        // 是合法汉字序列，上述特征全抓不住 → 引擎名白名单校验兜底。
        // 长度阈值动态取「最长合法引擎名 + 8」余量（替代武断的 24 字硬编码，审核建议）：
        // 超过该长度的视为整行标题等长文本，不做全等白名单判断（避免误伤）。
        var _maxLen = 24; // DB 未加载时的兜底阈值（DB 可用时会在下方 try 块动态更新为最长引擎名）
        try {
            if (typeof DB !== 'undefined' && DB.getEngines) {
                DB.getEngines().forEach(function (e) { if (e && e.name && e.name.length > _maxLen) _maxLen = e.name.length; });
            }
        } catch (eL) {}
        if (s.length > _maxLen + 8) return false;
        try {
            if (typeof DB !== 'undefined' && DB.getEngines) {
                var _names = DB.getEngines().map(function (e) { return e.name || ''; });
                _names.push('底层引擎', '引擎', '工具分类', '极简', '当前引擎：朱峰底层');
                // 【修复】把全部工具分类名加入合法词白名单，否则「编程/写作/视觉工具」等
                // 分类项会被误判为乱码、每 2 秒被强制改回「极简」（下拉菜单文字错误根因）
                try {
                    if (window.ToolDefinitions && window.ToolDefinitions.categories) {
                        Object.keys(window.ToolDefinitions.categories).forEach(function (cn) { _names.push(cn); });
                    }
                } catch (eC) {}
                if (_names.length > 1 && _names.indexOf(s) < 0) return true;
            }
        } catch (eW) {}
        return false;
    }
    // 标题行专用：整行文字，检查是否包含合法引擎名（不含则视为乱码）
    function _titleGarbled(s) {
        s = String(s == null ? '' : s);
        if (!s) return true;
        if (_garbled(s)) return true;
        try {
            if (typeof DB !== 'undefined' && DB.getEngines) {
                var _names = DB.getEngines().map(function (e) { return e.name || ''; });
                _names.push('朱峰底层');
                for (var i = 0; i < _names.length; i++) { if (_names[i] && s.indexOf(_names[i]) >= 0) return false; }
                return _names.length > 1; // 列表已加载但不含任何合法引擎名 → 乱码
            }
        } catch (eW2) {}
        return false;
    }
    function _fix() {
        var boxes = document.querySelectorAll('.chatbox-header');
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            // ① 触发按钮（引擎/分类两项）
            var trigEng = box.querySelector('.hd-more-trig[data-more="eng"], .eng-trig, [data-menu="eng"]');
            var trigCat = box.querySelector('.hd-more-trig[data-more="cat"], .cat-trig, [data-menu="cat"]');
            if (trigEng && _garbled(trigEng.textContent)) trigEng.textContent = '引擎';
            if (trigCat && _garbled(trigCat.textContent)) trigCat.textContent = '工具分类';
            // ② 菜单标题行：【强制写死】无论旧缓存/快照写入了什么文字（含历史遗留乱码
            //    如「背景墙」——该词全项目零命中，仅存于用户浏览器本地旧缓存），
            //    只要不等于目标文案就强制纠正，根治改不掉的问题。
            var t1 = box.querySelector('.eng-cur-text');
            if (t1 && t1.textContent !== '底层引擎') t1.textContent = '底层引擎';
            var t2 = box.querySelector('.tc-head-title');
            if (t2 && _garbled(t2.textContent)) t2.textContent = '工具分类';
            // ③ 菜单内引擎项：乱码引擎名回退为朱峰底层
            var items = box.querySelectorAll('.eng-item span, .eng-item');
            for (var j = 0; j < items.length; j++) {
                var el = items[j];
                if (el.childElementCount === 0 && _garbled(el.textContent)) el.textContent = '朱峰底层';
            }
            // ④ 菜单内分类项：乱码分类名回退为极简
            var cats = box.querySelectorAll('.tool-cat-item-name');
            for (var k = 0; k < cats.length; k++) {
                if (_garbled(cats[k].textContent)) cats[k].textContent = '极简';
            }
        }
    }
    // 启动即扫一次 + 每 2 秒兜底扫一次（覆盖动态重建的菜单）
    function boot() { _fix(); setInterval(_fix, 2000); _watch(); }
    // 【2026-11 硬守护】触发按钮文字本应为固定文字「引擎/工具分类」，
    // 不再做启发式乱码判断：只要 .eng-name/.tool-cat-name 的文字偏离固定值，
    // 立即纠正（MutationObserver 即时 + 轮询兜底），杜绝任何时序/数据源污染。
    function _watch() {
        function enforce() {
            var els = document.querySelectorAll('.eng-name');
            for (var i = 0; i < els.length; i++) {
                if (els[i].textContent !== '引擎') els[i].textContent = '引擎';
            }
            var cats = document.querySelectorAll('.tool-cat-name');
            for (var k = 0; k < cats.length; k++) {
                if (cats[k].textContent !== '工具分类') cats[k].textContent = '工具分类';
            }
            // 悬停提示气泡同步锁死
            var trigs = document.querySelectorAll('.eng-trigger');
            for (var m = 0; m < trigs.length; m++) {
                if (trigs[m].getAttribute('title') !== '引擎（对话处理管线）') trigs[m].setAttribute('title', '引擎（对话处理管线）');
            }
        }
        enforce();
        if (typeof MutationObserver !== 'undefined') {
            var mo = new MutationObserver(function () { enforce(); });
            function observeAll() {
                document.querySelectorAll('.eng-name, .tool-cat-name').forEach(function (el) {
                    mo.observe(el, { childList: true, characterData: true, subtree: true });
                });
            }
            observeAll();
            setInterval(observeAll, 3000); // 菜单 DOM 可能重建，定期补挂观察
        }
        setInterval(enforce, 1500);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
})();
