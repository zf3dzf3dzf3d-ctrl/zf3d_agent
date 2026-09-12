// ========== app-memory-panel.js - 右侧面板「🧠 记忆」Tab ==========
// 数据源：project_record（private/记忆/，隐私目录，HTTP 不可直读）。
// 功能：分类浏览 / 排序（时间、名称）/ 全文搜索 / 行内展开阅读（MD 渲染）/
//       敏感分类（密码与账号）默认打码、确认后才加载明文 / 新增记忆 / 移动分类 / 删除。
(function() {
    window.App = window.App || {};
    var App = window.App;
    Object.assign(App, {
        _memItems: [],        // [{name, category, mtime, ts, size, sensitive}]
        _memTree: {},         // 分类 -> 数量
        _memCat: '全部',      // 当前分类
        _memSort: 'time',     // time | name
        _memSearch: '',
        _memSearchHits: null, // 搜索命中名单 Set
        _memExpanded: {},     // rel -> bool
        _memContent: {},      // rel -> md 内容（已加载的）
        _memUnlocked: {},     // rel -> true（敏感已解锁）
        _memAddOpen: false,

        _memApi: function(payload, cb) {
            fetch('/api/tools/project_record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function(r) { return r.json(); }).then(function(d) { cb(d || {}); })
              .catch(function() { cb({ ok: false, error: '网络错误' }); });
        },

        _loadMemoryPanel: function() {
            var self = this;
            var body = document.getElementById('memoryPanelBody');
            if (!body) return;
            if (!self._memBound) {
                self._memBindEvents(body);
                self._memBound = true;
            }
            if (self._memItems.length) self._memRender();   // 缓存秒开
            self._memApi({ action: 'list' }, function(d) {
                if (!d.ok) {
                    body.innerHTML = '<div class="tp-empty">记忆加载失败：' + (d.error || '') + '</div>';
                    return;
                }
                self._memItems = d.items || [];
                self._memTree = d.tree || {};
                self._memRender();
            });
        },

        _memCats: function() {
            var self = this;
            var fixed = ['密码与账号', '技能', '工作日志', '阶段总结', '长期目标',
                         '超长计划', '已归档长期目标', '已归档', '（根目录）'];
            var cats = [];
            fixed.forEach(function(c) {
                if (self._memTree[c] !== undefined) cats.push(c);
            });
            Object.keys(self._memTree).sort().forEach(function(c) {
                if (cats.indexOf(c) === -1) cats.push(c);
            });
            return cats;
        },

        _memRender: function() {
            var self = this;
            var body = document.getElementById('memoryPanelBody');
            if (!body) return;
            var html = '';

            // ---- 工具栏 ----
            html += '<div style="display:flex;gap:6px;align-items:center;padding:8px 10px 4px;flex-wrap:wrap;">'
                + '<input id="memSearchInput" type="text" value="' + self._esc(self._memSearch) + '" placeholder="🔍 搜索记忆..." '
                + 'style="flex:1;min-width:110px;padding:4px 8px;border:1px solid var(--border,#333344);border-radius:6px;background:var(--bg,#1e1e2e);color:var(--text,#fff);font-size:12px;outline:none;" />'
                + '<button id="memSortBtn" title="切换排序" style="padding:4px 8px;border:1px solid var(--border,#333344);border-radius:6px;background:var(--bg2,#252535);color:var(--text,#fff);cursor:pointer;font-size:12px;white-space:nowrap;">'
                + (self._memSort === 'time' ? '⏰ 时间' : '🔤 名称') + '</button>'
                + '<button id="memAddBtn" title="新增记忆" style="padding:4px 8px;border:1px solid var(--border,#333344);border-radius:6px;background:var(--bg2,#252535);color:var(--text,#fff);cursor:pointer;font-size:12px;">➕</button>'
                + '<button id="memRefreshBtn" title="刷新" style="padding:4px 8px;border:1px solid var(--border,#333344);border-radius:6px;background:var(--bg2,#252535);color:var(--text,#fff);cursor:pointer;font-size:12px;">⟳</button>'
                + '</div>';

            // ---- 新增表单 ----
            if (self._memAddOpen) {
                var opts = ['<option value="">（根目录）</option>'];
                self._memCats().forEach(function(c) {
                    if (c === '（根目录）') return;
                    opts.push('<option value="' + self._esc(c) + '">' + self._esc(c) + '</option>');
                });
                html += '<div style="margin:4px 10px;padding:8px;border:1px solid var(--border,#333344);border-radius:8px;background:var(--bg,#1e1e2e);">'
                    + '<div style="display:flex;gap:6px;margin-bottom:6px;">'
                    + '<select id="memAddCat" style="flex:1;padding:4px;border:1px solid var(--border,#333344);border-radius:6px;background:var(--bg,#1e1e2e);color:var(--text,#fff);font-size:12px;">' + opts.join('') + '</select>'
                    + '<input id="memAddName" type="text" placeholder="名称，如 github" style="flex:2;padding:4px 8px;border:1px solid var(--border,#333344);border-radius:6px;background:var(--bg,#1e1e2e);color:var(--text,#fff);font-size:12px;outline:none;" />'
                    + '</div>'
                    + '<textarea id="memAddContent" rows="4" placeholder="内容（支持 Markdown）..." style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--border,#333344);border-radius:6px;background:var(--bg,#1e1e2e);color:var(--text,#fff);font-size:12px;resize:vertical;outline:none;"></textarea>'
                    + '<div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end;">'
                    + '<button id="memAddSave" style="padding:4px 12px;border:none;border-radius:6px;background:var(--blue);color:#fff;cursor:pointer;font-size:12px;">保存</button>'
                    + '<button id="memAddCancel" style="padding:4px 12px;border:1px solid var(--border,#333344);border-radius:6px;background:transparent;color:var(--text,#fff);cursor:pointer;font-size:12px;">取消</button>'
                    + '</div></div>';
            }

            // ---- 分类 chips ----
            html += '<div style="display:flex;gap:5px;flex-wrap:wrap;padding:4px 10px 6px;">';
            var allCount = 0;
            Object.keys(self._memTree).forEach(function(c) { allCount += self._memTree[c]; });
            var chip = function(label, count, active, key) {
                return '<span data-memcat="' + self._esc(key) + '" style="cursor:pointer;padding:2px 8px;border-radius:10px;font-size:11px;'
                    + (active ? 'background:var(--blue);color:#fff;' : 'background:var(--bg2,#252535);color:var(--text-sub,#b8b8cc);border:1px solid var(--border,#333344);')
                    + '">' + label + (count !== null ? ' ' + count : '') + '</span>';
            };
            html += chip('全部', allCount, self._memCat === '全部', '全部');
            self._memCats().forEach(function(c) {
                var label = (c === '') ? '（根目录）' : c;
                label = (label === '密码与账号') ? '🔒 ' + label : label;
                html += chip(self._esc(label), self._memTree[c], self._memCat === c, c);
            });
            html += '</div>';

            // ---- 过滤 + 排序 ----
            var items = self._memItems.slice();
            if (self._memSearchHits) {
                items = items.filter(function(it) { return self._memSearchHits[it.name]; });
            } else if (self._memCat !== '全部') {
                items = items.filter(function(it) { return it.category === self._memCat; });
            }
            if (self._memSort === 'time') {
                items.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
            } else {
                items.sort(function(a, b) { return a.name.localeCompare(b.name, 'zh'); });
            }

            // ---- 列表 ----
            html += '<div style="padding:0 6px 10px;">';
            if (!items.length) {
                html += '<div class="tp-empty" style="padding:20px 10px;text-align:center;color:var(--text-sub,#b8b8cc);font-size:12px;">'
                    + (self._memSearchHits ? '未搜到包含「' + self._esc(self._memSearch) + '」的记忆' : '该分类暂无记忆') + '</div>';
            }
            items.forEach(function(it) {
                var rel = it.name;
                var open = !!self._memExpanded[rel];
                var base = rel.split('/').pop();
                var catTag = it.category ? '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--bg2,#252535);color:var(--text-sub,#b8b8cc);margin-left:4px;">' + self._esc(it.category) + '</span>' : '';
                var lock = it.sensitive ? ' 🔒' : '';
                html += '<div data-memitem="' + self._esc(rel) + '" style="margin:4px 4px;border:1px solid ' + (open ? 'var(--blue)' : 'var(--border,#333344)') + ';border-radius:8px;background:var(--bg,#1e1e2e);overflow:hidden;">'
                    + '<div data-memhead="' + self._esc(rel) + '" style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;">'
                    + '<div style="font-size:12.5px;font-weight:600;color:var(--text,#fff);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + lock + self._esc(base) + catTag + '</div>'
                    + '<div style="font-size:10.5px;color:var(--text-sub,#aaa);white-space:nowrap;">' + (it.mtime || '') + '</div>'
                    + '</div>';
                if (open) {
                    var c = self._memContent[rel];
                    if (c === undefined) {
                        html += '<div style="padding:8px 12px;font-size:12px;color:var(--text-sub,#b8b8cc);">加载中...</div>';
                    } else {
                        html += '<div style="padding:2px 12px 8px;font-size:12.5px;line-height:1.6;color:var(--text,#fff);overflow-wrap:break-word;">' + self._memMd(c) + '</div>'
                            + '<div data-memops="' + self._esc(rel) + '" style="display:flex;gap:6px;padding:0 10px 8px;flex-wrap:wrap;align-items:center;">'
                            + '<button data-memcopy="' + self._esc(rel) + '" style="padding:3px 8px;font-size:11px;border:1px solid var(--border,#333344);border-radius:5px;background:transparent;color:var(--text,#fff);cursor:pointer;">复制</button>'
                            + '<button data-memdel="' + self._esc(rel) + '" style="padding:3px 8px;font-size:11px;border:1px solid #e57373;border-radius:5px;background:transparent;color:#e57373;cursor:pointer;">删除</button>'
                            + '<select data-memmoveto="' + self._esc(rel) + '" style="padding:3px 6px;font-size:11px;border:1px solid var(--border,#333344);border-radius:5px;background:var(--bg,#1e1e2e);color:var(--text,#fff);">'
                            + '<option value="">移动到…</option>';
                        self._memCats().forEach(function(cat) {
                            if (cat === it.category) return;
                            var v = (cat === '（根目录）') ? '' : cat;
                            html += '<option value="' + self._esc(v) + '">' + self._esc(cat) + '</option>';
                        });
                        html += '</select></div>';
                    }
                }
                html += '</div>';
            });
            html += '</div>';

            body.innerHTML = html;

            // 重新聚焦搜索框（innerHTML 重建后焦点丢失）
            if (self._memSearch) {
                var si = document.getElementById('memSearchInput');
                if (si) {
                    si.focus();
                    si.setSelectionRange(si.value.length, si.value.length);
                }
            }
        },

        _memBindEvents: function(body) {
            var self = this;

            body.addEventListener('click', function(e) {
                var t = e.target;
                // 分类 chip
                var chip = t.closest ? t.closest('[data-memcat]') : null;
                if (chip) {
                    self._memCat = chip.getAttribute('data-memcat');
                    self._memSearch = ''; self._memSearchHits = null;
                    self._memRender();
                    return;
                }
                // 排序
                if (t.id === 'memSortBtn') {
                    self._memSort = (self._memSort === 'time') ? 'name' : 'time';
                    self._memRender();
                    return;
                }
                // 新增开关
                if (t.id === 'memAddBtn') {
                    self._memAddOpen = !self._memAddOpen;
                    self._memRender();
                    return;
                }
                if (t.id === 'memAddCancel') {
                    self._memAddOpen = false;
                    self._memRender();
                    return;
                }
                if (t.id === 'memAddSave') {
                    self._memSaveNew();
                    return;
                }
                // 刷新
                if (t.id === 'memRefreshBtn') {
                    self._loadMemoryPanel();
                    return;
                }
                // 复制
                var cp = t.getAttribute ? t.getAttribute('data-memcopy') : null;
                if (cp) {
                    var c = self._memContent[cp] || '';
                    if (navigator.clipboard) navigator.clipboard.writeText(c);
                    t.textContent = '已复制';
                    setTimeout(function() { t.textContent = '复制'; }, 1200);
                    return;
                }
                // 删除
                var del = t.getAttribute ? t.getAttribute('data-memdel') : null;
                if (del) {
                    if (confirm('确定删除记忆「' + del + '」？此操作不可恢复。')) {
                        self._memApi({ action: 'delete', name: del }, function(d) {
                            if (d.ok) {
                                delete self._memExpanded[del];
                                delete self._memContent[del];
                                self._loadMemoryPanel();
                            } else alert('删除失败：' + (d.error || ''));
                        });
                    }
                    return;
                }
                // 展开头部
                var head = t.closest ? t.closest('[data-memhead]') : null;
                if (head) {
                    var rel = head.getAttribute('data-memhead');
                    var it = null;
                    self._memItems.forEach(function(x) { if (x.name === rel) it = x; });
                    if (self._memExpanded[rel]) {
                        self._memExpanded[rel] = false;
                        self._memRender();
                        return;
                    }
                    if (it && it.sensitive && !self._memUnlocked[rel]) {
                        if (!confirm('🔒「' + rel.split('/').pop() + '」属于敏感分类（密码与账号）。\n\n显示明文？')) return;
                        self._memUnlocked[rel] = true;
                    }
                    self._memExpanded[rel] = true;
                    if (self._memContent[rel] === undefined) {
                        self._memRender(); // 先显示"加载中"
                        self._memApi({ action: 'read', name: rel }, function(d) {
                            if (d.ok) self._memContent[rel] = d.content || '';
                            else self._memContent[rel] = '> 加载失败：' + (d.error || '');
                            self._memRender();
                        });
                    } else {
                        self._memRender();
                    }
                    return;
                }
                // 移动
                var sel = t.tagName === 'SELECT' ? t : null;
                if (sel && sel.getAttribute('data-memmoveto')) {
                    return; // change 事件处理
                }
            });

            body.addEventListener('change', function(e) {
                var t = e.target;
                var to = t.getAttribute ? t.getAttribute('data-memmoveto') : null;
                if (to !== null && to !== undefined) {
                    if (to === '') return; // 未选择
                    var rel = to; // 注意：value 是目标分类，需要拿条目名
                    var holder = t;   // select 本身带 data-memmoveto=rel
                    rel = t.getAttribute('data-memmoveto');
                    var base = rel.split('/').pop();
                    var dst = to ? to + '/' + base : base;
                    self._memApi({ action: 'move', from: rel, to: dst }, function(d) {
                        if (d.ok) {
                            delete self._memExpanded[rel];
                            delete self._memContent[rel];
                            self._loadMemoryPanel();
                        } else alert('移动失败：' + (d.error || ''));
                    });
                }
            });

            // 搜索（防抖）
            body.addEventListener('input', function(e) {
                if (e.target.id !== 'memSearchInput') return;
                var kw = e.target.value.trim();
                clearTimeout(self._memSearchTimer);
                self._memSearchTimer = setTimeout(function() {
                    self._memSearch = kw;
                    if (!kw) { self._memSearchHits = null; self._memRender(); return; }
                    self._memApi({ action: 'search', keyword: kw }, function(d) {
                        if (d.ok) {
                            var set = {};
                            (d.records || []).forEach(function(n) { set[n] = true; });
                            self._memSearchHits = set;
                            self._memRender();
                        }
                    });
                }, 300);
            });
        },

        _memSaveNew: function() {
            var self = this;
            var cat = document.getElementById('memAddCat');
            var name = document.getElementById('memAddName');
            var content = document.getElementById('memAddContent');
            if (!name || !name.value.trim()) { alert('请填写名称'); return; }
            var payload = {
                action: 'write',
                name: name.value.trim(),
                category: cat ? cat.value : '',
                content: content ? content.value : ''
            };
            self._memApi(payload, function(d) {
                if (d.ok) {
                    self._memAddOpen = false;
                    self._loadMemoryPanel();
                } else alert('保存失败：' + (d.error || ''));
            });
        },

        _memMd: function(text) {
            try {
                if (window.marked && window.marked.parse) return window.marked.parse(text);
                if (window.marked) return window.marked(text);
            } catch (e) {}
            return '<pre style="white-space:pre-wrap;margin:0;">' + this._esc(text) + '</pre>';
        },

        _esc: function(s) {
            return String(s === undefined || s === null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
    });
})();

