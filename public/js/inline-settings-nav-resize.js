    (function(){
        function init(){
            var bar = document.getElementById('settingsNavResize');
            if(!bar || bar.dataset.bound) return;
            bar.dataset.bound = '1';
            var KEY = 'settingsNavWidth';
            var t = null;
            function applyW(w){
                w = Math.max(120, Math.min(window.innerWidth*0.45, w));
                document.documentElement.style.setProperty('--settings-nav-width', w+'px');
                return w;
            }
            function save(w){
                clearTimeout(t);
                t = setTimeout(function(){
                    try{
                        if(window.UserSettings) UserSettings.set(KEY, String(Math.round(w)));
                        else localStorage.setItem(KEY, String(Math.round(w)));
                    }catch(e){}
                }, 400);
            }
            // 启动时恢复上次宽度
            try{
                var saved = (window.UserSettings && UserSettings.get(KEY)) || localStorage.getItem(KEY);
                if(saved) applyW(parseFloat(saved));
            }catch(e){}
            bar.addEventListener('pointerdown', function(e){
                e.preventDefault();
                bar.setPointerCapture(e.pointerId);
                bar.classList.add('is-dragging');
                var startX = e.clientX;
                var nav = document.getElementById('settingsNav');
                var startW = nav ? nav.getBoundingClientRect().width : 200;
                var last = startW;
                function move(ev){ last = applyW(startW + (ev.clientX - startX)); }
                function up(){
                    bar.classList.remove('is-dragging');
                    bar.removeEventListener('pointermove', move);
                    bar.removeEventListener('pointerup', up);
                    bar.removeEventListener('pointercancel', up);
                    save(last);
                }
                bar.addEventListener('pointermove', move);
                bar.addEventListener('pointerup', up);
                bar.addEventListener('pointercancel', up);
            });
        }
        if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    })();