// ========== app-filetree.js - 文件树面板（极简版）==========
// 布局：顶部一排 [◀ ▶ ⬆ | 大路径(可点/可输入) | ⟳ 📌 ✕]
//       下面两列：左侧文件树 | 右侧缩略图
// 📌 大头针：钉住当前路径作为根（相当于项目），再点一次取消钉住
var App = window.App || {};
// 兜底广播：project-sync.js 万一未加载成功（脚本乱序/热更新时序），
// 所有 emitProjectChange 调用点也不会抛 "is not a function" 而中断面板打开
if (typeof App.emitProjectChange !== 'function') {
    App.emitProjectChange = function() {
        try { localStorage.setItem('active_project_id', App.activeProject ? (App.activeProject.id || '') : ''); } catch (e) {}
        try { localStorage.setItem('active_project_name', App.activeProject ? (App.activeProject.name || '') : ''); } catch (e) {}
        try { document.dispatchEvent(new CustomEvent('projectchange', { detail: App.activeProject || null })); } catch (e) {}
    };
}

Object.assign(App, {

    _ftPanelOpen: false,
    _ftProjId: null,
    _ftProjName: '',
    _ftRoot: '',        // 当前根（钉住的路径或浏览起点）
    _ftCwd: '',
    _ftExpanded: {},    // { dirPath: true }
    _ftDirCache: {},    // { dirPath: {path, dirs, files} }
    _ftSelected: {},    // 缩略图选中 { path: true }
    _ftHist: [],
    _ftHistPos: -1,

    _esq: function(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    _norm: function(p) {
        var s = String(p || '').replace(/\//g, '\\').replace(/[\\]+$/, '');
        if (/^[a-zA-Z]:$/.test(s)) s += '\\';   // 裸盘符保留根斜杠，避免 "F:" 被解析成盘上的当前目录
        return s;
    },

    // ===== 布局持久化 + 拖拽 =====
    // 存储走 UserSettings（private/用户设置/user_settings.json），
    // 兼容旧数据：首次读取时从旧 localStorage 键 ft_layout 迁移。
    _getLayout: function() {
        var l = null;
        try { if (window.UserSettings) l = UserSettings.get('ft_layout', null); } catch (e) {}
        if (l && typeof l === 'object') return l;
        // 旧版 localStorage 迁移
        try {
            var old = JSON.parse(localStorage.getItem('ft_layout') || '{}') || {};
            if (old && Object.keys(old).length) {
                if (window.UserSettings) UserSettings.set('ft_layout', old);
                try { localStorage.removeItem('ft_layout'); } catch (e2) {}
                return old;
            }
        } catch (e2) {}
        return {};
    },
    _saveLayout: function(patch) {
        var l = this._getLayout();
        for (var k in patch) l[k] = patch[k];
        try { if (window.UserSettings) UserSettings.set('ft_layout', l); } catch (e) {}
        try { localStorage.setItem('ft_layout', JSON.stringify(l)); } catch (e) {} // 缓存兜底
    },
    _applyLayout: function() {
        var l = this._getLayout();
        var panel = document.getElementById('ftPanel');
        if (!panel) return;
        if (l.panelW) panel.style.width = l.panelW + 'px';
        if (l.treePct) {
            var t = document.getElementById('ftTree');
            if (t) t.style.flex = '0 0 ' + l.treePct + '%';
        }
    },
    _initDrag: function() {
        var self = this;
        var rz = document.getElementById('ftResizer');
        if (rz) {
            rz.onmousedown = function(e) {
                e.preventDefault();
                var panel = document.getElementById('ftPanel');
                var startX = e.clientX, startW = panel.offsetWidth;
                panel.style.transition = 'none';
                document.onmousemove = function(ev) {
                    var w = Math.min(Math.max(startW + (ev.clientX - startX), 420), Math.floor(window.innerWidth * 0.94));
                    panel.style.width = w + 'px';
                };
                document.onmouseup = function() {
                    document.onmousemove = document.onmouseup = null;
                    panel.style.transition = '';
                    self._saveLayout({ panelW: panel.offsetWidth });
                };
            };
        }
        var sp = document.getElementById('ftSplitter');
        if (sp) {
            sp.onmousedown = function(e) {
                e.preventDefault();
                var tree = document.getElementById('ftTree');
                var cols = tree.parentElement;
                var startX = e.clientX, startW = tree.offsetWidth, totalW = cols.offsetWidth;
                document.onmousemove = function(ev) {
                    var pct = (startW + ev.clientX - startX) / totalW * 100;
                    pct = Math.min(Math.max(pct, 20), 80);
                    tree.style.flex = '0 0 ' + pct + '%';
                };
                document.onmouseup = function() {
                    document.onmousemove = document.onmouseup = null;
                    var pct = tree.offsetWidth / cols.offsetWidth * 100;
                    self._saveLayout({ treePct: Math.round(pct * 10) / 10 });
                };
            };
        }
    },

    // 5.0.7 记忆增强：钉住项除 localStorage 外，同步持久化到
    // private/用户设置/user_settings.json（UserSettings），重启/换浏览器后仍能记住。
    _getPins: function() {
        try {
            var a = null;
            if (typeof UserSettings !== 'undefined' && UserSettings.get) a = UserSettings.get('ft_pins', null);
            if (!a || !a.length) a = JSON.parse(localStorage.getItem('ft_pins') || '[]') || [];
            // 兼容旧版单钉住 ft_pin
            if (!a.length) {
                var old = localStorage.getItem('ft_pin');
                if (old) { a = [old]; this._setPins(a); localStorage.removeItem('ft_pin'); }
            }
            return a;
        } catch (e) { return []; }
    },
    _setPins: function(arr) {
        try { localStorage.setItem('ft_pins', JSON.stringify(arr || [])); } catch (e) {}
        try { if (typeof UserSettings !== 'undefined' && UserSettings.set) UserSettings.set('ft_pins', arr || []); } catch (e) {}
    },
    _getPin: function() { var a = this._getPins(); return a.length ? a[0] : ''; },
    // 判断 dirPath 是否在 root 目录内（或相等）
    _isUnderDir: function(root, p) {
        if (!root || !p) return false;
        var r = this._norm(root).toLowerCase(), q = this._norm(p).toLowerCase();
        return q === r || q.indexOf(r + '\\') === 0;
    },
    _togglePin: function() {
        var self = this;
        if (!self._ftCwd) return;
        var cwd = self._norm(self._ftCwd);
        var pins = self._getPins();
        var idx = -1;
        for (var i = 0; i < pins.length; i++) if (self._norm(pins[i]) === cwd) { idx = i; break; }
        if (idx >= 0) {
            pins.splice(idx, 1);
            self._setPins(pins);
            if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('📌 已取消钉住', 'info');
        } else {
            pins.push(cwd);
            self._setPins(pins);
            if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('📌 已钉住（可钉多个文件夹）', 'info');
            // 联动：新钉住的文件夹视为当前项目（统一项目同步系统，见 project-sync.js）
            var pinPid = null, pinName = '';
            try {
                var _lists = [];
                if (Store.data && Store.data.projects) _lists.push(Store.data.projects);
                if (self._projAllProjects && self._projAllProjects.length) _lists.push(self._projAllProjects);
                for (var _li = 0; _li < _lists.length && !pinPid; _li++) {
                    var _lst = _lists[_li];
                    for (var _i = 0; _i < _lst.length; _i++) {
                        if (self._norm(_lst[_i].folder_path || '') === cwd) { pinPid = _lst[_i].id; pinName = _lst[_i].name || ''; break; }
                    }
                }
            } catch (e) {}
            if (!pinName) pinName = self._rootNameOf(cwd);
            // 【5.1.0 修复】钉住项必须入库：folder_path 匹配不到项目时，自动创建项目并关联该文件夹
            // （与项目面板创建项目一致：DB.createProject + DB.linkFolder），不再存 id:null 的"野钉住"
            if (!pinPid && typeof DB !== 'undefined' && DB.createProject && DB.online) {
                var folderName = pinName;
                DB.createProject(folderName).then(function(res) {
                    var newId = (res && res.ok && res.id) ? res.id : null;
                    if (!newId) return;
                    // 本地缓存同步
                    if (typeof Store !== 'undefined' && Store.data && Store.data.projects) {
                        var exists = Store.data.projects.some(function(pp) { return String(pp.id) === String(newId); });
                        if (!exists) Store.data.projects.push({ id: newId, name: folderName, folder_path: cwd });
                    }
                    if (self._projAllProjects) {
                        var ex2 = self._projAllProjects.some(function(pp) { return String(pp.id) === String(newId); });
                        if (!ex2) self._projAllProjects.push({ id: newId, name: folderName, folder_path: cwd });
                    }
                    return DB.linkFolder(newId, cwd).then(function() {
                        try { localStorage.setItem('ft_last_proj', JSON.stringify({ id: newId, name: folderName })); } catch (e2) {}
                        self._ftProjId = newId;
                        self._ftProjName = folderName;
                        if (typeof App.setActiveProjectUnified === 'function') App.setActiveProjectUnified(newId, folderName);
                        if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('📌 已钉住并入库为新项目：' + folderName, 'ok');
                        if (self._ftPanelOpen) { self._renderTree(); }
                    });
                }).catch(function(err) {
                    console.warn('钉住自动入库失败，回退为仅浏览:', err);
                });
            }
            try { localStorage.setItem('ft_last_proj', JSON.stringify({ id: pinPid, name: pinName })); } catch (e2) {}
            self._ftProjId = pinPid;
            self._ftProjName = pinName;
            // 无论是否已关联项目，都切换活动项目（未关联时 id 为 null，按钮显示文件夹名）
            // 【5.1.0 修复】优先走统一入口 setActiveProjectUnified（持久化+广播+激活对话归属同步）
            if (typeof App.setActiveProjectUnified === 'function') {
                App.setActiveProjectUnified(pinPid || null, pinName);
            } else {
                App.activeProject = { id: pinPid || null, name: pinName };
                App.emitProjectChange();
            }
        }
        if (self._ftPanelOpen) { self._renderTree(); self._renderThumbs(); }
        self._updatePinBtn();
        self._syncProjectFolder();
    },
    _updatePinBtn: function() {
        var btn = document.getElementById('ftPinBtn');
        if (!btn) return;
        var pins = this._getPins(), pinned = false;
        for (var i = 0; i < pins.length; i++) if (this._isUnderDir(pins[i], this._ftCwd)) { pinned = true; break; }
        btn.textContent = '📌';
        btn.classList.toggle('ft-pinned', !!pinned);
        btn.title = pinned ? '取消钉住当前路径' : '钉住当前路径作为项目';
    },
    // ===== 同步：文件树状态 → 对话框项目（钉住/选中文件时更新当前项目关联文件夹） =====
    // currentPin：返回当前生效的项目路径（钉住列表中包含 _ftCwd 的那条）
    _currentPinOf: function() {
        var self = this;
        if (!self._ftCwd) return '';
        var pins = self._getPins();
        var best = '';
        for (var i = 0; i < pins.length; i++) {
            if (self._isUnderDir(pins[i], self._ftCwd)) {
                // 取最长匹配（最具体的那个项目）
                if (!best || pins[i].length > best.length) best = pins[i];
            }
        }
        return best;
    },
    // 把当前浏览目录/选中文件同步为活动项目的 folder_path，并记忆"上次项目路径"
    _syncProjectFolder: function() {
        var self = this;
        var cur = self._currentPinOf();
        if (!cur) return;
        try { localStorage.setItem('ft_last_project_path', cur); } catch (e) {}
        // 更新活动项目的 folder_path（本地缓存 + DB）
        var pid = (typeof App !== 'undefined' && App._activeProjectId) || self._ftProjId || null;
        if (!pid) return;
        var changed = false;
        // 【5.1.0 修复·数据污染】活动项目已有 folder_path 时，绝不允许用“当前浏览目录”覆盖，
        // 否则浏览到别的项目/钉住目录会把 A 项目的路径写成 B 的（name 与 path 串线）。
        // 只有项目还没有 folder_path（新建未关联）时才补填当前目录。
        if (typeof Store !== 'undefined' && Store.data && Store.data.projects) {
            for (var i = 0; i < Store.data.projects.length; i++) {
                if (String(Store.data.projects[i].id) === String(pid)) {
                    var oldPath = Store.data.projects[i].folder_path || '';
                    if (!oldPath && cur) {
                        Store.data.projects[i].folder_path = cur; changed = true;
                    }
                    break;
                }
            }
        }
        if (self._projAllProjects) {
            for (var j = 0; j < self._projAllProjects.length; j++) {
                if (String(self._projAllProjects[j].id) === String(pid)) {
                    var oldPath2 = self._projAllProjects[j].folder_path || '';
                    if (!oldPath2 && cur) { self._projAllProjects[j].folder_path = cur; changed = true; }
                    break;
                }
            }
        }
        if (changed && typeof DB !== 'undefined' && DB.linkFolder) {
            DB.linkFolder(pid, cur).catch(function() {});
        }
    },
    // 点击"📌 我的项目"钉住节点：切换活动项目 + 导航到钉住根
    _activatePinProject: function(p) {
        var self = this;
        p = self._norm(p);
        // 找 folder_path 匹配的项目，联动为活动项目（对话框📁按钮/项目面板高亮跟随）
        var pid = null, pname = '';
        try {
            // 两张表都查：Store.data.projects + App._projAllProjects，任一命中即可
            var lists = [];
            if (Store.data && Store.data.projects) lists.push(Store.data.projects);
            if (self._projAllProjects && self._projAllProjects.length) lists.push(self._projAllProjects);
            for (var li = 0; li < lists.length && !pid; li++) {
                var lst = lists[li];
                for (var i = 0; i < lst.length; i++) {
                    if (self._norm(lst[i].folder_path || '') === p) { pid = lst[i].id; pname = lst[i].name || ''; break; }
                }
            }
        } catch (e) {}
        // 先记忆文件树所属项目（供对话框同步），并预先写好活动项目，
        // 避免 setActiveProject 内部再次触发文件树关闭/重开与 _navigate 竞争导致"点不动"
        // 【5.1.0 修复】钉住文件夹未关联项目时：不清空活动项目、不覆盖 ft_last_proj 记忆，
        // 否则活动项目 ID 被写成 null → 文件树绑定 null → 下次打开回落到默认第一个项目
        if (!pid) {
            // 【5.1.0 修复】点击未入库的钉住项：自动创建项目并关联该文件夹（真正入库），
            // 而不是只浏览——否则这个钉住项永远是"野"的，匹配不到项目
            if (typeof DB !== 'undefined' && DB.createProject && DB.online) {
                var nm = self._rootNameOf(p);
                DB.createProject(nm).then(function(res) {
                    var newId = (res && res.ok && res.id) ? res.id : null;
                    if (!newId) return;
                    if (typeof Store !== 'undefined' && Store.data && Store.data.projects) {
                        var exists = Store.data.projects.some(function(pp) { return String(pp.id) === String(newId); });
                        if (!exists) Store.data.projects.push({ id: newId, name: nm, folder_path: p });
                    }
                    if (self._projAllProjects) {
                        var ex2 = self._projAllProjects.some(function(pp) { return String(pp.id) === String(newId); });
                        if (!ex2) self._projAllProjects.push({ id: newId, name: nm, folder_path: p });
                    }
                    return DB.linkFolder(newId, p).then(function() {
                        try { localStorage.setItem('ft_last_proj', JSON.stringify({ id: newId, name: nm })); } catch (e2) {}
                        self._ftProjId = newId;
                        self._ftProjName = nm;
                        if (typeof App.setActiveProjectUnified === 'function') App.setActiveProjectUnified(newId, nm);
                        if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('📌 已入库为新项目：' + nm, 'ok');
                        if (self._ftPanelOpen) { self._renderTree(); }
                    });
                }).catch(function(err) {
                    console.warn('钉住项自动入库失败:', err);
                });
            }
            self._navigate(p);
            self._renderTree();
            return;
        }
        try { localStorage.setItem('ft_last_proj', JSON.stringify({ id: pid, name: pname || self._rootNameOf(p) })); } catch (e2) {}
        self._ftProjId = pid;
        self._ftProjName = pname || self._rootNameOf(p);
        self._ftRoot = p;
        // 同步活动项目（重写后的统一系统，见 project-sync.js）：
        // 即使 pid 为 null（钉住的文件夹未关联项目）也必须切换，
        // 否则活动项目停留在上一个项目 → 对话框📁按钮文字永远不更新
        // 【5.1.0 修复】优先走统一入口 setActiveProjectUnified（持久化+广播+同步激活对话一条龙），
        // 仅在其不存在（脚本乱序）时才用直接赋值+兜底广播的旧路径
        if (typeof App.setActiveProjectUnified === 'function') {
            App.setActiveProjectUnified(pid || null, pname || self._rootNameOf(p));
        } else {
            App.activeProject = {
                id: pid || null,
                name: pname || self._rootNameOf(p)
            };
            App.emitProjectChange();
        }
        // 切换文件树根并导航（重设高亮）
        self._navigate(p);
        self._renderTree();
    },
    _sidebarHtml: function() {
        var self = this;
        var html = '';
        var pins = self._getPins();
        html += '<div class="ft-home-title">📌 我的项目</div>';
        if (!pins.length) {
            html += '<div class="ft-node ft-loading-node" style="padding-left:24px">（暂无钉住：浏览到文件夹后点 📌 钉住）</div>';
        } else {
            // 【5.1.0 高亮重写】高亮唯一依据 = 当前项目，而不是“谁包含浏览目录就亮谁”。
            // 旧逻辑：所有包含 _ftCwd 的钉住项都高亮 → 钉了嵌套目录时永远是最外层（第一个）亮，
            //         当前项目反而不亮 —— 这就是“总是第一个高亮”的根因。
            // 新逻辑：
            //   ① 优先：钉住路径 === 当前项目根路径（_ftProjRoot / _ftRoot）→ 精确高亮
            //   ② 兜底：无项目根时，取“包含当前浏览目录”的最长（最具体）钉住项，且只高亮这一个
            var cwdN = self._norm(self._ftCwd || '');
            // 当前项目根路径：按 _ftProjId 反查项目列表（两张表任一命中），查不到再用 _ftRoot
            var projRootN = '';
            try {
                var _prLists = [];
                if (self._projAllProjects && self._projAllProjects.length) _prLists.push(self._projAllProjects);
                try { if (Store.data && Store.data.projects) _prLists.push(Store.data.projects); } catch (e0) {}
                if (App.activeProject && App.activeProject.folder_path) _prLists.push([App.activeProject]);
                for (var _ri = 0; _ri < _prLists.length && !projRootN; _ri++) {
                    for (var _rj = 0; _rj < _prLists[_ri].length; _rj++) {
                        if (self._ftProjId && String(_prLists[_ri][_rj].id) === String(self._ftProjId)
                            && _prLists[_ri][_rj].folder_path) {
                            projRootN = self._norm(_prLists[_ri][_rj].folder_path); break;
                        }
                    }
                }
            } catch (e1) {}
            if (!projRootN) projRootN = self._norm(self._ftCwd || '') || self._norm(self._ftRoot || '');
            var bestPin = '';
            if (projRootN) {
                for (var bi = 0; bi < pins.length; bi++) {
                    if (self._norm(pins[bi]) === projRootN) { bestPin = self._norm(pins[bi]); break; }
                }
            }
            // ① 兜底1：项目根没被钉住 → 高亮“包含项目根”的最具体钉住项（嵌套钉住时取最长路径）
            if (!bestPin && projRootN) {
                for (var ei = 0; ei < pins.length; ei++) {
                    var en = self._norm(pins[ei]);
                    if (self._isUnderDir(en, projRootN) && en.length > bestPin.length) bestPin = en;
                }
            }
            // ② 兜底2：连项目根都没有 → 高亮“包含当前浏览目录”的最具体钉住项
            if (!bestPin && cwdN) {
                for (var ci = 0; ci < pins.length; ci++) {
                    var cn = self._norm(pins[ci]);
                    if (self._isUnderDir(cn, cwdN) && cn.length > bestPin.length) bestPin = cn;
                }
            }
            pins.forEach(function(p) {
                var active = !!bestPin && self._norm(p) === bestPin;
                html += '<div class="ft-node ft-pin-node' + (active ? ' ft-active' : '') + '" data-path="' + self._esq(p) + '" title="' + self._esq(p) + '">' +
                    '<span class="ft-arrow"></span><span class="ft-icon">📌</span>' +
                    '<span class="ft-label">' + self._esq(self._rootNameOf(p)) + '</span>' +
                    '<span class="ft-pin-del" title="取消钉住">✕</span></div>';
            });
        }
        html += '<div class="ft-node ft-side-node" data-act="mycomputer"><span class="ft-arrow"></span><span class="ft-icon">🖥</span><span class="ft-label">我的电脑</span></div>';
        var quick = (self._ftShellData && self._ftShellData.quick) || [];
        var docs = null;
        for (var i = 0; i < quick.length; i++) {
            if (/^(我的文档|Documents)$/i.test(quick[i].name || '') || /我的文档/i.test(quick[i].name || '')) { docs = quick[i]; break; }
        }
        if (docs) {
            html += '<div class="ft-node ft-side-node" data-path="' + self._esq(docs.path) + '"><span class="ft-arrow"></span><span class="ft-icon">📄</span><span class="ft-label">' + self._esq(docs.name) + '</span></div>';
        }
        return html;
    },
    _bindSidebar: function(tree) {
        var self = this;
        var mc = tree.querySelector('[data-act="mycomputer"]');
        if (mc) mc.onclick = function(e) { e.stopPropagation(); self._renderShellHome(); };
        tree.querySelectorAll('.ft-pin-del').forEach(function(del) {
            del.onclick = function(e) {
                e.stopPropagation();
                var node = del.closest('.ft-node');
                var p = self._norm(node.getAttribute('data-path'));
                var pins = self._getPins().filter(function(x) { return self._norm(x) !== p; });
                self._setPins(pins);
                self._renderTree(); self._renderThumbs(); self._updatePinBtn();
            };
        });
        // 【5.1.0 悬停记录】鼠标搭上项目（钉住项）也记录，便于完整排查
        tree.querySelectorAll('.ft-pin-node').forEach(function(node) {
            node.addEventListener('mouseenter', function() {
                var p = node.getAttribute('data-path') || '';
                var rec = { path: p, name: self._rootNameOf(p), time: new Date().toISOString() };
                try { localStorage.setItem('ft_hover_proj', JSON.stringify(rec)); } catch (e) {}
                try {
                    if (typeof UserSettings !== 'undefined' && UserSettings.set) UserSettings.set('ft_hover_proj', rec);
                } catch (e) {}
            });
        });
    },

    // ===== 打开/关闭面板 =====
    openFileTreePanel: function(projId, projName) {
        var self = this;
        var panel = document.getElementById('ftPanel');
        if (!panel) return;
        // 重复打开同一项目：保持面板打开（只通过右上角 ✕ 关闭）
        var pid = projId || null;
        // 无显式项目时恢复上一次文件树所属项目
        if (!pid) {
            // 优先：当前活动项目（唯一状态源）；仅在无活动项目时才回退 ft_last_proj 记忆
            try {
                var ap = App.activeProject;
                if (ap && ap.id) {
                    pid = ap.id;
                    if (!projName) projName = ap.name || '';
                }
            } catch (e) {}
            if (!pid) {
                try {
                    var lp = JSON.parse(localStorage.getItem('ft_last_proj') || 'null');
                    if (lp && lp.id) { pid = lp.id; if (!projName) projName = lp.name || ''; }
                } catch (e) {}
            }
        }
        // 重复打开同一项目：保持面板打开，不关闭（面板只通过右上角 ✕ 关闭）
        if (self._ftPanelOpen) {
            if (String(self._ftProjId || '') === String(pid || '')) {
                // 已经打开：仅刷新渲染，不关闭
                self._renderTree(); self._renderThumbs();
                return;
            }
            // 切换到另一个对话/项目：就地切换根路径，不闪关
            self.closeFileTreePanel();
        }
        self._ftProjId = pid;
        if (!projName && pid) {
            // 名称兜底：活动项目 > 本地列表 > Store
            try {
                if (App.activeProject && String(App.activeProject.id) === String(pid) && App.activeProject.name) {
                    projName = App.activeProject.name;
                }
            } catch (e) {}
            if (!projName) {
                var _lists = [];
                if (self._projAllProjects) _lists.push(self._projAllProjects);
                if (typeof Store !== 'undefined' && Store.data && Store.data.projects) _lists.push(Store.data.projects);
                for (var _li = 0; _li < _lists.length && !projName; _li++) {
                    for (var _ii = 0; _ii < _lists[_li].length; _ii++) {
                        if (String(_lists[_li][_ii].id) === String(pid)) { projName = _lists[_li][_ii].name || ''; break; }
                    }
                }
            }
        }
        self._ftProjName = projName || '';
        // 记忆本次文件树所属项目，供下次自动恢复 & 对话框项目同步
        try {
            if (pid) localStorage.setItem('ft_last_proj', JSON.stringify({ id: pid, name: self._ftProjName }));
            else localStorage.removeItem('ft_last_proj');
        } catch (e) {}
        // 文件树打开时同步：对话框的项目跟随文件树当前项目（统一项目同步系统）
        // 【5.1.0 修复】优先走统一入口 setActiveProjectUnified，保证持久化+广播+激活对话归属同步
        if (typeof App.setActiveProjectUnified === 'function') {
            App.setActiveProjectUnified(pid || null, self._ftProjName || '');
        } else {
            App.activeProject = { id: pid || null, name: self._ftProjName || '' };
            // 兜底：project-sync.js 未加载成功时（如脚本乱序），用最简广播代替，避免整个面板打不开
            if (typeof App.emitProjectChange !== 'function') {
                App.emitProjectChange = function() {
                    try { localStorage.setItem('active_project_id', App.activeProject.id || ''); } catch (e) {}
                    try { localStorage.setItem('active_project_name', App.activeProject.name || ''); } catch (e) {}
                    try { document.dispatchEvent(new CustomEvent('projectchange', { detail: App.activeProject })); } catch (e) {}
                };
            }
            App.emitProjectChange();
        }
        panel.classList.add('open');
        panel.style.transform = 'translateX(0)';
        var overlay = document.getElementById('ftPanelOverlay');
        if (overlay) overlay.classList.add('open');
        self._ftPanelOpen = true;
        // 恢复排序/视图设置 + 绑定 Delete 快捷键
        var l = self._getLayout();
        self._ftSortMode = l.sortMode || 'cat';
        self._ftViewMode = l.viewMode || 'thumb';
        self._bindFsHotkeys();
        self._renderShell();
        // 优先：项目根 > 钉住路径 > 我的主页
        // 【5.1.0 优化】面板展开后延迟 0.2s，再按 JSON 持久化位置定位+高亮，
        // 让展开动画先走完，高亮节点定位更稳、视觉上能明确看到"定位到当前项目"。
        var start = null;
        if (projId) {
            setTimeout(function() { self._loadRoot(); }, 200);
            return;
        }
        var pin = self._getPin();
        if (pin) { self._ftRoot = self._norm(pin); start = self._ftRoot; }
        if (!start) {
            // 无项目无钉住：回退到上一次文件树浏览的路径
            var last = '';
            try { last = localStorage.getItem('ft_last_cwd') || ''; } catch (e) {}
            if (last) { self._ftRoot = self._norm(last); start = self._ftRoot; }
        }
        if (start) setTimeout(function() { self._navigate(start); }, 200);
        else self._renderShellHome();
    },

    closeFileTreePanel: function() {
        var panel = document.getElementById('ftPanel');
        if (panel) { panel.classList.remove('open'); panel.style.transform = 'translateX(-100%)'; }
        var overlay = document.getElementById('ftPanelOverlay');
        if (overlay) overlay.classList.remove('open');
        this._ftPanelOpen = false;
    },

    toggleFileTreePanel: function() {
        if (this._ftPanelOpen) this.closeFileTreePanel();
        else this.openFileTreePanel(this._ftProjId, this._ftProjName);
    },

    // ===== 历史 =====
    _histPush: function(dirPath) {
        var self = this;
        if (self._ftHistPos < self._ftHist.length - 1) self._ftHist = self._ftHist.slice(0, self._ftHistPos + 1);
        if (self._ftHist[self._ftHist.length - 1] !== dirPath) {
            self._ftHist.push(dirPath);
            if (self._ftHist.length > 60) self._ftHist.shift();
        }
        self._ftHistPos = self._ftHist.length - 1;
        self._updateNavBtns();
    },
    _ftBack: function() {
        if (this._ftHistPos <= 0) return;
        this._ftHistPos--; this._updateNavBtns();
        this._navigate(this._ftHist[this._ftHistPos], { noHist: true });
    },
    _ftForward: function() {
        if (this._ftHistPos >= this._ftHist.length - 1) return;
        this._ftHistPos++; this._updateNavBtns();
        this._navigate(this._ftHist[this._ftHistPos], { noHist: true });
    },
    _updateNavBtns: function() {
        var b = document.getElementById('ftBackBtn'), f = document.getElementById('ftFwdBtn');
        if (b) { b.disabled = this._ftHistPos <= 0; b.style.opacity = b.disabled ? .35 : 1; }
        if (f) { f.disabled = this._ftHistPos >= this._ftHist.length - 1; f.style.opacity = f.disabled ? .35 : 1; }
    },

    // ===== 项目根加载 =====
    _loadRoot: function() {
        var self = this;
        var done = function(found) {
            if (found && found.folder_path) {
                self._ftRoot = self._norm(found.folder_path);
                self._navigate(self._ftRoot);
            } else {
                // 查不到项目（列表未加载/项目被删）：以活动项目 id 再查一次，仍无则回主页。
                // 禁止回退到钉住路径（否则会误切到第一个钉住项目）
                var actPid = (App.activeProject && App.activeProject.id) || null;
                var actProj = null;
                if (actPid) {
                    var list2 = self._projAllProjects || [];
                    for (var ai = 0; ai < list2.length; ai++) {
                        if (String(list2[ai].id) === String(actPid)) { actProj = list2[ai]; break; }
                    }
                }
                if (actProj && actProj.folder_path) {
                    self._ftRoot = self._norm(actProj.folder_path);
                    self._navigate(self._ftRoot);
                } else {
                    self._renderShellHome();
                }
            }
        };
        var list = self._projAllProjects || [];
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(self._ftProjId)) { done(list[i]); return; }
        }
        if (typeof DB !== 'undefined' && DB.getProjects) {
            DB.getProjects().then(function(res) {
                var items = (res && res.ok && res.data) ? res.data : [], found = null;
                for (var j = 0; j < items.length; j++) {
                    if (String(items[j].id) === String(self._ftProjId)) { found = items[j]; break; }
                }
                done(found);
            }).catch(function() { done(null); });
        } else done(null);
    },

    // ===== 数据加载（统一走 /api/fs/browse，简单可靠）=====
    _loadDirData: function(dirPath, cb) {
        var self = this;
        var key = self._norm(dirPath);
        if (!key) { cb(null, '无路径'); return; }
        if (self._ftDirCache[key]) {
            var _cached = self._ftDirCache[key];
            var _now = Date.now();
            if (_cached._ts && (_now - _cached._ts) < 2000) { cb(_cached); return; }  // 缓存 2 秒内有效，过期则重新拉取，避免删除/新增文件后显示旧数据
        }
        var url = '/api/fs/browse?path=' + encodeURIComponent(key);
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data && data.ok) {
                    data._ts = Date.now();
                    self._ftDirCache[key] = data;
                    // 服务器返回的 realpath 可能与请求 key 不一致（大小写/短路径），双 key 缓存避免查不到
                    var rp = self._norm(data.path);
                    if (rp && rp !== key) self._ftDirCache[rp] = data;
                    cb(data);
                }
                else cb(null, (data && data.error) || '加载失败');
            })
            .catch(function(err) { cb(null, String(err)); });
    },

    // ===== 追加加载下一页文件（加载更多）=====
    _ftLoadMore: function() {
        var self = this;
        var key = self._norm(self._ftCwd);
        var data = self._ftDirCache[key];
        if (!data || !data.has_more || self._ftLoadingMore) return;
        self._ftLoadingMore = true;
        var offset = (data.files || []).length;
        var url = '/api/fs/browse?path=' + encodeURIComponent(key) + '&offset=' + offset + '&limit=' + (data.limit || 500);
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(nd) {
                self._ftLoadingMore = false;
                if (nd && nd.ok) {
                    var existing = {};
                    (data.files || []).forEach(function(f) { existing[f.path] = true; });
                    (nd.files || []).forEach(function(f) { if (!existing[f.path]) data.files.push(f); });
                    data.total_files = nd.total_files;
                    data.has_more = nd.has_more;
                    data.limit = nd.limit;
                    data._ts = Date.now();
                    self._renderThumbs();
                }
            })
            .catch(function() { self._ftLoadingMore = false; });
    },

    // ===== 导航 =====
    _navigate: function(dirPath, opts) {
        var self = this;
        opts = opts || {};
        var key = self._norm(dirPath);
        if (!key) { self._renderShellHome(); return; }
        self._loadDirData(key, function(data, err) {
            if (err || !data) {
                if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('无法打开: ' + (err || key), 'error');
                return;
            }
            self._ftCwd = data.path || key;
            try { localStorage.setItem('ft_last_cwd', self._norm(self._ftCwd)); } catch (e) {}
            // 5.0.7 记忆增强：浏览位置同步持久化到 user_settings.json，重启后仍记住
            try { if (typeof UserSettings !== 'undefined' && UserSettings.set) UserSettings.set('ft_last_cwd', self._norm(self._ftCwd)); } catch (e) {}
            if (!self._ftRoot || !self._isUnderRoot(self._ftCwd)) self._ftRoot = self._norm(self._ftCwd);
            if (!opts.noHist) self._histPush(self._ftCwd);
            self._ftExpanded[self._norm(self._ftCwd)] = true;   // 进入的目录自动展开
            self._expandAncestors(self._ftCwd);                 // 展开祖先链，保证当前目录在持久树中可见
            self._renderTree();
            self._renderThumbs();
            self._updatePathbar();
            self._updatePinBtn();
            // 【5.1.0 修复】浏览目录联动项目图标：若当前浏览目录命中的最长钉住项
            // 已关联某项目，且 ≠ 当前活动项目 → 自动切换活动项目并广播，
            // 对话框📁按钮（App.activeProject 单一状态源）随之更新。
            // 注意：必须先切换项目、再执行 _syncProjectFolder，否则会把旧项目的
            // folder_path 错改成当前目录，既污染原项目又导致匹配不到新项目。
            try { self._autoSwitchProjectByCwd(); } catch (e) {}
            self._syncProjectFolder();
        });
    },

    // 浏览目录 → 自动切换活动项目（仅当命中钉住项且已关联项目时）
    _autoSwitchProjectByCwd: function() {
        var self = this;
        if (!self._ftCwd) return;
        // 防循环：由本函数触发的导航不再重复判定
        if (self._autoSwitchBusy) return;
        var cur = self._currentPinOf();
        if (!cur) return;
        // 两张项目表都查：浏览目录位于某项目 folder_path 之下（含相等）即命中，
        // 多个命中时取路径最长（最具体）的项目。【修复】原来要求完全相等，
        // 浏览到项目子目录或仅选中文件时不会切换当前项目。
        var hit = null;
        var lists = [];
        if (Store.data && Store.data.projects) lists.push(Store.data.projects);
        if (self._projAllProjects && self._projAllProjects.length) lists.push(self._projAllProjects);
        var cwdN = self._norm(self._ftCwd || '').toLowerCase();
        for (var li = 0; li < lists.length; li++) {
            var lst = lists[li];
            for (var i = 0; i < lst.length; i++) {
                var fp = self._norm(lst[i].folder_path || '');
                if (!fp) continue;
                var fpN = fp.toLowerCase();
                var isUnder = (cwdN === fpN) || (cwdN.indexOf(fpN + '\\') === 0);
                if (isUnder && (!hit || fp.length > self._norm(hit.folder_path || '').length)) { hit = lst[i]; }
            }
        }
        if (!hit || !hit.id) return;   // 未关联项目的钉住目录：不切换（保持现状）
        var apid = (App.activeProject && App.activeProject.id) || '';
        if (String(apid) === String(hit.id)) return;   // 已是当前项目
        self._autoSwitchBusy = true;
        try {
            if (typeof App.setActiveProjectUnified === 'function') {
                App.setActiveProjectUnified(hit.id, hit.name || '');
            } else {
                App.activeProject = { id: hit.id, name: hit.name || '' };
                if (typeof App.emitProjectChange === 'function') App.emitProjectChange();
            }
            self._ftProjId = hit.id;
            self._ftProjName = hit.name || '';
        } finally {
            setTimeout(function(){ self._autoSwitchBusy = false; }, 0);
        }
    },

    _ftUp: function() {
        var self = this;
        var norm = self._norm(self._ftCwd);
        if (!norm) { self._renderShellHome(); return; }
        var noDrive = norm.replace(/^[a-zA-Z]:/, '');
        if (!noDrive || noDrive === '\\') { self._renderShellHome(); return; }
        var parent = norm.replace(/\\[^\\]+$/, '');
        if (/^[a-zA-Z]:$/.test(parent)) parent += '\\';
        self._navigate(parent);
    },

    _isUnderRoot: function(p) {
        if (!this._ftRoot || !p) return false;
        var r = this._norm(this._ftRoot).toLowerCase(), q = this._norm(p).toLowerCase();
        return q === r || q.indexOf(r + '\\') === 0;
    },

    // ===== 树展开/收起 =====
    _expandAncestors: function(dirPath) {
        // 逐级展开祖先（直到盘符根），使当前目录在持久树中始终可见
        var key = this._norm(dirPath);
        var noDrive = key.replace(/^[a-zA-Z]:/, '');
        var parts = noDrive.split('\\').filter(function(s) { return s !== ''; });
        var acc = key.slice(0, 2);
        if (this._norm(key).length >= 2) this._ftExpanded[acc + '\\'] = true;
        for (var i = 0; i < parts.length; i++) {
            acc += (acc.slice(-1) === '\\' ? '' : '\\') + parts[i];
            var load = acc;
            this._loadDirData(load, function() {});   // 预取，渲染树时直接命中缓存
            this._ftExpanded[load] = true;
        }
    },
    _onTreeNodeClick: function(dirPath) {
        var self = this;
        var key = self._norm(dirPath);
        if (self._ftExpanded[key]) { delete self._ftExpanded[key]; self._renderTree(); return; }
        self._loadDirData(key, function(data, err) {
            if (data) { self._ftExpanded[key] = true; self._renderTree(); }
            else if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('无法展开: ' + err, 'error');
        });
    },

    // ===== 渲染骨架：顶部一排 + 下面两列 =====
    _renderShell: function() {
        var panel = document.getElementById('ftPanel');
        if (!panel) return;
        var self = this;
        var header = panel.querySelector('.ft-header');
        var body = panel.querySelector('.ft-body');
        if (header) {
            header.style.display = 'flex';
            header.style.justifyContent = 'flex-start';
            header.style.padding = '6px 8px';
            header.innerHTML =
                '<button class="ft-nav-btn" id="ftBackBtn" title="后退">◀</button>' +
                '<button class="ft-nav-btn" id="ftFwdBtn" title="前进">▶</button>' +
                '<button class="ft-nav-btn" id="ftUpBtn" title="向上">⬆</button>' +
                '<span class="ft-breadcrumb" id="ftBreadcrumb"></span>' +
                '<button class="ft-nav-btn" id="ftRefreshBtn" title="刷新">⟳</button>' +
                '<button class="ft-nav-btn" id="ftPinBtn" title="钉住当前路径">📌</button>' +
                '<span style="flex:1"></span>' +
                '<button class="ft-nav-btn" id="ftRecordBtn" title="录音（右键选设备/音量）">🔴</button>' +
                '<button class="ft-nav-btn" id="ftScreenRecBtn" title="录制屏幕（右键选区域/音频）">🎥</button>' +
                '<button class="ft-nav-btn" id="ftCloseBtn" title="关闭">✕</button>';
        }
        if (!body) return;
        body.innerHTML =
            '<div class="ft-cols">' +
                '<div class="ft-tree" id="ftTree"></div>' +
                '<div class="ft-splitter" id="ftSplitter" title="拖拽调整左右宽度"></div>' +
                '<div class="ft-thumbs" id="ftThumbs"></div>' +
            '</div>' +
            '<div class="ft-resizer" id="ftResizer" title="拖拽调整面板宽度"></div>';
        var closeBtnEl = document.getElementById('ftCloseBtn');
        if (closeBtnEl) closeBtnEl.onclick = function() { self.closeFileTreePanel(); };
        document.getElementById('ftBackBtn').onclick = function() { self._ftBack(); };
        document.getElementById('ftFwdBtn').onclick = function() { self._ftForward(); };
        document.getElementById('ftUpBtn').onclick = function() { self._ftUp(); };
        document.getElementById('ftRefreshBtn').onclick = function() {
            delete self._ftDirCache[self._norm(self._ftCwd)];
            self._navigate(self._ftCwd, { noHist: true });
        };
        document.getElementById('ftPinBtn').onclick = function() { self._togglePin(); };
        var recBtn = document.getElementById('ftRecordBtn');
        if (recBtn) {
            recBtn.onclick = function() { App.toggleRecord(); };
            recBtn.oncontextmenu = function(e) { e.preventDefault(); App.showRecordMenu(e, 'audio'); };
        }
        var srBtn = document.getElementById('ftScreenRecBtn');
        if (srBtn) {
            srBtn.onclick = function() { App.toggleScreenRecord(); };
            srBtn.oncontextmenu = function(e) { e.preventDefault(); App.showRecordMenu(e, 'screen'); };
        }
        self._initDrag();
        self._applyLayout();
        self._updateNavBtns();
        self._updatePathbar();
        self._updatePinBtn();
    },

    // ===== 面包屑路径栏 =====
    _updatePathbar: function() {
        var self = this;
        var crumb = document.getElementById('ftBreadcrumb');
        if (!crumb) return;
        var cwd = self._ftCwd || '';
        if (!cwd) { crumb.innerHTML = '<span class="ft-crumb-dim">🖥 我的电脑</span>'; return; }
        var parts = self._norm(cwd).split('\\').filter(function(s) { return s !== ''; });
        var acc = '', html = '';
        parts.forEach(function(p, i) {
            acc = (i === 0) ? (p + '\\') : (acc + p + (i < parts.length - 1 ? '\\' : ''));
            var isLast = (i === parts.length - 1);
            html += '<span class="ft-crumb' + (isLast ? ' ft-crumb-last' : '') + '" data-path="' + self._esq(acc) + '" title="' + self._esq(acc) + '">' + self._esq(p) + '</span>';
            if (!isLast) html += '<span class="ft-crumb-sep">›</span>';
        });
        html += '<input class="ft-crumb-input" id="ftCrumbInput" placeholder="输入路径回车跳转..." spellcheck="false" />';
        crumb.innerHTML = html;
        crumb.querySelectorAll('.ft-crumb').forEach(function(c) {
            c.onclick = function() { self._navigate(c.getAttribute('data-path')); };
        });
        var inp = document.getElementById('ftCrumbInput');
        if (inp) {
            inp.onkeydown = function(e) {
                if (e.key === 'Enter') { var v = inp.value.trim(); if (v) self._navigate(v); }
            };
        }
    },

    // ===== 我的主页（磁盘 + 快捷目录）=====
    _ftShellData: null,
    _renderShellHome: function() {
        var self = this;
        self._ftCwd = '';
        if (!self._ftProjId && self._getPin()) self._ftRoot = self._norm(self._getPin());
        self._renderShell();
        var tree = document.getElementById('ftTree');
        var build = function() {
            var d = self._ftShellData;
            var html = self._sidebarHtml();
            html += '<div class="ft-home-title">💾 磁盘</div>';
            (d.drives || []).forEach(function(x) {
                html += '<div class="ft-node" data-path="' + self._esq(x.path) + '"><span class="ft-arrow"></span><span class="ft-icon">💾</span><span class="ft-label">' + self._esq(x.name) + '</span></div>';
            });
            html += '<div class="ft-home-title">📌 快捷目录</div>';
            (d.quick || []).forEach(function(x) {
                html += '<div class="ft-node" data-path="' + self._esq(x.path) + '"><span class="ft-arrow"></span><span class="ft-icon">📁</span><span class="ft-label">' + self._esq(x.name) + '</span></div>';
            });
            tree.innerHTML = html;
            self._bindSidebar(tree);
            tree.querySelectorAll('.ft-node').forEach(function(node) {
                node.onclick = function(e) {
                    e.stopPropagation();
                    var act = node.getAttribute('data-act');
                    if (act === 'mycomputer') { self._renderShellHome(); return; }
                    self._navigate(node.getAttribute('data-path'));
                };
            });
        };
        if (self._ftShellData) build();
        else {
            fetch('/api/fs/browse', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(d) { if (d && d.ok) { self._ftShellData = d; build(); } })
                .catch(function() { if (tree) tree.innerHTML = '<div class="ft-empty">加载磁盘失败</div>'; });
        }
        var box = document.getElementById('ftThumbs');
        if (box) box.innerHTML = '<div class="ft-empty">选择左侧目录浏览文件</div>';
        self._updatePathbar();
    },

    _rootNameOf: function(p) {
        var r = this._norm(p);
        var m = r.match(/[^\\]+$/);
        return m ? m[0] : r;
    },

    // ===== 渲染目录树（持久树：永远显示 我的电脑 + 所有盘符，可逐级展开，不随浏览位置消失）=====
    _renderTree: function() {
        var tree = document.getElementById('ftTree');
        if (!tree) return;
        var self = this;
        var build = function() {
            var html = self._sidebarHtml();
            html += '<div class="ft-home-title">💾 磁盘</div>';
            var drives = (self._ftShellData && self._ftShellData.drives) || [];
            drives.forEach(function(x) {
                var dk = self._norm(x.path);
                var expanded = !!self._ftExpanded[dk];
                var active = self._norm(self._ftCwd) === dk;
                html += '<div class="ft-node' + (active ? ' ft-active' : '') + '" data-path="' + self._esq(dk) + '">' +
                    '<span class="ft-arrow">' + (expanded ? '▼' : '▶') + '</span>' +
                    '<span class="ft-icon">💾</span>' +
                    '<span class="ft-label">' + self._esq(x.name) + '</span></div>';
                html += self._renderTreeLevel(dk, 1);
            });
            tree.innerHTML = html;
            self._bindSidebar(tree);
            tree.querySelectorAll('.ft-node').forEach(function(node) {
                if (node.getAttribute('data-act') === 'mycomputer') return;
                var p = node.getAttribute('data-path');
                node.onclick = function(e) {
                    e.stopPropagation();
                    if (e.target.classList.contains('ft-arrow')) { self._onTreeNodeClick(p); return; }
                    if (node.classList.contains('ft-pin-node')) self._activatePinProject(p);
                    self._navigate(p);
                };
            });
        };
        // 首次：先拉取盘符/快捷目录数据，再渲染
        if (self._ftShellData) { build(); return; }
        fetch('/api/fs/browse', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) { if (d && d.ok) { self._ftShellData = d; build(); } else build(); })
            .catch(function() { build(); });
    },

    _renderTreeLevel: function(dirPath, depth) {
        var self = this;
        var key = self._norm(dirPath);
        if (!self._ftExpanded[key]) return '';
        var data = self._ftDirCache[key];
        if (!data) {
            self._loadDirData(key, function(d) { if (d) self._renderTree(); });
            return '<div class="ft-node ft-loading-node" style="padding-left:' + (depth * 16) + 'px">⏳</div>';
        }
        var html = '';
        (data.dirs || []).forEach(function(d) {
            var dk = self._norm(d.path);
            var expanded = !!self._ftExpanded[dk];
            var active = self._norm(self._ftCwd) === dk;
            html += '<div class="ft-node' + (active ? ' ft-active' : '') + '" data-path="' + self._esq(dk) + '" style="padding-left:' + (depth * 16) + 'px">' +
                '<span class="ft-arrow">' + (expanded ? '▼' : '▶') + '</span>' +
                '<span class="ft-icon">📁</span>' +
                '<span class="ft-label" title="' + self._esq(dk) + '">' + self._esq(d.name) + '</span></div>';
            html += self._renderTreeLevel(dk, depth + 1);
        });
        if (!(data.dirs || []).length) {
            html += '<div class="ft-node ft-loading-node" style="padding-left:' + (depth * 16) + 'px">（无子目录）</div>';
        }
        return html;
    },

    // ===== 双击缩略图：图片在 ImageViewer 中打开（幻灯片）；文本文件轻量预览；其他类型不请求 /api/fs/file =====
    _TEXT_OPEN_EXTS: ['txt','md','log','py','js','json','html','css','xml','csv','ini','cfg','bat','sh','yml','yaml','sql','ts','bak'],
    _isTextFile: function(name) {
        var parts = String(name).toLowerCase().split('.');
        if (parts.length < 2) return false;
        var ext = parts.pop();
        if (ext === 'bak' && parts.length >= 2 && this._TEXT_OPEN_EXTS.indexOf(parts[parts.length - 1]) >= 0) return true;
        return this._TEXT_OPEN_EXTS.indexOf(ext) >= 0;
    },
    _openTextPreview: function(path, name) {
        var self = this;
        fetch('/api/fs/text?path=' + encodeURIComponent(path)).then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function(j) {
            var text = (j && j.text) || '';
            var realPath = (j && j.path) || path;
            var old = document.getElementById('ftTextPreviewMask');
            if (old) old.remove();
            var mask = document.createElement('div');
            mask.id = 'ftTextPreviewMask';
            mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;';
            var box = document.createElement('div');
            box.style.cssText = 'background:#1e1e1e;color:#d4d4d4;border-radius:8px;width:min(1000px,92vw);height:min(760px,88vh);display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.5);overflow:hidden;';
            var head = document.createElement('div');
            head.style.cssText = 'padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;background:#252526;flex:none;';
            head.innerHTML = '<span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📄 ' + self._esq(name || path) + '</span>';
            var headRight = document.createElement('div');
            headRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
            var status = document.createElement('span');
            status.style.cssText = 'font-size:11px;color:#888;';
            status.textContent = '';
            var saveBtn = document.createElement('button');
            saveBtn.textContent = '💾 保存 (Ctrl+S)';
            saveBtn.style.cssText = 'background:#0e639c;color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:12px;cursor:pointer;';
            var closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = 'background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 6px;';
            closeBtn.onclick = function() { mask.remove(); document.removeEventListener('keydown', keyHandler); if (self._textPreview && self._textPreview.ta === ta) self._textPreview = null; };
            headRight.appendChild(status);
            headRight.appendChild(saveBtn);
            headRight.appendChild(closeBtn);
            head.appendChild(headRight);
            // ===== VSCode 风格编辑区：行号槽 + 透明 textarea 覆盖同步滚动 =====
            var body = document.createElement('div');
            body.style.cssText = 'flex:1;display:flex;overflow:hidden;position:relative;';
            var gutter = document.createElement('div');
            gutter.style.cssText = 'flex:none;width:52px;overflow:hidden;background:#1e1e1e;color:#858585;font:12px/1.55 Consolas,Monaco,monospace;text-align:right;padding:12px 8px 12px 0;user-select:none;border-right:1px solid #333;white-space:pre;';
            var editorWrap = document.createElement('div');
            editorWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.spellcheck = false;
            ta.wrap = 'off';
            ta.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:transparent;color:#d4d4d4;border:none;outline:none;resize:none;font:12px/1.55 Consolas,Monaco,monospace;padding:12px;white-space:pre;overflow:auto;tab-size:4;caret-color:#fff;';
            editorWrap.appendChild(ta);
            body.appendChild(gutter);
            body.appendChild(editorWrap);
            // 行号渲染 + 滚动同步
            var dirty = false; var origText = text;
            function renderGutter() {
                var lines = ta.value.split('\n').length;
                var nums = '';
                for (var i = 1; i <= lines; i++) nums += i + '\n';
                gutter.textContent = nums;
            }
            function syncScroll() { gutter.scrollTop = ta.scrollTop; }
            function markDirty() {
                if (!dirty && ta.value !== origText) { dirty = true; status.textContent = '● 未保存'; status.style.color = '#e2c08d'; }
                else if (dirty && ta.value === origText) { dirty = false; status.textContent = ''; }
            }
            ta.addEventListener('input', function() { renderGutter(); markDirty(); });
            ta.addEventListener('scroll', syncScroll);
            ta.addEventListener('keydown', function(e) {
                // Tab 缩进（选中行整体缩进 / 缩进选中内容）
                if (e.key === 'Tab') {
                    e.preventDefault();
                    var s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
                    if (s !== en && v.slice(s, en).indexOf('\n') >= 0) {
                        var ls = v.lastIndexOf('\n', s - 1) + 1;
                        var block = v.slice(ls, en);
                        var shifted = e.shiftKey
                            ? block.replace(/^ {1,4}/gm, '')
                            : block.replace(/^/gm, '    ');
                        ta.value = v.slice(0, ls) + shifted + v.slice(en);
                        ta.selectionStart = ls; ta.selectionEnd = ls + shifted.length;
                    } else {
                        ta.value = v.slice(0, s) + '    ' + v.slice(en);
                        ta.selectionStart = ta.selectionEnd = s + 4;
                    }
                    renderGutter(); markDirty();
                }
            });
            // ===== 保存 =====
            function doSave() {
                saveBtn.disabled = true;
                status.textContent = '保存中…'; status.style.color = '#888';
                fetch('/api/fs/text-save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: realPath, text: ta.value })
                }).then(function(r) { return r.json(); }).then(function(d) {
                    saveBtn.disabled = false;
                    if (d && d.ok) {
                        origText = ta.value; dirty = false;
                        status.textContent = '✓ 已保存 ' + new Date().toLocaleTimeString();
                        status.style.color = '#89d185';
                        if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('已保存: ' + (name || realPath), 'ok');
                        _origDoSaveDone();
                    } else {
                        status.textContent = '保存失败: ' + ((d && d.error) || '');
                        status.style.color = '#f48771';
                    }
                }).catch(function(err) {
                    saveBtn.disabled = false;
                    status.textContent = '保存失败: ' + err.message;
                    status.style.color = '#f48771';
                });
            }
            saveBtn.onclick = doSave;
            function keyHandler(e) {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
                if (e.key === 'Escape') { mask.remove(); document.removeEventListener('keydown', keyHandler); if (self._textPreview && self._textPreview.ta === ta) self._textPreview = null; }
            }
            document.addEventListener('keydown', keyHandler);
            renderGutter();
            // 【对话区联动】记录当前打开的文本预览，供 getProjectContext 读取框选内容
            self._textPreview = { path: realPath, name: name || realPath, ta: ta, origText: text };
            // 保存成功后同步：更新预览记录 + 通知文件树/缩略图刷新
            var _origDoSaveDone = function() {
                self._textPreview.origText = ta.value;
                try { document.dispatchEvent(new CustomEvent('fttextsaved', { detail: { path: realPath } })); } catch (e) {}
                try { if (typeof self._loadDirData === 'function' && self._ftCwd) self._loadDirData(self._ftCwd, function(d) { if (d) self._renderThumbs(); }); } catch (e) {}
            };
            box.appendChild(head);
            box.appendChild(body);
            mask.appendChild(box);
            mask.onclick = function(e) { if (e.target === mask) { mask.remove(); document.removeEventListener('keydown', keyHandler); if (self._textPreview && self._textPreview.ta === ta) self._textPreview = null; } };
            document.body.appendChild(mask);
            ta.focus();
        }).catch(function(err) {
            if (window.Toast && window.Toast.show) window.Toast.show('无法打开文件: ' + err.message, 'error');
            else alert('无法打开文件: ' + err.message);
        });
    },
    _openThumbInViewer: function(path) {
        var self = this;
        // 非图片文件：不再请求 /api/fs/file（该接口对非图片返回 403）
        var name = String(path).split(/[\\/]/).pop() || '';
        if (!/\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?)$/i.test(name)) {
            if (self._isTextFile(name)) { self._openTextPreview(path, name); }
            // 视频：走图片查看器的视频播放通道（该查看器已支持 mp4/webm 等）
            else if (/\.(mp4|webm|ogv|ogg|mov|m4v|mkv|avi)$/i.test(name)) {
                if (window.ImageViewer && window.ImageViewer.show) {
                    window.ImageViewer.show('/api/fs/file?path=' + encodeURIComponent(path));
                    var title = document.querySelector('.iv-float-panel .iv-title');
                    if (title) title.textContent = '🎬 ' + name;
                }
            }
            else if (window.Toast && window.Toast.show) window.Toast.show('暂不支持预览该类型: ' + name, 'info');
            return;
        }
        if (!window.ImageViewer || !window.ImageViewer.show) return;
        var norm = self._norm(self._ftCwd);
        var data = self._ftDirCache[norm];
        var list = [];
        var startIdx = 0;
        if (data && data.files && data.files.length) {
            data.files.forEach(function(f) {
                if (f.image) {
                    list.push({
                        url: '/api/fs/file?path=' + encodeURIComponent(f.path),
                        name: f.name
                    });
                }
            });
            for (var i = 0; i < list.length; i++) {
                if (list[i].url.indexOf(encodeURIComponent(path)) !== -1) { startIdx = i; break; }
            }
        }
        if (!list.length) {
            // 找不到列表（缓存缺失等）就单图打开
            window.ImageViewer.show('/api/fs/file?path=' + encodeURIComponent(path));
            return;
        }
        window.ImageViewer.setSlideList(list, startIdx);
        window.ImageViewer.show(list[startIdx].url);
        var title = document.querySelector('.iv-float-panel .iv-title');
        if (title) title.textContent = '🖼 ' + (list[startIdx].name || '') + '（' + (startIdx + 1) + '/' + list.length + '）';
    },

    // ===== 渲染缩略图（右侧，与左侧联动）=====
    _renderThumbs: function() {
        var box = document.getElementById('ftThumbs');
        if (!box) return;
        var self = this;
        var data = self._ftDirCache[self._norm(self._ftCwd)];
        if (!data) {
            // 缓存 key 对不上（realpath 规整了大小写/短路径等）→ 主动加载后重渲染，避免永远卡在 ⏳
            box.innerHTML = '<div class="ft-empty">⏳</div>';
            var cwdKey = self._norm(self._ftCwd);
            if (cwdKey && !box.__retrying) {
                box.__retrying = true;
                self._loadDirData(self._ftCwd, function(d, err) {
                    box.__retrying = false;
                    if (d) self._renderThumbs();
                    else box.innerHTML = '<div class="ft-empty">加载失败: ' + self._esq(err || cwdKey) + '</div>';
                });
            } else if (!cwdKey) {
                box.innerHTML = '<div class="ft-empty">选择左侧目录浏览文件</div>';
            }
            return;
        }
        var files = data.files || [];
        var dirs = data.dirs || [];
        if (!files.length && !dirs.length) { box.innerHTML = '<div class="ft-empty">（当前目录没有文件）</div>'; return; }
        // 排序：cat=分类(类型分组) / name=名称 / date=日期
        var sortMode = self._ftSortMode || 'cat';
        var sorted = files.slice();
        var typeOrder = function(f) {
            var ext = (String(f.name).split('.').pop() || '').toLowerCase();
            if (f.image) return 0;
            if (['max','ms','obj','fbx','blend','ma','mb'].indexOf(ext) >= 0) return 1;
            if (['zip','rar','7z'].indexOf(ext) >= 0) return 2;
            return 3;
        };
        if (sortMode === 'name') sorted.sort(function(a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
        else if (sortMode === 'date') sorted.sort(function(a, b) { return (b.mtime || 0) - (a.mtime || 0); });
        else { sorted.sort(function(a, b) { return typeOrder(a) - typeOrder(b) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1); }); }
        var html = '';
        var dirCards = dirs.slice();
        dirCards.sort(function(a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
        var bindDirCard = function(t) {
            var p = t.getAttribute('data-path');
            t.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                self._ftSelected = {};
                self._navigate(p);
            };
        };
        var dirRowsHtml = '';
        dirCards.forEach(function(d) {
            dirRowsHtml += '<div class="ft-file-row ft-dir-row" data-path="' + self._esq(d.path) + '" title="' + self._esq(d.name) + '">' +
                '<span class="ft-row-icon">📁</span>' +
                '<span class="ft-row-name">' + self._esq(d.name) + '</span>' +
                '<span class="ft-row-type">文件夹</span>' +
                '<span class="ft-row-size"></span>' +
                '<span class="ft-row-date"></span>' +
            '</div>';
        });
        if (self._ftViewMode === 'list') {
            html += '<div class="ft-file-list">' + dirRowsHtml;
            sorted.forEach(function(f) {
                var ext = (String(f.name).split('.').pop() || '').toUpperCase();
                var dt = f.mtime ? new Date(f.mtime) : null;
                var ds = dt ? (dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')) : '';
                var sz = f.size != null ? (f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') : '';
                html += '<div class="ft-file-row" data-path="' + self._esq(f.path) + '" title="' + self._esq(f.name) + '">' +
                    '<span class="ft-row-icon">' + (f.image ? '🖼' : self._extIcon(f.name)) + '</span>' +
                    '<span class="ft-row-name">' + self._esq(f.name) + '</span>' +
                    '<span class="ft-row-type">' + self._esq(ext || '-') + '</span>' +
                    '<span class="ft-row-size">' + sz + '</span>' +
                    '<span class="ft-row-date">' + ds + '</span>' +
                '</div>';
            });
            html += '</div>';
        } else {
            var dirCardsHtml = '';
            dirCards.forEach(function(d) {
                dirCardsHtml += '<div class="ft-thumb ft-dir-card" data-path="' + self._esq(d.path) + '" title="' + self._esq(d.name) + '">' +
                    '<div class="ft-thumb-img" style="display:flex;align-items:center;justify-content:center;font-size:34px;">📁</div>' +
                    '<div class="ft-thumb-name">' + self._esq(d.name) + '</div>' +
                '</div>';
            });
            html += '<div class="ft-thumbs-grid">' + dirCardsHtml;
            sorted.forEach(function(f) {
                var isImg = !!f.image;
                var isVid = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|avi)$/i.test(String(f.name));
                var src = isImg ? ('/api/fs/file?path=' + encodeURIComponent(f.path)) : '';
                html += '<div class="ft-thumb" data-path="' + self._esq(f.path) + '" title="' + self._esq(f.name) + '">' +
                    '<div class="ft-thumb-img">' +
                        (isImg
                            ? '<img src="' + self._esq(src) + '" loading="lazy" onerror="this.parentNode.innerHTML=\'🖼\'" />'
                            : (isVid
                                ? '<video src="' + self._esq('/api/fs/file?path=' + encodeURIComponent(f.path)) + '" muted preload="metadata" onerror="this.parentNode.innerHTML=\'🎬\'"></video>'
                                : self._extIcon(f.name))) +
                    '</div>' +
                    '<div class="ft-thumb-name">' + self._esq(f.name) + '</div>' +
                '</div>';
            });
            html += '</div>';
        }
        box.innerHTML = '<div class="ft-thumbs-title">' +
            '<span>📁 ' + dirs.length + ' 个文件夹 · 📄 ' + files.length + ' 个文件' +
            '<span class="ft-sel-hint" id="ftSelHint">' + self._selCountText() + '</span></span>' +
            '<span class="ft-thumbs-tools">' +
                '<select class="ft-nav-btn" id="ftSortSel" title="排序方式" style="width:auto;cursor:pointer">' +
                    '<option value="cat">分类</option><option value="name">名称</option><option value="date">日期</option>' +
                '</select>' +
                '<button class="ft-nav-btn" id="ftViewBtn" title="缩略图/列表切换">' + ((self._ftViewMode === 'list') ? '🖼' : '🗂') + '</button>' +
            '</span></div>' + html +
            (data.has_more ? '<div class="ft-load-more" id="ftLoadMoreBtn" style="text-align:center;padding:10px;cursor:pointer;color:var(--accent,#4aa3ff);">' +
                '⬇ 加载更多（已显示 ' + (files.length) + ' / ' + (data.total_files || files.length) + ' 个文件）</div>' : '');
        var sortSel2 = document.getElementById('ftSortSel');
        if (sortSel2) {
            sortSel2.value = self._ftSortMode || 'cat';
            sortSel2.onchange = function() {
                self._ftSortMode = this.value;
                self._saveLayout({ sortMode: this.value });
                self._renderThumbs();
            };
        }
        var viewBtn2 = document.getElementById('ftViewBtn');
        if (viewBtn2) viewBtn2.onclick = function() {
            self._ftViewMode = (self._ftViewMode === 'list') ? 'thumb' : 'list';
            self._saveLayout({ viewMode: self._ftViewMode });
            this.textContent = (self._ftViewMode === 'list') ? '🖼' : '🗂';
            self._renderThumbs();
        };
        var lmBtn = document.getElementById('ftLoadMoreBtn');
        if (lmBtn) {
            lmBtn.onclick = function() { self._ftLoadMore(); };
            if (self._ftLoadObserver) { try { self._ftLoadObserver.disconnect(); } catch (e) {} }
            self._ftLoadObserver = new IntersectionObserver(function(entries) {
                entries.forEach(function(en) { if (en.isIntersecting) self._ftLoadMore(); });
            }, { root: box, rootMargin: '300px' });
            self._ftLoadObserver.observe(lmBtn);
        }
        box.querySelectorAll('.ft-dir-row, .ft-dir-card').forEach(bindDirCard);
        box.querySelectorAll('.ft-thumb, .ft-file-row').forEach(function(t) {
            var p = t.getAttribute('data-path');
            if (self._ftSelected[p]) t.classList.add('selected');
            t.ondblclick = function(e) {
                // 双击图片 → 在图片查看器打开（并注入当前目录全部图片作为幻灯片）
                e.preventDefault(); e.stopPropagation();
                if (self._openThumbInViewer) self._openThumbInViewer(p);
            };
            t.onclick = function(e) {
                if (self._ftSelected[p] && !e.ctrlKey) { delete self._ftSelected[p]; }
                else { if (e.ctrlKey) self._ftSelected[p] = true; else { self._ftSelected = {}; self._ftSelected[p] = true; } }
                t.classList.toggle('selected', !!self._ftSelected[p]);
                var hint = document.getElementById('ftSelHint');
                if (hint) hint.textContent = self._selCountText();
                try { localStorage.setItem('ft_last_selected', p); } catch (err) {}
                self._notifySelChange();
            };
        });
        self._initMarquee(box);
    },

    // ===== 缩略图橡皮筋框选（默认=替换 / Ctrl=加选 / Alt=减选 / Shift=加选）=====
    _initMarquee: function(box) {
        var self = this;
        if (box.__marqueeBound) return; box.__marqueeBound = true;
        var mar = document.createElement('div');
        mar.className = 'ft-marquee'; mar.style.display = 'none';
        box.appendChild(mar);
        var sx = 0, sy = 0, active = false, base = null;
        box.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            if (e.target.closest('.ft-thumb') || e.target.closest('.ft-file-row') || e.target.closest('.ft-marquee')) return;
            // innerHTML 重渲染会清掉 marquee 元素，先补回来（否则橡皮筋永远显示不出来）
            if (!mar.isConnected || mar.parentNode !== box) box.appendChild(mar);
            active = true; sx = e.clientX; sy = e.clientY;
            base = {}; // mousedown 时快照当前选中，加/减选基于此
            for (var k in self._ftSelected) if (self._ftSelected[k]) base[k] = true;
            var rect = box.getBoundingClientRect();
            mar.style.left = (sx - rect.left + box.scrollLeft) + 'px';
            mar.style.top = (sy - rect.top + box.scrollTop) + 'px';
            mar.style.width = '0'; mar.style.height = '0'; mar.style.display = 'block';
            e.preventDefault();
        });
        window.addEventListener('mousemove', function(e) {
            if (!active) return;
            var x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
            var w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
            var rect = box.getBoundingClientRect();
            mar.style.left = (x - rect.left + box.scrollLeft) + 'px';
            mar.style.top = (y - rect.top + box.scrollTop) + 'px';
            mar.style.width = w + 'px'; mar.style.height = h + 'px';
            // 预览高亮
            var mr = mar.getBoundingClientRect();
            box.querySelectorAll('.ft-thumb, .ft-file-row').forEach(function(t) {
                var r = t.getBoundingClientRect();
                var hit = !(r.right < mr.left || r.left > mr.right || r.bottom < mr.top || r.top > mr.bottom);
                t.classList.toggle('marquee-preview', hit);
            });
        });
        window.addEventListener('mouseup', function(e) {
            if (!active) return; active = false;
            mar.style.display = 'none';
            var mr = mar.getBoundingClientRect();
            var addMode = e.ctrlKey || e.shiftKey; // 加选
            var subMode = e.altKey;                // 减选
            if (mr.width < 6 || mr.height < 6) { // 视为空白点击=清空
                if (!addMode && !subMode) self._ftSelected = {};
            } else {
                var hits = {};
                box.querySelectorAll('.ft-thumb, .ft-file-row').forEach(function(t) {
                    var r = t.getBoundingClientRect();
                    var hit = !(r.right < mr.left || r.left > mr.right || r.bottom < mr.top || r.top > mr.bottom);
                    if (hit) hits[t.getAttribute('data-path')] = true;
                });
                if (subMode) {
                    // 减选：base - hits
                    self._ftSelected = {};
                    for (var k in base) if (base[k] && !hits[k]) self._ftSelected[k] = true;
                } else if (addMode) {
                    // 加选：base + hits
                    self._ftSelected = {};
                    for (var k in base) if (base[k]) self._ftSelected[k] = true;
                    for (var p in hits) self._ftSelected[p] = true;
                } else {
                    // 替换
                    self._ftSelected = {};
                    for (var p in hits) self._ftSelected[p] = true;
                }
            }
            box.querySelectorAll('.ft-thumb, .ft-file-row').forEach(function(t) {
                t.classList.remove('marquee-preview');
                t.classList.toggle('selected', !!self._ftSelected[t.getAttribute('data-path')]);
            });
            var hint = document.getElementById('ftSelHint');
            if (hint) hint.textContent = self._selCountText();
            self._syncSelBar();
            self._notifySelChange();
        });
    },

    // ===== 文件操作：删除 / 移动 / 复制 =====
    _fsOps: function(action, target) {
        var self = this;
        var paths = Object.keys(self._ftSelected).filter(function(k) { return self._ftSelected[k]; });
        if (!paths.length) {
            if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('请先选中文件', 'warn');
            return;
        }
        fetch('/api/fs/ops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, paths: paths, target: target || '' })
        }).then(function(r) { return r.json(); }).then(function(d) {
            if (d && d.ok) {
                var msg = '';
                if (action === 'delete') msg = '已删除 ' + (d.done || []).length + ' 项';
                else msg = (action === 'move' ? '已移动 ' : '已复制 ') + (d.done || []).length + ' 项';
                if ((d.errors || []).length) msg += '，失败 ' + d.errors.length + ' 项：' + d.errors.slice(0, 3).join('；');
                if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show(msg, (d.errors || []).length ? 'warn' : 'ok');
                if (action === 'delete' || action === 'move') self._ftSelected = {};
                delete self._ftDirCache[self._norm(self._ftCwd)];
                self._renderThumbs();
                self._renderTree();
            } else {
                if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('操作失败: ' + ((d && d.error) || ''), 'error');
            }
        }).catch(function(err) {
            if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('请求失败: ' + err, 'error');
        });
    },
    _deleteSelected: function() {
        var n = 0;
        for (var k in this._ftSelected) if (this._ftSelected[k]) n++;
        if (!n) {
            if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show('请先选中文件', 'warn');
            return;
        }
        if (!window.confirm('确定删除选中的 ' + n + ' 个文件吗？（不可恢复）')) return;
        this._fsOps('delete');
    },
    _promptTarget: function(action) {
        var self = this;
        var def = self._ftCwd || '';
        var v = window.prompt((action === 'move' ? '移动到目录：' : '复制到目录：') + '\n输入目标文件夹绝对路径', def);
        if (!v) return;
        self._fsOps(action, v.trim());
    },
    _bindFsHotkeys: function() {
        var self = this;
        if (self.__fsHotkeyBound) return; self.__fsHotkeyBound = true;
        document.addEventListener('keydown', function(e) {
            if (!self._ftPanelOpen) return;
            var tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) return;
            if (e.key === 'Delete' && !e.ctrlKey && !e.altKey) {
                var n = 0;
                for (var k in self._ftSelected) if (self._ftSelected[k]) n++;
                if (!n) return;
                e.preventDefault();
                if (window.confirm('确定删除选中的 ' + n + ' 个文件吗？（不可恢复）')) self._fsOps('delete');
            }
        });
    },

    // 选择变化 → 通知对话框选中条
    _notifySelChange: function() {
        try { if (typeof App.updateChatSelBar === 'function') App.updateChatSelBar(); } catch (e) {}
    },

    // 当前选中文件列表（含文字名称）
    _getSelFiles: function() {
        var self = this;
        return Object.keys(self._ftSelected).filter(function(k) { return self._ftSelected[k]; })
            .map(function(p) { return { name: p.replace(/[\\/]+/, '/').split('/').pop(), path: p }; });
    },

    // 对话框上方的「已选文件条」（每个聊天框一条）
    _syncSelBar: function() {
        var files = this._getSelFiles();
        var bars = document.querySelectorAll('.chat-sel-bar');
        if (!bars.length) return;
        var self = this;
        var IMG_RE = /\.(png|jpe?g|webp|gif|bmp|svg|ico|tiff?)$/i;
        bars.forEach(function(bar) {
            if (!files.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
            var imgFiles = files.filter(function(f) { return IMG_RE.test(f.name); }).slice(0, 1); // 【单张识图】只取第一张选中的图片
            var hasMoreImgs = files.filter(function(f) { return IMG_RE.test(f.name); }).length > 1;
            var html = '<span class="csb-label">📎 已选 ' + files.length + ' 项：</span>';
            files.slice(0, 6).forEach(function(f) { html += '<span class="csb-chip" title="' + f.path + '">' + f.name + '</span>'; });
            if (files.length > 6) html += '<span class="csb-chip">…共' + files.length + '个</span>';
            if (imgFiles.length) html += '<span class="csb-chip" style="border-color:var(--accent,#5a8cff);" title="🖼️ 已选中图片，直接发送消息即可识图">🖼️</span>';
            html += '<span class="csb-clear">✕</span>';
            bar.innerHTML = html;
            bar.style.display = 'flex';
            var clear = bar.querySelector('.csb-clear');
            if (clear) clear.onclick = function() {
                if (window.App && App._filetree) { App._filetree._ftSelected = {}; }
                if (window.App && App._filetree && App._filetree._renderThumbs) App._filetree._renderThumbs();
                bar.style.display = 'none'; bar.innerHTML = '';
                if (window.App && App._filetree) App._filetree._notifySelChange();
            };
            // 【自动识图】选中图片后直接发送即可，无需按钮；点击图片条不再触发读取
        });
    },

    // 【自动识图】把当前选中的第一张图片经本地代理读回，以 File 形式回调给发送逻辑
    _getSelectedImageFiles: function(cb) {
        var files = this._getSelFiles();
        var IMG_RE = /\.(png|jpe?g|webp|gif|bmp|svg|ico|tiff?)$/i;
        var img = null;
        for (var i = 0; i < files.length; i++) {
            if (IMG_RE.test(files[i].name)) { img = files[i]; break; }
        }
        if (!img) { cb(null); return; }
        fetch('/api/fs/file?path=' + encodeURIComponent(img.path), { cache: 'no-store' })
            .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
            .then(function(blob) {
                cb(new File([blob], img.name, { type: blob.type || 'image/png' }));
            })
            .catch(function() { cb(null); });
    },

    // 【自动语音】把当前选中的第一个音频文件经本地代理读回，以 File 形式回调给发送逻辑
    _getSelectedAudioFile: function(cb) {
        var files = this._getSelFiles();
        var AUD_RE = /\.(mp3|wav|m4a|ogg|flac|webm|aac|opus|amr|3gp)$/i;
        var aud = null;
        for (var i = 0; i < files.length; i++) {
            if (AUD_RE.test(files[i].name)) { aud = files[i]; break; }
        }
        if (!aud) { cb(null); return; }
        fetch('/api/fs/file?path=' + encodeURIComponent(aud.path), { cache: 'no-store' })
            .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
            .then(function(blob) {
                cb(new File([blob], aud.name, { type: blob.type || 'audio/wav' }));
            })
            .catch(function() { cb(null); });
    },

    // ===== 【项目上下文工具】当前选择快照 =====
    _selCountText: function() {
        var n = Object.keys(this._ftSelected).length;
        return n ? ('已选 ' + n + ' 项') : '';
    },
    // 【同步选中条】供对话框调用：更新所有聊天框上方的选中条
    updateChatSelBar: function() {
        this._syncSelBar();
    },
    getProjectContext: function() {
        var self = this;
        var pin = self._getPin();
        // 【修复 5.0.5】启动后未打开过文件树/项目面板时，_ftProjId 为空但 App.activeProject
        // 已有统一活动项目 → 直接采用活动项目并同步到文件树状态，避免上下文显示"(未指定)"
        if (!self._ftProjId && typeof App !== 'undefined' && App.activeProject && (App.activeProject.id || App.activeProject.name)) {
            var _apid = String(App.activeProject.id || '');
            var _apname = App.activeProject.name || '';
            var _found = false;
            var _lists = [self._projAllProjects || []];
            try { if (Store.data && Store.data.projects) _lists.push(Store.data.projects); } catch (e) {}
            for (var _li = 0; _li < _lists.length && !_found; _li++) {
                for (var _pi = 0; _pi < _lists[_li].length; _pi++) {
                    if (_apid && String(_lists[_li][_pi].id) === _apid) {
                        self._ftProjId = _lists[_li][_pi].id;
                        self._ftProjName = _lists[_li][_pi].name || _apname;
                        if (_lists[_li][_pi].folder_path) self._ftRoot = self._norm(_lists[_li][_pi].folder_path);
                        _found = true;
                        break;
                    }
                }
            }
            if (!_found) {
                // 本地列表没命中：只认 id/名称；根目录异步从 DB 补齐
                if (_apid) self._ftProjId = App.activeProject.id;
                self._ftProjName = _apname;
                if (!self._ftRoot && _apid && typeof DB !== 'undefined' && DB.getProjects) {
                    DB.getProjects().then(function(res) {
                        var items = (res && res.ok && res.data) || [];
                        for (var j = 0; j < items.length; j++) {
                            if (String(items[j].id) === _apid) {
                                if (items[j].folder_path) self._ftRoot = self._norm(items[j].folder_path);
                                self._projAllProjects = items;
                                break;
                            }
                        }
                    }).catch(function() {});
                }
            }
            self._ftCwd = self._ftCwd || self._ftRoot || '';
        }
        // 【修复 5.0.5】都为空时最后兜底：localStorage 里的活动项目记忆（等价于切换器显示）
        if (!self._ftProjId && !self._ftRoot) {
            try {
                var _lsid = localStorage.getItem('active_project_id');
                if (_lsid) {
                    self._ftProjId = _lsid;
                    self._ftProjName = localStorage.getItem('active_project_name') || '';
                }
            } catch (e) {}
        }
        if (!self._ftProjId && !self._ftRoot && !pin) {
            var last = '';
            try { last = localStorage.getItem('ft_last_cwd') || ''; } catch (e) {}
            if (!last) return null;
            self._ftRoot = self._norm(last);
        }
        var selFiles = self._getSelFiles();
        // 【缩略图文本预览联动】读取预览中框选的文字（含行号），未选中则返回 null
        var _pvs = null;
        var _tp = self._textPreview;
        if (_tp && _tp.ta && document.body.contains(_tp.ta)) {
            var _s = _tp.ta.selectionStart, _e = _tp.ta.selectionEnd;
            if (_s != null && _e != null && _s !== _e) {
                var _val = _tp.ta.value;
                var _ls = _val.slice(0, _s).split('\n').length;
                var _le = _ls + _val.slice(_s, _e).split('\n').length - 1;
                _pvs = { path: _tp.path, name: _tp.name, text: _val.slice(_s, _e), line_start: _ls, line_end: _le };
            }
        }
        return {
            project_id: self._ftProjId,
            project_name: self._ftProjName || '',
            root: self._ftProjId ? (self._ftRoot || '') : (self._ftRoot || pin || ''),
            cwd: self._ftCwd || '',
            selected: selFiles,
            selection_mode: self._ftSelMode || 'replace',
            preview_selection: _pvs
        };
    },

    // ===== 录音（系统音频/麦克风，右键选设备） =====
    _recState: false,
    _recTimer: null,
    _recDeviceIdx: null,
    _toast: function(msg, type) {
        if (typeof ToastStack !== 'undefined' && ToastStack.show) ToastStack.show(msg, type || 'info');
        else if (window.Toast && window.Toast.show) window.Toast.show(msg, type || 'info');
        else console.log('[' + (type || 'info') + '] ' + msg);
    },
    _getRecordVolume: function() {
        var v = parseFloat(localStorage.getItem('recordVolume'));
        return isNaN(v) ? 1.0 : Math.max(0.1, Math.min(5.0, v));
    },
    _recSaveDir: function() { return this._norm(this._ftCwd || this._ftRoot || ''); },
    _postJson: function(url, data) {
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {}) }).then(function(r) { return r.json(); });
    },
    toggleRecord: function() {
        var self = this;
        if (self._recState) self._recStop(); else self._recStart();
    },
    _recStart: function() {
        var self = this;
        self._postJson('/api/record-start', { 保存目录: self._recSaveDir(), 设备索引: self._recDeviceIdx })
            .then(function(res) {
                if (!res['成功']) { self._toast('录音失败: ' + (res['错误'] || '未知错误'), 'error'); return; }
                self._recState = true;
                self._updateRecBtn();
                self._toast('🔴 录音中... ' + (res['设备'] || ''), 'info');
                var t0 = Date.now();
                self._recTimer = setInterval(function() {
                    var el = Math.floor((Date.now() - t0) / 1000);
                    var mm = String(Math.floor(el / 60)).padStart(2, '0'), ss = String(el % 60).padStart(2, '0');
                    var b = document.getElementById('ftRecordBtn');
                    if (b) b.title = '🔴 录音中 ' + mm + ':' + ss + ' (点击停止)';
                }, 500);
            })
            .catch(function(e) { self._toast('录音请求失败: ' + e.message, 'error'); });
    },
    _recStop: function() {
        var self = this;
        if (self._recTimer) { clearInterval(self._recTimer); self._recTimer = null; }
        self._postJson('/api/record-stop', { 音量倍数: self._getRecordVolume() })
            .then(function(res) {
                self._recState = false;
                self._updateRecBtn();
                if (res['成功']) {
                    if (res['静音']) self._toast('录音完成（静音）: ' + (res['消息'] || ''), 'warn');
                    else self._toast('录音完成: ' + (res['消息'] || ''), 'success');
                    delete self._ftDirCache[self._norm(self._ftCwd)];
                    self._navigate(self._ftCwd, { noHist: true });
                } else {
                    self._toast('录音停止失败: ' + (res['错误'] || ''), 'error');
                }
            })
            .catch(function(e) {
                self._recState = false;
                self._updateRecBtn();
                self._toast('停止录音失败: ' + e.message, 'error');
            });
    },
    _updateRecBtn: function() {
        var b = document.getElementById('ftRecordBtn');
        if (!b) return;
        if (this._recState) { b.classList.add('recording'); b.textContent = '⏹'; b.title = '录音中... 点击停止'; }
        else {
            b.classList.remove('recording');
            var mode = localStorage.getItem('recordMode') || 'system';
            b.textContent = mode === 'mic' ? '🎤' : '🔴';
            b.title = mode === 'mic' ? '录制麦克风（右键切换/音量）' : '录制系统音频（右键切换/音量）';
        }
    },

    // ===== 录屏（ffmpeg gdigrab → MP4，右键选区域/音频模式） =====
    _srState: false,
    _srTimer: null,
    _srSettings: null,
    toggleScreenRecord: function() {
        var self = this;
        if (self._srState) self._srStop(); else self._srStart();
    },
    _srLoadSettings: function(cb) {
        var self = this;
        if (self._srSettings) { cb(self._srSettings); return; }
        self._postJson('/api/screenrecord-settings', {})
            .then(function(res) { self._srSettings = (res && res['成功'] && res['设置']) || {}; cb(self._srSettings); })
            .catch(function() { cb({}); });
    },
    _srStart: function() {
        var self = this;
        self._srLoadSettings(function(s) {
            var mode = localStorage.getItem('srAudioMode') || s['音频模式'] || 'mic';
            var startRec = function(area) {
                self._postJson('/api/screenrecord-start', {
                    保存目录: self._recSaveDir(),
                    x: area.x, y: area.y, w: area.w, h: area.h,
                    帧率: parseInt(localStorage.getItem('srFps'), 10) || s['帧率'] || 30,
                    音频模式: mode,
                    dshow设备名: localStorage.getItem('srDshowDevice') || s['dshow设备名'] || '',
                    麦克风音量: s['麦克风音量'] != null ? s['麦克风音量'] : 1.0,
                    麦克风静音: !!s['麦克风静音'],
                    系统音量: s['系统音量'] != null ? s['系统音量'] : 1.0,
                    系统静音: !!s['系统静音']
                }).then(function(res) {
                    if (!res['成功']) { self._toast('录屏失败: ' + (res['错误'] || ''), 'error'); return; }
                    self._srState = true;
                    self._updateSrBtn();
                    self._toast('🎥 录屏中 ' + (res['区域'] || '') + ' (点击停止)', 'info');
                    var t0 = Date.now();
                    self._srTimer = setInterval(function() {
                        var el = Math.floor((Date.now() - t0) / 1000);
                        var mm = String(Math.floor(el / 60)).padStart(2, '0'), ss = String(el % 60).padStart(2, '0');
                        var b = document.getElementById('ftScreenRecBtn');
                        if (b) b.title = '🎥 录屏中 ' + mm + ':' + ss + ' (点击停止)';
                    }, 500);
                }).catch(function(e) { self._toast('录屏请求失败: ' + e.message, 'error'); });
            };
            if (localStorage.getItem('srAreaMode') === 'full') {
                startRec({ x: 0, y: 0, w: 0, h: 0 });
            } else {
                // 弹出服务端遮罩框选区域
                self._toast('请拖拽选择录制区域（ESC 取消）', 'info');
                self._postJson('/api/screenrecord-select-area', {})
                    .then(function(res) {
                        if (!res['成功']) { self._toast(res['错误'] || '已取消', 'warn'); return; }
                        startRec(res['区域']);
                    })
                    .catch(function(e) { self._toast('区域选择失败: ' + e.message, 'error'); });
            }
        });
    },
    _srStop: function() {
        var self = this;
        if (self._srTimer) { clearInterval(self._srTimer); self._srTimer = null; }
        self._srState = false;
        self._updateSrBtn();
        self._toast('正在停止录屏并转码...', 'info');
        self._postJson('/api/screenrecord-stop', {})
            .then(function(res) {
                if (res['成功']) {
                    self._toast('录屏完成: ' + (res['消息'] || res['保存路径'] || ''), 'success');
                    // 用服务端返回的实际保存路径刷新文件树（可能是其他目录）
                    var savedPath = res['保存路径'] || res['路径'] || '';
                    var savedDir = savedPath ? String(savedPath).replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '') : '';
                    var dirKey = self._norm(savedDir || self._ftCwd);
                    if (dirKey && self._ftDirCache[dirKey]) delete self._ftDirCache[dirKey];
                    var dirToGo = (savedDir && self._norm(self._ftCwd) === dirKey) ? self._ftCwd : (savedDir && savedDir !== self._ftCwd ? savedDir : self._ftCwd);
                    if (savedDir && self._norm(self._ftCwd) !== dirKey) {
                        // 录像保存在其它目录 → 直接导航过去，让用户立刻看到
                        self._navigate(savedDir, { noHist: false });
                    } else {
                        self._navigate(self._ftCwd, { noHist: true });
                    }
                } else {
                    self._toast('录屏停止失败: ' + (res['错误'] || ''), 'error');
                }
            })
            .catch(function(e) { self._toast('停止录屏失败: ' + e.message, 'error'); });
    },
    _updateSrBtn: function() {
        var b = document.getElementById('ftScreenRecBtn');
        if (!b) return;
        if (this._srState) { b.classList.add('recording'); b.textContent = '⏹'; b.title = '🎥 录屏中... 点击停止'; }
        else { b.classList.remove('recording'); b.textContent = '🎥'; b.title = '录制屏幕（右键选区域/音频）'; }
    },

    // ===== 版本快照菜单（文件菜单 📦 入口：创建快照/恢复/管理） =====
    showBackupMenu: function(event) {
        var self = this;
        var old = document.getElementById('ftBackupMenu');
        if (old) { old.remove(); return; } // 再点一次关闭

        var menu = document.createElement('div');
        menu.id = 'ftBackupMenu';
        menu.style.cssText = 'position:fixed;z-index:99999;min-width:240px;max-height:60vh;overflow-y:auto;' +
            'background:var(--bg-elev,#1e222d);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:8px;padding:6px;box-shadow:0 8px 30px rgba(0,0,0,.45);';

        function addItem(icon, label, fn, danger) {
            var it = document.createElement('div');
            it.style.cssText = 'padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;color:' + (danger ? '#ff8a8a' : 'var(--text,#e8eaf0)') + ';';
            it.textContent = icon + ' ' + label;
            it.onmouseenter = function() { it.style.background = 'rgba(255,255,255,.08)'; };
            it.onmouseleave = function() { it.style.background = 'transparent'; };
            it.onclick = function() { menu.remove(); fn(); };
            menu.appendChild(it);
        }
        function addSep() {
            var sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:var(--border,rgba(255,255,255,.1));margin:4px 8px;';
            menu.appendChild(sep);
        }

        // 先放固定项，快照列表异步追加
        var loading = document.createElement('div');
        loading.style.cssText = 'padding:6px 12px;font-size:12px;color:var(--text2,#8b90a0);';
        loading.textContent = '⏳ 加载快照列表...';
        menu.appendChild(loading);

        document.body.appendChild(menu);

        // 定位：以触发按钮为基准，防止 event 为空时跑偏
        var btn = document.getElementById('ftBackupBtn');
        var mx, my;
        if (btn) {
            var r = btn.getBoundingClientRect();
            mx = Math.min(r.left, window.innerWidth - 260);
            my = r.bottom + 6;
        } else {
            mx = (event && event.clientX) || 100;
            my = (event && event.clientY) || 100;
        }
        menu.style.left = mx + 'px';
        menu.style.top = Math.min(my, window.innerHeight - 320) + 'px';

        var closeMenu = function(ev) {
            if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('mousedown', closeMenu); }
        };
        setTimeout(function() { document.addEventListener('mousedown', closeMenu); }, 0);

        // （版本备份入口已移至左上角画布菜单 app-undo.js）

        // 快照列表（最近 8 个）
        fetch('/api/backup/list').then(function(res) { return res.json(); }).then(function(res) {
            if (loading.parentNode) loading.remove();
            if (!res.ok) return;
            var backups = (res.backups || []).filter(function(b) { return b.type === 'snapshot'; }).slice(0, 8);
            if (backups.length === 0) {
                var empty = document.createElement('div');
                empty.style.cssText = 'padding:6px 12px;font-size:12px;color:var(--text2,#8b90a0);';
                empty.textContent = '暂无快照';
                menu.appendChild(empty);
                return;
            }
            backups.forEach(function(b) {
                var it = document.createElement('div');
                it.style.cssText = 'padding:7px 12px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--text,#e8eaf0);display:flex;align-items:center;justify-content:space-between;gap:10px;';
                it.innerHTML = '<span>📦 ' + b.display_time + '</span><span style="color:#4fc3f7;font-size:11px;">恢复</span>';
                it.onmouseenter = function() { it.style.background = 'rgba(255,255,255,.08)'; };
                it.onmouseleave = function() { it.style.background = 'transparent'; };
                it.onclick = function() { menu.remove(); App.restoreBackup(b.filename); };
                menu.appendChild(it);
            });
            var more = document.createElement('div');
            more.style.cssText = 'padding:7px 12px;font-size:12px;color:var(--text2,#8b90a0);cursor:pointer;text-align:center;';
            more.textContent = '查看全部 →';
            more.onclick = function() { menu.remove(); App.showBackupPanel(); };
            menu.appendChild(more);
        }).catch(function() {
            if (loading.parentNode) loading.textContent = '❌ 快照列表加载失败';
        });
    },

    // ===== 录音/录屏 右键菜单（设备/音量/区域模式） =====
    showRecordMenu: function(event, kind) {
        var self = this;
        var old = document.getElementById('ftRecMenu');
        if (old) old.remove();
        var menu = document.createElement('div');
        menu.id = 'ftRecMenu';
        menu.style.cssText = 'position:fixed;z-index:99999;min-width:230px;max-height:60vh;overflow-y:auto;' +
            'background:#23233a;border:1px solid #44446a;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
            'left:' + event.clientX + 'px;top:' + event.clientY + 'px;font-size:13px;color:#ccc;';
        var addItem = function(html, onclick) {
            var it = document.createElement('div');
            it.innerHTML = html;
            it.style.cssText = 'padding:9px 14px;cursor:pointer;border-radius:6px;margin:2px 4px;';
            it.onmouseover = function() { it.style.background = '#3a3a52'; };
            it.onmouseout = function() { it.style.background = ''; };
            it.onclick = function() { onclick(); menu.remove(); };
            menu.appendChild(it);
        };
        var addSep = function() {
            var sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:#44446a;margin:4px 8px;';
            menu.appendChild(sep);
        };

        if (kind === 'audio') {
            self._postJson('/api/record-devices', {}).then(function(res) {
                if (!res['成功']) { self._toast('获取设备失败: ' + (res['错误'] || ''), 'error'); return; }
                var devs = res['设备列表'] || [];
                var savedMode = localStorage.getItem('recordMode') || 'system';
                var savedIdx = localStorage.getItem('recordDeviceIdx');
                devs.forEach(function(d) {
                    var isCur = (savedIdx != null && String(d['索引']) === savedIdx) ||
                                (savedIdx == null && ((d['引擎'] === 'loopback') === (savedMode === 'system')));
                    addItem((isCur ? '✅ ' : '') + d['名称'], function() {
                        self._recDeviceIdx = d['索引'];
                        localStorage.setItem('recordMode', d['引擎'] === 'loopback' ? 'system' : 'mic');
                        localStorage.setItem('recordDeviceIdx', String(d['索引']));
                        self._toast('录音设备: ' + d['名称'], 'info');
                        self._updateRecBtn();
                    });
                });
                if (!devs.length) addItem('⚠️ 未找到录音设备', function() {});
                addSep();
                var vol = self._getRecordVolume();
                addItem('🔊 音量倍数: ' + vol.toFixed(1) + '（点击循环切换）', function() {
                    var steps = [0.5, 1.0, 1.5, 2.0, 3.0];
                    var next = 1.0;
                    for (var i = 0; i < steps.length; i++) {
                        if (steps[i] > vol + 0.01) { next = steps[i]; break; }
                    }
                    localStorage.setItem('recordVolume', String(next));
                    self._toast('录音音量倍数: ' + next.toFixed(1), 'info');
                });
                document.body.appendChild(menu);
                var closeMenu = function(ev) {
                    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closeMenu); }
                };
                setTimeout(function() { document.addEventListener('mousedown', closeMenu); }, 0);
            }).catch(function(e) { self._toast('获取设备失败: ' + e.message, 'error'); });
            return;
        }

        // screen
        var areaMode = localStorage.getItem('srAreaMode') === 'full';
        addItem((areaMode ? '✅ ' : '') + '🖥 全屏录制', function() {
            localStorage.setItem('srAreaMode', 'full');
            self._toast('录屏区域: 全屏', 'info');
        });
        addItem((areaMode ? '' : '✅ ') + '⬚ 每次框选区域', function() {
            localStorage.setItem('srAreaMode', 'select');
            self._toast('录屏区域: 框选', 'info');
        });
        addSep();
        var curMode = localStorage.getItem('srAudioMode') || 'mic';
        [['none', '🔇 无音频'], ['mic', '🎤 麦克风'], ['system', '🔊 系统音频'], ['both', '🎙 麦克风+系统音频']]
            .forEach(function(pair) {
                addItem((curMode === pair[0] ? '✅ ' : '') + pair[1], function() {
                    localStorage.setItem('srAudioMode', pair[0]);
                    self._toast('录屏音频: ' + pair[1].replace(/^\S+\s/, ''), 'info');
                });
            });
        addSep();
        var fps = parseInt(localStorage.getItem('srFps'), 10) || 30;
        addItem('🎞 帧率: ' + fps + ' fps（点击切换 15/24/30/60）', function() {
            var steps = [15, 24, 30, 60], next = 15;
            for (var i = 0; i < steps.length; i++) { if (steps[i] > fps) { next = steps[i]; break; } }
            localStorage.setItem('srFps', String(next));
            self._toast('录屏帧率: ' + next + ' fps', 'info');
        });
        document.body.appendChild(menu);
        var closeMenu2 = function(ev) {
            if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closeMenu2); }
        };
        setTimeout(function() { document.addEventListener('mousedown', closeMenu2); }, 0);
    },

    _extIcon: function(name) {
        var ext = (String(name).split('.').pop() || '').toLowerCase();
        var map = { py: '🐍', js: '📜', json: '🧾', md: '📝', txt: '📄', html: '🌐', css: '🎨',
                    max: '🧊', ms: '🧊', obj: '🧊', fbx: '🧊', blend: '🧊', ma: '🧊', mb: '🧊',
                    wav: '🎵', mp3: '🎵', mp4: '🎥', webm: '🎥', mov: '🎥', m4v: '🎥', mkv: '🎥', avi: '🎥', ogv: '🎥' };
        return map[ext] || '📄';
    }
});

