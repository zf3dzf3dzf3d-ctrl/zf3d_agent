/* ========== pixel-display.js - AI 像素图显示器 ==========
 * 协议：AI 在 Markdown 中输出 ```pxl 代码块，前端自动渲染为 Canvas 图片
 * 格式：WxHB:RLE  静态图
 *       WxHB F帧数[@fps]:RLE1|RLE2|...  动画(循环播放)
 * fps默认4，@8表示8帧/秒。省略@则4fps。
 */

var PixelDisplay = {

    // 标准调色板
    palettes: {
        B: ['#000000', '#ffffff'],           // 二值：黑、白
        C16: [                                // PICO-8 经典16色
            '#000000','#1d2b53','#7e2553','#008751',
            '#ab5234','#5f574f','#c2c3c7','#fff1e8',
            '#ff004d','#ffa300','#ffec27','#00e436',
            '#29adff','#8338ec','#ff77a8','#ffccaa'
        ],
        C32: [                                // 扩展32色 (PICO-8 16色 + 16扩展色)
            '#000000','#1d2b53','#7e2553','#008751',
            '#ab5234','#5f574f','#c2c3c7','#fff1e8',
            '#ff004d','#ffa300','#ffec27','#00e436',
            '#29adff','#8338ec','#ff77a8','#ffccaa',
            '#291814','#111d35','#422136','#125359',
            '#742f29','#49333b','#a28879','#f3ef7d',
            '#be1250','#ff6c24','#a8e72e','#00b543',
            '#065ab5','#754665','#ff6e59','#ff9d81'
        ]
    },

    // ===== 解析 pxl 编码字符串 =====
    parse: function(data) {
        data = (data || '').trim();
        if (!data) return null;

        var colonIdx = data.indexOf(':');
        if (colonIdx < 0) return null;

        var header = data.substring(0, colonIdx).trim();
        var body = data.substring(colonIdx + 1).trim();

        // 解析头部：16x16B 或 16x16B F2 或 16x16B F4@8
        var headerParts = header.split(/\s+/);
        var sizeMode = headerParts[0]; // 16x16B
        var frameInfo = headerParts[1] || ''; // F2 或 F4@8

        var m = sizeMode.match(/^(\d+)x(\d+)(B|C\d+)$/i);
        if (!m) return null;

        var width = parseInt(m[1], 10);
        var height = parseInt(m[2], 10);
        var mode = m[3].toUpperCase();

        // 解析帧数和fps
        var frameCount = 1;
        var fps = 4; // 默认4fps
        if (frameInfo) {
            // F2 或 F4@8
            var fm = frameInfo.match(/^F(\d+)(?:@(\d+))?$/i);
            if (fm) {
                frameCount = parseInt(fm[1], 10);
                if (fm[2]) fps = parseInt(fm[2], 10);
            }
        }

        // 分割帧数据
        var frameStrs = body.split('|');
        var frames = [];

        for (var fi = 0; fi < frameStrs.length && fi < frameCount; fi++) {
            var rleStr = frameStrs[fi].trim();
            var pixels = this._decodeRLE(rleStr, width * height, mode);
            if (pixels) {
                frames.push(pixels);
            }
        }

        if (frames.length === 0) return null;

        return {
            width: width,
            height: height,
            mode: mode,
            frames: frames,
            frameCount: frames.length,
            fps: fps
        };
    },

    // ===== RLE 解码 =====
    _decodeRLE: function(rleStr, totalPixels, mode) {
        var pixels = [];
        if (mode === 'B') {
            // B模式：交替计数（0,1,0,1...）
            var nums = rleStr.split(',');
            var currentColor = 0;
            for (var i = 0; i < nums.length; i++) {
                var count = parseInt(nums[i].trim(), 10);
                if (isNaN(count) || count <= 0) continue;
                for (var j = 0; j < count; j++) {
                    pixels.push(currentColor);
                }
                currentColor = 1 - currentColor;
            }
        } else {
            // C16模式：token = 颜色.数量 或 颜色(默认1), X=透明
            var tokens = rleStr.split(',');
            var palLen = (this.palettes[mode] || this.palettes.B).length;
            for (var i = 0; i < tokens.length; i++) {
                var tok = tokens[i].trim();
                if (!tok) continue;
                // 透明色
                if (tok.charAt(0).toUpperCase() === 'X') {
                    var xcnt = 1;
                    if (tok.indexOf('.') >= 0) {
                        var xparts = tok.split('.');
                        xcnt = (xparts.length > 1 && xparts[1]) ? parseInt(xparts[1], 10) : 1;
                    }
                    if (isNaN(xcnt)) xcnt = 1;
                    for (var j = 0; j < xcnt; j++) {
                        pixels.push(-1);  // -1 = 透明
                    }
                    continue;
                }
                var ci, cnt;
                if (tok.indexOf('.') >= 0) {
                    var parts = tok.split('.');
                    ci = parseInt(parts[0], 10);
                    cnt = (parts.length > 1 && parts[1]) ? parseInt(parts[1], 10) : 1;
                } else {
                    ci = parseInt(tok, 10);
                    cnt = 1;
                }
                if (isNaN(ci)) ci = 0;
                if (isNaN(cnt)) cnt = 1;
                ci = Math.max(0, Math.min(ci, palLen - 1));
                for (var j = 0; j < cnt; j++) {
                    pixels.push(ci);
                }
            }
        }
        while (pixels.length < totalPixels) pixels.push(0);
        if (pixels.length > totalPixels) pixels = pixels.slice(0, totalPixels);
        return pixels;
    },

    // ===== 渲染到 Canvas 元素 =====
    render: function(container, parsed) {
        if (!parsed || !parsed.frames || parsed.frames.length === 0) return;

        var self = this;
        var palette = this.palettes[parsed.mode] || this.palettes.B;

        // 自适应：原生分辨率渲染 + CSS缩放
        var maxDisplay = 400;
        var scale = Math.min(maxDisplay / parsed.width, maxDisplay / parsed.height);
        var canvasW = parsed.width;
        var canvasH = parsed.height;
        var displayW = Math.floor(parsed.width * scale);
        var displayH = Math.floor(parsed.height * scale);

        var canvas = document.createElement('canvas');
        canvas.className = 'pixel-display-canvas';
        canvas.width = canvasW;
        canvas.height = canvasH;
        canvas.style.width = displayW + 'px';
        canvas.style.height = displayH + 'px';
        canvas.style.imageRendering = 'pixelated';

        var ctx = canvas.getContext('2d');

        function drawFrame(frameIdx) {
            var pixels = parsed.frames[frameIdx];
            ctx.clearRect(0, 0, canvasW, canvasH);
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

        if (parsed.frameCount === 1) {
            drawFrame(0);
        } else {
            var currentFrame = 0;
            drawFrame(0);

            var controls = document.createElement('div');
            controls.className = 'pixel-display-controls';

            var playBtn = document.createElement('button');
            playBtn.className = 'pixel-display-play';
            playBtn.textContent = '⏸';
            playBtn.title = '播放/暂停';

            var frameLabel = document.createElement('span');
            frameLabel.className = 'pixel-display-framelabel';
            frameLabel.textContent = '1/' + parsed.frameCount;

            controls.appendChild(playBtn);
            controls.appendChild(frameLabel);

            var isPlaying = true;
            var timer = null;
            var fps = parsed.fps || 4;

            function play() {
                if (timer) clearInterval(timer);
                timer = setInterval(function() {
                    currentFrame = (currentFrame + 1) % parsed.frameCount;
                    drawFrame(currentFrame);
                    frameLabel.textContent = (currentFrame + 1) + '/' + parsed.frameCount;
                }, 1000 / fps);
            }

            function pause() {
                if (timer) { clearInterval(timer); timer = null; }
            }

            playBtn.addEventListener('click', function() {
                isPlaying = !isPlaying;
                playBtn.textContent = isPlaying ? '⏸' : '▶';
                if (isPlaying) play(); else pause();
            });

            var observer = new MutationObserver(function(mutations) {
                if (!document.body.contains(canvas)) {
                    pause();
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            play();
        }

        container.className = 'pixel-display-wrap';
        container.innerHTML = '';
        container.appendChild(canvas);

        var info = document.createElement('div');
        info.className = 'pixel-display-info';
        info.textContent = parsed.width + '×' + parsed.height + ' · ' + parsed.mode +
            (parsed.frameCount > 1 ? ' · ' + parsed.frameCount + '帧' + (parsed.fps ? '@' + parsed.fps + 'fps' : '') : '');
        container.appendChild(info);

        if (parsed.frameCount > 1) {
            container.appendChild(controls);
        }
    },

    // ===== 扫描容器中的 pxl 代码块并渲染 =====
    scanAndRender: function(container) {
        if (!container) return;
        var self = this;

        var pxlBlocks = container.querySelectorAll('code.language-pxl, code[class*="pxl"]');
        pxlBlocks.forEach(function(block) {
            if (block.dataset.pxlRendered) return;
            block.dataset.pxlRendered = '1';

            var rawCode = block.textContent.trim();
            var parsed = self.parse(rawCode);
            if (!parsed) return;

            var pre = block.parentElement;
            if (!pre) return;

            var wrap = document.createElement('div');
            self.render(wrap, parsed);

            pre.replaceWith(wrap);
        });
    }
};
