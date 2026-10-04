// ========== app-goal-panel.js - 右侧面板「🎯 长期目标」Tab ==========
// 数据源：project_record（private/记忆/*.md，隐私目录，HTTP 不可直读），按命名规则「长期目标-*.md」识别目标文件。
// 列出所有长期目标卡片，点击展开详情（愿景/挂载计划/焦点/规则/里程碑等原始 MD 渲染）。
(function() {
    window.App = window.App || {};
    var App = window.App;
    Object.assign(App, {
        _goalCache: [],          // [{name, content}]
        _goalExpanded: {},       // name -> bool

        _loadGoalPanel: function() {
            var self = this;
            var body = document.getElementById('goalPanelBody');
            if (!body) return;
            // 有缓存先渲染（秒开），再后台刷新
            if (self._goalCache && self._goalCache.length) {
                self._renderGoalPanel();
            }
            fetch('/api/tools/project_record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list' })
            }).then(function(r) { return r.json(); }).then(function(data) {
                var records = (data && data.records) || [];
                // 只取长期目标文件（命名规则：长期目标- 开头）
                var goalNames = records.filter(function(n) { return n.indexOf('长期目标-') === 0; });
                if (!goalNames.length) {
                    self._goalCache = [];
                    body.innerHTML = '<div class="tp-empty">暂无长期目标。<br>对智能体说「创建一个长期目标：...」即可。</div>';
                    return;
                }
                return fetch('/api/tools/project_record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'read', names: goalNames })
                }).then(function(r) { return r.json(); }).then(function(d2) {
                    self._goalCache = (d2 && d2.records) || [];
                    self._renderGoalPanel();
                });
            }).catch(function() {
                if (!self._goalCache || !self._goalCache.length) {
                    body.innerHTML = '<div class="tp-empty">长期目标加载失败</div>';
                }
            });
        },

        // 从目标 MD 中提取健康度
        _goalHealth: function(content) {
            var m = /健康度：\s*(\S+)/.exec(content || '');
            return m ? m[1] : '';
        },

        // 提取挂载的 plan_id 列表
        _goalPlans: function(content) {
            var ids = [], re = /(lp-\d{8}-\d{6})/g, m;
            while ((m = re.exec(content || '')) !== null) {
                if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
            }
            return ids;
        },

        _renderGoalPanel: function() {
            var self = this;
            var body = document.getElementById('goalPanelBody');
            if (!body) return;
            if (!self._goalCache || !self._goalCache.length) {
                body.innerHTML = '<div class="tp-empty">暂无长期目标。<br>对智能体说「创建一个长期目标：...」即可。</div>';
                return;
            }
            var html = '<div style="padding:8px 10px 4px;font-size:12px;color:var(--text-sub,#888);">长期目标（战争层 · MD 持久化于 private/记忆/长期目标-*.md，隐私目录）</div>';
            self._goalCache.forEach(function(g) {
                var name = g.name || '';
                var content = g.content || '';
                var expanded = !!self._goalExpanded[name];
                var health = self._goalHealth(content);
                var plans = self._goalPlans(content);
                // 标题：去掉「长期目标-」前缀
                var title = name.replace(/^长期目标-/, '');
                // 第一行 # 标题更友好
                var tm = /^#\s*(.+)$/m.exec(content);
                if (tm) title = tm[1].replace(/^🎯\s*/, '').replace(/^长期目标[:：]\s*/, '');
                html += '<div class="goal-card" data-goal="' + name + '" style="margin:6px 10px;padding:10px;border:1px solid var(--border,#ddd);border-radius:8px;background:var(--bg,#fff);">'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">'
                    + '<div style="font-weight:600;font-size:13px;flex:1;cursor:pointer;" class="goal-toggle">🎯 ' + title + '</div>'
                    + '<div style="font-size:11px;white-space:nowrap;">' + (health || '') + '</div>'
                    + '</div>';
                if (plans.length) {
                    html += '<div style="font-size:11px;color:var(--text-sub,#888);margin-top:3px;">挂载计划：' + plans.length + ' 个（' + plans.join('、') + '）</div>';
                }
                if (expanded) {
                    html += '<div class="goal-detail" style="margin-top:8px;border-top:1px dashed var(--border,#ddd);padding-top:8px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;color:var(--text,#333);">'
                        + self._goalRenderMd(content)
                        + '</div>';
                } else {
                    html += '<div style="margin-top:6px;"><button class="goal-toggle" style="font-size:12px;padding:3px 8px;border:1px solid var(--border,#555);border-radius:5px;background:transparent;color:var(--text,#333);cursor:pointer;">展开详情 ▾</button></div>';
                }
                html += '</div>';
            });
            body.innerHTML = html;
            // 绑定展开/收起
            body.querySelectorAll('.goal-toggle').forEach(function(el) {
                el.addEventListener('click', function() {
                    var card = el.closest('.goal-card');
                    if (!card) return;
                    var name = card.getAttribute('data-goal');
                    self._goalExpanded[name] = !self._goalExpanded[name];
                    self._renderGoalPanel();
                });
            });
        },

        // 轻量 MD 渲染：标题/列表/复选框/表格行/加粗，够看即可
        _goalRenderMd: function(md) {
            var esc = function(s) {
                return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            };
            var lines = String(md || '').split('\n');
            var out = [];
            lines.forEach(function(raw) {
                var line = esc(raw);
                // 加粗
                line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
                // 行内代码
                line = line.replace(/`([^`]+)`/g, '<code style="background:var(--bg-sub,#f4f4f4);padding:0 3px;border-radius:3px;">$1</code>');
                // 表格分隔行跳过
                if (/^\s*\|[-\s|:]+\|\s*$/.test(line)) return;
                // 表格行 → 等宽展示
                if (/^\s*\|.*\|\s*$/.test(line)) {
                    out.push('<div style="font-family:monospace;font-size:11px;">' + line.replace(/\|/g, ' │ ') + '</div>');
                    return;
                }
                var h = /^(#{1,4})\s+(.*)$/.exec(line);
                if (h) {
                    var sizes = { 1: '15px', 2: '14px', 3: '13px', 4: '12px' };
                    out.push('<div style="font-weight:700;font-size:' + sizes[h[1]] + ';margin:6px 0 2px;">' + h[2] + '</div>');
                    return;
                }
                // 复选框
                line = line.replace(/^\s*-\s*\[x\]\s*/i, '✅ ').replace(/^\s*-\s*\[ \]\s*/, '☐ ');
                if (/^\s*[-*]\s+/.test(raw)) {
                    out.push('<div style="padding-left:14px;">• ' + line.replace(/^\s*[-*]\s+/, '') + '</div>');
                    return;
                }
                if (!line.trim()) { out.push('<div style="height:4px;"></div>'); return; }
                out.push('<div>' + line + '</div>');
            });
            return out.join('');
        }
    });
})();
