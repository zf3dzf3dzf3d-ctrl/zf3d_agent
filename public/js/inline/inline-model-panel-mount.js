
      (function() {
        // 模型配置面板挂载：当 settings 打开时调 App.renderModelPanel 渲染到 #modelPanelMount
        function _mountModelPanel() {
          var mount = document.getElementById('modelPanelMount');
          if (mount && window.App && App.renderModelPanel) {
            App.renderModelPanel(mount);
          }
        }
        // 打开 settingsOverlay 时挂载
        function _wireSettingsOpen() {
          var overlay = document.getElementById('settingsOverlay');
          if (overlay) {
            var obs = new MutationObserver(function() {
              if (overlay.classList.contains('active') || overlay.style.display === 'block') {
                _mountModelPanel();
              }
            });
            obs.observe(overlay, { attributes: true, attributeFilter: ['class','style'] });
          }
          var sBtn = document.getElementById('settingsBtn');
          if (sBtn) sBtn.addEventListener('click', function() {
            setTimeout(_mountModelPanel, 60);
          });
          var mBtn = document.getElementById('status-model-trigger');
          if (mBtn) mBtn.addEventListener('click', function() {
            setTimeout(_mountModelPanel, 60);
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', _wireSettingsOpen);
        } else {
          _wireSettingsOpen();
        }
        // 设置弹窗左侧菜单宽度拖拽（记住到 user_settings.json）
        function _initSettingsNavResize() {
          var overlay = document.getElementById('settingsOverlay');
          var nav = document.getElementById('settingsNav');
          var handle = document.getElementById('settingsNavResize');
          if (!overlay || !nav || !handle || handle.dataset.bound === '1') return;
          handle.dataset.bound = '1';
          var MIN = 120, MAX = Math.floor(window.innerWidth * 0.4);
          function apply(w) {
            w = Math.max(MIN, Math.min(MAX, w));
            overlay.style.setProperty('--settings-nav-width', w + 'px');
            return w;
          }
          var saved = parseInt(window.UserSettings && UserSettings.get('settingsNavWidth'), 10);
          if (Number.isFinite(saved)) apply(saved);
          var dragging = false;
          handle.addEventListener('pointerdown', function(e) {
            dragging = true;
            handle.classList.add('is-dragging');
            handle.setPointerCapture(e.pointerId);
            e.preventDefault();
          });
          handle.addEventListener('pointermove', function(e) {
            if (!dragging) return;
            var rect = overlay.getBoundingClientRect();
            apply(e.clientX - rect.left);
          });
          function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('is-dragging');
            if (handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
            var w = parseInt(getComputedStyle(nav).width, 10);
            if (window.UserSettings) UserSettings.set('settingsNavWidth', String(w));
          }
          handle.addEventListener('pointerup', endDrag);
          handle.addEventListener('pointercancel', endDrag);
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', _initSettingsNavResize);
        } else {
          _initSettingsNavResize();
        }
      })();
    