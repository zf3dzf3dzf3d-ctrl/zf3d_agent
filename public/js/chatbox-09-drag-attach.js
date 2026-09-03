// ========== chatbox-09-drag-attach.js - 拖拽文件进对话 = 附件（不覆盖对话框） ==========
// 拖图片/视频/任意文件到对话框（或页面任意处）时：
//   1. 阻止浏览器默认行为（用播放器打开文件盖住整个界面）
//   2. 图片 → 进入对话输入框上方的识图暂存条（随消息发送给模型）
//   3. 其他文件 → 走上传流程，生成 📎 文件附件卡片并插入消息引用
// 画布区域（#canvasArea）不拦截：那里有自己的"拖入建图片节点"逻辑。
(function () {
    'use strict';

    function hasFiles(e) {
        try {
            return e.dataTransfer && e.dataTransfer.types &&
                Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
        } catch (err) { return false; }
    }

    function inCanvas(t) {
        return !!(t && t.closest && t.closest('#canvasArea, #canvasContent, .kite-canvas'));
    }

    function findChatForBox(box) {
        try {
            if (typeof Store !== 'undefined' && Store.data && Store.data.chatBoxes && box) {
                var boxId = box.id || '';
                var found = null;
                Store.data.chatBoxes.forEach(function (c) {
                    if (!found && ((c.el && c.el === box) || (c.id && boxId && c.id === boxId))) found = c;
                });
                return found;
            }
        } catch (e) {}
        return null;
    }

    function toast(msg) {
        try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
        try { console.log('[DragAttach]', msg); } catch (e2) {}
    }

    // ---------- 拖拽悬停高亮动画 ----------
    (function injectStyle() {
        if (document.getElementById('drag-attach-style')) return;
        var st = document.createElement('style');
        st.id = 'drag-attach-style';
        st.textContent = [
            '.chatbox.drag-over { position: relative; }',
            '.chatbox.drag-over::after {',
            '    content: "";',
            '    position: absolute;',
            '    inset: 0;',
            '    border-radius: inherit;',
            '    pointer-events: none;',
            '    z-index: 9999;',
            '    border: 2px dashed #4a9eff;',
            '    background: rgba(74, 158, 255, 0.08);',
            '    animation: dragOverPulse 1.2s ease-in-out infinite;',
            '    box-shadow: 0 0 12px rgba(74, 158, 255, 0.35), inset 0 0 20px rgba(74, 158, 255, 0.12);',
            '}',
            '@keyframes dragOverPulse {',
            '    0%, 100% { opacity: 1; box-shadow: 0 0 12px rgba(74,158,255,.35), inset 0 0 20px rgba(74,158,255,.12); }',
            '    50%      { opacity: .75; box-shadow: 0 0 22px rgba(74,158,255,.6), inset 0 0 32px rgba(74,158,255,.22); }',
            '}'
        ].join('\n');
        document.head.appendChild(st);
    })();

    function clearHighlight() {
        document.querySelectorAll('.chatbox.drag-over').forEach(function (b) {
            b.classList.remove('drag-over');
        });
    }

    // ---------- dragover：全局拦截，防止浏览器用播放器打开文件盖住界面 ----------
    document.addEventListener('dragover', function (e) {
        if (!hasFiles(e)) return;               // 应用内媒体拖拽（x-zfmedia）不受影响
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';

        // 落点对话框高亮（画布区域不高亮）
        clearHighlight();
        if (inCanvas(e.target)) return;
        var box = (e.target && e.target.closest) ? e.target.closest('.chatbox') : null;
        if (box) box.classList.add('drag-over');
    }, true);

    document.addEventListener('dragleave', function (e) {
        // 仅当离开到文档外或进入非该对话框区域时清理
        if (e.relatedTarget === null) clearHighlight();
        var box = (e.target && e.target.closest) ? e.target.closest('.chatbox') : null;
        if (box && (!e.relatedTarget || !box.contains(e.relatedTarget))) box.classList.remove('drag-over');
    }, true);

    window.addEventListener('dragend', clearHighlight);
    window.addEventListener('blur', clearHighlight);

    // ---------- drop：转为对话附件 ----------
    document.addEventListener('drop', function (e) {
        if (!hasFiles(e)) return;               // 非文件拖拽交给原有逻辑
        if (inCanvas(e.target)) return;         // 画布区域维持原行为（拖入生成图片节点）

        var files = e.dataTransfer.files;
        if (!files || !files.length) { e.preventDefault(); return; }

        // 找目标对话：落点所在对话框 → 否则当前激活的对话框
        var box = (e.target && e.target.closest) ? e.target.closest('.chatbox') : null;
        if (!box) {
            try { box = document.querySelector('.chatbox.active') || document.querySelector('.chatbox'); } catch (err) {}
        }
        e.preventDefault();
        e.stopPropagation();
        clearHighlight();

        if (!box) { toast('⚠️ 未找到对话框，无法附加文件'); return; }

        // 分类：图片 → 识图暂存；其他 → 普通上传附件
        var imgFiles = [], otherFiles = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (/^image\//.test(f.type || '') || /\.(png|jpe?g|webp|gif)$/i.test(f.name || '')) imgFiles.push(f);
            else otherFiles.push(f);
        }

        var chat = findChatForBox(box);
        var parts = [];
        if (imgFiles.length && typeof App !== 'undefined' && App._addPendingImages) {
            App._addPendingImages(box, imgFiles);
            parts.push(imgFiles.length + ' 张图片');
        }
        if (otherFiles.length && chat && typeof App !== 'undefined' && App._handleUpload) {
            App._handleUpload(box, chat, otherFiles, false);
            parts.push(otherFiles.length + ' 个文件');
        } else if (otherFiles.length) {
            toast('⚠️ 未找到对应对话，文件未上传（图片仍可附加）');
        }

        if (parts.length) {
            try {
                var ta = box.querySelector('textarea');
                if (ta) ta.focus();
            } catch (err) {}
            toast('📎 已添加到对话附件：' + parts.join('、'));
        }
    }, true);
})();
