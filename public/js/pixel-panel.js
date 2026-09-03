/* ========== pixel-panel.js - AI 像素显示器固定面板 ==========
 * 可拖拽面板，轮询后端 /api/pixel/display 获取 AI 发来的 pxl 数据并渲染
 * AI 通过 pixel_display 工具发送图片/动画到此面板
 * 动画默认循环播放，fps 由 PXL 头部 @fps 指定（默认4）
 * 支持拖拽标题栏移动位置，位置和最小化状态持久化到 localStorage
 */

var PixelPanel = {

    panel: null,
    canvas: null,
    ctx: null,
    timer: null,
    animTimer: null,
    lastTimestamp: 0,
    isMinimized: true,

    // 持久化存储 key
    STORAGE_KEY: 'pixelPanelState',

    // 拖拽状态
    dragState: null,

    // 从 localStorage 读取保存的状态
    loadState: function() {
        try {
            var raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return null;
    },

    // 保存状态到 localStorage
    saveState: function() {
        try {
            var state = {
                x: this.panel.offsetLeft,
                y: this.panel.offsetTop,
                isMinimized: this.isMinimized
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {}
    },

    // 初始化面板
    init: function() {
        if (this.panel) return;

        var self = this;
        var panel = document.createElement('div');
        panel.id = 'pixel-panel';
        panel.className = 'pixel-panel';
        panel.innerHTML =
            '<div class="pixel-panel-header" id="pixel-panel-header">' +
                '<span class="pixel-panel-icon">📺</span>' +
                '<span class="pixel-panel-title">AI 像素显示器</span>' +
                '<span class="pixel-panel-info" id="pixel-panel-info"></span>' +
                '<div class="pixel-panel-btns">' +
                    '<button class="pixel-panel-btn" id="pixel-panel-gif" title="导出GIF" style="display:none">📥</button>' +
                    '<button class="pixel-panel-btn" id="pixel-panel-min" title="最小化/展开">—</button>' +
                    '<button class="pixel-panel-btn" id="pixel-panel-close" title="清除">×</button>' +
                '</div>' +
            '</div>' +
            '<div class="pixel-panel-body" id="pixel-panel-body">' +
                '<canvas id="pixel-panel-canvas" width="256" height="256"></canvas>' +
                '<div class="pixel-panel-empty" id="pixel-panel-empty">等待 AI 发送图片...</div>' +
                '<div class="pixel-panel-anim-controls" id="pixel-panel-anim" style="display:none">' +
                    '<button class="pixel-panel-play" id="pixel-panel-play">⏸</button>' +
                    '<span class="pixel-panel-framelabel" id="pixel-panel-framelabel">1/1</span>' +
                '</div>' +
            '</div>';
        var canvasArea = document.getElementById('canvasArea') || document.body;
        canvasArea.appendChild(panel);

        this.panel = panel;
        this.canvas = document.getElementById('pixel-panel-canvas');
        this.ctx = this.canvas.getContext('2d');

        // 按钮事件
        document.getElementById('pixel-panel-min').addEventListener('click', function(e) {
            e.stopPropagation();
            self.toggleMinimize();
        });
        document.getElementById('pixel-panel-close').addEventListener('click', function(e) {
            e.stopPropagation();
            self.clearDisplay();
        });
        document.getElementById('pixel-panel-gif').addEventListener('click', function(e) {
            e.stopPropagation();
            self.exportGif();
        });

        // 拖拽功能
        this.initDrag();

        // 恢复持久化状态
        var saved = this.loadState();
        if (saved) {
            // 恢复位置
            if (typeof saved.x === 'number' && typeof saved.y === 'number') {
                var maxX = window.innerWidth - 60;
                var maxY = window.innerHeight - 30;
                panel.style.left = Math.max(0, Math.min(saved.x, maxX)) + 'px';
                panel.style.top = Math.max(0, Math.min(saved.y, maxY)) + 'px';
            }
            // 恢复最小化状态
            this.isMinimized = saved.isMinimized !== false;
        }

        // 应用最小化状态到 DOM
        if (this.isMinimized) {
            var body0 = document.getElementById('pixel-panel-body');
            var minBtn0 = document.getElementById('pixel-panel-min');
            if (body0) body0.style.display = 'none';
            if (minBtn0) minBtn0.textContent = '□';
            this.panel.classList.add('minimized');
        }
        
        this.startPolling();

        console.log('[PixelPanel] 初始化完成，拖拽标题可移动位置');
    },

    // 初始化拖拽
    initDrag: function() {
        var self = this;
        var header = document.getElementById('pixel-panel-header');

        header.addEventListener('mousedown', function(e) {
            // 点击按钮时不触发拖拽
            if (e.target.classList.contains('pixel-panel-btn') || 
                e.target.closest('.pixel-panel-btns')) return;

            self.dragState = {
                startX: e.clientX,
                startY: e.clientY,
                origX: self.panel.offsetLeft,
                origY: self.panel.offsetTop,
                moved: false
            };
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
            if (!self.dragState) return;
            var dx = e.clientX - self.dragState.startX;
            var dy = e.clientY - self.dragState.startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                self.dragState.moved = true;
            }
            var newX = self.dragState.origX + dx;
            var newY = self.dragState.origY + dy;
            // 边界限制：至少露出标题栏
            var maxX = window.innerWidth - 60;
            var maxY = window.innerHeight - 30;
            newX = Math.max(-self.panel.offsetWidth + 60, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            self.panel.style.left = newX + 'px';
            self.panel.style.top = newY + 'px';
        });

        document.addEventListener('mouseup', function(e) {
            if (!self.dragState) return;
            self.dragState = null;
            header.style.cursor = 'grab';
            // 拖拽结束时保存位置
            self.saveState();
        });
    },

    // 开始轮询后端
    startPolling: function() {
        var self = this;
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(function() {
            self.poll();
        }, 800);
        this.poll();
    },

    // 轮询
    poll: function() {
        var self = this;
        try {
            fetch('/api/pixel/display')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.ok && data.has_data && data.timestamp !== self.lastTimestamp) {
                        self.lastTimestamp = data.timestamp;
                        self.render(data.data, data.title);
                    }
                })
                .catch(function(e) {
                    // 静默失败
                });
        } catch (e) {}
    },

    // 渲染 pxl 数据
    render: function(pxlData, title) {
        var parsed = PixelDisplay.parse(pxlData);
        if (!parsed) {
            console.warn('[PixelPanel] 无法解析 pxl 数据:', pxlData.substring(0, 50));
            return;
        }

        // 停止之前的动画
        if (this.animTimer) {
            clearInterval(this.animTimer);
            this.animTimer = null;
        }

        var palette = PixelDisplay.palettes[parsed.mode] || PixelDisplay.palettes.B;
        var self = this;

        // 自适应：原生分辨率渲染 + CSS缩放
        var bodyEl = document.getElementById("pixel-panel-body");
        var availW = bodyEl ? bodyEl.clientWidth - 16 : 244;
        if (availW < 100) availW = 244;
        var availH = Math.max(availW, 260);
        var scale = Math.min(availW / parsed.width, availH / parsed.height);
        var canvasW = parsed.width;
        var canvasH = parsed.height;
        var displayW = Math.floor(parsed.width * scale);
        var displayH = Math.floor(parsed.height * scale);

        this.canvas.width = canvasW;
        this.canvas.height = canvasH;
        this.canvas.style.width = displayW + 'px';
        this.canvas.style.height = displayH + 'px';

        var ctx = this.ctx;

        function drawFrame(frameIdx) {
            var pixels = parsed.frames[frameIdx];
            ctx.clearRect(0, 0, canvasW, canvasH);
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvasW, canvasH);
            for (var y = 0; y < parsed.height; y++) {
                for (var x = 0; x < parsed.width; x++) {
                    var idx = y * parsed.width + x;
                    var colorIdx = pixels[idx] || 0;
                    if (colorIdx === -1) continue;  // 透明，跳过
                    ctx.fillStyle = palette[colorIdx] || palette[0];
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // 显示信息
        var infoEl = document.getElementById('pixel-panel-info');
        if (infoEl) {
            infoEl.textContent = parsed.width + '×' + parsed.height +
                (parsed.frameCount > 1 ? ' · ' + parsed.frameCount + '帧@' + (parsed.fps || 4) + 'fps' : '');
        }

        var emptyEl = document.getElementById('pixel-panel-empty');
        if (emptyEl) emptyEl.style.display = 'none';

        this.canvas.style.display = 'block';

        var gifBtn = document.getElementById('pixel-panel-gif');
        if (gifBtn) gifBtn.style.display = 'inline-block';

        var titleEl = this.panel.querySelector('.pixel-panel-title');
        if (titleEl && title) {
            titleEl.textContent = title;
        } else if (titleEl) {
            titleEl.textContent = 'AI 像素显示器';
        }

        if (parsed.frameCount === 1) {
            // 静态图片
            drawFrame(0);
            var animEl = document.getElementById('pixel-panel-anim');
            if (animEl) animEl.style.display = 'none';
        } else {
            // 动画 - 循环播放
            var currentFrame = 0;
            drawFrame(0);

            var animEl = document.getElementById('pixel-panel-anim');
            if (animEl) animEl.style.display = 'flex';

            var frameLabel = document.getElementById('pixel-panel-framelabel');
            var playBtn = document.getElementById('pixel-panel-play');
            var isPlaying = true;
            var fps = parsed.fps || 4; // 从 PXL 头部读取 fps

            function play() {
                if (self.animTimer) clearInterval(self.animTimer);
                self.animTimer = setInterval(function() {
                    currentFrame = (currentFrame + 1) % parsed.frameCount;
                    drawFrame(currentFrame);
                    if (frameLabel) frameLabel.textContent = (currentFrame + 1) + '/' + parsed.frameCount;
                }, 1000 / fps);
            }

            if (playBtn) {
                playBtn.onclick = function() {
                    isPlaying = !isPlaying;
                    playBtn.textContent = isPlaying ? '⏸' : '▶';
                    if (isPlaying) play(); else { if (self.animTimer) clearInterval(self.animTimer); }
                };
            }

            play();
        }
    },

    // 最小化/展开
    toggleMinimize: function() {
        this.isMinimized = !this.isMinimized;
        var body = document.getElementById('pixel-panel-body');
        var minBtn = document.getElementById('pixel-panel-min');
        if (this.isMinimized) {
            body.style.display = 'none';
            if (minBtn) minBtn.textContent = '□';
            this.panel.classList.add('minimized');
        } else {
            body.style.display = 'block';
            if (minBtn) minBtn.textContent = '—';
            this.panel.classList.remove('minimized');
        }
        // 持久化最小化状态
        this.saveState();
    },

    // 清除显示
    clearDisplay: function() {
        if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null; }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.style.display = 'none';
        var emptyEl = document.getElementById('pixel-panel-empty');
        if (emptyEl) emptyEl.style.display = 'block';
        var animEl = document.getElementById('pixel-panel-anim');
        if (animEl) animEl.style.display = 'none';
        var infoEl = document.getElementById('pixel-panel-info');
        if (infoEl) infoEl.textContent = '';
        var gifBtn = document.getElementById('pixel-panel-gif');
        if (gifBtn) gifBtn.style.display = 'none';
        var titleEl = this.panel.querySelector('.pixel-panel-title');
        if (titleEl) titleEl.textContent = 'AI 像素显示器';
        this.lastTimestamp = 0;

        // 通知后端清除
        try {
            fetch('/api/pixel/display', { method: 'DELETE' });
        } catch (e) {}
    },

    // 导出GIF
    exportGif: function() {
        var gifBtn = document.getElementById('pixel-panel-gif');
        if (gifBtn) {
            gifBtn.textContent = '⏳';
            gifBtn.disabled = true;
        }
        fetch('/api/pixel/export_gif')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.ok) {
                    // 自动下载
                    var a = document.createElement('a');
                    a.href = data.url;
                    a.download = 'pixel_animation.gif';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    // 显示成功提示
                    var infoEl = document.getElementById('pixel-panel-info');
                    if (infoEl) {
                        var oldText = infoEl.textContent;
                        infoEl.textContent = 'GIF已导出 ' + data.frames + '帧 ' + data.size;
                        setTimeout(function() { infoEl.textContent = oldText; }, 3000);
                    }
                } else {
                    alert('导出失败: ' + (data.error || '未知错误'));
                }
            })
            .catch(function(e) {
                alert('导出失败: ' + e.message);
            })
            .finally(function() {
                if (gifBtn) {
                    gifBtn.textContent = '📥';
                    gifBtn.disabled = false;
                }
            });
    }
};
