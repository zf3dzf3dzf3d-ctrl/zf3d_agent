/* =====================================================================
   app-kite-modes.js — 风筝头多形态变形（风筝 / 办公 / 植物 / 鱼缸 / 无）
   设计原则（承接策划案 v2.0）：
   - 零侵入：不修改 app-kite.js 任何一行；舞台挂进 #zfKiteRoot，
     天然继承风筝系统开关(kiteToggleBtn)与急速模式(html.turbo)的显隐。
   - 零 RAF：模式内不启动任何 requestAnimationFrame；状态用 1s 低频
     轮询（签名变更才动 DOM），动画全部 CSS keyframes。
   - 数据源：直接读 window.App.chatBoxes（与风筝节数据同源，状态天然同步）。
   - 模式持久化：localStorage zf_kite_mode（kite/office/plant，默认 kite）。
   ===================================================================== */
(function () {
    'use strict';
    var MODE_KEY = 'zf_kite_mode';
    var ANCHOR_KEY = 'zf3d-kite-anchor';   /* 与 app-kite.js 共用：风筝锚点 x,y */
    var MODES = ['kite', 'office', 'plant', 'fish', 'spider', 'farm', 'ninja', 'space', 'pelican', 'tank', 'none'];
    var MAX_DESK = 8;          // 办公模式最多工位数，超出收进 +N 计数牌
    var MAX_LEAF = 14;         // 植物模式最多叶片数，超出收进叶簇角标
    var MAX_FISH = 10;         // 鱼缸模式最多鱼数，防 DOM 爆炸
    var MAX_SPIDER = 1;        // 电子爬虫已单例化：全局一只机械六足，不按对话分身
    var MAX_FARM = 12;         // 种田模式田块数（4×3），固定
    var SEED_KEY = 'zf_farm_seeds';       // 种子库存
    var FARM_STATE_KEY = 'zf_farm_state'; // 田块状态持久化
    var SEED_CAP = 99;

    function usGet(key) {
        try {
            var v = (window.UserSettings && window.UserSettings.get(key));
            if (v !== undefined && v !== null) return v;
        } catch (e) {}
        return null;
    }
    /* 持久化双写：localStorage 秒读 + UserSettings 同步服务器文件（重启/清缓存不丢） */
    function usSet(key, val) {
        try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); } catch (e) {}
        try { if (window.UserSettings) window.UserSettings.set(key, val); } catch (e) {}
    }
    function getMode() {
        try {
            var m = usGet(MODE_KEY);
            if (typeof m === 'string') m = m.replace(/^"|"$/g, '');   /* 兼容历史 JSON 字符串形态 */
            return MODES.indexOf(m) >= 0 ? m : 'kite';
        } catch (e) { return 'kite'; }
    }

    /* ---------- 手绘 SVG 图标（不依赖 emoji 字体，全平台一致） ---------- */
    var MODE_SVGS = {
        kite: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M12 2.5 L20 11 L12 15.5 L4 11 Z" fill="#e05a4e" stroke="#b03a30" stroke-width="0.8"/>'
            + '<path d="M12 2.5 L12 15.5 M4 11 L20 11" stroke="#f6d7a0" stroke-width="1.1" fill="none"/>'
            + '<path d="M12 15.5 C9.8 18 14 18.6 11.2 21.8" stroke="#cbd5e1" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-dasharray="2 1.6"/>'
            + '</svg>',
        office: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<rect x="5" y="4" width="14" height="17" rx="1.2" fill="#5c7ecf" stroke="#3b5aa8" stroke-width="0.9"/>'
            + '<rect x="8" y="7" width="2.4" height="2.4" fill="#f3f6ff"/><rect x="13.6" y="7" width="2.4" height="2.4" fill="#f3f6ff"/>'
            + '<rect x="8" y="11.5" width="2.4" height="2.4" fill="#f3f6ff"/><rect x="13.6" y="11.5" width="2.4" height="2.4" fill="#f3f6ff"/>'
            + '<rect x="10.6" y="16.6" width="2.8" height="4.4" fill="#2e4478"/>'
            + '</svg>',
        plant: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M14.5 7 C19 7 20.5 3.5 20.5 3.5 C20.5 3.5 21 9 15.5 9.6 C14.8 9.7 14 9.4 14 9.4 Z" fill="#57b45c"/>'
            + '<path d="M9.5 10 C5 10 3.5 6.5 3.5 6.5 C3.5 6.5 3 12 8.5 12.6 C9.2 12.7 10 12.4 10 12.4 Z" fill="#6fc973"/>'
            + '<path d="M12 8 L12 17" stroke="#3e8e42" stroke-width="1.3" fill="none" stroke-linecap="round"/>'
            + '<path d="M7 17.5 h10 l-1.3 4.5 h-7.4 Z" fill="#c97b4a" stroke="#9c5a32" stroke-width="0.8"/>'
            + '</svg>',
        fish: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M4 12 C7 7.5 13 6.5 17 10.5 L20.5 7.5 L20.5 16.5 L17 13.5 C13 17.5 7 16.5 4 12 Z" fill="#5aa8cf" stroke="#3a7ba0" stroke-width="0.9"/>'
            + '<circle cx="8.2" cy="11" r="1" fill="#10222e"/>'
            + '<path d="M11 8.2 C12.5 10 12.5 14 11 15.8" stroke="#8fd0ea" stroke-width="1" fill="none"/>'
            + '</svg>',
        /* 太空舱：观测窗小图标（圆形舷窗+地球弧线） */
        space: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<circle cx="12" cy="12" r="8.5" fill="#0d1b3a" stroke="#7fb4e8" stroke-width="1.4"/>'
            + '<circle cx="12" cy="12" r="6" fill="none" stroke="#4a6fa5" stroke-width="0.8"/>'
            + '<path d="M7 14 C9.5 11.5 14.5 11.5 17 14" stroke="#57b45c" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
            + '<circle cx="10" cy="9.5" r="0.9" fill="#cfe6ff"/><circle cx="14" cy="8.5" r="0.6" fill="#cfe6ff"/>'
            + '</svg>',
        /* 鹈鹕骑车：橙色圆身+橙喙小图标 */
        pelican: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<circle cx="10" cy="12" r="6.2" fill="#f4f7fb" stroke="#33404d" stroke-width="1.2"/>'
            + '<path d="M14 9.5 L21 10.5 C19.5 12.8 16 13.4 14 12.2 Z" fill="#ff8a3d" stroke="#33404d" stroke-width="1"/>'
            + '<circle cx="11" cy="9.8" r="1" fill="#1c2530"/>'
            + '<circle cx="12" cy="18.6" r="3.4" fill="none" stroke="#ff9d5c" stroke-width="1.4"/>'
            + '</svg>',
        none: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<circle cx="12" cy="12" r="8.5" fill="none" stroke="#9aa5b1" stroke-width="1.7"/>'
            + '<path d="M6.4 6.4 L17.6 17.6" stroke="#e05a4e" stroke-width="1.7" stroke-linecap="round"/>'
            + '</svg>',
        /* 电子爬虫：机械蜘蛛小图标（身体+8 简笔腿+电光眼） */
        spider: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<ellipse cx="12" cy="13" rx="3.4" ry="2.6" fill="#2b3644" stroke="#5fd8c8" stroke-width="0.9"/>'
            + '<circle cx="12" cy="10.2" r="1.6" fill="#3a4a5c" stroke="#5fd8c8" stroke-width="0.7"/>'
            + '<circle cx="11.4" cy="10" r="0.5" fill="#5fd8c8"/><circle cx="12.7" cy="10" r="0.5" fill="#5fd8c8"/>'
            + '<path d="M9 12 L4.5 8.5 M9 13.5 L4 13 M9.5 14.8 L5 18 M15 12 L19.5 8.5 M15 13.5 L20 13 M14.5 14.8 L19 18" stroke="#5fd8c8" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
            + '</svg>',
        /* 麦穗：秆+对生麦粒+两片叶 */
        farm: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M12 21 L12 6" stroke="#c9a24a" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
            + '<path d="M12 6 C10.2 5.4 9.6 3.6 9.6 3.6 C9.6 3.6 11.8 3.8 12 6 Z" fill="#e8c96a"/>'
            + '<path d="M12 9.5 C9.8 9.3 8.6 7.6 8.6 7.6 C8.6 7.6 11.2 7.2 12 9.5 Z" fill="#e8c96a"/>'
            + '<path d="M12 9.5 C14.2 9.3 15.4 7.6 15.4 7.6 C15.4 7.6 12.8 7.2 12 9.5 Z" fill="#d9b852"/>'
            + '<path d="M12 13 C9.8 12.8 8.6 11.1 8.6 11.1 C8.6 11.1 11.2 10.7 12 13 Z" fill="#e8c96a"/>'
            + '<path d="M12 13 C14.2 12.8 15.4 11.1 15.4 11.1 C15.4 11.1 12.8 10.7 12 13 Z" fill="#d9b852"/>'
            + '<path d="M12 16.5 C10 16.3 8.8 14.8 8.8 14.8 C8.8 14.8 11.2 14.4 12 16.5 Z" fill="#e8c96a"/>'
            + '<path d="M12 16.5 C14 16.3 15.2 14.8 15.2 14.8 C15.2 14.8 12.8 14.4 12 16.5 Z" fill="#d9b852"/>'
            + '<path d="M12 15 C8.5 14.6 6.5 12 6.5 12 C6.5 12 9.8 11.6 12 15 Z" fill="#6fc973"/>'
            + '<path d="M12 18 C9 17.8 7.6 15.8 7.6 15.8 C7.6 15.8 10.4 15.4 12 18 Z" fill="#57b45c"/>'
            + '</svg>',
        /* 忍者：斗笠头+蒙面+眼睛，暗色小图标 */
        ninja: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M4.5 11 C6 5.5 18 5.5 19.5 11 Z" fill="#2b3644" stroke="#0f1720" stroke-width="0.9"/>'
            + '<rect x="6.5" y="10.5" width="11" height="7" rx="2.4" fill="#3a4a5c" stroke="#1c2632" stroke-width="0.8"/>'
            + '<rect x="8" y="12.4" width="8" height="2.6" rx="1.2" fill="#c9354a"/>'
            + '<circle cx="10.2" cy="13.7" r="0.8" fill="#fff"/><circle cx="13.8" cy="13.7" r="0.8" fill="#fff"/>'
            + '<rect x="11.4" y="4.6" width="1.2" height="6.4" rx="0.6" fill="#7a5a3a"/>'
            + '</svg>',
        /* 坦克大战：迷彩炮塔小图标 */
        tank: '<svg class="zfm-ico" viewBox="0 0 24 24" aria-hidden="true">'
            + '<rect x="3.5" y="13.5" width="17" height="5" rx="2.5" fill="#4a5d3a" stroke="#1c2632" stroke-width="0.8"/>'
            + '<circle cx="6.8" cy="16" r="1" fill="#2b3624"/><circle cx="12" cy="16" r="1" fill="#2b3624"/><circle cx="17.2" cy="16" r="1" fill="#2b3624"/>'
            + '<path d="M8 13.5 C8 10.5 16 10.5 16 13.5 Z" fill="#5d7345" stroke="#1c2632" stroke-width="0.8"/>'
            + '<rect x="11.4" y="6.2" width="1.2" height="6" rx="0.6" fill="#2b3624"/>'
            + '</svg>'
    };
    function setModeStore(m) { usSet(MODE_KEY, m); }

    /* ---------- 会话状态收集（与 app-kite syncChats 同源同判据） ---------- */
    function collectChats() {
        var out = [];
        try {
            var boxes = (window.App && Array.isArray(window.App.chatBoxes)) ? window.App.chatBoxes : [];
            boxes.forEach(function (c) {
                if (!c || !c.id) return;
                var st = c._taskStatus || '';
                var running = !!c.isSending || !!c._thinking;
                if (c._thinking) st = 'pending';
                var state;
                if (st === 'success') state = 'done';
                else if (st === 'fail') state = 'fail';
                else if (running || st === 'pending') state = 'working';
                else state = 'idle';
                out.push({ id: c.id, title: c.title || c.id, state: state });
            });
        } catch (e) {}
        return out;
    }
    function sigOf(list) {
        return list.map(function (c) { return c.id + ':' + c.state; }).join('|');
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }
    /* 点击工位/叶片 → 聚焦该对话（摄像机居中+激活，复用 App._focusChatBox） */
    function focusChat(id) {
        try {
            var A = window.App;
            if (!A || !id) return;
            if (typeof A._focusChatBox === 'function') { A._focusChatBox(id); return; }
            if (typeof A.setActiveChat === 'function') A.setActiveChat(id);
            else if (typeof A.activateChatBox === 'function') A.activateChatBox(id);
            else if (typeof A.switchToChat === 'function') A.switchToChat(id);
            else if (typeof A._quickSendToChat !== 'function' && typeof A.setActive === 'function') A.setActive(id);
        } catch (e) {}
    }

    /* =====================================================================
       渲染器一：办公模式 🏢
       场景 = 屏幕右下办公室：透视地板 + 工位小人（≤8）+ 装饰 + +N 计数牌
       状态映射：idle=屏幕暗 | working=屏幕绿光手速快 | done=举手 | fail=红感叹号
       ===================================================================== */
    var office = {
        el: null, sig: '',
        /* 随机出生点：房间地板区域内（百分比），保证小人散开不重叠太近 */
        randPos: function () {
            return { x: 5 + Math.random() * 80, y: 10 + Math.random() * 60 };
        },
        ensure: function (host) {
            if (!this.el) {
                this.el = document.createElement('div');
                this.el.className = 'zfm-office';
                this.el.innerHTML =
                    '<div class="zfm-of-bg"><div class="zfm-of-board">🐝 蜂群作战室</div><div class="zfm-of-plant"></div><div class="zfm-of-plant zfm-of-plant2"></div></div>' +
                    '<div class="zfm-of-room">' +
                        '<div class="zfm-of-shelf"></div>' +
                        '<div class="zfm-of-water"></div>' +
                        '<div class="zfm-of-sofa"></div>' +
                        '<div class="zfm-of-boss"></div>' +
                        '<div class="zfm-of-bin"></div>' +
                    '</div>' +
                    '<div class="zfm-of-desks"></div>';
                host.appendChild(this.el);
                this.makeDraggable();
            }
            return this.el;
        },
        /* 整体拖拽：按住办公室空白处拖动，直接改 right/bottom（带边界钳制不出屏），
           位置记忆在 localStorage（工位小人除外，仍可点击） */
        makeDraggable: function () {
            var el = this.el;
            if (el._zfmDrag) return;
            el._zfmDrag = true;
            var st = { on: false, sx: 0, sy: 0, or: 0, ob: 0, moved: false };
            var getP = function () {
                return {
                    r: parseFloat(el.style.right) || 10,
                    b: parseFloat(el.style.bottom) || 110
                };
            };
            var clamp = function (r, b) {
                return clampStagePos(el, r, b);   /* 【修复】统一走 zoom 感知钳制，左移不再被卡 */
            };
            var apply = function (r, b) {
                var c = clamp(r, b);
                el.style.right = c.r + 'px';
                el.style.bottom = c.b + 'px';
            };
            el.addEventListener('pointerdown', function (e) {
                if (e.target.closest('.zfm-of-desk')) return;   /* 工位可点击，不参与拖拽 */
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false };
                el.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                var z = zOf(el);   /* 【修复】除以 zoom，拖拽跟手（办公室 zoom:0.6） */
                var dx = (e.clientX - st.sx) / z, dy = (e.clientY - st.sy) / z;
                if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                if (st.moved) { apply(st.or - dx, st.ob - dy); el._zfmMoved = true; }
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { usSet('zfm-office-pos', p); } catch (e) { }
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
            /* 工位小人单独拖拽：委托到容器，pointerdown 已排除 .zfm-of-desk，二者互不干扰 */
            var dst = { on: false, sx: 0, sy: 0, px: 0, py: 0, moved: false, d: null };
            el.addEventListener('pointerdown', function (e) {
                var d = e.target.closest('.zfm-of-desk');
                if (!d || d.classList.contains('zfm-of-more')) return;
                e.stopPropagation();   /* 不让整体拖拽接管 */
                dst.on = true; dst.moved = false; dst.d = d;
                dst.sx = e.clientX; dst.sy = e.clientY;
                dst.px = parseFloat(d.style.left) || 0;
                dst.py = parseFloat(d.style.top) || 0;
                d.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!dst.on || !dst.d) return;
                var dx = e.clientX - dst.sx, dy = e.clientY - dst.sy;
                if (Math.abs(dx) + Math.abs(dy) > 3) dst.moved = true;
                if (!dst.moved) return;
                /* 像素位移换算为房间百分比坐标（getBoundingClientRect 已含 zoom 缩放），钳制在地板内 */
                var room = el.querySelector('.zfm-of-desks');
                if (!room) return;
                var rc = room.getBoundingClientRect();
                var rw = rc.width || 1, rh = rc.height || 1;
                var nx = Math.max(0, Math.min(88, dst.px + dx / rw * 100));
                var ny = Math.max(0, Math.min(72, dst.py + dy / rh * 100));
                dst.d.style.left = nx + '%';
                dst.d.style.top = ny + '%';
            });
            var dup = function () {
                if (dst.on && dst.moved && dst.d) {
                    /* 拖过的工位吞掉紧随的 click，避免误触"切换对话" */
                    var d = dst.d;
                    d.addEventListener('click', function (ev) { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
                }
                dst.on = false; dst.d = null;
            };
            el.addEventListener('pointerup', dup);
            el.addEventListener('pointercancel', dup);
        },
        render: function (host, chats) {
            var desks = this.ensure(host).querySelector('.zfm-of-desks');
            var list = chats.slice(-MAX_DESK);
            var extra = chats.length - list.length;
            var sig = sigOf(list) + '#' + extra;
            if (sig === this.sig) { this.walk(); return; }   /* 签名未变：只走散步 tick，不重建 DOM（保动画） */
            this.sig = sig;
            var self = this;
            var html = '';
            list.forEach(function (c, idx) {
                // 角色配色：按标题 hash 从调色板取（策划橙/审核蓝/总结绿/监督紫/兜底茶）
                var palette = [
                    { hair: '#c0562e', body: '#e8853a' },  // 橙·策划
                    { hair: '#2e4a7a', body: '#4a6fa5' },  // 蓝·审核
                    { hair: '#1f6e40', body: '#3a9a5e' },  // 绿·总结
                    { hair: '#5b3a7e', body: '#8256a8' },  // 紫·监督
                    { hair: '#4a3418', body: '#8a6a3a' }   // 兜底·茶
                ];
                var h = 0, t = c.title || '';
                for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
                var col = palette[h % palette.length];
                var bulb = (c.state === 'working' && (h + idx) % 3 === 0) ? '<div class="zfm-of-bulb"></div>' : '';
                /* 游戏小人风格：无背景卡片、无名字，小人+办公桌整体随机摆放 */
                var pos = self.randPos();
                html += '<div class="zfm-of-desk st-' + c.state + '" style="left:' + pos.x + '%;top:' + pos.y + '%" data-title="' + esc(c.title) + '" data-chat="' + esc(c.id) + '">' +
                    '<div class="zfm-of-guy" style="--guy-hair:' + col.hair + ';--guy-body:' + col.body + '">' +
                        '<div class="zfm-guy-head"></div><div class="zfm-guy-body"></div>' +
                    '</div>' +
                    '<div class="zfm-of-table"><div class="zfm-of-screen"></div></div>' + bulb +
                    '</div>';
            });
            if (extra > 0) html += '<div class="zfm-of-desk zfm-of-more" title="还有 ' + extra + ' 个对话">+' + extra + '</div>';
            if (!chats.length) html = '<div class="zfm-of-empty">办公室空着…新建对话开工</div>';
            desks.innerHTML = html;
            // 全部完成（且至少1个对话）→ 全屋灯光庆祝
            var room = this.ensure(host);
            var allDone = chats.length > 0 && chats.every(function (c) { return c.state === 'done'; });
            room.classList.toggle('zfm-celebrate', allDone);
        },
        destroy: function () { if (this.el) { this.el.remove(); this.el = null; } this.sig = ''; this.walkT = 0; },
        /* 小人随机游走：每 4 秒决策，40% 概率走到房间内新目标点（CSS left/top 过渡 + 翻面），
           working 状态的小人守在原地打字（只小幅挪动），零 RAF */
        walk: function () {
            if (!this.el) return;
            var now = Date.now();
            var self = this;
            var desks = this.el.querySelectorAll('.zfm-of-desk');
            [].forEach.call(desks, function (d) {
                if (d.classList.contains('zfm-of-more')) return;
                /* 每个小人独立时钟：各自持有随机错开的下次决策时刻，避免全员齐步走 */
                if (!d._nextWalk) d._nextWalk = now + Math.random() * 6000;
                if (now < d._nextWalk) return;
                d._nextWalk = now + 4000 + Math.random() * 6000;   /* 4~10 秒后各自再决策 */
                if (d.classList.contains('st-working') && Math.random() > 0.15) return;   /* 工作中基本不走 */
                if (Math.random() > 0.4) return;   /* 40% 概率走动 */
                var p = self.randPos();
                d.style.left = p.x + '%';
                d.style.top = p.y + '%';
                var guy = d.querySelector('.zfm-of-guy');
                if (guy) guy.classList.toggle('zfm-walking', true);
                setTimeout(function () { if (guy) guy.classList.remove('zfm-walking'); }, 1200);
            });
            /* 随机游戏气泡：偶尔有小人冒一句台词 */
            if (Math.random() < 0.35) {
                var lines = ['我累了', '加油鸭！', '喝口水~', '灵感来了！', '马上好！', '摸鱼中…'];
                var cands = this.el.querySelectorAll('.zfm-of-desk:not(.zfm-of-more)');
                if (cands.length) {
                    var t = cands[Math.floor(Math.random() * cands.length)];
                    if (!t.querySelector('.zfm-of-bubble')) {
                        var b = document.createElement('div');
                        b.className = 'zfm-of-bubble';
                        b.textContent = lines[Math.floor(Math.random() * lines.length)];
                        t.appendChild(b);
                        /* 靠近顶部时气泡翻到下方显示，防被容器裁剪 */
                        if (t.offsetTop < 30) b.classList.add('zfm-bubble-flip');
                        setTimeout(function () { b.remove(); }, 2600);
                    }
                }
            }
        }
    };

    /* =====================================================================
       渲染器二：植物模式 🌻
       场景 = 屏幕右缘一株生长条：每对话一片叶子，从下往上长，顶端向日葵
       状态映射：working=摇摆+绿呼吸 | done=深绿停稳 | fail=叶缘泛红
       全部完成 → 向日葵满开(zfm-bloom)庆祝
       ===================================================================== */
    var plant = {
        el: null, sig: '',
        ensure: function (host) {
            if (!this.el) {
                this.el = document.createElement('div');
                this.el.className = 'zfm-plant';
                this.el.innerHTML = '<div class="zfm-pl-flower"><div class="zfm-pl-core"></div></div><div class="zfm-pl-stem"></div><div class="zfm-pl-leaves"></div><div class="zfm-pl-pot"></div>';
                host.appendChild(this.el);
                this.makeDraggable();
            }
            return this.el;
        },
        /* 整体拖拽：与办公室同款（right/bottom + 边界钳制 + 独立记忆） */
        makeDraggable: function () {
            var el = this.el;
            if (el._zfmDrag) return;
            el._zfmDrag = true;
            var st = { on: false, sx: 0, sy: 0, or: 0, ob: 0, moved: false };
            var getP = function () {
                return { r: parseFloat(el.style.right) || 10, b: parseFloat(el.style.bottom) || 90 };
            };
            var apply = function (r, b) {
                var z = zOf(el);
                var w = window.innerWidth || 1280, h = window.innerHeight || 800;
                var ew = (el.offsetWidth || 60) * z, eh = (el.offsetHeight || 200) * z;
                r = Math.max(4 / z, Math.min((w - ew - 4) / z, r));
                b = Math.max(4 / z, Math.min((h - eh - 4) / z, b));
                el.style.right = r + 'px';
                el.style.bottom = b + 'px';
            };
            el.addEventListener('pointerdown', function (e) {
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false };
                el.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                var z = zOf(el);   /* 【修复】鼠标位移是渲染像素，除以 zoom 换算成样式值，拖拽跟手 */
                var dx = (e.clientX - st.sx) / z, dy = (e.clientY - st.sy) / z;
                if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                if (st.moved) { apply(st.or - dx, st.ob - dy); el._zfmMoved = true; }
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { usSet('zfm-plant-pos', p); } catch (e) { }
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },
        render: function (host, chats) {
            var box = this.ensure(host);
            var leaves = box.querySelector('.zfm-pl-leaves');
            var flower = box.querySelector('.zfm-pl-flower');
            var list = chats.slice(-MAX_LEAF);
            var extra = chats.length - list.length;
            var allDone = chats.length > 0 && chats.every(function (c) { return c.state === 'done'; });
            var sig = sigOf(list) + '#' + extra + '#' + (allDone ? 'B' : '-');
            if (sig === this.sig) return;
            this.sig = sig;
            flower.classList.toggle('zfm-bloom', allDone);
            /* 满开庆祝 → 花瓣粒子飘落（每次 bloom 状态点亮时撒 8 片，限时自动清理） */
            if (allDone && !this._bloomed) {
                this._bloomed = true;
                var box2 = box;
                for (var pi = 0; pi < 8; pi++) {
                    (function (i) {
                        setTimeout(function () {
                            var p = document.createElement('div');
                            p.className = 'zfm-pl-petal fall';
                            p.style.left = (20 + Math.random() * 40) + 'px';
                            p.style.setProperty('--px', Math.round((Math.random() * 2 - 1) * 70) + 'px');
                            p.style.setProperty('--py', Math.round(160 + Math.random() * 120) + 'px');
                            p.style.animationDelay = (Math.random() * 0.6) + 's';
                            box2.appendChild(p);
                            setTimeout(function () { p.remove(); }, 4200);
                        }, i * 180);
                    })(pi);
                }
            } else if (!allDone) this._bloomed = false;
            /* 叶子越多植物越高：基础高度 + 每叶约 18px（叶13+间距5），上限屏幕可用高度 */
            var plantH = Math.min(120 + list.length * 18, window.innerHeight - 200);
            box.style.height = plantH + 'px';
            box.classList.remove('zfm-pl-tall');
            var html = '';
            list.forEach(function (c, i) {
                var stTxt = { working: '🌱 工作中', done: '✅ 已完成', fail: '❌ 失败', idle: '💤 空闲' }[c.state] || '';
                var side = (i % 2 === 0) ? 'lf-r' : 'lf-l';   /* 奇数叶朝右、偶数叶朝左，交替生长 */
                /* 工具提示（data-title）已移除（易被裁剪），保留 data-chat 点击切换对话 */
                html += '<div class="zfm-pl-leaf ' + side + ' st-' + c.state + '" data-chat="' + esc(c.id) + '"></div>';
            });
            if (extra > 0) html += '<div class="zfm-pl-leaf zfm-pl-cluster">+' + extra + '</div>';
            if (!chats.length) html = '<div class="zfm-pl-empty">🌱 静待发芽…</div>';
            leaves.innerHTML = html;
        },
        destroy: function () { if (this.el) { this.el.remove(); this.el = null; } this.sig = ''; this._bloomed = false; }
    };

    /* =====================================================================
       渲染器三：鱼缸模式 🐟
       场景 = 玻璃鱼缸：每条对话一条小鱼，缸内慢游
       状态映射：waiting=缸底半透明慢游 | working=正常游动按对话配色
                 done=浮面吐泡后渐隐消散 | fail=翻肚变红沉底8秒消散 | idle=正常淡色
       实现：纯 CSS 动画 + 低频随机决策（同 office.walk），零 RAF；
       按 id diff 只增删变化节点（鱼位置不重置，防瞬移闪烁）
       ===================================================================== */
    var fish = {
        el: null,
        FISH_COLORS: [
            { body: '#e8853a', fin: '#c0562e' },   /* 橙·策划 */
            { body: '#4a6fa5', fin: '#2e4a7a' },   /* 蓝·审核 */
            { body: '#3a9a5e', fin: '#1f6e40' },   /* 绿·总结 */
            { body: '#8256a8', fin: '#5b3a7e' },   /* 紫·监督 */
            { body: '#c9a24a', fin: '#8a6a3a' }    /* 兜底·金 */
        ],
        ensure: function (host) {
            if (!this.el) {
                this.el = document.createElement('div');
                this.el.className = 'zfm-fish-tank';
                this.el.innerHTML =
                    '<div class="zfm-fk-water"></div>' +
                    '<div class="zfm-fk-surface"><span></span><span></span><span></span></div>' +
                    '<div class="zfm-fk-fish-layer"></div>' +
                    '<div class="zfm-fk-sand"></div>' +
                    '<div class="zfm-fk-weed"></div><div class="zfm-fk-weed zfm-fk-weed2"></div>' +
                    '<div class="zfm-fk-empty">鱼缸空着…新建对话开工</div>';
                host.appendChild(this.el);
                this.makeDraggable();
            }
            return this.el;
        },
        /* 整体拖拽：与办公室同款（right/bottom + zoom 感知钳制 + 独立记忆） */
        makeDraggable: function () {
            var el = this.el;
            if (el._zfmDrag) return;
            el._zfmDrag = true;
            var st = { on: false, sx: 0, sy: 0, or: 0, ob: 0, moved: false };
            var getP = function () {
                return { r: parseFloat(el.style.right) || 10, b: parseFloat(el.style.bottom) || 110 };
            };
            var apply = function (r, b) {
                var c = clampStagePos(el, r, b);
                el.style.right = c.r + 'px';
                el.style.bottom = c.b + 'px';
            };
            el.addEventListener('pointerdown', function (e) {
                if (e.target.closest('.zfm-fk-fish')) return;   /* 鱼可点击，不参与拖拽 */
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false };
                el.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                var z = zOf(el);
                var dx = (e.clientX - st.sx) / z, dy = (e.clientY - st.sy) / z;
                if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                if (st.moved) { apply(st.or - dx, st.ob - dy); el._zfmMoved = true; }
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { usSet('zfm-fish-pos', p); } catch (e) { }
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },
        /* 单条鱼 HTML（按对话 hash 取配色，同 office 调色板思路） */
        fishHtml: function (c) {
            var h = 0, t = c.title || '';
            for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
            var col = this.FISH_COLORS[h % this.FISH_COLORS.length];
            var stTxt = { working: '🐟 工作中', done: '✅ 完成', fail: '❌ 失败', idle: '💤 空闲', waiting: '⏳ 排队' }[c.state] || '';
            return '<div class="zfm-fk-fish st-' + c.state + '" data-chat="' + esc(c.id) + '" data-title="' + esc(stTxt + '　' + (c.title || c.id)) + '" style="left:' + (6 + Math.random() * 72) + '%;top:' + (18 + Math.random() * 58) + '%">'
                + '<div class="zfm-fk-body" style="--fish-body:' + col.body + ';--fish-fin:' + col.fin + '"></div>'
                + '<div class="zfm-fk-tail" style="--fish-fin:' + col.fin + '"></div>'
                + '<div class="zfm-fk-eye"></div>'
                + '</div>';
        },
        render: function (host, chats) {
            var layer = this.ensure(host).querySelector('.zfm-fk-fish-layer');
            var list = chats.slice(-MAX_FISH);
            var empty = this.ensure(host).querySelector('.zfm-fk-empty');
            empty.style.display = chats.length ? 'none' : '';
            /* diff：签名含每条鱼的 id+state；只增删变化的鱼，未变的鱼保持原位（防瞬移） */
            var want = {}, self = this, changed = false;
            list.forEach(function (c) { want[c.id + ':' + c.state] = c; });
            /* 删：状态变了的鱼 → 若是终态（done/fail）走消散动画，否则直接移除重建 */
            [].forEach.call(layer.children, function (f) {
                var key = f.getAttribute('data-key');
                if (want[key]) return;
                if (f._dying) return;   /* 消散中的鱼不挡新鱼重建 */
                var endState = key && key.indexOf(':done') > 0 ? 'done' : (key && key.indexOf(':fail') > 0 ? 'fail' : '');
                if (endState && !f._dying) {
                    f._dying = true;
                    f.classList.add(endState === 'fail' ? 'zfm-fk-die' : 'zfm-fk-fade');
                    setTimeout(function () { if (f.parentNode) f.remove(); }, endState === 'fail' ? 8000 : 4000);
                } else if (!f._dying) {
                    f.remove(); changed = true;
                }
            });
            /* 增：新出现的鱼（保位插入，不重建老鱼） */
            list.forEach(function (c) {
                var key = c.id + ':' + c.state;
                var sel = '[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\\"')) + '"]';
                if (layer.querySelector(sel)) return;
                var tmp = document.createElement('div');
                tmp.innerHTML = self.fishHtml(c);
                var f = tmp.firstChild;
                f.setAttribute('data-key', key);
                layer.appendChild(f);
                changed = true;
            });
            /* 状态迁移 done→消散由上面"删"分支处理；这里仅统计 */
            this.swim();   /* 每秒 tick 一次随机游走决策（与 office.walk 同机制） */
            return changed;
        },
        /* 低频游走：每条鱼独立时钟，随机目标点 + 朝向翻转（CSS transition 平滑） */
        swim: function () {
            if (!this.el) return;
            var now = Date.now();
            var layer = this.el.querySelector('.zfm-fk-fish-layer');
            if (!layer) return;
            [].forEach.call(layer.children, function (f) {
                if (f._dying) return;
                if (!f._nextSwim) f._nextSwim = now + Math.random() * 4000;
                if (now < f._nextSwim) return;
                f._nextSwim = now + 3000 + Math.random() * 5000;
                var working = f.classList.contains('st-working');
                if (working && Math.random() > 0.25) return;   /* 工作中的鱼游得少 */
                if (Math.random() > 0.55) return;
                f.style.left = (5 + Math.random() * 74) + '%';
                f.style.top = (waitingOrSwim(f) ? 46 : 10) + Math.random() * (waitingOrSwim(f) ? 44 : 66) + '%';
                var goingLeft = Math.random() < 0.5;
                f.classList.toggle('zfm-fk-flip', goingLeft);
                /* 偶尔吐泡 */
                if (Math.random() < 0.3 && !f.querySelector('.zfm-fk-bubble')) {
                    var b = document.createElement('div');
                    b.className = 'zfm-fk-bubble';
                    f.appendChild(b);
                    setTimeout(function () { b.remove(); }, 2200);
                }
            });
            function waitingOrSwim(f) { return f.classList.contains('st-waiting') || f.classList.contains('st-idle'); }
        },
        destroy: function () { if (this.el) { this.el.remove(); this.el = null; } }
    };

    /* =====================================================================
       渲染器四：电子爬虫模式 🕷
       屏幕机械蜘蛛（≤6 只）：身体 + 8 条三节腿。
       【核心·程序化步态】每条腿的髋/膝/踝三节角度由 JS 按
       对角步态（alt=+1/-1）+ 腿位相位偏移 + 行进速度实时计算，
       绝不使用固定 CSS keyframes；60ms tick 一次绘制整腿 path。
       【腿部触字发光】150ms 节流 elementsFromPoint 采 8 个腿尖，
       命中白名单文字元素加 .zfm-leg-glow，离开走余辉淡出。
       ===================================================================== */
    var spider = {
        el: null, sig: '', legTimer: null, glowTimer: null,
        SPIDER_COLORS: [
            { body: '#2b3644', edge: '#5fd8c8' }, { body: '#34244a', edge: '#c586f0' },
            { body: '#12332b', edge: '#5fe88a' }, { body: '#402a20', edge: '#f0a860' }
        ],
        /* 6 条机械腿（viewBox 60x48，身体中心 30,24）—— 借鉴 hexapod 三足交替步态：
           每侧前/中/后三腿，对侧中腿+两侧前/后腿组成支撑三角，相位取 hexapod 的 0/0.5/0.33 交替节奏。

           【★根治 GENGZHI-2026-11 / 几何解耦，改动前必读】
           腿可见性 = (脚锚点偏移 foot) + (骨骼长 len) + (强制膝下限 kneeBend) 三者尺度耦合。
           历史反复改坏的根因：脚锚点用 sx*2.8 / 14+sy*3.2 这类"由髋点反推"的隐式公式，
           与骨骼长不自洽 → IK 解出的膝/踝甩出 0~60 画面外（实测 x=-9~69），硬钳制只能按住脚、
           管不了膝踝，于是「按了葫芦起了瓢」，改 N 次坏 N 次。
           本次根治：把"脚锚点"从隐式公式改为每腿【显式字段 foot:[fx,fy]】（相对身体中心 30,24 的偏移），
           与骨骼长一起用工具脚本 tools/verify_spider_legs.js 做几何自检标定，
           保证 6 腿膝/踝/脚在任何呼吸(bob±1.2)/步态(LIFT 9)抖动下都落在画面内区(5~55 / 4~45)且离边界≥5px。
           ⚠ 改 LEGS 的 foot / len / 或 kneeBend 下限后，必须运行：
                node tools/verify_spider_legs.js
              它会把 6 腿逐腿的膝/踝/脚坐标打印并判定 IN/OUT，出现 OUT 即回归，禁止提交。 */
        LEGS: [
            { sx: -10, sy: -4, base: -140, len: [9, 6, 4],  foot: [-24, -14], alt: 1,  phase: 0    },
            { sx: -11, sy: 1,  base: -90,  len: [10, 7, 4], foot: [-26,   2], alt: -1, phase: 0.5  },
            { sx: -10, sy: 6,  base: -40,  len: [9, 6, 4],  foot: [-24,  16], alt: 1,  phase: 0    },
            { sx: 10,  sy: -4, base: -40,  len: [9, 6, 4],  foot: [ 24, -14], alt: -1, phase: 0.5  },
            { sx: 11,  sy: 1,  base: -90,  len: [10, 7, 4], foot: [ 26,   2], alt: 1,  phase: 0    },
            { sx: 10,  sy: 6,  base: -140, len: [9, 6, 4],  foot: [ 24,  16], alt: -1, phase: 0.5  }
        ],
        ensure: function (host) {
            if (!this.el) {
                this.el = document.createElement('div');
                this.el.className = 'zfm-spider';
                this.el.innerHTML =
                    '<div class="zfm-sp-web"></div>' +
                    '<div class="zfm-sp-layer"></div>' +
                    '<div class="zfm-fk-empty">🕸 等待任务…</div>';
                host.appendChild(this.el);
                this.makeDraggable();
            }
            return this.el;
        },
        makeDraggable: function () {
            var el = this.el;
            if (el._zfmDrag) return;
            el._zfmDrag = true;
            var st = { on: false, sx: 0, sy: 0, or: 0, ob: 0, moved: false };
            var getP = function () {
                return { r: parseFloat(el.style.right) || 10, b: parseFloat(el.style.bottom) || 110 };
            };
            var apply = function (r, b) {
                var c = clampStagePos(el, r, b);
                el.style.right = c.r + 'px';
                el.style.bottom = c.b + 'px';
            };
            el.addEventListener('pointerdown', function (e) {
                /* 允许拖身体命中板/腹/头等（腿/阴影 pointer-events:none 点腿穿透，命中板兜底） */
                if (!e.target.closest('.zfm-sp-bot') || e.target.closest('.zfm-sp-leg,.zfm-sp-shadow')) return;
                /* 【Bug3 拖拽卡顿修复】拖拽期间暂停 60ms 步态 IK tick：
                   tick 每帧对 6 腿做三角函数 + layer.getBoundingClientRect，与拖动的
                   容器重排叠加是卡顿主源。暂停后身体靠容器 right/bottom 平移跟手、
                   腿保持上一次 d（静止观感一致），松手即恢复步态。 */
                spider._dragPause = true;
                if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }  /* 【Bug3】清除上次拖拽残留 rAF，防重建 st 后旧回调误用新 st 抖动 */
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false, raf: 0 };
                /* 拖拽跟手：暂停巡游 + 记录实时指针，move 时同步搬走爬虫世界坐标 */
                [].forEach.call(el.querySelectorAll('.zfm-sp-bot'), function (b) {
                    if (b._gait) b._gait._to = null;
                });
                el.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                st.px = e.clientX; st.py = e.clientY;
                /* 【Bug3 卡顿修复·二·rAF 节流】浏览器 pointermove 可达 120Hz+，每次都
                   apply()→clampStagePos→写 right/bottom 触发容器重排，是卡顿主因之一。
                   改为缓存最新指针坐标、每帧最多 apply 一次（rAF），跟手感不变、重排次数减半。 */
                if (st.raf) return;
                st.raf = requestAnimationFrame(function () {
                    st.raf = 0;
                    if (!st.on) return;
                    var z = zOf(el);
                    var dx = (st.px - st.sx) / z, dy = (st.py - st.sy) / z;
                    if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                    if (st.moved) apply(st.or - dx, st.ob - dy);
                });
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { usSet('zfm-spider-pos', p); } catch (e) { }
                }
                spider._dragPause = false;   /* 【Bug3】松手恢复步态 IK tick */
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },
        /* 单只机械六足 SVG（6 条腿各为一条 path，d 全由 JS 步态引擎每 tick 重写；
           聚合状态 st-agg：working/done/fail/idle 决定配色与步频，不跟随单一对话） */
        /* 静态三节腿路径（bob=0 的 IK 解）：创建/首帧即有膝盖高拱的真腿型，
           不再依赖 60ms 步态 tick 首跑——后台标签页/急速降级下也不会退化成一段直线 */
        staticLegPath: function (L) {
            var hx = 30 + L.sx, hy = 24 + L.sy;
            var lx = 30 + L.foot[0], ly = 24 + L.foot[1];
            var vx = lx - hx, vy = ly - hy;
            var d = Math.max(4, Math.hypot(vx, vy));
            var l1 = L.len[0] + L.len[1], l2 = L.len[2] + 2;
            d = Math.min(d, l1 + l2 - 0.5);
            var a1 = Math.atan2(vy, vx);
            var cosK = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
            var kneeBend = Math.max(Math.acos(Math.max(-1, Math.min(1, cosK))), 0.95);
            var aHip = (L.sx < 0) ? (a1 + kneeBend) : (a1 - kneeBend);
            var kx = hx + Math.cos(aHip) * l1, ky = hy + Math.sin(aHip) * l1;
            var rkx = lx - kx, rky = ly - ky, rd = Math.hypot(rkx, rky) || 1;
            var d1x = (kx - hx) / l1, d1y = (ky - hy) / l1, d2x = rkx / rd, d2y = rky / rd;
            var bx = d1x + d2x, by = d1y + d2y, bl = Math.hypot(bx, by) || 1;
            var ax = kx + rkx * 0.62 + (bx / bl) * 2.6, ay = ky + rky * 0.62 + (by / bl) * 2.6;
            return 'M' + hx.toFixed(1) + ' ' + hy.toFixed(1) + ' L' + kx.toFixed(1) + ' ' + ky.toFixed(1)
                + ' L' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' L' + lx.toFixed(1) + ' ' + ly.toFixed(1);
        },
        spiderHtml: function (state) {
            var col = { working: { body: '#16323e', edge: '#5fd8c8' }, done: { body: '#12332b', edge: '#5fe88a' },
                        fail: { body: '#3a201c', edge: '#f07860' }, idle: { body: '#2b3644', edge: '#8fa8bf' } }[state] || { body: '#2b3644', edge: '#8fa8bf' };
            var legs = '';
            for (var L = 0; L < 6; L++) {
                /* 【Bug3 修复】腿 d 原本完全依赖 60ms 步态 tick 写入：tick 首帧前 /
                   页面后台(document.hidden) / turbo 急速降级时，腿 path 无 d → 整只蜘蛛"腿看不到"。
                   创建时用 staticLegPath() 按同一套 IK 算出三节折线（髋-膝-踝-脚）占位，保证首帧即为真腿型；
                   步态引擎一旦运行会立即用 IK 折线（带膝/踝弯曲）覆盖此占位 d。 */
                var _lg = this.LEGS[L];
                var _d0 = this.staticLegPath(_lg);   /* 首帧即三节折线（髋-膝-踝-脚），不再用直线占位 */
                legs += '<path class="zfm-sp-leg" data-leg="' + L + '" d="' + _d0 + '" fill="none" stroke="' + col.edge + '" stroke-width="1.8" stroke-linecap="round"/>';
            }
            var stTxt = { working: '🤖 引擎运转中', done: '✅ 任务完成', fail: '❌ 出现故障', idle: '💤 待机休眠' }[state] || '';
            return '<div class="zfm-sp-bot hex st-' + state + '" data-title="' + esc(stTxt + '　（全对话聚合状态）') + '">'
                + '<svg viewBox="0 0 60 48" width="92" height="72" aria-hidden="true">'
                + '<ellipse class="zfm-sp-shadow" cx="30" cy="45" rx="22" ry="4.5" fill="rgba(0,20,40,.55)"/>'
                + '<rect class="zfm-sp-hit" x="16" y="8" width="30" height="32" fill="transparent"/>'   /* 命中板缩到头/腹身体区，不再盖满整个SVG(原88x72连腿都吞拖拽) */
                + legs
                + '<ellipse class="zfm-sp-abd" cx="30" cy="28" rx="11" ry="8" fill="' + col.body + '" stroke="' + col.edge + '" stroke-width="1.2"/>'
                + '<ellipse class="zfm-sp-abd" cx="30" cy="26.5" rx="7" ry="4.5" fill="none" stroke="' + col.edge + '" stroke-width="0.5" opacity=".55"/>'
                + '<circle class="zfm-sp-head" cx="30" cy="17" r="6" fill="' + col.body + '" stroke="' + col.edge + '" stroke-width="1.2"/>'
                + '<circle class="zfm-sp-eye" cx="27.6" cy="16.4" r="1.3" fill="' + col.edge + '"/>'
                + '<circle class="zfm-sp-eye" cx="32.4" cy="16.4" r="1.3" fill="' + col.edge + '"/>'
                + '<path class="zfm-sp-ant" d="M27 12 L25.5 8.5 M33 12 L34.5 8.5" stroke="' + col.edge + '" stroke-width="1" stroke-linecap="round" fill="none"/>'
                + '</svg></div>';
        },
        render: function (host, chats) {
            var layer = this.ensure(host).querySelector('.zfm-sp-layer');
            var empty = this.ensure(host).querySelector('.zfm-fk-empty');
            empty.style.display = chats.length ? 'none' : '';
            /* 状态聚合：全局一只，任一 working→working；否则任一 fail→fail；否则全 done→done；否则 idle */
            var state = 'idle';
            var n = chats.length, nDone = 0;
            for (var i = 0; i < n; i++) {
                var s = chats[i].state;
                if (s === 'working') { state = 'working'; break; }
                if (s === 'fail') state = 'fail';
                else if (s === 'done') nDone++;
            }
            if (state !== 'working' && n > 0 && nDone === n) state = 'done';
            var key = 'the-one:' + state;
            var old = layer.querySelector('.zfm-sp-bot');
            if (!old) {
                var tmp = document.createElement('div');
                tmp.innerHTML = this.spiderHtml(state);
                layer.appendChild(tmp.firstChild);
            } else if (old.getAttribute('data-key') !== key) {
                /* 状态切换：只换 class + 配色（重建 path 会闪断动画），缓存在 bot._theme */
                old.className = 'zfm-sp-bot hex st-' + state;
                old.setAttribute('data-key', key);
                old.setAttribute('data-title', ({ working: '🤖 引擎运转中', done: '✅ 任务完成', fail: '❌ 出现故障', idle: '💤 待机休眠' }[state] || '') + '　（全对话聚合状态）');
                var col = { working: '#5fd8c8', done: '#5fe88a', fail: '#f07860', idle: '#8fa8bf' }[state] || '#8fa8bf';
                var body = { working: '#16323e', done: '#12332b', fail: '#3a201c', idle: '#2b3644' }[state] || '#2b3644';
                old.querySelector('svg').style.color = col;   /* 步态 tick 里读 color 作描边色 */
                old._hexCol = col;
                [].forEach.call(old.querySelectorAll('.zfm-sp-leg'), function (p) { p.setAttribute('stroke', col); });
                [].forEach.call(old.querySelectorAll('.zfm-sp-abd,.zfm-sp-head'), function (e2) { e2.setAttribute('fill', body); e2.setAttribute('stroke', col); });
                [].forEach.call(old.querySelectorAll('.zfm-sp-eye'), function (e2) { e2.setAttribute('fill', col); });
            }
            this.patrol(layer);
            this.startGait();
            this.startGlow();
            this.startComboFx();
            return false;
        },
        /* ---------- 巡游目标：随机游走；working 时主动爬向某段消息文字 ---------- */
        patrol: function (layer) {
            var now = Date.now();
            var bot = layer.querySelector('.zfm-sp-bot');
            if (!bot) return;
            if (!bot._nextGo) bot._nextGo = now + Math.random() * 3000;
            if (now < bot._nextGo || bot._gait && bot._gait._to) return;
            var working = bot.classList.contains('st-working');
            bot._nextGo = now + (working ? 1600 + Math.random() * 1800 : 3600 + Math.random() * 5200);
            if (!working && Math.random() < 0.15) return;   /* 全屏随机游走，偶尔(15%)原地休眠——原>0.85写成85%概率不动，爬虫几乎不走 */
            var lr = layer.getBoundingClientRect(), tx = null, ty = null;
            if (working) {   /* 疾走时优先爬向一段消息文字（腿才踩得到字） */
                var texts = document.querySelectorAll('.msg-text');
                if (texts.length) {
                    var el = texts[Math.floor(Math.random() * texts.length)];
                    var r = el.getBoundingClientRect();
                    if (r.width > 8 && r.bottom > 0 && r.top < innerHeight) {
                        tx = r.left + r.width * (0.15 + Math.random() * 0.7) - lr.left;  /* 视口系→图层系：此处目标点计算需减图层偏移；与腿部 path 绘制（图层系，勿再减）不同 */
                        ty = r.top + r.height * (0.25 + Math.random() * 0.55) - lr.top;
                    }
                }
            }
            if (tx == null) { tx = lr.width * (0.12 + Math.random() * 0.72); ty = lr.height * (0.14 + Math.random() * 0.62); }
            if (!bot._gait) bot._gait = {};
            bot._gait._to = { x: Math.max(20, Math.min(lr.width - 20, tx)), y: Math.max(20, Math.min(lr.height - 20, ty)) };
        },
        /* ---------- IK 步态引擎：60ms tick，逐帧 JS 插值（替代 CSS transition 巡游） ----------
           【定点 IK】每条腿的脚有世界坐标锚点 foot.x/y；身体移动时脚钉在原地，
           2 节骨骼用余弦定理解 IK——髋角朝脚方向，膝关节按 law of cosines 弯曲，
           腿被身体"拉"着自动弯曲，实现"停留在原地"。
           【排队步态】脚与默认落点超距 STRIDE 触发入队；全局步态队列一次只放行
           1 条腿悬空，迈步沿弧线插值到新锚点再落定放行下一条——"一个跟着一个走"。 */
        startGait: function () {
            if (this.legTimer) return;
            var self = this;
            var STRIDE = 34, STEP_MS = 170, LIFT = 9;   /* 触发距离/迈步时长/抬脚高 */
            this.legTimer = setInterval(function () {
                if (!self.el || document.hidden) return;
                if (document.documentElement.classList.contains('turbo')) return;  /* 急速降级 */
                /* 【Bug3 拖拽卡顿修复】拖拽期间跳过整段 IK/重排，腿保持上次 d，身体随容器平移跟手 */
                if (self._dragPause) return;
                var layer = self.el.querySelector('.zfm-sp-layer');
                if (!layer) return;
                var now = Date.now();
                [].forEach.call(layer.children, function (bot) {
                    var g = bot._gait || (bot._gait = { x: null, y: null, queue: [], stepping: null, breath: Math.random() * 99 });
                    /* 身体 JS 逐帧插值移动（弃 CSS transition） */
                    var lr = layer.getBoundingClientRect();
                    if (g.x == null) { g.x = lr.width / 2; g.y = lr.height / 2; }
                    var moving = false;
                    if (g._to) {
                        var dx = g._to.x - g.x, dy = g._to.y - g.y, dist = Math.hypot(dx, dy);
                        var spd = (g.stepping ? 1.1 : 2.6) * 2;   /* 脚速x2 (动感升级A1) */   /* 悬空腿多时自动减速（排队感） */
                        if (dist < spd) { g.x = g._to.x; g.y = g._to.y; g._to = null; }
                        else { g.x += dx / dist * spd; g.y += dy / dist * spd; moving = true; }
                    }
                    bot.style.left = g.x + 'px'; bot.style.top = g.y + 'px';
                    /* 尺寸缩放变化时不重置脚列表（防静止时六脚瞬间聚拢消失），仅缩放既有锚点 */
                    if (!g.feet || g.feet._lrW !== lr.width || g.feet._lrH !== lr.height) {
                        var kx = g.feet ? lr.width / g.feet._lrW : 1, ky = g.feet ? lr.height / g.feet._lrH : 1;
                        g.feet = g.feet || { _lrW: 0, _lrH: 0, list: [] };
                        g.feet._lrW = lr.width; g.feet._lrH = lr.height;
                        if (!g.feet.list.length) {
                            g.feet.list = self.LEGS.map(function (L) {
                                /* 脚锚点 = 身体位置 + 该腿显式偏移 foot（与骨骼长标定自洽，见 LEGS 注释） */
                                return { def: { x: g.x + L.foot[0], y: g.y + L.foot[1] }, x: 0, y: 0 };
                            });
                        }
                        g.feet.list.forEach(function (f) { f.x *= kx; f.y *= ky; });
                        g.queue = []; g.stepping = null;
                    }
                    /* 每帧重算默认落点：def 跟随身体（身体动，脚钉原地→超距→排队迈步跟上） */
                    /* 每帧默认落点 def 跟随身体（显式 foot 偏移，无屏幕宽度放大、无隐式 sx 反推）。
                       GENGZHI-2026-11 根治：脚锚点与骨骼长解耦标定，几何自检见 tools/verify_spider_legs.js。 */
                    g.feet.list.forEach(function (f, i) {
                        var L = self.LEGS[i];
                        f.def.x = g.x + L.foot[0];
                        f.def.y = g.y + L.foot[1];
                    });
                    /* 静止时也允许补步：脚被缩放/漂移带偏超距就归位（否则脚永远错位） */
                    if (!g.stepping && g.queue.length < 2) {
                        var far = -1, fd = 0;
                        g.feet.list.forEach(function (f, i) {
                            if (g.queue.indexOf(i) >= 0) return;
                            var d = Math.hypot(f.def.x - f.x, f.def.y - f.y);
                            if (d > STRIDE && d > fd) { fd = d; far = i; }
                        });
                        if (far >= 0) {
                            var f2 = g.feet.list[far];
                            g.stepping = { leg: far, from: { x: f2.x, y: f2.y }, to: { x: f2.def.x, y: f2.def.y }, t0: now };
                        }
                    }
                    /* 迈步弧线插值：抛物线抬脚 LIFT，STEP_MS 落定 */
                    if (g.stepping) {
                        var s = g.stepping, k = Math.min(1, (now - s.t0) / STEP_MS), e = k * k * (3 - 2 * k);
                        var f = g.feet.list[s.leg];
                        f.x = s.from.x + (s.to.x - s.from.x) * e;
                        f.y = s.from.y + (s.to.y - s.from.y) * e - Math.sin(k * Math.PI) * LIFT;
                        if (k >= 1) { f.x = s.to.x; f.y = s.to.y; g.stepping = null; }
                    }
                    /* 静止呼吸：身体微沉浮（脚不动，IK 自动微弯——机械待机感） */
                    g.breath += 0.05;
                    var bob = moving ? 0 : Math.sin(g.breath) * 1.2;
                    var cx = g.x, cy = g.y + bob;
                    /* 绘制：世界锚点 → 腿局部坐标 → 2 节 IK 解算 → 写 path */
                    [].forEach.call(bot.querySelectorAll('.zfm-sp-leg'), function (path) {
                        var i = parseInt(path.getAttribute('data-leg'), 10);
                        var L = self.LEGS[i], f = g.feet.list[i];
                        /* 世界 → svg 局部（svg 68x54，中心即身体 cx,cy） */
                        var lx = f.x - cx + 30;   /* 脚相对身体偏移+中心30（f.x 本就是图层坐标，勿再减 lr.left） */
                        var ly = (f.y - cy) + 24; /* safety clamp: hard-clip toe into viewBox, immune to future bone/anchor edits */ lx=Math.max(4,Math.min(56,lx)); ly=Math.max(4,Math.min(44,ly));
                        /* 2 节 IK（余弦定理）：髋在 (30+L.sx, 24+L.sy)，目标 (lx,ly) */
                        var hx = 30 + L.sx, hy = 24 + L.sy;
                        var vx = lx - hx, vy = ly - hy;
                        var d = Math.hypot(vx, vy);
                        var l1 = L.len[0] + L.len[1], l2 = L.len[2] + 2;   /* 大腿=前两节和，小腿=末节+脚 */
                        d = Math.max(4, Math.min(d, l1 + l2 - 0.5));
                        var a1 = Math.atan2(vy, vx);
                        var cosK = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
                        var kneeBend = Math.acos(Math.max(-1, Math.min(1, cosK)));
                        /* 山峰式拱腿（模仿手绘山峰折线）：强制膝部高拱下限 0.95rad，
                           脚再远膝也不压平——先陡升到尖峰、再陡降落地的蜘蛛腿剪影；
                           左右镜像：膝部始终向"上方"拱起（左腿 +bend / 右腿 -bend），两侧方向相反 */
                        kneeBend = Math.max(kneeBend, 0.95);
                        var aHip = (L.sx < 0) ? (a1 + kneeBend) : (a1 - kneeBend);
                        var kx = hx + Math.cos(aHip) * l1, ky = hy + Math.sin(aHip) * l1;
                        /* 3 节腿型（大腿/胫节/跗节）：踝点沿膝→脚 0.62 处，
                           「膝→踝」方向取「髋→膝」与「膝→脚」的角平分线——
                           中间节弯曲度自动居中于两段夹角，形成高膝-折踝的真蜘蛛腿剪影 */
                        var rkx = lx - kx, rky = ly - ky;
                        var rd = Math.hypot(rkx, rky) || 1;
                        var ankleT = 0.62;
                        /* 角平分线：d1=髋→膝 单位向量，d2=膝→脚 单位向量，和向量即内角平分线 */
                        var d1x = (kx - hx) / (L.len[0] + L.len[1]), d1y = (ky - hy) / (L.len[0] + L.len[1]);
                        var d2x = rkx / rd, d2y = rky / rd;
                        var bx = d1x + d2x, by = d1y + d2y;
                        var bl = Math.hypot(bx, by) || 1;
                        bx /= bl; by /= bl;
                        var ax = kx + rkx * ankleT + bx * 2.6, ay = ky + rky * ankleT + by * 2.6;
                        path.setAttribute('d', 'M' + hx.toFixed(1) + ' ' + hy.toFixed(1)
                            + ' L' + kx.toFixed(1) + ' ' + ky.toFixed(1)
                            + ' L' + ax.toFixed(1) + ' ' + ay.toFixed(1)
                            + ' L' + lx.toFixed(1) + ' ' + ly.toFixed(1));
                        if (!path._joint) {
                            path._joint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                            path._joint.setAttribute('r', '1.4');
                            path._joint.setAttribute('opacity', '.9');
                            path.parentNode.appendChild(path._joint);
                        }
                        path._joint.setAttribute('cx', kx.toFixed(1));
                        path._joint.setAttribute('cy', ky.toFixed(1));
                        path._joint.setAttribute('fill', path.getAttribute('stroke'));
                        if (!path._jointHi) {
                            path._jointHi = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                            path._jointHi.setAttribute('r', '0.55');
                            path._jointHi.setAttribute('fill', '#ffffff');
                            path._jointHi.setAttribute('opacity', '.85');
                            path.parentNode.appendChild(path._jointHi);
                        }
                        path._joint.setAttribute('r', moving ? '1.9' : '1.4');
                        path._jointHi.setAttribute('cx', (kx - 0.4).toFixed(1));
                        path._jointHi.setAttribute('cy', (ky - 0.4).toFixed(1));
                        if (!path._joint2) {
                            path._joint2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                            path._joint2.setAttribute('r', '1.1');
                            path._joint2.setAttribute('opacity', '.8');
                            path.parentNode.appendChild(path._joint2);
                        }
                        path._joint2.setAttribute('cx', ax.toFixed(1));
                        path._joint2.setAttribute('cy', ay.toFixed(1));
                        path._joint2.setAttribute('fill', path.getAttribute('stroke'));
                    });
                });
            }, 60);
        },
        /* ---------- 踩字变色：腿尖踩到哪个字，哪个字变粗变色（屏幕坐标系命中）；离开后淡出恢复 ----------
           首次接触时把 .msg-text 纯文本节点拆成逐字 span（跳过链接/代码块，防 XSS
           只用 createTextNode）；命中字加 .zf-char-lit + 时间戳，300ms 无腿触碰即移除恢复。 */
        _splitChars: function (el) {
            if (el._zfChars) return el._zfChars;
            var chars = [];
            function walk(n) {
                [].forEach.call(n.childNodes, function (c) {
                    if (c.nodeType === 3) {   /* 纯文本节点 */
                        var frag = document.createDocumentFragment(), txt = c.nodeValue;
                        for (var i = 0; i < txt.length; i++) {
                            var s = document.createElement('span');
                            s.className = 'zf-char';
                            s.textContent = txt[i];
                            frag.appendChild(s); chars.push(s);
                        }
                        n.replaceChild(frag, c);
                    } else if (c.nodeType === 1 && !c.closest('a,code,pre,script,style')) walk(c);
                });
            }
            walk(el);
            el._zfChars = chars;
            return chars;
        },

        startComboFx: function () {
            if (this._comboHooked) return;
            this._comboHooked = true;
            var self = this;
            window.addEventListener('zf-combo-hit', function () {
                if (!self.el || document.hidden) return;
                if (document.documentElement.classList.contains('turbo')) return;
                var bot = self.el.querySelector('.zfm-sp-bot');
                var layer = self.el.querySelector('.zfm-sp-layer');
                if (!bot || !layer) return;
                var now = Date.now();
                if (now < (self._comboCd || 0)) return;
                self._comboCd = now + 300;
                var gx = parseFloat(bot.style.left) || 0, gy = parseFloat(bot.style.top) || 0;
                var ang = Math.random() * Math.PI * 2, dd = 20 + Math.random() * 6;
                var dx = Math.cos(ang) * dd, dy = Math.sin(ang) * dd * 0.6;
                var svg = bot.querySelector('svg');
                if (svg) for (var gi = 0; gi < 3; gi++) {
                    var gh = document.createElement('div');
                    gh.className = 'zfm-sp-ghost';
                    gh.style.cssText = 'left:' + gx + 'px;top:' + gy + 'px;width:' + bot.offsetWidth + 'px;height:' + bot.offsetHeight + 'px;opacity:' + (0.5 - gi * 0.14) + ';';
                    gh.innerHTML = '<svg viewBox="0 0 68 54" width="68" height="54" style="color:' + '#5fd8c8' + '">' + svg.innerHTML + '</svg>';
                    layer.appendChild(gh);
                    (function (g2, i2) {
                        requestAnimationFrame(function () {
                            g2.style.opacity = '0';
                            g2.style.transform = 'translate(' + (dx * (0.3 + i2 * 0.25)) + 'px,' + (dy * (0.3 + i2 * 0.25)) + 'px) scale(' + (0.96 - i2 * 0.04) + ')';
                        });
                        setTimeout(function () { g2.remove(); }, 380);
                    })(gh, gi);
                }
                bot.classList.add('zfm-sp-dodge');
                bot.style.left = (gx + dx) + 'px';
                bot.style.top = (gy + dy) + 'px';
                setTimeout(function () { bot.classList.remove('zfm-sp-dodge'); }, 140);
                var L = self.LEGS ? self.LEGS[Math.floor(Math.random() * self.LEGS.length)] : null;
                var bx = gx + (L ? L.foot[0] : 34), by = gy + (L ? L.foot[1] : 50);
                var boom = document.createElement('div');
                boom.className = 'zfm-sp-boom';
                boom.style.left = bx + 'px';
                boom.style.top = by + 'px';
                var nums = ['暴击!', 'CRIT!', '\u00d72', '会心!', '连斩!'];
                var html = '<div class="boom-ring"></div><span class="boom-btn">' + nums[Math.floor(Math.random() * nums.length)] + '</span>';
                for (var pi = 0; pi < 10; pi++) {
                    var a2 = pi / 10 * Math.PI * 2 + Math.random() * 0.5;
                    var r2 = 12 + Math.random() * 14;
                    html += '<i class="boom-p" style="--px:' + (Math.cos(a2) * r2).toFixed(1) + 'px;--py:' + (Math.sin(a2) * r2 - 6).toFixed(1) + 'px"></i>';
                }
                boom.innerHTML = html;
                layer.appendChild(boom);
                setTimeout(function () { boom.classList.add('boom-go'); }, 450);
                setTimeout(function () { boom.remove(); }, 1000);
            });
        },

        startGlow: function () {
            if (this.glowTimer) return;
            var self = this;
            var touchedAt = new WeakMap();   /* span -> 最后被踩到的时间戳 */
            this.glowTimer = setInterval(function () {
                if (document.hidden || document.documentElement.classList.contains('turbo')) return;
                var layer = document.querySelector('.zfm-sp-layer');
                if (!layer) return;
                var now = Date.now();
                /* 超时未再被踩到的字：移除高亮，淡出恢复原样 */
                [].forEach.call(document.querySelectorAll('.zf-char-lit'), function (s) {
                    var t = touchedAt.get(s);
                    if (t == null || now - t > 300) {
                        s.classList.remove('zf-char-lit');
                        touchedAt.delete(s);
                    }
                });
                [].forEach.call(layer.querySelectorAll('.zfm-sp-bot'), function (bot) {
                    [].forEach.call(bot.querySelectorAll('.zfm-sp-leg'), function (path) {
                        try {
                            if (!path.getTotalLength) return;
                            var p = path.getPointAtLength(path.getTotalLength());
                            var m = path.ownerSVGElement.getScreenCTM();
                            if (!m) return;
                            var sx = m.a * p.x + m.c * p.y + m.e;
                            var sy = m.b * p.x + m.d * p.y + m.f;
                            var els = document.elementsFromPoint(sx, sy) || [];
                            for (var i = 0; i < Math.min(els.length, 4); i++) {
                                var t = els[i] && els[i].closest && els[i].closest('.msg-text');
                                if (!t) continue;
                                var chars = self._splitChars(t);
                                for (var j = 0; j < chars.length; j++) {
                                    var s = chars[j];
                                    var r = s.getBoundingClientRect();   /* 命中测试（rect 缓存收益小，直接取） */
                                    if (r.width && sx >= r.left - 2 && sx <= r.right + 2 && sy >= r.top - 2 && sy <= r.bottom + 2) {
                                        /* 命中字：踩到瞬间变热斑，持续踩着保持高亮 */
                                        s.classList.add('zf-char-lit');
                                        touchedAt.set(s, now);
                                        s.classList.add('zf-char-lit-hot');
                                        setTimeout(function (el) { el.classList.remove('zf-char-lit-hot'); }, 300, s);
                                        break;
                                    }
                                }
                            }
                        } catch (e) {}
                    });
                });
            }, 150);
        },
        clearAllGlow: function () {
            /* 离开/销毁时全部恢复原样 */
            [].forEach.call(document.querySelectorAll('.zf-char-lit,.zf-char-lit-hot'), function (s) {
                s.classList.remove('zf-char-lit', 'zf-char-lit-hot');
            });
        },
        destroy: function () {
            if (this.legTimer) { clearInterval(this.legTimer); this.legTimer = null; }
            if (this.glowTimer) { clearInterval(this.glowTimer); this.glowTimer = null; }
            this.clearAllGlow();
            if (this.el) { this.el.remove(); this.el = null; }
        }
    };

    /* =====================================================================
       渲染器五：种田模式 🌾（星露谷风）
       谷仓(种子库存+收成架) + 4×3 田块网格。
       玩法闭环：对话完成→种子+1｜谷仓拖种子→空田播种｜工具调用→浇水促生长
       田块状态：empty→sprout(浇水)→grown→mature(闪光可收) / wither(枯萎)
       持久化：zf_farm_seeds(库存) + zf_farm_state(12 块田) —— 刷新不丢
       ===================================================================== */
    var farm = {
        el: null, sig: '', seeds: 0, fields: [], crops: [], tool: null,
        CROPS: [
            { icon: '🥕', name: '胡萝卜', price: 8,  stages: ['🌱', '🌿', '🥬', '🥕'] },
            { icon: '🌽', name: '玉米',   price: 10, stages: ['🌱', '🌿', '🌾', '🌽'] },
            { icon: '🍅', name: '番茄',   price: 12, stages: ['🌱', '🌿', '🌼', '🍅'] },
            { icon: '🍆', name: '茄子',   price: 12, stages: ['🌱', '🌿', '🪴', '🍆'] },
            { icon: '🎃', name: '南瓜',   price: 25, stages: ['🌱', '🌿', '🍃', '🎃'] }   /* 稀有 */
        ],
        /* 工具栏：默认地面是乱石+草，按工具逐步开垦 */
        TOOLS: [
            { k: 'sickle',  ico: '🔪', name: '镰刀·除草（点草地块）' },
            { k: 'axe',     ico: '🪓', name: '斧子·碎石（点石块地）' },
            { k: 'seed',    ico: '🌾', name: '种子·播种（拖种子到空地，或点我后点空地）' },
            { k: 'water',   ico: '💧', name: '水壶·浇水（点作物浇水促生长）' },
            { k: 'harvest', ico: '🧺', name: '收割（点成熟果实收获进收成架）' }
        ],
        WATER_PER_STAGE: 20,  /* 每阶段需浇水 20 次（工具调用），sprout→grown→mature 共 40 次（比 v1 慢 10 倍） */
        stats: { harvest: 0, coins: 0, sold: 0 },
        STATS_KEY: 'zf_farm_stats',
        loadStats: function () {
            try { var s = JSON.parse(localStorage.getItem(this.STATS_KEY) || 'null'); if (s) this.stats = s; } catch (e) {}
        },
        saveStats: function () {
            try { localStorage.setItem(this.STATS_KEY, JSON.stringify(this.stats)); } catch (e) {}
            this.updateTopStats();
        },
        /* 右上角长期统计角标已按要求移除（2026-10-10） */
        updateTopStats: function () {
            var el = document.getElementById('zfFarmCoinBadge');
            if (el && el.parentNode) el.parentNode.removeChild(el);
        },
        load: function () {
            this.loadStats();
            try { this.seeds = Math.min(SEED_CAP, parseInt(localStorage.getItem(SEED_KEY)) || 0); } catch (e) { this.seeds = 0; }
            try {
                var s = JSON.parse(localStorage.getItem(FARM_STATE_KEY) || 'null');
                this.fields = (s && Array.isArray(s.fields)) ? s.fields : [];
                this.crops = (s && Array.isArray(s.crops)) ? s.crops : [];
            } catch (e) { this.fields = []; this.crops = []; }
            while (this.fields.length < MAX_FARM) this.fields.push({ st: 'empty', crop: -1 });
            /* 默认地面：乱石头 + 草（首次初始化），需要除草/碎石后才得到空地 */
            var virgin = this.fields.every(function (f) { return !f.st || f.st === 'empty' && !f.crop; }) && !localStorage.getItem('zf_farm_ground_init');
            if (virgin && !this.fields.some(function (f) { return f.st === 'grass' || f.st === 'rock'; }) && !localStorage.getItem('zf_farm_ground_init')) {
                for (var g = 0; g < this.fields.length; g++) this.fields[g] = { st: (g % 3 === 2) ? 'rock' : 'grass', crop: -1 };
                try { localStorage.setItem('zf_farm_ground_init', '1'); } catch (e) {}
            }
            this.updateTopStats();   /* 清除历史残留统计角标 */
        },
        save: function () {
            try {
                localStorage.setItem(SEED_KEY, String(this.seeds));
                localStorage.setItem(FARM_STATE_KEY, JSON.stringify({ fields: this.fields, crops: this.crops }));
            } catch (e) {}
        },
        ensure: function (host) {
            if (!this.el) {
                this.load();
                this.el = document.createElement('div');
                this.el.className = 'zfm-farm';
                var html =
                    '<div class="zfm-fm-barn">'
                    + '<div class="zfm-fm-roof-coin" title="总金币（累计卖出）">💰<b>0</b></div>'
                    + '<div class="zfm-fm-bin" title="回收箱：点击把收成果实卖掉换金币"><i class="zfm-fm-bin-lid"></i><span class="zfm-fm-bin-ico">♻️</span></div>'
                    + '<div class="zfm-fm-barn-roof"></div><div class="zfm-fm-barn-body"></div>'
                    + '<div class="zfm-fm-window"></div>'
                    /* 【改】谷仓上的种子图标已移除（左上角工具栏已有种子工具） */
                    + '<div class="zfm-fm-crops" title="收成架"></div>'
                    + '</div>'
                    + '<div class="zfm-fm-tools"></div>'
                    + '<div class="zfm-fm-grid">';
                for (var i = 0; i < MAX_FARM; i++) {
                    html += '<div class="zfm-fm-plot" data-i="' + i + '" title=""></div>';
                }
                html += '</div><div class="zfm-fm-sign">草→除草 石→碎石 空→播种 水壶促生长</div>';
                this.el.innerHTML = html;
                host.appendChild(this.el);
                this.bindTools();
                this.makeDraggable();
                this.bindEconomy();
            }
            return this.el;
        },
        /* 整体拖拽：与鱼缸同款（right/bottom + zoom 钳制 + 独立记忆） */
        makeDraggable: function () {
            var el = this.el;
            if (el._zfmDrag) return;
            el._zfmDrag = true;
            var st = { on: false, sx: 0, sy: 0, or: 0, ob: 0, moved: false };
            var getP = function () {
                return { r: parseFloat(el.style.right) || 10, b: parseFloat(el.style.bottom) || 110 };
            };
            var apply = function (r, b) {
                var c = clampStagePos(el, r, b);
                el.style.right = c.r + 'px';
                el.style.bottom = c.b + 'px';
            };
            el.addEventListener('pointerdown', function (e) {
                if (e.target.closest('.zfm-fm-plot, .zfm-fm-seed, .zfm-fm-bin, .zfm-fm-tool, .zfm-fm-roof-coin')) return;   /* 田块/种子/回收箱/工具/金币参与交互，不拖拽 */
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false };
                el.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                var z = zOf(el);
                var dx = (e.clientX - st.sx) / z, dy = (e.clientY - st.sy) / z;
                if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                if (st.moved) { apply(st.or - dx, st.ob - dy); el._zfmMoved = true; }
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { usSet('zfm-farm-pos', p); } catch (e) {}
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },
        /* ---------- 工具栏：除草→碎石→播种→浇水→收割 五步开垦链 ---------- */
        bindTools: function () {
            var self = this, el = this.el;
            var bar = el.querySelector('.zfm-fm-tools');
            this.TOOLS.forEach(function (t) {
                var b = document.createElement('div');
                b.className = 'zfm-fm-tool';
                b.setAttribute('data-tool', t.k);
                b.textContent = t.ico;
                /* 【改】种子工具叠加库存角标（谷仓上的旧种子图标已删除） */
                if (t.k === 'seed') { var nEl = document.createElement('b'); nEl.className = 'zfm-fm-seed-n'; nEl.textContent = self.seeds; b.appendChild(nEl); }
                b.title = t.name;
                /* 【v4】左键拖拽使用：按住工具图标直接拖到田块上松手即可生效（点击激活方式保留） */
                b.style.touchAction = 'none';
                b.addEventListener('pointerdown', function (e) {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    var sx = e.clientX, sy = e.clientY, dragging = false, ghost = null, lastI = -1;
                    /* 【v6】在单个地块上执行工具动作；sweep=true 时为批量扫过，无效目标静默跳过 */
                    var useOnPlot = function (i, sweep) {
                        if (isNaN(i) || !self.el || !self.fields[i]) return;
                        var prevTool = self.tool;
                        self.tool = t.k;
                        var done = false;
                        if (t.k === 'seed' && self.fields[i].st === 'empty' && self.seeds <= 0) {
                            if (!sweep) self.pop(i, '没有种子了，等对话完成可得种子 🌾');
                        }
                        else if (t.k === 'water' && (self.fields[i].st === 'sprout' || self.fields[i].st === 'grown')) { self.waterPlot(i); done = true; }
                        else if (t.k === 'harvest' && self.fields[i].st === 'mature') { self.harvest(i); done = true; }
                        else if (t.k === 'seed' && self.fields[i].st === 'empty' && self.seeds > 0) { self.sow(i); done = true; }
                        else if ((t.k === 'sickle' && self.fields[i].st === 'grass') || (t.k === 'axe' && self.fields[i].st === 'rock')) { done = self.applyTool(i); }
                        else if (!sweep) { self.applyTool(i); }   /* 不匹配也走一次，吃 v3 的无效提示动画 */
                        self.tool = prevTool;
                        if (done) { self.save(); self.render(self.el.parentNode, collectChats()); }
                    };
                    var move = function (ev) {
                        if (!dragging && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
                        if (!dragging) {
                            dragging = true;
                            ghost = document.createElement('div');
                            ghost.className = 'zfm-fm-tool-ghost';
                            ghost.textContent = t.ico;
                            document.body.appendChild(ghost);
                        }
                        ghost.style.left = ev.clientX + 'px';
                        ghost.style.top = ev.clientY + 'px';
                        /* 【v6】批量扫过：按住不松，鼠标经过的每个地块各执行一次 */
                        var tgt = document.elementFromPoint(ev.clientX, ev.clientY);
                        var plot = tgt && tgt.closest ? tgt.closest('.zfm-fm-plot') : null;
                        if (plot) {
                            var pi = parseInt(plot.getAttribute('data-i'));
                            if (pi !== lastI) { lastI = pi; useOnPlot(pi, true); }
                        }
                    };
                    var up = function (ev, cancelled) {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                        window.removeEventListener('pointercancel', upc);
                        /* 【v5】pointercancel 无有效坐标，直接丢弃防 (0,0) 误命中左上角田块 */
                        if (cancelled) { if (ghost && ghost.parentNode) ghost.remove(); dragging = false; return; }
                        /* 【v5】拖拽松手：跳过紧随的 click，防止拖完工具被误激活 */
                        if (dragging) {
                            b._zfmJustDragged = true;
                            setTimeout(function () { b._zfmJustDragged = false; }, 0);
                        }
                        if (!dragging) return;   /* 未移动：交给 click 走激活逻辑 */
                        if (ghost && ghost.parentNode) ghost.remove();
                        if (!self.el) return;
                        var tgt = document.elementFromPoint(ev.clientX, ev.clientY);
                        var plot = tgt && tgt.closest ? tgt.closest('.zfm-fm-plot') : null;
                        if (!plot) return;
                        var i = parseInt(plot.getAttribute('data-i'));
                        /* 【v6】松手落点若已在批量扫过中执行过，则不重复 */
                        if (i !== lastI) useOnPlot(i, false);
                    };
                    var upc = function (ev) { up(ev, true); };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                    window.addEventListener('pointercancel', upc);
                });
                b.addEventListener('click', function (e) {
                    e.stopPropagation();
                    /* 【v5】刚完成拖拽松手：跳过本次 click，防止拖拽误触发激活 */
                    if (b._zfmJustDragged) return;
                    self.tool = (self.tool === t.k) ? null : t.k;
                    [].forEach.call(bar.querySelectorAll('.zfm-fm-tool'), function (x) {
                        x.classList.toggle('zfm-fm-tool-on', x.getAttribute('data-tool') === self.tool);
                    });
                    if (self.tool === 'seed') { el._zfmSeedPick = !!self.seeds; el.classList.toggle('zfm-fm-dragging', el._zfmSeedPick); }
                    /* 【v2】工具光标：选中工具后田地区域鼠标变该工具 */
                    if (self.tool) el.setAttribute('data-cursor', self.tool); else el.removeAttribute('data-cursor');
                });
                bar.appendChild(b);
            });
        },
        /* 田块工具操作：默认地块 = grass(带草) / rock(乱石头)，除草→草地变空地，碎石→石地变空地 */
        applyTool: function (i) {
            var f = this.fields[i];
            if (!f) return false;
            var self = this;
            /* 【v3】工具命中动画：地块砸击抖动 + 工具栏图标挥动；工具与地块不匹配时给提示 */
            var fx = function (txt, no) {
                var plot = self.el && self.el.querySelector('.zfm-fm-plot[data-i="' + i + '"]');
                if (plot) {
                    plot.classList.remove('zfm-fm-hit', 'zfm-fm-hit-no');
                    void plot.offsetWidth;
                    plot.classList.add(no ? 'zfm-fm-hit-no' : 'zfm-fm-hit');
                    setTimeout(function () { plot.classList.remove('zfm-fm-hit', 'zfm-fm-hit-no'); }, 450);
                }
                if (self.el) {
                    var bt = self.el.querySelector('.zfm-fm-tool[data-tool="' + self.tool + '"]');
                    if (bt) {
                        bt.classList.remove('zfm-fm-swing');
                        void bt.offsetWidth;
                        bt.classList.add('zfm-fm-swing');
                        setTimeout(function () { bt.classList.remove('zfm-fm-swing'); }, 450);
                    }
                }
                if (txt) self.pop(i, txt);
            };
            if (this.tool === 'sickle') {
                if (f.st === 'grass') { this.fields[i] = { st: 'empty', crop: -1 }; fx('🔪 除草！'); return true; }
                fx('这里没有草', 1); return false;
            }
            if (this.tool === 'axe') {
                if (f.st === 'rock') { this.fields[i] = { st: 'empty', crop: -1 }; fx('🪓 砸碎！'); return true; }
                fx('这里没有石头', 1); return false;
            }
            if (this.tool === 'water' && (f.st === 'sprout' || f.st === 'grown')) { this.waterPlot(i); return false; }
            if (this.tool === 'harvest' && f.st === 'mature') { this.harvest(i); return false; }
            if (f.st === 'empty' && this.seeds > 0 && (this.tool === 'seed' || this.el._zfmSeedPick)) { this.sow(i); return false; }
            return false;
        },
        pop: function (i, text) {
            var el = this.el;
            if (!el) return;
            var plot = el.querySelector('.zfm-fm-plot[data-i="' + i + '"]');
            if (!plot) return;
            var pop = document.createElement('div');
            pop.className = 'zfm-fm-pop';
            pop.textContent = text;
            plot.appendChild(pop);
            setTimeout(function () { if (pop.parentNode) pop.remove(); }, 1500);
        },
        waterPlot: function (i) {
            var f = this.fields[i];
            if (!f) return;
            f.wc = (f.wc || 0) + 1;
            var advanced = false;
            if (f.wc >= this.WATER_PER_STAGE) { f.wc = 0; f.st = f.st === 'sprout' ? 'grown' : 'mature'; advanced = true; }
            if (advanced) { this.save(); }
            var el = this.el;
            if (el) {
                var plot = el.querySelector('.zfm-fm-plot[data-i="' + i + '"]');
                if (plot) {
                    var d = document.createElement('div');
                    d.className = 'zfm-fm-water';
                    plot.appendChild(d);
                    setTimeout(function () { if (d.parentNode) d.remove(); }, 1200);
                    /* 【v2】浇水后耕地变色（湿润深棕，8s 后晾干回原色） */
                    plot.classList.add('zfm-fm-wet');
                    clearTimeout(plot._zfmWetT);
                    plot._zfmWetT = setTimeout(function () { plot.classList.remove('zfm-fm-wet'); }, 8000);
                }
            }
            if (advanced) this.render(el.parentNode, collectChats());
        },
        /* ---------- 种子经济交互：拖拽播种 + 两击降级 + 点击收获/枯萎 ---------- */
        bindEconomy: function () {
            var self = this, el = this.el;
            var drag = null;   /* {pointerId, ghost} */
            /* 时间自然产出定时器：每 15s 检查一次挂钟，到点补种子（regenTick 内部按 900s 门槛结算） */
            if (!this._regenTimer) {
                this._regenTimer = setInterval(function () {
                    if (document.hidden || !self.el) return;
                    self.regenTick();
                }, 15 * 1000);
            }
            /* 种子拖拽（pointer 自实现，触屏可用；桌面也可两击降级）——现挂在工具栏种子图标上 */
            var seedEl = el.querySelector('.zfm-fm-tool[data-tool="seed"]');
            if (!seedEl) return;
            seedEl.addEventListener('pointerdown', function (e) {
                if (self.seeds <= 0) return;
                e.stopPropagation();
                drag = { id: e.pointerId, pid: null };
                try { seedEl.setPointerCapture(e.pointerId); } catch (err) {}
                el.classList.add('zfm-fm-dragging');   /* 高亮空田 */
            });
            seedEl.addEventListener('pointermove', function (e) {
                if (!drag || e.pointerId !== drag.id) return;
                /* 拖影 + 命中检测 */
                var t = document.elementFromPoint(e.clientX, e.clientY);
                var plot = t && t.closest ? t.closest('.zfm-fm-plot') : null;
                [].forEach.call(el.querySelectorAll('.zfm-fm-plot'), function (p) { p.classList.remove('zfm-fm-hover'); });
                if (plot) {
                    var i = parseInt(plot.getAttribute('data-i'));
                    if (self.fields[i] && self.fields[i].st === 'empty') plot.classList.add('zfm-fm-hover');
                }
                drag.pid = plot;
                /* 【v6】批量播种：按住不松，扫过的每块空地各播一粒 */
                if (plot && self.seeds > 0) {
                    var pi = parseInt(plot.getAttribute('data-i'));
                    if (self.fields[pi] && self.fields[pi].st === 'empty' && pi !== (drag.lastI ?? -1)) {
                        drag.lastI = pi;
                        self.sow(pi);
                    }
                }
            });
            var finish = function (e, cancelled) {
                if (!drag || e.pointerId !== drag.id) return;
                var plot = drag.pid, lastI = drag.lastI;
                drag = null;
                el.classList.remove('zfm-fm-dragging');
                [].forEach.call(el.querySelectorAll('.zfm-fm-plot'), function (p) { p.classList.remove('zfm-fm-hover'); });
                /* 【v6】松手落点若已在批量扫过中播过则不重复；cancel 不执行 */
                if (!cancelled && plot) {
                    var fi = parseInt(plot.getAttribute('data-i'));
                    if (fi !== (lastI ?? -1)) self.sow(fi);
                }
            };
            seedEl.addEventListener('pointerup', function (e) { finish(e, false); });
            seedEl.addEventListener('pointercancel', function (e) { finish(e, true); });
            /* 田块点击：mature→收获 / wither→枯萎清理 / 两击降级播种（先点种子再点田） */
            el.addEventListener('click', function (e) {
                var plot = e.target.closest('.zfm-fm-plot');
                if (!plot) return;
                var i = parseInt(plot.getAttribute('data-i'));
                var f = self.fields[i];
                if (!f) return;
                if (f.st === 'mature' && (self.tool === 'harvest' || !self.tool)) return self.harvest(i);
                if (self.tool) {
                    if (self.applyTool(i)) { self.save(); self.render(self.el.parentNode, collectChats()); }
                    return;
                }
                if (f.st === 'wither') { f.st = 'empty'; f.crop = -1; self.save(); self.render(self.el.parentNode, collectChats()); return; }
                if (f.st === 'empty' && self.seeds > 0 && el._zfmSeedPick) { el._zfmSeedPick = false; self.sow(i); }
            });
            /* 【v2】空地自然生长：每 20s 检查，随机空地有一点点概率长回杂草/碎石 */
            if (!this._growTimer) {
                this._growTimer = setInterval(function () {
                    if (document.hidden || !self.el) return;
                    var empties = [];
                    self.fields.forEach(function (f, k) { if (f.st === 'empty') empties.push(k); });
                    if (!empties.length) return;
                    /* 【改】杂草石头随机更多一点：55% 概率触发，且一次可能长 1~2 块 */
                    if (Math.random() > 0.55) return;
                    var growN = Math.min(empties.length, Math.random() < 0.4 ? 2 : 1);
                    for (var gi = 0; gi < growN; gi++) {
                        var ei = empties.splice(Math.floor(Math.random() * empties.length), 1)[0];
                        self.fields[ei] = { st: Math.random() < 0.7 ? 'grass' : 'rock', crop: -1 };
                    }
                    self.save();
                    self.render(self.el.parentNode, collectChats());
                }, 20 * 1000);
            }
            /* 【v2】滑动操作：按住拖过田块即触发工具（浇水/收割/除草/碎石），不用逐个点击 */
            var slideBtn = -1;
            el.addEventListener('pointerdown', function (e) {
                if (e.target.closest && e.target.closest('.zfm-fm-plot')) { slideBtn = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch (err) {} }
            });
            el.addEventListener('pointermove', function (e) {
                if (slideBtn !== e.pointerId || !self.tool) return;
                var t = document.elementFromPoint(e.clientX, e.clientY);
                var plot = t && t.closest ? t.closest('.zfm-fm-plot') : null;
                if (!plot) return;
                if (plot._zfmSlideLock) return;
                plot._zfmSlideLock = true;
                setTimeout(function () { plot._zfmSlideLock = false; }, 450);   /* 同块 450ms 防抖 */
                var i = parseInt(plot.getAttribute('data-i'));
                var f = self.fields[i];
                if (!f) return;
                var acted = false;
                if (self.tool === 'water' && (f.st === 'sprout' || f.st === 'grown')) { self.waterPlot(i); acted = true; }
                else if (self.tool === 'harvest' && f.st === 'mature') { self.harvest(i); acted = true; }
                else if (self.tool === 'sickle' && f.st === 'grass') acted = self.applyTool(i);
                else if (self.tool === 'axe' && f.st === 'rock') acted = self.applyTool(i);
                if (acted) { self.save(); self.render(self.el.parentNode, collectChats()); }
            });
            var slideUp = function () { slideBtn = -1; };
            el.addEventListener('pointerup', slideUp);
            el.addEventListener('pointercancel', slideUp);
            /* 回收箱：把收成果实卖掉换金币（每种果实有自己的售价），金币累计进右上角长期统计 */
            var binEl = el.querySelector('.zfm-fm-bin');
            binEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!self.crops.length) {
                    binEl.title = '回收箱是空的：先收获成熟作物再来卖';
                    return;
                }
                var total = 0;
                self.crops.forEach(function (ico) {
                    for (var k = 0; k < self.CROPS.length; k++) { if (self.CROPS[k].icon === ico) { total += self.CROPS[k].price; break; } }
                });
                var n = self.crops.length;
                self.crops = [];
                self.stats.coins += total;
                self.stats.sold += n;
                self.saveStats();
                self.save();
                binEl.title = '卖了 ' + n + ' 个果实 → +' + total + ' 金币';
                /* 开盖动画：盖子掀开，钱币飞出，1.5s 后合上 */
                binEl.classList.add('zfm-fm-bin-open');
                setTimeout(function () { binEl.classList.remove('zfm-fm-bin-open'); }, 1500);
                var pop = document.createElement('div');
                pop.className = 'zfm-fm-pop';
                pop.textContent = '💰 +' + total + ' 金币';
                binEl.appendChild(pop);
                setTimeout(function () { if (pop.parentNode) pop.remove(); }, 1500);
                self.render(self.el.parentNode, collectChats());
            });
            /* 两击降级：点种子进入"待播种"模式（触屏拖拽失败时的兜底） */
            seedEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (self.seeds <= 0) return;
                el._zfmSeedPick = !el._zfmSeedPick;
                el.classList.toggle('zfm-fm-dragging', el._zfmSeedPick);
            });
        },
        sow: function (i) {
            if (this.seeds <= 0 || !this.fields[i] || this.fields[i].st !== 'empty') return;
            this.seeds--;
            this.fields[i] = { st: 'sprout', crop: Math.floor(Math.random() * (this.CROPS.length - 1)) };
            this.el._zfmSeedPick = false;
            this.el.classList.remove('zfm-fm-dragging');
            this.save();
            this.render(this.el.parentNode, collectChats());
        },
        water: function (chatId) {
            /* 浇水：由工具调用触发（toolResult 外部也调这里）。
               生长计数制：每阶段需 WATER_PER_STAGE 次浇水（sprout→grown→mature），
               成熟(4阶段)即结果可收获。字段：wc=本阶段已浇水次数 */
            var self = this;
            var advanced = false;
            [].forEach.call(this.el ? this.el.querySelectorAll('.zfm-fm-plot') : [], function (p) {
                var i = parseInt(p.getAttribute('data-i'));
                var f = self.fields[i];
                if (!f) return;
                if (f.st === 'sprout' || f.st === 'grown') {
                    f.wc = (f.wc || 0) + 1;
                    if (f.wc >= self.WATER_PER_STAGE) {
                        f.wc = 0;
                        f.st = f.st === 'sprout' ? 'grown' : 'mature';
                        advanced = true;
                    }
                }
                /* 洒水动画：不管有没有作物都洒一下氛围水 */
                var d = document.createElement('div');
                d.className = 'zfm-fm-water';
                p.appendChild(d);
                setTimeout(function () { if (d.parentNode) d.remove(); }, 1200);
            });
            if (advanced) { this.save(); this.render(this.el.parentNode, collectChats()); }
        },
        harvest: function (i) {
            var f = this.fields[i];
            if (!f || f.st !== 'mature') return;
            var crop = this.CROPS[f.crop >= 0 ? f.crop : 0];
            this.crops.push(crop.icon);
            if (this.crops.length > 30) this.crops.shift();
            this.stats.harvest++;
            this.saveStats();
            this.fields[i] = { st: 'empty', crop: -1 };
            this.save();
            var el = this.el;
            if (el) {
                var plot = el.querySelector('.zfm-fm-plot[data-i="' + i + '"]');
                if (plot) {
                    var pop = document.createElement('div');
                    pop.className = 'zfm-fm-pop';
                    pop.textContent = crop.icon + ' +' + crop.name;
                    plot.appendChild(pop);
                    setTimeout(function () { if (pop.parentNode) pop.remove(); }, 1500);
                }
            }
            this.render(this.el.parentNode, collectChats());
        },
        render: function (host, chats) {
            var el = this.ensure(host);
            /* ⓪ 时间自然产出：每 90 秒自然长出 1 颗种子（上限 SEED_CAP），刷新/重开不重置 */
            this.regenTick();
            /* ① 种子结算：done 集合 delta 边沿 +1（防重复计数） */
            var doneIds = [];
            chats.forEach(function (c) { if (c.state === 'done') doneIds.push(c.id); });
            var fingerprint = doneIds.slice().sort().join(',');
            if (this._doneFp === undefined) this._doneFp = fingerprint;   /* 首帧不结算历史 */
            else if (fingerprint !== this._doneFp) {
                var prev = this._doneFp ? this._doneFp.split(',') : [];
                var seen = {};
                prev.forEach(function (id) { seen[id] = true; });
                var gained = 0;
                doneIds.forEach(function (id) { if (!seen[id]) gained++; });
                if (gained > 0) this.seeds = Math.min(SEED_CAP, this.seeds + gained);
                this._doneFp = fingerprint;
            }
            /* ② 常量田块：empty 田若 5 分钟无动作不自动变化——完全玩家驱动 */
            /* ③ 刷谷仓（种子数显示在工具栏种子图标上） */
            var seedToolN = el.querySelector('.zfm-fm-tool[data-tool="seed"] .zfm-fm-seed-n');
            if (seedToolN) seedToolN.textContent = this.seeds;
            var binT = el.querySelector('.zfm-fm-bin');
            if (binT) binT.title = this.crops.length
                ? '回收箱：' + this.crops.length + ' 个果实待卖，约值 ' + this.crops.reduce(function (s, ico) {
                    for (var k = 0; k < farm.CROPS.length; k++) { if (farm.CROPS[k].icon === ico) return s + farm.CROPS[k].price; }
                    return s;
                }, 0) + ' 金币（点击卖出）'
                : '回收箱：收获成熟作物后点击卖出换金币（右上角累计）';
            /* ⓪' 房顶总钱数可见 */
            var roofCoin = el.querySelector('.zfm-fm-roof-coin b');
            if (roofCoin) roofCoin.textContent = this.stats.coins;
            this.updateTopStats();
            var rack = el.querySelector('.zfm-fm-crops');
            rack.textContent = this.crops.length ? this.crops.join('') : '';
            rack.title = this.crops.length ? '收成：' + this.crops.length + ' 个' : '收成架（收获的作物摆这里）';
            /* ④ diff 田块：签名含状态，变了才重绘 */
            var self = this;
            var fieldsSig = this.fields.map(function (f) { return f.st + ':' + f.crop + ':' + (f.wc || 0); }).join('|');
            if (this.sig === fieldsSig) return false;
            this.sig = fieldsSig;
            [].forEach.call(el.querySelectorAll('.zfm-fm-plot'), function (p) {
                var i = parseInt(p.getAttribute('data-i'));
                var f = self.fields[i];
                /* 【修复】单块田粒度 diff：只重绘状态真正变化的地块。
                   否则任何一块田变动都会重绘全部田块，导致所有 sprout 田块
                   的播种动画(zfm-fm-sprout)同时重放。 */
                var plotSig = f.st + ':' + f.crop + ':' + (f.wc || 0);
                if (p.getAttribute('data-sig') === plotSig) return;
                p.setAttribute('data-sig', plotSig);
                var cls = 'zfm-fm-plot st-' + f.st;
                if (f.st !== 'empty') cls += ' crop-' + f.crop;
                p.className = cls;
                var crop = self.CROPS[f.crop >= 0 ? f.crop : 0] || {};
                /* 地面状态：grass(带草)→除草→empty / rock(乱石头)→碎石→empty；
                   4 阶段真实绘制：sprout(芽)→grown(幼苗)→mature(结果) + wither(枯萎) */
                var ico;
                if (f.st === 'empty') ico = '';
                else if (f.st === 'grass') ico = '🌿';
                else if (f.st === 'rock') ico = '🪨';
                else if (f.st === 'wither') ico = '🥀';
                else if (f.st === 'mature') ico = crop.stages ? crop.stages[3] : crop.icon;
                else ico = (crop.stages || ['🌱', '🌿'])[{ sprout: 0, grown: 1 }[f.st]] || '🌱';
                var tMap = { empty: '空地（选中种子后点这里播种）', grass: '长满杂草——用镰刀除草', rock: '乱石头——用斧子碎石',
                    sprout: '发芽中 ' + ((f.wc || 0) + 1) + '/' + self.WATER_PER_STAGE + ' 次浇水…（水壶浇水）',
                    grown: '生长中 ' + ((f.wc || 0) + 1) + '/' + self.WATER_PER_STAGE + ' 次浇水…',
                    mature: '结果了！用收割工具（或直接点击）收获卖钱', wither: '枯萎了…点击清理' };
                p.setAttribute('title', (tMap[f.st] || '') + '　' + (crop.name || '') + (f.st === 'mature' ? '（价值 ' + (crop.price || 0) + ' 金币）' : ''));
                var _tip = p.getAttribute('title') || '';
                if (_tip) p.setAttribute('data-title', _tip);
                p.innerHTML = ico ? '<span class="zfm-fm-plant">' + ico + '</span>' : '';
            });
            return true;
        },
        destroy: function () { if (this.el) { this.el.remove(); this.el = null; } this.sig = ''; },
        /* 时间自然产出：以挂钟时间为准，每 90 秒 +1 颗种子（上限 SEED_CAP）。
           用 localStorage 存上次结算时刻，跨刷新/隔天打开也能一次性补齐离线产出（封顶 5 颗防爆炸）。 */
        regenTick: function () {
            var now = Date.now(), REGEN_MS = 900 * 1000, CAP_ONCE = 5;   /* 【改】自然产出慢 10 倍：90s→900s/颗 */
            var last = 0;
            try { last = parseInt(localStorage.getItem('zf_farm_regen_at')) || 0; } catch (e) {}
            if (!last) { try { localStorage.setItem('zf_farm_regen_at', String(now)); } catch (e) {} return; }
            if (now - last < REGEN_MS) return;
            var gained = Math.min(CAP_ONCE, Math.floor((now - last) / REGEN_MS));
            if (gained <= 0 || this.seeds >= SEED_CAP) { try { localStorage.setItem('zf_farm_regen_at', String(now)); } catch (e) {} return; }
            this.seeds = Math.min(SEED_CAP, this.seeds + gained);
            try { localStorage.setItem('zf_farm_regen_at', String(now)); } catch (e) {}
            this.save();
            if (this.el) {
                var n = this.el.querySelector('.zfm-fm-tool[data-tool="seed"] .zfm-fm-seed-n');
                if (n) n.textContent = this.seeds;
                var seedEl = this.el.querySelector('.zfm-fm-tool[data-tool="seed"]');
                if (seedEl) {
                    seedEl.classList.add('zfm-fm-seed-gain');
                    setTimeout(function () { seedEl.classList.remove('zfm-fm-seed-gain'); }, 600);
                }
            }
        }
    };

    /* =====================================================================
       太空舱模式 v5（space）— 凹面镜式真实数字雨（Matrix concave rain）
       - 圆形舷窗内不分对话：把所有对话的真实输出文本汇成一个字符池，逐字符纵向下落。
       - 真实流速：只在检测到大模型真实输出增长时下落；停止 1.2 秒即冻结（卡了=真的停）。
       - 凹面镜感：字符按桶形畸变映射到球面（中央字大、边缘弯曲压缩）+ 鼠标视差，
         恢复"透过凹面舷窗看进去"的曲面鱼眼观感。
       - 整舱任意位置按住拖拽移动（位置记忆 zfm-space-pos）。
       - canvas 模式内自建 RAF（与 tank 同级例外），destroy 时 cancel。
       ===================================================================== */
 var space = {
        el: null,
        cv: null, ctx: null,
        W: 220, H: 220, FS: 12, DPR: 1,
        cols: 0, _drop: [], _cursor: [], _head: [],
        _speed: [], _base: [], _trailLen: [],
        _mx: null, _my: null,
        raf: 0, running: false, lastStep: 0, STEP: 16, _tPrev: 0,
        _pool: '', _cacheTail: '',
        _obs: null, _dirty: false,
        /* 凹面畸变映射 */
        R: 110, cx: 110, cy: 110, XD: [], warp: [], eScale: [],
        /* 真实活动检测 */
        _lastActive: 0, _poolLen: 0, _poolKey: '', _lastLen: 0,
        _thinking: false, _lastThinkingAt: 0, /* 【思考阶段】最近流是否为模型思考(reasoning) */
        /* 【真实 token 流订阅】以端口/输出流源头为准，不再按对话框 DOM 抓取 */
        _tokBuf: [],        // 环形缓冲：最近真实 token 增量片段
        _tokStr: '',        // 缓冲拼接结果（数字雨字符池）
        _tokDirty: false,   // 有新 token 待拼接
        _lastTokAt: 0,      // 最近一次真实 token 到达时间（perf.now）
        _rate: 0, _rateT: 0, // 【真实速度】token 到达速率（字符/秒，平滑值）及其上次计时
        _chunkBound: false, // 是否已绑定 window 流式事件
        _seeded: false,     // 是否已用历史 DOM 文本播过一次性种子
        _restartBtn: null,  // 【断流自救】停滞超时按钮（一键重启后台）
        _stallShown: false, // 是否已弹出重启按钮（防重复）

        /* 订阅全局真实 token 流（zf:llm-chunk，由 db.js proxyStream 广播） */
        subscribeStream: function () {
            if (this._chunkBound) return;
            var self = this;
            this._onChunk = function (e) {
                var d = e && e.detail;
                if (!d) return;
                /* 【思考阶段接入太空舱】db.js 会把 reasoning 增量以 reasoning:true 广播。
                   - 思考增量同样汇入字符池（保证思考期舷窗文字在流动，不再"停住"）
                   - 并维护 _thinking 状态（最后一段是否为思考流），供 HUD 显示"思考中" */
                if (d.reasoning) {
                    self._thinking = true;
                    self._lastThinkingAt = performance.now();
                } else if (d.content) {
                    self._thinking = false;   /* 正文开始 → 思考阶段结束 */
                }
                if (!d.content) return;       /* 纯元信息块不入池 */
                self._tokBuf.push(String(d.content));
                // 控制缓冲规模：累计片段过多时丢弃最早的，只保留最近约 24000 字符
                var total = 0, keep = [];
                for (var i = self._tokBuf.length - 1; i >= 0; i--) {
                    total += self._tokBuf[i].length;
                    keep.push(self._tokBuf[i]);
                    if (total >= 24000) break;
                }
                self._tokBuf = keep.reverse();
                self._tokDirty = true;
                /* 【真实速度·修】按到达增量测瞬时速率（字符/秒），指数平滑。
                   注意：本函数经 addEventListener 挂载，this 指向 window，
                   必须用 self 存取状态（原 this._rateT 恒为 undefined → 速率恒 0 → 文字不动）。
                   且改用「累积窗口」测速：每累计 ≥0.25s 结算一次瞬时速率，
                   避免 rdt>0.02 门槛把快速 token 全部丢弃。 */
                var nnow = performance.now();
                if (self._accChars == null) { self._accChars = 0; self._accT = nnow; }
                self._accChars += String(d.content).length;
                var adt = (nnow - self._accT) / 1000;
                if (adt >= 0.25) {
                    var inst = self._accChars / adt;
                    self._rate = self._rate ? self._rate * 0.6 + inst * 0.4 : inst;
                    self._accChars = 0; self._accT = nnow;
                }
                self._lastTokAt = nnow;
                /* 【速率历史】每次结算瞬时速率 → 记入环形历史（供 HUD 速度曲线绘制），保留最近 60 个采样点 */
                if (self._rateHist == null) self._rateHist = [];
                self._rateHist.push({ t: nnow, v: self._rate });
                if (self._rateHist.length > 60) self._rateHist.shift();
                self._lastActive = self._lastTokAt;   // 真实输出增长 → 驱动真实流速
                /* 【断流自救】收到真实 token → 立即收起重启按钮（恢复正常） */
                self.hideRestartBtn();
            };
            try {
                window.addEventListener('zf:llm-chunk', this._onChunk);
                this._chunkBound = true;
            } catch (e) { }
        },

        /* 一次性历史种子：刚打开太空舱、尚未收到任何真实 token 时，
           用当前对话框历史文本铺一次底，避免首屏纯占位流（仅在第一次铺）。 */
        _seedFromDOM: function () {
            var parts = [];
            try {
                var boxes = (window.App && Array.isArray(window.App.chatBoxes)) ? window.App.chatBoxes : [];
                boxes.forEach(function (c) {
                    if (!c || !c.id) return;
                    var box = c.el || document.querySelector('[data-chat-id="' + c.id + '"], [data-id="' + c.id + '"]');
                    if (!box) return;
                    /* 【修历史种子抓空→切换/重启黑屏】原选择器 .msg-content 在 DOM 中并不存在，
                       真实气泡为 .msg（内容渲染时挂 .md-body）。改为抓 .msg，优先 AI 答案文本，
                       过滤掉过短/纯工具噪声。这样即便没有实时 token，也能用历史真实文本铺底。 */
                    [].forEach.call(box.querySelectorAll('.msg'), function (n) {
                        var x = (n.textContent || '').trim();
                        if (!x || x.length < 2) return;
                        /* 跳过工具调用噪声行与计时元信息行（非"对话文字"） */
                        if (x.indexOf('__TASKMETA__') !== -1) return;
                        parts.push(x);
                    });
                });
            } catch (e) { }
            var s = parts.join(' ');
            if (s.length > 24000) s = s.slice(-24000);
            return s;
        },

        /* 字符池：以全局真实 token 流(zf:llm-chunk)为主源；
           历史 DOM 文本仅作一次性种子铺底（避免首屏黑屏），不再每帧抓 DOM。 */
        collectPool: function () {
            this.subscribeStream();
            var all = '';
            /* 主源：真实 token 流拼接 */
            if (this._tokDirty) {
                this._tokStr = this._tokBuf.join('');
                this._tokDirty = false;
            }
            if (this._tokStr) all = this._tokStr;
            /* 【Bug4 太空舱去假】不再用历史 DOM 文本铺底：
               原实现即便当前没有任何真实 token 在输出，也会每隔 2s 抓取界面上的历史对话文字
               （_seedFromDOM）当作字符池播放数字雨，导致"舱内明明没在输出却滚着文字"——明显太假。
               现改为：字符池【只认实时真实 token 流】，无真实输出时池自然为空、舷窗静止空白。 */
            if (all.length > 24000) all = all.slice(-24000);
            /* 真实 token 增长 → 刷新活动时间（驱动"真实流速"） */
            if (all.length > this._lastLen + 2) { this._lastActive = performance.now(); }
            this._lastLen = all.length;
            /* 【不兜底】已移除占位假流：池里只留真实 token / 历史种子，
               没有任何真实内容时池为空，舷窗自然静止，不再有无意义的文字流动。 */
            /* _hasReal 按"真实内容长度"判定，须在置空之前算。 */
            this._hasReal = all.length >= 64;
            if (all.length < 64) all = '';   /* 【不兜底】无真实内容则池置空，舷窗自然静止 */
            this._pool = all;
        },

        /* 是否应推进游标下落：
           - 有真实内容：距最后一次增长不超过 idleMs（停止/卡住>1.4s 即冻结=真的停）
           - 没有真实内容：返回 false，舷窗静止（不兜底，不再空转缓流） */
        isActive: function (t, idleMs) {
            if (!this._hasReal) return false;      /* 【不兜底】无真实内容：静止，不再空转缓流 */
            return (t - this._lastActive) <= (idleMs || 1400);
        },

        /* 【断流自救】检测 token 流停滞 ≥60 秒 → 舷窗上方弹出「一键重启后台」按钮。
           与左上角文件菜单的「🔄 一键重启后台」同一逻辑（window.__reviving 防抖
           + POST /api/revive 安全重启，重启前自动等待 AI 半成品代码恢复）。 */
        checkStall: function (t) {
            /* 条件：曾收到过真实 token（_lastTokAt>0）、当前停滞、超过 60 秒 */
            if (!this._lastTokAt || this.isActive(t)) { this.hideRestartBtn(); return; }
            if (this._stallShown) return;
            if ((t - this._lastTokAt) < 60000) return;
            this.showRestartBtn();
        },

        showRestartBtn: function () {
            if (this._restartBtn && document.body.contains(this._restartBtn)) { this._stallShown = true; return; }
            var self = this;
            var btn = document.createElement('div');
            btn.id = 'zfSpRestartBtn';
            btn.title = '检测到输出停滞超过 1 分钟，点击一键重启后台（断网自救）';
            btn.innerHTML = '🔄 一键重启后台';
            btn.style.cssText = [
                'position:fixed;z-index:2147483000;pointer-events:auto;cursor:pointer;',
                'padding:8px 16px;border-radius:20px;font:13px/1.4 system-ui,sans-serif;',
                'background:rgba(30,40,35,0.92);color:#ffd76a;border:1px solid rgba(255,215,106,0.5);',
                'box-shadow:0 4px 16px rgba(0,0,0,0.5);animation:zfSpBlink 1.6s ease-in-out infinite;'
            ].join('');
            /* 样式：金色呼吸提醒 */
            if (!document.getElementById('zfSpRestartStyle')) {
                var st = document.createElement('style');
                st.id = 'zfSpRestartStyle';
                st.textContent = '@keyframes zfSpBlink{0%,100%{box-shadow:0 4px 16px rgba(0,0,0,.5)}50%{box-shadow:0 0 14px rgba(255,215,106,.8)}}';
                document.head.appendChild(st);
            }
            /* 定位到舷窗正上方（考虑整舱拖拽 + 缩放） */
            var place = function () {
                try {
                    var hole = self.el && self.el.querySelector('.zfm-sp-porthole');
                    if (!hole) return;
                    var r = hole.getBoundingClientRect();
                    if (r.width) {
                        btn.style.left = Math.max(8, r.left + r.width / 2 - 80) + 'px';
                        btn.style.top = Math.max(8, r.top - 44) + 'px';
                    }
                } catch (e) { }
            };
            place();
            btn.onclick = function (ev) {
                ev.stopPropagation();
                if (window.__reviving) return;
                window.__reviving = true;
                btn.textContent = '🔄 正在重启后台…';
                /* 【2026 修复】与文件菜单同款：先停掉所有发送中对话（发送中时旧进程
                   被 DB 长事务占锁，优雅关停会卡 15~30 秒，重启显得"没反应"），
                   再 POST /api/revive 安全重启；后台恢复后自动刷新页面。 */
                try {
                    if (window.App && App.chatList && App.stopSending) {
                        App.chatList.forEach(function (c) {
                            if (c && (c.isSending || c.abortController)) {
                                try { App.stopSending(c); } catch (e) { }
                            }
                        });
                    }
                } catch (e) { }
                try { fetch('/api/revive', { method: 'POST' }).catch(function () { }); } catch (e) { }
                /* 轮询健康检查，后台恢复后不刷新前台（无感）；60 秒兜底解除防抖 */
                var _t0 = Date.now();
                var _pt = setInterval(function () {
                    var el = Math.floor((Date.now() - _t0) / 1000);
                    if (el > 55) { clearInterval(_pt); window.__reviving = false; return; }
                    try {
                        fetch('/api/health', { cache: 'no-store' }).then(function (r) {
                            if (r && r.ok) {
                                clearInterval(_pt);
                                window.__reviving = false;
                                // 【无感重启】后台恢复后不刷新前台页面，界面/对话原样保留
                                btn.textContent = '✅ 后台已恢复，界面保持不动';
                                setTimeout(function () { try { self.hideRestartBtn(); } catch (e) { } }, 1500);
                            }
                        }).catch(function () { });
                    } catch (e) { }
                }, 2000);
            };
            document.body.appendChild(btn);
            this._restartBtn = btn;
            this._stallShown = true;
        },

        hideRestartBtn: function () {
            this._stallShown = false;
            if (this._restartBtn) {
                try { this._restartBtn.remove(); } catch (e) { }
                this._restartBtn = null;
            }
        },

        ensureObserver: function () {
            if (this._obs) return;
            var self = this;
            this._obs = new MutationObserver(function () { self._dirty = true; });
            try {
                this._obs.observe(document.getElementById('chatCanvas') || document.body,
                    { childList: true, subtree: true, characterData: true });
            } catch (e) { }
        },

        /* 计算凹面桶形畸变：把平面网格 (gx,gy) 映射到球面视觉坐标 */
        buildWarp: function () {
            var R = this.R, cx = this.cx;
            this.XD = []; this.eScale = [];
            for (var i = 0; i < this.cols; i++) {
                var gx = i * this.FS + this.FS * 0.5;     /* 平面列中心 x */
                var nx = (gx - cx) / R;                    /* -1..1 归一化 */
                if (nx > 1) nx = 1; else if (nx < -1) nx = -1;
                /* 桶形畸变：向中心挤压 */
                var bx = (Math.asin(nx) / (Math.PI / 2)) * R + cx;
                this.XD[i] = bx;
                /* 边缘字符缩放：中心 1.0、边缘 0.55，强化凹面景深 */
                this.eScale[i] = 0.55 + 0.45 * Math.sqrt(1 - nx * nx);
            }
        },

        syncSize: function () {
            var hole = this.el && this.el.querySelector('.zfm-sp-porthole');
            if (!hole || !this.cv) return;
            var size = hole.clientWidth || 220;
            this.DPR = window.devicePixelRatio || 1;
            this.W = size; this.H = size;
            this.R = size / 2; this.cx = size / 2; this.cy = size / 2;
            this.cv.width = Math.round(size * this.DPR);
            this.cv.height = Math.round(size * this.DPR);
            this.cv.style.width = size + 'px';
            this.cv.style.height = size + 'px';
            this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
            this.cols = Math.max(1, Math.floor(size / this.FS));
            this._drop = []; this._cursor = []; this._head = [];
            this._speed = []; this._base = []; this._trailLen = [];
            var rows = Math.ceil(this.H / this.FS);
            for (var i = 0; i < this.cols; i++) {
                /* head 行位置：随机铺满屏，保证一上来就有满屏字符（不再黑屏） */
                this._drop[i] = Math.floor(Math.random() * (rows + 8)) - 4;
                this._cursor[i] = Math.floor(Math.random() * (this._pool.length || 200));
                this._base[i] = Math.floor(Math.random() * (this._pool.length || 200));
                this._head[i] = 0;
                /* 【真实速度】不再随机固定速度，下落速度统一由真实 token 速率驱动 */
                this._trailLen[i] = 6 + Math.floor(Math.random() * 12);  /* 拖尾长度 */
            }
            this.buildWarp();
            this.ctx.fillStyle = '#06110c';
            this.ctx.fillRect(0, 0, this.W, this.H);
        },

        startLoop: function () {
            if (this.running) return;
            this.running = true;
            this.lastStep = performance.now();
            this._tPrev = this.lastStep;
            var self = this;
            (function loop(t) {
                if (!self.running) return;
                self.draw(t);
                self.raf = requestAnimationFrame(loop);
            })(this.lastStep);
        },

        /* 把当前各列字符（含拖尾）全量渲染到 ctx；供正常绘制与放大镜复用 */
        _renderScene: function (ctx) {
            var fs = this.FS, pool = this._pool, pl = pool.length || 1;
            var cy = this.cy, R = this.R;
            var rows = Math.ceil(this.H / fs);
            ctx.textBaseline = 'top';
            for (var i = 0; i < this.cols; i++) {
                var xd = this.XD[i] || (i * fs);
                var s = this.eScale[i] || 1;
                var tl = this._trailLen[i];
                /* 连续浮点头位（不再 floor 量化到整行）—— 平滑下落的关键 */
                var headPos = this._drop[i];
                /* 从头部往上画拖尾：k=0 是最新头字符 */
                for (var k = 0; k < tl; k++) {
                    var r = headPos - k;
                    if (r < -1 || r > rows + 1) continue;
                    var y = r * fs;
                    var idx = (this._base[i] + Math.floor(headPos) - k) % pl; if (idx < 0) idx += pl;
                    var ch = pool.charAt(idx);
                    if (!ch || ch === ' ') continue;
                    var ny = (y - cy) / R; if (ny > 1) ny = 1; else if (ny < -1) ny = -1;
                    var yd = cy + Math.sin(ny * (Math.PI / 2)) * R * 0.92;
                    var fade = 1 - k / tl;
                    var chfs = Math.max(7, fs * s);
                    ctx.font = chfs + 'px Consolas,"Courier New",monospace';
                    if (k === 0) {
                        ctx.fillStyle = 'rgba(220,255,230,0.96)';
                    } else if (k <= 2) {
                        ctx.fillStyle = 'rgba(120,245,150,' + (0.85 * fade).toFixed(2) + ')';
                    } else {
                        ctx.fillStyle = 'rgba(50,200,100,' + (0.62 * fade).toFixed(2) + ')';
                    }
                    ctx.fillText(ch, xd, yd);
                }
            }
        },

        draw: function (t) {
            var ctx = this.ctx; if (!ctx) return;
            /* 真实 token 到达 → 即时刷新字符池（不再依赖 DOM MutationObserver 脏标记） */
            if (this._tokDirty || !this._pool) this.collectPool();
            if (t == null) t = performance.now();
            var fs = this.FS;

            /* 尺寸自愈：若首次创建时舷窗不可见（clientWidth=0）导致画布 0×0，
               或舷窗尺寸变化（媒体查询/缩放），这里检测并重建，避免出现全黑看不到 */
            var hole = this.el && this.el.querySelector('.zfm-sp-porthole');
            if (hole) {
                var size = hole.clientWidth || 0;
                if (size > 0 && Math.abs(size - this.W) > 1) this.syncSize();
            }

            /* 完全清屏（不留上帧残影），改为整幅重绘 trail —— 这样空闲时字符定格仍可见，不再黑屏 */
            ctx.fillStyle = '#06110c';
            ctx.fillRect(0, 0, this.W, this.H);

            /* 舷窗文字【真实速度】下落：速度 = 真实 token 到达速率（字符/秒）映射为行/秒。
               - 输出快 → 落得快；输出慢 → 落得慢；停止输出 → 静止（真的停）。
               - 单列基准速度按"每列分到的字符速率"换算：FS 像素/行，先按字符速率换行。 */
            var active = this.isActive(t, 1400);
            this.checkStall(t);   /* 【断流自救】停滞≥60s → 弹出「一键重启后台」 */
            {
                var rows = Math.ceil(this.H / fs);
                var dt = (t - this._tPrev) / 1000; if (dt > 0.1) dt = 0.1; if (dt < 0) dt = 0;
                /* 空闲超过 1.4s：速率清零（真的停）；仍在输出：用平滑速率 */
                var rate = active ? (this._rate || 0) : 0;
                if (!active) this._rate = 0;
                /* 字符速率 → 行速率：中文字符约占 1 行/2 字符，取 chars/2 行/秒，并限制上限防过快 */
                var lineRate = Math.min(30, rate / 2);
                for (var i = 0; i < this.cols; i++) {
                    if (lineRate > 0) this._drop[i] += lineRate * dt;
                    if (this._drop[i] > rows + this._trailLen[i] + 4) {
                        this._drop[i] = Math.floor(Math.random() * -10);
                        this._base[i] = Math.floor(Math.random() * (this._pool.length || 200));
                        this._trailLen[i] = 6 + Math.floor(Math.random() * 12);
                    }
                }
            }
            /* 【空池兜底·修】池为空时仅速率清零、列复位，【不再清 _tokBuf】——
                字符池需累计 ≥64 字符才显示，若在此清空缓冲，输出初期每次攒的
                不足 64 字就被抹掉，永远攒不起来 → 舱内彻底无字（鹈鹕会话引入的回归）。 */
            if (!this._pool || !this._pool.length) {
                this._rate = 0;
            }

            this._tPrev = t;

            /* 【思考阶段 HUD】模型在思考(reasoning)时，舷窗左上角显示"思考中"角标，
               5s 内无思考增量且正文未开始则自动淡出。
               【空态补充】字符池为空（无任何真实内容）时也不显示 HUD —— 舱内彻底"无内容且静止"。 */
            if (this._thinking && (t - this._lastThinkingAt) < 5000 && this._pool && this._pool.length) {
                var alpha = Math.max(0.25, 1 - (t - this._lastThinkingAt) / 5000);
                ctx.save();
                ctx.font = '12px "Cascadia Mono", Consolas, monospace';
                var label = '◆ 思考中 …';
                var tw = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(6,17,12,0.75)';
                ctx.fillRect(8, 8, tw + 18, 22);
                ctx.strokeStyle = 'rgba(140,255,180,' + (0.5 * alpha).toFixed(2) + ')';
                ctx.strokeRect(8, 8, tw + 18, 22);
                ctx.fillStyle = 'rgba(160,255,200,' + alpha.toFixed(2) + ')';
                ctx.fillText(label, 17, 23);
                ctx.restore();
            }

            /* 【速度 HUD·token/s】右下角显示实时速率读数 + 最近约 15 秒的速率迷你曲线。
               - 仅在有真实输出时显示，避免空态误导。
               - 读数 = 平滑字符速率 ÷ 2 估算 token/秒（中文约 2 字符/token）。 */
            {
                var hudRate = active ? (this._rate || 0) : 0;
                var recentTok = this._lastTokAt && (t - this._lastTokAt) < 5000;
                if (hudRate > 0 && recentTok && this._pool && this._pool.length) {
                    var tps = hudRate / 2;   /* 字符/秒 → 约 token/秒 */
                    /* 【风筝统计联动】把实测 token/s 速率暴露到全局（带时间戳），供风筝统计面板画 tok/s 速度曲线 */
                    window.__zfTokRate = { t: Date.now(), v: tps };
                }
            }

            this._renderScene(ctx);

            /* —— 鼠标透视放大镜：以鼠标为中心把凹面文字流放大，可"透视移动观看" —— */
            var mx = this._mx, my = this._my;
            if (mx != null && my != null) {
                var MR = this.R * 0.42;     /* 放大镜半径（更大，看得更清） */
                var ZOOM = 2.0;             /* 放大倍率 */
                /* 智能偏移：圆心偏向舷窗中心一侧，让光标落到镜缘外不被遮挡，
                   同时避免镜体溢出圆窗（光标偏下→镜上移，光标偏上→镜下移） */
                var off = MR * 0.85;
                var LX = mx;
                var LY = (my > this.cy) ? (my - off) : (my + off);
                /* 把圆心约束在舷窗可视半径内，防溢出被裁 */
                var maxR = this.R - MR * 0.4;
                var ddx = LX - this.cx, ddy = LY - this.cy;
                var dd = Math.sqrt(ddx * ddx + ddy * ddy);
                if (dd > maxR && dd > 0) { LX = this.cx + ddx / dd * maxR; LY = this.cy + ddy / dd * maxR; }
                ctx.save();
                ctx.beginPath(); ctx.arc(LX, LY, MR, 0, Math.PI * 2); ctx.clip();
                ctx.fillStyle = 'rgba(8,22,16,0.55)';
                ctx.fillRect(LX - MR, LY - MR, MR * 2, MR * 2);
                ctx.translate(LX, LY); ctx.scale(ZOOM, ZOOM); ctx.translate(-LX, -LY);
                this._renderScene(ctx);
                ctx.restore();
                /* 镜框高光 */
                ctx.save();
                ctx.beginPath(); ctx.arc(LX, LY, MR, 0, Math.PI * 2);
                ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(140,255,180,0.55)'; ctx.stroke();
                ctx.beginPath(); ctx.arc(LX - MR * 0.25, LY - MR * 0.25, MR * 0.9, Math.PI * 1.1, Math.PI * 1.5);
                ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(220,255,235,0.35)'; ctx.stroke();
                ctx.restore();
            }
        },

        ensure: function (host) {
            if (!this.el) {
                var self = this;
                this.el = document.createElement('div');
                this.el.className = 'zfm-space-station';
                this.el.innerHTML =
                    '<div class="zfm-sp-stars"></div>' +
                    '<div class="zfm-sp-earth"></div>' +
                    '<div class="zfm-sp-porthole">' +
                      '<canvas class="zfm-sp-rain"></canvas>' +
                      '<div class="zfm-sp-vignette"></div>' +
                    '</div>'; /* 空态文字已移至 body 级全屏层 #zfEmptyOverlay（屏幕正中心），舷窗回归纯装饰 */
                host.appendChild(this.el);
                this.cv = this.el.querySelector('.zfm-sp-rain');
                this.ctx = this.cv.getContext('2d');
                this.collectPool();
                this.syncSize();
                this.makeDraggable();
                this.enableParallax();
                this.ensureObserver();
                this.startLoop();
            }
            return this.el;
        },

        /* 鼠标视差：鼠标在舷窗内移动时，凹面玻璃轻微倾斜，强化曲面立体感 */
        enableParallax: function () {
            var hole = this.el && this.el.querySelector('.zfm-sp-porthole');
            var cv = this.cv;
            if (!hole || !cv) return;
            var self = this;
            var onMove = function (e) {
                var rect = hole.getBoundingClientRect();
                if (!rect.width) return;
                var mx = (e.clientX - rect.left) / rect.width - 0.5;   /* -0.5..0.5 */
                var my = (e.clientY - rect.top) / rect.height - 0.5;
                cv.style.transform = 'perspective(420px) rotateY(' + (mx * 10).toFixed(2) + 'deg) rotateX(' + (-my * 10).toFixed(2) + 'deg) scale(1.04)';
                /* 记录鼠标逻辑坐标（与画布 W/H 同系），驱动放大镜透视 */
                self._mx = (mx + 0.5) * self.W;
                self._my = (my + 0.5) * self.H;
            };
            var onLeave = function () {
                cv.style.transform = 'perspective(420px) rotateY(0deg) rotateX(0deg) scale(1)';
                self._mx = null; self._my = null;
            };
            hole.addEventListener('pointermove', onMove);
            hole.addEventListener('pointerleave', onLeave);
            this._parMove = onMove; this._parLeave = onLeave; this._parHole = hole;
        },

        makeDraggable: function () {
            var el = this.el;
            if (el._zfmDrag) return;
            el._zfmDrag = true;
            var self = this;
            var st = { on: false, sx: 0, sy: 0, or: 0, ob: 0, moved: false };
            var getP = function () {
                return { r: parseFloat(el.style.right) || 10, b: parseFloat(el.style.bottom) || 110 };
            };
            var apply = function (r, b) {
                var c = clampStagePos(el, r, b);
                el.style.right = c.r + 'px';
                el.style.bottom = c.b + 'px';
            };
            el.addEventListener('pointerdown', function (e) {
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false };
                el.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                var z = zOf(el);
                var dx = (e.clientX - st.sx) / z, dy = (e.clientY - st.sy) / z;
                if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                if (st.moved) apply(st.or - dx, st.ob - dy);
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { usSet('zfm-space-pos', p); } catch (e) { }
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },

        render: function (host, chats) {
            this.ensure(host);
            /* 空态层：body 级全屏 overlay，与太空舱解耦 */
            if (!this._emptyOverlay || !document.body.contains(this._emptyOverlay)) {
                this._emptyOverlay = document.createElement('div');
                this._emptyOverlay.id = 'zfEmptyOverlay';
                this._emptyOverlay.className = 'zfet-root'; /* ZFEmptyTips 注入样式的作用域根 */
                document.body.appendChild(this._emptyOverlay);
            }
            var empty = this._emptyOverlay;
            var isEmpty = !(chats && chats.length);
            empty.style.display = isEmpty ? '' : 'none';
            /* 从「有对话 → 空画布」瞬间重新抽签渲染轮换提示词；持续为空不重播，防闪烁 */
            if (isEmpty && this._wasEmpty !== true && window.ZFEmptyTips) {
                window.ZFEmptyTips.renderInto(empty, function (txt, ev) {
                    /* 点击 chip：复用画布全局创建面板（与双击空白处同一入口） */
                    try {
                        if (window.KiteCanvas && typeof KiteCanvas.openDualPanels === 'function') {
                            KiteCanvas.openDualPanels(ev.clientX, ev.clientY);
                        }
                    } catch (e) { }
                });
            }
            this._wasEmpty = isEmpty;
            /* 脏时刷新字符池（随 LLM 流式输出真实增长） */
            if (this._dirty || !this._pool) { this._dirty = false; this.collectPool(); }
            if (!this.running) this.startLoop();
            return false;
        },

        destroy: function () {
            this.running = false;
            if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
            if (this._obs) { try { this._obs.disconnect(); } catch (e) { } this._obs = null; }
            /* 解绑真实 token 流事件，重置流状态，下次进入重新订阅铺底 */
            if (this._chunkBound && this._onChunk) {
                try { window.removeEventListener('zf:llm-chunk', this._onChunk); } catch (e) { }
                this._chunkBound = false; this._onChunk = null;
            }
            this._tokBuf = []; this._tokStr = ''; this._tokDirty = false;
            this._lastTokAt = 0; this._seeded = false; this._seedStr = '';
            this._hudHist = null; this._accChars = null; /* 清空速率曲线与测速窗口 */
            /* 【断流自救】切走模式时移除重启按钮，重置停滞检测状态 */
            this.hideRestartBtn();
            this._restartBtn = null;
            this._wasEmpty = undefined; /* 重置空态标记，下次进入重新抽签 */
            /* 隐藏并移除空态全屏层，防止切走模式后残留 */
            if (this._emptyOverlay) { try { this._emptyOverlay.remove(); } catch (e) { } this._emptyOverlay = null; }
            if (this._parHole) {
                try {
                    this._parHole.removeEventListener('pointermove', this._parMove);
                    this._parHole.removeEventListener('pointerleave', this._parLeave);
                } catch (e) { }
                this._parHole = null;
            }
            if (this.el) { this.el.remove(); this.el = null; }
            this.cv = null; this.ctx = null;
        }
    };


    /* =====================================================================
       坦克大战模式（tank）：挂件内自建 canvas + RAF（零 RAF 原则的模式内例外）
       WSAD 合成 8 轴移动 / J·空格开火 / 敌方边缘随机生成 / 暴击成长循环
       激活才接管键盘（输入框聚焦不接管），Esc 暂停，切换时 destroy 销毁循环
       ===================================================================== */
    var TANK = {
        W: 240, H: 170,             // 鐢诲竷閫昏緫灏哄
        SPEED: 1.6, BULLET: 3.2, ESPEED: 0.55, EBULLET: 1.6,
        MAX_ENEMY: 5, ENEMY_HP: 2,
        SPAWN_BASE: 2600, SPAWN_MIN: 900,    //
        CRIT_STEP: 5, CRIT_INC: 0.05, CRIT_CAP: 0.5,   //
        LIVES: 3
    };
    var tank = {
        el: null, cv: null, ctx: null, raf: 0, running: false,
        keys: {}, player: null, enemies: [], bullets: [], ebullets: [], booms: [],
        spawnT: 0, lastT: 0, score: 0, kills: 0, critRate: 0, hits: 0, lives: TANK.LIVES,
        buff: 0, over: false, active: false, shieldT: 0, combo: 0, comboT: 0,
        _onResize: null,

        syncSize: function () {
            /* 全屏战场：canvas 逻辑尺寸 = 视口（×DPR 抗高分屏模糊，ctx 缩放回逻辑坐标） */
            var dpr = window.devicePixelRatio || 1;
            TANK.W = window.innerWidth || 1280;
            TANK.H = window.innerHeight || 800;
            if (this.cv) {
                this.cv.width = TANK.W * dpr; this.cv.height = TANK.H * dpr;
                this.cv.style.width = TANK.W + 'px'; this.cv.style.height = TANK.H + 'px';
                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        },

        render: function (stage) {
            if (!this.el) {
                this.el = document.createElement('div');
                this.el.className = 'zfm-tank';
                this.el.innerHTML =
                    '<div class="zfm-tk-hud"><span class="zfm-tk-score">0</span>'
                    + '<span class="zfm-tk-lv">暴击 0%</span>'
                    + '<span class="zfm-tk-life"></span></div>'
                    + '<canvas></canvas>'
                    + '<div class="zfm-tk-tip">点击任意处激活 · WSAD 移动 · J/空格 开炮 · Esc 退出</div>'
                    + '<div class="zfm-tk-over" style="display:none"><b>本局结束</b><p></p><i>按 WASD/J/空格 重开 · Esc 退出</i></div>';
                /* 【墓碑注释 2026-10】严禁在此加全屏深色结算遮罩 + 终局 stopCtl 摘键盘：
                   曾导致黑屏卡死无法退出；现已改为无限重生模式。 */
                this.cv = this.el.querySelector('canvas');
                this.ctx = this.cv.getContext('2d');
                this.syncSize();
                /* 点击任意处激活 → 接管键盘；失焦 → 释放。
                   注意：.zfm-tank 是 pointer-events:none，点击会穿透，
                   所以激活监听必须挂在 document 上（全屏层任何位置可点）。 */
                var self = this;
                this._onDocClick = function (e) {
                    if (self.active) return;   /* 已激活不再管，鼠标完全不接管 */
                    /* 点在 HUD/结算等可点子层（pointer-events:auto）时不激活 */
                    if (e.target && e.target !== document.body && self.el
                        && self.el.contains(e.target)
                        && getComputedStyle(e.target).pointerEvents !== 'none') return;
                    self.start(true);
                };
                document.addEventListener('click', this._onDocClick);
                this._onKeyDown = function (e) { self.onKey(e, true); };
                this._onKeyUp = function (e) { self.onKey(e, false); };
                this._onBlur = function () { self.stopCtl(); };
                this._onResize = function () {
                    var oldW = self._pw || TANK.W, oldH = self._ph || TANK.H;
                    self.syncSize();
                    /* resize 自适应：实体按比例迁移并钳制，不重置战局 */
                    if (self.player) {
                        self.player.x = Math.max(12, Math.min(TANK.W - 12, self.player.x / oldW * TANK.W));
                        self.player.y = Math.max(12, Math.min(TANK.H - 12, self.player.y / oldH * TANK.H));
                    }
                    [].forEach.call(self.enemies, function (en) {
                        en.x = Math.max(12, Math.min(TANK.W - 12, en.x / oldW * TANK.W));
                        en.y = Math.max(12, Math.min(TANK.H - 12, en.y / oldH * TANK.H));
                    });
                    self._pw = TANK.W; self._ph = TANK.H;
                };
                window.addEventListener('resize', this._onResize);
                this._pw = TANK.W; this._ph = TANK.H;
            }
            if (!this.el.parentNode) document.body.appendChild(this.el);   /* 全屏层挂 body，不进风筝舞台 */
            this.reset();
            this.start(false);   /* 切入模式即跑画面（但键盘未激活） */
        },

        reset: function () {
            this.player = { x: TANK.W / 2, y: TANK.H * 0.72, dir: -Math.PI / 2, cd: 0 };   /* 出生在屏幕下方 1/3 */
            this.enemies = []; this.bullets = []; this.ebullets = []; this.booms = [];
            this.score = 0; this.kills = 0; this.critRate = 0; this.hits = 0;
            this.lives = TANK.LIVES; this.buff = 0; this.over = false;
            this.spawnT = 0; this.combo = 0; this.comboT = 0; this.shieldT = 0;
            this.el.classList.remove('zfm-tk-over-show');
            this.el.querySelector('.zfm-tk-over').style.display = 'none';
            this.hud();
        },

        start: function (ctl) {
            this.active = !!ctl;
            this.el.classList.toggle('zfm-tk-active', this.active);
            if (ctl) {
                document.addEventListener('keydown', this._onKeyDown, true);
                document.addEventListener('keyup', this._onKeyUp, true);
                window.addEventListener('blur', this._onBlur);
            }
            if (!this.running) {
                this.running = true;
                this.lastT = performance.now();
                var self = this;
                (function loop(t) {
                    if (!self.running) return;
                    self.step(Math.min(34, t - self.lastT)); self.lastT = t;
                    self.draw();
                    self.raf = requestAnimationFrame(loop);
                })(this.lastT);
            }
        },

        stopCtl: function () {
            this.active = false;
            if (this.el) this.el.classList.remove('zfm-tk-active');
            this.keys = {};
            document.removeEventListener('keydown', this._onKeyDown, true);
            document.removeEventListener('keyup', this._onKeyUp, true);
            window.removeEventListener('blur', this._onBlur);
        },

        destroy: function () {
            this.running = false;
            if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
            this.stopCtl();
            if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize = null; }
            if (this._onDocClick) { document.removeEventListener('click', this._onDocClick); this._onDocClick = null; }
            if (this.el) { this.el.remove(); this.el = null; }
        },

        onKey: function (e, down) {
            /* Esc 永远可退出（放在输入框守卫之前，任何状态下都能离开战场，防卡死） */
            if (e.key.toLowerCase() === 'escape') {
                if (down) { this.stopCtl(); try { document.dispatchEvent(new CustomEvent('tank-layer-stop')); } catch (er) {} }
                return;
            }
            /* 输入框聚焦时绝不接管（防劫持打字） */
            var ae = document.activeElement;
            if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
            /* 无限模式墓碑：over 分支已废除（永不终局），严禁恢复"按任意键重开"的终局逻辑 */
            if (!this.active) return;
            var k = e.key.toLowerCase();
            if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'j' || k === ' ') {
                e.preventDefault(); e.stopPropagation();
                this.keys[k] = down;
            }
        },

        spawn: function () {
            /* 四边涌敌，下边避开玩家出生区（下方 40%），避玩家 120px */
            for (var tries = 0; tries < 8; tries++) {
                var side = Math.floor(Math.random() * 4), x, y;
                if (side === 0) { x = 16 + Math.random() * (TANK.W - 32); y = 14; }
                else if (side === 1) { x = Math.random() < 0.5 ? 14 : TANK.W - 14; y = 20 + Math.random() * (TANK.H - 40); }
                else if (side === 2) { x = 16 + Math.random() * (TANK.W - 32); y = TANK.H - 14; }
                else { x = Math.random() < 0.5 ? 14 : TANK.W - 14; y = 20 + Math.random() * (TANK.H * 0.6); }
                var p = this.player;
                if (Math.hypot(x - p.x, y - p.y) > 120) { this.enemies.push({ x: x, y: y, hp: TANK.ENEMY_HP, cd: 800 + Math.random() * 1200, wt: 0, dx: 0, dy: 0 }); return; }
            }
        },

        step: function (dt) {
            if (this.over) { this.stepBooms(dt); return; }
            var p = this.player, k = this.keys, spd = TANK.SPEED * (dt / 16.7);
            var mx = (k.d ? 1 : 0) - (k.a ? 1 : 0), my = (k.s ? 1 : 0) - (k.w ? 1 : 0);
            if (mx || my) {
                var n = Math.hypot(mx, my);
                p.x += mx / n * spd; p.y += my / n * spd;   /* 斜向归一 → 8 轴匀速 */
                p.dir = Math.atan2(my, mx);
                p.x = Math.max(12, Math.min(TANK.W - 12, p.x));
                p.y = Math.max(12, Math.min(TANK.H - 12, p.y));
            }
            /* 开炮（J/空格按住即连发，射速受 buff 影响） */
            p.cd -= dt;
            if ((k.j || k[' ']) && p.cd <= 0) {
                p.cd = this.buff > 0 ? 160 : 300;
                this.bullets.push({ x: p.x + Math.cos(p.dir) * 12, y: p.y + Math.sin(p.dir) * 12, dx: Math.cos(p.dir), dy: Math.sin(p.dir) });
                this.sfx('fire');
            }
            if (this.buff > 0) this.buff -= dt;
            if (this.shieldT > 0) this.shieldT -= dt;
            if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; } }
            /* 敌方刷新：间隔随击杀递减 */
            this.spawnT -= dt;
            if (this.spawnT <= 0 && this.enemies.length < TANK.MAX_ENEMY) {
                this.spawn();
                this.spawnT = Math.max(TANK.SPAWN_MIN, TANK.SPAWN_BASE - this.kills * 90);
            }
            /* 敌方 AI：随机游走 + 偶尔朝玩家 + 随机开炮 */
            var espd = TANK.ESPEED * (dt / 16.7);
            for (var i = this.enemies.length - 1; i >= 0; i--) {
                var en = this.enemies[i];
                en.wt -= dt; en.cd -= dt;
                if (en.wt <= 0) {
                    en.wt = 600 + Math.random() * 1200;
                    if (Math.random() < 0.45) { var a = Math.atan2(p.y - en.y, p.x - en.x) + (Math.random() - 0.5); en.dx = Math.cos(a); en.dy = Math.sin(a); }
                    else { var a2 = Math.random() * Math.PI * 2; en.dx = Math.cos(a2); en.dy = Math.sin(a2); }
                }
                en.x += en.dx * espd; en.y += en.dy * espd;
                en.x = Math.max(12, Math.min(TANK.W - 12, en.x)); en.y = Math.max(12, Math.min(TANK.H - 12, en.y));
                if (en.cd <= 0) {
                    en.cd = 1200 + Math.random() * 1800;
                    var a3 = Math.atan2(p.y - en.y, p.x - en.x);
                    this.ebullets.push({ x: en.x + Math.cos(a3) * 10, y: en.y + Math.sin(a3) * 10, dx: Math.cos(a3), dy: Math.sin(a3) });
                }
                /* 撞玩家 */
                if (Math.hypot(en.x - p.x, en.y - p.y) < 16 && this.shieldT <= 0) { this.hitPlayer(); en.hp = 0; this.boom(en.x, en.y, false); }
            }
            this.moveBullets(this.bullets, TANK.BULLET, dt, true);
            this.moveBullets(this.ebullets, TANK.EBULLET, dt, false);
            this.stepBooms(dt);
            this.hud();
        },

        moveBullets: function (arr, spd, dt, friendly) {
            var p = this.player, step = spd * (dt / 16.7);
            for (var i = arr.length - 1; i >= 0; i--) {
                var b = arr[i];
                b.x += b.dx * step; b.y += b.dy * step;
                if (b.x < 2 || b.x > TANK.W - 2 || b.y < 2 || b.y > TANK.H - 2) { arr.splice(i, 1); continue; }
                if (friendly) {
                    for (var j = this.enemies.length - 1; j >= 0; j--) {
                        var en = this.enemies[j];
                        if (Math.hypot(b.x - en.x, b.y - en.y) < 11) {
                            arr.splice(i, 1);
                            var crit = Math.random() < this.critRate;
                            en.hp -= crit ? 2 : 1;
                            this.hits++; this.combo++; this.comboT = 2000;
                            this.sfx(crit ? 'crit' : 'hit');
                            /* 暴击/命中特效复用全局鬼泣连击系统（与忍者同一套，派发 zf-combo-hit，不再自建右上角跳动 DOM） */
                            try { window.dispatchEvent(new CustomEvent('zf-combo-hit', { detail: { tool: 'tank' } })); } catch (e) {}
                            this.critRate = Math.min(TANK.CRIT_CAP, Math.floor(this.hits / TANK.CRIT_STEP) * TANK.CRIT_INC);
                            if (crit) { this.boom(b.x, b.y, true); if (Math.random() < 0.3) this.buff = 8000; }
                            if (en.hp <= 0) {
                                this.enemies.splice(j, 1);
                                this.kills++;
                                this.score += (crit ? 200 : 100) + this.combo * 10;
                                if (!crit) this.boom(en.x, en.y, false);
                                this.sfx('kill');
                            }
                            break;
                        }
                    }
                } else if (Math.hypot(b.x - p.x, b.y - p.y) < 10) {
                    arr.splice(i, 1);
                    if (this.shieldT <= 0) this.hitPlayer();
                }
            }
        },

        hitPlayer: function () {
            this.lives--; this.combo = 0; this.shieldT = 1500;
            this.sfx('hurt');
            this.boom(this.player.x, this.player.y, true);
            if (this.lives <= 0) {
                /* 无限模式：不终局不摘键盘，满血满盾原地重生，扣分继续打（防黑屏卡死） */
                this.lives = TANK.LIVES;
                this.score = Math.max(0, this.score - 300);
                this.combo = 0; this.critRate = 0; this.hits = 0;
                this.ebullets = [];
                this.enemies = this.enemies.filter(function (en) { return Math.hypot(en.x - tank.player.x, en.y - tank.player.y) > 180; });
                this.player.x = TANK.W / 2; this.player.y = TANK.H * 0.72; this.player.dir = -Math.PI / 2;
            }
        },

        /* ---------- 打击音效（WebAudio 内联合成，零素材零依赖，复用全局解锁标志） ---------- */
        _actx: null,
        _audio: function () {
            if (!this._actx) {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                this._actx = new AC();
            }
            if (this._actx.state === 'suspended') { try { this._actx.resume(); } catch (e) {} }
            return this._actx;
        },
        _tone: function (freq, dur, type, vol, delay, slideTo) {
            var c = this._audio(); if (!c) return;
            var t0 = c.currentTime + (delay || 0);
            var o = c.createOscillator(), g = c.createGain();
            o.type = type || 'sine';
            o.frequency.setValueAtTime(freq, t0);
            if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            o.connect(g); g.connect(c.destination);
            o.start(t0); o.stop(t0 + dur + 0.05);
        },
        _burst: function (dur, vol, filterFreq) {
            var c = this._audio(); if (!c) return;
            var n = Math.floor(c.sampleRate * dur);
            var buf = c.createBuffer(1, n, c.sampleRate);
            var d = buf.getChannelData(0);
            for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
            var src = c.createBufferSource(); src.buffer = buf;
            var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = filterFreq || 1200;
            var g = c.createGain(); g.gain.value = vol || 0.12;
            src.connect(bp); bp.connect(g); g.connect(c.destination);
            src.start();
        },
        sfx: function (name) {
            /* 总开关：与全局音效一致，zf3d_sfx_off=1 时静音 */
            try { if (localStorage.getItem('zf3d_sfx_off') === '1') return; } catch (e) {}
            try {
                if (name === 'fire') { this._tone(280, 0.10, 'square', 0.07, 0, 90); this._burst(0.05, 0.05, 900); }
                else if (name === 'hit') { this._tone(520, 0.06, 'triangle', 0.08, 0, 760); }
                else if (name === 'crit') { this._tone(880, 0.10, 'sawtooth', 0.10, 0, 1500); this._burst(0.08, 0.08, 2600); this._tone(1320, 0.12, 'sine', 0.07, 0.04); }
                else if (name === 'kill') { this._burst(0.20, 0.14, 700); this._tone(180, 0.22, 'sawtooth', 0.10, 0, 60); }
                else if (name === 'hurt') { this._tone(220, 0.20, 'sawtooth', 0.12, 0, 80); this._burst(0.12, 0.08, 500); }
            } catch (e) {}
        },

        /* 暴击/命中特效改由全局鬼泣连击系统(app-combo.js)统一呈现（命中处派发 zf-combo-hit），
           原右上角自建的 .zfm-tk-combo 跳动 DOM 已移除，这里不再需要 bumpCombo。 */
        boom: function (x, y, big) {            var parts = [];
            for (var i = 0; i < (big ? 14 : 9); i++) {
                var a = Math.random() * Math.PI * 2, v = 0.6 + Math.random() * 1.8;
                parts.push({ x: x, y: y, dx: Math.cos(a) * v, dy: Math.sin(a) * v, life: 1, c: Math.random() < 0.5 ? '#ffb347' : '#e05a4e' });
            }
            this.booms.push({ parts: parts, shake: big });
        },
        stepBooms: function (dt) {
            var s = dt / 16.7;
            for (var i = this.booms.length - 1; i >= 0; i--) {
                var bm = this.booms[i], alive = false;
                for (var j = 0; j < bm.parts.length; j++) {
                    var pt = bm.parts[j];
                    if (pt.life <= 0) continue;
                    alive = true;
                    pt.x += pt.dx * s; pt.y += pt.dy * s; pt.life -= 0.04 * s;
                }
                if (!alive) this.booms.splice(i, 1);
            }
        },

        hud: function () {
            if (!this.el) return;
            this.el.querySelector('.zfm-tk-score').textContent = this.score + ' 分' + (this.combo > 2 ? ' ×' + this.combo : '');
            this.el.querySelector('.zfm-tk-lv').textContent = '暴击 ' + Math.round(this.critRate * 100) + '%' + (this.buff > 0 ? ' ·速射' : '');
            this.el.querySelector('.zfm-tk-life').textContent = '♥'.repeat(Math.max(0, this.lives));
        },

        draw: function () {
            var c = this.ctx;
            /* 透明战场：只铺淡网格与暗角（α≤0.15），不挡真实界面 */
            c.clearRect(0, 0, TANK.W, TANK.H);
            c.fillStyle = 'rgba(16,22,14,.12)'; c.fillRect(0, 0, TANK.W, TANK.H);
            c.strokeStyle = 'rgba(120,150,100,.12)'; c.lineWidth = 1; c.beginPath();
            for (var gx = 40; gx < TANK.W; gx += 40) { c.moveTo(gx, 0); c.lineTo(gx, TANK.H); }
            for (var gy = 40; gy < TANK.H; gy += 40) { c.moveTo(0, gy); c.lineTo(TANK.W, gy); }
            c.stroke();
            var vg = c.createRadialGradient(TANK.W / 2, TANK.H / 2, Math.min(TANK.W, TANK.H) * 0.35, TANK.W / 2, TANK.H / 2, Math.max(TANK.W, TANK.H) * 0.72);
            vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,12,6,.35)');
            c.fillStyle = vg; c.fillRect(0, 0, TANK.W, TANK.H);
            var sh = 0;
            for (var bi = 0; bi < this.booms.length; bi++) if (this.booms[bi].shake) sh = 3;
            c.save();
            if (sh) c.translate((Math.random() - 0.5) * sh * 2, (Math.random() - 0.5) * sh * 2);
            /* 敌方坦克（红） */
            for (var i = 0; i < this.enemies.length; i++) this.drawTank(this.enemies[i].x, this.enemies[i].y, Math.atan2(this.player.y - this.enemies[i].y, this.player.x - this.enemies[i].x), '#c9354a', '#8a1f2e');
            /* 玩家（迷彩绿） */
            var p = this.player;
            this.drawTank(p.x, p.y, p.dir, '#6f8f4f', '#3a5228');
            if (this.shieldT > 0) { c.strokeStyle = 'rgba(120,200,255,.7)'; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 24, 0, Math.PI * 2); c.stroke(); }
            /* 炮弹 */
            c.fillStyle = '#ffe08a';
            for (var b1 = 0; b1 < this.bullets.length; b1++) { c.beginPath(); c.arc(this.bullets[b1].x, this.bullets[b1].y, 4, 0, Math.PI * 2); c.fill(); }
            c.fillStyle = '#ff9a7a';
            for (var b2 = 0; b2 < this.ebullets.length; b2++) { c.beginPath(); c.arc(this.ebullets[b2].x, this.ebullets[b2].y, 4, 0, Math.PI * 2); c.fill(); }
            /* 爆炸粒子 */
            for (var bi2 = 0; bi2 < this.booms.length; bi2++) {
                var pts = this.booms[bi2].parts;
                for (var pj = 0; pj < pts.length; pj++) {
                    var pt2 = pts[pj];
                    if (pt2.life <= 0) continue;
                    c.globalAlpha = pt2.life; c.fillStyle = pt2.c;
                    c.fillRect(pt2.x - 3, pt2.y - 3, 6, 6);
                }
                c.globalAlpha = 1;
            }
            c.restore();
            /* 未激活提示（HUD 角标提示，不铺遮罩——保持战场透明） */
            if (!this.active && !this.over) {
                c.fillStyle = 'rgba(10,14,10,.75)'; c.fillRect(TANK.W / 2 - 150, TANK.H * 0.5 - 30, 300, 56);
                c.fillStyle = '#dfe8d0'; c.font = '16px sans-serif'; c.textAlign = 'center';
                c.fillText('点击任意处 激活战场', TANK.W / 2, TANK.H * 0.5 - 4);
                c.font = '12px sans-serif'; c.fillStyle = '#9db088';
                c.fillText('WSAD 八方向 · J/空格 开炮 · Esc 退出', TANK.W / 2, TANK.H * 0.5 + 18);
            }
        },

        drawTank: function (x, y, dir, c1, c2) {
            var c = this.ctx;
            c.save(); c.translate(x, y); c.rotate(dir + Math.PI / 2);
            var s = 1.6;   /* 全屏尺寸放大 1.6 倍 */
            c.scale(s, s);
            /* 履带 */
            c.fillStyle = '#22281c'; c.fillRect(-8, -7, 4, 14); c.fillRect(4, -7, 4, 14);
            /* 车体 */
            c.fillStyle = c1; c.strokeStyle = c2; c.lineWidth = 1;
            c.beginPath(); c.rect(-5, -6, 10, 12); c.fill(); c.stroke();
            /* 炮塔+炮管 */
            c.fillStyle = c2; c.beginPath(); c.arc(0, 0, 3.6, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#d8d0b0'; c.fillRect(-1.2, -12, 2.4, 7);
            c.restore();
        }
    };


    /* =====================================================================
       pelican-bike: W1 骨架 + W2 鹈鹕 + W3 自行车 —— 鹈鹕骑车静态原型（W10 预合并）
       - 方案 A：独立互斥模式项（与 space 同级）
       - 零 RAF：动画后续全交 W4/W5 CSS keyframes；本阶段为静态形象确认版
       - 拖拽位置记忆 zfm-pelican-pos；思考信号 zf-combo-hit → pb-thinking；
         页面隐藏 pb-paused（W6 阶段生效，钩子已挂）
       ===================================================================== */
    var pelican = {
        el: null,
        _onCombo: null, _onVis: null,
        _thinkT: 0, _eggTimer: 0, _skyT: 0,

        ensure: function (host) {
            if (!this.el) {
                var self = this;
                this.el = document.createElement('div');
                this.el.className = 'zfm-pelican-bike';
                this.el.innerHTML =
                    '<div class="pb-stage">' +
                      '<svg class="pb-svg" viewBox="-12 -12 244 204" aria-hidden="true">' +
                        /* C 路加强·背景六层（pbbg- 前缀，裁决统一）：光晕/远山/城市/风速线/地面/萤火 */
                        '<defs>' +
                          '<linearGradient id="pbbg-sky" x1="0" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#1b2340"/><stop offset="0.55" stop-color="#3a2b58"/><stop offset="1" stop-color="#7a3b5e" style="transition:stop-color 1.5s ease"/>' +
                          '</linearGradient>' +
                          '<linearGradient id="pbk-frame" x1="0" y1="0" x2="1" y2="1">' +
                            '<stop offset="0" stop-color="#ff6b3d"/><stop offset="0.5" stop-color="#ffb45c"/><stop offset="1" stop-color="#ff8a3d"/>' +
                          '</linearGradient>' +
                          '<linearGradient id="pb-body-g" x1="0" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#eef4fc"/><stop offset="1" stop-color="#cfdcee"/>' +
                          '</linearGradient>' +
                          '<linearGradient id="pb-beak-g" x1="0" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#ffc46b"/><stop offset="1" stop-color="#ff7a3d"/>' +
                          '</linearGradient>' +
                          '<linearGradient id="pb-cape-g" x1="1" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#ff6b8f"/><stop offset="0.55" stop-color="#e0245e"/><stop offset="1" stop-color="#8f1049"/>' +
                          '</linearGradient>' +
                          '<linearGradient id="pb-helmet-g" x1="0" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#8ef0ff"/><stop offset="0.5" stop-color="#3aa0ff"/><stop offset="1" stop-color="#1b5fd0"/>' +
                          '</linearGradient>' +
                          '<linearGradient id="pbbg-hills-g" x1="0" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#26314a"/><stop offset="1" stop-color="#141c2b"/>' +
                          '</linearGradient>' +
                          '<radialGradient id="pbbg-moon" cx="0.5" cy="0.5" r="0.5">' +
                            '<stop offset="0" stop-color="rgba(255,214,150,0.95)"/><stop offset="0.5" stop-color="rgba(255,178,110,0.35)"/><stop offset="1" stop-color="rgba(255,157,92,0)"/>' +
                          '</radialGradient>' +
                          '<filter id="pb-glow" x="-40%" y="-40%" width="180%" height="180%">' +
                            '<feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
                          '</filter>' +
                          '<clipPath id="pbbg-clip"><ellipse cx="110" cy="90" rx="110" ry="90"/></clipPath>' +
                        '<linearGradient id="pbbg-sky-day" x1="0" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#7ec8ff"/><stop offset="0.6" stop-color="#bfe3ff"/><stop offset="1" stop-color="#eaf6ff"/>' +
                          '</linearGradient>' +
                          '<linearGradient id="pbbg-sky-tint" x1="0" y1="0" x2="0" y2="1">' +
                            '<stop offset="0" stop-color="#ff9a4d"/><stop offset="0.5" stop-color="#ff5e8a"/><stop offset="1" stop-color="#3a2b58"/>' +
                          '</linearGradient>' +
                          '</defs>' +
                        '<g id="pbbg-scene" clip-path="url(#pbbg-clip)">' +
                          '<g id="pbbg-sky-layer">' +
                                                        '<rect id="pbbg-sky-day" x="0" y="0" width="220" height="180" fill="url(#pbbg-sky-day)" style="opacity:0"/>' +
                            '<rect id="pbbg-sky-tint" x="0" y="0" width="220" height="180" fill="url(#pbbg-sky-tint)" style="opacity:0"/>' +
                            '<circle id="pbbg-sun" cx="50" cy="52" r="16" fill="#ffe08a" style="opacity:0"/>' +
                            '<circle id="pbbg-moon" cx="168" cy="42" r="13" fill="#f4ecd6" style="opacity:0"/>' +
                          '</g>' +
                          '<ellipse id="pbbg-glow" cx="110" cy="60" rx="150" ry="70" fill="rgba(255,157,92,0.10)"/>' +
                          '<g id="pbbg-hills">' +
                            '<path d="M-145 150 Q-72 116 0 150 Q72 116 145 150 Q217 116 290 150 V180 H-145 Z" fill="url(#pbbg-hills-g)" opacity="0.75"/>' +
                            '<path d="M290 150 Q362 116 435 150 Q507 116 580 150 V180 H290 Z" fill="url(#pbbg-hills-g)" opacity="0.75"/>' +
                          '</g>' +
                          '<g id="pbbg-city">' +
                            '<path d="M-145 152 h30 v-18 h26 v10 h34 v-22 h26 v30 h38 v-14 h30 v14 h44 v-26 h26 v26 h36 V180 H-145 Z" fill="#131a28" opacity="0.85"/>' +
                            '<path d="M290 152 h30 v-18 h26 v10 h34 v-22 h26 v30 h38 v-14 h30 v14 h44 v-26 h26 v26 h36 V180 H290 Z" fill="#131a28" opacity="0.85"/>' +
                          '</g>' +
                          '<line class="pbbg-w" x1="250" y1="58" x2="290" y2="58" stroke="rgba(244,247,251,.35)" stroke-width="2" stroke-linecap="round" style="animation-delay:0s"/>' +
                          '<line class="pbbg-w" x1="255" y1="82" x2="289" y2="82" stroke="rgba(244,247,251,.28)" stroke-width="2" stroke-linecap="round" style="animation-delay:-.6s"/>' +
                          '<line class="pbbg-w" x1="248" y1="104" x2="292" y2="104" stroke="rgba(244,247,251,.4)" stroke-width="2" stroke-linecap="round" style="animation-delay:-1.1s"/>' +
                          '<line class="pbbg-w" x1="258" y1="126" x2="290" y2="126" stroke="rgba(244,247,251,.3)" stroke-width="2" stroke-linecap="round" style="animation-delay:-.3s"/>' +
                          '<line class="pbbg-w" x1="252" y1="140" x2="290" y2="140" stroke="rgba(244,247,251,.45)" stroke-width="2" stroke-linecap="round" style="animation-delay:-.9s"/>' +
                          '<g id="pbbg-dust">' +
                            '<circle cx="30" cy="70" r="1.5" fill="rgba(255,138,61,.5)" style="animation-delay:0s"/>' +
                            '<circle cx="70" cy="45" r="1.2" fill="rgba(77,163,255,.35)" style="animation-delay:-2s"/>' +
                            '<circle cx="130" cy="55" r="1.5" fill="rgba(255,138,61,.4)" style="animation-delay:-4s"/>' +
                            '<circle cx="170" cy="40" r="1.2" fill="rgba(244,247,251,.35)" style="animation-delay:-1s"/>' +
                            '<circle cx="195" cy="90" r="1.5" fill="rgba(255,138,61,.5)" style="animation-delay:-5s"/>' +
                            '<circle cx="55" cy="120" r="1.2" fill="rgba(77,163,255,.35)" style="animation-delay:-3s"/>' +
                          '</g>' +
                        '</g>' +
                        '<g id="pbv-bike">' +
                          '<ellipse id="pbv-shadow" cx="108" cy="172" rx="86" ry="7" fill="#000" opacity="0.25"/>' +
                          '<g id="pbv-wheelR" style="transform-origin:48px 140px;">' +
                            '<circle cx="48" cy="140" r="30" fill="none" stroke="url(#pbk-frame)" stroke-width="6"/>' +
                            '<circle cx="48" cy="140" r="26" fill="none" stroke="rgba(255,214,150,.7)" stroke-width="1.6"/>' +
                            '<path d="M48 112 V168 M18 140 H78 M29 121 L67 159 M67 121 L29 159" stroke="#9fb0c2" stroke-width="1.8" fill="none"/>' +
                            '<circle cx="48" cy="140" r="4" fill="#ffd27a" stroke="#ff8a3d" stroke-width="1.5"/>' +
                          '</g>' +
                          '<g id="pbv-wheelF" style="transform-origin:168px 140px;">' +
                            '<circle cx="168" cy="140" r="30" fill="none" stroke="url(#pbk-frame)" stroke-width="6"/>' +
                            '<circle cx="168" cy="140" r="26" fill="none" stroke="rgba(255,214,150,.7)" stroke-width="1.6"/>' +
                            '<path d="M168 112 V168 M138 140 H198 M149 121 L187 159 M187 121 L149 159" stroke="#9fb0c2" stroke-width="1.8" fill="none"/>' +
                            '<circle cx="168" cy="140" r="4" fill="#ffd27a" stroke="#ff8a3d" stroke-width="1.5"/>' +
                          '</g>' +
                          '<g id="pbv-frame" stroke="url(#pbk-frame)" stroke-width="7" stroke-linecap="round" fill="none" filter="url(#pb-glow)">' +
                            '<path d="M48 140 L108 120"/>' +
                            '<path d="M48 140 L85 85"/>' +
                            '<path d="M85 85 L148 88"/>' +
                            '<path d="M108 120 L148 88"/>' +
                            '<path d="M108 120 L85 85"/>' +
                          '</g>' +
                          '<g id="pbv-frame-line" stroke="#243040" stroke-width="2" fill="none">' +
                            '<path d="M48 140 L108 120 L85 85 L48 140 M85 85 L148 88 L108 120"/>' +
                            '<path d="M150 92 L168 140"/>' +
                            '<path d="M148 88 L168 140"/>' +
                          '</g>' +
                          '<g id="pbv-seat">' +
                            '<rect x="66" y="75" width="34" height="9" rx="4.5" fill="url(#pb-beak-g)" stroke="#243040" stroke-width="2"/>' +
                            '<path d="M82 84 L92 106" stroke="#243040" stroke-width="4" fill="none" stroke-linecap="round"/>' +
                          '</g>' +
                          '<g id="pbv-handlebar">' +
                            '<path d="M148 88 L150 78 L162 74" stroke="#243040" stroke-width="6" fill="none" stroke-linecap="round"/>' +
                            '<rect x="158" y="68" width="14" height="8" rx="4" fill="url(#pbk-frame)" stroke="#243040" stroke-width="2"/>' +
                            '<circle id="pbv-lamp" cx="166" cy="80" r="4" fill="#5a3a20" stroke="#243040" stroke-width="2"/>' +
                          '</g>' +
                          '<g id="pbv-chain" stroke="#8fa2b8" stroke-width="2" fill="none" stroke-dasharray="4 3">' +
                            '<path d="M108 108 L48 132 M108 132 L48 148"/>' +
                          '</g>' +
                                                    /* A 路加强·细节件（pbk- 前缀） */
                          '<g id="pbk-mudguardF"><path d="M142 118 A30 30 0 0 1 194 122" fill="none" stroke="url(#pbk-frame)" stroke-width="5" stroke-linecap="round"/></g>' +
                          '<g id="pbk-mudguardR"><path d="M22 122 A30 30 0 0 1 74 118" fill="none" stroke="url(#pbk-frame)" stroke-width="5" stroke-linecap="round"/></g>' +
                          '<g id="pbk-chainring"><circle cx="108" cy="120" r="10" fill="none" stroke="#c9d6e6" stroke-width="2"/></g>' +
                          '<g id="pbk-rack" stroke="#5a6a7a" stroke-width="3" fill="none" stroke-linecap="round">' +
                            '<path d="M56 106 H92 M60 106 L56 140 M88 106 L84 140"/>' +
                          '</g>' +
                          '<g id="pbk-bag" style="transform-origin:74px 104px;">' +
                            '<rect x="62" y="94" width="24" height="14" rx="3" fill="#c96f3f" stroke="#33404d" stroke-width="2"/>' +
                          '</g>' +
                          '<g id="pbk-basket">' +
                            '<path d="M138 84 L164 84 L160 98 L142 98 Z" fill="none" stroke="#33404d" stroke-width="2.5"/>' +
                            '<rect x="144" y="78" width="14" height="6" rx="2" fill="#e8eef6" stroke="#33404d" stroke-width="1.5"/>' +
                          '</g>' +
                          '<circle id="pbk-bell" cx="152" cy="72" r="3.5" fill="#ffd27a" stroke="#243040" stroke-width="1.5"/>' +
                          '<g id="pbv-ground">' +
                            '<line x1="0" y1="171" x2="220" y2="171" stroke="#5a6a7a" stroke-width="2" stroke-dasharray="10 8" fill="none"/>' +
                          '</g>' +
                        '</g>' +
                        /* W2 鹈鹕角色（落座版：臀部 local(40,96) 精准落在车座 world(86,80) 上，整体前倾12度，翅膀前伸扶车把） */
                        '<g transform="translate(46,-17) rotate(12 42 96)"><g id="pb-pelican">' +
                          '<g id="pb-cape" style="transform-origin:28px 48px;">' +
                            '<path d="M28 46 C14 46 4 54 -4 66 C6 64 12 66 18 60 C14 68 10 74 6 82 C16 76 24 66 28 56 Z" fill="url(#pb-cape-g)" stroke="#2b384c" stroke-width="2" stroke-linejoin="round"/>' +
                          '</g>' +
                          '<g id="pb-body" style="transform-origin:40px 60px;">' +
                            '<path d="M40 38 C22 38 12 52 12 66 C12 84 26 96 42 96 C58 96 68 86 68 70 C68 52 58 38 40 38 Z" fill="url(#pb-body-g)" stroke="#2b384c" stroke-width="2"/>' +
                            '<path d="M60 52 C68 56 72 64 70 74" fill="none" stroke="#1c2530" stroke-width="5" stroke-linecap="round"/>' +
                          '</g>' +
                          '<g id="pb-head"><circle cx="34" cy="32" r="13" fill="url(#pb-body-g)" stroke="#2b384c" stroke-width="2"/></g>' +
                          '<g id="pb-beak" style="transform-origin:45px 35px;">' +
                            '<path d="M44 31 L86 35 C88 37 88 40 85 42 C74 46 56 47 46 44 C43 40 42 35 44 31 Z" fill="url(#pb-beak-g)" stroke="#2b384c" stroke-width="2"/>' +
                            '<g id="pb-throat" style="transform-origin:46px 44px;">' +
                              '<path d="M46 42 C52 58 64 64 80 46 C70 52 58 50 50 42 Z" fill="#ffb87a" stroke="#2b384c" stroke-width="2"/>' +
                            '</g>' +
                          '</g>' +
                          '<circle id="pb-eye" cx="30" cy="30" r="3.5" fill="#1c2530"/>' +
                          '<circle cx="31.2" cy="28.8" r="1" fill="#fff"/>' +
                          '<g id="pb-gear">' +
                            '<g id="pb-scarf" style="transform-origin:24px 38px;">' +
                              '<path d="M18 36 C24 42 34 44 42 40 C36 46 26 48 18 44 Z" fill="#ff6b8f" stroke="#2b384c" stroke-width="1.8"/>' +
                              '<path class="pb-scarf-tail" d="M18 40 C12 44 6 52 2 60 C10 56 16 50 20 44 Z" fill="#e0245e" stroke="#2b384c" stroke-width="1.8"/>' +
                            '</g>' +
                            '<g id="pb-sunglass" style="display:none">' +
                              '<rect x="22" y="25" width="14" height="8" rx="3" fill="#141a26" stroke="#0a0e16" stroke-width="1.5"/>' +
                              '<path d="M22 27 L14 29 M36 27 L42 26" stroke="#0a0e16" stroke-width="1.8" fill="none"/>' +
                              '<path d="M24 27 L28 31 M30 26.5 L34 31" stroke="rgba(142,240,255,.75)" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
                            '</g>' +
                            '<g id="pb-helmet" transform="translate(0,-2)">' +
                              '<path d="M18 26 C18 14 30 8 40 10 C50 12 54 20 52 27 C42 24 28 24 18 26 Z" fill="url(#pb-helmet-g)" stroke="#2b384c" stroke-width="2"/>' +
                              '<path d="M18 26 C28 23.5 42 23.5 52 27" fill="none" stroke="#12306e" stroke-width="2.5"/>' +
                              '<path d="M40 10 L40 6 M36 6 h8" stroke="#ffd27a" stroke-width="3" stroke-linecap="round"/>' +
                              '<path d="M26 13 C30 11 36 10.5 40 12" stroke="rgba(255,255,255,.55)" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
                            '</g>' +
                          '</g>' +
                          '<g id="pb-wingL" style="transform-origin:52px 58px;">' +
                            '<path d="M52 58 C66 60 80 64 92 70 L86 78 C72 74 58 70 50 62 Z" fill="#dbe7f5" stroke="#2b384c" stroke-width="2"/>' +
                          '</g>' +
                          '<g id="pb-wingR" style="transform-origin:34px 56px;">' +
                            '<path d="M34 56 C60 52 92 60 116 70 C94 76 52 71 36 62 Z" fill="#e9f1fb" stroke="#2b384c" stroke-width="2"/>' +
                          '</g>' +
                          '<g id="pb-legL" style="transform-origin:44px 92px;">' +
                            '<path d="M44 92 L52 110" fill="none" stroke="#ffb45c" stroke-width="5" stroke-linecap="round"/>' +
                            '<g id="pb-shinL" style="transform-origin:52px 110px;">' +
                              '<path d="M52 110 L46 133" fill="none" stroke="#ffb45c" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
                            '</g>' +
                          '</g>' +
                          '<g id="pb-legR" style="transform-origin:48px 92px;">' +
                            '<path d="M48 92 L56 110" fill="none" stroke="#ff8a3d" stroke-width="5" stroke-linecap="round"/>' +
                            '<g id="pb-shinR" style="transform-origin:56px 110px;">' +
                              '<path d="M56 110 L50 133" fill="none" stroke="#ff8a3d" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
                            '</g>' +
                          '</g>' +
                        '</g>' +
                      '</svg>' +
                    '</div>';
                host.appendChild(this.el);
                if (!document.getElementById('pb-style')) {
                    var css = document.createElement('style');
                    css.id = 'pb-style';
                    css.textContent = [
                        '.zfm-pelican-bike{position:fixed;z-index:60;width:220px;height:180px;pointer-events:auto;cursor:grab;user-select:none;}',
                        '.zfm-pelican-bike:active{cursor:grabbing;}',
                        '.pb-stage,.pb-svg{width:100%;height:100%;display:block;overflow:visible;}',
                        /* === A 路 pbk-：车轮/曲柄/链条/车身/邮包 === */
                        '@keyframes pbk-wheel{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
                        '#pbv-wheelR,#pbv-wheelF{animation:pbk-wheel .9s linear infinite;}',
                        /* 曲柄改由 JS startPedalIK 同钟驱动，与蹬踏同相位 */
                        '@keyframes pbk-chain{to{stroke-dashoffset:-28}}',
                        '#pbv-chain{animation:pbk-chain .45s linear infinite;}',
                        '@keyframes pbk-bump{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}',
                        '#pbv-bike{animation:pbk-bump .6s ease-in-out infinite;}',
                        '@keyframes pbk-bag{0%,100%{transform:rotate(0)}25%{transform:rotate(3deg)}75%{transform:rotate(-3deg)}}',
                        '#pbk-bag{animation:pbk-bag 1.2s ease-in-out infinite;}',
                        '@keyframes pbk-bell{0%{transform:rotate(0)}20%{transform:rotate(18deg)}40%{transform:rotate(-14deg)}60%{transform:rotate(8deg)}80%{transform:rotate(-5deg)}100%{transform:rotate(0)}}',
                        '.pb-eggbell #pbk-bell{animation:pbk-bell .6s ease-out;transform-origin:152px 75px;}',
                        /* === B 路 pb-：蹬腿两段式（反相）+ 眨眼/张望彩蛋 + 车灯 === */
                        '@keyframes pb-legA{0%,100%{transform:rotate(-22deg)}50%{transform:rotate(22deg)}}',
                        '@keyframes pb-legB{0%,100%{transform:rotate(22deg)}50%{transform:rotate(-22deg)}}',
                        /* 腿部改由 JS startPedalIK 驱动（IK 踩踏板） */
                        '@keyframes pb-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}',
                        '#pb-eye{animation:pb-blink 4.2s infinite;transform-origin:30px 30px;}',
                        '@keyframes pb-look{0%,88%,100%{transform:rotate(0)}92%{transform:rotate(-8deg)}}',
                        '.pb-egglook #pb-beak{animation:pb-look 3s ease-in-out;transform-origin:18px 44px;}',
                        '.pb-thinking #pbv-lamp{animation:pbk-lamp .5s ease-in-out infinite alternate;}',
                        '@keyframes pbk-lamp{from{fill:#5a3a20}to{fill:#ffd27a}}',
                        /* === C 路 pbbg-：六层视差 === */
                        '@keyframes pbbg-glow{0%,100%{opacity:.10}50%{opacity:.22}}',
                        '#pbbg-glow{animation:pbbg-glow 8s ease-in-out infinite;}',
                        '@keyframes pbbg-hills{from{transform:translateX(0)}to{transform:translateX(-435px)}}',
                        '#pbbg-hills{animation:pbbg-hills 22s linear infinite;}',
                        '#pbbg-city{animation:pbbg-hills 14s linear infinite;}',
                        '#pbbg-sky-anim{animation:pbbg-sky 48s ease-in-out infinite;}',
                        '#pbbg-sun{animation:pbbg-arc 24s linear infinite;}',
                        '#pbbg-moon{animation:pbbg-arc 24s linear infinite;}',
                        '@keyframes pbbg-sky{0%,100%{filter:brightness(1)}50%{filter:brightness(1.12)}}',
                        '@keyframes pbbg-arc{0%{transform:translateX(-6px)}50%{transform:translateX(6px)}100%{transform:translateX(-6px)}}',
                        '@keyframes pbbg-wind{from{transform:translateX(0)}to{transform:translateX(-300px)}}',
                        '.pbbg-w{animation:pbbg-wind 1.2s linear infinite;}',
                        '@keyframes pbbg-ground{from{transform:translateX(0)}to{transform:translateX(-216px)}}',
                        '#pbv-ground line{animation:pbbg-ground .55s linear infinite;}',
                        '@keyframes pbbg-dust{0%{transform:translateY(0);opacity:0}15%{opacity:1}85%{opacity:1}100%{transform:translateY(-18px) translateX(-10px);opacity:0}}',
                        '#pbbg-dust circle{animation:pbbg-dust 6s ease-in-out infinite;}',
                        '#pbbg-dust circle:nth-child(2n){animation-duration:8s;}',
                        '#pbbg-dust circle:nth-child(3n){animation-duration:9s;}',
                        '@keyframes pbbg-moon{0%,100%{opacity:.85;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}',
                        '#pbbg-moon{animation:pbbg-moon 6s ease-in-out infinite;transform-origin:176px 34px;}',
                        '@keyframes pb-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(2deg)}}',
                        /* 摇摆动画已移除：pb-sway 会让身体晃而腿不动（IK 髋部脱节），腿型错乱 */
                        /* === D 路 pbk2-：披风/围巾后吹 + IK 双段蹬踏 === */
                        '@keyframes pbk2-cape{0%,100%{transform:rotate(0deg) skewX(0)}30%{transform:rotate(4deg) skewX(-6deg)}60%{transform:rotate(-3deg) skewX(4deg)}}',
                        '#pb-cape{animation:pbk2-cape 1.1s ease-in-out infinite;}',
                        '@keyframes pbk2-scarf{0%,100%{transform:rotate(0)}40%{transform:rotate(7deg)}70%{transform:rotate(-4deg)}}',
                        '#pb-scarf{animation:pbk2-scarf 1.3s ease-in-out infinite;}',
                        /* pbk2 关键帧已删除：蹬踏改由 startPedalIK 逐帧 IK（脚锁定踏板圆周） */
                        /* === 状态联动 === */
                        '.pb-paused *{animation-play-state:paused !important;}',
                        '@media (max-width:900px){.zfm-pelican-bike{width:154px;height:126px;}}'
                    ].join('\n');
                    document.head.appendChild(css);
                }
                this.restorePos();
                this.makeDraggable();
                this.bindThinking();
                this.bindVisibility();
                this.bindEggs();
                this.startSky();
                this.startPedalIK();
            }
            return this.el;
        },

        bindEggs: function () {
            var el = this.el, self = this;
            el.addEventListener('dblclick', function () {
                el.classList.add('pb-eggbell');
                setTimeout(function () { el.classList.remove('pb-eggbell'); }, 700);
            });
        },

        makeDraggable: function () {
            var el = this.el;
            if (el._zfmDrag) return;
            el._zfmDrag = true;
            var st = { on: false, sx: 0, sy: 0, or: 0, ob: 0, moved: false };
            var getP = function () {
                return { r: parseFloat(el.style.right) || 10, b: parseFloat(el.style.bottom) || 370 };
            };
            var apply = function (r, b) {
                el.style.right = r + 'px';
                el.style.bottom = b + 'px';
            };
            el.addEventListener('pointerdown', function (e) {
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false };
                try { el.setPointerCapture(e.pointerId); } catch (err) {}
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                var dx = e.clientX - st.sx, dy = e.clientY - st.sy;
                if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                if (st.moved) apply(st.or - dx, st.ob - dy);
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { localStorage.setItem('zfm-pelican-pos', JSON.stringify(p)); } catch (e) { }
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },

        restorePos: function () {
            var saved = null;
            try { saved = JSON.parse(localStorage.getItem('zfm-pelican-pos') || 'null'); } catch (e) { }
            if (saved && isFinite(saved.r) && isFinite(saved.b)) {
                var el = this.el;
                var maxR = Math.max(0, window.innerWidth - 60);
                var maxB = Math.max(0, window.innerHeight - 60);
                saved.r = Math.min(Math.max(saved.r, 0), maxR);
                saved.b = Math.min(Math.max(saved.b, 0), maxB);
                el.style.right = saved.r + 'px';
                el.style.bottom = saved.b + 'px';
            } else {
                this.el.style.right = '10px';
                this.el.style.bottom = '370px';
            }
        },

        bindThinking: function () {
            var self = this;
            this._onCombo = function () {
                self.el && self.el.classList.add('pb-thinking');
                clearTimeout(self._thinkT);
                self._thinkT = setTimeout(function () {
                    self.el && self.el.classList.remove('pb-thinking');
                }, 5000);
            };
            try { window.addEventListener('zf-combo-hit', this._onCombo); } catch (e) { }
        },

        bindVisibility: function () {
            var self = this;
            this._onVis = function () {
                self.el && self.el.classList.toggle('pb-paused', document.hidden);
            };
            try { document.addEventListener('visibilitychange', this._onVis); } catch (e) { }
        },

        startSky: function () {
            var self = this;
            this._updateSky();
            clearInterval(this._skyT);
            this._skyT = setInterval(function () { self._updateSky(); }, 60000);
        },
        _updateSky: function () {
            var el = this.el; if (!el) return;
            var h = new Date().getHours() + new Date().getMinutes() / 60;
            var dayR = el.querySelector('#pbbg-sky-day'), tintR = el.querySelector('#pbbg-sky-tint');
            var sun = el.querySelector('#pbbg-sun'), moon = el.querySelector('#pbbg-moon');
            if (!dayR || !tintR) return;
            var night = function () { dayR.style.opacity = 0; tintR.style.opacity = 0; if (sun) sun.style.opacity = 0; if (moon) moon.style.opacity = 0.85; };
            var day = function () { dayR.style.opacity = 1; tintR.style.opacity = 0; if (sun) sun.style.opacity = 0.9; if (moon) moon.style.opacity = 0; };
            var dusk = function (f) { dayR.style.opacity = 0; tintR.style.opacity = (0.72 * (1 - Math.abs(f - 0.5) * 2)).toFixed(2); if (sun) sun.style.opacity = 0.55; if (moon) moon.style.opacity = 0.2; };
            if (h >= 18.5 || h < 5) { night(); }
            else if (h >= 5 && h < 7) { dusk((h - 5) / 2); }
            else if (h >= 17 && h < 18.5) { dusk((h - 17) / 1.5); }
            else { day(); }
            if (moon) moon.style.opacity = (h >= 18.5 || h < 5) ? 0.85 : 0;
            if (sun) sun.style.opacity = (h >= 7 && h < 17) ? 0.9 : (h >= 5 && h < 7 ? 0.55 : (h >= 17 && h < 18.5 ? 0.55 : 0));
        },
        stopSky: function () { clearInterval(this._skyT); this._skyT = 0; },
        startPedalIK: function () {
            /* 【修复】蹬踏 IK：脚端锁定踏板圆周（与曲柄同相同向），双段骨骼余弦定理解膝/踝，
               替代与踏板无关的 pbk2 CSS 关键帧（此前腿摆方向与曲柄相反且脚不落踏板） */
            var self = this;
            this.stopPedalIK();
            var el = this.el; if (!el) return;
            var crank = el.querySelector('#pbv-crank');
            var legL = el.querySelector('#pb-legL'), shinL = el.querySelector('#pb-shinL');
            var legR = el.querySelector('#pb-legR'), shinR = el.querySelector('#pb-shinR');
            var CX = 108, CY = 120, PR = 10, T_PERIOD = 1.2; /* 曲柄中心/踏板半径/周期：PR=10 与曲柄臂 119-108 等长，保证踏板锁定臂端 */
            var L1 = 19.7, L2 = 23.3;                        /* 大腿/小腿骨长：与 SVG 实际路径长度一致 (44,92)->(52,110)->(46,133) */
            var D2R = Math.PI / 180, R2D = 180 / Math.PI;
            /* 外层组已无旋转：世界坐标即鹈鹕局部坐标 + translate(46,-17) */
            function w2l(wx, wy) { return [wx - 46, wy + 17]; }
            function knee2(hip, foot) {
                var dx = foot[0] - hip[0], dy = foot[1] - hip[1];
                var d = Math.sqrt(dx * dx + dy * dy);
                d = Math.max(6, Math.min(L1 + L2 - 0.5, d));
                var base = Math.atan2(dy, dx);
                var cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
                var A = Math.acos(Math.max(-1, Math.min(1, cosA)));
                var k1 = [hip[0] + L1 * Math.cos(base + A), hip[1] + L1 * Math.sin(base + A)];
                var k2 = [hip[0] + L1 * Math.cos(base - A), hip[1] + L1 * Math.sin(base - A)];
                return k1[0] >= k2[0] ? k1 : k2; /* 膝盖取靠前(+x)的解 */
            }
            function apply(leg, shin, hip, foot, thI, shI) {
                var k = knee2(hip, foot);
                var a1 = Math.atan2(k[1] - hip[1], k[0] - hip[0]) * R2D - thI;
                var a2 = Math.atan2(foot[1] - k[1], foot[0] - k[0]) * R2D - shI - a1;
                leg.style.transform = 'rotate(' + a1.toFixed(2) + 'deg)';
                shin.style.transform = 'rotate(' + a2.toFixed(2) + 'deg)';
            }
            var hipL = [44, 92], hipR = [48, 92];
            var TH_L = Math.atan2(110 - 92, 52 - 44) * R2D, TH_R = Math.atan2(110 - 92, 56 - 48) * R2D;   /* 初始大腿静态角 */
            var SH_L = Math.atan2(133 - 110, 46 - 52) * R2D,  SH_R = Math.atan2(133 - 110, 50 - 56) * R2D; /* 初始小腿静态角 */
            function tick(now) {
                self._pedalRaf = requestAnimationFrame(tick);
                if (document.hidden || !self.el) return;
                var th = (now / 1000) * (Math.PI * 2 / T_PERIOD); /* 递增 = 顺时针，与车轮 pbk-wheel 同向 */
                if (crank) crank.setAttribute('transform', 'rotate(' + ((th * R2D) % 360).toFixed(1) + ' 108 120)');
                /* 踏板锁定臂端、始终水平：F 臂端角=th，B 臂端角=th+π；踏板自转 -th 保持水平 */
                var pedF = el.querySelector('#pbv-pedalF'), pedB = el.querySelector('#pbv-pedalB');
                if (pedF) pedF.setAttribute('transform', 'translate(' + (CX + PR * Math.cos(th)).toFixed(2) + ',' + (CY + PR * Math.sin(th)).toFixed(2) + ') rotate(' + (-(th * R2D) % 360).toFixed(1) + ')');
                if (pedB) pedB.setAttribute('transform', 'translate(' + (CX + PR * Math.cos(th + Math.PI)).toFixed(2) + ',' + (CY + PR * Math.sin(th + Math.PI)).toFixed(2) + ') rotate(' + (-(th * R2D) % 360).toFixed(1) + ')');
                if (legL && shinL) {
                    var a = th;
                    apply(legL, shinL, hipL, w2l(CX + PR * Math.cos(a), CY + PR * Math.sin(a)), TH_L, SH_L);
                }
                if (legR && shinR) {
                    var b = th + Math.PI;
                    apply(legR, shinR, hipR, w2l(CX + PR * Math.cos(b), CY + PR * Math.sin(b)), TH_R, SH_R);
                }
            }
            this._pedalRaf = requestAnimationFrame(tick);
        },
        stopPedalIK: function () { if (this._pedalRaf) { cancelAnimationFrame(this._pedalRaf); this._pedalRaf = 0; } },

        render: function (host, chats) {
            this.ensure(host);
            return false;
        },

        destroy: function () {
            if (this._onCombo) {
                try { window.removeEventListener('zf-combo-hit', this._onCombo); } catch (e) { }
                this._onCombo = null;
            }
            if (this._onVis) {
                try { document.removeEventListener('visibilitychange', this._onVis); } catch (e) { }
                this._onVis = null;
            }
            clearTimeout(this._thinkT); clearTimeout(this._eggTimer); this.stopSky(); this.stopPedalIK();
            if (this.el) { this.el.remove(); this.el = null; }
        }
    };

    var RENDERERS = { office: office, plant: plant, fish: fish, spider: spider, farm: farm, space: space, pelican: pelican, tank: tank };

    /* 【修复 2026-10】zoom 坐标系统一：.zfm-office 带 zoom:0.6，offsetWidth 是未缩放值，
       而 right/bottom 的 px 值会被 zoom 再缩放渲染（渲染值 = 样式值 × zoom）。
       之前钳制用未缩放 offsetWidth 与屏幕宽比较，上限严重偏小 → 挂件只能待在右侧拖不到左边。
       统一换算：渲染尺寸 = offsetWidth × zoom；钳制在"渲染像素"空间算再除回 zoom 得样式值；
       拖拽位移也除以 zoom，保证跟手。 */
    function zOf(el) {
        try { var z = parseFloat(getComputedStyle(el).zoom); if (isFinite(z) && z > 0) return z; } catch (e) {}
        return 1;
    }
    /* ---------- 位置记忆：各模式独立位置（zfm-*-pos，right/bottom；双写服务器持久化） ---------- */
    function getOwnPos(key, defR, defB) {
        try {
            var s = null;
            try { s = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
            if (!s || !isFinite(s.r)) { var v = usGet(key); if (v && typeof v === 'object' && isFinite(v.r)) s = v; }
            if (s && isFinite(s.r)) return s;
        } catch (e) { }
        return null;
    }
    function clampStagePos(el, r, b) {
        var z = zOf(el);
        var w = window.innerWidth || 1280, h = window.innerHeight || 800;
        var ew = (el.offsetWidth || 260) * z, eh = (el.offsetHeight || 200) * z;   /* 渲染尺寸 */
        r = Math.max(4 / z, Math.min((w - ew - 4) / z, r));
        b = Math.max(4 / z, Math.min((h - eh - 4) / z, b));
        return { r: r, b: b };
    }
    function applyStagePos(el, posKey) {
        if (!el) return;
        var saved = getOwnPos(posKey);
        if (saved) {
            var c = clampStagePos(el, saved.r, saved.b);
            el.style.right = c.r + 'px'; el.style.bottom = c.b + 'px';
            return;
        }
        /* 无独立存档：首次继承风筝锚点位置（与风筝同位替换） */
        var ax = null, ay = null;
        try {
            /* 键介质不一致：app-kite.js 经 UserSettings.set 写入镜像 JSON（zf3d_user_settings_mirror），
               独立键 zf3d-kite-anchor 仅有旧数据；优先 UserSettings.get，localStorage 直读兜底 */
            var v = (window.UserSettings && window.UserSettings.get(ANCHOR_KEY)) || localStorage.getItem(ANCHOR_KEY);
            if (v && typeof v === 'object') v = v.x != null ? (v.x + ',' + v.y) : '';
            if (v && v.indexOf(',') > 0) {
                var p = v.split(',');
                ax = parseFloat(p[0]); ay = parseFloat(p[1]);
            }
        } catch (e) {}
        if (!isFinite(ax) || !isFinite(ay)) {   /* 无存档：用风筝默认位（右缘中上） */
            ax = Math.max(180, (window.innerWidth || 1280) - 180);
            ay = Math.max(150, Math.min((window.innerHeight || 800) - 150, (window.innerHeight || 800) * 0.42));
        }
        var w = window.innerWidth || 1280, h = window.innerHeight || 800;
        /* 锚点即挂件左上角附近：从屏幕右/下缘换算（除以 zoom，锚点是渲染像素而 right 样式值会被 zoom 缩放） */
        var z = zOf(el);
        var right = Math.max(6 / z, (w - ax) / z);
        var bottom = Math.max(70 / z, (h - ay - 30) / z);
        var c2 = clampStagePos(el, right, bottom);
        el.style.right = c2.r + 'px';
        el.style.bottom = c2.b + 'px';
    }
    function stagePosKey() {
        if (curMode === 'office') return 'zfm-office-pos';
        if (curMode === 'fish') return 'zfm-fish-pos';
        if (curMode === 'spider') return 'zfm-spider-pos';
        if (curMode === 'farm') return 'zfm-farm-pos';
        if (curMode === 'space') return 'zfm-space-pos';
        if (curMode === 'pelican') return 'zfm-pelican-pos';
        /* tank 已全屏化（fixed 层挂 body，无位置记忆） */
        return 'zfm-plant-pos';
    }

    /* ---------- 模式管理：舞台容器 + 1s 低频同步（签名变更才动 DOM） ---------- */
    var rootRef = null, stageEl = null, syncTimer = null, curMode = 'kite', _syncing = false;

    function applyMode(mode) {
        if (MODES.indexOf(mode) < 0) mode = 'kite';
        curMode = mode;
        setModeStore(mode);
        /* 双写旧皮肤存储：让 app-kite.js 的 applySkin（init 时跑）与新菜单保持一致 */
        try { localStorage.setItem('zf3d-kite-skin', mode); } catch (e) {}
        /* 下拉菜单选中态 */
        var sw = document.getElementById('zfmSwitch');
        if (sw) {
            [].forEach.call(sw.querySelectorAll('button'), function (b) {
                b.classList.toggle('on', b.dataset.mode === mode);
            });
        }
        /* 渲染器切换：先全清再按需建（防 DOM 残留/双实例） */
        office.destroy(); plant.destroy(); fish.destroy(); spider.destroy(); farm.destroy(); space.destroy(); pelican.destroy(); tank.destroy();
        /* 忍者模式：非 ninja 模式下必须停掉正在进行的斩杀游戏（干净退出还原现场） */
        try { if (window.NinjaEgg && window.NinjaEgg.isActive()) window.NinjaEgg.stop(); } catch (e) {}
        if (stageEl) { stageEl.remove(); stageEl = null; }
        document.body.classList.remove('zfm-mode-office', 'zfm-mode-plant', 'zfm-mode-fish', 'zfm-mode-spider', 'zfm-mode-farm', 'zfm-mode-ninja', 'zfm-mode-space', 'zfm-mode-pelican', 'zfm-mode-tank', 'zfm-mode-none');
        /* 同一时间只显示一种形态：非 kite 模式下强制隐藏风筝头/线（kite-skin-off 类） */
        if (rootRef) {
            if (mode === 'office' || mode === 'plant' || mode === 'fish' || mode === 'spider' || mode === 'farm' || mode === 'space' || mode === 'pelican' || mode === 'tank' || mode === 'ninja') {
                rootRef.classList.add('kite-skin-off');
                var hd = rootRef.querySelector && rootRef.querySelector('.kite-head');
                if (hd) hd.style.visibility = 'hidden';
            } else if (mode === 'kite') {
                rootRef.classList.remove('kite-skin-off');
                var hd2 = rootRef.querySelector && rootRef.querySelector('.kite-head');
                if (hd2) hd2.style.visibility = '';
            }
            /* 【Bug2/Bug3 修复】切换本体模式时清除"风筝统计"残留的 solo 标志。
               solo 由菜单项1（打开独立统计面板）加上，CSS 强制 .kite-head
               {visibility:hidden;pointer-events:none} 且把统计面板 fixed(z-index:30) 浮在最上。
               原先只有 closeHeadOverview 会摘 solo，走 applyMode 切模式不会，导致：
               ① 点项2"风筝"后面板 solo 未清 → 龙头仍 pointer-events:none，无法拖拽（Bug2）；
               ② 切到"蜘蛛"等模式后 solo 残留的面板仍盖在舞台爬虫(z-index:3)之上，
                  指针落在面板上而非爬虫 → 拖不动、看似无法平移（Bug3 之一）。
               切到任一本体模式都按"离开统计面板"语义清掉 solo 并关闭面板 open。 */
            rootRef.classList.remove('kite-panel-solo');
            var _ovResidual = rootRef.querySelector && rootRef.querySelector('.kite-head-overview');
            if (_ovResidual) _ovResidual.classList.remove('open');
        }
        /* none=全部关闭：隐藏整个风筝根（含 zfm 舞台），但保留底部按钮本身 */
        if (mode === 'none') {
            document.body.classList.add('zfm-mode-none');
            if (rootRef) rootRef.style.display = 'none';
            syncBtnLabel();
            return;
        }
        if (rootRef) rootRef.style.display = '';
        if (mode === 'kite' || !rootRef) { syncBtnLabel(); return; }
        /* 忍者模式：无舞台挂件，直接启动斩杀游戏（复用 WASD 彩蛋，Esc 退出后自动回风筝） */
        if (mode === 'ninja') {
            try {
                if (window.NinjaEgg) window.NinjaEgg.start();
                else console.warn('[kite-modes] 忍者模式需要 app-ninja.js（未加载则只隐藏风筝头）');
            } catch (e) {}
            syncBtnLabel();
            return;
        }
        document.body.classList.add('zfm-mode-' + mode);
        /* 坦克全屏战场：直接渲染（el 挂 body，fixed 层），不走挂件定位 */
        if (mode === 'tank') {
            RENDERERS[mode].render(null, collectChats());
            syncBtnLabel();
            return;
        }
        if (!stageEl) {
            stageEl = document.createElement('div');
            stageEl.className = 'zfm-stage';
            rootRef.appendChild(stageEl);   /* 挂进风筝根：继承开关/急速显隐 */
        }
        /* 办公室/植物独立定位（有用户记忆则用记忆，否则继承风筝锚点一次） */
        var holder = RENDERERS[mode].el;
        if (holder) applyStagePos(holder, stagePosKey());
        else {
            /* render 尚未建 el 时先建一层代理容器定位：直接渲染后取 el 再定位 */
            RENDERERS[mode].render(stageEl, collectChats());
            var el2 = RENDERERS[mode].el;
            if (el2) applyStagePos(el2, stagePosKey());
            syncBtnLabel();
            return;
        }
        RENDERERS[mode].render(stageEl, collectChats());
        syncBtnLabel();
    }

    /* 游戏内 Esc/再次四键退出 → 自动切回风筝模式，避免界面残留黑屏 */
    document.addEventListener('ninja-egg-stop', function () {
        if (curMode === 'ninja') applyMode('kite');
    });
    /* 坦克全屏战场 Esc 退出 → 自动切回风筝（仿忍者回环） */
    document.addEventListener('tank-layer-stop', function () {
        if (curMode === 'tank') applyMode('kite');
    });

    function syncOnce() {
        if (_syncing || !rootRef || curMode === 'kite' || curMode === 'none' || curMode === 'ninja') return;
        if (document.hidden) return;
        _syncing = true;
        try {
            if (curMode === 'tank') { /* tank 自管 RAF，1s 轮询跳过重渲染防循环重建 */ }
            else RENDERERS[curMode].render(stageEl, collectChats());
            /* 不再每秒强制对齐风筝锚点：尊重用户拖拽后的独立位置 */
        } catch (e) {}
        _syncing = false;
    }

    /* ---------- 同步底部「风筝」按钮标题/指示 ---------- */
    var MODE_TITLES = {
        kite: '挂件样式：风筝。点击切换（风筝/办公室/植物/全部关闭）',
        office: '挂件样式：办公室。点击切换（风筝/办公室/植物/鱼缸/爬虫/全部关闭）',
        plant: '挂件样式：植物。点击切换（风筝/办公室/植物/鱼缸/爬虫/全部关闭）',
        fish: '挂件样式：鱼缸。点击切换（风筝/办公室/植物/鱼缸/爬虫/全部关闭）',
        spider: '挂件样式：电子爬虫。点击切换（风筝/办公室/植物/鱼缸/爬虫/种田/全部关闭）',
        farm: '挂件样式：种田。点击切换（风筝/办公室/植物/鱼缸/爬虫/种田/太空舱/忍者/全部关闭）',
        space: '挂件样式：太空舱。观测 LLM 流式输出。点击切换（风筝/办公室/植物/鱼缸/爬虫/种田/太空舱/忍者/全部关闭）',
        pelican: '挂件样式：鹈鹕骑车。可拖拽，点击张喙彩蛋。点击切换（风筝/办公室/植物/鱼缸/爬虫/种田/太空舱/鹈鹕骑车/忍者/全部关闭）',
        tank: '全屏战场：坦克大战。点击任意处激活，WSAD 移动 · J/空格开炮 · Esc 退出。',
        ninja: '挂件样式：忍者斩杀。游戏进行中（A/D 移动·空格跳·Esc 退出）。点击切换（风筝/办公室/植物/鱼缸/爬虫/种田/忍者/全部关闭）',
        none: '挂件样式：全部关闭。点击切换（风筝/办公室/植物/鱼缸/爬虫/忍者/全部关闭)'
    };
    function syncBtnLabel() {
        var btn = document.getElementById('kiteToggleBtn');
        if (!btn) return;
        btn.title = MODE_TITLES[curMode] || MODE_TITLES.kite;
        var dot = btn.querySelector('.tk-dot');
        if (dot) dot.classList.toggle('on', curMode !== 'none');
    }

    function ensureSwitcher() {
        var btn = document.getElementById('kiteToggleBtn');
        if (!btn) return;
        /* 已有旧版龙头菜单则移除（菜单统一收敛到底部风筝按钮） */
        var old = document.getElementById('zfmSwitch');
        if (old) old.remove();
        /* 下拉菜单：挂 body，定位在风筝按钮上方，点击外部收起 */
        var sw = document.createElement('div');
        sw.id = 'zfmSwitch';
        sw.className = 'zfm-switch';
        var ITEMS = [
            ['kite', '风筝'],
            ['office', '办公室'],
            ['plant', '植物'],
            ['fish', '鱼缸'],
            ['spider', '爬虫'],
            ['farm', '种田'],
            ['ninja', '忍者'],
            ['space', '太空舱'],
            ['pelican', '鹈鹕骑车'],
            ['tank', '坦克大战'],
            ['none', '全部关闭']
        ];
        var html = '<div class="zfm-menu">';
        /* 【风筝统计快捷入口】按用户要求放菜单第一位：点击直接弹出独立风筝统计面板 */
        html += '<button data-act="headpanel" title="打开风筝统计面板（整体速度/对话统计）"><span style="font-size:16px">📋</span><span>风筝统计</span></button>';
        for (var i = 0; i < ITEMS.length; i++) {
            html += '<button data-mode="' + ITEMS[i][0] + '">' + MODE_SVGS[ITEMS[i][0]]
                  + '<span>' + ITEMS[i][1] + '</span></button>';
        }
        html += '</div>';
        sw.innerHTML = html;
        document.body.appendChild(sw);
        /* 点击菜单项 → 切模式；点其他区域 → 收起 */
        sw.addEventListener('click', function (e) {
            e.stopPropagation();
            var b = e.target.closest && e.target.closest('button[data-mode], button[data-act]');
            if (!b) return;
            if (b.dataset.act === 'headpanel') {
                /* 打开头部面板：临时摘掉 kite-skin-off（植物模式隐藏头/线），
                   对 headEl 派发 mouseenter 复用 app-kite.js 的悬停打开逻辑 */
                var r = document.getElementById('zfKiteRoot');
                var he = r && r.querySelector('.kite-head');
                if (he) {
                    /* 直达入口：优先调用 app-kite.js 的 __kiteOpenHeadPanel（绕过 500ms 限频+悬停依赖）；
                       老版本无此函数时回退旧的 dispatch mouseenter + 双重试逻辑 */
                    if (typeof window.__kiteOpenHeadPanel === 'function') {
                        window.__kiteOpenHeadPanel();
                    } else {
                    if (r.classList.contains('kite-skin-off')) r.classList.remove('kite-skin-off');
                    he.style.visibility = '';
                    /* 强制打开面板：绕过悬停+500ms 限频（限频窗口内 dispatch 会被吞，表现为点了没反应）。
                       直接置 _headHover=true 再带重试 dispatch，若下帧面板还没 open 再派发一次 */
                    try { if (window.__kiteForceHeadHover) window.__kiteForceHeadHover(true); } catch (e2) {}
                    he.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                    /* 80/300ms 双重试：若仍处 500ms 限频窗口，确保最终打开 */
                    var _tryOpen = function () {
                        try {
                            var o = document.getElementById('zfKiteRoot').querySelector('.kite-head-overview');
                            if (o && !o.classList.contains('open')) he.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                        } catch (e3) {}
                    };
                    setTimeout(_tryOpen, 80);
                    setTimeout(_tryOpen, 300);
                    }
                }
                sw.classList.remove('open');
                return;
            }
            applyMode(b.dataset.mode);
            sw.classList.remove('open');
        });
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            sw.classList.toggle('open');
            /* 定位：按钮正上方弹出，防出屏 */
            var r = btn.getBoundingClientRect();
            var mw = sw.offsetWidth, mh = sw.offsetHeight;
            var x = Math.min(Math.max(8, r.left), (window.innerWidth || 1280) - mw - 8);
            var y = r.top - mh - 8;
            if (y < 8) y = r.bottom + 8;
            sw.style.left = x + 'px';
            sw.style.top = y + 'px';
        });
        document.addEventListener('click', function (e) {
            if (!sw.contains(e.target) && !btn.contains(e.target)) sw.classList.remove('open');
        });
        [].forEach.call(sw.querySelectorAll('button'), function (b) {
            b.classList.toggle('on', b.dataset.mode === curMode);
        });
        syncBtnLabel();
    }

    /* 点击工位/叶片聚焦对应对话（事件委托，兼容动态 DOM） */
    document.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('.zfm-of-desk[data-chat], .zfm-pl-leaf[data-chat], .zfm-fk-fish[data-chat], .zfm-sp-bot[data-chat]');
        if (t) focusChat(t.getAttribute('data-chat'));
    });

    /* 悬停工位/叶片 → 跟随气泡显示该对话标题（原生 title 在 WebView 中不显示） */
    var _zfmTip = null, _zfmTipT = null;
    function hideZfmTip() {
        clearTimeout(_zfmTipT);
        if (_zfmTip) { _zfmTip.remove(); _zfmTip = null; }
    }
    document.addEventListener('mouseover', function (e) {
        var t = e.target.closest && e.target.closest('.zfm-of-desk[data-title], .zfm-fk-fish[data-title], .zfm-sp-bot[data-title], .zfm-fm-plot[data-title]');
        if (!t) { hideZfmTip(); return; }
        hideZfmTip();
        _zfmTipT = setTimeout(function () {
            var tip = document.createElement('div');
            tip.className = 'zfm-tip';
            tip.textContent = t.getAttribute('data-title') || '';
            document.body.appendChild(tip);
            _zfmTip = tip;
            /* 持续跟随目标元素：叶片摇摆/植物晃动时气泡实时同步位置，不会错位（每帧用 rect 重算） */
            (function follow() {
                if (_zfmTip !== tip || !document.contains(t)) { hideZfmTip(); return; }
                var r = t.getBoundingClientRect();
                var x = r.left + r.width / 2 - tip.offsetWidth / 2;
                x = Math.min(Math.max(8, x), (window.innerWidth || 1280) - tip.offsetWidth - 8);
                var y = r.top - tip.offsetHeight - 6;
                if (y < 8) y = r.bottom + 6;
                tip.style.left = x + 'px';
                tip.style.top = y + 'px';
                requestAnimationFrame(follow);
            })();
        }, 150);
    });
    document.addEventListener('mouseout', function (e) {
        var t = e.target.closest && e.target.closest('.zfm-of-desk[data-title], .zfm-fk-fish[data-title], .zfm-sp-bot[data-title], .zfm-fm-plot[data-title]');
        if (t) hideZfmTip();
    });
    document.addEventListener('click', hideZfmTip, true);

    /* ---------- 向日葵花头点击 → 弹出风筝头部概览面板 ----------
       植物模式下风筝根带 kite-skin-off（隐藏头/线），此处临时摘掉该类、
       对 headEl 派发 mouseenter 复用 app-kite.js 的面板打开逻辑；
       面板或花头失焦（pointerdown 到别处 / Esc）后恢复隐藏。 */
    var _flowerPeek = false;
    function closeFlowerPeek() {
        if (!_flowerPeek) return;
        _flowerPeek = false;
        try {
            var r = document.getElementById('zfKiteRoot');
            if (r && r.classList.contains('kite-skin-off')) {
                var he = r.querySelector('.kite-head');
                if (he && he.dispatchEvent) he.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
            }
        } catch (e) {}
    }
    document.addEventListener('click', function (e) {
        var f = e.target.closest && e.target.closest('.zfm-pl-flower, .zfm-of-board');
        if (!f) { closeFlowerPeek(); return; }
        var r = document.getElementById('zfKiteRoot');
        if (!r) return;
        var he = r.querySelector('.kite-head');
        if (!he) return;
        if (_flowerPeek) { closeFlowerPeek(); return; }   // 再点一次收起
        _flowerPeek = true;
        r.classList.remove('kite-skin-off');
        he.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeFlowerPeek();
    });

    /* 【审核②修复】统一入口：旧皮肤菜单（app-kite.js setSkin）通过此事件
       委托新系统渲染，双菜单选中态不再各走各的 */
    window.addEventListener('zf-kite-mode-request', function (e) {
        var m = e && e.detail;
        if (m && MODES.indexOf(m) >= 0) applyMode(m);
    });

    function boot() {
        /* 等风筝根建好（app-kite.js init 会创建 #zfKiteRoot；急速模式下可能不存在，轮询等待） */
        var tries = 0;
        (function waitRoot() {
            var r = document.getElementById('zfKiteRoot');
            if (!r && tries++ < 120) return setTimeout(waitRoot, 500);
            rootRef = r;
            if (!rootRef) {
                /* 【审核②修复】60 秒后仍无风筝根：保留兜底轮询，根一旦就绪即回填
                   并按当前模式补建舞台（office/plant），避免只有 body 类无渲染体 */
                var backfill = setInterval(function () {
                    var rr = document.getElementById('zfKiteRoot');
                    if (!rr) return;
                    clearInterval(backfill);
                    rootRef = rr;
                    applyMode(curMode);
                }, 1000);
            }
            ensureSwitcher();
            curMode = getMode();
            /* 【审核①修复】无论风筝根是否就绪都走 applyMode：none 靠 body 类生效、
               office/plant 在无根时安全返回（applyMode 内已判 rootRef），
               菜单选中态/指示灯/标题始终与存储一致，不再静默改回 kite */
            applyMode(curMode);
            /* 【重启记忆】服务器设置异步到达后回填：若服务器存档的模式/位置与
               localStorage 缓存不一致（缓存被清或异地登录），以服务器为准重应用，
               保证"重启后还是上次的模式、上次拖到的位置" */
            window.addEventListener('user-settings-refreshed', function () {
                try {
                    var m = getMode();
                    if (m !== curMode) { applyMode(m); return; }
                    var rd = RENDERERS[curMode];
                    if (stageEl && rd && rd.el) applyStagePos(rd.el, stagePosKey());
                } catch (e) {}
            });
            /* 1s 低频同步：仅 office/plant 模式生效；页面隐藏时跳过 */
            syncTimer = setInterval(syncOnce, 1000);
        })();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    /* ---------- 工具结果播报：小人(作战室)/叶子(植物)像风筝身体一样冒泡报工具结果 ----------
       供 agent-02-loop-core.js 工具执行完成后调用：toolResult(chatId, text, ok) */
    function findNode(chatId) {
        if (!chatId) return null;
        var sel = '.zfm-of-desk[data-chat="' + chatId + '"], .zfm-pl-leaf[data-chat="' + chatId + '"], .zfm-fk-fish[data-chat="' + chatId + '"], .zfm-fm-plot[data-chat="' + chatId + '"]';
        var t = document.querySelector(sel);
        return t || null;
    }
    function popToolBubble(host, text) {
        var old = host.querySelector('.zfm-tool-bubble');
        if (old) old.remove();
        var b = document.createElement('div');
        b.className = 'zfm-tool-bubble';
        b.textContent = text;
        host.appendChild(b);
        /* 顶部元素气泡翻到下方，防被裁剪（同 office 对话气泡规则） */
        if (host.offsetTop < 30) b.classList.add('zfm-bubble-flip');
        setTimeout(function () { if (b.parentNode) b.remove(); }, 3200);
    }
    function toolResult(chatId, text, ok) {
        try {
            /* 植物模式：工具调用不冒泡提示，静静的（叶子状态变化本身已可见） */
            if (curMode !== 'plant') {
                var t = findNode(chatId);
                if (t) {
                    var msg = (ok === false ? '❌ ' : '🔧 ') + String(text || '').replace(/\s+/g, ' ').trim();
                    if (msg.length > 40) msg = msg.slice(0, 40) + '…';
                    popToolBubble(t, msg);
                }
            }
        } catch (e) {}
        /* 种田模式：工具调用=浇水（有农场实例即触发，洒水+生长推进） */
        try { if (farm.el && curMode === 'farm') farm.water(chatId); } catch (e) {}
    }
    /* 对外接口（供未来面板 Tab / 调试用） */
    window.ZFKiteModes = {
        getMode: getMode,
        setMode: applyMode,
        modes: MODES,
        toolResult: toolResult
    };
})();
