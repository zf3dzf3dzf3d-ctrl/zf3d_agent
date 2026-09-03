// ========== panel-mail.js - 邮件通知配置 ==========
// 拆分自 app-panels.js（原 1343~1436 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 邮件通知配置 =====
        loadEmailConfig: function() {
            var self = this;
            fetch('/api/tools/send_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'get_config' })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.ok && data.config) {
                    var cfg = data.config;
                    document.getElementById('email-enabled').checked = !!cfg.enabled;
                    document.getElementById('email-smtp-host').value = cfg.smtp_host || '';
                    document.getElementById('email-smtp-port').value = cfg.smtp_port || 465;
                    document.getElementById('email-use-ssl').value = String(cfg.use_ssl !== false);
                    document.getElementById('email-smtp-user').value = cfg.smtp_user || '';
                    document.getElementById('email-smtp-pass').value = (cfg.smtp_pass && cfg.smtp_pass.indexOf('•') >= 0) ? '' : (cfg.smtp_pass || '');
                    document.getElementById('email-to').value = cfg.to_email || '';
                    document.getElementById('email-from-name').value = cfg.from_name || '';
                    self._updateEmailToggle();
                } else {
                    // No config yet, set defaults
                    document.getElementById('email-smtp-host').value = 'smtp.qq.com';
                    document.getElementById('email-smtp-port').value = '465';
                    document.getElementById('email-use-ssl').value = 'true';
                    document.getElementById('email-from-name').value = '';
                }
                self._updateEmailToggle();
            }).catch(function(err) {
                console.warn('Load email config failed:', err);
            });
        },

        saveEmailConfig: function() {
            var cfg = {
                enabled: document.getElementById('email-enabled').checked,
                smtp_host: document.getElementById('email-smtp-host').value.trim(),
                smtp_port: parseInt(document.getElementById('email-smtp-port').value) || 465,
                use_ssl: document.getElementById('email-use-ssl').value === 'true',
                smtp_user: document.getElementById('email-smtp-user').value.trim(),
                smtp_pass: document.getElementById('email-smtp-pass').value.trim(),
                to_email: document.getElementById('email-to').value.trim(),
                from_name: document.getElementById('email-from-name').value.trim() || 'AI Agent'
            };
            var result = document.getElementById('emailTestResult');
            if (result) { result.innerHTML = '<span style="color:var(--text2)">正在保存...</span>'; }
            fetch('/api/tools/send_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save_config', config: cfg })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.ok) {
                    if (result) { result.innerHTML = '<span style="color:#4caf50">✓ ' + (data.message || '已保存') + '</span>'; }
                } else {
                    if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (data.error || '操作失败') + '</span>'; }
                }
            }).catch(function(err) {
                if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (err.message || '网络错误') + '</span>'; }
            });
        },

        testEmail: function() {
            var result = document.getElementById('emailTestResult');
            if (result) { result.innerHTML = '<span style="color:var(--text2)">正在发送测试邮件...</span>'; }
            fetch('/api/tools/send_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'test' })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.ok) {
                    if (result) { result.innerHTML = '<span style="color:#4caf50">✓ ' + (data.message || '已发送') + '</span>'; }
                } else {
                    if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (data.error || '操作失败') + '</span>'; }
                }
            }).catch(function(err) {
                if (result) { result.innerHTML = '<span style="color:#f44336">✗ ' + (err.message || '网络错误') + '</span>'; }
            });
        },

        _updateEmailToggle: function() {
            var cb = document.getElementById('email-enabled');
            if (!cb) return;
            var field = cb.closest ? cb.closest('.email-toggle-field') : null;
            var track = cb.parentElement.querySelector('.email-toggle-track');
            if (cb.checked) {
                if (field) field.classList.add('on');
                if (track) track.classList.add('active');
            } else {
                if (field) field.classList.remove('on');
                if (track) track.classList.remove('active');
            }
        },


});
