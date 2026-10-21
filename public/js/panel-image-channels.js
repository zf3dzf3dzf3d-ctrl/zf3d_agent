// ========== panel-image-channels.js - 生图渠道管理 ==========
// 拆分自 app-panels.js（原 494~661 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 渲染生图渠道状态列表（官网直达 + 免费积分入口）=====
        renderImageChannels: function() {
            var panel = document.getElementById('image-channels-panel');
            if (!panel) return;
            panel.innerHTML = '<div style="font-size:12px;color:var(--text2);">加载渠道状态中…</div>';
            var self = this;
            fetch('/api/image-gen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) })
                .then(function(res) { return res.json(); })
                .then(function(raw) {
                    var data = raw && raw.data ? raw.data : raw;
                    if (!data || !data.channels || !data.channels.length) {
                        panel.innerHTML = '<div style="font-size:12px;color:var(--text2);">未获取到渠道状态。</div>';
                        return;
                    }
                    var html = '';
                    data.channels.forEach(function(ch) {
                        html += self._channelCardHtml(ch);
                    });
                    panel.innerHTML = html + '<div style="font-size:11px;color:var(--text2);margin-top:2px;">' +
                        '今日共生成 ' + (data.total_today || 0) + ' 张 · ' + (data.hint || '') + '</div>';
                    panel.querySelectorAll('.ch-refresh').forEach(function(b) {
                        b.onclick = function() { self.renderImageChannels(); };
                    });
                })
                .catch(function() {
                    panel.innerHTML = '<div style="font-size:12px;color:#e06c75;">渠道状态加载失败（后端未启动 image-gen 路由？）</div>';
                });
        },

        _channelCardHtml: function(ch) {
            // 匹配 Models.list 拿官方URL
            var officialUrl = '';
            if (typeof Models !== 'undefined') {
                var m = (Models.list || []).filter(function(x) { return x.imageGen && (x.modelId === ch.id || x.modelId === ch.model); })[0];
                if (m && m.officialUrl) officialUrl = m.officialUrl;
            }
            // 状态徽标
            var badge, badgeColor;
            if (ch.exhausted_today) { badge = '今日额度已耗尽'; badgeColor = '#e06c75'; }
            else if (ch.cooldown_left > 0) { badge = '冷却中 ' + Math.ceil(ch.cooldown_left / 60) + ' 分钟'; badgeColor = '#e5c07b'; }
            else if (!ch.ready) { badge = '缺 Key 未启用'; badgeColor = '#7f8c8d'; }
            else if (ch.daily_free) { badge = '每日免费额度'; badgeColor = '#61afef'; }
            else { badge = '可用'; badgeColor = '#98c379'; }
            var usage = ch.daily_free ? ('今日已用 ' + (ch.used_today || 0) + ' 次') : (ch.ready ? '免费无 Key' : '需 API Key');
            // 该渠道是否需要填 Key（pollinations 免费渠道无需）
            var needKey = (String(ch.provider || '') !== 'pollinations');
            var freeBtn = '';
            if (ch.provider === 'zhipu') freeBtn = '<a class="btn ghost" href="https://open.bigmodel.cn/usercenter/apikeys" target="_blank" rel="noopener noreferrer" style="font-size:11px;">🎁 领免费积分</a>';
            else if (ch.provider === 'siliconflow') freeBtn = '<a class="btn ghost" href="https://siliconflow.cn/pricing" target="_blank" rel="noopener noreferrer" style="font-size:11px;">🎁 领免费额度</a>';
            else if (ch.provider === 'miaomio') freeBtn = '<a class="btn ghost" href="https://miaomio.net/" target="_blank" rel="noopener noreferrer" style="font-size:11px;">🎁 官网领积分</a>';
            // Key 输入行（复用文字模型的 mi-keyrow 防自动填充结构，左侧密匙文字提示）
            var keyRow = '';
            if (needKey) {
                var ph = ch.ready ? '已填密钥（留空保持不变）' : '输入API密钥';
                keyRow = '<div class="mi-keyrow" style="margin-top:8px;width:100%;">' +
                    '<span class="mi-key-label">密匙</span>' +
                    '<form onsubmit="return false" style="display:flex;flex:1 1 auto;min-width:0;align-items:center;">' +
                        '<input type="text" name="username" autocomplete="username" aria-label="Username" tabindex="-1" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">' +
                        '<input type="password" data-imgkey-input="' + ch.id + '" placeholder="' + ph + '" autocomplete="new-password" name="imgapikey_' + Math.random().toString(36).slice(2,9) + '" readonly onfocus="this.removeAttribute(\'readonly\');this.value=\'\';" style="width:100%;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);outline:none;" />' +
                    '</form>' +
                '</div>';
            }
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);flex-wrap:wrap;">' +
                '<span style="width:10px;height:10px;border-radius:50%;background:' + badgeColor + ';flex-shrink:0;" title="' + badge + '"></span>' +
                '<div style="flex:1;min-width:150px;">' +
                    '<div style="font-size:13px;font-weight:600;color:var(--text);">' + String(ch.name || ch.id).replace(/[<>&]/g, function(c) { return ({'<':'&lt;','>':'&gt;','&':'&amp;'})[c]; }) + '</div>' +
                    '<div style="font-size:11px;color:var(--text2);margin-top:2px;">' + badge + ' · ' + usage + '</div>' +
                    '<div style="font-size:11px;color:var(--text3);margin-top:2px;">' + (ch.model || '') + '</div>' +
                '</div>' +
                (officialUrl ? '<a class="btn ghost" href="' + officialUrl + '" target="_blank" rel="noopener noreferrer" style="font-size:11px;">直达官网</a>' : '') +
                freeBtn +
                keyRow +
                (needKey ? '<div class="mi-actions" style="width:100%;justify-content:flex-start;">' +
                    '<button class="btn ghost" onclick="App.saveImageChannelKey(&#39;' + ch.id + '&#39;)">保存</button>' +
                    '<button class="btn ghost" onclick="App.clearImageChannelKey(&#39;' + ch.id + '&#39;)">清除</button>' +
                    '</div>' +
                    '<div class="test-result" data-imgtest-result="' + ch.id + '"></div>' : '') +
                '</div>';
        },

        // ===== 保存生图渠道密钥（写入 private/image_gen_keys.json）=====
        saveImageChannelKey: function(id) {
            var container = document.getElementById('image-channels-panel') || document;
            var inp = container.querySelector('[data-imgkey-input="' + id + '"]');
            var result = container.querySelector('[data-imgtest-result="' + id + '"]');
            var setResult = function(html) { if (result) result.innerHTML = html; };
            if (!inp) return;
            var val = (inp.value || '').trim();
            var provider = id;  // 后端 set_key 支持按渠道 id 解析 provider
            if (!val) { setResult('<span class="err">✗ 请先输入 API 密钥再保存</span>'); return; }
            if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('info', id, 'imgkey', '保存生图渠道密钥: ' + id);
            setResult('<span class="muted">保存中…</span>');
            var that = this;
            fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_key', provider: provider, key: val })
            }).then(function(r) { return r.json(); }).then(function(res) {
                if (res && res.ok) {
                    setResult('<span class="ok">✓ 密钥已保存</span>');
                    that.renderImageChannels();
                    // 立即触发一次连通测试
                    setTimeout(function() { that.testImageChannel(id); }, 300);
                } else {
                    var msg = (res && res.data && res.data.error) ? res.data.error : '密钥保存失败';
                    setResult('<span class="err">✗ ' + msg + '</span>');
                }
            }).catch(function(e) {
                setResult('<span class="err">✗ 保存失败: ' + e + '</span>');
            });
        },

        // ===== 清除生图渠道密钥 =====
        clearImageChannelKey: async function(id) {
            var container = document.getElementById('image-channels-panel') || document;
            var result = container.querySelector('[data-imgtest-result="' + id + '"]');
            var setResult = function(html) { if (result) result.innerHTML = html; };
            var ok = await ConfirmDialog.confirm({
                title: '清除生图密钥',
                message: '确定清除该生图渠道已保存的密钥吗？清除后必须重新填写并保存才能连接。',
                okText: '清除', danger: true
            });
            if (!ok) return;
            if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('warn', id, 'imgkey', '清除生图渠道密钥: ' + id);
            var that = this;
            fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'clear_key', provider: id })
            }).then(function(r) { return r.json(); }).then(function(res) {
                if (res && res.ok) {
                    setResult('<span class="ok">✓ 密钥已清除</span>');
                    that.renderImageChannels();
                } else {
                    var msg = (res && res.data && res.data.error) ? res.data.error : '清除失败';
                    setResult('<span class="err">✗ ' + msg + '</span>');
                }
            }).catch(function(e) {
                setResult('<span class="err">✗ 清除失败: ' + e + '</span>');
            });
        },

        // ===== 测试生图渠道连通性（走一次真实生图）=====
        testImageChannel: function(id) {
            var container = document.getElementById('image-channels-panel') || document;
            var result = container.querySelector('[data-imgtest-result="' + id + '"]');
            var setResult = function(html) { if (result) result.innerHTML = html; };
            setResult('<span class="muted">连通测试中…（约需几秒）</span>');
            if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('info', id, 'imgtest', '测试生图渠道: ' + id);
            var that = this;
            fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'generate', channel: id, prompt: 'test', nolog: true })
            }).then(function(r) { return r.json(); }).then(function(res) {
                if (res && res.ok && (res.data && (res.data.url || res.data.image || res.data.b64))) {
                    setResult('<span class="ok">✓ 连通正常（已成功生成测试图）</span>');
                } else {
                    var msg = (res && res.data && res.data.error) ? res.data.error : '测试失败';
                    setResult('<span class="err">✗ 测试失败: ' + msg + '</span>');
                }
                that.renderImageChannels();
            }).catch(function(e) {
                setResult('<span class="err">✗ 测试失败: ' + e + '</span>');
            });
        },
});
