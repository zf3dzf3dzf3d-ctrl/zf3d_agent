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
    var MODES = ['kite', 'office', 'plant', 'fish', 'spider', 'farm', 'ninja', 'space', 'tank', 'none'];
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
           每侧前/中/后三腿，对侧中腿+两侧前/后腿组成支撑三角，相位取 hexapod 的 0/0.5/0.33 交替节奏 */
        LEGS: [
            { sx: -10, sy: -4, base: -140, len: [38, 32, 27], alt: 1,  phase: 0    },
            { sx: -11, sy: 1,  base: -90,  len: [40, 34, 30], alt: -1, phase: 0.5  },
            { sx: -10, sy: 6,  base: -40,  len: [38, 34, 30], alt: 1,  phase: 0    },
            { sx: 10,  sy: -4, base: -40,  len: [38, 32, 27], alt: -1, phase: 0.5  },
            { sx: 11,  sy: 1,  base: -90,  len: [40, 34, 30], alt: 1,  phase: 0    },
            { sx: 10,  sy: 6,  base: -140, len: [38, 34, 30], alt: -1, phase: 0.5  }
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
                var p = getP();
                st = { on: true, sx: e.clientX, sy: e.clientY, or: p.r, ob: p.b, moved: false };
                /* 拖拽跟手：暂停巡游 + 记录实时指针，move 时同步搬走爬虫世界坐标 */
                [].forEach.call(el.querySelectorAll('.zfm-sp-bot'), function (b) {
                    if (b._gait) b._gait._to = null;
                });
                el.setPointerCapture(e.pointerId);
            });
            el.addEventListener('pointermove', function (e) {
                if (!st.on) return;
                var z = zOf(el);
                var dx = (e.clientX - st.sx) / z, dy = (e.clientY - st.sy) / z;
                if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
                if (st.moved) {
                    apply(st.or - dx, st.ob - dy);
                    /* 精确跟手：爬虫世界坐标随指针同步平移（脚锚点保持相对身体） */
                    [].forEach.call(el.querySelectorAll('.zfm-sp-bot'), function (b) {
                        var g = b._gait; if (!g || g.x == null) return;
                        g.x += (e.clientX - (st.px || st.sx)) / z;
                        g.y += (e.clientY - (st.py || st.sy)) / z;
                    });
                }
                st.px = e.clientX; st.py = e.clientY;
            });
            var up = function () {
                if (st.on && st.moved) {
                    var p = getP();
                    try { usSet('zfm-spider-pos', p); } catch (e) { }
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },
        /* 单只机械六足 SVG（6 条腿各为一条 path，d 全由 JS 步态引擎每 tick 重写；
           聚合状态 st-agg：working/done/fail/idle 决定配色与步频，不跟随单一对话） */
        spiderHtml: function (state) {
            var col = { working: { body: '#16323e', edge: '#5fd8c8' }, done: { body: '#12332b', edge: '#5fe88a' },
                        fail: { body: '#3a201c', edge: '#f07860' }, idle: { body: '#2b3644', edge: '#8fa8bf' } }[state] || { body: '#2b3644', edge: '#8fa8bf' };
            var legs = '';
            for (var L = 0; L < 6; L++) {
                var legDef = this.LEGS[L];
                // 初始腿部路径：从髋关节向默认落点绘制，避免启动前腿不可见
                var hx = 30 + legDef.sx;
                var hy = 24 + legDef.sy;
                var lx = hx + legDef.sx * 2.8;
                var ly = hy + 14 + legDef.sy * 3.2;
                // 简单的三节腿折线
                var kx = hx + (lx - hx) * 0.6;
                var ky = hy + (ly - hy) * 0.6;
                var ax = kx + (lx - kx) * 0.7;
                var ay = ky + (ly - ky) * 0.7;
                legs += '<path class="zfm-sp-leg" data-leg="' + L + '" fill="none" stroke="' + col.edge + '" stroke-width="1.8" stroke-linecap="round" d="M' + hx.toFixed(1) + ' ' + hy.toFixed(1) + ' L' + kx.toFixed(1) + ' ' + ky.toFixed(1) + ' L' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' L' + lx.toFixed(1) + ' ' + ly.toFixed(1) + '"/>';
            }
            var stTxt = { working: '🤖 引擎运转中', done: '✅ 任务完成', fail: '❌ 出现故障', idle: '💤 待机休眠' }[state] || '';
            return '<div class="zfm-sp-bot hex st-' + state + '" data-title="' + esc(stTxt + '　（全对话聚合状态）') + '">'
                + '<svg viewBox="0 0 60 48" width="68" height="54" aria-hidden="true">'
                + '<ellipse class="zfm-sp-shadow" cx="30" cy="45" rx="22" ry="4.5" fill="rgba(0,20,40,.55)"/>'
                + '<rect class="zfm-sp-hit" x="-14" y="-12" width="88" height="72" fill="transparent"/>'
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
            if (!working && Math.random() > 0.85) return;   /* 全屏随机游走，偶尔原地休眠 */
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
                        var spd = g.stepping ? 1.1 : 2.6;   /* 悬空腿多时自动减速（排队感） */
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
                                return { def: { x: g.x + L.sx * 2.8, y: g.y + 14 + L.sy * 3.2 }, x: 0, y: 0 };
                            });
                        }
                        g.feet.list.forEach(function (f) { f.x *= kx; f.y *= ky; });
                        g.queue = []; g.stepping = null;
                    }
                    /* 每帧重算默认落点：def 跟随身体（身体动，脚钉原地→超距→排队迈步跟上） */
                    var scale0 = Math.min(lr.width, 1920) / 320;
                    g.feet.list.forEach(function (f, i) {
                        var L = self.LEGS[i];
                        f.def.x = g.x + L.sx * 2.8 * scale0;
                        f.def.y = g.y + 14 + L.sy * 3.2 * scale0;
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
                        var ly = (f.y - cy) + 24;
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
       太空舱模式 v3（space）— 单排流式报价条（股票新闻条式）
       - 不分对话舷窗：所有对话的 AI 最新流式文字按顺序排成一排，
         像报价单一样横向滚动，字符随 LLM 输出真实增长刷新。
       - 点击某段文字或状态灯 = 聚焦该对话。
       - 整舱任意位置按住拖拽移动（位置记忆 zfm-space-pos），不再有环视。
       - 状态色：working=蓝 / done=绿 / fail=红 / idle=暗。
       ===================================================================== */
    var space = {
        el: null,
        MAX_PANE: 8,
        _cache: {},                // 各对话最后已知文字（done/idle 保留显示）
        /* 流式文字读取：MutationObserver 增量 → 1s 轮询兜底 */
        ensureObserver: function () {
            if (this._obs) return;
            var self = this;
            this._obs = new MutationObserver(function () { self._dirty = true; });
            try {
                this._obs.observe(document.getElementById('chatCanvas') || document.body,
                    { childList: true, subtree: true, characterData: true });
            } catch (e) {}
        },
        ensure: function (host) {
            if (!this.el) {
                var self = this;
                this.el = document.createElement('div');
                this.el.className = 'zfm-space-station';
                this.el.innerHTML =
                    '<div class="zfm-space-shell"></div>' +
                    '<div class="zfm-sp-stars"></div>' +
                    '<div class="zfm-sp-earth"></div>' +
                    '<div class="zfm-sp-head"><b>🛰️ LLM LIVE</b><span class="zfm-sp-clock"></span></div>' +
                    '<div class="zfm-sp-ticker"><div class="zfm-sp-line"></div></div>' +
                    '<div class="zfm-sp-dots"></div>' +
                    '<div class="zfm-sp-empty">🛰️ 观景舱空着…<br>新建对话开工</div>';
                host.appendChild(this.el);
                this.makeDraggable();
                this.bindLook();
                this.ensureObserver();
                this._clockT = setInterval(function () {
                    var ck = self.el && self.el.querySelector('.zfm-sp-clock');
                    if (ck) { var d = new Date(); ck.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
                }, 1000);
            }
            return this.el;
        },
        /* 点击文字段/状态灯聚焦对话（拖拽已统一由 makeDraggable 整舱处理） */
        bindLook: function () {
            var self = this, el = this.el;
            var up = function (e) {
                /* 拖拽位移过则视为拖动不触发点击（与 makeDraggable 的 moved 标记共享） */
                if (el._zfmMoved) { el._zfmMoved = false; return; }
                var seg = e.target.closest && e.target.closest('.zfm-sp-seg[data-chat]');
                var pane = e.target.closest && e.target.closest('.zfm-sp-pane[data-chat]');
                var dot = e.target.closest && e.target.closest('.zfm-sp-dot[data-chat]');
                var t = seg || pane || dot;
                if (!t) return;
                e.stopPropagation();
                var id = t.getAttribute('data-chat');
                self.lookTo(id);
                if (t !== pane) {
                    self.lookTo(id);
                    try {
                        if (window.focusChatById) window.focusChatById(id);
                        else if (window.App && window.App.focusChat) window.App.focusChat(id);
                    } catch (err) {}
                }
            };
            el.addEventListener('pointerup', up);
        },
        /* 写视角：CSS 变量 --yaw/--pitch 驱动 world 旋转 + 星空视差 */
        look: function (yaw, pitch) {
            this.yaw = Math.max(-75, Math.min(75, yaw));
            this.pitch = Math.max(-40, Math.min(40, pitch));
            var el = this.el;
            if (!el) return;
            el.style.setProperty('--yaw', this.yaw.toFixed(1) + 'deg');
            el.style.setProperty('--pitch', this.pitch.toFixed(1) + 'deg');
        },
        /* 转向某个对话（按其方位角；优先看 working） */
        lookTo: function (id) {
            this.focusId = id;
            this._stopTour();
            var self = this, az = this.azOf(id);
            /* 平滑转向：逐帧插值 */
            var ty = az.az, tp = az.pitch, from = { y: this.yaw, p: this.pitch }, t0 = Date.now();
            var step = function () {
                var k = Math.min(1, (Date.now() - t0) / 400), e = 1 - Math.pow(1 - k, 3);
                self.look(from.y + (ty - from.y) * e, from.p + (tp - from.p) * e);
                if (k < 1) requestAnimationFrame(step);
            };
            step();
        },
        /* 方位角：对话按顺序每 45° 一个，pitch 交替错层 */
        azOf: function (id) {
            var i = this._order.indexOf(id);
            if (i < 0) i = 0;
            return { az: (i - (Math.min(this._order.length, this.MAX_PANE) - 1) / 2) * 45, pitch: (i % 2 ? 14 : -14) };
        },
        /* 自动环游：8s 无操作时看向下一个 working 对话 */
        startTour: function (chats) {
            if (this._tourT) return;
            var self = this;
            this._tourT = setInterval(function () {
                var work = (self._order || [])
                    .map(function (id) { return (chats || []).filter(function (c) { return c.id === id; })[0]; })
                    .filter(function (c) { return c && c.state === 'working'; });
                if (!work.length) return;
                var i = work.findIndex(function (c) { return c.id === self.focusId; });
                self.focusId = work[(i + 1) % work.length].id;
                var a = self.azOf(self.focusId);
                self.look(a.az, a.pitch);
            }, 8000);
            /* 用户交互后重置计时 */
            var reset = function () {
                self._stopTour();
                self._idleT = setTimeout(function () { self._tourT = null; self.startTour(chats); }, 8000);
            };
            if (!this._idleT) this._idleT = setTimeout(reset, 8000);
        },
        _stopTour: function () {
            if (this._tourT) { clearInterval(this._tourT); this._tourT = null; }
            if (this._idleT) { clearTimeout(this._idleT); this._idleT = null; }
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
                if (e.target.closest('.zfm-sp-porthole') || e.target.closest('.zfm-sp-dot')) return;
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
                    try { usSet('zfm-space-pos', p); } catch (e) { }
                }
                st.on = false;
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        },
        /* 流式文字读取：全文显示（用户要求看所有字，不只尾部） */
        fullText: function (chatId) {
            try {
                var box = document.querySelector('[data-chat-id="' + chatId + '"]') ||
                          document.getElementById('chat-' + chatId);
                if (!box) return '';
                var bubbles = box.querySelectorAll('.msg-ai, .ai-msg, .assistant, [class*="ai"]');
                var last = bubbles.length ? bubbles[bubbles.length - 1] : box;
                return (last.textContent || '').replace(/[ \t]+/g, ' ').trim();
            } catch (e) { return ''; }
        },
        /* 全景面板 HTML（按方位角放置） */
        paneHtml: function (c, az, pitch) {
            return '<div class="zfm-sp-pane st-' + c.state + '" data-chat="' + esc(c.id) + '" data-title="' + esc(c.title || c.id)
                + '" style="--az:' + az + 'deg; top:' + pitch + 'px">'
                + '<div class="ptxt"></div>'
                + '<div class="ptag">' + esc((c.title || c.id).slice(0, 10)) + '</div>'
                + '</div>';
        },
        /* v3：单排流式报价条——不分对话，所有对话 AI 最新文字按顺序横排滚动 */
        render: function (host, chats) {
            this.ensure(host);
            var self = this;
            var line = this.el.querySelector('.zfm-sp-line');
            var dots = this.el.querySelector('.zfm-sp-dots');
            var empty = this.el.querySelector('.zfm-sp-empty');
            empty.style.display = chats.length ? 'none' : '';
            var list = chats.slice(-this.MAX_PANE);
            this._order = list.map(function (c) { return c.id; });
            /* 按「最近活动优先」排序：working 中在最前 */
            list.sort(function (a, b) {
                var wa = a.state === 'working' ? 0 : (a.state === 'fail' ? 1 : 2);
                var wb = b.state === 'working' ? 0 : (b.state === 'fail' ? 1 : 2);
                return wa - wb;
            });
            /* 每个对话一段 <span class="seg">：状态色 + 分隔符，working 的每次刷新全文 */
            var html = '';
            list.forEach(function (c) {
                var t = c.state === 'working' ? self.fullText(c.id) : null;
                if (t === null && self._cache[c.id] != null) t = self._cache[c.id];
                else if (t === null) t = '（空闲）';
                if (c.state === 'working') self._cache[c.id] = t;
                html += '<span class="zfm-sp-seg st-' + c.state + '" data-chat="' + esc(c.id)
                    + '" data-title="' + esc(c.title || c.id) + '">'
                    + '<i class="zfm-sp-lamp"></i>' + esc(t) + '</span><span class="zfm-sp-sep">◆</span>';
            });
            if (line._sig !== html) {
                line._sig = html;
                /* 双份内容 + translateX(-50%) 匀速滚动 = 无缝循环报价条 */
                line.innerHTML = (html || '&nbsp;') + (html || '');
            }
            /* 左下状态灯（点谁聚焦谁对话） */
            var dhtml = list.map(function (c) {
                return '<div class="zfm-sp-dot st-' + c.state + '" data-chat="' + esc(c.id)
                    + '" data-title="' + esc(c.title || c.id) + '"></div>';
            }).join('');
            if (dots.innerHTML !== dhtml) dots.innerHTML = dhtml;
            /* 有 working → 开灯跑滚动；全空闲 → 停住 */
            var hasWorking = list.some(function (c) { return c.state === 'working'; });
            this.el.classList.toggle('flowing', hasWorking);
            return false;
        },
        destroy: function () {
            if (this._obs) { try { this._obs.disconnect(); } catch (e) {} this._obs = null; }
            if (this._clockT) { clearInterval(this._clockT); this._clockT = null; }
            if (this.el) { this.el.remove(); this.el = null; }
        }
    };

    /* =====================================================================
       坦克大战模式（tank）— 挂件内自管 canvas + RAF（零 RAF 原则的模式内例外）
       WSAD 合成 8 轴移动 / J·空格开炮 / 敌方边缘随机生成 / 暴击成长循环
       激活才接管键盘（输入框聚焦不接管），Esc 暂停，切走 destroy 销毁循环。
       ===================================================================== */
    var TANK = {
        W: 1280, H: 800,            // 画布逻辑尺寸（全屏战场，render/resize 时按视口动态更新）
        SPEED: 4.5, BULLET: 9, ESPEED: 1.6, EBULLET: 4.5,   // 全屏重标定（约 8 倍像素 × 0.6 折）
        MAX_ENEMY: 9, ENEMY_HP: 2,
        SPAWN_BASE: 2600, SPAWN_MIN: 900,   // 刷新间隔 ms：随击杀递减
        CRIT_STEP: 5, CRIT_INC: 0.05, CRIT_CAP: 0.5,  // 每 5 命中暴击率 +5%，上限 50%
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
            }
            if (this.buff > 0) this.buff -= dt;
            if (this.shieldT > 0) this.shieldT -= dt;
            if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
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
                            this.critRate = Math.min(TANK.CRIT_CAP, Math.floor(this.hits / TANK.CRIT_STEP) * TANK.CRIT_INC);
                            if (crit) { this.boom(b.x, b.y, true); if (Math.random() < 0.3) this.buff = 8000; }
                            if (en.hp <= 0) {
                                this.enemies.splice(j, 1);
                                this.kills++;
                                this.score += (crit ? 200 : 100) + this.combo * 10;
                                if (!crit) this.boom(en.x, en.y, false);
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

        boom: function (x, y, big) {
            var parts = [];
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
            /* 透明战场：铺设可见的深色背景+网格，不挡真实界面 */
            c.clearRect(0, 0, TANK.W, TANK.H);
            c.fillStyle = 'rgba(12,18,12,.45)'; c.fillRect(0, 0, TANK.W, TANK.H);
            c.strokeStyle = 'rgba(100,130,90,.25)'; c.lineWidth = 1; c.beginPath();
            for (var gx = 40; gx < TANK.W; gx += 40) { c.moveTo(gx, 0); c.lineTo(gx, TANK.H); }
            for (var gy = 40; gy < TANK.H; gy += 40) { c.moveTo(0, gy); c.lineTo(TANK.W, gy); }
            c.stroke();
            var vg = c.createRadialGradient(TANK.W / 2, TANK.H / 2, Math.min(TANK.W, TANK.H) * 0.35, TANK.W / 2, TANK.H / 2, Math.max(TANK.W, TANK.H) * 0.72);
            vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(6,10,5,.55)');
            c.fillStyle = vg; c.fillRect(0, 0, TANK.W, TANK.H);
            var sh = 0;
            for (var bi = 0; bi < this.booms.length; bi++) if (this.booms[bi].shake) sh = 3;
            c.save();
            if (sh) c.translate((Math.random() - 0.5) * sh * 2, (Math.random() - 0.5) * sh * 2);
            /* 敌方坦克（红） */
            for (var i = 0; i < this.enemies.length; i++) this.drawTank(this.enemies[i].x, this.enemies[i].y, Math.atan2(this.player.y - this.enemies[i].y, this.player.x - this.enemies[i].x), '#e05a4e', '#c9354a');
            /* 玩家（亮绿） */
            var p = this.player;
            this.drawTank(p.x, p.y, p.dir, '#8fd85c', '#5f9e3c');
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

    var RENDERERS = { office: office, plant: plant, fish: fish, spider: spider, farm: farm, space: space, tank: tank };

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
        office.destroy(); plant.destroy(); fish.destroy(); spider.destroy(); farm.destroy(); space.destroy(); tank.destroy();
        /* 忍者模式：非 ninja 模式下必须停掉正在进行的斩杀游戏（干净退出还原现场） */
        try { if (window.NinjaEgg && window.NinjaEgg.isActive()) window.NinjaEgg.stop(); } catch (e) {}
        if (stageEl) { stageEl.remove(); stageEl = null; }
        document.body.classList.remove('zfm-mode-office', 'zfm-mode-plant', 'zfm-mode-fish', 'zfm-mode-spider', 'zfm-mode-farm', 'zfm-mode-ninja', 'zfm-mode-space', 'zfm-mode-tank', 'zfm-mode-none');
        /* 同一时间只显示一种形态：非 kite 模式下强制隐藏风筝头/线（kite-skin-off 类） */
        if (rootRef) {
            if (mode === 'office' || mode === 'plant' || mode === 'fish' || mode === 'spider' || mode === 'farm' || mode === 'space' || mode === 'tank' || mode === 'ninja') {
                rootRef.classList.add('kite-skin-off');
                var hd = rootRef.querySelector && rootRef.querySelector('.kite-head');
                if (hd) hd.style.visibility = 'hidden';
            } else if (mode === 'kite') {
                rootRef.classList.remove('kite-skin-off');
                var hd2 = rootRef.querySelector && rootRef.querySelector('.kite-head');
                if (hd2) hd2.style.visibility = '';
            }
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
            ['tank', '坦克大战'],
            ['none', '全部关闭']
        ];
        var html = '<div class="zfm-menu">';
        for (var i = 0; i < ITEMS.length; i++) {
            html += '<button data-mode="' + ITEMS[i][0] + '">' + MODE_SVGS[ITEMS[i][0]]
                  + '<span>' + ITEMS[i][1] + '</span></button>';
        }
        /* 风筝统计快捷入口：单独菜单项，点击直接弹出风筝头部概览面板 */
        html += '<button data-act="headpanel" title="打开风筝统计面板（整体速度/对话统计）"><span style="font-size:16px">📋</span><span>风筝统计</span></button>';
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
