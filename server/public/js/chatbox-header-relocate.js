/* ============================================================
 * chatbox-header-relocate.js —— ①② 控件收纳：运行时把底部 configrow 的控件
 * 搬到「右上角 ⋯ 菜单」和「底部与加号/语音同排」。
 *
 * 设计：DOM 节点整体搬移（appendChild / insertBefore 移动同一节点），
 * 事件绑定（data-act 委托、各注入脚本的 addEventListener）随节点走，不丢失。
 * 幂等：每次跑都先判断目标位置，已在位则跳过；用 MutationObserver + 定时补，
 * 兼容 mastercluster / workbench 延迟注入的按钮。
 *
 * 用户三条诉求对应：
 *  ① ⋯ 菜单收纳：朱峰底层(eng-picker-wrap) / 极简(tool-cat-wrap) / 大师集群(mastercluster-btn) / 优先级(prio-btn，模板已内置)
 *  ② 底部同排：文件项目(cfg-project-btn) / main(cfg-branch-btn) / 选择大模型(model-picker-wrap) / 工作台(wb-toggle-btn)
 *     与 ➕(upload-btn) 🎤(voice-btn) 合并进 chatbox-inputrow，空 configrow 移除。
 *  二级弹层方向：eng-menu / tool-cat-menu 原在底部「向上弹」，搬进顶部菜单后改「向下弹」(opens-down)。
 * ============================================================ */
