// ==== 拆分自 app-chatbox.js：成功对话指示箭头（游戏小地图式：悬浮在对话框边框外缘，指向成功的对话，点击直达） ====
Object.assign(App, {
        // ===== 成功对话指示箭头（游戏小地图式：悬浮在对话框边框外缘，指向成功的对话，点击直达） =====
        _updateSuccessArrows: function(box, chat) {
            var self = this;
            if (!box || !chat || !chat.el) return;
            var el = chat.el;
            // 收集所有成功状态的对话（_taskStatus 持久标记 / task-success 类）
            var targets = [];
            (this.chatBoxes || []).forEach(function(c) {
                if (!c || c === chat || !c.el || !c.el.isConnected) return;
                if ((c._taskStatus === 'success' || c.el.classList.contains('task-success')) && !c._successArrowCentered) targets.push(c);
            });
            if (!targets.length) {
                var hostLayer = (el.offsetParent || box.parentNode || document.body);
                var oldC = hostLayer.querySelector('.cbx-succ-nav[data-for="' + chat.id + '"]');
                if (oldC) oldC.remove();
                chat._succNavSig = '';
                return;
            }
            var GAP = 18; // 箭头悬浮在边框外缘的距离
            var cx = el.offsetLeft + el.offsetWidth / 2;
            var cy = el.offsetTop + el.offsetHeight / 2;
            var hw = el.offsetWidth / 2 + GAP;
            var hh = el.offsetHeight / 2 + GAP;
            var placed = [];
            var parts = [];
            targets.forEach(function(t) {
                var tx = t.el.offsetLeft + t.el.offsetWidth / 2;
                var ty = t.el.offsetTop + t.el.offsetHeight / 2;
                var dx = tx - cx, dy = ty - cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var rad = Math.atan2(dy, dx);
                var cos = Math.cos(rad), sin = Math.sin(rad);
                // 射线与扩大后的边框矩形求交点（箭头停靠位置）
                var k = Math.min(hw / Math.max(Math.abs(cos), 1e-6), hh / Math.max(Math.abs(sin), 1e-6));
                var bx = cx + cos * k - el.offsetLeft;
                var by = cy + sin * k - el.offsetTop;
                // 防重叠：多个箭头靠近时沿垂直方向错开
                var idx = 0;
                while (idx < 20) {
                    var ok = true;
                    for (var i = 0; i < placed.length; i++) {
                        if (Math.abs(placed[i].x - bx) < 32 && Math.abs(placed[i].y - by) < 32) { ok = false; break; }
                    }
                    if (ok) break;
                    idx++;
                    var off = (idx % 2 === 1 ? 1 : -1) * Math.ceil(idx / 2) * 36;
                    bx = cx + cos * k - sin * off - el.offsetLeft;
                    by = cy + sin * k + cos * off - el.offsetTop;
                }
                placed.push({ x: bx, y: by });
                t._succArrowInfo = { px: bx, py: by, ang: Math.round(rad * 180 / Math.PI), dist: Math.round(dist) };
                parts.push(t.id + ':' + Math.round(bx) + ',' + Math.round(by));
            });
            // 无变化不重建（避免闪烁/打断点击）
            var sig = el.offsetLeft + ',' + el.offsetTop + ',' + el.offsetWidth + ',' + el.offsetHeight + '|' + parts.join('|');
            if (chat._succNavSig === sig) return;
            chat._succNavSig = sig;
            var hostLayer = (el.offsetParent || box.parentNode || document.body); // 画布层（与 offsetLeft/Top 同坐标系），箭头悬浮于边框外缘不被裁剪
            var container = hostLayer.querySelector('.cbx-succ-nav[data-for="' + chat.id + '"]');
            if (!container) {
                container = document.createElement('div');
                container.className = 'cbx-succ-nav';
                container.setAttribute('data-for', chat.id);
                container.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                // 箭头自身 hover 也保持显示（鼠标从框移向箭头穿过 18px 间隙时不闪没）
                container.addEventListener('mouseenter', function() { container.classList.add('on'); });
                container.addEventListener('mouseleave', function() { container.classList.remove('on'); });
                hostLayer.appendChild(container);
            }
            // 对话框 hover 实时开关箭头显示（仅悬浮的框才显示）
            if (!el._succHoverBound) {
                el._succHoverBound = true;
                el.addEventListener('mouseenter', function() {
                    var hl = el.offsetParent; if (!hl) return;
                    var c = hl.querySelector('.cbx-succ-nav[data-for="' + chat.id + '"]');
                    if (c) c.classList.add('on');
                });
                el.addEventListener('mouseleave', function() {
                    var hl = el.offsetParent; if (!hl) return;
                    var c = hl.querySelector('.cbx-succ-nav[data-for="' + chat.id + '"]');
                    if (!c) return;
                    setTimeout(function() { if (!c.matches(':hover') && !el.matches(':hover')) c.classList.remove('on'); }, 180);
                });
            }
            // 仅当鼠标悬浮在该对话框时显示箭头（游戏小地图式：需要时才出现）
            if (container && el.matches(':hover')) container.classList.add('on');
            if (container && !el.matches(':hover') && !container.matches(':hover')) container.classList.remove('on');
            // 容器跟随对话框左上角（画布坐标系）
            container.style.left = el.offsetLeft + 'px';
            container.style.top = el.offsetTop + 'px';
            container.style.width = el.offsetWidth + 'px';
            container.style.height = el.offsetHeight + 'px';
            container.innerHTML = '';
            targets.forEach(function(t) {
                var info = t._succArrowInfo;
                if (!info) return;
                var arrow = document.createElement('div');
                arrow.className = 'cbx-succ-arrow';
                arrow.style.left = info.px + 'px';
                arrow.style.top = info.py + 'px';
                var distStr = info.dist >= 1000 ? (info.dist / 1000).toFixed(1) + 'k' : String(info.dist);
                arrow.title = '✓ 成功对话（距离约 ' + distStr + 'px）— 点击直达';
                var icon = document.createElement('i');
                icon.className = 'arr';
                icon.style.transform = 'rotate(' + (info.ang + 90) + 'deg)'; // 三角默认朝上，+90 对齐 atan2 坐标系（0°=向右，90°=向下）
                arrow.appendChild(icon);
                arrow.addEventListener('click', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    var targetExists = self.chatBoxes.some(function(candidate) {
                        return candidate === t && candidate.el && candidate.el.isConnected;
                    });
                    if (!targetExists) {
                        self._updateAllNavArrows();
                        return;
                    }
                    // This target has already been reached, so other chats no longer advertise it.
                    t._successArrowCentered = true;
                    self._focusChatBox(t);
                    // 点击后视口已跳转，图标立即消失
                    if (arrow.parentNode) arrow.parentNode.classList.remove('on');
                    self._updateAllNavArrows();
                });
                container.appendChild(arrow);
            });
        },
});
