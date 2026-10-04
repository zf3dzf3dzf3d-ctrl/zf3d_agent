
    (function(){
        function initEdgeBars(){
            var top = document.querySelector('.topbar');
            var bot = document.querySelector('.statusbar');
            if (!top || !bot) return;
            var hideT = null;
            function show(which){
                clearTimeout(hideT);
                document.body.classList.add(which === 'top' ? 'edge-top-show' : 'edge-bottom-show');
            }
            function scheduleHide(which){
                clearTimeout(hideT);
                hideT = setTimeout(function(){
                    document.body.classList.remove('edge-top-show', 'edge-bottom-show');
                }, 400);
            }
            function bind(bar, which){
                if (!bar) return;
                bar.addEventListener('mouseenter', function(){ show(which); });
                bar.addEventListener('mouseleave', function(){ scheduleHide(which); });
            }
            bind(top, 'top');
            bind(bot, 'bottom');
            var hotTop = document.getElementById('edge-hot-top');
            var hotBot = document.getElementById('edge-hot-bottom');
            if (hotTop){
                hotTop.addEventListener('mouseenter', function(){ show('top'); });
                hotTop.addEventListener('mouseleave', function(){ scheduleHide('top'); });
            }
            if (hotBot){
                hotBot.addEventListener('mouseenter', function(){ show('bottom'); });
                hotBot.addEventListener('mouseleave', function(){ scheduleHide('bottom'); });
            }
        }
        if (document.readyState === 'loading'){
            document.addEventListener('DOMContentLoaded', initEdgeBars);
        } else {
            initEdgeBars();
        }
    })();
    