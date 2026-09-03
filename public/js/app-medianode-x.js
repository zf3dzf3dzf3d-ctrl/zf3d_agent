// ========== app-medianode-x.js - 参考图节点功能增强（PureRef 式） ==========
// 基于 app-mediadrag.js 的 .media-canvas-node 增强：
//   1. 点选/框选多选（Shift 加选、Ctrl+左键框选）
//   2. 批量移动（拖组内一张，整组跟随）
//   3. 旋转（Ctrl+滚轮 或 右键菜单 ±90°）、翻转（H/V）、重置变换
//   4. 右键菜单：置顶/置底、复制、删除、导出、识图、作为生成输入
//   5. Ctrl+V 粘贴剪贴板图片进画布
//   6. 文件树/资源管理器图片文件拖入画布
//   7. 选中状态注入识图管道（与文件树选中同管道）
//   8. 持久化：保存到当前项目目录 canvas-refboard.json（含旋转/翻转）
(function () {
    'use strict';

    var SEL = '.media-canvas-node';
    var _seq = 0;

    // ---------- 工具 ----------
    function nodes() {
        return Array.prototype.slice.call(document.querySelectorAll(SEL));
    }
    function selected() {
        return nodes().filter(function (n) { return n.classList.contains('mref-selected'); });
    }
    function clearSel() {
        nodes().forEach(function (n) { n.classList.remove('mref-selected'); });
        syncSelBar();
    }
    function setSel(node, add) {
        if (!add) clearSel();
        node.classList.add('mref-selected');
        // 置顶以便观察
        node.style.zIndex = 5000 + (++_seq);
        syncSelBar();
    }

    // ---------- 变换（旋转/翻转）----------
    function nodeTransform(n) {
        return {
            rot: parseFloat(n.dataset.mrefRot || '0'),
            fx: n.dataset.mrefFx === '1',
            fy: n.dataset.mrefFy === '1'
        };
    }
    function applyTransform(n) {
        var t = nodeTransform(n);
        var m = 'rotate(' + t.rot + 'deg) scaleX(' + (t.fx ? -1 : 1) + ') scaleY(' + (t.fy ? -1 : 1) + ')';
        var inner = n.querySelector('.media-node-el');
        if (inner) inner.style.transform = m;
        n.dataset.mrefRot = String(t.rot);
        n.dataset.mrefFx = t.fx ? '1' : '0';
        n.dataset.mrefFy = t.fy ? '1' : '0';
        saveSoon();
    }
    function transformSel(fn) {
        var sel = selected();
        if (!sel.length) return;
        sel.forEach(function (n) {
            var t = nodeTransform(n);
            fn(t);
            n.dataset.mrefRot = String(t.rot);
            n.dataset.mrefFx = t.fx ? '1' : '0';
            n.dataset.mrefFy = t.fy ? '1' : '0';
            applyTransform(n);
        });
    }

    // ---------- 选择交互 ----------
    function initSelection() {
        document.addEventListener('pointerdown', function (e) {
            var node = e.target.closest && e.target.closest(SEL);
            if (!node) {
                if (!e.target.closest || (!e.target.closest('#canvasArea') && !e.target.closest(SEL))) return;
                if (selected().length) clearSel();
                return;
            }
            if (e.target.closest('.media-act') || e.target.classList.contains('media-h')) return;
            if (e.button !== 0 && e.button !== 2) return;
            var isSel = node.classList.contains('mref-selected');
            if (e.shiftKey || e.ctrlKey) {
                node.classList.toggle('mref-selected');
            } else if (!isSel) {
                setSel(node);
            }
            syncSelBar();
        }, true);
    }

    // ---------- 批量移动：拖组内节点，整组跟随 ----------
    function initGroupMove() {
        document.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            var node = e.target.closest && e.target.closest(SEL);
            if (!node) return;
            if (e.target.closest('.media-act') || e.target.classList.contains('media-h')) return;
            var group = selected();
            if (!node.classList.contains('mref-selected') || group.length < 2) return;
            var sx = e.clientX, sy = e.clientY;
            var starts = group.map(function (n) {
                return { n: n, l: parseFloat(n.style.left) || 0, t: parseFloat(n.style.top) || 0 };
            });
            var moved = false;
            function onMove(ev) {
                var dx = ev.clientX - sx, dy = ev.clientY - sy;
                if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
                starts.forEach(function (s) {
                    s.n.style.left = (s.l + dx) + 'px';
                    s.n.style.top = (s.t + dy) + 'px';
                });
            }
            function onUp() {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                if (moved) saveSoon();
            }
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            e.preventDefault();
        }, true);
    }

    // ---------- 框选（Ctrl+左键在画布空白处已由 app-canvas.js 处理 kite-node；
    //           此处为 media 节点补框选：Ctrl+Alt 拖拽或 Shift 空白拖拽） ----------
    function initMarquee() {
        var surface = document.getElementById('canvasArea');
        if (!surface) return;
        surface.addEventListener('pointerdown', function (e) {
            // Shift+左键空白：框选 media 节点（不影响已有 Ctrl/Alt 框选逻辑）
            if (e.button !== 0 || !e.shiftKey) return;
            var target = e.target;
            if (target.closest && target.closest(SEL + ',.chatbox,.kite-node,#minimap,.kite-image-panel')) return;
            e.preventDefault();
            var rect = document.createElement('div');
            rect.style.cssText = 'position:fixed;z-index:99998;pointer-events:none;border:1px dashed #7ab6ff;background:rgba(90,140,255,.12);display:none;';
            document.body.appendChild(rect);
            var sx = e.clientX, sy = e.clientY;
            var base = selected();
            function onMove(ev) {
                var x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY);
                var w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
                rect.style.display = 'block'; rect.style.left = x + 'px'; rect.style.top = y + 'px';
                rect.style.width = w + 'px'; rect.style.height = h + 'px';
                nodes().forEach(function (n) {
                    var r = n.getBoundingClientRect();
                    var hit = r.left < x + w && r.right > x && r.top < y + h && r.bottom > y;
                    n.classList.toggle('mref-selected', hit || base.indexOf(n) !== -1);
                });
                syncSelBar();
            }
            function onUp() {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                rect.remove();
            }
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });
    }

    // ---------- Ctrl+滚轮旋转选中节点 ----------
    function initWheelRotate() {
        var surface = document.getElementById('canvasArea');
        if (!surface) return;
        surface.addEventListener('wheel', function (e) {
            if (!e.ctrlKey) return;
            var node = e.target.closest && e.target.closest(SEL);
            if (!node) return;
            e.preventDefault();
            e.stopPropagation();
            var sel = selected();
            if (sel.indexOf(node) === -1) sel = [node];
            var step = e.deltaY > 0 ? 5 : -5;
            sel.forEach(function (n) {
                var t = nodeTransform(n);
                t.rot = (t.rot + step) % 360;
                n.dataset.mrefRot = String(t.rot);
                applyTransform(n);
            });
        }, { passive: false });
    }

    // ---------- 右键菜单 ----------
    function initMenu() {
        var menu = null;
        function closeMenu() { if (menu) { menu.remove(); menu = null; } }
        document.addEventListener('contextmenu', function (e) {
            var node = e.target.closest && e.target.closest(SEL);
            if (!node) { closeMenu(); return; }
            e.preventDefault(); e.stopPropagation();
            if (!node.classList.contains('mref-selected')) setSel(node);
            closeMenu();
            menu = document.createElement('div');
            menu.className = 'mref-menu';
            menu.style.cssText = 'position:fixed;z-index:999999;background:rgba(28,30,38,.96);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:4px;min-width:150px;box-shadow:0 8px 30px rgba(0,0,0,.5);font-size:13px;color:#dde;';
            var items = [
                ['🔄 左转 90°', function () { transformSel(function (t) { t.rot -= 90; }); }],
                ['🔄 右转 90°', function () { transformSel(function (t) { t.rot += 90; }) }],
                ['↔️ 水平翻转', function () { transformSel(function (t) { t.fx = !t.fx; }) }],
                ['↕️ 垂直翻转', function () { transformSel(function (t) { t.fy = !t.fy; }) }],
                ['♻️ 重置变换', function () { transformSel(function (t) { t.rot = 0; t.fx = false; t.fy = false; }) }],
                null,
                ['⬆️ 置顶', function () { selected().forEach(function (n) { n.style.zIndex = 5000 + (++_seq); }) }],
                ['⬇️ 置底', function () { selected().forEach(function (n) { n.style.zIndex = 1; }) }],
                ['📋 复制一份', function () { selected().forEach(function (n) { cloneNode(n, 24, 24); }) }],
                ['💾 导出图片', function () { exportNode(selected()[0]); }],
                null,
                ['🖼️ 识图发送', function () { visionSend(); }],
                ['🎨 作为生成输入', function () { useAsGenInput(); }],
                null,
                ['🗑️ 删除', function () { selected().forEach(function (n) { n.remove(); }); saveSoon(); syncSelBar(); }]
            ];
            items.forEach(function (it) {
                if (!it) {
                    var sep = document.createElement('div');
                    sep.style.cssText = 'height:1px;background:rgba(255,255,255,.1);margin:3px 6px;';
                    menu.appendChild(sep); return;
                }
                var b = document.createElement('div');
                b.textContent = it[0];
                b.style.cssText = 'padding:6px 12px;border-radius:5px;cursor:pointer;white-space:nowrap;';
                b.onmouseenter = function () { this.style.background = 'rgba(90,140,255,.25)'; };
                b.onmouseleave = function () { this.style.background = 'none'; };
                b.onclick = function () { closeMenu(); it[1](); };
                menu.appendChild(b);
            });
            document.body.appendChild(menu);
            var mw = menu.offsetWidth, mh = menu.offsetHeight;
            menu.style.left = Math.min(e.clientX, window.innerWidth - mw - 8) + 'px';
            menu.style.top = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';
        });
        document.addEventListener('pointerdown', function (e) {
            if (menu && !menu.contains(e.target)) closeMenu();
        }, true);
    }

    function cloneNode(n, dx, dy) {
        var c = n.cloneNode(true);
        c.classList.remove('mref-selected');
        c.id = 'medianode-x' + (++_seq) + '-' + Date.now().toString(36);
        c.style.left = ((parseFloat(n.style.left) || 0) + dx) + 'px';
        c.style.top = ((parseFloat(n.style.top) || 0) + dy) + 'px';
        var host = document.getElementById('canvasContent');
        if (host) host.appendChild(c);
        saveSoon();
        return c;
    }

    function exportNode(n) {
        if (!n) return;
        var src = n.dataset.src;
        if (!src) return;
        var a = document.createElement('a');
        a.href = src; a.download = (n.dataset.prompt || 'refboard') + '.png';
        a.target = '_blank'; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
    }

    // ---------- 识图 / 生成输入（走统一管道） ----------
    function firstSelectedImage() {
        var sel = selected();
        for (var i = 0; i < sel.length; i++) {
            var img = sel[i].querySelector('.media-node-el');
            if (img && img.tagName === 'IMG' && img.src) return img;
        }
        return null;
    }

    function fetchAsFile(url, name) {
        return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
            .then(function (blob) { return new File([blob], name, { type: blob.type || 'image/png' }); });
    }

    function visionSend() {
        var img = firstSelectedImage();
        if (!img) return;
        var name = (img.alt || 'refboard.png').split(/[\\\/]/).pop() || 'refboard.png';
        fetchAsFile(img.src, name).then(function (file) {
            // 注入到焦点对话框的待发图片暂存（与文件树识图同一管道）
            var box = document.querySelector('.chatbox.focused') || document.querySelector('.chatbox');
            if (!box) return;
            if (typeof App !== 'undefined' && App._addPendingImages) {
                App._addPendingImages(box, [file]);
                if (typeof App !== 'undefined' && App._toast) App._toast('🖼️ 已附加画布参考图，输入问题发送即可识图', 'ok');
            }
        }).catch(function (e) { console.warn('[mref] fetch img fail', e); });
    }

    function useAsGenInput() {
        var img = firstSelectedImage();
        if (!img) return;
        var src = img.src;
        // 与左侧缩略图/媒体选择同一管道：写入 zf3d 选中集合 & 通知生成面板
        try {
            if (typeof window.KitePanels !== 'undefined' && KitePanels.setGenInputImage) {
                KitePanels.setGenInputImage(src); return;
            }
            if (typeof window.setGenInputImage === 'function') { window.setGenInputImage(src); return; }
            // 回退：把 src 放到剪贴板式全局变量并提示
            window.__mrefGenInputSrc = src;
        } catch (e) {}
        if (typeof App !== 'undefined' && App._toast) App._toast('🎨 已设为生成输入图（画布参考图）', 'ok');
        // 尝试打开文生图双面板并注入
        try {
            if (window.KiteCanvas && KiteCanvas.openDualPanels) KiteCanvas.openDualPanels(window.innerWidth / 2, window.innerHeight / 2);
        } catch (e) {}
    }

    // ---------- 图片上传（blob → 持久 URL，重启不丢） ----------
    function uploadImageFile(file, cb) {
        // 先用 blob 立即显示，上传成功后替换为持久 URL
        var tempUrl = URL.createObjectURL(file);
        try {
            var reader = new FileReader();
            reader.onload = function () {
                fetch('/api/refboard-media-save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: file.name || 'image.png', dataBase64: reader.result })
                }).then(function (r) { return r.ok ? r.json() : null; })
                  .then(function (res) {
                      if (res && res.ok && res.url) { try { URL.revokeObjectURL(tempUrl); } catch (e) {} cb(res.url); }
                      else cb(tempUrl); // 上传失败，保留 blob 临时显示（旧回退行为）
                  })
                  .catch(function () { cb(tempUrl); });
            };
            reader.onerror = function () { cb(tempUrl); };
            reader.readAsDataURL(file);
        } catch (e) { cb(tempUrl); }
    }
    function replaceNodeSrc(node, newSrc) {
        var img = node.querySelector('.media-node-el');
        if (!img) return;
        img.src = newSrc;
        node.dataset.src = newSrc;
        saveSoon();
    }

    // ---------- Ctrl+V 粘贴图片 ----------
    function initPaste() {
        document.addEventListener('paste', function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            var imgs = [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].type && items[i].type.indexOf('image') === 0) imgs.push(items[i]);
            }
            if (!imgs.length) return;
            // 仅当焦点不在输入框时或目标在画布上才接管，避免影响正常粘贴文本
            var ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
            e.preventDefault();
            imgs.forEach(function (it, idx) {
                var blob = it.getAsFile();
                if (!blob) return;
                var url = URL.createObjectURL(blob);
                var v = (typeof App !== 'undefined' && App.canvasGetView) ? App.canvasGetView() : { x: 0, y: 0 };
                var x = window.innerWidth / 2 - v.x - 130 + idx * 40;
                var y = window.innerHeight / 2 - v.y - 100 + idx * 40;
                var node = (typeof createMediaCanvasNode === 'function') ? createMediaCanvasNode({ type: 'image', src: url, prompt: '剪贴板图片', x: x, y: y, width: 260 }) : null;
                if (node) {
                    setSel(node);
                    // 上传换持久 URL（重启不丢）
                    uploadImageFile(blob, function (persistUrl) { replaceNodeSrc(node, persistUrl); });
                }
            });
        });
    }

    // ---------- 外部文件拖入画布 ----------
    function initFileDrop() {
        var surface = document.getElementById('canvasArea');
        if (!surface) return;
        surface.addEventListener('dragover', function (e) {
            if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        });
        surface.addEventListener('drop', function (e) {
            var files = e.dataTransfer && e.dataTransfer.files;
            if (!files || !files.length) return;
            var IMG_RE = /\.(png|jpe?g|webp|gif|bmp|svg|ico|tiff?)$/i;
            var dropped = [];
            for (var i = 0; i < files.length; i++) {
                if (IMG_RE.test(files[i].name)) dropped.push(files[i]);
            }
            if (!dropped.length) return;
            e.preventDefault(); e.stopPropagation();
            var v = (typeof App !== 'undefined' && App.canvasGetView) ? App.canvasGetView() : { x: 0, y: 0 };
            dropped.forEach(function (f, idx) {
                var url = URL.createObjectURL(f);
                var node = createMediaCanvasNode({
                    type: 'image', src: url, prompt: f.name,
                    x: e.clientX - v.x - 90 + idx * 30,
                    y: e.clientY - v.y - 90 + idx * 30,
                    width: 260
                });
                // 上传换持久 URL（重启不丢）
                if (node) uploadImageFile(f, function (persistUrl) { replaceNodeSrc(node, persistUrl); });
            });
        });
    }

    // ---------- 选中条同步（对话框上方显示画布选中参考图提示） ----------
    function syncSelBar() {
        var sel = selected().filter(function (n) {
            var img = n.querySelector('.media-node-el');
            return img && img.tagName === 'IMG';
        });
        var bars = document.querySelectorAll('.chat-sel-bar');
        if (!bars.length || !sel.length) return;
        bars.forEach(function (bar) {
            if (!sel.length) return;
            var exist = bar.querySelector('.csb-mref');
            if (exist) exist.remove();
            var chip = document.createElement('span');
            chip.className = 'csb-chip csb-mref';
            chip.style.borderColor = 'var(--accent,#5a8cff)';
            chip.title = '🖼️ 画布已选中 ' + sel.length + ' 张参考图，发送消息可识图/生成';
            chip.textContent = '🖼️×' + sel.length;
            var clear = bar.querySelector('.csb-clear');
            bar.insertBefore(chip, clear || null);
        });
    }

    // ---------- 持久化：项目目录 canvas-refboard.json ----------
    var _saveTimer = null;
    function saveSoon() {
        if (_saveTimer) return;
        _saveTimer = setTimeout(function () { _saveTimer = null; saveRefboard(); }, 600);
    }
    function saveRefboard() {
        var items = nodes().map(function (n) {
            var img = n.querySelector('.media-node-el');
            var t = nodeTransform(n);
            return {
                src: n.dataset.src, prompt: n.dataset.prompt || '', type: n.dataset.mediaType || 'image',
                x: parseFloat(n.style.left) || 0, y: parseFloat(n.style.top) || 0,
                w: n.offsetWidth || 260, rot: t.rot, fx: t.fx, fy: t.fy
            };
        }).filter(function (i) { return i.src && i.src.indexOf('blob:') !== 0; }); // blob: 临时地址不持久化（刷新后必失效）
        var payload = JSON.stringify({ version: 1, savedAt: Date.now(), items: items });
        // 优先存 localStorage（快），尝试同步到项目目录（经 API）
        try { localStorage.setItem('zf3d.refboard.v1', payload); } catch (e) {}
        fetch('/api/refboard-save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: payload })
        }).catch(function () {});
    }
    function loadRefboard(cb) {
        fetch('/api/refboard-load', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (res) {
                if (res && res.content) {
                    try {
                        var data = JSON.parse(res.content);
                        if (data.items && data.items.length) { cb(data.items); return; }
                    } catch (e) {}
                }
                // 回退 localStorage
                try {
                    var local = JSON.parse(localStorage.getItem('zf3d.refboard.v1') || 'null');
                    if (local && local.items) cb(local.items);
                } catch (e) {}
            })
            .catch(function () {
                try {
                    var local2 = JSON.parse(localStorage.getItem('zf3d.refboard.v1') || 'null');
                    if (local2 && local2.items) cb(local2.items);
                } catch (e) {}
            });
    }

    function restoreItems(items) {
        var host = document.getElementById('canvasContent');
        if (!host || !items) return;
        // 避免与 app-mediadrag 的 loadMediaNodes 重复：恢复前清空 media 节点
        nodes().forEach(function (n) { n.remove(); });
        items.filter(function (i) { return i.src && i.src.indexOf('blob:') !== 0; }).forEach(function (i) {
            var n = createMediaCanvasNode({
                type: i.type || 'image', src: i.src, prompt: i.prompt || '',
                x: i.x, y: i.y, width: i.w || 260
            });
            if (!n) return;
            n.dataset.mrefRot = String(i.rot || 0);
            n.dataset.mrefFx = i.fx ? '1' : '0';
            n.dataset.mrefFy = i.fy ? '1' : '0';
            applyTransform(n);
        });
    }

    // ---------- 样式 ----------
    function injectStyle() {
        if (document.getElementById('mref-style')) return;
        var s = document.createElement('style');
        s.id = 'mref-style';
        s.textContent =
            '.media-canvas-node{outline:2px solid transparent;outline-offset:2px;transition:outline-color .12s;}' +
            '.media-canvas-node.mref-selected{outline-color:#5a8cff;}' +
            '.media-canvas-node .media-node-el{transform-origin:center center;}' +
            '.mref-menu{user-select:none;}';
        document.head.appendChild(s);
    }

    // ---------- init ----------
    function init() {
        injectStyle();
        initSelection();
        initGroupMove();
        initMarquee();
        initWheelRotate();
        initMenu();
        initPaste();
        initFileDrop();
        // 延迟恢复：等 app-mediadrag 的 loadMediaNodes 完成后再覆盖
        setTimeout(function () { loadRefboard(restoreItems); }, 1200);
        // 任何 media 节点变化后自动保存
        var host = document.getElementById('canvasContent');
        if (host) {
            var mo = new MutationObserver(function () { saveSoon(); });
            mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // 暴露 API
    Object.assign(window, {
        MRef: {
            selected: selected,
            clearSel: clearSel,
            visionSend: visionSend,
            useAsGenInput: useAsGenInput,
            save: saveRefboard,
            reload: function () { loadRefboard(restoreItems); }
        }
    });
})();
