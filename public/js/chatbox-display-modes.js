// ==== chatbox-display-modes.js — 两档显示模式（full / minimal）====
// 策划案 v3.5 P2 实现档：渲染层过滤而非数据层丢弃——历史照常完整存库，点开即全量补渲染。
// 三档定义：
//   full    完整模式（默认）：标题+思维链+工具+选项+输入行，一切照旧
//   minimal 极简模式：只显示最近一轮「用户问题→AI答案」，思维链/工具调用/选项按钮全部隐藏
// 【S2 2026-11-15】title 标题档已废：用户拍板「废标题模式」，三档收敛两档。
// 切换入口：
//   1) 对话框标题 Alt+双击（2026-11-23 整改：普通双击让位给标题双击重命名，见 init 内注释）：
//      full ↔ minimal 循环切换
//   2) header 档位按钮 .zf-display-mode-btn（后续接入 header 模板；当前以 Alt+双击为主入口）
// 数据层：box.dataset.display（'minimal'/'title'，缺省=full），Store.saveChatBox 持久化 displayMode。
(function () {
    if (typeof App === 'undefined') { setTimeout(init, 300); return; }
    init();

    var ORDER = ['full', 'minimal'];

    function getMode(box) {
        var m = box.dataset.display || 'full';
        return m === 'title' ? 'minimal' : m; // 【S2】旧 title 档归一化为 minimal
    }

    // minimal 档核心：把「最后一个 .msg.user 及其后所有兄弟」打上放行标记
    function markLastRound(box) {
        var body = box.querySelector('.chatbox-body');
        if (!body) return;
        Array.prototype.forEach.call(body.querySelectorAll('.msg.zf-minimal-show'), function (m) {
            m.classList.remove('zf-minimal-show');
        });
        var msgs = body.querySelectorAll('.msg.user');
        var last = msgs[msgs.length - 1];
        if (!last) {
            // 无用户消息时放行最后一条消息兜底（欢迎页等）
            var all = body.querySelectorAll('.msg');
            last = all[all.length - 1];
        }
        while (last) {
            last.classList.add('zf-minimal-show');
            last = last.nextElementSibling;
        }
    }

    function setMode(box, mode, chat) {
        if (ORDER.indexOf(mode) === -1) mode = 'full';
        // 先清理档位标记
        delete box.dataset.display;
        box.classList.remove('zf-minimal');

        if (mode === 'minimal') {
            box.classList.remove('collapsed');   // minimal 需要正文区
            box.dataset.display = 'minimal';
            box.classList.add('zf-minimal');
            markLastRound(box);
        }
        // 【S2】title 分支已废；full 分支无需额外清理（标记已在上方统一摘除）
        // chat 对象同步 + 落库
        chat = chat || (App.chatBoxes ? App.chatBoxes.find(function (c) { return c.el === box; }) : null);
        if (chat) { chat.displayMode = mode; try { Store.saveChatBox(chat); } catch (e) {} }
    }

    function cycleMode(box) {
        var cur = getMode(box);
        var next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
        setMode(box, next);
        var names = { full: '完整', minimal: '极简（仅最近问答）' };
        if (typeof ToastStack !== 'undefined' && ToastStack.show) {
            var t = document.createElement('div');
            t.textContent = '显示档位：' + names[next];
            try { ToastStack.show(t, 1200); } catch (e) {}
        } else if (typeof App !== 'undefined' && App.showToast) {
            try { App.showToast('显示档位：' + names[next]); } catch (e) {}
        }
        return next;
    }

    function init() {
        // 标题 Alt+双击循环档位（2026-11-23 整改）：
        // 原实现为捕获阶段双击 + stopPropagation，把普通双击也吃掉了——chatbox-03 的
        // 「双击标题重命名」入口因此永远收不到事件（双击重命名失效的根因）。
        // 现在：只有按住 Alt 的双击（e.altKey）才切换档位并拦截；普通双击不做任何处理、
        // 原样放行给 chatbox-03 的重命名 trackListener(titleEl,'dblclick',...) 分支。
        document.addEventListener('dblclick', function (ev) {
            if (!ev.altKey) return; // 普通双击：不拦截，放行给重命名等既有交互
            var titleEl = ev.target.closest && ev.target.closest('.chatbox-header .title');
            if (!titleEl || titleEl.querySelector('input')) return;
            var box = titleEl.closest('.chatbox');
            if (!box) return;
            ev.preventDefault(); ev.stopPropagation();
            cycleMode(box);
        }, true);

        // 档位按钮（事件委托）
        document.addEventListener('click', function (ev) {
            var btn = ev.target.closest && ev.target.closest('.zf-display-mode-btn');
            if (!btn) return;
            var box = btn.closest('.chatbox');
            if (!box) return;
            ev.preventDefault(); ev.stopPropagation();
            cycleMode(box);
        });

        // minimal 档：流式/新增消息后自动保持「只看最后一轮」——MutationObserver 批量重算标记
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                var box = m.target.closest && m.target.closest('.chatbox.zf-minimal');
                if (box) markLastRound(box);
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

    // 暴露 API：diverge 子对话默认极简、批量收口、恢复路径调用
    window.ZFDisplayModes = {
        get: getMode,
        set: setMode,
        cycle: cycleMode,
        setMinimal: function (box) { setMode(box, 'minimal'); },
        setFull: function (box) { setMode(box, 'full'); }
    };
})();
