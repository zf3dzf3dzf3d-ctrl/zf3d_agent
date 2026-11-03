        (function(){
            var boot = document.getElementById('bootScreen');
            function hideBoot(){
                boot.style.opacity = '0';
                setTimeout(function(){ boot.style.display = 'none'; }, 850);
            }
            if (document.readyState === 'complete') {
                setTimeout(hideBoot, 1000);
            } else {
                window.addEventListener('load', function(){ setTimeout(hideBoot, 1000); });
            }
            setTimeout(function(){ if(boot.style.display!=='none') hideBoot(); }, 5000);
        })();