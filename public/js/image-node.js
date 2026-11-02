/**
 * image-node.js
 * 画布上独立的"图片节点"组件
 *  - 拖拽（顶部手柄）
 *  - 8 向缩放
 *  - 工具栏：下载 / 重新生成 / 关闭
 *  - 点击图片放大预览
 *  - 位置变化时通知 CurveManager 重绘连线
 *  - 全部在 #canvasContent 坐标系下，使用绝对定位（px）
 */
(function (global) {
    'use strict';

    var counter = 0;
    var allNodes = {}; // id -> instance

    function getCanvasContent() {
        return document.getElementById('canvasContent');
    }

    function ImageNode(options) {
        // options: { url, prompt, x, y, width, height, chatboxId, messageId, onRegenerate, onClose }
        this.id = 'img_' + (++counter) + '_' + Date.now();
        this.url = options.url || '';
        this.prompt = options.prompt || '';
        this.x = options.x || 0;
        this.y = options.y || 0;
        this.width = options.width || 320;
        this.height = options.height || 320;
        this.chatboxId = options.chatboxId || null;
        this.messageId = options.messageId || null;
        this.onRegenerate = options.onRegenerate || function () {};
        this.onClose = options.onClose || function () {};
        this._dragging = null;
        this._resizing = null;
        this._build();
        allNodes[this.id] = this;
    }

    ImageNode.prototype._build = function () {
        var self = this;
        var el = document.createElement('div');
        el.className = 'image-node';
        el.id = this.id;
        el.style.left = this.x + 'px';
        el.style.top = this.y + 'px';
        el.style.width = this.width + 'px';
        el.style.height = this.height + 'px';

        var shortPrompt = (this.prompt || '').length > 60
            ? (this.prompt.substring(0, 60) + '…')
            : (this.prompt || '(无提示词)');

        el.innerHTML =
            '<div class="img-handle" data-role="drag">' +
                '<span class="img-title">🖼️ AI 生图</span>' +
                '<span class="img-actions">' +
                    '<button data-act="regen" title="用相同 prompt 重新生成">↻</button>' +
                    '<button data-act="download" title="下载图片">⤓</button>' +
                    '<button data-act="close" title="关闭">✕</button>' +
                '</span>' +
            '</div>' +
            '<div class="img-body">' +
                (this.url
                    ? '<img src="' + this.url + '" alt="AI生成图片" data-act="zoom" />'
                    : '<div class="img-loading"><div class="cool-loader"><div class="cool-ring"></div><div class="cool-ring r2"></div><div class="cool-dot"></div></div><div class="cool-text">正在生成图片…</div></div>') +
            '</div>' +
            '<div class="img-footer" title="' + escapeAttr(this.prompt) + '">' +
                '<span class="footer-label">PROMPT</span>' + escapeHtml(shortPrompt) +
            '</div>' +
            // 8 个缩放手柄
            '<div class="resize-handle rh-nw" data-dir="nw"></div>' +
            '<div class="resize-handle rh-n"  data-dir="n"></div>' +
            '<div class="resize-handle rh-ne" data-dir="ne"></div>' +
            '<div class="resize-handle rh-e"  data-dir="e"></div>' +
            '<div class="resize-handle rh-se" data-dir="se"></div>' +
            '<div class="resize-handle rh-s"  data-dir="s"></div>' +
            '<div class="resize-handle rh-sw" data-dir="sw"></div>' +
            '<div class="resize-handle rh-w"  data-dir="w"></div>';

        this.el = el;
        getCanvasContent().appendChild(el);

        // 绑定事件
        this._bindDrag();
        this._bindResize();
        this._bindActions();
    };

    ImageNode.prototype._bindDrag = function () {
        var self = this;
        var handle = this.el.querySelector('.img-handle');
        var startX, startY, origX, origY;
        var moved = false;

        handle.addEventListener('mousedown', function (e) {
            if (e.target.closest('button')) return; // 工具栏按钮不拖
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startY = e.clientY;
            origX = self.x;
            origY = self.y;
            moved = false;
            self._dragging = { handle: handle };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        function onMove(e) {
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
            self.x = Math.max(0, origX + dx);
            self.y = Math.max(0, origY + dy);
            self.el.style.left = self.x + 'px';
            self.el.style.top = self.y + 'px';
            self.el.classList.add('dragging');
            // 通知曲线重绘
            if (global.CurveManager) global.CurveManager.updateAll();
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            self.el.classList.remove('dragging');
            self._dragging = null;
        }
    };

    ImageNode.prototype._bindResize = function () {
        var self = this;
        var handles = this.el.querySelectorAll('.resize-handle');
        handles.forEach(function (h) {
            h.addEventListener('mousedown', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var dir = h.dataset.dir;
                var startX = e.clientX, startY = e.clientY;
                var origW = self.width, origH = self.height;
                var origX = self.x, origY = self.y;

                self._resizing = { dir: dir };
                self.el.classList.add('resizing');

                function onMove(ev) {
                    var dx = ev.clientX - startX;
                    var dy = ev.clientY - startY;
                    var newW = origW, newH = origH, newX = origX, newY = origY;
                    var minW = 180, minH = 140;

                    if (dir.indexOf('e') >= 0) newW = Math.max(minW, origW + dx);
                    if (dir.indexOf('s') >= 0) newH = Math.max(minH, origH + dy);
                    if (dir.indexOf('w') >= 0) {
                        newW = Math.max(minW, origW - dx);
                        newX = origX + (origW - newW);
                    }
                    if (dir.indexOf('n') >= 0) {
                        newH = Math.max(minH, origH - dy);
                        newY = origY + (origH - newH);
                    }
                    self.x = newX; self.y = newY;
                    self.width = newW; self.height = newH;
                    self.el.style.left = newX + 'px';
                    self.el.style.top = newY + 'px';
                    self.el.style.width = newW + 'px';
                    self.el.style.height = newH + 'px';
                    if (global.CurveManager) global.CurveManager.updateAll();
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    self.el.classList.remove('resizing');
                    self._resizing = null;
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
    };

    ImageNode.prototype._bindActions = function () {
        var self = this;
        this.el.addEventListener('click', function (e) {
            var btn = e.target.closest('button');
            if (btn) {
                e.stopPropagation();
                var act = btn.dataset.act;
                if (act === 'regen') self.regenerate();
                else if (act === 'download') self.download();
                else if (act === 'close') self.close();
                return;
            }
            var img = e.target.closest('img[data-act="zoom"]');
            if (img) self.zoom(img.src);
        });

        // 双击图片 = 最大化查看（等同右上角最大化）
        this.el.addEventListener('dblclick', function (e) {
            var img = e.target.closest('img[data-act="zoom"]');
            if (img) {
                e.preventDefault();
                e.stopPropagation();
                self.zoom(img.src);
            }
        });
    };

    ImageNode.prototype.setImage = function (url) {
        this.url = url;
        var body = this.el.querySelector('.img-body');
        body.innerHTML = '<img src="' + url + '" alt="AI生成图片" data-act="zoom" />';
    };

    ImageNode.prototype.regenerate = function () {
        this.onRegenerate(this);
    };

    ImageNode.prototype.download = function () {
        if (!this.url) return;
        var a = document.createElement('a');
        a.href = this.url;
        a.target = '_blank';
        a.download = 'ai-image-' + this.id + '.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 100);
    };

    ImageNode.prototype.zoom = function (src) {
        var mask = document.createElement('div');
        mask.className = 'image-viewer';
        mask.innerHTML =
            '<div class="iv-stage"><img src="' + src + '" alt="放大预览" draggable="false" /></div>' +
            '<button class="iv-btn iv-close" title="关闭 (Esc)">✕</button>' +
            '<button class="iv-btn iv-reset" title="重置视图 (R)">⟲</button>' +
            '<div class="iv-tip">滚轮缩放 · 拖拽平移 · 双击图片关闭 · Esc 退出</div>';
        document.body.appendChild(mask);

        var stage = mask.querySelector('.iv-stage');
        var img = mask.querySelector('img');
        var state = { x: 0, y: 0, scale: 1 };

        function apply() {
            img.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')';
        }
        function reset() {
            state.x = 0; state.y = 0; state.scale = 1;
            apply();
        }
        function close() {
            document.removeEventListener('keydown', onKey);
            mask.remove();
        }

        // 滚轮缩放（以鼠标位置为锚点）
        mask.addEventListener('wheel', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var rect = stage.getBoundingClientRect();
            var cx = e.clientX - rect.left - rect.width / 2;
            var cy = e.clientY - rect.top - rect.height / 2;
            var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            var ns = Math.min(20, Math.max(0.05, state.scale * factor));
            // 保持锚点视觉位置不变: img 坐标 = (mouse - translate)/scale
            var k = ns / state.scale;
            state.x = cx - (cx - state.x) * k;
            state.y = cy - (cy - state.y) * k;
            state.scale = ns;
            apply();
        }, { passive: false });

        // 拖拽平移
        var drag = null;
        stage.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            drag = { sx: e.clientX, sy: e.clientY, ox: state.x, oy: state.y };
        });
        document.addEventListener('mousemove', function (e) {
            if (!drag) return;
            state.x = drag.ox + (e.clientX - drag.sx);
            state.y = drag.oy + (e.clientY - drag.sy);
            apply();
        });
        document.addEventListener('mouseup', function () { drag = null; });

        // 按钮
        mask.querySelector('.iv-close').addEventListener('click', close);
        mask.querySelector('.iv-reset').addEventListener('click', function () { reset(); });

        // 双击图片关闭；双击空白重置
        img.addEventListener('dblclick', function (e) { e.stopPropagation(); close(); });
        stage.addEventListener('dblclick', function () { reset(); });

        function onKey(e) {
            if (e.key === 'Escape') close();
            else if (e.key === 'r' || e.key === 'R') reset();
        }
        document.addEventListener('keydown', onKey);
    };

    ImageNode.prototype.close = function () {
        // 先通知曲线断开
        if (global.CurveManager) global.CurveManager.disconnectByNode(this.id);
        this.el.remove();
        delete allNodes[this.id];
        this.onClose(this);
    };

    /**
     * 拿到图片框在 canvasContent 坐标系下的中心点（用于画曲线端点）
     */
    ImageNode.prototype.getCenter = function () {
        return { x: this.x + this.width / 2, y: this.y + this.height / 2 };
    };
    ImageNode.prototype.getRect = function () {
        return { x: this.x, y: this.y, w: this.width, h: this.height };
    };

    // ============ 静态方法 ============
    ImageNode.getById = function (id) { return allNodes[id]; };
    ImageNode.getAll = function () { return Object.values(allNodes); };
    ImageNode.create = function (options) {
        return new ImageNode(options);
    };

    // 工具
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function escapeAttr(s) {
        return escapeHtml(s);
    }

    global.ImageNode = ImageNode;
})(window);
