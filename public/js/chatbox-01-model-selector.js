// ==== 拆分自 app-chatbox.js：底部模型选择器（增强版下拉）_拖拽头部排除区域_刷新所有已存在对_仅移动摄像机到指_获取对话框状态（_更新状态指示（标_摄像机聚焦到指定_设置导航箭头_查找相邻对话（d_统计左右两侧符合_更新单个对话框的_更新所有对话框的 ====
Object.assign(App, {
        // ===== 底部模型选择器（增强版下拉） =====
        // 功能：1) 搜索/切换模型线路 2) 本对话模型ID覆盖 3) 思考强度（off/low/medium/high）
        _initModelPicker: function(box, chat) {
            var self = this;
            var wrap = box.querySelector('.model-picker-wrap');
            if (!wrap) return;
            var btn = wrap.querySelector('.model-picker-btn');
            // 【浮层兼容】菜单打开期间会被临时搬去 document.body（见下方 mpMount），
            // 此时 wrap.querySelector 取不到，需按归属标记从 body 找回，保证重复绑定不失效
            if (!box.dataset.mpKey) box.dataset.mpKey = 'mp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            var menu = wrap.querySelector('.model-picker-menu') ||
                document.querySelector('.model-picker-menu.mp-floating[data-mp-for="' + box.dataset.mpKey + '"]');
            var lineSelect = menu ? menu.querySelector('.mp-line-select') : null;
            var modelidInput = menu ? menu.querySelector('.mp-modelid-input') : null;
            if (modelidInput) modelidInput.style.colorScheme = 'dark';
            var reInput = menu ? menu.querySelector('.mp-re-input') : null;
            if (!btn || !menu || !lineSelect) return;

            // ---- 内部工具：当前模型实际生效的 modelId（覆盖优先） ----
            function effModelId() {
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                return (chat._modelIdOverride || (m && m.modelId) || '');
            }

            // ---- 内部工具：当前生效思考强度 ----
            function curReasoning() {
                if (chat._reasoningEffort) return chat._reasoningEffort;
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                return (m && m.reasoningEffort) || ReasoningLevels.defaultValue();
            }

            // ---- 【分层记忆】分类→线路→模型ID 各自独立记住用户的模型ID/思考强度，互不串台 ----
            // 结构：modelSelectionMemory[分类][线路id] = { modelIdOverride, reasoningEffort, ts }
            function memGet() {
                try { return (window.UserSettings && UserSettings.get && UserSettings.get('modelSelectionMemory', null)) || {}; } catch (e) { return {}; }
            }
            function memSave(cat, lineId, idOverride, effort) {
                try {
                    if (!window.UserSettings || !UserSettings.set || !lineId) return;
                    var mem = memGet();
                    var c = mem[cat] = mem[cat] || {};
                    var l = c[lineId] = c[lineId] || {};
                    if (idOverride !== undefined) l.modelIdOverride = String(idOverride || '');
                    if (effort !== undefined) l.reasoningEffort = String(effort || '');
                    l.ts = Date.now();
                    UserSettings.set('modelSelectionMemory', mem);
                } catch (e) {}
            }
            function memLoad(cat, lineId) {
                var mem = memGet();
                return (mem[cat] && mem[cat][lineId]) || null;
            }
            // 初始化恢复：把当前分类+线路记忆中的模型ID/思考强度写回 chat 状态
            function memRestore() {
                try {
                    var cat = chat._mpCategory || 'language';
                    var lineId = chat.modelId || '';
                    if (!lineId) return;
                    var rec = memLoad(cat, lineId);
                    if (!rec) return;
                    if (rec.modelIdOverride) chat._modelIdOverride = rec.modelIdOverride;
                    if (rec.reasoningEffort) chat._reasoningEffort = rec.reasoningEffort;
                } catch (e) {}
            }

            // ---- 内部工具：刷新按钮显示 ----
            function refreshBtn() {
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                // 【Bug修复】已禁用(enabled:false)的模型按"未选择模型"处理，按钮不再显示已下线模型名
                if (m && m.enabled === false) m = null;
                var nameEl = btn.querySelector('.model-picker-name');
                if (!m) {
                    btn.querySelector('.model-picker-name').textContent = '未选择模型';
                } else {
                    var fullName = m.name || m.modelId || '未命名';
                    var label = String(fullName).substring(0, 4);
                    if (nameEl) nameEl.textContent = label;
                    var re = curReasoning();
                    var mid = chat._modelIdOverride || m.modelId || '';
                    btn.title = '模型线路: ' + fullName + '\n模型 ID: ' + mid + '\n思考强度: ' + re + '\n点击修改';
                }
                // 刷新三个下拉框
                renderCats();
                renderLineSelect();
                renderModelIdSelect();
                renderReSelect();
            }
            chat._refreshModelPickerBtn = refreshBtn;
            // 初始化时也恢复一次该分类的记忆（不等用户打开菜单）
            memRestore();
            refreshBtn();

            // ---- 渲染大模型下拉（第一列） ----
            function renderLineSelect() {
                var html = '';
                var cat = chat._mpCategory || 'language';
                // 【语音不作为分类】语音模型不需要在选择器里列出，若记忆停留在语音分类则回落到语言
                if (cat === 'speech' || cat === 'audio' || cat === 'omni') { cat = 'language'; chat._mpCategory = 'language'; }
                // 【按分类记忆】各分类独立保存上次选择，互不覆盖：
                // 当前分类优先显示本对话正在生效的模型（若属于本分类，初始语言模型即走此分支），
                // 否则显示该分类记忆中的模型；仍没有时按【三级默认规则】自动选中：
                // ① 朱峰官方推荐（官网下发默认）→ ② 本地默认 → ③ 列表第一个，绝不留空占位。
                var _mem = chat._mpCatModels || {};
                var _curM = chat.modelId ? Models.get(chat.modelId) : null;
                var selId = (_curM && mpCatsMatch(_curM, cat)) ? chat.modelId
                          : ((_mem[cat] && Models.get(_mem[cat])) ? _mem[cat] : '');
                // 【统一口径】复用 models.js 的 isZfOfficial（含 keyRef/端点判定），不再各自维护窄口径
                var isZf = (typeof Models !== 'undefined' && Models.isZfOfficial) ? Models.isZfOfficial : function(m) { return m.zfManaged || m.zfPinned || m.zfLine; };
                // 朱峰官方管理模型始终置顶，其余排在后面
                // 【语音分类只显示朱峰官方】语音/音频分类下列出非官方第三方语音模型没有意义，直接过滤
                var all = Models.list.filter(function(m) {
                    if (m.visible === false) return false;
                    if (cat === 'speech' && !isZf(m)) return false;
                    if (!isZf(m)) {
                        // 【本地模型按分类归位】非朱峰官方线路也走 mpCatsMatch 按分类匹配，
                        // 语言类 modelType（language/text/chat/空）只归入语言分类，
                        // model3d 等其他类型按各自分类显示，不再被统一排除（修复3D分类无模型）
                        // 【修复】本地识图/生图模型不再一刀切排除，按分类匹配归位（识图 tab 才显示 visionInput 模型）
                        if (m.imageGen || m.visionInput) return mpCatsMatch(m, cat);
                        if ((m.endpoint || m.baseUrl || '').toLowerCase().indexOf('/images/') !== -1) return cat === 'vision';
                        var t = String(m.modelType || '').toLowerCase();
                        if (t === 'language' || t === 'text' || t === 'chat' || t === '') return cat === 'language';
                        return mpCatsMatch(m, cat);
                    }
                    return mpCatsMatch(m, cat);
                });
                var zf = all.filter(isZf);
                var rest = all.filter(function(m) { return !isZf(m); });
                // 🔗 外部线路分组（_source=external，与朱峰线/自定义线三区隔离）
                var ext = rest.filter(function(m) { return m._source === 'external'; });
                rest = rest.filter(function(m) { return m._source !== 'external'; });
                var list = zf.concat(ext, rest);
                // 【三级默认规则】当前分类无生效模型、无分类记忆时，自动选中而不是留空：
                // ① 朱峰官方推荐（官网下发默认，getDefaultFor 已按 官方→本地 顺序解析）→ ② 本地 isDefault 默认 → ③ 列表第一个。
                // 仅影响下拉显示，不改写 chat.modelId/分类记忆；候选必须属于本分类（防识图/图片类型串台）。
                if (!selId && list.length) {
                    var _def = null;
                    try { _def = (typeof Models.getDefaultFor === 'function') ? Models.getDefaultFor(cat) : null; } catch (eDef) { _def = null; }
                    // getDefaultFor 归一 types_vision/vision，可能返回另一分类的模型 → 必须在本分类可见列表内才采纳
                    if (_def && !list.some(function(m) { return m.id === _def.id; })) _def = null;
                    if (_def) {
                        selId = _def.id; // ① 朱峰官方推荐（官网默认），无官方默认时 getDefaultFor 返回本地默认
                    } else {
                        // ① 本分类内的朱峰官方 isDefault（getDefaultFor 跨分类失配时的分类内兜底）
                        var _zfDef = list.find(function(m) { return isZf(m) && m.isDefault; });
                        // ② 本地 isDefault 默认
                        var _locDef = _zfDef || list.find(function(m) { return m.isDefault; });
                        selId = _locDef ? _locDef.id : list[0].id; // ② 本地默认 / ③ 第一个
                    }
                }
                // 【严格选项】当前分类记忆/生效模型不属于本分类可见列表时作废，防止显示不存在的模型；
                // 作废后显式回落到三级默认（与上方默认规则同源），保证 select 显示值与 chat.modelId 一致
                if (selId && !list.some(function(m) { return m.id === selId; })) selId = '';
                if (!selId && list.length) selId = list[0].id;
                // 【修复】三级默认/回落选中的线路必须写回分类记忆，否则第二列 mpCurLine()
                // 读不到该分类的线路，会错误显示「（未选择模型）」（切分类后首列有值、二列空白的根因）
                if (selId) {
                    chat._mpCatModels = chat._mpCatModels || {};
                    if (chat._mpCatModels[cat] !== selId) chat._mpCatModels[cat] = selId;
                }
                // 【数量为0】该分类没有任何可见模型时，下拉选项直接为空，不再显示占位项
                if (!list.length) {
                    lineSelect.style.colorScheme = 'dark';
                    lineSelect.innerHTML = '';
                    return;
                }
                var darkOpt = ' style="background:transparent;color:#c9d1d9;"';
                if (zf.length) {
                    html += '<optgroup label="⭐ 朱峰官方" style="background:transparent;color:#e6b800;">';
                    zf.forEach(function(m) {
                        var sel = (m.id === (selId || chat.modelId)) ? ' selected' : '';
                        var mid = m.modelId || '';
                        html += '<option value="' + m.id + '"' + sel + darkOpt + '>⚡ ' + (m.name || mid) + '</option>';
                    });
                    html += '</optgroup>';
                }
                if (ext.length && cat !== 'speech') {
                    html += '<optgroup label="🔗 外部线路" style="background:transparent;color:#7ee787;">';
                    ext.forEach(function(m) {
                        var sel = (m.id === (selId || chat.modelId)) ? ' selected' : '';
                        var mid = m.modelId || '';
                        html += '<option value="' + m.id + '"' + sel + darkOpt + ' title="外部线路模型ID: ' + mid + '">🔗 ' + (m.name || mid) + '</option>';
                    });
                    html += '</optgroup>';
                }
                if (rest.length && cat !== 'speech') {
                    html += '<optgroup label="其他线路" style="background:transparent;color:#c9d1d9;">';
                    rest.forEach(function(m) {
                        var sel = (m.id === (selId || chat.modelId)) ? ' selected' : '';
                        var mid = m.modelId || '';
                        var re = m.reasoningEffort || '默认';
                        html += '<option value="' + m.id + '"' + sel + darkOpt + ' title="模型ID: ' + mid + ' | 思考强度: ' + re + '">' + (m.name || m.modelId || '未命名') + '</option>';
                    });
                    html += '</optgroup>';
                }
                // 【暗色下拉】select 级 color-scheme: dark，让浏览器原生弹层（含 optgroup 分组标题）整体变暗
                lineSelect.style.colorScheme = 'dark';
                lineSelect.innerHTML = html;
            }

            // ---- \u5206\u7c7b\u5339\u914d\uff1a\u6309 modelType \u5f52\u7c7b\uff08audio/omni \u5f52\u5165\u8bed\u97f3\uff09 ----
            function mpCatsMatch(m, cat) {
                var isZf = (typeof Models !== 'undefined' && Models.isZfOfficial) ? Models.isZfOfficial : function(m) { return !!(m.zfManaged || m.zfPinned || m.zfLine); };
                // 朱峰官方线路模型：默认归入"语言"分类（无 modelType 时），保证置顶可见
                if (isZf && cat === 'language' && !m.modelType && !m.visionInput && !m.imageGen) return true;
                var t = String(m.modelType || '').toLowerCase();
                if (m.imageGen && cat !== 'vision') return false;
                if (t === 'audio' || t === 'omni') t = 'speech';
                // 【分类归一】识图 tab(types_vision) 同时接受 types_vision/vision 模型，
                // 并回退检查 visionInput 能力字段（normalizeModel 不生成 modelType，
                // 存量识图模型只有 visionInput:true，仅按 modelType 严格匹配会误伤归零）
                if (cat === 'types_vision') return t === 'types_vision' || t === 'vision' || m.visionInput === true;
                // 图片 tab(vision) 收生图模型
                if (cat === 'vision') return m.imageGen === true;
                if (cat === 'model3d') return t === 'model3d' || t === '3d' || t === '3d_model';
                return t === cat;
            }

            // ---- \u9876\u90e8\u5206\u7c7b Tab ----
            function renderCats() {
                var catsEl = menu.querySelector('.mp-cats');
                if (!catsEl) return;
                var cats = [
                    { id: 'language', label: '\u8bed\u8a00' },
                    { id: 'types_vision', label: '\u8bc6\u56fe' },
                    { id: 'vision', label: '\u56fe\u7247' },
                    { id: 'video', label: '\u89c6\u9891' },
                    { id: 'model3d', label: '3D' },
                    { id: 'embedding', label: '\u5411\u91cf\u5316' }
                ];
                var cat = chat._mpCategory || 'language';
                // 【分类可见性联动】设置面板眼睛关闭的分类，这里同步隐藏（语言分类永不可关）
                var _vis = window.McTypeVisibility;
                cats = cats.filter(function(c) { return !_vis || !_vis.isHidden(c.id); });
                if (_vis && _vis.isHidden(cat)) { cat = 'language'; chat._mpCategory = 'language'; }
                catsEl.innerHTML = cats.map(function(c) {
                    var n = Models.list.filter(function(m) { return m.visible !== false && mpCatsMatch(m, c.id); }).length;
                    return '<button type="button" class="mp-cat' + (c.id === cat ? ' active' : '') + '" data-cat="' + c.id + '">' + c.label + ' ' + n + '</button>';
                }).join('');
                if (!catsEl._mpBound) {
                    catsEl._mpBound = true;
                    catsEl.addEventListener('click', function(e) {
                        var b = e.target.closest('.mp-cat');
                        if (!b) return;
                        e.stopPropagation();
                        chat._mpCategory = b.getAttribute('data-cat');
                        renderCats();
                        renderLineSelect();
                        // 【修复】切换分类后第二列模型ID/第三列思考强度必须跟随当前分类线路刷新
                        renderModelIdSelect();
                        renderReSelect();
                    });
                }
            }

            // ---- 内部工具：当前分类下第一列实际选中的线路（语言分类=chat.modelId，其他分类=分类记忆） ----
            function mpCurLineId() {
                var cat = chat._mpCategory || 'language';
                if (cat === 'language') {
                    try { return (chat.modelId && Models.get(chat.modelId)) ? chat.modelId : ''; } catch (e) { return chat.modelId || ''; }
                }
                try {
                    var _id = (chat._mpCatModels && chat._mpCatModels[cat]) || '';
                    return (_id && Models.get(_id)) ? _id : '';
                } catch (e) { return ''; }
            }
            function mpCurLine() {
                var id = mpCurLineId();
                return id ? Models.get(id) : null;
            }

            // ---- 渲染模型 ID 下拉（第二列，跟随当前大模型） ----
            function renderModelIdSelect() {
                if (!modelidInput) return;
                var m = mpCurLine();
                // 【修复】未选大模型时模型ID列为空
                if (!m) {
                    modelidInput.innerHTML = '<option value="">（未选择模型）</option>';
                    modelidInput.value = '';
                    return;
                }
                var seen = {};
                var optsHtml = '';
                var _ids = (Models.modelIdsFor && m) ? Models.modelIdsFor(m) : [];
                // 【修复】非语言分类不使用 override，防止语言分类的模型 ID 串台到识图/图片等分类
                var _isLang = (chat._mpCategory || 'language') === 'language';
                _ids.forEach(function(v) {
                    v = (v || '').trim();
                    if (!v || seen[v]) return;
                    seen[v] = true;
                    optsHtml += '<option value="' + v + '">' + v + '</option>';
                });
                // 当前覆盖值不在列表中时（如旧数据/自定义ID），补充一个选项避免显示空
                var cur = (_isLang && chat._modelIdOverride) || (m && m.modelId) || '';
                // 【按用户要求】无覆盖值时自动取该线路第一个可用模型 ID 作为默认显示，不让第二列显示空
                if (!cur && _ids.length) {
                    cur = _ids.map(function(v){return (v||'').trim();}).filter(function(v){return v;})[0] || '';
                    if (cur && _isLang) {
                        chat._modelIdOverride = cur; // 【分类隔离】仅语言分类写回，避免识图等分类的 ID 污染语言分类记忆
                    }
                }
                if (cur && !seen[cur]) {
                    optsHtml += '<option value="' + cur + '">' + cur + '</option>';
                }
                if (!optsHtml) {
                    optsHtml = '<option value="">（该模型暂无 ID）</option>';
                }
                modelidInput.innerHTML = optsHtml;
                modelidInput.value = cur || '';
            }

            // ---- 渲染思考强度下拉（第三列） ----
            function renderReSelect() {
                if (!reInput) return;
                var m = mpCurLine();
                // 【修复】模型ID跟随第一列线路；未选模型/无ID时思考强度列为空
                // 【按用户要求】思考强度为空（未选模型/无ID/非语言分类无强度值）时直接隐藏整列，不留空白下拉框
                function _hideReInput() {
                    reInput.innerHTML = '';
                    reInput.value = '';
                    reInput.style.display = 'none';
                }
                if (!m) { _hideReInput(); return; }
                // 【跟随模型ID】思考强度以第二列当前选中的模型ID为准（无则回退线路默认ID）
                var _mid = (modelidInput && modelidInput.value) ? modelidInput.value
                         : ((chat._modelIdOverride && mpCurLineId() === chat.modelId) ? chat._modelIdOverride : (m.modelId || ''));
                if (!_mid) { _hideReInput(); return; }
                var reList = ReasoningLevels.listFor(_mid, m);
                // 【分类隔离】非语言分类不读语言分类的全局思考强度记忆，避免跨分类残留
                var _isLang = (chat._mpCategory || 'language') === 'language';
                var curRe = _isLang ? curReasoning() : '';
                // 【按用户要求】无当前强度值（非语言分类/该模型无档位）时隐藏，不显示空白下拉
                if (!curRe || !reList.length) { _hideReInput(); return; }
                reInput.style.display = '';
                var hasCur = reList.some(function (it) { return it.value === curRe; });
                var reHtml = reList.map(function (it) {
                    return '<option value="' + it.value + '">' + it.label + '</option>';
                }).join('');
                // 当前值不在该模型档位列表中时补一项，避免显示空
                if (!hasCur && curRe) {
                    reHtml += '<option value="' + curRe + '">' + (ReasoningLevels.labelOf(curRe) || curRe) + '</option>';
                }
                reInput.innerHTML = reHtml;
                reInput.value = curRe;
            }

            // ---- 【浮层挂载】菜单脱离输入行外壳，挂到 body 顶层 ----
            // 背景：.chatbox-inputrow 带 overflow:hidden（圆角外壳裁剪滚动条溢出），
            //       .chatbox 本身也是 overflow:hidden，菜单向上弹出时会被外壳/对话框
            //       上边缘直接切掉，并与消息区 .chatbox-body 叠出层级冲突（表现为“下拉
            //       列表被对话截断/压在对话下”）。解法：打开时把 menu 临时搬到
            //       document.body，用 fixed 定位跟随按钮，z-index 高于一切对话框内容；
            //       关闭时原样搬回，保持 DOM 结构不变（点击外部关闭等逻辑照旧可用）。
            var _mpHome = wrap;                 // 归位目标：始终回 .model-picker-wrap
            var _mpNext = (menu.parentNode === wrap) ? menu.nextElementSibling : null;
            // 重复绑定（refreshAllModelPickers）时菜单可能正挂在 body 上，
            // 此时闭包状态必须认账，否则关闭逻辑会把浮层错挂到别处
            var _mpMounted = (menu.parentNode !== wrap);
            function mpMount() {
                if (_mpMounted || !wrap || document.body === wrap) return;
                document.body.appendChild(menu);
                menu.classList.add('mp-floating');
                menu.setAttribute('data-mp-for', box.dataset.mpKey || '');
                _mpMounted = true;
                mpPosition();
            }
            function mpUnmount() {
                if (!_mpMounted) return;
                _mpMounted = false;
                menu.classList.remove('mp-floating');
                menu.style.left = ''; menu.style.top = ''; menu.style.bottom = '';
                menu.style.right = ''; menu.style.width = ''; menu.style.maxHeight = '';
                menu.style.overflowY = '';
                if (_mpHome) {
                    if (_mpNext && _mpNext.parentNode === _mpHome) _mpHome.insertBefore(menu, _mpNext);
                    else _mpHome.appendChild(menu);
                }
            }
            // 按按钮实际屏幕位置定位浮层：默认向上弹出，上方空间不足则自动向下翻转
            function mpPosition() {
                if (!_mpMounted) return;
                var anchor = wrap;
                var r = anchor.getBoundingClientRect();
                if (!r || (r.width === 0 && r.height === 0)) { mpUnmount(); return; }
                var vh = window.innerHeight || document.documentElement.clientHeight;
                var vw = window.innerWidth || document.documentElement.clientWidth;
                // 宽度沿用样式（310px），这里只算位置与可用高度
                // right 必须显式置 auto：基础样式带 right:0，与 JS 写入的 left 共存时
                // 会让 mp-horizontal（width:auto）被拉伸成一整条
                menu.style.bottom = 'auto';
                menu.style.right = 'auto';
                var w = menu.offsetWidth || 310;
                var left = Math.max(8, Math.min(r.right - w, vw - w - 8));
                if (left < 8) left = 8;
                var spaceUp = r.top - 14;
                var spaceDown = vh - r.bottom - 14;
                // 横向皮肤（一行式配置面板）：保持自身高度与 visible，只做位置贴合，
                // 不压 max-height / 不加滚动，否则会裁掉它向上弹出的子面板
                if (menu.classList.contains('mp-horizontal')) {
                    menu.style.maxHeight = ''; menu.style.overflowY = '';
                    var hh = menu.offsetHeight || 56;
                    menu.style.left = left + 'px';
                    menu.style.top = (spaceUp >= hh + 6 ? Math.max(8, r.top - 6 - hh) : (r.bottom + 6)) + 'px';
                    return;
                }
                var wantH = menu.scrollHeight || 380;
                var dropUp = spaceUp >= Math.min(wantH + 12, 200) || spaceUp >= spaceDown;
                var avail = Math.max(120, dropUp ? spaceUp : spaceDown);
                var h = Math.min(wantH, avail);
                menu.style.maxHeight = h + 'px';
                // 只有内容真的放不下才内部滚动（保持 visible 以便子面板/悬浮元素正常显示）
                menu.style.overflowY = wantH > h + 2 ? 'auto' : 'visible';
                menu.style.left = left + 'px';
                menu.style.top = (dropUp ? Math.max(8, r.top - 6 - h) : (r.bottom + 6)) + 'px';
            }
            // 用 MutationObserver 统一接管显隐：任何地方写 menu.hidden 都能同步挂载/复位，
            // 避免逐个改 5 处 menu.hidden 赋值点
            try {
                if (window.MutationObserver) {
                    var _mpObs = new MutationObserver(function() {
                        if (menu.hidden) mpUnmount();
                        else if (!menu.parentNode) mpMount();
                        else if (_mpMounted) mpPosition();
                    });
                    // childList/subtree：菜单内容重渲染（选线路/刷新模型列表）后高度会变，
                    // 需重新按视口计算位置与内部滚动，不能只在打开那一刻定位一次
                    _mpObs.observe(menu, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
                    // 登记清理：对话框关闭时断开观察器并把浮层搬回，防止节点丢失/泄漏
                    if (chat && chat._cleanup) {
                        if (!Array.isArray(chat._cleanup.hooks)) chat._cleanup.hooks = [];
                        chat._cleanup.hooks.push(function() {
                            try { _mpObs.disconnect(); } catch (e) {}
                            mpUnmount();
                        });
                    }
                }
            } catch (e) {}
            window.addEventListener('resize', function() { if (_mpMounted) mpPosition(); });
            window.addEventListener('scroll', function() { if (_mpMounted) mpPosition(); }, true);

            // ---- 打开/关闭菜单 ----
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var isOpen = !menu.hidden;
                if (isOpen) { menu.hidden = true; return; }
                menu.hidden = false;
                mpMount();          // 立即挂载定位（不等 MutationObserver 微任务，避免闪烁）
                refreshBtn();
                // 【即时同步】打开面板时实时从朱峰网站拉取官方模型（替代定时轮询）
                // 拉取成功后重新加载配置并重渲染，模型 ID/思考强度跟随刷新；失败静默保持现状
                if (!btn._zfRefreshing) {
                    btn._zfRefreshing = true;
                    fetch('/api/models/refresh')
                        .then(function(res) { return res.json(); })
                        .then(function(r) {
                            if (r && r.ok && typeof Models.load === 'function') {
                                return Models.load().then(function() {
                                    // 同步完成后如当前线路已被官网下架，回退到默认模型
                                    if (chat.modelId && !Models.get(chat.modelId)) {
                                        // 【三级降级】官网下发默认 → 本地默认 → 空白（绝不取列表第一个）
                                        var def = (typeof Models.getDefaultFor === 'function') ? Models.getDefaultFor('language') : null;
                                        chat.modelId = def ? def.id : null;
                                        chat._modelIdOverride = (def && def.modelId) || '';
                                    }
                                    refreshBtn();
                                });
                            }
                        })
                        .catch(function() {})
                        .then(function() { btn._zfRefreshing = false; });
                }
            });

            // ---- 第一列：切换大模型线路 ----
            lineSelect.addEventListener('change', function(e) {
                e.stopPropagation();
                var mid = this.value;
                if (!mid) {
                    // 空值路径也要刷新三列，避免残留旧模型ID/思考强度显示
                    renderLineSelect();
                    renderModelIdSelect();
                    renderReSelect();
                    refreshBtn();
                    return;
                }
                // 【按分类隔离】本次选择只记入当前分类的记忆；只有语言分类才更新对话主模型。
                // 识图/图片/视频等分类的选择不影响 chat.modelId，防止"切了识图回来语音/语言跟着变"的串台。
                var _cat = chat._mpCategory || 'language';
                var _selM = Models.get(mid);
                if (_selM && !mpCatsMatch(_selM, _cat)) {
                    // 选中项不属于当前分类，忽略防串台；但仍刷新第一列复位显示，避免残留旧值
                    renderLineSelect();
                    return;
                }
                var _isLangCat = (_cat === 'language') || (_selM && mpCatsMatch(_selM, 'language') && !mpCatsMatch(_selM, _cat));
                try {
                    chat._mpCatModels = chat._mpCatModels || {};
                    chat._mpCatModels[_cat] = mid; // 每个分类只记录自己的结果，互不覆盖
                } catch (eCat) {}
                if (!_isLangCat) {
                    // 非语言分类：只记分类记忆，不动主模型，面板保持停留在本分类
                    // 【修复】分类记忆刚更新，模型ID/思考强度列必须同步跟随刷新（此前只刷第一列导致模型ID残留旧缓存）
                    renderLineSelect();
                    renderModelIdSelect();
                    renderReSelect();
                    refreshBtn();
                    return;
                }
                if (mid !== chat.modelId) {
                    // 发送中切换模型先给予明确提示，避免用户误以为旧循环已终止
                    if (chat.isSending || chat._stopped === false && (chat.abortController)) {
                        self.addMsg(box, '⚠ 当前对话正在运行中，已切换下一轮使用的模型线路。如需立即停止请点击停止按钮。', 'warning');
                        Store.addLog('warn', chat.id, 'model-switch-sending', '发送中切换模型: ' + mid);
                    }
                    chat.modelId = mid;
                    // 切换后立即锁定该线路在模型设置中保存的具体模型 ID，避免回退到全局配置。
                    var m = Models.get(mid);
                    // 【分层记忆】优先恢复该分类+该线路上次用户选择的模型ID/思考强度（无记忆才用线路默认）
                    var _rec = memLoad(_cat, mid);
                    chat._modelIdOverride = _rec && _rec.modelIdOverride ? String(_rec.modelIdOverride)
                                          : (m && m.modelId ? String(m.modelId).trim() : '');
                    // 思考强度必须与模型ID匹配：不在该ID合法档位内则回退到该ID默认档
                    var _effort = _rec ? (_rec.reasoningEffort || '') : '';
                    try {
                        var _reList = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(chat._modelIdOverride, m) : null;
                        if (_reList && _reList.length) {
                            var _ok = _reList.some(function (it) { return it.value === _effort; });
                            if (!_ok) _effort = _reList[0].value;
                        }
                    } catch (_reErr0) {}
                    chat._reasoningEffort = _effort;
                    // 【用户习惯】保存选择，供新对话继承（永久保留，不影响老对话）
                    try {
                        if (window.UserSettings && UserSettings.set) {
                            UserSettings.set('lastModelSelection', {
                                modelId: mid,
                                modelIdOverride: chat._modelIdOverride,
                                reasoningEffort: chat._reasoningEffort,
                                ts: Date.now()
                            });
                        }
                    } catch (e2) {}
                    var displayName = m ? m.name : mid;
                    self.addMsg(box, '系统已切换模型：' + displayName, 'ai');
                    // 同步更新欢迎消息（否则欢迎语会一直显示"未选择模型"）
                    try {
                        if (box._welcomeCtx) {
                            box._welcomeCtx.model = m;
                            box._welcomeCtx.mid = (m && m.modelId ? m.modelId : '') || '';
                            var _wb = box.querySelector('[data-welcome]');
                            if (_wb && _wb.parentNode) _wb.innerHTML = self._welcomeHtml(box);
                        }
                    } catch (e3) {}
                    Store.saveChatBox(chat, true);
                    Store.addLog('info', chat.id, 'model-switch', '切换到: ' + displayName);
                    if (self.updateMinimap) self.updateMinimap();
                }
                refreshBtn();
            });
            lineSelect.addEventListener('click', function(e) { e.stopPropagation(); });
            lineSelect.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { menu.hidden = true; } });

            // ---- 第二列：模型 ID 覆盖（即时生效） ----
            if (modelidInput) {
                modelidInput.addEventListener('change', function(e) {
                    e.stopPropagation();
                    var m = chat.modelId ? Models.get(chat.modelId) : null;
                    var base = m ? String(m.modelId || '').trim() : '';
                    var v = (modelidInput.value || '').trim() || base;
                    chat._modelIdOverride = v;
                    // 强度自动跟随所选模型ID：当前强度不在新ID的合法档位内时，重置为该ID默认档
                    try {
                        var _reList = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(v, m) : null;
                        if (_reList && _reList.length) {
                            var _cur = chat._reasoningEffort || (m && m.reasoningEffort) || ReasoningLevels.defaultValue();
                            var _ok = _reList.some(function (it) { return it.value === _cur; });
                            if (!_ok) chat._reasoningEffort = _reList[0].value;
                        }
                    } catch (_reErr) {}
                    // 【用户习惯】保存模型 ID 选择（全局 lastModelSelection + 分层记忆 分类→线路）
                    try {
                        if (window.UserSettings && UserSettings.set) {
                            var _h = UserSettings.get('lastModelSelection', {}) || {};
                            UserSettings.set('lastModelSelection', {
                                modelId: chat.modelId || _h.modelId || '',
                                modelIdOverride: v,
                                reasoningEffort: chat._reasoningEffort !== undefined ? chat._reasoningEffort : (_h.reasoningEffort || ''),
                                ts: Date.now()
                            });
                            memSave(chat._mpCategory || 'language', chat.modelId || _h.modelId || '', v, undefined);
                        }
                    } catch (e2) {}
                    Store.saveChatBox(chat, true);
                    self.addMsg(box, '⚙️ 本对话模型 ID 已设为：' + v + (base && base !== v ? '（线路默认：' + base + '）' : ''), 'ai');
                    Store.addLog('info', chat.id, 'model-id-override', '模型ID: ' + v);
                    refreshBtn();
                });
                modelidInput.addEventListener('click', function(e) { e.stopPropagation(); });
                modelidInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { menu.hidden = true; } });
            }

            // ---- 第三列：思考强度切换 ----
            if (reInput) {
                reInput.addEventListener('change', function(e) {
                    e.stopPropagation();
                    var re = this.value;
                    chat._reasoningEffort = re;
                    // 【用户习惯】保存思考强度选择（全局 lastModelSelection + 分层记忆 分类→线路）
                    try {
                        if (window.UserSettings && UserSettings.set) {
                            var _h2 = UserSettings.get('lastModelSelection', {}) || {};
                            UserSettings.set('lastModelSelection', {
                                modelId: chat.modelId || _h2.modelId || '',
                                modelIdOverride: chat._modelIdOverride || (_h2.modelIdOverride || ''),
                                reasoningEffort: re,
                                ts: Date.now()
                            });
                            memSave(chat._mpCategory || 'language', chat.modelId || _h2.modelId || '', undefined, re);
                        }
                    } catch (e2) {}
                    Store.saveChatBox(chat, true);
                    var reName = ReasoningLevels.labelOf(re) || re;
                    self.addMsg(box, '🧠 思考强度已切换为：' + reName, 'ai');
                    Store.addLog('info', chat.id, 'reasoning-switch', '思考强度: ' + reName + ' (' + re + ')');
                    refreshBtn();
                });
                reInput.addEventListener('click', function(e) { e.stopPropagation(); });
                reInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { menu.hidden = true; } });
            }

            // ---- 点击外部关闭 ----
            // 【内存泄露修复】document 级监听登记到 chat._cleanup.listeners，
            // closeChatBox 时随对话框一并移除，避免关闭/重开对话框反复叠加 document 监听
            (function() {
                var handler = function(e) {
                    // 浮层挂载到 body 后，menu 已不在 wrap 内，必须额外放行 menu 自身的点击
                    if (!menu.hidden && !wrap.contains(e.target) && !menu.contains(e.target)) {
                        menu.hidden = true;
                    }
                };
                document.addEventListener('click', handler);
                if (chat && chat._cleanup && Array.isArray(chat._cleanup.listeners)) {
                    chat._cleanup.listeners.push({ target: document, event: 'click', handler: handler });
                }
            })();
        },

        // ===== 拖拽头部排除区域（底部选择器不参与拖拽） =====

        modelOptions: function(selectedId) {
            var opts = '';
            var hasSelected = selectedId && Models.get(selectedId);
            if (!hasSelected) {
                opts += '<option value="" disabled selected hidden>请选择模型</option>';
            }
            Models.list.forEach(function(m) {
                if (!m) return;
                // 创建对话框只允许：语言类模型（本地模型必须是语言分类的可见模型）；
                // 语音/图片/视频/识图/向量化即使可见也不出现
                var t = String(m.modelType || '').toLowerCase();
                if (m.imageGen) return;
                if (m.visionInput) return;
                if (!(t === 'language' || t === 'text' || t === 'chat' || t === '')) return;
                if ((m.endpoint || m.baseUrl || '').toLowerCase().indexOf('/images/') !== -1) return;
                if (m.visible === false) return;
                opts += '<option value="' + m.id + '"' + (m.id === selectedId ? ' selected' : '') + '>' + m.name + '</option>';
            });
            return opts;
        },

        // ===== 刷新所有已存在对话框的模型选择器 =====
        // 在设置面板添加/删除模型后调用，确保已打开的对话框选择器同步更新
        refreshAllModelSelects: function() {
            if (!this.chatBoxes || this.chatBoxes.length === 0) return;
            this.chatBoxes.forEach(function(chat) {
                if (!chat.el) return;
                // 刷新底部增强选择器按钮显示（列表在下拉打开时按最新 Models.list 渲染）
                if (typeof chat._refreshModelPickerBtn === 'function') {
                    chat._refreshModelPickerBtn();
                }
                // 模型被删除时的处理：置为未选择等待用户手动选
                var currentModelId = chat.modelId || '';
                if (!(currentModelId && Models.get(currentModelId))) {
                    chat.modelId = '';
                    // 提示用户模型已失效，需手动重新选择
                    try {
                        if (typeof App !== 'undefined' && App.addMsg && chat.el) {
                            App.addMsg(chat.el, '⚠️ 原模型已被删除（已禁用自动切换），请在下拉框手动选择模型。', 'error');
                        }
                    } catch (e) {}
                }
            });
        },

        activate: function(box) {
            var self = this;
            this.chatBoxes.forEach(function(c) { c.el.classList.remove('active'); });
            box.classList.add('active');
            box.style.zIndex = ++this.zCounter;
            // 【5.1.0 修复】记住最后激活的对话（UserSettings JSON 持久化），刷新/重开后恢复聚焦
            try {
                if (window.UserSettings && UserSettings.set) UserSettings.set('last_active_chat_id', box.id);
                if (window.UserSettings && UserSettings.set) UserSettings.set('last_active_at', Date.now());
            } catch (e) {}
            // 记住最后激活窗口的尺寸（折叠状态不记录，避免新建窗口变成折叠条）
            if (!box.classList.contains('collapsed') && box.offsetWidth >= 280 && box.offsetHeight >= 200) {
                self.rememberBoxSize(box.offsetWidth, box.offsetHeight);
                try { if (window.UserSettings && UserSettings.setChatPreferences) UserSettings.setChatPreferences(null, { w: box.offsetWidth, h: box.offsetHeight }, null); } catch (e) {}
            }
            // 点击激活（只绑定一次，避免重复添加监听器导致指数级增长卡死浏览器）
            if (!box._zf3dActivated) {
                box._zf3dActivated = true;
                box.addEventListener('mousedown', function() {
                    self.activate(box);
                });
                // 点击对话时不再移动摄像机（用户要求保持视口不动）
            }
        },

        // ===== 仅移动摄像机到指定元素（不调用 activate，避免循环） =====
        _focusCameraOn: function(el) {
            if (!el) return;
            var view = this.canvasGetView ? this.canvasGetView() : { x: 0, y: 0 };
            var rect = el.getBoundingClientRect();
            var area = document.getElementById('canvasArea');
            var areaRect = area ? area.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
            var targetX = view.x + (areaRect.width / 2 - rect.left - rect.width / 2);
            var targetY = view.y + (areaRect.height / 2 - rect.top - rect.height / 2);
            if (this.canvasSetView) {
                this.canvasSetView(targetX, targetY, 1, true);
            }
        },

        hideHint: function() {
            var hint = document.getElementById('canvasHint');
            if (hint) hint.style.display = 'none';
        },
        showHint: function() {
            var hint = document.getElementById('canvasHint');
            // 画布上仍有任何视觉面板（文生图/识图/提示词编辑/创建面板）时，不显示「双击创建」引导提示
            if (hint && document.querySelector('.kite-dual-create-panel,.kite-image-panel,.kite-edit-panel,.kite-vision-panel,.kite-aux-panel')) return;
            // 【修复】画布上有拖拽的媒体图片/视频节点时，同样不显示「双击创建」提示
            if (hint && (document.querySelector('.media-canvas-node') || document.querySelector('.kite-node-image,.kite-node-video'))) return;
            // 【修复】画布上有流程图（FlowGlam 节点图）图层时，同样不显示「双击创建」提示
            if (hint && document.querySelector('.fg-layer')) return;
            if (hint) hint.style.display = '';
        },

        // ===== 获取对话框状态（与 minimap 逻辑一致） =====
        _getChatStatus: function(chat) {
            if (!chat || !chat.el) return 'idle';
            var el = chat.el;
            var hasError = false;
            var msgs = el.querySelectorAll('.msg');
            if (msgs.length > 0) {
                var lastMsg = msgs[msgs.length - 1];
                if (lastMsg.classList.contains('error')) hasError = true;
            }
            if (hasError) return 'error';
            if (chat.isSending) return 'sending';
            if (chat.queue && chat.queue.length > 0) return 'queued';
            // 任务结果保存在 chat 对象上，避免依赖 2 秒临时 DOM class（与 minimap 逻辑一致）。
            if (chat._taskStatus === 'success') return 'success';
            if (el.classList.contains('task-success')) return 'success';
            if (chat._taskStatus === 'fail') return 'error';
            if (el.classList.contains('task-fail')) return 'error';
            if (el.classList.contains('collapsed')) return 'collapsed';
            if (el.classList.contains('active')) return 'active';
            return 'idle';
        },

        // ===== 更新状态指示（标题前图标变色） =====
        _statusClasses: ['status-idle', 'status-sending', 'status-queued', 'status-error', 'status-success', 'status-collapsed', 'status-active'],
        updateStatusDot: function(chat) {
            if (!chat || !chat.el) return;
            var icon = chat.el.querySelector('.status-dot');
            if (!icon) return;
            var status = this._getChatStatus(chat);
            var statusClass = 'status-idle';
            if (status === 'error') statusClass = 'status-error';
            else if (status === 'sending') statusClass = 'status-sending';
            else if (status === 'queued') statusClass = 'status-queued';
            else if (status === 'success') statusClass = 'status-success';
            else if (status === 'collapsed') statusClass = 'status-collapsed';
            else if (status === 'active') statusClass = 'status-active';
            // 移除所有旧状态类
            this._statusClasses.forEach(function(cls) { icon.classList.remove(cls); });
            icon.classList.add(statusClass);
        },

        // ===== 摄像机聚焦到指定对话框 =====
        // 参数归一化：兼容 chat 对象（导航箭头传入）与 chatId 字符串（风筝尾巴/任务面板传入）。
        // 背景：app-taskpanel.js 有同名方法（收字符串），两者靠 Object.assign 后加载覆盖定胜负；
        //       热更新单个文件会打破顺序，若不做归一化，收字符串时 chat.el 为 undefined 静默 return，
        //       表现为「点击风筝尾巴球，摄像机不跳转、点击无反应」。
        _focusChatBox: function(chat) {
            if (typeof chat === 'string') {
                var fid = chat; chat = null;
                var boxes = this.chatBoxes || [];
                for (var i = 0; i < boxes.length; i++) {
                    if (boxes[i] && boxes[i].id === fid) { chat = boxes[i]; break; }
                }
                if (!chat) return;
            }
            if (!chat || !chat.el) return;
            // 与 app-taskpanel.js 版本保持一致：画布坐标系 + 保持当前缩放，不强制 scale=1。
            // 原先 getBoundingClientRect + 强制 scale=1 在画布缩放时跳转位置算错，摄像机无法追踪目标对话。
            var area = document.getElementById('canvasArea');
            if (!area) return;
            var scale = this.canvasScale ? this.canvasScale() : 1;
            var cx = chat.el.offsetLeft + chat.el.offsetWidth / 2;
            var cy = chat.el.offsetTop + chat.el.offsetHeight / 2;
            var targetX = area.clientWidth / 2 - cx * scale;
            var targetY = area.clientHeight / 2 - cy * scale;
            if (this.canvasSetView) {
                this.canvasSetView(targetX, targetY, scale, true);
            }
            this.activate(chat.el);
        },

        // ===== 设置导航箭头（已废弃：左右小圆圈导航功能彻底移除，由右下角"下一个成功任务"按钮代替） =====
        _setupNavArrows: function(box, chat) {
            var existingPrev = box.querySelector('.chatbox-nav-prev');
            var existingNext = box.querySelector('.chatbox-nav-next');
            if (existingPrev) existingPrev.remove();
            if (existingNext) existingNext.remove();
        },

        // ===== 查找相邻对话（dir: -1=左边最近, 1=右边最近，基于物理坐标） =====
        _findNeighborChat: function(currentChat, dir) {
            var boxes = this.chatBoxes;
            if (!boxes || boxes.length <= 1) return null;
            var currentX = currentChat.el.offsetLeft;
            var best = null;
            var bestDist = Infinity;
            for (var i = 0; i < boxes.length; i++) {
                if (boxes[i] === currentChat) continue;
                var x = boxes[i].el.offsetLeft;
                var diff = x - currentX;
                if (dir < 0 && diff < 0) {
                    if (-diff < bestDist) { bestDist = -diff; best = boxes[i]; }
                } else if (dir > 0 && diff > 0) {
                    if (diff < bestDist) { bestDist = diff; best = boxes[i]; }
                }
            }
            return best;
        },

        // ===== 统计左右两侧符合条件的对话数量 =====
        _countNeighbors: function(currentChat) {
            var boxes = this.chatBoxes;
            if (!boxes || boxes.length <= 1) return { left: 0, right: 0 };
            var currentX = currentChat.el.offsetLeft;
            var left = 0, right = 0;
            for (var i = 0; i < boxes.length; i++) {
                if (boxes[i] === currentChat) continue;
                var x = boxes[i].el.offsetLeft;
                if (x < currentX) left++;
                else right++;
            }
            return { left: left, right: right };
        },

        // ===== 更新单个对话框的导航圆圈（已废弃：左右小圆圈彻底移除） =====
        // 【性能修复】清扫是一次性动作，完成后打标记，避免 2s 定时器每次都对每个 box
        // 执行 querySelector + remove（对话框多时造成持续 forced reflow，FPS 从 60 掉到个位数）
        _updateNavArrowStatus: function(box, chat) {
            if (!box || box.__navCirclesCleaned) return;
            // 彻底清理残留的左右导航圆圈
            var prevArrow = box.querySelector('.chatbox-nav-prev');
            var nextArrow = box.querySelector('.chatbox-nav-next');
            if (prevArrow) prevArrow.remove();
            if (nextArrow) nextArrow.remove();
            box.__navCirclesCleaned = true;
        },

        // ===== 更新所有对话框的导航箭头 =====
        // 【性能修复】页面隐藏时直接跳过；200ms 内重复调用合并为一帧（拖拽/定时器风暴去抖）
        _updateAllNavArrows: function() {
            var self = this;
            if (document.hidden) return;
            if (this.__unarPending) return;
            this.__unarPending = true;
            requestAnimationFrame(function() {
                self.__unarPending = false;
                self.__unarReal.apply(self, arguments);
            });
        },
        __unarReal: function() {
            var self = this;
            // 只在当前函数内过滤出 DOM 仍连接的对话框，不修改 this.chatBoxes 本身。
            // 原代码 this.chatBoxes = filter(...) 会永久删除暂时断开连接的对话，
            // 导致重启/热更新后对话在导航/任务面板中消失且无法恢复。
            var liveBoxes = (this.chatBoxes || []).filter(function(chat) {
                return chat && chat.el && chat.el.isConnected;
            });
            document.querySelectorAll('.cbx-succ-nav[data-for]').forEach(function(container) {
                var ownerId = container.getAttribute('data-for');
                var ownerExists = liveBoxes.some(function(chat) { return chat.id === ownerId; });
                if (!ownerExists) container.remove();
            });
            liveBoxes.forEach(function(chat) {
                if (chat.el) self._updateNavArrowStatus(chat.el, chat);
                if (chat.el) self._updateSuccessArrows(chat.el, chat);
            });
        },
});