// 文件树为常驻侧边栏：不再通过遮罩点击关闭，只有右上角 ✕ 或顶栏按钮才关闭
(function() {
    function bindOverlay() {
        var overlay = document.getElementById('ftPanelOverlay');
        if (!overlay || overlay.__ftBound) return;
        overlay.__ftBound = true;
        // 不绑定任何关闭逻辑（遮罩已透明且 pointer-events:none）
    }
    // 5.0.7 记忆增强：启动时从 user_settings.json 恢复钉住项目与浏览位置，
    // 覆盖回 localStorage（换浏览器/清缓存后依然能记住上次选择的项目）。
    function restoreFtMemory() {
        try {
            if (typeof UserSettings === 'undefined' || !UserSettings.loadFromServer) return;
            UserSettings.loadFromServer().then(function () {
                var pins = UserSettings.get('ft_pins', null);
                if (pins && pins.length && !localStorage.getItem('ft_pins')) {
                    localStorage.setItem('ft_pins', JSON.stringify(pins));
                }
                var last = UserSettings.get('ft_last_cwd', '');
                if (last && !localStorage.getItem('ft_last_cwd')) {
                    localStorage.setItem('ft_last_cwd', last);
                }
            }).catch(function(){});
            // 服务器数据到达后，若面板已打开则重渲染钉住列表（清缓存后立刻打开面板的场景）
            window.addEventListener('user-settings-refreshed', function () {
                try { if (window.App && App._ftPanelOpen) { App._renderTree(); App._updatePinBtn(); } } catch (e) {}
            });
        } catch (e) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function(){ bindOverlay(); restoreFtMemory(); _bindFolderChange(); });
    } else { bindOverlay(); restoreFtMemory(); _bindFolderChange(); }

    // 【5.1.0 修复】监听「项目路径变更」事件：设置/项目面板里重新选择项目文件夹后，
    // 文件树立即按新路径重新定位（不再停留在旧目录或误切到第一个项目）。
    function _bindFolderChange() {
        document.addEventListener('project-folder-changed', function(ev) {
            try {
                var app = window.App;
                if (!app || !app._ftPanelOpen) return; // 面板未打开时无需处理，下次打开自然按新路径定位
                var detail = ev && ev.detail ? ev.detail : {};
                // 同步更新本地项目缓存中的 folder_path，防止 _loadRoot 查到旧值
                var newPid = detail.projectId != null ? String(detail.projectId) : null;
                var newPath = detail.folderPath || '';
                if (newPid && newPath) {
                    var lists = [];
                    if (app._projAllProjects) lists.push(app._projAllProjects);
                    if (typeof Store !== 'undefined' && Store.data && Store.data.projects) lists.push(Store.data.projects);
                    for (var li = 0; li < lists.length; li++) {
                        for (var pi = 0; pi < lists[li].length; pi++) {
                            if (String(lists[li][pi].id) === newPid) { lists[li][pi].folder_path = newPath; break; }
                        }
                    }
                    // 文件树当前正属于这个项目 → 就地重新定位根目录
                    if (String(app._ftProjId || '') === newPid) {
                        app._ftRoot = app._norm(newPath);
                        app._navigate(app._ftRoot);
                        try { localStorage.setItem('ft_last_cwd', newPath); } catch (e2) {}
                    } else if (!app._ftProjId && typeof app.setActiveProjectUnified === 'function') {
                        // 文件树未绑定项目（如停留在主页）：切到该项目的根
                        app.setActiveProjectUnified(newPid);
                        app._loadRoot();
                    }
                } else if (app._ftProjId) {
                    app._loadRoot();
                }
            } catch (e) {}
        });
    }
})();

// 澶栭儴鍙屽嚮鍏抽棴鏂囦欢鏍戦潰鏉?
(function() {
    function bindDbl() {
        document.addEventListener('dblclick', function(ev) {
            var app = window.App;
            if (!app || !app._ftPanelOpen) return;
            var t = ev.target;
            if (t && t.closest) {
                if (t.closest('#ftPanel')) return;
                if (t.closest('#ftToggleBtn') || t.closest('#ftOpenBtn') || t.closest('[data-ft-toggle]')) return;
            }
            try { app.closeFileTreePanel(); } catch (e) {}
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindDbl);
    else bindDbl();
})();

