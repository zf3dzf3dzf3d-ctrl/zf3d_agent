// -*- coding: utf-8 -*-
// 【办公文档预览工具】独立前端模块 tools/office-viewer/office-viewer.js
// PPTX 内置预览弹窗（高保真渲染 → 大纲降级）。不依赖主程序 app-filetree，
// 仅要求页面已有 window.Toast（可选）。
// 用法：OfficeViewer.open(path, name, esq)  esq 为 HTML 转义函数（可传 null，用内置）。
// 后续 Word/Excel 等预览也放本模块，统一由 window.OfficeViewer 提供。

(function () {
    'use strict';

    function _esq(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ===== PPTX 高保真预览入口 =====
    function openPptxPreview(path, name, esqFn) {
        var esq = esqFn || _esq;
        // 遮罩 + 弹窗骨架
        var old = document.getElementById('ftPptxMask');
        if (old) old.remove();
        var mask = document.createElement('div');
        mask.id = 'ftPptxMask';
        mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
        var box = document.createElement('div');
        box.style.cssText = 'background:#1e1e1e;color:#d4d4d4;border-radius:10px;width:min(1120px,96vw);height:min(820px,92vh);display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.5);overflow:hidden;';
        var head = document.createElement('div');
        head.style.cssText = 'padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;background:#252526;';
        head.innerHTML = '<span style="font-size:14px;font-weight:bold;">📽 ' + esq(name) + '<span id="pptxPageInfo" style="font-weight:normal;color:#999;margin-left:10px;font-size:12px;"></span></span>' +
            '<span><button id="pptxSysOpen" style="margin-right:8px;padding:3px 10px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">用系统程序打开</button>' +
            '<button id="pptxClose" style="padding:3px 10px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:12px;">✕ 关闭</button></span>';
        // 幻灯片区
        var stage = document.createElement('div');
        stage.style.cssText = 'flex:1;overflow:auto;padding:16px;background:#111;';
        box.appendChild(head); box.appendChild(stage);
        mask.appendChild(box);
        document.body.appendChild(mask);
        document.getElementById('pptxClose').onclick = function () { mask.remove(); };
        document.getElementById('pptxSysOpen').onclick = function () {
            fetch('/api/fs/open?path=' + encodeURIComponent(path));
        };
        var loading = document.createElement('div');
        loading.style.cssText = 'text-align:center;color:#888;padding:40px;font-size:14px;';
        loading.textContent = '⏳ 正在加载幻灯片…';
        stage.appendChild(loading);

        function destroy() {
            try { if (mask.__previewer && mask.__previewer.destroy) mask.__previewer.destroy(); } catch (e) {}
            mask.__previewer = null;
        }
        var mo = new MutationObserver(function () {
            if (!document.getElementById('ftPptxMask')) { destroy(); mo.disconnect(); }
        });
        mo.observe(document.body, { childList: true });

        // 方案一：pptx-preview 高保真渲染（DOM 还原幻灯片，无需 Office）
        if (window.pptxPreview && window.pptxPreview.init) {
            fetch('/api/fs/file?path=' + encodeURIComponent(path))
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                .then(function (buf) {
                    if (!document.getElementById('ftPptxMask')) return;
                    loading.remove();
                    var previewer = window.pptxPreview.init(stage, {
                        width: Math.min(960, stage.clientWidth - 40 || 960),
                        height: 540,
                        mode: 'list'
                    });
                    mask.__previewer = previewer;
                    return Promise.resolve(previewer.preview(buf)).then(function () {
                        var info = document.getElementById('pptxPageInfo');
                        if (info) info.textContent = '共 ' + previewer.slideCount + ' 页';
                    });
                })
                .catch(function (err1) {
                    console.warn('[PptxPreview] 高保真渲染失败，降级大纲预览:', err1);
                    destroy();
                    openPptxOutlinePreview(path, name, esq);
                });
            return;
        }
        // 库未加载：直接降级
        openPptxOutlinePreview(path, name, esq);
    }

    // ===== PPTX 大纲降级预览 =====
    function openPptxOutlinePreview(path, name, esqFn) {
        var esq = esqFn || _esq;
        fetch('/api/fs/pptx?path=' + encodeURIComponent(path))
            .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }); })
            .then(function (d) {
                if (!d || d.ok !== true) {
                    // 降级：尝试系统程序打开
                    if (window.Toast && window.Toast.show) window.Toast.show('内置预览失败，尝试系统程序打开…', 'info');
                    fetch('/api/fs/open?path=' + encodeURIComponent(path));
                    return;
                }
                var mask = document.getElementById('ftPptxMask');
                if (!mask) return; // 上层弹窗已被关闭
                var box = mask.querySelector('div');
                box.style.width = 'min(1060px,94vw)'; box.style.height = 'min(800px,90vh)';
                // 重置头部标题
                var head = box.firstChild;
                head.innerHTML = '<span style="font-size:14px;font-weight:bold;">📽 ' + esq(name) + '（' + d.count + ' 页 · 简版预览）</span>' +
                    '<span><button id="pptxSysOpen2" style="margin-right:8px;padding:3px 10px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">用系统程序打开</button>' +
                    '<button id="pptxClose2" style="padding:3px 10px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:12px;">✕ 关闭</button></span>';
                // 重置舞台：左列表 + 右视图
                var stage = box.lastChild;
                stage.innerHTML = '';
                stage.style.display = 'flex'; stage.style.padding = '0'; stage.style.overflow = 'hidden';
                var nav = document.createElement('div');
                nav.style.cssText = 'width:230px;overflow:auto;background:#181818;border-right:1px solid #2a2a2a;padding:6px;';
                var view = document.createElement('div');
                view.style.cssText = 'flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px;';
                stage.appendChild(nav); stage.appendChild(view);

                function showSlide(i) {
                    var sl = d.slides[i];
                    if (!sl) return;
                    var items = '';
                    sl.lines.forEach(function (line) {
                        var isTitle = items === '';
                        items += '<div style="' + (isTitle
                            ? 'font-size:22px;font-weight:bold;color:#fff;margin-bottom:14px;'
                            : 'font-size:15px;color:#ccc;margin:6px 0 6px 18px;') + '">' + esq(line) + '</div>';
                    });
                    if (!sl.lines.length) items = '<div style="color:#666;">（空白页）</div>';
                    var imgHtml = sl.hasImage
                        ? '<div style="margin-top:14px;text-align:center;"><img src="/api/fs/pptx?path=' + encodeURIComponent(path) + '&slide=' + sl.no + '" style="max-width:100%;max-height:340px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.4);" onerror="this.style.display=\'none\'" /></div>'
                        : '';
                    view.innerHTML = '<div style="background:#fff;color:#222;border-radius:8px;width:100%;max-width:860px;min-height:60%;padding:34px 40px;box-shadow:0 6px 24px rgba(0,0,0,.45);">' +
                        items + imgHtml + '</div>';
                    nav.querySelectorAll('.pptx-nav-item').forEach(function (el, j) {
                        el.style.background = j === i ? '#0e639c' : 'transparent';
                        el.style.color = j === i ? '#fff' : '#bbb';
                    });
                }
                d.slides.forEach(function (sl, i) {
                    var it = document.createElement('div');
                    it.className = 'pptx-nav-item';
                    it.style.cssText = 'padding:8px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid #2a2a2a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                    it.textContent = (i + 1) + '. ' + ((sl.lines && sl.lines[0]) || '第 ' + sl.no + ' 页');
                    it.title = it.textContent;
                    it.onclick = function () { showSlide(i); };
                    nav.appendChild(it);
                });
                document.getElementById('pptxClose2').onclick = function () { mask.remove(); };
                document.getElementById('pptxSysOpen2').onclick = function () {
                    fetch('/api/fs/open?path=' + encodeURIComponent(path));
                };
                if (d.slides.length) showSlide(0);
            })
            .catch(function (err) {
                if (window.Toast && window.Toast.show) window.Toast.show('PPTX 预览失败: ' + err.message, 'error');
            });
    }

    // 对外 API：后续 word/excel 预览也加到这里
    window.OfficeViewer = {
        open: function (path, name, esq) {
            var ext = String(name).toLowerCase().split('.').pop();
            if (ext === 'pptx') { openPptxPreview(path, name, esq); return true; }
            return false; // 不支持的类型
        },
        openPptx: openPptxPreview,
        openPptxOutline: openPptxOutlinePreview
    };
})();
