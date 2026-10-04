
    (function () {
        var TURBO_KEY = 'zf_turbo';
        function isTurbo() {
            try { return (window.UserSettings ? window.UserSettings.get(TURBO_KEY, '0') : localStorage.getItem(TURBO_KEY)) === '1'; }
            catch (e) { return localStorage.getItem(TURBO_KEY) === '1'; }
        }
        function applyTurbo(on) {
            var html = document.documentElement;
            if (on) {
                html.classList.add('turbo');
                /* 跳过开机动画：立即隐藏 */
                var boot = document.getElementById('bootScreen');
                if (boot) { boot.style.display = 'none'; }
                /* 停掉已存在的风筝 RAF 循环 */
                try {
                    if (window.__kiteTickStop) window.__kiteTickStop();
                } catch (e) {}
                /* 隐藏风筝 DOM */
                var kiteRoot = document.getElementById('zfKiteRoot');
                if (kiteRoot) kiteRoot.style.display = 'none';
                if (kiteRoot) kiteRoot.style.display = 'none';
            } else {
                html.classList.remove('turbo');
                /* 清掉急速期间可能残留的流星元素，防止动画恢复时大批流星同时掉落 */
                try { document.querySelectorAll('.space-meteor').forEach(function (el) { el.remove(); }); } catch (e) {}
                var kr = document.getElementById('zfKiteRoot');
                if (kr) {
                    /* 按风筝开关的真实状态恢复，不盲目强显（用户可能主动藏了风筝） */
                    try {
                        var kHidden = (window.UserSettings ? window.UserSettings.get('zf3d-kite-hidden', '0') : localStorage.getItem('zf3d-kite-hidden')) === '1';
                        kr.style.display = kHidden ? 'none' : '';
                    } catch (e) { kr.style.display = ''; }
                } else if (window.KiteDragon && window.KiteDragon.init) {
                    /* 急速状态下启动时风筝从未初始化（init 被跳过）：关急速后补建 */
                    try { window.KiteDragon.init(); } catch (e) {}
                }
                /* 恢复风筝面板的闸门轮询与数据刷新 */
                try { if (window.__kiteTickResume) window.__kiteTickResume(); } catch (e) {}
                try { if (window.__kiteTickResume) window.__kiteTickResume(); } catch (e) {}
            }
            /* 暴露状态给其他模块（app-kite.js / app-minimap.js 启动时读取） */
            window.ZF_TURBO = on;
        }

        /* ===== 全局 API：供其他模块查询 ===== */
        window.isTurboMode = isTurbo;
        window.setTurboMode = function (on) {
            try {
                if (window.UserSettings) window.UserSettings.set(TURBO_KEY, on ? '1' : '0');
                else localStorage.setItem(TURBO_KEY, on ? '1' : '0');
            } catch (e) { localStorage.setItem(TURBO_KEY, on ? '1' : '0'); }
            applyTurbo(on);
        };
        /* 启动即应用 */
        applyTurbo(isTurbo());

        /* 右下角 dock 按钮状态同步 */
        function refreshTurboDockBtn() {
            var btn = document.getElementById('turboDockBtn');
            if (!btn) return;
            var on = isTurboMode();
            btn.classList.toggle('turbo-on', on);
            btn.title = on ? '急速模式：已开启（点击关闭）' : '急速模式：已关闭（点击开启）';
        }
        window.refreshTurboDockBtn = refreshTurboDockBtn;
        var _origSetTurboMode = window.setTurboMode;
        window.setTurboMode = function (on) { _origSetTurboMode(on); setTimeout(refreshTurboDockBtn, 60); };
        setTimeout(refreshTurboDockBtn, 350);
        setTimeout(refreshTurboDockBtn, 1300);

    })();
    