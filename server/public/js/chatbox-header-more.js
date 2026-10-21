/* ============================================================
 * chatbox-header-more.js —— 顶栏「Windows 菜单栏式」hover 引擎 (v4)
 *
 * 配套 chatbox-header-template.js：顶栏右侧只留一个「⋯」(more-btn)，
 * 其余全部收进它的下拉 .hd-more-menu。本文件负责下拉的显隐，Windows 手感：
 *   ① hover：鼠标搭上 .hd-more-wrap 自动展开下拉（OPEN_DELAY 防误触），
 *      真正离开后 CLOSE_DELAY 收起（给斜向移动到子项的容错）。
 *   ② 二级：悬停 引擎/工具分类/优先级 项时展开其二级弹层，移开收起。
 *   ③ click 兜底：点「更多▾」同样开/合（触屏、键盘）。
 *   ④ 多窗互斥 + Esc/点外部收起。
 *
 * 【v4 核心修复：鼠标"没搭上就隐藏、无法点击"】
 *   优先级(#prioMenu)、大师集群(.mc-menu)、Git分支(.bm-menu) 这三类二级浮层
 *   是以 position:fixed 挂在 document.body 上的，**不在 .hd-more-menu DOM 内**。
 *   旧版 mouseout 用 wrap.contains(relatedTarget) 判定"是否离开"，鼠标从菜单
 *   移入这些 body 浮层时被判定为"已离开" → 触发 hoverClose → 浮层连同被
 *   closeSecondLevel 移除，用户根本来不及点。
 *   v4 改用「活动区」概念：只要鼠标命中 KEEP_SELECTOR 描述的任一区域
 *   （下拉本身、或挂在 body 的浮层），就视为仍在菜单语境，清除待关计时。
 * ============================================================ */