(function () {
    'use strict';

    // 需要「向下弹」适配的二级菜单类（搬进 header 后触发器在顶部）
    var OPENDOWN_TRIGGERS = ['.eng-picker-wrap', '.tool-cat-wrap'];

    function moveTo(node, parent, refNode) {
        if (!node || !parent) return;
        if (node.parentNode === parent && (!refNode || node.nextSibling === refNode)) return; // 已在位
        if (refNode && refNode.parentNode === parent) parent.insertBefore(node, refNode);
        else parent.appendChild(node);
    }

    // 【修复·⋯下拉两项乱码】引擎名(.eng-name)/工具分类名(.tool-cat-name)的显示文字由后端
    // 字段填充，编码异常时出现乱码（U+FFFD 替换符 / 经典"锟斤拷" / UTF-8 字节被按 GBK-Latin1 误解）。
    // 展示层兜底：命中乱码特征或空文字时回退默认值（引擎→默认，分类→极简）。relocate 周期运行持续校正。
    function isGarbled(s) {
        if (!s) return true;
        if (/\uFFFD/.test(s)) return true;
        if (s.indexOf('锟斤拷') >= 0) return true;
        if (/[\u00C2\u00C3][\u0080-\u00BF]/.test(s)) return true;
        // 【加固】UTF-8 被按 GBK/Latin1 误解会产生"看似正常汉字"的乱码（如 鏈辩泭搴曞眰），
        // 上述特征抓不住 → 白名单校验：引擎名不在合法集合内一律视为乱码。
        try {
            if (typeof DB !== 'undefined' && DB.getEngines) {
                var names = DB.getEngines().map(function (e) { return e.name || ''; });
                // 【守卫】引擎列表尚未加载/为空时跳过白名单判断，避免初始化时序把合法自定义引擎名误判为乱码
                if (names.length > 0) {
                    names.push('默认', '朱峰底层');
                    if (names.indexOf(s) < 0) return true;
                }
            }
        } catch (e) {}
        return false;
    }
    function isGarbledCat(s) {
        if (!s) return true;
        if (/\uFFFD/.test(s)) return true;
        if (s.indexOf('锟斤拷') >= 0) return true;
        if (/[\u00C2\u00C3][\u0080-\u00BF]/.test(s)) return true;
        // 白名单：分类名必须存在于 Tools.categories（含全部注册分类）
        try {
            if (typeof Tools !== 'undefined' && Tools.categories) {
                if (!Tools.categories[s]) return true;
            }
        } catch (e) {}
        return false;
    }
    function fixGarbledName(box) {
        var eng = box.querySelector('.eng-name');
        if (eng) { var t = (eng.textContent || '').trim(); if (isGarbled(t)) eng.textContent = '默认'; }
        var cat = box.querySelector('.tool-cat-name');
        if (cat) { var t2 = (cat.textContent || '').trim(); if (isGarbledCat(t2)) cat.textContent = '极简'; }
    }

    function relocateBox(box) {
        var menu = box.querySelector('.hd-more-wrap .hd-more-menu');
        var configrow = box.querySelector('.chatbox-configrow');
        var inputrow = box.querySelector('.chatbox-inputrow');
        // 注意：configrow 搬空后会被 remove，此后定时器/MutationObserver 仍会触发本函数。
        // 不能用 !configrow 直接 return，否则大师集群/工作台延迟注入的「兜底再搬」会永久失效。
        // configrow 缺失时用空节点兜底（其 querySelector 恒返回 null，①②段自然跳过）。
        if (!menu || !inputrow) return;
        if (!configrow) configrow = document.createElement('div');

        // ---- ① 顶部 ⋯ 菜单收纳：底层对话引擎 / 切换工具分类 / Git分支 / 大师集群 ----
        // 【本次需求】用户要求把「底层对话引擎(eng-picker-wrap)、切换工具分类(tool-cat-wrap)、
        // git分支(cfg-branch-btn)」放进右上角 ⋯ 更多菜单。菜单内它们的二级弹层改为向下弹
        // （样式在 style-chatbox.css 的 .chatbox-header .hd-more-menu .eng-menu 等规则中）。
        var engWrap = box.querySelector('.eng-picker-wrap');
        var catWrap = box.querySelector('.tool-cat-wrap');
        var branch = box.querySelector('.cfg-branch-btn');
        var mcBtn = box.querySelector('.mastercluster-btn');
        // 【回改】优先级/上下文/大师 全部收进 ⋯ 下拉菜单内（模板已内置），不再外置常驻
        var hdWrap = menu.closest('.hd-more-wrap');
        var menubar = menu.closest('.hd-menubar') || (hdWrap ? hdWrap.parentNode : null);
        function styleStandalone(btn) {
            if (!btn) return;
            btn.style.background = 'none';
            btn.style.border = 'none';
            btn.style.boxShadow = 'none';
            btn.style.cursor = 'pointer';
            btn.style.padding = '5px 8px';
            btn.style.color = 'inherit';
            btn.style.fontSize = '12px';
            btn.style.fontFamily = 'inherit';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.height = 'auto';
        }
        var prioBtn = menu.querySelector('.prio-btn');
        var ctxBtn = menu.querySelector('.ctx-btn');
        var logBtn = menu.querySelector('.log-panel-btn');
        // 菜单项顺序：工具 → 日志 → 优先级 → 上下文 → 引擎 → 工具分类 → Git分支 → 大师集群
        if (engWrap) moveTo(engWrap, menu, ctxBtn ? ctxBtn.nextSibling : (logBtn ? logBtn.nextSibling : menu.firstChild));
        if (catWrap) moveTo(catWrap, menu, engWrap && engWrap.nextSibling);
        // 引擎/工具分类各有「二级弹层」(eng-menu / tool-cat-menu)，在 ⋯ 菜单内必须
        // 标记 data-keepopen，否则 chatbox-header-more.js 会在点击后立刻把整个菜单收起，
        // 连带把刚展开的二级弹层一起关掉（表现为"点了没反应"）。
        if (engWrap) { var et = engWrap.querySelector('.eng-trigger'); if (et) { et.setAttribute('data-keepopen', '1'); /* 引擎按钮去框：纯文字观感 */ et.style.background = 'none'; et.style.border = 'none'; et.style.boxShadow = 'none'; et.style.padding = '5px 8px'; } }
        if (catWrap) { var ct = catWrap.querySelector('.tool-cat-trigger'); if (ct) ct.setAttribute('data-keepopen', '1'); }
        if (branch) {
            moveTo(branch, menu, logBtn ? logBtn.nextSibling : (catWrap ? catWrap.nextSibling : null));
            // 分支弹层挂在 body（fixed），与菜单互不影响；标记 keepopen 让菜单保持展开，
            // 方便切完分支直接看到当前分支名刷新
            branch.setAttribute('data-keepopen', '1');
        }
        // 【回改】mcBtn 保持收进 ⋯ 下拉（下方兜底 moveTo 负责），不再外置 menubar
        if (mcBtn) { if (mcBtn.parentNode !== menu) moveTo(mcBtn, menu); mcBtn.setAttribute('data-keepopen', '1'); styleStandalone(mcBtn); }

        // ---- ② 底部同排：项目/大模型/工作台 并入 inputrow 一个大外壳 ----
        // 项目(main)/大模型/工作台 与 ➕ 🎤 留在 chatbox-inputrow，
        // 由「一个大圆角外壳」统一包住；排列顺序与外观（去框去文字、垂直居中一条线）
        // 交给 chatbox-bottom-merge.css 的 order 控制。
        var proj = configrow.querySelector('.cfg-project-btn');
        var modelWrap = configrow.querySelector('.model-picker-wrap');
        [proj, modelWrap].forEach(function (n) { if (n) moveTo(n, inputrow, null); });
        // 工作台按钮（app-workbench 注入；锚点在 inputrow，这里兜底）
        var wbBtn = box.querySelector('.wb-toggle-btn');
        if (wbBtn && !inputrow.contains(wbBtn)) moveTo(wbBtn, inputrow, null);

        // 收尾：configrow 已空则移除
        if (configrow.children.length === 0) { try { configrow.remove(); } catch (e) {} }
    }

    function relocateAll() {
        try {
            document.querySelectorAll('.chatbox').forEach(function (box) { relocateBox(box); fixGarbledName(box); });
        } catch (e) {}
    }

    // mastercluster / workbench 用 setTimeout/MutationObserver 延迟注入，relocate 同样补跑
    var PENDING = false;
    function schedule() {
        if (PENDING) return; PENDING = true;
        setTimeout(function () { PENDING = false; relocateAll(); }, 120);
    }
    function boot() {
        relocateAll();
        try { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
        setInterval(relocateAll, 5000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
