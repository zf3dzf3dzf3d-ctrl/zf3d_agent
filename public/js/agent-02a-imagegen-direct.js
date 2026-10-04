// agent-02a-imagegen-direct.js — 免费生图模型直连处理（从 agent-02-loop-core.js 拆分）
// 功能单一：仅处理 model.imageGen 标记的免费生图模型请求。
// 返回 true=已拦截处理；false=非生图模型，继续正常流程。
Object.assign(App, {
        _handleImageGenDirect: function(box, chat, model, messages) {
            if (!model.imageGen) return false;

            var _lastUser = '';
            for (var i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') { _lastUser = messages[i].content; break; }
            }
            if (!_lastUser) _lastUser = 'a cute picture';
            var _sz = _lastUser.match(/(\d{3,4})\s*[xX×]\s*(\d{3,4})/);
            var _size = _sz ? (_sz[1] + 'x' + _sz[2]) : '1024x1024';
            var _preferredImageModel = '';
            try { _preferredImageModel = UserSettings.get('zf3d_image_model') || ''; } catch(e) {}
            // 【火山方舟优先】无手动偏好时：优先取模型配置中已配好密钥的 imageGen 模型（如 doubao-seedream-*），
            // 否则回退默认 poll-flux 免费渠道。
            var _autoArk = '';
            try {
                var _genList = (Models.list || []).filter(function(m) { return m.imageGen && m.modelId; });
                if (_genList.length) _autoArk = _genList[0].modelId;
            } catch(e1) {}
            var _ch = _preferredImageModel || model.modelId || _autoArk || 'poll-flux';
            var _imgMsg = '';
            var self2 = this; // this = App
            fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'generate', prompt: _lastUser, size: _size, model: _ch })
            }).then(function(r) { return r.json(); }).then(function(j) {
                var d = j.data || {};
                if (j.ok && d.url) {
                    var info = '\n\n- **模型**: ' + (d.channel_name || d.model) +
                               '\n- **尺寸**: ' + d.size +
                               '\n- **文件**: ' + d.bytes + ' 字节';
                    if (d.exhausted_today && d.exhausted_today.length) {
                        info += '\n- **今日额度已耗尽**: ' + d.exhausted_today.join(', ');
                    }
                    _imgMsg = '✅ 已生成\n\n![' + _lastUser.slice(0, 30).replace(/[\[\]()]/g, '') + '](' + d.url + ')' + info;
                } else {
                    _imgMsg = '❌ 生图失败: ' + (d.error || '未知错误') +
                              '\n\n> 可对 AI 说「查看生图渠道状态」或运行 image_gen 工具 (action=status)';
                }
                var box2 = box;
                var done = function() {
                    // 【修复】生图完成后移除残留的 typing 转圈指示器（_onSendComplete 不会清理它们）
                    try { box2.querySelectorAll('.msg.typing').forEach(function(t) { t.remove(); }); } catch(e0) {}
                    try { self2.addMsg(box2, _imgMsg, 'ai', chat.modelId, true); } catch(e) {
                        try { self2.addMsg(box2, _imgMsg, 'ai', chat.modelId, true); } catch(e2) {}
                    }
                    try { Store.addLog('info', chat.id, 'image-gen', '渠道=' + (d.channel || 'auto') + ' 尺寸=' + d.size); } catch(e) {}
                    // 🎨 画布式生图：创建独立图片节点 + 动态连线
                    if (j.ok && d.url && typeof App !== 'undefined' && App.createImageCanvasNode) {
                        try {
                            App.createImageCanvasNode(box2, d.url, _lastUser, { model: d.model || '', channel: d.channel_name || d.channel || '' });
                        } catch(imgE) { console.warn('[imagenode] createImageCanvasNode failed:', imgE); }
                    }
                    try { self2._onSendComplete(box2, chat); } catch(e) {}
                };
                done();
            }).catch(function(e) {
                _imgMsg = '❌ 生图请求异常: ' + e.message;
                // 【修复】异常时同样移除残留的 typing 转圈指示器
                try { box.querySelectorAll('.msg.typing').forEach(function(t) { t.remove(); }); } catch(e0) {}
                try { self2.addMsg(box, _imgMsg, 'ai', chat.modelId, true); } catch(e2) {}
                try { self2._onSendComplete(box, chat); } catch(e2) {}
            });
            return true; // 已拦截处理
        },
});