(function () {
    'use strict';

    var OPEN_DELAY = 80;     // 悬停多久自动展开
    var CLOSE_DELAY = 250;   // 离开活动区多久自动收起
    // 「活动区」选择器：下拉容器 + 挂在 body 上的各类二级浮层
    var KEEP_SELECTOR = '.hd-more-wrap, .hd-more-menu, #prioMenu, #ctxMenu, .mc-menu, .bm-menu, .eng-menu, .tool-cat-menu';

    var activeWrap = null;   // 当前展开归属的 .hd-more-wrap（互斥，同时至多一个）
    var curLevel = null;     // 当前展开的二级面板类型（prio/mc/eng/cat），切换悬停项时互斥收起其它
    var openTimer = null;
    var closeTimer = null;

    function isPointer(e) {
        return e.pointerType && e.pointerType !== 'mouse'; // 触屏：不触发 hover
    }

    function closeAllMenus(except) {
        document.querySelectorAll('.chatbox-header .hd-more-menu').forEach(function (m) {
            if (m === (except ? except.querySelector('.hd-more-menu') : null)) return;
            if (m === except) return;
            m.style.display = 'none';
            closeSecondLevel();
        });
    }

    // 收起所有二级弹层（eng/cat 在菜单内；prio/mc 在 body）
    function closeSecondLevel() {
        document.querySelectorAll('.chatbox-header .eng-menu').forEach(function (m) { m.hidden = true; });
        document.querySelectorAll('.chatbox-header .tool-cat-menu').forEach(function (m) {
            m.hidden = true;
            if (m.__origParent) { try { m.__origParent.insertBefore(m, m.__origNext || null); } catch (e) {} }
        });
        var pm = document.getElementById('prioMenu');
        if (pm) { try { pm.remove(); } catch (e) {} }
        var cm = document.getElementById('ctxMenu');
        if (cm) { try { cm.remove(); } catch (e) {} }
        // 大师集群浮层（body 上的 .mc-menu）随菜单一起收起
        document.querySelectorAll('.mc-menu').forEach(function (m) { m.style.display = 'none'; });
        // Git 分支浮层（body 上的 .bm-menu）一并收起
        var bm = document.querySelector('.bm-menu');
        if (bm) { try { bm.remove(); } catch (e) {} }
        curLevel = null;
    }

    // 【互斥】只保留某类二级面板，收起其它所有类型（避免多个浮层同时弹出、互相遮挡无法点）
    function closeOthersExcept(type) {
        if (type !== 'prio') { var pm = document.getElementById('prioMenu'); if (pm) { try { pm.remove(); } catch (e) {} } }
        if (type !== 'ctx') { var cm = document.getElementById('ctxMenu'); if (cm) { try { cm.remove(); } catch (e) {} } }
        if (type !== 'mc') { document.querySelectorAll('.mc-menu').forEach(function (m) { m.style.display = 'none'; }); }
        if (type !== 'eng') { document.querySelectorAll('.chatbox-header .eng-menu').forEach(function (m) { m.hidden = true; }); }
        if (type !== 'cat') { document.querySelectorAll('.chatbox-header .tool-cat-menu').forEach(function (m) { m.hidden = true; }); }
        // 【修复·Git面板打不开/闪烁】不再在 hover 切换二级类型时移除 bm-menu：
        // 旧逻辑会在鼠标从已点开的 Git 面板扫过 eng/cat/prio/mc 任一菜单项时 bm.remove()，
        // 把刚打开的面板立即删掉。bm-menu 的关闭交由其自身 outside-click/✕ 按钮，
        // 以及鼠标彻底离开整个活动区时 closeSecondLevel() 统一负责。
    }

    function clearOpen() { if (openTimer) { clearTimeout(openTimer); openTimer = null; } }
    function clearClose() { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } }

    function doOpen(wrap) {
        var menu = wrap.querySelector('.hd-more-menu');
        if (!menu) return;
        if (menu.style.display !== 'none') { activeWrap = wrap; return; }
        closeAllMenus(wrap);
        closeSecondLevel();
        menu.style.display = '';
        activeWrap = wrap;
    }

    function hoverOpen(wrap) {
        clearClose();
        var menu = wrap.querySelector('.hd-more-menu');
        if (!menu) return;
        if (menu.style.display !== 'none') { activeWrap = wrap; return; }
        if (openTimer) return; // 已有待开计时
        openTimer = setTimeout(function () { openTimer = null; doOpen(wrap); }, OPEN_DELAY);
    }

    function scheduleClose(wrap) {
        clearOpen();
        clearClose();
        closeTimer = setTimeout(function () {
            closeTimer = null;
            var menu = wrap && wrap.querySelector('.hd-more-menu');
            if (menu) menu.style.display = 'none';
            closeSecondLevel();
            // 【悬停收起补全】鼠标离开按钮/菜单活动区后，分支(bm-menu)与优先级(#prioMenu)
            // 浮层也一并收起——它们挂在 body 上，不随 hd-more-menu display:none 隐藏。
            try {
                var bm = document.querySelector('.branch-menu'); if (bm) bm.remove();
                var pm = document.getElementById('prioMenu'); if (pm) pm.remove();
                var cm = document.getElementById('ctxMenu'); if (cm) cm.remove();
            } catch (e) {}
            if (activeWrap === wrap) activeWrap = null;
        }, CLOSE_DELAY);
    }

    // 悬停展开二级（引擎/分类）：复用既有 trigger 的 click 处理器
    function openSecondLevel(itemEl) {
        var trigger = itemEl.matches('.eng-trigger, .tool-cat-trigger')
            ? itemEl
            : (itemEl.querySelector && itemEl.querySelector('.eng-trigger, .tool-cat-trigger'));
        if (!trigger) return;
        var sub = trigger.parentElement && trigger.parentElement.querySelector('.eng-menu, .tool-cat-menu');
        if (sub && !sub.hidden) return; // 已展开
        try { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
        // 优先级(#prioMenu) 的展开由其自身 data-keepopen 触发（click 走 _openPrioMenu），
        // 但鼠标移入 .prio-btn 时这里也补一次 click 展开：
    }

    function openPrioIfHover(itemEl) {
        var pbtn = itemEl.matches('.prio-btn') ? itemEl : (itemEl.querySelector && itemEl.querySelector('.prio-btn'));
        if (!pbtn) return;
        if (document.getElementById('prioMenu')) return; // 已展开
        try { pbtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
    }

    // 上下文档位：悬停 .ctx-btn 即弹出（复用优先级模式：派发 click 走 _openCtxMenu）
    function openCtxIfHover(itemEl) {
        var cbtn = itemEl.matches('.ctx-btn') ? itemEl : (itemEl.querySelector && itemEl.querySelector('.ctx-btn'));
        if (!cbtn) return;
        if (document.getElementById('ctxMenu')) return; // 已展开
        try { cbtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
    }

    // Git 分支：悬停 .cfg-branch-btn 时直接展开分支菜单（不点击），
    // 鼠标离开按钮或 .bm-menu 区域后由活动区机制统一收起。
    function openBranchIfHover(itemEl) {
        var bb = itemEl.matches('.cfg-branch-btn') ? itemEl : (itemEl.querySelector && itemEl.querySelector('.cfg-branch-btn'));
        if (!bb) return;
        // 【修复·点不开】全局查已展开的分支浮层（.bm-menu 挂在 body 上，
        // 旧逻辑在 mousemove 里反复 toggle 导致面板闪烁、点击被反向关掉）
        if (document.querySelector('.bm-menu')) return; // 已展开
        var box = bb.closest('.chatbox');
        if (!box) return;
        var chat = (window.App.chatBoxes || []).find(function (c) { return c && c.el === box; });
        if (chat && typeof App.toggleBranchMenu === 'function') {
            try { App.toggleBranchMenu(box, chat); } catch (e) {}
        }
    }

    // 大师集群：悬停 .mastercluster-btn 时展开其 body 浮层并按鼠标位置摆放
    function openMasterIfHover(itemEl) {
        var mc = itemEl.matches('.mastercluster-btn') ? itemEl : (itemEl.querySelector && itemEl.querySelector('.mastercluster-btn'));
        if (!mc) return;
        if (typeof mc.__hoverOpen === 'function') mc.__hoverOpen();
    }

    // ---- hover（mousemove 驱动·活动区判定，仅鼠标）----
    document.addEventListener('mousemove', function (e) {
        if (isPointer(e)) return;
        var t = e.target;
        if (!t || !t.closest) return;
        var zone = t.closest(KEEP_SELECTOR);
        // 【独立按钮·悬停展开】优先级/上下文/大师 已搬到 ⋯ 左边成为独立按钮（不在 wrap 内），
        // 悬停时直接派发 click 展开各自的 body 浮层；移开由下方离开逻辑统一收起。
        if (!zone) {
            var stdBtn = t.closest && t.closest('.prio-btn, .ctx-btn, .mastercluster-btn');
            if (stdBtn) {
                clearClose();
                // 【诉求3·独立按钮也要互斥】优先级/上下文/大师被 relocate 搬到 ⋯ 左边
                // 成为 wrap 外的独立按钮，旧代码此分支只展开自己、不收起其它浮层，
                // 导致"大师打开其他的不关"。这里先按当前类做跨类互斥（closeOthersExcept），
                // 再展开当前浮层，实现"展开一个、上一个关闭"。
                if (stdBtn.classList.contains('prio-btn')) { closeOthersExcept('prio'); curLevel = 'prio'; openPrioIfHover(stdBtn); }
                else if (stdBtn.classList.contains('ctx-btn')) { closeOthersExcept('ctx'); curLevel = 'ctx'; openCtxIfHover(stdBtn); }
                else { closeOthersExcept('mc'); curLevel = 'mc'; openMasterIfHover(stdBtn); }
            }
        }
        if (zone) {
            // 命中任一活动区：保持展开，取消待关/补开计时
            clearClose();
            var wrap = t.closest('.hd-more-wrap');
            if (wrap) {
                activeWrap = wrap;
                hoverOpen(wrap);
                // 二级项悬停（仅在菜单已展开时按需展开）
                var menu = wrap.querySelector('.hd-more-menu');
                if (menu && menu.style.display !== 'none') {
                    var keepItem = t.closest('[data-keepopen]');
                    if (keepItem && wrap.contains(keepItem)) {
                        // 判定当前悬停项属于哪类二级面板，互斥展开
                        var isEng = !!(keepItem.querySelector('.eng-trigger') || (keepItem.matches && keepItem.matches('.eng-trigger')));
                        var isCat = !!(keepItem.querySelector('.tool-cat-trigger') || (keepItem.matches && keepItem.matches('.tool-cat-trigger')));
                        var isPrio = !!(keepItem.querySelector('.prio-btn') || (keepItem.matches && keepItem.matches('.prio-btn')));
                        var isCtx = !!(keepItem.querySelector('.ctx-btn') || (keepItem.matches && keepItem.matches('.ctx-btn')));
                        var isMc = !!(keepItem.querySelector('.mastercluster-btn') || (keepItem.matches && keepItem.matches('.mastercluster-btn')));
                        var isBranch = !!(keepItem.querySelector('.cfg-branch-btn') || (keepItem.matches && keepItem.matches('.cfg-branch-btn')));
                        var type = isPrio ? 'prio' : (isCtx ? 'ctx' : (isMc ? 'mc' : (isBranch ? 'branch' : (isEng ? 'eng' : (isCat ? 'cat' : null)))));
                        if (type) {
                            if (curLevel !== type) {
                                closeOthersExcept(type);   // 收起其它类，只留当前类
                                curLevel = type;
                                if (type === 'eng' || type === 'cat') openSecondLevel(keepItem);
                                else if (type === 'prio') openPrioIfHover(keepItem);
                                else if (type === 'ctx') openCtxIfHover(keepItem);
                                // 【大师改为悬停展开】鼠标搭上即弹出大师面板（用户要求恢复 hover）
                                else if (type === 'mc') openMasterIfHover(keepItem);
                                // 【Git改为点击展开】branch 不再悬停弹出：鼠标搭上只保持菜单展开，
                                // 由既有 click 委托（toggleBranchMenu）在用户点击时才弹出分支菜单
                                else if (type === 'branch') { /* 点击展开，悬停不弹 */ }
                            }
                    } else if (t.closest && t.closest('.eng-menu, .tool-cat-menu')) {
                        // 【修复·引擎/分类点不到】鼠标正悬停在已展开的二级面板选项上。
                        // 旧逻辑：选项不带 [data-keepopen] → 落入下面 else 分支 closeSecondLevel()，
                        // 面板瞬间收起，鼠标来不及点到 → 表现为"切换引擎/分类没反应"。
                        // eng-menu/tool-cat-menu 可能被定位到 body(fixed)，故不要求 wrap.contains。
                        // 这里只保持当前展开态（clearClose 已在上方执行），不动 curLevel。
                    } else {
                        // 悬停在其它菜单项（非二级触发、非二级面板内）→ 收起所有二级面板
                        if (curLevel) { closeSecondLevel(); curLevel = null; }
                    }
                    }
                }
            }
            return; // 仍在活动区内（含 body 浮层 #prioMenu/.mc-menu/.bm-menu）→ 不收起
        }
        // 离开所有活动区 → 收起当前展开的菜单（延时）
        if (activeWrap) scheduleClose(activeWrap);
    });

    // ---- click 兜底 + 点外部/Esc 收起 ----
    document.addEventListener('click', function (e) {
        var moreBtn = e.target.closest ? e.target.closest('.hd-more-wrap .more-btn') : null;
        if (moreBtn) {
            e.stopPropagation();
            var wrap = moreBtn.closest('.hd-more-wrap');
            var menu = wrap && wrap.querySelector('.hd-more-menu');
            if (menu) {
                clearOpen(); clearClose();
                var willOpen = menu.style.display === 'none';
                closeAllMenus(wrap);
                closeSecondLevel();
                if (willOpen) { menu.style.display = ''; activeWrap = wrap; }
                else { activeWrap = null; }
            }
            return;
        }
        var inMenu = e.target.closest ? e.target.closest('.hd-more-menu') : null;
        if (inMenu) {
            // keepopen 项（二级触发/分支/大师）点击后保持菜单展开；其余项点击后收起
            var keep = e.target.closest ? e.target.closest('[data-keepopen]') : null;
            if (!keep) {
                var w = inMenu.closest('.hd-more-wrap');
                if (w) scheduleClose(w);
                else { inMenu.style.display = 'none'; closeSecondLevel(); }
            }
            return;
        }
        // 点击 body 浮层内（#prioMenu/.mc-menu/.bm-menu）不关菜单（由浮层自身逻辑处理）
        if (e.target.closest && e.target.closest('#prioMenu, .mc-menu, .bm-menu')) return;
        clearOpen(); clearClose();
        closeAllMenus(null);
        closeSecondLevel();
        activeWrap = null;
    }, true);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { clearOpen(); clearClose(); closeAllMenus(null); closeSecondLevel(); activeWrap = null; }
    });
})();
