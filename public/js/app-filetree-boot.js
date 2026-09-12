// ==== app-filetree-boot.js — 文件树启动/记忆恢复（由 app-filetree.js 拆出，须在其后加载） ====
// 文件树为常驻侧边栏：不再通过遮罩点击关闭，只有右上角 ✕ 或顶栏按钮才关闭
(function() {
    function bindOverlay() {
        var overlay = document.getElementById('ftPanelOverlay');
        if (!overlay || overlay.__ftBound) return;
        overlay.__ftBound = true;
        // 不绑定任何关闭逻辑（遮罩已透明且 pointer-events:none）
    }
    // 5.0.7 记忆增强：启动时从 user_settings.json 恢复钉住项目与浏览位置，
    // 覆盖回 localStorage（换浏览器/清缓存后依然能记住上次选择的项目）。
    function restoreFtMemory() {
        try {
            if (typeof UserSettings === 'undefined' || !UserSettings.loadFromServer) return;
            UserSettings.loadFromServer().then(function () {
                // 【5.1.2】恢复缩略图选中文件（UserSettings: ft_last_selected_files）
                try { App._restoreSel(); } catch (eSel) {}
                var pins = UserSettings.get('ft_pins', null);
                if (pins && pins.length && !localStorage.getItem('ft_pins')) {
                    localStorage.setItem('ft_pins', JSON.stringify(pins));
                }
                var last = UserSettings.get('ft_last_cwd', '');
                if (last && !localStorage.getItem('ft_last_cwd')) {
                    localStorage.setItem('ft_last_cwd', last);
                }
            }).catch(function(){});
            // 服务器数据到达后，若面板已打开则重渲染钉住列表（清缓存后立刻打开面板的场景）
            window.addEventListener('user-settings-refreshed', function () {
                try { if (window.App && App._ftPanelOpen) { App._renderTree(); App._updatePinBtn(); } } catch (e) {}
            });
        } catch (e) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function(){ bindOverlay(); restoreFtMemory(); _bindFolderChange(); });
    } else { bindOverlay(); restoreFtMemory(); _bindFolderChange(); }

    // 【5.1.0 修复】监听「项目路径变更」事件：设置/项目面板里重新选择项目文件夹后，
    // 文件树立即按新路径重新定位（不再停留在旧目录或误切到第一个项目）。
    function _bindFolderChange() {
        document.addEventListener('project-folder-changed', function(ev) {
            try {
                var app = window.App;
                if (!app || !app._ftPanelOpen) return; // 面板未打开时无需处理，下次打开自然按新路径定位
                var detail = ev && ev.detail ? ev.detail : {};
                // 同步更新本地项目缓存中的 folder_path，防止 _loadRoot 查到旧值
                var newPid = detail.projectId != null ? String(detail.projectId) : null;
                var newPath = detail.folderPath || '';
                if (newPid && newPath) {
                    var lists = [];
                    if (app._projAllProjects) lists.push(app._projAllProjects);
                    if (typeof Store !== 'undefined' && Store.data && Store.data.projects) lists.push(Store.data.projects);
                    for (var li = 0; li < lists.length; li++) {
                        for (var pi = 0; pi < lists[li].length; pi++) {
                            if (String(lists[li][pi].id) === newPid) { lists[li][pi].folder_path = newPath; break; }
                        }
                    }
                    // 文件树当前正属于这个项目 → 就地重新定位根目录
                    if (String(app._ftProjId || '') === newPid) {
                        app._ftRoot = app._norm(newPath);
                        app._navigate(app._ftRoot);
                        try { localStorage.setItem('ft_last_cwd', newPath); } catch (e2) {}
                    } else if (!app._ftProjId && typeof app.setActiveProjectUnified === 'function') {
                        // 文件树未绑定项目（如停留在主页）：切到该项目的根
                        app.setActiveProjectUnified(newPid);
                        app._loadRoot();
                    }
                } else if (app._ftProjId) {
                    app._loadRoot();
                }
            } catch (e) {}
        });
    }
})();

// 澶栭儴鍙屽嚮鍏抽棴鏂囦欢鏍戦潰鏉?
(function() {
    function bindDbl() {
        document.addEventListener('dblclick', function(ev) {
            var app = window.App;
            if (!app || !app._ftPanelOpen) return;
            var t = ev.target;
            if (t && t.closest) {
                if (t.closest('#ftPanel')) return;
                if (t.closest('#ftToggleBtn') || t.closest('#ftOpenBtn') || t.closest('[data-ft-toggle]')) return;
            }
            try { app.closeFileTreePanel(); } catch (e) {}
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindDbl);
    else bindDbl();
})();


