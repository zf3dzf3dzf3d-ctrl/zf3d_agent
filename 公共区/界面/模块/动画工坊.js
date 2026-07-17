/**
 * 动画工坊 — 一句话生成/修改SVG/HTML动画（VIP专属）
 * 新建：描述 → 调用 /api/generate-lottie → 预览 → 保存
 * 修改：导入已有动画 → 输入修改需求 → LLM改代码 → 预览 → 保存
 * 预览支持：播放/暂停、速度调节、背景切换
 * 对话框支持拖拽移动 + 边缘缩放（内容区跟随缩放）
 */
(function(){
    'use strict';

    var _bgIndex = 0;
    var _bgColors = ['#1a1a2e', '#ffffff', 'checker'];
    var _isPlaying = true;   // 外部跟踪播放状态
    var _mode = 'new';       // 'new' 或 'modify'

    async function _checkVip(callback) {
        if (!window.agentAuth || !window.agentAuth.isLoggedIn()) {
            showToast('请先登录朱峰社区账号', 'error');
            if (window.agentAuth) window.agentAuth.showLogin();
            return false;
        }
        // 后端校验（不信任前端JS变量）
        try {
            var resp = await fetch('/api/check-vip');
            var data = await resp.json();
            if (!data.已登录) {
                showToast('请先登录朱峰社区账号', 'error');
                if (window.agentAuth) window.agentAuth.showLogin();
                return false;
            }
            if (!data.is_vip && !data.is_admin) {
                var 原因 = data.原因 || '未开通VIP';
                if (原因.indexOf('过期') >= 0) {
                    _showVipDialog('续费VIP会员', '🎬 您的VIP已过期', '续费VIP后即可继续使用动画工坊');
                } else {
                    _showVipDialog('开通VIP会员', '🎬 动画工坊为VIP会员专属功能', '开通VIP后即可使用动画工坊，一句话生成SVG矢量动画');
                }
                return false;
            }
            return true;
        } catch(e) {
            showToast('校验失败: ' + e.message, 'error');
            return false;
        }
    }

    // === VIP引导弹窗 ===
    function _showVipDialog(title, desc, detail) {
        if (document.getElementById('vipGuideOverlay')) return;
        var ov = document.createElement('div');
        ov.id = 'vipGuideOverlay';
        ov.className = 'overlay';
        ov.style.cssText = 'display:flex;z-index:10001;';
        ov.innerHTML =
            '<div class="dialog-box" style="max-width:400px;width:88%;text-align:center;">' +
                '<div style="font-size:48px;margin-bottom:8px;">🎬</div>' +
                '<h3 style="margin:0 0 8px 0;">' + title + '</h3>' +
                '<p style="font-size:13px;color:var(--text2);margin:0 0 4px 0;">' + desc + '</p>' +
                '<p style="font-size:12px;color:var(--text2);margin:0 0 16px 0;">' + detail + '</p>' +
                '<div style="display:flex;gap:8px;justify-content:center;">' +
                    '<button class="dlg-btn primary" onclick="window.open(\'https://www.zf3d.com/vip.asp\', \'_blank\')" style="padding:8px 24px;">💎 立即开通/续费</button>' +
                '</div>' +
                '<button class="dlg-btn" onclick="document.getElementById(\'vipGuideOverlay\').remove()" style="margin-top:8px;">稍后再说</button>' +
            '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
    }

    async function openWorkshop() {
        if (!await _checkVip()) return;
        if (document.getElementById('lottieWorkshopOverlay')) return;
        _isPlaying = true;
        _mode = 'new';
        var ov = document.createElement('div');
        ov.id = 'lottieWorkshopOverlay';
        ov.className = 'overlay';
        ov.style.cssText = 'display:flex;z-index:10000;';
        ov.innerHTML =
            '<div class="dialog-box" id="lottieDialog" style="max-width:680px;width:90%;position:relative;display:flex;flex-direction:column;max-height:90vh;">' +
                '<div id="lottieDragHandle" style="cursor:move;margin:-20px -20px 10px -20px;padding:12px 20px;border-bottom:1px solid var(--border);user-select:none;display:flex;align-items:center;justify-content:space-between;position:relative;flex-shrink:0;">' +
                    '<div style="display:flex;align-items:center;gap:8px;">' +
                        '<h3 style="margin:0;">🎬 动画工坊</h3>' +
                        '<span id="lottieModeLabel" style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--blue);color:#fff;">新建模式</span>' +
                    '</div>' +
                    '<span style="width:1px;"></span>' +
                    '<button onclick="window.lottieWorkshop.close()" title="关闭" style="position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:50%;border:none;background:rgba(244,67,54,0.12);color:#f44336;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;">✖</button>' +
                '</div>' +
                '<div style="margin:0 0 10px 0;flex-shrink:0;">' +
                    '<div style="display:flex;gap:8px;">' +
                        '<input type="text" id="lottiePrompt" class="dialog-input" placeholder="例：播放按钮变成暂停按钮的动画" style="flex:1;" onkeydown="if(event.key===\'Enter\')window.lottieWorkshop.generate()">' +
                        '<button class="dlg-btn primary" id="lottieGenBtn" onclick="window.lottieWorkshop.generate()">✨ 生成</button>' +
                    '</div>' +
                    '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
                        '<button class="dlg-btn" style="padding:4px 10px;font-size:11px;" onclick="window.lottieWorkshop.importFile()" title="导入已有SVG/HTML动画进行修改">📂 导入修改</button>' +
                        '<button class="dlg-btn" id="lottieNewBtn" style="padding:4px 10px;font-size:11px;display:none;" onclick="window.lottieWorkshop.startNew()" title="清空当前动画，重新开始">✨ 新建</button>' +
                        '<button class="dlg-btn" id="lottieModifyBtn" style="padding:4px 10px;font-size:11px;display:none;" onclick="window.lottieWorkshop.startModify()" title="以当前动画为基础继续修改">🔄 修改</button>' +
                    '</div>' +
                    '<div style="margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text2);">' +
                        '<label style="display:flex;align-items:center;gap:4px;">尺寸:' +
                            '<input type="number" id="lottieWidth" value="300" style="width:55px;padding:2px 4px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;">' +
                            '×' +
                            '<input type="number" id="lottieHeight" value="300" style="width:55px;padding:2px 4px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;">' +
                            'px</label>' +
                        '<label style="display:flex;align-items:center;gap:4px;">时长:' +
                            '<input type="number" id="lottieDuration" value="3" min="0.5" max="60" step="0.5" style="width:50px;padding:2px 4px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;">' +
                            '秒</label>' +
                        '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="lottieLoop" checked> 循环</label>' +
                        '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;">格式:' +
                            '<select id="lottieFormat" style="padding:2px 4px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;">' +
                                '<option value="svg">SVG</option>' +
                                '<option value="html">HTML</option>' +
                            '</select>' +
                        '</label>' +
                    '</div>' +
                '</div>' +
                '<div id="lottiePreviewWrap" style="flex:1;min-height:200px;background:#1a1a2e;border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;margin:0 0 10px 0;position:relative;overflow:hidden;">' +
                    '<iframe id="lottiePreview" style="width:100%;height:100%;border:none;background:transparent;" sandbox="allow-scripts"></iframe>' +
                    '<div id="lottiePlaceholder" style="position:absolute;color:var(--text2);font-size:13px;text-align:center;pointer-events:none;">输入描述后点击生成<br>或点击「导入修改」加载已有动画</div>' +
                    '<div id="lottieLoading" style="position:absolute;display:none;color:var(--blue);font-size:13px;background:var(--bg);padding:20px;border-radius:8px;">⏳ 正在生成动画...</div>' +
                    '<button id="lottieBgBtn" onclick="window.lottieWorkshop.cycleBg()" title="切换背景颜色" style="position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:4px;border:1px solid var(--border);background:rgba(0,0,0,0.4);color:#aaa;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;">🎨</button>' +
                    '<div id="lottieControls" style="position:absolute;bottom:6px;left:6px;right:6px;display:none;gap:8px;align-items:center;background:rgba(0,0,0,0.5);padding:4px 10px;border-radius:6px;backdrop-filter:blur(4px);z-index:2;">' +
                        '<button id="lottiePlayBtn" onclick="window.lottieWorkshop.togglePlay()" title="播放/暂停" style="width:26px;height:26px;border-radius:50%;border:none;background:var(--blue);color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">⏸</button>' +
                        '<span style="font-size:11px;color:#aaa;flex-shrink:0;">速度</span>' +
                        '<input type="range" id="lottieSpeedSlider" min="0.25" max="3" step="0.25" value="1" style="flex:1;height:4px;cursor:pointer;" oninput="window.lottieWorkshop.setSpeed(this.value)">' +
                        '<span id="lottieSpeedLabel" style="font-size:11px;color:#aaa;width:30px;text-align:right;flex-shrink:0;">1.0x</span>' +
                    '</div>' +
                '</div>' +
                '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-shrink:0;">' +
                    '<div id="lottieStatus" style="font-size:12px;color:var(--text2);"></div>' +
                    '<div style="display:flex;gap:8px;">' +
                        '<button class="dlg-btn" id="lottieSaveBtn" onclick="window.lottieWorkshop.saveToFolder()" style="display:none;">💾 保存到当前文件夹</button>' +
                        '<button class="dlg-btn" id="lottieExportBtn" onclick="window.lottieWorkshop.exportHTML()" style="display:none;">⬇ 另存为</button>' +
                    '</div>' +
                '</div>' +
                '<div class="resize-handle resize-n" style="position:absolute;top:-3px;left:8px;right:8px;height:6px;cursor:n-resize;"></div>' +
                '<div class="resize-handle resize-s" style="position:absolute;bottom:-3px;left:8px;right:8px;height:6px;cursor:s-resize;"></div>' +
                '<div class="resize-handle resize-w" style="position:absolute;top:8px;bottom:8px;left:-3px;width:6px;cursor:w-resize;"></div>' +
                '<div class="resize-handle resize-e" style="position:absolute;top:8px;bottom:8px;right:-3px;width:6px;cursor:e-resize;"></div>' +
                '<div class="resize-handle resize-nw" style="position:absolute;top:-4px;left:-4px;width:10px;height:10px;cursor:nw-resize;z-index:3;"></div>' +
                '<div class="resize-handle resize-ne" style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;cursor:ne-resize;z-index:3;"></div>' +
                '<div class="resize-handle resize-sw" style="position:absolute;bottom:-4px;left:-4px;width:10px;height:10px;cursor:sw-resize;z-index:3;"></div>' +
                '<div class="resize-handle resize-se" style="position:absolute;bottom:-4px;right:-4px;width:10px;height:10px;cursor:se-resize;z-index:3;"></div>' +
            '</div>';
        document.body.appendChild(ov);
        _bgIndex = 0;
        _updateModeLabel();
        _initDragResize();
    }

    function close() {
        var ov = document.getElementById('lottieWorkshopOverlay');
        if (!ov) return;
        ov.remove();
    }

    // === 模式标签更新 ===
    function _updateModeLabel() {
        var label = document.getElementById('lottieModeLabel');
        if (!label) return;
        if (_mode === 'modify') {
            label.textContent = '修改模式';
            label.style.background = '#e67e22';
        } else {
            label.textContent = '新建模式';
            label.style.background = 'var(--blue)';
        }
    }

    // === 背景颜色切换 ===
    function cycleBg() {
        _bgIndex = (_bgIndex + 1) % _bgColors.length;
        var wrap = document.getElementById('lottiePreviewWrap');
        var c = _bgColors[_bgIndex];
        if (c === 'checker') {
            wrap.style.background = 'repeating-conic-gradient(#444 0% 25%, #666 0% 50%) 50% / 16px 16px';
        } else {
            wrap.style.background = c;
        }
        var iframe = document.getElementById('lottiePreview');
        if (iframe && iframe.contentWindow) {
            try {
                iframe.contentWindow.document.body.style.background = c === 'checker' ? 'transparent' : c;
            } catch(e) {}
        }
    }

    // === 新建：清空当前动画，重新开始 ===
    function startNew() {
        _mode = 'new';
        window._importedCode = '';
        window._lastAnimationHTML = '';
        var iframe = document.getElementById('lottiePreview');
        iframe.srcdoc = '';
        document.getElementById('lottiePlaceholder').style.display = 'block';
        document.getElementById('lottiePlaceholder').innerHTML = '输入描述后点击生成<br>或点击「导入修改」加载已有动画';
        document.getElementById('lottieExportBtn').style.display = 'none';
        document.getElementById('lottieSaveBtn').style.display = 'none';
        document.getElementById('lottieControls').style.display = 'none';
        document.getElementById('lottieNewBtn').style.display = 'none';
        document.getElementById('lottieModifyBtn').style.display = 'none';
        document.getElementById('lottieStatus').textContent = '';
        document.getElementById('lottiePrompt').value = '';
        document.getElementById('lottiePrompt').placeholder = '例：播放按钮变成暂停按钮的动画';
        _updateModeLabel();
        document.getElementById('lottiePrompt').focus();
    }

    // === 修改：以当前动画为基础继续修改 ===
    function startModify() {
        if (!window._lastAnimationHTML) return;
        _mode = 'modify';
        window._importedCode = window._lastAnimationHTML;
        document.getElementById('lottieStatus').textContent = '🔄 修改模式：输入修改需求后点生成';
        document.getElementById('lottiePrompt').value = '';
        document.getElementById('lottiePrompt').placeholder = '输入修改需求，如：颜色改成红色、加个旋转效果';
        _updateModeLabel();
        document.getElementById('lottiePrompt').focus();
    }

    // === 导入已有动画文件 ===
    function importFile() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.svg,.html,.htm';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                var content = ev.target.result;
                window._lastAnimationHTML = content;
                window._importedCode = content;
                _mode = 'modify';
                if (file.name.toLowerCase().endsWith('.svg') || content.trim().startsWith('<svg')) {
                    document.getElementById('lottieFormat').value = 'svg';
                } else {
                    document.getElementById('lottieFormat').value = 'html';
                }
                _isPlaying = true;
                var iframe = document.getElementById('lottiePreview');
                iframe.srcdoc = _wrapForPreview(content);
                document.getElementById('lottiePlaceholder').style.display = 'none';
                document.getElementById('lottieExportBtn').style.display = 'inline-block';
                document.getElementById('lottieSaveBtn').style.display = 'inline-block';
                document.getElementById('lottieControls').style.display = 'flex';
                document.getElementById('lottieNewBtn').style.display = 'inline-block';
                document.getElementById('lottieModifyBtn').style.display = 'inline-block';
                document.getElementById('lottiePlayBtn').textContent = '⏸';
                document.getElementById('lottieSpeedSlider').value = 1;
                document.getElementById('lottieSpeedLabel').textContent = '1.0x';
                document.getElementById('lottieStatus').textContent = '📂 已导入: ' + file.name;
                document.getElementById('lottiePrompt').value = '';
                document.getElementById('lottiePrompt').placeholder = '输入修改需求，如：颜色改成红色、加个旋转效果';
                _updateModeLabel();
                document.getElementById('lottiePrompt').focus();
            };
            reader.readAsText(file, 'utf-8');
        };
        input.click();
    }

    // === 播放/暂停 ===
    function togglePlay() {
        var iframe = document.getElementById('lottiePreview');
        var btn = document.getElementById('lottiePlayBtn');
        if (!iframe || !iframe.contentWindow) return;
        if (_isPlaying) {
            iframe.contentWindow.postMessage({type: 'pause'}, '*');
            btn.textContent = '▶';
            _isPlaying = false;
        } else {
            iframe.contentWindow.postMessage({type: 'play'}, '*');
            btn.textContent = '⏸';
            _isPlaying = true;
        }
    }

    // === 速度调节 ===
    function setSpeed(val) {
        var iframe = document.getElementById('lottiePreview');
        document.getElementById('lottieSpeedLabel').textContent = parseFloat(val).toFixed(1) + 'x';
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({type: 'speed', value: parseFloat(val)}, '*');
        }
    }

    // === 包装动画代码，注入播放控制脚本 ===
    // 修复：速度调节存储原始duration，避免反复除法导致速度漂移
    function _wrapForPreview(html) {
        var bg = _bgColors[_bgIndex] === 'checker' ? 'transparent' : _bgColors[_bgIndex];
        var controlScript = '<script>' +
            'window._animSpeed=1.0;' +
            // 存储每个动画元素的原始duration，只存一次
            'function _storeOriginalDur(){' +
                'document.querySelectorAll("*").forEach(function(el){' +
                    'var s=getComputedStyle(el);' +
                    'if(s.animationName&&s.animationName!=="none"){' +
                        'if(!el.dataset._origDur){el.dataset._origDur=s.animationDuration;}' +
                    '}' +
                '});' +
                'document.querySelectorAll("animate,animateTransform,animateMotion").forEach(function(a){' +
                    'if(!a.dataset._origDur){a.dataset._origDur=a.getAttribute("dur")||"1s";}' +
                '});' +
            '}' +
            'window.addEventListener("message",function(e){' +
                'var d=e.data;' +
                'if(d.type==="pause"){' +
                    'document.querySelectorAll("*").forEach(function(el){' +
                        'var s=getComputedStyle(el);' +
                        'if(s.animationName&&s.animationName!=="none"){el.style.animationPlayState="paused";}' +
                    '});' +
                    'document.querySelectorAll("animate,animateTransform,animateMotion").forEach(function(a){try{a.pause();}catch(e){}});' +
                '}' +
                'else if(d.type==="play"){' +
                    'document.querySelectorAll("*").forEach(function(el){' +
                        'var s=getComputedStyle(el);' +
                        'if(s.animationName&&s.animationName!=="none"){el.style.animationPlayState="running";}' +
                    '});' +
                    'document.querySelectorAll("animate,animateTransform,animateMotion").forEach(function(a){try{a.unpause();}catch(e){}});' +
                '}' +
                'else if(d.type==="speed"){' +
                    'window._animSpeed=d.value;' +
                    '_storeOriginalDur();' +
                    'document.querySelectorAll("*").forEach(function(el){' +
                        'var s=getComputedStyle(el);' +
                        'if(s.animationName&&s.animationName!=="none"){' +
                            'var orig=el.dataset._origDur;' +
                            'if(orig&&orig!=="0s"){' +
                                'var sec=parseFloat(orig);' +
                                'el.style.animationDuration=(sec/d.value)+"s";' +
                            '}' +
                        '}' +
                    '});' +
                    'document.querySelectorAll("animate,animateTransform,animateMotion").forEach(function(a){' +
                        'var orig=a.dataset._origDur;' +
                        'if(orig){var sec=parseFloat(orig);a.setAttribute("dur",(sec/d.value)+"s");}' +
                    '});' +
                '}' +
            '});' +
            // 页面加载后存储原始duration
            'setTimeout(_storeOriginalDur,100);' +
            '<\/script>';

        if (html.toLowerCase().includes('</body>')) {
            return html.replace(/<\/body>/i, controlScript + '</body>');
        } else if (html.trim().startsWith('<svg') || html.trim().startsWith('<?xml')) {
            return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:' + bg + ';}</style></head><body>' + html + controlScript + '</body></html>';
        } else {
            return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:' + bg + ';}</style></head><body>' + html + controlScript + '</body></html>';
        }
    }

    // === 拖拽移动 + 边缘缩放 ===
    function _initDragResize() {
        var dlg = document.getElementById('lottieDialog');
        var handle = document.getElementById('lottieDragHandle');
        if (!dlg || !handle) return;

        handle.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            var rect = dlg.getBoundingClientRect();
            dlg.style.position = 'fixed';
            dlg.style.left = rect.left + 'px';
            dlg.style.top = rect.top + 'px';
            dlg.style.margin = '0';
            dlg.style.transform = 'none';
            var offX = e.clientX - rect.left;
            var offY = e.clientY - rect.top;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            function onMove(ev) {
                var nx = ev.clientX - offX;
                var ny = ev.clientY - offY;
                var maxW = window.innerWidth - dlg.offsetWidth;
                var maxH = window.innerHeight - dlg.offsetHeight;
                dlg.style.left = Math.max(0, Math.min(nx, maxW)) + 'px';
                dlg.style.top = Math.max(0, Math.min(ny, maxH)) + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
        });

        var handles = dlg.querySelectorAll('.resize-handle');
        handles.forEach(function(h) {
            h.addEventListener('mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var dir = h.className.replace('resize-handle resize-', '');
                var rect = dlg.getBoundingClientRect();
                dlg.style.position = 'fixed';
                dlg.style.left = rect.left + 'px';
                dlg.style.top = rect.top + 'px';
                dlg.style.margin = '0';
                dlg.style.transform = 'none';
                var startX = e.clientX, startY = e.clientY;
                var startW = rect.width, startH = rect.height;
                var startL = rect.left, startT = rect.top;
                var minW = 320, minH = 200;
                document.addEventListener('mousemove', onResize);
                document.addEventListener('mouseup', onUp);
                function onResize(ev) {
                    var dx = ev.clientX - startX;
                    var dy = ev.clientY - startY;
                    var newW = startW, newH = startH, newL = startL, newT = startT;
                    if (dir.indexOf('e') >= 0) newW = Math.max(minW, startW + dx);
                    if (dir.indexOf('s') >= 0) newH = Math.max(minH, startH + dy);
                    if (dir.indexOf('w') >= 0) { newW = Math.max(minW, startW - dx); newL = startL + (startW - newW); }
                    if (dir.indexOf('n') >= 0) { newH = Math.max(minH, startH - dy); newT = startT + (startH - newH); }
                    newL = Math.max(0, Math.min(newL, window.innerWidth - newW));
                    newT = Math.max(0, Math.min(newT, window.innerHeight - newH));
                    newW = Math.min(newW, window.innerWidth - newL);
                    newH = Math.min(newH, window.innerHeight - newT);
                    dlg.style.width = newW + 'px';
                    dlg.style.height = newH + 'px';
                    dlg.style.left = newL + 'px';
                    dlg.style.top = newT + 'px';
                }
                function onUp() {
                    document.removeEventListener('mousemove', onResize);
                    document.removeEventListener('mouseup', onUp);
                }
            });
        });
    }

    function generate() {
        var prompt = document.getElementById('lottiePrompt').value.trim();
        if (!prompt) { showToast('请输入动画描述', 'error'); return; }
        var btn = document.getElementById('lottieGenBtn');
        btn.disabled = true; btn.textContent = '⏳ 生成中...';
        document.getElementById('lottiePlaceholder').style.display = 'none';
        document.getElementById('lottieLoading').style.display = 'block';
        document.getElementById('lottieExportBtn').style.display = 'none';
        document.getElementById('lottieSaveBtn').style.display = 'none';
        document.getElementById('lottieControls').style.display = 'none';

        var 宽 = parseInt(document.getElementById('lottieWidth').value) || 300;
        var 高 = parseInt(document.getElementById('lottieHeight').value) || 300;
        var 时长 = parseFloat(document.getElementById('lottieDuration').value) || 3;
        var 循环 = document.getElementById('lottieLoop').checked;
        var 格式 = document.getElementById('lottieFormat').value || 'svg';
        var 原始代码 = window._importedCode || '';

        var reqBody = {描述: prompt, 宽: 宽, 高: 高, 时长: 时长, 循环: 循环, 格式: 格式};
        if (原始代码) reqBody.原始代码 = 原始代码;

        fetch('/api/generate-lottie', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(reqBody)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            document.getElementById('lottieLoading').style.display = 'none';
            btn.disabled = false; btn.textContent = '✨ 生成';
            if (data.成功 && data.数据) {
                var html = data.数据;
                window._lastAnimationHTML = html;
                window._importedCode = html;
                _mode = 'modify';
                _isPlaying = true;
                var iframe = document.getElementById('lottiePreview');
                iframe.srcdoc = _wrapForPreview(html);
                document.getElementById('lottieExportBtn').style.display = 'inline-block';
                document.getElementById('lottieSaveBtn').style.display = 'inline-block';
                document.getElementById('lottieControls').style.display = 'flex';
                document.getElementById('lottieNewBtn').style.display = 'inline-block';
                document.getElementById('lottieModifyBtn').style.display = 'inline-block';
                document.getElementById('lottiePlayBtn').textContent = '⏸';
                document.getElementById('lottieSpeedSlider').value = 1;
                document.getElementById('lottieSpeedLabel').textContent = '1.0x';
                _updateModeLabel();
                var modeText = 原始代码 ? '修改' : '生成';
                document.getElementById('lottieStatus').textContent = '✅ ' + modeText + '成功（' + 宽 + '×' + 高 + 'px / ' + 时长 + 's' + (循环 ? ' / 循环' : '') + '）';
            } else {
                document.getElementById('lottiePlaceholder').style.display = 'block';
                document.getElementById('lottieStatus').textContent = '❌ ' + (data.错误 || '生成失败');
                showToast('生成失败: ' + (data.错误 || '未知错误'), 'error');
            }
        })
        .catch(function(err) {
            document.getElementById('lottieLoading').style.display = 'none';
            document.getElementById('lottiePlaceholder').style.display = 'block';
            btn.disabled = false; btn.textContent = '✨ 生成';
            document.getElementById('lottieStatus').textContent = '❌ 网络错误';
            showToast('网络错误: ' + err.message, 'error');
        });
    }

    function exportHTML() {
        if (!window._lastAnimationHTML) return;
        var 格式 = document.getElementById('lottieFormat').value || 'svg';
        var ext = 格式 === 'svg' ? '.svg' : '.html';
        var blob = new Blob([window._lastAnimationHTML], {type: 'text/' + 格式});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'animation_' + Date.now() + ext;
        a.click();
        URL.revokeObjectURL(url);
        showToast('已导出动画文件', 'success');
    }

    function saveToFolder() {
        if (!window._lastAnimationHTML) return;
        var dir = (typeof galleryPath !== 'undefined' && galleryPath) ? galleryPath : '';
        if (!dir || dir === '我的电脑') {
            showToast('请先在左侧打开一个文件夹，再保存动画', 'error');
            return;
        }
        var 格式 = document.getElementById('lottieFormat').value || 'svg';
        var ext = 格式 === 'svg' ? '.svg' : '.html';
        var prompt = document.getElementById('lottiePrompt').value.trim() || 'animation';
        var 文件名 = prompt.replace(/[\\/:*?"<>|]/g, '_').substring(0, 30) + ext;
        var btn = document.getElementById('lottieSaveBtn');
        btn.disabled = true; btn.textContent = '⏳ 保存中...';

        fetch('/api/save-animation', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({文件名: 文件名, 内容: window._lastAnimationHTML, 目录: dir})
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            btn.disabled = false; btn.textContent = '💾 保存到当前文件夹';
            if (data.成功) {
                document.getElementById('lottieStatus').textContent = '✅ 已保存: ' + data.路径;
                showToast('动画已保存到: ' + data.路径, 'success');
                if (typeof showGallery === 'function' && typeof galleryPath !== 'undefined' && galleryPath) showGallery(galleryPath);
            } else {
                showToast('保存失败: ' + (data.错误 || '未知错误'), 'error');
            }
        })
        .catch(function(err) {
            btn.disabled = false; btn.textContent = '💾 保存到当前文件夹';
            showToast('保存失败: ' + err.message, 'error');
        });
    }

    window.lottieWorkshop = {
        open: openWorkshop,
        close: close,
        generate: generate,
        exportHTML: exportHTML,
        saveToFolder: saveToFolder,
        importFile: importFile,
        togglePlay: togglePlay,
        setSpeed: setSpeed,
        cycleBg: cycleBg,
        startNew: startNew,
        startModify: startModify
    };
})();
