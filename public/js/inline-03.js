      (function() {
        // 【性能】设置面板懒挂载：页面加载完成后把整个 .settings-modal（约 1500 节点）摘出 DOM 保存，
        // 首次打开（overlay 加 show 类）时再放回。摘除发生在所有模块绑定事件之后，
        // 监听器随节点保留，重新挂载后一切照常；未点开设置前这部分节点不参与排版。
        function _lazySettingsModal() {
          var overlay = document.getElementById('settingsOverlay');
          if (!overlay || overlay.__lazyDone) return;
          overlay.__lazyDone = true;
          var modal = overlay.querySelector('.settings-modal');
          if (!modal) return;
          overlay.__lazyModal = modal;
          overlay.__lazyPlaceholder = document.createComment('settings-modal-lazy');
          modal.parentNode.replaceChild(overlay.__lazyPlaceholder, modal);
          new MutationObserver(function() {
            if (overlay.classList.contains('show') && overlay.__lazyModal && !overlay.__lazyModal.parentNode) {
              overlay.__lazyPlaceholder.parentNode.replaceChild(overlay.__lazyModal, overlay.__lazyPlaceholder);
              // 【兜底】懒挂载放回后，自动触发模型配置面板挂载，避免首次打开看到空白
              setTimeout(function() {
                try {
                  var mount = document.getElementById('modelPanelMount');
                  if (mount && window.ModelConfigRewrite && typeof window.ModelConfigRewrite.mount === 'function'
                      && !mount.querySelector('[data-mc-wrap]')) {
                    window.ModelConfigRewrite.mount(mount);
                  }
                } catch (e) { console.warn('[懒挂载] 模型面板兜底挂载失败', e); }
              }, 0);
            }
          }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
        }
        if (document.readyState === 'complete') _lazySettingsModal();
        else window.addEventListener('load', _lazySettingsModal);
      })();