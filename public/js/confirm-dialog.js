// ========== confirm-dialog.js - 自定义确认对话框（替代系统 confirm/alert） ==========
// 用法:
//   ConfirmDialog.confirm({ title, message, okText, cancelText, danger })
//     -> 返回 Promise<boolean>（true=确认, false=取消）
//   ConfirmDialog.alert({ title, message, okText })
//     -> 返回 Promise（点确定后 resolve）
//   ConfirmDialog.prompt({ title, message, value, placeholder, okText })
//     -> 返回 Promise<string|null>（null=取消）
(function() {
    'use strict';

    var overlay = null;
    var dialog = null;
    var currentResolve = null;

    function _ensureDom() {
        if (overlay && overlay.parentNode) return;
        overlay = document.createElement('div');
        overlay.className = 'zf-confirm-overlay';
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;' +
            'display:none;align-items:center;justify-content:center;' +
            'font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;';

        dialog = document.createElement('div');
        dialog.className = 'zf-confirm-dialog';
        dialog.style.cssText =
            'background:#2a2a3e;border-radius:12px;width:400px;max-width:90vw;' +
            'box-shadow:0 12px 48px rgba(0,0,0,.5);overflow:hidden;' +
            'animation:zfConfirmIn .18s ease-out;';
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 点击遮罩 = 取消（prompt 模式不允许误关）
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay && dialog.dataset.mode !== 'prompt') _close(false);
        });

        // 动画
        if (!document.getElementById('zf-confirm-style')) {
            var st = document.createElement('style');
            st.id = 'zf-confirm-style';
            st.textContent = '@keyframes zfConfirmIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}';
            document.head.appendChild(st);
        }
    }

    function _close(result) {
        if (!overlay) return;
        overlay.style.display = 'none';
        if (dialog) {
            dialog.innerHTML = '';
            dialog.dataset.mode = '';
        }
        var r = currentResolve;
        currentResolve = null;
        if (r) r(result);
        document.removeEventListener('keydown', _onKey);
    }

    function _onKey(e) {
        if (!overlay || overlay.style.display === 'none') return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            _close(dialog.dataset.mode === 'prompt' ? null : false);
        } else if (e.key === 'Enter' && dialog.dataset.mode !== 'prompt') {
            e.preventDefault();
            e.stopPropagation();
            _close(true);
        }
    }

    /**
     * 确认对话框
     * @param {object} opts { title, message, okText, cancelText, danger }
     * @returns {Promise<boolean>}
     */
    function confirmDialog(opts) {
        opts = opts || {};
        return new Promise(function(resolve) {
            _ensureDom();
            currentResolve = resolve;
            dialog.dataset.mode = 'confirm';

            var title = opts.title || '确认操作';
            var message = opts.message || '';
            var okText = opts.okText || '确定';
            var cancelText = opts.cancelText || '取消';
            var danger = !!opts.danger;

            dialog.innerHTML =
                '<div style="padding:18px 20px 14px;">' +
                    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
                        '<span style="font-size:20px;">' + (danger ? '⚠️' : '❓') + '</span>' +
                        '<span style="font-size:15px;font-weight:600;color:#e8e8f5;flex:1;">' + _esc(title) + '</span>' +
                    '</div>' +
                    '<div style="font-size:13px;color:#b8b8cc;line-height:1.7;white-space:pre-wrap;word-break:break-word;">' + _esc(message) + '</div>' +
                '</div>' +
                '<div style="padding:0 20px 18px;display:flex;justify-content:flex-end;gap:10px;">' +
                    '<button data-act="cancel" style="padding:7px 20px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#c8c8dc;font-size:13px;cursor:pointer;">' + _esc(cancelText) + '</button>' +
                    '<button data-act="ok" style="padding:7px 20px;border-radius:7px;border:none;' +
                        (danger
                            ? 'background:#e5484d;color:#fff;'
                            : 'background:#4f6ef7;color:#fff;') +
                        'font-size:13px;font-weight:600;cursor:pointer;">' + _esc(okText) + '</button>' +
                '</div>';

            dialog.querySelector('[data-act="ok"]').onclick = function() { _close(true); };
            dialog.querySelector('[data-act="cancel"]').onclick = function() { _close(false); };
            overlay.style.display = 'flex';
            document.addEventListener('keydown', _onKey);
            setTimeout(function() { dialog.querySelector('[data-act="ok"]').focus(); }, 30);
        });
    }

    /**
     * 提示对话框（单按钮）
     * @param {object} opts { title, message, okText }
     * @returns {Promise<true>}
     */
    function alertDialog(opts) {
        opts = opts || {};
        return new Promise(function(resolve) {
            _ensureDom();
            currentResolve = resolve;
            dialog.dataset.mode = 'alert';

            var title = opts.title || '提示';
            var message = opts.message || '';
            var okText = opts.okText || '知道了';

            dialog.innerHTML =
                '<div style="padding:18px 20px 14px;">' +
                    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
                        '<span style="font-size:20px;">💬</span>' +
                        '<span style="font-size:15px;font-weight:600;color:#e8e8f5;flex:1;">' + _esc(title) + '</span>' +
                    '</div>' +
                    '<div style="font-size:13px;color:#b8b8cc;line-height:1.7;white-space:pre-wrap;word-break:break-word;">' + _esc(message) + '</div>' +
                '</div>' +
                '<div style="padding:0 20px 18px;display:flex;justify-content:flex-end;">' +
                    '<button data-act="ok" style="padding:7px 24px;border-radius:7px;border:none;background:#4f6ef7;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">' + _esc(okText) + '</button>' +
                '</div>';

            dialog.querySelector('[data-act="ok"]').onclick = function() { _close(true); };
            overlay.style.display = 'flex';
            document.addEventListener('keydown', _onKey);
            setTimeout(function() { dialog.querySelector('[data-act="ok"]').focus(); }, 30);
        });
    }

    /**
     * 输入对话框（替代系统 prompt）
     * @param {object} opts { title, message, value, placeholder, okText, cancelText }
     * @returns {Promise<string|null>}
     */
    function promptDialog(opts) {
        opts = opts || {};
        return new Promise(function(resolve) {
            _ensureDom();
            currentResolve = resolve;
            dialog.dataset.mode = 'prompt';

            var title = opts.title || '请输入';
            var message = opts.message || '';
            var value = opts.value || '';
            var placeholder = opts.placeholder || '';
            var okText = opts.okText || '确定';
            var cancelText = opts.cancelText || '取消';

            dialog.innerHTML =
                '<div style="padding:18px 20px 14px;">' +
                    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
                        '<span style="font-size:20px;">✏️</span>' +
                        '<span style="font-size:15px;font-weight:600;color:#e8e8f5;flex:1;">' + _esc(title) + '</span>' +
                    '</div>' +
                    (message ? '<div style="font-size:13px;color:#b8b8cc;line-height:1.7;margin-bottom:10px;white-space:pre-wrap;">' + _esc(message) + '</div>' : '') +
                    '<input data-role="input" type="text" value="' + _escAttr(value) + '" placeholder="' + _escAttr(placeholder) + '" ' +
                        'style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.25);color:#e8e8f5;font-size:13px;outline:none;" />' +
                '</div>' +
                '<div style="padding:0 20px 18px;display:flex;justify-content:flex-end;gap:10px;">' +
                    '<button data-act="cancel" style="padding:7px 20px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#c8c8dc;font-size:13px;cursor:pointer;">' + _esc(cancelText) + '</button>' +
                    '<button data-act="ok" style="padding:7px 20px;border-radius:7px;border:none;background:#4f6ef7;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">' + _esc(okText) + '</button>' +
                '</div>';

            var input = dialog.querySelector('[data-role="input"]');
            dialog.querySelector('[data-act="ok"]').onclick = function() {
                var v = (input.value || '').trim();
                _close(v);
            };
            dialog.querySelector('[data-act="cancel"]').onclick = function() { _close(null); };
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var v = (input.value || '').trim();
                    _close(v);
                }
            });
            overlay.style.display = 'flex';
            document.addEventListener('keydown', _onKey);
            setTimeout(function() { input.focus(); input.select(); }, 30);
        });
    }

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _escAttr(s) { return _esc(s); }

    window.ConfirmDialog = {
        confirm: confirmDialog,
        alert: alertDialog,
        prompt: promptDialog
    };
})();
