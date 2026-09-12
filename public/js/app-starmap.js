// ========== app-starmap.js - 星空知识图谱（3D 文件星图） ==========
// 每个文件一颗星：大小=文件体积，颜色=类型，亮度=近期活跃（mtime）
// 按目录聚簇（星系团）；hover 显示画像；支持框选/Shift 框选减选（与缩略图选中联动）
// 数据每次展开实时拉取 /api/starmap/scan，与当前项目同步
(function () {
    'use strict';
    var App = window.App || {};

    // ---------- 工具 ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtSize(n) {
        if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
        if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
        return n + ' B';
    }
    function fmtTime(ts) {
        var d = new Date(ts);
        function p(x) { return x < 10 ? '0' + x : '' + x; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    // 类型颜色（暖=活跃 近期修改偏蓝白，久未动偏暗红 —— 用亮度和色温表达）
    var EXT_COLOR = {
        js: [140, 170, 255], css: [120, 220, 180], html: [255, 170, 120], json: [230, 200, 130],
        py: [160, 230, 160], md: [200, 200, 210], img: [255, 140, 190], media: [220, 150, 255],
        other: [170, 180, 200]
    };
    function colorOf(name) {
        var ext = (name.split('.').pop() || '').toLowerCase();
        if (EXT_COLOR[ext]) return EXT_COLOR[ext];
        if (['png','jpg','jpeg','gif','webp','svg','ico','bmp'].indexOf(ext) >= 0) return EXT_COLOR.img;
        if (['mp4','mp3','wav','mov','avi','webm'].indexOf(ext) >= 0) return EXT_COLOR.media;
        return EXT_COLOR.other;
    }

    // ---------- 状态 ----------
    var SM = {
        open: false, root: '', files: [], stars: [], clusters: [],
        rotX: -0.35, rotY: 0, zoom: 1, panX: 0, panY: 0,
        dragging: false, lastX: 0, lastY: 0, moved: false,
        selecting: false, selStartX: 0, selStartY: 0,
        hover: -1, raf: 0, canvas: null, ctx: null, wrap: null,
        deps: [], showDeps: false, replayOn: false, replayIdx: -1,
        search: '', filterType: '', filterSize: '', filterAge: '',
        gitHeat: {}, showGitHeat: false, maxHeat: 1,
        isoSet: null, showIso: false,
        compare: null, showCompare: false
    };
    App._starmapState = SM;

    function norm(p) { return String(p || '').replace(/\//g, '\\').replace(/[\\]+$/, ''); }

    // ---------- 面板 ----------
    App.openStarmapPanel = function (rootPath) {
        var panel = document.getElementById('starmapPanel');
        if (!panel) return;
        if (!SM.open) {
            panel.classList.add('open');
            void panel.offsetWidth;
            panel.style.transform = 'translateX(0)';
            SM.open = true;
        }
        var root = norm(rootPath || (App._filetree && App._filetree._ftRoot) || (App.activeProject && App.activeProject.folder_path) || '');
        if (root !== SM.root || !SM.files.length) {
            SM.root = root;
            loadScan();
        } else {
            render(); // 展开即刷新视图
        }
    };
    App.closeStarmapPanel = function () {
        var panel = document.getElementById('starmapPanel');
        if (!panel) return;
        panel.classList.remove('open');
        panel.style.transform = '';
        SM.open = false;
        cancelAnimationFrame(SM.raf);
    };
    App.toggleStarmapPanel = function (rootPath) {
        if (SM.open) App.closeStarmapPanel(); else App.openStarmapPanel(rootPath);
    };

    // ---------- 数据加载 ----------
    function loadScan() {
        var title = document.getElementById('starmapTitle');
        if (title) title.innerHTML = '🌌 星空知识图谱 <small>' + esc(SM.root || '未选择项目') + '</small>';
        var foot = document.getElementById('starmapInfo');
        if (foot) foot.textContent = '扫描中…';
        fetch('/api/starmap/scan?path=' + encodeURIComponent(SM.root), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.ok) { if (foot) foot.textContent = '扫描失败：' + (d && d.error || '未知错误'); return; }
                SM.files = d.files || [];
                SM.deps = d.deps || [];
                SM.gitHeat = d.gitHeat || {};
                var mx = 0;
                for (var k in SM.gitHeat) if (SM.gitHeat[k] > mx) mx = SM.gitHeat[k];
                SM.maxHeat = mx || 1;
                computeIso();
                if (SM.showCompare && SM.compare) loadCompare(); // 主项目刷新时同步对比项目
                buildStars();
                if (foot) foot.textContent = '共 ' + SM.files.length + ' 颗星 · ' + fmtSize(d.totalSize || 0) + ' · 拖拽旋转 / 滚轮缩放 / 空白处左键拖拽框选';
            })
            .catch(function (e) { if (foot) foot.textContent = '扫描失败：' + e; });
    }
    App.refreshStarmap = loadScan; // 外部可调用强制刷新

    // ---------- 孤立文件检测（三期）：无任何依赖边的文件 ----------
    function computeIso() {
        var linked = {};
        SM.deps.forEach(function (d) { linked[d.from] = 1; linked[d.to] = 1; });
        SM.isoSet = {};
        SM.files.forEach(function (f) {
            if (!linked[f.path]) SM.isoSet[f.path] = 1;
        });
    }

    // ---------- 匹配：搜索 + 类型/大小/时间过滤（三期） ----------
    function typeKeyOf(name) {
        var ext = (name.split('.').pop() || '').toLowerCase();
        if (EXT_COLOR[ext]) return ext;
        if (['png','jpg','jpeg','gif','webp','svg','ico','bmp'].indexOf(ext) >= 0) return 'img';
        if (['mp4','mp3','wav','mov','avi','webm'].indexOf(ext) >= 0) return 'media';
        return 'other';
    }
    function matchFilter(s) {
        if (SM.search && s.rel.toLowerCase().indexOf(SM.search) < 0) return false;
        if (SM.filterType && typeKeyOf(s.name) !== SM.filterType) return false;
        if (SM.filterSize) {
            var z = s.size;
            if (SM.filterSize === 'lt10' && z >= 10240) return false;
            if (SM.filterSize === '10-100' && (z < 10240 || z > 102400)) return false;
            if (SM.filterSize === '100-1m' && (z < 102400 || z > 1048576)) return false;
            if (SM.filterSize === 'gt1m' && z <= 1048576) return false;
        }
        if (SM.filterAge) {
            var age = (Date.now() - (s.mtime || 0)) / 86400000;
            if (age > parseFloat(SM.filterAge)) return false;
        }
        return true;
    }
    function hasActiveFilter() {
        return !!(SM.search || SM.filterType || SM.filterSize || SM.filterAge);
    }
    // 当前有效搜索结果数（给底部状态栏）
    function filteredCount() {
        return SM.stars.filter(function (s) { return matchFilter(s); }).length;
    }

    // ---------- 星球构建（目录聚簇） ----------
    function buildStars() {
        // 按一级目录分簇；深度也影响半径（子目录再散开一点）
        var groups = {};
        SM.files.forEach(function (f) {
            var rel = f.path.slice(SM.root.length).replace(/^[\\\/]+/, '');
            var parts = rel.split(/[\\\/]/);
            var g = parts.length > 1 ? parts[0] : '';
            (groups[g] = groups[g] || []).push({ f: f, rel: rel, parts: parts });
        });
        var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; });
        var R = 260; // 簇分布半径
        SM.clusters = [];
        SM.stars = [];
        keys.forEach(function (g, gi) {
            var ang = (gi / keys.length) * Math.PI * 2;
            var cx = Math.cos(ang) * R * (0.55 + 0.45 * Math.random());
            var cz = Math.sin(ang) * R * (0.55 + 0.45 * Math.random());
            var cy = (Math.random() - 0.5) * 120;
            var items = groups[g];
            // 双项目对比模式（三期）：主项目保持原位，对比项目由 appendCompareStars 统一偏移
            var sideX = 0, sideZ = 0;
            SM.clusters.push({ name: g || '(根目录)', x: cx + sideX, y: cy, z: cz + sideZ, count: items.length });
            items.forEach(function (it, ii) {
                // 簇内球面散布
                var u = Math.random(), v = Math.random();
                var r = 30 + 95 * Math.cbrt(Math.random());
                var th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
                // 大小：log 缩放，1KB~10MB 映射 1.2~9
                var sz = Math.max(1.2, Math.min(9, 1.2 + 2.2 * Math.log10(Math.max(1024, it.f.size) / 1024 + 1)));
                // 颜色：类型色 + mtime 调亮度（新=亮）
                var ageDays = (Date.now() - (it.f.mtime || 0)) / 86400000;
                var bright = Math.max(0.45, Math.min(1, 1.25 - ageDays / 60)); // 两个月内由亮到暗
                var c = colorOf(it.f.name);
                // 三期：Git 热力层 —— 用提交热度覆盖颜色（蓝冷→红热）
                if (SM.showGitHeat) {
                    var h = SM.gitHeat[it.f.path] || 0;
                    var t = Math.min(1, h / SM.maxHeat);
                    c = [Math.round(90 + 165 * t), Math.round(170 - 130 * t), Math.round(255 - 200 * t)];
                }
                SM.stars.push({
                    path: it.f.path, name: it.f.name, rel: it.rel, size: it.f.size,
                    mtime: it.f.mtime || 0, idx: SM.stars.length,
                    x: cx + sideX + r * Math.sin(ph) * Math.cos(th),
                    y: cy + r * Math.cos(ph) * 0.7,
                    z: cz + sideZ + r * Math.sin(ph) * Math.sin(th),
                    r: sz, c: c, bright: bright, g: g,
                    heat: SM.gitHeat[it.f.path] || 0
                });
            });
        });
        // 三期：双项目对比——附加第二项目星系
        if (SM.showCompare) appendCompareStars();
        render();
    }

    // ---------- 投影与渲染（纯 2D canvas 模拟 3D） ----------
    function project(p) {
        // 绕 Y 轴 + X 轴旋转，透视投影
        var cy = Math.cos(SM.rotY), sy = Math.sin(SM.rotY);
        var cx = Math.cos(SM.rotX), sx = Math.sin(SM.rotX);
        var x = p.x * cy - p.z * sy;
        var z1 = p.x * sy + p.z * cy;
        var y = p.y * cx - z1 * sx;
        var z = p.y * sx + z1 * cx;
        var persp = 600 / (600 + z);
        return { x: SM.canvas.width / 2 + (x + SM.panX) * persp * SM.zoom, y: SM.canvas.height / 2 + (y + SM.panY) * persp * SM.zoom, s: persp, z: z };
    }

    function draw() {
        var ctx = SM.ctx, W = SM.canvas.width, H = SM.canvas.height;
        ctx.clearRect(0, 0, W, H);
        // 背景微光
        var grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
        grd.addColorStop(0, 'rgba(20,26,60,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);

        var replayMin = SM.replayOn ? Infinity : -Infinity;
        if (SM.replayOn && SM.replayIdx >= 0) {
            // 按时间排序的文件序列，replayIdx 之前的才显示
            replayMin = SM._replayTimes ? SM._replayTimes[SM.replayIdx] : Infinity;
        }

        // 簇标签（小、淡）
        ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        SM.clusters.forEach(function (c) {
            var pr = project(c);
            ctx.fillStyle = c.cmp ? 'rgba(255,205,120,0.5)' : 'rgba(120,140,190,0.35)';
            ctx.fillText(c.name + ' (' + c.count + ')', pr.x, pr.y);
        });

        // 依赖引力线（二期）：hover 星的依赖
        if (SM.showDeps && SM.hover >= 0) {
            var hp = SM.stars[SM.hover];
            SM.deps.forEach(function (d) {
                if (d.from !== hp.path && d.to !== hp.path) return;
                var other = SM.stars.filter(function (s) { return s.path === (d.from === hp.path ? d.to : d.from); })[0];
                if (!other) return;
                var a = project(hp), b = project(other);
                ctx.strokeStyle = 'rgba(110,160,255,0.35)'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            });
        }

        // 星星（按 z 排序，远的先画）
        var order = SM.stars.map(function (s, i) { return i; }).sort(function (a, b) { return project(SM.stars[b]).z - project(SM.stars[a]).z; });
        order.forEach(function (i) {
            var s = SM.stars[i];
            if (SM.replayOn && s.mtime > replayMin) return; // 时间回放：未点亮的星不显示
            // 三期：搜索/过滤——不匹配的星淡化
            var dimmed = hasActiveFilter() && !matchFilter(s);
            if (dimmed) {
                var pr0 = project(s);
                ctx.fillStyle = 'rgba(120,130,160,0.15)';
                ctx.beginPath(); ctx.arc(pr0.x, pr0.y, Math.max(0.6, s.r * pr0.s * SM.zoom * 0.6), 0, Math.PI * 2); ctx.fill();
                return;
            }
            var pr = project(s);
            var sel = App._filetree && App._filetree._ftSelected && App._filetree._ftSelected[s.path];
            var hot = (i === SM.hover);
            var r = Math.max(0.6, s.r * pr.s * SM.zoom * (hot ? 1.5 : 1));
            var c = s.c, br = s.bright;
            // 三期：孤立文件检测——无依赖边的星用暗红色
            if (SM.showIso && SM.isoSet && SM.isoSet[s.path]) { c = [200, 70, 70]; br = Math.max(br, 0.8); }
            // 光晕
            var g2 = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, r * 4);
            g2.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (0.55 * br) + ')');
            g2.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g2;
            ctx.beginPath(); ctx.arc(pr.x, pr.y, r * 4, 0, Math.PI * 2); ctx.fill();
            // 星体
            ctx.fillStyle = 'rgba(' + Math.min(255, c[0] * br + 60) + ',' + Math.min(255, c[1] * br + 60) + ',' + Math.min(255, c[2] * br + 60) + ',' + (0.9 * br + 0.1) + ')';
            ctx.beginPath(); ctx.arc(pr.x, pr.y, r, 0, Math.PI * 2); ctx.fill();
            // 选中圈
            if (sel) {
                ctx.strokeStyle = '#6fff9e'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(pr.x, pr.y, r + 4, 0, Math.PI * 2); ctx.stroke();
            }
            // hover 标签
            if (hot) {
                ctx.fillStyle = 'rgba(210,225,255,0.95)'; ctx.font = '12px sans-serif';
                ctx.fillText(s.name, pr.x, pr.y - r - 8);
            }
        });
    }
    function render() {
        if (!SM.canvas) return;
        if (!SM.raf) SM.raf = requestAnimationFrame(loop);
    }
    function loop() {
        SM.raf = 0;
        if (!SM.open) return;
        draw();
        SM.raf = requestAnimationFrame(loop);
    }

    // ---------- 交互 ----------
    function canvasPos(e) {
        var rect = SM.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function pick(px, py) {
        var best = -1, bd = 1e9;
        SM.stars.forEach(function (s, i) {
            if (SM.replayOn && !starLit(s)) return;
            if (hasActiveFilter() && !matchFilter(s)) return; // 被过滤掉的星不可选中
            var pr = project(s);
            var r = Math.max(3, s.r * pr.s * SM.zoom) + 5;
            var d = (pr.x - px) * (pr.x - px) + (pr.y - py) * (pr.y - py);
            if (d < r * r && d < bd) { bd = d; best = i; }
        });
        return best;
    }
    function starLit(s) {
        if (!SM.replayOn || SM.replayIdx < 0 || !SM._replayTimes) return true;
        return s.mtime <= SM._replayTimes[SM.replayIdx];
    }

    function initEvents() {
        var cv = SM.canvas;
        cv.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            var p = canvasPos(e);
            SM.dragging = true; SM.moved = false;
            SM.lastX = e.clientX; SM.lastY = e.clientY;
            var onStar = pick(p.x, p.y) >= 0;
            if (!onStar) { SM.selecting = true; SM.selStartX = p.x; SM.selStartY = p.y; }
            e.preventDefault();
        });
        window.addEventListener('mousemove', function (e) {
            if (!SM.open) return;
            var p = canvasPos(e);
            if (SM.dragging) {
                var dx = e.clientX - SM.lastX, dy = e.clientY - SM.lastY;
                if (Math.abs(dx) + Math.abs(dy) > 2) SM.moved = true;
                if (e.shiftKey || SM.selecting) {
                    // 框选（Shift 拖拽 或 空白处拖拽）
                    var box = document.getElementById('smSelectBox');
                    if (box) {
                        box.style.display = 'block';
                        box.style.left = Math.min(SM.selStartX, p.x) + 'px';
                        box.style.top = Math.min(SM.selStartY, p.y) + 'px';
                        box.style.width = Math.abs(p.x - SM.selStartX) + 'px';
                        box.style.height = Math.abs(p.y - SM.selStartY) + 'px';
                    }
                } else if (e.altKey || e.ctrlKey) {
                    // Alt/Ctrl+拖拽：平移
                    SM.panX += dx / SM.zoom; SM.panY += dy / SM.zoom;
                } else {
                    // 旋转
                    SM.rotY += dx * 0.005; SM.rotX = Math.max(-1.4, Math.min(1.4, SM.rotX + dy * 0.005));
                }
                SM.lastX = e.clientX; SM.lastY = e.clientY;
            } else {
                // hover
                var idx = pick(p.x, p.y);
                if (idx !== SM.hover) { SM.hover = idx; updateTooltip(idx, p); }
                else if (idx >= 0) positionTooltip(p);
            }
        });
        window.addEventListener('mouseup', function (e) {
            if (!SM.open || !SM.dragging) return;
            SM.dragging = false;
            var box = document.getElementById('smSelectBox');
            var p = canvasPos(e);
            if (SM.selecting && box && box.style.display !== 'none') {
                var x1 = Math.min(SM.selStartX, p.x), x2 = Math.max(SM.selStartX, p.x);
                var y1 = Math.min(SM.selStartY, p.y), y2 = Math.max(SM.selStartY, p.y);
                if (x2 - x1 > 4 && y2 - y1 > 4) applyBoxSelect(x1, y1, x2, y2, e.shiftKey);
                box.style.display = 'none';
            } else if (!SM.moved && e.button === 0) {
                // 单击星星：切换选中
                var idx = pick(p.x, p.y);
                if (idx >= 0 && App._filetree) {
                    var path = SM.stars[idx].path;
                    if (App._filetree._ftSelected) {
                        if (App._filetree._ftSelected[path]) delete App._filetree._ftSelected[path];
                        else App._filetree._ftSelected[path] = true;
                    }
                    try { if (App._renderThumbs) App._renderThumbs(); } catch (err) {}
                }
            }
            SM.selecting = false;
        });
        cv.addEventListener('wheel', function (e) {
            e.preventDefault();
            SM.zoom = Math.max(0.2, Math.min(6, SM.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
        }, { passive: false });

        // 防止拖拽选中文本
        cv.addEventListener('selectstart', function (e) { e.preventDefault(); });
    }

    function applyBoxSelect(x1, y1, x2, y2, subtract) {
        var sel = App._filetree && App._filetree._ftSelected;
        if (!sel) return;
        var hit = [];
        SM.stars.forEach(function (s) {
            if (!starLit(s)) return;
            var pr = project(s);
            if (pr.x >= x1 && pr.x <= x2 && pr.y >= y1 && pr.y <= y2) hit.push(s.path);
        });
        if (subtract) hit.forEach(function (p) { delete sel[p]; });   // Shift 框选 = 减选
        else hit.forEach(function (p) { sel[p] = true; });          // 普通框选 = 加选
        try { if (App._renderThumbs) App._renderThumbs(); } catch (e) {}
        var foot = document.getElementById('starmapInfo');
        if (foot) foot.textContent = (subtract ? '已减选 ' : '已选中 ') + hit.length + ' 个文件';
    }

    // ---------- Tooltip ----------
    function updateTooltip(idx, p) {
        var tt = document.getElementById('smTooltip');
        if (!tt) return;
        if (idx < 0) { tt.style.display = 'none'; return; }
        var s = SM.stars[idx];
        var ageDays = Math.floor((Date.now() - s.mtime) / 86400000);
        tt.innerHTML = '<div class="sm-tt-name">' + esc(s.name) + (s.cmp ? ' <span style="color:#ffcf78">⟷对比</span>' : '') + '</div>' +
            '<div class="sm-tt-sub">' + esc(s.rel) + '</div>' +
            '<div class="sm-tt-sub">' + fmtSize(s.size) + ' · ' + fmtTime(s.mtime) + ' (' + (ageDays < 1 ? '今天' : ageDays + ' 天前') + ')</div>' +
            (s.heat ? '<div class="sm-tt-sub" style="color:#ff9a6a;">🔥 近180天 ' + s.heat + ' 次提交</div>' : '') +
            (SM.showIso && SM.isoSet && SM.isoSet[s.path] ? '<div class="sm-tt-sub" style="color:#e06a6a;">🪐 孤立文件（无依赖边）</div>' : '') +
            '<div class="sm-tt-sub">' + (SM.showDeps ? '依赖线已开启' : '单击选中/取消 · Shift 框选减选') + '</div>';
        tt.style.display = 'block';
        positionTooltip(p);
    }
    function positionTooltip(p) {
        var tt = document.getElementById('smTooltip');
        if (!tt) return;
        var w = SM.wrap.offsetWidth, h = SM.wrap.offsetHeight;
        var x = p.x + 14, y = p.y + 14;
        if (x + 320 > w) x = p.x - 334;
        if (y + 90 > h) y = p.y - 96;
        tt.style.left = Math.max(4, x) + 'px'; tt.style.top = Math.max(4, y) + 'px';
    }

    // ---------- 工具栏 ----------
    function initToolbar() {
        var refresh = document.getElementById('smRefreshBtn');
        if (refresh) refresh.addEventListener('click', loadScan);
        var reset = document.getElementById('smResetBtn');
        if (reset) reset.addEventListener('click', function () {
            SM.rotX = -0.35; SM.rotY = 0; SM.zoom = 1; SM.panX = 0; SM.panY = 0; render();
        });
        var deps = document.getElementById('smDepsBtn');
        if (deps) deps.addEventListener('click', function () {
            SM.showDeps = !SM.showDeps;
            deps.classList.toggle('active', SM.showDeps);
            render();
        });
        var replay = document.getElementById('smReplayBtn');
        if (replay) replay.addEventListener('click', function () {
            SM.replayOn = !SM.replayOn;
            replay.classList.toggle('active', SM.replayOn);
            var bar = document.getElementById('smReplayBar');
            if (bar) bar.classList.toggle('show', SM.replayOn);
            if (SM.replayOn) {
                // 按 mtime 升序生成时间轴
                var ts = SM.stars.map(function (s) { return s.mtime; }).sort(function (a, b) { return a - b; });
                SM._replayTimes = ts;
                SM.replayIdx = ts.length - 1;
                var slider = document.getElementById('smReplaySlider');
                if (slider) { slider.max = Math.max(0, ts.length - 1); slider.value = SM.replayIdx; }
                updateReplayLabel();
            } else { SM.replayIdx = -1; render(); }
        });
        var slider = document.getElementById('smReplaySlider');
        if (slider) slider.addEventListener('input', function () {
            SM.replayIdx = parseInt(this.value, 10) || 0;
            updateReplayLabel(); render();
        });
        var close = document.getElementById('starmapCloseBtn');
        if (close) close.addEventListener('click', App.closeStarmapPanel);

        // ---------- 三期：搜索 / 过滤 ----------
        var searchTimer = 0;
        var searchInput = document.getElementById('smSearchInput');
        if (searchInput) searchInput.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                SM.search = (searchInput.value || '').trim().toLowerCase();
                updateFilterInfo(); render();
            }, 150);
        });
        ['smFilterType', 'smFilterSize', 'smFilterAge'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', function () {
                if (id === 'smFilterType') SM.filterType = el.value;
                if (id === 'smFilterSize') SM.filterSize = el.value;
                if (id === 'smFilterAge') SM.filterAge = el.value;
                updateFilterInfo(); render();
            });
        });
        function updateFilterInfo() {
            var foot = document.getElementById('starmapInfo');
            if (foot && hasActiveFilter()) foot.textContent = '匹配 ' + filteredCount() + ' / ' + SM.stars.length + ' 颗星';
        }

        // ---------- 三期：Git 热力层 ----------
        var gitBtn = document.getElementById('smGitBtn');
        if (gitBtn) gitBtn.addEventListener('click', function () {
            SM.showGitHeat = !SM.showGitHeat;
            gitBtn.classList.toggle('active', SM.showGitHeat);
            buildStars(); // 颜色在 buildStars 中重算
        });

        // ---------- 三期：孤立文件检测 ----------
        var isoBtn = document.getElementById('smIsoBtn');
        if (isoBtn) isoBtn.addEventListener('click', function () {
            SM.showIso = !SM.showIso;
            isoBtn.classList.toggle('active', SM.showIso);
            var n = 0;
            if (SM.isoSet) for (var k in SM.isoSet) n++;
            var foot = document.getElementById('starmapInfo');
            if (foot && SM.showIso) foot.textContent = '孤立文件（无依赖边）：' + n + ' 个（暗红色）';
            render();
        });

        // ---------- 三期：双项目对比 ----------
        var cmpBtn = document.getElementById('smCompareBtn');
        if (cmpBtn) cmpBtn.addEventListener('click', toggleCompare);
    }

    // ---------- 双项目对比模式（三期） ----------
    function toggleCompare() {
        var cmpBtn = document.getElementById('smCompareBtn');
        if (SM.showCompare) { // 关闭对比
            SM.showCompare = false;
            SM.compare = null;
            if (cmpBtn) cmpBtn.classList.remove('active');
            buildStars();
            return;
        }
        // 弹窗输入第二个项目路径
        var p2 = window.prompt('输入第二个项目的完整路径（将与当前项目并排显示，金色星系）：\n例如 F:\\\\其他项目目录', '');
        if (!p2) return;
        SM.compare = { root: norm(p2), files: [], deps: [], stars: [] };
        SM.showCompare = true;
        if (cmpBtn) cmpBtn.classList.add('active');
        var foot = document.getElementById('starmapInfo');
        if (foot) foot.textContent = '对比项目扫描中…';
        fetch('/api/starmap/scan?path=' + encodeURIComponent(SM.compare.root), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.ok) {
                    if (foot) foot.textContent = '对比项目加载失败：' + (d && d.error || '未知错误');
                    SM.showCompare = false; SM.compare = null;
                    if (cmpBtn) cmpBtn.classList.remove('active');
                    return;
                }
                SM.compare.files = d.files || [];
                SM.compare.root = d.root || SM.compare.root;
                // 金色系（与主项目的类型色区分）
                SM.compare.colorSet = [
                    [255, 205, 100], [255, 180, 90], [255, 230, 150], [255, 160, 80], [240, 195, 120]
                ];
                buildStars();
                if (foot) foot.textContent = '对比：主项目 ' + SM.stars.length + ' 星 + 对比项目 ' + (SM.compare.files.length) + ' 星（金色系，偏移 700px 并排）';
            })
            .catch(function (e) {
                if (foot) foot.textContent = '对比项目加载失败：' + e;
                SM.showCompare = false; SM.compare = null;
                if (cmpBtn) cmpBtn.classList.remove('active');
            });
    }

    // 对比项目：为每个一级目录 g 计算偏移（金色星系整体放在 X 正方向）
    function compareOffsetFor(g) {
        // 简单方案：整个对比项目统一偏移到主项目旁边
        return { x: 700, z: 0 };
    }

    // buildStars 时若开启对比，把对比项目作为附加星系加入
    function appendCompareStars() {
        var cmp = SM.compare;
        if (!cmp || !cmp.files.length) return;
        // 按一级目录分簇（同主项目逻辑）
        var groups = {};
        cmp.files.forEach(function (f) {
            var rel = f.path.slice(cmp.root.length).replace(/^[\\\/]+/, '');
            var parts = rel.split(/[\\\/]/);
            var g = parts.length > 1 ? parts[0] : '';
            (groups[g] = groups[g] || []).push({ f: f, rel: rel });
        });
        var keys = Object.keys(groups);
        var R = 260, base = 700; // 对比星系中心偏移
        keys.forEach(function (g, gi) {
            var ang = (gi / keys.length) * Math.PI * 2;
            var cx = base + Math.cos(ang) * R * 0.5;
            var cz = Math.sin(ang) * R * 0.5;
            var cy = (Math.random() - 0.5) * 100;
            var items = groups[g];
            SM.clusters.push({ name: '⟷ ' + (g || '(根目录)'), x: cx, y: cy, z: cz, count: items.length, cmp: true });
            items.forEach(function (it) {
                var u = Math.random(), v = Math.random();
                var r = 30 + 80 * Math.cbrt(Math.random());
                var th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
                var sz = Math.max(1.2, Math.min(9, 1.2 + 2.2 * Math.log10(Math.max(1024, it.f.size) / 1024 + 1)));
                var ageDays = (Date.now() - (it.f.mtime || 0)) / 86400000;
                var bright = Math.max(0.45, Math.min(1, 1.25 - ageDays / 60));
                var ci = Math.floor(Math.random() * cmp.colorSet.length);
                var c = cmp.colorSet[ci];
                SM.stars.push({
                    path: it.f.path, name: it.f.name, rel: it.rel, size: it.f.size,
                    mtime: it.f.mtime || 0, idx: SM.stars.length,
                    x: cx + r * Math.sin(ph) * Math.cos(th),
                    y: cy + r * Math.cos(ph) * 0.7,
                    z: cz + r * Math.sin(ph) * Math.sin(th),
                    r: sz, c: c, bright: bright, g: g, cmp: true
                });
            });
        });
    }
    function updateReplayLabel() {
        var lab = document.getElementById('smReplayTime');
        if (lab && SM._replayTimes && SM.replayIdx >= 0) {
            lab.textContent = fmtTime(SM._replayTimes[SM.replayIdx]) + ' (' + (SM.replayIdx + 1) + '/' + SM._replayTimes.length + ')';
        }
    }

    // ---------- 启动 ----------
    function init() {
        SM.canvas = document.getElementById('smCanvas');
        SM.wrap = document.getElementById('smCanvasWrap');
        if (!SM.canvas) return;
        SM.ctx = SM.canvas.getContext('2d');
        function resize() {
            if (!SM.wrap) return;
            SM.canvas.width = SM.wrap.clientWidth;
            SM.canvas.height = SM.wrap.clientHeight;
            render();
        }
        // 【防闪烁】F12 开 DevTools 会连发 resize，加 200ms 防抖，避免整块星图反复重绘
        var _rszT = null;
        window.addEventListener('resize', function () {
            if (_rszT) clearTimeout(_rszT);
            _rszT = setTimeout(function () { resize(); _rszT = null; }, 200);
        });
        // 面板打开时也要重设尺寸（display 变化后 clientWidth 才有值）
        var mo = new MutationObserver(function () { setTimeout(resize, 50); });
        mo.observe(document.getElementById('starmapPanel'), { attributes: true, attributeFilter: ['class'] });
        initEvents();
        initToolbar();
        setTimeout(resize, 200);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.App = App;
})();
